import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";
import { createIntegrations } from "../integrations";
import { resetMockWorld } from "../integrations/mock/world";
import { recordFromEvents } from "../run-record";
import { foldRunEvents } from "../run-reducer";
import { clampWords, runAgent, summaryFromState } from "./orchestrator";
import { createRunState } from "./tools";

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

function toolStep(calls: { name: string; input: unknown }[]): LanguageModelV4GenerateResult {
  return {
    content: calls.map((c, i) => ({ type: "tool-call" as const, toolCallId: `call_${c.name}_${i}_${Math.random().toString(36).slice(2, 6)}`, toolName: c.name, input: JSON.stringify(c.input) })),
    finishReason: { unified: "tool-calls", raw: "tool_calls" },
    usage,
    warnings: [],
  };
}

/** A model that plays S1 like a well-behaved LLM would. */
function scriptedS1(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: [
      toolStep([{ name: "find_client", input: { name: "Sharma Traders" } }]),
      toolStep([{ name: "create_and_send_invoice", input: { clientId: "cl_sharma", amountInr: 15000, amountPhrase: "15,000", description: "website redesign", dueInDays: 7 } }]),
      toolStep([{ name: "notify_team", input: { kind: "update", text: "Invoice ₹15,000 sent to Sharma Traders for website redesign." } }]),
      toolStep([
        {
          name: "final_answer",
          input: {
            reply: "Sharma Traders ko ₹15,000 ka invoice bhej diya.\nNotion mein Sent likha, team ko Slack par bataya.",
            speak: "Sharma Traders ko pandrah hazaar ka invoice bhej diya hai, aur team ko bhi bata diya hai, sab theek hai ji bilkul.",
          },
        },
      ]),
    ],
  });
}

beforeEach(() => {
  resetMockWorld(new Date("2026-09-25T06:00:00Z"));
});

describe("runAgent", () => {
  it("streams S1 in order: every Swytchcode call, then speak and final", async () => {
    const seen: number[] = [];
    const r = await runAgent(
      { text: "Sharma Traders ko website redesign ke liye 15,000 ka invoice bhejo", source: "text" },
      { integrations: createIntegrations("mock"), model: scriptedS1(), onEvent: (e) => seen.push(e.seq) },
    );
    expect(seen).toEqual(r.events.map((_, i) => i + 1));
    expect(r.toolSequence).toEqual(["find_client", "create_and_send_invoice", "notify_team", "final_answer"]);

    const types = r.events.map((e) => (e.type === "tool_call" ? `call:${e.tool}` : e.type));
    expect(types).toEqual([
      "run_started",
      "thinking",
      "call:invoices.invoicing.invoices.create",
      "tool_result",
      "call:invoices.invoicing.send.create",
      "tool_result",
      "call:notion.page.create",
      "tool_result",
      "call:slack.chat.postmessage.create",
      "tool_result",
      "speak",
      "final",
    ]);
    const speak = r.events.find((e) => e.type === "speak");
    expect(speak?.type === "speak" && speak.text.split(" ").length).toBeLessThanOrEqual(20);

    const view = foldRunEvents(r.events);
    expect(view.status).toBe("completed");
    expect(view.stamp).toBe("sent");
    expect(recordFromEvents(r.events)?.status).toBe("completed");
  });

  it("stops when the owner aborts and says so", async () => {
    const ctl = new AbortController();
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        ctl.abort();
        throw new DOMException("aborted", "AbortError");
      },
    });
    const r = await runAgent({ text: "Aaj ka hisaab batao", source: "text" }, { integrations: createIntegrations("mock"), model, signal: ctl.signal });
    const last = r.events.at(-1);
    expect(last).toMatchObject({ type: "error", recoverable: false });
    expect(foldRunEvents(r.events).status).toBe("failed");
  });
});

describe("helpers", () => {
  it("clamps spoken text to 20 words", () => {
    const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    expect(clampWords(long).split(" ")).toHaveLength(20);
    expect(clampWords("Sab theek hai.")).toBe("Sab theek hai.");
  });

  it("builds an honest summary from tool results when the model gives out", () => {
    const s = createRunState();
    expect(summaryFromState(s)).toBeNull();
    s.moneyActions.push("Invoice INV-1 ₹15,000 to Sharma Traders");
    s.slackUpdates = 1;
    expect(summaryFromState(s)).toBe("Ho gaya: Invoice INV-1 ₹15,000 to Sharma Traders; team ko Slack par update kiya.");
  });
});
