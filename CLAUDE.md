@AGENTS.md

# Bahi: project spec (auto-loaded every session)

Read this file fully before doing anything. Then read PROGRESS.md for where we are.
Every phase runs in a fresh Claude Code session; continuity lives in this file (spec) and PROGRESS.md (log).

## 1. Context

- Project: "Bahi", a solo entry for the "Build with Swytchcode" buildathon, Track 6: AI Business Operator.
- Builder: Jatin, solo. Windows laptop, PowerShell, Node 20+ (24 installed), Python 3.11+ (3.14 installed), Chrome.
- Final submission: Sat 26 Sep 2026, 3:00 PM IST.
- Judging: Swytchcode integration depth 30%, technical implementation 25%, originality 20%, functionality 10%, real-world impact 10%, UX and pitch 5%.
- Hard rules from organisers: it must be an AI AGENT (understand request -> reason -> choose tools -> act -> use results -> follow up -> final outcome), built on an agent framework, using at least 3 Swytchcode integrations meaningfully. Needs a public GitHub repo, README, architecture diagram, setup instructions and a working demo. An interactive prompt UI that shows the agent's steps live is strongly recommended.
- Repo: https://github.com/jatinvats123/Bahi (public).

## 2. Product

Bahi is a voice-first AI operator for Indian small businesses (agencies, shops, freelancers). The owner speaks or types in English or Hinglish. Bahi reads the business inbox, creates and sends PayPal invoices, tracks payments, chases overdue clients politely, keeps a Notion ledger, creates Jira delivery tasks and keeps the team updated in Slack.
Every external action runs through Swytchcode, so money never moves without policy checks: large invoices need human approval in Slack, destructive bulk actions are blocked, retries are safe, and everything is audited.

- Name story: "bahi-khata", the red cloth ledger Indian traders have used for centuries.
- Tagline: "Bol ke business chalao."
- Demo business: env BUSINESS_NAME, default "DukaanSetu". Demo clients: Sharma Traders, Verma Sweets, Gupta Electronics.
- The app name, tagline and wordmark live ONLY in `src/lib/brand.ts`. Import from there; never hardcode.

## 3. Target architecture (built across 7 phases)

- Next.js (16.x, App Router, TypeScript strict, `src/` layout, npm). All server routes use the Node runtime, never edge.
- Next 16 differs from older training data: read `node_modules/next/dist/docs/` before using an unfamiliar API.
- Agent framework: Vercel AI SDK. Primary model Gemini Flash (`@ai-sdk/google`), automatic fallback to Groq (`@ai-sdk/groq`). Model ids come from env; verify current ids in provider docs when implementing.
- Execution: EVERY third-party action goes through Swytchcode (`@swytchcode/runtime` SDK, `swy` CLI for setup). Never call PayPal, Gmail, Slack, Notion or Jira APIs directly.
- Integrations: PayPal (sandbox only), Gmail, Slack, Notion, Jira.
- Guardrails: Swytchcode policies (hard block for bulk or large refunds; human approval in Slack for invoices above APPROVAL_THRESHOLD_INR), dynamic idempotency for retries plus app-level intent keys against duplicate commands, audit log.
- System-1 layer (phase 6, optional): Laya, a Python decision model served over HTTP (laya-serve) for intent routing, email triage and prompt-injection guard. Always has a Gemini fallback.
- Voice: Web Speech API in Chrome (SpeechRecognition + speechSynthesis). Text input always available.
- Streaming: a server orchestrator emits typed `RunEvent`s (`src/lib/events.ts`) to the browser as NDJSON over a POST fetch stream. The browser folds them with `src/lib/run-reducer.ts`.
- Storage: no external DB. Business records live in Notion (source of truth). Run history lives in `data/runs.json` via `src/lib/store/runs.ts`.
- Modes: SWYTCH_MODE=live|mock. Mock returns fixtures (`fixtures/`) so the UI and tests work without accounts. The UI shows a visible "Mock data" badge in mock mode. Never present mock output as real.

### Code map (keep updated)

