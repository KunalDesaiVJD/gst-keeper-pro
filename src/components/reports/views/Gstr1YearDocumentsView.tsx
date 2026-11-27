// The full-year GSTR-1 documents report (src/utils/gstr1YearDocuments.ts): the
// year's figures across the top, then one tab per sheet of the export, in the
// export's order (Summary, Documents, Month-wise, HSN, Documents issued, Nil).
// Each tab is the same table kit as every other document list (filter, sort,
// group, hide columns), so the year can be worked from any angle; the Excel and
// PDF buttons export the whole report, every sheet.
import React, { useMemo, useState } from 'react';
import type { ReportTable, ReportSummary } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs';
import { StepTab, TAB_LIST_CLASS } from '@/components/gstr9/reco/StepTabs';
import { KpiTile } from '@/components/gstr9/ui';
import { DocumentLineItemsView } from './DocumentLineItemsView';

interface Props { table: ReportTable; report: ReportDefinition }

const fmt = (v: string | number) => (typeof v === 'number' ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : v);

const asTable = (base: ReportTable, s: ReportSummary, key: string): ReportTable => ({
  title: s.title,
  subtitle: (s.notes ?? []).join('   |   '),
  headers: s.headers,
  rows: s.rows,
  rowKinds: s.rowKinds,
  rowTones: s.rowTones,
  toneColumn: s.toneColumn,
  columnWidths: s.columnWidths,
  fileNameBase: `${base.fileNameBase}_${key}`,
});

export const Gstr1YearDocumentsView: React.FC<Props> = ({ table, report }) => {
  const tabs = useMemo(() => {
    const out: { key: string; label: string; count: number; table: ReportTable }[] = [];
    const dataRows = (rows: (string | number)[][]) => rows.filter((r) => r[0] !== 'TOTAL' && r[1] !== 'TOTAL').length;
    if (table.summary) out.push({ key: 'summary', label: 'Section summary', count: dataRows(table.summary.rows), table: asTable(table, table.summary, 'Summary') });
    out.push({ key: 'documents', label: 'Documents', count: dataRows(table.rows), table: { ...table, summary: undefined, extraSheets: undefined, kpis: undefined } });
    for (const s of table.extraSheets ?? []) out.push({ key: s.name, label: s.name, count: dataRows(s.rows), table: asTable(table, s, s.name.replace(/[^A-Za-z0-9]+/g, '_')) });
    return out;
  }, [table]);
  const [tab, setTab] = useState('documents');
  const current = tabs.some((t) => t.key === tab) ? tab : 'documents';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      {table.kpis && table.kpis.length > 0 && (
        <div className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
          {table.kpis.map((k) => <KpiTile key={k.label} label={k.label} value={fmt(k.value)} hint={k.note} tone={k.tone === 'good' ? 'ok' : k.tone === 'warn' ? 'warn' : k.tone === 'bad' ? 'error' : 'neutral'} />)}
        </div>
      )}
      <Tabs value={current} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className={TAB_LIST_CLASS} aria-label="Sheets of the full-year GSTR-1 report">
          {tabs.map((t) => (
            <StepTab key={t.key} value={t.key}>
              {t.label} <span className="ml-1 tabular-nums text-muted-foreground">{t.count.toLocaleString('en-IN')}</span>
            </StepTab>
          ))}
        </TabsList>
        {tabs.map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-2 min-h-[60vh] flex-1">
            <DocumentLineItemsView table={t.table} report={{ ...report, key: `${report.key}:${t.key}` }} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

export default Gstr1YearDocumentsView;
