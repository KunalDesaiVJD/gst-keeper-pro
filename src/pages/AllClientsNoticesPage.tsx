// The Notices Dashboard's tile drill-down target — the firm-wide, all-
// clients equivalent of the per-client "View Notice and Orders" report.
// Reuses NoticeWorkflowListView (search/filter/sort/status-edit/case-
// tracking dialog) wholesale by feeding it the same ReportTable shape, with
// GSTIN + Trade Name columns prepended so rows from different clients are
// distinguishable. The query-string filter mirrors which Notices Dashboard
// tile was clicked (see NoticesDashboardPage's kpiCards `to` field) —
// matches Notice Alert's own tile-to-filtered-list behavior.
import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { NoticeWorkflowListView } from '@/components/reports/views/NoticeWorkflowListView';
import { EvidenceEventListView } from '@/components/reports/views/EvidenceEventListView';
import { AddNoticeDialog } from '@/components/notices/AddNoticeDialog';
import type { ReportTable } from '@/utils/allClientsReports';
import { classifyNoticeCategory, isRegistrationRelated as isRegistrationDescription } from '@/utils/noticeCategoryClassifier';
import { isClosed } from '@/utils/noticeSummaryReport';
import { isoDateToDMY } from '@/utils/formatDate';
import { Bell, ArrowLeft, Loader2, ChevronRight, Layers } from 'lucide-react';

interface RefundRecord {
  arn: string | null;
  refund_type: string | null;
  filed_date: string | null;
  status: string | null;
  documents: { tab: string; label: string; url: string }[] | null;
  clients: { name: string | null; gstin: string | null } | null;
  client_id: string | null;
}

interface Drc03Record {
  arn: string | null;
  cause_of_payment: string | null;
  filed_date: string | null;
  status: string | null;
  pdf_url: string | null;
  clients: { name: string | null; gstin: string | null } | null;
  client_id: string | null;
}

interface NoticeRecord {
  id: string;
  client_id: string;
  reference_number: string | null;
  case_id: string | null;
  notice_type: string | null;
  description: string | null;
  issue_date: string | null;
  due_date: string | null;
  extended_due_date: string | null;
  staff_status: string | null;
  priority: string | null;
  reply_ref_number: string | null;
  reply_date: string | null;
  order_number: string | null;
  order_date: string | null;
  submission_arn: string | null;
  submission_date: string | null;
  amount_of_demand: number | null;
  remarks: string | null;
  issued_by: string | null;
  financial_year: string | null;
  assign_to: string | null;
  pdf_url: string | null;
  pulled_at: string;
  clients: { name: string | null; gstin: string | null } | null;
}

const isRegistrationRelated = (r: NoticeRecord) => isRegistrationDescription(r.description);
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const FILTER_LABELS: Record<string, string> = {
  last15: 'issued in the last 15 days',
  last24h: 'pulled from the portal in the last 24 hours',
  due7: 'due within 7 days',
  overdue: 'overdue',
  priority: 'flagged priority',
  submitted: 'with a submission logged',
  replied: 'with a reply logged',
};

