import { getEnv } from "../../env";
import { istDateKey } from "../../format";
import { invoiceLabel } from "../jira/parse";
import { LEDGER_TITLE } from "../notion/parse";
import { failure, success } from "../result";
import type { GmailAdapter, JiraAdapter, LedgerRow, NotionAdapter, PaypalAdapter, SlackAdapter } from "../types";
import { mockCall, mockWorld, nextId } from "./world";

/** Mock twins of the live adapters. Same interfaces, same events, fixture data. */

const DAY_MS = 86_400_000;

export function createPaypalMock(): PaypalAdapter {
  return {
    createInvoice: (input, ctx) =>
      mockCall("paypalCreateInvoice", ctx, input.clientName, () => {
        const id = nextId("INV2-MOCK-");
        const inv = {
          id,
          number: id,
          status: "DRAFT",
          currency: "INR",
          amount: input.amountInr,
          amountInr: input.amountInr,
          recipientEmail: input.recipientEmail,
          recipientName: input.clientName,
          payUrl: `https://www.sandbox.paypal.com/invoice/p/#${id}`,
          dueDate: input.dueDate ?? istDateKey(new Date(Date.now() + 15 * DAY_MS)),
          reference: input.intentKey ?? null,
          paidAmount: null,
        };
        mockWorld().invoices.set(id, inv);
        return success(inv);
      }),
    sendInvoice: (invoiceId, _opts, ctx) =>
      mockCall("paypalSendInvoice", ctx, invoiceId, () => {
        const inv = mockWorld().invoices.get(invoiceId);
        if (!inv) return failure({ kind: "provider", message: `PayPal: invoice ${invoiceId} not found`, httpStatus: 404 });
        if (inv.status !== "DRAFT") return success({ invoiceId, payUrl: inv.payUrl });
        inv.status = "SENT";
        return success({ invoiceId, payUrl: inv.payUrl });
      }),
    getInvoice: (invoiceId, ctx) =>
      mockCall("paypalGetInvoice", ctx, invoiceId, () => {
        const inv = mockWorld().invoices.get(invoiceId);
        return inv ? success({ ...inv }) : failure({ kind: "provider", message: `PayPal: invoice ${invoiceId} not found`, httpStatus: 404 });
      }),
    listInvoices: (opts = {}, ctx) =>
      mockCall("paypalListInvoices", ctx, `page ${opts.page ?? 1}`, () => {
        const all = [...mockWorld().invoices.values()].reverse();
        const size = opts.pageSize ?? 20;
        const page = opts.page ?? 1;
        return success({ invoices: all.slice((page - 1) * size, page * size).map((i) => ({ ...i })), total: all.length });
      }),
    recordPayment: (invoiceId, input, ctx) =>
      mockCall("paypalRecordPayment", ctx, invoiceId, () => {
        const inv = mockWorld().invoices.get(invoiceId);
        if (!inv) return failure({ kind: "provider", message: `PayPal: invoice ${invoiceId} not found`, httpStatus: 404 });
        if (inv.status === "DRAFT") return failure({ kind: "provider", message: "PayPal: cannot record a payment on a draft invoice", httpStatus: 422 });
        inv.paidAmount = (inv.paidAmount ?? 0) + input.amountInr;
        inv.status = inv.paidAmount >= inv.amountInr ? "MARKED_AS_PAID" : "PARTIALLY_PAID";
        return success({ paymentId: nextId("MOCKPAY-") });
      }),
    refundCapture: (captureId, opts = {}, ctx) =>
      mockCall("paypalRefundCapture", ctx, captureId, () =>
        failure({
          kind: "policy_blocked",
          policyId: "refund-bulk-or-large",
          message: `Refunds by the agent are blocked by policy${opts.amountInr ? "" : " (full refund)"}. No network call was made. (mock)`,
        }),
      ),
    cancelInvoice: (invoiceId, _opts, ctx) =>
      mockCall(mockWorld().invoices.get(invoiceId)?.status === "DRAFT" ? "paypalDeleteDraft" : "paypalCancelInvoice", ctx, invoiceId, () => {
        const w = mockWorld();
        const inv = w.invoices.get(invoiceId);
        if (!inv) return failure({ kind: "provider", message: `PayPal: invoice ${invoiceId} not found`, httpStatus: 404 });
        if (inv.status === "DRAFT") w.invoices.delete(invoiceId);
        else inv.status = "CANCELLED";
        return success({ invoiceId });
      }),
  };
}

