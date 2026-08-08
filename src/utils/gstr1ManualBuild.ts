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
//    sections; the portal treats it as its own aggregate rollup, not
//    something derived from individual invoice lines — so it's entered as
//    its own flat table here too (hsn_sc/rate/taxable value/tax per row),
//    same shape GSTR1DataPage's "Edit HSN Summary" already uses for
//    imported returns. Typing a per-line HSN on every invoice/note row was
//    tried first and dropped — real Table 12 rows often span many invoices
//    at different POS, so no per-line code could honestly reconstruct it
//    anyway, and it forced re-typing the same code on every line.
//  - Documents Issued (13) can't be derived from invoice content (it's about
//    serial-number continuity, including cancelled numbers) — entered as its
//    own small fixed-shape table.

export type Gstr1Section = 'b2b' | 'b2cl' | 'b2cs' | 'cdnr' | 'cdnur' | 'exp' | 'at' | 'txpd' | 'nil' | 'doc' | 'hsn';

export interface ManualRow {
  id: string;           // client-side row id (uuid), stable across edits
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Home-state / tax-split helper
// ---------------------------------------------------------------------------

export const gstinHomeState = (gstin: string): string => (gstin || '').slice(0, 2);

// Round auto-computed tax amounts to 2 decimals (paise), not a whole rupee.
// Whole-rupee rounding was the original design, but it broke CGST/SGST
// equality on an odd tax total: splitting a pre-rounded whole-rupee amount
// in half can't divide evenly (16731 / 2 => 8366/8365), so rounding to a
// rupee FIRST is what created the mismatch. Rounding to 2 decimals instead
// keeps an exact half like 8365.50 exact on both sides — no rounding step
// forces them apart. (Still just the auto-fill starting value — every tax
// cell stays a plain editable field.)
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Auto-split a line's tax into IGST vs CGST+SGST based on POS vs the client's
 * home state. Intra-state (pos === home) => CGST+SGST split evenly; inter-
 * state => IGST only. Cess is never auto-computed (rare, left to the operator).
 * All amounts computed here are still plain editable fields in the UI — this
 * only supplies the starting value.
 */
export function computeTaxSplit(rt: number, txval: number, pos: string, homeState: string) {
  const isIntraState = !!pos && !!homeState && pos === homeState;
  if (isIntraState) {
    // CGST and SGST must come out equal — compute each independently at
    // half the rate (9% + 9% for an 18% supply) rather than computing the
    // full-rate tax once and splitting it in half. Splitting a total first
    // can't divide evenly whenever it's odd (16731 / 2 => 8366/8365 if
    // rounded to a rupee) — a real, reported bug. Computing both halves the
    // same way from the same formula guarantees they match exactly (e.g.
    // 8365.50 / 8365.50), at the (accepted, standard) cost of the pair's sum
    // occasionally differing by a paisa or two from a straight full-rate calc.
    const half = round2(((Number(rt) || 0) / 200) * (Number(txval) || 0));
    return { iamt: 0, camt: half, samt: half };
  }
  const taxAmt = round2(((Number(rt) || 0) / 100) * (Number(txval) || 0));
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

export const SECTION_COLUMNS: Record<Exclude<Gstr1Section, 'nil' | 'doc' | 'hsn'>, ColumnDef[]> = {
  b2b: [
    { key: 'ctin', label: 'Customer GSTIN', type: 'text', width: 'w-36' },
    { key: 'inum', label: 'Invoice No.', type: 'text', width: 'w-28' },
    { key: 'idt', label: 'Date', type: 'date', width: 'w-32' },
    { key: 'val', label: 'Invoice Value', type: 'number', width: 'w-28' },
    { key: 'pos', label: 'POS', type: 'state', width: 'w-24' },
    { key: 'rchrg', label: 'Rev. Chrg', type: 'select', options: [{ value: 'N', label: 'No' }, { value: 'Y', label: 'Yes' }], width: 'w-20' },
    { key: 'inv_typ', label: 'Type', type: 'select', options: [{ value: 'R', label: 'Regular' }, { value: 'SEWP', label: 'SEZ (Pay)' }, { value: 'SEWOP', label: 'SEZ (No Pay)' }, { value: 'DE', label: 'Deemed Exp' }], width: 'w-28' },
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
    { key: 'rt', label: 'Rate %', type: 'number', width: 'w-16' },
    { key: 'txval', label: 'Taxable Value', type: 'number', width: 'w-28' },
    { key: 'iamt', label: 'IGST', type: 'number', width: 'w-24', computed: true },
    { key: 'csamt', label: 'Cess', type: 'number', width: 'w-20' },
  ],
  b2cs: [
    { key: 'pos', label: 'POS', type: 'state', width: 'w-24' },
    { key: 'typ', label: 'E-Comm?', type: 'select', options: [{ value: 'OE', label: 'No (Own Supply)' }, { value: 'E', label: 'Via E-comm Operator' }], width: 'w-32' },
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
    { key: 'rt', label: 'Rate %', type: 'number', width: 'w-16' },
    { key: 'txval', label: 'Taxable Value', type: 'number', width: 'w-28' },
    { key: 'iamt', label: 'IGST', type: 'number', width: 'w-24', computed: true },
    { key: 'csamt', label: 'Cess', type: 'number', width: 'w-20' },
  ],
  at: [
    { key: 'pos', label: 'POS', type: 'state', width: 'w-24' },
    { key: 'rt', label: 'Rate %', type: 'number', width: 'w-16' },
    { key: 'ad_amt', label: 'Advance Received', type: 'number', width: 'w-32' },
    { key: 'iamt', label: 'IGST', type: 'number', width: 'w-24', computed: true },
    { key: 'camt', label: 'CGST', type: 'number', width: 'w-24', computed: true },
    { key: 'samt', label: 'SGST', type: 'number', width: 'w-24', computed: true },
    { key: 'csamt', label: 'Cess', type: 'number', width: 'w-20' },
  ],
  txpd: [
    { key: 'pos', label: 'POS', type: 'state', width: 'w-24' },
    { key: 'rt', label: 'Rate %', type: 'number', width: 'w-16' },
    { key: 'ad_amt', label: 'Advance Adjusted', type: 'number', width: 'w-32' },
    { key: 'iamt', label: 'IGST', type: 'number', width: 'w-24', computed: true },
    { key: 'camt', label: 'CGST', type: 'number', width: 'w-24', computed: true },
    { key: 'samt', label: 'SGST', type: 'number', width: 'w-24', computed: true },
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
    const taxAmt = round2(((Number(row.rt) || 0) / 100) * (Number(row.txval) || 0));
    return { ...row, iamt: taxAmt };
  }
  if (section === 'b2cs') {
    // Intra vs. inter-state must come from POS vs. home state — NOT row.typ,
    // which is the e-commerce flag (OE/E), a different field entirely. This
    // used to check row.typ === 'INTRA', a value that stopped being reachable
    // once the typ dropdown was fixed to its real OE/E meaning, so every
    // row silently fell through to the inter-state (IGST-only) branch
    // regardless of POS — producing IGST on intra-state supplies, which
    // GSTN's portal correctly rejects as a business-rule validation error
    // ("Processed with Error", not a schema rejection).
    const split = computeTaxSplit(row.rt, row.txval, row.pos, homeState);
    return { ...row, ...split };
  }
  if (section === 'b2b' || section === 'cdnr') {
    const split = computeTaxSplit(row.rt, row.txval, row.pos, homeState);
    return { ...row, ...split };
  }
  if (section === 'at' || section === 'txpd') {
    const split = computeTaxSplit(row.rt, row.ad_amt, row.pos, homeState);
    return { ...row, ...split };
  }
  return row;
}

// ---------------------------------------------------------------------------
// Assemble: flat rows (by section) -> portal GSTR-1 JSON
// ---------------------------------------------------------------------------

const num = (v: any) => Number(v) || 0;

// HTML <input type="date"> always stores/emits ISO format (YYYY-MM-DD)
// regardless of locale display — but every real portal-exported GSTR-1 JSON
// (confirmed against actual downloads) uses DD-MM-YYYY for idt/nt_dt/sbdt.
// Passing the raw ISO string through is a guaranteed schema rejection
// independent of anything else being correct. Convert at assembly time only
// — the grid itself keeps storing ISO so the date input keeps working.
const toPortalDate = (iso: string): string => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || ''; // already DD-MM-YYYY or empty — pass through
  const [, yyyy, mm, dd] = m;
  return `${dd}-${mm}-${yyyy}`;
};

export function assembleGstr1Json(params: {
  gstin: string;
  periodShort: string; // "Jul-26"
  rowsBySection: Record<Exclude<Gstr1Section, 'nil' | 'doc' | 'hsn'>, ManualRow[]>;
  nilRows: ManualRow[];   // { sply_ty, nil_amt, expt_amt, ngsup_amt }
  docRows: ManualRow[];   // { doc_typ, from, to, totnum, cancel }
  hsnRows: ManualRow[];   // { _src: 'hsn_b2b'|'hsn_b2c', hsn_sc, desc, uqc, qty, rt, txval, iamt, camt, samt, csamt }
}): any {
  const { gstin, periodShort, rowsBySection, nilRows, docRows, hsnRows } = params;
  const homeState = gstinHomeState(gstin);

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
        inum: r.inum, idt: toPortalDate(r.idt), val: num(r.val), pos: r.pos,
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
    if (!invMap.has(r.inum)) invMap.set(r.inum, { inum: r.inum, idt: toPortalDate(r.idt), val: num(r.val), itms: [] });
    invMap.get(r.inum)!.itms.push({
      num: invMap.get(r.inum)!.itms.length + 1,
      itm_det: { rt: num(r.rt), txval: num(r.txval), iamt: num(r.iamt), csamt: num(r.csamt) },
    });
  });
  const b2cl = Array.from(b2clMap.entries()).map(([pos, invMap]) => ({ pos, inv: Array.from(invMap.values()) }));

  // --- b2cs: dedupe/sum by (pos, typ, rt) ---
  // Real portal-exported JSON carries a "sply_ty" field (INTRA/INTER) on every
  // b2cs row — confirmed against a real downloaded GSTR-1 JSON
  // (24AAKFV4897J1ZF, Jul-2026): {"typ":"OE","sply_ty":"INTRA","rt":18,...}.
  // We were omitting it entirely. It's derivable from pos vs. home state, the
  // same way pos itself is derived from the customer GSTIN.
  const b2csMap = new Map<string, any>();
  (rowsBySection.b2cs || []).forEach((r) => {
    const key = `${r.pos}__${r.typ}__${r.rt}`;
    const existing = b2csMap.get(key);
    if (existing) {
      existing.txval += num(r.txval); existing.iamt += num(r.iamt);
      existing.camt += num(r.camt); existing.samt += num(r.samt); existing.csamt += num(r.csamt);
    } else {
      const sply_ty = r.pos && homeState && r.pos === homeState ? 'INTRA' : 'INTER';
      b2csMap.set(key, { pos: r.pos, typ: r.typ || 'OE', sply_ty, rt: num(r.rt), txval: num(r.txval), iamt: num(r.iamt), camt: num(r.camt), samt: num(r.samt), csamt: num(r.csamt) });
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
      ntMap.set(r.ntNum, { nt_num: r.ntNum, nt_dt: toPortalDate(r.ntDt), ntty: r.ntTyp || 'C', val: num(r.val), pos: r.pos, itms: [] });
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
      cdnurMap.set(r.ntNum, { nt_num: r.ntNum, nt_dt: toPortalDate(r.ntDt), ntty: r.ntTyp || 'C', val: num(r.val), pos: r.pos, typ: 'B2CL', itms: [] });
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
      invMap.set(r.inum, { inum: r.inum, idt: toPortalDate(r.idt), val: num(r.val), sbpcode: r.sbpcode || '', sbnum: r.sbnum || '', sbdt: toPortalDate(r.sbdt), itms: [] });
    }
    invMap.get(r.inum)!.itms.push({ rt: num(r.rt), txval: num(r.txval), iamt: num(r.iamt), csamt: num(r.csamt) });
  });
  const exp = Array.from(expMap.entries()).map(([exp_typ, invMap]) => ({ exp_typ, inv: Array.from(invMap.values()) }));

  // --- at / txpd: group by (pos, sply_ty) -> itms per rate ---
  const buildAdvanceGroups = (rows: ManualRow[]) => {
    const map = new Map<string, any>();
    rows.forEach((r) => {
      if (!r.pos || !num(r.ad_amt)) return;
      const sply_ty = r.pos && homeState && r.pos === homeState ? 'INTRA' : 'INTER';
      const key = `${r.pos}__${sply_ty}`;
      if (!map.has(key)) map.set(key, { pos: r.pos, sply_ty, itms: [] });
      map.get(key)!.itms.push({ rt: num(r.rt), ad_amt: num(r.ad_amt), iamt: num(r.iamt), camt: num(r.camt), samt: num(r.samt), csamt: num(r.csamt) });
    });
    return Array.from(map.values());
  };
  const at = buildAdvanceGroups(rowsBySection.at || []);
  const txpd = buildAdvanceGroups(rowsBySection.txpd || []);

  // --- nil: pass through, only non-empty rows ---
  const nilInv = (nilRows || [])
    .filter((r) => num(r.nil_amt) || num(r.expt_amt) || num(r.ngsup_amt))
    .map((r) => ({ sply_ty: r.sply_ty, nil_amt: num(r.nil_amt), expt_amt: num(r.expt_amt), ngsup_amt: num(r.ngsup_amt) }));

  // --- Table 12 (HSN): entered directly as its own aggregate table, not
  // derived from invoice lines — real Table 12 rows often span many
  // invoices at different POS, so no honest per-line code could reconstruct
  // it. Same bucket split GSTR1DataPage's "Edit HSN Summary" already writes
  // for imported returns: hsn_b2b for supplies to registered recipients
  // (b2b, cdnr), hsn_b2c for everything else (b2cl, b2cs, cdnur, exp).
  const hsnBuckets: { hsn_b2b: any[]; hsn_b2c: any[] } = { hsn_b2b: [], hsn_b2c: [] };
  (hsnRows || [])
    .filter((r) => String(r.hsn_sc || '').trim())
    .forEach((r) => {
      const bucket = r._src === 'hsn_b2c' ? 'hsn_b2c' : 'hsn_b2b';
      hsnBuckets[bucket].push({
        num: hsnBuckets[bucket].length + 1,
        hsn_sc: String(r.hsn_sc).trim(),
        desc: r.desc || '',
        uqc: r.uqc || 'NA',
        qty: num(r.qty),
        rt: num(r.rt),
        txval: num(r.txval),
        iamt: num(r.iamt),
        camt: num(r.camt),
        samt: num(r.samt),
        csamt: num(r.csamt),
      });
    });
  const hsnB2b = hsnBuckets.hsn_b2b;
  const hsnB2c = hsnBuckets.hsn_b2c;

  // --- Table 13 (Documents Issued) ---
  // Real portal-exported JSON (confirmed against an actual download) puts a
  // "num" (serial within the doc_num group) on EVERY docs[] entry:
  //   {"cancel":0,"from":"...","net_issue":47,"num":1,"to":"...","totnum":47}
  // We only ever emit one docs[] row per doc_num group, so num is always 1 —
  // but omitting the field entirely (as before) is a schema mismatch on its
  // own, independent of the HSN/date fixes.
  const docDet = (docRows || [])
    .filter((r) => r.doc_typ)
    .map((r, i) => {
      const meta = DOC_TYPES.find((d) => d.value === r.doc_typ);
      const totnum = num(r.totnum);
      const cancel = num(r.cancel);
      return {
        doc_num: meta?.doc_num || i + 1,
        docs: [{ num: 1, from: r.from || '', to: r.to || '', totnum, cancel, net_issue: totnum - cancel }],
      };
    });

  // Real portal-exported JSON omits a section's key entirely when there's
  // nothing in it (confirmed against actual downloads — a return with no
  // exports simply has no "exp" key, not "exp": []). Match that shape as
  // closely as possible rather than emitting empty arrays everywhere, since
  // we don't know which of these the portal's strict validator tolerates.
  const out: any = { gstin, fp };
  if (b2b.length) out.b2b = b2b;
  if (b2cl.length) out.b2cl = b2cl;
  if (b2cs.length) out.b2cs = b2cs;
  if (cdnr.length) out.cdnr = cdnr;
  if (cdnur.length) out.cdnur = cdnur;
  if (exp.length) out.exp = exp;
  if (at.length) out.at = at;
  if (txpd.length) out.txpd = txpd;
  if (nilInv.length) out.nil = { inv: nilInv };
  if (hsnB2b.length || hsnB2c.length) {
    out.hsn = {};
    if (hsnB2b.length) out.hsn.hsn_b2b = hsnB2b;
    if (hsnB2c.length) out.hsn.hsn_b2c = hsnB2c;
  }
  if (docDet.length) out.doc_issue = { doc_det: docDet };
  return out;
}

