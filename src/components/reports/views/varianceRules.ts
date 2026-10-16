// How the variance view (VarianceComparisonView) reads a "does A match B"
// table before the table kit draws it: which column is the delta, what counts
// as a mismatch, and whether the rows add up to the report's TOTAL (a list of
// heads or entities) or are unlike measures (a statement). No React, so
// scripts/verify-variance-annual-views.mjs checks it against the shape of
// every report the view opens.
import { rowKindsOf } from '@/lib/reportExport/layout';
import type { ReportTable, RowKind } from '@/utils/allClientsReports';
import { isFigureColumn, type ColumnFilter, type TableModel } from './tableKit/tableModel';

/**
 * A variance within plus or minus 0.50 is rounding, not a mismatch: the
 * portal's figures are rupees and paise, and the two returns round on their
 * own. The rule the view has always used, now a filter the kit applies.
 */
export const MISMATCH_TOLERANCE = 0.5;

export const isMismatch = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) > MISMATCH_TOLERANCE;

/** "Mismatches only" as a filter on the delta column, so it is a chip, feeds the counts and the TOTAL, and is printed on the export. */
export const MISMATCH_FILTER: ColumnFilter = { type: 'number', min: null, max: null, nonZero: true, tolerance: MISMATCH_TOLERANCE };

/**
 * Whether a delta column's filter is the "mismatches only" one (whatever range
 * was typed beside it): not nil beyond the view's own tolerance. A plain "Not
 * nil" ticked in the column's menu keeps the rounding variances, so it is not:
 * lit for it, the switch and the Mismatched tile would name rows the list
 * does not keep, and a click would take the filter off instead of applying it.
 */
export const isMismatchFilter = (f: ColumnFilter | undefined): boolean =>
  f?.type === 'number' && !!f.nonZero && f.tolerance === MISMATCH_TOLERANCE;

/**
 * The delta column's filter with "mismatches only" switched on or off, keeping
 * any range typed beside it. Switched on over a plain "Not nil", the filter
 * becomes the mismatch one.
 */
export const withMismatchFilter = (f: ColumnFilter | undefined, on: boolean): ColumnFilter | undefined => {
  const cur = f?.type === 'number' ? f : null;
  if (on) return { ...MISMATCH_FILTER, ...(cur ? { min: cur.min, max: cur.max } : {}) };
  return cur ? { type: 'number', min: cur.min, max: cur.max } : undefined;
};

const VARIANCE_HEADER_RE = /variance|difference|\bdiff\b|delta|mismatch/i;
// "2B − 2A", "Liability − ITC": one figure minus another (a minus sign, an en
// dash or a spaced hyphen; never an em dash, which the reports use as a pause).
const MINUS_HEADER_RE = /\S\s+[−–-]\s+\S/;

export interface DeltaColumn {
  col: number;
  /**
   * 'mismatch' for a column named as a variance (the two sides should agree);
   * 'difference' for one headed "A − B" (the gap between two figures, which
   * need not be nil, e.g. liability less ITC).
   */
  wording: 'mismatch' | 'difference';
}

/**
 * The delta column: the rightmost figure column headed as a variance, else as
 * one figure minus another. A report with neither has none: its last figure
 * (a cess, a total payable) is a figure like the others, not a difference,
 * and colouring it as one would call every payable a mismatch.
 */
export function deltaColumn(model: TableModel): DeltaColumn | null {
  for (let c = model.headers.length - 1; c >= 0; c--) {
    if (!isFigureColumn(model, c)) continue;
    if (VARIANCE_HEADER_RE.test(model.headers[c])) return { col: c, wording: 'mismatch' };
  }
  for (let c = model.headers.length - 1; c >= 0; c--) {
    if (!isFigureColumn(model, c)) continue;
    if (MINUS_HEADER_RE.test(model.headers[c])) return { col: c, wording: 'difference' };
  }
  return null;
}

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();

/** A row of a statement printed as a total ("Total", "Total Tax"): drawn bold, though it filters like any row. */
export const isTotalLabelRow = (cells: (string | number)[]): boolean => /^total\b/i.test(cells.map(text).find((s) => s !== '') ?? '');

export interface TableShape {
  /** The row kinds the kit reads. */
  rowKinds: RowKind[];
  /** The columns a TOTAL adds up ([] for a statement). */
  summable: number[];
  /** The rows are unlike measures: no TOTAL is recomputed, and a TOTAL-looking row is a row like any other. */
  statement: boolean;
}

