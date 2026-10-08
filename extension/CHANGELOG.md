# GST Keeper — Portal Sync: Changelog

Notable changes to the browser extension (`extension/`). Newest first.

## 2026-10-08 — Password issues are recorded in GST Keeper; every sync skips them (v0.8.2)

Needs migration `20261010100000_notices_cleanup_settings.sql` for the shared record;
without it 0.8.2 behaves as 0.8.1.

- **Fixed: a client the portal sends to its change-password page held the run.**
  An expired password, a first login after a reset or a forced change opens the
  portal's "set a new password" page, which sits under /auth/ like any logged-in
  page. 0.8.1 took it for a working session, the sync steps kept opening pages the
  portal sent back to that page, and the run never moved on (seen live on
  8 October: ten clients synced, then the eleventh never ended). Now that page is
  recognised by its address or by what it shows (two or more password boxes and
  words about a new password), the client is logged as "The portal asks for a new
  password" and the run starts the next client.
- **Every password issue is recorded in GST Keeper.** A wrong user ID or password,
  a locked account, an expired password or a required change is written to the
  client (`client_login_issue_set`) and listed in Notices · Settings, "Portal
  password issues", with the portal's own words, for the team to fix.
- **Skipped everywhere until fixed.** A person's "Sync" leaves those clients out
  from the start (the app says how many), and a scheduled sync fails them at once
  without opening the portal, in any Chrome. Changing the password or user ID in
  Edit Client clears the issue by itself; "Fixed" in Settings clears it too, and a
  login that works clears it.
- Tests: a forced password change case in `agent/test/chrome-runner.e2e.test.ts`
  (the change page is opened once, the issue is recorded, the next scheduled and
  person's syncs skip the client, a new password clears it). All ten runner cases
  pass.

## 2026-10-08 — A refused password is offered once; the sync moves on (v0.8.1)

Built on 0.8.0. Only the login is touched; every pull, the notices link pass and
the popup are as 0.8.0 runs them. Needs no database update.

- **Fixed: a wrong or changed password held a bulk sync on one client.** When a
  person typed the CAPTCHA, the portal's "Invalid Username or Password" was never
  read: the answer was checked only after an automatic fill, so the extension
  filled the same password in again and asked for another CAPTCHA for the same
  client, again and again, while every client queued behind it waited. Now the
  portal's answer is read after every Login press, whoever pressed it.
- **A refusal is logged once, and the sync starts the next client.** A refused
  user ID or password, an expired password or a locked account is written to the
  client's sync log and the run ledger ("Wrong user ID or password (the portal
  said: …). Not tried again until the password is changed in Edit Client."), the
  banner says so, and the run goes straight on. The last banner of the run names
  every client left out this way.
- **Never offered again until it is changed.** Each wrong password a few tries in
  locks the client's portal account, so a refused password is remembered: the
  next bulk or scheduled sync skips that client at once, logged as "Not tried: the
  portal refused this saved password on …", without opening the portal (a
  scheduled sync does not even open a window for it). Changing the password or
  user ID in Edit Client, or logging the client in once from GST Keeper (its
  Credentials Login), clears it. Only a salted SHA-256 fingerprint of the refused
  user ID and password is kept, in this Chrome's own storage; never the password.
- **A CAPTCHA typo is still tried again; anything else only once.** "Enter valid
  Letters shown." and other CAPTCHA answers get a fresh CAPTCHA up to three times,
  as before. A message that is neither (a portal error, say) gets one more try with
  the same password, never three; the same answer again logs the client and moves
  on. The answer is read from more of the page (the portal's alert, toast and
  field messages, and any line of the login form that reads as a refusal), and a
  message already on the form before Login was pressed is not taken for its answer.
  A refusal the portal sends back as a fresh login page, rather than in place, is
  read too: the press is noted in the tab's sessionStorage, which outlives the page.
- Tests: `test/06-login-answers.test.mjs` (which messages read as a refusal, a
  CAPTCHA typo or neither; the form's own labels never as anything), and two new
  cases in `agent/test/chrome-runner.e2e.test.ts` with the real extension in
  Chromium: a scheduled sync with a changed password (tried once, failed without a
  retry, skipped without the portal next time, tried again once corrected) and a
  person's two-client sync (the person types the CAPTCHA, the refusal moves the run
  to the next client, and the next sync skips it), and a refusal answered with a
  fresh page. All nine runner cases, the seven office agent cases and the notices
  sync simulation pass on 0.8.1.

