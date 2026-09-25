import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApprovalStore } from "./approvals";

const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), "bahi-apr-")), "approvals.json");
const base = { runId: "run_1", callId: "c_1", via: "bahi" as const, policyId: "invoice-approval-over-threshold", tool: "invoices.invoicing.invoices.create", client: "Verma Sweets", amountInr: 80_000, description: "Diwali order", channel: "#approvals", explain: null };

describe("approval store", () => {
  it("creates, decides once, and refuses a second decision", async () => {
    const store = createApprovalStore(tmpFile());
    const a = await store.create({ ...base, timeoutMs: 60_000 });
    expect(a).toMatchObject({ status: "pending", client: "Verma Sweets" });
    expect(a.id).toMatch(/^apr_[0-9a-f]{12}$/);
    expect(await store.decide(a.id, "approved", "Jatin (dashboard)")).toMatchObject({ ok: true, record: { status: "approved", by: "Jatin (dashboard)" } });
    expect(await store.decide(a.id, "denied", "someone")).toMatchObject({ ok: false, reason: "already_decided" });
    expect(await store.decide("apr_000000000000", "approved", "x")).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("expires pending approvals past their deadline", async () => {
    let now = new Date("2026-09-26T06:00:00Z");
    const store = createApprovalStore(tmpFile(), () => now);
    const a = await store.create({ ...base, timeoutMs: 1_000 });
    now = new Date(now.getTime() + 2_000);
    expect((await store.get(a.id))?.status).toBe("expired");
    expect(await store.decide(a.id, "approved", "late")).toMatchObject({ ok: false, reason: "expired" });
  });

  it("wakes a waiter in another process (another store on the same file) and sends heartbeats", async () => {
    const file = tmpFile();
    const server = createApprovalStore(file);
    const script = createApprovalStore(file);
    const a = await script.create({ ...base, timeoutMs: 60_000 });
    const ticks: number[] = [];
    const waiting = script.waitForDecision(a.id, { pollMs: 10, tickMs: 20, onTick: (s) => ticks.push(s) });
    await new Promise((r) => setTimeout(r, 80));
    await server.decide(a.id, "denied", "owner");
    const out = await waiting;
    expect(out).toMatchObject({ status: "denied", by: "owner" });
    expect(ticks.length).toBeGreaterThanOrEqual(1);
  });

  it("expires the approval when the run is stopped", async () => {
    const store = createApprovalStore(tmpFile());
    const a = await store.create({ ...base, timeoutMs: 60_000 });
    const ctl = new AbortController();
    const waiting = store.waitForDecision(a.id, { pollMs: 10, signal: ctl.signal });
    ctl.abort();
    expect((await waiting)?.status).toBe("expired");
  });
});
