// Renders the "matched document by document, every difference with its reason"
// report family: GSTR-2A vs GSTR-2B today, 2A vs 8A and 8A vs 2B next. Generic
// over ReportTable: it finds its columns by exact header names ('Status',
// 'Reason', 'Total Tax Difference (…)') and reads the summary by reason from
// table.summary, so another pair of sources reuses it unchanged. Clicking a
// summary line filters the list to that status and reason; the TOTAL rows are
// found by an exact 'TOTAL' cell (never a substring, since reasons and supplier
// names are free text) and stay pinned at the bottom.
import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile } from '@/components/gstr9/ui';
import { WS_BTN, WS_TABLE, WS_TH, WS_TD, WS_TR_TOTAL, WS_TR_HEADING } from '@/components/workspace/theme';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { AlertTriangle, Columns3, Inbox, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';

interface ReasonReconciliationViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

type Row = (string | number)[];

const NUMERIC_HEADER_RE = /Value|IGST|CGST|SGST|Cess|Tax|^Documents$/i;
const DIFF_HEADER_RE = /^Total Tax Difference \(/;
const isTotalCell = (c: unknown) => /^TOTAL( \(.+\))?$/.test(String(c ?? ''));
const isTotalRow = (r: Row) => isTotalCell(r[1]);
const isPeriodRow = (r: Row) => /^— .+ —$/.test(String(r[0] ?? '')) && r.slice(1).every((c) => c === '');

const fmt = (v: string | number): string => {
  if (typeof v !== 'number') return String(v ?? '');
  if (v === 0) return '0';
  return (Math.round(v * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

const statusVariant = (s: string): 'success' | 'warning' | 'destructive' | 'secondary' | 'info' => {
  if (/^Matched/i.test(s)) return 'success';
  if (/^Only in/i.test(s)) return 'warning';
  if (/differ/i.test(s)) return 'destructive';
  return 'secondary';
};

/** A document row belongs to a summary line when its status matches and its reason starts with the line's label. */
const reasonMatches = (cell: unknown, label: string) => {
  const s = String(cell ?? '');
  return s === label || s.startsWith(`${label}:`) || s.startsWith(`${label} (`);
};

export const ReasonReconciliationView: React.FC<ReasonReconciliationViewProps> = ({ table, report }) => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [line, setLine] = useState<{ status: string; reason: string } | null>(null);
  const [allColumns, setAllColumns] = useState(false);

  const statusIdx = table.headers.indexOf('Status');
  const reasonIdx = table.headers.indexOf('Reason');
  const diffIdx = table.headers.findIndex((h) => DIFF_HEADER_RE.test(h));
  const shown = useMemo(
    () => (allColumns || !table.pdfColumns?.length ? table.headers.map((_, i) => i) : table.pdfColumns),
    [allColumns, table.headers, table.pdfColumns],
  );

  const totals = useMemo(() => table.rows.filter(isTotalRow), [table.rows]);
  const body = useMemo(() => table.rows.filter((r) => !isTotalRow(r)), [table.rows]);
  const docs = useMemo(() => body.filter((r) => !isPeriodRow(r)), [body]);

  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of docs) { const s = String(r[statusIdx] ?? ''); m.set(s, (m.get(s) ?? 0) + 1); }
    return [...m.entries()];
  }, [docs, statusIdx]);

  const matches = (r: Row): boolean => {
    if (line && !(r[statusIdx] === line.status && reasonMatches(r[reasonIdx], line.reason))) return false;
    if (status && r[statusIdx] !== status) return false;
    const q = search.trim().toLowerCase();
    return !q || r.some((c) => String(c).toLowerCase().includes(q));
  };
  const filtering = !!(line || status || search.trim());

  // Keep a period's heading only when a row under it is still shown.
  const visible = useMemo(() => {
    if (!filtering) return body;
    const out: Row[] = [];
    let heading: Row | null = null;
    for (const r of body) {
      if (isPeriodRow(r)) { heading = r; continue; }
      if (!matches(r)) continue;
      if (heading) { out.push(heading); heading = null; }
      out.push(r);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, filtering, line, status, search]);

  const sum = table.summary;
  const compared = docs.filter((r) => !/^(Matched|Not compared)$/.test(String(r[statusIdx] ?? ''))).length;
  const diffTotal = totals.reduce((s, r) => s + (typeof r[diffIdx] === 'number' ? (r[diffIdx] as number) : 0), 0);

  const numeric = (i: number) => NUMERIC_HEADER_RE.test(table.headers[i] || '');
  const cell = (r: Row, i: number): React.ReactNode => {
    const v = r[i];
    if (i === statusIdx && v !== '' && !isTotalRow(r) && !isPeriodRow(r)) {
      return <Badge variant={statusVariant(String(v))} className="whitespace-nowrap py-0 text-[10px] font-medium">{String(v)}</Badge>;
    }
    if (i === diffIdx && typeof v === 'number') {
      return <span className={cn('tabular-nums', Math.abs(v) > 0.5 ? 'font-semibold text-destructive-strong' : 'text-success-strong')}>{fmt(v)}</span>;
    }
    return fmt(v);
  };

  if (docs.length === 0 && !sum) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
          <Inbox className="h-5 w-5 text-muted-foreground opacity-60" />
          <p className="max-w-sm text-sm text-muted-foreground">No documents in this report. {table.subtitle}</p>
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
          {report.description && <CardDescription className="text-xs text-muted-foreground/80">{report.description}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-3 pt-0">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            <KpiTile label="Documents" value={docs.length} />
            <KpiTile label="Need a look" value={compared} hint="only on one side, or figures differ" tone={compared ? 'warn' : 'ok'} />
            <KpiTile label="Tax difference" value={fmt(diffTotal)} tone={Math.abs(diffTotal) > 0.5 ? 'error' : 'ok'} />
          </div>

          {sum && (
            <div className="overflow-auto rounded-md border">
              <Table className={WS_TABLE}>
                <TableHeader>
                  <TableRow>
                    {sum.headers.map((h, i) => (
                      <TableHead key={i} className={cn(WS_TH, 'h-auto', NUMERIC_HEADER_RE.test(h) && 'text-right')}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sum.rows.map((r, ri) => {
                    const total = isTotalRow(r);
                    const period = isPeriodRow(r);
                    const active = !!line && line.status === r[0] && line.reason === r[1];
                    const clickable = !total && !period;
                    if (period) {
                      return (
                        <TableRow key={ri} className={WS_TR_HEADING}>
                          <TableCell colSpan={sum.headers.length} className={WS_TD}>{String(r[0])}</TableCell>
                        </TableRow>
                      );
                    }
                    return (
                      <TableRow
                        key={ri}
                        className={cn(total && WS_TR_TOTAL, clickable && 'cursor-pointer hover:bg-muted/40', active && 'bg-primary/10')}
                        onClick={clickable ? () => { setStatus(null); setLine(active ? null : { status: String(r[0]), reason: String(r[1]) }); } : undefined}
                        title={clickable ? (active ? 'Show every document' : 'Show only these documents') : undefined}
                      >
                        {r.map((c, ci) => (
                          <TableCell
                            key={ci}
                            className={cn(WS_TD, NUMERIC_HEADER_RE.test(sum.headers[ci] || '') ? 'whitespace-nowrap text-right tabular-nums' : 'max-w-[320px]')}
                          >
                            {ci === 0 && clickable ? <Badge variant={statusVariant(String(c))} className="whitespace-nowrap py-0 text-[10px] font-medium">{String(c)}</Badge> : fmt(c)}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {sum?.notes && sum.notes.length > 0 && (
            <ul className="space-y-1 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-foreground">
              {sum.notes.map((n, i) => (
                <li key={i} className="flex gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" size="sm" variant={!status && !line ? 'default' : 'outline'} className={WS_BTN} onClick={() => { setStatus(null); setLine(null); }}>
            All <span className="tabular-nums opacity-80">{docs.length}</span>
          </Button>
          {statusCounts.map(([s, n]) => (
            <Button key={s} type="button" size="sm" variant={status === s ? 'default' : 'outline'} className={WS_BTN} aria-pressed={status === s}
              onClick={() => { setLine(null); setStatus(status === s ? null : s); }}>
              {s} <span className="tabular-nums opacity-80">{n}</span>
            </Button>
          ))}
        </div>
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search supplier, number, reason…" className="h-8 pl-8 text-xs" />
        </div>
        {line && (
          <Button type="button" size="sm" variant="outline" className={WS_BTN} onClick={() => setLine(null)}>
            <X className="h-3.5 w-3.5" /> {line.status}: {line.reason}
          </Button>
        )}
        {!!table.pdfColumns?.length && (
          <Button type="button" size="sm" variant="outline" className={WS_BTN} aria-pressed={allColumns} onClick={() => setAllColumns((v) => !v)}>
            <Columns3 className="h-3.5 w-3.5" /> {allColumns ? 'Fewer columns' : 'Show all columns'}
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {filtering ? `${visible.filter((r) => !isPeriodRow(r)).length} of ${docs.length}` : docs.length} document{docs.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="max-h-[65vh] overflow-auto rounded-md border bg-card">
        <Table className={WS_TABLE}>
          <TableHeader className="sticky top-0 z-20">
            <TableRow>
              {shown.map((i) => (
                <TableHead key={i} className={cn(WS_TH, 'h-auto', numeric(i) && 'text-right')}>{table.headers[i]}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={shown.length} className="border-b py-6 text-center text-sm text-muted-foreground">No documents match the current filter.</TableCell>
              </TableRow>
            )}
            {visible.map((r, ri) => (isPeriodRow(r) ? (
              <TableRow key={ri} className={WS_TR_HEADING}>
                <TableCell colSpan={shown.length} className={WS_TD}>{String(r[0])}</TableCell>
              </TableRow>
            ) : (
              <TableRow key={ri} className="hover:bg-muted/30">
                {shown.map((i) => (
                  <TableCell key={i} className={cn(WS_TD, numeric(i) ? 'whitespace-nowrap text-right tabular-nums' : i === reasonIdx ? 'min-w-[260px] max-w-[380px]' : 'max-w-[240px]')}>
                    {cell(r, i)}
                  </TableCell>
                ))}
              </TableRow>
            )))}
          </TableBody>
          {totals.length > 0 && (
            <TableBody>
              {totals.map((r, ri) => (
                <TableRow key={`t${ri}`} className={cn(WS_TR_TOTAL, 'hover:bg-muted', ri === totals.length - 1 && 'sticky bottom-0 z-10')}>
                  {shown.map((i) => (
                    <TableCell key={i} className={cn(WS_TD, 'bg-muted', numeric(i) ? 'whitespace-nowrap text-right tabular-nums' : '')}>{cell(r, i)}</TableCell>
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
