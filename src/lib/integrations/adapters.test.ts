import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunEventDraft } from "../events";
import type { ExecInput, ExecOptions, ExecResult } from "../swytch/runtime";
import { createGmailLive } from "./gmail/live";
import { createIntegrations } from "./index";
import { createJiraLive } from "./jira/live";
import { createGmailMock, createJiraMock, createNotionMock, createPaypalMock, createSlackMock } from "./mock/adapters";
import { mockWorld, resetMockWorld } from "./mock/world";
import { createNotionLive } from "./notion/live";
import { createPaypalLive } from "./paypal/live";
import { createSlackLive } from "./slack/live";
import type { GmailAdapter, Integrations, JiraAdapter, NotionAdapter, PaypalAdapter, SlackAdapter } from "./types";

// Live adapters talk to Swytchcode only through execTool; stub it to capture requests.
const calls: { tool: string; input: ExecInput }[] = [];
let respond: (tool: string, input: ExecInput) => unknown = () => ({});
vi.mock("../swytch/runtime", () => ({
  execTool: async (tool: string, input: ExecInput, opts: ExecOptions = {}): Promise<ExecResult> => {
    calls.push({ tool, input });
    const data = respond(tool, input);
    const invalid = opts.validate?.(data);
    if (invalid) return { ok: false, error: invalid, ms: 5, callId: "c", transport: "cli" };
    return { ok: true, data, ms: 5, callId: "c", transport: "cli" };
  },
}));

// ---- type-level: both implementations satisfy the same interfaces
const typeChecks: [PaypalAdapter, PaypalAdapter, GmailAdapter, GmailAdapter, SlackAdapter, SlackAdapter, NotionAdapter, NotionAdapter, JiraAdapter, JiraAdapter] = [
  createPaypalLive(),
  createPaypalMock(),
  createGmailLive(),
  createGmailMock(),
  createSlackLive(),
  createSlackMock(),
  createNotionLive(),
  createNotionMock(),
  createJiraLive(),
  createJiraMock(),
];
void typeChecks;

const methods = (o: object) => Object.keys(o).filter((k) => typeof (o as Record<string, unknown>)[k] === "function").sort();

describe("live and mock adapters", () => {
  it("expose exactly the same methods", () => {
    const live = createIntegrations("live");
    const mock = createIntegrations("mock");
    for (const key of ["paypal", "gmail", "slack", "notion", "jira"] as const) {
      expect(methods(mock[key]), key).toEqual(methods(live[key]));
      expect(methods(live[key]).length, key).toBeGreaterThan(2);
    }
    expect(live.mode).toBe("live");
    expect(mock.mode).toBe("mock");
  });
});

