import "server-only";
import { z } from "zod";
import { getEnv } from "../../env";
import { formatINR, istDateKey } from "../../format";
import { liveCall } from "../live-call";
import { toPaypalMoney, type CurrencyConfig } from "../money";
import { andThen, failure, success, type Outcome } from "../result";
import type { CallCtx, CreateInvoiceInput, PaypalAdapter, PaypalInvoice } from "../types";
import { invoiceCreateBody, refundBody } from "./body";
import {
  invoiceIdFromHref,
  PaypalInvoiceListRawSchema,
  PaypalInvoiceRawSchema,
  PaypalLinkSchema,
  PaypalPaymentRawSchema,
  PaypalRefundRawSchema,
  toPaypalInvoice,
  toRefund,
} from "./parse";

/** PayPal answers some calls with 202/204 and no body: the kernel prints null or {}. */
const Empty = z.union([z.null(), z.object({}).loose(), z.string()]);

function currencyConfig(): CurrencyConfig {
  const env = getEnv();
  return { currency: env.PAYPAL_CURRENCY, inrPerUsd: env.DEMO_INR_PER_USD };
}

export function createPaypalLive(): PaypalAdapter {
  const cfg = currencyConfig();

  const getInvoice = async (invoiceId: string, ctx?: CallCtx): Promise<Outcome<PaypalInvoice>> => {
    const r = await liveCall("paypalGetInvoice", { params: { invoice_id: invoiceId } }, PaypalInvoiceRawSchema, { ctx, summary: invoiceId, what: "PayPal invoice" });
    return r.ok ? success(toPaypalInvoice(r.value, cfg), r.ms) : r;
  };

  return {
    async createInvoice(input: CreateInvoiceInput, ctx) {
      const env = getEnv();
      const body = invoiceCreateBody(input, { cfg, businessName: env.BUSINESS_NAME, merchantEmail: env.PAYPAL_MERCHANT_EMAIL });
      const r = await liveCall(
        "paypalCreateInvoice",
        { body, headers: { Prefer: "return=representation" } },
        z.union([PaypalInvoiceRawSchema, PaypalLinkSchema]),
        { ctx, summary: `${input.clientName}, ${formatINR(input.amountInr)}`, what: "PayPal create invoice" },
      );
      if (!r.ok) return r;
      if ("status" in r.value && typeof r.value.status === "string" && "id" in r.value) {
        return success(toPaypalInvoice(PaypalInvoiceRawSchema.parse(r.value), cfg), r.ms);
      }
      const id = "href" in r.value ? invoiceIdFromHref(String(r.value.href)) : null;
      if (!id) return failure({ kind: "provider", message: "PayPal did not return an invoice id" }, r.ms);
      return andThen(r, () => getInvoice(id, ctx));
    },

    async sendInvoice(invoiceId, opts = {}, ctx) {
      const body = {
        send_to_invoicer: false,
        send_to_recipient: true,
        ...(opts.subject ? { subject: opts.subject } : {}),
        ...(opts.note ? { note: opts.note } : {}),
      };
      const r = await liveCall("paypalSendInvoice", { params: { invoice_id: invoiceId }, body }, z.union([PaypalLinkSchema, Empty]), {
        ctx,
        summary: invoiceId,
        what: "PayPal send invoice",
      });
      if (!r.ok) return r;
      const href = r.value && typeof r.value === "object" && "href" in r.value ? String(r.value.href) : null;
      return success({ invoiceId, payUrl: href }, r.ms);
    },

    getInvoice,

    async listInvoices(opts = {}, ctx) {
      const r = await liveCall(
        "paypalListInvoices",
        { params: { page: opts.page ?? 1, page_size: opts.pageSize ?? 20, total_required: true } },
        PaypalInvoiceListRawSchema,
        { ctx, summary: `page ${opts.page ?? 1}`, what: "PayPal invoice list" },
      );
      if (!r.ok) return r;
      return success({ invoices: r.value.items.map((i) => toPaypalInvoice(i, cfg)), total: r.value.total_items ?? null }, r.ms);
    },

    async recordPayment(invoiceId, input, ctx) {
      const body = {
        method: input.method ?? "BANK_TRANSFER",
        payment_date: input.paymentDate ?? istDateKey(new Date()),
        amount: toPaypalMoney(input.amountInr, cfg),
        ...(input.note ? { note: input.note } : {}),
      };
      const r = await liveCall("paypalRecordPayment", { params: { invoice_id: invoiceId }, body }, z.union([PaypalPaymentRawSchema, Empty]), {
        ctx,
        summary: `${invoiceId}, ${formatINR(input.amountInr)}`,
        what: "PayPal record payment",
      });
      if (!r.ok) return r;
      const paymentId = r.value && typeof r.value === "object" && "payment_id" in r.value ? String(r.value.payment_id) : null;
      return success({ paymentId }, r.ms);
    },

    async refundCapture(captureId, opts = {}, ctx) {
      const body = refundBody(opts, cfg);
      const r = await liveCall("paypalRefundCapture", { params: { capture_id: captureId }, body }, PaypalRefundRawSchema, {
        ctx,
        summary: opts.amountInr ? `${captureId}, ${formatINR(opts.amountInr)}` : `${captureId}, full`,
        what: "PayPal refund",
      });
      return r.ok ? success(toRefund(r.value), r.ms) : r;
    },

    async cancelInvoice(invoiceId, opts = {}, ctx) {
      // PayPal only cancels sent invoices; a draft is deleted instead.
      const current = await getInvoice(invoiceId, ctx);
      if (!current.ok) return current;
      if (current.value.status === "DRAFT") {
        const d = await liveCall("paypalDeleteDraft", { params: { invoice_id: invoiceId } }, Empty, { ctx, summary: invoiceId, what: "PayPal delete draft" });
        return d.ok ? success({ invoiceId }, d.ms + current.ms) : d;
      }
      const body = { send_to_invoicer: false, send_to_recipient: false, ...(opts.note ? { note: opts.note } : {}) };
      const r = await liveCall("paypalCancelInvoice", { params: { invoice_id: invoiceId }, body }, Empty, { ctx, summary: invoiceId, what: "PayPal cancel" });
      return r.ok ? success({ invoiceId }, r.ms) : r;
    },
  };
}
