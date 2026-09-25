import "server-only";
import { getClientDirectory } from "../clients";
import { getClients } from "../fixtures";
import { getEnv } from "../env";
import type { GuardrailConfig } from "./policies";

/** The guardrail settings for this install: env thresholds + the client directory's emails. */
export function guardrailConfig(): GuardrailConfig {
  const env = getEnv();
  return {
    approvalThresholdInr: env.APPROVAL_THRESHOLD_INR,
    refundBlockThresholdInr: env.REFUND_BLOCK_THRESHOLD_INR,
    inrPerUsd: env.DEMO_INR_PER_USD,
    // The directory (with data/clients.local.json overrides) plus the committed placeholder
    // addresses, so mock mode and tests agree whether or not a local overrides file exists.
    allowedRecipients: [...new Set([...getClientDirectory(), ...getClients()].map((c) => c.email.toLowerCase()))],
    approvalMode: env.APPROVAL_MODE,
  };
}
