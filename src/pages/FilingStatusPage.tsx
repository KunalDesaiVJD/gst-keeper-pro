import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, Note } from '@/components/gstr9/ui';
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from '@/components/gstr9/reco/StepTabs';
import { WS_BTN, WS_CONTROL, WS_FILTER_LABEL, WS_PAGE } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Download, ClipboardCheck, Search, X, Loader2 } from 'lucide-react';
import { FilingStatusType, ReturnType, PENDING_FILING_STATUSES } from '@/types';
import { exportFilingStatusToPDF } from '@/utils/pdfExport';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { SchemeHistoryEntry } from '@/utils/schemeResolver';
import { generateFilingRecords } from '@/lib/filingRecords';
import { MultiSelectPopover } from '@/components/ui/multi-select-popover';
import RequestDirectFilingDialog, { DirectFilingTarget } from '@/components/filing/RequestDirectFilingDialog';
import DirectFilingApprovalsPanel from '@/components/filing/DirectFilingApprovalsPanel';
import FilingTable, { type FilingRecord, type FilingRowContext } from '@/components/filing/FilingTable';
import ManualAttachDialog, { type ManualAttachTarget } from '@/components/filing/ManualAttachDialog';
import ReasonDialog, { type ReasonDialogSpec } from '@/components/filing/ReasonDialog';
import FilingExceptionsPanel from '@/components/filing/FilingExceptionsPanel';
import { MIN_EXTENSION_VERSION, compareVersions } from '@/lib/extensionVersion';
import {
  type FilingLogRow,
  PULL_ASK_EVERY_MS,
  PULL_SILENCE_MS,
  PullWatch,
  fetchFilingLog,
  fetchOpenConflicts,
  filingFamily,
  filingSourceText,
  hasPortalPull,
  isPullOnly,
  bulkPullNothingText,
  latestOutcomes,
  noPullTabText,
  outcomeWords,
  pullKey,
  unfileReturn,
  unlockFiled,
  wantedInBulkPull,
  wantedInClientPull,
} from '@/lib/filingPull';
import {
  type ManualSourceAllowance,
  allowManualSource,
  fetchAllowances,
  filingScope,
  liveAllowance,
} from '@/lib/manualSourceAllowances';
import {
  DirectFilingApproval,
  DirectFilingState,
  approvalKey,
  directFilingActionLabel,
  directFilingState,
  fetchDirectFilingApprovals,
  fetchUserNames,
  groupApprovals,
  isDirectFilingBlocked,
  pickApproval,
} from '@/lib/directFilingApprovals';

// Normalize an accountant name by stripping the trailing "/<number>" reference
// (e.g. "PUNITBHAI/16" / "PAVANBHAI /66" / "PRIYA,MUKESHBHAI/ 28") so the same
// person isn't counted as multiple accountants in the filter.
const normalizeAccountant = (raw: string | null | undefined): string => {
  if (!raw || raw === '-') return 'Unassigned';
  const stripped = raw.replace(/\s*\/\s*\d+\s*$/, '').trim();
  return stripped || 'Unassigned';
};

// MM/YYYY -> "Jul-26", matching gstr1_data.period_month (same conversion as
// fetchGstr3b.ts / Gstr3bPage.tsx).
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toShortMonth = (mmYyyy: string): string => {
  const [mm, yyyy] = (mmYyyy || '').split('/');
  return mm && yyyy ? `${MONTH_SHORT[Number(mm) - 1]}-${String(yyyy).slice(-2)}` : '';
};

// Due date constants for each return type
const RETURN_DUE_DATES: Record<string, number> = {
  'GSTR-1': 11,
  'GSTR-7': 10,
  'GSTR-6': 13,
  'GSTR-1 (IFF)': 13,
  'GSTR-3B': 20,
  'GSTR-3B (Q)': 22,
  'ITC-04': 25,
  'CMP-08': 18,
};

// The return-type tabs, in display order.
const FILING_TABS: { value: string; type: ReturnType }[] = [
  { value: 'gstr1', type: 'GSTR-1' },
  { value: 'gstr3b', type: 'GSTR-3B' },
  { value: 'itc04', type: 'ITC-04' },
  { value: 'gstr6', type: 'GSTR-6' },
  { value: 'gstr7', type: 'GSTR-7' },
  { value: 'cmp08', type: 'CMP-08' },
];

const MISMATCH_STATUSES: readonly FilingStatusType[] = ['Mismatch in Data'];
const DATA_PENDING_STATUSES: readonly FilingStatusType[] = ['Data Pending'];
const FILED_STATUSES: readonly FilingStatusType[] = ['Filed'];

interface Client {
  id: string;
  name: string;
  gstin: string;
  mobile: string | null;
  email: string | null;
  assigned_accountant: string | null;
  registration_type: string;
  regular_sub_type?: string | null;
  builder_itc_type?: string | null;
  selected_returns: string[] | null;
  registration_date: string;
  cancellation_date?: string | null;
  registration_cancellation_date?: string | null;
  inactive_at_hand?: boolean | null;
  target_date_group1: number | null;
  target_date_group2: number | null;
}

/** One return the extension is asked to pull. */
interface PullItem { clientId: string; return_type: string; period_month: string }

