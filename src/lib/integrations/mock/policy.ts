import { getEnv } from "../../env";
import { guardrailConfig } from "../../guardrails/config";
import { buildPolicies, evaluatePolicies, isApprovalGate, type CallInput } from "../../guardrails/policies";
import type { ExecError } from "../../swytch/errors";

/**
 * Mock mode enforces the same generated policies as Swytchcode (same bodies, same rules,
 * Bahi's evaluator that `npm run policies:sync -- --probe` checks against the real kernel).
 * Always in gate mode: there is no Swytchcode HITL to wait for in mock mode.
 */
export function mockPolicyCheck(tool: string, input: CallInput): ExecError | null {
  const d = evaluatePolicies(buildPolicies({ ...guardrailConfig(), approvalMode: "gate" }), tool, input);
  if (d.decision === "allowed") return null;
  const message = `${d.policy.action.message} (mock)`;
  if (isApprovalGate(d.policy.id)) return { kind: "approval_required", approvalVia: "bahi", policyId: d.policy.id, message };
  return { kind: "policy_blocked", policyId: d.policy.id, message, exitCode: 6, category: "policy_denied" };
}

/** Policy ids that target this tool (for the "Swytchcode: policy ok" chip). */
export function mockPoliciesFor(tool: string): string[] {
  void getEnv();
  return buildPolicies({ ...guardrailConfig(), approvalMode: "gate" }).filter((p) => p.target.includes(tool)).map((p) => p.id);
}
