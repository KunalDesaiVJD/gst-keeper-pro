// NoticesDashboardPage — the firm-wide counterpart to the per-client "View
// Notice and Orders" report: one query across every client's gst_notices
// rows, summarized as KPI tiles + a category breakdown table (Total/Open/
// Closed/Replied per notice type), matching the portfolio-wide dashboard
// pattern the user pointed to (Notice Alert's GST Dashboard) — scoped to
// what gst_notices actually holds (Notices/Orders, LUT, DRC-03 voluntary
// payment), not the wider Appeal/Audit/Refund taxonomy that tool tracks.
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
import {
  Bell, CalendarClock, History, Building2, FolderOpen, AlertTriangle, Flag, Loader2,
  UserPlus, Upload, Download, RefreshCw, Pencil, ChevronLeft, ChevronRight,
} from 'lucide-react';

interface NoticeRow {
  client_id: string;
  notice_type: string | null;
  description: string | null;
  staff_status: string | null;
  priority: boolean;
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
const isRegistrationRelated = (r: NoticeRow) => /registration/i.test(r.description || '');

interface CategoryRow {
  type: string;
  total: number;
  open: number;
  closed: number;
  replied: number;
}

const isClosed = (s: string | null) => (s || '').trim().toLowerCase() === 'closed';

interface MiniClient {
  id: string;
  name: string;
  gstin: string | null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
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
    ? filteredRows.filter((r) => (r.notice_type || 'Uncategorised') === categoryFilter)
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
    const type = r.notice_type || 'Uncategorised';
    const entry = categoryMap.get(type) || { type, total: 0, open: 0, closed: 0, replied: 0 };
    entry.total += 1;
    if (isClosed(r.staff_status)) entry.closed += 1; else entry.open += 1;
    if (r.reply_date) entry.replied += 1;
    categoryMap.set(type, entry);
  });
  const categoryRows = Array.from(categoryMap.values()).sort((a, b) => b.total - a.total);
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
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Notices Dashboard"
        subtitle="Every client's notices, orders, LUT applications and voluntary payments in one place."
        icon={<Bell className="h-6 w-6" />}
      />

      <div className="flex items-center gap-2">
        <Label htmlFor="type-of-notices" className="text-sm text-muted-foreground">Type Of Notices</Label>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeOfNoticesFilter)}>
          <SelectTrigger id="type-of-notices" className="h-9 w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="registration">Registration</SelectItem>
            <SelectItem value="other">Other than Registration</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Company</CardTitle>
            <CardDescription>Onboard clients and pull the latest notices for everyone at once.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {canManageClients && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => navigate('/add-client')}>
                  <UserPlus className="mr-1.5 h-4 w-4" /> Add Company
                </Button>
                <BulkAddClientsDialog triggerLabel="Import Company" onSuccess={() => window.location.reload()} />
                <Button size="sm" variant="outline" onClick={downloadClientImportTemplate}>
                  <Download className="mr-1.5 h-4 w-4" /> Download Template
                </Button>
                <Button size="sm" variant="outline" onClick={handleSyncAll} disabled={syncing}>
                  {syncing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                  Sync All
                </Button>
              </div>
            )}
            {!extReady && (
              <p className="text-xs text-muted-foreground">
                {canManageClients ? 'Extension not detected — install/enable the GST Keeper extension to use Sync All.' : ''}
              </p>
            )}
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-semibold">Trade Name</TableHead>
                    <TableHead className="text-xs font-semibold">GSTIN</TableHead>
                    {canManageClients && <TableHead className="w-10 text-xs font-semibold" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {miniClients.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={canManageClients ? 3 : 2} className="py-6 text-center text-xs text-muted-foreground">
                        No companies yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    miniClients.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs">{c.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.gstin || '—'}</TableCell>
                        {canManageClients && (
                          <TableCell className="text-right">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => navigate(`/edit-client/${c.id}`)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="text-right">
              <Link to="/clients" className="text-xs font-medium text-primary hover:underline">View All</Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{MONTH_NAMES[calMonth]} {calYear}</CardTitle>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={goPrevMonth}><ChevronLeft className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={goNextMonth}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
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
                return (
                  <div
                    key={i}
                    className={cn(
                      'flex h-7 items-center justify-center rounded text-xs',
                      bg,
                      isToday && 'ring-1 ring-primary font-semibold',
                    )}
                  >
                    {day}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-info/40" /> Issue date</div>
              <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-destructive/40" /> Due date</div>
              <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-warning/40" /> Both</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((card) => {
          const body = (
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
                  <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
                    {loading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : card.value}
                  </p>
                </div>
                <div className={`rounded-full p-2 ${card.bgColor}`}>{card.icon}</div>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notice Summary</CardTitle>
          <CardDescription>
            Total, Open, Closed and Replied counts across every client on record — click a row to drill the tiles above into just that category
            {categoryFilter && (
              <>
                {' '}·{' '}
                <button
                  type="button"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => setCategoryFilter(null)}
                >
                  clear "{categoryFilter}" filter
                </button>
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : categoryRows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No notices on record yet.</p>
          ) : (
            <div className="max-h-[50vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="bg-muted/60 text-xs font-semibold">Remarks</TableHead>
                    <TableHead className="bg-muted/60 text-right text-xs font-semibold">Total</TableHead>
                    <TableHead className="bg-muted/60 text-right text-xs font-semibold">Open</TableHead>
                    <TableHead className="bg-muted/60 text-right text-xs font-semibold">Closed</TableHead>
                    <TableHead className="bg-muted/60 text-right text-xs font-semibold">Replied</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categoryRows.map((r) => (
                    <TableRow
                      key={r.type}
                      className={cn('cursor-pointer', categoryFilter === r.type && 'bg-primary/10 hover:bg-primary/15')}
                      onClick={() => setCategoryFilter((prev) => (prev === r.type ? null : r.type))}
                    >
                      <TableCell className="text-xs font-medium text-primary">{r.type}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{r.total}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{r.open || '—'}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{r.closed || '—'}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{r.replied || '—'}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-primary/5 font-semibold hover:bg-primary/10">
                    <TableCell className="text-xs">Total</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{grandTotal.total}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{grandTotal.open}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{grandTotal.closed}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{grandTotal.replied}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default NoticesDashboardPage;
