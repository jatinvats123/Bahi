/**
 * Live check of the GST rule lookup: starts Niyam's MCP server and asks it a few questions.
 * Needs NIYAM_MCP_COMMAND (and usually NIYAM_MCP_CWD) in .env.local; no LLM key needed.
 *
 *   npm run smoke:niyam
 */
import { loadEnvConfig } from "@next/env";
import { niyamFromEnv } from "../src/lib/gst/niyam";

loadEnvConfig(process.cwd());

const QUESTIONS = [
  "Is advertising service provided to a foreign client an export of services?",
  "Is GST payable on gift vouchers?",
  "Foreign client ko software services dene par GST lagega kya?",
];

async function main() {
  const niyam = niyamFromEnv();
  if (!niyam) {
    console.error("NIYAM_MCP_COMMAND is not set. See .env.example.");
    process.exit(1);
  }
  for (const question of QUESTIONS) {
    const started = Date.now();
    const passages = await niyam.search(question, 3);
    console.log(`\n${question}  (${Date.now() - started} ms)`);
    for (const p of passages) console.log(`  ${p.circular} (${p.date}, ${p.pages}): ${p.subject.slice(0, 90)}`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("Niyam lookup failed:", error);
  process.exit(1);
});