## 2026-10-07 — The notice's own PDF, its reply date, its officer and its DIN (v0.8.0)

Notices & Litigation only. Every other pull — GSTR-2B / 2A, GSTR-1 upload and
pulls, GSTR-3B push and pulls, GSTR-9, ledgers, challans, filing, Fetch Company,
the popup's return-period sync — is byte-for-byte as 0.7.1 ran it, and so are
the login, the CAPTCHA wait, the job slot, the scheduled-sync runner
(`runner.js`), the popup and the app bridge: those files are untouched. Needs no
database update.

- **Fixed: a notice's own PDF was never linked, though it was already in
  storage.** The app showed "PDF not captured yet — the next sync fetches it"
  beside a DRC-01, an ASMT-10 or a DRC-07 whose PDF the previous sync had in
  fact downloaded into its case folder. The notices step downloads a notice's
  PDF only when `get/notices` hands it a `docId` + `applnId`, which it does not
  for a case-based form; the folder route that would have caught it was skipped
  for exactly those notices, because a row that `get/notices` had already
  returned counted as "PDF already stored" (`haveTaskPdf = isDuplicate || …`).
  So the document was fetched, uploaded and attached to the case folder, and the
  notice beside it stayed empty. A **link pass** now gives every notice row the
  matching folder item's document: the generated form named after the reference
  number (`DOT_NOTICE_<ref>_<ts>.pdf`, `ADJDT_DRPRC_<ref>_<ts>.pdf`) in
  preference to a supporting attachment.
- **No document is downloaded twice to do it.** Folder items are keyed
  `'<SECTION>:<refId>'`, so a notice finds its item by that key's suffix among
  the attachments **already stored** — which is how a notice on a closed case
  whose folder is not re-opened still gets its PDF linked, with no portal call
  for that folder at all.
- **Reply dates, from the case folder.** A DRC-01, an RFD-03 and an RFD-08 often
  arrive in `get/notices` with no `dueDate`; the date is in the folder item. The
  Reply Factory's "due dates on open notices" measure was 610 of 641 (95.2%)
  against a 98% target, with 31 open notices carrying no date to run on. Those
  are now read from the folder — and only when the notice has none of its own,
  so a date the portal put in the notice list stays the authority.
- **The officer, and the DIN.** The notice detail's "Officer" and "DIN" were
  always "—" although the folder item carries the officer's name and
  designation. Both are now read. The portal spells these differently from one
  folder section to the next, so each field is found by walking the item's JSON
  for any of a list of candidate key names (`dueDt` / `replyDueDt` / `dtOfReply`
  …, `issuedBy` / `officerName` …, `din` / `dinNo` / `docDin` …), separators
  stripped and case ignored — the same reasoning `findDocDescriptors` is built
  on, so a section not seen yet still yields something.
- **The DIN is written on its own, never in the notices save.** This extension
  cannot migrate the database, and one unknown column in the upsert body would
  cost a client every notice in that save. So the DIN goes through a small
  `patchNoticeFields` PATCH per notice after the save, which fails harmlessly on
  a database without the column — and gives up after three refusals with nothing
  written, rather than spending a client with 326 notices on 326 refusals.
- **A gap is closed on the next run, not in a week's time.** A case whose notice
  still has no PDF, reply date or officer has its folder opened even when the
  case is closed and would otherwise wait for the weekly full pass. Bounded: a
  reference that yields nothing is not forced again for seven days, so a notice
  the portal simply has no detail for cannot become an extra folder fetch on
  every run for ever.
- **Refund notices (RFD-03, RFD-08) are linked in the same run.** Their PDF and
  reply date live in the refund case's folder, which the refunds step reads
  *after* the notices are saved — so that step now ends with a link pass of its
  own, patching only the notices that are actually still missing something
  (`noticesNeedingDetail`).
- **Fixed: GSTR-3A notices that lost their PDF to a race.** The portal serves
  `gstr3a/summary` only with a Referer it likes, which 0.3.2 solved with a
  `declarativeNetRequest` rule — registered asynchronously at worker startup,
  while the worker starts on the very message that wants the rule. A summary
  fetched in those first moments went out with the page's own Referer and came
  back as the 200 "Access Denied" HTML page, failing as "not JSON": the "no PDF
  captured" rows in All notices. The registration is now awaited before the
  first cross-origin fetch (at most 3 s, then the fetch goes anyway), an HTML
  body is recognised as the refusal it is rather than parsed, and each summary
  gets one retry two seconds later.
