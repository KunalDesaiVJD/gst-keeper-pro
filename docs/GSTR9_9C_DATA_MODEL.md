# GSTR-9 / GSTR-9C data model — the definitive field map (v2)

This document exists because the annual-return build was scoped wrong twice:
once from a summary read of the workbooks, and once as a set of flat tables
that mirrored sheet *names* without mirroring what each sheet actually
computes. Both passes under-covered `MASTER_PMS.xlsx` — cross-checked cell by
cell (27 Aug 2026) against every one of its 12 sheets. A first version of
this document (v1) then proposed *merging* `PL-INPUT`/`PL-OUTPUT` with
`DUTIES & TAXES-INPUT`/`-OUTPUT` and RCM Part B into unified root tables —
the firm's answer was no: keep the entry surfaces exactly as separate as the
Excel sheets are. v2 reflects that.

**This file is the checklist.** Before any future work on this module is
called "done," it gets checked against the sheet-by-sheet coverage table in
§4, not against memory of what was probably built.

## 1. The mistake, precisely

Steps 1–4 (committed 24–26 Aug 2026) built three flat tables —
`books_turnover_lines`, `books_purchase_lines`, and month-wise rows in
`gst_filed_returns` — each holding one combined tax number. The real
workbook needs section splits (Purchase / Expense / Capital Goods), an
IGST/CGST/SGST split on every figure, debit-note and 180-day suspended-ITC
tracking, RCM as a first-class ledger, and seven sheets (RCM, GSTR 9-Input,
GSTR 9-Output, the GSTR 9C expense table, all four Annexures, and the GSTR-9
form itself) that had nothing built at all.

## 2. The corrected principle

**v1 said:** collapse `PL-INPUT` and `DUTIES & TAXES-INPUT` into one root
table with a `transaction_month` dimension, so one is just a `GROUP BY` of
the other.

**Firm's answer (27 Aug 2026): no — same as the Excel file.** `PL-INPUT` is
annual, by ledger head, with no month. `DUTIES & TAXES-INPUT` is monthly, by
adjustment type, entered separately. Staff re-type both, exactly as they do
today. The two are cross-checked against each other (their annual totals
should agree), not derived from each other. Same answer for RCM Part
B — it is **not** the existing `rcm_data` table reused; it's a fresh,
dedicated monthly books entry specific to this module, matched against Part
A (which *is* auto-populated from the GSTR-3B portal figures).

So the actual operating principle is narrower than v1 claimed:

- **Replicate every sheet as its own entry surface, at its own grain,
  exactly where the sheet itself is a place staff type numbers.**
