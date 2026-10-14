// "Import 2B": parse a GSTR-2B workbook (the .xlsx the GST portal exports) into
// normalized document records that the reconciliation engine matches against
// the books register.
//
// SCOPE. Every B2B-family sheet is read; nothing else is (see GSTR2B_SHEETS):
//   ITC available  B2B, B2BA, B2B-CDNR, B2B-CDNRA
//   ITC reversal   B2B (ITC Reversal), B2BA (ITC Reversal),
//                  B2B-DNR, B2B-DNRA (Rule 37A debit notes: always DEBIT_NOTE)
//   ITC rejected   B2B(Rejected), B2BA(Rejected),
//                  B2B-CDNR(Rejected), B2B-CDNRA(Rejected)
// Sheet names are matched ignoring case and all whitespace (the portal itself
// spells "B2B (ITC Reversal)" but "B2B(Rejected)"), then compared exactly, so
// "B2B-CDNR" and "B2B-CDNRA" stay distinct.
//
// Every other sheet that carries data rows (ECO, ECOA, ISD, ISDA, IMPG, IMPGA,
// IMPGSEZ, IMPGSEZA, their Rejected variants, or anything unknown) is NOT read:
// each one gets a warning with its row count and is listed in
// deferredSheetsWithData, so nothing is dropped silently. The summary sheets
// ("Read me", "ITC Available", "ITC not available", "ITC Reversal",
// "ITC Rejected") are ignored, except "Read me", which gives the file header.
//
// RECORDS. One record per document row. The Gstr2bB2bRecord field names predate
// notes and amendments and are kept for the consumers: invoiceNumber is the
// document number (the note number for a debit/credit note), invoiceType the
// supply type (Regular / SEZWP / ...), invoiceDate the document date and
// invoiceValue the document value. docType says what the document is:
//   - invoice sheets          -> INVOICE
//   - B2B-DNR / B2B-DNRA      -> DEBIT_NOTE (forced by the sheet)
//   - other note sheets       -> from "Note type": starts with "d" -> DEBIT_NOTE,
//                                "c" -> CREDIT_NOTE ("Debit Note", "C", ...).
//                                Anything else: warning, row skipped.
// AMOUNTS ARE POSITIVE, exactly as in the file, for every docType; consumers
// apply the sign from docType (a credit note reduces ITC). A row with any
// negative amount is never kept: warning, row skipped.
//
// AMENDMENTS (the "...A" sheets) carry an "Original Details" / "Revised
// Details" band above the headers. Columns are resolved per band: the original
// document number / date / note type come from the Original band
// (originalNumber, originalDate, originalDocType), everything else from the
// Revised band, so the revised document is the record. An amendment sheet
// without that band is skipped with a warning rather than guessed.
//
// IMS. "Whether ITC to be reduced (Taxpayer's Input)" -> imsReduceRequired and
// the "Amount declared by taxpayer for ITC reduction" block -> declared*. The
// declared block repeats the Integrated / Central / State/UT / Cess labels of
// the "Tax Amount" block; tax always comes from "Tax Amount", never from it.
//
// The parser is HEADER-DRIVEN: it resolves each column by the portal's header
// labels (each group label, like "Tax Amount" or "Original Details", carried
// across the columns it spans) rather than fixed positions, so it survives the
// layout differences between sheets (e.g. Rejected has no reverse-charge or
// ITC-availability column, B2B-DNR has no IMS columns) and minor portal
// version changes. rowNumber is the real Excel row number.

import * as XLSX from 'xlsx';

export type Gstr2bBucket = 'available' | 'reversal' | 'rejected';

// What the document is. Amounts on every record are positive; the sign comes
// from here (CREDIT_NOTE reduces, INVOICE / DEBIT_NOTE add).
export type Gstr2bDocType = 'INVOICE' | 'DEBIT_NOTE' | 'CREDIT_NOTE';

// Suggested ITC treatment derived purely from the portal's own classification —
// this is what lets the reconciliation dropdown auto-default so the team rarely
// has to classify by hand.
export type Gstr2bItcTreatment = 'ELIGIBLE' | 'INELIGIBLE' | 'RCM' | 'REVERSAL' | 'REJECTED';

