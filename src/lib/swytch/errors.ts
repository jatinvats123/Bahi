import { z } from "zod";

/**
 * Normalizes every way a Swytchcode execution can fail into one ExecError shape.
 * Pure module (no server-only) so tests can import it directly.
 *
 * Verified against swytchcode CLI 2.23.5 (see fixtures/recorded/cli/). The documented
 * exit codes (0 ok, 1 failed, 2 invalid, 3 auth, 4 policy, 5 not found) do NOT match
 * reality: an unknown tool exits 2, a network failure exits 4, a policy block exits 6
 * and an approval hold exits 7. So we classify by the CLI's classified JSON
 * `category` first, then by message text, and only then by exit code.
 */

export const EXEC_ERROR_KINDS = [
  "validation",
  "policy_blocked",
  "approval_required",
  "approval_denied",
  "auth",
  "not_found",
  "provider",
  "timeout",
  "network",
  "unknown",
] as const;
export type ExecErrorKind = (typeof EXEC_ERROR_KINDS)[number];

export interface ExecError {
  kind: ExecErrorKind;
  /** Plain-language message, safe to show on the Activity page (no request bodies). */
  message: string;
  /** Guard policy id when a policy blocked or held the call. */
  policyId?: string;
  /** Swytchcode approval request id when the call is held for a human. */
  approvalRequestId?: string;
  exitCode?: number | null;
  /** Swytchcode's own category string, when it sent one. */
  category?: string;
  retryable?: boolean;
  /** Upstream HTTP status, when the provider answered with an error. */
  httpStatus?: number;
  /** Trimmed diagnostic detail for logs. Never shown to the owner. */
  raw?: unknown;
}

/** The classified error JSON the CLI writes to stderr on most failures. */
export const ClassifiedErrorSchema = z.object({
  error: z.string(),
  category: z.string().optional(),
  retryable: z.boolean().optional(),
  suggested_action: z.string().optional(),
  docs_url: z.string().optional(),
  reference_id: z.string().optional(),
});
export type ClassifiedError = z.infer<typeof ClassifiedErrorSchema>;

/**
 * stderr mixes progress lines, timestamped log lines and the classified JSON, so
 * JSON.parse(stderr) (what @swytchcode/runtime does) fails. Scan line by line and
 * keep the last line that parses as a classified error.
 */
export function parseClassifiedError(stderr: string): ClassifiedError | null {
  let found: ClassifiedError | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{") || !t.endsWith("}")) continue;
    try {
      const parsed = ClassifiedErrorSchema.safeParse(JSON.parse(t));
      if (parsed.success) found = parsed.data;
    } catch {
      // not JSON, keep scanning
    }
  }
  return found;
}

/** Documented exit codes plus the ones observed in 2.23.5. */
export function kindFromExitCode(code: number | null | undefined): ExecErrorKind {
  switch (code) {
    case 2:
      return "validation";
    case 3:
      return "auth";
    case 4:
      return "policy_blocked";
    case 5:
      return "not_found";
    case 6:
      return "policy_blocked";
    case 7:
      return "approval_required";
    case 1:
      return "provider";
    default:
      return "unknown";
  }
}

const CATEGORY_KIND: Record<string, ExecErrorKind> = {
  not_found: "not_found",
  auth: "auth",
  authentication: "auth",
  network: "network",
  timeout: "timeout",
  policy_denied: "policy_blocked",
  policy_blocked: "policy_blocked",
  policy: "policy_blocked",
  approval_denied: "approval_denied",
  approval_required: "approval_required",
  approval_pending: "approval_required",
  validation: "validation",
  invalid_input: "validation",
  input: "validation",
  provider: "provider",
  upstream: "provider",
  http: "provider",
  api: "provider",
};

const APPROVAL_RE = /Approval requested for (\S+) \(policy "([^"]+)"\)\. Request ([A-Za-z0-9_-]+)/;
const POLICY_RE = /blocked by policy "([^"]+)"/;
const DENIED_RE = /approval (was )?(denied|rejected)/i;
const EXPIRED_RE = /approval (request )?(has )?expired/i;
const HTTP_STATUS_RE = /\b(?:status(?: code)?|HTTP)[ :=]+([1-5]\d\d)\b/i;
const NETWORK_RE = /(ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|dial tcp|no such host|connection reset|network is unreachable|TLS handshake)/i;
const TIMEOUT_RE = /(timed out|timeout|deadline exceeded|ETIMEDOUT)/i;

export interface CliFailure {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Node spawn error code, e.g. "ENOENT", when the process never ran. */
  spawnErrorCode?: string;
  /** True when we killed the process for exceeding our own timeout. */
  timedOut?: boolean;
  /** Our timeout in ms, for the message. */
  timeoutMs?: number;
}

/** Last few non-log lines of stderr, for a human message when there is no JSON. */
function tailMessage(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \[swytchcode/.test(l) && !/^(Fetching|Saving bundle|›|×)/.test(l));
  return lines.slice(-2).join(" ").slice(0, 400);
}

function applyTextHints(err: ExecError, text: string): ExecError {
  const policy = POLICY_RE.exec(text);
  if (policy?.[1] && !err.policyId) err.policyId = policy[1];
  const status = HTTP_STATUS_RE.exec(text);
  if (status?.[1] && !err.httpStatus) err.httpStatus = Number(status[1]);
  return err;
}