- **Only follow Excel's own formulas as computed cross-references** — where
  a cell in one sheet is `='OtherSheet'!X`, the software computes it the
  same way (e.g. PL-INPUT's "RCM CREDIT AS PER PORTAL" row reads from the
  RCM sheet's Part A total; GSTR 9-INPUT's totals tie to GSTR 9C's total).
  That's replicating a formula, not merging two manual-entry surfaces — the
  distinction the firm drew.
- **Auto-derive from portal data only where Excel itself would want the
  portal value and the app already holds it reliably** — GSTR 9-Output's
  "auto-populated" column (from `gstr1_data`) and RCM Part A (from the
  GSTR-3B portal figures) are the two confirmed cases (§3, §4).

## 3. Tables (one per sheet's manual-entry surface, plus the portal/derived set)

| Table | Grain | Key columns | Entry mode |
|---|---|---|---|
| `pl_output_lines` | client × FY × ledger head (Part A) or bifurcation category (Part B) | `part` (`A`\|`B`), `ledger_head`, `bifurcation` (Part B only: `export_wo_tax`\|`sez_wo_tax`\|`non_gst`), `taxable_value`, `igst`, `cgst`, `sgst`, `rate` | **Manual**, annual — replaces `books_turnover_lines` (adds Part A/B, bifurcation; still no month, matching the sheet) |
| `pl_input_lines` | client × FY × section × ledger head | `section` (`purchase`\|`expense`\|`capital_goods`), `ledger_head`, `expense_head` (9C bucket, nullable), `taxable_value`, `igst`, `cgst`, `sgst`, `rate` | **Manual**, annual — replaces `books_purchase_lines` (adds section; still no month) |
| `duties_taxes_output_monthly` | client × FY × month | `sales_igst/cgst/sgst`, `credit_note_igst/cgst/sgst`, `as_per_3b_igst/cgst/sgst` (net sales + diff computed) | **Manual**, separate from `pl_output_lines` — cross-checked against it, not derived |
| `duties_taxes_input_monthly` | client × FY × month | `purchase_*`, `debit_note_*`, `suspended_reversed_*`, `suspended_reversed_180d_*`, `suspended_reclaim_*`, `suspended_reclaim_180d_*`, `as_per_3b_*` (all IGST/CGST/SGST; net + diff computed) — plus a `last_year_effect` row and an `rcm_tax_figures_only` row | **Manual**, separate from `pl_input_lines` — running-total reclaim/reversal columns, **not** linked to a specific original transaction (firm's call — matches the sheet) |
| `rcm_annual_return_lines` | client × FY × category × month | `category` (Transportation/Delivery/Office Rent/Advocate Fees/…, extensible), `taxable_value`, `igst`, `cgst`, `sgst` | **Manual, dedicated to this module** — explicitly *not* `rcm_data` (that table is 3B-prep-scoped; staff re-enter books RCM figures here even though it duplicates 3B effort) — this is Part B. Part A is derived (below). |
| `gstr9_output_lines` | client × FY × category | `category` (`b2c`\|`b2b`\|`sez_with`\|`sez_without`\|`zero_rated`\|`deemed_export`\|`credit_note`), `taxable_value`, `igst`, `cgst`, `sgst` | **Manual** — the "books" column A; distinct from `pl_output_lines` because the sheet's categorisation (B2B vs B2C) isn't a dimension PL-Output carries |
| `portal_period_figures` | client × FY × month | `outward_igst/cgst/sgst`, `itc_igst/cgst/sgst`, `itc2b_igst/cgst/sgst`, `rcm_igst/cgst/sgst` | **Manual for now** (Phase 2 decision stands — GSTR-1/3B automation isn't reliable yet); **RCM Part A of `rcm_annual_return_lines` reads `rcm_igst/cgst/sgst` from here, computed, not re-typed** |
| `portal_gstr1_category_figures` | client × FY × category | same categories as `gstr9_output_lines` | **Auto-derived** from `gstr1_data` (existing table) when all 12 months are present for the client; **falls back to manual entry** for any FY where `gstr1_data` is incomplete — feeds GSTR 9-Output column B |
| `portal_tax_payment_entries` | client × FY × tax head | `payable`, `paid_cash`, `paid_itc`, `interest`, `late_fee`, `penalty` | **Manual** — from filed challans, no other source |
| `client_annual_turnover` *(already exists)* | client × FY | `aggregate_turnover` | **Reused** as the PL-OUTPUT "AS PER REPORT" cross-check value |
| `annual_return_carry_forward` | client × FY × direction | `direction` (`claimed_in_next_fy`\|`claimed_from_prev_fy`\|`turnover_declared_next_fy`\|`turnover_reduced_next_fy`), `clause_ref` (`8C`\|`10`\|`11`\|`12`\|`13`), amount fields | **Manual** |
| `reconciliation_reasons` *(already exists)* | client × FY × line_key | `reason`, `entered_by` | **Reused as-is** — `line_key` vocabulary grows (§4) |

**Confirmed decisions (27 Aug 2026):**
1. Books entry stays exactly as granular as Excel — `pl_output_lines`/`pl_input_lines` annual with no month; `duties_taxes_*_monthly` a genuinely separate monthly entry. No unification.
2. 180-day suspended-ITC reversal/reclaim stays running-total columns, not a linked reference to a specific original transaction.
3. GSTR 9-Output's auto-populated column is auto-derived from `gstr1_data`, with manual entry only as a fallback for incomplete months.
4. RCM Part B is a fresh, dedicated entry table for this module (`rcm_annual_return_lines`) — **not** a reuse of the existing `rcm_data` table, even though that duplicates effort with 3B prep. Part A is derived from the GSTR-3B portal figures already captured in `portal_period_figures`.

## 4. Sheet-by-sheet coverage (the checklist)

| # | Sheet | Built from | Status target |
|---|---|---|---|
| 1 | MASTER | `clients` (existing) | ✅ already correct |
| 2 | PL-OUTPUT | `pl_output_lines`, Part A/B totalled; cross-check vs `client_annual_turnover` | Rebuild |
| 3 | PL-INPUT | `pl_input_lines`, sectioned A/B/C; "SUSPENDED ITC" row computed from `duties_taxes_input_monthly`'s suspended columns; "RCM CREDIT" row computed from `rcm_annual_return_lines` Part A | Rebuild |
| 4 | DUTIES & TAXES-OUTPUT | `duties_taxes_output_monthly` vs `portal_period_figures.outward_*`; cross-checked against `pl_output_lines`' annual total, not derived from it | Net-new |
| 5 | DUTIES & TAXES-INPUT | `duties_taxes_input_monthly` vs `portal_period_figures.itc_*`; cross-checked against `pl_input_lines`' annual total | Net-new |
| 6 | RCM | Part A = `portal_period_figures.rcm_*` (computed); Part B = `rcm_annual_return_lines` (manual, dedicated) | Net-new |
| 7 | GSTR 9-INPUT | `pl_input_lines` bucketed (section → Input/Input Services/Capital Goods) + `rcm_annual_return_lines` Part A + reclaim figures from `duties_taxes_input_monthly`; cross-tied to GSTR 9C total and `portal_period_figures.itc_*`; next-year rows from `annual_return_carry_forward` | Net-new |
| 8 | GSTR 9-OUTPUT | Column A = `gstr9_output_lines` (manual); Column B = `portal_gstr1_category_figures` (auto-derived); diff + `reconciliation_reasons` | Net-new |
| 9 | GSTR 9C (Table 12B) | `pl_input_lines` grouped by `expense_head`, minus suspended ITC (from `duties_taxes_input_monthly`) | Rebuild (tagging existed; the report didn't) |
| 10 | ANNEXURE 1 | `pl_output_lines` + `rcm_annual_return_lines` + `portal_tax_payment_entries` (paid vs payable) | Net-new |
| 11 | ANNEXURE 2 | `duties_taxes_input_monthly` totals + `rcm_annual_return_lines` + `portal_period_figures.itc_*` | Net-new |
| 12 | ANNEXURE 3 (DRC-03) | Every open `reconciliation_reasons` line with a nonzero difference, summed by tax head | Net-new |
| 13 | ANNEXURE 4 | `annual_return_carry_forward`, FY − 1 | Net-new |
| 14 | GSTR-9 (Tables 4–13) | Assembles nodes 2, 4, 6, 3, 7, `portal_tax_payment_entries`, `annual_return_carry_forward` — the terminal view | Net-new |
| 15 | NOTICE FORMATE | Reformats the GSTR-9 view + GSTR 9C view | Net-new |

## 5. Build order (topological — each step only needs nodes already built)

1. Tables: `pl_output_lines`, `pl_input_lines`, `duties_taxes_output_monthly`, `duties_taxes_input_monthly`, `rcm_annual_return_lines`, `gstr9_output_lines`, `portal_period_figures` v2, `portal_gstr1_category_figures`, `portal_tax_payment_entries`, `annual_return_carry_forward`. Migrate Step 1–4 data into `pl_output_lines`/`pl_input_lines` (the closest existing shape) rather than discarding it; flag migrated rows for staff review.
2. Entry UI: PL-Output, PL-Input (Books Input tab, rebuilt with the A/B/C sections), Duties & Taxes-Output/Input (new), RCM Part B (new), GSTR 9-Output books column (new).
3. Entry UI: Portal Capture rebuilt (tax-head split, RCM Part A, tax-payment entries); `portal_gstr1_category_figures` auto-derivation job against `gstr1_data`.
4. Computed views, in dependency order: PL-Input's suspended-ITC/RCM-credit rows, RCM Part A, GSTR 9-Input, GSTR 9-Output diff, GSTR 9C.
5. Annexures 1–4.
6. GSTR-9 (the terminal assembly) and Notice Format.
7. Reconciliation engine expanded to one `reconciliation_reasons.line_key` per sheet-level diff (Duties & Taxes monthly diffs ×2, RCM diff, GSTR 9-Output per-category diffs, 9C Table 5/7/9/12/14, Table 8D) — not the 3 that exist today.

## 6. What this fixes about "we keep repeating this"

- Every table's columns come from an actual cell dump of the filed workbook
  (§4 links each sheet to the exact rows verified), not a summary.
- §3's "entry mode" column is now the answer to "should this be typed or
  computed," settled by the firm once, not re-litigated per table.
- §4 is the acceptance test. "100% coverage" means every row in that table
  reads "done," verified against the real sheet, not against this plan.
