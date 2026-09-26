import { istDateKey } from "../../format";
import { toPaypalMoney, type CurrencyConfig } from "../money";
import type { CreateInvoiceInput } from "../types";

/**
 * PayPal request bodies, built in one place so the live adapter sends exactly what the
 * mock adapter checks against the same Swytchcode policies. Pure.
 */

const DAY_MS = 86_400_000;

export interface InvoiceBodyOpts {
  cfg: CurrencyConfig;
  businessName: string;
  merchantEmail?: string;
  today?: Date;
}

export function invoiceCreateBody(input: CreateInvoiceInput, opts: InvoiceBodyOpts) {
  const today = opts.today ?? new Date();
  return {
    detail: {
      currency_code: opts.cfg.currency,
      invoice_date: input.issueDate ?? istDateKey(today),
      payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: input.dueDate ?? istDateKey(new Date(today.getTime() + 15 * DAY_MS)) },
      ...(input.intentKey ? { reference: input.intentKey } : {}),
      note: input.note ?? `${opts.businessName} ki taraf se. Shukriya!`,
      // Merchant-only memo: the owner's approval stamp for invoices above the threshold.
      ...(input.approvalMemo ? { memo: input.approvalMemo } : {}),
    },
    invoicer: {
      business_name: opts.businessName,
      ...(opts.merchantEmail ? { email_address: opts.merchantEmail } : {}),
    },
    primary_recipients: [{ billing_info: { name: { full_name: input.clientName }, email_address: input.recipientEmail } }],
    items: [{ name: input.description.slice(0, 200), quantity: "1", unit_amount: toPaypalMoney(input.amountInr, opts.cfg), unit_of_measure: "QUANTITY" }],
  };
}

export function refundBody(opts: { amountInr?: number; note?: string }, cfg: CurrencyConfig) {
  return {
    ...(opts.amountInr ? { amount: toPaypalMoney(opts.amountInr, cfg) } : {}),
    ...(opts.note ? { note_to_payer: opts.note } : {}),
  };
}
