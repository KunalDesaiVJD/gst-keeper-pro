// The reconciliation as the Reports Hub shows and exports it. toViewData turns
// one month's RecoResult into flat, signed rows (viewTypes.ts); mergeViewData
// joins months; the aggregates count any subset of rows (whatever the view's
// filters leave), so a tile, a summary line and an Excel total always agree;
// recoReportTable lays the whole report out for the Big4 Excel and PDF: the
// stat band, the document list with both sides next to each other, the summary
// by reason and the analysis sheets (by supplier, month, document type).
// Pure: no Supabase, no React, no clock. Generic over the pair of sources
// (headers come from their labels), so 2A vs 8A and 8A vs 2B reuse it.
// Positions and the presentation: docs/GSTR2A_2B_RECO_POSITIONS.md.
import type {
  ColumnGroup, ReportKpi, ReportMetaField, ReportSheet, ReportTable, RowKind, RowTone,
} from '@/utils/allClientsReports';
import { dayLabel, monthLabel, portalDate } from './dates';
import { PAIR_2A_2B, REASONS, statusLabel } from './reasons';
import { docSign } from './sources';
import type { DocFamily, RecoDoc, RecoResult, RecoRow, RecoStatus, StatementMeta } from './types';
import { STATUS_ORDER } from './types';
import type {
  GroupLine, ItcState, PeriodLine, ReasonLine, RecoSideView, RecoStatementView, RecoViewData, RecoViewRow,
  SideTotals, StatusCounts, SupplierLine,
} from './viewTypes';

/** Rounded to the paisa; never −0 (it would print as "(0.00)" in some renderers). */
const r2 = (n: number): number => {
  const v = Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
  return v === 0 ? 0 : v;
};
const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
/** 'MM/YYYY' → a sortable number; anything else sorts last. */
const pidx = (p: string): number => {
  const m = /^(\d{2})\/(\d{4})$/.exec(p || '');
  return m ? Number(m[2]) * 12 + Number(m[1]) : Number.MAX_SAFE_INTEGER;
};
const byPeriodKey = (a: string, b: string) => pidx(a) - pidx(b);

// ── Cells shared with table.ts (which re-exports them) ──────────────────────

/** Other code (the view, its tests) finds the difference column by this exact text. */
export const diffHeader = (left: string, right: string) => `Total Tax Difference (${right} minus ${left})`;

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
  /** ₹ per head within which figures count as the same (the pair's; 2A vs 2B: 1). */
  tolerance?: number;
}

// ── One month → view rows ───────────────────────────────────────────────────

const FAMILY_LABEL: Record<DocFamily, string> = {
  INV: 'Invoice', DN: 'Debit note', CN: 'Credit note', ISD: 'ISD credit', BOE: 'Bill of entry', OTHER: 'Other',
};
const FAMILY_ORDER: DocFamily[] = ['INV', 'DN', 'CN', 'ISD', 'BOE', 'OTHER'];
const docTypeOf = (family: DocFamily, amended: boolean): string => `${FAMILY_LABEL[family]}${amended ? ' (amended)' : ''}`;
const both = (a: string, b: string): string => (a && b && a !== b ? `${a} / ${b}` : a || b);

/** The GST rates in force (and the concessional ones), to snap a computed rate onto. */
const RATE_BANDS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];

/**
 * IGST + CGST + SGST over the taxable value, as a percentage, snapped to the
 * nearest band when within 0.5 (rounding on the document), else to 2 decimals.
 * Cess is left out: it is levied on its own basis (often per unit), and with it
 * a 28% car would read as 43%, matching no rate a filter offers.
 */
function rateOf(taxable: number, gst: number): number | null {
  if (Math.abs(taxable) < 0.005) return null;
  const raw = Math.abs(gst / taxable) * 100;
  let best = RATE_BANDS[0];
  for (const b of RATE_BANDS) if (Math.abs(raw - b) < Math.abs(raw - best)) best = b;
  return Math.abs(raw - best) <= 0.5 ? best : r2(raw);
}

const itcOf = (d: RecoDoc): ItcState | null =>
  d.bucket ?? (d.itcAvailable === true ? 'available' : d.itcAvailable === false ? 'not_available' : null);

