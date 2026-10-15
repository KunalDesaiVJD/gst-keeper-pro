// EvidenceEventListView — chronological list of real portal events/filings
// (Notices, Refunds, DRC-03s, Challans, GSTR-1 upload errors…), each possibly
// carrying its own evidence PDF. This is the primary place a reviewer opens a
// document to cross-tally it against the figures elsewhere in the app, so the
// evidence column gets first-class treatment (an icon Button, not a plain
// link) and a bulk "open every visible PDF" action.
//
// The rows are worked from every angle through the table kit (./tableKit):
// a filter on every header (ticked statuses and types with counts, a date
// range on the date the event happened, figure ranges), sort, Group by with
// subtotals, hidden columns, and "Excel (filtered)" / "PDF (filtered)" of
// exactly what is shown. The view keeps what is its own: newest first by
// default, the status tiles (now column filters, so they show as chips and
// narrow the TOTAL and the export), the PDF tiles, the Type pill, the ARN →
// case folder link, and the red PDF button.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent } from '@/components/ui/card';
import NoticesCardHeader from '@/components/notices/NoticesCardHeader';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { Button } from '@/components/ui/button';
import { FileText, DownloadCloud, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { rowKindsOf } from '@/lib/reportExport/layout';
import {
  TableKitPager, TableKitTable, TableKitToolbar, isSentinelCell, isUrlCell, useTableKit,
  type ModelColumn, type ModelRow,
} from './tableKit';

interface EvidenceEventListViewProps {
  table: ReportTable;
  // Only title/icon (and the key, when there is one) are read here, so
  // firm-wide drill-down pages can reuse this view with a lightweight stub
  // instead of a full catalog ReportDefinition.
  report: Pick<ReportDefinition, 'title' | 'icon'> & Partial<Pick<ReportDefinition, 'key'>>;
}

// ─────────────────── Columns this view treats specially ────────────────────

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

// Status of a portal event, in the words the portal uses for refunds, DRC-03s,
// challans and GSTR-1 uploads. Read for its outcome, not its verb: a refund
// "Application filed" is still waiting (amber), "Sanctioned" is done (green),
// a deficiency memo or "Processed with error" went wrong (red). The kit's
// generic reading would call any "filed" green and a sanction grey.
const EVENT_STATUS_VARIANT = (v: string): 'success' | 'warning' | 'destructive' | 'secondary' => {
  const s = v.toUpperCase();
  if (/ERROR|FAIL|REJECT|DENIED|DEFICIENCY|CANCEL|INVALID/.test(s)) return 'destructive';
  if (/WITHDRAW/.test(s)) return 'secondary';
  if (/SANCTION|APPROV|ACKNOWLEDG|ACCEPT|PROCESSED|DISPOSED|CLOSED|PAID|SUCCESS/.test(s)) return 'success';
  if (/APPLICATION FILED|PENDING|PROCESSING|SUBMIT|ISSUED|AWAIT/.test(s)) return 'warning';
  if (/FILED/.test(s)) return 'success';
  return 'secondary';
};

// Evidence column: the report's own PDF/Documents column. Detected by header
// name — every report in this archetype that carries a document names its
// column exactly this way (see noticeRefundDrc03Reports.ts / extraPortalReports.ts).
// Reports with no such column (Challan Summary, GSTR-1 Error Log) simply get
// no evidence column, no PDF tiles and no bulk-download action.
const EVIDENCE_HEADER_RE = /PDF|DOCUMENT/i;

// Date column the list opens sorted on, newest first — checked in priority
// order so a report with several date-ish columns (e.g. DRC-03's "Filed Date"
// plus a "Period" range) still sorts on the one that means "when this
// happened". The kit sorts it by date (DD/MM/YYYY day first, never the US
// reading), and an en-IN "Date/Time" stamp by its moment.
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

// Free text a reviewer reads (a portal error, a notice's description, a
// DRC-03's cause): two wrapped lines rather than cut at the column's edge,
// the whole of it on hover.
const LONG_TEXT_HEADER_RE = /reason|description|cause|remark/i;

// The figures worth a tile, most telling first: what was claimed, sanctioned
// or paid in total, then how it was paid, then interest and penalties, then
// the tax heads. A taxable value is the base a payment was worked on, not
// money that moved, so it comes last.
const TILE_PRIORITY = [/total|claimed|sanctioned/i, /cash|credit/i, /interest|penalty|late fee/i, /igst|cgst|sgst|cess/i];
const MAX_FIGURE_TILES = 4;

// The id of the view's own PDF filters (custom filters: "has a link" is not a
// value a reader would tick in the column's list).
const PDF_ON_FILE = 'pdf-on-file';
const PDF_MISSING = 'pdf-missing';

// A merge keeps the first month's subtitle; its month is not the list's period.
const MONTH_LABEL_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-]+\d{2,4}$/i;
const subtitleOf = (subtitle: string, merged: boolean): string => (!merged ? subtitle : subtitle.split('|').map((s) => s.trim()).filter(Boolean)
  .filter((s) => !(MONTH_LABEL_RE.test(s) || /^(period|month|return period):/i.test(s)))
  .join('   |   '));

