import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env";
import { parseRunEventLine, toNdjsonLine } from "./events";
import { getInvoices, getMockRunHistory, getScript, materializeScript } from "./fixtures";
import { summarizeHisaab } from "./ledger";
import { recordFromEvents } from "./run-record";
import { createRunStore } from "./store/runs";

describe("env", () => {
  it("applies defaults for an empty environment", () => {
    const env = parseEnv({});
    expect(env).toMatchObject({
      SWYTCH_MODE: "mock",
      APPROVAL_THRESHOLD_INR: 50000,
      REFUND_BLOCK_THRESHOLD_INR: 10000,
      BUSINESS_NAME: "DukaanSetu",
      SLACK_OPS_CHANNEL: "bahi-ops",
      PAYPAL_CURRENCY: "INR",
      SWYTCH_TRANSPORT: "cli",
      SWYTCH_TIMEOUT_MS: 45000,
    });
  });

  it("treats blank values as unset and strips # from channels", () => {
    const env = parseEnv({ GEMINI_API_KEY: "", APPROVAL_THRESHOLD_INR: " ", SLACK_OPS_CHANNEL: "#ops" });
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.APPROVAL_THRESHOLD_INR).toBe(50000);
    expect(env.SLACK_OPS_CHANNEL).toBe("ops");
  });

  it("gives clear errors without echoing secrets", () => {
    const messageFor = (source: Record<string, string>) => {
      try {
        parseEnv(source);
      } catch (e) {
        expect(e).toBeInstanceOf(EnvError);
        return (e as EnvError).message;
      }
      throw new Error("expected parseEnv to throw");
    };
    expect(messageFor({ APPROVAL_THRESHOLD_INR: "abc" })).toMatch(/APPROVAL_THRESHOLD_INR: must be a whole rupee amount/);
    // Cross-field rules run once every field is individually valid (zod 4 behaviour).
    expect(messageFor({ REFUND_BLOCK_THRESHOLD_INR: "9999999" })).toMatch(/REFUND_BLOCK_THRESHOLD_INR: looks too high/);
    expect(messageFor({ SWYTCH_MODE: "live", GROQ_API_KEY: "gsk-secret-value", REFUND_BLOCK_THRESHOLD_INR: "9999999" })).not.toMatch(/gsk-secret-value/);
    expect(messageFor({ PAYPAL_CURRENCY: "EUR" })).toMatch(/PAYPAL_CURRENCY: must be "INR" or "USD"/);
    // Integrations can run live before the agent (phase 3) has a model key.
    expect(() => parseEnv({ SWYTCH_MODE: "live" })).not.toThrow();
  });
});

describe("NDJSON events", () => {
  it("round-trips and rejects junk", () => {
    const [first] = materializeScript(getScript("s2-approval"), { runId: "r1", startedAt: new Date() });
    if (!first) throw new Error("empty script");
    expect(parseRunEventLine(toNdjsonLine(first))).toEqual(first);
    expect(parseRunEventLine("")).toBeNull();
    expect(parseRunEventLine("{not json")).toBeNull();
    expect(parseRunEventLine(JSON.stringify({ type: "final" }))).toBeNull();
  });
});

describe("fixtures and hisaab", () => {
  it("summarizes the mock ledger", () => {
    const now = new Date("2026-09-26T08:44:00Z");
    expect(summarizeHisaab(getInvoices(now), now)).toEqual({
      toReceive: 69000,
      toReceiveCount: 4,
      overdue: 50500,
      overdueCount: 2,
      receivedToday: 33500,
      receivedTodayCount: 2,
    });
  });

  it("builds mock history newest first", () => {
    const runs = getMockRunHistory(new Date("2026-09-26T08:44:00Z"));
    expect(runs.map((r) => r.status)).toEqual(["completed", "completed", "blocked", "denied", "completed"]);
  });
});

describe("run store", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("saves, lists newest first, upserts and survives a corrupt file", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "bahi-runs-"));
    const file = path.join(dir, "runs.json");
    const store = createRunStore(file);
    expect(await store.list()).toEqual([]);

    const older = recordFromEvents(materializeScript(getScript("s1-invoice"), { runId: "a", startedAt: new Date("2026-09-26T08:00:00Z") }));
    const newer = recordFromEvents(materializeScript(getScript("s5-refund-blocked"), { runId: "b", startedAt: new Date("2026-09-26T09:00:00Z") }));
    if (!older || !newer) throw new Error("record build failed");

    await Promise.all([store.save(older), store.save(newer), store.save(older)]);
    expect((await store.list()).map((r) => r.runId)).toEqual(["b", "a"]);
    expect((await store.get("b"))?.status).toBe("blocked");
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(1);

    await writeFile(file, "{broken", "utf8");
    expect(await store.list()).toEqual([]);
    await store.save(older);
    expect((await store.list()).map((r) => r.runId)).toEqual(["a"]);
  });
});
