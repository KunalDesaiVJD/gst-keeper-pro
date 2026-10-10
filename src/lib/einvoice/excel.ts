// Parser for the GST portal's "Download details from e-invoices (Excel)"
// (GSTR-1 dashboard → Prepare Online). Pure: takes a parsed workbook, no I/O.
//
// What the file is (GSTN advisory on auto-population of e-invoice details
// into GSTR-1, paras 9-11; GSTR-1 user guide, section C): one workbook per
// return period, built from the IRP's data, listing every e-invoice
// including cancelled ones, with the IRN, the IRN date, the e-invoice status
// (Valid / Cancelled), the date and status of auto-population into GSTR-1
// (Auto-populated / Deleted / Auto-population failed / Deletion failed) and
// an error description. It does not reflect later edits made in GSTR-1.
// Up to 500 documents download at once; larger files come through
// "E-invoice download history" as a ZIP holding the workbook (the caller
// unzips).
//
// Layout, as far as it is published: a "Read me" sheet (Financial Year, Tax
// Period MMYYYY, GSTIN, Legal Name, Trade Name, Date Updated till, then the
// field list) and one sheet per table: "b2b, sez, de", "cdnr", "cdnur",
// "exp", "hsn(b2b)", "hsn(b2c)" (user guide screenshot). The columns follow
// the GSTR-1 offline-tool template ("GSTIN/UIN of Recipient", "Receiver
// Name", "Invoice Number", "Invoice date", "Invoice Value", "Place Of
// Supply", "Reverse Charge", "Applicable % of Tax Rate", "Invoice Type",
// "E-Commerce GSTIN", "Rate", "Taxable Value", "Cess Amount"; notes use
// "Note Number", "Note Date", "Note Type", "Note Value") plus "IRN", "IRN
// date", "E-invoice status" and the auto-population columns. GSTN's offline
// tool imports the same file, reads 'E-invoice status' and skips rows whose
// status is 'Cancelled'. The exact text of the auto-population headers and
// whether tax amounts have their own columns are NOT confirmed against a
// downloaded file, so the parser finds the header row by its IRN column and
// maps every column by pattern, never by position.
//
// One row per rate: rows of the same document (same table, buyer, type,
// number and IRN) are summed into one document. Tax amounts come from their
// own columns when the sheet has them; otherwise they are worked out from
// Rate × Taxable value (× Applicable %), IGST for an inter-state supply,
// SEZ or export, CGST + SGST halves within the state.
//
// "Reverse Charge", "E-Commerce GSTIN" and, on the exp sheet, "Shipping Bill
// Number", "Shipping Bill Date" and "Port Code" are read too: the
// reconciliation blocks a document whose reverse charge, type or e-commerce
// GSTIN differs from the books, and warns about an export whose books
// shipping bill the e-invoice lacks.

import * as XLSX from 'xlsx';
import {
  exactDocNo, yesNo,
  type EinvAutopopStatus, type EinvDoc, type EinvDocType, type EinvIrnStatus, type EinvSection,
} from './einvoice';

export interface EinvExcelDoc extends EinvDoc {
  irn: string;
  source: 'einvoice_excel';
  irn_status: EinvIrnStatus;
  autopop_status: EinvAutopopStatus | null;
  autopop_date: string | null;
  error: string | null;
  /** The status text as the file has it (for display). */
  autopop_text: string | null;
  sheet: string;
  /** 1-based Excel row numbers the document was read from. */
  rows: number[];
}

export interface EinvExcelSkip {
  sheet: string;
  /** 1-based Excel row number; null for the whole sheet. */
  row: number | null;
  reason: string;
}

export interface EinvExcelMeta {
  gstin: string | null;
  /** MM/YYYY, from the Read me sheet's Tax Period (MMYYYY). */
  period_month: string | null;
  financial_year: string | null;
  updated_till: string | null;
}

