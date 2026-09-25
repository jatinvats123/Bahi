/**
 * Bahi's Swytchcode guard policies, as code. Pure module (no server-only): the
 * generator script, the mock adapters, the UI and the tests all read it.
 *
 * `npm run policies:sync` writes buildPoliciesFile() to .swytchcode/integrations/policies.json
 * and runs `swy policy validate`; `-- --probe` also dry-runs sample calls through the real
 * kernel and compares every decision with evaluatePolicies() below.
 *
 * What the kernel really does (swytchcode 2.23.5, probed 26 Sep 2026, see docs/GUARDRAILS.md):
 * - A condition `field` must be flat: "dotted paths are not supported in v1". Top-level
 *   inputs (body, path/query/header inputs) and top-level body keys resolve; nested ones do not.
 * - `contains` / `matches` on `body` test Go's %v rendering of the JSON body:
 *   `map[detail:map[currency_code:USD memo:x] items:[map[name:a ...]]]`, keys sorted, strings unquoted.
 *   So a regex over that rendering can read the real nested amount (renderGo() reproduces it).
 * - REQUIRES_APPROVAL is refused on the free Developer plan ("approval requests are not
 *   included in your current plan"), so the large-invoice policy is a Swytchcode hard gate
 *   that Bahi's approval desk opens with an approval stamp (see approvals.ts).
 */

export const POLICY_IDS = {
  invoiceApproval: "invoice-approval-over-threshold",
  largeRefunds: "block-large-refunds",
  knownRecipients: "email-known-clients-only",
} as const;
export type BahiPolicyId = (typeof POLICY_IDS)[keyof typeof POLICY_IDS];

export const POLICY_TARGETS = {
  invoiceCreate: "invoices.invoicing.invoices.create",
  refund: "payments.payment.captures.refund",
  gmailSend: "gmail.user.send.create1",
} as const;

/** Policy ids whose "block" means "waiting for a human", not "never". */
export const APPROVAL_GATE_POLICIES: ReadonlySet<string> = new Set([POLICY_IDS.invoiceApproval]);

export function isApprovalGate(policyId: string | undefined | null): boolean {
  return Boolean(policyId && APPROVAL_GATE_POLICIES.has(policyId));
}

// ---------------------------------------------------------------- policy file types

export type LeafOperator =
  | "=="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "in"
  | "not_in"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "matches"
  | "exists"
  | "not_exists"
  | "empty"
  | "not_empty";

export interface LeafCondition {
  field: string;
  operator: LeafOperator;
  value?: string | number | boolean | (string | number)[] | null;
}
export interface GroupCondition {
  operator: "all" | "any" | "not";
  conditions: Condition[];
}
export type Condition = LeafCondition | GroupCondition;

export interface PolicyAction {
  type: "POLICY_BLOCKED" | "REQUIRES_APPROVAL";
  message: string;
}
export interface Policy {
  id: string;
  name?: string;
  target: string[];
  when: Condition;
  action: PolicyAction;
}
export interface PoliciesFile {
  defaults: { on_violation: "fail"; evaluation: "pre_execution" };
  policies: Policy[];
}

// ---------------------------------------------------------------- regex helpers

/** The kernel caps a `matches` pattern at 512 characters. */
export const MAX_REGEX = 512;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Regex (no anchors) for non-negative integers without leading zeros that are > n. */
function intGreaterThan(n: string): string {
  const k = n.length;
  const alts = [`[1-9]\\d{${k},}`];
  for (let i = 0; i < k; i++) {
    const d = Number(n[i]);
    if (d === 9) continue;
    const lo = d + 1;
    const cls = lo === 9 ? "9" : `[${lo}-9]`;
    const rest = k - i - 1;
    alts.push(`${escapeRe(n.slice(0, i))}${cls}${rest ? `\\d{${rest}}` : ""}`);
  }
  return alts.join("|");
}

/** Regex for a fraction digit string (after the dot) that is > f (f has no trailing requirement). */
function fracGreaterThan(f: string): string {
  const alts: string[] = [];
  for (let i = 0; i < f.length; i++) {
    const d = Number(f[i]);
    if (d === 9) continue;
    const lo = d + 1;
    alts.push(`${escapeRe(f.slice(0, i))}${lo === 9 ? "9" : `[${lo}-9]`}\\d*`);
  }
  // Same digits followed by any non-zero digit: 0.41 < 0.4100001.
  alts.push(`${escapeRe(f)}0*[1-9]\\d*`);
  return alts.join("|");
}