export function createGmailMock(): GmailAdapter {
  return {
    listUnread: (opts = {}, ctx) =>
      mockCall("gmailListMessages", ctx, "unread inbox", () =>
        success(
          [...mockWorld().inbox.values()]
            .filter((m) => m.labelIds.includes("UNREAD") && !m.labelIds.includes("Label_BahiProcessed"))
            .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
            .slice(0, opts.max ?? 10)
            .map((m) => ({ id: m.id, threadId: m.threadId })),
        ),
      ),
    getMessage: (id, ctx) =>
      mockCall("gmailGetMessage", ctx, id, () => {
        const m = mockWorld().inbox.get(id);
        return m ? success({ ...m, labelIds: [...m.labelIds] }) : failure({ kind: "provider", message: `Gmail: message ${id} not found`, httpStatus: 404 });
      }),
    sendEmail: (input, ctx) =>
      mockCall("gmailSend", ctx, `${input.to}: ${input.subject}`, () => {
        const id = nextId("mock-sent-");
        const threadId = input.threadId ?? `thread-${id}`;
        mockWorld().sent.push({ id, threadId, to: input.to, subject: input.subject, text: input.text });
        return success({ id, threadId });
      }),
    markProcessed: (id, ctx) =>
      mockCall("gmailModify", ctx, id, () => {
        const m = mockWorld().inbox.get(id);
        if (!m) return failure({ kind: "provider", message: `Gmail: message ${id} not found`, httpStatus: 404 });
        m.labelIds = [...m.labelIds.filter((l) => l !== "UNREAD"), "Label_BahiProcessed"];
        return success({ id });
      }),
    insertMessage: (input, ctx) =>
      mockCall("gmailInsert", ctx, `${input.from}: ${input.subject}`, () => {
        const id = nextId("mock-msg-");
        mockWorld().inbox.set(id, {
          id,
          threadId: `thread-${id}`,
          from: input.from,
          fromEmail: (/<([^>]+)>/.exec(input.from)?.[1] ?? input.from).toLowerCase(),
          to: input.to,
          subject: input.subject,
          receivedAt: input.date ?? new Date().toISOString(),
          snippet: input.text.slice(0, 120),
          bodyText: input.text,
          labelIds: ["INBOX", "UNREAD"],
          messageIdHeader: `<${id}@mock.bahi>`,
        });
        return success({ id });
      }),
  };
}

