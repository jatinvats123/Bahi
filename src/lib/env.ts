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
    GEMINI_MODEL: optionalString,
    GROQ_API_KEY: optionalString,
    GROQ_MODEL: optionalString,

    SWYTCH_MODE: z.preprocess(blankToUndefined, z.enum(["live", "mock"], { error: 'must be "live" or "mock"' }).default("mock")),

    APPROVAL_THRESHOLD_INR: inr(50_000),
    REFUND_BLOCK_THRESHOLD_INR: inr(10_000),

    LAYA_ENABLED: bool(false),
    LAYA_URL: z.preprocess(blankToUndefined, z.url({ error: "must be a URL like http://127.0.0.1:8000" }).default("http://127.0.0.1:8000")),

    NOTION_PARENT_PAGE_ID: optionalString,
    NOTION_LEDGER_DATABASE_ID: optionalString,
    JIRA_PROJECT_KEY: z.preprocess(blankToUndefined, z.string().regex(/^[A-Z][A-Z0-9]+$/, "must be an uppercase Jira key like BAHI").default("BAHI")),
    SLACK_OPS_CHANNEL: channel("bahi-ops"),
    SLACK_APPROVALS_CHANNEL: channel("approvals"),

    BUSINESS_NAME: withDefault("DukaanSetu"),
    BUSINESS_EMAIL: z.preprocess(blankToUndefined, z.email({ error: "must be an email address" }).optional()),
    PAYPAL_CURRENCY: z.preprocess(blankToUndefined, z.literal("INR", { error: 'must be "INR"' }).default("INR")),
  })
  .superRefine((env, ctx) => {
    if (env.SWYTCH_MODE === "live" && !env.GEMINI_API_KEY && !env.GROQ_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["GEMINI_API_KEY"],
        message: "live mode needs a model key: set GEMINI_API_KEY (or GROQ_API_KEY), or use SWYTCH_MODE=mock",
      });
    }
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
