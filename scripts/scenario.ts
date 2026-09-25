/**
 * npm run scenario -- S1      run S1 against the live sandbox and verify it really happened
 * npm run scenario -- S6      other scenarios run and print their steps (S1 is fully verified)
 *
 * S1 checks, by reading the providers back through Swytchcode:
 *   - the PayPal sandbox invoice exists, is SENT (or paid) and is for ₹15,000,
 *   - the Notion ledger has a Sent row with that invoice id,
 *   - Slack accepted the #bahi-ops message (chat.postMessage returned ok with a message ts;
 *     reading channel history needs a conversations.history tool that is not enabled yet).
 * The run is saved to data/runs.json like a UI run, so it shows on /activity.
 */
import { loadLocalEnv, table } from "./lib/env";

loadLocalEnv();

const COMMANDS: Record<string, string> = {
  S1: "Sharma Traders ko website redesign ke liye 15,000 ka invoice bhejo",
  S3: "Inbox check karo aur jo kaam hai woh karo",
  S4: "Kaun late hai? Sabko yaad dilao",
  S6: "Aaj ka hisaab batao",
};

async function main() {
  const id = (process.argv[2] ?? "S1").toUpperCase();
  const command = COMMANDS[id];
  if (!command) {
    console.error(`Unknown scenario ${id}. Use one of: ${Object.keys(COMMANDS).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const [{ runAgent }, { createIntegrations }, { getEnv }, { createRunPersister }, { formatINR }] = await Promise.all([
    import("../src/lib/agent/orchestrator"),
    import("../src/lib/integrations"),
    import("../src/lib/env"),
    import("../src/lib/store/run-persister"),
    import("../src/lib/format"),
  ]);
  if (getEnv().SWYTCH_MODE !== "live") {
    console.error("npm run scenario runs against the real sandbox. Set SWYTCH_MODE=live in .env.local first (npm run eval:agent is the mock version).");
    process.exitCode = 1;
    return;
  }
  const io = createIntegrations("live");
  const persister = createRunPersister();
  console.log(`${id}: "${command}"\n`);
  const r = await runAgent(
    { text: command, source: "text" },
    {
      integrations: io,
      onEvent: (e) => {
        persister.add(e);
        const d =
          e.type === "tool_call" ? `${e.tool}  ${e.inputSummary}`
          : e.type === "tool_result" ? `${e.ok ? "ok" : "FAILED"} ${e.summary} (${e.ms} ms)`
          : e.type === "thinking" || e.type === "speak" ? e.text
          : e.type === "final" ? e.summary
          : e.type === "error" ? e.message
          : e.type === "guard" ? e.reason
          : e.type === "policy" ? `${e.decision} ${e.policyId}`
          : "";
        console.log(`${String(e.seq).padStart(3)} ${e.type.padEnd(12)} ${d}`);
      },
    },
  );
  await persister.flush();
  console.log(`\nrun ${r.runId} via ${r.model ?? "-"}; tools: ${r.toolSequence.join(" > ")}`);
  if (id !== "S1") return;

  const checks: [string, boolean, string][] = [];
  const invoiceOut = r.toolResults.find((t) => t.name === "create_and_send_invoice")?.output as { ok?: boolean; invoiceId?: string } | undefined;
  const invoiceId = invoiceOut?.ok ? invoiceOut.invoiceId : undefined;
  checks.push(["agent created and sent an invoice", Boolean(invoiceId), invoiceId ?? "no invoice id in the tool result"]);

  if (invoiceId) {
    const inv = await io.paypal.getInvoice(invoiceId);
    checks.push([
      "PayPal sandbox invoice exists, SENT, ₹15,000",
      inv.ok && ["SENT", "PAID", "MARKED_AS_PAID", "UNPAID"].includes(inv.value.status) && inv.value.amountInr === 15_000,
      inv.ok ? `${inv.value.status} ${formatINR(inv.value.amountInr)} ${inv.value.payUrl ?? ""}` : inv.error.message,
    ]);
    const rows = await io.notion.listLedger({ limit: 100 });
    const row = rows.ok ? rows.value.find((x) => x.invoiceId === invoiceId) : undefined;
    checks.push(["Notion ledger row, status Sent", row?.status === "Sent", row ? `${row.client} ${row.status} ${row.url ?? ""}` : rows.ok ? "no row with that invoice id" : rows.error.message]);
  }
  const slackOut = r.toolResults.find((t) => t.name === "notify_team")?.output as { ok?: boolean; channel?: string; ts?: string } | undefined;
  checks.push(["Slack message accepted in the ops channel", Boolean(slackOut?.ok && slackOut.ts), slackOut?.ok ? `${slackOut.channel} ts ${slackOut.ts}` : "no Slack update"]);
  checks.push(["final answer", Boolean(r.reply), r.reply ?? ""]);

  console.log(`\n${table([["check", "result", "detail"], ...checks.map(([c, ok, d]) => [c, ok ? "PASS" : "FAIL", d])])}`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
