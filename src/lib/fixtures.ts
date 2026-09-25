import { z } from "zod";
import clientsJson from "@fixtures/clients.json";
import invoicesJson from "@fixtures/invoices.json";
import activityJson from "@fixtures/activity.json";
import s1 from "@fixtures/scripts/s1-invoice.json";
import s2 from "@fixtures/scripts/s2-approval.json";
import s2Denied from "@fixtures/scripts/s2-denied.json";
import s3 from "@fixtures/scripts/s3-inbox.json";
import s5 from "@fixtures/scripts/s5-refund-blocked.json";
import s6 from "@fixtures/scripts/s6-hisaab.json";
import { RunEventDraftSchema, type RunEvent } from "./events";
import { istDateKey } from "./format";
import { ClientSchema, InvoiceStatusSchema, type Client, type Invoice } from "./ledger";
import { recordFromEvents, type RunRecord } from "./run-record";

/**
 * Mock data for SWYTCH_MODE=mock. Everything is validated with zod on load so a
 * broken fixture fails loudly in tests instead of rendering nonsense.
 * Never present this data as real: the UI shows a "Mock data" badge in mock mode.
 */

const DAY_MS = 86_400_000;

export const RunScriptSchema = z.object({
  id: z.string(),
  scenario: z.string(),
  title: z.string(),
  steps: z
    .array(z.object({ atMs: z.number().nonnegative(), event: RunEventDraftSchema }))
    .min(1)
    .refine((steps) => steps[0]?.event.type === "run_started", "first step must be run_started")
    .refine((steps) => steps.every((s, i) => i === 0 || s.atMs >= (steps[i - 1]?.atMs ?? 0)), "atMs must not decrease"),
});
export type RunScript = z.infer<typeof RunScriptSchema>;

const RawInvoicesSchema = z.object({
  invoices: z.array(
    z.object({
      id: z.string(),
      clientId: z.string(),
      description: z.string(),
      amountInr: z.number().nonnegative(),
      status: InvoiceStatusSchema,
      issuedOffsetDays: z.number().int(),
      dueOffsetDays: z.number().int(),
      paidOffsetDays: z.number().int().nullable(),
      lastReminderOffsetDays: z.number().int().nullable(),
    }),
  ),
});

const ActivitySchema = z.object({
  runs: z.array(z.object({ runId: z.string(), script: z.string(), startedOffsetMinutes: z.number() })),
});

const clients: Client[] = z.array(ClientSchema).parse(clientsJson);

const scripts: Record<string, RunScript> = Object.fromEntries(
  [s1, s2, s2Denied, s3, s5, s6].map((raw) => {
    const script = RunScriptSchema.parse(raw);
    return [script.id, script];
  }),
);

export function getClients(): Client[] {
  return clients;
}

export function getScripts(): RunScript[] {
  return Object.values(scripts);
}

export function getScript(id: string): RunScript {
  const script = scripts[id];
  if (!script) throw new Error(`Unknown fixture script "${id}"`);
  return script;
}

/** Stamp runId, seq and ts onto a script's drafts. seq follows step order. */
export function materializeScript(script: RunScript, opts: { runId: string; startedAt: Date }): RunEvent[] {
  const start = opts.startedAt.getTime();
  return script.steps.map(
    (step, i) =>
      ({
        ...step.event,
        runId: opts.runId,
        seq: i + 1,
        ts: new Date(start + step.atMs).toISOString(),
      }) as RunEvent,
  );
}

function dayKey(now: Date, offsetDays: number | null): string | null {
  return offsetDays === null ? null : istDateKey(new Date(now.getTime() + offsetDays * DAY_MS));
}

/** Mock ledger with dates relative to `now` (IST). */
export function getInvoices(now: Date = new Date()): Invoice[] {
  const byId = new Map(clients.map((c) => [c.id, c]));
  return RawInvoicesSchema.parse(invoicesJson).invoices.map((raw) => {
    const client = byId.get(raw.clientId);
    if (!client) throw new Error(`Fixture invoice ${raw.id} references unknown client ${raw.clientId}`);
    return {
      id: raw.id,
      clientId: raw.clientId,
      clientName: client.name,
      clientEmail: client.email,
      description: raw.description,
      amountInr: raw.amountInr,
      status: raw.status,
      issuedOn: dayKey(now, raw.issuedOffsetDays) ?? "",
      dueOn: dayKey(now, raw.dueOffsetDays) ?? "",
      paidOn: dayKey(now, raw.paidOffsetDays),
      lastReminderOn: dayKey(now, raw.lastReminderOffsetDays),
    };
  });
}

/** Mock run history for /activity, newest first. */
export function getMockRunHistory(now: Date = new Date()): RunRecord[] {
  return ActivitySchema.parse(activityJson)
    .runs.map((r) =>
      recordFromEvents(
        materializeScript(getScript(r.script), {
          runId: r.runId,
          startedAt: new Date(now.getTime() + r.startedOffsetMinutes * 60_000),
        }),
      ),
    )
    .filter((r): r is RunRecord => r !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
