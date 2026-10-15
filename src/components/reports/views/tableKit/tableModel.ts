// The pure half of the table kit (./index.ts), first written for the document
// list (DocumentLineItemsView.tsx) and now shared by every report view that
// filters its rows: which rows are documents and which are the report's own
// structure (TOTAL rows, the "— MM/YYYY —" bands of a multi-period merge,
// section headings), the kind of each column, and the filter, sort, group and
// total rules. No React and no DOM, so scripts/verify-doc-table-model.mjs runs
// it under Node.
//
// Rules the views and their "filtered" exports rely on:
//   - Only document rows are filtered, sorted and grouped. Bands, headings and
//     the report's TOTAL rows keep their place and are shown only in the
//     report's own order: a band between sorted rows would mean nothing.
//   - With nothing filtered the report's own TOTAL rows stand. Once anything is
//     filtered a TOTAL is recomputed over the rows still shown and says so, so
//     no figure on screen describes rows that are hidden.
//   - Filters are AND across columns and OR within one column's ticked values;
//     a column's value counts honour every filter except its own, so ticking a
//     second supplier is always possible.
import { classifyColumns, fmtDate, fmtNumber, parseDateCell, rowKindsOf, type ColumnKind } from '@/lib/reportExport/layout';
import type { ColumnGroup, ReportTable, RowKind, RowTone } from '@/utils/allClientsReports';

export type Cell = string | number;
export type Row = Cell[];

/**
 * Ticked values (OR), a text search, a numeric range, a date range (ISO yyyy-mm-dd).
 * A number filter's `tolerance` goes with `nonZero`: a figure within plus or
 * minus that much counts as nil (a variance of a few paise is rounding, not a
 * mismatch). Without it only a true nil (under 0.005) is left out.
 */
export type ColumnFilter =
  | { type: 'values'; values: string[] }
  | { type: 'contains'; text: string }
  | { type: 'number'; min: number | null; max: number | null; nonZero?: boolean; tolerance?: number }
  | { type: 'date'; from: string | null; to: string | null };

export type FilterKind = ColumnFilter['type'];

export interface SortState { col: number; dir: 'asc' | 'desc' }

/**
 * A view's own quick filter that is not one column's: an "Overdue" tile read
 * from rowFlags, a "differences only" switch. It narrows the rows like any
 * other filter (ANDed, honoured by the value counts, the TOTAL and the
 * export), and its label is printed as a chip and in the export's strip, so a
 * reader always sees why rows are missing. `test` is given a document row.
 */
export interface CustomFilter { id: string; label: string; test: (row: ModelRow) => boolean }

export interface ViewState {
  search: string;
  filters: Record<number, ColumnFilter | undefined>;
  sort: SortState | null;
  groupBy: number | null;
  /** The view's own quick filters, by id (absent or empty: none). */
  custom?: CustomFilter[];
}

export const EMPTY_VIEW: ViewState = { search: '', filters: {}, sort: null, groupBy: null };

/** A text column with at most this many values is filtered by ticking values; above it, by "contains". */
export const FACET_LIMIT = 60;
/** A column can be grouped by when it has at most this many values. */
export const GROUP_LIMIT = 200;
/** The facet key of an empty cell. */
export const BLANK = '(blank)';
/** The facet key of a cell holding a link (a "PDF" column). */
export const HAS_LINK = 'Has link';

export interface ModelColumn {
  /** Index into a row's cells; the Period column of a merged table is headers.length. */
  index: number;
  header: string;
  /** The heading shown (the report's short headerLabel when it gave one). */
  label: string;
  /**
   * What the column is called away from its heading (filter chips, menus, the
   * export strip): its label, or the full header when another column shares
   * that label ("Total tax" under 2A, 2B and the difference).
   */
  name: string;
  kind: ColumnKind | 'period';
  filter: FilterKind;
  /** Distinct values among the document rows. */
  distinct: number;
  groupable: boolean;
  summable: boolean;
  virtual: boolean;
}

export interface ModelRow {
  /** Index in table.rows. */
  i: number;
  kind: RowKind;
  cells: Row;
  /** Index into model.periods of the band above the row (merged tables), else -1. */
  period: number;
  /** Index in table.rows of the section heading above the row, else -1. */
  section: number;
  /** Lower-cased text the global search looks in (document rows only). */
  hay: string;
}

export interface PeriodBand { key: string; label: string; row: number }

export interface TableModel {
  headers: string[];
  /** One per header, then the Period column when the table is a multi-period merge. */
  columns: ModelColumn[];
  rows: ModelRow[];
  /** The document rows, in the report's order. */
  data: ModelRow[];
  merged: boolean;
  periods: PeriodBand[];
  /** The Period column's index (headers.length), or -1 when not merged. */
  periodCol: number;
  /** The report's own grand TOTAL (a single-period table's last TOTAL), pinned under the list. */
  grandTotal: ModelRow | null;
  /** Whether the report printed any TOTAL / subtotal rows of its own. */
  hasReportTotals: boolean;
  /** Columns a TOTAL adds up. */
  summable: number[];
  /** Where a TOTAL's label goes (the column the report's own TOTAL label sits in). */
  labelCol: number;
  /**
   * A sort reorders rows only inside their section (and period), the headings
   * staying in the report's order: a return or a working paper is read section
   * by section, so a sorted row must not leave the heading it belongs under.
   * Set by the hook's `sortWithinSections` option.
   */
  sortWithinSections?: boolean;
  /**
   * The report's own TOTAL rows stand as printed, filtered or not, and nothing
   * is added up (no TOTAL recomputed over the rows shown, no group subtotal):
   * a return's rows include their own totals and a working paper's are the
   * steps of a computation, so a sum of the rows shown would add a total to its
   * own parts. Set by the hook's `sums: false` option (summable is then empty).
   */
  keepReportTotals?: boolean;
}

