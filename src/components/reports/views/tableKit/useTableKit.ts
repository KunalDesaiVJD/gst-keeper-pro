// The state half of the table kit: what a reviewer has chosen in a report view
// (search, column filters, the view's own quick filters, sort, grouping,
// hidden columns, collapsed groups, the page) and what follows from it (the
// rows to draw, the columns shown, the chips, the totals), plus the "filtered"
// Excel / PDF of exactly what is shown. The rules live in ./tableModel.ts
// (pure, tested by scripts/verify-doc-table-model.mjs); this hook only holds
// the choices, so every view filters, totals and exports the same way.
import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ColumnGroup, ReportTable } from '@/utils/allClientsReports';
import { renderReportToExcel } from '@/utils/allClientsReports';
import { renderReportToPdf } from '@/utils/closingBalanceReportsPdf';
import {
  EMPTY_VIEW, PAGE_THRESHOLD, activeFilters, buildModel, buildView, displayText, figureText, isFigureColumn, isFilterActive,
  labelPosition, paginate, respanColumnGroups, sumRows, viewToReportTable, visibleColumns,
  type ActiveFilter, type ColumnFilter, type ModelColumn, type ModelRow, type Page, type SortState, type TableModel,
  type ViewResult, type ViewState,
} from './tableModel';

export type ExportFormat = 'xlsx' | 'pdf';

/**
 * A view's own quick filter as the hook takes it. `test` is handed the table
 * of the moment, so a filter set before a Pull refresh reads the new rowFlags
 * or rowTones, never the old ones it was created with.
 */
export interface KitCustomFilter {
  label: string;
  test: (row: ModelRow, table: ReportTable) => boolean;
}

export interface TableKitOptions {
  /**
   * The report's key (report.key). The kit starts afresh when it or the
   * column set changes; a Pull refresh of the same report keeps what the
   * reviewer chose.
   */
  resetKey?: string;
  /** The sort when the view opens (default: the report's own order). */
  initialSort?: SortState | null;
  /** The grouping when the view opens (a column index; default none). */
  initialGroupBy?: number | null;
  /** Columns hidden when the view opens (indices into table.headers). */
  initialHidden?: number[];
  /**
   * Which columns may be grouped by: their indices, or a test on the column.
   * Default: text and rate columns with at most 200 values, and Period.
   * [] turns grouping off (the Group by control is not drawn).
   */
  groupable?: number[] | ((col: ModelColumn) => boolean);
  /**
   * Narrows which columns a TOTAL, a subtotal and the KPI totals add up: their
   * indices, or a test on the column (given the column as the report has it).
   * A version number or a day count is a figure but adding it up means
   * nothing, and a ledger leaves out its running balance. Default: the columns
   * the report's own TOTAL rows add up, else its amounts and counts. It only
   * ever narrows: a column the report does not sum is never summed.
   */
  summable?: number[] | ((col: ModelColumn) => boolean);
  /** Show a list longer than PAGE_THRESHOLD (500) lines a page at a time. Default true. */
  pageable?: boolean;
  /**
   * Page a list longer than this many lines instead (default PAGE_THRESHOLD).
   * A view drawing a live control on every row pages sooner, so a long list
   * never mounts hundreds of them at once.
   */
  pageThreshold?: number;
  /** Lines per page offered (default [100, 250, 500]). */
  pageSizes?: number[];
  /** Lines per page when the view opens (default 250). */
  initialPageSize?: number;
  /**
   * The column whose cells the standard cell draws as status badges, tinted
   * by rowTones. Default: table.toneColumn, else a header named "Status";
   * null for none.
   */
  statusColumn?: number | null;
  /** What a row is called in the count and the export message. Default ['row', 'rows']. */
  rowNoun?: [singular: string, plural: string];
  /** The last say over the "filtered" export (an added sheet, a file name). */
  transformExport?: (t: ReportTable, format: ExportFormat) => ReportTable;
}

/** A summable column's total over every row, and over the rows shown once anything is filtered (else null). */
export interface KitTotal { col: number; total: number; shown: number | null }

