import "server-only";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { Integration, RunEvent } from "../events";
import { toolById } from "../swytch/tools";
import { getApprovalStore, type ApprovalRecord } from "./approvals";
import { isApprovalGate } from "./policies";

/**
 * The Audit tab: Swytchcode's own audit trail merged with Bahi's run events.
 *
 * Sources (swytchcode 2.23.5):
 * - `swy audit policy --json`: one JSON line per policy decision (blocked, hitl, approved,
 *   rejected, expired, failed) with id, tool, policy_id, status, requested_at.
 * - ~/.swytchcode/audit/<UTC date>.jsonl: the execution log `swy audit network|stats` read.
 *   One record per exec with outcome, duration_ms and a `network` array of the real HTTP
 *   attempts; a policy block has outcome "policy_violation" and no network entries (the
 *   provider was never called). Retries = exec attempts - 1, only when Swytchcode shows them.
 *   Records also hold request args (can contain emails): Bahi never reads them into the UI.
 * - data/runs.json (Bahi run events) and data/approvals.json (Bahi approval desk).
 */

export type AuditDecision = "allowed" | "approval" | "blocked" | "failed";

export interface AuditRow {
  id: string;
  ts: string;
  tool: string;
  integration: Integration | null;
  decision: AuditDecision;
  /** Short result: "HTTP 201", "blocked by block-large-refunds", "approved by Owner". */
  outcome: string;
  policyId: string | null;
  ms: number | null;
  /** Only when Swytchcode reported more than one HTTP attempt. */
  retries: number | null;
  /** True for policy blocks the log proves never reached the provider. */
  noNetwork: boolean;
  runId: string | null;
  /** swytchcode = seen in the Swytchcode log; run = Bahi run event only (mock runs); desk = Bahi approval desk. */
  source: "swytchcode" | "run" | "desk";
}

const NetworkSchema = z.object({ status: z.number().optional(), duration_ms: z.number().optional(), category: z.string().optional() }).loose();
const ExecRecordSchema = z
  .object({
    execution_id: z.string(),
    timestamp: z.string(),
    project: z.string().optional(),
    tool: z.string(),
    outcome: z.string(),
    duration_ms: z.number().optional(),
    policy_decision: z.string().optional(),
    policy_id: z.string().optional(),
    network: z.array(NetworkSchema).optional(),
  })
  .loose();
const PolicyLineSchema = z.object({ id: z.string(), tool: z.string(), policy_id: z.string(), status: z.string(), requested_at: z.number(), resolved_at: z.number().optional() }).loose();

function integrationOf(tool: string): Integration | null {
  return toolById(tool)?.integration ?? null;
}

/** Parse execution-log lines (pure; exported for tests). */
export function parseExecLines(text: string, project: string | null): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec: z.infer<typeof ExecRecordSchema>;
    try {
      const p = ExecRecordSchema.safeParse(JSON.parse(line));
      if (!p.success) continue;
      rec = p.data;
    } catch {
      continue;
    }
    if (!rec.tool || (project && rec.project && rec.project !== project)) continue;
    const attempts = (rec.network ?? []).filter((n) => (n.category ?? "exec") === "exec");
    const last = attempts.at(-1);
    let decision: AuditDecision;
    let outcome: string;
    if (rec.outcome === "policy_violation") {
      decision = isApprovalGate(rec.policy_id) ? "approval" : rec.policy_decision === "hitl" ? "approval" : "blocked";
      outcome = decision === "approval" ? `held by ${rec.policy_id ?? "policy"}` : `blocked by ${rec.policy_id ?? "policy"}`;
    } else {
      const status = last?.status;
      decision = rec.outcome === "success" && (!status || status < 400) ? "allowed" : "failed";
      // No HTTP attempt at all: a dry run or explain (or a failure before the network).
      outcome = status ? `HTTP ${status}` : rec.outcome === "success" ? "dry run / explain, no network call" : `${rec.outcome} before any network call`;
    }
    rows.push({
      id: rec.execution_id,
      ts: new Date(rec.timestamp).toISOString(),
      tool: rec.tool,
      integration: integrationOf(rec.tool),
      decision,
      outcome,
      policyId: rec.policy_id ?? null,
      ms: typeof rec.duration_ms === "number" ? rec.duration_ms : null,
      retries: attempts.length > 1 ? attempts.length - 1 : null,
      noNetwork: rec.outcome === "policy_violation" && attempts.length === 0,
      runId: null,
      source: "swytchcode",
    });
  }
  return rows;
}

/** Parse `swy audit policy --json` output (pure; exported for tests). */
export function parsePolicyLines(text: string): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const p = PolicyLineSchema.safeParse(JSON.parse(line));
      if (!p.success) continue;
      const e = p.data;
      const decision: AuditDecision =
        e.status === "blocked" ? (isApprovalGate(e.policy_id) ? "approval" : "blocked")
        : e.status === "hitl" ? "approval"
        : e.status === "approved" ? "allowed"
        : e.status === "failed" ? "failed"
        : "blocked";
      rows.push({
        id: e.id,
        ts: new Date(e.requested_at * 1000).toISOString(),
        tool: e.tool,
        integration: integrationOf(e.tool),
        decision,
        outcome: e.status === "blocked" ? `${decision === "approval" ? "held" : "blocked"} by ${e.policy_id}` : `${e.status} (${e.policy_id})`,
        policyId: e.policy_id,
        ms: 0,
        retries: null,
        noNetwork: e.status === "blocked",
        runId: null,
        source: "swytchcode",
      });
    } catch {
      // skip
    }
  }
  return rows;
}

