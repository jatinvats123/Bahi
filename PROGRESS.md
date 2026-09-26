# Bahi: progress log

Running log across phases. Update at the end of every phase (see CLAUDE.md section 8).

## Phase checklist

- [x] **1. Foundation and design system** (25 Sep 2026)
- [~] **2. Swytchcode integration layer** (25 Sep 2026): code complete and green in mock mode; live verification waits on the provider connections (see Phase 2 manual steps)
- [~] **3. Agent brain and live console** (25 Sep 2026): agent, streaming API and UI done; eval 2/2 on S1, S3, S4, S6 in mock mode with the real LLM; live verification waits on `swy login` + provider connections (see Phase 3 manual steps). Update 26 Sep: S3, S4 and S6 ran live in phase 5 (recorded in fixtures/runs/)
- [x] **4. Guardrails: policies, approval, block, idempotency, audit** (26 Sep 2026): 3 Swytchcode policies (validated, probed against the kernel), approval desk, blocks, intent keys, Audit tab; S1, S2, S2-deny, S5, dup and email-guard verified live and from the UI. Also closes phase 2 and 3 live verification for S1.
- [x] **5. Voice, UX polish, e2e tests** (26 Sep 2026): voice in (Web Speech + confirm strip) and out (speechSynthesis), replay mode from real live runs of all six scenarios, Demo controls, UX fixes from a 4-width x 2-theme screenshot review, 29 Playwright e2e tests green, Lighthouse desktop 96/96 on Command; live S1 and S6 by (stubbed) voice verified end to end
- [-] 6. Laya System-1 layer (optional): **skipped** by decision (26 Sep); Laya removed from UI, env and docs
- [x] **7. Demo hardening and submission** (26 Sep 2026): `demo:reset`, failure drills, network hardening, README + architecture diagram, runbook, pitch; S1-S6 verified live after a reset

## Phase 7: demo hardening and submission (done)

### Done

- **Start state**: phase 5 was on main and pushed. `npm run check` green; `npm run e2e` 28/29: "a finished run has no horizontal overflow" (390 px) caught the S2 stamp mid-slam (scale 1.4) 4 px past the edge. Fixed with `overflow-x: clip` on the run section; 29/29 since.
- **`npm run demo:reset [-- --dry | --clean-only]`** (`scripts/demo-reset.ts`, idempotent, about 110 s): cancels open PayPal invoices to Bahi's clients (drafts deleted), moves every Notion ledger row to the trash (new `NotionAdapter.archiveRow`, `in_trash`), deletes Jira tasks labelled `bahi` (new `JiraAdapter.listBahiTasks` / `deleteTask`, new Swytchcode tool `jira.api.issue.delete2`, 36 tools now), expires pending approvals, then seeds the mock ledger's story with the three clients that have real demo addresses: Gupta ₹24,000 Paid today (PayPal payment + Jira task), Sharma ₹6,000 Sent not due (paid in PayPal for S3), Sharma ₹18,500 overdue 8 days, Verma ₹32,000 overdue 5 days. PayPal invoices are backdated to match (new optional `CreateInvoiceInput.issueDate`). Inbox: Verma invoice request, Sharma payment confirmation naming the real invoice id, Gupta complaint, prompt injection. Posts a Slack line and prints a summary table plus the stage commands. Mock mode calls `POST /api/demo/reset` instead.
- **Inbox cursor** (`src/lib/integrations/gmail/cursor.ts`, `data/inbox-cursor.json`): the demo inbox is Jatin's real Gmail with 50+ unread real mails (some too large for the API: the phase-5 "five mails Gmail refused to read"). Instead of marking real mail read, `demo:reset` sets a cursor and the Gmail query becomes `in:inbox -label:Bahi-Processed after:<cursor>`. With a cursor, opened-but-unprocessed mail still counts (a live S3 missed the Sharma email because something outside Bahi had opened it). Without a cursor the old unread-only query applies.
- **Network hardening** (found during the live runs):
  - Broken IPv6 on this network: Node tried IPv6 only and every model call timed out (curl worked). `dns.setDefaultResultOrder("ipv4first")` in `src/instrumentation.ts` and in `scripts/lib/env.ts`.
  - A stalled model socket held one live S1 for 8 minutes (whole-run timeout) because the provider ignored the abort signal. `model.ts` now races each call against the step timeout (`raceAbort`), with a test for a model that ignores the signal.
  - Swytchcode CLI telemetry (PostHog) cost about 1.4 s per call and up to 30 s when PostHog was unreachable; `SWYTCHCODE_NO_TELEMETRY=1` is now set for every CLI spawn (`cliEnv()`, opt out with `0`). A demo reset went from 163 s to 107 s.
  - An expired `swy login` ("anonymous use is limited to 2 executions") was shown as "Rok diya gaya: policy". Now `kind: auth`, `category: login_required`, owner message "Swytchcode login khatam ho gaya. Terminal mein swy login chalayein".
