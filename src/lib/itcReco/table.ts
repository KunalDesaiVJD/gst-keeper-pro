// RecoResult → ReportTable: a summary by reason (with the "could not confirm"
// notes) and the document list. Generic over the pair of sources (headers are
// built from their labels) so 2A vs 8A and 8A vs 2B reuse it. Credit notes are
// negative in every amount column; the last row of each part is
// ['', 'TOTAL', …] so the PDF bolds it and a merge renames it per period.
import type { ReportTable } from '@/utils/allClientsReports';
import { dayLabel, monthLabel, portalDate } from './dates';
import { signedTax, signedTaxable } from './engine';
import { REASONS, statusLabel } from './reasons';
import { docSign } from './sources';
import type { RecoDoc, RecoResult, RecoRow, StatementMeta } from './types';

const r2 = (n: number): number => Math.round(n * 100) / 100;
const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export const diffHeader = (left: string, right: string) => `Total Tax Difference (${right} minus ${left})`;

/** Document list headers for a pair (Excel has all of them). */
export const docHeaders = (L: string, R: string): string[] => [
  'Status', 'Reason', 'What to do', 'Evidence', 'Supplier GSTIN', 'Supplier Name', 'Doc Type', 'Doc No.', 'Doc Date',
  'Supplier Period', 'Supplier Filed On',
  `${L} Taxable Value`, `${R} Taxable Value`,
  `${L} IGST`, `${R} IGST`, `${L} CGST`, `${R} CGST`, `${L} SGST`, `${R} SGST`, `${L} Cess`, `${R} Cess`,
  `${L} Total Tax`, `${R} Total Tax`, diffHeader(L, R),
  'Reverse Charge', `ITC Available in ${R}`, 'Also note',
];
export const DOC_WIDTHS = [10, 26, 30, 24, 16, 15, 10, 11, 9, 9, 9, 11, 11, 10, 10, 10, 10, 10, 10, 8, 8, 11, 11, 11, 8, 10, 30];
/** The PDF prints these document columns: Status, Reason, GSTIN, Name, Doc No., Date, Filed On, both taxes, difference. */
export const DOC_PDF_COLUMNS = [0, 1, 4, 5, 7, 8, 10, 21, 22, 23];

export const summaryHeaders = (L: string, R: string): string[] => [
  'Status', 'Reason', 'Documents', `${L} Taxable Value`, `${R} Taxable Value`, `${L} Total Tax`, `${R} Total Tax`, diffHeader(L, R), 'What to do',
];
export const SUMMARY_WIDTHS = [10, 26, 10, 11, 11, 11, 11, 11, 26];

const FAMILY_LABEL: Record<RecoDoc['family'], string> = {
  INV: 'Invoice', DN: 'Debit note', CN: 'Credit note', ISD: 'ISD credit', BOE: 'Bill of entry', OTHER: 'Other',
};
const docType = (d: RecoDoc): string => `${FAMILY_LABEL[d.family]}${d.isAmendment ? ' (amended)' : ''}`;
const both = (a: string, b: string): string => (a && b && a !== b ? `${a} / ${b}` : a || b);
const amt = (d: RecoDoc | undefined, v: number | undefined): number | '' => (d ? r2(docSign(d) * (v ?? 0)) : '');

const itcCell = (r: RecoDoc | undefined): string => {
  if (!r) return '';
  if (r.bucket === 'rejected') return 'Rejected';
  if (r.bucket === 'reversal') return 'Reversal';
  if (r.itcAvailable === false) return `No${r.itcReason ? ` (${r.itcReason})` : ''}`;
  return r.itcAvailable === true ? 'Yes' : '';
};

export const reasonCell = (row: RecoRow): string => {
  const label = REASONS[row.reason].label;
  const text = row.detail ? `${label}: ${row.detail}` : label;
  return row.confirmed === false ? `${text} (not confirmed)` : text;
};
export const evidenceCell = (row: RecoRow): string =>
  row.confirmed === false && row.evidence ? `Not confirmed: ${row.evidence.charAt(0).toLowerCase()}${row.evidence.slice(1)}` : row.evidence;

export interface TableInfo {
  title?: string;
  client: { name: string; gstin: string | null };
  period: string;
  left: StatementMeta;
  right: StatementMeta;
}