/**
 * Regex (no anchors) matching a plain decimal string ("700", "700.5", "700.00") whose value
 * is strictly greater than `threshold` (rounded to 2 decimals). Leading zeros allowed.
 */
export function decimalGreaterThanRegex(threshold: number): string {
  if (!Number.isFinite(threshold) || threshold < 0) throw new Error(`bad threshold ${threshold}`);
  const [intPart, frac = ""] = threshold.toFixed(2).split(".");
  const i = intPart ?? "0";
  const f = frac.replace(/0+$/, "");
  const bigger = `0*(?:${intGreaterThan(i)})(?:\\.\\d*)?`;
  const equalIntBiggerFrac = f ? `0*${escapeRe(i)}\\.(?:${fracGreaterThan(f)})` : `0*${escapeRe(i)}\\.0*[1-9]\\d*`;
  return `(?:${bigger}|${equalIntBiggerFrac})`;
}

// ---------------------------------------------------------------- Go %v rendering

/**
 * Go's fmt %v of a value decoded from JSON into interface{}: maps render as
 * `map[k:v k2:v2]` with sorted keys, slices as `[a b]`, strings unquoted, null as <nil>.
 * This is what the kernel's `contains` / `matches` see for an object field.
 */
export function renderGo(value: unknown): string {
  if (value === null || value === undefined) return "<nil>";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return goFloat(value);
  if (Array.isArray(value)) return `[${value.map(renderGo).join(" ")}]`;
  if (typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${k}:${renderGo((value as Record<string, unknown>)[k])}`);
    return `map[${entries.join(" ")}]`;
  }
  return String(value);
}

/** %v of a float64: shortest repr, exponent form for very large or small magnitudes. */
function goFloat(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e21)) {
    const [m, e = "0"] = n.toExponential().split("e");
    const exp = Number(e);
    return `${m}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  return String(n);
}

// ---------------------------------------------------------------- local evaluator

/** What a policy can see of one call: the kernel's top-level inputs plus top-level body keys. */
export interface CallInput {
  body?: unknown;
  params?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}

function resolveField(field: string, input: CallInput): { found: boolean; value: unknown } {
  if (field.includes(".")) return { found: false, value: undefined };
  if (field === "body") return { found: input.body !== undefined, value: input.body };
  for (const bag of [input.params, input.headers]) {
    if (bag && Object.prototype.hasOwnProperty.call(bag, field)) return { found: true, value: bag[field] };
  }
  const body = input.body;
  if (body && typeof body === "object" && !Array.isArray(body) && Object.prototype.hasOwnProperty.call(body, field)) {
    return { found: true, value: (body as Record<string, unknown>)[field] };
  }
  return { found: false, value: undefined };
}

function asText(v: unknown): string {
  return typeof v === "string" ? v : renderGo(v);
}

function evalLeaf(c: LeafCondition, input: CallInput): boolean {
  const { found, value } = resolveField(c.field, input);
  switch (c.operator) {
    case "exists":
      return found;
    case "not_exists":
      return !found;
    case "empty":
      return !found || value === "" || value === null || (Array.isArray(value) && value.length === 0);
    case "not_empty":
      return found && !(value === "" || value === null || (Array.isArray(value) && value.length === 0));
    default:
      break;
  }
  if (!found) return false;
  const text = asText(value);
  const want = c.value;
  switch (c.operator) {
    case "contains":
      return text.includes(String(want));
    case "not_contains":
      return !text.includes(String(want));
    case "starts_with":
      return text.startsWith(String(want));
    case "ends_with":
      return text.endsWith(String(want));
    case "matches":
      return new RegExp(String(want)).test(text);
    case "in":
      return Array.isArray(want) && want.map(String).includes(text);
    case "not_in":
      return Array.isArray(want) && !want.map(String).includes(text);
    case "==":
      return text === String(want);
    case "!=":
      return text !== String(want);
    default: {
      const a = Number(value);
      const b = Number(want);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return c.operator === ">" ? a > b : c.operator === ">=" ? a >= b : c.operator === "<" ? a < b : a <= b;
    }
  }
}

export function evaluateCondition(c: Condition, input: CallInput): boolean {
  if ("conditions" in c) {
    if (c.operator === "all") return c.conditions.every((x) => evaluateCondition(x, input));
    if (c.operator === "any") return c.conditions.some((x) => evaluateCondition(x, input));
    return !c.conditions.every((x) => evaluateCondition(x, input));
  }
  return evalLeaf(c, input);
}

export type PolicyDecisionLocal = { decision: "allowed" } | { decision: "blocked" | "approval_required"; policy: Policy };

/** First matching policy for this tool, like the kernel's pre-execution check. */
export function evaluatePolicies(policies: readonly Policy[], tool: string, input: CallInput): PolicyDecisionLocal {
  for (const p of policies) {
    if (!p.target.includes(tool)) continue;
    if (evaluateCondition(p.when, input)) {
      return { decision: p.action.type === "REQUIRES_APPROVAL" ? "approval_required" : "blocked", policy: p };
    }
  }
  return { decision: "allowed" };
}

// ---------------------------------------------------------------- Gmail recipient encoding

/**
 * The To header line Bahi writes first in every outgoing email, padded with spaces so its
 * UTF-8 length (with CRLF) is a multiple of 3. At offset 0 of the message that makes its
 * base64 a fixed, self-contained prefix of Gmail's `raw` field, which the
 * email-known-clients-only policy can match exactly. Addresses are lower-cased.
 */
export function alignedToLine(to: string): string {
  const base = `To: ${to.trim().toLowerCase()}`;
  const len = Buffer.byteLength(`${base}\r\n`, "utf8");
  return `${base}${" ".repeat((3 - (len % 3)) % 3)}\r\n`;
}

export function base64Url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The base64url prefix an email to `to` starts with. */
export function recipientPrefix(to: string): string {
  return base64Url(alignedToLine(to));
}

// ---------------------------------------------------------------- the policies

export interface GuardrailConfig {
  approvalThresholdInr: number;
  refundBlockThresholdInr: number;
  /** Rupees per dollar, for sandbox invoices in USD. */
  inrPerUsd: number;
  /** Every address Bahi may email (client contact emails). */
  allowedRecipients: string[];
  /** "gate" (default): POLICY_BLOCKED unless Bahi's approval stamp is present. "swytchcode": REQUIRES_APPROVAL (paid plans). */
  approvalMode: "gate" | "swytchcode";
}

/** Merchant-only memo Bahi writes on an invoice the owner approved. */
export const APPROVAL_STAMP_PREFIX = "Bahi approval apr_";
export function approvalStamp(approvalId: string, by: string): string {
  return `${APPROVAL_STAMP_PREFIX}${approvalId.replace(/^apr_/, "")} by ${by}`;
}
const STAMP_RE = `memo:${escapeRe(APPROVAL_STAMP_PREFIX)}[0-9a-z]{8,}`;

function moneyOver(key: string, thresholdInr: number, inrPerUsd: number): string {
  const usd = Number((thresholdInr / inrPerUsd).toFixed(2));
  return `${key}:map\\[currency_code:(?:INR value:${decimalGreaterThanRegex(thresholdInr)}|USD value:${decimalGreaterThanRegex(usd)})\\]`;
}

/** Split an alternation into regexes under MAX_REGEX characters each. */
function chunkAlternation(prefix: string, alts: string[]): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const build = (xs: string[]) => `${prefix}(?:${xs.join("|")})`;
  for (const a of alts) {
    if (cur.length && build([...cur, a]).length > MAX_REGEX) {
      out.push(build(cur));
      cur = [];
    }
    cur.push(a);
  }
  if (cur.length) out.push(build(cur));
  return out;
}

