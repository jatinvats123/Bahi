import type { Integration } from "../events";

/**
 * Every Swytchcode tool Bahi uses, keyed by capability. Canonical ids are the real
 * ids from the Swytchcode registry (swy list tooling), verified 25 Sep 2026.
 * Pure data: safe for client components (verbs, labels) and server code alike.
 */

export interface ToolDef {
  id: string;
  integration: Integration;
  /** Shown while the call is in flight. */
  running: string;
  /** Shown once the call succeeded. */
  done: string;
  /** Mutating call (creates, sends, changes money or records). */
  mutating: boolean;
  /** Success earns a SENT stamp in the timeline. */
  sendStamp?: boolean;
  verified: boolean;
}

function t(id: string, integration: Integration, running: string, done: string, extra: Partial<ToolDef> = {}): ToolDef {
  return { id, integration, running, done, mutating: false, verified: true, ...extra };
}

export const TOOLS = {
  // PayPal (sandbox) - invoicing_v2 and payments_payment_v2 libraries
  paypalCreateInvoice: t("invoices.invoicing.invoices.create", "paypal", "Invoice bana raha hoon", "Invoice banaya", { mutating: true }),
  paypalSendInvoice: t("invoices.invoicing.send.create", "paypal", "Invoice bhej raha hoon", "Invoice bheja", { mutating: true, sendStamp: true }),
  paypalGetInvoice: t("invoices.invoicing.invoices.get", "paypal", "Invoice status dekh raha hoon", "Invoice status dekha"),
  paypalListInvoices: t("invoices.invoicing.invoices.list", "paypal", "PayPal invoices dekh raha hoon", "PayPal invoices dekhe"),
  paypalSearchInvoices: t("invoices.invoicing.searchInvoices.create", "paypal", "PayPal mein dhoondh raha hoon", "PayPal mein dhoondha"),
  paypalRecordPayment: t("invoices.invoicing.payments.create", "paypal", "Payment darj kar raha hoon", "Payment darj kiya", { mutating: true }),
  paypalCancelInvoice: t("invoices.invoicing.invoices.cancel", "paypal", "Invoice cancel kar raha hoon", "Invoice cancel kiya", { mutating: true }),
  paypalDeleteDraft: t("invoices.invoicing.invoices.delete", "paypal", "Draft invoice hata raha hoon", "Draft invoice hataya", { mutating: true }),
  paypalRefundCapture: t("payments.payment.captures.refund", "paypal", "Refund ki koshish", "Refund kiya", { mutating: true }),

  // Gmail
  gmailListMessages: t("gmail.user.messages.get", "gmail", "Inbox padh raha hoon", "Inbox padha"),
  gmailGetMessage: t("gmail.user.messages.get1", "gmail", "Email padh raha hoon", "Email padha"),
  gmailSend: t("gmail.user.send.create1", "gmail", "Email bhej raha hoon", "Email bheja", { mutating: true, sendStamp: true }),
  gmailModify: t("gmail.user.modify.create", "gmail", "Email par nishaan laga raha hoon", "Email par nishaan lagaya", { mutating: true }),
  gmailInsert: t("gmail.user.messages.create", "gmail", "Inbox mein email rakh raha hoon", "Inbox mein email rakha", { mutating: true }),
  gmailImport: t("gmail.user.import.create", "gmail", "Inbox mein email la raha hoon", "Inbox mein email laaya", { mutating: true }),
  gmailListLabels: t("gmail.user.labels.get", "gmail", "Labels dekh raha hoon", "Labels dekhe"),
  gmailCreateLabel: t("gmail.user.labels.create", "gmail", "Label bana raha hoon", "Label banaya", { mutating: true }),
  gmailProfile: t("gmail.user.profile.get", "gmail", "Gmail account dekh raha hoon", "Gmail account dekha"),

  // Slack
  slackPost: t("slack.chat.postmessage.create", "slack", "Slack par likh raha hoon", "Slack par likha", { mutating: true }),
  slackListChannels: t("slack.conversations.list.list", "slack", "Slack channels dekh raha hoon", "Slack channels dekhe"),
  slackAuthTest: t("slack.auth.test.list", "slack", "Slack connection dekh raha hoon", "Slack connection theek hai"),
  slackJoinChannel: t("slack.conversations.join.create", "slack", "Slack channel join kar raha hoon", "Slack channel join kiya", { mutating: true }),

  // Notion (API 2025-09-03: databases hold data sources; rows are queried per data source)
  notionSearch: t("notion.search.create", "notion", "Notion mein dhoondh raha hoon", "Notion mein dhoondha"),
  notionGetDatabase: t("notion.databas.get", "notion", "Ledger database dekh raha hoon", "Ledger database dekha"),
  notionGetDataSource: t("notion.data_source.get", "notion", "Ledger ka dhancha dekh raha hoon", "Ledger ka dhancha dekha"),
  notionUpdateDataSource: t("notion.data_source.update", "notion", "Ledger ka dhancha bana raha hoon", "Ledger ka dhancha banaya", { mutating: true }),
  notionCreateDataSource: t("notion.data_source.create", "notion", "Ledger bana raha hoon", "Ledger banaya", { mutating: true }),
  notionQuery: t("notion.query.create", "notion", "Ledger dekh raha hoon", "Ledger dekha"),
  notionCreatePage: t("notion.page.create", "notion", "Ledger mein likh raha hoon", "Ledger mein likha", { mutating: true }),
  notionUpdatePage: t("notion.page.update", "notion", "Ledger update kar raha hoon", "Ledger update kiya", { mutating: true }),

  // Jira Cloud REST v3 (search uses the current /search/jql endpoint, not the retired /search)
  jiraCreateIssue: t("jira.api.issue.create", "jira", "Jira task bana raha hoon", "Jira task banaya", { mutating: true }),
  jiraGetIssue: t("jira.api.issue.get", "jira", "Jira task dekh raha hoon", "Jira task dekha"),
  jiraSearch: t("jira.api.jql.create", "jira", "Jira mein dhoondh raha hoon", "Jira mein dhoondha"),
  jiraGetProject: t("jira.api.project.get2", "jira", "Jira project dekh raha hoon", "Jira project dekha"),
  jiraMyself: t("jira.api.myself.list", "jira", "Jira account dekh raha hoon", "Jira account dekha"),
} as const satisfies Record<string, ToolDef>;

export type ToolKey = keyof typeof TOOLS;

const BY_ID = new Map<string, ToolDef>(Object.values(TOOLS).map((d) => [d.id, d]));

export function toolById(id: string): ToolDef | undefined {
  return BY_ID.get(id);
}

/** Canonical ids of every tool, e.g. for docs and the smoke test. */
export const ALL_TOOL_IDS: readonly string[] = [...BY_ID.keys()];
