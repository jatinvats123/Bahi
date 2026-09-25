import { z } from "zod";
import { istDateKey } from "./format";

/** Ledger domain types. Notion is the source of truth from phase 2; fixtures mirror its shape. */

export const INVOICE_STATUSES = ["draft", "awaiting_approval", "sent", "overdue", "paid", "cancelled", "refunded"] as const;
export const InvoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const ClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  contact: z.string(),
  /** Contact email: where Gmail reminders go (demo: Gmail plus-aliases). */
  email: z.email(),
  city: z.string(),
  /** How the owner says the name, e.g. "Sharma ji". Used to resolve spoken commands. */
  aliases: z.array(z.string()).default([]),
  /** PayPal sandbox personal (payer) account that receives the invoice. Falls back to `email`. */
  paypalEmail: z.email().optional(),
});
export type Client = z.infer<typeof ClientSchema>;

const DateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const InvoiceSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  clientEmail: z.email(),
  description: z.string(),
  amountInr: z.number().nonnegative(),
  status: InvoiceStatusSchema,
  /** IST calendar dates, "2026-09-26". */
  issuedOn: DateKey,
  dueOn: DateKey,
  paidOn: DateKey.nullable(),
  lastReminderOn: DateKey.nullable(),
  /** Payer link to the PayPal (sandbox) invoice, when known. */
  payUrl: z.string().nullable().optional(),
  /** Jira delivery task key, once the delivery started. */
  jiraKey: z.string().nullable().optional(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  awaiting_approval: "Approval baaki",
  sent: "Sent",
  overdue: "Late",
  paid: "Paid",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export interface Hisaab {
  toReceive: number;
  toReceiveCount: number;
  overdue: number;
  overdueCount: number;
  receivedToday: number;
  receivedTodayCount: number;
}

/** "Aaj ka hisaab": open receivables, the overdue part of them, and money received today (IST). */
export function summarizeHisaab(invoices: readonly Invoice[], now: Date = new Date()): Hisaab {
  const today = istDateKey(now);
  const out: Hisaab = { toReceive: 0, toReceiveCount: 0, overdue: 0, overdueCount: 0, receivedToday: 0, receivedTodayCount: 0 };
  for (const inv of invoices) {
    if (inv.status === "sent" || inv.status === "overdue") {
      out.toReceive += inv.amountInr;
      out.toReceiveCount++;
    }
    if (inv.status === "overdue") {
      out.overdue += inv.amountInr;
      out.overdueCount++;
    }
    if (inv.status === "paid" && inv.paidOn === today) {
      out.receivedToday += inv.amountInr;
      out.receivedTodayCount++;
    }
  }
  return out;
}
