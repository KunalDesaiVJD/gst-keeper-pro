# GSTR-2A vs GSTR-2B Reconciliation: positions

How the Reports Hub's **GSTR-2A vs GSTR-2B Reconciliation** matches the two
statements and decides the reason for every difference. Read this before
changing `src/lib/itcReco/` (engine, adapters, rules, view model, table),
`src/utils/gstr2aVs2bReports.ts` (the report and its Pull plan),
`src/components/reports/views/ReasonReconciliationView.tsx`, or the
extension's GSTR-2A / GSTR-2B pulls (`extension/content.js`,
`handleGstr2aPull`, `handleGstr2bPullDash`, `handleGstr2bPull`, mode
`gstr2a2b_pull`).

**Engineering wrote these positions on 15 Oct 2026 from the code, the GSTN
API samples and the live data (25 GSTR-2A rows across 2 clients, one GSTR-2B
row for a third client, read only). They are engineering judgement: the firm
has not signed them off. No client-month had both a 2A and a 2B pulled when
this was written, so the report has been tested on fictional data only
(`scripts/verify-itc-reco.mjs`) until one client-month is pulled for both.**

---

## 1. What the report is

One client and one month, or several months merged into one report (§12; a
month that cannot be built, such as a quarterly taxpayer's month without a 2B,
is named with its reason instead of failing the others). The month's portal 2A and portal 2B (as the extension saved
them in `gst_filed_returns`, never the Excel imports) are matched document by
document. Every row gets a status, a reason, what to do, the evidence for the
reason, and both sides' figures with the difference (2B minus 2A). A summary
by reason sits above the list, with notes on what could not be confirmed and
what to pull.

Nothing is written to the database. Pull fetches only what is missing (§7).

## 2. What is read

- **GSTR-2B**: the portal's getdata JSON, stored whole. Every section is read:
  B2B, CDNR, B2BA, CDNRA, ISD, ISDA, IMPG, IMPGSEZ, the import amendments and
  e-commerce (`ecom` / `ecoma`). Tax is `igst` / `cgst` / `sgst` / `cess` on each
  document (`iamt` / `camt` is the fallback). Any other non-empty section under
  `docdata` is listed in the notes as not read.
- **GSTR-2A**: the extension's pull of B2B invoices (`api/gstr2a/ctin`, then
  `api/gstr2a/b2b` per supplier). From 0.13.0 the supplier wrapper keeps every
  field the portal sends (`cfs`, `cfs3b`, `flprdr1`, `dtcancel`) and the summary
  carries `_meta = { counterparties, failed, failedCtins }`. 2A tax is read from
  the invoice or, failing that, from `itms[].itm_det`.
