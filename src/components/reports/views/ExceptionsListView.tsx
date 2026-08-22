// ExceptionsListView — the "these are the ones you need to act on" archetype
// for threshold-driven exception reports (Interest & Late Fee scrutiny, Rule
// 42 Short Reversal…). Every report in this family has already done the
// filtering upstream — table.rows holds only the clients that failed some
// check, plus a pinned TOTAL row — so this view's job isn't to re-derive
// which rows are exceptions, it's to make the flagged count and the flagged
// amount impossible to miss, and to read as urgent rather than routine.
import React, { useMemo, useState } from 'react';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Search, CheckCircle2, AlertTriangle, ArrowDownWideNarrow, ArrowDownAZ } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExceptionsListViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

// ─────────────────────── cell/header heuristics (shared contract) ─────────

const isUrlCell = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v);

const isSentinelCell = (v: unknown): boolean => {
  const s = String(v ?? '').trim();
  if (!s) return false;
  if (s.toUpperCase() === 'NOT PULLED') return true;
  return /not captured|not pulled/i.test(s);
};

const isTotalRow = (row: (string | number)[]): boolean =>
  row.some((c) => String(c ?? '').trim().toUpperCase() === 'TOTAL');

const NUMERIC_HEADER_RE = /CGST|SGST|IGST|TOTAL|VALUE|AMOUNT|CLAIMED|LIABILITY|ITC|CESS|FEE|INTEREST|PAYABLE|PENALTY/i;
const isNumericHeader = (h: string): boolean => NUMERIC_HEADER_RE.test(h);

const STATUS_HEADER_RE = /^status$/i;
const STATUS_VARIANT = (v: string): 'success' | 'warning' | 'destructive' | 'secondary' => {
  const s = v.toUpperCase();
  if (/FILED|APPROV|ACKNOWLEDG|ACCEPT|PROCESSED/.test(s)) return 'success';
  if (/PENDING|PROCESSING/.test(s)) return 'warning';
  if (/FAIL|REJECT|DENIED|CANCEL/.test(s)) return 'destructive';
  return 'secondary';
};