export interface Gstr2bB2bRecord {
  // Identity / matching keys
  supplierGstin: string;
  supplierName: string;
  invoiceNumber: string;           // document number (note number for notes)
  invoiceType: string | null;      // supply type: Regular / SEZWP / SEZWOP / DE / CBW
  invoiceDate: string | null;      // document date, ISO yyyy-MM-dd
  invoiceValue: number;            // document value (positive)
  placeOfSupply: string | null;
  docType: Gstr2bDocType;
  // Amendments ("...A" sheets): the record is the revised document; these
  // identify the document it amends. All null / false on non-amendment sheets.
  isAmendment: boolean;
  originalNumber: string | null;
  originalDate: string | null;     // ISO yyyy-MM-dd
  originalDocType: Gstr2bDocType | null; // INVOICE for B2BA*, the original note type for note amendments
  // Tax from the "Tax Amount" block, positive as in the file (Cess captured for
  // completeness; the app reconciles igst/cgst/sgst)
  taxableValue: number;
  inputIgst: number;
  inputCgst: number;
  inputSgst: number;
  cess: number;
  // IMS: "Whether ITC to be reduced (Taxpayer's Input)" and the "Amount declared
  // by taxpayer for ITC reduction" block (null when blank or absent)
  imsReduceRequired: 'YES' | 'NO' | null;
  declaredIgst: number | null;
  declaredCgst: number | null;
  declaredSgst: number | null;
  declaredCess: number | null;
  remarks: string | null;
  // Classification — drives the auto-default action in the reco UI
  bucket: Gstr2bBucket;            // which sheet family the doc came from
  reverseCharge: boolean;          // "Supply Attract Reverse Charge" = Yes
  itcAvailable: boolean | null;    // "ITC Availability" Yes/No (null when absent, e.g. Rejected)
  itcReason: string | null;
  // Provenance
  gstr1Period: string | null;      // e.g. "May'26"
  gstr1FilingDate: string | null;
  applicableTaxRate: string | null;
  source: string | null;           // E-Invoice / e-Commerce
  irn: string | null;
  sheet: string;                   // source sheet, by its registry name (e.g. "B2B-CDNR")
  rowNumber: number;               // real 1-based Excel row in that sheet
}

export interface Gstr2bHeader {
  gstin: string | null;
  legalName: string | null;
  financialYear: string | null;    // "2026-27"
  taxPeriod: string | null;        // "May"
  periodMonthKey: string | null;   // "05/2026" (app MonthContext format)
  periodLabel: string | null;      // "May 26" (app month-label format)
  generatedOn: string | null;      // "14/06/2026"
}

