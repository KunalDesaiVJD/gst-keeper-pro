import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/gstr9/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { MultiSelectPopover } from '@/components/ui/multi-select-popover';
import {
  Upload,
  FileSpreadsheet,
  History,
  AlertCircle,
  Lock,
  Trash2,
  Plus,
  Save,
  Filter,
  Inbox,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { ChangeHistoryButton } from '@/components/history/ChangeHistoryButton';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import ClearDataDialog from '@/components/dialogs/ClearDataDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { export2BToExcel, import2BFromExcel } from '@/utils/excelExport';
import VersionHistoryDialog from '@/components/dialogs/VersionHistoryDialog';
import { TwoBVersion, BillNotIn2B, BillNotInBooks, isQuarterEndMonth } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';
import { KpiTile, Note } from '@/components/gstr9/ui';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { nextVersionNumber, writePostVersion } from '@/lib/postImport2B';
import { checkRowsUnchanged, holdsDecision, OpenMonthSaveError, writeOpenMonthSave } from '@/lib/twobPendingWrites';
import {
  changeShown, changesShown, LEDGER_CHANGED_BANNER, LEDGER_RELOADED_MSG, ledgerChangeConcerns, liveChangeAction, rowsToSave, type LedgerChange,
} from '@/lib/twobLiveSync';
import {
  OPEN_MONTH, PRIOR_MONTH_MSG, PRIOR_MONTH_DOCS_MSG, canChangePriorBooks, fetchNibFollows2B, fetchTwobMonthState, ledgerCellReadOnly, priorNibLockReason,
  previewAndApplyPriorBooks, restoreBlockedReason, restoreVersion, versionRows2B, versionRowsBooks, type RestoreRow, type TwobChange, type TwobMonthState,
} from '@/lib/twobPriorMonth';
import {
  WS_PAGE, WS_BTN, WS_TABLE, WS_TH, WS_TD, WS_TD_NUM, WS_TR, WS_TR_TOTAL, WS_FILTER_LABEL, WS_CONTROL,
} from '@/components/workspace/theme';

/** Dense workspace table; the last column drops its right rule (the wrapper draws it). */
const TABLE_CLS = cn(WS_TABLE, '[&_tr>*:last-child]:border-r-0');
const fmtINR = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

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

interface Client {
  id: string;
  name: string;
  gstin: string;
  registration_date?: string;
  registration_type?: string;
  liberal_2b_reconciliation?: boolean | null;
}

interface BillRecord {
  id: string;
  client_id: string;
  date: string;
  supplier_name: string;
  supplier_invoice_number: string | null;
  supplier_gstin: string | null;
  taxable_value: number | null;
  input_igst: number | null;
  input_cgst: number | null;
  input_sgst: number | null;
  period_month: string;
  reversal_month?: string | null;
  reclaim_month?: string | null;
  reclaim_subtype?: string | null;
  book_entry_month?: string | null;
  bill_in_2b_month?: string | null;
  /** Not in Books: the 2B document it was posted from (follows the filed 2B in a prior month; docs §13). */
  source_doc_id?: string | null;
  /** Not in 2B: the Import 2B books row that posted it, and the 2B document a reclaim names. */
  source_book_id?: string | null;
  reclaimed_via_doc_id?: string | null;
  /** An own entry an Import 2B row was linked to instead of adding one: what it held before (docs §15). */
  adopted_from?: Json | null;
  is_locked: boolean | null;
  is_carried_forward: boolean | null;
  version: number | null;
  updated_at: string | null;
  updated_by: string | null;
}

// Audit info for last saved
interface LastSavedInfo {
  savedBy: string;
  savedByRole: string;
  savedAt: Date;
  versionNumber: number;
  actionType: 'SAVE' | 'RESTORE';
}

const TwoBReconciliationPage: React.FC = () => {
  const { canViewVersionHistory, canUnlockSheets, canDelete2BRows, canImportExcel, user, isStaffRole, canExportData, canClearData } = useAuth();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [billsNotIn2B, setBillsNotIn2B] = useState<BillRecord[]>([]);
  const [billsNotInBooks, setBillsNotInBooks] = useState<BillRecord[]>([]);
  const [localBills2B, setLocalBills2B] = useState<BillRecord[]>([]);
  const [localBillsBooks, setLocalBillsBooks] = useState<BillRecord[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Rows marked for deletion (removed on Save), kept with the edits: a reload
  // or a discard clears both together.
  const [deletedRows2B, setDeletedRows2B] = useState<string[]>([]);
  const [deletedRowsBooks, setDeletedRowsBooks] = useState<string[]>([]);
  // The ledger of this month changed elsewhere while the page held unsaved
  // edits (a change heard live, or a Save refused): the banner says so, and
  // the edits stay until saved or discarded (verification round 3).
  const [ledgerChanged, setLedgerChanged] = useState(false);
  // Every local edit counts here, so a reload heard live that lands after an
  // edit began never overwrites it.
  const editGenRef = useRef(0);
  // A Save is running (set at once, before the state re-renders): a change
  // heard meanwhile is kept, and looked at again when the Save ends against
  // the month the Save reloaded (verification round 4: it was dropped).
  const savingRef = useRef(false);
  const heardDuringSaveRef = useRef<LedgerChange[]>([]);
  // The rows the page shows as loaded, by id (set when a load lands): a
  // change it already shows as it is (its own Save, heard after the Save's
  // reload) is not news, whoever made it (round 4: before, every change
  // stamped by this user was ignored for 5 s after a Save, from any tab).
  const shownRowsRef = useRef<Map<string, BillRecord>>(new Map());
  // The live handler's way in for the changes heard during a Save.
  const liveKickRef = useRef<((changes: LedgerChange[]) => void) | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  // Prior month (docs §13), as the database reads it (twob_month_state).
  const [monthState, setMonthState] = useState<TwobMonthState>(OPEN_MONTH);
  // A prior month's carried Not in Books rows that follow a 2B document
  // (twob_nib_2b_copies): read-only there; null when they could not be read
  // (every carried Not in Books row is then read-only).
  const [nibFollows2B, setNibFollows2B] = useState<Set<string> | null>(new Set());
  const confirm = useConfirm();
  const [versions, setVersions] = useState<TwoBVersion[]>([]);
  const [lastSavedInfo, setLastSavedInfo] = useState<LastSavedInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showClearData, setShowClearData] = useState(false);
  
  // Multi-select filter states
  const [selectedReversalMonths, setSelectedReversalMonths] = useState<string[]>([]);
  const [selectedReclaimMonths, setSelectedReclaimMonths] = useState<string[]>([]);
  const [selectedBookEntryMonths, setSelectedBookEntryMonths] = useState<string[]>([]);
  const [selectedIn2BMonths, setSelectedIn2BMonths] = useState<string[]>([]);
  
  // CF filter states - to filter only carried-forward records
  const [showOnlyCF2B, setShowOnlyCF2B] = useState(false);
  const [showOnlyCFBooks, setShowOnlyCFBooks] = useState(false);
  
  // Negative value error state
  const [negativeValueError, setNegativeValueError] = useState<string | null>(null);
  
  // Compute max date based on selected return period (last day of month)
  const maxDateForReturnPeriod = useMemo(() => {
    if (!selectedMonth) return undefined;
    const [monthStr, yearStr] = selectedMonth.split('/');
    const month = parseInt(monthStr);
    const year = parseInt(yearStr);
    // Last day of the selected month
    const lastDay = new Date(year, month, 0).getDate();
    return `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
  }, [selectedMonth]);

  // Default date for new rows (1st of return period month)
  const defaultDateForNewRow = useMemo(() => {
    if (!selectedMonth) return new Date().toISOString().split('T')[0];
    const [monthStr, yearStr] = selectedMonth.split('/');
    return `${yearStr}-${monthStr}-01`;
  }, [selectedMonth]);
  
  const selectedClientData = clients.find(c => c.id === selectedClientId);

  // Strict (default) — this client's 2B Reconciliation is read-only, entries
  // only go through Import 2B (see docs/2B_RECONCILIATION_FLOW.md). Liberal —
  // an explicit per-client opt-out (superadmin/gst_manager only, set on the
  // client's edit page) that restores the full directly-editable page. Either
  // way a filed period (isLocked) is always read-only on top of this.
  const isLiberalClient = !!selectedClientData?.liberal_2b_reconciliation;
  // The superadmin may add, edit and delete on every working sheet (firm's
  // decision, 13 Oct 2026): neither Strict mode nor a filed period stops them.
  const isSuperadmin = user?.role === 'superadmin';
  // A prior month (filed, or a later month filed; firm's rule of 21 Oct
  // 2026, docs §13): only a GST Manager or the superadmin changes it, and
  // only its books entries (the two lists), through twob_prior_books_apply,
  // which also changes every later month's carried copy, with a preview
  // first. Cells and added rows for a Liberal client; the delete buttons for
  // Strict and Liberal. The reversal, reclaim, book entry and in-2B months
  // of its rows never change; Import Excel, Restore and Clear Data never
  // touch it. Employees see it read-only.
  const isPrior = monthState.isPrior;
  const canPriorBooks = canChangePriorBooks(user?.role);
  const readOnly = isPrior ? !(canPriorBooks && isLiberalClient) : !isSuperadmin && (isLocked || !isLiberalClient);
  const canDeleteHere = isPrior ? canPriorBooks : !readOnly;
  const canSaveHere = !readOnly || canDeleteHere;

  // Check if client requires quarterly months only (IFF or Composition)
  const isQuarterlyClient = selectedClientData?.registration_type === 'IFF' || selectedClientData?.registration_type === 'Composition';

  // Generate month options dynamically - filtered by selected client's registration date and quarterly logic
  const generateMonthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    
    // Future limit: +2 months from today (aligned with GST filing logic)
    const maxFutureMonths = 2;
    
    // Find registration date from selected client
    const client = clients.find(c => c.id === selectedClientId);
    let startDate = new Date(now.getFullYear(), now.getMonth() - 12, 1); // Default: 12 months ago
    
    if (client?.registration_date) {
      const regDate = new Date(client.registration_date);
      startDate = new Date(regDate.getFullYear(), regDate.getMonth(), 1);
    }
    
    const futureLimit = new Date(now.getFullYear(), now.getMonth() + maxFutureMonths, 1);
    let currentDate = new Date(startDate);
    
    while (currentDate <= futureLimit) {
      const monthNum = currentDate.getMonth() + 1;
      
      // Skip non-quarter-end months for IFF/Composition clients
      if (isQuarterlyClient && !isQuarterEndMonth(monthNum)) {
        currentDate.setMonth(currentDate.getMonth() + 1);
        continue;
      }
      
      const value = `${String(monthNum).padStart(2, '0')}/${currentDate.getFullYear()}`;
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const label = `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
      months.push({ value, label });
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
    
    // Sort in descending order (newest first)
    return months.sort((a, b) => {
      const [aM, aY] = a.value.split('/').map(Number);
      const [bM, bY] = b.value.split('/').map(Number);
      return bY * 12 + bM - (aY * 12 + aM);
    });
  }, [clients, selectedClientId, isQuarterlyClient]);

  const monthOptions = generateMonthOptions;

  // Restrict Reversal / Reclaim / Book Entry / In-2B dropdowns for return
  // periods from Jun-26 onward to just the current month (+ blank and, on
  // the Reclaim column only, "Expense out"). Backfilling past months was
  // producing bad data; older periods keep the full historical list so
  // already-saved rows are not affected.
  const RESTRICT_MONTHS_FROM = 202606; // YYYY * 100 + MM

  const currentPeriodMonthLabel = useMemo(() => {
    if (!selectedMonth) return '';
    const parts = selectedMonth.split('/');
    if (parts.length !== 2) return '';
    const [mmStr, yyStr] = parts;
    const idx = parseInt(mmStr, 10) - 1;
    if (idx < 0 || idx > 11) return '';
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[idx]} ${String(yyStr).slice(-2)}`;
  }, [selectedMonth]);

  const isRestrictedPeriod = useMemo(() => {
    if (!selectedMonth || isSuperadmin) return false;
    const [mm, yy] = selectedMonth.split('/').map(Number);
    if (!mm || !yy) return false;
    return yy * 100 + mm >= RESTRICT_MONTHS_FROM;
  }, [selectedMonth, isSuperadmin]);

  // Generate month dropdown options for reversal/reclaim - from April 2024, future limited to +2 months
  // Shows all historical months so existing saved data is preserved (prospective restriction only)
  const reversalReclaimMonths = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const startDate = new Date(2024, 3, 1); // April 2024
    const now = new Date();
    const endDate = new Date(now.getFullYear(), now.getMonth() + 2, 1); // +2 months future limit
    
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const yearShort = String(currentDate.getFullYear()).slice(-2);
      const value = `${monthNames[currentDate.getMonth()]} ${yearShort}`;
      options.push({ value, label: value });
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
    
    // Sort descending (newest first)
    const sorted = options.sort((a, b) => {
      const parseDate = (s: string) => {
        const [m, y] = s.split(' ');
        return (2000 + parseInt(y)) * 12 + monthNames.indexOf(m);
      };
      return parseDate(b.value) - parseDate(a.value);
    });
    return [{ value: '__blank__', label: '(Blank)' }, ...sorted];
  }, []);

  // Fetch clients - filtered for client role
  const fetchClients = useCallback(async () => {
    let query = supabase
      .from('clients')
      .select('id, name, gstin, registration_date, registration_type, liberal_2b_reconciliation')
      .order('name');
    
    // If user is a client, fetch only their client record by matching client id
    if (user && !isStaffRole()) {
      // For client users, user.id IS the client table's id
      query = query.eq('id', user.id);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching clients:', error);
      return;
    }
    setClients(data || []);
    
    // Auto-select if client user and only one client
    if (!isStaffRole() && data && data.length > 0 && !selectedClientId) {
      setSelectedClientId(data[0].id);
    }
  }, [user, isStaffRole, selectedClientId, setSelectedClientId]);

  // The selection as of the latest render: a load started for another
  // (client, month), or overtaken by a newer load, is dropped.
  const selectionRef = useRef({ client: selectedClientId, month: selectedMonth });
  selectionRef.current = { client: selectedClientId, month: selectedMonth };
  const loadSeq = useRef(0);

  // Loads the month. A reload shows the month as it is and clears the edits
  // and the pending deletes together (verification round 3: before, a reload
  // left the pending deletes armed, so the next Save deleted a row the
  // screen showed again). ifClean (a change heard live): applied only when
  // the page holds no edits when the reads come back (an edit begun
  // meanwhile stays, and the banner says the ledger changed).
  const fetchBillsData = useCallback(async (opts: { ifClean?: boolean } = {}) => {
    if (!selectedClientId || !selectedMonth) return;
    const client = selectedClientId;
    const month = selectedMonth;
    const seq = ++loadSeq.current;
    const gen = editGenRef.current;

    const [res2B, resBooks, filingRes] = await Promise.all([
      supabase.from('bills_not_in_2b').select('*').eq('client_id', client).eq('period_month', month).order('date'),
      supabase.from('bills_not_in_books').select('*').eq('client_id', client).eq('period_month', month).order('date'),
      // Filing status for the lock (GSTR-3B Filed)
      supabase.from('filing_status').select('is_locked').eq('client_id', client).eq('period_month', month)
        .in('return_type', ['GSTR-3B', 'GSTR-3B (Q)']).eq('status', 'Filed').maybeSingle(),
    ]);
    // A month state that cannot be read leaves the month read-only: the
    // database would refuse a prior month's writes anyway.
    const state = await fetchTwobMonthState(client, month).catch((err: Error) => {
      toast.error(`${err.message}. The month is shown read-only; reload to try again.`);
      return { ...OPEN_MONTH, isPrior: true };
    });
    const follows = state.isPrior ? await fetchNibFollows2B(client, month).catch(() => null) : new Set<string>();

    const current = seq === loadSeq.current && selectionRef.current.client === client && selectionRef.current.month === month;
    if (!current) return;
    if (res2B.error || resBooks.error) {
      toast.error(`Could not load the month: ${(res2B.error || resBooks.error)?.message}. Reload to try again.`);
      return;
    }
    if (opts.ifClean && (editGenRef.current !== gen || dirtyRef.current)) {
      setLedgerChanged(true);
      return;
    }
    const notIn2B = (res2B.data || []) as BillRecord[];
    const notInBooks = (resBooks.data || []) as BillRecord[];
    shownRowsRef.current = new Map([...notIn2B, ...notInBooks].map((b) => [b.id, b]));
    setBillsNotIn2B(notIn2B);
    setLocalBills2B(notIn2B);
    setBillsNotInBooks(notInBooks);
    setLocalBillsBooks(notInBooks);
    setIsLocked(!!notIn2B[0]?.is_locked || !!notInBooks[0]?.is_locked || !!filingRes.data?.is_locked);
    setMonthState(state);
    setNibFollows2B(follows);
    setDeletedRows2B([]);
    setDeletedRowsBooks([]);
    setHasUnsavedChanges(false);
    setLedgerChanged(false);
  }, [selectedClientId, selectedMonth]);

  // Fetch version history
  const fetchVersions = useCallback(async () => {
    if (!selectedClientId || !selectedMonth) {
      setVersions([]);
      setLastSavedInfo(null);
      return;
    }

    const { data, error } = await supabase
      .from('twob_versions')
      .select('*')
      .eq('client_id', selectedClientId)
      .eq('period_month', selectedMonth)
      .order('version_number', { ascending: false });

    if (error) {
      console.error('Error fetching versions:', error);
      return;
    }

    if (data && data.length > 0) {
      // Fetch user names and roles for updated_by UUIDs
      const userIds = [...new Set(data.map(v => v.updated_by).filter(Boolean))];
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
      
      // Convert to TwoBVersion format
      const formattedVersions: TwoBVersion[] = data.map(v => ({
        id: v.id,
        clientId: v.client_id,
        month: v.period_month,
        periodMonth: v.period_month,
        tableType: v.table_type as 'Bills_Not_in_2B' | 'Bills_Not_in_Books',
        versionNumber: v.version_number || 1,
        billsNotIn2B: (v.version_data as any)?.billsNotIn2B || [],
        billsNotInBooks: (v.version_data as any)?.billsNotInBooks || [],
        updatedBy: v.updated_by ? (userInfo[v.updated_by]?.name || 'Unknown') : 'Unknown',
        updatedByRole: v.updated_by ? (userInfo[v.updated_by]?.role || '') : '',
        updatedAt: new Date(v.updated_at || Date.now()),
        isCurrent: v.is_current || false,
        actionType: (v as any).action_type || 'SAVE',
        restoredFromVersionId: (v as any).restored_from_version_id || undefined,
      }));
      setVersions(formattedVersions);
      
      // Set last saved info from the most recent version
      const latestVersion = formattedVersions[0];
      if (latestVersion) {
        setLastSavedInfo({
          savedBy: latestVersion.updatedBy,
          savedByRole: latestVersion.updatedByRole || '',
          savedAt: latestVersion.updatedAt,
          versionNumber: latestVersion.versionNumber,
          actionType: latestVersion.actionType || 'SAVE',
        });
      }
    } else {
      setVersions([]);
      setLastSavedInfo(null);
    }
  }, [selectedClientId, selectedMonth]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  useEffect(() => {
    if (selectedClientId && selectedMonth) {
      fetchBillsData();
      fetchVersions();
    } else {
      shownRowsRef.current = new Map();
      setBillsNotIn2B([]);
      setBillsNotInBooks([]);
      setLocalBills2B([]);
      setLocalBillsBooks([]);
      setIsLocked(false);
      setMonthState(OPEN_MONTH);
      setDeletedRows2B([]);
      setDeletedRowsBooks([]);
      setHasUnsavedChanges(false);
      setLedgerChanged(false);
      setVersions([]);
      setLastSavedInfo(null);
    }
  }, [selectedClientId, selectedMonth, fetchBillsData, fetchVersions]);

  // Whether the page holds unsaved edits or pending deletes, as of the
  // latest render (read by the live-change handler).
  const dirty = hasUnsavedChanges || deletedRows2B.length > 0 || deletedRowsBooks.length > 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Changes to this month's ledger heard live (every Import 2B save writes it
  // now; docs §15): a change the page already shows as it is is not news;
  // never over unsaved edits or pending deletes (the banner instead); during
  // a Save, kept and looked at again when it ends (round 4); otherwise one
  // reload per burst (an import writes many rows) and one note. A change to
  // another month or client is ignored. A delete carries only its row id,
  // so deletes are heard unfiltered and kept when they name a row shown.
  useEffect(() => {
    if (!selectedClientId || !selectedMonth) return;
    const clientId = selectedClientId;
    const period = selectedMonth;
    const view = { clientId, period };
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: LedgerChange[] = [];
    // Decided when it runs: an edit or a Save begun meanwhile counts.
    const settle = () => {
      timer = null;
      const changes = pending;
      pending = [];
      const act = liveChangeAction({ saving: savingRef.current, dirty: dirtyRef.current });
      if (act === 'wait') { heardDuringSaveRef.current.push(...changes); return; }
      if (changesShown(changes, view, shownRowsRef.current)) return;
      if (act === 'banner') { setLedgerChanged(true); return; }
      toast.info(LEDGER_RELOADED_MSG, { id: 'twob-ledger-reloaded' });
      // The version list too: every Import 2B save that changes the ledger
      // takes a version (verification round 5).
      void fetchBillsData({ ifClean: true }).then(() => fetchVersions());
    };
    const hear = (changes: LedgerChange[], wait: number) => {
      pending.push(...changes);
      if (timer) clearTimeout(timer);
      timer = setTimeout(settle, wait);
    };
    const onChange = (change: LedgerChange) => {
      if (!ledgerChangeConcerns(change, { clientId, period, ids: shownRowsRef.current })) return;
      if (savingRef.current) { heardDuringSaveRef.current.push(change); return; }
      // A change the page already shows is no news by itself, but it stays
      // with a burst under way (verification round 8: a Restore's delete of
      // an entry it adds back reads as shown only beside that insert, heard
      // just after it).
      if (changeShown(change, view, shownRowsRef.current)) { if (timer) pending.push(change); return; }
      hear([change], 400);
    };
    liveKickRef.current = (changes) => hear(changes, 0);
    const channel = supabase
      .channel(`2b-reconciliation-${clientId}-${period}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bills_not_in_2b', filter: `client_id=eq.${clientId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bills_not_in_books', filter: `client_id=eq.${clientId}` }, onChange)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'bills_not_in_2b' }, onChange)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'bills_not_in_books' }, onChange)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      liveKickRef.current = null;
      heardDuringSaveRef.current = [];
      supabase.removeChannel(channel);
    };
  }, [selectedClientId, selectedMonth, fetchBillsData, fetchVersions]);

  // A Save ends: the changes heard while it ran are looked at again, against
  // the month as the Save reloaded it (or as loaded, when nothing was
  // written): what the page does not show yet reloads it, or, with edits
  // kept, raises the banner.
  const endSave = () => {
    savingRef.current = false;
    const heard = heardDuringSaveRef.current;
    heardDuringSaveRef.current = [];
    if (heard.length > 0) liveKickRef.current?.(heard);
  };

  // Reload (or discard): the month as it is now, the edits and the pending
  // deletes cleared together; asked first while there is something to lose.
  const reloadMonth = async () => {
    if (dirtyRef.current && !(await confirm({
      title: 'Discard your unsaved changes?',
      description: 'The month is loaded again as it is now. Your unsaved edits, added rows and rows marked for deletion on this page are discarded.',
      confirmText: 'Discard and reload',
      destructive: true,
    }))) return;
    await fetchBillsData();
  };

  // Filter bills based on selected months (with support for "Blank" filter)
  const filteredBills2B = useMemo(() => {
    return localBills2B.filter(row => {
      // CF filter - show only carried forward records
      if (showOnlyCF2B && !row.is_carried_forward) {
        return false;
      }
      // Reversal filter
      if (selectedReversalMonths.length > 0) {
        const hasBlankFilter = selectedReversalMonths.includes('__blank__');
        const otherFilters = selectedReversalMonths.filter(m => m !== '__blank__');
        
        const matchesBlank = hasBlankFilter && (!row.reversal_month || row.reversal_month.trim() === '');
        const matchesMonth = otherFilters.length > 0 && row.reversal_month && otherFilters.includes(row.reversal_month);
        
        if (!matchesBlank && !matchesMonth) {
          return false;
        }
      }
      // Reclaim filter
      if (selectedReclaimMonths.length > 0) {
        const hasBlankFilter = selectedReclaimMonths.includes('__blank__');
        const otherFilters = selectedReclaimMonths.filter(m => m !== '__blank__');
        
        const matchesBlank = hasBlankFilter && (!row.reclaim_month || row.reclaim_month.trim() === '');
        const matchesMonth = otherFilters.length > 0 && row.reclaim_month && otherFilters.includes(row.reclaim_month);
        
        if (!matchesBlank && !matchesMonth) {
          return false;
        }
      }
      return true;
    });
  }, [localBills2B, selectedReversalMonths, selectedReclaimMonths, showOnlyCF2B]);

  const filteredBillsBooks = useMemo(() => {
    return localBillsBooks.filter(row => {
      // CF filter - show only carried forward records
      if (showOnlyCFBooks && !row.is_carried_forward) {
        return false;
      }
      // Book Entry filter
      if (selectedBookEntryMonths.length > 0) {
        const hasBlankFilter = selectedBookEntryMonths.includes('__blank__');
        const otherFilters = selectedBookEntryMonths.filter(m => m !== '__blank__');
        
        const matchesBlank = hasBlankFilter && (!row.book_entry_month || row.book_entry_month.trim() === '');
        const matchesMonth = otherFilters.length > 0 && row.book_entry_month && otherFilters.includes(row.book_entry_month);
        
        if (!matchesBlank && !matchesMonth) {
          return false;
        }
      }
      // In 2B filter
      if (selectedIn2BMonths.length > 0) {
        const hasBlankFilter = selectedIn2BMonths.includes('__blank__');
        const otherFilters = selectedIn2BMonths.filter(m => m !== '__blank__');
        
        const matchesBlank = hasBlankFilter && (!row.bill_in_2b_month || row.bill_in_2b_month.trim() === '');
        const matchesMonth = otherFilters.length > 0 && row.bill_in_2b_month && otherFilters.includes(row.bill_in_2b_month);
        
        if (!matchesBlank && !matchesMonth) {
          return false;
        }
      }
      return true;
    });
  }, [localBillsBooks, selectedBookEntryMonths, selectedIn2BMonths, showOnlyCFBooks]);

  const totals2B = filteredBills2B.reduce((acc, row) => ({
    taxableValue: acc.taxableValue + (row.taxable_value || 0),
    igst: acc.igst + (row.input_igst || 0),
    cgst: acc.cgst + (row.input_cgst || 0),
    sgst: acc.sgst + (row.input_sgst || 0),
    reversalCount: acc.reversalCount + (row.reversal_month ? 1 : 0),
    reclaimCount: acc.reclaimCount + (row.reclaim_month ? 1 : 0),
  }), { taxableValue: 0, igst: 0, cgst: 0, sgst: 0, reversalCount: 0, reclaimCount: 0 });

  const totalsBooks = filteredBillsBooks.reduce((acc, row) => ({
    taxableValue: acc.taxableValue + (row.taxable_value || 0),
    igst: acc.igst + (row.input_igst || 0),
    cgst: acc.cgst + (row.input_cgst || 0),
    sgst: acc.sgst + (row.input_sgst || 0),
    bookEntryCount: acc.bookEntryCount + (row.book_entry_month ? 1 : 0),
    in2BCount: acc.in2BCount + (row.bill_in_2b_month ? 1 : 0),
  }), { taxableValue: 0, igst: 0, cgst: 0, sgst: 0, bookEntryCount: 0, in2BCount: 0 });

  const handleExportExcel = () => {
    if (!canExportData()) { toast.error('Needs the Export data permission — ask a GST Manager to add it to your position'); return; }
    if (!selectedClientData) {
      toast.error('Please select a client first');
      return;
    }
    
    const exportData2B: BillNotIn2B[] = localBills2B.map(b => ({
      id: b.id,
      clientId: b.client_id,
      date: new Date(b.date),
      supplierName: b.supplier_name,
      supplierInvoiceNumber: b.supplier_invoice_number || '',
      supplierGstin: b.supplier_gstin || '',
      taxableValue: b.taxable_value || 0,
      inputIgst: b.input_igst || 0,
      inputCgst: b.input_cgst || 0,
      inputSgst: b.input_sgst || 0,
      reversalMonth: b.reversal_month || '',
      reclaimMonth: b.reclaim_month || '',
      periodMonth: b.period_month,
      isLocked: b.is_locked || false,
      isCarriedForward: b.is_carried_forward || false,
      updatedBy: b.updated_by || '',
      updatedAt: b.updated_at ? new Date(b.updated_at) : new Date(),
      version: b.version || 1,
    }));

    const exportDataBooks: BillNotInBooks[] = localBillsBooks.map(b => ({
      id: b.id,
      clientId: b.client_id,
      date: new Date(b.date),
      supplierName: b.supplier_name,
      supplierInvoiceNumber: b.supplier_invoice_number || '',
      supplierGstin: b.supplier_gstin || '',
      taxableValue: b.taxable_value || 0,
      inputIgst: b.input_igst || 0,
      inputCgst: b.input_cgst || 0,
      inputSgst: b.input_sgst || 0,
      bookEntryMonth: b.book_entry_month || '',
      billIn2BMonth: b.bill_in_2b_month || '',
      periodMonth: b.period_month,
      isLocked: b.is_locked || false,
      isCarriedForward: b.is_carried_forward || false,
      updatedBy: b.updated_by || '',
      updatedAt: b.updated_at ? new Date(b.updated_at) : new Date(),
      version: b.version || 1,
    }));
    
    export2BToExcel(selectedClientData.name, selectedMonth, exportData2B, exportDataBooks);
    toast.success('Excel file exported successfully');
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!selectedClientId) {
      toast.error('Please select a client first');
      return;
    }

    if (isPrior) {
      toast.error(PRIOR_MONTH_DOCS_MSG + ' Import Excel adds to open months only.');
      return;
    }
    // The import reloads the month: unsaved edits would be lost with it.
    if (dirtyRef.current) {
      toast.error('Save or discard your unsaved changes first: Import Excel reloads the month.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (readOnly) {
      toast.error(isLocked ? 'Cannot import - sheet is locked' : 'Cannot import - this client is in Strict mode, use Import 2B instead');
      return;
    }

    try {
      const data = await import2BFromExcel(file);

      // For Jun-26+ periods, blank out any Reversal / Reclaim / Book Entry /
      // In-2B value that isn't the current month or (Reclaim only) "Expense
      // out". Matches the on-screen dropdown restriction — imports must not
      // be a backdoor for backfilling past-month values.
      let sanitizedCount = 0;
      const sanitizeMonth = (
        raw: string | null | undefined,
        allowExpenseOut: boolean,
      ): string | null => {
        if (!isRestrictedPeriod) return raw ? raw : null;
        if (!raw || String(raw).trim() === '') return null;
        const trimmed = String(raw).trim();
        if (trimmed === currentPeriodMonthLabel) return trimmed;
        if (allowExpenseOut && trimmed.toLowerCase() === 'expense out') {
          // Best-effort: coerce to current-month reclaim. The Excel export
          // doesn't carry the subtype flag, so we can't restore EXPENSE_OUT
          // exactly here — the row can be re-marked in the UI if needed.
          return currentPeriodMonthLabel;
        }
        sanitizedCount++;
        return null;
      };

      // Insert bills not in 2B
      if (data.billsNotIn2B.length > 0) {
        const records = data.billsNotIn2B.map(b => ({
          client_id: selectedClientId,
          // Format using local components — `.toISOString()` would shift the
          // calendar day backward for users east of UTC (e.g. IST midnight
          // becomes the previous day in UTC).
          date: format(b.date, 'yyyy-MM-dd'),
          supplier_name: b.supplierName,
          supplier_invoice_number: b.supplierInvoiceNumber,
          supplier_gstin: b.supplierGstin,
          taxable_value: b.taxableValue,
          input_igst: b.inputIgst,
          input_cgst: b.inputCgst,
          input_sgst: b.inputSgst,
          period_month: selectedMonth,
          reversal_month: sanitizeMonth(b.reversalMonth, false),
          reclaim_month: sanitizeMonth(b.reclaimMonth, true),
        }));

        const { error } = await supabase
          .from('bills_not_in_2b')
          .insert(records);

        if (error) throw error;
      }

      // Insert bills not in books
      if (data.billsNotInBooks.length > 0) {
        const records = data.billsNotInBooks.map(b => ({
          client_id: selectedClientId,
          date: format(b.date, 'yyyy-MM-dd'),
          supplier_name: b.supplierName,
          supplier_invoice_number: b.supplierInvoiceNumber,
          supplier_gstin: b.supplierGstin,
          taxable_value: b.taxableValue,
          input_igst: b.inputIgst,
          input_cgst: b.inputCgst,
          input_sgst: b.inputSgst,
          period_month: selectedMonth,
          book_entry_month: sanitizeMonth(b.bookEntryMonth, false),
          bill_in_2b_month: sanitizeMonth(b.billIn2BMonth, false),
        }));

        const { error } = await supabase
          .from('bills_not_in_books')
          .insert(records);

        if (error) throw error;
      }

      toast.success(`Imported ${data.billsNotIn2B.length} records to "Bills Not in 2B" and ${data.billsNotInBooks.length} to "Bills Not in Books"`);
      if (sanitizedCount > 0) {
        toast.warning(`${sanitizedCount} past/future month value(s) were blanked because return period ${currentPeriodMonthLabel} restricts month cells to the current period only.`);
      }
      fetchBillsData();
    } catch (error: any) {
      console.error('Import error:', error);
      toast.error('Failed to import: ' + error.message);
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // An edit on the page: unsaved until Save, and counted so a reload heard
  // live never lands over it.
  const markEdited = () => {
    editGenRef.current += 1;
    setHasUnsavedChanges(true);
  };

  // Local editing handlers for Bills Not in 2B (update local state only)
  // With CGST/SGST auto-sync
  const handleUpdate2BField = (id: string, field: string, value: any) => {
    if (readOnly) return;
    
    setLocalBills2B(prev => prev.map(b => {
      if (b.id !== id) return b;
      
      // Auto-sync CGST and SGST
      if (field === 'input_cgst') {
        return { ...b, input_cgst: value, input_sgst: value };
      } else if (field === 'input_sgst') {
        return { ...b, input_cgst: value, input_sgst: value };
      }
      
      return { ...b, [field]: value };
    }));
    markEdited();
  };

  // Local editing handlers for Bills Not in Books (update local state only)
  // With CGST/SGST auto-sync
  const handleUpdateBooksField = (id: string, field: string, value: any) => {
    if (readOnly) return;
    
    setLocalBillsBooks(prev => prev.map(b => {
      if (b.id !== id) return b;
      
      // Auto-sync CGST and SGST
      if (field === 'input_cgst') {
        return { ...b, input_cgst: value, input_sgst: value };
      } else if (field === 'input_sgst') {
        return { ...b, input_cgst: value, input_sgst: value };
      }
      
      return { ...b, [field]: value };
    }));
    markEdited();
  };

  // Mark rows for deletion (local only; the state is declared with the edits)
  const handleDeleteRow2B = (id: string) => {
    if (!canDeleteHere) return;
    setLocalBills2B(prev => prev.filter(b => b.id !== id));
    // Track for actual deletion on save
    if (billsNotIn2B.find(b => b.id === id)) {
      setDeletedRows2B(prev => [...prev, id]);
    }
    markEdited();
  };

  const handleDeleteRowBooks = (id: string) => {
    if (!canDeleteHere) return;
    setLocalBillsBooks(prev => prev.filter(b => b.id !== id));
    // Track for actual deletion on save
    if (billsNotInBooks.find(b => b.id === id)) {
      setDeletedRowsBooks(prev => [...prev, id]);
    }
    markEdited();
  };

  // Add new row handlers (local only with temp ID)
  const handleAddRow2B = () => {
    if (!selectedClientId || readOnly) return;
    
    const tempId = `temp-${Date.now()}`;
    setLocalBills2B(prev => [...prev, {
      id: tempId,
      client_id: selectedClientId,
      date: defaultDateForNewRow,
      supplier_name: '',
      supplier_invoice_number: null,
      supplier_gstin: null,
      taxable_value: 0,
      input_igst: 0,
      input_cgst: 0,
      input_sgst: 0,
      period_month: selectedMonth,
      reversal_month: null,
      reclaim_month: null,
      reclaim_subtype: null,
      is_locked: false,
      is_carried_forward: false,
      version: 1,
      updated_at: null,
      updated_by: null,
    }]);
    markEdited();
  };

  const handleAddRowBooks = () => {
    if (!selectedClientId || readOnly) return;
    
    const tempId = `temp-${Date.now()}`;
    setLocalBillsBooks(prev => [...prev, {
      id: tempId,
      client_id: selectedClientId,
      date: defaultDateForNewRow,
      supplier_name: '',
      supplier_invoice_number: null,
      supplier_gstin: null,
      taxable_value: 0,
      input_igst: 0,
      input_cgst: 0,
      input_sgst: 0,
      period_month: selectedMonth,
      book_entry_month: null,
      bill_in_2b_month: null,
      is_locked: false,
      is_carried_forward: false,
      version: 1,
      updated_at: null,
      updated_by: null,
    }]);
    markEdited();
  };

  // Validation for mandatory fields
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    // Only rows added or changed here are checked: a row that came in from
    // Import 2B without a GSTIN must not stop anyone saving (or deleting)
    // something else on the sheet.
    const touched2B = (b: BillRecord) => b.id.startsWith('temp-')
      || JSON.stringify(billsNotIn2B.find((o) => o.id === b.id)) !== JSON.stringify(b);
    const touchedBooks = (b: BillRecord) => b.id.startsWith('temp-')
      || JSON.stringify(billsNotInBooks.find((o) => o.id === b.id)) !== JSON.stringify(b);
    localBills2B.forEach((b, idx) => {
      if (b.is_carried_forward || !touched2B(b)) return; // Skip CF and untouched rows
      const rowNum = idx + 1;
      if (!b.date) errors.push(`Bills Not in 2B - Row ${rowNum}: Date is required`);
      if (!b.supplier_name || b.supplier_name.trim() === '') errors.push(`Bills Not in 2B - Row ${rowNum}: Supplier Name is required`);
      if (!b.supplier_invoice_number || b.supplier_invoice_number.trim() === '') errors.push(`Bills Not in 2B - Row ${rowNum}: Invoice No. is required`);
      if (!b.supplier_gstin || b.supplier_gstin.trim() === '') errors.push(`Bills Not in 2B - Row ${rowNum}: GSTIN is required`);
    });
    localBillsBooks.forEach((b, idx) => {
      if (b.is_carried_forward || !touchedBooks(b)) return;
      const rowNum = idx + 1;
      if (!b.date) errors.push(`Bills Not in Books - Row ${rowNum}: Date is required`);
      if (!b.supplier_name || b.supplier_name.trim() === '') errors.push(`Bills Not in Books - Row ${rowNum}: Supplier Name is required`);
      if (!b.supplier_invoice_number || b.supplier_invoice_number.trim() === '') errors.push(`Bills Not in Books - Row ${rowNum}: Invoice No. is required`);
      if (!b.supplier_gstin || b.supplier_gstin.trim() === '') errors.push(`Bills Not in Books - Row ${rowNum}: GSTIN is required`);
    });
    return errors;
  }, [localBills2B, localBillsBooks, billsNotIn2B, billsNotInBooks]);

  const hasMandatoryFieldErrors = validationErrors.length > 0;

  // Before any Save writes: the rows it updates or deletes, read again
  // against the page's loaded copies (checkRowsUnchanged): every column they
  // hold, their months, reclaim, Expense out, book entry, reclaiming document
  // and link with the figures (verification round 4: the figures alone let a
  // Save write a stale Expense out over a reclaim Import 2B recorded
  // meanwhile). When any of them changed elsewhere (Import 2B's
  // write-through, another tab, a filed month's correction), nothing is
  // written and the user is asked to reload; the edits stay until reloaded or
  // discarded (verification round 3). Returns the rows as read now (what the
  // Save decides from), or null when it must not go on.
  const checkNotChangedElsewhere = async (
    plan2B: ReturnType<typeof rowsToSave<BillRecord>>, planBooks: ReturnType<typeof rowsToSave<BillRecord>>,
  ): Promise<{ current2B: Map<string, BillRecord>; currentBooks: Map<string, BillRecord> } | null> => {
    let stale: string[];
    let current2B: Map<string, BillRecord>;
    let currentBooks: Map<string, BillRecord>;
    try {
      const a = await checkRowsUnchanged('bills_not_in_2b', [...plan2B.deletes, ...plan2B.updates.map((u) => u.loaded)]);
      const b = await checkRowsUnchanged('bills_not_in_books', [...planBooks.deletes, ...planBooks.updates.map((u) => u.loaded)]);
      stale = [...a.stale, ...b.stale];
      current2B = a.current;
      currentBooks = b.current;
    } catch (error) {
      toast.error(`Nothing was saved: ${(error as Error).message} Your changes are still on the page.`);
      return null;
    }
    if (stale.length === 0) return { current2B, currentBooks };
    setLedgerChanged(true);
    if (await confirm({
      title: 'This month changed since you loaded it',
      description: `${stale.slice(0, 3).join(' ')}${stale.length > 3 ? ` And ${stale.length - 3} more.` : ''} Nothing was saved. Reload to see the month as it is now; your unsaved changes on this page are then discarded. Keep them to copy them first.`,
      confirmText: 'Reload',
      cancelText: 'Keep my changes',
      destructive: true,
    })) await fetchBillsData();
    return null;
  };

  // A prior month's Save: the removals, added rows and changed date,
  // supplier, number, GSTIN and amounts, as one call through the one door,
  // previewed first ("Also changes Aug-26 (1)"); each reaches the later
  // months' carried copies of the entry. The month columns never change here.
  const LEDGER_FIELDS = ['date', 'supplier_name', 'supplier_invoice_number', 'supplier_gstin', 'taxable_value', 'input_igst', 'input_cgst', 'input_sgst'] as const;
  const savePriorMonth = async () => {
    if (!selectedClientId || !selectedMonth || !user?.id) return;
    const changesOf = (table: 'bills_not_in_2b' | 'bills_not_in_books', plan: ReturnType<typeof rowsToSave<BillRecord>>): TwobChange[] => {
      const out: TwobChange[] = plan.deletes.map((r) => ({ table, op: 'delete', id: r.id }));
      for (const row of plan.inserts) {
        const values: Record<string, string | number | null> = {};
        LEDGER_FIELDS.forEach((k) => { values[k] = row[k] ?? null; });
        if (table === 'bills_not_in_2b') values.reversal_month = row.reversal_month || null;
        else values.bill_in_2b_month = row.bill_in_2b_month || null;
        out.push({ table, op: 'insert', values });
      }
      for (const { loaded: was, edited: row } of plan.updates) {
        const values: Record<string, string | number | null> = {};
        LEDGER_FIELDS.forEach((k) => { if ((row[k] ?? null) !== (was[k] ?? null)) values[k] = row[k] ?? null; });
        if (Object.keys(values).length) out.push({ table, op: 'update', id: row.id, values });
      }
      return out;
    };
    const plan2B = rowsToSave(localBills2B, billsNotIn2B, deletedRows2B);
    const planBooks = rowsToSave(localBillsBooks, billsNotInBooks, deletedRowsBooks);
    const changes = [...changesOf('bills_not_in_2b', plan2B), ...changesOf('bills_not_in_books', planBooks)];
    if (changes.length === 0) { toast.info('Nothing to save.'); return; }
    setIsSaving(true);
    savingRef.current = true;
    try {
      if (!(await checkNotChangedElsewhere(plan2B, planBooks))) return;
      const outcome = await previewAndApplyPriorBooks({
        actorId: user.id, clientId: selectedClientId, period: selectedMonth, changes, confirm,
        title: 'Save changes to a filed month?', confirmText: 'Save',
        destructive: changes.some((c) => c.op === 'delete'),
        notify: { error: (m) => toast.error(m, { duration: 15000 }), info: (m) => toast.info(m, { duration: 15000 }) },
      });
      if (!outcome.applied) return;
      const version = await writePostVersion(selectedClientId, selectedMonth, user.id);
      await fetchBillsData();
      await fetchVersions();
      toast.success(`Changes saved${version ? `. Version ${version} created` : ''}.`);
    } finally {
      endSave();
      setIsSaving(false);
    }
  };

  // Save all changes to database: only the rows the user added, changed or
  // deleted are sent (rowsToSave), each update and delete guarded by
  // everything the row held when loaded (updateOpenMonthRow,
  // deleteOpenMonthRows), after the check above. A Save that stops before
  // writing anything keeps the edits on the page (verification round 4:
  // before, any failure reloaded the month and the edits were lost though
  // nothing had been written).
  const handleSaveAll = async () => {
    if (!selectedClientId || !canSaveHere) return;
    
    // Validate mandatory fields
    if (validationErrors.length > 0) {
      // Show first 5 errors
      const displayErrors = validationErrors.slice(0, 5);
      displayErrors.forEach(err => toast.error(err));
      if (validationErrors.length > 5) {
        toast.error(`...and ${validationErrors.length - 5} more validation errors`);
      }
      return;
    }
    
    if (isPrior) {
      await savePriorMonth();
      return;
    }

    const plan2B = rowsToSave(localBills2B, billsNotIn2B, deletedRows2B);
    const planBooks = rowsToSave(localBillsBooks, billsNotInBooks, deletedRowsBooks);

    setIsSaving(true);
    savingRef.current = true;
    // Whether the writes went through (a failure before any of them, or in
    // them before the first one was written, keeps the edits).
    let wrote = false;
    try {
      // A row changed or removed elsewhere since the page loaded is never
      // written over with the page's old copy: the Save writes nothing and
      // asks to reload (docs §13, §15).
      const checked = await checkNotChangedElsewhere(plan2B, planBooks);
      if (!checked) return;
      // Decided from the rows as read now (the same as loaded, checked).
      const del2B = plan2B.deletes.map((b) => checked.current2B.get(b.id) ?? b);
      const delBooks = planBooks.deletes.map((b) => checked.currentBooks.get(b.id) ?? b);

      // A carried entry deleted here that holds a reclaim, Expense out or book
      // entry takes it with it: say so first.
      const goneDecided = [...del2B, ...delBooks].filter((b) => b.is_carried_forward && holdsDecision(b));
      if (goneDecided.length > 0 && !(await confirm({
        title: 'Delete entries with a reclaim or book entry?',
        description: `${goneDecided.length} carried ${goneDecided.length === 1 ? 'entry you delete holds' : 'entries you delete hold'} a reclaim, Expense out or book entry (${goneDecided.slice(0, 4).map((b) => [b.supplier_name, b.supplier_invoice_number].filter(Boolean).join(' ')).join(', ')}${goneDecided.length > 4 ? ` and ${goneDecided.length - 4} more` : ''}). Deleting ${goneDecided.length === 1 ? 'it removes' : 'them removes'} that too.`,
        confirmText: 'Delete',
        destructive: true,
      }))) return;

      // The writes (writeOpenMonthSave): the deletes (a carried entry's own
      // reclaim, Expense out or book entry undone with it; the copies the
      // carry made of a deleted own row in later open months with them), the
      // added rows, then the changed ones (only the columns changed here);
      // each delete and update only while the row still holds what it held.
      const fail = (what: string, e: { message: string } | null) => {
        if (e) throw new Error(`${what}: ${e.message}`);
      };
      const done = await writeOpenMonthSave({
        clientId: selectedClientId, userId: user?.id,
        deletes: { bills_not_in_2b: del2B, bills_not_in_books: delBooks },
        inserts: { bills_not_in_2b: plan2B.inserts, bills_not_in_books: planBooks.inserts },
        updates: { bills_not_in_2b: plan2B.updates, bills_not_in_books: planBooks.updates },
      });
      wrote = true;
      done.kept.forEach((m) => toast.info(m, { duration: 10000 }));
      if (done.laterCopies) toast.info(`Also removed ${done.laterCopies} carried-forward cop${done.laterCopies === 1 ? 'y' : 'ies'} in later months`);

      // The version records the month as the database now holds it (rows
      // others changed meanwhile included), not the page's copy.
      const [now2B, nowBooks] = await Promise.all([
        supabase.from('bills_not_in_2b').select('*').eq('client_id', selectedClientId).eq('period_month', selectedMonth).order('date'),
        supabase.from('bills_not_in_books').select('*').eq('client_id', selectedClientId).eq('period_month', selectedMonth).order('date'),
      ]);
      fail('Could not read the month back for its version', now2B.error || nowBooks.error);
      const savedBills2B = (now2B.data || []) as BillRecord[];
      const savedBillsBooks = (nowBooks.data || []) as BillRecord[];

      // Transform CURRENT (saved) data to version format for storage (with
      // what a Restore needs to put each entry back as it was; docs §15).
      const versionBills2B = versionRows2B(savedBills2B);
      const versionBillsBooks = versionRowsBooks(savedBillsBooks);

      // Save new version with CURRENT data (after this save operation)
      const versionData = {
        billsNotIn2B: versionBills2B,
        billsNotInBooks: versionBillsBooks,
      };

      // The next version number, read from the database just before the
      // version is written (verification round 5: the page's own list can be
      // behind the versions Import 2B's saves take meanwhile, and the Save
      // took a number already used). A version that cannot be written does
      // not fail the save (it is logged).
      let savedVersionNumber: number | null = null;
      try {
        const currentVersionNumber = await nextVersionNumber(selectedClientId, selectedMonth);
        // The earlier versions stop being current only now, once every write
        // above went through (a refused delete leaves them as they were).
        await supabase
          .from('twob_versions')
          .update({ is_current: false })
          .eq('client_id', selectedClientId)
          .eq('period_month', selectedMonth);

        const { error: versionError } = await supabase.from('twob_versions').insert([{
          client_id: selectedClientId,
          period_month: selectedMonth,
          table_type: 'combined',
          version_number: currentVersionNumber,
          version_data: versionData,
          updated_at: new Date().toISOString(),
          updated_by: user?.id || null,
          is_current: true,
          action_type: 'SAVE',
        }]);
        if (versionError) console.error('Error saving version:', versionError);
        else savedVersionNumber = currentVersionNumber;
      } catch (versionErr) {
        console.error('Error saving version:', versionErr);
      }

      // Refresh data from server (the edits and pending deletes with it)
      await fetchBillsData();
      await fetchVersions();
      
      if (savedVersionNumber) {
        toast.success(`Changes saved successfully. Version ${savedVersionNumber} created.`);
      } else {
        toast.success('Changes saved successfully');
      }
    } catch (error: any) {
      console.error('Error saving:', error);
      if (error instanceof OpenMonthSaveError ? !error.wrote : !wrote) {
        // Nothing reached the database: the edits and pending deletes stay
        // on the page (a row changed elsewhere raises the banner, with Reload).
        if (error?.stale) setLedgerChanged(true);
        toast.error(`${error?.stale ? error.message : `Failed to save: ${error.message}`} Nothing was saved; your changes are still on the page. ${error?.stale ? 'Reload to see the month as it is now (your changes are then discarded).' : 'Correct what is named and save again, or reload.'}`, { duration: 15000 });
        return;
      }
      // A failure part-way: the rows written before it stay, so the page
      // shows the month as it is now (what was not written is named).
      toast.error(error?.stale
        ? `${error.message} The rows saved before it stay saved; the rest of your changes were not saved. The page shows the month as it is now.`
        : `Failed to save: ${error.message} Rows saved before it stay saved; the page shows the month as it is now.`, { duration: 15000 });
      await fetchBillsData();
    } finally {
      endSave();
      setIsSaving(false);
    }
  };

  const handleUnlockSheet = async () => {
    if (!selectedClientId) return;
    
    try {
      await supabase
        .from('bills_not_in_2b')
        .update({ is_locked: false })
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth);
      
      await supabase
        .from('bills_not_in_books')
        .update({ is_locked: false })
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth);
      
      setIsLocked(false);
      toast.success('Sheet unlocked successfully');
    } catch (error: any) {
      toast.error('Failed to unlock: ' + error.message);
    }
  };


  const handleRestoreVersion = async (version: TwoBVersion) => {
    if (!selectedClientId || readOnly || !user?.id) return;
    // A filed month is never restored, and an open month only when no later
    // month holds entries (docs §13); the database checks both again.
    const blocked = restoreBlockedReason(monthState);
    if (blocked) { toast.error(blocked); return; }

    // The Restore's own writes, heard live, are the page's own, as a Save's
    // are (verification round 8: before, they read as someone else's change
    // and the superadmin was told the ledger "was changed elsewhere"): kept
    // while it runs and looked at again against the month as it reloads it.
    savingRef.current = true;
    try {
      // The month's two lists replaced by the version's in one call
      // (twob_restore_version): nothing is changed when it is refused, so the
      // month is never cleared or doubled halfway.
      // A version's rows are camelCase (old saves) or snake_case (Post, newer saves).
      type Cell = string | number | boolean | null;
      const pick = (b: Record<string, unknown>, camel: string, snake: string): Cell => {
        const v = b[camel] || b[snake];
        return (v ?? b[camel] ?? b[snake] ?? null) as Cell;   // a 0 stays 0
      };
      // The link to the Import 2B row that posted an entry (newer versions),
      // and the entry's own id (older ones: the database takes back the link
      // the month's entry of that id holds), so the next Import 2B save
      // changes the entry instead of adding a second one (docs §15).
      const objectOf = (v: unknown): Record<string, unknown> | null =>
        v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
      const common = (b: Record<string, unknown>): RestoreRow => ({
        id: pick(b, 'id', 'id'),
        adopted_from: objectOf(b.adoptedFrom ?? b.adopted_from),
        date: pick(b, 'date', 'date'),
        supplier_name: pick(b, 'supplierName', 'supplier_name'),
        supplier_invoice_number: pick(b, 'supplierInvoiceNumber', 'supplier_invoice_number'),
        supplier_gstin: pick(b, 'supplierGstin', 'supplier_gstin'),
        taxable_value: pick(b, 'taxableValue', 'taxable_value') ?? 0,
        input_igst: pick(b, 'inputIgst', 'input_igst') ?? 0,
        input_cgst: pick(b, 'inputCgst', 'input_cgst') ?? 0,
        input_sgst: pick(b, 'inputSgst', 'input_sgst') ?? 0,
        // null when the version does not say: the database then refuses the
        // restore rather than guess which entries were carried.
        is_carried_forward: typeof (b.isCarriedForward ?? b.is_carried_forward) === 'boolean'
          ? (b.isCarriedForward ?? b.is_carried_forward) as boolean : null,
      });
      const rows2B: RestoreRow[] = ((version.billsNotIn2B || []) as unknown as Record<string, unknown>[]).map((b) => ({
        ...common(b),
        reversal_month: pick(b, 'reversalMonth', 'reversal_month') || null,
        reclaim_month: pick(b, 'reclaimMonth', 'reclaim_month') || null,
        reclaim_subtype: pick(b, 'reclaimSubtype', 'reclaim_subtype') || null,
        reclaimed_via_doc_id: pick(b, 'reclaimedViaDocId', 'reclaimed_via_doc_id') || null,
        source_book_id: pick(b, 'sourceBookId', 'source_book_id') || null,
      }));
      const rowsBooks: RestoreRow[] = ((version.billsNotInBooks || []) as unknown as Record<string, unknown>[]).map((b) => ({
        ...common(b),
        book_entry_month: pick(b, 'bookEntryMonth', 'book_entry_month') || null,
        bill_in_2b_month: pick(b, 'billIn2BMonth', 'bill_in_2b_month') || null,
        source_doc_id: pick(b, 'sourceDocId', 'source_doc_id') || null,
      }));
      const restored = await restoreVersion(user.id, selectedClientId, selectedMonth, rows2B, rowsBooks);
      // The next version number for the RESTORE action, read from the
      // database (the page's own list can be behind; verification round 5).
      const newVersionNumber = await nextVersionNumber(selectedClientId, selectedMonth);

      // Mark all existing versions as not current, then record the RESTORE:
      // the month as the Restore left it (verification round 7: the version
      // restored was recorded, so its reclaims that came back in Awaiting
      // reclaim, and its entries left out, read as restored in the history).
      const versionData = restored.versionData;
      if (!versionData) {
        console.error('Restore: the month could not be read back for its RESTORE version');
      } else {
        await supabase.from('twob_versions').update({ is_current: false }).eq('client_id', selectedClientId).eq('period_month', selectedMonth);
        await supabase.from('twob_versions').insert([{
          client_id: selectedClientId,
          period_month: selectedMonth,
          table_type: 'combined',
          version_number: newVersionNumber,
          version_data: JSON.parse(JSON.stringify(versionData)) as Json,
          updated_at: new Date().toISOString(),
          updated_by: user?.id || null,
          is_current: true,
          action_type: 'RESTORE',
          restored_from_version_id: version.id,
        }]);
      }

      await fetchBillsData();
      await fetchVersions();
      setHasUnsavedChanges(false);
      toast.success(`Restored the month's own entries to version ${version.versionNumber}.${versionData ? ` New version ${newVersionNumber} created.` : ''}${restored.carriedKept
        ? ` Its ${restored.carriedKept} carried ${restored.carriedKept === 1 ? 'entry stays' : 'entries stay'} as ${restored.carriedKept === 1 ? 'it stands' : 'they stand'}: they follow the filed months, so a restore does not change them.`
        : ''}${restored.leftOut.length
        ? ` Left out, because this month now holds ${restored.leftOut.length === 1 ? 'it as a carried entry' : 'them as carried entries'}: ${restored.leftOut.slice(0, 5).join(', ')}${restored.leftOut.length > 5 ? ` and ${restored.leftOut.length - 5} more` : ''}.`
        : ''}${restored.linked
        ? ` ${restored.linked} ${restored.linked === 1 ? 'entry is' : 'entries are'} linked again to the Import 2B ${restored.linked === 1 ? 'row' : 'rows'} that post ${restored.linked === 1 ? 'it' : 'them'}: a change there changes ${restored.linked === 1 ? 'it' : 'them'}, never adds a second one; Import 2B says when the ledger is not in step with it.`
        : ''}${restored.reclaimsBack.length
        ? ` Restored in Awaiting reclaim, without the version's reclaim (a reclaim comes back only with its 2B document known for certain, in this month, Reclaim and evidencing no other reclaim; reclaim these again on Import 2B, Pending items, Link & Reclaim): ${restored.reclaimsBack.slice(0, 5).join('; ')}${restored.reclaimsBack.length > 5 ? `; and ${restored.reclaimsBack.length - 5} more` : ''}.`
        : ''}${restored.docsLeft.length
        ? ` Left in Reclaim, evidencing no reclaim, so counted nowhere (the Restore never changes a 2B document; on Import 2B, Link & Reclaim an entry with ${restored.docsLeft.length === 1 ? 'it' : 'each'} from Pending items, or take it out of Reclaim): ${restored.docsLeft.slice(0, 5).join('; ')}${restored.docsLeft.length > 5 ? `; and ${restored.docsLeft.length - 5} more` : ''}.`
        : ''}`, { duration: restored.reclaimsBack.length || restored.docsLeft.length ? 20000 : 10000 });
      setShowVersionHistory(false);
    } catch (error: any) {
      console.error('Error restoring version:', error);
      toast.error('Nothing was restored: ' + error.message);
    } finally {
      endSave();
    }
  };

  // Render editable input for table cells - FIXED: wider inputs for numbers
  // isCarriedForward parameter makes carried forward rows non-editable (except columns marked as editable)
  const renderEditableInput = (
    value: string | number | null,
    onChange: (value: any) => void,
    type: 'text' | 'number' | 'date' = 'text',
    className: string = '',
    isCarriedForward: boolean = false,
    isEditableForCF: boolean = false,
    maxDate?: string,
    followsTwoB: boolean = false
  ) => {
    // Carried forward rows are non-editable (display only) - except columns marked as editable for CF.
    // In a prior month a GST Manager / the superadmin corrects a carried entry's date, supplier,
    // number, GSTIN and amounts here too (each Save goes through the previewed door, docs §13),
    // except a Not in Books entry posted from a 2B document, which follows the filed 2B, and a carried
    // Not in Books copy of such an entry (followsTwoB; priorNibLockReason, twob_nib_2b_copies).
    const shouldBeReadOnly = followsTwoB || ledgerCellReadOnly({ readOnly, isCarriedForward, editableForCF: isEditableForCF, isSuperadmin, isPrior, canPriorBooks });
    
    if (shouldBeReadOnly) {
      if (type === 'date' && value) {
        return <span>{format(new Date(value as string), 'dd/MM/yyyy')}</span>;
      }
      if (type === 'number' && value !== null && value !== undefined) {
        return <span className="tabular-nums">{Number(value).toLocaleString('en-IN')}</span>;
      }
      return <span>{value ?? '-'}</span>;
    }
    
    return (
      <Input
        type={type}
        value={value ?? ''}
        onChange={(e) => {
          if (type === 'number') {
            const numVal = parseFloat(e.target.value) || 0;
            if (numVal < 0) {
              setNegativeValueError('Negative values are not allowed in this table.');
              // Auto-clear error after 3 seconds
              setTimeout(() => setNegativeValueError(null), 3000);
              return; // Don't update the value
            }
            onChange(numVal);
          } else {
            onChange(e.target.value);
          }
        }}
        min={type === 'number' ? 0 : undefined}
        step={type === 'number' ? 'any' : undefined}
        max={type === 'date' && maxDate ? maxDate : undefined}
        className={`h-7 px-2 text-xs md:text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${type === 'number' ? 'w-28 text-right tabular-nums' : ''} ${className}`}
      />
    );
  };

  // Render month dropdown for reversal/reclaim - with carried forward check
  // isEditableForCF allows editing certain columns (Reclaim, Book Entry, In 2B) even for carried forward rows
  // isReclaimColumn adds "Expense out" option
  const renderMonthDropdown = (
    value: string | null | undefined,
    onChange: (value: string) => void,
    placeholder: string,
    isCarriedForward: boolean = false,
    isEditableForCF: boolean = false,
    isReclaimColumn: boolean = false,
    reclaimSubtype?: string | null,
    onSubtypeChange?: (subtype: string | null) => void,
    priorEditable: boolean = false
  ) => {
    // Carried forward rows are non-editable - except columns marked as editable for CF (Reclaim, Book Entry, In 2B).
    // A prior month's months never change; only a row being added takes its reversal / in-2B month.
    const shouldBeReadOnly = readOnly || (isPrior && !priorEditable) || (isCarriedForward && !isEditableForCF && !isSuperadmin);
    
    if (shouldBeReadOnly) {
      const displayVal = value || '-';
      const suffix = reclaimSubtype === 'EXPENSE_OUT' ? ' (Expense out)' : '';
      return <span className="text-xs">{displayVal}{suffix}</span>;
    }

    return (
      <Select 
        value={
          isReclaimColumn && reclaimSubtype === 'EXPENSE_OUT' 
            ? '__expense_out__' 
            : (value || '__clear__')
        } 
        onValueChange={(val) => {
          if (val === '__clear__') {
            onChange('');
            if (onSubtypeChange) onSubtypeChange(null);
          } else if (val === '__expense_out__') {
            // Set reclaim_month to current selected month or keep existing, and mark as expense out
            if (!value || value.trim() === '') {
              // Set a placeholder month value so the entry is identifiable
              const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
              if (selectedMonth) {
                const [mStr, yStr] = selectedMonth.split('/');
                const yearShort = String(yStr).slice(-2);
                onChange(`${monthNames[parseInt(mStr) - 1]} ${yearShort}`);
              }
            }
            if (onSubtypeChange) onSubtypeChange('EXPENSE_OUT');
          } else {
            onChange(val);
            if (onSubtypeChange) onSubtypeChange(null); // Regular month = normal reclaim
          }
        }}
      >
        <SelectTrigger className="h-7 w-28 px-2 text-xs">
          {/*
            Override SelectValue's default rendering. Radix normally reflects
            the trigger text by looking up the current value in the SelectItem
            list — but on Jun-26+ we restrict the list to just [blank, current
            month, Expense out], so a legacy saved value like "May 26" has no
            matching SelectItem and the trigger falls back to the placeholder,
            making the cell look empty even though the DB still has the value.
            Computing the display text directly here decouples "what's shown"
            from "what's selectable", so historic values render correctly while
            the restriction still limits what the user can newly pick.
          */}
          <SelectValue placeholder={placeholder}>
            {isReclaimColumn && reclaimSubtype === 'EXPENSE_OUT'
              ? 'Expense out'
              : (value && value.trim() !== '' ? value : (placeholder || '-'))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__clear__">-</SelectItem>
          {isReclaimColumn && (
            <SelectItem value="__expense_out__" className="text-warning font-medium">
              Expense out
            </SelectItem>
          )}
          {isRestrictedPeriod || isPrior
            ? (currentPeriodMonthLabel && (
                <SelectItem value={currentPeriodMonthLabel}>{currentPeriodMonthLabel}</SelectItem>
              ))
            : reversalReclaimMonths.filter(m => m.value !== '__blank__').map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
        </SelectContent>
      </Select>
    );
  };


  // Body cell classes: a touch tighter when the cells hold inline editors.
  const tdCls = readOnly ? WS_TD : cn(WS_TD, 'px-1 py-0.5');
  const tdNumCls = readOnly ? WS_TD_NUM : cn(WS_TD_NUM, 'px-1 py-0.5');
  const cf2BCount = localBills2B.filter(r => r.is_carried_forward).length;
  const cfBooksCount = localBillsBooks.filter(r => r.is_carried_forward).length;

  return (
    <div className={WS_PAGE}>
      {/* Header */}
      <PageHeader
        compact
        embedded
        title="2B Reconciliation"
        subtitle={isLiberalClient ? 'Manage bills not available in 2B or Books' : 'Read-only ledger — managed via Import 2B'}
        icon={<FileSpreadsheet />}
        actions={
          <>
            {selectedClientId && canSaveHere && dirty && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void reloadMonth()}
                disabled={isSaving}
                title="Discard your unsaved changes here and load the month as it is now"
                className={WS_BTN}
              >
                Discard
              </Button>
            )}
            {selectedClientId && canSaveHere && (
              <Button
                size="sm"
                onClick={handleSaveAll}
                disabled={isSaving || !dirty || hasMandatoryFieldErrors}
                variant={dirty ? "default" : "outline"}
                title={hasMandatoryFieldErrors ? 'Fix mandatory field errors before saving' : ''}
                className={WS_BTN}
              >
                <Save className="h-3.5 w-3.5" />
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            )}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".xlsx,.xls"
              className="hidden"
            />
            {canImportExcel() && (
              <Button variant="outline" size="sm" className={WS_BTN} onClick={handleImportClick} disabled={readOnly || isPrior}
                title={isPrior ? `${PRIOR_MONTH_DOCS_MSG} Import Excel adds to open months only.` : undefined}>
                <Upload className="h-3.5 w-3.5" />
                Import Excel
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className={WS_BTN}
              onClick={handleExportExcel}
              disabled={!canExportData()}
              title={canExportData() ? undefined : 'Needs the Export data permission — ask a GST Manager to add it to your position'}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Export Excel
            </Button>
            {canClearData() && selectedClientId && (
              <Button variant="destructive" size="sm" onClick={() => setShowClearData(true)} className={WS_BTN}>
                <Trash2 className="h-3.5 w-3.5" />
                Clear Data
              </Button>
            )}
          </>
        }
      />

      {/* Filters: one labelled toolbar. */}
      <Card>
        <CardContent className="px-3 py-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="w-full min-w-0 space-y-0.5 sm:w-72">
              <span className={WS_FILTER_LABEL}>Client</span>
              <SearchableSelect
                options={clients.map(c => ({ value: c.id, label: c.name, sublabel: c.gstin }))}
                value={selectedClientId}
                onValueChange={setSelectedClientId}
                placeholder="Search Client..."
                searchPlaceholder="Type to search clients..."
                emptyText="No clients found."
                disabled={!isStaffRole() && clients.length <= 1}
                className={WS_CONTROL}
              />
            </label>
            <label className="w-40 min-w-0 space-y-0.5">
              <span className={WS_FILTER_LABEL}>Month</span>
              <SearchableMonthSelect
                options={monthOptions}
                value={selectedMonth}
                onValueChange={setSelectedMonth}
                placeholder="Select Month"
                className={WS_CONTROL}
              />
            </label>
            {canViewVersionHistory() && selectedClientId && (
              <Button
                variant="outline"
                size="sm"
                className={WS_BTN}
                onClick={() => setShowVersionHistory(true)}
              >
                <History className="h-3.5 w-3.5" />
                View Versions
              </Button>
            )}
            <ChangeHistoryButton page="twob_reco" clientId={selectedClientId} month={selectedMonth} />
            {/* Last saved audit label */}
            {lastSavedInfo && selectedClientId && (
              <p className="ml-auto self-center text-[11px] text-muted-foreground">
                Last {lastSavedInfo.actionType === 'RESTORE' ? 'restored' : 'saved'} by{' '}
                <span className="font-medium text-foreground">{lastSavedInfo.savedBy}</span>
                {lastSavedInfo.savedByRole && (
                  <span className="text-muted-foreground"> ({lastSavedInfo.savedByRole})</span>
                )}
                {' '}on {format(lastSavedInfo.savedAt, 'dd-MMM-yyyy HH:mm')} • v{lastSavedInfo.versionNumber}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {!selectedClientId ? (
        <Card>
          <CardContent className="p-6">
            <TableEmptyState
              icon={<AlertCircle className="h-5 w-5" />}
              title="No client selected"
              description="Please select a client to view 2B reconciliation data."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Headline tiles; the carried-forward tiles double as the "Show CF only" toggles. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            <TileButton active={!showOnlyCF2B} onClick={() => setShowOnlyCF2B(false)} title="Show every bill not in 2B">
              <KpiTile
                label="Not in 2B"
                value={filteredBills2B.length === localBills2B.length ? localBills2B.length : `${filteredBills2B.length} / ${localBills2B.length}`}
                hint={`ITC ${fmtINR(totals2B.igst + totals2B.cgst + totals2B.sgst)} · rev ${totals2B.reversalCount} · rec ${totals2B.reclaimCount}`}
                tone={localBills2B.length ? 'warn' : 'ok'}
              />
            </TileButton>
            <TileButton active={showOnlyCF2B} onClick={() => setShowOnlyCF2B(!showOnlyCF2B)} title={showOnlyCF2B ? 'Show all bills not in 2B' : 'Show carried-forward bills only'}>
              <KpiTile label="Not in 2B · carried forward" value={cf2BCount} hint="From earlier periods" />
            </TileButton>
            <TileButton active={!showOnlyCFBooks} onClick={() => setShowOnlyCFBooks(false)} title="Show every bill not in books">
              <KpiTile
                label="Not in Books"
                value={filteredBillsBooks.length === localBillsBooks.length ? localBillsBooks.length : `${filteredBillsBooks.length} / ${localBillsBooks.length}`}
                hint={`ITC ${fmtINR(totalsBooks.igst + totalsBooks.cgst + totalsBooks.sgst)} · booked ${totalsBooks.bookEntryCount} · in 2B ${totalsBooks.in2BCount}`}
                tone={localBillsBooks.length ? 'warn' : 'ok'}
              />
            </TileButton>
            <TileButton active={showOnlyCFBooks} onClick={() => setShowOnlyCFBooks(!showOnlyCFBooks)} title={showOnlyCFBooks ? 'Show all bills not in books' : 'Show carried-forward bills only'}>
              <KpiTile label="Not in Books · carried forward" value={cfBooksCount} hint="From earlier periods" />
            </TileButton>
            <KpiTile
              label="Sheet"
              value={isPrior ? 'Filed' : isLocked ? 'Locked' : isLiberalClient ? 'Liberal' : 'Strict'}
              hint={isPrior ? (canPriorBooks ? 'Books entries only · previewed' : 'Read-only') : isLocked ? 'Return filed — read-only' : isLiberalClient ? 'Directly editable' : 'Read-only · edit via Import 2B'}
              tone={isPrior || isLocked ? 'warn' : 'neutral'}
            />
          </div>

          {/* The ledger changed elsewhere while this page holds unsaved
              edits: they stay until saved or discarded (verification round 3). */}
          {ledgerChanged && (
            <Note tone="warn">
              <span>{LEDGER_CHANGED_BANNER}</span>
              <Button size="sm" variant="outline" className={cn(WS_BTN, 'ml-2 align-middle')} onClick={() => void reloadMonth()} disabled={isSaving}>
                Reload
              </Button>
            </Note>
          )}

          {/* Negative value error message */}
          {negativeValueError && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-foreground">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
              <span>{negativeValueError}</span>
            </div>
          )}

          {/* Strict mode — this client's entries only go through Import 2B */}
          {!isLiberalClient && (
            <Note>
              This sheet is read-only for {selectedClientData?.name}. Add invoices, classify 2B documents, and
              record reversals / reclaims / book entries on the <span className="font-medium">Import 2B</span> tab
              — changes post through here automatically. A superadmin or GST manager can switch this client to
              Liberal mode (directly editable) from Edit Client.
            </Note>
          )}

          {/* Prior month (docs §13) */}
          {isPrior && (
            <Note tone="warn">
              <span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" />
                {!canPriorBooks
                  ? PRIOR_MONTH_MSG
                  : isLiberalClient
                    ? 'This month is filed. You can change its books entries here: the date, supplier, number, GSTIN and amounts, add entries and delete them. Each change also reaches the later months that hold the entry, and you see what it changes before it is saved. The reversal, reclaim, book entry and in-2B months stay as filed, and so do Not in Books entries from 2B documents. A carried Not in Books entry changes in the month that holds it as its own entry, which reaches this copy.'
                    : 'This month is filed. You can delete its entries here; add or correct them through Import 2B\'s books register, whose saves reach this list by themselves. Each change also reaches the later months that hold the entry, and you see what it changes before it is saved.'}
              </span>
            </Note>
          )}

          {/* Lock indicator - No unlock button here, only on Filing Status page */}
          {!isPrior && isLocked && (
            <Note tone="warn">
              <span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" />
                {isSuperadmin
                  ? 'The return for this period has been filed. You can still edit as superadmin — changes do not reach the filed return.'
                  : 'This sheet is locked because the return has been filed.'}
              </span>
            </Note>
          )}

          {/* Table 1: Bills Not Available in 2B */}
          <Card>
            <CardHeader className="px-4 pb-2 pt-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <CardTitle className="text-[15px] leading-snug">Bills Not Available in 2B</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Client: {selectedClientData?.name} | Edit cells directly to modify data
                  </p>
                </div>
                <Button
                  variant={showOnlyCF2B ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowOnlyCF2B(!showOnlyCF2B)}
                  className={WS_BTN}
                >
                  <Filter className="h-3.5 w-3.5" />
                  {showOnlyCF2B ? "Show All" : "Show CF Only"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="relative max-h-[75vh] overflow-auto rounded-md border bg-card">
                <table className={TABLE_CLS}>
                  <thead>
                    <tr>
                      <th className={cn(WS_TH, 'w-28')}>
                        <div className="flex flex-col items-start gap-1">
                          <span>Date</span>
                          {!readOnly && (
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={handleAddRow2B}
                              className="h-6 w-6"
                              aria-label="Add row to Bills Not Available in 2B"
                              title="Add row"
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </th>
                      <th className={WS_TH}>Supplier Name</th>
                      <th className={cn(WS_TH, 'w-28')}>Invoice No.</th>
                      <th className={cn(WS_TH, 'w-36')}>GSTIN</th>
                      <th className={cn(WS_TH, 'text-right w-32')}>Taxable Value</th>
                      <th className={cn(WS_TH, 'text-right w-28')}>IGST</th>
                      <th className={cn(WS_TH, 'text-right w-28')}>CGST</th>
                      <th className={cn(WS_TH, 'text-right w-28')}>SGST</th>
                      <th className={cn(WS_TH, 'w-32')}>
                        <div className="flex flex-col items-start gap-1">
                          <span>Reversal</span>
                          <MultiSelectPopover
                            options={reversalReclaimMonths}
                            selectedValues={selectedReversalMonths}
                            onSelectionChange={setSelectedReversalMonths}
                            placeholder="Filter"
                            className="w-24"
                          />
                        </div>
                      </th>
                      <th className={cn(WS_TH, 'w-28')}>
                        <div className="flex flex-col items-start gap-1">
                          <span>Reclaim</span>
                          <MultiSelectPopover
                            options={reversalReclaimMonths}
                            selectedValues={selectedReclaimMonths}
                            onSelectionChange={setSelectedReclaimMonths}
                            placeholder="Filter"
                            className="w-24"
                          />
                        </div>
                      </th>
                      {canDeleteHere && <th className={cn(WS_TH, 'w-12')}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBills2B.map((row) => (
                      <tr key={row.id} className={cn(WS_TR, row.is_carried_forward && 'bg-info/10')}>
                        <td className={tdCls}>
                          {renderEditableInput(
                            row.date,
                            (val) => handleUpdate2BField(row.id, 'date', val),
                            'date',
                            '',
                            row.is_carried_forward || false,
                            false,
                            maxDateForReturnPeriod
                          )}
                        </td>
                        <td className={tdCls}>
                          <div className="flex items-center gap-2">
                            {renderEditableInput(
                              row.supplier_name,
                              (val) => handleUpdate2BField(row.id, 'supplier_name', val),
                              'text',
                              'min-w-[150px]',
                              row.is_carried_forward || false
                            )}
                            {row.is_carried_forward && (
                              <Badge variant="info" className="shrink-0 px-1.5 text-[10px] font-medium">CF</Badge>
                            )}
                          </div>
                        </td>
                        <td className={tdCls}>
                          {renderEditableInput(
                            row.supplier_invoice_number,
                            (val) => handleUpdate2BField(row.id, 'supplier_invoice_number', val),
                            'text',
                            '',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td className={tdCls}>
                          {renderEditableInput(
                            row.supplier_gstin,
                            (val) => handleUpdate2BField(row.id, 'supplier_gstin', val),
                            'text',
                            'font-mono text-xs',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td className={tdNumCls}>
                          {renderEditableInput(
                            row.taxable_value,
                            (val) => handleUpdate2BField(row.id, 'taxable_value', val),
                            'number',
                            'text-right',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td className={tdNumCls}>
                          {renderEditableInput(
                            row.input_igst,
                            (val) => handleUpdate2BField(row.id, 'input_igst', val),
                            'number',
                            'text-right',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td className={tdNumCls}>
                          {renderEditableInput(
                            row.input_cgst,
                            (val) => handleUpdate2BField(row.id, 'input_cgst', val),
                            'number',
                            'text-right',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td className={tdNumCls}>
                          {renderEditableInput(
                            row.input_sgst,
                            (val) => handleUpdate2BField(row.id, 'input_sgst', val),
                            'number',
                            'text-right',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td className={tdCls}>
                          {renderMonthDropdown(
                            row.reversal_month,
                            (val) => handleUpdate2BField(row.id, 'reversal_month', val || null),
                            'Rev',
                            row.is_carried_forward || false,
                            false,
                            false,
                            undefined,
                            undefined,
                            row.id.startsWith('temp-')
                          )}
                        </td>
                        <td className={tdCls}>
                          {renderMonthDropdown(
                            row.reclaim_month,
                            (val) => handleUpdate2BField(row.id, 'reclaim_month', val || null),
                            'Rec',
                            row.is_carried_forward || false,
                            true, // isEditableForCF - allow editing Reclaim column for carried forward rows
                            true, // isReclaimColumn - show Expense out option
                            (row as any).reclaim_subtype,
                            (subtype) => handleUpdate2BField(row.id, 'reclaim_subtype', subtype)
                          )}
                        </td>
                        {canDeleteHere && canDelete2BRows() && (!row.is_carried_forward || user?.role === 'superadmin' || user?.role === 'gst_manager') && (
                          <td className={tdCls}>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteRow2B(row.id)}
                              className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive-strong focus-visible:opacity-100 group-hover:opacity-100"
                              aria-label={row.is_carried_forward ? 'Delete carried forward row' : 'Delete row'}
                              title={row.is_carried_forward ? 'Delete carried forward row' : 'Delete row'}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        )}
                        {canDeleteHere && (!canDelete2BRows() || (row.is_carried_forward && user?.role !== 'superadmin' && user?.role !== 'gst_manager')) && <td className={WS_TD}></td>}
                      </tr>
                    ))}
                    {filteredBills2B.length === 0 && (
                      <TableEmptyState
                        colSpan={canDeleteHere ? 11 : 10}
                        icon={<Inbox className="h-5 w-5" />}
                        title={localBills2B.length === 0 ? 'No records found' : 'No matching records'}
                        description={localBills2B.length === 0
                          ? 'Click the + button below Date or use "Import Excel" to add data.'
                          : 'No records match the selected filters.'}
                      />
                    )}
                    {/* Totals Row */}
                    <tr className={cn(WS_TR_TOTAL, 'sticky bottom-0 z-10')}>
                      <td colSpan={4} className={cn(WS_TD, 'border-b-0 text-right')}>TOTAL</td>
                      <td className={cn(WS_TD_NUM, 'border-b-0')}>{totals2B.taxableValue.toLocaleString('en-IN')}</td>
                      <td className={cn(WS_TD_NUM, 'border-b-0')}>{totals2B.igst.toLocaleString('en-IN')}</td>
                      <td className={cn(WS_TD_NUM, 'border-b-0')}>{totals2B.cgst.toLocaleString('en-IN')}</td>
                      <td className={cn(WS_TD_NUM, 'border-b-0')}>{totals2B.sgst.toLocaleString('en-IN')}</td>
                      <td className={cn(WS_TD, 'border-b-0')}></td>
                      <td className={cn(WS_TD, 'border-b-0')}></td>
                      {canDeleteHere && <td className={cn(WS_TD, 'border-b-0')}></td>}
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Table 2: Bills Not Available in Books */}
          <Card>
            <CardHeader className="px-4 pb-2 pt-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <CardTitle className="text-[15px] leading-snug">Bills Not Available in Books</CardTitle>
                  <p className="text-xs text-muted-foreground">Edit cells directly to modify data</p>
                </div>
                <Button
                  variant={showOnlyCFBooks ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowOnlyCFBooks(!showOnlyCFBooks)}
                  className={WS_BTN}
                >
                  <Filter className="h-3.5 w-3.5" />
                  {showOnlyCFBooks ? "Show All" : "Show CF Only"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="relative max-h-[75vh] overflow-auto rounded-md border bg-card">
                <table className={TABLE_CLS}>
                  <thead>
                    <tr>
                      <th className={cn(WS_TH, 'w-28')}>
                        <div className="flex flex-col items-start gap-1">
                          <span>Date</span>
                          {!readOnly && (
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={handleAddRowBooks}
                              className="h-6 w-6"
                              aria-label="Add row to Bills Not Available in Books"
                              title="Add row"
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </th>
                      <th className={WS_TH}>Supplier Name</th>
                      <th className={cn(WS_TH, 'w-28')}>Invoice No.</th>
                      <th className={cn(WS_TH, 'w-36')}>GSTIN</th>
                      <th className={cn(WS_TH, 'text-right w-32')}>Taxable Value</th>
                      <th className={cn(WS_TH, 'text-right w-28')}>IGST</th>
                      <th className={cn(WS_TH, 'text-right w-28')}>CGST</th>
                      <th className={cn(WS_TH, 'text-right w-28')}>SGST</th>
                      <th className={cn(WS_TH, 'w-32')}>
                        <div className="flex flex-col items-start gap-1">
                          <span>Book Entry</span>
                          <MultiSelectPopover
                            options={reversalReclaimMonths}
                            selectedValues={selectedBookEntryMonths}
                            onSelectionChange={setSelectedBookEntryMonths}
                            placeholder="Filter"
                            className="w-24"
                          />
                        </div>
                      </th>
                      <th className={cn(WS_TH, 'w-28')}>
                        <div className="flex flex-col items-start gap-1">
                          <span>In 2B</span>
                          <MultiSelectPopover
                            options={reversalReclaimMonths}
                            selectedValues={selectedIn2BMonths}
                            onSelectionChange={setSelectedIn2BMonths}
                            placeholder="Filter"
                            className="w-24"
                          />
                        </div>
                      </th>
                      {canDeleteHere && <th className={cn(WS_TH, 'w-12')}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBillsBooks.map((row) => (
                      <tr key={row.id} className={cn(WS_TR, row.is_carried_forward && 'bg-info/10')}>
                        <td className={tdCls}>
                          {renderEditableInput(
                            row.date,
                            (val) => handleUpdateBooksField(row.id, 'date', val),
                            'date',
                            '',
                            row.is_carried_forward || false,
                            false,
                            maxDateForReturnPeriod,
                            !!priorNibLockReason(isPrior, row, nibFollows2B)
                          )}
                        </td>
                        <td className={tdCls}>
                          <div className="flex items-center gap-2">
                            {renderEditableInput(
                              row.supplier_name,
                              (val) => handleUpdateBooksField(row.id, 'supplier_name', val),
                              'text',
                              'min-w-[150px]',
                              row.is_carried_forward || false,
                              false,
                              undefined,
                              !!priorNibLockReason(isPrior, row, nibFollows2B)
                            )}
                            {row.is_carried_forward && (
                              <Badge variant="info" className="shrink-0 px-1.5 text-[10px] font-medium">CF</Badge>
                            )}
                          </div>
                        </td>
                        <td className={tdCls}>
                          {renderEditableInput(
                            row.supplier_invoice_number,
                            (val) => handleUpdateBooksField(row.id, 'supplier_invoice_number', val),
                            'text',
                            '',
                            row.is_carried_forward || false,
                            false,
                            undefined,
                            !!priorNibLockReason(isPrior, row, nibFollows2B)
                          )}
                        </td>
                        <td className={tdCls}>
                          {renderEditableInput(
                            row.supplier_gstin,
                            (val) => handleUpdateBooksField(row.id, 'supplier_gstin', val),
                            'text',
                            'font-mono text-xs',
                            row.is_carried_forward || false,
                            false,
                            undefined,
                            !!priorNibLockReason(isPrior, row, nibFollows2B)
                          )}
                        </td>
                        <td className={tdNumCls}>
                          {renderEditableInput(
                            row.taxable_value,
                            (val) => handleUpdateBooksField(row.id, 'taxable_value', val),
                            'number',
                            'text-right',
                            row.is_carried_forward || false,
                            false,
                            undefined,
                            !!priorNibLockReason(isPrior, row, nibFollows2B)
                          )}
                        </td>
                        <td className={tdNumCls}>
                          {renderEditableInput(
                            row.input_igst,
                            (val) => handleUpdateBooksField(row.id, 'input_igst', val),
                            'number',
                            'text-right',
                            row.is_carried_forward || false,
                            false,
                            undefined,
                            !!priorNibLockReason(isPrior, row, nibFollows2B)
                          )}
                        </td>
                        <td className={tdNumCls}>
                          {renderEditableInput(
                            row.input_cgst,
                            (val) => handleUpdateBooksField(row.id, 'input_cgst', val),
                            'number',
                            'text-right',
                            row.is_carried_forward || false,
                            false,
                            undefined,
                            !!priorNibLockReason(isPrior, row, nibFollows2B)
                          )}
                        </td>
                        <td className={tdNumCls}>
                          {renderEditableInput(
                            row.input_sgst,
                            (val) => handleUpdateBooksField(row.id, 'input_sgst', val),
                            'number',
                            'text-right',
                            row.is_carried_forward || false,
                            false,
                            undefined,
                            !!priorNibLockReason(isPrior, row, nibFollows2B)
                          )}
                        </td>
                        <td className={tdCls}>
                          {renderMonthDropdown(
                            row.book_entry_month,
                            (val) => handleUpdateBooksField(row.id, 'book_entry_month', val || null),
                            'Entry',
                            row.is_carried_forward || false,
                            true // isEditableForCF - allow editing Book Entry column for carried forward rows
                          )}
                        </td>
                        <td className={tdCls}>
                          {renderMonthDropdown(
                            row.bill_in_2b_month,
                            (val) => handleUpdateBooksField(row.id, 'bill_in_2b_month', val || null),
                            'In 2B',
                            row.is_carried_forward || false,
                            true, // isEditableForCF - allow editing In 2B column for carried forward rows
                            false,
                            undefined,
                            undefined,
                            row.id.startsWith('temp-')
                          )}
                        </td>
                        {canDeleteHere && canDelete2BRows() && (!row.is_carried_forward || user?.role === 'superadmin' || user?.role === 'gst_manager') && !priorNibLockReason(isPrior, row, nibFollows2B) && (
                          <td className={tdCls}>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteRowBooks(row.id)}
                              className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive-strong focus-visible:opacity-100 group-hover:opacity-100"
                              aria-label={row.is_carried_forward ? 'Delete carried forward row' : 'Delete row'}
                              title={row.is_carried_forward ? 'Delete carried forward row' : 'Delete row'}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        )}
                        {canDeleteHere && (!canDelete2BRows() || (row.is_carried_forward && user?.role !== 'superadmin' && user?.role !== 'gst_manager')) && <td className={WS_TD}></td>}
                        {canDeleteHere && canDelete2BRows() && (!row.is_carried_forward || user?.role === 'superadmin' || user?.role === 'gst_manager') && !!priorNibLockReason(isPrior, row, nibFollows2B) && (
                          <td className={WS_TD} title={priorNibLockReason(isPrior, row, nibFollows2B) || undefined}></td>
                        )}
                      </tr>
                    ))}
                    {filteredBillsBooks.length === 0 && (
                      <TableEmptyState
                        colSpan={canDeleteHere ? 11 : 10}
                        icon={<Inbox className="h-5 w-5" />}
                        title={localBillsBooks.length === 0 ? 'No records found' : 'No matching records'}
                        description={localBillsBooks.length === 0
                          ? 'Click the + button below Date or use "Import Excel" to add data.'
                          : 'No records match the selected filters.'}
                      />
                    )}
                    {/* Totals Row */}
                    <tr className={cn(WS_TR_TOTAL, 'sticky bottom-0 z-10')}>
                      <td colSpan={4} className={cn(WS_TD, 'border-b-0 text-right')}>TOTAL</td>
                      <td className={cn(WS_TD_NUM, 'border-b-0')}>{totalsBooks.taxableValue.toLocaleString('en-IN')}</td>
                      <td className={cn(WS_TD_NUM, 'border-b-0')}>{totalsBooks.igst.toLocaleString('en-IN')}</td>
                      <td className={cn(WS_TD_NUM, 'border-b-0')}>{totalsBooks.cgst.toLocaleString('en-IN')}</td>
                      <td className={cn(WS_TD_NUM, 'border-b-0')}>{totalsBooks.sgst.toLocaleString('en-IN')}</td>
                      <td className={cn(WS_TD, 'border-b-0')}></td>
                      <td className={cn(WS_TD, 'border-b-0')}></td>
                      {canDeleteHere && <td className={cn(WS_TD, 'border-b-0')}></td>}
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

        </>
      )}

      {/* Version History Dialog */}
      <VersionHistoryDialog
        open={showVersionHistory}
        onOpenChange={setShowVersionHistory}
        versions={versions}
        onRestore={handleRestoreVersion}
        restoreBlockedReason={restoreBlockedReason(monthState)}
        onVersionDeleted={fetchVersions}
        clientName={selectedClientData?.name || ''}
        month={selectedMonth}
      />
      
      {/* Clear Data Dialog */}
      {selectedClientId && selectedClientData && (
        <ClearDataDialog
          open={showClearData && canClearData()}
          onOpenChange={setShowClearData}
          module="2B Reconciliation"
          clientId={selectedClientId}
          clientName={selectedClientData.name}
          onCleared={fetchBillsData}
        />
      )}
    </div>
  );
};

export default TwoBReconciliationPage;
