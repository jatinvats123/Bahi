import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import clientsJson from "@fixtures/clients.json";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RunEvent, RunEventDraft } from "../events";
import { createApprovalStore } from "../guardrails/approvals";
import { foldRunEvents } from "../run-reducer";
import { createIntegrations } from "../integrations";
import { mockWorld, resetMockWorld } from "../integrations/mock/world";
import { ClientSchema } from "../ledger";
import { createAgentTools, createRunState, invoiceIntentKey, type AgentToolContext } from "./tools";

const NOW = new Date("2026-09-25T06:00:00Z");
const clients = clientsJson.map((c) => ClientSchema.parse(c));

function setup(command: string) {
  const events: RunEventDraft[] = [];
  const ctx: AgentToolContext = {
    integrations: createIntegrations("mock"),
    emit: (e) => events.push(e),
    command,
    clients,
    config: { businessName: "DukaanSetu", approvalThresholdInr: 50_000, opsChannel: "bahi-ops", approvalsChannel: "approvals" },
    now: () => NOW,
    state: createRunState(),
  };
  const tools = createAgentTools(ctx);
  const exec = async (name: keyof typeof tools, input: unknown): Promise<Record<string, unknown>> => {
    const t = tools[name] as unknown as { execute: (i: unknown, o: unknown) => Promise<Record<string, unknown>>; inputSchema: z.ZodType };
    return t.execute(t.inputSchema.parse(input), { toolCallId: "t1", messages: [] });
  };
  return { tools, exec, events, ctx };
}

const toolCallsIn = (events: RunEventDraft[]) => events.filter((e) => e.type === "tool_call").map((e) => (e.type === "tool_call" ? e.tool : ""));

beforeEach(() => {
  resetMockWorld(NOW);
});

describe("tool schemas", () => {
  it("declares every tool the prompt and eval rely on, each with a description and a zod schema", () => {
    const { tools } = setup("x");
    expect(Object.keys(tools).sort()).toEqual(
      [
        "check_invoice_status",
        "create_and_send_invoice",
        "daily_brief",
        "final_answer",
        "find_client",
        "get_ledger",
        "list_inbox",
        "mark_email_processed",
        "mark_paid_and_start_delivery",
        "notify_team",
        "read_email",
        "refund_payment",
        "send_payment_reminder",
      ].sort(),
    );
    for (const [name, t] of Object.entries(tools)) {
      expect(typeof t.description, name).toBe("string");
      expect((t.description ?? "").length, name).toBeGreaterThan(20);
      expect(t.inputSchema, name).toBeInstanceOf(z.ZodType);
    }
  });

  it("validates inputs strictly", () => {
    const { tools } = setup("x");
    const invoice = tools.create_and_send_invoice.inputSchema as unknown as z.ZodType;
    expect(invoice.safeParse({ clientId: "cl_sharma", amountInr: -5, description: "x" }).success).toBe(false);
    expect(invoice.safeParse({ clientId: "cl_sharma", amountInr: 15000, description: "website redesign" }).success).toBe(true);
    const parsed = invoice.parse({ clientId: "cl_sharma", amountInr: 15000, description: "website redesign" }) as { dueInDays: number };
    expect(parsed.dueInDays).toBe(7);
    const notify = tools.notify_team.inputSchema as unknown as z.ZodType;
    expect(notify.safeParse({ kind: "shout", text: "hello" }).success).toBe(false);
    const ledger = tools.get_ledger.inputSchema as unknown as z.ZodType;
    expect(ledger.safeParse({ filter: "late" }).success).toBe(false);
  });
});

describe("find_client", () => {
  it("resolves Hinglish names and never invents a client", async () => {
    const { exec } = setup("x");
    expect(await exec("find_client", { name: "sharma ji" })).toMatchObject({ status: "matched", client: { clientId: "cl_sharma" } });
    const unknown = await exec("find_client", { name: "Mehta Motors" });
    expect(unknown.status).toBe("not_found");
  });
});

