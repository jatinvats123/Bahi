import type { RunEvent } from "./events";
import type { RunScript } from "./fixtures";

/**
 * Plays a fixture script as timed RunEvents, stamped with real wall-clock time.
 * Mock mode only: this stands in for the NDJSON stream until the phase 3 orchestrator exists.
 */
export function playScript(
  script: RunScript,
  opts: { runId: string; onEvent: (event: RunEvent) => void; speed?: number; onDone?: () => void },
): () => void {
  const speed = opts.speed ?? 1;
  const timers = script.steps.map((step, i) =>
    setTimeout(() => {
      opts.onEvent({ ...step.event, runId: opts.runId, seq: i + 1, ts: new Date().toISOString() } as RunEvent);
      if (i === script.steps.length - 1) opts.onDone?.();
    }, step.atMs / speed),
  );
  return () => timers.forEach(clearTimeout);
}
