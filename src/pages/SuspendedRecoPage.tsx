import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, Save, Loader2, Download, Trash2, Upload, Info, Edit3, RefreshCw } from 'lucide-react';
import ClearDataDialog from '@/components/dialogs/ClearDataDialog';
import SuspendedRecoOverrideDialog from '@/components/dialogs/SuspendedRecoOverrideDialog';
import { exportSuspendedRecoToExcel } from '@/utils/suspendedRecoExcelExport';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { toast } from 'sonner';
import { parseElectronicCreditCsv, previousPeriodMonthKey, formatPeriodLabel } from '@/utils/parseElectronicCreditCsv';

type OpeningSource = 'manual' | 'csv' | 'not_applicable';

interface Client {
  id: string;
  name: string;
  gstin: string;
  registration_date?: string;
}

const SuspendedRecoPage: React.FC = () => {
  const { user, isStaffRole, canManualOverride } = useAuth();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showClearData, setShowClearData] = useState(false);
  const [lastSavedBy, setLastSavedBy] = useState<{ name: string; role: string; time: string } | null>(null);
  // Opening balance portal values (editable for legacy <Jun-26; for Jun-26+ set via Upload/NA/Override flow)
  const [openingCgst, setOpeningCgst] = useState<number>(0);
  const [openingSgst, setOpeningSgst] = useState<number>(0);
  const [openingIgst, setOpeningIgst] = useState<number>(0);

  // Opening balance source-tracking metadata (Jun-26+ only)
  const [openingSource, setOpeningSource] = useState<OpeningSource>('manual');
  const [openingCsvPeriodMonth, setOpeningCsvPeriodMonth] = useState<string | null>(null);
  const [openingCsvUploadedAt, setOpeningCsvUploadedAt] = useState<string | null>(null);
  const [openingCsvUploadedBy, setOpeningCsvUploadedBy] = useState<string | null>(null);
  const [openingCsvUploaderName, setOpeningCsvUploaderName] = useState<string | null>(null);
  const [openingOverrideJustification, setOpeningOverrideJustification] = useState<string | null>(null);
  const [openingOverrideAt, setOpeningOverrideAt] = useState<string | null>(null);
  const [openingOverrideBy, setOpeningOverrideBy] = useState<string | null>(null);
  const [openingOverriderName, setOpeningOverriderName] = useState<string | null>(null);
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Current total - auto-calculated from ITC Summary: (4B2i + 4B2ii) - (5.4 + 5.5)
  const [portalCgst, setPortalCgst] = useState<number>(0);
  const [portalSgst, setPortalSgst] = useState<number>(0);
  const [portalIgst, setPortalIgst] = useState<number>(0);

  // Books values (auto-linked from 2B)
  const [booksCgst, setBooksCgst] = useState<number>(0);
  const [booksSgst, setBooksSgst] = useState<number>(0);
  const [booksIgst, setBooksIgst] = useState<number>(0);

  const selectedClientData = clients.find(c => c.id === selectedClientId);
  const isStaff = isStaffRole();

  // Generate month options - limited to +2 months future (aligned with dashboard)
  const generateMonthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    const maxFutureMonths = 2;
    
    const client = clients.find(c => c.id === selectedClientId);
    let startDate = new Date(now.getFullYear(), now.getMonth() - 12, 1);
    
    if (client?.registration_date) {
      const regDate = new Date(client.registration_date);
      startDate = new Date(regDate.getFullYear(), regDate.getMonth(), 1);
    }
    
    const futureLimit = new Date(now.getFullYear(), now.getMonth() + maxFutureMonths, 1);
    let currentDate = new Date(startDate);
    
    while (currentDate <= futureLimit) {
      const value = `${String(currentDate.getMonth() + 1).padStart(2, '0')}/${currentDate.getFullYear()}`;
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
  }, [clients, selectedClientId]);

  // Fetch clients
  const fetchClients = useCallback(async () => {
    let query = supabase
      .from('clients')
      .select('id, name, gstin, registration_date')
      .order('name');
    
    if (user && !isStaff) {
      query = query.eq('id', user.id);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching clients:', error);
      return;
    }
    setClients(data || []);
    
    if (!isStaff && data && data.length > 0 && !selectedClientId) {
      setSelectedClientId(data[0].id);
    }
  }, [user, isStaff, selectedClientId, setSelectedClientId]);

  // Fetch suspended reco data
  const fetchData = useCallback(async () => {
    if (!selectedClientId || !selectedMonth) return;

    setIsLoading(true);
    try {
      // Fetch portal data from suspended_reco table (opening balance only)
      const { data: suspendedData } = await supabase
        .from('suspended_reco')
        .select('*')
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth)
        .maybeSingle();
      
      if (suspendedData) {
        const sd = suspendedData as any;
        setOpeningCgst(Number(sd.opening_cgst) || 0);
        setOpeningSgst(Number(sd.opening_sgst) || 0);
        setOpeningIgst(Number(sd.opening_igst) || 0);

        // Opening-balance source metadata (added Jun-26)
        setOpeningSource((sd.opening_source as OpeningSource) || 'manual');
        setOpeningCsvPeriodMonth(sd.opening_csv_period_month || null);
        setOpeningCsvUploadedAt(sd.opening_csv_uploaded_at || null);
        setOpeningCsvUploadedBy(sd.opening_csv_uploaded_by || null);
        setOpeningOverrideJustification(sd.opening_override_justification || null);
        setOpeningOverrideAt(sd.opening_override_at || null);
        setOpeningOverrideBy(sd.opening_override_by || null);

        // Resolve uploader/overrider first names for the info popover
        const ids: string[] = [];
        if (sd.opening_csv_uploaded_by) ids.push(sd.opening_csv_uploaded_by);
        if (sd.opening_override_by && sd.opening_override_by !== sd.opening_csv_uploaded_by) ids.push(sd.opening_override_by);
        let nameMap = new Map<string, string>();
        if (ids.length > 0) {
          const { data: profiles } = await supabase.from('profiles').select('user_id, first_name').in('user_id', ids);
          nameMap = new Map((profiles || []).map(p => [p.user_id, p.first_name || 'Unknown']));
        }
        setOpeningCsvUploaderName(sd.opening_csv_uploaded_by ? (nameMap.get(sd.opening_csv_uploaded_by) || 'Unknown') : null);
        setOpeningOverriderName(sd.opening_override_by ? (nameMap.get(sd.opening_override_by) || 'Unknown') : null);

        // Fetch last saved by info
        const updatedBy = sd.updated_by;
        const updatedAt = sd.updated_at;
        if (updatedBy) {
          const { data: profile } = await supabase.from('profiles').select('first_name').eq('user_id', updatedBy).maybeSingle();
          const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', updatedBy).maybeSingle();
          setLastSavedBy({
            name: profile?.first_name || 'Unknown',
            role: roleData?.role || '',
            time: updatedAt || '',
          });
        } else {
          setLastSavedBy(null);
        }
      } else {
        setOpeningCgst(0);
        setOpeningSgst(0);
        setOpeningIgst(0);
        setOpeningSource('manual');
        setOpeningCsvPeriodMonth(null);
        setOpeningCsvUploadedAt(null);
        setOpeningCsvUploadedBy(null);
        setOpeningCsvUploaderName(null);
        setOpeningOverrideJustification(null);
        setOpeningOverrideAt(null);
        setOpeningOverrideBy(null);
        setOpeningOverriderName(null);
        setLastSavedBy(null);
      }

      // Calculate "Current Total" using formula: (4B(2)(i) + 4B(2)(ii)) − (5.4 + 5.5)
      // 4B(2)(i) and 5.4 are auto-linked from bills_not_in_2b, so we calculate them live
      // 4B(2)(ii) and 5.5 are editable values stored in ITC summary

      // Helper to match month patterns (same logic as ITC Summary page)
      const getMonthPatterns = (monthStr: string) => {
        const [monthNum, year] = monthStr.split('/');
        const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const monthName = monthNames[parseInt(monthNum) - 1] || '';
        const yearShort = year?.slice(-2) || '';
        const yearSingle = year?.slice(-1) || '';
        return { monthName, yearShort, yearSingle, fullYear: year || '', monthNum };
      };

      const monthMatchesFn = (storedMonth: string | null, patterns: ReturnType<typeof getMonthPatterns>): boolean => {
        if (!storedMonth) return false;
        const stored = storedMonth.toLowerCase().trim();
        const { monthName, yearShort, yearSingle, fullYear } = patterns;
        const hasMonth = stored.includes(monthName);
        const hasYear = stored.includes(yearShort) || stored.includes(yearSingle) || stored.includes(fullYear);
        return hasMonth && hasYear;
      };

      const patterns = getMonthPatterns(selectedMonth);

      // 4B(2)(i): reversal bills where reversal_month matches current month
      const { data: reversalBills } = await supabase
        .from('bills_not_in_2b')
        .select('input_igst, input_cgst, input_sgst, reversal_month')
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth)
        .not('reversal_month', 'is', null);

      const matchingReversals = (reversalBills || []).filter(b => monthMatchesFn(b.reversal_month, patterns));
      const row4B2i = matchingReversals.reduce((acc, b) => ({
        cgst: acc.cgst + (Number(b.input_cgst) || 0),
        sgst: acc.sgst + (Number(b.input_sgst) || 0),
        igst: acc.igst + (Number(b.input_igst) || 0),
      }), { cgst: 0, sgst: 0, igst: 0 });

      // 5.4: reclaim bills where reclaim_month matches current month (excluding EXPENSE_OUT, handled via 4D 1.2)
      const { data: reclaimBills } = await supabase
        .from('bills_not_in_2b')
        .select('input_igst, input_cgst, input_sgst, reclaim_month, reclaim_subtype')
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth)
        .not('reclaim_month', 'is', null);

      const matchingReclaims = (reclaimBills || []).filter(b => monthMatchesFn(b.reclaim_month, patterns));
      // Only count normal reclaims for row 5.4 (expense out is separate via 4D 1.2)
      const normalReclaims = matchingReclaims.filter(b => (b as any).reclaim_subtype !== 'EXPENSE_OUT');
      const row54 = normalReclaims.reduce((acc, b) => ({
        cgst: acc.cgst + (Number(b.input_cgst) || 0),
        sgst: acc.sgst + (Number(b.input_sgst) || 0),
        igst: acc.igst + (Number(b.input_igst) || 0),
      }), { cgst: 0, sgst: 0, igst: 0 });

      // 4B(2)(ii) and 5.5: read from saved ITC summary (these are editable, not auto-linked)
      let row4B2ii = { cgst: 0, sgst: 0, igst: 0 };
      let row55 = { cgst: 0, sgst: 0, igst: 0 };
      let row4D12 = { cgst: 0, sgst: 0, igst: 0 };

      const { data: itcData } = await supabase
        .from('itc_summaries')
        .select('data')
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth)
        .maybeSingle();

      if (itcData?.data) {
        const itc = itcData.data as any;
        const section4A = itc.section4A || [];
        const section4B = itc.section4B || [];
        const section4D = itc.section4D || [];

        const found4B2ii = section4B.find((r: any) => r.srNo === '(ii)' || r.srNo === '4(B)(2)(ii)' || (r.particular && r.particular.includes('ITC Reversal for previous months')));
        if (found4B2ii) {
          row4B2ii = { cgst: Number(found4B2ii.cgst) || 0, sgst: Number(found4B2ii.sgst) || 0, igst: Number(found4B2ii.igst) || 0 };
        }

        const found55 = section4A.find((r: any) => r.srNo === '5.5');
        if (found55) {
          row55 = { cgst: Number(found55.cgst) || 0, sgst: Number(found55.sgst) || 0, igst: Number(found55.igst) || 0 };
        }

        // 4(D) 1.2 - Reclaim of ITC Reversed due to 180 days rule/Others
        const found4D12 = section4D.find((r: any) => r.srNo === '1.2');
        row4D12 = {
          cgst: Number(found4D12?.cgst) || 0,
          sgst: Number(found4D12?.sgst) || 0,
          igst: Number(found4D12?.igst) || 0,
        };
      }

      // Updated formula: (4B(2)(i) + 4B(2)(ii)) − (5.4 + 5.5 + 4(D) 1.2)
      setPortalCgst(row4B2i.cgst + row4B2ii.cgst - row54.cgst - row55.cgst - row4D12.cgst);
      setPortalSgst(row4B2i.sgst + row4B2ii.sgst - row54.sgst - row55.sgst - row4D12.sgst);
      setPortalIgst(row4B2i.igst + row4B2ii.igst - row54.igst - row55.igst - row4D12.igst);

      // Fetch books data from bills_not_in_2b 
      const { data: booksData } = await supabase
        .from('bills_not_in_2b')
        .select('input_cgst, input_sgst, input_igst, reversal_month, reclaim_month')
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth);
      
      if (booksData && booksData.length > 0) {
        const filteredData = booksData.filter(row => {
          const reversalBlank = row.reversal_month === null || row.reversal_month === '';
          const reclaimBlank = row.reclaim_month === null || row.reclaim_month === '';
          return reclaimBlank && !reversalBlank;
        });
        
        const totals = filteredData.reduce((acc, row) => ({
          cgst: acc.cgst + (Number(row.input_cgst) || 0),
          sgst: acc.sgst + (Number(row.input_sgst) || 0),
          igst: acc.igst + (Number(row.input_igst) || 0),
        }), { cgst: 0, sgst: 0, igst: 0 });
        
        setBooksCgst(totals.cgst);
        setBooksSgst(totals.sgst);
        setBooksIgst(totals.igst);
      } else {
        setBooksCgst(0);
        setBooksSgst(0);
        setBooksIgst(0);
      }
    } catch (error: any) {
      toast.error('Failed to fetch data: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedClientId, selectedMonth]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  useEffect(() => {
    if (selectedClientId && selectedMonth) {
      fetchData();
    }
  }, [selectedClientId, selectedMonth, fetchData]);

  const handleSave = async () => {
    if (!selectedClientId || !selectedMonth) {
      toast.error('Please select a client and month');
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('suspended_reco')
        .upsert({
          client_id: selectedClientId,
          period_month: selectedMonth,
          opening_cgst: openingCgst,
          opening_sgst: openingSgst,
          opening_igst: openingIgst,
          portal_cgst: portalCgst,
          portal_sgst: portalSgst,
          portal_igst: portalIgst,
          // Preserve opening-source metadata — Upload/NA/Override writes these
          // directly; the Save Changes button must not clobber them.
          opening_source: openingSource,
          opening_csv_period_month: openingCsvPeriodMonth,
          opening_csv_uploaded_at: openingCsvUploadedAt,
          opening_csv_uploaded_by: openingCsvUploadedBy,
          opening_override_justification: openingOverrideJustification,
          opening_override_at: openingOverrideAt,
          opening_override_by: openingOverrideBy,
          updated_by: user?.id,
          updated_at: new Date().toISOString(),
        } as any, {
          onConflict: 'client_id,period_month'
        });

      if (error) throw error;
      toast.success('Data saved successfully');
    } catch (error: any) {
      toast.error('Failed to save: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Upload: trigger hidden file picker
  const handleUploadClick = () => {
    if (!isStaff) return;
    fileInputRef.current?.click();
  };

  // Upload: parse selected CSV, validate GSTIN + previous-month presence, save
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    if (!selectedClientId || !selectedMonth) {
      toast.error('Select a client and month first.');
      return;
    }

    setIsSaving(true);
    try {
      const csvText = await file.text();
      const parsed = parseElectronicCreditCsv(csvText);

      const clientGstin = (selectedClientData?.gstin || '').trim().toUpperCase();
      const csvGstin = parsed.gstin.trim().toUpperCase();
      if (!csvGstin) {
        toast.error('Could not read GSTIN from the CSV. Upload rejected.');
        return;
      }
      if (csvGstin !== clientGstin) {
        toast.error(`CSV is for GSTIN ${csvGstin}, but client GSTIN is ${clientGstin}. Upload rejected.`);
        return;
      }

      const prevKey = previousPeriodMonthKey(selectedMonth);
      if (!prevKey) {
        toast.error('Could not determine the previous return period.');
        return;
      }
      const row = parsed.rows.find(r => r.periodMonthKey === prevKey);
      if (!row) {
        toast.error(`CSV has no ${formatPeriodLabel(prevKey)} row. Upload rejected.`);
        return;
      }

      const now = new Date().toISOString();
      const { error } = await supabase
        .from('suspended_reco')
        .upsert({
          client_id: selectedClientId,
          period_month: selectedMonth,
          opening_cgst: row.closingCgst,
          opening_sgst: row.closingSgst,
          opening_igst: row.closingIgst,
          portal_cgst: portalCgst,
          portal_sgst: portalSgst,
          portal_igst: portalIgst,
          opening_source: 'csv',
          opening_csv_period_month: row.periodMonthKey,
          opening_csv_uploaded_at: now,
          opening_csv_uploaded_by: user?.id,
          // Re-upload wipes any prior override (Q7)
          opening_override_justification: null,
          opening_override_at: null,
          opening_override_by: null,
          updated_by: user?.id,
          updated_at: now,
        } as any, { onConflict: 'client_id,period_month' });
      if (error) throw error;

      setOpeningCgst(row.closingCgst);
      setOpeningSgst(row.closingSgst);
      setOpeningIgst(row.closingIgst);
      setOpeningSource('csv');
      setOpeningCsvPeriodMonth(row.periodMonthKey);
      setOpeningCsvUploadedAt(now);
      setOpeningCsvUploadedBy(user?.id || null);
      setOpeningCsvUploaderName(user?.firstName || 'You');
      setOpeningOverrideJustification(null);
      setOpeningOverrideAt(null);
      setOpeningOverrideBy(null);
      setOpeningOverriderName(null);

      toast.success(`Opening balance set from ${formatPeriodLabel(row.periodMonthKey)} closing.`);
    } catch (error: any) {
      toast.error('Failed to import: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Not Applicable: silently set zeros + mark source
  const handleNotApplicable = async () => {
    if (!isStaff || !selectedClientId || !selectedMonth) return;
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('suspended_reco')
        .upsert({
          client_id: selectedClientId,
          period_month: selectedMonth,
          opening_cgst: 0,
          opening_sgst: 0,
          opening_igst: 0,
          portal_cgst: portalCgst,
          portal_sgst: portalSgst,
          portal_igst: portalIgst,
          opening_source: 'not_applicable',
          opening_csv_period_month: null,
          opening_csv_uploaded_at: null,
          opening_csv_uploaded_by: null,
          opening_override_justification: null,
          opening_override_at: null,
          opening_override_by: null,
          updated_by: user?.id,
          updated_at: now,
        } as any, { onConflict: 'client_id,period_month' });
      if (error) throw error;

      setOpeningCgst(0);
      setOpeningSgst(0);
      setOpeningIgst(0);
      setOpeningSource('not_applicable');
      setOpeningCsvPeriodMonth(null);
      setOpeningCsvUploadedAt(null);
      setOpeningCsvUploadedBy(null);
      setOpeningCsvUploaderName(null);
      setOpeningOverrideJustification(null);
      setOpeningOverrideAt(null);
      setOpeningOverrideBy(null);
      setOpeningOverriderName(null);

      toast.success('Marked Not Applicable. Opening balance set to 0.');
    } catch (error: any) {
      toast.error('Failed to save: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Override: layer new values + justification on top of existing source.
  // Gated by canManualOverride() (superadmin always; others need the
  // 'manual_override' permission from User Control) — same check as the
  // button visibility, applied here as defense-in-depth.
  const handleOverrideSave = async (values: { cgst: number; sgst: number; igst: number; justification: string }) => {
    if (!canManualOverride() || !selectedClientId || !selectedMonth) return;
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('suspended_reco')
        .upsert({
          client_id: selectedClientId,
          period_month: selectedMonth,
          opening_cgst: values.cgst,
          opening_sgst: values.sgst,
          opening_igst: values.igst,
          portal_cgst: portalCgst,
          portal_sgst: portalSgst,
          portal_igst: portalIgst,
          opening_source: openingSource,
          opening_csv_period_month: openingCsvPeriodMonth,
          opening_csv_uploaded_at: openingCsvUploadedAt,
          opening_csv_uploaded_by: openingCsvUploadedBy,
          opening_override_justification: values.justification,
          opening_override_at: now,
          opening_override_by: user?.id,
          updated_by: user?.id,
          updated_at: now,
        } as any, { onConflict: 'client_id,period_month' });
      if (error) throw error;

      setOpeningCgst(values.cgst);
      setOpeningSgst(values.sgst);
      setOpeningIgst(values.igst);
      setOpeningOverrideJustification(values.justification);
      setOpeningOverrideAt(now);
      setOpeningOverrideBy(user?.id || null);
      setOpeningOverriderName(user?.firstName || 'You');

      toast.success('Override saved.');
    } catch (error: any) {
      toast.error('Failed to save override: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const normalizeZero = (num: number): number => {
    if (Object.is(num, -0)) return 0;
    const rounded = Math.round(num * 100) / 100;
    if (rounded === 0 || Object.is(rounded, -0)) return 0;
    return rounded;
  };

  // Rs.10 rounding tolerance AND new opening-balance flow (Upload/NA/Override)
  // both kick in from Jun-26 (return period 06/2026) onward — so already-filed
  // past months are not retroactively altered.
  const NEW_FLOW_FROM = 202606; // YYYY * 100 + MM
  const monthSortKey = (() => {
    if (!selectedMonth) return 0;
    const [mm, yyyy] = selectedMonth.split('/').map(Number);
    if (!mm || !yyyy) return 0;
    return yyyy * 100 + mm;
  })();
  const useNewFlow = monthSortKey >= NEW_FLOW_FROM;
  const applyTolerance = (value: number): number => {
    if (!useNewFlow) return value;
    return Math.abs(value) <= 10 ? 0 : value;
  };

  // New formula: Difference = Opening Balance + Current Total - As Per Books
  const openingTotal = openingCgst + openingSgst + openingIgst;
  const portalTotal = portalCgst + portalSgst + portalIgst;
  const booksTotal = booksCgst + booksSgst + booksIgst;
  const diffCgst = applyTolerance(normalizeZero(openingCgst + portalCgst - booksCgst));
  const diffSgst = applyTolerance(normalizeZero(openingSgst + portalSgst - booksSgst));
  const diffIgst = applyTolerance(normalizeZero(openingIgst + portalIgst - booksIgst));
  const diffTotal = applyTolerance(normalizeZero(openingTotal + portalTotal - booksTotal));

  const formatNumber = (num: number): string => {
    if (num === 0 || Object.is(num, -0)) return '0';
    const rounded = Math.round(num * 100) / 100;
    if (rounded === 0 || Object.is(rounded, -0)) return '0';
    const formatted = rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    return formatted === '-0' ? '0' : formatted;
  };

  const renderEditableCell = (value: number, onChange: (val: number) => void) => {
    if (!isStaff) {
      return <span className="block text-right px-3">{formatNumber(value)}</span>;
    }
    return (
      <Input
        type="number"
        value={value || ''}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="h-10 text-right border-0 shadow-none rounded-none"
        min="0"
      />
    );
  };

  // Browser-extension pull: fetch the ledger opening balances from the portal.
  const [extReady, setExtReady] = useState(false);
  const pulledRef = useRef(false);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d: any = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) setExtReady(true);
      if (d.__gstkPullLedgersResult) {
        if (d.__gstkPullLedgersResult.ok) toast.success('Portal opening in a new tab — type the CAPTCHA there; the opening balance is fetched automatically and appears here when you switch back.');
        else toast.error('Could not start the pull: ' + d.__gstkPullLedgersResult.error);
      }
    };
    window.addEventListener('message', onMsg);
    const ping = () => window.postMessage({ __gstkAppReady: true }, '*');
    ping();
    const t1 = setTimeout(ping, 400);
    const t2 = setTimeout(ping, 1200);
    const onFocus = () => { if (pulledRef.current) fetchData(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('message', onMsg);
      window.removeEventListener('focus', onFocus);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [fetchData]);
  const pullLedgers = () => {
    if (!selectedClientId || !selectedMonth) { toast.error('Select a client and month first'); return; }
    if (!extReady) { toast.error('Install/enable the GST Keeper browser extension to pull from the portal.'); return; }
    pulledRef.current = true;
    window.postMessage({ __gstkPullLedgers: { clientId: selectedClientId, period_month: selectedMonth } }, '*');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <FileText className="h-6 w-6 text-primary" />
          </div>
           <div>
            <h1 className="text-2xl font-heading font-bold text-foreground">Suspended Reconciliation</h1>
            <p className="text-muted-foreground">Compare portal figures with books data</p>
            {lastSavedBy && (
              <p className="text-xs text-muted-foreground mt-1">
                Last saved by <span className="font-semibold text-foreground">{lastSavedBy.name}</span>
                {lastSavedBy.role && <span className="text-muted-foreground"> ({lastSavedBy.role})</span>}
                {lastSavedBy.time && (
                  <> on {new Date(lastSavedBy.time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date(lastSavedBy.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</>
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground whitespace-nowrap">Client:</span>
              <div className="min-w-[250px]">
                <SearchableSelect
                  options={clients.map(c => ({
                    value: c.id,
                    label: c.name,
                    sublabel: c.gstin,
                  }))}
                  value={selectedClientId}
                  onValueChange={setSelectedClientId}
                  placeholder="Select Client..."
                  searchPlaceholder="Type to search clients..."
                  emptyText="No clients found."
                  disabled={!isStaff && clients.length <= 1}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground whitespace-nowrap">Month:</span>
              <div className="w-40">
                <SearchableMonthSelect
                  options={generateMonthOptions}
                  value={selectedMonth}
                  onValueChange={setSelectedMonth}
                  placeholder="Select Month"
                />
              </div>
            </div>

            {selectedClientId && (
              <Button
                variant="outline"
                onClick={pullLedgers}
                disabled={!selectedClientId || !selectedMonth}
                className={extReady ? '' : 'text-muted-foreground'}
                title={extReady
                  ? 'Pull the opening balance from the portal ledgers (via the browser extension)'
                  : 'GST Keeper extension not detected yet — install/enable it and reload this page'}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Pull
              </Button>
            )}

            {selectedClientId && (
              <Button variant="outline" onClick={() => {
                if (!selectedClientData) return;
                exportSuspendedRecoToExcel({
                  clientName: selectedClientData.name,
                  clientGstin: selectedClientData.gstin,
                  month: selectedMonth,
                  openingCgst, openingSgst, openingIgst,
                  portalCgst, portalSgst, portalIgst,
                  booksCgst, booksSgst, booksIgst,
                  diffCgst, diffSgst, diffIgst,
                });
                toast.success('Excel exported successfully');
              }}>
                <Download className="h-4 w-4 mr-2" />
                Export Excel
              </Button>
            )}
            {isStaff && (
              <Button onClick={handleSave} disabled={isSaving || !selectedClientId} className="ml-auto">
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save Changes
              </Button>
            )}
            {(user?.role === 'superadmin' || user?.role === 'gst_manager') && selectedClientId && (
              <Button variant="destructive" size="sm" onClick={() => setShowClearData(true)} className="gap-2">
                <Trash2 className="h-4 w-4" />
                Clear Data
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Suspended Reconciliation Table */}
      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="font-bold text-primary-foreground border border-primary w-48">PARTICULARS</TableHead>
                  <TableHead className="font-bold text-primary-foreground text-center border border-primary">CGST</TableHead>
                  <TableHead className="font-bold text-primary-foreground text-center border border-primary">SGST</TableHead>
                  <TableHead className="font-bold text-primary-foreground text-center border border-primary">IGST</TableHead>
                  <TableHead className="font-bold text-primary-foreground text-center border border-primary">TOTAL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Opening Balance As Per Portal */}
                <TableRow>
                  <TableCell className="font-medium border border-border align-top">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>OPENING BALANCE AS PER PORTAL</span>
                        {useNewFlow && openingSource !== 'manual' && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex items-center text-muted-foreground hover:text-foreground"
                                aria-label="Opening balance source info"
                              >
                                <Info className="h-4 w-4" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="text-xs max-w-xs space-y-2" align="start">
                              {openingSource === 'csv' && openingCsvPeriodMonth && (
                                <p>
                                  <span className="font-semibold">Source:</span> CSV ({formatPeriodLabel(openingCsvPeriodMonth)} closing).
                                  {openingCsvUploaderName && (
                                    <> Uploaded by <span className="font-semibold">{openingCsvUploaderName}</span></>
                                  )}
                                  {openingCsvUploadedAt && (
                                    <> on {new Date(openingCsvUploadedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                                  )}.
                                </p>
                              )}
                              {openingSource === 'not_applicable' && (
                                <p>
                                  <span className="font-semibold">Source:</span> Marked Not Applicable.
                                </p>
                              )}
                              {openingOverrideJustification && (
                                <div className="border-t pt-2">
                                  <p>
                                    <span className="font-semibold">Manually overridden</span>
                                    {openingOverriderName && <> by <span className="font-semibold">{openingOverriderName}</span></>}
                                    {openingOverrideAt && (
                                      <> on {new Date(openingOverrideAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                                    )}.
                                  </p>
                                  <p className="mt-1"><span className="font-semibold">Reason:</span> {openingOverrideJustification}</p>
                                </div>
                              )}
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                      {useNewFlow && isStaff && (
                        <div className="flex gap-1.5 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={handleNotApplicable}
                            disabled={!selectedClientId || isSaving}
                          >
                            Not Applicable
                          </Button>
                          {openingSource !== 'manual' && canManualOverride() && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => setShowOverrideDialog(true)}
                              disabled={!selectedClientId || isSaving}
                            >
                              <Edit3 className="h-3 w-3 mr-1" />
                              Override
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-muted-foreground hover:text-foreground"
                            onClick={handleUploadClick}
                            disabled={!selectedClientId || isSaving}
                            title="Manual fallback — upload the ledger statement if the portal sync didn't set this"
                          >
                            <Upload className="h-3 w-3 mr-1" />
                            {openingSource === 'csv' ? 'Re-upload' : 'Upload'}
                          </Button>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  {useNewFlow ? (
                    <>
                      <TableCell className="text-right border border-border bg-accent/30">{formatNumber(openingCgst)}</TableCell>
                      <TableCell className="text-right border border-border bg-accent/30">{formatNumber(openingSgst)}</TableCell>
                      <TableCell className="text-right border border-border bg-accent/30">{formatNumber(openingIgst)}</TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="p-0 border border-border">{renderEditableCell(openingCgst, setOpeningCgst)}</TableCell>
                      <TableCell className="p-0 border border-border">{renderEditableCell(openingSgst, setOpeningSgst)}</TableCell>
                      <TableCell className="p-0 border border-border">{renderEditableCell(openingIgst, setOpeningIgst)}</TableCell>
                    </>
                  )}
                  <TableCell className="text-right font-medium border border-border bg-muted/30">
                    {formatNumber(openingTotal)}
                  </TableCell>
                </TableRow>

                {/* Current Total - Auto-calculated from ITC Summary */}
                <TableRow>
                  <TableCell className="font-medium border border-border">
                    CURRENT TOTAL AS PER SUSPENDED RECO
                    <p className="text-[10px] text-muted-foreground font-normal mt-0.5">(4B(2)(i) + 4B(2)(ii)) − (5.4 + 5.5 + 4(D) 1.2)</p>
                  </TableCell>
                  <TableCell className="text-right border border-border bg-accent/50">{formatNumber(portalCgst)}</TableCell>
                  <TableCell className="text-right border border-border bg-accent/50">{formatNumber(portalSgst)}</TableCell>
                  <TableCell className="text-right border border-border bg-accent/50">{formatNumber(portalIgst)}</TableCell>
                  <TableCell className="text-right font-medium border border-border bg-muted/30">
                    {formatNumber(portalTotal)}
                  </TableCell>
                </TableRow>

                {/* Empty Row for spacing */}
                <TableRow className="h-2 hover:bg-transparent">
                  <TableCell colSpan={5} className="border-0 p-0"></TableCell>
                </TableRow>

                {/* As Per Books Row - Auto-linked */}
                <TableRow>
                  <TableCell className="font-medium border border-border">CLOSING BALANCE AS PER BOOKS</TableCell>
                  <TableCell className="text-right border border-border bg-accent/50">
                    {formatNumber(booksCgst)}
                  </TableCell>
                  <TableCell className="text-right border border-border bg-accent/50">
                    {formatNumber(booksSgst)}
                  </TableCell>
                  <TableCell className="text-right border border-border bg-accent/50">
                    {formatNumber(booksIgst)}
                  </TableCell>
                  <TableCell className="text-right font-medium border border-border bg-muted/30">
                    {formatNumber(booksTotal)}
                  </TableCell>
                </TableRow>

                {/* Empty Row for spacing */}
                <TableRow className="h-2 hover:bg-transparent">
                  <TableCell colSpan={5} className="border-0 p-0"></TableCell>
                </TableRow>

                {/* Difference Row: Opening + Current - Books */}
                <TableRow className="bg-warning/10 hover:bg-warning/10">
                  <TableCell className="font-bold border border-border">DIFFERENCE</TableCell>
                  <TableCell className={`text-right font-medium border border-border ${diffCgst !== 0 ? 'text-destructive' : ''}`}>
                    {formatNumber(diffCgst)}
                  </TableCell>
                  <TableCell className={`text-right font-medium border border-border ${diffSgst !== 0 ? 'text-destructive' : ''}`}>
                    {formatNumber(diffSgst)}
                  </TableCell>
                  <TableCell className={`text-right font-medium border border-border ${diffIgst !== 0 ? 'text-destructive' : ''}`}>
                    {formatNumber(diffIgst)}
                  </TableCell>
                  <TableCell className={`text-right font-bold border border-border ${diffTotal !== 0 ? 'text-destructive' : ''}`}>
                    {formatNumber(diffTotal)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}

          {!selectedClientId && (
            <div className="text-center py-8 text-muted-foreground">
              Please select a client to view suspended reconciliation data.
            </div>
          )}
        </CardContent>
      </Card>
      
      {selectedClientId && selectedClientData && (
        <ClearDataDialog
          open={showClearData}
          onOpenChange={setShowClearData}
          module="Suspended Reco"
          clientId={selectedClientId}
          clientName={selectedClientData.name}
          onCleared={fetchData}
        />
      )}

      {/* Manual fallback file input — triggered by the muted "Upload" button */}
      <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />

      <SuspendedRecoOverrideDialog
        open={showOverrideDialog}
        onOpenChange={setShowOverrideDialog}
        initialCgst={openingCgst}
        initialSgst={openingSgst}
        initialIgst={openingIgst}
        onSave={handleOverrideSave}
      />
    </div>
  );
};

export default SuspendedRecoPage;
