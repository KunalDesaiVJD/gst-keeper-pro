// Bank-statement-style register for the transactional ledger reports (Credit
// Ledger Transaction Detail, Liability Ledger, Cash Ledger). Unlike a plain
// report grid, a ledger has direction (Debit/Credit) and a running Balance
// that the reader cross-checks against the portal — so this view adds a
// Debit/Credit toggle, per-row directional tinting, and a totals strip that
// updates with whatever is currently filtered, while keeping the final
// TOTAL/NET row pinned and out of reach of search/filter (it must always
// read the same as the portal's own closing figure).
import React, { useMemo, useState } from 'react';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import {
  Search, ExternalLink, ArrowUpCircle, ArrowDownCircle, Scale, Landmark, Inbox, BookText,
} from 'lucide-react';

interface LedgerRegisterViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

type TypeFilter = 'all' | 'debit' | 'credit';

const NUMERIC_HEADER_RE = /CGST|SGST|IGST|TOTAL|VALUE|AMOUNT|CLAIMED|LIABILITY|ITC|CESS|FEE|INTEREST|PAYABLE|PENALTY/i;

const isUrlCell = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v);

// 'NOT PULLED' sentinel, or any cell that just says data wasn't captured yet.
const isSentinelCell = (v: unknown): boolean => typeof v === 'string' && /not captured|not pulled/i.test(v);

// The grand-total / NET row: pinned, bold, and never subject to search/filter.
// Ledger reports close with either a literal 'TOTAL' cell or, for the Credit
// Ledger transaction detail, a 'NET (Credit − Debit)' label — both mean the
// same thing here: this row is a running summary, not a transaction.
const isSummaryRow = (row: (string | number)[]): boolean =>
  row.some((c) => typeof c === 'string' && (/\btotal\b/i.test(c) || /^net\b/i.test(c.trim())));

const STATUS_VARIANT = (v: string): 'success' | 'warning' | 'destructive' | 'secondary' => {
  const s = v.toUpperCase();
  if (/ACKNOWLEDG|APPROV|SANCTION|FILED|ACCEPT|PROCESSED/.test(s)) return 'success';
  if (/PENDING|PROCESSING|SUBMIT/.test(s)) return 'warning';
  if (/FAIL|REJECT|DENIED|CANCEL/.test(s)) return 'destructive';
  return 'secondary';
};

