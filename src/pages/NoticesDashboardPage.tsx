import React, { useEffect, useState, useMemo } from 'react';
import { Navigate, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { isExtensionOutdated, isExtensionUpdateRecommended, outdatedExtensionMessage, updateRecommendedMessage } from '@/lib/extensionVersion';
import { useNoticeSet } from '@/hooks/useNoticeSet';
import { isOpen, isOverdue, isDueIn7, isNew, effectiveDue } from '@/utils/noticeDefinitions';
import { istToday, daysBetween } from '@/lib/noticeFacts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { NoticesTopNav } from '@/components/notices/NoticesTopNav';
import NoticesPageHeader from '@/components/notices/NoticesPageHeader';
import { classifyNoticeCategory } from '@/utils/noticeCategoryClassifier';
import { computeNoticeSummary, summaryCellHref, type SummaryCellKind } from '@/utils/noticeSummaryReport';
import { runNoticeSweep } from '@/lib/noticeAutoClose';
import { runNoticeAlerts, describeAlertRun } from '@/lib/noticeAlertQueue';
import { AddNoticeDialog } from '@/components/notices/AddNoticeDialog';
import NoticeWorkQueue from '@/components/notices/NoticeWorkQueue';
import CategorySummaryBars from '@/components/notices/CategorySummaryBars';
import NoticeDrawer from '@/components/notices/NoticeDrawer';
import NeedsAttentionStrip from '@/components/notices/NeedsAttentionStrip';
import Next14DaysStrip, { type DeadlineItem } from '@/components/notices/Next14DaysStrip';
import SyncHealthCard from '@/components/notices/SyncHealthCard';
import {
  Bell, Loader2, RefreshCw, Search, Mail,
} from 'lucide-react';

interface SyncLogRow {
  client_id: string;
  status: 'success' | 'failed';
  created_at: string;
}

interface ClockRow {
  notice_id: string;
  client_id: string;
  deadline_type: string;
  deadline_date: string;
}

interface MiniClient {
  id: string;
  name: string;
  gstin: string | null;
  gst_user_id?: string | null;
  inactive_at_hand?: boolean;
}

const todayISOString = istToday;

const CLOCK_LABELS: Record<string, string> = {
  appeal_s107: 'Appeal (s.107)',
  appeal_s107_condonation: 'Appeal, condonation limit',
  appeal_s112: 'Tribunal appeal (s.112)',
  appeal_s112_condonation: 'Tribunal, condonation limit',
  attachment_expiry: 'Attachment lapses',
};


const NoticesDashboardPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const navigate = useNavigate();
  const { rows, refundRows, drc03Rows, matterExposure, loading, error: noticeError, refetch } = useNoticeSet();

  const [drawerNoticeId, setDrawerNoticeId] = useState<string | null>(null);
  const [drawerClientId, setDrawerClientId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = (noticeId: string, clientId: string) => {
    setDrawerNoticeId(noticeId);
    setDrawerClientId(clientId);
    setDrawerOpen(true);
  };

  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const [searchCompanyOpen, setSearchCompanyOpen] = useState(false);
  const [searchCompanyClients, setSearchCompanyClients] = useState<MiniClient[]>([]);
  const [companySearch, setCompanySearch] = useState('');
  const openSearchCompany = () => {
    setSearchCompanyOpen(true);
    if (searchCompanyClients.length === 0) {
      supabase.from('clients').select('id, name, gstin').eq('notices_sync_excluded', false).order('name').then(({ data }) => {
        setSearchCompanyClients((data || []) as MiniClient[]);
      });
    }
  };
  const filteredSearchCompanyClients = searchCompanyClients.filter((c) => {
    const q = companySearch.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || (c.gstin || '').toLowerCase().includes(q);
  });

  const [extReady, setExtReady] = useState(false);
  const [extVersion, setExtVersion] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncLogs, setSyncLogs] = useState<SyncLogRow[]>([]);
  const [clients, setClients] = useState<MiniClient[]>([]);
  const [emailsSentToday, setEmailsSentToday] = useState<number | null>(null);
  const [previewsToday, setPreviewsToday] = useState<number | null>(null);
  const [alertsMode, setAlertsMode] = useState<string | null>(null);
  const [clocks, setClocks] = useState<ClockRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // A failed portal login is logged as action 'login_failed', not 'notices':
      // read both, or a client whose password changed shows as healthy.
      const startOfTodayIst = new Date(`${todayISOString()}T00:00:00+05:30`).toISOString();
      const horizon = new Date(`${todayISOString()}T00:00:00Z`);
      horizon.setUTCDate(horizon.getUTCDate() + 35);
      const [logRes, clientRes, emailRes, previewRes, settingsRes, clockRes] = await Promise.all([
        supabase.from('client_sync_log').select('client_id, status, created_at').in('action', ['notices', 'login_failed']).order('created_at', { ascending: false }),
        supabase.from('clients').select('id, name, gstin, gst_user_id, inactive_at_hand').eq('notices_sync_excluded', false).order('name'),
        supabase.from('email_outbox').select('id', { count: 'exact', head: true })
          .eq('kind', 'notice_alert').eq('status', 'sent').gte('sent_at', startOfTodayIst),
        supabase.from('email_outbox').select('id', { count: 'exact', head: true })
          .eq('kind', 'notice_alert').eq('status', 'preview').gte('created_at', startOfTodayIst),
        supabase.from('notice_settings').select('alerts_mode').maybeSingle(),
        // Appeal and attachment clocks in the deadline strip's window (statutory clocks writer).
        supabase.from('matter_deadlines').select('notice_id, client_id, deadline_type, deadline_date')
          .in('deadline_type', Object.keys(CLOCK_LABELS)).eq('is_met', false)
          .gte('deadline_date', todayISOString()).lte('deadline_date', horizon.toISOString().slice(0, 10)),
      ]);
      if (!cancelled) {
        setSyncLogs((logRes.data || []) as SyncLogRow[]);
        setClients((clientRes.data || []) as MiniClient[]);
        setEmailsSentToday(emailRes.error ? null : emailRes.count ?? 0);
        setPreviewsToday(previewRes.error ? null : previewRes.count ?? 0);
        setAlertsMode(settingsRes.error ? null : settingsRes.data?.alerts_mode ?? null);
        setClocks(clockRes.error ? [] : (clockRes.data || []) as ClockRow[]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d: any = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) {
        setExtReady(true);
        setExtVersion(d.version || null);
        if (isExtensionOutdated(d.version)) toast.error(outdatedExtensionMessage(d.version));
        else if (isExtensionUpdateRecommended(d.version)) toast.warning(updateRecommendedMessage(d.version), { id: 'ext-update' });
      }
      if (d.__gstkPullSectionAllClientsResult) {
        setSyncing(false);
        if (d.__gstkPullSectionAllClientsResult.ok) {
          toast.success(`Sync started for ${d.__gstkPullSectionAllClientsResult.count} client(s). Complete the CAPTCHA for each as it comes up.`);
        } else {
          toast.error(d.__gstkPullSectionAllClientsResult.error || 'Sync All failed to start.');
        }
      }
    };
    window.addEventListener('message', onMsg);
    const ping = () => window.postMessage({ __gstkAppReady: true }, '*');
    ping();
    const t1 = setTimeout(ping, 400);
    const t2 = setTimeout(ping, 1200);
    return () => { window.removeEventListener('message', onMsg); clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const [sweeping, setSweeping] = useState(false);
  const handleSweep = async () => {
    setSweeping(true);
    const { closed, dueDatesSet, errors } = await runNoticeSweep();
    setSweeping(false);
    if (errors.length) toast.error('Sweep errors: ' + errors.join('; '));
    else {
      const parts: string[] = [];
      if (closed > 0) parts.push(`auto-closed ${closed}`);
      if (dueDatesSet > 0) parts.push(`set due dates on ${dueDatesSet}`);
      if (parts.length > 0) toast.success('Sweep: ' + parts.join(', ') + '.');
      else toast.info('Nothing to update.');
    }
  };

  // The alert engine runs on its own (every 15 minutes, 09:30 IST, Mondays);
  // this runs it now. It never writes the same alert twice.
  const [sendingDigest, setSendingDigest] = useState(false);
  const handleSendDigest = async () => {
    setSendingDigest(true);
    const result = await runNoticeAlerts('all');
    setSendingDigest(false);
    if (result.error) { toast.error(result.error); return; }
    if (result.alertsMode) setAlertsMode(result.alertsMode);
    toast.success(describeAlertRun(result));
  };

  const handleSyncAll = () => {
    if (!extReady) {
      toast.error('GST Keeper browser extension not detected. Install/enable it to use Sync All.');
      return;
    }
    if (isExtensionOutdated(extVersion)) { toast.error(outdatedExtensionMessage(extVersion)); return; }
    setSyncing(true);
    window.postMessage({ __gstkPullSectionAllClients: { mode: 'notices_bundle' } }, '*');
  };

  useEffect(() => { if (noticeError) toast.error(noticeError); }, [noticeError]);

  // ── Derived data ──────────────────────────────────────────────────────────

  const displayRows = categoryFilter
    ? rows.filter((r) => classifyNoticeCategory(r) === categoryFilter)
    : rows;

  const { categoryRows, grandTotal } = computeNoticeSummary(rows, refundRows, drc03Rows);

  // Every number below is a count of canonical flags (public.notice_facts), and
  // each tile opens the list filtered by the same flag — and by the category
  // when one is picked — so the tile and the list always agree.
  const openNotices = displayRows.filter((r) => isOpen(r)).length;
  const overdueRows = displayRows.filter((r) => isOverdue(r));
  const overdue = overdueRows.length;
  const dueSoon = displayRows.filter((r) => isDueIn7(r)).length;
  const newRows = displayRows.filter((r) => isNew(r));
  const newNotices = newRows.length;
  const newGstins = new Set(newRows.map((r) => r.client_id)).size;

  // Exposure: each open dispute once, plus (firm-wide) the open matters' outstanding demand.
  const exposureRows = displayRows.filter((r) => Number(r.exposure_amount) > 0);
  const matterTotals = useMemo(() => {
    let matters = 0;
    let amount = 0;
    matterExposure.forEach((m) => { matters += m.matters; amount += m.amount; });
    return { matters, amount };
  }, [matterExposure]);
  const exposureAmount = exposureRows.reduce((sum, r) => sum + Number(r.exposure_amount), 0)
    + (categoryFilter ? 0 : matterTotals.amount);

  const demandAtRisk = overdueRows.reduce((s, r) => s + (Number(r.amount_of_demand) || 0), 0);
  const oldestOverdueDays = overdueRows.reduce((oldest, r) => {
    const due = effectiveDue(r);
    return due ? Math.max(oldest, daysBetween(due, todayISOString())) : oldest;
  }, 0);

  const newWithDemand = newRows.filter((r) => Number(r.amount_of_demand) > 0).length;
  const unassignedCount = displayRows.filter((r) => isOpen(r) && !r.assign_to_user_id).length;
  const needClosingCount = displayRows.filter((r) => isOpen(r) && !effectiveDue(r) && !r.staff_status).length;

  const displayIds = useMemo(() => new Set(displayRows.map((r) => r.id)), [displayRows]);
  const inNextDays = (date: string | null | undefined, days: number) => {
    if (!date) return false;
    const d = daysBetween(todayISOString(), date);
    return d >= 0 && d <= days;
  };
  const dueSoonBreakdown = {
    replies: dueSoon,
    hearings: displayRows.filter((r) => isOpen(r) && inNextDays(r.hearing_date, 7)).length,
    appeals: clocks.filter((c) => displayIds.has(c.notice_id) && inNextDays(c.deadline_date, 7)).length,
  };

  const nextDeadline = useMemo(() => {
    const upcoming = displayRows
      .filter((r) => isDueIn7(r))
      .map((r) => ({ ...r, _due: effectiveDue(r) || '' }))
      .sort((a, b) => a._due.localeCompare(b._due));
    const first = upcoming[0];
    if (!first) return '';
    const clientName = first.client_name || clients.find((c) => c.id === first.client_id)?.name || '';
    const dueDate = new Date(`${first._due}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
    return `Next: ${clientName} · ${first.form_label || first.notice_type || 'Notice'} · ${dueDate}`;
  }, [displayRows, clients]);

  // Sync health
  const latestLogByClient = new Map<string, SyncLogRow>();
  syncLogs.forEach((l) => { if (!latestLogByClient.has(l.client_id)) latestLogByClient.set(l.client_id, l); });
  const failedLoginsCount = Array.from(latestLogByClient.values()).filter((l) => l.status === 'failed').length;
  const now24h = Date.now() - 24 * 60 * 60 * 1000;
  const clientsSynced24h = new Set(syncLogs.filter((l) => l.status === 'success' && new Date(l.created_at).getTime() > now24h).map((l) => l.client_id)).size;
  const lastSuccessSync = syncLogs.find((l) => l.status === 'success');
  const newNotices24h = rows.filter((r) => isNew(r)).length;

  // Deadline strip window — 35 days so the strip's own "Month" toggle has data
  // to show; it renders only the range it is currently set to.
  const deadlineItems = useMemo<DeadlineItem[]>(() => {
    const items: DeadlineItem[] = [];
    displayRows.forEach((r) => {
      const due = effectiveDue(r);
      if (isOpen(r) && inNextDays(due, 35)) {
        items.push({ date: due as string, type: 'reply_due', label: r.form_label || r.notice_type || 'Notice', noticeId: r.id ?? undefined, clientId: r.client_id ?? undefined });
      }
      if (isOpen(r) && inNextDays(r.hearing_date, 35)) {
        items.push({ date: r.hearing_date as string, type: 'hearing', label: 'Hearing', noticeId: r.id ?? undefined, clientId: r.client_id ?? undefined });
      }
      if (inNextDays(r.issue_date, 35)) {
        items.push({ date: r.issue_date as string, type: 'issued', label: r.form_label || r.notice_type || 'Issued', noticeId: r.id ?? undefined, clientId: r.client_id ?? undefined });
      }
    });
    clocks.forEach((c) => {
      if (!displayIds.has(c.notice_id)) return;
      items.push({ date: c.deadline_date, type: 'appeal_limitation', label: CLOCK_LABELS[c.deadline_type] || c.deadline_type, noticeId: c.notice_id, clientId: c.client_id });
    });
    return items;
  }, [displayRows, clocks, displayIds]);

  // Sync line for header
  // Clients a Sync All actually covers: portal credentials saved, not marked inactive.
  const syncGstinCount = clients.filter((c) => c.gst_user_id && !c.inactive_at_hand).length;
  const lastSyncTimeStr = lastSuccessSync
    ? new Date(lastSuccessSync.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) +
      ', ' + new Date(lastSuccessSync.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) + ' IST'
    : null;

  const listLink = (filter: string) =>
    `/notices-all?filter=${filter}${categoryFilter ? `&category=${encodeURIComponent(categoryFilter)}` : ''}`;

  // After every hook (Rules of Hooks): an early return above them would change
  // the hook order if the role changes between renders.
  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-4 animate-fade-in">
      {noticeError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Failed to load notices: {noticeError}
        </div>
      )}

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <NoticesPageHeader
        title="Notices & Litigation"
        icon={Bell}
        subtitle={
          <>
            {lastSyncTimeStr && (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                <span>Last sync {lastSyncTimeStr} · {syncGstinCount} GSTINs</span>
              </>
            )}
            {failedLoginsCount > 0 && (
              <Link to="/notices-company-list?status=failed" className="font-semibold text-destructive hover:underline">
                {failedLoginsCount} logins failed
              </Link>
            )}
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40"
              onClick={openSearchCompany}
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Search GSTIN, trade name, ARN…</span>
              <span className="sm:hidden">Search</span>
              <kbd className="ml-2 hidden rounded border bg-muted px-1 py-0.5 text-[9px] font-mono sm:inline">⌘K</kbd>
            </button>
            <AddNoticeDialog onSuccess={refetch} />
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleSendDigest} disabled={sendingDigest}>
              {sendingDigest ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Mail className="mr-1.5 h-3.5 w-3.5" />}
              Run alerts
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={handleSyncAll} disabled={syncing}>
              {syncing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Sync All
            </Button>
          </>
        }
      />

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <NoticesTopNav />

      {/* ── Zone 1: Needs-attention strip ─────────────────────────────────── */}
      <NeedsAttentionStrip
        overdue={overdue}
        total={openNotices}
        dueSoon={dueSoon}
        dueSoonBreakdown={dueSoonBreakdown}
        nextDeadline={nextDeadline}
        newCount={newNotices}
        newGstinCount={newGstins}
        newWithDemand={newWithDemand}
        unassignedCount={unassignedCount}
        exposureAmount={exposureAmount}
        exposureCount={exposureRows.length}
        exposureMatters={categoryFilter ? 0 : matterTotals.matters}
        demandAtRisk={demandAtRisk}
        oldestOverdueDays={oldestOverdueDays}
        needClosingCount={needClosingCount}
        loading={loading}
        onClickOverdue={() => navigate(listLink('overdue'))}
        onClickDueSoon={() => navigate(listLink('due7'))}
        onClickNew={() => navigate(listLink('new'))}
        onClickExposure={() => navigate(listLink('exposure'))}
      />

      {/* ── Zone 2: Work queue ─────────────────────────────────────────────── */}
      <NoticeWorkQueue rows={rows} loading={loading} onChanged={refetch} onSelectNotice={openDrawer} onSweep={handleSweep} sweeping={sweeping} />

      {/* ── Zone 3: Category summary | 14 days | Sync health ──────────────── */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr]">
        {/* Category Summary Bars */}
        <CategorySummaryBars
          categories={categoryRows}
          grandTotal={grandTotal}
          onCategoryClick={(cat) => setCategoryFilter((prev) => (prev === cat ? null : cat))}
          activeCategory={categoryFilter}
          loading={loading}
        />

        {/* Next 14 days */}
        <Next14DaysStrip
          items={deadlineItems}
          onClickItem={(item) => {
            if (item.noticeId && item.clientId) openDrawer(item.noticeId, item.clientId);
          }}
          onClickDate={(dateISO) => navigate(`/notices-all?date=${dateISO}${categoryFilter ? `&category=${encodeURIComponent(categoryFilter)}` : ''}`)}
          loading={loading}
        />

        {/* Sync & alerts */}
        <SyncHealthCard
          lastSync={lastSuccessSync?.created_at || null}
          clientsSynced24h={clientsSynced24h}
          totalClientsWithCreds={syncGstinCount}
          failedLogins={failedLoginsCount}
          newNotices24h={newNotices24h}
          emailsSentToday={emailsSentToday}
          previewsToday={previewsToday}
          alertsMode={alertsMode}
          extensionVersion={extVersion}
          extensionReady={extReady}
        />
      </div>

      {/* ── Search Company dialog ─────────────────────────────────────────── */}
      <Dialog open={searchCompanyOpen} onOpenChange={setSearchCompanyOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Search Company</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={companySearch}
              onChange={(e) => setCompanySearch(e.target.value)}
              placeholder="Search by GSTIN or Trade Name..."
              className="pl-8"
            />
          </div>
          <div className="max-h-[50vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="text-xs">GSTIN</TableHead>
                  <TableHead className="text-xs">Trade Name</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {searchCompanyClients.length === 0 ? (
                  <TableRow><TableCell colSpan={2} className="py-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" /></TableCell></TableRow>
                ) : filteredSearchCompanyClients.length === 0 ? (
                  <TableRow><TableCell colSpan={2} className="py-6 text-center text-xs text-muted-foreground">No companies match.</TableCell></TableRow>
                ) : (
                  filteredSearchCompanyClients.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-xs">
                        <Link to={`/notices-company/${c.id}`} className="text-primary hover:underline" onClick={() => setSearchCompanyOpen(false)}>{c.gstin}</Link>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.name}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSearchCompanyOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NoticeDrawer
        noticeId={drawerNoticeId}
        clientId={drawerClientId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
};

export default NoticesDashboardPage;
