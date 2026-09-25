import "server-only";
import type { RunEvent } from "../events";
import { restamp, replayDelays, type Recording, type ReplayTiming } from "./recording";

/**
 * Plays a recording as a new run: same events, new runId, playback timestamps, and a replay block
 * on run_started so every surface labels it "Recorded run". Stops like a live run when aborted.
 */
export async function playRecording(
  recording: Recording,
  opts: {
    runId: string;
    source: "voice" | "text";
    signal: AbortSignal;
    onEvent: (event: RunEvent) => void;
    timing?: Partial<ReplayTiming>;
  },
): Promise<void> {
  const { events, meta } = recording;
  const delays = replayDelays(events, opts.timing);
  let seq = 0;

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      if (ms <= 0 || opts.signal.aborted) return resolve();
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        opts.signal.removeEventListener("abort", done);
        resolve();
      }
      opts.signal.addEventListener("abort", done, { once: true });
    });

  for (const [i, original] of events.entries()) {
    await wait(delays[i] ?? 0);
    if (opts.signal.aborted) {
      opts.onEvent({
        type: "error",
        runId: opts.runId,
        seq: ++seq,
        ts: new Date().toISOString(),
        recoverable: false,
        message: "Aapne run rok diya. Jo kadam ho chuke the woh upar likhe hain.",
      });
      return;
    }
    seq = original.seq;
    let event = restamp(original, opts.runId, new Date());
    if (event.type === "run_started") {
      event = { ...event, inputMode: opts.source, replay: { scenario: meta.scenario, recordedAt: meta.recordedAt, sourceRunId: meta.sourceRunId } };
    }
    opts.onEvent(event);
  }
}
