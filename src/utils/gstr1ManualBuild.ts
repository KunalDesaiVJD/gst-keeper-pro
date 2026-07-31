// Turns flat, spreadsheet-style invoice rows (what the manual GSTR-1 entry
// page edits) into the exact GSTR-1 JSON shape the rest of the app already
// consumes (see GSTR1DataPage.tsx's b2bRows/b2clRows/etc. parsers and
// buildGstr1Summary.ts) — and back again, so a previously-generated return
// can be re-opened for editing.
//
// Design notes (see CLAUDE.md-style rationale inline where non-obvious):
//  - Tax split (IGST vs CGST+SGST) is auto-computed from rate + taxable value
//    + place-of-supply vs the client's home state (first 2 digits of their
//    GSTIN) — the operator only types rate and taxable value.
//  - HSN (Table 12) has no per-line code inside the real B2B/B2CS JSON
//    sections; the portal treats it as a separate rollup. We ask for an HSN
//    code on every manual line and derive Table 12 from those, which is more
//    accurate than what an imported JSON gives us for free.
//  - Documents Issued (13) can't be derived from invoice content (it's about
//    serial-number continuity, including cancelled numbers) — entered as its
//    own small fixed-shape table.

export type Gstr1Section = 'b2b' | 'b2cl' | 'b2cs' | 'cdnr' | 'cdnur' | 'exp' | 'nil' | 'doc';

