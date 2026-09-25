import { z } from "zod";
import inboxJson from "@fixtures/inbox.json";
import { getClients, getInvoices } from "../../fixtures";
import type { ExecError } from "../../swytch/errors";
import { ownerMessage } from "../../swytch/errors";
import { TOOLS, type ToolKey } from "../../swytch/tools";
import { INTEGRATION_LABEL } from "../../verbs";
import type { InvoiceStatus } from "../../ledger";
import { failure, type Outcome } from "../result";
import { NOTION_STATUS_FROM_APP, type CallCtx, type EmailMessage, type JiraIssue, type LedgerRow, type PaypalInvoice, type SlackPost } from "../types";

/**
 * In-memory world behind the mock adapters (SWYTCH_MODE=mock). Seeded from
 * fixtures/, mutated by calls, reset with resetMockWorld(). Mock calls emit the
 * same RunEvents as live calls so the console behaves identically.
 * Never presented as real: the UI shows the "Mock data" badge in mock mode.
 */

const MIN = 60_000;

export const InboxFixtureSchema = z.object({
  emails: z.array(
    z.object({
      id: z.string(),
      clientId: z.string().nullable(),
      from: z.string().optional(),
      kind: z.enum(["invoice_request", "payment_confirmation", "refund_request", "complaint", "other", "suspicious"]),
      subject: z.string(),
      text: z.string(),
      receivedOffsetMinutes: z.number(),
    }),
  ),
});

const PAYPAL_STATUS: Record<InvoiceStatus, string> = {
  draft: "DRAFT",
  awaiting_approval: "DRAFT",
  sent: "SENT",
  overdue: "SENT",
  paid: "PAID",
  cancelled: "CANCELLED",
  refunded: "REFUNDED",
};

export interface MockWorld {
  invoices: Map<string, PaypalInvoice>;
  ledger: Map<string, LedgerRow>;
  inbox: Map<string, EmailMessage>;
  sent: { id: string; threadId: string; to: string; subject: string; text: string }[];
  slack: (SlackPost & { text: string })[];
  jira: (JiraIssue & { labels: string[] })[];
  seq: number;
}

function seed(now: Date): MockWorld {
  const clients = new Map(getClients().map((c) => [c.id, c]));
  const w: MockWorld = { invoices: new Map(), ledger: new Map(), inbox: new Map(), sent: [], slack: [], jira: [], seq: 100 };
  for (const inv of getInvoices(now)) {
    const client = clients.get(inv.clientId);
    w.invoices.set(inv.id, {
      id: inv.id,
      number: inv.id,
      status: PAYPAL_STATUS[inv.status],
      currency: "INR",
      amount: inv.amountInr,
      amountInr: inv.amountInr,
      recipientEmail: client?.paypalEmail ?? inv.clientEmail,
      recipientName: inv.clientName,
      payUrl: `https://www.sandbox.paypal.com/invoice/p/#${inv.id}`,
      dueDate: inv.dueOn,
      reference: `mock-${inv.id}`,
      paidAmount: inv.status === "paid" ? inv.amountInr : null,
    });
    const pageId = `mock-page-${inv.id}`;
    w.ledger.set(pageId, {
      pageId,
      client: inv.clientName,
      clientEmail: inv.clientEmail,
      amountInr: inv.amountInr,
      description: inv.description,
      invoiceId: inv.id,
      invoiceUrl: `https://www.sandbox.paypal.com/invoice/p/#${inv.id}`,
      status: NOTION_STATUS_FROM_APP[inv.status],
      issued: inv.issuedOn,
      due: inv.dueOn,
      lastReminder: inv.lastReminderOn,
      jiraKey: null,
      intentKey: `mock-${inv.id}`,
      url: null,
    });
  }
  for (const e of InboxFixtureSchema.parse(inboxJson).emails) {
    const client = e.clientId ? clients.get(e.clientId) : undefined;
    const from = e.from ?? (client ? `${client.contact} <${client.email}>` : "unknown@example.com");
    w.inbox.set(e.id, {
      id: e.id,
      threadId: `thread-${e.id}`,
      from,
      fromEmail: (/<([^>]+)>/.exec(from)?.[1] ?? from).toLowerCase(),
      to: "owner@dukaansetu.example",
      subject: e.subject,
      receivedAt: new Date(now.getTime() + e.receivedOffsetMinutes * MIN).toISOString(),
      snippet: e.text.slice(0, 120).replace(/\s+/g, " "),
      bodyText: e.text,
      labelIds: ["INBOX", "UNREAD"],
      messageIdHeader: `<${e.id}@mock.bahi>`,
    });
  }
  return w;
}

let world: MockWorld | undefined;

export function mockWorld(): MockWorld {
  world ??= seed(new Date());
  return world;
}

export function resetMockWorld(now: Date = new Date()): MockWorld {
  world = seed(now);
  return world;
}

export function nextId(prefix: string): string {
  const w = mockWorld();
  w.seq += 1;
  return `${prefix}${w.seq}`;
}

/** Stable fake latency per tool so mock timelines look plausible and tests stay deterministic. */
function fakeMs(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 90 + (h % 320);
}

/**
 * Run a mock operation as if it were a Swytchcode call: emits tool_call and
 * tool_result (plus policy events for blocks) exactly like the live runtime.
 */
export async function mockCall<T>(key: ToolKey, ctx: CallCtx | undefined, summary: string, fn: () => Outcome<T>): Promise<Outcome<T>> {
  const def = TOOLS[key];
  const callId = ctx?.callId ?? `m_${Math.random().toString(36).slice(2, 10)}`;
  const emit = ctx?.onEvent;
  const ms = fakeMs(def.id);
  emit?.({ type: "tool_call", callId, integration: def.integration, tool: def.id, inputSummary: summary });
  let out: Outcome<T>;
  try {
    out = fn();
  } catch (e) {
    out = failure({ kind: "unknown", message: e instanceof Error ? e.message : String(e) }, ms);
  }
  out = { ...out, ms };
  if (!out.ok) {
    const err: ExecError = out.error;
    if (err.kind === "policy_blocked") emit?.({ type: "policy", callId, decision: "blocked", policyId: err.policyId ?? "unknown", message: err.message });
  }
  emit?.({ type: "tool_result", callId, ok: out.ok, summary: out.ok ? def.done : ownerMessage(out.error, INTEGRATION_LABEL[def.integration]), ms, retries: 0 });
  return out;
}
