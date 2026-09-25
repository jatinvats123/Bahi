import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRunEventLine, type RunEvent } from "../events";
import { foldRunEvents } from "../run-reducer";
import { SCENARIOS, matchScenario } from "../scenarios";
import { createSanitizeContext, findLeaks, RecordingIndexSchema, replayDelays, restamp, sanitizeRunEvents } from "./recording";

const T0 = Date.parse("2026-09-25T20:41:50.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

function ev(seq: number, s: number, body: Record<string, unknown>): RunEvent {
  return { runId: "run_real", seq, ts: at(s), ...body } as RunEvent;
}

describe("sanitizeRunEvents", () => {
  const raw: RunEvent[] = [
    ev(1, 0, { type: "run_started", command: "Verma ko reminder", inputMode: "text", mode: "live" }),
    ev(2, 1, { type: "tool_call", callId: "c1", integration: "gmail", tool: "gmail.user.send.create1", inputSummary: "real.person+verma@gmail.com: Payment reminder (INV2-AB12-CD34-EF56-GH78)" }),
    ev(3, 2, { type: "heartbeat", waitingFor: "approval", waitedSec: 10 }),
    ev(4, 3, { type: "tool_call", callId: "c2", integration: "gmail", tool: "gmail.user.messages.get1", inputSummary: "1a0da533340a7261" }),
    ev(5, 4, { type: "tool_call", callId: "c3", integration: "notion", tool: "notion.query.create", inputSummary: "intent bahi-2edbd7248855b2f0" }),
    ev(6, 5, { type: "guard", flagged: true, reason: "Email from accounts-desk@pay-verify.example and stranger@corp.com", source: "rules" }),
    ev(7, 6, { type: "final", summary: "Reminder for INV2-AB12-CD34-EF56-GH78 sent to real.person+verma@gmail.com" }),
  ];
  const ctx = createSanitizeContext([["Real.Person+verma@gmail.com", "orders@vermasweets.example"]]);
  const out = sanitizeRunEvents(ctx, raw, "rec_s4");

  it("drops heartbeats and renumbers seq, keeping timestamps", () => {
    expect(out.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out.every((e) => e.runId === "rec_s4")).toBe(true);
    expect(out.map((e) => e.type)).not.toContain("heartbeat");
    expect(out[1]?.ts).toBe(at(1));
  });

  it("maps known addresses to fixture placeholders and invents neutral ones for strangers", () => {
    const text = JSON.stringify(out);
    expect(text).toContain("orders@vermasweets.example");
    expect(text).not.toMatch(/gmail\.com|corp\.com/);
    expect(text).toContain("accounts-desk@pay-verify.example");
    expect(text).toMatch(/someone\d+@example\.com/);
  });

  it("replaces PayPal and Gmail ids consistently, keeps intent keys", () => {
    const text = JSON.stringify(out);
    expect(text.match(/INV2-DEMO-0001-BAHI-RPLY/g)).toHaveLength(2);
    expect(text).not.toContain("AB12");
    expect(text).toContain("msg-001");
    expect(text).toContain("bahi-2edbd7248855b2f0");
    expect(findLeaks(out)).toEqual([]);
    expect(findLeaks(raw)).toEqual(expect.arrayContaining(["real.person+verma@gmail.com", "INV2-AB12-CD34-EF56-GH78"]));
  });
});

describe("replay timing", () => {
  const events: RunEvent[] = [
    ev(1, 0, { type: "run_started", command: "x", inputMode: "text", mode: "live" }),
    ev(2, 0, { type: "thinking", text: "a" }),
    ev(3, 10, { type: "thinking", text: "b" }),
    ev(4, 10.5, { type: "approval", callId: "c1", status: "pending", channel: "#approvals", expiresAt: at(310.5) }),
    ev(5, 11, { type: "approval", callId: "c1", status: "approved", channel: "#approvals" }),
  ];

  it("clamps gaps, holds an approval long enough to see AWAITING, and scales by speed", () => {
    expect(replayDelays(events)).toEqual([0, 90, 2200, 500, 3200]);
    expect(replayDelays(events, { speed: 2 })).toEqual([0, 45, 1100, 250, 1600]);
    expect(replayDelays(events, { speed: 8 }).at(-1)).toBe(1500);
  });

  it("restamps with the new runId and shifts expiresAt by the same offset", () => {
    const now = new Date("2026-09-26T09:00:00.000Z");
    const e = restamp(events[3]!, "rpl_1", now);
    expect(e.runId).toBe("rpl_1");
    expect(e.ts).toBe(now.toISOString());
    expect(e.type === "approval" && e.expiresAt).toBe("2026-09-26T09:05:00.000Z");
  });
});

describe("matchScenario", () => {
  it("routes every demo command to its own recording", () => {
    for (const s of SCENARIOS) {
      const expected = s.id === "S2-deny" ? "S2" : s.id;
      expect(matchScenario(s.command, 50_000), s.command).toBe(expected);
    }
  });

  it("handles spoken variants and refuses what it cannot match", () => {
    expect(matchScenario("verma ji ko assi hazaar ka bill bhejo", 50_000)).toBe("S2");
    expect(matchScenario("Gupta ko 5k ka invoice", 50_000)).toBe("S1");
    expect(matchScenario("kaun kaun overdue hai", 50_000)).toBe("S4");
    expect(matchScenario("mail dekho", 50_000)).toBe("S3");
    expect(matchScenario("aaj ka hisab", 50_000)).toBe("S6");
    expect(matchScenario("invoice bhejo", 50_000)).toBeNull();
    expect(matchScenario("chai banao", 50_000)).toBeNull();
  });
});

describe("committed recordings (fixtures/runs)", () => {
  const dir = path.join(process.cwd(), "fixtures", "runs");
  const index = RecordingIndexSchema.parse(JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")));
  const load = (file: string) =>
    readFileSync(path.join(dir, file), "utf8")
      .split("\n")
      .map(parseRunEventLine)
      .filter((e): e is RunEvent => e !== null);

  it("has a recording for every scenario, from a live run, with no real data left", () => {
    expect(index.recordings.map((r) => r.scenario).sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
    for (const meta of index.recordings) {
      const events = load(meta.file);
      expect(events, meta.file).toHaveLength(meta.events);
      expect(meta.mode).toBe("live");
      expect(findLeaks(events), meta.file).toEqual([]);
    }
  });

  it("each recording folds to the outcome its scenario promises", () => {
    const view = (id: string) => foldRunEvents(load(index.recordings.find((r) => r.scenario === id)!.file));
    expect(view("S1")).toMatchObject({ status: "completed", stamp: "sent" });
    expect(view("S2")).toMatchObject({ status: "completed", stamp: "approved" });
    expect(view("S2-deny")).toMatchObject({ status: "denied", stamp: "denied" });
    expect(view("S3")).toMatchObject({ status: "completed", guardFlagged: true });
    expect(view("S4").entries.some((e) => e.kind === "tool" && e.tool === "gmail.user.send.create1" && e.state === "ok")).toBe(true);
    expect(view("S5")).toMatchObject({ status: "blocked", stamp: "blocked" });
    expect(view("S6").spoken.length).toBeGreaterThan(0);
  });
});
