// Every section of a filed GSTR-1 JSON (the portal's own offline download,
// gst_filed_returns.full_json, pulled by the extension's gstr1_json_pull) as
// flat rows, for the full-year GSTR-1 documents report
// (src/utils/gstr1YearDocuments.ts). Pure: no Supabase, so
// scripts/verify-gstr1-year-docs.mjs runs it on fixtures.
//
// The walk is generic on purpose: a section is read by its shape (groups,
// documents, item lines), not by a fixed column list, so every section the
// portal's file carries is shown, amendments and e-commerce tables included,
// and a section the portal adds later still comes through (under its own key)
// rather than being dropped. The known sections only get a table number and a
// name.

export type Scalar = string | number | boolean;
export type FlatRow = Record<string, Scalar>;

export interface SectionInfo { table: string; name: string; order: number }

/** Known GSTR-1 sections: their table of the form and a name. */
export const SECTION_INFO: Record<string, SectionInfo> = {
  b2b: { table: '4A, 4B, 6B, 6C', name: 'B2B invoices', order: 10 },
  b2cl: { table: '5', name: 'B2C (Large) invoices', order: 20 },
  exp: { table: '6A', name: 'Exports', order: 30 },
  b2cs: { table: '7', name: 'B2C (Others)', order: 40 },
  nil: { table: '8', name: 'Nil rated, exempted and non-GST', order: 50 },
  cdnr: { table: '9B', name: 'Credit / debit notes (registered)', order: 60 },
  cdnur: { table: '9B', name: 'Credit / debit notes (unregistered)', order: 70 },
  b2ba: { table: '9A', name: 'Amended B2B invoices', order: 80 },
  b2cla: { table: '9A', name: 'Amended B2C (Large) invoices', order: 90 },
  expa: { table: '9A', name: 'Amended exports', order: 100 },
  cdnra: { table: '9C', name: 'Amended credit / debit notes (registered)', order: 110 },
  cdnura: { table: '9C', name: 'Amended credit / debit notes (unregistered)', order: 120 },
  b2csa: { table: '10', name: 'Amended B2C (Others)', order: 130 },
  at: { table: '11A(1), 11A(2)', name: 'Advances received', order: 140 },
  ata: { table: '11A', name: 'Amended advances received', order: 150 },
  txpd: { table: '11B(1), 11B(2)', name: 'Advances adjusted', order: 160 },
  txpda: { table: '11B', name: 'Amended advances adjusted', order: 170 },
  hsn: { table: '12', name: 'HSN-wise summary', order: 180 },
  doc_issue: { table: '13', name: 'Documents issued', order: 190 },
  supeco: { table: '14', name: 'Supplies through e-commerce operators', order: 200 },
  supecoa: { table: '14A', name: 'Amended supplies through e-commerce operators', order: 210 },
  ecom: { table: '15', name: 'Supplies u/s 9(5)', order: 220 },
  ecoma: { table: '15A', name: 'Amended supplies u/s 9(5)', order: 230 },
};

export const sectionInfo = (key: string): SectionInfo =>
  SECTION_INFO[key] ?? { table: '', name: key.toUpperCase(), order: 1000 };

/** Sub-section keys the portal uses, in words. */
export const SUB_SECTION_NAMES: Record<string, string> = {
  hsn_b2b: 'B2B', hsn_b2c: 'B2C',
  clttx: '14(a) Collected u/s 52', paytx: '14(b) Paid u/s 9(5)',
  b2b: 'Registered to registered', b2c: 'Registered to unregistered',
  urp2b: 'Unregistered to registered', urp2c: 'Unregistered to unregistered',
};

// Arrays the portal uses only to hold the next level: not a sub-section of their own.
const CONTAINERS = new Set(['inv', 'nt', 'itms', 'data', 'doc_det', 'docs', 'det']);
// Bookkeeping fields of the portal's file, not figures of the return.
const NOISE = new Set(['chksum', 'flag', 'updby', 'cflag', 'pflag', 'srctyp', 'irn', 'irngendate']);
// Top-level keys that describe the return, not a section.
const HEADER_KEYS = new Set(['gstin', 'fp', 'gt', 'cur_gt', 'version', 'hash', 'filing_typ', 'fil_dt', 'ret_period']);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v: unknown): v is Scalar => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

