import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { MultiSelectPopover } from '@/components/ui/multi-select-popover';
import { 
  Upload, 
  Download, 
  History,
  Unlock,
  AlertCircle,
  Lock,
  Trash2,
  Plus,
  Save,
  Filter
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { export2BToExcel, import2BFromExcel } from '@/utils/excelExport';
import VersionHistoryDialog from '@/components/dialogs/VersionHistoryDialog';
import { TwoBVersion, BillNotIn2B } from '@/types';
import { supabase } from '@/integrations/supabase/client';

interface Client {
  id: string;
  name: string;
  gstin: string;
  registration_date?: string;
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
  book_entry_month?: string | null;
  bill_in_2b_month?: string | null;
  is_locked: boolean | null;
  is_carried_forward: boolean | null;
  version: number | null;
  updated_at: string | null;
  updated_by: string | null;
}

const TwoBReconciliationPage: React.FC = () => {
  const { canViewVersionHistory, canUnlockSheets, user, isStaffRole } = useAuth();
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>('01/2026');
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Multi-select filter states
  const [selectedReversalMonths, setSelectedReversalMonths] = useState<string[]>([]);
  const [selectedReclaimMonths, setSelectedReclaimMonths] = useState<string[]>([]);
  const [selectedBookEntryMonths, setSelectedBookEntryMonths] = useState<string[]>([]);
  const [selectedIn2BMonths, setSelectedIn2BMonths] = useState<string[]>([]);

  const selectedClientData = clients.find(c => c.id === selectedClient);

  // Generate month options dynamically - filtered by selected client's registration date
  const generateMonthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    
    // Find registration date from selected client
    const client = clients.find(c => c.id === selectedClient);
    let startDate = new Date(now.getFullYear(), now.getMonth() - 12, 1); // Default: 12 months ago
    
    if (client?.registration_date) {
      const regDate = new Date(client.registration_date);
      startDate = new Date(regDate.getFullYear(), regDate.getMonth(), 1);
    }
    
    // Generate months from start date to 12 months in future
    const futureLimit = new Date(now.getFullYear(), now.getMonth() + 12, 1);
    let currentDate = new Date(startDate);
    
    while (currentDate <= futureLimit) {
      const value = `${String(currentDate.getMonth() + 1).padStart(2, '0')}/${currentDate.getFullYear()}`;
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
  }, [clients, selectedClient]);

  const monthOptions = generateMonthOptions;

  // Generate month dropdown options for reversal/reclaim
  const shortMonthOptions = () => {
    const options: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = -6; i <= 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const yearShort = String(date.getFullYear()).slice(-2);
      const value = `${monthNames[date.getMonth()]} ${yearShort}`;
      options.push({ value, label: value });
    }
    return options.sort((a, b) => {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const parseDate = (s: string) => {
        const [m, y] = s.split(' ');
        return (2000 + parseInt(y)) * 12 + monthNames.indexOf(m);
      };
      return parseDate(b.value) - parseDate(a.value);
    });
  };

  const reversalReclaimMonths = shortMonthOptions();

  // Fetch clients - filtered for client role
  const fetchClients = useCallback(async () => {
    let query = supabase
      .from('clients')
      .select('id, name, gstin, registration_date')
      .order('name');
    
    // If user is a client, only fetch their own data
    if (user && !isStaffRole()) {
      // Client users should only see their own client record
      query = query.eq('client_user_id', user.userId);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching clients:', error);
      return;
    }
    setClients(data || []);
    
    // Auto-select if client user and only one client
    if (!isStaffRole() && data && data.length === 1) {
      setSelectedClient(data[0].id);
    }
  }, [user, isStaffRole]);

  // Fetch bills data
  const fetchBillsData = useCallback(async () => {
    if (!selectedClient || !selectedMonth) return;

    // Fetch bills not in 2B
    const { data: notIn2B, error: error2B } = await supabase
      .from('bills_not_in_2b')
      .select('*')
      .eq('client_id', selectedClient)
      .eq('period_month', selectedMonth)
      .order('date');
    
    if (error2B) {
      console.error('Error fetching bills not in 2B:', error2B);
    } else {
      setBillsNotIn2B(notIn2B || []);
      setLocalBills2B(notIn2B || []);
      if (notIn2B && notIn2B.length > 0) {
        setIsLocked(notIn2B[0].is_locked || false);
      }
    }

    // Fetch bills not in books
    const { data: notInBooks, error: errorBooks } = await supabase
      .from('bills_not_in_books')
      .select('*')
      .eq('client_id', selectedClient)
      .eq('period_month', selectedMonth)
      .order('date');
    
    if (errorBooks) {
      console.error('Error fetching bills not in books:', errorBooks);
    } else {
      setBillsNotInBooks(notInBooks || []);
      setLocalBillsBooks(notInBooks || []);
      if (notInBooks && notInBooks.length > 0 && !isLocked) {
        setIsLocked(notInBooks[0].is_locked || false);
      }
    }

    // Check filing status for lock
    const { data: filingData } = await supabase
      .from('filing_status')
      .select('is_locked')
      .eq('client_id', selectedClient)
      .eq('period_month', selectedMonth)
      .eq('status', 'Filed')
      .maybeSingle();
    
    if (filingData?.is_locked) {
      setIsLocked(true);
    }

    setHasUnsavedChanges(false);
  }, [selectedClient, selectedMonth]);

  // Fetch version history
  const fetchVersions = useCallback(async () => {
    if (!selectedClient || !selectedMonth) {
      setVersions([]);
      return;
    }

    const { data, error } = await supabase
      .from('twob_versions')
      .select('*')
      .eq('client_id', selectedClient)
      .eq('period_month', selectedMonth)
      .order('version_number', { ascending: false });

    if (error) {
      console.error('Error fetching versions:', error);
      return;
    }

    if (data && data.length > 0) {
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
        updatedBy: v.updated_by || 'Unknown',
        updatedAt: new Date(v.updated_at || Date.now()),
        isCurrent: v.is_current || false,
      }));
      setVersions(formattedVersions);
    } else {
      setVersions([]);
    }
  }, [selectedClient, selectedMonth]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  useEffect(() => {
    if (selectedClient && selectedMonth) {
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
    }
  }, [selectedClient, selectedMonth, fetchBillsData, fetchVersions]);

  // Real-time subscription
  useEffect(() => {
    if (!selectedClient) return;

    const channel = supabase
      .channel('2b-reconciliation-changes')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'bills_not_in_2b',
        filter: `client_id=eq.${selectedClient}`
      }, () => {
        fetchBillsData();
        toast.info('2B data updated by another user');
      })
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'bills_not_in_books',
        filter: `client_id=eq.${selectedClient}`
      }, () => {
        fetchBillsData();
        toast.info('2B data updated by another user');
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedClient, fetchBillsData]);

  // Filter bills based on selected months
  const filteredBills2B = useMemo(() => {
    return localBills2B.filter(row => {
      // Reversal filter
      if (selectedReversalMonths.length > 0) {
        if (!row.reversal_month || !selectedReversalMonths.includes(row.reversal_month)) {
          return false;
        }
      }
      // Reclaim filter
      if (selectedReclaimMonths.length > 0) {
        if (!row.reclaim_month || !selectedReclaimMonths.includes(row.reclaim_month)) {
          return false;
        }
      }
      return true;
    });
  }, [localBills2B, selectedReversalMonths, selectedReclaimMonths]);

  const filteredBillsBooks = useMemo(() => {
    return localBillsBooks.filter(row => {
      // Book Entry filter
      if (selectedBookEntryMonths.length > 0) {
        if (!row.book_entry_month || !selectedBookEntryMonths.includes(row.book_entry_month)) {
          return false;
        }
      }
      // In 2B filter
      if (selectedIn2BMonths.length > 0) {
        if (!row.bill_in_2b_month || !selectedIn2BMonths.includes(row.bill_in_2b_month)) {
          return false;
        }
      }
      return true;
    });
  }, [localBillsBooks, selectedBookEntryMonths, selectedIn2BMonths]);

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

    if (!selectedClient) {
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
          client_id: selectedClient,
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
          client_id: selectedClient,
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
  const handleUpdate2BField = (id: string, field: string, value: any) => {
    if (isLocked) return;
    
    setLocalBills2B(prev => prev.map(b => 
      b.id === id ? { ...b, [field]: value } : b
    ));
    setHasUnsavedChanges(true);
  };

  // Local editing handlers for Bills Not in Books (update local state only)
  const handleUpdateBooksField = (id: string, field: string, value: any) => {
    if (isLocked) return;
    
    setLocalBillsBooks(prev => prev.map(b => 
      b.id === id ? { ...b, [field]: value } : b
    ));
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
    if (!selectedClient || isLocked) return;
    
    const tempId = `temp-${Date.now()}`;
    setLocalBills2B(prev => [...prev, {
      id: tempId,
      client_id: selectedClient,
      date: new Date().toISOString().split('T')[0],
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
      is_locked: false,
      is_carried_forward: false,
      version: 1,
      updated_at: null,
      updated_by: null,
    }]);
    setHasUnsavedChanges(true);
  };

  const handleAddRowBooks = () => {
    if (!selectedClient || isLocked) return;
    
    const tempId = `temp-${Date.now()}`;
    setLocalBillsBooks(prev => [...prev, {
      id: tempId,
      client_id: selectedClient,
      date: new Date().toISOString().split('T')[0],
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

  // Save all changes to database
  const handleSaveAll = async () => {
    if (!selectedClient || isLocked) return;
    
    // Validate that all rows have supplier names
    const invalidRows2B = localBills2B.filter(b => !b.supplier_name || b.supplier_name.trim() === '');
    const invalidRowsBooks = localBillsBooks.filter(b => !b.supplier_name || b.supplier_name.trim() === '');
    
    if (invalidRows2B.length > 0 || invalidRowsBooks.length > 0) {
      toast.error('Supplier name is required for all rows');
      return;
    }
    
    setIsSaving(true);
    try {
      // First, save a version of the current state before making changes
      const currentVersionNumber = versions.length > 0 ? Math.max(...versions.map(v => v.versionNumber)) + 1 : 1;
      
      // Mark all existing versions as not current
      await supabase
        .from('twob_versions')
        .update({ is_current: false })
        .eq('client_id', selectedClient)
        .eq('period_month', selectedMonth);
      
      // Transform local data to version format for storage
      const versionBills2B = localBills2B.filter(b => !b.id.startsWith('temp-')).map(b => ({
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
      
      const versionBillsBooks = localBillsBooks.filter(b => !b.id.startsWith('temp-')).map(b => ({
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
      
      // Save new version with current data
      const versionData = {
        billsNotIn2B: versionBills2B,
        billsNotInBooks: versionBillsBooks,
      };
      
      const { error: versionError } = await supabase.from('twob_versions').insert([{
        client_id: selectedClient,
        period_month: selectedMonth,
        table_type: 'combined',
        version_number: currentVersionNumber,
        version_data: versionData,
        updated_at: new Date().toISOString(),
        updated_by: user?.firstName || 'Unknown',
        is_current: true,
      }]);
      
      let savedVersionNumber: number | null = null;
      if (versionError) {
        console.error('Error saving version:', versionError);
        // Don't fail the save, just log the error
      } else {
        savedVersionNumber = currentVersionNumber;
      }

      // Delete removed rows
      if (deletedRows2B.length > 0) {
        await supabase.from('bills_not_in_2b').delete().in('id', deletedRows2B);
      }
      if (deletedRowsBooks.length > 0) {
        await supabase.from('bills_not_in_books').delete().in('id', deletedRowsBooks);
      }

      // Process bills not in 2B
      for (const bill of localBills2B) {
        if (bill.id.startsWith('temp-')) {
          // Insert new record
          const { id, ...billData } = bill;
          await supabase.from('bills_not_in_2b').insert([billData]);
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
        }
      }

      // Process bills not in books
      for (const bill of localBillsBooks) {
        if (bill.id.startsWith('temp-')) {
          // Insert new record
          const { id, ...billData } = bill;
          await supabase.from('bills_not_in_books').insert([billData]);
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
        }
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
    if (!selectedClient) return;
    
    try {
      await supabase
        .from('bills_not_in_2b')
        .update({ is_locked: false })
        .eq('client_id', selectedClient)
        .eq('period_month', selectedMonth);
      
      await supabase
        .from('bills_not_in_books')
        .update({ is_locked: false })
        .eq('client_id', selectedClient)
        .eq('period_month', selectedMonth);
      
      setIsLocked(false);
      toast.success('Sheet unlocked successfully');
    } catch (error: any) {
      toast.error('Failed to unlock: ' + error.message);
    }
  };

  // Carry forward data to next month
  const handleCarryForward = async () => {
    if (!selectedClient || (billsNotIn2B.length === 0 && billsNotInBooks.length === 0)) {
      toast.error('No data to carry forward');
      return;
    }

    // Calculate next month
    const [month, year] = selectedMonth.split('/');
    let nextMonth = parseInt(month) + 1;
    let nextYear = parseInt(year);
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear++;
    }
    const nextPeriod = `${String(nextMonth).padStart(2, '0')}/${nextYear}`;

    try {
      let totalCarried = 0;
      let totalSkipped = 0;

      // CARRY FORWARD BILLS NOT IN 2B - now carries ALL records regardless of reclaim status
      if (billsNotIn2B.length > 0) {
        // Get existing records in next month to check for duplicates
        const { data: existingNextMonth2B, error: fetchError2B } = await supabase
          .from('bills_not_in_2b')
          .select('supplier_name, supplier_invoice_number, supplier_gstin, date')
          .eq('client_id', selectedClient)
          .eq('period_month', nextPeriod);

        if (fetchError2B) throw fetchError2B;

        // Create a set of unique keys for existing records in next month
        const existingKeys2B = new Set(
          (existingNextMonth2B || []).map(r => 
            `${r.supplier_name}|${r.supplier_invoice_number || ''}|${r.supplier_gstin || ''}|${r.date}`
          )
        );

        // Carry forward ALL bills not in 2B (regardless of reclaim status), skip only duplicates
        const toCarryForward2B = billsNotIn2B.filter(b => {
          // Check if this record already exists in next month
          const recordKey = `${b.supplier_name}|${b.supplier_invoice_number || ''}|${b.supplier_gstin || ''}|${b.date}`;
          return !existingKeys2B.has(recordKey);
        });
        
        if (toCarryForward2B.length > 0) {
          const records2B = toCarryForward2B.map(b => ({
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
            reclaim_month: b.reclaim_month, // Preserve reclaim month too
            is_carried_forward: true,
          }));

          const { error } = await supabase
            .from('bills_not_in_2b')
            .insert(records2B);
          
          if (error) throw error;
          totalCarried += records2B.length;
        }
        
        totalSkipped += billsNotIn2B.length - toCarryForward2B.length;
      }

      // CARRY FORWARD BILLS NOT IN BOOKS - now carries ALL records regardless of book_entry status
      if (billsNotInBooks.length > 0) {
        // Get existing records in next month to check for duplicates
        const { data: existingNextMonthBooks, error: fetchErrorBooks } = await supabase
          .from('bills_not_in_books')
          .select('supplier_name, supplier_invoice_number, supplier_gstin, date')
          .eq('client_id', selectedClient)
          .eq('period_month', nextPeriod);

        if (fetchErrorBooks) throw fetchErrorBooks;

        // Create a set of unique keys for existing records in next month
        const existingKeysBooks = new Set(
          (existingNextMonthBooks || []).map(r => 
            `${r.supplier_name}|${r.supplier_invoice_number || ''}|${r.supplier_gstin || ''}|${r.date}`
          )
        );

        // Carry forward ALL bills not in books (regardless of book_entry status), skip only duplicates
        const toCarryForwardBooks = billsNotInBooks.filter(b => {
          // Check if this record already exists in next month
          const recordKey = `${b.supplier_name}|${b.supplier_invoice_number || ''}|${b.supplier_gstin || ''}|${b.date}`;
          return !existingKeysBooks.has(recordKey);
        });
        
        if (toCarryForwardBooks.length > 0) {
          const recordsBooks = toCarryForwardBooks.map(b => ({
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
            book_entry_month: b.book_entry_month, // Preserve book_entry_month
            bill_in_2b_month: b.bill_in_2b_month, // Preserve bill_in_2b_month
            is_carried_forward: true,
          }));

          const { error } = await supabase
            .from('bills_not_in_books')
            .insert(recordsBooks);
          
          if (error) throw error;
          totalCarried += recordsBooks.length;
        }
        
        totalSkipped += billsNotInBooks.length - toCarryForwardBooks.length;
      }

      if (totalCarried === 0) {
        toast.info(`All eligible entries already exist in ${nextPeriod} or have been resolved. No duplicates added.`);
      } else if (totalSkipped > 0) {
        toast.success(`Carried forward ${totalCarried} records to ${nextPeriod}. ${totalSkipped} duplicates skipped.`);
      } else {
        toast.success(`Carried forward ${totalCarried} records to ${nextPeriod}`);
      }
    } catch (error: any) {
      toast.error('Failed to carry forward: ' + error.message);
    }
  };

  const handleRestoreVersion = async (version: TwoBVersion) => {
    if (!selectedClient || isLocked) return;
    
    try {
      // Delete current records
      await supabase.from('bills_not_in_2b').delete().eq('client_id', selectedClient).eq('period_month', selectedMonth);
      await supabase.from('bills_not_in_books').delete().eq('client_id', selectedClient).eq('period_month', selectedMonth);
      
      // Restore bills not in 2B from version
      if (version.billsNotIn2B && version.billsNotIn2B.length > 0) {
        const records2B = version.billsNotIn2B.map((b: any) => ({
          client_id: selectedClient,
          date: b.date,
          supplier_name: b.supplier_name,
          supplier_invoice_number: b.supplier_invoice_number,
          supplier_gstin: b.supplier_gstin,
          taxable_value: b.taxable_value,
          input_igst: b.input_igst,
          input_cgst: b.input_cgst,
          input_sgst: b.input_sgst,
          period_month: selectedMonth,
          reversal_month: b.reversal_month,
          reclaim_month: b.reclaim_month,
          is_carried_forward: b.is_carried_forward,
        }));
        await supabase.from('bills_not_in_2b').insert(records2B);
      }
      
      // Restore bills not in books from version
      if (version.billsNotInBooks && version.billsNotInBooks.length > 0) {
        const recordsBooks = version.billsNotInBooks.map((b: any) => ({
          client_id: selectedClient,
          date: b.date,
          supplier_name: b.supplier_name,
          supplier_invoice_number: b.supplier_invoice_number,
          supplier_gstin: b.supplier_gstin,
          taxable_value: b.taxable_value,
          input_igst: b.input_igst,
          input_cgst: b.input_cgst,
          input_sgst: b.input_sgst,
          period_month: selectedMonth,
          book_entry_month: b.book_entry_month,
          bill_in_2b_month: b.bill_in_2b_month,
          is_carried_forward: b.is_carried_forward,
        }));
        await supabase.from('bills_not_in_books').insert(recordsBooks);
      }
      
      // Mark this version as current
      await supabase.from('twob_versions').update({ is_current: false }).eq('client_id', selectedClient).eq('period_month', selectedMonth);
      await supabase.from('twob_versions').update({ is_current: true }).eq('id', version.id);
      
      await fetchBillsData();
      await fetchVersions();
      toast.success(`Restored to version ${version.versionNumber}`);
      setShowVersionHistory(false);
    } catch (error: any) {
      console.error('Error restoring version:', error);
      toast.error('Failed to restore: ' + error.message);
    }
  };

  // Render editable input for table cells - FIXED: wider inputs for numbers
  const renderEditableInput = (
    value: string | number | null,
    onChange: (value: any) => void,
    type: 'text' | 'number' | 'date' = 'text',
    className: string = ''
  ) => {
    if (isLocked) {
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
          const val = type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
          onChange(val);
        }}
        className={`h-8 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${type === 'number' ? 'w-28 text-right font-mono' : ''} ${className}`}
      />
    );
  };

  // Render month dropdown for reversal/reclaim
  const renderMonthDropdown = (
    value: string | null,
    onChange: (value: string) => void,
    placeholder: string = 'Select'
  ) => {
    if (isLocked) {
      return <span>{value ?? '-'}</span>;
    }
    
    return (
      <Select value={value || 'none'} onValueChange={(v) => onChange(v === 'none' ? '' : v)}>
        <SelectTrigger className="h-8 text-sm w-24">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">-</SelectItem>
          {reversalReclaimMonths.map((month) => (
            <SelectItem key={month.value} value={month.value}>
              {month.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">2B Reconciliation</h1>
          <p className="text-muted-foreground">Manage bills not available in 2B or Books</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedClient && !isLocked && (
            <Button 
              onClick={handleSaveAll} 
              disabled={isSaving || !hasUnsavedChanges}
              variant={hasUnsavedChanges ? "default" : "outline"}
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
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 max-w-xs">
              <SearchableSelect
                options={clients.map(c => ({ value: c.id, label: c.name, sublabel: c.gstin }))}
                value={selectedClient}
                onValueChange={setSelectedClient}
                placeholder="Search Client..."
                searchPlaceholder="Type to search clients..."
                emptyText="No clients found."
                disabled={!isStaffRole() && clients.length <= 1}
              />
            </div>
            <div className="w-40">
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Month" />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((month) => (
                    <SelectItem key={month.value} value={month.value}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {canViewVersionHistory() && selectedClient && (
              <Button 
                variant="outline" 
                className="flex items-center gap-2"
                onClick={() => setShowVersionHistory(true)}
              >
                <History className="h-4 w-4" />
                View Versions
              </Button>
            )}
            {selectedClient && (billsNotIn2B.length > 0 || billsNotInBooks.length > 0) && !isLocked && (
              <Button 
                variant="outline" 
                className="flex items-center gap-2"
                onClick={handleCarryForward}
              >
                Carry Forward to Next Month
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!selectedClient ? (
        <Card>
          <CardContent className="p-12 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Please select a client to view 2B reconciliation data.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Lock indicator */}
          {isLocked && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 flex items-center justify-between text-warning">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4" />
                <span className="text-sm">This sheet is locked because the return has been filed.</span>
              </div>
              {canUnlockSheets() && (
                <Button variant="outline" size="sm" onClick={handleUnlockSheet}>
                  <Unlock className="h-4 w-4 mr-1" />
                  Unlock
                </Button>
              )}
            </div>
          )}

          {/* Table 1: Bills Not Available in 2B */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="text-lg">Bills Not Available in 2B</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Client: {selectedClientData?.name} | Edit cells directly to modify data
                </p>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="gst-table">
                  <thead>
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
                            'date'
                          )}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            {renderEditableInput(
                              row.supplier_name,
                              (val) => handleUpdate2BField(row.id, 'supplier_name', val),
                              'text',
                              'min-w-[150px]'
                            )}
                            {row.is_carried_forward && (
                              <Badge variant="outline" className="text-xs shrink-0">CF</Badge>
                            )}
                          </div>
                        </td>
                        <td>
                          {renderEditableInput(
                            row.supplier_invoice_number,
                            (val) => handleUpdate2BField(row.id, 'supplier_invoice_number', val)
                          )}
                        </td>
                        <td>
                          {renderEditableInput(
                            row.supplier_gstin,
                            (val) => handleUpdate2BField(row.id, 'supplier_gstin', val),
                            'text',
                            'font-mono text-xs'
                          )}
                        </td>
                        <td className="text-right">
                          {renderEditableInput(
                            row.taxable_value,
                            (val) => handleUpdate2BField(row.id, 'taxable_value', val),
                            'number',
                            'text-right'
                          )}
                        </td>
                        <td className="text-right">
                          {renderEditableInput(
                            row.input_igst,
                            (val) => handleUpdate2BField(row.id, 'input_igst', val),
                            'number',
                            'text-right'
                          )}
                        </td>
                        <td className="text-right">
                          {renderEditableInput(
                            row.input_cgst,
                            (val) => handleUpdate2BField(row.id, 'input_cgst', val),
                            'number',
                            'text-right'
                          )}
                        </td>
                        <td className="text-right">
                          {renderEditableInput(
                            row.input_sgst,
                            (val) => handleUpdate2BField(row.id, 'input_sgst', val),
                            'number',
                            'text-right'
                          )}
                        </td>
                        <td>
                          {renderMonthDropdown(
                            row.reversal_month,
                            (val) => handleUpdate2BField(row.id, 'reversal_month', val || null),
                            'Rev'
                          )}
                        </td>
                        <td>
                          {renderMonthDropdown(
                            row.reclaim_month,
                            (val) => handleUpdate2BField(row.id, 'reclaim_month', val || null),
                            'Rec'
                          )}
                        </td>
                        {!isLocked && (
                          <td>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => handleDeleteRow2B(row.id)}
                              className="h-7 w-7 p-0 text-destructive"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </td>
                        )}
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
                      <td className="text-center">{totals2B.reversalCount}</td>
                      <td className="text-center">{totals2B.reclaimCount}</td>
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
              <CardTitle className="text-lg">Bills Not Available in Books</CardTitle>
              <p className="text-sm text-muted-foreground">Edit cells directly to modify data</p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="gst-table">
                  <thead>
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
                      <tr key={row.id}>
                        <td>
                          {renderEditableInput(
                            row.date,
                            (val) => handleUpdateBooksField(row.id, 'date', val),
                            'date'
                          )}
                        </td>
                        <td>
                          {renderEditableInput(
                            row.supplier_name,
                            (val) => handleUpdateBooksField(row.id, 'supplier_name', val),
                            'text',
                            'min-w-[150px]'
                          )}
                        </td>
                        <td>
                          {renderEditableInput(
                            row.supplier_invoice_number,
                            (val) => handleUpdateBooksField(row.id, 'supplier_invoice_number', val)
                          )}
                        </td>
                        <td>
                          {renderEditableInput(
                            row.supplier_gstin,
                            (val) => handleUpdateBooksField(row.id, 'supplier_gstin', val),
                            'text',
                            'font-mono text-xs'
                          )}
                        </td>
                        <td className="text-right">
                          {renderEditableInput(
                            row.taxable_value,
                            (val) => handleUpdateBooksField(row.id, 'taxable_value', val),
                            'number',
                            'text-right'
                          )}
                        </td>
                        <td className="text-right">
                          {renderEditableInput(
                            row.input_igst,
                            (val) => handleUpdateBooksField(row.id, 'input_igst', val),
                            'number',
                            'text-right'
                          )}
                        </td>
                        <td className="text-right">
                          {renderEditableInput(
                            row.input_cgst,
                            (val) => handleUpdateBooksField(row.id, 'input_cgst', val),
                            'number',
                            'text-right'
                          )}
                        </td>
                        <td className="text-right">
                          {renderEditableInput(
                            row.input_sgst,
                            (val) => handleUpdateBooksField(row.id, 'input_sgst', val),
                            'number',
                            'text-right'
                          )}
                        </td>
                        <td>
                          {renderMonthDropdown(
                            row.book_entry_month,
                            (val) => handleUpdateBooksField(row.id, 'book_entry_month', val || null),
                            'Entry'
                          )}
                        </td>
                        <td>
                          {renderMonthDropdown(
                            row.bill_in_2b_month,
                            (val) => handleUpdateBooksField(row.id, 'bill_in_2b_month', val || null),
                            'In 2B'
                          )}
                        </td>
                        {!isLocked && (
                          <td>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => handleDeleteRowBooks(row.id)}
                              className="h-7 w-7 p-0 text-destructive"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </td>
                        )}
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
                      <td className="text-center">{totalsBooks.bookEntryCount}</td>
                      <td className="text-center">{totalsBooks.in2BCount}</td>
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
        clientName={selectedClientData?.name || ''}
        month={selectedMonth}
      />
    </div>
  );
};

export default TwoBReconciliationPage;