describe("mock world", () => {
  let m: Integrations;
  let events: RunEventDraft[];
  const ctx = () => ({ onEvent: (e: RunEventDraft) => events.push(e) });

  beforeEach(() => {
    resetMockWorld(new Date("2026-09-25T06:00:00Z"));
    m = createIntegrations("mock");
    events = [];
  });

  it("invoice lifecycle: create, send, record payment, paid", async () => {
    const created = await m.paypal.createInvoice({ clientName: "Sharma Traders", recipientEmail: "s@x.in", description: "Website redesign", amountInr: 15000, intentKey: "k1" }, ctx());
    if (!created.ok) throw new Error("create failed");
    expect(created.value).toMatchObject({ status: "DRAFT", amountInr: 15000, reference: "k1" });
    expect((await m.paypal.recordPayment(created.value.id, { amountInr: 15000 })).ok).toBe(false); // drafts cannot be paid
    await m.paypal.sendInvoice(created.value.id);
    await m.paypal.recordPayment(created.value.id, { amountInr: 15000 });
    const got = await m.paypal.getInvoice(created.value.id);
    expect(got.ok && got.value.status).toBe("MARKED_AS_PAID");
    expect(events.map((e) => e.type)).toEqual(["tool_call", "tool_result"]);
    expect(events[0]).toMatchObject({ integration: "paypal", tool: "invoices.invoicing.invoices.create" });
  });

  it("refunds are blocked by policy and say so in the events", async () => {
    const r = await m.paypal.refundCapture("CAP-1", {}, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("policy_blocked");
    expect(events.map((e) => e.type)).toEqual(["tool_call", "policy", "tool_result"]);
    expect(events[1]).toMatchObject({ decision: "blocked", policyId: "refund-bulk-or-large" });
  });

  it("gmail: unread list shrinks after markProcessed", async () => {
    const before = await m.gmail.listUnread({ max: 10 });
    if (!before.ok) throw new Error("list failed");
    expect(before.value.length).toBe(4);
    const first = before.value[0];
    if (!first) throw new Error("empty inbox");
    const msg = await m.gmail.getMessage(first.id);
    expect(msg.ok && msg.value.subject).toBeTruthy();
    await m.gmail.markProcessed(first.id);
    const after = await m.gmail.listUnread({ max: 10 });
    expect(after.ok && after.value.length).toBe(3);
  });

  it("notion: upsert by intent key is idempotent", async () => {
    const row = { client: "Verma Sweets", clientEmail: null, amountInr: 80000, description: "Reels", invoiceId: null, invoiceUrl: null, status: "Awaiting approval" as const, issued: "2026-09-25", due: null, lastReminder: null, paidOn: null, jiraKey: null, intentKey: "intent-v1" };
    const a = await m.notion.upsertLedgerRow(row);
    const b = await m.notion.upsertLedgerRow({ ...row, status: "Sent" });
    expect(a.ok && a.value.created).toBe(true);
    expect(b.ok && b.value.created).toBe(false);
    expect(a.ok && b.ok && a.value.pageId === b.value.pageId).toBe(true);
    const found = await m.notion.findByIntentKey("intent-v1");
    expect(found.ok && found.value?.status).toBe("Sent");
  });

  it("jira: delivery task can be found by invoice id", async () => {
    await m.jira.createDeliveryTask({ invoiceId: "INV-2026-0131", clientName: "Gupta Electronics", description: "Catalogue", amountInr: 24000 });
    const found = await m.jira.findTaskByInvoiceId("INV-2026-0131");
    expect(found.ok && found.value?.key).toBe("BAHI-17");
    const none = await m.jira.findTaskByInvoiceId("INV-X");
    expect(none.ok && none.value).toBeNull();
  });

  it("slack posts land in the mock world", async () => {
    const r = await m.slack.postOps("hello");
    expect(r.ok && r.value.channelName).toBe("bahi-ops");
    expect(mockWorld().slack.at(-1)?.text).toBe("hello");
  });
});

describe("live adapters build the right Swytchcode calls", () => {
  beforeEach(() => {
    calls.length = 0;
    respond = () => ({});
  });

  it("PayPal create: sandbox body, Prefer header, INR money", async () => {
    respond = () => ({ id: "INV2-1", status: "DRAFT", amount: { currency_code: "INR", value: "15000.00" }, detail: { reference: "k1" } });
    const r = await createPaypalLive().createInvoice({ clientName: "Sharma Traders", recipientEmail: "payer@x.in", description: "Website redesign", amountInr: 15000, intentKey: "k1" });
    expect(r.ok && r.value.amountInr).toBe(15000);
    const [call] = calls;
    expect(call?.tool).toBe("invoices.invoicing.invoices.create");
    expect(call?.input.headers).toEqual({ Prefer: "return=representation" });
    expect(call?.input.body).toMatchObject({
      detail: { currency_code: "INR", reference: "k1" },
      primary_recipients: [{ billing_info: { email_address: "payer@x.in" } }],
      items: [{ quantity: "1", unit_amount: { currency_code: "INR", value: "15000.00" } }],
    });
  });

  it("PayPal cancel deletes drafts and cancels sent invoices", async () => {
    respond = (tool) => (tool === "invoices.invoicing.invoices.get" ? { id: "INV2-1", status: "DRAFT" } : null);
    await createPaypalLive().cancelInvoice("INV2-1");
    expect(calls.map((c) => c.tool)).toEqual(["invoices.invoicing.invoices.get", "invoices.invoicing.invoices.delete"]);
    calls.length = 0;
    respond = (tool) => (tool === "invoices.invoicing.invoices.get" ? { id: "INV2-1", status: "SENT" } : null);
    await createPaypalLive().cancelInvoice("INV2-1");
    expect(calls.map((c) => c.tool)).toEqual(["invoices.invoicing.invoices.get", "invoices.invoicing.invoices.cancel"]);
  });

  it("Slack joins the channel once when the bot is not in it", async () => {
    let posts = 0;
    respond = (tool) => {
      if (tool === "slack.conversations.list.list") return { ok: true, channels: [{ id: "C2", name: "bahi-ops" }] };
      if (tool === "slack.conversations.join.create") return { ok: true };
      posts++;
      return posts === 1 ? { ok: false, error: "not_in_channel" } : { ok: true, channel: "C2", ts: "1.2" };
    };
    const r = await createSlackLive().postOps("hi");
    expect(r.ok && r.value).toMatchObject({ channelId: "C2", channelName: "bahi-ops" });
    expect(calls.map((c) => c.tool)).toEqual(["slack.conversations.list.list", "slack.chat.postmessage.create", "slack.conversations.join.create", "slack.chat.postmessage.create"]);
  });

  it("Slack ok:false becomes a failure, not a success", async () => {
    respond = () => ({ ok: false, error: "invalid_auth" });
    const r = await createSlackLive().resolveChannel("bahi-ops");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("auth");
  });

  it("Gmail send encodes an RFC 822 message as base64url", async () => {
    respond = () => ({ id: "m1", threadId: "t1" });
    await createGmailLive().sendEmail({ to: "a@b.in", subject: "Hi", text: "Body" });
    const body = calls[0]?.input.body as { raw: string };
    expect(calls[0]?.input.params).toEqual({ userId: "me" });
    expect(Buffer.from(body.raw, "base64url").toString("utf8")).toContain("To: a@b.in\r\nSubject: Hi");
  });

  it("Jira search uses JQL on the invoice label", async () => {
    respond = () => ({ issues: [] });
    const r = await createJiraLive().findTaskByInvoiceId("INV2-1");
    expect(r.ok && r.value).toBeNull();
    expect((calls[0]?.input.body as { jql: string }).jql).toContain('labels = "bahi-inv-INV2-1"');
  });

  it("a schema mismatch is a provider error", async () => {
    respond = () => ({ unexpected: true });
    const r = await createJiraLive().getProject();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("provider");
  });
});
