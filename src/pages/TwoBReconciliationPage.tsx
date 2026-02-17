import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { MultiSelectPopover } from '@/components/ui/multi-select-popover';
import { 
  Upload, 
  Download, 
  History,
  AlertCircle,
  Lock,
  Trash2,
  Plus,
  Save,
  Filter
} from 'lucide-react';
import ClearDataDialog from '@/components/dialogs/ClearDataDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { export2BToExcel, import2BFromExcel } from '@/utils/excelExport';
import VersionHistoryDialog from '@/components/dialogs/VersionHistoryDialog';
import { TwoBVersion, BillNotIn2B, isQuarterEndMonth } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

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

// Audit info for last saved
interface LastSavedInfo {
  savedBy: string;
  savedByRole: string;
  savedAt: Date;
  versionNumber: number;
  actionType: 'SAVE' | 'RESTORE';
}

const TwoBReconciliationPage: React.FC = () => {
  const { canViewVersionHistory, canUnlockSheets, canDelete2BRows, user, isStaffRole } = useAuth();
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
  const [isLocked, setIsLocked] = useState(false);
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
      .select('id, name, gstin, registration_date, registration_type')
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

  // Fetch bills data
  const fetchBillsData = useCallback(async () => {
    if (!selectedClientId || !selectedMonth) return;

    // Reset lock state first
    let lockState = false;

    // Fetch bills not in 2B
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
      setLocalBills2B(notIn2B || []);
      if (notIn2B && notIn2B.length > 0 && notIn2B[0].is_locked) {
        lockState = true;
      }
    }

    // Fetch bills not in books
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
      setLocalBillsBooks(notInBooks || []);
      if (notInBooks && notInBooks.length > 0 && notInBooks[0].is_locked) {
        lockState = true;
      }
    }

    // Check filing status for lock (GSTR-3B Filed)
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

    // Set the final lock state
    setIsLocked(lockState);
    setHasUnsavedChanges(false);
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
      setBillsNotIn2B([]);
      setBillsNotInBooks([]);
      setLocalBills2B([]);
      setLocalBillsBooks([]);
      setIsLocked(false);
      setHasUnsavedChanges(false);
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
        toast.info('2B data updated by another user');
      })
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'bills_not_in_books',
        filter: `client_id=eq.${selectedClientId}`
      }, () => {
        fetchBillsData();
        toast.info('2B data updated by another user');
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedClientId, fetchBillsData]);

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
    
    export2BToExcel(selectedClientData.name, selectedMonth, exportData2B, []);
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

    if (isLocked) {
      toast.error('Cannot import - sheet is locked');
      return;
    }

    try {
      const data = await import2BFromExcel(file);
      
      // Insert bills not in 2B
      if (data.billsNotIn2B.length > 0) {
        const records = data.billsNotIn2B.map(b => ({
          client_id: selectedClientId,
          date: b.date.toISOString().split('T')[0],
          supplier_name: b.supplierName,
          supplier_invoice_number: b.supplierInvoiceNumber,
          supplier_gstin: b.supplierGstin,
          taxable_value: b.taxableValue,
          input_igst: b.inputIgst,
          input_cgst: b.inputCgst,
          input_sgst: b.inputSgst,
          period_month: selectedMonth,
          reversal_month: b.reversalMonth,
          reclaim_month: b.reclaimMonth || null,
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
          date: b.date.toISOString().split('T')[0],
          supplier_name: b.supplierName,
          supplier_invoice_number: b.supplierInvoiceNumber,
          supplier_gstin: b.supplierGstin,
          taxable_value: b.taxableValue,
          input_igst: b.inputIgst,
          input_cgst: b.inputCgst,
          input_sgst: b.inputSgst,
          period_month: selectedMonth,
          book_entry_month: b.bookEntryMonth || null,
          bill_in_2b_month: b.billIn2BMonth || null,
        }));
        
        const { error } = await supabase
          .from('bills_not_in_books')
          .insert(records);
        
        if (error) throw error;
      }
      
      toast.success(`Imported ${data.billsNotIn2B.length} records to "Bills Not in 2B" and ${data.billsNotInBooks.length} to "Bills Not in Books"`);
      fetchBillsData();
    } catch (error: any) {
      console.error('Import error:', error);
      toast.error('Failed to import: ' + error.message);
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Local editing handlers for Bills Not in 2B (update local state only)
  // With CGST/SGST auto-sync
  const handleUpdate2BField = (id: string, field: string, value: any) => {
    if (isLocked) return;
    
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
    setHasUnsavedChanges(true);
  };

  // Local editing handlers for Bills Not in Books (update local state only)
  // With CGST/SGST auto-sync
  const handleUpdateBooksField = (id: string, field: string, value: any) => {
    if (isLocked) return;
    
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
    setHasUnsavedChanges(true);
  };

  // Mark rows for deletion (local only)
  const [deletedRows2B, setDeletedRows2B] = useState<string[]>([]);
  const [deletedRowsBooks, setDeletedRowsBooks] = useState<string[]>([]);

  const handleDeleteRow2B = (id: string) => {
    if (isLocked) return;
    setLocalBills2B(prev => prev.filter(b => b.id !== id));
    // Track for actual deletion on save
    if (billsNotIn2B.find(b => b.id === id)) {
      setDeletedRows2B(prev => [...prev, id]);
    }
    setHasUnsavedChanges(true);
  };

  const handleDeleteRowBooks = (id: string) => {
    if (isLocked) return;
    setLocalBillsBooks(prev => prev.filter(b => b.id !== id));
    // Track for actual deletion on save
    if (billsNotInBooks.find(b => b.id === id)) {
      setDeletedRowsBooks(prev => [...prev, id]);
    }
    setHasUnsavedChanges(true);
  };

  // Add new row handlers (local only with temp ID)
  const handleAddRow2B = () => {
    if (!selectedClientId || isLocked) return;
    
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
    setHasUnsavedChanges(true);
  };

  const handleAddRowBooks = () => {
    if (!selectedClientId || isLocked) return;
    
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
    setHasUnsavedChanges(true);
  };

  // Validation for mandatory fields
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    localBills2B.forEach((b, idx) => {
      if (b.is_carried_forward) return; // Skip CF rows
      const rowNum = idx + 1;
      if (!b.date) errors.push(`Bills Not in 2B - Row ${rowNum}: Date is required`);
      if (!b.supplier_name || b.supplier_name.trim() === '') errors.push(`Bills Not in 2B - Row ${rowNum}: Supplier Name is required`);
      if (!b.supplier_invoice_number || b.supplier_invoice_number.trim() === '') errors.push(`Bills Not in 2B - Row ${rowNum}: Invoice No. is required`);
      if (!b.supplier_gstin || b.supplier_gstin.trim() === '') errors.push(`Bills Not in 2B - Row ${rowNum}: GSTIN is required`);
    });
    localBillsBooks.forEach((b, idx) => {
      if (b.is_carried_forward) return;
      const rowNum = idx + 1;
      if (!b.date) errors.push(`Bills Not in Books - Row ${rowNum}: Date is required`);
      if (!b.supplier_name || b.supplier_name.trim() === '') errors.push(`Bills Not in Books - Row ${rowNum}: Supplier Name is required`);
      if (!b.supplier_invoice_number || b.supplier_invoice_number.trim() === '') errors.push(`Bills Not in Books - Row ${rowNum}: Invoice No. is required`);
      if (!b.supplier_gstin || b.supplier_gstin.trim() === '') errors.push(`Bills Not in Books - Row ${rowNum}: GSTIN is required`);
    });
    return errors;
  }, [localBills2B, localBillsBooks]);

  const hasMandatoryFieldErrors = validationErrors.length > 0;

  // Save all changes to database
  const handleSaveAll = async () => {
    if (!selectedClientId || isLocked) return;
    
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
    
    setIsSaving(true);
    try {
      // Get next version number
      const currentVersionNumber = versions.length > 0 ? Math.max(...versions.map(v => v.versionNumber)) + 1 : 1;
      
      // Mark all existing versions as not current
      await supabase
        .from('twob_versions')
        .update({ is_current: false })
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth);

      // First, apply database changes (inserts/updates/deletes)
      // Delete removed rows
      if (deletedRows2B.length > 0) {
        await supabase.from('bills_not_in_2b').delete().in('id', deletedRows2B);
      }
      if (deletedRowsBooks.length > 0) {
        await supabase.from('bills_not_in_books').delete().in('id', deletedRowsBooks);
      }

      // Process bills not in 2B
      const savedBills2B: BillRecord[] = [];
      for (const bill of localBills2B) {
        if (bill.id.startsWith('temp-')) {
          // Insert new record
          const { id, ...billData } = bill;
          const { data: inserted } = await supabase.from('bills_not_in_2b').insert([billData]).select().single();
          if (inserted) {
            savedBills2B.push(inserted);
          } else {
            savedBills2B.push(bill);
          }
        } else {
          // Update existing record
          const original = billsNotIn2B.find(b => b.id === bill.id);
          if (original && JSON.stringify(original) !== JSON.stringify(bill)) {
            const { id, ...updates } = bill;
            await supabase
              .from('bills_not_in_2b')
              .update({ ...updates, updated_at: new Date().toISOString() })
              .eq('id', id);
          }
          savedBills2B.push(bill);
        }
      }

      // Process bills not in books
      const savedBillsBooks: BillRecord[] = [];
      for (const bill of localBillsBooks) {
        if (bill.id.startsWith('temp-')) {
          // Insert new record
          const { id, ...billData } = bill;
          const { data: inserted } = await supabase.from('bills_not_in_books').insert([billData]).select().single();
          if (inserted) {
            savedBillsBooks.push(inserted);
          } else {
            savedBillsBooks.push(bill);
          }
        } else {
          // Update existing record
          const original = billsNotInBooks.find(b => b.id === bill.id);
          if (original && JSON.stringify(original) !== JSON.stringify(bill)) {
            const { id, ...updates } = bill;
            await supabase
              .from('bills_not_in_books')
              .update({ ...updates, updated_at: new Date().toISOString() })
              .eq('id', id);
          }
          savedBillsBooks.push(bill);
        }
      }

      // Transform CURRENT (saved) data to version format for storage
      const versionBills2B = savedBills2B.map(b => ({
        id: b.id,
        clientId: b.client_id,
        date: b.date,
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
        updatedAt: b.updated_at || new Date().toISOString(),
        version: b.version || 1,
      }));
      
      const versionBillsBooks = savedBillsBooks.map(b => ({
        id: b.id,
        clientId: b.client_id,
        date: b.date,
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
        updatedAt: b.updated_at || new Date().toISOString(),
        version: b.version || 1,
      }));
      
      // Save new version with CURRENT data (after this save operation)
      const versionData = {
        billsNotIn2B: versionBills2B,
        billsNotInBooks: versionBillsBooks,
      };
      
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
      
      let savedVersionNumber: number | null = null;
      if (versionError) {
        console.error('Error saving version:', versionError);
        // Don't fail the save, just log the error
      } else {
        savedVersionNumber = currentVersionNumber;
      }

      // Reset tracking
      setDeletedRows2B([]);
      setDeletedRowsBooks([]);
      setHasUnsavedChanges(false);
      
      // Refresh data from server
      await fetchBillsData();
      await fetchVersions();
      
      if (savedVersionNumber) {
        toast.success(`Changes saved successfully. Version ${savedVersionNumber} created.`);
      } else {
        toast.success('Changes saved successfully');
      }
    } catch (error: any) {
      console.error('Error saving:', error);
      toast.error('Failed to save: ' + error.message);
    } finally {
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
    if (!selectedClientId || isLocked) return;
    
    try {
      // Get next version number for the RESTORE action
      const newVersionNumber = versions.length > 0 ? Math.max(...versions.map(v => v.versionNumber)) + 1 : 1;
      
      // Mark all existing versions as not current
      await supabase.from('twob_versions').update({ is_current: false }).eq('client_id', selectedClientId).eq('period_month', selectedMonth);
      
      // Delete current records
      await supabase.from('bills_not_in_2b').delete().eq('client_id', selectedClientId).eq('period_month', selectedMonth);
      await supabase.from('bills_not_in_books').delete().eq('client_id', selectedClientId).eq('period_month', selectedMonth);
      
      // Restore bills not in 2B from version (handle both camelCase and snake_case)
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
      
      // Restore bills not in books from version (handle both camelCase and snake_case)
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
      
      // Create a new RESTORE version entry with the restored data
      const versionData = {
        billsNotIn2B: version.billsNotIn2B || [],
        billsNotInBooks: version.billsNotInBooks || [],
      };
      
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
      
      await fetchBillsData();
      await fetchVersions();
      setHasUnsavedChanges(false);
      toast.success(`Restored to version ${version.versionNumber}. New version ${newVersionNumber} created.`);
      setShowVersionHistory(false);
    } catch (error: any) {
      console.error('Error restoring version:', error);
      toast.error('Failed to restore: ' + error.message);
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
    maxDate?: string
  ) => {
    // Carried forward rows are non-editable (display only) - except columns marked as editable for CF
    const shouldBeReadOnly = isLocked || (isCarriedForward && !isEditableForCF);
    
    if (shouldBeReadOnly) {
      if (type === 'date' && value) {
        return <span>{format(new Date(value as string), 'dd/MM/yyyy')}</span>;
      }
      if (type === 'number' && value !== null && value !== undefined) {
        return <span className="font-mono">{Number(value).toLocaleString('en-IN')}</span>;
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
        max={type === 'date' && maxDate ? maxDate : undefined}
        className={`h-8 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${type === 'number' ? 'w-28 text-right font-mono' : ''} ${className}`}
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
    onSubtypeChange?: (subtype: string | null) => void
  ) => {
    // Carried forward rows are non-editable - except columns marked as editable for CF (Reclaim, Book Entry, In 2B)
    const shouldBeReadOnly = isLocked || (isCarriedForward && !isEditableForCF);
    
    if (shouldBeReadOnly) {
      const displayVal = value || '-';
      const suffix = reclaimSubtype === 'EXPENSE_OUT' ? ' (Expense out)' : '';
      return <span className="text-sm">{displayVal}{suffix}</span>;
    }

    // Build options: months + "Expense out" for reclaim column
    const expenseOutValue = '__expense_out__';
    
    return (
      <div className="flex flex-col gap-0.5">
        <Select 
          value={value || '__clear__'} 
          onValueChange={(val) => {
            if (val === '__clear__') {
              onChange('');
              if (onSubtypeChange) onSubtypeChange(null);
            } else {
              onChange(val);
              // Keep existing subtype when changing month
            }
          }}
        >
          <SelectTrigger className="h-8 text-sm w-24">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__clear__">-</SelectItem>
            {reversalReclaimMonths.filter(m => m.value !== '__blank__').map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isReclaimColumn && value && value.trim() !== '' && (
          <Select
            value={reclaimSubtype || 'NORMAL'}
            onValueChange={(val) => {
              if (onSubtypeChange) onSubtypeChange(val === 'NORMAL' ? null : val);
            }}
          >
            <SelectTrigger className="h-6 text-xs w-24 border-dashed">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NORMAL">Reclaim</SelectItem>
              <SelectItem value="EXPENSE_OUT">Expense out</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
    );
  };


  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">2B Reconciliation</h1>
          <p className="text-muted-foreground">Manage bills not available in 2B or Books</p>
          {/* Last saved audit label */}
          {lastSavedInfo && selectedClientId && (
            <p className="text-xs text-muted-foreground mt-1">
              Last {lastSavedInfo.actionType === 'RESTORE' ? 'restored' : 'saved'} by{' '}
              <span className="font-medium text-foreground">{lastSavedInfo.savedBy}</span>
              {lastSavedInfo.savedByRole && (
                <span className="text-muted-foreground"> ({lastSavedInfo.savedByRole})</span>
              )}
              {' '}on {format(lastSavedInfo.savedAt, 'dd-MMM-yyyy HH:mm')} • v{lastSavedInfo.versionNumber}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedClientId && !isLocked && (
            <Button 
              onClick={handleSaveAll} 
              disabled={isSaving || !hasUnsavedChanges || hasMandatoryFieldErrors}
              variant={hasUnsavedChanges ? "default" : "outline"}
              title={hasMandatoryFieldErrors ? 'Fix mandatory field errors before saving' : ''}
              className="flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
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
          <Button variant="outline" className="flex items-center gap-2" onClick={handleImportClick} disabled={isLocked}>
            <Upload className="h-4 w-4" />
            Import Excel
          </Button>
          <Button variant="outline" className="flex items-center gap-2" onClick={handleExportExcel}>
            <Download className="h-4 w-4" />
            Export Excel
          </Button>
          {(user?.role === 'superadmin' || user?.role === 'gst_manager') && selectedClientId && (
            <Button variant="destructive" size="sm" onClick={() => setShowClearData(true)} className="gap-2">
              <Trash2 className="h-4 w-4" />
              Clear Data
            </Button>
          )}
        </div>
      </div>

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
          <CardContent className="p-12 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Please select a client to view 2B reconciliation data.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Negative value error message */}
          {negativeValueError && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{negativeValueError}</span>
            </div>
          )}

          {/* Lock indicator - No unlock button here, only on Filing Status page */}
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
                    Client: {selectedClientData?.name} | Edit cells directly to modify data
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
                      <th className="w-28">
                        <div className="flex flex-col items-center gap-1">
                          <span>Date</span>
                          {!isLocked && (
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={handleAddRow2B}
                              className="h-6 w-6 p-0"
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </th>
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
                      {!isLocked && <th className="w-12"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBills2B.map((row) => (
                      <tr key={row.id} className={row.is_carried_forward ? 'bg-blue-50 dark:bg-blue-950/20' : ''}>
                        <td>
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
                        <td>
                          <div className="flex items-center gap-2">
                            {renderEditableInput(
                              row.supplier_name,
                              (val) => handleUpdate2BField(row.id, 'supplier_name', val),
                              'text',
                              'min-w-[150px]',
                              row.is_carried_forward || false
                            )}
                            {row.is_carried_forward && (
                              <Badge variant="outline" className="text-xs shrink-0">CF</Badge>
                            )}
                          </div>
                        </td>
                        <td>
                          {renderEditableInput(
                            row.supplier_invoice_number,
                            (val) => handleUpdate2BField(row.id, 'supplier_invoice_number', val),
                            'text',
                            '',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td>
                          {renderEditableInput(
                            row.supplier_gstin,
                            (val) => handleUpdate2BField(row.id, 'supplier_gstin', val),
                            'text',
                            'font-mono text-xs',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td className="text-right">
                          {renderEditableInput(
                            row.taxable_value,
                            (val) => handleUpdate2BField(row.id, 'taxable_value', val),
                            'number',
                            'text-right',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td className="text-right">
                          {renderEditableInput(
                            row.input_igst,
                            (val) => handleUpdate2BField(row.id, 'input_igst', val),
                            'number',
                            'text-right',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td className="text-right">
                          {renderEditableInput(
                            row.input_cgst,
                            (val) => handleUpdate2BField(row.id, 'input_cgst', val),
                            'number',
                            'text-right',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td className="text-right">
                          {renderEditableInput(
                            row.input_sgst,
                            (val) => handleUpdate2BField(row.id, 'input_sgst', val),
                            'number',
                            'text-right',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td>
                          {renderMonthDropdown(
                            row.reversal_month,
                            (val) => handleUpdate2BField(row.id, 'reversal_month', val || null),
                            'Rev',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td>
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
                        {!isLocked && canDelete2BRows() && (!row.is_carried_forward || user?.role === 'superadmin' || user?.role === 'gst_manager') && (
                          <td>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => handleDeleteRow2B(row.id)}
                              className="h-7 w-7 p-0 text-destructive"
                              title={row.is_carried_forward ? 'Delete carried forward row' : 'Delete row'}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </td>
                        )}
                        {!isLocked && (!canDelete2BRows() || (row.is_carried_forward && user?.role !== 'superadmin' && user?.role !== 'gst_manager')) && <td></td>}
                      </tr>
                    ))}
                    {filteredBills2B.length === 0 && (
                      <tr>
                        <td colSpan={isLocked ? 10 : 11} className="text-center py-8 text-muted-foreground">
                          {localBills2B.length === 0 
                            ? 'No records found. Click + button below Date or use "Import Excel" to add data.'
                            : 'No records match the selected filters.'}
                        </td>
                      </tr>
                    )}
                    {/* Totals Row */}
                    <tr className="bg-muted/50 font-semibold">
                      <td colSpan={4} className="text-right">TOTAL</td>
                      <td className="text-right">{totals2B.taxableValue.toLocaleString('en-IN')}</td>
                      <td className="text-right">{totals2B.igst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{totals2B.cgst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{totals2B.sgst.toLocaleString('en-IN')}</td>
                      <td></td>
                      <td></td>
                      {!isLocked && <td></td>}
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
                  <p className="text-sm text-muted-foreground">Edit cells directly to modify data</p>
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
                      <th className="w-28">
                        <div className="flex flex-col items-center gap-1">
                          <span>Date</span>
                          {!isLocked && (
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={handleAddRowBooks}
                              className="h-6 w-6 p-0"
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </th>
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
                      {!isLocked && <th className="w-12"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBillsBooks.map((row) => (
                      <tr key={row.id} className={row.is_carried_forward ? 'bg-blue-50 dark:bg-blue-950/20' : ''}>
                        <td>
                          {renderEditableInput(
                            row.date,
                            (val) => handleUpdateBooksField(row.id, 'date', val),
                            'date',
                            '',
                            row.is_carried_forward || false,
                            false,
                            maxDateForReturnPeriod
                          )}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            {renderEditableInput(
                              row.supplier_name,
                              (val) => handleUpdateBooksField(row.id, 'supplier_name', val),
                              'text',
                              'min-w-[150px]',
                              row.is_carried_forward || false
                            )}
                            {row.is_carried_forward && (
                              <Badge variant="outline" className="text-xs shrink-0">CF</Badge>
                            )}
                          </div>
                        </td>
                        <td>
                          {renderEditableInput(
                            row.supplier_invoice_number,
                            (val) => handleUpdateBooksField(row.id, 'supplier_invoice_number', val),
                            'text',
                            '',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td>
                          {renderEditableInput(
                            row.supplier_gstin,
                            (val) => handleUpdateBooksField(row.id, 'supplier_gstin', val),
                            'text',
                            'font-mono text-xs',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td className="text-right">
                          {renderEditableInput(
                            row.taxable_value,
                            (val) => handleUpdateBooksField(row.id, 'taxable_value', val),
                            'number',
                            'text-right',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td className="text-right">
                          {renderEditableInput(
                            row.input_igst,
                            (val) => handleUpdateBooksField(row.id, 'input_igst', val),
                            'number',
                            'text-right',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td className="text-right">
                          {renderEditableInput(
                            row.input_cgst,
                            (val) => handleUpdateBooksField(row.id, 'input_cgst', val),
                            'number',
                            'text-right',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td className="text-right">
                          {renderEditableInput(
                            row.input_sgst,
                            (val) => handleUpdateBooksField(row.id, 'input_sgst', val),
                            'number',
                            'text-right',
                            row.is_carried_forward || false
                          )}
                        </td>
                        <td>
                          {renderMonthDropdown(
                            row.book_entry_month,
                            (val) => handleUpdateBooksField(row.id, 'book_entry_month', val || null),
                            'Entry',
                            row.is_carried_forward || false,
                            true // isEditableForCF - allow editing Book Entry column for carried forward rows
                          )}
                        </td>
                        <td>
                          {renderMonthDropdown(
                            row.bill_in_2b_month,
                            (val) => handleUpdateBooksField(row.id, 'bill_in_2b_month', val || null),
                            'In 2B',
                            row.is_carried_forward || false,
                            true // isEditableForCF - allow editing In 2B column for carried forward rows
                          )}
                        </td>
                        {!isLocked && canDelete2BRows() && (!row.is_carried_forward || user?.role === 'superadmin' || user?.role === 'gst_manager') && (
                          <td>
                            <Button 
                              variant="ghost"
                              size="sm" 
                              onClick={() => handleDeleteRowBooks(row.id)}
                              className="h-7 w-7 p-0 text-destructive"
                              title={row.is_carried_forward ? 'Delete carried forward row' : 'Delete row'}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </td>
                        )}
                        {!isLocked && (!canDelete2BRows() || (row.is_carried_forward && user?.role !== 'superadmin' && user?.role !== 'gst_manager')) && <td></td>}
                      </tr>
                    ))}
                    {filteredBillsBooks.length === 0 && (
                      <tr>
                        <td colSpan={isLocked ? 10 : 11} className="text-center py-8 text-muted-foreground">
                          {localBillsBooks.length === 0 
                            ? 'No records found. Click + button below Date or use "Import Excel" to add data.'
                            : 'No records match the selected filters.'}
                        </td>
                      </tr>
                    )}
                    {/* Totals Row */}
                    <tr className="bg-muted/50 font-semibold">
                      <td colSpan={4} className="text-right">TOTAL</td>
                      <td className="text-right">{totalsBooks.taxableValue.toLocaleString('en-IN')}</td>
                      <td className="text-right">{totalsBooks.igst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{totalsBooks.cgst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{totalsBooks.sgst.toLocaleString('en-IN')}</td>
                      <td></td>
                      <td></td>
                      {!isLocked && <td></td>}
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
