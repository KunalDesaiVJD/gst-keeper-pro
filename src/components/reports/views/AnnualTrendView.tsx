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
import React, { useMemo, useState } from 'react';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile } from '@/components/gstr9/ui';
import { WS_BTN, WS_TABLE, WS_TH, WS_TD, WS_TR_TOTAL } from '@/components/workspace/theme';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';
import { LineChart, Line, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  TrendingUp, Search, ExternalLink, Inbox, EyeOff, Eye, BarChart3,
} from 'lucide-react';

interface AnnualTrendViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

// ─────────────────────────── cell/header heuristics ───────────────────────────

const NUMERIC_HEADER_RE = /CGST|SGST|IGST|TOTAL|VALUE|AMOUNT|CLAIMED|LIABILITY|ITC|CESS|FEE|INTEREST|PAYABLE|PENALTY/i;
const MONTH_HEADER_RE = /month|period/i;
const STATUS_HEADER_RE = /^status$/i;
const NOT_PULLED_RE = /not\s*pulled|not\s*captured/i;

const isUrlCell = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v);
const isSentinelCell = (v: unknown): boolean => typeof v === 'string' && NOT_PULLED_RE.test(v.trim());
const isTotalRow = (row: (string | number)[]): boolean =>
  row.some((c) => typeof c === 'string' && /total/i.test(c));

const STATUS_VARIANT = (v: string): 'success' | 'warning' | 'destructive' | 'secondary' => {
  const s = v.toUpperCase();
  if (/ACKNOWLEDG|APPROV|SANCTION|FILED|ACCEPT|PROCESSED/.test(s)) return 'success';
  if (/PENDING|PROCESSING|SUBMIT/.test(s)) return 'warning';
  if (/FAIL|REJECT|DENIED|CANCEL/.test(s)) return 'destructive';
  return 'secondary';
};