/**
 * Pre-flight check before Generate JSON: GSTN has made HSN-wise reporting
 * mandatory on GSTR-1, so a return with real taxable supplies but an empty
 * Table 12 is very likely to be rejected by the portal's upload validator
 * with the same generic "download the latest offline tool" message —
 * regardless of how correct everything else is. Table 12 is its own
 * standalone table now (not derived per invoice line), so this just checks
 * it isn't empty when there's real taxable value elsewhere in the return.
 */
export function hasMissingHsnSummary(rowsBySection: Record<Exclude<Gstr1Section, 'nil' | 'doc' | 'hsn'>, ManualRow[]>, hsnRows: ManualRow[]): boolean {
  const hasTaxableValue = (Object.keys(rowsBySection) as Exclude<Gstr1Section, 'nil' | 'doc' | 'hsn'>[])
    .some((section) => rowsBySection[section].some((r) => num(r.txval) > 0));
  const hasHsnRows = (hsnRows || []).some((r) => String(r.hsn_sc || '').trim());
  return hasTaxableValue && !hasHsnRows;
}

// Standard 15-char GSTIN shape: 2-digit state code, 10-char PAN (5 letters,
// 4 digits, 1 letter), 1-char entity number, literal 'Z', 1-char checksum.
const GSTIN_FORMAT = /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z]Z[0-9A-Za-z]$/;

