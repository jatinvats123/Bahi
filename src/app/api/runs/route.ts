import { z } from "zod";
import { newRunId, runAgent } from "@/lib/agent/orchestrator";
import { getEnv } from "@/lib/env";
import { toNdjsonLine, type RunEvent } from "@/lib/events";
import { playRecording } from "@/lib/replay/player";
import { loadRecording } from "@/lib/replay/store";
import { matchScenario, SCENARIO_IDS } from "@/lib/scenarios";
import { foldRunEvents } from "@/lib/run-reducer";
import { getRunBus } from "@/lib/store/run-bus";
import { createRunPersister } from "@/lib/store/run-persister";
import { getRunStore } from "@/lib/store/runs";

export const runtime = "nodejs";

/**
 * POST /api/runs { text, source } -> NDJSON stream of RunEvents (one JSON object per line).
 * The run keeps going if the browser disconnects (it may be waiting for an approval); the
 * page reattaches with GET /api/runs/:id?tail=1. Stop is explicit: POST /api/runs/:id/stop.
 * Every event is also appended to data/runs.json for /activity replay.
 * AGENT_MODE=replay: the command is matched to a recorded live run (fixtures/runs/) and that
 * recording streams instead, labelled as recorded (run_started.replay). Not saved to history.
 *
 * GET /api/runs -> run history summaries, newest first.
 */

const BodySchema = z.object({
  text: z.string().trim().min(1, "Kuch likho ya bolo").max(1000, "Hukum 1000 akshar se chhota rakho"),
  source: z.enum(["text", "voice"]).default("text"),
  /** Demo controls: pick the recording explicitly (replay mode only; ignored when the agent runs live). */
  scenario: z.enum(SCENARIO_IDS).optional(),
});

type Execute = (onEvent: (event: RunEvent) => void, signal: AbortSignal) => Promise<unknown>;

/** Stream a run as NDJSON, publish it on the run bus (reattach, stop) and optionally persist it. */
function streamRun(runId: string, execute: Execute, persist: boolean): Response {
  const abort = new AbortController();
  const bus = getRunBus();
  bus.start(runId, abort);
  const persister = persist ? createRunPersister() : null;
  const encoder = new TextEncoder();
  let open = true;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void execute((event) => {
        persister?.add(event);
        bus.publish(runId, event);
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(toNdjsonLine(event)));
        } catch {
          open = false;
        }
      }, abort.signal)
        .catch((e: unknown) => console.error("[runs] run crashed", e))
        .finally(async () => {
          await persister?.flush();
          bus.finish(runId);
          if (open) {
            open = false;
            try {
              controller.close();
            } catch {
              // already closed by the client
            }
          }
        });
    },
    cancel() {
      // The browser went away: stop streaming, keep the run (reattach with ?tail=1).
      open = false;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      "x-run-id": runId,
    },
  });
}

export async function POST(request: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Galat request" }, { status: 400 });
    body = parsed.data;
  } catch {
    return Response.json({ error: "Request JSON nahi hai" }, { status: 400 });
  }

  const env = getEnv();
  if (env.AGENT_MODE === "replay") {
    // Recorded runs are not saved to history: Activity stays a record of real runs only.
    const scenario = body.scenario ?? matchScenario(body.text, env.APPROVAL_THRESHOLD_INR);
    if (!scenario) {
      return Response.json(
        { error: "Recorded mode mein sirf demo hukum chalte hain (invoice, inbox, late payments, refund, aaj ka hisaab). Neeche diye examples mein se chuno." },
        { status: 422 },
      );
    }
    const recording = await loadRecording(scenario).catch((e: unknown) => {
      console.error("[runs] recording unreadable", e);
      return null;
    });
    if (!recording) return Response.json({ error: `${scenario} ki recording nahi mili. npm run record:replays chalao.` }, { status: 503 });
    const runId = newRunId().replace(/^run_/, "rpl_");
    return streamRun(runId, (onEvent, signal) => playRecording(recording, { runId, source: body.source, signal, onEvent, timing: { speed: env.REPLAY_SPEED } }), false);
  }

  const runId = newRunId();
  return streamRun(runId, (onEvent, signal) => runAgent({ text: body.text, source: body.source }, { runId, signal, onEvent }), true);
}

export async function GET() {
  const runs = await getRunStore().list();
  return Response.json({
    runs: runs.map((r) => {
      const view = foldRunEvents(r.events);
      return {
        runId: r.runId,
        command: r.command,
        inputMode: r.inputMode,
        mode: r.mode,
        status: r.status,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        toolCalls: r.events.filter((e) => e.type === "tool_call").length,
        stamp: view.stamp,
        final: view.final,
      };
    }),
  });
}
