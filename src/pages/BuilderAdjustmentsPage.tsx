import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBuilderEmbedded, useBuilderProjectId } from '@/contexts/BuilderWorkspaceContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import {
  ArrowLeft, Loader2, AlertTriangle, Wrench, Send, Info, ArrowLeftRight, Undo2,
  ReceiptText, Coins,
} from 'lucide-react';
import {
  DEFAULT_CHARGE_INCLUSIONS, classifyUnit, formatINR, testRrep,
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
  applyBounceOffsets, findOffsetCandidates, findReclassCandidates, raiseBounceReversal,
  raiseCreditNote, restateReceipt, saveReclassification, scheduleFor,
  type ReclassCandidate,
} from '@/lib/builderAdjustmentsData';

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

const today = () => new Date().toISOString().slice(0, 10);
const currentPeriod = () => {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

interface Props {
  /** Jump straight into one unit's correction dialog, instead of the full register. */
  focusUnitId?: string;
  focusAction?: 'creditNote' | 'reRate' | 'bounceReversal' | 'convert';
}

const BuilderAdjustmentsPage: React.FC<Props> = ({ focusUnitId, focusAction }) => {
  const projectId = useBuilderProjectId();
  const embedded = useBuilderEmbedded();
  const navigate = useNavigate();
  const { canPostBuilderAdjustments, user } = useAuth();

  const [tab, setTab] = useState('reclass');
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
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [reclassDialog, setReclassDialog] = useState<ReclassCandidate | null>(null);
  const [reclassPeriod, setReclassPeriod] = useState(currentPeriod());
  const [reclassReason, setReclassReason] = useState('');

  const [cnDialog, setCnDialog] = useState(false);
  const [cnForm, setCnForm] = useState({
    unit_id: '', note_date: today(), note_type: 'CANCELLATION' as const,
    consideration: '', original_doc_date: '', reason: '', doc_no: '',
  });

  const [convDialog, setConvDialog] = useState(false);
  const [convForm, setConvForm] = useState({ from_unit_id: '', to_unit_id: '', conversion_date: today() });

  const [restateDialog, setRestateDialog] = useState<ReceiptRow | null>(null);
  const [restateTreatment, setRestateTreatment] = useState<'ADJUST' | 'REFUND' | 'ABSORB'>('ADJUST');

  const canEdit = canPostBuilderAdjustments();
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
        { data: cns }, { data: cnv }] = await Promise.all([
        supabase.from('builder_unit_charges').select('*').in('unit_id', unitIds),
        supabase.from('builder_receipts').select('*').in('unit_id', unitIds).order('receipt_date'),
        supabase.from('builder_reclassifications').select('*').in('unit_id', unitIds),
        supabase.from('builder_bounce_reversals').select('*').eq('project_id', projectId),
        supabase.from('builder_excess_tax').select('*').eq('project_id', projectId),
        supabase.from('builder_credit_notes').select('*').in('unit_id', unitIds).order('note_date'),
        supabase.from('builder_conversions').select('*').in('from_unit_id', unitIds),
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

  // Re-rating candidates are derived from what was actually posted at 1.5%.
  const [candidatesReady, setCandidatesReady] = useState(false);
  useEffect(() => {
    if (!projectId || !units.length) { setCandidates([]); setCandidatesReady(true); return; }
    setCandidatesReady(false);
    (async () => {
      const done = new Set(reclasses.map((r) => r.unit_id));
      const found = await findReclassCandidates(projectId, classification);
      setCandidates(found.filter((c) => !done.has(c.unitId)));
      setCandidatesReady(true);
    })();
  }, [projectId, units.length, classification, reclasses]);

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
    }
  }, [focusUnitId, focusAction, isLoading, candidatesReady, candidates, unitNo]);

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
    if (!window.confirm(
      'Post this re-rating? The earlier B2CS entries are amended in Table 10 — reversed at 1.5% and '
      + 're-reported at the correct rate. Interest u/s 50 is payable in cash separately.',
    )) return;
    const { error } = await supabase.from('builder_reclassifications')
      .update({ status: 'POSTED', posted_at: new Date().toISOString(), posted_by: user?.id ?? null })
      .eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Re-rating posted to Table 10');
    await load();
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
      <div className="flex items-center gap-2 text-muted-foreground text-sm p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading adjustments…
      </div>
    );
  }
  if (!project) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${project.name} — Adjustments`}
        subtitle="Re-rating, conversions, credit notes, bounce reversals and excess tax"
        icon={<Wrench className="h-5 w-5" />}
        actions={embedded ? undefined : (
          <Button variant="outline" onClick={() => navigate(`/builder-projects/${projectId}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Project
          </Button>
        )}
      />

      <div className="flex gap-2 rounded-lg border bg-muted/30 p-3 text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p className="text-xs">
          The rule that decides every case here: a change in the flow of <strong>money</strong> is not a
          change in the <strong>supply</strong>. GST adjusts only when the consideration or the supply
          itself changes — not when a cheque bounces, and not when a member refinances.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="reclass">
            Re-rating {candidates.length > 0 && <Badge className="ml-2 bg-amber-100 text-amber-800 border-amber-200">{candidates.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="conversions">Conversions ({conversions.length})</TabsTrigger>
          <TabsTrigger value="notes">Credit notes ({notes.length})</TabsTrigger>
          <TabsTrigger value="bounce">
            Bounce register {bouncedNeedingReversal.length > 0 && <Badge className="ml-2 bg-red-100 text-red-800 border-red-200">{bouncedNeedingReversal.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="excess">Excess tax ({excess.length})</TabsTrigger>
        </TabsList>

        {/* ── Re-rating ─────────────────────────────────────────────────── */}
        <TabsContent value="reclass" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Units needing re-rating</CardTitle>
              <CardDescription>
                A unit taxed at 1.5% whose gross consideration has since crossed ₹45 lakh was never
                affordable. The concession never applied, so the higher rate is due on everything already
                offered to tax — with interest u/s 50 running from each original period's due date.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-6">
                  No units carry affordable-rate entries that no longer qualify.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Gross now</TableHead>
                      <TableHead className="text-right">Correct rate</TableHead>
                      <TableHead className="text-right">Periods affected</TableHead>
                      <TableHead className="text-right">Value at 1.5%</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidates.map((c) => (
                      <TableRow key={c.unitId}>
                        <TableCell className="font-medium">{c.unitNo}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(c.grossConsideration)}</TableCell>
                        <TableCell className="text-right text-sm">{c.currentRatePct}%</TableCell>
                        <TableCell className="text-right text-sm">{c.periods.length}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(c.totalTaxableAtOldRate)}</TableCell>
                        <TableCell>
                          {canEdit && (
                            <Button size="sm" variant="outline" onClick={() => { setReclassDialog(c); setReclassPeriod(currentPeriod()); }}>
                              Schedule
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {reclasses.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Scheduled re-ratings</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit</TableHead>
                      <TableHead>Posting period</TableHead>
                      <TableHead className="text-right">Value re-taxed</TableHead>
                      <TableHead className="text-right">Differential tax</TableHead>
                      <TableHead className="text-right">Interest u/s 50</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reclasses.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{unitNo(r.unit_id)}</TableCell>
                        <TableCell className="text-sm">{prettyPeriodLabel(r.posting_period)}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(r.total_value_retaxed)}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{formatINR(r.total_differential_tax)}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(r.total_interest)}</TableCell>
                        <TableCell>
                          <Badge className={r.status === 'POSTED'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : 'bg-amber-100 text-amber-800 border-amber-200'}>
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {canEdit && r.status !== 'POSTED' && (
                            <Button size="sm" onClick={() => handlePostReclass(r)}>
                              <Send className="h-3 w-3 mr-1" /> Post
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Conversions ───────────────────────────────────────────────── */}
        <TabsContent value="conversions" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Unit conversions</CardTitle>
                <CardDescription>
                  A member moving between units is a cancellation plus a fresh booking, not a ledger entry.
                  Where the rates differ the carried value is re-taxed; where the old unit's credit-note
                  window has closed, its tax cannot be recovered but the new tax is still due.
                </CardDescription>
              </div>
              {canEdit && (
                <Button onClick={() => setConvDialog(true)}>
                  <ArrowLeftRight className="h-4 w-4 mr-2" /> Record conversion
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {conversions.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-6">No conversions recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead className="text-right">Carried value</TableHead>
                      <TableHead className="text-right">Rate change</TableHead>
                      <TableHead className="text-right">Differential</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {conversions.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm">{c.conversion_date}</TableCell>
                        <TableCell className="font-medium">{unitNo(c.from_unit_id)}</TableCell>
                        <TableCell className="font-medium">{unitNo(c.to_unit_id)}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(c.carried_value)}</TableCell>
                        <TableCell className="text-right text-sm">
                          {c.from_rate_pct}% → {c.to_rate_pct}%
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {formatINR(c.differential_tax)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Credit notes ──────────────────────────────────────────────── */}
        <TabsContent value="notes" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Credit notes</CardTitle>
                <CardDescription>
                  s.34 allows the tax adjustment only until 30 November following the financial year of the
                  original document. Intra-state B2C notes net inside Table 7 — CDNUR cannot arise here.
                </CardDescription>
              </div>
              {canEdit && (
                <Button onClick={() => setCnDialog(true)}>
                  <ReceiptText className="h-4 w-4 mr-2" /> Raise credit note
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {notes.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-6">No credit notes raised.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Tax</TableHead>
                      <TableHead>Window</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {notes.map((n) => (
                      <TableRow key={n.id}>
                        <TableCell className="text-sm">{n.note_date}</TableCell>
                        <TableCell className="font-medium">{unitNo(n.unit_id)}</TableCell>
                        <TableCell className="text-sm">{NOTE_TYPE_LABEL[n.note_type] || n.note_type}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(n.consideration)}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(n.cgst + n.sgst)}</TableCell>
                        <TableCell>
                          {n.within_window ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
                              Adjusted
                            </Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-800 border-red-200">
                              Out of window — buyer refunds u/s 54
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Bounce register ───────────────────────────────────────────── */}
        <TabsContent value="bounce" className="mt-4 space-y-4">
          {bounceFocusUnitId && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
              <span>Showing only unit {unitNo(bounceFocusUnitId)}.</span>
              <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => setBounceFocusUnitId(null)}>
                Show all units
              </Button>
            </div>
          )}
          {bouncedNeedingReversalFiltered.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Bounced advances without a reversal</CardTitle>
                <CardDescription>
                  Raise a reversal only where the return for the original period is already filed. If it is
                  still open, simply deleting the receipt is cleaner.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit</TableHead>
                      <TableHead>Receipt date</TableHead>
                      <TableHead>Original period</TableHead>
                      <TableHead className="text-right">Consideration</TableHead>
                      <TableHead className="text-right">Tax</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bouncedNeedingReversalFiltered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{unitNo(r.unit_id)}</TableCell>
                        <TableCell className="text-sm">{r.receipt_date}</TableCell>
                        <TableCell className="text-sm">{prettyPeriodLabel(r.period_month)}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(r.consideration)}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(r.cgst + r.sgst)}</TableCell>
                        <TableCell>
                          {canEdit && (
                            <Button size="sm" variant="outline" onClick={() => handleRaiseBounce(r)}>
                              <Undo2 className="h-3 w-3 mr-1" /> Reverse
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reversal register</CardTitle>
              <CardDescription>
                Offsets go against later months at the <strong>same rate</strong> in the <strong>same
                project</strong>. The portal rejects a negative Table 11A, so anything that will not fit
                carries forward rather than being lost.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {bouncesFiltered.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-6">
                  {bounceFocusUnitId ? 'No reversals raised for this unit.' : 'No reversals raised.'}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit</TableHead>
                      <TableHead>Bounced</TableHead>
                      <TableHead>Original period</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">To reverse</TableHead>
                      <TableHead className="text-right">Offset</TableHead>
                      <TableHead className="text-right">Carried forward</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bouncesFiltered.map((b) => {
                      const carried = Number(b.consideration) - Number(b.adjusted_value);
                      return (
                        <TableRow key={b.id}>
                          <TableCell className="font-medium">{unitNo(b.unit_id)}</TableCell>
                          <TableCell className="text-sm">{b.bounced_on}</TableCell>
                          <TableCell className="text-sm">{prettyPeriodLabel(b.original_period)}</TableCell>
                          <TableCell className="text-right text-sm">{b.rate_pct}%</TableCell>
                          <TableCell className="text-right text-sm">{formatINR(b.consideration)}</TableCell>
                          <TableCell className="text-right text-sm">{formatINR(b.adjusted_value)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{formatINR(carried)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{BOUNCE_STATUS_LABEL[b.status] || b.status}</Badge>
                          </TableCell>
                          <TableCell>
                            {canEdit && carried > 0.005 && (
                              <Button size="sm" variant="outline" onClick={() => handleOffset(b)} disabled={isSaving}>
                                Offset
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Excess tax ────────────────────────────────────────────────── */}
        <TabsContent value="excess" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Excess tax register</CardTitle>
              <CardDescription>
                Where a receipt was inclusive of GST but tax was computed on the whole figure, tax was paid
                on the tax. Restating it books the excess <em>and</em> raises the unit's BU differential,
                because the overstated consideration had inflated its value taxed.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {excess.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-6">No restatements recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit</TableHead>
                      <TableHead>Identified</TableHead>
                      <TableHead className="text-right">Original</TableHead>
                      <TableHead className="text-right">Restated</TableHead>
                      <TableHead className="text-right">Excess tax</TableHead>
                      <TableHead>Treatment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {excess.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{unitNo(e.unit_id)}</TableCell>
                        <TableCell className="text-sm">{e.identified_on}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(e.original_consideration)}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(e.restated_consideration)}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{formatINR(e.excess_tax)}</TableCell>
                        <TableCell className="text-sm">{EXCESS_TREATMENT_LABEL[e.treatment] || e.treatment}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {canEdit && restatable.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Receipts recorded as GST-exclusive</CardTitle>
                <CardDescription>
                  If any of these were actually inclusive of GST, restate it here. The per-unit tie-out on
                  the bookings page is the usual way these surface — value taxed overshoots the agreement
                  value by exactly the grossed-up portion.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Tax charged</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {restatable.slice(0, 30).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{unitNo(r.unit_id)}</TableCell>
                        <TableCell className="text-sm">{r.receipt_date}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(r.amount_entered)}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(r.cgst + r.sgst)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => { setRestateDialog(r); setRestateTreatment('ADJUST'); }}>
                            <Coins className="h-3 w-3 mr-1" /> Restate
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Taxable value</TableHead>
                      <TableHead className="text-right">At 1.5%</TableHead>
                      <TableHead className="text-right">At {reclassDialog?.currentRatePct}%</TableHead>
                      <TableHead className="text-right">Differential</TableHead>
                      <TableHead>Due date</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                      <TableHead className="text-right">Interest</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewSchedule.periods.map((p) => (
                      <TableRow key={p.periodMonth}>
                        <TableCell className="text-sm">{prettyPeriodLabel(p.periodMonth)}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(p.taxableValue)}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(p.oldCgst + p.oldSgst)}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(p.newCgst + p.newSgst)}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{formatINR(p.differentialTax)}</TableCell>
                        <TableCell className="text-sm">{p.dueDate}</TableCell>
                        <TableCell className="text-right text-sm">{p.interestDays}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(p.interestAmount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
            <div className={`flex gap-2 rounded-lg border p-3 ${cnWindow.isOpen
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'}`}>
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
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
