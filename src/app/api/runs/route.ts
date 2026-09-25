import { z } from "zod";
import { newRunId, runAgent } from "@/lib/agent/orchestrator";
import { toNdjsonLine } from "@/lib/events";
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
 *
 * GET /api/runs -> run history summaries, newest first.
 */

const BodySchema = z.object({
  text: z.string().trim().min(1, "Kuch likho ya bolo").max(1000, "Hukum 1000 akshar se chhota rakho"),
  source: z.enum(["text", "voice"]).default("text"),
});

export async function POST(request: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Galat request" }, { status: 400 });
    body = parsed.data;
  } catch {
    return Response.json({ error: "Request JSON nahi hai" }, { status: 400 });
  }

  const runId = newRunId();
  const abort = new AbortController();
  const bus = getRunBus();
  bus.start(runId, abort);
  const persister = createRunPersister();
  const encoder = new TextEncoder();
  let open = true;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void runAgent(body, {
        runId,
        signal: abort.signal,
        onEvent: (event) => {
          persister.add(event);
          bus.publish(runId, event);
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(toNdjsonLine(event)));
          } catch {
            open = false;
          }
        },
      })
        .catch((e: unknown) => console.error("[runs] run crashed", e))
        .finally(async () => {
          await persister.flush();
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
