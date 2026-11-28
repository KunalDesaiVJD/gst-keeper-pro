// On-screen preview for a report — fetches once (via ReportsPage) and lets
// staff look at the data, search/filter it, and open a per-row source PDF,
// before deciding whether they even need an Excel/PDF file at all.
//
// This is a router, not a renderer: the actual body is one of ten bespoke
// view components under ./views/*, one per report data-shape archetype
// (ledger register, as-filed return summary, variance comparison, document
// line items, evidence/event list, profile card, all-clients snapshot,
// annual trend, exceptions list, working paper, reason reconciliation) — each report declares which
// one fits it via ReportDefinition.viewKind. This shell only owns what every
// report needs regardless of shape: the Dialog frame, loading/error states,
// and the Excel/PDF export actions.
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet, FileText, Loader2, AlertCircle, Upload, CloudDownload } from 'lucide-react';
import { WS_BTN } from '@/components/workspace/theme';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition, ReportUpload } from '@/lib/reportRegistry';
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
import { Gstr1YearDocumentsView } from './views/Gstr1YearDocumentsView';
import { ReasonReconciliationView } from './views/ReasonReconciliationView';
import { ItcThreeWayView } from './views/ItcThreeWayView';
import { VendorRiskView } from './views/VendorRiskView';

export interface ReportPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: ReportDefinition | null;
  loading: boolean;
  error: string | null;
  table: ReportTable | null;
  onExport: (format: 'xlsx' | 'pdf') => void;
  exportBusy: 'xlsx' | 'pdf' | null;
  /** A report that reads an uploaded file (report.upload / uploads): save the file picked; the page builds the preview again. */
  onUpload?: (file: File, upload: ReportUpload) => void;
  uploadBusy?: boolean;
  /** A report whose Pull has further actions (report.pull.actions, e.g. "Re-pull missing"): start one. */
  onPull?: (action: string) => void;
  pullBusy?: boolean;
  /** A message about this report's last Pull that stays until the next one (e.g. the extension too old for a part of it). */
  notice?: string | null;
}

/** Every upload the report offers: `upload`, then `uploads`. */
const uploadsOf = (report: ReportDefinition): ReportUpload[] => [...(report.upload ? [report.upload] : []), ...(report.uploads ?? [])];

/** The upload button of a report that reads a file the portal gives only as a download (report.upload). */
const UploadButton: React.FC<{ upload: ReportUpload; onUpload: (file: File, upload: ReportUpload) => void; busy: boolean }> = ({ upload, onUpload, busy }) => {
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={upload.accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onUpload(f, upload); }}
      />
      <Button variant="outline" size="sm" className={WS_BTN} onClick={() => input.current?.click()} disabled={busy} title={upload.hint}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {upload.label}
      </Button>
    </>
  );
};

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
    case 'reason-reconciliation':
      return <ReasonReconciliationView table={table} report={report} />;
    case 'itc-three-way':
      return <ItcThreeWayView table={table} report={report} />;
    case 'vendor-risk':
      return <VendorRiskView table={table} report={report} />;
    case 'gstr1-year-documents':
      return <Gstr1YearDocumentsView table={table} report={report} />;
  }
};

export const ReportPreviewDialog: React.FC<ReportPreviewDialogProps> = ({
  open, onOpenChange, report, loading, error, table, onExport, exportBusy, onUpload, uploadBusy = false, onPull, pullBusy = false, notice,
}) => {
  const uploads = report ? uploadsOf(report) : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] w-full h-[90vh] flex flex-col p-0 gap-0 sm:max-w-[96vw]">
        <DialogHeader className="shrink-0 border-b px-4 pb-2.5 pt-4">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="min-w-0">
              <DialogTitle className="text-base leading-snug">{report?.title || ''}</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">
                {report?.description || 'Fetching from the database…'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {notice && (
          <div role="alert" className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs font-medium text-destructive">
            {notice}
          </div>
        )}

        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <p className="text-sm">Loading report…</p>
          </div>
        )}

        {!loading && error && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-8">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-muted-foreground max-w-xl whitespace-pre-line">{error}</p>
            {onUpload && uploads.map((u) => (
              <div key={u.label} className="mt-2 flex flex-col items-center gap-1">
                <UploadButton upload={u} onUpload={onUpload} busy={uploadBusy} />
                <p className="max-w-md text-[11px] text-muted-foreground">{u.hint}</p>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && table && report && (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
              {uploads.length === 1 && onUpload && (
                <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={uploads[0].hint}>{uploads[0].hint}</span>
              )}
              <div className="flex-1" />
              {onPull && report.pull?.actions?.map((a) => (
                <Button key={a.key} variant="outline" size="sm" className={WS_BTN} onClick={() => onPull(a.key)} disabled={pullBusy} title={a.hint}>
                  {pullBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
                  {a.label}
                </Button>
              ))}
              {onUpload && uploads.map((u) => <UploadButton key={u.label} upload={u} onUpload={onUpload} busy={uploadBusy} />)}
              <Button variant="outline" size="sm" className={WS_BTN} onClick={() => onExport('xlsx')} disabled={exportBusy !== null}>
                {exportBusy === 'xlsx' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                Excel
              </Button>
              <Button variant="outline" size="sm" className={WS_BTN} onClick={() => onExport('pdf')} disabled={exportBusy !== null}>
                {exportBusy === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                PDF
              </Button>
            </div>

            <div className="flex-1 overflow-auto p-3">
              {renderView(report, table)}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