export function buildPolicies(cfg: GuardrailConfig): Policy[] {
  const recipients = [...new Set(cfg.allowedRecipients.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))].sort();
  const recipientRes = chunkAlternation("^map\\[raw:", recipients.map((e) => escapeRe(recipientPrefix(e))));
  const approvalMsg = `Invoice above Rs ${cfg.approvalThresholdInr.toLocaleString("en-IN")} needs the owner's approval before it reaches PayPal.`;

  return [
    {
      id: POLICY_IDS.invoiceApproval,
      name: "Large invoices need owner approval",
      target: [POLICY_TARGETS.invoiceCreate],
      when:
        cfg.approvalMode === "swytchcode"
          ? { field: "body", operator: "matches", value: moneyOver("unit_amount", cfg.approvalThresholdInr, cfg.inrPerUsd) }
          : {
              operator: "all",
              conditions: [
                { field: "body", operator: "matches", value: moneyOver("unit_amount", cfg.approvalThresholdInr, cfg.inrPerUsd) },
                { operator: "not", conditions: [{ field: "body", operator: "matches", value: STAMP_RE }] },
              ],
            },
      action: { type: cfg.approvalMode === "swytchcode" ? "REQUIRES_APPROVAL" : "POLICY_BLOCKED", message: approvalMsg },
    },
    {
      id: POLICY_IDS.largeRefunds,
      name: "No large or full refunds by the agent",
      target: [POLICY_TARGETS.refund],
      when: {
        operator: "any",
        conditions: [
          // No amount means a full refund of the capture. (A flat `amount` field also resolves, but
          // `swy policy validate` warns on body keys, so this reads the rendered body instead.)
          { field: "body", operator: "not_exists" },
          { field: "body", operator: "not_contains", value: "amount:map[" },
          { field: "body", operator: "matches", value: moneyOver("amount", cfg.refundBlockThresholdInr, cfg.inrPerUsd) },
        ],
      },
      action: {
        type: "POLICY_BLOCKED",
        message: `Refund above Rs ${cfg.refundBlockThresholdInr.toLocaleString("en-IN")} blocked by Bahi policy. Owner must do this manually.`,
      },
    },
    {
      id: POLICY_IDS.knownRecipients,
      name: "Email only known clients",
      target: [POLICY_TARGETS.gmailSend],
      when:
        recipientRes.length === 0
          ? { field: "userId", operator: "exists" }
          : { operator: "not", conditions: [recipientRes.length === 1 ? { field: "body", operator: "matches", value: recipientRes[0]! } : { operator: "any", conditions: recipientRes.map((value) => ({ field: "body", operator: "matches" as const, value })) }] },
      action: { type: "POLICY_BLOCKED", message: "Recipient is not a known client. Bahi only emails clients in its client list." },
    },
  ];
}

