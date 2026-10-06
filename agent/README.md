# GST Keeper portal agent (Portal Autopilot)

The agent fetches GST portal data for the firm's clients on a schedule, from an
always-on PC **in the office**, so nobody has to sit at a browser running Sync for
hours. It drives the **same GST Keeper extension** the staff use, in its own
Chromium, one client per browser at a time. Every portal login needs a CAPTCHA:
the agent shows it on the app's **CAPTCHA wall** and a member of staff types it.
It never solves a CAPTCHA, never files or saves anything on the portal, and never
runs in the cloud. Read `docs/PORTAL_AUTOPILOT_POSITIONS.md` before changing it.
It can also read notice PDFs with the Claude API — off unless switched on; see
[Reading notices (Claude API)](#reading-notices-claude-api).

```
 schedule 05:30 / 13:00 IST ─┐
 portal e-mail (notices@) ───┼─▶ portal_jobs ──claim──▶ agent (office PC)
 "Fetch a report" in the app ┘        ▲                   │  Chromium + GST Keeper extension
                                      │                   ▼
   CAPTCHA wall in the app ◀── CAPTCHA image ──── portal login page
   staff type it ─────────────── answer ────────▶ extension logs in, reads, saves
```

## What it needs
- A PC on the office network that stays on and signed in (Windows 10/11; Linux or
  macOS work too), set never to sleep.
- Node.js 20.16 or later (the current LTS from nodejs.org).
- This repository on that PC (the `agent` folder next to the `extension` folder).
- Nothing secret: the agent uses the app's publishable key from
  `extension/config.js`. No Supabase service-role key. (Reading notices with the
  Claude API, optional, needs the firm's Anthropic API key in `agent/.env`.)

## Install (Windows)
1. Copy or `git clone` the repository to the office PC.
2. Double-click `agent/install-agent.bat`. It checks Node.js, writes `agent/.env`
   (agent name, a random key for encrypting kept sessions), runs `npm install`,
   downloads Chromium (`npx playwright install chromium`) and registers the
   scheduled task **GSTKeeperAgent** (starts at sign-in, restarts if it stops).
3. In GST Keeper open **Notices → Autopilot**: the agent shows as online.
4. A manager switches the autopilot on in the **Settings** tab (it ships off).

On Linux / macOS: `cd agent && npm install && npx playwright install chromium &&
npm start` under a service manager (systemd, launchd) that restarts it.

To remove the auto-start: `uninstall-agent.bat` (files and `.env` stay).

## Day to day
- **05:30** every active client is queued; **13:00** the priority ones (notices due
  within 7 days, never synced, stale or failing). A portal e-mail queues its client
  at once (when the inbox is set up). Staff can queue reports from the
  **Fetch a report** tab.
- Jobs wait as "waiting for a CAPTCHA" until someone opens the **CAPTCHA wall**.
  The 09:00 header badge says how many. Open the wall, type each CAPTCHA, press
  Enter; the agent logs in and reads that client while you type the next. "Can't
  read it" fetches a new CAPTCHA; "Skip this client" leaves it for today. You can
  work in another tab meanwhile — the agent keeps fetching while the wall is on
  screen or you typed on it in the last 10 minutes.
- **Needs a person** lists clients the portal refused (password changed, account
  locked, CAPTCHA never typed…) with the fix next to each.
- **Acceptance** shows, per day, the share of clients fresh or with a named
  reason, the time spent at the CAPTCHAs and how fast notices arrived.

Settings (Notices → Autopilot → Settings, managers): master switch and pause,
schedule times and the afternoon scope, browsers at once (1–4), keep portal
sessions (off by default; with it on, a client's portal cookies are kept encrypted
on this PC for up to 50 minutes so a second job needs no CAPTCHA), the e-mail
trigger, retries.

## Reading notices (Claude API)
The agent can read a notice's PDF with the Claude API (Anthropic) and fill in the
notice's facts — section, financial year and tax period, DIN, demand by tax and
component, due date, personal hearing, issuing officer — and split it into issues
with amounts. It runs next to the portal workers, one notice at a time, and **ships
off**. Read `docs/REPLY_FACTORY_POSITIONS.md` before changing it.

**What is sent, and what never is.** Each request carries the notice PDF as the app
stored it, fixed instructions (`src/read/prompt.ts`) and the firm's list of issue
codes — nothing else. The client's name, GSTIN, address, passwords, other notices
and the firm's figures are never sent; the agent does not read the client master
for this at all (the GSTIN check below happens on this PC, after the answer). PDFs
are fetched only from the app's own storage (the database's host) — never from
another address. The API key, the PDF and quotes longer than 80 characters never
go into the logs.

**Three switches, all needed:**
1. In the app: reading notices with AI (`ai_settings.read_enabled`, off as shipped).
   The model (`claude-opus-5-5`), effort (`high`), the day's spending cap (US$10),
   the page limit (60) and the prices used for cost estimates are settings there too.
2. The client's consent on file — the engagement-letter clause
   (`clients.ai_consent_at`), and not opted out (`ai_opt_out`). Without it nothing
   of that client is read; a reading queued earlier is cancelled when its turn comes.
3. `ANTHROPIC_API_KEY` in `agent/.env` on this PC (the app never holds a key).
   Without it the reader stays off and says so once in the log. Restart the agent
   after adding or changing it.

**What happens to a notice.** A new notice is queued when it arrives (if automatic
reading is on), or staff ask for a reading. The agent claims it, downloads the PDF
(at most 32 MB), keeps its SHA-256, counts the pages (more than the limit: not sent)
and reads the PDF's own text page by page. It sends the PDF to the API (streamed,
adaptive thinking at the set effort, the answer in a fixed JSON format; the API's
own fallback model takes over if the model declines on policy grounds). Every value
comes back with its page and a short verbatim quote, and the agent checks each one:
the quote must be on that page (else anywhere in the PDF) and the value in the quote
(dates in any common Indian form, amounts with or without Indian grouping); a scan
without a text layer can be checked against nothing; the issues must add up to the
demand, tax by tax, within ₹1 (else the demand is not applied); the GSTIN must be the
client's; due and hearing dates cannot precede the notice. The database then applies **only checked values, only
into empty fields, marked "auto — verify"** until a person confirms them; a value
staff typed is never replaced (a different reading is recorded as a conflict); a
notice addressed to another GSTIN applies nothing; issues go in together, unverified,
or not at all. Every reading that reached the API leaves an audit row (who asked,
tokens, estimated cost, the PDF's hash) in `ai_audit_log`; a reading asked twice
(cut off at the output limit) is one row with both calls' tokens and request ids.

**Cost.** At the default prices (US$4 a million input tokens, US$20 a million
output, ₹84 to the dollar): a PDF page is roughly 3,000–5,000 input tokens and the
instructions about 3,000; the answer plus the model's thinking is typically
5,000–15,000 output tokens at effort "high". So a 4-page DRC-01 costs about
US$0.15–0.40 (₹13–35), a 20-page notice about US$0.40–0.80 (₹35–70). A reading cut
off at the output limit is asked once more with a larger budget (a rare worst case
of about US$4). The audit log holds the real figure for each call; the day's cap
stops new readings once it is reached.

**When something goes wrong.** Rate limits, an API outage or a dropped connection:
the reading is retried later (after 5, then 10 minutes; three attempts). The model
declining (after the fallback): failed, reason `refused`. A refused API key: that
reading fails (`api_key`) and the reader pauses until the agent is restarted with a
valid key. A PDF that is too long, too large, not a PDF or password-protected:
failed with that reason. Stopping the agent mid-reading puts the notice back on the
queue.

## Updating
`git pull` in the repository, then restart the task (Task Scheduler →
GSTKeeperAgent → End, Run) — the agent copies the extension fresh at every start
and refuses an extension older than 0.6.0.

## Logs and data on this PC
`agent/.agent-data/`: `logs/` (one file a day, kept 14 days; no passwords,
cookies, CAPTCHA images, API key or notice text), `profiles/` (the browsers), `sessions/` (encrypted, only
when keeping sessions is on), `extension/` (the staged copy).

## Troubleshooting
- **Agent offline on the Autopilot page** — the PC is off or asleep, or the task
  stopped: run it from Task Scheduler, or `npm start` in this folder to see errors.
- **"The extension … is older than 0.6.0"** — `git pull`.
- **Portal login page never shows a CAPTCHA** — the job is retried later as a portal
  error; if it keeps happening, watch the agent's browser window on the office PC.
  If the portal refuses the agent's browser, do not try to disguise it (see the
  positions doc): sync with the extension as before.
