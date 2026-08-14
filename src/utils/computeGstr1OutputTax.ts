// Sum the total output tax from a parsed GSTR-1 JSON. Used as a proxy for
// "ITC Utilized this month" on the GST Receivable Reco page, since the output
// liability computed here flows into GSTR-3B Table 3.1, which is then settled
// out of the Electronic Credit Ledger.
//
// Includes b2csa (Table 10 — amendments to earlier-period B2CS entries),
// treated as purely additive to the current period's liability — mirrors
// buildGstr3bJson.ts's computeOutward() interpretation for parity; not an
// independently re-verified reading of the GSTN schema.
//
// Per project decision (June 2026): Cess is ignored entirely.
//
// Sign convention for credit/debit notes:
//   note type "C" (credit note) → REDUCES outward tax
//   note type "D" (debit note)  → INCREASES outward tax
// The type lives in `ntty` on real portal/GSTN exports (`typ` on some older
// exports) — check both, defaulting to credit if neither is present.
// Advance receipts (`at`) add to outward tax for the period; advance
// adjustments (`txpd`) subtract because the tax was paid in an earlier period.

export interface Gstr1OutputTotals {
  igst: number;
  cgst: number;
  sgst: number;
}

const num = (v: any): number => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const noteSign = (nt: any): 1 | -1 =>
  String(nt?.ntty ?? nt?.typ ?? 'C').toUpperCase().startsWith('D') ? 1 : -1;

export const computeGstr1OutputTax = (rawJson: any): Gstr1OutputTotals => {
  let igst = 0, cgst = 0, sgst = 0;
  if (!rawJson || typeof rawJson !== 'object') return { igst, cgst, sgst };

  // B2B
  (rawJson.b2b || []).forEach((party: any) => {
    (party.inv || []).forEach((inv: any) => {
      (inv.itms || []).forEach((itm: any) => {
        const d = itm.itm_det || {};
        igst += num(d.iamt);
        cgst += num(d.camt);
        sgst += num(d.samt);
      });
    });
  });

  // B2CL (inter-state, only IGST possible)
  (rawJson.b2cl || []).forEach((state: any) => {
    (state.inv || []).forEach((inv: any) => {
      (inv.itms || []).forEach((itm: any) => {
        const d = itm.itm_det || {};
        igst += num(d.iamt);
      });
    });
  });

  // B2CS — flat array of {pos, typ, rt, txval, iamt, camt, samt}
  (rawJson.b2cs || []).forEach((item: any) => {
    igst += num(item.iamt);
    cgst += num(item.camt);
    sgst += num(item.samt);
  });

  // CDNR (credit/debit notes, registered)
  (rawJson.cdnr || []).forEach((party: any) => {
    (party.nt || []).forEach((nt: any) => {
      const sign = noteSign(nt);
      (nt.itms || []).forEach((itm: any) => {
        const d = itm.itm_det || {};
        igst += sign * num(d.iamt);
        cgst += sign * num(d.camt);
        sgst += sign * num(d.samt);
      });
    });
  });

  // CDNUR (credit/debit notes, unregistered — IGST only)
  (rawJson.cdnur || []).forEach((nt: any) => {
    const sign = noteSign(nt);
    (nt.itms || []).forEach((itm: any) => {
      const d = itm.itm_det || {};
      igst += sign * num(d.iamt);
    });
  });

  // Table 10 — amendments to earlier-period B2CS entries. Same flat shape as
  // b2cs (not nested under itm_det).
  (rawJson.b2csa || []).forEach((item: any) => {
    igst += num(item.iamt);
    cgst += num(item.camt);
    sgst += num(item.samt);
  });

  // AT — advance tax received
  (rawJson.at || []).forEach((item: any) => {
    const first = item.itms?.[0] || item;
    igst += num(first.iamt);
    cgst += num(first.camt);
    sgst += num(first.samt);
  });

  // TXPD — advance tax adjustments (paid in earlier period, reduces this one)
  (rawJson.txpd || []).forEach((item: any) => {
    const first = item.itms?.[0] || item;
    igst -= num(first.iamt);
    cgst -= num(first.camt);
    sgst -= num(first.samt);
  });

  return { igst, cgst, sgst };
};
