# GST Keeper — Portal Sync: Changelog

Notable changes to the browser extension (`extension/`). Newest first.

## 2026-10-06 — One pipe and a run ledger (v0.5.0) — reload on every PC

Phase 1 of the notices roadmap (`docs/NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf`). v0.4.x
still syncs; the app nudges it to update.

- **One ingest door.** Notices, case-folder items, refunds and DRC-03 rows are saved
  through the database function `sync_ingest` (migration `20261006113000`) instead of
  four REST writes: a per-client lock, server timestamps, and the guarded soft delete
  decided in the database. Older databases fall back to the REST path.
- **Run ledger.** Each Sync All opens a `sync_runs` row; every client and step writes a
  `sync_run_items` row with new / changed / unchanged / removed / held counts and a
  failure reason (`captcha_timeout`, `session_mismatch`, `timeout`, `portal_error`,
  `stalled`, …). Company List shows the last result per client and offers "Retry
  failed" and "Sync stale > 24 h".
- **Faster runs.** PDFs and folder attachments already saved are not downloaded
  again; a case's folder is read only when the case is new or still open, plus one
  full pass per client every 7 days; challans are read for recent months with a
  weekly full read; every portal call has a timeout.
- **Risk-ordered queue.** Sync All starts with clients whose notices are due within
  7 days or overdue, then never-synced, then the stalest; inactive clients are skipped.
- **CAPTCHA watchdog.** A `chrome.alarms` watchdog notices a client that made no
  progress for 10 minutes (an untyped CAPTCHA), records it in the ledger, shows a
  desktop notification and moves to the next client; a run idle for 3 hours is
  closed as abandoned. A desktop notification also asks for the CAPTCHA when one
  is waiting.
- **Case links kept.** A case task with the same reference as a listed notice now
  links that notice to its case (its folder shows on the notice) instead of being
  dropped.
- **Fixed:** steps that read a constant declared lower in `content.js` failed with
  "Cannot access … before initialization" — the credit reversal / re-claim pull and
  the RCM liability pull on every run, and the refund documents step for a folder
  without a type name. All such constants now sit at the top of the script.
- New permissions: `alarms`, `notifications` (and an icon for the notifications).

## 2026-10-06 — Safety release for notices sync (v0.4.0) — update on every PC

Phase 0 of the notices roadmap (`docs/NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf`). The app
now refuses to start a notices sync from any copy older than 0.4.0.

- **Nothing is marked missing after a bad pull.** A pull that returns no rows, a
  portal error envelope (`{status: 0, error: …}`, previously read as "no notices"), a
  failed case-task list or a failed case-folder read no longer soft-deletes the
  client's saved notices, refunds, DRC-03 rows or folder items. A pass that would
  remove more than half of a client's rows (and more than 5) is held back and logged
  as `notices_guard` in the sync log instead of applied.
- **Batches are de-duplicated** by their conflict key before upserting (a repeated
  key made PostgREST reject the whole batch).
- **Identity check.** Before saving anything, the notices step asks the portal whose
  session this is (`profile/detail`); if the GSTIN differs from the client being
  synced, nothing is saved for that client and the run moves on. If the GSTIN cannot
  be read, the run is not blocked.
- **Passwords leave chrome.storage.** Jobs no longer carry portal passwords; the
  login step fetches the one password it needs at the moment it fills the form.
- **Sweep after each client.** The notices step and the DRC-03 step call the
  database's `notices_sweep` for that client, so case due dates and auto-closures
  appear immediately (a nightly run covers older copies).
- **Unscoped Sync All skips inactive clients** (`inactive_at_hand`); a hand-picked
  selection still syncs them.
- **The app bridge answers only the app.** It accepts messages from
  `https://gst.vjdesai.com` and `https://gst-keeper-pro.vercel.app` only (previously
  any `*.vercel.app` page could start portal logins, syncs or GSTR-1/3B pushes) and
  replies to the page's own origin rather than `*`.
- Removed the unused `fastcaptcha.org` host permission.

## 2026-09-28 — New: GSTR-9 system-computed pull for the Annual Return (v0.3.3)

