// Renders the "does A match B" report family — GSTR-3B vs GSTR-1, vs 2A/2B,
// PAN-based liability/ITC roll-ups, and similar. The one thing every report
// in this family has in common is a delta column staff actually care about
// (litigation and reconciliation runs on "is the variance zero or not"), so
// this view's whole point is surfacing that column instead of making the
// reader scan every row by eye: it's colored per-cell, summarized above the
// table before anyone scrolls, and filterable down to mismatches only — with
// the grand-total row always pinned and always visible regardless of filters,
// per the same "TOTAL row never disappears" rule the rest of the Reports Hub
// follows (see ReportPreviewDialog.tsx).
import React, { useCallback, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile } from '@/components/gstr9/ui';
import { WS_BTN, WS_TABLE, WS_TH, WS_TD, WS_TR_TOTAL } from '@/components/workspace/theme';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Search, ExternalLink, AlertTriangle, Building2, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';

interface VarianceComparisonViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

// ─────────────────────────── cell/header heuristics ───────────────────────────

const NUMERIC_HEADER_RE = /CGST|SGST|IGST|TOTAL|VALUE|AMOUNT|CLAIMED|LIABILITY|ITC|CESS|FEE|INTEREST|PAYABLE|PENALTY/i;
const VARIANCE_HEADER_RE = /variance|difference|diff\b|delta|mismatch/i;
const STATUS_HEADER_RE = /^status$/i;
const NOT_PULLED_RE = /not\s*pulled|not\s*captured/i;
const VARIANCE_EPSILON = 0.5;

const isNumericHeader = (h: string): boolean => NUMERIC_HEADER_RE.test(h);
const isUrlCell = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v);
const isTotalRow = (row: (string | number)[]): boolean => row.some((c) => String(c).toUpperCase().includes('TOTAL'));
const isNotPulledCell = (v: string | number): boolean => typeof v === 'string' && NOT_PULLED_RE.test(v);

/** Number or null — null covers sentinels ('NOT PULLED', blanks) that aren't real data. */
const parseNumericCell = (v: string | number): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed === '' || NOT_PULLED_RE.test(trimmed) || /^total$/i.test(trimmed)) return null;
  const n = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