const scalarsOf = (o: Record<string, unknown>): FlatRow => {
  const out: FlatRow = {};
  for (const [k, v] of Object.entries(o)) if (isScalar(v) && !NOISE.has(k)) out[k] = v;
  // An item's figures sit in itm_det on most sections.
  if (isObj(o.itm_det)) Object.assign(out, scalarsOf(o.itm_det));
  return out;
};

export interface SectionRow { section: string; sub: string; row: FlatRow }

const walk = (node: unknown, ctx: FlatRow, section: string, sub: string, out: SectionRow[]): void => {
  if (Array.isArray(node)) { for (const n of node) walk(n, ctx, section, sub, out); return; }
  if (!isObj(node)) return;
  const here = { ...ctx, ...scalarsOf(node) };
  const children = Object.entries(node).filter(([k, v]) => k !== 'itm_det' && (Array.isArray(v) || isObj(v)));
  if (!children.length) { out.push({ section, sub, row: here }); return; }
  // Item lines: one row each, carrying the document above them.
  const itms = node.itms;
  if (Array.isArray(itms) && itms.length) {
    for (const itm of itms) out.push({ section, sub, row: { ...here, ...(isObj(itm) ? scalarsOf(itm) : {}) } });
    return;
  }
  for (const [k, v] of children) {
    if (k === 'itms') continue;
    const nextSub = CONTAINERS.has(k) ? sub : (sub ? `${sub} · ${SUB_SECTION_NAMES[k] ?? k}` : (SUB_SECTION_NAMES[k] ?? k));
    walk(v, here, section, nextSub, out);
  }
  // A document with an empty item list is still a document.
  if (Array.isArray(itms) && !itms.length && children.every(([k]) => k === 'itms')) out.push({ section, sub, row: here });
};

/** Every section of one month's GSTR-1 JSON, in the form's order. */
export const flattenGstr1 = (json: unknown): SectionRow[] => {
  if (!isObj(json)) return [];
  // `_gstk` (and any `_` key) is the extension's record of the pull, not a section.
  const keys = Object.keys(json).filter((k) => !HEADER_KEYS.has(k) && !k.startsWith('_') && (Array.isArray(json[k]) || isObj(json[k])));
  keys.sort((a, b) => sectionInfo(a).order - sectionInfo(b).order || a.localeCompare(b));
  const out: SectionRow[] = [];
  for (const k of keys) walk(json[k], {}, k, '', out);
  return out;
};

// ─── reading a row ──────────────────────────────────────────────────────────

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim());

/** dd-mm-yyyy as the portal writes it, kept as it is (the house date form). */
export const docDate = (v: unknown): string => str(v);

/** C / D on a note; a credit note takes off a total, a debit note adds. */
export const noteKind = (r: FlatRow): 'C' | 'D' | '' => {
  const t = str(r.ntty ?? r.typ_note ?? '').toUpperCase();
  return t.startsWith('C') ? 'C' : t.startsWith('D') ? 'D' : '';
};
export const isNoteSection = (section: string) => /^cdn/.test(section);
export const signOf = (section: string, r: FlatRow): 1 | -1 => (isNoteSection(section) && noteKind(r) === 'C' ? -1 : 1);

/** The document kind in words. */
export const docKind = (section: string, r: FlatRow): string => {
  if (isNoteSection(section)) return noteKind(r) === 'D' ? 'Debit note' : noteKind(r) === 'C' ? 'Credit note' : 'Note';
  if (/^(at|ata)$/.test(section)) return 'Advance received';
  if (/^(txpd|txpda)$/.test(section)) return 'Advance adjusted';
  if (/^(b2cs|b2csa)$/.test(section)) return 'Rate-wise summary';
  if (/^(supeco|supecoa)$/.test(section)) return 'Operator-wise summary';
  if (/^(exp|expa)$/.test(section)) return 'Export invoice';
  return 'Invoice';
};

/** The columns every document row is read into; the rest of its fields go to "Other details". */
const USED = new Set([
  'ctin', 'etin', 'stin', 'rtin', 'inum', 'nt_num', 'idt', 'nt_dt', 'ntty', 'oinum', 'ont_num', 'oidt', 'ont_dt', 'omon',
  'pos', 'sply_ty', 'rchrg', 'inv_typ', 'typ', 'exp_typ', 'rt', 'txval', 'ad_amt', 'suppval', 'iamt', 'camt', 'samt', 'csamt', 'val', 'num',
]);

