// Renders the "working paper" family of reports (Interest and Late Fee
// Calculator, Short Reversal of ITC — Section 17(2) & Rule 42) — a step-by-
// step legal computation meant to be read top to bottom like a memo, not
// filtered like a dataset.
//
// table.rows here are heuristic and mixed on purpose:
//   - plain metadata lines (['Return Type', 'GSTR-3B'])
//   - "section marker" lines that restate the value columns for the
//     subsection that follows (['Interest (Rule 88B, net of ITC set-off)',
//     'IGST', 'CGST', 'SGST']) — everything after one of these, until the
//     next spacer/marker, is a sub-item of it and gets indented
//   - spacer rows (every cell === '') that become a Separator, never an
//     empty table row
//   - a final bottom-line row (the computed answer — total interest, the
//     floored short reversal, …) that always gets the most emphasis,
//     regardless of whether it also happens to carry the literal 'TOTAL'
//     sentinel somewhere in the middle of the document
//
// No search box, no pagination — this archetype is a short memo a CA reads
// once, top to bottom, to explain a number to a client or an officer.
import React from 'react';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Equal, ExternalLink, Inbox } from 'lucide-react';

interface WorkingPaperViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

type Cell = string | number;
type Row = Cell[];

const NUMERIC_HEADER_RE =
  /CGST|SGST|IGST|TOTAL|VALUE|AMOUNT|CLAIMED|LIABILITY|ITC|CESS|FEE|INTEREST|PAYABLE|PENALTY/i;

const isUrl = (v: Cell): v is string => typeof v === 'string' && /^https?:\/\//.test(v);

const isSentinelCell = (v: Cell): boolean => {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s) return false;
  return s.toUpperCase() === 'NOT PULLED' || /not captured|not pulled/i.test(s);
};

const isGrandTotalCell = (v: Cell): boolean => typeof v === 'string' && v.trim().toUpperCase() === 'TOTAL';

const cellText = (v: Cell | undefined): string => (v === undefined ? '' : String(v).trim());

const isBlankRow = (row: Row): boolean => row.length === 0 || row.every((c) => cellText(c) === '');

const rowHasGrandTotalCell = (row: Row): boolean => row.some(isGrandTotalCell);

const statusVariant = (v: string): NonNullable<BadgeProps['variant']> => {
  const s = v.toLowerCase();
  if (/fail|reject|denied|cancel/.test(s)) return 'destructive';
  if (/pending|processing/.test(s)) return 'warning';
  if (/filed|approv|acknowledg|processed/.test(s)) return 'success';
  return 'secondary';
};

