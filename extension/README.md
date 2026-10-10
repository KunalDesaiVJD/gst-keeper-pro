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

## Updating (minimum v0.4.0, recommended v0.8.1)
The app refuses to start a notices sync from an extension older than **v0.4.0**
(`src/lib/extensionVersion.ts`) and nudges older copies to update to **v0.8.1**.
After pulling a new version of this folder, open `chrome://extensions` and click
**Reload** on “GST Keeper Portal Sync” on **every PC** that syncs. v0.4.0 never marks
saved notices missing after an empty or partly failed pull, checks that the portal
session belongs to the client being synced, and no longer stores portal passwords in
Chrome's extension storage. v0.5.0 saves through the database's single ingest door
with a run ledger, skips documents already saved, and moves on from a CAPTCHA nobody
typed — see CHANGELOG.md. v0.6.0 also reads applications on the portal (appeals
and others) and the registration status in every notices sync, keeps a GSTR-3A's
return period so it closes itself once that return is filed, and is what the
office agent drives (below). v0.7.0 runs the autopilot's scheduled syncs in your own
Chrome (below). v0.7.1 also reads the documents of new or changed refunds in the
notices sync, and keeps every pull outside Notices & Litigation as v0.3.3 ran it
(CHANGELOG.md lists the few security and crash fixes those pulls keep). v0.8.0
gives every notice the four things the portal's notice list leaves out — its own
PDF, its reply date, its officer and its DIN — from the case folder this sync
already reads (below). v0.8.1 offers a password the portal refused only once: a
bulk or scheduled sync logs that client, moves on to the next one, and skips it
until the password is changed in Edit Client (or the client is logged in once
from GST Keeper).

## GSTR-1: NIL push, e-invoices, IRNs (v0.8.4; IRNs kept since v0.8.7)
- **Push NIL** from the GSTR-1 page needs no JSON: the extension opens GSTR-1
  "Prepare Online" for the period and ticks **File Nil GSTR-1**. You file it on
  the portal yourself. (Text-based selectors, not yet checked on the live portal.)
- **Pull e-invoices** downloads the portal's own GSTR-1 JSON for the period and
  saves every document carrying an IRN (`einvoice_docs`, `einvoice_pulls`). From
  v0.8.7 the file must carry this client's GSTIN and period, and e-invoices the
  portal no longer holds are removed.
- **Push JSON** (v0.8.7) leaves out every document the page lists as already on
  the portal as an e-invoice with the same figures, so the portal keeps its own
  record with the IRN; an uploaded copy would replace it and lose the IRN. The
  rest of the JSON, HSN and Table 13 go up as stored. No IRN field is ever
  written into an upload; the result says how many e-invoices were left out.

## What a notice carries after a sync (v0.8.0)
The portal's notice list (`get/notices`) is thin: a reference number, a type, an
issue date. Everything else a reply needs is in the **case folder** — which this
extension already reads and saves whole. v0.8.0 lifts four of those fields onto
the notice itself, so the app has them without anyone opening the folder:

| On the notice | Where it comes from |
| --- | --- |
| **The notice's own PDF** | the folder document named after the reference number (`DOT_NOTICE_<ref>_<ts>.pdf`) — the one the app used to report as "PDF not captured yet" while it sat in storage, unlinked |
| **Reply due date** | the folder item's own date, only when the notice list gave none (a DRC-01, RFD-03 or RFD-08 usually gives none) |
| **Officer** | the officer's name and designation on the folder item |
| **DIN** | the folder item, written in a PATCH of its own so a database without the column loses nothing else |

Nothing a notice already carries is overwritten, and no document is downloaded
twice: a notice synced before v0.8.0 is linked to the PDF **already in
storage** — including when its case folder is not re-opened at all, so a closed
case costs nothing. A case whose notice is still missing one of these does have
its folder opened on the next run rather than waiting for the weekly full pass,
to pick up the officer and the date; a reference that yields nothing is not
forced again for a week, so this cannot become an extra fetch on every run.