const AllClientsNoticesPage: React.FC = () => {
  const { isStaffRole, canEditNoticeStatus } = useAuth();
  const [params, setParams] = useSearchParams();
  const [records, setRecords] = useState<NoticeRecord[]>([]);
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [drc03s, setDrc03s] = useState<Drc03Record[]>([]);
  const [loading, setLoading] = useState(true);

  const filter = params.get('filter') || '';
  const status = params.get('status') || '';
  const typeParam = params.get('type') || '';
  const category = params.get('category') || '';
  // From the Notices Dashboard calendar's date-click drill-down (matches
  // Notice Alert's own calendar: clicking a date shows notices issued OR due
  // that day). YYYY-MM-DD, compared against the date-only prefix of each
  // ISO timestamp so time-of-day never breaks the match.
  const dateParam = params.get('date') || '';
  // From a Company Profile page's "View All" links — scopes the firm-wide
  // list down to just that one client's notices.
  const clientParam = params.get('client') || '';
  // "Notices & Orders" (editable, gst_notices only) vs "Merged Notices"
  // (Notice Alert's own second tab — every source combined into one
  // chronological, read-only list; confirmed live it's not a flat re-listing
  // of every portal document, just every SOURCE combined without a Section
  // filter, which is exactly what gst_notices + refunds + DRC-03 already are
  // for us since we don't expand case-folders into extra rows).
  const activeTab = params.get('tab') === 'merged' ? 'merged' : 'notices';
  const setActiveTab = (tab: 'notices' | 'merged') => {
    const next = new URLSearchParams(params);
    if (tab === 'notices') next.delete('tab'); else next.set('tab', tab);
    setParams(next, { replace: true });
  };

  const fetchAll = async () => {
    setLoading(true);
    const [noticesData, refundsRes, drc03Res] = await Promise.all([
      fetchAllRows<NoticeRecord>(
        'gst_notices',
        'id, client_id, reference_number, case_id, notice_type, description, issue_date, due_date, extended_due_date, ' +
        'staff_status, priority, reply_ref_number, reply_date, order_number, order_date, submission_arn, submission_date, ' +
        'amount_of_demand, remarks, issued_by, financial_year, assign_to, pdf_url, pulled_at, clients(name, gstin)',
        (q) => q.eq('source', 'notices'),
      ),
      supabase.from('gst_refund_applications').select('arn, refund_type, filed_date, status, documents, client_id, clients(name, gstin)'),
      supabase.from('gst_drc03_filings').select('arn, cause_of_payment, filed_date, status, pdf_url, client_id, clients(name, gstin)'),
    ]);
    // fetchAllRows paginates in .range() chunks rather than one ordered
    // query, so the combined result needs its own sort afterward.
    noticesData.sort((a, b) => (b.issue_date || '').localeCompare(a.issue_date || ''));
    setRecords(noticesData as unknown as NoticeRecord[]);
    setRefunds((refundsRes.data || []) as unknown as RefundRecord[]);
    setDrc03s((drc03Res.data || []) as unknown as Drc03Record[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
  }, []);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const setTypeOfNoticesParam = (v: string) => {
    const next = new URLSearchParams(params);
    if (v === 'all') next.delete('type'); else next.set('type', v);
    setParams(next, { replace: true });
  };

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const daysAgo = (v: string | null) => (v ? (now - new Date(v).getTime()) / DAY_MS : Infinity);
  const daysUntil = (v: string | null) => (v ? (new Date(v).getTime() - now) / DAY_MS : -Infinity);

  const filtered = useMemo(() => {
    let list = records;
    if (typeParam === 'registration') list = list.filter(isRegistrationRelated);
    if (typeParam === 'other') list = list.filter((r) => !isRegistrationRelated(r));
    if (category) list = list.filter((r) => classifyNoticeCategory(r) === category);
    // "Open" here means "not closed" (matches the Notice Summary panel's own
    // isClosed logic) — most rows have staff_status = null, which reads as
    // Open, not as a literal "Open" string, so an exact-match filter here
    // would silently show 0 results for every Open drill-down.
    if (status) list = list.filter((r) => (status.toLowerCase() === 'closed' ? isClosed(r.staff_status) : !isClosed(r.staff_status)));
    if (filter === 'last15') list = list.filter((r) => daysAgo(r.issue_date) <= 15);
    if (filter === 'last24h') list = list.filter((r) => daysAgo(r.pulled_at) <= 1);
    if (filter === 'due7') list = list.filter((r) => r.due_date && daysUntil(r.due_date) >= 0 && daysUntil(r.due_date) <= 7);
    if (filter === 'overdue') list = list.filter((r) => r.due_date && daysUntil(r.due_date) < 0);
    if (filter === 'priority') list = list.filter((r) => r.priority);
    if (filter === 'submitted') list = list.filter((r) => !!r.submission_date || !!r.submission_arn);
    if (filter === 'replied') list = list.filter((r) => !!r.reply_date);
    if (dateParam) list = list.filter((r) => (r.issue_date || '').slice(0, 10) === dateParam || (r.due_date || '').slice(0, 10) === dateParam);
    if (clientParam) list = list.filter((r) => r.client_id === clientParam);
    return list;
  }, [records, typeParam, category, status, filter, dateParam, clientParam]);

  const table: ReportTable = {
    title: 'Notices — All Clients',
    subtitle:
      `${filtered.length} record${filtered.length === 1 ? '' : 's'}` +
      (FILTER_LABELS[filter] ? `, ${FILTER_LABELS[filter]}` : '') +
      (status ? `, status ${status}` : '') +
      (category ? `, ${category}` : '') +
      (dateParam ? `, issued/due on ${dateParam}` : ''),
    headers: [
      'GSTIN', 'Trade Name', 'Reference No.', 'Case ID', 'Type', 'Description', 'Issue Date', 'Due Date', 'Extended Due Date',
      'Status', 'Priority', 'Reply Ref No.', 'Reply Date', 'Order No.', 'Order Date', 'Submission ARN', 'Submission Date',
      'Amount of Demand', 'Remarks', 'Issued By', 'Financial Year', 'Assign To', 'PDF',
    ],
    rows: filtered.map((r) => [
      r.clients?.gstin || '—', r.clients?.name || '—',
      r.reference_number || '—', r.case_id || '—', r.notice_type || '—', r.description || '—',
      isoDateToDMY(r.issue_date), isoDateToDMY(r.due_date), isoDateToDMY(r.extended_due_date),
      r.staff_status || '—', r.priority || '—',
      r.reply_ref_number || '—', isoDateToDMY(r.reply_date), r.order_number || '—', isoDateToDMY(r.order_date),
      r.submission_arn || '—', isoDateToDMY(r.submission_date),
      r.amount_of_demand != null ? num(r.amount_of_demand) : '—', r.remarks || '—', r.issued_by || '—', r.financial_year || '—', r.assign_to || '—',
      r.pdf_url || '—',
    ]),
    rowIds: filtered.map((r) => r.id),
    clientIds: filtered.map((r) => r.client_id),
    fileNameBase: 'Notices_All_Clients',
    columnWidths: [16, 24, 16, 16, 16, 40, 12, 12, 14, 10, 8, 14, 12, 14, 12, 16, 14, 14, 24, 12, 12, 14, 12],
  };

  const mergedRows = useMemo(() => {
    // client_id only populated for Refunds/DRC-03 rows, where `ref` (the ARN)
    // is itself a valid case-folder key — Notices & Orders rows here carry
    // reference_number, not case_id, so linking those would point at the
    // wrong (or a nonexistent) folder; they stay plain text, same as before.
    type MergedRow = { gstin: string; trade: string; section: string; ref: string; type: string; date: string; due: string; desc: string; status: string; pdf: string | null; clientId: string | null };
    const noticeRows: MergedRow[] = records
      .filter((r) => (typeParam === 'registration' ? isRegistrationRelated(r) : typeParam === 'other' ? !isRegistrationRelated(r) : true))
      .map((r) => ({
        gstin: r.clients?.gstin || '—', trade: r.clients?.name || '—', section: 'Notices & Orders',
        ref: r.reference_number || '—', type: r.notice_type || '—', date: r.issue_date || '', due: r.due_date || '—',
        desc: r.description || '—', status: r.staff_status || '—', pdf: r.pdf_url, clientId: null,
      }));
    const refundRows: MergedRow[] = typeParam === 'registration' ? [] : refunds.map((r) => {
      const docs = Array.isArray(r.documents) ? r.documents : [];
      return {
        gstin: r.clients?.gstin || '—', trade: r.clients?.name || '—', section: 'Refunds',
        ref: r.arn || '—', type: 'GST RFD-01', date: r.filed_date || '', due: '—',
        desc: r.refund_type || '—', status: r.status || '—', pdf: docs[0]?.url || null, clientId: r.client_id,
      };
    });
    const drc03Rows: MergedRow[] = typeParam === 'registration' ? [] : drc03s.map((r) => ({
      gstin: r.clients?.gstin || '—', trade: r.clients?.name || '—', section: 'DRC-03',
      ref: r.arn || '—', type: 'DRC-03', date: r.filed_date || '', due: '—',
      desc: r.cause_of_payment || '—', status: r.status || '—', pdf: r.pdf_url, clientId: r.client_id,
    }));
    return [...noticeRows, ...refundRows, ...drc03Rows].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [records, refunds, drc03s, typeParam]);

  const mergedTable: ReportTable = {
    title: 'Merged Notices — All Clients',
    subtitle: `${mergedRows.length} record${mergedRows.length === 1 ? '' : 's'} — every source (Notices & Orders, Refunds, DRC-03) combined, most recent first`,
    headers: ['GSTIN', 'Trade Name', 'Section', 'Ref ID', 'Type', 'Issued Date', 'Due Date', 'Description', 'Status', 'PDF'],
    rows: mergedRows.map((r) => [r.gstin, r.trade, r.section, r.ref, r.type, isoDateToDMY(r.date), isoDateToDMY(r.due), r.desc, r.status, r.pdf || '—']),
    clientIds: mergedRows.map((r) => r.clientId),
    fileNameBase: 'Merged_Notices_All_Clients',
    columnWidths: [16, 24, 16, 18, 16, 12, 12, 40, 12, 30],
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Link to="/notices-dashboard" className="hover:text-foreground hover:underline">Notices Dashboard</Link>
        <ChevronRight className="h-3 w-3" />
        <span>Notices and Orders</span>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link to="/notices-dashboard"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <PageHeader title="Notices — All Clients" subtitle="Every client's notices and orders, filtered from the dashboard tile you clicked." icon={<Bell className="h-6 w-6" />} />
      </div>

      <div className="flex items-center gap-2">
        <Label htmlFor="type-of-notices" className="text-xs text-muted-foreground">Types Of Notices</Label>
        <Select value={typeParam || 'all'} onValueChange={setTypeOfNoticesParam}>
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

      <div className="flex items-center justify-between gap-2">
        <div className="flex w-fit rounded-md border bg-muted/30 p-1">
          <Button
            size="sm"
            variant={activeTab === 'notices' ? 'default' : 'ghost'}
            className="h-8"
            onClick={() => setActiveTab('notices')}
          >
            Notices & Orders
          </Button>
          <Button
            size="sm"
            variant={activeTab === 'merged' ? 'default' : 'ghost'}
            className="h-8"
            onClick={() => setActiveTab('merged')}
          >
            Merged Notices
          </Button>
        </div>
        {canEditNoticeStatus() && <AddNoticeDialog onSuccess={fetchAll} />}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : activeTab === 'merged' ? (
        <EvidenceEventListView table={mergedTable} report={{ title: mergedTable.title, icon: Layers }} />
      ) : (
        <NoticeWorkflowListView table={table} report={{ title: table.title, icon: Bell }} />
      )}
    </div>
  );
};

export default AllClientsNoticesPage;
