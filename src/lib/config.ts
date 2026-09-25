import "server-only";
import { getEnv } from "./env";

/**
 * Non-secret configuration that is safe to pass to client components.
 * Secrets never leave the server: only whether a key is present.
 */
export interface PublicConfig {
  mode: "live" | "mock";
  businessName: string;
  businessEmail: string | null;
  approvalThresholdInr: number;
  refundBlockThresholdInr: number;
  slackOpsChannel: string;
  slackApprovalsChannel: string;
  jiraProjectKey: string;
  laya: { enabled: boolean; url: string };
  models: { gemini: { configured: boolean; model: string | null }; groq: { configured: boolean; model: string | null } };
  notion: { ledgerConfigured: boolean };
}

export function getPublicConfig(): PublicConfig {
  const env = getEnv();
  return {
    mode: env.SWYTCH_MODE,
    businessName: env.BUSINESS_NAME,
    businessEmail: env.BUSINESS_EMAIL ?? null,
    approvalThresholdInr: env.APPROVAL_THRESHOLD_INR,
    refundBlockThresholdInr: env.REFUND_BLOCK_THRESHOLD_INR,
    slackOpsChannel: env.SLACK_OPS_CHANNEL,
    slackApprovalsChannel: env.SLACK_APPROVALS_CHANNEL,
    jiraProjectKey: env.JIRA_PROJECT_KEY,
    laya: { enabled: env.LAYA_ENABLED, url: env.LAYA_URL },
    models: {
      gemini: { configured: Boolean(env.GEMINI_API_KEY), model: env.GEMINI_MODEL ?? null },
      groq: { configured: Boolean(env.GROQ_API_KEY), model: env.GROQ_MODEL ?? null },
    },
    notion: { ledgerConfigured: Boolean(env.NOTION_LEDGER_DATABASE_ID) },
  };
}