const formatNumber = (v: number): string => {
  const rounded = Math.round(v * 100) / 100;
  return rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

// A "section marker" row restates the remaining headers as its own values
// (e.g. ['Interest (…)', 'IGST', 'CGST', 'SGST'] under headers
// ['Item','IGST','CGST','SGST']) — it's a subsection heading, not a data
// line, and everything after it up to the next marker/spacer is its child.
const isSectionMarkerRow = (row: Row, headers: string[]): boolean => {
  const values = row.slice(1);
  if (values.length < 2) return false;
  return values.every((v, i) => {
    const header = headers[i + 1];
    return typeof v === 'string' && !!header && v.trim().toLowerCase() === header.trim().toLowerCase();
  });
};

interface Segment {
  markerLabel: string | null;
  markerValues: Cell[];
  rows: Row[]; // rows that belong to this marker (or top-level rows if markerLabel is null)
}

// Splits one spacer-delimited block of rows into a list of segments: a
// leading run of top-level rows (markerLabel === null) followed by zero or
// more (marker row + its indented children).
const buildSegments = (rows: Row[], headers: string[]): Segment[] => {
  const segments: Segment[] = [];
  let current: Segment = { markerLabel: null, markerValues: [], rows: [] };

  for (const row of rows) {
    if (isSectionMarkerRow(row, headers)) {
      if (current.markerLabel !== null || current.rows.length > 0) segments.push(current);
      const label = cellText(row[0]);
      current = { markerLabel: label || '', markerValues: row.slice(1), rows: [] };
      continue;
    }
    current.rows.push(row);
  }
  segments.push(current);
  return segments.filter((s) => s.markerLabel !== null || s.rows.length > 0);
};

const NumericValue: React.FC<{ value: Cell; header: string }> = ({ value, header }) => {
  if (isUrl(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-primary hover:underline"
      >
        <ExternalLink className="h-3 w-3" /> View
      </a>
    );
  }
  if (isSentinelCell(value)) {
    return (
      <Badge variant="outline" className="border-dashed font-normal text-muted-foreground text-[10px]">
        Not pulled
      </Badge>
    );
  }
  if (/^status$/i.test(header.trim()) && cellText(value) !== '') {
    return <Badge variant={statusVariant(String(value))}>{String(value)}</Badge>;
  }
  if (typeof value === 'number') {
    return (
      <span className={cn('tabular-nums', NUMERIC_HEADER_RE.test(header) && 'font-medium')}>
        {formatNumber(value)}
      </span>
    );
  }
  return <span>{cellText(value)}</span>;
};

// One data line: a label on the left and 0..n value cells on the right,
// adaptively laid out depending on how many value cells this particular row
// actually carries (real rows are ragged — a metadata line like
// ['Return Type','GSTR-3B'] sits in the same table as three-column money
// rows, so alignment is decided per row rather than forced to one grid).
const DataRow: React.FC<{ row: Row; headers: string[]; indent: boolean; emphasize: boolean }> = ({
  row,
  headers,
  indent,
  emphasize,
}) => {
  const label = cellText(row[0]);
  const values = row.slice(1);
  const isTotal = rowHasGrandTotalCell(row);

  return (
    <div
      className={cn(
        'flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2',
        indent && 'ml-4 border-l-2 border-muted pl-4',
        isTotal && !emphasize && 'font-semibold',
      )}
    >
      <span
        className={cn(
          'text-foreground',
          indent && 'text-muted-foreground',
          emphasize ? 'text-base font-bold sm:text-lg' : 'text-sm',
        )}
      >
        {label || '\u00A0'}
      </span>
      {values.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          {values.map((v, i) => {
            const header = headers[i + 1] ?? '';
            return (
              <div
                key={i}
                className={cn('min-w-[72px] text-right', emphasize ? 'text-base sm:text-lg' : 'text-sm')}
              >
                {headers.length > 2 && (
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {header}
                  </div>
                )}
                <span className={cn(emphasize && 'font-bold text-primary')}>
                  <NumericValue value={v} header={header} />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const WorkingPaperView: React.FC<WorkingPaperViewProps> = ({ table, report }) => {
  const ReportIcon = report.icon;
  const subtitleChips = table.subtitle
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  if (table.rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Inbox className="h-8 w-8" />
          <p className="text-sm">No data available for this working paper yet.</p>
        </CardContent>
      </Card>
    );
  }

  // Find the last non-blank row in document order — the bottom-line answer
  // this whole memo builds up to — and set it aside from normal rendering.
  let finalIdx = -1;
  for (let i = table.rows.length - 1; i >= 0; i--) {
    if (!isBlankRow(table.rows[i])) {
      finalIdx = i;
      break;
    }
  }
  const finalRow = finalIdx >= 0 ? table.rows[finalIdx] : null;
  const bodyRows = finalIdx >= 0 ? table.rows.slice(0, finalIdx) : table.rows.slice();

  // Split the body into spacer-delimited blocks; each block is rendered with
  // a Separator before it (except the first), and internally split into
  // marker/child segments.
  const blocks: Row[][] = [];
  let currentBlock: Row[] = [];
  for (const row of bodyRows) {
    if (isBlankRow(row)) {
      if (currentBlock.length > 0) blocks.push(currentBlock);
      currentBlock = [];
      continue;
    }
    currentBlock.push(row);
  }
  if (currentBlock.length > 0) blocks.push(currentBlock);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-primary/5 pb-4">
        <div className="flex items-center gap-2">
          <ReportIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <CardTitle className="text-base">{table.title}</CardTitle>
        </div>
        {subtitleChips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {subtitleChips.map((chip, i) => (
              <Badge key={i} variant="outline" className="font-normal text-xs">
                {chip}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>

      <CardContent className="pt-6">
        <div className="mx-auto max-w-2xl">
          {blocks.map((block, bi) => {
            const segments = buildSegments(block, table.headers);
            return (
              <React.Fragment key={bi}>
                {bi > 0 && <Separator className="my-4" />}
                <div className="space-y-1">
                  {segments.map((seg, si) => (
                    <div key={si} className={cn(si > 0 && 'mt-3')}>
                      {seg.markerLabel !== null && (
                        <div className="mb-1 flex items-baseline justify-between gap-3 rounded-sm bg-muted/40 px-2 py-1.5">
                          <span className="text-sm font-semibold text-foreground">{seg.markerLabel}</span>
                          {seg.markerValues.length > 0 && (
                            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              {seg.markerValues.map(String).join(' · ')}
                            </span>
                          )}
                        </div>
                      )}
                      {seg.rows.map((row, ri) => (
                        <DataRow
                          key={ri}
                          row={row}
                          headers={table.headers}
                          indent={seg.markerLabel !== null}
                          emphasize={false}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </React.Fragment>
            );
          })}

          {/* The bottom line — the one number this working paper exists to prove. */}
          {finalRow && (
            <div className="mt-6 rounded-md border-t-2 border-primary/40 bg-primary/5 px-4 py-4">
              <div className="mb-1 flex items-center gap-2">
                <Equal className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-wide text-primary">Result</span>
              </div>
              <DataRow row={finalRow} headers={table.headers} indent={false} emphasize />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
