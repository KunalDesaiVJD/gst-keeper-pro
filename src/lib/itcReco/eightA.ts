// GSTR-9 Table 8A document details: the portal's file (GSTR-9 → "Download
// Table 8A document details", an Excel) or a portal JSON of the same documents,
// read into the stored 8A (sources.ts: Stored8A, return_type GSTR9_8A). Pure:
// the Reports Hub's upload (src/utils/gstr8aReports.ts) saves what this returns.
//
// The Excel has not been seen live by engineering (docs/GSTR8A_RECO_POSITIONS.md
// §2): it is read with the GSTR-2B reader's header-driven column matching
// (parseItcWorkbook), which resolves columns by the portal's labels ("GSTIN of
// supplier", "Invoice number", "Note type", "Taxable Value", "Integrated Tax",
// "GSTR-1/IFF/GSTR-5 Period", "ITC Availability", …), so the sheet layout may
// differ in order and band. Sheet names are taken in either spelling (B2B-CDNR
// as in 2B, CDNR as in 2A), and an amendment sheet without the Original /
// Revised band takes the original document from its "Original …" columns.
import * as XLSX from 'xlsx';
import { normalizeFy } from '@/lib/reply/periods';
import { parseItcWorkbook, type Gstr2bB2bRecord, type Gstr2bSheetSpec } from '@/utils/parseGstr2b';
import { parsePortalDate, parseSupplierPeriod } from './dates';
import { docsFrom2A, docsFrom2B, EIGHT_A_FORMAT, type Stored8A, type Stored8ADoc } from './sources';
import type { RecoDoc } from './types';

/** The 8A file's document sheets, in either spelling the portal uses. */
export const GSTR8A_SHEETS: readonly Gstr2bSheetSpec[] = [
  { name: 'B2B', bucket: 'available', notes: false, amendment: false },
  { name: 'B2BA', bucket: 'available', notes: false, amendment: true },
  { name: 'B2B-CDNR', bucket: 'available', notes: true, amendment: false },
  { name: 'B2B-CDNRA', bucket: 'available', notes: true, amendment: true },
  { name: 'CDNR', bucket: 'available', notes: true, amendment: false },
  { name: 'CDNRA', bucket: 'available', notes: true, amendment: true },
  { name: 'CDN', bucket: 'available', notes: true, amendment: false },
  { name: 'CDNA', bucket: 'available', notes: true, amendment: true },
];
const SUMMARY_SHEETS_8A = ['Read me', 'Readme', 'Summary', 'Table 8A', '8A Summary', 'Help', 'Instructions'];

const sectionOf = (sheet: string): string => {
  const s = sheet.toUpperCase();
  if (s === 'B2B') return 'B2B';
  if (s === 'B2BA') return 'B2BA';
  return s.endsWith('A') ? 'CDNRA' : 'CDNR';
};

