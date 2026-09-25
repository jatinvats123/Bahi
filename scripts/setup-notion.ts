/**
 * npm run setup:notion
 *
 * Finds the "Bahi Ledger" database through Swytchcode and makes its schema exact
 * (Client, Client Email, Amount INR, Description, Invoice ID, Invoice URL, Status,
 * Issued, Due, Last reminder, Jira key, Intent key). Idempotent: re-running finds the
 * same database and changes nothing when the schema already matches.
 *
 * Swytchcode's Notion integration (notion@2.0.0) has no "create database" tool
 * (POST /v1/databases is not in the bundle), so the empty database is created once
 * by hand; this script prints exactly how when it cannot find it.
 */
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();

async function main() {
  const { createIntegrations } = await import("../src/lib/integrations");
  const { notion } = createIntegrations("live");
  console.log("Looking for the Bahi Ledger in Notion (through Swytchcode)...");
  const r = await notion.ensureLedgerDatabase();
  if (!r.ok) {
    console.error(`\n${r.error.message}`);
    if (r.error.kind === "auth") console.error("\nFix: swy auth connect Notion  (share the Bahi page with the connection)");
    process.exitCode = 1;
    return;
  }
  const { databaseId, dataSourceId, addedProperties } = r.value;
  console.log(addedProperties.length ? `Schema fixed. Added: ${addedProperties.join(", ")}` : "Schema already exact.");
  console.log(`\nAdd these to .env.local:\nNOTION_LEDGER_DATABASE_ID=${databaseId}\nNOTION_LEDGER_DATA_SOURCE_ID=${dataSourceId}`);
}

void main();
