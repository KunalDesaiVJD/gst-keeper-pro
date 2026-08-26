// NoticesDashboardPage — the firm-wide counterpart to the per-client "View
// Notice and Orders" report: one query across every client's gst_notices
// rows, summarized as KPI tiles + a category breakdown table (Total/Open/
// Closed/Replied per notice type), matching the portfolio-wide dashboard
// pattern the user pointed to (Notice Alert's GST Dashboard). The KPI tiles
// stay scoped to what gst_notices holds (Notices/Orders, LUT, DRC-03
// voluntary payment) — but the Notice Summary table below also folds in
// Refund and DRC-03 rows from their own tables (gst_refund_applications,
// gst_drc03_filings), since we already capture that data even though the
// tiles don't count it. The remaining Notice Alert categories (Appeal,
// ASMT 10, Audit, Enforcement, Recovery, Non filers, TRAN 1, Anti evasion,
// Demand, Ewaybill, AAR, Registration) have no portal capture in this app
// yet — each needs its own reverse-engineering pass against the live GST
// portal, scoped separately per the user's 2026-08-24 decision.
import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import BulkAddClientsDialog, { downloadClientImportTemplate } from '@/components/clients/BulkAddClientsDialog';
import { classifyNoticeCategory, isRegistrationRelated as isRegistrationDescription, UNCAPTURED_NOTICE_CATEGORIES, NOTICE_CATEGORY_DISPLAY_ORDER } from '@/utils/noticeCategoryClassifier';
import {
  Bell, CalendarClock, History, Building2, FolderOpen, AlertTriangle, Flag, Loader2,
  UserPlus, Upload, Download, RefreshCw, Pencil, ChevronLeft, ChevronRight,
  LayoutDashboard, Send, FileBarChart2,
} from 'lucide-react';

interface NoticeRow {
  client_id: string;
  notice_type: string | null;
  description: string | null;
  staff_status: string | null;
  priority: string | null;
  issue_date: string | null;
  due_date: string | null;
  reply_date: string | null;
  pulled_at: string;
}

// "Registration" isn't its own notice_type in this schema — it shows up as a
// Registration Certificate/Rejection/SCN description under the "Order" or
// "Notice" type instead (see noticeRefundDrc03Reports.ts's Notices builder).
// So this filter matches on description text, the same way the underlying
// data actually distinguishes a registration-related notice from any other.
type TypeOfNoticesFilter = 'all' | 'registration' | 'other';
const isRegistrationRelated = (r: NoticeRow) => isRegistrationDescription(r.description);

interface CategoryRow {
  type: string;
  total: number;
  open: number;
  closed: number;
  replied: number;
  // Refund/DRC-03 rows come from separate tables entirely (not gst_notices),
  // so clicking them can't reuse the in-page categoryFilter mechanism —
  // they link straight to their own firm-wide drill-down page instead.
  to?: string;
  // Zero-value row for a category this app has no portal capture for yet —
  // rendered plain/non-clickable, matching Notice Alert's own convention.
  placeholder?: boolean;
}

const isClosed = (s: string | null) => (s || '').trim().toLowerCase() === 'closed';

// Refund status strings observed from the real portal pull (see
// noticeRefundDrc03Reports.ts) — "filed"/"deficiency memo" are still
// pending action, everything else (disbursed/withdrawn/recredit) is final.
const isRefundClosed = (s: string | null) => /disburs|withdraw|reject|recredit/i.test(s || '');
// DRC-03 status strings observed: "Acknowledged" (final) vs "Pending for
// Action by Tax Officer" (still open).
const isDrc03Closed = (s: string | null) => /acknowledg/i.test(s || '');

interface MiniClient {
  id: string;
  name: string;
  gstin: string | null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Mirrors Notice Alert's own top nav (Dashboard/Notice/Submission/Report) —
// Dashboard is this page; Notice is the unfiltered all-clients list;
// Submission is the same list filtered to rows with a Submission ARN/date
// logged (their "View My Submissions" page, confirmed live); Report is the
// existing Reports Hub, which already carries every per-client Notice/
// Refund/DRC-03 report.
const NAV_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/notices-dashboard', active: true },
  { label: 'Notice', icon: Bell, to: '/notices-all', active: false },
  { label: 'Submission', icon: Send, to: '/notices-all?filter=submitted', active: false },
  { label: 'Report', icon: FileBarChart2, to: '/reports', active: false },
];

