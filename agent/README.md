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
