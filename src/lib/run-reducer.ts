import type {
  ApprovalStatus,
  Integration,
  PolicyDecision,
  RunEvent,
  RunStatus,
} from "./events";
import { INTEGRATION_LABEL, isSendTool, toolVerb } from "./verbs";

/**
 * Folds RunEvents into a timeline view model.
 *
 * Robustness rules:
 * - Events are kept sorted by seq and de-duplicated (first delivery of a seq wins),
 *   and the view is re-derived from the sorted list, so out-of-order delivery is harmless.
 * - Events for another runId are ignored.
 * - policy / approval / tool_result events whose tool_call has not arrived yet wait
 *   in the event list and are applied as soon as the tool_call shows up.
 */

export type StampKind = "approved" | "blocked" | "sent" | "awaiting" | "denied" | "expired";

export type ToolState = "running" | "awaiting" | "ok" | "failed" | "blocked" | "denied" | "expired";

interface EntryBase {
  /** Stable React key. */
  key: string;
  seq: number;
  ts: string;
}

export interface ToolEntry extends EntryBase {
  kind: "tool";
  callId: string;
  integration: Integration;
  integrationLabel: string;
  tool: string;
  /** Serif verb shown in the timeline, reflects current state. */
  title: string;
  inputSummary: string;
  state: ToolState;
  stamp: StampKind | null;
  policy: { decision: PolicyDecision; policyId: string; message: string } | null;
  approval: ApprovalInfo | null;
  result: { ok: boolean; summary: string; ms: number; retries: number; tags: string[] } | null;
  updatedTs: string;
}

export type TimelineEntry =
  | (EntryBase & { kind: "started"; command: string; inputMode: "voice" | "text"; mode: "live" | "mock"; replay: ReplayInfo | null })
  | (EntryBase & { kind: "intent"; source: "laya" | "llm"; label: string; confidence: number; ms: number })
  | (EntryBase & { kind: "thinking"; text: string })
  | ToolEntry
  | (EntryBase & { kind: "guard"; flagged: boolean; reason: string; source: "laya" | "llm" | "rules" })
  | (EntryBase & { kind: "speak"; text: string })
  | (EntryBase & { kind: "final"; summary: string })
  | (EntryBase & { kind: "error"; message: string; recoverable: boolean });

/** Present when the run is a playback of a recorded run (AGENT_MODE=replay). */
export interface ReplayInfo {
  scenario: string;
  recordedAt: string;
  sourceRunId: string;
}

/** Everything the approval card shows. Detail fields are null for runs recorded before phase 4. */
export interface ApprovalInfo {
  status: ApprovalStatus;
  channel: string;
  by: string | null;
  approvalId: string | null;
  via: "bahi" | "swytchcode" | null;
  policyId: string | null;
  client: string | null;
  amountInr: number | null;
  description: string | null;
  explain: string | null;
  expiresAt: string | null;
  /** When the approval was first requested. */
  since: string;
  /** When it was decided (approved / denied / expired). */
  decidedAt: string | null;
}

export interface PendingApproval extends ApprovalInfo {
  callId: string;
  tool: string;
  integration: Integration;
  title: string;
  inputSummary: string;
}

export interface RunView {
  runId: string | null;
  command: string | null;
  inputMode: "voice" | "text" | null;
  mode: "live" | "mock" | null;
  /** Non-null for a recorded run played back: never show it as live. */
  replay: ReplayInfo | null;
  status: RunStatus | "idle";
  /** Run-level stamp for the header. */
  stamp: StampKind | null;
  startedAt: string | null;
  endedAt: string | null;
  entries: TimelineEntry[];
  intent: { source: "laya" | "llm"; label: string; confidence: number; ms: number } | null;
  pendingApprovals: PendingApproval[];
  spoken: string[];
  final: string | null;
  error: { message: string; recoverable: boolean } | null;
  guardFlagged: boolean;
  lastSeq: number;
  /** seq numbers below lastSeq that have not arrived. Non-empty means the view may be incomplete. */
  missingSeqs: number[];
}

export interface RunState {
  runId: string | null;
  events: RunEvent[];
  view: RunView;
}

export type RunAction =
  | { type: "event"; event: RunEvent }
  | { type: "events"; events: RunEvent[] }
  | { type: "reset" };

/** Never mutate: fold builds fresh arrays for every view. */
export const emptyRunView: RunView = {
  runId: null,
  command: null,
  inputMode: null,
  mode: null,
  replay: null,
  status: "idle",
  stamp: null,
  startedAt: null,
  endedAt: null,
  entries: [],
  intent: null,
  pendingApprovals: [],
  spoken: [],
  final: null,
  error: null,
  guardFlagged: false,
  lastSeq: 0,
  missingSeqs: [],
};

