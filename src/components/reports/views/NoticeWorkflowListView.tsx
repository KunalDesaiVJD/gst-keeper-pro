// NoticeWorkflowListView — "View Notice and Orders" specifically. Same
// chronological event-list shape as EvidenceEventListView (PDF icon, Type
// badge), plus staff case-tracking that writes back to the underlying
// gst_notices row: an inline Open/Closed status Select, a Priority flag, and
// an Edit dialog logging the reply filed, order received, and application
// submitted for that notice — none of which the portal itself ever exposes
// for these rows.
//
// The list is worked from every angle through the table kit (./tableKit):
// every column filters from its header (ticked values with counts, a due-date
// range, an amount range), sorts and groups (status, type, priority, issued
// by, financial year, assignee), and the Excel / PDF are of exactly what is
// shown. The quick filters staff already know (Type / Status / Priority
// selects, the date presets, the status tiles) set the same kit filters, so
// each shows as a chip and narrows the counts and the exports too. Every row
// keeps its index into table.rows through any filter or sort (row.i), so an
// edit still writes back to the right notice by its row id.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { toast } from 'sonner';
import { logNoticeFieldChanges } from '@/lib/noticeEvents';
import { updateNotices } from '@/lib/noticeWrites';
import { Card, CardContent } from '@/components/ui/card';
import NoticesCardHeader from '@/components/notices/NoticesCardHeader';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile } from '@/components/gstr9/ui';
import { WS_BTN, WS_CONTROL } from '@/components/workspace/theme';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { FileText, DownloadCloud, Inbox, Pencil, Flag, Loader2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isoDateToDMY, dmyToISODate } from '@/utils/formatDate';
import {
  TableKitPager, TableKitTable, TableKitToolbar, isFilterActive, useTableKit,
  type KitCustomFilter, type KitExtraColumn, type ModelRow,
} from './tableKit';
import { openDoc } from '@/lib/docLinks';

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

// Rendering every row's Status cell as a live Radix <Select> (canEdit users)
// meant 1000+ simultaneously-mounted Select instances on a firm-wide list —
// confirmed live 2026-09-03 as a genuine main-thread freeze (Chrome's own
// "Page Unresponsive" dialog), not just sluggishness. Paginating so only one
// page's worth of rows actually mount is the fix — same convention already
// used on CompanyListPage. The kit pages from 50 lines here, not its usual 500.
const ROWS_PER_PAGE_OPTIONS = [50, 100, 250, 500];

// Matches Notice Alert's own "Filter" dropdown on this exact page (confirmed
// live 2026-08-25): date-range presets over Issue Date / Due Date, on top of
// the Status dropdown.
type DateFilter = 'all' | 'last24h' | 'last15days' | 'due7' | 'overdue';
const DAY_MS = 24 * 60 * 60 * 1000;
// As the chip and the export's filter strip print them (plain words: the PDF's font).
const DATE_PRESET_LABEL: Record<Exclude<DateFilter, 'all'>, string> = {
  last24h: 'Issued in the last 24 hours',
  last15days: 'Issued in the last 15 days',
  due7: 'Due in the next 7 days',
  overdue: 'Overdue',
};
// The kit's ids for the quick filters that are not one column's value.
const REPLIED_FILTER = 'replied';
const DATE_FILTER = 'when';
// A select showing a column filter the reader set from the header (several values ticked).
const SEVERAL = '__several';
// Worth grouping by; a reference number or a remark is one row per value.
const GROUP_HEADER_RE = /^(type|status|priority|issued by|financial year|assign to|case id)$/i;

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
  // DD/MM/YYYY (or DD-MM-YYYY) is checked BEFORE Date.parse — Date.parse
  // treats an ambiguous slash-separated string as MM/DD/YYYY (US order), so
  // a display date like "04/08/2026" (4 Aug) would silently parse as 8
  // April instead. Confirmed as a real risk 2026-09-03 when the notice/
  // refund/DRC-03 report builders switched from raw ISO cells to this
  // format — this reordering is what keeps date filters/sorting correct
  // afterward.
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  const direct = Date.parse(s);
  if (!Number.isNaN(direct)) return direct;
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
  /** profiles.user_id of the owner — what the work queue's Mine / Unassigned tabs and the "assigned to you" alert read */
  assignToUserId: string;
  closeReason: string;
}

