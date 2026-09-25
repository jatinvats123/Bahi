import { toNdjsonLine, type RunEvent } from "@/lib/events";
import { getRunBus } from "@/lib/store/run-bus";
import { getRunStore } from "@/lib/store/runs";

export const runtime = "nodejs";

/**
 * GET /api/runs/:id -> the stored run with every event, for replay.
 * GET /api/runs/:id?tail=1 -> NDJSON: the events so far, then live events until the run ends
 * (reattach after a disconnect). A run that is not live here is sent from the store and closed.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const tail = new URL(request.url).searchParams.get("tail") === "1";
  if (!tail) {
    const run = await getRunStore().get(id);
    if (!run) return Response.json({ error: "Yeh run nahi mila" }, { status: 404 });
    return Response.json(run);
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: RunEvent) => controller.enqueue(encoder.encode(toNdjsonLine(e)));
      const close = () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const live = getRunBus().tail(id, (event) => {
        try {
          if (event) send(event);
          else close();
        } catch {
          unsubscribe?.();
        }
      });
      if (live) {
        unsubscribe = live.unsubscribe;
        for (const e of live.events) send(e);
        if (live.done) close();
        return;
      }
      const stored = await getRunStore().get(id);
      for (const e of stored?.events ?? []) send(e);
      close();
    },
    cancel() {
      unsubscribe?.();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
}
