import "server-only";
import { getEnv } from "./env";
import type { Integration } from "./events";
import type { Integrations } from "./integrations/types";
import type { Outcome } from "./integrations/result";
import type { ExecError } from "./swytch/errors";
import { paypalEndpointProblem } from "./swytch/project";
import { getSwytchRuntime } from "./swytch/runtime";
import { ALL_TOOL_IDS } from "./swytch/tools";

/**
 * Integration health: one cheap read per integration, through the same adapters the
 * agent uses. Shared by GET /api/health, the Settings page and npm run smoke:swytch.
 */

export type HealthStatus = "ok" | "degraded" | "down";

export interface IntegrationHealth {
  integration: Integration;
  status: HealthStatus;
  ms: number;
  checkedAt: string;
  /** What was checked and what came back, in plain words. */
  detail: string;
  /** What to do about it (empty when ok). */
  hint: string;
  /** The exact command that fixes a broken connection. */
  fixCommand: string;
  errorKind?: ExecError["kind"];
}

export interface SwytchcodeHealth {
  binaryFound: boolean;
  transport: "cli" | "sdk";
  projectMode: "sandbox" | "production" | "unknown";
  toolsEnabled: number;
  toolsExpected: number;
  /** null when PayPal is pinned to the sandbox. */
  paypalProblem: string | null;
  problems: string[];
}

export interface HealthReport {
  mode: "live" | "mock";
  checkedAt: string;
  overall: HealthStatus;
  swytchcode: SwytchcodeHealth | null;
  integrations: IntegrationHealth[];
}

/** Provider slugs as the swy CLI spells them (see its "run swytchcode auth connect Slack" hints). */
export const PROVIDER_SLUG: Record<Integration, string> = { paypal: "PayPal", gmail: "Gmail", slack: "Slack", notion: "Notion", jira: "Jira" };

const SLOW_MS = 6000;

function classify(error: ExecError): HealthStatus {
  if (error.kind === "network" || error.kind === "timeout") return "degraded";
  if (error.kind === "provider" && (error.retryable || (error.httpStatus ?? 0) >= 500)) return "degraded";
  return "down";
}

function hintFor(integration: Integration, error: ExecError): string {
  const slug = PROVIDER_SLUG[integration];
  switch (error.kind) {
    case "auth":
      return `${slug} connected nahi hai ya token expire ho gaya. Terminal mein neeche wala command chalao.`;
    case "not_found":
      return integration === "notion" && /Bahi Ledger/.test(error.message)
        ? "Notion mein Bahi Ledger nahi mila. npm run setup:notion chalao, woh bata dega kya karna hai."
        : `${slug} ka tool ya resource nahi mila: ${error.message}`;
    case "network":
    case "timeout":
      return `${slug} tak pahunch nahi paaye. Internet check karke dobara try karo.`;
    case "policy_blocked":
      return error.message;
    default:
      return `${slug}: ${error.message}`;
  }
}

async function check(integration: Integration, what: string, run: () => Promise<Outcome<string>>): Promise<IntegrationHealth> {
  const started = performance.now();
  let r: Outcome<string>;
  try {
    r = await run();
  } catch (e) {
    r = { ok: false, error: { kind: "unknown", message: e instanceof Error ? e.message : String(e) }, ms: 0 };
  }
  const ms = Math.round(r.ms || performance.now() - started);
  const base = { integration, ms, checkedAt: new Date().toISOString(), fixCommand: `swy auth connect ${PROVIDER_SLUG[integration]}` };
  if (r.ok) {
    const slow = ms > SLOW_MS;
    return { ...base, status: slow ? "degraded" : "ok", detail: `${what}: ${r.value}`, hint: slow ? "Jawab dheema hai." : "" };
  }
  return { ...base, status: classify(r.error), detail: `${what}: ${r.error.message}`, hint: hintFor(integration, r.error), errorKind: r.error.kind };
}

export function checkIntegrations(i: Integrations): Promise<IntegrationHealth[]> {
  const env = getEnv();
  return Promise.all([
    check("paypal", "List invoices (1)", async () => {
      const r = await i.paypal.listInvoices({ pageSize: 1 });
      return r.ok ? { ...r, value: `${r.value.total ?? r.value.invoices.length} invoice(s) found` } : r;
    }),
    check("gmail", "List unread (1)", async () => {
      const r = await i.gmail.listUnread({ max: 1 });
      return r.ok ? { ...r, value: r.value.length ? "inbox reachable, unread mail waiting" : "inbox reachable, nothing unread" } : r;
    }),
    check("slack", "List channels", async () => {
      const r = await i.slack.resolveChannel(env.SLACK_OPS_CHANNEL);
      return r.ok ? { ...r, value: `#${r.value.name} found` } : r;
    }),
    check("notion", "Query ledger (1)", async () => {
      const r = await i.notion.listLedger({ limit: 1 });
      return r.ok ? { ...r, value: r.value.length ? "Bahi Ledger reachable" : "Bahi Ledger reachable, empty" } : r;
    }),
    check("jira", `Get project ${env.JIRA_PROJECT_KEY}`, async () => {
      const r = await i.jira.getProject();
      return r.ok ? { ...r, value: `${r.value.key}: ${r.value.name}` } : r;
    }),
  ]);
}

export async function checkSwytchcode(): Promise<SwytchcodeHealth> {
  const rt = getSwytchRuntime();
  const problems: string[] = [];
  let projectMode: SwytchcodeHealth["projectMode"] = "unknown";
  let toolsEnabled = 0;
  let paypalProblem: string | null = null;
  try {
    const p = await rt.project();
    projectMode = p.mode;
    toolsEnabled = ALL_TOOL_IDS.filter((id) => p.enabledTools.has(id)).length;
    paypalProblem = paypalEndpointProblem(p.manifest, p.mode, p.integrations);
    if (p.mode === "sandbox") problems.push('Project mode is "sandbox": Swytchcode sends calls to http://localhost. Run: npm run swytch:configure -- --apply');
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  }
  if (!rt.binary) problems.push("swytchcode binary not found. Install: npm install -g swytchcode, or set SWYTCHCODE_BIN.");
  if (toolsEnabled < ALL_TOOL_IDS.length) problems.push(`${ALL_TOOL_IDS.length - toolsEnabled} tool(s) not enabled in tooling.json. Run: npm run swytch:configure`);
  if (paypalProblem) problems.push(paypalProblem);
  return { binaryFound: Boolean(rt.binary), transport: rt.transport, projectMode, toolsEnabled, toolsExpected: ALL_TOOL_IDS.length, paypalProblem, problems };
}

export function overallStatus(checks: readonly IntegrationHealth[], swy: SwytchcodeHealth | null): HealthStatus {
  if (checks.some((c) => c.status === "down") || (swy && swy.problems.length > 0)) return checks.every((c) => c.status === "down") ? "down" : "degraded";
  if (checks.some((c) => c.status === "degraded")) return "degraded";
  return "ok";
}

export async function buildHealthReport(i: Integrations): Promise<HealthReport> {
  const [integrations, swytchcode] = await Promise.all([checkIntegrations(i), i.mode === "live" ? checkSwytchcode() : Promise.resolve(null)]);
  return { mode: i.mode, checkedAt: new Date().toISOString(), overall: overallStatus(integrations, swytchcode), swytchcode, integrations };
}
