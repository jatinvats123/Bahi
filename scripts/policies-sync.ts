/**
 * npm run policies:sync               write .swytchcode/integrations/policies.json and validate it
 * npm run policies:sync -- --probe    also dry-run sample calls through the real Swytchcode kernel
 *                                     and check every decision against Bahi's local evaluator
 * npm run policies:sync -- --check    exit 1 if policies.json is out of date (no writes)
 *
 * Policies are generated from code (src/lib/guardrails/policies.ts) + .env.local thresholds +
 * the client directory, so the email allowlist never drifts from the clients file.
 * Re-run after changing APPROVAL_THRESHOLD_INR, REFUND_BLOCK_THRESHOLD_INR, DEMO_INR_PER_USD,
 * APPROVAL_MODE, fixtures/clients.json or data/clients.local.json.
 *
 * The live policies.json is gitignored because its allowlist encodes the real demo addresses
 * from data/clients.local.json. docs/policies.public.json is the same file generated from the
 * committed placeholder clients, for readers of the repo.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flag, loadLocalEnv, table } from "./lib/env";

loadLocalEnv();

const root = process.env.SWYTCHCODE_PROJECT_DIR || process.cwd();
const policiesPath = path.join(root, ".swytchcode", "integrations", "policies.json");
const publicPath = path.join(process.cwd(), "docs", "policies.public.json");

let bin = "swytchcode";

function swy(args: string[]): { code: number | null; out: string } {
  const r = spawnSync(bin, args, { cwd: root, input: "", encoding: "utf8", windowsHide: true, timeout: 60_000 });
  if (r.error) return { code: null, out: `Could not run ${bin}: ${r.error.message}` };
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

async function main() {
  const { buildPoliciesFile, evaluatePolicies, approvalStamp, POLICY_TARGETS } = await import("../src/lib/guardrails/policies");
  const { guardrailConfig } = await import("../src/lib/guardrails/config");
  const { getClients } = await import("../src/lib/fixtures");
  const { buildRfc822, encodeBase64Url } = await import("../src/lib/integrations/gmail/parse");
  const { toPaypalMoney } = await import("../src/lib/integrations/money");

  const { resolveSwytchcodeBinary } = await import("../src/lib/swytch/transport");
  bin = resolveSwytchcodeBinary(process.env, root) ?? "swytchcode";

  const cfg = guardrailConfig();
  const file = buildPoliciesFile(cfg);
  const json = `${JSON.stringify(file, null, 2)}\n`;
  const publicJson = `${JSON.stringify(buildPoliciesFile({ ...cfg, allowedRecipients: getClients().map((c) => c.email) }), null, 2)}\n`;

  const current = existsSync(policiesPath) ? readFileSync(policiesPath, "utf8") : "";
  if (flag("check")) {
    if (current !== json) {
      console.error("policies.json is out of date. Run: npm run policies:sync");
      process.exit(1);
    }
    console.log("policies.json is up to date.");
    return;
  }

  writeFileSync(policiesPath, json);
  writeFileSync(publicPath, publicJson);
  console.log(`Wrote ${path.relative(process.cwd(), policiesPath)} (${file.policies.length} policies, ${cfg.allowedRecipients.length} allowed recipients, approval mode ${cfg.approvalMode}).`);
  console.log(`Wrote ${path.relative(process.cwd(), publicPath)} (placeholder clients, safe to commit).`);

  const v = swy(["policy", "validate"]);
  console.log(v.out.trim());
  if (v.code !== 0) process.exit(1);

  if (!flag("probe")) return;

  // ---- probe: real kernel (dry run, no network) vs local evaluator
  const money = (inr: number, currency: "INR" | "USD") => toPaypalMoney(inr, { currency, inrPerUsd: cfg.inrPerUsd });
  const invoice = (inr: number, currency: "INR" | "USD", memo?: string) => ({
    detail: { currency_code: currency, invoice_date: "2026-09-26", reference: "bahi-probe", ...(memo ? { memo } : {}) },
    invoicer: { business_name: "Probe" },
    primary_recipients: [{ billing_info: { email_address: "payer@example.com" } }],
    items: [{ name: "probe", quantity: "1", unit_amount: money(inr, currency), unit_of_measure: "QUANTITY" }],
  });
  const mail = (to: string) => ({ raw: encodeBase64Url(buildRfc822({ to, subject: "Probe", text: "probe" })) });
  const known = cfg.allowedRecipients[0] ?? "nobody@example.com";
  const t = cfg.approvalThresholdInr;
  const r = cfg.refundBlockThresholdInr;

  type Case = { name: string; tool: string; input: { body?: unknown; params?: Record<string, string> }; expect: string };
  const approvalId = "apr_probe0001";
  const cases: Case[] = [
    { name: `invoice ${t} INR (at threshold)`, tool: POLICY_TARGETS.invoiceCreate, input: { body: invoice(t, "INR") }, expect: "allowed" },
    { name: `invoice ${t + 1} INR`, tool: POLICY_TARGETS.invoiceCreate, input: { body: invoice(t + 1, "INR") }, expect: "invoice-approval-over-threshold" },
    { name: `invoice ${t} INR as USD`, tool: POLICY_TARGETS.invoiceCreate, input: { body: invoice(t, "USD") }, expect: "allowed" },
    { name: `invoice ${t + 100} INR as USD`, tool: POLICY_TARGETS.invoiceCreate, input: { body: invoice(t + 100, "USD") }, expect: "invoice-approval-over-threshold" },
    { name: "invoice 15,000 INR as USD", tool: POLICY_TARGETS.invoiceCreate, input: { body: invoice(15_000, "USD") }, expect: "allowed" },
    { name: "invoice 80,000 INR as USD, approval stamp", tool: POLICY_TARGETS.invoiceCreate, input: { body: invoice(80_000, "USD", approvalStamp(approvalId, "owner")) }, expect: cfg.approvalMode === "gate" ? "allowed" : "invoice-approval-over-threshold" },
    { name: "invoice 80,000 INR as USD, fake stamp", tool: POLICY_TARGETS.invoiceCreate, input: { body: invoice(80_000, "USD", "Bahi approval apr_x") }, expect: "invoice-approval-over-threshold" },
    { name: "refund, no amount (full)", tool: POLICY_TARGETS.refund, input: { params: { capture_id: "PROBE" }, body: { note_to_payer: "probe" } }, expect: "block-large-refunds" },
    { name: `refund ${r} INR as USD`, tool: POLICY_TARGETS.refund, input: { params: { capture_id: "PROBE" }, body: { amount: money(r, "USD") } }, expect: "allowed" },
    { name: `refund ${r + 500} INR as USD`, tool: POLICY_TARGETS.refund, input: { params: { capture_id: "PROBE" }, body: { amount: money(r + 500, "USD") } }, expect: "block-large-refunds" },
    { name: "refund 15,000 INR", tool: POLICY_TARGETS.refund, input: { params: { capture_id: "PROBE" }, body: { amount: money(15_000, "INR") } }, expect: "block-large-refunds" },
    { name: "email a known client", tool: POLICY_TARGETS.gmailSend, input: { params: { userId: "me" }, body: mail(known) }, expect: "allowed" },
    { name: "email a known client (upper case)", tool: POLICY_TARGETS.gmailSend, input: { params: { userId: "me" }, body: mail(known.toUpperCase()) }, expect: "allowed" },
    { name: "email an outsider", tool: POLICY_TARGETS.gmailSend, input: { params: { userId: "me" }, body: mail("attacker@evil.example") }, expect: "email-known-clients-only" },
    { name: "email a look-alike address", tool: POLICY_TARGETS.gmailSend, input: { params: { userId: "me" }, body: mail(`${known}.evil.example`) }, expect: "email-known-clients-only" },
  ];

  const rows: string[][] = [["case", "expected", "kernel", "local", "ok"]];
  let bad = 0;
  for (const c of cases) {
    const args = ["exec", c.tool, "--dry-run", "--json", "--body", JSON.stringify(c.input.body ?? {})];
    for (const [k, val] of Object.entries(c.input.params ?? {})) args.push("--input", `${k}=${val}`);
    // Windows shell quoting: pass the JSON through a temp file instead.
    const tmp = path.join(root, ".swytchcode", `probe-${process.pid}.json`);
    writeFileSync(tmp, JSON.stringify(c.input.body ?? {}));
    args[5] = tmp;
    const res = swy(args);
    const m = /blocked by policy \\?"([^"\\]+)\\?"/.exec(res.out) ?? /Approval requested for \S+ \(policy "([^"]+)"\)/.exec(res.out);
    const kernel = m?.[1] ?? (res.code === 0 ? "allowed" : `error (exit ${String(res.code)})`);
    const local = evaluatePolicies(file.policies, c.tool, c.input);
    const localName = local.decision === "allowed" ? "allowed" : local.policy.id;
    const ok = kernel === c.expect && localName === c.expect;
    if (!ok) {
      bad++;
      if (!m && res.code !== 0) console.error(`\n[${c.name}] kernel output:\n${res.out.split("\n").filter((l) => !l.includes("request tool=")).join("\n").slice(0, 600)}`);
    }
    rows.push([c.name, c.expect, kernel, localName, ok ? "yes" : "NO"]);
    try {
      (await import("node:fs")).unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
  console.log(`\n${table(rows)}\n`);
  if (bad) {
    console.error(`${bad} probe case(s) disagree.`);
    process.exit(1);
  }
  console.log("Every probe decision matches between the Swytchcode kernel and Bahi's evaluator. No network calls were made (dry run).");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