export interface TableKit {
  table: ReportTable;
  model: TableModel;
  /** What is chosen (search, filters, the view's own filters, sort, grouping). */
  state: ViewState;
  /** What follows: the rows shown, the items to draw, the footer TOTAL, the groups. */
  view: ViewResult;
  /** The columns shown, in order (model column indices; Period first when it is shown). */
  cols: number[];
  hidden: ReadonlySet<number>;
  collapsed: ReadonlySet<string>;
  /** Every active filter as a phrase (the chips). */
  filters: ActiveFilter[];
  /** Where a recomputed TOTAL's label goes among `cols` (-1: nowhere). */
  labelAt: number;
  /** The report's column groups over `cols`, for a two-level header; null when it has none. */
  columnGroups: ColumnGroup[] | null;
  /** The columns that may be grouped by. */
  groupable: ModelColumn[];
  /** The status column (-1: none). */
  statusCol: number;
  /** The summable columns' totals, for a view's KPI tiles. */
  totals: KitTotal[];
  /** Whether the list is shown a page at a time. */
  paged: boolean;
  /** The items of the page shown (all of them when not paged). */
  pageView: Page;
  pageSize: number;
  pageSizes: number[];
  exporting: ExportFormat | null;
  rowNoun: [string, string];
  /** "12 of 279 rows" / "279 rows". */
  countText: string;

  setSearch: (text: string) => void;
  setFilter: (col: number, filter: ColumnFilter | undefined) => void;
  /** Sets (or with null, removes) the view's own quick filter `id`. */
  setCustomFilter: (id: string, filter: KitCustomFilter | null) => void;
  /** Removes one chip's filter (a column's, the search, or a view's own). */
  removeFilter: (f: ActiveFilter) => void;
  setSort: (sort: SortState | null) => void;
  /** None, then ascending, then descending, then none again. */
  cycleSort: (col: number) => void;
  setGroup: (col: number | null) => void;
  toggleCollapsed: (key: string) => void;
  setAllCollapsed: (collapsed: boolean) => void;
  toggleHidden: (col: number) => void;
  showAllColumns: () => void;
  /** Clears the search and every filter (the view's own too); sort and grouping stay. */
  clearAll: () => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  /** The view as shown (filtered, sorted, grouped, columns hidden) to the house Excel or PDF. */
  exportView: (format: ExportFormat) => Promise<void>;

  /** Whether a column holds figures. */
  isFigure: (col: number) => boolean;
  /** A figure in its column's house style. */
  figure: (col: number, v: number) => string;
  /** A cell as text (figures and dates in the house style; the Period column's month). */
  text: (row: ModelRow, col: number) => string;
}

const STATUS_HEADER_RE = /^status$/i;
const DEFAULT_PAGE_SIZES = [100, 250, 500];
const DEFAULT_NOUN: [string, string] = ['row', 'rows'];

interface Store {
  key: string;
  view: ViewState;
  custom: (KitCustomFilter & { id: string })[];
  hidden: Set<number>;
  collapsed: Set<string>;
  page: number;
  pageSize: number;
}

