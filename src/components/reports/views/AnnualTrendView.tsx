// Renders the "one client, twelve months of a financial year" report family —
// Suspended/Credit Ledger closing balances, the Credit Reversal & Reclaim
// statement, RCM Liability/ITC, the GSTR-3B Annual Summary, and the Credit &
// Liability Statement. These are the one archetype in the Reports Hub where a
// real trend chart earns its place (every other report is a point-in-time
// grid; this one is inherently "how did this number move across the year").
//
// The chart's whole design problem is that a month can be genuinely ₹0 *or*
// simply never pulled from the portal yet ('NOT PULLED') — and those two
// have to look different, or the CA reading it mistakes "we haven't fetched
// this" for "the client owed nothing that month". A Line chart with
// connectNulls={false} already breaks the line at a NOT PULLED month instead
// of dragging it down to zero; on top of that we plot a second, invisible-line
// series that only has points at the NOT PULLED months, rendered as a small
// dashed/open marker — so a real ₹0 shows as a solid dot sitting on the
// baseline, while "not fetched" shows as a hollow dashed ring, never a
// silently-dropped gap and never a fabricated zero.
//
// The monthly table is drawn by the table kit (./tableKit): sort by any
// figure, filter the months (or any figure's range), group them by quarter
// with subtotals (a Quarter column the view adds, hidden until asked for),
// and "Excel (filtered)" / "PDF (filtered)" of exactly what is shown. The
// TOTAL and the summary tiles follow the filter; the chart keeps the whole
// year for context and marks the months the table shows. A month counts as
// not pulled when any of its cells says so, not only the charted one (the
// GSTR-3B summary writes it under its first figure and leaves the rest blank).
// Each report builds its whole year from any month of it, so several months
// of one year picked are that year once, not once per month (oneBlockPerYear).
import React, { useMemo, useState } from 'react';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { REPORT_STATUS_META } from '@/lib/reportRegistry';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';
import { LineChart, Line, CartesianGrid, XAxis, YAxis } from 'recharts';
import { TrendingUp, Inbox, EyeOff, BarChart3 } from 'lucide-react';
import { TableKitPager, TableKitTable, TableKitToolbar, useTableKit } from './tableKit';
import { headlineColumn, isNotPulledRow, monthColumn, oneBlockPerYear, withQuarterColumn, withoutQuarterNote } from './annualTrendRules';
import { shortKpiLabels, splitSubtitle } from './varianceRules';

interface AnnualTrendViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

const PULLED_ONLY_ID = 'pulled-only';