/** Classify a non-zero `swytchcode exec` result. */
export function classifyCliFailure(f: CliFailure): ExecError {
  if (f.timedOut) {
    return { kind: "timeout", message: `Swytchcode call ${f.timeoutMs ? `took longer than ${f.timeoutMs} ms` : "timed out"}`, exitCode: f.exitCode, retryable: true };
  }
  if (f.spawnErrorCode) {
    return {
      kind: "unknown",
      message:
        f.spawnErrorCode === "ENOENT"
          ? "Swytchcode CLI not found. Install it with npm install -g swytchcode, or set SWYTCHCODE_BIN."
          : `Could not start the Swytchcode CLI (${f.spawnErrorCode})`,
      exitCode: null,
    };
  }

  const text = `${f.stderr}\n${f.stdout}`;

  // Approval hold: plain text, no JSON (exit 7 in 2.23.5).
  const approval = APPROVAL_RE.exec(text);
  if (approval || /error=approval pending/.test(text)) {
    return {
      kind: "approval_required",
      message: "Held for human approval in Slack",
      policyId: approval?.[2],
      approvalRequestId: approval?.[3],
      exitCode: f.exitCode,
      retryable: false,
    };
  }
  if (DENIED_RE.test(text)) {
    return applyTextHints({ kind: "approval_denied", message: "Approval was denied", exitCode: f.exitCode, retryable: false }, text);
  }
  if (EXPIRED_RE.test(text)) {
    return applyTextHints({ kind: "approval_denied", message: "Approval request expired", exitCode: f.exitCode, retryable: false }, text);
  }

  const classified = parseClassifiedError(f.stderr) ?? parseClassifiedError(f.stdout);
  if (classified) {
    const byCategory = classified.category ? CATEGORY_KIND[classified.category.toLowerCase()] : undefined;
    let kind: ExecErrorKind = byCategory ?? kindFromExitCode(f.exitCode);
    if (!byCategory && NETWORK_RE.test(classified.error)) kind = "network";
    if (kind === "network" && TIMEOUT_RE.test(classified.error)) kind = "timeout";
    return applyTextHints(
      {
        kind,
        message: classified.error.slice(0, 400),
        exitCode: f.exitCode,
        category: classified.category,
        retryable: classified.retryable,
        raw: { category: classified.category, reference: classified.reference_id },
      },
      classified.error,
    );
  }

  let kind = kindFromExitCode(f.exitCode);
  if (NETWORK_RE.test(text)) kind = TIMEOUT_RE.test(text) ? "timeout" : "network";
  return applyTextHints({ kind, message: tailMessage(f.stderr) || `Swytchcode exited with code ${String(f.exitCode)}`, exitCode: f.exitCode }, text);
}

/**
 * Normalize an error thrown by @swytchcode/runtime's exec(). Its SwytchcodeError puts
 * the exit code in `cause` (a number) for non-zero exits, the spawn error object for
 * spawn failures, and the parsed classified JSON (when stderr was pure JSON) in `details`.
 * Its message is either the classified error text or the whole stderr.
 */
export function normalizeSdkError(e: unknown): ExecError {
  if (!(e instanceof Error)) return { kind: "unknown", message: String(e) };
  const cause = (e as { cause?: unknown }).cause;
  const details = (e as { details?: { category?: string; retryable?: boolean } }).details;
  if (/timed out after/.test(e.message)) {
    return { kind: "timeout", message: e.message, retryable: true };
  }
  if (cause && typeof cause === "object" && "code" in cause && typeof (cause as { code: unknown }).code === "string") {
    return classifyCliFailure({ exitCode: null, stdout: "", stderr: "", spawnErrorCode: (cause as { code: string }).code });
  }
  const exitCode = typeof cause === "number" ? cause : null;
  const stderrLike = details?.category ? JSON.stringify({ error: e.message, category: details.category, retryable: details.retryable }) : e.message;
  const err = classifyCliFailure({ exitCode, stdout: "", stderr: stderrLike });
  if (err.kind === "unknown" && /Invalid JSON output/.test(e.message)) err.kind = "provider";
  return err;
}

/** Short Hinglish/English line for the owner. Technical detail stays in `message`. */
export function ownerMessage(err: ExecError, integrationLabel: string): string {
  switch (err.kind) {
    case "auth":
      return `${integrationLabel} se connection toot gaya hai. Settings mein reconnect karein.`;
    case "policy_blocked":
      return "Rok diya gaya: policy.";
    case "approval_required":
      return "Approval ka intezaar hai (Slack).";
    case "approval_denied":
      return "Approval nahi mila, kaam roka gaya.";
    case "not_found":
      return `${integrationLabel} ka yeh tool project mein enabled nahi hai.`;
    case "validation":
      return `${integrationLabel} ko bheji jaankari adhoori thi.`;
    case "timeout":
      return `${integrationLabel} ne time par jawab nahi diya.`;
    case "network":
      return `${integrationLabel} tak pahunch nahi paaye. Network check karein.`;
    case "provider":
      return `${integrationLabel} ne kaam mana kar diya.`;
    default:
      return `${integrationLabel} ke saath kuch gadbad hui.`;
  }
}

/**
 * The exec docs show successes wrapped as {"success": true, "result": {...}}, but
 * dry runs print the bare object. Accept both; a {"success": false} envelope is a
 * provider error.
 */
export function unwrapKernelOutput(data: unknown): { ok: true; data: unknown } | { ok: false; error: ExecError } {
  if (data && typeof data === "object" && !Array.isArray(data) && "success" in data && typeof (data as { success: unknown }).success === "boolean") {
    const env = data as { success: boolean; result?: unknown; error?: unknown };
    if (env.success) return { ok: true, data: "result" in env ? env.result : null };
    const msg = typeof env.error === "string" ? env.error : JSON.stringify(env.error ?? "provider error").slice(0, 300);
    return { ok: false, error: { kind: "provider", message: msg } };
  }
  return { ok: true, data };
}