const isBlankish = (v: unknown): boolean => {
  const s = String(v ?? '').trim();
  return s === '' || s === '—' || s === '-';
};

export const EvidenceEventListView: React.FC<EvidenceEventListViewProps> = ({ table, report }) => {
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);

  const headers = table.headers;
  const evidenceColIdx = useMemo(() => headers.findIndex((h) => EVIDENCE_HEADER_RE.test(h)), [headers]);
  const typeColIdx = useMemo(() => headers.findIndex((h) => TYPE_HEADER_RE.test(h.trim())), [headers]);
  const dateColIdx = useMemo(() => findDateColIdx(headers), [headers]);
  // ARN doubles as the portal Case ID for refund/DRC-03 cases — "Ref ID" is
  // the same idea under the Merged Notices table's own header name — so when
  // the caller supplies clientIds (opt-in; most EvidenceEventListView
  // consumers don't, and a caller that mixes case-ID rows with plain
  // reference-number rows under one "Ref ID" column just passes a null
  // clientId for the latter), this links straight to the same case-folder
  // page the Notices table already links to, instead of leaving the cell as
  // plain text. Read through row.i (the row's index in table.rows), which
  // survives every filter, sort and grouping the kit applies.
  const arnColIdx = useMemo(() => headers.findIndex((h) => /^(arn|ref id)$/i.test(h.trim())), [headers]);

  // The event rows (not the TOTAL), counted before the kit so its grouping
  // rule can use it; and whether several months were merged into the list.
  const { eventCount, merged } = useMemo(() => {
    const kinds = rowKindsOf(table.rows, table.rowKinds);
    return { eventCount: kinds.filter((k) => k === 'data').length, merged: kinds.includes('period') };
  }, [table.rows, table.rowKinds]);

  const kit = useTableKit(table, {
    // A stub caller has no key; its title tells reports apart just as well.
    resetKey: report.key ?? report.title,
    // Newest first. Several months merged open in the report's own order
    // instead: a sort hides the month bands and a month's "Not built: no
    // upload history" line, which a reviewer must see. One click sorts them.
    initialSort: dateColIdx !== -1 && !merged ? { col: dateColIdx, dir: 'desc' } : null,
    rowNoun: ['event', 'events'],
    // Only money is added up here: a GSTR-1 upload's version number is a
    // figure, but its "total" would mean nothing.
    summable: (c: ModelColumn) => c.kind === 'amount',
    // Group by a value that repeats (a status, a type, a section, an upload
    // version); an ARN or a reference number is one event each, and a column
    // with one value throughout is one group, so grouping by either would
    // only add headings.
    groupable: (c: ModelColumn) => (c.groupable || c.kind === 'int') && (c.virtual || (c.distinct > 1 && c.distinct < eventCount)),
  });
  const { model, view, state } = kit;
  const dataCount = model.data.length;
  const statusColIdx = kit.statusCol;

  // ── Tiles: read from the whole report; a filter shows "x of y" ──────────
  const statusCounts = useMemo(() => {
    if (statusColIdx === -1) return [] as { label: string; count: number }[];
    const counts = new Map<string, number>();
    model.data.forEach((row) => {
      const v = String(row.cells[statusColIdx] ?? '').trim();
      if (isBlankish(v) || isSentinelCell(v)) return;
      counts.set(v, (counts.get(v) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [model.data, statusColIdx]);

  const withEvidenceCount = useMemo(() => {
    if (evidenceColIdx === -1) return 0;
    return model.data.filter((row) => isUrlCell(row.cells[evidenceColIdx])).length;
  }, [model.data, evidenceColIdx]);
  const shownWithEvidence = useMemo(() => {
    if (evidenceColIdx === -1) return 0;
    return view.rows.filter((row) => isUrlCell(row.cells[evidenceColIdx])).length;
  }, [view.rows, evidenceColIdx]);

  const figureTiles = useMemo(() => {
    const rank = (header: string) => {
      const k = TILE_PRIORITY.findIndex((re) => re.test(header));
      return k === -1 ? TILE_PRIORITY.length : k;
    };
    return kit.totals
      .filter((t) => Math.abs(t.total) >= 0.005)
      .map((t, k) => ({ t, k, r: rank(headers[t.col] ?? '') }))
      .sort((a, b) => a.r - b.r || a.k - b.k)
      .slice(0, MAX_FIGURE_TILES)
      .map((x) => x.t);
  }, [kit.totals, headers]);

  const statusFilter = statusColIdx !== -1 ? state.filters[statusColIdx] : undefined;
  const statusTicked = statusFilter?.type === 'values' ? statusFilter.values : [];
  const pdfOn = (id: string) => !!state.custom?.some((c) => c.id === id);

  const toggleStatus = (label: string) => {
    if (statusColIdx === -1) return;
    const only = statusTicked.length === 1 && statusTicked[0] === label;
    kit.setFilter(statusColIdx, only ? undefined : { type: 'values', values: [label] });
  };
  // The two PDF tiles exclude each other: rows with a PDF, or rows without one.
  const togglePdf = (id: typeof PDF_ON_FILE | typeof PDF_MISSING) => {
    const on = pdfOn(id);
    kit.setCustomFilter(PDF_ON_FILE, null);
    kit.setCustomFilter(PDF_MISSING, null);
    if (on) return;
    kit.setCustomFilter(id, id === PDF_ON_FILE
      ? { label: 'Evidence PDF on file', test: (row: ModelRow) => isUrlCell(row.cells[evidenceColIdx]) }
      : { label: 'Evidence PDF not captured', test: (row: ModelRow) => !isUrlCell(row.cells[evidenceColIdx]) });
  };

  // Every PDF of the rows shown, in the order shown (filtered, sorted, grouped).
  const handleDownloadAll = () => {
    if (evidenceColIdx === -1) return;
    const urls = view.rows.map((row) => row.cells[evidenceColIdx]).filter(isUrlCell);
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
        <NoticesCardHeader title={table.title} description={table.subtitle} />
        <CardContent className="pt-3 pb-3">
          <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center text-muted-foreground">
            <Inbox className="h-5 w-5 opacity-60" />
            <p className="text-sm">No {report.title.toLowerCase()} records on file.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Cells this view draws its own way; everything else is the kit's ─────
  const renderCell = (row: ModelRow, col: number): React.ReactNode | undefined => {
    const cell = row.cells[col];

    // Evidence column: first-class icon button. Present vs. absent gets
    // distinct colors (not just opacity) — a red, document-colored icon
    // reads as "there's a real PDF here, click it" at a glance, the way
    // a red Adobe-PDF icon does elsewhere; absent stays neutral/muted.
    if (col === evidenceColIdx) {
      return isUrlCell(cell) ? (
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
          <a href={cell} target="_blank" rel="noopener noreferrer" aria-label="Open document">
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
          aria-label="Document not captured"
        >
          <FileText className="h-3.5 w-3.5" />
        </Button>
      );
    }

    // A dash is "nothing recorded", not a value: quiet, never a badge.
    if (isBlankish(cell)) return <span className="text-muted-foreground/60">—</span>;

    // Type column: a colored pill instead of plain text.
    if (col === typeColIdx && !isSentinelCell(cell)) {
      return (
        <Badge variant={TYPE_VARIANT(String(cell))} className="py-0 text-[10px] font-medium">
          {String(cell)}
        </Badge>
      );
    }

    // Status: a badge read for its outcome (EVENT_STATUS_VARIANT); a tone the
    // report gave the row wins, through the kit's own badge.
    if (col === statusColIdx && !isSentinelCell(cell) && !table.rowTones?.[row.i]) {
      return (
        <Badge variant={EVENT_STATUS_VARIANT(String(cell))} className="py-0 text-[10px] font-medium">
          {String(cell)}
        </Badge>
      );
    }

    // Long free text: two lines in the row, the whole of it on hover (the
    // cell's title), so a long cause of payment does not make every row tall.
    if (LONG_TEXT_HEADER_RE.test(headers[col] ?? '') && typeof cell === 'string') {
      return <span className="line-clamp-2 whitespace-normal">{cell}</span>;
    }

    // ARN → case folder link (only when the caller opted in with clientIds).
    if (col === arnColIdx && !isSentinelCell(cell)) {
      const linkClientId = table.clientIds?.[row.i];
      if (linkClientId) {
        return (
          <Link to={`/notices-case-folder/${linkClientId}/${encodeURIComponent(String(cell))}`} className="text-primary hover:underline">
            {String(cell)}
          </Link>
        );
      }
    }

    return undefined;
  };

  const cellClassName = (_row: ModelRow, col: number): string | undefined => {
    if (col === evidenceColIdx) return 'w-14 py-0.5 text-center';
    if (LONG_TEXT_HEADER_RE.test(headers[col] ?? '')) return 'min-w-[260px] max-w-[460px] whitespace-normal';
    return undefined;
  };

  const tileTone = (label: string): 'ok' | 'warn' | 'error' | 'neutral' => {
    const variant = EVENT_STATUS_VARIANT(label);
    return variant === 'success' ? 'ok' : variant === 'warning' ? 'warn' : variant === 'destructive' ? 'error' : 'neutral';
  };
  const shownOf = (shown: number, all: number) => (view.filtered ? `${shown.toLocaleString('en-IN')} of ${all.toLocaleString('en-IN')}` : all.toLocaleString('en-IN'));
  const notCaptured = dataCount - withEvidenceCount;

  return (
    // The card fills the preview so the list takes the room left and its TOTAL and pager stay in sight.
    <Card className="flex h-full min-h-0 flex-col">
      <NoticesCardHeader title={table.title} description={subtitleOf(table.subtitle, merged)} />

      <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5 pt-3 pb-3">
        {/* Summary strip — readable at a glance before scrolling the table; each tile filters the list */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
          <TileButton
            active={!view.filtered}
            onClick={kit.clearAll}
            title={view.filtered ? 'Clear every filter and show all events' : 'Showing every event'}
          >
            <KpiTile
              label={dataCount === 1 ? 'Event' : 'Events'}
              value={shownOf(view.rows.length, dataCount)}
              hint={view.filtered ? 'shown under the filters' : undefined}
            />
          </TileButton>

          {evidenceColIdx !== -1 && (
            <TileButton active={pdfOn(PDF_ON_FILE)} onClick={() => togglePdf(PDF_ON_FILE)} title="Show only events with an evidence PDF">
              <KpiTile
                label="With evidence PDF"
                value={shownOf(shownWithEvidence, withEvidenceCount)}
                tone={notCaptured > 0 ? 'warn' : 'ok'}
              />
            </TileButton>
          )}
          {evidenceColIdx !== -1 && notCaptured > 0 && (
            <TileButton active={pdfOn(PDF_MISSING)} onClick={() => togglePdf(PDF_MISSING)} title="Show only events whose PDF was not captured">
              <KpiTile
                label="PDF not captured"
                value={shownOf(view.rows.length - shownWithEvidence, notCaptured)}
                tone="warn"
              />
            </TileButton>
          )}

          {statusCounts.map(({ label, count }) => (
            <TileButton
              key={label}
              active={statusTicked.length === 1 && statusTicked[0] === label}
              onClick={() => toggleStatus(label)}
              title={`Show ${label} only`}
            >
              <KpiTile label={label} value={count} tone={tileTone(label)} />
            </TileButton>
          ))}

          {figureTiles.map((s) => (
            <KpiTile
              key={s.col}
              label={model.columns[s.col].name}
              value={kit.figure(s.col, s.shown ?? s.total)}
              hint={s.shown !== null ? `of ${kit.figure(s.col, s.total)}` : undefined}
            />
          ))}
        </div>

        <TableKitToolbar
          kit={kit}
          searchPlaceholder="Search reference no., description, date…"
          right={evidenceColIdx !== -1 && (
            <>
              {downloadNotice && (
                <span className="text-xs text-muted-foreground animate-in fade-in">{downloadNotice}</span>
              )}
              <Button variant="outline" size="sm" onClick={handleDownloadAll} className={WS_BTN} title="Opens the PDF of every event shown, in the order shown">
                <DownloadCloud className="h-3.5 w-3.5" />
                Download all visible PDFs
              </Button>
            </>
          )}
        />
        <TableKitTable
          kit={kit}
          renderCell={renderCell}
          cellClassName={cellClassName}
          headClassName={(col) => (col === evidenceColIdx ? '[&>div]:justify-center' : undefined)}
          label={table.title}
          noMatchText="No events match these filters."
        />
        <TableKitPager kit={kit} />
      </CardContent>
    </Card>
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
