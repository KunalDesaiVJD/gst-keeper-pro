// Turns an imported GSTR-1 JSON (the offline-tool / portal format stored in
// gstr1_data.raw_json) into the portal-style consolidated summary and the
// section tile counts. Pure function — no I/O — so both the tile grid and the
// "Generate Summary" dialog render from a single source of truth and it can be
// checked against the portal's system-generated GSTR-1 PDF.

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

export interface Gstr1SummaryRow {
  code: string;      // e.g. "4A"
  title: string;     // portal description
  count: number;     // No. of records (documents)
  docType: string;   // "Invoice" | "Note" | "Net Value" | "-"
  value: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface Gstr1Tile {
  key: string;
  label: string;
  count: number;
  value: number;
}

export interface Gstr1Summary {
  sections: Gstr1SummaryRow[];
  tiles: Gstr1Tile[];
  totals: { value: number; igst: number; cgst: number; sgst: number; cess: number };
}

interface Acc { count: number; value: number; igst: number; cgst: number; sgst: number; cess: number }
const acc = (): Acc => ({ count: 0, value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });

// Sum tax across an item list. Handles both the B2B/CDN shape (itm.itm_det.*)
// and the flat EXP shape (itm.*).
const addItems = (a: Acc, itms: any[]) => {
  (itms || []).forEach((it: any) => {
    const d = it?.itm_det || it || {};
    a.igst += num(d.iamt);
    a.cgst += num(d.camt);
    a.sgst += num(d.samt);
    a.cess += num(d.csamt);
  });
};

// Portal reports Value as *taxable* value (sum of itm_det.txval), NOT the
// invoice value (inv.val which includes tax). Matches Table 4A/4B/5/6A/6B/6C
// on the system-generated GSTR-1 PDF.
const sumTaxable = (itms: any[]): number =>
  (itms || []).reduce((t: number, it: any) => t + num((it?.itm_det || it || {}).txval), 0);

// A B2B invoice belongs to exactly one portal table, decided by its type and
// reverse-charge flag: SEZ (SEWP/SEWOP) -> 6B, Deemed Export -> 6C, reverse
// charge -> 4B, everything else -> 4A.
const classifyB2b = (inv: any): '4A' | '4B' | '6B' | '6C' => {
  const t = String(inv?.inv_typ || 'R').toUpperCase();
  if (t === 'SEWP' || t === 'SEWOP') return '6B';
  if (t === 'DE') return '6C';
  if (String(inv?.rchrg || 'N').toUpperCase() === 'Y') return '4B';
  return '4A';
};

export function buildGstr1Summary(json: any): Gstr1Summary {
  const j = json || {};

  const s4A = acc(), s4B = acc(), s5 = acc(), s6A = acc(), s6B = acc(), s6C = acc();
  const s7 = acc(), s8 = acc(), s9BR = acc(), s9BUR = acc(), s11A = acc(), s11B = acc();
  // Table 10 — amendments to earlier B2CS entries (retrospective re-rating).
  const s10 = acc();
  const s12 = acc(), s13 = acc();

  // 4A / 4B / 6B / 6C — B2B (registered), split by type. Value = taxable.
  (j.b2b || []).forEach((party: any) => {
    (party.inv || []).forEach((inv: any) => {
      const bucket = classifyB2b(inv) === '4A' ? s4A
        : classifyB2b(inv) === '4B' ? s4B
        : classifyB2b(inv) === '6B' ? s6B : s6C;
      bucket.count += 1;
      bucket.value += sumTaxable(inv.itms);
      addItems(bucket, inv.itms);
    });
  });

  // 5 — B2CL (inter-state, large). Value = taxable. Only IGST + cess apply.
  (j.b2cl || []).forEach((state: any) => {
    (state.inv || []).forEach((inv: any) => {
      s5.count += 1;
      s5.value += sumTaxable(inv.itms);
      addItems(s5, inv.itms);
    });
  });

  // 6A — Exports. Value = taxable.
  (j.exp || []).forEach((exp: any) => {
    (exp.inv || []).forEach((inv: any) => {
      s6A.count += 1;
      s6A.value += sumTaxable(inv.itms);
      addItems(s6A, inv.itms);
    });
  });

  // 7 — B2CS (others). No invoice value; portal shows taxable "Net Value".
  (j.b2cs || []).forEach((r: any) => {
    s7.count += 1;
    s7.value += num(r.txval);
    s7.igst += num(r.iamt);
    s7.cgst += num(r.camt);
    s7.sgst += num(r.samt);
    s7.cess += num(r.csamt);
  });

  // 10 — Amendments to earlier B2CS entries. Same shape as b2cs, one row per
  // (amended month, POS, rate). A retrospective re-rating is reported here
  // rather than as a debit note, because every buyer is unregistered.
  (j.b2csa || []).forEach((r: Record<string, unknown>) => {
    s10.count += 1;
    s10.value += num(r.txval);
    s10.igst += num(r.iamt);
    s10.cgst += num(r.camt);
    s10.sgst += num(r.samt);
    s10.cess += num(r.csamt);
  });

  // 8 — Nil rated / exempted / non-GST. Value only, no tax.
  (j.nil?.inv || []).forEach((r: any) => {
    s8.count += 1;
    s8.value += num(r.nil_amt) + num(r.expt_amt) + num(r.ngsup_amt);
  });

  // 9B — Credit / Debit notes (registered). The portal reports these NET:
  // "Debit notes − Credit notes", so a credit note reduces the value and tax.
  // Note type lives in `ntty` (or `typ` on some exports); anything starting
  // with "D" is a debit note (+), otherwise it's a credit note (−).
  const noteSign = (nt: any): 1 | -1 =>
    String(nt?.ntty ?? nt?.typ ?? 'C').toUpperCase().startsWith('D') ? 1 : -1;

  (j.cdnr || []).forEach((party: any) => {
    (party.nt || []).forEach((nt: any) => {
      s9BR.count += 1;
      const sign = noteSign(nt);
      s9BR.value += sign * num(nt.val);
      (nt.itms || []).forEach((it: any) => {
        const d = it?.itm_det || it || {};
        s9BR.igst += sign * num(d.iamt);
        s9BR.cgst += sign * num(d.camt);
        s9BR.sgst += sign * num(d.samt);
        s9BR.cess += sign * num(d.csamt);
      });
    });
  });

  // 9B — Credit / Debit notes (unregistered). Same netting rule.
  (j.cdnur || []).forEach((nt: any) => {
    s9BUR.count += 1;
    const sign = noteSign(nt);
    s9BUR.value += sign * num(nt.val);
    (nt.itms || []).forEach((it: any) => {
      const d = it?.itm_det || it || {};
      s9BUR.igst += sign * num(d.iamt);
      s9BUR.cgst += sign * num(d.camt);
      s9BUR.sgst += sign * num(d.samt);
      s9BUR.cess += sign * num(d.csamt);
    });
  });

  // 11A — Advances received (tax liability).
  (j.at || []).forEach((r: any) => {
    s11A.count += 1;
    (r.itms || []).forEach((it: any) => {
      s11A.value += num(it.ad_amt);
      s11A.igst += num(it.iamt);
      s11A.cgst += num(it.camt);
      s11A.sgst += num(it.samt);
      s11A.cess += num(it.csamt);
    });
  });

  // 11B — Adjustment of advances.
  (j.txpd || []).forEach((r: any) => {
    s11B.count += 1;
    (r.itms || []).forEach((it: any) => {
      s11B.value += num(it.ad_amt);
      s11B.igst += num(it.iamt);
      s11B.cgst += num(it.camt);
      s11B.sgst += num(it.samt);
      s11B.cess += num(it.csamt);
    });
  });

  // 12 — HSN summary. Portal shows Value = taxable ONLY (not taxable + tax),
  // and counts UNIQUE non-blank HSN codes (rate/UQC variants of the same HSN
  // collapse into one; blank hsn_sc rows contribute to Value but not to
  // count). Matches Table 12 on the system-generated GSTR-1 PDF.
  // Two JSON shapes: hsn.data (older) or hsn.hsn_b2b + hsn.hsn_b2c (newer).
  const hsnRowsRaw: any[] = j.hsn?.data
    ? j.hsn.data
    : [...(j.hsn?.hsn_b2b || []), ...(j.hsn?.hsn_b2c || [])];
  const distinctHsnCodes = new Set<string>();
  hsnRowsRaw.forEach((h: any) => {
    const code = String(h?.hsn_sc || '').trim();
    if (code) distinctHsnCodes.add(code);
    s12.igst += num(h.iamt);
    s12.cgst += num(h.camt);
    s12.sgst += num(h.samt);
    s12.cess += num(h.csamt);
    s12.value += num(h.txval);
  });
  s12.count = distinctHsnCodes.size;

  // 13 — Documents issued. Portal reports the NET number of documents
  // (totnum − cancel, i.e. the `net_issue` per series row), not the count of
  // series entries. Falls back to totnum − cancel when net_issue is absent.
  (j.doc_issue?.doc_det || []).forEach((det: any) => {
    (det.docs || []).forEach((d: any) => {
      const net = d?.net_issue != null ? num(d.net_issue) : num(d?.totnum) - num(d?.cancel);
      s13.count += net;
    });
  });

  const row = (
    code: string,
    title: string,
    a: Acc,
    docType: string,
  ): Gstr1SummaryRow => ({
    code,
    title,
    count: a.count,
    docType,
    value: a.value,
    igst: a.igst,
    cgst: a.cgst,
    sgst: a.sgst,
    cess: a.cess,
  });

  const sections: Gstr1SummaryRow[] = [
    row('4A', 'Taxable outward supplies to registered persons (non reverse charge) — B2B Regular', s4A, 'Invoice'),
    row('4B', 'Supplies to registered persons attracting reverse charge — B2B Reverse charge', s4B, 'Invoice'),
    row('5', 'Inter-state supplies to unregistered persons, invoice value > ₹1 lakh — B2CL (Large)', s5, 'Invoice'),
    row('6A', 'Exports (with / without payment of tax)', s6A, 'Invoice'),
    row('6B', 'Supplies to SEZ unit or SEZ developer — SEZWP / SEZWOP', s6B, 'Invoice'),
    row('6C', 'Deemed Exports — DE', s6C, 'Invoice'),
    row('7', 'Supplies to unregistered persons (net of debit/credit notes) — B2CS (Others)', s7, 'Net Value'),
    row('8', 'Nil rated, exempted and non-GST outward supplies', s8, '-'),
    row('9B', 'Credit / Debit Notes (Registered) — CDNR', s9BR, 'Note'),
    row('9B', 'Credit / Debit Notes (Unregistered) — CDNUR', s9BUR, 'Note'),
    row('10', 'Amendments to taxable outward supplies to unregistered persons — B2CS Amended', s10, 'Net Value'),
    row('11A', 'Tax liability on advances received', s11A, 'Advance'),
    row('11B', 'Adjustment of advances', s11B, 'Advance'),
    row('12', 'HSN-wise summary of outward supplies', s12, '-'),
    row('13', 'Documents issued', s13, '-'),
  ];

  // Liability-bearing sections only, for the grand total (HSN is a memo of the
  // above, Documents carries no value, so both are excluded to avoid double
  // counting).
  const forTotal = [s4A, s4B, s5, s6A, s6B, s6C, s7, s10, s9BR, s9BUR, s11A];
  const totals = forTotal.reduce(
    (t, a) => ({
      value: t.value + a.value,
      igst: t.igst + a.igst,
      cgst: t.cgst + a.cgst,
      sgst: t.sgst + a.sgst,
      cess: t.cess + a.cess,
    }),
    { value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 },
  );

  const b2bAll = acc();
  [s4A, s4B, s6B, s6C].forEach((a) => { b2bAll.count += a.count; b2bAll.value += a.value; });

  const tiles: Gstr1Tile[] = [
    { key: 'b2b', label: '4A, 4B, 6B, 6C - B2B, SEZ, DE Invoices', count: b2bAll.count, value: b2bAll.value },
    { key: 'b2cl', label: '5 - B2C (Large) Invoices', count: s5.count, value: s5.value },
    { key: 'exp', label: '6A - Exports Invoices', count: s6A.count, value: s6A.value },
    { key: 'b2cs', label: '7 - B2C (Others)', count: s7.count, value: s7.value },
    { key: 'nil', label: '8A, 8B, 8C, 8D - Nil Rated Supplies', count: s8.count, value: s8.value },
    { key: 'cdnr', label: '9B - Credit / Debit Notes (Registered)', count: s9BR.count, value: s9BR.value },
    { key: 'cdnur', label: '9B - Credit / Debit Notes (Unregistered)', count: s9BUR.count, value: s9BUR.value },
    { key: 'b2csa', label: '10 - Amended B2C (Others)', count: s10.count, value: s10.value },
    { key: 'at', label: '11A(1), 11A(2) - Tax Liability (Advances Received)', count: s11A.count, value: s11A.value },
    { key: 'txpd', label: '11B(1), 11B(2) - Adjustment of Advances', count: s11B.count, value: s11B.value },
    { key: 'hsn', label: '12 - HSN-wise summary of outward supplies', count: s12.count, value: s12.value },
    { key: 'doc', label: '13 - Documents Issued', count: s13.count, value: 0 },
  ];

  return { sections, tiles, totals };
}
