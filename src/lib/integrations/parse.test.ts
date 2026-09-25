import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRfc822, decodeBase64Url, emailAddress, GmailLabelsRawSchema, GmailListRawSchema, GmailMessageRawSchema, GmailSentRawSchema, toEmailMessage, toSummaries } from "./gmail/parse";
import { deliveryIssueFields, invoiceLabel, JiraCreatedRawSchema, JiraProjectRawSchema, JiraSearchRawSchema, toJiraIssue } from "./jira/parse";
import { paypalToInr, toPaypalMoney } from "./money";
import { DatabaseRawSchema, DataSourceRawSchema, LEDGER_PROPERTIES, PageRawSchema, QueryRawSchema, schemaPatch, toLedgerRow, toNotionProperties } from "./notion/parse";
import {
  invoiceIdFromHref,
  PaypalInvoiceListRawSchema,
  PaypalInvoiceRawSchema,
  PaypalLinkSchema,
  PaypalPaymentRawSchema,
  PaypalRefundRawSchema,
  toPaypalInvoice,
  toRefund,
} from "./paypal/parse";
import { slackError, SlackChannelsRawSchema, SlackEnvelopeSchema, SlackPostRawSchema } from "./slack/parse";
import { EmailMessageSchema, JiraIssueSchema, LedgerRowSchema, PaypalInvoiceSchema } from "./types";

/**
 * Every file under fixtures/recorded/<integration>/ is parsed by the same code the
 * live adapters use. Live captures (npm run smoke:swytch -- --record) are picked up
 * automatically next to the .sample files.
 */

const INR = { currency: "INR", inrPerUsd: 83 } as const;

/** tool id -> parse + map to the domain type (throws on mismatch). */
const PARSERS: Record<string, (data: unknown) => unknown> = {
  "invoices.invoicing.invoices.get": (d) => PaypalInvoiceSchema.parse(toPaypalInvoice(PaypalInvoiceRawSchema.parse(d), INR)),
  "invoices.invoicing.invoices.create": (d) => PaypalInvoiceSchema.parse(toPaypalInvoice(PaypalInvoiceRawSchema.parse(d), INR)),
  "invoices.invoicing.invoices.list": (d) => PaypalInvoiceListRawSchema.parse(d).items.map((i) => PaypalInvoiceSchema.parse(toPaypalInvoice(i, INR))),
  "invoices.invoicing.send.create": (d) => PaypalLinkSchema.parse(d),
  "invoices.invoicing.payments.create": (d) => PaypalPaymentRawSchema.parse(d),
  "payments.payment.captures.refund": (d) => toRefund(PaypalRefundRawSchema.parse(d)),
  "gmail.user.messages.get": (d) => toSummaries(GmailListRawSchema.parse(d)),
  "gmail.user.messages.get1": (d) => EmailMessageSchema.parse(toEmailMessage(GmailMessageRawSchema.parse(d))),
  "gmail.user.send.create1": (d) => GmailSentRawSchema.parse(d),
  "gmail.user.messages.create": (d) => GmailSentRawSchema.parse(d),
  "gmail.user.modify.create": (d) => GmailSentRawSchema.parse(d),
  "gmail.user.labels.get": (d) => GmailLabelsRawSchema.parse(d),
  "slack.conversations.list.list": (d) => SlackChannelsRawSchema.parse(d),
  "slack.chat.postmessage.create": (d) => {
    const env = SlackEnvelopeSchema.parse(d);
    return env.ok ? SlackPostRawSchema.parse(d) : slackError(env.error);
  },
  "notion.query.create": (d) => QueryRawSchema.parse(d).results.map((p) => LedgerRowSchema.parse(toLedgerRow(p))),
  "notion.page.create": (d) => LedgerRowSchema.parse(toLedgerRow(PageRawSchema.parse(d))),
  "notion.page.update": (d) => LedgerRowSchema.parse(toLedgerRow(PageRawSchema.parse(d))),
  "notion.data_source.get": (d) => DataSourceRawSchema.parse(d),
  "notion.data_source.update": (d) => DataSourceRawSchema.parse(d),
  "notion.databas.get": (d) => DatabaseRawSchema.parse(d),
  "jira.api.project.get2": (d) => JiraProjectRawSchema.parse(d),
  "jira.api.issue.create": (d) => JiraCreatedRawSchema.parse(d),
  "jira.api.jql.create": (d) => JiraSearchRawSchema.parse(d).issues.map((i) => JiraIssueSchema.parse(toJiraIssue(i, "https://x.atlassian.net"))),
};

const root = path.join(process.cwd(), "fixtures", "recorded");
const files = ["paypal", "gmail", "slack", "notion", "jira"].flatMap((dir) =>
  readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ dir, file: f, tool: f.replace(/\.json$/, "").replace(/\.sample$/, "").replace(/\.(2|not_in_channel)(\.sample)?$/, "").replace(/\.sample$/, "") })),
);
const load = (dir: string, file: string) => (JSON.parse(readFileSync(path.join(root, dir, file), "utf8")) as { data: unknown }).data;

describe("recorded responses parse into domain types", () => {
  it("found recorded files for all five integrations", () => {
    expect(new Set(files.map((f) => f.dir))).toEqual(new Set(["paypal", "gmail", "slack", "notion", "jira"]));
  });

  for (const f of files) {
    it(`${f.dir}/${f.file}`, () => {
      const parse = PARSERS[f.tool];
      expect(parse, `no parser registered for ${f.tool}`).toBeDefined();
      expect(() => parse?.(load(f.dir, f.file))).not.toThrow();
    });
  }
});

