# GSTR-9C portal JSON (offline utility v2.9, FY 2025-26)

The Annual Return's GSTR-9C step has a **Portal JSON** tab (and the Export
menu a *GSTR-9C JSON — portal upload* item) that writes the same file the
government's `GSTR_9C_Offline_Utility.xlsm` writes with "Generate JSON File to
upload", with the same checks. Code: `src/lib/gstr9/gstr9cJson.ts`; screen:
`src/components/gstr9/gstr9c/PortalJsonPart.tsx`; checks:
`node scripts/verify-gstr9c-json.mjs`.

Everything below was read from the utility's VBA (Export_JSON_Module,
Validate_Functions, Variable_Initialize, Common_Module, Sheet3) and its sheets
(Home, PT II (5) … PT V, Master, Read Me FY 25-26 onwards) on 23 Nov 2026. The
utility was opened as data only; none of its macros were run.

## 1. What v2.9 changed

Release notes: FY 2025-26 added to the dropdown, and "computation logic for
Table 7F modified". 7F is a typed cell in the utility; its help text now reads
*Table (4N − 4G − 4G1 + (10 − 11)) of GSTR-9*, which is what the engine's 7F
default already is (`t7Default.F`). The FY 2025-26 sheets differ from FY
2024-25 only in labels (Table 14 head names, Part V "Other (Pl. specify)").
The JSON is the same for FY 2024-25 and FY 2025-26.

## 2. The JSON

```
{"gstr9cdata":{"audited_data":{
  gstin, fp ("0320" + last two digits of the FY, e.g. 032026), act_name,
  table5 {turnovr … unrec_turnovr}, table6? {rsn:[{number:"RSN1",desc}]},
  table7 {annul_turn_adj, othr_turnovr, zero_sup, rev_sup, rev_sup_ecom, tax_turn_adj, tax_turn_annul, unrec_tax_turn}, table8?,
  table9 {rate?[{tax_val,cgst,sgst,igst,cess,desc}], oth_ecom?, inter?, late_fee?, pen?, oth?, tot_amt_payable (9P), tot_amt_paid (9Q), unrec_amt (9R)}, table10?,
  table11 {rate[10 rows], oth_ecom, inter, late_fee, pen, oth}  (always, zero-filled),
  table12 {itc_avail, itc_book_earl, itc_book_curr, itc_avail_audited, itc_claim, unrec_itc}  (one amount per row: the heads summed),
  table13?, table14? {items?[{val,itc_amt,itc_avail,desc}], tot_elig_itc, itc_claim, unrec_itc}, table15?,
  table16 {cgst, sgst, igst, cess, inter, pen},
  add_liab {tax_pay?[{val,igst,cgst,sgst,cess,desc}]}
}}}
```

For FY 2020-21 onwards (`PARTB_RESTRICTED_FY`) there is no `isauditor`, no
`certificate` and no `audited_sign`: the statement is self-certified, and Part V's
place / signatory / address are not in the JSON (the Verification tab still keeps
them for the papers). Codes (`desc`) are the Master sheet's: Table 9 uses
`"0.10"`, Tables 11 and Part V `"0.1"`; 9K2 / 11G2 are `oth_ecom` objects (tax
only); Part V G2 is a `tax_pay` row with code `oth_ecom` and value 0 (its value
cell is closed). Table 14: our A2 (purchases net of suspended ITC) is 14A
`PURCHS`; our P (RCM) and Q (any other expense 2, with the balancing figure) are
the utility's "Any other expense 1 / 2" (`ANEXP1`, `ANEXP2`).

A row is written as the utility writes it: Table 9 rate rows, its L–O lines,
Table 14 items and Part V rows only when they hold a figure; Tables 5, 7, 11, 12,
16 always; a reasons table only with a reason.

## 3. Checks (errors stop the file, as in the utility)

| Rule | Where | Check |
|---|---|---|
| EM2 / EM3 | Home | GSTIN present and matching `GSTIN_REGEX_HOME` |
| EM12 / FY | Home | FY in the utility's list; FY before 2024-25 is left to the utility (older layout) |
| EM18 | Home | Name of Act at most 30 characters (`ANAME_REGEX`) |
| AMT13 | every amount | at most 13 digits before the point; negatives allowed everywhere (`Negative_Amt`) |
| EM12 | 5G | turnover April–June 2017 must be nil from FY 2020-21 (the cell is closed) |
| EM1 | 6, 8, 10, 13, 15 | each reason one line, at most 1,000 characters; at most 10 reasons per table |
| HASH | 6, 8, 10, 13, 15 | `HASH_REGEX` `^[a-zA-Z0-9(),'.+-_&/ ]*$` (note `+-_` is a range, so `: ; = ? @ [ ]` pass and `₹ % " –` don't). *Fix characters in reasons* rewrites them (₹ → "Rs.", % → "percent", dashes and quotes plain) |
| SCHEMA | JSON | the built JSON is checked again, key by key, by a separately written checker (`validateGstr9cPortalJson`): exact keys, numbers with ≤2 decimals, Master codes, RSN numbering, and the formula rows |
| SIZE | JSON | at most 5 MB and 19,000 items (Readme) |

Warnings (the file is still written):

- **EM13 / EM14**: tax with a nil taxable value (Tables 9, 11, Part V) or ITC with a
  nil value (Table 14). The utility stops only on a *blank* cell and accepts 0; a
  figure in this app is never blank.
- **TIE**: a total the utility computes by formula (5P, 5R, 7E, 7G, 9P, 9R, 12D, 12F,
  14R, 14T), worked out again from the rounded rows, differs from the working's own
  figure by more than ₹0.05. This is how "the JSON ties up with our 9C forms" is
  checked on every build.
- **REASON**: 5R / 7G / 9R / 12F / 14T above the working's tolerance with no reason in
  the matching table (the utility does not check this; the form asks for reasons).

Amounts are rounded to paise (half away from zero) before they are written, and the
formula rows are computed from the rounded rows, so the JSON is always internally
consistent the way the utility's formulas are.

## 4. Positions

1. **14T is S − R** (the form, and the utility's `H25 = H24 − H23`). The engine's
   `gstr9c.t14.T` and the difference line `gstr9c.14T` were R − S until 23 Nov 2026;
   they now read S − R. A justification recorded against the old sign still stands
   (`legacyFlip` in the engine's difference lines). The firm's own "GSTR 9C" sheet
   replica (`workings.c14.T`, paper C3) keeps R − S, as the workbook does.
2. **Table 14 "Amount of Total ITC"** is the eligible ITC: the working keeps ITC
   availed by expense head only, so `itc_amt` = `itc_avail`.
3. **Table 12** is written as one amount per row, the four heads summed, as the
   utility has a single amount column.
4. **Reasons**: each non-blank line of a reasons box is one reason (RSN1, RSN2 …).

## 5. When the utility changes

Download the new utility, extract it into an empty folder, read (do not run) the
macros with `olevba`, and compare `Export_JSON_Module` (keys, which rows are
written), `Validate_Functions` (checks), `Variable_Initialize` (regexes, row ranges,
`PARTB_RESTRICTED_FY`) and the `Master` sheet (codes) with `gstr9cJson.ts`. Then run
`node scripts/verify-gstr9c-json.mjs`.
