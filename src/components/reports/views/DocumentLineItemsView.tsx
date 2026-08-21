// Archetype: DocumentLineItemsView
//
// Renders the highest-row-count report shape in the Reports Hub — rate-wise /
// supplier-wise / customer-wise summaries and the raw document-level GSTR-2A/2B
// portal pulls (these can run into hundreds of invoice rows). Generic over
// table.headers/table.rows only — no fixed column indices, no new fetching.
//
// Three things this archetype needs that a small report doesn't:
//   1. A search box that actually filters (supplier name/GSTIN/invoice no,
//      or anything else in the row) without ever hiding the TOTAL row.
//   2. An optional group-by (Rate / Supplier Name / Supplier GSTIN — whichever
//      of those columns is actually present) that sorts rows under a sticky
//      per-group subtotal row, off by default so the flat view stays the norm.
//   3. A summary strip of the grand totals, visible before anyone scrolls,
//      and a grand-total row pinned to the bottom of the scroll area always.
import React, { useMemo, useState } from 'react';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { REPORT_STATUS_META } from '@/lib/reportRegistry';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Search, X, ExternalLink, Inbox, Layers, List as ListIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DocumentLineItemsViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

type Row = (string | number)[];

// ─────────────────────────── shared cell rules ────────────────────────────

const NUMERIC_HEADER_RE = /CGST|SGST|IGST|TOTAL|VALUE|AMOUNT|CLAIMED|LIABILITY|ITC|CESS|FEE|INTEREST|PAYABLE|PENALTY/i;
const STATUS_HEADER_RE = /^status$/i;

const isUrlCell = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v);

const isSentinelCell = (v: unknown): boolean => {
  if (typeof v !== 'string') return false;
  const s = v.trim().toUpperCase();
  return s === 'NOT PULLED' || /NOT CAPTURED|NOT PULLED/i.test(v);
};

const isTotalRow = (row: Row): boolean => row.some((c) => String(c).trim().toUpperCase() === 'TOTAL');

const STATUS_VARIANT = (v: string): 'success' | 'warning' | 'destructive' | 'secondary' => {
  const s = v.toUpperCase();
  if (/ACKNOWLEDG|APPROV|FILED|ACCEPT|PROCESSED/.test(s)) return 'success';
  if (/PENDING|PROCESSING|SUBMIT/.test(s)) return 'warning';
  if (/FAIL|REJECT|DENIED|CANCEL/.test(s)) return 'destructive';
  return 'secondary';
};

