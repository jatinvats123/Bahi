# Bahi: progress log

Running log across phases. Update at the end of every phase (see CLAUDE.md section 8).

## Phase checklist

- [x] **1. Foundation and design system** (25 Sep 2026)
- [ ] 2. Swytchcode integration layer
- [ ] 3. Agent brain and live console
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

## Decisions log

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

- Mic is visual only (phase 5 wires Web Speech API). Typing a non-example command shows a "agent not connected yet" toast (phase 3).
- S4 (reminders) has no fixture script yet.
- In full-page screenshots the fixed sidebar/bottom bar appear mid-page; this is a screenshot artefact, not a layout bug.
- Next dev indicator sits top-right (moved off the Mock data badge); on mobile it overlaps the theme toggle in dev only.

## Manual steps for Jatin

- Nothing required for phase 1. `copy .env.example .env.local` is optional (defaults to mock mode).
- Phase 2 will need: a Swytchcode account + API key, PayPal sandbox app, Slack workspace/app, Notion integration + parent page, Jira site + project `BAHI`, Gmail OAuth. Phase 2 will list exact clicks.