const NoticesDashboardPage: React.FC = () => {
  const { isStaffRole, canAddEditClients } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<NoticeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeOfNoticesFilter>('all');
  // Clicking a category row drills the whole dashboard (KPI tiles included)
  // down to just that category — click the same row again to clear it.
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  // Company panel — mirrors Notice Alert's mini client list + onboarding shortcuts.
  const [miniClients, setMiniClients] = useState<MiniClient[]>([]);
  const canManageClients = canAddEditClients();

  // Extension handshake for "Sync All", same ping/pong pattern ReportsPage uses
  // for its per-client "Pull" buttons.
  const [extReady, setExtReady] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Calendar widget — month currently shown, defaults to the current month.
  const todayDate = new Date();
  const [calMonth, setCalMonth] = useState(todayDate.getMonth());
  const [calYear, setCalYear] = useState(todayDate.getFullYear());

  // Refund/DRC-03 rows the Notice Summary table folds in — separate tables,
  // status-only select since only the category-row counts are needed here
  // (the drill-down page re-fetches full detail itself).
  const [refundStatuses, setRefundStatuses] = useState<(string | null)[]>([]);
  const [drc03Statuses, setDrc03Statuses] = useState<(string | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('gst_notices')
        .select('client_id, notice_type, description, staff_status, priority, issue_date, due_date, reply_date, pulled_at')
        .eq('source', 'notices');
      if (!cancelled) {
        setRows((data || []) as NoticeRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [refundRes, drc03Res] = await Promise.all([
        supabase.from('gst_refund_applications').select('status'),
        supabase.from('gst_drc03_filings').select('status'),
      ]);
      if (!cancelled) {
        setRefundStatuses((refundRes.data || []).map((r) => r.status));
        setDrc03Statuses((drc03Res.data || []).map((r) => r.status));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, name, gstin')
        .order('created_at', { ascending: false })
        .limit(5);
      if (!cancelled) setMiniClients((data || []) as MiniClient[]);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d: any = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) setExtReady(true);
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

  const handleSyncAll = () => {
    if (!extReady) {
      toast.error('GST Keeper browser extension not detected. Install/enable it to use Sync All.');
      return;
    }
    setSyncing(true);
    window.postMessage({ __gstkPullSectionAllClients: { mode: 'notices' } }, '*');
  };

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const filteredRows = rows.filter((r) => {
    if (typeFilter === 'registration') return isRegistrationRelated(r);
    if (typeFilter === 'other') return !isRegistrationRelated(r);
    return true;
  });
  const displayRows = categoryFilter
    ? filteredRows.filter((r) => classifyNoticeCategory(r) === categoryFilter)
    : filteredRows;

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const daysAgo = (v: string | null) => (v ? (now - new Date(v).getTime()) / DAY_MS : Infinity);
  const daysUntil = (v: string | null) => (v ? (new Date(v).getTime() - now) / DAY_MS : -Infinity);

  const totalNotices = displayRows.length;
  const last15Days = displayRows.filter((r) => daysAgo(r.issue_date) <= 15).length;
  const last24Hours = displayRows.filter((r) => daysAgo(r.pulled_at) <= 1).length;
  const totalGstin = new Set(displayRows.map((r) => r.client_id)).size;
  const openNotices = displayRows.filter((r) => !isClosed(r.staff_status)).length;
  const dueSoon = displayRows.filter((r) => r.due_date && daysUntil(r.due_date) >= 0 && daysUntil(r.due_date) <= 7).length;
  const overdue = displayRows.filter((r) => r.due_date && daysUntil(r.due_date) < 0).length;
  const priorityCount = displayRows.filter((r) => r.priority).length;

  // Every tile except Total GSTIN drills into the firm-wide notice list,
  // carrying the current Type Of Notices / category selections along so the
  // drilled-down list stays consistent with what's on screen — matching
  // Notice Alert's own tile-click behavior (confirmed live: each tile
  // navigates to "Notices and Orders" pre-filtered).
  const drillParams = (extra: Record<string, string>) => {
    const p = new URLSearchParams(extra);
    if (typeFilter !== 'all') p.set('type', typeFilter);
    if (categoryFilter) p.set('category', categoryFilter);
    const qs = p.toString();
    return qs ? `/notices-all?${qs}` : '/notices-all';
  };

  const kpiCards = [
    { label: 'Total Notices', value: totalNotices, icon: <Bell className="h-8 w-8 text-primary" />, bgColor: 'bg-primary/5', to: drillParams({}) },
    { label: 'Last 15 Days', value: last15Days, icon: <CalendarClock className="h-8 w-8 text-info" />, bgColor: 'bg-info/5', to: drillParams({ filter: 'last15' }) },
    { label: 'Last 24 Hours', value: last24Hours, icon: <History className="h-8 w-8 text-info" />, bgColor: 'bg-info/5', to: drillParams({ filter: 'last24h' }) },
    { label: 'Total GSTIN', value: totalGstin, icon: <Building2 className="h-8 w-8 text-secondary-foreground" />, bgColor: 'bg-secondary/40', to: null },
    { label: 'Open Notices', value: openNotices, icon: <FolderOpen className="h-8 w-8 text-warning" />, bgColor: 'bg-warning/5', to: drillParams({ status: 'Open' }) },
    { label: '7 Days Due', value: dueSoon, icon: <CalendarClock className="h-8 w-8 text-warning" />, bgColor: 'bg-warning/5', to: drillParams({ filter: 'due7' }) },
    { label: 'Over Due', value: overdue, icon: <AlertTriangle className="h-8 w-8 text-destructive" />, bgColor: 'bg-destructive/5', to: drillParams({ filter: 'overdue' }) },
    { label: 'Priority', value: priorityCount, icon: <Flag className="h-8 w-8 text-destructive" />, bgColor: 'bg-destructive/5', to: drillParams({ filter: 'priority' }) },
  ];

  const categoryMap = new Map<string, CategoryRow>();
  filteredRows.forEach((r) => {
    const type = classifyNoticeCategory(r);
    const entry = categoryMap.get(type) || { type, total: 0, open: 0, closed: 0, replied: 0 };
    entry.total += 1;
    if (isClosed(r.staff_status)) entry.closed += 1; else entry.open += 1;
    if (r.reply_date) entry.replied += 1;
    categoryMap.set(type, entry);
  });
  // Refund/DRC-03 aren't gst_notices rows — they're folded into the same
  // Notice Summary table Notice Alert shows them in, but as their own rows
  // with their own drill-down page (see AllClientsRefundsPage/Drc03Page)
  // since categoryFilter's local-filter mechanism only works over `rows`.
  if (refundStatuses.length > 0) {
    const closed = refundStatuses.filter((s) => isRefundClosed(s)).length;
    categoryMap.set('Refund', { type: 'Refund', total: refundStatuses.length, open: refundStatuses.length - closed, closed, replied: 0, to: '/refunds-all' });
  }
  if (drc03Statuses.length > 0) {
    const closed = drc03Statuses.filter((s) => isDrc03Closed(s)).length;
    categoryMap.set('DRC 03', { type: 'DRC 03', total: drc03Statuses.length, open: drc03Statuses.length - closed, closed, replied: 0, to: '/drc03-all' });
  }

  // Row order matches Notice Alert's own Notice Summary table exactly
  // (confirmed live 2026-08-25): every canonical category gets its fixed slot
  // whether we have real data for it or not (zero-value placeholder rows,
  // matching Notice Alert's own dashes-not-links convention), then any
  // category this app tracks but Notice Alert's fixed list doesn't cover
  // (Registration/Non filers/Demand Notice/raw notice_type buckets) is
  // appended after, by descending total.
  const FULL_DISPLAY_ORDER = [
    ...NOTICE_CATEGORY_DISPLAY_ORDER,
    ...UNCAPTURED_NOTICE_CATEGORIES.filter((t) => !NOTICE_CATEGORY_DISPLAY_ORDER.includes(t)),
  ];
  const canonicalRows: CategoryRow[] = FULL_DISPLAY_ORDER.map((type) => {
    const real = categoryMap.get(type);
    if (real) { categoryMap.delete(type); return real; }
    return { type, total: 0, open: 0, closed: 0, replied: 0, placeholder: true };
  });
  const extraRealRows = Array.from(categoryMap.values()).sort((a, b) => b.total - a.total);
  const categoryRows = [...canonicalRows, ...extraRealRows];
  const grandTotal = categoryRows.reduce(
    (acc, r) => ({ total: acc.total + r.total, open: acc.open + r.open, closed: acc.closed + r.closed, replied: acc.replied + r.replied }),
    { total: 0, open: 0, closed: 0, replied: 0 },
  );

  // Calendar widget: which days in the shown month have an issue date, a due
  // date, or both, across every notice (not filtered — the calendar is a
  // firm-wide date map, matching Notice Alert's always-unfiltered widget).
  const dayMarkers = new Map<number, { issue: boolean; due: boolean }>();
  rows.forEach((r) => {
    [{ v: r.issue_date, key: 'issue' as const }, { v: r.due_date, key: 'due' as const }].forEach(({ v, key }) => {
      if (!v) return;
      const d = new Date(v);
      if (d.getFullYear() !== calYear || d.getMonth() !== calMonth) return;
      const entry = dayMarkers.get(d.getDate()) || { issue: false, due: false };
      entry[key] = true;
      dayMarkers.set(d.getDate(), entry);
    });
  });
  const firstOfMonth = new Date(calYear, calMonth, 1);
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();
  const calendarCells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const isCurrentMonth = calYear === todayDate.getFullYear() && calMonth === todayDate.getMonth();
  const goPrevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); } else { setCalMonth((m) => m - 1); }
  };
  const goNextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); } else { setCalMonth((m) => m + 1); }
  };

  return (
    <div className="space-y-2.5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title="Notices Dashboard"
          icon={<Bell className="h-5 w-5" />}
          embedded
        />
        <nav className="flex items-center gap-1 rounded-md border bg-muted/30 p-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className={cn(
                'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors',
                item.active ? 'border border-primary/40 bg-background text-primary' : 'text-muted-foreground hover:bg-background hover:text-foreground',
              )}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="type-of-notices" className="text-xs text-muted-foreground">Type Of Notices</Label>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeOfNoticesFilter)}>
            <SelectTrigger id="type-of-notices" className="h-8 w-[200px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="registration">Registration</SelectItem>
              <SelectItem value="other">Other than Registration</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Matches Notice Alert's top-right "Company" button, which opens its
            own full "View Company List" page (filters, bulk actions, sync
            history) instead of the mini list below. */}
        <Button size="sm" variant="outline" className="h-8 border-primary/40 text-xs text-primary hover:bg-primary/5 hover:text-primary" onClick={() => navigate('/notices-company-list')}>
          <Building2 className="mr-1.5 h-3.5 w-3.5" /> Company
        </Button>
      </div>

      {/*
        Layout matches Notice Alert: left column stacks KPI tiles on top of
        Company + Calendar (side by side); Notice Summary is a single tall
        card on the right next to both. It gets an explicit fixed height
        (not items-stretch) — with an auto-height flex/grid row, align-items:
        stretch sizes the ROW to the tallest item's own natural content
        height first (here, the Notice Summary table's full un-scrolled row
        count, ~850px), then stretches every OTHER column up to match that —
        the opposite of what's wanted, and it still leaves dead space below
        the now-taller Company/Calendar column. A fixed height plus
        overflow-auto (matching Notice Alert's own scrollbar, visible in
        their screenshot too) sidesteps that entirely.
      */}
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-start">
        <div className="flex flex-1 flex-col gap-2.5 min-w-0">
        <div className="grid grid-cols-2 gap-2.5 content-start sm:grid-cols-4">
          {kpiCards.map((card) => {
            const body = (
              <CardContent className="p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">{card.label}</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                      {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : card.value}
                    </p>
                  </div>
                  <div className={`rounded-full p-1.5 ${card.bgColor}`}>{card.icon}</div>
                </div>
              </CardContent>
            );
            return card.to ? (
              <Link key={card.label} to={card.to}>
                <Card className="border transition-colors hover:border-primary/40 hover:bg-muted/30">{body}</Card>
              </Link>
            ) : (
              <Card key={card.label} className="border">{body}</Card>
            );
          })}
        </div>

        {/* Company (left) + Calendar (right) */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <Card className="flex min-h-0 flex-col sm:col-span-2">
          <CardHeader className="shrink-0 pb-2 pt-3">
            <CardTitle className="text-sm">Company</CardTitle>
            <CardDescription className="text-[11px]">Onboard clients and pull the latest notices for everyone at once.</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2 pb-3">
            {canManageClients && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-7 border-primary/40 text-xs text-primary hover:bg-primary/5 hover:text-primary" onClick={() => navigate('/add-client')}>
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Add Company
                </Button>
                <BulkAddClientsDialog
                  triggerLabel="Import Company"
                  triggerClassName="h-7 border-primary/40 text-xs text-primary hover:bg-primary/5 hover:text-primary"
                  onSuccess={() => window.location.reload()}
                />
                <Button size="sm" variant="outline" className="h-7 border-primary/40 text-xs text-primary hover:bg-primary/5 hover:text-primary" onClick={downloadClientImportTemplate}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Download Template
                </Button>
                <Button size="sm" variant="outline" className="ml-auto h-7 border-primary/40 text-xs text-primary hover:bg-primary/5 hover:text-primary" onClick={handleSyncAll} disabled={syncing}>
                  {syncing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                  Sync All
                </Button>
              </div>
            )}
            {!extReady && canManageClients && (
              <p className="text-[11px] text-muted-foreground">Extension not detected — install/enable the GST Keeper extension to use Sync All.</p>
            )}
            <div className="min-h-0 flex-1 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 bg-muted/60 px-2 py-1.5 text-[11px] font-semibold">#</TableHead>
                    <TableHead className="w-[150px] bg-muted/60 px-2 py-1.5 text-[11px] font-semibold">GSTIN</TableHead>
                    <TableHead className="w-auto bg-muted/60 px-2 py-1.5 text-[11px] font-semibold">Trade Name</TableHead>
                    <TableHead className="w-10 bg-muted/60 px-2 py-1.5 text-[11px] font-semibold">{canManageClients && 'Action'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {miniClients.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">
                        No companies yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    miniClients.map((c, idx) => (
                      <TableRow key={c.id}>
                        <TableCell className="px-2 py-1 text-xs text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="w-[150px] px-2 py-1 text-xs">
                          {c.gstin ? (
                            <Link to={`/edit-client/${c.id}`} className="text-primary hover:underline">{c.gstin}</Link>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="max-w-0 truncate px-2 py-1 text-xs" title={c.name}>{c.name}</TableCell>
                        <TableCell className="px-2 py-1 text-right">
                          {canManageClients && (
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => navigate(`/edit-client/${c.id}`)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="shrink-0 text-right">
              <Link to="/clients" className="text-[11px] font-medium text-primary hover:underline">View All</Link>
            </div>
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col">
          <CardHeader className="shrink-0 pb-2 pt-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{MONTH_NAMES[calMonth]} {calYear}</CardTitle>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={goPrevMonth}><ChevronLeft className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={goNextMonth}><ChevronRight className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-auto pb-3">
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-muted-foreground">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i}>{d}</div>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {calendarCells.map((day, i) => {
                if (day === null) return <div key={i} />;
                const marker = dayMarkers.get(day);
                const isToday = isCurrentMonth && day === todayDate.getDate();
                const bg = marker?.issue && marker?.due ? 'bg-warning/20 text-warning-foreground'
                  : marker?.due ? 'bg-destructive/15 text-destructive'
                  : marker?.issue ? 'bg-info/15 text-info'
                  : '';
                const iso = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                return (
                  <button
                    type="button"
                    key={i}
                    onClick={() => navigate(drillParams({ date: iso }))}
                    className={cn(
                      'flex h-6 items-center justify-center rounded text-[11px] transition-colors hover:bg-primary/10 hover:text-primary',
                      bg,
                      isToday && 'ring-1 ring-primary font-semibold',
                    )}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-info/40" /> Issue date</div>
              <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-destructive/40" /> Due date</div>
              <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-warning/40" /> Both</div>
            </div>
          </CardContent>
        </Card>
        </div>
        </div>

        <Card className="flex min-h-0 flex-col xl:h-[620px] xl:w-[380px] xl:shrink-0">
          <CardHeader className="shrink-0 pb-2 pt-3">
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
          <CardContent className="flex min-h-0 flex-1 flex-col pb-3">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : categoryRows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No notices on record yet.</p>
            ) : (
              // The Card above has a fixed height, so this just fills it and
              // scrolls — same as Notice Alert's own scrollbar.
              <div className="min-h-0 flex-1 overflow-auto rounded-md border">
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
                    {categoryRows.map((r) => (
                      <TableRow
                        key={r.type}
                        className={cn(
                          !r.placeholder && 'cursor-pointer',
                          categoryFilter === r.type && 'bg-primary/10 hover:bg-primary/15',
                        )}
                        onClick={r.placeholder ? undefined : () => (r.to ? navigate(r.to) : setCategoryFilter((prev) => (prev === r.type ? null : r.type)))}
                      >
                        <TableCell className={cn('px-2 py-1 text-[11px] font-medium', r.placeholder ? 'text-muted-foreground' : 'text-primary')}>{r.type}</TableCell>
                        <TableCell className={cn('px-2 py-1 text-right text-[11px] tabular-nums', !r.placeholder && 'text-primary underline-offset-2 hover:underline')}>
                          {r.placeholder ? '—' : r.total}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-right text-[11px] tabular-nums">{r.open || '—'}</TableCell>
                        <TableCell className="px-2 py-1 text-right text-[11px] tabular-nums">{r.closed || '—'}</TableCell>
                        <TableCell className="px-2 py-1 text-right text-[11px] tabular-nums">{r.replied || '—'}</TableCell>
                      </TableRow>
                    ))}
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
      </div>
    </div>
  );
};

export default NoticesDashboardPage;