After the first run, check in the app: **Reply Factory → Overview** ("due dates
on open notices", target 98%) and any notice's **Documents** tab, where "the
notice" should now name a PDF. The run's own debug panel reports the counts
("linked from folder: n notice PDFs, n reply dates, n officers, n DINs").

## Scheduled syncs in your Chrome (v0.7.0)
GST Keeper's autopilot runs the agreed schedule — 05:30 every active client, 13:00 the
clients that need it — in **your own Chrome**, the one that has your CAPTCHA extension.
There is no CAPTCHA wall and nobody needs to be at the screen.

1. Load this extension (v0.7.1 or later) in the Chrome that has your CAPTCHA extension
   (`chrome://extensions` → Developer mode → Load unpacked, or Reload).
2. In its popup, tick **Run scheduled syncs in this Chrome** and give the PC a name
   (for example "Reception PC"); GST Keeper shows it under Notices → Autopilot.
3. In GST Keeper, Notices → Autopilot → Settings, switch the autopilot on, and set "Who
   the afternoon run takes" (13:00) to "Only clients that need it" or every client
   ("None" turns the 13:00 run off). Keep that PC and Chrome on at 05:30 and 13:00; a
   slot that finds Chrome closed runs when it opens within 3 hours.

What it does: about once a minute the extension tells GST Keeper this Chrome is there
and, when nothing else runs in it, takes the next client from the queue. Each client
gets a window of its own: the extension logs out of the portal, fills the user ID and
password, and **waits for your CAPTCHA extension to fill the CAPTCHA box**; it then logs
in, reads notices & orders (with case folders and PDFs), refunds (and the documents of
new or changed ones), DRC-03, applications and the profile, saves them, logs out and
closes the window. Evidence a notice's reply needs (GSTR-1, 3B, 2A, 2B, the credit
reversal statement, GSTR-9 for its periods) is queued by GST Keeper and fetched the same
way, one client at a time. If the box is not filled
within the wait set in the app (120 seconds unless changed), that client is tried again
later (after 5, 10, 20 … minutes, up to the tries set in the app) and the next one
starts. This extension never reads, copies or solves the CAPTCHA, and passwords are
fetched only at the moment of login, as for a person's sync.

People come first. A sync someone starts in this Chrome (Sync now, the popup) takes
over at once: the scheduled client goes back to the queue. Scheduled syncs also wait
while a GST portal tab is open and someone has used the PC in the last 5 minutes,
because the portal keeps one login per browser and the scheduled client would replace
theirs. Close the portal tab when you are done, or keep a separate Chrome profile
(with both extensions) for scheduled syncs. Untick the box, or press "Pause scheduled
syncs in this Chrome" in the popup, to stop.

Good to know: leave the scheduled windows alone (do not minimise them); where the
office allows it, keep that PC's display on and unlocked at the scheduled times, as
Chrome slows pages it thinks nobody can see (CHANGELOG 0.7.0 says how the extension
copes). Two PCs can both run scheduled syncs; each takes its own clients. If the
autopilot is set to the office agent (by SQL), this Chrome takes nothing.

## The office agent (Portal Autopilot, v0.6.0+; behind `runner = 'office_agent'` since v0.7.0)
`agent/` runs this same extension on an always-on office PC, in its own Chromium,
on a schedule. It starts each client's job with `startAgentJob` (background.js); an
agent job (`job.agent`) sends its login CAPTCHA to the app's CAPTCHA wall instead of
a desktop notice and waits up to 30 minutes for the answer the agent types into the
field, marks the page (`data-gstk-captcha="ready"`) once it is listening, and leaves
its run to the queue. The watchdog leaves an agent job's CAPTCHA wait to the agent.
People type every CAPTCHA; see `docs/PORTAL_AUTOPILOT_POSITIONS.md`.

## Testing without the portal
`node test/run-all.mjs` (v0.8.0) runs the whole 0.8.0 notices work with no portal,
no database and no network: the folder-field helpers, the link pass extracted
from `content.js` itself, and three end-to-end runs that drive the real
`content.js` against a fake portal — a DRC-01 whose PDF exists only in its case
folder, a notice linked from the PDF already stored with the folder never
opened, and the refunds step proving its own rows are shaped exactly as 0.7.1
wrote them while the RFD-08's notice gets patched. `test/_extract.mjs` rebuilds
the test copies of those helpers straight from `content.js`, so the tests cannot
drift from the shipped code.

`test/notices-sync.sim.mjs` runs the real `background.js`, `db.js` and `content.js` in
Node against a fake portal and a **local** PostgREST + PostgreSQL carrying the
migrations (see `supabase/tests/notices/README.md`). It checks a first run, an
unchanged rerun (nothing downloaded twice), a run with a removed / new notice and a
reply on the portal, a wrong-GSTIN session, the weekly full folder pass, the 0.6.0
applications / registration status / GSTR-3A detail, the agent hooks and the
CAPTCHA watchdog. Never point it at the live project. The agent's own end-to-end
test drives this extension in Chromium against a stand-in portal
(`agent/test/README.md`), and so does the scheduled-sync test
(`agent/test/chrome-runner.e2e.test.ts`, with a test-only stand-in for a CAPTCHA
extension).

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
