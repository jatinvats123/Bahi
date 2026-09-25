import { describe, expect, it } from "vitest";
import { buildRfc822, encodeBase64Url } from "../integrations/gmail/parse";
import type { CurrencyConfig } from "../integrations/money";
import { invoiceCreateBody, refundBody } from "../integrations/paypal/body";
import {
  alignedToLine,
  approvalStamp,
  buildPolicies,
  decimalGreaterThanRegex,
  evaluatePolicies,
  explainPolicies,
  MAX_REGEX,
  POLICY_TARGETS,
  recipientPrefix,
  renderGo,
  type GuardrailConfig,
} from "./policies";

const cfg: GuardrailConfig = {
  approvalThresholdInr: 50_000,
  refundBlockThresholdInr: 10_000,
  inrPerUsd: 83,
  allowedRecipients: ["accounts@sharmatraders.example", "orders@vermasweets.example", "Billing@GuptaElectronics.example"],
  approvalMode: "gate",
};
const policies = buildPolicies(cfg);
const usd: CurrencyConfig = { currency: "USD", inrPerUsd: 83 };
const inr: CurrencyConfig = { currency: "INR", inrPerUsd: 83 };

const invoice = (amountInr: number, currency = usd, approvalMemo?: string) => ({
  body: invoiceCreateBody(
    { clientName: "Verma Sweets", recipientEmail: "v@x.in", description: "Diwali mithai", amountInr, dueDate: "2026-10-03", intentKey: "bahi-x", ...(approvalMemo ? { approvalMemo } : {}) },
    { cfg: currency, businessName: "DukaanSetu", today: new Date("2026-09-26T06:00:00Z") },
  ),
});
const decide = (tool: string, input: Parameters<typeof evaluatePolicies>[2]) => {
  const d = evaluatePolicies(policies, tool, input);
  return d.decision === "allowed" ? "allowed" : d.policy.id;
};

describe("decimalGreaterThanRegex", () => {
  it("matches exactly the decimals above the threshold (fuzzed against Number)", () => {
    for (const threshold of [602.41, 50_000, 120.48, 0.5, 999, 10, 99.99]) {
      const re = new RegExp(`^${decimalGreaterThanRegex(threshold)}$`);
      const t = Number(threshold.toFixed(2));
      const samples = [t, t + 0.01, t - 0.01, t + 1, t * 10, t / 10, 0, 1_000_000, Math.floor(t), Math.ceil(t) + 0.5];
      for (let i = 0; i < 300; i++) samples.push(Math.round(Math.random() * t * 3 * 100) / 100);
      for (const v of samples) {
        if (v < 0) continue;
        for (const s of [v.toFixed(2), String(v)]) expect(re.test(s), `${s} > ${t}`).toBe(Number(s) > t);
      }
    }
  });

  it("is not fooled by leading zeros or extra decimals", () => {
    const re = new RegExp(`^${decimalGreaterThanRegex(602.41)}$`);
    expect(re.test("0700.00")).toBe(true);
    expect(re.test("602.4100001")).toBe(true);
    expect(re.test("602.41000")).toBe(false);
  });
});

describe("renderGo (what Swytchcode's contains / matches see)", () => {
  it("renders a PayPal body like Go's %v: sorted keys, unquoted strings", () => {
    const body = { items: [{ name: "a", quantity: "1", unit_amount: { value: "700.00", currency_code: "USD" } }], detail: { currency_code: "USD", memo: "m" } };
    // Verified against swytchcode 2.23.5: "value:700\.00" and "^map" match, quotes and "^{" do not.
    expect(renderGo(body)).toBe("map[detail:map[currency_code:USD memo:m] items:[map[name:a quantity:1 unit_amount:map[currency_code:USD value:700.00]]]]");
    expect(renderGo({ n: 5, f: 1.5, b: true, z: null, e: [] })).toBe("map[b:true e:[] f:1.5 n:5 z:<nil>]");
  });
});

