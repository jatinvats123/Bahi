import "server-only";
import { getClientDirectory, matchClient } from "./clients";
import { getEnv } from "./env";
import { getInvoices, getMockRunHistory, getScripts, type RunScript } from "./fixtures";
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

/** Notion row -> ledger view. Notion has no "paid on" column, so paidOn stays null in live mode. */
export function rowToInvoice(row: LedgerRow, today: string): Invoice {
  const client = matchClient(getClientDirectory(), row.client);
  return {
    id: row.invoiceId ?? row.pageId,
    clientId: client?.id ?? "",
    clientName: row.client || "(no client)",
    clientEmail: row.clientEmail ?? client?.email ?? "",
    description: row.description,
    amountInr: row.amountInr ?? 0,
    status: row.status ? APP_STATUS_FROM_NOTION[row.status] : "draft",
    issuedOn: row.issued ?? today,
    dueOn: row.due ?? row.issued ?? today,
    paidOn: null,
    lastReminderOn: row.lastReminder,
  };
}

export async function getLedger(now: Date = new Date()): Promise<LedgerData> {
  if (getEnv().SWYTCH_MODE === "mock") return { source: "fixtures", invoices: getInvoices(now) };
  const r = await getIntegrations().notion.listLedger({ limit: 100 });
  if (!r.ok) return { source: "unavailable", invoices: [], problem: r.error.message };
  const today = istDateKey(now);
  return { source: "live", invoices: r.value.map((row) => rowToInvoice(row, today)) };
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