export function createSlackMock(): SlackAdapter {
  const channelId = (name: string) => `CMOCK${name.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8)}`;
  const post = (name: string, text: string, ctx: Parameters<SlackAdapter["postOps"]>[1]) =>
    mockCall("slackPost", ctx, `#${name}`, () => {
      const p = { channelId: channelId(name), channelName: name, ts: `${Math.floor(Date.now() / 1000)}.${String(nextId("")).padStart(6, "0")}` };
      mockWorld().slack.push({ ...p, text });
      return success(p);
    });
  return {
    resolveChannel: (name, ctx) => mockCall("slackListChannels", ctx, `#${name}`, () => success({ id: channelId(name.replace(/^#/, "")), name: name.replace(/^#/, "") })),
    postOps: (text, ctx) => post(getEnv().SLACK_OPS_CHANNEL, text, ctx),
    postAlert: (text, ctx) => {
      const env = getEnv();
      return post(env.SLACK_ALERTS_CHANNEL ?? env.SLACK_OPS_CHANNEL, text, ctx);
    },
  };
}

export function createNotionMock(): NotionAdapter {
  const find = (pred: (r: LedgerRow) => boolean) => [...mockWorld().ledger.values()].find(pred) ?? null;
  const update = (pageId: string, patch: Partial<LedgerRow>) => {
    const row = mockWorld().ledger.get(pageId);
    if (!row) return failure<LedgerRow>({ kind: "provider", message: `Notion: page ${pageId} not found`, httpStatus: 404 });
    Object.assign(row, patch);
    return success({ ...row });
  };
  return {
    ensureLedgerDatabase: (ctx) =>
      mockCall("notionGetDataSource", ctx, LEDGER_TITLE, () =>
        success({ databaseId: "mock-db-ledger", dataSourceId: "mock-ds-ledger", title: LEDGER_TITLE, addedProperties: [], created: false }),
      ),
    listLedger: (opts = {}, ctx) =>
      mockCall("notionQuery", ctx, opts.status ? `${LEDGER_TITLE}: ${opts.status}` : LEDGER_TITLE, () =>
        success(
          [...mockWorld().ledger.values()]
            .filter((r) => !opts.status || r.status === opts.status)
            .slice(0, opts.limit ?? 100)
            .map((r) => ({ ...r })),
        ),
      ),
    findByIntentKey: (intentKey, ctx) => mockCall("notionQuery", ctx, `intent ${intentKey}`, () => success(find((r) => r.intentKey === intentKey))),
    upsertLedgerRow: (row, ctx) =>
      mockCall<LedgerRow & { created: boolean }>("notionCreatePage", ctx, row.client, () => {
        const existing = row.intentKey ? find((r) => r.intentKey === row.intentKey) : row.invoiceId ? find((r) => r.invoiceId === row.invoiceId) : null;
        if (existing) {
          Object.assign(existing, row);
          return success({ ...existing, created: false });
        }
        const pageId = nextId("mock-page-");
        const created: LedgerRow = { ...row, pageId, url: null };
        mockWorld().ledger.set(pageId, created);
        return success({ ...created, created: true });
      }),
    markPaid: (pageId, ctx) => mockCall("notionUpdatePage", ctx, "Paid", () => update(pageId, { status: "Paid" })),
    setLastReminder: (pageId, date, ctx) => mockCall("notionUpdatePage", ctx, `reminder ${date}`, () => update(pageId, { lastReminder: date })),
  };
}

export function createJiraMock(): JiraAdapter {
  return {
    createDeliveryTask: (input, ctx) =>
      mockCall("jiraCreateIssue", ctx, `${input.clientName}: ${input.description}`, () => {
        const w = mockWorld();
        const key = `${getEnv().JIRA_PROJECT_KEY}-${w.jira.length + 17}`;
        const issue = { id: nextId("100"), key, url: null, summary: `Deliver: ${input.description} (${input.clientName})`, status: "To Do", labels: ["bahi", invoiceLabel(input.invoiceId)] };
        w.jira.push(issue);
        return success({ id: issue.id, key: issue.key, url: issue.url, summary: issue.summary, status: issue.status });
      }),
    findTaskByInvoiceId: (invoiceId, ctx) =>
      mockCall("jiraSearch", ctx, invoiceId, () => {
        const hit = mockWorld().jira.find((i) => i.labels.includes(invoiceLabel(invoiceId)));
        return success(hit ? { id: hit.id, key: hit.key, url: hit.url, summary: hit.summary, status: hit.status } : null);
      }),
    getProject: (ctx) => mockCall("jiraGetProject", ctx, getEnv().JIRA_PROJECT_KEY, () => success({ key: getEnv().JIRA_PROJECT_KEY, name: "Bahi deliveries (mock)", id: "10000" })),
  };
}
