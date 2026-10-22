# Filing Status: pulled from the portal only

The firm's decision of 21 Oct 2026, built by migration
`20261021110000_filing_status_pull_only.sql`, extension 0.15.0 and the
Filing Status page.

1. Portal data is **pulled** by the extension, for every client, Nil returns included. The firm
   named "1 & 3B": **GSTR-1 and GSTR-3B (monthly) are pulled only** (round 3, the lead's
   decision). GSTR-1 (IFF), GSTR-3B (Q), GSTR-6 and GSTR-7 can be pulled too, but keep a manual
   route until their pull is proven to work (no pull of theirs has landed yet), as CMP-08 and
   ITC-04, which have no pull.
2. When a pull of a GSTR-1 / GSTR-3B cannot be done (wrong portal password, portal down, no
   access), the **superadmin** may allow one manual upload for one client, period and return,
   with a reason. It is logged and shows as "manual (allowed by X: reason)" wherever the return
   shows. A return on its manual route shows "manual (<why>)".
3. Everything is traceable (`filing_status_log`). Nothing attached by hand is ever taken off a
   row by a pull that brings no checked PDF: it stays, marked "attached by hand, not checked by
   a pull" (round 3).

Read this before changing `FilingStatusPage.tsx`, `src/components/filing/*`,
`src/lib/filingPull.ts`, `src/lib/manualSourceAllowances.ts`, `extension/filedpdf.js` or the
extension's `returnpdf` mode.

## 1. Who writes Filed, the ARN, the filing date and the PDF

| Route | Who | Function | Marked |
|---|---|---|---|
| Portal pull | the extension (0.15.0+), started from Filing Status by a staff member with the Filing status permission (`edit_filing_status`; GST Manager and superadmin always) | `filing_record_pull` | `filed_source = 'portal'` |
| Manual attach, returns pulled only (GSTR-1, GSTR-3B) | a staff member with the Filing status permission, under the superadmin's allowance; never over a return pulled with its checked PDF | `filing_attach_manual` | `manual`, with `manual_allowance_id` |
| Manual attach, the manual route (GSTR-1 (IFF), GSTR-3B (Q), GSTR-6, GSTR-7 until their pull is proven; CMP-08, ITC-04 with no pull) | a staff member with the Filing status permission, no allowance; never over a return pulled with its checked PDF | `filing_attach_manual` | `manual`, with the reason (`filing_manual_reason`) |
| Unlock (GSTR-3B family) | whoever the page offers it to (`canUnlockSheets`): GST Manager, superadmin, or an employee whose position holds `unlock_sheets` | `filing_status_unlock` | keeps everything |
| Take off Filed | superadmin, with a reason | `filing_status_unfile` | clears; the log keeps it; a GSTR-3B row and its month's sheets are unlocked |
| A pull conflict | superadmin | `filing_pull_conflict_decide` | `portal` when accepted |
| Scheme change (inapplicable returns) | the `client_scheme_history` trigger | a filed return is kept and logged as kept (round 2); a locked row holding nothing filed is reset | unchanged |

The trigger `trigger_filing_status_source` refuses every other write that makes a row Filed,
takes it off Filed, or changes `arn`, `filed_date`, `return_pdf_url`, `filed_source`,
`manual_allowance_id`, `pulled_at`, `pdf_note` or `date_note`, for every level (the app sends the acting
user's id; `auth.uid()` is NULL). A row holding a filed return (Filed, or an ARN, filing date,
PDF or source; an unlocked row too) stays on its client, period and return type on every route:
moving one by a PATCH of `client_id`, `period_month` or `return_type` would file another month or
client with its ARN (round 1 of the review moved a Filed August GSTR-3B into September, and
destroyed one by moving it to a throwaway client and deleting that client). It is deleted only by
the cascade of its client's deletion (`pg_trigger_depth() > 1` and the client gone), never by a
DELETE of its own. A move of a row holding nothing filed is still allowed and is logged with
`detail.moved_from`. The routes above set a transaction-local `app.filing_source`, the pattern of
`filing_status_guard_pushed` / `filing_record_push`. Status changes between the working statuses,
remarks, target dates, NIL, locks and the push marker are not touched.

