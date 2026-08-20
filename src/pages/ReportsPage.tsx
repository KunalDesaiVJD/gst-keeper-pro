import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';
import { renderReportToExcel, fyMonthsForKey } from '@/utils/allClientsReports';
import { renderReportToPdf } from '@/utils/closingBalanceReportsPdf';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { REPORTS_CATALOG } from '@/lib/reportsCatalog';
import { ReportsBrowser } from '@/components/reports/ReportsBrowser';
import { ReportPreviewDialog } from '@/components/reports/ReportPreviewDialog';
import type { ReportTable } from '@/utils/allClientsReports';

// Piloted on Notices/Refund/DRC-03 first (the categories that were actively
// broken); ReportPreviewDialog works off any report's build() call, which
// every report already has, so the pilot's done — every report previews
// on screen now instead of forcing an Excel/PDF download to see the data.
const isPreviewable = (_report: ReportDefinition) => true;

interface ClientLite { id: string; name: string; gstin: string; }

const ReportsPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [busy, setBusy] = useState<{ key: string; format: 'xlsx' | 'pdf' } | null>(null);
  const [extReady, setExtReady] = useState(false);
  const [pullingKey, setPullingKey] = useState<string | null>(null);
  const [previewReport, setPreviewReport] = useState<ReportDefinition | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewTable, setPreviewTable] = useState<ReportTable | null>(null);
  const [previewExportBusy, setPreviewExportBusy] = useState<'xlsx' | 'pdf' | null>(null);

  useEffect(() => {
    supabase.from('clients').select('id, name, gstin').order('name').then(({ data }) => {
      setClients((data || []) as ClientLite[]);
    });
  }, []);

  // Detect the browser extension the same way GST Receivable Reco does — ping
  // on mount (twice, since the extension's content script and this page can
  // each load first) and listen for its announcement + the Pull result.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d: any = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) setExtReady(true);
      if (d.__gstkPullSectionResult) {
        setPullingKey(null);
        if (d.__gstkPullSectionResult.ok) toast.success('Portal opening in a new tab — type the CAPTCHA there; the report will refresh once the pull finishes.');
        else toast.error('Could not start the pull: ' + d.__gstkPullSectionResult.error);
      }
    };
    window.addEventListener('message', onMsg);
    const ping = () => window.postMessage({ __gstkAppReady: true }, '*');
    ping();
    const t1 = setTimeout(ping, 400);
    const t2 = setTimeout(ping, 1200);
    return () => { window.removeEventListener('message', onMsg); clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const handlePullSection = useCallback((report: ReportDefinition) => {
    if (!report.pull) return;
    if (!selectedClientId) { toast.error('Select a client first'); return; }
    if (report.pull.needsMonth && !selectedMonth) { toast.error('Select a month first'); return; }
    if (!extReady) { toast.error('Install/enable the GST Keeper browser extension to pull from the portal.'); return; }
    setPullingKey(report.key);
    window.postMessage({
      __gstkPullSection: {
        clientId: selectedClientId,
        mode: report.pull.mode,
        period_month: report.pull.needsMonth ? selectedMonth : undefined,
      },
    }, '*');
  }, [selectedClientId, selectedMonth, extReady]);

  const monthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const start = new Date(2024, 3, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 1);
    const cur = new Date(start);
    while (cur <= end) {
      const mm = String(cur.getMonth() + 1).padStart(2, '0');
      months.push({ value: `${mm}/${cur.getFullYear()}`, label: `${monthNames[cur.getMonth()]} ${cur.getFullYear()}` });
      cur.setMonth(cur.getMonth() + 1);
    }
    return months.sort((a, b) => {
      const [aM, aY] = a.value.split('/').map(Number);
      const [bM, bY] = b.value.split('/').map(Number);
      return bY * 12 + bM - (aY * 12 + aM);
    });
  }, []);

  const fyLabel = useMemo(() => (selectedMonth ? fyMonthsForKey(selectedMonth).fyLabel : ''), [selectedMonth]);

  const handleDownload = async (report: ReportDefinition, format: 'xlsx' | 'pdf') => {
    if ((report.needs === 'month' || report.needs === 'client+month') && !selectedMonth) {
      toast.error('Pick a month first.');
      return;
    }
    if ((report.needs === 'client+month' || report.needs === 'client') && !selectedClientId) {
      toast.error('Pick a client first.');
      return;
    }
    setBusy({ key: report.key, format });
    try {
      const table = await report.build({ month: selectedMonth, clientId: selectedClientId });
      if (format === 'xlsx') renderReportToExcel(table);
      else renderReportToPdf(table);
      toast.success(`${report.title} downloaded.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed: ${message}`);
    } finally {
      setBusy(null);
    }
  };

  const handlePreview = useCallback(async (report: ReportDefinition) => {
    if ((report.needs === 'month' || report.needs === 'client+month') && !selectedMonth) {
      toast.error('Pick a month first.');
      return;
    }
    if ((report.needs === 'client+month' || report.needs === 'client') && !selectedClientId) {
      toast.error('Pick a client first.');
      return;
    }
    setPreviewReport(report);
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewTable(null);
    try {
      const table = await report.build({ month: selectedMonth, clientId: selectedClientId });
      setPreviewTable(table);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedMonth, selectedClientId]);

  const handleExportFromPreview = async (format: 'xlsx' | 'pdf') => {
    if (!previewTable) return;
    setPreviewExportBusy(format);
    try {
      if (format === 'xlsx') renderReportToExcel(previewTable);
      else renderReportToPdf(previewTable);
      toast.success(`${previewTable.title} downloaded.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed: ${message}`);
    } finally {
      setPreviewExportBusy(null);
    }
  };

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Reports"
        subtitle={`${REPORTS_CATALOG.length} reports — search, browse by category, or pin the ones you run every month`}
        icon={<FileSpreadsheet className="h-6 w-6" />}
      />
      <ReportsBrowser
        reports={REPORTS_CATALOG}
        monthOptions={monthOptions}
        selectedMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
        clients={clients}
        selectedClientId={selectedClientId}
        onClientChange={setSelectedClientId}
        fyLabel={fyLabel}
        busy={busy}
        onDownload={handleDownload}
        onPullSection={handlePullSection}
        pullingKey={pullingKey}
        extReady={extReady}
        isPreviewable={isPreviewable}
        onPreview={handlePreview}
      />
      <ReportPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title={previewReport?.title || ''}
        loading={previewLoading}
        error={previewError}
        table={previewTable}
        onExport={handleExportFromPreview}
        exportBusy={previewExportBusy}
      />
    </div>
  );
};

export default ReportsPage;
