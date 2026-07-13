// Phase 1 of the "Import 2B" feature: parse a GSTR-2B workbook (the .xlsx the
// GST portal exports) into normalized B2B document records that the future
// reconciliation engine can match against the manually-entered books register.
//
// Scope (decided with the user): B2B family only for now — the main "B2B" sheet
// (ITC Available), "B2B (ITC Reversal)", and "B2B(Rejected)". Credit/debit
// notes, ECO, ISD and imports are out of scope for this phase. Amendment sheets
// (B2BA…) use a different original/revised layout; they are NOT parsed yet, but
// if they contain data we surface a warning so nothing is silently dropped.
//
// The parser is HEADER-DRIVEN: it resolves each column by matching the portal's
// header labels rather than fixed positions, so it survives the layout
// differences between the three B2B sheets (e.g. Rejected has no reverse-charge
// or ITC-availability column) and minor portal version changes.

import * as XLSX from 'xlsx';

export type Gstr2bBucket = 'available' | 'reversal' | 'rejected';

// Suggested ITC treatment derived purely from the portal's own classification —
// this is what lets the reconciliation dropdown auto-default so the team rarely
// has to classify by hand.
export type Gstr2bItcTreatment = 'ELIGIBLE' | 'INELIGIBLE' | 'RCM' | 'REVERSAL' | 'REJECTED';

export interface Gstr2bB2bRecord {
  // Identity / matching keys
  supplierGstin: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceType: string | null;      // Regular / SEZWP / SEZWOP / DE / CBW
  invoiceDate: string | null;      // ISO yyyy-MM-dd
  invoiceValue: number;
  placeOfSupply: string | null;
  // Tax (Cess captured for completeness; the app reconciles igst/cgst/sgst)
  taxableValue: number;
  inputIgst: number;
  inputCgst: number;
  inputSgst: number;
  cess: number;
  // Classification — drives the auto-default action in the reco UI
  bucket: Gstr2bBucket;            // which sheet the doc came from
  reverseCharge: boolean;          // "Supply Attract Reverse Charge" = Yes
  itcAvailable: boolean | null;    // "ITC Availability" Yes/No (null when absent, e.g. Rejected)
  itcReason: string | null;
  // Provenance
  gstr1Period: string | null;      // e.g. "May'26"
  gstr1FilingDate: string | null;
  applicableTaxRate: string | null;
  source: string | null;           // E-Invoice / e-Commerce
  irn: string | null;
  sheet: string;                   // source sheet name
  rowNumber: number;               // 1-based row in the sheet, for traceability
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

export interface Gstr2bParseResult {
  header: Gstr2bHeader;
  records: Gstr2bB2bRecord[];
  counts: { available: number; reversal: number; rejected: number; total: number };
  taxTotals: { taxableValue: number; igst: number; cgst: number; sgst: number };
  deferredSheetsWithData: string[]; // amendment sheets that had rows we did not parse
  warnings: string[];
}

const B2B_SHEETS: { name: string; bucket: Gstr2bBucket }[] = [
  { name: 'B2B', bucket: 'available' },
  { name: 'B2B (ITC Reversal)', bucket: 'reversal' },
  { name: 'B2B(Rejected)', bucket: 'rejected' },
];

const B2B_AMENDMENT_SHEETS = ['B2BA', 'B2BA (ITC Reversal)', 'B2BA(Rejected)'];

const MONTHS_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_SHORT_TITLE = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const pad2 = (n: number): string => String(n).padStart(2, '0');

function toNum(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/,/g, '').trim());
  return isNaN(n) ? 0 : n;
}

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
  let m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/);
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

function cleanStr(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s === '' || s.toLowerCase() === 'na' ? null : s;
}

// Column map resolved from the header. Only the fields we actually consume.
interface ColMap {
  gstin?: number;
  name?: number;
  invNo?: number;
  invType?: number;
  invDate?: number;
  invValue?: number;
  pos?: number;
  reverseCharge?: number;
  taxable?: number;
  igst?: number;
  cgst?: number;
  sgst?: number;
  cess?: number;
  itcAvail?: number;
  reason?: number;
  period?: number;
  filingDate?: number;
  rate?: number;
  source?: number;
  irn?: number;
}