**What:** a new section-pull mode, `gstr9_pull`, started from Annual Return →
Portal data → "Pull from portal" (the app sends `__gstkPullSection` with
`mode: 'gstr9_pull'` and `period_month: '03/YYYY'`, the FY's closing March).
After login it opens the returns dashboard and `handleGstr9Pull` in
`content.js`:
1. `GET returns2/auth/api/gstr9/details/calc?ret_period=03YYYY&gstin=…` — the
   GSTR-9 system-computed figures (Tables 4, 5, 6, 8, 9);
2. `GET returns/auth/api/formdetails?rtn_prd=03YYYY&rtn_typ=GSTR9` — ARN,
   filed date and status (non-fatal if it fails);
3. saves the raw JSON unchanged to `gst_filed_returns`
   (`return_type 'GSTR9_CALC'`, `period_month '03/YYYY'`) with `updated_at`,
   which the app polls for, parses and shows in a preview before applying.

GET only — it never calls any save / submit / compute / file endpoint.

**Not yet confirmed live.** The endpoint and its parameters were taken from
the portal's own GSTR-9 page script (`gstr9ctrl.js`, `getSumData()` →
`ajax.get("/returns2/auth/api/gstr9/details/calc", { ret_period, gstin })`),
not from a real pull. It still needs a live check. If the first call does not
return `{ status: 1, data }` (HTML / 403 on a cold session), the handler opens
`returns2/auth/annualreturn` once (flag `job.gstr9Warmed`) and retries on that
page; a second failure is written as `status: 'PULL FAILED: …'` (with
`updated_at`, so the app stops waiting) and the app offers Upload / typing
instead. The session-bounce give-up path records the same failure.

**Version bump:** 0.3.2 → 0.3.3. The app blocks the GSTR-9 pull on older
versions, because an extension that doesn't know the mode would fall through
to the default ledger pull after login.

The existing `gstr3b_pull` mode is unchanged; the Annual Return page now also
starts it for all 12 months of a financial year (`period_months`).

## 2026-09-22 — Fix: GSTR-3B PDF pull failed behind an auto-popup

**Problem:** Pulling a filed GSTR-3B's ARN + PDF via Filing Status's Portal
button failed with "could not capture the PDF," even though downloading the
same PDF by hand on the portal worked fine.

**Root cause:** The GST portal auto-shows a "System generated summary"
popup (`#statustable`) every time the GSTR-3B return page loads. It sits on
top of the real download button. The extension's download search was also a
loose text match ("download" + "pdf"), which risked grabbing the wrong
control — the page has a second, red "SYSTEM GENERATED GSTR-3B" button that
downloads a different file entirely.

**Fix:** `handleReturnView` in `content.js` now, for GSTR-3B specifically:
1. Checks if the summary popup is open and closes it, waiting until it's
   actually gone (not just clicked).
2. Targets the exact download button by its `data-ng-click="downloadPrePdf()"`
   attribute instead of guessing by text.
3. Falls back to the old generic search only if that exact button isn't
   found (e.g. an unfiled period has no such button).

Confirmed live against a real filed GSTR-3B return.

## 2026-09-20 — Fix: CAPTCHA login submitted on the first keystroke

**Problem:** When logging in manually (Clients → Credentials → Login, or Filing
Status's login icon), the extension clicked the portal's Login button the
instant the CAPTCHA box had *any* text in it — i.e. after your very first
keystroke, with the CAPTCHA still only partially typed. This guaranteed a
wrong-CAPTCHA failure on every manual login.

**Fix:** `handleLogin` in `content.js` no longer submits on "any text present."
It now watches how the CAPTCHA field's value changes:
- If the value **jumps by more than one character in a single change**
  (an automated fill — e.g. a future OCR-based auto-solve setting the whole
  result at once), it auto-clicks Login immediately, same as before.
- If the value **grows one character at a time** (a real person typing), it
  never auto-clicks — it shows a banner asking you to press Enter / click
  Login yourself once you're done, exactly like using the portal directly.

The CAPTCHA field has no `maxlength` to read (confirmed live — it's only
constrained by a numeric `ng-pattern`), so length couldn't be used to detect
"done typing." The portal also blocks a real clipboard paste on this field
(`data-ng-paste` preventDefault), so a multi-character jump can only mean a
script wrote it — never a person pasting — making the two cases reliably
distinguishable.

Everything after a successful auto-submit (bad-password / bad-CAPTCHA
detection, the 3-attempt retry loop) is unchanged.
