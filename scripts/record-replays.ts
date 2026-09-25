/**
 * Turn real live runs from data/runs.json into replay recordings (fixtures/runs/*.ndjson + index.json).
 *
 *   npm run record:replays              pick the newest live run that fits each scenario
 *   npm run record:replays -- --S3 run_x  use a specific run for a scenario
 *   npm run record:replays -- --dry       print the choice, write nothing
 *
 * What "fits" means per scenario is below (e.g. S1 needs a successful PayPal send, S2 an approved
 * approval, S3 a flagged suspicious email). Every string is sanitized: real emails become the
 * placeholder client addresses from fixtures/clients.json, PayPal invoice ids and Gmail ids become
 * placeholders. The script refuses to write if anything real is left.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flag, loadLocalEnv, table } from "./lib/env";

loadLocalEnv();

async function main() {
  const [{ RunRecordSchema }, { foldRunEvents }, rec, { SCENARIO_IDS }] = await Promise.all([
    import("../src/lib/run-record"),
    import("../src/lib/run-reducer"),
    import("../src/lib/replay/recording"),
    import("../src/lib/scenarios"),
  ]);
  type RunRecord = import("../src/lib/run-record").RunRecord;
  type ScenarioId = import("../src/lib/scenarios").ScenarioId;

  const root = process.cwd();
  const runs: RunRecord[] = (JSON.parse(readFileSync(path.join(root, "data", "runs.json"), "utf8")) as { runs: unknown[] }).runs.map((r) =>
    RunRecordSchema.parse(r),
  );

  const has = (r: RunRecord, pred: (e: RunRecord["events"][number]) => boolean) => r.events.some(pred);
  const okTool = (r: RunRecord, tool: string) => {
    const calls = new Set(r.events.filter((e) => e.type === "tool_call" && e.tool === tool).map((e) => (e as { callId: string }).callId));
    return has(r, (e) => e.type === "tool_result" && e.ok && calls.has(e.callId));
  };
  const FITS: Record<ScenarioId, (r: RunRecord) => boolean> = {
    S1: (r) => /sharma/i.test(r.command) && r.status === "completed" && okTool(r, "invoices.invoicing.send.create"),
    S2: (r) => r.status === "completed" && has(r, (e) => e.type === "approval" && e.status === "approved") && okTool(r, "invoices.invoicing.send.create"),
    "S2-deny": (r) => r.status === "denied" && has(r, (e) => e.type === "approval" && e.status === "denied"),
    S3: (r) => /inbox/i.test(r.command) && r.status === "completed" && has(r, (e) => e.type === "guard" && e.flagged),
    S4: (r) => /late|yaad/i.test(r.command) && r.status === "completed" && okTool(r, "gmail.user.send.create1"),
    S5: (r) => /refund/i.test(r.command) && r.status === "blocked",
    S6: (r) => /hisaab/i.test(r.command) && r.status === "completed",
  };

  const override = (id: string) => {
    const i = process.argv.indexOf(`--${id}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };

  // Real addresses -> the placeholder addresses the fixtures already use.
  const clients = JSON.parse(readFileSync(path.join(root, "fixtures", "clients.json"), "utf8")) as { id: string; email: string; paypalEmail?: string }[];
  const localFile = path.join(root, "data", "clients.local.json");
  const local = existsSync(localFile) ? (JSON.parse(readFileSync(localFile, "utf8")) as { id: string; email?: string; paypalEmail?: string }[]) : [];
  const emailMap: [string, string][] = [];
  for (const o of local) {
    const c = clients.find((x) => x.id === o.id);
    if (!c) continue;
    if (o.email) emailMap.push([o.email, c.email]);
    if (o.paypalEmail) emailMap.push([o.paypalEmail, c.paypalEmail ?? c.email]);
  }
  for (const k of ["BUSINESS_EMAIL", "PAYPAL_MERCHANT_EMAIL"] as const) {
    const v = process.env[k];
    if (v) emailMap.push([v, k === "BUSINESS_EMAIL" ? "owner@dukaansetu.example" : "merchant@dukaansetu.example"]);
  }
  const ctx = rec.createSanitizeContext(emailMap);

  const outDir = path.join(root, "fixtures", "runs");
  const metas: import("../src/lib/replay/recording").RecordingMeta[] = [];
  const rows: string[][] = [["scenario", "source run", "status", "events", "command"]];
  const files: [string, string][] = [];
  const leaks: string[] = [];

  for (const id of SCENARIO_IDS) {
    const wanted = override(id);
    const run = wanted ? runs.find((r) => r.runId === wanted) : runs.filter((r) => r.mode === "live" && FITS[id](r)).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    if (!run) {
      rows.push([id, "-", "MISSING", "-", "no live run fits; run it live first (npm run scenario)"]);
      continue;
    }
    const events = rec.sanitizeRunEvents(ctx, run.events, `rec_${id.toLowerCase().replace("-", "_")}`);
    const view = foldRunEvents(events);
    leaks.push(...rec.findLeaks(events).map((l) => `${id}: ${l}`));
    const file = `${id.toLowerCase()}.ndjson`;
    files.push([file, events.map((e) => JSON.stringify(e)).join("\n") + "\n"]);
    metas.push({ scenario: id, file, command: view.command ?? run.command, status: view.status, recordedAt: run.startedAt, sourceRunId: run.runId, mode: run.mode, events: events.length });
    rows.push([id, run.runId, view.status, String(events.length), run.command]);
  }

  console.log(table(rows));
  if (leaks.length) {
    console.error(`\nRefusing to write: real data left after sanitizing:\n  ${leaks.join("\n  ")}`);
    process.exitCode = 1;
    return;
  }
  if (flag("dry")) return void console.log("\n--dry: nothing written.");

  mkdirSync(outDir, { recursive: true });
  for (const [file, body] of files) writeFileSync(path.join(outDir, file), body, "utf8");
  const index = {
    version: 1 as const,
    note: "Real live sandbox runs, sanitized (emails, PayPal invoice ids and Gmail ids replaced). Played by AGENT_MODE=replay and labelled Recorded run. Regenerate: npm run record:replays.",
    recordings: metas,
  };
  rec.RecordingIndexSchema.parse(index);
  writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${files.length} recordings to fixtures/runs/.`);
}

void main();
