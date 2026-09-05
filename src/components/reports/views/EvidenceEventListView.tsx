// EvidenceEventListView — chronological list of real portal events/filings
// (Notices, Refunds, DRC-03s, Challans, GSTR-1 upload errors…), each possibly
// carrying its own evidence PDF. This is the primary place a reviewer opens a
// document to cross-tally it against the figures elsewhere in the app, so the
// evidence column gets first-class treatment (an icon Button, not a plain
// link) and a bulk "open every visible PDF" action, on top of the generic
// search/status filter/sort every report in this family needs.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { FileText, Search, DownloadCloud, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EvidenceEventListViewProps {
  table: ReportTable;
  // Only title/icon are read here, so firm-wide drill-down pages can reuse
  // this view with a lightweight stub instead of a full catalog ReportDefinition.
  report: Pick<ReportDefinition, 'title' | 'icon'>;
}

// ─────────────────── Cell/header heuristics (per the shared contract) ──────

const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v);

const isSentinel = (v: unknown): boolean => {
  const s = String(v ?? '').trim();
  if (!s) return false;
  if (s.toUpperCase() === 'NOT PULLED') return true;
  return /not captured|not pulled/i.test(s);
};

const isTotalRow = (row: (string | number)[]): boolean =>
  row.some((c) => String(c ?? '').trim().toUpperCase() === 'TOTAL');

const NUMERIC_HEADER_RE = /CGST|SGST|IGST|TOTAL|VALUE|AMOUNT|CLAIMED|LIABILITY|ITC|CESS|FEE|INTEREST|PAYABLE|PENALTY/i;
const isNumericHeader = (h: string) => NUMERIC_HEADER_RE.test(h);

const STATUS_HEADER_RE = /^status$/i;

const STATUS_VARIANT = (v: string): 'success' | 'warning' | 'destructive' | 'secondary' => {
  const s = v.toUpperCase();
  if (/FILED|APPROV|ACKNOWLEDG|ACCEPT|PROCESSED/.test(s)) return 'success';
  if (/PENDING|PROCESSING/.test(s)) return 'warning';
  if (/FAIL|REJECT|DENIED|CANCEL/.test(s)) return 'destructive';
  return 'secondary';
};

// "Type" column (Order/Notice/Letter Of Undertaking/Voluntary Payment/...) —
// a colored pill instead of plain text, so the event kind is scannable at a
// glance without reading every cell (matches Notice Alert's colored-status
// convention, applied here to Type since this app's own Status column is
// usually empty — the portal doesn't expose a status for most of these).
const TYPE_HEADER_RE = /^type$/i;

const TYPE_VARIANT = (v: string): 'default' | 'warning' | 'info' | 'success' | 'destructive' | 'secondary' => {
  const s = v.toUpperCase();
  if (/ORDER/.test(s)) return 'default';
  if (/NOTICE/.test(s)) return 'warning';
  if (/UNDERTAKING|LUT/.test(s)) return 'info';
  if (/VOLUNTARY|PAYMENT|ACKNOWLEDG/.test(s)) return 'success';
  if (/REJECT|CANCEL|DEFAULT/.test(s)) return 'destructive';
  return 'secondary';
};

// Evidence column: the report's own PDF/Documents column. Detected by header
// name — every report in this archetype that carries a document names its
// column exactly this way (see noticeRefundDrc03Reports.ts / extraPortalReports.ts).
// Reports with no such column (Challan Summary, GSTR-1 Error Log) simply get
// no evidence column and no bulk-download action.
const EVIDENCE_HEADER_RE = /PDF|DOCUMENT/i;

// Date column used for the "newest first" sort — checked in priority order so
// a report with several date-ish columns (e.g. DRC-03's "Filed Date" plus a
// "Period" range) still sorts on the one that means "when this happened".
const DATE_HEADER_PRIORITY = [/^issue date$/i, /^filed date$/i, /^challan date$/i, /^date\/time$/i, /^date$/i];