describe("PayPal", () => {
  it("maps an invoice, including pay link, due date and intent reference", () => {
    const inv = toPaypalInvoice(PaypalInvoiceRawSchema.parse(load("paypal", "invoices.invoicing.invoices.get.sample.json")), INR);
    expect(inv).toMatchObject({ status: "SENT", currency: "INR", amount: 15000, amountInr: 15000, recipientName: "Sharma Traders", dueDate: "2026-10-10", reference: "intent_abc123" });
    expect(inv.payUrl).toMatch(/sandbox\.paypal\.com/);
  });

  it("reads the id from a create link response", () => {
    expect(invoiceIdFromHref("https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-AB12-CD34-EF56-GH78")).toBe("INV2-AB12-CD34-EF56-GH78");
    expect(invoiceIdFromHref("https://example.com/nothing")).toBeNull();
  });

  it("converts rupees for a USD sandbox and back", () => {
    const usd = { currency: "USD", inrPerUsd: 83 } as const;
    expect(toPaypalMoney(15000, usd)).toEqual({ currency_code: "USD", value: "180.72" });
    expect(toPaypalMoney(15000, INR)).toEqual({ currency_code: "INR", value: "15000.00" });
    expect(paypalToInr(180.72, "USD", usd)).toBe(15000);
  });
});

describe("Gmail", () => {
  it("prefers text/plain, decodes base64url, reads headers", () => {
    const m = toEmailMessage(GmailMessageRawSchema.parse(load("gmail", "gmail.user.messages.get1.sample.json")));
    expect(m).toMatchObject({ fromEmail: "user_003@example.com", subject: "Payment done for catalogue shoot (INV-2026-0131)", messageIdHeader: "<abc123@mail.example.com>" });
    expect(m.bodyText).toContain("We have paid invoice INV-2026-0131");
    expect(m.bodyText).not.toContain("\r");
  });

  it("builds an RFC 822 message without header injection", () => {
    const raw = buildRfc822({ to: "a@b.in\r\nBcc: evil@x.com", subject: "Yaad dilana: ₹15,000", text: "Namaste\nShukriya" });
    expect(raw).toContain("To: a@b.in Bcc: evil@x.com\r\n");
    expect(raw).not.toMatch(/\r\nBcc:/);
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw.endsWith("Namaste\r\nShukriya")).toBe(true);
    expect(decodeBase64Url(Buffer.from("héllo").toString("base64url"))).toBe("héllo");
    expect(emailAddress("Neha Verma <Orders@VermaSweets.in>")).toBe("orders@vermasweets.in");
  });
});

describe("Slack", () => {
  it("turns ok:false into typed errors", () => {
    expect(slackError("not_in_channel")).toMatchObject({ kind: "not_found" });
    expect(slackError("invalid_auth")).toMatchObject({ kind: "auth" });
    expect(slackError("ratelimited")).toMatchObject({ kind: "provider", retryable: true });
  });
});

describe("Notion ledger", () => {
  it("maps a page to a ledger row", () => {
    const [row] = QueryRawSchema.parse(load("notion", "notion.query.create.sample.json")).results.map(toLedgerRow);
    expect(row).toMatchObject({ client: "Sharma Traders", amountInr: 15000, status: "Sent", issued: "2026-09-25", due: "2026-10-10", lastReminder: null, jiraKey: null, intentKey: "intent_abc123" });
  });

  it("round-trips properties", () => {
    const props = toNotionProperties({ client: "Verma Sweets", amountInr: 80000, status: "Awaiting approval", due: "2026-10-01", jiraKey: null });
    const page = PageRawSchema.parse({
      id: "p",
      properties: {
        Client: { type: "title", title: [{ plain_text: "Verma Sweets" }] },
        "Amount INR": { type: "number", number: (props["Amount INR"] as { number: number }).number },
        Status: { type: "select", select: (props.Status as { select: { name: string } }).select },
        Due: { type: "date", date: (props.Due as { date: { start: string } }).date },
      },
    });
    expect(toLedgerRow(page)).toMatchObject({ client: "Verma Sweets", amountInr: 80000, status: "Awaiting approval", due: "2026-10-01" });
    expect(Object.keys(toNotionProperties({ status: "Paid" }))).toEqual(["Status"]);
  });

  it("computes the schema patch for a fresh inline database", () => {
    const ds = DataSourceRawSchema.parse(load("notion", "notion.data_source.get.sample.json"));
    const patch = schemaPatch(ds, true);
    expect(patch?.properties.Name).toEqual({ name: "Client" });
    expect(patch?.properties.Tags).toBeNull();
    expect(patch?.added).toHaveLength(Object.keys(LEDGER_PROPERTIES).length - 1);
    expect(schemaPatch(ds, false)?.properties.Tags).toBeUndefined();
  });

  it("needs no patch once the schema is exact", () => {
    const properties = Object.fromEntries(
      Object.entries(LEDGER_PROPERTIES).map(([name, type]) => [
        name,
        { name, type, ...(name === "Status" ? { select: { options: ["Draft", "Awaiting approval", "Sent", "Paid", "Overdue", "Cancelled", "Refunded"].map((n) => ({ name: n })) } } : {}) },
      ]),
    );
    expect(schemaPatch(DataSourceRawSchema.parse({ id: "ds", properties }), true)).toBeNull();
  });
});

describe("Jira", () => {
  it("labels delivery tasks by invoice so they can be found again", () => {
    expect(invoiceLabel("INV2-AB12 CD34")).toBe("bahi-inv-INV2-AB12-CD34");
    const f = deliveryIssueFields({ invoiceId: "INV-1", clientName: "Gupta Electronics", description: "Catalogue shoot", amountInr: 24000 }, "BAHI");
    expect(f).toMatchObject({ project: { key: "BAHI" }, issuetype: { name: "Task" }, labels: ["bahi", "bahi-inv-INV-1"] });
    expect(JSON.stringify(f.description)).toContain("₹24,000");
  });
});
