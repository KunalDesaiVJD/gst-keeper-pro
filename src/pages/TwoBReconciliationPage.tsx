import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { MultiSelectPopover } from '@/components/ui/multi-select-popover';
import {
  FileSpreadsheet,
  History,
  AlertCircle,
  Lock,
  Trash2,
  Filter,
  Inbox,
  Info,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import ClearDataDialog from '@/components/dialogs/ClearDataDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { export2BToExcel } from '@/utils/excelExport';
import VersionHistoryDialog from '@/components/dialogs/VersionHistoryDialog';
import { TwoBVersion, BillNotIn2B, BillNotInBooks, isQuarterEndMonth } from '@/types';
import { supabase } from '@/integrations/supabase/client';

// This sheet is READ-ONLY. Entries, reversals, reclaims and book-entry
// decisions are all made on Import 2B (twob_import_docs / books_register),
// which writes through to bills_not_in_2b / bills_not_in_books here — see
// src/lib/postImport2B.ts. This page is display + export + version audit only.

interface Client {
  id: string;
  name: string;
  gstin: string;
  registration_date?: string;
  registration_type?: string;
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
  is_locked: boolean | null;
  is_carried_forward: boolean | null;
  version: number | null;
  updated_at: string | null;
  updated_by: string | null;
}

interface LastSavedInfo {
  savedBy: string;
  savedByRole: string;
  savedAt: Date;
  versionNumber: number;
  actionType: 'SAVE' | 'RESTORE';
}

const TwoBReconciliationPage: React.FC = () => {
  const { canViewVersionHistory, user, isStaffRole } = useAuth();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [billsNotIn2B, setBillsNotIn2B] = useState<BillRecord[]>([]);
  const [billsNotInBooks, setBillsNotInBooks] = useState<BillRecord[]>([]);
  const [isLocked, setIsLocked] = useState(false);
  const [versions, setVersions] = useState<TwoBVersion[]>([]);
  const [lastSavedInfo, setLastSavedInfo] = useState<LastSavedInfo | null>(null);
  const [showClearData, setShowClearData] = useState(false);

  // Multi-select filter states
  const [selectedReversalMonths, setSelectedReversalMonths] = useState<string[]>([]);
  const [selectedReclaimMonths, setSelectedReclaimMonths] = useState<string[]>([]);
  const [selectedBookEntryMonths, setSelectedBookEntryMonths] = useState<string[]>([]);
  const [selectedIn2BMonths, setSelectedIn2BMonths] = useState<string[]>([]);

  // CF filter states - to filter only carried-forward records
  const [showOnlyCF2B, setShowOnlyCF2B] = useState(false);
  const [showOnlyCFBooks, setShowOnlyCFBooks] = useState(false);

  const selectedClientData = clients.find(c => c.id === selectedClientId);

  // Check if client requires quarterly months only (IFF or Composition)
  const isQuarterlyClient = selectedClientData?.registration_type === 'IFF' || selectedClientData?.registration_type === 'Composition';

  // Generate month options dynamically - filtered by selected client's registration date and quarterly logic
  const generateMonthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    const maxFutureMonths = 2;

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

    return months.sort((a, b) => {
      const [aM, aY] = a.value.split('/').map(Number);
      const [bM, bY] = b.value.split('/').map(Number);
      return bY * 12 + bM - (aY * 12 + aM);
    });
  }, [clients, selectedClientId, isQuarterlyClient]);

  const monthOptions = generateMonthOptions;

  // Filter dropdown options for Reversal / Reclaim / Book Entry / In 2B — full
  // historical list (Apr 2024 → +2 months) so old saved values remain
  // filterable even though new values only ever land on the current period.
  const reversalReclaimMonths = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const startDate = new Date(2024, 3, 1);
    const now = new Date();
    const endDate = new Date(now.getFullYear(), now.getMonth() + 2, 1);

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const yearShort = String(currentDate.getFullYear()).slice(-2);
      const value = `${monthNames[currentDate.getMonth()]} ${yearShort}`;
      options.push({ value, label: value });
      currentDate.setMonth(currentDate.getMonth() + 1);
    }

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
      .select('id, name, gstin, registration_date, registration_type')
      .order('name');

    if (user && !isStaffRole()) {
      query = query.eq('id', user.id);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching clients:', error);
      return;
    }
    setClients(data || []);

    if (!isStaffRole() && data && data.length > 0 && !selectedClientId) {
      setSelectedClientId(data[0].id);
    }
  }, [user, isStaffRole, selectedClientId, setSelectedClientId]);

  // Fetch bills data
  const fetchBillsData = useCallback(async () => {
    if (!selectedClientId || !selectedMonth) return;

    let lockState = false;

    const { data: notIn2B, error: error2B } = await supabase
      .from('bills_not_in_2b')
      .select('*')
      .eq('client_id', selectedClientId)
      .eq('period_month', selectedMonth)
      .order('date');

    if (error2B) {
      console.error('Error fetching bills not in 2B:', error2B);
    } else {
      setBillsNotIn2B(notIn2B || []);
      if (notIn2B && notIn2B.length > 0 && notIn2B[0].is_locked) {
        lockState = true;
      }
    }

    const { data: notInBooks, error: errorBooks } = await supabase
      .from('bills_not_in_books')
      .select('*')
      .eq('client_id', selectedClientId)
      .eq('period_month', selectedMonth)
      .order('date');

    if (errorBooks) {
      console.error('Error fetching bills not in books:', errorBooks);
    } else {
      setBillsNotInBooks(notInBooks || []);
      if (notInBooks && notInBooks.length > 0 && notInBooks[0].is_locked) {
        lockState = true;
      }
    }

    const { data: filingData } = await supabase
      .from('filing_status')
      .select('is_locked')
      .eq('client_id', selectedClientId)
      .eq('period_month', selectedMonth)
      .in('return_type', ['GSTR-3B', 'GSTR-3B (Q)'])
      .eq('status', 'Filed')
      .maybeSingle();

    if (filingData?.is_locked) {
      lockState = true;
    }

    setIsLocked(lockState);
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
      setBillsNotIn2B([]);
      setBillsNotInBooks([]);
      setIsLocked(false);
      setVersions([]);
      setLastSavedInfo(null);
    }
  }, [selectedClientId, selectedMonth, fetchBillsData, fetchVersions]);

  useEffect(() => {
    if (!selectedClientId) return;

    const channel = supabase
      .channel('2b-reconciliation-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bills_not_in_2b',
        filter: `client_id=eq.${selectedClientId}`
      }, () => {
        fetchBillsData();
        toast.info('2B data updated — posted from Import 2B');
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bills_not_in_books',
        filter: `client_id=eq.${selectedClientId}`
      }, () => {
        fetchBillsData();
        toast.info('2B data updated — posted from Import 2B');
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedClientId, fetchBillsData]);

  // Filter bills based on selected months (with support for "Blank" filter)
  const filteredBills2B = useMemo(() => {
    return billsNotIn2B.filter(row => {
      if (showOnlyCF2B && !row.is_carried_forward) {
        return false;
      }
      if (selectedReversalMonths.length > 0) {
        const hasBlankFilter = selectedReversalMonths.includes('__blank__');
        const otherFilters = selectedReversalMonths.filter(m => m !== '__blank__');

        const matchesBlank = hasBlankFilter && (!row.reversal_month || row.reversal_month.trim() === '');
        const matchesMonth = otherFilters.length > 0 && row.reversal_month && otherFilters.includes(row.reversal_month);

        if (!matchesBlank && !matchesMonth) {
          return false;
        }
      }
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
  }, [billsNotIn2B, selectedReversalMonths, selectedReclaimMonths, showOnlyCF2B]);

  const filteredBillsBooks = useMemo(() => {
    return billsNotInBooks.filter(row => {
      if (showOnlyCFBooks && !row.is_carried_forward) {
        return false;
      }
      if (selectedBookEntryMonths.length > 0) {
        const hasBlankFilter = selectedBookEntryMonths.includes('__blank__');
        const otherFilters = selectedBookEntryMonths.filter(m => m !== '__blank__');

        const matchesBlank = hasBlankFilter && (!row.book_entry_month || row.book_entry_month.trim() === '');
        const matchesMonth = otherFilters.length > 0 && row.book_entry_month && otherFilters.includes(row.book_entry_month);

        if (!matchesBlank && !matchesMonth) {
          return false;
        }
      }
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
  }, [billsNotInBooks, selectedBookEntryMonths, selectedIn2BMonths, showOnlyCFBooks]);

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
    if (!selectedClientData) {
      toast.error('Please select a client first');
      return;
    }

    const exportData2B: BillNotIn2B[] = billsNotIn2B.map(b => ({
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

    const exportDataBooks: BillNotInBooks[] = billsNotInBooks.map(b => ({
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

  const handleRestoreVersion = async (version: TwoBVersion) => {
    if (!selectedClientId) return;

    try {
      const newVersionNumber = versions.length > 0 ? Math.max(...versions.map(v => v.versionNumber)) + 1 : 1;

      await supabase.from('twob_versions').update({ is_current: false }).eq('client_id', selectedClientId).eq('period_month', selectedMonth);

      await supabase.from('bills_not_in_2b').delete().eq('client_id', selectedClientId).eq('period_month', selectedMonth);
      await supabase.from('bills_not_in_books').delete().eq('client_id', selectedClientId).eq('period_month', selectedMonth);

      if (version.billsNotIn2B && version.billsNotIn2B.length > 0) {
        const records2B = version.billsNotIn2B.map((b: any) => ({
          client_id: selectedClientId,
          date: b.date,
          supplier_name: b.supplierName || b.supplier_name,
          supplier_invoice_number: b.supplierInvoiceNumber || b.supplier_invoice_number,
          supplier_gstin: b.supplierGstin || b.supplier_gstin,
          taxable_value: b.taxableValue ?? b.taxable_value ?? 0,
          input_igst: b.inputIgst ?? b.input_igst ?? 0,
          input_cgst: b.inputCgst ?? b.input_cgst ?? 0,
          input_sgst: b.inputSgst ?? b.input_sgst ?? 0,
          period_month: selectedMonth,
          reversal_month: b.reversalMonth || b.reversal_month || null,
          reclaim_month: b.reclaimMonth || b.reclaim_month || null,
          is_carried_forward: b.isCarriedForward ?? b.is_carried_forward ?? false,
        }));
        await supabase.from('bills_not_in_2b').insert(records2B);
      }

      if (version.billsNotInBooks && version.billsNotInBooks.length > 0) {
        const recordsBooks = version.billsNotInBooks.map((b: any) => ({
          client_id: selectedClientId,
          date: b.date,
          supplier_name: b.supplierName || b.supplier_name,
          supplier_invoice_number: b.supplierInvoiceNumber || b.supplier_invoice_number,
          supplier_gstin: b.supplierGstin || b.supplier_gstin,
          taxable_value: b.taxableValue ?? b.taxable_value ?? 0,
          input_igst: b.inputIgst ?? b.input_igst ?? 0,
          input_cgst: b.inputCgst ?? b.input_cgst ?? 0,
          input_sgst: b.inputSgst ?? b.input_sgst ?? 0,
          period_month: selectedMonth,
          book_entry_month: b.bookEntryMonth || b.book_entry_month || null,
          bill_in_2b_month: b.billIn2BMonth || b.bill_in_2b_month || null,
          is_carried_forward: b.isCarriedForward ?? b.is_carried_forward ?? false,
        }));
        await supabase.from('bills_not_in_books').insert(recordsBooks);
      }

      const versionData = {
        billsNotIn2B: version.billsNotIn2B || [],
        billsNotInBooks: version.billsNotInBooks || [],
      };

      await supabase.from('twob_versions').insert([{
        client_id: selectedClientId,
        period_month: selectedMonth,
        table_type: 'combined',
        version_number: newVersionNumber,
        version_data: JSON.parse(JSON.stringify(versionData)),
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
        is_current: true,
        action_type: 'RESTORE',
        restored_from_version_id: version.id,
      }]);

      // Restored rows aren't linked back to a specific Import 2B staging row
      // (source_book_id/source_doc_id), so the next Post to Reconciliation
      // won't retract or duplicate them — they behave like legacy manual rows.
      await fetchBillsData();
      await fetchVersions();
      toast.success(`Restored to version ${version.versionNumber}. New version ${newVersionNumber} created.`);
      setShowVersionHistory(false);
    } catch (error: any) {
      console.error('Error restoring version:', error);
      toast.error('Failed to restore: ' + error.message);
    }
  };

  // Read-only cell rendering — this sheet no longer accepts direct edits.
  const renderCell = (value: string | number | null, type: 'text' | 'number' | 'date' = 'text') => {
    if (type === 'date' && value) {
      return <span>{format(new Date(value as string), 'dd/MM/yyyy')}</span>;
    }
    if (type === 'number') {
      return <span className="font-mono tabular-nums">{Number(value || 0).toLocaleString('en-IN')}</span>;
    }
    return <span>{value ?? '-'}</span>;
  };

  const renderMonthCell = (value: string | null | undefined, reclaimSubtype?: string | null) => {
    const suffix = reclaimSubtype === 'EXPENSE_OUT' ? ' (Expense out)' : '';
    return <span className="text-sm">{value || '-'}{suffix}</span>;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <PageHeader
        embedded
        title="2B Reconciliation"
        subtitle="Read-only ledger — managed via Import 2B"
        actions={
          <>
            <Button variant="outline" className="flex items-center gap-2" onClick={handleExportExcel}>
              <FileSpreadsheet className="h-4 w-4" />
              Export Excel
            </Button>
            {(user?.role === 'superadmin' || user?.role === 'gst_manager') && selectedClientId && (
              <Button variant="destructive" size="sm" onClick={() => setShowClearData(true)} className="gap-2">
                <Trash2 className="h-4 w-4" />
                Clear Data
              </Button>
            )}
          </>
        }
      />

      {/* Last posted audit label */}
      {lastSavedInfo && selectedClientId && (
        <p className="-mt-4 text-xs text-muted-foreground">
          Last {lastSavedInfo.actionType === 'RESTORE' ? 'restored' : 'posted'} by{' '}
          <span className="font-medium text-foreground">{lastSavedInfo.savedBy}</span>
          {lastSavedInfo.savedByRole && (
            <span className="text-muted-foreground"> ({lastSavedInfo.savedByRole})</span>
          )}
          {' '}on {format(lastSavedInfo.savedAt, 'dd-MMM-yyyy HH:mm')} • v{lastSavedInfo.versionNumber}
        </p>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 max-w-xs">
              <SearchableSelect
                options={clients.map(c => ({ value: c.id, label: c.name, sublabel: c.gstin }))}
                value={selectedClientId}
                onValueChange={setSelectedClientId}
                placeholder="Search Client..."
                searchPlaceholder="Type to search clients..."
                emptyText="No clients found."
                disabled={!isStaffRole() && clients.length <= 1}
              />
            </div>
            <div className="w-48">
              <SearchableMonthSelect
                options={monthOptions}
                value={selectedMonth}
                onValueChange={setSelectedMonth}
                placeholder="Select Month"
              />
            </div>
            {canViewVersionHistory() && selectedClientId && (
              <Button
                variant="outline"
                className="flex items-center gap-2"
                onClick={() => setShowVersionHistory(true)}
              >
                <History className="h-4 w-4" />
                View Versions
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!selectedClientId ? (
        <Card>
          <CardContent className="p-12">
            <TableEmptyState
              icon={<AlertCircle className="h-6 w-6" />}
              title="No client selected"
              description="Please select a client to view 2B reconciliation data."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 p-3 text-info">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="text-sm">
              This sheet is read-only. Add invoices, classify 2B documents, and record reversals / reclaims / book
              entries on the <span className="font-medium">Import 2B</span> tab — changes post through here automatically.
            </span>
          </div>

          {isLocked && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 flex items-center gap-2 text-warning">
              <Lock className="h-4 w-4" />
              <span className="text-sm">This sheet is locked because the return has been filed.</span>
            </div>
          )}

          {/* Table 1: Bills Not Available in 2B */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Bills Not Available in 2B</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Client: {selectedClientData?.name} | Booked, not (yet) in 2B — posted from Import 2B
                  </p>
                </div>
                <Button
                  variant={showOnlyCF2B ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowOnlyCF2B(!showOnlyCF2B)}
                  className="gap-1"
                >
                  <Filter className="h-3 w-3" />
                  {showOnlyCF2B ? "Show All" : "Show CF Only"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto max-h-[75vh] relative" style={{ overflowX: 'auto', overflowY: 'auto' }}>
                <table className="gst-table">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="w-28">Date</th>
                      <th>Supplier Name</th>
                      <th className="w-28">Invoice No.</th>
                      <th className="w-36">GSTIN</th>
                      <th className="text-right w-32">Taxable Value</th>
                      <th className="text-right w-28">IGST</th>
                      <th className="text-right w-28">CGST</th>
                      <th className="text-right w-28">SGST</th>
                      <th className="w-32">
                        <div className="flex flex-col items-center gap-1">
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
                      <th className="w-28">
                        <div className="flex flex-col items-center gap-1">
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
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBills2B.map((row) => (
                      <tr key={row.id} className={row.is_carried_forward ? 'bg-info/10' : ''}>
                        <td>{renderCell(row.date, 'date')}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            {renderCell(row.supplier_name, 'text')}
                            {row.is_carried_forward && (
                              <Badge variant="outline" className="text-xs shrink-0">CF</Badge>
                            )}
                          </div>
                        </td>
                        <td>{renderCell(row.supplier_invoice_number, 'text')}</td>
                        <td className="font-mono text-xs">{renderCell(row.supplier_gstin, 'text')}</td>
                        <td className="text-right">{renderCell(row.taxable_value, 'number')}</td>
                        <td className="text-right">{renderCell(row.input_igst, 'number')}</td>
                        <td className="text-right">{renderCell(row.input_cgst, 'number')}</td>
                        <td className="text-right">{renderCell(row.input_sgst, 'number')}</td>
                        <td>{renderMonthCell(row.reversal_month)}</td>
                        <td>{renderMonthCell(row.reclaim_month, row.reclaim_subtype)}</td>
                      </tr>
                    ))}
                    {filteredBills2B.length === 0 && (
                      <TableEmptyState
                        colSpan={10}
                        icon={<Inbox className="h-6 w-6" />}
                        title={billsNotIn2B.length === 0 ? 'No records found' : 'No matching records'}
                        description={billsNotIn2B.length === 0
                          ? 'Nothing posted yet — classify books invoices as "Not in 2B" on Import 2B, then Post to Reconciliation.'
                          : 'No records match the selected filters.'}
                      />
                    )}
                    {/* Totals Row */}
                    <tr className="bg-muted/50 font-semibold">
                      <td colSpan={4} className="text-right">TOTAL</td>
                      <td className="text-right tabular-nums">{totals2B.taxableValue.toLocaleString('en-IN')}</td>
                      <td className="text-right tabular-nums">{totals2B.igst.toLocaleString('en-IN')}</td>
                      <td className="text-right tabular-nums">{totals2B.cgst.toLocaleString('en-IN')}</td>
                      <td className="text-right tabular-nums">{totals2B.sgst.toLocaleString('en-IN')}</td>
                      <td></td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Table 2: Bills Not Available in Books */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Bills Not Available in Books</CardTitle>
                  <p className="text-sm text-muted-foreground">In 2B, not yet booked — posted from Import 2B</p>
                </div>
                <Button
                  variant={showOnlyCFBooks ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowOnlyCFBooks(!showOnlyCFBooks)}
                  className="gap-1"
                >
                  <Filter className="h-3 w-3" />
                  {showOnlyCFBooks ? "Show All" : "Show CF Only"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto max-h-[75vh] relative" style={{ overflowX: 'auto', overflowY: 'auto' }}>
                <table className="gst-table">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="w-28">Date</th>
                      <th>Supplier Name</th>
                      <th className="w-28">Invoice No.</th>
                      <th className="w-36">GSTIN</th>
                      <th className="text-right w-32">Taxable Value</th>
                      <th className="text-right w-28">IGST</th>
                      <th className="text-right w-28">CGST</th>
                      <th className="text-right w-28">SGST</th>
                      <th className="w-32">
                        <div className="flex flex-col items-center gap-1">
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
                      <th className="w-28">
                        <div className="flex flex-col items-center gap-1">
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
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBillsBooks.map((row) => (
                      <tr key={row.id} className={row.is_carried_forward ? 'bg-info/10' : ''}>
                        <td>{renderCell(row.date, 'date')}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            {renderCell(row.supplier_name, 'text')}
                            {row.is_carried_forward && (
                              <Badge variant="outline" className="text-xs shrink-0">CF</Badge>
                            )}
                          </div>
                        </td>
                        <td>{renderCell(row.supplier_invoice_number, 'text')}</td>
                        <td className="font-mono text-xs">{renderCell(row.supplier_gstin, 'text')}</td>
                        <td className="text-right">{renderCell(row.taxable_value, 'number')}</td>
                        <td className="text-right">{renderCell(row.input_igst, 'number')}</td>
                        <td className="text-right">{renderCell(row.input_cgst, 'number')}</td>
                        <td className="text-right">{renderCell(row.input_sgst, 'number')}</td>
                        <td>{renderMonthCell(row.book_entry_month)}</td>
                        <td>{renderMonthCell(row.bill_in_2b_month)}</td>
                      </tr>
                    ))}
                    {filteredBillsBooks.length === 0 && (
                      <TableEmptyState
                        colSpan={10}
                        icon={<Inbox className="h-6 w-6" />}
                        title={billsNotInBooks.length === 0 ? 'No records found' : 'No matching records'}
                        description={billsNotInBooks.length === 0
                          ? 'Nothing posted yet — classify 2B documents as "Not in Books" on Import 2B, then Post to Reconciliation.'
                          : 'No records match the selected filters.'}
                      />
                    )}
                    {/* Totals Row */}
                    <tr className="bg-muted/50 font-semibold">
                      <td colSpan={4} className="text-right">TOTAL</td>
                      <td className="text-right tabular-nums">{totalsBooks.taxableValue.toLocaleString('en-IN')}</td>
                      <td className="text-right tabular-nums">{totalsBooks.igst.toLocaleString('en-IN')}</td>
                      <td className="text-right tabular-nums">{totalsBooks.cgst.toLocaleString('en-IN')}</td>
                      <td className="text-right tabular-nums">{totalsBooks.sgst.toLocaleString('en-IN')}</td>
                      <td></td>
                      <td></td>
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
        onVersionDeleted={fetchVersions}
        clientName={selectedClientData?.name || ''}
        month={selectedMonth}
      />

      {/* Clear Data Dialog */}
      {selectedClientId && selectedClientData && (
        <ClearDataDialog
          open={showClearData}
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
