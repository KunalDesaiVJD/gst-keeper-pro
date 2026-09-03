// CompanyProfilePage — what clicking a GSTIN should open, firm-wide (Company
// List, the Notices Dashboard's mini Company panel, and its "Search Company"
// picker all point here now). Confirmed live against Notice Alert
// (2026-08-26): clicking a GSTIN there opens a per-company "Company
// Dashboard" — profile fields + KPI tiles + Notices/Submissions lists + a
// Track Return Status table — NOT the client edit form. This app had every
// GSTIN link wired to /edit-client instead; the pencil/edit icon already
// covers editing separately; this page is that missing profile view.
//
// Business Owners / HSN-SAC / Return Periodicity / Business Activities
// panels from Notice Alert's own page are left out — their own screenshot
// shows them permanently empty (one even showing a raw "Undefined-NaN"), so
// there's nothing there to faithfully port.
import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { NoticesTopNav } from '@/components/notices/NoticesTopNav';
import { cn } from '@/lib/utils';
import { isoDateToDMY } from '@/utils/formatDate';
import {
  Bell, CalendarClock, History, FolderOpen, AlertTriangle, Loader2, Pencil,
  ArrowLeft, FileText,
} from 'lucide-react';

interface ClientRow {
  id: string;
  name: string;
  gstin: string;
  registration_type: string;
  registration_date: string | null;
  email: string | null;
  mobile: string | null;
}

interface TaxpayerProfileRow {
  legal_name: string | null;
  trade_name: string | null;
  registration_date: string | null;
  principal_place_address: string | null;
}

interface NoticeRow {
  id: string;
  reference_number: string | null;
  notice_type: string | null;
  description: string | null;
  issue_date: string | null;
  due_date: string | null;
  staff_status: string | null;
  submission_arn: string | null;
  submission_date: string | null;
  pdf_url: string | null;
  pulled_at: string;
}

interface FilingRow {
  return_type: string;
  period_month: string;
  filed_date: string | null;
}

const isClosed = (s: string | null) => (s || '').trim().toLowerCase() === 'closed';

// Indian financial year (April-March) for an MM/YYYY period string.
const financialYearFor = (periodMonth: string) => {
  const [mm, yyyy] = periodMonth.split('/').map(Number);
  if (!mm || !yyyy) return periodMonth;
  return mm >= 4 ? `${yyyy}-${yyyy + 1}` : `${yyyy - 1}-${yyyy}`;
};
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (periodMonth: string) => {
  const [mm, yyyy] = periodMonth.split('/').map(Number);
  if (!mm || !yyyy) return periodMonth;
  return `${MONTH_NAMES_SHORT[mm - 1]} ${yyyy}`;
};

