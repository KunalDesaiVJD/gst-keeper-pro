import React, { useEffect, useState, useMemo } from 'react';
import { Navigate, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useNoticeSet, type NoticeSetRow } from '@/hooks/useNoticeSet';
import { isOpen, isOverdue, isDueIn7, isNew } from '@/utils/noticeDefinitions';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { NoticesTopNav } from '@/components/notices/NoticesTopNav';
import { classifyNoticeCategory } from '@/utils/noticeCategoryClassifier';
import { computeNoticeSummary, summaryCellHref, type SummaryCellKind } from '@/utils/noticeSummaryReport';
import { runNoticeSweep } from '@/lib/noticeAutoClose';
import NoticeWorkQueue from '@/components/notices/NoticeWorkQueue';
import NoticeActivityFeed from '@/components/notices/NoticeActivityFeed';
import NoticeDrawer from '@/components/notices/NoticeDrawer';
import NeedsAttentionStrip from '@/components/notices/NeedsAttentionStrip';
import AgeingExposurePanel from '@/components/notices/AgeingExposurePanel';
import Next14DaysStrip, { type DeadlineItem } from '@/components/notices/Next14DaysStrip';
import SyncHealthCard from '@/components/notices/SyncHealthCard';
import {
  Bell, Building2, Loader2, RefreshCw, RotateCcw, Search,
} from 'lucide-react';

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

interface SyncLogRow {
  client_id: string;
  status: 'success' | 'failed';
  created_at: string;
}

interface MiniClient {
  id: string;
  name: string;
  gstin: string | null;
}

