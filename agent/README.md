# GST Keeper portal agent (Portal Autopilot)

The agent fetches GST portal data for the firm's clients on a schedule, from an
always-on PC **in the office**, so nobody has to sit at a browser running Sync for
hours. It drives the **same GST Keeper extension** the staff use, in its own
Chromium, one client per browser at a time. Every portal login needs a CAPTCHA:
the agent shows it on the app's **CAPTCHA wall** and a member of staff types it.
It never solves a CAPTCHA, never files or saves anything on the portal, and never
runs in the cloud. Read `docs/PORTAL_AUTOPILOT_POSITIONS.md` before changing it.

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
- Node.js 20 or later (LTS from nodejs.org).
- This repository on that PC (the `agent` folder next to the `extension` folder).
- Nothing secret: the agent uses the app's publishable key from
  `extension/config.js`. No Supabase service-role key.

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

## Updating
`git pull` in the repository, then restart the task (Task Scheduler →
GSTKeeperAgent → End, Run) — the agent copies the extension fresh at every start
and refuses an extension older than 0.6.0.

## Logs and data on this PC
`agent/.agent-data/`: `logs/` (one file a day, kept 14 days; no passwords,
cookies or CAPTCHA images), `profiles/` (the browsers), `sessions/` (encrypted, only
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
- Tests: `npm test` (unit), and the end-to-end test that runs the real agent and
  extension against a stand-in portal and a local database — see `test/README.md`.
