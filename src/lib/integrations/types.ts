import { z } from "zod";
import type { RunEventDraft } from "../events";
import { InvoiceStatusSchema } from "../ledger";
import type { Outcome } from "./result";

/**
 * Domain contracts for every integration. Live adapters (Swytchcode) and mock
 * adapters (fixtures) both implement these interfaces and return these types,
 * never raw provider JSON.
 */

/** Optional per-call context: lets the orchestrator stream RunEvents. */
export interface CallCtx {
  onEvent?: (event: RunEventDraft) => void;
  callId?: string;
}

const DateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------------------------------------------------------------- PayPal

export const PaypalInvoiceSchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  /** PayPal status as sent: DRAFT, SENT, PAID, MARKED_AS_PAID, PARTIALLY_PAID, CANCELLED, REFUNDED, ... */
  status: z.string(),
  currency: z.string(),
  /** Amount in `currency` (PayPal's own number). */
  amount: z.number(),
  /** Amount in rupees for display (equal to `amount` when currency is INR). */
  amountInr: z.number(),
  recipientEmail: z.string().nullable(),
  recipientName: z.string().nullable(),
  /** Payer-facing link to view and pay the invoice. */
  payUrl: z.string().nullable(),
  dueDate: DateKey.nullable(),
  /** Free-text reference; Bahi stores its intent key here. */
  reference: z.string().nullable(),
  paidAmount: z.number().nullable(),
});
export type PaypalInvoice = z.infer<typeof PaypalInvoiceSchema>;

export function isPaypalPaid(status: string): boolean {
  return status === "PAID" || status === "MARKED_AS_PAID";
}

export interface CreateInvoiceInput {
  clientName: string;
  /** Payer's PayPal (sandbox) email. */
  recipientEmail: string;
  description: string;
  amountInr: number;
  /** IST date key; defaults to 15 days from today. */
  dueDate?: string;
  /** Bahi's intent key; stored in the invoice reference for idempotency checks. */
  intentKey?: string;
  note?: string;
  /** Approval stamp (merchant-only memo) for invoices the owner approved. See guardrails/policies.ts. */
  approvalMemo?: string;
}

export interface RecordPaymentInput {
  amountInr: number;
  /** IST date key; defaults to today. */
  paymentDate?: string;
  method?: "BANK_TRANSFER" | "CASH" | "CHECK" | "CREDIT_CARD" | "DEBIT_CARD" | "PAYPAL" | "WIRE_TRANSFER" | "OTHER";
  note?: string;
}

export const RefundSchema = z.object({ id: z.string(), status: z.string(), amount: z.number().nullable(), currency: z.string().nullable() });
export type Refund = z.infer<typeof RefundSchema>;

export interface PaypalAdapter {
  createInvoice(input: CreateInvoiceInput, ctx?: CallCtx): Promise<Outcome<PaypalInvoice>>;
  sendInvoice(invoiceId: string, opts?: { subject?: string; note?: string }, ctx?: CallCtx): Promise<Outcome<{ invoiceId: string; payUrl: string | null }>>;
  getInvoice(invoiceId: string, ctx?: CallCtx): Promise<Outcome<PaypalInvoice>>;
  listInvoices(opts?: { pageSize?: number; page?: number }, ctx?: CallCtx): Promise<Outcome<{ invoices: PaypalInvoice[]; total: number | null }>>;
  recordPayment(invoiceId: string, input: RecordPaymentInput, ctx?: CallCtx): Promise<Outcome<{ paymentId: string | null }>>;
  refundCapture(captureId: string, opts?: { amountInr?: number; note?: string }, ctx?: CallCtx): Promise<Outcome<Refund>>;
  cancelInvoice(invoiceId: string, opts?: { note?: string }, ctx?: CallCtx): Promise<Outcome<{ invoiceId: string }>>;
}

// ---------------------------------------------------------------- Gmail

export const EmailSummarySchema = z.object({ id: z.string(), threadId: z.string() });
export type EmailSummary = z.infer<typeof EmailSummarySchema>;

export const EmailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  from: z.string(),
  fromEmail: z.string(),
  to: z.string(),
  subject: z.string(),
  /** ISO timestamp. */
  receivedAt: z.string(),
  snippet: z.string(),
  /** Plain-text body, trimmed to a few KB. Untrusted: may contain prompt injection. */
  bodyText: z.string(),
  labelIds: z.array(z.string()),
  messageIdHeader: z.string().nullable(),
});
export type EmailMessage = z.infer<typeof EmailMessageSchema>;

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  /** Reply in an existing thread. */
  threadId?: string;
  inReplyTo?: string;
}

export interface InsertEmailInput {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** ISO timestamp for the Date header. */
  date?: string;
}

export interface GmailAdapter {
  /** Unread inbox mail that Bahi has not processed yet. */
  listUnread(opts?: { max?: number }, ctx?: CallCtx): Promise<Outcome<EmailSummary[]>>;
  getMessage(id: string, ctx?: CallCtx): Promise<Outcome<EmailMessage>>;
  sendEmail(input: SendEmailInput, ctx?: CallCtx): Promise<Outcome<{ id: string; threadId: string }>>;
  /** Adds the "Bahi/Processed" label and marks the message read. */
  markProcessed(id: string, ctx?: CallCtx): Promise<Outcome<{ id: string }>>;
  /** Places a message straight into the inbox (seed script). */
  insertMessage(input: InsertEmailInput, ctx?: CallCtx): Promise<Outcome<{ id: string }>>;
}