export interface EinvExcelResult {
  docs: EinvExcelDoc[];
  /** Sheets read as document tables. */
  sheets: string[];
  skipped: EinvExcelSkip[];
  meta: EinvExcelMeta;
}

export interface EinvExcelOptions {
  /** The client's GSTIN: decides inter- or intra-state when the sheet has no tax columns. */
  supplierGstin?: string | null;
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

type Cell = XLSX.CellObject | undefined;

const cellAt = (ws: XLSX.WorkSheet, r: number, c: number): Cell => ws[XLSX.utils.encode_cell({ r, c })] as Cell;

/** The cell as text (what the user sees for numbers; the value for text). */
const cellText = (cell: Cell): string => {
  if (!cell || cell.v == null) return '';
  if (cell.t === 's') return String(cell.v).trim();
  if (cell.t === 'n') return (cell.w != null ? String(cell.w) : String(cell.v)).trim();
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  if (cell.t === 'd' && cell.v instanceof Date) return cell.v.toISOString();
  return String(cell.w ?? cell.v).trim();
};

/** A number from a numeric cell or from text such as '1,23,456.00' or '₹ 500'. */
export const parseAmount = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').trim();
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[,\s₹]|Rs\.?|INR/gi, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
};

/** A document number: a whole number stored as a number reads as its digits, never '1.23E+11'. */
const docNoText = (cell: Cell): string =>
  (cell && cell.t === 'n' && Number.isInteger(Number(cell.v)) ? String(cell.v) : cellText(cell));

const cellNum = (cell: Cell): number => (cell && cell.t === 'n' ? Number(cell.v) || 0 : parseAmount(cellText(cell)));

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const pad2 = (n: number | string) => String(n).padStart(2, '0');
const dmy = (d: number, m: number, y: number): string | null =>
  d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 ? `${pad2(d)}-${pad2(m)}-${y}` : null;

/** Any date the file may hold (Excel serial, Date, dd-mm-yyyy, dd-MMM-yyyy, yyyy-mm-dd, with or without a time) → dd-mm-yyyy. */
export const parseDateText = (v: unknown): string | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : dmy(v.getDate(), v.getMonth() + 1, v.getFullYear());
  if (typeof v === 'number') {
    const p = XLSX.SSF.parse_date_code(v) as { y: number; m: number; d: number } | null;
    return p ? dmy(p.d, p.m, p.y) : null;
  }
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})\b/.exec(s);
  if (m) return dmy(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/., ]+(\d{2,4})\b/.exec(s);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return mon ? dmy(+m[1], mon, y) : null;
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return dmy(+m[3], +m[2], +m[1]);
  return null;
};

const cellDate = (cell: Cell): string | null => {
  if (!cell || cell.v == null || cell.v === '') return null;
  if (cell.t === 'n') return parseDateText(Number(cell.v));
  if (cell.t === 'd') return parseDateText(cell.v);
  return parseDateText(cellText(cell));
};

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/** Lower-case, numbering ("1. ") and punctuation stripped: 'GSTIN/UIN of Recipient' → 'gstin uin of recipient'. */
const normHeader = (h: string): string =>
  h.toLowerCase().replace(/^\s*\d+\s*[.)]\s*/, '').replace(/[^a-z0-9]+/g, ' ').trim();

type Field =
  | 'irn' | 'irn_date' | 'irn_status' | 'autopop_status' | 'autopop_date' | 'error'
  | 'ctin' | 'doc_no' | 'doc_date' | 'doc_value' | 'pos' | 'diff' | 'inv_type' | 'note_type'
  | 'rate' | 'taxable' | 'igst' | 'cgst' | 'sgst' | 'cess'
  | 'rchrg' | 'etin' | 'sbnum' | 'sbdt' | 'sbpcode';

const DOC = '(invoice|note|document|doc|debit note credit note|credit note debit note|debit credit note|credit debit note|dr cr note|cr dr note|cdn)';

