import "server-only";
import { getEnv } from "../env";
import { invoiceCreateBody } from "../integrations/paypal/body";
import type { CreateInvoiceInput } from "../integrations/types";
import { explainTool, swytchcodeText } from "../swytch/runtime";
import { TOOLS } from "../swytch/tools";

/** Live-only helpers for the approval desk (Swytchcode CLI reads, no provider calls). */

/**
 * `swy exec --explain` on the stamped invoice call: what Swytchcode will run once the owner
 * approves. Policies still apply to explain, and nothing is sent to PayPal.
 */
export async function explainInvoiceLive(input: CreateInvoiceInput): Promise<string | null> {
  const env = getEnv();
  const body = invoiceCreateBody(input, {
    cfg: { currency: env.PAYPAL_CURRENCY, inrPerUsd: env.DEMO_INR_PER_USD },
    businessName: env.BUSINESS_NAME,
    merchantEmail: env.PAYPAL_MERCHANT_EMAIL,
  });
  const r = await explainTool(TOOLS.paypalCreateInvoice.id, { body, headers: { Prefer: "return=representation" } });
  if (!r.ok || !r.endpoint) return null;
  return `Approve hone par Swytchcode yeh call karega: ${r.endpoint}${r.provider ? ` (${r.provider}` : ""}${r.mode ? `, ${r.mode} mode)` : r.provider ? ")" : ""}. Explain mode: koi network call nahi hui.`;
}

/** Status of a Swytchcode HITL request from `swy audit policy --json` (APPROVAL_MODE=swytchcode). */
export async function swytchcodeHitlStatus(requestId: string): Promise<"hitl" | "approved" | "rejected" | "expired" | "failed" | null> {
  const r = await swytchcodeText(["audit", "policy", "--json", "-n", "100"]);
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line.includes(requestId)) continue;
    try {
      const e = JSON.parse(line) as { id?: string; status?: string };
      if (e.id === requestId && (e.status === "hitl" || e.status === "approved" || e.status === "rejected" || e.status === "expired" || e.status === "failed")) return e.status;
    } catch {
      // not JSON
    }
  }
  return null;
}