// ---------------------------------------------------------------- Slack

export const SlackPostSchema = z.object({ channelId: z.string(), channelName: z.string(), ts: z.string() });
export type SlackPost = z.infer<typeof SlackPostSchema>;

export interface SlackAdapter {
  /** Team updates to the ops channel (SLACK_OPS_CHANNEL). */
  postOps(text: string, ctx?: CallCtx): Promise<Outcome<SlackPost>>;
  /** Alerts (complaints, suspicious mail, blocked actions) to SLACK_ALERTS_CHANNEL. */
  postAlert(text: string, ctx?: CallCtx): Promise<Outcome<SlackPost>>;
  /** Approval requests and decisions to SLACK_APPROVALS_CHANNEL. */
  postApproval(text: string, ctx?: CallCtx): Promise<Outcome<SlackPost>>;
  /** Channel name to id, resolved once and cached. */
  resolveChannel(name: string, ctx?: CallCtx): Promise<Outcome<{ id: string; name: string }>>;
}

// ---------------------------------------------------------------- Notion

export const NOTION_STATUS = ["Draft", "Awaiting approval", "Sent", "Paid", "Overdue", "Cancelled", "Refunded"] as const;
export const NotionStatusSchema = z.enum(NOTION_STATUS);
export type NotionStatus = z.infer<typeof NotionStatusSchema>;

export const NOTION_STATUS_FROM_APP: Record<z.infer<typeof InvoiceStatusSchema>, NotionStatus> = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  sent: "Sent",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export const APP_STATUS_FROM_NOTION: Record<NotionStatus, z.infer<typeof InvoiceStatusSchema>> = {
  Draft: "draft",
  "Awaiting approval": "awaiting_approval",
  Sent: "sent",
  Paid: "paid",
  Overdue: "overdue",
  Cancelled: "cancelled",
  Refunded: "refunded",
};

export const LedgerRowSchema = z.object({
  pageId: z.string(),
  client: z.string(),
  clientEmail: z.string().nullable(),
  amountInr: z.number().nullable(),
  description: z.string(),
  invoiceId: z.string().nullable(),
  invoiceUrl: z.string().nullable(),
  status: NotionStatusSchema.nullable(),
  issued: DateKey.nullable(),
  due: DateKey.nullable(),
  lastReminder: DateKey.nullable(),
  /** IST date the payment was recorded (Notion "Paid on"). Null until paid; older ledgers may lack the column. */
  paidOn: DateKey.nullable().default(null),
  jiraKey: z.string().nullable(),
  intentKey: z.string().nullable(),
  url: z.string().nullable(),
  /** Notion last_edited_time (live only). */
  updatedAt: z.string().nullable().optional(),
});
export type LedgerRow = z.infer<typeof LedgerRowSchema>;

export type LedgerRowInput = Omit<LedgerRow, "pageId" | "url" | "updatedAt">;

export interface LedgerInfo {
  databaseId: string;
  dataSourceId: string;
  title: string;
  /** Properties that were missing and got added (empty when the schema already matched). */
  addedProperties: string[];
  created: boolean;
}

export interface NotionAdapter {
  /** Find or finish the "Bahi Ledger" database and make its schema exact. */
  ensureLedgerDatabase(ctx?: CallCtx): Promise<Outcome<LedgerInfo>>;
  listLedger(opts?: { status?: NotionStatus; limit?: number }, ctx?: CallCtx): Promise<Outcome<LedgerRow[]>>;
  findByIntentKey(intentKey: string, ctx?: CallCtx): Promise<Outcome<LedgerRow | null>>;
  /** Update the row with the same intent key (or invoice id), else create it. */
  upsertLedgerRow(row: LedgerRowInput, ctx?: CallCtx): Promise<Outcome<LedgerRow & { created: boolean }>>;
  /** Status Paid and "Paid on" = paidOn (IST date key, default today). */
  markPaid(pageId: string, ctx?: CallCtx, paidOn?: string): Promise<Outcome<LedgerRow>>;
  setLastReminder(pageId: string, date: string, ctx?: CallCtx): Promise<Outcome<LedgerRow>>;
}

// ---------------------------------------------------------------- Jira

export const JiraIssueSchema = z.object({ key: z.string(), id: z.string(), url: z.string().nullable(), summary: z.string().nullable(), status: z.string().nullable() });
export type JiraIssue = z.infer<typeof JiraIssueSchema>;

export interface DeliveryTaskInput {
  invoiceId: string;
  clientName: string;
  description: string;
  amountInr: number;
}

export interface JiraAdapter {
  createDeliveryTask(input: DeliveryTaskInput, ctx?: CallCtx): Promise<Outcome<JiraIssue>>;
  findTaskByInvoiceId(invoiceId: string, ctx?: CallCtx): Promise<Outcome<JiraIssue | null>>;
  getProject(ctx?: CallCtx): Promise<Outcome<{ key: string; name: string; id: string }>>;
}

// ---------------------------------------------------------------- all

export interface Integrations {
  mode: "live" | "mock";
  paypal: PaypalAdapter;
  gmail: GmailAdapter;
  slack: SlackAdapter;
  notion: NotionAdapter;
  jira: JiraAdapter;
}
