import { z } from "zod";
import { RunEventSchema, RunStatusSchema, type RunEvent } from "./events";
import { foldRunEvents } from "./run-reducer";

/** One run as persisted in data/runs.json and shown on /activity. */
export const RunRecordSchema = z.object({
  runId: z.string().min(1),
  command: z.string(),
  inputMode: z.enum(["voice", "text"]),
  mode: z.enum(["live", "mock"]),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }).nullable(),
  status: RunStatusSchema,
  events: z.array(RunEventSchema),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

/** Build a record from a run's events. Returns null if the run_started event is missing. */
export function recordFromEvents(events: readonly RunEvent[]): RunRecord | null {
  const view = foldRunEvents(events);
  if (!view.runId || view.command === null || !view.startedAt || view.status === "idle") return null;
  return {
    runId: view.runId,
    command: view.command,
    inputMode: view.inputMode ?? "text",
    mode: view.mode ?? "mock",
    startedAt: view.startedAt,
    endedAt: view.endedAt,
    status: view.status,
    events: [...events].sort((a, b) => a.seq - b.seq),
  };
}
