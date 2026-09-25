import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "../env";
import { loadSwytchProject } from "../swytch/project";
import { guardrailConfig } from "./config";
import { buildPoliciesFile, explainPolicies, type PolicyExplainer } from "./policies";

export interface GuardrailStatus {
  policies: (PolicyExplainer & { active: boolean })[];
  /** policies.json matches what `npm run policies:sync` would write. */
  inSync: boolean;
  fileMissing: boolean;
  approvalMode: "gate" | "swytchcode";
  approvalTimeoutSec: number;
  idempotency: { library: string; mode: string; header: string | null }[];
}

/** For the Settings Guardrails panel. Never throws. */
export async function guardrailStatus(): Promise<GuardrailStatus> {
  const env = getEnv();
  const cfg = guardrailConfig();
  const dir = env.SWYTCHCODE_PROJECT_DIR ?? process.cwd();
  const expected = `${JSON.stringify(buildPoliciesFile(cfg), null, 2)}\n`;
  let current = "";
  try {
    current = await readFile(/*turbopackIgnore: true*/ path.join(dir, ".swytchcode", "integrations", "policies.json"), "utf8");
  } catch {
    current = "";
  }
  let activeIds = new Set<string>();
  let idempotency: GuardrailStatus["idempotency"] = [];
  try {
    const project = await loadSwytchProject(dir);
    activeIds = new Set(project.policies.map((p) => p.id));
    idempotency = Object.entries(project.manifest)
      .filter(([k]) => project.integrations.has(k))
      .map(([k, v]) => ({ library: k, mode: v.execution_policy?.idempotency?.mode ?? "none", header: v.execution_policy?.idempotency?.header_name ?? null }));
  } catch {
    // no project: everything shows as inactive
  }
  return {
    policies: explainPolicies({ ...cfg, recipientCount: cfg.allowedRecipients.length }).map((p) => ({ ...p, active: activeIds.has(p.id) })),
    inSync: current === expected,
    fileMissing: current === "",
    approvalMode: cfg.approvalMode,
    approvalTimeoutSec: env.APPROVAL_TIMEOUT_SEC,
    idempotency,
  };
}