describe("create_and_send_invoice", () => {
  it("makes one Swytchcode call per real step: PayPal create, PayPal send, Notion row", async () => {
    const { exec, events } = setup("Sharma Traders ko website redesign ke liye 15,000 ka invoice bhejo");
    const r = await exec("create_and_send_invoice", { clientId: "cl_sharma", amountInr: 15000, amountPhrase: "15,000", description: "website redesign" });
    expect(r).toMatchObject({ ok: true, status: "sent", amountInr: 15000, due: "2026-10-02" });
    expect(toolCallsIn(events)).toEqual(["notion.query.create", "invoices.invoicing.invoices.create", "invoices.invoicing.send.create", "notion.page.create"]);
    const row = [...mockWorld().ledger.values()].find((x) => x.invoiceId === r.invoiceId);
    expect(row).toMatchObject({ status: "Sent", amountInr: 15000, intentKey: invoiceIntentKey("cl_sharma", 15000, "website redesign", "2026-09-25") });
  });

  it("rejects a model amount that differs from the owner's words, before any call", async () => {
    const { exec, events } = setup("Sharma ko pandrah hazaar ka invoice bhejo");
    const r = await exec("create_and_send_invoice", { clientId: "cl_sharma", amountInr: 1500, description: "Services" });
    expect(r).toMatchObject({ ok: false, error: "amount_mismatch" });
    expect(toolCallsIn(events)).toEqual([]);
  });

  it("does not send the same invoice twice in one run", async () => {
    const { exec, events } = setup("Sharma ko 15000 ka invoice bhejo");
    await exec("create_and_send_invoice", { clientId: "cl_sharma", amountInr: 15000, description: "Services" });
    const again = await exec("create_and_send_invoice", { clientId: "cl_sharma", amountInr: 15000, description: "Services" });
    expect(again.note).toMatch(/not sent twice/);
    expect(toolCallsIn(events).filter((t) => t === "invoices.invoicing.invoices.create")).toHaveLength(1);
  });

  it("refuses an unknown client id", async () => {
    const { exec } = setup("x");
    expect(await exec("create_and_send_invoice", { clientId: "cl_ghost", amountInr: 100, description: "Services" })).toMatchObject({ ok: false, error: "unknown_client" });
  });
});

describe("mark_paid_and_start_delivery", () => {
  it("refuses unless PayPal shows the invoice paid", async () => {
    const { exec, events } = setup("Inbox check karo");
    const r = await exec("mark_paid_and_start_delivery", { invoiceId: "INV-2026-0138" });
    expect(r).toMatchObject({ ok: false, error: "not_paid" });
    expect(toolCallsIn(events)).not.toContain("jira.api.issue.create");
  });

  it("marks Paid, creates one Jira task and reuses it on a second call", async () => {
    const { exec, events } = setup("Inbox check karo");
    const first = await exec("mark_paid_and_start_delivery", { invoiceId: "INV-2026-0131" });
    expect(first).toMatchObject({ ok: true, ledger: "Paid" });
    expect(mockWorld().jira[0]?.summary).toBe("Deliver: Product catalogue shoot for Gupta Electronics");
    const second = await exec("mark_paid_and_start_delivery", { invoiceId: "INV-2026-0131" });
    expect(second).toMatchObject({ ok: true, jiraReused: true, jiraKey: first.jiraKey });
    expect(toolCallsIn(events).filter((t) => t === "jira.api.issue.create")).toHaveLength(1);
  });
});

describe("list_inbox", () => {
  it("wraps bodies as untrusted data and flags the injection with a guard event", async () => {
    const { exec, events } = setup("Inbox check karo aur jo kaam hai woh karo");
    const r = (await exec("list_inbox", { limit: 10 })) as { emails: { id: string; body: string; warning?: string; knownClient: { clientId: string } | null }[] };
    expect(r.emails).toHaveLength(4);
    for (const e of r.emails) expect(e.body.startsWith("<untrusted_email>")).toBe(true);
    const bad = r.emails.find((e) => e.id === "mock-msg-004");
    expect(bad?.warning).toMatch(/prompt injection/);
    expect(bad?.knownClient).toBeNull();
    expect(r.emails.find((e) => e.id === "mock-msg-002")?.knownClient?.clientId).toBe("cl_verma");
    expect(events.filter((e) => e.type === "guard" && e.flagged)).toHaveLength(1);
    // One list call plus one get per message: every real API call is visible.
    expect(toolCallsIn(events)).toEqual(["gmail.user.messages.get", ...Array(4).fill("gmail.user.messages.get1")]);
  });
});