const CompanyProfilePage: React.FC = () => {
  const { isStaffRole, canAddEditClients } = useAuth();
  const navigate = useNavigate();
  const { clientId } = useParams<{ clientId: string }>();

  const [client, setClient] = useState<ClientRow | null>(null);
  const [profile, setProfile] = useState<TaxpayerProfileRow | null>(null);
  const [notices, setNotices] = useState<NoticeRow[]>([]);
  const [filings, setFilings] = useState<FilingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [clientRes, profileRes, noticesRes, filingsRes] = await Promise.all([
        supabase.from('clients').select('id, name, gstin, registration_type, registration_date, email, mobile').eq('id', clientId).maybeSingle(),
        supabase.from('gst_taxpayer_profile').select('legal_name, trade_name, registration_date, principal_place_address').eq('client_id', clientId).maybeSingle(),
        supabase.from('gst_notices').select('id, reference_number, notice_type, description, issue_date, due_date, staff_status, submission_arn, submission_date, pdf_url, pulled_at').eq('client_id', clientId).eq('source', 'notices').order('issue_date', { ascending: false }),
        supabase.from('filing_status').select('return_type, period_month, filed_date').eq('client_id', clientId).in('return_type', ['GSTR1', 'GSTR3B']).not('filed_date', 'is', null),
      ]);
      if (!cancelled) {
        setClient((clientRes.data || null) as ClientRow | null);
        setProfile((profileRes.data || null) as TaxpayerProfileRow | null);
        setNotices((noticesRes.data || []) as NoticeRow[]);
        setFilings((filingsRes.data || []) as FilingRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;
  if (!clientId) return <Navigate to="/notices-company-list" replace />;

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const daysAgo = (v: string | null) => (v ? (now - new Date(v).getTime()) / DAY_MS : Infinity);
  const daysUntil = (v: string | null) => (v ? (new Date(v).getTime() - now) / DAY_MS : -Infinity);

  const totalNotices = notices.length;
  const last15Days = notices.filter((n) => daysAgo(n.issue_date) <= 15).length;
  const last24Hours = notices.filter((n) => daysAgo(n.pulled_at) <= 1).length;
  const openNotices = notices.filter((n) => !isClosed(n.staff_status)).length;
  const dueSoon = notices.filter((n) => n.due_date && daysUntil(n.due_date) >= 0 && daysUntil(n.due_date) <= 7).length;
  const overdue = notices.filter((n) => n.due_date && daysUntil(n.due_date) < 0).length;

  const kpiCards = [
    { label: 'Total Notices', value: totalNotices, icon: <Bell className="h-7 w-7 text-primary" />, bgColor: 'bg-primary/5' },
    { label: 'Last 15 Days', value: last15Days, icon: <CalendarClock className="h-7 w-7 text-info" />, bgColor: 'bg-info/5' },
    { label: 'Last 24 Hours', value: last24Hours, icon: <History className="h-7 w-7 text-info" />, bgColor: 'bg-info/5' },
    { label: 'Open Notices', value: openNotices, icon: <FolderOpen className="h-7 w-7 text-warning" />, bgColor: 'bg-warning/5' },
    { label: '7 Days Due', value: dueSoon, icon: <CalendarClock className="h-7 w-7 text-warning" />, bgColor: 'bg-warning/5' },
    { label: 'Over Due', value: overdue, icon: <AlertTriangle className="h-7 w-7 text-destructive" />, bgColor: 'bg-destructive/5' },
  ];

  const submissions = notices.filter((n) => n.submission_arn || n.submission_date);

  const filingsByPeriod = useMemo(() => {
    const m = new Map<string, { period: string; fy: string; gstr1: string | null; gstr3b: string | null }>();
    filings.forEach((f) => {
      const entry = m.get(f.period_month) || { period: f.period_month, fy: financialYearFor(f.period_month), gstr1: null, gstr3b: null };
      if (f.return_type === 'GSTR1') entry.gstr1 = f.filed_date;
      if (f.return_type === 'GSTR3B') entry.gstr3b = f.filed_date;
      m.set(f.period_month, entry);
    });
    return Array.from(m.values()).sort((a, b) => {
      const [am, ay] = a.period.split('/').map(Number);
      const [bm, by] = b.period.split('/').map(Number);
      return by !== ay ? by - ay : bm - am;
    });
  }, [filings]);

  const legalName = profile?.legal_name || client?.name || '—';
  const tradeName = profile?.trade_name || client?.name || '—';

  return (
    <div className="space-y-2.5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader title="Notices Dashboard" icon={<Bell className="h-5 w-5" />} embedded />
        <NoticesTopNav />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Link to="/notices-dashboard" className="text-primary hover:underline">GST Dashboard</Link>
          <span>›</span>
          <span>Company Dashboard</span>
        </div>
        {client && <div className="font-medium text-foreground">{client.gstin} | {tradeName}</div>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !client ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Company not found.</p>
      ) : (
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-start">
          {/* Company Profile */}
          <Card className="xl:w-[280px] xl:shrink-0">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3">
              <CardTitle className="text-sm">Company Profile</CardTitle>
              {canAddEditClients() && (
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => navigate(`/edit-client/${client.id}`)} title="Edit Client">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3 pb-4 text-xs">
              <div>
                <p className="text-muted-foreground">Legal Name</p>
                <p className="font-medium">{legalName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Trade Name</p>
                <p className="font-medium">{tradeName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">GSTIN</p>
                <p className="font-medium">{client.gstin}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Taxpayer Type</p>
                <Badge variant="outline" className="text-xs">{client.registration_type}</Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Date of Registration</p>
                <p className="font-medium">{profile?.registration_date || client.registration_date || '—'}</p>
              </div>
              {client.email && (
                <div>
                  <p className="text-muted-foreground">Contact Person Email</p>
                  <p className="font-medium">{client.email}</p>
                </div>
              )}
              {profile?.principal_place_address && (
                <div>
                  <p className="text-muted-foreground">Principal Office</p>
                  <p className="font-medium">{profile.principal_place_address}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            {/* KPI tiles */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
              {kpiCards.map((card) => (
                <Card key={card.label} className="border">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">{card.label}</p>
                        <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{card.value}</p>
                      </div>
                      <div className={`rounded-full p-1.5 ${card.bgColor}`}>{card.icon}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Notices & Orders + View Submission */}
            <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">Notices & Orders</CardTitle></CardHeader>
                <CardContent className="space-y-2 pb-3">
                  {notices.slice(0, 5).map((n, i) => (
                    <div key={n.id} className="flex items-start gap-2 border-b pb-2 text-xs last:border-0 last:pb-0">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{n.notice_type || n.description || 'Notice'}</p>
                        <p className="text-muted-foreground">Ref Id: {n.reference_number || '—'} · Issue: {isoDateToDMY(n.issue_date)}</p>
                      </div>
                      {n.pdf_url && <a href={n.pdf_url} target="_blank" rel="noreferrer"><FileText className="h-4 w-4 text-destructive" /></a>}
                    </div>
                  ))}
                  {notices.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No notices on record.</p>}
                  <Link to={`/notices-all?client=${client.id}`} className="block text-right text-[11px] font-medium text-primary hover:underline">View All</Link>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">View Submission</CardTitle></CardHeader>
                <CardContent className="space-y-2 pb-3">
                  {submissions.slice(0, 5).map((n, i) => (
                    <div key={n.id} className="flex items-start gap-2 border-b pb-2 text-xs last:border-0 last:pb-0">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{n.description || n.notice_type || 'Submission'}</p>
                        <p className="text-muted-foreground">ARN: {n.submission_arn || '—'} · Date: {isoDateToDMY(n.submission_date)}</p>
                      </div>
                    </div>
                  ))}
                  {submissions.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No submissions on record.</p>}
                  <Link to={`/notices-all?client=${client.id}&filter=submitted`} className="block text-right text-[11px] font-medium text-primary hover:underline">View All</Link>
                </CardContent>
              </Card>
            </div>

            {/* Track Return Status */}
            <Card>
              <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">Track Return Status</CardTitle></CardHeader>
              <CardContent className="pb-3">
                <div className="overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="bg-muted/60 text-[11px]">Financial Year</TableHead>
                        <TableHead className="bg-muted/60 text-[11px]">Period</TableHead>
                        <TableHead className="bg-muted/60 text-[11px]">GSTR-1 Filing Date</TableHead>
                        <TableHead className="bg-muted/60 text-[11px]">GSTR-3B Filing Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filingsByPeriod.length === 0 ? (
                        <TableRow><TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">No filed returns on record.</TableCell></TableRow>
                      ) : (
                        filingsByPeriod.slice(0, 12).map((f) => (
                          <TableRow key={f.period}>
                            <TableCell className="text-xs">{f.fy}</TableCell>
                            <TableCell className="text-xs">{monthLabel(f.period)}</TableCell>
                            <TableCell className="text-xs">{f.gstr1 || '—'}</TableCell>
                            <TableCell className="text-xs">{f.gstr3b || '—'}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/*
              Business Owners / HSN-SAC / Return Periodicity / Business
              Activities — matches Notice Alert's own layout, but shown as
              empty placeholder panels: confirmed live (2026-08-26) on an
              ACTIVE client with 35 real notices and full filing history that
              these 4 boxes render permanently empty on their end too (Return
              Periodicity even shows a raw "Undefined-NaN Undefined-NaN"
              rendering bug) — there's no real data source behind them to
              port, only the panel shells themselves.
            */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              <Card><CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">Business Owners</CardTitle></CardHeader><CardContent className="pb-4" /></Card>
              <Card><CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">HSN / SAC</CardTitle></CardHeader><CardContent className="pb-4" /></Card>
              <Card><CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">Return Periodicity</CardTitle></CardHeader><CardContent className="pb-4" /></Card>
              <Card><CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">Business Activities</CardTitle></CardHeader><CardContent className="pb-4" /></Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompanyProfilePage;
