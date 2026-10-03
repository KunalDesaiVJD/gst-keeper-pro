# GSTR-9 / GSTR-9C workings — design, data sources and positions

Replaces `docs/GSTR9_9C_DATA_MODEL.md` (v2, Aug 2026). The Annual Return
module was rebuilt from scratch on 28 Sep 2026 against the firm's own
working, `MASTER_PMS.xlsx` (12 sheets: MASTER, PL-OUTPUT, PL-INPUT,
DUTIES & TAXES-OUTPUT, DUTIES & TAXES-INPUT, RCM, GSTR 9-OUTPUT,
GSTR 9-INPUT, GSTR 9C, ANNEXURE, GSTR-9, NOTICE FORMATE).

**Read §5 (data-source rule) and §6 (positions) before changing any figure.**

## 1. What was wrong with the previous build

A cell-by-cell audit (28 Sep 2026) found the old module partial or wrong on
most of the workbook's logic, for example:
- GSTR 9-OUTPUT's "auto-populated" column was rolled up from the app's own
  `gstr1_data`. 6A, 4G, 8A, Table 9, Annexures 1/2 and the "As per 3B"
  columns read hand-typed pseudo-returns in `gst_filed_returns`. The keys it
  read (`'GSTR-3B'`, `'Apr-25'`) never matched what the extension writes
  (`'GSTR3B'`, `'04/2025'`), so the portal pulls were never used.
- The input-services balancing figure, the 9C "Any other expense 2" plug,
  the Table 12/13 IF() split, 5H, 8B, the credit-note sign in GSTR 9-OUTPUT,
  per-head tax (everything was one netted number) and cess were missing or
  wrong.
- Locking was cosmetic, unsaved edits were lost on tab switch, paste from
  the firm's own sheet shifted columns, and SGST had to be typed twice.

All annual-return tables were empty in the live project, so the rebuild
replaced them with a document store (§3) and no data was migrated.

## 2. The workspace (UI)

**Home — all clients (applicability register).** `/annual-return` without
a client lists every client for the chosen FY (`register/ApplicabilityRegister.tsx`).
Staff type or paste each client's **aggregate turnover** for the year
(`client_annual_turnover.aggregate_turnover` — the same figure the late-fee
slab reads, typed once) and the register decides who files
(`src/lib/gstr9/applicability.ts`): GSTR-9 is required above ₹2 crore
(up to ₹2 crore the year is exempt — year-wise notifications to FY 2023-24,
Notification 15/2025-CT from FY 2024-25 onwards), GSTR-9C above ₹5 crore
(rule 80(3); ₹2 crore for FY 2017-18). Below a threshold the return is
prepared only if the client wishes — chosen per return in the register
(`gstr9_opt_in`, `gstr9c_opt_in`, with a note); 9C by choice needs GSTR-9 to
be filed. Composition (GSTR-4), tax deductors (GSTR-7), ISDs and clients not
registered during the year are not applicable. Aggregate turnover is the
PAN's, so GSTINs of one PAN are flagged when their figures differ and a
figure typed for one is offered to the PAN's blank GSTINs. Each row shows
the working's status (`annual_return_activity` view, the period's sign-off)
and opens it; the register exports to Excel. Inside a working, a chip next
to Save shows the client's applicability, and the 9C step says when 9C is
not required.

