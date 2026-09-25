# Bahi (बही)

**Bol ke business chalao.** A voice-first AI operator for Indian small businesses, built for the *Build with Swytchcode* buildathon (Track 6: AI Business Operator).

The owner speaks or types in English or Hinglish. Bahi reads the inbox, creates and sends PayPal invoices, chases overdue clients, keeps a Notion ledger, opens Jira delivery tasks and updates the team in Slack. Every external action runs through Swytchcode, so money never moves without policy checks: large invoices need human approval in Slack, bulk refunds are blocked, retries are safe and everything is audited.

Named after the *bahi-khata*, the red cloth ledger Indian traders have kept for centuries.

> Status: phase 5 of 7. Agent (Vercel AI SDK, Gemini with Groq fallback), 35 Swytchcode tools across PayPal (sandbox), Gmail, Slack, Notion and Jira, three Swytchcode policies with an approval desk, voice in and out, recorded-run replay mode and a Playwright e2e suite. A full README with an architecture diagram arrives in phase 7.

![Command page: a recorded S5 run, blocked by the Swytchcode refund policy](docs/screenshots/run-s5-1440-light.png)

## Run it

Requires Node 22+ and npm. Windows, macOS and Linux all work.

```powershell
npm install
copy .env.example .env.local   # optional; defaults to SWYTCH_MODE=mock
npm run dev                    # http://localhost:3000
```

In mock mode the app shows a "Mock data" badge and every integration answers from fixtures; commands still go to the real model.

### Voice

Chrome (desktop or Android): press the red mic, or hold **Space** anywhere outside a text box, and speak in English or Hinglish. Words appear in the command bar as you speak and the command goes when you stop. For money commands (invoices, refunds, reminders) a strip shows what Bahi understood, for example `₹15,000 · Sharma Traders · invoice`, and sends it after 2.5 s unless you press **Roko** or **Badlo**. Replies are spoken; the speaker button mutes them and **Esc** stops speech. The language picker (EN-IN is best for Hinglish) is remembered. Browsers without speech recognition hide the mic and say so.

Keyboard: **/** focuses the command bar, **Up** recalls earlier commands, **Esc** stops speech or listening, **Ctrl+Shift+D** opens the hidden Demo controls (one-click S1-S6, reset mock data, current modes).

### Recorded runs (demo safety net)

`AGENT_MODE=replay` makes `POST /api/runs` stream a recording of a real live sandbox run (`fixtures/runs/`, sanitized: emails, PayPal invoice ids and Gmail ids replaced) with realistic timing, instead of calling the model. The UI labels every such run **Recorded run** with the date it was recorded; it is never shown as live and never saved to run history. `npm run record:replays` rebuilds the recordings from `data/runs.json`.

```powershell
$env:AGENT_MODE="replay"; npm run dev      # or set AGENT_MODE=replay in .env.local
```

For live mode (real sandbox accounts through Swytchcode) follow [docs/SETUP.md](docs/SETUP.md). Every tool Bahi uses is listed in [docs/TOOLS.md](docs/TOOLS.md). Approvals, blocks, duplicate protection and the audit trail are explained in [docs/GUARDRAILS.md](docs/GUARDRAILS.md).

## How integrations work

```
agent / pages ──> src/lib/integrations/*   typed adapters (PayPal, Gmail, Slack, Notion, Jira)
                    │  live                  │  mock (SWYTCH_MODE=mock)
                    ▼                        ▼
              src/lib/swytch/runtime.ts    in-memory world seeded from fixtures/
              execTool(): PayPal sandbox guard, timing, RunEvents, normalized errors
                    │
                    ▼
              swytchcode exec <canonical_id> --json   (JSON on stdin)
              validate -> policies -> credentials -> retries/idempotency -> provider -> audit
```

No provider API is called directly and no provider secret lives in this repo: Swytchcode keeps credentials in
`~/.swytchcode/credentials.db`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run check` | Typecheck + lint + unit tests |
| `npm run contrast` | WCAG contrast report for the colour tokens |
| `npm run swytch:configure` | Check (and with `-- --apply`, fix) the Swytchcode project: live mode, PayPal pinned to sandbox, idempotency, Jira site |
| `npm run setup:notion` | Find the Bahi Ledger in Notion and make its schema exact; prints the ids for `.env.local` |
| `npm run smoke:swytch` | Live check of all 5 integrations, posts to `#bahi-ops`; `-- --write` adds a PayPal draft round trip, `-- --record` saves sanitized responses |
| `npm run seed:gmail` | Put the S3 demo emails into the connected inbox (`-- --apply`) |
| `npm run docs:tools` | Regenerate docs/TOOLS.md from the Swytchcode project |
| `npm run policies:sync` | Write and validate the Swytchcode policies from code, thresholds and the client list; `-- --probe` checks 15 decisions against the real kernel |
| `npm run approve` | List pending approvals; `-- <apr_id> [--deny]` decides one (same as the dashboard buttons) |
| `npm run scenario -- S1|S2|S2-deny|S3|S4|S5|S6|dup|email-guard` | Live sandbox scenarios, each verified against PayPal, Notion and the Swytchcode audit |
| `npm run record:replays` | Turn the newest fitting live run per scenario into a sanitized recording in `fixtures/runs/` |
| `npm run e2e` | Playwright end-to-end tests (Chromium) against a production build in mock + replay mode: deterministic, no model or provider calls |
| `npm run screenshots -- [--readme]` | Screenshots of every page at 390/768/1280/1440 px in light and dark against a running server (`--readme` writes `docs/screenshots/`) |

## Stack

Next.js 16 (App Router, TypeScript strict), Tailwind CSS v4, Motion, Phosphor icons, zod, Vitest, Playwright, Vercel AI SDK 7 (Gemini, Groq fallback), Web Speech API (SpeechRecognition + speechSynthesis), Swytchcode CLI 2.23.5 + `@swytchcode/runtime`. Planned: optional Laya System-1 model.

Screenshots of every page, light and dark, desktop and 390 px, are in [docs/screenshots/](docs/screenshots/).