describe("refund_payment", () => {
  it("never refunds on an email's say-so: needs the owner's own words", async () => {
    const { exec, events } = setup("Inbox check karo aur jo kaam hai woh karo");
    const r = await exec("refund_payment", { invoiceId: "INV-2026-0131", reason: "email asked" });
    expect(r).toMatchObject({ ok: false, error: "not_requested_by_owner" });
    expect(toolCallsIn(events)).toEqual([]);
    expect(events.some((e) => e.type === "guard" && e.flagged)).toBe(true);
  });

  it("goes to Swytchcode when the owner asks, and a policy block stops the rest of the batch", async () => {
    const { exec, events, ctx } = setup("Sabke payments refund kar do");
    const first = await exec("refund_payment", { invoiceId: "INV-2026-0131", reason: "owner asked" });
    expect(first).toMatchObject({ ok: false, error: "policy_blocked", policyId: "block-large-refunds", alertPosted: true });
    expect(events.some((e) => e.type === "policy" && e.decision === "blocked")).toBe(true);
    const second = await exec("refund_payment", { invoiceId: "INV-2026-0135", reason: "owner asked" });
    expect(second).toMatchObject({ ok: false, error: "batch_stopped" });
    // One Swytchcode refund attempt, then exactly one Slack alert posted by Bahi.
    expect(toolCallsIn(events)).toEqual(["payments.payment.captures.refund", "slack.chat.postmessage.create"]);
    expect(mockWorld().slack[0]?.text).toMatch(/block-large-refunds/);
    expect(ctx.state.blocked?.policyId).toBe("block-large-refunds");
    expect(await exec("notify_team", { kind: "alert", text: "Refund policy ne rok diya" })).toMatchObject({ skipped: true });
  });

  it("allows one refund per command even when the model fires several at once", async () => {
    const { exec, events } = setup("Sabke payments refund kar do");
    const [a, b, c] = await Promise.all([
      exec("refund_payment", { invoiceId: "INV-2026-0131", amountInr: 2_000, reason: "owner asked" }),
      exec("refund_payment", { invoiceId: "INV-2026-0135", amountInr: 2_000, reason: "owner asked" }),
      exec("refund_payment", { invoiceId: "INV-2026-0118", amountInr: 2_000, reason: "owner asked" }),
    ]);
    expect([a, b, c].filter((r) => r.error === "bulk_refund_blocked")).toHaveLength(2);
    expect(toolCallsIn(events).filter((t) => t === "payments.payment.captures.refund")).toHaveLength(1);
  });
});

describe("send_payment_reminder", () => {
  it("emails the client, records the reminder, and skips a second one the same day", async () => {
    const { exec, events } = setup("Kaun late hai? Sabko yaad dilao");
    const r = await exec("send_payment_reminder", { clientId: "cl_verma", invoiceId: "INV-2026-0127", message: "Namaste Neha ji, a gentle reminder." });
    expect(r).toMatchObject({ ok: true, ledger: "Last reminder set to 2026-09-25" });
    expect(mockWorld().sent[0]?.text).toContain("Amount: ₹32,000");
    const again = await exec("send_payment_reminder", { clientId: "cl_verma", invoiceId: "INV-2026-0127", message: "Namaste Neha ji, a gentle reminder." });
    expect(again).toMatchObject({ skipped: true });
    expect(toolCallsIn(events).filter((t) => t === "gmail.user.send.create1")).toHaveLength(1);
  });

  it("refuses to chase a paid invoice", async () => {
    const { exec } = setup("yaad dilao");
    expect(await exec("send_payment_reminder", { clientId: "cl_gupta", invoiceId: "INV-2026-0118", message: "Please pay the invoice." })).toMatchObject({ error: "already_paid" });
  });
});

