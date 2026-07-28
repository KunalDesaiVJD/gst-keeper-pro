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
  const s12 = acc(), s13 = acc();

  // 4A / 4B / 6B / 6C — B2B (registered), split by type.
  (j.b2b || []).forEach((party: any) => {
    (party.inv || []).forEach((inv: any) => {
      const bucket = classifyB2b(inv) === '4A' ? s4A
        : classifyB2b(inv) === '4B' ? s4B
        : classifyB2b(inv) === '6B' ? s6B : s6C;
      bucket.count += 1;
      bucket.value += num(inv.val);
      addItems(bucket, inv.itms);
    });
  });

  // 5 — B2CL (inter-state, large). Only IGST + cess apply.
  (j.b2cl || []).forEach((state: any) => {
    (state.inv || []).forEach((inv: any) => {
      s5.count += 1;
      s5.value += num(inv.val);
      addItems(s5, inv.itms);
    });
  });

  // 6A — Exports.
  (j.exp || []).forEach((exp: any) => {
    (exp.inv || []).forEach((inv: any) => {
      s6A.count += 1;
      s6A.value += num(inv.val);
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

  // 8 — Nil rated / exempted / non-GST. Value only, no tax.
  (j.nil?.inv || []).forEach((r: any) => {
    s8.count += 1;
    s8.value += num(r.nil_amt) + num(r.expt_amt) + num(r.ngsup_amt);
  });

  // 9B — Credit / Debit notes (registered).
  (j.cdnr || []).forEach((party: any) => {
    (party.nt || []).forEach((nt: any) => {
      s9BR.count += 1;
      s9BR.value += num(nt.val);
      addItems(s9BR, nt.itms);
    });
  });

  // 9B — Credit / Debit notes (unregistered).
  (j.cdnur || []).forEach((nt: any) => {
    s9BUR.count += 1;
    s9BUR.value += num(nt.val);
    addItems(s9BUR, nt.itms);
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

  // 12 — HSN summary. Value = taxable + tax.
  (j.hsn?.data || []).forEach((h: any) => {
    s12.count += 1;
    s12.igst += num(h.iamt);
    s12.cgst += num(h.camt);
    s12.sgst += num(h.samt);
    s12.cess += num(h.csamt);
    s12.value += num(h.txval) + num(h.iamt) + num(h.camt) + num(h.samt) + num(h.csamt);
  });

  // 13 — Documents issued. "count" = net documents issued across all series.
  (j.doc_issue?.doc_det || []).forEach((det: any) => {
    (det.docs || []).forEach((d: any) => {
      s13.count += num(d.net_issue);
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
    row('11A', 'Tax liability on advances received', s11A, 'Advance'),
    row('11B', 'Adjustment of advances', s11B, 'Advance'),
    row('12', 'HSN-wise summary of outward supplies', s12, '-'),
    row('13', 'Documents issued', s13, '-'),
  ];

  // Liability-bearing sections only, for the grand total (HSN is a memo of the
  // above, Documents carries no value, so both are excluded to avoid double
  // counting).
  const forTotal = [s4A, s4B, s5, s6A, s6B, s6C, s7, s9BR, s9BUR, s11A];
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
    { key: 'at', label: '11A(1), 11A(2) - Tax Liability (Advances Received)', count: s11A.count, value: s11A.value },
    { key: 'txpd', label: '11B(1), 11B(2) - Adjustment of Advances', count: s11B.count, value: s11B.value },
    { key: 'hsn', label: '12 - HSN-wise summary of outward supplies', count: s12.count, value: s12.value },
    { key: 'doc', label: '13 - Documents Issued', count: s13.count, value: 0 },
  ];

  return { sections, tiles, totals };
}