**Pulled only (round 3):** GSTR-1 and GSTR-3B (`filing_pull_only`, `PULL_ONLY_RETURN_TYPES`): the
monthly returns, whose pull landed 454 times (230 GSTR-3B, 224 GSTR-1) before this change. A
manual upload of one needs the superadmin's allowance.
**Manual route, pull offered (round 3):** GSTR-1 (IFF) (an IFF client's every GSTR-1, the
quarter's included), GSTR-3B (Q), GSTR-6 and GSTR-7 (and GSTR-1A, which is not on the sheet). Round
2 had made them pulled only, but no pull of theirs has ever landed (0 PDFs stored by the extension
for any of them; 40 attached by hand in 06 to 09/2026), and the code paths they need (the
Quarterly / QuarterN period choice, the form details for an IFF month, GSTR-6 / 7 row matching)
run for the first time with 0.15.0. So, until a pull is proven for each, any staff member with
the Filing status permission attaches them without an allowance, marked "manual (the portal pull
for GSTR-6 is not proven yet)". Their Pull stays on the row and in Pull filed returns; when it
works it writes them exactly as it writes GSTR-1 / 3B (`portal`, checked PDF). Asking the attach
for GSTR-1 (IFF) / GSTR-3B (Q) never files the client's GSTR-1 / GSTR-3B twin row without the
allowance: the row the PDF lands on decides as well as the type asked for. **The period's return
decides too** (round 4): for a monthly client the period's return is GSTR-1 / GSTR-3B
(`filing_effective_return_type`; `effectiveFilingReturnType` in `src/lib/filingRecords.ts`, the
row the page shows), so its GSTR-1 (IFF) / GSTR-3B (Q) twin row (both GSTR-1 types ticked on the
client, or a row left from an old scheme: 1 live, not Filed) is refused ("For 08/2026 this client
files GSTR-1: attach it on its GSTR-1 row ..."), whatever allowance exists. A twin row that
already holds the ARN (recorded there before 21 Oct 2026) takes the PDF, but only under the
allowance for GSTR-1 / GSTR-3B. The page follows the same rule (`manualRuleType`,
`manualActions`): no paperclip or shield on such a twin row, and the allowance looked up and
given is the one for the period's return. Before round 4 a staff member could file a monthly
GSTR-1 by hand through its IFF row with no allowance, and the GSTR-1 row then showed "Not
applicable". To make one pulled only once its pull has landed Filed with its checked PDF
(`SELECT * FROM public.filing_pulls_landed()`, the migration header's step 7), add it to
`filing_pull_only` and `PULL_ONLY_RETURN_TYPES`. `filing_pulls_landed` counts only pulls (and
accepted conflicts) that left on the row the checked PDF they stored (`detail.stored_pdf_url`,
written after the address check); round 3's query also counted a pull whose PDF address was
refused and never stored (round 4).
**Manual route, no pull:** CMP-08 and ITC-04. The e-Filed Returns pull sets a monthly period,
which is wrong for CMP-08 (quarter) and ITC-04 (half-year), so the page offers no pull for them
(Pull filed returns is disabled on their tabs and says so) and they are attached by hand
("manual (CMP-08 has no portal pull yet)").

## 2. The pull (extension 0.15.0, `returnpdf` mode)

- **One return, a client's returns, or every return in view** (Filing Status: Pull, "all", Pull
  filed returns). One portal login per client; the client's returns one after another.
- **Exact return type.** The Return Type option and the e-Filed Returns row must be exactly the
  return asked for: a GSTR-1A is never taken for a GSTR-1 (0.14.0 took any type starting with
  "GSTR1"). A GSTR-1A seen is kept as its own record (`gst_filed_returns`, `GSTR1A`, shown on
  GSTR-3B Adjustments) and logged (`gstr1a_seen`), never on the GSTR-1 row. The row must also be
  the financial year and month asked for.
- **ARN and filing date from the portal.** The form details (`api/formdetails`, GSTR1 / GSTR3B)
  first, the row's "Date of filing" next (dd/mm/yyyy or dd-mm-yyyy, with or without a time),
  the PDF's "Date of ARN" last. Never the day of the pull: with none of them the date is left
  blank and the page says "Date not read". The two ARNs (row, form details) must agree.
- **The PDF must be the filed return and show the ARN** (`extension/filedpdf.js`). The portal's
  PDFs are pdfmake files with Identity-H fonts, so their words are not in the bytes; the checker
  inflates the content streams and maps each glyph through its font's ToUnicode map, then refuses
  the System generated summary, a title that is not the return asked for (a GSTR-1A or the
  "Consolidated Summary of FORM GSTR-1 and GSTR-1A" for a GSTR-1, a GSTR-1 for a GSTR-3B) and a
  PDF that does not print the ARN. Anything it cannot read is not certain: no PDF is stored and
  `pdf_note` says why. Every blob the click produces is checked, so a summary that comes first is
  passed over. On the 1,467 return PDFs of 2026 it found the same ARN as PyMuPDF in all 1,435 that
  have one and all 28 summaries.
- **Who asked.** A pull is recorded only for a staff member's request: the page sends who clicked
  (`p_actor_id`, which must be staff) and its request id, the extension adds its version; all three
  are in the log (`actor_id`, `detail.request_id`, `detail.ext_version`). This is a record, not a
  proof: anyone with the anon key can still call `filing_record_pull` with a staff member's id and a
  made-up ARN that fits the state and period (see §9).
- **The PDF's address** must be this project's return-pdfs bucket, in the client's folder, ending
  .pdf (`filing_pdf_url_ok`: `https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/<client>/...`,
  no `..`); another host, another client's folder or a `javascript:` address is never stored (the
  pull is recorded without it, `pdf_note` says why; a manual attach is refused).