- `src/lib/brand.ts` name, tagline, wordmark. `src/lib/format.ts` INR + IST formatting.
- `src/lib/env.ts` zod env (server-only). `src/lib/config.ts` non-secret public config for the UI.
- `src/lib/events.ts` RunEvent zod schemas + types (contract for phases 2-7). `src/lib/run-reducer.ts` folds events into a `RunView`.
- `src/lib/verbs.ts` tool id -> Hinglish verb. `src/lib/fixtures.ts` loads + validates `fixtures/*.json`.
- `src/lib/demo-player.ts` plays a fixture script as timed RunEvents (mock only).
- `src/lib/store/runs.ts` run history repository (`data/runs.json`).
- `src/components/ui` primitives. `src/components/shell` sidebar, bottom bar, theme. `src/components/command` command console. `src/components/settings` live integration health card.
- `src/lib/swytch/` the only door to the outside: `tools.ts` (every canonical id + verbs, client-safe), `runtime.ts` (`execTool`, server-only), `transport.ts` (async CLI spawn or SDK-in-worker), `errors.ts` (ExecError normalization), `project.ts` (.swytchcode reader, PayPal sandbox guard), `sanitize.ts` (fixture scrubbing).
- `src/lib/integrations/` domain adapters: `types.ts` interfaces + zod domain types, `<provider>/parse.ts` (pure) + `<provider>/live.ts`, `mock/` (world + twins), `index.ts` (`getIntegrations()` by SWYTCH_MODE). Adapters return `Outcome<T>`, never throw.
- `src/lib/health.ts` + `src/app/api/health/route.ts` integration health. `src/lib/clients.ts` client directory (+ `data/clients.local.json` overrides) and spoken-name matching.
- `src/lib/agent/` the brain: `orchestrator.ts` (`runAgent`: stamps + streams RunEvents, AI SDK `generateText` loop, max 12 steps, speak + final), `tools.ts` (13 domain tools over the adapters, code-level guardrails), `model.ts` (Gemini -> backup key -> Groq per LLM call, rate-limit waits, daily-quota cooldown), `defaults.ts` (model chains), `prompt.ts` (system prompt + owner language), `amount.ts` (Hinglish amount parser), `resolve-client.ts` (spoken name -> client), `untrusted.ts` (email fencing + injection signals).
- `src/lib/brief.ts` aaj ka hisaab (Notion, optionally verified with PayPal). `src/lib/store/run-persister.ts` throttled run saves while streaming. `src/lib/store/run-bus.ts` live runs in process (reattach with `?tail=1`, explicit stop).
- `src/lib/guardrails/` phase 4: `policies.ts` (pure: the 3 Swytchcode policies as code, Go `%v` renderer, local evaluator, gt-regex, aligned Gmail `To:` line, plain-language explainers), `config.ts` (env + clients -> config), `approvals.ts` (file-backed approval store, cross-process waits), `desk.ts` (hold -> Slack -> wait with heartbeats -> decision), `intent-key.ts`, `audit.ts` (swy audit + exec log + runs + desk -> Audit rows), `status.ts` (Settings panel), `live.ts` (explain, HITL status). Policies file: `npm run policies:sync` (never hand-edit `.swytchcode/integrations/policies.json`; it is gitignored, `docs/policies.public.json` is the committed copy).
- `src/lib/integrations/paypal/body.ts` PayPal request bodies shared by live + mock (mock enforces the same policies via `mock/policy.ts`).
- Phase 5: `src/hooks/useVoice.ts` (Web Speech recognition, interim/final, hold-Space, mic level to `--mic-level`), `useSpeech.ts` (speechSynthesis, mute), `voice-prefs.ts` (lang + mute in localStorage). `src/lib/voice/understood.ts` (confirm strip: amount, client, action) and `tts.ts` (voice picker, speakable text). `src/lib/scenarios.ts` (S1-S6 + S2-deny commands, `matchScenario` for replay). `src/lib/replay/` (`recording.ts` pure: format, sanitize, timing; `store.ts` loads `fixtures/runs/`; `player.ts` streams a recording). `AGENT_MODE=live|replay`; `run_started.replay` marks a recorded run. `src/components/command/VoiceConfirm.tsx`, `src/components/shell/DemoControls.tsx` (Ctrl+Shift+D), `OfflineBanner.tsx`, `src/components/ui/CopyId.tsx`, `RefreshButton.tsx`, `keys.ts`. `e2e/` Playwright specs (mock + replay), `scripts/record-replays.ts`, `scripts/screenshots.mjs`.
- API: `POST/GET /api/runs` (NDJSON stream / history; replay in AGENT_MODE=replay, optional `scenario`), `POST /api/demo/reset` (mock only), `GET /api/runs/[id]` (`?tail=1` live NDJSON), `POST /api/runs/[id]/stop`, `GET /api/runs/live`, `GET /api/approvals`, `POST /api/approvals/[id]` {decision}, `GET /api/ledger`, `GET /api/brief`, `GET /api/health`.
- UI: `src/components/command/useRun.ts` (stream -> reducer, stop via API, reattach), `src/components/approvals/` (ApprovalCard, useApprovals polling), `src/components/activity/RunReplay.tsx` + `AuditTable.tsx` (`/activity?tab=audit`), `src/components/settings/GuardrailsPanel.tsx`, `/activity/[id]` replay page.
- `scripts/` swytch-configure, setup-notion, smoke-swytch, seed-gmail, seed-inbox, eval-agent, scenario, gen-tools-doc, policies-sync, approve (tsx). `docs/TOOLS.md` (generated), `docs/SETUP.md` (live setup clicks), `docs/GUARDRAILS.md` (policies, approval, idempotency, audit).