/** First match wins; each column goes to one field. */
const FIELD_PATTERNS: [Field, (h: string) => boolean][] = [
  ['irn', (h) => h === 'irn' || h === 'invoice reference number' || h === 'invoice reference number irn'],
  ['irn_date', (h) => /^(irn (date|dt|generation date|gen date|generated date)|date of irn|irn generation date|ack date|acknowledgement date|invoice reference number date)$/.test(h)],
  ['irn_status', (h) => /^(e ?invoice status|irn status|e ?invoice irn status|status of e ?invoice)$/.test(h)],
  ['autopop_date', (h) => /auto ?populat/.test(h) && /date/.test(h)],
  ['autopop_status', (h) => /auto ?populat/.test(h) && !/date/.test(h)],
  ['error', (h) => /error/.test(h)],
  ['ctin', (h) => /^(gstin|uin|gstin uin)( of)? (the )?(recipient|receiver|buyer|customer)$/.test(h)
    || /^(recipient|receiver|buyer|customer)( s)? (gstin|uin|gstin uin)$/.test(h) || h === 'ctin' || h === 'gstin uin'],
  ['doc_no', (h) => new RegExp(`^${DOC} (number|no|num)$`).test(h)],
  ['doc_date', (h) => new RegExp(`^${DOC} date$`).test(h)],
  ['doc_value', (h) => new RegExp(`^(total )?${DOC} value$`).test(h)],
  ['pos', (h) => /^place of supply/.test(h) || h === 'pos'],
  ['diff', (h) => /^applicable( of)? tax rate$/.test(h) || /^applicable/.test(h)],
  ['note_type', (h) => /^(note type|document type|type of note|debit note credit note type|credit note debit note type|note type c d)$/.test(h)],
  ['inv_type', (h) => /^(invoice type|note supply type|supply type|ur type|export type|type of export)$/.test(h)],
  ['rate', (h) => /^(rate|tax rate|gst rate|rate of tax)$/.test(h)],
  ['taxable', (h) => /^(total )?taxable (value|amount)$/.test(h) || h === 'taxable'],
  ['igst', (h) => /^(integrated tax|igst)( amount| amt| paid)?$/.test(h)],
  ['cgst', (h) => /^(central tax|cgst)( amount| amt| paid)?$/.test(h)],
  ['sgst', (h) => /^(state ut tax|state tax|ut tax|sgst|utgst|sgst utgst)( amount| amt| paid)?$/.test(h)],
  ['cess', (h) => /^cess( amount| amt| paid)?$/.test(h)],
  ['rchrg', (h) => /^reverse charge/.test(h) || h === 'rchrg' || h === 'rcm'],
  ['etin', (h) => /^(e ?commerce|ecom)( operator)? gstin( uin)?$/.test(h) || h === 'etin'],
  ['sbnum', (h) => /^shipping bill( no| number| num)?$/.test(h)],
  ['sbdt', (h) => /^shipping bill date$/.test(h)],
  ['sbpcode', (h) => /^(port code|shipping port code)$/.test(h)],
];

const IRN_HEADER = /^\s*IRN\s*$/i;

function mapColumns(ws: XLSX.WorkSheet, range: XLSX.Range, headerRow: number): Partial<Record<Field, number>> {
  const cols: Partial<Record<Field, number>> = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    let text = cellText(cellAt(ws, headerRow, c));
    // A two-row header leaves a blank under a merged group title: use the title.
    if (!text && headerRow > range.s.r) text = cellText(cellAt(ws, headerRow - 1, c));
    const h = normHeader(text);
    if (!h) continue;
    const hit = FIELD_PATTERNS.find(([f, test]) => cols[f] === undefined && test(h));
    if (hit) cols[hit[0]] = c;
  }
  return cols;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const sectionFromSheetName = (name: string): EinvSection | 'skip_hsn' | 'skip_info' | null => {
  const n = name.toLowerCase();
  const compact = n.replace(/[^a-z0-9]/g, '');
  if (/read ?me|help|instruction/.test(n)) return 'skip_info';
  if (/^hsn/.test(compact)) return 'skip_hsn';
  if (/^b2b(?!a)/.test(compact)) return 'b2b';
  if (/^cdnr(?!a)/.test(compact)) return 'cdnr';
  if (/^cdnur(?!a)/.test(compact)) return 'cdnur';
  if (/^exp(?!a)/.test(compact)) return 'exp';
  if (/^b2cl(?!a)/.test(compact)) return 'b2cl';
  return null;
};

