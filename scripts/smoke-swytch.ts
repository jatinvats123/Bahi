/**
 * npm run smoke:swytch                 live read checks for all 5 integrations, then a Slack post
 * npm run smoke:swytch -- --write      also create one PayPal draft invoice and cancel (delete) it
 * npm run smoke:swytch -- --record     also save sanitized raw responses to fixtures/recorded/
 *
 * Always runs against the live adapters (through Swytchcode), whatever SWYTCH_MODE says.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flag, loadLocalEnv, table } from "./lib/env";

loadLocalEnv();

async function main() {
  const [{ createIntegrations }, { buildHealthReport }, { setExecTap }, { createSanitizer }, { toolById }, { getClientDirectory }, { formatINR }, { getEnv }] =
    await Promise.all([
      import("../src/lib/integrations"),
      import("../src/lib/health"),
      import("../src/lib/swytch/runtime"),
      import("../src/lib/swytch/sanitize"),
      import("../src/lib/swytch/tools"),
      import("../src/lib/clients"),
      import("../src/lib/format"),
      import("../src/lib/env"),
    ]);
  const env = getEnv();
  const record = flag("record");
  const recorded = new Map<string, unknown>();
  if (record) {
    const scrub = createSanitizer({ keep: [env.BUSINESS_NAME, env.JIRA_PROJECT_KEY, env.SLACK_OPS_CHANNEL] });
    setExecTap(({ tool, data }) => {
      const name = recorded.has(tool) ? `${tool}.2` : tool;
      recorded.set(name, scrub(data));
    });
  }

  const live = createIntegrations("live");
  console.log("Bahi smoke test: live, through Swytchcode\n");
  const report = await buildHealthReport(live);
  const sw = report.swytchcode;
  if (sw) {
    console.log(`swytchcode binary: ${sw.binaryFound ? "found" : "MISSING"} | transport: ${sw.transport} | project mode: ${sw.projectMode} | tools: ${sw.toolsEnabled}/${sw.toolsExpected}`);
    for (const p of sw.problems) console.log(`! ${p}`);
    console.log("");
  }
  const rows = [["integration", "status", "ms", "detail"]];
  for (const c of report.integrations) rows.push([c.integration, c.status.toUpperCase(), String(c.ms), c.detail.slice(0, 110)]);
  console.log(table(rows));
  for (const c of report.integrations) if (c.status !== "ok") console.log(`  ${c.integration}: ${c.hint}${c.errorKind === "auth" ? `  ->  ${c.fixCommand}` : ""}`);

  let writeOk = true;
  if (flag("write")) {
    console.log("\n--write: PayPal draft invoice round trip");
    const client = getClientDirectory()[0];
    if (!client) throw new Error("no clients in fixtures/clients.json");
    const created = await live.paypal.createInvoice({
      clientName: client.name,
      recipientEmail: client.paypalEmail ?? client.email,
      description: "Bahi smoke test draft (auto-deleted)",
      amountInr: 1500,
      intentKey: `smoke-${Date.now()}`,
    });
    if (!created.ok) {
      writeOk = false;
      console.log(`  create FAILED (${created.error.kind}): ${created.error.message}`);
      if (/currency/i.test(created.error.message)) console.log("  PayPal rejected the currency. Set PAYPAL_CURRENCY=USD in .env.local (see PROGRESS.md, currency check).");
    } else {
      const v = created.value;
      console.log(`  created ${v.id} ${v.status} ${v.currency} ${v.amount} (${formatINR(v.amountInr)}) in ${created.ms} ms`);
      const cancelled = await live.paypal.cancelInvoice(v.id);
      if (!cancelled.ok) writeOk = false;
      console.log(cancelled.ok ? `  deleted draft in ${cancelled.ms} ms` : `  delete FAILED (${cancelled.error.kind}): ${cancelled.error.message}`);
    }
  }

  const allOk = report.integrations.every((c) => c.status === "ok") && writeOk;
  const slackOk = report.integrations.find((c) => c.integration === "slack")?.status !== "down";
  if (slackOk) {
    const good = report.integrations.filter((c) => c.status === "ok").length;
    const text = allOk ? "Bahi smoke test ok" : `Bahi smoke test: ${good}/${report.integrations.length} integrations ok${writeOk ? "" : ", PayPal write failed"}`;
    const posted = await live.slack.postOps(text);
    console.log(posted.ok ? `\nPosted to #${posted.value.channelName}: "${text}"` : `\nSlack post FAILED: ${posted.error.message}`);
  }

  if (record && recorded.size > 0) {
    for (const [name, data] of recorded) {
      const id = name.replace(/\.2$/, "");
      const dir = path.join(process.cwd(), "fixtures", "recorded", toolById(id)?.integration ?? "other");
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${name}.json`);
      writeFileSync(file, `${JSON.stringify({ _note: `Sanitized live response from ${id} via Swytchcode, recorded ${new Date().toISOString().slice(0, 10)}.`, data }, null, 2)}\n`);
    }
    console.log(`\nRecorded ${recorded.size} sanitized response(s) under fixtures/recorded/. Review them before committing.`);
  }

  console.log(allOk ? "\nAll green." : "\nNot all green; see hints above.");
  process.exitCode = allOk ? 0 : 1;
}

void main();
