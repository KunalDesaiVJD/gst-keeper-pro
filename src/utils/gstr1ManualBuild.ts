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

import { BUILDER_SAC } from './builderGstr1';

export type Gstr1Section = 'b2b' | 'b2cl' | 'b2cs' | 'cdnr' | 'cdnur' | 'exp' | 'at' | 'txpd' | 'nil' | 'doc';

export interface ManualRow {
  id: string;           // client-side row id (uuid), stable across edits
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Home-state / tax-split helper
// ---------------------------------------------------------------------------

export const gstinHomeState = (gstin: string): string => (gstin || '').slice(0, 2);

// GST portal tax figures are whole rupees on virtually every real invoice
// (paisa-level splits are a rounding artifact, not something anyone files
// on) — round every auto-computed amount to the nearest rupee.
const roundRupee = (n: number): number => Math.round(n);

/**
 * Auto-split a line's tax into IGST vs CGST+SGST based on POS vs the client's
 * home state. Intra-state (pos === home) => CGST+SGST split evenly; inter-
 * state => IGST only. Cess is never auto-computed (rare, left to the operator).
 * All amounts computed here are still plain editable fields in the UI — this
 * only supplies the starting value.
 */
export function computeTaxSplit(rt: number, txval: number, pos: string, homeState: string) {
  const taxAmt = roundRupee(((Number(rt) || 0) / 100) * (Number(txval) || 0));
  const isIntraState = !!pos && !!homeState && pos === homeState;
  if (isIntraState) {
    const half = roundRupee(taxAmt / 2);
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
    { key: 'typ', label: 'E-Comm?', type: 'select', options: [{ value: 'OE', label: 'No (Own Supply)' }, { value: 'E', label: 'Via E-comm Operator' }], width: 'w-32' },
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
    const taxAmt = roundRupee(((Number(row.rt) || 0) / 100) * (Number(row.txval) || 0));
    return { ...row, iamt: taxAmt };
  }
  if (section === 'b2cs') {
    if (row.typ === 'INTRA') {
      const taxAmt = roundRupee(((Number(row.rt) || 0) / 100) * (Number(row.txval) || 0));
      const half = roundRupee(taxAmt / 2);
      return { ...row, iamt: 0, camt: half, samt: taxAmt - half };
    }
    const taxAmt = roundRupee(((Number(row.rt) || 0) / 100) * (Number(row.txval) || 0));
    return { ...row, iamt: taxAmt, camt: 0, samt: 0 };
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
  rowsBySection: Record<Exclude<Gstr1Section, 'nil' | 'doc'>, ManualRow[]>;
  nilRows: ManualRow[];   // { sply_ty, nil_amt, expt_amt, ngsup_amt }
  docRows: ManualRow[];   // { doc_typ, from, to, totnum, cancel }
}): any {
  const { gstin, periodShort, rowsBySection, nilRows, docRows } = params;
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

  // --- Table 12 (HSN): rolled up from every line that carries an hsnCode,
  // grouped by (hsn_sc, rate). Real portal-exported JSON splits this into TWO
  // separate arrays, not one — confirmed against a real downloaded GSTR-1
  // JSON (24AAKFV4897J1ZF, Jul-2026): "hsn_b2b" totals matched exactly the
  // b2b-invoice lines, and a SEPARATE "hsn_b2c" totalled exactly the b2cs
  // lines (265000 txval in both). Emitting every line into a single
  // "hsn_b2b" array (as before) is a schema-shape mismatch on its own,
  // independent of the doc_issue/date/key-name fixes: hsn_b2b covers supplies
  // to registered recipients (b2b, cdnr), hsn_b2c covers everything else
  // (b2cl, b2cs, cdnur, exp).
  const buildHsnRollup = (lines: ManualRow[]) => {
    const map = new Map<string, any>();
    lines.forEach((r) => {
      const code = (r.hsnCode || '').trim();
      if (!code) return;
      const key = `${code}__${r.rt}`;
      const existing = map.get(key);
      if (existing) {
        existing.txval += num(r.txval); existing.iamt += num(r.iamt);
        existing.camt += num(r.camt); existing.samt += num(r.samt); existing.csamt += num(r.csamt);
      } else {
        map.set(key, { hsn_sc: code, rt: num(r.rt), txval: num(r.txval), iamt: num(r.iamt), camt: num(r.camt), samt: num(r.samt), csamt: num(r.csamt), uqc: 'NA', qty: 0, desc: '', user_desc: '' });
      }
    });
    return Array.from(map.values()).map((h, i) => ({ num: i + 1, ...h }));
  };
  const hsnB2b = buildHsnRollup([...(rowsBySection.b2b || []), ...(rowsBySection.cdnr || [])]);
  const hsnB2c = buildHsnRollup([...(rowsBySection.b2cl || []), ...(rowsBySection.b2cs || []), ...(rowsBySection.cdnur || []), ...(rowsBySection.exp || [])]);

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
 * mandatory on GSTR-1, so a return with real taxable supplies but zero HSN
 * entries is very likely to be rejected by the portal's upload validator
 * with the same generic "download the latest offline tool" message —
 * regardless of how correct everything else is. Flag rows missing an HSN
 * code so the operator can fix them before wasting an upload attempt.
 */
export function findMissingHsnRows(rowsBySection: Record<Exclude<Gstr1Section, 'nil' | 'doc'>, ManualRow[]>): { section: Gstr1Section; inum: string }[] {
  const missing: { section: Gstr1Section; inum: string }[] = [];
  (Object.keys(rowsBySection) as Exclude<Gstr1Section, 'nil' | 'doc'>[]).forEach((section) => {
    rowsBySection[section].forEach((r) => {
      const hasValue = num(r.txval) > 0;
      const hasHsn = !!(r.hsnCode || '').trim();
      if (hasValue && !hasHsn) missing.push({ section, inum: r.inum || r.ntNum || '(row without invoice no.)' });
    });
  });
  return missing;
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
  rowsBySection: Record<Exclude<Gstr1Section, 'nil' | 'doc'>, ManualRow[]>;
  nilRows: ManualRow[];
  docRows: ManualRow[];
} {
  const j = json || {};
  const b2b: ManualRow[] = [];
  (j.b2b || []).forEach((party: any) => (party.inv || []).forEach((inv: any) => (inv.itms || []).forEach((itm: any) => {
    b2b.push({
      id: nextId(), ctin: party.ctin, inum: inv.inum, idt: fromPortalDate(inv.idt), val: inv.val, pos: inv.pos,
      rchrg: inv.rchrg, inv_typ: inv.inv_typ, hsnCode: '', rt: itm.itm_det?.rt, txval: itm.itm_det?.txval,
      iamt: itm.itm_det?.iamt, camt: itm.itm_det?.camt, samt: itm.itm_det?.samt, csamt: itm.itm_det?.csamt,
    });
  })));

  const b2cl: ManualRow[] = [];
  (j.b2cl || []).forEach((state: any) => (state.inv || []).forEach((inv: any) => (inv.itms || []).forEach((itm: any) => {
    b2cl.push({ id: nextId(), pos: state.pos, inum: inv.inum, idt: fromPortalDate(inv.idt), val: inv.val, hsnCode: '', rt: itm.itm_det?.rt, txval: itm.itm_det?.txval, iamt: itm.itm_det?.iamt, csamt: itm.itm_det?.csamt });
  })));

  // Builder Returns has no per-line HSN (the whole return is one SAC), so
  // default it here for those prefilled rows only — a manually-uploaded
  // JSON still hydrates with a blank hsnCode as before.
  const defaultHsn = j._source === 'BUILDER_RETURNS' ? BUILDER_SAC : '';
  const b2cs: ManualRow[] = (j.b2cs || []).map((item: any) => ({ id: nextId(), pos: item.pos, typ: item.typ, hsnCode: defaultHsn, rt: item.rt, txval: item.txval, iamt: item.iamt, camt: item.camt, samt: item.samt, csamt: item.csamt }));

  const cdnr: ManualRow[] = [];
  (j.cdnr || []).forEach((party: any) => (party.nt || []).forEach((nt: any) => (nt.itms || []).forEach((itm: any) => {
    cdnr.push({ id: nextId(), ctin: party.ctin, ntNum: nt.nt_num, ntDt: fromPortalDate(nt.nt_dt), ntTyp: nt.ntty || nt.typ, val: nt.val, pos: nt.pos, hsnCode: '', rt: itm.itm_det?.rt, txval: itm.itm_det?.txval, iamt: itm.itm_det?.iamt, camt: itm.itm_det?.camt, samt: itm.itm_det?.samt, csamt: itm.itm_det?.csamt });
  })));

  const cdnur: ManualRow[] = [];
  (j.cdnur || []).forEach((nt: any) => (nt.itms || []).forEach((itm: any) => {
    cdnur.push({ id: nextId(), ntNum: nt.nt_num, ntDt: fromPortalDate(nt.nt_dt), ntTyp: nt.ntty || nt.typ, val: nt.val, pos: nt.pos, hsnCode: '', rt: itm.itm_det?.rt, txval: itm.itm_det?.txval, iamt: itm.itm_det?.iamt, csamt: itm.itm_det?.csamt });
  }));

  const exp: ManualRow[] = [];
  (j.exp || []).forEach((e: any) => (e.inv || []).forEach((inv: any) => (inv.itms || []).forEach((itm: any) => {
    exp.push({ id: nextId(), expTyp: e.exp_typ, inum: inv.inum, idt: fromPortalDate(inv.idt), val: inv.val, sbpcode: inv.sbpcode, sbnum: inv.sbnum, sbdt: fromPortalDate(inv.sbdt), hsnCode: '', rt: itm.rt, txval: itm.txval, iamt: itm.iamt, csamt: itm.csamt });
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

  return { rowsBySection: { b2b, b2cl, b2cs, cdnr, cdnur, exp, at, txpd }, nilRows, docRows };
}
