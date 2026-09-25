import { z } from "zod";

/**
 * RunEvent: the contract between the server orchestrator and the browser.
 * The server emits these as NDJSON over a POST fetch stream; the browser folds
 * them with run-reducer.ts. Run history in data/runs.json stores them verbatim.
 *
 * Every event carries runId, seq (1-based, strictly increasing per run) and ts (ISO 8601).
 * Changing a shape here means updating run-reducer.ts and its tests in the same change.
 */

export const INTEGRATIONS = ["paypal", "gmail", "slack", "notion", "jira"] as const;
export const IntegrationSchema = z.enum(INTEGRATIONS);
export type Integration = z.infer<typeof IntegrationSchema>;

export const RUN_STATUSES = [
  "running",
  "awaiting_approval",
  "completed",
  "blocked",
  "denied",
  "expired",
  "failed",
] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

const base = {
  runId: z.string().min(1),
  seq: z.number().int().positive(),
  ts: z.iso.datetime({ offset: true }),
};

export const RunStartedEventSchema = z.object({
  ...base,
  type: z.literal("run_started"),
  command: z.string(),
  inputMode: z.enum(["voice", "text"]),
  mode: z.enum(["live", "mock"]),
  /**
   * Set only when the server plays back a recorded run (AGENT_MODE=replay). `mode` is the mode
   * the run was recorded in; the UI must label the run "Recorded run", never as live.
   * Optional (added in phase 5), so older runs still parse.
   */
  replay: z
    .object({
      /** Scenario id of the recording, e.g. "S1" or "S2-deny". */
      scenario: z.string().min(1),
      /** When the original run started. */
      recordedAt: z.iso.datetime({ offset: true }),
      /** runId of the original live run. */
      sourceRunId: z.string().min(1),
    })
    .optional(),
});

export const IntentEventSchema = z.object({
  ...base,
  type: z.literal("intent"),
  source: z.enum(["laya", "llm"]),
  label: z.string(),
  confidence: z.number().min(0).max(1),
  ms: z.number().nonnegative(),
});

export const ThinkingEventSchema = z.object({
  ...base,
  type: z.literal("thinking"),
  text: z.string(),
});

export const ToolCallEventSchema = z.object({
  ...base,
  type: z.literal("tool_call"),
  callId: z.string().min(1),
  integration: IntegrationSchema,
  /** Swytchcode canonical tool id, e.g. "invoices.invoicing.invoices.create" (see src/lib/swytch/tools.ts). */
  tool: z.string().min(1),
  inputSummary: z.string(),
});

export const ToolResultEventSchema = z.object({
  ...base,
  type: z.literal("tool_result"),
  callId: z.string().min(1),
  ok: z.boolean(),
  summary: z.string(),
  ms: z.number().nonnegative(),
  /** Retries Swytchcode reported for this call. 0 unless it actually reported some. */
  retries: z.number().int().nonnegative(),
  /** Small labels for the timeline, e.g. "idempotent". Optional (added in phase 4). */
  tags: z.array(z.string()).optional(),
});

export const PolicyDecisionSchema = z.enum(["allowed", "approval_required", "blocked"]);
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const PolicyEventSchema = z.object({
  ...base,
  type: z.literal("policy"),
  callId: z.string().min(1),
  decision: PolicyDecisionSchema,
  policyId: z.string(),
  message: z.string(),
});

export const ApprovalStatusSchema = z.enum(["pending", "approved", "denied", "expired"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalEventSchema = z.object({
  ...base,
  type: z.literal("approval"),
  callId: z.string().min(1),
  status: ApprovalStatusSchema,
  /** Where the approval was requested, e.g. "#approvals". */
  channel: z.string(),
  /** Who decided, when known. */
  by: z.string().optional(),
  // Phase 4 details for the approval card (all optional, so older runs still parse).
  /** Bahi approval id (apr_...), used by the approve / deny buttons. */
  approvalId: z.string().optional(),
  /** Who holds the call: Bahi's approval desk (Swytchcode gate policy) or Swytchcode HITL. */
  via: z.enum(["bahi", "swytchcode"]).optional(),
  policyId: z.string().optional(),
  client: z.string().optional(),
  amountInr: z.number().optional(),
  description: z.string().optional(),
  /** Plain-language line from swy exec --explain: what runs if approved. */
  explain: z.string().optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});

/** Keep-alive while the run waits (e.g. for an approval). The reducer ignores it. */
export const HeartbeatEventSchema = z.object({
  ...base,
  type: z.literal("heartbeat"),
  /** What the run is waiting for, e.g. "approval". */
  waitingFor: z.string(),
  /** Seconds waited so far. */
  waitedSec: z.number().nonnegative(),
});

export const GuardEventSchema = z.object({
  ...base,
  type: z.literal("guard"),
  flagged: z.boolean(),
  reason: z.string(),
  source: z.enum(["laya", "llm", "rules"]),
});

export const SpeakEventSchema = z.object({
  ...base,
  type: z.literal("speak"),
  text: z.string(),
});

export const FinalEventSchema = z.object({
  ...base,
  type: z.literal("final"),
  summary: z.string(),
});

export const ErrorEventSchema = z.object({
  ...base,
  type: z.literal("error"),
  message: z.string(),
  recoverable: z.boolean(),
});

export const RunEventSchema = z.discriminatedUnion("type", [
  RunStartedEventSchema,
  IntentEventSchema,
  ThinkingEventSchema,
  ToolCallEventSchema,
  ToolResultEventSchema,
  PolicyEventSchema,
  ApprovalEventSchema,
  GuardEventSchema,
  SpeakEventSchema,
  FinalEventSchema,
  ErrorEventSchema,
  HeartbeatEventSchema,
]);

export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventType = RunEvent["type"];
export type RunEventOf<T extends RunEventType> = Extract<RunEvent, { type: T }>;

/** An event before the orchestrator stamps runId, seq and ts on it. */
export type RunEventDraft = RunEvent extends infer E
  ? E extends RunEvent
    ? Omit<E, "runId" | "seq" | "ts">
    : never
  : never;

export const RunEventDraftSchema = z.discriminatedUnion("type", [
  RunStartedEventSchema.omit({ runId: true, seq: true, ts: true }),
  IntentEventSchema.omit({ runId: true, seq: true, ts: true }),
  ThinkingEventSchema.omit({ runId: true, seq: true, ts: true }),
  ToolCallEventSchema.omit({ runId: true, seq: true, ts: true }),
  ToolResultEventSchema.omit({ runId: true, seq: true, ts: true }),
  PolicyEventSchema.omit({ runId: true, seq: true, ts: true }),
  ApprovalEventSchema.omit({ runId: true, seq: true, ts: true }),
  GuardEventSchema.omit({ runId: true, seq: true, ts: true }),
  SpeakEventSchema.omit({ runId: true, seq: true, ts: true }),
  FinalEventSchema.omit({ runId: true, seq: true, ts: true }),
  ErrorEventSchema.omit({ runId: true, seq: true, ts: true }),
  HeartbeatEventSchema.omit({ runId: true, seq: true, ts: true }),
]);

/** Parse one NDJSON line. Returns null (never throws) for blank or invalid lines. */
export function parseRunEventLine(line: string): RunEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = RunEventSchema.safeParse(JSON.parse(trimmed));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Serialize one event as an NDJSON line (with trailing newline). */
export function toNdjsonLine(event: RunEvent): string {
  return `${JSON.stringify(event)}\n`;
}