const toNum = (v: string | number): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const formatNumber = (v: string | number): string => {
  const n = toNum(v);
  if (n === 0) return '0';
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

type Tone = 'rose' | 'emerald' | 'neutral';

const TONE_TEXT: Record<Tone, string> = {
  rose: 'text-rose-600 dark:text-rose-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  neutral: 'text-foreground',
};

const StatTile: React.FC<{
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  sub?: string;
}> = ({ label, value, icon: Icon, tone, sub }) => (
  <div className="flex items-start gap-2.5 min-w-0">
    <div className={cn('mt-0.5 shrink-0 rounded-md border bg-background/70 p-1.5', TONE_TEXT[tone])}>
      <Icon className="h-4 w-4" />
    </div>
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium truncate">{label}</p>
      <p className={cn('text-base font-semibold tabular-nums truncate', TONE_TEXT[tone])}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  </div>
);

export const LedgerRegisterView: React.FC<LedgerRegisterViewProps> = ({ table, report }) => {
  const { headers, rows } = table;

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');

  const typeColIdx = useMemo(() => headers.findIndex((h) => /^type$/i.test(h.trim())), [headers]);
  const balanceColIdx = useMemo(() => headers.findIndex((h) => /^balance$/i.test(h.trim())), [headers]);
  const statusColIdx = useMemo(() => headers.findIndex((h) => /^status$/i.test(h.trim())), [headers]);

  const isNumericCol = useMemo(
    () => headers.map((h, i) => i === balanceColIdx || NUMERIC_HEADER_RE.test(h)),
    [headers, balanceColIdx],
  );

  // Money columns that represent a transaction's own value (IGST/CGST/SGST/
  // Cess etc.) — Balance is excluded, it's a running total, not a flow amount.
  const amountColIdxs = useMemo(
    () => headers.map((_, i) => i).filter((i) => isNumericCol[i] && i !== balanceColIdx),
    [headers, isNumericCol, balanceColIdx],
  );

  const { dataRows, summaryRows } = useMemo(() => {
    const data: { row: (string | number)[]; key: number }[] = [];
    const summary: { row: (string | number)[]; key: number }[] = [];
    rows.forEach((row, key) => {
      (isSummaryRow(row) ? summary : data).push({ row, key });
    });
    return { dataRows: data, summaryRows: summary };
  }, [rows]);

  const filteredDataRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dataRows.filter(({ row }) => {
      if (typeColIdx !== -1 && typeFilter !== 'all') {
        const t = String(row[typeColIdx] ?? '').trim().toLowerCase();
        if (t !== typeFilter) return false;
      }
      if (q && !row.some((c) => String(c ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [dataRows, typeColIdx, typeFilter, search]);

  const stats = useMemo(() => {
    let totalDebit = 0;
    let totalCredit = 0;
    let totalAll = 0;
    filteredDataRows.forEach(({ row }) => {
      const rowAmount = amountColIdxs.reduce((sum, i) => sum + Math.abs(toNum(row[i])), 0);
      totalAll += rowAmount;
      if (typeColIdx !== -1) {
        const t = String(row[typeColIdx] ?? '').trim().toLowerCase();
        if (t === 'debit') totalDebit += rowAmount;
        else if (t === 'credit') totalCredit += rowAmount;
      }
    });
    return { totalDebit, totalCredit, net: totalCredit - totalDebit, totalAll };
  }, [filteredDataRows, amountColIdxs, typeColIdx]);

  const closingBalance = useMemo(() => {
    if (balanceColIdx === -1) return null;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      if (isSummaryRow(row)) continue;
      const v = row[balanceColIdx];
      if (v !== undefined && v !== '') return toNum(v);
    }
    return null;
  }, [rows, balanceColIdx]);

  const hasType = typeColIdx !== -1;

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BookText className="h-5 w-5 text-muted-foreground" />
            {table.title || report.title}
          </CardTitle>
          {table.subtitle && <CardDescription>{table.subtitle}</CardDescription>}
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-center text-muted-foreground">
            <Inbox className="h-8 w-8" />
            <p className="text-sm">No ledger entries on record for this period.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <BookText className="h-5 w-5 text-muted-foreground" />
            {table.title || report.title}
          </CardTitle>
          {table.subtitle && <CardDescription className="whitespace-pre-line">{table.subtitle}</CardDescription>}
        </CardHeader>
      </Card>

      {/* Totals strip — reflects whatever is currently filtered below */}
      <Card className="border-primary/15 bg-primary/5">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {hasType ? (
              <>
                <StatTile label="Total Debit" value={formatNumber(stats.totalDebit)} icon={ArrowUpCircle} tone="rose" />
                <StatTile label="Total Credit" value={formatNumber(stats.totalCredit)} icon={ArrowDownCircle} tone="emerald" />
                <StatTile
                  label="Net (Credit − Debit)"
                  value={formatNumber(stats.net)}
                  icon={Scale}
                  tone={stats.net >= 0 ? 'emerald' : 'rose'}
                />
              </>
            ) : (
              <StatTile label="Total" value={formatNumber(stats.totalAll)} icon={Scale} tone="neutral" />
            )}
            {closingBalance !== null && (
              <StatTile
                label="Closing Balance"
                value={formatNumber(closingBalance)}
                icon={Landmark}
                tone="neutral"
                sub="Full ledger, unfiltered"
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {hasType && (
          <ToggleGroup
            type="single"
            value={typeFilter}
            onValueChange={(v) => { if (v) setTypeFilter(v as TypeFilter); }}
            className="justify-start rounded-md border p-0.5"
          >
            <ToggleGroupItem value="all" className="text-xs px-3 h-7 data-[state=on]:bg-background">All</ToggleGroupItem>
            <ToggleGroupItem value="debit" className="text-xs px-3 h-7 data-[state=on]:bg-background data-[state=on]:text-rose-600 dark:data-[state=on]:text-rose-400">
              Debit
            </ToggleGroupItem>
            <ToggleGroupItem value="credit" className="text-xs px-3 h-7 data-[state=on]:bg-background data-[state=on]:text-emerald-600 dark:data-[state=on]:text-emerald-400">
              Credit
            </ToggleGroupItem>
          </ToggleGroup>
        )}

        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search description, date…"
            className="pl-8 h-8 text-sm"
          />
        </div>

        <span className="text-xs text-muted-foreground shrink-0">
          {filteredDataRows.length === dataRows.length
            ? `${dataRows.length} entr${dataRows.length === 1 ? 'y' : 'ies'}`
            : `${filteredDataRows.length} of ${dataRows.length} entries`}
        </span>
      </div>

      {/* Register */}
      <div className="rounded-md border max-h-[65vh] overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              {headers.map((h, i) => (
                <TableHead
                  key={i}
                  className={cn(
                    'px-3 py-2 text-xs font-semibold whitespace-nowrap bg-muted/60',
                    isNumericCol[i] && 'text-right',
                    i === balanceColIdx && 'border-l border-border',
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
                <TableCell colSpan={headers.length} className="text-center text-sm text-muted-foreground py-10">
                  No entries match the current filters.
                </TableCell>
              </TableRow>
            )}

            {filteredDataRows.map(({ row, key }) => {
              const typeVal = typeColIdx !== -1 ? String(row[typeColIdx] ?? '').trim().toLowerCase() : '';
              const isDebit = typeVal === 'debit';
              const isCredit = typeVal === 'credit';
              const amountTint = isDebit ? 'text-rose-600 dark:text-rose-400' : isCredit ? 'text-emerald-600 dark:text-emerald-400' : '';

              return (
                <TableRow key={key}>
                  {row.map((cell, ci) => {
                    const isBalance = ci === balanceColIdx;
                    const numeric = isNumericCol[ci];

                    if (isUrlCell(cell)) {
                      return (
                        <TableCell key={ci} className="px-3 py-2 text-xs whitespace-nowrap">
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
                        <TableCell key={ci} className="px-3 py-2 text-xs whitespace-nowrap">
                          <Badge variant="outline" className="border-dashed text-muted-foreground text-[10px] py-0 font-normal">
                            Not pulled
                          </Badge>
                        </TableCell>
                      );
                    }

                    if (ci === statusColIdx && String(cell ?? '') !== '') {
                      return (
                        <TableCell key={ci} className="px-3 py-2 text-xs whitespace-nowrap">
                          <Badge variant={STATUS_VARIANT(String(cell))} className="text-[10px] py-0">{String(cell)}</Badge>
                        </TableCell>
                      );
                    }

                    if (ci === typeColIdx && String(cell ?? '') !== '') {
                      return (
                        <TableCell key={ci} className="px-3 py-2 text-xs whitespace-nowrap">
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px] py-0 gap-1 font-medium',
                              isDebit && 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-400',
                              isCredit && 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400',
                            )}
                          >
                            {isDebit && <ArrowUpCircle className="h-3 w-3" />}
                            {isCredit && <ArrowDownCircle className="h-3 w-3" />}
                            {String(cell)}
                          </Badge>
                        </TableCell>
                      );
                    }

                    return (
                      <TableCell
                        key={ci}
                        className={cn(
                          'px-3 py-2 text-xs',
                          numeric ? 'text-right whitespace-nowrap tabular-nums' : 'max-w-[320px]',
                          isBalance && 'border-l border-border font-semibold text-foreground',
                          !isBalance && numeric && amountTint,
                        )}
                      >
                        {numeric ? formatNumber(cell) : String(cell ?? '')}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}

            {/* Grand-total / NET row — always visible, pinned below the filtered data, never filtered itself */}
            {summaryRows.map(({ row, key }) => (
              <TableRow key={`summary-${key}`} className="bg-primary/5 font-semibold hover:bg-primary/10 border-t-2 border-primary/20">
                {row.map((cell, ci) => {
                  const isBalance = ci === balanceColIdx;
                  const numeric = isNumericCol[ci];
                  const display = String(cell ?? '') === '' ? '' : numeric ? formatNumber(cell) : String(cell);
                  return (
                    <TableCell
                      key={ci}
                      className={cn(
                        'px-3 py-2 text-xs',
                        numeric && 'text-right whitespace-nowrap tabular-nums',
                        isBalance && 'border-l border-border',
                      )}
                    >
                      {display}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
