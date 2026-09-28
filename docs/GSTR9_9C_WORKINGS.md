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

`/annual-return` is a guided step workspace. The left rail follows how the
team works; each step shows its open-difference count. Every entry grid
behaves like the Excel sheet:
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
| 13 | Review & lock | — | every open difference, lock/unlock |

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
  UI. Unlocking needs superadmin / GST manager or the `unlock_sheets`
  permission.
- Every overwritten version is kept in `annual_return_doc_history`.
- Raw portal payloads (GSTR-9 system-computed JSON) are kept unchanged in
  `gst_filed_returns` (`return_type = 'GSTR9_CALC'`, `period_month = '03/YYYY'`),
  the same table the extension already uses for as-filed returns.
- RLS is `FOR ALL TO public USING (true) WITH CHECK (true)`, as everywhere
  in this app (CLAUDE.md).

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
| GSTR-9 6A | system-computed `table6.itc_3b` | Σ 4A of the as-filed GSTR-3B |
| GSTR-9 6G (ISD) | system-computed `table6.isd` | typed |
| GSTR-9 8A | system-computed `table8.itc_2b` (`itc_2a` before FY 2023-24) | typed |
| GSTR-9 Table 9 | system-computed `table9` | typed |
| D&T-OUTPUT "AS PER 3B" (L:N) | as-filed GSTR-3B, 3.1(a) + 3.1(b) tax | typed |
| D&T-INPUT "AS PER 3B" (X:Z) | as-filed GSTR-3B, 4A(1)+4A(4)+4A(5) − 4B(1) − 4B(2) | typed |
| RCM Part A (monthly) | as-filed GSTR-3B 3.1(d) | GSTR-9 `table4.rchrg` (annual) |
| GSTR-9 7E (s.17(5)) | as-filed GSTR-3B 4B(1) | typed |
| Notice "ITC used 4A(5)", "Reversed 4(B)(2)", "4(D)" | as-filed GSTR-3B | typed |

"As-filed GSTR-3B" means the filed return the extension reads from the
portal (`gst_filed_returns`, `return_type 'GSTR3B'`), never the app's
prepared 3B. Every portal figure carries a source chip (Portal / Upload /
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
   already paid. Rows 2 and 3 are prefilled with a suggestion (books RCM not
   paid on the portal; Table 12) that staff can overwrite — the sheet types
   them.
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

Carried over from the workbook as-is (firm positions, flagged in the UI):
suspended-ITC reversals (incl. 180-day) are reported as 7H "other reversal"
rather than 7A (Rule 37); all Part B RCM goes to 6C input services unless a
category is set to 6D/6F; interest/FD income is Non-GST (5F).

## 7. Portal fetch (browser extension)

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
