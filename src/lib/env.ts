import "server-only";
import { z } from "zod";

/**
 * Server environment, validated with zod. Read it only through getEnv().
 * Empty strings count as "not set" so a copied .env.example works as-is.
 * Error messages name the variable and the fix, never the secret value.
 */

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(blankToUndefined, z.string().optional());
const withDefault = (fallback: string) => z.preprocess(blankToUndefined, z.string().default(fallback));
const inr = (fallback: number) =>
  z.preprocess(
    blankToUndefined,
    z.coerce.number({ error: "must be a whole rupee amount, e.g. 50000" }).int("must be a whole rupee amount").positive("must be greater than 0").default(fallback),
  );
const bool = (fallback: boolean) =>
  z.preprocess(
    (v) => {
      const s = blankToUndefined(v);
      if (typeof s !== "string") return s;
      return ["1", "true", "yes", "on"].includes(s.toLowerCase()) ? true : ["0", "false", "no", "off"].includes(s.toLowerCase()) ? false : s;
    },
    z.boolean({ error: "must be true or false" }).default(fallback),
  );
const channel = (fallback: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim().replace(/^#/, "") : v),
    z.preprocess(blankToUndefined, z.string().regex(/^[a-z0-9._-]+$/, "must be a Slack channel name like bahi-ops").default(fallback)),
  );

export const EnvSchema = z
  .object({
    GEMINI_API_KEY: optionalString,
    GEMINI_API_KEY_BACKUP: optionalString,
    /** Comma-separated model ids, tried in order (defaults in src/lib/agent/defaults.ts). */
    GEMINI_MODEL: optionalString,
    GROQ_API_KEY: optionalString,
    /** Comma-separated model ids, tried in order. */
    GROQ_MODEL: optionalString,

    /**
     * live (default): the agent runs for real (model + SWYTCH_MODE adapters).
     * replay: POST /api/runs plays a recorded live run from fixtures/runs/ (demo safety net, e2e).
     */
    AGENT_MODE: z.preprocess(blankToUndefined, z.enum(["live", "replay"], { error: 'must be "live" or "replay"' }).default("live")),
    /** Replay playback speed (1 = recorded pace with long waits trimmed; e2e uses more). */
    REPLAY_SPEED: z.preprocess(blankToUndefined, z.coerce.number({ error: "must be a number like 1" }).min(0.25).max(50).default(1)),

    SWYTCH_MODE: z.preprocess(blankToUndefined, z.enum(["live", "mock"], { error: 'must be "live" or "mock"' }).default("mock")),
    /** cli = async spawn of the native swytchcode binary (default). sdk = @swytchcode/runtime exec() in a worker thread. */
    SWYTCH_TRANSPORT: z.preprocess(blankToUndefined, z.enum(["cli", "sdk"], { error: 'must be "cli" or "sdk"' }).default("cli")),
    /** Absolute path to the swytchcode binary. Optional; auto-detected from the global npm install. */
    SWYTCHCODE_BIN: optionalString,
    /** Folder holding .swytchcode/. Defaults to the process working directory (the repo root). */
    SWYTCHCODE_PROJECT_DIR: optionalString,
    SWYTCH_TIMEOUT_MS: z.preprocess(blankToUndefined, z.coerce.number().int().min(1000).max(300_000).default(45_000)),

    APPROVAL_THRESHOLD_INR: inr(50_000),
    REFUND_BLOCK_THRESHOLD_INR: inr(10_000),
    /** How long a held invoice waits for the owner's decision before it expires. */
    APPROVAL_TIMEOUT_SEC: z.preprocess(blankToUndefined, z.coerce.number().int().min(15).max(3600).default(300)),
    /**
     * gate (default): Swytchcode blocks large invoices until Bahi's approval desk stamps them.
     * swytchcode: Swytchcode REQUIRES_APPROVAL (Slack HITL; needs a Swytchcode plan with approvals).
     */
    APPROVAL_MODE: z.preprocess(blankToUndefined, z.enum(["gate", "swytchcode"], { error: 'must be "gate" or "swytchcode"' }).default("gate")),

    LAYA_ENABLED: bool(false),
    LAYA_URL: z.preprocess(blankToUndefined, z.url({ error: "must be a URL like http://127.0.0.1:8000" }).default("http://127.0.0.1:8000")),

    NOTION_PARENT_PAGE_ID: optionalString,
    NOTION_LEDGER_DATABASE_ID: optionalString,
    /** Optional: the ledger's data source id. Resolved from the database when unset. */
    NOTION_LEDGER_DATA_SOURCE_ID: optionalString,
    /** Your Jira Cloud site, e.g. https://yourname.atlassian.net (the Swytchcode bundle ships a placeholder). */
    JIRA_BASE_URL: z.preprocess(blankToUndefined, z.url({ error: "must be a URL like https://yourname.atlassian.net" }).optional()),
    JIRA_PROJECT_KEY: z.preprocess(blankToUndefined, z.string().regex(/^[A-Z][A-Z0-9]+$/, "must be an uppercase Jira key like BAHI").default("BAHI")),
    SLACK_OPS_CHANNEL: channel("bahi-ops"),
    SLACK_APPROVALS_CHANNEL: channel("approvals"),
    /** Complaints, suspicious mail and blocked actions. Blank = same as SLACK_OPS_CHANNEL. */
    SLACK_ALERTS_CHANNEL: z.preprocess(
      (v) => (typeof v === "string" ? v.trim().replace(/^#/, "") : v),
      z.preprocess(blankToUndefined, z.string().regex(/^[a-z0-9._-]+$/, "must be a Slack channel name like bahi-alerts").optional()),
    ),

    BUSINESS_NAME: withDefault("DukaanSetu"),
    /** Where the owner opens Bahi (used in Slack approval links). */
    BAHI_PUBLIC_URL: z.preprocess(blankToUndefined, z.url({ error: "must be a URL like http://localhost:3000" }).default("http://localhost:3000")),
    BUSINESS_EMAIL: z.preprocess(blankToUndefined, z.email({ error: "must be an email address" }).optional()),
    PAYPAL_CURRENCY: z.preprocess(blankToUndefined, z.enum(["INR", "USD"], { error: 'must be "INR" or "USD"' }).default("INR")),
    /** Only used when PAYPAL_CURRENCY=USD: rupees per dollar for the sandbox invoice amount. */
    DEMO_INR_PER_USD: z.preprocess(blankToUndefined, z.coerce.number({ error: "must be a number like 83" }).positive().default(83)),
    /** Email address of the PayPal sandbox business (merchant) account. */
    PAYPAL_MERCHANT_EMAIL: z.preprocess(blankToUndefined, z.email({ error: "must be an email address" }).optional()),
  })
  .superRefine((env, ctx) => {
    if (env.REFUND_BLOCK_THRESHOLD_INR > env.APPROVAL_THRESHOLD_INR * 10) {
      ctx.addIssue({
        code: "custom",
        path: ["REFUND_BLOCK_THRESHOLD_INR"],
        message: "looks too high compared to APPROVAL_THRESHOLD_INR; refunds should be the stricter guardrail",
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Bahi config problem in .env.local:\n${issues.map((i) => `  - ${i}`).join("\n")}\nSee .env.example for every variable.`);
    this.name = "EnvError";
  }
}

/** Parse an env-like object. Exported for tests; app code uses getEnv(). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (result.success) return result.data;
  throw new EnvError(result.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`));
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