function todayISOString(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

const NoticesDashboardPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const navigate = useNavigate();
  const { rows, refundRows, drc03Rows, loading, error: noticeError } = useNoticeSet();

  // Notice drawer state
  const [drawerNoticeId, setDrawerNoticeId] = useState<string | null>(null);
  const [drawerClientId, setDrawerClientId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = (noticeId: string, clientId: string) => {
    setDrawerNoticeId(noticeId);
    setDrawerClientId(clientId);
    setDrawerOpen(true);
  };

  // Category drill-down filter
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  // Search Company dialog
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

  // Extension handshake
  const [extReady, setExtReady] = useState(false);
  const [extVersion, setExtVersion] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Sync logs for health card
  const [syncLogs, setSyncLogs] = useState<SyncLogRow[]>([]);

  // Client list for ageing panel
  const [clients, setClients] = useState<MiniClient[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [logRes, clientRes] = await Promise.all([
        supabase.from('client_sync_log').select('client_id, status, created_at').eq('action', 'notices').order('created_at', { ascending: false }),
        supabase.from('clients').select('id, name, gstin').eq('notices_sync_excluded', false).order('name'),
      ]);
      if (!cancelled) {
        setSyncLogs((logRes.data || []) as SyncLogRow[]);
        setClients((clientRes.data || []) as MiniClient[]);
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
        if (d.version && compareVersions(d.version, '0.3.0') < 0) {
          toast.error('Extension v' + d.version + ' is outdated. Please update to v0.3.0+ for reliable sync.');
        }
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

  const handleSyncAll = () => {
    if (!extReady) {
      toast.error('GST Keeper browser extension not detected. Install/enable it to use Sync All.');
      return;
    }
    setSyncing(true);
    window.postMessage({ __gstkPullSectionAllClients: { mode: 'notices_bundle' } }, '*');
  };

  useEffect(() => { if (noticeError) toast.error(noticeError); }, [noticeError]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  // ── Derived data ──────────────────────────────────────────────────────────

  const displayRows = categoryFilter
    ? rows.filter((r) => classifyNoticeCategory(r) === categoryFilter)
    : rows;

  const totalNotices = displayRows.length;
  const openNotices = displayRows.filter((r) => isOpen(r)).length;
  const overdue = displayRows.filter((r) => isOverdue(r)).length;
  const dueSoon = displayRows.filter((r) => isDueIn7(r)).length;
  const newNotices = displayRows.filter((r) => isNew(r)).length;
  const newGstins = new Set(displayRows.filter((r) => isNew(r)).map((r) => r.client_id)).size;

  // Exposure: sum of amount_of_demand for open notices
  const openWithDemand = displayRows.filter((r) => isOpen(r) && r.amount_of_demand && r.amount_of_demand > 0);
  const exposureAmount = openWithDemand.reduce((sum, r) => sum + (r.amount_of_demand || 0), 0);

  // Sync health metrics
  const latestLogByClient = new Map<string, SyncLogRow>();
  syncLogs.forEach((l) => { if (!latestLogByClient.has(l.client_id)) latestLogByClient.set(l.client_id, l); });
  const failedLoginsCount = Array.from(latestLogByClient.values()).filter((l) => l.status === 'failed').length;
  const now24h = Date.now() - 24 * 60 * 60 * 1000;
  const clientsSynced24h = new Set(syncLogs.filter((l) => l.status === 'success' && new Date(l.created_at).getTime() > now24h).map((l) => l.client_id)).size;
  const lastSuccessSync = syncLogs.find((l) => l.status === 'success');
  const newNotices24h = rows.filter((r) => r.first_seen_at && new Date(r.first_seen_at).getTime() > now24h).length;
  const changedRows24h = rows.filter((r) => {
    if (!r.pulled_at) return false;
    const pulledTime = new Date(r.pulled_at).getTime();
    if (pulledTime <= now24h) return false;
    if (!r.issue_date) return false;
    const issueTime = new Date(r.issue_date).getTime();
    return issueTime < now24h;
  }).length;

  // Next 14 days deadline items
  const deadlineItems = useMemo<DeadlineItem[]>(() => {
    const today = todayISOString();
    const in14 = new Date(today);
    in14.setDate(in14.getDate() + 14);
    const end = in14.toISOString().slice(0, 10);
    const items: DeadlineItem[] = [];
    const clientMap = new Map(clients.map((c) => [c.id, c.name]));

    rows.forEach((r) => {
      const due = r.extended_due_date || r.due_date;
      if (due && due >= today && due <= end && isOpen(r)) {
        items.push({
          date: due,
          type: 'reply_due',
          label: r.notice_type || 'Notice',
          noticeId: r.id,
          clientId: r.client_id,
        });
      }
      if (r.issue_date && r.issue_date >= today && r.issue_date <= end) {
        items.push({
          date: r.issue_date,
          type: 'issued',
          label: r.notice_type || 'Issued',
          noticeId: r.id,
          clientId: r.client_id,
        });
      }
    });
    return items;
  }, [rows, clients]);

  // Category summary
  const { categoryRows, grandTotal } = computeNoticeSummary(rows, refundRows, drc03Rows);

  // Ageing panel data
  const ageingNotices = useMemo(() =>
    rows.map((r) => ({
      id: r.id,
      client_id: r.client_id,
      staff_status: r.staff_status,
      due_date: r.due_date,
      extended_due_date: r.extended_due_date,
      amount_of_demand: r.amount_of_demand,
    })),
  [rows]);

  const ageingClients = useMemo(() =>
    clients.map((c) => ({ id: c.id, name: c.name })),
  [clients]);

  return (
    <div className="space-y-4 animate-fade-in">
      {noticeError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Failed to load notices: {noticeError}
        </div>
      )}

      {/* ── Header bar ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title="Notices Dashboard"
          icon={<Bell className="h-5 w-5" />}
          embedded
        />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={openSearchCompany}>
            <Search className="mr-1.5 h-3.5 w-3.5" /> Search Company
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleSweep} disabled={sweeping}>
            {sweeping ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
            Sweep
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleSyncAll} disabled={syncing}>
            {syncing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Sync All
          </Button>
          <NoticesTopNav />
        </div>
      </div>

      {/* ── Zone 1: Needs-attention strip ─────────────────────────────────── */}
      <NeedsAttentionStrip
        overdue={overdue}
        total={totalNotices}
        dueSoon={dueSoon}
        newCount={newNotices}
        newGstinCount={newGstins}
        exposureAmount={exposureAmount}
        exposureCount={openWithDemand.length}
        loading={loading}
        onClickOverdue={() => navigate('/notices-all?filter=overdue')}
        onClickDueSoon={() => navigate('/notices-all?filter=due7')}
        onClickNew={() => navigate('/notices-all?filter=new')}
        onClickExposure={() => navigate('/notices-all?status=Open')}
      />

      {/* ── Zone 2: Main content — left (work queue + categories + 14-day) | right (ageing + sync) */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Left column: 2/3 width */}
        <div className="space-y-4 xl:col-span-2">
          {/* Work queue + Activity feed side by side */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <NoticeWorkQueue onSelectNotice={openDrawer} />
            <NoticeActivityFeed onSelectNotice={openDrawer} />
          </div>

          {/* Notice Summary table */}
          <Card>
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="text-sm">Notice Summary</CardTitle>
              <CardDescription className="text-[11px]">
                Click a row to drill the tiles into just that category
                {categoryFilter && (
                  <>
                    {' '}·{' '}
                    <button
                      type="button"
                      className="font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => setCategoryFilter(null)}
                    >
                      clear "{categoryFilter}"
                    </button>
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-3">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : categoryRows.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No notices on record yet.</p>
              ) : (
                <div className="overflow-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow>
                        <TableHead className="bg-muted/60 px-2 py-1.5 text-[11px] font-semibold">Remarks</TableHead>
                        <TableHead className="bg-muted/60 px-2 py-1.5 text-right text-[11px] font-semibold">Total</TableHead>
                        <TableHead className="bg-muted/60 px-2 py-1.5 text-right text-[11px] font-semibold">Open</TableHead>
                        <TableHead className="bg-muted/60 px-2 py-1.5 text-right text-[11px] font-semibold">Closed</TableHead>
                        <TableHead className="bg-muted/60 px-2 py-1.5 text-right text-[11px] font-semibold">Replied</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categoryRows.map((r) => {
                        const cell = (kind: SummaryCellKind, value: number) => {
                          const href = summaryCellHref(r, kind);
                          return (
                            <TableCell
                              key={kind}
                              className={cn(
                                'px-2 py-1 text-right text-[11px] tabular-nums',
                                href && 'cursor-pointer text-primary underline-offset-2 hover:underline',
                              )}
                              onClick={href ? (e) => { e.stopPropagation(); navigate(href); } : undefined}
                            >
                              {value || '—'}
                            </TableCell>
                          );
                        };
                        return (
                          <TableRow
                            key={r.type}
                            className={cn(
                              !r.placeholder && 'cursor-pointer',
                              categoryFilter === r.type && 'bg-primary/10 hover:bg-primary/15',
                            )}
                            onClick={r.placeholder ? undefined : () => (r.to ? navigate(r.to) : setCategoryFilter((prev) => (prev === r.type ? null : r.type)))}
                          >
                            <TableCell className={cn('px-2 py-1 text-[11px] font-medium', r.placeholder ? 'text-muted-foreground' : 'text-primary')}>{r.type}</TableCell>
                            {cell('total', r.total)}
                            {cell('open', r.open)}
                            {cell('closed', r.closed)}
                            {cell('replied', r.replied)}
                          </TableRow>
                        );
                      })}
                      <TableRow className="bg-primary/5 font-semibold hover:bg-primary/10">
                        <TableCell className="px-2 py-1 text-[11px]">Total</TableCell>
                        <TableCell className="px-2 py-1 text-right text-[11px] tabular-nums">{grandTotal.total}</TableCell>
                        <TableCell className="px-2 py-1 text-right text-[11px] tabular-nums">{grandTotal.open}</TableCell>
                        <TableCell className="px-2 py-1 text-right text-[11px] tabular-nums">{grandTotal.closed}</TableCell>
                        <TableCell className="px-2 py-1 text-right text-[11px] tabular-nums">{grandTotal.replied}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Next 14 days strip */}
          <Next14DaysStrip
            items={deadlineItems}
            onClickItem={(item) => {
              if (item.noticeId && item.clientId) openDrawer(item.noticeId, item.clientId);
            }}
            onClickDate={(dateISO) => navigate(`/notices-all?due_date=${dateISO}`)}
            loading={loading}
          />
        </div>

        {/* Right column: 1/3 width */}
        <div className="space-y-4">
          {/* Ageing & Exposure panel */}
          <AgeingExposurePanel
            notices={ageingNotices}
            clients={ageingClients}
            loading={loading}
          />

          {/* Sync Health card */}
          <SyncHealthCard
            lastSync={lastSuccessSync?.created_at || null}
            clientsSynced24h={clientsSynced24h}
            failedLogins={failedLoginsCount}
            newNotices24h={newNotices24h}
            changedRows24h={changedRows24h}
            extensionVersion={extVersion}
            extensionReady={extReady}
          />
        </div>
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