/**
 * Pre-flight check before Generate JSON: a single malformed counterparty
 * GSTIN (ctin) anywhere in the return is enough for the portal's upload
 * validator to reject the whole file with the same generic "could not be
 * uploaded" message HSN and other schema problems produce — with no hint
 * which invoice or field is actually wrong. Only b2b/cdnr carry a ctin;
 * b2cl/b2cs/cdnur/exp/at/txpd address the recipient by place-of-supply, not
 * GSTIN, so they're not checked here.
 */
export function findInvalidGstinRows(rowsBySection: Record<Exclude<Gstr1Section, 'nil' | 'doc' | 'hsn'>, ManualRow[]>): { section: 'b2b' | 'cdnr'; ctin: string; inum: string }[] {
  const invalid: { section: 'b2b' | 'cdnr'; ctin: string; inum: string }[] = [];
  (['b2b', 'cdnr'] as const).forEach((section) => {
    (rowsBySection[section] || []).forEach((r) => {
      const ctin = String(r.ctin || '').trim();
      if (ctin && !GSTIN_FORMAT.test(ctin)) {
        invalid.push({ section, ctin, inum: r.inum || r.ntNum || '(row without invoice no.)' });
      }
    });
  });
  return invalid;
}

/**
 * Pre-flight check before Generate JSON: the portal requires an invoice's
 * "Invoice/Note Value" to equal the sum of its own taxable value + tax
 * (across every item line under that invoice) — even a few paise off is
 * enough to trigger the same generic "could not be uploaded" rejection.
 * A mismatch here is almost always the operator having typed a rounded
 * total from the physical invoice instead of the exact taxable + tax sum.
 * Grouped the same way assembleGstr1Json groups invoices, so a multi-item
 * invoice's components are all counted, not just one row's.
 */