const EMPTY_FORM: EditForm = {
  priority: '', replyRefNumber: '', replyDate: '', orderNumber: '', orderDate: '', submissionArn: '', submissionDate: '',
  extendedDueDate: '', amountOfDemand: '', remarks: '', financialYear: '', assignTo: '', assignToUserId: '', closeReason: '',
};

interface StaffOption { id: string; name: string }

const cellToText = (v: string | number | undefined): string => {
  const s = String(v ?? '').trim();
  return s === '—' ? '' : s;
};

export const NoticeWorkflowListView: React.FC<NoticeWorkflowListViewProps> = ({ table, report }) => {
  const { canEditNoticeStatus, user } = useAuth();
  const canEdit = canEditNoticeStatus();

  const [rows, setRows] = useState(table.rows);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  const [staff, setStaff] = useState<StaffOption[]>([]);

  // Staff the edit dialog can assign to (client logins have profile rows too).
  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    (async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from('profiles').select('user_id, first_name, email'),
        supabase.from('user_roles').select('user_id, role'),
      ]);
      const staffIds = new Set((roles ?? []).filter((r) => r.role !== 'client').map((r) => r.user_id));
      const list = (profiles ?? [])
        .filter((p) => staffIds.has(p.user_id))
        .map((p) => ({ id: p.user_id, name: (p.first_name ?? '').trim() || (p.email ?? '').split('@')[0] || 'Unnamed' }))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!cancelled) setStaff(list);
    })();
    return () => { cancelled = true; };
  }, [canEdit]);
  // Checkbox selection + bulk "Update Status" — matches Notice Alert's own
  // toolbar (confirmed live), on top of the existing per-row inline editor.
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set());
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<string>('');
  const [bulkCloseReason, setBulkCloseReason] = useState<string>('');
  const [bulkPriorityOpen, setBulkPriorityOpen] = useState(false);
  const [bulkPriority, setBulkPriority] = useState<string>('');
  const [bulkSaving, setBulkSaving] = useState(false);
  // Extension handshake for the per-row "Portal" icon (log in as that row's
  // client and land on Notices & Orders) — same ping/pong pattern used
  // elsewhere in the app.
  const [extReady, setExtReady] = useState(false);
  const [openingIdx, setOpeningIdx] = useState<number | null>(null);

  useEffect(() => { setRows(table.rows); }, [table]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __gstkExtensionReady?: boolean; __gstkOpenNoticeResult?: { ok?: boolean; error?: string } } | null;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) setExtReady(true);
      if (d.__gstkOpenNoticeResult) {
        setOpeningIdx(null);
        if (!d.__gstkOpenNoticeResult.ok) toast.error(d.__gstkOpenNoticeResult.error || 'Failed to open the portal.');
      }
    };
    window.addEventListener('message', onMsg);
    const ping = () => window.postMessage({ __gstkAppReady: true }, '*');
    ping();
    const t1 = setTimeout(ping, 400);
    const t2 = setTimeout(ping, 1200);
    return () => { window.removeEventListener('message', onMsg); clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const headers = table.headers;
  const rowIds = table.rowIds;
  const clientIds = table.clientIds;
  const referenceColIdx = useMemo(() => headers.findIndex((h) => /^reference no\.?$/i.test(h.trim())), [headers]);
  // Case-linked rows (Additional Notices, LUT, DRC-03 — anything with a
  // portal Case ID) get their Reference No. wired to the Additional Notice
  // Folder page, matching Notice Alert's own blue-link-only-for-case-id-rows
  // convention (confirmed live 2026-08-26) — a plain get/notices row with no
  // Case ID stays plain text, same as theirs.
  const caseIdColIdx = useMemo(() => headers.findIndex((h) => /^case id$/i.test(h.trim())), [headers]);

  const openInPortal = (idx: number) => {
    const clientId = clientIds?.[idx];
    if (!clientId) return;
    if (!extReady) { toast.error('GST Keeper browser extension not detected.'); return; }
    const referenceNumber = referenceColIdx !== -1 ? cellToText(rows[idx]?.[referenceColIdx]) : '';
    setOpeningIdx(idx);
    window.postMessage({ __gstkOpenNotice: { clientId, referenceNumber } }, '*');
  };
  // Firm-wide lists prepend a GSTIN column; rendered monospaced so the
  // 15-character ids line up down the page.
  const gstinColIdx = useMemo(() => headers.findIndex((h) => /^gstin$/i.test(h.trim())), [headers]);
  // Every "… Date" column (Issue/Due/Extended Due/Reply/Order/Submission)
  // gets tabular figures so the dates align column-wise.
  const dateCellCols = useMemo(
    () => new Set(headers.map((h, i) => (/date$/i.test(h.trim()) ? i : -1)).filter((i) => i !== -1)),
    [headers],
  );
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

  // The kit filters, sorts, groups and pages the rows as edited here (an edit
  // patches `rows`; the reader's filters stay). Every row carries its original
  // index (row.i, into `rows`/`rowIds`) through all of it, so an edit always
  // writes back to the right DB row regardless of what's currently visible or
  // how it's sorted.
  const liveTable = useMemo<ReportTable>(() => ({ ...table, rows }), [table, rows]);
  const kit = useTableKit(liveTable, {
    resetKey: report.title,
    // Newest first, as before; a header click now sorts by anything else.
    initialSort: dateColIdx !== -1 ? { col: dateColIdx, dir: 'desc' } : null,
    groupable: (c) => c.groupable && GROUP_HEADER_RE.test(c.header.trim()),
    pageThreshold: ROWS_PER_PAGE_OPTIONS[0],
    pageSizes: ROWS_PER_PAGE_OPTIONS,
    initialPageSize: ROWS_PER_PAGE_OPTIONS[0],
    statusColumn: statusColIdx === -1 ? null : statusColIdx,
    rowNoun: ['record', 'records'],
    // Nothing is added up. Amount of Demand is each notice's own figure: a
    // dispute's notice and its order both carry the demand, and closed notices
    // carry theirs, so a TOTAL or subtotal of the column would count a demand
    // twice and count settled ones. The firm's exposure is counted once per
    // dispute, open notices only, in notice_facts (positions §2).
    summable: [],
  });

  type Indexed = { row: (string | number)[]; idx: number };
  // The notices themselves (a TOTAL row, if a report ever has one, is the kit's to pin).
  const dataRows = useMemo<Indexed[]>(() => kit.model.data.map((r) => ({ row: r.cells, idx: r.i })), [kit.model]);
  // The rows shown, in the order shown; and the ones on this page (what "select all" ticks).
  const visibleRows = useMemo<Indexed[]>(() => kit.view.rows.map((r) => ({ row: r.cells, idx: r.i })), [kit.view]);
  const pagedRows = useMemo<Indexed[]>(
    () => kit.pageView.items.flatMap((it) => (it.type === 'data' ? [{ row: it.row.cells, idx: it.row.i }] : [])),
    [kit.pageView],
  );

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

  // ── The quick filters, as kit filters ─────────────────────────────────────
  // A select on one column's value is that column's filter (a chip, counted
  // and exported like a header filter); it reads back from the kit, so a
  // chip removed or "Clear all" resets it too.
  const { state: kitState } = kit;
  // What a select shows: its one value, or "several" for a header filter it cannot show.
  const selectValue = (col: number, options: string[]): string => {
    if (col === -1) return 'all';
    const f = kitState.filters[col];
    if (!isFilterActive(f)) return 'all';
    return f?.type === 'values' && f.values.length === 1 && options.includes(f.values[0]) ? f.values[0] : SEVERAL;
  };
  const setColumnValue = (col: number, v: string) => {
    if (col === -1 || v === SEVERAL) return;
    kit.setFilter(col, v === 'all' ? undefined : { type: 'values', values: [v] });
  };
  const hasReplyDate = (row: (string | number)[]) => replyDateColIdx !== -1 && !isSentinel(row[replyDateColIdx]) && !!cellToText(row[replyDateColIdx]);
  // "Replied" isn't a staff_status value (reply_date is a separate field), so
  // it is a filter of its own, matched against the reply date being set.
  const repliedOn = !!kitState.custom?.some((c) => c.id === REPLIED_FILTER);
  const statusValue = repliedOn ? 'Replied' : selectValue(statusColIdx, statusOptions);
  const setStatusValue = (v: string) => {
    if (v === SEVERAL) return;
    if (v === 'Replied') {
      kit.setFilter(statusColIdx, undefined);
      kit.setCustomFilter(REPLIED_FILTER, { label: 'Replied (reply date logged)', test: (r) => hasReplyDate(r.cells) });
      return;
    }
    kit.setCustomFilter(REPLIED_FILTER, null);
    setColumnValue(statusColIdx, v);
  };

  // The date presets. Due in 7 / Overdue read the report's own flags when it
  // carries them (the dashboard's definition), else the Due Date cell.
  const presetTest = (preset: Exclude<DateFilter, 'all'>): KitCustomFilter['test'] => (r, t) => {
    const now = Date.now();
    if (preset === 'last24h' || preset === 'last15days') {
      if (dateColIdx === -1) return true;
      const d = parseDateLoose(r.cells[dateColIdx]);
      return !Number.isNaN(d) && now - d <= (preset === 'last24h' ? DAY_MS : 15 * DAY_MS);
    }
    if (t.rowFlags) return preset === 'due7' ? !!t.rowFlags[r.i]?.dueIn7 : !!t.rowFlags[r.i]?.overdue;
    if (dueDateColIdx === -1) return true;
    const d = parseDateLoose(r.cells[dueDateColIdx]);
    if (Number.isNaN(d)) return false;
    return preset === 'due7' ? d - now >= 0 && d - now <= 7 * DAY_MS : d - now < 0;
  };
  const dateFilter: DateFilter = (Object.keys(DATE_PRESET_LABEL) as Exclude<DateFilter, 'all'>[])
    .find((k) => kitState.custom?.some((c) => c.id === DATE_FILTER && c.label === DATE_PRESET_LABEL[k])) ?? 'all';
  const setDateFilter = (v: DateFilter) => {
    kit.setCustomFilter(DATE_FILTER, v === 'all' ? null : { label: DATE_PRESET_LABEL[v], test: presetTest(v) });
  };

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
      setTimeout(() => openDoc(url), i * 150);
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
    const clientId = clientIds?.[idx];
    if (!rowId || statusColIdx === -1) return;
    const oldStatus = cellToText(rows[idx]?.[statusColIdx]);
    setSavingIdx(idx);
    const { error, legacy } = await updateNotices([rowId], { staff_status: newStatus }, user);
    setSavingIdx(null);
    if (error) { toast.error('Failed to update status: ' + error.message); return; }
    patchRow(idx, statusColIdx, newStatus);
    toast.success('Status updated');
    // The database logs the change (and any alert) itself; only a database
    // without the Phase 1 triggers needs the browser to do it.
    if (legacy && clientId && oldStatus !== newStatus) {
      void logNoticeFieldChanges(rowId, clientId, { staff_status: oldStatus }, { staff_status: newStatus },
        user?.id ?? null, user?.firstName ?? null).catch(() => {});
    }
  };

  const toggleSelect = (idx: number) => {
    setSelectedIdx((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  // Scoped to the CURRENT PAGE, not every filtered row — selections on other
  // pages are left alone (added/removed via the same Set) rather than wiped,
  // so a bulk action can still be built up across multiple pages if needed.
  const toggleSelectAllOnPage = (checked: boolean) => {
    setSelectedIdx((prev) => {
      const next = new Set(prev);
      pagedRows.forEach(({ idx }) => { if (checked) next.add(idx); else next.delete(idx); });
      return next;
    });
  };

  const applyBulkStatus = async () => {
    if (!bulkStatus || statusColIdx === -1 || selectedIdx.size === 0) return;
    const ids = Array.from(selectedIdx).map((idx) => rowIds?.[idx]).filter((id): id is string => !!id);
    if (ids.length === 0) { setBulkStatusOpen(false); return; }
    setBulkSaving(true);
    const payload: TablesUpdate<'gst_notices'> = { staff_status: bulkStatus };
    if (bulkStatus === 'Closed') payload.close_reason = bulkCloseReason || null;
    else payload.close_reason = null;
    const { error } = await updateNotices(ids, payload, user);
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
    setBulkCloseReason('');
    setSelectedIdx(new Set());
  };

  const applyBulkPriority = async () => {
    if (!bulkPriority || priorityColIdx === -1 || selectedIdx.size === 0) return;
    const ids = Array.from(selectedIdx).map((idx) => rowIds?.[idx]).filter((id): id is string => !!id);
    if (ids.length === 0) { setBulkPriorityOpen(false); return; }
    setBulkSaving(true);
    const { error } = await updateNotices(ids, { priority: bulkPriority }, user);
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
      replyDate: replyDateColIdx !== -1 ? dmyToISODate(cellToText(row[replyDateColIdx])) : '',
      orderNumber: orderNoColIdx !== -1 ? cellToText(row[orderNoColIdx]) : '',
      orderDate: orderDateColIdx !== -1 ? dmyToISODate(cellToText(row[orderDateColIdx])) : '',
      submissionArn: submissionArnColIdx !== -1 ? cellToText(row[submissionArnColIdx]) : '',
      submissionDate: submissionDateColIdx !== -1 ? dmyToISODate(cellToText(row[submissionDateColIdx])) : '',
      extendedDueDate: extendedDueDateColIdx !== -1 ? dmyToISODate(cellToText(row[extendedDueDateColIdx])) : '',
      amountOfDemand: amountColIdx !== -1 ? cellToText(row[amountColIdx]) : '',
      remarks: remarksColIdx !== -1 ? cellToText(row[remarksColIdx]) : '',
      financialYear: financialYearColIdx !== -1 ? cellToText(row[financialYearColIdx]) : '',
      assignTo: assignToColIdx !== -1 ? cellToText(row[assignToColIdx]) : '',
      assignToUserId: '',
      closeReason: '',
    });
    setEditingIdx(idx);
    // The owner id and close reason are not columns of this list: load them, so
    // saving the dialog for any other reason no longer wipes them.
    const rowId = rowIds?.[idx];
    if (rowId) {
      void supabase.from('gst_notices').select('assign_to, assign_to_user_id, close_reason').eq('id', rowId).maybeSingle()
        .then(({ data }) => {
          if (data) setEditForm((f) => ({ ...f, assignTo: data.assign_to ?? f.assignTo, assignToUserId: data.assign_to_user_id ?? '', closeReason: data.close_reason ?? '' }));
        });
    }
  };

  const saveEdit = async () => {
    if (editingIdx === null) return;
    const rowId = rowIds?.[editingIdx];
    const clientId = clientIds?.[editingIdx];
    if (!rowId) { setEditingIdx(null); return; }
    const amount = editForm.amountOfDemand.trim() === '' ? null : Number(editForm.amountOfDemand);
    if (amount !== null && !Number.isFinite(amount)) { toast.error('Amount of Demand must be a number.'); return; }
    setSavingEdit(true);

    // Snapshot old values, for event logging on a database without the Phase 1 triggers.
    const { data: oldRow } = await supabase.from('gst_notices')
      .select('staff_status, assign_to, assign_to_user_id, reply_date, reply_ref_number, order_date, order_number, close_reason')
      .eq('id', rowId).maybeSingle();

    const { error, legacy } = await updateNotices([rowId], {
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
      assign_to_user_id: editForm.assignToUserId || null,
      close_reason: editForm.closeReason || null,
    }, user);
    setSavingEdit(false);
    if (error) { toast.error('Failed to save: ' + error.message); return; }

    if (legacy && oldRow && clientId) {
      const newFields = {
        staff_status: oldRow.staff_status,
        assign_to: editForm.assignTo || null,
        assign_to_user_id: editForm.assignToUserId || null,
        reply_date: editForm.replyDate || null,
        reply_ref_number: editForm.replyRefNumber || null,
        order_date: editForm.orderDate || null,
        order_number: editForm.orderNumber || null,
        close_reason: editForm.closeReason || null,
      };
      void logNoticeFieldChanges(rowId, clientId, oldRow, newFields, user?.id ?? null, user?.firstName ?? null)
        .catch(() => {});
    }

    const idx = editingIdx;
    setRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      const next = [...r];
      if (priorityColIdx !== -1) next[priorityColIdx] = editForm.priority || '—';
      if (replyRefColIdx !== -1) next[replyRefColIdx] = editForm.replyRefNumber || '—';
      if (replyDateColIdx !== -1) next[replyDateColIdx] = isoDateToDMY(editForm.replyDate);
      if (orderNoColIdx !== -1) next[orderNoColIdx] = editForm.orderNumber || '—';
      if (orderDateColIdx !== -1) next[orderDateColIdx] = isoDateToDMY(editForm.orderDate);
      if (submissionArnColIdx !== -1) next[submissionArnColIdx] = editForm.submissionArn || '—';
      if (submissionDateColIdx !== -1) next[submissionDateColIdx] = isoDateToDMY(editForm.submissionDate);
      if (extendedDueDateColIdx !== -1) next[extendedDueDateColIdx] = isoDateToDMY(editForm.extendedDueDate);
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
        <NoticesCardHeader title={table.title} description={table.subtitle} />
        <CardContent className="pt-3 pb-3 space-y-3">
          <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center text-muted-foreground">
            <Inbox className="h-5 w-5 opacity-60" />
            <p className="text-sm">No {report.title.toLowerCase()} records on file.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── The table: the kit's, with this view's own cells, tick boxes and actions ──
  // Return undefined for the kit's standard cell (figures and dates in the house style).
  const renderCell = (r: ModelRow, ci: number): React.ReactNode | undefined => {
    const cell = r.cells[ci];
    const idx = r.i;
    // Evidence column: red vs. neutral PDF icon (see EvidenceEventListView).
    if (ci === evidenceColIdx) {
      return isUrl(cell) ? (
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
          title="Open document"
          asChild
        >
          <a href={cell} target="_blank" rel="noopener noreferrer">
            <FileText className="h-3.5 w-3.5" />
          </a>
        </Button>
      ) : (
        <Button variant="outline" size="icon" className="h-7 w-7 cursor-not-allowed opacity-40" disabled title="Not captured">
          <FileText className="h-3.5 w-3.5" />
        </Button>
      );
    }

    // Type column: colored pill.
    if (ci === typeColIdx && String(cell ?? '').trim() && !isSentinel(cell)) {
      return <Badge variant={TYPE_VARIANT(String(cell))} className="py-0 text-[10px] font-medium">{String(cell)}</Badge>;
    }

    // Priority column: a flag, colored by tier (Low/Medium/High).
    if (ci === priorityColIdx) {
      const tier = String(cell ?? '').trim();
      const flagCls = tier === 'High' ? 'fill-destructive text-destructive'
        : tier === 'Medium' ? 'fill-warning text-warning'
        : tier === 'Low' ? 'fill-info text-info'
        : 'text-muted-foreground/30';
      return (
        <span className="inline-flex px-1" title={tier && tier !== '—' ? tier : 'No priority'}>
          <Flag className={cn('h-3.5 w-3.5', flagCls)} />
        </span>
      );
    }

    // Status column: editable Select when permitted, badge otherwise.
    if (ci === statusColIdx) {
      const current = String(cell ?? '').trim();
      if (canEdit && rowIds?.[idx]) {
        return (
          <Select
            value={STATUS_OPEN_CLOSED.includes(current) ? current : undefined}
            onValueChange={(v) => handleStatusChange(idx, v)}
            disabled={savingIdx === idx}
          >
            <SelectTrigger className="h-7 w-[110px] text-xs" aria-label="Status">
              <SelectValue placeholder="Set status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPEN_CLOSED.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      if (current && !isSentinel(current)) {
        return <Badge variant={STATUS_VARIANT(current)} className="py-0 text-[10px] font-medium">{current}</Badge>;
      }
    }

    // Reference No. column: links to the Additional Notice Folder page when
    // this row has a Case ID and we know which client it belongs to — plain
    // text otherwise.
    if (ci === referenceColIdx && String(cell ?? '').trim() && !isSentinel(cell)) {
      const caseId = caseIdColIdx !== -1 ? cellToText(r.cells[caseIdColIdx]) : '';
      const linkClientId = clientIds?.[idx];
      if (caseId && linkClientId) {
        return (
          <Link to={`/notices-case-folder/${linkClientId}/${encodeURIComponent(caseId)}`} className="text-primary hover:underline">
            {String(cell)}
          </Link>
        );
      }
    }

    // GSTIN column: monospaced, muted — an identifier, not content.
    if (ci === gstinColIdx && String(cell ?? '').trim() && !isSentinel(cell)) {
      return <span className="font-mono text-[10px] text-muted-foreground">{formatCell(cell)}</span>;
    }

    // Generic URL fallback.
    if (isUrl(cell)) {
      return (
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
          <a href={cell} target="_blank" rel="noopener noreferrer">View</a>
        </Button>
      );
    }

    // Sentinel ("NOT PULLED" / "not captured" / "not pulled").
    if (isSentinel(cell)) {
      return <Badge variant="outline" className="border-dashed py-0 text-[10px] text-muted-foreground">{String(cell)}</Badge>;
    }
    return undefined;
  };

  const leading: KitExtraColumn[] = canEdit ? [{
    key: 'pick',
    className: 'w-10',
    header: (
      <Checkbox
        checked={pagedRows.length > 0 && pagedRows.every(({ idx }) => selectedIdx.has(idx))}
        onCheckedChange={(checked) => toggleSelectAllOnPage(checked === true)}
        aria-label="Select all rows on this page"
      />
    ),
    cell: (r) => <Checkbox checked={selectedIdx.has(r.i)} onCheckedChange={() => toggleSelect(r.i)} aria-label="Select row" />,
  }] : [];

  const trailing: KitExtraColumn[] = canEdit ? [{
    key: 'actions',
    header: 'Actions',
    className: 'text-center',
    cell: (r) => (
      <div className="flex items-center justify-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Log reply / order / submission"
          disabled={!rowIds?.[r.i]}
          onClick={() => openEditDialog(r.i)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        {clientIds && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Open this client on the GST portal, logged in"
            disabled={!clientIds[r.i] || openingIdx === r.i}
            onClick={() => openInPortal(r.i)}
          >
            {openingIdx === r.i ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>
    ),
  }] : [];

  return (
    // The card fills the preview so the list takes the room left and its pager stays in sight.
    <Card className="flex h-full min-h-0 flex-col">
      <NoticesCardHeader title={table.title} description={table.subtitle} />

      <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5 pt-3 pb-3">
        {/* Summary strip — readable at a glance before scrolling the table */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {statusColIdx !== -1 && statusCounts.length > 0 ? (
            <TileButton active={statusValue === 'all'} onClick={() => setStatusValue('all')} title="Show all statuses">
              <KpiTile label={dataRows.length === 1 ? 'Event' : 'Events'} value={dataRows.length} hint={kit.view.filtered ? `${visibleRows.length} shown` : undefined} />
            </TileButton>
          ) : (
            <KpiTile label={dataRows.length === 1 ? 'Event' : 'Events'} value={dataRows.length} hint={kit.view.filtered ? `${visibleRows.length} shown` : undefined} />
          )}
          {evidenceColIdx !== -1 && (
            <KpiTile
              label="With evidence PDF"
              value={withEvidenceCount}
              hint={withEvidenceCount < dataRows.length ? `${dataRows.length - withEvidenceCount} not captured` : undefined}
              tone={withEvidenceCount < dataRows.length ? 'warn' : 'ok'}
            />
          )}
          {statusCounts.map(({ label, count }) => {
            const variant = STATUS_VARIANT(label);
            return (
              <TileButton
                key={label}
                active={statusValue === label}
                onClick={() => setStatusValue(statusValue === label ? 'all' : label)}
                title={`Show ${label} only`}
              >
                <KpiTile
                  label={label}
                  value={count}
                  tone={variant === 'success' ? 'ok' : variant === 'warning' ? 'warn' : 'neutral'}
                />
              </TileButton>
            );
          })}
        </div>

        {/* The quick filters staff know (each sets a kit filter, shown as a
            chip below) and the bulk actions. The bulk buttons are always
            visible — matching Notice Alert's own toolbar — rather than only
            appearing once a row is checked. Confirmed live 2026-09-03: staff
            hadn't discovered these existed because they'd never happened to
            check a row first. Disabled (with a hint) until at least one row
            is selected. */}
        <div className="flex flex-wrap items-center gap-2">
          {typeColIdx !== -1 && typeOptions.length > 0 && (
            <Select value={selectValue(typeColIdx, typeOptions)} onValueChange={(v) => setColumnValue(typeColIdx, v)}>
              <SelectTrigger className={cn(WS_CONTROL, 'w-[150px]')} aria-label="Type">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {typeOptions.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
                <SelectItem value={SEVERAL} className="hidden">Several types</SelectItem>
              </SelectContent>
            </Select>
          )}

          {statusColIdx !== -1 && statusOptions.length > 0 && (
            <Select value={statusValue} onValueChange={setStatusValue}>
              <SelectTrigger className={cn(WS_CONTROL, 'w-[130px]')} aria-label="Status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
                <SelectItem value={SEVERAL} className="hidden">Several statuses</SelectItem>
              </SelectContent>
            </Select>
          )}

          {priorityColIdx !== -1 && (
            <Select value={selectValue(priorityColIdx, PRIORITY_TIERS)} onValueChange={(v) => setColumnValue(priorityColIdx, v)}>
              <SelectTrigger className={cn(WS_CONTROL, 'w-[130px]')} aria-label="Priority">
                <SelectValue placeholder="Priority Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                {PRIORITY_TIERS.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
                <SelectItem value={SEVERAL} className="hidden">Several priorities</SelectItem>
              </SelectContent>
            </Select>
          )}

          <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
            <SelectTrigger className={cn(WS_CONTROL, 'w-[170px]')} aria-label="Date filter">
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

          {canEdit && (
            <>
              <div className="mx-1 h-5 w-px bg-border" aria-hidden />
              <Button
                variant="outline" size="sm" className={WS_BTN}
                disabled={selectedIdx.size === 0}
                title={selectedIdx.size === 0 ? 'Select one or more rows first' : undefined}
                onClick={() => setBulkStatusOpen(true)}
              >
                Update Status
              </Button>
              {priorityColIdx !== -1 && (
                <Button
                  variant="outline" size="sm" className={WS_BTN}
                  disabled={selectedIdx.size === 0}
                  title={selectedIdx.size === 0 ? 'Select one or more rows first' : undefined}
                  onClick={() => setBulkPriorityOpen(true)}
                >
                  Update Priority
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                {selectedIdx.size > 0 ? `${selectedIdx.size} selected` : 'Tick rows to update them together'}
              </span>
            </>
          )}

          <div className="flex-1" />

          {downloadNotice && (
            <span className="text-xs text-muted-foreground animate-in fade-in">{downloadNotice}</span>
          )}

          {evidenceColIdx !== -1 && (
            <Button variant="outline" size="sm" onClick={handleDownloadAll} className={WS_BTN} title="Opens the PDF of every row the filters leave, on every page">
              <DownloadCloud className="h-3.5 w-3.5" />
              Download all visible PDFs
            </Button>
          )}
        </div>

        {/* Search, Group by, Columns and the filtered Excel / PDF; the chips under them */}
        <TableKitToolbar kit={kit} searchPlaceholder="Search reference no., description, date…" />

        <TableKitTable
          kit={kit}
          renderCell={renderCell}
          cellClassName={(_r, c) => (dateCellCols.has(c) ? 'tabular-nums' : undefined)}
          leading={leading}
          trailing={trailing}
          noMatchText="No rows match the current filters."
          label="Notices and orders"
        />
        <TableKitPager kit={kit} />
      </CardContent>

      <Dialog open={bulkStatusOpen} onOpenChange={(open) => { setBulkStatusOpen(open); if (!open) { setBulkStatus(''); setBulkCloseReason(''); } }}>
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
          {bulkStatus === 'Closed' && (
            <Input
              placeholder="Close reason (optional)"
              value={bulkCloseReason}
              onChange={(e) => setBulkCloseReason(e.target.value)}
              className="text-xs"
            />
          )}
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
                <Select
                  value={editForm.assignToUserId || 'none'}
                  onValueChange={(v) => setEditForm((f) => (v === 'none'
                    ? { ...f, assignToUserId: '', assignTo: '' }
                    : { ...f, assignToUserId: v, assignTo: staff.find((m) => m.id === v)?.name ?? f.assignTo }))}
                >
                  <SelectTrigger id="assign-to"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {staff.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {!editForm.assignToUserId && editForm.assignTo && (
                  <p className="text-xs text-muted-foreground">Typed earlier as “{editForm.assignTo}” — pick the staff member so it shows in their queue.</p>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="close-reason">Close Reason</Label>
              <Input id="close-reason" placeholder="e.g. auto:closure, resolved, withdrawn" value={editForm.closeReason} onChange={(e) => setEditForm((f) => ({ ...f, closeReason: e.target.value }))} />
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

const TileButton: React.FC<{ active: boolean; onClick: () => void; title: string; children: React.ReactNode }> = ({ active, onClick, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-pressed={active}
    className={cn(
      'rounded-lg text-left transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:h-full',
      active && 'ring-2 ring-primary/60',
    )}
  >
    {children}
  </button>
);
