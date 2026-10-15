// Renders the "one row per client" family of roster reports: Suspended
// Ledger / Credit Ledger (All Clients), Filing Status Report, Tax Paid under
// RCM vs ITC Claimed, ITC Claimed vs ITC Utilized, Client Master and Interest
// and Late Fees (All Clients). These run a hundred clients and more deep (the
// Filing Status Report one row per client per return), so the design leans
// "directory", not "document":
//   1. A header (title and the subtitle's parts).
//   2. A summary strip before anyone scrolls: how many clients, how many have
//      the portal return pulled, and the grand totals; once filtered, the
//      figures of the rows shown against the whole.
//   3. Status pills (Filed, Data Pending, Active…) with their counts: one click
//      shows that status, as a column filter, so it is a chip, it moves the
//      counts and the TOTAL, and the export says so.
//   4. The table kit (./tableKit): every column filtered from its header (the
//      Status, Return Type and Registration Type columns as tick lists with
//      counts), sorted, grouped with subtotals (by return type or status:
//      the main way a partner reads a roster), columns hidden, and the view
//      exported exactly as shown.
//   5. The report's own grand TOTAL pinned under the list; under a filter a
//      TOTAL of the rows shown, marked "filtered", so no figure on screen
//      describes clients that are hidden. "NOT PULLED" stays a dashed sentinel,
//      never a figure.
import React, { useMemo } from 'react';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile } from '@/components/gstr9/ui';
import { Button } from '@/components/ui/button';
import { WS_BTN } from '@/components/workspace/theme';
import { fmtDate, parseDateCell, rowKindsOf } from '@/lib/reportExport/layout';
import { cn } from '@/lib/utils';
import { CircleDashed, EyeOff, Inbox } from 'lucide-react';
import {
  GROUP_LIMIT, TableKitPager, TableKitTable, TableKitToolbar, facetValues, isSentinelCell, statusVariant, useTableKit,
  type BadgeVariant, type ColumnFilter, type ModelColumn, type ModelRow,
} from './tableKit';

interface AllClientsSnapshotViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

// ─────────────────────────────── statuses ───────────────────────────────

// The firm's filing statuses read as on the Filing Status page: Filed is done,
// Pushed / Prepared / Data Received are on their way, the Pending ones wait on
// someone, a mismatch is wrong. The kit's guess from the words alone would
// call "Mismatch in Data" neutral, so the known ones are named here.
const STATUS_ORDER: [string, BadgeVariant][] = [
  ['filed', 'success'],
  ['active', 'success'],
  ['pushed', 'info'],
  ['prepared', 'info'],
  ['data received', 'info'],
  ['prepared pending', 'warning'],
  ['not verified', 'warning'],
  ['data pending', 'warning'],
  ['mismatch in data', 'destructive'],
  ['not to file', 'secondary'],
  ['no filing record', 'secondary'],
  ['inactive', 'secondary'],
];
const STATUS_RANK = new Map(STATUS_ORDER.map(([s], k) => [s, k]));
const STATUS_VARIANT = new Map(STATUS_ORDER);
const rosterStatusVariant = (v: string): BadgeVariant => STATUS_VARIANT.get(v.trim().toLowerCase()) ?? statusVariant(v);

const DOT: Record<BadgeVariant, string> = {
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  secondary: 'bg-muted-foreground/50',
};

// ─────────────────────────────── columns ────────────────────────────────

const CLIENT_HEADER_RE = /^client(\s+name)?$/i;
// Identifiers and dates: every value names one client, one contact or one
// day, so grouping by them only repeats the rows under headings of one each.
const IDENTITY_HEADER_RE = /gstin|\bpan\b|e-?mail|mobile|phone|contact|address|\barn\b|date/i;
const DATE_HEADER_RE = /date/i;
const VARIANCE_HEADER_RE = /^(variance|difference|diff)\b/i;
const MONTH_LABEL_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-]+\d{2,4}$/i;

