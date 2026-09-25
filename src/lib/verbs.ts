import type { Integration } from "./events";
import { toolById } from "./swytch/tools";

/**
 * Hinglish verbs for timeline entries, keyed by Swytchcode canonical tool id.
 * The source of truth is src/lib/swytch/tools.ts. The phase-1 provisional ids are
 * kept as aliases so run history recorded before phase 2 still renders.
 */

export interface ToolVerb {
  /** Shown while the call is in flight. */
  running: string;
  /** Shown once the call succeeded. */
  done: string;
}

export const INTEGRATION_LABEL: Record<Integration, string> = {
  paypal: "PayPal",
  gmail: "Gmail",
  slack: "Slack",
  notion: "Notion",
  jira: "Jira",
};

const LEGACY_VERBS: Record<string, ToolVerb> = {
  "paypal.invoice.create": { running: "Invoice bana raha hoon", done: "Invoice banaya" },
  "paypal.invoice.send": { running: "Invoice bhej raha hoon", done: "Invoice bheja" },
  "paypal.invoice.get": { running: "Invoice status dekh raha hoon", done: "Invoice status dekha" },
  "paypal.invoice.list": { running: "PayPal invoices dekh raha hoon", done: "PayPal invoices dekhe" },
  "paypal.payment.refund": { running: "Refund ki koshish", done: "Refund kiya" },
  "gmail.messages.list": { running: "Inbox padh raha hoon", done: "Inbox padha" },
  "gmail.messages.get": { running: "Email padh raha hoon", done: "Email padha" },
  "gmail.messages.send": { running: "Email bhej raha hoon", done: "Email bheja" },
  "slack.chat.post_message": { running: "Slack par likh raha hoon", done: "Slack par likha" },
  "notion.ledger.find_client": { running: "Client dhoondh raha hoon", done: "Client mila" },
  "notion.ledger.query": { running: "Ledger dekh raha hoon", done: "Ledger dekha" },
  "notion.ledger.upsert_row": { running: "Ledger mein likh raha hoon", done: "Ledger mein likha" },
};

const FALLBACK: Record<Integration, ToolVerb> = {
  paypal: { running: "PayPal se baat", done: "PayPal kaam hua" },
  gmail: { running: "Gmail se baat", done: "Gmail kaam hua" },
  slack: { running: "Slack se baat", done: "Slack kaam hua" },
  notion: { running: "Notion se baat", done: "Notion kaam hua" },
  jira: { running: "Jira se baat", done: "Jira kaam hua" },
};

export function toolVerb(tool: string, integration: Integration): ToolVerb {
  const def = toolById(tool);
  if (def) return { running: def.running, done: def.done };
  return LEGACY_VERBS[tool] ?? FALLBACK[integration];
}

/** Tools whose success earns a SENT stamp. */
export function isSendTool(tool: string): boolean {
  const def = toolById(tool);
  if (def) return def.sendStamp === true;
  return /(^|\.)send$/.test(tool) || tool.endsWith(".send_reminder");
}