export interface Gstr2bTaxTotals {
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface Gstr2bParseResult {
  header: Gstr2bHeader;
  records: Gstr2bB2bRecord[];
  counts: {
    available: number;
    reversal: number;
    rejected: number;
    total: number;
    byDocType: Record<Gstr2bDocType, number>;
    amendments: number;                                // records from "...A" sheets
    amendmentsByDocType: Record<Gstr2bDocType, number>;
  };
  // Over every record (all buckets, amendments at their revised figures).
  // The top-level figures are SIGNED: credit notes subtract. byDocType holds
  // the plain (positive) sums per docType.
  taxTotals: Gstr2bTaxTotals & { byDocType: Record<Gstr2bDocType, Gstr2bTaxTotals> };
  deferredSheetsWithData: string[]; // sheets with data rows this parser does not read (ECO, ISD, IMPG...)
  // B2B-family sheets found in the workbook (registry names, e.g. "B2B-CDNR").
  sheetsRead: string[];
  // B2B-family sheets not read in full: skipped whole (header, band or columns
  // not found) or with rows skipped (blank note type, a negative amount). The
  // importer refuses to treat the month's notes as read when a note sheet is
  // here, so row 5.3 never fills itself from a partial read.
  incompleteSheets: Gstr2bIncompleteSheet[];
  warnings: string[];
}

export interface Gstr2bIncompleteSheet {
  sheet: string;                   // registry name
  wholeSheet: boolean;             // the sheet was skipped entirely
  skippedRows: number;             // rows skipped (0 when wholeSheet)
}

export interface Gstr2bSheetSpec {
  name: string;                    // the portal's sheet name
  bucket: Gstr2bBucket;
  notes: boolean;                  // debit/credit note layout ("Note type", "Note number"...)
  amendment: boolean;              // Original / Revised band layout
  forcedDocType?: Gstr2bDocType;   // the sheet holds only this docType
}

export const GSTR2B_SHEETS: readonly Gstr2bSheetSpec[] = [
  { name: 'B2B', bucket: 'available', notes: false, amendment: false },
  { name: 'B2BA', bucket: 'available', notes: false, amendment: true },
  { name: 'B2B-CDNR', bucket: 'available', notes: true, amendment: false },
  { name: 'B2B-CDNRA', bucket: 'available', notes: true, amendment: true },
  { name: 'B2B (ITC Reversal)', bucket: 'reversal', notes: false, amendment: false },
  { name: 'B2BA (ITC Reversal)', bucket: 'reversal', notes: false, amendment: true },
  { name: 'B2B-DNR', bucket: 'reversal', notes: true, amendment: false, forcedDocType: 'DEBIT_NOTE' },
  { name: 'B2B-DNRA', bucket: 'reversal', notes: true, amendment: true, forcedDocType: 'DEBIT_NOTE' },
  { name: 'B2B(Rejected)', bucket: 'rejected', notes: false, amendment: false },
  { name: 'B2BA(Rejected)', bucket: 'rejected', notes: false, amendment: true },
  { name: 'B2B-CDNR(Rejected)', bucket: 'rejected', notes: true, amendment: false },
  { name: 'B2B-CDNRA(Rejected)', bucket: 'rejected', notes: true, amendment: true },
];

// Summary / instruction sheets: no document rows, never warned about.
const SUMMARY_SHEETS = ['Read me', 'ITC Available', 'ITC not available', 'ITC Reversal', 'ITC Rejected'];

const DOC_TYPES: Gstr2bDocType[] = ['INVOICE', 'DEBIT_NOTE', 'CREDIT_NOTE'];

const MONTHS_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_SHORT_TITLE = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Row = unknown[];

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const pad2 = (n: number): string => String(n).padStart(2, '0');
const round2 = (n: number): number => Math.round(n * 100) / 100 || 0;
// Sheet-name key: lowercase, all whitespace removed ("B2B (Rejected)" == "B2B(Rejected)").
const sheetKey = (s: string): string => s.toLowerCase().replace(/\s+/g, '');

const isBlank = (v: unknown): boolean => v == null || String(v).trim() === '';
const rowIsBlank = (row: Row | undefined): boolean => !row || row.every(isBlank);

function toNum(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/,/g, '').trim());
  return isNaN(n) ? 0 : n;
}

// Blank (or absent column) -> null; otherwise the number.
const toNumOrNull = (v: unknown): number | null => (isBlank(v) ? null : toNum(v));

function fmtIso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

// Accepts a JS Date (cellDates), an Excel serial number, or dd/MM/yyyy /
// dd-MM-yyyy / yyyy-MM-dd strings. Returns ISO yyyy-MM-dd or null.
function toIsoDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) return fmtIso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number' && isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return fmtIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    return fmtIso(year, parseInt(m[2], 10), parseInt(m[1], 10));
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return fmtIso(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
  return null;
}

// "Yes"/"No" → boolean; anything blank/unknown → null.
function parseYesNo(v: unknown): boolean | null {
  const s = norm(v);
  if (s === 'yes' || s === 'y') return true;
  if (s === 'no' || s === 'n') return false;
  return null;
}

// "Debit Note" / "D" -> DEBIT_NOTE, "Credit Note" / "C" -> CREDIT_NOTE, any case.
function parseNoteType(v: unknown): Gstr2bDocType | null {
  const s = norm(v);
  if (s.startsWith('d')) return 'DEBIT_NOTE';
  if (s.startsWith('c')) return 'CREDIT_NOTE';
  return null;
}

function cleanStr(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s === '' || s.toLowerCase() === 'na' ? null : s;
}

// ---- Header ------------------------------------------------------------------

// A header block: `h1` is the row with the column labels ("GSTIN of supplier"
// ...), `h2` the row of sub-labels under the merged groups ("Invoice number",
// "Integrated Tax(₹)"...), `band` the "Original Details / Revised Details" row
// above h1 on amendment sheets. Data starts on dataStart. Indexes are into the
// sheet_to_json rows array.
interface HeaderBlock {
  band: number | null;
  h1: number;
  h2: number;
  dataStart: number;
}

