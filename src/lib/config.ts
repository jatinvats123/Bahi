import "server-only";
import { DEFAULT_GEMINI_MODELS, DEFAULT_GROQ_MODELS } from "./agent/defaults";
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
  /** Jira Cloud site for "browse" links (not a secret). */
  jiraBaseUrl: string | null;
  laya: { enabled: boolean; url: string };
  /** model: the effective comma-separated chain (env value or the default). */
  models: { gemini: { configured: boolean; backupKey: boolean; model: string }; groq: { configured: boolean; model: string } };
  notion: { ledgerConfigured: boolean };
  swytch: { transport: "cli" | "sdk"; paypalCurrency: "INR" | "USD"; inrPerUsd: number };
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
    jiraBaseUrl: env.JIRA_BASE_URL ?? null,
    laya: { enabled: env.LAYA_ENABLED, url: env.LAYA_URL },
    models: {
      gemini: { configured: Boolean(env.GEMINI_API_KEY), backupKey: Boolean(env.GEMINI_API_KEY_BACKUP), model: env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODELS },
      groq: { configured: Boolean(env.GROQ_API_KEY), model: env.GROQ_MODEL ?? DEFAULT_GROQ_MODELS },
    },
    notion: { ledgerConfigured: Boolean(env.NOTION_LEDGER_DATABASE_ID || env.NOTION_LEDGER_DATA_SOURCE_ID) },
    swytch: { transport: env.SWYTCH_TRANSPORT, paypalCurrency: env.PAYPAL_CURRENCY, inrPerUsd: env.DEMO_INR_PER_USD },
  };
}
