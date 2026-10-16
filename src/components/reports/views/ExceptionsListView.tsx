// ExceptionsListView — the "these are the ones you need to act on" archetype
// for threshold-driven exception reports (Interest & Late Fee scrutiny, Rule
// 42 Short Reversal…). Every report in this family has already done the
// filtering upstream — table.rows holds only the clients that failed some
// check, plus a pinned TOTAL row — so this view's job isn't to re-derive
// which rows are exceptions, it's to make the flagged count and the flagged
// amount impossible to miss, and to read as urgent rather than routine.
//
// The flagged rows are worked from every angle through the table kit
// (./tableKit): a filter on every header (a figure range on the amount, ticked
// values, "contains"), sort, Group by a value that repeats (days late), hidden
// columns, and "Excel (filtered)" / "PDF (filtered)" of exactly what is shown.
// The severity cues stay: the red frame and badge, the amount column in red
// with a bar for each row's share of the largest, the TOTAL pinned under the
// list, largest exposure first.
import React, { useMemo } from 'react';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile } from '@/components/gstr9/ui';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CheckCircle2, AlertTriangle, ArrowDownWideNarrow, ArrowDownAZ } from 'lucide-react';
import { rowKindsOf } from '@/lib/reportExport/layout';
import {
  TableKitFailedPeriods, TableKitPager, TableKitTable, TableKitToolbar, useTableKit, type ModelColumn, type ModelRow,
} from './tableKit';

interface ExceptionsListViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

/**
 * The column this whole report exists to surface — checked in priority order
 * so "Shortfall" (Rule 42 Short Reversal) wins over a generic "Total", and a
 * report with several money-ish columns (IGST/CGST/SGST/Total Interest) still
 * lands on the one that's the per-row bottom line rather than a component of
 * it. Falls back to the rightmost column that actually holds numbers when no
 * header name gives it away.
 */
const AMOUNT_HEADER_PRIORITY: RegExp[] = [
  /shortfall/i,
  /total\s*interest/i,
  /^total$/i,
  /interest/i,
  /amount/i,
  /value/i,
];

const findAmountColIdx = (headers: string[], dataRows: (string | number)[][]): number => {
  for (const re of AMOUNT_HEADER_PRIORITY) {
    const idx = headers.findIndex((h) => re.test(h.trim()));
    if (idx !== -1) return idx;
  }
  for (let i = headers.length - 1; i >= 0; i--) {
    if (dataRows.some((r) => typeof r[i] === 'number')) return i;
  }
  return -1;
};

const findClientColIdx = (headers: string[]): number => {
  const idx = headers.findIndex((h) => /^client(\s*name)?$/i.test(h.trim()));
  return idx !== -1 ? idx : 0;
};

// A merge keeps the first month's subtitle; its month is not the list's period.
const MONTH_LABEL_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-]+\d{2,4}$/i;
const subtitleOf = (subtitle: string, merged: boolean): string => (!merged ? subtitle : subtitle.split('|').map((s) => s.trim()).filter(Boolean)
  .filter((s) => !(MONTH_LABEL_RE.test(s) || /^(period|month|return period):/i.test(s)))
  .join('   |   '));

