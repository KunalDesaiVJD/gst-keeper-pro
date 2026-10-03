import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useBuilderEmbedded, useBuilderProjectId } from '@/contexts/BuilderWorkspaceContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/gstr9/badge';
import { Note } from '@/components/gstr9/ui';
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from '@/components/gstr9/reco/StepTabs';
import {
  WS_BTN, WS_PAGE, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR,
} from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

import { toast } from 'sonner';
import {
  ArrowLeft, Loader2, AlertTriangle, Wrench, Send, ArrowLeftRight, Undo2,
  ReceiptText, Coins,
} from 'lucide-react';
import {
  DEFAULT_CHARGE_INCLUSIONS, classifyUnit, computeTax, formatINR, testRrep,
  type BuilderRateCode, type ChargeInclusionSettings, type UnitType,
} from '@/utils/builderRates';
import {
  BOUNCE_STATUS_LABEL, EXCESS_TREATMENT_LABEL, NOTE_TYPE_LABEL, computeConversion,
  creditNoteWindow, restateInclusiveReceipt,
} from '@/utils/builderAdjustments';
import { prettyPeriodLabel } from '@/utils/builderLedger';
import { periodOfDate } from '@/utils/builderBuEvent';
import { fetchBuilderSettings } from '@/lib/builderSettings';
import {
  addHistoricalReceipt, applyBounceOffsets, autoReclassifyProject, deleteHistoricalReceipt,
  fetchFiledPeriods, fetchHistoricalReceipts, fetchHistoricalReconciliation, findAvailableInPeriod,
  findOffsetCandidates, findReclassCandidates, raiseBounceReversal, raiseCreditNote, restateReceipt,
  reverseReclassification, saveReclassification, scheduleFor,
  type HistoricalReceipt, type HistoricalReconciliation, type ReclassCandidate,
} from '@/lib/builderAdjustmentsData';
import { cancelBooking, recordRefundPayment } from '@/lib/builderCancellationData';
import { drc03WorkpaperPdf } from '@/utils/builderReportsPdf';
import { drc03WorkpaperExcel } from '@/utils/builderReportsExcel';
import type { Drc03Report } from '@/lib/builderReportData';

interface ProjectRow {
  id: string; client_id: string; name: string; is_metro: boolean;
  carpet_area_source: 'DERIVED' | 'MANUAL';
  manual_residential_carpet_sqm: number; manual_commercial_carpet_sqm: number;
  doc_series_prefix: string | null;
}
interface UnitRow {
  id: string; unit_no: string; unit_type: UnitType; carpet_area_sqm: number;
  base_consideration: number; status: string;
}
interface ChargeRow { unit_id: string; charge_head: string; amount: number; include_override: boolean | null }
interface ReclassRow {
  id: string; unit_id: string; posting_period: string; status: string;
  total_value_retaxed: number; total_differential_tax: number; total_interest: number;
  from_rate_pct: number; to_rate_pct: number; triggered_on: string;
  reversed_at: string | null; reversal_reason: string | null;
  discharge_mode: string; drc03_status: string; drc03_arn: string | null; drc03_filed_date: string | null;
}
interface BounceRow {
  id: string; receipt_id: string; unit_id: string; original_period: string;
  rate_code: BuilderRateCode; rate_pct: number; consideration: number;
  adjusted_value: number; status: string; bounced_on: string;
}
interface ExcessRow {
  id: string; receipt_id: string; unit_id: string; excess_tax: number;
  treatment: string; status: string; identified_on: string;
  original_consideration: number; restated_consideration: number;
}
interface CreditNoteRow {
  id: string; unit_id: string; note_date: string; note_type: string;
  consideration: number; cgst: number; sgst: number; within_window: boolean;
  window_expiry: string | null; period_month: string; reason: string | null;
}
interface ConversionRow {
  id: string; from_unit_id: string; to_unit_id: string; conversion_date: string;
  carried_value: number; from_rate_pct: number; to_rate_pct: number;
  differential_tax: number; status: string;
}
interface ReceiptRow {
  id: string; unit_id: string; receipt_date: string; period_month: string;
  amount_entered: number; amount_is_gst_inclusive: boolean; consideration: number;
  rate_code: BuilderRateCode; rate_pct: number; taxable_value: number;
  cgst: number; sgst: number; cheque_status: string; receipt_nature: string;
}
interface BookingRow {
  id: string; unit_id: string; status: string; total_consideration: number;
}
interface CancellationRow {
  id: string; booking_id: string; unit_id: string; cancellation_date: string; reason: string | null;
  rate_code: BuilderRateCode; rate_pct: number; total_received: number;
  forfeiture_amount: number; cancellation_charge_taxable: number;
  correction_method: 'CREDIT_NOTE' | 'SETOFF' | 'NONE';
  refund_payable: number; refund_paid: number; status: 'OPEN' | 'SETTLED';
}
interface RefundPaymentRow {
  id: string; cancellation_id: string; payment_date: string; period_month: string;
  amount: number; instrument_type: string | null;
  offset_amount: number; forfeited_amount: number;
}