// ── Cells ──────────────────────────────────────────────────────────────────

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();
const isUrl = (v: unknown): boolean => typeof v === 'string' && /^https?:\/\//i.test(v.trim());
const isNil = (s: string): boolean => s === '' || s === '—' || s === '-' || s === '–';
const PERIOD_BAND_RE = /^— (.+) —$/;
const SERIAL_HEADER_RE = /^(#|sr\.?|s\.?\s?no\.?|sl\.?\s?no\.?|sr\.?\s*no\.?)$/i;
const TOTAL_TEXT_RE = /^(grand\s+)?total\b|^sub[\s-]?total\b/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "04/2025" as "Apr 2025"; anything else as given. */
export const periodLabel = (key: string): string => {
  const m = /^(\d{2})\/(\d{4})$/.exec(key);
  return m && +m[1] >= 1 && +m[1] <= 12 ? `${MONTHS[+m[1] - 1]} ${m[2]}` : key;
};

const numberKind = (kind: ModelColumn['kind'] | undefined): 'int' | 'rate' | 'amount' =>
  (kind === 'int' || kind === 'rate' ? kind : 'amount');

/** Whether a column holds figures (amounts, counts, rates): right-aligned, summed, ranged. */
export const isFigureColumn = (model: TableModel, col: number): boolean => {
  const k = model.columns[col]?.kind;
  return k === 'amount' || k === 'int' || k === 'rate';
};

/** A figure in its column's house style (1,23,456.00; counts without decimals; 18.00%). */
export const figureText = (model: TableModel, col: number, v: number): string => fmtNumber(v, numberKind(model.columns[col]?.kind));

/** The text a cell is shown as: figures in the house style, dates as dd-Mon-yyyy. */
export function displayText(model: TableModel, row: ModelRow, col: number): string {
  if (col === model.periodCol) return row.period >= 0 ? model.periods[row.period].label : '';
  const v = row.cells[col];
  const c = model.columns[col];
  if (typeof v === 'number') return fmtNumber(v, numberKind(c?.kind));
  if (c?.kind === 'date') return fmtDate(v);
  return str(v);
}

/** The value a cell is ticked by in a column's value list. */
export function facetKey(model: TableModel, row: ModelRow, col: number): string {
  if (col === model.periodCol) return row.period >= 0 ? model.periods[row.period].key : BLANK;
  const v = row.cells[col];
  const c = model.columns[col];
  // A link is never worth ticking one by one: every link is one value.
  if (isUrl(v)) return HAS_LINK;
  if (typeof v === 'number') return c?.kind === 'rate' ? fmtNumber(v, 'rate') : String(v);
  const s = str(v);
  return s === '' ? BLANK : s;
}

/** How a facet key is listed (a period key reads as its month). */
export function facetLabel(model: TableModel, col: number, key: string): string {
  if (col === model.periodCol) return model.periods.find((p) => p.key === key)?.label ?? key;
  return key;
}

const haystack = (cells: Row, kinds: (ModelColumn['kind'])[]): string => cells.map((v, c) => {
  if (typeof v === 'number') return `${v} ${fmtNumber(v, numberKind(kinds[c]))}`;
  const s = str(v);
  return kinds[c] === 'date' ? `${s} ${fmtDate(s)}` : s;
}).join('\u0001').toLowerCase();

// ── The model ──────────────────────────────────────────────────────────────

type TableInput = Pick<ReportTable, 'headers' | 'rows'> & Partial<Pick<ReportTable, 'rowKinds' | 'columnWidths' | 'headerLabels'>>;

export function buildModel(table: TableInput): TableModel {
  const { headers } = table;
  const kinds = rowKindsOf(table.rows, table.rowKinds);
  const specs = classifyColumns(headers, table.rows, kinds, table.columnWidths, table.headerLabels);
  const colKinds = specs.map((s) => s.kind);
  const shared = new Set(specs.map((s) => s.label).filter((l, k, all) => all.indexOf(l) !== k));

  const periods: PeriodBand[] = [];
  let period = -1;
  let section = -1;
  const rows: ModelRow[] = table.rows.map((cells, i) => {
    const kind = kinds[i];
    if (kind === 'period') {
      const key = PERIOD_BAND_RE.exec(str(cells[0]))?.[1] ?? str(cells[0]);
      periods.push({ key, label: periodLabel(key), row: i });
      period = periods.length - 1;
      section = -1;
      return { i, kind, cells, period, section: -1, hay: '' };
    }
    if (kind === 'section') {
      section = i;
      return { i, kind, cells, period, section: -1, hay: '' };
    }
    const hay = kind === 'data' ? haystack(cells, colKinds) + (period >= 0 ? `\u0001${periods[period].key} ${periods[period].label}`.toLowerCase() : '') : '';
    return { i, kind, cells, period, section, hay };
  });
  const data = rows.filter((r) => r.kind === 'data');
  const totals = rows.filter((r) => r.kind === 'total' || r.kind === 'subtotal');
  const merged = periods.length > 0;

  // The columns a TOTAL adds up are the ones the report's own TOTAL rows add
  // up; a report without one sums its amounts and counts (never a serial number).
  const summable = totals.length
    ? headers.map((_, c) => c).filter((c) => totals.some((t) => typeof t.cells[c] === 'number'))
    : specs.filter((s) => s.kind === 'amount' || (s.kind === 'int' && !SERIAL_HEADER_RE.test(s.header.trim()))).map((s) => s.index);
  const labelFromTotals = totals.length ? totals[0].cells.findIndex((c) => TOTAL_TEXT_RE.test(str(c))) : -1;
  const labelCol = labelFromTotals >= 0 ? labelFromTotals
    : Math.max(0, specs.findIndex((s) => s.kind === 'text' && !summable.includes(s.index)));

  // A single-period report's last TOTAL, when no document follows it, is its
  // grand total. A merged table has one TOTAL per period instead, kept in place.
  let grandTotal: ModelRow | null = null;
  if (!merged) {
    const last = [...totals].reverse().find((t) => t.kind === 'total');
    if (last && !data.some((d) => d.i > last.i)) grandTotal = last;
  }

  const model: TableModel = {
    headers,
    // Provisional (facetKey needs only the kinds); completed below.
    columns: specs.map((s) => ({
      index: s.index, header: s.header, label: s.label, name: shared.has(s.label) ? s.header : s.label, kind: s.kind,
      filter: 'contains', distinct: 0, groupable: false, summable: false, virtual: false,
    })),
    rows, data, merged, periods,
    periodCol: merged ? headers.length : -1,
    grandTotal, hasReportTotals: totals.length > 0, summable, labelCol,
  };
  model.columns = model.columns.map((c) => {
    // Counted only up to the grouping limit: past it the exact number does not matter.
    const keys = new Set<string>();
    for (const r of data) {
      keys.add(facetKey(model, r, c.index));
      if (keys.size > GROUP_LIMIT) break;
    }
    const distinct = keys.size;
    const kind = c.kind;
    const filter: FilterKind = kind === 'amount' || kind === 'int' ? 'number'
      : kind === 'date' ? 'date'
        : kind === 'url' || kind === 'rate' || distinct <= FACET_LIMIT ? 'values'
          : 'contains';
    return {
      ...c,
      filter,
      distinct,
      groupable: (kind === 'text' || kind === 'rate') && distinct >= 1 && distinct <= GROUP_LIMIT,
      summable: summable.includes(c.index),
    };
  });
  if (merged) {
    model.columns.push({
      index: model.periodCol, header: 'Period', label: 'Period', name: 'Period', kind: 'period', filter: 'values',
      distinct: periods.length, groupable: true, summable: false, virtual: true,
    });
  }
  return model;
}

/**
 * The model with the columns a TOTAL adds up narrowed to `cols` ([] for none).
 * For a statement whose rows are unlike measures (the taxable value above the
 * tax heads, the liability above the payment), where a sum of the rows shown
 * would add unlike things: with none, no TOTAL is recomputed under a filter and
 * groups carry no subtotal. Only figure columns can be summed.
 */
export function withSummable(model: TableModel, cols: number[]): TableModel {
  const keep = new Set(cols.filter((c) => isFigureColumn(model, c)));
  return {
    ...model,
    summable: model.headers.map((_, c) => c).filter((c) => keep.has(c)),
    columns: model.columns.map((c) => ({ ...c, summable: keep.has(c.index) })),
  };
}

// ── Filters ────────────────────────────────────────────────────────────────

export function isFilterActive(f: ColumnFilter | undefined): boolean {
  if (!f) return false;
  switch (f.type) {
    case 'values': return f.values.length > 0;
    case 'contains': return f.text.trim() !== '';
    case 'number': return f.min !== null || f.max !== null || !!f.nonZero;
    case 'date': return !!f.from || !!f.to;
  }
}

/** Anything narrowing the rows (a column filter, the search, a view's own filter); sorting and grouping do not. */
export const isFiltered = (state: ViewState): boolean =>
  state.search.trim() !== '' || Object.values(state.filters).some((f) => isFilterActive(f)) || !!state.custom?.length;

const timeOf = (iso: string | null): number | null => (iso ? parseDateCell(iso)?.getTime() ?? null : null);

type Pred = (r: ModelRow) => boolean;

function predicateFor(model: TableModel, col: number, f: ColumnFilter): Pred {
  switch (f.type) {
    case 'values': {
      const set = new Set(f.values);
      return (r) => set.has(facetKey(model, r, col));
    }
    case 'contains': {
      const q = f.text.trim().toLowerCase();
      return (r) => {
        const raw = str(r.cells[col]).toLowerCase();
        return raw.includes(q) || displayText(model, r, col).toLowerCase().includes(q);
      };
    }
    case 'number': {
      const { min, max, nonZero, tolerance } = f;
      return (r) => {
        const v = r.cells[col];
        if (typeof v !== 'number' || !Number.isFinite(v)) return false;
        if (nonZero && (tolerance ? Math.abs(v) <= tolerance : Math.abs(v) < 0.005)) return false;
        if (min !== null && v < min - 1e-9) return false;
        if (max !== null && v > max + 1e-9) return false;
        return true;
      };
    }
    case 'date': {
      const from = timeOf(f.from);
      const to = timeOf(f.to);
      return (r) => {
        const d = parseDateCell(r.cells[col]);
        if (!d) return false;
        const t = d.getTime();
        return (from === null || t >= from) && (to === null || t <= to);
      };
    }
  }
}

/** Every active filter and the search as one test, leaving out column `except`'s own filter. */
export function compile(model: TableModel, state: ViewState, except = -1): Pred {
  const preds: Pred[] = [];
  const terms = state.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length) preds.push((r) => terms.every((t) => r.hay.includes(t)));
  for (const [k, f] of Object.entries(state.filters)) {
    const col = Number(k);
    if (col === except || !isFilterActive(f)) continue;
    preds.push(predicateFor(model, col, f as ColumnFilter));
  }
  for (const c of state.custom ?? []) preds.push(c.test);
  return preds.length ? (r) => preds.every((p) => p(r)) : () => true;
}