interface RunCall {
  runId: string;
  tool: string;
  integration: Integration;
  callTs: number;
  endTs: number;
  decision: AuditDecision;
  policyId: string | null;
  ms: number | null;
  retries: number;
  ok: boolean | null;
  mode: "live" | "mock";
}

/** Every Swytchcode call inside Bahi runs (pure; exported for tests). */
export function runCalls(runs: { runId: string; mode: "live" | "mock"; events: RunEvent[] }[]): RunCall[] {
  const out: RunCall[] = [];
  for (const run of runs) {
    const byCall = new Map<string, RunCall>();
    for (const e of run.events) {
      if (e.type === "tool_call") {
        const existing = byCall.get(e.callId);
        if (existing) continue;
        const c: RunCall = { runId: run.runId, tool: e.tool, integration: e.integration, callTs: Date.parse(e.ts), endTs: Date.parse(e.ts), decision: "allowed", policyId: null, ms: null, retries: 0, ok: null, mode: run.mode };
        byCall.set(e.callId, c);
        out.push(c);
      } else if (e.type === "policy") {
        const c = byCall.get(e.callId);
        if (!c) continue;
        if (e.decision === "blocked") c.decision = isApprovalGate(e.policyId) ? "approval" : "blocked";
        else if (e.decision === "approval_required") c.decision = "approval";
        c.policyId = e.policyId;
      } else if (e.type === "tool_result") {
        const c = byCall.get(e.callId);
        if (!c) continue;
        c.endTs = Date.parse(e.ts);
        c.ms = e.ms;
        c.retries = e.retries;
        c.ok = e.ok;
        if (!e.ok && c.decision === "allowed") c.decision = "failed";
      }
    }
  }
  return out;
}

/** Link Swytchcode rows to runs by tool and time; add run-only rows (mock runs) for calls with no match. */
export function mergeAudit(swy: AuditRow[], calls: RunCall[]): AuditRow[] {
  const used = new Set<RunCall>();
  const rows = swy.map((r) => {
    const t = Date.parse(r.ts);
    const hit = calls.find((c) => !used.has(c) && c.tool === r.tool && c.mode === "live" && t >= c.callTs - 3_000 && t <= c.endTs + 5_000);
    if (!hit) return r;
    used.add(hit);
    return { ...r, runId: hit.runId };
  });
  for (const c of calls) {
    if (used.has(c) || c.mode === "live") continue;
    rows.push({
      id: `${c.runId}:${c.callTs}:${c.tool}`,
      ts: new Date(c.callTs).toISOString(),
      tool: c.tool,
      integration: c.integration,
      decision: c.decision,
      outcome: c.decision === "blocked" ? `blocked by ${c.policyId ?? "policy"} (mock)` : c.decision === "approval" ? `held by ${c.policyId ?? "policy"} (mock)` : c.ok === false ? "failed (mock)" : "ok (mock)",
      policyId: c.policyId,
      ms: c.ms,
      retries: c.retries > 0 ? c.retries : null,
      noNetwork: c.decision === "blocked" || c.decision === "approval",
      runId: c.runId,
      source: "run",
    });
  }
  return rows;
}

export function deskRows(approvals: ApprovalRecord[]): AuditRow[] {
  return approvals.map((a) => ({
    id: a.id,
    ts: a.decidedAt ?? a.createdAt,
    tool: a.tool,
    integration: integrationOf(a.tool),
    decision: a.status === "approved" ? "allowed" : a.status === "pending" ? "approval" : "blocked",
    outcome: a.status === "pending" ? "waiting for the owner" : a.status === "approved" ? `approved by ${a.by ?? "owner"}` : a.status === "denied" ? `denied by ${a.by ?? "owner"}` : "expired, not run",
    policyId: a.policyId,
    ms: a.decidedAt ? Date.parse(a.decidedAt) - Date.parse(a.createdAt) : null,
    retries: null,
    noNetwork: a.status !== "approved",
    runId: a.runId,
    source: "desk",
  }));
}

async function readExecLog(project: string, maxFiles = 3): Promise<AuditRow[]> {
  const dir = path.join(homedir(), ".swytchcode", "audit");
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().slice(-maxFiles);
  } catch {
    return [];
  }
  const rows: AuditRow[] = [];
  for (const f of files) {
    try {
      rows.push(...parseExecLines(await readFile(path.join(dir, f), "utf8"), project));
    } catch {
      // unreadable file: skip
    }
  }
  return rows;
}

export interface AuditData {
  rows: AuditRow[];
  swytchcodeAvailable: boolean;
  note: string | null;
}

/** Everything for the Audit tab, newest first. Never throws. */
export async function loadAudit(opts: { projectDir: string; runs: { runId: string; mode: "live" | "mock"; events: RunEvent[] }[]; limit?: number; policyCli?: () => Promise<string> }): Promise<AuditData> {
  const project = path.basename(opts.projectDir);
  const exec = await readExecLog(project);
  let policyRows: AuditRow[] = [];
  let note: string | null = null;
  if (opts.policyCli) {
    try {
      policyRows = parsePolicyLines(await opts.policyCli());
    } catch {
      note = "swy audit policy could not be read.";
    }
  }
  // Policy blocks appear in both sources with the same id; the exec log has more detail.
  const execIds = new Set(exec.map((r) => r.id));
  const swy = [...exec, ...policyRows.filter((r) => !execIds.has(r.id))];
  const merged = mergeAudit(swy, runCalls(opts.runs));
  const desk = deskRows(await getApprovalStore().list().catch(() => []));
  const rows = [...merged, ...desk].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, opts.limit ?? 300);
  return { rows, swytchcodeAvailable: exec.length + policyRows.length > 0, note };
}