function sideView(d: RecoDoc): RecoSideView {
  const s = docSign(d);
  return {
    ref: d.ref,
    statementPeriod: d.statementPeriod,
    section: d.section,
    family: d.family,
    docType: docTypeOf(d.family, d.isAmendment),
    isAmendment: d.isAmendment,
    original: d.original,
    number: d.number,
    date: d.date,
    docValue: r2(s * d.docValue),
    pos: d.pos,
    reverseCharge: d.reverseCharge,
    taxable: r2(s * d.taxable),
    igst: r2(s * d.igst),
    cgst: r2(s * d.cgst),
    sgst: r2(s * d.sgst),
    cess: r2(s * d.cess),
    tax: r2(s * (d.igst + d.cgst + d.sgst + d.cess)),
    rate: rateOf(d.taxable, d.igst + d.cgst + d.sgst),
    supplierPeriod: d.supplierPeriod,
    supplierFiledOn: d.supplierFiledOn,
    supplierFiled: d.supplierFiled,
    supplier3bFiled: d.supplier3bFiled,
    supplierCancelledFrom: d.supplierCancelledFrom,
    itc: itcOf(d),
    itcReason: d.itcReason,
    imsStatus: d.imsStatus,
    irn: d.irn,
  };
}

function viewRow(row: RecoRow, index: number, period: string, L: string, R: string): RecoViewRow {
  const l = row.left;
  const r = row.right;
  const d = (r ?? l) as RecoDoc;
  // A document whose section the other side does not read has no difference at all.
  const diff = row.status === 'not_compared' ? null : {
    taxable: r2(row.diff.taxable), igst: r2(row.diff.igst), cgst: r2(row.diff.cgst),
    sgst: r2(row.diff.sgst), cess: r2(row.diff.cess), tax: r2(row.diff.tax),
  };
  return {
    id: `${period}|${index}`,
    period,
    status: row.status,
    statusLabel: statusLabel(row.status, L, R),
    reason: row.reason,
    reasonLabel: REASONS[row.reason].label,
    detail: row.detail,
    reasonText: reasonCell(row),
    action: row.action || REASONS[row.reason].action,
    evidence: evidenceCell(row),
    confirmed: row.confirmed,
    refPeriod: row.refPeriod,
    notes: row.notes.map((n) => ({ code: n.code, label: REASONS[n.code].label, text: n.text })),
    ctin: d.ctin,
    supplierName: r?.supplierName ?? l?.supplierName ?? '',
    docType: l && r ? both(docTypeOf(l.family, l.isAmendment), docTypeOf(r.family, r.isAmendment)) : docTypeOf(d.family, d.isAmendment),
    family: d.family,
    section: d.section,
    isAmendment: !!(l?.isAmendment || r?.isAmendment),
    number: both(l?.number ?? '', r?.number ?? ''),
    date: d.date,
    dateDiffers: row.dateDiffers,
    viaAmendment: row.viaAmendment,
    reverseCharge: !!(l?.reverseCharge || r?.reverseCharge),
    left: l ? sideView(l) : null,
    right: r ? sideView(r) : null,
    diff,
    absTaxDiff: diff ? Math.abs(diff.tax) : 0,
  };
}

/** One month's reconciliation as view rows, in the engine's order (ids `${period}|${index}`). */
export function toViewData(result: RecoResult, info: TableInfo): RecoViewData {
  const L = result.left.label;
  const R = result.right.label;
  const statement: RecoStatementView = {
    period: info.period,
    leftPulledAt: info.left.pulledAt,
    rightGeneratedOn: info.right.generatedOn,
    leftState: info.left.state,
    rightState: info.right.state,
  };
  return {
    left: { key: result.left.key, label: L },
    right: { key: result.right.key, label: R },
    client: { name: info.client.name, gstin: info.client.gstin },
    periods: [info.period],
    rows: result.rows.map((row, i) => viewRow(row, i, info.period, L, R)),
    notes: result.notes.map((text) => ({ period: info.period, text })),
    statements: [statement],
    failed: [],
    tolerance: info.tolerance ?? PAIR_2A_2B.tolerance,
  };
}

/** Several months as one, in month order; `failed` are the months that could not be built. */
export function mergeViewData(parts: RecoViewData[], failed: { period: string; reason: string }[] = []): RecoViewData {
  const sorted = [...parts].sort((a, b) => byPeriodKey(a.periods[0] ?? '', b.periods[0] ?? ''));
  const first = sorted[0];
  const failedAll = [...sorted.flatMap((p) => p.failed), ...failed];
  return {
    left: first?.left ?? { key: '2A', label: '2A' },
    right: first?.right ?? { key: '2B', label: '2B' },
    client: first?.client ?? { name: '', gstin: null },
    periods: [...new Set(sorted.flatMap((p) => p.periods))].sort(byPeriodKey),
    rows: sorted.flatMap((p) => p.rows),
    notes: sorted.flatMap((p) => p.notes),
    statements: sorted.flatMap((p) => p.statements),
    failed: failedAll.sort((a, b) => byPeriodKey(a.period, b.period)),
    tolerance: first?.tolerance ?? PAIR_2A_2B.tolerance,
    // Several years merged are no longer one year.
    ...(first?.fy && sorted.every((p) => p.fy === first.fy) ? { fy: first.fy } : {}),
  };
}