describe("get_ledger and daily_brief", () => {
  it("overdue is verified against PayPal", async () => {
    const { exec, events } = setup("Kaun late hai?");
    const r = (await exec("get_ledger", { filter: "overdue" })) as { invoices: { invoiceId: string; daysLate: number }[] };
    expect(r.invoices.map((i) => i.invoiceId).sort()).toEqual(["INV-2026-0124", "INV-2026-0127"]);
    expect(r.invoices.find((i) => i.invoiceId === "INV-2026-0124")?.daysLate).toBe(8);
    expect(toolCallsIn(events).filter((t) => t === "invoices.invoicing.invoices.get").length).toBeGreaterThanOrEqual(2);
  });

  it("brief numbers match the ledger", async () => {
    const { exec } = setup("Aaj ka hisaab batao");
    expect(await exec("daily_brief", {})).toMatchObject({ toReceiveInr: 69_000, overdueInr: 50_500, overdueCount: 2, receivedTodayInr: 33_500 });
  });
});

describe("notify_team", () => {
  it("allows one summary per run and de-duplicates alerts", async () => {
    const { exec } = setup("x");
    expect(await exec("notify_team", { kind: "update", text: "Done: invoice sent" })).toMatchObject({ ok: true, channel: "#bahi-ops" });
    expect(await exec("notify_team", { kind: "update", text: "Another update" })).toMatchObject({ ok: false, error: "already_posted" });
    await exec("notify_team", { kind: "alert", text: "Suspicious email" });
    expect(await exec("notify_team", { kind: "alert", text: "Suspicious email" })).toMatchObject({ skipped: true });
    expect(mockWorld().slack).toHaveLength(2);
  });
});

describe("approval desk (S2) and repeated commands", () => {
  function withDesk(command: string, decide: "approved" | "denied" | "none") {
    const s = setup(command);
    const store = createApprovalStore(path.join(mkdtempSync(path.join(tmpdir(), "bahi-desk-")), "approvals.json"));
    s.ctx.approvals = { store, timeoutMs: decide === "none" ? 150 : 10_000, dashboardUrl: "http://localhost:3000", pollMs: 10, heartbeatMs: 20 };
    if (decide !== "none") {
      const timer = setInterval(() => {
        void store.list().then(async (list) => {
          const p = list.find((a) => a.status === "pending");
          if (p) {
            clearInterval(timer);
            await store.decide(p.id, decide, "owner (test)");
          }
        });
      }, 15);
    }
    return { ...s, store };
  }
  const input = { clientId: "cl_verma", amountInr: 80_000, amountPhrase: "80,000", description: "Diwali mithai order" };

  it("approved: AWAITING -> APPROVED on one timeline entry, then the stamped invoice is created and sent", async () => {
    const { exec, events } = withDesk("Verma Sweets ko 80,000 ka invoice bhejo", "approved");
    const r = await exec("create_and_send_invoice", input);
    expect(r).toMatchObject({ ok: true, status: "sent", approvedBy: "owner (test)" });
    const approvals = events.filter((e) => e.type === "approval");
    expect(approvals.map((e) => e.type === "approval" && e.status)).toEqual(["pending", "approved"]);
    expect(approvals[0]).toMatchObject({ client: "Verma Sweets", amountInr: 80_000, policyId: "invoice-approval-over-threshold", via: "bahi" });
    const view = foldRunEvents(stamp(events));
    const entry = view.entries.find((e) => e.kind === "tool" && e.tool === "invoices.invoicing.invoices.create");
    expect(entry?.kind === "tool" && entry.stamp).toBe("approved");
    expect(entry?.kind === "tool" && entry.state).toBe("ok");
    expect(view.stamp).toBe("approved");
    expect(mockWorld().slack.some((m) => m.channelName === "approvals" && /Verma Sweets/.test(m.text))).toBe(true);
    const row = [...mockWorld().ledger.values()].find((x) => x.invoiceId === r.invoiceId);
    expect(row?.status).toBe("Sent");
    expect([...mockWorld().invoices.values()].filter((i) => i.recipientName === "Verma Sweets" && i.amountInr === 80_000)).toHaveLength(1);
  });

  it("denied: DENIED stamp, no invoice in PayPal, ledger row Cancelled", async () => {
    const { exec, events } = withDesk("Verma Sweets ko 80,000 ka invoice bhejo", "denied");
    const r = await exec("create_and_send_invoice", input);
    expect(r).toMatchObject({ ok: false, error: "approval_denied" });
    expect([...mockWorld().invoices.values()].some((i) => i.amountInr === 80_000)).toBe(false);
    expect([...mockWorld().ledger.values()].find((x) => x.amountInr === 80_000)?.status).toBe("Cancelled");
    const view = foldRunEvents(stamp(events));
    expect(view.status).toBe("denied");
    expect(view.stamp).toBe("denied");
  });

  it("expired: EXPIRED stamp after the approval window, with heartbeats while waiting", async () => {
    const { exec, events } = withDesk("Verma Sweets ko 80,000 ka invoice bhejo", "none");
    const r = await exec("create_and_send_invoice", input);
    expect(r).toMatchObject({ ok: false, error: "approval_expired" });
    expect(events.some((e) => e.type === "heartbeat")).toBe(true);
    const view = foldRunEvents(stamp(events));
    expect(view.status).toBe("expired");
    expect(view.pendingApprovals).toHaveLength(0);
  });

  it("a repeated S1 in a new run creates no second invoice and says so with an idempotent tag", async () => {
    const first = setup("Sharma Traders ko website redesign ke liye 15,000 ka invoice bhejo");
    const a = await first.exec("create_and_send_invoice", { clientId: "cl_sharma", amountInr: 15000, amountPhrase: "15,000", description: "website redesign" });
    expect(a.status).toBe("sent");
    const second = setup("Sharma ji ko 15k ka invoice bhejo website redesign ke liye");
    const b = await second.exec("create_and_send_invoice", { clientId: "cl_sharma", amountInr: 15000, amountPhrase: "15k", description: "Website Redesign" });
    expect(b).toMatchObject({ ok: true, status: "already_done", idempotent: true, invoiceId: a.invoiceId });
    expect(toolCallsIn(second.events)).toEqual(["notion.query.create"]);
    const tagged = second.events.find((e) => e.type === "tool_result" && e.tags?.includes("idempotent"));
    expect(tagged?.type === "tool_result" && tagged.summary).toMatch(/already bheja ja chuka hai/);
    expect([...mockWorld().invoices.values()].filter((i) => i.reference === a.intentKey || i.recipientName === "Sharma Traders" && i.amountInr === 15000)).toHaveLength(1);
  });
});