/** The document rows passing every filter, in the report's order. */
export const applyFilters = (model: TableModel, state: ViewState): ModelRow[] => {
  const pass = compile(model, state);
  return model.data.filter(pass);
};

export interface FacetValue { key: string; label: string; count: number }

const collator = new Intl.Collator('en-IN', { numeric: true, sensitivity: 'base' });

// A rate written as text ("0.1%", "18%"): by its value. The collator alone
// puts "0.1%" before "0%" and "1.5%" before "1%" ('.' sorts before '%').
const PERCENT_RE = /^-?\d+(\.\d+)?\s*%$/;
const percentOf = (s: string): number | null => (PERCENT_RE.test(s.trim()) ? parseFloat(s) : null);

// A date with its time as en-IN prints it ("15/8/2026, 10:23:45 am"): an
// upload log's Date/Time. It stays a text column (the time is part of what it
// says, and the export prints it as written), but it sorts and lists by its
// moment: by the text alone 2 Sep would come before 15 Aug.
const STAMP_RE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i;
export const stampOf = (s: string): number | null => {
  const m = STAMP_RE.exec(s.trim());
  if (!m) return null;
  const [, d, mo, y, h, mi, sec, ap] = m;
  const hour = ap ? (+h % 12) + (/p/i.test(ap) ? 12 : 0) : +h;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || hour > 23 || +mi > 59) return null;
  return Date.UTC(+y, +mo - 1, +d, hour, +mi, +(sec ?? 0));
};

