import { extractAmounts } from "../agent/amount";
import { resolveClient, type ClientName } from "../agent/resolve-client";
import { formatINR } from "../format";

/**
 * What Bahi understood from a spoken command, computed locally before anything runs, for the
 * voice confirm strip ("₹15,000 · Sharma Traders · invoice"). Uses the same amount parser and
 * client resolver as the agent's guardrails. Pure module: runs in the browser.
 */

export type VoiceAction = "invoice" | "refund" | "reminder" | "payment";

export interface Understood {
  /** Money moves or a client is contacted: show the confirm strip before running. */
  money: boolean;
  action: VoiceAction | null;
  amountInr: number | null;
  /** Resolved client name, "sabke" for "everyone", or null. */
  client: string | null;
  /** Above the approval threshold: the invoice will wait for the owner's approval. */
  needsApproval: boolean;
  /** Display pieces, in order: amount, client, action. */
  parts: string[];
}

const ACTIONS: [VoiceAction, RegExp][] = [
  ["refund", /\brefund|\bwaapas|\bwapas|\blauta/],
  ["invoice", /\binvoice|\bbill\b|\bchalan/],
  ["reminder", /\byaad\b|\bremind|\breminder|\btagada|\btakaza/],
  ["payment", /\bpayment|\bpaise\b|\bpaisa\b|\bbhugtan/],
];

const ACTION_LABEL: Record<VoiceAction, string> = { invoice: "invoice", refund: "refund", reminder: "payment reminder", payment: "payment" };

export function understandCommand(text: string, clients: readonly ClientName[], approvalThresholdInr: number): Understood {
  const t = text.toLowerCase();
  const action = ACTIONS.find(([, re]) => re.test(t))?.[0] ?? null;
  const amountInr = extractAmounts(text)[0] ?? null;

  let client: string | null = null;
  if (/\bsab(ke|ko|hi|ka|ki)?\b|\bsabhi\b|\beveryone\b|\ball\b/.test(t)) client = "sabke";
  else {
    const r = resolveClient(clients, text);
    if (r.status === "matched") client = r.client.name;
  }

  const money = action !== null && action !== "payment" ? true : amountInr !== null;
  const needsApproval = action === "invoice" && amountInr !== null && amountInr > approvalThresholdInr;
  const parts: string[] = [];
  if (amountInr !== null) parts.push(formatINR(amountInr));
  if (client) parts.push(client === "sabke" ? "Sabke" : client);
  if (action) parts.push(ACTION_LABEL[action]);
  return { money, action, amountInr, client, needsApproval, parts };
}
