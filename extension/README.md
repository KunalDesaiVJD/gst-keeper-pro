# GST Keeper — Portal Sync (browser extension)

Pulls GST portal data into GST Keeper **from your own browser**. Because it runs on
your normal office connection (not a server/cloud IP), the portal treats it like a
normal user — **no firewall block, no server, no monthly cost.**

```
Your browser (normal IP) ──logs in + reads──▶ GST portal
        │
        └──writes 2B / ledger / filing status──▶ GST Keeper (Supabase)
```

## What it does today (v1)
- Logs into the portal for a chosen client (you type the CAPTCHA once, in an overlay).
- Pulls **Filing status** (ARN + filed date + status → `filing_status`).
- Pulls **Credit-ledger opening balance** (per head → Suspended Reco / GST Receivable Reco).
- For the **Annual Return (GSTR-9 / 9C)** workspace (Portal data step):
  - **As-filed GSTR-3B**, all 12 months of a year in one login (`gstr3b_pull`);
  - **GSTR-9 system-computed** figures (`gstr9_pull`, v0.3.3+) — the portal's own
    `returns2/auth/api/gstr9/details/calc`, saved raw as `GSTR9_CALC`. Read-only
    (GET); not yet confirmed against a live return — if it fails, upload the JSON
    saved from the portal instead.
- *(GSTR-2B pull is the next addition — it needs file-download handling.)*

## Install it once per browser (free, ~1 minute)
1. Open **Chrome → `chrome://extensions`**.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** → select this **`extension`** folder.
4. Pin the **“GST Keeper — Portal Sync”** icon to the toolbar (optional).

That's it — nothing to keep running, no account, no card.

## Updating (minimum v0.4.0, recommended v0.6.0)
The app refuses to start a notices sync from an extension older than **v0.4.0**
(`src/lib/extensionVersion.ts`) and nudges older copies to update to **v0.6.0**.
After pulling a new version of this folder, open `chrome://extensions` and click
**Reload** on “GST Keeper Portal Sync” on **every PC** that syncs. v0.4.0 never marks
saved notices missing after an empty or partly failed pull, checks that the portal
session belongs to the client being synced, and no longer stores portal passwords in
Chrome's extension storage. v0.5.0 saves through the database's single ingest door
with a run ledger, skips documents already saved, and moves on from a CAPTCHA nobody
typed — see CHANGELOG.md. v0.6.0 also reads applications on the portal (appeals
and others) and the registration status in every notices sync, keeps a GSTR-3A's
return period so it closes itself once that return is filed, and is what the
office agent drives (below).

## The office agent (Portal Autopilot, v0.6.0+)
`agent/` runs this same extension on an always-on office PC, in its own Chromium,
on a schedule. It starts each client's job with `startAgentJob` (background.js); an
agent job (`job.agent`) sends its login CAPTCHA to the app's CAPTCHA wall instead of
a desktop notice and waits up to 30 minutes for the answer the agent types into the
field, marks the page (`data-gstk-captcha="ready"`) once it is listening, and leaves
its run to the queue. The watchdog leaves an agent job's CAPTCHA wait to the agent.
People type every CAPTCHA; see `docs/PORTAL_AUTOPILOT_POSITIONS.md`.

## Testing without the portal
`test/notices-sync.sim.mjs` runs the real `background.js`, `db.js` and `content.js` in
Node against a fake portal and a **local** PostgREST + PostgreSQL carrying the
migrations (see `supabase/tests/notices/README.md`). It checks a first run, an
unchanged rerun (nothing downloaded twice), a run with a removed / new notice and a
reply on the portal, a wrong-GSTIN session, the weekly full folder pass, the 0.6.0
applications / registration status / GSTR-3A detail, the agent hooks and the
CAPTCHA watchdog. Never point it at the live project. The agent's own end-to-end
test drives this extension in Chromium against a stand-in portal
(`agent/test/README.md`).

```
node extension/test/notices-sync.sim.mjs http://127.0.0.1:54399 /path/to/anon.jwt
```

## Use it
The toolbar popup is the "Portal autopilot" (v0.5.1+):
1. It shows the last notices sync, how many clients synced in the last 24 h and which
   are failing, and why.
2. **Sync notices for stale & failed (n)** is the default; you can pick all active
   clients or one client instead. It says how many CAPTCHAs and roughly how long.
3. A GST-portal tab opens per client and logs in — **type the CAPTCHA** (the popup shows
   "CAPTCHA waiting → Open the portal tab"). Each client reads notices & orders with
   their case folders and PDFs, then refunds, then DRC-03. Progress and **Stop** show
   in the popup while it runs. The app's **Sync now** starts the same run.
4. **Other syncs → ledger pull** (return period) logs in and reads the credit, credit
   reversal & re-claim, liability and cash ledgers; it does not write filing status.

## Why this works when the cloud didn't
The GST portal's firewall blocks **datacenter/cloud IPs** (that's why the free cloud
agent got "Request Rejected"). This extension makes the requests from **your** browser
on **your** connection — the exact path that already works when you log in by hand.

## Notes / honest limits
- The browser tab must stay open while a sync runs (a minute or two per client). It's not
  a silent overnight job — but a person is there for the CAPTCHA anyway.
- Credentials are read from GST Keeper (same access the web app already has) and used only
  in your browser; nothing extra is stored.
- First run may need a small selector tweak if the portal markup shifts — the banner will
  say where it stopped.