// A month written as text ("Apr 2026", "April 2026", "Apr-26", "04/2026"): by
// the month. The collator alone puts Aug before Jun and Jan 2027 before Apr 2026.
const MONTH_TEXT_RE = /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s-]+(\d{4}|\d{2})$/i;
const monthOf = (s: string): number | null => {
  const t = s.trim();
  const m = MONTH_TEXT_RE.exec(t);
  if (m) return (+m[2] < 100 ? 2000 + +m[2] : +m[2]) * 12 + MONTHS.findIndex((x) => x.toLowerCase() === m[1].slice(0, 3).toLowerCase());
  const n = /^(\d{2})\/(\d{4})$/.exec(t);
  return n && +n[1] >= 1 && +n[1] <= 12 ? +n[2] * 12 + +n[1] - 1 : null;
};

const keyOrder = (model: TableModel, col: number) => (a: string, b: string): number => {
  if (col === model.periodCol) return model.periods.findIndex((p) => p.key === a) - model.periods.findIndex((p) => p.key === b);
  if (a === BLANK && b !== BLANK) return 1;
  if (b === BLANK && a !== BLANK) return -1;
  const pa = percentOf(a);
  const pb = percentOf(b);
  if (pa !== null && pb !== null) return pa - pb || collator.compare(a, b);
  const sa = stampOf(a);
  const sb = stampOf(b);
  if (sa !== null && sb !== null) return sa - sb || collator.compare(a, b);
  const ma = monthOf(a);
  const mb = monthOf(b);
  if (ma !== null && mb !== null) return ma - mb || collator.compare(a, b);
  return collator.compare(a, b);
};

/**
 * A column's values with how many rows each would show: counted over the rows
 * passing every other filter (and the search), never this column's own, so the
 * list does not collapse to the values already ticked.
 */
export function facetValues(model: TableModel, state: ViewState, col: number): FacetValue[] {
  const pass = compile(model, state, col);
  const counts = new Map<string, number>();
  for (const r of model.data) {
    const k = facetKey(model, r, col);
    const n = counts.get(k) ?? 0;
    counts.set(k, pass(r) ? n + 1 : n);
  }
  return [...counts.keys()].sort(keyOrder(model, col)).map((key) => ({ key, label: facetLabel(model, col, key), count: counts.get(key) ?? 0 }));
}

/** The earliest and latest date in a date column (for the filter's hint). */
export function dateRange(model: TableModel, col: number): { min: string; max: string } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of model.data) {
    const d = parseDateCell(r.cells[col]);
    if (!d) continue;
    lo = Math.min(lo, d.getTime());
    hi = Math.max(hi, d.getTime());
  }
  if (!Number.isFinite(lo)) return null;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { min: iso(lo), max: iso(hi) };
}

// ── Sorting ────────────────────────────────────────────────────────────────

type SortKey = number | string | null;

function sortKey(model: TableModel, r: ModelRow, col: number): SortKey {
  if (col === model.periodCol) return r.period;
  const v = r.cells[col];
  const kind = model.columns[col]?.kind;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = str(v);
  if (isNil(s)) return null;
  if (kind === 'date') return parseDateCell(s)?.getTime() ?? null;
  // A word in a figures column ("NOT PULLED") sorts with the blanks.
  if (kind === 'amount' || kind === 'int' || kind === 'rate') return null;
  return percentOf(s) ?? stampOf(s) ?? monthOf(s) ?? s;
}

const cmpKeys = (a: SortKey, b: SortKey): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return collator.compare(String(a), String(b));
};

/**
 * The rows ordered by one column: figures by value, dates by date, text in
 * natural order (5% before 12%); blanks last either way; ties keep the
 * report's order, so sorting is stable.
 */
export function sortRows(model: TableModel, rows: ModelRow[], sort: SortState | null): ModelRow[] {
  if (!sort) return rows;
  const dir = sort.dir === 'asc' ? 1 : -1;
  const present: { r: ModelRow; k: SortKey }[] = [];
  const missing: ModelRow[] = [];
  for (const r of rows) {
    const k = sortKey(model, r, sort.col);
    if (k === null) missing.push(r);
    else present.push({ r, k });
  }
  present.sort((a, b) => cmpKeys(a.k, b.k) * dir || a.r.i - b.r.i);
  return [...present.map((x) => x.r), ...missing];
}

// ── Totals and groups ──────────────────────────────────────────────────────

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The summable columns added up over `rows`. */
export function sumRows(model: TableModel, rows: ModelRow[]): Map<number, number> {
  const sums = new Map<number, number>();
  for (const c of model.summable) {
    let t = 0;
    for (const r of rows) {
      const v = r.cells[c];
      if (typeof v === 'number' && Number.isFinite(v)) t += v;
    }
    sums.set(c, round2(t));
  }
  return sums;
}

export interface RowGroup { key: string; label: string; rows: ModelRow[]; sums: Map<number, number> }

/**
 * Rows under one heading per value of `groupBy`, each with its subtotals.
 * Groups run in the column's natural order; sorted by a figure, they run by
 * their subtotal of it (largest supplier first), except months, which stay in
 * calendar order (a working paper reads its months in time; the rows inside
 * each month follow the sort); sorted by the grouped column itself, in that
 * direction.
 */
