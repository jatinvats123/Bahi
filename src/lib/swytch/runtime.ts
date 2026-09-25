import "server-only";
import { randomUUID } from "node:crypto";
import { getEnv } from "../env";
import type { RunEventDraft } from "../events";
import { isApprovalGate } from "../guardrails/policies";
import { INTEGRATION_LABEL } from "../verbs";
import { ownerMessage, unwrapKernelOutput, type ExecError } from "./errors";
import { loadSwytchProject, paypalEndpointProblem, policiesTargeting, type SwytchProject } from "./project";
import { toolById } from "./tools";
import { resolveSwytchcodeBinary, runCli, runCliText, runSdk, type TransportName, type TransportRequest, type TransportResponse } from "./transport";

/**
 * The one door to the outside world. Every PayPal, Gmail, Slack, Notion and Jira
 * action goes through execTool(), which goes through Swytchcode.
 *
 * execTool never throws for tool failures: it returns a normalized ExecResult so the
 * agent (phase 3) can reason about "blocked by policy" vs "auth expired" vs "provider
 * said no". When an onEvent callback is given it also emits tool_call, policy,
 * approval and tool_result RunEvents for the live console.
 */

/** Kernel stdin shape (see @swytchcode/runtime ExecArgs): body, path/query params, extra headers. */
export interface ExecInput {
  body?: unknown;
  params?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  /**
   * Top-level placeholder for bundle inputs the kernel marks required but fills itself.
   * Slack's bundle requires a "token" header on chat.postMessage and auth.test; the OAuth
   * token is injected by Swytchcode, and a top-level `token` only satisfies the validator
   * (verified 25 Sep 2026: auth.test answered ok with the real workspace). Never put a
   * real secret here, and never pass it in `params` (that one is sent to Slack as the token).
   */
  token?: string;
}

export interface ExecOptions {
  /** Default SWYTCH_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Validate and resolve without calling the provider (swy exec --dry-run). */
  dryRun?: boolean;
  /** Stream RunEvents for this call. */
  onEvent?: (event: RunEventDraft) => void;
  /** Correlates events; generated when absent. */
  callId?: string;
  /** Human summary of the input for the timeline. Never put secrets here. */
  inputSummary?: string;
  /** Override the configured transport (tests, smoke comparisons). */
  transport?: TransportName;
  /**
   * Check the provider response before the call counts as a success (e.g. Slack's
   * HTTP 200 {"ok": false}). Return an ExecError to turn it into a failure.
   */
  validate?: (data: unknown) => ExecError | null;
}

export type ExecResult<T = unknown> =
  | { ok: true; data: T; ms: number; callId: string; transport: TransportName }
  | { ok: false; error: ExecError; ms: number; callId: string; transport: TransportName };

interface RuntimeConfig {
  dir: string;
  bin: string | null;
  transport: TransportName;
  timeoutMs: number;
  approvalsChannel: string;
}

class SwytchcodeRuntime {
  constructor(private readonly config: RuntimeConfig) {}

  get transport(): TransportName {
    return this.config.transport;
  }

  get binary(): string | null {
    return this.config.bin;
  }

  get dir(): string {
    return this.config.dir;
  }

  project(): Promise<SwytchProject> {
    return loadSwytchProject(this.config.dir);
  }

  async execute<T = unknown>(tool: string, input: ExecInput = {}, opts: ExecOptions = {}): Promise<ExecResult<T>> {
    const def = toolById(tool);
    const integration = def?.integration;
    const callId = opts.callId ?? `c_${randomUUID().slice(0, 8)}`;
    const transport = opts.transport ?? this.config.transport;
    const emit = opts.onEvent;
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);

    if (emit && integration) {
      emit({ type: "tool_call", callId, integration, tool, inputSummary: opts.inputSummary ?? "" });
    }

