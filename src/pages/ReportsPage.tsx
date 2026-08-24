import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { buildForPeriods } from '@/lib/reportPeriodMerge';

// Piloted on Notices/Refund/DRC-03 first (the categories that were actively
// broken); ReportPreviewDialog works off any report's build() call, which
// every report already has, so the pilot's done — every report previews
// on screen now instead of forcing an Excel/PDF download to see the data.
const isPreviewable = (_report: ReportDefinition) => true;

interface ClientLite { id: string; name: string; gstin: string; }

const ReportsPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const { selectedMonth } = useMonth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [busy, setBusy] = useState<{ key: string; format: 'xlsx' | 'pdf' } | null>(null);
  const [extReady, setExtReady] = useState(false);
  const [pullingKey, setPullingKey] = useState<string | null>(null);
  // Multi-select periods, local to Reports — the global Month context stays
  // a single value for every other page, so this seeds from it once but
  // doesn't write back. View/Excel/PDF combine every selected period into
  // one table (see reportPeriodMerge.ts); Pull sends every selected period
  // to the extension as one job, which walks them in turn (see
  // handlePullSection below).
  const [selectedPeriods, setSelectedPeriods] = useState<string[]>(selectedMonth ? [selectedMonth] : []);
  const [previewReport, setPreviewReport] = useState<ReportDefinition | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewTable, setPreviewTable] = useState<ReportTable | null>(null);
  const [previewExportBusy, setPreviewExportBusy] = useState<'xlsx' | 'pdf' | null>(null);
  // Silent background refresh after Pull — see handlePullSection. Keyed to
  // the report it was started for, so switching to a different report's
  // preview (or closing the dialog) doesn't keep overwriting it with stale
  // polls from the one you pulled.
  const pollRef = useRef<{ key: string; timer: ReturnType<typeof setInterval> } | null>(null);
  const stopPreviewPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current.timer); pollRef.current = null; }
  }, []);

  useEffect(() => {
    supabase.from('clients').select('id, name, gstin').order('name').then(({ data }) => {
      setClients((data || []) as ClientLite[]);
    });
  }, []);

  // Stop polling once the dialog is closed, or once it's showing a different
  // report than the one the poll was started for.
  useEffect(() => {
    if (!previewOpen || previewReport?.key !== pollRef.current?.key) stopPreviewPoll();
  }, [previewOpen, previewReport, stopPreviewPoll]);
  useEffect(() => () => stopPreviewPoll(), [stopPreviewPoll]);

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
        if (d.__gstkPullSectionResult.ok) toast.success('Portal opening in a new tab — type the CAPTCHA there. Once it finishes, come back and reopen this report\'s Preview (it checks for new data automatically for a few minutes if the preview is already open).');
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

  // Pull queues every selected period for the one client in a single
  // extension job (chrome.storage holds one active job, but that job now
  // carries a `periods` queue — see startSectionPull/advance() in the
  // extension) — the tab logs in once, then walks each period in turn
  // without logging out in between. __gstkPullSectionResult only means "the
  // portal tab opened", not "the pull completed" — CAPTCHA/login/scrape for
  // every queued period still happens asynchronously in that tab afterward.
  const handlePullSection = useCallback((report: ReportDefinition) => {
    if (!report.pull) return;
    if (!selectedClientId) { toast.error('Select a client first'); return; }
    if (report.pull.needsMonth && selectedPeriods.length === 0) { toast.error('Select a period first'); return; }
    if (!extReady) { toast.error('Install/enable the GST Keeper browser extension to pull from the portal.'); return; }
    if (report.pull.needsMonth && selectedPeriods.length > 1) {
      toast.info(`Pulling all ${selectedPeriods.length} selected periods in one portal tab — type the CAPTCHA once at login.`);
    }
    setPullingKey(report.key);
    window.postMessage({
      __gstkPullSection: {
        clientId: selectedClientId,
        mode: report.pull.mode,
        period_month: report.pull.needsMonth ? selectedPeriods[0] : undefined,
        period_months: report.pull.needsMonth ? selectedPeriods : undefined,
      },
    }, '*');

    // If this report's preview is already open, silently re-check for new
    // data every 10s for up to ~6 minutes — covers login+CAPTCHA+scrape time
    // in the portal tab without the user needing to manually reopen Preview
    // afterward. Errors (still empty, not-there-yet) are swallowed — this is
    // a background retry, not a user-facing fetch.
    if (previewOpen && previewReport?.key === report.key) {
      stopPreviewPoll();
      let attempts = 0;
      const timer = setInterval(async () => {
        attempts += 1;
        if (attempts > 36) { stopPreviewPoll(); return; }
        try {
          const table = await buildForPeriods(report, selectedPeriods, selectedClientId);
          setPreviewTable(table);
          setPreviewError(null);
        } catch {
          // Not saved yet (or still genuinely empty) — try again next tick.
        }
      }, 10000);
      pollRef.current = { key: report.key, timer };
    }
  }, [selectedClientId, selectedPeriods, extReady, previewOpen, previewReport, stopPreviewPoll]);

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

  // Shown next to the picker so "one FY = 12 periods selected" reads as
  // deliberate rather than an accident when Suspended/Credit Ledger-style
  // reports still narrate "the financial year of the selected month".
  const fyLabel = useMemo(
    () => (selectedPeriods[0] ? fyMonthsForKey(selectedPeriods[0]).fyLabel : ''),
    [selectedPeriods],
  );

  const handleDownload = async (report: ReportDefinition, format: 'xlsx' | 'pdf') => {
    if ((report.needs === 'month' || report.needs === 'client+month') && selectedPeriods.length === 0) {
      toast.error('Pick at least one period first.');
      return;
    }
    if ((report.needs === 'client+month' || report.needs === 'client') && !selectedClientId) {
      toast.error('Pick a client first.');
      return;
    }
    setBusy({ key: report.key, format });
    try {
      const table = await buildForPeriods(report, selectedPeriods, selectedClientId);
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
    if ((report.needs === 'month' || report.needs === 'client+month') && selectedPeriods.length === 0) {
      toast.error('Pick at least one period first.');
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
      const table = await buildForPeriods(report, selectedPeriods, selectedClientId);
      setPreviewTable(table);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedPeriods, selectedClientId]);

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
        selectedPeriods={selectedPeriods}
        onPeriodsChange={setSelectedPeriods}
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
        report={previewReport}
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