`/annual-return?client=…` is a guided step workspace. The title, client and FY sit on
one row; the steps are a sticky bar of chips across the top (one row on a
1920 px screen, two on a 1366 px laptop) with each step's open-difference
count, so the working keeps the full width. Each step opens with its main
table in the first screen: independent parts are tabs (kept in the URL, e.g.
`?salestab=audit`, `?gstr9tab=8`, with open counts on the tabs), long tables
scroll inside themselves with their header and totals pinned, and notes fold
to one line. Every step's row of tabs is one shared component
(`StepTabsList`, `reco/StepTabs.tsx`): it stays pinned under the step bar
while the step scrolls, with the controls beside it (view switches, Fill tax,
Export), an inner row (Portal data's GSTR-9 tables, GSTR-3B parts) pins under
it, and labels wrap onto a second line rather than scroll sideways. Switching
tabs while pinned opens the new tab from its top. Links from the Overview, the Review list and other steps open
the tab a figure or difference is on. Where a table shows both, the rate
follows the taxable value (pasting from the sheet keeps the sheet's column
order). Every entry grid behaves like the Excel sheet:
- keyboard entry: Enter/Tab/arrows move, typing replaces, F2 edits;
- `=a+b` expressions are accepted and kept (shown again on edit, like Excel);
- paste a block straight from the firm's sheet — columns are taken in the
  sheet's own order;
- SGST mirrors CGST (the sheet's `=F` cells) until you type a different SGST;
- tax is computed from the rate where the sheet does (`=D*18%`), and the
  implied rate is checked on every ledger;
- totals are always visible; every change autosaves (no Save buttons);
- every difference is shown next to what causes it, with its justification
  entered on the same row.

| # | Step | Excel sheet(s) | Entered here |
|---|---|---|---|
| 0 | Overview | MASTER | progress, status, lock |
| 1 | Portal data | "AS PER 3B", "AS PER GST PORTAL", "AUTO POPULATE FROM 9" cells | fetch / upload / type |
| 2 | Sales | PL-OUTPUT | Part A, Part B, audit-report total |
| 3 | Purchases & ITC | PL-INPUT | sections A/B/C, 9C expense head, row 75 |
| 4 | Duties & Taxes | DUTIES & TAXES-OUTPUT / -INPUT | monthly ledgers, LYE, other adjustments |
| 5 | RCM | RCM | Part B expense categories × month |
| 6 | Outward reco | GSTR 9-OUTPUT | category tags (from step 2), justifications |
| 7 | ITC reco | GSTR 9-INPUT + GSTR-9 Table 7 | Table 7, 12, 13, 6A1 |
| 8 | 9C expense heads | GSTR 9C | (computed from step 3) |
| 9 | Annexures | ANNEXURE 1–4 | Annexure 1 D9/D10, Annexure 3 rows 2–4, Annexure 4 |
| 10 | GSTR-9 | GSTR-9 | 6K–6M, 8E/8F/8H1, Table 9 overrides, 10, 11, 14–18 |
| 11 | GSTR-9C | (official tables 5–16, Part V) | adjustments, reasons, certification |
| 12 | Notice format | NOTICE FORMATE | 16B/16C/15G, 16(4), prior-year cells |
| 13 | Review & lock | — | every open difference, sign-off (ready for review → verify & lock), revision history, snapshots |
| 14 | Payables & set-off | ANNEXURE-3 · DRC-03 | output-/input-wise payable, set-off register (DRC-03 / GSTR-3B with evidence) |

## 3. Storage

`annual_return_docs` — one JSONB document per (client, FY, doc key):
`sales`, `purchases`, `duties_output`, `duties_input`, `rcm`, `portal`,
`gstr9`, `annexures`, `gstr9c`, `notice`, `justifications`, `settings`.
The shapes are in `src/lib/gstr9/types.ts`; `defaults.ts` fills anything a
stored doc lacks.

- Docs hold only what staff type or what was fetched from the portal.
  Every formula is computed by `src/lib/gstr9/engine.ts`, never stored.
- Saves go through `save_annual_return_doc(...)`, which checks the version
  the editor loaded — a concurrent edit by someone else is refused, and the
  workspace reloads instead of overwriting it.
- A trigger rejects any write to a doc while the FY is **locked** in
  `annual_return_periods`, so the lock is enforced by the database, not the
  UI. The period is select-only for the app; status changes go through
  `set_annual_return_status` (stale transitions refused). **Locking needs a
  GST manager or superadmin** who ticks the review checklist
  (`src/lib/gstr9/signoff.ts`); the reviewer, role, checklist, note and the
  payables at the lock are stored on the period. Staff mark the working
  "ready for review" first (`mark_annual_return_prepared`). Unlocking needs
  superadmin / GST manager or the `unlock_sheets` permission and clears the
  sign-off (the log keeps it). The role is the one the app sends — the app
  has no auth session, so the database checks the declared role, as every
  permission in this app is checked.
- **Figures that come from a source are locked to the superadmin** (firm
  decision, 2 Oct 2026). Two kinds: portal data (the GSTR-9 system-computed
  figures and the as-filed GSTR-3B — on Portal data and wherever they show:
  Duties & Taxes "As per 3B", RCM Part A), and the figures the working fills
  in from another table or return, stored as an override that is null while
  the filled-in figure is used: GSTR-9 6A1, 6G, 7E, Table 9 payable, Table
  12; Annexure-3 excess ITC; GSTR-9C 5A, 5Q, 7B–7D1, 7F, Table 9, 9Q,
  12A–12C; notice-format rows read from GSTR-9, the GSTR-3B and Annexure-4.
  Staff still bring portal figures in by pull or upload (a re-import cannot
  replace a figure the superadmin typed over); only the superadmin can type
  over, reset or restore one. Figures staff enter from their own working
  stay open (books, adjustments, Annexure-3 RCM to be paid — nil unless
  typed, RCM tax by rate, Table 13, Annexure-4, the reasons). The list is
  `src/lib/gstr9/sourceLock.ts`; the workspace refuses such a change before
  it is made and the database refuses it on save (trigger
  `annual_return_docs_source_lock`, role from `save_annual_return_doc`'s
  `p_role`; a superadmin's change is labelled "superadmin, locked figure" in
  the log). A save that declares no role — an app build from before the
  lock — is not checked.
- **Every change is logged** in `annual_return_change_log` by an AFTER
  trigger on `annual_return_docs` — one row per changed figure: sheet, path
  inside it (list rows matched by id, with the row's ledger/description as
  it was), old and new value, who, when, and an action label the save RPC
  passes (`p_action`: "Imported as-filed GSTR-3B from the portal",
  "Restored version 12", "Copied the ledger list from FY …"; default
  "Edited"). Status changes, sign-offs and set-offs are logged too. The log
  is select-only for the app; only the SECURITY DEFINER trigger/RPCs write
  it. `src/lib/gstr9/audit.ts` turns a path into words ("Part A (taxable) ›
  “Sales @18%” › Taxable value"). Autosave runs 0.7 s after a change and at
  once when the tab is hidden or closed.
- Whole-sheet **snapshots** (restore points) are kept in
  `annual_return_doc_history` (select-only), each with a reason: one per doc
  per 10 minutes of autosaving, one before a different person's edit, one
  before a restore (`p_force_history`) and one of every sheet at the lock.
- Raw portal payloads (GSTR-9 system-computed JSON) are kept unchanged in
  `gst_filed_returns` (`return_type = 'GSTR9_CALC'`, `period_month = '03/YYYY'`),
  the same table the extension already uses for as-filed returns.
- RLS is `FOR ALL TO public USING (true) WITH CHECK (true)` on the working
  docs, as everywhere in this app (CLAUDE.md). The audit records — change
  log, snapshots, period, set-offs — are `FOR SELECT TO public` and written
  only by SECURITY DEFINER functions, so the app cannot rewrite them.

### Payables and set-off

Once the working is complete, what Annexure-3 leaves payable is disclosed
**output-wise** (clause 9 difference, RCM to be paid, other output payments)
and **input-wise** (excess ITC claimed, other input payments), per head —
nothing is netted across heads or across the two sides
(`Workings.payables`). A payable is set off only against evidence in the
system (`annual_return_payable_setoffs`, CHECK constraints):
- a **DRC-03 imported into the system** — one synced from the portal by the
  extension (`gst_drc03_filings`, "Sync DRC-03s from the portal"), which
  cannot be used for more than it paid per head, or one imported by
  uploading its copy with ARN and date; or
- an **effect given in a GSTR-3B** — its return period, filing date, the
  table it went into, and the filed GSTR-3B's copy (mandatory).

Copies go to the `annual-return-evidence` bucket, which is upload- and
read-only (a copy on record cannot be replaced or deleted). Set-offs are
**not** blocked by the lock (DRC-03s are usually paid after filing);
removing one needs a reason and keeps it in the register, struck through.
Annexure-3's "already paid" is now this register's total; the old typed
`a3AlreadyPaid` field is no longer read.

## 4. Engine map (sheet → code)

`computeWorkings(docs, ctx)` returns one object with a section per sheet:
`sales` (PL-OUTPUT), `purchases` (PL-INPUT), `dto` / `dti` (Duties & Taxes),
`rcm`, `outward` (GSTR 9-OUTPUT), `itc` (GSTR 9-INPUT), `c14` (GSTR 9C sheet),
`ann1`–`ann3`, `g9` (GSTR-9 Tables 4–13), `gstr9c` (official 9C tables),
`notice`, plus `diffs` — every difference line, with its justification state.

Comments in `engine.ts` cite the workbook cell each figure reproduces.
`scripts/verify-gstr9-engine.mjs` is the acceptance test: it types the
workbook's manual cells into the doc shape, runs the engine and compares
**275 figures** against the values Excel cached. Run it after any engine
change:

```
node scripts/verify-gstr9-engine.mjs /path/to/MASTER_PMS.xlsx
```

(The workbook is client data and is not committed.) On 28 Sep 2026: 275
passed, 16 of them documented deviations (§6), 0 failed.

## 5. Data-source rule (firm, 28 Sep 2026)

**The GSTR-9/9C workings never read the app's own GSTR-1 or GSTR-3B data**
(`gstr1_data`, the GSTR-1 / GSTR-3B prep pages, `buildGstr1Summary`,
`buildGstr3bJson`), because those may differ from what was actually filed.

Portal figures come only from the GST portal, fetched by the browser
extension from the client's own login, or uploaded, or typed:

| Figure (Excel cell) | Source | Fallback |
|---|---|---|
| GSTR 9-OUTPUT column B, GSTR-9 4A–4L | GSTR-9 system-computed (`returns2/auth/api/gstr9/details/calc`) `table4` | typed |
| GSTR-9 6A | system-computed `table6.itc_3b` | Σ 4A of the as-filed GSTR-3B — whenever 6A itself is absent, even if other GSTR-9 figures are present |
| GSTR-9 6G (ISD) | system-computed `table6.isd` | typed |
| GSTR-9 8A | system-computed `table8.itc_2b` (`itc_2a` before FY 2023-24) | typed |
| GSTR-9 Table 9 | system-computed `table9` | typed |
| D&T-OUTPUT "AS PER 3B" (L:N) | as-filed GSTR-3B, 3.1(a) + 3.1(b) tax | typed |
| D&T-INPUT "AS PER 3B" (X:Z) | as-filed GSTR-3B, 4A(1)+4A(4)+4A(5) − 4B(1) − 4B(2) | typed |
| RCM Part A (monthly) | as-filed GSTR-3B 3.1(d) | GSTR-9 `table4.rchrg` (annual), unless some month has 3.1(d) pulled or typed |
| GSTR-9 7E (s.17(5)) | as-filed GSTR-3B 4B(1) | typed |
| Notice "ITC used 4A(5)", "Reversed 4(B)(2)", "4(D)" | as-filed GSTR-3B | typed |

"As-filed GSTR-3B" means the filed return the extension reads from the
portal (`gst_filed_returns`, `return_type 'GSTR3B'`), never the app's
prepared 3B. A month the portal reports as not filed (`NF`) is never
imported, even if a saved draft comes back with it. Every portal figure carries a source chip (Portal / Upload /
Typed) and can be overridden; a re-import never silently overwrites a
typed value. The GSTR-9 pull endpoint was read from the portal's own
`gstr9ctrl.js` but has **not yet been exercised live** — if it fails, use
Upload (the JSON saved from the portal) or type the figures.

## 6. Positions — where the engine departs from the workbook

These were decided during the rebuild on engineering and legal-form
grounds, **not yet confirmed at a firm sign-off**. Each is visible on
screen where it applies.

1. **RCM Part B taxable adds all expense blocks.** The sheet's `D28:D39`
   adds only two of the four blocks (`=D52+D71`) while the tax columns add
   all four, understating Part B taxable by ₹1,66,000 on the sample. The fix
   flows to PL-INPUT D77/D79, GSTR 9C D25, 9-INPUT C13 and Annexure-1 D12/D15
   (on the sample, D15 becomes +120.64 instead of −1,65,879.36).
2. **Differences are shown in one direction: Books − Portal**, labelled on
   screen. The RCM sheet's `D43` is Part A − Part B; the engine shows the
   negative of it. The audit-report check stays Report − Books (D56).
3. **"AS PER BOOK" in GSTR 9-INPUT is the Duties & Taxes net after Last
   Year Effect (U26)**, not U24, and **6A1 defaults to the Last Year
   Effect**. The sheet compares 7J (current-year ITC) with a book figure
   that still contains prior-year ITC; the two only agree while LYE is 0.
4. **Table 8B = 6(B) + 6(H)**, as the form reads and the portal computes.
   The sheet (older label "6(B) above") sums 6(B) only. On the sample this
   moves 8D by the reclaimed ITC.
5. **Annexure-2 deducts all of Table 7**, not only 7H1: row G is split into
   G1 (7H1) and G2 (rest of Table 7). The sheet's J then always equals
   −(7A…7G) (−157 on the sample, the s.17(5) figure) and was being
   overridden by hand; with the fix J is 0 when LYE = 6A1.
6. **Annexure-1 SGST payable uses SGST** (the sheet copies CGST, `D21=D20`).
7. **Annexure-3 keeps the sheet's signed total**, then shows the DRC-03
   payable per head (only positive), excess paid separately, and the DRC-03
   already paid. Row 3 is prefilled with Table 12, which staff can
   overwrite. Row 2 (RCM to be paid) **defaults to nil**: row 1 already
   compares the books payable *including* RCM Part B with Table 9 paid
   *including* 3.1(d), so books RCM not paid on the portal is already in
   it — prefilling row 2 with it would count it twice. That gap is shown
   next to row 2 as a hint; staff type row 2 only for RCM outside the
   books. The sheet types both rows.
8. **Table 9 tax payable** is the portal's figure (what the portal
   pre-fills), else 4N tax, and can be overridden. The sheet mixes the two
   (IGST from the portal, CGST/SGST from 4N).
9. **Table 13 is typed**, with the ITC reco's suggestion (MAX(books − 7J, 0),
   the negated row 28) shown next to it, because the residual is often an
   unexplained monthly difference rather than ITC actually availed in the
   next FY. Table 12 follows the sheet (computed MAX(7J − books, 0)) and can
   be overridden. **8C = Table 13 − Table 12** as in the sheet.
10. **Books side of GSTR 9-OUTPUT is split by category.** Each PL-OUTPUT
    Part A ledger carries a Table 4 tag (B2B by default, as the sheet puts
    everything in B2B), and negative rows are credit notes, so category
    differences mean something. Totals are identical to the sheet's.
11. **Part B natures cover every Table 5 bucket** (5A, 5B, 5C, 5C1, 5D, 5E,
    5F, or "not reportable"); negative rows go to 5H. The sheet picks
    Part B rows by position.
12. **The input-services taxable value includes every non-inputs,
    non-capital-goods ledger** (the sheet's `C10` skips 9C rows B, C, N).
13. **5N is computed** (4N + 5M − 4G − 4G1); the sheet types it.
14. **Notice format**: columns are labelled by the head they hold (the
    sheet's headers are swapped and row 2 is shifted a column), prior-year
    8C is its own input (the sheet reads the current Table 12), and the
    labels match the formulas (`available = 1 + 2 − 3 − 4 − 5`;
    `net excess used = 7 − 6 − 8`).
15. **Tolerance**: a difference needs a reason when any head exceeds ₹10
    (per client/FY setting). The sheet has none; the old app netted heads.
16. **Missing portal data is one line, not a dozen.** Months with no 3B
    figures are not compared month by month; they are listed in a single
    "GSTR-3B not fetched for …" line per side (`dto.no3b` / `dti.no3b`).
    Presence is per side: a pulled/filed 3B counts for the whole month (a
    filed zero is a real zero); a hand-typed month only for the side typed.
    Likewise, with no GSTR-9 Table 4 from the portal the outward reco shows
    one `out.portal` line, and with only the annual GSTR-9 4G (no monthly
    3.1(d)) RCM is compared once, annually (`rcm.annual`).
17. **Table 5 vs the portal's Table 5** is shown for information only
    (`g9.t5.*`): Table 5 is filed from the books (PL-OUTPUT Part B); the
    portal's figures come from GSTR-1 and are a cross-check.
18. **GSTR-9 Table 19** (late fee payable and paid) is carried in the
    working; the sheet has no cell for it.
19. **GSTR-9C defaults.** Table 7B–7D1 default to the *net* Part B figure
    of each nature (credit notes included), as filed in Table 5. Table 12B
    (ITC booked in earlier years, claimed this year) defaults to the Last
    Year Effect less 6A1. Table 9 groups each ledger by its stated rate
    when that is a standard slab, else by the nearest slab to the stated
    (or, untyped, implied) rate. Each default can be overridden on the
    9C step.

Carried over from the workbook as-is (firm positions, flagged in the UI):
suspended-ITC reversals (incl. 180-day) are reported as 7H "other reversal"
rather than 7A (Rule 37); all Part B RCM goes to 6C input services unless a
category is set to 6D/6F; interest/FD income is Non-GST (5F).

## 7. Portal fetch (browser extension)

Extension 0.3.3 or later is needed for the GSTR-9 pull; the Portal step
checks the version before starting it.

- **As-filed GSTR-3B** (12 months): the existing `gstr3b_pull` mode,
  started from the Portal step. The workspace then reads
  `gst_filed_returns` (`'GSTR3B'`, `'MM/YYYY'`) and shows a preview before
  applying.
- **GSTR-9 system-computed**: new `gstr9_pull` mode — after login it calls
  `/returns2/auth/api/gstr9/details/calc?ret_period=03YYYY&gstin=…` and
  `formdetails?rtn_typ=GSTR9`, and saves the raw JSON as `GSTR9_CALC`. The
  workspace parses it (`src/lib/gstr9/portalParser.ts`, tolerant of the
  known key aliases) and previews it before applying.
- **Upload**: the same parser accepts the JSON saved from the portal.

## 8. Where things live

| Concern | Code |
|---|---|
| Stored shapes, defaults | `src/lib/gstr9/types.ts`, `defaults.ts` |
| Every figure and difference line | `src/lib/gstr9/engine.ts` (`computeWorkings`, `diffStatus`) |
| Portal JSON parsing / applying | `portalParser.ts`, `portalImport.ts` (`applyHandEdits` for any typed portal figure) |
| Load / save / lock / history | `store.ts`, `components/gstr9/WorkspaceContext.tsx` |
| Revision log in words | `audit.ts`, `components/gstr9/overview/RevisionHistory.tsx` |
| Applicability register (home) | `applicability.ts`, `register.ts`, `components/gstr9/register/*`, migration `20261003100000_annual_return_applicability.sql` |
| Source lock (superadmin only) | `sourceLock.ts`, migration `20261002100000_annual_return_source_lock.sql` |
| Sign-off checklist / roles | `signoff.ts`, `components/gstr9/overview/LockPanel.tsx` |
| Payables & set-off | `payables.ts`, `components/gstr9/payables/*`, `steps/PayablesStep.tsx` |
| Audit / sign-off / set-off schema | `supabase/migrations/20260929100000_annual_return_audit_signoff_payables.sql` |
| Grid behaviour (keys, paste, `=a+b`, SGST mirror) | `components/gstr9/grid/*` |
| Steps | `components/gstr9/steps/*` + one folder per step |
| Exports — working papers (Excel via ExcelJS, PDF via jsPDF), GSTR-9 PDF, Notice PDF | `export/papers.ts` builds one working-paper model (WP refs A1 Cover … F1 Revision history) that `export/excel.ts` and `export/pdf.ts` both render, so the two never disagree; `exportWorkbook.ts` / `exportPdf.ts` are the entry points. Every figure comes from `computeWorkings`; the paper layout keeps the firm's sheet names and row labels. ExcelJS and the renderers are lazy-loaded chunks. |
| Acceptance test | `scripts/verify-gstr9-engine.mjs` (needs the workbook path) |