/** "May'26", "May-26", "052026", "05/2026" → "05/2026". */
export const periodOf8A = (v: string | null): string | null => (v ? parseSupplierPeriod(v.replace(/['’]/g, '-').replace(/\s+/g, '')) : null);

const fromRecord = (r: Gstr2bB2bRecord): Stored8ADoc => ({
  section: sectionOf(r.sheet),
  ctin: r.supplierGstin.replace(/\s+/g, '').toUpperCase(),
  name: r.supplierName || null,
  number: r.invoiceNumber,
  date: r.invoiceDate,
  family: r.docType === 'CREDIT_NOTE' ? 'CN' : r.docType === 'DEBIT_NOTE' ? 'DN' : 'INV',
  value: r.invoiceValue,
  pos: r.placeOfSupply ? (r.placeOfSupply.match(/^\d{1,2}/)?.[0].padStart(2, '0') ?? r.placeOfSupply) : null,
  reverseCharge: r.reverseCharge,
  taxable: r.taxableValue,
  igst: r.inputIgst,
  cgst: r.inputCgst,
  sgst: r.inputSgst,
  cess: r.cess,
  originalNumber: r.originalNumber,
  originalDate: r.originalDate,
  supplierPeriod: periodOf8A(r.gstr1Period),
  supplierFiledOn: parsePortalDate(r.gstr1FilingDate) ?? r.gstr1FilingDate,
  itcAvailable: r.itcAvailable,
  itcReason: r.itcReason,
  irn: r.irn,
});

const fromRecoDoc = (d: RecoDoc): Stored8ADoc => ({
  section: d.section, ctin: d.ctin, name: d.supplierName, number: d.number, date: d.date, family: d.family,
  value: d.docValue, pos: d.pos, reverseCharge: d.reverseCharge, taxable: d.taxable,
  igst: d.igst, cgst: d.cgst, sgst: d.sgst, cess: d.cess,
  originalNumber: d.original?.number ?? null, originalDate: d.original?.date ?? null,
  supplierPeriod: d.supplierPeriod, supplierFiledOn: d.supplierFiledOn,
  itcAvailable: d.itcAvailable, itcReason: d.itcReason, irn: d.irn,
});

export interface Parsed8A {
  stored: Omit<Stored8A, 'uploadedAt' | 'uploadedBy' | 'fy'> & { fy: string | null };
  /** FY the documents' dates point to (most of them), for the upload's check. */
  fyOfDocs: string | null;
}

const fyOfDocs = (docs: Stored8ADoc[]): string | null => {
  const n = new Map<string, number>();
  for (const d of docs) {
    if (!d.date) continue;
    const [y, m] = d.date.split('-').map(Number);
    const start = m >= 4 ? y : y - 1;
    const fy = `${start}-${String(start + 1).slice(-2)}`;
    n.set(fy, (n.get(fy) ?? 0) + 1);
  }
  const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
};

const fromJson = (raw: unknown, fileName: string | null): Parsed8A => {
  // A portal JSON in the 2B layout (docdata / b2b, cdnr with nt) or the 2A one (b2b, cdn).
  const st = docsFrom2B(raw, '03/2000') ?? docsFrom2A(raw, '03/2000');
  if (!st) throw new Error('This JSON holds no 8A documents (no b2b / cdnr section found).');
  const docs = st.docs.filter((d) => ['B2B', 'B2BA', 'CDNR', 'CDNRA'].includes(d.section)).map(fromRecoDoc);
  const left = st.docs.length - docs.length;
  return {
    stored: {
      _format: EIGHT_A_FORMAT, origin: 'portal-json', fy: null, gstin: null, generatedOn: st.meta.generatedOn, fileName,
      sheetsRead: [...new Set(docs.map((d) => d.section))], unread: left ? [`${left} documents of other sections`] : [], warnings: [], docs,
    },
    fyOfDocs: fyOfDocs(docs),
  };
};

/**
 * The portal's 8A workbook (seen live 25 Oct 2026) keeps its template's
 * dimension (B2B "A1:V6") however many rows it fills, and SheetJS reads only
 * that range: every document would be dropped. The range is set from the cells
 * the sheet really holds.
 */
function fitRange(ws: XLSX.WorkSheet | undefined): void {
  if (!ws) return;
  let r1 = -1, c1 = -1;
  let r0 = Infinity, c0 = Infinity;
  for (const k of Object.keys(ws)) {
    if (k.startsWith('!')) continue;
    const { r, c } = XLSX.utils.decode_cell(k);
    if (r < r0) r0 = r; if (c < c0) c0 = c;
    if (r > r1) r1 = r; if (c > c1) c1 = c;
  }
  if (r1 < 0) return;
  const cur = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
  const s = { r: Math.min(r0, cur ? cur.s.r : r0), c: Math.min(c0, cur ? cur.s.c : c0) };
  const e = { r: Math.max(r1, cur ? cur.e.r : r1), c: Math.max(c1, cur ? cur.e.c : c1) };
  ws['!ref'] = XLSX.utils.encode_range({ s, e });
}

/** The 8A file (Excel or JSON) → what is stored. Throws when it holds no document sheet at all. */
export function parse8AFile(data: ArrayBuffer | Uint8Array, fileName: string | null = null): Parsed8A {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const head = new TextDecoder().decode(bytes.slice(0, 64)).trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return fromJson(JSON.parse(new TextDecoder().decode(bytes)), fileName);

  const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
  wb.SheetNames.forEach((n) => fitRange(wb.Sheets[n]));
  const read = parseItcWorkbook(wb, {
    sheets: GSTR8A_SHEETS,
    summarySheets: SUMMARY_SHEETS_8A,
    looseAmendments: true,
    unreadWords: 'that the 8A comparison does not read',
  });
  if (!read.sheetsRead.length) {
    throw new Error(`No 8A document sheet found (looked for ${GSTR8A_SHEETS.map((s) => s.name).join(', ')}; the file has ${wb.SheetNames.join(', ') || 'no sheets'}).`);
  }
  const docs = read.records.map(fromRecord);
  return {
    stored: {
      _format: EIGHT_A_FORMAT,
      origin: 'portal-excel',
      fy: normalizeFy(read.header.financialYear),
      gstin: read.header.gstin ? read.header.gstin.replace(/\s+/g, '').toUpperCase() : null,
      generatedOn: parsePortalDate(read.header.generatedOn ?? undefined),
      fileName,
      sheetsRead: read.sheetsRead,
      unread: read.deferredSheetsWithData,
      warnings: read.warnings,
      docs,
    },
    fyOfDocs: fyOfDocs(docs),
  };
}

/**
 * Checks an 8A file against the client and year it is uploaded for, and
 * returns what to store. A file of another GSTIN or year is refused; a file
 * that names neither is judged by its documents' dates.
 */
export function check8AUpload(parsed: Parsed8A, want: { gstin: string | null; fy: string }, by: { at: string; name: string | null }): Stored8A {
  const s = parsed.stored;
  const gstin = (want.gstin ?? '').toUpperCase();
  if (s.gstin && gstin && s.gstin !== gstin) throw new Error(`This 8A file is for GSTIN ${s.gstin}, not ${gstin}.`);
  const fileFy = s.fy ?? parsed.fyOfDocs;
  if (fileFy && fileFy !== want.fy) throw new Error(`This 8A file is for FY ${fileFy}, not FY ${want.fy}. Pick a month of FY ${fileFy}, or download the 8A of FY ${want.fy}.`);
  if (!s.docs.length) throw new Error('The 8A file holds no documents.');
  return { ...s, fy: want.fy, uploadedAt: by.at, uploadedBy: by.name };
}
