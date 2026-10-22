import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter, clientIp } from "@/lib/rate-limit";

/**
 * DEMO_PUBLIC=1, the public demo. Each test sets its environment and imports the app fresh,
 * because getEnv(), the stores and the rate limiter are created once per module instance.
 */

// Re-importing the route graph takes seconds when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });

// Fake values that must never be used. If one were, the spies below would see the call.
const HOSTILE_ENV = {
  DEMO_PUBLIC: "1",
  AGENT_MODE: "live",
  SWYTCH_MODE: "live",
  GEMINI_API_KEY: "fake-gemini-key",
  GEMINI_API_KEY_BACKUP: "fake-gemini-backup-key",
  GROQ_API_KEY: "fake-groq-key",
  NIYAM_MCP_COMMAND: "python-that-must-not-start",
  NOTION_LEDGER_DATABASE_ID: "fake-notion-db",
  BUSINESS_EMAIL: "owner@example.com",
  REPLAY_SPEED: "50",
};

// The only doors to the outside: the Swytchcode CLI/SDK (PayPal, Gmail, Slack, Notion, Jira), the model, Niyam.
const outside = vi.hoisted(() => {
  const never = (what: string) => () => {
    throw new Error(`the public demo must not call ${what}`);
  };
  return { runCli: vi.fn(never("swytchcode")), runSdk: vi.fn(never("swytchcode")), runCliText: vi.fn(never("swytchcode")), generateText: vi.fn(never("a model")), niyamFromEnv: vi.fn(never("Niyam")) };
});
vi.mock("@/lib/swytch/transport", async (importOriginal) => ({ ...(await importOriginal<object>()), runCli: outside.runCli, runSdk: outside.runSdk, runCliText: outside.runCliText }));
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<object>()), generateText: outside.generateText }));
vi.mock("@/lib/gst/niyam", async (importOriginal) => ({ ...(await importOriginal<object>()), niyamFromEnv: outside.niyamFromEnv }));

async function freshApp(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const g = globalThis as Record<symbol, unknown>;
  delete g[Symbol.for("bahi.approvalStore")];
  delete g[Symbol.for("bahi.runBus")];
  return { runs: await import("@/app/api/runs/route"), bus: (await import("@/lib/store/run-bus")).getRunBus() };
}

const post = (body: unknown, ip = "203.0.113.7") =>
  new Request("http://localhost/api/runs", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });

async function readEvents(res: Response): Promise<{ type: string; [k: string]: unknown }[]> {
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string });
}