// ── Aggregates over any subset of rows ──────────────────────────────────────

const zeroCounts = (): StatusCounts => ({ only_left: 0, only_right: 0, differs: 0, itc_differs: 0, not_compared: 0, matched: 0 });

export function statusCounts(rows: RecoViewRow[]): StatusCounts {
  const c = zeroCounts();
  for (const r of rows) c[r.status] += 1;
  return c;
}

/** One side's documents and signed figures; `docs` counts only the rows where that side exists. */
export function sideTotals(rows: RecoViewRow[], side: 'left' | 'right'): SideTotals {
  const t: SideTotals = { docs: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, tax: 0 };
  for (const r of rows) {
    const s = r[side];
    if (!s) continue;
    t.docs += 1;
    t.taxable += s.taxable; t.igst += s.igst; t.cgst += s.cgst; t.sgst += s.sgst; t.cess += s.cess; t.tax += s.tax;
  }
  return { docs: t.docs, taxable: r2(t.taxable), igst: r2(t.igst), cgst: r2(t.cgst), sgst: r2(t.sgst), cess: r2(t.cess), tax: r2(t.tax) };
}

/** Right tax minus left tax over the compared rows (not-compared rows have no difference). */
const netDiff = (rows: RecoViewRow[]): number => r2(rows.reduce((s, r) => s + (r.diff ? r.diff.tax : 0), 0));

interface Acc {
  rows: number; leftDocs: number; rightDocs: number; counts: StatusCounts;
  leftTaxable: number; rightTaxable: number; leftTax: number; rightTax: number; diff: number;
}
const newAcc = (): Acc => ({ rows: 0, leftDocs: 0, rightDocs: 0, counts: zeroCounts(), leftTaxable: 0, rightTaxable: 0, leftTax: 0, rightTax: 0, diff: 0 });
const addRow = (a: Acc, r: RecoViewRow) => {
  a.rows += 1;
  a.counts[r.status] += 1;
  if (r.left) { a.leftDocs += 1; a.leftTaxable += r.left.taxable; a.leftTax += r.left.tax; }
  if (r.right) { a.rightDocs += 1; a.rightTaxable += r.right.taxable; a.rightTax += r.right.tax; }
  if (r.diff) a.diff += r.diff.tax;
};
const settle = (a: Acc): Acc => ({
  ...a, leftTaxable: r2(a.leftTaxable), rightTaxable: r2(a.rightTaxable), leftTax: r2(a.leftTax), rightTax: r2(a.rightTax), diff: r2(a.diff),
});

/** One line per supplier (GSTIN; imports without one by name): the largest difference first, then by name. */
export function bySupplier(rows: RecoViewRow[]): SupplierLine[] {
  const m = new Map<string, { ctin: string; name: string; acc: Acc }>();
  for (const r of rows) {
    const key = r.ctin || `~${r.supplierName}`;
    let g = m.get(key);
    if (!g) { g = { ctin: r.ctin, name: r.supplierName, acc: newAcc() }; m.set(key, g); }
    if (!g.name && r.supplierName) g.name = r.supplierName;
    addRow(g.acc, r);
  }
  return [...m.values()]
    .map((g) => { const a = settle(g.acc); return { ctin: g.ctin, name: g.name, ...a }; })
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.name.localeCompare(b.name) || a.ctin.localeCompare(b.ctin));
}

/** One line per month of `periods` (in that order), then any month the rows hold that the list does not. */
export function byPeriod(rows: RecoViewRow[], periods: string[]): PeriodLine[] {
  const m = new Map<string, Acc>();
  for (const p of periods) if (!m.has(p)) m.set(p, newAcc());
  const extra = [...new Set(rows.map((r) => r.period).filter((p) => !m.has(p)))].sort(byPeriodKey);
  for (const p of extra) m.set(p, newAcc());
  for (const r of rows) addRow(m.get(r.period) as Acc, r);
  return [...m.entries()].map(([period, a]) => ({ period, ...settle(a) }));
}

const statusRank = (s: RecoStatus) => STATUS_ORDER.indexOf(s);