const findDateColIdx = (headers: string[]): number => {
  for (const re of DATE_HEADER_PRIORITY) {
    const idx = headers.findIndex((h) => re.test(h.trim()));
    if (idx !== -1) return idx;
  }
  const noDue = headers.findIndex((h) => /date/i.test(h) && !/due/i.test(h));
  if (noDue !== -1) return noDue;
  return headers.findIndex((h) => /date/i.test(h));
};

// Loose date parser: real cells here are either ISO ('2026-08-15'), a
// toLocaleString('en-IN') stamp ('15/8/2026, 10:23:45 am'), or a plain
// DD/MM/YYYY string. Unparseable values sort to the bottom rather than
// throwing the whole list off.
const parseDateLoose = (v: string | number | undefined): number => {
  if (v === undefined || v === null) return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (!s || s === '—' || isSentinel(s)) return NaN;
  // DD/MM/YYYY (or DD-MM-YYYY) is checked BEFORE Date.parse — Date.parse
  // treats an ambiguous slash-separated string as MM/DD/YYYY (US order), so
  // a display date like "04/08/2026" (4 Aug) would silently parse as 8
  // April instead. Confirmed as a real risk 2026-09-03 when the notice/
  // refund/DRC-03 report builders switched from raw ISO cells to this
  // format — this reordering is what keeps date filters/sorting correct
  // afterward.
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  const direct = Date.parse(s);
  if (!Number.isNaN(direct)) return direct;
  return NaN;
};

