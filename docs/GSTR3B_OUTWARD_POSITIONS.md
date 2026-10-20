# GSTR-3B Table 3.1 and 3.2 from GSTR-1: law and positions

Written 20 Oct 2026, after the firm's report that ORVIX TECHNOLOGIES PVT LTD's
Sep-26 draft put a supply to an SEZ without payment of tax (₹48,000) in 3.1(a)
instead of 3.1(b). The draft put every B2B invoice and every credit or debit
note in 3.1(a), whatever its type. Only exports reached 3.1(b).

Code: `src/lib/gstr1/supplyKind.ts` (which row a document belongs to),
`src/utils/buildGstr3bJson.ts` (`computeOutward`, `computeInterSup`,
`gstr1OutputTax`). Check: `node scripts/verify-gstr3b-outward.mjs`.

## 1. The law

Form GSTR-3B, s.16 IGST Act:

| Row | What goes in | GSTR-1 JSON |
|---|---|---|
| 3.1(a) | Outward taxable supplies other than zero rated, nil rated and exempted | b2b `inv_typ` R, DE, CBW; b2cl; b2cs; advances (at, txpd); cdnr notes of those types; cdnur `typ` B2CL |
| 3.1(b) | Zero rated supplies: exports, and supplies to an SEZ unit or developer, with or without payment of IGST | exp (WPAY, WOPAY); b2b `inv_typ` SEWP, SEWOP; cdnr notes with `inv_typ` SEWP / SEWOP; cdnur `typ` EXPWP / EXPWOP |
| 3.1(c) | Nil rated and exempted | nil: `nil_amt` + `expt_amt` |
| 3.1(e) | Non-GST | nil: `ngsup_amt` |
| 3.2 | Inter-state supplies to unregistered persons, composition dealers and UIN holders, "of the supplies shown in 3.1(a)" | never a zero rated row |

- A blank `inv_typ` is R.
- DE (deemed exports) is not zero rated. It stays in 3.1(a).
- CBW is the offline tool's "Intra-State supplies attracting IGST". It is
  taxable, so 3.1(a).
- A supply to an SEZ is inter-state under s.7(5)(b) IGST Act, even when the
  SEZ is in the supplier's own state. It never enters 3.2.
- The IGST on an export or SEZ supply with payment is shown in 3.1(b). It is
  payable like any other tax.

## 2. Positions

1. **Total liability is 3.1(a) + 3.1(b) + 3.1(d).** It was 3.1(a) + 3.1(d),
   which left out the IGST on exports and SEZ supplies with payment. The same
   fix runs through every place that adds up a liability: the draft's indicative
   net payable, the GST receivable reco's "ITC utilised", the credit closing
   report, and the as-filed reports (GSTR-3B liability, annual summary, offset
   summary, liability declared vs paid, tax liability and ITC summary, credit
   and liability statement, PAN reports, interest and late fee). A month whose
   only tax is in 3.1(b) is not a nil return.
2. **Notes follow their invoice's row and are signed.** A debit note adds, a
   credit note takes off (`noteSign`). The note type is `ntty`. On cdnr an
   older export may carry it in `typ`; on cdnur `typ` is B2CL / EXPWP / EXPWOP,
   so it is never read as the note type there. Neither present: a credit note.
3. **Reverse charge (Table 4B): value only.** Unchanged. The value counts in
   3.1(a), the tax is the recipient's. From Aug-2026, or for any month not yet
   filed. An SEZ invoice is sorted to 3.1(b) first; the reverse charge rule then
   applies to it the same way.
4. **3.1(b) carries value, IGST and cess.** The export cess was left out
   before. A zero rated document that wrongly carries CGST / SGST raises a flag;
   3.1(b) has no such columns.