export const initialRunState: RunState = { runId: null, events: [], view: emptyRunView };

function toolTitle(e: ToolEntry): string {
  const verb = toolVerb(e.tool, e.integration);
  switch (e.state) {
    case "ok":
      return verb.done;
    case "awaiting":
      return "Approval ka intezaar";
    case "blocked":
      return "Rok diya gaya: policy";
    case "denied":
      return "Approval nahi mila";
    case "expired":
      return "Approval ka samay khatam";
    case "failed":
      return `${e.integrationLabel} ka kaam nahi hua`;
    case "running":
      return verb.running;
  }
}

function toolStamp(e: ToolEntry): StampKind | null {
  if (e.state === "blocked") return "blocked";
  if (e.state === "denied") return "denied";
  if (e.state === "expired") return "expired";
  if (e.approval?.status === "pending") return "awaiting";
  if (e.approval?.status === "approved") return "approved";
  if (e.state === "ok" && isSendTool(e.tool)) return "sent";
  return null;
}

/** Insert keeping seq order; drops events whose seq is already present. */
function insertSorted(events: RunEvent[], event: RunEvent): RunEvent[] {
  if (events.some((e) => e.seq === event.seq)) return events;
  const next = [...events];
  let i = next.length;
  while (i > 0 && (next[i - 1]?.seq ?? 0) > event.seq) i--;
  next.splice(i, 0, event);
  return next;
}

