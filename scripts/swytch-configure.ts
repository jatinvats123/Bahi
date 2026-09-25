/**
 * npm run swytch:configure            report what needs changing (no writes)
 * npm run swytch:configure -- --apply  make the changes
 *
 * Makes the Swytchcode project (.swytchcode/) safe and usable for Bahi. Re-run it
 * after `swy get`, `swy sync` or `swy bootstrap`, which rewrite manifest.json.
 *
 * Why each change exists (all verified against swytchcode 2.23.5, 25 Sep 2026):
 * 1. tooling.json mode "sandbox" sends every call to each integration's
 *    sandbox_endpoint, which is http://localhost for Gmail, Slack, Notion, Jira and
 *    PayPal. Real calls need mode "production" (the production_endpoint).
 * 2. PayPal's bundle lists http://localhost for BOTH endpoints. We pin both to
 *    https://api-m.sandbox.paypal.com, so PayPal can only ever reach the sandbox,
 *    whatever the mode. The runtime also refuses PayPal calls otherwise.
 * 3. Jira's production_endpoint is the placeholder https://your-domain.atlassian.net.
 *    We set it from JIRA_BASE_URL.
 * 4. Idempotency is off by default. PayPal honours the PayPal-Request-Id header, so
 *    we turn on Swytchcode's dynamic idempotency with that header name.
 * 5. OAuth providers get on_401 = refresh_and_retry (tokens expire mid-demo).
 * It also checks that every tool Bahi uses is enabled in tooling.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flag, loadLocalEnv, table } from "./lib/env";

loadLocalEnv();

const PAYPAL_SANDBOX = "https://api-m.sandbox.paypal.com";
const root = process.env.SWYTCHCODE_PROJECT_DIR ?? process.cwd();
const toolingPath = path.join(root, ".swytchcode", "tooling.json");
const manifestPath = path.join(root, ".swytchcode", "integrations", "manifest.json");

type Json = Record<string, unknown>;
const read = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Json;

async function main() {
  const { ALL_TOOL_IDS } = await import("../src/lib/swytch/tools");
  const apply = flag("apply");
  const tooling = read(toolingPath);
  const manifest = read(manifestPath) as Record<string, Json>;
  const declared = new Set(Object.entries((tooling.integrations ?? {}) as Record<string, { version: string }>).map(([k, v]) => `${k}@${v.version}`));
  const changes: string[][] = [["file", "setting", "from", "to"]];
  const problems: string[] = [];

  const set = (file: string, obj: Json, key: string, value: unknown, label: string) => {
    const before = JSON.stringify(obj[key] ?? null);
    const after = JSON.stringify(value);
    if (before !== after) {
      changes.push([file, label, before.slice(0, 48), after.slice(0, 48)]);
      obj[key] = value;
    }
  };

  set("tooling.json", tooling, "mode", "production", "mode");

  for (const [key, entry] of Object.entries(manifest)) {
    if (!declared.has(key)) continue;
    const policy = ((entry.execution_policy ??= {}) as Json);
    if (key.startsWith("PayPal.")) {
      set("manifest.json", entry, "sandbox_endpoint", PAYPAL_SANDBOX, `${key} sandbox_endpoint`);
      set("manifest.json", entry, "production_endpoint", PAYPAL_SANDBOX, `${key} production_endpoint`);
      set("manifest.json", policy, "idempotency", { mode: "dynamic", header_name: "PayPal-Request-Id", scope: "call" }, `${key} idempotency`);
    }
    if (key.startsWith("Jira.")) {
      const base = process.env.JIRA_BASE_URL?.trim().replace(/\/+$/, "");
      if (base) set("manifest.json", entry, "production_endpoint", base, `${key} production_endpoint`);
      else problems.push("JIRA_BASE_URL is not set in .env.local (e.g. https://yourname.atlassian.net); Jira calls will fail until it is.");
    }
    const auth = entry.auth as { type?: string } | undefined;
    if (auth?.type === "oauth2") set("manifest.json", policy, "on_401", "refresh_and_retry", `${key} on_401`);
  }

  const enabled = new Set(Object.keys((tooling.tools ?? {}) as Json));
  const missing = ALL_TOOL_IDS.filter((id) => !enabled.has(id));
  for (const id of missing) problems.push(`tool not enabled: ${id} (run: swy add ${id}; swy add sometimes exits silently, check with swy list tooling)`);

  console.log(changes.length > 1 ? table(changes) : "No changes needed.");
  if (changes.length > 1) {
    if (apply) {
      writeFileSync(toolingPath, `${JSON.stringify(tooling, null, 2)}\n`);
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(`\nApplied ${changes.length - 1} change(s).`);
    } else {
      console.log("\nDry run. Re-run with --apply to write these changes.");
    }
  }
  for (const p of problems) console.log(`! ${p}`);
  process.exitCode = problems.length > 0 || (changes.length > 1 && !apply) ? 1 : 0;
}

void main();
