// Vendor GSTIN Risk Report: the identification strip and the count per risk
// band first, then tabs: the vendor list (the shared document view, the table
// kit: filters, sort, group, hide columns, filtered export), the management
// summary, and the three action lists with the recommendations. It reads the
// report's own tables (rows, summary, extraSheets), the same ones the Excel
// and the PDF print, so the screen and the files agree.
import React, { useMemo } from 'react';
import type { ReportSheet, ReportSummary, ReportTable, RowTone } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { KpiTile } from '@/components/gstr9/ui';
import { cn } from '@/lib/utils';
import { fmtNumber } from '@/lib/reportExport/layout';
import { DocumentLineItemsView } from './DocumentLineItemsView';

interface VendorRiskViewProps {
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

/** One of the report's small tables: counts and rupees right-aligned, text wrapped. */
const SheetTable: React.FC<{ sheet: ReportSummary | ReportSheet }> = ({ sheet }) => (
  <div className="max-h-[60vh] overflow-auto">
    <table className="w-full border-separate border-spacing-0 text-xs">
      <thead>
        <tr>
          {sheet.headers.map((h) => (
            <th key={h} className="sticky top-0 whitespace-nowrap border-b bg-muted px-2 py-1.5 text-left font-semibold text-foreground/75">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sheet.rows.map((r, i) => {
          if (sheet.rowKinds?.[i] === 'section') {
            return (
              <tr key={i}>
                <td colSpan={sheet.headers.length} className="border-b bg-muted/50 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{r[0]}</td>
              </tr>
            );
          }
          const tone = sheet.rowTones?.[i];
          return (
            <tr key={i} className={cn(tone && ROW_TONE[tone])}>
              {r.map((v, c) => (
                <td key={c} className={cn('border-b px-2 py-1 align-top', typeof v === 'number' ? 'whitespace-nowrap text-right tabular-nums' : 'min-w-[110px]')}>
                  {typeof v === 'number' ? fmtNumber(v, /itc|amount|₹/i.test(sheet.headers[c]) ? 'amount' : 'int') : v}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const SheetCard: React.FC<{ sheet: ReportSummary | ReportSheet }> = ({ sheet }) => (
  <Card>
    <CardHeader className="px-4 pb-1 pt-3">
      <CardTitle className="text-sm">{sheet.title}</CardTitle>
    </CardHeader>
    <CardContent className="space-y-2 px-4 pb-3">
      <SheetTable sheet={sheet} />
      {sheet.notes && sheet.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {sheet.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </CardContent>
  </Card>
);

const countOf = (s: ReportSheet) => (s.rows.length === 1 && s.rows[0].slice(1).every((c) => c === '') ? 0 : s.rows.length);

export const VendorRiskView: React.FC<VendorRiskViewProps> = ({ table, report }) => {
  // The vendor list alone, for the shared document view.
  const vendors = useMemo<ReportTable>(() => ({ ...table, summary: undefined, extraSheets: undefined }), [table]);
  const sheets = table.extraSheets ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
          {table.kpis.map((k) => (
            <KpiTile key={k.label} label={k.label} value={typeof k.value === 'number' ? fmtNumber(k.value, 'int') : k.value} hint={k.note} tone={k.tone ? KPI_TONE[k.tone] : 'neutral'} />
          ))}
        </div>
      )}

      <Tabs defaultValue="vendors" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit flex-wrap">
          <TabsTrigger value="vendors" className="text-xs">Vendors ({table.rows.length})</TabsTrigger>
          {table.summary && <TabsTrigger value="summary" className="text-xs">Management summary</TabsTrigger>}
          {sheets.map((s) => (
            <TabsTrigger key={s.name} value={s.name} className="text-xs">
              {s.name}{s.name !== 'Recommendations' ? ` (${countOf(s)})` : ''}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="vendors" className="mt-2 h-[70vh] min-h-[420px]">
          <DocumentLineItemsView table={vendors} report={report} />
        </TabsContent>
        {table.summary && (
          <TabsContent value="summary" className="mt-2">
            <SheetCard sheet={table.summary} />
          </TabsContent>
        )}
        {sheets.map((s) => (
          <TabsContent key={s.name} value={s.name} className="mt-2">
            <SheetCard sheet={s} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

export default VendorRiskView;