export function docRow(row: RecoRow, L: string, R: string): (string | number)[] {
  const l = row.left;
  const r = row.right;
  const d = (r ?? l) as RecoDoc;
  return [
    statusLabel(row.status, L, R),
    reasonCell(row),
    row.action || REASONS[row.reason].action,
    evidenceCell(row),
    d.ctin,
    r?.supplierName ?? l?.supplierName ?? '',
    l && r ? both(docType(l), docType(r)) : docType(d),
    both(l?.number ?? '', r?.number ?? ''),
    both(portalDate(l?.date), portalDate(r?.date)),
    both(l?.supplierPeriod ?? '', r?.supplierPeriod ?? ''),
    both(portalDate(l?.supplierFiledOn), portalDate(r?.supplierFiledOn)),
    amt(l, l?.taxable), amt(r, r?.taxable),
    amt(l, l?.igst), amt(r, r?.igst), amt(l, l?.cgst), amt(r, r?.cgst),
    amt(l, l?.sgst), amt(r, r?.sgst), amt(l, l?.cess), amt(r, r?.cess),
    l ? r2(signedTax(l)) : '', r ? r2(signedTax(r)) : '',
    row.status === 'not_compared' ? '' : row.diff.tax,
    l?.reverseCharge || r?.reverseCharge ? 'Yes' : 'No',
    itcCell(r),
    row.notes.map((n) => n.text).join('; '),
  ];
}

/** The ReportTable of one reconciliation: summary (with notes) plus the document list. */
export function toReportTable(result: RecoResult, info: TableInfo): ReportTable {
  const L = result.left.label;
  const R = result.right.label;
  const headers = docHeaders(L, R);
  const rows = result.rows.map((row) => docRow(row, L, R));

  // Document TOTAL: every amount column summed (blank cells count 0).
  const total: (string | number)[] = headers.map(() => '');
  total[1] = 'TOTAL';
  for (let c = 11; c <= 23; c++) total[c] = r2(rows.reduce((s, row) => s + (typeof row[c] === 'number' ? (row[c] as number) : 0), 0));
  rows.push(total);

  const sRows: (string | number)[][] = result.summary.map((s) => [
    statusLabel(s.status, L, R), REASONS[s.reason].label, s.count,
    s.leftTaxable, s.rightTaxable, s.leftTax, s.rightTax,
    s.status === 'not_compared' ? '' : s.diff,
    REASONS[s.reason].action,
  ]);
  const sum = (k: 'count' | 'leftTaxable' | 'rightTaxable' | 'leftTax' | 'rightTax' | 'diff') => r2(result.summary.reduce((a, s) => a + s[k], 0));
  sRows.push(['', 'TOTAL', sum('count'), sum('leftTaxable'), sum('rightTaxable'), sum('leftTax'), sum('rightTax'), sum('diff'), '']);

  const title = info.title ?? `GSTR-${L} vs GSTR-${R} Reconciliation`;
  const name = info.client.name || 'Client';
  const common = `Client: ${name}   |   GSTIN: ${info.client.gstin || 'not on record'}`;
  const asOf = `${L} pulled ${dayLabel(info.left.pulledAt)}   |   ${R} generated ${dayLabel(info.right.generatedOn)}`;
  return {
    title,
    subtitle: `${common}   |   ${monthLabel(info.period)}   |   ${asOf}`,
    // Merged months: every reason is as of its own month's pulls.
    subtitleParts: { common, period: `As of: ${asOf.replace(/ {3}\| {3}/g, '; ')}.` },
    headers,
    rows,
    fileNameBase: `GSTR${L}_vs_GSTR${R}_Reco_${fileSafe(name)}_${info.period.replace('/', '-')}`,
    columnWidths: DOC_WIDTHS,
    pdfColumns: DOC_PDF_COLUMNS,
    summary: {
      title: 'Summary by reason',
      headers: summaryHeaders(L, R),
      rows: sRows,
      columnWidths: SUMMARY_WIDTHS,
      notes: result.notes,
    },
  };
}

/** Taxable and tax of the documents of one side, signed (for checks and tiles). */
export const sideTotals = (rows: RecoRow[], side: 'left' | 'right') => ({
  taxable: r2(rows.reduce((s, r) => s + signedTaxable(r[side]), 0)),
  tax: r2(rows.reduce((s, r) => s + signedTax(r[side]), 0)),
});