/**
 * Whether the rows add up. A column adds up when every TOTAL the report
 * printed equals the sum of the rows above it in that column (within its
 * period, for a merge); the table is a list when at least one column does and
 * no row is left outside a TOTAL. Otherwise it is a statement of unlike
 * measures (the taxable value above the tax heads, the declared liability above
 * the payment, the GSTR-1 sections above the GSTR-3B rows), where a "TOTAL
 * (filtered)" would add unlike things, so the kit recomputes none.
 *
 * Also: a lone label with nothing else in its row is a heading, even in a
 * two-column table (the layout's guess wants three columns before it says so).
 */
export function readShape(table: Pick<ReportTable, 'headers' | 'rows' | 'rowKinds'>): TableShape {
  const guessed = rowKindsOf(table.rows, table.rowKinds);
  const n = table.headers.length;
  const kinds: RowKind[] = guessed.map((k, i) => {
    const cells = table.rows[i];
    const lone = k === 'data' && n >= 2 && typeof cells[0] === 'string' && text(cells[0]) !== '' && cells.slice(1).every((c) => text(c) === '');
    return lone ? 'section' : k;
  });

  const seen = new Array<boolean>(n).fill(false);
  const adds = new Array<boolean>(n).fill(true);
  let acc = new Array<number>(n).fill(0);
  let open = false;
  let outside = false;
  kinds.forEach((k, i) => {
    const cells = table.rows[i];
    if (k === 'period') {
      if (open) outside = true;
      acc = new Array<number>(n).fill(0);
      open = false;
    } else if (k === 'data') {
      cells.forEach((v, c) => { if (typeof v === 'number' && Number.isFinite(v)) acc[c] += v; });
      open = true;
    } else if (k === 'total') {
      cells.forEach((v, c) => {
        if (typeof v !== 'number' || !Number.isFinite(v)) return;
        seen[c] = true;
        if (Math.abs(acc[c] - v) > 0.05 + Math.abs(v) * 1e-9) adds[c] = false;
      });
      acc = new Array<number>(n).fill(0);
      open = false;
    }
  });
  if (open) outside = true;

  const summable = outside ? [] : seen.map((s, c) => (s && adds[c] ? c : -1)).filter((c) => c >= 0);
  const statement = summable.length === 0;
  return {
    rowKinds: statement ? kinds.map((k) => (k === 'total' || k === 'subtotal' ? 'data' : k)) : kinds,
    summable,
    statement,
  };
}

/** "PAN: AAMCA2528C" in a PAN roll-up's subtitle, with its entity count when stated. */
export const parsePanBanner = (subtitle: string): { pan: string; declaredEntityCount: number | null } | null => {
  const panMatch = subtitle.match(/PAN:\s*([A-Za-z0-9]+)/);
  if (!panMatch) return null;
  const countMatch = subtitle.match(/(\d+)\s*(entit(?:y|ies)|gstins?|compan(?:y|ies))/i);
  return { pan: panMatch[1], declaredEntityCount: countMatch ? parseInt(countMatch[1], 10) : null };
};

const META_PART_RE = /^[A-Za-z][A-Za-z0-9 .()/&'-]{0,40}:\s+\S/;
const MONTH_LABEL_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-]+\d{2,4}$/i;

/**
 * A subtitle as the header card shows it: the short identification parts
 * ("Client: …", "GSTIN: …", "FY 2025-26") on one line, the explanation that
 * follows them as a note. A merge keeps the first month's subtitle, so its
 * month is dropped there: it is not the report's period. Shared with the
 * annual trend view.
 */
export function splitSubtitle(subtitle: string, merged: boolean, drop: RegExp | null = null): { parts: string[]; notes: string[] } {
  const parts: string[] = [];
  const notes: string[] = [];
  for (const raw of subtitle.split('|')) {
    const s = raw.trim();
    if (!s || (drop && drop.test(s))) continue;
    if (merged && (MONTH_LABEL_RE.test(s) || /^(period|month|return period):/i.test(s))) continue;
    if (s.length <= 60 && (META_PART_RE.test(s) || MONTH_LABEL_RE.test(s) || /^fy\s/i.test(s) || /^\d+ /.test(s))) parts.push(s);
    else notes.push(s);
  }
  return { parts, notes };
}

/**
 * The "filtered" export's stat band names each figure by its column's full
 * header; "As per GSTR-3B (Table 4A, gross ITC available)" does not fit a
 * tile, so a long one keeps the words before its bracket (the column heading
 * under it still says it in full). Shared with the annual trend view.
 */
export const shortKpiLabels = (t: ReportTable): ReportTable => ({
  ...t,
  ...(t.kpis ? { kpis: t.kpis.map((k) => (k.label.length > 26 && /\s\(/.test(k.label) ? { ...k, label: k.label.replace(/\s*\(.*$/, '') } : k)) } : {}),
});