const formatCell = (v: string | number): string => {
  if (typeof v !== 'number') return String(v ?? '');
  if (v === 0) return '0';
  const rounded = Math.round(v * 100) / 100;
  return rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

export const EvidenceEventListView: React.FC<EvidenceEventListViewProps> = ({ table, report }) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const Icon = report.icon || FileText;

  const headers = table.headers;
  const evidenceColIdx = useMemo(() => headers.findIndex((h) => EVIDENCE_HEADER_RE.test(h)), [headers]);
  const statusColIdx = useMemo(() => headers.findIndex((h) => STATUS_HEADER_RE.test(h.trim())), [headers]);
  const typeColIdx = useMemo(() => headers.findIndex((h) => TYPE_HEADER_RE.test(h.trim())), [headers]);
  const dateColIdx = useMemo(() => findDateColIdx(headers), [headers]);
  // ARN doubles as the portal Case ID for refund/DRC-03 cases — "Ref ID" is
  // the same idea under the Merged Notices table's own header name — so when
  // the caller supplies clientIds (opt-in; most EvidenceEventListView
  // consumers don't, and a caller that mixes case-ID rows with plain
  // reference-number rows under one "Ref ID" column just passes a null
  // clientId for the latter), this links straight to the same case-folder
  // page the Notices table already links to, instead of leaving the cell as
  // plain text. Keyed by row object identity rather than a plain index,
  // since visibleRows below is a filtered/sorted VIEW over
  // dataRows/table.rows — the row arrays themselves keep their identity
  // through filter/sort, just not their position.
  const arnColIdx = useMemo(() => headers.findIndex((h) => /^(arn|ref id)$/i.test(h.trim())), [headers]);
  const clientIdByRow = useMemo(() => {
    const map = new Map<(string | number)[], string | null>();
    table.rows.forEach((row, i) => map.set(row, table.clientIds?.[i] ?? null));
    return map;
  }, [table.rows, table.clientIds]);

  const { dataRows, totalRows } = useMemo(() => {
    const data: (string | number)[][] = [];
    const totals: (string | number)[][] = [];
    for (const row of table.rows) {
      (isTotalRow(row) ? totals : data).push(row);
    }
    return { dataRows: data, totalRows: totals };
  }, [table.rows]);

  const statusOptions = useMemo(() => {
    if (statusColIdx === -1) return [] as string[];
    const set = new Set<string>();
    dataRows.forEach((row) => {
      const v = String(row[statusColIdx] ?? '').trim();
      if (v && !isSentinel(v)) set.add(v);
    });
    return Array.from(set).sort();
  }, [dataRows, statusColIdx]);

  const withEvidenceCount = useMemo(() => {
    if (evidenceColIdx === -1) return 0;
    return dataRows.filter((row) => isUrl(row[evidenceColIdx])).length;
  }, [dataRows, evidenceColIdx]);

  const statusCounts = useMemo(() => {
    if (statusColIdx === -1) return [] as { label: string; count: number }[];
    const counts = new Map<string, number>();
    dataRows.forEach((row) => {
      const v = String(row[statusColIdx] ?? '').trim();
      if (!v || isSentinel(v)) return;
      counts.set(v, (counts.get(v) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [dataRows, statusColIdx]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = dataRows;
    if (statusColIdx !== -1 && statusFilter !== 'all') {
      rows = rows.filter((row) => String(row[statusColIdx] ?? '').trim() === statusFilter);
    }
    if (q) {
      rows = rows.filter((row) => row.some((c) => String(c ?? '').toLowerCase().includes(q)));
    }
    if (dateColIdx !== -1) {
      rows = [...rows].sort((a, b) => {
        const da = parseDateLoose(a[dateColIdx]);
        const db = parseDateLoose(b[dateColIdx]);
        const aValid = !Number.isNaN(da);
        const bValid = !Number.isNaN(db);
        if (aValid && bValid) return db - da; // newest first
        if (aValid) return -1;
        if (bValid) return 1;
        return 0;
      });
    }
    return rows;
  }, [dataRows, search, statusFilter, statusColIdx, dateColIdx]);

  const handleDownloadAll = () => {
    if (evidenceColIdx === -1) return;
    const urls = visibleRows.map((row) => row[evidenceColIdx]).filter(isUrl);
    if (urls.length === 0) {
      setDownloadNotice('No documents in the current view.');
      setTimeout(() => setDownloadNotice(null), 2500);
      return;
    }
    setDownloadNotice(`Opening ${urls.length} PDF${urls.length === 1 ? '' : 's'}…`);
    urls.forEach((url, i) => {
      setTimeout(() => window.open(url, '_blank', 'noopener,noreferrer'), i * 150);
    });
    setTimeout(() => setDownloadNotice(null), urls.length * 150 + 1500);
  };

  if (table.rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {table.title}
          </CardTitle>
          <CardDescription>{table.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-center text-muted-foreground">
            <Inbox className="h-7 w-7" />
            <p className="text-sm">No {report.title.toLowerCase()} records on file.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="gap-1.5">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {table.title}
        </CardTitle>
        <CardDescription>{table.subtitle}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary strip — readable at a glance before scrolling the table */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2.5">
          <span className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{dataRows.length}</span>{' '}
            event{dataRows.length === 1 ? '' : 's'}
          </span>
          {evidenceColIdx !== -1 && (
            <>
              <span className="text-muted-foreground/40">•</span>
              <span className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground tabular-nums">{withEvidenceCount}</span> with evidence PDF
                {withEvidenceCount < dataRows.length && (
                  <span className="ml-1 text-muted-foreground/80">
                    ({dataRows.length - withEvidenceCount} not captured)
                  </span>
                )}
              </span>
            </>
          )}
          {statusCounts.length > 0 && (
            <>
              <span className="text-muted-foreground/40">•</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {statusCounts.map(({ label, count }) => (
                  <Badge key={label} variant={STATUS_VARIANT(label)} className="text-[10px] py-0 font-medium">
                    {label} · {count}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Filters + bulk action */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reference no., description, date…"
              className="h-8 pl-8 text-sm"
            />
          </div>

          {statusColIdx !== -1 && statusOptions.length > 0 && (
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <span className="text-xs text-muted-foreground">
            {search || statusFilter !== 'all' ? `${visibleRows.length} of ${dataRows.length}` : `${dataRows.length}`} shown
          </span>

          <div className="flex-1" />

          {downloadNotice && (
            <span className="text-xs text-muted-foreground animate-in fade-in">{downloadNotice}</span>
          )}

          {evidenceColIdx !== -1 && (
            <Button variant="outline" size="sm" onClick={handleDownloadAll} className="h-8">
              <DownloadCloud className="mr-1.5 h-3.5 w-3.5" />
              Download all visible PDFs
            </Button>
          )}
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
                      isNumericHeader(h) && 'text-right',
                      i === evidenceColIdx && 'text-center',
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
                    No rows match the current filters.
                  </TableCell>
                </TableRow>
              )}

              {visibleRows.map((row, ri) => (
                <TableRow key={ri}>
                  {row.map((cell, ci) => {
                    const header = headers[ci] || '';

                    // Evidence column: first-class icon button. Present vs. absent gets
                    // distinct colors (not just opacity) — a red, document-colored icon
                    // reads as "there's a real PDF here, click it" at a glance, the way
                    // a red Adobe-PDF icon does elsewhere; absent stays neutral/muted.
                    if (ci === evidenceColIdx) {
                      return (
                        <TableCell key={ci} className="px-3 py-1.5 text-center">
                          {isUrl(cell) ? (
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7 border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
                              title="Open document"
                              asChild
                            >
                              {/* A real <a> click is normal browser navigation, not a
                                  script-triggered popup — window.open() here got silently
                                  blocked by popup-blocker policies on some machines. */}
                              <a href={cell as string} target="_blank" rel="noopener noreferrer">
                                <FileText className="h-3.5 w-3.5" />
                              </a>
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7 cursor-not-allowed opacity-40"
                              disabled
                              title="Not captured"
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      );
                    }

                    // Type column: a colored pill instead of plain text.
                    if (ci === typeColIdx && String(cell ?? '').trim() && !isSentinel(cell)) {
                      return (
                        <TableCell key={ci} className="whitespace-nowrap px-3 py-1.5 text-xs">
                          <Badge variant={TYPE_VARIANT(String(cell))} className="py-0 text-[10px]">
                            {String(cell)}
                          </Badge>
                        </TableCell>
                      );
                    }

                    // Generic URL fallback (a report may carry a link outside the designated evidence column).
                    if (isUrl(cell)) {
                      return (
                        <TableCell key={ci} className="whitespace-nowrap px-3 py-1.5 text-xs">
                          <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
                            <a href={cell as string} target="_blank" rel="noopener noreferrer">View</a>
                          </Button>
                        </TableCell>
                      );
                    }

                    // Status badge.
                    if (ci === statusColIdx && String(cell ?? '').trim() && !isSentinel(cell)) {
                      return (
                        <TableCell key={ci} className="whitespace-nowrap px-3 py-1.5 text-xs">
                          <Badge variant={STATUS_VARIANT(String(cell))} className="py-0 text-[10px]">
                            {String(cell)}
                          </Badge>
                        </TableCell>
                      );
                    }

                    // ARN → case folder link (only when the caller opted in with clientIds).
                    if (ci === arnColIdx && String(cell ?? '').trim() && !isSentinel(cell)) {
                      const linkClientId = clientIdByRow.get(row);
                      if (linkClientId) {
                        return (
                          <TableCell key={ci} className="whitespace-nowrap px-3 py-1.5 text-xs">
                            <Link to={`/notices-case-folder/${linkClientId}/${encodeURIComponent(String(cell))}`} className="text-primary hover:underline">
                              {String(cell)}
                            </Link>
                          </TableCell>
                        );
                      }
                    }

                    // Sentinel ("NOT PULLED" / "not captured" / "not pulled").
                    if (isSentinel(cell)) {
                      return (
                        <TableCell key={ci} className="whitespace-nowrap px-3 py-1.5 text-xs">
                          <Badge variant="outline" className="border-dashed py-0 text-[10px] text-muted-foreground">
                            {String(cell)}
                          </Badge>
                        </TableCell>
                      );
                    }

                    return (
                      <TableCell
                        key={ci}
                        className={cn(
                          'px-3 py-1.5 text-xs',
                          isNumericHeader(header) ? 'whitespace-nowrap text-right tabular-nums' : 'max-w-[320px]',
                        )}
                      >
                        {formatCell(cell)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}

              {totalRows.map((row, ri) => (
                <TableRow key={`total-${ri}`} className="bg-primary/5 font-semibold hover:bg-primary/10">
                  {row.map((cell, ci) => {
                    const header = headers[ci] || '';
                    return (
                      <TableCell
                        key={ci}
                        className={cn(
                          'px-3 py-1.5 text-xs',
                          isNumericHeader(header) ? 'whitespace-nowrap text-right tabular-nums' : '',
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
      </CardContent>
    </Card>
  );
};
