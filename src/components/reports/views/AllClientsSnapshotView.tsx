// Renders the "one row per client" family of roster reports — Suspended
// Ledger / Credit Ledger (All Clients), Filing Status Report, Tax Paid under
// RCM vs ITC Claimed, ITC Claimed vs ITC Utilized, Client Master. These can
// run 20-200 rows deep, so the design leans "directory", not "document":
//   1. A header strip (title + subtitle line).
//   2. A summary strip of the grand-total row, shown BEFORE the table so a
//      reader gets the headline numbers without scrolling.
//   3. A client-name search box + a Status filter Select (only rendered when
//      a Status-ish header is present, options built from distinct values
//      actually in the data) + a live "N clients" count.
//   4. A compact, sortable, sticky-header table with the first column
//      (client name) sticky-left on horizontal scroll. Click a header to
//      sort ascending, click again to reverse, a third click clears it.
//   5. The literal grand-total row (if any) pinned at the bottom, always
//      visible, exempt from search/filter/sort.
import React, { useMemo, useState } from 'react';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Search, ExternalLink, ArrowUp, ArrowDown, ArrowUpDown, Inbox, Users } from 'lucide-react';

interface AllClientsSnapshotViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

type Row = (string | number)[];

// ─────────────────────────── generic cell/row helpers ───────────────────────────

const isUrl = (v: string | number): v is string => typeof v === 'string' && /^https?:\/\//.test(v);

const isSentinelCell = (v: string | number): boolean => {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s) return false;
  return s.toUpperCase() === 'NOT PULLED' || /not captured|not pulled/i.test(s);
};

const isGrandTotalRow = (row: Row): boolean =>
  row.some((c) => typeof c === 'string' && c.trim().toUpperCase() === 'TOTAL');

const isNumericHeader = (h: string): boolean =>
  /CGST|SGST|IGST|TOTAL|VALUE|AMOUNT|CLAIMED|LIABILITY|ITC|CESS|FEE|INTEREST|PAYABLE|PENALTY/i.test(h);