export interface ManualRow {
  id: string;           // client-side row id (uuid), stable across edits
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Home-state / tax-split helper
// ---------------------------------------------------------------------------

export const gstinHomeState = (gstin: string): string => (gstin || '').slice(0, 2);

/**
 * Auto-split a line's tax into IGST vs CGST+SGST based on POS vs the client's
 * home state. Intra-state (pos === home) => CGST+SGST split evenly; inter-
 * state => IGST only. Cess is never auto-computed (rare, left to the operator).
 */
export function computeTaxSplit(rt: number, txval: number, pos: string, homeState: string) {
  const taxAmt = Math.round(((Number(rt) || 0) / 100) * (Number(txval) || 0) * 100) / 100;
  const isIntraState = !!pos && !!homeState && pos === homeState;
  if (isIntraState) {
    const half = Math.round((taxAmt / 2) * 100) / 100;
    return { iamt: 0, camt: half, samt: taxAmt - half };
  }
  return { iamt: taxAmt, camt: 0, samt: 0 };
}

// ---------------------------------------------------------------------------
// GST state codes — for the POS / party-state dropdowns
// ---------------------------------------------------------------------------

export const GST_STATE_CODES: { code: string; name: string }[] = [
  { code: '01', name: 'Jammu and Kashmir' }, { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' }, { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' }, { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' }, { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' }, { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' }, { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' }, { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' }, { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' }, { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' }, { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' }, { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' }, { code: '24', name: 'Gujarat' },
  { code: '25', name: 'Daman and Diu' }, { code: '26', name: 'Dadra and Nagar Haveli' },
  { code: '27', name: 'Maharashtra' }, { code: '28', name: 'Andhra Pradesh (Old)' },
  { code: '29', name: 'Karnataka' }, { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' }, { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' }, { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' }, { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' }, { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' }, { code: '99', name: 'Centre Jurisdiction' },
];

// ---------------------------------------------------------------------------
// Section column configs — drive the generic editable grid in the UI
// ---------------------------------------------------------------------------

export interface ColumnDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'state' | 'select';
  options?: { value: string; label: string }[];
  width?: string;
  computed?: boolean; // rendered read-only, derived from other fields
}

export const SECTION_COLUMNS: Record<Exclude<Gstr1Section, 'nil' | 'doc'>, ColumnDef[]> = {
  b2b: [
    { key: 'ctin', label: 'Customer GSTIN', type: 'text', width: 'w-36' },
    { key: 'inum', label: 'Invoice No.', type: 'text', width: 'w-28' },
    { key: 'idt', label: 'Date', type: 'date', width: 'w-32' },
    { key: 'val', label: 'Invoice Value', type: 'number', width: 'w-28' },
    { key: 'pos', label: 'POS', type: 'state', width: 'w-24' },
    { key: 'rchrg', label: 'Rev. Chrg', type: 'select', options: [{ value: 'N', label: 'No' }, { value: 'Y', label: 'Yes' }], width: 'w-20' },
    { key: 'inv_typ', label: 'Type', type: 'select', options: [{ value: 'R', label: 'Regular' }, { value: 'SEWP', label: 'SEZ (Pay)' }, { value: 'SEWOP', label: 'SEZ (No Pay)' }, { value: 'DE', label: 'Deemed Exp' }], width: 'w-28' },
    { key: 'hsnCode', label: 'HSN Code', type: 'text', width: 'w-24' },
    { key: 'rt', label: 'Rate %', type: 'number', width: 'w-16' },
    { key: 'txval', label: 'Taxable Value', type: 'number', width: 'w-28' },
    { key: 'iamt', label: 'IGST', type: 'number', width: 'w-24', computed: true },
    { key: 'camt', label: 'CGST', type: 'number', width: 'w-24', computed: true },
    { key: 'samt', label: 'SGST', type: 'number', width: 'w-24', computed: true },
    { key: 'csamt', label: 'Cess', type: 'number', width: 'w-20' },
  ],
  b2cl: [
    { key: 'pos', label: 'POS', type: 'state', width: 'w-24' },
    { key: 'inum', label: 'Invoice No.', type: 'text', width: 'w-28' },
    { key: 'idt', label: 'Date', type: 'date', width: 'w-32' },
    { key: 'val', label: 'Invoice Value', type: 'number', width: 'w-28' },
    { key: 'hsnCode', label: 'HSN Code', type: 'text', width: 'w-24' },
    { key: 'rt', label: 'Rate %', type: 'number', width: 'w-16' },
    { key: 'txval', label: 'Taxable Value', type: 'number', width: 'w-28' },
    { key: 'iamt', label: 'IGST', type: 'number', width: 'w-24', computed: true },
    { key: 'csamt', label: 'Cess', type: 'number', width: 'w-20' },
  ],
  b2cs: [
    { key: 'pos', label: 'POS', type: 'state', width: 'w-24' },
    { key: 'typ', label: 'Supply', type: 'select', options: [{ value: 'OE', label: 'Inter-state (OE)' }, { value: 'INTRA', label: 'Intra-state' }], width: 'w-28' },
    { key: 'hsnCode', label: 'HSN Code', type: 'text', width: 'w-24' },
    { key: 'rt', label: 'Rate %', type: 'number', width: 'w-16' },
    { key: 'txval', label: 'Taxable Value', type: 'number', width: 'w-28' },
    { key: 'iamt', label: 'IGST', type: 'number', width: 'w-24', computed: true },
    { key: 'camt', label: 'CGST', type: 'number', width: 'w-24', computed: true },
    { key: 'samt', label: 'SGST', type: 'number', width: 'w-24', computed: true },
    { key: 'csamt', label: 'Cess', type: 'number', width: 'w-20' },
  ],
  cdnr: [
    { key: 'ctin', label: 'Customer GSTIN', type: 'text', width: 'w-36' },
    { key: 'ntNum', label: 'Note No.', type: 'text', width: 'w-28' },
    { key: 'ntDt', label: 'Note Date', type: 'date', width: 'w-32' },
    { key: 'ntTyp', label: 'Type', type: 'select', options: [{ value: 'C', label: 'Credit Note' }, { value: 'D', label: 'Debit Note' }], width: 'w-24' },
    { key: 'val', label: 'Note Value', type: 'number', width: 'w-28' },
    { key: 'pos', label: 'POS', type: 'state', width: 'w-24' },
    { key: 'hsnCode', label: 'HSN Code', type: 'text', width: 'w-24' },
    { key: 'rt', label: 'Rate %', type: 'number', width: 'w-16' },
    { key: 'txval', label: 'Taxable Value', type: 'number', width: 'w-28' },
    { key: 'iamt', label: 'IGST', type: 'number', width: 'w-24', computed: true },
    { key: 'camt', label: 'CGST', type: 'number', width: 'w-24', computed: true },
    { key: 'samt', label: 'SGST', type: 'number', width: 'w-24', computed: true },
    { key: 'csamt', label: 'Cess', type: 'number', width: 'w-20' },
  ],
  cdnur: [
    { key: 'ntNum', label: 'Note No.', type: 'text', width: 'w-28' },
    { key: 'ntDt', label: 'Note Date', type: 'date', width: 'w-32' },
    { key: 'ntTyp', label: 'Type', type: 'select', options: [{ value: 'C', label: 'Credit Note' }, { value: 'D', label: 'Debit Note' }], width: 'w-24' },
    { key: 'val', label: 'Note Value', type: 'number', width: 'w-28' },
    { key: 'pos', label: 'POS', type: 'state', width: 'w-24' },
    { key: 'hsnCode', label: 'HSN Code', type: 'text', width: 'w-24' },
    { key: 'rt', label: 'Rate %', type: 'number', width: 'w-16' },
    { key: 'txval', label: 'Taxable Value', type: 'number', width: 'w-28' },
    { key: 'iamt', label: 'IGST', type: 'number', width: 'w-24', computed: true },
    { key: 'csamt', label: 'Cess', type: 'number', width: 'w-20' },
  ],
  exp: [
    { key: 'expTyp', label: 'Type', type: 'select', options: [{ value: 'WPAY', label: 'With Payment' }, { value: 'WOPAY', label: 'Without Payment' }], width: 'w-32' },
    { key: 'inum', label: 'Invoice No.', type: 'text', width: 'w-28' },
    { key: 'idt', label: 'Date', type: 'date', width: 'w-32' },
    { key: 'val', label: 'Invoice Value', type: 'number', width: 'w-28' },
    { key: 'sbpcode', label: 'Port Code', type: 'text', width: 'w-24' },
    { key: 'sbnum', label: 'Shipping Bill No.', type: 'text', width: 'w-28' },
    { key: 'sbdt', label: 'SB Date', type: 'date', width: 'w-32' },
    { key: 'hsnCode', label: 'HSN Code', type: 'text', width: 'w-24' },
    { key: 'rt', label: 'Rate %', type: 'number', width: 'w-16' },
    { key: 'txval', label: 'Taxable Value', type: 'number', width: 'w-28' },
    { key: 'iamt', label: 'IGST', type: 'number', width: 'w-24', computed: true },
    { key: 'csamt', label: 'Cess', type: 'number', width: 'w-20' },
  ],
};

export const NIL_SUPPLY_TYPES = [
  { value: 'INTRB2B', label: 'Inter-State to Registered' },
  { value: 'INTRAB2B', label: 'Intra-State to Registered' },
  { value: 'INTRB2C', label: 'Inter-State to Unregistered' },
  { value: 'INTRAB2C', label: 'Intra-State to Unregistered' },
];

export const DOC_TYPES = [
  { value: 'Invoices for outward supply', doc_num: 1 },
  { value: 'Invoices for inward supply from unregistered person', doc_num: 2 },
  { value: 'Revised Invoice', doc_num: 3 },
  { value: 'Debit Note', doc_num: 4 },
  { value: 'Credit Note', doc_num: 5 },
  { value: 'Receipt voucher', doc_num: 6 },
  { value: 'Payment Voucher', doc_num: 7 },
  { value: 'Refund voucher', doc_num: 8 },
  { value: 'Delivery Challan for job work', doc_num: 9 },
  { value: 'Delivery Challan for supply on approval', doc_num: 10 },
  { value: 'Delivery Challan in case of liquid gas', doc_num: 11 },
  { value: 'Delivery Challan in cases other than by way of supply (excluding at S no. 9 to 11)', doc_num: 12 },
];

// ---------------------------------------------------------------------------
// Row <-> line recompute (auto tax split), used on every field edit
// ---------------------------------------------------------------------------

export function recomputeRowTax(section: Gstr1Section, row: ManualRow, homeState: string): ManualRow {
  if (section === 'b2cl' || section === 'cdnur' || section === 'exp') {
    const taxAmt = Math.round(((Number(row.rt) || 0) / 100) * (Number(row.txval) || 0) * 100) / 100;
    return { ...row, iamt: taxAmt };
  }
  if (section === 'b2cs') {
    if (row.typ === 'INTRA') {
      const taxAmt = Math.round(((Number(row.rt) || 0) / 100) * (Number(row.txval) || 0) * 100) / 100;
      const half = Math.round((taxAmt / 2) * 100) / 100;
      return { ...row, iamt: 0, camt: half, samt: taxAmt - half };
    }
    const taxAmt = Math.round(((Number(row.rt) || 0) / 100) * (Number(row.txval) || 0) * 100) / 100;
    return { ...row, iamt: taxAmt, camt: 0, samt: 0 };
  }
  if (section === 'b2b' || section === 'cdnr') {
    const split = computeTaxSplit(row.rt, row.txval, row.pos, homeState);
    return { ...row, ...split };
  }
  return row;
}

// ---------------------------------------------------------------------------
// Assemble: flat rows (by section) -> portal GSTR-1 JSON
// ---------------------------------------------------------------------------

const num = (v: any) => Number(v) || 0;

export function assembleGstr1Json(params: {
  gstin: string;
  periodShort: string; // "Jul-26"
  rowsBySection: Record<Exclude<Gstr1Section, 'nil' | 'doc'>, ManualRow[]>;
  nilRows: ManualRow[];   // { sply_ty, nil_amt, expt_amt, ngsup_amt }
  docRows: ManualRow[];   // { doc_typ, from, to, totnum, cancel }
}): any {
  const { gstin, periodShort, rowsBySection, nilRows, docRows } = params;

  // fp: MMYYYY from a short label like "Jul-26"
  const MONTH_MAP: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };
  const [mon, yr] = (periodShort || '').split('-');
  const fp = mon && yr ? `${MONTH_MAP[mon] || '01'}20${yr}` : '';

  // --- b2b: group by ctin -> inum ---
  const b2bMap = new Map<string, Map<string, any>>();
  (rowsBySection.b2b || []).forEach((r) => {
    if (!r.ctin || !r.inum) return;
    if (!b2bMap.has(r.ctin)) b2bMap.set(r.ctin, new Map());
    const invMap = b2bMap.get(r.ctin)!;
    if (!invMap.has(r.inum)) {
      invMap.set(r.inum, {
        inum: r.inum, idt: r.idt, val: num(r.val), pos: r.pos,
        rchrg: r.rchrg || 'N', inv_typ: r.inv_typ || 'R', itms: [],
      });
    }
    invMap.get(r.inum)!.itms.push({
      num: invMap.get(r.inum)!.itms.length + 1,
      itm_det: { rt: num(r.rt), txval: num(r.txval), iamt: num(r.iamt), camt: num(r.camt), samt: num(r.samt), csamt: num(r.csamt) },
    });
  });
  const b2b = Array.from(b2bMap.entries()).map(([ctin, invMap]) => ({
    ctin, inv: Array.from(invMap.values()),
  }));

  // --- b2cl: group by pos -> inum ---
  const b2clMap = new Map<string, Map<string, any>>();
  (rowsBySection.b2cl || []).forEach((r) => {
    if (!r.pos || !r.inum) return;
    if (!b2clMap.has(r.pos)) b2clMap.set(r.pos, new Map());
    const invMap = b2clMap.get(r.pos)!;
    if (!invMap.has(r.inum)) invMap.set(r.inum, { inum: r.inum, idt: r.idt, val: num(r.val), itms: [] });
    invMap.get(r.inum)!.itms.push({
      num: invMap.get(r.inum)!.itms.length + 1,
      itm_det: { rt: num(r.rt), txval: num(r.txval), iamt: num(r.iamt), csamt: num(r.csamt) },
    });
  });
  const b2cl = Array.from(b2clMap.entries()).map(([pos, invMap]) => ({ pos, inv: Array.from(invMap.values()) }));

  // --- b2cs: dedupe/sum by (pos, typ, rt) ---
  const b2csMap = new Map<string, any>();
  (rowsBySection.b2cs || []).forEach((r) => {
    const key = `${r.pos}__${r.typ}__${r.rt}`;
    const existing = b2csMap.get(key);
    if (existing) {
      existing.txval += num(r.txval); existing.iamt += num(r.iamt);
      existing.camt += num(r.camt); existing.samt += num(r.samt); existing.csamt += num(r.csamt);
    } else {
      b2csMap.set(key, { pos: r.pos, typ: r.typ, rt: num(r.rt), txval: num(r.txval), iamt: num(r.iamt), camt: num(r.camt), samt: num(r.samt), csamt: num(r.csamt) });
    }
  });
  const b2cs = Array.from(b2csMap.values());

  // --- cdnr: group by ctin -> nt_num ---
  const cdnrMap = new Map<string, Map<string, any>>();
  (rowsBySection.cdnr || []).forEach((r) => {
    if (!r.ctin || !r.ntNum) return;
    if (!cdnrMap.has(r.ctin)) cdnrMap.set(r.ctin, new Map());
    const ntMap = cdnrMap.get(r.ctin)!;
    if (!ntMap.has(r.ntNum)) {
      ntMap.set(r.ntNum, { nt_num: r.ntNum, nt_dt: r.ntDt, ntty: r.ntTyp || 'C', val: num(r.val), pos: r.pos, itms: [] });
    }
    ntMap.get(r.ntNum)!.itms.push({
      num: ntMap.get(r.ntNum)!.itms.length + 1,
      itm_det: { rt: num(r.rt), txval: num(r.txval), iamt: num(r.iamt), camt: num(r.camt), samt: num(r.samt), csamt: num(r.csamt) },
    });
  });
  const cdnr = Array.from(cdnrMap.entries()).map(([ctin, ntMap]) => ({ ctin, nt: Array.from(ntMap.values()) }));

  // --- cdnur: group by nt_num ---
  const cdnurMap = new Map<string, any>();
  (rowsBySection.cdnur || []).forEach((r) => {
    if (!r.ntNum) return;
    if (!cdnurMap.has(r.ntNum)) {
      cdnurMap.set(r.ntNum, { nt_num: r.ntNum, nt_dt: r.ntDt, ntty: r.ntTyp || 'C', val: num(r.val), pos: r.pos, typ: 'B2CL', itms: [] });
    }
    cdnurMap.get(r.ntNum)!.itms.push({
      num: cdnurMap.get(r.ntNum)!.itms.length + 1,
      itm_det: { rt: num(r.rt), txval: num(r.txval), iamt: num(r.iamt), csamt: num(r.csamt) },
    });
  });
  const cdnur = Array.from(cdnurMap.values());

  // --- exp: group by exp_typ -> inum ---
  const expMap = new Map<string, Map<string, any>>();
  (rowsBySection.exp || []).forEach((r) => {
    if (!r.inum) return;
    const typKey = r.expTyp || 'WPAY';
    if (!expMap.has(typKey)) expMap.set(typKey, new Map());
    const invMap = expMap.get(typKey)!;
    if (!invMap.has(r.inum)) {
      invMap.set(r.inum, { inum: r.inum, idt: r.idt, val: num(r.val), sbpcode: r.sbpcode || '', sbnum: r.sbnum || '', sbdt: r.sbdt || '', itms: [] });
    }
    invMap.get(r.inum)!.itms.push({ rt: num(r.rt), txval: num(r.txval), iamt: num(r.iamt), csamt: num(r.csamt) });
  });
  const exp = Array.from(expMap.entries()).map(([exp_typ, invMap]) => ({ exp_typ, inv: Array.from(invMap.values()) }));

  // --- nil: pass through, only non-empty rows ---
  const nilInv = (nilRows || [])
    .filter((r) => num(r.nil_amt) || num(r.expt_amt) || num(r.ngsup_amt))
    .map((r) => ({ sply_ty: r.sply_ty, nil_amt: num(r.nil_amt), expt_amt: num(r.expt_amt), ngsup_amt: num(r.ngsup_amt) }));

  // --- Table 12 (HSN): rolled up from every line across all sections that
  // carries an hsnCode, grouped by (hsn_sc, rate). ---
  const hsnMap = new Map<string, any>();
  const allLines: { hsnCode?: string; rt?: any; txval?: any; iamt?: any; camt?: any; samt?: any; csamt?: any }[] = [
    ...(rowsBySection.b2b || []), ...(rowsBySection.b2cl || []), ...(rowsBySection.b2cs || []),
    ...(rowsBySection.cdnr || []), ...(rowsBySection.cdnur || []), ...(rowsBySection.exp || []),
  ];
  allLines.forEach((r) => {
    const code = (r.hsnCode || '').trim();
    if (!code) return;
    const key = `${code}__${r.rt}`;
    const existing = hsnMap.get(key);
    if (existing) {
      existing.txval += num(r.txval); existing.iamt += num(r.iamt);
      existing.camt += num(r.camt); existing.samt += num(r.samt); existing.csamt += num(r.csamt);
    } else {
      hsnMap.set(key, { hsn_sc: code, rt: num(r.rt), txval: num(r.txval), iamt: num(r.iamt), camt: num(r.camt), samt: num(r.samt), csamt: num(r.csamt), uqc: 'NA', qty: 0, desc: '' });
    }
  });
  const hsnData = Array.from(hsnMap.values());

  // --- Table 13 (Documents Issued) ---
  const docDet = (docRows || [])
    .filter((r) => r.doc_typ)
    .map((r, i) => {
      const meta = DOC_TYPES.find((d) => d.value === r.doc_typ);
      const totnum = num(r.totnum);
      const cancel = num(r.cancel);
      return {
        doc_num: meta?.doc_num || i + 1,
        docs: [{ from: r.from || '', to: r.to || '', totnum, cancel, net_issue: totnum - cancel }],
      };
    });

  return {
    gstin, fp,
    b2b, b2cl, b2cs, cdnr, cdnur, exp,
    nil: { inv: nilInv },
    hsn: { data: hsnData },
    doc_issue: { doc_det: docDet },
  };
}

// ---------------------------------------------------------------------------
// Hydrate: portal JSON -> flat rows (for re-opening a generated return)
// ---------------------------------------------------------------------------

let _idSeq = 0;
const nextId = () => `row_${Date.now()}_${_idSeq++}`;

export function hydrateManualEntriesFromJson(json: any): {
  rowsBySection: Record<Exclude<Gstr1Section, 'nil' | 'doc'>, ManualRow[]>;
  nilRows: ManualRow[];
  docRows: ManualRow[];
} {
  const j = json || {};
  const b2b: ManualRow[] = [];
  (j.b2b || []).forEach((party: any) => (party.inv || []).forEach((inv: any) => (inv.itms || []).forEach((itm: any) => {
    b2b.push({
      id: nextId(), ctin: party.ctin, inum: inv.inum, idt: inv.idt, val: inv.val, pos: inv.pos,
      rchrg: inv.rchrg, inv_typ: inv.inv_typ, hsnCode: '', rt: itm.itm_det?.rt, txval: itm.itm_det?.txval,
      iamt: itm.itm_det?.iamt, camt: itm.itm_det?.camt, samt: itm.itm_det?.samt, csamt: itm.itm_det?.csamt,
    });
  })));

  const b2cl: ManualRow[] = [];
  (j.b2cl || []).forEach((state: any) => (state.inv || []).forEach((inv: any) => (inv.itms || []).forEach((itm: any) => {
    b2cl.push({ id: nextId(), pos: state.pos, inum: inv.inum, idt: inv.idt, val: inv.val, hsnCode: '', rt: itm.itm_det?.rt, txval: itm.itm_det?.txval, iamt: itm.itm_det?.iamt, csamt: itm.itm_det?.csamt });
  })));

  const b2cs: ManualRow[] = (j.b2cs || []).map((item: any) => ({ id: nextId(), pos: item.pos, typ: item.typ, hsnCode: '', rt: item.rt, txval: item.txval, iamt: item.iamt, camt: item.camt, samt: item.samt, csamt: item.csamt }));

  const cdnr: ManualRow[] = [];
  (j.cdnr || []).forEach((party: any) => (party.nt || []).forEach((nt: any) => (nt.itms || []).forEach((itm: any) => {
    cdnr.push({ id: nextId(), ctin: party.ctin, ntNum: nt.nt_num, ntDt: nt.nt_dt, ntTyp: nt.ntty || nt.typ, val: nt.val, pos: nt.pos, hsnCode: '', rt: itm.itm_det?.rt, txval: itm.itm_det?.txval, iamt: itm.itm_det?.iamt, camt: itm.itm_det?.camt, samt: itm.itm_det?.samt, csamt: itm.itm_det?.csamt });
  })));

  const cdnur: ManualRow[] = [];
  (j.cdnur || []).forEach((nt: any) => (nt.itms || []).forEach((itm: any) => {
    cdnur.push({ id: nextId(), ntNum: nt.nt_num, ntDt: nt.nt_dt, ntTyp: nt.ntty || nt.typ, val: nt.val, pos: nt.pos, hsnCode: '', rt: itm.itm_det?.rt, txval: itm.itm_det?.txval, iamt: itm.itm_det?.iamt, csamt: itm.itm_det?.csamt });
  }));

  const exp: ManualRow[] = [];
  (j.exp || []).forEach((e: any) => (e.inv || []).forEach((inv: any) => (inv.itms || []).forEach((itm: any) => {
    exp.push({ id: nextId(), expTyp: e.exp_typ, inum: inv.inum, idt: inv.idt, val: inv.val, sbpcode: inv.sbpcode, sbnum: inv.sbnum, sbdt: inv.sbdt, hsnCode: '', rt: itm.rt, txval: itm.txval, iamt: itm.iamt, csamt: itm.csamt });
  })));

  const nilRows: ManualRow[] = (j.nil?.inv || []).map((r: any) => ({ id: nextId(), sply_ty: r.sply_ty, nil_amt: r.nil_amt, expt_amt: r.expt_amt, ngsup_amt: r.ngsup_amt }));

  const docRows: ManualRow[] = [];
  (j.doc_issue?.doc_det || []).forEach((det: any) => (det.docs || []).forEach((d: any) => {
    const meta = DOC_TYPES.find((dt) => dt.doc_num === det.doc_num);
    docRows.push({ id: nextId(), doc_typ: meta?.value || '', from: d.from, to: d.to, totnum: d.totnum, cancel: d.cancel });
  }));

  return { rowsBySection: { b2b, b2cl, b2cs, cdnr, cdnur, exp }, nilRows, docRows };
}
