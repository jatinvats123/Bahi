import "server-only";
import { rowToInvoice } from "./data";
import { istDateKey } from "./format";
import { isPaypalPaid, type CallCtx, type Integrations, type LedgerRow, type PaypalInvoice } from "./integrations/types";
import { failure, success, type Outcome } from "./integrations/result";
import { summarizeHisaab, type Hisaab, type Invoice } from "./ledger";

/**
 * "Aaj ka hisaab": to receive, overdue and received today, from the Notion ledger,
 * optionally verified against PayPal (one getInvoice per open invoice, in parallel).
 * Used by the daily_brief agent tool and GET /api/brief.
 */

export interface BriefInvoice {
  invoiceId: string;
  client: string;
  amountInr: number;
  description: string;
  due: string;
  daysLate: number;
  lastReminder: string | null;
}

export interface Brief extends Hisaab {
  asOf: string;
  today: string;
  /** True when open invoices were checked against PayPal. */
  verified: boolean;
  /** Open invoices that PayPal already shows as paid (the ledger is behind). */
  paidInPaypalNotLedger: { invoiceId: string; client: string; amountInr: number }[];
  overdueInvoices: BriefInvoice[];
  mode: "live" | "mock";
}

const MAX_VERIFY = 12;

function dayDiff(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T12:00:00Z`) - Date.parse(`${fromKey}T12:00:00Z`)) / 86_400_000);
}

export function toBriefInvoice(inv: Invoice, today: string): BriefInvoice {
  return {
    invoiceId: inv.id,
    client: inv.clientName,
    amountInr: inv.amountInr,
    description: inv.description,
    due: inv.dueOn,
    daysLate: Math.max(0, dayDiff(inv.dueOn, today)),
    lastReminder: inv.lastReminderOn,
  };
}

/** Pure part: ledger invoices (+ optional PayPal truth) -> brief numbers. */
export function summarizeBrief(invoices: Invoice[], now: Date, paypal: Map<string, PaypalInvoice> | null, mode: "live" | "mock"): Brief {
  const today = istDateKey(now);
  const paidInPaypalNotLedger: Brief["paidInPaypalNotLedger"] = [];
  const adjusted = invoices.map((inv) => {
    const pp = paypal?.get(inv.id);
    if (pp && (inv.status === "sent" || inv.status === "overdue") && isPaypalPaid(pp.status)) {
      paidInPaypalNotLedger.push({ invoiceId: inv.id, client: inv.clientName, amountInr: inv.amountInr });
      // PayPal is the money truth: it is no longer receivable. Paid date unknown, so not "today".
      return { ...inv, status: "paid" as const, paidOn: inv.paidOn ?? null };
    }
    return inv;
  });
  const hisaab = summarizeHisaab(adjusted, now);
  return {
    ...hisaab,
    asOf: now.toISOString(),
    today,
    verified: paypal !== null,
    paidInPaypalNotLedger,
    overdueInvoices: adjusted
      .filter((i) => i.status === "overdue")
      .map((i) => toBriefInvoice(i, today))
      .sort((a, b) => b.daysLate - a.daysLate),
    mode,
  };
}

/** Ledger rows as Invoices (Sent + past due = overdue). */
export function ledgerInvoices(rows: LedgerRow[], now: Date): Invoice[] {
  const today = istDateKey(now);
  return rows.map((r) => rowToInvoice(r, today));
}

/** Check open invoices against PayPal. Failures are skipped (the ledger value stands). */
export async function verifyWithPaypal(integrations: Integrations, invoices: Invoice[], ctx?: CallCtx): Promise<Map<string, PaypalInvoice>> {
  const open = invoices.filter((i) => (i.status === "sent" || i.status === "overdue") && i.id && !i.id.startsWith("mock-page-")).slice(0, MAX_VERIFY);
  const results = await Promise.all(open.map((i) => integrations.paypal.getInvoice(i.id, ctx)));
  const map = new Map<string, PaypalInvoice>();
  results.forEach((r, idx) => {
    const inv = open[idx];
    if (r.ok && inv) map.set(inv.id, r.value);
  });
  return map;
}

export async function computeBrief(integrations: Integrations, opts: { now?: Date; verify?: boolean; ctx?: CallCtx } = {}): Promise<Outcome<Brief>> {
  const now = opts.now ?? new Date();
  const rows = await integrations.notion.listLedger({ limit: 100 }, opts.ctx);
  if (!rows.ok) return failure(rows.error, rows.ms);
  const invoices = ledgerInvoices(rows.value, now);
  const paypal = opts.verify ? await verifyWithPaypal(integrations, invoices, opts.ctx) : null;
  return success(summarizeBrief(invoices, now, paypal, integrations.mode), rows.ms);
}