// What starts the label row on any data sheet: "GSTIN of supplier" / "GSTIN of
// ECO" / "GSTIN of ISD", or the import sheets' "Icegate Reference Date" /
// "Bill of Entry Details".
const HEADER_ANCHORS = ['gstin of', 'icegate reference', 'bill of entry'];
const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{13}$/i;

// A row is data (not a sub-header) when it holds a number, a date, a numeric
// string or a GSTIN.
function looksLikeData(row: Row | undefined): boolean {
  return (row || []).some((v) => {
    if (typeof v === 'number' || v instanceof Date) return true;
    const s = String(v ?? '').trim();
    if (!s) return false;
    if (GSTIN_RE.test(s)) return true;
    return /^-?[\d,]+(\.\d+)?$/.test(s);
  });
}

function findHeader(rows: Row[]): HeaderBlock | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] || []).map(norm);
    if (!cells.some((c) => HEADER_ANCHORS.some((a) => c.startsWith(a)))) continue;
    const h2 = i + 1 < rows.length && !looksLikeData(rows[i + 1]) ? i + 1 : i;
    const above = i > 0 ? (rows[i - 1] || []).map(norm) : [];
    const isBand = above.some((c) => c.startsWith('original detail')) && above.some((c) => c.startsWith('revised detail'));
    return { band: isBand ? i - 1 : null, h1: i, h2, dataStart: h2 + 1 };
  }
  return null;
}

// One resolved header column: its own label (the sub-label if there is one,
// else the top label), the group label it sits under ("tax amount", "amount
// declared by taxpayer for itc reduction", ...) and its band on amendment
// sheets. Merged cells carry their value only in the first column, so a group
// label is carried right across every following column that has a sub-label
// but no top label of its own, and a band label until the next band label.
interface HeaderCol {
  label: string;
  group: string;
  band: 'original' | 'revised' | null;
}

function headerCols(rows: Row[], hdr: HeaderBlock): HeaderCol[] {
  const top = rows[hdr.h1] || [];
  const sub = hdr.h2 !== hdr.h1 ? rows[hdr.h2] || [] : [];
  const bandRow = hdr.band != null ? rows[hdr.band] || [] : [];
  const width = Math.max(top.length, sub.length, bandRow.length);

  const out: HeaderCol[] = [];
  let group = '';
  let band: HeaderCol['band'] = null;
  for (let c = 0; c < width; c++) {
    const b = norm(bandRow[c]);
    if (b) band = b.startsWith('original') ? 'original' : b.startsWith('revised') ? 'revised' : null;
    const t = norm(top[c]);
    const s = norm(sub[c]);
    if (t && s) group = t;          // first column of a merged group
    else if (t || !s) group = '';   // a stand-alone (vertically merged) label, or a gap
    out.push({ label: s || t, group: s ? group : '', band });
  }
  return out;
}

// Column map resolved from the header. Only the fields we actually consume.
interface ColMap {
  gstin?: number;
  name?: number;
  invNo?: number;
  invType?: number;
  noteType?: number;
  invDate?: number;
  invValue?: number;
  pos?: number;
  reverseCharge?: number;
  taxable?: number;
  igst?: number;
  cgst?: number;
  sgst?: number;
  cess?: number;
  imsReduce?: number;
  declIgst?: number;
  declCgst?: number;
  declSgst?: number;
  declCess?: number;
  remarks?: number;
  itcAvail?: number;
  reason?: number;
  period?: number;
  filingDate?: number;
  rate?: number;
  source?: number;
  irn?: number;
  origNo?: number;
  origDate?: number;
  origNoteType?: number;
}

