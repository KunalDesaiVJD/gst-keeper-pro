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
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { NoticesTopNav } from '@/components/notices/NoticesTopNav';
import NoticesPageHeader from '@/components/notices/NoticesPageHeader';
import NoticesCardHeader from '@/components/notices/NoticesCardHeader';
import FilterPill from '@/components/notices/FilterPill';
import { cn } from '@/lib/utils';
import { isoDateToDMY } from '@/utils/formatDate';
import { loadClientNoticeFacts, loadRefundFacts, loadDrc03Facts, istToday, daysBetween, type NoticeFact } from '@/lib/noticeFacts';
import { isOpen, isOverdue, isDueIn7 } from '@/utils/noticeDefinitions';
import { Building2, Loader2, Pencil, FileText, Eye } from 'lucide-react';

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
  // Matches gst_case_folder_items.case_id when this event has a drill-down
  // "Notice Folder" page (AdditionalNoticeFolderPage) — real gst_notices
  // rows carry their own case_id column; synthesized refund/drc03 rows use
  // the ARN itself, same convention gst_case_folder_items already uses.
  case_id: string | null;
  // 'refund'/'drc03' rows are synthesized from gst_refund_applications /
  // gst_drc03_filings below — neither table carries a staff_status or
  // due_date (that workflow tracking only exists on gst_notices), so they
  // count toward Total/Last-15-Days/Last-24-Hours and the notices list, but
  // are excluded from Open/7-Days-Due/Over Due rather than guessing
  // open/closed from the portal's own status text.
  kind?: 'notice' | 'refund' | 'drc03';
}


