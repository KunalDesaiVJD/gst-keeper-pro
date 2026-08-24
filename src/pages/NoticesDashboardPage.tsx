// NoticesDashboardPage — the firm-wide counterpart to the per-client "View
// Notice and Orders" report: one query across every client's gst_notices
// rows, summarized as KPI tiles + a category breakdown table (Total/Open/
// Closed/Replied per notice type), matching the portfolio-wide dashboard
// pattern the user pointed to (Notice Alert's GST Dashboard) — scoped to
// what gst_notices actually holds (Notices/Orders, LUT, DRC-03 voluntary
// payment), not the wider Appeal/Audit/Refund taxonomy that tool tracks.
import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Bell, CalendarClock, History, Building2, FolderOpen, AlertTriangle, Flag, Loader2 } from 'lucide-react';

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

const NoticesDashboardPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const [rows, setRows] = useState<NoticeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeOfNoticesFilter>('all');

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

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const filteredRows = rows.filter((r) => {
    if (typeFilter === 'registration') return isRegistrationRelated(r);
    if (typeFilter === 'other') return !isRegistrationRelated(r);
    return true;
  });

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const daysAgo = (v: string | null) => (v ? (now - new Date(v).getTime()) / DAY_MS : Infinity);
  const daysUntil = (v: string | null) => (v ? (new Date(v).getTime() - now) / DAY_MS : -Infinity);

  const totalNotices = filteredRows.length;
  const last15Days = filteredRows.filter((r) => daysAgo(r.issue_date) <= 15).length;
  const last24Hours = filteredRows.filter((r) => daysAgo(r.pulled_at) <= 1).length;
  const totalGstin = new Set(filteredRows.map((r) => r.client_id)).size;
  const openNotices = filteredRows.filter((r) => !isClosed(r.staff_status)).length;
  const dueSoon = filteredRows.filter((r) => r.due_date && daysUntil(r.due_date) >= 0 && daysUntil(r.due_date) <= 7).length;
  const overdue = filteredRows.filter((r) => r.due_date && daysUntil(r.due_date) < 0).length;
  const priorityCount = filteredRows.filter((r) => r.priority).length;

  const kpiCards = [
    { label: 'Total Notices', value: totalNotices, icon: <Bell className="h-8 w-8 text-primary" />, bgColor: 'bg-primary/5' },
    { label: 'Last 15 Days', value: last15Days, icon: <CalendarClock className="h-8 w-8 text-info" />, bgColor: 'bg-info/5' },
    { label: 'Last 24 Hours', value: last24Hours, icon: <History className="h-8 w-8 text-info" />, bgColor: 'bg-info/5' },
    { label: 'Total GSTIN', value: totalGstin, icon: <Building2 className="h-8 w-8 text-secondary-foreground" />, bgColor: 'bg-secondary/40' },
    { label: 'Open Notices', value: openNotices, icon: <FolderOpen className="h-8 w-8 text-warning" />, bgColor: 'bg-warning/5' },
    { label: '7 Days Due', value: dueSoon, icon: <CalendarClock className="h-8 w-8 text-warning" />, bgColor: 'bg-warning/5' },
    { label: 'Over Due', value: overdue, icon: <AlertTriangle className="h-8 w-8 text-destructive" />, bgColor: 'bg-destructive/5' },
    { label: 'Priority', value: priorityCount, icon: <Flag className="h-8 w-8 text-destructive" />, bgColor: 'bg-destructive/5' },
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((card) => (
          <Card key={card.label} className="border">
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
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notice Summary by Type</CardTitle>
          <CardDescription>Total, Open, Closed and Replied counts across every client on record.</CardDescription>
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
                    <TableHead className="bg-muted/60 text-xs font-semibold">Type</TableHead>
                    <TableHead className="bg-muted/60 text-right text-xs font-semibold">Total</TableHead>
                    <TableHead className="bg-muted/60 text-right text-xs font-semibold">Open</TableHead>
                    <TableHead className="bg-muted/60 text-right text-xs font-semibold">Closed</TableHead>
                    <TableHead className="bg-muted/60 text-right text-xs font-semibold">Replied</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categoryRows.map((r) => (
                    <TableRow key={r.type}>
                      <TableCell className="text-xs">{r.type}</TableCell>
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