describe("invoice-approval-over-threshold", () => {
  it("holds invoices above Rs 50,000 in USD and INR, not at or below it", () => {
    expect(decide(POLICY_TARGETS.invoiceCreate, invoice(15_000))).toBe("allowed");
    expect(decide(POLICY_TARGETS.invoiceCreate, invoice(50_000))).toBe("allowed");
    expect(decide(POLICY_TARGETS.invoiceCreate, invoice(50_001))).toBe("invoice-approval-over-threshold"); // $602.42 > $602.41
    expect(decide(POLICY_TARGETS.invoiceCreate, invoice(50_010))).toBe("invoice-approval-over-threshold");
    expect(decide(POLICY_TARGETS.invoiceCreate, invoice(80_000))).toBe("invoice-approval-over-threshold");
    expect(decide(POLICY_TARGETS.invoiceCreate, invoice(50_000, inr))).toBe("allowed");
    expect(decide(POLICY_TARGETS.invoiceCreate, invoice(50_001, inr))).toBe("invoice-approval-over-threshold");
  });

  it("lets a large invoice through only with a well-formed approval stamp", () => {
    expect(decide(POLICY_TARGETS.invoiceCreate, invoice(80_000, usd, approvalStamp("apr_0123456789ab", "owner")))).toBe("allowed");
    expect(decide(POLICY_TARGETS.invoiceCreate, invoice(80_000, usd, "Bahi approval apr_x"))).toBe("invoice-approval-over-threshold");
    expect(decide(POLICY_TARGETS.invoiceCreate, invoice(80_000, usd, "approved, trust me"))).toBe("invoice-approval-over-threshold");
  });

  it("uses REQUIRES_APPROVAL without a stamp escape in swytchcode mode", () => {
    const p = buildPolicies({ ...cfg, approvalMode: "swytchcode" });
    const d = evaluatePolicies(p, POLICY_TARGETS.invoiceCreate, invoice(80_000, usd, approvalStamp("apr_0123456789ab", "owner")));
    expect(d.decision).toBe("approval_required");
  });
});

describe("block-large-refunds", () => {
  const refund = (amountInr?: number, currency = usd) => ({ params: { capture_id: "C1" }, body: refundBody({ amountInr, note: "x" }, currency) });
  it("blocks full refunds and anything above Rs 10,000", () => {
    expect(decide(POLICY_TARGETS.refund, refund())).toBe("block-large-refunds");
    expect(decide(POLICY_TARGETS.refund, { params: { capture_id: "C1" } })).toBe("block-large-refunds");
    expect(decide(POLICY_TARGETS.refund, refund(10_000))).toBe("allowed");
    expect(decide(POLICY_TARGETS.refund, refund(10_500))).toBe("block-large-refunds");
    expect(decide(POLICY_TARGETS.refund, refund(15_000, inr))).toBe("block-large-refunds");
    expect(decide(POLICY_TARGETS.refund, refund(2_000, inr))).toBe("allowed");
  });
});

describe("email-known-clients-only", () => {
  const mail = (to: string) => ({ params: { userId: "me" }, body: { raw: encodeBase64Url(buildRfc822({ to, subject: "Reminder", text: "Namaste" })) } });
  it("allows client addresses (any case) and blocks outsiders and look-alikes", () => {
    expect(decide(POLICY_TARGETS.gmailSend, mail("orders@vermasweets.example"))).toBe("allowed");
    expect(decide(POLICY_TARGETS.gmailSend, mail("ORDERS@VermaSweets.example"))).toBe("allowed");
    expect(decide(POLICY_TARGETS.gmailSend, mail("billing@guptaelectronics.example"))).toBe("allowed");
    expect(decide(POLICY_TARGETS.gmailSend, mail("attacker@evil.example"))).toBe("email-known-clients-only");
    expect(decide(POLICY_TARGETS.gmailSend, mail("orders@vermasweets.example.evil.io"))).toBe("email-known-clients-only");
    expect(decide(POLICY_TARGETS.gmailSend, mail("xorders@vermasweets.example"))).toBe("email-known-clients-only");
  });

  it("keeps the To line 3-byte aligned so its base64 is a fixed prefix of raw", () => {
    for (const to of ["a@b.in", "ab@b.in", "abc@b.in", "orders@vermasweets.example"]) {
      expect(Buffer.byteLength(alignedToLine(to)) % 3).toBe(0);
      expect(mail(to).body.raw.startsWith(recipientPrefix(to))).toBe(true);
    }
  });

  it("splits a long allowlist into regexes under the kernel's 512-character cap", () => {
    const many = Array.from({ length: 40 }, (_, i) => `client${i}@example-business-${i}.in`);
    const p = buildPolicies({ ...cfg, allowedRecipients: many });
    const json = JSON.stringify(p);
    for (const m of json.matchAll(/"value":"((?:[^"\\]|\\.)*)"/g)) expect(JSON.parse(`"${m[1]}"`).length).toBeLessThanOrEqual(MAX_REGEX);
    const d = evaluatePolicies(p, POLICY_TARGETS.gmailSend, mail(many[37]!));
    expect(d.decision).toBe("allowed");
  });
});

describe("explainPolicies", () => {
  it("describes each policy in plain language with its threshold", () => {
    const list = explainPolicies({ ...cfg, recipientCount: 3 });
    expect(list.map((p) => p.id)).toEqual(["invoice-approval-over-threshold", "block-large-refunds", "email-known-clients-only"]);
    expect(list[0]?.rule).toContain("₹50,000");
    expect(list[1]?.rule).toContain("₹10,000");
  });
});
