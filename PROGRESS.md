# Bahi: progress log

Running log across phases. Update at the end of every phase (see CLAUDE.md section 8).

## Phase checklist

- [x] **1. Foundation and design system** (25 Sep 2026)
- [~] **2. Swytchcode integration layer** (25 Sep 2026): code complete and green in mock mode; live verification waits on the provider connections (see Phase 2 manual steps)
- [~] **3. Agent brain and live console** (25 Sep 2026): agent, streaming API and UI done; eval 2/2 on S1, S3, S4, S6 in mock mode with the real LLM; live verification waits on `swy login` + provider connections (see Phase 3 manual steps)
- [ ] 4. Guardrails: policies, approval, block, idempotency, audit
- [ ] 5. Voice, UX polish, e2e tests
- [ ] 6. Laya System-1 layer (optional)
- [ ] 7. Demo hardening and submission

## Phase 1: done

- Next.js 16.3.6 (Turbopack, App Router, TS strict + `noUncheckedIndexedAccess`), Tailwind v4, ESLint 9, Vitest 5, npm. Scaffolded into a temp folder and moved up because npm rejects the capitalised folder name "Bahi" as a package name; package name is `bahi`.
- Deps: `motion`, `@phosphor-icons/react`, `zod` (v4), `server-only`.
- `src/lib`: `brand.ts`, `format.ts` (INR + IST), `env.ts` (zod, server-only, readable errors, never echoes values), `config.ts` (non-secret public config), `events.ts` (RunEvent zod schemas + NDJSON helpers), `run-reducer.ts`, `verbs.ts`, `ledger.ts` (Invoice/Client + `summarizeHisaab`), `run-record.ts`, `fixtures.ts`, `demo-player.ts`, `data.ts` (page data; mock vs live), `store/runs.ts` (data/runs.json repository).
- `fixtures/`: 5 clients, 8 invoices (dates are day offsets from today IST), scripted runs for S1, S2 (approved), S2 (denied), S3, S5, S6, and a mock activity history.
- UI: all 4 routes (`/` Command, `/ledger`, `/activity`, `/settings`), light + dark, 390 px mobile (bottom bar + slim top bar), skip link, loading skeletons shaped like ledger rows, error + not-found pages, toasts.
- Command page auto-plays the S2 fixture: AWAITING stamp + pending approval in the right rail, then APPROVED, then SENT, then final. Example chips for S1-S6; submitting an example that has a script plays it (S4 has no script yet and shows a toast). Mic button has designed idle / listening / processing states (not wired to speech yet).
- Tests (27): INR and IST formatting, reducer (full S2 sequence, intermediate AWAITING/APPROVED states, shuffled + reversed delivery, held tool_result until its tool_call arrives, duplicates, other runIds, denied, blocked, error, idle), env parsing, NDJSON round-trip, fixtures + hisaab totals, run store (concurrent saves, upsert, corrupt file recovery).
- Verified in headless Chrome (playwright-core from scratchpad, not a project dep): 4 routes x light/dark x 1440/390 px, zero console errors, zero horizontal overflow; reduced-motion pass also clean (only Motion's own dev notice).
- `npm run contrast`: every token pair meets WCAG AA in both themes.

## Phase 3: agent brain and live console (code done; live verification pending)

### Done

- **AI SDK 7 learned first** (`ai@7.0.114`, `@ai-sdk/google@4.0.80`, `@ai-sdk/groq@4.0.48`, `@ai-sdk/provider@4.0.18`): read the shipped docs (tool calling, loop control, lifecycle callbacks, generateText reference) and types. v7 uses `instructions` (not `system`), `stopWhen: [isStepCount(n), hasToolCall(name)]`, `onToolExecutionStart/End`, `onStepEnd`, `LanguageModelV4`. Read the Swytchcode Vercel AI SDK quickstart (it passes raw endpoint tools from `VercelProvider` to `generateText`).
- **Model ids verified against both live model lists plus a real tool-calling probe**: Gemini `gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-3.5-flash-lite` (`gemini-2.5-flash` is retired for new users; `3.5/3.7/3.8-flash` answered 503 all day); Groq `openai/gpt-oss-120b`, `qwen/qwen3.8-27b` (all Llama models are gone from Groq). Defaults in `src/lib/agent/defaults.ts`, documented in `.env.example`.
- **Model fallback** `src/lib/agent/model.ts`: one `LanguageModelV4` that falls back per LLM call (so tools that already ran are never re-run): each Gemini model with `GEMINI_API_KEY` -> same model with `GEMINI_API_KEY_BACKUP` -> each Groq model. Rate limit, 5xx, timeout (30 s per step), network and bad keys fall through; an owner abort never does. Sticky within a run. A rejected key skips every model on that key. If everything is rate limited and a provider says "retry in N s" (N <= 20), it waits once. A model that hits its daily quota cools down for an hour, process-wide. Each switch is a `thinking` event ("Gemini busy hai, backup model (Groq openai/gpt-oss-120b) use kar rahe hain."). 13 unit tests with simulated failures.
- **Agent tools** `src/lib/agent/tools.ts`: find_client, get_ledger, create_and_send_invoice, check_invoice_status, mark_paid_and_start_delivery, list_inbox, read_email, mark_email_processed, send_payment_reminder, refund_payment, notify_team, daily_brief, plus final_answer (the loop stops on it). Zod schemas, model-facing descriptions, execute() over the phase-2 adapters, never throw. Every underlying Swytchcode call emits its own tool_call/tool_result (create_and_send_invoice = PayPal create, PayPal send, Notion row; list_inbox = list + one get per email).
- **Code-level guardrails** (the prompt is not the only defence): refunds only when the owner's own command asks for one (an email can never trigger one; guard event); a policy block stops the rest of the batch; the model's amount is checked against the owner's words (`amount.ts`) before any call; invoices de-duplicated per run by an intent key (`bahi-<sha256>`, also written to PayPal `detail.reference` and Notion); paid status only from PayPal; Jira task reused if one exists for the invoice; one Slack summary per run, alerts de-duplicated; reminders never for paid invoices and at most one per day.
- **Untrusted email**: bodies trimmed to 2,000 characters and fenced in `<untrusted_email>` (the fence cannot be closed from inside, zero-width characters stripped); rule-based injection signals emit a `guard` event and a warning on the email before the model reads it.
- **Deterministic helpers**: `amount.ts` ("pandrah hazaar", "80k", "1.5 lakh", "sava lakh", "dedh lakh", "saadhe teen hazaar", "ek lakh bees hazaar", Indian digit grouping; "bhej do" is not 2; invoice ids are not amounts); `resolve-client.ts` (aliases, honorifics, Hinglish spellings such as varma/verma, generic words like "traders" never match alone, ambiguous -> candidates, unknown -> not_found); `detectOwnerLanguage` (reply in Hinglish when the owner used it).
- **Prompt** `prompt.ts`: per run, IST date + weekday, business name, all rules from the brief, max 12 steps, reply language.
- **Orchestrator** `orchestrator.ts`: stamps runId/seq/ts, streams events, bounded loop, thinking lines from model narration, speak (clamped to 20 words) + final. If the models give out after tools already acted, the run ends with a summary built only from tool results instead of an error. Client abort stops the loop (error event "Aapne run rok diya").
- **API**: `POST /api/runs` (NDJSON stream, Node runtime, abort-aware, events appended to `data/runs.json` through a throttled persister on the serialized store), `GET /api/runs`, `GET /api/runs/[id]`, `GET /api/ledger`, `GET /api/brief` (15 s cache, `?fresh=1`).
- **Ledger domain**: Notion gained a `Paid on` date column (`paidOn`), set by markPaid, so "Aaj aaya" works in live mode. A Sent row past its due date counts as overdue. Jira summary is now "Deliver: <work> for <client>". In mock mode the Ledger page reads the mock world, so invoices the agent creates show up.
- **UI**: `useRun` (POST, line-by-line NDJSON into the reducer, Stop), CommandBar turns Bhejo into Roko while running, skeleton for the next step, inline request errors, stopped notice; example chips prefill S1-S6 (the phase-1 auto-play demo is gone from the Command page); right rail fetches `/api/brief` with skeleton, error + retry, count-up from the previous value after each run; Ledger has search (client, work, invoice, Jira, amount), empty state with reset, PayPal sandbox and Jira links; Activity links every run to `/activity/[id]`, which replays the stored events through the same timeline (compressed gaps, "Seedha poora dikhao", reduced motion shows all). Slack alert posts are labelled "(alert)" in the timeline; result lines that only repeat the verb are hidden. Settings shows the effective model chains and the backup key.
- **Scripts**: `npm run eval:agent` (mock adapters, real LLM, asserts tool sequences and mock-world side effects, pass/fail table, `--only --runs --pause --verbose`); `npm run scenario -- S1` (live: runs S1, then reads back the PayPal invoice, the Notion row and the Slack post result); `npm run seed:inbox` (live: records a payment on Sharma's open PayPal invoice, creating one if needed, then inserts the three emails through Gmail insert; prints templates if insert is not allowed; `--dry`, `--print`).
- **Tests**: 202 passing (was 98): amount parser, client resolver, language detection, prompt builder, model fallback (failover, backup key, timeout, abort, stickiness, rate-limit wait, daily-quota cooldown, bad key group), untrusted email, tool schemas and guardrails against the mock world, orchestrator with a scripted model (event order, speak length, status, record).

### Verified

- `npm run eval:agent`: **S1 2/2, S3 2/2, S4 2/2, S6 2/2** (run of 25 Sep, 22:00 IST, mostly served by `gemini-3.5-flash-lite` after the other two Gemini models hit their daily quota; 4-12 s per run).
- **Groq fallback proven**: `GEMINI_API_KEY=invalid npm run eval:agent -- --only S1 --runs 1` passed through Groq, with the switch visible in the timeline.
- **From the UI (mock mode, real LLM, headless Chrome)**: S6 and S3 complete with every step streaming in order (S3: guard flag, 2 alerts, Verma invoice, PayPal check, Notion Paid, Jira task, summary, Hinglish reply); Stop mid-S3 stops the server run after 5 calls and the run is saved as stopped; right rail refreshes after the run (₹69,000 -> ₹81,000). All pages at 1440/390 px, light/dark: zero console errors, zero horizontal overflow.
- `npm run check` green, `npm run build` green.

### Live connection (25 Sep, after the phase-3 commit)

- **PayPal connected and verified through Swytchcode** (sandbox create, get, delete, list). On the free Developer plan the browser's "Create a new connection" opens the upgrade page, so credentials go through the env: `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` in `.env.local`, `npm run paypal:token` writes `PAYPAL_API_KEY` (sandbox access token, about 9 h), which Swytchcode reads first (`swy whoami` shows "env var" only in a shell that has it; Bahi loads `.env.local` and passes it to the CLI).
- **The PayPal sandbox rejects INR invoices** ("Currency Code is not valid"): `.env.local` now has `PAYPAL_CURRENCY=USD` (converted at `DEMO_INR_PER_USD`, the UI still shows rupees).
- **Fixed a phase-2 bug found with the first real call:** `swytchcode exec` prints every provider answer as `{ data, request, status_code, [error_category, retryable] }` and exits 0 even for HTTP 4xx. `unwrapKernelOutput` assumed the documented `{ success, result }` shape, so live adapters would have parsed the envelope and treated HTTP errors as successes. Now `data` is unwrapped and `status_code >= 400` becomes an ExecError (kind from `error_category`, else the status; message includes PayPal/Google/Notion/Atlassian error details). Tested against real captures `fixtures/recorded/cli/exec-http-200.json` and `exec-http-400.json`.
- **Notion, Slack, Jira connected** (Default Swytchcode OAuth). Notion: the connection only sees pages shared with it (page ... > Connections > Swytchcode); `setup:notion` found the ledger, schema exact, ids in `.env.local`. Jira: project read OK.
- **Slack bundle quirk:** `chat.postMessage` and `auth.test` declare a required `token` header, so Swytchcode rejected every post in validation. A top-level `token` placeholder satisfies the validator while Swytchcode still injects the real OAuth token (auth.test answered ok with the workspace); the same value in `params` is sent to Slack as the token (invalid_auth). The Slack adapter now sends `token: "swytchcode-managed"` top-level (`ExecInput.token`, regression test).
- The Developer plan says "No policy features" (allow/deny on Pro, approval workflows on Business). Phase 4 must check early whether local policies still enforce; ask the organisers about a hackathon plan.

### Decisions

- **Domain tools over raw Swytchcode tools.** The Swytchcode quickstart hands raw endpoint tools to the model. Bahi keeps the same kernel (every call is still a Swytchcode exec with policies, idempotency and audit) but gives the model domain tools, so it never composes PayPal JSON, and code guardrails sit between the model and the money. Each composite tool still shows every underlying Swytchcode call in the timeline.
- `final_answer` tool instead of parsing free text: reliable reply + speak split; `hasToolCall("final_answer")` ends the loop.
- No `intent` event yet: the LLM does not produce a calibrated label or confidence, and inventing one would be dishonest. Laya (phase 6) will emit it.
- The right rail reads Notion only (cheap on every page load); the spoken daily brief verifies open invoices with PayPal.
- `maxRetries: 0` on generateText; retries and fallbacks live in `model.ts` so the timeline can explain them.
- Hinglish stays the default reply language when detection is unsure.

### Docs vs reality

- AI SDK 7 differs from older docs: `instructions`, `isStepCount` (alias `stepCountIs`), `onStepEnd` (was onStepFinish), `LanguageModelV4` with `finishReason: { unified, raw }` and nested usage objects, `toolApproval` replaces `needsApproval`.
- Gemini free tier is **20 requests per day per model per project** (quota id `GenerateRequestsPerDayPerProjectPerModel-FreeTier`), with a misleading `retryDelay` of about 45 s. Groq free tier: `gpt-oss-120b` 8k tokens/minute, `qwen3.8-27b` 7k input tokens/minute. One agent step sends about 2.5-3.5k tokens.
- Next 16 dev allows one dev server per project folder (a second `next dev` exits and points at the running one).

### Deviations from spec

- **Live Definition of Done not met yet**: Swytchcode says "login required" and no provider is connected (`swy auth status`: none), so S1/S3/S4/S6 were proven end to end in mock mode (real LLM, mock adapters) and from the UI, not against the sandbox. `npm run scenario -- S1` and `seed:inbox` are ready and refuse politely until live mode works.
- Slack verification in `scenario` uses the `chat.postMessage` answer (ok + message ts); reading channel history needs `slack.conversations.history.list`, which is not enabled (adding it needs `swy login`).
- `refund_payment` passes the invoice id as the PayPal capture id. S5 is blocked by policy before any network call, so it is never sent; a real refund would need the capture id from the invoice's payment transactions (phase 4).
- The phase-1 fixture demo no longer auto-plays on the Command page (it would be mistaken for a real run); sample runs still replay from /activity in mock mode.

### Known issues and risks for phase 4

- **Model quota is the biggest demo risk.** A full S3 run is about 6 LLM calls; the free Gemini quota is 60 calls/day across the three default models. Enable billing or add `GEMINI_API_KEY_BACKUP` before the demo (see manual steps).
- Approval (S2): `create_and_send_invoice` already maps `approval_required` to an "awaiting approval" result, and the runtime emits the policy/approval events; phase 4 must add the policy, poll the Swytchcode audit log for the decision, then continue (send + Notion + Slack).
- Tools run in parallel within one step; run state (ledger cache) is not locked. Harmless so far (writes are per row), worth a look when phase 4 adds approvals.
- `POST /api/runs` has no auth: fine on localhost, never expose it publicly.
- A dev server from phase 2 was still running on :3100 with a crashed compile worker (every new dynamic route answered 500); it was restarted on the same port.

### Manual steps for Jatin

1. **Model quota (before any demo):** enable billing on the Google AI Studio project of `GEMINI_API_KEY`, or create a second Google Cloud project, create a key at https://aistudio.google.com/apikey and put it in `GEMINI_API_KEY_BACKUP`. Optional: Groq Dev tier.
2. `swy login` (the Swytchcode session has expired), then the phase-2 manual steps 1-7 (connect PayPal, Gmail, Slack, Notion, Jira; `SWYTCH_MODE=live`; smoke test).
3. `npm run setup:notion` once more (adds the `Paid on` column).
4. `npm run seed:inbox`, then `npm run scenario -- S1`, then S1, S3, S4, S6 from the Command page (`npm run dev`).

## Phase 2: Swytchcode integration layer (code done, live verification pending)

### Done

- **Real API learned first.** Read docs.swytchcode.com (llms.txt, CLI, exec, tools, integrations, auth, policies, human approval, idempotency, manifest, Runtime SDK JS, Vercel AI SDK quickstart) and the shipped source of `@swytchcode/runtime@1.1.6`. Probed the real CLI (2.23.5) for not-found, auth, network, policy-block and approval-hold output; samples saved in `fixtures/recorded/cli/`.
- **Swytchcode project** (`.swytchcode/`): `swy init --editor none` (so it did not touch CLAUDE.md/AGENTS.md), workspace `bahi`, bundles for PayPal, Gmail, Slack, Notion, Jira, **35 tools enabled** (full table with endpoints, inputs and quirks in `docs/TOOLS.md`, generated by `npm run docs:tools`). Committed tooling.json, manifest.json and the bundles (about 3 MB) because the registry was flaky all day; lock files ignored. Secret scan: only schema field names match "token"; no credential patterns.
- **Runtime wrapper** `src/lib/swytch/runtime.ts`: `execTool(tool, input, opts)` returns `{ ok, data, ms, callId, transport }` or `{ ok: false, error }` where error has kind (validation | policy_blocked | approval_required | approval_denied | auth | not_found | provider | timeout | network | unknown), message, policyId, approvalRequestId, exitCode, category, retryable, httpStatus, raw. `onEvent` emits `tool_call`, `policy` (allowed when a guard policy targets the tool, blocked, approval_required), `approval` (pending) and `tool_result`. A `validate` hook lets adapters fail a call whose provider answer is bad (e.g. Slack HTTP 200 `ok:false`) before the timeline shows it as a success. Bahi's own guard refuses any PayPal call unless the active endpoint is `https://api-m.sandbox.paypal.com`.
- **Two transports** (`transport.ts`), both through the same Swytchcode kernel:
  - `cli` (default): async `spawn` of the native `swytchcode.exe` (found under the global npm install, or `SWYTCHCODE_BIN`), JSON on stdin, no shell, so nothing to escape on Windows. About 1.2 s per call.
  - `sdk`: `@swytchcode/runtime` `exec()` inside a `worker_threads` worker, because the SDK uses `spawnSync`, which would freeze the Next server and every open NDJSON stream for the whole API call. About 2 s per call (extra .cmd and node launcher hops). Same normalized errors.
- **Domain adapters** `src/lib/integrations/`: interfaces + zod domain types (`types.ts`), pure parsers per provider, live adapters via `liveCall()`, mock twins over an in-memory world seeded from `fixtures/` (same RunEvents as live), `getIntegrations()` picks by `SWYTCH_MODE`. Adapters return `Outcome<T>` and never throw.
  - PayPal: createInvoice (Prefer: return=representation, intent key in `detail.reference`), sendInvoice, getInvoice, listInvoices, recordPayment, refundCapture, cancelInvoice (deletes drafts, cancels sent ones).
  - Gmail: listUnread (`is:unread in:inbox -label:Bahi-Processed`), getMessage (MIME walk, text/plain first, HTML fallback), sendEmail (RFC 822, header-injection safe, UTF-8 subjects), markProcessed (creates `Bahi/Processed` once, removes UNREAD), insertMessage.
  - Slack: postOps, postAlert (`SLACK_ALERTS_CHANNEL`, defaults to ops), resolveChannel (paginated, cached), auto-join on `not_in_channel`.
  - Notion (API 2025-09-03, data sources): ensureLedgerDatabase, listLedger, findByIntentKey, upsertLedgerRow (by intent key, else invoice id), markPaid, setLastReminder.
  - Jira: createDeliveryTask (label `bahi-inv-<invoice>` + ADF description), findTaskByInvoiceId (JQL on that label, current `/search/jql`), getProject.
- **Clients**: `fixtures/clients.json` has aliases ("Sharma ji") and placeholder payer emails; `data/clients.local.json` (gitignored) overrides real addresses; `matchClient()` resolves spoken names. Jatin's values are in place (Gupta's PayPal email still missing). `.env.local` created (mock mode, business + merchant emails set).
- **Notion ledger**: `npm run setup:notion` finds "Bahi Ledger" (env ids, else search), then sets the exact schema with `notion.data_source.update` (renames the title column to Client, adds or retypes the 11 others, Status select with all 7 options, drops default columns only while the ledger is empty). Idempotent. The Ledger page and hisaab cards read Notion through Swytchcode in live mode.
- **Health + smoke**: `GET /api/health` (Node runtime, 20 s cache, `?fresh=1`) gives per-integration ok/degraded/down, latency, a hint and the `swy auth connect <Provider>` fix command, plus a Swytchcode project check (binary, mode, 35/35 tools, PayPal pin). Settings has live integration cards (status mark with a text label, latency, last checked in IST, copyable fix command, "Dobara jaanchen"). `npm run smoke:swytch` prints the table and posts to `#bahi-ops`; `--write` does a PayPal draft create + delete; `--record` saves sanitized raw responses (`sanitize.ts` scrubs emails, tokens and ids, and re-encodes Gmail bodies).
- **Scripts** (tsx, Windows-safe): `swytch:configure`, `setup:notion`, `smoke:swytch`, `seed:gmail`, `docs:tools`. `docs/SETUP.md` has the exact live setup clicks.
- **Tests**: 98 passing (was 27). New: error normalization against the real CLI samples, exit codes 0-7, SDK error shapes, kernel envelope; parser tests over every file in `fixtures/recorded/<provider>/` (live captures are picked up automatically); live vs mock method parity (compile-time + runtime); mock flows (invoice lifecycle, refund blocked with policy events, inbox processing, idempotent Notion upsert, Jira lookup); live adapters with a stubbed `execTool` (request bodies, Slack join-and-retry, Slack ok:false, PayPal draft delete vs cancel, Gmail RFC 822, Jira JQL); PayPal sandbox guard, sanitizer, client matching.
- Verified in headless Chrome: Settings at 1440 px and 390 px, light and dark, zero horizontal overflow, zero console errors. `npm run build` clean.

### Docs vs reality (Swytchcode 2.23.5, `@swytchcode/runtime` 1.1.6)

- **SDK API**: the docs show `new SwytchcodeRuntime()` + `runtime.execute({ tool, input })`. The package exports `exec(canonicalId, args, options)`, `Swytchcode` (with `tools.get` / `tools.execute` / `VercelProvider`) and `SwytchcodeError`. It is a thin wrapper that runs the CLI with `spawnSync`. The thrown error carries the exit code in `cause`, and stderr is parsed as JSON only when it is pure JSON (usually it is not).
- **Exit codes**: the docs say 0 ok, 1 failed, 2 invalid, 3 auth, 4 policy, 5 not found. Observed: unknown tool 2 (category `not_found`), missing credentials 3 (`auth`), network failure **4** (`network`), policy block **6** (`policy_denied`), approval hold **7** (plain text `Approval requested for <tool> (policy "<id>"). Request <id>.`, no JSON). Bahi classifies by the JSON `category`, then message text, then exit code.
- **stderr** mixes progress lines, a log line that echoes the request body, and the classified JSON. Bahi never stores raw stderr (it can contain emails).
- **Approval flow**: the CLI exits at once and "a background process is watching and will run this command automatically once it is approved". The caller never gets the approved result; `swy audit policy --json` shows the request with `status: "hitl"`. Phase 4 has to poll the audit log (or re-read the provider) to learn the outcome.
- **Policy actions**: `swy policy add --help` lists POLICY_BLOCKED, REQUIRES_APPROVAL, AUTH_FAILED, QUOTA_EXCEEDED, RATE_LIMITED. `--non-interactive` works with flags.
- **Sandbox mode means localhost**: with `tooling.json` mode `sandbox`, every call goes to `sandbox_endpoint`, which is `http://localhost` for all five bundles. PayPal's bundle has localhost for **both** endpoints (its wrekenfile says api-m.sandbox.paypal.com). Jira's production endpoint is the placeholder `https://your-domain.atlassian.net`. Hence `npm run swytch:configure`.
- **Idempotency** is off by default (`mode: none`); PayPal needs `header_name: PayPal-Request-Id`.
- **Canonical ids** are not `paypal.*`: PayPal invoicing is `invoices.invoicing.*`; list endpoints are sometimes named `get` (`gmail.user.messages.get` lists, `get1` fetches one); Notion has a typo (`notion.databas.get`); `payments.payment.captures.refund` exists in two libraries (needs `swy add method PayPal@payments_payment_v2.2.0 ...`).
- **The Notion bundle has no create-database tool** (no POST /v1/databases). The empty "Bahi Ledger" is created once by hand; the schema and all rows go through Swytchcode.
- `swy exec` auto-fetches missing bundles. `swy add` sometimes exits 0 without adding (re-run; `swytch:configure` verifies all 35). Registry calls (search/get/discover) timed out or returned HTTP 520 for long stretches; the Jira bundle took about 30 minutes of retries.
- Nested "required" markers in body schemas are not enforced by the kernel (PayPal create validates without `due_amount` and `gratuity`).

### Decisions

- The default transport is the async CLI; the SDK path is kept (worker thread) and selectable with `SWYTCH_TRANSPORT=sdk`. Why: non-blocking streaming, access to exit codes and stderr (needed for approval holds), and speed.
- A live-mode model key is no longer required at env parse time, so integrations can be tested before phase 3; phase 3 checks it when the agent starts.
- New env: `SWYTCH_TRANSPORT`, `SWYTCHCODE_BIN`, `SWYTCHCODE_PROJECT_DIR`, `SWYTCH_TIMEOUT_MS`, `NOTION_LEDGER_DATA_SOURCE_ID`, `JIRA_BASE_URL`, `SLACK_ALERTS_CHANNEL`, `PAYPAL_CURRENCY` (INR|USD), `DEMO_INR_PER_USD`, `PAYPAL_MERCHANT_EMAIL`.
- The tool registry `src/lib/swytch/tools.ts` is the single source of canonical ids and verbs; `verbs.ts` reads it and keeps the phase-1 ids as aliases for old run history. Fixture scripts now use real ids.
- The ledger domain gained a `refunded` status; clients gained `aliases` and `paypalEmail` (`email` stays the contact email).
- Mock refunds always return `policy_blocked` (policy id `refund-bulk-or-large`) to mirror the S5 guard until phase 4 adds real policies.
- Sample provider responses (`fixtures/recorded/<provider>/*.sample.json`) are labelled as documented shapes, not captures; live captures go next to them via `smoke:swytch -- --record`.
- Never export a function named `then` from a module: `result.ts` did, which made the module namespace thenable and hung every `await import()` (vitest collection, and it would have hit Next too). Renamed to `andThen`.

### Deviations from spec

- **The live Definition of Done is not met yet.** No provider is connected (`swy auth status`: none), so the smoke test is red, Settings shows red in live mode, the Notion ledger does not exist, and the currency check (step 5) has not run. Everything is ready; it needs the manual steps below.
- The mode switch and manifest pinning were **not applied by Claude**: the auto-mode classifier blocked changing the `tooling.json` mode, so Jatin runs `npm run swytch:configure -- --apply` himself.
- `package.json` engines raised to Node >= 22 (`@swytchcode/runtime` requires it; Node 24 is installed).
- `fixtures/recorded/` holds CLI captures and documented-shape samples, not yet live provider captures.

### Known issues and risks for phases 3-4

- **Approval policy target**: Swytchcode policies match on request fields, and the invoice amount lives at `body.items[0].unit_amount.value` (nested, and a string). Whether a policy `field` supports dotted or array paths is unverified (the docs list "dotted field paths" among validation checks). Phase 4 must test this first; the fallback is a Bahi-side pre-check that routes large invoices to an approval-gated tool.
- **Approval result**: the approved command runs in a Swytchcode background process; Bahi must poll `swy audit policy --json` or re-read PayPal to continue S2.
- Jira through Swytchcode OAuth may need the `https://api.atlassian.com/ex/jira/<cloudId>` base instead of the site URL; confirm right after `swy auth connect Jira`.
- Latency: each call is a process spawn (about 1.2 s here, more with 5 in parallel). Fine for the demo; phase 3 should run independent reads in parallel.
- Notion has no "paid on" column, so "Aaj aaya" is 0 in live mode until phase 3 derives it (PayPal payment date or Notion edit time).
- The kernel's `max_response_bytes` is 100 KB; very large Gmail messages could be cut.
- Gupta Electronics has no PayPal sandbox payer email yet (it falls back to a placeholder PayPal will reject).

### Manual steps for Jatin (in order; details in docs/SETUP.md)

1. `npm run swytch:configure` (review), then `npm run swytch:configure -- --apply`.
2. PayPal: sandbox app Client ID + Secret, then `swy auth connect PayPal`. Send the third (Gupta) sandbox personal email.
3. `swy auth connect Gmail` with jatinvatsmaster@gmail.com.
4. Slack: create `#bahi-ops` and `#approvals`, then `swy auth connect Slack`.
5. Notion: page "Bahi" containing an empty inline database "Bahi Ledger"; `swy auth connect Notion` sharing that page; then `npm run setup:notion` and put the two printed ids in `.env.local`.
6. Jira: create the site and project `BAHI`, set `JIRA_BASE_URL` in `.env.local`, re-run `npm run swytch:configure -- --apply`, then `swy auth connect Jira`.
7. Set `SWYTCH_MODE=live` in `.env.local`, then `npm run smoke:swytch -- --write --record`. This is also the INR currency check: if PayPal rejects INR, set `PAYPAL_CURRENCY=USD`. Review `fixtures/recorded/` and commit.

## Decisions log (phase 1)

- **RunEvent is zod-first** (`events.ts`), types inferred. `run_started` also carries `command`, `inputMode`, `mode`; `approval` has optional `by`. `RunEventDraft` = event before runId/seq/ts are stamped.
- **Reducer re-folds from a sorted, de-duplicated event list** on every event. Handles out-of-order and duplicate delivery trivially; runs are tens of events so cost is negligible. `missingSeqs` exposes gaps. Orphan policy/approval/result events wait for their tool_call.
- **Status precedence**: failed > blocked > denied > expired > awaiting_approval > completed > running. A blocked run stays blocked after `final`.
- **Stamps**: tool entry stamp = blocked/denied/expired, else approval (awaiting/approved), else SENT for successful `*.send` tools. Run stamp = status stamp, else APPROVED if any approval passed, else SENT if completed with a send.
- **Tool ids are provisional** (`paypal.invoice.create`, `notion.ledger.upsert_row`, ...). Phase 2 must map them to real Swytchcode canonical ids and update `verbs.ts` + fixtures.
- **Colour tuning for AA**: base brief tokens kept for fills/borders; added text variants `ink-faint-text` (#6F6358 light / #A09282 dark), `pending-ink` (#86560B light), `zari-ink` (#7C5A14 light), `bahi-ink` (#E0685C dark), `expired-ink`, `--focus` (#9A7224 light, zari in dark), and `bahi-fill` (#B23A30 in dark) because paper text on #C8453A is only 4.36:1.
- **Theme**: `data-theme` on `<html>`, inline head script before paint (Next 16 "preventing flash" guide), preference in localStorage `bahi-theme`, system by default. Toggle icons swap via CSS so SSR markup is identical.
- **Pages are dynamic** (`await connection()` in the root layout) so SWYTCH_MODE and business name are read per request, not baked in at build.
- **Live mode is honest**: with SWYTCH_MODE=live the ledger/hisaab show "not connected yet" instead of fixtures, and no demo scripts play.
- **Activity** reads `data/runs.json`; if empty in mock mode it shows sample runs with a visible "sample runs (mock data)" note.
- **Design-taste skill** was applied, but the brief overrides it where they conflict (Fraunces, warm paper palette explicitly requested). Kept from the skill: Phosphor, no em-dashes in UI copy, no decorative dots, AA checks, reduced motion.
- Shape rule: 6px radius for surfaces/inputs/buttons, full pill for chips, circle mic, 3px stamps.

## Deviations from spec

- Node 24 and Python 3.14 are installed (spec says Node 20+, Python 3.11). Fine for phase 1; check Laya's Python requirement in phase 6.
- `@types/node` pinned to ^22 (vitest 5 peer requirement).
- Next 16 `error.tsx` receives `retry` (not `reset`).
- Extra modules beyond the brief's list: `config.ts`, `data.ts`, `ledger.ts`, `run-record.ts`, `verbs.ts`, `fixtures.ts`, `demo-player.ts`, `components/ledger/LedgerTable.tsx`, `components/shell/{NavLinks,ModeBadge,Wordmark,PageHeader,ThemeSegment,theme,theme-script}`, `components/command/CommandView.tsx`, `components/ui/CountUp.tsx`.

## Known issues

- Mic is visual only (phase 5 wires Web Speech API). (Typed commands go to the real agent since phase 3.)
- S4 (reminders) has no fixture script yet.
- In full-page screenshots the fixed sidebar/bottom bar appear mid-page; this is a screenshot artefact, not a layout bug.
- Next dev indicator sits top-right (moved off the Mock data badge); on mobile it overlaps the theme toggle in dev only.

## Manual steps for Jatin

- Nothing required for phase 1. `copy .env.example .env.local` is optional (defaults to mock mode).
- Phase 2 manual steps: see "Manual steps for Jatin" under Phase 2 above.