interface FilingRow {
  return_type: string;
  period_month: string;
  filed_date: string | null;
}


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
  // The client's canonical notice set (public.notice_facts) — what the tiles count
  // and exactly what the list each tile opens shows.
  const [facts, setFacts] = useState<NoticeFact[]>([]);
  const [filings, setFilings] = useState<FilingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [clientRes, profileRes, filingsRes, noticeFacts, refundFacts, drc03Facts] = await Promise.all([
        supabase.from('clients').select('id, name, gstin, registration_type, registration_date, email, mobile').eq('id', clientId).maybeSingle(),
        supabase.from('gst_taxpayer_profile').select('legal_name, trade_name, registration_date, principal_place_address').eq('client_id', clientId).maybeSingle(),
        // gst_filed_returns holds the actual as-filed-on-portal date (pulled
        // straight from the portal's own GSTR-1/3B JSON APIs) — filing_status
        // is this app's own internal prep/compliance tracker, a different signal.
        supabase.from('gst_filed_returns').select('return_type, period_month, filed_date').eq('client_id', clientId).in('return_type', ['GSTR1', 'GSTR3B']).not('filed_date', 'is', null),
        loadClientNoticeFacts(clientId).catch(() => [] as NoticeFact[]),
        // Refund applications and DRC-03 filings join the timeline below, each
        // case once (the refund / voluntary-payment case rows are in these sets).
        loadRefundFacts(clientId).catch(() => []),
        loadDrc03Facts(clientId).catch(() => []),
      ]);
      if (!cancelled) {
        setClient((clientRes.data || null) as ClientRow | null);
        setProfile((profileRes.data || null) as TaxpayerProfileRow | null);
        setFacts(noticeFacts);
        const gstNoticeRows = noticeFacts
          .filter((n) => !n.is_refund_case && !n.is_drc03_case)
          .map((n): NoticeRow => ({
            id: n.id as string,
            reference_number: n.reference_number,
            notice_type: n.notice_type,
            description: n.description,
            issue_date: n.issue_date,
            due_date: n.effective_due,
            staff_status: n.staff_status,
            submission_arn: n.submission_arn,
            submission_date: n.submission_date,
            pdf_url: n.pdf_url,
            pulled_at: n.pulled_at as string,
            case_id: n.case_id,
            kind: 'notice',
          }));
        const refundRows = refundFacts.map((r): NoticeRow => ({
          id: 'refund-' + r.id,
          reference_number: r.arn,
          notice_type: 'Refunds',
          description: r.refund_type,
          issue_date: r.filed_date,
          due_date: null,
          staff_status: r.origin === 'case' ? r.status : null,
          submission_arn: null,
          submission_date: null,
          pdf_url: (Array.isArray(r.documents) && (r.documents as { url?: string }[])[0]?.url) || null,
          pulled_at: '',
          // A refund case's folder is keyed by its own ARN (gst_case_folder_items.case_id).
          case_id: r.arn,
          kind: 'refund',
        }));
        const drc03Rows = drc03Facts.map((d): NoticeRow => ({
          id: 'drc03-' + d.id,
          reference_number: d.arn,
          notice_type: 'DRC-03',
          description: d.cause_of_payment,
          issue_date: d.filed_date,
          due_date: null,
          staff_status: d.origin === 'case' ? d.status : null,
          submission_arn: null,
          submission_date: null,
          pdf_url: d.pdf_url,
          pulled_at: '',
          case_id: d.arn,
          kind: 'drc03',
        }));
        const combined = [...gstNoticeRows, ...refundRows, ...drc03Rows].sort((a, b) =>
          (b.issue_date || '').localeCompare(a.issue_date || ''));
        setNotices(combined);
        setFilings((filingsRes.data || []) as FilingRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);


  // Distinct notice_type values on record for this client, for the "Types
  // Of Notices" filter — matches Notice Alert's own equivalent dropdown
  // (2026-09-08 comparison). Derived from the unfiltered list so a chosen
  // filter never hides itself from its own options.
  const noticeTypes = Array.from(new Set(notices.map((n) => n.notice_type).filter((t): t is string => !!t))).sort();
  const filteredNotices = typeFilter === 'all' ? notices : notices.filter((n) => n.notice_type === typeFilter);

  // Tiles count the client's canonical notice set — the rows /notices-all?client=
  // shows — with the same flags the firm-wide dashboard uses (IST calendar
  // dates; replied notices are neither overdue nor due). They are not narrowed
  // by the Type filter, which only filters the timeline below.
  const today = istToday();
  const nowMs = Date.now();
  const totalNotices = facts.length;
  const last15Days = facts.filter((n) => !!n.issue_date && daysBetween(n.issue_date, today) >= 0 && daysBetween(n.issue_date, today) <= 15).length;
  const last24Hours = facts.filter((n) => !!n.pulled_at && nowMs - new Date(n.pulled_at).getTime() <= 24 * 60 * 60 * 1000).length;
  const openNotices = facts.filter((n) => isOpen(n)).length;
  const dueSoon = facts.filter((n) => isDueIn7(n)).length;
  const overdue = facts.filter((n) => isOverdue(n)).length;

  const kpiCards = [
    { label: 'Over Due', value: overdue, accent: 'border-l-destructive', context: `of ${totalNotices}`, cta: 'Open queue →', href: `/notices-all?client=${clientId}&filter=overdue` },
    { label: '7 Days Due', value: dueSoon, accent: 'border-l-amber-500', context: 'this week', cta: 'View due →', href: `/notices-all?client=${clientId}&filter=due7` },
    { label: 'Last 24 Hours', value: last24Hours, accent: 'border-l-blue-500', context: 'newly synced', cta: 'View new →', href: `/notices-all?client=${clientId}&filter=last24h` },
    { label: 'Last 15 Days', value: last15Days, accent: 'border-l-primary', context: 'recent', cta: 'View recent →', href: `/notices-all?client=${clientId}&filter=last15` },
    { label: 'Open Notices', value: openNotices, accent: 'border-l-primary', context: `of ${totalNotices}`, cta: 'View open →', href: `/notices-all?client=${clientId}&status=Open` },
    { label: 'Total Notices', value: totalNotices, accent: 'border-l-primary', context: 'on record', cta: 'View all →', href: `/notices-all?client=${clientId}` },
  ];

  const submissions = filteredNotices.filter((n) => n.submission_arn || n.submission_date);

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

  // After every hook (Rules of Hooks): the filings memo above used to sit below these returns.
  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;
  if (!clientId) return <Navigate to="/notices-company-list" replace />;

  const legalName = profile?.legal_name || client?.name || '—';
  const tradeName = profile?.trade_name || client?.name || '—';

  return (
    <div className="space-y-4 animate-fade-in">
      <NoticesPageHeader
        title={tradeName}
        icon={Building2}
        subtitle={
          <>
            <span className="flex items-center gap-1.5">
              <Link to="/notices-dashboard" className="text-primary hover:underline">GST Dashboard</Link>
              <span>›</span>
              <span>Company Dashboard</span>
            </span>
            {client && <span className="text-[10px] font-mono">{client.gstin}</span>}
            {client && <span>{client.registration_type}</span>}
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <NoticesTopNav />
        {!loading && client && (
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterPill
              label="Type"
              allLabel="All notices"
              value={typeFilter}
              onChange={setTypeFilter}
              options={noticeTypes}
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !client ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Company not found.</p>
      ) : (
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          {/* Company Profile */}
          <Card className="xl:w-[280px] xl:shrink-0">
            <NoticesCardHeader
              title="Company Profile"
              badge={canAddEditClients() ? (
                <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => navigate(`/edit-client/${client.id}`)} title="Edit Client">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              ) : undefined}
            />
            <CardContent className="space-y-3 pt-3 pb-4 text-xs">
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
                <p className="text-[10px] font-mono text-muted-foreground">{client.gstin}</p>
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

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {/* KPI tiles */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {kpiCards.map((card) => (
                <Card
                  key={card.label}
                  className={cn('border-l-4 cursor-pointer transition-shadow hover:shadow-md', card.accent)}
                  onClick={() => navigate(card.href)}
                >
                  <CardContent className="p-3.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{card.label}</span>
                    </div>
                    <p className="font-heading text-[30px] font-bold tabular-nums leading-none">
                      {card.value}
                      <span className="ml-1.5 font-sans text-xs font-medium text-muted-foreground">{card.context}</span>
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span />
                      <span className="font-semibold text-primary">{card.cta}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Notices & Orders + View Submission */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <NoticesCardHeader title="Notices & Orders" badge={filteredNotices.length} />
                <CardContent className="space-y-2 pt-3 pb-3">
                  {filteredNotices.slice(0, 5).map((n, i) => (
                    <div key={n.id} className="flex items-start gap-2 border-b pb-2 text-xs last:border-0 last:pb-0">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{n.notice_type || n.description || 'Notice'}</p>
                        <p className="text-muted-foreground">Ref Id: {n.reference_number || '—'} · Issue: {isoDateToDMY(n.issue_date)}</p>
                      </div>
                      {n.case_id ? (
                        <Link to={`/notices-case-folder/${client.id}/${encodeURIComponent(n.case_id)}`} title="Open Notice Folder">
                          <Eye className="h-4 w-4 text-primary" />
                        </Link>
                      ) : n.pdf_url ? (
                        <a href={n.pdf_url} target="_blank" rel="noreferrer"><FileText className="h-4 w-4 text-destructive" /></a>
                      ) : null}
                    </div>
                  ))}
                  {filteredNotices.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No notices on record.</p>}
                  <Link to={`/notices-all?client=${client.id}`} className="block text-right text-[11px] font-semibold text-primary hover:underline">View All</Link>
                </CardContent>
              </Card>

              <Card>
                <NoticesCardHeader title="View Submission" badge={submissions.length} />
                <CardContent className="space-y-2 pt-3 pb-3">
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
                  <Link to={`/notices-all?client=${client.id}&filter=submitted`} className="block text-right text-[11px] font-semibold text-primary hover:underline">View All</Link>
                </CardContent>
              </Card>
            </div>

            {/* Track Return Status */}
            <Card>
              <NoticesCardHeader title="Track Return Status" description="Filing dates as recorded on the GST portal." />
              <CardContent className="pt-3 pb-3">
                <div className="overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="bg-muted text-[10px] font-semibold uppercase">Financial Year</TableHead>
                        <TableHead className="bg-muted text-[10px] font-semibold uppercase">Period</TableHead>
                        <TableHead className="bg-muted text-[10px] font-semibold uppercase">GSTR-1 Filing Date</TableHead>
                        <TableHead className="bg-muted text-[10px] font-semibold uppercase">GSTR-3B Filing Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filingsByPeriod.length === 0 ? (
                        <TableRow><TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">No filed returns on record.</TableCell></TableRow>
                      ) : (
                        filingsByPeriod.slice(0, 12).map((f) => (
                          <TableRow key={f.period}>
                            <TableCell className="text-xs tabular-nums">{f.fy}</TableCell>
                            <TableCell className="text-xs tabular-nums">{monthLabel(f.period)}</TableCell>
                            <TableCell className="text-xs tabular-nums">{f.gstr1 || '—'}</TableCell>
                            <TableCell className="text-xs tabular-nums">{f.gstr3b || '—'}</TableCell>
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card>
                <NoticesCardHeader title="Business Owners" />
                <CardContent className="pt-3 pb-4"><p className="text-xs text-muted-foreground">Not captured by the portal sync.</p></CardContent>
              </Card>
              <Card>
                <NoticesCardHeader title="HSN / SAC" />
                <CardContent className="pt-3 pb-4"><p className="text-xs text-muted-foreground">Not captured by the portal sync.</p></CardContent>
              </Card>
              <Card>
                <NoticesCardHeader title="Return Periodicity" />
                <CardContent className="pt-3 pb-4"><p className="text-xs text-muted-foreground">Not captured by the portal sync.</p></CardContent>
              </Card>
              <Card>
                <NoticesCardHeader title="Business Activities" />
                <CardContent className="pt-3 pb-4"><p className="text-xs text-muted-foreground">Not captured by the portal sync.</p></CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompanyProfilePage;