- **A new file for every pull.** The checked PDF is stored as
  `<client>/<MM-YYYY>/<type>-<ARN>-<pull time>.pdf` and uploaded without overwrite, so an older copy
  of the extension (whose fixed name was `<type>-<ARN>.pdf`) cannot put another file under it, and
  a pull of the same ARN gives a new address: the log's `old_pdf_url` keeps the file it replaced
  (the 28 System generated summaries being repaired stay on record).
- **One door.** `filing_record_pull` decides:
  - `filed`: the return is now Filed from the portal;
  - `refreshed`: the row already held this ARN (date and PDF refreshed);
  - `conflict`: the row holds another ARN, or the ARN is on another return. Nothing changes; the
    superadmin accepts (the pulled ARN, date and PDF go on; the other return is taken off Filed
    and unlocked first) or keeps it (Filing Status, Exceptions to the portal pull). The conflict
    always names the row the pull meant and the ARN it holds (the panel's "Holds"), also when the
    ARN sits on another return; Accept is refused when the row now holds an ARN the conflict did
    not show (a conflict logged before round 2, or a row changed since): keep it and pull again.
    Accept follows the pull's rule for the PDF and date (round 4): without a checked PDF from the
    pull, a PDF attached by hand on a return holding no ARN stays, marked "attached by hand, not
    checked by a pull", and its typed date stays, marked, when the pull read none; a PDF and date
    that go with the ARN the return held (the one the conflict showed), or a PDF extension
    0.14.0's pull stored, come off (the log keeps them). Round 3's Accept took the hand PDF off
    with nothing in the conflict saying so. The panel now says, beside each conflict and on
    Accept, what Accept keeps and takes off (`conflictAcceptWords`), including that the return
    holding the ARN is taken off Filed with its ARN, date and PDF. The conflict names that return
    (`detail.arn_on_return_type` / `arn_on_period`) and Accept answers with it (`unfiled`): a
    GSTR-3B / GSTR-3B (Q) taken off Filed stays a filed month for Import 2B and 2B
    Reconciliation, so the words, and a warning after Accept, say that if it is not filed on the
    portal a GST Manager reopens it ("Filed by mistake" on its row) and then uses Re-run carry
    forward on the accepted return (its carry was skipped while that month counted as filed);
  - `refused`: the ARN cannot be this return's (state code, tax period), the staff member lacks
    the Filing status permission, or a rule refused Filed (GSTR-1 from 09/2026 still needs its
    push or a direct-filing approval).
- **A PDF a pull did not check is never passed off as one, and one attached by hand is never
  taken off** (round 2, then round 3 by the lead's decision). When a pull brings no checked PDF:
  - a PDF an earlier pull checked is kept;
  - a PDF attached by hand under an allowance or on the manual route is kept (the row stays
    manual);
  - any other PDF attached by hand (before 21 Oct 2026: 2,474 Filed rows live) is **kept**, the
    row's ARN and date coming from the portal, and marked `pdf_note` = "Attached by hand, not
    checked by a pull. <why the pull brought none>". The grid shows it in amber, "Attached by
    hand, not checked by a pull", and the PDF export and Reports Hub say "Portal (PDF attached by
    hand, not checked by a pull)". It is not a checked PDF: it closes no allowance, a manual
    upload under an allowance (or the manual route) may replace it, and Pull filed returns asks
    for it again. Round 2 took these off; the PDFs it took were nearly all right (the extension's
    checker accepts 1,425 of the 1,467 PDFs of 2026), and getting them back needed an allowance
    and a fresh upload;
  - only a PDF the extension's own pull stored before 0.15.0 (`filing_pdf_from_old_pull`:
    `<client>/<MM-YYYY>/<type>-<ARN>.pdf`, 379 rows live, among them 26 of the 28 System generated
    summaries) is taken off: 0.14.0 could not tell the summary from the filed return, and a pull
    that again finds no checked PDF is evidence it got the summary. The log keeps its address
    (`old_pdf_url`); the row shows "No checked PDF" (the reason on hover), and the superadmin can
    allow a manual upload on it.
  So "Portal" alone beside a PDF always means the checked filed return.
- **A filing date typed by hand is kept and marked** (round 3). When a pull reads no date
  (formdetails, the row and the PDF all fail: every GSTR-6 so far), the date the row holds for
  this ARN is kept; when no pull read it (filed by hand before 21 Oct 2026, or attached by hand)
  `date_note` says "Typed by hand; no pull has read the portal's filing date yet.", the grid shows
  "typed by hand" under it, exports say so, and Pull filed returns asks for the row again. A pull
  that reads the date replaces it and clears the mark.
- **A refused pull writes nothing** (round 3): the row a pull would land on is created inside the
  block the refusal rolls back, so a refused pull (the direct-filing rule, mainly) no longer leaves
  a new "Prepared" row where the page showed Data Pending; the log names no row then.
- **The superadmin's allowance closes when the pull lands** (round 2): a pull that leaves the
  return with its checked PDF revokes the live allowance for it (used or not; `revoked_by` the
  staff member who pulled), and the log says so. A return pulled with its checked PDF never takes
  a manual upload, under any allowance; a pull without a checked PDF leaves the allowance open, so
  the PDF can still be attached by hand.
- **Outcomes reach the page** through the extension (`__gstkReturnPullProgress`,
  `__gstkReturnPullDone`) and the log (realtime, and a poll while a pull runs), so a closed page
  sees them after a reload. `filing_pull_report` logs the outcomes that wrote nothing
  (`not_found`, `failed`, `gstr1a_seen`), and the returns a pull did not reach: a client whose
  login was refused or whose session kept dropping, and every return left when the portal tab is
  closed (`failed`, "Not pulled. ...", `detail.not_reached`), so the superadmin sees why a manual
  allowance may be needed. A download that navigated instead of saving keeps the ARN and date
  already read and records them without a PDF.
- **One pull at a time, never dropped** (round 2). The extension refuses a second pull while one
  runs ("A pull of filed returns is already running in this browser ..."), and the page disables
  every Pull, "all" and Pull filed returns while it waits. A pull that ends early (it sat idle 10
  minutes at the CAPTCHA, ran 3 hours, its tab went, it was stopped from the popup, or another
  portal job took the slot) reports every return it did not reach to GST Keeper (`failed`,
  `not_reached`, "Not pulled: <why>.") and to the page ("The pull ended early: <why>"); the
  background watchdog ends an idle one even when no portal page loads, and the next Pull ends a
  stale one first. A pull waits keyed by client, return and period, so another month's row is
  never shown "Pulling".
- **The page follows the extension, not a clock** (round 3). It gave up 15 minutes after the
  start, in the middle of every long bulk pull (one login and CAPTCHA per client: 97 clients in
  09/2026), told staff to pull again and re-enabled Pull while the extension kept working. Now
  (`PullWatch` in `src/lib/filingPull.ts`) every return's outcome counts as a sign of life, and
  every 30 s the page asks the extension whether its pull is still running
  (`__gstkReturnPullAsk` → `returnPullStatus` → `__gstkReturnPullAlive`); while the answer is
  yes it waits, however long. "No" (the extension ended it: done, idle 10 minutes, 3 hours, tab
  closed, stopped) ends the wait at once, the rows showing their outcome from the log. Only after
  12 minutes with no sign at all (`PULL_SILENCE_MS`, longer than the extension's own idle limit:
  the extension closed or reloaded) does the page give up, saying so.
- The old direct writers are gone: `markFiled` and `upsertFilingStatus` (background.js). The
  database refuses 0.14.0's upsert, and the app requires 0.15.0 (`MIN_EXTENSION_VERSION`).

## 3. The ARN check (`filing_arn_problem`, `arnProblem()` in the app, same words)

15 characters: two letters, the state code, the tax period as MMYY, seven more. All 2,860 stored
ARNs have that form. The state code must be the GSTIN's, the period the row's (ITC-04's period
code is its half-year, so it is not checked). The two letters are a series (AA, AB and AC appear
on every return type), so the ARN does not say which return it is: the pull's exact type match
and, for a manual upload, the form name in the PDF do.

## 4. Manual allowances (shared with the reco pages)

`manual_source_allowances`: one live allowance per client, period and scope (`filing:<return
type>`, `reco:suspended`, `reco:receivable`), with a reason of at least 5 characters. Given and
taken back only by the superadmin (`manual_source_allow`, `manual_source_revoke`, which check
`staff_level_of(p_actor_id)`); used up inside the write it allows (`manual_source_take`, internal);
a trigger refuses every other write. A used allowance is taken back before another is given, so
each exception stays a dated record. The page that uses one writes `used_by` / `used_at` in the
same transaction, so a refused write leaves it unused.

On Filing Status the superadmin allows from the row (shield icon) and sees the month's allowances
and the open conflicts in "Exceptions to the portal pull". The staff member attaches with the
paperclip: the PDF is read in the browser by the extension's checker, its ARN and ARN date fill
the form, and it is attached only when it is that return showing that ARN.

## 5. What follows a Filed (once, every route)

Moved from the page to the database (`filing_status_after_write` → `filing_status_on_filed`), so
the pull gets them too and none runs twice:

- the client's confirmation e-mail (`email_outbox`, the template `confirmation`, one per client,
  return and period). Skipped when the client turned it off, has no e-mail, the return was
  filed more than 30 days ago (a pull of an old period records it without writing to the
  client), or the portal's filing date was not read (never a confirmation with a blank date, nor
  one for an old period whose date could not be read). When a later pull reads the date, the
  confirmation goes then, under the same rules. The page asks `send-gst-email` to send at once;
  the 15-minute job is the backstop;
