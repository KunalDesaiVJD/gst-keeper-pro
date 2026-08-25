// NoticeWorkflowListView — "View Notice and Orders" specifically. Same
// chronological event-list shape as EvidenceEventListView (search/filter/
// sort/PDF-icon/Type-badge all reused as-is), plus staff case-tracking that
// writes back to the underlying gst_notices row: an inline Open/Closed
// status Select, a Priority flag, and an Edit dialog logging the reply
// filed, order received, and application submitted for that notice — none
// of which the portal itself ever exposes for these rows.
import React, { useEffect, useMemo, useState } from 'react';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { FileText, Search, DownloadCloud, Inbox, Pencil, Flag, Loader2, FileSpreadsheet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { renderReportToExcel } from '@/utils/allClientsReports';

interface NoticeWorkflowListViewProps {
  table: ReportTable;
  // Only title/icon are read here, so the firm-wide Notices Dashboard drill-
  // down can reuse this view with a lightweight stub instead of a full
  // catalog ReportDefinition.
  report: Pick<ReportDefinition, 'title' | 'icon'>;
}

// ─────────────────── Cell/header heuristics (same conventions as EvidenceEventListView) ──

const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v);

const isSentinel = (v: unknown): boolean => {
  const s = String(v ?? '').trim();
  if (!s) return false;
  if (s.toUpperCase() === 'NOT PULLED') return true;
  return /not captured|not pulled/i.test(s);
};

const isTotalRow = (row: (string | number)[]): boolean =>
  row.some((c) => String(c ?? '').trim().toUpperCase() === 'TOTAL');

const STATUS_HEADER_RE = /^status$/i;
const TYPE_HEADER_RE = /^type$/i;
const PRIORITY_HEADER_RE = /^priority$/i;
const REPLY_REF_HEADER_RE = /^reply ref/i;
const REPLY_DATE_HEADER_RE = /^reply date$/i;
const ORDER_NO_HEADER_RE = /^order no/i;
const ORDER_DATE_HEADER_RE = /^order date$/i;
const SUBMISSION_ARN_HEADER_RE = /^submission arn$/i;
const SUBMISSION_DATE_HEADER_RE = /^submission date$/i;
const EXTENDED_DUE_DATE_HEADER_RE = /^extended due date$/i;
const AMOUNT_HEADER_RE = /^amount of demand$/i;
const REMARKS_HEADER_RE = /^remarks$/i;
const FINANCIAL_YEAR_HEADER_RE = /^financial year$/i;
const ASSIGN_TO_HEADER_RE = /^assign to$/i;
const EVIDENCE_HEADER_RE = /PDF|DOCUMENT/i;
const DUE_DATE_HEADER_RE = /^due date$/i;
const DATE_HEADER_PRIORITY = [/^issue date$/i, /^date\/time$/i, /^date$/i];

const STATUS_OPEN_CLOSED = ['Open', 'Closed'];

// Matches Notice Alert's own "Filter" dropdown on this exact page (confirmed
// live 2026-08-25): date-range presets over Issue Date / Due Date, on top of
// the Status dropdown.
type DateFilter = 'all' | 'last24h' | 'last15days' | 'due7' | 'overdue';
const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_VARIANT = (v: string): 'success' | 'warning' | 'destructive' | 'secondary' => {
  const s = v.toUpperCase();
  if (s === 'CLOSED') return 'success';
  if (s === 'OPEN') return 'warning';
  return 'secondary';
};

const TYPE_VARIANT = (v: string): 'default' | 'warning' | 'info' | 'success' | 'destructive' | 'secondary' => {
  const s = v.toUpperCase();
  if (/ORDER/.test(s)) return 'default';
  if (/NOTICE/.test(s)) return 'warning';
  if (/UNDERTAKING|LUT/.test(s)) return 'info';
  if (/VOLUNTARY|PAYMENT|ACKNOWLEDG/.test(s)) return 'success';
  if (/REJECT|CANCEL|DEFAULT/.test(s)) return 'destructive';
  return 'secondary';
};

const findDateColIdx = (headers: string[]): number => {
  for (const re of DATE_HEADER_PRIORITY) {
    const idx = headers.findIndex((h) => re.test(h.trim()));
    if (idx !== -1) return idx;
  }
  const noDue = headers.findIndex((h) => /date/i.test(h) && !/due|reply|order|submission/i.test(h));
  if (noDue !== -1) return noDue;
  return headers.findIndex((h) => /date/i.test(h));
};