/** Give drafts runId/seq/ts so the reducer can fold them. */
function stamp(drafts: RunEventDraft[]): RunEvent[] {
  return drafts.map((d, i) => ({ ...d, runId: "run_t", seq: i + 1, ts: new Date(Date.UTC(2026, 8, 26, 6, 0, i)).toISOString() }) as RunEvent);
}

describe("draft reuse", () => {
  it("a draft left by a failed send is sent again, not created twice", async () => {
    const { exec, events } = setup("Sharma Traders ko website redesign ke liye 15,000 ka invoice bhejo");
    const key = invoiceIntentKey("cl_sharma", 15000, "website redesign", "2026-09-25");
    const w = mockWorld();
    w.invoices.set("INV2-DRAFT-1", { id: "INV2-DRAFT-1", number: "INV2-DRAFT-1", status: "DRAFT", currency: "INR", amount: 15000, amountInr: 15000, recipientEmail: "s@x.in", recipientName: "Sharma Traders", payUrl: null, dueDate: "2026-10-02", reference: key, paidAmount: null });
    w.ledger.set("mock-page-draft", { pageId: "mock-page-draft", client: "Sharma Traders", clientEmail: "s@x.in", amountInr: 15000, description: "website redesign", invoiceId: "INV2-DRAFT-1", invoiceUrl: null, status: "Draft", issued: "2026-09-25", due: "2026-10-02", lastReminder: null, paidOn: null, jiraKey: null, intentKey: key, url: null });
    const r = await exec("create_and_send_invoice", { clientId: "cl_sharma", amountInr: 15000, amountPhrase: "15,000", description: "website redesign" });
    expect(r).toMatchObject({ ok: true, status: "sent", invoiceId: "INV2-DRAFT-1" });
    expect(toolCallsIn(events)).not.toContain("invoices.invoicing.invoices.create");
    expect(w.ledger.get("mock-page-draft")?.status).toBe("Sent");
  });
});
