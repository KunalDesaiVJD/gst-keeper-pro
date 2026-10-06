// The Notices Dashboard's tile drill-down target — the firm-wide, all-
// clients equivalent of the per-client "View Notice and Orders" report.
// Reuses NoticeWorkflowListView (search/filter/sort/status-edit/case-
// tracking dialog) wholesale by feeding it the same ReportTable shape, with
// GSTIN + Trade Name columns prepended so rows from different clients are
// distinguishable.
//
// Every filter reads the canonical flags of public.notice_facts (lib/
// noticeFacts) — the same flags the dashboard tiles and the Notice Summary
// count — so a tile's number is always this list's row count.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { loadNoticeFacts, loadRefundFacts, loadDrc03Facts, istToday, daysBetween, type NoticeFact, type RefundFact, type Drc03Fact } from '@/lib/noticeFacts';
import { NoticeWorkflowListView } from '@/components/reports/views/NoticeWorkflowListView';
import { EvidenceEventListView } from '@/components/reports/views/EvidenceEventListView';
import { AddNoticeDialog } from '@/components/notices/AddNoticeDialog';
import { NoticesTopNav } from '@/components/notices/NoticesTopNav';
import NoticesPageHeader from '@/components/notices/NoticesPageHeader';
import FilterPill from '@/components/notices/FilterPill';
import { cn } from '@/lib/utils';
import type { ReportTable } from '@/utils/allClientsReports';
import { classifyNoticeCategory, isRegistrationRelated as isRegistrationDescription } from '@/utils/noticeCategoryClassifier';
import { isOpen, isOverdue, isDueIn7, isNew } from '@/utils/noticeDefinitions';
import { isoDateToDMY } from '@/utils/formatDate';
import { toast } from 'sonner';
import { Bell, Loader2, Layers } from 'lucide-react';

const isRegistrationRelated = (r: NoticeFact) => isRegistrationDescription(r.description);
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const FILTER_LABELS: Record<string, string> = {
  last15: 'issued in the last 15 days',
  last24h: 'pulled from the portal in the last 24 hours',
  due7: 'due within 7 days (not yet replied)',
  overdue: 'overdue',
  priority: 'flagged priority',
  submitted: 'with a submission logged',
  replied: 'with a reply logged',
  new: 'first seen in the last 24 hours',
  exposure: 'open disputes with a demand (each counted once)',
  unassigned: 'open, without an owner',
};

const DUE_BASIS_LABEL: Record<string, string> = {
  portal: 'Portal',
  extended: 'Extended',
  computed: 'Computed',
};