/** Derive the view from events. Accepts any order; sorts and de-duplicates. */
export function foldRunEvents(input: readonly RunEvent[]): RunView {
  let events: RunEvent[] = [];
  const runId = input[0]?.runId ?? null;
  for (const e of input) if (e.runId === runId) events = insertSorted(events, e);
  if (events.length === 0) return emptyRunView;

  const view: RunView = { ...emptyRunView, runId, entries: [], spoken: [], pendingApprovals: [], missingSeqs: [] };
  const tools = new Map<string, ToolEntry>();
  const pending = new Map<string, PendingApproval>();
  let blocked = false;
  let denied = false;
  let expired = false;
  let failed = false;
  let anyApproved = false;
  let anySent = false;

  for (const ev of events) {
    const key = `seq-${ev.seq}`;
    switch (ev.type) {
      case "run_started":
        view.command = ev.command;
        view.inputMode = ev.inputMode;
        view.mode = ev.mode;
        view.startedAt = ev.ts;
        view.replay = ev.replay ?? null;
        view.entries.push({ key, seq: ev.seq, ts: ev.ts, kind: "started", command: ev.command, inputMode: ev.inputMode, mode: ev.mode, replay: view.replay });
        break;
      case "intent":
        view.intent = { source: ev.source, label: ev.label, confidence: ev.confidence, ms: ev.ms };
        view.entries.push({ key, seq: ev.seq, ts: ev.ts, kind: "intent", source: ev.source, label: ev.label, confidence: ev.confidence, ms: ev.ms });
        break;
      case "thinking":
        view.entries.push({ key, seq: ev.seq, ts: ev.ts, kind: "thinking", text: ev.text });
        break;
      case "tool_call": {
        if (tools.has(ev.callId)) break;
        const entry: ToolEntry = {
          key: `call-${ev.callId}`,
          seq: ev.seq,
          ts: ev.ts,
          kind: "tool",
          callId: ev.callId,
          integration: ev.integration,
          integrationLabel: INTEGRATION_LABEL[ev.integration],
          tool: ev.tool,
          title: "",
          inputSummary: ev.inputSummary,
          state: "running",
          stamp: null,
          policy: null,
          approval: null,
          result: null,
          updatedTs: ev.ts,
        };
        tools.set(ev.callId, entry);
        view.entries.push(entry);
        break;
      }
      case "policy": {
        const entry = tools.get(ev.callId);
        if (!entry) break;
        entry.policy = { decision: ev.decision, policyId: ev.policyId, message: ev.message };
        entry.updatedTs = ev.ts;
        if (ev.decision === "blocked") {
          entry.state = "blocked";
          blocked = true;
        } else if (ev.decision === "approval_required" && entry.state === "running") {
          entry.state = "awaiting";
        }
        break;
      }
      case "approval": {
        const entry = tools.get(ev.callId);
        if (!entry) break;
        const prev = entry.approval;
        // Later events may carry fewer details (e.g. "approved" by id only): keep what we knew.
        entry.approval = {
          status: ev.status,
          channel: ev.channel,
          by: ev.by ?? prev?.by ?? null,
          approvalId: ev.approvalId ?? prev?.approvalId ?? null,
          via: ev.via ?? prev?.via ?? null,
          policyId: ev.policyId ?? prev?.policyId ?? (entry.policy?.decision === "approval_required" ? entry.policy.policyId : null),
          client: ev.client ?? prev?.client ?? null,
          amountInr: ev.amountInr ?? prev?.amountInr ?? null,
          description: ev.description ?? prev?.description ?? null,
          explain: ev.explain ?? prev?.explain ?? null,
          expiresAt: ev.expiresAt ?? prev?.expiresAt ?? null,
          since: prev?.since ?? ev.ts,
          decidedAt: ev.status === "pending" ? null : ev.ts,
        };
        entry.updatedTs = ev.ts;
        if (ev.status === "pending") {
          if (entry.state !== "running" && entry.state !== "awaiting") break;
          entry.state = "awaiting";
          pending.set(ev.callId, {
            ...entry.approval,
            callId: ev.callId,
            tool: entry.tool,
            integration: entry.integration,
            title: toolVerb(entry.tool, entry.integration).running,
            inputSummary: entry.inputSummary,
          });
        } else {
          pending.delete(ev.callId);
          if (ev.status === "approved") {
            anyApproved = true;
            if (entry.state === "awaiting") entry.state = "running";
          } else if (ev.status === "denied") {
            entry.state = "denied";
            denied = true;
          } else {
            entry.state = "expired";
            expired = true;
          }
        }
        break;
      }
      case "tool_result": {
        const entry = tools.get(ev.callId);
        if (!entry) break;
        entry.result = { ok: ev.ok, summary: ev.summary, ms: ev.ms, retries: ev.retries, tags: ev.tags ?? [] };
        entry.updatedTs = ev.ts;
        if (entry.state !== "blocked" && entry.state !== "denied" && entry.state !== "expired") {
          entry.state = ev.ok ? "ok" : "failed";
        }
        break;
      }
      case "guard":
        if (ev.flagged) view.guardFlagged = true;
        view.entries.push({ key, seq: ev.seq, ts: ev.ts, kind: "guard", flagged: ev.flagged, reason: ev.reason, source: ev.source });
        break;
      case "speak":
        view.spoken.push(ev.text);
        view.entries.push({ key, seq: ev.seq, ts: ev.ts, kind: "speak", text: ev.text });
        break;
      case "final":
        view.final = ev.summary;
        view.endedAt = ev.ts;
        view.entries.push({ key, seq: ev.seq, ts: ev.ts, kind: "final", summary: ev.summary });
        break;
      case "heartbeat":
        // Keep-alive only: nothing to show.
        break;
      case "error":
        view.error = { message: ev.message, recoverable: ev.recoverable };
        if (!ev.recoverable) {
          failed = true;
          view.endedAt = ev.ts;
        }
        view.entries.push({ key, seq: ev.seq, ts: ev.ts, kind: "error", message: ev.message, recoverable: ev.recoverable });
        break;
    }
  }

  for (const entry of tools.values()) {
    entry.title = toolTitle(entry);
    entry.stamp = toolStamp(entry);
    if (entry.stamp === "sent") anySent = true;
  }

  view.pendingApprovals = [...pending.values()];
  view.lastSeq = events[events.length - 1]?.seq ?? 0;
  const present = new Set(events.map((e) => e.seq));
  for (let s = 1; s < view.lastSeq; s++) if (!present.has(s)) view.missingSeqs.push(s);

  if (failed) view.status = "failed";
  else if (blocked) view.status = "blocked";
  else if (denied) view.status = "denied";
  else if (expired) view.status = "expired";
  else if (view.pendingApprovals.length > 0) view.status = "awaiting_approval";
  else if (view.final !== null) view.status = "completed";
  else view.status = "running";

  view.stamp =
    view.status === "blocked" ? "blocked"
    : view.status === "denied" ? "denied"
    : view.status === "expired" ? "expired"
    : view.status === "awaiting_approval" ? "awaiting"
    : anyApproved ? "approved"
    : view.status === "completed" && anySent ? "sent"
    : null;

  return view;
}

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "reset":
      return initialRunState;
    case "event":
      return runReducer(state, { type: "events", events: [action.event] });
    case "events": {
      let runId = state.runId;
      let events = state.events;
      for (const event of action.events) {
        runId ??= event.runId;
        if (event.runId !== runId) continue;
        events = insertSorted(events, event);
      }
      if (events === state.events) return state;
      return { runId, events, view: foldRunEvents(events) };
    }
  }
}
