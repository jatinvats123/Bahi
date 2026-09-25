import "server-only";
import { getEnv } from "./env";
import { getInvoices, getMockRunHistory, getScripts, type RunScript } from "./fixtures";
import type { Invoice } from "./ledger";
import type { RunRecord } from "./run-record";
import { getRunStore } from "./store/runs";

/**
 * Page data access. Mock mode serves fixtures; live mode will read Notion through
 * Swytchcode (phase 2). Until then live mode returns "unavailable" instead of
 * pretending fixture data is real.
 */

export type Source = "fixtures" | "live" | "unavailable";

export function getLedger(now: Date = new Date()): { source: Source; invoices: Invoice[] } {
  if (getEnv().SWYTCH_MODE === "mock") return { source: "fixtures", invoices: getInvoices(now) };
  return { source: "unavailable", invoices: [] };
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