const AllClientsNoticesPage: React.FC = () => {
  const { isStaffRole, canEditNoticeStatus } = useAuth();
  const [params, setParams] = useSearchParams();
  const [records, setRecords] = useState<NoticeFact[]>([]);
  const [refunds, setRefunds] = useState<RefundFact[]>([]);
  const [drc03s, setDrc03s] = useState<Drc03Fact[]>([]);
  const [clockNoticeIds, setClockNoticeIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const filter = params.get('filter') || '';
  const status = params.get('status') || '';
  const typeParam = params.get('type') || '';
  const category = params.get('category') || '';
  // From the Notices Dashboard calendar's date-click drill-down: notices issued,
  // due, heard, or with an appeal / attachment clock on that day (YYYY-MM-DD).
  const dateParam = params.get('date') || '';
  // From a Company Profile page's "View All" links — one client's notices.
  const clientParam = params.get('client') || '';
  // Deep-link to one notice (drawer "Open in list", the bell, alert e-mails).
  const noticeIdParam = params.get('noticeId') || '';
  // "Notices & Orders" (editable) vs "Merged Notices" (every source combined, read-only).
  const activeTab = params.get('tab') === 'merged' ? 'merged' : 'notices';
  const setActiveTab = (tab: 'notices' | 'merged') => {
    const next = new URLSearchParams(params);
    if (tab === 'notices') next.delete('tab'); else next.set('tab', tab);
    setParams(next, { replace: true });
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [notices, refundRows, drc03Rows] = await Promise.all([
        loadNoticeFacts(), loadRefundFacts(), loadDrc03Facts(),
      ]);
      const sorted = [...notices.rows].sort((a, b) => (b.issue_date || '').localeCompare(a.issue_date || ''));
      setRecords(sorted);
      setRefunds(refundRows);
      setDrc03s(drc03Rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load notices');
    }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // The calendar counts appeal / attachment clocks on a day too; load which notices have one.
  useEffect(() => {
    if (!dateParam) { setClockNoticeIds(new Set()); return; }
    let cancelled = false;
    supabase.from('matter_deadlines').select('notice_id')
      .in('deadline_type', ['appeal_s107', 'appeal_s107_condonation', 'appeal_s112', 'appeal_s112_condonation', 'attachment_expiry'])
      .eq('is_met', false).eq('deadline_date', dateParam)
      .then(({ data }) => { if (!cancelled) setClockNoticeIds(new Set((data ?? []).map((d) => d.notice_id))); });
    return () => { cancelled = true; };
  }, [dateParam]);

  const setTypeOfNoticesParam = (v: string) => {
    const next = new URLSearchParams(params);
    if (v === 'all') next.delete('type'); else next.set('type', v);
    setParams(next, { replace: true });
  };

  const filtered = useMemo(() => {
    const today = istToday();
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    let list = records;
    if (typeParam === 'registration') list = list.filter(isRegistrationRelated);
    if (typeParam === 'other') list = list.filter((r) => !isRegistrationRelated(r));
    if (category) list = list.filter((r) => classifyNoticeCategory(r) === category);
    if (status) list = list.filter((r) => (status.toLowerCase() === 'closed' ? !isOpen(r) : isOpen(r)));
    if (filter === 'last15') list = list.filter((r) => !!r.issue_date && daysBetween(r.issue_date, today) >= 0 && daysBetween(r.issue_date, today) <= 15);
    if (filter === 'last24h') list = list.filter((r) => !!r.pulled_at && now - new Date(r.pulled_at).getTime() <= dayMs);
    if (filter === 'due7') list = list.filter((r) => isDueIn7(r));
    if (filter === 'overdue') list = list.filter((r) => isOverdue(r));
    if (filter === 'priority') list = list.filter((r) => !!r.priority);
    if (filter === 'submitted') list = list.filter((r) => !!r.submission_date || !!r.submission_arn);
    // Replies are counted on notices; refund / voluntary-payment case rows sit in their own sets.
    if (filter === 'replied') list = list.filter((r) => (!!r.is_replied || !!r.reply_date) && !r.is_refund_case && !r.is_drc03_case);
    if (filter === 'new') list = list.filter((r) => isNew(r));
    if (filter === 'exposure') list = list.filter((r) => num(r.exposure_amount) > 0);
    if (filter === 'unassigned') list = list.filter((r) => isOpen(r) && !r.assign_to_user_id);
    if (dateParam) {
      list = list.filter((r) => (r.issue_date || '').slice(0, 10) === dateParam
        || (isOpen(r) && (r.effective_due || '').slice(0, 10) === dateParam)
        || (isOpen(r) && (r.hearing_date || '').slice(0, 10) === dateParam)
        || (!!r.id && clockNoticeIds.has(r.id)));
    }
    if (clientParam) list = list.filter((r) => r.client_id === clientParam);
    if (noticeIdParam) list = list.filter((r) => r.id === noticeIdParam);
    return list;
  }, [records, typeParam, category, status, filter, dateParam, clientParam, noticeIdParam, clockNoticeIds]);

  const table: ReportTable = {
    title: 'Notices — All Clients',
    subtitle:
      `${filtered.length} record${filtered.length === 1 ? '' : 's'}` +
      (FILTER_LABELS[filter] ? `, ${FILTER_LABELS[filter]}` : '') +
      (status ? `, status ${status}` : '') +
      (category ? `, ${category}` : '') +
      (dateParam ? `, issued, due, heard or with a clock on ${dateParam}` : ''),
    headers: [
      'GSTIN', 'Trade Name', 'Reference No.', 'Case ID', 'Type', 'Form', 'Description', 'Issue Date', 'Due Date', 'Extended Due Date',
      'Due Basis', 'Status', 'Priority', 'Reply Ref No.', 'Reply Date', 'Order No.', 'Order Date', 'Submission ARN', 'Submission Date',
      'Amount of Demand', 'Remarks', 'Issued By', 'Financial Year', 'Assign To', 'PDF',
    ],
    rows: filtered.map((r) => [
      r.client_gstin || '—', r.client_name || '—',
      r.reference_number || '—', r.case_id || '—', r.notice_type || '—', r.form_label || r.form_code || '—', r.description || '—',
      isoDateToDMY(r.issue_date),
      // The short clock fills Due Date when the portal gives none (Due Basis says so).
      isoDateToDMY(r.due_date || (r.due_basis === 'computed' ? r.effective_due : null)),
      isoDateToDMY(r.extended_due_date),
      r.due_basis ? (r.due_basis === 'computed' && r.due_basis_note ? `Computed — ${r.due_basis_note}` : DUE_BASIS_LABEL[r.due_basis] ?? r.due_basis) : '—',
      r.staff_status || '—', r.priority || '—',
      r.reply_ref_number || '—', isoDateToDMY(r.reply_date), r.order_number || '—', isoDateToDMY(r.order_date),
      r.submission_arn || '—', isoDateToDMY(r.submission_date),
      r.amount_of_demand != null ? num(r.amount_of_demand) : '—', r.remarks || '—', r.issued_by || '—', r.financial_year || '—', r.assign_to || '—',
      r.pdf_url || '—',
    ]),
    rowIds: filtered.map((r) => r.id),
    clientIds: filtered.map((r) => r.client_id),
    rowFlags: filtered.map((r) => ({ overdue: isOverdue(r), dueIn7: isDueIn7(r) })),
    fileNameBase: 'Notices_All_Clients',
    columnWidths: [16, 24, 16, 16, 16, 22, 40, 12, 12, 14, 18, 10, 8, 14, 12, 14, 12, 16, 14, 14, 24, 12, 12, 14, 12],
  };

  const mergedRows = useMemo(() => {
    // client_id only populated for Refunds/DRC-03 rows, where `ref` (the ARN)
    // is itself a valid case-folder key.
    type MergedRow = { gstin: string; trade: string; section: string; ref: string; type: string; date: string; due: string; desc: string; status: string; pdf: string | null; clientId: string | null };
    // Same set and the same open / closed rule as the Notice Summary and the
    // GSTIN-wise count, so their Total / Open / Closed numbers are this tab's rows.
    const wantStatus = status.toLowerCase();
    const statusOk = (open: boolean) => (wantStatus === 'open' ? open : wantStatus === 'closed' ? !open : true);
    const clientOk = (clientId: string | null) => !clientParam || clientId === clientParam;
    const noticeRows: MergedRow[] = records
      .filter((r) => !r.is_refund_case && !r.is_drc03_case)
      .filter((r) => clientOk(r.client_id) && statusOk(isOpen(r)))
      .filter((r) => (typeParam === 'registration' ? isRegistrationRelated(r) : typeParam === 'other' ? !isRegistrationRelated(r) : true))
      .map((r) => ({
        gstin: r.client_gstin || '—', trade: r.client_name || '—', section: 'Notices & Orders',
        ref: r.reference_number || '—', type: r.form_label || r.notice_type || '—', date: r.issue_date || '', due: r.effective_due || '—',
        desc: r.description || '—', status: r.staff_status || '—', pdf: r.pdf_url, clientId: null,
      }));
    // The refund and DRC-03 sets already hold their case rows once (same ARN = same case).
    const refundRows: MergedRow[] = typeParam === 'registration' ? [] : refunds.filter((r) => clientOk(r.client_id) && statusOk(!r.is_closed)).map((r) => {
      const docs = Array.isArray(r.documents) ? (r.documents as { url?: string }[]) : [];
      return {
        gstin: r.client_gstin || '—', trade: r.client_name || '—', section: 'Refunds',
        ref: r.arn || '—', type: r.origin === 'case' ? 'Refund case' : 'GST RFD-01', date: r.filed_date || '', due: '—',
        desc: r.refund_type || '—', status: r.status || '—', pdf: docs[0]?.url || null, clientId: r.client_id,
      };
    });
    const drc03Rows: MergedRow[] = typeParam === 'registration' ? [] : drc03s.filter((r) => clientOk(r.client_id) && statusOk(!r.is_closed)).map((r) => ({
      gstin: r.client_gstin || '—', trade: r.client_name || '—', section: 'DRC-03',
      ref: r.arn || '—', type: 'DRC-03', date: r.filed_date || '', due: '—',
      desc: r.cause_of_payment || '—', status: r.status || '—', pdf: r.pdf_url, clientId: r.client_id,
    }));
    return [...noticeRows, ...refundRows, ...drc03Rows].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [records, refunds, drc03s, typeParam, clientParam, status]);

  const mergedTable: ReportTable = {
    title: 'Merged Notices — All Clients',
    subtitle: `${mergedRows.length} record${mergedRows.length === 1 ? '' : 's'}${status ? `, status ${status}` : ''} — every source (Notices & Orders, Refunds, DRC-03) combined, each case once, most recent first`,
    headers: ['GSTIN', 'Trade Name', 'Section', 'Ref ID', 'Type', 'Issued Date', 'Due Date', 'Description', 'Status', 'PDF'],
    rows: mergedRows.map((r) => [r.gstin, r.trade, r.section, r.ref, r.type, isoDateToDMY(r.date), isoDateToDMY(r.due), r.desc, r.status, r.pdf || '—']),
    clientIds: mergedRows.map((r) => r.clientId),
    fileNameBase: 'Merged_Notices_All_Clients',
    columnWidths: [16, 24, 16, 18, 16, 12, 12, 40, 12, 30],
  };

  // After every hook (Rules of Hooks).
  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-4 animate-fade-in">
      <NoticesPageHeader
        title="Notices — All Clients"
        icon={Bell}
        subtitle="Every client's notices and orders, filtered from the dashboard tile you clicked."
        actions={canEditNoticeStatus() ? <AddNoticeDialog onSuccess={fetchAll} /> : undefined}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <NoticesTopNav />
        <FilterPill
          label="Type"
          allLabel="All notices"
          value={typeParam || 'all'}
          onChange={setTypeOfNoticesParam}
          options={[]}
          extraOptions={[
            { value: 'registration', label: 'Registration' },
            { value: 'other', label: 'Other than Registration' },
          ]}
        />
      </div>

      <div className="flex w-fit items-center gap-0.5 rounded-lg bg-muted p-0.5">
        <button
          type="button"
          className={cn(
            'rounded-md px-3 py-1 text-[11px] font-medium transition-colors',
            activeTab === 'notices' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setActiveTab('notices')}
        >
          Notices & Orders
        </button>
        <button
          type="button"
          className={cn(
            'rounded-md px-3 py-1 text-[11px] font-medium transition-colors',
            activeTab === 'merged' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setActiveTab('merged')}
        >
          Merged Notices
        </button>
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