const today = () => new Date().toISOString().slice(0, 10);
const currentPeriod = () => {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

interface Props {
  /** Jump straight into one unit's correction dialog, instead of the full register. */
  focusUnitId?: string;
  focusAction?: 'creditNote' | 'reRate' | 'bounceReversal' | 'convert' | 'cancelBooking';
}

const BuilderAdjustmentsPage: React.FC<Props> = ({ focusUnitId, focusAction }) => {
  const projectId = useBuilderProjectId();
  const embedded = useBuilderEmbedded();
  const navigate = useNavigate();
  const { canPostBuilderAdjustments, user } = useAuth();

  // Deep-linked from the Bookings page's open-cancellation badge — falls
  // back to the usual default when nothing points here directly.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') || 'reclass');
  const [bounceFocusUnitId, setBounceFocusUnitId] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [charges, setCharges] = useState<Record<string, ChargeRow[]>>({});
  const [settings, setSettings] = useState<ChargeInclusionSettings>(DEFAULT_CHARGE_INCLUSIONS);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [candidates, setCandidates] = useState<ReclassCandidate[]>([]);
  const [reclasses, setReclasses] = useState<ReclassRow[]>([]);
  const [bounces, setBounces] = useState<BounceRow[]>([]);
  const [excess, setExcess] = useState<ExcessRow[]>([]);
  const [notes, setNotes] = useState<CreditNoteRow[]>([]);
  const [conversions, setConversions] = useState<ConversionRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [cancellations, setCancellations] = useState<CancellationRow[]>([]);
  const [refundPayments, setRefundPayments] = useState<RefundPaymentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [reclassDialog, setReclassDialog] = useState<ReclassCandidate | null>(null);
  const [reclassPeriod, setReclassPeriod] = useState(currentPeriod());
  const [reclassReason, setReclassReason] = useState('');

  const [reverseDialog, setReverseDialog] = useState<ReclassRow | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  const [filedDialog, setFiledDialog] = useState<ReclassRow | null>(null);
  const [filedForm, setFiledForm] = useState({ arn: '', filed_date: today() });

  const [histUnitId, setHistUnitId] = useState('');
  const [histDialog, setHistDialog] = useState(false);
  const [histReceipts, setHistReceipts] = useState<HistoricalReceipt[]>([]);
  const [histRecon, setHistRecon] = useState<HistoricalReconciliation | null>(null);
  const [histForm, setHistForm] = useState({ receipt_date: '', amount: '', notes: '' });
  const [histLoading, setHistLoading] = useState(false);

  const [cnDialog, setCnDialog] = useState(false);
  const [cnForm, setCnForm] = useState({
    unit_id: '', note_date: today(), note_type: 'CANCELLATION' as const,
    consideration: '', original_doc_date: '', reason: '', doc_no: '',
  });

  const [convDialog, setConvDialog] = useState(false);
  const [convForm, setConvForm] = useState({ from_unit_id: '', to_unit_id: '', conversion_date: today() });

  const [restateDialog, setRestateDialog] = useState<ReceiptRow | null>(null);
  const [restateTreatment, setRestateTreatment] = useState<'ADJUST' | 'REFUND' | 'ABSORB'>('ADJUST');

  const [cancelDialog, setCancelDialog] = useState<{ unitId: string; bookingId: string } | null>(null);
  const [cancelForm, setCancelForm] = useState({
    cancellation_date: today(), reason: '', forfeiture_amount: '', cancellation_charge_taxable: '',
    correction_method: 'CREDIT_NOTE' as 'CREDIT_NOTE' | 'SETOFF' | 'NONE', retire_unit: false,
  });

  const [refundDialog, setRefundDialog] = useState<CancellationRow | null>(null);
  const [refundForm, setRefundForm] = useState({
    payment_date: today(), amount: '', instrument_type: 'NEFT/RTGS', instrument_ref: '', notes: '',
  });
  const [refundPreview, setRefundPreview] = useState<{ available: number } | null>(null);

  const canEdit = canPostBuilderAdjustments();
  const isSuperAdmin = user?.role === 'superadmin';
  const isGstManagerOrAbove = user?.role === 'superadmin' || user?.role === 'gst_manager';
  const unitNo = useCallback((id: string) => units.find((u) => u.id === id)?.unit_no || '—', [units]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const { data: proj, error } = await supabase
        .from('builder_projects').select('*').eq('id', projectId).maybeSingle();
      if (error) throw error;
      if (!proj) { toast.error('Project not found'); navigate('/builder-projects'); return; }
      const p = proj as unknown as ProjectRow;
      setProject(p);
      setSettings(await fetchBuilderSettings(p.client_id) as ChargeInclusionSettings);

      const { data: unt } = await supabase
        .from('builder_units').select('*').eq('project_id', projectId).order('unit_no');
      const unitRows = (unt || []) as unknown as UnitRow[];
      setUnits(unitRows);
      const unitIds = unitRows.map((u) => u.id);
      if (!unitIds.length) { setIsLoading(false); return; }

      const [{ data: chg }, { data: rcp }, { data: rcl }, { data: bnc }, { data: exc },
        { data: cns }, { data: cnv }, { data: bkg }, { data: cxl }] = await Promise.all([
        supabase.from('builder_unit_charges').select('*').in('unit_id', unitIds),
        supabase.from('builder_receipts').select('*').in('unit_id', unitIds).order('receipt_date'),
        supabase.from('builder_reclassifications').select('*').in('unit_id', unitIds),
        supabase.from('builder_bounce_reversals').select('*').eq('project_id', projectId),
        supabase.from('builder_excess_tax').select('*').eq('project_id', projectId),
        supabase.from('builder_credit_notes').select('*').in('unit_id', unitIds).order('note_date'),
        supabase.from('builder_conversions').select('*').in('from_unit_id', unitIds),
        supabase.from('builder_bookings').select('id, unit_id, status, total_consideration').in('unit_id', unitIds),
        supabase.from('builder_cancellations').select('*').eq('project_id', projectId).order('cancellation_date'),
      ]);

      const cmap: Record<string, ChargeRow[]> = {};
      ((chg || []) as unknown as ChargeRow[]).forEach((c) => { (cmap[c.unit_id] ||= []).push(c); });
      setCharges(cmap);
      setReceipts((rcp || []) as unknown as ReceiptRow[]);
      setReclasses((rcl || []) as unknown as ReclassRow[]);
      setBounces((bnc || []) as unknown as BounceRow[]);
      setExcess((exc || []) as unknown as ExcessRow[]);
      setNotes((cns || []) as unknown as CreditNoteRow[]);
      setConversions((cnv || []) as unknown as ConversionRow[]);
      setBookings((bkg || []) as unknown as BookingRow[]);
      const cancellationRows = (cxl || []) as unknown as CancellationRow[];
      setCancellations(cancellationRows);
      const cancellationIds = cancellationRows.map((c) => c.id);
      if (cancellationIds.length) {
        const { data: fp } = await supabase
          .from('builder_refund_payments').select('*').in('cancellation_id', cancellationIds).order('payment_date');
        setRefundPayments((fp || []) as unknown as RefundPaymentRow[]);
      } else {
        setRefundPayments([]);
      }
    } catch (e) {
      toast.error(`Could not load: ${(e as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, navigate]);

  useEffect(() => { void load(); }, [load]);

  const rrep = useMemo(() => {
    if (!project) return testRrep(0, 0);
    if (project.carpet_area_source === 'MANUAL') {
      return testRrep(project.manual_residential_carpet_sqm, project.manual_commercial_carpet_sqm);
    }
    let resi = 0, comm = 0;
    units.forEach((u) => {
      if (u.status === 'Cancelled') return;
      if (u.unit_type === 'Residential') resi += Number(u.carpet_area_sqm) || 0;
      else comm += Number(u.carpet_area_sqm) || 0;
    });
    return testRrep(resi, comm);
  }, [project, units]);

  const classification = useMemo(() => {
    const out: Record<string, { rateCode: string; ratePct: number; agreementValue: number }> = {};
    units.forEach((u) => {
      const cls = classifyUnit({
        unitType: u.unit_type,
        carpetAreaSqM: Number(u.carpet_area_sqm) || 0,
        baseConsideration: Number(u.base_consideration) || 0,
        charges: (charges[u.id] || []).map((c) => ({
          charge_head: c.charge_head as never, amount: Number(c.amount) || 0,
          include_override: c.include_override,
        })),
        isMetro: project?.is_metro ?? false,
        isRrep: rrep.isRrep,
        settings,
      });
      out[u.id] = { rateCode: cls.rateCode, ratePct: cls.ratePct, agreementValue: cls.gross.gross };
    });
    return out;
  }, [units, charges, project, rrep.isRrep, settings]);

  // Re-rating candidates are derived from what was actually posted at 1.5% in
  // an ALREADY-FILED period — the only case that needs a formal Table 10
  // amendment, posted immediately with no staff review: per the firm's
  // position (§8), a filed period taxed at 1.5% that's crossed ₹45L was
  // never affordable, so the correction is arithmetic, not a judgment call.
  // An unfiled period is simply corrected in place instead (autoReclassify-
  // Project's `resynced`), no amendment involved. `candidates` stays for the
  // rare case a post fails (e.g. a transient write error) so it isn't lost.
  const [candidatesReady, setCandidatesReady] = useState(false);
  useEffect(() => {
    if (!projectId || !units.length || !project?.client_id) { setCandidates([]); setCandidatesReady(true); return; }
    setCandidatesReady(false);
    (async () => {
      try {
        const { posted, resynced } = await autoReclassifyProject(
          projectId, classification, user?.id ?? null, project.client_id,
        );
        if (posted.length) {
          toast.success(
            `${posted.length} unit${posted.length === 1 ? '' : 's'} re-rated on a filed period crossing ₹45,00,000 `
            + `(${posted.map((c) => c.unitNo).join(', ')}) — Table 10 amendment and interest posted below.`,
          );
          await load();
        }
        if (resynced.length) {
          const names = resynced.map((r) => unitNo(r.unitId));
          toast.info(
            `${resynced.length} unit${resynced.length === 1 ? '' : 's'} resynced to the current rate on unfiled `
            + `periods (${names.join(', ')}) — no amendment needed, nothing filed yet.`,
          );
        }
        setCandidates([]);
      } catch (e) {
        // Fall back to surfacing the raw candidates so the correction isn't
        // lost — findReclassCandidates alone doesn't touch the database.
        const done = new Set(reclasses.map((r) => r.unit_id));
        const filedPeriods = await fetchFiledPeriods(project.client_id);
        const found = await findReclassCandidates(projectId, classification, filedPeriods);
        setCandidates(found.filter((c) => !done.has(c.unitId)));
        toast.error(`Auto re-rating failed, showing candidates for manual review: ${(e as Error).message}`);
      } finally {
        setCandidatesReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, units.length, classification, project?.client_id]);

  /** Route the row-menu click straight to the right tab and dialog. */
  const handledFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusUnitId || !focusAction || isLoading) return;
    if (focusAction === 'reRate' && !candidatesReady) return;
    const key = `${focusUnitId}:${focusAction}`;
    if (handledFocusRef.current === key) return;
    handledFocusRef.current = key;
    if (focusAction === 'creditNote') {
      setTab('notes');
      setCnForm((f) => ({ ...f, unit_id: focusUnitId }));
      setCnDialog(true);
    } else if (focusAction === 'convert') {
      setTab('conversions');
      setConvForm((f) => ({ ...f, from_unit_id: focusUnitId }));
      setConvDialog(true);
    } else if (focusAction === 'bounceReversal') {
      setTab('bounce');
      setBounceFocusUnitId(focusUnitId);
    } else if (focusAction === 'reRate') {
      setTab('reclass');
      const candidate = candidates.find((c) => c.unitId === focusUnitId);
      if (candidate) {
        setReclassDialog(candidate);
        setReclassPeriod(currentPeriod());
      } else {
        toast.info(`${unitNo(focusUnitId)} is not currently due for re-rating.`);
      }
    } else if (focusAction === 'cancelBooking') {
      setTab('cancellations');
      const booking = bookings.find((b) => b.unit_id === focusUnitId && b.status === 'Active');
      if (booking) {
        setCancelForm({
          cancellation_date: today(), reason: '', forfeiture_amount: '', cancellation_charge_taxable: '',
          correction_method: 'CREDIT_NOTE', retire_unit: false,
        });
        setCancelDialog({ unitId: focusUnitId, bookingId: booking.id });
      } else {
        toast.info(`${unitNo(focusUnitId)} has no active booking to cancel.`);
      }
    }
  }, [focusUnitId, focusAction, isLoading, candidatesReady, candidates, unitNo, bookings]);

  const previewSchedule = useMemo(
    () => (reclassDialog ? scheduleFor(reclassDialog, reclassPeriod) : null),
    [reclassDialog, reclassPeriod],
  );

  const handleSaveReclass = async () => {
    if (!reclassDialog || !previewSchedule) return;
    setIsSaving(true);
    try {
      await saveReclassification({
        candidate: reclassDialog,
        schedule: previewSchedule,
        postingPeriod: reclassPeriod,
        reason: reclassReason,
        userId: user?.id ?? null,
      });
      toast.success('Re-rating schedule saved — post it to feed Table 10');
      setReclassDialog(null);
      setReclassReason('');
      await load();
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePostReclass = async (r: ReclassRow) => {
    const isDrc03 = r.discharge_mode !== 'GSTR1_AMENDMENT';
    if (!window.confirm(isDrc03
      ? 'Post this re-rating? The differential tax and interest below become payable by DRC-03 — '
        + 'nothing is amended in GSTR-1 or 3B.'
      : 'Post this re-rating? The earlier B2CS entries are amended in Table 10 — reversed at 1.5% and '
        + 're-reported at the correct rate. Interest u/s 50 is payable in cash separately.',
    )) return;
    const { error } = await supabase.from('builder_reclassifications')
      .update({ status: 'POSTED', posted_at: new Date().toISOString(), posted_by: user?.id ?? null })
      .eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    toast.success(isDrc03 ? 'Re-rating posted — ready for DRC-03' : 'Re-rating posted to Table 10');
    await load();
  };

  /** Superadmin/GST Manager records that the DRC-03 was actually filed on the portal. */
  const handleMarkFiled = async () => {
    if (!filedDialog) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('builder_reclassifications').update({
        drc03_status: 'FILED',
        drc03_arn: filedForm.arn.trim() || null,
        drc03_filed_date: filedForm.filed_date || null,
        drc03_filed_by: user?.id ?? null,
      }).eq('id', filedDialog.id);
      if (error) throw error;
      toast.success('Marked as filed');
      setFiledDialog(null);
      await load();
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  /** Fetches the period-wise breakup for one reclassification and hands it to
   *  the given renderer — the document staff actually take to the DRC-03 form. */
  const exportDrc03 = async (r: ReclassRow, format: 'pdf' | 'xlsx') => {
    try {
      const [{ data: periods }, { data: client }] = await Promise.all([
        supabase.from('builder_reclassification_periods').select('*').eq('reclassification_id', r.id)
          .order('period_month'),
        project ? supabase.from('clients').select('name, gstin').eq('id', project.client_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      type PeriodRow = {
        period_month: string; taxable_value: number; old_cgst: number; old_sgst: number;
        new_cgst: number; new_sgst: number; differential_tax: number; due_date: string | null;
        interest_days: number; interest_amount: number;
      };
      const report: Drc03Report = {
        unitNo: unitNo(r.unit_id),
        fromRatePct: r.from_rate_pct,
        toRatePct: r.to_rate_pct,
        postingPeriod: r.posting_period,
        dischargeMode: r.discharge_mode,
        drc03Status: r.drc03_status,
        drc03Arn: r.drc03_arn,
        drc03FiledDate: r.drc03_filed_date,
        periods: ((periods || []) as unknown as PeriodRow[]).map((p) => ({
          periodMonth: p.period_month, taxableValue: p.taxable_value,
          oldCgst: p.old_cgst, oldSgst: p.old_sgst, newCgst: p.new_cgst, newSgst: p.new_sgst,
          differentialTax: p.differential_tax, dueDate: p.due_date || '',
          interestDays: p.interest_days, interestAmount: p.interest_amount,
        })),
        totals: {
          valueRetaxed: r.total_value_retaxed,
          differentialTax: r.total_differential_tax,
          interest: r.total_interest,
        },
      };
      const ctx = {
        clientName: (client as { name?: string } | null)?.name || '—',
        clientGstin: (client as { gstin?: string } | null)?.gstin || '',
        projectName: project?.name,
      };
      if (format === 'pdf') drc03WorkpaperPdf(ctx, report);
      else drc03WorkpaperExcel(ctx, report);
    } catch (e) {
      toast.error(`Could not export: ${(e as Error).message}`);
    }
  };

  // ── Historical (pre-onboarding) receipts ────────────────────────────────
  const loadHistorical = useCallback(async (unitId: string) => {
    setHistLoading(true);
    try {
      const [rows, recon] = await Promise.all([
        fetchHistoricalReceipts(unitId),
        fetchHistoricalReconciliation(unitId),
      ]);
      setHistReceipts(rows);
      setHistRecon(recon);
    } catch (e) {
      toast.error(`Could not load historical receipts: ${(e as Error).message}`);
    } finally {
      setHistLoading(false);
    }
  }, []);

  const handleOpenHistDialog = (unitId: string) => {
    setHistUnitId(unitId);
    setHistForm({ receipt_date: '', amount: '', notes: '' });
    setHistDialog(true);
    void loadHistorical(unitId);
  };

  const handleAddHistorical = async () => {
    if (!histUnitId || !histForm.receipt_date || !Number(histForm.amount)) {
      toast.error('Date and amount are required'); return;
    }
    if (histForm.receipt_date < '2019-04-01') {
      toast.error('Out of scope — receipts before 01/04/2019 predate the affordable-housing scheme this '
        + 'module models and need a manual firm judgment, not this tool.');
      return;
    }
    setIsSaving(true);
    try {
      await addHistoricalReceipt({
        unitId: histUnitId, receiptDate: histForm.receipt_date,
        amount: Number(histForm.amount), notes: histForm.notes.trim() || null,
        userId: user?.id ?? null,
      });
      setHistForm({ receipt_date: '', amount: '', notes: '' });
      await loadHistorical(histUnitId);
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteHistorical = async (id: string) => {
    try {
      await deleteHistoricalReceipt(id);
      await loadHistorical(histUnitId);
    } catch (e) {
      toast.error(`Could not delete: ${(e as Error).message}`);
    }
  };

  /** Re-run the same detection the page loads with — lets staff trigger it
   *  again right after entering historical receipts, without waiting for a
   *  dependency (classification) that entering them doesn't itself change. */
  const runReclassSweep = useCallback(async () => {
    if (!projectId || !project?.client_id) return;
    try {
      const { posted, resynced } = await autoReclassifyProject(
        projectId, classification, user?.id ?? null, project.client_id,
      );
      if (posted.length) {
        toast.success(
          `${posted.length} unit${posted.length === 1 ? '' : 's'} re-rated `
          + `(${posted.map((c) => c.unitNo).join(', ')}) — DRC-03 workpaper below.`,
        );
      }
      if (resynced.length) {
        toast.info(`${resynced.length} unit(s) resynced on unfiled periods — no amendment needed.`);
      }
      await load();
    } catch (e) {
      toast.error(`Re-check failed: ${(e as Error).message}`);
    }
  }, [projectId, project?.client_id, classification, user?.id, load]);

  /**
   * Void a POSTED reclassification — e.g. it was triggered by a charge that
   * turned out to be a mistake and was removed shortly after. Superadmin-only:
   * this reverses real posted tax and interest, not a routine edit.
   */
  const handleReverseReclass = async () => {
    if (!reverseDialog) return;
    if (!reverseReason.trim()) { toast.error('A reason is required'); return; }
    setIsSaving(true);
    try {
      await reverseReclassification({
        reclassificationId: reverseDialog.id, reason: reverseReason.trim(), userId: user?.id ?? null,
      });
      toast.success(
        `Reversed — the Table 10 correction and its interest no longer appear in the return. ${unitNo(reverseDialog.unit_id)}'s `
        + 'live classification governs again. If any receipt/invoice in the affected period had its own rate rewritten '
        + 'while this was locked, check and re-save it by hand — reversing does not rewrite those automatically.',
      );
      setReverseDialog(null);
      setReverseReason('');
      await load();
    } catch (e) {
      toast.error(`Could not reverse: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Bounce ───────────────────────────────────────────────────────────────
  const bouncedNeedingReversal = useMemo(() => {
    const have = new Set(bounces.map((b) => b.receipt_id));
    return receipts.filter(
      (r) => r.cheque_status === 'Bounced' && r.receipt_nature === 'ADVANCE' && !have.has(r.id),
    );
  }, [receipts, bounces]);

  const handleRaiseBounce = async (r: ReceiptRow) => {
    setIsSaving(true);
    try {
      await raiseBounceReversal({
        receipt: r, projectId: projectId!, bouncedOn: today(), userId: user?.id ?? null,
      });
      toast.success('Reversal raised — offset it against later months at the same rate');
      await load();
    } catch (e) {
      toast.error(`Could not raise: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOffset = async (b: BounceRow) => {
    setIsSaving(true);
    try {
      const remaining = Number(b.consideration) - Number(b.adjusted_value);
      const cands = await findOffsetCandidates({
        projectId: projectId!, rateCode: b.rate_code, afterPeriod: b.original_period,
      });
      const res = await applyBounceOffsets({
        reversalId: b.id,
        remaining,
        rateCode: b.rate_code,
        candidates: cands,
        alreadyAdjusted: Number(b.adjusted_value),
        totalConsideration: Number(b.consideration),
        userId: user?.id ?? null,
      });
      if (res.applied <= 0) {
        toast.warning('No later month has advances at this rate in this project — carried forward.');
      } else {
        toast.success(
          `Offset ${formatINR(res.applied)}`
          + (res.carriedForward > 0 ? `; ${formatINR(res.carriedForward)} carried forward` : ' in full'),
        );
      }
      await load();
    } catch (e) {
      toast.error(`Could not offset: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Credit note ──────────────────────────────────────────────────────────
  const cnWindow = useMemo(
    () => (cnForm.original_doc_date ? creditNoteWindow(cnForm.original_doc_date, cnForm.note_date) : null),
    [cnForm.original_doc_date, cnForm.note_date],
  );

  const handleSaveCreditNote = async () => {
    if (!cnForm.unit_id) { toast.error('Select a unit'); return; }
    if (!(parseFloat(cnForm.consideration) > 0)) { toast.error('Value is required'); return; }
    if (!cnForm.original_doc_date) { toast.error('Original document date is required'); return; }
    setIsSaving(true);
    try {
      const { data: bk } = await supabase.from('builder_bookings')
        .select('id').eq('unit_id', cnForm.unit_id).eq('status', 'Active').maybeSingle();
      const res = await raiseCreditNote({
        unitId: cnForm.unit_id,
        bookingId: bk?.id ?? null,
        noteDate: cnForm.note_date,
        noteType: cnForm.note_type,
        consideration: parseFloat(cnForm.consideration),
        rateCode: classification[cnForm.unit_id].rateCode as BuilderRateCode,
        originalDocDate: cnForm.original_doc_date,
        periodMonth: periodOfDate(cnForm.note_date),
        docSeries: project?.doc_series_prefix ?? null,
        docNo: cnForm.doc_no.trim() || null,
        reason: cnForm.reason.trim() || null,
        userId: user?.id ?? null,
      });
      if (res.withinWindow) toast.success('Credit note raised');
      else toast.warning(
        `Recorded, but the s.34 window closed on ${res.expiryLabel} — the tax cannot be adjusted. `
        + 'The buyer can claim it as a refund u/s 54 (Circular 188/20/2022).',
      );
      setCnDialog(false);
      await load();
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Conversion ───────────────────────────────────────────────────────────
  const convPreview = useMemo(() => {
    if (!convForm.from_unit_id || !convForm.to_unit_id) return null;
    const from = classification[convForm.from_unit_id];
    const to = classification[convForm.to_unit_id];
    if (!from || !to) return null;
    return computeConversion({
      carriedValue: 0, // filled at save from the ledger
      fromRateCode: from.rateCode as BuilderRateCode,
      toRateCode: to.rateCode as BuilderRateCode,
    });
  }, [convForm.from_unit_id, convForm.to_unit_id, classification]);

  const handleSaveConversion = async () => {
    if (!convForm.from_unit_id || !convForm.to_unit_id) { toast.error('Select both units'); return; }
    if (convForm.from_unit_id === convForm.to_unit_id) { toast.error('Units must differ'); return; }
    setIsSaving(true);
    try {
      const { data: led } = await supabase.from('builder_unit_ledger')
        .select('value_taxed').eq('unit_id', convForm.from_unit_id).maybeSingle();
      const carried = Number((led as { value_taxed: number } | null)?.value_taxed) || 0;
      const from = classification[convForm.from_unit_id];
      const to = classification[convForm.to_unit_id];
      const calc = computeConversion({
        carriedValue: carried,
        fromRateCode: from.rateCode as BuilderRateCode,
        toRateCode: to.rateCode as BuilderRateCode,
      });
      const { error } = await supabase.from('builder_conversions').insert({
        from_unit_id: convForm.from_unit_id,
        to_unit_id: convForm.to_unit_id,
        conversion_date: convForm.conversion_date,
        period_month: periodOfDate(convForm.conversion_date),
        carried_value: carried,
        from_rate_code: from.rateCode,
        from_rate_pct: from.ratePct,
        to_rate_code: to.rateCode,
        to_rate_pct: to.ratePct,
        differential_tax: calc.differentialTax,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      toast.success(
        calc.isRateNeutral
          ? 'Conversion recorded — same rate, so documentation only'
          : `Conversion recorded — differential ${formatINR(calc.differentialTax)}`,
      );
      setConvDialog(false);
      await load();
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Restate ──────────────────────────────────────────────────────────────
  const restatePreview = useMemo(() => {
    if (!restateDialog) return null;
    return restateInclusiveReceipt({
      amountReceived: Number(restateDialog.amount_entered) || 0,
      originalConsideration: Number(restateDialog.consideration) || 0,
      originalTax: (Number(restateDialog.cgst) || 0) + (Number(restateDialog.sgst) || 0),
      rateCode: restateDialog.rate_code,
    });
  }, [restateDialog]);

  const handleRestate = async () => {
    if (!restateDialog || !restatePreview) return;
    setIsSaving(true);
    try {
      await restateReceipt({
        receipt: restateDialog,
        projectId: projectId!,
        restated: restatePreview,
        treatment: restateTreatment,
        userId: user?.id ?? null,
      });
      toast.success(
        `Restated — excess tax ${formatINR(restatePreview.excessTax)} booked; `
        + `the unit's BU differential rises by ${formatINR(restatePreview.considerationReduction)}`,
      );
      setRestateDialog(null);
      await load();
    } catch (e) {
      toast.error(`Could not restate: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Cancel booking ───────────────────────────────────────────────────────
  const cancelPreview = useMemo(() => {
    if (!cancelDialog) return null;
    const bookingReceipts = receipts.filter(
      (r) => (bookings.find((b) => b.id === cancelDialog.bookingId)?.unit_id === r.unit_id)
        && r.receipt_nature === 'ADVANCE' && r.cheque_status !== 'Bounced',
    );
    const totalReceived = bookingReceipts.reduce((s, r) => s + (Number(r.consideration) || 0), 0);
    const forfeiture = parseFloat(cancelForm.forfeiture_amount) || 0;
    const chargeTaxable = parseFloat(cancelForm.cancellation_charge_taxable) || 0;
    const rateCode = (bookingReceipts[0]?.rate_code
      || classification[cancelDialog.unitId]?.rateCode) as BuilderRateCode | undefined;
    const chargeGst = chargeTaxable > 0 && rateCode ? computeTax(chargeTaxable, rateCode).totalTax : 0;
    const refundPayable = Math.max(0, totalReceived - forfeiture - chargeTaxable - chargeGst);
    const earliestReceiptDate = bookingReceipts.reduce(
      (min, r) => (!min || r.receipt_date < min ? r.receipt_date : min), '' as string,
    ) || cancelForm.cancellation_date;
    const window = creditNoteWindow(earliestReceiptDate, cancelForm.cancellation_date);
    return { totalReceived, refundPayable, window };
  }, [cancelDialog, receipts, bookings, cancelForm.forfeiture_amount, cancelForm.cancellation_charge_taxable,
    cancelForm.cancellation_date, classification]);

  const handleSaveCancellation = async () => {
    if (!cancelDialog || !project) return;
    setIsSaving(true);
    try {
      const res = await cancelBooking({
        bookingId: cancelDialog.bookingId,
        unitId: cancelDialog.unitId,
        projectId: projectId!,
        cancellationDate: cancelForm.cancellation_date,
        reason: cancelForm.reason,
        forfeitureAmount: parseFloat(cancelForm.forfeiture_amount) || 0,
        cancellationChargeTaxable: parseFloat(cancelForm.cancellation_charge_taxable) || 0,
        correctionMethod: cancelForm.correction_method,
        retireUnit: cancelForm.retire_unit,
        periodMonth: currentPeriod(),
        docSeriesPrefix: project.doc_series_prefix,
        userId: user?.id ?? null,
      });
      toast.success(
        cancelForm.correction_method === 'CREDIT_NOTE'
          ? `Booking cancelled — credit note raised for ${formatINR(res.totalReceived)}. `
            + `${formatINR(res.refundPayable)} still owed back to the member.`
          : cancelForm.correction_method === 'SETOFF'
            ? `Booking cancelled — no credit note. ${formatINR(res.refundPayable)} owed back; `
              + 'record refund payments below as they happen, each nets against its own month.'
            : `Booking cancelled — no correction attempted. ${formatINR(res.refundPayable)} owed back; `
              + 'record refund payments below as a plain cash record.',
      );
      setCancelDialog(null);
      setTab('cancellations');
      await load();
    } catch (e) {
      toast.error(`Could not cancel: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Refund payments ──────────────────────────────────────────────────────
  // Live preview of what a SETOFF payment would actually net, before saving —
  // the same pool findAvailableInPeriod computes at save time.
  useEffect(() => {
    if (!refundDialog || refundDialog.correction_method !== 'SETOFF' || !refundForm.payment_date || !projectId) {
      setRefundPreview(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const available = await findAvailableInPeriod({
        projectId,
        rateCode: refundDialog.rate_code,
        periodMonth: periodOfDate(refundForm.payment_date),
      });
      if (!cancelled) setRefundPreview({ available });
    })();
    return () => { cancelled = true; };
  }, [refundDialog, refundForm.payment_date, projectId]);

  const handleSaveRefundPayment = async () => {
    if (!refundDialog || !project) return;
    if (!(parseFloat(refundForm.amount) > 0)) { toast.error('Amount is required'); return; }
    setIsSaving(true);
    try {
      const res = await recordRefundPayment({
        cancellationId: refundDialog.id,
        paymentDate: refundForm.payment_date,
        amount: parseFloat(refundForm.amount),
        instrumentType: refundForm.instrument_type,
        instrumentRef: refundForm.instrument_ref,
        notes: refundForm.notes,
        userId: user?.id ?? null,
        clientId: project.client_id,
        projectId: projectId!,
        rateCode: refundDialog.rate_code,
        correctionMethod: refundDialog.correction_method,
        unitNo: unitNo(refundDialog.unit_id),
        projectName: project.name,
        cancellationDate: refundDialog.cancellation_date,
        cancellationReason: refundDialog.reason,
      });
      if (refundDialog.correction_method === 'SETOFF') {
        toast.success(
          `${formatINR(res.offsetAmount)} set off against this month's collections`
          + (res.forfeitedAmount > 0.005 ? `; ${formatINR(res.forfeitedAmount)} forfeited permanently (no carry-forward)` : '')
          + (res.emailQueued ? '. Confirmation email queued to the client.' : '. Client email could not be queued — check email settings.'),
        );
      } else {
        toast.success('Refund payment recorded.');
      }
      setRefundDialog(null);
      setRefundForm({ payment_date: today(), amount: '', instrument_type: 'NEFT/RTGS', instrument_ref: '', notes: '' });
      await load();
    } catch (e) {
      toast.error(`Could not record: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const bouncedNeedingReversalFiltered = useMemo(
    () => (bounceFocusUnitId
      ? bouncedNeedingReversal.filter((r) => r.unit_id === bounceFocusUnitId)
      : bouncedNeedingReversal),
    [bouncedNeedingReversal, bounceFocusUnitId],
  );
  const bouncesFiltered = useMemo(
    () => (bounceFocusUnitId ? bounces.filter((b) => b.unit_id === bounceFocusUnitId) : bounces),
    [bounces, bounceFocusUnitId],
  );

  const restatable = useMemo(() => {
    const done = new Set(excess.map((e) => e.receipt_id));
    return receipts.filter((r) => !r.amount_is_gst_inclusive && !done.has(r.id));
  }, [receipts, excess]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading adjustments…
        </CardContent>
      </Card>
    );
  }
  if (!project) return null;

  return (
    <div className={WS_PAGE}>
      <PageHeader
        compact
        embedded
        title={`${project.name} — Adjustments`}
        subtitle="Re-rating, conversions, credit notes, bounce reversals and excess tax"
        icon={<Wrench />}
        actions={embedded ? undefined : (
          <Button variant="outline" size="sm" className={WS_BTN} onClick={() => navigate(`/builder-projects/${projectId}`)}>
            <ArrowLeft className="h-3.5 w-3.5" /> Project
          </Button>
        )}
      />

      <Note tone="position">
        The rule that decides every case here: a change in the flow of <strong>money</strong> is not a
        change in the <strong>supply</strong>. GST adjusts only when the consideration or the supply
        itself changes — not when a cheque bounces, and not when a member refinances.
      </Note>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={TAB_LIST_CLASS}>
          <TabsTrigger value="reclass" className={TAB_TRIGGER_CLASS}>
            Re-rating {candidates.length > 0 && <Badge variant="warning" className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none">{candidates.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="conversions" className={TAB_TRIGGER_CLASS}>Conversions ({conversions.length})</TabsTrigger>
          <TabsTrigger value="notes" className={TAB_TRIGGER_CLASS}>Credit notes ({notes.length})</TabsTrigger>
          <TabsTrigger value="bounce" className={TAB_TRIGGER_CLASS}>
            Bounce register {bouncedNeedingReversal.length > 0 && <Badge variant="destructive" className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none">{bouncedNeedingReversal.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="excess" className={TAB_TRIGGER_CLASS}>Excess tax ({excess.length})</TabsTrigger>
          <TabsTrigger value="cancellations" className={TAB_TRIGGER_CLASS}>Cancellations ({cancellations.length})</TabsTrigger>
        </TabsList>

        {/* ── Re-rating ─────────────────────────────────────────────────── */}
        <TabsContent value="reclass" className="mt-3 space-y-3">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-x-3 gap-y-1.5 space-y-0 px-4 pb-2 pt-3">
              <div>
                <CardTitle className="text-[15px] leading-snug">Historical (pre-onboarding) receipts</CardTitle>
                <CardDescription className="text-xs leading-snug">
                  A unit's history before this firm's onboarding sits only in a single opening-balance
                  snapshot — invisible to the detection below. Enter its real date-wise receipts here only
                  when a re-rating case actually needs them; the amounts must tally with the unit's opening
                  balance for the interest computed to be reliable. Only receipts on/after 01/04/2019 are
                  accepted — earlier is outside the affordable-housing scheme this module models.
                </CardDescription>
              </div>
              {canEdit && (
                <Select value={histUnitId} onValueChange={handleOpenHistDialog}>
                  <SelectTrigger className="h-8 w-56 text-xs" aria-label="Historical receipts for unit"><SelectValue placeholder="Select a unit…" /></SelectTrigger>
                  <SelectContent>
                    {units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.unit_no}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-x-3 gap-y-1.5 space-y-0 px-4 pb-2 pt-3">
              <div>
                <CardTitle className="text-[15px] leading-snug">Units needing re-rating</CardTitle>
                <CardDescription className="text-xs leading-snug">
                  A unit taxed at 1.5% whose gross consideration has since crossed ₹45 lakh was never
                  affordable. The concession never applied, so the higher rate is due on everything already
                  offered to tax — with interest u/s 50 running from each original period's due date, paid
                  by DRC-03. This is posted automatically the moment it's detected (no staff selection); the
                  table below only shows a candidate here if that automatic post failed and needs a manual
                  retry.
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" className={WS_BTN} onClick={() => void runReclassSweep()}>
                Re-check for re-rating
              </Button>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {candidates.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  No units are waiting on re-rating — anything detected posts automatically.
                </p>
              ) : (
                <div className={WS_TABLE_WRAP}>
                  <table className={WS_TABLE}>
                    <thead>
                      <tr>
                        <th className={WS_TH}>Unit</th>
                        <th className={cn(WS_TH, 'text-right')}>Gross now</th>
                        <th className={cn(WS_TH, 'text-right')}>Correct rate</th>
                        <th className={cn(WS_TH, 'text-right')}>Periods affected</th>
                        <th className={cn(WS_TH, 'text-right')}>Value at 1.5%</th>
                        <th className={cn(WS_TH, 'w-24')} />
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c) => (
                        <tr className={WS_TR} key={c.unitId}>
                          <td className={cn(WS_TD, 'font-medium')}>{c.unitNo}</td>
                          <td className={WS_TD_NUM}>{formatINR(c.grossConsideration)}</td>
                          <td className={WS_TD_NUM}>{c.currentRatePct}%</td>
                          <td className={WS_TD_NUM}>{c.periods.length}</td>
                          <td className={WS_TD_NUM}>{formatINR(c.totalTaxableAtOldRate)}</td>
                          <td className={WS_TD}>
                            {canEdit && (
                              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { setReclassDialog(c); setReclassPeriod(currentPeriod()); }}>
                                Schedule
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {reclasses.length > 0 && (
            <Card>
              <CardHeader className="space-y-0.5 px-4 pb-2 pt-3">
                <CardTitle className="text-[15px] leading-snug">DRC-03 workpaper</CardTitle>
                <CardDescription className="text-xs leading-snug">
                  Differential tax and s.50 interest for each re-rating, discharged by voluntary DRC-03 on
                  the GST portal — not reported in GSTR-1 or 3B. Total tax + interest below is the figure
                  to key into the DRC-03 form; mark it filed once done, for the record.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className={WS_TABLE_WRAP}>
                  <table className={WS_TABLE}>
                    <thead>
                      <tr>
                        <th className={WS_TH}>Unit</th>
                        <th className={WS_TH}>Posting period</th>
                        <th className={cn(WS_TH, 'text-right')}>Value re-taxed</th>
                        <th className={cn(WS_TH, 'text-right')}>Differential tax</th>
                        <th className={cn(WS_TH, 'text-right')}>Interest u/s 50</th>
                        <th className={WS_TH}>Status</th>
                        <th className={WS_TH}>DRC-03</th>
                        <th className={cn(WS_TH, 'w-20')} />
                      </tr>
                    </thead>
                    <tbody>
                      {reclasses.map((r) => (
                        <tr className={WS_TR} key={r.id}>
                          <td className={cn(WS_TD, 'font-medium')}>{unitNo(r.unit_id)}</td>
                          <td className={WS_TD}>{prettyPeriodLabel(r.posting_period)}</td>
                          <td className={WS_TD_NUM}>{formatINR(r.total_value_retaxed)}</td>
                          <td className={cn(WS_TD_NUM, 'font-medium')}>{formatINR(r.total_differential_tax)}</td>
                          <td className={WS_TD_NUM}>{formatINR(r.total_interest)}</td>
                          <td className={WS_TD}>
                            <Badge
                              variant={r.status === 'POSTED' ? 'success' : r.status === 'REVERSED' ? 'secondary' : 'warning'}
                              className="text-[10px] font-medium"
                            >
                              {r.status}
                            </Badge>
                            {r.status === 'REVERSED' && r.reversal_reason && (
                              <span className="block text-xs text-muted-foreground mt-0.5" title={r.reversal_reason}>
                                {r.reversal_reason}
                              </span>
                            )}
                          </td>
                          <td className={WS_TD}>
                            {r.discharge_mode === 'GSTR1_AMENDMENT' ? (
                              <Badge variant="outline" className="text-[10px] font-medium">Table 10</Badge>
                            ) : (
                              <>
                                <Badge variant={r.drc03_status === 'FILED' ? 'success' : 'warning'} className="text-[10px] font-medium">
                                  {r.drc03_status === 'FILED' ? 'Filed' : 'Pending'}
                                </Badge>
                                {r.drc03_status === 'FILED' && r.drc03_arn && (
                                  <span className="block text-xs text-muted-foreground mt-0.5">{r.drc03_arn}</span>
                                )}
                              </>
                            )}
                          </td>
                          <td className={WS_TD}>
                            {canEdit && r.status === 'DRAFT' && (
                              <Button size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => handlePostReclass(r)}>
                                <Send className="h-3 w-3" /> Post
                              </Button>
                            )}
                            {r.status === 'POSTED' && (
                              <>
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void exportDrc03(r, 'pdf')}>PDF</Button>
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void exportDrc03(r, 'xlsx')}>Excel</Button>
                              </>
                            )}
                            {isGstManagerOrAbove && r.status === 'POSTED' && r.discharge_mode !== 'GSTR1_AMENDMENT'
                              && r.drc03_status !== 'FILED' && (
                              <Button
                                size="sm" variant="outline" className="h-7 px-2 text-xs"
                                onClick={() => { setFiledDialog(r); setFiledForm({ arn: '', filed_date: today() }); }}
                              >
                                Mark filed
                              </Button>
                            )}
                            {isSuperAdmin && r.status === 'POSTED' && (
                              <Button
                                size="sm" variant="outline"
                                className="ml-1 h-7 gap-1 border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => { setReverseDialog(r); setReverseReason(''); }}
                              >
                                <Undo2 className="h-3 w-3" /> Reverse
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Conversions ───────────────────────────────────────────────── */}
        <TabsContent value="conversions" className="mt-3">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-x-3 gap-y-1.5 space-y-0 px-4 pb-2 pt-3">
              <div>
                <CardTitle className="text-[15px] leading-snug">Unit conversions</CardTitle>
                <CardDescription className="text-xs leading-snug">
                  A member moving between units is a cancellation plus a fresh booking, not a ledger entry.
                  Where the rates differ the carried value is re-taxed; where the old unit's credit-note
                  window has closed, its tax cannot be recovered but the new tax is still due.
                </CardDescription>
              </div>
              {canEdit && (
                <Button size="sm" className={WS_BTN} onClick={() => setConvDialog(true)}>
                  <ArrowLeftRight className="h-3.5 w-3.5" /> Record conversion
                </Button>
              )}
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {conversions.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No conversions recorded.</p>
              ) : (
                <div className={WS_TABLE_WRAP}>
                  <table className={WS_TABLE}>
                    <thead>
                      <tr>
                        <th className={WS_TH}>Date</th>
                        <th className={WS_TH}>From</th>
                        <th className={WS_TH}>To</th>
                        <th className={cn(WS_TH, 'text-right')}>Carried value</th>
                        <th className={cn(WS_TH, 'text-right')}>Rate change</th>
                        <th className={cn(WS_TH, 'text-right')}>Differential</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conversions.map((c) => (
                        <tr className={WS_TR} key={c.id}>
                          <td className={WS_TD}>{c.conversion_date}</td>
                          <td className={cn(WS_TD, 'font-medium')}>{unitNo(c.from_unit_id)}</td>
                          <td className={cn(WS_TD, 'font-medium')}>{unitNo(c.to_unit_id)}</td>
                          <td className={WS_TD_NUM}>{formatINR(c.carried_value)}</td>
                          <td className={WS_TD_NUM}>
                            {c.from_rate_pct}% → {c.to_rate_pct}%
                          </td>
                          <td className={cn(WS_TD_NUM, 'font-medium')}>
                            {formatINR(c.differential_tax)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Credit notes ──────────────────────────────────────────────── */}
        <TabsContent value="notes" className="mt-3">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-x-3 gap-y-1.5 space-y-0 px-4 pb-2 pt-3">
              <div>
                <CardTitle className="text-[15px] leading-snug">Credit notes</CardTitle>
                <CardDescription className="text-xs leading-snug">
                  s.34 allows the tax adjustment only until 30 November following the financial year of the
                  original document. Intra-state B2C notes net inside Table 7 — CDNUR cannot arise here.
                </CardDescription>
              </div>
              {canEdit && (
                <Button size="sm" className={WS_BTN} onClick={() => setCnDialog(true)}>
                  <ReceiptText className="h-3.5 w-3.5" /> Raise credit note
                </Button>
              )}
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {notes.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No credit notes raised.</p>
              ) : (
                <div className={WS_TABLE_WRAP}>
                  <table className={WS_TABLE}>
                    <thead>
                      <tr>
                        <th className={WS_TH}>Date</th>
                        <th className={WS_TH}>Unit</th>
                        <th className={WS_TH}>Type</th>
                        <th className={cn(WS_TH, 'text-right')}>Value</th>
                        <th className={cn(WS_TH, 'text-right')}>Tax</th>
                        <th className={WS_TH}>Window</th>
                      </tr>
                    </thead>
                    <tbody>
                      {notes.map((n) => (
                        <tr className={WS_TR} key={n.id}>
                          <td className={WS_TD}>{n.note_date}</td>
                          <td className={cn(WS_TD, 'font-medium')}>{unitNo(n.unit_id)}</td>
                          <td className={WS_TD}>{NOTE_TYPE_LABEL[n.note_type] || n.note_type}</td>
                          <td className={WS_TD_NUM}>{formatINR(n.consideration)}</td>
                          <td className={WS_TD_NUM}>{formatINR(n.cgst + n.sgst)}</td>
                          <td className={WS_TD}>
                            {n.within_window ? (
                              <Badge variant="success" className="text-[10px] font-medium">
                                Adjusted
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="text-[10px] font-medium">
                                Out of window — buyer refunds u/s 54
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Bounce register ───────────────────────────────────────────── */}
        <TabsContent value="bounce" className="mt-3 space-y-3">
          {bounceFocusUnitId && (
            <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs">
              <span>Showing only unit {unitNo(bounceFocusUnitId)}.</span>
              <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={() => setBounceFocusUnitId(null)}>
                Show all units
              </Button>
            </div>
          )}
          {bouncedNeedingReversalFiltered.length > 0 && (
            <Card>
              <CardHeader className="space-y-0.5 px-4 pb-2 pt-3">
                <CardTitle className="text-[15px] leading-snug">Bounced advances without a reversal</CardTitle>
                <CardDescription className="text-xs leading-snug">
                  Raise a reversal only where the return for the original period is already filed. If it is
                  still open, simply deleting the receipt is cleaner.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className={WS_TABLE_WRAP}>
                  <table className={WS_TABLE}>
                    <thead>
                      <tr>
                        <th className={WS_TH}>Unit</th>
                        <th className={WS_TH}>Receipt date</th>
                        <th className={WS_TH}>Original period</th>
                        <th className={cn(WS_TH, 'text-right')}>Consideration</th>
                        <th className={cn(WS_TH, 'text-right')}>Tax</th>
                        <th className={cn(WS_TH, 'w-24')} />
                      </tr>
                    </thead>
                    <tbody>
                      {bouncedNeedingReversalFiltered.map((r) => (
                        <tr className={WS_TR} key={r.id}>
                          <td className={cn(WS_TD, 'font-medium')}>{unitNo(r.unit_id)}</td>
                          <td className={WS_TD}>{r.receipt_date}</td>
                          <td className={WS_TD}>{prettyPeriodLabel(r.period_month)}</td>
                          <td className={WS_TD_NUM}>{formatINR(r.consideration)}</td>
                          <td className={WS_TD_NUM}>{formatINR(r.cgst + r.sgst)}</td>
                          <td className={WS_TD}>
                            {canEdit && (
                              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => handleRaiseBounce(r)}>
                                <Undo2 className="h-3 w-3" /> Reverse
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="space-y-0.5 px-4 pb-2 pt-3">
              <CardTitle className="text-[15px] leading-snug">Reversal register</CardTitle>
              <CardDescription className="text-xs leading-snug">
                Offsets go against later months at the <strong>same rate</strong> in the <strong>same
                project</strong>. The portal rejects a negative Table 11A, so anything that will not fit
                carries forward rather than being lost.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {bouncesFiltered.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  {bounceFocusUnitId ? 'No reversals raised for this unit.' : 'No reversals raised.'}
                </p>
              ) : (
                <div className={WS_TABLE_WRAP}>
                  <table className={WS_TABLE}>
                    <thead>
                      <tr>
                        <th className={WS_TH}>Unit</th>
                        <th className={WS_TH}>Bounced</th>
                        <th className={WS_TH}>Original period</th>
                        <th className={cn(WS_TH, 'text-right')}>Rate</th>
                        <th className={cn(WS_TH, 'text-right')}>To reverse</th>
                        <th className={cn(WS_TH, 'text-right')}>Offset</th>
                        <th className={cn(WS_TH, 'text-right')}>Carried forward</th>
                        <th className={WS_TH}>Status</th>
                        <th className={cn(WS_TH, 'w-24')} />
                      </tr>
                    </thead>
                    <tbody>
                      {bouncesFiltered.map((b) => {
                        const carried = Number(b.consideration) - Number(b.adjusted_value);
                        return (
                          <tr className={WS_TR} key={b.id}>
                            <td className={cn(WS_TD, 'font-medium')}>{unitNo(b.unit_id)}</td>
                            <td className={WS_TD}>{b.bounced_on}</td>
                            <td className={WS_TD}>{prettyPeriodLabel(b.original_period)}</td>
                            <td className={WS_TD_NUM}>{b.rate_pct}%</td>
                            <td className={WS_TD_NUM}>{formatINR(b.consideration)}</td>
                            <td className={WS_TD_NUM}>{formatINR(b.adjusted_value)}</td>
                            <td className={cn(WS_TD_NUM, 'font-medium')}>{formatINR(carried)}</td>
                            <td className={WS_TD}>
                              <Badge variant="outline" className="text-[10px] font-medium">{BOUNCE_STATUS_LABEL[b.status] || b.status}</Badge>
                            </td>
                            <td className={WS_TD}>
                              {canEdit && carried > 0.005 && (
                                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => handleOffset(b)} disabled={isSaving}>
                                  Offset
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Excess tax ────────────────────────────────────────────────── */}
        <TabsContent value="excess" className="mt-3 space-y-3">
          <Card>
            <CardHeader className="space-y-0.5 px-4 pb-2 pt-3">
              <CardTitle className="text-[15px] leading-snug">Excess tax register</CardTitle>
              <CardDescription className="text-xs leading-snug">
                Where a receipt was inclusive of GST but tax was computed on the whole figure, tax was paid
                on the tax. Restating it books the excess <em>and</em> raises the unit's BU differential,
                because the overstated consideration had inflated its value taxed.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {excess.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No restatements recorded.</p>
              ) : (
                <div className={WS_TABLE_WRAP}>
                  <table className={WS_TABLE}>
                    <thead>
                      <tr>
                        <th className={WS_TH}>Unit</th>
                        <th className={WS_TH}>Identified</th>
                        <th className={cn(WS_TH, 'text-right')}>Original</th>
                        <th className={cn(WS_TH, 'text-right')}>Restated</th>
                        <th className={cn(WS_TH, 'text-right')}>Excess tax</th>
                        <th className={WS_TH}>Treatment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {excess.map((e) => (
                        <tr className={WS_TR} key={e.id}>
                          <td className={cn(WS_TD, 'font-medium')}>{unitNo(e.unit_id)}</td>
                          <td className={WS_TD}>{e.identified_on}</td>
                          <td className={WS_TD_NUM}>{formatINR(e.original_consideration)}</td>
                          <td className={WS_TD_NUM}>{formatINR(e.restated_consideration)}</td>
                          <td className={cn(WS_TD_NUM, 'font-medium')}>{formatINR(e.excess_tax)}</td>
                          <td className={WS_TD}>{EXCESS_TREATMENT_LABEL[e.treatment] || e.treatment}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {canEdit && restatable.length > 0 && (
            <Card>
              <CardHeader className="space-y-0.5 px-4 pb-2 pt-3">
                <CardTitle className="text-[15px] leading-snug">Receipts recorded as GST-exclusive</CardTitle>
                <CardDescription className="text-xs leading-snug">
                  If any of these were actually inclusive of GST, restate it here. The per-unit tie-out on
                  the bookings page is the usual way these surface — value taxed overshoots the agreement
                  value by exactly the grossed-up portion.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className={WS_TABLE_WRAP}>
                  <table className={WS_TABLE}>
                    <thead>
                      <tr>
                        <th className={WS_TH}>Unit</th>
                        <th className={WS_TH}>Date</th>
                        <th className={cn(WS_TH, 'text-right')}>Amount</th>
                        <th className={cn(WS_TH, 'text-right')}>Tax charged</th>
                        <th className={cn(WS_TH, 'w-24')} />
                      </tr>
                    </thead>
                    <tbody>
                      {restatable.slice(0, 30).map((r) => (
                        <tr className={WS_TR} key={r.id}>
                          <td className={cn(WS_TD, 'font-medium')}>{unitNo(r.unit_id)}</td>
                          <td className={WS_TD}>{r.receipt_date}</td>
                          <td className={WS_TD_NUM}>{formatINR(r.amount_entered)}</td>
                          <td className={WS_TD_NUM}>{formatINR(r.cgst + r.sgst)}</td>
                          <td className={WS_TD}>
                            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => { setRestateDialog(r); setRestateTreatment('ADJUST'); }}>
                              <Coins className="h-3 w-3" /> Restate
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Cancellations ─────────────────────────────────────────────── */}
        <TabsContent value="cancellations" className="mt-3">
          <Card>
            <CardHeader className="space-y-0.5 px-4 pb-2 pt-3">
              <CardTitle className="text-[15px] leading-snug">Cancelled bookings</CardTitle>
              <CardDescription className="text-xs leading-snug">
                A <strong>credit note</strong> cancellation reverses the tax already charged in full,
                immediately. A <strong>set-off</strong> cancellation raises no credit note — each refund
                payment instead nets against that payment's own month's Table 11A collections at the
                cancelled rate, and anything that doesn't fit is forfeited permanently, not carried
                forward. Use "Cancel booking" on a unit's row menu on the Bookings page to start one.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {cancellations.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No bookings cancelled.</p>
              ) : (
                <div className={WS_TABLE_WRAP}>
                  <table className={WS_TABLE}>
                    <thead>
                      <tr>
                        <th className={WS_TH}>Unit</th>
                        <th className={WS_TH}>Cancelled</th>
                        <th className={WS_TH}>Method</th>
                        <th className={cn(WS_TH, 'text-right')}>Total received</th>
                        <th className={cn(WS_TH, 'text-right')}>Refund payable</th>
                        <th className={cn(WS_TH, 'text-right')}>Refund paid</th>
                        <th className={WS_TH}>Status</th>
                        <th className={cn(WS_TH, 'w-32')} />
                      </tr>
                    </thead>
                    <tbody>
                      {cancellations.map((c) => (
                        <React.Fragment key={c.id}>
                          <tr className={WS_TR}>
                            <td className={cn(WS_TD, 'font-medium')}>{unitNo(c.unit_id)}</td>
                            <td className={WS_TD}>{c.cancellation_date}</td>
                            <td className={WS_TD}>
                              {c.correction_method === 'CREDIT_NOTE' ? 'Credit note'
                                : c.correction_method === 'SETOFF' ? 'Set-off' : 'No correction'}
                            </td>
                            <td className={WS_TD_NUM}>{formatINR(c.total_received)}</td>
                            <td className={WS_TD_NUM}>{formatINR(c.refund_payable)}</td>
                            <td className={WS_TD_NUM}>{formatINR(c.refund_paid)}</td>
                            <td className={WS_TD}>
                              <Badge variant={c.status === 'SETTLED' ? 'success' : 'warning'} className="text-[10px] font-medium">
                                {c.status === 'SETTLED' ? 'Settled' : 'Refund pending'}
                              </Badge>
                            </td>
                            <td className={WS_TD}>
                              {canEdit && c.status === 'OPEN' && (
                                <Button
                                  size="sm" variant="outline" className="h-7 px-2 text-xs"
                                  onClick={() => {
                                    setRefundForm({ payment_date: today(), amount: '', instrument_type: 'NEFT/RTGS', instrument_ref: '', notes: '' });
                                    setRefundDialog(c);
                                  }}
                                >
                                  Record payment
                                </Button>
                              )}
                            </td>
                          </tr>
                          {refundPayments.filter((p) => p.cancellation_id === c.id).map((p) => (
                            <tr className={cn(WS_TR, 'bg-muted/20')} key={p.id}>
                              <td className={WS_TD} />
                              <td className={cn(WS_TD, 'text-muted-foreground')}>{p.payment_date}</td>
                              <td className={cn(WS_TD, 'text-muted-foreground')} colSpan={2}>
                                Paid {formatINR(p.amount)}
                                {c.correction_method === 'SETOFF' && (
                                  <>
                                    {' — set off '}{formatINR(p.offset_amount)} against {prettyPeriodLabel(p.period_month)}
                                    {p.forfeited_amount > 0.005 && <>, {formatINR(p.forfeited_amount)} forfeited</>}
                                  </>
                                )}
                              </td>
                              <td className={WS_TD} colSpan={3} />
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Cancel booking dialog ────────────────────────────────────────── */}
      <Dialog open={!!cancelDialog} onOpenChange={(o) => !o && setCancelDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Cancel booking — unit {cancelDialog ? unitNo(cancelDialog.unitId) : ''}</DialogTitle>
            <DialogDescription>
              Frees the unit for resale. Choose how the tax already charged gets corrected — this cannot
              be changed once saved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cx-date">Cancellation date</Label>
                <Input
                  id="cx-date" type="date" value={cancelForm.cancellation_date}
                  onChange={(e) => setCancelForm({ ...cancelForm, cancellation_date: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="cx-forfeit">Forfeiture (non-taxable)</Label>
                <Input
                  id="cx-forfeit" type="number" step="0.01" value={cancelForm.forfeiture_amount}
                  onChange={(e) => setCancelForm({ ...cancelForm, forfeiture_amount: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="cx-charge">Cancellation charge (taxable, excl. GST)</Label>
              <Input
                id="cx-charge" type="number" step="0.01" value={cancelForm.cancellation_charge_taxable}
                onChange={(e) => setCancelForm({ ...cancelForm, cancellation_charge_taxable: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Taxed at the unit's own rate and posted as a fresh invoice — independent of how the
                refund itself is corrected below.
              </p>
            </div>
            <div>
              <Label htmlFor="cx-reason">Reason</Label>
              <Input
                id="cx-reason" value={cancelForm.reason}
                onChange={(e) => setCancelForm({ ...cancelForm, reason: e.target.value })}
              />
            </div>
            <div>
              <Label>Correction method</Label>
              <Select
                value={cancelForm.correction_method}
                onValueChange={(v) => setCancelForm({ ...cancelForm, correction_method: v as 'CREDIT_NOTE' | 'SETOFF' | 'NONE' })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CREDIT_NOTE">Credit note — reverse the full amount now (s.34)</SelectItem>
                  <SelectItem value="SETOFF">Set-off — no credit note; net each refund against its own month</SelectItem>
                  <SelectItem value="NONE">No correction — plain cash refund, tax already paid stays as-is</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {cancelForm.correction_method === 'CREDIT_NOTE'
                  ? 'A CANCELLATION credit note is raised immediately for the full amount already taxed, '
                    + 'referencing the actual invoice(s)/receipt voucher(s) behind it.'
                  : cancelForm.correction_method === 'SETOFF'
                    ? 'No credit note. As refund payments are recorded below, each one nets against that '
                      + "month's collections at this unit's rate — capped by what's available, and anything "
                      + 'over that is forfeited permanently, never carried to a later month. The client is '
                      + 'emailed to confirm each set-off once its return is filed.'
                    : 'No credit note, no set-off against any month\'s collections. The refund below is a '
                      + 'plain cash record only — the firm does not attempt to recover the GST already paid '
                      + 'on this advance.'}
              </p>
              {cancelForm.correction_method === 'CREDIT_NOTE' && cancelPreview && !cancelPreview.window.isOpen && (
                <div className="mt-2 flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-foreground">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  <p className="text-xs">
                    The s.34 window on this booking's earliest receipt closed on {cancelPreview.window.expiryLabel}.
                    A credit note raised now will be recorded but excluded from GSTR-1 — the tax cannot be
                    recovered by the firm this way. Consider Set-off or No correction instead, or note that the
                    member (as an unregistered buyer) may separately claim it back under Circular 188/20/2022.
                  </p>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Retire this unit permanently</p>
                <p className="text-xs text-muted-foreground">Off by default — the unit becomes Available for resale.</p>
              </div>
              <input
                type="checkbox" checked={cancelForm.retire_unit}
                onChange={(e) => setCancelForm({ ...cancelForm, retire_unit: e.target.checked })}
                className="h-4 w-4"
              />
            </div>
            {cancelPreview && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span>Total already received</span><span className="font-medium">{formatINR(cancelPreview.totalReceived)}</span></div>
                <div className="flex justify-between"><span>Refund payable to member</span><span className="font-semibold">{formatINR(cancelPreview.refundPayable)}</span></div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialog(null)}>Cancel</Button>
            <Button onClick={handleSaveCancellation} disabled={isSaving} variant="destructive">
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Confirm cancellation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Record refund payment dialog ─────────────────────────────────── */}
      <Dialog open={!!refundDialog} onOpenChange={(o) => !o && setRefundDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record refund payment — unit {refundDialog ? unitNo(refundDialog.unit_id) : ''}</DialogTitle>
            <DialogDescription>
              {refundDialog?.correction_method === 'SETOFF'
                ? "This payment nets against its own month's collections — a cancellation refunded over "
                  + 'several months is several independent payments, each judged on its own period.'
                : refundDialog?.correction_method === 'CREDIT_NOTE'
                  ? 'Plain cash record — the credit note already corrected the GST side.'
                  : 'Plain cash record — no GST correction is being attempted for this refund.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="rf-date">Payment date</Label>
                <Input
                  id="rf-date" type="date" value={refundForm.payment_date}
                  onChange={(e) => setRefundForm({ ...refundForm, payment_date: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="rf-amt">Amount</Label>
                <Input
                  id="rf-amt" type="number" step="0.01" value={refundForm.amount}
                  onChange={(e) => setRefundForm({ ...refundForm, amount: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Instrument</Label>
              <Select
                value={refundForm.instrument_type}
                onValueChange={(v) => setRefundForm({ ...refundForm, instrument_type: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['NEFT/RTGS', 'Cheque', 'UPI', 'Cash', 'Bank Transfer', 'Other'].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="rf-ref">Reference</Label>
              <Input
                id="rf-ref" value={refundForm.instrument_ref}
                onChange={(e) => setRefundForm({ ...refundForm, instrument_ref: e.target.value })}
              />
            </div>
            {refundDialog?.correction_method === 'SETOFF' && refundPreview && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span>Available in {prettyPeriodLabel(periodOfDate(refundForm.payment_date))} at this rate</span>
                  <span className="font-medium">{formatINR(refundPreview.available)}</span>
                </div>
                {(() => {
                  const amt = parseFloat(refundForm.amount) || 0;
                  const offset = Math.min(amt, refundPreview.available);
                  const forfeited = Math.max(0, amt - offset);
                  return amt > 0 ? (
                    <>
                      <div className="flex justify-between"><span>Would set off</span><span className="font-medium">{formatINR(offset)}</span></div>
                      {forfeited > 0.005 && (
                        <div className="flex justify-between text-destructive">
                          <span>Would forfeit permanently</span><span className="font-semibold">{formatINR(forfeited)}</span>
                        </div>
                      )}
                    </>
                  ) : null;
                })()}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundDialog(null)}>Cancel</Button>
            <Button onClick={handleSaveRefundPayment} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Re-rating schedule dialog ─────────────────────────────────────── */}
      <Dialog open={!!reclassDialog} onOpenChange={(o) => !o && setReclassDialog(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Re-rating schedule — unit {reclassDialog?.unitNo}</DialogTitle>
            <DialogDescription>
              Interest u/s 50 runs from each original period's due date, so the schedule is period-wise. A
              single lump sum at today's date would understate it materially on an older unit.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="rc-period">Posting period (MM/YYYY)</Label>
              <Input
                id="rc-period" value={reclassPeriod}
                onChange={(e) => setReclassPeriod(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="rc-reason">What pushed it over ₹45 lakh</Label>
              <Input
                id="rc-reason" value={reclassReason} placeholder="e.g. parking charge added Mar 2026"
                onChange={(e) => setReclassReason(e.target.value)}
              />
            </div>
          </div>

          {previewSchedule && (
            <>
              <div className="grid gap-2 sm:grid-cols-3 rounded-lg border p-3 bg-muted/30 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Value re-taxed</p>
                  <p className="font-semibold">{formatINR(previewSchedule.totalValueRetaxed)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Differential tax</p>
                  <p className="font-semibold">{formatINR(previewSchedule.totalDifferentialTax)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Interest u/s 50 @18%</p>
                  <p className="font-semibold">{formatINR(previewSchedule.totalInterest)}</p>
                </div>
              </div>

              <div className="rounded border overflow-x-auto">
                <div className={WS_TABLE_WRAP}>
                  <table className={WS_TABLE}>
                    <thead>
                      <tr>
                        <th className={WS_TH}>Period</th>
                        <th className={cn(WS_TH, 'text-right')}>Taxable value</th>
                        <th className={cn(WS_TH, 'text-right')}>At 1.5%</th>
                        <th className={cn(WS_TH, 'text-right')}>At {reclassDialog?.currentRatePct}%</th>
                        <th className={cn(WS_TH, 'text-right')}>Differential</th>
                        <th className={WS_TH}>Due date</th>
                        <th className={cn(WS_TH, 'text-right')}>Days</th>
                        <th className={cn(WS_TH, 'text-right')}>Interest</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewSchedule.periods.map((p) => (
                        <tr className={WS_TR} key={p.periodMonth}>
                          <td className={WS_TD}>{prettyPeriodLabel(p.periodMonth)}</td>
                          <td className={WS_TD_NUM}>{formatINR(p.taxableValue)}</td>
                          <td className={WS_TD_NUM}>{formatINR(p.oldCgst + p.oldSgst)}</td>
                          <td className={WS_TD_NUM}>{formatINR(p.newCgst + p.newSgst)}</td>
                          <td className={cn(WS_TD_NUM, 'font-medium')}>{formatINR(p.differentialTax)}</td>
                          <td className={WS_TD}>{p.dueDate}</td>
                          <td className={WS_TD_NUM}>{p.interestDays}</td>
                          <td className={WS_TD_NUM}>{formatINR(p.interestAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReclassDialog(null)}>Cancel</Button>
            <Button onClick={handleSaveReclass} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reverse reclassification dialog ─────────────────────────────────── */}
      <Dialog open={!!reverseDialog} onOpenChange={(o) => { if (!o) { setReverseDialog(null); setReverseReason(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reverse re-rating — unit {reverseDialog ? unitNo(reverseDialog.unit_id) : ''}</DialogTitle>
            <DialogDescription>
              Voids this reclassification. The correction (
              {reverseDialog ? formatINR(reverseDialog.total_differential_tax) : ''} differential tax,{' '}
              {reverseDialog ? formatINR(reverseDialog.total_interest) : ''} interest) drops out of the DRC-03
              workpaper (or Table 10, if that mode was used), and the unit's live classification governs again.
              This does not rewrite any receipt or invoice whose own rate was saved while the unit was locked —
              check those by hand afterwards.
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="reverse-reason">Reason (required)</Label>
            <Input
              id="reverse-reason" value={reverseReason}
              placeholder="e.g. the parking charge that triggered this was entered in error and removed same day"
              onChange={(e) => setReverseReason(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setReverseDialog(null); setReverseReason(''); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleReverseReclass} disabled={isSaving || !reverseReason.trim()}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Reverse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Mark DRC-03 as filed dialog ──────────────────────────────────────── */}
      <Dialog open={!!filedDialog} onOpenChange={(o) => !o && setFiledDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark DRC-03 as filed — unit {filedDialog ? unitNo(filedDialog.unit_id) : ''}</DialogTitle>
            <DialogDescription>
              Records that the {filedDialog ? formatINR(filedDialog.total_differential_tax + filedDialog.total_interest) : ''}{' '}
              (tax + interest) was paid via DRC-03 on the GST portal. This is a record only — the app does not
              file DRC-03 itself.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="drc03-arn">ARN</Label>
              <Input
                id="drc03-arn" value={filedForm.arn} placeholder="e.g. AD2408240012345"
                onChange={(e) => setFiledForm((f) => ({ ...f, arn: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="drc03-date">Filed date</Label>
              <Input
                id="drc03-date" type="date" value={filedForm.filed_date}
                onChange={(e) => setFiledForm((f) => ({ ...f, filed_date: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFiledDialog(null)}>Cancel</Button>
            <Button onClick={handleMarkFiled} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Historical receipts dialog ───────────────────────────────────────── */}
      <Dialog open={histDialog} onOpenChange={(o) => !o && setHistDialog(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Historical receipts — unit {unitNo(histUnitId)}</DialogTitle>
            <DialogDescription>
              Date-wise pre-onboarding receipts, used only to compute DRC-03 differential tax and s.50
              interest for periods the opening balance can't break out on its own.
            </DialogDescription>
          </DialogHeader>

          {histRecon && (
            <div className="rounded-md border p-3 text-sm space-y-1 bg-muted/30">
              <div className="flex justify-between"><span>Entered here</span><span>{formatINR(histRecon.historicalTotal)}</span></div>
              <div className="flex justify-between"><span>Opening balance — cumulative receipts</span><span>{formatINR(histRecon.openingCumulativeReceipts)}</span></div>
              <div className={`flex justify-between font-medium ${Math.abs(histRecon.variance) > 0.5 ? 'text-amber-700 dark:text-amber-400' : 'text-success-strong'}`}>
                <span>Variance</span><span>{formatINR(histRecon.variance)}</span>
              </div>
              {Math.abs(histRecon.variance) > 0.5 && (
                <p className="text-xs text-muted-foreground pt-1">
                  Doesn't tally yet — partial history is fine, but interest computed from what's entered here
                  will understate the true position until it does.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2 items-end">
            <div>
              <Label htmlFor="hist-date">Date</Label>
              <Input
                id="hist-date" type="date" value={histForm.receipt_date}
                onChange={(e) => setHistForm((f) => ({ ...f, receipt_date: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="hist-amount">Amount</Label>
              <Input
                id="hist-amount" type="number" value={histForm.amount}
                onChange={(e) => setHistForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="hist-notes">Notes</Label>
              <Input
                id="hist-notes" value={histForm.notes}
                onChange={(e) => setHistForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <Button onClick={handleAddHistorical} disabled={isSaving}>Add</Button>
          </div>

          <div className={WS_TABLE_WRAP}>
            <table className={WS_TABLE}>
              <thead>
                <tr>
                  <th className={WS_TH}>Date</th>
                  <th className={cn(WS_TH, 'text-right')}>Amount</th>
                  <th className={WS_TH}>Notes</th>
                  <th className={cn(WS_TH, 'w-16')} />
                </tr>
              </thead>
              <tbody>
                {histLoading ? (
                  <tr className={WS_TR}><td className={cn(WS_TD, 'text-center text-muted-foreground py-6')} colSpan={4}>Loading…</td></tr>
                ) : histReceipts.length === 0 ? (
                  <tr className={WS_TR}><td className={cn(WS_TD, 'text-center text-muted-foreground py-6')} colSpan={4}>No historical receipts entered.</td></tr>
                ) : histReceipts.map((r) => (
                  <tr className={WS_TR} key={r.id}>
                    <td className={WS_TD}>{r.receiptDate}</td>
                    <td className={WS_TD_NUM}>{formatINR(r.amount)}</td>
                    <td className={cn(WS_TD, 'text-muted-foreground')}>{r.notes}</td>
                    <td className={WS_TD}>
                      <Button size="sm" variant="ghost" onClick={() => handleDeleteHistorical(r.id)}>
                        <Undo2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setHistDialog(false)}>Close</Button>
            <Button onClick={() => { setHistDialog(false); void runReclassSweep(); }}>
              Close &amp; check for re-rating
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Credit note dialog ────────────────────────────────────────────── */}
      <Dialog open={cnDialog} onOpenChange={setCnDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Raise credit note</DialogTitle>
            <DialogDescription>
              The window is measured from the original document's date, not today's.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Unit</Label>
              <Select value={cnForm.unit_id} onValueChange={(v) => setCnForm({ ...cnForm, unit_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger>
                <SelectContent>
                  {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.unit_no}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="cn-date">Note date</Label>
              <Input id="cn-date" type="date" value={cnForm.note_date}
                onChange={(e) => setCnForm({ ...cnForm, note_date: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="cn-orig">Original document date</Label>
              <Input id="cn-orig" type="date" value={cnForm.original_doc_date}
                onChange={(e) => setCnForm({ ...cnForm, original_doc_date: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="cn-val">Value (excl. GST)</Label>
              <Input id="cn-val" type="number" step="0.01" value={cnForm.consideration}
                onChange={(e) => setCnForm({ ...cnForm, consideration: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="cn-doc">Note no.</Label>
              <Input id="cn-doc" value={cnForm.doc_no}
                onChange={(e) => setCnForm({ ...cnForm, doc_no: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="cn-reason">Reason</Label>
              <Input id="cn-reason" value={cnForm.reason}
                onChange={(e) => setCnForm({ ...cnForm, reason: e.target.value })} />
            </div>
          </div>

          {cnWindow && (
            <div className={`flex gap-2 rounded-md border px-2.5 py-1.5 text-foreground ${cnWindow.isOpen
              ? 'border-success/40 bg-success/10'
              : 'border-destructive/40 bg-destructive/5'}`}>
              <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${cnWindow.isOpen ? 'text-success-strong' : 'text-destructive'}`} />
              <p className="text-xs">
                {cnWindow.isOpen
                  ? `Window open until ${cnWindow.expiryLabel} — ${cnWindow.daysRemaining} days remaining.`
                  : `Window closed on ${cnWindow.expiryLabel}. The tax cannot be adjusted; the buyer can `
                    + 'claim it as a refund u/s 54 under Circular 188/20/2022. The note will be recorded '
                    + 'for the trail but excluded from the return.'}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCnDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveCreditNote} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Raise note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Conversion dialog ─────────────────────────────────────────────── */}
      <Dialog open={convDialog} onOpenChange={setConvDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Record conversion</DialogTitle>
            <DialogDescription>
              The value already taxed on the old unit is carried across and re-taxed at the new unit's rate.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>From unit</Label>
              <Select value={convForm.from_unit_id} onValueChange={(v) => setConvForm({ ...convForm, from_unit_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.unit_no}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>To unit</Label>
              <Select value={convForm.to_unit_id} onValueChange={(v) => setConvForm({ ...convForm, to_unit_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.unit_no}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="cv-date">Conversion date</Label>
              <Input id="cv-date" type="date" value={convForm.conversion_date}
                onChange={(e) => setConvForm({ ...convForm, conversion_date: e.target.value })} />
            </div>
          </div>

          {convPreview && (
            <div className="rounded-lg border p-3 bg-muted/30 text-sm">
              <p>
                Rate {convPreview.fromRatePct}% → {convPreview.toRatePct}%
                {convPreview.isRateNeutral
                  ? ' — same rate, so no GST differential. The documentation still has to move.'
                  : ' — the carried value will be re-taxed at the new rate.'}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConvDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveConversion} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Restate dialog ────────────────────────────────────────────────── */}
      <Dialog open={!!restateDialog} onOpenChange={(o) => !o && setRestateDialog(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Restate receipt as GST-inclusive</DialogTitle>
            <DialogDescription>
              Rule 35 backs the tax out of the amount received. Both the excess tax and the higher BU
              differential follow from the same correction.
            </DialogDescription>
          </DialogHeader>

          {restatePreview && (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 rounded-lg border p-3 bg-muted/30 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Consideration: was → now</p>
                  <p className="font-semibold">
                    {formatINR(restatePreview.originalConsideration)} → {formatINR(restatePreview.restatedConsideration)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tax: was → now</p>
                  <p className="font-semibold">
                    {formatINR(restatePreview.originalTax)} → {formatINR(restatePreview.restatedTax)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Excess tax paid</p>
                  <p className="font-semibold">{formatINR(restatePreview.excessTax)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">BU differential rises by</p>
                  <p className="font-semibold">{formatINR(restatePreview.considerationReduction)}</p>
                </div>
              </div>

              <div>
                <Label>Treatment of the excess</Label>
                <Select value={restateTreatment} onValueChange={(v) => setRestateTreatment(v as typeof restateTreatment)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(EXCESS_TREATMENT_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRestateDialog(null)}>Cancel</Button>
            <Button onClick={handleRestate} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Restate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BuilderAdjustmentsPage;