const sectionFromColumns = (cols: Partial<Record<Field, number>>, headerTexts: string[]): EinvSection | null => {
  const isNote = headerTexts.some((h) => /^(note|debit note credit note|credit note debit note|debit credit note|credit debit note|dr cr note) (number|no)$/.test(h));
  if (isNote) return cols.ctin !== undefined ? 'cdnr' : 'cdnur';
  if (cols.sbnum !== undefined || cols.sbdt !== undefined || cols.sbpcode !== undefined
    || headerTexts.some((h) => /^export type$/.test(h))) return 'exp';
  if (cols.ctin !== undefined) return 'b2b';
  return null;
};

const noteTypeOf = (v: string): EinvDocType | null => {
  const s = v.trim().toUpperCase();
  if (!s) return null;
  if (s.startsWith('D')) return 'DBN';
  if (s.startsWith('C')) return 'CRN';
  return null;
};

const invTypeCode = (v: string): string | null => {
  const s = v.trim();
  if (!s) return null;
  const l = s.toLowerCase();
  if (/sez/.test(l) && /without/.test(l)) return 'SEWOP';
  if (/sez/.test(l) && /with/.test(l)) return 'SEWP';
  if (/deemed/.test(l)) return 'DE';
  if (/intra.*igst/.test(l)) return 'CBW';
  if (/^regular/.test(l)) return 'R';
  return s.toUpperCase().replace(/\s+/g, '');
};

const posCode = (v: string): string | null => {
  const m = /^\s*(\d{1,2})\b/.exec(v);
  return m ? pad2(m[1]) : null;
};

/** 'Valid' / 'Cancelled' → valid / cancelled (blank reads as valid). */
const irnStatusOf = (v: string): EinvIrnStatus => (/cancel/i.test(v) ? 'cancelled' : 'valid');

/**
 * GSTR-1 auto-population status. 'Auto-populated' → done; 'Auto-population
 * failed' (or an error description) → failed; anything that reads as
 * waiting → pending; 'Deleted' / 'Deletion failed' concern a cancelled IRN
 * and blank is unknown → null.
 */
export const autopopStatusOf = (status: string, error: string): EinvAutopopStatus | null => {
  const s = status.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/auto ?populat\w* fail|fail\w* (to |in )?auto ?populat|not auto ?populated/.test(s)) return 'failed';
  if (/pending|progress|yet to|queue|processing|to be auto/.test(s)) return 'pending';
  if (/auto ?populated|^success/.test(s)) return 'done';
  if (/delet/.test(s)) return null;
  if (/fail|error|reject/.test(s)) return 'failed';
  if (!s && error.trim()) return 'failed';
  return null;
};

// ---------------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------------

