/**
 * npm run seed:gmail            show the demo emails that would be placed in the inbox
 * npm run seed:gmail -- --apply insert them into the connected Gmail inbox (unread)
 *
 * Uses Gmail messages.insert through Swytchcode, so the demo inbox for S3 looks real
 * without anyone sending mail. Senders are the clients' contact emails from
 * data/clients.local.json (Gmail plus-aliases), so replies go back to your own inbox.
 */
import { flag, loadLocalEnv } from "./lib/env";

loadLocalEnv();

async function main() {
  const [{ createIntegrations }, { getClientDirectory }, { InboxFixtureSchema }, inbox, { getEnv }] = await Promise.all([
    import("../src/lib/integrations"),
    import("../src/lib/clients"),
    import("../src/lib/integrations/mock/world"),
    import("../fixtures/inbox.json"),
    import("../src/lib/env"),
  ]);
  const env = getEnv();
  const to = env.BUSINESS_EMAIL;
  if (!to) {
    console.error("Set BUSINESS_EMAIL in .env.local (the Gmail inbox Bahi reads).");
    process.exitCode = 1;
    return;
  }
  const clients = new Map(getClientDirectory().map((c) => [c.id, c]));
  const emails = InboxFixtureSchema.parse(inbox.default).emails;
  const apply = flag("apply");
  const { gmail } = createIntegrations("live");
  for (const e of emails) {
    const c = e.clientId ? clients.get(e.clientId) : undefined;
    const from = e.from ?? (c ? `${c.contact} <${c.email}>` : "unknown@example.com");
    const date = new Date(Date.now() + e.receivedOffsetMinutes * 60_000).toISOString();
    if (!apply) {
      console.log(`[dry] ${e.kind.padEnd(20)} ${from}  "${e.subject}"`);
      continue;
    }
    const r = await gmail.insertMessage({ from, to, subject: e.subject, text: e.text, date });
    console.log(r.ok ? `inserted ${e.kind.padEnd(20)} ${r.value.id}` : `FAILED ${e.kind}: ${r.error.message}`);
    if (!r.ok) process.exitCode = 1;
  }
  if (!apply) console.log("\nDry run. Re-run with --apply to insert into Gmail.");
}

void main();
