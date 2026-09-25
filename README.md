# Bahi (बही)

**Bol ke business chalao.** A voice-first AI operator for Indian small businesses, built for the *Build with Swytchcode* buildathon (Track 6: AI Business Operator).

The owner speaks or types in English or Hinglish. Bahi reads the inbox, creates and sends PayPal invoices, chases overdue clients, keeps a Notion ledger, opens Jira delivery tasks and updates the team in Slack. Every external action runs through Swytchcode, so money never moves without policy checks: large invoices need human approval in Slack, bulk refunds are blocked, retries are safe and everything is audited.

Named after the *bahi-khata*, the red cloth ledger Indian traders have kept for centuries.

> Status: phase 2 of 7. The Swytchcode integration layer is in: 35 real Swytchcode tools across PayPal (sandbox), Gmail, Slack, Notion and Jira, typed adapters with mock twins, a live health check and a smoke test. The agent brain lands in phase 3. A full README with an architecture diagram arrives in phase 7.

## Run it

Requires Node 22+ and npm. Windows, macOS and Linux all work.

```powershell
npm install
copy .env.example .env.local   # optional; defaults to SWYTCH_MODE=mock
npm run dev                    # http://localhost:3000
```

In mock mode the app shows a "Mock data" badge and plays a scripted S2 run (an ₹80,000 invoice that needs approval) on the Command page.

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
| `npm run scenario -- S1|S2|S2-deny|S5|dup|email-guard` | Live sandbox scenarios, each verified against PayPal, Notion and the Swytchcode audit |

## Stack

Next.js 16 (App Router, TypeScript strict), Tailwind CSS v4, Motion, Phosphor icons, zod, Vitest, Swytchcode CLI 2.23.5 + `@swytchcode/runtime`. Planned: Vercel AI SDK (Gemini, Groq fallback), Web Speech API, optional Laya System-1 model.