function readMeta(wb: XLSX.WorkBook): EinvExcelMeta {
  const meta: EinvExcelMeta = { gstin: null, period_month: null, financial_year: null, updated_till: null };
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const lastRow = Math.min(range.e.r, range.s.r + 15);
    for (let r = range.s.r; r <= lastRow; r++) {
      for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 8); c++) {
        const label = normHeader(cellText(cellAt(ws, r, c)));
        if (!label) continue;
        let value = '';
        for (let c2 = c + 1; c2 <= Math.min(range.e.c, c + 4) && !value; c2++) value = cellText(cellAt(ws, r, c2));
        if (!value) continue;
        if (label === 'gstin' && !meta.gstin && /^[0-9]{2}[A-Z0-9]{13}$/i.test(value)) meta.gstin = value.toUpperCase();
        else if ((label === 'tax period' || label === 'return period') && !meta.period_month) {
          let digits = value.replace(/\D/g, '');
          if (digits.length === 5) digits = `0${digits}`; // 092023 stored as a number
          const m = /^(\d{2})(\d{4})$/.exec(digits);
          if (m) meta.period_month = `${m[1]}/${m[2]}`;
        } else if (label === 'financial year' && !meta.financial_year) meta.financial_year = value;
        else if (/^date updated/.test(label) && !meta.updated_till) meta.updated_till = value;
      }
    }
    if (meta.gstin && meta.period_month) break;
  }
  return meta;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

interface Line {
  row: number;
  ctin: string;
  doc_no: string;
  doc_type: EinvDocType;
  doc_date: string | null;
  doc_value: number;
  pos: string | null;
  inv_typ: string | null;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  irn: string;
  irn_date: string | null;
  irn_status: EinvIrnStatus;
  autopop_status: EinvAutopopStatus | null;
  autopop_text: string | null;
  autopop_date: string | null;
  error: string | null;
  rchrg: string | null;
  etin: string | null;
  sbnum: string | null;
  sbdt: string | null;
  sbpcode: string | null;
}

/**
 * Every e-invoice in the workbook, one per document (rate rows summed).
 * Cancelled IRNs are returned with irn_status 'cancelled' (reconcileEinvoice
 * ignores them). Never throws on a strange sheet: it goes in `skipped`.
 */