export function groupRows(model: TableModel, rows: ModelRow[], groupBy: number, sort: SortState | null): RowGroup[] {
  const map = new Map<string, ModelRow[]>();
  for (const r of rows) {
    const k = facetKey(model, r, groupBy);
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  const order = keyOrder(model, groupBy);
  const groups = [...map].map(([key, list]) => ({ key, label: facetLabel(model, groupBy, key), rows: list, sums: sumRows(model, list) }));
  const dir = sort?.dir === 'desc' ? -1 : 1;
  if (sort && model.summable.includes(sort.col) && groupBy !== model.periodCol) {
    groups.sort((a, b) => ((a.sums.get(sort.col) ?? 0) - (b.sums.get(sort.col) ?? 0)) * dir || order(a.key, b.key));
  } else if (sort && sort.col === groupBy) {
    groups.sort((a, b) => {
      if (a.key === BLANK || b.key === BLANK) return order(a.key, b.key);
      return order(a.key, b.key) * dir;
    });
  } else {
    groups.sort((a, b) => order(a.key, b.key));
  }
  return groups;
}

// ── What is shown ──────────────────────────────────────────────────────────

export type DisplayItem =
  | { type: 'band'; key: string; label: string; count: number; continued?: boolean }
  | { type: 'section'; row: ModelRow; label: string; count: number; continued?: boolean }
  | { type: 'group'; key: string; label: string; count: number; sums: Map<number, number>; collapsed: boolean; continued?: boolean }
  | { type: 'data'; row: ModelRow }
  /** The report's own TOTAL (a period's, or a subtotal) in its place. */
  | { type: 'total'; row: ModelRow }
  /** A TOTAL recomputed over the rows shown (a period's, under a filter). */
  | { type: 'sum'; label: string; sums: Map<number, number> }
  | { type: 'blank'; row: ModelRow };

export type Footer =
  | { type: 'total'; row: ModelRow }
  | { type: 'sum'; label: string; sums: Map<number, number> }
  | null;

export interface ViewResult {
  filtered: boolean;
  /** The document rows shown, in the order shown. */
  rows: ModelRow[];
  items: DisplayItem[];
  footer: Footer;
  groups: RowGroup[] | null;
  /** Period bands are drawn only in the report's own order (no sort, no grouping). */
  showBands: boolean;
  /** A merged table shown without its bands names each row's period in a column instead. */
  showPeriodColumn: boolean;
  /** Sorted, but each row kept under its section heading and period band (model.sortWithinSections). */
  sortedWithinSections?: boolean;
}

const firstText = (cells: Row): string => cells.map(str).find((s) => s !== '') ?? '';

export function buildView(model: TableModel, state: ViewState, collapsed: ReadonlySet<string> = new Set()): ViewResult {
  const filtered = isFiltered(state);
  const passing = applyFilters(model, state);
  const groupBy = state.groupBy !== null && model.columns[state.groupBy]?.groupable ? state.groupBy : null;
  const ordered = sortRows(model, passing, state.sort);
  // Sorted inside each section (and period) when the report reads top to bottom.
  const within = !!state.sort && groupBy === null && !!model.sortWithinSections
    && (model.merged || model.rows.some((r) => r.kind === 'section'));
  const showBands = model.merged && (!state.sort || within) && groupBy === null;
  const showPeriodColumn = model.merged && !showBands && groupBy !== model.periodCol;
  const items: DisplayItem[] = [];
  let groups: RowGroup[] | null = null;

  if (groupBy !== null) {
    groups = groupRows(model, ordered, groupBy, state.sort);
    for (const g of groups) {
      const isCollapsed = collapsed.has(g.key);
      items.push({ type: 'group', key: g.key, label: g.label, count: g.rows.length, sums: g.sums, collapsed: isCollapsed });
      if (!isCollapsed) for (const r of g.rows) items.push({ type: 'data', row: r });
    }
  } else if (state.sort && !within) {
    for (const r of ordered) items.push({ type: 'data', row: r });
  } else {
    // The report's own order: structure rows in place, documents filtered
    // (and, sorted within sections, each section's rows in the sorted order).
    const shown = new Set(passing.map((r) => r.i));
    const perPeriod = new Map<number, ModelRow[]>();
    const perSection = new Map<number, number>();
    for (const r of passing) {
      if (!perPeriod.has(r.period)) perPeriod.set(r.period, []);
      perPeriod.get(r.period)!.push(r);
      perSection.set(r.section, (perSection.get(r.section) ?? 0) + 1);
    }
    const blockOf = (r: ModelRow) => `${r.period}:${r.section}`;
    const blocks = new Map<string, ModelRow[]>();
    if (within) {
      for (const r of ordered) {
        const list = blocks.get(blockOf(r));
        if (list) list.push(r);
        else blocks.set(blockOf(r), [r]);
      }
    }
    for (const r of model.rows) {
      switch (r.kind) {
        case 'period': {
          const n = perPeriod.get(r.period)?.length ?? 0;
          if (!filtered || n) items.push({ type: 'band', key: model.periods[r.period].key, label: model.periods[r.period].label, count: n });
          break;
        }
        case 'section': {
          const n = perSection.get(r.i) ?? 0;
          if (!filtered || n) items.push({ type: 'section', row: r, label: firstText(r.cells), count: n });
          break;
        }
        case 'blank':
          if (!filtered) items.push({ type: 'blank', row: r });
          break;
        case 'data': {
          if (!shown.has(r.i)) break;
          if (!within) { items.push({ type: 'data', row: r }); break; }
          // A section's sorted rows go where its first row stood.
          const block = blocks.get(blockOf(r));
          if (block) for (const x of block) items.push({ type: 'data', row: x });
          blocks.delete(blockOf(r));
          break;
        }
        case 'total':
        case 'subtotal': {
          if (r === model.grandTotal) break;
          if (!filtered) { items.push({ type: 'total', row: r }); break; }
          if (model.keepReportTotals) {
            // As printed, unless the filter left its period nothing to stand under.
            if (r.period < 0 || perPeriod.get(r.period)?.length) items.push({ type: 'total', row: r });
            break;
          }
          // Under a filter a period's TOTAL is recomputed over its rows still
          // shown; a report's own subtotal no longer describes them and goes.
          const inPeriod = r.kind === 'total' && r.period >= 0 ? perPeriod.get(r.period) : undefined;
          if (inPeriod?.length && model.summable.length) {
            items.push({ type: 'sum', label: `TOTAL (${model.periods[r.period].key}, filtered)`, sums: sumRows(model, inPeriod) });
          }
          break;
        }
      }
    }
  }

  let footer: Footer = null;
  if (filtered && !model.keepReportTotals) {
    if (model.summable.length) footer = { type: 'sum', label: 'TOTAL (filtered)', sums: sumRows(model, passing) };
  } else if (model.grandTotal) {
    footer = { type: 'total', row: model.grandTotal };
  } else if (model.merged && model.hasReportTotals && model.summable.length) {
    footer = { type: 'sum', label: `TOTAL (${model.periods.length} periods)`, sums: sumRows(model, model.data) };
  }
  const rows = groups ? groups.flatMap((g) => g.rows)
    : within ? items.flatMap((it) => (it.type === 'data' ? [it.row] : []))
      : ordered;
  return { filtered, rows, items, footer, groups, showBands, showPeriodColumn, ...(within ? { sortedWithinSections: true } : {}) };
}

// ── Pages ──────────────────────────────────────────────────────────────────

/** Lists longer than this are shown a page at a time. */
export const PAGE_THRESHOLD = 500;

export interface Page { items: DisplayItem[]; page: number; pages: number; from: number; to: number }

const isHeading = (it: DisplayItem): boolean => it.type === 'band' || it.type === 'section' || it.type === 'group';

/**
 * One page of the list. A page that opens in the middle of a period, section
 * or group repeats that heading (marked continued), so no row is shown without
 * the heading it sits under.
 */
export function paginate(items: DisplayItem[], page: number, size: number): Page {
  const pages = Math.max(1, Math.ceil(items.length / Math.max(1, size)));
  const p = Math.min(Math.max(0, page), pages - 1);
  const from = p * size;
  const slice = items.slice(from, from + size);
  if (from > 0 && slice.length && !isHeading(slice[0])) {
    let band: DisplayItem | null = null;
    let inner: DisplayItem | null = null;
    for (let k = from - 1; k >= 0; k--) {
      const it = items[k];
      if (!inner && (it.type === 'section' || it.type === 'group')) inner = it;
      if (it.type === 'band') { band = it; break; }
      if (it.type === 'group') break;
    }
    const lead: DisplayItem[] = [];
    if (band) lead.push({ ...band, continued: true } as DisplayItem);
    if (inner) lead.push({ ...inner, continued: true } as DisplayItem);
    return { items: [...lead, ...slice], page: p, pages, from, to: from + slice.length };
  }
  return { items: slice, page: p, pages, from, to: from + slice.length };
}

// ── Words ──────────────────────────────────────────────────────────────────

// Plain ASCII and the house figures only: these phrases are printed on the
// PDF, whose standard font has no ≥ or ≤.
const fig = (n: number, kind: ModelColumn['kind']): string => (Math.abs(n) < 0.005 ? '0' : fmtNumber(n, numberKind(kind)));

const listValues = (labels: string[]): string => {
  if (labels.length === 1) return labels[0];
  if (labels.length <= 4) return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
  return `one of ${labels.length} values (${labels.slice(0, 3).join(', ')} and ${labels.length - 3} more)`;
};

/** One phrase for a column's filter, e.g. "Taxable Value between 1,000.00 and 5,000.00". */
export function describeFilter(model: TableModel, col: number, f: ColumnFilter): string {
  const c = model.columns[col];
  const name = c?.name ?? `Column ${col + 1}`;
  switch (f.type) {
    case 'values': return `${name} is ${listValues(f.values.map((v) => facetLabel(model, col, v)))}`;
    case 'contains': return `${name} contains "${f.text.trim()}"`;
    case 'number': {
      const parts: string[] = [];
      if (f.min !== null && f.max !== null) parts.push(`between ${fig(f.min, c?.kind)} and ${fig(f.max, c?.kind)}`);
      else if (f.min !== null) parts.push(`at least ${fig(f.min, c?.kind)}`);
      else if (f.max !== null) parts.push(`at most ${fig(f.max, c?.kind)}`);
      if (f.nonZero) parts.push(f.tolerance ? `not nil (more than ${fig(f.tolerance, 'amount')} either way)` : 'not nil');
      return `${name} ${parts.join(', ')}`;
    }
    case 'date': {
      if (f.from && f.to) return `${name} from ${fmtDate(f.from)} to ${fmtDate(f.to)}`;
      if (f.from) return `${name} on or after ${fmtDate(f.from)}`;
      return `${name} on or before ${fmtDate(f.to)}`;
    }
  }
}

/** A column's filter (col), the search, or a view's own filter (col 'custom', its id). */
export interface ActiveFilter { col: number | 'search' | 'custom'; id?: string; text: string }

/** Every active filter (the search first, a view's own last), each as a phrase: the chips and the export's strip. */
export function activeFilters(model: TableModel, state: ViewState): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  if (state.search.trim()) out.push({ col: 'search', text: `Search "${state.search.trim()}"` });
  for (const [k, f] of Object.entries(state.filters)) {
    if (!f || !isFilterActive(f)) continue;
    out.push({ col: Number(k), text: describeFilter(model, Number(k), f) });
  }
  for (const c of state.custom ?? []) out.push({ col: 'custom', id: c.id, text: c.label });
  return out;
}

