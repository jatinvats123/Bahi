/**
 * npm run docs:tools  ->  docs/TOOLS.md
 *
 * Builds the tool reference from the Swytchcode project itself: tooling.json
 * (resolved input schemas) and the wrekenfiles (HTTP method + endpoint), plus the
 * notes below. Re-run after swy add / swy sync.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TOOLS, type ToolKey } from "../src/lib/swytch/tools";

const root = process.cwd();
const tooling = JSON.parse(readFileSync(path.join(root, ".swytchcode", "tooling.json"), "utf8")) as {
  tools: Record<string, { integration?: string; summary?: string; inputs?: Record<string, Record<string, unknown>>[] }>;
};

const CAPABILITY: Record<ToolKey, string> = {
  paypalCreateInvoice: "Create invoice (draft)",
  paypalSendInvoice: "Send invoice",
  paypalGetInvoice: "Get invoice",
  paypalListInvoices: "List invoices",
  paypalSearchInvoices: "Search invoices",
  paypalRecordPayment: "Record a payment on an invoice (simulate a client paying)",
  paypalCancelInvoice: "Cancel a sent invoice",
  paypalDeleteDraft: "Delete a draft invoice",
  paypalRefundCapture: "Refund a captured payment (S5 block-policy target)",
  gmailListMessages: "List / search messages (unread)",
  gmailGetMessage: "Get a message",
  gmailSend: "Send an email",
  gmailModify: "Add label / mark read",
  gmailInsert: "Insert a message into the inbox (seed script)",
  gmailImport: "Import a message (alternative to insert, with spam scanning)",
  gmailListLabels: "List labels (find Bahi/Processed)",
  gmailCreateLabel: "Create label Bahi/Processed",
  gmailProfile: "Get profile (account check)",
  slackPost: "Post a message",
  slackListChannels: "List channels (resolve channel ids)",
  slackAuthTest: "Auth test",
  slackJoinChannel: "Join a channel (before first post)",
  notionSearch: "Search (find Bahi Ledger by title)",
  notionGetDatabase: "Get database (-> data source id)",
  notionGetDataSource: "Get data source schema",
  notionUpdateDataSource: "Update data source schema (exact ledger properties)",
  notionCreateDataSource: "Create data source in an existing database",
  notionQuery: "Query database (ledger rows)",
  notionCreatePage: "Create page (ledger row)",
  notionUpdatePage: "Update page properties",
  jiraCreateIssue: "Create issue (delivery task)",
  jiraGetIssue: "Get issue",
  jiraSearch: "Search issues (JQL)",
  jiraGetProject: "Get project",
  jiraMyself: "Current user (account check)",
  jiraDeleteIssue: "Delete issue (demo reset: Bahi tasks only)",
};

const NOTES: Partial<Record<ToolKey, string>> = {
  paypalCreateInvoice: "Send header `Prefer: return=representation` to get the full invoice back; otherwise PayPal returns only a link. Bahi stores its intent key in `detail.reference`.",
  paypalSendInvoice: "Returns a payer link (or 202 with no body). Resending a sent invoice has no effect.",
  paypalRecordPayment: "Only works on SENT invoices; a draft answers 422. Status becomes MARKED_AS_PAID (or PARTIALLY_PAID).",
  paypalCancelInvoice: "Only for sent invoices. Drafts must be deleted instead (Bahi's cancelInvoice does this automatically).",
  paypalRefundCapture: "Same canonical id exists in PayPal.payments_payment_v2 and PayPal.paypal_api; added with `swy add method PayPal@payments_payment_v2.2.0 payments.payment.captures.refund`.",
  gmailListMessages: "Canonical id says `get` but it is the LIST endpoint. Query: `is:unread in:inbox -label:Bahi-Processed`.",
  gmailGetMessage: "`get1` is the single-message endpoint. Kernel max_response_bytes is 100 KB; very large HTML mails may be cut.",
  gmailSend: "`create1` is messages/send; `gmail.user.send.create` sends a draft. Body is `{ raw: base64url(RFC 822) }`.",
  gmailModify: "Body `{ addLabelIds, removeLabelIds }`; Bahi removes UNREAD and adds Bahi/Processed.",
  gmailInsert: "Needs the gmail.insert or full mail scope. `internalDateSource=dateHeader` keeps the seeded dates.",
  slackPost: "Slack answers HTTP 200 with `{ ok: false, error }` on failure; Bahi treats that as a failed call. On `not_in_channel` it joins and retries once.",
  slackListChannels: "Paginated (`cursor`); Bahi resolves names once and caches the ids.",
  notionSearch: 'Filter `{ property: "object", value: "data_source" }` (API 2025-09-03).',
  notionGetDatabase: "Canonical id has a typo in the registry: `notion.databas.get`.",
  notionCreateDataSource: "Needs an existing database parent. The bundle has no POST /v1/databases, so the Bahi Ledger database itself is created once by hand (see npm run setup:notion).",
  notionQuery: "Path param is the DATA SOURCE id, not the database id.",
  notionCreatePage: 'Parent is `{ type: "data_source_id", data_source_id }`.',
  jiraSearch: "Uses the current POST /rest/api/3/search/jql. The older `jira.api.search.create1` (/rest/api/3/search) is retired by Atlassian.",
  jiraGetProject: "`project.get2` is GET /project/{projectIdOrKey}; `project.get` / `get1` are unrelated field-context endpoints.",
};

function endpoints(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name === "wrekenfile.yaml" ? [path.join(d, e.name)] : []));
  for (const f of walk(path.join(root, ".swytchcode", "integrations"))) {
    const text = readFileSync(f, "utf8");
    for (const def of Object.values(TOOLS)) {
      const i = text.indexOf(`\n  ${def.id}:\n`);
      if (i < 0 || out.has(def.id)) continue;
      const chunk = text.slice(i, i + 4000);
      const m = /METHOD: (\w+)/.exec(chunk);
      const e = /ENDPOINT: (\S+)/.exec(chunk);
      if (m && e) out.set(def.id, `${m[1]} ${e[1]}`);
    }
  }
  return out;
}

function inputs(id: string): string {
  const spec = tooling.tools[id]?.inputs ?? [];
  const parts: string[] = [];
  for (const item of spec) {
    for (const [name, s] of Object.entries(item)) {
      const loc = String(s.LOCATION ?? "").toLowerCase();
      if (name === "body") {
        const schema = s.schema as { properties?: Record<string, { required?: boolean }>; required?: string[] } | undefined;
        const props = Object.entries(schema?.properties ?? {});
        const req = props.filter(([k, v]) => v.required || schema?.required?.includes(k)).map(([k]) => k);
        parts.push(`body${s.REQUIRED === false ? "?" : ""}${req.length ? ` (required: ${req.join(", ")})` : props.length ? ` (${props.slice(0, 6).map(([k]) => k).join(", ")}${props.length > 6 ? ", ..." : ""})` : ""}`);
      } else if (loc === "path" || s.REQUIRED === true) {
        parts.push(`\`${name}\` (${loc}${s.DEFAULT !== undefined ? `, default ${JSON.stringify(s.DEFAULT)}` : ""})`);
      }
    }
  }
  return parts.join("; ") || "none";
}

const eps = endpoints();
const lines: string[] = [
  "# Bahi tools (Swytchcode)",
  "",
  "Every external action in Bahi runs through one of these Swytchcode tools. Canonical ids are the real registry ids,",
  "enabled in `.swytchcode/tooling.json` and mirrored in `src/lib/swytch/tools.ts`. Generated by `npm run docs:tools`",
  "from tooling.json and the downloaded wrekenfiles; edit notes in `scripts/gen-tools-doc.ts`.",
  "",
  "Inputs go to `swytchcode exec <id> --json` as JSON on stdin: `{ params, body, headers }`. `params` holds both path",
  "and query parameters; header inputs such as `Notion-Version` (default `2025-09-03`) can be overridden in `headers`.",
  "",
];
const byIntegration = new Map<string, ToolKey[]>();
for (const key of Object.keys(TOOLS) as ToolKey[]) {
  const i = TOOLS[key].integration;
  byIntegration.set(i, [...(byIntegration.get(i) ?? []), key]);
}
const TITLE: Record<string, string> = { paypal: "PayPal (sandbox only)", gmail: "Gmail", slack: "Slack", notion: "Notion", jira: "Jira Cloud" };
for (const [integration, keys] of byIntegration) {
  lines.push(`## ${TITLE[integration] ?? integration}`, "", "| Capability | Canonical id | Endpoint | Required inputs | Notes |", "| --- | --- | --- | --- | --- |");
  for (const key of keys) {
    const def = TOOLS[key];
    const enabled = def.id in tooling.tools;
    lines.push(
      `| ${CAPABILITY[key]}${def.mutating ? " (writes)" : ""} | \`${def.id}\`${enabled ? "" : " (NOT ENABLED)"} | ${eps.get(def.id) ? `\`${eps.get(def.id)}\`` : "?"} | ${inputs(def.id)} | ${(NOTES[key] ?? "").replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push("");
}
lines.push(
  "## Project-level quirks (swytchcode 2.23.5)",
  "",
  "- `tooling.json` mode `sandbox` routes every call to each integration's `sandbox_endpoint`, which is `http://localhost` for all five bundles. Bahi runs the project in `production` mode and pins PayPal to `https://api-m.sandbox.paypal.com` for both endpoints (`npm run swytch:configure -- --apply`). The runtime refuses any PayPal call whose endpoint is not the sandbox host.",
  "- Jira's `production_endpoint` ships as the placeholder `https://your-domain.atlassian.net`; `swytch:configure` sets it from `JIRA_BASE_URL`.",
  "- Idempotency is off by default. For PayPal Bahi sets `execution_policy.idempotency = { mode: dynamic, header_name: PayPal-Request-Id }`.",
  "- `swy exec` exit codes differ from the docs: unknown tool = 2 (category `not_found`), network failure = 4, policy block = 6 (category `policy_denied`), approval hold = 7 (plain text, no JSON). Bahi classifies by the JSON `category` first.",
  "- \"Required\" markers inside nested body schemas (e.g. `due_amount`, `gratuity` on PayPal invoice create) are not enforced by the kernel: a dry run with only detail, invoicer, primary_recipients and items validates. Top-level path params are enforced.",
  "- `swy add` occasionally exits 0 without adding the tool; verify with `swy list tooling` (or `npm run swytch:configure`, which checks every tool).",
  "",
);
writeFileSync(path.join(root, "docs", "TOOLS.md"), `${lines.join("\n")}\n`);
console.log(`docs/TOOLS.md: ${Object.keys(TOOLS).length} tools`);