function expectNothingLeftTheServer() {
  for (const fn of Object.values(outside)) expect(fn).not.toHaveBeenCalled();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("DEMO_PUBLIC=1 locks the app to recorded runs on mock data", () => {
  it("wins over AGENT_MODE=live, SWYTCH_MODE=live and model keys", async () => {
    await freshApp(HOSTILE_ENV);
    const env = (await import("@/lib/env")).getEnv();
    expect(env).toMatchObject({ DEMO_PUBLIC: true, AGENT_MODE: "replay", SWYTCH_MODE: "mock" });
    expect([env.GEMINI_API_KEY, env.GEMINI_API_KEY_BACKUP, env.GROQ_API_KEY, env.NOTION_LEDGER_DATABASE_ID, env.BUSINESS_EMAIL]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect((await import("@/lib/agent/model")).modelCandidatesFromEnv()).toEqual([]);
    expect((await import("@/lib/integrations")).getIntegrations().mode).toBe("mock");
    expect((await import("@/lib/config")).getPublicConfig()).toMatchObject({
      publicDemo: true,
      mode: "mock",
      agentMode: "replay",
      businessEmail: null,
      models: { gemini: { configured: false, backupKey: false }, groq: { configured: false } },
    });
  });

  it("is off unless DEMO_PUBLIC is 1 or true, and rejects other values", async () => {
    const { parseEnv } = await import("@/lib/env");
    expect(parseEnv({ AGENT_MODE: "live" })).toMatchObject({ DEMO_PUBLIC: false, AGENT_MODE: "live" });
    expect(parseEnv({ DEMO_PUBLIC: "0", AGENT_MODE: "live" }).AGENT_MODE).toBe("live");
    expect(parseEnv({ DEMO_PUBLIC: " TRUE ", AGENT_MODE: "live" })).toMatchObject({ DEMO_PUBLIC: true, AGENT_MODE: "replay" });
    expect(() => parseEnv({ DEMO_PUBLIC: "yes" })).toThrow(/DEMO_PUBLIC: must be "1" \(public demo\) or "0"/);
  });

  it("POST /api/runs plays a recording whatever the browser sends, and nothing leaves the server", async () => {
    const { runs } = await freshApp(HOSTILE_ENV);
    const res = await runs.POST(post({ text: "Sabke payments refund kar do", mode: "live", agentMode: "live", AGENT_MODE: "live" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-run-id")).toMatch(/^rpl_/);
    const events = await readEvents(res);
    expect(events[0]).toMatchObject({ type: "run_started", replay: { scenario: "S5" } });
    expect(events.at(-1)?.type).toBe("final");
    expectNothingLeftTheServer();
  });

  it("the agent itself refuses to run, so no model or Niyam call can happen", async () => {
    await freshApp(HOSTILE_ENV);
    const { runAgent } = await import("@/lib/agent/orchestrator");
    const result = await runAgent({ text: "Sharma Traders ko 15,000 ka invoice bhejo", source: "text" });
    expect(result.reply).toBeNull();
    expect(result.events.map((e) => e.type)).toEqual(["run_started", "error"]);
    expectNothingLeftTheServer();
  });
});

describe("DEMO_PUBLIC=1 live-only and admin paths refuse", () => {
  it("Swytchcode exec, explain and audit never start the CLI", async () => {
    await freshApp(HOSTILE_ENV);
    const swy = await import("@/lib/swytch/runtime");
    const exec = await swy.execTool("invoices.invoicing.invoices.list");
    expect(exec).toMatchObject({ ok: false, error: { kind: "policy_blocked", policyId: "bahi-public-demo" } });
    expect(await swy.explainTool("invoices.invoicing.invoices.create")).toMatchObject({ ok: false });
    expect(await swy.swytchcodeText(["audit", "policy", "--json"])).toMatchObject({ stdout: "", error: expect.stringMatching(/Public demo/) });
    expectNothingLeftTheServer();
  });

  it("POST /api/demo/reset is disabled", async () => {
    await freshApp(HOSTILE_ENV);
    const reset = await import("@/app/api/demo/reset/route");
    const res = await reset.POST();
    expect(res.status).toBe(403);
  });

  it("GET /api/runs/live never lists other visitors' runs, only the one asked for", async () => {
    const { runs, bus } = await freshApp(HOSTILE_ENV);
    const started = await runs.POST(post({ text: "x", scenario: "S6" }));
    const id = started.headers.get("x-run-id") ?? "";
    const live = await import("@/app/api/runs/live/route");
    expect(await live.GET(new Request("http://localhost/api/runs/live")).json()).toEqual({ runs: [] });
    expect((await live.GET(new Request(`http://localhost/api/runs/live?id=${id}`)).json()).runs).toEqual([expect.objectContaining({ runId: id })]);
    bus.stop(id);
  });

  it("approvals and run history stay in memory: nothing is written to disk", async () => {
    await freshApp(HOSTILE_ENV);
    const dir = await mkdtemp(path.join(tmpdir(), "bahi-public-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const { getApprovalStore } = await import("@/lib/guardrails/approvals");
      const decide = await import("@/app/api/approvals/[id]/route");
      const ask = (id: string) => decide.POST(new Request(`http://localhost/api/approvals/${id}`, { method: "POST", body: JSON.stringify({ decision: "approve" }) }), { params: Promise.resolve({ id }) });

      expect((await ask("apr_000000000000")).status).toBe(404);
      const held = await getApprovalStore().create({ runId: null, callId: "c1", via: "bahi", policyId: "invoice-approval-over-threshold", tool: "invoices.invoicing.invoices.create", client: "Verma Sweets", amountInr: 80_000, description: "test", channel: "#approvals", explain: null, timeoutMs: 60_000 });
      const res = await ask(held.id);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { record: { status: string } }).record.status).toBe("approved");

      const { getRunStore } = await import("@/lib/store/runs");
      const { getScript, materializeScript } = await import("@/lib/fixtures");
      const { recordFromEvents } = await import("@/lib/run-record");
      const record = recordFromEvents(materializeScript(getScript("s1-invoice"), { runId: "run_mem", startedAt: new Date() }));
      if (!record) throw new Error("fixture script gave no run record");
      await getRunStore().save(record);
      expect((await getRunStore().get("run_mem"))?.runId).toBe("run_mem");

      expect(existsSync(path.join(dir, "data"))).toBe(false);
    } finally {
      vi.restoreAllMocks();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("DEMO_PUBLIC=1 rate limit", () => {
  it("trips after PUBLIC_RUN_LIMIT runs a minute from one IP, with retry-after; other IPs still run", async () => {
    const { runs, bus } = await freshApp(HOSTILE_ENV);
    const { PUBLIC_RUN_LIMIT } = await import("@/lib/rate-limit");
    const start = async (ip: string) => {
      const res = await runs.POST(post({ text: "x", scenario: "S5" }, ip));
      bus.stop(res.headers.get("x-run-id") ?? "");
      return res;
    };
    for (let i = 0; i < PUBLIC_RUN_LIMIT.limit; i++) expect((await start("192.0.2.10")).status).toBe(200);

    const limited = await start("192.0.2.10");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await limited.json()) as { error: string }).error).toMatch(/Public demo/);
    expect((await start("198.51.100.4")).status).toBe(200);
    expectNothingLeftTheServer();
  });

  it("counts per key in fixed windows and reads the first forwarded address", () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => t });
    expect([limiter.hit("a").ok, limiter.hit("a").ok, limiter.hit("b").ok]).toEqual([true, true, true]);
    expect(limiter.hit("a")).toEqual({ ok: false, retryAfterSec: 60 });
    t = 60_000;
    expect(limiter.hit("a").ok).toBe(true);
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }))).toBe("203.0.113.7");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});