const toNum = (v: string | number): number | null => {
  if (isSentinelCell(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const trimmed = String(v ?? '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

const formatNumber = (v: string | number): string => {
  const n = toNum(v);
  if (n === null) return String(v ?? '');
  if (n === 0) return '0';
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

/** Compact Indian-style axis label: 1,50,00,000 -> 1.5Cr, 3,20,000 -> 3.2L. */
const formatCompact = (v: number): string => {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(abs % 1e7 === 0 ? 0 : 1)}Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(abs % 1e5 === 0 ? 0 : 1)}L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(abs % 1e3 === 0 ? 0 : 1)}K`;
  return `${sign}${Math.round(abs)}`;
};

/**
 * The "headline" numeric column: checked in tiers ('Total' beats 'Closing'
 * beats 'Liability', per the design brief), and within a tier the *last*
 * matching header wins — these reports read left-to-right toward a running
 * or final figure (e.g. "Total Liability" ... "Total Payable (as filed)",
 * or "Opening Balance" ... "Closing Balance"), so the rightmost match is the
 * bottom-line number, not an intermediate component of it. Falls back to the
 * first numeric-looking column if nothing matches any tier.
 */
const detectHeadlineColIndex = (headers: string[]): number => {
  const tiers = [/total/i, /closing/i, /liability/i];
  for (const re of tiers) {
    let found = -1;
    for (let i = 0; i < headers.length; i++) {
      if (re.test(headers[i])) found = i;
    }
    if (found !== -1) return found;
  }
  for (let i = 0; i < headers.length; i++) {
    if (NUMERIC_HEADER_RE.test(headers[i])) return i;
  }
  return -1;
};

interface ChartPoint {
  month: string;
  value: number | null;
  gapMarker: number | null;
  notPulled: boolean;
}

interface NotPulledDotProps {
  cx?: number;
  cy?: number;
  payload?: ChartPoint;
}

const NotPulledDot: React.FC<NotPulledDotProps> = ({ cx, cy, payload }) => {
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

interface TrendTooltipProps {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
  label?: string;
  headlineLabel: string;
}

const TrendTooltip: React.FC<TrendTooltipProps> = ({ active, payload, label, headlineLabel }) => {
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
          <span className="font-mono font-medium tabular-nums">{formatNumber(point.value ?? 0)}</span>
        </div>
      )}
    </div>
  );
};

// ────────────────────────────────── view ──────────────────────────────────

export const AnnualTrendView: React.FC<AnnualTrendViewProps> = ({ table, report }) => {
  const { headers, rows } = table;
  const [search, setSearch] = useState('');
  const [hideNotPulled, setHideNotPulled] = useState(false);

  const monthColIdx = useMemo(() => {
    const idx = headers.findIndex((h) => MONTH_HEADER_RE.test(h));
    return idx !== -1 ? idx : 0;
  }, [headers]);

  const headlineColIdx = useMemo(() => detectHeadlineColIndex(headers), [headers]);
  const statusColIdx = useMemo(() => headers.findIndex((h) => STATUS_HEADER_RE.test(h)), [headers]);

  const isNumericCol = useMemo(
    () => headers.map((h, i) => i !== monthColIdx && NUMERIC_HEADER_RE.test(h)),
    [headers, monthColIdx],
  );

  const { dataRows, totalRows } = useMemo(() => {
    const data: (string | number)[][] = [];
    const totals: (string | number)[][] = [];
    rows.forEach((row) => (isTotalRow(row) ? totals : data).push(row));
    return { dataRows: data, totalRows: totals };
  }, [rows]);

  const headlineHeader = headlineColIdx !== -1 ? headers[headlineColIdx] : '';

  // ── Chart data: one point per month, gapped (not zeroed) where NOT PULLED ──
  const chartData: ChartPoint[] = useMemo(() => {
    if (headlineColIdx === -1) return [];
    return dataRows.map((row) => {
      const monthLabel = String(row[monthColIdx] ?? '');
      const cell = row[headlineColIdx];
      const notPulled = isSentinelCell(cell);
      const value = notPulled ? null : toNum(cell);
      return { month: monthLabel, value, gapMarker: notPulled ? 0 : null, notPulled };
    });
  }, [dataRows, headlineColIdx, monthColIdx]);

  const pulledCount = useMemo(() => chartData.filter((p) => !p.notPulled).length, [chartData]);
  const hasGaps = pulledCount < chartData.length;

  const chartConfig = useMemo<ChartConfig>(
    () => ({ value: { label: headlineHeader || 'Value', color: 'hsl(var(--primary))' } }),
    [headlineHeader],
  );

  // ── Summary strip: TOTAL row's numeric columns, or a computed fallback ──
  const summaryStats = useMemo(() => {
    const numericIdxs = headers.map((_, i) => i).filter((i) => isNumericCol[i]);
    const source = totalRows[0];
    return numericIdxs.map((i) => {
      let value: number;
      if (source) {
        value = toNum(source[i]) ?? 0;
      } else {
        value = dataRows.reduce((sum, row) => sum + (toNum(row[i]) ?? 0), 0);
      }
      return { header: headers[i], value, isHeadline: i === headlineColIdx };
    });
  }, [headers, isNumericCol, totalRows, dataRows, headlineColIdx]);

  // ── Table filtering (search + optional "hide not pulled") ──
  const filteredDataRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dataRows.filter((row) => {
      if (hideNotPulled && headlineColIdx !== -1 && isSentinelCell(row[headlineColIdx])) return false;
      if (q && !row.some((c) => String(c ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [dataRows, search, hideNotPulled, headlineColIdx]);

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader className="space-y-0.5 px-4 pb-2 pt-3">
          <CardTitle className="flex items-center gap-2 text-[15px] leading-snug">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            {table.title || report.title}
          </CardTitle>
          {table.subtitle && <CardDescription className="whitespace-pre-line text-xs">{table.subtitle}</CardDescription>}
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center text-muted-foreground">
            <Inbox className="h-5 w-5 opacity-60" />
            <p className="text-sm">No months on record for this financial year yet.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="space-y-0.5 px-4 py-3">
          <CardTitle className="flex items-center gap-2 text-[15px] leading-snug">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            {table.title || report.title}
          </CardTitle>
          {table.subtitle && <CardDescription className="whitespace-pre-line text-xs">{table.subtitle}</CardDescription>}
        </CardHeader>
      </Card>

      {/* Totals strip — always the TOTAL row's own figures, unaffected by search/filter below */}
      {summaryStats.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {summaryStats.map((s) => (
            <KpiTile key={s.header} label={s.header} value={formatNumber(s.value)} />
          ))}
          {headlineColIdx !== -1 && hasGaps ? (
            <TileButton active={hideNotPulled} onClick={() => setHideNotPulled((v) => !v)} title={hideNotPulled ? 'Show all months' : 'Hide not-pulled months'}>
              <KpiTile
                label="Months Pulled"
                value={`${pulledCount} / ${chartData.length}`}
                tone={pulledCount < chartData.length ? 'warn' : 'neutral'}
                hint={totalRows[0] ? 'Full FY, unfiltered' : undefined}
              />
            </TileButton>
          ) : (
            <KpiTile
              label="Months Pulled"
              value={`${pulledCount} / ${chartData.length}`}
              tone={pulledCount < chartData.length ? 'warn' : 'neutral'}
              hint={totalRows[0] ? 'Full FY, unfiltered' : undefined}
            />
          )}
        </div>
      )}

      {/* Trend chart — the one archetype where a real chart earns its place */}
      {headlineColIdx !== -1 && chartData.length > 0 && (
        <Card>
          <CardHeader className="space-y-0 px-4 pb-1 pt-3">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <BarChart3 className="h-3.5 w-3.5" />
              {headlineHeader} — trend across the year
            </CardTitle>
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
                  domain={[0, 'auto']}
                  tickFormatter={formatCompact}
                />
                <ChartTooltip content={<TrendTooltip headlineLabel={headlineHeader} />} />
                <Line
                  dataKey="value"
                  stroke="var(--color-value)"
                  strokeWidth={2}
                  connectNulls={false}
                  dot={{ r: 3, strokeWidth: 0, fill: 'var(--color-value)' }}
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
            {hasGaps && (
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-full border border-dashed border-muted-foreground" />
                Dashed marker = month not yet pulled from the portal (not a zero).
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this report…"
            className="pl-8 h-8 text-xs"
          />
        </div>

        {headlineColIdx !== -1 && hasGaps && (
          <Button
            type="button"
            variant={hideNotPulled ? 'default' : 'outline'}
            size="sm"
            aria-pressed={hideNotPulled}
            onClick={() => setHideNotPulled((v) => !v)}
            className={WS_BTN}
          >
            {hideNotPulled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {hideNotPulled ? 'Show all months' : 'Hide not-pulled months'}
          </Button>
        )}

        <span className="text-xs text-muted-foreground ml-auto">
          {search || hideNotPulled ? `${filteredDataRows.length} of ${dataRows.length}` : dataRows.length}{' '}
          month{dataRows.length === 1 ? '' : 's'}
          {totalRows.length > 0 ? ' + total' : ''}
        </span>
      </div>

      {/* Monthly table — TOTAL row pinned bottom, never filtered out */}
      <div className="rounded-md border bg-card max-h-[60vh] overflow-auto">
        <Table className={WS_TABLE}>
          <TableHeader className="sticky top-0 z-20">
            <TableRow>
              {headers.map((h, i) => (
                <TableHead
                  key={i}
                  className={cn(
                    WS_TH, 'h-auto',
                    isNumericCol[i] && 'text-right',
                    i === headlineColIdx && 'border-l',
                  )}
                >
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody>
            {filteredDataRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={headers.length} className="border-b text-center text-sm text-muted-foreground py-6">
                  No months match the current search/filter.
                </TableCell>
              </TableRow>
            )}

            {filteredDataRows.map((row, ri) => (
              <TableRow key={ri} className="hover:bg-muted/30">
                {row.map((cell, ci) => {
                  const numeric = isNumericCol[ci];
                  const isHeadline = ci === headlineColIdx;

                  if (isUrlCell(cell)) {
                    return (
                      <TableCell key={ci} className={cn(WS_TD, 'whitespace-nowrap')}>
                        <a
                          href={cell}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" /> View
                        </a>
                      </TableCell>
                    );
                  }

                  if (isSentinelCell(cell)) {
                    return (
                      <TableCell key={ci} className={cn(WS_TD, 'whitespace-nowrap')}>
                        <Badge variant="outline" className="border-dashed text-muted-foreground text-[10px] py-0 font-normal">
                          Not pulled
                        </Badge>
                      </TableCell>
                    );
                  }

                  if (ci === statusColIdx && String(cell ?? '') !== '') {
                    return (
                      <TableCell key={ci} className={cn(WS_TD, 'whitespace-nowrap')}>
                        <Badge variant={STATUS_VARIANT(String(cell))} className="text-[10px] py-0 font-medium">{String(cell)}</Badge>
                      </TableCell>
                    );
                  }

                  return (
                    <TableCell
                      key={ci}
                      className={cn(
                        WS_TD,
                        numeric ? 'text-right whitespace-nowrap tabular-nums' : 'max-w-[240px]',
                        isHeadline && 'border-l font-medium text-foreground',
                      )}
                    >
                      {numeric ? formatNumber(cell) : String(cell ?? '')}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>

          {totalRows.length > 0 && (
            <TableBody>
              {totalRows.map((row, ri) => (
                <TableRow
                  key={`total-${ri}`}
                  className={cn(
                    WS_TR_TOTAL, 'hover:bg-muted',
                    ri === totalRows.length - 1 && 'sticky bottom-0 z-10',
                  )}
                >
                  {row.map((cell, ci) => {
                    const numeric = isNumericCol[ci];
                    const display = String(cell ?? '') === '' ? '' : numeric ? formatNumber(cell) : String(cell);
                    return (
                      <TableCell
                        key={ci}
                        className={cn(
                          WS_TD, 'bg-muted',
                          numeric && 'text-right whitespace-nowrap tabular-nums',
                          ci === headlineColIdx && 'border-l',
                        )}
                      >
                        {display}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          )}
        </Table>
      </div>
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
