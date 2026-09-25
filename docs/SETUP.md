# Live setup (Swytchcode + 5 sandbox accounts)

Mock mode needs none of this: `copy .env.example .env.local` (or nothing at all) and `npm run dev`.
Live mode sends every action through Swytchcode to real sandbox accounts. Do the steps below once,
in PowerShell, in the repo folder. About 20 minutes.

## 0. Swytchcode CLI

```powershell
npm install -g swytchcode
swy login            # browser sign-in; check with: swy whoami
```

The repo already contains `.swytchcode/` (enabled tools, integration bundles, manifest). If the bundles are
missing (fresh clone without them), run `swy bootstrap`.

## 1. Make the Swytchcode project safe for live calls

```powershell
npm run swytch:configure              # shows what it will change
npm run swytch:configure -- --apply   # writes it
```

It switches `.swytchcode/tooling.json` to `production` mode (in `sandbox` mode Swytchcode sends every call to
`http://localhost`), pins **both** PayPal endpoints to `https://api-m.sandbox.paypal.com` (PayPal stays
sandbox-only whatever the mode; Bahi also refuses any PayPal call that is not the sandbox), turns on PayPal
idempotency (`PayPal-Request-Id`) and token refresh for the OAuth providers, and sets the Jira site from
`JIRA_BASE_URL` (step 6). Re-run it after `swy get`, `swy sync` or `swy bootstrap`.

## 2. PayPal sandbox

1. Open https://developer.paypal.com/dashboard/ and log in. Switch the toggle at the top to **Sandbox**.
2. **Testing Tools > Sandbox Accounts**: note the **Business** account email (this is the merchant, put it in
   `PAYPAL_MERCHANT_EMAIL`). Create three **Personal** accounts (Create account > Personal > India) for
   Sharma Traders, Verma Sweets and Gupta Electronics, or reuse the default personal account for all three.
3. **Apps & Credentials > Sandbox > Create App** (type Merchant, linked to that business account). Copy the
   **Client ID** and **Secret**.
4. `swy auth connect PayPal` and paste the sandbox Client ID and Secret when asked.

## 3. Gmail

`swy auth connect Gmail`, then sign in with the Google account whose inbox Bahi should read (put that address
in `BUSINESS_EMAIL`) and allow the requested Gmail access.

Client contact emails can be plus-aliases of that inbox, e.g. `you+sharma@gmail.com`, so reminders land in your
own mailbox.

## 4. Slack

1. In your Slack workspace create channels `#bahi-ops` and `#approvals` (optional: `#bahi-alerts`, then set
   `SLACK_ALERTS_CHANNEL=bahi-alerts`).
2. `swy auth connect Slack`, pick that workspace, allow.
3. Public channels are joined automatically on the first post. For a private channel, invite the app:
   `/invite @<app name>` in the channel.

(Human approval messages from Swytchcode policies are configured separately, per Swytchcode workspace, at
https://app.swytchcode.com > Settings > Workspaces > HITL Notifications. That is phase 4.)

## 5. Notion

1. Create a page named **Bahi** in your workspace.
2. Inside it type `/database`, choose **Database - Inline**, and name it exactly **Bahi Ledger**. Leave it
   empty. (Swytchcode's Notion tools can edit a database schema but cannot create a database, so this one
   click is manual.)
3. `swy auth connect Notion` and, on the page picker, share the **Bahi** page.
4. `npm run setup:notion` finds the database, sets the exact schema (Client, Client Email, Amount INR,
   Description, Invoice ID, Invoice URL, Status, Issued, Due, Last reminder, Jira key, Intent key) and prints
   `NOTION_LEDGER_DATABASE_ID` and `NOTION_LEDGER_DATA_SOURCE_ID` for `.env.local`. Safe to re-run.

## 6. Jira

1. On your Atlassian site (e.g. `https://yourname.atlassian.net`) create a project with key **BAHI**
   (any template, team-managed is fine). It must have the **Task** issue type.
2. Put the site URL in `JIRA_BASE_URL`, then run `npm run swytch:configure -- --apply` again.
3. `swy auth connect Jira` and allow access to that site.

## 7. `.env.local` and client emails

```ini
SWYTCH_MODE=live
BUSINESS_EMAIL=you@gmail.com
PAYPAL_MERCHANT_EMAIL=sb-xxxx@business.example.com
JIRA_BASE_URL=https://yourname.atlassian.net
NOTION_LEDGER_DATABASE_ID=...        # from npm run setup:notion
NOTION_LEDGER_DATA_SOURCE_ID=...     # from npm run setup:notion
```

`data/clients.local.json` (gitignored) sets the real demo addresses per client:

```json
[
  { "id": "cl_sharma", "email": "you+sharma@gmail.com", "paypalEmail": "sb-sharma@personal.example.com" },
  { "id": "cl_verma", "email": "you+verma@gmail.com", "paypalEmail": "sb-verma@personal.example.com" },
  { "id": "cl_gupta", "email": "you+gupta@gmail.com", "paypalEmail": "sb-gupta@personal.example.com" }
]
```

## 8. Check

```powershell
swy auth status                      # all five connected
npm run smoke:swytch                 # 5 green, posts "Bahi smoke test ok" to #bahi-ops
npm run smoke:swytch -- --write      # also creates one PayPal draft invoice and deletes it
npm run seed:gmail -- --apply        # optional: puts the S3 demo emails in the inbox
npm run dev                          # Settings page shows the same checks live
```