const formatNumber = (v: number): string => {
  if (v === 0) return '0';
  const rounded = Math.round(v * 100) / 100;
  return rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

// The candidate dimensions a group-by toggle may offer, in display order.
// Only the ones actually present in table.headers show up as a toggle option.
const GROUP_MATCHERS: { label: string; test: (h: string) => boolean }[] = [
  { label: 'Rate', test: (h) => /^rate\b/i.test(h.trim()) },
  { label: 'Supplier Name', test: (h) => /supplier\s*name/i.test(h) },
  { label: 'Supplier GSTIN', test: (h) => /supplier\s*gstin/i.test(h) },
];

interface GroupOption {
  label: string;
  idx: number;
}

interface RenderGroup {
  key: string;
  idx: number; // column index this group's value belongs to (== groupBy)
  rows: Row[];
  subtotals: Map<number, number>; // numeric column idx -> sum
}

export const DocumentLineItemsView: React.FC<DocumentLineItemsViewProps> = ({ table, report }) => {
  const { headers, rows } = table;
  const [search, setSearch] = useState('');
  const [groupByIdx, setGroupByIdx] = useState<number | null>(null);

  const numericIdxs = useMemo(
    () => headers.map((h, i) => (NUMERIC_HEADER_RE.test(h) ? i : -1)).filter((i) => i !== -1),
    [headers],
  );

  const statusIdx = useMemo(() => headers.findIndex((h) => STATUS_HEADER_RE.test(h.trim())), [headers]);

  const groupOptions = useMemo<GroupOption[]>(() => {
    const opts: GroupOption[] = [];
    const seen = new Set<number>();
    for (const m of GROUP_MATCHERS) {
      const idx = headers.findIndex((h) => m.test(h));
      if (idx !== -1 && !seen.has(idx)) {
        seen.add(idx);
        opts.push({ label: m.label, idx });
      }
    }
    return opts;
  }, [headers]);

  // Split the grand-total row (if any) out from the data rows once — it
  // never participates in search, grouping, or the scrolling body; it's
  // pinned to the bottom of the table separately.
  const totalRow = useMemo(() => rows.find(isTotalRow) ?? null, [rows]);
  const dataRows = useMemo(() => rows.filter((r) => !isTotalRow(r)), [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return dataRows;
    return dataRows.filter((row) => row.some((c) => String(c).toLowerCase().includes(q)));
  }, [dataRows, search]);

  const sumNumeric = (list: Row[], idx: number): number =>
    list.reduce((acc, r) => (typeof r[idx] === 'number' ? acc + (r[idx] as number) : acc), 0);

  // Grand totals for the summary strip: prefer the report's own TOTAL row
  // (it may include figures computed beyond a simple column sum); fall back
  // to summing the data rows when no TOTAL row was supplied.
  const summaryValues = useMemo(() => {
    const map = new Map<number, number>();
    for (const idx of numericIdxs) {
      if (totalRow && typeof totalRow[idx] === 'number') map.set(idx, totalRow[idx] as number);
      else map.set(idx, sumNumeric(dataRows, idx));
    }
    return map;
  }, [numericIdxs, totalRow, dataRows]);

  const groups = useMemo<RenderGroup[] | null>(() => {
    if (groupByIdx === null) return null;
    const map = new Map<string, Row[]>();
    for (const row of filteredRows) {
      const key = String(row[groupByIdx] ?? '');
      const arr = map.get(key);
      if (arr) arr.push(row);
      else map.set(key, [row]);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      const na = parseFloat(a.replace(/[^0-9.-]/g, ''));
      const nb = parseFloat(b.replace(/[^0-9.-]/g, ''));
      if (!Number.isNaN(na) && !Number.isNaN(nb) && a.trim() !== '' && b.trim() !== '') return na - nb;
      return a.localeCompare(b);
    });
    return keys.map((key) => {
      const groupRows = map.get(key) as Row[];
      const subtotals = new Map<number, number>();
      for (const idx of numericIdxs) subtotals.set(idx, sumNumeric(groupRows, idx));
      return { key, idx: groupByIdx, rows: groupRows, subtotals };
    });
  }, [groupByIdx, filteredRows, numericIdxs]);

  const renderCell = (cell: string | number, colIdx: number, header: string) => {
    if (isUrlCell(cell)) {
      return (
        <a
          href={cell}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline whitespace-nowrap"
        >
          <ExternalLink className="h-3 w-3" /> View
        </a>
      );
    }
    if (isSentinelCell(cell)) {
      return (
        <Badge variant="outline" className="border-dashed text-muted-foreground font-normal text-[10px] py-0">
          Not Pulled
        </Badge>
      );
    }
    if (colIdx === statusIdx && String(cell).trim() !== '') {
      return (
        <Badge variant={STATUS_VARIANT(String(cell))} className="text-[10px] py-0">
          {String(cell)}
        </Badge>
      );
    }
    if (NUMERIC_HEADER_RE.test(header) && typeof cell === 'number') {
      return formatNumber(cell);
    }
    return String(cell ?? '');
  };

  const subtitleParts = table.subtitle.split('|').map((s) => s.trim()).filter(Boolean);

  const hasAnyData = rows.length > 0;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <report.icon className="h-5 w-5 text-primary shrink-0" />
              <CardTitle className="text-xl">{table.title || report.title}</CardTitle>
              <Badge variant={REPORT_STATUS_META[report.status].badgeVariant} className="text-[10px]">
                {REPORT_STATUS_META[report.status].shortLabel}
              </Badge>
            </div>
            {subtitleParts.length > 0 && (
              <CardDescription className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
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

      <CardContent className="flex flex-col gap-4">
        {!hasAnyData && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <Inbox className="h-8 w-8" />
            <p className="text-sm">No rows in this report for the selected client and period.</p>
          </div>
        )}

        {hasAnyData && (
          <>
            {/* Summary strip — grand totals, readable before scrolling */}
            {numericIdxs.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <div className="rounded-md border bg-muted/40 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Rows</p>
                  <p className="text-base font-semibold tabular-nums">{dataRows.length.toLocaleString('en-IN')}</p>
                </div>
                {numericIdxs.map((idx) => (
                  <div key={idx} className="rounded-md border bg-primary/5 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground truncate" title={headers[idx]}>
                      {headers[idx]}
                    </p>
                    <p className="text-base font-semibold tabular-nums">{formatNumber(summaryValues.get(idx) ?? 0)}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Controls: search + group-by */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[220px] max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search supplier, GSTIN, invoice no…"
                  className="pl-8 pr-8 h-9 text-sm"
                />
                {search && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-0.5 top-1/2 -translate-y-1/2 h-8 w-8"
                    onClick={() => setSearch('')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              <span className="text-xs text-muted-foreground shrink-0">
                {search ? `${filteredRows.length} of ${dataRows.length}` : `${dataRows.length}`} row
                {dataRows.length === 1 ? '' : 's'}
              </span>

              <div className="flex-1" />

              {groupOptions.length > 0 && (
                <ToggleGroup
                  type="single"
                  size="sm"
                  value={groupByIdx === null ? '' : String(groupByIdx)}
                  onValueChange={(val) => setGroupByIdx(val === '' || val === undefined ? null : Number(val))}
                  className="justify-end"
                >
                  <ToggleGroupItem value="" aria-label="Flat view" className="gap-1.5 text-xs px-2.5">
                    <ListIcon className="h-3.5 w-3.5" /> Flat
                  </ToggleGroupItem>
                  {groupOptions.map((opt) => (
                    <ToggleGroupItem key={opt.idx} value={String(opt.idx)} aria-label={`Group by ${opt.label}`} className="gap-1.5 text-xs px-2.5">
                      <Layers className="h-3.5 w-3.5" /> {opt.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
            </div>

            {/* Table */}
            <div className="border rounded-md overflow-auto max-h-[65vh]">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-background">
                  <TableRow>
                    {headers.map((h, i) => (
                      <TableHead
                        key={i}
                        className={cn(
                          'h-10 px-3 py-2 text-xs font-semibold whitespace-nowrap bg-muted/60',
                          NUMERIC_HEADER_RE.test(h) && 'text-right',
                        )}
                      >
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filteredRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={headers.length} className="text-center text-sm text-muted-foreground py-10">
                        No rows match "{search}".
                      </TableCell>
                    </TableRow>
                  )}

                  {groups === null &&
                    filteredRows.map((row, ri) => (
                      <TableRow key={ri}>
                        {row.map((cell, ci) => (
                          <TableCell
                            key={ci}
                            className={cn(
                              'px-3 py-1.5 text-xs',
                              NUMERIC_HEADER_RE.test(headers[ci]) ? 'text-right whitespace-nowrap tabular-nums' : 'max-w-[280px] truncate',
                            )}
                            title={typeof row[ci] === 'string' ? (row[ci] as string) : undefined}
                          >
                            {renderCell(cell, ci, headers[ci])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}

                  {groups !== null &&
                    groups.map((group) => (
                      <React.Fragment key={group.key}>
                        <TableRow className="sticky top-10 z-[5] bg-muted/70 backdrop-blur-sm border-y">
                          {headers.map((h, ci) => {
                            if (ci === group.idx) {
                              return (
                                <TableCell key={ci} className="px-3 py-1.5 text-xs font-semibold whitespace-nowrap">
                                  {group.key || '(blank)'}{' '}
                                  <span className="font-normal text-muted-foreground">
                                    ({group.rows.length} doc{group.rows.length === 1 ? '' : 's'})
                                  </span>
                                </TableCell>
                              );
                            }
                            if (numericIdxs.includes(ci)) {
                              return (
                                <TableCell key={ci} className="px-3 py-1.5 text-xs font-semibold text-right whitespace-nowrap tabular-nums">
                                  {formatNumber(group.subtotals.get(ci) ?? 0)}
                                </TableCell>
                              );
                            }
                            return <TableCell key={ci} className="px-3 py-1.5 text-xs" />;
                          })}
                        </TableRow>
                        {group.rows.map((row, ri) => (
                          <TableRow key={`${group.key}-${ri}`}>
                            {row.map((cell, ci) => (
                              <TableCell
                                key={ci}
                                className={cn(
                                  'px-3 py-1.5 text-xs',
                                  NUMERIC_HEADER_RE.test(headers[ci]) ? 'text-right whitespace-nowrap tabular-nums' : 'max-w-[280px] truncate',
                                )}
                                title={typeof row[ci] === 'string' ? (row[ci] as string) : undefined}
                              >
                                {renderCell(cell, ci, headers[ci])}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </React.Fragment>
                    ))}
                </TableBody>

                {totalRow && (
                  <TableFooter className="sticky bottom-0 z-10 bg-muted/90 backdrop-blur-sm">
                    <TableRow className="hover:bg-transparent">
                      {totalRow.map((cell, ci) => (
                        <TableCell
                          key={ci}
                          className={cn(
                            'px-3 py-2 text-xs font-bold',
                            NUMERIC_HEADER_RE.test(headers[ci]) ? 'text-right whitespace-nowrap tabular-nums' : '',
                          )}
                        >
                          {typeof cell === 'number' ? formatNumber(cell) : String(cell)}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default DocumentLineItemsView;
