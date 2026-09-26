# Demo runbook

For Jatin on demo day. Goal: the demo cannot fail on stage. If anything looks wrong, go to "When something fails" and pick the row; every row has a fix that takes under a minute.

## T-60 min: pre-demo checklist

Tick each one. Commands are for PowerShell in the repo folder.

- [ ] Laptop charged and on the charger; Do Not Disturb on; notifications off.
- [ ] Chrome is the browser; one window, zoom 100%, no other tabs with sound.
- [ ] Microphone permission for `localhost:3000` is **Allow** (padlock icon > Site settings > Microphone). Test once: press the mic, say "Aaj ka hisaab batao".
- [ ] Phone: Slack app logged in to the demo workspace, `#approvals` and `#bahi-ops` open, notifications on. Same Wi-Fi as the laptop.
- [ ] `swy whoami` says `session: valid`. If expired: `swy login` (opens the browser), then `swy whoami` again. **Sessions last about an hour: log in again within an hour of going on stage.**
- [ ] PayPal sandbox token fresh: `npm run paypal:token` (lasts about 9 hours).
- [ ] `.env.local`: `SWYTCH_MODE=live`, `AGENT_MODE=live`, `APPROVAL_TIMEOUT_SEC=300`, and `BAHI_PUBLIC_URL=http://<laptop Wi-Fi IP>:3000` (find the IP with `ipconfig`, "IPv4 Address" of the Wi-Fi adapter) so the Slack approval link opens on the phone.
- [ ] `npm run demo:reset` finished with "no errors" and printed the stage commands. It takes about 3 minutes. Run it again after every rehearsal.
- [ ] Server running from a production build (faster than dev, no dev overlay):
  ```powershell
  npm run build
  npm start
  ```
  If Windows Firewall asks about Node.js, allow it on **private** networks (the phone needs it).
- [ ] Open http://localhost:3000/settings: every integration card green (PayPal, Gmail, Slack, Notion, Jira), Swytchcode project check green, Guardrails panel shows 3 policies active.
- [ ] On the phone, open `http://<laptop IP>:3000` once: the Command page loads.
- [ ] Gemini quota: the free tier resets at **12:30 PM IST** (midnight Pacific). Do not burn it with rehearsals after 12:30; rehearse in replay mode or before 12:30. Groq takes over automatically if Gemini runs out.
- [ ] A second terminal is open in the repo folder (for `npm run approve` and the fallbacks below).
- [ ] Ctrl+Shift+D opens Demo controls (hidden from judges; close it again with Esc).

## The stage script (about 2.5 minutes)

The pitch wording is in [PITCH.md](PITCH.md). The order matters: **S3 before S6**, because the daily brief also checks open invoices with PayPal and would reconcile the paid Sharma invoice before S3 can.

| # | Say (or type) | What the room sees | If it stalls |
| --- | --- | --- | --- |
| 1 | "Sharma Traders ko website redesign ke liye 15,000 ka invoice bhejo" | confirm strip `₹15,000 · Sharma Traders · invoice`, steps stream in, **SENT** stamp, Notion row, Slack post, spoken reply | Roko, then say it again (the intent key makes a repeat safe: "already bheja ja chuka hai") |
| 2 | "Verma Sweets ko 80,000 ka invoice bhejo" | **AWAITING** stamp; Slack `#approvals` pings the phone; tap the link, press **Approve karein**; laptop turns **APPROVED** then **SENT** | Approve from the laptop card, or `npm run approve` in the second terminal |
| 3 | "Sabke payments refund kar do" | **BLOCKED** stamp: Swytchcode `block-large-refunds`, provider never called, Slack alert, agent stops the batch | Nothing to fix: a block is the demo |
| 4 | "Inbox check karo aur jo kaam hai woh karo" | Verma invoice request → invoice ₹12,000; Sharma payment → verified in PayPal → Notion Paid + Jira task; Gupta complaint → Slack alert; injection email → flagged, no action | If it runs long, let it finish while you talk about the email policy |
| 5 | Activity > Audit | Every Swytchcode decision: allowed, approval, blocked, "provider not called" | |
| opt | "Kaun late hai? Sabko yaad dilao" | Reminders to Sharma (₹18,500) and Verma (₹32,000), Slack summary | |
| opt | "Aaj ka hisaab batao" | Spoken brief: ₹24,000 aaya aaj, the rest pending and late | |

After the demo (or a rehearsal): `npm run demo:reset`.

## When something fails