/** One line per (status, reason): the status order, then the most documents. */
export function byReason(rows: RecoViewRow[]): ReasonLine[] {
  const m = new Map<string, { status: RecoStatus; statusLabel: string; reason: RecoViewRow['reason']; acc: Acc }>();
  for (const r of rows) {
    const key = `${r.status}|${r.reason}`;
    let g = m.get(key);
    if (!g) { g = { status: r.status, statusLabel: r.statusLabel, reason: r.reason, acc: newAcc() }; m.set(key, g); }
    addRow(g.acc, r);
  }
  return [...m.values()]
    .map((g) => {
      const a = settle(g.acc);
      return {
        status: g.status, statusLabel: g.statusLabel, reason: g.reason, reasonLabel: REASONS[g.reason].label,
        action: REASONS[g.reason].action, count: a.rows,
        leftTaxable: a.leftTaxable, rightTaxable: a.rightTaxable, leftTax: a.leftTax, rightTax: a.rightTax, diff: a.diff,
      };
    })
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || b.count - a.count || a.reasonLabel.localeCompare(b.reasonLabel));
}

/** Any group-by of the rows (document type, section, ITC state, rate…): the most rows first, then by label. */
export function groupBy(rows: RecoViewRow[], keyOf: (r: RecoViewRow) => string, labelOf: (r: RecoViewRow) => string): GroupLine[] {
  const m = new Map<string, { label: string; acc: Acc }>();
  for (const r of rows) {
    const key = keyOf(r);
    let g = m.get(key);
    if (!g) { g = { label: labelOf(r), acc: newAcc() }; m.set(key, g); }
    addRow(g.acc, r);
  }
  return [...m.entries()]
    .map(([key, g]) => { const a = settle(g.acc); return { key, label: g.label, rows: a.rows, counts: a.counts, leftTax: a.leftTax, rightTax: a.rightTax, diff: a.diff }; })
    .sort((a, b) => b.rows - a.rows || a.label.localeCompare(b.label));
}

// ── The report ──────────────────────────────────────────────────────────────

/** Status → tint: matched good, one side only warn, a difference bad, not compared muted. */
export const STATUS_TONE: Record<RecoStatus, RowTone> = {
  matched: 'good', only_left: 'warn', only_right: 'warn', differs: 'bad', itc_differs: 'bad', not_compared: 'muted',
};

/** The status that speaks for a group: a difference, then one side only, then matched, then not compared. */
const WORST: RecoStatus[] = ['differs', 'itc_differs', 'only_left', 'only_right', 'matched', 'not_compared'];
const worstOf = (c: StatusCounts): RecoStatus => WORST.find((s) => c[s] > 0) ?? 'matched';

const ITC_REASON: Record<string, string> = { P: 'place of supply', C: 'time limit' };
const itcText = (s: RecoSideView | null): string => {
  if (!s || !s.itc) return '';
  if (s.itc === 'available') return 'Yes';
  if (s.itc === 'rejected') return 'Rejected';
  if (s.itc === 'reversal') return 'Reversal';
  const why = s.itcReason ? ITC_REASON[s.itcReason.toUpperCase()] ?? s.itcReason : '';
  return why ? `No (${why})` : 'No';
};

/** "Jul 2026", or "Apr 2025 to Mar 2026 (12 months)". */
const periodLabel = (periods: string[]): string => {
  if (!periods.length) return '';
  if (periods.length === 1) return monthLabel(periods[0]);
  return `${monthLabel(periods[0])} to ${monthLabel(periods[periods.length - 1])} (${periods.length} months)`;
};

/** "20 Sep 2026", or "14 Oct 2026 to 15 Oct 2026" across months; '' when none is known. */
const dayRange = (isos: (string | null)[]): string => {
  const known = [...new Set(isos.filter((d): d is string => !!d))].sort();
  if (!known.length) return '';
  return known.length === 1 ? dayLabel(known[0]) : `${dayLabel(known[0])} to ${dayLabel(known[known.length - 1])}`;
};

/** Documents in the order a reviewer reads them: month, status, supplier, date, number. */
const docOrder = (a: RecoViewRow, b: RecoViewRow): number =>
  pidx(a.period) - pidx(b.period)
  || statusRank(a.status) - statusRank(b.status)
  // A document without a supplier name (an import) goes after the named ones.
  || (a.supplierName || '￿').localeCompare(b.supplierName || '￿', 'en', { sensitivity: 'base' })
  || (a.date ?? '').localeCompare(b.date ?? '')
  || a.number.localeCompare(b.number, 'en', { numeric: true });

const kindsFor = (n: number, total: boolean): RowKind[] => [...Array(n).fill('data' as RowKind), ...(total ? ['total' as RowKind] : [])];
const sumCol = (rows: (string | number)[][], c: number): number => r2(rows.reduce((s, r) => s + (typeof r[c] === 'number' ? (r[c] as number) : 0), 0));

