import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { Badge } from '@/components/ui/badge';
import { Lock, AlertCircle, Unlock, Save, Download } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { exportITCSummaryToPDF } from '@/utils/itcPdfExport';

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

interface ReversalTotals {
  igst: number;
  cgst: number;
  sgst: number;
}

const ITCSummaryPage: React.FC = () => {
  const { canUnlockSheets, user, isStaffRole } = useAuth();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [isLocked, setIsLocked] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [itcSummaryId, setItcSummaryId] = useState<string | null>(null);
  const [reversalFromReco, setReversalFromReco] = useState<ReversalTotals>({ igst: 0, cgst: 0, sgst: 0 });
  const [reclaimFromReco, setReclaimFromReco] = useState<ReversalTotals>({ igst: 0, cgst: 0, sgst: 0 });

  // Editable ITC data state
  const [itcData, setItcData] = useState<ITCData>(getDefaultITCData());

  const selectedClientData = clients.find(c => c.id === selectedClient);

  // Generate month options for dropdown
  const monthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    
    // Generate 24 months (12 past + 12 future)
    for (let i = -12; i <= 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
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
  }, []);

  // Fetch clients from Supabase - filtered for client role
  useEffect(() => {
    const fetchClients = async () => {
      console.log('Fetching clients from Supabase...');
      let query = supabase
        .from('clients')
        .select('id, name, gstin')
        .order('name');
      
      // If user is a client, only fetch their own data
      if (user && !isStaffRole()) {
        query = query.eq('client_user_id', user.userId);
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
      if (!isStaffRole() && data && data.length === 1) {
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
    const { data: reversalBills, error: reversalError } = await supabase
      .from('bills_not_in_2b')
      .select('input_igst, input_cgst, input_sgst, reversal_month')
      .eq('client_id', selectedClient)
      .not('reversal_month', 'is', null);
    
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

    // Also check if GSTR-3B is filed for this period - if so, sheet should be locked
    const { data: filingData } = await supabase
      .from('filing_status')
      .select('status, is_locked')
      .eq('client_id', selectedClient)
      .eq('period_month', selectedMonth)
      .eq('return_type', 'GSTR-3B')
      .maybeSingle();

    const isFiledLocked = filingData?.status === 'Filed' || filingData?.is_locked;

    if (data) {
      setItcSummaryId(data.id);
      setIsLocked(data.is_locked || isFiledLocked || false);
      const savedData = data.data as unknown as ITCData;
      if (savedData && savedData.section4A) {
        setItcData(savedData);
      }
    } else {
      setItcSummaryId(null);
      // Even if no ITC summary record exists, lock if GSTR-3B is filed
      setIsLocked(isFiledLocked || false);
      setItcData(getDefaultITCData());
    }
  }, [selectedClient, selectedMonth]);

  useEffect(() => {
    fetchITCSummary();
    fetchRecoData();
  }, [fetchITCSummary, fetchRecoData]);

  // Update auto-linked rows when reversal/reclaim data changes from 2B Reco
  useEffect(() => {
    setItcData(prev => {
      const newData = { ...prev };
      
      // Update Section 4A, row 5.4 (Reclaim of ITC Reversed for Previous months) with reclaim data
      newData.section4A = prev.section4A.map(row => {
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
      newData.section4B = prev.section4B.map(row => {
        if (row.particular === 'ITC Reversal for current month as per 2B RECO') {
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
  }, [reversalFromReco, reclaimFromReco]);

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

  // Handle cell value change
  const handleCellChange = (section: keyof ITCData, rowIndex: number, field: 'igst' | 'cgst' | 'sgst', value: string) => {
    if (isLocked) return;

    const numValue = parseFloat(value) || 0;
    
    setItcData(prev => {
      const newData = { ...prev };
      const newSection = [...newData[section]];
      newSection[rowIndex] = { ...newSection[rowIndex], [field]: numValue };
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

  // Total 4B = sum of all 4B rows
  const total4B = itcData.section4B.reduce((acc, row) => ({
    igst: acc.igst + row.igst,
    cgst: acc.cgst + row.cgst,
    sgst: acc.sgst + row.sgst,
  }), { igst: 0, cgst: 0, sgst: 0 });

  // Net ITC (4C) = 4A - 4B
  const net4C = {
    igst: total4A.igst - total4B.igst,
    cgst: total4A.cgst - total4B.cgst,
    sgst: total4A.sgst - total4B.sgst,
  };

  const totalReclaimed = itcData.section4A
    .filter(r => r.srNo === '5.4' || r.srNo === '5.5')
    .reduce((acc, r) => acc + r.igst + r.cgst + r.sgst, 0);

  const totalReversal = itcData.section4B
    .reduce((acc, r) => acc + r.igst + r.cgst + r.sgst, 0);

  const renderEditableCell = (section: keyof ITCData, rowIndex: number, row: ITCRow, field: 'igst' | 'cgst' | 'sgst') => {
    const canEdit = row.editable && !isLocked && !row.isAutoLinked;
    
    if (canEdit) {
      return (
        <Input
          type="number"
          value={row[field]}
          onChange={(e) => handleCellChange(section, rowIndex, field, e.target.value)}
          className="w-24 text-right h-8 text-sm"
        />
      );
    }
    return <span>{row[field].toLocaleString('en-IN')}</span>;
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
          </div>
        </CardContent>
      </Card>

      {!selectedClient ? (
        <Card>
          <CardContent className="p-12 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Please select a client to view ITC Summary.</p>
          </CardContent>
        </Card>
      ) : (
        <>
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

          {/* Unlock Button for Superadmin/GST Manager */}
          {canUnlockSheets() && isLocked && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="flex items-center gap-2" onClick={handleUnlock}>
                <Unlock className="h-4 w-4" />
                Unlock ITC Summary Sheet
              </Button>
            </div>
          )}

          {/* Lock indicator */}
          {isLocked && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 flex items-center gap-2 text-warning">
              <Lock className="h-4 w-4" />
              <span className="text-sm">This sheet is locked because the return has been filed. Only Superadmin or GST Manager can unlock.</span>
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
                    {itcData.section4B.map((row, idx) => (
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
                    ))}
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
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default ITCSummaryPage;
