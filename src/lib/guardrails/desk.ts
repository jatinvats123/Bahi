import "server-only";
import type { RunEventDraft } from "../events";
import { formatINR } from "../format";
import type { CallCtx, SlackAdapter } from "../integrations/types";
import type { ApprovalRecord, ApprovalStore } from "./approvals";

/**
 * The approval flow for one held call, shared by live and mock mode:
 * create the approval, show it (approval pending event with the card details), notify
 * Slack #approvals through Swytchcode, wait with heartbeats, then emit the decision.
 *
 * via "bahi": the Swytchcode gate policy blocked the call; the owner decides on the Bahi
 * dashboard (or `npm run approve`). via "swytchcode": Swytchcode HITL holds the call and the
 * decision is read from `swy audit policy` (APPROVAL_MODE=swytchcode, paid plans).
 */

export interface HoldRequest {
  callId: string;
  runId: string | null;
  policyId: string;
  tool: string;
  client: string;
  amountInr: number;
  description: string;
  via: "bahi" | "swytchcode";
  swytchcodeRequestId?: string | null;
}

export interface DeskDeps {
  emit: (event: RunEventDraft) => void;
  slack: SlackAdapter;
  store: ApprovalStore;
  timeoutMs: number;
  /** Slack channel name without #. */
  channel: string;
  /** Where the owner approves, e.g. http://localhost:3000. */
  dashboardUrl: string;
  signal?: AbortSignal;
  /** Plain-language line for what runs if approved (swy exec --explain), best effort. */
  explain?: () => Promise<string | null>;
  /** APPROVAL_MODE=swytchcode: read a HITL request's status from the Swytchcode audit log. */
  swytchcodeStatus?: (requestId: string) => Promise<"hitl" | "approved" | "rejected" | "expired" | "failed" | null>;
  heartbeatMs?: number;
  pollMs?: number;
}

export function approvalSlackText(r: Pick<ApprovalRecord, "id" | "client" | "amountInr" | "description" | "policyId" | "via">, dashboardUrl: string, businessName?: string): string {
  const lines = [
    `Approval chahiye${businessName ? ` (${businessName})` : ""}: ${r.client} ke liye ${formatINR(r.amountInr)} ka invoice (${r.description}).`,
    `Swytchcode policy \`${r.policyId}\` ne ise PayPal tak jaane se pehle rok rakha hai.`,
  ];
  if (r.via === "bahi") {
    lines.push(`Approve ya mana karein: ${dashboardUrl}/?approval=${r.id}`);
    lines.push(`Terminal se: npm run approve -- ${r.id}   (mana karne ke liye: npm run approve -- ${r.id} --deny)`);
  } else {
    lines.push("Is channel mein Swytchcode ke Approve / Deny button dabayein.");
  }
  return lines.join("\n");
}

const WAIT_LABEL = "approval";

export async function holdForApproval(req: HoldRequest, deps: DeskDeps, businessName?: string): Promise<ApprovalRecord | null> {
  const { emit, store } = deps;
  const channel = `#${deps.channel}`;
  const explain = deps.explain ? await Promise.race([deps.explain().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 8_000))]) : null;

  const record = await store.create({
    runId: req.runId,
    callId: req.callId,
    via: req.via,
    policyId: req.policyId,
    tool: req.tool,
    client: req.client,
    amountInr: req.amountInr,
    description: req.description,
    channel,
    explain,
    timeoutMs: deps.timeoutMs,
    swytchcodeRequestId: req.swytchcodeRequestId ?? null,
  });

  emit({
    type: "approval",
    callId: req.callId,
    status: "pending",
    channel,
    approvalId: record.id,
    via: req.via,
    policyId: req.policyId,
    client: req.client,
    amountInr: req.amountInr,
    description: req.description,
    ...(explain ? { explain } : {}),
    expiresAt: record.expiresAt,
  });

  // Notify the approvers. A Slack failure does not cancel the approval: the dashboard still works.
  const ctx: CallCtx = { onEvent: emit };
  const posted = await deps.slack.postApproval(approvalSlackText(record, deps.dashboardUrl, businessName), ctx);
  if (!posted.ok) emit({ type: "thinking", text: `Slack #${deps.channel} mein approval ka message nahi gaya (${posted.error.message}). Dashboard se approve kar sakte hain.` });

  let final: ApprovalRecord | null;
  if (req.via === "swytchcode" && req.swytchcodeRequestId && deps.swytchcodeStatus) {
    final = await waitForSwytchcode(record, req.swytchcodeRequestId, deps);
  } else {
    final = await store.waitForDecision(record.id, {
      signal: deps.signal,
      pollMs: deps.pollMs,
      tickMs: deps.heartbeatMs ?? 10_000,
      onTick: (waitedSec) => emit({ type: "heartbeat", waitingFor: WAIT_LABEL, waitedSec }),
    });
  }

  const status = final?.status ?? "expired";
  if (status === "pending") return final;
  emit({
    type: "approval",
    callId: req.callId,
    status,
    channel,
    approvalId: record.id,
    ...(final?.by ? { by: final.by } : {}),
  });
  return final ?? { ...record, status: "expired", decidedAt: new Date().toISOString() };
}

async function waitForSwytchcode(record: ApprovalRecord, requestId: string, deps: DeskDeps): Promise<ApprovalRecord | null> {
  const started = Date.now();
  const deadline = Date.parse(record.expiresAt);
  let lastTick = started;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  while (Date.now() < deadline) {
    if (deps.signal?.aborted) return deps.store.expire(record.id);
    const s = await deps.swytchcodeStatus?.(requestId).catch(() => null);
    if (s === "approved") return (await deps.store.decide(record.id, "approved", "Slack (Swytchcode)")).record ?? null;
    if (s === "rejected") return (await deps.store.decide(record.id, "denied", "Slack (Swytchcode)")).record ?? null;
    if (s === "expired" || s === "failed") return deps.store.expire(record.id);
    if (Date.now() - lastTick >= (deps.heartbeatMs ?? 10_000)) {
      lastTick = Date.now();
      deps.emit({ type: "heartbeat", waitingFor: WAIT_LABEL, waitedSec: (Date.now() - started) / 1000 });
    }
    await sleep(deps.pollMs ?? 3_000);
  }
  return deps.store.expire(record.id);
}