- **A bad date in a folder can no longer cost a client its whole notices save.**
  A reply date is accepted only if it is a real calendar day in 2017–2100:
  `31/02/2024` is refused rather than passed to Postgres, which would reject the
  row and take every other notice in the batch with it. (`new Date()` alone is
  no guard — V8 rolls that date over into March.)
- **A PDF already stored is carried on the row** instead of being left null.
  The row is upserted, so a null was written over a stored PDF whenever the
  ingest RPC was unavailable and the legacy REST path ran. One-off side effect:
  the first run after updating reports those notices as "changed".
- New in the debug panel and the client sync log: what the link pass filled —
  notice PDFs, reply dates, officers and DINs — so a run that fills nothing is
  diagnosable rather than silent.

## 2026-10-08 — Notices only; every other pull as in 0.3.3 (v0.7.1)

For a PC coming straight from **v0.3.3**: this release carries everything 0.4.0 to
0.7.0 added for Notices & Litigation, and keeps every other pull (GSTR-2B / 2A,
GSTR-1 upload and pulls, GSTR-3B push and pulls, GSTR-9, ledgers, challans, filing,
Fetch Company, the popup's return-period sync) working as it did in 0.3.3. Needs no
database update beyond the migrations already applied.

- **Refund documents in the notices sync.** The notices bundle (the app's Sync now,
  the popup's Sync notices and the scheduled syncs) now reads, after the refund list,
  the documents of refunds that this Chrome has not read in full yet or whose status
  changed since (a deficiency memo, a show cause notice, an order), and every refund
  once a week. A document already saved is never downloaded again, here or from the
  Refunds page's own "fetch documents".
- **Fixed: the Refund Notice Folder was never filled.** The refund documents step used
  a pull time it never declared, so each folder's items were dropped after the first
  one's documents and no folder item reached `gst_case_folder_items`. A folder that
  fails to read now removes nothing.
- **The desktop "CAPTCHA waiting" notice is for notices syncs only.** 0.5.0 showed it
  at every login; a 2B pull, a GSTR-1 upload or any other pull logs in as in 0.3.3.
- **Challans as in 0.3.3**: the whole history back to July 2017 on every pull (0.5.0's
  weekly full pass with a 300-day slice in between is gone; the notices sync never
  reads challans).
- **Popup, Other syncs:** the return-period sync offers "All clients with credentials"
  again, as 0.3.3 did, under its old button name "Start sync in this browser".

### What changed for the other pulls since 0.3.3, and why it stays

- **The app bridge answers only the app** (0.4.0): `https://gst.vjdesai.com` and
  `https://gst-keeper-pro.vercel.app`. In 0.3.3 any `*.vercel.app` page could start
  portal logins, syncs or GSTR-1 / 3B pushes; a Vercel preview link no longer reaches
  the extension.
- **The portal password is fetched when the login form is filled** (0.4.0), not
  stored with the job in Chrome's storage. The login itself is the same.
- **Fixed: "Cannot access … before initialization"** (0.5.0): the credit reversal and
  re-claim statement and the RCM liability statement failed on every run in 0.3.3
  because they read a constant declared further down `content.js`. They work now; the
  notices evidence reads the first of them.
- **Fetch Company** also saves the registration status (Active / Cancelled /
  Suspended) from the same profile response (0.6.0).
- One job at a time still: every start goes through one queue (0.7.0), and a sync a
  person starts always comes before a scheduled one.

## 2026-10-08 — Scheduled syncs in your own Chrome (v0.7.0)

The firm's decision of 6 October 2026: no CAPTCHA wall. The firm's Chrome has a
CAPTCHA extension of its own choosing that fills the portal's CAPTCHA box, so GST
Keeper runs the agreed schedule (05:30 every active client, 13:00 the clients that
need it) in that Chrome and the CAPTCHA extension does the rest. Needs the database
update `20261008170000_autopilot_chrome_runner.sql`; on an older database the runner
says "Database not updated" and takes nothing.

- **Run scheduled syncs in this Chrome** (popup; off by default) makes this browser a
  runner of the autopilot queue: agent `chrome:<id>` (the id kept in
  chrome.storage.local), with a name for the PC that GST Keeper shows. About once a
  minute (`chrome.alarms`) it reports itself (`autopilot_heartbeat`: kind, label,
  version, busy, job, client, step) and, when nothing else runs in this browser,
  claims one job (`portal_job_claim(p_agent, p_wall_open => false)`), starts it the
  way `startAgentJob` does (same steps, same `sync_ingest`, same run ledger), calls
  `portal_job_start`, watches it to the end and calls `portal_job_finish` with the
  office agent's outcome and reason mapping (`agent/src/outcome.ts`). Then it logs the
  portal out, closes the window it opened and claims the next. New file `runner.js`,
  loaded by `background.js`.
- **The CAPTCHA.** A scheduled job relays its CAPTCHA nowhere: no CAPTCHA wall, no
  `data-gstk-captcha` mark, no desktop notice. It waits up to `captcha_wait_secs`
  (Autopilot settings; 120 s by default) for the box to be filled — in one jump, the
  existing auto-submit path, or (scheduled jobs only) a box the CAPTCHA extension had
  filled before the page was listening, or filled in steps with no key pressed, once
  it holds still for 1.5 s. Only the box's value is looked at, never the image. Not
  filled in time: the client fails with `captcha_timeout`, the queue tries it again
  after 5, 10, 20 … minutes up to `max_attempts`, and the runner moves on. Three wrong
  CAPTCHAs and a rejected password end the client as before (`login_failed`). A person
  who types in the box still presses Login themselves. A client with no saved password
  fails at once with `login_failed`, in the run ledger.
- **A person comes first.** A sync a person starts in this Chrome (the app's Sync now,
  the popup) takes the job slot even while a scheduled client runs: the runner gives
  that client back to the queue (`portal_jobs_release`, no try counted), logs the
  portal out and closes its window. The runner does not start while a person's sync
  runs, nor while a GST portal tab is open and someone has used the PC in the last 5
  minutes (`chrome.idle`): the portal keeps one session per browser profile, so logging
  a client in would change that person's session. A portal tab someone opens while a
  scheduled client runs, or someone coming back to the PC while a portal tab is open,
  makes the runner give the client back and log out. A person's sync whose tab was
  closed before it finished can never go on, so it no longer holds the browser (its run
  is closed as abandoned).
- **Restarts.** When Chrome or the extension restarts in the middle of a client, the
  runner gives it back at startup (`portal_jobs_release`, as the office agent does) and
  clears the job slot; a step it was in the middle of resumes from
  `gstk_runner_state`. A give-back that did not reach the database is released before
  the next claim.
- **Kill switch.** Autopilot off or paused in the app, or the runner set to the office
  agent: nothing new is claimed; a client still at the login goes back to the queue; a
  client already logged in finishes its pull. A job cancelled in the app stops at the
  next check.
- **Deadlines kept by the service worker**, from timestamps on every alarm, not by the
  page's timers: the CAPTCHA wait (`captcha_wait_secs` + 45 s; the page's own timer
  normally ends it first), a login page that never loads (3 minutes), the whole client
  (40 minutes, as the office agent) and a closed window. Every database call the runner
  makes ends within 30 seconds, so a hung request never holds the next check. The watchdog treats a
  scheduled job like an agent job (a step stuck for 10 minutes is recorded as
  `stalled` and dropped).
- **One job slot.** Every start (`start…`, `startAgentJob`, the popup's ledger pull
  through `putActiveJob`) writes `gstk_active_job` through one queue (`jobSlot`), and
  so does the watchdog, so a person's start and the runner never interleave a check
  and a write. A scheduled job's content script only writes or clears its own job.
- **Popup:** a "Scheduled syncs" card — the switch, the PC's name, the autopilot on or
  off in the app, this Chrome online, the current client and step, the next scheduled
  run, the last result, and one line: "The CAPTCHA is filled by the CAPTCHA extension
  in this Chrome. If it is not filled within N seconds, the client is tried again
  later." A scheduled client shows as "Scheduled sync running" with "Pause scheduled
  syncs in this Chrome". With the Chrome runner, "Send to the office agent" becomes
  "Queue for the scheduled Chrome".
- New permission: `idle` (is someone using this PC; no install warning).
- Unchanged: the app's Sync now, the popup's Sync notices and every other pull, and
  `startAgentJob` for an office agent (`autopilot_settings.runner = 'office_agent'`).

### Where a scheduled client runs, and why

Each scheduled client runs in **a window of its own**: `chrome.windows.create` (a
normal window, 1280 × 900, never minimised), focused only when nobody has used the PC
for 5 minutes — so it comes to the front at 05:30 and never takes the keyboard from
someone working at 13:00 — with its tab marked not auto-discardable, and closed when
the client is done.

- Chrome slows timers in hidden pages (to once a second, and after 5 minutes hidden to
  once a minute for chained timers) and Memory Saver may discard background tabs. A
  person's sync avoids that by keeping its tab in front. A tab added to a window
  someone works in would be a background tab whenever they look at another tab; the
  only tab of its own window is the active tab there, and counts as visible unless the
  window is minimised or covered. A new window per client also starts Chrome's
  5-minute clock afresh for every client.
- Nobody's tabs or windows are touched, and closing the window leaves no portal tab
  logged in behind it (the runner logs out first).
- The deadlines above are the service worker's, so a slowed or frozen page can delay
  one client but cannot hold the queue.
- Limits: on Windows a locked screen, a display that is off, or a window covered by
  others counts as hidden. Keep that PC's display on and unlocked at the scheduled
  times where the office allows it, or ask IT to set Chrome's policy
  `IntensiveWakeUpThrottlingEnabled` to false; otherwise a long first sync can take
  longer, and the deadlines still close it.
- Not chosen: a tab in the window a person uses (background throttling, and it would
  take the focus at 13:00); a minimised window (always hidden); an incognito window (it
  would keep the portal session apart from the person's, but needs "Allow in
  Incognito" for both extensions, and a CAPTCHA extension may not run there).

## 2026-10-07 — Office autopilot and more read per sync (v0.6.0)

Phase 3 of the notices roadmap (Portal Autopilot; audit findings S-01, S-21, S-22,
S-23, S-31). Works on a database without the Phase 3 migrations: the new writes are
skipped there.

- **The office agent drives this extension.** `startAgentJob` (background) starts
  one client's job in the agent's own Chromium the way a person's Sync does — same
  steps, same `sync_ingest`. An agent job (`job.agent`) relays its CAPTCHA to the
  app's CAPTCHA wall instead of a desktop notice, waits up to 30 minutes for the
  relayed answer instead of 60 seconds, and leaves its run to the queue (no
  `runFinish`). The watchdog leaves an agent job's CAPTCHA wait to the agent and
  drops a step stuck for 10 minutes with a `stalled` ledger row. `agentJobState`
  and `agentClearJob` let the agent watch and stop it.
- **Applications on the portal** (S-22): after DRC-03 the notices bundle reads the
  portal's "My Applications" types — appeals (APL-01), rectification, objections
  to a provisional attachment, the s.128A waiver, compounding, provisional
  assessment — with the same case search (codes from the portal's public
  casesearchctrl.js) and saves them through `sync_ingest_applications`.
- **Registration status** (S-22): the bundle ends with the taxpayer profile
  (status Active / Cancelled / Suspended, cancellation date, the raw profile); the
  certificate PDF is left to "Fetch Company".
- **GSTR-3A** (S-31): the return type and period from the portal's summary are kept
  on the notice (`sync_notice_details`), which closes itself once Filing Status
  shows that return filed; the rebuilt PDF now says it is rebuilt.
- **Popup:** when the office agent is online and the autopilot is on, "Send to the
  office agent" queues the same clients on it (their CAPTCHAs go to the app's
  CAPTCHA wall) instead of syncing in this browser.

## 2026-10-06 — Toolbar popup rebuilt as a portal autopilot (v0.5.1)

Phase 2 of the notices roadmap (audit findings U-110, U-111). Popup only; the sync
itself is unchanged.

- **Status first.** The popup shows the last run, clients synced in the last 24 h
  (n of N) and failing clients with their reasons, counted exactly like the app's
  command centre (eligible = credentials, active, not excluded; failed = login failed
  since the last notices success, or the notices step failed).
- **Sync notices** defaults to the stale or failed clients, with "All active clients"
  and a searchable one-client picker; a summary line gives clients, CAPTCHAs and an
  estimate (~2.5 min a client) before an explicit Start. It starts the same
  `notices_bundle` job as the app's Sync now (notices & orders, then refunds, then
  DRC-03).
- **Running job.** "Client 4 of 11 · name · step" from the active job, a "CAPTCHA
  waiting → Open the portal tab" prompt at login, and Stop (only while a job runs),
  which still records the stop in the run ledger and says what was stopped.
- **Open Notices dashboard** link; the old return-period ledger pull moved under
  "Other syncs" with an accurate description (it does not write filing status).
- **Errors in the popup.** If the background worker or the database does not
  answer, an error panel (Retry, reload link, raw message) replaces the form after
  one automatic retry, and the last known status stays visible. No alert()/confirm().
- Version shown in the header, with a warning below the app's minimum (0.4.0).
- `db.js`: added `startSectionPull`, `getSyncStatus`, `getLastRun` (read-only REST
  for the popup, which now loads `config.js`).

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
