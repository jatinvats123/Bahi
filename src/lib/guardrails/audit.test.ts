import { describe, expect, it } from "vitest";
import type { RunEvent } from "../events";
import { mergeAudit, parseExecLines, parsePolicyLines, runCalls } from "./audit";

// Shapes copied from ~/.swytchcode/audit/2026-09-25.jsonl (swytchcode 2.23.5), request args and headers removed.
const LOG = [
  '{"execution_id":"pol_aa0e02599136","timestamp":"2026-09-25T18:53:00Z","project":"Bahi","tool":"invoices.invoicing.invoices.create","outcome":"policy_violation","duration_ms":0,"policy_decision":"blocked","policy_id":"invoice-approval-over-threshold","policy_operator":"all"}',
  '{"execution_id":"pol_5f253e3d0a71","timestamp":"2026-09-25T18:52:30Z","project":"Bahi","tool":"payments.payment.captures.refund","outcome":"policy_violation","duration_ms":0,"policy_decision":"blocked","policy_id":"block-large-refunds"}',
  '{"execution_id":"exec_1","timestamp":"2026-09-25T18:08:03Z","project":"Bahi","tool":"slack.auth.test.list","outcome":"success","duration_ms":388,"network":[{"id":"nw_1","host":"slack.com","method":"GET","status":200,"duration_ms":333,"category":"exec"}]}',
  '{"execution_id":"exec_2","timestamp":"2026-09-25T18:10:00Z","project":"Bahi","tool":"invoices.invoicing.invoices.get","outcome":"success","duration_ms":2400,"network":[{"status":503,"category":"exec"},{"status":200,"category":"exec"}]}',
  '{"execution_id":"exec_3","timestamp":"2026-09-25T18:11:00Z","project":"OtherProject","tool":"slack.auth.test.list","outcome":"success","duration_ms":10}',
  '{"execution_id":"SWY-ERR-11E1A1","timestamp":"2026-09-25T12:32:58Z","tool":"","outcome":"error","duration_ms":0}',
  "not json",
].join("\n");

describe("Swytchcode audit parsing", () => {
  it("reads decisions, proves blocks never hit the network, and counts retries only when attempts show them", () => {
    const rows = parseExecLines(LOG, "Bahi");
    expect(rows.map((r) => r.id)).toEqual(["pol_aa0e02599136", "pol_5f253e3d0a71", "exec_1", "exec_2"]);
    expect(rows[0]).toMatchObject({ decision: "approval", noNetwork: true, outcome: "held by invoice-approval-over-threshold", integration: "paypal" });
    expect(rows[1]).toMatchObject({ decision: "blocked", noNetwork: true, policyId: "block-large-refunds" });
    expect(rows[2]).toMatchObject({ decision: "allowed", outcome: "HTTP 200", retries: null, ms: 388 });
    expect(rows[3]).toMatchObject({ decision: "allowed", retries: 1 });
  });

  it("reads swy audit policy --json lines", () => {
    const rows = parsePolicyLines(
      [
        '{"id":"6238e10d","tool":"stripe.create_payment","policy_id":"t-approval","status":"failed","requested_at":1790361662,"resolved_at":1790361662}',
        '{"id":"pol_d266d4df2c7c","tool":"gmail.user.send.create1","policy_id":"email-known-clients-only","status":"blocked","requested_at":1790361621}',
      ].join("\n"),
    );
    expect(rows.map((r) => r.decision)).toEqual(["failed", "blocked"]);
    expect(rows[1]).toMatchObject({ integration: "gmail", noNetwork: true });
  });

  it("links Swytchcode rows to live runs by tool and time; mock run calls become their own rows", () => {
    const ev = (runId: string, seq: number, ts: string, e: Record<string, unknown>) => ({ runId, seq, ts, ...e }) as RunEvent;
    const live = {
      runId: "run_live",
      mode: "live" as const,
      events: [
        ev("run_live", 1, "2026-09-25T18:52:29.000Z", { type: "tool_call", callId: "c1", integration: "paypal", tool: "payments.payment.captures.refund", inputSummary: "x" }),
        ev("run_live", 2, "2026-09-25T18:52:30.500Z", { type: "policy", callId: "c1", decision: "blocked", policyId: "block-large-refunds", message: "m" }),
        ev("run_live", 3, "2026-09-25T18:52:30.600Z", { type: "tool_result", callId: "c1", ok: false, summary: "Rok diya", ms: 900, retries: 0 }),
      ],
    };
    const mock = {
      runId: "run_mock",
      mode: "mock" as const,
      events: [
        ev("run_mock", 1, "2026-09-25T10:00:00.000Z", { type: "tool_call", callId: "m1", integration: "slack", tool: "slack.chat.postmessage.create", inputSummary: "x" }),
        ev("run_mock", 2, "2026-09-25T10:00:00.100Z", { type: "tool_result", callId: "m1", ok: true, summary: "ok", ms: 120, retries: 0 }),
      ],
    };
    const merged = mergeAudit(parseExecLines(LOG, "Bahi"), runCalls([live, mock]));
    expect(merged.find((r) => r.id === "pol_5f253e3d0a71")?.runId).toBe("run_live");
    const mockRow = merged.find((r) => r.source === "run");
    expect(mockRow).toMatchObject({ runId: "run_mock", decision: "allowed", outcome: "ok (mock)", retries: null });
  });
});