const formatCell = (v: string | number): string => {
  if (typeof v !== 'number') return String(v ?? '');
  if (v === 0) return '0';
  const rounded = Math.round(v * 100) / 100;
  return rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

const statusVariant = (v: string): NonNullable<BadgeProps['variant']> => {
  const s = v.toLowerCase();
  if (/fail|reject|denied|cancel/.test(s)) return 'destructive';
  if (/pending|processing/.test(s)) return 'warning';
  if (/filed|approv|acknowledg|processed/.test(s)) return 'success';
  return 'secondary';
};

/** Every string cell in a row, joined and lowercased — used for the name search. */
const rowSearchText = (row: Row): string =>
  row
    .filter((c): c is string => typeof c === 'string')
    .join(' ')
    .toLowerCase();

// ────────────────────────────────── sorting ──────────────────────────────────

type SortDir = 'asc' | 'desc' | null;

interface SortState {
  colIdx: number;
  dir: SortDir;
}

const compareCells = (a: string | number, b: string | number): number => {
  const aNum = typeof a === 'number' ? a : Number(a);
  const bNum = typeof b === 'number' ? b : Number(b);
  const bothNumeric = typeof a === 'number' || (a !== '' && !Number.isNaN(aNum));
  const bothNumericB = typeof b === 'number' || (b !== '' && !Number.isNaN(bNum));
  if (bothNumeric && bothNumericB) return aNum - bNum;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
};

// ────────────────────────────────── component ──────────────────────────────────

export const AllClientsSnapshotView: React.FC<AllClientsSnapshotViewProps> = ({ table, report }) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('__all__');
  const [sort, setSort] = useState<SortState>({ colIdx: -1, dir: null });

  const ReportIcon = report.icon;

  const { dataRows, grandTotalRows } = useMemo(() => {
    const data: Row[] = [];
    const totals: Row[] = [];
    for (const row of table.rows) {
      if (isGrandTotalRow(row)) totals.push(row);
      else data.push(row);
    }
    return { dataRows: data, grandTotalRows: totals };
  }, [table.rows]);

  const statusColIdx = useMemo(() => table.headers.findIndex((h) => /^status$/i.test(h.trim())), [table.headers]);

  const statusOptions = useMemo(() => {
    if (statusColIdx === -1) return [];
    const seen = new Set<string>();
    for (const row of dataRows) {
      const v = row[statusColIdx];
      if (typeof v === 'string' && v.trim() !== '' && !isSentinelCell(v)) seen.add(v.trim());
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [dataRows, statusColIdx]);

  const query = search.trim().toLowerCase();

  const filteredRows = useMemo(() => {
    let rows = dataRows;
    if (statusColIdx !== -1 && statusFilter !== '__all__') {
      rows = rows.filter((r) => String(r[statusColIdx] ?? '').trim() === statusFilter);
    }
    if (query) {
      rows = rows.filter((r) => rowSearchText(r).includes(query));
    }
    return rows;
  }, [dataRows, statusColIdx, statusFilter, query]);

  const sortedRows = useMemo(() => {
    if (sort.colIdx === -1 || !sort.dir) return filteredRows;
    const copy = [...filteredRows];
    copy.sort((a, b) => {
      const cmp = compareCells(a[sort.colIdx] ?? '', b[sort.colIdx] ?? '');
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filteredRows, sort]);

  const handleSort = (colIdx: number) => {
    setSort((prev) => {
      if (prev.colIdx !== colIdx) return { colIdx, dir: 'asc' };
      if (prev.dir === 'asc') return { colIdx, dir: 'desc' };
      return { colIdx: -1, dir: null };
    });
  };

  const totalCount = dataRows.length;
  const shownCount = sortedRows.length;

  if (table.rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Inbox className="h-8 w-8" />
          <p className="text-sm">No data available for this report yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header strip */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ReportIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <CardTitle className="text-base">{table.title}</CardTitle>
          </div>
          {table.subtitle && (
            <p className="text-xs text-muted-foreground pl-6">{table.subtitle}</p>
          )}
        </CardHeader>
      </Card>

      {/* Grand-total summary strip — shown up top so headline figures are readable before scrolling */}
      {grandTotalRows.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              {table.headers.map((h, ci) => {
                const value = grandTotalRows[0]?.[ci];
                if (value === undefined || value === '') return null;
                if (typeof value === 'string' && value.trim().toUpperCase() === 'TOTAL') return null;
                if (!isNumericHeader(h)) return null;
                return (
                  <div key={ci} className="min-w-[110px]">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{h}</div>
                    <div className="text-base font-semibold tabular-nums mt-0.5">{formatCell(value)}</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search + filter + count */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients…"
            className="pl-8 h-8 text-sm"
          />
        </div>

        {statusOptions.length > 0 && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-[170px] text-xs">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              {statusOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <span className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
          <Users className="h-3.5 w-3.5" />
          {query || statusFilter !== '__all__' ? `${shownCount} of ${totalCount}` : totalCount} client
          {totalCount === 1 ? '' : 's'}
        </span>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {sortedRows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No clients match your filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-background">
                  <TableRow>
                    {table.headers.map((h, ci) => {
                      const isSorted = sort.colIdx === ci && sort.dir;
                      const SortIcon = isSorted ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                      return (
                        <TableHead
                          key={ci}
                          onClick={() => handleSort(ci)}
                          className={cn(
                            'px-3 py-2 text-xs font-semibold whitespace-nowrap bg-muted/60 cursor-pointer select-none hover:bg-muted transition-colors',
                            isNumericHeader(h) && 'text-right',
                            ci === 0 && 'sticky left-0 z-30 bg-muted/60',
                          )}
                        >
                          <span className={cn('inline-flex items-center gap-1', isNumericHeader(h) && 'flex-row-reverse')}>
                            {h}
                            <SortIcon
                              className={cn(
                                'h-3 w-3 shrink-0',
                                isSorted ? 'text-foreground' : 'text-muted-foreground/50',
                              )}
                            />
                          </span>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map((row, ri) => (
                    <TableRow key={ri}>
                      {row.map((cell, ci) => {
                        const header = table.headers[ci] || '';
                        if (isUrl(cell)) {
                          return (
                            <TableCell
                              key={ci}
                              className={cn('px-3 py-1.5 text-xs whitespace-nowrap', ci === 0 && 'sticky left-0 z-10 bg-background')}
                            >
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
                        if (ci === statusColIdx && String(cell) !== '' && !isSentinelCell(cell)) {
                          return (
                            <TableCell key={ci} className="px-3 py-1.5 text-xs whitespace-nowrap">
                              <Badge variant={statusVariant(String(cell))} className="text-[10px] py-0">
                                {String(cell)}
                              </Badge>
                            </TableCell>
                          );
                        }
                        if (isSentinelCell(cell)) {
                          return (
                            <TableCell key={ci} className="px-3 py-1.5 text-xs">
                              <Badge
                                variant="outline"
                                className="border-dashed text-muted-foreground font-normal text-[10px]"
                              >
                                Not pulled
                              </Badge>
                            </TableCell>
                          );
                        }
                        return (
                          <TableCell
                            key={ci}
                            className={cn(
                              'px-3 py-1.5 text-xs',
                              isNumericHeader(header)
                                ? 'text-right whitespace-nowrap tabular-nums'
                                : 'max-w-[280px] truncate',
                              ci === 0 && 'sticky left-0 z-10 bg-background font-medium',
                            )}
                          >
                            {formatCell(cell)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pinned grand-total row(s) — always visible, exempt from search/filter/sort */}
      {grandTotalRows.length > 0 && (
        <Card className="border-primary/30 sticky bottom-0 shadow-md">
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableBody>
                {grandTotalRows.map((row, ri) => (
                  <TableRow key={ri} className="bg-primary/5 font-semibold hover:bg-primary/10">
                    {row.map((cell, ci) => {
                      const header = table.headers[ci] || '';
                      return (
                        <TableCell
                          key={ci}
                          className={cn(
                            'px-3 py-2 text-xs',
                            isNumericHeader(header) ? 'text-right whitespace-nowrap tabular-nums' : '',
                            ci === 0 && 'sticky left-0 bg-primary/5',
                          )}
                        >
                          {formatCell(cell)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
