import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, Save, Loader2, Upload, Info, Edit3, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, Note, SectionCard } from '@/components/gstr9/ui';
import {
  WS_BTN, WS_CELL_INPUT, WS_CONTROL, WS_FILTER_LABEL, WS_PAGE, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL,
} from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
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
import { computeGstr1OutputTax } from '@/utils/computeGstr1OutputTax';
import { utilisedFromLedger } from '@/lib/gstReceivableRecoCalc';
import ManualSourceAllowanceControl from '@/components/manualSource/ManualSourceAllowanceControl';
import Gstr3bGateNote from '@/components/reco/Gstr3bGateNote';
import { fetchManualSourceAllowances, liveAllowance, staffNames, type ManualSourceAllowance } from '@/lib/manualSource';
import {
  booksUnsaved, extensionCanPull, fetchRecoLog, fmtDateTime, needsExtensionMessage, openingManualState, openingSourceText, pulledLabel,
  receivableSavePayload, recordManualOpening, recordOverride, recoLogActionLabel, recoScope, UNSAVED_BOOKS_MESSAGE,
  type OpeningSource, type RecoLogEntry,
} from '@/lib/recoSources';
import { checkGstr3bPushGate, headsTally, type Gstr3bGateResult } from '@/lib/gstr3bPushGate';

const SCOPE = recoScope('receivable');

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
  // Needed to replicate ITC Summary's Partial-ITC 4B formula
  builder_itc_type?: string | null;
  commercial_area?: number | null;
  residential_area?: number | null;
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

