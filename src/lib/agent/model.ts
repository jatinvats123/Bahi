import "server-only";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { APICallError, type LanguageModelV4, type LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { getEnv } from "../env";
import { DEFAULT_GEMINI_MODELS, DEFAULT_GROQ_MODELS } from "./defaults";

export { DEFAULT_GEMINI_MODELS, DEFAULT_GROQ_MODELS };

/**
 * One LanguageModel that falls back per LLM call:
 *   Gemini (GEMINI_API_KEY) -> Gemini (GEMINI_API_KEY_BACKUP) -> Groq.
 *
 * Fallback happens per step, inside the agent loop, so tools that already ran are
 * never re-run. Once a run has fallen back it stays on the fallback model (sticky),
 * so the conversation does not bounce between providers.
 *
 * Retries are ours: call generateText with maxRetries: 0.
 */

/** A model that hit its daily quota is skipped for this long (free tier: 20 requests/day/model). */
export const DAILY_QUOTA_COOLDOWN_MS = 60 * 60_000;
/** Wait for a provider's "retry in N s" hint at most this long, once per call. */
export const MAX_RATE_LIMIT_WAIT_MS = 20_000;
/** One LLM call (one agent step) may take this long before we try the next model. */
export const STEP_TIMEOUT_MS = 30_000;

export interface ModelCandidate {
  /** Short unique name for logs, e.g. "gemini", "gemini-backup", "groq". */
  name: string;
  label: string;
  model: LanguageModelV4;
  /** Same model as the previous candidate, with the backup API key. */
  backupKey?: boolean;
  /** Candidates sharing one API key: an invalid key skips them all. */
  keyGroup?: string;
}

export type FailureReason = "rate_limit" | "server" | "timeout" | "auth" | "network" | "other";

export interface SwitchInfo {
  from: ModelCandidate;
  to: ModelCandidate;
  reason: FailureReason;
  /** Owner-facing line for the timeline ("thinking" event). */
  message: string;
}

interface AttemptRecord {
  name: string;
  index: number;
  reason: FailureReason;
  message: string;
  retryMs: number | null;
}

export class AllModelsFailedError extends Error {
  constructor(readonly attempts: AttemptRecord[]) {
    super(`Every model failed: ${attempts.map((a) => `${a.name} (${a.reason})`).join(", ")}`);
    this.name = "AllModelsFailedError";
  }
}

class StepTimeoutError extends Error {
  constructor(ms: number) {
    super(`LLM call took longer than ${ms} ms`);
    this.name = "StepTimeoutError";
  }
}

export function classifyModelError(err: unknown): FailureReason {
  if (err instanceof StepTimeoutError) return "timeout";
  if (APICallError.isInstance(err)) {
    const s = err.statusCode ?? 0;
    if (s === 429) return "rate_limit";
    if (s >= 500) return "server";
    if (s === 401 || s === 403) return "auth";
    if (s === 400 && /api key|api_key|permission|credential/i.test(`${err.message} ${String(err.responseBody ?? "")}`)) return "auth";
    return "other";
  }
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/timeout|timed out|ETIMEDOUT/i.test(msg)) return "timeout";
  if (/fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|network/i.test(msg)) return "network";
  if (/api key|unauthori[sz]ed|forbidden/i.test(msg)) return "auth";
  return "other";
}

/** Provider hint for how long to wait: Groq says "try again in 12.02s", Google sends RetryInfo "31s", HTTP sends Retry-After. */
export function retryAfterMs(err: unknown): number | null {
  if (!APICallError.isInstance(err)) return null;
  const header = err.responseHeaders?.["retry-after"];
  if (header && /^\d+(\.\d+)?$/.test(header)) return Math.ceil(Number(header) * 1000);
  const text = `${err.message} ${typeof err.responseBody === "string" ? err.responseBody : ""}`;
  const m = /try again in (\d+(?:\.\d+)?)s/i.exec(text) ?? /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(text);
  return m?.[1] ? Math.ceil(Number(m[1]) * 1000) : null;
}

/** Free-tier daily quotas ("GenerateRequestsPerDay...", "requests per day") will not clear in seconds. */
export function isDailyQuota(err: unknown): boolean {
  if (!APICallError.isInstance(err)) return false;
  const text = `${err.message} ${typeof err.responseBody === "string" ? err.responseBody : ""}`;
  return /PerDay|per day|RPD\b/i.test(text);
}

