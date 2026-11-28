import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { WS_PAGE } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';
import { renderReportToExcel } from '@/utils/allClientsReports';
import { renderReportToPdf } from '@/utils/closingBalanceReportsPdf';
import type { PullPlan, PullRun, ReportDefinition, ReportUpload } from '@/lib/reportRegistry';
import { REPORTS_CATALOG } from '@/lib/reportsCatalog';
import { ReportsBrowser } from '@/components/reports/ReportsBrowser';
import { ReportPreviewDialog } from '@/components/reports/ReportPreviewDialog';
import type { ReportTable } from '@/utils/allClientsReports';
import { buildForPeriods, oneMonthPerYear } from '@/lib/reportPeriodMerge';
import { describeJob } from '@/utils/gstr2aVs2bReports';

// Piloted on Notices/Refund/DRC-03 first (the categories that were actively
// broken); ReportPreviewDialog works off any report's build() call, which
// every report already has, so the pilot's done — every report previews
// on screen now instead of forcing an Excel/PDF download to see the data.
const isPreviewable = (_report: ReportDefinition) => true;

interface ClientLite { id: string; name: string; gstin: string; }

const ReportsPage: React.FC = () => {
  const { isStaffRole, user } = useAuth();
  const { selectedMonth } = useMonth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [busy, setBusy] = useState<{ key: string; format: 'xlsx' | 'pdf' } | null>(null);
  const [extReady, setExtReady] = useState(false);
  // The extension's version (from its ready message): a report's Pull plan picks
  // a mode the installed copy understands (an unknown mode would fall through to
  // the extension's ledger chain).
  const [extVersion, setExtVersion] = useState<string | null>(null);
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
  const [uploadBusy, setUploadBusy] = useState(false);
  // A part of a report's last Pull that could not start (e.g. the vendor lookups
  // on an extension too old for them): shown on the page and the preview until
  // the next Pull of that report, never only as a toast.
  const [pullNotice, setPullNotice] = useState<{ key: string; title: string; text: string } | null>(null);
  // The run the app recorded for the job just sent (vendor_lookup_runs): if the
  // extension answers that it could not start, the run says why.
  const pendingRunRef = useRef<PullRun | null>(null);
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
      if (d.__gstkExtensionReady) {
        setExtReady(true);
        if (typeof d.version === 'string') setExtVersion(d.version);
      }
      // An all-clients report's Pull (several clients in one run) answers with its own result message.
      const result = d.__gstkPullSectionResult || d.__gstkPullSectionAllClientsResult;
      if (result) {
        setPullingKey(null);
        const run = pendingRunRef.current;
        pendingRunRef.current = null;
        if (run && !result.ok) void run.failed(String(result.error || 'no reason given'));
        if (result.ok) toast.success('Portal opening in a new tab — type the CAPTCHA there. Once it finishes, come back and reopen this report\'s Preview (it checks for new data automatically for a few minutes if the preview is already open).');
        else toast.error('Could not start the pull: ' + result.error);
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
  const handlePullSection = useCallback(async (report: ReportDefinition, action?: string) => {
    if (!report.pull) return;
    if (!selectedClientId && !report.pull.allClients) { toast.error('Select a client first'); return; }
    // How long the open preview is re-checked: ~6 minutes, or 70 for the Table 8A
    // pull, which waits for the portal to prepare its file (extension 0.18.1 on).
    let pollAttempts = 36;
    if (report.pull.needsMonth && selectedPeriods.length === 0) { toast.error('Select a period first'); return; }
    const actorId = user?.id ?? null;
    if (!extReady) {
      toast.error('Install/enable the GST Keeper browser extension to pull from the portal.');
      // A report that records its runs records this refusal too, so the report shows it.
      if (report.pull.plan && report.pull.recordsRuns && selectedClientId) {
        try {
          const p = await report.pull.plan({ clientId: selectedClientId, periods: selectedPeriods, extVersion: null, action });
          const why = p.blocked || 'No GST Keeper browser extension answered this page: install or enable it, reload this page and click Pull again.';
          setPullNotice({ key: report.key, title: report.title, text: why });
          await p.recordRun?.({ job: null, actorId, extVersion: null, refused: why });
        } catch { /* the toast above already says it */ }
      }
      return;
    }
    if (report.pull.plan) {
      // The report decides what to fetch from what is already stored (only what
      // is missing). The extension runs one job at a time, so a plan with more
      // than one job starts the first now and the next click fetches the rest.
      setPullingKey(report.key);
      let plan: PullPlan;
      try {
        plan = await report.pull.plan({ clientId: selectedClientId ?? '', periods: selectedPeriods, extVersion, action });
      } catch (err) {
        setPullingKey(null);
        toast.error('Could not work out what to pull: ' + (err instanceof Error ? err.message : 'unknown error'));
        return;
      }
      setPullNotice((cur) => (plan.blocked ? { key: report.key, title: report.title, text: plan.blocked } : cur?.key === report.key ? null : cur));
      const [job, ...rest] = plan.jobs;
      // The run of the job about to start (or the refusal of the part that cannot), recorded before anything is sent.
      let run: PullRun | null = null;
      try { run = plan.recordRun ? await plan.recordRun({ job: job ?? null, actorId, extVersion }) : null; }
      catch (err) { console.warn('Could not record the pull run', err); }
      if (!job) { setPullingKey(null); toast.info(plan.note || 'Nothing to pull.'); return; }
      pendingRunRef.current = run;
      if (plan.note) toast.info(plan.note);
      toast.info(`Pulling ${describeJob(job)} in one portal tab: type the CAPTCHA once at login.`);
      if (rest.length) toast.info(`After this finishes, click Pull again to fetch ${rest.map(describeJob).join('; ')}.`);
      if (job.mode === 'gstr9_8a_pull') pollAttempts = 420;
      // A full GSTR-1 pull reads every section of up to twelve months: about 2 minutes a month.
      if (job.mode === 'gstr1_full_pull') pollAttempts = Math.max(36, job.periods.length * 15 + 30);
      // A vendor GSTIN lookup: about 15 seconds a GSTIN on the portal's Search Taxpayer page (0.19.2).
      if (job.mode === 'gstin_search') pollAttempts = Math.max(36, Math.ceil(((job.gstins?.length ?? 0) * 15 + 180) / 10));
      if (job.clientIds) {
        // Several clients, one period: the extension's all-clients pull logs each in turn.
        window.postMessage({
          __gstkPullSectionAllClients: {
            mode: job.mode,
            period_month: job.periods[0],
            clientIds: job.clientIds,
            actorId: user?.id ?? null,
          },
        }, '*');
      } else {
        window.postMessage({
          __gstkPullSection: {
            clientId: job.clientId ?? selectedClientId,
            mode: job.mode,
            period_month: job.periods[0],
            period_months: job.periods,
            ...(job.want ? { want: job.want } : {}),
            ...(job.gstins ? { gstins: job.gstins } : {}),
            ...(run ? { run_id: run.id } : {}),
            actorId: user?.id ?? null,
          },
        }, '*');
      }
    } else {
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
          actorId: user?.id ?? null,
        },
      }, '*');
    }

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
        if (attempts > pollAttempts) { stopPreviewPoll(); return; }
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
  }, [selectedClientId, selectedPeriods, extReady, extVersion, previewOpen, previewReport, stopPreviewPoll, user]);

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

  // Shown next to the picker: a whole-year report (Suspended/Credit Ledger
  // one client, the portal ledgers, the GSTR-3B annual summary) is built once
  // per financial year among the months picked, so this names each of those
  // years, not only the first month's.
  const fyLabel = useMemo(() => {
    const years = oneMonthPerYear(selectedPeriods).map((y) => y.year);
    return years.length > 1 ? `${years.slice(0, -1).join(', ')} and ${years[years.length - 1]}` : years[0] ?? '';
  }, [selectedPeriods]);

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
      if (format === 'xlsx') await renderReportToExcel(table);
      else await renderReportToPdf(table);
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
      if (format === 'xlsx') await renderReportToExcel(previewTable);
      else await renderReportToPdf(previewTable);
      toast.success(`${previewTable.title} downloaded.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed: ${message}`);
    } finally {
      setPreviewExportBusy(null);
    }
  };

  // A report that reads an uploaded file (the GSTR-8A family's Table 8A
  // document details): save it for the client and the periods picked, then
  // build the preview again from what is now stored.
  const handleUpload = async (file: File, upload: ReportUpload) => {
    const report = previewReport;
    if (!report) return;
    if (!selectedClientId) { toast.error('Pick a client first.'); return; }
    setUploadBusy(true);
    try {
      const said = await upload.run({ clientId: selectedClientId, periods: selectedPeriods, file, uploadedBy: user?.firstName || user?.email || null });
      toast.success(said);
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        setPreviewTable(await buildForPeriods(report, selectedPeriods, selectedClientId));
      } catch (err) {
        setPreviewTable(null);
        setPreviewError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setPreviewLoading(false);
      }
    } catch (err) {
      toast.error(`Upload failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setUploadBusy(false);
    }
  };

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  return (
    <div className={WS_PAGE}>
      <PageHeader
        compact
        title="Reports"
        subtitle={`${REPORTS_CATALOG.length} reports — search, browse by category, or pin the ones you run every month`}
        icon={<FileSpreadsheet className="h-4 w-4" />}
      />
      {pullNotice && (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          <span className="flex-1">{pullNotice.title}: {pullNotice.text}</span>
          <button type="button" aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:bg-destructive/20" onClick={() => setPullNotice(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
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
        onUpload={handleUpload}
        uploadBusy={uploadBusy}
        onPull={(a) => { if (previewReport) void handlePullSection(previewReport, a); }}
        pullBusy={!!previewReport && pullingKey === previewReport.key}
        notice={previewReport && pullNotice?.key === previewReport.key ? pullNotice.text : null}
      />
    </div>
  );
};

export default ReportsPage;