// Match each column to a field by keyword; first match wins. Columns in the
// Original band only ever give the original number / date / note type.
// Tax labels inside the "Amount declared by taxpayer for ITC reduction" group
// go to declared*, all others to the tax fields.
function resolveColumns(cols: HeaderCol[]): ColMap {
  const map: ColMap = {};
  const set = (k: keyof ColMap, c: number) => { if (map[k] === undefined) map[k] = c; };

  cols.forEach(({ label, group, band }, c) => {
    if (!label) return;

    if (band === 'original') {
      if (label.includes('number')) set('origNo', c);
      else if (label.includes('date')) set('origDate', c);
      else if (label.includes('type')) set('origNoteType', c);
      return;
    }

    const declared = group.includes('declared') || group.includes('itc reduction');
    if (label.includes('gstin') && label.includes('supplier')) set('gstin', c);
    else if (label.includes('trade') || label.includes('legal name')) set('name', c);
    else if (label.includes('itc to be reduced')) set('imsReduce', c);
    else if (label.includes('invoice number') || label.includes('note number')) set('invNo', c);
    else if (label.includes('invoice type') || label.includes('supply type')) set('invType', c);
    else if (label.includes('note type')) set('noteType', c);
    else if (label.includes('invoice date') || label.includes('note date')) set('invDate', c);
    else if (label.includes('invoice value') || label.includes('note value')) set('invValue', c);
    else if (label.includes('place of supply')) set('pos', c);
    else if (label.includes('reverse charge')) set('reverseCharge', c);
    else if (label.includes('taxable value')) set('taxable', c);
    else if (label.includes('integrated tax')) set(declared ? 'declIgst' : 'igst', c);
    else if (label.includes('central tax')) set(declared ? 'declCgst' : 'cgst', c);
    else if (label.includes('state/ut tax') || label.includes('state tax')) set(declared ? 'declSgst' : 'sgst', c);
    else if (label.includes('cess')) set(declared ? 'declCess' : 'cess', c);
    else if (label.includes('itc availability') || label.includes('eligibility of itc') || label.includes('itc available')) set('itcAvail', c);
    else if (label === 'reason') set('reason', c);
    else if (label === 'remarks' || label === 'remark') set('remarks', c);
    else if (label.includes('filing date')) set('filingDate', c);
    else if (label.includes('period')) set('period', c);
    else if (label.includes('applicable') && label.includes('rate')) set('rate', c);
    else if (label === 'source') set('source', c);
    else if (label === 'irn') set('irn', c);
  });
  return map;
}

// ---- Sheets ------------------------------------------------------------------

// Rows exactly as the sheet stores them, blank rows included, so that
// rows[i] is Excel row (firstRow + i + 1).
function readRows(ws: XLSX.WorkSheet): { rows: Row[]; firstRow: number } {
  const rows = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, defval: null, blankrows: true });
  const firstRow = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r : 0;
  return { rows, firstRow };
}

const AMOUNT_FIELDS: { key: keyof ColMap; label: string }[] = [
  { key: 'invValue', label: 'document value' },
  { key: 'taxable', label: 'taxable value' },
  { key: 'igst', label: 'integrated tax' },
  { key: 'cgst', label: 'central tax' },
  { key: 'sgst', label: 'state/UT tax' },
  { key: 'cess', label: 'cess' },
  { key: 'declIgst', label: 'declared integrated tax' },
  { key: 'declCgst', label: 'declared central tax' },
  { key: 'declSgst', label: 'declared state/UT tax' },
  { key: 'declCess', label: 'declared cess' },
];

