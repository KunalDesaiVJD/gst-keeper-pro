// Archetype: DocumentLineItemsView
//
// Renders the highest-row-count report shape in the Reports Hub: the portal
// document-level GSTR-2A / 2B pulls (hundreds of invoices a month, thousands
// over a quarter), the rate-wise, supplier-wise and P.Y.-in-C.Y. reports and
// the GSTR-1 family. Generic over table.headers / table.rows: no fixed column
// indices, no new fetching.
//
// A reviewer works such a list from every angle, so every column can be
// filtered from its header (tick values, "contains", a figure range, a date
// range), sorted, and grouped with subtotals; columns can be hidden; and the
// list exports exactly as shown to the house Excel / PDF. The rules (what a
// filter matches, which rows are structure, when a TOTAL is recomputed) live in
// ./documentLineItems/tableModel.ts, tested by scripts/verify-doc-table-model.mjs.
//
// Kept from the first version: the summary strip of grand totals before
// anyone scrolls, the TOTAL pinned under the list, status badges, "View" links
// for a PDF column and the dashed "Not Pulled" sentinel.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ReportTable, RowTone } from '@/utils/allClientsReports';
import { renderReportToExcel } from '@/utils/allClientsReports';
import { renderReportToPdf } from '@/utils/closingBalanceReportsPdf';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { REPORT_STATUS_META } from '@/lib/reportRegistry';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile } from '@/components/gstr9/ui';
import { WS_BTN, WS_TABLE, WS_TH, WS_TD, WS_TR_HEADING, WS_TR_TOTAL } from '@/components/workspace/theme';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  ArrowDown, ArrowUp, ArrowUpDown, CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Columns3,
  ExternalLink, FileSpreadsheet, FileText, Inbox, Layers, Loader2, Search, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtNumber } from '@/lib/reportExport/layout';
import { ColumnFilter, ValuesPanel } from './documentLineItems/ColumnFilter';
import {
  EMPTY_VIEW, PAGE_THRESHOLD, activeFilters, buildModel, buildView, displayText, isFilterActive, labelPosition,
  paginate, sumRows, viewToReportTable, visibleColumns,
  type ColumnFilter as ColFilter, type DisplayItem, type ModelRow, type SortState, type TableModel, type ViewState,
} from './documentLineItems/tableModel';

interface DocumentLineItemsViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

// ─────────────────────────── shared cell rules ────────────────────────────

const STATUS_HEADER_RE = /^status$/i;

const isUrlCell = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v);

const isSentinelCell = (v: unknown): boolean => {
  if (typeof v !== 'string') return false;
  const s = v.trim().toUpperCase();
  return s === 'NOT PULLED' || /NOT CAPTURED|NOT PULLED/i.test(v);
};

const STATUS_VARIANT = (v: string): 'success' | 'warning' | 'destructive' | 'secondary' => {
  const s = v.toUpperCase();
  if (/ACKNOWLEDG|APPROV|FILED|ACCEPT|PROCESSED|MATCHED/.test(s)) return 'success';
  if (/PENDING|PROCESSING|SUBMIT/.test(s)) return 'warning';
  if (/FAIL|REJECT|DENIED|CANCEL/.test(s)) return 'destructive';
  return 'secondary';
};

const TONE_VARIANT: Record<RowTone, 'success' | 'warning' | 'destructive' | 'info' | 'secondary'> = {
  good: 'success', warn: 'warning', bad: 'destructive', info: 'info', muted: 'secondary',
};

const isFigure = (model: TableModel, col: number): boolean => {
  const k = model.columns[col]?.kind;
  return k === 'amount' || k === 'int' || k === 'rate';
};

const figureText = (model: TableModel, col: number, v: number): string => {
  const k = model.columns[col]?.kind;
  return fmtNumber(v, k === 'int' || k === 'rate' ? k : 'amount');
};

const PAGE_SIZES = [100, 250, 500];
const MONTH_LABEL_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-]+\d{2,4}$/i;

// A sticky period band needs a solid fill (a navy tint over the card colour),
// or the rows scrolling under it show through.
const BAND_FILL = '[background:linear-gradient(hsl(var(--primary)/0.08),hsl(var(--primary)/0.08)),hsl(var(--card))]';