// Combine the two header rows per column (portal headers are vertically merged,
// so a column's effective label is the sub-header if present, else the top one),
// then match each column to a field by keyword. First match wins for the tax
// group (B2B sheets have a single Integrated/Central/State tax block).
function resolveColumns(h1: any[], h2: any[]): ColMap {
  const width = Math.max(h1?.length ?? 0, h2?.length ?? 0);
  const map: ColMap = {};
  const set = (k: keyof ColMap, c: number) => { if (map[k] === undefined) map[k] = c; };

  for (let c = 0; c < width; c++) {
    const label = norm(h2?.[c]) || norm(h1?.[c]);
    if (!label) continue;

    if (label.includes('gstin') && label.includes('supplier')) set('gstin', c);
    else if (label.includes('trade') || label.includes('legal name')) set('name', c);
    else if (label.includes('invoice number')) set('invNo', c);
    else if (label.includes('invoice type')) set('invType', c);
    else if (label.includes('invoice date')) set('invDate', c);
    else if (label.includes('invoice value')) set('invValue', c);
    else if (label.includes('place of supply')) set('pos', c);
    else if (label.includes('reverse charge')) set('reverseCharge', c);
    else if (label.includes('taxable value')) set('taxable', c);
    else if (label.includes('integrated tax')) set('igst', c);
    else if (label.includes('central tax')) set('cgst', c);
    else if (label.includes('state/ut tax') || label.includes('state tax')) set('sgst', c);
    else if (label === 'cess' || label.includes('cess')) set('cess', c);
    else if (label.includes('itc availability') || label.includes('eligibility of itc') || label.includes('itc available')) set('itcAvail', c);
    else if (label === 'reason') set('reason', c);
    else if (label.includes('filing date')) set('filingDate', c);
    else if (label.includes('period')) set('period', c);
    else if (label.includes('applicable') && label.includes('rate')) set('rate', c);
    else if (label === 'source') set('source', c);
    else if (label === 'irn') set('irn', c);
  }
  return map;
}

// Find the header block: the row that carries "GSTIN of supplier" is the primary
// header row; the row below it holds the invoice/tax sub-labels. Data starts on
// the next row.
function findHeaderRows(rows: any[][]): { h1: number; h2: number } | null {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const joined = (rows[i] || []).map(norm).join(' | ');
    if (joined.includes('gstin of supplier')) {
      return { h1: i, h2: i + 1 };
    }
  }
  return null;
}

function parseB2bSheet(
  ws: XLSX.WorkSheet,
  sheetName: string,
  bucket: Gstr2bBucket,
  warnings: string[],
): Gstr2bB2bRecord[] {
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
  const hdr = findHeaderRows(rows);
  if (!hdr) {
    warnings.push(`Sheet "${sheetName}": could not locate the header row; skipped.`);
    return [];
  }
  const cols = resolveColumns(rows[hdr.h1] || [], rows[hdr.h2] || []);

  const missing: string[] = [];
  if (cols.gstin === undefined) missing.push('GSTIN');
  if (cols.invNo === undefined) missing.push('Invoice number');
  if (cols.taxable === undefined) missing.push('Taxable value');
  if (cols.igst === undefined || cols.cgst === undefined || cols.sgst === undefined) missing.push('Tax amount');
  if (missing.length) {
    warnings.push(`Sheet "${sheetName}": missing expected columns (${missing.join(', ')}); skipped.`);
    return [];
  }

  const out: Gstr2bB2bRecord[] = [];
  for (let r = hdr.h2 + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const gstin = String(row[cols.gstin!] ?? '').trim();
    const invNo = String(row[cols.invNo!] ?? '').trim();
    // Skip blank rows and any stray repeated header/total rows.
    if (!gstin && !invNo) continue;
    if (norm(gstin).includes('gstin')) continue;

    out.push({
      supplierGstin: gstin,
      supplierName: String(row[cols.name ?? -1] ?? '').trim(),
      invoiceNumber: invNo,
      invoiceType: cleanStr(row[cols.invType ?? -1]),
      invoiceDate: toIsoDate(row[cols.invDate ?? -1]),
      invoiceValue: toNum(row[cols.invValue ?? -1]),
      placeOfSupply: cleanStr(row[cols.pos ?? -1]),
      taxableValue: toNum(row[cols.taxable!]),
      inputIgst: toNum(row[cols.igst!]),
      inputCgst: toNum(row[cols.cgst!]),
      inputSgst: toNum(row[cols.sgst!]),
      cess: toNum(row[cols.cess ?? -1]),
      bucket,
      reverseCharge: parseYesNo(row[cols.reverseCharge ?? -1]) === true,
      itcAvailable: cols.itcAvail === undefined ? null : parseYesNo(row[cols.itcAvail]),
      itcReason: cleanStr(row[cols.reason ?? -1]),
      gstr1Period: cleanStr(row[cols.period ?? -1]),
      gstr1FilingDate: toIsoDate(row[cols.filingDate ?? -1]) ?? cleanStr(row[cols.filingDate ?? -1]),
      applicableTaxRate: cleanStr(row[cols.rate ?? -1]),
      source: cleanStr(row[cols.source ?? -1]),
      irn: cleanStr(row[cols.irn ?? -1]),
      sheet: sheetName,
      rowNumber: r + 1,
    });
  }
  return out;
}