function parseDocSheet(
  ws: XLSX.WorkSheet,
  fileSheetName: string,
  spec: Gstr2bSheetSpec,
  warnings: string[],
  incomplete: Gstr2bIncompleteSheet[],
): Gstr2bB2bRecord[] {
  const { rows, firstRow } = readRows(ws);
  const hdr = findHeader(rows);
  const skipSheet = (why: string) => {
    warnings.push(`Sheet "${fileSheetName}": ${why}; skipped.`);
    incomplete.push({ sheet: spec.name, wholeSheet: true, skippedRows: 0 });
    return [];
  };
  if (!hdr) {
    if (rows.some((row) => !rowIsBlank(row))) return skipSheet('could not locate the header row');
    return [];
  }
  if (spec.amendment && hdr.band == null) {
    return skipSheet('could not find the "Original Details / Revised Details" header band');
  }
  const cols = resolveColumns(headerCols(rows, hdr));

  const missing: string[] = [];
  if (cols.gstin === undefined) missing.push('GSTIN');
  if (cols.invNo === undefined) missing.push(spec.notes ? 'Note number' : 'Invoice number');
  if (spec.notes && !spec.forcedDocType && cols.noteType === undefined) missing.push('Note type');
  if (spec.amendment && cols.origNo === undefined) missing.push('Original document number');
  if (cols.taxable === undefined) missing.push('Taxable value');
  if (cols.igst === undefined || cols.cgst === undefined || cols.sgst === undefined) missing.push('Tax amount');
  if (missing.length) return skipSheet(`missing expected columns (${missing.join(', ')})`);

  const cell = (row: Row, k: keyof ColMap): unknown => (cols[k] === undefined ? null : row[cols[k] as number]);
  const docWord = spec.notes ? 'note' : 'invoice';

  const out: Gstr2bB2bRecord[] = [];
  let skippedRows = 0;
  for (let r = hdr.dataStart; r < rows.length; r++) {
    const row = rows[r] || [];
    const rowNumber = firstRow + r + 1;
    const gstin = String(cell(row, 'gstin') ?? '').trim();
    const invNo = String(cell(row, 'invNo') ?? '').trim();
    // Skip blank rows and any stray repeated header/total rows.
    if (!gstin && !invNo) continue;
    if (norm(gstin).includes('gstin')) continue;
    const where = `Sheet "${fileSheetName}", row ${rowNumber} (GSTIN ${gstin || '?'}, ${docWord} ${invNo || '?'})`;

    let docType: Gstr2bDocType;
    if (spec.forcedDocType) docType = spec.forcedDocType;
    else if (!spec.notes) docType = 'INVOICE';
    else {
      const t = parseNoteType(cell(row, 'noteType'));
      if (!t) {
        const raw = String(cell(row, 'noteType') ?? '').trim();
        warnings.push(`${where}: note type ${raw ? `"${raw}"` : '(blank)'} is not Debit Note / Credit Note; row skipped.`);
        skippedRows += 1;
        continue;
      }
      docType = t;
    }

    const negative = AMOUNT_FIELDS.find(({ key }) => toNum(cell(row, key)) < 0);
    if (negative) {
      warnings.push(`${where}: negative ${negative.label} (${toNum(cell(row, negative.key))}); amounts in GSTR-2B are always positive, row skipped.`);
      skippedRows += 1;
      continue;
    }

    let originalDocType: Gstr2bDocType | null = null;
    if (spec.amendment) {
      if (spec.forcedDocType) originalDocType = spec.forcedDocType;
      else if (!spec.notes) originalDocType = 'INVOICE';
      else {
        originalDocType = parseNoteType(cell(row, 'origNoteType'));
        if (!originalDocType) {
          const raw = String(cell(row, 'origNoteType') ?? '').trim();
          warnings.push(`${where}: original note type ${raw ? `"${raw}"` : '(blank)'} is not Debit Note / Credit Note; kept with the original type blank.`);
        }
      }
    }

    const ims = parseYesNo(cell(row, 'imsReduce'));
    const filing = cell(row, 'filingDate');
    out.push({
      supplierGstin: gstin,
      supplierName: String(cell(row, 'name') ?? '').trim(),
      invoiceNumber: invNo,
      invoiceType: cleanStr(cell(row, 'invType')),
      invoiceDate: toIsoDate(cell(row, 'invDate')),
      invoiceValue: toNum(cell(row, 'invValue')),
      placeOfSupply: cleanStr(cell(row, 'pos')),
      docType,
      isAmendment: spec.amendment,
      originalNumber: spec.amendment ? cleanStr(cell(row, 'origNo')) : null,
      originalDate: spec.amendment ? toIsoDate(cell(row, 'origDate')) : null,
      originalDocType,
      taxableValue: toNum(cell(row, 'taxable')),
      inputIgst: toNum(cell(row, 'igst')),
      inputCgst: toNum(cell(row, 'cgst')),
      inputSgst: toNum(cell(row, 'sgst')),
      cess: toNum(cell(row, 'cess')),
      imsReduceRequired: ims === true ? 'YES' : ims === false ? 'NO' : null,
      declaredIgst: toNumOrNull(cell(row, 'declIgst')),
      declaredCgst: toNumOrNull(cell(row, 'declCgst')),
      declaredSgst: toNumOrNull(cell(row, 'declSgst')),
      declaredCess: toNumOrNull(cell(row, 'declCess')),
      remarks: cleanStr(cell(row, 'remarks')),
      bucket: spec.bucket,
      reverseCharge: parseYesNo(cell(row, 'reverseCharge')) === true,
      itcAvailable: cols.itcAvail === undefined ? null : parseYesNo(cell(row, 'itcAvail')),
      itcReason: cleanStr(cell(row, 'reason')),
      gstr1Period: cleanStr(cell(row, 'period')),
      gstr1FilingDate: toIsoDate(filing) ?? cleanStr(filing),
      applicableTaxRate: cleanStr(cell(row, 'rate')),
      source: cleanStr(cell(row, 'source')),
      irn: cleanStr(cell(row, 'irn')),
      sheet: spec.name,
      rowNumber,
    });
  }
  if (skippedRows > 0) incomplete.push({ sheet: spec.name, wholeSheet: false, skippedRows });
  return out;
}