5. **Amendments restate, they are not a difference.** 9A (b2ba, b2cla, expa),
   9C (cdnra, cdnura), 11(2) (ata, txpda) and a restated Table 10 (b2csa) are
   never folded into 3.1. Each raises a flag naming the table, the count and
   what it restates, against its own row (SEZ and export amendments 3.1(b), the
   rest 3.1(a)). The difference is entered in GSTR-3B Adjustments (source
   'Prior Period'), as in `docs/ADVANCE_SETOFF_POSITIONS.md` §7.2. The live
   case: ATC LOGISTICS Jul-26, one b2ba row, which had been dropped with no flag.
6. **A Table 10 re-rating difference is folded.** The Builder's
   `discharge_mode = 'GSTR1_AMENDMENT'` writes a b2csa entry that reverses the
   old rate and re-reports the same value at the new one (a line below zero,
   lines netting to nil value). That entry is the difference, not a restated
   month, so its tax difference goes to 3.1(a). Any other b2csa entry is a
   restatement (position 5). Before this, every b2csa line was added in full.
   No stored return has a b2csa block, so nothing moves.
7. **Table 3.2.** Unregistered persons: B2CL, inter-state B2CS, cdnur notes of
   typ B2CL (signed), by place of supply. UIN holders: b2b invoices to a GSTIN
   in GSTN's UIN format (`^\d{4}[A-Z]{3}\d{5}[UO]N[A-Z0-9]$`) at a place of
   supply outside the supplier's state, and their cdnr notes. Composition
   dealers: GSTR-1 does not say who is one, so the row stays empty and a flag
   says so whenever the month has an inter-state B2B invoice.
8. **Output tax is the draft's own figure.** `computeGstr1OutputTax` (credit
   closing report) and the GST receivable reco now call `gstr1OutputTax`, the
   3.1(a) + 3.1(b) tax of `computeOutward`. They can no longer differ from the
   draft. This also brings in every advance rate line (the old helper read only
   the first) and the export IGST (it had no `exp` block).
9. **The advance set-off check leaves SEZ invoices out**, as it does exports.
   An SEZ invoice could otherwise "absorb" an open advance and fire rule 1.
10. **Reports on the as-filed GSTR-1 split SEZ out.** The portal's summary
    carries B2B_4A, B2B_4B, B2B_6C, B2B_SEZWP, B2B_SEZWOP as sections, and CDNR
    (CDNR_4A … CDNR_SEZWOP) and CDNUR (B2CL, EXPWP, EXPWOP) as sub_sections. The
    comparison report lists them against 3.1(a) or 3.1(b). The "other than
    export / RCM" report takes them off B2B and the notes. The export and SEZ
    report now shows 6B and the 9B notes, not exports alone.

## 3. No cut-over date

The portal has always put SEZ supplies in 3.1(b). Recomputing a filed month
brings the draft closer to what was filed. SEWOP moves no tax. SEWP tax only
moves from 3.1(a) to 3.1(b), and total liability stays the same.

## 4. Open points

- **Negative 3.1(b).** The draft check (`Gstr3bPage.tsx`, `draftProblems`)
  blocks a push with any negative 3.1 figure. A month with only an SEZ or
  export credit note now gives a negative 3.1(b) and is blocked. The portal
  itself filed −7,01,200 in 3.1(b) for ACCURATE PMS 03/2026. Kept blocked
  until the firm decides.
- **Table 3.2 sources.** As we recall GSTN's auto-fill, 3.2 for unregistered
  persons takes GSTR-1 Tables 5, 7, 9A, 9B (B2CL) and 10, and not advances
  (11A). Not confirmed. Advances are left out.
- **Reverse charge outward supplies (4B).** Their value in 3.1(a) is a repo
  choice. Some practitioners report them elsewhere.
- **CDNR / CDNUR sub-section figures** in the portal's summary are read as net
  (debit less credit). Not confirmed on a live pull; none had a note.
- **Amendment differences** are flagged, not computed. Computing them needs
  the original period's stored GSTR-1 and the right original document; not
  built.