- the advance set-off stamp: the latest approved override of the return (Filing Status's
  `FILING_STATUS:<type>` and the GSTR-1 / GSTR-3B page's) gets `filed_after_override` and the ARN;
- GSTR-3B (Q): the month's sheets are locked (the row itself is locked by the guard).

GSTR-3B's locks and the carry forward stay with `auto_lock_on_filed`, which every route reaches
through an UPDATE (a missing row is created first, not Filed). GSTR-3B (Q)'s carry is in that
trigger from `20261021100000` on, so this migration **refuses to apply before 20261021100000**
(round 2): applied alone, a pulled GSTR-3B (Q) would be locked but its pending 2B items never
carried into the next month, silently. It checks `auto_lock_on_filed` for GSTR-3B (Q), stops with
a message naming 20261021100000, and leaves nothing behind.

## 6. Unlock, twins, the page

- **A scheme change keeps filed returns** (round 2). A back-dated change on Edit Client (any staff
  member holding Add/Edit clients) used to take every return of the old scheme off Filed, ARN and
  date wiped, with no superadmin and no reason. Now a row holding a filed return is left as it is
  and logged ("Kept Filed: ... Only the superadmin takes a return off Filed."); the grid shows the
  other scheme's twin as "Not applicable"; Take off Filed (superadmin, reason) is the only way off
  Filed. A locked row holding nothing filed is still reset to Data Pending.
- **Pull needs the Filing status permission** (round 2), as the bulk button did: a staff member
  without it sees no Pull or "all", and the database refuses (and logs) a pull or an attach from
  them.
- **"Pull filed returns" says what it leaves out** (round 2): returns held back by the
  direct-filing rule are counted and named in the confirmation and the toast ("N returns were not
  pushed through GST Keeper: the superadmin approves the direct filing first"), never reported as
  Filed.
- **Unlock** keeps the ARN, filing date and PDF (it used to wipe them: AMBER GUM 06/2026). The
  row shows Not to File with "Unlocked: filed, ARN kept"; pulling that row again (same ARN) files
  and locks it again. "Pull filed returns" and a client's "all" leave such a row out, so a
  correction is never re-filed and re-locked by someone else's bulk pull. **Take off Filed**
  unlocks a GSTR-3B row and its month's sheets. Neither opens the month again for Import 2B and
  2B Reconciliation: once Filed it stays a prior month there (`twob_ever_filed`, 20261021100000,
  `docs/2B_RECONCILIATION_FLOW.md` §13) until a GST Manager or the superadmin uses **Filed by
  mistake** on the row; the page says so after either. Filed by mistake is offered, and accepted
  by `twob_reopen_filed`, only on a row holding no ARN and no filing source: after Unlock the
  return is still filed on the portal, so it is refused ("Filed on the portal: ... still holds
  ARN ...") and the Unlock warning says the month stays filed; only after the superadmin's Take
  off Filed can the month be reopened. The row's Import 2B controls follow the row's own return
  type, so a quarterly client's GSTR-3B (Q) row on the GSTR-3B tab has them too.
- **The carry forward** of a GSTR-3B / GSTR-3B (Q) runs in the database when the row becomes
  Filed (`auto_lock_on_filed` → `twob_carry_first`), whichever door filed it. The page says what
  it carried, list by list (`describeFilingCarry`), when a pull answers "filed" and after an
  allowed attach; a list it did not carry keeps a warning on the row until **Re-run carry
  forward** (GST Manager / superadmin, previewed, only from a month recorded as Filed). These
  controls live in `FilingTable` (integration of 21 Oct 2026).
- **Direct filing (GSTR-1 / IFF from 09/2026, not pushed).** For every staff level the row's
  Pull (no longer disabled) and paperclip open **Request approval: direct filing** (the words the
  database's refusal names) instead of pulling or attaching. Once a request exists, the row shows
  Awaiting superadmin or Rejected, on the GSTR-1 (IFF) tab as well. The superadmin approves; then
  the pull or the allowed manual attach goes through. A return not pushed yet shows no badge (it is
  usually still being prepared).
- **Where it came from**, everywhere a filed return shows: the row ("Portal, pulled …", "manual
  (allowed by X: reason)", "manual (the portal pull for GSTR-6 is not proven yet)", "By hand
  before 21 Oct 2026", a PDF or date not checked by a pull marked as such), the Filing Status PDF
  export and the Reports Hub Filing Status Report (a Source column), the filed-return reports (the
  PDF link is the bare address, its source beside it) and reply evidence: a row pulled from the
  portal says "read from the portal by the extension's pull" (round 3; it used to say "not fetched
  from the portal"), a row attached by hand says whether a superadmin exception allowed it.
- **"Pull filed returns" on CMP-08 and ITC-04** (round 3) is disabled and says those returns have
  no portal pull (it used to call them all Filed from the portal); on other tabs its tooltip names
  what it asks for, the Filed rows never pulled included, and its "nothing to pull" counts the
  returns attached by hand.
- **Scheme twins** (GSTR-1 / GSTR-1 (IFF), GSTR-3B / GSTR-3B (Q)): one return, one ARN. A pull
  lands on the twin holding the ARN, else on the type the sheet shows for the period
  (`filing_effective_return_type`). The other twin shows "Not applicable (filed as …)" and is not
  counted as pending. `UNIQUE(arn)` stays and is never hit.
- **The grid** is its own component (`FilingTable`); it used to be defined inside the page and was
  remounted on every redraw. **Live updates** use one realtime channel per table: the old single
  channel also named `gstr1_data` and `gstr1_direct_filing_approvals`, outside the publication,
  so it failed as a whole and the page never heard the extension (a correct pull was then
  overwritten by hand 12 to 60 seconds later, 73 times). `filing_status_log`,
  `manual_source_allowances` and `gstr1_direct_filing_approvals` are added to the publication.
- The pre-filing checks the page ran when Filed was chosen by hand (previous month, GSTR-1 before
  GSTR-3B, Suspended Reco difference, TDR/FSI consent, BU agreement, advance set-off gate) no
  longer stand between a filed return and its record: they belong before the return is filed
  (the push pages run the advance gate), and a return already on the portal is recorded as it is.

## 7. Live data (21 Oct 2026, not changed by the migration)

Listed one CSV per kind for the lead (not in the repository: they name clients): 28 GSTR-3B PDFs that are the
System generated summary (26 from the extension), 7 PDFs of another return or month, 5 GSTR-1
rows holding a GSTR-1A, 89 rows Filed without an ARN, 75 orphaned extension PDFs (72 the correct
filed return), 5 PDFs on rows not Filed, 82 filing dates that are not the ARN date, 1 ARN that
fails the new check (CMP-08 09/2026 with period 09/2025). Most are fixed by pulling again with
0.15.0 (same ARN: refreshed); a different ARN becomes a conflict for the superadmin.

## 8. Shared with the reco branch

The block from `CREATE TABLE IF NOT EXISTS public.manual_source_allowances` to the `GRANT` on
`manual_source_revoke` is byte for byte the same in this migration and in
`20261021120000_reco_pull_push_gate.sql`: one table, one guard reading one setting
(`app.manual_source_write`), `manual_source_allow` / `_revoke` returning the row, one internal
`manual_source_take`. Either migration applies after the other; both drop the reco branch's first
draft (`manual_source_allow` returning jsonb, `manual_source_use`) when a local database has it.
`run.sh` checks both orders and, once both files are in the tree, that the two copies agree.

## 9. What the anon key can still do

The app has no auth session, so these are records, not locks: the anon key can call
`filing_record_pull` with a staff member's id and a made-up ARN that fits the client's state and
the period (it is logged, with the request id and extension version it was given), and the
return-pdfs bucket lets anyone with the key upload and overwrite (storage policies "Anyone can
upload / update return PDFs"; no delete). A checked PDF's name carries the pull's time, so it is
not overwritten by accident or by an older extension; closing the bucket would also stop the
notice and case-folder uploads, which overwrite on purpose.

## 10. Tests

- `supabase/tests/filing_pull/run.sh` (local PostgreSQL; the live trigger functions in
  `00_stub.sql`; first the refusal on the live `auto_lock_on_filed`, then
  `fixtures/twob_auto_lock.sql` (20261021100000's) and the migration applied twice; writes as
  `anon` with `request.jwt.claims`; `test_71`..`test_74` are round 1: no moves, the PDF address
  and who asked, no e-mail without a date, Unlock for `unlock_sheets` and Take off Filed
  unlocking; `test_80`..`test_84` are round 2: unchecked PDFs, the allowance closed by the pull,
  scheme changes, the conflict's target, the permission (`test_84` now checks round 3's manual
  route for GSTR-6 / GSTR-7); `test_85`..`test_88` are round 3: a PDF attached by hand kept
  and marked, a refused pull leaving no row, a typed date kept and marked, GSTR-1 (IFF) /
  GSTR-3B (Q) by hand but never their GSTR-1 / GSTR-3B twin; `test_89`..`test_91` are round 4:
  the period's return decides a manual upload (a monthly client's IFF / 3B (Q) twin row refused, a
  twin holding the ARN only under the allowance), Accept keeps a PDF and date attached by hand,
  `filing_pulls_landed` counts only pulls that stored their checked PDF; then the shared block in
  both orders).
- `extension/test/16-filed-return-pull.test.mjs` (fixtures `extension/test/fixtures/*.pdf`, made
  by `extension/test/_pdffixture.mjs`; sections 13 to 16 are round 2: one pull at a time, a stale
  or stopped or replaced pull reported; section 17 is round 3: "still running?" answered for the
  request, a stale pull ended first, the bridge relaying it for the app's origin only).
- `node scripts/verify-filing-pull-only.mjs` (no direct writes in the app, the side effects left
  to the database, the ARN words, the PDF read in the app, the RPC calls; round 2: bulk pull and
  manual rules, pull keys by period, held-back words, the permission, one pull at a time; round
  3: the manual route, the kept PDF and typed date, the page following the extension through a
  long bulk pull, the CMP-08 / ITC-04 button, the reply words; round 4: the period's return in
  the app as in the database, the manual rules on twin rows, the conflict panel's words, the
  proven query).