const NIL = 0.005;
const PULLED_ONLY = 'Pulled only';
const NOT_PULLED_ONLY = 'Not pulled only';
const hasSentinel = (row: ModelRow): boolean => row.cells.some((c) => isSentinelCell(c));
/**
 * Every figure of the row nil: nothing for a reviewer to look at. A NOT PULLED
 * row is not nil, its figures are unknown, so it stays.
 */
const isNilRow = (row: ModelRow, figureCols: number[]): boolean => !hasSentinel(row) && !figureCols.some((c) => {
  const v = row.cells[c];
  return typeof v === 'number' && Math.abs(v) >= NIL;
});

export const AllClientsSnapshotView: React.FC<AllClientsSnapshotViewProps> = ({ table, report }) => {
  const clientCol = table.headers.findIndex((h) => CLIENT_HEADER_RE.test(h.trim()));
  // How many client lines the report has (its own TOTAL rows and the period
  // bands of a merge left out), and whether each is a different client: then
  // the count is of clients; the Filing Status Report (a row per return) and a
  // multi-month merge count rows and clients apart.
  const { dataCount, perClient } = useMemo(() => {
    const kinds = rowKindsOf(table.rows, table.rowKinds);
    const names = new Set<string>();
    let n = 0;
    let merged = false;
    table.rows.forEach((r, i) => {
      if (kinds[i] === 'period') merged = true;
      if (kinds[i] !== 'data') return;
      n++;
      if (clientCol >= 0) names.add(String(r[clientCol] ?? '').trim());
    });
    return { dataCount: n, perClient: clientCol >= 0 && !merged && names.size === n };
  }, [table.rows, table.rowKinds, clientCol]);
  // A column can be grouped by only when its values repeat.
  const groupable = (c: ModelColumn): boolean => {
    if (c.kind === 'period') return true;
    if (c.kind !== 'text' && c.kind !== 'rate') return false;
    if (IDENTITY_HEADER_RE.test(c.header)) return false;
    return c.distinct >= 2 && c.distinct <= GROUP_LIMIT && c.distinct < dataCount;
  };

  const kit = useTableKit(table, {
    resetKey: report.key,
    groupable,
    rowNoun: perClient ? ['client', 'clients'] : ['row', 'rows'],
  });
  const { model, view, state } = kit;

  // ── The status pills ─────────────────────────────────────────────────────
  const statusCol = kit.statusCol >= 0 && model.columns[kit.statusCol]?.filter === 'values' ? kit.statusCol : -1;
  const statusFilter = statusCol >= 0 ? state.filters[statusCol] : undefined;
  const ticked = new Set(statusFilter?.type === 'values' ? statusFilter.values : []);
  const statuses = useMemo(() => {
    if (statusCol < 0) return [];
    const rank = (k: string) => STATUS_RANK.get(k.toLowerCase()) ?? STATUS_ORDER.length;
    return facetValues(model, state, statusCol).sort((a, b) => rank(a.key) - rank(b.key));
  }, [model, state, statusCol]);
  const toggleStatus = (key: string) => {
    const next = new Set(ticked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    kit.setFilter(statusCol, next.size ? { type: 'values', values: [...next] } : undefined);
  };

  // ── Quick filters ────────────────────────────────────────────────────────
  // Pulled / not pulled: the GSTR-3B based reports leave a client NOT PULLED
  // until its portal return is fetched; a reviewer chases those first.
  const notPulledAll = useMemo(() => model.data.filter(hasSentinel).length, [model]);
  const notPulledShown = useMemo(() => view.rows.filter(hasSentinel).length, [view.rows]);
  const pulledMode = state.custom?.find((c) => c.id === 'pulled')?.label ?? null;
  const setPulled = (label: typeof PULLED_ONLY | typeof NOT_PULLED_ONLY | null) => kit.setCustomFilter('pulled', label === null ? null : {
    label,
    test: (row) => hasSentinel(row) === (label === NOT_PULLED_ONLY),
  });

  // Nil rows: most clients carry no suspended balance, no interest, no late
  // fee; hiding them leaves the clients worth a look.
  const nilRows = useMemo(() => model.data.filter((r) => isNilRow(r, model.summable)).length, [model]);
  const nilHidden = !!state.custom?.some((c) => c.id === 'nonNil');
  const toggleNil = () => {
    const figureCols = model.summable;
    kit.setCustomFilter('nonNil', nilHidden ? null : { label: 'Nil rows hidden', test: (row) => !isNilRow(row, figureCols) });
  };

  // A variance column (RCM paid vs claimed): "differences only" is its "not nil".
  const varianceCol = table.headers.findIndex((h, c) => VARIANCE_HEADER_RE.test(h.trim()) && kit.isFigure(c));
  const varianceFilter = varianceCol >= 0 ? state.filters[varianceCol] : undefined;
  const varianceOnly = varianceFilter?.type === 'number' && !!varianceFilter.nonZero;
  const toggleVariance = () => {
    const f = varianceFilter?.type === 'number' ? varianceFilter : { type: 'number' as const, min: null, max: null };
    const next: ColumnFilter = { ...f, nonZero: !varianceOnly };
    kit.setFilter(varianceCol, next);
  };

  // ── Counts for the summary strip ─────────────────────────────────────────
  const [clientsAll, clientsShown] = useMemo(() => {
    if (clientCol < 0) return [0, 0];
    const distinct = (rows: ModelRow[]) => new Set(rows.map((r) => String(r.cells[clientCol] ?? '').trim())).size;
    return [distinct(model.data), distinct(view.rows)];
  }, [model, view.rows, clientCol]);

  const dateTextCols = new Set(model.columns.filter((c) => c.kind === 'text' && DATE_HEADER_RE.test(c.header)).map((c) => c.index));

  // A merge keeps the first month's subtitle; its month is not the report's period.
  const subtitleParts = table.subtitle.split('|').map((s) => s.trim()).filter(Boolean)
    .filter((s) => !model.merged || !(MONTH_LABEL_RE.test(s) || /^(period|month|return period):/i.test(s)));

  if (table.rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-1.5 py-8 text-muted-foreground">
          <Inbox className="h-5 w-5 opacity-60" />
          <p className="text-sm">No data available for this report yet.</p>
        </CardContent>
      </Card>
    );
  }

  const fmtCount = (n: number) => n.toLocaleString('en-IN');
  const pulledAll = model.data.length - notPulledAll;
  const pulledShown = view.rows.length - notPulledShown;

  return (
    // The card fills the preview so the list takes the room left and its TOTAL and pager stay in sight.
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="space-y-0 px-4 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <report.icon className="h-4 w-4 shrink-0 text-primary" />
          <CardTitle className="text-[15px] leading-snug">{table.title || report.title}</CardTitle>
        </div>
        {subtitleParts.length > 0 && (
          <CardDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-6 text-xs">
            {subtitleParts.map((part, i) => (
              <span key={i} className="flex items-center gap-2">
                {i > 0 && <span className="text-muted-foreground/40">•</span>}
                {part}
              </span>
            ))}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 pb-3">
        {/* Summary strip: the headline figures before anyone scrolls; once filtered, the rows shown against the whole. */}
        <div className="flex flex-wrap gap-2 [&>*]:min-w-[150px] [&>*]:max-w-[240px] [&>*]:flex-1">
          <KpiTile
            label={perClient ? 'Clients' : 'Rows'}
            value={fmtCount(view.filtered ? view.rows.length : model.data.length)}
            hint={view.filtered ? `of ${fmtCount(model.data.length)}` : model.merged ? `${model.periods.length} periods` : undefined}
          />
          {!perClient && clientCol >= 0 && (
            <KpiTile
              label="Clients"
              value={fmtCount(view.filtered ? clientsShown : clientsAll)}
              hint={view.filtered ? `of ${fmtCount(clientsAll)}` : undefined}
            />
          )}
          {notPulledAll > 0 && (
            <KpiTile
              label="Pulled from portal"
              value={fmtCount(view.filtered ? pulledShown : pulledAll)}
              hint={`${fmtCount(view.filtered ? notPulledShown : notPulledAll)} not pulled`}
              tone={(view.filtered ? notPulledShown : notPulledAll) > 0 ? 'warn' : 'ok'}
            />
          )}
          {kit.totals.map((s) => (
            <KpiTile
              key={s.col}
              label={model.columns[s.col].name}
              value={kit.figure(s.col, s.shown ?? s.total)}
              // "of –" says nothing: a nil total is not repeated under a nil figure.
              hint={s.shown !== null && !(Math.abs(s.total) < NIL && Math.abs(s.shown) < NIL) ? `of ${kit.figure(s.col, s.total)}` : undefined}
            />
          ))}
        </div>

        {/* Status pills: a click shows that status (several: any of them); the counts follow the other filters. */}
        {statuses.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Filter by ${model.columns[statusCol].name}`}>
            <span className="mr-0.5 text-xs font-medium text-muted-foreground">{model.columns[statusCol].name}</span>
            {statuses.map((s) => {
              const on = ticked.has(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleStatus(s.key)}
                  title={on ? `Showing ${s.label}: click to stop` : `Show ${s.label} only`}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors',
                    on ? 'border-primary bg-primary/10 text-foreground' : 'bg-card hover:bg-muted',
                    s.count === 0 && !on && 'opacity-50',
                  )}
                >
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[rosterStatusVariant(s.label)])} />
                  {s.label}
                  <span className="tabular-nums text-muted-foreground">{fmtCount(s.count)}</span>
                </button>
              );
            })}
          </div>
        )}

        <TableKitToolbar
          kit={kit}
          searchPlaceholder={clientCol >= 0 ? 'Search client, GSTIN, status…' : 'Search every column…'}
          left={(
            <>
              {notPulledAll > 0 && (
                <div className="flex items-center rounded-md border p-0.5" role="group" aria-label="Pulled or not pulled">
                  {([[null, 'All'], [PULLED_ONLY, `Pulled ${fmtCount(pulledAll)}`], [NOT_PULLED_ONLY, `Not pulled ${fmtCount(notPulledAll)}`]] as const).map(([k, label]) => {
                    const on = pulledMode === k;
                    return (
                      <Button
                        key={label}
                        type="button"
                        variant={on ? 'secondary' : 'ghost'}
                        size="sm"
                        aria-pressed={on}
                        className={cn('h-6 gap-1 px-2 text-[11px]', on && 'font-semibold')}
                        onClick={() => setPulled(k)}
                      >
                        {k === NOT_PULLED_ONLY && <CircleDashed className="h-3 w-3" />}
                        {label}
                      </Button>
                    );
                  })}
                </div>
              )}
              {nilRows > 0 && nilRows < model.data.length && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={nilHidden}
                  className={cn(WS_BTN, nilHidden && 'border-primary text-primary')}
                  onClick={toggleNil}
                  title="Leave out the rows whose every figure is nil"
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  {nilHidden ? `Nil rows hidden (${fmtCount(nilRows)})` : `Hide nil rows (${fmtCount(nilRows)})`}
                </Button>
              )}
              {varianceCol >= 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={varianceOnly}
                  className={cn(WS_BTN, varianceOnly && 'border-primary text-primary')}
                  onClick={toggleVariance}
                  title={`Only the clients whose ${model.columns[varianceCol].name} is not nil`}
                >
                  Differences only
                </Button>
              )}
            </>
          )}
        />

        <TableKitTable
          kit={kit}
          label={table.title}
          noMatchText="No clients match these filters."
          cellClassName={(_row, col) => (col === clientCol ? 'font-medium' : undefined)}
          renderCell={(row, col) => {
            const v = String(row.cells[col] ?? '').trim();
            if (!v || isSentinelCell(v)) return undefined;
            if (col === statusCol) return <Badge variant={rosterStatusVariant(v)} className="py-0 text-[10px] font-medium">{v}</Badge>;
            // A date the kit left as text (the column holds a word or two as
            // well) still reads in the house style.
            if (dateTextCols.has(col) && parseDateCell(v)) return fmtDate(v);
            return undefined;
          }}
        />
        <TableKitPager kit={kit} />
      </CardContent>
    </Card>
  );
};