/** Whether a text column holds only date-time stamps (an upload log's Date/Time), blanks aside. */
const isStampColumn = (model: TableModel, col: number): boolean => {
  let seen = false;
  for (const r of model.data) {
    const s = str(r.cells[col]);
    if (isNil(s)) continue;
    if (stampOf(s) === null) return false;
    seen = true;
  }
  return seen;
};

export function describeSort(model: TableModel, sort: SortState): string {
  const c = model.columns[sort.col];
  const asc = sort.dir === 'asc';
  const when = c?.kind === 'date' || (c?.kind === 'text' && isStampColumn(model, sort.col));
  const how = when ? (asc ? 'oldest first' : 'newest first')
    : c?.kind === 'amount' || c?.kind === 'int' || c?.kind === 'rate' ? (asc ? 'smallest first' : 'largest first')
      : c?.kind === 'period' ? (asc ? 'earliest first' : 'latest first')
        : asc ? 'A to Z' : 'Z to A';
  return `sorted by ${c?.name ?? 'a column'}, ${how}`;
}

// ── Export what is shown ───────────────────────────────────────────────────

/** The columns shown, in order: the Period column first when it is shown, then the report's own. */
export function visibleColumns(model: TableModel, view: Pick<ViewResult, 'showPeriodColumn'>, hidden: ReadonlySet<number>): number[] {
  const own = model.headers.map((_, c) => c).filter((c) => !hidden.has(c));
  const cols = view.showPeriodColumn && !hidden.has(model.periodCol) ? [model.periodCol, ...own] : own;
  return cols.length ? cols : model.headers.map((_, c) => c);
}