export function findInvoiceValueMismatchRows(rowsBySection: Record<Exclude<Gstr1Section, 'nil' | 'doc' | 'hsn'>, ManualRow[]>): { section: 'b2b' | 'b2cl' | 'cdnr' | 'cdnur' | 'exp'; inum: string; entered: number; expected: number }[] {
  const TOLERANCE = 0.02; // absorbs float rounding noise only, not real mismatches
  const mismatches: { section: 'b2b' | 'b2cl' | 'cdnr' | 'cdnur' | 'exp'; inum: string; entered: number; expected: number }[] = [];

  const checkGroups = (section: 'b2b' | 'b2cl' | 'cdnr' | 'cdnur' | 'exp', groups: Map<string, ManualRow[]>) => {
    groups.forEach((rows) => {
      const enteredRow = rows.find((r) => num(r.val) > 0);
      if (!enteredRow) return; // nothing entered yet — handled elsewhere (e.g. required-field checks)
      const expected = round2(rows.reduce((s, r) => s + num(r.txval) + num(r.iamt) + num(r.camt) + num(r.samt) + num(r.csamt), 0));
      const entered = num(enteredRow.val);
      if (Math.abs(entered - expected) > TOLERANCE) {
        mismatches.push({ section, inum: enteredRow.inum || enteredRow.ntNum || '(row without invoice no.)', entered, expected });
      }
    });
  };

  const groupBy = (rows: ManualRow[], keyFn: (r: ManualRow) => string | null) => {
    const map = new Map<string, ManualRow[]>();
    rows.forEach((r) => {
      const key = keyFn(r);
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    return map;
  };

  checkGroups('b2b', groupBy(rowsBySection.b2b || [], (r) => (r.ctin && r.inum) ? `${r.ctin}__${r.inum}` : null));
  checkGroups('b2cl', groupBy(rowsBySection.b2cl || [], (r) => (r.pos && r.inum) ? `${r.pos}__${r.inum}` : null));
  checkGroups('cdnr', groupBy(rowsBySection.cdnr || [], (r) => (r.ctin && r.ntNum) ? `${r.ctin}__${r.ntNum}` : null));
  checkGroups('cdnur', groupBy(rowsBySection.cdnur || [], (r) => r.ntNum || null));
  checkGroups('exp', groupBy(rowsBySection.exp || [], (r) => (r.expTyp && r.inum) ? `${r.expTyp}__${r.inum}` : null));

  return mismatches;
}

// ---------------------------------------------------------------------------
// Hydrate: portal JSON -> flat rows (for re-opening a generated return)
// ---------------------------------------------------------------------------

let _idSeq = 0;
const nextId = () => `row_${Date.now()}_${_idSeq++}`;

// Reverse of toPortalDate — a portal JSON's DD-MM-YYYY needs to become ISO
// (YYYY-MM-DD) for the grid's <input type="date"> to display it, otherwise
// re-opening a generated return shows blank date pickers.
const fromPortalDate = (d: string): string => {
  const m = String(d || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return d || '';
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
};

export function hydrateManualEntriesFromJson(json: any): {
  rowsBySection: Record<Exclude<Gstr1Section, 'nil' | 'doc' | 'hsn'>, ManualRow[]>;
  nilRows: ManualRow[];
  docRows: ManualRow[];
  hsnRows: ManualRow[];
} {
  const j = json || {};
  const b2b: ManualRow[] = [];
  (j.b2b || []).forEach((party: any) => (party.inv || []).forEach((inv: any) => (inv.itms || []).forEach((itm: any) => {
    b2b.push({
      id: nextId(), ctin: party.ctin, inum: inv.inum, idt: fromPortalDate(inv.idt), val: inv.val, pos: inv.pos,
      rchrg: inv.rchrg, inv_typ: inv.inv_typ, rt: itm.itm_det?.rt, txval: itm.itm_det?.txval,
      iamt: itm.itm_det?.iamt, camt: itm.itm_det?.camt, samt: itm.itm_det?.samt, csamt: itm.itm_det?.csamt,
    });
  })));

  const b2cl: ManualRow[] = [];
  (j.b2cl || []).forEach((state: any) => (state.inv || []).forEach((inv: any) => (inv.itms || []).forEach((itm: any) => {
    b2cl.push({ id: nextId(), pos: state.pos, inum: inv.inum, idt: fromPortalDate(inv.idt), val: inv.val, rt: itm.itm_det?.rt, txval: itm.itm_det?.txval, iamt: itm.itm_det?.iamt, csamt: itm.itm_det?.csamt });
  })));

  const b2cs: ManualRow[] = (j.b2cs || []).map((item: any) => ({ id: nextId(), pos: item.pos, typ: item.typ, rt: item.rt, txval: item.txval, iamt: item.iamt, camt: item.camt, samt: item.samt, csamt: item.csamt }));

  const cdnr: ManualRow[] = [];
  (j.cdnr || []).forEach((party: any) => (party.nt || []).forEach((nt: any) => (nt.itms || []).forEach((itm: any) => {
    cdnr.push({ id: nextId(), ctin: party.ctin, ntNum: nt.nt_num, ntDt: fromPortalDate(nt.nt_dt), ntTyp: nt.ntty || nt.typ, val: nt.val, pos: nt.pos, rt: itm.itm_det?.rt, txval: itm.itm_det?.txval, iamt: itm.itm_det?.iamt, camt: itm.itm_det?.camt, samt: itm.itm_det?.samt, csamt: itm.itm_det?.csamt });
  })));

  const cdnur: ManualRow[] = [];
  (j.cdnur || []).forEach((nt: any) => (nt.itms || []).forEach((itm: any) => {
    cdnur.push({ id: nextId(), ntNum: nt.nt_num, ntDt: fromPortalDate(nt.nt_dt), ntTyp: nt.ntty || nt.typ, val: nt.val, pos: nt.pos, rt: itm.itm_det?.rt, txval: itm.itm_det?.txval, iamt: itm.itm_det?.iamt, csamt: itm.itm_det?.csamt });
  }));

  const exp: ManualRow[] = [];
  (j.exp || []).forEach((e: any) => (e.inv || []).forEach((inv: any) => (inv.itms || []).forEach((itm: any) => {
    exp.push({ id: nextId(), expTyp: e.exp_typ, inum: inv.inum, idt: fromPortalDate(inv.idt), val: inv.val, sbpcode: inv.sbpcode, sbnum: inv.sbnum, sbdt: fromPortalDate(inv.sbdt), rt: itm.rt, txval: itm.txval, iamt: itm.iamt, csamt: itm.csamt });
  })));

  const at: ManualRow[] = [];
  (j.at || []).forEach((group: any) => (group.itms || []).forEach((itm: any) => {
    at.push({ id: nextId(), pos: group.pos, rt: itm.rt, ad_amt: itm.ad_amt, iamt: itm.iamt, camt: itm.camt, samt: itm.samt, csamt: itm.csamt });
  }));

  const txpd: ManualRow[] = [];
  (j.txpd || []).forEach((group: any) => (group.itms || []).forEach((itm: any) => {
    txpd.push({ id: nextId(), pos: group.pos, rt: itm.rt, ad_amt: itm.ad_amt, iamt: itm.iamt, camt: itm.camt, samt: itm.samt, csamt: itm.csamt });
  }));

  const nilRows: ManualRow[] = (j.nil?.inv || []).map((r: any) => ({ id: nextId(), sply_ty: r.sply_ty, nil_amt: r.nil_amt, expt_amt: r.expt_amt, ngsup_amt: r.ngsup_amt }));

  // Table 13 is intentionally never hydrated from a Builder-generated return:
  // Builder Returns emits its document series under the "doc" key (not
  // "doc_issue"), and that mismatch is deliberate — document summary must
  // always start blank for staff to enter by hand, even when everything else
  // in the grid is prefilled. Do not "fix" the key name here.
  const docRows: ManualRow[] = [];
  (j.doc_issue?.doc_det || []).forEach((det: any) => (det.docs || []).forEach((d: any) => {
    const meta = DOC_TYPES.find((dt) => dt.doc_num === det.doc_num);
    docRows.push({ id: nextId(), doc_typ: meta?.value || '', from: d.from, to: d.to, totnum: d.totnum, cancel: d.cancel });
  }));

  // Table 12 — same real shape whether the source is an imported JSON or a
  // Builder-generated one; no transformation needed, just tag each row with
  // which bucket it came from so the grid's Type dropdown shows correctly
  // and re-assembly (assembleGstr1Json) puts it back in the same bucket.
  const hsnRows: ManualRow[] = [
    ...(j.hsn?.hsn_b2b || []).map((h: any) => ({ id: nextId(), _src: 'hsn_b2b', hsn_sc: h.hsn_sc, desc: h.desc, uqc: h.uqc, qty: h.qty, rt: h.rt, txval: h.txval, iamt: h.iamt, camt: h.camt, samt: h.samt, csamt: h.csamt })),
    ...(j.hsn?.hsn_b2c || []).map((h: any) => ({ id: nextId(), _src: 'hsn_b2c', hsn_sc: h.hsn_sc, desc: h.desc, uqc: h.uqc, qty: h.qty, rt: h.rt, txval: h.txval, iamt: h.iamt, camt: h.camt, samt: h.samt, csamt: h.csamt })),
  ];

  return { rowsBySection: { b2b, b2cl, b2cs, cdnr, cdnur, exp, at, txpd }, nilRows, docRows, hsnRows };
}