/** Compact Indian-style axis label: 1,50,00,000 -> 1.5Cr, 3,20,000 -> 3.2L. */
const formatCompact = (v: number): string => {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(abs % 1e7 === 0 ? 0 : 1)}Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(abs % 1e5 === 0 ? 0 : 1)}L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(abs % 1e3 === 0 ? 0 : 1)}K`;
  return `${sign}${Math.round(abs)}`;
};

interface ChartPoint {
  month: string;
  value: number | null;
  gapMarker: number | null;
  notPulled: boolean;
  /** In the table as filtered (always true when nothing is filtered). */
  shown: boolean;
}

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: ChartPoint;
}

const NotPulledDot: React.FC<DotProps> = ({ cx, cy, payload }) => {
  if (!payload?.notPulled || cx === undefined || cy === undefined) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill="hsl(var(--muted))"
      stroke="hsl(var(--muted-foreground))"
      strokeWidth={1.5}
      strokeDasharray="2 1.5"
    />
  );
};

/** A month's dot: solid when the table shows it, a faint ring when a filter leaves it out. */
const MonthDot: React.FC<DotProps> = ({ cx, cy, payload }) => {
  if (cx === undefined || cy === undefined || !payload || payload.value === null) return null;
  return payload.shown
    ? <circle cx={cx} cy={cy} r={3.5} fill="var(--color-value)" />
    : <circle cx={cx} cy={cy} r={3} fill="hsl(var(--card))" stroke="var(--color-value)" strokeOpacity={0.45} strokeWidth={1.2} />;
};

interface TrendTooltipProps {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
  label?: string;
  headlineLabel: string;
  format: (v: number) => string;
}

const TrendTooltip: React.FC<TrendTooltipProps> = ({ active, payload, label, headlineLabel, format }) => {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl min-w-[9rem]">
      <div className="font-medium mb-1">{label}</div>
      {point.notPulled ? (
        <div className="text-muted-foreground italic">Not pulled from portal</div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground truncate">{headlineLabel}</span>
          <span className="font-mono font-medium tabular-nums">{format(point.value ?? 0)}</span>
        </div>
      )}
      {!point.shown && <div className="mt-0.5 text-[11px] text-muted-foreground">Left out of the table by the filters</div>}
    </div>
  );
};

// ────────────────────────────────── view ──────────────────────────────────

export const AnnualTrendView: React.FC<AnnualTrendViewProps> = ({ table, report }) => {
  const monthCol = useMemo(() => monthColumn(table.headers), [table.headers]);
  // Several months of one financial year merged are that year once per month
  // picked (each report builds its whole year from any month): one block per year.
  const yearly = useMemo(() => oneBlockPerYear(table, monthCol).table, [table, monthCol]);
  const { table: kitTable, quarterCol } = useMemo(() => withQuarterColumn(yearly, monthCol), [yearly, monthCol]);
  const kit = useTableKit(kitTable, {
    resetKey: report.key,
    initialHidden: quarterCol >= 0 ? [quarterCol] : [],
    // A year's months group by quarter (and a merge by its period); one month per group says nothing.
    groupable: (c) => c.index === quarterCol || c.virtual,
    // The Quarter is the view's helper, not the report's: searched, its "(Apr
    // to Jun)" would make "Jun 2026" match April and May too.
    searchable: (c) => c.index !== quarterCol,
    rowNoun: ['month', 'months'],
    transformExport: (t) => shortKpiLabels(withoutQuarterNote(t)),
  });
  const { model, view, state, isFigure } = kit;

  const headlineCol = useMemo(() => headlineColumn(
    kitTable.headers, isFigure,
    (c) => model.data.some((r) => typeof r.cells[c] === 'number' && Math.abs(r.cells[c] as number) >= 0.005),
  ), [kitTable.headers, isFigure, model]);
  // The figures the chart can follow: the ones the TOTAL adds up, else every figure column.
  const chartable = useMemo(
    () => (model.summable.length ? model.summable : model.columns.filter((c) => isFigure(c.index)).map((c) => c.index)),
    [model, isFigure],
  );
  // The reviewer's pick of figure, for this report and column set only.
  const chartKey = `${report.key}\u0001${kitTable.headers.join('\u0001')}`;
  const [chartPick, setChartPick] = useState<{ key: string; col: number } | null>(null);
  const chartCol = chartPick?.key === chartKey && chartable.includes(chartPick.col) ? chartPick.col : headlineCol;
  const chartHeader = chartCol >= 0 ? model.columns[chartCol].name : '';

  // Months not yet pulled, over the whole year (a merge repeats a month once per period).
  const monthsAll = useMemo(() => {
    const seen = new Map<string, boolean>();
    for (const r of model.data) {
      const m = String(r.cells[monthCol] ?? '').trim();
      if (m && !seen.has(m)) seen.set(m, isNotPulledRow(r.cells));
    }
    return seen;
  }, [model, monthCol]);
  const monthCount = monthsAll.size;
  const pulledCount = [...monthsAll.values()].filter((np) => !np).length;
  const hasGaps = pulledCount < monthCount;
  const pulledOnly = !!state.custom?.some((c) => c.id === PULLED_ONLY_ID);
  const setPulledOnly = (on: boolean) => kit.setCustomFilter(PULLED_ONLY_ID, on
    ? { label: 'Months not pulled left out', test: (row) => !isNotPulledRow(row.cells) }
    : null);

  // ── Chart data: one point per month, gapped (not zeroed) where NOT PULLED ──
  const chartData: ChartPoint[] = useMemo(() => {
    if (chartCol < 0) return [];
    const shownMonths = view.filtered ? new Set(view.rows.map((r) => String(r.cells[monthCol] ?? '').trim())) : null;
    const seen = new Set<string>();
    const out: ChartPoint[] = [];
    for (const r of model.data) {
      const month = String(r.cells[monthCol] ?? '').trim();
      if (!month || seen.has(month)) continue;
      seen.add(month);
      const notPulled = isNotPulledRow(r.cells);
      const cell = r.cells[chartCol];
      const value = notPulled || typeof cell !== 'number' || !Number.isFinite(cell) ? null : cell;
      out.push({ month, value, gapMarker: notPulled ? 0 : null, notPulled, shown: shownMonths ? shownMonths.has(month) : true });
    }
    return out;
  }, [model, view, monthCol, chartCol]);
  const shownOnChart = chartData.filter((p) => p.shown).length;

  const chartConfig = useMemo<ChartConfig>(
    () => ({ value: { label: chartHeader || 'Value', color: 'hsl(var(--primary))' } }),
    [chartHeader],
  );

  const { parts, notes } = splitSubtitle(yearly.subtitle, model.merged);
  const header = (
    <CardHeader className="space-y-0 px-4 py-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 shrink-0 text-primary" />
        <CardTitle className="text-[15px] leading-snug">{table.title || report.title}</CardTitle>
        <Badge variant={REPORT_STATUS_META[report.status].badgeVariant} className="text-[10px] font-medium">
          {REPORT_STATUS_META[report.status].shortLabel}
        </Badge>
      </div>
      {parts.length > 0 && (
        <CardDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {parts.map((part, i) => (
            <span key={i} className="flex items-center gap-2">
              {i > 0 && <span className="text-muted-foreground/40">•</span>}
              {part}
            </span>
          ))}
        </CardDescription>
      )}
      {notes.length > 0 && <p className="mt-1 max-w-[1100px] text-[11px] leading-snug text-muted-foreground">{notes.join(' ')}</p>}
    </CardHeader>
  );

  if (table.rows.length === 0) {
    return (
      <Card>
        {header}
        <CardContent className="px-4 pb-3">
          <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center text-muted-foreground">
            <Inbox className="h-5 w-5 opacity-60" />
            <p className="text-sm">No months on record for this financial year yet.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const monthsTile = (
    <KpiTile
      label="Months Pulled"
      value={`${pulledCount} / ${monthCount}`}
      tone={hasGaps ? 'warn' : 'neutral'}
      hint={hasGaps ? `${monthCount - pulledCount} not pulled yet` : 'every month on record'}
    />
  );

  return (
    <div className="space-y-3">
      <Card>{header}</Card>

      {/* Totals strip — the TOTAL row's own figures, and once filtered, the months shown against the year */}
      {(kit.totals.length > 0 || monthCount > 0) && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
          {kit.totals.map((s) => (
            <KpiTile
              key={s.col}
              label={model.columns[s.col].name}
              value={kit.figure(s.col, s.shown ?? s.total)}
              hint={s.shown === null ? undefined : Math.abs(s.total) < 0.005 ? 'nil for the year' : `of ${kit.figure(s.col, s.total)} for the year`}
            />
          ))}
          {hasGaps ? (
            <TileButton active={pulledOnly} onClick={() => setPulledOnly(!pulledOnly)} title={pulledOnly ? 'Show all months' : 'Hide not-pulled months'}>
              {monthsTile}
            </TileButton>
          ) : monthsTile}
        </div>
      )}

      {/* Trend chart — the one archetype where a real chart earns its place */}
      {chartCol !== -1 && chartData.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 px-4 pb-1 pt-2.5">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <BarChart3 className="h-3.5 w-3.5" />
              {chartHeader} — trend across the year
            </CardTitle>
            {chartable.length > 1 && (
              <Select value={String(chartCol)} onValueChange={(v) => setChartPick({ key: chartKey, col: Number(v) })}>
                <SelectTrigger className="h-7 w-[220px] text-xs" aria-label="Figure charted">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {chartable.map((c) => (
                    <SelectItem key={c} value={String(c)} className="text-xs">Chart {model.columns[c].name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <ChartContainer config={chartConfig} className="aspect-auto h-[240px] w-full">
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#ccc" strokeDasharray="3 3" />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={44}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  width={48}
                  domain={[(min: number) => Math.min(0, min), 'auto']}
                  tickFormatter={formatCompact}
                />
                <ChartTooltip content={<TrendTooltip headlineLabel={chartHeader} format={(v) => kit.figure(chartCol, v)} />} />
                <Line
                  dataKey="value"
                  stroke="var(--color-value)"
                  strokeWidth={2}
                  connectNulls={false}
                  dot={<MonthDot />}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="gapMarker"
                  stroke="transparent"
                  strokeWidth={0}
                  connectNulls={false}
                  dot={<NotPulledDot />}
                  activeDot={false}
                  isAnimationActive={false}
                  legendType="none"
                />
              </LineChart>
            </ChartContainer>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
              {hasGaps && (
                <p className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full border border-dashed border-muted-foreground" />
                  Dashed marker = month not yet pulled from the portal (not a zero).
                </p>
              )}
              {view.filtered && (
                <p className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                  Solid dot = one of the {shownOnChart} {shownOnChart === 1 ? 'month' : 'months'} the table shows; a faint ring is filtered out.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly table — the kit's filters, sort and quarterly groups; the TOTAL pinned under it */}
      <Card>
        <CardContent className="flex flex-col gap-2.5 px-4 py-3">
          <TableKitToolbar
            kit={kit}
            searchPlaceholder="Search month, figure…"
            left={hasGaps && (
              <Button
                type="button"
                variant={pulledOnly ? 'default' : 'outline'}
                size="sm"
                aria-pressed={pulledOnly}
                onClick={() => setPulledOnly(!pulledOnly)}
                className={WS_BTN}
              >
                <EyeOff className="h-3.5 w-3.5" />
                Hide not-pulled months
              </Button>
            )}
          />
          <TableKitTable
            kit={kit}
            label={table.title}
            columnClassName={(c) => (c === headlineCol ? 'border-l-2 border-l-foreground/20' : undefined)}
            cellClassName={(_row, c) => (c === headlineCol ? 'font-medium text-foreground' : undefined)}
            rowClassName={(row) => (isNotPulledRow(row.cells) ? 'text-muted-foreground' : undefined)}
            containerClassName="max-h-[60vh] rounded-md border bg-card"
            noMatchText="No months match these filters."
          />
          <TableKitPager kit={kit} />
        </CardContent>
      </Card>
    </div>
  );
};

const TileButton: React.FC<{ active: boolean; onClick: () => void; title: string; children: React.ReactNode }> = ({ active, onClick, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-pressed={active}
    className={cn(
      'rounded-lg text-left transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:h-full',
      active && 'ring-2 ring-primary/60',
    )}
  >
    {children}
  </button>
);