- **GSTR-2A credit and debit notes** (extension 0.14.0, **not confirmed
  live**): after the invoices, the same pull asks for the note suppliers
  (`api/gstr2a/ctin?section_name=CDN`, then `section_name=CDNR` when CDN gives
  no list) and each supplier's notes (`api/gstr2a/cdn`, or `api/gstr2a/cdnr`
  once the first supplier's `cdn` call answers 400 or 404), taking the GSTN
  2A layout (`cdn: [{ ctin, cfs, …, nt: [{ ntty, nt_num, nt_dt, val, pos,
  rchrg, itms }] }]`). They are saved as `summary.cdn` with `_meta.sections =
  ['b2b', 'cdn']`, `cdnFailed` and `cdnFailedCtins`; an empty list or a "no
  data" answer is a month without notes, and the 2B's notes are then compared.
  When the notes cannot be read at all (no list under either name, every
  supplier's notes failing, or any error), nothing is saved for them:
  `_meta.sections = ['b2b']` and `_meta.cdnProblem` says why, so the 2B's notes
  stay *Not compared* with that reason rather than becoming *Only in 2B*. The
  invoices are saved exactly as before in every case. A note's own number and
  date (`nt_num`, `nt_dt`) are read before an older layout's `inum` / `idt`,
  the invoice it was raised against.
- **Neighbours**, when pulled: the 2B of the next three months (a quarterly
  2B: the next quarter's), the 2A of each earlier month a 2B document's
  supplier period points to, and the 2A and 2B of the two months before (to
  tell a quarterly 2B, §9).
- A 2A document's supplier period is its `flprdr1`, else the 2A's own period
  (a 2A lists what suppliers reported for that period).
- A statement is usable when its summary can be read. A later failed re-pull
  rewrites only the status, so the saved figures still count. A status
  `NOT GENERATED / NOT FOUND` without a summary means the portal had none.

## 3. Identity (how two documents are "the same")

Supplier GSTIN + document family (invoice, debit note, credit note, ISD,
bill of entry) + document number + financial year of the document date
(suppliers restart their numbering every year). In order, over what is still
unpaired:

1. the number exactly as sent;
2. the number normalised: upper case, separators dropped, leading zeros
   dropped from every run of digits (`inv/0012` = `INV12`, `2026/0012` =
   `2026-12`), but two runs of digits keep a boundary (`1/23` is not `12/3`);
3. the same normalised number without the year, only when each side has
   exactly one such document and the dates are within 92 days of each other
   (a typing error, not a reused number): flagged "same number, different
   date";
4. an amendment (B2BA, CDNRA) against its original document's number.

Passes 2 and 3 pair only documents reported for the same supplier period: a
2B document the supplier reported for June is never the one in July's 2A.
Pass 4 does not ask (an amendment is reported later than its original). An
entry of the 2B's ITC reversal section is never paired: it is not the
invoice.

Several documents under one identity pair on the same date first, then the
nearest taxable value. **Never** on the supplier's name (2A's name comes from
the supplier list, 2B's from the return), and never by edit distance: the
fuzzy match used for books (`invoiceSimilar`) is not used here.

## 4. Same or different

Within **₹1** on the taxable value and on every head (rounding) the documents
are the same. A credit note counts **negative** in every amount and total.
The difference is always **2B minus 2A**.

## 5. Statuses and reasons

The first rule (in this order) that applies gives the reason. Notes add flags
and never change the status.

**Only in 2A**

1. *Filed after the 2B cut-off: in a later 2B* (confirmed): found as ITC in a
   later 2B, filed after the 11th (or no filing date). A filing on the 12th or
   13th, or no date, says it could also have been kept pending in IMS. Claim
   it in that month.
2. *Kept pending in IMS, accepted later* (confirmed): found as ITC in a later
   2B, filed by the 11th.
3. *Rejected in IMS* (confirmed): listed in a later 2B's rejected section.
4. *Filed after the 2B cut-off: expected in a later 2B* (not confirmed): filed
   after the cut-off, and that 2B is not pulled, not generated yet or not
   generated on the portal. The evidence says which. A filing on the 12th or
   13th could belong to either of two 2Bs: both are checked.
5. *Saved by the supplier, GSTR-1 / IFF not filed*: `cfs` N, or no `cfs` and
   no filing date (`cfs` Y without a date is filed). An e-invoice is said to
   be one (it reaches the GSTR-1 by itself).
6. *Filed in time but not in this 2B: pending or rejected in IMS* (not
   confirmed): pending in IMS can only be inferred, so it is never confirmed
   without a later 2B. A filing on the 12th or 13th says so (§6).
7. *Only in 2A: no reason found*.

**Only in 2B**

1. *ITC reversal (Rule 37A)*: an entry of the 2B's ITC reversal section.
   Shown negative (it reduces the ITC), never paired, never "claim"; reverse
   it in Table 4(B)(2).
2. *Not compared*: a section the 2A it belongs in does not read (everything
   but B2B invoices and, from extension 0.14.0, credit and debit notes). Kept
   in the list, kept out of the difference. For a 2B note, the row and the
   notes say why its 2A has none: pulled by an extension before 0.14.0 (pull
   2A again with 0.14.0), or the portal did not return the notes (the pull's
   `cdnProblem`; pull 2A again). For a quarterly 2B each note is judged by the
   2A of its own month, which may come from an older extension.
3. *Rejected in IMS*: in the 2B's rejected section. No ITC.
4. *Quarterly 2B: for an earlier month of the quarter* (not confirmed): a
   quarterly 2B (§9) holds a document of the quarter's first or second month
   whose 2A is not pulled.
5. *For an earlier month, filed in time: kept pending in IMS, accepted later*:
   supplier period before this month, filed by that month's 11th. The
   supplier was not late; the client accepted it in IMS now.
6. *Supplier filed late for an earlier month*: supplier period before this
   month, filed after its cut-off (the 12th or 13th says it could be either).
   Confirmed when found in that month's 2A. At a quarter's end, when it is not
   known whether the client files quarterly, both say "or this quarter's 2B".
   A note is looked for only in a 2A that read the notes: against an older
   2A the evidence says it has no notes (not confirmed), never "not in the 2A".
7. *2A pulled before the supplier filed* (not confirmed).
8. *The 2A pull failed for this supplier* (not confirmed): the supplier is one
   of the pull's `failedCtins` (0.13.0+, even when the 2A holds its notes;
   before that, not in the 2A and the pull recorded failures), or the 2A was
   saved empty by an extension before 0.13.0 (no `_meta`: it may be a failed
   pull). A credit or debit note is blamed only on its supplier's failed notes
   fetch (`cdnFailedCtins`, 0.14.0+), never on a failed invoice fetch.
9. *Only in 2B: no reason found* (says when the supplier period is later than
   this month).

Whenever the 2B gives no ITC on a document (rejected, an ITC reversal entry,
`itcavl` N), its action is the 2B's ("No ITC …"), never a claim, whatever the
reason.

**Figures differ**

1. *Amended by the supplier* (confirmed): either side is an amendment, or a
   later 2B holds an amendment of this document.
2. *Rejected in IMS* (confirmed): the 2B lists it as rejected. It still pairs
   with its 2A document by identity; at equal figures its status is "ITC
   differs" (the figures do not). Action: before that GSTR-3B is filed, change
   the action to Accept in IMS and recompute the 2B; once filed, the supplier
   reports it again (GSTR-1A or amendment).
3. *Same number, different date* (not for a pair made through an amendment:
   that is *Amended*, at equal figures too).
4. *Changed by the supplier after the 2B was generated* (not confirmed): 2A's
   filing date is after the 2B's generation date (GSTR-1A or amendment).
5. *Value or tax difference*, naming the heads.

**ITC differs**: the same figures, rejected in IMS.

**Matched**: the same within ₹1.

**Notes**: reverse charge; ITC not available for place of supply (2B reason
`P`, or predicted for a 2A-only document whose place of supply is the
supplier's state and not the client's); ITC not available for the time limit
(2B reason `C`, §8); any other ITC not available; supplier's GSTR-3B not
filed yet as of the 2A pull (2A `cfs3b` N: ordinary before the 3B due date and
for quarterly suppliers); supplier has not filed GSTR-3B (Rule 37A: `cfs3b` N
in a 2A pulled after 30 September following the year); supplier registration
cancelled (document dated on or after the cancellation); document dated in an
earlier financial year. The PDF prints no notes column, so the summary notes
count each flag with its documents and tax.

## 6. The 2B cut-off

- A supplier filing **by the 11th** of the next month is in this month's 2B for
  certain (the monthly GSTR-1 date).
- The **12th and 13th** are ambiguous: a quarterly (IFF / QRMP) supplier's
  filing up to the 13th is in this 2B, a monthly filer's is not. The report
  says so instead of choosing.
- Filed **after the 13th**, a document belongs to a later 2B. The 2B's
  generation date does not move this: a 2B generated late (on demand once the
  previous GSTR-3B is filed, or recomputed after IMS actions) does not take in
  later filings. A notified GSTR-1 / IFF due-date extension would; none is
  modelled.
- **Presence in a neighbouring 2B always beats the date**: the dates only
  decide when that 2B has not been read.

## 7. Pull

For each selected month: the 2A of the month when not usable (or saved empty
by an extension before 0.13.0) or stale (older than the 2B's generation, or
than 15 days); the 2B of the month and the next 2B (a quarterly 2B: the next
quarter's) once due and not usable; the 2A of each earlier month the month's
ITC documents point to, and of the quarter's months for a quarterly 2B; at a
quarter's end, the 2B of the quarter's earlier months when never pulled (to
tell a quarterly 2B). A 2B the portal did not generate is asked again only
when nothing else is missing, since it is generated once the previous GSTR-3B
is filed. Nothing missing: 2A and 2B of the month again (2A changes whenever a
supplier files). A usable 2A pulled before 0.14.0 is not counted as missing
for its notes: the month's own 2A is fetched again when it is stale or by
that last rule, an earlier month's is not; the notes and the evidence say
which 2A lacks them.

Extension 0.13.0 or later gets one job (`gstr2a2b_pull`) with a per-month list
of what to fetch, in one login. An older extension gets one return type per
click; each click re-plans what is still missing. The page checks the
extension's version first, because an unknown mode falls through to the
extension's ledger chain.

## 8. Unverified portal details

- The key of the rejected-documents section of the 2B getdata JSON has never
  been seen live: any object whose key mentions "rej" holding `b2b` / `cdnr`
  is read as rejected, and so is any document with `imsStatus` `R`. Only
  `imsStatus` `N` has been seen live. When the 2B carries no rejected section,
  a rejected document is simply absent and falls under "pending or rejected
  in IMS".
- The ITC reversal (Rule 37A) section is read from `docdata.itcrev` (GSTN API
  sample), never seen live.
- 2B reason `C` meaning the s.16(4) time limit is inferred from the GSTN API
  sample; only an empty `rsn` has been seen live.
- The 2A supplier-list answer for a month with no suppliers has not been seen:
  a 200 answer without `cpty` that says "no data / no invoices / no documents /
  no records / not found", or a plain success without a list (`{}`,
  `{ status: 1 }`), is saved as NO DATA; a non-200, non-JSON or other error
  answer is a failed pull, whose status carries the portal's words.
- The 2A credit and debit notes (0.14.0, §2) have never been read live: the
  section names (CDN or CDNR), the notes endpoint (`cdn` or `cdnr`) and the
  note layout follow the GSTN 2A JSON. The names that worked are kept in
  `_meta.cdnList` / `_meta.cdnApi`, and `_meta.cdnProblem` keeps what the
  portal answered when nothing worked, so the first live pull settles it. A
  "no data" answer under either name is taken as a month without notes, as
  for the invoices.

## 9. Limits

- **Scope**: B2B invoices are compared, and credit and debit notes once the
  2A was pulled with extension 0.14.0 and its notes were read; everything else
  in 2B (ISD, imports, amendments not paired with their original) is "Not
  compared" until the 2A pull reads more sections. That is data-driven: once a
  2A pull stores a section, its documents are compared with no engine change.
  Other readers of the stored 2A (the GSTR-2A report, GSTR-3B vs 2A) still
  read its B2B invoices only.
- **QRMP recipients**: a quarterly taxpayer gets a 2B only for the last month of
  the quarter. The report says so for the first two months. For the quarter's
  last month, a 2B is taken as quarterly when the 2B of both earlier months is
  recorded "not generated": it is then compared with the 2A of all three months
  and the next 2B is the next quarter's. The app has no QRMP flag on the
  client, so without that record the 2B is taken as monthly and the reasons
  of documents from the quarter's earlier months say "or this quarter's 2B";
  Pull fetches those 2Bs to settle it.
- **"As of" the pulls**: 2A is a snapshot at its pull date, and every reason is
  as of the pull dates in the subtitle. The notes say when the 2A is older than
  the 2B's generation or than 15 days.

## 10. Next: GSTR-9 Table 8A

- The engine is generic over sources. 8A plugs in as a third adapter
  (`docsFrom8A`) once document-level 8A is pulled under its own return type
  (today the app holds only the 8A total, `GSTR9_CALC.table8`).
- If the firm wants it before 8A is live: an "8A as rebuilt from 2B" source
  (the year's documents in the 2Bs of April to October of the next year),
  labelled as such, never as 8A.
- `RULES_2A_8A` and `RULES_8A_2B` are declared (empty) in `reasons.ts` with
  the expected reasons. `matchSources` already takes any number of sources, so
  the three-way report adds a `reconcileMany` on top; the view reads columns by
  name and works as long as 'Status' and 'Reason' are kept.
- An FY-wide report needs `periodScope: 'fy'` on the report definition so the
  merge builds once per year instead of once per month.

## 11. Open questions for the firm

1. Filings on the 12th or 13th: keep "pending in IMS, or next month's 2B for a
   monthly filer", or treat them as next month by default?
2. Should the "Not compared" rows stay in the document list, or appear only in
   the summary?
3. Before 8A is live, is an "8A as rebuilt from 2B" source wanted?
4. Should the extension also pull 2A credit notes and amendments? Those
   sections need a live check first.

## 12. Presentation

How the report is laid out; no position above depends on it. Built by
`recoReportTable` (`src/lib/itcReco/viewModel.ts`) from flat view rows
(`toViewData`: one row per pair, every figure signed, a credit note and an ITC
reversal entry negative), so the preview, the Excel and the PDF read the same
rows and every total, tile and summary line is a sum over them.

- **Identification strip**: client, GSTIN, period ("Jul 2026", or "Apr 2025 to
  Mar 2026 (12 months)"), when the 2A was pulled and the 2B generated (their
  span across months), the months that could not be built, and the filter when
  a filtered view is exported.
- **Stat band**: documents (and how many are in each statement), matched (with
  its share), only in 2A, only in 2B, figures differ (ITC differs included),
  not compared, 2A tax, 2B tax, and the net difference (2B minus 2A, over the
  compared documents only).
- **Documents**, the main sheet: one row per pair with both statements side by
  side, under five bands: Document (Sr., Month, Supplier GSTIN, Supplier Name,
  Doc Type, Doc No., Doc Date, Section) | GSTR-2A (taxable value, IGST, CGST,
  SGST, cess, total tax, filed on) | GSTR-2B (the same, and whether the 2B gives
  ITC) | Difference, 2B minus 2A (taxable value and total tax; blank when not
  compared) | Reconciliation (Status, Reason, What to do, Evidence, Reverse
  Charge, Also note). A side that has no document is blank, not zero. Sorted by
  month, status (in §5's order: only in 2A, only in 2B, figures differ, ITC
  differs, not compared, matched), supplier name, date and number; a TOTAL row
  sums every amount column. The status tints its cell (matched green, one side
  only amber, a difference red, not compared grey) and the word is always
  there, so a black and white print loses nothing. The PDF prints month,
  supplier, number, date, both taxes, the difference, status and reason; the
  Excel has every column.
- **Summary by reason**: one line per status and reason with the documents,
  both sides' taxable value and tax, the difference and what to do, and the
  notes under it (§5, §9), each led by its month when there are several.
- **Analysis sheets**: By supplier (one line per GSTIN: counts by status, both
  sides' figures, the difference, the largest difference first, and a status
  word for its worst row); By month (several months only: the same per month,
  with that month's pull and generation dates); By document type; Notes and
  evidence (Excel only: every row with a flag or a reason not confirmed).
- **Several months are one report, not stitched blocks**: every month's rows
  are merged (the Month column says which) and the stat band, the summary, the
  TOTAL and the analysis sheets are recomputed across them. A month that could
  not be built is named in the strip and in the notes; the others are built.
- Other code finds the columns 'Status', 'Reason' and 'Total Tax Difference (2B
  minus 2A)' by name: keep those headers.