export interface DocLine {
  section: string; sub: string;
  counterparty: string; kind: string; docNo: string; docDate: string; noteType: string;
  origNo: string; origDate: string; origMonth: string;
  pos: string; supplyType: string; reverseCharge: string; invType: string; type: string;
  rate: number | ''; taxable: number; igst: number; cgst: number; sgst: number; cess: number; docValue: number | '';
  other: string;
}

export const toDocLine = (s: SectionRow): DocLine => {
  const r = s.row;
  const other = Object.entries(r).filter(([k]) => !USED.has(k)).map(([k, v]) => `${k}: ${v}`).join('; ');
  const nt = noteKind(r);
  return {
    section: s.section, sub: s.sub,
    counterparty: str(r.ctin ?? r.etin ?? r.stin ?? r.rtin),
    kind: docKind(s.section, r),
    docNo: str(r.inum ?? r.nt_num),
    docDate: docDate(r.idt ?? r.nt_dt),
    noteType: nt,
    origNo: str(r.oinum ?? r.ont_num),
    origDate: docDate(r.oidt ?? r.ont_dt),
    origMonth: str(r.omon),
    pos: str(r.pos),
    supplyType: str(r.sply_ty),
    reverseCharge: str(r.rchrg),
    invType: str(r.inv_typ),
    type: str(r.exp_typ ?? r.typ),
    rate: r.rt === undefined || r.rt === '' ? '' : num(r.rt),
    taxable: num(r.txval ?? r.ad_amt ?? r.suppval),
    igst: num(r.iamt), cgst: num(r.camt), sgst: num(r.samt), cess: num(r.csamt),
    docValue: r.val === undefined || r.val === '' ? '' : num(r.val),
    other,
  };
};

/** The sections read into their own sheets, not the documents list. */
export const OWN_SHEET = new Set(['hsn', 'doc_issue', 'nil']);

/** A document's identity within its section and month, for counting documents (not item lines). */
export const docKey = (l: DocLine): string =>
  [l.section, l.sub, l.counterparty, l.docNo, l.docDate, l.origNo, l.pos, l.type, l.supplyType].join('|');

export const DOC_NATURE: Record<string, string> = {
  '1': 'Invoices for outward supply',
  '2': 'Invoices for inward supply from unregistered person',
  '3': 'Revised invoice',
  '4': 'Debit note',
  '5': 'Credit note',
  '6': 'Receipt voucher',
  '7': 'Payment voucher',
  '8': 'Refund voucher',
  '9': 'Delivery challan for job work',
  '10': 'Delivery challan for supply on approval',
  '11': 'Delivery challan in case of liquid gas',
  '12': 'Delivery challan in cases other than by way of supply',
};

export const NIL_SUPPLY: Record<string, string> = {
  INTRB2B: 'Inter-state supplies to registered persons',
  INTRB2C: 'Inter-state supplies to unregistered persons',
  INTRAB2B: 'Intra-state supplies to registered persons',
  INTRAB2C: 'Intra-state supplies to unregistered persons',
};

/** The extension's record of a full GSTR-1 pull (full_json._gstk, extension 0.19.1). */
export interface PullRecord {
  source: 'file' | 'sections';
  complete: boolean;
  sections: Record<string, { expected: number; read: number | null; ok: boolean; api?: string; problem?: string; failed?: string[] }>;
}

export const pullRecordOf = (json: unknown): PullRecord | null => {
  const g = json && typeof json === 'object' ? (json as Record<string, unknown>)._gstk : null;
  if (!g || typeof g !== 'object') return null;
  const r = g as Record<string, unknown>;
  return {
    source: r.source === 'file' ? 'file' : 'sections',
    complete: r.complete === true,
    sections: (r.sections && typeof r.sections === 'object' ? r.sections : {}) as PullRecord['sections'],
  };
};

/** What a record says is short, in words: "B2B 40 of 42 (2 customers did not answer), HSN not read". */
export const shortfallOf = (rec: PullRecord): string =>
  Object.entries(rec.sections).filter(([, x]) => !x.ok).map(([k, x]) => {
    const n = x.read !== null && x.read !== undefined && x.expected ? `${k} ${x.read} of ${x.expected}` : `${k} not read`;
    return x.failed && x.failed.length ? `${n} (${x.failed.length} ${x.failed.length === 1 ? 'party' : 'parties'} did not answer)` : n;
  }).join(', ');
