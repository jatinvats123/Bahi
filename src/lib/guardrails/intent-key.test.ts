import { describe, expect, it } from "vitest";
import clientsJson from "@fixtures/clients.json";
import { parseAmountInr } from "../agent/amount";
import { resolveClient } from "../agent/resolve-client";
import { ClientSchema } from "../ledger";
import { invoiceIntentKey, normalizeDescription } from "./intent-key";

const clients = clientsJson.map((c) => ClientSchema.parse(c));
const clientId = (spoken: string) => {
  const r = resolveClient(clients, spoken);
  if (r.status !== "matched") throw new Error(`no match for ${spoken}`);
  return r.client.id;
};
const key = (spokenClient: string, amountPhrase: string, description: string, date = "2026-09-26") =>
  invoiceIntentKey({ clientId: clientId(spokenClient), amountInr: parseAmountInr(amountPhrase) ?? NaN, description, date });

describe("invoice intent key", () => {
  it("is the same for 15k, 15,000 and pandrah hazaar, and for Sharma ji vs Sharma Traders", () => {
    const base = key("Sharma Traders", "15,000", "website redesign");
    expect(key("Sharma ji", "15k", "website redesign")).toBe(base);
    expect(key("sharma", "pandrah hazaar", "Website Redesign")).toBe(base);
    expect(key("Sharma Traders", "Rs 15000", "website redesign ke liye")).toBe(base);
    expect(key("Sharma Traders", "15,000", "website-redesign work")).toBe(base);
  });

  it("differs for another client, amount, work or day", () => {
    const base = key("Sharma Traders", "15,000", "website redesign");
    expect(key("Verma Sweets", "15,000", "website redesign")).not.toBe(base);
    expect(key("Sharma Traders", "16,000", "website redesign")).not.toBe(base);
    expect(key("Sharma Traders", "15,000", "logo design")).not.toBe(base);
    expect(key("Sharma Traders", "15,000", "website redesign", "2026-09-27")).not.toBe(base);
  });

  it("uses the IST day for Date inputs", () => {
    const late = invoiceIntentKey({ clientId: "cl_sharma", amountInr: 15000, description: "x", date: new Date("2026-09-25T20:00:00Z") }); // 01:30 IST on the 26th
    expect(late).toBe(invoiceIntentKey({ clientId: "cl_sharma", amountInr: 15000, description: "x", date: "2026-09-26" }));
  });

  it("normalizes descriptions", () => {
    expect(normalizeDescription("  Website  Redesign ke liye!! ")).toBe("website redesign");
    expect(normalizeDescription("Invoice for the logo")).toBe("logo");
  });
});
