# GST Keeper — Portal Sync: Changelog

Notable changes to the browser extension (`extension/`). Newest first.

## 2026-10-25 — Table 8A: wait for the portal's file (v0.18.1)

- Seen live on 25 Oct 2026 (TAMNNA INFRASTRUCTURE, FY 2025-26): the portal takes "Download Table 8A document details" as a generation request and prepares the file later, and 0.18.0 stopped there. Now the job stays on that client and year until the file comes: it waits on the page (a download link or the file may still come), and every 4 minutes opens the GSTR-9 again and presses the button again, for up to an hour. The banner says how long it has waited and when it asks next. Only then does it move on (to the next year or client), recording `REQUESTED: … asked N time(s) over M min` if the file never came.
- A press that brings nothing at all for 45 seconds (no file, no link, no words) is treated the same way: the portal is preparing it.
- The page's standing note ("please re-download the Table 8A document …") is no longer taken for the portal's answer: only words that appear after the press count.
- The job keeps itself alive for the watchdog while it waits. Nothing else changes; every other job runs as in 0.17.0.
- Test `test/19-gstr9-8a-pull.test.mjs` (request accepted, asked again, the file on the second ask, an hour with no file).

## 2026-10-24 — GSTR-9 Table 8A document details (v0.18.0)

- **A new pull, `gstr9_8a_pull`**, for the 8A reports' Pull (GSTR-2A vs GSTR-8A, GSTR-2B vs GSTR-8A, GSTR-8A vs GSTR-2A vs GSTR-2B). For the year ending the job's March (`03/YYYY`) it opens the GSTR-9 on the Annual Return page the way the GSTR-9 pull does (FY, SEARCH, PREPARE-ONLINE, or VIEW for a filed year; the NIL question answered No and NEXT pressed; nothing saved, computed or filed on the portal), presses "Download Table 8A document details" on the GSTR-9 dashboard and saves what the portal hands back, as it came, as `GSTR9_8A` for `03/YYYY` (summary `gstk-8a-pull-v1`, status `Pulled`): the file (an Excel or a ZIP) from the page's own Blob or from the browser's download, and any JSON with documents the page loads. GST Keeper reads the file with its Upload 8A reader.
- When the portal answers in words: `REQUESTED: …` (it prepares the file for later; Pull again), `NO DATA: …` (saved as an empty 8A), else `PULL FAILED: …` naming what the page showed (the buttons, what was pressed, the portal's words). A failure writes the status only, so an 8A saved earlier still counts.
- **Nothing else changes.** Every other job, the GSTR-9 pull (`gstr9_pull`) included, runs as in 0.17.0; the new job only reads the GSTR-9 pull's page helpers. The background keeps a downloaded 8A file only for this job, only from `gst.gov.in`, only an Excel, a ZIP or a JSON.
- Not seen live on the portal when written: the first run's status says what the page did.
- GST Keeper asks for 0.18.0 only for the 8A pull; the minimum stays 0.16.0 and the recommended version 0.17.0.
- Test `test/19-gstr9-8a-pull.test.mjs`; `test/17-actor-headers.test.mjs` now expects 0.18.0.

## 2026-10-21 — Who did it, for the change log (v0.17.0)

- Every request to the database (`/rest/v1`, tables and RPCs) now says it comes from the extension (`x-gst-source: extension`) and carries a request id (`x-gst-request`). While a job the app started is running, it also names the app user who started it (`x-gst-actor`, the job's `actorId`, the same id the app sends). A scheduled sync names no one. The database's change log (`gst_change_log`, migration `20261021150000_gst_change_log.sql`) records these with every row the extension writes, so a pull shows as "Extension, for Gita" in Change history.
- Every job the app starts keeps the user's `actorId` from the app's message: the ledger pull (`startLedgerPull`), the return pull (`startReturnPull`), the 2B and 2A pulls, the filing page (`startFilingOpen`), the section and all-clients pulls, as the GSTR-1 upload, the e-invoice pull and the GSTR-3B push already did. An office-agent job (`startAgentJob`) keeps the person who queued it. `appbridge.js` passes the messages on unchanged.
- The scheduled Chrome runner (`runner.js`, the live runner) keeps the person who queued a job too (`portal_jobs.requested_by`, from `portal_job_claim`), so a pull queued from the app names them; a scheduled job names no one. Test `test/18-runner-actor.test.mjs`.
- Uploads to Storage (return PDFs) are unchanged: another API, not logged there.
- Nothing else changes. An older extension still works; its writes are logged with no person unless they write a saved-by field themselves.
- **One release, 0.17.0, carries 0.16.0 and 0.15.0 below** (the reco pull and GSTR-3B push gate, the filed-return pull for Filing Status), none of which was released on its own: the three were merged on 21 Oct 2026. GST Keeper requires 0.16.0 or later (`MIN_EXTENSION_VERSION`) and recommends 0.17.0. Migrations `20261021110000`, `20261021120000` and `20261021150000` must be live first.
- Test `test/17-actor-headers.test.mjs`.

## 2026-10-21 — Reco pulls through the database, GSTR-3B push gate (v0.16.0)

The firm's decisions of 21 Oct 2026: from the Jun-2026 period Suspended Reco and GST Receivable Reco come only from the portal pull, for every client (Nil returns too), and a GSTR-3B is pushed only when both are pulled and show no difference. Migration `20261021120000_reco_pull_push_gate.sql` must be live first.

- **The pull saves through `reco_record_pull`.** The credit ledger (opening, ITC utilised, DRC-03) and the reversal ledger (opening) go through one database function, which stamps the time, who asked and this version. It clears the CSV stamps, closes an open manual allowance for the month, and keeps an override made against the same portal figure (one made against another figure is cleared). A direct write to `suspended_reco` / `gst_receivable_reco` (the old `upsertReco`, removed) is refused by the database from 06/2026.
- **This client's page only.** Before either ledger is read or saved, the page header's GSTIN must be the job's client's, as the push already checks (`headerShowsOther`). Another client's GSTIN there (someone logged another client in, in this Chrome) stops the job with nothing saved: "…so nothing was saved for this client. … pull again." A header with no GSTIN shown cannot be checked and the pull goes on, as before.
- **Who pulled.** The reco pages send the signed-in user's id with `__gstkPullLedgers` (`actorId`); it rides on the job and is saved as `opening_portal_pulled_by`. The database refuses a pull without a staff member, so the popup's full sync (no app user) reads the two ledgers but does not save them, and says so on the banner.
- **A month with no reversal balance.** When the reversal statement loads for the month, shows no balance row, and the page says there are no records, the pull saves 0 and marks it "no balance on the portal" (`p_no_rows`). A Nil client then passes by pulling, with no manual allowance. Without such words on the page nothing is saved, as before. The portal's exact wording for an empty month is not confirmed live: check one Nil client (the diagnostic box shows what was read).
- **ITC utilised.** With ledger rows read and no "other than reverse charge" set-off debit among them, ITC utilised is saved as 0 (the portal's figure). It stays empty only when no ledger row was read. GST Keeper no longer replaces a pulled empty figure with its GSTR-1 estimate.
- A save the database refuses shows in red on the banner ("read, but NOT saved: …") and the job moves on.
- **The GSTR-3B push asks the gate first.** `startGstr3bPush` calls `gstr3b_push_gate` for the client and period before it opens the portal, whatever the page decided. A "no", an error or no answer stops it there with the reasons ("GSTR-3B push stopped: …"), and nothing is recorded. The check that let it start is saved with the Push History row (`gate`), when the database has that column.
- The app needs v0.16.0: it asks for it before a reco Pull or a GSTR-3B push, and `MIN_EXTENSION_VERSION` is 0.16.0.
- **0.16.0 also carries 0.15.0 below** (the filed-return pull for Filing Status). Neither was released on its own: both go out inside 0.17.0 (above). Migrations `20261021110000` and `20261021120000` must both be live first.
- Older copies of the extension push without asking the gate. The database now records the check itself on every Push History row, and such a push, when the check does not pass, is recorded but does not mark the return Pushed (migration 20261021120000).
- Test `test/16-reco-pull-gate.test.mjs` covers the gate before a push, the pull's save (with its user, or not at all), the empty month, the ITC utilised rule and the header check before a pull saves.

## 2026-10-21 — Filed returns pulled for Filing Status, checked (v0.15.0)

The firm's decision: Filing Status is pulled from the portal only (GST Keeper migration
`20261021110000`, `docs/FILING_STATUS_PULL_ONLY.md`). Released inside 0.17.0 (above); GST Keeper requires 0.16.0 or later.

- **The stored PDF is the filed return and shows its ARN** (`filedpdf.js`, a new content script).
  The portal's PDFs keep their words behind Identity-H fonts; the checker reads them through each
  font's ToUnicode map and refuses the GSTR-3B "System generated summary" (26 of 191 pulled
  GSTR-3B PDFs before), a GSTR-1A or the GSTR-1 + GSTR-1A consolidated summary for a GSTR-1, a
  return of another kind, and a PDF that does not print the ARN. Every PDF the click produces is
  checked, so a summary that comes first is passed over. Nothing certain: no PDF is stored and
  the reason is recorded with the ARN. The red "SYSTEM GENERATED" button is never clicked.
- **Exact return type.** The Return Type option and the e-Filed Returns row must be exactly the
  return asked for (0.14.0 took any type starting with "GSTR1": SBL-UK 09/2026 got its GSTR-1A
  ARN on the GSTR-1 row), and the row must be the year and month asked for. A GSTR-1A seen is
  saved as its own `gst_filed_returns` record (`GSTR1A`) and logged, never on the GSTR-1 row.
- **ARN and filing date from the portal**: the form details (`api/formdetails`), else the row's
  date (slashes or dashes, with or without a time), else the PDF's "Date of ARN". Never the day
  of the pull (13 rows had it), and the two ARNs must agree.
- **One door, and the answer is shown.** `markFiled` and `upsertFilingStatus` are gone; a pull is
  recorded through `filing_record_pull`, which answers filed / refreshed / conflict / refused: the
  same ARN refreshes, a different ARN changes nothing and goes to the superadmin. The banner shows
  the answer, and the job's end says what each return came to.
- **One return, a client's returns, or every return in view**: `startReturnPull` takes
  `items` (one login per client), `actorId` (who asked) and `requestId`. A client without a saved
  login is reported at once. Each outcome goes to the page (`gstk_return_pull_progress` →
  `__gstkReturnPullProgress`) and the whole pull at the end (`gstk_return_pull_result` →
  `__gstkReturnPullDone`, returns not reached included, also when the tab is closed); outcomes
  that wrote nothing are logged through `filing_pull_report`.
- **Returns not reached are logged in GST Keeper too** (review round 1): a client whose login was
  refused or whose session kept dropping, and every return left when the portal tab is closed,
  are reported `failed` ("Not pulled. ...") with the request id, so Filing Status shows why after
  a reload. A download that navigated instead of saving keeps the ARN and date already read.
- **A new file for every pull** (review round 1): a checked PDF is stored as
  `<client>/<MM-YYYY>/<type>-<ARN>-<pull time>.pdf` and uploaded without overwrite
  (`uploadPdf(path, dataUrl, { upsert: false })`; every other upload keeps overwriting), so no
  older copy can put another file under a checked one's name, and a refresh of the same ARN gives
  a new address the log keeps next to the old one.
- **One pull at a time, and none dropped silently** (review round 2): a second `startReturnPull`
  while one runs is refused with words the page shows; a pull that ends early (idle 10 minutes,
  3 hours, its tab gone, Stop in the popup, or another start taking the job slot) reports every
  return it did not reach through `filing_pull_report` (`failed`, `not_reached`, "Not pulled:
  <why>.") and to the page (`gstk_return_pull_result.ended`). The background watchdog now ends an
  idle filed-return pull even when no portal page loads (`endReturnPull`, `endedReturnPull`).
- **The page follows the pull, not a clock** (review round 3): Filing Status asks every 30 s
  whether the pull it started is still running (`__gstkReturnPullAsk { requestId }` → background
  `returnPullStatus` → `__gstkReturnPullAlive { requestId, live, running, done, total }`), and
  keeps waiting while the answer is yes, however many clients a bulk pull has. A pull past the
  idle or 3-hour limit is ended and reported before the answer, so "running" is never said of a
  pull that is over. The page gave up 15 minutes after the start before.
- Tests: `test/16-filed-return-pull.test.mjs`, fixtures `test/fixtures/*.pdf` (fictional, made by
  `test/_pdffixture.mjs` the way the portal's pdfmake makes them).

## 2026-10-15 — GSTR-2A credit and debit notes (v0.14.0)

- The GSTR-2A pull also reads the credit and debit notes (CDN), after the B2B invoices, so the 2A vs 2B report can match the 2B's CDNR documents. Before, they were all "Not compared" (521 of 3,169 documents in one real client's year).
- **Not confirmed live.** The portal's 2A web API is taken to follow the GSTN 2A JSON (section CDN, notes under `cdn` with `nt` arrays), so each name is tried in turn:
  - the supplier list: `api/gstr2a/ctin?rtn_prd=MMYYYY&section_name=CDN`, then `section_name=CDNR` when CDN gave no list (an HTTP error, not JSON, or no `cpty` array);
  - the notes per supplier: `api/gstr2a/cdn?rtn_prd=MMYYYY&ctin=<gstin>`. When the first supplier's call answers 400 or 404, `api/gstr2a/cdnr` is tried once and whichever works is kept for the rest. Notes are accepted under `cdn` or `cdnr`.
- Saved like the invoices: `summary.cdn` holds one wrapper per supplier (`{ ...portal fields, ctin, trdnm from the list, supfildt: fldtr1, nt }`). `_meta` gains `sections: ['b2b', 'cdn']`, `noteCounterparties`, `cdnFailed`, `cdnFailedCtins`, and the names that worked (`cdnList`, `cdnApi`). An empty list, or a "no data" answer, is a read: that month has no notes.
- **When the notes cannot be read** (no supplier list under either name, every supplier's notes failing, or any error in the notes read): `summary.cdn` is not saved, `_meta.sections` is `['b2b']` and `_meta.cdnProblem` says why. GST Keeper then keeps the 2B's notes "Not compared" with that reason, instead of calling them "Only in 2B". The invoices are saved exactly as before in every case; one save holds both.
- A month with no B2B suppliers is no longer saved before the notes are read: it is `Pulled` when it has notes, `NO DATA / NOT FOUND` when it has neither.
- The banner shows "Reading GSTR-2A credit/debit notes …" while they are read, and after the save the note count (or "notes not read: <reason>").
- Test `test/15-gstr2a-cdn.test.mjs` covers the fallbacks and failures.

## 2026-10-15 — GSTR-2A and GSTR-2B pulled together for the 2A vs 2B report (v0.13.0)

- New mode `gstr2a2b_pull`, started by Pull on the Reports Hub's **GSTR-2A vs GSTR-2B Reconciliation**. One login; for each period the job carries `want` (for example `{ "07/2026": ["2A", "2B"], "08/2026": ["2B"] }`) and fetches only that. A period not listed gets both.
- After a month's 2A (saved, no data or failed), the job opens the returns dashboard for that month's 2B when it is wanted, otherwise it moves to the next period.
- **Fix: a GSTR-2B pull over several months stopped after the first.** `advance()` kept the step `gstr2b_pull`, so the next month started on the returns host and the job was cleared. The next month now starts from the dashboard tile again (`gstr2b_pull_dash`).
- A month with no GSTR-2B tile (not generated: a quarterly taxpayer's first two months, or the previous GSTR-3B not filed) is recorded as `NOT GENERATED / NOT FOUND (no GSTR-2B tile)`, status only, and the queue moves on. Before, it ended the whole job.
- The 2A pull keeps every field the portal sends on each supplier (`cfs`, `cfs3b`, `flprdr1`, `dtcancel` among them) and records `summary._meta = { counterparties, failed, failedCtins }`. Readers of `b2b` are unaffected.
- A 2A supplier list the portal does not give (not HTTP 200, not JSON, or an error answer without `cpty` that does not say there is no data) is recorded as `PULL FAILED: GSTR-2A supplier list unavailable (…)`, status only, with the portal's own code and words, so the 2A saved earlier is kept. Before, it was saved as an empty 2A, which made every 2B document look "only in 2B". A month the portal says has no data ("No Data Found", "No Invoices / No document found for the provided Inputs" and the like), or a plain success answer without a list (`{}`, `{ status: 1 }`), is still saved as `NO DATA / NOT FOUND` with an empty `b2b`. The live wording for an empty month has not been seen; a failed status shows it.
- `background.js` passes `want` into the job.
- Test `test/14-gstr2a2b-pull.test.mjs` covers these.

## 2026-10-15 — Unfiled GSTR-9 driven from the portal's own pages (v0.12.0)

- Written against the two portal pages the firm saved (Amber Gum 2025-26).
- **Questions page** (`form name="questionPage"`): "Do you want to file a Nil return?" is the radio pair `#nilyes` / `#nilno` (`name="nil"`, value Y / N). NEXT is the form's submit button, disabled until the answer is set. The extension clicks `#nilno` (its label if that did not take) and presses NEXT once it is active.
- 0.11.6 looked for any "NIL" text on any page. It could spend its three tries on the Annual Return page before the questions page loaded.
- **Dashboard** (`/returns2/auth/gstr9/dashboard`): its tiles read "₹-" until the portal has computed the year. The extension presses **Download GSTR-9 System computed summary (PDF)** (`getPdfData_gstr9_System()`). It then keeps asking `details/calc` and the tables (`getDetails`) for up to about 4 minutes, until Table 4 or Table 6 has figures.
- An unfiled year now goes straight to PREPARE-ONLINE. The Annual Return tile has no system-computed button.
- The row says how far it got: Prepare Online, the Nil question (with the radio's and NEXT's state), the dashboard and the summary button.
- Tested on the saved pages:
  - No is chosen and NEXT is pressed once active;
  - a disabled NEXT is reported, not pressed;
  - the dashboard and its summary button are found.

## 2026-10-15 — GSTR-9 pull no longer stops at the NIL question (v0.11.8)

- 0.11.7 stopped at the NIL question with "Cannot access 'g9NilSeen' before initialization" (Amber Gum). It never chose No. The cause was the same as in 0.11.0: a top-level `let` placed after the job runner.
- The value now lives on the function itself.
- New test `test/13-no-late-bindings.test.mjs` fails on any top-level `const` / `let` / `class` after the job dispatch. It catches this bug in 0.11.7.

## 2026-10-15 — NIL answer registers, NEXT pressed when active (v0.11.7)

- Amber Gum 2025-26: 0.11.6 chose No on the NIL question, but the GSTR-9 form never opened: the page loaded nothing after it. NEXT was most likely still disabled, because the page had not registered the choice.
- The portal answered every table with "No Records found for the provided inputs" (RT-9AS-1002), which is what an unopened form gives.
- Now the No input itself is clicked (its label only if that did not take), with input and change fired. NEXT is pressed only once it is active, and the step is retried for up to about a minute.
- The row says whether NEXT was pressed or never became active, and keeps the question's HTML (`_nil`), so a different page can be handled from what was seen.

## 2026-10-15 — Placeholder tables are not figures (v0.11.6)

- Amber Gum 2025-26 (unfiled): the form had never been opened, so `getDetails` answered Table 5 with a placeholder (`procRecord5`, all nil) and Tables 4 and 6 not at all. 0.11.5 counted any Table 5 as figures fetched, saved that and stopped.
- Figures now count as fetched only when Table 4 or Table 6 has content; a placeholder or a bare checksum does not count. Otherwise the pull goes on to Prepare Online (NIL question answered No, NEXT) and asks again.

## 2026-10-14 — GSTR-9 tables read straight from the form (v0.11.5)

- The kept answers (0.11.3) show how the GSTR-9 form loads a table: `api/gstr9/getDetails?gstin=…&ret_period=…&sec_name=TABLE7`, in the same layout as `details/calc`.
- The extension now asks for each table itself:
  - TABLE6 and TABLE7 of a filed return;
  - TABLE4, 5, 6, 8 and 9 of a year whose `details/calc` came back with Table 8A only (an unfiled year, Accurate PMS 2025-26). These are saved as its system-computed figures (`_from: getDetails`). It asks again after Prepare Online has opened the form.
- 0.11.4 did not find the NIL question on Accurate PMS's page. It is now looked for more widely: any visible text with "NIL", then a No radio (often hidden behind its label) or a No button. Then NEXT.
- An unfiled year never gets a `GSTR9_FILED` row.

## 2026-10-14 — Unfiled GSTR-9: NIL question answered No (v0.11.4)

- 0.11.3 pressed PREPARE-ONLINE for an unfiled year (Accurate PMS 2025-26), and the portal then asked "Do you want to file NIL return?". The pull waited there, so the system-computed Tables 4 to 6 never loaded.
- The extension now answers **No** and presses **NEXT**, as the firm decided: its clients' returns are never NIL. No only opens the GSTR-9 form with its figures; nothing is filed.
- The row's status says whether the question was found and answered.

## 2026-10-14 — Filed GSTR-9 rows from getDetails (v0.11.3)

- 0.11.2's run on Bapa Sitaram showed what the portal's GSTR-9 view loads: `api/gstr9/summary` (each table's total), `api/gstr/questions/get`, `api/gstr9/details/calc` and **`api/gstr9/getDetails`**. The rows of Tables 6 and 7 are in `getDetails`.
- 0.11.2 dropped `getDetails` because its answer names no return period. An answer without one is now taken when it was loaded during that year's visit. Tables are looked for anywhere in an answer, not only at its top.
- For a filed year the extension also asks `getDetails` directly before opening the page.
- The page's own answers are kept with the row (`_captures`), so a new shape can be read without another pull.
- The unfiled year's button is `PREPARE-ONLINE` (with a hyphen); 0.11.2 looked for `PREPARE ONLINE` and pressed nothing.

## 2026-10-14 — Table 7 rows of the filed GSTR-9 (v0.11.2)

- 0.11.1 reached the filed GSTR-9 (Bapa Sitaram 2022-23 to 2024-25). The page it opens gives each table's **total** only: Table 6 as one amount, Table 7 as one amount (7I). 0.11.1 took that total for Table 7's rows and stopped there.
- Now a total is kept as `table6Total` / `table7Total`, and the extension opens the **Table 7 tile** (up to three tries) for its rows (7A to 7H).
- Every GSTR-9 row records what the pull did: the button pressed (or the buttons it saw), the Table 7 tile, whether Prepare Online was tried, and the GSTR-9 addresses the page loaded (`_read` in the filed summary; the status of an unfiled year).

## 2026-10-14 — GSTR-9 pull runs (v0.11.1)

- 0.11.0's GSTR-9 pull stopped at once with "Cannot access 'btnText' / 'g9HasCalc' before initialization" (logged for Bapa Sitaram and Accurate PMS). Its helpers were `const`s further down the script than the job runner, so they were not set yet when the job ran. They are now function declarations; nothing else changes.

## 2026-10-14 — GSTR-9 read from the portal's own Annual Return page (v0.11.0)

No database change.

- A GSTR-9 pull now goes straight to the **Annual Return** page. It used to open the Returns dashboard, which shows the current FY's return filing (2026-27).
- There it selects the year, presses SEARCH and opens the GSTR-9:
  - **VIEW** for a filed return;
  - the **system-computed summary** for an unfiled one, then **Prepare Online** if the portal still has not computed Tables 4 to 6. A NIL question the portal asks first is left to the person; it is saved on the portal.
- `inject.js` keeps a copy of every GSTR-9 JSON the page itself loads. **Table 7 of the filed return** comes from there: from the summary, or from the Table 7 tile when the summary lacks it. The address 0.10.3 guessed (`/returns2/auth/api/gstr9/details`) was refused by the portal ("Request Rejected") and is no longer called.
- When Table 7 still is not loaded, the `GSTR9_FILED` row says which GSTR-9 addresses the page did load, so the read can be fixed from that.
- Read-only, as before: no save, submit, compute or file is pressed.

## 2026-10-13 — Says why the filed GSTR-9 could not be read (v0.10.4)

- When the filed-GSTR-9 read gets no data, the extension now records a `GSTR9_FILED` row with `PULL FAILED: <what the portal answered>`. A good earlier copy keeps its figures.
- The first live fetch (Bapa Sitaram, 13 October) returned only the system-computed figures. The app now fills past years from those figures, or from the filed GSTR-3Bs, until the filed-return read is fixed.

## 2026-10-13 — Reads the filed GSTR-9 (v0.10.3)

No database change; the rows go into `gst_filed_returns` as `GSTR9_FILED`.

- A GSTR-9 pull now reads two things for each financial year:
  - the portal's system-computed figures, as before (`GSTR9_CALC`);
  - **the return as filed**, which is new (`GSTR9_FILED`).
- The filed return is read from `/returns2/auth/api/gstr9/details`, the details the portal's own GSTR-9 form loads. That endpoint has not yet been checked against a live portal session.
- It carries:
  - Table 6: ITC availed, by type (inputs, capital goods, input services);
  - Table 7: the reversals, including those under Rules 42 and 43.
- Builder › ITC Reversal fills each past year from it, so nobody types in past years' ITC.
- Only GET requests, as before. If one of the two reads fails, the other is still saved.

## 2026-10-12 — 0.9.1 and 0.10.x together (v0.10.2)

No database change beyond 0.10.1's.

- One build with everything since 0.9.0. It has 0.9.1's review fixes to the e-invoice pull, which shipped from their own branch on 10 October. It also has 0.10.0's fresh-only sync and 0.10.1's inactive clients. Install this one in place of 0.9.1, 0.10.0 or 0.10.1.
- The version goes up to 0.10.2, not 0.9.2. Chrome compares versions number by number, so 0.10 comes after 0.9 (10 is more than 9), and this build carries more than 0.9.1.

## 2026-10-12 — Inactive clients are synced for notices (v0.10.1)

Needs migration 20261014110000 (applied).

- **Why.** A client marked inactive (Edit Client) may still get notices on the portal, yet Sync All left it out, so it showed as never synced.
- **Now.** Sync All and the popup's eligible list keep inactive clients for the notices sync. Only clients the firm does not handle (Notices · Settings, so `notices_sync_excluded`) are left out, along with clients with a password issue (as before). Returns pulls are unchanged.

## 2026-10-12 — Fresh only: a sync fetches what is new, not the old notices again (v0.10.0)

No database or app change needed.

- **Why.** Every run fetched far more than was new. It re-read the folder of every open case. It retried old notices whose PDF the portal never gave, which is hundreds of calls for a client with many GSTR-3A notices. It also did a full pass every week. A sync of every client took far longer than it needed.
- **Now.** The notices list is still read in one call, and every notice is still saved, so the counts stay right. What the run *fetches* is only what is fresh:
  - **Notice PDFs.** A notice's PDF is fetched only when the notice is new. An old notice still missing its PDF is tried by the gap fill at most once a week.
  - **Case folders.** A case's folder is fetched only when the case is new, when a notice or task in it is new or changed status on the portal, or when the gap fill is due.
  - **Open cases.** An open case with nothing new is checked once a week (`OPEN_CASE_RECHECK_MS`), not on every run. The time of each check is kept per case in `gstk_case_checked_<client>`.
  - **Full pass.** A client's full pass is every 30 days instead of 7, so a silent change in an old case is still caught.
  - **Stored files.** PDFs and attachments already stored are never downloaded again (as before).
- **Fallback.** If the stored notices cannot be read (the database is unreachable), every notice counts as fresh: the old, full behaviour.
- **Debug panel.** It shows "fresh only: N new or changed notice(s); M old notice PDF(s) not fetched again", and how many open cases were on the weekly check.
- **Tests.** `test/12-fresh-only.test.mjs`. `04-stored-pdf-e2e` now gives the stored notices' status, as the background does.

## 2026-10-10 — Review fixes to the e-invoice pull (v0.9.1)

Needs the GSTR-1 page update shipped with it. No database change.

- **Wording.** The message no longer says "so none is on the portal as an
  e-invoice": it says what the GSTR-1 file holds ("none of them carries an
  IRN") and, with the month's e-invoice details imported, how many e-invoices
  they list and how many have no IRN in the file.
- **The import is checked by the database's clock.** The pull reads the
  month's e-invoice Excel row before pressing the portal's button and waits
  for it to change (0.9.0 compared the PC's clock with the database's). One
  that lands after the pull stops waiting is found when the pull ends.
- **A closed tab or a failed pull after the import** says the import was made;
  "Nothing was saved" is then about the GSTR-1 file only.
- **The download hook** takes only a workbook or ZIP from a gst.gov.in address
  opened from return.gst.gov.in.
- **The comparison** reads the month's e-invoice records in pages of 1,000.
- **GSTR-1 page:** shows the pull's whole message for an ok or none pull, warns
  when the e-invoice details were not taken or not imported, never saves a
  downloaded file from which no e-invoice was read (the earlier import stays),
  and accepts the file only from its own window.

## 2026-10-10 — E-invoice pull opens the month's GSTR-1 and takes its e-invoice details (v0.9.0)

Needs the GSTR-1 page update that imports the file (`__gstkEinvoiceExcel`).
No database change.

- **Why.** Staff could not accept "no document carries an IRN" without the
  month's GSTR-1 opened, and still had to download the e-invoice details
  (Excel) from it and import them by hand.
- **Now.** After login the pull goes to the returns dashboard, chooses the
  financial year, quarter and month of the pull, presses Search and opens
  GSTR-1 (Prepare Online) for that month. There it presses the portal's own
  "Download details from e-invoices (Excel)" and takes the file the portal
  gives (a Blob the page builds, via inject.js, or a direct download the
  background re-fetches), and hands it to GST Keeper's GSTR-1 page, which
  imports it for the pull's client and month as if it had been chosen by hand
  (its time recorded in `einvoice_pulls`, source `einvoice_excel`). The pull
  waits up to 45 seconds for that import, then reads the GSTR-1 file as
  before. Its message starts with what it did: "Opened GSTR-1 for September
  2026 on the portal and downloaded its e-invoice details (Excel); GST Keeper
  imported 55 e-invoices from them at 19:36 IST." and then gives the file's
  counts and the comparison with the e-invoices just imported.
- **Never in the way.** A dashboard that does not load, a month without a
  Prepare Online button, no download button, no file within a minute, a file
  that is not a workbook, or no GST Keeper page to import it: each is said in
  the message ("Could not take the e-invoice details from the portal: …") and
  the pull goes on to the GSTR-1 file.
- More than 500 e-invoices: the portal prepares those under "E-invoice
  download history"; the message says what the portal answered, and the ZIP
  is imported by hand as before.

## 2026-10-10 — E-invoice pull says exactly what it read (v0.8.9)

No database change. The GSTR-1 page shows the new message on the panel.

- **Why.** For TAMNNA INFRASTRUCTURE (Sep-26) the pull said "No document in
  the portal's GSTR-1 for this period carries an IRN", which read as "there
  are no e-invoices", while the e-invoice Excel listed 2, auto-populated on
  01-10-2026. Both were true: two uploads that day (17:51 and 17:57 IST, before
  the client was marked an e-invoice client) had replaced them on GSTR-1, so
  the portal no longer showed their IRN. The message did not say that.
- **Now.** The pull's message gives the period, the date the portal generated
  the file, how many documents it holds per table (B2B, CDNR, CDNUR, Exports)
  and how many carry an IRN. When an e-invoice Excel was imported for the
  month it adds how many of the Excel's e-invoices GSTR-1 holds with their IRN,
  and that the rest were replaced by an upload or are not auto-populated yet.
  For example: "The portal's GSTR-1 for 09/2026 (file generated 10-10-2026)
  holds 2 documents (B2B 2); none carries an IRN, so none is on the portal as
  an e-invoice. The e-invoice Excel imported for this month lists 2
  e-invoices: 2 are not on GSTR-1 with an IRN (an upload replaced them, or
  auto-population has not run yet)."

## 2026-10-10 — Never inside another client's session; impossible passwords; e-invoice pull waits (v0.8.8)

No database or page change is needed for the extension; the GSTR-1 page's
e-invoice pull watchdog is raised to 30 minutes to match the longer wait.

- **Why.** On 10 Oct 2026 MAHIL INFRA's GSTR-1 push could not go through and
  ran with BAPA SITARAM's login. MAHIL's saved portal password was 17
  characters; the portal takes 8 to 15, so its form was never sent, the portal
  said nothing, and 0.8.7 logged "CAPTCHA not accepted". Staff then logged in
  by hand, Chrome offered BAPA's saved login (or BAPA's session from an earlier
  job was still open), and the push went on in BAPA's session: nothing checked
  whose session a job was in.
- **Whose session.** Every job that reaches a logged-in page at its login step
  reads the session's GSTIN (`profile/detail` on services.gst.gov.in, the
  header on other portal pages) before doing anything for the client. Another
  taxpayer's session is logged out and the client logged in again, twice at
  most; then the job stops: "The GST portal keeps logging in as …". A push
  whose session cannot be read is stopped with nothing sent; a pull goes on as
  before. The GSTR-1 and GSTR-3B dashboards, and the NIL step just before it
  ticks "File Nil", stop a push when the header shows another GSTIN.
- **The form.** Just before the automatic Login press the user ID and
  password are set again if anything (Chrome's password manager, another
  extension) changed them since they were filled.
- **Impossible passwords.** A saved password shorter than 8 or longer than 15
  characters is never typed. The client gets a password issue that says so
  (and that the portal probably kept the first 15 of a longer one), and a push
  fails with the same words. (MAHIL INFRA 17, AMADIUS REALTY 18 on 10 Oct.)
- **E-invoice pull waits.** The portal builds the GSTR-1 file of a period it
  has not generated before in up to 20 minutes; 0.8.7 gave up after about 90
  seconds and staff had to pull again. The pull now asks every 30 seconds for
  up to 22 minutes, with the heartbeat keeping the job alive.
- Tests: `test/11-session-identity.test.mjs` (new), and the wait in
  `test/10-einvoice-keep.test.mjs`.

## 2026-10-10 — E-invoices kept on the portal, not re-sent (v0.8.7)

Needs the GSTR-1 page update that sends the e-invoice plan (with the version
of the return it was made on) and reads `goneMarked` and the `stale` status, and
the migration that adds `doc_type` and `source` to the `einvoice_docs` key,
`einvoice_docs.gone_at`, `source` to the `einvoice_pulls` key,
`einvoice_pulls.generated_on` and `recorded_at`, and `einvoice_kept` / `ext_version` to
`gstr1_upload_versions`. Without the page update a push uploads the stored JSON
whole, with no IRN on it. Without the migration a pull that finds e-invoices
fails and saves none of them, and no pull is recorded in `einvoice_pulls`; a
push still works and its Version History row is written without the two new
columns. Every other pull, the login and the popup are as 0.8.6 runs them.

- **Why.** GSTN's advisory on e-invoices in GSTR-1 (para 6) and its offline
  tool's FAQ say an uploaded document replaces the one the portal filled in
  from the e-invoice, and the portal then deletes its Source, IRN and IRN date.
  0.8.4 to 0.8.6 tried to keep the IRN by writing `irn`, `irngendate` and
  `srctyp` into the uploaded JSON. Nothing GSTN publishes says the portal
  accepts those fields in an upload, it was never tried live, and it wrote
  `srctyp` as "e-Invoice" where the portal writes "E-Invoice". So that is gone:
  the extension never writes an IRN field into an upload.
- **E-invoices are left out of the upload.** The page now sends, with the push,
  the books documents that are already on the portal's GSTR-1 as e-invoices
  with the same figures (`einvoice.keep`: section, buyer GSTIN, document type
  and number, as in the stored JSON). The extension removes exactly those
  documents from the copy it uploads, so the portal keeps its own record, with
  the IRN. A buyer, export or B2CL group left with no document is dropped, and
  so is a section left empty. Everything else goes up as stored: other
  documents, B2CS, NIL, HSN (Table 12) and documents issued (Table 13).
- **Exact numbers only.** A document is matched on its section, buyer GSTIN,
  type (invoice, credit note or debit note) and its number exactly as written,
  ignoring only case and extra spaces. "INV-001" never stands for "INV/001",
  and a credit note and a debit note with the same number are two documents.
- **A plan for another version of the return is refused.** The page sends,
  with the plan, the `gstr1_data.updated_at` it made the plan on
  (`einvoice.basisUpdatedAt`). The extension reads the stored return with its
  `updated_at`, and if the two are not the same instant (the return was edited,
  re-imported or regenerated after the plan) it refuses the push before
  anything else, before the Upload History snapshot is cleared and before a
  portal tab opens: "This return changed after the e-invoice plan was made.
  Reload it and click Upload again." A kept document whose figures changed in
  between would otherwise be left out, and its new figures never sent. Both
  times are the database's, so no PC's clock is involved. A page that sends no
  `basisUpdatedAt` is not checked.
- **What the push says.** The result tells the page how many e-invoices were
  left out (`einvoiceKept`) and how many of the page's entries named no
  document in the stored JSON (`einvoiceKeepUnmatched`; the push still goes
  ahead). `irnAttached` is no longer sent. The Version History row of an upload
  records the count (`einvoice_kept`) and the extension version that pushed
  (`ext_version`); its payload is still the stored books JSON. A database
  without those columns gets the row without them.
- **The e-invoice pull checks whose file it got.** The portal's GSTR-1 JSON
  must carry this client's GSTIN and this period. A portal session still open
  for another client, or a file for another month, ends the pull as failed and
  saves nothing.
- **Only a file generated today counts.** The portal's download API
  (`flag=0`) can hand back a GSTR-1 JSON it generated days ago, which lacks
  every e-invoice auto-populated since. The portal names the file inside the
  ZIP after the day it generated it (`returns_<ddmmyyyy>_R1_<GSTIN>_offline...`),
  and the extension now reads that name. A file generated before today (IST)
  ends the pull as `stale`: no document is saved or marked, and the message
  gives the date and the way to a fresh file (on the portal, GSTR-1 for the
  period, Prepare Offline → Download → Generate JSON file to download, wait
  until it is generated, then pull again). A stale pull is not a successful
  pull, so it does not open the push gate. Every pull records the file's date
  in `einvoice_pulls.generated_on`. A name with no date is taken as today's,
  with a warning in the message. The date is a day, so a file generated
  earlier the same day is not told apart.
- **The pull mirrors the portal's draft, and keeps what left it.** Each
  document is stored once per section, buyer, type and exact number (credit
  and debit notes no longer overwrite each other), with `gone_at` cleared. Once
  every document is saved, the period's stored e-invoices this pull did not see
  are marked gone (`gone_at`), never deleted: the IRN stays on record, and the
  page shows the document as "IRN lost on the portal" (uploaded, with a
  warning) rather than as one that was never e-invoiced, and never plans it as
  kept. Which documents went is decided by identity against this pull's own
  documents and marked by id, so no PC's clock is compared with another's. The
  pull stamps one time on everything: `last_seen_at` of every document it saw,
  `gone_at` of every one it did not, and `einvoice_pulls.pulled_at`. The
  result says how many are no longer on the portal as e-invoices
  (`goneMarked`; `staleRemoved` carries the same number for a page written
  against it) and names its client and period.
- **A pull says while it is saving.** Before it writes its first document,
  the pull records itself in `einvoice_pulls` as status `running` ("Pull in
  progress", `pulled_at` = the pull's time), and its final status (`ok`,
  `none` or `failed`) replaces that after the last write. The page refuses to
  push or download the JSON while a pull is running, and a push reads the
  pull row before and after the documents, and again just before it starts,
  so it never plans on documents half-way through a save (where one pull's
  rows read against another's time could make every e-invoice look lost and
  be re-sent). If `running` cannot be written, nothing is saved or marked and
  the pull is `failed`; a failure part-way through the save ends `failed`,
  never `running`. A file for another client or period, or one generated
  before today, writes no document and goes straight to its final status.
  The database stamps its own time on the row (`recorded_at`).
- **No pull ends without a result, and only one.** The save, the result for
  the page and the job's end are one step of the extension's job slot (as a
  GSTR-3B push's end is since 0.8.6). A portal tab closed while the pull is
  saving waits for the save; the page then hears the save's real outcome, and
  the closed tab writes nothing. A tab closed before the save gives the page a
  failed pull marked `tabClosed`, and the save that follows saves nothing, so
  "Nothing was saved" stays true. A pull left idle for 10 minutes, one whose
  session kept dropping, or one that hit an unexpected error is reported
  failed instead of leaving the button spinning. The portal tab no longer
  writes the result or clears the job itself, unless the extension's
  background worker does not answer at all.

## 2026-10-09 — GSTR-3B pushes recorded by the extension; every push result names its return (v0.8.6)

Pairs with the database trigger on `gstr3b_push_versions` (same release) that marks
the return Pushed in Filing Status from a row with status `ok`. Pulls, notices, the
login and the popup are as 0.8.5 runs them.

- **Every GSTR-3B push is recorded by the extension.** When a push ends (filled,
  partly filled or failed, including every early failure), the background worker
  writes one Push History row (`gstr3b_push_versions`: the job's client and
  period, who pushed, status `ok` / `partial` / `failed`, the summary, the count
  filled, what was skipped and the pushed draft). Up to 0.8.5 only an open GSTR-3B
  page recorded it, against whatever client and month it showed when the result
  arrived; a closed or reloaded page lost the push. The result the page hears now
  says whether that write landed (`recorded`). `mark_filing_pushed` is not called
  for GSTR-3B: the trigger does it.
- **A GSTR-3B push says how complete it was.** The result has `status`: `filled`,
  `partial` or `failed` (`ok` stays true for the first two, for older pages). A
  column the portal locks, the 2nd and 3rd column of an import row (it has no such
  input) and 3.1(a)/(b) that are not on the form are tolerated; 3.1(a)/(b) are
  listed under `portalFilled` ("not typed; the portal keeps the value it filled
  from GSTR-1"). Anything else skipped, or a tile that would not open, is
  `partial`. The skip wording ('— row not found', 'portal-locked', 'no input at
  that position') is unchanged, because the app reads older results by it.
- **Fixed: 0 typed into the cess box of 4A(1) / 4A(2).** Import of goods and
  import of services have two inputs, IGST and CESS; the CGST figure went into the
  second. They now get IGST only.
- **3.1(a) / (b) are looked for harder.** They were "row not found" on every push.
  Their labels now take any spacing, then the row starting "(a)" / "(b)" in the
  open 3.1 form (never a Table 4 row). A row still not found lists the first eight
  row labels the form shows, so the next push tells what the portal calls them.
- **Each GSTR-3B value is read back.** One the portal did not keep is reported as
  "col N — portal kept …" and is not counted as filled. Values are rounded to 2
  decimals before they are typed.
- **Every push result names its return.** GSTR-1 upload, NIL, Refresh errors and
  GSTR-3B results carry the job's `clientId` and `period_month` (`MM/YYYY`), so the
  page can ignore a result for a client or month it no longer shows.
- **No push ends without a result.** A session that kept dropping, an unexpected
  error, a refused login, a push left idle for 10 minutes and a closed portal tab
  now each give the page a failed result. Before, the page spun until reloaded. A
  closed tab's result carries `tabClosed: true` (the outcome is unknown, not a
  failure) and writes nothing to the database, except for a JSON upload whose file
  was already attached: that is saved `failed` with "Portal tab closed during the
  upload; outcome unknown. Use Refresh errors once the portal shows a result.", so
  the GSTR-1 page offers Refresh errors. Every other closed tab says "Check the
  portal and push again" (a Refresh: "click Refresh errors again"). No message
  names Refresh errors where the page would not offer it.
- **Refresh errors records an upload the portal processed, and only one this app
  sent.** It first reads the Upload History's latest row: Processed with no errors
  is saved as `accepted` (the `gstr1_data` trigger then marks it Pushed), Error
  Occurred as `failed` with the portal's reason. Before, Refresh always wrote
  `partial`, so an upload that timed out after 6 minutes could never become
  Pushed. Just before an upload attaches its file it keeps the row then on top
  (`gstk_gstr1_pretop_<row id>`: its cells and the time), until the outcome is
  recorded; each new upload job drops the last one, so a push that died before
  attaching leaves none. Refresh takes the top row as this upload's only when it is
  a different row and, by its date and time (IST), not older than the attach less
  two minutes. Otherwise, while the portal still shows In Progress / In-Progress /
  Pending, and when no error report is ready yet, it writes nothing and gives the
  page `status: 'pending'` ("The portal shows no upload from GST Keeper since this
  push. Upload the JSON again to record it.", "still processing", "no error report
  is ready"), so an older or hand upload on top is never recorded as this push and
  a `failed` upload is never turned into `partial` on no evidence. A Refresh that
  cannot reach the portal leaves the upload's status alone, and one reloaded on the
  upload page reads it again instead of uploading.
- **A finished push never races a closed tab.** A NIL push stores its result and
  clears its job before it shows the green banner and calls `mark_filing_pushed`.
  A GSTR-3B push ends in the background worker's job slot (`finishGstr3bPush`: the
  Push History row, the result with `recorded`, the job cleared), the same slot a
  closed tab is handled in, so a tab closed on seeing the banner can no longer turn
  a ticked NIL into a failure or add a second Push History row with the wrong reason.
- **Fixed: a NIL push stopped at the "File Nil GSTR-1" toggle** with "Cannot
  access 'nilToggleOn' before initialization" (since 0.8.4): its two constants
  were declared below the step dispatcher. They now sit with the other constants.
- **Portal labels are never invoice errors.** "Error report generation requested",
  "Generate error report" and "NA" are no longer stored as error rows.
- **IFF months (QRMP, months 1 and 2 of the quarter).** When the dashboard has no
  GSTR-1 tile, the upload uses the IFF tile with the same Prepare Offline / Upload
  steps. Not yet confirmed against the live portal.

## 2026-10-09 — NIL push recorded in Filing Status (v0.8.5)

- **A NIL GSTR-1 push is recorded by the extension itself**: after ticking
  "File Nil GSTR-1" it calls `mark_filing_pushed`, so Filing Status shows
  Pushed even if the GST Keeper page was closed meanwhile. Nothing else changed.
  (A JSON push is recorded by the database from the upload outcome the extension
  already writes to `gstr1_data` — migration `20261009130000_gstr1_push_recording.sql`.)

## 2026-10-09 — NIL GSTR-1, e-invoice pull, IRNs kept on push (v0.8.4)

Needs migration `20261009100000_gstr1_einvoice_direct_filing.sql` (`einvoice_docs`,
`einvoice_pulls`). Every other pull, the login and the popup are as 0.8.3 runs them.

- **IRNs kept on a GSTR-1 push.** Before uploading the stored JSON, the period's
  e-invoices (`einvoice_docs`) are matched by section, buyer GSTIN and document
  number, and `irn`, `irngendate` and `srctyp: "e-Invoice"` are set on every
  B2B / CDNR / CDNUR / EXP document that has none — figures are never changed
  (plain-JS copy of `attachIrn` in `src/lib/einvoice/einvoice.ts`). The result
  carries `irnAttached`. A failed read of `einvoice_docs` pushes without IRNs.
- **NIL GSTR-1 push** (`__gstkUploadGstr1` with `nil: true`): no stored JSON is
  needed. The extension picks the period, opens GSTR-1 "Prepare Online", ticks
  "File Nil GSTR-1" and confirms; the result is `status: 'nil_marked'`. Filing and
  signing stay manual. The option is found by its text — not yet confirmed
  against the live portal.
- **E-invoice pull** (`__gstkPullEinvoice`): downloads the portal's GSTR-1 JSON
  for the period (the same `offline/download/generate` API as the filed GSTR-1
  JSON pull), keeps every document with an IRN in `einvoice_docs` (upsert, never
  deleted) and records the attempt in `einvoice_pulls` (ok / none / pending /
  failed). The app hears `__gstkEinvoicePullDone`.

## 2026-10-08 — A CAPTCHA failure is not a password issue (v0.8.3)

Pairs with migration `20261010120000_login_captcha_reason.sql` (which also files an
older extension's CAPTCHA failures correctly).

- **Fixed: three rejected CAPTCHAs read as a password failure.** When the portal
  did not accept the CAPTCHA three times ("Enter valid Letters shown."), or gave no
  answer, the client was logged with reason `login_failed`, the class a refused
  password uses, and showed as "Login failed — password changed?". It is now
  logged as `captcha_failed` with the portal's words ("CAPTCHA not accepted 3
  times … The password was not refused"), never recorded as a password issue, and
  a scheduled run retries it instead of failing the client.
- An unexpected page after Login is logged as `portal_error`, not `login_failed`.

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