// Extract GSTIN / FY / period from the "Read me" sheet (label in one cell, value
// a couple of cells to the right). Used later to validate the file against the
// selected client + month before importing.
function parseHeader(wb: XLSX.WorkBook): Gstr2bHeader {
  const header: Gstr2bHeader = {
    gstin: null, legalName: null, financialYear: null, taxPeriod: null,
    periodMonthKey: null, periodLabel: null, generatedOn: null,
  };
  const ws = wb.Sheets['Read me'] || wb.Sheets[wb.SheetNames[0]];
  if (!ws) return header;
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, defval: null, blankrows: false });

  const valueOf = (row: any[]): string | null => {
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

/**
 * Parse a GSTR-2B workbook from a raw buffer. Pure and side-effect-free so it
 * can be unit-tested in Node. Only the B2B family is parsed in this phase.
 */
export function parseGstr2bBuffer(data: ArrayBuffer | Uint8Array): Gstr2bParseResult {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const warnings: string[] = [];
  const header = parseHeader(wb);

  const records: Gstr2bB2bRecord[] = [];
  for (const { name, bucket } of B2B_SHEETS) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    records.push(...parseB2bSheet(ws, name, bucket, warnings));
  }

  // Flag amendment sheets that carry data — deferred, but never dropped silently.
  const deferredSheetsWithData: string[] = [];
  for (const name of B2B_AMENDMENT_SHEETS) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
    const hdr = findHeaderRows(rows);
    const dataStart = hdr ? hdr.h2 + 1 : rows.length;
    const hasData = rows.slice(dataStart).some((row) => (row || []).some((c) => c != null && String(c).trim() !== ''));
    if (hasData) {
      deferredSheetsWithData.push(name);
      warnings.push(`Sheet "${name}" contains amendment rows that are not parsed in this phase.`);
    }
  }

  const counts = {
    available: records.filter((r) => r.bucket === 'available').length,
    reversal: records.filter((r) => r.bucket === 'reversal').length,
    rejected: records.filter((r) => r.bucket === 'rejected').length,
    total: records.length,
  };
  const taxTotals = records.reduce(
    (acc, r) => {
      acc.taxableValue += r.taxableValue;
      acc.igst += r.inputIgst;
      acc.cgst += r.inputCgst;
      acc.sgst += r.inputSgst;
      return acc;
    },
    { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 },
  );

  return { header, records, counts, taxTotals, deferredSheetsWithData, warnings };
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
 *   - reversal sheet            → REVERSAL (Rule 37A)
 *   - ITC Availability = No     → INELIGIBLE (blocked, e.g. 17(5))
 *   - otherwise                 → ELIGIBLE (claim, pending books match)
 */
export function suggestItcTreatment(rec: Gstr2bB2bRecord): Gstr2bItcTreatment {
  if (rec.bucket === 'rejected') return 'REJECTED';
  if (rec.reverseCharge) return 'RCM';
  if (rec.bucket === 'reversal') return 'REVERSAL';
  if (rec.itcAvailable === false) return 'INELIGIBLE';
  return 'ELIGIBLE';
}