## 4. Demo scenarios (acceptance targets for the whole project)

- S1 "Sharma Traders ko website redesign ke liye 15,000 ka invoice bhejo": resolve client -> PayPal create invoice -> send invoice -> Notion ledger row (Sent) -> Slack #bahi-ops update -> short spoken confirmation.
- S2 "Verma Sweets ko 80,000 ka invoice bhejo": above threshold -> Swytchcode human approval in Slack -> UI shows AWAITING stamp -> approved: continue as S1; denied: stop, log, tell owner.
- S3 "Inbox check karo aur jo kaam hai woh karo": list unread Gmail -> classify each (invoice_request, payment_confirmation, refund_request, complaint, other, suspicious) -> invoice_request: S1 flow; payment_confirmation: verify PayPal invoice status -> Notion Paid -> Jira delivery task -> Slack; complaint: Slack alert with summary; suspicious (prompt injection): take no action, flag it, Slack alert.
- S4 "Kaun late hai? Sabko yaad dilao": overdue from Notion, verified against PayPal -> polite Gmail reminders -> Notion last-reminder date -> Slack summary.
- S5 "Sabke payments refund kar do": agent attempts a refund through Swytchcode -> POLICY_BLOCKED before any network call -> BLOCKED stamp -> agent stops the batch, explains, Slack alert.
- S6 "Aaj ka hisaab batao": to receive, overdue, received today -> spoken brief + Slack post.

## 5. Design direction (must NOT look like a generic AI or stock shadcn app)

Concept: a modern digital bahi-khata. Warm paper, ink, vermilion cloth, gold zari thread. Calm, confident, tactile.
Banned: purple or neon gradients, glassmorphism, default Tailwind palette colours (use tokens only), stock shadcn look, emoji in UI, em-dashes in UI copy, decorative status dots.

Colour tokens are CSS variables in `src/app/globals.css`, exposed to Tailwind as `bg-paper`, `text-ink`, etc. Base values:
- light: paper #F5EFE3, paper-raised #FBF8F1, paper-sunk #ECE3D2, ink #1D1814, ink-soft #5E534A, ink-faint #978A7E, rule #D9CDB8, bahi #8E1B17, bahi-deep #6B120F, zari #B5892E, paid #2E6B4E, pending #B7791F, blocked #B42318, approval #1F4E79.
- dark: paper #15110F, paper-raised #1D1815, paper-sunk #100D0B, ink #F1E8DA, ink-soft #BFB2A2, ink-faint #8A7D70, rule #342B25, bahi #C8453A, zari #D7AC52, paid #5FAE86, pending #E0A64B, blocked #F0655A, approval #7FA8D6.
- Some base values fail WCAG AA as text. AA-tuned text variants (`*-ink` tokens, `--focus`) are defined alongside; `npm run contrast` checks every pair. Use `text-pending-ink` etc. for text, the base token for fills and borders.
- Theme: `data-theme` on `<html>`, set before paint by an inline script (system preference unless the user picked one; stored in localStorage `bahi-theme`).

Type (next/font/google): Fraunces for headings and hero numbers; Manrope for UI; IBM Plex Mono with tabular-nums for amounts, ids and timestamps; Tiro Devanagari Hindi only for the wordmark "बही" and small flourishes. (Brief names Fraunces explicitly; keep it.)
Money: Indian grouping via Intl en-IN INR, shown with the rupee sign (Rs 1,50,000 renders as ₹1,50,000). Time: IST, e.g. "26 Sep, 2:14 PM". Always use `src/lib/format.ts`.
Shape rule: surfaces, inputs and buttons use `--radius` (6px); chips and status pills are full pill; mic button is a circle; stamps 3px.

Signature elements:
1. Sidebar is the bahi cover: deep red cloth texture (CSS linen), gold dashed stitch line inset along the edge, wordmark "Bahi" with "बही".
2. Main canvas is ledger paper: very faint horizontal rules and one thin red margin line; timestamps live in the margin (`--margin-x`).
3. Rubber stamps for states: APPROVED (approval blue), BLOCKED (blocked red), SENT (paid green), AWAITING (pending amber), DENIED (blocked red), EXPIRED (grey). Slam animation: scale 1.4 -> 1, settle at -6 deg, about 180 ms, slight ink blur settle. Respect prefers-reduced-motion.
4. Run timeline as ledger entries: margin timestamp, icon, verb in serif ("Invoice banaya"), detail in sans, chips such as "Swytchcode: policy ok", "Laya: 34 ms", "retry x1".
5. Command bar is the hero: large input, ink-red mic button, Hinglish example chips.