// bills_not_in_2b.reversal_month / reclaim_month are free-text (e.g. "Jun-26",
// "June 2026", "06/2026") — mirrors ITCSummaryPage's getMonthPatterns /
// monthMatches exactly, so this page's live reversal/reclaim totals for M-1
// match what ITC Summary itself would compute for that period.
const getMonthPatterns = (monthStr: string) => {
  const [monthNum, year] = monthStr.split('/');
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monthName = monthNames[parseInt(monthNum) - 1] || '';
  const yearShort = year?.slice(-2) || '';
  const yearSingle = year?.slice(-1) || '';
  return { monthName, yearShort, yearSingle, fullYear: year || '' };
};
const monthMatches = (storedMonth: string | null, patterns: ReturnType<typeof getMonthPatterns>): boolean => {
  if (!storedMonth) return false;
  const stored = storedMonth.toLowerCase().trim();
  const { monthName, yearShort, yearSingle, fullYear } = patterns;
  const hasMonth = stored.includes(monthName);
  const hasYear = stored.includes(yearShort) || stored.includes(yearSingle) || stored.includes(fullYear);
  return hasMonth && hasYear;
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
  // Pulled from the portal (who, when), the manual entry the superadmin
  // allowed, and the change log (migration 20261021120000).
  const [openingPulledAt, setOpeningPulledAt] = useState<string | null>(null);
  const [openingPullerName, setOpeningPullerName] = useState<string | null>(null);
  const [openingAllowanceId, setOpeningAllowanceId] = useState<string | null>(null);
  const [openingPortalEmpty, setOpeningPortalEmpty] = useState(false);
  const [allowances, setAllowances] = useState<ManualSourceAllowance[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [recoLog, setRecoLog] = useState<RecoLogEntry[]>([]);
  const [gate, setGate] = useState<Gstr3bGateResult | null>(null);
  const [gateLoading, setGateLoading] = useState(false);
  const gateSeq = useRef(0);

  // Books closing balance — persisted, manually entered
  const [booksClosingCgst, setBooksClosingCgst] = useState(0);
  const [booksClosingSgst, setBooksClosingSgst] = useState(0);
  const [booksClosingIgst, setBooksClosingIgst] = useState(0);
  // The books closing as last saved (or loaded): typed figures that differ
  // are not saved yet (booksDirty).
  const [savedBooks, setSavedBooks] = useState({ cgst: 0, sgst: 0, igst: 0 });

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
  // Net ITC Available (4C) is only taken from ITC Summary once M-1's
  // GSTR-3B is actually Filed — before that it's still a draft that can
  // keep changing, so the reco intentionally shows 0 rather than a number
  // that might not match what eventually gets filed.
  const [prevReturnFiled, setPrevReturnFiled] = useState(false);

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
    let query = supabase
      .from('clients')
      .select('id, name, gstin, registration_date, builder_itc_type, commercial_area, residential_area')
      .order('name');
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
        setSavedBooks({ cgst: Number(r.books_closing_cgst) || 0, sgst: Number(r.books_closing_sgst) || 0, igst: Number(r.books_closing_igst) || 0 });
        // From the credit ledger (pulled, or an allowed manual entry): its
        // set-off debit, none seen being 0. Only a row not yet pulled shows
        // the GSTR-1 estimate (gstReceivableRecoCalc.ts, §13 of the 2B doc).
        const hasUtilizedFromCsv = utilisedFromLedger(r);
        setUtilizedFromCsv(hasUtilizedFromCsv);
        setOpeningPulledAt(r.opening_portal_pulled_at || null);
        setOpeningAllowanceId(r.opening_allowance_id || null);
        setOpeningPortalEmpty(r.opening_portal_empty === true);
        if (hasUtilizedFromCsv) {
          setUtilizedCgst(Number(r.utilized_cgst) || 0);
          setUtilizedSgst(Number(r.utilized_sgst) || 0);
          setUtilizedIgst(Number(r.utilized_igst) || 0);
        }
        setDrcCgst(Number((r as any).drc_cgst) || 0);
        setDrcSgst(Number((r as any).drc_sgst) || 0);
        setDrcIgst(Number((r as any).drc_igst) || 0);

        // Resolve names for hover popover
        const nameMap = await staffNames([r.opening_csv_uploaded_by, r.opening_override_by, r.opening_portal_pulled_by]);
        setOpeningCsvUploaderName(r.opening_csv_uploaded_by ? (nameMap.get(r.opening_csv_uploaded_by) || 'Unknown') : null);
        setOpeningOverriderName(r.opening_override_by ? (nameMap.get(r.opening_override_by) || 'Unknown') : null);
        setOpeningPullerName(r.opening_portal_pulled_by ? (nameMap.get(r.opening_portal_pulled_by) || 'Unknown') : null);

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
        setSavedBooks({ cgst: 0, sgst: 0, igst: 0 });
        setUtilizedFromCsv(false);
        setDrcCgst(0); setDrcSgst(0); setDrcIgst(0);
        setOpeningPulledAt(null);
        setOpeningPullerName(null);
        setOpeningAllowanceId(null);
        setOpeningPortalEmpty(false);
        setLastSavedBy(null);
      }

      // The superadmin's manual-entry allowances for this client and month,
      // and the change log of the opening.
      const [allowRows, logRows] = await Promise.all([
        fetchManualSourceAllowances(selectedClientId, selectedMonth, SCOPE).catch(() => [] as ManualSourceAllowance[]),
        fetchRecoLog('receivable', selectedClientId, selectedMonth),
      ]);
      setAllowances(allowRows);
      setRecoLog(logRows);
      setNames(await staffNames([...allowRows.map(a => a.allowed_by), ...logRows.map(l => l.actor_id)]));

      // The June-26 page verifies May-26 set-off, so all derived figures come
      // from the M-1 (previous month) sources.
      const prevMonth = previousPeriodMonthKey(selectedMonth);

      // 2. ITC Summary (M-1) → Net ITC Available (4C = 4A − 4B). ITC Summary's
      // own auto-linked rows (RCM ITC, 2B-Reco reversal/reclaim) only get
      // baked into this saved snapshot on a manual Save, and can keep
      // changing right up to the point M-1's GSTR-3B is actually filed — so
      // only trust this snapshot once that return is Filed (it's locked at
      // that point and won't drift again); before that it's still a draft.
      const [{ data: itcData }, { data: prevFilingRows }] = prevMonth
        ? await Promise.all([
            supabase.from('itc_summaries').select('data').eq('client_id', selectedClientId).eq('period_month', prevMonth).maybeSingle(),
            supabase.from('filing_status').select('status').eq('client_id', selectedClientId).eq('period_month', prevMonth).in('return_type', ['GSTR-3B', 'GSTR-3B (Q)']),
          ])
        : [{ data: null }, { data: null }];
      const prevReturnFiled = !!prevFilingRows?.some((f: any) => f.status === 'Filed');
      setPrevReturnFiled(prevReturnFiled);

      if (itcData?.data && prevReturnFiled) {
        setHasItcSummary(true);
        const itc = itcData.data as any;
        const rowsA: any[] = itc.section4A || [];
        const rowsB: any[] = itc.section4B || [];
        const findRow = (rows: any[], srNo: string) =>
          rows.find(r => r?.srNo === srNo) || { cgst: 0, sgst: 0, igst: 0 };
        const num = (v: any) => Number(v) || 0;
        const zero3 = { cgst: 0, sgst: 0, igst: 0 };

        // ITC Summary auto-links three rows live (RCM ITC, and two from 2B
        // Reconciliation) and only bakes them into the saved snapshot on a
        // manual Save. Recompute them the same way here so this page always
        // matches what ITC Summary is currently displaying for M-1, not
        // whatever happened to be saved last.
        const prevShortMonth = prevMonth ? toShortMonth(prevMonth) : '';
        const patterns = prevMonth ? getMonthPatterns(prevMonth) : null;
        const [{ data: rcmRows }, { data: reversalBills }, { data: reclaimBills }] = await Promise.all([
          prevShortMonth
            ? supabase.from('rcm_data').select('cgst_2_5, cgst_9, sgst_2_5, sgst_9, igst_5, igst_18').eq('client_id', selectedClientId).eq('month', prevShortMonth)
            : Promise.resolve({ data: null }),
          prevMonth
            ? supabase.from('bills_not_in_2b').select('input_igst, input_cgst, input_sgst, reversal_month').eq('client_id', selectedClientId).eq('period_month', prevMonth).not('reversal_month', 'is', null)
            : Promise.resolve({ data: null }),
          prevMonth
            ? supabase.from('bills_not_in_2b').select('input_igst, input_cgst, input_sgst, reclaim_month, reclaim_subtype').eq('client_id', selectedClientId).eq('period_month', prevMonth).not('reclaim_month', 'is', null)
            : Promise.resolve({ data: null }),
        ]);
        const liveRcmItc = (rcmRows || []).reduce(
          (acc: any, r: any) => ({
            igst: acc.igst + (Number(r.igst_5) || 0) + (Number(r.igst_18) || 0),
            cgst: acc.cgst + (Number(r.cgst_2_5) || 0) + (Number(r.cgst_9) || 0),
            sgst: acc.sgst + (Number(r.sgst_2_5) || 0) + (Number(r.sgst_9) || 0),
          }),
          zero3
        );
        const liveReversal = patterns
          ? (reversalBills || [])
              .filter((b: any) => monthMatches(b.reversal_month, patterns))
              .reduce((acc: any, b: any) => ({
                igst: acc.igst + (b.input_igst || 0), cgst: acc.cgst + (b.input_cgst || 0), sgst: acc.sgst + (b.input_sgst || 0),
              }), zero3)
          : zero3;
        const liveReclaim = patterns
          ? (reclaimBills || [])
              .filter((b: any) => b.reclaim_subtype !== 'EXPENSE_OUT' && monthMatches(b.reclaim_month, patterns))
              .reduce((acc: any, b: any) => ({
                igst: acc.igst + (b.input_igst || 0), cgst: acc.cgst + (b.input_cgst || 0), sgst: acc.sgst + (b.input_sgst || 0),
              }), zero3)
          : zero3;

        // Total (5) = 5.1 + 5.2 − 5.3 + 5.4 + 5.5 (matches ITC Summary page) — 5.4 uses liveReclaim.
        const r51 = findRow(rowsA, '5.1');
        const r52 = findRow(rowsA, '5.2');
        const r53 = findRow(rowsA, '5.3');
        const r55 = findRow(rowsA, '5.5');
        const total5 = {
          cgst: num(r51.cgst) + num(r52.cgst) - num(r53.cgst) + liveReclaim.cgst + num(r55.cgst),
          sgst: num(r51.sgst) + num(r52.sgst) - num(r53.sgst) + liveReclaim.sgst + num(r55.sgst),
          igst: num(r51.igst) + num(r52.igst) - num(r53.igst) + liveReclaim.igst + num(r55.igst),
        };
        // Total 4A = rows (1)+(2)+(3)+(4) + Total (5) — row (3) uses liveRcmItc.
        const rows1To4 = rowsA.slice(0, 4).reduce(
          (acc, r) => ({
            cgst: acc.cgst + (r?.srNo === '(3)' ? liveRcmItc.cgst : num(r?.cgst)),
            sgst: acc.sgst + (r?.srNo === '(3)' ? liveRcmItc.sgst : num(r?.sgst)),
            igst: acc.igst + (r?.srNo === '(3)' ? liveRcmItc.igst : num(r?.igst)),
          }),
          { cgst: 0, sgst: 0, igst: 0 }
        );
        const total4A = {
          cgst: rows1To4.cgst + total5.cgst,
          sgst: rows1To4.sgst + total5.sgst,
          igst: rows1To4.igst + total5.igst,
        };
        // Partial-ITC (Builder) clients: rows (1), (2), (i), (iii) are
        // display-only auto-computed at ITC Summary render time from client
        // area ratios; the DB persists them as 0. Reading them here (or the
        // sub-rows) gives the wrong 4B. Replicate ITC Summary's exact formula
        // so both pages produce the identical 4C.
        const clientForCalc = clients.find(c => c.id === selectedClientId);
        // A No-ITC builder client reverses 100% of its input tax by definition
        // of the scheme, not by carpet-area apportionment — same 4(B)(1)/(2)
        // formula as Partial-ITC, just with the ratio forced to 1 instead of
        // read off the (likely unset) client area fields.
        const isNoITC = clientForCalc?.builder_itc_type === 'NO_ITC';
        const isPartialITC = clientForCalc?.builder_itc_type === 'PARTIAL_ITC' || isNoITC;

        let total4B: { cgst: number; sgst: number; igst: number };
        if (isPartialITC) {
          const commercialArea = isNoITC ? 0 : (Number(clientForCalc?.commercial_area) || 0);
          const residentialArea = isNoITC ? 1 : (Number(clientForCalc?.residential_area) || 0);
          const totalArea = commercialArea + residentialArea;
          const residentialRatio = totalArea > 0 ? residentialArea / totalArea : 0;

          // ii) Previous Month Adjustment — editable stored value
          const prevMonthAdjRow = rowsB.find((r: any) =>
            typeof r?.particular === 'string' && r.particular.includes('Previous Month Adjustment')
          );
          const ii = {
            cgst: num(prevMonthAdjRow?.cgst),
            sgst: num(prevMonthAdjRow?.sgst),
            igst: num(prevMonthAdjRow?.igst),
          };
          // (2)'s sub-rows: current month per 2B RECO (live) + previous months (stored)
          const prevMonthsReversalRow = rowsB.find((r: any) =>
            typeof r?.particular === 'string' && r.particular.includes('previous months, if any')
          );
          const row2 = {
            cgst: liveReversal.cgst + num(prevMonthsReversalRow?.cgst),
            sgst: liveReversal.sgst + num(prevMonthsReversalRow?.sgst),
            igst: liveReversal.igst + num(prevMonthsReversalRow?.igst),
          };
          // i) = Total 4A × residentialRatio
          const rIn = (x: number) => Math.round(x * 100) / 100;
          const i_row = {
            cgst: rIn(total4A.cgst * residentialRatio),
            sgst: rIn(total4A.sgst * residentialRatio),
            igst: rIn(total4A.igst * residentialRatio),
          };
          // iii) = -(2) × residentialRatio
          const iii_row = {
            cgst: rIn(-row2.cgst * residentialRatio),
            sgst: rIn(-row2.sgst * residentialRatio),
            igst: rIn(-row2.igst * residentialRatio),
          };
          // (1) = i + ii + iii
          const row1 = {
            cgst: rIn(i_row.cgst + ii.cgst + iii_row.cgst),
            sgst: rIn(i_row.sgst + ii.sgst + iii_row.sgst),
            igst: rIn(i_row.igst + ii.igst + iii_row.igst),
          };
          // Total 4B = (1) + (2)
          total4B = {
            cgst: row1.cgst + row2.cgst,
            sgst: row1.sgst + row2.sgst,
            igst: row1.igst + row2.igst,
          };
        } else {
          // Regular clients: sum non-header rows (matches ITC Summary) — the
          // "current month as per 2B RECO" row uses liveReversal.
          total4B = rowsB
            .filter(r => !r?.isHeader)
            .reduce(
              (acc, r) => {
                const isRecoReversalRow = typeof r?.particular === 'string' && r.particular.includes('current month as per 2B RECO');
                const vals = isRecoReversalRow ? liveReversal : { cgst: num(r?.cgst), sgst: num(r?.sgst), igst: num(r?.igst) };
                return { cgst: acc.cgst + vals.cgst, sgst: acc.sgst + vals.sgst, igst: acc.igst + vals.igst };
              },
              { cgst: 0, sgst: 0, igst: 0 }
            );
        }
        // Net ITC Available (4C) = 4A − 4B
        setAvailedCgst(total4A.cgst - total4B.cgst);
        setAvailedSgst(total4A.sgst - total4B.sgst);
        setAvailedIgst(total4A.igst - total4B.igst);
      } else {
        setHasItcSummary(!!itcData?.data);
        setAvailedCgst(0); setAvailedSgst(0); setAvailedIgst(0);
      }

      // 3. GSTR-1 (M-1) → output tax. Only used as a fallback when the CSV
      // hasn't been uploaded; otherwise the M-1 Debit row from the credit
      // ledger CSV is more accurate (it includes cross-head set-off).
      const hasUtilizedFromCsv = utilisedFromLedger(rowData as any);
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
          // ITC utilized fallback = the GSTR-3B output tax, Table 3.1(a) +
          // 3.1(b) (the IGST on exports and SEZ supplies with payment is
          // set off too), computed from M-1's GSTR-1 exactly like the GSTR-3B
          // module. Capped at Available ITC in the closing math below.
          // computeGstr1OutputTax keeps the pre-existing date-only RCM gate
          // (unaffected by the unfiled-period widening in buildGstr3bJson.ts)
          // so historical closing figures don't shift.
          const out = computeGstr1OutputTax(gstr1Data.raw_json, prevMonth || '');
          setUtilizedCgst(out.cgst);
          setUtilizedSgst(out.sgst);
          setUtilizedIgst(out.igst);
        } else {
          setUtilizedCgst(0); setUtilizedSgst(0); setUtilizedIgst(0);
        }
      }
    } catch (error: any) {
      toast.error('Failed to fetch data: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedClientId, selectedMonth, isEligibleMonth, clients]);

  useEffect(() => { fetchClients(); }, [fetchClients]);
  useEffect(() => {
    if (selectedClientId && selectedMonth && isEligibleMonth) fetchData();
  }, [selectedClientId, selectedMonth, isEligibleMonth, fetchData]);

  // What the GSTR-3B push gate says for this client and month (database).
  // Only the latest question's answer is shown (a quick client switch must
  // not show the previous client's verdict).
  const checkGate = useCallback(async () => {
    const seq = ++gateSeq.current;
    if (!selectedClientId || !selectedMonth || !isEligibleMonth) { setGate(null); setGateLoading(false); return; }
    setGateLoading(true);
    const g = await checkGstr3bPushGate(selectedClientId, selectedMonth);
    if (seq !== gateSeq.current) return;
    setGate(g);
    setGateLoading(false);
  }, [selectedClientId, selectedMonth, isEligibleMonth]);
  useEffect(() => { checkGate(); }, [checkGate]);

  // The live allowance for this client and month, and whether it can still
  // be used: once, and never over a pulled opening (a new pull or an
  // override corrects that).
  const allowance = liveAllowance(allowances, SCOPE);
  const isPulled = openingSource === 'portal' && !!openingPulledAt;
  const canEnterManually = !!allowance && !allowance.used_at && !isPulled;
  // Typed books closing not saved yet: Override, Upload and Not Applicable
  // wait for Save (they reload the row), and the gate note says it has not
  // checked these figures (round 2 of the review).
  const booksDirty = isStaff && booksUnsaved({ cgst: booksClosingCgst, sgst: booksClosingSgst, igst: booksClosingIgst }, savedBooks);
  // The allowance this opening was entered under; a revoked one no longer counts.
  const { label: manualLabel, revoked: manualRevoked } = openingManualState(allowances, openingAllowanceId, names);

  // ─────────── Action handlers (Upload / Not Applicable / Override) ─────────

  const handleUploadClick = () => {
    if (!isStaff) return;
    if (booksDirty) { toast.error(UNSAVED_BOOKS_MESSAGE); return; }
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

      // Only with the manual entry the superadmin allowed for this client and
      // month (used once); the database refuses it otherwise.
      if (!user?.id) { toast.error('Sign in again to upload.'); return; }
      await recordManualOpening({
        actorId: user.id,
        kind: 'receivable',
        clientId: selectedClientId,
        periodMonth: selectedMonth,
        source: 'csv',
        opening: { igst: row.balanceIgst, cgst: row.balanceCgst, sgst: row.balanceSgst },
        utilised: utilizedFromCsvRow ? { igst: utilizedFromCsvRow.igst, cgst: utilizedFromCsvRow.cgst, sgst: utilizedFromCsvRow.sgst } : null,
        drc: { igst: drcFromCsv.igst, cgst: drcFromCsv.cgst, sgst: drcFromCsv.sgst },
        csvPeriod: row.periodMonthKey,
      });
      await fetchData();
      checkGate();

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
    if (booksDirty) { toast.error(UNSAVED_BOOKS_MESSAGE); return; }
    setIsSaving(true);
    try {
      if (!user?.id) { toast.error('Sign in again.'); return; }
      await recordManualOpening({
        actorId: user.id,
        kind: 'receivable',
        clientId: selectedClientId,
        periodMonth: selectedMonth,
        source: 'not_applicable',
        opening: { igst: 0, cgst: 0, sgst: 0 },
      });
      await fetchData();
      checkGate();
      toast.success('Marked Not Applicable. Opening balance set to 0.');
    } catch (error: any) {
      toast.error('Failed to save: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOverrideSave = async (values: { cgst: number; sgst: number; igst: number; justification: string }) => {
    if (!canManualOverride() || !selectedClientId || !selectedMonth || !user?.id) return;
    if (booksDirty) { toast.error(UNSAVED_BOOKS_MESSAGE); return; }
    setIsSaving(true);
    try {
      // Through reco_override_opening: the database checks who acts, keeps
      // the reason and logs the person; the source, the pull and the ledger
      // figures stay as they are.
      await recordOverride({
        actorId: user.id,
        kind: 'receivable',
        clientId: selectedClientId,
        periodMonth: selectedMonth,
        opening: { igst: values.igst, cgst: values.cgst, sgst: values.sgst },
        reason: values.justification,
      });
      toast.success('Override saved.');
      await fetchData();
      checkGate();
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
      // Save carries only the typed books closing: the opening, ITC utilised
      // and DRC-03 are the pull's (or the allowed manual entry's) to write.
      const { error } = await supabase
        .from('gst_receivable_reco' as any)
        .upsert(receivableSavePayload({
          clientId: selectedClientId,
          periodMonth: selectedMonth,
          userId: user?.id,
          booksClosing: { cgst: booksClosingCgst, sgst: booksClosingSgst, igst: booksClosingIgst },
        }), { onConflict: 'client_id,period_month' });
      if (error) throw error;
      toast.success('Data saved successfully');
      fetchData();
      checkGate();
    } catch (error: any) {
      toast.error('Failed to save: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Where the opening came from, for the Excel export: pulled, manual
  // (allowed by X: reason), overridden (round 2 of the review).
  const exportOpeningSource = () => {
    const exportNames = new Map(names);
    if (openingPullerName) exportNames.set('puller', openingPullerName);
    if (openingOverrideBy && openingOverriderName) exportNames.set(openingOverrideBy, openingOverriderName);
    return openingSourceText(selectedMonth, {
      opening_source: openingSource, opening_portal_pulled_at: openingPulledAt, opening_portal_pulled_by: 'puller',
      opening_portal_empty: openingPortalEmpty, opening_allowance_id: openingAllowanceId,
      opening_override_justification: openingOverrideJustification, opening_override_by: openingOverrideBy,
    }, allowances.find((a) => a.id === openingAllowanceId) ?? null, exportNames);
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
  // Every head and the total, as the GSTR-3B push gate checks (round 2).
  const diffTallies = headsTally({ cgst: diffCgst, sgst: diffSgst, igst: diffIgst, total: diffTotal });

  const renderBooksCell = (value: number, onChange: (val: number) => void) => {
    if (!isStaff) return <span className="block px-2 py-1.5 text-right tabular-nums">{formatNumber(value)}</span>;
    return (
      <Input
        type="number"
        value={value || ''}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className={cn(WS_CELL_INPUT, 'text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none')}
        aria-label="Closing balance as per books amount"
      />
    );
  };

  // Browser-extension pull: fetch the ledger opening balances from the portal.
  const [extReady, setExtReady] = useState(false);
  const [extVersion, setExtVersion] = useState<string | null>(null);
  const pulledRef = useRef(false);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d: any = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) { setExtReady(true); setExtVersion(typeof d.version === 'string' ? d.version : null); }
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
    const onFocus = () => { if (pulledRef.current) fetchData(); checkGate(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('message', onMsg);
      window.removeEventListener('focus', onFocus);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [fetchData, checkGate]);
  const pullLedgers = () => {
    if (!selectedClientId || !selectedMonth) { toast.error('Select a client and month first'); return; }
    if (!extReady) { toast.error('Install/enable the GST Keeper browser extension to pull from the portal.'); return; }
    // 0.16.0 saves the pull through reco_record_pull, stamped with who asked.
    if (!extensionCanPull(extVersion)) { toast.error(needsExtensionMessage(extVersion)); return; }
    pulledRef.current = true;
    window.postMessage({ __gstkPullLedgers: { clientId: selectedClientId, period_month: selectedMonth, actorId: user?.id ?? null } }, '*');
  };

  // ──────────────────────────── Render ───────────────────────────────────

  // Statement cell classes: figures carried in from elsewhere get a faint tint,
  // typed cells a primary tint, the Total column the muted total look.
  const SUB = 'mt-0.5 text-[11px] font-normal leading-snug text-muted-foreground';
  const NUM = WS_TD_NUM;
  const NUM_TOTAL = cn(WS_TD_NUM, 'border-r-0 bg-muted/40 font-medium');
  const INPUT_TD = cn(WS_TD, 'bg-primary/[0.03] p-0');
  const diffCls = (v: number) => (v !== 0 ? 'text-destructive-strong' : '');

  return (
    <div className={WS_PAGE}>
      <PageHeader
        compact
        embedded
        title="GST Receivable Reco"
        subtitle="Electronic Credit Ledger closing vs books"
        icon={<FileText />}
        actions={
          <>
            {lastSavedBy && (
              <span className="text-xs text-muted-foreground">
                Saved by <span className="font-medium text-foreground">{lastSavedBy.name}</span>
                {lastSavedBy.role && <> ({lastSavedBy.role})</>}
                {lastSavedBy.time && (
                  <> · {new Date(lastSavedBy.time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date(lastSavedBy.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</>
                )}
              </span>
            )}
            {isStaff && (
              <Button
                variant="outline"
                size="sm"
                onClick={pullLedgers}
                disabled={!selectedClientId || !selectedMonth}
                className={cn(WS_BTN, !extReady && 'text-muted-foreground')}
                title={extReady
                  ? 'Pull the opening balance from the portal ledgers (via the browser extension)'
                  : 'GST Keeper extension not detected yet — install/enable it and reload this page'}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Pull
              </Button>
            )}
            {isEligibleMonth && selectedClientData && (
              <Button variant="outline" size="sm" className={WS_BTN} onClick={() => {
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
                  openingSource: exportOpeningSource(),
                });
                toast.success('Excel exported successfully');
              }}>
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Export Excel</span>
              </Button>
            )}
            {isStaff && isEligibleMonth && (
              <Button size="sm" className={cn(WS_BTN, 'px-3')} onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {isSaving ? 'Saving…' : 'Save changes'}
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
                placeholder="Select client…"
                searchPlaceholder="Type to search clients..."
                emptyText="No clients found."
                disabled={!isStaff && clients.length <= 1}
                className={WS_CONTROL}
              />
            </label>
            <label className="w-40 min-w-0 space-y-0.5">
              <span className={WS_FILTER_LABEL}>Return period</span>
              <SearchableMonthSelect
                options={generateMonthOptions}
                value={selectedMonth}
                onValueChange={setSelectedMonth}
                placeholder="Select month"
                className={WS_CONTROL}
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {!selectedClientId || !selectedMonth ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Select a client and month to view the reconciliation.
          </CardContent>
        </Card>
      ) : !isEligibleMonth ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            GST Receivable Reco is available from return period <span className="font-semibold text-foreground">Jun-26</span> onward.
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading reconciliation…
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Headline figures */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
            <KpiTile label="Opening as per portal" value={formatNumber(openingTotal)} hint={isPulled ? (openingPortalEmpty ? 'Pulled, no balance on the portal' : 'Pulled from the portal') : manualLabel ? 'Manual (allowed)' : manualRevoked ? 'Manual entry revoked' : openingSource === 'csv' ? 'CSV, not allowed' : openingSource === 'not_applicable' ? 'Not applicable, not allowed' : 'Not pulled'} />
            <KpiTile label="Add: Net ITC available (4C)" value={formatNumber(availedTotal)} hint={prevMonthLabel ? `From ${prevMonthLabel} ITC Summary` : 'Previous month ITC Summary'} />
            <KpiTile label="Closing as per portal" value={formatNumber(portalClosingTotal)} hint="Opening + 4C − utilized − DRC-03" />
            <KpiTile label="Closing as per books" value={formatNumber(booksClosingTotal)} hint="Typed from the books" />
            <KpiTile
              label="Difference"
              value={formatNumber(diffTotal)}
              hint={diffTallies ? 'Tallies (within ₹10 per head)' : diffTotal === 0 ? 'Heads differ: each must tally' : 'Portal − books'}
              tone={diffTallies ? 'ok' : 'error'}
            />
          </div>

          <SectionCard
            title={selectedClientData?.name ?? 'GST Receivable Reco'}
            description={<>Return period <span className="font-medium text-foreground">{selectedMonth}</span>{selectedClientData?.gstin && <> · {selectedClientData.gstin}</>}</>}
          >
            <div className={WS_TABLE_WRAP}>
              <table className={cn(WS_TABLE, 'min-w-[760px]')} aria-label="GST receivable reconciliation">
                <thead>
                  <tr>
                    <th className={cn(WS_TH, 'min-w-[18rem]')}>Particulars</th>
                    <th className={cn(WS_TH, 'w-32 text-right')}>IGST</th>
                    <th className={cn(WS_TH, 'w-32 text-right')}>CGST</th>
                    <th className={cn(WS_TH, 'w-32 text-right')}>SGST</th>
                    <th className={cn(WS_TH, 'w-32 border-r-0 text-right')}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Opening Balance row — CSV upload / NA / Override */}
                  <tr className={WS_TR}>
                    <td className={cn(WS_TD, 'align-top')}>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">Opening balance as per portal</span>
                          {isPulled
                            ? <Badge variant="success" className="text-[10px] font-medium">{pulledLabel(openingPulledAt, openingPullerName, openingPortalEmpty)}</Badge>
                            : manualLabel && (openingSource === 'csv' || openingSource === 'not_applicable')
                              ? <Badge variant="warning" className="text-[10px] font-medium">{manualLabel[0].toUpperCase() + manualLabel.slice(1)}</Badge>
                              : <Badge variant="destructive" className="text-[10px] font-medium">
                                  {manualRevoked ? 'Manual entry revoked' : openingSource === 'csv' ? 'CSV, not allowed' : openingSource === 'not_applicable' ? 'Not applicable, not allowed' : 'Not pulled'}
                                </Badge>}
                          {openingOverrideJustification && <Badge variant="warning" className="text-[10px] font-medium">Overridden</Badge>}
                          {(openingSource !== 'manual' || recoLog.length > 0) && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button type="button" className="inline-flex items-center text-muted-foreground hover:text-foreground" aria-label="Opening balance source">
                                  <Info className="h-3.5 w-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="text-xs max-w-xs space-y-2" align="start">
                                {isPulled && (
                                  <p><span className="font-semibold">Source:</span> {pulledLabel(openingPulledAt, openingPullerName, openingPortalEmpty)}, {fmtDateTime(openingPulledAt)}.</p>
                                )}
                                {manualLabel && !isPulled && (
                                  <p><span className="font-semibold">Allowed:</span> {manualLabel}.</p>
                                )}
                                {manualRevoked && !isPulled && (
                                  <p><span className="font-semibold">Manual entry revoked.</span> It no longer counts. Pull this from the portal.</p>
                                )}
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
                                {recoLog.length > 0 && (
                                  <div className="border-t pt-2">
                                    <p className="font-semibold">History</p>
                                    <ul className="mt-1 space-y-0.5">
                                      {recoLog.map((l) => (
                                        <li key={l.id}>
                                          {fmtDateTime(l.logged_at)}: {recoLogActionLabel(l.action)}
                                          {l.actor_id && <> by {names.get(l.actor_id) || 'Unknown'}</>}
                                          {l.reason && <> ({l.reason})</>}
                                          {l.ext_version && <> · extension {l.ext_version}</>}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>
                        {isStaff && (
                          <div className="flex flex-wrap items-center gap-1">
                            {/* Upload and Not Applicable only with the manual entry the
                                superadmin allowed for this client and month (used once). */}
                            {canEnterManually && (
                              <>
                                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={handleNotApplicable} disabled={!selectedClientId || isSaving}>
                                  Not Applicable
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={handleUploadClick} disabled={!selectedClientId || isSaving} title="Allowed manual entry: upload the Credit Ledger CSV">
                                  <Upload className="h-3 w-3" />
                                  Upload
                                </Button>
                              </>
                            )}
                            {canManualOverride() && (
                              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => { if (booksDirty) { toast.error(UNSAVED_BOOKS_MESSAGE); return; } setShowOverrideDialog(true); }}
                                disabled={!selectedClientId || isSaving || !(isPulled || manualLabel)}
                                title={isPulled || manualLabel ? 'Override the pulled opening, with a reason' : 'Pull it from the portal first. An override corrects a pulled opening.'}>
                                <Edit3 className="h-3 w-3" />
                                Override
                              </Button>
                            )}
                            {/* Not offered over a pulled month (a manual entry cannot replace it; the pull closes an open one). */}
                            {selectedClientId && !isPulled && (
                              <ManualSourceAllowanceControl
                                clientId={selectedClientId}
                                clientName={selectedClientData?.name}
                                periodMonth={selectedMonth}
                                scope={SCOPE}
                                what="GST Receivable Reco"
                                allowance={allowance}
                                openingAllowanceId={openingAllowanceId}
                                names={names}
                                onChanged={() => { fetchData(); checkGate(); }}
                              />
                            )}
                          </div>
                        )}
                        {!isPulled && !manualLabel && (
                          <p className="text-[11px] font-normal text-muted-foreground">
                            Pull this from the portal. Upload and Not Applicable need the superadmin to allow a manual entry.
                          </p>
                        )}
                      </div>
                    </td>
                    <td className={cn(NUM, 'align-top')}>{formatNumber(openingIgst)}</td>
                    <td className={cn(NUM, 'align-top')}>{formatNumber(openingCgst)}</td>
                    <td className={cn(NUM, 'align-top')}>{formatNumber(openingSgst)}</td>
                    <td className={cn(NUM_TOTAL, 'align-top')}>{formatNumber(openingTotal)}</td>
                  </tr>

                  {/* Net ITC Available — auto from ITC Summary (M-1) 4C = 4A − 4B */}
                  <tr className={WS_TR}>
                    <td className={WS_TD}>
                      <div className="font-medium">Add: Net ITC available (4C)</div>
                      <p className={SUB}>{prevMonthLabel ? `From ${prevMonthLabel} ITC Summary (4A − 4B)` : '4A − 4B from previous month'}</p>
                      {!hasItcSummary && <p className={SUB}>{prevMonthLabel ? `ITC Summary not saved for ${prevMonthLabel} — showing 0` : 'ITC Summary not saved — showing 0'}</p>}
                      {hasItcSummary && !prevReturnFiled && <p className={SUB}>{prevMonthLabel ? `${prevMonthLabel}'s GSTR-3B not yet Filed — showing 0 until it's final` : "GSTR-3B not yet Filed — showing 0 until it's final"}</p>}
                    </td>
                    <td className={NUM}>{formatNumber(availedIgst)}</td>
                    <td className={NUM}>{formatNumber(availedCgst)}</td>
                    <td className={NUM}>{formatNumber(availedSgst)}</td>
                    <td className={NUM_TOTAL}>{formatNumber(availedTotal)}</td>
                  </tr>

                  {/* ITC Utilized — actual per-head debit from credit ledger CSV when available, GSTR-3B output otherwise */}
                  <tr className={WS_TR}>
                    <td className={WS_TD}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">Less: ITC utilized</span>
                        {utilizedFromCsv
                          ? <Badge variant="info" className="text-[10px] font-medium">Credit ledger</Badge>
                          : <Badge variant="warning" className="text-[10px] font-medium">Estimate, not pulled</Badge>}
                      </div>
                      <p className={SUB}>
                        {utilizedFromCsv
                          ? `The set-off debit of ${prevMonthLabel || 'M-1'}'s return in the credit ledger (cross-head as the portal did it); none in the ledger is 0`
                          : prevMonthLabel
                            ? `From ${prevMonthLabel} GSTR-3B output tax (Table 3.1(a) + 3.1(b)), set off cross-head like the portal (estimate)`
                            : 'From previous month GSTR-3B output tax (Table 3.1(a) + 3.1(b)), set off cross-head like the portal (estimate)'}
                      </p>
                      {!utilizedFromCsv && !hasGstr1 && (
                        <p className={SUB}>
                          {prevMonthLabel ? `GSTR-1 not imported for ${prevMonthLabel} — showing 0` : 'GSTR-1 not imported — showing 0'}
                        </p>
                      )}
                    </td>
                    <td className={NUM}>{formatNumber(actualUtilizedIgst)}</td>
                    <td className={NUM}>{formatNumber(actualUtilizedCgst)}</td>
                    <td className={NUM}>{formatNumber(actualUtilizedSgst)}</td>
                    <td className={NUM_TOTAL}>{formatNumber(utilizedDisplayTotal)}</td>
                  </tr>

                  {/* DRC-03 / other ledger debits — auto-detected from the CSV, editable */}
                  <tr className={WS_TR}>
                    <td className={WS_TD}>
                      <div className="font-medium">Less: DRC-03 / other ledger debits</div>
                      <p className={SUB}>
                        Demand / appeal / interest / penalty paid through the credit ledger, read by the pull
                      </p>
                    </td>
                    <td className={NUM}>{formatNumber(drcIgst)}</td>
                    <td className={NUM}>{formatNumber(drcCgst)}</td>
                    <td className={NUM}>{formatNumber(drcSgst)}</td>
                    <td className={NUM_TOTAL}>{formatNumber(drcTotal)}</td>
                  </tr>

                  {/* Closing per portal — computed */}
                  <tr className={WS_TR_TOTAL}>
                    <td className={WS_TD}>
                      <div>Closing balance as per portal</div>
                      <p className={SUB}>Opening + Net ITC Available − ITC Utilized − DRC-03 (clamped at 0)</p>
                    </td>
                    <td className={NUM}>{formatNumber(portalClosingIgst)}</td>
                    <td className={NUM}>{formatNumber(portalClosingCgst)}</td>
                    <td className={NUM}>{formatNumber(portalClosingSgst)}</td>
                    <td className={cn(NUM, 'border-r-0')}>{formatNumber(portalClosingTotal)}</td>
                  </tr>

                  {/* Closing per books — manual */}
                  <tr className={WS_TR}>
                    <td className={cn(WS_TD, 'font-medium')}>Closing balance as per books</td>
                    <td className={INPUT_TD}>{renderBooksCell(booksClosingIgst, setBooksClosingIgst)}</td>
                    <td className={INPUT_TD}>{renderBooksCell(booksClosingCgst, setBooksClosingCgst)}</td>
                    <td className={INPUT_TD}>{renderBooksCell(booksClosingSgst, setBooksClosingSgst)}</td>
                    <td className={NUM_TOTAL}>{formatNumber(booksClosingTotal)}</td>
                  </tr>

                  {/* Difference */}
                  <tr className={cn('font-semibold', !diffTallies ? 'bg-destructive/5' : 'bg-success/10')}>
                    <td className={cn(WS_TD, 'border-b-0')}>
                      <span className="inline-flex items-center gap-2">
                        Difference
                        <Badge variant={diffTallies ? 'success' : 'destructive'} className="text-[10px] font-medium">
                          {diffTallies ? 'Tallies' : 'Differs'}
                        </Badge>
                      </span>
                    </td>
                    <td className={cn(NUM, 'border-b-0', diffCls(diffIgst))}>{formatNumber(diffIgst)}</td>
                    <td className={cn(NUM, 'border-b-0', diffCls(diffCgst))}>{formatNumber(diffCgst)}</td>
                    <td className={cn(NUM, 'border-b-0', diffCls(diffSgst))}>{formatNumber(diffSgst)}</td>
                    <td className={cn(NUM, 'border-b-0 border-r-0', diffCls(diffTotal))}>{formatNumber(diffTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {!utilizedFromCsv && (
              <Note tone="warn">
                Not pulled yet: ITC utilised is an estimate from the GSTR-1. Pull from the portal to read the credit ledger.
              </Note>
            )}
            <Gstr3bGateNote compact gate={gate} loading={gateLoading} onRecheck={checkGate} stale={booksDirty} />
            <Note>
              Differences of ₹10 or less per head are treated as nil. The opening, ITC utilised and DRC-03 come only from
              the portal pull; the superadmin may allow a manual entry when a pull cannot be done.
            </Note>
          </SectionCard>
        </>
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

export default GstReceivableRecoPage;
