import { describe, expect, it } from "vitest";
import type { RunEvent } from "./events";
import { getScript, materializeScript } from "./fixtures";
import { foldRunEvents, initialRunState, runReducer, type RunState, type ToolEntry } from "./run-reducer";

const START = new Date("2026-09-26T08:44:00Z");

function events(scriptId: string, runId = "run_test"): RunEvent[] {
  return materializeScript(getScript(scriptId), { runId, startedAt: START });
}

function dispatchAll(list: RunEvent[], state: RunState = initialRunState): RunState {
  return list.reduce((s, event) => runReducer(s, { type: "event", event }), state);
}

function tool(state: RunState, callId: string): ToolEntry {
  const entry = state.view.entries.find((e): e is ToolEntry => e.kind === "tool" && e.callId === callId);
  if (!entry) throw new Error(`no tool entry ${callId}`);
  return entry;
}

/** Deterministic shuffle (LCG) so the test is reproducible. */
function shuffle<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe("run-reducer: S2 approval flow", () => {
  const s2 = events("s2-approval");
  const seqOf = (pred: (e: RunEvent) => boolean) => s2.find(pred)?.seq ?? -1;
  const pendingSeq = seqOf((e) => e.type === "approval" && e.status === "pending");
  const approvedSeq = seqOf((e) => e.type === "approval" && e.status === "approved");

  it("folds the full sequence into a completed, approved run", () => {
    const state = dispatchAll(s2);
    const v = state.view;

    expect(v.runId).toBe("run_test");
    expect(v.command).toBe("Verma Sweets ko 80,000 ka invoice bhejo");
    expect(v.mode).toBe("mock");
    expect(v.status).toBe("completed");
    expect(v.stamp).toBe("approved");
    expect(v.pendingApprovals).toEqual([]);
    expect(v.intent).toMatchObject({ source: "llm", label: "create_invoice", confidence: 0.94 });
    expect(v.spoken).toEqual(["Verma Sweets ko ₹80,000 ka invoice bhej diya. Approval mil gaya tha."]);
    expect(v.final).toMatch(/INV-2026-0142/);
    expect(v.endedAt).toBe(s2.at(-1)?.ts);
    expect(v.lastSeq).toBe(s2.length);
    expect(v.missingSeqs).toEqual([]);

    expect(v.entries.map((e) => e.kind)).toEqual([
      "started", "intent", "thinking", "tool", "tool", "thinking", "tool", "tool", "tool", "speak", "final",
    ]);

    const create = tool(state, "c2");
    expect(create).toMatchObject({
      state: "ok",
      title: "Invoice banaya",
      stamp: "approved",
      integrationLabel: "PayPal",
      policy: { decision: "approval_required", policyId: "invoice-approval-over-threshold" },
      approval: { status: "approved", channel: "#approvals", by: "Jatin" },
      result: { ok: true, retries: 1, ms: 734 },
    });
    expect(tool(state, "c3")).toMatchObject({ state: "ok", title: "Invoice bheja", stamp: "sent" });
    expect(tool(state, "c1")).toMatchObject({ state: "ok", title: "Client mila", stamp: null });
  });

  it("shows AWAITING while the approval is pending", () => {
    const state = dispatchAll(s2.filter((e) => e.seq <= pendingSeq));
    expect(state.view.status).toBe("awaiting_approval");
    expect(state.view.stamp).toBe("awaiting");
    expect(state.view.pendingApprovals).toHaveLength(1);
    expect(state.view.pendingApprovals[0]).toMatchObject({ callId: "c2", channel: "#approvals", tool: "paypal.invoice.create" });
    expect(tool(state, "c2")).toMatchObject({ state: "awaiting", title: "Approval ka intezaar", stamp: "awaiting" });
  });

  it("switches to APPROVED and keeps running once approved", () => {
    const state = dispatchAll(s2.filter((e) => e.seq <= approvedSeq));
    expect(state.view.status).toBe("running");
    expect(state.view.stamp).toBe("approved");
    expect(state.view.pendingApprovals).toEqual([]);
    expect(tool(state, "c2")).toMatchObject({ state: "running", title: "Invoice bana raha hoon", stamp: "approved" });
  });

  it("produces the same view regardless of delivery order", () => {
    const inOrder = dispatchAll(s2).view;
    for (const seed of [1, 7, 42, 2026]) {
      expect(dispatchAll(shuffle(s2, seed)).view).toEqual(inOrder);
    }
    expect(dispatchAll([...s2].reverse()).view).toEqual(inOrder);
  });

  it("holds a tool_result until its tool_call arrives, and reports the gap", () => {
    const call = s2.find((e) => e.type === "tool_call" && e.callId === "c1");
    const result = s2.find((e) => e.type === "tool_result" && e.callId === "c1");
    if (!call || !result) throw new Error("fixture changed");

    let state = dispatchAll(s2.filter((e) => e.seq < call.seq));
    state = runReducer(state, { type: "event", event: result });
    expect(state.view.entries.some((e) => e.kind === "tool")).toBe(false);
    expect(state.view.missingSeqs).toEqual([call.seq]);

    state = runReducer(state, { type: "event", event: call });
    expect(tool(state, "c1")).toMatchObject({ state: "ok", title: "Client mila" });
    expect(state.view.missingSeqs).toEqual([]);
  });

  it("ignores duplicate seqs and other runs", () => {
    const state = dispatchAll(s2);
    expect(runReducer(state, { type: "event", event: s2[3] as RunEvent })).toBe(state);
    const stranger = events("s1-invoice", "run_other")[0] as RunEvent;
    expect(runReducer(state, { type: "event", event: { ...stranger, seq: 999 } })).toBe(state);
  });

  it("accepts a batch and resets", () => {
    const batched = runReducer(initialRunState, { type: "events", events: s2 });
    expect(batched.view).toEqual(dispatchAll(s2).view);
    expect(runReducer(batched, { type: "reset" })).toBe(initialRunState);
  });
});

describe("run-reducer: other outcomes", () => {
  it("S2 denied ends DENIED with nothing sent", () => {
    const state = dispatchAll(events("s2-denied"));
    expect(state.view.status).toBe("denied");
    expect(state.view.stamp).toBe("denied");
    expect(tool(state, "c2")).toMatchObject({ state: "denied", title: "Approval nahi mila", stamp: "denied" });
  });

  it("S5 refund is BLOCKED by policy and the run stays blocked after final", () => {
    const state = dispatchAll(events("s5-refund-blocked"));
    expect(state.view.status).toBe("blocked");
    expect(state.view.stamp).toBe("blocked");
    expect(tool(state, "c2")).toMatchObject({ state: "blocked", title: "Rok diya gaya: policy", stamp: "blocked", result: null });
  });

  it("S3 records a flagged guard event", () => {
    const view = foldRunEvents(events("s3-inbox"));
    expect(view.guardFlagged).toBe(true);
    expect(view.status).toBe("completed");
  });

  it("a non-recoverable error fails the run", () => {
    const base = events("s1-invoice").slice(0, 3);
    const err: RunEvent = { type: "error", runId: "run_test", seq: 4, ts: START.toISOString(), message: "PayPal down", recoverable: false };
    const view = foldRunEvents([...base, err]);
    expect(view.status).toBe("failed");
    expect(view.error).toEqual({ message: "PayPal down", recoverable: false });
  });

  it("an empty event list is idle", () => {
    expect(foldRunEvents([]).status).toBe("idle");
  });
});