export interface RecoTableOptions {
  /** Default "GSTR-<left> vs GSTR-<right> Reconciliation". */
  title?: string;
  /** What the rows were filtered to, for an export of a filtered view: printed in the identification strip. */
  filterNote?: string;
}

/**
 * The whole report from view data (all of it, or the rows a filter left):
 * identification strip, stat band, the document list (one row per pair, 2A and
 * 2B next to each other, then the difference and the reason), the summary by
 * reason with the notes, and the analysis sheets. Its merge hook rebuilds it
 * across months from the rows, so a merged report is recomputed, never stitched.
 */
export function recoReportTable(data: RecoViewData, opts: RecoTableOptions = {}): ReportTable {
  const L = data.left.label;
  const R = data.right.label;
  const title = opts.title ?? `GSTR-${L} vs GSTR-${R} Reconciliation`;
  const name = data.client.name || 'Client';
  const gstin = data.client.gstin || 'not on record';
  const months = data.periods.length;
  const single = months === 1 ? data.statements.find((s) => s.period === data.periods[0]) ?? null : null;
  const period = data.fy ? `FY ${data.fy}` : periodLabel(data.periods);
  const DIFF = diffHeader(L, R);
  const rows = [...data.rows].sort(docOrder);

  // ── Identification ──
  const common = `Client: ${name}   |   GSTIN: ${gstin}`;
  const asOf = single ? `${L} pulled ${dayLabel(single.leftPulledAt)}   |   ${R} generated ${dayLabel(single.rightGeneratedOn)}` : '';
  const meta: ReportMetaField[] = [
    { label: 'Client', value: name },
    { label: 'GSTIN', value: gstin },
    { label: 'Period', value: period || 'none built' },
  ];
  if (single) {
    meta.push({ label: `${L} pulled`, value: dayLabel(single.leftPulledAt) }, { label: `${R} generated`, value: dayLabel(single.rightGeneratedOn) });
  } else if (months > 1) {
    // Each month is as of its own pulls (the By month sheet has them); the strip gives their span.
    const pulled = dayRange(data.statements.map((s) => s.leftPulledAt));
    const generated = dayRange(data.statements.map((s) => s.rightGeneratedOn));
    if (pulled) meta.push({ label: `${L} pulled`, value: pulled });
    if (generated) meta.push({ label: `${R} generated`, value: generated });
  }
  if (data.failed.length) meta.push({ label: 'Not built', value: data.failed.map((f) => monthLabel(f.period)).join(', ') });
  if (opts.filterNote) meta.push({ label: 'Filter', value: opts.filterNote });

  // ── Stat band ──
  const counts = statusCounts(rows);
  const lt = sideTotals(rows, 'left');
  const rt = sideTotals(rows, 'right');
  const net = netDiff(rows);
  const differ = counts.differs + counts.itc_differs;
  const pct = (k: number) => (rows.length ? `${Math.round((k / rows.length) * 1000) / 10}%` : undefined);
  const kpis: ReportKpi[] = [
    { label: 'Documents', value: rows.length, note: `${lt.docs} in ${L}, ${rt.docs} in ${R}` },
    { label: 'Matched', value: counts.matched, note: pct(counts.matched), tone: 'good' },
    { label: `Only in ${L}`, value: counts.only_left, note: pct(counts.only_left), tone: counts.only_left ? 'warn' : 'good' },
    { label: `Only in ${R}`, value: counts.only_right, note: pct(counts.only_right), tone: counts.only_right ? 'warn' : 'good' },
    { label: 'Figures differ', value: differ, note: counts.itc_differs ? `incl. ${counts.itc_differs} ITC differs` : pct(differ), tone: differ ? 'bad' : 'good' },
    { label: 'Not compared', value: counts.not_compared, note: counts.not_compared ? `not read in ${L}` : undefined, tone: 'muted' },
    { label: `${L} tax`, value: lt.tax, note: `${lt.docs} documents` },
    { label: `${R} tax`, value: rt.tax, note: `${rt.docs} documents` },
    { label: `Net difference (${R} minus ${L})`, value: net, note: 'compared documents', tone: Math.abs(net) > data.tolerance ? 'bad' : 'good' },
  ];

  // ── Document list ──
  const headers = [
    'Sr.', 'Month', 'Supplier GSTIN', 'Supplier Name', 'Doc Type', 'Doc No.', 'Doc Date', 'Section',
    `${L} Taxable Value`, `${L} IGST`, `${L} CGST`, `${L} SGST`, `${L} Cess`, `${L} Total Tax`, `${L} Filed On`,
    `${R} Taxable Value`, `${R} IGST`, `${R} CGST`, `${R} SGST`, `${R} Cess`, `${R} Total Tax`, `ITC in ${R}`,
    'Taxable Difference', DIFF,
    'Status', 'Reason', 'What to do', 'Evidence', 'Reverse Charge', 'Also note',
  ];
  const headerLabels = [
    'Sr.', 'Month', 'Supplier GSTIN', 'Supplier name', 'Doc type', 'Doc no.', 'Doc date', 'Section',
    'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total tax', 'Filed on',
    'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total tax', 'ITC',
    'Taxable value', 'Total tax',
    'Status', 'Reason', 'What to do', 'Evidence', 'Reverse charge', 'Also note',
  ];
  const columnGroups: ColumnGroup[] = [
    { label: 'Document', span: 8 },
    { label: `GSTR-${L}`, span: 7 },
    { label: `GSTR-${R}`, span: 7 },
    { label: `Difference (${R} minus ${L})`, span: 2 },
    { label: 'Reconciliation', span: 6 },
  ];
  // Excel widths; the PDF's columns (pdfColumns) are sized to fit a landscape page between them.
  const columnWidths = [5, 8, 17, 24, 12, 14, 10, 8, 13, 11, 11, 11, 9, 11, 10.5, 13, 11, 11, 11, 9, 11, 12, 12, 11, 12, 31, 36, 28, 8, 30];
  const amt = (s: RecoSideView | null, k: 'taxable' | 'igst' | 'cgst' | 'sgst' | 'cess' | 'tax'): number | '' => (s ? s[k] : '');
  const body: (string | number)[][] = rows.map((r, i) => {
    const a = r.left;
    const b = r.right;
    return [
      i + 1, monthLabel(r.period), r.ctin, r.supplierName, r.docType, r.number, portalDate(r.date), r.section,
      amt(a, 'taxable'), amt(a, 'igst'), amt(a, 'cgst'), amt(a, 'sgst'), amt(a, 'cess'), amt(a, 'tax'), a ? portalDate(a.supplierFiledOn) : '',
      amt(b, 'taxable'), amt(b, 'igst'), amt(b, 'cgst'), amt(b, 'sgst'), amt(b, 'cess'), amt(b, 'tax'), itcText(b),
      r.diff ? r.diff.taxable : '', r.diff ? r.diff.tax : '',
      r.statusLabel, r.reasonText, r.action, r.evidence, r.reverseCharge ? 'Yes' : 'No', r.notes.map((n) => n.text).join('; '),
    ];
  });
  // TOTAL: every amount column summed (a blank side counts 0), 'TOTAL' under Month.
  const AMOUNT_COLS = [8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 22, 23];
  const total: (string | number)[] = headers.map(() => '');
  total[1] = 'TOTAL';
  for (const c of AMOUNT_COLS) total[c] = sumCol(body, c);
  const docRows = [...body, total];

  // ── Summary by reason ──
  const reasons = byReason(rows);
  const sRows: (string | number)[][] = reasons.map((s) => [
    s.statusLabel, s.reasonLabel, s.count, s.leftTaxable, s.rightTaxable, s.leftTax, s.rightTax,
    s.status === 'not_compared' ? '' : s.diff, s.action,
  ]);
  sRows.push(['', 'TOTAL', rows.length, sumCol(sRows, 3), sumCol(sRows, 4), sumCol(sRows, 5), sumCol(sRows, 6), sumCol(sRows, 7), '']);
  // Several months (or a month that failed beside one that did not): each note says its month.
  const many = !data.fy && months + data.failed.length > 1;
  const tagged = [
    ...data.notes,
    ...data.failed.map((f) => ({ period: f.period, text: `Not built: ${f.reason}` })),
  ].map((n, i) => ({ ...n, i })).sort((a, b) => byPeriodKey(a.period, b.period) || a.i - b.i);
  const notes = tagged.map((n) => (many ? `${monthLabel(n.period)}: ${n.text}` : n.text));

  // ── By supplier ──
  const countCols = (c: StatusCounts) => [c.matched, c.only_left, c.only_right, c.differs + c.itc_differs, c.not_compared];
  const countHeads = ['Docs Matched', `Docs Only in ${L}`, `Docs Only in ${R}`, 'Docs Figures Differ', 'Docs Not Compared'];
  const countLabels = ['Matched', `Only in ${L}`, `Only in ${R}`, 'Figures differ', 'Not compared'];
  const suppliers = bySupplier(rows);
  const supRows: (string | number)[][] = suppliers.map((s) => [
    s.ctin, s.name || (s.ctin ? '' : 'Imports (no GSTIN)'), statusLabel(worstOf(s.counts), L, R),
    s.rows, s.leftDocs, s.rightDocs, ...countCols(s.counts),
    s.leftTaxable, s.rightTaxable, s.leftTax, s.rightTax, s.diff,
  ]);
  const supTotal: (string | number)[] = ['', 'TOTAL', ''];
  for (let c = 3; c < 16; c++) supTotal.push(sumCol(supRows, c));
  const supplierSheet: ReportSheet = {
    name: 'By supplier',
    title: 'By supplier',
    headers: ['Supplier GSTIN', 'Supplier Name', 'Status', 'Rows', `${L} Docs`, `${R} Docs`, ...countHeads,
      `${L} Taxable Value`, `${R} Taxable Value`, `${L} Total Tax`, `${R} Total Tax`, DIFF],
    headerLabels: ['GSTIN', 'Supplier name', 'Status', 'Rows', `In ${L}`, `In ${R}`, ...countLabels, L, R, L, R, `${R} minus ${L}`],
    columnGroups: [
      { label: 'Supplier', span: 3 }, { label: 'Documents', span: 8 }, { label: 'Taxable value', span: 2 },
      { label: 'Total tax', span: 2 }, { label: 'Tax difference', span: 1 },
    ],
    rows: [...supRows, supTotal],
    rowTones: [...suppliers.map((s) => STATUS_TONE[worstOf(s.counts)]), null],
    rowKinds: kindsFor(supRows.length, true),
    toneColumn: 2,
    freezeColumns: 2,
    columnWidths: [17, 30, 13, 6, 7, 7, 8, 8, 8, 8, 9, 13, 13, 12, 12, 12],
    pdfColumns: [1, 2, 3, 6, 7, 8, 9, 10, 13, 14, 15],
  };

  // ── By month (several months only) ──
  const sheets: ReportSheet[] = [supplierSheet];
  if (months > 1) {
    const lines = byPeriod(rows, data.periods);
    const stmt = new Map(data.statements.map((s) => [s.period, s]));
    const mRows: (string | number)[][] = lines.map((p) => [
      monthLabel(p.period), p.rows, p.leftDocs, p.rightDocs, ...countCols(p.counts),
      p.leftTaxable, p.rightTaxable, p.leftTax, p.rightTax, p.diff,
      portalDate(stmt.get(p.period)?.leftPulledAt), portalDate(stmt.get(p.period)?.rightGeneratedOn),
    ]);
    const mTotal: (string | number)[] = ['TOTAL'];
    for (let c = 1; c < 14; c++) mTotal.push(sumCol(mRows, c));
    mTotal.push('', '');
    sheets.push({
      name: 'By month',
      title: 'By month',
      headers: ['Month', 'Rows', `${L} Docs`, `${R} Docs`, ...countHeads,
        `${L} Taxable Value`, `${R} Taxable Value`, `${L} Total Tax`, `${R} Total Tax`, DIFF, `${L} Pulled On`, `${R} Generated On`],
      headerLabels: ['Month', 'Rows', `In ${L}`, `In ${R}`, ...countLabels, L, R, L, R, `${R} minus ${L}`, `${L} pulled`, `${R} generated`],
      columnGroups: [
        { label: 'Month', span: 1 }, { label: 'Documents', span: 8 }, { label: 'Taxable value', span: 2 },
        { label: 'Total tax', span: 2 }, { label: 'Tax difference', span: 1 }, { label: 'As of', span: 2 },
      ],
      rows: [...mRows, mTotal],
      rowKinds: kindsFor(mRows.length, true),
      // A month has no status word (nearly every month has some difference), so no tint either.
      toneColumn: -1,
      freezeColumns: 1,
      columnWidths: [10, 6, 7, 7, 8, 8, 8, 8, 9, 13, 13, 12, 12, 12, 11, 11],
      pdfColumns: [0, 1, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15],
    });
  }

  // ── By document type ──
  const famKey = (r: RecoViewRow) => `${r.family}${r.isAmendment ? 'A' : ''}`;
  const famRank = (k: string) => FAMILY_ORDER.indexOf(k.replace(/A$/, '') as DocFamily) * 2 + (k.endsWith('A') ? 1 : 0);
  const types = groupBy(rows, famKey, (r) => docTypeOf(r.family, r.isAmendment)).sort((a, b) => famRank(a.key) - famRank(b.key));
  const tRows: (string | number)[][] = types.map((g) => [g.label, g.rows, ...countCols(g.counts), g.leftTax, g.rightTax, g.diff]);
  const tTotal: (string | number)[] = ['TOTAL'];
  for (let c = 1; c < 10; c++) tTotal.push(sumCol(tRows, c));
  sheets.push({
    name: 'By document type',
    title: 'By document type',
    headers: ['Document Type', 'Rows', ...countHeads, `${L} Total Tax`, `${R} Total Tax`, DIFF],
    headerLabels: ['Document type', 'Rows', ...countLabels, L, R, `${R} minus ${L}`],
    columnGroups: [{ label: 'Document type', span: 1 }, { label: 'Documents', span: 6 }, { label: 'Total tax', span: 2 }, { label: 'Tax difference', span: 1 }],
    rows: [...tRows, tTotal],
    rowKinds: kindsFor(tRows.length, true),
    toneColumn: -1,
    columnWidths: [24, 7, 9, 9, 9, 9, 9, 14, 14, 14],
  });

  // ── Notes and evidence: every row with a flag or a reason not confirmed (Excel only) ──
  const flagged = rows.filter((r) => r.notes.length > 0 || r.confirmed === false);
  sheets.push({
    name: 'Notes and evidence',
    title: 'Notes and evidence',
    pdf: false,
    headers: ['Month', 'Supplier GSTIN', 'Supplier Name', 'Doc No.', 'Status', 'Reason', 'Evidence', 'Also note'],
    rows: flagged.map((r) => [monthLabel(r.period), r.ctin, r.supplierName, r.number, r.statusLabel, r.reasonText, r.evidence, r.notes.map((n) => n.text).join('; ')]),
    rowTones: flagged.map((r) => STATUS_TONE[r.status]),
    rowKinds: kindsFor(flagged.length, false),
    toneColumn: 4,
    freezeColumns: 4,
    columnWidths: [9, 17, 28, 14, 13, 44, 36, 40],
  });

  const allMonths = [...new Set([...data.periods, ...data.failed.map((f) => f.period)])].sort(byPeriodKey);
  const fileName = data.fy
    ? `GSTR${L}_vs_GSTR${R}_Reco_${fileSafe(name)}_FY_${data.fy}`
    : `GSTR${L}_vs_GSTR${R}_Reco_${fileSafe(name)}_${(allMonths[0] ?? 'none').replace('/', '-')}${allMonths.length > 1 ? `_${allMonths.length}months` : ''}`;

  return {
    title,
    subtitle: [common, period, asOf].filter(Boolean).join('   |   '),
    // The client and GSTIN hold for every month; the "as of" dates are this month's alone.
    subtitleParts: { common, period: asOf ? `As of: ${asOf.replace(/ {3}\| {3}/g, '; ')}.` : '' },
    meta,
    kpis,
    headers,
    headerLabels,
    columnGroups,
    rows: docRows,
    rowTones: [...rows.map((r) => STATUS_TONE[r.status]), null],
    rowKinds: kindsFor(rows.length, true),
    toneColumn: headers.indexOf('Status'),
    freezeColumns: 4,
    sheetName: 'Documents',
    fileNameBase: fileName,
    columnWidths,
    // Month, supplier, number, date, both taxes, the difference, status and reason: a landscape page.
    pdfColumns: [1, 3, 5, 6, 13, 20, 23, 24, 25],
    summary: {
      title: 'Summary by reason',
      headers: ['Status', 'Reason', 'Documents', `${L} Taxable Value`, `${R} Taxable Value`, `${L} Total Tax`, `${R} Total Tax`, DIFF, 'What to do'],
      rows: sRows,
      rowTones: [...reasons.map((s) => STATUS_TONE[s.status]), null],
      rowKinds: kindsFor(reasons.length, true),
      toneColumn: 0,
      columnWidths: [12, 30, 9, 11, 11, 11, 11, 11, 26],
      notes,
    },
    extraSheets: sheets,
    reco: data,
    // Several months: rebuilt from every month's rows, so the summary, the
    // stat band and the analysis sheets are recomputed across them (a month that
    // could not be built is named in the notes, by its place in `periods`).
    merge: (tables, periods) => {
      const parts: RecoViewData[] = [];
      const failed: { period: string; reason: string }[] = [];
      tables.forEach((t, i) => {
        if (t.reco && !t.failedReason) parts.push(t.reco);
        else failed.push({ period: periods[i] ?? '', reason: t.failedReason ?? 'not built' });
      });
      const firstBuilt = tables.find((t) => t.reco && !t.failedReason);
      return recoReportTable(mergeViewData(parts, failed), { title: firstBuilt?.title ?? title });
    },
  };
}