export function useTableKit(table: ReportTable, options: TableKitOptions = {}): TableKit {
  // Read when the kit starts afresh and when it exports, never as a dependency:
  // views pass the options inline, a new object every render.
  const opts = useRef(options);
  opts.current = options;

  const key = `${options.resetKey ?? ''}\u0001${table.headers.join('\u0001')}`;
  const fresh = (k: string): Store => {
    const o = opts.current;
    return {
      key: k,
      view: { ...EMPTY_VIEW, filters: {}, sort: o.initialSort ?? null, groupBy: o.initialGroupBy ?? null },
      custom: [],
      hidden: new Set(o.initialHidden ?? []),
      collapsed: new Set(),
      page: 0,
      pageSize: o.initialPageSize ?? 250,
    };
  };
  const [stored, setStore] = useState<Store>(() => fresh(key));
  // A different report or column set: start afresh in this very render, so no
  // filter meant for the old columns is ever applied to the new ones.
  const store = stored.key === key ? stored : fresh(key);
  if (stored.key !== key) setStore(store);

  const base = useMemo(() => buildModel(table), [table]);
  // The groupable columns as a string, so an inline list or test does not rebuild the model.
  const g = options.groupable;
  const groupSig = g === undefined ? null : base.columns.map((c) => ((Array.isArray(g) ? g.includes(c.index) : g(c)) ? '1' : '0')).join('');
  // Likewise the summed columns, kept to the ones the report sums.
  const sm = options.summable;
  const sumSig = sm === undefined ? null : base.summable.filter((c) => (Array.isArray(sm) ? sm.includes(c) : sm(base.columns[c]))).join(',');
  const model = useMemo<TableModel>(() => {
    let m = base;
    if (groupSig !== null) m = { ...m, columns: m.columns.map((c, k) => ({ ...c, groupable: groupSig[k] === '1' })) };
    if (sumSig !== null) {
      const keep = sumSig ? sumSig.split(',').map(Number) : [];
      m = { ...m, summable: keep, columns: m.columns.map((c) => ({ ...c, summable: keep.includes(c.index) })) };
    }
    return m;
  }, [base, groupSig, sumSig]);

  const state = useMemo<ViewState>(
    () => (store.custom.length
      ? { ...store.view, custom: store.custom.map((c) => ({ id: c.id, label: c.label, test: (r: ModelRow) => c.test(r, table) })) }
      : store.view),
    [store.view, store.custom, table],
  );
  const view = useMemo(() => buildView(model, state, store.collapsed), [model, state, store.collapsed]);
  const cols = useMemo(() => visibleColumns(model, view, store.hidden), [model, view, store.hidden]);
  const pageable = options.pageable ?? true;
  const paged = pageable && view.items.length > (options.pageThreshold ?? PAGE_THRESHOLD);
  const pageView = useMemo<Page>(
    () => (paged ? paginate(view.items, store.page, store.pageSize) : { items: view.items, page: 0, pages: 1, from: 0, to: view.items.length }),
    [paged, view.items, store.page, store.pageSize],
  );
  const filters = useMemo(() => activeFilters(model, state), [model, state]);
  const labelAt = useMemo(() => labelPosition(model, cols), [model, cols]);
  const columnGroups = useMemo(() => respanColumnGroups(table, model, cols), [table, model, cols]);
  const groupable = useMemo(() => model.columns.filter((c) => c.groupable), [model]);
  const statusCol = options.statusColumn === null ? -1
    : options.statusColumn ?? table.toneColumn ?? table.headers.findIndex((h) => STATUS_HEADER_RE.test(h.trim()));

  // The report's own grand TOTAL where it printed one (else the rows added up),
  // and once filtered, the TOTAL of the rows still shown.
  const totals = useMemo<KitTotal[]>(() => {
    const all = model.grandTotal ? null : sumRows(model, model.data);
    const totalOf = (c: number): number => {
      const own = model.grandTotal?.cells[c];
      return typeof own === 'number' ? own : all?.get(c) ?? 0;
    };
    const shown = view.footer?.type === 'sum' ? view.footer.sums : null;
    return model.summable.map((c) => ({ col: c, total: totalOf(c), shown: view.filtered ? shown?.get(c) ?? 0 : null }));
  }, [model, view]);

  const rowNoun = options.rowNoun ?? DEFAULT_NOUN;
  const nounOf = (n: number) => (n === 1 ? rowNoun[0] : rowNoun[1]);
  const all = model.data.length;
  const countText = view.filtered
    ? `${view.rows.length.toLocaleString('en-IN')} of ${all.toLocaleString('en-IN')} ${rowNoun[1]}`
    : `${all.toLocaleString('en-IN')} ${nounOf(all)}`;

  // ── Choices. Anything that changes the rows starts again at page one. ────
  const patchView = useCallback((patch: (v: ViewState) => Partial<ViewState>) => {
    setStore((s) => ({ ...s, view: { ...s.view, ...patch(s.view) }, page: 0 }));
  }, []);
  const setSearch = useCallback((search: string) => patchView(() => ({ search })), [patchView]);
  const setFilter = useCallback((col: number, f: ColumnFilter | undefined) => patchView((v) => {
    const next = { ...v.filters };
    if (f && isFilterActive(f)) next[col] = f;
    else delete next[col];
    return { filters: next };
  }), [patchView]);
  const setCustomFilter = useCallback((id: string, f: KitCustomFilter | null) => {
    setStore((s) => {
      const rest = s.custom.filter((c) => c.id !== id);
      return { ...s, custom: f ? [...rest, { id, label: f.label, test: f.test }] : rest, page: 0 };
    });
  }, []);
  const setSort = useCallback((sort: SortState | null) => patchView(() => ({ sort })), [patchView]);
  const cycleSort = useCallback((col: number) => patchView((v) => {
    const cur = v.sort?.col === col ? v.sort.dir : null;
    return { sort: cur === null ? { col, dir: 'asc' } : cur === 'asc' ? { col, dir: 'desc' } : null };
  }), [patchView]);
  const setGroup = useCallback((groupBy: number | null) => {
    setStore((s) => ({ ...s, view: { ...s.view, groupBy }, collapsed: new Set(), page: 0 }));
  }, []);
  const clearAll = useCallback(() => {
    setStore((s) => ({ ...s, view: { ...s.view, search: '', filters: {} }, custom: [], page: 0 }));
  }, []);
  const removeFilter = useCallback((f: ActiveFilter) => {
    if (f.col === 'search') setSearch('');
    else if (f.col === 'custom') setCustomFilter(f.id ?? '', null);
    else setFilter(f.col, undefined);
  }, [setSearch, setCustomFilter, setFilter]);
  const toggleCollapsed = useCallback((k: string) => setStore((s) => {
    const next = new Set(s.collapsed);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    return { ...s, collapsed: next };
  }), []);
  const groups = view.groups;
  const setAllCollapsed = useCallback((on: boolean) => {
    setStore((s) => ({ ...s, collapsed: on ? new Set((groups ?? []).map((x) => x.key)) : new Set() }));
  }, [groups]);
  const toggleHidden = useCallback((col: number) => setStore((s) => {
    const next = new Set(s.hidden);
    if (next.has(col)) next.delete(col);
    else next.add(col);
    return { ...s, hidden: next };
  }), []);
  const showAllColumns = useCallback(() => setStore((s) => ({ ...s, hidden: new Set() })), []);
  const setPage = useCallback((page: number) => setStore((s) => ({ ...s, page })), []);
  const setPageSize = useCallback((pageSize: number) => setStore((s) => ({ ...s, pageSize, page: 0 })), []);

  // ── Export what is shown ────────────────────────────────────────────────
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const shownCount = view.rows.length;
  const exportView = useCallback(async (format: ExportFormat) => {
    setExporting(format);
    // Let the spinner paint before the file is built.
    await new Promise((r) => setTimeout(r, 30));
    try {
      let t = viewToReportTable(table, model, state, store.hidden);
      const transform = opts.current.transformExport;
      if (transform) t = transform(t, format);
      if (format === 'xlsx') await renderReportToExcel(t);
      else await renderReportToPdf(t);
      const noun = opts.current.rowNoun ?? DEFAULT_NOUN;
      toast.success(`${format === 'xlsx' ? 'Excel' : 'PDF'} of the ${shownCount.toLocaleString('en-IN')} ${shownCount === 1 ? noun[0] : noun[1]} shown downloaded.`);
    } catch (err) {
      toast.error(`Could not export: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(null);
    }
  }, [table, model, state, store.hidden, shownCount]);

  const isFigure = useCallback((col: number) => isFigureColumn(model, col), [model]);
  const figure = useCallback((col: number, v: number) => figureText(model, col, v), [model]);
  const text = useCallback((row: ModelRow, col: number) => displayText(model, row, col), [model]);

  return {
    table, model, state, view, cols,
    hidden: store.hidden, collapsed: store.collapsed,
    filters, labelAt, columnGroups, groupable, statusCol, totals,
    paged, pageView, pageSize: store.pageSize, pageSizes: options.pageSizes ?? DEFAULT_PAGE_SIZES,
    exporting, rowNoun, countText,
    setSearch, setFilter, setCustomFilter, removeFilter, setSort, cycleSort, setGroup, toggleCollapsed, setAllCollapsed,
    toggleHidden, showAllColumns, clearAll, setPage, setPageSize, exportView,
    isFigure, figure, text,
  };
}