const FilingStatusPage: React.FC = () => {
  const { canUnlockSheets, isStaffRole, user, canEditFilingStatus, canExportData } = useAuth();
  const { selectedMonth: contextMonth, setSelectedMonth: setContextMonth } = useMonth();
  const [searchParams] = useSearchParams();
  const [selectedMonth, setSelectedMonth] = useState<string>(contextMonth);
  const [selectedTab, setSelectedTab] = useState<string>('gstr1');
  const [clients, setClients] = useState<Client[]>([]);
  const [filingRecords, setFilingRecords] = useState<FilingRecord[]>([]);
  const [targetDateLookup, setTargetDateLookup] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [lateFilingsFilter, setLateFilingsFilter] = useState<boolean>(false);
  const [schemeHistoryMap, setSchemeHistoryMap] = useState<Record<string, SchemeHistoryEntry[]>>({});
  // Which clients have a gstr1_data row for the selected period — used to flag
  // "GSTR-1 marked Filed but no data imported into GST Keeper" on the GSTR-1
  // tab (that gap silently drafts a ₹0 GSTR-3B with no explanation).
  const [gstr1DataClientIds, setGstr1DataClientIds] = useState<Set<string>>(new Set());
  
  // Filter states
  const [clientNameFilter, setClientNameFilter] = useState<string>('');
  const [selectedTargetDates, setSelectedTargetDates] = useState<number[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<FilingStatusType[]>([]);
  const [selectedAccountants, setSelectedAccountants] = useState<string[]>([]);
  const [selectedFrequencies, setSelectedFrequencies] = useState<string[]>([]);
  const [selectedRemarks, setSelectedRemarks] = useState<string[]>([]); // '__BLANK__' = no remark
  
  // Sync with MonthContext when page loads
  useEffect(() => {
    // Get filter parameter from URL
    const filterParam = searchParams.get('filter');
    if (filterParam === 'late') {
      setLateFilingsFilter(true);
    } else if (filterParam === 'pending') {
      setSelectedStatuses([...PENDING_FILING_STATUSES]);
    } else if (filterParam === 'filed') {
      setSelectedStatuses(['Filed']);
    } else if (filterParam === 'target_due_today') {
      const targetDateParam = searchParams.get('targetDate');
      const includeOverdue = searchParams.get('includeOverdue') === 'true';
      if (targetDateParam && includeOverdue) {
        // Select all target dates from 1 to today's date
        const todayDate = parseInt(targetDateParam);
        const dates = Array.from({ length: todayDate }, (_, i) => i + 1);
        setSelectedTargetDates(dates);
      } else if (targetDateParam) {
        setSelectedTargetDates([parseInt(targetDateParam)]);
      }
      // Show all non-filed statuses
      setSelectedStatuses([...PENDING_FILING_STATUSES]);
    }
    
    // Initialize month from context
    setSelectedMonth(contextMonth);
  }, [contextMonth, searchParams]);
  
  // Update context when local month changes
  useEffect(() => {
    if (selectedMonth !== contextMonth) {
      setContextMonth(selectedMonth);
    }
  }, [selectedMonth, contextMonth, setContextMonth]);
  const allReturnTypes: ReturnType[] = ['GSTR-1', 'GSTR-3B', 'ITC-04', 'GSTR-6', 'GSTR-7', 'CMP-08', 'GSTR-1 (IFF)', 'GSTR-3B (Q)'];

  // In-flight guard — the same (client, period) carry-forward must never run
  // twice concurrently (e.g. a double-click, or a manual retry landing while
  // the automatic one from filing is still running); a second run's delete
  // could wipe what the first just inserted before re-inserting its own copy.
  const carryForwardInFlight = useRef<Set<string>>(new Set());
  // Record id currently retrying a carry-forward, for the button's spinner.
  const [retryingCarryForwardId, setRetryingCarryForwardId] = useState<string | null>(null);

  // Carry forward function - transfers all 2B records to next month.
  // Returns a result instead of swallowing failures: the original version
  // never checked the insert() calls' errors at all and its catch swallowed
  // everything silently ("don't fail the filing just because carry forward
  // failed") — so when a delete/insert failed (most likely the tab
  // navigating away mid-flight, right after the "Filed" click), staff saw a
  // normal success and had no way to know the next period's carry-forward
  // never happened. See docs/2B_RECONCILIATION_FLOW.md and the migration
  // 20260814180000_backfill_missing_carry_forward.sql for the incident this
  // caused across ~21 clients.
  const carryForwardToNextMonth = async (
    clientId: string,
    periodMonth: string,
  ): Promise<{ success: boolean; totalCarried: number; error?: string }> => {
    const lockKey = `${clientId}:${periodMonth}`;
    if (carryForwardInFlight.current.has(lockKey)) {
      return { success: false, totalCarried: 0, error: 'A carry-forward for this client/period is already running.' };
    }
    carryForwardInFlight.current.add(lockKey);

    // Calculate next month
    const [month, year] = periodMonth.split('/');
    let nextMonth = parseInt(month) + 1;
    let nextYear = parseInt(year);
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear++;
    }
    const nextPeriod = `${String(nextMonth).padStart(2, '0')}/${nextYear}`;

    try {
      // Fetch current bills not in 2B
      const { data: billsNotIn2B, error: fetch2BError } = await supabase
        .from('bills_not_in_2b')
        .select('*')
        .eq('client_id', clientId)
        .eq('period_month', periodMonth);

      if (fetch2BError) throw fetch2BError;

      // Fetch current bills not in books
      const { data: billsNotInBooks, error: fetchBooksError } = await supabase
        .from('bills_not_in_books')
        .select('*')
        .eq('client_id', clientId)
        .eq('period_month', periodMonth);

      if (fetchBooksError) throw fetchBooksError;

      let totalCarried = 0;

      // CARRY FORWARD BILLS NOT IN 2B
      // Carry forward ALL records regardless of reclaim_month status
      // This ensures totals match between months.
      // The delete runs unconditionally, OUTSIDE the "source month has rows"
      // check: if this period's last pending item was cleared, next period's
      // carried-forward copy of it has to go too. Guarding the delete behind
      // `length > 0` (as this did originally) left that copy stranded there
      // forever, and the DB trigger — which deletes unconditionally — then
      // disagreed with this function about the result.
      const { error: delete2BError } = await supabase
        .from('bills_not_in_2b')
        .delete()
        .eq('client_id', clientId)
        .eq('period_month', nextPeriod)
        .eq('is_carried_forward', true);
      if (delete2BError) throw delete2BError;

      if (billsNotIn2B && billsNotIn2B.length > 0) {
        // Now insert ALL records from current month as CF records in next month
        const records2B = billsNotIn2B.map(b => ({
          client_id: b.client_id,
          date: b.date,
          supplier_name: b.supplier_name,
          supplier_invoice_number: b.supplier_invoice_number,
          supplier_gstin: b.supplier_gstin,
          taxable_value: b.taxable_value,
          input_igst: b.input_igst,
          input_cgst: b.input_cgst,
          input_sgst: b.input_sgst,
          period_month: nextPeriod,
          reversal_month: b.reversal_month,
          reclaim_month: b.reclaim_month,
          reclaim_subtype: (b as any).reclaim_subtype ?? null,
          is_carried_forward: true,
        }));

        const { error: insert2BError } = await supabase.from('bills_not_in_2b').insert(records2B);
        if (insert2BError) throw insert2BError;
        totalCarried += records2B.length;
      }

      // CARRY FORWARD BILLS NOT IN BOOKS
      // Carry forward ALL records regardless of book_entry_month or bill_in_2b_month status
      // This matches user requirement to carry forward everything to next month
      // Same unconditional delete as the 2B side above.
      const { error: deleteBooksError } = await supabase
        .from('bills_not_in_books')
        .delete()
        .eq('client_id', clientId)
        .eq('period_month', nextPeriod)
        .eq('is_carried_forward', true);
      if (deleteBooksError) throw deleteBooksError;

      if (billsNotInBooks && billsNotInBooks.length > 0) {
        // Now insert ALL records from current month as CF records in next month
        const recordsBooks = billsNotInBooks.map(b => ({
          client_id: b.client_id,
          date: b.date,
          supplier_name: b.supplier_name,
          supplier_invoice_number: b.supplier_invoice_number,
          supplier_gstin: b.supplier_gstin,
          taxable_value: b.taxable_value,
          input_igst: b.input_igst,
          input_cgst: b.input_cgst,
          input_sgst: b.input_sgst,
          period_month: nextPeriod,
          book_entry_month: b.book_entry_month,
          bill_in_2b_month: b.bill_in_2b_month,
          is_carried_forward: true,
        }));

        const { error: insertBooksError } = await supabase.from('bills_not_in_books').insert(recordsBooks);
        if (insertBooksError) throw insertBooksError;
        totalCarried += recordsBooks.length;
      }

      return { success: true, totalCarried };
    } catch (error: any) {
      console.error('Error during carry forward:', error);
      return { success: false, totalCarried: 0, error: error?.message || 'Unknown error' };
    } finally {
      carryForwardInFlight.current.delete(lockKey);
    }
  };

  // Self-service recovery for a Filed GSTR-3B/GSTR-3B (Q) record whose
  // automatic carry-forward didn't happen (or needs re-syncing after a later
  // edit to this period's 2B Reconciliation) — no engineer needed. Safe to
  // click any time: it's the exact same delete-then-insert as the automatic
  // run, so it just re-syncs next period's carried-forward rows to match
  // this period's current state.
  const handleRetryCarryForward = async (record: FilingRecord) => {
    setRetryingCarryForwardId(record.id);
    try {
      const result = await carryForwardToNextMonth(record.client_id, record.period_month);
      if (result.success) {
        toast.success(`Carried forward ${result.totalCarried} record(s) to next period.`);
      } else {
        toast.error(`Carry-forward failed: ${result.error || 'unknown error'}`);
      }
    } finally {
      setRetryingCarryForwardId(null);
    }
  };

  // Fetch clients from Supabase
  const fetchClients = useCallback(async () => {
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, gstin, mobile, email, assigned_accountant, registration_type, regular_sub_type, builder_itc_type, selected_returns, registration_date, cancellation_date, registration_cancellation_date, inactive_at_hand, target_date_group1, target_date_group2')
      .order('name');
    
    if (error) {
      console.error('Error fetching clients:', error);
      toast.error('Failed to load clients');
      return;
    }
    setClients(data || []);
  }, []);

  // Fetch filing status records with user info for audit display
  const fetchFilingRecords = useCallback(async () => {
    const { data, error } = await supabase
      .from('filing_status')
      .select('*')
      .eq('period_month', selectedMonth);
    
    if (error) {
      console.error('Error fetching filing records:', error);
      return;
    }
    
    // Fetch user names for updated_by UUIDs
    const userIds = [...new Set((data || []).map(r => r.updated_by).filter(Boolean))] as string[];
    let userInfo: Record<string, { name: string; role: string }> = {};
    
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, first_name')
        .in('user_id', userIds);
      
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('user_id', userIds);
      
      if (profiles) {
        profiles.forEach(p => {
          const roleData = roles?.find(r => r.user_id === p.user_id);
          userInfo[p.user_id] = { 
            name: p.first_name, 
            role: roleData?.role || 'staff' 
          };
        });
      }
    }
    
    // Enrich records with user info
    const enrichedRecords = (data || []).map(r => ({
      ...r,
      updatedByName: r.updated_by ? (userInfo[r.updated_by]?.name || 'Unknown') : undefined,
      updatedByRole: r.updated_by ? (userInfo[r.updated_by]?.role || '') : undefined,
    }));
    
    setFilingRecords(enrichedRecords as FilingRecord[]);
  }, [selectedMonth]);

  // Bulk lookup of which clients have GSTR-1 data saved for the period —
  // gstr1_data.period_month uses short-month format ("Jul-26"), unlike
  // filing_status which uses MM/YYYY.
  const fetchGstr1DataClientIds = useCallback(async () => {
    const short = toShortMonth(selectedMonth);
    if (!short) { setGstr1DataClientIds(new Set()); return; }
    const { data, error } = await supabase
      .from('gstr1_data')
      .select('client_id')
      .eq('period_month', short);
    if (error) {
      console.error('Error fetching gstr1_data client ids:', error);
      return;
    }
    setGstr1DataClientIds(new Set((data || []).map((r) => r.client_id)));
  }, [selectedMonth]);

  // Build target date lookup from clients table (single source of truth)
  const buildTargetDateLookup = useCallback(() => {
    const lookup: Record<string, number> = {};
    clients.forEach(client => {
      const g1 = client.target_date_group1 ?? 11;
      const g2 = client.target_date_group2 ?? 20;
      // Group 1: GSTR-1, GSTR-1 (IFF), GSTR-7, GSTR-6
      lookup[`${client.id}__GSTR-1`] = g1;
      lookup[`${client.id}__GSTR-1 (IFF)`] = g1;
      lookup[`${client.id}__GSTR-7`] = g1;
      lookup[`${client.id}__GSTR-6`] = g1;
      // Group 2: GSTR-3B, GSTR-3B (Q), ITC-04, CMP-08
      lookup[`${client.id}__GSTR-3B`] = g2;
      lookup[`${client.id}__GSTR-3B (Q)`] = g2;
      lookup[`${client.id}__ITC-04`] = g2;
      lookup[`${client.id}__CMP-08`] = g2;
    });
    setTargetDateLookup(lookup);
  }, [clients]);

  // Build target date lookup whenever clients change
  useEffect(() => {
    buildTargetDateLookup();
  }, [buildTargetDateLookup]);

  // Fetch scheme history for all clients
  const fetchSchemeHistories = useCallback(async () => {
    const { data, error } = await supabase
      .from('client_scheme_history')
      .select('*')
      .order('effective_from_date', { ascending: true });
    
    if (error) {
      console.error('Error fetching scheme history:', error);
      return;
    }
    
    const map: Record<string, SchemeHistoryEntry[]> = {};
    (data || []).forEach((entry: any) => {
      if (!map[entry.client_id]) map[entry.client_id] = [];
      map[entry.client_id].push(entry as SchemeHistoryEntry);
    });
    setSchemeHistoryMap(map);
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      await Promise.all([fetchClients(), fetchFilingRecords(), fetchSchemeHistories(), fetchGstr1DataClientIds()]);
      setIsLoading(false);
    };
    loadData();
  }, [fetchClients, fetchFilingRecords, fetchSchemeHistories, fetchGstr1DataClientIds]);

  // GSTR-1 direct-filing approvals (from the Sep-2026 period). A GSTR-1 /
  // IFF that was not pushed through GST Keeper cannot become Filed until a
  // superadmin approves a request — a DB trigger enforces it; this keeps
  // staff on a request dialog instead of the raw trigger error.
  const isSuperadmin = user?.role === 'superadmin';
  const [directApprovals, setDirectApprovals] = useState<DirectFilingApproval[]>([]);
  const [approvalUserNames, setApprovalUserNames] = useState<Record<string, string>>({});
  const [directFilingTarget, setDirectFilingTarget] = useState<(DirectFilingTarget & { record: FilingRecord; localArn?: string }) | null>(null);
  const [approvalsPanelKey, setApprovalsPanelKey] = useState(0);

  const fetchDirectApprovals = useCallback(async () => {
    try {
      const rows = await fetchDirectFilingApprovals(clients.map((c) => c.id), selectedMonth);
      setDirectApprovals(rows);
      setApprovalUserNames(await fetchUserNames(rows.flatMap((r) => [r.requested_by, r.decided_by])));
    } catch (e) {
      console.error('Error fetching direct-filing approvals:', e);
    }
  }, [clients, selectedMonth]);

  useEffect(() => { void fetchDirectApprovals(); }, [fetchDirectApprovals]);

  const directApprovalsByKey = useMemo(() => groupApprovals(directApprovals), [directApprovals]);

  const approvalsFor = useCallback(
    (record: FilingRecord) => directApprovalsByKey.get(approvalKey(record.client_id, record.return_type, record.period_month || selectedMonth)) || [],
    [directApprovalsByKey, selectedMonth],
  );

  const directFilingStateFor = useCallback((record: FilingRecord, approvals?: DirectFilingApproval[]): DirectFilingState => directFilingState({
    returnType: record.return_type,
    periodMonth: record.period_month || selectedMonth,
    pushedAt: record.pushed_at,
    alreadyFiled: record.status === 'Filed',
    isNil: !!record.is_nil,
    approvals: approvals ?? approvalsFor(record),
  }), [approvalsFor, selectedMonth]);

  const openDirectFilingDialog = (record: FilingRecord, opts?: { fromFiled?: boolean; localArn?: string; approvals?: DirectFilingApproval[] }) => {
    setDirectFilingTarget({
      record,
      localArn: opts?.localArn,
      fromFiled: opts?.fromFiled,
      clientId: record.client_id,
      clientName: record.clientName || clients.find((c) => c.id === record.client_id)?.name || '',
      returnType: record.return_type,
      periodMonth: record.period_month || selectedMonth,
      current: pickApproval(opts?.approvals ?? approvalsFor(record)),
    });
  };

  const clientNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    clients.forEach((c) => { m[c.id] = c.name; });
    return m;
  }, [clients]);

  // ── Pull outcomes, manual allowances and conflicts (20261021110000) ──────
  const [filingLog, setFilingLog] = useState<FilingLogRow[]>([]);
  const [conflicts, setConflicts] = useState<FilingLogRow[]>([]);
  const [allowances, setAllowances] = useState<ManualSourceAllowance[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});

  const fetchExceptions = useCallback(async () => {
    try {
      const [log, open, allow] = await Promise.all([
        fetchFilingLog(selectedMonth),
        fetchOpenConflicts(),
        fetchAllowances(selectedMonth, 'filing:'),
      ]);
      setFilingLog(log);
      setConflicts(open);
      setAllowances(allow);
      setUserNames(await fetchUserNames(allow.flatMap((a) => [a.allowed_by, a.used_by, a.revoked_by])));
    } catch (e) {
      // A database without 20261021110000: the page still works, without them.
      console.error('Error fetching filing log / allowances:', e);
    }
  }, [selectedMonth]);

  useEffect(() => { void fetchExceptions(); }, [fetchExceptions]);

  // Real-time updates, one channel per table. A channel naming a table that is
  // not in the realtime publication fails as a whole, which is why this page
  // never heard the extension's writes (its one channel also named gstr1_data
  // and gstr1_direct_filing_approvals): a row Filed by the extension stayed
  // "Upload PDF" on screen and was then overwritten by hand. A burst of events
  // (a bulk pull) is read once.
  const refreshTimer = useRef<number | null>(null);
  const refreshSoon = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void fetchFilingRecords();
      void fetchExceptions();
    }, 400);
  }, [fetchFilingRecords, fetchExceptions]);

  useEffect(() => {
    const subscriptions: [string, string, () => void][] = [
      ['filing-status-rows', 'filing_status', refreshSoon],
      ['filing-status-log', 'filing_status_log', refreshSoon],
      ['filing-status-allowances', 'manual_source_allowances', () => { void fetchExceptions(); }],
      ['filing-status-clients', 'clients', () => { void fetchClients(); }],
      ['filing-status-approvals', 'gstr1_direct_filing_approvals', () => { void fetchDirectApprovals(); setApprovalsPanelKey((k) => k + 1); }],
    ];
    const channels = subscriptions.map(([name, table, onChange]) => supabase
      .channel(name)
      .on('postgres_changes', { event: '*', schema: 'public', table }, onChange)
      .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.warn(`Filing Status: no live updates for ${table}`); }));
    // gstr1_data is not in the realtime publication: read it again now and then,
    // and everything again when the tab comes back into view.
    const poll = setInterval(() => { void fetchGstr1DataClientIds(); }, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') { refreshSoon(); void fetchGstr1DataClientIds(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      channels.forEach((c) => { void supabase.removeChannel(c); });
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchClients, fetchExceptions, fetchGstr1DataClientIds, fetchDirectApprovals, refreshSoon]);

  const outcomes = useMemo(() => latestOutcomes(filingLog), [filingLog]);


  // GSTR-1's is_nil per client for the selected period, keyed off the raw
  // filing_status rows already fetched (filing_status.select('*') already
  // includes is_nil — no extra query). Covers the IFF sub-type too, since IFF
  // clients are shown under the same "GSTR-1" tab.
  const gstr1IsNilByClient = useMemo(() => {
    const map = new Map<string, boolean>();
    filingRecords
      .filter((r) => r.return_type === 'GSTR-1' || r.return_type === 'GSTR-1 (IFF)')
      .forEach((r) => map.set(r.client_id, !!r.is_nil));
    return map;
  }, [filingRecords]);

  // Generate filing records for display. Delegates to the shared helper so the
  // Dashboard and this page always derive their counts from the same logic.
  const generateAllFilingRecords = (returnType: ReturnType): FilingRecord[] => {
    return generateFilingRecords({
      displayReturnType: returnType,
      clients,
      filingRecords,
      schemeHistoryMap,
      selectedMonth,
      targetDateLookup,
    }) as FilingRecord[];
  };

  const handleExportPDF = () => {
    if (!canExportData()) {
      toast.error('Needs the Export data permission — ask a GST Manager to add it to your position');
      return;
    }
    const returnTypeMap: Record<string, ReturnType> = {
      'gstr1': 'GSTR-1',
      'gstr3b': 'GSTR-3B',
      'itc04': 'ITC-04',
      'gstr6': 'GSTR-6',
      'gstr7': 'GSTR-7',
      'cmp08': 'CMP-08',
    };
    const returnType = returnTypeMap[selectedTab];
    const records = generateAllFilingRecords(returnType);
    
    // Apply filters before exporting - IMPORTANT: filters must be respected in PDF
    const filteredRecords = records.filter(record => {
      // Client name filter
      if (clientNameFilter && !record.clientName?.toLowerCase().includes(clientNameFilter.toLowerCase())) {
        return false;
      }
      // Accountant filter (compares normalized names so "/<ref>" variants match)
      if (selectedAccountants.length > 0 && !selectedAccountants.includes(normalizeAccountant(record.accountantName))) {
        return false;
      }
      // Multi-select target date filter
      if (selectedTargetDates.length > 0 && record.target_date !== null && !selectedTargetDates.includes(record.target_date)) {
        return false;
      }
      // Multi-select status filter
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(record.status)) {
        return false;
      }
      return true;
    });
    
    // Convert to format expected by PDF export
    const pdfRecords = filteredRecords.map((r) => ({
      id: r.id,
      clientId: r.client_id,
      clientName: r.clientName || '',
      accountantName: r.accountantName || '-',
      returnType: r.return_type as ReturnType,
      filingFrequency: (r.filingFrequency || 'Monthly') as 'Monthly' | 'Quarterly' | 'Composition',
      otpDscPerson: '-',
      contactNumber: r.contactNumber || '-',
      clientEmail: r.clientEmail || '-',
      status: r.status,
      targetDate: r.target_date || 11,
      filedDate: r.filed_date ? new Date(r.filed_date) : undefined,
      remarks: r.remarks || '',
      month: r.period_month,
      isLocked: r.is_locked || false,
      arn: r.arn || '',
      // Where the filed return came from: Portal, manual (allowed by X: reason), ...
      source: filingSourceText(r, r.manual_allowance_id ? allowances.find((a) => a.id === r.manual_allowance_id) : null, userNames) || '',
    }));
    
    exportFilingStatusToPDF(pdfRecords, returnType, selectedMonth);
    toast.success('PDF exported successfully');
  };

  // Status by hand: only the working statuses. Pushed and Filed are evidence
  // (a push the portal accepted, a filed return read from the portal) and a
  // database trigger refuses them by hand; a Filed row is moved only by
  // Unlock (GST Manager / superadmin, GSTR-3B) or Take off Filed (superadmin).
  const handleStatusChange = async (record: FilingRecord, newStatus: FilingStatusType) => {
    if (!canEditFilingStatus()) {
      toast.error('Needs the Filing status & portal push permission — ask a GST Manager to add it to your position');
      return;
    }
    if (newStatus === 'Filed') {
      toast.error('Filed comes from the GST portal: use Pull. When a pull cannot be done, the superadmin can allow a manual upload for this return.');
      return;
    }
    if (newStatus === 'Pushed') {
      toast.error('"Pushed" is set automatically when a push to the GST portal succeeds. It cannot be selected by hand.');
      return;
    }
    if (record.status === 'Filed') {
      toast.error('A filed return keeps its status. A GST Manager can unlock a filed GSTR-3B; only the superadmin takes a return off Filed.');
      return;
    }
    const isNewRecord = record.id.startsWith('temp-');
    try {
      if (isNewRecord) {
        const { error } = await supabase
          .from('filing_status')
          .insert([{
            client_id: record.client_id,
            return_type: record.return_type as 'GSTR-1' | 'GSTR-3B' | 'ITC-04' | 'GSTR-6' | 'GSTR-7' | 'CMP-08' | 'GSTR-1 (IFF)' | 'GSTR-3B (Q)',
            period_month: selectedMonth,
            status: newStatus,
            target_date: record.target_date,
            updated_by: user?.id || null,
            updated_at: new Date().toISOString(),
          }]);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('filing_status')
          .update({ status: newStatus, updated_by: user?.id || null, updated_at: new Date().toISOString() })
          .eq('id', record.id);
        if (error) throw error;
      }
      toast.success('Status updated successfully');
      fetchFilingRecords();
    } catch (error: any) {
      console.error('Error updating status:', error);
      toast.error('Failed to update status: ' + error.message);
    }
  };


  const handleRemarksChange = async (record: FilingRecord, newRemarks: string) => {
    const isNewRecord = record.id.startsWith('temp-');
    
    if (isNewRecord) {
      // Create the record first
      try {
        const { error } = await supabase
          .from('filing_status')
          .insert([{
            client_id: record.client_id,
            return_type: record.return_type as 'GSTR-1' | 'GSTR-3B' | 'ITC-04' | 'GSTR-6' | 'GSTR-7' | 'CMP-08' | 'GSTR-1 (IFF)' | 'GSTR-3B (Q)',
            period_month: selectedMonth,
            status: record.status,
            target_date: record.target_date,
            remarks: newRemarks,
          }]);
        
        if (error) throw error;
        fetchFilingRecords();
      } catch (error: any) {
        console.error('Error saving remarks:', error);
      }
    } else {
      try {
        const { error } = await supabase
          .from('filing_status')
          .update({ remarks: newRemarks })
          .eq('id', record.id);
        
        if (error) throw error;
      } catch (error: any) {
        console.error('Error updating remarks:', error);
      }
    }
  };

  // The month's sheets of a GSTR-3B, unlocked (Unlock, and Take off Filed).
  const unlockMonthSheets = async (clientId: string, periodMonth: string) => {
    await supabase.from('bills_not_in_2b').update({ is_locked: false }).eq('client_id', clientId).eq('period_month', periodMonth);
    await supabase.from('bills_not_in_books').update({ is_locked: false }).eq('client_id', clientId).eq('period_month', periodMonth);
    await supabase.from('itc_summaries').update({ is_locked: false }).eq('client_id', clientId).eq('period_month', periodMonth);
    await supabase.from('rcm_data').update({ is_locked: false }).eq('client_id', clientId).eq('month', periodMonth);
  };

  // Unlock a filed GSTR-3B / GSTR-3B (Q) for corrections: the database
  // (filing_status_unlock, GST Manager or superadmin) moves it to Not to File
  // and unlocks it, keeping its ARN, filing date and PDF; pulling it again
  // files it again (same ARN) and locks the month again. The sheets are
  // unlocked here, as before.
  const handleUnlock = async (record: FilingRecord) => {
    if (record.id.startsWith('temp-')) return;
    if (!user?.id) return;
    try {
      await unlockFiled(user.id, record.client_id, record.period_month);

      // Also unlock ALL related sheets for the same client and period
      await unlockMonthSheets(record.client_id, record.period_month);

      // Next period's carried-forward rows are deliberately LEFT IN PLACE.
      //
      // This used to delete them, on the reasoning that re-filing would
      // re-create them from updated data. It does — but only if the period is
      // ever re-filed. Unlocking Jun-2026 and then simply not re-filing it
      // wiped Jul-2026's entire backlog, and once Jul-2026 was itself filed it
      // carried only its own rows into Aug-2026, so every pending item older
      // than July vanished for good (docs/2B_RECONCILIATION_FLOW.md §7).
      // Keeping them costs nothing: both carry-forward paths (the
      // auto_lock_on_filed trigger and carryForwardToNextMonth above) delete
      // every carried-forward row in the destination period before inserting,
      // so a re-file still produces exactly the right set.

      toast.success('All sheets unlocked. GSTR-3B shows Not to File until it is pulled again; its ARN, filing date and PDF are kept. Next month\'s carried-forward items were left untouched.');
      fetchFilingRecords();
    } catch (error: any) {
      toast.error('Failed to unlock: ' + error.message);
    }
  };


  // Each accountant with their distinct client count, for the filter dropdown.
  // Reference suffixes like "/16" are stripped so variants of the same person
  // collapse into a single row.
  const accountantOptions = useMemo(() => {
    const counts = new Map<string, number>();
    clients.forEach(c => {
      const name = normalizeAccountant(c.assigned_accountant);
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients]);

  // Apply filters to records
  // `ignoreStatus` is for the headline tiles only: they count every status
  // under the other filters, so clicking one status tile doesn't zero the rest.
  const applyFilters = (records: FilingRecord[], opts?: { ignoreStatus?: boolean }): FilingRecord[] => {
    return records.filter(record => {
      // Client name filter
      if (clientNameFilter && !record.clientName?.toLowerCase().includes(clientNameFilter.toLowerCase())) {
        return false;
      }
      // Accountant filter (compares normalized names so "/<ref>" variants match)
      if (selectedAccountants.length > 0 && !selectedAccountants.includes(normalizeAccountant(record.accountantName))) {
        return false;
      }
      // Multi-select target date filter
      if (selectedTargetDates.length > 0 && record.target_date !== null && !selectedTargetDates.includes(record.target_date)) {
        return false;
      }
      // Multi-select status filter
      if (!opts?.ignoreStatus && selectedStatuses.length > 0 && !selectedStatuses.includes(record.status)) {
        return false;
      }
      // Multi-select frequency filter (Monthly / Quarterly / IFF)
      if (selectedFrequencies.length > 0) {
        const freq = record.filingFrequency === 'Quarterly' ? 'Quarterly' : record.filingFrequency === 'IFF' ? 'IFF' : 'Monthly';
        if (!selectedFrequencies.includes(freq)) return false;
      }
      // Multi-select remarks filter ('__BLANK__' matches rows with no remark)
      if (selectedRemarks.length > 0) {
        const rem = (record.remarks || '').trim();
        if (!selectedRemarks.includes(rem === '' ? '__BLANK__' : rem)) return false;
      }
      // Late filings filter - show only filings that were filed after due date
      if (lateFilingsFilter) {
        if (record.status !== 'Filed' || !record.filed_date) {
          return false;
        }
        const filedDay = new Date(record.filed_date).getDate();
        // Get the due date for this return type
        const dueDate = RETURN_DUE_DATES[record.return_type] || record.target_date || 11;
        if (filedDay <= dueDate) {
          return false;
        }
      }
      return true;
    });
  };

  // Toggle target date selection
  const toggleTargetDate = (date: number) => {
    setSelectedTargetDates(prev => 
      prev.includes(date) 
        ? prev.filter(d => d !== date)
        : [...prev, date]
    );
  };

  // Toggle status selection
  const toggleStatus = (status: FilingStatusType) => {
    setSelectedStatuses(prev =>
      prev.includes(status)
        ? prev.filter(s => s !== status)
        : [...prev, status]
    );
  };

  const toggleFrequency = (freq: string) => {
    setSelectedFrequencies(prev => prev.includes(freq) ? prev.filter(f => f !== freq) : [...prev, freq]);
  };

  const toggleRemark = (rem: string) => {
    setSelectedRemarks(prev => prev.includes(rem) ? prev.filter(r => r !== rem) : [...prev, rem]);
  };

  // All available statuses
  const allStatuses: FilingStatusType[] = ['Prepared', 'Prepared Pending', 'Data Pending', 'Data Received', 'Mismatch in Data', 'Pushed', 'Filed'];

  // Get unique target dates for filter dropdown
  const getUniqueTargetDates = (): number[] => {
    const dates = new Set<number>();
    allReturnTypes.forEach(rt => {
      generateAllFilingRecords(rt).forEach(r => {
        if (r.target_date) dates.add(r.target_date);
      });
    });
    return Array.from(dates).sort((a, b) => a - b);
  };

  // ── The browser extension: pull filed returns from the portal ───────────
  // The page asks (one return, a client's returns, or every return in view);
  // the extension logs in, reads each return's ARN and filing date, keeps the
  // PDF only when it is the filed return showing that ARN, and records it
  // through filing_record_pull. Each outcome comes back here (and is in the
  // log, so a closed page still sees it after a reload).
  const [extReady, setExtReady] = useState(false);
  const [extVersion, setExtVersion] = useState<string | null>(null);
  const extOutdated = extReady && (!extVersion || compareVersions(extVersion, MIN_EXTENSION_VERSION) < 0);
  const [pending, setPending] = useState<Record<string, number>>({});
  // Round 3: each pull is followed by what the extension says of it (each
  // return's outcome, "still running" when asked, the end), not a fixed
  // time from its start, which gave up on every long bulk pull.
  const pullWatch = useRef(new PullWatch());
  // The client list for the message listener, without re-subscribing it.
  const clientsRef = useRef<Client[]>([]);
  useEffect(() => { clientsRef.current = clients; }, [clients]);

  const clearPending = useCallback((keys: string[]) => {
    if (!keys.length) return;
    setPending((prev) => {
      const next = { ...prev };
      keys.forEach((k) => { delete next[k]; });
      return next;
    });
  }, []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d: any = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) {
        setExtReady(true);
        setExtVersion(typeof d.version === 'string' ? d.version : null);
      }
      if (d.__gstkPullResult) {
        const r = d.__gstkPullResult;
        if (r.ok) {
          pullWatch.current.confirm(r.requestId, Date.now());
          const skipped: string[] = Array.isArray(r.skipped) ? r.skipped : [];
          toast.success(`Portal opened in a new tab for ${r.returns ?? 'the'} return${r.returns === 1 ? '' : 's'}. Type the CAPTCHA there; each return shows here when it is done.`
            + (skipped.length ? ` Not pulled (no saved GST login): ${skipped.join(', ')}.` : ''), { duration: 8000 });
        } else {
          toast.error('Could not start the portal pull: ' + r.error);
          if (r.requestId) clearPending(pullWatch.current.end(r.requestId));
        }
      }
      if (d.__gstkReturnPullProgress) {
        const p = d.__gstkReturnPullProgress;
        const k = pullKey(p.clientId, p.return_type, p.period_month);
        pullWatch.current.sign(p.requestId, Date.now());
        pullWatch.current.answered(k);
        clearPending([k]);
        const who = `${clientsRef.current.find((c) => c.id === p.clientId)?.name || 'Client'} · ${p.return_type} ${p.period_month}`;
        const text = `${who}: ${p.message || outcomeWords(p.outcome)}`;
        if (p.outcome === 'filed' || p.outcome === 'refreshed') toast.success(text, { duration: 8000 });
        else if (p.outcome === 'conflict' || p.outcome === 'not_found') toast.warning(text, { duration: 12000 });
        else toast.error(text, { duration: 12000 });
        refreshSoon();
        // The confirmation e-mail of a return just filed is queued by the
        // database; send it now (the 15-minute job is the backstop).
        if (p.outcome === 'filed') void supabase.functions.invoke('send-gst-email', { body: {} }).catch(() => {});
      }
      // The extension's answer to "is this pull still running?" (asked every
      // 30 s while one waits): running keeps the page waiting, however long a
      // bulk pull takes; not running ends it here too.
      if (d.__gstkReturnPullAlive) {
        const a = d.__gstkReturnPullAlive;
        if (a.live) pullWatch.current.sign(a.requestId, Date.now());
        else if (pullWatch.current.has(a.requestId)) {
          // The pull's own end (__gstkReturnPullDone) is usually on its way:
          // give it a moment, then end whatever it did not answer.
          window.setTimeout(() => {
            const left = pullWatch.current.end(a.requestId);
            clearPending(left);
            if (left.length) {
              toast.warning(`The extension is no longer running this pull. ${left.length} return${left.length === 1 ? '' : 's'} got no answer here: each row shows its outcome from the log.`, { duration: 12000 });
            }
            refreshSoon();
          }, 3000);
        }
      }
      if (d.__gstkReturnPullDone) {
        const r = d.__gstkReturnPullDone;
        const keys = pullWatch.current.end(r.requestId);
        clearPending([...keys, ...((r.results || []) as PullItem[]).map((x) => pullKey(x.clientId, x.return_type, x.period_month))]);
        const results: { outcome: string }[] = r.results || [];
        const missed = results.filter((x) => x.outcome === 'not_reached').length;
        if (r.tabClosed) toast.warning(`The portal tab was closed. ${missed} return${missed === 1 ? ' was' : 's were'} not pulled.`, { duration: 10000 });
        else if (r.ended && missed) toast.warning(`The pull ended early: ${r.ended}. ${missed} return${missed === 1 ? ' was' : 's were'} not pulled; each is in the log.`, { duration: 12000 });
        else if (missed) toast.warning(`${missed} return${missed === 1 ? ' was' : 's were'} not reached (the portal login did not complete).`, { duration: 10000 });
        refreshSoon();
      }
      if (d.__gstkOpenFilingResult) {
        if (d.__gstkOpenFilingResult.ok) toast.success('Portal opening in a new tab — type the CAPTCHA; it lands on the return\'s filing page. Review and submit with OTP/DSC yourself.');
        else toast.error('Could not open the filing page: ' + d.__gstkOpenFilingResult.error);
      }
    };
    window.addEventListener('message', onMsg);
    // Actively ask the extension if it's present. The extension announces itself
    // on load, but as a SPA our listener usually mounts AFTER that one-shot
    // message — so we ping and the extension answers (race-proof either way).
    const ping = () => window.postMessage({ __gstkAppReady: true }, '*');
    ping();
    const t1 = setTimeout(ping, 400);
    const t2 = setTimeout(ping, 1200);
    return () => {
      window.removeEventListener('message', onMsg);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [clearPending, refreshSoon]);

  // While pulls are running: read the log and the rows now and then (the
  // answer also comes through the extension and realtime), ask the
  // extension whether each pull is still running, and give up on one only
  // when the extension has said nothing of it for PULL_SILENCE_MS: longer
  // than its own idle limit, after which it ends the pull and reports.
  const pendingCount = Object.keys(pending).length;
  useEffect(() => {
    if (!pendingCount) return;
    let lastAsk = Date.now();
    const t = setInterval(() => {
      refreshSoon();
      const now = Date.now();
      if (now - lastAsk >= PULL_ASK_EVERY_MS) {
        lastAsk = now;
        for (const requestId of pullWatch.current.requests()) window.postMessage({ __gstkReturnPullAsk: { requestId } }, '*');
      }
      const silent = pullWatch.current.silent(now);
      const keys = silent.flatMap((x) => x.keys);
      if (!keys.length) return;
      clearPending(keys);
      const mins = Math.round(PULL_SILENCE_MS / 60000);
      toast.warning(`No word from the extension for ${mins} minutes about ${keys.length} return${keys.length === 1 ? '' : 's'}: it may have been closed or reloaded. Check the portal tab; each row shows its outcome when it lands.`, { duration: 15000 });
    }, 10_000);
    return () => clearInterval(t);
  }, [pendingCount, refreshSoon, clearPending]);

  // A pull outcome newer than the request answers it, even if the
  // extension's message was missed.
  useEffect(() => {
    if (!pendingCount) return;
    const answered = Object.entries(pending)
      .filter(([k, at]) => { const o = outcomes.get(k); return o && new Date(o.at).getTime() >= at - 5000; })
      .map(([k]) => k);
    answered.forEach((k) => pullWatch.current.answered(k));
    if (answered.length) clearPending(answered);
  }, [outcomes, pending, pendingCount, clearPending]);

  const startPull = (records: FilingRecord[], what: string) => {
    if (!extReady) { toast.error('Install or enable the GST Keeper browser extension to pull from the portal.'); return; }
    // The extension runs one pull at a time (it refuses a second one).
    if (pendingCount) { toast.info('A pull is running. Wait for it to end, then pull again.'); return; }
    if (extOutdated) {
      toast.error(`Update the GST Keeper extension to ${MIN_EXTENSION_VERSION} or later (chrome://extensions, Reload). Older copies could store the System generated summary as the filed GSTR-3B, and GST Keeper no longer accepts their Filed writes.`, { duration: 12000 });
      return;
    }
    const items: PullItem[] = records.map((r) => ({ clientId: r.client_id, return_type: r.return_type, period_month: r.period_month || selectedMonth }));
    if (!items.length) { toast.info(`Nothing to pull for ${what}.`); return; }
    const requestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
    const keys = items.map((i) => pullKey(i.clientId, i.return_type, i.period_month));
    const now = Date.now();
    pullWatch.current.start(requestId, keys, now);
    setPending((prev) => { const next = { ...prev }; keys.forEach((k) => { next[k] = now; }); return next; });
    window.postMessage({ __gstkPullReturns: { items, actorId: user?.id ?? null, requestId } }, '*');
  };

  // Log the client in on the portal and open THIS return's filing page (current
  // tab's return + period). The human does the CAPTCHA and the OTP/DSC submit.
  const openFilingOnPortal = (record: FilingRecord) => {
    if (!extReady) { toast.error('Install/enable the GST Keeper extension to log in from here.'); return; }
    window.postMessage({ __gstkOpenFiling: { clientId: record.client_id, return_type: record.return_type, period_month: record.period_month } }, '*');
  };

  // The other row of the same return (GSTR-1 / GSTR-1 (IFF), GSTR-3B / GSTR-3B
  // (Q)) when that one is Filed and this one is not: this one is "Not
  // applicable" (one return, one ARN; UNIQUE(arn) used to make the second
  // impossible to file).
  const filedTwinOf = useCallback((record: FilingRecord): FilingRecord | null => {
    if (record.status === 'Filed') return null;
    const fam = filingFamily(record.return_type);
    if (fam.length < 2) return null;
    return (filingRecords.find((f) => f.client_id === record.client_id && f.period_month === (record.period_month || selectedMonth)
      && f.return_type !== record.return_type && fam.includes(f.return_type) && f.status === 'Filed') as FilingRecord | undefined) || null;
  }, [filingRecords, selectedMonth]);

  const contextFor = (record: FilingRecord): FilingRowContext => {
    const period = record.period_month || selectedMonth;
    return {
      outcome: outcomes.get(pullKey(record.client_id, record.return_type, period)) || null,
      allowance: liveAllowance(allowances, record.client_id, period, filingScope(record.return_type)),
      usedAllowance: record.manual_allowance_id ? allowances.find((a) => a.id === record.manual_allowance_id) || null : null,
      filedTwin: filedTwinOf(record),
      pulling: !!pending[pullKey(record.client_id, record.return_type, period)],
      pullBlocked: isDirectFilingBlocked(directFilingStateFor(record)),
    };
  };

  // What a pull of a set of rows asks for: returns with a pull, not a
  // "Not applicable" twin, not held back by the direct-filing rule.
  const pullable = (r: FilingRecord) => hasPortalPull(r.return_type) && !filedTwinOf(r) && !isDirectFilingBlocked(directFilingStateFor(r));

  const pullOne = (record: FilingRecord) => {
    if (isDirectFilingBlocked(directFilingStateFor(record))) {
      openDirectFilingDialog(record, { fromFiled: true });
      return;
    }
    startPull([record], `${record.return_type} ${record.period_month}`);
  };

  // Every return of the client, but one unlocked for correction (its own
  // Pull files it again; "all" never re-locks a correction).
  const pullClient = (record: FilingRecord) => {
    const rows = FILING_TABS.flatMap((t) => generateAllFilingRecords(t.type))
      .filter((r) => r.client_id === record.client_id && pullable(r) && wantedInClientPull(r));
    startPull(rows, `${record.clientName || 'this client'} in ${selectedMonth}`);
  };

  // ── Manual exceptions ───────────────────────────────────────────────────
  const [attachTarget, setAttachTarget] = useState<ManualAttachTarget | null>(null);
  const [reasonSpec, setReasonSpec] = useState<ReasonDialogSpec | null>(null);

  const openAttach = (record: FilingRecord) => {
    // A GSTR-1 / IFF held back by the direct-filing rule needs the approval
    // first, whatever the route (the database refuses the attach too).
    if (isDirectFilingBlocked(directFilingStateFor(record))) {
      toast.info(`This ${record.return_type} was not pushed through GST Keeper. Request the superadmin's approval for the direct filing first; then attach it.`);
      openDirectFilingDialog(record, { fromFiled: true });
      return;
    }
    const client = clients.find((c) => c.id === record.client_id);
    const allowance = liveAllowance(allowances, record.client_id, record.period_month || selectedMonth, filingScope(record.return_type));
    if (isPullOnly(record.return_type) && (!allowance || allowance.used_at)) {
      toast.error(`${record.return_type} is pulled from the portal. A manual upload needs the superadmin's allowance for this return.`);
      return;
    }
    setAttachTarget({
      clientId: record.client_id,
      clientName: record.clientName || client?.name || '',
      gstin: client?.gstin || '',
      returnType: record.return_type,
      periodMonth: record.period_month || selectedMonth,
      arn: record.arn,
      allowance: isPullOnly(record.return_type) ? allowance : null,
      allowedByName: allowance ? userNames[allowance.allowed_by] : undefined,
    });
  };

  const allowManual = (record: FilingRecord) => {
    if (!isSuperadmin || !user?.id) return;
    const period = record.period_month || selectedMonth;
    setReasonSpec({
      title: 'Allow a manual upload',
      subtitle: `${record.clientName} · ${record.return_type} · ${period}`,
      explain: `${record.return_type} is marked Filed only by the portal pull. When a pull cannot be done (wrong portal password, portal down, no access), you can allow one manual upload of the filed return's PDF and ARN for this client, period and return. It is logged, used up when attached, and shown as manual everywhere.`,
      prompt: 'Why can it not be pulled?',
      placeholder: 'e.g. The client changed the portal password and is travelling; the return was filed on 11 Oct.',
      confirmText: 'Allow one manual upload',
      run: async (reason) => {
        try {
          await allowManualSource({ actorId: user.id, clientId: record.client_id, periodMonth: period, scope: filingScope(record.return_type), reason });
          toast.success('Manual upload allowed. Staff can now attach the filed return on this row.');
          void fetchExceptions();
        } catch (e) {
          toast.error((e as Error).message);
          throw e;
        }
      },
    });
  };

  const unfile = (record: FilingRecord) => {
    if (!isSuperadmin || !user?.id || record.id.startsWith('temp-')) return;
    setReasonSpec({
      title: 'Take this return off Filed',
      subtitle: `${record.clientName} · ${record.return_type} · ${record.period_month}${record.arn ? ` · ARN ${record.arn}` : ''}`,
      explain: `The row goes back to Prepared and loses its ARN, filing date and PDF. The log keeps what it held. Use this only when the row holds the wrong return; a pull then records the right one.${
        filingFamily('GSTR-3B').includes(record.return_type) ? ' The return and its month\'s sheets (2B, books, ITC summary, RCM) are unlocked, so staff can work it again.' : ''}`,
      prompt: 'Why is it taken off Filed?',
      confirmText: 'Take off Filed',
      destructive: true,
      run: async (reason) => {
        try {
          await unfileReturn(user.id, record.id, reason);
          if (filingFamily('GSTR-3B').includes(record.return_type)) await unlockMonthSheets(record.client_id, record.period_month);
          toast.success('Taken off Filed.');
          refreshSoon();
        } catch (e) {
          toast.error((e as Error).message);
          throw e;
        }
      },
    });
  };

  // Row badge for a GSTR-1 / IFF held back by the direct-filing rule. The
  // popover shows the request, and the superadmin's note on a rejection.
  // Shown only once a request exists. A render function, not a component made
  // inside the page (that remounted on every redraw and closed the popover).
  const renderDirectFilingBadge = (record: FilingRecord) => {
    const state: DirectFilingState = directFilingStateFor(record);
    // Shown once a request exists (a return not pushed yet shows no badge: it
    // is usually still being prepared; its Pull opens the request instead).
    if (state !== 'pending' && state !== 'rejected') return null;
    const action = directFilingActionLabel(state, isSuperadmin);
    const current = pickApproval(approvalsFor(record));
    const label = state === 'pending' ? 'Awaiting superadmin' : 'Rejected';
    const variant = state === 'pending' ? 'info' : 'destructive';
    const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
    return (
      <div className="mt-1 flex items-center gap-1">
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="min-w-0" title="Direct-filing approval — click for details">
              <Badge variant={variant} className="cursor-pointer truncate px-1.5 text-[10px] font-medium">{label}</Badge>
            </button>
          </PopoverTrigger>
          <PopoverContent side="left" className="w-[300px] space-y-1.5 p-3 text-xs">
            <p className="font-medium text-foreground">Not pushed through GST Keeper</p>
            <p className="text-muted-foreground">
              This {record.return_type} cannot be pulled from the portal (and so marked Filed) until a superadmin approves a direct-filing request.
            </p>
            {current && current.status !== 'approved' && (
              <div className="space-y-1 border-t pt-1.5">
                <p>
                  <span className="font-medium">{current.status === 'pending' ? 'Requested' : 'Rejected'}</span>
                  {current.status === 'pending'
                    ? ` by ${current.requested_by ? approvalUserNames[current.requested_by] || 'Unknown' : 'Unknown'}, ${when(current.requested_at)}`
                    : ` by ${current.decided_by ? approvalUserNames[current.decided_by] || 'Unknown' : 'Unknown'}, ${when(current.decided_at)}`}
                </p>
                <p className="whitespace-pre-wrap text-muted-foreground">Reason: {current.reason}</p>
                {current.status === 'rejected' && current.decision_note && (
                  <p className="whitespace-pre-wrap text-foreground">Superadmin's note: {current.decision_note}</p>
                )}
              </div>
            )}
            <Button size="sm" variant="outline" className={cn(WS_BTN, 'w-full')} onClick={() => openDirectFilingDialog(record, { fromFiled: true })}>
              {action}
            </Button>
          </PopoverContent>
        </Popover>
        {state !== 'pending' && (
          <button
            type="button"
            className="shrink-0 text-[10px] text-primary underline-offset-2 hover:underline"
            onClick={() => openDirectFilingDialog(record, { fromFiled: true })}
            title="Explain what happened and send it to the superadmin"
          >
            {action}
          </button>
        )}
      </div>
    );
  };


  if (isLoading) {
    return (
      <div className={WS_PAGE}>
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading filing status…
          </CardContent>
        </Card>
      </div>
    );
  }

  // Generate months for selector based on client registration dates
  const generateMonths = () => {
    const monthsSet = new Set<string>();
    const now = new Date();
    
    // Add default 24 months
    for (let i = 0; i < 24; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
      monthsSet.add(value);
    }
    
    // Add months from client registration dates (including future months up to 12 months ahead)
    clients.forEach(client => {
      if (client.registration_date) {
        const regDate = new Date(client.registration_date);
        const futureLimit = new Date(now.getFullYear(), now.getMonth() + 12, 1);
        let currentDate = new Date(regDate.getFullYear(), regDate.getMonth(), 1);
        
        while (currentDate <= futureLimit) {
          const value = `${String(currentDate.getMonth() + 1).padStart(2, '0')}/${currentDate.getFullYear()}`;
          monthsSet.add(value);
          currentDate.setMonth(currentDate.getMonth() + 1);
        }
      }
    });
    
    // Convert to array and sort descending
    const months = Array.from(monthsSet).map(value => {
      const [month, year] = value.split('/').map(Number);
      const date = new Date(year, month - 1, 1);
      return {
        value,
        label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        sortKey: year * 12 + month
      };
    });
    
    return months.sort((a, b) => b.sortKey - a.sortKey).map(({ value, label }) => ({ value, label }));
  };

  const months = generateMonths();

  // Every tab's rows, built once per render (the tab strip shows their counts).
  const recordsByTab: Record<string, FilingRecord[]> = Object.fromEntries(
    FILING_TABS.map(t => [t.value, generateAllFilingRecords(t.type)]),
  );
  // Headline tiles: the open tab's rows under every filter except status, so
  // the status tiles can double as the status filter without zeroing each other.
  const tabRowsInView = applyFilters(recordsByTab[selectedTab] || [], { ignoreStatus: true });
  const stats = {
    total: tabRowsInView.length,
    filed: tabRowsInView.filter(r => r.status === 'Filed').length,
    pending: tabRowsInView.filter(r => PENDING_FILING_STATUSES.includes(r.status) && !filedTwinOf(r)).length,
    mismatch: tabRowsInView.filter(r => r.status === 'Mismatch in Data').length,
    dataPending: tabRowsInView.filter(r => r.status === 'Data Pending').length,
    locked: tabRowsInView.filter(r => r.is_locked).length,
  };
  const statusFilterIs = (set: readonly FilingStatusType[]) =>
    selectedStatuses.length === set.length && set.every(st => selectedStatuses.includes(st));
  const toggleStatusTile = (set: readonly FilingStatusType[]) =>
    setSelectedStatuses(statusFilterIs(set) ? [] : [...set]);
  const activeFilterCount = [
    clientNameFilter,
    selectedAccountants.length,
    selectedTargetDates.length,
    selectedStatuses.length,
    selectedFrequencies.length,
    selectedRemarks.length,
  ].filter(Boolean).length;
  const currentTabLabel = FILING_TABS.find(t => t.value === selectedTab)?.type ?? '';

  // Pull every return in view that still needs it: not Filed, Filed but
  // never pulled, or pulled without a checked PDF or a portal filing date;
  // never one unlocked for correction (its own Pull files it again). Returns
  // held back by the direct-filing rule are counted and named, not pulled.
  const tabHasPull = hasPortalPull(currentTabLabel);
  const pullInView = () => {
    if (!tabHasPull) { toast.info(noPullTabText(currentTabLabel)); return; }
    const inView = applyFilters(recordsByTab[selectedTab] || []).filter((r) => hasPortalPull(r.return_type) && !filedTwinOf(r));
    const wanted = inView.filter((r) => wantedInBulkPull(r));
    const rows = wanted.filter((r) => pullable(r));
    const heldBack = wanted.length - rows.length;
    const byHand = inView.filter((r) => r.status === 'Filed' && r.filed_source === 'manual').length;
    if (!rows.length) { toast.info(bulkPullNothingText(heldBack, byHand), { duration: heldBack || byHand ? 10000 : 4000 }); return; }
    const clientsN = new Set(rows.map((r) => r.client_id)).size;
    if (!window.confirm(`Pull ${rows.length} return${rows.length === 1 ? '' : 's'} of ${clientsN} client${clientsN === 1 ? '' : 's'} from the GST portal? A portal tab opens; type each client's CAPTCHA there.`
      + (heldBack ? ` ${heldBack} return${heldBack === 1 ? ' is' : 's are'} left out: not pushed through GST Keeper, so the superadmin approves the direct filing first.` : ''))) return;
    startPull(rows, 'the returns in view');
  };

  return (
    <div className={WS_PAGE}>
      <PageHeader
        compact
        title="Filing Status"
        subtitle="GST return filing status for all clients"
        icon={<ClipboardCheck />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className={WS_BTN}
              onClick={pullInView}
              disabled={!canEditFilingStatus() || pendingCount > 0 || !tabHasPull}
              title={!tabHasPull
                ? noPullTabText(currentTabLabel)
                : extOutdated
                  ? `Update the GST Keeper extension to ${MIN_EXTENSION_VERSION} or later to pull filed returns`
                  : 'Pull from the GST portal every return in view that is not Filed, was Filed by hand before 21 Oct 2026 and never pulled, or was pulled without a checked PDF or the portal\'s filing date. Returns attached by hand are left out; Pull on a row checks one.'}
            >
              {pendingCount ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Pull filed returns{pendingCount ? ` (${pendingCount} running)` : ''}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={WS_BTN}
              onClick={handleExportPDF}
              disabled={!canExportData()}
              title={canExportData() ? undefined : 'Needs the Export data permission — ask a GST Manager to add it to your position'}
            >
              <Download className="h-3.5 w-3.5" />
              Export PDF
            </Button>
          </div>
        }
      />

      {/* Headline tiles for the open tab; the status tiles double as the status filter. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <TileButton active={selectedStatuses.length === 0} onClick={() => setSelectedStatuses([])} title="Show every status">
          <KpiTile
            label={`${currentTabLabel} returns in view`}
            value={stats.total}
            hint={[
              activeFilterCount ? `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} on` : 'No filters',
              stats.locked ? `${stats.locked} locked` : null,
            ].filter(Boolean).join(' · ')}
          />
        </TileButton>
        <TileButton active={statusFilterIs(FILED_STATUSES)} onClick={() => toggleStatusTile(FILED_STATUSES)} title="Show filed returns only">
          <KpiTile label="Filed" value={stats.filed} hint={stats.total ? `${Math.round((stats.filed / stats.total) * 100)}% of returns in view` : '—'} tone={stats.filed ? 'ok' : 'neutral'} />
        </TileButton>
        <TileButton active={statusFilterIs(PENDING_FILING_STATUSES)} onClick={() => toggleStatusTile(PENDING_FILING_STATUSES)} title="Show every status short of Filed">
          <KpiTile label="Pending" value={stats.pending} hint="Every status short of Filed" tone={stats.pending ? 'warn' : 'ok'} />
        </TileButton>
        <TileButton active={statusFilterIs(DATA_PENDING_STATUSES)} onClick={() => toggleStatusTile(DATA_PENDING_STATUSES)} title="Show Data Pending only">
          <KpiTile label="Data pending" value={stats.dataPending} hint="Waiting on the client" tone={stats.dataPending ? 'warn' : 'neutral'} />
        </TileButton>
        <TileButton active={statusFilterIs(MISMATCH_STATUSES)} onClick={() => toggleStatusTile(MISMATCH_STATUSES)} title="Show Mismatch in Data only">
          <KpiTile label="Mismatch in data" value={stats.mismatch} hint="Needs a look before filing" tone={stats.mismatch ? 'error' : 'neutral'} />
        </TileButton>
      </div>

      {/* Filters: one labelled toolbar. Status, frequency, target and remarks filter from the column headers. */}
      <Card>
        <CardContent className="px-3 py-2">
          <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3 lg:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <label className="min-w-0 space-y-0.5">
              <span className={WS_FILTER_LABEL}>Return period</span>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className={WS_CONTROL} aria-label="Return period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((month) => (
                    <SelectItem key={month.value} value={month.value}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="min-w-0 space-y-0.5">
              <span className={WS_FILTER_LABEL}>Client</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search client…"
                  value={clientNameFilter}
                  onChange={(e) => setClientNameFilter(e.target.value)}
                  className={cn(WS_CONTROL, 'pl-8 md:text-xs')}
                />
              </div>
            </label>

            {/* Accountant filter — Excel-style multi-select with search + Select All */}
            <div className="col-span-2 min-w-0 space-y-0.5 sm:col-span-1">
              <span className={WS_FILTER_LABEL}>Accountant</span>
              <MultiSelectPopover
                options={accountantOptions.map(opt => ({ value: opt.name, label: `${opt.name} (${opt.count})` }))}
                selectedValues={selectedAccountants}
                onSelectionChange={setSelectedAccountants}
                placeholder={`All accountants (${clients.length})`}
                className="w-full"
                contentClassName="w-72"
                searchable
                showSelectAll
                searchPlaceholder="Search accountant..."
              />
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-xs"
              disabled={!activeFilterCount}
              onClick={() => {
                setClientNameFilter('');
                setSelectedAccountants([]);
                setSelectedTargetDates([]);
                setSelectedStatuses([]);
                setSelectedFrequencies([]);
                setSelectedRemarks([]);
              }}
            >
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          </div>
          {lateFilingsFilter && (
            <div className="mt-2 flex items-center gap-1.5">
              <Badge variant="warning" className="gap-1 px-1.5 text-[10px] font-medium">
                Late filings only — filed after the due date
                <button
                  type="button"
                  onClick={() => setLateFilingsFilter(false)}
                  className="-mr-0.5 rounded-sm hover:bg-foreground/10"
                  aria-label="Show all filings"
                  title="Show all filings"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <Note>
        GSTR-1 and GSTR-3B are marked Filed only from the GST portal: Pull reads the ARN, the filing date and the return PDF through the extension (one return, all of a client's, or every return in view with Pull filed returns). The PDF is kept only when it is the filed return showing its ARN. When a pull cannot be done, the superadmin can allow one manual upload for that return, with a reason; it shows as manual. GSTR-1 (IFF), GSTR-3B (Q), GSTR-6 and GSTR-7 can be pulled, and can still be attached by hand until their pull is proven; CMP-08 and ITC-04 have no pull yet. A PDF or date no pull checked says so. Remarks save when you leave the box.
      </Note>

      {(isSuperadmin || conflicts.length > 0 || allowances.length > 0) && (
        <FilingExceptionsPanel
          periodMonth={selectedMonth}
          isSuperadmin={isSuperadmin}
          userId={user?.id ?? null}
          clientNames={clientNameMap}
          userNames={userNames}
          allowances={allowances}
          conflicts={conflicts}
          onChanged={refreshSoon}
        />
      )}

      {isSuperadmin && (
        <DirectFilingApprovalsPanel
          userId={user?.id ?? null}
          clientNames={clientNameMap}
          refreshKey={approvalsPanelKey}
          onDecided={() => { void fetchDirectApprovals(); }}
        />
      )}

      {/* Return type tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-2">
        <TabsList className={TAB_LIST_CLASS} aria-label="Return type">
          {FILING_TABS.map(t => (
            <TabsTrigger key={t.value} value={t.value} className={TAB_TRIGGER_CLASS}>
              {t.type}
              <span className="tabular-nums text-muted-foreground">{recordsByTab[t.value].length}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {FILING_TABS.map(t => (
          <TabsContent key={t.value} value={t.value} className="mt-0">
            <FilingTable
              records={recordsByTab[t.value]}
              rows={applyFilters(recordsByTab[t.value])}
              returnType={t.type}
              contextFor={contextFor}
              userNames={userNames}
              allStatuses={allStatuses}
              selectedStatuses={selectedStatuses}
              toggleStatus={toggleStatus}
              clearStatuses={() => setSelectedStatuses([])}
              selectedFrequencies={selectedFrequencies}
              toggleFrequency={toggleFrequency}
              clearFrequencies={() => setSelectedFrequencies([])}
              selectedTargetDates={selectedTargetDates}
              toggleTargetDate={toggleTargetDate}
              clearTargetDates={() => setSelectedTargetDates([])}
              selectedRemarks={selectedRemarks}
              toggleRemark={toggleRemark}
              clearRemarks={() => setSelectedRemarks([])}
              canUnlockSheets={canUnlockSheets()}
              canEditFilingStatus={canEditFilingStatus()}
              isSuperadmin={isSuperadmin}
              extReady={extReady}
              extOutdated={extOutdated}
              pullRunning={pendingCount > 0}
              gstr1DataClientIds={gstr1DataClientIds}
              gstr1IsNilByClient={gstr1IsNilByClient}
              retryingCarryForwardId={retryingCarryForwardId}
              directFilingBadge={renderDirectFilingBadge}
              onStatusChange={(r, s) => { void handleStatusChange(r, s); }}
              onRemarksChange={(r, rem) => { void handleRemarksChange(r, rem); }}
              onRetryCarryForward={(r) => { void handleRetryCarryForward(r); }}
              onUnlock={(r) => { void handleUnlock(r); }}
              onPull={pullOne}
              onPullClient={pullClient}
              onAttach={openAttach}
              onAllowManual={allowManual}
              onUnfile={unfile}
              onOpenFiling={openFilingOnPortal}
            />
          </TabsContent>
        ))}
      </Tabs>

      <RequestDirectFilingDialog
        target={directFilingTarget}
        onClose={() => setDirectFilingTarget(null)}
        isSuperadmin={isSuperadmin}
        userId={user?.id ?? null}
        userNames={approvalUserNames}
        onDone={(approval, approved) => {
          const t = directFilingTarget;
          setDirectFilingTarget(null);
          setDirectApprovals((prev) => [approval, ...prev.filter((a) => a.id !== approval.id)]);
          void fetchDirectApprovals();
          setApprovalsPanelKey((k) => k + 1);
          // Approved from Pull: the pull goes ahead.
          if (approved && t?.fromFiled) startPull([t.record], `${t.record.return_type} ${t.record.period_month}`);
        }}
      />

      <ManualAttachDialog
        target={attachTarget}
        userId={user?.id ?? null}
        onClose={() => setAttachTarget(null)}
        onDone={() => { setAttachTarget(null); refreshSoon(); }}
      />

      <ReasonDialog spec={reasonSpec} onClose={() => setReasonSpec(null)} />
    </div>
  );
};

/** A KPI tile that also acts as a filter toggle. */
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

export default FilingStatusPage;
