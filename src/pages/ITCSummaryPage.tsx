import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { Badge } from '@/components/ui/badge';
import { isQuarterEndMonth } from '@/types';
import { Lock, AlertCircle, Save, Download, History } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { exportITCSummaryToPDF } from '@/utils/itcPdfExport';
import GSTPortalLink from '@/components/clients/GSTPortalLink';
import GenericVersionHistoryDialog, { GenericVersion } from '@/components/dialogs/GenericVersionHistoryDialog';
import * as XLSX from 'xlsx';

interface ITCRow {
  srNo: string;
  particular: string;
  igst: number;
  cgst: number;
  sgst: number;
  isHeader?: boolean;
  isAutoLinked?: boolean;
  editable?: boolean;
  reasons?: string;
}

interface ITCData {
  section4A: ITCRow[];
  section4B: ITCRow[];
  section4D: ITCRow[];
}

interface Client {
  id: string;
  name: string;
  gstin: string;
  registration_type?: string;
  regular_sub_type?: string | null;
  builder_itc_type?: string | null;
  commercial_area?: number | null;
  residential_area?: number | null;
}

const getDefaultITCData = (): ITCData => ({
  section4A: [
    { srNo: '(1)', particular: 'Import of Goods', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '(2)', particular: 'Import of Services', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '(3)', particular: 'RCM ITC', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '(4)', particular: 'Inward Supplies from ISD', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '(5)', particular: 'All other ITC', igst: 0, cgst: 0, sgst: 0, isHeader: true, reasons: '' },
    { srNo: '5.1', particular: 'ITC for the Month', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '5.2', particular: 'ITC for Previous Month, if any', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '5.3', particular: 'Debit Note', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '5.4', particular: 'Reclaim of ITC Reversed for Previous months', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true, reasons: '' },
    { srNo: '5.5', particular: 'Reclaim of ITC Reversed due to 180 days rule', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
  ],
  section4B: [
    { srNo: '(1)', particular: 'ITC Reversal under Rule 38, 42 & 43, and Section 17(5)', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '(2)', particular: 'Others', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '', particular: 'ITC Reversal for current month as per 2B RECO', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true, reasons: '' },
    { srNo: '', particular: 'ITC Reversal for previous months, if any', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '', particular: 'ITC Reversal due to 180 days Analysis', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
  ],
  section4D: [
    { srNo: '(1)', particular: 'ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true, reasons: '' },
    { srNo: '1.1', particular: 'Reclaim of ITC Reversed for Previous months', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true, reasons: '' },
    { srNo: '1.2', particular: 'Reclaim of ITC Reversed due to 180 days rule', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '(2)', particular: 'Ineligible ITC under section 16(4) & ITC restricted due to PoS rules', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
  ],
});

// Partial ITC Data structure for Builder clients with PARTIAL_ITC
// FORMULAS as per Excel:
// - 4(B)(1) = SUM(i + ii + iii) - AUTO-CALCULATED
// - i) On ITC as per 4A = Total 4A × (Residential / Total Area) - AUTO-CALCULATED
// - ii) Previous Month Adjustment - EDITABLE
// - iii) On Other reversal - EDITABLE (user enters this value)
// - 4(B)(2) = SUM of sub-rows - AUTO-CALCULATED
const getPartialITCData = (): ITCData => ({
  section4A: [
    { srNo: '(1)', particular: 'Import of Goods', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '(2)', particular: 'Import of Services', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '(3)', particular: 'RCM ITC', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true, reasons: '' },
    { srNo: '(4)', particular: 'Inward Supplies from ISD', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '(5)', particular: 'All other ITC', igst: 0, cgst: 0, sgst: 0, isHeader: true, reasons: '' },
    { srNo: '5.1', particular: 'ITC for the Month', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '5.2', particular: 'ITC wrongly adjusted', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '5.3', particular: 'Debit Note', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '5.4', particular: 'Reclaim of ITC Reversed for the Previous months', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true, reasons: '' },
    { srNo: '5.5', particular: 'Reclaim of ITC Reversed due to 180 days rule', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
  ],
  section4B: [
    // Row (1) = SUM(i + ii + iii) - AUTO-CALCULATED (not editable)
    { srNo: '(1)', particular: 'Calculation of Ineligible ITC under Rule - 38, 42 & 43, and Section 17(5)', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true, reasons: '' },
    // i) On ITC as per 4A = Total 4A × (Residential Area / Total Area) - AUTO-CALCULATED
    { srNo: '', particular: 'i) On ITC as per 4A', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true, reasons: '' },
    // ii) Previous Month Adjustment - EDITABLE
    { srNo: '', particular: 'ii) Previous Month Adjustment', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    // iii) On Other reversal = -Total(4B)(2) × (Residential / Total Area) - AUTO-CALCULATED
    { srNo: '', particular: 'iii) On Other reversal', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true, reasons: '' },
    // Row (2) = SUM of sub-rows - AUTO-CALCULATED (isHeader marks it as a total row)
    { srNo: '(2)', particular: 'Others', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true, reasons: '' },
    { srNo: '', particular: 'ITC Reversal for the current month as per 2B RECO', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true, reasons: '' },
    { srNo: '', particular: 'ITC Reversal for the previous months, if any.', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
  ],
  section4D: [
    { srNo: '(1)', particular: 'ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period *', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true, reasons: '' },
    { srNo: '1.1', particular: 'Reclaim of ITC Reversed for the Previous months', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true, reasons: '' },
    { srNo: '1.2', particular: 'Reclaim of ITC Reversed due to 180 days rule', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
    { srNo: '(2)', particular: 'Ineligible ITC under section 16(4) & ITC restricted due to PoS rules *', igst: 0, cgst: 0, sgst: 0, editable: true, reasons: '' },
  ],
});

interface ReversalTotals {
  igst: number;
  cgst: number;
  sgst: number;
}

const ITCSummaryPage: React.FC = () => {
  const { canUnlockSheets, user, isStaffRole } = useAuth();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const selectedClient = selectedClientId;
  const setSelectedClient = setSelectedClientId;
  const [isLocked, setIsLocked] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [itcSummaryId, setItcSummaryId] = useState<string | null>(null);
  const [reversalFromReco, setReversalFromReco] = useState<ReversalTotals>({ igst: 0, cgst: 0, sgst: 0 });
  const [reclaimFromReco, setReclaimFromReco] = useState<ReversalTotals>({ igst: 0, cgst: 0, sgst: 0 });
  const [rcmTotals, setRcmTotals] = useState<ReversalTotals>({ igst: 0, cgst: 0, sgst: 0 });
  const [negativeValueError, setNegativeValueError] = useState<string | null>(null);
  const [dataLoadVersion, setDataLoadVersion] = useState(0);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versions, setVersions] = useState<GenericVersion[]>([]);

  const canViewVersions = user?.role === 'superadmin' || user?.role === 'gst_manager';

  // Editable ITC data state
  const [itcData, setItcData] = useState<ITCData>(getDefaultITCData());

  const selectedClientData = clients.find(c => c.id === selectedClient);

  // Check if client is a Partial ITC Builder client
  const isPartialITCClient = selectedClientData?.builder_itc_type === 'PARTIAL_ITC';
  const commercialArea = selectedClientData?.commercial_area || 0;
  const residentialArea = selectedClientData?.residential_area || 0;

  // Check if client requires quarterly months only (IFF or Composition)
  const isQuarterlyClient = selectedClientData?.registration_type === 'IFF' || selectedClientData?.registration_type === 'Composition';

  // Generate month options for dropdown - filter for quarterly clients
  const monthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    
    // Generate 24 months (12 past + 12 future)
    for (let i = -12; i <= 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthNum = date.getMonth() + 1;
      
      // Skip non-quarter-end months for IFF/Composition clients
      if (isQuarterlyClient && !isQuarterEndMonth(monthNum)) {
        continue;
      }
      
      const value = `${String(monthNum).padStart(2, '0')}/${date.getFullYear()}`;
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const label = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
      months.push({ value, label });
    }
    
    // Sort descending
    return months.sort((a, b) => {
      const [aM, aY] = a.value.split('/').map(Number);
      const [bM, bY] = b.value.split('/').map(Number);
      return bY * 12 + bM - (aY * 12 + aM);
    });
  }, [isQuarterlyClient]);

  // Fetch clients from Supabase - filtered for client role
  useEffect(() => {
    const fetchClients = async () => {
      console.log('Fetching clients from Supabase...');
      let query = supabase
        .from('clients')
        .select('id, name, gstin, registration_type, regular_sub_type, builder_itc_type, commercial_area, residential_area')
        .order('name');
      
      // If user is a client, match by their client id (user.id is client's id for client login)
      if (user && !isStaffRole()) {
        query = query.eq('id', user.id);
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.error('Error fetching clients:', error);
        toast.error('Failed to load clients: ' + error.message);
        return;
      }
      console.log('Clients loaded:', data);
      setClients(data || []);
      
      // Auto-select if client user and only one client
      if (!isStaffRole() && data && data.length > 0 && !selectedClient) {
        setSelectedClient(data[0].id);
      }
    };
    fetchClients();

    // Real-time subscription for clients
    const channel = supabase
      .channel('clients-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => {
        fetchClients();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isStaffRole]);

  // Convert month format "01/2026" to various patterns for matching
  const getMonthPatterns = (monthStr: string) => {
    const [monthNum, year] = monthStr.split('/');
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthName = monthNames[parseInt(monthNum) - 1] || '';
    const yearShort = year?.slice(-2) || '';
    const yearSingle = year?.slice(-1) || '';
    
    return {
      monthName,
      yearShort,
      yearSingle,
      fullYear: year || '',
      monthNum,
    };
  };

  // Check if a stored month value matches the selected month
  const monthMatches = (storedMonth: string | null, selectedPatterns: ReturnType<typeof getMonthPatterns>): boolean => {
    if (!storedMonth) return false;
    const stored = storedMonth.toLowerCase().trim();
    const { monthName, yearShort, yearSingle, fullYear } = selectedPatterns;
    
    // Match patterns like "jan-6", "jan-26", "jan-2026", "Jan 26", "01/2026", etc.
    const hasMonth = stored.includes(monthName);
    const hasYear = stored.includes(yearShort) || stored.includes(yearSingle) || stored.includes(fullYear);
    
    return hasMonth && hasYear;
  };

  // Fetch reversal and reclaim data from 2B Reconciliation
  const fetchRecoData = useCallback(async () => {
    if (!selectedClient || !selectedMonth) {
      setReversalFromReco({ igst: 0, cgst: 0, sgst: 0 });
      setReclaimFromReco({ igst: 0, cgst: 0, sgst: 0 });
      return;
    }

    const patterns = getMonthPatterns(selectedMonth);

    // Fetch all bills with reversal_month for this client
    // IMPORTANT: Exclude carried-forward records to prevent double-counting
    const { data: reversalBills, error: reversalError } = await supabase
      .from('bills_not_in_2b')
      .select('input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward')
      .eq('client_id', selectedClient)
      .not('reversal_month', 'is', null)
      .or('is_carried_forward.is.null,is_carried_forward.eq.false');
    
    if (reversalError) {
      console.error('Error fetching reversal data:', reversalError);
    } else if (reversalBills) {
      // Filter bills where reversal_month matches selected month
      const matchingReversals = reversalBills.filter(b => monthMatches(b.reversal_month, patterns));

      const totals = matchingReversals.reduce((acc, b) => ({
        igst: acc.igst + (b.input_igst || 0),
        cgst: acc.cgst + (b.input_cgst || 0),
        sgst: acc.sgst + (b.input_sgst || 0),
      }), { igst: 0, cgst: 0, sgst: 0 });

      console.log('Reversal totals for', selectedMonth, ':', totals, 'from', matchingReversals.length, 'bills');
      setReversalFromReco(totals);
    }

    // Fetch all bills with reclaim_month for this client
    // NOTE: Include carried-forward records for reclaim totals (only reversal excludes CF)
    const { data: reclaimBills, error: reclaimError } = await supabase
      .from('bills_not_in_2b')
      .select('input_igst, input_cgst, input_sgst, reclaim_month')
      .eq('client_id', selectedClient)
      .not('reclaim_month', 'is', null);
    
    if (reclaimError) {
      console.error('Error fetching reclaim data:', reclaimError);
    } else if (reclaimBills) {
      // Filter bills where reclaim_month matches selected month
      const matchingReclaims = reclaimBills.filter(b => monthMatches(b.reclaim_month, patterns));

      const totals = matchingReclaims.reduce((acc, b) => ({
        igst: acc.igst + (b.input_igst || 0),
        cgst: acc.cgst + (b.input_cgst || 0),
        sgst: acc.sgst + (b.input_sgst || 0),
      }), { igst: 0, cgst: 0, sgst: 0 });

      console.log('Reclaim totals for', selectedMonth, ':', totals, 'from', matchingReclaims.length, 'bills');
      setReclaimFromReco(totals);
    }
  }, [selectedClient, selectedMonth]);

  // Fetch ITC Summary data when client/month changes
  const fetchITCSummary = useCallback(async () => {
    if (!selectedClient || !selectedMonth) return;

    // Get client data to check for Partial ITC type
    const clientData = clients.find(c => c.id === selectedClient);
    const isPartial = clientData?.builder_itc_type === 'PARTIAL_ITC';
    const commArea = clientData?.commercial_area || 0;
    const resArea = clientData?.residential_area || 0;

    const { data, error } = await supabase
      .from('itc_summaries')
      .select('*')
      .eq('client_id', selectedClient)
      .eq('period_month', selectedMonth)
      .maybeSingle();

    if (error) {
      console.error('Error fetching ITC summary:', error);
      return;
    }

    // Also check if GSTR-3B or GSTR-3B (Q) is filed for this period - if so, sheet should be locked
    // Check for both GSTR-3B and GSTR-3B (Q) based on client registration type
    const { data: filingData } = await supabase
      .from('filing_status')
      .select('status, is_locked, return_type')
      .eq('client_id', selectedClient)
      .eq('period_month', selectedMonth)
      .in('return_type', ['GSTR-3B', 'GSTR-3B (Q)']);

    // Check if either GSTR-3B or GSTR-3B (Q) is filed
    const isFiledLocked = filingData?.some(f => f.status === 'Filed' || f.is_locked) || false;

    if (data) {
      setItcSummaryId(data.id);
      setIsLocked(data.is_locked || isFiledLocked || false);
      const savedData = data.data as unknown as ITCData;
      if (savedData && savedData.section4A) {
        setItcData(savedData);
        // Increment version to trigger auto-link effect after data loads
        setDataLoadVersion(v => v + 1);
      }
    } else {
      setItcSummaryId(null);
      // Even if no ITC summary record exists, lock if GSTR-3B is filed
      setIsLocked(isFiledLocked || false);
      // Use appropriate ITC structure based on client type
      if (isPartial) {
        setItcData(getPartialITCData());
      } else {
        setItcData(getDefaultITCData());
      }
      // Increment version for fresh data too
      setDataLoadVersion(v => v + 1);
    }
  }, [selectedClient, selectedMonth, clients]);

  // Fetch RCM totals for selected client and month
  const fetchRCMTotals = useCallback(async () => {
    if (!selectedClient || !selectedMonth) {
      setRcmTotals({ igst: 0, cgst: 0, sgst: 0 });
      return;
    }

    // Convert selectedMonth "04/2025" to RCM month format "Apr-25"
    const [monthNum, year] = selectedMonth.split('/');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = monthNames[parseInt(monthNum) - 1];
    const rcmMonth = `${monthName}-${year.slice(-2)}`;

    const { data: rcmData, error } = await supabase
      .from('rcm_data')
      .select('cgst_2_5, cgst_9, sgst_2_5, sgst_9, igst_5, igst_18')
      .eq('client_id', selectedClient)
      .eq('month', rcmMonth);

    if (error) {
      console.error('Error fetching RCM data:', error);
      return;
    }

    if (rcmData && rcmData.length > 0) {
      const totals = rcmData.reduce((acc, row) => ({
        igst: acc.igst + (Number(row.igst_5) || 0) + (Number(row.igst_18) || 0),
        cgst: acc.cgst + (Number(row.cgst_2_5) || 0) + (Number(row.cgst_9) || 0),
        sgst: acc.sgst + (Number(row.sgst_2_5) || 0) + (Number(row.sgst_9) || 0),
      }), { igst: 0, cgst: 0, sgst: 0 });

      console.log('RCM totals for', rcmMonth, ':', totals);
      setRcmTotals(totals);
    } else {
      setRcmTotals({ igst: 0, cgst: 0, sgst: 0 });
    }
  }, [selectedClient, selectedMonth]);

  useEffect(() => {
    fetchITCSummary();
    fetchRecoData();
    fetchRCMTotals();
  }, [fetchITCSummary, fetchRecoData, fetchRCMTotals]);

  // Update auto-linked rows when reversal/reclaim/RCM data changes OR when data is loaded
  useEffect(() => {
    console.log('Auto-linking triggered - RCM totals:', rcmTotals, 'dataLoadVersion:', dataLoadVersion);
    
    setItcData(prev => {
      const newData = { ...prev };
      
      // Update Section 4A rows
      newData.section4A = prev.section4A.map(row => {
        // Row (3) RCM ITC - auto-linked from RCM Summary for ALL client types
        if (row.srNo === '(3)' && row.particular.includes('RCM')) {
          console.log('Updating RCM row with:', rcmTotals);
          return { 
            ...row, 
            igst: rcmTotals.igst, 
            cgst: rcmTotals.cgst, 
            sgst: rcmTotals.sgst,
            isAutoLinked: true
          };
        }
        // Row 5.4 - reclaim data
        if (row.srNo === '5.4') {
          return { 
            ...row, 
            igst: reclaimFromReco.igst, 
            cgst: reclaimFromReco.cgst, 
            sgst: reclaimFromReco.sgst 
          };
        }
        return row;
      });
      
      // Update Section 4B row "ITC Reversal for current month as per 2B RECO" with reversal data
      // Match both regular and Partial ITC versions of the text
      newData.section4B = prev.section4B.map(row => {
        if (row.particular.includes('ITC Reversal for') && row.particular.includes('current month as per 2B RECO')) {
          return { 
            ...row, 
            igst: reversalFromReco.igst, 
            cgst: reversalFromReco.cgst, 
            sgst: reversalFromReco.sgst 
          };
        }
        return row;
      });

      // Update Section 4D row (1) and 1.1 to match 5.4 reclaim values
      newData.section4D = prev.section4D.map(row => {
        if (row.srNo === '(1)' || row.srNo === '1.1') {
          return { 
            ...row, 
            igst: reclaimFromReco.igst, 
            cgst: reclaimFromReco.cgst, 
            sgst: reclaimFromReco.sgst 
          };
        }
        return row;
      });
      
      return newData;
    });
  }, [reversalFromReco, reclaimFromReco, rcmTotals, dataLoadVersion]);

  // Calculate Partial ITC formula values (used in rendering)
  // FORMULAS as per Excel:
  // - 4(B)(1) = i) + ii) + iii) - AUTO-CALCULATED SUM
  // - i) On ITC as per 4A = Total 4A × (Residential / Total Area) - AUTO-CALCULATED
  // - ii) Previous Month Adjustment - EDITABLE
  // - iii) On Other reversal = -Total(4B)(2) × (Residential / Total Area) - AUTO-CALCULATED
  // - 4(B)(2) = SUM of sub-rows - AUTO-CALCULATED
  const partialITCCalculatedValues = useMemo(() => {
    if (!isPartialITCClient) return null;
    
    const totalArea = commercialArea + residentialArea;
    if (totalArea === 0) return null;

    // Calculate Total 4A first
    const rows1To4Values = itcData.section4A.slice(0, 4).reduce((acc, row) => ({
      igst: acc.igst + row.igst,
      cgst: acc.cgst + row.cgst,
      sgst: acc.sgst + row.sgst,
    }), { igst: 0, cgst: 0, sgst: 0 });

    const total5Values = {
      igst: (itcData.section4A.find(r => r.srNo === '5.1')?.igst || 0)
          + (itcData.section4A.find(r => r.srNo === '5.2')?.igst || 0)
          - (itcData.section4A.find(r => r.srNo === '5.3')?.igst || 0)
          + (itcData.section4A.find(r => r.srNo === '5.4')?.igst || 0)
          + (itcData.section4A.find(r => r.srNo === '5.5')?.igst || 0),
      cgst: (itcData.section4A.find(r => r.srNo === '5.1')?.cgst || 0)
          + (itcData.section4A.find(r => r.srNo === '5.2')?.cgst || 0)
          - (itcData.section4A.find(r => r.srNo === '5.3')?.cgst || 0)
          + (itcData.section4A.find(r => r.srNo === '5.4')?.cgst || 0)
          + (itcData.section4A.find(r => r.srNo === '5.5')?.cgst || 0),
      sgst: (itcData.section4A.find(r => r.srNo === '5.1')?.sgst || 0)
          + (itcData.section4A.find(r => r.srNo === '5.2')?.sgst || 0)
          - (itcData.section4A.find(r => r.srNo === '5.3')?.sgst || 0)
          + (itcData.section4A.find(r => r.srNo === '5.4')?.sgst || 0)
          + (itcData.section4A.find(r => r.srNo === '5.5')?.sgst || 0),
    };

    const total4AValues = {
      igst: rows1To4Values.igst + total5Values.igst,
      cgst: rows1To4Values.cgst + total5Values.cgst,
      sgst: rows1To4Values.sgst + total5Values.sgst,
    };

    // Residential ratio for ineligible ITC calculation
    const residentialRatio = residentialArea / totalArea;

    // i) On ITC as per 4A = Total 4A × (Residential Area / Total Area) - AUTO-CALCULATED
    const onITCAsPerA = {
      igst: Math.round((total4AValues.igst * residentialRatio) * 100) / 100,
      cgst: Math.round((total4AValues.cgst * residentialRatio) * 100) / 100,
      sgst: Math.round((total4AValues.sgst * residentialRatio) * 100) / 100,
    };

    // ii) Previous Month Adjustment - EDITABLE (get from data)
    const prevMonthAdjRow = itcData.section4B.find(r => r.particular.includes('Previous Month Adjustment'));
    const prevMonthAdj = {
      igst: prevMonthAdjRow?.igst || 0,
      cgst: prevMonthAdjRow?.cgst || 0,
      sgst: prevMonthAdjRow?.sgst || 0,
    };

    // Calculate 4(B)(2) first = SUM of sub-rows (ITC Reversal current month + previous months)
    const recoReversalRow = itcData.section4B.find(r => r.particular.includes('current month as per 2B RECO'));
    const prevMonthsReversalRow = itcData.section4B.find(r => r.particular.includes('previous months, if any'));
    
    const row2Calculated = {
      igst: (recoReversalRow?.igst || 0) + (prevMonthsReversalRow?.igst || 0),
      cgst: (recoReversalRow?.cgst || 0) + (prevMonthsReversalRow?.cgst || 0),
      sgst: (recoReversalRow?.sgst || 0) + (prevMonthsReversalRow?.sgst || 0),
    };

    // iii) On Other reversal = -Total(4B)(2) × (Residential / Total Area) - AUTO-CALCULATED
    // This is NEGATIVE of (row 2 × residential ratio)
    const onOtherReversal = {
      igst: Math.round((-row2Calculated.igst * residentialRatio) * 100) / 100,
      cgst: Math.round((-row2Calculated.cgst * residentialRatio) * 100) / 100,
      sgst: Math.round((-row2Calculated.sgst * residentialRatio) * 100) / 100,
    };

    // 4(B)(1) = SUM(i + ii + iii) - AUTO-CALCULATED
    const main1Calculated = {
      igst: Math.round((onITCAsPerA.igst + prevMonthAdj.igst + onOtherReversal.igst) * 100) / 100,
      cgst: Math.round((onITCAsPerA.cgst + prevMonthAdj.cgst + onOtherReversal.cgst) * 100) / 100,
      sgst: Math.round((onITCAsPerA.sgst + prevMonthAdj.sgst + onOtherReversal.sgst) * 100) / 100,
    };

    console.log('Partial ITC Calculations:', {
      total4AValues,
      residentialRatio,
      onITCAsPerA,
      prevMonthAdj,
      row2Calculated,
      onOtherReversal,
      main1Calculated,
    });

    return {
      onITCAsPerA,
      onOtherReversal,
      main1Calculated,
      row2Calculated,
    };
  }, [isPartialITCClient, commercialArea, residentialArea, itcData.section4A, itcData.section4B]);

  // Real-time subscription
  useEffect(() => {
    if (!selectedClient || !selectedMonth) return;

    const channel = supabase
      .channel('itc-summary-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'itc_summaries',
          filter: `client_id=eq.${selectedClient}`
        },
        (payload) => {
          console.log('ITC Summary real-time update:', payload);
          if (payload.new && (payload.new as any).period_month === selectedMonth) {
            const newData = payload.new as any;
            setItcSummaryId(newData.id);
            setIsLocked(newData.is_locked || false);
            if (newData.data && newData.data.section4A) {
              setItcData(newData.data as ITCData);
              toast.info('ITC Summary updated by another user');
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedClient, selectedMonth]);

  // Handle cell value change with CGST/SGST sync
  const handleCellChange = (section: keyof ITCData, rowIndex: number, field: 'igst' | 'cgst' | 'sgst', value: string) => {
    if (isLocked) return;

    const numValue = parseFloat(value) || 0;
    
    setItcData(prev => {
      const newData = { ...prev };
      const newSection = [...newData[section]];
      
      // Update the changed field
      newSection[rowIndex] = { ...newSection[rowIndex], [field]: numValue };
      
      // Auto-sync CGST and SGST: when one changes, update the other to match
      if (field === 'cgst') {
        newSection[rowIndex] = { ...newSection[rowIndex], sgst: numValue };
      } else if (field === 'sgst') {
        newSection[rowIndex] = { ...newSection[rowIndex], cgst: numValue };
      }
      
      newData[section] = newSection;

      // Auto-link 4(d)(1) and 4(d) 1.1 to 4(a) 5.4 value
      if (section === 'section4A' && newSection[rowIndex].srNo === '5.4') {
        const reclaimValue = newSection[rowIndex].igst;
        newData.section4D = newData.section4D.map(row => {
          if (row.srNo === '(1)' || row.srNo === '1.1') {
            return { ...row, igst: reclaimValue };
          }
          return row;
        });
      }

      return newData;
    });
  };

  // Handle reasons change
  const handleReasonsChange = (section: keyof ITCData, rowIndex: number, value: string) => {
    if (isLocked) return;
    
    setItcData(prev => {
      const newData = { ...prev };
      const newSection = [...newData[section]];
      newSection[rowIndex] = { ...newSection[rowIndex], reasons: value };
      newData[section] = newSection;
      return newData;
    });
  };

  // Save to database
  const handleSave = async () => {
    if (!selectedClient || !selectedMonth) return;

    setIsSaving(true);
    try {
      const payload = {
        client_id: selectedClient,
        period_month: selectedMonth,
        data: JSON.parse(JSON.stringify(itcData)) as Json,
        updated_at: new Date().toISOString(),
      };

      if (itcSummaryId) {
        const { error } = await supabase
          .from('itc_summaries')
          .update(payload)
          .eq('id', itcSummaryId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('itc_summaries')
          .insert([payload])
          .select()
          .single();

        if (error) throw error;
        setItcSummaryId(data.id);
      }

      // Save version snapshot
      try {
        const { data: maxV } = await supabase.from('itc_versions').select('version_number').eq('client_id', selectedClient).eq('period_month', selectedMonth).order('version_number', { ascending: false }).limit(1);
        const nextV = (maxV?.[0]?.version_number || 0) + 1;
        await supabase.from('itc_versions').update({ is_current: false }).eq('client_id', selectedClient).eq('period_month', selectedMonth);
        await supabase.from('itc_versions').insert([{ client_id: selectedClient, period_month: selectedMonth, version_number: nextV, version_data: JSON.parse(JSON.stringify(itcData)), updated_by: user?.id, is_current: true, action_type: 'SAVE' }]);
        fetchVersions();
      } catch (vErr) { console.error('Error saving ITC version:', vErr); }

      toast.success('ITC Summary saved successfully');
    } catch (error: any) {
      console.error('Error saving ITC summary:', error);
      toast.error('Failed to save: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnlock = async () => {
    if (!itcSummaryId) return;

    try {
      const { error } = await supabase
        .from('itc_summaries')
        .update({ is_locked: false })
        .eq('id', itcSummaryId);

      if (error) throw error;
      setIsLocked(false);
      toast.success('ITC Summary Sheet unlocked successfully');
    } catch (error: any) {
      toast.error('Failed to unlock: ' + error.message);
    }
  };

  // Fetch ITC versions
  const fetchVersions = useCallback(async () => {
    if (!selectedClient || !selectedMonth) {
      setVersions([]);
      return;
    }
    try {
      const { data: versionsData } = await supabase
        .from('itc_versions')
        .select('*')
        .eq('client_id', selectedClient)
        .eq('period_month', selectedMonth)
        .order('version_number', { ascending: false });

      const userIds = [...new Set((versionsData || []).map(v => v.updated_by).filter(Boolean))];
      let userMap: Record<string, { name: string; role: string }> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('user_id, first_name').in('user_id', userIds);
        const { data: roles } = await supabase.from('user_roles').select('user_id, role').in('user_id', userIds);
        (profiles || []).forEach(p => { userMap[p.user_id] = { name: p.first_name, role: '' }; });
        (roles || []).forEach(r => { if (userMap[r.user_id]) userMap[r.user_id].role = r.role; });
      }
      setVersions((versionsData || []).map(v => ({
        id: v.id, versionNumber: v.version_number || 1, versionData: v.version_data,
        updatedBy: userMap[v.updated_by]?.name || 'Unknown', updatedByRole: userMap[v.updated_by]?.role || '',
        updatedAt: v.updated_at, isCurrent: v.is_current || false, actionType: v.action_type || 'SAVE',
        restoredFromVersionId: v.restored_from_version_id,
      })));
    } catch (error) { console.error('Error fetching ITC versions:', error); }
  }, [selectedClient, selectedMonth]);

  useEffect(() => { if (selectedClient && selectedMonth) fetchVersions(); }, [selectedClient, selectedMonth, fetchVersions]);

  const handleRestoreVersion = async (version: GenericVersion) => {
    if (!selectedClient || !selectedMonth) return;
    try {
      const versionData = version.versionData as ITCData;
      setItcData(versionData);
      // Save as RESTORE
      const { data: maxV } = await supabase.from('itc_versions').select('version_number').eq('client_id', selectedClient).eq('period_month', selectedMonth).order('version_number', { ascending: false }).limit(1);
      const nextV = (maxV?.[0]?.version_number || 0) + 1;
      await supabase.from('itc_versions').update({ is_current: false }).eq('client_id', selectedClient).eq('period_month', selectedMonth);
      await supabase.from('itc_versions').insert([{ client_id: selectedClient, period_month: selectedMonth, version_number: nextV, version_data: JSON.parse(JSON.stringify(versionData)), updated_by: user?.id, is_current: true, action_type: 'RESTORE', restored_from_version_id: version.id }]);
      toast.success(`Restored to version ${version.versionNumber}`);
      fetchVersions();
      setShowVersionHistory(false);
    } catch (error) { toast.error('Failed to restore version'); }
  };

  const handleDownloadVersion = (version: GenericVersion) => {
    try {
      const workbook = XLSX.utils.book_new();
      const sheetData = [['ITC Summary - Version ' + version.versionNumber], [`Client: ${selectedClientData?.name}`, `Month: ${selectedMonth}`], [`Saved: ${new Date(version.updatedAt).toLocaleString()}`, `By: ${version.updatedBy}`]];
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheetData), 'ITC Summary');
      XLSX.writeFile(workbook, `ITC_Version_${version.versionNumber}_${selectedClientData?.name?.replace(/\s+/g, '_')}_${selectedMonth.replace('/', '-')}.xlsx`);
      toast.success(`Downloaded version ${version.versionNumber}`);
    } catch (error) { toast.error('Failed to download version'); }
  };

  // Calculate Total (5) = 5.1 + 5.2 - 5.3 + 5.4 + 5.5
  const total5 = {
    igst: (itcData.section4A.find(r => r.srNo === '5.1')?.igst || 0)
        + (itcData.section4A.find(r => r.srNo === '5.2')?.igst || 0)
        - (itcData.section4A.find(r => r.srNo === '5.3')?.igst || 0)
        + (itcData.section4A.find(r => r.srNo === '5.4')?.igst || 0)
        + (itcData.section4A.find(r => r.srNo === '5.5')?.igst || 0),
    cgst: (itcData.section4A.find(r => r.srNo === '5.1')?.cgst || 0)
        + (itcData.section4A.find(r => r.srNo === '5.2')?.cgst || 0)
        - (itcData.section4A.find(r => r.srNo === '5.3')?.cgst || 0)
        + (itcData.section4A.find(r => r.srNo === '5.4')?.cgst || 0)
        + (itcData.section4A.find(r => r.srNo === '5.5')?.cgst || 0),
    sgst: (itcData.section4A.find(r => r.srNo === '5.1')?.sgst || 0)
        + (itcData.section4A.find(r => r.srNo === '5.2')?.sgst || 0)
        - (itcData.section4A.find(r => r.srNo === '5.3')?.sgst || 0)
        + (itcData.section4A.find(r => r.srNo === '5.4')?.sgst || 0)
        + (itcData.section4A.find(r => r.srNo === '5.5')?.sgst || 0),
  };

  // Total 4A = rows 1-4 + Total (5)
  const rows1To4 = itcData.section4A.slice(0, 4).reduce((acc, row) => ({
    igst: acc.igst + row.igst,
    cgst: acc.cgst + row.cgst,
    sgst: acc.sgst + row.sgst,
  }), { igst: 0, cgst: 0, sgst: 0 });

  const total4A = {
    igst: rows1To4.igst + total5.igst,
    cgst: rows1To4.cgst + total5.cgst,
    sgst: rows1To4.sgst + total5.sgst,
  };

  // Total 4B calculation differs for Partial ITC clients
  // For Partial ITC: Total 4B = (1) calculated + (2) calculated
  const total4B = useMemo(() => {
    if (isPartialITCClient && partialITCCalculatedValues) {
      // Use auto-calculated values for (1) and (2)
      const row1Vals = partialITCCalculatedValues.main1Calculated;
      const row2Vals = partialITCCalculatedValues.row2Calculated;
      
      return {
        igst: row1Vals.igst + row2Vals.igst,
        cgst: row1Vals.cgst + row2Vals.cgst,
        sgst: row1Vals.sgst + row2Vals.sgst,
      };
    } else {
      // For regular clients: sum all non-header rows
      return itcData.section4B
        .filter(row => !row.isHeader)
        .reduce((acc, row) => ({
          igst: acc.igst + row.igst,
          cgst: acc.cgst + row.cgst,
          sgst: acc.sgst + row.sgst,
        }), { igst: 0, cgst: 0, sgst: 0 });
    }
  }, [itcData.section4B, isPartialITCClient, partialITCCalculatedValues]);

  // Net ITC (4C) = 4A - 4B
  const net4C = {
    igst: total4A.igst - total4B.igst,
    cgst: total4A.cgst - total4B.cgst,
    sgst: total4A.sgst - total4B.sgst,
  };

  const totalReclaimed = itcData.section4A
    .filter(r => r.srNo === '5.4' || r.srNo === '5.5')
    .reduce((acc, r) => acc + r.igst + r.cgst + r.sgst, 0);

  // Total Reversal for Partial ITC also needs special handling
  const totalReversal = useMemo(() => {
    if (isPartialITCClient && partialITCCalculatedValues) {
      // Use auto-calculated values
      const row1Vals = partialITCCalculatedValues.main1Calculated;
      const row2Vals = partialITCCalculatedValues.row2Calculated;
      
      return (row1Vals.igst + row1Vals.cgst + row1Vals.sgst) +
             (row2Vals.igst + row2Vals.cgst + row2Vals.sgst);
    } else {
      return itcData.section4B
        .filter(r => !r.isHeader)
        .reduce((acc, r) => acc + r.igst + r.cgst + r.sgst, 0);
    }
  }, [itcData.section4B, isPartialITCClient, partialITCCalculatedValues]);

  const formatNumber = (num: number): string => {
    // Handle -0 case by converting to 0
    if (num === 0 || Object.is(num, -0)) return '0';
    return num.toLocaleString('en-IN');
  };

  const renderEditableCell = (section: keyof ITCData, rowIndex: number, row: ITCRow, field: 'igst' | 'cgst' | 'sgst') => {
    const canEdit = row.editable && !isLocked && !row.isAutoLinked;
    
    if (canEdit) {
      return (
        <Input
          type="number"
          value={row[field]}
          onChange={(e) => {
            const numVal = parseFloat(e.target.value) || 0;
            if (numVal < 0) {
              setNegativeValueError('Negative values are not allowed in ITC Summary.');
              setTimeout(() => setNegativeValueError(null), 3000);
              return;
            }
            handleCellChange(section, rowIndex, field, e.target.value);
          }}
          min={0}
          className="w-24 text-right h-8 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      );
    }
    return <span>{formatNumber(row[field])}</span>;
  };

  const handleExportPDF = () => {
    if (!selectedClientData) {
      toast.error('Please select a client first');
      return;
    }
    
    exportITCSummaryToPDF({
      clientName: selectedClientData.name,
      clientGstin: selectedClientData.gstin,
      month: selectedMonth,
      itcData,
      total5,
      total4A,
      total4B,
      net4C,
      totalReclaimed,
      totalReversal,
      isLocked,
    });
    
    toast.success('PDF exported successfully');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">ITC Summary</h1>
          <p className="text-muted-foreground">Input Tax Credit summary for the month</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedClient && (
            <Button variant="outline" onClick={handleExportPDF} className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Download PDF
            </Button>
          )}
          {selectedClient && !isLocked && (
            <Button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2">
              <Save className="h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save Changes'}
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
                value={selectedClient}
                onValueChange={setSelectedClient}
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
            {selectedClient && (
              <GSTPortalLink 
                clientId={selectedClient} 
                clientName={selectedClientData?.name} 
              />
            )}
            {canViewVersions && selectedClient && (
              <Button variant="outline" size="sm" onClick={() => setShowVersionHistory(true)}>
                <History className="h-4 w-4 mr-1" />
                View Versions
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Version History Dialog */}
      <GenericVersionHistoryDialog
        open={showVersionHistory}
        onOpenChange={setShowVersionHistory}
        versions={versions}
        onRestore={handleRestoreVersion}
        onDownload={handleDownloadVersion}
        onVersionDeleted={fetchVersions}
        title="Version History"
        subtitle={`${selectedClientData?.name || ''} - ${selectedMonth}`}
        tableName="itc_versions"
      />

      {!selectedClient ? (
        <Card>
          <CardContent className="p-12 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Please select a client to view ITC Summary.</p>
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

          {/* Summary Boxes */}
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <Card className="bg-success/5 border-success/20">
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">RECLAIMED</p>
                <p className="text-2xl font-bold text-success">₹{totalReclaimed.toLocaleString('en-IN')}</p>
              </CardContent>
            </Card>
            <Card className="bg-destructive/5 border-destructive/20">
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">REVERSAL</p>
                <p className="text-2xl font-bold text-destructive">₹{totalReversal.toLocaleString('en-IN')}</p>
              </CardContent>
            </Card>
          </div>

          {/* Lock indicator - No unlock button here, only on Filing Status page */}
          {isLocked && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 flex items-center gap-2 text-warning">
              <Lock className="h-4 w-4" />
              <span className="text-sm">This sheet is locked because the return has been filed.</span>
            </div>
          )}

          {/* ITC Summary Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>CLIENT NAME: {selectedClientData?.name}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    ITC SUMMARY FOR THE MONTH: {selectedMonth}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="gst-table">
                  <thead>
                    <tr>
                      <th className="w-20">Sr. No.</th>
                      <th>PARTICULAR</th>
                      <th className="text-right w-28">IGST</th>
                      <th className="text-right w-28">CGST</th>
                      <th className="text-right w-28">SGST</th>
                      <th className="text-right w-32">TOTAL</th>
                      <th className="w-40">REASONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Section 4A */}
                    <tr className="bg-primary/5">
                      <td colSpan={7} className="font-semibold">4 (A) ITC Available</td>
                    </tr>
                    {itcData.section4A.map((row, idx) => (
                      <React.Fragment key={`4a-${idx}`}>
                        <tr className={row.isAutoLinked ? 'cell-locked' : ''}>
                          <td>{row.srNo}</td>
                          <td className="flex items-center gap-2">
                            {row.particular}
                            {row.isAutoLinked && (
                              <Badge variant="outline" className="text-xs flex items-center gap-1">
                                <Lock className="h-3 w-3" />
                                Auto-linked
                              </Badge>
                            )}
                          </td>
                          <td className="text-right">{renderEditableCell('section4A', idx, row, 'igst')}</td>
                          <td className="text-right">{renderEditableCell('section4A', idx, row, 'cgst')}</td>
                          <td className="text-right">{renderEditableCell('section4A', idx, row, 'sgst')}</td>
                          <td className="text-right font-medium">
                            {(row.igst + row.cgst + row.sgst).toLocaleString('en-IN')}
                          </td>
                          <td>
                            {!row.isHeader && (
                              <Input
                                type="text"
                                value={row.reasons || ''}
                                onChange={(e) => handleReasonsChange('section4A', idx, e.target.value)}
                                placeholder="Reason..."
                                className="h-8 text-sm"
                                disabled={isLocked}
                              />
                            )}
                          </td>
                        </tr>
                        {/* Insert Total (5) row after row 5.5 */}
                        {row.srNo === '5.5' && (
                          <tr className="bg-muted/30 font-medium">
                            <td>Total (5)</td>
                            <td className="text-xs text-muted-foreground">Total (5) = 5.1+5.2-5.3+5.4+5.5</td>
                            <td className="text-right">{total5.igst.toLocaleString('en-IN')}</td>
                            <td className="text-right">{total5.cgst.toLocaleString('en-IN')}</td>
                            <td className="text-right">{total5.sgst.toLocaleString('en-IN')}</td>
                            <td className="text-right">
                              {(total5.igst + total5.cgst + total5.sgst).toLocaleString('en-IN')}
                            </td>
                            <td></td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                    <tr className="bg-muted/50 font-semibold">
                      <td></td>
                      <td>Total (4A)</td>
                      <td className="text-right">{total4A.igst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{total4A.cgst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{total4A.sgst.toLocaleString('en-IN')}</td>
                      <td className="text-right">
                        {(total4A.igst + total4A.cgst + total4A.sgst).toLocaleString('en-IN')}
                      </td>
                      <td></td>
                    </tr>

                    {/* Section 4B */}
                    <tr className="bg-primary/5">
                      <td colSpan={7} className="font-semibold">4 (B) ITC Reversed</td>
                    </tr>
                    {itcData.section4B.map((row, idx) => {
                      // Handle header rows differently (for Partial ITC structure)
                      if (row.isHeader) {
                        return (
                          <tr key={`4b-${idx}`} className="bg-muted/20 font-medium">
                            <td>{row.srNo}</td>
                            <td colSpan={6}>{row.particular}</td>
                          </tr>
                        );
                      }

                      // For Partial ITC: Use calculated values for auto-calculated rows
                      if (isPartialITCClient && partialITCCalculatedValues) {
                        // (1) main row - AUTO-CALCULATED = SUM(i + ii + iii)
                        if (row.srNo === '(1)' && row.particular.includes('Calculation of Ineligible ITC')) {
                          const vals = partialITCCalculatedValues.main1Calculated;
                          return (
                            <tr key={`4b-${idx}`} className="cell-locked">
                              <td>{row.srNo}</td>
                              <td className="flex items-center gap-2">
                                {row.particular}
                                <Badge variant="outline" className="text-xs flex items-center gap-1">
                                  <Lock className="h-3 w-3" />
                                  Auto-calculated
                                </Badge>
                              </td>
                              <td className="text-right">{formatNumber(vals.igst)}</td>
                              <td className="text-right">{formatNumber(vals.cgst)}</td>
                              <td className="text-right">{formatNumber(vals.sgst)}</td>
                              <td className="text-right font-medium">
                                {formatNumber(vals.igst + vals.cgst + vals.sgst)}
                              </td>
                              <td>
                                <Input
                                  type="text"
                                  value={row.reasons || ''}
                                  onChange={(e) => handleReasonsChange('section4B', idx, e.target.value)}
                                  placeholder="Reason..."
                                  className="h-8 text-sm"
                                  disabled={isLocked}
                                />
                              </td>
                            </tr>
                          );
                        }
                        // i) On ITC as per 4A - auto-calculated
                        if (row.particular === 'i) On ITC as per 4A') {
                          const vals = partialITCCalculatedValues.onITCAsPerA;
                          return (
                            <tr key={`4b-${idx}`} className="cell-locked">
                              <td>{row.srNo}</td>
                              <td className="flex items-center gap-2">
                                {row.particular}
                                <Badge variant="outline" className="text-xs flex items-center gap-1">
                                  <Lock className="h-3 w-3" />
                                  Auto-calculated
                                </Badge>
                              </td>
                              <td className="text-right">{formatNumber(vals.igst)}</td>
                              <td className="text-right">{formatNumber(vals.cgst)}</td>
                              <td className="text-right">{formatNumber(vals.sgst)}</td>
                              <td className="text-right font-medium">
                                {formatNumber(vals.igst + vals.cgst + vals.sgst)}
                              </td>
                              <td>
                                <Input
                                  type="text"
                                  value={row.reasons || ''}
                                  onChange={(e) => handleReasonsChange('section4B', idx, e.target.value)}
                                  placeholder="Reason..."
                                  className="h-8 text-sm"
                                  disabled={isLocked}
                                />
                              </td>
                            </tr>
                          );
                        }
                        // iii) On Other reversal = -Total(4B)(2) × (Residential / Total Area) - AUTO-CALCULATED
                        if (row.particular.includes('On Other reversal')) {
                          const vals = partialITCCalculatedValues.onOtherReversal;
                          return (
                            <tr key={`4b-${idx}`} className="cell-locked">
                              <td>{row.srNo}</td>
                              <td className="flex items-center gap-2">
                                {row.particular}
                                <Badge variant="outline" className="text-xs flex items-center gap-1">
                                  <Lock className="h-3 w-3" />
                                  Auto-calculated
                                </Badge>
                              </td>
                              <td className="text-right">{formatNumber(vals.igst)}</td>
                              <td className="text-right">{formatNumber(vals.cgst)}</td>
                              <td className="text-right">{formatNumber(vals.sgst)}</td>
                              <td className="text-right font-medium">
                                {formatNumber(vals.igst + vals.cgst + vals.sgst)}
                              </td>
                              <td>
                                <Input
                                  type="text"
                                  value={row.reasons || ''}
                                  onChange={(e) => handleReasonsChange('section4B', idx, e.target.value)}
                                  placeholder="Reason..."
                                  className="h-8 text-sm"
                                  disabled={isLocked}
                                />
                              </td>
                            </tr>
                          );
                        }
                        // (2) Others row - AUTO-CALCULATED = SUM of sub-rows
                        if (row.srNo === '(2)' && row.particular === 'Others') {
                          const vals = partialITCCalculatedValues.row2Calculated;
                          return (
                            <tr key={`4b-${idx}`} className="cell-locked">
                              <td>{row.srNo}</td>
                              <td className="flex items-center gap-2">
                                {row.particular}
                                <Badge variant="outline" className="text-xs flex items-center gap-1">
                                  <Lock className="h-3 w-3" />
                                  Auto-calculated
                                </Badge>
                              </td>
                              <td className="text-right">{formatNumber(vals.igst)}</td>
                              <td className="text-right">{formatNumber(vals.cgst)}</td>
                              <td className="text-right">{formatNumber(vals.sgst)}</td>
                              <td className="text-right font-medium">
                                {formatNumber(vals.igst + vals.cgst + vals.sgst)}
                              </td>
                              <td>
                                <Input
                                  type="text"
                                  value={row.reasons || ''}
                                  onChange={(e) => handleReasonsChange('section4B', idx, e.target.value)}
                                  placeholder="Reason..."
                                  className="h-8 text-sm"
                                  disabled={isLocked}
                                />
                              </td>
                            </tr>
                          );
                        }
                      }
                      
                      return (
                        <tr key={`4b-${idx}`} className={row.isAutoLinked ? 'cell-locked' : ''}>
                          <td>{row.srNo}</td>
                          <td className="flex items-center gap-2">
                            {row.particular}
                            {row.isAutoLinked && (
                              <Badge variant="outline" className="text-xs flex items-center gap-1">
                                <Lock className="h-3 w-3" />
                                Auto-linked
                              </Badge>
                            )}
                          </td>
                          <td className="text-right">{renderEditableCell('section4B', idx, row, 'igst')}</td>
                          <td className="text-right">{renderEditableCell('section4B', idx, row, 'cgst')}</td>
                          <td className="text-right">{renderEditableCell('section4B', idx, row, 'sgst')}</td>
                          <td className="text-right font-medium">
                            {(row.igst + row.cgst + row.sgst).toLocaleString('en-IN')}
                          </td>
                          <td>
                            <Input
                              type="text"
                              value={row.reasons || ''}
                              onChange={(e) => handleReasonsChange('section4B', idx, e.target.value)}
                              placeholder="Reason..."
                              className="h-8 text-sm"
                              disabled={isLocked}
                            />
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-muted/50 font-semibold">
                      <td></td>
                      <td>Total (4B)</td>
                      <td className="text-right">{total4B.igst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{total4B.cgst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{total4B.sgst.toLocaleString('en-IN')}</td>
                      <td className="text-right">
                        {(total4B.igst + total4B.cgst + total4B.sgst).toLocaleString('en-IN')}
                      </td>
                      <td></td>
                    </tr>

                    {/* Section 4C */}
                    <tr className="bg-success/10 font-bold">
                      <td>4 (C)</td>
                      <td>NET ITC AVAILABLE FOR THE MONTH (A - B)</td>
                      <td className="text-right">{net4C.igst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{net4C.cgst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{net4C.sgst.toLocaleString('en-IN')}</td>
                      <td className="text-right">
                        {(net4C.igst + net4C.cgst + net4C.sgst).toLocaleString('en-IN')}
                      </td>
                      <td></td>
                    </tr>

                    {/* Section 4D */}
                    <tr className="bg-primary/5">
                      <td colSpan={7} className="font-semibold">4 (D) Other Details</td>
                    </tr>
                    {itcData.section4D.map((row, idx) => (
                      <tr key={`4d-${idx}`} className={row.isAutoLinked ? 'cell-locked' : ''}>
                        <td>{row.srNo}</td>
                        <td className="flex items-center gap-2">
                          {row.particular}
                          {row.isAutoLinked && (
                            <Badge variant="outline" className="text-xs flex items-center gap-1">
                              <Lock className="h-3 w-3" />
                              Auto-linked
                            </Badge>
                          )}
                        </td>
                        <td className="text-right">{renderEditableCell('section4D', idx, row, 'igst')}</td>
                        <td className="text-right">{renderEditableCell('section4D', idx, row, 'cgst')}</td>
                        <td className="text-right">{renderEditableCell('section4D', idx, row, 'sgst')}</td>
                        <td className="text-right font-medium">
                          {(row.igst + row.cgst + row.sgst).toLocaleString('en-IN')}
                        </td>
                        <td>
                          <Input
                            type="text"
                            value={row.reasons || ''}
                            onChange={(e) => handleReasonsChange('section4D', idx, e.target.value)}
                            placeholder="Reason..."
                            className="h-8 text-sm"
                            disabled={isLocked}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Area Breakdown Table for Partial ITC Clients */}
              {isPartialITCClient && (
                <div className="mt-6 flex justify-end">
                  <table className="border-collapse border border-border">
                    <tbody>
                      <tr className="bg-muted/30">
                        <td className="border border-border px-4 py-2 font-medium">Commercial Area</td>
                        <td className="border border-border px-4 py-2 text-right text-primary font-medium">
                          {commercialArea.toLocaleString('en-IN')}
                        </td>
                      </tr>
                      <tr className="bg-muted/30">
                        <td className="border border-border px-4 py-2 font-medium">Residential Area</td>
                        <td className="border border-border px-4 py-2 text-right text-primary font-medium">
                          {residentialArea.toLocaleString('en-IN')}
                        </td>
                      </tr>
                      <tr className="bg-muted/50 font-semibold">
                        <td className="border border-border px-4 py-2">Total</td>
                        <td className="border border-border px-4 py-2 text-right text-primary">
                          {(commercialArea + residentialArea).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default ITCSummaryPage;
