import { z } from "zod";
import { paypalToInr, type CurrencyConfig } from "../money";
import type { PaypalInvoice, Refund } from "../types";

/** Provider JSON -> domain. Pure; tested against fixtures/recorded/paypal. */

const Money = z.object({ currency_code: z.string(), value: z.string() }).loose();

export const PaypalInvoiceRawSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    detail: z
      .object({
        invoice_number: z.string().optional(),
        reference: z.string().optional(),
        currency_code: z.string().optional(),
        payment_term: z.object({ due_date: z.string().optional() }).loose().optional(),
        metadata: z.object({ recipient_view_url: z.string().optional(), invoicer_view_url: z.string().optional() }).loose().optional(),
      })
      .loose()
      .optional(),
    primary_recipients: z
      .array(
        z
          .object({
            billing_info: z
              .object({
                email_address: z.string().optional(),
                name: z.object({ full_name: z.string().optional(), given_name: z.string().optional(), surname: z.string().optional() }).loose().optional(),
              })
              .loose()
              .optional(),
          })
          .loose(),
      )
      .optional(),
    amount: z.object({ currency_code: z.string(), value: z.string() }).loose().optional(),
    due_amount: Money.optional(),
    payments: z.object({ paid_amount: Money.optional() }).loose().optional(),
  })
  .loose();

/** POST /v2/invoicing/invoices without Prefer: return=representation answers with a link. */
export const PaypalLinkSchema = z.object({ href: z.string(), rel: z.string().optional(), method: z.string().optional() }).loose();

export function invoiceIdFromHref(href: string): string | null {
  const m = /\/invoices\/([^/?#]+)/.exec(href);
  return m?.[1] ?? null;
}

function dateKey(s: string | undefined): string | null {
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

export function toPaypalInvoice(raw: z.infer<typeof PaypalInvoiceRawSchema>, cfg: CurrencyConfig): PaypalInvoice {
  const currency = raw.amount?.currency_code ?? raw.detail?.currency_code ?? cfg.currency;
  const amount = raw.amount ? Number(raw.amount.value) : 0;
  const billing = raw.primary_recipients?.[0]?.billing_info;
  const name = billing?.name?.full_name ?? ([billing?.name?.given_name, billing?.name?.surname].filter(Boolean).join(" ") || null);
  const paid = raw.payments?.paid_amount ? Number(raw.payments.paid_amount.value) : null;
  return {
    id: raw.id,
    number: raw.detail?.invoice_number ?? null,
    status: raw.status,
    currency,
    amount,
    amountInr: paypalToInr(amount, currency, cfg),
    recipientEmail: billing?.email_address ?? null,
    recipientName: name,
    payUrl: raw.detail?.metadata?.recipient_view_url ?? null,
    dueDate: dateKey(raw.detail?.payment_term?.due_date),
    reference: raw.detail?.reference ?? null,
    paidAmount: paid,
  };
}

export const PaypalInvoiceListRawSchema = z
  .object({
    items: z.array(PaypalInvoiceRawSchema).default([]),
    total_items: z.number().optional(),
  })
  .loose();

export const PaypalPaymentRawSchema = z.object({ payment_id: z.string().optional() }).loose();

export const PaypalRefundRawSchema = z
  .object({ id: z.string(), status: z.string(), amount: z.object({ currency_code: z.string(), value: z.string() }).loose().optional() })
  .loose();

export function toRefund(raw: z.infer<typeof PaypalRefundRawSchema>): Refund {
  return {
    id: raw.id,
    status: raw.status,
    amount: raw.amount ? Number(raw.amount.value) : null,
    currency: raw.amount?.currency_code ?? null,
  };
}
