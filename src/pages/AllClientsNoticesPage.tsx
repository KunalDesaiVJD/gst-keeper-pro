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
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { NoticeWorkflowListView } from '@/components/reports/views/NoticeWorkflowListView';
import type { ReportTable } from '@/utils/allClientsReports';
import { classifyNoticeCategory, isRegistrationRelated as isRegistrationDescription } from '@/utils/noticeCategoryClassifier';
import { Bell, ArrowLeft, Loader2 } from 'lucide-react';

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
  priority: boolean;
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
};

const AllClientsNoticesPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const [params] = useSearchParams();
  const [records, setRecords] = useState<NoticeRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const filter = params.get('filter') || '';
  const status = params.get('status') || '';
  const typeParam = params.get('type') || '';
  const category = params.get('category') || '';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('gst_notices')
        .select(
          'id, client_id, reference_number, case_id, notice_type, description, issue_date, due_date, extended_due_date, ' +
          'staff_status, priority, reply_ref_number, reply_date, order_number, order_date, submission_arn, submission_date, ' +
          'amount_of_demand, remarks, issued_by, financial_year, assign_to, pdf_url, pulled_at, clients(name, gstin)',
        )
        .eq('source', 'notices')
        .order('issue_date', { ascending: false });
      if (!cancelled) {
        setRecords((data || []) as unknown as NoticeRecord[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const daysAgo = (v: string | null) => (v ? (now - new Date(v).getTime()) / DAY_MS : Infinity);
  const daysUntil = (v: string | null) => (v ? (new Date(v).getTime() - now) / DAY_MS : -Infinity);

  const filtered = useMemo(() => {
    let list = records;
    if (typeParam === 'registration') list = list.filter(isRegistrationRelated);
    if (typeParam === 'other') list = list.filter((r) => !isRegistrationRelated(r));
    if (category) list = list.filter((r) => classifyNoticeCategory(r) === category);
    if (status) list = list.filter((r) => (r.staff_status || '').trim().toLowerCase() === status.toLowerCase());
    if (filter === 'last15') list = list.filter((r) => daysAgo(r.issue_date) <= 15);
    if (filter === 'last24h') list = list.filter((r) => daysAgo(r.pulled_at) <= 1);
    if (filter === 'due7') list = list.filter((r) => r.due_date && daysUntil(r.due_date) >= 0 && daysUntil(r.due_date) <= 7);
    if (filter === 'overdue') list = list.filter((r) => r.due_date && daysUntil(r.due_date) < 0);
    if (filter === 'priority') list = list.filter((r) => r.priority);
    if (filter === 'submitted') list = list.filter((r) => !!r.submission_date || !!r.submission_arn);
    return list;
  }, [records, typeParam, category, status, filter]);

  const table: ReportTable = {
    title: 'Notices — All Clients',
    subtitle:
      `${filtered.length} record${filtered.length === 1 ? '' : 's'}` +
      (FILTER_LABELS[filter] ? `, ${FILTER_LABELS[filter]}` : '') +
      (status ? `, status ${status}` : '') +
      (category ? `, ${category}` : ''),
    headers: [
      'GSTIN', 'Trade Name', 'Reference No.', 'Case ID', 'Type', 'Description', 'Issue Date', 'Due Date', 'Extended Due Date',
      'Status', 'Priority', 'Reply Ref No.', 'Reply Date', 'Order No.', 'Order Date', 'Submission ARN', 'Submission Date',
      'Amount of Demand', 'Remarks', 'Issued By', 'Financial Year', 'Assign To', 'PDF',
    ],
    rows: filtered.map((r) => [
      r.clients?.gstin || '—', r.clients?.name || '—',
      r.reference_number || '—', r.case_id || '—', r.notice_type || '—', r.description || '—',
      r.issue_date || '—', r.due_date || '—', r.extended_due_date || '—',
      r.staff_status || '—', r.priority ? 'High' : '—',
      r.reply_ref_number || '—', r.reply_date || '—', r.order_number || '—', r.order_date || '—',
      r.submission_arn || '—', r.submission_date || '—',
      r.amount_of_demand != null ? num(r.amount_of_demand) : '—', r.remarks || '—', r.issued_by || '—', r.financial_year || '—', r.assign_to || '—',
      r.pdf_url || '—',
    ]),
    rowIds: filtered.map((r) => r.id),
    fileNameBase: 'Notices_All_Clients',
    columnWidths: [16, 24, 16, 16, 16, 40, 12, 12, 14, 10, 8, 14, 12, 14, 12, 16, 14, 14, 24, 12, 12, 14, 12],
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link to="/notices-dashboard"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <PageHeader title="Notices — All Clients" subtitle="Every client's notices and orders, filtered from the dashboard tile you clicked." icon={<Bell className="h-6 w-6" />} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <NoticeWorkflowListView table={table} report={{ title: table.title, icon: Bell }} />
      )}
    </div>
  );
};

export default AllClientsNoticesPage;
