// The reconciliation workspace for the "matched document by document, every
// difference with its reason" family: GSTR-2A vs GSTR-2B today, 2A vs 8A and
// 8A vs 2B next (labels come from the data, never hard-coded). It reads
// table.reco (RecoViewData), the same rows the Excel and the PDF are built
// from, and holds one filter state (useRecoFilters) that every part reads: the
// figures across the top, the status bar, and each tab (documents side by
// side, suppliers, months, reasons, breakdowns). "Excel / PDF (filtered)"
// rebuild the report from the rows shown, with the filter named in its header,
// so what is exported is what is on the screen. Pieces live in ./reco.
import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs';
import { StepTab, TAB_LIST_CLASS } from '@/components/gstr9/reco/StepTabs';
import { renderReportToExcel, type ReportTable } from '@/utils/allClientsReports';
import { renderReportToPdf } from '@/utils/closingBalanceReportsPdf';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { describeFilters, reasonKey, supplierKey, type Facet } from '@/lib/itcReco/filters';
import { monthLabel } from '@/lib/itcReco/dates';
import type { RecoStatus } from '@/lib/itcReco/types';
import { recoReportTable } from '@/lib/itcReco/viewModel';
import type { RecoViewData } from '@/lib/itcReco/viewTypes';
import { useRecoFilters } from './reco/useRecoFilters';
import { HeaderStrip, KpiBand, NotesPanel, StatusBar } from './reco/Overview';
import { FilterBar } from './reco/FilterBar';
import { DocumentsTab } from './reco/DocumentsTab';
import { SuppliersTab } from './reco/SuppliersTab';
import { MonthsTab } from './reco/MonthsTab';
import { ReasonsTab } from './reco/ReasonsTab';
import { BreakdownsTab } from './reco/BreakdownsTab';
import { EmptyLine } from './reco/shared';
import { fmtCountPlain } from './reco/format';

interface ReasonReconciliationViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

type TabKey = 'documents' | 'suppliers' | 'months' | 'reasons' | 'breakdowns';

const TabCount: React.FC<{ n: number }> = ({ n }) => <span className="tabular-nums text-xs font-normal text-muted-foreground">{fmtCountPlain(n)}</span>;

const Workspace: React.FC<{ data: RecoViewData; table: ReportTable }> = ({ data, table }) => {
  const state = useRecoFilters(data);
  const { rows, filters, applied, setFacet } = state;
  const [tab, setTab] = useState<TabKey>('documents');
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);
  const many = data.periods.length > 1;

  const supplierCount = useMemo(() => new Set(rows.map(supplierKey)).size, [rows]);
  const reasonCount = useMemo(() => new Set(rows.map(reasonKey)).size, [rows]);
  const monthCount = useMemo(() => new Set(rows.map((r) => r.period)).size, [rows]);

  const onStatuses = useCallback((s: RecoStatus[]) => setFacet('status', s), [setFacet]);
  // A line picked on an analysis tab becomes that facet's whole selection, and the documents open.
  const pick = useCallback((facet: Facet, value: string) => { setFacet(facet, [value]); setTab('documents'); }, [setFacet]);

  const exportFiltered = async (format: 'xlsx' | 'pdf') => {
    setBusy(format);
    try {
      const note = describeFilters(applied, data);
      const built = recoReportTable({ ...data, rows }, { title: table.title, filterNote: note || undefined });
      // Its own file name, so it never overwrites the whole report's download;
      // the filter also in the subtitle, for a renderer that prints the
      // subtitle rather than the strip (`meta`, which carries it already).
      const t = { ...built, fileNameBase: `${built.fileNameBase}_filtered`, subtitle: note ? `${built.subtitle}   |   Filter: ${note}` : built.subtitle };
      // The Big4 renderers may be async (they load ExcelJS / jsPDF on demand); the old ones are not.
      if (format === 'xlsx') await renderReportToExcel(t);
      else await renderReportToPdf(t);
      toast.success(`${format === 'xlsx' ? 'Excel' : 'PDF'} of ${fmtCountPlain(rows.length)} document${rows.length === 1 ? '' : 's'} downloaded`);
    } catch (e) {
      toast.error(`Could not build the ${format === 'xlsx' ? 'Excel' : 'PDF'}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  if (!data.rows.length) {
    return (
      <div className="space-y-3">
        <HeaderStrip data={data} />
        <NotesPanel data={data} />
        <EmptyLine>
          {data.failed.length && !data.periods.length
            ? `No month could be built: ${data.failed.map((f) => `${monthLabel(f.period)} (${f.reason})`).join('; ')}`
            : 'Neither statement holds a document for this period.'}
        </EmptyLine>
      </div>
    );
  }

  const clearAll = <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={state.clear}>Clear all filters</Button>;
  const noMatch = <EmptyLine action={clearAll}>No document matches the filter.</EmptyLine>;

  return (
    <div className="space-y-3">
      <HeaderStrip data={data} />
      <KpiBand data={data} rows={rows} filtering={state.filtering} active={filters.status} onStatuses={onStatuses} />
      <StatusBar data={data} rows={rows} active={filters.status} onStatuses={onStatuses} />
      <NotesPanel data={data} />
      <FilterBar data={data} state={state} onExport={exportFiltered} exportBusy={busy} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className={TAB_LIST_CLASS} aria-label="Views of the reconciliation">
          <StepTab value="documents">Documents <TabCount n={rows.length} /></StepTab>
          <StepTab value="suppliers">Suppliers <TabCount n={supplierCount} /></StepTab>
          {many && <StepTab value="months">Months <TabCount n={monthCount} /></StepTab>}
          <StepTab value="reasons">Reasons <TabCount n={reasonCount} /></StepTab>
          <StepTab value="breakdowns">Breakdowns</StepTab>
        </TabsList>
        <TabsContent value="documents" className="mt-2">
          {rows.length ? <DocumentsTab data={data} rows={rows} /> : noMatch}
        </TabsContent>
        <TabsContent value="suppliers" className="mt-2">
          {rows.length ? <SuppliersTab data={data} rows={rows} selected={filters.supplier} onPick={(k) => pick('supplier', k)} /> : noMatch}
        </TabsContent>
        {many && (
          <TabsContent value="months" className="mt-2">
            {rows.length ? <MonthsTab data={data} rows={rows} selected={filters.period} onPick={(p) => pick('period', p)} /> : noMatch}
          </TabsContent>
        )}
        <TabsContent value="reasons" className="mt-2">
          {rows.length ? <ReasonsTab data={data} rows={rows} selected={filters.reason} onPick={(k) => pick('reason', k)} /> : noMatch}
        </TabsContent>
        <TabsContent value="breakdowns" className="mt-2">
          {rows.length ? <BreakdownsTab data={data} rows={rows} selected={(f) => filters[f]} onPick={pick} /> : noMatch}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export const ReasonReconciliationView: React.FC<ReasonReconciliationViewProps> = ({ table }) => {
  if (!table.reco) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
          <Inbox className="h-5 w-5 text-muted-foreground opacity-60" />
          <p className="max-w-md text-sm text-muted-foreground">
            This report carries no reconciliation data to show here. Use Excel or PDF above, or build the report again.
          </p>
        </CardContent>
      </Card>
    );
  }
  return <Workspace data={table.reco} table={table} />;
};