const toNumber = (v: string | number | undefined): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const n = Number(v.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export const ExceptionsListView: React.FC<ExceptionsListViewProps> = ({ table, report }) => {
  const headers = table.headers;
  const Icon = report.icon || AlertTriangle;

  // The flagged rows (not the TOTAL), read before the kit so its options can
  // use them, and whether a month of a merge could not be built (its band and
  // one "Not built" line, as the kit reads it).
  const { dataRows, merged, someFailed } = useMemo(() => {
    const kinds = rowKindsOf(table.rows, table.rowKinds);
    return {
      dataRows: table.rows.filter((_, i) => kinds[i] === 'data'),
      merged: kinds.includes('period'),
      someFailed: !!table.failedReason || kinds.some((k, i) => k === 'period' && /^not built:/i.test(String(table.rows[i + 1]?.[0] ?? '').trim())),
    };
  }, [table.rows, table.rowKinds, table.failedReason]);
  // Several months merged: a row is a client in one month, and a client late
  // in both months is two rows, so the rows are counted as flags, not clients.
  const noun: [string, string] = merged ? ['flag', 'flags'] : ['client', 'clients'];

  const amountColIdx = useMemo(() => findAmountColIdx(headers, dataRows), [headers, dataRows]);
  const clientColIdx = useMemo(() => findClientColIdx(headers), [headers]);

  const kit = useTableKit(table, {
    resetKey: report.key,
    // Largest exposure first, as the list always opened. Several months
    // merged open grouped by month (each with its subtotal, as the report's
    // own per-month TOTAL), largest first within each: sorted across months,
    // the month bands and TOTALs would go. Not when a month could not be
    // built: grouped by month, the months listed would read as every month
    // checked; the list opens sorted, its Period column and the note above it
    // naming the month missing.
    initialSort: amountColIdx !== -1 ? { col: amountColIdx, dir: 'desc' } : null,
    initialGroupBy: merged && !someFailed ? headers.length : null,
    rowNoun: noun,
    // Group by a value clients share (days late, the month); a client's name
    // or GSTIN is one row each, so grouping by it would only add a heading
    // per row.
    groupable: (c: ModelColumn) => c.virtual || ((c.groupable || (c.kind === 'int' && !c.summable)) && c.distinct > 1 && c.distinct < dataRows.length),
  });
  const { model, view, state } = kit;

  const flaggedCount = model.data.length;
  // The periods checked: a month that could not be built was not.
  const builtPeriods = model.periods.length - kit.failedPeriods.filter((f) => f.key !== '').length;

  // The amount's total: the pinned TOTAL row's own figure where the report
  // printed one (it's the number that was actually computed against, not a
  // recomputation of it), and once filtered, the rows still shown.
  const amountTotal = kit.totals.find((t) => t.col === amountColIdx);
  const amountAll = amountTotal?.total ?? model.data.reduce((sum, r) => sum + toNumber(r.cells[amountColIdx]), 0);
  const amountShown = view.filtered
    ? amountTotal?.shown ?? view.rows.reduce((sum, r) => sum + toNumber(r.cells[amountColIdx]), 0)
    : null;

  // The largest single exposure among the rows shown, and who it is.
  const largest = useMemo(() => {
    if (amountColIdx === -1) return null;
    let best: ModelRow | null = null;
    for (const r of view.rows) if (!best || toNumber(r.cells[amountColIdx]) > toNumber(best.cells[amountColIdx])) best = r;
    return best ? { amount: toNumber(best.cells[amountColIdx]), who: String(best.cells[clientColIdx] ?? '') } : null;
  }, [view.rows, amountColIdx, clientColIdx]);
  // The bar in each amount cell is its share of the largest in the whole list,
  // so a row's bar does not grow when its neighbours are filtered away.
  const maxAll = useMemo(
    () => (amountColIdx === -1 ? 0 : Math.max(0, ...model.data.map((r) => toNumber(r.cells[amountColIdx])))),
    [model.data, amountColIdx],
  );

  // ── Calm empty state — nothing flagged this period, no table to show ──────
  // Calm only when every period was checked: a month that could not be built
  // was never checked, so it is named, and nothing is said to have cleared.
  if (flaggedCount === 0) {
    const failed = kit.failedPeriods;
    return (
      <Card>
        <CardHeader className="space-y-0.5 px-4 pb-2 pt-3">
          <CardTitle className="flex items-center gap-2 text-[15px] leading-snug">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {table.title}
          </CardTitle>
          <CardDescription className="text-xs">{subtitleOf(table.subtitle, merged)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5 px-4 pb-3">
          {failed.length > 0 ? (
            <>
              <TableKitFailedPeriods failed={failed} />
              {builtPeriods > 0 && (
                <p className="text-xs text-muted-foreground">
                  No client is flagged in the {builtPeriods === 1 ? 'one period' : `${builtPeriods} periods`} that could be built;
                  {' '}{failed.length === 1 ? 'the period above was' : 'the periods above were'} not checked.
                </p>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed py-8 text-center">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <p className="text-sm font-medium text-foreground">No exceptions this period</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Every client cleared this check for the selected period — nothing needs action.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const sortMode = state.sort?.col === amountColIdx && state.sort.dir === 'desc' ? 'amount'
    : state.sort?.col === clientColIdx && state.sort.dir === 'asc' ? 'client' : '';

  const renderCell = (row: ModelRow, col: number): React.ReactNode | undefined => {
    if (col !== amountColIdx) return undefined;
    const v = row.cells[col];
    if (typeof v !== 'number') return undefined;
    const share = maxAll > 0 ? Math.max(0, Math.min(1, v / maxAll)) : 0;
    return (
      <span className="relative inline-flex w-full flex-col items-end">
        <span>{kit.figure(col, v)}</span>
        <span className="mt-0.5 h-[3px] w-full max-w-[120px] overflow-hidden rounded-full bg-destructive/10" aria-hidden>
          <span className="block h-full rounded-full bg-destructive/60" style={{ width: `${(share * 100).toFixed(1)}%`, marginLeft: 'auto' }} />
        </span>
      </span>
    );
  };

  const cellClassName = (_row: ModelRow, col: number): string | undefined => {
    if (col === amountColIdx) return 'font-bold text-destructive-strong';
    if (col === clientColIdx) return 'font-medium text-foreground';
    return undefined;
  };

  const amountName = amountColIdx !== -1 ? model.columns[amountColIdx]?.name ?? headers[amountColIdx] : '';
  const fig = (v: number) => (amountColIdx !== -1 ? kit.figure(amountColIdx, v) : String(v));

  return (
    <Card className="flex h-full min-h-0 flex-col border-destructive/30">
      <CardHeader className="space-y-0 px-4 pb-2 pt-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <CardTitle className="flex items-center gap-2 text-[15px] leading-snug">
              <Icon className="h-4 w-4 text-destructive" />
              {table.title}
            </CardTitle>
            <CardDescription className="text-xs">{subtitleOf(table.subtitle, merged)}</CardDescription>
          </div>
          <Badge variant="destructive" className="flex shrink-0 items-center gap-1 text-[10px] font-medium">
            <AlertTriangle className="h-3 w-3 text-destructive" />
            {merged
              ? `${flaggedCount} flagged across ${builtPeriods} ${builtPeriods === 1 ? 'period' : 'periods'}`
              : `${flaggedCount} client${flaggedCount === 1 ? '' : 's'} flagged`}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 pb-3">
        {/* Summary strip — the number this report exists to surface, readable before scrolling; once filtered, the rows shown against the whole */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <KpiTile
            label={merged ? 'Client-months flagged' : 'Clients flagged'}
            value={view.filtered ? view.rows.length.toLocaleString('en-IN') : flaggedCount.toLocaleString('en-IN')}
            hint={view.filtered ? `of ${flaggedCount.toLocaleString('en-IN')}` : undefined}
            tone="error"
          />
          {amountColIdx !== -1 && (
            <KpiTile
              // "Total Interest" is already a total; "Shortfall" is not.
              label={/^total\b/i.test(amountName) ? amountName : `Total ${amountName}`}
              value={fig(amountShown ?? amountAll)}
              hint={amountShown !== null ? `of ${fig(amountAll)}` : undefined}
              tone="error"
            />
          )}
          {largest && largest.amount > 0 && (
            <KpiTile label="Largest single exposure" value={fig(largest.amount)} hint={largest.who} tone="error" />
          )}
        </div>

        <TableKitToolbar
          kit={kit}
          searchPlaceholder="Search client, GSTIN…"
          left={(
            <ToggleGroup
              type="single"
              value={sortMode}
              onValueChange={(v) => {
                if (v === 'amount' && amountColIdx !== -1) kit.setSort({ col: amountColIdx, dir: 'desc' });
                else if (v === 'client') kit.setSort({ col: clientColIdx, dir: 'asc' });
              }}
              className="justify-start"
            >
              {amountColIdx !== -1 && (
                <ToggleGroupItem value="amount" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
                  <ArrowDownWideNarrow className="h-3.5 w-3.5" />
                  Sort by amount
                </ToggleGroupItem>
              )}
              <ToggleGroupItem value="client" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
                <ArrowDownAZ className="h-3.5 w-3.5" />
                Sort by client
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        />
        <TableKitTable
          kit={kit}
          renderCell={renderCell}
          cellClassName={cellClassName}
          headClassName={(col) => (col === amountColIdx ? 'text-destructive' : undefined)}
          label={table.title}
          noMatchText="No flagged client matches these filters."
        />
        <TableKitPager kit={kit} />
      </CardContent>
    </Card>
  );
};