/**
 * Where a recomputed TOTAL's label is printed among the columns shown: the
 * report's own place when that is a text column, else the text column before
 * it. The portal lists put TOTAL under Invoice Date; a longer label there
 * ("TOTAL (05/2025, filtered)") would widen a date column that never wraps.
 * With no text column shown, any shown column that holds no sum (a date, the
 * period); with none of those either, -1: the row keeps its figures unlabelled
 * rather than a label printed over a total.
 */
export function labelPosition(model: TableModel, cols: number[]): number {
  const isText = (c: number) => c !== model.periodCol && !model.summable.includes(c) && model.columns[c]?.kind === 'text';
  const own = cols.indexOf(model.labelCol);
  if (own >= 0 && isText(model.labelCol)) return own;
  const upTo = own >= 0 ? own : cols.filter((c) => c !== model.periodCol && c < model.labelCol).length + (cols[0] === model.periodCol ? 1 : 0);
  for (let k = upTo - 1; k >= 0; k--) if (isText(cols[k])) return k;
  const first = cols.findIndex(isText);
  if (first >= 0) return first;
  if (own >= 0 && !model.summable.includes(model.labelCol)) return own;
  return cols.findIndex((c) => !model.summable.includes(c));
}

/**
 * The report's column groups (the band above the header) over the columns
 * shown, in order: a hidden column leaves its group's span, a group with no
 * column shown goes, and the Period column sits under a blank group. The
 * screen's two-level header and the "filtered" export both read it. Null when
 * the report has none, or when they do not span its headers.
 */
export function respanColumnGroups(table: Pick<ReportTable, 'columnGroups'>, model: TableModel, cols: number[]): ColumnGroup[] | null {
  if (!table.columnGroups?.length || table.columnGroups.reduce((s, x) => s + x.span, 0) !== model.headers.length) return null;
  const owner: number[] = [];
  table.columnGroups.forEach((x, gi) => { for (let k = 0; k < x.span; k++) owner.push(gi); });
  const out: (ColumnGroup & { gi: number })[] = [];
  for (const c of cols) {
    const gi = c === model.periodCol ? -1 : owner[c];
    const last = out[out.length - 1];
    if (last && last.gi === gi) last.span += 1;
    else out.push(gi < 0 ? { label: '', span: 1, gi } : { ...table.columnGroups[gi], span: 1, gi });
  }
  return out.map(({ label, span, tone }) => ({ label, span, ...(tone ? { tone } : {}) }));
}

const clean = (s: string): string => s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

/**
 * The view as a ReportTable for the Big4 Excel / PDF: the columns shown, the
 * rows passing the filters in the order shown (bands and the report's TOTAL
 * rows as on screen, a group as a heading, its rows and a subtotal; a
 * collapsed group still exports its rows), a TOTAL recomputed when filtered,
 * and what was filtered, sorted, grouped and hidden in the identification
 * strip. A summary or extra sheet of the full report is left out: it would
 * not describe these rows.
 */
