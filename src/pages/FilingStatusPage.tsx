import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Download, FileText, Lock, Unlock, Search, Filter, ChevronDown } from 'lucide-react';
import { FilingStatusType, ReturnType, QUARTERLY_RETURN_TYPES, isQuarterEndMonth } from '@/types';
import { exportFilingStatusToPDF } from '@/utils/pdfExport';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import GSTPortalLink from '@/components/clients/GSTPortalLink';

interface Client {
  id: string;
  name: string;
  gstin: string;
  mobile: string | null;
  email: string | null;
  assigned_accountant: string | null;
  registration_type: string;
  selected_returns: string[] | null;
  registration_date: string;
  cancellation_date?: string | null;
}

interface FilingRecord {
  id: string;
  client_id: string;
  return_type: string;
  period_month: string;
  status: FilingStatusType;
  target_date: number | null;
  filed_date: string | null;
  remarks: string | null;
  is_locked: boolean | null;
  // Joined client data
  clientName?: string;
  clientEmail?: string;
  contactNumber?: string;
  accountantName?: string;
  filingFrequency?: string;
}

const FilingStatusPage: React.FC = () => {
  const { canUnlockSheets, isStaffRole, user } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState<string>('01/2026');
  const [selectedTab, setSelectedTab] = useState<string>('gstr1');
  const [clients, setClients] = useState<Client[]>([]);
  const [filingRecords, setFilingRecords] = useState<FilingRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Filter states
  const [clientNameFilter, setClientNameFilter] = useState<string>('');
  const [selectedTargetDates, setSelectedTargetDates] = useState<number[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<FilingStatusType[]>([]);
  const allReturnTypes: ReturnType[] = ['GSTR-1', 'GSTR-3B', 'ITC-04', 'GSTR-6', 'GSTR-7', 'CMP-08', 'GSTR-1 (IFF)', 'GSTR-3B (Q)'];

  // Carry forward function - transfers all 2B records to next month
  const carryForwardToNextMonth = async (clientId: string, periodMonth: string) => {
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
      if (billsNotIn2B && billsNotIn2B.length > 0) {
        // Get existing records in next month to check for duplicates
        const { data: existingNextMonth2B } = await supabase
          .from('bills_not_in_2b')
          .select('supplier_name, supplier_invoice_number, supplier_gstin, date')
          .eq('client_id', clientId)
          .eq('period_month', nextPeriod);

        const existingKeys2B = new Set(
          (existingNextMonth2B || []).map(r => 
            `${r.supplier_name}|${r.supplier_invoice_number || ''}|${r.supplier_gstin || ''}|${r.date}`
          )
        );

        const toCarryForward2B = billsNotIn2B.filter(b => {
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
            reclaim_month: b.reclaim_month,
            is_carried_forward: true,
          }));

          await supabase.from('bills_not_in_2b').insert(records2B);
          totalCarried += records2B.length;
        }
      }

      // CARRY FORWARD BILLS NOT IN BOOKS
      if (billsNotInBooks && billsNotInBooks.length > 0) {
        const { data: existingNextMonthBooks } = await supabase
          .from('bills_not_in_books')
          .select('supplier_name, supplier_invoice_number, supplier_gstin, date')
          .eq('client_id', clientId)
          .eq('period_month', nextPeriod);

        const existingKeysBooks = new Set(
          (existingNextMonthBooks || []).map(r => 
            `${r.supplier_name}|${r.supplier_invoice_number || ''}|${r.supplier_gstin || ''}|${r.date}`
          )
        );

        const toCarryForwardBooks = billsNotInBooks.filter(b => {
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
            book_entry_month: b.book_entry_month,
            bill_in_2b_month: b.bill_in_2b_month,
            is_carried_forward: true,
          }));

          await supabase.from('bills_not_in_books').insert(recordsBooks);
          totalCarried += recordsBooks.length;
        }
      }

      console.log(`Carried forward ${totalCarried} records to ${nextPeriod}`);
    } catch (error: any) {
      console.error('Error during carry forward:', error);
      // Don't throw - we don't want to fail the filing just because carry forward failed
    }
  };

  // Fetch clients from Supabase
  const fetchClients = useCallback(async () => {
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, gstin, mobile, email, assigned_accountant, registration_type, selected_returns, registration_date, cancellation_date')
      .order('name');
    
    if (error) {
      console.error('Error fetching clients:', error);
      toast.error('Failed to load clients');
      return;
    }
    setClients(data || []);
  }, []);

  // Fetch filing status records
  const fetchFilingRecords = useCallback(async () => {
    const { data, error } = await supabase
      .from('filing_status')
      .select('*')
      .eq('period_month', selectedMonth);
    
    if (error) {
      console.error('Error fetching filing records:', error);
      return;
    }
    setFilingRecords(data || []);
  }, [selectedMonth]);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      await Promise.all([fetchClients(), fetchFilingRecords()]);
      setIsLoading(false);
    };
    loadData();
  }, [fetchClients, fetchFilingRecords]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel('filing-status-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'filing_status' }, () => {
        fetchFilingRecords();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => {
        fetchClients();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchClients, fetchFilingRecords]);

  // Helper function to check if client should be visible for selected month
  const isClientVisibleForMonth = (client: Client, periodMonth: string): boolean => {
    // Parse period month (format: MM/YYYY)
    const [monthStr, yearStr] = periodMonth.split('/');
    const periodDate = new Date(parseInt(yearStr), parseInt(monthStr) - 1, 1);
    
    // Parse registration date
    const regDate = new Date(client.registration_date);
    const regMonth = new Date(regDate.getFullYear(), regDate.getMonth(), 1);
    
    // Client should only be visible if period month >= registration month
    if (periodDate < regMonth) {
      return false;
    }
    
    // Check cancellation date if present
    if (client.cancellation_date) {
      const cancelDate = new Date(client.cancellation_date);
      const cancelMonth = new Date(cancelDate.getFullYear(), cancelDate.getMonth(), 1);
      // Client should not be visible after cancellation month
      if (periodDate > cancelMonth) {
        return false;
      }
    }
    
    return true;
  };

  // Helper to check if quarterly return should be visible for a month
  const isQuarterlyReturnVisibleForMonth = (returnType: ReturnType, periodMonth: string): boolean => {
    // Quarterly returns only show in quarter end months (March, June, September, December)
    if (!QUARTERLY_RETURN_TYPES.includes(returnType)) {
      return true; // Not a quarterly return, always visible
    }
    
    const [monthStr] = periodMonth.split('/');
    const month = parseInt(monthStr);
    return isQuarterEndMonth(month);
  };

  // Generate filing records for display - with option to merge GSTR-1 (IFF) into GSTR-1 and GSTR-3B (Q) into GSTR-3B
  const generateAllFilingRecords = (returnType: ReturnType): FilingRecord[] => {
    const records: FilingRecord[] = [];
    
    // Check if this quarterly return should be visible for selected month
    if (!isQuarterlyReturnVisibleForMonth(returnType, selectedMonth)) {
      return []; // Don't show quarterly returns in non-quarter-end months
    }
    
    // For GSTR-1 tab, also include GSTR-1 (IFF) clients
    // For GSTR-3B tab, also include GSTR-3B (Q) clients (only in quarter-end months for IFF/Composition)
    let returnTypesToCheck: ReturnType[];
    if (returnType === 'GSTR-1') {
      returnTypesToCheck = ['GSTR-1', 'GSTR-1 (IFF)'];
    } else if (returnType === 'GSTR-3B') {
      returnTypesToCheck = ['GSTR-3B', 'GSTR-3B (Q)'];
    } else {
      returnTypesToCheck = [returnType];
    }
    
    // Check if current month is quarter-end for GSTR-3B (Q) logic
    const [monthStr] = selectedMonth.split('/');
    const currentMonthNum = parseInt(monthStr);
    const isQuarterEnd = isQuarterEndMonth(currentMonthNum);
    
    clients.forEach(client => {
      // Check if client should be visible for the selected month
      if (!isClientVisibleForMonth(client, selectedMonth)) {
        return; // Skip this client
      }
      
      const selectedReturns = client.selected_returns || [];
      const isQuarterlyClient = client.registration_type === 'IFF' || client.registration_type === 'Composition';
      
      // Check if client has any of the return types we're looking for
      for (const rt of returnTypesToCheck) {
        if (selectedReturns.includes(rt)) {
          // For GSTR-3B (Q), only include in quarter-end months for IFF/Composition clients
          if (rt === 'GSTR-3B (Q)' && (!isQuarterEnd || !isQuarterlyClient)) {
            continue;
          }
          // For regular GSTR-3B, skip if client is IFF/Composition (they use GSTR-3B (Q))
          if (rt === 'GSTR-3B' && isQuarterlyClient) {
            continue;
          }
          
          const existingRecord = filingRecords.find(
            f => f.client_id === client.id && f.return_type === rt
          );
          
          // Determine filing frequency
          let filingFrequency: string;
          if (client.registration_type === 'IFF' && (rt === 'GSTR-1 (IFF)' || returnType === 'GSTR-1')) {
            filingFrequency = 'IFF';
          } else if (QUARTERLY_RETURN_TYPES.includes(rt) || 
            client.registration_type === 'Composition' ||
            (client.registration_type === 'IFF' && rt === 'GSTR-3B (Q)')) {
            filingFrequency = 'Quarterly';
          } else {
            filingFrequency = 'Monthly';
          }
          
          if (existingRecord) {
            records.push({
              ...existingRecord,
              clientName: client.name,
              clientEmail: client.email || '-',
              contactNumber: client.mobile || '-',
              accountantName: client.assigned_accountant || '-',
              filingFrequency,
            });
          } else {
            // Create new record with 'Data Pending' as default status
            records.push({
              id: `temp-${client.id}-${rt}`,
              client_id: client.id,
              return_type: rt,
              period_month: selectedMonth,
              status: 'Data Pending',
              target_date: rt === 'GSTR-1' || rt === 'GSTR-1 (IFF)' ? 11 : rt === 'GSTR-3B' || rt === 'GSTR-3B (Q)' ? 20 : 25,
              filed_date: null,
              remarks: null,
              is_locked: false,
              clientName: client.name,
              clientEmail: client.email || '-',
              contactNumber: client.mobile || '-',
              accountantName: client.assigned_accountant || '-',
              filingFrequency,
            });
          }
          break; // Don't add the same client twice if they have both GSTR-1 and GSTR-1 (IFF) or GSTR-3B and GSTR-3B (Q)
        }
      }
    });
    
    return records;
  };

  const handleExportPDF = () => {
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
    }));
    
    exportFilingStatusToPDF(pdfRecords, returnType, selectedMonth);
    toast.success('PDF exported successfully');
  };

  const handleStatusChange = async (record: FilingRecord, newStatus: FilingStatusType) => {
    const isNewRecord = record.id.startsWith('temp-');
    
    // Check if user is allowed to change from Filed status
    // Only superadmin and gst_manager can change FROM Filed to another status
    if (record.status === 'Filed' && newStatus !== 'Filed') {
      if (!canUnlockSheets()) {
        toast.error('Only GST Manager or Superadmin can change a Filed status.');
        return;
      }
    }
    
    // NEW VALIDATION: Check if previous month's GSTR-1 and GSTR-3B are filed before filing current month GSTR-1
    if ((record.return_type === 'GSTR-1' || record.return_type === 'GSTR-1 (IFF)') && newStatus === 'Filed') {
      // Calculate previous month
      const [monthStr, yearStr] = selectedMonth.split('/');
      let prevMonth = parseInt(monthStr) - 1;
      let prevYear = parseInt(yearStr);
      if (prevMonth < 1) {
        prevMonth = 12;
        prevYear--;
      }
      const prevPeriod = `${String(prevMonth).padStart(2, '0')}/${prevYear}`;
      
      // For IFF clients, use GSTR-1 (IFF) and GSTR-3B (Q), otherwise use GSTR-1 and GSTR-3B
      const prevGstr1Type = record.return_type === 'GSTR-1 (IFF)' ? 'GSTR-1 (IFF)' : 'GSTR-1';
      const prevGstr3bType = record.return_type === 'GSTR-1 (IFF)' ? 'GSTR-3B (Q)' : 'GSTR-3B';
      
      // Check previous month's GSTR-1 filed status
      const { data: prevGstr1Data } = await supabase
        .from('filing_status')
        .select('status')
        .eq('client_id', record.client_id)
        .eq('period_month', prevPeriod)
        .eq('return_type', prevGstr1Type)
        .maybeSingle();
      
      // Check previous month's GSTR-3B filed status
      const { data: prevGstr3bData } = await supabase
        .from('filing_status')
        .select('status')
        .eq('client_id', record.client_id)
        .eq('period_month', prevPeriod)
        .eq('return_type', prevGstr3bType)
        .maybeSingle();
      
      // Determine if previous month is the first month of client registration
      const client = clients.find(c => c.id === record.client_id);
      let isFirstMonth = false;
      if (client) {
        const regDate = new Date(client.registration_date);
        const regMonth = regDate.getMonth() + 1;
        const regYear = regDate.getFullYear();
        const regPeriod = `${String(regMonth).padStart(2, '0')}/${regYear}`;
        isFirstMonth = (selectedMonth === regPeriod);
      }
      
      // Skip validation for first month of registration
      if (!isFirstMonth) {
        if (!prevGstr1Data || prevGstr1Data.status !== 'Filed') {
          toast.error(`Cannot file ${record.return_type}: Previous month's ${prevGstr1Type} (${prevPeriod}) must be filed first.`);
          return;
        }
        
        // For GSTR-3B (Q), only check in quarter-end months
        const isQuarterEndPrev = isQuarterEndMonth(prevMonth);
        const isClientQuarterly = client && (client.registration_type === 'IFF' || client.registration_type === 'Composition');
        
        // Check GSTR-3B only if previous month is quarter-end for quarterly clients, or always for regular clients
        const shouldCheckGstr3b = !isClientQuarterly || isQuarterEndPrev;
        
        if (shouldCheckGstr3b && (!prevGstr3bData || prevGstr3bData.status !== 'Filed')) {
          toast.error(`Cannot file ${record.return_type}: Previous month's ${prevGstr3bType} (${prevPeriod}) must be filed first.`);
          return;
        }
      }
    }
    
    // GSTR-3B dependency check: require GSTR-1 to be filed first
    // Also applies to GSTR-3B (Q)
    if ((record.return_type === 'GSTR-3B' || record.return_type === 'GSTR-3B (Q)') && newStatus === 'Filed') {
      // For GSTR-3B (Q), check for GSTR-1 (IFF) filed status
      const gstr1ReturnType = record.return_type === 'GSTR-3B (Q)' ? 'GSTR-1 (IFF)' : 'GSTR-1';
      const gstr1Record = filingRecords.find(
        f => f.client_id === record.client_id && 
             f.return_type === gstr1ReturnType && 
             f.period_month === record.period_month
      );
      
      if (!gstr1Record || gstr1Record.status !== 'Filed') {
        toast.error(`Cannot file ${record.return_type}: ${gstr1ReturnType} must be filed first for this period.`);
        return;
      }
      
      // Check Suspended Reco difference: if difference is not zero, cannot file GSTR-3B
      try {
        // Fetch suspended_reco data
        const { data: suspendedData } = await supabase
          .from('suspended_reco')
          .select('portal_cgst, portal_sgst, portal_igst')
          .eq('client_id', record.client_id)
          .eq('period_month', selectedMonth)
          .maybeSingle();
        
        // Fetch books data from bills_not_in_2b
        // RULE: Include rows where Reclaim is blank AND Reversal is NOT blank
        const { data: booksData } = await supabase
          .from('bills_not_in_2b')
          .select('input_cgst, input_sgst, input_igst, reversal_month, reclaim_month')
          .eq('client_id', record.client_id)
          .eq('period_month', selectedMonth);
        
        if (suspendedData || (booksData && booksData.length > 0)) {
          const portalCgst = Number(suspendedData?.portal_cgst) || 0;
          const portalSgst = Number(suspendedData?.portal_sgst) || 0;
          const portalIgst = Number(suspendedData?.portal_igst) || 0;
          const portalTotal = portalCgst + portalSgst + portalIgst;
          
          // Filter books data: Include rows where Reclaim is blank AND Reversal is NOT blank
          const filteredBooksData = (booksData || []).filter(row => {
            const reversalBlank = row.reversal_month === null || row.reversal_month === '';
            const reclaimBlank = row.reclaim_month === null || row.reclaim_month === '';
            return reclaimBlank && !reversalBlank;
          });
          
          const booksTotals = filteredBooksData.reduce((acc, row) => ({
            cgst: acc.cgst + (Number(row.input_cgst) || 0),
            sgst: acc.sgst + (Number(row.input_sgst) || 0),
            igst: acc.igst + (Number(row.input_igst) || 0),
          }), { cgst: 0, sgst: 0, igst: 0 });
          
          const booksTotal = booksTotals.cgst + booksTotals.sgst + booksTotals.igst;
          const difference = portalTotal - booksTotal;
          
          if (difference !== 0) {
            toast.error(`Cannot file ${record.return_type}: Suspended Reconciliation difference must be zero. Current difference: ${difference.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
            return;
          }
        }
      } catch (error: any) {
        console.error('Error checking suspended reco:', error);
        // Continue with filing if there's an error fetching suspended reco data
      }
    }
    
    try {
      if (isNewRecord) {
        // Insert new record
        const { error } = await supabase
          .from('filing_status')
          .insert([{
            client_id: record.client_id,
            return_type: record.return_type as 'GSTR-1' | 'GSTR-3B' | 'ITC-04' | 'GSTR-6' | 'GSTR-7' | 'CMP-08' | 'GSTR-1 (IFF)' | 'GSTR-3B (Q)',
            period_month: selectedMonth,
            status: newStatus,
            target_date: record.target_date,
            filed_date: newStatus === 'Filed' ? new Date().toISOString().split('T')[0] : null,
          }]);
        
        if (error) throw error;
      } else {
        // Update existing record
        const updateData: Record<string, unknown> = {
          status: newStatus,
        };
        
        if (newStatus === 'Filed') {
          updateData.filed_date = new Date().toISOString().split('T')[0];
        } else {
          // If changing from Filed to another status, clear filed_date
          updateData.filed_date = null;
        }
        
        const { error } = await supabase
          .from('filing_status')
          .update(updateData)
          .eq('id', record.id);
        
        if (error) throw error;
      }
      
      // When GSTR-3B or GSTR-3B (Q) is filed, lock the 2B and ITC sheets AND carry forward data
      if (newStatus === 'Filed' && (record.return_type === 'GSTR-3B' || record.return_type === 'GSTR-3B (Q)')) {
        // Lock bills_not_in_2b
        await supabase
          .from('bills_not_in_2b')
          .update({ is_locked: true })
          .eq('client_id', record.client_id)
          .eq('period_month', record.period_month);
        
        // Lock bills_not_in_books
        await supabase
          .from('bills_not_in_books')
          .update({ is_locked: true })
          .eq('client_id', record.client_id)
          .eq('period_month', record.period_month);
        
        // Lock ITC summary
        await supabase
          .from('itc_summaries')
          .update({ is_locked: true })
          .eq('client_id', record.client_id)
          .eq('period_month', record.period_month);
        
        // Mark ONLY this GSTR-3B/GSTR-3B (Q) filing status as locked (not GSTR-1 or other returns)
        await supabase
          .from('filing_status')
          .update({ is_locked: true })
          .eq('id', record.id); // Only lock this specific record
        
        // AUTO CARRY FORWARD: Transfer all 2B records to next month
        await carryForwardToNextMonth(record.client_id, record.period_month);
        
        toast.success(`${record.return_type} filed. 2B and ITC sheets are now locked and data carried forward to next month.`);
      } else if (newStatus === 'Filed') {
        toast.success('Status updated to Filed.');
      } else {
        toast.success('Status updated successfully');
      }
      
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

  const handleUnlock = async (record: FilingRecord) => {
    if (record.id.startsWith('temp-')) return;
    
    try {
      // When unlocking, unlock ALL related sheets and change status to 'Prepared Pending'
      // This affects: Filing Status (GSTR-3B/GSTR-3B (Q)), 2B Reconciliation, ITC Summary, RCM Summary
      
      // Change status back to 'Prepared Pending' and unlock for GSTR-3B/GSTR-3B (Q)
      const { error } = await supabase
        .from('filing_status')
        .update({
          status: 'Prepared Pending',
          is_locked: false,
          filed_date: null,
        })
        .eq('client_id', record.client_id)
        .eq('period_month', record.period_month)
        .in('return_type', ['GSTR-3B', 'GSTR-3B (Q)']);
      
      if (error) throw error;
      
      // Also unlock ALL related sheets for the same client and period
      // Unlock bills_not_in_2b
      await supabase
        .from('bills_not_in_2b')
        .update({ is_locked: false })
        .eq('client_id', record.client_id)
        .eq('period_month', record.period_month);
      
      // Unlock bills_not_in_books
      await supabase
        .from('bills_not_in_books')
        .update({ is_locked: false })
        .eq('client_id', record.client_id)
        .eq('period_month', record.period_month);
      
      // Unlock ITC summaries
      await supabase
        .from('itc_summaries')
        .update({ is_locked: false })
        .eq('client_id', record.client_id)
        .eq('period_month', record.period_month);
      
      // Unlock RCM data
      await supabase
        .from('rcm_data')
        .update({ is_locked: false })
        .eq('client_id', record.client_id)
        .eq('month', record.period_month);
      
      toast.success('All sheets unlocked. GSTR-3B status changed to Prepared Pending.');
      fetchFilingRecords();
    } catch (error: any) {
      toast.error('Failed to unlock: ' + error.message);
    }
  };

  // Apply filters to records
  const applyFilters = (records: FilingRecord[]): FilingRecord[] => {
    return records.filter(record => {
      // Client name filter
      if (clientNameFilter && !record.clientName?.toLowerCase().includes(clientNameFilter.toLowerCase())) {
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

  // All available statuses
  const allStatuses: FilingStatusType[] = ['Prepared', 'Prepared Pending', 'Data Pending', 'Data Received', 'Mismatch in Data', 'Filed'];

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

  const FilingTable = ({ records, returnType }: { records: FilingRecord[]; returnType: string }) => {
    const filteredRecords = applyFilters(records);
    const [editingRemarks, setEditingRemarks] = useState<Record<string, string>>({});
    
    // Get unique target dates for this return type
    const uniqueTargetDates = Array.from(new Set(records.filter(r => r.target_date !== null).map(r => r.target_date!))).sort((a, b) => a - b);
    
    return (
      <div className="overflow-x-auto">
        <table className="gst-table">
          <thead>
            <tr>
              <th className="w-12">No.</th>
              <th>Client Name</th>
              <th>Accountant</th>
              <th>Frequency</th>
              <th>Contact</th>
              <th>Email</th>
              <th>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" className="h-auto p-0 font-semibold hover:bg-transparent flex items-center gap-1">
                      Status
                      <ChevronDown className="h-3 w-3" />
                      {selectedStatuses.length > 0 && (
                        <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                          {selectedStatuses.length}
                        </Badge>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-2 bg-background border" align="start">
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-muted-foreground mb-2">Filter by Status</div>
                      {allStatuses.map((status) => (
                        <div key={status} className="flex items-center space-x-2 p-1 hover:bg-muted rounded">
                          <Checkbox
                            id={`status-${status}`}
                            checked={selectedStatuses.includes(status)}
                            onCheckedChange={() => toggleStatus(status)}
                          />
                          <label 
                            htmlFor={`status-${status}`} 
                            className="text-xs cursor-pointer flex-1"
                          >
                            {status}
                          </label>
                        </div>
                      ))}
                      {selectedStatuses.length > 0 && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="w-full mt-2 h-6 text-xs"
                          onClick={() => setSelectedStatuses([])}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </th>
              <th className="w-20">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" className="h-auto p-0 font-semibold hover:bg-transparent flex items-center gap-1">
                      Target
                      <ChevronDown className="h-3 w-3" />
                      {selectedTargetDates.length > 0 && (
                        <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                          {selectedTargetDates.length}
                        </Badge>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-40 p-2 bg-background border" align="start">
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-muted-foreground mb-2">Filter by Target Date</div>
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {uniqueTargetDates.map((date) => (
                          <div key={date} className="flex items-center space-x-2 p-1 hover:bg-muted rounded">
                            <Checkbox
                              id={`target-${date}`}
                              checked={selectedTargetDates.includes(date)}
                              onCheckedChange={() => toggleTargetDate(date)}
                            />
                            <label 
                              htmlFor={`target-${date}`} 
                              className="text-xs cursor-pointer flex-1"
                            >
                              Day {date}
                            </label>
                          </div>
                        ))}
                      </div>
                      {selectedTargetDates.length > 0 && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="w-full mt-2 h-6 text-xs"
                          onClick={() => setSelectedTargetDates([])}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </th>
              <th className="w-28">Filed Date</th>
              <th className="min-w-[200px]">Remarks</th>
              <th className="w-16">GST</th>
              {canUnlockSheets() && <th className="w-16">Unlock</th>}
            </tr>
          </thead>
          <tbody>
            {filteredRecords.map((record, idx) => (
              <tr key={record.id} className={record.is_locked ? 'bg-muted/30' : ''}>
                <td>{idx + 1}</td>
                <td className="font-medium">
                  {record.clientName}
                  {record.is_locked && <Lock className="h-3 w-3 inline ml-2 text-muted-foreground" />}
                </td>
                <td>{record.accountantName}</td>
                <td>
                  <Badge 
                    variant={record.filingFrequency === 'Quarterly' || record.filingFrequency === 'IFF' ? 'default' : 'outline'} 
                    className={`text-xs ${record.filingFrequency === 'Quarterly' ? 'bg-amber-500 hover:bg-amber-600 text-white' : record.filingFrequency === 'IFF' ? 'bg-blue-500 hover:bg-blue-600 text-white' : ''}`}
                  >
                    {record.filingFrequency === 'Quarterly' ? 'Q' : record.filingFrequency === 'IFF' ? 'IFF' : 'M'}
                  </Badge>
                </td>
                <td>{record.contactNumber}</td>
                <td className="text-xs">{record.clientEmail}</td>
                <td>
                  <Select 
                    value={record.status} 
                    disabled={record.is_locked && !canUnlockSheets()}
                    onValueChange={(value) => handleStatusChange(record, value as FilingStatusType)}
                  >
                    <SelectTrigger className="w-40 h-8 [appearance:none]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Prepared">Prepared</SelectItem>
                      <SelectItem value="Prepared Pending">Prepared Pending</SelectItem>
                      <SelectItem value="Data Pending">Data Pending</SelectItem>
                      <SelectItem value="Data Received">Data Received</SelectItem>
                      <SelectItem value="Mismatch in Data">Mismatch in Data</SelectItem>
                      <SelectItem value="Filed">Filed</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="text-center font-mono text-sm">{record.target_date}</td>
                <td>
                  {record.filed_date 
                    ? new Date(record.filed_date).toLocaleDateString('en-IN')
                    : '-'
                  }
                </td>
                <td className="min-w-[200px]">
                  <textarea
                    value={editingRemarks[record.id] ?? record.remarks ?? ''}
                    onChange={(e) => setEditingRemarks(prev => ({ ...prev, [record.id]: e.target.value }))}
                    onBlur={() => {
                      const newRemarks = editingRemarks[record.id];
                      if (newRemarks !== undefined && newRemarks !== record.remarks) {
                        handleRemarksChange(record, newRemarks);
                      }
                    }}
                    placeholder="Add remarks..."
                    className="w-full min-h-[28px] max-h-[80px] text-xs px-2 py-1 rounded border border-input bg-background resize-y"
                    disabled={record.is_locked && !canUnlockSheets()}
                  />
                </td>
                <td className="text-center">
                  <GSTPortalLink clientId={record.client_id} clientName={record.clientName} />
                </td>
                {canUnlockSheets() && (
                  <td className="text-center">
                    {record.is_locked && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleUnlock(record)}
                        className="h-7 px-2"
                        title="Unlock this record"
                      >
                        <Unlock className="h-3 w-3" />
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {filteredRecords.length === 0 && (
              <tr>
                <td colSpan={canUnlockSheets() ? 12 : 11} className="text-center py-8 text-muted-foreground">
                  {records.length === 0 
                    ? `No clients have ${returnType} selected.`
                    : 'No records match your filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading...</p>
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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Filing Status</h1>
          <p className="text-muted-foreground">Track GST return filing status for all clients</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="flex items-center gap-2" onClick={handleExportPDF}>
            <Download className="h-4 w-4" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters:</span>
            </div>
            
            {/* Month Selector */}
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-36">
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

            {/* Client Name Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search client..."
                value={clientNameFilter}
                onChange={(e) => setClientNameFilter(e.target.value)}
                className="pl-9 w-48"
              />
            </div>

            {(clientNameFilter || selectedTargetDates.length > 0 || selectedStatuses.length > 0) && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => {
                  setClientNameFilter('');
                  setSelectedTargetDates([]);
                  setSelectedStatuses([]);
                }}
              >
                Clear All Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Return Type Tabs */}
      <Card>
        <CardContent className="p-4">
          <Tabs value={selectedTab} onValueChange={setSelectedTab}>
            <TabsList className="grid grid-cols-6 w-full mb-4">
              <TabsTrigger value="gstr1">GSTR-1</TabsTrigger>
              <TabsTrigger value="gstr3b">GSTR-3B</TabsTrigger>
              <TabsTrigger value="itc04">ITC-04</TabsTrigger>
              <TabsTrigger value="gstr6">GSTR-6</TabsTrigger>
              <TabsTrigger value="gstr7">GSTR-7</TabsTrigger>
              <TabsTrigger value="cmp08">CMP-08</TabsTrigger>
            </TabsList>

            <TabsContent value="gstr1">
              <FilingTable records={generateAllFilingRecords('GSTR-1')} returnType="GSTR-1" />
            </TabsContent>
            <TabsContent value="gstr3b">
              <FilingTable records={generateAllFilingRecords('GSTR-3B')} returnType="GSTR-3B" />
            </TabsContent>
            <TabsContent value="itc04">
              <FilingTable records={generateAllFilingRecords('ITC-04')} returnType="ITC-04" />
            </TabsContent>
            <TabsContent value="gstr6">
              <FilingTable records={generateAllFilingRecords('GSTR-6')} returnType="GSTR-6" />
            </TabsContent>
            <TabsContent value="gstr7">
              <FilingTable records={generateAllFilingRecords('GSTR-7')} returnType="GSTR-7" />
            </TabsContent>
            <TabsContent value="cmp08">
              <FilingTable records={generateAllFilingRecords('CMP-08')} returnType="CMP-08" />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default FilingStatusPage;