// Data rows on a sheet this parser does not read: the non-blank rows below its
// header (repeated header rows aside), or every non-blank row when no header
// is recognisable.
function countDataRows(ws: XLSX.WorkSheet): number {
  const { rows } = readRows(ws);
  const hdr = findHeader(rows);
  const start = hdr ? hdr.dataStart : 0;
  let n = 0;
  for (let r = start; r < rows.length; r++) {
    const row = rows[r];
    if (rowIsBlank(row)) continue;
    if (hdr && (row || []).map(norm).some((c) => HEADER_ANCHORS.some((a) => c.startsWith(a)))) continue;
    n++;
  }
  return n;
}

// Extract GSTIN / FY / period from the "Read me" sheet (label in one cell, value
// a couple of cells to the right). Used later to validate the file against the
// selected client + month before importing.
function parseHeader(wb: XLSX.WorkBook): Gstr2bHeader {
  const header: Gstr2bHeader = {
    gstin: null, legalName: null, financialYear: null, taxPeriod: null,
    periodMonthKey: null, periodLabel: null, generatedOn: null,
  };
  const readMe = wb.SheetNames.find((n) => sheetKey(n) === sheetKey('Read me'));
  const ws = wb.Sheets[readMe ?? wb.SheetNames[0]];
  if (!ws) return header;
  const rows = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: false, defval: null, blankrows: false });

  const valueOf = (row: Row): string | null => {
    for (let c = 1; c < row.length; c++) {
      const v = row[c];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  };

  for (let i = 0; i < Math.min(rows.length, 14); i++) {
    const row = rows[i] || [];
    const label = norm(row[0]);
    if (!label) continue;
    if (label.includes('financial year')) header.financialYear = valueOf(row);
    else if (label.includes('tax period')) header.taxPeriod = valueOf(row);
    else if (label === 'gstin') header.gstin = valueOf(row);
    else if (label.includes('legal name')) header.legalName = valueOf(row);
    else if (label.includes('date of generation')) header.generatedOn = valueOf(row);
  }

  // Resolve the return month from FY + tax-period (Indian FY, Apr–Mar).
  if (header.taxPeriod && header.financialYear) {
    const p = norm(header.taxPeriod);
    let mi = MONTHS_FULL.indexOf(p);
    if (mi < 0) mi = MONTHS_SHORT.indexOf(p.slice(0, 3));
    const fyMatch = header.financialYear.match(/(\d{4})/);
    if (mi >= 0 && fyMatch) {
      const fyStart = parseInt(fyMatch[1], 10);
      const monthNum = mi + 1;
      const year = monthNum >= 4 ? fyStart : fyStart + 1;
      header.periodMonthKey = `${pad2(monthNum)}/${year}`;
      header.periodLabel = `${MONTH_SHORT_TITLE[mi]} ${String(year).slice(-2)}`;
    }
  }
  return header;
}

