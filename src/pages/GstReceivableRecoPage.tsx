import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, Save, Loader2, Upload, Info, Edit3, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
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
  openingBalancePeriodKey,
  formatPeriodLabel,
} from '@/utils/parseElectronicCreditLedgerCsv';
import { buildGstr3bJson } from '@/utils/buildGstr3bJson';

type OpeningSource = 'manual' | 'csv' | 'not_applicable';

interface HeadTriple { igst: number; cgst: number; sgst: number }

// Simulates the GST portal's cross-head ITC set-off so the fallback closing
// (when the Credit Ledger CSV isn't loaded) lands on the portal figure rather
// than leaving IGST credit unused. Order (cash-minimising, matches how the
// portal auto-sets-off): IGST credit → IGST liability; then IGST fills the
// CGST/SGST shortfall their OWN credit can't cover; any remaining IGST reduces
// CGST-then-SGST own-credit usage (so the excess credit is left where the
// portal usually leaves it); own-head credit pays own-head liability; finally
// CGST/SGST credit clears any residual IGST liability (Rule 88A). CGST and SGST
// credit never pay each other. Returns the per-head debit and the closing.
function simulateCrossHeadSetOff(liability: HeadTriple, credit: HeadTriple): { debit: HeadTriple; closing: HeadTriple } {
  let Li = Math.max(0, liability.igst), Lc = Math.max(0, liability.cgst), Ls = Math.max(0, liability.sgst);
  let Ci = Math.max(0, credit.igst), Cc = Math.max(0, credit.cgst), Cs = Math.max(0, credit.sgst);
  const take = (avail: number, need: number) => Math.min(Math.max(0, avail), Math.max(0, need));
  let x = take(Ci, Li); Ci -= x; Li -= x;                    // IGST → IGST
  x = take(Ci, Math.max(0, Lc - Cc)); Ci -= x; Lc -= x;      // IGST → CGST shortfall
  x = take(Ci, Math.max(0, Ls - Cs)); Ci -= x; Ls -= x;      // IGST → SGST shortfall
  x = take(Ci, Lc); Ci -= x; Lc -= x;                        // IGST → remaining CGST
  x = take(Ci, Ls); Ci -= x; Ls -= x;                        // IGST → remaining SGST
  x = take(Cc, Lc); Cc -= x; Lc -= x;                        // CGST → CGST
  x = take(Cs, Ls); Cs -= x; Ls -= x;                        // SGST → SGST
  x = take(Cc, Li); Cc -= x; Li -= x;                        // CGST → residual IGST (88A)
  x = take(Cs, Li); Cs -= x; Li -= x;                        // SGST → residual IGST (88A)
  return {
    debit: { igst: Math.max(0, credit.igst) - Ci, cgst: Math.max(0, credit.cgst) - Cc, sgst: Math.max(0, credit.sgst) - Cs },
    closing: { igst: Ci, cgst: Cc, sgst: Cs },
  };
}

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
  const { user, isStaffRole, canManualOverride } = useAuth();
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
  // ITC actually utilized. When the Credit Ledger CSV has been uploaded we
  // pull the M-1 Debit row's per-head amounts (cross-head accurate). Otherwise
  // we fall back to GSTR-1 output (per-head approximation).
  const [utilizedCgst, setUtilizedCgst] = useState(0);
  const [utilizedSgst, setUtilizedSgst] = useState(0);
  const [utilizedIgst, setUtilizedIgst] = useState(0);
  const [utilizedFromCsv, setUtilizedFromCsv] = useState(false);

  // DRC-03 / other credit-ledger debits (demand, appeal, interest, penalty)
  // paid THROUGH the credit ledger in the reco window. Persisted; auto-detected
  // from the Credit Ledger CSV and manually editable.
  const [drcCgst, setDrcCgst] = useState(0);
  const [drcSgst, setDrcSgst] = useState(0);
  const [drcIgst, setDrcIgst] = useState(0);

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

  // Human label for the M-1 source month, e.g. "May-26" when selectedMonth is June 2026
  const prevMonthLabel = useMemo(() => {
    const prev = previousPeriodMonthKey(selectedMonth);
    return prev ? formatPeriodLabel(prev) : '';
  }, [selectedMonth]);

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
        const hasUtilizedFromCsv =
          r.utilized_cgst !== null && r.utilized_cgst !== undefined;
        setUtilizedFromCsv(!!hasUtilizedFromCsv);
        if (hasUtilizedFromCsv) {
          setUtilizedCgst(Number(r.utilized_cgst) || 0);
          setUtilizedSgst(Number(r.utilized_sgst) || 0);
          setUtilizedIgst(Number(r.utilized_igst) || 0);
        }
        setDrcCgst(Number((r as any).drc_cgst) || 0);
        setDrcSgst(Number((r as any).drc_sgst) || 0);
        setDrcIgst(Number((r as any).drc_igst) || 0);

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
        setUtilizedFromCsv(false);
        setDrcCgst(0); setDrcSgst(0); setDrcIgst(0);
        setLastSavedBy(null);
      }

      // The June-26 page verifies May-26 set-off, so all derived figures come
      // from the M-1 (previous month) sources.
      const prevMonth = previousPeriodMonthKey(selectedMonth);

      // 2. ITC Summary (M-1) → Net ITC Available (4C = 4A − 4B)
      const { data: itcData } = prevMonth
        ? await supabase
            .from('itc_summaries')
            .select('data')
            .eq('client_id', selectedClientId)
            .eq('period_month', prevMonth)
            .maybeSingle()
        : { data: null };

      if (itcData?.data) {
        setHasItcSummary(true);
        const itc = itcData.data as any;
        const rowsA: any[] = itc.section4A || [];
        const rowsB: any[] = itc.section4B || [];
        const findRow = (rows: any[], srNo: string) =>
          rows.find(r => r?.srNo === srNo) || { cgst: 0, sgst: 0, igst: 0 };
        const num = (v: any) => Number(v) || 0;

        // Total (5) = 5.1 + 5.2 − 5.3 + 5.4 + 5.5 (matches ITC Summary page)
        const r51 = findRow(rowsA, '5.1');
        const r52 = findRow(rowsA, '5.2');
        const r53 = findRow(rowsA, '5.3');
        const r54 = findRow(rowsA, '5.4');
        const r55 = findRow(rowsA, '5.5');
        const total5 = {
          cgst: num(r51.cgst) + num(r52.cgst) - num(r53.cgst) + num(r54.cgst) + num(r55.cgst),
          sgst: num(r51.sgst) + num(r52.sgst) - num(r53.sgst) + num(r54.sgst) + num(r55.sgst),
          igst: num(r51.igst) + num(r52.igst) - num(r53.igst) + num(r54.igst) + num(r55.igst),
        };
        // Total 4A = rows (1)+(2)+(3)+(4) + Total (5)
        const rows1To4 = rowsA.slice(0, 4).reduce(
          (acc, r) => ({
            cgst: acc.cgst + num(r?.cgst),
            sgst: acc.sgst + num(r?.sgst),
            igst: acc.igst + num(r?.igst),
          }),
          { cgst: 0, sgst: 0, igst: 0 }
        );
        const total4A = {
          cgst: rows1To4.cgst + total5.cgst,
          sgst: rows1To4.sgst + total5.sgst,
          igst: rows1To4.igst + total5.igst,
        };
        // Partial-ITC (Builder) clients have a different section 4B shape:
        // rows (1) and (2) are auto-derived aggregators (computed at ITC
        // Summary render time from their sub-rows). They aren't tagged
        // isHeader AND aren't persisted with their computed values (stored as
        // 0), so neither a blind non-isHeader sum (double-counts subs) nor a
        // direct (1)+(2) lookup (reads zeros) is correct. Detect the layout
        // and sum ONLY the sub-rows — which is exactly what ITC Summary uses
        // to derive (1) and (2).
        const isPartialITC =
          typeof rowsB[0]?.particular === 'string' &&
          rowsB[0].particular.toLowerCase().includes('calculation of ineligible');
        const total4B = isPartialITC
          ? rowsB
              .filter(r => r?.srNo !== '(1)' && r?.srNo !== '(2)')
              .reduce(
                (acc, r) => ({
                  cgst: acc.cgst + num(r?.cgst),
                  sgst: acc.sgst + num(r?.sgst),
                  igst: acc.igst + num(r?.igst),
                }),
                { cgst: 0, sgst: 0, igst: 0 }
              )
          : rowsB
              .filter(r => !r?.isHeader)
              .reduce(
                (acc, r) => ({
                  cgst: acc.cgst + num(r?.cgst),
                  sgst: acc.sgst + num(r?.sgst),
                  igst: acc.igst + num(r?.igst),
                }),
                { cgst: 0, sgst: 0, igst: 0 }
              );
        // Net ITC Available (4C) = 4A − 4B
        setAvailedCgst(total4A.cgst - total4B.cgst);
        setAvailedSgst(total4A.sgst - total4B.sgst);
        setAvailedIgst(total4A.igst - total4B.igst);
      } else {
        setHasItcSummary(false);
        setAvailedCgst(0); setAvailedSgst(0); setAvailedIgst(0);
      }

      // 3. GSTR-1 (M-1) → output tax. Only used as a fallback when the CSV
      // hasn't been uploaded; otherwise the M-1 Debit row from the credit
      // ledger CSV is more accurate (it includes cross-head set-off).
      const hasUtilizedFromCsv =
        rowData &&
        (rowData as any).utilized_cgst !== null &&
        (rowData as any).utilized_cgst !== undefined;
      const shortMonth = prevMonth ? toShortMonth(prevMonth) : '';
      const { data: gstr1Data } = shortMonth
        ? await supabase
            .from('gstr1_data')
            .select('raw_json')
            .eq('client_id', selectedClientId)
            .eq('period_month', shortMonth)
            .maybeSingle()
        : { data: null };

      setHasGstr1(!!gstr1Data?.raw_json);
      if (!hasUtilizedFromCsv) {
        if (gstr1Data?.raw_json) {
          // ITC utilized fallback = the GSTR-3B output liability (Table 3.1a),
          // computed from M-1's GSTR-1 exactly like the GSTR-3B module. Capped
          // at Available ITC in the closing math below.
          const { summary } = buildGstr3bJson({
            gstin: '', periodMonth: prevMonth || '', gstr1Raw: gstr1Data.raw_json,
            itc: null, rcm: { taxable: 0, igst: 0, cgst: 0, sgst: 0 },
          });
          setUtilizedCgst(summary.outward.cgst);
          setUtilizedSgst(summary.outward.sgst);
          setUtilizedIgst(summary.outward.igst);
        } else {
          setUtilizedCgst(0); setUtilizedSgst(0); setUtilizedIgst(0);
        }
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

      // Page verifies M-1's set-off, so opening = M-2's closing balance.
      const openingKey = openingBalancePeriodKey(selectedMonth);
      if (!openingKey) {
        toast.error('Could not determine the opening return period.');
        return;
      }
      const row = parsed.rowsByPeriod.get(openingKey);
      if (!row) {
        toast.error(`Credit Ledger CSV has no ${formatPeriodLabel(openingKey)} entry. Upload rejected.`);
        return;
      }

      // ITC actually utilized in M-1 = the per-head Debit amounts of the M-1
      // row in the same CSV (cols 6-10). rowsByPeriod keeps the highest-S.No
      // row per period which is the Debit row when both Credit + Debit exist.
      const prevKey = previousPeriodMonthKey(selectedMonth);
      const prevRow = prevKey ? parsed.rowsByPeriod.get(prevKey) : undefined;
      const utilizedFromCsvRow =
        prevRow && prevRow.transactionType.toLowerCase() === 'debit'
          ? { cgst: prevRow.amountCgst, sgst: prevRow.amountSgst, igst: prevRow.amountIgst }
          : null;

      // DRC-03 / other ledger debits in the reco window = Debit rows between the
      // opening (M-2) row and period M's first entry whose description is NOT a
      // monthly return set-off (anything without "reverse charge"). Captures
      // demand / appeal / interest / penalty paid through the credit ledger.
      const periodMFirstSrNo = parsed.rows
        .filter((r) => r.periodMonthKey === selectedMonth)
        .reduce((min, r) => Math.min(min, r.srNo), Infinity);
      const drcFromCsv = parsed.rows
        .filter((r) =>
          r.transactionType.toLowerCase() === 'debit' &&
          !r.description.toLowerCase().includes('reverse charge') &&
          r.srNo > row.srNo &&
          r.srNo < periodMFirstSrNo)
        .reduce(
          (a, r) => ({ cgst: a.cgst + r.amountCgst, sgst: a.sgst + r.amountSgst, igst: a.igst + r.amountIgst }),
          { cgst: 0, sgst: 0, igst: 0 },
        );

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
          utilized_cgst: utilizedFromCsvRow?.cgst ?? null,
          utilized_sgst: utilizedFromCsvRow?.sgst ?? null,
          utilized_igst: utilizedFromCsvRow?.igst ?? null,
          drc_cgst: drcFromCsv.cgst,
          drc_sgst: drcFromCsv.sgst,
          drc_igst: drcFromCsv.igst,
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
      if (utilizedFromCsvRow) {
        setUtilizedCgst(utilizedFromCsvRow.cgst);
        setUtilizedSgst(utilizedFromCsvRow.sgst);
        setUtilizedIgst(utilizedFromCsvRow.igst);
        setUtilizedFromCsv(true);
      } else {
        setUtilizedFromCsv(false);
      }
      setDrcCgst(drcFromCsv.cgst);
      setDrcSgst(drcFromCsv.sgst);
      setDrcIgst(drcFromCsv.igst);

      const utilizedNote = utilizedFromCsvRow
        ? ` ITC utilized captured from ${prevKey ? formatPeriodLabel(prevKey) : 'M-1'} Debit row.`
        : '';
      toast.success(`Opening balance set from ${formatPeriodLabel(row.periodMonthKey)} (S.No ${row.srNo}).${utilizedNote}`);
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
          utilized_cgst: null,
          utilized_sgst: null,
          utilized_igst: null,
          drc_cgst: 0,
          drc_sgst: 0,
          drc_igst: 0,
          books_closing_cgst: booksClosingCgst,
          books_closing_sgst: booksClosingSgst,
          books_closing_igst: booksClosingIgst,
          updated_by: user?.id,
          updated_at: now,
        }, { onConflict: 'client_id,period_month' });
      if (error) throw error;

      setOpeningCgst(0); setOpeningSgst(0); setOpeningIgst(0);
      setDrcCgst(0); setDrcSgst(0); setDrcIgst(0);
      setOpeningSource('not_applicable');
      setOpeningCsvPeriodMonth(null);
      setOpeningCsvUploadedAt(null);
      setOpeningCsvUploadedBy(null);
      setOpeningCsvUploaderName(null);
      setOpeningOverrideJustification(null);
      setOpeningOverrideAt(null);
      setOpeningOverrideBy(null);
      setOpeningOverriderName(null);
      setUtilizedFromCsv(false);

      toast.success('Marked Not Applicable. Opening balance set to 0.');
    } catch (error: any) {
      toast.error('Failed to save: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOverrideSave = async (values: { cgst: number; sgst: number; igst: number; justification: string }) => {
    if (!canManualOverride() || !selectedClientId || !selectedMonth) return;
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
          utilized_cgst: utilizedFromCsv ? utilizedCgst : null,
          utilized_sgst: utilizedFromCsv ? utilizedSgst : null,
          utilized_igst: utilizedFromCsv ? utilizedIgst : null,
          drc_cgst: drcCgst,
          drc_sgst: drcSgst,
          drc_igst: drcIgst,
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
          utilized_cgst: utilizedFromCsv ? utilizedCgst : null,
          utilized_sgst: utilizedFromCsv ? utilizedSgst : null,
          utilized_igst: utilizedFromCsv ? utilizedIgst : null,
          drc_cgst: drcCgst,
          drc_sgst: drcSgst,
          drc_igst: drcIgst,
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

  // Per-head available ITC: Opening (M-2 closing) + Net ITC Available (M-1 4C).
  // The 4B reversals/4D reclaims are already netted inside 4C, so we don't
  // subtract/add them again here.
  const availableCgst = openingCgst + availedCgst;
  const availableSgst = openingSgst + availedSgst;
  const availableIgst = openingIgst + availedIgst;

  // When utilized comes from the credit ledger CSV, it's the actual per-head
  // debit the portal applied, so we use it as-is and the closing matches the
  // portal exactly. Otherwise we SIMULATE the portal's cross-head set-off
  // (IGST credit pays IGST, then CGST/SGST) so the fallback closing lands on
  // the portal figure — see simulateCrossHeadSetOff.
  const safeAvailableCgst = Math.max(0, availableCgst);
  const safeAvailableSgst = Math.max(0, availableSgst);
  const safeAvailableIgst = Math.max(0, availableIgst);

  let actualUtilizedCgst: number, actualUtilizedSgst: number, actualUtilizedIgst: number;
  let portalClosingCgst: number, portalClosingSgst: number, portalClosingIgst: number;
  if (utilizedFromCsv) {
    actualUtilizedCgst = utilizedCgst;
    actualUtilizedSgst = utilizedSgst;
    actualUtilizedIgst = utilizedIgst;
    portalClosingCgst = availableCgst - actualUtilizedCgst;
    portalClosingSgst = availableSgst - actualUtilizedSgst;
    portalClosingIgst = availableIgst - actualUtilizedIgst;
  } else {
    const sim = simulateCrossHeadSetOff(
      { igst: utilizedIgst, cgst: utilizedCgst, sgst: utilizedSgst },
      { igst: safeAvailableIgst, cgst: safeAvailableCgst, sgst: safeAvailableSgst },
    );
    actualUtilizedIgst = sim.debit.igst;
    actualUtilizedCgst = sim.debit.cgst;
    actualUtilizedSgst = sim.debit.sgst;
    portalClosingIgst = sim.closing.igst;
    portalClosingCgst = sim.closing.cgst;
    portalClosingSgst = sim.closing.sgst;
  }

  // DRC-03 / other ledger debits (demand, appeal, interest, penalty) are paid
  // out of the credit ledger too, so they reduce the closing balance further.
  portalClosingCgst = Math.max(0, portalClosingCgst - drcCgst);
  portalClosingSgst = Math.max(0, portalClosingSgst - drcSgst);
  portalClosingIgst = Math.max(0, portalClosingIgst - drcIgst);

  const openingTotal = openingCgst + openingSgst + openingIgst;
  const drcTotal = drcCgst + drcSgst + drcIgst;
  const availedTotal = availedCgst + availedSgst + availedIgst;
  const utilizedDisplayTotal = actualUtilizedCgst + actualUtilizedSgst + actualUtilizedIgst;
  const portalClosingTotal = portalClosingCgst + portalClosingSgst + portalClosingIgst;
  const booksClosingTotal = booksClosingCgst + booksClosingSgst + booksClosingIgst;

  // Diff with Rs.10 tolerance — display 0 if |diff| <= 10
  const applyTolerance = (v: number) => (Math.abs(v) <= 10 ? 0 : v);
  const diffCgst = applyTolerance(portalClosingCgst - booksClosingCgst);
  const diffSgst = applyTolerance(portalClosingSgst - booksClosingSgst);
  const diffIgst = applyTolerance(portalClosingIgst - booksClosingIgst);
  const diffTotal = applyTolerance(portalClosingTotal - booksClosingTotal);

  const renderBooksCell = (value: number, onChange: (val: number) => void) => {
    if (!isStaff) return <span className="block text-right tabular-nums px-3">{formatNumber(value)}</span>;
    return (
      <Input
        type="number"
        value={value || ''}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="h-10 text-right tabular-nums border-0 shadow-none rounded-none"
        aria-label="Closing balance as per books amount"
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

  // ──────────────────────────── Render ───────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        embedded
        title="GST Receivable Reco"
        subtitle="Reconcile Electronic Credit Ledger closing with books"
        icon={<FileText className="h-6 w-6" />}
        actions={
          <>
            {isStaff && (
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
            {isEligibleMonth && selectedClientData && (
              <Button variant="outline" onClick={() => {
                exportGstReceivableRecoToExcel({
                  clientName: selectedClientData.name,
                  clientGstin: selectedClientData.gstin,
                  month: selectedMonth,
                  prevMonthLabel,
                  openingCgst, openingSgst, openingIgst,
                  availedCgst, availedSgst, availedIgst,
                  utilizedCgst: actualUtilizedCgst,
                  utilizedSgst: actualUtilizedSgst,
                  utilizedIgst: actualUtilizedIgst,
                  drcCgst, drcSgst, drcIgst,
                  portalClosingCgst, portalClosingSgst, portalClosingIgst,
                  booksClosingCgst, booksClosingSgst, booksClosingIgst,
                  diffCgst, diffSgst, diffIgst,
                });
                toast.success('Excel exported successfully');
              }}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Export Excel
              </Button>
            )}
            {isStaff && isEligibleMonth && (
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            )}
          </>
        }
      />

      {lastSavedBy && (
        <p className="text-xs text-muted-foreground -mt-3">
          Last saved by <span className="font-semibold text-foreground">{lastSavedBy.name}</span>
          {lastSavedBy.role && <span className="text-muted-foreground"> ({lastSavedBy.role})</span>}
          {lastSavedBy.time && (
            <> on {new Date(lastSavedBy.time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date(lastSavedBy.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</>
          )}
        </p>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground whitespace-nowrap">Client:</span>
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          {!selectedClientId || !selectedMonth ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Please select a client and month to view the reconciliation.
            </div>
          ) : !isEligibleMonth ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              GST Receivable Reco is available from return period <span className="font-semibold">Jun-26</span> onward.
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="font-bold text-primary-foreground border border-primary">PARTICULARS</TableHead>
                  <TableHead className="font-bold text-primary-foreground text-center border border-primary">IGST</TableHead>
                  <TableHead className="font-bold text-primary-foreground text-center border border-primary">CGST</TableHead>
                  <TableHead className="font-bold text-primary-foreground text-center border border-primary">SGST</TableHead>
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
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleNotApplicable} disabled={!selectedClientId || isSaving}>
                            Not Applicable
                          </Button>
                          {openingSource !== 'manual' && canManualOverride() && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowOverrideDialog(true)} disabled={!selectedClientId || isSaving}>
                              <Edit3 className="h-3 w-3 mr-1" />
                              Override
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={handleUploadClick} disabled={!selectedClientId || isSaving} title="Manual fallback — upload the ledger if the portal sync didn't set this">
                            <Upload className="h-3 w-3 mr-1" />
                            {openingSource === 'csv' ? 'Re-upload' : 'Upload'}
                          </Button>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums border border-border bg-accent/30">{formatNumber(openingIgst)}</TableCell>
                  <TableCell className="text-right tabular-nums border border-border bg-accent/30">{formatNumber(openingCgst)}</TableCell>
                  <TableCell className="text-right tabular-nums border border-border bg-accent/30">{formatNumber(openingSgst)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium border border-border bg-muted/30">{formatNumber(openingTotal)}</TableCell>
                </TableRow>

                {/* Net ITC Available — auto from ITC Summary (M-1) 4C = 4A − 4B */}
                <TableRow>
                  <TableCell className="font-medium border border-border">
                    <div>ADD: NET ITC AVAILABLE (4C)</div>
                    <p className="text-[10px] text-muted-foreground font-normal mt-0.5">{prevMonthLabel ? `From ${prevMonthLabel} ITC Summary (4A − 4B)` : '4A − 4B from previous month'}</p>
                    {!hasItcSummary && <p className="text-[10px] text-muted-foreground font-normal mt-0.5">{prevMonthLabel ? `ITC Summary not saved for ${prevMonthLabel} — showing 0` : 'ITC Summary not saved — showing 0'}</p>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums border border-border bg-accent/30">{formatNumber(availedIgst)}</TableCell>
                  <TableCell className="text-right tabular-nums border border-border bg-accent/30">{formatNumber(availedCgst)}</TableCell>
                  <TableCell className="text-right tabular-nums border border-border bg-accent/30">{formatNumber(availedSgst)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium border border-border bg-muted/30">{formatNumber(availedTotal)}</TableCell>
                </TableRow>

                {/* ITC Utilized — actual per-head debit from credit ledger CSV when available, GSTR-3B output otherwise */}
                <TableRow>
                  <TableCell className="font-medium border border-border">
                    <div>LESS: ITC UTILIZED</div>
                    <p className="text-[10px] text-muted-foreground font-normal mt-0.5">
                      {utilizedFromCsv
                        ? `Actual per-head debit from ${prevMonthLabel || 'M-1'} row of Credit Ledger (covers cross-head set-off)`
                        : prevMonthLabel
                          ? `From ${prevMonthLabel} GSTR-3B output (Table 3.1a), set off cross-head like the portal (estimate)`
                          : 'From previous month GSTR-3B output (Table 3.1a), set off cross-head like the portal (estimate)'}
                    </p>
                    {!utilizedFromCsv && !hasGstr1 && (
                      <p className="text-[10px] text-muted-foreground font-normal mt-0.5">
                        {prevMonthLabel ? `GSTR-1 not imported for ${prevMonthLabel} — showing 0` : 'GSTR-1 not imported — showing 0'}
                      </p>
                    )}
                    {!utilizedFromCsv && (
                      <p className="text-[10px] text-warning font-normal mt-0.5">
                        Tip: Upload the Credit Ledger CSV to pull the actual per-head debit (closing will then tally with the portal).
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums border border-border bg-accent/30">{formatNumber(actualUtilizedIgst)}</TableCell>
                  <TableCell className="text-right tabular-nums border border-border bg-accent/30">{formatNumber(actualUtilizedCgst)}</TableCell>
                  <TableCell className="text-right tabular-nums border border-border bg-accent/30">{formatNumber(actualUtilizedSgst)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium border border-border bg-muted/30">{formatNumber(utilizedDisplayTotal)}</TableCell>
                </TableRow>

                {/* DRC-03 / other ledger debits — auto-detected from the CSV, editable */}
                <TableRow>
                  <TableCell className="font-medium border border-border">
                    <div>LESS: DRC-03 / OTHER LEDGER DEBITS</div>
                    <p className="text-[10px] text-muted-foreground font-normal mt-0.5">
                      Demand / appeal / interest / penalty paid through the credit ledger — auto-detected from the CSV; editable
                    </p>
                  </TableCell>
                  <TableCell className="p-0 border border-border">{renderBooksCell(drcIgst, setDrcIgst)}</TableCell>
                  <TableCell className="p-0 border border-border">{renderBooksCell(drcCgst, setDrcCgst)}</TableCell>
                  <TableCell className="p-0 border border-border">{renderBooksCell(drcSgst, setDrcSgst)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium border border-border bg-muted/30">{formatNumber(drcTotal)}</TableCell>
                </TableRow>

                {/* Spacer */}
                <TableRow className="h-2 hover:bg-transparent">
                  <TableCell colSpan={5} className="border-0 p-0"></TableCell>
                </TableRow>

                {/* Closing per portal — computed */}
                <TableRow className="bg-secondary/30 hover:bg-secondary/30">
                  <TableCell className="font-bold border border-border">
                    <div>CLOSING BALANCE AS PER PORTAL</div>
                    <p className="text-[10px] text-muted-foreground font-normal mt-0.5">Opening + Net ITC Available − ITC Utilized − DRC-03 (clamped at 0)</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-bold border border-border">{formatNumber(portalClosingIgst)}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold border border-border">{formatNumber(portalClosingCgst)}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold border border-border">{formatNumber(portalClosingSgst)}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold border border-border">{formatNumber(portalClosingTotal)}</TableCell>
                </TableRow>

                {/* Closing per books — manual */}
                <TableRow>
                  <TableCell className="font-medium border border-border">CLOSING BALANCE AS PER BOOKS</TableCell>
                  <TableCell className="p-0 border border-border">{renderBooksCell(booksClosingIgst, setBooksClosingIgst)}</TableCell>
                  <TableCell className="p-0 border border-border">{renderBooksCell(booksClosingCgst, setBooksClosingCgst)}</TableCell>
                  <TableCell className="p-0 border border-border">{renderBooksCell(booksClosingSgst, setBooksClosingSgst)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium border border-border bg-muted/30">{formatNumber(booksClosingTotal)}</TableCell>
                </TableRow>

                {/* Spacer */}
                <TableRow className="h-2 hover:bg-transparent">
                  <TableCell colSpan={5} className="border-0 p-0"></TableCell>
                </TableRow>

                {/* Difference */}
                <TableRow className="bg-warning/10 hover:bg-warning/10">
                  <TableCell className="font-bold border border-border">DIFFERENCE</TableCell>
                  <TableCell className={`text-right tabular-nums font-medium border border-border ${diffIgst !== 0 ? 'text-destructive' : ''}`}>{formatNumber(diffIgst)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-medium border border-border ${diffCgst !== 0 ? 'text-destructive' : ''}`}>{formatNumber(diffCgst)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-medium border border-border ${diffSgst !== 0 ? 'text-destructive' : ''}`}>{formatNumber(diffSgst)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-bold border border-border ${diffTotal !== 0 ? 'text-destructive' : ''}`}>{formatNumber(diffTotal)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

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

export default GstReceivableRecoPage;
