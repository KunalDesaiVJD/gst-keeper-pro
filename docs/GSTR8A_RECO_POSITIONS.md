# GSTR-8A reports: positions

Three Reports Hub reports, category GSTR-2A / 2B, built per client and
**financial year** (`periodScope: 'fy'`):

| Report id | What it shows |
|---|---|
| `gstr2a-vs-gstr8a-reco` | The year's GSTR-2A against its GSTR-9 Table 8A, document by document, with a reason and an action for every difference |
| `gstr2b-vs-gstr8a-reco` | The year's GSTR-2B against its Table 8A, the same way |
| `gstr8a-vs-gstr2a-vs-gstr2b-reco` | All three side by side, every document's verdict, and the **final ITC available for the FY** |

Code: `src/lib/itcReco/eightA.ts` (reading the 8A file), `fy8a.ts` (the year,
its window and the rebuilt 8A), `reasons8A.ts` (the two pair reports' reasons),
`threeWay.ts` (the three-way verdicts and the judgment), `fyView.ts` (the pair
reports' view), `src/utils/gstr8aReports.ts` (loading, Pull, Upload), view
`src/components/reports/views/ItcThreeWayView.tsx`. Checks:
`node scripts/verify-gstr8a-reco.mjs` (fictional FY, 106 checks) and
`node scripts/verify-itc-reco.mjs`.

**Every position below is engineering judgement, not a firm sign-off.** Treat
them as reversible defaults until the firm confirms them (§7).

## 1. What "GSTR-8A" is here

Table 8A of GSTR-9: the ITC of the year as auto-drafted from suppliers'
GSTR-1 / IFF / GSTR-5 / GSTR-1A. On the portal it is "Table 8A document
details" (Annual Return → GSTR-9 → Download Table 8A document details). It
holds B2B invoices, debit and credit notes and their amendments, ITC
available, not reverse charge. Imports (Table 6E) and ISD (6G) are never in it.

## 2. Where the 8A comes from

1. **Upload** (the report's *Upload 8A* button): the portal's Excel
   (`.xlsx`/`.xls`) or JSON. The Excel is read with the GSTR-2B reader's
   header-driven column matching (`parseItcWorkbook`, loose mode), sheets
   B2B, B2BA, B2B-CDNR, B2B-CDNRA (and CDNR / CDNRA / CDN / CDNA); JSON with
   the 2B / 2A readers. A file of another GSTIN, or whose documents are dated
   in another FY, is refused. Saved in `gst_filed_returns` as
   `return_type 'GSTR9_8A'`, period `03/<FY end year>`, summary
   `format 'gstk-8a-docs-v1'`, status `Uploaded`. A new upload replaces the
   earlier one. **No migration**: the table and its open RLS already exist.
2. **Rebuilt** while nothing is uploaded: from the year's 2B (FY 2023-24 on)
   or 2A (earlier): B2B, B2BA, CDNR, CDNRA, ITC available, not reverse charge,
   documents dated in the FY, in the statements of the window (§3). Always
   labelled "the 8A rebuilt from the year's 2B", never as the portal's 8A.
3. The GSTR-9 system total of 8A (`GSTR9_CALC`, pulled by `gstr9_pull`) is
   shown next to the document 8A when it is there, as a check.

**Unverified:** the portal's 8A Excel layout has not been confirmed live; the
reader matches columns by their headers and reports what it could not read.
An extension pull of 8A document details is a follow-up.

## 3. The year and its window

- Documents count for the FY they are **dated** in. A document of an earlier
  year that turns up in this year's statements is left out and noted.
- Window: the 2A / 2B of April of the FY to **October** after it (s.16(4),
  the 30 November cut-off; October's 2B is the last one before it). The load
  reads to December to see documents that came too late.
- A 2B is "due" on the 14th of the next month, a 2A on the 12th. A month not
  due yet is "year still open", not "not pulled".
- Amendments replace the original they amend (`collapseDocs`).

## 4. The pair reports' reasons

Built on the 2A vs 2B engine (`matchSources`, `reconcile`), reason catalogue
in `reasons.ts` (the 8A codes), rules in `reasons8A.ts`. For a document only in
2A or 2B the reason says why 8A does not hold it: reverse charge, rejected in
IMS, ITC not available, a Rule 37A reversal, first in a 2B after the window,
not in any 2B, a 2B not pulled, a section the 8A does not read. For one only in
8A: a statement not pulled, or dated before the year, else "no reason found".

## 5. The three-way verdict and the final ITC

Each document is matched across 2B, 8A and 2A (in that order) and given one
verdict, the first that applies:

1. Rule 37A reversal entry in a 2B → **Reverse** (counts, negative)
2. Reverse charge → not counted (ITC once the tax is paid, Table 6C / 6D)
3. Rejected in IMS → not available
4. 2B says ITC not available → not available (time-barred if that is the reason)
5. First in a 2B after October after the year → time-barred
6. Import or ISD in a 2B with ITC → **Eligible outside 8A** (counts)
7. In a 2B of the window with ITC → **Eligible** (counts), at the 2B's figures
8. Only in 8A → to confirm (find it in a 2B)
9. Only in 2A, supplier saved but did not file → not available
10. Only in 2A with a 2B not pulled or not out → to confirm
11. Only in 2A otherwise → not available, not in any 2B

**Final ITC for the FY = A + B + C**: A eligible B2B (8A basis), B imports and
ISD, C less Rule 37A reversals. The 2B is the deciding statement (s.16(2)(aa)),
not the 8A: a document in 8A but in no 2B is never counted until a 2B shows it.
The sheet also prints the totals of each statement, the lines left out, and
"A minus GSTR-8A", whose difference is each document listed as only in 2B or
only in 8A. The judgment is as the statements stand; it is not a reading of
the client's books.

## 6. Pull

Pull fetches the 2A and 2B of the window months not yet pulled
(`gstr2a2b_pull`, extension 0.13.0 or later; one type per job before). With
nothing missing it pulls GSTR-9's system figures (`gstr9_pull`); with those
too it re-pulls the last six months.

## 7. Open questions for the firm

1. Is the 2B the deciding statement for the final ITC, or should 8A or the
   books decide when they differ?
2. Should a document in 8A but in no pulled 2B be counted?
3. Is the October cut-off right for every year (the s.16(4) date has moved
   in the past)?
4. Should the extension pull Table 8A document details itself?