- **CAPTCHAs never appear on the wall** — the autopilot is off or paused, or nobody
  else's job is waiting; the status line on the page says which.

## How it works (code)
- `src/index.ts` — start-up, heartbeat (`autopilot_heartbeat`: reports the workers,
  gets the switches back every 10 s), the workers, shutdown.
- `src/worker.ts` — one Chromium profile with the extension: claim
  (`portal_job_claim`), park when nobody is at the wall, start the job in the
  extension (`startAgentJob`), relay the CAPTCHA (`portal_job_captcha` /
  `portal_job_answer`), finish (`portal_job_finish`) from the run ledger.
- `src/portal.ts` — the few things done on the page itself (CAPTCHA image and
  field, log out). `src/outcome.ts` — reading the run ledger. `src/sessions.ts` —
  encrypted kept sessions. `src/extension.ts` — staging the extension.
  `src/mail/` — the portal e-mail inbox.
- `src/read/` — the notice reader: `reader.ts` (claim, read, finish:
  `notice_read_claim` / `notice_read_finish` / `notice_reads_release`), `pdf.ts`
  (download, page count, text layer), `claude.ts` (the API call), `prompt.ts` and
  `schema.ts` (instructions and the answer's JSON schema), `checks.ts` and
  `result.ts` (checks against the PDF's text, values shaped for the columns).
- Tests: `npm test` (unit), and the end-to-end tests that run the real agent against
  a local database — the autopilot with the real extension and a stand-in portal, the
  reader with a stand-in Claude API — see `test/README.md`.