const formatCell = (v: string | number): string => {
  if (typeof v !== 'number') return String(v ?? '');
  if (v === 0) return '0';
  const rounded = Math.round(v * 100) / 100;
  return rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

const STATUS_VARIANT = (v: string): 'success' | 'warning' | 'destructive' | 'secondary' => {
  const s = v.toUpperCase();
  if (/ACKNOWLEDG|APPROV|FILED|ACCEPT|PROCESSED/.test(s)) return 'success';
  if (/PENDING|PROCESSING|SUBMIT/.test(s)) return 'warning';
  if (/FAIL|REJECT|DENIED|CANCEL/.test(s)) return 'destructive';
  return 'secondary';
};

/**
 * The delta column is whichever header explicitly names itself as one
 * (Variance/Difference/Delta/Mismatch — checked from the right, since a
 * report can legitimately have an earlier column whose label happens to
 * contain one of those words). Failing that, fall back to the shape a
 * two-source comparison naturally takes: a numeric last column preceded by
 * at least two other numeric ("as per X" / "as per Y") columns.
 */
const detectVarianceColIndex = (headers: string[]): number => {
  for (let i = headers.length - 1; i >= 0; i--) {
    if (VARIANCE_HEADER_RE.test(headers[i])) return i;
  }
  const lastIdx = headers.length - 1;
  if (lastIdx >= 2 && isNumericHeader(headers[lastIdx])) {
    const numericSourceCols = headers.slice(0, lastIdx).filter(isNumericHeader).length;
    if (numericSourceCols >= 2) return lastIdx;
  }
  return -1;
};

/** table.subtitle carries "PAN: <pan>" plus, sometimes, an explicit entity count nearby. */
const parsePanBanner = (subtitle: string): { pan: string; declaredEntityCount: number | null } | null => {
  const panMatch = subtitle.match(/PAN:\s*([A-Za-z0-9]+)/);
  if (!panMatch) return null;
  const countMatch = subtitle.match(/(\d+)\s*(entit(?:y|ies)|gstins?|compan(?:y|ies))/i);
  return { pan: panMatch[1], declaredEntityCount: countMatch ? parseInt(countMatch[1], 10) : null };
};

// ────────────────────────────────── view ──────────────────────────────────

export const VarianceComparisonView: React.FC<VarianceComparisonViewProps> = ({ table, report }) => {
  const [search, setSearch] = useState('');
  const [mismatchesOnly, setMismatchesOnly] = useState(false);

  const varianceIdx = useMemo(() => detectVarianceColIndex(table.headers), [table.headers]);
  const hasVarianceCol = varianceIdx !== -1;
  const statusIdx = useMemo(() => table.headers.findIndex((h) => STATUS_HEADER_RE.test(h)), [table.headers]);
  const panInfo = useMemo(() => parsePanBanner(table.subtitle), [table.subtitle]);

  const totalRows = useMemo(() => table.rows.filter(isTotalRow), [table.rows]);
  const dataRows = useMemo(() => table.rows.filter((r) => !isTotalRow(r)), [table.rows]);

  const isMismatchRow = useCallback(
    (row: (string | number)[]): boolean => {
      if (!hasVarianceCol) return false;
      const v = parseNumericCell(row[varianceIdx]);
      if (v === null) return false; // NOT PULLED / blank — can't be judged a mismatch either way
      return Math.abs(v) > VARIANCE_EPSILON;
    },
    [hasVarianceCol, varianceIdx],
  );

  const mismatchCount = useMemo(
    () => (hasVarianceCol ? dataRows.filter(isMismatchRow).length : 0),
    [dataRows, hasVarianceCol, isMismatchRow],
  );

  const entityCount = panInfo?.declaredEntityCount ?? dataRows.length;

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dataRows.filter((row) => {
      if (mismatchesOnly && !isMismatchRow(row)) return false;
      if (q && !row.some((c) => String(c).toLowerCase().includes(q))) return false;
      return true;
    });
  }, [dataRows, search, mismatchesOnly, isMismatchRow]);

  const renderCell = (cell: string | number, ci: number): React.ReactNode => {
    const header = table.headers[ci] || '';

    if (isUrlCell(cell)) {
      return (
        <a
          href={cell}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" /> View
        </a>
      );
    }

    if (isNotPulledCell(cell)) {
      return (
        <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground border-dashed">
          NOT PULLED
        </Badge>
      );
    }

    if (ci === statusIdx && String(cell).trim() !== '') {
      return (
        <Badge variant={STATUS_VARIANT(String(cell))} className="text-[10px] py-0 font-medium">
          {String(cell)}
        </Badge>
      );
    }

    if (ci === varianceIdx) {
      const v = parseNumericCell(cell);
      if (v === null) return formatCell(cell);
      const isMismatch = Math.abs(v) > VARIANCE_EPSILON;
      return (
        <span className={cn('tabular-nums', isMismatch ? 'text-destructive-strong font-semibold' : 'text-success-strong')}>
          {formatCell(v)}
        </span>
      );
    }

    return formatCell(cell);
  };

  if (table.rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
          <Inbox className="h-5 w-5 text-muted-foreground opacity-60" />
          <p className="text-sm text-muted-foreground max-w-sm">
            No data in this report yet. {table.subtitle}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="space-y-0.5 px-4 pb-3 pt-3">
          <CardTitle className="text-[15px] leading-snug">{table.title}</CardTitle>
          <CardDescription className="text-xs">{table.subtitle}</CardDescription>
          {report.description && (
            <CardDescription className="text-xs text-muted-foreground/80">{report.description}</CardDescription>
          )}
          {panInfo && (
            <div className="flex items-center gap-1.5 pt-1.5">
              <Badge variant="outline" className="gap-1 text-[10px] font-medium">
                <Building2 className="h-3 w-3" />
                PAN: {panInfo.pan}
              </Badge>
              <Badge variant="secondary" className="text-[10px] font-medium">
                {entityCount} {entityCount === 1 ? 'entity' : 'entities'}
              </Badge>
            </div>
          )}
        </CardHeader>

        {hasVarianceCol && (
          <CardContent className="px-4 pb-3 pt-0">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              <TileButton active={!mismatchesOnly} onClick={() => setMismatchesOnly(false)} title="Show every row">
                <KpiTile label="Rows" value={dataRows.length} hint={totalRows.length > 0 ? 'plus the total row' : undefined} />
              </TileButton>
              <TileButton active={mismatchesOnly} onClick={() => setMismatchesOnly((v) => !v)} title="Show mismatched rows only">
                <KpiTile
                  label="Mismatched"
                  value={mismatchCount}
                  hint={`${mismatchCount} of ${dataRows.length} row${dataRows.length === 1 ? '' : 's'} · variance beyond ±${VARIANCE_EPSILON}`}
                  tone={mismatchCount > 0 ? 'error' : 'ok'}
                />
              </TileButton>
            </div>
          </CardContent>
        )}
      </Card>

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

        {hasVarianceCol && (
          <Button
            type="button"
            variant={mismatchesOnly ? 'default' : 'outline'}
            size="sm"
            aria-pressed={mismatchesOnly}
            onClick={() => setMismatchesOnly((v) => !v)}
            className={WS_BTN}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Show mismatches only
          </Button>
        )}

        <span className="text-xs text-muted-foreground ml-auto">
          {search || mismatchesOnly ? `${filteredRows.length} of ${dataRows.length}` : dataRows.length}{' '}
          row{dataRows.length === 1 ? '' : 's'}
          {totalRows.length > 0 ? ' + total' : ''}
        </span>
      </div>

      <div className="rounded-md border bg-card overflow-auto max-h-[65vh]">
        <Table className={WS_TABLE}>
          <TableHeader className="sticky top-0 z-20">
            <TableRow>
              {table.headers.map((h, i) => (
                <TableHead
                  key={i}
                  className={cn(
                    WS_TH, 'h-auto',
                    (isNumericHeader(h) || i === varianceIdx) && 'text-right',
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
                <TableCell colSpan={table.headers.length} className="border-b text-center text-sm text-muted-foreground py-6">
                  No rows match the current search/filter.
                </TableCell>
              </TableRow>
            )}
            {filteredRows.map((row, ri) => (
              <TableRow key={ri} className="hover:bg-muted/30">
                {row.map((cell, ci) => (
                  <TableCell
                    key={ci}
                    className={cn(
                      WS_TD,
                      (isNumericHeader(table.headers[ci] || '') || ci === varianceIdx)
                        ? 'text-right whitespace-nowrap tabular-nums'
                        : 'max-w-[280px]',
                    )}
                  >
                    {renderCell(cell, ci)}
                  </TableCell>
                ))}
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
                  {row.map((cell, ci) => (
                    <TableCell
                      key={ci}
                      className={cn(
                        WS_TD, 'bg-muted',
                        (isNumericHeader(table.headers[ci] || '') || ci === varianceIdx)
                          ? 'text-right whitespace-nowrap tabular-nums'
                          : 'max-w-[280px]',
                      )}
                    >
                      {renderCell(cell, ci)}
                    </TableCell>
                  ))}
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
