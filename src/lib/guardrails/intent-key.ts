import { createHash } from "node:crypto";
import { istDateKey } from "../format";

/**
 * App-level intent key: the same invoice asked for twice on the same IST day is the same
 * intent, however it was phrased. Swytchcode's dynamic idempotency makes RETRIES of one call
 * safe; this key makes REPEATED COMMANDS safe ("15k" and "15,000", "Sharma ji" and
 * "Sharma Traders" give the same key because amounts and clients are resolved first).
 *
 * key = "bahi-" + sha256(clientId | amount in whole rupees | normalized description | IST date)[0..16]
 */

/** Filler words that do not change what the work is. */
const FILLER = new Set([
  "a", "an", "the", "for", "of", "to", "and", "on", "in", "with",
  "ke", "ki", "ka", "ko", "liye", "lie", "se", "aur", "wala", "wali", "wale", "vala", "vali",
  "invoice", "bill", "payment", "kaam", "work", "charges", "charge", "fee", "fees",
]);

export function normalizeDescription(description: string): string {
  return description
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9ऀ-ॿ]+/g, " ")
    .split(" ")
    .filter((w) => w && !FILLER.has(w))
    .join(" ");
}

export function invoiceIntentKey(input: { clientId: string; amountInr: number; description: string; date: Date | string }): string {
  const day = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : istDateKey(input.date);
  const parts = [input.clientId.trim().toLowerCase(), String(Math.round(input.amountInr)), normalizeDescription(input.description), day];
  return `bahi-${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16)}`;
}
