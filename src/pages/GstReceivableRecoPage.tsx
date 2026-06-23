import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, Save, Loader2, Upload, Info, Edit3, Download } from 'lucide-react';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { toast } from 'sonner';
import SuspendedRecoOverrideDialog from '@/components/dialogs/SuspendedRecoOverrideDialog';
import { exportGstReceivableRecoToExcel } from '@/utils/gstReceivableRecoExcelExport';
import {
  parseElectronicCreditLedgerCsv,
  previousPeriodMonthKey,
  formatPeriodLabel,
} from '@/utils/parseElectronicCreditLedgerCsv';
import { computeGstr1OutputTax } from '@/utils/computeGstr1OutputTax';

type OpeningSource = 'manual' | 'csv' | 'not_applicable';

interface Client {
  id: string;
  name: string;
  gstin: string;
  registration_date?: string;
}

// Cutoff: GST Receivable Reco is only meaningful from Jun-26 (06/2026) onward
// because the source tables (ITC Summary, GSTR-1) only have reliable data
// from then and the user does not want to back-fill old reconciliations.
const RECEIVABLE_FROM = 202606; // YYYY * 100 + MM

// Convert MM/YYYY → MMM-YY for matching gstr1_data.period_month which uses
// the short label format (e.g. "Jun-26").
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toShortMonth = (mmYyyy: string): string => {
  const [mm, yyyy] = mmYyyy.split('/').map(Number);
  if (!mm || !yyyy) return '';
  return `${MONTH_SHORT[mm - 1]}-${String(yyyy).slice(-2)}`;
};

