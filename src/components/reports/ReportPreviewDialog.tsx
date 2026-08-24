// On-screen preview for a report — fetches once (via ReportsPage) and lets
// staff look at the data, search/filter it, and open a per-row source PDF,
// before deciding whether they even need an Excel/PDF file at all.
//
// This is a router, not a renderer: the actual body is one of ten bespoke
// view components under ./views/*, one per report data-shape archetype
// (ledger register, as-filed return summary, variance comparison, document
// line items, evidence/event list, profile card, all-clients snapshot,
// annual trend, exceptions list, working paper) — each report declares which
// one fits it via ReportDefinition.viewKind. This shell only owns what every
// report needs regardless of shape: the Dialog frame, loading/error states,
// and the Excel/PDF export actions.
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet, FileText, Loader2, AlertCircle } from 'lucide-react';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { LedgerRegisterView } from './views/LedgerRegisterView';
import { FiledReturnSummaryView } from './views/FiledReturnSummaryView';
import { VarianceComparisonView } from './views/VarianceComparisonView';
import { DocumentLineItemsView } from './views/DocumentLineItemsView';
import { EvidenceEventListView } from './views/EvidenceEventListView';
import { NoticeWorkflowListView } from './views/NoticeWorkflowListView';
import { ProfileCardView } from './views/ProfileCardView';
import { AllClientsSnapshotView } from './views/AllClientsSnapshotView';
import { AnnualTrendView } from './views/AnnualTrendView';
import { ExceptionsListView } from './views/ExceptionsListView';
import { WorkingPaperView } from './views/WorkingPaperView';

export interface ReportPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: ReportDefinition | null;
  loading: boolean;
  error: string | null;
  table: ReportTable | null;
  onExport: (format: 'xlsx' | 'pdf') => void;
  exportBusy: 'xlsx' | 'pdf' | null;
}

const renderView = (report: ReportDefinition, table: ReportTable): React.ReactNode => {
  switch (report.viewKind) {
    case 'ledger-register':
      return <LedgerRegisterView table={table} report={report} />;
    case 'filed-return-summary':
      return <FiledReturnSummaryView table={table} report={report} />;
    case 'variance-comparison':
      return <VarianceComparisonView table={table} report={report} />;
    case 'document-line-items':
      return <DocumentLineItemsView table={table} report={report} />;
    case 'evidence-event-list':
      return <EvidenceEventListView table={table} report={report} />;
    case 'notice-workflow-list':
      return <NoticeWorkflowListView table={table} report={report} />;
    case 'profile-card':
      return <ProfileCardView table={table} report={report} />;
    case 'all-clients-snapshot':
      return <AllClientsSnapshotView table={table} report={report} />;
    case 'annual-trend':
      return <AnnualTrendView table={table} report={report} />;
    case 'exceptions-list':
      return <ExceptionsListView table={table} report={report} />;
    case 'working-paper':
      return <WorkingPaperView table={table} report={report} />;
  }
};

export const ReportPreviewDialog: React.FC<ReportPreviewDialogProps> = ({
  open, onOpenChange, report, loading, error, table, onExport, exportBusy,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] w-full h-[90vh] flex flex-col p-0 gap-0 sm:max-w-[96vw]">
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="min-w-0">
              <DialogTitle className="text-lg">{report?.title || ''}</DialogTitle>
              <DialogDescription className="mt-1">
                {report?.description || 'Fetching from the database…'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Loading report…</p>
          </div>
        )}

        {!loading && error && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-8">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p className="text-sm text-muted-foreground max-w-md">{error}</p>
          </div>
        )}

        {!loading && !error && table && report && (
          <>
            <div className="flex items-center gap-3 px-5 py-2.5 border-b shrink-0">
              <div className="flex-1" />
              <Button variant="outline" size="sm" onClick={() => onExport('xlsx')} disabled={exportBusy !== null}>
                {exportBusy === 'xlsx' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />}
                Excel
              </Button>
              <Button variant="outline" size="sm" onClick={() => onExport('pdf')} disabled={exportBusy !== null}>
                {exportBusy === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FileText className="h-3.5 w-3.5 mr-1.5" />}
                PDF
              </Button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {renderView(report, table)}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