    const fail = (raw: ExecError): ExecResult<T> => {
      const ms = elapsed();
      // A block by an approval-gate policy means "waiting for the owner", not "never" (see guardrails/policies.ts).
      const gated: ExecError = raw.kind === "policy_blocked" && isApprovalGate(raw.policyId) ? { ...raw, kind: "approval_required", approvalVia: "bahi" } : raw;
      // The CLI prefixes the policy's own message with 'blocked by policy "<id>": '; the id is shown separately.
      const error: ExecError = gated.policyId ? { ...gated, message: gated.message.replace(/^blocked by policy "[^"]+":\s*/, "") } : gated;
      if (emit && integration) {
        if (error.kind === "policy_blocked") {
          emit({ type: "policy", callId, decision: "blocked", policyId: error.policyId ?? "unknown", message: error.message });
        }
        if (error.kind === "approval_required") {
          // The caller (the approval desk) emits the approval events and, once decided, the result.
          emit({ type: "policy", callId, decision: "approval_required", policyId: error.policyId ?? "unknown", message: error.message });
        } else {
          emit({ type: "tool_result", callId, ok: false, summary: ownerMessage(error, INTEGRATION_LABEL[integration]), ms, retries: 0 });
        }
      }
      return { ok: false, error, ms, callId, transport };
    };

    let project: SwytchProject;
    try {
      project = await this.project();
    } catch (e) {
      return fail({ kind: "not_found", message: e instanceof Error ? e.message : String(e) });
    }

    // Bahi's own guard, before Swytchcode even runs: PayPal is sandbox-only.
    if (integration === "paypal") {
      const problem = paypalEndpointProblem(project.manifest, project.mode, project.integrations);
      if (problem) return fail({ kind: "policy_blocked", policyId: "bahi-paypal-sandbox-only", message: problem });
    }

    const req: TransportRequest = {
      tool,
      input,
      cwd: this.config.dir,
      timeoutMs: opts.timeoutMs ?? this.config.timeoutMs,
      dryRun: opts.dryRun === true,
      bin: this.config.bin,
    };
    let res: TransportResponse;
    try {
      res = transport === "sdk" ? await runSdk(req) : await runCli(req);
    } catch (e) {
      res = { ok: false, stderr: "", error: { kind: "unknown", message: e instanceof Error ? e.message : String(e) } };
    }
    if (!res.ok) return fail(res.error);
    const unwrapped = unwrapKernelOutput(res.data);
    if (!unwrapped.ok) return fail(unwrapped.error);
    tap?.({ tool, input, data: unwrapped.data });
    const invalid = opts.validate?.(unwrapped.data);
    if (invalid) return fail(invalid);

    const ms = elapsed();
    if (emit && integration) {
      const guards = policiesTargeting(project.policies, tool);
      if (guards.length > 0) {
        emit({ type: "policy", callId, decision: "allowed", policyId: guards.map((g) => g.id).join(","), message: "Swytchcode: policy ok" });
      }
      emit({ type: "tool_result", callId, ok: true, summary: def?.done ?? "Ho gaya", ms, retries: 0 });
    }
    return { ok: true, data: unwrapped.data as T, ms, callId, transport };
  }
}

/** What `swytchcode exec --explain` says a call would do (no network call, policies still apply). */
export interface ExplainResult {
  ok: boolean;
  tool?: string;
  provider?: string;
  mode?: string;
  endpoint?: string;
  /** Set when a policy or validation stopped the explain. */
  error?: string;
}

export function parseExplainOutput(text: string): Omit<ExplainResult, "ok"> {
  const field = (name: string) => new RegExp(`^${name}:\\s+(.+)$`, "m").exec(text)?.[1]?.trim();
  return { tool: field("Tool"), provider: field("Provider"), mode: field("Mode"), endpoint: field("Endpoint") };
}

/** Observer for successful raw responses (the smoke script records fixtures with it). */
export type ExecTap = (call: { tool: string; input: ExecInput; data: unknown }) => void;
let tap: ExecTap | undefined;

export function setExecTap(fn: ExecTap | undefined): void {
  tap = fn;
}

let runtime: SwytchcodeRuntime | undefined;

/** The process-wide runtime. Created once, from env. */
export function getSwytchRuntime(): SwytchcodeRuntime {
  if (!runtime) {
    const env = getEnv();
    const dir = env.SWYTCHCODE_PROJECT_DIR ?? process.cwd();
    runtime = new SwytchcodeRuntime({
      dir,
      bin: resolveSwytchcodeBinary(process.env, dir),
      transport: env.SWYTCH_TRANSPORT,
      timeoutMs: env.SWYTCH_TIMEOUT_MS,
      approvalsChannel: env.SLACK_APPROVALS_CHANNEL,
    });
  }
  return runtime;
}

/** Ask Swytchcode what a call would do, without making it (swy exec --explain). Never throws. */
export async function explainTool(tool: string, input: ExecInput = {}): Promise<ExplainResult> {
  const rt = getSwytchRuntime();
  const r = await runCliText({ bin: rt.binary, args: ["exec", tool, "--explain"], cwd: rt.dir, stdin: JSON.stringify(input), timeoutMs: 20_000 });
  // swytchcode 2.23.5 prints the explanation on stderr, next to its log lines.
  const parsed = parseExplainOutput(`${r.stdout}\n${r.stderr}`);
  if (r.code === 0 && parsed.endpoint) return { ok: true, ...parsed };
  const policy = /blocked by policy \\?"([^"\\]+)/.exec(r.stderr + r.stdout)?.[1];
  return { ok: false, error: policy ? `blocked by policy ${policy}` : (r.error ?? `explain exited with ${String(r.code)}`) };
}

/** Run a read-only swytchcode subcommand in the project folder (audit, policy list). */
export function swytchcodeText(args: string[], timeoutMs = 20_000) {
  const rt = getSwytchRuntime();
  return runCliText({ bin: rt.binary, args, cwd: rt.dir, timeoutMs });
}

/** Execute one Swytchcode tool. See SwytchcodeRuntime.execute. */
export function execTool<T = unknown>(tool: string, input?: ExecInput, opts?: ExecOptions): Promise<ExecResult<T>> {
  return getSwytchRuntime().execute<T>(tool, input, opts);
}

export type { SwytchcodeRuntime };
