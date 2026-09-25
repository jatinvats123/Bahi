# Bahi (बही)

**Bol ke business chalao.** A voice-first AI operator for Indian small businesses, built for the *Build with Swytchcode* buildathon (Track 6: AI Business Operator).

The owner speaks or types in English or Hinglish. Bahi reads the inbox, creates and sends PayPal invoices, chases overdue clients, keeps a Notion ledger, opens Jira delivery tasks and updates the team in Slack. Every external action runs through Swytchcode, so money never moves without policy checks: large invoices need human approval in Slack, bulk refunds are blocked, retries are safe and everything is audited.

Named after the *bahi-khata*, the red cloth ledger Indian traders have kept for centuries.

> Status: phase 1 of 7 (foundation and design system). The UI runs on mock fixtures; integrations and the agent land in later phases. A full README with an architecture diagram arrives in phase 7.

## Run it

Requires Node 20.9+ and npm. Windows, macOS and Linux all work.

```powershell
npm install
copy .env.example .env.local   # optional; defaults to SWYTCH_MODE=mock
npm run dev                    # http://localhost:3000
```

In mock mode the app shows a "Mock data" badge and plays a scripted S2 run (an ₹80,000 invoice that needs approval) on the Command page.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run check` | Typecheck + lint + unit tests |
| `npm run contrast` | WCAG contrast report for the colour tokens |

## Stack

Next.js 16 (App Router, TypeScript strict), Tailwind CSS v4, Motion, Phosphor icons, zod, Vitest. Planned: Vercel AI SDK (Gemini, Groq fallback), Swytchcode runtime (PayPal sandbox, Gmail, Slack, Notion, Jira), Web Speech API, optional Laya System-1 model.