export function viewToReportTable(table: ReportTable, model: TableModel, state: ViewState, hidden: ReadonlySet<number>): ReportTable {
  const view = buildView(model, state);
  const cols = visibleColumns(model, view, hidden);
  const posOf = new Map(cols.map((c, k) => [c, k]));
  const at = labelPosition(model, cols);

  const rows: (string | number)[][] = [];
  const kinds: RowKind[] = [];
  const tones: (RowTone | null)[] = [];
  const push = (cells: (string | number)[], kind: RowKind, tone: RowTone | null = null) => { rows.push(cells); kinds.push(kind); tones.push(tone); };
  const blankRow = () => cols.map(() => '' as string | number);
  const labelled = (label: string) => { const out = blankRow(); out[0] = label; return out; };
  const project = (r: ModelRow) => cols.map((c) => (c === model.periodCol ? (r.period >= 0 ? model.periods[r.period].label : '') : r.cells[c] ?? ''));
  const sumRow = (label: string, sums: Map<number, number>, where = at) => {
    const out = blankRow();
    cols.forEach((c, k) => { if (sums.has(c)) out[k] = sums.get(c) as number; });
    if (where >= 0 && typeof out[where] !== 'number') out[where] = label;
    return out;
  };
  const ownTotal = (r: ModelRow) => {
    const out = project(r);
    // The TOTAL label may sit in a hidden column: carry it to a shown one.
    if (!out.some((v) => TOTAL_TEXT_RE.test(str(v)))) {
      const free = out.findIndex((v, k) => str(v) === '' && !model.summable.includes(cols[k]));
      const to = free >= 0 ? free : at;
      if (to >= 0 && typeof out[to] !== 'number') out[to] = firstText(r.cells) || 'TOTAL';
    }
    return out;
  };
  const toneOf = (r: ModelRow) => table.rowTones?.[r.i] ?? null;

  if (view.groups) {
    const g = model.columns[state.groupBy as number];
    // A subtotal names its group under the grouped column when that is shown.
    const own = cols.indexOf(state.groupBy as number);
    const where = own >= 0 && g?.kind === 'text' && !model.summable.includes(g.index) ? own : at;
    for (const grp of view.groups) {
      push(labelled(`${g?.name ?? 'Group'}: ${grp.label} (${grp.rows.length} ${grp.rows.length === 1 ? 'row' : 'rows'})`), 'section');
      for (const r of grp.rows) push(project(r), 'data', toneOf(r));
      if (model.summable.length) push(sumRow(`Subtotal: ${grp.label}`, grp.sums, where), 'subtotal');
    }
  } else {
    for (const it of view.items) {
      switch (it.type) {
        case 'band': push(labelled(`— ${it.key} —`), 'period'); break;
        case 'section': push(labelled(it.label), 'section'); break;
        case 'blank': push(blankRow(), 'blank'); break;
        case 'data': push(project(it.row), 'data', toneOf(it.row)); break;
        case 'total': push(ownTotal(it.row), it.row.kind === 'subtotal' ? 'subtotal' : 'total'); break;
        case 'sum': push(sumRow(it.label, it.sums), 'total'); break;
        case 'group': break;
      }
    }
  }
  if (view.footer?.type === 'total') push(ownTotal(view.footer.row), 'total');
  else if (view.footer?.type === 'sum') push(sumRow(view.footer.label, view.footer.sums), 'total');

  // What the reader needs to know this is a view, not the whole report.
  const filters = activeFilters(model, state).map((a) => clean(a.text));
  const how: string[] = [];
  if (state.sort) how.push(`${describeSort(model, state.sort)}${view.sortedWithinSections ? ' within each section' : ''}`);
  if (view.groups && state.groupBy !== null) how.push(`grouped by ${model.columns[state.groupBy]?.name ?? 'a column'}`);
  const hiddenNames = model.headers.map((h, c) => (hidden.has(c) ? model.columns[c]?.name ?? h : null)).filter((h): h is string => !!h);
  const fields = [
    ...(filters.length ? [{ label: 'Filter', value: filters.join('; ') }] : []),
    ...(how.length ? [{ label: 'View', value: how.join('; ') }] : []),
    { label: 'Rows shown', value: `${view.rows.length.toLocaleString('en-IN')} of ${model.data.length.toLocaleString('en-IN')}` },
    ...(hiddenNames.length ? [{ label: 'Columns hidden', value: clean(hiddenNames.join(', ')) }] : []),
    // A TOTAL kept as printed under a filter describes every row: say so.
    ...(view.filtered && model.keepReportTotals && kinds.includes('total')
      ? [{ label: 'Totals', value: 'as printed for the whole report, not recomputed for the rows shown' }]
      : []),
  ];

  const widthOf = (c: number) => (c === model.periodCol ? 10 : table.columnWidths?.[c] ?? 14);
  const headers = cols.map((c) => (c === model.periodCol ? 'Period' : model.headers[c]));
  const headerLabels = table.headerLabels?.length === model.headers.length
    ? cols.map((c) => (c === model.periodCol ? 'Period' : table.headerLabels![c] || model.headers[c]))
    : undefined;
  const columnGroups = respanColumnGroups(table, model, cols) ?? undefined;
  const pdfColumns = table.pdfColumns?.length
    ? cols.map((c, k) => (c === model.periodCol || table.pdfColumns!.includes(c) ? k : -1)).filter((k) => k >= 0)
    : undefined;
  const toneColumn = table.toneColumn !== undefined ? posOf.get(table.toneColumn) : undefined;
  const freezeColumns = table.freezeColumns !== undefined
    ? cols.filter((c) => c === model.periodCol || c < (table.freezeColumns as number)).length
    : undefined;
  // The stat band: the figures of the TOTAL printed under the rows.
  const bandSums = view.footer?.type === 'sum' ? view.footer.sums : sumRows(model, view.rows);
  const kpis = [
    { label: 'Rows shown', value: `${view.rows.length.toLocaleString('en-IN')} of ${model.data.length.toLocaleString('en-IN')}` },
    ...cols.filter((c) => model.summable.includes(c)).slice(0, 7).map((c) => {
      const own = view.footer?.type === 'total' ? view.footer.row.cells[c] : undefined;
      const value = typeof own === 'number' ? own : bandSums.get(c) ?? 0;
      return { label: model.columns[c]?.name ?? model.headers[c], value: fmtNumber(value, numberKind(model.columns[c]?.kind)) };
    }),
  ];

  return {
    title: table.title,
    subtitle: [table.subtitle, ...fields.map((f) => `${f.label}: ${f.value}`)].filter(Boolean).join('   |   '),
    ...(table.meta?.length ? { meta: [...table.meta, ...fields] } : {}),
    kpis,
    headers,
    ...(headerLabels ? { headerLabels } : {}),
    ...(columnGroups ? { columnGroups } : {}),
    rows,
    rowKinds: kinds,
    ...(tones.some((t) => t) ? { rowTones: tones } : {}),
    ...(toneColumn !== undefined ? { toneColumn } : {}),
    ...(freezeColumns !== undefined ? { freezeColumns } : {}),
    ...(table.sheetName ? { sheetName: table.sheetName } : {}),
    ...(pdfColumns && pdfColumns.length ? { pdfColumns } : {}),
    fileNameBase: `${table.fileNameBase}_filtered`,
    columnWidths: cols.map(widthOf),
  };
}