const zeroTotals = (): Gstr2bTaxTotals => ({ taxableValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
const perDocType = <T,>(make: () => T): Record<Gstr2bDocType, T> =>
  ({ INVOICE: make(), DEBIT_NOTE: make(), CREDIT_NOTE: make() });

/**
 * Parse a GSTR-2B workbook from a raw buffer. Pure and side-effect-free so it
 * can be unit-tested in Node. Reads the B2B family (invoices, debit/credit
 * notes and their amendments in every bucket); see the header comment.
 */
export function parseGstr2bBuffer(data: ArrayBuffer | Uint8Array): Gstr2bParseResult {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const warnings: string[] = [];
  const header = parseHeader(wb);

  // Tolerant lookup: first workbook sheet per whitespace/case-free key.
  const byKey = new Map<string, string>();
  for (const n of wb.SheetNames) if (!byKey.has(sheetKey(n))) byKey.set(sheetKey(n), n);

  const records: Gstr2bB2bRecord[] = [];
  const handled = new Set<string>();
  const sheetsRead: string[] = [];
  const incompleteSheets: Gstr2bIncompleteSheet[] = [];
  for (const spec of GSTR2B_SHEETS) {
    const fileName = byKey.get(sheetKey(spec.name));
    if (!fileName) continue;
    handled.add(fileName);
    sheetsRead.push(spec.name);
    records.push(...parseDocSheet(wb.Sheets[fileName], fileName, spec, warnings, incompleteSheets));
  }

  // Every other sheet with data rows: not read, but never dropped silently.
  const summary = new Set(SUMMARY_SHEETS.map(sheetKey));
  const deferredSheetsWithData: string[] = [];
  for (const name of wb.SheetNames) {
    if (handled.has(name) || summary.has(sheetKey(name))) continue;
    const n = countDataRows(wb.Sheets[name]);
    if (n > 0) {
      deferredSheetsWithData.push(name);
      warnings.push(`Sheet "${name}" has ${n} row${n === 1 ? '' : 's'} Import 2B does not read (e-commerce / ISD / imports); handle them by hand.`);
    }
  }

  const byDocType = perDocType(() => 0);
  const amendmentsByDocType = perDocType(() => 0);
  for (const r of records) {
    byDocType[r.docType]++;
    if (r.isAmendment) amendmentsByDocType[r.docType]++;
  }
  const counts = {
    available: records.filter((r) => r.bucket === 'available').length,
    reversal: records.filter((r) => r.bucket === 'reversal').length,
    rejected: records.filter((r) => r.bucket === 'rejected').length,
    total: records.length,
    byDocType,
    amendments: records.filter((r) => r.isAmendment).length,
    amendmentsByDocType,
  };

  const net = zeroTotals();
  const totalsByDocType = perDocType(zeroTotals);
  for (const r of records) {
    const sign = r.docType === 'CREDIT_NOTE' ? -1 : 1;
    const t = totalsByDocType[r.docType];
    t.taxableValue += r.taxableValue; net.taxableValue += sign * r.taxableValue;
    t.igst += r.inputIgst; net.igst += sign * r.inputIgst;
    t.cgst += r.inputCgst; net.cgst += sign * r.inputCgst;
    t.sgst += r.inputSgst; net.sgst += sign * r.inputSgst;
    t.cess += r.cess; net.cess += sign * r.cess;
  }
  const roundTotals = (t: Gstr2bTaxTotals): Gstr2bTaxTotals => ({
    taxableValue: round2(t.taxableValue), igst: round2(t.igst), cgst: round2(t.cgst), sgst: round2(t.sgst), cess: round2(t.cess),
  });
  const taxTotals = {
    ...roundTotals(net),
    byDocType: {
      INVOICE: roundTotals(totalsByDocType.INVOICE),
      DEBIT_NOTE: roundTotals(totalsByDocType.DEBIT_NOTE),
      CREDIT_NOTE: roundTotals(totalsByDocType.CREDIT_NOTE),
    },
  };

  return { header, records, counts, taxTotals, deferredSheetsWithData, sheetsRead, incompleteSheets, warnings };
}

/** Browser entry point: read a File and parse it. */
export async function parseGstr2bFile(file: File): Promise<Gstr2bParseResult> {
  const buffer = await file.arrayBuffer();
  return parseGstr2bBuffer(buffer);
}

/**
 * Suggested ITC treatment for a document, derived purely from the portal's own
 * classification. This is the auto-default the reconciliation UI applies so the
 * team only overrides exceptions:
 *   - rejected sheet            → REJECTED (exclude)
 *   - reverse charge = Yes      → RCM (route to RCM Summary, not ITC)
 *   - reversal sheet            → REVERSAL (Rule 37A; B2B-DNR debit notes too)
 *   - ITC Availability = No     → INELIGIBLE (blocked, e.g. 17(5))
 *   - otherwise                 → ELIGIBLE (claim, pending books match)
 * The treatment says WHETHER a document counts, not in which direction: for a
 * CREDIT_NOTE, ELIGIBLE means its ITC is reduced and INELIGIBLE that the
 * portal does not reduce it (its "ITC Availability" is No). Apply the sign
 * from docType.
 */
export function suggestItcTreatment(rec: Gstr2bB2bRecord): Gstr2bItcTreatment {
  if (rec.bucket === 'rejected') return 'REJECTED';
  if (rec.reverseCharge) return 'RCM';
  if (rec.bucket === 'reversal') return 'REVERSAL';
  if (rec.itcAvailable === false) return 'INELIGIBLE';
  return 'ELIGIBLE';
}
