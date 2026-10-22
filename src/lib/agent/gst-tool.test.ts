import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import clientsJson from "@fixtures/clients.json";
import type { RunEventDraft } from "../events";
import type { GstLookup, GstPassage } from "../gst/niyam";
import { createIntegrations } from "../integrations";
import { resetMockWorld } from "../integrations/mock/world";
import { ClientSchema } from "../ledger";
import { createAgentTools, createRunState, type AgentToolContext } from "./tools";

const NOW = new Date("2026-09-25T06:00:00Z");
const clients = clientsJson.map((c) => ClientSchema.parse(c));

const PASSAGE: GstPassage = {
  circular: "230/24/2024-GST",
  date: "2024-09-11",
  subject: "Clarification in respect of advertising services provided to foreign clients.",
  pages: "pages 1-2",
  text: "Advertising services provided to foreign clients qualify as export of services when the conditions of section 2(6) are met. ".repeat(10),
};

function fakeNiyam(result: GstPassage[] | Error): GstLookup & { questions: string[] } {
  const questions: string[] = [];
  return {
    questions,
    async search(question) {
      questions.push(question);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function setup(gst: GstLookup | null) {
  const events: RunEventDraft[] = [];
  const ctx: AgentToolContext = {
    integrations: createIntegrations("mock"),
    emit: (e) => events.push(e),
    command: "Foreign client ko advertising ka invoice bhejna hai, GST lagega?",
    clients,
    config: { businessName: "DukaanSetu", approvalThresholdInr: 50_000, opsChannel: "bahi-ops", approvalsChannel: "approvals" },
    now: () => NOW,
    state: createRunState(),
    gst,
  };
  const tools = createAgentTools(ctx);
  const check = async (question: string): Promise<Record<string, unknown>> => {
    const t = tools.check_gst_rules as unknown as { execute: (i: unknown, o: unknown) => Promise<Record<string, unknown>>; inputSchema: z.ZodType };
    return t.execute(t.inputSchema.parse({ question }), { toolCallId: "t1", messages: [] });
  };
  return { check, events, ctx };
}

beforeEach(() => resetMockWorld(NOW));

describe("check_gst_rules", () => {
  it("says it is not set up, and never states a rule, when Niyam is not configured", async () => {
    const { check } = setup(null);
    const r = await check("Is advertising to a foreign client an export?");
    expect(r).toMatchObject({ ok: false, error: "not_configured" });
    expect(String(r.hint)).toMatch(/Do not state a rule/);
  });

  it("returns cited passages, records the circular for the audit trail and shows it in the timeline", async () => {
    const niyam = fakeNiyam([PASSAGE]);
    const { check, events, ctx } = setup(niyam);
    const r = await check("Is advertising to a foreign client an export?");
    expect(niyam.questions).toEqual(["Is advertising to a foreign client an export?"]);
    expect(r).toMatchObject({ ok: true, found: true });
    const passages = r.passages as Array<Record<string, string>>;
    expect(passages[0]).toMatchObject({ circular: "230/24/2024-GST", date: "2024-09-11", pages: "pages 1-2" });
    expect(passages[0]?.excerpt?.length).toBeLessThanOrEqual(900);
    expect(ctx.state.gstCitations).toEqual(["230/24/2024-GST"]);
    expect(events.some((e) => e.type === "thinking" && e.text.includes("230/24/2024-GST"))).toBe(true);
  });

  it("does not repeat a circular in the audit trail across lookups", async () => {
    const { check, ctx } = setup(fakeNiyam([PASSAGE, PASSAGE]));
    await check("first question about exports");
    await check("second question about exports");
    expect(ctx.state.gstCitations).toEqual(["230/24/2024-GST"]);
  });

  it("tells the model not to state a rule when no circular covers the question", async () => {
    const { check } = setup(fakeNiyam([]));
    const r = await check("What is the income tax slab?");
    expect(r).toMatchObject({ ok: true, found: false });
    expect(String(r.hint)).toMatch(/do not state a rule/);
  });

  it("turns a Niyam failure into a plain failure instead of crashing the run", async () => {
    const { check } = setup(fakeNiyam(new Error("MCP server exited")));
    const r = await check("Is advertising to a foreign client an export?");
    expect(r).toMatchObject({ ok: false, error: "internal" });
  });
});