| Symptom | What it is | Do this |
| --- | --- | --- |
| Timeline says "Gemini busy hai / key kaam nahi kar rahi, backup model (Groq ...)" | Model fallback working as designed | Nothing. Say: "Gemini is out of quota, Groq took over, and the timeline says so." |
| "Abhi koi AI model jawab nahi de raha" | Every model down or out of quota | Switch to replay (last row). |
| A step says "Swytchcode login khatam ho gaya" | `swy login` session expired | Second terminal: `swy login`, then say the command again. |
| One integration fails (for example "Jira se connection toot gaya") but the rest ran | That provider is down or disconnected | Keep going: the run finishes the other steps and says which one failed. Afterwards: Settings shows the fix command (`swy auth connect Jira`). |
| Approval card counts down to 0:00, **EXPIRED** stamp | Nobody approved within `APPROVAL_TIMEOUT_SEC` | That is the safe path: nothing was sent and the Notion row says Cancelled. Say the S2 command again and approve. |
| Slack ping does not arrive on the phone | Slack notification delay or Wi-Fi | Approve on the laptop card; the policy story is the same. |
| Phone link does not open | `BAHI_PUBLIC_URL` is localhost or the firewall blocks Node | Approve on the laptop; fix the URL after the demo. |
| Mic does nothing or "Voice ke liye Chrome use karein" | Mic permission or wrong browser | Type the command; the confirm strip is voice-only, everything else is the same. |
| Page is blank or errors after a code change | Broken build | `npm run build` and `npm start` again; worst case the replay fallback. |
| Wi-Fi is down, or everything is failing | Network | **Replay fallback**, below. |

### Replay fallback (everything down)

Stop the server (Ctrl+C) and start it in replay mode. Nothing in replay calls a model or a provider:

```powershell
$env:SWYTCH_MODE="mock"; $env:AGENT_MODE="replay"; npm start
```

(`npm start` serves the existing build; process env wins over `.env.local`.) Every run now plays a sanitized recording of a real live sandbox run, and the UI labels it honestly: the sidebar shows **Mock data** and **Recorded**, each run shows a dashed **Recorded run** badge with "Live sandbox run, recorded 26 Sep ...". Say so out loud: "The venue network is down, so this is the recording of the same run from this morning." Say the same commands; Ctrl+Shift+D has one-click S1-S6 and S2-deny if voice matching fails.

## Failure drills (26 Sep 2026)

| Drill | How it was run | Result |
| --- | --- | --- |
| Gemini key invalid → Groq takes over | `GEMINI_API_KEY=invalid` + `npm run eval:agent -- --only S1 --runs 1` (real LLM, mock integrations) | PASS: timeline says "Gemini ki key kaam nahi kar rahi, backup model (Groq openai/gpt-oss-120b)"; invoice created and sent, Notion row, Slack post. When Groq also hit its per-minute limit, Bahi wrote the final answer from the tool results instead of failing. |
| One integration down (Jira) | Live S3 with `JIRA_PROJECT_KEY=NOPE`, so every Jira create fails for real at Jira through Swytchcode (disconnecting the OAuth connection would need a browser to restore) | PASS: the payment was verified in PayPal, Notion marked Paid, the email labelled, Slack updated; the Jira step shows FAILED in the timeline and the final answer says the Jira task failed. |
| Approval not answered → expiry | Live `APPROVAL_TIMEOUT_SEC=20 npm run scenario -- S2-deny --manual` (₹75,000), nobody decides | PASS: Swytchcode held the create (no network), approval pending → expired, EXPIRED stamp, no PayPal invoice, Notion row Cancelled, owner told "approval expire ho gaya". |
| Everything down → replay | `npm run e2e` (production build, `SWYTCH_MODE=mock AGENT_MODE=replay`) | PASS: all six scenarios play with the Recorded run badge, no model or provider call |

Found and fixed while hardening:

- **Broken IPv6 on the network** made every model call hang (Node tried IPv6 only). Bahi now resolves IPv4 first (`src/instrumentation.ts`, scripts). Hotel and venue Wi-Fi often has this problem.
- **A stalled model socket** could hold a run until the whole-run timeout (8 minutes). The 30 s step timeout is now hard, even if the provider ignores the abort.
- **Swytchcode telemetry** (PostHog) cost 1.4 s per call, and about 30 s when PostHog was unreachable. Bahi turns it off (`SWYTCHCODE_NO_TELEMETRY`).
- **An email opened on a phone disappeared from S3.** Bahi used to read unread mail only; after the inbox cursor it now reads every inbox mail it has not labelled `Bahi/Processed`, opened or not.
- **An expired `swy login`** used to show as "Rok diya gaya: policy". It now says the session expired and how to fix it.

## Reference

- Stage story seeded by `npm run demo:reset`: Gupta Electronics ₹24,000 paid today (Jira task), Sharma Traders ₹6,000 sent and not due (already paid in PayPal: S3 finds it), Sharma Traders ₹18,500 overdue 8 days, Verma Sweets ₹32,000 overdue 5 days; inbox: Verma invoice request, Sharma payment confirmation, Gupta complaint, one prompt injection.
- The inbox cursor (`data/inbox-cursor.json`, set by `demo:reset`) makes Bahi read only mail that arrived after the reset. Older unread mail is never touched. Delete the file to read the whole inbox again.
- Demo controls: Ctrl+Shift+D. Approvals from the terminal: `npm run approve` (list), `npm run approve -- <apr_id>` or `-- <apr_id> --deny`.