/**
 * Process-wide cooldowns by candidate name, so a model with an exhausted daily quota
 * is not retried (and does not add latency) on every step of every run.
 */
const cooldowns = new Map<string, number>();

export function resetModelCooldowns(): void {
  cooldowns.clear();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function switchMessage(from: ModelCandidate, to: ModelCandidate, reason: FailureReason): string {
  const why =
    reason === "rate_limit" || reason === "server" ? "busy hai"
    : reason === "timeout" ? "der laga raha hai"
    : reason === "auth" ? "ki key kaam nahi kar rahi"
    : reason === "network" ? "tak pahunch nahi paaye"
    : "ne jawab nahi diya";
  const provider = from.label.split(" ")[0] ?? from.label;
  if (to.backupKey) return `${provider} ${why}, backup key se dobara koshish.`;
  return `${provider} ${why}, backup model (${to.label}) use kar rahe hain.`;
}

/** Abort when either the caller aborts or our per-call timeout fires. */
function withTimeout(parent: AbortSignal | undefined, ms: number): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const ctl = new AbortController();
  let fired = false;
  const timer = setTimeout(() => {
    fired = true;
    ctl.abort(new StepTimeoutError(ms));
  }, ms);
  const onParent = () => ctl.abort(parent?.reason);
  if (parent?.aborted) ctl.abort(parent.reason);
  else parent?.addEventListener("abort", onParent, { once: true });
  return {
    signal: ctl.signal,
    timedOut: () => fired,
    done: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParent);
    },
  };
}

export interface FallbackModel extends LanguageModelV4 {
  /** The candidate that answered the most recent call. */
  readonly active: ModelCandidate;
}

export function createFallbackModel(
  candidates: readonly ModelCandidate[],
  opts: {
    onSwitch?: (info: SwitchInfo) => void;
    onWait?: (info: { candidate: ModelCandidate; ms: number; message: string }) => void;
    stepTimeoutMs?: number;
    maxWaitMs?: number;
  } = {},
): FallbackModel {
  if (candidates.length === 0) throw new Error("No model configured: set GEMINI_API_KEY or GROQ_API_KEY in .env.local");
  const stepTimeoutMs = opts.stepTimeoutMs ?? STEP_TIMEOUT_MS;
  let index = 0;

  const maxWaitMs = opts.maxWaitMs ?? MAX_RATE_LIMIT_WAIT_MS;

  async function attempt<R>(call: (m: LanguageModelV4, o: LanguageModelV4CallOptions) => PromiseLike<R>, options: LanguageModelV4CallOptions): Promise<R> {
    try {
      return await chain(call, options, index);
    } catch (err) {
      // Every model is rate limited: if one said "retry in a few seconds", wait once and retry from it.
      if (!(err instanceof AllModelsFailedError) || options.abortSignal?.aborted) throw err;
      const waits = err.attempts.filter((a) => a.reason === "rate_limit" && a.retryMs !== null && a.retryMs <= maxWaitMs);
      const best = waits.sort((a, b) => (a.retryMs ?? 0) - (b.retryMs ?? 0))[0];
      const candidate = best ? candidates[best.index] : undefined;
      if (!best || !candidate) throw err;
      const ms = (best.retryMs ?? 0) + 250;
      opts.onWait?.({ candidate, ms, message: `Sab models abhi busy hain. ${Math.ceil(ms / 1000)} second ruk ke ${candidate.label} se dobara koshish.` });
      await sleep(ms, options.abortSignal);
      return chain(call, options, best.index);
    }
  }

  async function chain<R>(call: (m: LanguageModelV4, o: LanguageModelV4CallOptions) => PromiseLike<R>, options: LanguageModelV4CallOptions, start: number): Promise<R> {
    const attempts: AttemptRecord[] = [];
    const now = Date.now();
    const cooling = (c: ModelCandidate) => (cooldowns.get(c.name) ?? 0) > now;
    // Skip models cooling down, unless every remaining one is (then try anyway).
    const skipCooling = candidates.slice(start).some((c) => !cooling(c));
    /** API keys that answered "invalid key" in this call: every model on that key is skipped. */
    const deadKeys = new Set<string>();
    let lastFailure: { from: ModelCandidate; reason: FailureReason } | null = null;

    const eligible = (c: ModelCandidate, reason: FailureReason | null) => {
      if (skipCooling && cooling(c)) return false;
      if (c.keyGroup && deadKeys.has(c.keyGroup)) return false;
      // A backup key for the same model only helps with quota, overload, timeouts and a bad first key.
      if (c.backupKey && reason && !["rate_limit", "server", "timeout", "auth"].includes(reason)) return false;
      return true;
    };

    for (let i = start; i < candidates.length; i++) {
      const c = candidates[i]!;
      if (!eligible(c, lastFailure?.reason ?? null)) continue;
      if (lastFailure) opts.onSwitch?.({ from: lastFailure.from, to: c, reason: lastFailure.reason, message: switchMessage(lastFailure.from, c, lastFailure.reason) });
      const t = withTimeout(options.abortSignal, stepTimeoutMs);
      try {
        const r = await call(c.model, { ...options, abortSignal: t.signal });
        index = i;
        return r;
      } catch (err) {
        // The owner pressed stop: never fall back, just stop.
        if (options.abortSignal?.aborted) throw err;
        const reason = t.timedOut() ? "timeout" : classifyModelError(err);
        const daily = reason === "rate_limit" && isDailyQuota(err);
        if (daily) cooldowns.set(c.name, Date.now() + DAILY_QUOTA_COOLDOWN_MS);
        if (reason === "auth" && c.keyGroup) deadKeys.add(c.keyGroup);
        attempts.push({
          name: c.name,
          index: i,
          reason,
          message: err instanceof Error ? err.message.slice(0, 300) : String(err),
          retryMs: reason === "rate_limit" && !daily ? retryAfterMs(err) : null,
        });
        console.warn(`[agent] model ${c.name} failed (${reason}): ${attempts.at(-1)?.message}`);
        lastFailure = { from: c, reason };
      } finally {
        t.done();
      }
    }
    throw new AllModelsFailedError(attempts);
  }

  const first = candidates[0]!;
  return {
    specificationVersion: "v4",
    provider: "bahi-fallback",
    modelId: candidates.map((c) => c.model.modelId).join(" > "),
    get supportedUrls() {
      return first.model.supportedUrls;
    },
    get active() {
      return candidates[index] ?? first;
    },
    doGenerate: (options) => attempt((m, o) => m.doGenerate(o), options),
    doStream: (options) => attempt((m, o) => m.doStream(o), options),
  };
}