Icons: Phosphor (`@phosphor-icons/react`, use the `XxxIcon` names; `/ssr` entry in server components). Motion: `motion/react`. Entrances 160-220 ms ease-out, no bouncy springs except the stamp. Numbers count up. Skeletons shaped like ledger rows.
Layout: sidebar nav (Command, Ledger, Activity, Settings), main area, right rail on Command ("Aaj ka hisaab" cards + pending approvals). Works down to 390 px (sidebar becomes a bottom bar, below 768 px).
Accessibility: AA contrast in both themes, zari-gold focus rings, full keyboard use, aria-live region for streaming steps.
Microcopy: short, respectful Hinglish + English, never cute. Examples: "Kya karna hai?", "Bol ke batao", "Aaj ka hisaab", "Approval ka intezaar", "Rok diya gaya: policy".
If a design-taste skill is available, use it for every UI decision (the brief's explicit choices override its defaults).

## 6. Engineering rules

- Never invent APIs. Before coding against Swytchcode, the AI SDK, Laya or any provider, read current docs (docs.swytchcode.com/llms.txt, installed package types in node_modules, `swy --help`). If docs and reality differ, trust reality and record it in PROGRESS.md.
- Secrets only in `.env.local`. Never log or commit secrets.
- Sandbox and test data only. PayPal sandbox only.
- Every external action goes through Swytchcode.
- Server-only modules `import "server-only"`. Validate env and external data with zod.
- TypeScript strict; no `any` except at zod-validated boundaries.
- User-facing errors in plain Hinglish/English; technical detail goes to logs and the Activity page.
- Windows first: no bash-only scripts; use node scripts or cross-platform npm scripts.
- If something needs Jatin (login, OAuth, a key), stop, tell him exactly what to click, then continue.
- RunEvent contract changes: update `src/lib/events.ts`, the reducer, and its tests together. Never break existing event shapes silently.
- Tool ids are real Swytchcode canonical ids, defined once in `src/lib/swytch/tools.ts`. Adding a tool: `swy add <id>` (verify with `swy list tooling`; it sometimes no-ops), add it to `tools.ts`, run `npm run docs:tools`.
- Never export a function named `then` from a module (it makes the module namespace thenable and `await import()` hangs).

## 7. Scripts

- `npm run dev` / `build` / `start`
- `npm run lint` (eslint), `npm run typecheck` (tsc --noEmit), `npm run test` (vitest run)
- `npm run check` = typecheck + lint + test
- `npm run contrast` = WCAG contrast report for the colour tokens in globals.css
- `npm run swytch:configure [-- --apply]`, `setup:notion`, `smoke:swytch [-- --write --record]`, `seed:gmail [-- --apply]`, `docs:tools`
- `npm run eval:agent [-- --only S1 --runs 2 --pause 20 --verbose]` (mock adapters, real LLM), `npm run scenario -- S1|S2 [--auto]|S2-deny|S5|dup|email-guard` (live, verified), `npm run seed:inbox [-- --dry | --print]` (live)
- `npm run e2e` (Playwright, builds and serves on :3210 with SWYTCH_MODE=mock AGENT_MODE=replay; `E2E_REUSE=1` reuses a running server), `npm run record:replays [-- --dry | --S3 <runId>]`, `npm run screenshots -- [--base URL] [--readme]`
- `npm run policies:sync [-- --probe | --check]` (after changing thresholds, currency rate, APPROVAL_MODE or clients), `npm run approve [-- <apr_id> [--deny]]`

## 8. End-of-phase protocol (every phase follows it)

1. Run `npm run check` and `npm run build`; fix until green.
2. Update PROGRESS.md: done, decisions, deviations from spec, known issues, manual steps for Jatin.
3. `git commit -m "phase-N: <summary>"` and push if a remote exists.
4. Print: what works, how Jatin can verify in 2 minutes, what he must do manually, risks for the next phase.

## 9. Phase plan

1. Foundation and design system.
2. Swytchcode integration layer.
3. Agent brain and live console.
4. Guardrails: policies, approval, block, idempotency, audit.
5. Voice, UX polish, e2e tests.
6. Laya System-1 layer (optional).
7. Demo hardening and submission.
