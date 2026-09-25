/**
 * npm run approve                      list pending approvals
 * npm run approve -- <apr_id|latest>   approve one
 * npm run approve -- <apr_id|latest> --deny
 *
 * The same decision as the dashboard's buttons, from a terminal (data/approvals.json).
 * A run waiting in the Next server or in `npm run scenario` picks it up within a second.
 */
import { flag, loadLocalEnv, table } from "./lib/env";

loadLocalEnv();

async function main() {
  const { getApprovalStore } = await import("../src/lib/guardrails/approvals");
  const { formatINR, formatTimeIST } = await import("../src/lib/format");
  const store = getApprovalStore();
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const pending = (await store.list()).filter((a) => a.status === "pending");
  if (!arg) {
    if (!pending.length) return console.log("Koi approval baaki nahi hai.");
    console.log(table([["id", "client", "amount", "policy", "expires"], ...pending.map((a) => [a.id, a.client, formatINR(a.amountInr), a.policyId, formatTimeIST(a.expiresAt)])]));
    return;
  }
  const id = arg === "latest" ? pending[0]?.id : arg;
  if (!id) return console.log("Koi approval baaki nahi hai.");
  const decision = flag("deny") ? "denied" : "approved";
  const r = await store.decide(id, decision, "Owner (terminal)");
  if (!r.ok) {
    console.error(`Nahi hua: ${r.reason}`);
    process.exit(1);
  }
  console.log(`${r.record.id}: ${r.record.client} ${formatINR(r.record.amountInr)} -> ${decision}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