function modelList(value: string | undefined, fallback: string): string[] {
  return (value ?? fallback)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

/**
 * Candidates from env, in fallback order: each Gemini model with the main key, then the
 * same model with GEMINI_API_KEY_BACKUP, then each Groq model.
 */
export function modelCandidatesFromEnv(): ModelCandidate[] {
  const env = getEnv();
  const out: ModelCandidate[] = [];
  const google = env.GEMINI_API_KEY ? createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY }) : null;
  const googleBackup = env.GEMINI_API_KEY_BACKUP ? createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY_BACKUP }) : null;
  modelList(env.GEMINI_MODEL, DEFAULT_GEMINI_MODELS).forEach((id, i) => {
    const suffix = i === 0 ? "" : `-${i + 1}`;
    if (google) out.push({ name: `gemini${suffix}`, label: `Gemini ${id}`, model: google(id), keyGroup: "gemini-main" });
    if (googleBackup) out.push({ name: `gemini-backup${suffix}`, label: `Gemini ${id} (backup key)`, model: googleBackup(id), backupKey: Boolean(google), keyGroup: "gemini-backup" });
  });
  if (env.GROQ_API_KEY) {
    const groq = createGroq({ apiKey: env.GROQ_API_KEY });
    modelList(env.GROQ_MODEL, DEFAULT_GROQ_MODELS).forEach((id, i) => out.push({ name: i === 0 ? "groq" : `groq-${i + 1}`, label: `Groq ${id}`, model: groq(id), keyGroup: "groq" }));
  }
  return out;
}

/**
 * Provider options for every call. Keyed by provider, so each model only reads its own:
 * low thinking keeps Gemini Flash fast enough for a live console.
 */
export const AGENT_PROVIDER_OPTIONS = {
  google: { thinkingConfig: { thinkingLevel: "low" } },
  groq: { reasoningEffort: "low", parallelToolCalls: true },
} as const;
