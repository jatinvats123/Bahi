import "server-only";
import { getClientDirectory, matchClient } from "./clients";
import { getEnv } from "./env";
import { getMockRunHistory, getScripts, type RunScript } from "./fixtures";
import { istDateKey } from "./format";
import { getIntegrations } from "./integrations";
import { APP_STATUS_FROM_NOTION, type LedgerRow } from "./integrations/types";
import type { Invoice } from "./ledger";
import type { RunRecord } from "./run-record";
import { getRunStore } from "./store/runs";

/**
 * Page data access. Mock mode serves fixtures; live mode reads the Notion ledger
 * through Swytchcode. If that fails, live mode says "unavailable" with the reason
 * instead of pretending fixture data is real.
 */

export type Source = "fixtures" | "live" | "unavailable";

export interface LedgerData {
  source: Source;
  invoices: Invoice[];
  /** Why the live ledger could not be read (plain language). */
  problem?: string;
}

/** Notion row -> ledger view. A Sent row past its due date counts as overdue. */
export function rowToInvoice(row: LedgerRow, today: string): Invoice {
  const client = matchClient(getClientDirectory(), row.client);
  const status = row.status ? APP_STATUS_FROM_NOTION[row.status] : "draft";
  const due = row.due ?? row.issued ?? today;
  return {
    id: row.invoiceId ?? row.pageId,
    clientId: client?.id ?? "",
    clientName: row.client || "(no client)",
    clientEmail: row.clientEmail ?? client?.email ?? "",
    description: row.description,
    amountInr: row.amountInr ?? 0,
    status: status === "sent" && due < today ? "overdue" : status,
    issuedOn: row.issued ?? today,
    dueOn: due,
    paidOn: row.paidOn,
    lastReminderOn: row.lastReminder,
    payUrl: row.invoiceUrl,
    jiraKey: row.jiraKey,
  };
}

/**
 * The ledger for pages and the agent. Both modes read through the Notion adapter:
 * live = the real Notion ledger via Swytchcode, mock = the in-memory mock world
 * (seeded from fixtures), so invoices the agent creates in mock mode show up here too.
 */
export async function getLedger(now: Date = new Date()): Promise<LedgerData> {
  const integrations = getIntegrations();
  const r = await integrations.notion.listLedger({ limit: 100 });
  if (!r.ok) return { source: "unavailable", invoices: [], problem: r.error.message };
  const today = istDateKey(now);
  const invoices = r.value.map((row) => rowToInvoice(row, today)).sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.id.localeCompare(a.id));
  return { source: integrations.mode === "mock" ? "fixtures" : "live", invoices };
}

export function getDemoScripts(): RunScript[] {
  return getEnv().SWYTCH_MODE === "mock" ? getScripts() : [];
}

/** Stored runs first; in mock mode an empty history falls back to sample runs. */
export async function getRunHistory(now: Date = new Date()): Promise<{ source: Source; runs: RunRecord[] }> {
  const runs = await getRunStore().list();
  if (runs.length > 0) return { source: "live", runs };
  if (getEnv().SWYTCH_MODE === "mock") return { source: "fixtures", runs: getMockRunHistory(now) };
  return { source: "live", runs: [] };
}

/** One run for replay: the store first; in mock mode the sample runs too. */
export async function getRun(runId: string, now: Date = new Date()): Promise<RunRecord | null> {
  const stored = await getRunStore().get(runId);
  if (stored) return stored;
  if (getEnv().SWYTCH_MODE === "mock") return getMockRunHistory(now).find((r) => r.runId === runId) ?? null;
  return null;
}