const formatCell = (v: string | number): string => {
  if (typeof v !== 'number') return String(v ?? '');
  if (v === 0) return '0';
  const rounded = Math.round(v * 100) / 100;
  return rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

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

const toNumber = (v: string | number | undefined): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const n = Number(v.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

type SortMode = 'amount' | 'client';

export const ExceptionsListView: React.FC<ExceptionsListViewProps> = ({ table, report }) => {
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('amount');

  const headers = table.headers;
  const Icon = report.icon || AlertTriangle;

  const { dataRows, totalRows } = useMemo(() => {
    const data: (string | number)[][] = [];
    const totals: (string | number)[][] = [];
    for (const row of table.rows) {
      (isTotalRow(row) ? totals : data).push(row);
    }
    return { dataRows: data, totalRows: totals };
  }, [table.rows]);

  const amountColIdx = useMemo(() => findAmountColIdx(headers, dataRows), [headers, dataRows]);
  const clientColIdx = useMemo(() => findClientColIdx(headers), [headers]);
  const statusColIdx = useMemo(() => headers.findIndex((h) => STATUS_HEADER_RE.test(h.trim())), [headers]);

  const flaggedCount = dataRows.length;

  // Prefer the pinned TOTAL row's own figure over a client-side re-sum — it's
  // the number that was actually computed against, not a recomputation of it.
  const totalAmount = useMemo(() => {
    if (amountColIdx === -1) return null;
    if (totalRows.length > 0) {
      return totalRows.reduce((sum, r) => sum + toNumber(r[amountColIdx]), 0);
    }
    return dataRows.reduce((sum, r) => sum + toNumber(r[amountColIdx]), 0);
  }, [dataRows, totalRows, amountColIdx]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? dataRows.filter((row) => row.some((c) => String(c ?? '').toLowerCase().includes(q)))
      : dataRows;

    return [...rows].sort((a, b) => {
      if (sortMode === 'client') {
        return String(a[clientColIdx] ?? '').localeCompare(String(b[clientColIdx] ?? ''));
      }
      if (amountColIdx === -1) return 0;
      return toNumber(b[amountColIdx]) - toNumber(a[amountColIdx]);
    });
  }, [dataRows, search, sortMode, clientColIdx, amountColIdx]);

  // ── Calm empty state — nothing flagged this period, no table to show ──────
  if (flaggedCount === 0) {
    return (
      <Card>
        <CardHeader className="gap-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {table.title}
          </CardTitle>
          <CardDescription>{table.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-14 text-center">
            <CheckCircle2 className="h-8 w-8 text-success" />
            <p className="text-sm font-medium text-foreground">No exceptions this period</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Every client cleared this check for the selected period — nothing needs action.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="h-4 w-4 text-destructive" />
              {table.title}
            </CardTitle>
            <CardDescription>{table.subtitle}</CardDescription>
          </div>
          <Badge variant="destructive" className="flex shrink-0 items-center gap-1.5 px-3 py-1 text-xs font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" />
            {flaggedCount} client{flaggedCount === 1 ? '' : 's'} flagged
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary strip — the number this report exists to surface, readable before scrolling */}
        {amountColIdx !== -1 && totalAmount !== null && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total {headers[amountColIdx]}
            </span>
            <span className="text-xl font-bold tabular-nums text-destructive">{formatCell(totalAmount)}</span>
          </div>
        )}

        {/* Filters + sort */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] max-w-sm flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search client, GSTIN…"
              className="h-8 pl-8 text-sm"
            />
          </div>

          <ToggleGroup
            type="single"
            value={sortMode}
            onValueChange={(v) => { if (v === 'amount' || v === 'client') setSortMode(v); }}
            className="justify-start"
          >
            <ToggleGroupItem value="amount" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
              <ArrowDownWideNarrow className="h-3.5 w-3.5" />
              Sort by amount
            </ToggleGroupItem>
            <ToggleGroupItem value="client" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
              <ArrowDownAZ className="h-3.5 w-3.5" />
              Sort by client
            </ToggleGroupItem>
          </ToggleGroup>

          <span className="text-xs text-muted-foreground">
            {search ? `${visibleRows.length} of ${dataRows.length}` : dataRows.length} shown
          </span>
        </div>

        {/* Table */}
        <div className="max-h-[65vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                {headers.map((h, i) => (
                  <TableHead
                    key={i}
                    className={cn(
                      'whitespace-nowrap bg-muted/60 px-3 py-2 text-xs font-semibold',
                      (isNumericHeader(h) || i === amountColIdx) && 'text-right',
                      i === amountColIdx && 'text-destructive',
                    )}
                  >
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>

            <TableBody>
              {visibleRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={headers.length} className="py-10 text-center text-sm text-muted-foreground">
                    No rows match &quot;{search}&quot;.
                  </TableCell>
                </TableRow>
              )}

              {visibleRows.map((row, ri) => (
                <TableRow key={ri}>
                  {row.map((cell, ci) => {
                    const header = headers[ci] || '';

                    if (isUrlCell(cell)) {
                      return (
                        <TableCell key={ci} className="whitespace-nowrap px-3 py-1.5 text-xs">
                          <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
                            <a href={cell as string} target="_blank" rel="noopener noreferrer">View</a>
                          </Button>
                        </TableCell>
                      );
                    }

                    if (ci === statusColIdx && String(cell ?? '').trim() && !isSentinelCell(cell)) {
                      return (
                        <TableCell key={ci} className="whitespace-nowrap px-3 py-1.5 text-xs">
                          <Badge variant={STATUS_VARIANT(String(cell))} className="py-0 text-[10px]">
                            {String(cell)}
                          </Badge>
                        </TableCell>
                      );
                    }

                    if (isSentinelCell(cell)) {
                      return (
                        <TableCell key={ci} className="whitespace-nowrap px-3 py-1.5 text-xs">
                          <Badge variant="outline" className="border-dashed py-0 text-[10px] text-muted-foreground">
                            {String(cell)}
                          </Badge>
                        </TableCell>
                      );
                    }

                    if (ci === amountColIdx) {
                      return (
                        <TableCell
                          key={ci}
                          className="whitespace-nowrap px-3 py-1.5 text-right text-sm font-bold tabular-nums text-destructive"
                        >
                          {formatCell(cell)}
                        </TableCell>
                      );
                    }

                    return (
                      <TableCell
                        key={ci}
                        className={cn(
                          'px-3 py-1.5 text-xs',
                          isNumericHeader(header) || typeof cell === 'number'
                            ? 'whitespace-nowrap text-right tabular-nums'
                            : 'max-w-[280px]',
                          ci === clientColIdx && 'font-medium text-foreground',
                        )}
                      >
                        {formatCell(cell)}
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
                      'border-t-2 border-primary/20 bg-primary/5 font-semibold hover:bg-primary/10',
                      ri === totalRows.length - 1 && 'sticky bottom-0 z-10',
                    )}
                  >
                    {row.map((cell, ci) => {
                      const header = headers[ci] || '';
                      return (
                        <TableCell
                          key={ci}
                          className={cn(
                            'bg-primary/5 px-3 py-1.5 text-xs',
                            isNumericHeader(header) || ci === amountColIdx || typeof cell === 'number'
                              ? 'whitespace-nowrap text-right tabular-nums'
                              : '',
                            ci === amountColIdx && 'text-sm font-bold text-destructive',
                          )}
                        >
                          {formatCell(cell)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            )}
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