const parseDateLoose = (v: string | number | undefined): number => {
  if (v === undefined || v === null) return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (!s || s === '—' || isSentinel(s)) return NaN;
  const direct = Date.parse(s);
  if (!Number.isNaN(direct)) return direct;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  return NaN;
};

const formatCell = (v: string | number): string => {
  if (typeof v !== 'number') return String(v ?? '');
  if (v === 0) return '0';
  const rounded = Math.round(v * 100) / 100;
  return rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

// gst_notices columns the Edit dialog writes — keyed by the same header this
// view already shows, so the dialog's own field order matches the grid.
// Case ID and Issued By aren't here: both are auto-captured from the portal
// itself (see content.js's handleNotices), not staff-entered.
// Low/Medium/High — matches Notice Alert's own 3-tier Priority Status
// (confirmed live 2026-08-25), replacing the old plain boolean.
const PRIORITY_TIERS = ['Low', 'Medium', 'High'];

interface EditForm {
  priority: string;
  replyRefNumber: string;
  replyDate: string;
  orderNumber: string;
  orderDate: string;
  submissionArn: string;
  submissionDate: string;
  extendedDueDate: string;
  amountOfDemand: string;
  remarks: string;
  financialYear: string;
  assignTo: string;
}

const EMPTY_FORM: EditForm = {
  priority: '', replyRefNumber: '', replyDate: '', orderNumber: '', orderDate: '', submissionArn: '', submissionDate: '',
  extendedDueDate: '', amountOfDemand: '', remarks: '', financialYear: '', assignTo: '',
};

const cellToText = (v: string | number | undefined): string => {
  const s = String(v ?? '').trim();
  return s === '—' ? '' : s;
};

export const NoticeWorkflowListView: React.FC<NoticeWorkflowListViewProps> = ({ table, report }) => {
  const { canEditNoticeStatus } = useAuth();
  const canEdit = canEditNoticeStatus();

  const [rows, setRows] = useState(table.rows);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  // Checkbox selection + bulk "Update Status" — matches Notice Alert's own
  // toolbar (confirmed live), on top of the existing per-row inline editor.
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set());
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<string>('');
  const [bulkPriorityOpen, setBulkPriorityOpen] = useState(false);
  const [bulkPriority, setBulkPriority] = useState<string>('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const Icon = report.icon || FileText;

  useEffect(() => { setRows(table.rows); }, [table]);

  const headers = table.headers;
  const rowIds = table.rowIds;
  const evidenceColIdx = useMemo(() => headers.findIndex((h) => EVIDENCE_HEADER_RE.test(h)), [headers]);
  const statusColIdx = useMemo(() => headers.findIndex((h) => STATUS_HEADER_RE.test(h.trim())), [headers]);
  const typeColIdx = useMemo(() => headers.findIndex((h) => TYPE_HEADER_RE.test(h.trim())), [headers]);
  const priorityColIdx = useMemo(() => headers.findIndex((h) => PRIORITY_HEADER_RE.test(h.trim())), [headers]);
  const replyRefColIdx = useMemo(() => headers.findIndex((h) => REPLY_REF_HEADER_RE.test(h.trim())), [headers]);
  const replyDateColIdx = useMemo(() => headers.findIndex((h) => REPLY_DATE_HEADER_RE.test(h.trim())), [headers]);
  const orderNoColIdx = useMemo(() => headers.findIndex((h) => ORDER_NO_HEADER_RE.test(h.trim())), [headers]);
  const orderDateColIdx = useMemo(() => headers.findIndex((h) => ORDER_DATE_HEADER_RE.test(h.trim())), [headers]);
  const submissionArnColIdx = useMemo(() => headers.findIndex((h) => SUBMISSION_ARN_HEADER_RE.test(h.trim())), [headers]);
  const submissionDateColIdx = useMemo(() => headers.findIndex((h) => SUBMISSION_DATE_HEADER_RE.test(h.trim())), [headers]);
  const extendedDueDateColIdx = useMemo(() => headers.findIndex((h) => EXTENDED_DUE_DATE_HEADER_RE.test(h.trim())), [headers]);
  const amountColIdx = useMemo(() => headers.findIndex((h) => AMOUNT_HEADER_RE.test(h.trim())), [headers]);
  const remarksColIdx = useMemo(() => headers.findIndex((h) => REMARKS_HEADER_RE.test(h.trim())), [headers]);
  const financialYearColIdx = useMemo(() => headers.findIndex((h) => FINANCIAL_YEAR_HEADER_RE.test(h.trim())), [headers]);
  const assignToColIdx = useMemo(() => headers.findIndex((h) => ASSIGN_TO_HEADER_RE.test(h.trim())), [headers]);
  const dateColIdx = useMemo(() => findDateColIdx(headers), [headers]);
  const dueDateColIdx = useMemo(() => headers.findIndex((h) => DUE_DATE_HEADER_RE.test(h.trim())), [headers]);

  // Every row carries its original index (into `rows`/`rowIds`) through the
  // filter/sort pipeline below, so an edit always writes back to the right
  // DB row regardless of what's currently visible or how it's sorted.
  type Indexed = { row: (string | number)[]; idx: number };

  const { dataRows, totalRows } = useMemo(() => {
    const data: Indexed[] = [];
    const totals: Indexed[] = [];
    rows.forEach((row, idx) => {
      (isTotalRow(row) ? totals : data).push({ row, idx });
    });
    return { dataRows: data, totalRows: totals };
  }, [rows]);

  const statusOptions = useMemo(() => {
    if (statusColIdx === -1) return [] as string[];
    const set = new Set<string>();
    dataRows.forEach(({ row }) => {
      const v = String(row[statusColIdx] ?? '').trim();
      if (v && !isSentinel(v)) set.add(v);
    });
    // "Replied" isn't a staff_status value (reply_date is a separate field)
    // but Notice Alert lists it as its own Status filter option, so it's
    // synthetic here — matched against reply_date being set, not this column.
    if (replyDateColIdx !== -1 && dataRows.some(({ row }) => !isSentinel(row[replyDateColIdx]) && cellToText(row[replyDateColIdx]))) {
      set.add('Replied');
    }
    return Array.from(set).sort();
  }, [dataRows, statusColIdx, replyDateColIdx]);

  const typeOptions = useMemo(() => {
    if (typeColIdx === -1) return [] as string[];
    const set = new Set<string>();
    dataRows.forEach(({ row }) => {
      const v = String(row[typeColIdx] ?? '').trim();
      if (v && !isSentinel(v)) set.add(v);
    });
    return Array.from(set).sort();
  }, [dataRows, typeColIdx]);

  const withEvidenceCount = useMemo(() => {
    if (evidenceColIdx === -1) return 0;
    return dataRows.filter(({ row }) => isUrl(row[evidenceColIdx])).length;
  }, [dataRows, evidenceColIdx]);

  const statusCounts = useMemo(() => {
    if (statusColIdx === -1) return [] as { label: string; count: number }[];
    const counts = new Map<string, number>();
    dataRows.forEach(({ row }) => {
      const v = String(row[statusColIdx] ?? '').trim();
      if (!v || isSentinel(v)) return;
      counts.set(v, (counts.get(v) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [dataRows, statusColIdx]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = dataRows;
    if (statusFilter === 'Replied') {
      list = list.filter(({ row }) => replyDateColIdx !== -1 && !isSentinel(row[replyDateColIdx]) && cellToText(row[replyDateColIdx]));
    } else if (statusColIdx !== -1 && statusFilter !== 'all') {
      list = list.filter(({ row }) => String(row[statusColIdx] ?? '').trim() === statusFilter);
    }
    if (typeColIdx !== -1 && typeFilter !== 'all') {
      list = list.filter(({ row }) => String(row[typeColIdx] ?? '').trim() === typeFilter);
    }
    if (priorityColIdx !== -1 && priorityFilter !== 'all') {
      list = list.filter(({ row }) => String(row[priorityColIdx] ?? '').trim() === priorityFilter);
    }
    if (dateFilter !== 'all') {
      const now = Date.now();
      if (dateFilter === 'last24h' && dateColIdx !== -1) {
        list = list.filter(({ row }) => { const d = parseDateLoose(row[dateColIdx]); return !Number.isNaN(d) && now - d <= DAY_MS; });
      } else if (dateFilter === 'last15days' && dateColIdx !== -1) {
        list = list.filter(({ row }) => { const d = parseDateLoose(row[dateColIdx]); return !Number.isNaN(d) && now - d <= 15 * DAY_MS; });
      } else if (dateFilter === 'due7' && dueDateColIdx !== -1) {
        list = list.filter(({ row }) => { const d = parseDateLoose(row[dueDateColIdx]); return !Number.isNaN(d) && d - now >= 0 && d - now <= 7 * DAY_MS; });
      } else if (dateFilter === 'overdue' && dueDateColIdx !== -1) {
        list = list.filter(({ row }) => { const d = parseDateLoose(row[dueDateColIdx]); return !Number.isNaN(d) && d - now < 0; });
      }
    }
    if (q) {
      list = list.filter(({ row }) => row.some((c) => String(c ?? '').toLowerCase().includes(q)));
    }
    if (dateColIdx !== -1) {
      list = [...list].sort((a, b) => {
        const da = parseDateLoose(a.row[dateColIdx]);
        const db = parseDateLoose(b.row[dateColIdx]);
        const aValid = !Number.isNaN(da);
        const bValid = !Number.isNaN(db);
        if (aValid && bValid) return db - da; // newest first
        if (aValid) return -1;
        if (bValid) return 1;
        return 0;
      });
    }
    return list;
  }, [dataRows, search, statusFilter, statusColIdx, typeFilter, typeColIdx, priorityFilter, priorityColIdx, dateFilter, dateColIdx, dueDateColIdx, replyDateColIdx]);

  const handleDownloadAll = () => {
    if (evidenceColIdx === -1) return;
    const urls = visibleRows.map(({ row }) => row[evidenceColIdx]).filter(isUrl);
    if (urls.length === 0) {
      setDownloadNotice('No documents in the current view.');
      setTimeout(() => setDownloadNotice(null), 2500);
      return;
    }
    setDownloadNotice(`Opening ${urls.length} PDF${urls.length === 1 ? '' : 's'}…`);
    urls.forEach((url, i) => {
      setTimeout(() => window.open(url, '_blank', 'noopener,noreferrer'), i * 150);
    });
    setTimeout(() => setDownloadNotice(null), urls.length * 150 + 1500);
  };

  const patchRow = (idx: number, colIdx: number, value: string | number) => {
    setRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      const next = [...r];
      next[colIdx] = value;
      return next;
    }));
  };

  const handleStatusChange = async (idx: number, newStatus: string) => {
    const rowId = rowIds?.[idx];
    if (!rowId || statusColIdx === -1) return;
    setSavingIdx(idx);
    const { error } = await supabase.from('gst_notices').update({ staff_status: newStatus }).eq('id', rowId);
    setSavingIdx(null);
    if (error) { toast.error('Failed to update status: ' + error.message); return; }
    patchRow(idx, statusColIdx, newStatus);
    toast.success('Status updated');
  };

  const toggleSelect = (idx: number) => {
    setSelectedIdx((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedIdx(checked ? new Set(visibleRows.map(({ idx }) => idx)) : new Set());
  };

  const applyBulkStatus = async () => {
    if (!bulkStatus || statusColIdx === -1 || selectedIdx.size === 0) return;
    const ids = Array.from(selectedIdx).map((idx) => rowIds?.[idx]).filter((id): id is string => !!id);
    if (ids.length === 0) { setBulkStatusOpen(false); return; }
    setBulkSaving(true);
    const { error } = await supabase.from('gst_notices').update({ staff_status: bulkStatus }).in('id', ids);
    setBulkSaving(false);
    if (error) { toast.error('Failed to update status: ' + error.message); return; }
    setRows((prev) => prev.map((r, i) => {
      if (!selectedIdx.has(i)) return r;
      const next = [...r];
      next[statusColIdx] = bulkStatus;
      return next;
    }));
    toast.success(`Updated ${ids.length} record${ids.length === 1 ? '' : 's'}`);
    setBulkStatusOpen(false);
    setBulkStatus('');
    setSelectedIdx(new Set());
  };

  const applyBulkPriority = async () => {
    if (!bulkPriority || priorityColIdx === -1 || selectedIdx.size === 0) return;
    const ids = Array.from(selectedIdx).map((idx) => rowIds?.[idx]).filter((id): id is string => !!id);
    if (ids.length === 0) { setBulkPriorityOpen(false); return; }
    setBulkSaving(true);
    const { error } = await supabase.from('gst_notices').update({ priority: bulkPriority }).in('id', ids);
    setBulkSaving(false);
    if (error) { toast.error('Failed to update priority: ' + error.message); return; }
    setRows((prev) => prev.map((r, i) => {
      if (!selectedIdx.has(i)) return r;
      const next = [...r];
      next[priorityColIdx] = bulkPriority;
      return next;
    }));
    toast.success(`Updated ${ids.length} record${ids.length === 1 ? '' : 's'}`);
    setBulkPriorityOpen(false);
    setBulkPriority('');
    setSelectedIdx(new Set());
  };

  const openEditDialog = (idx: number) => {
    const row = rows[idx];
    setEditForm({
      priority: priorityColIdx !== -1 ? cellToText(row[priorityColIdx]) : '',
      replyRefNumber: replyRefColIdx !== -1 ? cellToText(row[replyRefColIdx]) : '',
      replyDate: replyDateColIdx !== -1 ? cellToText(row[replyDateColIdx]) : '',
      orderNumber: orderNoColIdx !== -1 ? cellToText(row[orderNoColIdx]) : '',
      orderDate: orderDateColIdx !== -1 ? cellToText(row[orderDateColIdx]) : '',
      submissionArn: submissionArnColIdx !== -1 ? cellToText(row[submissionArnColIdx]) : '',
      submissionDate: submissionDateColIdx !== -1 ? cellToText(row[submissionDateColIdx]) : '',
      extendedDueDate: extendedDueDateColIdx !== -1 ? cellToText(row[extendedDueDateColIdx]) : '',
      amountOfDemand: amountColIdx !== -1 ? cellToText(row[amountColIdx]) : '',
      remarks: remarksColIdx !== -1 ? cellToText(row[remarksColIdx]) : '',
      financialYear: financialYearColIdx !== -1 ? cellToText(row[financialYearColIdx]) : '',
      assignTo: assignToColIdx !== -1 ? cellToText(row[assignToColIdx]) : '',
    });
    setEditingIdx(idx);
  };

  const saveEdit = async () => {
    if (editingIdx === null) return;
    const rowId = rowIds?.[editingIdx];
    if (!rowId) { setEditingIdx(null); return; }
    const amount = editForm.amountOfDemand.trim() === '' ? null : Number(editForm.amountOfDemand);
    if (amount !== null && !Number.isFinite(amount)) { toast.error('Amount of Demand must be a number.'); return; }
    setSavingEdit(true);
    const { error } = await supabase.from('gst_notices').update({
      priority: editForm.priority || null,
      reply_ref_number: editForm.replyRefNumber || null,
      reply_date: editForm.replyDate || null,
      order_number: editForm.orderNumber || null,
      order_date: editForm.orderDate || null,
      submission_arn: editForm.submissionArn || null,
      submission_date: editForm.submissionDate || null,
      extended_due_date: editForm.extendedDueDate || null,
      amount_of_demand: amount,
      remarks: editForm.remarks || null,
      financial_year: editForm.financialYear || null,
      assign_to: editForm.assignTo || null,
    }).eq('id', rowId);
    setSavingEdit(false);
    if (error) { toast.error('Failed to save: ' + error.message); return; }

    const idx = editingIdx;
    setRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      const next = [...r];
      if (priorityColIdx !== -1) next[priorityColIdx] = editForm.priority || '—';
      if (replyRefColIdx !== -1) next[replyRefColIdx] = editForm.replyRefNumber || '—';
      if (replyDateColIdx !== -1) next[replyDateColIdx] = editForm.replyDate || '—';
      if (orderNoColIdx !== -1) next[orderNoColIdx] = editForm.orderNumber || '—';
      if (orderDateColIdx !== -1) next[orderDateColIdx] = editForm.orderDate || '—';
      if (submissionArnColIdx !== -1) next[submissionArnColIdx] = editForm.submissionArn || '—';
      if (submissionDateColIdx !== -1) next[submissionDateColIdx] = editForm.submissionDate || '—';
      if (extendedDueDateColIdx !== -1) next[extendedDueDateColIdx] = editForm.extendedDueDate || '—';
      if (amountColIdx !== -1) next[amountColIdx] = amount !== null ? amount : '—';
      if (remarksColIdx !== -1) next[remarksColIdx] = editForm.remarks || '—';
      if (financialYearColIdx !== -1) next[financialYearColIdx] = editForm.financialYear || '—';
      if (assignToColIdx !== -1) next[assignToColIdx] = editForm.assignTo || '—';
      return next;
    }));
    toast.success('Notice updated');
    setEditingIdx(null);
  };

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {table.title}
          </CardTitle>
          <CardDescription>{table.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-center text-muted-foreground">
            <Inbox className="h-7 w-7" />
            <p className="text-sm">No {report.title.toLowerCase()} records on file.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="gap-1.5">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {table.title}
        </CardTitle>
        <CardDescription>{table.subtitle}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary strip — readable at a glance before scrolling the table */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2.5">
          <span className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{dataRows.length}</span>{' '}
            event{dataRows.length === 1 ? '' : 's'}
          </span>
          {evidenceColIdx !== -1 && (
            <>
              <span className="text-muted-foreground/40">•</span>
              <span className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground tabular-nums">{withEvidenceCount}</span> with evidence PDF
                {withEvidenceCount < dataRows.length && (
                  <span className="ml-1 text-muted-foreground/80">
                    ({dataRows.length - withEvidenceCount} not captured)
                  </span>
                )}
              </span>
            </>
          )}
          {statusCounts.length > 0 && (
            <>
              <span className="text-muted-foreground/40">•</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {statusCounts.map(({ label, count }) => (
                  <Badge key={label} variant={STATUS_VARIANT(label)} className="text-[10px] py-0 font-medium">
                    {label} · {count}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Filters + bulk action */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reference no., description, date…"
              className="h-8 pl-8 text-sm"
            />
          </div>

          {typeColIdx !== -1 && typeOptions.length > 0 && (
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {typeOptions.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {statusColIdx !== -1 && statusOptions.length > 0 && (
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {priorityColIdx !== -1 && (
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue placeholder="Priority Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                {PRIORITY_TIERS.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">No date filter</SelectItem>
              <SelectItem value="last24h">Last 24 Hours</SelectItem>
              <SelectItem value="last15days">Last 15 Days</SelectItem>
              <SelectItem value="due7">Notice Due in 7 Days</SelectItem>
              <SelectItem value="overdue">Over Due Notices</SelectItem>
            </SelectContent>
          </Select>

          <span className="text-xs text-muted-foreground">
            {search || statusFilter !== 'all' || typeFilter !== 'all' || priorityFilter !== 'all' || dateFilter !== 'all' ? `${visibleRows.length} of ${dataRows.length}` : `${dataRows.length}`} shown
          </span>

          <div className="flex-1" />

          {downloadNotice && (
            <span className="text-xs text-muted-foreground animate-in fade-in">{downloadNotice}</span>
          )}

          {canEdit && selectedIdx.size > 0 && (
            <>
              <span className="text-xs text-muted-foreground">{selectedIdx.size} selected</span>
              <Button variant="outline" size="sm" className="h-8" onClick={() => setBulkStatusOpen(true)}>
                Update Status
              </Button>
              {priorityColIdx !== -1 && (
                <Button variant="outline" size="sm" className="h-8" onClick={() => setBulkPriorityOpen(true)}>
                  Priority
                </Button>
              )}
            </>
          )}

          {evidenceColIdx !== -1 && (
            <Button variant="outline" size="sm" onClick={handleDownloadAll} className="h-8">
              <DownloadCloud className="mr-1.5 h-3.5 w-3.5" />
              Download all visible PDFs
            </Button>
          )}

          <Button variant="outline" size="sm" className="h-8" onClick={() => renderReportToExcel(table)}>
            <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
            Export to Excel
          </Button>
        </div>

        {/* Table */}
        <div className="max-h-[65vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                {canEdit && (
                  <TableHead className="w-10 bg-muted/60 px-3 py-2">
                    <Checkbox
                      checked={visibleRows.length > 0 && visibleRows.every(({ idx }) => selectedIdx.has(idx))}
                      onCheckedChange={(checked) => toggleSelectAllVisible(checked === true)}
                      aria-label="Select all visible rows"
                    />
                  </TableHead>
                )}
                {headers.map((h, i) => (
                  <TableHead
                    key={i}
                    className={cn(
                      'whitespace-nowrap bg-muted/60 px-3 py-2 text-xs font-semibold',
                      (i === evidenceColIdx || i === priorityColIdx) && 'text-center',
                      h === 'Amount of Demand' && 'text-right',
                    )}
                  >
                    {h}
                  </TableHead>
                ))}
                {canEdit && (
                  <TableHead className="whitespace-nowrap bg-muted/60 px-3 py-2 text-center text-xs font-semibold">
                    Actions
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={headers.length + (canEdit ? 2 : 0)} className="py-10 text-center text-sm text-muted-foreground">
                    No rows match the current filters.
                  </TableCell>
                </TableRow>
              )}

              {visibleRows.map(({ row, idx }) => (
                <TableRow key={idx}>
                  {canEdit && (
                    <TableCell className="px-3 py-1.5">
                      <Checkbox checked={selectedIdx.has(idx)} onCheckedChange={() => toggleSelect(idx)} aria-label="Select row" />
                    </TableCell>
                  )}
                  {row.map((cell, ci) => {
                    // Evidence column: red vs. neutral PDF icon (see EvidenceEventListView).
                    if (ci === evidenceColIdx) {
                      return (
                        <TableCell key={ci} className="px-3 py-1.5 text-center">
                          {isUrl(cell) ? (
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7 border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
                              title="Open document"
                              asChild
                            >
                              <a href={cell as string} target="_blank" rel="noopener noreferrer">
                                <FileText className="h-3.5 w-3.5" />
                              </a>
                            </Button>
                          ) : (
                            <Button variant="outline" size="icon" className="h-7 w-7 cursor-not-allowed opacity-40" disabled title="Not captured">
                              <FileText className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      );
                    }

                    // Type column: colored pill.
                    if (ci === typeColIdx && String(cell ?? '').trim() && !isSentinel(cell)) {
                      return (
                        <TableCell key={ci} className="whitespace-nowrap px-3 py-1.5 text-xs">
                          <Badge variant={TYPE_VARIANT(String(cell))} className="py-0 text-[10px]">
                            {String(cell)}
                          </Badge>
                        </TableCell>
                      );
                    }

                    // Priority column: a flag, colored by tier (Low/Medium/High).
                    if (ci === priorityColIdx) {
                      const tier = String(cell ?? '').trim();
                      const flagCls = tier === 'High' ? 'fill-destructive text-destructive'
                        : tier === 'Medium' ? 'fill-warning text-warning'
                        : tier === 'Low' ? 'fill-info text-info'
                        : 'text-muted-foreground/30';
                      return (
                        <TableCell key={ci} className="px-3 py-1.5 text-center" title={tier || undefined}>
                          <Flag className={cn('mx-auto h-3.5 w-3.5', flagCls)} />
                        </TableCell>
                      );
                    }

                    // Status column: editable Select when permitted, badge otherwise.
                    if (ci === statusColIdx) {
                      const current = String(cell ?? '').trim();
                      if (canEdit && rowIds?.[idx]) {
                        return (
                          <TableCell key={ci} className="whitespace-nowrap px-3 py-1.5 text-xs">
                            <Select
                              value={STATUS_OPEN_CLOSED.includes(current) ? current : undefined}
                              onValueChange={(v) => handleStatusChange(idx, v)}
                              disabled={savingIdx === idx}
                            >
                              <SelectTrigger className="h-7 w-[110px] text-xs">
                                <SelectValue placeholder="Set status" />
                              </SelectTrigger>
                              <SelectContent>
                                {STATUS_OPEN_CLOSED.map((s) => (
                                  <SelectItem key={s} value={s}>{s}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        );
                      }
                      if (current && !isSentinel(current)) {
                        return (
                          <TableCell key={ci} className="whitespace-nowrap px-3 py-1.5 text-xs">
                            <Badge variant={STATUS_VARIANT(current)} className="py-0 text-[10px]">{current}</Badge>
                          </TableCell>
                        );
                      }
                    }

                    // Generic URL fallback.
                    if (isUrl(cell)) {
                      return (
                        <TableCell key={ci} className="whitespace-nowrap px-3 py-1.5 text-xs">
                          <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
                            <a href={cell as string} target="_blank" rel="noopener noreferrer">View</a>
                          </Button>
                        </TableCell>
                      );
                    }

                    // Sentinel ("NOT PULLED" / "not captured" / "not pulled").
                    if (isSentinel(cell)) {
                      return (
                        <TableCell key={ci} className="whitespace-nowrap px-3 py-1.5 text-xs">
                          <Badge variant="outline" className="border-dashed py-0 text-[10px] text-muted-foreground">
                            {String(cell)}
                          </Badge>
                        </TableCell>
                      );
                    }

                    return (
                      <TableCell
                        key={ci}
                        className={cn(
                          'px-3 py-1.5 text-xs',
                          headers[ci] === 'Description' && 'max-w-[280px]',
                          headers[ci] !== 'Description' && 'whitespace-nowrap',
                          headers[ci] === 'Amount of Demand' && 'text-right tabular-nums',
                        )}
                      >
                        {formatCell(cell)}
                      </TableCell>
                    );
                  })}
                  {canEdit && (
                    <TableCell className="px-3 py-1.5 text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Log reply / order / submission"
                        disabled={!rowIds?.[idx]}
                        onClick={() => openEditDialog(idx)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}

              {totalRows.map(({ row, idx }) => (
                <TableRow key={`total-${idx}`} className="bg-primary/5 font-semibold hover:bg-primary/10">
                  {canEdit && <TableCell />}
                  {row.map((cell, ci) => (
                    <TableCell key={ci} className="px-3 py-1.5 text-xs">
                      {formatCell(cell)}
                    </TableCell>
                  ))}
                  {canEdit && <TableCell />}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={bulkStatusOpen} onOpenChange={(open) => { setBulkStatusOpen(open); if (!open) setBulkStatus(''); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Update Status</DialogTitle>
            <DialogDescription>Applies to the {selectedIdx.size} selected record{selectedIdx.size === 1 ? '' : 's'}.</DialogDescription>
          </DialogHeader>
          <Select value={bulkStatus} onValueChange={setBulkStatus}>
            <SelectTrigger>
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPEN_CLOSED.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" disabled={bulkSaving} onClick={() => setBulkStatusOpen(false)}>Cancel</Button>
            <Button onClick={applyBulkStatus} disabled={bulkSaving || !bulkStatus}>
              {bulkSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {bulkSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkPriorityOpen} onOpenChange={(open) => { setBulkPriorityOpen(open); if (!open) setBulkPriority(''); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Priority Update</DialogTitle>
            <DialogDescription>Applies to the {selectedIdx.size} selected record{selectedIdx.size === 1 ? '' : 's'}.</DialogDescription>
          </DialogHeader>
          <Select value={bulkPriority} onValueChange={setBulkPriority}>
            <SelectTrigger>
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_TIERS.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" disabled={bulkSaving} onClick={() => setBulkPriorityOpen(false)}>Cancel</Button>
            <Button onClick={applyBulkPriority} disabled={bulkSaving || !bulkPriority}>
              {bulkSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {bulkSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editingIdx !== null} onOpenChange={(open) => { if (!open) setEditingIdx(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log reply / order / submission</DialogTitle>
            <DialogDescription>
              Track what's been done about this notice — the portal doesn't record any of this itself.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pt-2 pr-1">
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label htmlFor="notice-priority" className="text-sm font-normal">Priority</Label>
              <Select value={editForm.priority || 'none'} onValueChange={(v) => setEditForm((f) => ({ ...f, priority: v === 'none' ? '' : v }))}>
                <SelectTrigger id="notice-priority" className="h-8 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {PRIORITY_TIERS.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="reply-ref">Reply Ref No.</Label>
                <Input id="reply-ref" value={editForm.replyRefNumber} onChange={(e) => setEditForm((f) => ({ ...f, replyRefNumber: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reply-date">Reply Date</Label>
                <Input id="reply-date" type="date" value={editForm.replyDate} onChange={(e) => setEditForm((f) => ({ ...f, replyDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="order-no">Order No.</Label>
                <Input id="order-no" value={editForm.orderNumber} onChange={(e) => setEditForm((f) => ({ ...f, orderNumber: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="order-date">Order Date</Label>
                <Input id="order-date" type="date" value={editForm.orderDate} onChange={(e) => setEditForm((f) => ({ ...f, orderDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="submission-arn">Submission ARN</Label>
                <Input id="submission-arn" value={editForm.submissionArn} onChange={(e) => setEditForm((f) => ({ ...f, submissionArn: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="submission-date">Submission Date</Label>
                <Input id="submission-date" type="date" value={editForm.submissionDate} onChange={(e) => setEditForm((f) => ({ ...f, submissionDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="extended-due-date">Extended Due Date</Label>
                <Input id="extended-due-date" type="date" value={editForm.extendedDueDate} onChange={(e) => setEditForm((f) => ({ ...f, extendedDueDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="amount-of-demand">Amount of Demand</Label>
                <Input id="amount-of-demand" type="number" inputMode="decimal" value={editForm.amountOfDemand} onChange={(e) => setEditForm((f) => ({ ...f, amountOfDemand: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="financial-year">Financial Year</Label>
                <Input id="financial-year" placeholder="e.g. 2025-2026" value={editForm.financialYear} onChange={(e) => setEditForm((f) => ({ ...f, financialYear: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assign-to">Assign To</Label>
                <Input id="assign-to" placeholder="Staff member" value={editForm.assignTo} onChange={(e) => setEditForm((f) => ({ ...f, assignTo: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="remarks">Remarks</Label>
              <Input id="remarks" value={editForm.remarks} onChange={(e) => setEditForm((f) => ({ ...f, remarks: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={savingEdit} onClick={() => setEditingIdx(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={savingEdit}>
              {savingEdit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {savingEdit ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
