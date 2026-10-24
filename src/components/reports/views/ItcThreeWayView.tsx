// GSTR-8A vs GSTR-2A vs GSTR-2B: the year's final ITC first, then why the three
// statements differ, then every document. It reads the report's own tables
// (the "Final ITC" sheet, the summary by reason and its notes, the document
// list), the same rows the Excel and the PDF print, so the screen and the
// files always agree. The document list is the shared document view (the
// table kit: filters, sort, group, hide columns, filtered export).
import React, { useMemo, useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import type { ReportTable, RowTone } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { KpiTile } from '@/components/gstr9/ui';
import { cn } from '@/lib/utils';
import { fmtNumber } from '@/lib/reportExport/layout';
import { DocumentLineItemsView } from './DocumentLineItemsView';

interface ItcThreeWayViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

const KPI_TONE: Record<RowTone, 'ok' | 'warn' | 'error' | 'neutral'> = { good: 'ok', warn: 'warn', bad: 'error', info: 'neutral', muted: 'neutral' };
const ROW_TONE: Record<RowTone, string> = {
  good: 'bg-success/10',
  warn: 'bg-warning/15',
  bad: 'bg-destructive/[0.06]',
  info: 'bg-primary/[0.05]',
  muted: 'text-muted-foreground',
};

const cell = (v: string | number): string => (typeof v === 'number' ? fmtNumber(v, 'amount') : v);
const countCell = (v: string | number): string => (typeof v === 'number' ? fmtNumber(v, 'int') : v);

/** A small table of the report's: a header row and its rows, totals and section lines set apart. */
const MiniTable: React.FC<{
  headers: string[];
  rows: (string | number)[][];
  kinds?: (string | null)[];
  tones?: (RowTone | null)[];
  /** Columns printed as counts, not amounts. */
  countCols?: number[];
  /** Columns of text (left-aligned). */
  textCols: number[];
}> = ({ headers, rows, kinds, tones, countCols = [], textCols }) => (
  <div className="overflow-auto">
    <table className="w-full border-separate border-spacing-0 text-xs">
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={h} className={cn('sticky top-0 whitespace-nowrap border-b bg-muted px-2 py-1.5 font-semibold text-foreground/75', textCols.includes(i) ? 'text-left' : 'text-right')}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const kind = kinds?.[i];
          if (kind === 'section') {
            return (
              <tr key={i}>
                <td colSpan={headers.length} className="border-b bg-muted/50 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{r[0]}</td>
              </tr>
            );
          }
          const tone = tones?.[i];
          return (
            <tr key={i} className={cn(kind === 'total' && 'font-semibold', tone && ROW_TONE[tone])}>
              {r.map((v, c) => (
                <td
                  key={c}
                  className={cn(
                    'border-b px-2 py-1 align-top',
                    textCols.includes(c) ? 'min-w-[160px] text-left' : 'whitespace-nowrap text-right tabular-nums',
                    kind === 'total' && 'border-t-2 border-t-foreground/30',
                  )}
                >
                  {countCols.includes(c) ? countCell(v) : cell(v)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

export const ItcThreeWayView: React.FC<ItcThreeWayViewProps> = ({ table, report }) => {
  const [notesOpen, setNotesOpen] = useState(true);
  const finalSheet = table.extraSheets?.find((s) => s.name === 'Final ITC');
  const summary = table.summary;
  // The document list alone, for the shared document view (its summary and sheets are shown above).
  const docs = useMemo<ReportTable>(() => ({ ...table, summary: undefined, extraSheets: undefined }), [table]);

  return (
    <div className="space-y-3">
      {table.meta && (
        <div className="flex flex-wrap items-stretch divide-x rounded-md border border-l-4 border-l-primary bg-card">
          {table.meta.map((m) => (
            <div key={m.label} className="min-w-0 px-3 py-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{m.label}</div>
              <div className="truncate text-[13px] font-semibold leading-snug text-foreground">{m.value}</div>
            </div>
          ))}
        </div>
      )}

      {table.kpis && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
          {table.kpis.map((k) => (
            <KpiTile key={k.label} label={k.label} value={typeof k.value === 'number' ? fmtNumber(k.value, k.label === 'Documents' || k.label.startsWith('In all') ? 'int' : 'amount') : k.value} hint={k.note} tone={k.tone ? KPI_TONE[k.tone] : 'neutral'} />
          ))}
        </div>
      )}

      <div className="space-y-3">
        {finalSheet && (
          <Card>
            <CardHeader className="px-4 pb-1 pt-3">
              <CardTitle className="text-sm">{finalSheet.title}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <MiniTable
                headers={finalSheet.headers}
                rows={finalSheet.rows}
                kinds={finalSheet.rowKinds}
                tones={finalSheet.rowTones}
                countCols={[1]}
                textCols={[0, 7]}
              />
            </CardContent>
          </Card>
        )}
        {summary && (
          <Card>
            <CardHeader className="px-4 pb-1 pt-3">
              <CardTitle className="text-sm">{summary.title}</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[420px] overflow-auto px-4 pb-3">
              <MiniTable
                headers={summary.headers}
                rows={summary.rows}
                kinds={summary.rowKinds}
                tones={summary.rowTones}
                countCols={[3]}
                textCols={[0, 1, 2, 8]}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {summary?.notes && summary.notes.length > 0 && (
        <Collapsible open={notesOpen} onOpenChange={setNotesOpen}>
          <div className="rounded-md border bg-card">
            <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold">
              <Info className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              Notes ({summary.notes.length})
              <ChevronDown className={cn('ml-auto h-3.5 w-3.5 transition-transform', notesOpen && 'rotate-180')} aria-hidden="true" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="list-disc space-y-0.5 px-8 pb-2 text-xs text-muted-foreground">
                {summary.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

      <div className="h-[75vh] min-h-[420px]">
        <DocumentLineItemsView table={docs} report={report} />
      </div>
    </div>
  );
};

export default ItcThreeWayView;