export function buildPoliciesFile(cfg: GuardrailConfig): PoliciesFile {
  return { defaults: { on_violation: "fail", evaluation: "pre_execution" }, policies: buildPolicies(cfg) };
}

// ---------------------------------------------------------------- plain language (Settings, docs)

export interface PolicyExplainer {
  id: BahiPolicyId;
  title: string;
  rule: string;
  why: string;
  target: string;
  outcome: "approval" | "blocked";
}

export function explainPolicies(cfg: Pick<GuardrailConfig, "approvalThresholdInr" | "refundBlockThresholdInr" | "approvalMode"> & { recipientCount: number }): PolicyExplainer[] {
  const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  return [
    {
      id: POLICY_IDS.invoiceApproval,
      title: "Bade invoice par approval",
      rule: `${inr(cfg.approvalThresholdInr)} se upar ka invoice PayPal tak tabhi jaata hai jab owner approve kare.`,
      why: "Galat amount ya galat client ka bada invoice bina dekhe na chala jaye.",
      target: POLICY_TARGETS.invoiceCreate,
      outcome: "approval",
    },
    {
      id: POLICY_IDS.largeRefunds,
      title: "Bade refund band",
      rule: `${inr(cfg.refundBlockThresholdInr)} se upar ka refund, ya poora refund (amount ke bina), Swytchcode network call se pehle hi rok deta hai.`,
      why: "Paisa wapas bhejna ulta nahi hota. Bade refund owner khud PayPal mein kare.",
      target: POLICY_TARGETS.refund,
      outcome: "blocked",
    },
    {
      id: POLICY_IDS.knownRecipients,
      title: "Email sirf clients ko",
      rule: `Bahi sirf client list ke ${cfg.recipientCount} pate par email bhej sakta hai. Baaki har pata ruk jaata hai.`,
      why: "Koi email (prompt injection) Bahi se bahar ke logon ko mail na karwa sake.",
      target: POLICY_TARGETS.gmailSend,
      outcome: "blocked",
    },
  ];
}