const GstReceivableRecoPage: React.FC = () => {
  const { user, isStaffRole } = useAuth();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedBy, setLastSavedBy] = useState<{ name: string; role: string; time: string } | null>(null);

  // Opening balance (portal) — persisted
  const [openingCgst, setOpeningCgst] = useState(0);
  const [openingSgst, setOpeningSgst] = useState(0);
  const [openingIgst, setOpeningIgst] = useState(0);
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

  // Books closing balance — persisted, manually entered
  const [booksClosingCgst, setBooksClosingCgst] = useState(0);
  const [booksClosingSgst, setBooksClosingSgst] = useState(0);
  const [booksClosingIgst, setBooksClosingIgst] = useState(0);

  // Auto-fetched values (NOT persisted — computed live each render from
  // itc_summaries / gstr1_data so the view stays in sync with source tables)
  const [availedCgst, setAvailedCgst] = useState(0);
  const [availedSgst, setAvailedSgst] = useState(0);
  const [availedIgst, setAvailedIgst] = useState(0);
  const [utilizedCgst, setUtilizedCgst] = useState(0);
  const [utilizedSgst, setUtilizedSgst] = useState(0);
  const [utilizedIgst, setUtilizedIgst] = useState(0);
  const [reversedCgst, setReversedCgst] = useState(0);
  const [reversedSgst, setReversedSgst] = useState(0);
  const [reversedIgst, setReversedIgst] = useState(0);
  const [reclaimedCgst, setReclaimedCgst] = useState(0);
  const [reclaimedSgst, setReclaimedSgst] = useState(0);
  const [reclaimedIgst, setReclaimedIgst] = useState(0);

  // Source-availability flags (drive the small notes on the row labels)
  const [hasItcSummary, setHasItcSummary] = useState(false);
  const [hasGstr1, setHasGstr1] = useState(false);

  const isStaff = isStaffRole();
  const selectedClientData = clients.find(c => c.id === selectedClientId);

  const monthSortKey = useMemo(() => {
    if (!selectedMonth) return 0;
    const [mm, yyyy] = selectedMonth.split('/').map(Number);
    if (!mm || !yyyy) return 0;
    return yyyy * 100 + mm;
  }, [selectedMonth]);
  const isEligibleMonth = monthSortKey >= RECEIVABLE_FROM;

  // Month options — copied from SuspendedRecoPage for layout consistency
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

  const fetchClients = useCallback(async () => {
    let query = supabase.from('clients').select('id, name, gstin, registration_date').order('name');
    if (user && !isStaff) query = query.eq('id', user.id);
    const { data } = await query;
    setClients(data || []);
    if (!isStaff && data && data.length > 0 && !selectedClientId) {
      setSelectedClientId(data[0].id);
    }
  }, [user, isStaff, selectedClientId, setSelectedClientId]);

  const fetchData = useCallback(async () => {
    if (!selectedClientId || !selectedMonth || !isEligibleMonth) return;
    setIsLoading(true);
    try {
      // 1. Persisted gst_receivable_reco row
      const { data: rowData } = await supabase
        .from('gst_receivable_reco' as any)
        .select('*')
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth)
        .maybeSingle();

      if (rowData) {
        const r = rowData as any;
        setOpeningCgst(Number(r.opening_cgst) || 0);
        setOpeningSgst(Number(r.opening_sgst) || 0);
        setOpeningIgst(Number(r.opening_igst) || 0);
        setOpeningSource((r.opening_source as OpeningSource) || 'manual');
        setOpeningCsvPeriodMonth(r.opening_csv_period_month || null);
        setOpeningCsvUploadedAt(r.opening_csv_uploaded_at || null);
        setOpeningCsvUploadedBy(r.opening_csv_uploaded_by || null);
        setOpeningOverrideJustification(r.opening_override_justification || null);
        setOpeningOverrideAt(r.opening_override_at || null);
        setOpeningOverrideBy(r.opening_override_by || null);
        setBooksClosingCgst(Number(r.books_closing_cgst) || 0);
        setBooksClosingSgst(Number(r.books_closing_sgst) || 0);
        setBooksClosingIgst(Number(r.books_closing_igst) || 0);

        // Resolve names for hover popover
        const ids: string[] = [];
        if (r.opening_csv_uploaded_by) ids.push(r.opening_csv_uploaded_by);
        if (r.opening_override_by && r.opening_override_by !== r.opening_csv_uploaded_by) ids.push(r.opening_override_by);
        let nameMap = new Map<string, string>();
        if (ids.length > 0) {
          const { data: profiles } = await supabase.from('profiles').select('user_id, first_name').in('user_id', ids);
          nameMap = new Map((profiles || []).map(p => [p.user_id, p.first_name || 'Unknown']));
        }
        setOpeningCsvUploaderName(r.opening_csv_uploaded_by ? (nameMap.get(r.opening_csv_uploaded_by) || 'Unknown') : null);
        setOpeningOverriderName(r.opening_override_by ? (nameMap.get(r.opening_override_by) || 'Unknown') : null);

        if (r.updated_by) {
          const { data: profile } = await supabase.from('profiles').select('first_name').eq('user_id', r.updated_by).maybeSingle();
          const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', r.updated_by).maybeSingle();
          setLastSavedBy({
            name: profile?.first_name || 'Unknown',
            role: roleData?.role || '',
            time: r.updated_at || '',
          });
        } else {
          setLastSavedBy(null);
        }
      } else {
        setOpeningCgst(0); setOpeningSgst(0); setOpeningIgst(0);
        setOpeningSource('manual');
        setOpeningCsvPeriodMonth(null);
        setOpeningCsvUploadedAt(null);
        setOpeningCsvUploadedBy(null);
        setOpeningCsvUploaderName(null);
        setOpeningOverrideJustification(null);
        setOpeningOverrideAt(null);
        setOpeningOverrideBy(null);
        setOpeningOverriderName(null);
        setBooksClosingCgst(0); setBooksClosingSgst(0); setBooksClosingIgst(0);
        setLastSavedBy(null);
      }

      // 2. ITC Summary → Availed (4A) + Reversed (4B) + Reclaimed (4D)
      const { data: itcData } = await supabase
        .from('itc_summaries')
        .select('data')
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth)
        .maybeSingle();

      if (itcData?.data) {
        setHasItcSummary(true);
        const itc = itcData.data as any;
        const sumSection = (rows: any[]): { cgst: number; sgst: number; igst: number } =>
          (rows || []).reduce(
            (acc, r) => ({
              cgst: acc.cgst + (Number(r?.cgst) || 0),
              sgst: acc.sgst + (Number(r?.sgst) || 0),
              igst: acc.igst + (Number(r?.igst) || 0),
            }),
            { cgst: 0, sgst: 0, igst: 0 }
          );
        const a4 = sumSection(itc.section4A);
        const b4 = sumSection(itc.section4B);
        const d4 = sumSection(itc.section4D);
        setAvailedCgst(a4.cgst); setAvailedSgst(a4.sgst); setAvailedIgst(a4.igst);
        setReversedCgst(b4.cgst); setReversedSgst(b4.sgst); setReversedIgst(b4.igst);
        setReclaimedCgst(d4.cgst); setReclaimedSgst(d4.sgst); setReclaimedIgst(d4.igst);
      } else {
        setHasItcSummary(false);
        setAvailedCgst(0); setAvailedSgst(0); setAvailedIgst(0);
        setReversedCgst(0); setReversedSgst(0); setReversedIgst(0);
        setReclaimedCgst(0); setReclaimedSgst(0); setReclaimedIgst(0);
      }

      // 3. GSTR-1 → output tax = ITC Utilized proxy
      const shortMonth = toShortMonth(selectedMonth);
      const { data: gstr1Data } = await supabase
        .from('gstr1_data')
        .select('raw_json')
        .eq('client_id', selectedClientId)
        .eq('period_month', shortMonth)
        .maybeSingle();

      if (gstr1Data?.raw_json) {
        setHasGstr1(true);
        const out = computeGstr1OutputTax(gstr1Data.raw_json);
        setUtilizedCgst(out.cgst);
        setUtilizedSgst(out.sgst);
        setUtilizedIgst(out.igst);
      } else {
        setHasGstr1(false);
        setUtilizedCgst(0); setUtilizedSgst(0); setUtilizedIgst(0);
      }
    } catch (error: any) {
      toast.error('Failed to fetch data: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedClientId, selectedMonth, isEligibleMonth]);

  useEffect(() => { fetchClients(); }, [fetchClients]);
  useEffect(() => {
    if (selectedClientId && selectedMonth && isEligibleMonth) fetchData();
  }, [selectedClientId, selectedMonth, isEligibleMonth, fetchData]);

  // ─────────── Action handlers (Upload / Not Applicable / Override) ─────────

  const handleUploadClick = () => {
    if (!isStaff) return;
    fileInputRef.current?.click();
  };

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
      const parsed = parseElectronicCreditLedgerCsv(csvText);

      const clientGstin = (selectedClientData?.gstin || '').trim().toUpperCase();
      const csvGstin = parsed.gstin.trim().toUpperCase();
      if (!csvGstin) {
        toast.error('Could not read GSTIN from the Credit Ledger CSV. Upload rejected.');
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
      const row = parsed.rowsByPeriod.get(prevKey);
      if (!row) {
        toast.error(`Credit Ledger CSV has no ${formatPeriodLabel(prevKey)} entry. Upload rejected.`);
        return;
      }

      const now = new Date().toISOString();
      const { error } = await supabase
        .from('gst_receivable_reco' as any)
        .upsert({
          client_id: selectedClientId,
          period_month: selectedMonth,
          opening_cgst: row.balanceCgst,
          opening_sgst: row.balanceSgst,
          opening_igst: row.balanceIgst,
          opening_source: 'csv',
          opening_csv_period_month: row.periodMonthKey,
          opening_csv_uploaded_at: now,
          opening_csv_uploaded_by: user?.id,
          opening_override_justification: null,
          opening_override_at: null,
          opening_override_by: null,
          books_closing_cgst: booksClosingCgst,
          books_closing_sgst: booksClosingSgst,
          books_closing_igst: booksClosingIgst,
          updated_by: user?.id,
          updated_at: now,
        }, { onConflict: 'client_id,period_month' });
      if (error) throw error;

      setOpeningCgst(row.balanceCgst);
      setOpeningSgst(row.balanceSgst);
      setOpeningIgst(row.balanceIgst);
      setOpeningSource('csv');
      setOpeningCsvPeriodMonth(row.periodMonthKey);
      setOpeningCsvUploadedAt(now);
      setOpeningCsvUploadedBy(user?.id || null);
      setOpeningCsvUploaderName(user?.firstName || 'You');
      setOpeningOverrideJustification(null);
      setOpeningOverrideAt(null);
      setOpeningOverrideBy(null);
      setOpeningOverriderName(null);

      toast.success(`Opening balance set from ${formatPeriodLabel(row.periodMonthKey)} (S.No ${row.srNo}).`);
    } catch (error: any) {
      toast.error('Failed to import: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleNotApplicable = async () => {
    if (!isStaff || !selectedClientId || !selectedMonth) return;
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('gst_receivable_reco' as any)
        .upsert({
          client_id: selectedClientId,
          period_month: selectedMonth,
          opening_cgst: 0, opening_sgst: 0, opening_igst: 0,
          opening_source: 'not_applicable',
          opening_csv_period_month: null,
          opening_csv_uploaded_at: null,
          opening_csv_uploaded_by: null,
          opening_override_justification: null,
          opening_override_at: null,
          opening_override_by: null,
          books_closing_cgst: booksClosingCgst,
          books_closing_sgst: booksClosingSgst,
          books_closing_igst: booksClosingIgst,
          updated_by: user?.id,
          updated_at: now,
        }, { onConflict: 'client_id,period_month' });
      if (error) throw error;

      setOpeningCgst(0); setOpeningSgst(0); setOpeningIgst(0);
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

  const handleOverrideSave = async (values: { cgst: number; sgst: number; igst: number; justification: string }) => {
    if (user?.role !== 'superadmin' || !selectedClientId || !selectedMonth) return;
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('gst_receivable_reco' as any)
        .upsert({
          client_id: selectedClientId,
          period_month: selectedMonth,
          opening_cgst: values.cgst,
          opening_sgst: values.sgst,
          opening_igst: values.igst,
          opening_source: openingSource,
          opening_csv_period_month: openingCsvPeriodMonth,
          opening_csv_uploaded_at: openingCsvUploadedAt,
          opening_csv_uploaded_by: openingCsvUploadedBy,
          opening_override_justification: values.justification,
          opening_override_at: now,
          opening_override_by: user.id,
          books_closing_cgst: booksClosingCgst,
          books_closing_sgst: booksClosingSgst,
          books_closing_igst: booksClosingIgst,
          updated_by: user.id,
          updated_at: now,
        }, { onConflict: 'client_id,period_month' });
      if (error) throw error;

      setOpeningCgst(values.cgst);
      setOpeningSgst(values.sgst);
      setOpeningIgst(values.igst);
      setOpeningOverrideJustification(values.justification);
      setOpeningOverrideAt(now);
      setOpeningOverrideBy(user.id);
      setOpeningOverriderName(user.firstName || 'You');

      toast.success('Override saved.');
    } catch (error: any) {
      toast.error('Failed to save override: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!selectedClientId || !selectedMonth) {
      toast.error('Please select a client and month');
      return;
    }
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('gst_receivable_reco' as any)
        .upsert({
          client_id: selectedClientId,
          period_month: selectedMonth,
          opening_cgst: openingCgst,
          opening_sgst: openingSgst,
          opening_igst: openingIgst,
          opening_source: openingSource,
          opening_csv_period_month: openingCsvPeriodMonth,
          opening_csv_uploaded_at: openingCsvUploadedAt,
          opening_csv_uploaded_by: openingCsvUploadedBy,
          opening_override_justification: openingOverrideJustification,
          opening_override_at: openingOverrideAt,
          opening_override_by: openingOverrideBy,
          books_closing_cgst: booksClosingCgst,
          books_closing_sgst: booksClosingSgst,
          books_closing_igst: booksClosingIgst,
          updated_by: user?.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'client_id,period_month' });
      if (error) throw error;
      toast.success('Data saved successfully');
    } catch (error: any) {
      toast.error('Failed to save: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  // ─────────────────── Derived totals + formatting ────────────────────────

  const formatNumber = (num: number): string => {
    if (num === 0 || Object.is(num, -0)) return '0';
    const rounded = Math.round(num * 100) / 100;
    if (rounded === 0 || Object.is(rounded, -0)) return '0';
    const formatted = rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    return formatted === '-0' ? '0' : formatted;
  };

  // Per-head available ITC (what the credit ledger holds BEFORE this month's
  // outflow). Reversals reduce the available pool; reclaims add back.
  const availableCgst = openingCgst + availedCgst - reversedCgst + reclaimedCgst;
  const availableSgst = openingSgst + availedSgst - reversedSgst + reclaimedSgst;
  const availableIgst = openingIgst + availedIgst - reversedIgst + reclaimedIgst;

  // Real-world rule: the taxpayer ALWAYS exhausts the credit ledger first;
  // only the shortfall is paid in cash. So actual ITC utilized = min(output,
  // available) per head, and the excess (GST payable in cash) = max(0,
  // output − available). Negative "available" (impossible in practice but
  // possible when partial data is entered) clamps at 0 here.
  const safeAvailableCgst = Math.max(0, availableCgst);
  const safeAvailableSgst = Math.max(0, availableSgst);
  const safeAvailableIgst = Math.max(0, availableIgst);
  const actualUtilizedCgst = Math.min(safeAvailableCgst, utilizedCgst);
  const actualUtilizedSgst = Math.min(safeAvailableSgst, utilizedSgst);
  const actualUtilizedIgst = Math.min(safeAvailableIgst, utilizedIgst);
  const payableCgst = Math.max(0, utilizedCgst - safeAvailableCgst);
  const payableSgst = Math.max(0, utilizedSgst - safeAvailableSgst);
  const payableIgst = Math.max(0, utilizedIgst - safeAvailableIgst);

  // Closing per portal = Available − ITC actually utilized (clamped at 0)
  const portalClosingCgst = safeAvailableCgst - actualUtilizedCgst;
  const portalClosingSgst = safeAvailableSgst - actualUtilizedSgst;
  const portalClosingIgst = safeAvailableIgst - actualUtilizedIgst;

  const openingTotal = openingCgst + openingSgst + openingIgst;
  const availedTotal = availedCgst + availedSgst + availedIgst;
  const utilizedDisplayTotal = actualUtilizedCgst + actualUtilizedSgst + actualUtilizedIgst;
  const reversedTotal = reversedCgst + reversedSgst + reversedIgst;
  const reclaimedTotal = reclaimedCgst + reclaimedSgst + reclaimedIgst;
  const payableTotal = payableCgst + payableSgst + payableIgst;
  const portalClosingTotal = portalClosingCgst + portalClosingSgst + portalClosingIgst;
  const booksClosingTotal = booksClosingCgst + booksClosingSgst + booksClosingIgst;
  const hasPayable = payableTotal > 0;

  // Diff with Rs.10 tolerance — display 0 if |diff| <= 10
  const applyTolerance = (v: number) => (Math.abs(v) <= 10 ? 0 : v);
  const diffCgst = applyTolerance(portalClosingCgst - booksClosingCgst);
  const diffSgst = applyTolerance(portalClosingSgst - booksClosingSgst);
  const diffIgst = applyTolerance(portalClosingIgst - booksClosingIgst);
  const diffTotal = applyTolerance(portalClosingTotal - booksClosingTotal);

  const renderBooksCell = (value: number, onChange: (val: number) => void) => {
    if (!isStaff) return <span className="block text-right px-3">{formatNumber(value)}</span>;
    return (
      <Input
        type="number"
        value={value || ''}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="h-10 text-right border-0 shadow-none rounded-none"
      />
    );
  };

  // ──────────────────────────── Render ───────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-bold text-foreground">GST Receivable Reco</h1>
            <p className="text-muted-foreground">Reconcile Electronic Credit Ledger closing with books</p>
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
        <div className="flex items-center gap-2">
          {isEligibleMonth && selectedClientData && (
            <Button variant="outline" onClick={() => {
              exportGstReceivableRecoToExcel({
                clientName: selectedClientData.name,
                clientGstin: selectedClientData.gstin,
                month: selectedMonth,
                openingCgst, openingSgst, openingIgst,
                availedCgst, availedSgst, availedIgst,
                utilizedCgst: actualUtilizedCgst,
                utilizedSgst: actualUtilizedSgst,
                utilizedIgst: actualUtilizedIgst,
                reversedCgst, reversedSgst, reversedIgst,
                reclaimedCgst, reclaimedSgst, reclaimedIgst,
                portalClosingCgst, portalClosingSgst, portalClosingIgst,
                payableCgst, payableSgst, payableIgst,
                booksClosingCgst, booksClosingSgst, booksClosingIgst,
                diffCgst, diffSgst, diffIgst,
              });
              toast.success('Excel exported successfully');
            }}>
              <Download className="h-4 w-4 mr-2" />
              Export Excel
            </Button>
          )}
          {isStaff && isEligibleMonth && (
            <Button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2">
              <Save className="h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-medium whitespace-nowrap">Client:</span>
              <div className="min-w-[250px]">
                <SearchableSelect
                  options={clients.map(c => ({ value: c.id, label: c.name, sublabel: c.gstin }))}
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
              <span className="font-medium whitespace-nowrap">Month:</span>
              <div className="w-40">
                <SearchableMonthSelect
                  options={generateMonthOptions}
                  value={selectedMonth}
                  onValueChange={setSelectedMonth}
                  placeholder="Select Month"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          {!selectedClientId || !selectedMonth ? (
            <div className="text-center py-8 text-muted-foreground">
              Please select a client and month to view the reconciliation.
            </div>
          ) : !isEligibleMonth ? (
            <div className="text-center py-8 text-muted-foreground">
              GST Receivable Reco is available from return period <span className="font-semibold">Jun-26</span> onward.
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="font-bold text-primary-foreground border border-primary">PARTICULARS</TableHead>
                  <TableHead className="font-bold text-primary-foreground text-center border border-primary">CGST</TableHead>
                  <TableHead className="font-bold text-primary-foreground text-center border border-primary">SGST</TableHead>
                  <TableHead className="font-bold text-primary-foreground text-center border border-primary">IGST</TableHead>
                  <TableHead className="font-bold text-primary-foreground text-center border border-primary">TOTAL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Opening Balance row — CSV upload / NA / Override */}
                <TableRow>
                  <TableCell className="font-medium border border-border align-top">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>OPENING BALANCE AS PER PORTAL</span>
                        {openingSource !== 'manual' && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button type="button" className="inline-flex items-center text-muted-foreground hover:text-foreground" aria-label="Opening balance source">
                                <Info className="h-4 w-4" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="text-xs max-w-xs space-y-2" align="start">
                              {openingSource === 'csv' && openingCsvPeriodMonth && (
                                <p>
                                  <span className="font-semibold">Source:</span> Credit Ledger CSV ({formatPeriodLabel(openingCsvPeriodMonth)} closing).
                                  {openingCsvUploaderName && <> Uploaded by <span className="font-semibold">{openingCsvUploaderName}</span></>}
                                  {openingCsvUploadedAt && (
                                    <> on {new Date(openingCsvUploadedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                                  )}.
                                </p>
                              )}
                              {openingSource === 'not_applicable' && (
                                <p><span className="font-semibold">Source:</span> Marked Not Applicable.</p>
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
                      {isStaff && (
                        <div className="flex gap-1.5 flex-wrap">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleUploadClick} disabled={!selectedClientId || isSaving}>
                            <Upload className="h-3 w-3 mr-1" />
                            {openingSource === 'csv' ? 'Re-upload' : 'Upload Ledger'}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleNotApplicable} disabled={!selectedClientId || isSaving}>
                            Not Applicable
                          </Button>
                          {openingSource !== 'manual' && user?.role === 'superadmin' && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowOverrideDialog(true)} disabled={!selectedClientId || isSaving}>
                              <Edit3 className="h-3 w-3 mr-1" />
                              Override
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right border border-border bg-accent/30">{formatNumber(openingCgst)}</TableCell>
                  <TableCell className="text-right border border-border bg-accent/30">{formatNumber(openingSgst)}</TableCell>
                  <TableCell className="text-right border border-border bg-accent/30">{formatNumber(openingIgst)}</TableCell>
                  <TableCell className="text-right font-medium border border-border bg-muted/30">{formatNumber(openingTotal)}</TableCell>
                </TableRow>

                {/* ITC Availed — auto from ITC Summary 4A */}
                <TableRow>
                  <TableCell className="font-medium border border-border">
                    <div>ADD: ITC AVAILED (4A)</div>
                    {!hasItcSummary && <p className="text-[10px] text-muted-foreground font-normal mt-0.5">ITC Summary not saved for this month — showing 0</p>}
                  </TableCell>
                  <TableCell className="text-right border border-border bg-accent/30">{formatNumber(availedCgst)}</TableCell>
                  <TableCell className="text-right border border-border bg-accent/30">{formatNumber(availedSgst)}</TableCell>
                  <TableCell className="text-right border border-border bg-accent/30">{formatNumber(availedIgst)}</TableCell>
                  <TableCell className="text-right font-medium border border-border bg-muted/30">{formatNumber(availedTotal)}</TableCell>
                </TableRow>

                {/* ITC Utilized — GSTR-1 output, but capped at available ITC */}
                <TableRow>
                  <TableCell className="font-medium border border-border">
                    <div>LESS: ITC UTILIZED</div>
                    <p className="text-[10px] text-muted-foreground font-normal mt-0.5">min(GSTR-1 output, Available ITC) — excess shown in GST Payable</p>
                    {!hasGstr1 && <p className="text-[10px] text-muted-foreground font-normal mt-0.5">GSTR-1 not imported for this month — showing 0</p>}
                  </TableCell>
                  <TableCell className="text-right border border-border bg-accent/30">{formatNumber(actualUtilizedCgst)}</TableCell>
                  <TableCell className="text-right border border-border bg-accent/30">{formatNumber(actualUtilizedSgst)}</TableCell>
                  <TableCell className="text-right border border-border bg-accent/30">{formatNumber(actualUtilizedIgst)}</TableCell>
                  <TableCell className="text-right font-medium border border-border bg-muted/30">{formatNumber(utilizedDisplayTotal)}</TableCell>
                </TableRow>

                {/* ITC Reversed — auto from ITC Summary 4B */}
                <TableRow>
                  <TableCell className="font-medium border border-border">LESS: ITC REVERSED (4B)</TableCell>
                  <TableCell className="text-right border border-border bg-accent/30">{formatNumber(reversedCgst)}</TableCell>
                  <TableCell className="text-right border border-border bg-accent/30">{formatNumber(reversedSgst)}</TableCell>
                  <TableCell className="text-right border border-border bg-accent/30">{formatNumber(reversedIgst)}</TableCell>
                  <TableCell className="text-right font-medium border border-border bg-muted/30">{formatNumber(reversedTotal)}</TableCell>
                </TableRow>

                {/* ITC Reclaimed — auto from ITC Summary 4D */}
                <TableRow>
                  <TableCell className="font-medium border border-border">ADD: ITC RECLAIMED (4D)</TableCell>
                  <TableCell className="text-right border border-border bg-accent/30">{formatNumber(reclaimedCgst)}</TableCell>
                  <TableCell className="text-right border border-border bg-accent/30">{formatNumber(reclaimedSgst)}</TableCell>
                  <TableCell className="text-right border border-border bg-accent/30">{formatNumber(reclaimedIgst)}</TableCell>
                  <TableCell className="text-right font-medium border border-border bg-muted/30">{formatNumber(reclaimedTotal)}</TableCell>
                </TableRow>

                {/* Spacer */}
                <TableRow className="h-2 hover:bg-transparent">
                  <TableCell colSpan={5} className="border-0 p-0"></TableCell>
                </TableRow>

                {/* Closing per portal — computed */}
                <TableRow className="bg-secondary/30 hover:bg-secondary/30">
                  <TableCell className="font-bold border border-border">
                    <div>CLOSING BALANCE AS PER PORTAL</div>
                    <p className="text-[10px] text-muted-foreground font-normal mt-0.5">Available ITC − ITC Utilized (clamped at 0)</p>
                  </TableCell>
                  <TableCell className="text-right font-bold border border-border">{formatNumber(portalClosingCgst)}</TableCell>
                  <TableCell className="text-right font-bold border border-border">{formatNumber(portalClosingSgst)}</TableCell>
                  <TableCell className="text-right font-bold border border-border">{formatNumber(portalClosingIgst)}</TableCell>
                  <TableCell className="text-right font-bold border border-border">{formatNumber(portalClosingTotal)}</TableCell>
                </TableRow>

                {/* GST Payable — only when output > available ITC (cash leg) */}
                {hasPayable && (
                  <TableRow className="bg-destructive/5 hover:bg-destructive/5">
                    <TableCell className="font-medium border border-border">
                      <div>GST PAYABLE (CASH)</div>
                      <p className="text-[10px] text-muted-foreground font-normal mt-0.5">Output liability not covered by Available ITC — settle in cash</p>
                    </TableCell>
                    <TableCell className="text-right font-medium border border-border text-destructive">{formatNumber(payableCgst)}</TableCell>
                    <TableCell className="text-right font-medium border border-border text-destructive">{formatNumber(payableSgst)}</TableCell>
                    <TableCell className="text-right font-medium border border-border text-destructive">{formatNumber(payableIgst)}</TableCell>
                    <TableCell className="text-right font-bold border border-border text-destructive">{formatNumber(payableTotal)}</TableCell>
                  </TableRow>
                )}

                {/* Closing per books — manual */}
                <TableRow>
                  <TableCell className="font-medium border border-border">CLOSING BALANCE AS PER BOOKS</TableCell>
                  <TableCell className="p-0 border border-border">{renderBooksCell(booksClosingCgst, setBooksClosingCgst)}</TableCell>
                  <TableCell className="p-0 border border-border">{renderBooksCell(booksClosingSgst, setBooksClosingSgst)}</TableCell>
                  <TableCell className="p-0 border border-border">{renderBooksCell(booksClosingIgst, setBooksClosingIgst)}</TableCell>
                  <TableCell className="text-right font-medium border border-border bg-muted/30">{formatNumber(booksClosingTotal)}</TableCell>
                </TableRow>

                {/* Spacer */}
                <TableRow className="h-2 hover:bg-transparent">
                  <TableCell colSpan={5} className="border-0 p-0"></TableCell>
                </TableRow>

                {/* Difference */}
                <TableRow className="bg-warning/10 hover:bg-warning/10">
                  <TableCell className="font-bold border border-border">DIFFERENCE</TableCell>
                  <TableCell className={`text-right font-medium border border-border ${diffCgst !== 0 ? 'text-destructive' : ''}`}>{formatNumber(diffCgst)}</TableCell>
                  <TableCell className={`text-right font-medium border border-border ${diffSgst !== 0 ? 'text-destructive' : ''}`}>{formatNumber(diffSgst)}</TableCell>
                  <TableCell className={`text-right font-medium border border-border ${diffIgst !== 0 ? 'text-destructive' : ''}`}>{formatNumber(diffIgst)}</TableCell>
                  <TableCell className={`text-right font-bold border border-border ${diffTotal !== 0 ? 'text-destructive' : ''}`}>{formatNumber(diffTotal)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Hidden file picker for CSV upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleFileChange}
      />

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

export default GstReceivableRecoPage;