- **Phone approval**: the Slack approval message links to `/?approval=<id>`; the Command page now scrolls that card into view and focuses Approve (on phones the rail is below the fold). `allowedDevOrigins` covers private LAN ranges for `next dev`.
- **Laya removed**: Settings row, `LAYA_*` env, `laya` from the intent/guard event source enums (never emitted), timeline branches; CLAUDE.md says phase 6 was skipped.
- **Docs**: README rewritten (pitch, problem, 3 screenshots, how it works, Mermaid + `docs/architecture.svg`, integration table with canonical ids, guardrails table, Windows setup in mock + replay without accounts, env table, scripts, tests, limitations). `docs/DEMO_RUNBOOK.md` (checklist, stage script, failure table, replay fallback, drill results). `docs/PITCH.md` (2.5-minute script with timings, 6 jury answers).
- **Tests**: 266 unit (was 261): unread query with and without cursor, login-expired classification (exit 6 and exit 0), stalled model ignoring abort.

### Verified live (26 Sep, 10:07-10:20 IST, after `demo:reset`, real LLM, sandbox)

- **S1** PASS (PayPal SENT ₹15,000, Notion Sent, Slack). **S2 --auto** PASS (held by the gate, no network, pending -> approved, PayPal SENT ₹80,000, Notion Sent). **S5** PASS (BLOCKED, `swy audit` entry, no network, one refund call, one Slack alert). **S3**: all four mails handled, no failed step (Verma ₹12,000 invoice, Sharma payment verified -> Notion Paid + Jira KAN-6, Gupta complaint alert, injection flagged). **S4**: reminders to Verma and Sharma (policy `email-known-clients-only` allowed both), Slack. **S6**: spoken brief + Slack.
- **Drills**: Gemini key invalid -> Groq (eval, mock integrations) PASS. Jira down (`JIRA_PROJECT_KEY=NOPE`, live S3) PASS: payment verified, Notion Paid, email labelled, Slack, Jira FAILED and named in the final answer. Approval not answered (`APPROVAL_TIMEOUT_SEC=20`, live S2-deny --manual) PASS: expired, no invoice, Notion Cancelled (the script's two "denied" checks report FAIL because the outcome is expired, as intended). Everything down -> replay: covered by the e2e suite.
- Final `demo:reset` at 10:18 IST: clean stage story in place.
- Secret scan of the whole history: no secret files ever committed; none of the `.env.local` key values appears in any commit; no provider-format keys. Nothing to rotate.
- `npm run check` green (266), `npm run build` green, `npm run e2e` 29/29.
- **Fresh clone** (temp folder, README steps: `npm install`, copy `.env.example`, `AGENT_MODE=replay`, build, serve): all pages and `/api/health`, `/api/brief` answer 200; `POST /api/runs` streams the S1 and S5 recordings (S5 with its block). No accounts or keys needed.

### Decisions

- The "Jira down" drill uses a wrong project key, not a real disconnect: Swytchcode ignores `JIRA_API_KEY` for the OAuth connection, and reconnecting needs a browser. The failure is still real (Jira rejects the call through Swytchcode).
- `demo:reset` never marks the owner's real mail read; the cursor does the job and is undone by deleting one file.
- On stage S3 must come before S6: the brief verifies open invoices with PayPal and reconciles the paid Sharma invoice on its own (correct behaviour, but it would take S3's moment).

### Known issues

- Gemini free quota was exhausted on two models all morning; runs used `gemini-3.5-flash-lite`. The quota resets at 12:30 PM IST. `GEMINI_API_KEY_BACKUP` is still empty.
- `npm run scenario -- S2-deny --manual` reports its "denied" checks as FAIL when the approval expires (expected for the expiry drill).
- The `?approval=` phone flow was implemented and type-checked but not exercised on a real phone.
- Settings screenshots in `docs/screenshots/` still show the removed Laya row (they are not used in the README).

### Manual steps for Jatin

1. Before going on stage: the checklist in `docs/DEMO_RUNBOOK.md` (`swy login` within the hour, `npm run paypal:token`, `BAHI_PUBLIC_URL` = laptop Wi-Fi IP, `npm run demo:reset`, `npm run build` + `npm start`, Settings all green).
2. Submit on Commudle by 3:00 PM IST.

## Phase 5: voice, UX polish, e2e (done)

### Done

- **Live recordings first** (the Swytchcode session had 40 minutes left): recorded S6, S3 and S4 live with `npm run scenario` (S1, S2, S2-deny, S5 were already live from phase 4). S3 needed `npm run seed:inbox`. S4 needed an overdue invoice, so the Verma Sweets ₹90,000 row's due date in the Notion sandbox ledger was moved to 19 Sep (through the Notion adapter, so through Swytchcode). S4 then sent one real reminder email to Verma's demo address (policy `email-known-clients-only` allowed it).
- **Replay mode** (`AGENT_MODE=live|replay`, `REPLAY_SPEED`): `npm run record:replays` picks the newest live run that fits each scenario (S1 needs a successful PayPal send, S2 an approved approval, S3 a flagged email, ...), drops heartbeats, renumbers seq and sanitizes every string (real client emails become the fixture placeholders, other addresses `someoneN@example.com`, PayPal ids `INV2-DEMO-000N-BAHI-RPLY` consistently across recordings, Gmail ids `msg-00N`). It refuses to write if anything real is left. `fixtures/runs/<scenario>.ndjson` + `index.json` for S1, S2, S2-deny, S3, S4, S5, S6. In replay, `POST /api/runs` maps the command to a recording (`matchScenario`: keywords, invoice amount vs the approval threshold) or takes `scenario` from Demo controls, then streams it with recorded gaps clamped to 90 ms-2.2 s and an approval hold of at least 1.5 s. Timestamps are playback time; the header shows when it was recorded. Replays go on the run bus (Stop and reattach work) but are not saved to history. Unknown commands get a polite 422.
- **Contract**: optional `run_started.replay { scenario, recordedAt, sourceRunId }`; the reducer exposes `view.replay` and the started entry carries it (tests updated). The UI shows a dashed "Recorded run" badge plus "Live sandbox run, recorded 26 Sep, 2:11 AM. Dobara chal raha hai, asli nahi.", a "Recorded run: S2" chip instead of "Live", read-only approval cards (no Approve/Deny on a recording), and a "Recorded" badge next to "Mock data" in the sidebar ("Mock + Rec" in the mobile top bar).
- **Voice in** `src/hooks/useVoice.ts`: SpeechRecognition / webkitSpeechRecognition, en-IN (default) / hi-IN / en-US picker persisted in localStorage (try/catch, `useSyncExternalStore` so SSR and hydration agree), interim words stream into the command bar, final on silence, click to toggle, hold Space to talk (not when focus is on a control), Esc cancels. Live input level through getUserMedia + AnalyserNode is written to a CSS variable (two ink rings breathe with the voice, no re-renders, static under reduced motion). Friendly Hinglish copy for not-allowed, no-speech, audio-capture and network errors. Without SpeechRecognition the mic is hidden and the status line says "Voice ke liye Chrome use karein" (its space is reserved until support is known, so no layout shift).
- **Confirm strip** for spoken money commands (invoice, refund, reminder, or any amount): `understandCommand` runs the phase-3 amount parser and client resolver in the browser (the resolver is now generic over a names-only client, so the page gets names and aliases, never emails) and shows "₹15,000 · Sharma Traders · invoice" (plus "approval lagega" above the threshold) with a 2.5 s countdown ring, Badlo (edit) and Roko (cancel, also Esc); then the run starts with source voice. Reading commands (hisaab, inbox) run straight away.
- **Voice out** `src/hooks/useSpeech.ts`: each `speak` event of a run started in this tab is spoken (never on load or reattach). The voice picker prefers en-IN for Latin Hinglish and hi-IN for Devanagari, natural/online and Google voices first; "₹1,85,000" is read as "1,85,000 rupaye" and invoice ids are not read out. Mute toggle in the command bar (persisted); speech stops on a new command, on mute and on Esc.
- **Command page**: "Namaste, DukaanSetu" with today's numbers ("Aaj ₹69,000 aana baaki hai, ₹50,500 late, aaj ₹33,500 aaya."), "/" focuses the bar, Up recalls earlier commands (last 20, localStorage), and a new run scrolls into view when it starts below the fold (phones).
- **Demo controls** (Ctrl+Shift+D on any page): S1-S6 and S2-deny in one click (from another page it navigates to `/?demo=S3`), Reset demo data (`POST /api/demo/reset`, mock world only, refuses in live mode), and badges for Swytchcode mode, agent mode, mic support and the speech voice.
- **States**: offline banner on every page; error toasts with a retry action (brief on Command, integration health on Settings); the Ledger "unavailable" card has Dobara padho; Settings has a loading skeleton; existing empty states kept.
- **Details**: copy button on invoice ids (ledger table, mobile ledger, timeline); timeline rows cascade 45 ms apart through Motion variants (streamed rows animate on arrival; opacity + 6 px only); stamp slam and count-ups unchanged; `data-stamp` hooks for tests.
- **UX review** (Playwright screenshots of 5 pages x 390/768/1280/1440 x light/dark, plus a finished S2 run). Problems found, most important first: (1) 390 px horizontal overflow from the voice-language select; (2) Settings at 1280 overflowed where long values (email, URL) sit in the narrow right column; (3) the 390 px placeholder wrapped to three lines; (4) the mobile top bar squeezed the business name to "Dukaan..." with two stacked badges; (5) on phones a started run appeared below the fold; (6) Lighthouse: `aria-label` on a role-less span (wordmark); (7) recorded runs begin with "Gemini busy hai" fallback lines; (8) the idle desktop Command page has a large empty area; (9) the placeholder still takes three lines at 390 px after shortening; (10) `thinking` rows for model switches look like agent thoughts. Fixed 1-6 (short language labels, container-query rows with wrapping values, shorter placeholder, one compact badge, scroll-into-view, `role="img"`). Kept 7 and 10 on purpose (honest records of the model fallback) and 8-9 as minor. Second pass: zero console errors and zero horizontal overflow at every width and theme.
- **Lighthouse (desktop, Command page, production build)**: performance 96, accessibility 96 (before the wordmark fix), best practices 100; LCP 1.3 s, TBT 60 ms, CLS 0.006. Fonts stay on next/font.
- **E2E** (`npm run e2e`, Playwright 1.63, Chromium): builds and serves on :3210 with `SWYTCH_MODE=mock AGENT_MODE=replay REPLAY_SPEED=8`. 29 tests: every page (and a run replay page) with zero console errors; mode badges; S1 renders every step (count checked against the folded recording), SENT stamp, copy button, Recorded run badge and no "Live" label; S2 AWAITING then APPROVED with a read-only card; S2-deny DENIED from Demo controls; S5 BLOCKED; S3 suspicious-email guard step and Slack alert; S4/S6 from Demo controls on another page; unknown command refused; "/" focus and Up recall; theme toggle persists; offline banner; ledger filters and search; mobile 390 bottom-bar navigation and no overflow on every page and on a finished run; mic hidden without SpeechRecognition; with a stub: listening state, confirm strip text, auto-send after 2.5 s with "Awaaz se", Roko cancels, a reading command runs straight away, hold Space to talk. README screenshots in `docs/screenshots/` (`npm run screenshots -- --readme`).
- **Tests**: 261 unit tests (was 242): sanitizer, leak finder, replay timing and restamp, scenario matching, committed recordings fold to the promised outcome, confirm-strip understanding, voice picker and speakable text, reducer replay block.

### Verified live (26 Sep, 03:06 IST, production build, SWYTCH_MODE=live, AGENT_MODE=live, real LLM)

- In Chromium with a SpeechRecognition stub delivering the transcript (the real microphone needs a human; see manual step 1): **S6 by voice** ran live (Notion, PayPal status checks, Slack post) in 23 s, and the reply "Aaj pandrah hazaar mile hain, ek lakh sattar hazaar milna baaki hai." went to speechSynthesis. **S1 by voice** ("Sharma Traders ko logo design ke liye 15,000 ka invoice bhejo"): confirm strip "₹15,000 · Sharma Traders · invoice", then the PayPal sandbox invoice was created and sent (SENT stamp), Notion row, Slack post, spoken reply, 32 s, zero console errors. Both entries show "Awaaz se" and "Live".
- `npm run check` green, `npm run build` green, `npm run e2e` 29/29.

### Decisions

- Replays re-stamp times to playback time (approval countdowns keep working) and state the recording time in the header; they never reach `data/runs.json`, so Activity stays a record of real runs.
- A replay's `inputMode` is how the owner asked this time (voice or text); the command text shown is the recorded one.
- The confirm strip covers invoices, refunds and reminders (money moves or a client is contacted); reading commands run at once.
- Spoken replies prefer an Indian English voice even when recognition is hi-IN, because replies are Hinglish in Latin script.
- Demo controls are hidden (keyboard only), so they never show in a judge's normal view.

### Deviations from spec

- The optional MediaRecorder + Gemini transcription fallback for Web Speech network errors was not built (the network error has friendly copy and typing always works).
- "Speaking S1 and S6 in Chrome" was verified with a SpeechRecognition stub in headless Chromium against the live stack; the real microphone path needs Jatin once (manual step 1).
- The S3 recording is a real but imperfect run: the inbox held older unread demo mails, five of which Gmail refused to read, and the model did not act on the Gupta invoice request in that run. The guard, alert, payment verification, Notion Paid and Jira steps are all real.
- S1's live voice check used "logo design" instead of "website redesign", because today's website-redesign invoice already exists and is correctly skipped as a duplicate.

### Known issues and risks for phases 6-7

- The Gemini free quota is still the main live risk (runs today used `gemini-3.5-flash-lite` after two models hit their daily quota). Replay mode is the safety net.
- The headless test machine only has "Microsoft David (en-US)" installed; Chrome on Jatin's laptop will pick an en-IN or Google हिन्दी voice. Check how it sounds.
- Swytchcode `swy login` sessions last about an hour; the PayPal token from `npm run paypal:token` about 9 h (last set 25 Sep 23:17).
- The Notion Verma ₹90,000 row now has a backdated due date (19 Sep) so S4 has something to chase; it got a reminder today, so a second S4 today will skip it (one reminder per day).
- Next 16 allows one `next dev` per folder; e2e uses `next build` + `next start` on :3210, so it runs next to a dev server.

### Manual steps for Jatin

1. In Chrome, `npm run dev`, allow the microphone, press the mic and say "Aaj ka hisaab batao"; then "Sharma Traders ko packaging design ke liye 15,000 ka invoice bhejo" and let the confirm strip count down. Listen to the reply; if the voice sounds wrong, switch Bhasha to HI and try again.
2. Before the demo: `npm run paypal:token`, `swy login` if `swy whoami` says expired, and consider `AGENT_MODE=replay` as the fallback if the model quota is gone (every run is then labelled Recorded run).
3. Press Ctrl+Shift+D once to see the Demo controls.

## Phase 4: guardrails (done, verified live)

### Done

- **Real policy API learned first** (docs + probes against swytchcode 2.23.5, all dry-run, no network):
  - `field` must be flat: `body.items.0.unit_amount.value` fails validation ("dotted paths are not supported in v1"). Top-level inputs and top-level body keys resolve (the validator warns "not an input" for body keys, wrongly).
  - `contains` / `matches` on `body` see Go's `%v` rendering of the body (`map[k:v ...]`, sorted keys, unquoted strings). Regexes over it read nested amounts. `renderGo()` reproduces it.
  - `REQUIRES_APPROVAL` is accepted by `swy policy validate`, but the free Developer plan refuses to create the request ("approval requests are not included in your current plan ... The command was not run", exit 6, `swy audit policy` status `failed`). The phase-2 probe had already logged `402: policy_tier is not available`.
  - A block: exit 6, category `policy_denied`; the exec log records `outcome: policy_violation` with no `network` entries (proof the provider was not called). `swy exec --explain` prints Tool / Provider / Mode / Endpoint on **stderr**, and policies apply to explain too.
- **Three policies, generated from code** (`src/lib/guardrails/policies.ts`, `npm run policies:sync`, `swy policy validate` clean):
  - `invoice-approval-over-threshold` on `invoices.invoicing.invoices.create`: amount above ₹50,000 (INR, or USD at DEMO_INR_PER_USD, one regex) and no approval stamp in `detail.memo`.
  - `block-large-refunds` on `payments.payment.captures.refund`: no amount (full refund) or above ₹10,000. Message exactly as specified.
  - `email-known-clients-only` on `gmail.user.send.create1`: anchored regex on the base64 of a 3-byte-aligned `To:` line, one alternative per client address (union of fixtures and `data/clients.local.json`, lower-cased, chunked under the 512-char cap). The allowlist is regenerated from the clients file by the same script.
  - `npm run policies:sync -- --probe`: 15 dry-run decisions from the real kernel all match Bahi's evaluator.
- **Approval flow** (fallback (b)+(c) of the brief, see Deviations): Swytchcode gate policy + **Bahi approval desk**. The runtime turns a block by the gate policy into `approval_required` (via "bahi"); `create_and_send_invoice` writes a Notion "Awaiting approval" row, creates the approval (`data/approvals.json`, file-backed so a scenario script and the dashboard share it), posts to Slack `#approvals` through Swytchcode, fetches a `swy exec --explain` line for the card, waits up to `APPROVAL_TIMEOUT_SEC` (300) with `heartbeat` events every 10 s, then: approved -> re-issues the create with the stamp (same callId, so one timeline entry goes AWAITING -> APPROVED), send, Notion Sent; denied / expired -> Notion Cancelled, agent stops and tells the owner. `APPROVAL_MODE=swytchcode` switches the policy to `REQUIRES_APPROVAL` and polls `swy audit policy --json` (for a paid plan; untested live).
- **Runs survive a disconnect**: in-process run bus; `GET /api/runs/:id?tail=1` replays then streams; `POST /api/runs/:id/stop` is the only way to stop (Roko); `GET /api/runs/live`; the Command page reattaches after a reload.
- **Blocks**: policy events carry the policy's own message; Bahi posts exactly one Slack alert per run about a block (the model's duplicate alerts are skipped); one refund per command (parallel calls included); the batch stops after the first block.
- **Idempotency**: PayPal dynamic idempotency (`PayPal-Request-Id`) already on for both PayPal libraries; Gmail has no idempotency header, so it stays `none`. App intent key moved to `src/lib/guardrails/intent-key.ts` (normalized description drops filler words; IST date); a Notion row with the key in Awaiting approval / Sent / Paid returns `already_done` with an `idempotent` tag and "Ye invoice aaj 12:51 AM pe already bheja ja chuka hai (INV2-...)". A Draft left by a failed send is re-sent, not duplicated. Reminders: one per invoice per day.
- **Audit tab** (`/activity?tab=audit`): `swy audit policy --json` + the exec log `swy audit` reads (`~/.swytchcode/audit/*.jsonl`, request args never read into the UI) + run events + approval desk; decision chips, "provider not called", `retry xN` only when the log shows more than one HTTP attempt, link to the run, filters by integration and decision.
- **Settings > Guardrails**: each policy in plain language with its threshold, active or not, out-of-date warning, approval mode, idempotency per PayPal library.
- **UI**: `ApprovalCard` (AWAITING / APPROVED / DENIED / EXPIRED stamps, client, INR amount, policy id, Slack channel, countdown, explain line, Approve karein / Mana karein) inline in the timeline and in the right rail (polls `/api/approvals`, so approvals from any run or script show, plus decisions from the last 15 minutes). `idempotent` tag chip.
- **Contract**: `heartbeat` event (reducer ignores it); optional `tool_result.tags`; optional approval details (`approvalId`, `via`, `policyId`, `client`, `amountInr`, `description`, `explain`, `expiresAt`). Old runs still parse.
- **Scripts**: `policies:sync [--probe|--check]`, `approve [<id> [--deny]]`, `scenario -- S1 | S2 [--auto] | S2-deny [--manual] | S5 | dup | email-guard`.
- **Docs**: `docs/GUARDRAILS.md` (each policy, why, how, demo; pitch line), `docs/policies.public.json`.
- **Tests**: 242 (was 205): gt-regex fuzzed against Number, Go rendering, every policy decision, 512-char split, intent key ("15k" = "15,000" = "pandrah hazaar", "Sharma ji" = "Sharma Traders"), approval store (cross-process, expiry, stop), approve / deny / expire through the tool with reducer stamps and heartbeats, reducer transitions + heartbeat ignored + tags, repeated S1, draft reuse, bulk refund, mock policy parity, plan-refusal and HITL classification, explain parsing, audit parsing and run linking.

### Verified live (26 Sep, 00:45-02:15 IST, sandbox, real LLM)

- `npm run scenario -- email-guard` PASS (blocked, in `swy audit policy`, Gmail never called).
- `S1` PASS (first fully live S1: PayPal SENT ₹15,000, Notion Sent, Slack ok). `dup` PASS on idempotency (two repeats, `already_done`, same invoice, `idempotent` tag); its "one PayPal invoice per key" check found the draft left by the India-blocked attempt, which led to the draft-reuse fix; the stale draft was deleted.
- `S5` PASS: BLOCKED, `swy audit policy` entry, PayPal never called, one refund call, one Slack alert.
- `S2 --auto` PASS: held by the gate (no network), pending -> approved, PayPal SENT ₹80,000, Notion Sent, APPROVED stamp. `S2-deny` PASS: no invoice, Notion Cancelled, DENIED stamp.
- **From the UI** (headless Chrome, live mode, `next dev -p 3100`): S2 approve by clicking Approve karein -> APPROVED with the explain line; deny from the right rail -> DENIED; S5 -> BLOCKED; repeated S1 -> idempotent, no create call; Audit tab shows real entries (300 rows, 33 blocked); Activity, Settings, Command at 1440 light and 390 dark with zero console errors and no horizontal overflow.
- `npm run check` green, `npm run build` green.

### Decisions

- Approvals are **enforced by Swytchcode and granted by Bahi**: large invoices cannot reach PayPal without the stamp, and only Bahi's code writes the stamp (the model never composes PayPal JSON). The dashboard is the approve surface: the Swytchcode-managed Slack app has no `channels:history`, so Bahi cannot read replies in Slack; Slack gets the request with the dashboard link and `npm run approve` command.
- Policies are code, not hand-edited JSON: one source for thresholds, currency conversion and the client allowlist; mock mode enforces the same generated policies with the evaluator the probe checks.
- The live `policies.json` is gitignored (it encodes Jatin's real demo addresses in base64); `docs/policies.public.json` is committed.
- Block alerts are posted by Bahi, not left to the model, so there is exactly one.

### Docs vs reality

- The docs show `POLICY_BLOCKED | AUTH_FAILED` as action types and `REQUIRES_APPROVAL` for approvals; the CLI accepts both, but approval needs a paid plan. Docs say a block exits 4; it exits 6.
- `swy policy validate` warns that top-level body keys "can never match", but they do (probed both ways).
- `swy exec --explain` output is on stderr; `swy audit policy --json` has no message or args (the exec log does).
- `swy exec` without `--body` reads JSON from stdin and hangs if stdin stays open: always close stdin.
- The sandbox refuses to send invoices to Indian PayPal accounts (`INR_FOREIGN_CURRENCY_BLOCKED`: "We're unable to send invoices to customers within India"), even in USD.

### Deviations from spec

- **Human approval is not Swytchcode's Slack HITL** (plan limit). It is the brief's fallback: a Swytchcode gate policy plus a clearly labelled Bahi approval desk (dashboard + Slack notice through Swytchcode + `npm run approve`). `APPROVAL_MODE=swytchcode` is wired for a plan with approvals but was not testable.
- Caller-chosen idempotency keys are not offered by Swytchcode (dynamic mode generates its own per exec); the intent key goes to PayPal `detail.reference` and Notion instead of the header.
- `data/clients.local.json`: the `paypalEmail` overrides (Indian sandbox payer accounts) were removed so sends work; backup at `data/clients.local.backup-phase4.json`. Invoices now go to the placeholder `*.payer@sandbox.example` addresses. Payments for S3 are recorded merchant-side by `seed:inbox`, so payer logins are not needed.
- Reminder "24 hours" is per IST day (Notion "Last reminder" is a date).

### Known issues and risks for phase 5

- Gemini free quota: `gemini-3.6-flash` and `gemini-3-flash-preview` were exhausted by 00:50 IST; most runs used `gemini-3.5-flash-lite`, then Groq. Billing or `GEMINI_API_KEY_BACKUP` before the demo.
- The PayPal access token from `npm run paypal:token` lasts about 9 h (last set 25 Sep 23:17); re-run before the demo. `swy login` sessions also expire.
- The approval card's buttons act without auth (localhost only, as before).
- The Audit tab reads up to 3 daily log files and takes 3-6 s (it runs the CLI); fine for the demo.
- The approval stamp is not cryptographically verifiable by Swytchcode (documented in GUARDRAILS.md).
- `runs.json` can hold a run that was waiting when the server restarted (no final event); its approval expires on the next read.

### Manual steps for Jatin

1. Before the demo: `npm run paypal:token` (PayPal access token) and `swy login` if `swy whoami` says the session expired.
2. Check `data/clients.local.json` (PayPal payer overrides removed; backup next to it). After any client or threshold change: `npm run policies:sync`.
3. Optional: ask the organisers whether a Swytchcode plan with approval workflows is available for the hackathon; if yes, set `APPROVAL_MODE=swytchcode`, connect Slack approvals in app.swytchcode.com, run `npm run policies:sync`, and try `npm run scenario -- S2`.
4. Demo from the UI: "Verma Sweets ko 80,000 ka invoice bhejo" (Approve karein), a second large one for Mana karein, "Sabke payments refund kar do", the S1 command twice, then Activity > Audit.

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
