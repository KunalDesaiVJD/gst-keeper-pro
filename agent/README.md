# GST Keeper Portal Agent

A local worker that gives GST Keeper **pull & push** to the GST portal. It runs on
an always-on office machine, polls a job queue in Supabase, drives a headless
browser (Playwright) against the portal, and writes results + self-checks back.

```
GST Keeper app ──enqueue job──▶ Supabase (portal_jobs) ──poll──▶ THIS Agent ──▶ GST Portal
       ▲                                                                │
       └──────────────── results + verifications ──────────────────────┘
Then a human does the final: offset ITC + File (OTP / DSC).
```

## Scope (hard rules)
- **PULL** (portal → our tables): GSTR-2B, Electronic Cash/Credit ledgers, GSTR-1, filing status.
- **PUSH-SAVE** (our JSON → portal): GSTR-1 and GSTR-3B — **uploaded and SAVED only.**
- **NEVER** offsets ITC, **never** submits/files. Those need OTP/DSC and stay 100% human.
- Because it only saves, the Agent **never needs an OTP or DSC** — it only needs to log in.

## The CAPTCHA (read this)
This Agent does **not** auto-solve the portal CAPTCHA. When a fresh login is needed it
captures the CAPTCHA, sets the job to `needs_human`, and the app shows it for a
one-time manual entry. The **session is then reused for hours** (`storageState`), so
this is a handful of clicks per day for the whole office — not per return. If you
want fully-unattended login you would add a solver at the `solveCaptcha()` seam in
`src/login.ts` yourself; it is intentionally left unimplemented here.

## Legal / risk (eyes open)
Automating the GST portal with stored client credentials is against GSTN's terms
(they classify automated access as "unauthorised"; IT Act 2000 s.43/45; 9-Sep-2023
advisory). This Agent is **save-only + human-files**, which is materially lower risk
than automated filing, but the risk is not zero. Use only with **written client
authorization**, keep the machine **office-local**, and encrypt credentials at rest.

## Phase roadmap (this folder builds toward all of it)
- **Phase 0 — schema** ✅ `supabase/migrations/…_portal_agent.sql` (portal_jobs / events / verifications).
- **Phase 1 — Agent core** ✅ (this installment): config, Supabase queue loop, browser+session,
  login (human-assisted CAPTCHA), verification harness, screenshot audit, `LOGIN_TEST` handler.
- **Phase 2 — PULL 2B** 🚧 `handlers.ts:pullGstr2b` (structure + TODO selectors).
- **Phase 3 — PULL ledgers / GSTR-1 / filing status** 🚧 scaffolds.
- **Phase 4 — PUSH GSTR-1 (save)** 🚧 scaffold + read-back verify.
- **Phase 5 — PUSH GSTR-3B (save)** 🚧 scaffold + read-back verify + hard stop.
- **Phase 6 — hardening**: retry/backoff, per-client profile isolation, portal-change alerts, scheduling.
- **Phase 7 — pilot**: shadow-mode → canary → human-approval gate → staged rollout.

> The portal-navigation handlers (Phases 2–5) contain the flow + verification wiring but
> the exact CSS/XPath selectors are marked `TODO(selector)` — they must be filled in and
> tested against the **live portal DOM** (which can't be done from this repo). Start in
> `mode: 'shadow'` (does everything except the final Save) on a test GSTIN.

## Setup
```bash
cd agent
cp .env.example .env      # fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + AGENT_ID
npm install
npx playwright install chromium
npm run dev               # starts the poll loop
```
`SUPABASE_SERVICE_ROLE_KEY` lets the Agent read client credentials + write results.
Keep it only on the trusted office machine.

## Run it automatically, forever (nobody starts it manually)

Two ways to host the always-on agent. After either, the team just clicks **Sync**
in the app and the background Agent does the rest.

### No office PC at all — run it in the cloud (recommended for "zero machine effort")
Deploy the agent as a small always-on cloud worker (Render / Railway / Fly.io) so
**no machine in your office does anything** — not even a one-time install. The repo
has `render.yaml` + `Dockerfile`; see **[CLOUD-DEPLOY.md](CLOUD-DEPLOY.md)**: push the
repo, connect it in the Render dashboard, paste one secret, click Apply. ~US$5–7/mo.
(Trade-off: cloud IPs can draw more CAPTCHAs from the portal — CLOUD-DEPLOY.md has the
proxy fallback.)

### On an office PC — double-click the installer
On the office PC, open the `agent` folder and **double-click `install-agent.bat`**.
It will:
1. check Node.js is installed (if not, it points you to nodejs.org),
2. ask **once** for your Supabase **service-role key** (Supabase dashboard →
   Project Settings → API → `service_role` secret) and write the local `.env`
   (the `SUPABASE_URL` is filled in for you),
3. `npm install` + download the Chromium browser,
4. register a **scheduled task** that starts the agent **at logon and restarts it
   if it ever crashes**, then start it right now.

After that single double-click the agent runs 24/7 on its own — **nobody opens a
terminal again.** The only recurring human step is typing a CAPTCHA in the app.
(One prerequisite: install **Node.js LTS** from https://nodejs.org once. To stop
and remove the auto-start later, double-click `uninstall-agent.bat`.)

> Keep the PC **on and signed in** — the task starts the agent at logon and it
> polls the queue continuously. `.env` sets `HEADFUL=false` so it runs invisibly;
> if the portal ever blocks headless logins, set `HEADFUL=true` and re-save.

### Option A — Windows service on an office PC (via NSSM, alternative)
Install [NSSM](https://nssm.cc/) (Non-Sucking Service Manager), then:
```powershell
# from an elevated PowerShell, in the agent folder
npm install
npx playwright install chromium
npm run build            # optional: or run via tsx directly below

nssm install GSTKeeperAgent "C:\Program Files\nodejs\node.exe" "C:\path\to\agent\node_modules\tsx\dist\cli.mjs" "C:\path\to\agent\src\index.ts"
nssm set GSTKeeperAgent AppDirectory "C:\path\to\agent"
nssm set GSTKeeperAgent Start SERVICE_AUTO_START     # starts on boot
nssm set GSTKeeperAgent AppExit Default Restart      # auto-restart on crash
nssm start GSTKeeperAgent
```
The service now starts on boot, restarts if it crashes, and polls the queue 24/7.
(Set `HEADFUL=false` in `.env` for a service; keep the PC on and signed in.)

Simpler (no NSSM): Task Scheduler → "Create Task" → Trigger "At startup" → Action
`npm --prefix C:\path\to\agent run start` → check "Run whether user is logged on".

### Option B — a small always-on container (cloud or a mini-PC)
A `Dockerfile` using the official `mcr.microsoft.com/playwright` image, `npm ci`,
then `CMD ["npm","start"]`, deployed to any host that can keep one small container
running (a cheap VPS / Fly.io / a Raspberry-class box). Same behaviour, off your desk.

## The CAPTCHA (auto-attempt, then human)
`login.ts` calls `autoSolveCaptcha()` (in `captchaSolver.ts`) first. That function is
**left unimplemented on purpose** (returns null) — auto-defeating the portal CAPTCHA
is against GSTN's terms and is not provided here. Until/unless your firm fills it in,
every fresh login **falls back to a human**: the job parks as `needs_human`, the app
shows the CAPTCHA image, and any staff member types it once (the session is then
reused for hours). So the day-to-day is: click Sync → it runs in the background →
occasionally someone types a CAPTCHA when a client's session has expired.
