import { describe, expect, it } from "vitest";
import { matchClient } from "../clients";
import { getClients } from "../fixtures";
import { paypalEndpointProblem, policiesTargeting, type Manifest } from "./project";
import { sanitize } from "./sanitize";
import { ALL_TOOL_IDS, TOOLS, toolById } from "./tools";

describe("PayPal sandbox-only guard", () => {
  const entry = (sandbox: string, production: string) => ({ sandbox_endpoint: sandbox, production_endpoint: production });
  const pinned: Manifest = { "PayPal.invoicing_v2@2.0": entry("https://api-m.sandbox.paypal.com", "https://api-m.sandbox.paypal.com") };

  it("passes only when the active endpoint is the PayPal sandbox", () => {
    expect(paypalEndpointProblem(pinned, "production")).toBeNull();
    expect(paypalEndpointProblem(pinned, "sandbox")).toBeNull();
    const live: Manifest = { "PayPal.invoicing_v2@2.0": entry("https://api-m.sandbox.paypal.com", "https://api-m.paypal.com") };
    expect(paypalEndpointProblem(live, "production")).toMatch(/api-m\.paypal\.com/);
    const local: Manifest = { "PayPal.invoicing_v2@2.0": entry("http://localhost", "http://localhost") };
    expect(paypalEndpointProblem(local, "sandbox")).toMatch(/localhost/);
    expect(paypalEndpointProblem({}, "production")).toMatch(/not installed/);
  });

  it("ignores PayPal libraries the project does not use", () => {
    const m: Manifest = { ...pinned, "PayPal.billing_subscriptions_v1@1.0": entry("http://localhost", "http://localhost") };
    expect(paypalEndpointProblem(m, "production")).toMatch(/billing_subscriptions/);
    expect(paypalEndpointProblem(m, "production", new Set(["PayPal.invoicing_v2@2.0"]))).toBeNull();
  });

  it("finds policies by target tool", () => {
    const policies = [
      { id: "a", target: ["payments.payment.captures.refund"], action: { type: "POLICY_BLOCKED" } },
      { id: "b", target: ["invoices.invoicing.invoices.create"], action: { type: "REQUIRES_APPROVAL" } },
    ];
    expect(policiesTargeting(policies, "payments.payment.captures.refund").map((p) => p.id)).toEqual(["a"]);
    expect(policiesTargeting(policies, "slack.chat.postmessage.create")).toEqual([]);
  });
});

describe("tool registry", () => {
  it("has unique canonical ids that look like Swytchcode ids", () => {
    expect(new Set(ALL_TOOL_IDS).size).toBe(Object.keys(TOOLS).length);
    for (const id of ALL_TOOL_IDS) expect(id).toMatch(/^[a-z]+(\.[A-Za-z0-9_]+){2,}$/);
    expect(toolById("invoices.invoicing.send.create")?.sendStamp).toBe(true);
    expect(toolById("nope")).toBeUndefined();
  });
});

describe("sanitize", () => {
  it("scrubs emails, tokens and ids but keeps the shape", () => {
    const out = sanitize(
      {
        id: "INV2-AB12-CD34-EF56-GH78",
        detail: { reference: "intent-1", note: "Mail rakesh@sharma.in" },
        access_token: "ya29.secret",
        invoicer: { email_address: "jatin@gmail.com", business_name: "DukaanSetu" },
        links: [{ href: "https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-AB12-CD34-EF56-GH78" }],
        auth: "Bearer abc.def.ghi",
        key: "BAHI-12",
      },
      { keep: ["DukaanSetu"] },
    ) as Record<string, unknown>;
    const s = JSON.stringify(out);
    expect(s).not.toMatch(/rakesh@sharma\.in|jatin@gmail\.com|ya29|abc\.def\.ghi|intent-1/);
    expect(s).not.toContain("INV2-AB12");
    expect(out).not.toHaveProperty("access_token");
    expect(s).toContain("DukaanSetu");
    expect(out.key).toMatch(/^BAHI-\d+$/);
    // Same id, same placeholder, so cross-references survive.
    expect((out.links as { href: string }[])[0]?.href).toContain(String(out.id));
  });

  it("re-encodes Gmail body data after scrubbing", () => {
    const data = Buffer.from("Hi, write to neha@verma.in", "utf8").toString("base64url");
    const out = sanitize({ payload: { body: { data } } }) as { payload: { body: { data: string } } };
    const text = Buffer.from(out.payload.body.data, "base64url").toString("utf8");
    expect(text).toMatch(/^Hi, write to user_\d+@example\.com$/);
  });
});

describe("client matching", () => {
  const clients = getClients();
  it("resolves spoken aliases, longest match first", () => {
    expect(matchClient(clients, "Sharma ji ko website redesign ke liye 15,000 ka invoice bhejo")?.id).toBe("cl_sharma");
    expect(matchClient(clients, "Verma Sweets ko 80,000 ka invoice bhejo")?.id).toBe("cl_verma");
    expect(matchClient(clients, "gupta electronics ka payment aaya?")?.id).toBe("cl_gupta");
    expect(matchClient(clients, "Mehta ko bhejo")).toBeNull();
  });
});
