# Filing Status: pulled from the portal only

The firm's decision of 21 Oct 2026, built by migration
`20261021110000_filing_status_pull_only.sql`, extension 0.15.0 and the
Filing Status page.

1. Portal data is **pulled** by the extension, for every client, Nil returns included.
2. When a pull cannot be done (wrong portal password, portal down, no access), the
   **superadmin** may allow one manual upload for one client, period and return, with a
   reason. It is logged and shows as "manual (allowed by X: reason)" wherever the return shows.
3. Everything is traceable (`filing_status_log`).

Read this before changing `FilingStatusPage.tsx`, `src/components/filing/*`,
`src/lib/filingPull.ts`, `src/lib/manualSourceAllowances.ts`, `extension/filedpdf.js` or the
extension's `returnpdf` mode.

## 1. Who writes Filed, the ARN, the filing date and the PDF

| Route | Who | Function | Marked |
|---|---|---|---|
| Portal pull | the extension (0.15.0+), started from Filing Status | `filing_record_pull` | `filed_source = 'portal'` |
| Manual attach, returns pulled only | a staff member, under the superadmin's allowance | `filing_attach_manual` | `manual`, with `manual_allowance_id` |
| Manual attach, returns with no pull yet | a staff member | `filing_attach_manual` | `manual` |
| Unlock (GSTR-3B family) | GST Manager or superadmin | `filing_status_unlock` | keeps everything |
| Take off Filed | superadmin, with a reason | `filing_status_unfile` | clears; the log keeps it |
| A pull conflict | superadmin | `filing_pull_conflict_decide` | `portal` when accepted |
| Scheme change (inapplicable returns) | the `client_scheme_history` trigger | as before, logged | cleared |

The trigger `trigger_filing_status_source` refuses every other write that makes a row Filed,
takes it off Filed, or changes `arn`, `filed_date`, `return_pdf_url`, `filed_source`,
`manual_allowance_id`, `pulled_at` or `pdf_note`, for every level (the app sends the acting
user's id; `auth.uid()` is NULL), and refuses deleting a row that holds a filed return (except
with its client). The routes above set a transaction-local `app.filing_source`, the pattern of
`filing_status_guard_pushed` / `filing_record_push`. Status changes between the working statuses,
remarks, target dates, NIL, locks and the push marker are not touched.

**Pulled only:** GSTR-1, GSTR-1 (IFF), GSTR-3B, GSTR-3B (Q), GSTR-1A (`filing_pull_only`).
**Manual route kept for now:** CMP-08, GSTR-6, GSTR-7, ITC-04. The extension had never pulled
one of them (0 of 457 rows on 21 Oct 2026), and its e-Filed Returns pull sets a monthly period,
which is wrong for CMP-08 (quarter) and ITC-04 (half-year). GSTR-6 and GSTR-7 can be pulled
(untested live); the page offers no pull for CMP-08 and ITC-04.

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
- **One door.** `filing_record_pull` decides:
  - `filed`: the return is now Filed from the portal;
  - `refreshed`: the row already held this ARN (date and PDF refreshed; a pull without a checked
    PDF keeps the stored one and says it is not checked);
  - `conflict`: the row holds another ARN, or the ARN is on another return. Nothing changes; the
    superadmin accepts (the pulled ARN, date and PDF go on; the other return is taken off Filed
    first) or keeps it (Filing Status, Exceptions to the portal pull);
  - `refused`: the ARN cannot be this return's (state code, tax period), or a rule refused Filed
    (GSTR-1 from 09/2026 still needs its push or a direct-filing approval).
- **Outcomes reach the page** through the extension (`__gstkReturnPullProgress`,
  `__gstkReturnPullDone`) and the log (realtime, and a poll while a pull runs), so a closed page
  sees them after a reload. `filing_pull_report` logs the outcomes that wrote nothing
  (`not_found`, `failed`, `gstr1a_seen`).
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
  return and period). Skipped when the client turned it off, has no e-mail, or the return was
  filed more than 30 days ago (a pull of an old period records it without writing to the
  client). The page asks `send-gst-email` to send at once; the 15-minute job is the backstop;
- the advance set-off stamp: the latest approved override of the return (Filing Status's
  `FILING_STATUS:<type>` and the GSTR-1 / GSTR-3B page's) gets `filed_after_override` and the ARN;
- GSTR-3B (Q): the month's sheets are locked (the row itself is locked by the guard).

GSTR-3B's locks and the carry forward stay with `auto_lock_on_filed`, which every route reaches
through an UPDATE (a missing row is created first, not Filed). GSTR-3B (Q)'s carry is in that
trigger from `20261021100000` on.

## 6. Unlock, twins, the page

- **Unlock** keeps the ARN, filing date and PDF (it used to wipe them: AMBER GUM 06/2026). The
  row shows Not to File with "Unlocked: filed, ARN kept"; pulling it again (same ARN) files and
  locks it again.
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

## 8. Tests

- `supabase/tests/filing_pull/run.sh` (local PostgreSQL; the live trigger functions in
  `00_stub.sql`; the migration applied twice; writes as `anon` with `request.jwt.claims`).
- `extension/test/16-filed-return-pull.test.mjs` (fixtures `extension/test/fixtures/*.pdf`, made
  by `extension/test/_pdffixture.mjs`).
- `node scripts/verify-filing-pull-only.mjs` (no direct writes in the app, the side effects left
  to the database, the ARN words, the PDF read in the app, the RPC calls).
