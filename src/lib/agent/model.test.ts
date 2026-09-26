import { APICallError, type LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";
import { AllModelsFailedError, classifyModelError, createFallbackModel, resetModelCooldowns, retryAfterMs, type ModelCandidate, type SwitchInfo } from "./model";

function ok(text: string): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  };
}

function apiError(statusCode: number, message = `HTTP ${statusCode}`): APICallError {
  return new APICallError({ message, url: "https://example.test", requestBodyValues: {}, statusCode, isRetryable: statusCode >= 500 || statusCode === 429 });
}

function candidate(name: string, behaviour: () => Promise<LanguageModelV4GenerateResult>): ModelCandidate & { calls: () => number } {
  let n = 0;
  const model = new MockLanguageModelV4({
    provider: name,
    modelId: name,
    doGenerate: async () => {
      n++;
      return behaviour();
    },
  });
  return { name, label: name === "groq" ? "Groq test" : "Gemini test", model, calls: () => n };
}

beforeEach(() => resetModelCooldowns());

describe("createFallbackModel", () => {
  it("uses the primary model when it answers", async () => {
    const gemini = candidate("gemini", async () => ok("from gemini"));
    const groq = candidate("groq", async () => ok("from groq"));
    const model = createFallbackModel([gemini, groq]);
    const r = await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(r.text).toBe("from gemini");
    expect(groq.calls()).toBe(0);
  });

  it("retries once with the backup key on a rate limit, then succeeds", async () => {
    const switches: SwitchInfo[] = [];
    const gemini = candidate("gemini", async () => {
      throw apiError(429);
    });
    const backup = { ...candidate("gemini-backup", async () => ok("from backup")), backupKey: true };
    const groq = candidate("groq", async () => ok("from groq"));
    const model = createFallbackModel([gemini, backup, groq], { onSwitch: (s) => switches.push(s) });
    const r = await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(r.text).toBe("from backup");
    expect(switches.map((s) => [s.from.name, s.to.name, s.reason])).toEqual([["gemini", "gemini-backup", "rate_limit"]]);
    expect(switches[0]?.message).toMatch(/busy hai, backup key/);
    expect(groq.calls()).toBe(0);
  });

  it("falls through to Groq on 5xx from both Gemini keys and says so", async () => {
    const switches: SwitchInfo[] = [];
    const gemini = candidate("gemini", async () => {
      throw apiError(503, "This model is currently experiencing high demand");
    });
    const backup = candidate("gemini-backup", async () => {
      throw apiError(503);
    });
    const groq = candidate("groq", async () => ok("from groq"));
    const model = createFallbackModel([gemini, backup, groq], { onSwitch: (s) => switches.push(s) });
    const r = await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(r.text).toBe("from groq");
    expect(switches.map((s) => s.to.name)).toEqual(["gemini-backup", "groq"]);
    expect(switches[1]?.message).toBe("Gemini busy hai, backup model (Groq test) use kar rahe hain.");
    expect(model.active.name).toBe("groq");
  });

  it("falls back to Groq on an invalid Gemini key (the DoD check)", async () => {
    const gemini = candidate("gemini", async () => {
      throw apiError(400, "API key not valid. Please pass a valid API key.");
    });
    const groq = candidate("groq", async () => ok("from groq"));
    const switches: SwitchInfo[] = [];
    const model = createFallbackModel([gemini, groq], { onSwitch: (s) => switches.push(s) });
    expect((await generateText({ model, prompt: "hi", maxRetries: 0 })).text).toBe("from groq");
    expect(switches[0]?.reason).toBe("auth");
  });

  it("treats a slow model as a timeout and moves on", async () => {
    const gemini = candidate("gemini", () => new Promise(() => undefined));
    const groq = candidate("groq", async () => ok("from groq"));
    const switches: SwitchInfo[] = [];
    const model = createFallbackModel([gemini, groq], { stepTimeoutMs: 30, onSwitch: (s) => switches.push(s) });
    // The mock ignores the abort signal, so race it the way a real fetch would end.
    gemini.model.doGenerate = (o) =>
      new Promise((_, reject) => o.abortSignal?.addEventListener("abort", () => reject(o.abortSignal?.reason), { once: true }));
    expect((await generateText({ model, prompt: "hi", maxRetries: 0 })).text).toBe("from groq");
    expect(switches[0]?.reason).toBe("timeout");
  });

  it("moves on even when a stalled model ignores the abort signal", async () => {
    const gemini = candidate("gemini", () => new Promise(() => undefined));
    const groq = candidate("groq", async () => ok("from groq"));
    const switches: SwitchInfo[] = [];
    const model = createFallbackModel([gemini, groq], { stepTimeoutMs: 30, onSwitch: (s) => switches.push(s) });
    expect((await generateText({ model, prompt: "hi", maxRetries: 0 })).text).toBe("from groq");
    expect(switches[0]?.reason).toBe("timeout");
  });

  it("stays on the fallback for later steps of the same run", async () => {
    let geminiCalls = 0;
    const gemini = candidate("gemini", async () => {
      geminiCalls++;
      throw apiError(429);
    });
    const groq = candidate("groq", async () => ok("groq"));
    const model = createFallbackModel([gemini, groq]);
    await generateText({ model, prompt: "one", maxRetries: 0 });
    await generateText({ model, prompt: "two", maxRetries: 0 });
    expect(geminiCalls).toBe(1);
    expect(groq.calls()).toBe(2);
  });

  it("does not fall back when the owner aborts", async () => {
    const ctl = new AbortController();
    const gemini = candidate("gemini", async () => {
      ctl.abort();
      throw new DOMException("aborted", "AbortError");
    });
    const groq = candidate("groq", async () => ok("groq"));
    const model = createFallbackModel([gemini, groq]);
    await expect(generateText({ model, prompt: "hi", maxRetries: 0, abortSignal: ctl.signal })).rejects.toThrow();
    expect(groq.calls()).toBe(0);
  });

  it("reports every attempt when all models fail", async () => {
    const gemini = candidate("gemini", async () => {
      throw apiError(500);
    });
    const groq = candidate("groq", async () => {
      throw apiError(429);
    });
    const model = createFallbackModel([gemini, groq]);
    const err = await generateText({ model, prompt: "hi", maxRetries: 0 }).catch((e: unknown) => e);
    const inner = err instanceof AllModelsFailedError ? err : (err as { cause?: unknown }).cause ?? err;
    expect(String((inner as Error).message)).toMatch(/gemini \(server\).*groq \(rate_limit\)/);
  });
});