// The view's state is reset when a different report (or a different column
// set) is opened, and kept when the same report refreshes after a Pull.
export const DocumentLineItemsView: React.FC<DocumentLineItemsViewProps> = (props) => (
  <DocumentLineItemsBody key={`${props.report.key}\u0001${props.table.headers.join('\u0001')}`} {...props} />
);

const DocumentLineItemsBody: React.FC<DocumentLineItemsViewProps> = ({ table, report }) => {
  const model = useMemo(() => buildModel(table), [table]);
  const [state, setState] = useState<ViewState>(EMPTY_VIEW);
  const [hidden, setHidden] = useState<Set<number>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(250);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const view = useMemo(() => buildView(model, state, collapsed), [model, state, collapsed]);
  const cols = useMemo(() => visibleColumns(model, view, hidden), [model, view, hidden]);
  const paged = view.items.length > PAGE_THRESHOLD;
  const pageView = useMemo(
    () => (paged ? paginate(view.items, page, pageSize) : { items: view.items, page: 0, pages: 1, from: 0, to: view.items.length }),
    [paged, view.items, page, pageSize],
  );
  const filters = useMemo(() => activeFilters(model, state), [model, state]);
  const statusIdx = useMemo(
    () => table.toneColumn ?? table.headers.findIndex((h) => STATUS_HEADER_RE.test(h.trim())),
    [table],
  );
  const labelAt = useMemo(() => labelPosition(model, cols), [model, cols]);

  // A new filter, sort or grouping starts again at the top of page one.
  useEffect(() => { setPage(0); }, [state]);
  useEffect(() => { tableRef.current?.parentElement?.scrollTo?.({ top: 0 }); }, [pageView.page, state]);

  const update = useCallback((patch: Partial<ViewState>) => setState((s) => ({ ...s, ...patch })), []);
  const setFilter = useCallback((col: number, f: ColFilter | undefined) => {
    setState((s) => {
      const next = { ...s.filters };
      if (f && isFilterActive(f)) next[col] = f;
      else delete next[col];
      return { ...s, filters: next };
    });
  }, []);
  const setSort = useCallback((sort: SortState | null) => update({ sort }), [update]);
  const setGroup = useCallback((groupBy: number | null) => { setCollapsed(new Set()); update({ groupBy }); }, [update]);
  const cycleSort = (col: number) => {
    const cur = state.sort?.col === col ? state.sort.dir : null;
    setSort(cur === null ? { col, dir: 'asc' } : cur === 'asc' ? { col, dir: 'desc' } : null);
  };
  const clearAll = () => update({ search: '', filters: {} });
  const toggleGroup = (key: string) => setCollapsed((c) => {
    const next = new Set(c);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  // ── Totals for the summary strip ────────────────────────────────────────
  const strip = useMemo(() => {
    const all = model.grandTotal ? null : sumRows(model, model.data);
    const totalOf = (c: number): number => {
      const own = model.grandTotal?.cells[c];
      return typeof own === 'number' ? own : all?.get(c) ?? 0;
    };
    const shown = view.footer?.type === 'sum' ? view.footer.sums : null;
    return model.summable.map((c) => ({ col: c, total: totalOf(c), shown: view.filtered ? shown?.get(c) ?? 0 : null }));
  }, [model, view]);

  // ── Export what is shown ────────────────────────────────────────────────
  const exportView = async (format: 'xlsx' | 'pdf') => {
    setExporting(format);
    // Let the spinner paint before the file is built.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const t = viewToReportTable(table, model, state, hidden);
      if (format === 'xlsx') await Promise.resolve(renderReportToExcel(t));
      else await Promise.resolve(renderReportToPdf(t));
      toast.success(`${format === 'xlsx' ? 'Excel' : 'PDF'} of the ${view.rows.length.toLocaleString('en-IN')} rows shown downloaded.`);
    } catch (err) {
      toast.error(`Could not export: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(null);
    }
  };

  // ── Cells ───────────────────────────────────────────────────────────────
  const renderCell = (row: ModelRow, col: number): React.ReactNode => {
    if (col === model.periodCol) return displayText(model, row, col);
    const cell = row.cells[col];
    if (isUrlCell(cell)) {
      return (
        <a href={cell} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-primary hover:underline">
          <ExternalLink className="h-3 w-3" /> View
        </a>
      );
    }
    if (isSentinelCell(cell)) {
      return (
        <Badge variant="outline" className="border-dashed py-0 text-[10px] font-normal text-muted-foreground">
          Not Pulled
        </Badge>
      );
    }
    if (col === statusIdx && String(cell ?? '').trim() !== '') {
      const tone = table.rowTones?.[row.i];
      return (
        <Badge variant={tone ? TONE_VARIANT[tone] : STATUS_VARIANT(String(cell))} className="py-0 text-[10px] font-medium">
          {String(cell)}
        </Badge>
      );
    }
    if (typeof cell === 'number') return figureText(model, col, cell);
    return displayText(model, row, col);
  };

  // A register is read many rows at a time: a slightly tighter row than the house default.
  const cellClass = (col: number) => cn(
    WS_TD, 'py-1',
    isFigure(model, col) ? 'whitespace-nowrap text-right tabular-nums'
      : model.columns[col]?.kind === 'date' || col === model.periodCol ? 'whitespace-nowrap'
        : 'max-w-[280px] truncate',
  );

  // A TOTAL drawn from sums: the label where the report puts it, figures under their columns.
  const sumCells = (label: React.ReactNode, sums: Map<number, number>) => cols.map((c, k) => (
    <TableCell key={c} className={cn(WS_TD, 'whitespace-nowrap', isFigure(model, c) && 'text-right tabular-nums')}>
      {k === labelAt ? label : sums.has(c) ? figureText(model, c, sums.get(c) as number) : ''}
    </TableCell>
  ));
  const ownTotalCells = (row: ModelRow) => {
    // Its label may sit in a hidden column: carry it ("TOTAL (04/2025)") to a shown one.
    const shownLabel = cols.some((c) => /total/i.test(String(row.cells[c] ?? '')));
    const label = row.cells.map((v) => String(v ?? '').trim()).find((v) => /total/i.test(v)) ?? 'TOTAL';
    return cols.map((c, k) => {
      const v = c === model.periodCol ? '' : row.cells[c];
      return (
        <TableCell key={c} className={cn(WS_TD, 'whitespace-nowrap', isFigure(model, c) && 'text-right tabular-nums')}>
          {typeof v === 'number' ? figureText(model, c, v) : !shownLabel && k === labelAt ? label : String(v ?? '')}
        </TableCell>
      );
    });
  };

  // The first figure column shown: a group heading spans the text columns before it.
  const firstFigurePos = cols.findIndex((c) => model.summable.includes(c));
  const headSpan = firstFigurePos > 0 ? firstFigurePos : cols.length;

  let zebra = 0;
  const renderItem = (it: DisplayItem, k: number): React.ReactNode => {
    switch (it.type) {
      case 'band':
        zebra = 0;
        return (
          <TableRow key={`b${it.key}${it.continued ? 'c' : ''}`} className="sticky top-8 z-[5] hover:bg-transparent">
            <TableCell colSpan={cols.length} className={cn(WS_TD, BAND_FILL, 'py-1 font-semibold text-primary')}>
              <span className="inline-flex items-center gap-2">
                <CalendarRange className="h-3.5 w-3.5" />
                {it.label}
                <span className="font-normal text-muted-foreground">
                  {it.continued ? '(continued)' : view.filtered ? `${it.count} matching` : ''}
                </span>
              </span>
            </TableCell>
          </TableRow>
        );
      case 'section':
        return (
          <TableRow key={`s${it.row.i}${it.continued ? 'c' : ''}`} className={cn(WS_TR_HEADING, 'hover:bg-muted/50')}>
            <TableCell colSpan={cols.length} className={cn(WS_TD, 'py-1 text-[13px]')}>
              {it.label} {it.continued && <span className="font-normal text-muted-foreground">(continued)</span>}
            </TableCell>
          </TableRow>
        );
      case 'group': {
        zebra = 0;
        const gcol = state.groupBy !== null ? model.columns[state.groupBy] : null;
        return (
          <TableRow
            key={`g${it.key}${it.continued ? 'c' : ''}`}
            className={cn('sticky top-8 z-[5] cursor-pointer bg-muted hover:bg-muted', WS_TR_HEADING)}
            onClick={() => toggleGroup(it.key)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(it.key); } }}
            tabIndex={0}
            aria-expanded={!it.collapsed}
          >
            <TableCell colSpan={headSpan} className={cn(WS_TD, 'bg-muted font-semibold')}>
              <span className="inline-flex items-center gap-1.5">
                {it.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                <span className="font-normal text-muted-foreground">{gcol?.label}:</span>
                <span className="max-w-[420px] truncate" title={it.label}>{it.label}</span>
                <span className="font-normal text-muted-foreground">
                  ({it.count.toLocaleString('en-IN')} {it.count === 1 ? 'row' : 'rows'}{it.continued ? ', continued' : ''})
                </span>
              </span>
            </TableCell>
            {headSpan < cols.length && cols.slice(headSpan).map((c) => (
              <TableCell key={c} className={cn(WS_TD, 'bg-muted font-semibold', isFigure(model, c) && 'whitespace-nowrap text-right tabular-nums')}>
                {it.sums.has(c) ? figureText(model, c, it.sums.get(c) as number) : ''}
              </TableCell>
            ))}
          </TableRow>
        );
      }
      case 'data': {
        const odd = zebra++ % 2 === 1;
        return (
          <TableRow key={`d${it.row.i}`} className={cn('hover:bg-primary/[0.04]', odd && 'bg-muted/25')}>
            {cols.map((c) => (
              <TableCell
                key={c}
                className={cellClass(c)}
                title={typeof it.row.cells[c] === 'string' && !isUrlCell(it.row.cells[c]) ? String(it.row.cells[c]) : undefined}
              >
                {renderCell(it.row, c)}
              </TableCell>
            ))}
          </TableRow>
        );
      }
      case 'total':
        return (
          <TableRow key={`t${it.row.i}`} className={cn(WS_TR_TOTAL, 'border-t hover:bg-muted [&>td]:border-t-foreground/30 [&>td]:border-t')}>
            {ownTotalCells(it.row)}
          </TableRow>
        );
      case 'sum':
        return (
          <TableRow key={`m${k}`} className={cn(WS_TR_TOTAL, 'hover:bg-muted [&>td]:border-t [&>td]:border-t-foreground/30')}>
            {sumCells(<span className="italic">{it.label}</span>, it.sums)}
          </TableRow>
        );
      case 'blank':
        return <TableRow key={`x${it.row.i}`} className="h-3 hover:bg-transparent"><TableCell colSpan={cols.length} className="h-3 p-0" /></TableRow>;
    }
  };

  // A merge keeps the first month's subtitle; its month is not the report's period.
  const subtitleParts = table.subtitle.split('|').map((s) => s.trim()).filter(Boolean)
    .filter((s) => !model.merged || !(MONTH_LABEL_RE.test(s) || /^(period|month|return period):/i.test(s)));
  const hasAnyData = table.rows.length > 0;
  const groupable = model.columns.filter((c) => c.groupable);
  const sortIcon = (c: number) => {
    if (state.sort?.col !== c) return <ArrowUpDown className="h-3 w-3 opacity-0 transition-opacity group-hover/th:opacity-50" />;
    return state.sort.dir === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />;
  };

  return (
    // The card fills the preview so the list takes the room left and its TOTAL and pager stay in sight.
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="space-y-0 px-4 pb-2 pt-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <report.icon className="h-4 w-4 shrink-0 text-primary" />
              <CardTitle className="text-[15px] leading-snug">{table.title || report.title}</CardTitle>
              <Badge variant={REPORT_STATUS_META[report.status].badgeVariant} className="text-[10px] font-medium">
                {REPORT_STATUS_META[report.status].shortLabel}
              </Badge>
            </div>
            {subtitleParts.length > 0 && (
              <CardDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                {subtitleParts.map((part, i) => (
                  <span key={i} className="flex items-center gap-2">
                    {i > 0 && <span className="text-muted-foreground/40">•</span>}
                    {part}
                  </span>
                ))}
              </CardDescription>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 pb-3">
        {!hasAnyData && (
          <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center text-muted-foreground">
            <Inbox className="h-5 w-5 opacity-60" />
            <p className="text-sm">No rows in this report for the selected client and period.</p>
          </div>
        )}

        {hasAnyData && (
          <>
            {/* Summary strip: the totals before anyone scrolls; once filtered, the rows shown against the whole. */}
            {strip.length > 0 && (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
                <KpiTile
                  label={view.filtered ? 'Rows shown' : 'Rows'}
                  value={(view.filtered ? view.rows.length : model.data.length).toLocaleString('en-IN')}
                  hint={view.filtered ? `of ${model.data.length.toLocaleString('en-IN')}` : model.merged ? `${model.periods.length} periods` : undefined}
                />
                {strip.map((s) => (
                  <KpiTile
                    key={s.col}
                    label={model.columns[s.col].label}
                    value={figureText(model, s.col, s.shown ?? s.total)}
                    hint={s.shown !== null ? `of ${figureText(model, s.col, s.total)}` : undefined}
                  />
                ))}
              </div>
            )}

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] max-w-sm flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={state.search}
                  onChange={(e) => update({ search: e.target.value })}
                  placeholder="Search supplier, GSTIN, invoice no., amount…"
                  aria-label="Search the rows"
                  className="h-8 pl-8 pr-8 text-xs"
                />
                {state.search && (
                  <Button variant="ghost" size="icon" className="absolute right-0.5 top-1/2 h-7 w-7 -translate-y-1/2" onClick={() => update({ search: '' })} aria-label="Clear search">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {model.merged && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className={cn(WS_BTN, isFilterActive(state.filters[model.periodCol]) && 'border-primary text-primary')}>
                      <CalendarRange className="h-3.5 w-3.5" />
                      {(() => {
                        const f = state.filters[model.periodCol];
                        const n = f?.type === 'values' ? f.values.length : 0;
                        return n ? `Periods: ${n} of ${model.periods.length}` : `Periods: all ${model.periods.length}`;
                      })()}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-64 p-3">
                    <p className="mb-1.5 text-sm font-semibold">Period</p>
                    <ValuesPanel model={model} state={state} col={model.periodCol} filter={state.filters[model.periodCol]} onChange={(f) => setFilter(model.periodCol, f)} />
                  </PopoverContent>
                </Popover>
              )}

              <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-live="polite">
                {view.filtered
                  ? `${view.rows.length.toLocaleString('en-IN')} of ${model.data.length.toLocaleString('en-IN')} rows`
                  : `${model.data.length.toLocaleString('en-IN')} ${model.data.length === 1 ? 'row' : 'rows'}`}
              </span>

              <div className="flex-1" />

              {groupable.length > 0 && (
                <div className="flex items-center gap-1">
                  <Select value={state.groupBy === null ? 'none' : String(state.groupBy)} onValueChange={(v) => setGroup(v === 'none' ? null : Number(v))}>
                    <SelectTrigger className="h-8 w-[200px] text-xs" aria-label="Group by">
                      <Layers className="mr-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="text-xs">No grouping</SelectItem>
                      {groupable.map((c) => (
                        <SelectItem key={c.index} value={String(c.index)} className="text-xs">Group by {c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {view.groups && (
                    <Button
                      variant="ghost" size="sm" className={WS_BTN}
                      onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(view.groups!.map((g) => g.key)))}
                    >
                      {collapsed.size ? 'Expand all' : 'Collapse all'}
                    </Button>
                  )}
                </div>
              )}

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn(WS_BTN, hidden.size > 0 && 'border-primary text-primary')}>
                    <Columns3 className="h-3.5 w-3.5" /> Columns{hidden.size ? ` (${hidden.size} hidden)` : ''}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-60 p-2">
                  <div className="mb-1 flex items-center justify-between px-1">
                    <p className="text-xs font-semibold">Columns shown</p>
                    {hidden.size > 0 && (
                      <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground hover:underline" onClick={() => setHidden(new Set())}>Show all</button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-auto">
                    {model.columns.filter((c) => !c.virtual || view.showPeriodColumn).map((c) => {
                      const on = !hidden.has(c.index);
                      const last = on && cols.length === 1;
                      return (
                        <label key={c.index} className={cn('flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted', last && 'cursor-not-allowed opacity-60')}>
                          <Checkbox
                            checked={on}
                            disabled={last}
                            className="h-3.5 w-3.5"
                            onCheckedChange={() => setHidden((h) => {
                              const next = new Set(h);
                              if (next.has(c.index)) next.delete(c.index);
                              else next.add(c.index);
                              return next;
                            })}
                          />
                          <span className="truncate">{c.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>

              <Button variant="outline" size="sm" className={WS_BTN} onClick={() => exportView('xlsx')} disabled={exporting !== null} title="The rows and columns shown, as filtered, sorted and grouped here">
                {exporting === 'xlsx' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                Excel (filtered)
              </Button>
              <Button variant="outline" size="sm" className={WS_BTN} onClick={() => exportView('pdf')} disabled={exporting !== null} title="The rows and columns shown, as filtered, sorted and grouped here">
                {exporting === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                PDF (filtered)
              </Button>
            </div>

            {/* Active filters */}
            {filters.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {filters.map((f) => (
                  <span
                    key={String(f.col)}
                    className="inline-flex max-w-[460px] items-center gap-1 rounded-full border border-primary/30 bg-primary/[0.06] py-0.5 pl-2.5 pr-1 text-[11px] text-foreground"
                  >
                    <span className="truncate" title={f.text}>{f.text}</span>
                    <button
                      type="button"
                      aria-label={`Remove filter: ${f.text}`}
                      className="rounded-full p-0.5 text-muted-foreground hover:bg-primary/10 hover:text-foreground"
                      onClick={() => (f.col === 'search' ? update({ search: '' }) : setFilter(f.col, undefined))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={clearAll}>Clear all</Button>
              </div>
            )}

            {/* Table: its own wrapper scrolls, so the header and the TOTAL stay pinned. */}
            <Table
              ref={tableRef}
              className={WS_TABLE}
              containerClassName="min-h-[160px] max-h-[65vh] flex-[0_1_auto] rounded-md border bg-card"
            >
              <TableHeader className="sticky top-0 z-20">
                <TableRow>
                  {cols.map((c) => {
                    const mc = model.columns[c];
                    const right = isFigure(model, c);
                    return (
                      <TableHead key={c} className={cn(WS_TH, 'group/th h-8 px-1.5 py-0', right && 'text-right')} aria-sort={state.sort?.col === c ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <div className={cn('flex items-center gap-0.5', right && 'justify-end')}>
                          <button
                            type="button"
                            onClick={() => cycleSort(c)}
                            className="inline-flex items-center gap-1 rounded px-0.5 hover:text-foreground"
                            title={`Sort by ${mc.label}`}
                            aria-label={`Sort by ${mc.label}`}
                          >
                            {mc.label}
                            {sortIcon(c)}
                          </button>
                          <ColumnFilter model={model} state={state} col={c} onFilter={setFilter} onSort={setSort} onGroup={setGroup} />
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>

              <TableBody>
                {view.rows.length === 0 && view.filtered && (
                  <TableRow>
                    <TableCell colSpan={cols.length} className="border-b py-6 text-center text-sm text-muted-foreground">
                      No rows match these filters.{' '}
                      <button type="button" className="text-primary hover:underline" onClick={clearAll}>Clear all</button>
                    </TableCell>
                  </TableRow>
                )}
                {pageView.items.map(renderItem)}
              </TableBody>

              {view.footer && (
                <TableFooter className="sticky bottom-0 z-10 border-t-0 bg-muted">
                  <TableRow className={cn(WS_TR_TOTAL, 'hover:bg-muted [&>td]:border-t-2 [&>td]:border-t-foreground/40 [&>td]:font-bold')}>
                    {view.footer.type === 'total' ? ownTotalCells(view.footer.row) : sumCells(view.footer.label, view.footer.sums)}
                  </TableRow>
                </TableFooter>
              )}
            </Table>

            {paged && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  Lines {(pageView.from + 1).toLocaleString('en-IN')} to {pageView.to.toLocaleString('en-IN')} of {view.items.length.toLocaleString('en-IN')}
                </span>
                <div className="flex items-center gap-1.5">
                  <span>Per page</span>
                  <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(0); }}>
                    <SelectTrigger className="h-7 w-[76px] text-xs" aria-label="Lines per page"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={pageView.page === 0} onClick={() => setPage(pageView.page - 1)} aria-label="Previous page">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="tabular-nums">Page {pageView.page + 1} of {pageView.pages}</span>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={pageView.page >= pageView.pages - 1} onClick={() => setPage(pageView.page + 1)} aria-label="Next page">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default DocumentLineItemsView;
