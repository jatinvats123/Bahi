import "server-only";
import { randomUUID } from "node:crypto";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { generateText, hasToolCall, isStepCount } from "ai";
import { getClientDirectory } from "../clients";
import { getEnv } from "../env";
import type { RunEvent, RunEventDraft } from "../events";
import { getIntegrations } from "../integrations";
import type { Integrations } from "../integrations/types";
import { AGENT_PROVIDER_OPTIONS, AllModelsFailedError, createFallbackModel, modelCandidatesFromEnv, type FallbackModel } from "./model";
import { buildSystemPrompt, detectOwnerLanguage, MAX_SPEAK_WORDS, MAX_STEPS } from "./prompt";
import { createAgentTools, createRunState, type AgentRunState, type AgentToolName } from "./tools";

/**
 * Runs one owner command end to end: stamps and streams RunEvents, runs the
 * AI SDK tool loop (bounded at MAX_STEPS) with model fallback, and always ends the
 * run with speak + final, or a plain-language error.
 */

export interface RunRequest {
  text: string;
  source: "text" | "voice";
}

export interface RunOptions {
  /** Called for every stamped event, in seq order. */
  onEvent?: (event: RunEvent) => void;
  /** Owner pressed stop, or the browser went away. */
  signal?: AbortSignal;
  runId?: string;
  integrations?: Integrations;
  now?: () => Date;
  /** Tests inject a model; otherwise Gemini -> backup key -> Groq from env. */
  model?: LanguageModelV4;
  /** Whole-run budget. */
  totalTimeoutMs?: number;
}

export interface RunResult {
  runId: string;
  events: RunEvent[];
  /** Agent tool names in call order (the eval asserts on this). */
  toolSequence: AgentToolName[];
  /** Agent tool calls with the model's inputs, in call order. */
  toolCalls: { name: AgentToolName; input: unknown }[];
  /** What each agent tool returned to the model (scenario checks read real ids from here). */
  toolResults: { name: AgentToolName; output: unknown }[];
  reply: string | null;
  model: string | null;
}

export const RUN_TIMEOUT_MS = 180_000;