export function parseEinvoiceExcel(wb: XLSX.WorkBook, opts: EinvExcelOptions = {}): EinvExcelResult {
  const skipped: EinvExcelSkip[] = [];
  const sheets: string[] = [];
  const meta = readMeta(wb);
  const supplierState = (opts.supplierGstin || meta.gstin || '').slice(0, 2);
  const groups = new Map<string, { section: EinvSection; sheet: string; lines: Line[] }>();

  for (const name of wb.SheetNames || []) {
    try {
      const ws = wb.Sheets[name];
      const byName = sectionFromSheetName(name);
      if (byName === 'skip_info') continue; // the Read me sheet: meta only
      if (byName === 'skip_hsn') { skipped.push({ sheet: name, row: null, reason: 'HSN summary, not a document table' }); continue; }
      if (!ws || !ws['!ref']) { skipped.push({ sheet: name, row: null, reason: 'Empty sheet' }); continue; }
      const range = XLSX.utils.decode_range(ws['!ref']);

      let headerRow = -1;
      for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 40) && headerRow < 0; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          if (IRN_HEADER.test(cellText(cellAt(ws, r, c)))) { headerRow = r; break; }
        }
      }
      if (headerRow < 0) { skipped.push({ sheet: name, row: null, reason: 'No IRN column found' }); continue; }

      const cols = mapColumns(ws, range, headerRow);
      const headerTexts: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) headerTexts.push(normHeader(cellText(cellAt(ws, headerRow, c))));
      const section = byName ?? sectionFromColumns(cols, headerTexts);
      if (!section) { skipped.push({ sheet: name, row: null, reason: 'Could not tell which GSTR-1 table this sheet holds' }); continue; }
      if (cols.doc_no === undefined) { skipped.push({ sheet: name, row: null, reason: 'No document number column found' }); continue; }
      const isNote = section === 'cdnr' || section === 'cdnur';
      const needsCtin = section === 'b2b' || section === 'cdnr';
      if (needsCtin && cols.ctin === undefined) { skipped.push({ sheet: name, row: null, reason: 'No recipient GSTIN column found' }); continue; }
      if (isNote && cols.note_type === undefined) skipped.push({ sheet: name, row: null, reason: 'No note type column: notes read as credit notes' });
      const hasTaxCols = cols.igst !== undefined || cols.cgst !== undefined || cols.sgst !== undefined;
      if (!hasTaxCols && !supplierState && section !== 'exp') {
        skipped.push({ sheet: name, row: null, reason: 'No tax columns and no supplier GSTIN: tax read as IGST' });
      }
      sheets.push(name);

      const get = (r: number, f: Field): Cell => (cols[f] === undefined ? undefined : cellAt(ws, r, cols[f]!));
      const lastIrnByIdentity = new Map<string, string>();

      for (let r = headerRow + 1; r <= range.e.r; r++) {
        const excelRow = r + 1;
        let filled = 0;
        for (let c = range.s.c; c <= range.e.c; c++) if (cellText(cellAt(ws, r, c))) filled += 1;
        if (!filled) continue;

        const docNo = docNoText(get(r, 'doc_no'));
        let irn = cellText(get(r, 'irn'));
        if (IRN_HEADER.test(irn)) continue; // a repeated header row
        const ctin = needsCtin ? cellText(get(r, 'ctin')).toUpperCase() : '';
        if (!docNo) {
          if (irn) skipped.push({ sheet: name, row: excelRow, reason: 'IRN without a document number' });
          else if (filled >= 3) skipped.push({ sheet: name, row: excelRow, reason: 'No document number or IRN' });
          continue;
        }
        if (needsCtin && !ctin) { skipped.push({ sheet: name, row: excelRow, reason: 'No recipient GSTIN' }); continue; }
        const docType: EinvDocType = isNote ? (noteTypeOf(cellText(get(r, 'note_type'))) ?? 'CRN') : 'INV';
        const identity = `${section}|${ctin}|${docType}|${exactDocNo(docNo)}`;
        if (!irn) {
          // A further rate row of a document whose first row carried the IRN.
          const prev = lastIrnByIdentity.get(identity);
          if (!prev) { skipped.push({ sheet: name, row: excelRow, reason: 'No IRN' }); continue; }
          irn = prev;
        }
        lastIrnByIdentity.set(identity, irn);

        const invTyp = invTypeCode(cellText(get(r, 'inv_type')));
        const posRaw = cellText(get(r, 'pos'));
        const pos = section === 'exp' ? null : posCode(posRaw);
        const taxable = cellNum(get(r, 'taxable'));
        const cess = cellNum(get(r, 'cess'));
        let igst = 0;
        let cgst = 0;
        let sgst = 0;
        if (hasTaxCols) {
          igst = cellNum(get(r, 'igst'));
          cgst = cellNum(get(r, 'cgst'));
          sgst = cellNum(get(r, 'sgst'));
        } else {
          const rate = cellNum(get(r, 'rate'));
          const diffCell = cellText(get(r, 'diff'));
          const factor = diffCell ? parseAmount(diffCell) / 100 || 1 : 1;
          const tax = (taxable * rate * factor) / 100;
          const noPay = /WOPAY|WOP$|EXPWOP|SEWOP/i.test(invTyp || '');
          const inter = section === 'exp' || /^(SEWP|SEWOP|CBW|EXPWP|EXPWOP)$/.test(invTyp || '')
            || !supplierState || !pos || pos !== supplierState;
          if (noPay) { /* without payment of tax: no tax */ }
          else if (inter) igst = round2(tax);
          else { cgst = round2(tax / 2); sgst = round2(tax / 2); }
        }
        const statusText = cellText(get(r, 'autopop_status'));
        const errorText = cellText(get(r, 'error'));
        const line: Line = {
          row: excelRow,
          ctin,
          doc_no: docNo,
          doc_type: docType,
          doc_date: cellDate(get(r, 'doc_date')),
          doc_value: cellNum(get(r, 'doc_value')),
          pos,
          inv_typ: invTyp,
          taxable, igst, cgst, sgst, cess,
          irn,
          irn_date: cellDate(get(r, 'irn_date')),
          irn_status: irnStatusOf(cellText(get(r, 'irn_status'))),
          autopop_status: autopopStatusOf(statusText, errorText),
          autopop_text: statusText || null,
          autopop_date: cellDate(get(r, 'autopop_date')),
          error: errorText || null,
          rchrg: yesNo(cellText(get(r, 'rchrg'))),
          etin: cellText(get(r, 'etin')).toUpperCase() || null,
          sbnum: section === 'exp' ? docNoText(get(r, 'sbnum')) || null : null,
          sbdt: section === 'exp' ? cellDate(get(r, 'sbdt')) : null,
          sbpcode: section === 'exp' ? cellText(get(r, 'sbpcode')).toUpperCase() || null : null,
        };
        const key = `${identity}|${irn.toLowerCase()}`;
        const g = groups.get(key);
        if (g) g.lines.push(line);
        else groups.set(key, { section, sheet: name, lines: [line] });
      }
    } catch (err) {
      skipped.push({ sheet: name, row: null, reason: `Could not read the sheet: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  // Rate rows → documents.
  const docs: EinvExcelDoc[] = [];
  groups.forEach(({ section, sheet, lines }) => {
    const f = lines[0];
    const first = <K extends keyof Line>(k: K): Line[K] => (lines.find((l) => l[k] != null && l[k] !== '' && l[k] !== 0) ?? f)[k];
    const sum = (k: 'taxable' | 'igst' | 'cgst' | 'sgst' | 'cess') => round2(lines.reduce((n, l) => n + l[k], 0));
    docs.push({
      section,
      ctin: f.ctin,
      doc_type: f.doc_type,
      doc_no: f.doc_no,
      doc_key: exactDocNo(f.doc_no),
      doc_date: first('doc_date'),
      irn: f.irn,
      irn_date: first('irn_date'),
      inv_typ: first('inv_typ'),
      pos: first('pos'),
      // The document value repeats on every rate row: taken once, not summed.
      doc_value: round2(first('doc_value')),
      taxable: sum('taxable'),
      igst: sum('igst'),
      cgst: sum('cgst'),
      sgst: sum('sgst'),
      cess: sum('cess'),
      books_irn: false,
      source: 'einvoice_excel',
      irn_status: lines.some((l) => l.irn_status === 'cancelled') ? 'cancelled' : 'valid',
      autopop_status: first('autopop_status'),
      autopop_text: first('autopop_text'),
      autopop_date: first('autopop_date'),
      error: first('error'),
      rchrg: first('rchrg'),
      etin: first('etin'),
      sbnum: first('sbnum'),
      sbdt: first('sbdt'),
      sbpcode: first('sbpcode'),
      sheet,
      rows: lines.map((l) => l.row),
    });
  });

  // One document per identity: a valid IRN wins over a cancelled one; a
  // second valid IRN for the same document number is reported, not kept.
  const byIdentity = new Map<string, EinvExcelDoc>();
  const out: EinvExcelDoc[] = [];
  docs.forEach((d) => {
    const k = `${d.section}|${d.ctin}|${d.doc_type}|${d.doc_key}`;
    const cur = byIdentity.get(k);
    if (!cur) { byIdentity.set(k, d); out.push(d); return; }
    const replace = cur.irn_status === 'cancelled' && d.irn_status === 'valid';
    const loser = replace ? cur : d;
    if (replace) { out[out.indexOf(cur)] = d; byIdentity.set(k, d); }
    skipped.push({
      sheet: loser.sheet,
      row: loser.rows[0] ?? null,
      reason: loser.irn_status === 'cancelled'
        ? `Cancelled IRN for ${loser.doc_no}, which has another IRN`
        : `A second IRN for ${loser.doc_no}; the first one in the file is used`,
    });
  });

  return { docs: out, sheets, skipped, meta };
}
