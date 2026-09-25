/**
 * npm run paypal:token
 *
 * PayPal sandbox credentials for Swytchcode on the free Developer plan, where
 * "Create a new connection" (bring your own credentials) is a paid feature.
 * Swytchcode reads PAYPAL_API_KEY from the environment first (verified with `swy whoami`,
 * which then shows "PayPal  env var"), so this script:
 *   1. reads PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET (sandbox app) from .env.local,
 *   2. exchanges them for an access token at PayPal's SANDBOX OAuth endpoint (never live),
 *   3. writes PAYPAL_API_KEY=<token> into .env.local (the token is never printed),
 *   4. checks it with one read through Swytchcode (list invoices).
 *
 * This token fetch is credential setup, the one PayPal call that does not go through
 * Swytchcode; every invoice, payment and refund still does. PayPal sandbox tokens last
 * about 9 hours: run this again before a demo (the script prints the expiry in IST).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();

const SANDBOX_TOKEN_URL = "https://api-m.sandbox.paypal.com/v1/oauth2/token";
const ENV_FILE = path.join(process.cwd(), ".env.local");

/** Set KEY=value in .env.local, replacing an existing line or appending one. */
function upsertEnvLine(file: string, key: string, value: string, comment: string): void {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith(`${key}=`));
  const line = `${key}=${value}`;
  if (at >= 0) {
    lines[at] = line;
    if (lines[at - 1]?.startsWith("# PAYPAL_API_KEY:")) lines[at - 1] = comment;
    else lines.splice(at, 0, comment);
  } else {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(comment, line, "");
  }
  writeFileSync(file, lines.join("\n"), "utf8");
}

async function main() {
  const id = process.env.PAYPAL_CLIENT_ID?.trim();
  const secret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!id || !secret) {
    console.error("Add these two lines to .env.local (from developer.paypal.com > Sandbox > Apps & Credentials), then run again:");
    console.error("  PAYPAL_CLIENT_ID=...");
    console.error("  PAYPAL_CLIENT_SECRET=...");
    process.exitCode = 1;
    return;
  }

  const res = await fetch(SANDBOX_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
  if (!res.ok || !body?.access_token) {
    console.error(`PayPal sandbox refused the credentials (HTTP ${res.status}): ${body?.error_description ?? body?.error ?? "no details"}`);
    console.error("Check that the Client ID and Secret are from the SANDBOX tab of your app, not Live.");
    process.exitCode = 1;
    return;
  }

  const expires = new Date(Date.now() + (body.expires_in ?? 32_400) * 1000);
  const { formatIST } = await import("../src/lib/format");
  upsertEnvLine(ENV_FILE, "PAYPAL_API_KEY", body.access_token, `# PAYPAL_API_KEY: PayPal sandbox access token from npm run paypal:token, expires ${formatIST(expires)} IST`);
  process.env.PAYPAL_API_KEY = body.access_token;
  console.log(`PAYPAL_API_KEY written to .env.local (sandbox token, expires ${formatIST(expires)} IST).`);

  // Prove it works through Swytchcode, the way the app will use it.
  const { execTool } = await import("../src/lib/swytch/runtime");
  const r = await execTool("invoices.invoicing.invoices.list", { params: { page_size: 1 } });
  if (r.ok) {
    console.log(`Swytchcode -> PayPal sandbox: OK (${r.ms} ms). Restart npm run dev if it was running.`);
  } else {
    console.error(`Token saved, but the Swytchcode check failed (${r.error.kind}): ${r.error.message}`);
    if (r.error.kind === "policy_blocked") console.error("Run npm run swytch:configure -- --apply so PayPal points at the sandbox host.");
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