export function newRunId(): string {
  return `run_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
}

/** At most `max` words; trailing punctuation kept tidy. */
export function clampWords(text: string, max = MAX_SPEAK_WORDS): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return `${words.slice(0, max).join(" ").replace(/[,;:]+$/, "")}.`;
}

/**
 * When a model ends the loop without final_answer (or text), say what actually happened,
 * built only from tool results, instead of pretending nothing was done.
 */
export function summaryFromState(state: AgentRunState): string | null {
  const parts = [...state.facts, ...state.moneyActions];
  if (state.blocked) parts.push(`policy ne roka (${state.blocked.policyId})`);
  if (state.alerts.size) parts.push(`${state.alerts.size} Slack alert bheja`);
  if (state.slackUpdates) parts.push("team ko Slack par update kiya");
  return parts.length ? `Ho gaya: ${parts.join("; ")}.` : null;
}

function firstSentence(text: string): string {
  return text.split(/(?<=[.!?।])\s+|\n/)[0] ?? text;
}

export async function runAgent(req: RunRequest, opts: RunOptions = {}): Promise<RunResult> {
  const env = getEnv();
  const integrations = opts.integrations ?? getIntegrations();
  const now = opts.now ?? (() => new Date());
  const runId = opts.runId ?? newRunId();
  const events: RunEvent[] = [];
  let seq = 0;

  const emit = (draft: RunEventDraft) => {
    seq += 1;
    const event = { ...draft, runId, seq, ts: now().toISOString() } as RunEvent;
    events.push(event);
    try {
      opts.onEvent?.(event);
    } catch (e) {
      console.warn("[agent] onEvent listener failed", e);
    }
  };

  const text = req.text.trim().slice(0, 1000);
  emit({ type: "run_started", command: text, inputMode: req.source, mode: integrations.mode });

  const toolSequence: AgentToolName[] = [];
  const toolCalls: RunResult["toolCalls"] = [];
  const toolResults: RunResult["toolResults"] = [];
  const done = (reply: string | null, model: string | null): RunResult => ({ runId, events, toolSequence, toolCalls, toolResults, reply, model });

  let model: LanguageModelV4 | FallbackModel;
  try {
    model =
      opts.model ??
      createFallbackModel(modelCandidatesFromEnv(), {
        onSwitch: (s) => emit({ type: "thinking", text: s.message }),
        onWait: (w) => emit({ type: "thinking", text: w.message }),
      });
  } catch {
    emit({ type: "error", recoverable: false, message: "Koi AI model set nahi hai. .env.local mein GEMINI_API_KEY ya GROQ_API_KEY daalo." });
    return done(null, null);
  }

  const state = createRunState();
  const controller = new AbortController();
  const onAbort = () => controller.abort(opts.signal?.reason);
  if (opts.signal?.aborted) controller.abort(opts.signal.reason);
  else opts.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("run timeout")), opts.totalTimeoutMs ?? RUN_TIMEOUT_MS);

  const tools = createAgentTools({
    integrations,
    emit,
    command: text,
    clients: getClientDirectory(),
    config: {
      businessName: env.BUSINESS_NAME,
      approvalThresholdInr: env.APPROVAL_THRESHOLD_INR,
      opsChannel: env.SLACK_OPS_CHANNEL,
      approvalsChannel: env.SLACK_APPROVALS_CHANNEL,
    },
    now,
    signal: controller.signal,
    state,
  });

  const modelLabel = () => ("active" in model ? (model as FallbackModel).active.label : model.modelId);

  try {
    const result = await generateText({
      model,
      instructions: buildSystemPrompt({
        now: now(),
        businessName: env.BUSINESS_NAME,
        approvalThresholdInr: env.APPROVAL_THRESHOLD_INR,
        opsChannel: env.SLACK_OPS_CHANNEL,
        language: detectOwnerLanguage(text),
      }),
      prompt: text,
      tools,
      stopWhen: [isStepCount(MAX_STEPS), hasToolCall("final_answer")],
      maxRetries: 0,
      temperature: 0.2,
      abortSignal: controller.signal,
      providerOptions: AGENT_PROVIDER_OPTIONS,
      onToolExecutionStart: ({ toolCall }) => {
        toolSequence.push(toolCall.toolName as AgentToolName);
        toolCalls.push({ name: toolCall.toolName as AgentToolName, input: toolCall.input });
      },
      onToolExecutionEnd: ({ toolCall, toolOutput }) => {
        toolResults.push({ name: toolCall.toolName as AgentToolName, output: toolOutput.type === "tool-error" ? { ok: false, error: String(toolOutput.error) } : toolOutput.output });
      },
      onStepEnd: ({ text: stepText, toolCalls }) => {
        // Model narration between tool calls is shown as a quiet "thinking" line.
        const said = stepText.trim();
        if (said && toolCalls.length > 0) emit({ type: "thinking", text: said.slice(0, 280) });
      },
    });

    const reply = (state.final?.reply ?? (result.text.trim() || summaryFromState(state) || "")).trim();
    if (!reply) {
      emit({ type: "error", recoverable: true, message: `Kaam ${MAX_STEPS} kadam mein poora nahi hua. Jo hua woh upar likha hai; baaki dobara bolo.` });
      emit({ type: "final", summary: "Kaam adhoora raha. Upar ke kadam dekhein." });
      return done(null, modelLabel());
    }
    const speak = clampWords(state.final?.speak ?? firstSentence(reply));
    emit({ type: "speak", text: speak });
    emit({ type: "final", summary: reply });
    return done(reply, modelLabel());
  } catch (err) {
    if (opts.signal?.aborted) {
      emit({ type: "error", recoverable: false, message: "Aapne run rok diya. Jo kadam ho chuke the woh upar likhe hain." });
    } else if (controller.signal.aborted) {
      emit({ type: "error", recoverable: false, message: "Run bahut der chala, isliye roka gaya. Dobara koshish karein." });
    } else if (err instanceof AllModelsFailedError || (err as { cause?: unknown })?.cause instanceof AllModelsFailedError) {
      console.error("[agent] all models failed", err);
      const partial = summaryFromState(state);
      if (partial) {
        // Tools already acted: report what really happened instead of hiding it behind an error.
        emit({ type: "error", recoverable: true, message: "AI models busy ho gaye, isliye aakhri jawab Bahi ne khud likha." });
        emit({ type: "speak", text: clampWords(partial) });
        emit({ type: "final", summary: partial });
        return done(partial, null);
      }
      emit({ type: "error", recoverable: false, message: "Abhi koi AI model jawab nahi de raha. Thodi der baad dobara koshish karein." });
    } else {
      console.error("[agent] run failed", err);
      emit({ type: "error", recoverable: false, message: "Kuch gadbad hui, kaam poora nahi hua. Activity page par detail hai." });
    }
    return done(null, null);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