describe("rate limit waits", () => {
  it("waits for a short retry hint once when every model is rate limited", async () => {
    let groqCalls = 0;
    const gemini = candidate("gemini", async () => {
      throw apiError(429);
    });
    const groq: ModelCandidate = {
      name: "groq",
      label: "Groq test",
      model: new MockLanguageModelV4({
        doGenerate: async () => {
          groqCalls++;
          if (groqCalls === 1) throw apiError(429, "Rate limit reached on tokens per minute. Please try again in 0.05s.");
          return ok("after wait");
        },
      }),
    };
    const waits: number[] = [];
    const model = createFallbackModel([gemini, groq], { onWait: (w) => waits.push(w.ms) });
    expect((await generateText({ model, prompt: "hi", maxRetries: 0 })).text).toBe("after wait");
    expect(waits).toHaveLength(1);
    expect(retryAfterMs(apiError(429, "Please try again in 12.02s."))).toBe(12_020);
  });

  it("does not wait for long retry hints", async () => {
    const gemini = candidate("gemini", async () => {
      throw apiError(429, "try again in 90s");
    });
    const model = createFallbackModel([gemini], { onWait: () => undefined });
    await expect(generateText({ model, prompt: "hi", maxRetries: 0 })).rejects.toThrow();
  });
});

describe("daily quota cooldown", () => {
  it("skips a model with an exhausted daily quota on later calls, across runs", async () => {
    const daily = () => apiError(429, "Quota exceeded for metric generate_content_free_tier_requests, quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier");
    const gemini = candidate("gemini", async () => {
      throw daily();
    });
    const groq = candidate("groq", async () => ok("groq"));
    await generateText({ model: createFallbackModel([gemini, groq]), prompt: "one", maxRetries: 0 });
    await generateText({ model: createFallbackModel([gemini, groq]), prompt: "two", maxRetries: 0 });
    expect(gemini.calls()).toBe(1);
    expect(groq.calls()).toBe(2);
  });

  it("still tries a cooling model when nothing else is left", async () => {
    let n = 0;
    const gemini = candidate("gemini", async () => {
      n++;
      if (n === 1) throw apiError(429, "requests per day exceeded");
      return ok("back");
    });
    await expect(generateText({ model: createFallbackModel([gemini]), prompt: "one", maxRetries: 0 })).rejects.toThrow();
    expect((await generateText({ model: createFallbackModel([gemini]), prompt: "two", maxRetries: 0 })).text).toBe("back");
  });
});

describe("invalid key", () => {
  it("skips every model on a key that was rejected, with one switch message", async () => {
    const bad = (name: string) => ({ ...candidate(name, async () => { throw apiError(400, "API key not valid. Please pass a valid API key."); }), keyGroup: "gemini-main" });
    const g1 = bad("gemini");
    const g2 = bad("gemini-2");
    const groq = { ...candidate("groq", async () => ok("groq")), keyGroup: "groq" };
    const switches: SwitchInfo[] = [];
    const model = createFallbackModel([g1, g2, groq], { onSwitch: (s) => switches.push(s) });
    expect((await generateText({ model, prompt: "hi", maxRetries: 0 })).text).toBe("groq");
    expect(g2.calls()).toBe(0);
    expect(switches.map((s) => s.to.name)).toEqual(["groq"]);
  });
});

describe("classifyModelError", () => {
  it("maps provider errors", () => {
    expect(classifyModelError(apiError(429))).toBe("rate_limit");
    expect(classifyModelError(apiError(503))).toBe("server");
    expect(classifyModelError(apiError(403))).toBe("auth");
    expect(classifyModelError(apiError(400, "API key not valid"))).toBe("auth");
    expect(classifyModelError(apiError(400, "bad schema"))).toBe("other");
    expect(classifyModelError(new TypeError("fetch failed"))).toBe("network");
  });
});
