import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBuilderEmbedded, useBuilderProjectId } from '@/contexts/BuilderWorkspaceContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { BuilderSectionHeader } from '@/components/builder/BuilderSectionHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, Note, SectionCard } from '@/components/gstr9/ui';
import { WS_BTN, WS_PAGE, WS_TABLE_WRAP } from '@/components/workspace/theme';
import { B_TABLE, B_TD, B_TD_NUM, B_TH, B_TH_NUM, B_TR, B_TR_HEAD } from '@/components/builder/theme';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import {
  ArrowLeft, Loader2, Plus, CalendarCheck, CheckCircle2, Send, Undo2, Trash2,
} from 'lucide-react';
import {
  DEFAULT_CHARGE_INCLUSIONS, classifyUnit, formatINR, formatSqM, testRrep,
  type ChargeInclusionSettings, type UnitType,
} from '@/utils/builderRates';
import {
  POSTING_BASIS_LABEL, creditNoteDeadline, periodOfDate, type PostingBasis,
} from '@/utils/builderBuEvent';
import { prettyPeriodLabel } from '@/utils/builderLedger';
import { fetchBuilderSettings } from '@/lib/builderSettings';
import { postBuEvent, prepareBuEvent, unpostBuEvent, type PreparedEvent } from '@/lib/builderBuPosting';
import {
  fetchAgreementConfirmations, fetchClearedDisputes, fetchConfirmRequests, isAgreementCleared,
  isBuAgreementConfirmationBlocked, overrideAgreementValue,
  type AgreementConfirmRequest, type AgreementConfirmStatus, type ClearedDispute,
} from '@/lib/builderAgreementConfirmData';
import { failedMailWords, mailOutcome, requestsNotOut, unitAsk } from '@/lib/builderConfirmRules';
import SendAgreementConfirmDialog, { type ConfirmCandidate } from '@/components/builder/SendAgreementConfirmDialog';

interface ProjectRow {
  id: string; client_id: string; name: string; is_metro: boolean; grouping_label: string;
  carpet_area_source: 'DERIVED' | 'MANUAL';
  manual_residential_carpet_sqm: number; manual_commercial_carpet_sqm: number;
  doc_series_prefix: string | null;
}
interface UnitRow {
  id: string; unit_no: string; unit_type: UnitType; carpet_area_sqm: number;
  base_consideration: number; status: string; dastavej_date: string | null;
  bu_event_id: string | null; group_id: string | null;
  onboarding_status: 'LIVE' | 'CLOSED_PRE_ONBOARDING';
}
interface ChargeRow { unit_id: string; charge_head: string; amount: number; include_override: boolean | null }
interface EventRow {
  id: string; project_id: string; bu_date: string; bu_ref_no: string | null;
  /** The date printed on the permission, when first occupation came earlier (20261025100000). */
  bu_permission_date?: string | null;
  first_occupation_date?: string | null;
  scope: 'FULL' | 'UNITS'; discovered_on: string | null; posting_basis: PostingBasis;
  posting_period: string; status: 'DRAFT' | 'PREPARED' | 'POSTED';
  posted_at: string | null; notes: string | null;
}
interface EventUnitRow {
  id: string; bu_event_id: string; unit_id: string; cut_off_date: string;
  cut_off_source: string; booked_at_cutoff: boolean; agreement_value: number;
  value_taxed_upto_opening: number; differential_value: number;
  differential_taxable_value: number; differential_cgst: number; differential_sgst: number;
  interest_days: number; interest_amount: number; tie_out_diff: number;
  invoice_id: string | null; rate_pct: number;
}

const today = () => new Date().toISOString().slice(0, 10);
const shortDate = (iso: string | null | undefined) => (iso
  ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const shortWhen = (iso: string | null | undefined) => (iso
  ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
  : '');
/** "Confirmed by Rajesh Shah (rajesh@client.com) on 21 Oct 2026". */
const answeredBy = (c: AgreementConfirmStatus | undefined): string | null => {
  if (!c?.respondedByName || (c.status !== 'CONFIRMED' && c.status !== 'DISPUTED')) return null;
  return `${c.status === 'CONFIRMED' ? 'Confirmed' : 'Disputed'} by ${c.respondedByName}`
    + `${c.respondedByEmail ? ` (${c.respondedByEmail})` : ''}${c.respondedAt ? ` on ${shortDate(c.respondedAt)}` : ''}`;
};
const currentPeriod = () => {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const emptyEvent = {
  bu_date: today(),
  /** Optional: first occupation of the project, when it came before the permission. */
  first_occupation_date: '',
  bu_ref_no: '',
  scope: 'FULL' as 'FULL' | 'UNITS',
  discovered_on: today(),
  posting_basis: 'DISCOVERY_WITH_INTEREST' as PostingBasis,
  posting_period: currentPeriod(),
  notes: '',
};

/**
 * The completion date the scheme turns on: the earlier of the completion
 * certificate (BU) and the project's first occupation. Schedule II para 5(b)
 * and Notification 06/2019-CT(R) both say "whichever is earlier", so an
 * occupation before the permission moves every unit's cut-off back to it.
 */
const completionDate = (buDate: string, firstOccupation?: string | null): string =>
  (firstOccupation && firstOccupation < buDate ? firstOccupation : buDate);

const BuilderBuEventsPage: React.FC = () => {
  const projectId = useBuilderProjectId();
  const embedded = useBuilderEmbedded();
  const navigate = useNavigate();
  const { canPostBuEvent, canOverrideBuAgreement, user } = useAuth();

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [charges, setCharges] = useState<Record<string, ChargeRow[]>>({});
  const [settings, setSettings] = useState<ChargeInclusionSettings>(DEFAULT_CHARGE_INCLUSIONS);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventUnits, setEventUnits] = useState<Record<string, EventUnitRow[]>>({});
  const [confirmations, setConfirmations] = useState<Record<string, AgreementConfirmStatus[]>>({});
  const [requests, setRequests] = useState<Record<string, AgreementConfirmRequest[]>>({});
  // Disputes a later request asked about again, newest first, by event.
  const [clearedDisputes, setClearedDisputes] = useState<Record<string, ClearedDispute[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [sendFor, setSendFor] = useState<EventRow | null>(null);

  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState(emptyEvent);
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PreparedEvent | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);

  const [openEvent, setOpenEvent] = useState<string | null>(null);

  const canPost = canPostBuEvent();

  // quiet: refresh in place (the send pop-up stays mounted, with what staff typed).
  const load = useCallback(async (quiet = false) => {
    if (!projectId) return;
    if (!quiet) setIsLoading(true);
    try {
      const { data: proj, error } = await supabase
        .from('builder_projects').select('*').eq('id', projectId).maybeSingle();
      if (error) throw error;
      if (!proj) { toast.error('Project not found'); navigate('/builder-projects'); return; }
      const p = proj as unknown as ProjectRow;
      setProject(p);
      setSettings(await fetchBuilderSettings(p.client_id) as ChargeInclusionSettings);

      const [{ data: unt }, { data: evt }] = await Promise.all([
        supabase.from('builder_units').select('*').eq('project_id', projectId)
          .order('sort_order').order('unit_no'),
        supabase.from('builder_bu_events').select('*').eq('project_id', projectId)
          .order('bu_date', { ascending: false }),
      ]);
      const unitRows = (unt || []) as unknown as UnitRow[];
      setUnits(unitRows);
      const eventRows = (evt || []) as unknown as EventRow[];
      setEvents(eventRows);

      if (unitRows.length) {
        const { data: chg } = await supabase
          .from('builder_unit_charges').select('*').in('unit_id', unitRows.map((u) => u.id));
        const cmap: Record<string, ChargeRow[]> = {};
        ((chg || []) as unknown as ChargeRow[]).forEach((c) => { (cmap[c.unit_id] ||= []).push(c); });
        setCharges(cmap);
      } else setCharges({});

      if (eventRows.length) {
        const { data: eu } = await supabase
          .from('builder_bu_event_units').select('*').in('bu_event_id', eventRows.map((e) => e.id));
        const emap: Record<string, EventUnitRow[]> = {};
        ((eu || []) as unknown as EventUnitRow[]).forEach((r) => { (emap[r.bu_event_id] ||= []).push(r); });
        setEventUnits(emap);

        const ids = eventRows.map((e) => e.id);
        const [cmap, reqs, hist] = await Promise.all([
          fetchAgreementConfirmations(ids), fetchConfirmRequests(ids), fetchClearedDisputes(ids),
        ]);
        setConfirmations(cmap);
        const rmap: Record<string, AgreementConfirmRequest[]> = {};
        reqs.forEach((r) => { (rmap[r.buEventId] ||= []).push(r); });
        setRequests(rmap);
        const hmap: Record<string, ClearedDispute[]> = {};
        hist.forEach((h) => { (hmap[h.buEventId] ||= []).push(h); });
        setClearedDisputes(hmap);
      } else { setEventUnits({}); setConfirmations({}); setRequests({}); setClearedDisputes({}); }
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
    const out: Record<string, { agreementValue: number; rateCode: string; ratePct: number }> = {};
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
      out[u.id] = { agreementValue: cls.gross.gross, rateCode: cls.rateCode, ratePct: cls.ratePct };
    });
    return out;
  }, [units, charges, project, rrep.isRrep, settings]);

  /**
   * Units not already closed against an earlier event, and not flagged as
   * resolved before this project was onboarded here — those were fully
   * taxed under the firm's earlier records and this software has no reliable
   * pre-onboarding history to sweep them against. See
   * docs/BUILDER_GST_POSITIONS.md §14.
   */
  const availableUnits = useMemo(
    () => units.filter((u) => !u.bu_event_id && u.onboarding_status !== 'CLOSED_PRE_ONBOARDING'),
    [units],
  );
  const closedPreOnboardingCount = useMemo(
    () => units.filter((u) => !u.bu_event_id && u.onboarding_status === 'CLOSED_PRE_ONBOARDING').length,
    [units],
  );

  const unitsInScope = useMemo(
    () => (form.scope === 'FULL' ? availableUnits : availableUnits.filter((u) => selectedUnits.has(u.id))),
    [form.scope, availableUnits, selectedUnits],
  );

  const runPreview = useCallback(async () => {
    if (!unitsInScope.length) { setPreview(null); return; }
    setIsPreparing(true);
    try {
      setPreview(await prepareBuEvent({
        buDate: completionDate(form.bu_date, form.first_occupation_date),
        postingPeriod: form.posting_basis === 'BU_MONTH'
          ? periodOfDate(completionDate(form.bu_date, form.first_occupation_date)) : form.posting_period,
        postingBasis: form.posting_basis,
        units: unitsInScope,
        classification,
      }));
    } catch (e) {
      toast.error(`Could not prepare: ${(e as Error).message}`);
    } finally {
      setIsPreparing(false);
    }
  }, [unitsInScope, form.bu_date, form.first_occupation_date, form.posting_basis, form.posting_period, classification]);

  useEffect(() => {
    if (!dialog) return;
    void runPreview();
  }, [dialog, runPreview]);

  const formCompletion = completionDate(form.bu_date, form.first_occupation_date);
  const occupationFirst = formCompletion !== form.bu_date;
  const effectivePeriod = form.posting_basis === 'BU_MONTH'
    ? periodOfDate(formCompletion) : form.posting_period;

  const handleCreate = async () => {
    if (!projectId || !preview) return;
    if (!unitsInScope.length) { toast.error('No units in scope'); return; }
    setIsSaving(true);
    try {
      const { data, error } = await supabase.from('builder_bu_events').insert({
        project_id: projectId,
        // bu_date stays the date every cut-off, FSI and ITC working reads; when
        // occupation came first it is that date, and the permission's own date
        // is kept beside it.
        bu_date: formCompletion,
        ...(form.first_occupation_date ? {
          first_occupation_date: form.first_occupation_date,
          bu_permission_date: form.bu_date,
        } : {}),
        bu_ref_no: form.bu_ref_no.trim() || null,
        scope: form.scope,
        discovered_on: form.discovered_on || null,
        posting_basis: form.posting_basis,
        posting_period: effectivePeriod,
        status: 'PREPARED',
        notes: form.notes.trim() || null,
        created_by: user?.id ?? null,
      }).select('id').single();
      if (error) throw error;

      const { error: uErr } = await supabase.from('builder_bu_event_units').insert(
        preview.working.units.map((w) => ({
          bu_event_id: data.id,
          unit_id: w.unitId,
          cut_off_date: w.cutOffDate,
          cut_off_source: w.cutOffSource,
          booked_at_cutoff: w.bookedAtCutOff,
          booking_id: w.bookingId,
          unit_type: w.unitType,
          carpet_area_sqm: w.carpetAreaSqM,
          rate_code: w.rateCode,
          rate_pct: w.ratePct,
          agreement_value: w.agreementValue,
          value_taxed_upto_opening: w.valueTaxedUptoOpening,
          invoiced_before: w.invoicedBefore,
          open_advance_before: w.openAdvanceBefore,
          received_upto_cutoff: w.receivedUptoCutOff,
          differential_value: w.differentialValue,
          differential_taxable_value: w.differentialTaxableValue,
          differential_cgst: w.differentialCgst,
          differential_sgst: w.differentialSgst,
          interest_days: w.interestDays,
          interest_amount: w.interestAmount,
          tie_out_diff: w.tieOutDiff,
          subsumed_receipt_count: w.subsumedReceiptCount,
        })),
      );
      if (uErr) throw uErr;

      toast.success('BU event prepared — review the working, then post it');
      setDialog(false);
      setOpenEvent(data.id);
      await load();
    } catch (e) {
      toast.error(`Could not create: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  /** Every taxable unit's agreement value must be client-confirmed before an
   *  event can post — a client who later changes it without telling the firm
   *  can never leave the firm exposed. The units still outstanding (pending,
   *  disputed or never sent) go in one e-mail to whoever staff type in. */
  const confirmCandidates = (ev: EventRow): ConfirmCandidate[] => {
    const cf = new Map((confirmations[ev.id] || []).map((c) => [c.unitId, c]));
    const order = new Map(units.map((u, i) => [u.id, i]));
    return (eventUnits[ev.id] || [])
      .filter((r) => r.booked_at_cutoff && !isAgreementCleared(cf.get(r.unit_id)?.status))
      .sort((a, b) => (order.get(a.unit_id) ?? 0) - (order.get(b.unit_id) ?? 0))
      .map((r) => {
        const c = cf.get(r.unit_id);
        return {
          unitId: r.unit_id, unitNo: units.find((x) => x.id === r.unit_id)?.unit_no || '',
          agreementValue: Number(r.agreement_value) || 0,
          cutOffSource: r.cut_off_source, cutOffDate: r.cut_off_date,
          status: c?.status || 'NOT_SENT', disputeNotes: c?.disputeNotes ?? null, respondedByName: c?.respondedByName ?? null,
          respondedByEmail: c?.respondedByEmail ?? null, respondedAt: c?.respondedAt ?? null,
          requestId: c?.requestId ?? null, legacyLink: c?.legacyLink ?? false, legacy: c?.legacy ?? null,
        };
      });
  };

  /**
   * Accept agreement values without the client's confirmation (superadmin,
   * GST Manager, or the override_bu_agreement permission). The superadmin may
   * leave the reason blank; everyone else gives one, which is kept on the row.
   */
  const handleAcceptAgreement = async (ev: EventRow, unitIds: string[]) => {
    if (!user?.id || !unitIds.length) return;
    const isSuperadmin = user.role === 'superadmin';
    const what = unitIds.length === 1
      ? `unit ${units.find((u) => u.id === unitIds[0])?.unit_no || ''}`
      : `${unitIds.length} units`;
    const reason = window.prompt(
      `Accept the agreement value for ${what} without the client's confirmation?\n\n`
      + (isSuperadmin
        ? 'Reason (optional for the superadmin):'
        : 'Reason (required, at least 10 characters) — e.g. "Client confirmed on call 13/10, mail to follow":'),
      '',
    );
    if (reason === null) return;
    if (!isSuperadmin && reason.trim().length < 10) {
      toast.error('Give a reason of at least 10 characters.');
      return;
    }
    setIsSaving(true);
    try {
      for (const unitId of unitIds) {
        await overrideAgreementValue({ buEventId: ev.id, unitId, actorId: user.id, reason: reason.trim() });
      }
      toast.success(`Agreement value accepted for ${what} — the event can be posted`);
      await load();
    } catch (e) {
      toast.error(`Could not accept: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePost = async (ev: EventRow) => {
    if (!project) return;
    const rows0 = eventUnits[ev.id] || [];
    const taxable0 = rows0.filter((r) => r.booked_at_cutoff);
    // Every taxable unit needs the client's confirmation or the firm's
    // acceptance — including units whose request was never sent, which the
    // DB gate (rows only) does not see.
    const cf0 = new Map((confirmations[ev.id] || []).map((c) => [c.unitId, c.status]));
    const uncleared = taxable0.filter((r) => !isAgreementCleared(cf0.get(r.unit_id)));
    if (uncleared.length) {
      toast.error(
        `Blocked: ${uncleared.length} taxable unit(s) have no confirmed or accepted agreement value. `
        + (canOverrideBuAgreement()
          ? 'Wait for the client, or use Accept on the unit (or Accept all outstanding).'
          : 'Wait for the client, or ask someone with the "Accept BU agreement value" permission.'),
      );
      return;
    }
    if (taxable0.length && await isBuAgreementConfirmationBlocked(project.client_id, ev.posting_period)) {
      toast.error(
        'Blocked: one or more taxable units\' agreement value has not been confirmed by the client yet. '
        + 'Send (or re-send) confirmation requests and wait for every unit to come back Confirmed.',
      );
      return;
    }
    if (!window.confirm(
      `Post the BU differential for ${prettyPeriodLabel(ev.posting_period)}? `
      + 'This raises a BU differential invoice per taxable unit, adjusts their open advances in '
      + 'Table 11B, and subsumes any receipt inside the BU month.',
    )) return;
    setIsSaving(true);
    try {
      const rows = eventUnits[ev.id] || [];
      const scopeUnits = units.filter((u) => rows.some((r) => r.unit_id === u.id));
      const prepared = await prepareBuEvent({
        buDate: ev.bu_date,
        postingPeriod: ev.posting_period,
        postingBasis: ev.posting_basis,
        units: scopeUnits,
        classification,
      });
      // Post only the figures that were confirmed or accepted: if a unit's
      // agreement value or differential moved since the event was prepared
      // (a receipt, invoice or opening balance changed), stop and re-prepare.
      const moved = prepared.working.taxable.filter((wu) => {
        const stored = rows.find((r) => r.unit_id === wu.unitId);
        return !stored
          || Math.abs(Number(stored.agreement_value) - wu.agreementValue) > 1
          || Math.abs(Number(stored.differential_value) - wu.differentialValue) > 1;
      });
      if (moved.length) {
        const u = moved[0];
        const stored = rows.find((r) => r.unit_id === u.unitId);
        toast.error(
          `The figures changed since this event was prepared (unit ${u.unitNo}: differential `
          + `${formatINR(Number(stored?.differential_value || 0))} then, ${formatINR(u.differentialValue)} now`
          + `${moved.length > 1 ? `, and ${moved.length - 1} more` : ''}). Delete the event and prepare it again `
          + 'so the confirmed figures match what posts.',
        );
        return;
      }
      const res = await postBuEvent({
        eventId: ev.id,
        projectId: projectId!,
        prepared,
        postingPeriod: ev.posting_period,
        postingDate: ev.posting_basis === 'BU_MONTH' ? ev.bu_date : today(),
        docSeries: project?.doc_series_prefix ?? null,
        userId: user?.id ?? null,
      });
      toast.success(
        `Posted: ${res.invoicesCreated} differential invoice(s), ${res.adjustmentsCreated} advance `
        + `adjustment(s), ${res.openingAdjustmentsCreated} opening balance adjustment(s), `
        + `${res.receiptsSubsumed} receipt(s) subsumed`,
      );
      await load();
    } catch (e) {
      toast.error(`Could not post: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnpost = async (ev: EventRow) => {
    if (!window.confirm(
      'Unpost this event? The differential invoices and their advance adjustments are deleted, and '
      + 'subsumed receipts go back to posting on their own account.',
    )) return;
    setIsSaving(true);
    try {
      await unpostBuEvent(ev.id);
      toast.success('Event unposted');
      await load();
    } catch (e) {
      toast.error(`Could not unpost: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (ev: EventRow) => {
    if (ev.status === 'POSTED') { toast.error('Unpost the event before deleting it'); return; }
    if (!window.confirm('Delete this BU event and its working?')) return;
    const { error } = await supabase.from('builder_bu_events').delete().eq('id', ev.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Event deleted');
    await load();
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading BU events…
        </CardContent>
      </Card>
    );
  }
  if (!project) return null;

  return (
    <div className={WS_PAGE}>
      <BuilderSectionHeader
        compact
        embedded={embedded}
        title={embedded ? 'BU Events' : `${project.name} — BU Events`}
        subtitle="The whole balance on every unit booked before its cut-off becomes taxable in the BU month"
        icon={<CalendarCheck />}
        actions={
          <>
            {!embedded && (
              <Button variant="outline" size="sm" className={WS_BTN} onClick={() => navigate(`/builder-projects/${projectId}`)}>
                <ArrowLeft className="h-3.5 w-3.5" /> Project
              </Button>
            )}
            {canPost && availableUnits.length > 0 && (
              <Button size="sm" className={WS_BTN} onClick={() => { setForm(emptyEvent); setSelectedUnits(new Set()); setDialog(true); }}>
                <Plus className="h-3.5 w-3.5" /> New BU event
              </Button>
            )}
          </>
        }
      />

      <Note>
        A unit's cut-off is the <strong>earlier</strong> of the completion date (BU, or first occupation if that came first) and its dastavej date. Units
        booked before it are taxed on their entire balance; units unbooked at cut-off fall under
        Schedule III and are omitted from GSTR-1 and 3B altogether, feeding the TDR/FSI working instead.
        {availableUnits.length < units.length && (
          <>
            {' '}{units.filter((u) => !!u.bu_event_id).length} of {units.length} units are already closed
            against an earlier event
            {closedPreOnboardingCount > 0 && (
              <>, and {closedPreOnboardingCount} {closedPreOnboardingCount === 1 ? 'is' : 'are'} flagged
              closed before onboarding — resolved under the firm's earlier records, so this software
              never sweeps them</>
            )}.
          </>
        )}
      </Note>

      {events.length === 0 ? (
        <Card>
          <CardContent className="px-4 py-8 text-center text-sm text-muted-foreground">
            <CalendarCheck className="mx-auto mb-2 h-6 w-6 opacity-40" />
            <p className="font-medium text-foreground">No BU events yet for this project.</p>
            <p className="mx-auto mt-1 max-w-lg text-xs">
              When the BU permission arrives (or the project is occupied first), record it here. Every unit booked
              before its cut-off is then taxed on its whole balance, after the client confirms each agreement value.
              A unit's own dastavej closes it on its own, from the Ledger.
            </p>
            {canPost && availableUnits.length > 0 && (
              <Button size="sm" className={cn(WS_BTN, 'mt-3')} onClick={() => { setForm(emptyEvent); setSelectedUnits(new Set()); setDialog(true); }}>
                <Plus className="h-3.5 w-3.5" /> New BU event
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        events.map((ev) => {
          const rows = eventUnits[ev.id] || [];
          const taxable = rows.filter((r) => r.booked_at_cutoff);
          const unbooked = rows.filter((r) => !r.booked_at_cutoff);
          const tot = taxable.reduce((a, r) => ({
            diff: a.diff + Number(r.differential_value || 0),
            taxable: a.taxable + Number(r.differential_taxable_value || 0),
            cgst: a.cgst + Number(r.differential_cgst || 0),
            sgst: a.sgst + Number(r.differential_sgst || 0),
            interest: a.interest + Number(r.interest_amount || 0),
          }), { diff: 0, taxable: 0, cgst: 0, sgst: 0, interest: 0 });
          const isOpen = openEvent === ev.id;
          const cfRows = confirmations[ev.id] || [];
          const cfByUnit = new Map(cfRows.map((c) => [c.unitId, c]));
          const cfConfirmed = taxable.filter((r) => isAgreementCleared(cfByUnit.get(r.unit_id)?.status)).length;
          const cfOutstanding = taxable.length - cfConfirmed;
          const evRequests = requests[ev.id] || [];
          const lastReq = evRequests[0] || null;
          const unitNoOf = (id: string) => units.find((u) => u.id === id)?.unit_no || '';
          // Every other request whose e-mail has not gone out and that still
          // holds units waiting on the client (round 4: only the last one was
          // shown, so a unit whose only e-mail failed looked asked).
          const notOut = requestsNotOut(evRequests, cfRows).filter((x) => x.request.id !== lastReq?.id);
          // Who answered on the page, grouped: "Confirmed by X (x@…) on 21 Oct 2026: A-101, A-102".
          const answerMap = new Map<string, { label: string; disputed: boolean; units: string[] }>();
          rows.forEach((r) => {
            const label = answeredBy(cfByUnit.get(r.unit_id));
            if (!label) return;
            const entry = answerMap.get(label) || { label, disputed: label.startsWith('Disputed'), units: [] };
            entry.units.push(units.find((u) => u.id === r.unit_id)?.unit_no || '');
            answerMap.set(label, entry);
          });
          const answers = [...answerMap.values()];

          return (
            <SectionCard
              key={ev.id}
              title={(
                <span className="flex flex-wrap items-center gap-1.5">
                  {rows.length === 1 && rows[0].cut_off_source === 'DASTAVEJ'
                    ? 'Dastavej'
                    : ev.bu_permission_date && ev.bu_permission_date !== ev.bu_date ? 'First occupation' : 'BU'} dated {ev.bu_date}
                  {ev.bu_permission_date && ev.bu_permission_date !== ev.bu_date && (
                    <span className="font-normal text-muted-foreground">· BU permission {ev.bu_permission_date}</span>
                  )}
                  {ev.bu_ref_no && <span className="font-normal text-muted-foreground">· {ev.bu_ref_no}</span>}
                  <Badge variant={ev.status === 'POSTED' ? 'success' : 'warning'} className="text-[10px] font-medium">
                    {ev.status}
                  </Badge>
                  {ev.status !== 'POSTED' && taxable.length > 0 && (
                    <Badge variant={cfOutstanding === 0 ? 'success' : 'warning'} className="text-[10px] font-medium">
                      Agreement value: {cfConfirmed}/{taxable.length} confirmed
                    </Badge>
                  )}
                </span>
              )}
              description={(
                <>
                  {ev.scope === 'FULL' ? 'Full project' : `${rows.length} selected unit(s)`}
                  {' · posts to '}{prettyPeriodLabel(ev.posting_period)}
                  {' · '}{POSTING_BASIS_LABEL[ev.posting_basis]}
                </>
              )}
              actions={(
                <>
                  <Button variant="outline" size="sm" className={WS_BTN} onClick={() => setOpenEvent(isOpen ? null : ev.id)}>
                    {isOpen ? 'Hide working' : 'Show working'}
                  </Button>
                  {canPost && ev.status !== 'POSTED' && cfOutstanding > 0 && (
                    <Button
                      variant="outline" size="sm" className={WS_BTN}
                      onClick={() => setSendFor(ev)}
                      title="Type the To and CC addresses, choose the units, send one e-mail"
                    >
                      <Send className="h-3.5 w-3.5" />
                      {cfRows.length ? 'Re-send confirmations' : 'Send confirmation requests'}
                    </Button>
                  )}
                  {ev.status !== 'POSTED' && cfOutstanding > 0 && canOverrideBuAgreement() && (
                    <Button
                      variant="outline" size="sm" className={WS_BTN} disabled={isSaving}
                      onClick={() => void handleAcceptAgreement(
                        ev,
                        taxable.filter((r) => !isAgreementCleared(cfByUnit.get(r.unit_id)?.status)).map((r) => r.unit_id),
                      )}
                      title="Accept the agreement value without the client's confirmation"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Accept all outstanding ({cfOutstanding})
                    </Button>
                  )}
                  {canPost && ev.status !== 'POSTED' && (
                    <>
                      <Button
                        size="sm" className={WS_BTN} onClick={() => void handlePost(ev)} disabled={isSaving}
                        title={cfOutstanding > 0 ? `${cfOutstanding} unit(s) still awaiting client confirmation` : undefined}
                      >
                        <Send className="h-3.5 w-3.5" /> Post
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(ev)} aria-label="Delete event">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </>
                  )}
                  {canPost && ev.status === 'POSTED' && (
                    <Button variant="outline" size="sm" className={WS_BTN} onClick={() => handleUnpost(ev)} disabled={isSaving}>
                      <Undo2 className="h-3.5 w-3.5" /> Unpost
                    </Button>
                  )}
                </>
              )}
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                <KpiTile label="Taxable units" value={taxable.length} />
                <KpiTile label="Unbooked (Sch. III)" value={unbooked.length} />
                <KpiTile label="Differential value" value={formatINR(tot.diff)} />
                <KpiTile label="Taxable value" value={formatINR(tot.taxable)} />
                <KpiTile label="CGST + SGST" value={formatINR(tot.cgst + tot.sgst)} />
                <KpiTile label="Interest u/s 50" value={tot.interest > 0 ? formatINR(tot.interest) : '—'} tone={tot.interest > 0 ? 'warn' : 'neutral'} />
              </div>

              {(lastReq || answers.length > 0) && (
                <div className="space-y-0.5 text-xs text-muted-foreground">
                  {lastReq && (
                    <p>
                      Last request {shortWhen(lastReq.sentAt || lastReq.createdAt)} for {lastReq.unitIds.length} unit
                      {lastReq.unitIds.length === 1 ? '' : 's'} to {lastReq.to.join(', ')}
                      {lastReq.cc.length > 0 && <> · CC {lastReq.cc.join(', ')}</>}
                      {lastReq.mailStatus && (
                        <span className={cn(mailOutcome(lastReq.mailStatus) === 'failed' && 'text-destructive')}>
                          {' '}· {mailOutcome(lastReq.mailStatus) === 'waiting'
                            ? 'e-mail queued, not sent yet'
                            : `e-mail ${lastReq.mailStatus}`}
                          {lastReq.mailStatus === 'failed' && lastReq.mailError ? `: ${lastReq.mailError.trim().replace(/[.\s]+$/, '')}` : ''}
                          {mailOutcome(lastReq.mailStatus) === 'failed'
                            ? `. ${failedMailWords(lastReq.earlierLink, lastReq.unitIds.map(unitNoOf), lastReq.earlierUnits?.map(unitNoOf))}` : ''}
                        </span>
                      )}
                    </p>
                  )}
                  {notOut.map(({ request: rq, unitIds }) => {
                    const nos = unitIds.map(unitNoOf);
                    const failed = mailOutcome(rq.mailStatus) === 'failed';
                    // Of the units still waiting on it, those an earlier link reached (as the send recorded it).
                    const earlierNos = rq.earlierUnits ? rq.earlierUnits.filter((u) => unitIds.includes(u)).map(unitNoOf) : null;
                    const what = failed
                      ? `e-mail ${rq.mailStatus}${rq.mailError ? `: ${rq.mailError.trim().replace(/[.\s]+$/, '')}` : ''}`
                      : 'e-mail queued, not sent yet';
                    return (
                      <p key={rq.id} className={failed ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'}>
                        {`Request ${shortWhen(rq.sentAt || rq.createdAt)} to ${rq.to.join(', ')}: ${what}. `
                          + `Waiting on it: ${nos.join(', ')}.${failed ? ` ${failedMailWords(rq.earlierLink, nos, earlierNos)}` : ''}`}
                      </p>
                    );
                  })}
                  {answers.map((a) => (
                    <p key={a.label} className={cn(a.disputed && 'text-destructive')}>
                      {a.label}: {a.units.join(', ')}
                    </p>
                  ))}
                </div>
              )}

              {ev.status === 'POSTED' && (
                <Note tone="warn">
                  These units are taxed in full. GST law gives no bad-debt relief, so if a booking
                  cancels the tax is recoverable only through a credit note u/s 34 — deadline{' '}
                  <strong>{creditNoteDeadline(ev.posting_period)}</strong>.
                </Note>
              )}

              {isOpen && (
                <Table className={B_TABLE} containerClassName={cn(WS_TABLE_WRAP, 'max-h-[70vh]')}>
                  <TableHeader>
                    <TableRow className={B_TR_HEAD}>
                      <TableHead className={B_TH}>Unit</TableHead>
                      <TableHead className={B_TH}>Cut-off</TableHead>
                      <TableHead className={B_TH}>Status at cut-off</TableHead>
                      <TableHead className={B_TH_NUM}>Rate</TableHead>
                      <TableHead className={B_TH_NUM}>Agreement</TableHead>
                      <TableHead className={B_TH}>Confirmed?</TableHead>
                      <TableHead className={B_TH_NUM}>Taxed to opening</TableHead>
                      <TableHead className={B_TH_NUM}>Differential</TableHead>
                      <TableHead className={B_TH_NUM}>Taxable value</TableHead>
                      <TableHead className={B_TH_NUM}>CGST</TableHead>
                      <TableHead className={B_TH_NUM}>SGST</TableHead>
                      <TableHead className={B_TH_NUM}>Interest</TableHead>
                      <TableHead className={B_TH_NUM}>Tie-out</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const u = units.find((x) => x.id === r.unit_id);
                      return (
                        <TableRow key={r.id} className={cn(B_TR, !r.booked_at_cutoff && 'opacity-60')}>
                          <TableCell className={cn(B_TD, 'font-medium')}>{u?.unit_no || '—'}</TableCell>
                          <TableCell className={cn(B_TD, 'whitespace-nowrap')}>
                            {r.cut_off_date}
                            <span className="block text-[11px] text-muted-foreground">
                              via {r.cut_off_source === 'DASTAVEJ' ? 'dastavej' : 'BU'}
                            </span>
                          </TableCell>
                          <TableCell className={B_TD}>
                            {r.booked_at_cutoff ? (
                              <Badge variant="success" className="text-[10px] font-medium">Booked</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] font-medium">Unbooked — Sch. III</Badge>
                            )}
                          </TableCell>
                          <TableCell className={B_TD_NUM}>{r.rate_pct}%</TableCell>
                          <TableCell className={B_TD_NUM}>{formatINR(r.agreement_value)}</TableCell>
                          <TableCell className={B_TD}>
                            {!r.booked_at_cutoff ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (() => {
                              const cf = cfByUnit.get(r.unit_id);
                              const status = cf?.status || 'NOT_SENT';
                              // The latest dispute a later request asked about again.
                              const earlier = (clearedDisputes[ev.id] || []).find((h) => h.unitId === r.unit_id);
                              const variant = status === 'CONFIRMED' || status === 'OVERRIDDEN'
                                ? 'success'
                                : status === 'DISPUTED'
                                  ? 'destructive'
                                  : status === 'PENDING'
                                    ? 'warning'
                                    : 'secondary';
                              return (
                                <>
                                  <Badge variant={variant} className="text-[10px] font-medium">
                                    {status === 'NOT_SENT' ? 'Not sent' : status === 'OVERRIDDEN' ? 'Accepted by firm' : status}
                                  </Badge>
                                  {answeredBy(cf) && (
                                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{answeredBy(cf)}</span>
                                  )}
                                  {status === 'DISPUTED' && cf?.disputeNotes && (
                                    <span className="mt-0.5 block text-[11px] text-muted-foreground" title={cf.disputeNotes}>
                                      {cf.disputeNotes}
                                    </span>
                                  )}
                                  {status === 'PENDING' && (() => {
                                    // Asked only once its e-mail is out (round 4), a per-unit e-mail
                                    // of before 21 Oct 2026 too (its outbox status: finding of 21 Oct 2026).
                                    const ask = unitAsk(r.unit_id, cf, evRequests);
                                    if (!ask) return null;
                                    if (ask.state === 'asked') {
                                      return <span className="mt-0.5 block text-[11px] text-muted-foreground">Asked {shortDate(ask.at)}</span>;
                                    }
                                    const still = ask.earlier?.kind === 'request'
                                      ? ` The link e-mailed ${shortDate(ask.earlier.at)} still takes answers.`
                                      : ask.earlier?.kind === 'legacy'
                                        ? ' The per-unit link e-mailed before still takes answers.'
                                        : ask.state === 'failed' ? ' No link has reached the client: not asked yet.' : '';
                                    return (
                                      <span className={cn('mt-0.5 block text-[11px]', ask.state === 'failed'
                                        ? 'text-destructive' : 'text-amber-700 dark:text-amber-400')}>
                                        {ask.state === 'failed'
                                          ? `E-mail of ${shortDate(ask.at)} failed${ask.error ? `: ${ask.error}` : ''}.`
                                          : `E-mail of ${shortDate(ask.at)} queued, not sent yet.`}
                                        {still}
                                      </span>
                                    );
                                  })()}
                                  {earlier && (
                                    <span
                                      className="mt-0.5 block text-[11px] text-muted-foreground"
                                      title={earlier.notes || undefined}
                                    >
                                      Earlier disputed{earlier.respondedByName ? ` by ${earlier.respondedByName}` : ''}
                                      {earlier.respondedByEmail ? ` (${earlier.respondedByEmail})` : ''}
                                      {earlier.respondedAt ? ` on ${shortDate(earlier.respondedAt)}` : ''}
                                      {earlier.notes ? `: ${earlier.notes}` : ''}. Asked again {shortDate(earlier.clearedAt)}.
                                    </span>
                                  )}
                                  {status === 'OVERRIDDEN' && cf?.overrideReason && (
                                    <span className="mt-0.5 block text-[11px] text-muted-foreground" title={cf.overrideReason}>
                                      {cf.overrideReason}
                                    </span>
                                  )}
                                  {ev.status !== 'POSTED' && !isAgreementCleared(status) && canOverrideBuAgreement() && (
                                    <button
                                      type="button" disabled={isSaving}
                                      className="mt-0.5 block text-[11px] font-medium text-primary hover:underline"
                                      onClick={() => void handleAcceptAgreement(ev, [r.unit_id])}
                                    >
                                      Accept without confirmation
                                    </button>
                                  )}
                                </>
                              );
                            })()}
                          </TableCell>
                          <TableCell className={B_TD_NUM}>{formatINR(r.value_taxed_upto_opening)}</TableCell>
                          <TableCell className={cn(B_TD_NUM, 'font-medium')}>
                            {r.booked_at_cutoff ? formatINR(r.differential_value) : '—'}
                          </TableCell>
                          <TableCell className={B_TD_NUM}>
                            {r.booked_at_cutoff ? formatINR(r.differential_taxable_value) : '—'}
                          </TableCell>
                          <TableCell className={B_TD_NUM}>
                            {r.booked_at_cutoff ? formatINR(r.differential_cgst) : '—'}
                          </TableCell>
                          <TableCell className={B_TD_NUM}>
                            {r.booked_at_cutoff ? formatINR(r.differential_sgst) : '—'}
                          </TableCell>
                          <TableCell className={B_TD_NUM}>
                            {r.interest_amount > 0 ? (
                              <>
                                {formatINR(r.interest_amount)}
                                <span className="block text-[11px] text-muted-foreground">{r.interest_days}d</span>
                              </>
                            ) : '—'}
                          </TableCell>
                          <TableCell className={B_TD_NUM}>
                            {Math.abs(Number(r.tie_out_diff) || 0) < 1 ? (
                              <span className="text-muted-foreground">OK</span>
                            ) : (
                              <span className="text-destructive-strong">{formatINR(r.tie_out_diff)}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </SectionCard>
          );
        })
      )}

      <SendAgreementConfirmDialog
        open={!!sendFor}
        onOpenChange={(v) => { if (!v) setSendFor(null); }}
        clientId={project.client_id}
        projectName={project.name}
        event={sendFor ? {
          id: sendFor.id,
          buDate: sendFor.bu_date,
          dastavej: (eventUnits[sendFor.id] || []).length === 1 && eventUnits[sendFor.id][0].cut_off_source === 'DASTAVEJ',
        } : null}
        candidates={sendFor ? confirmCandidates(sendFor) : []}
        lastRequest={sendFor ? (requests[sendFor.id] || [])[0] || null : null}
        requests={sendFor ? requests[sendFor.id] || [] : []}
        onSent={() => void load(true)}
      />

      {/* ── New event dialog ─────────────────────────────────────────────── */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New BU event</DialogTitle>
            <DialogDescription>
              The BU date is the date printed on the permission, not the date it reached the firm.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="e-date">BU date (as printed)</Label>
              <Input
                id="e-date" type="date" value={form.bu_date}
                onChange={(e) => setForm({ ...form, bu_date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="e-occ">First occupation date (only if before the BU)</Label>
              <Input
                id="e-occ" type="date" value={form.first_occupation_date}
                onChange={(e) => setForm({ ...form, first_occupation_date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="e-ref">BU permission no.</Label>
              <Input
                id="e-ref" value={form.bu_ref_no}
                onChange={(e) => setForm({ ...form, bu_ref_no: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="e-disc">Received by the firm on</Label>
              <Input
                id="e-disc" type="date" value={form.discovered_on}
                onChange={(e) => setForm({ ...form, discovered_on: e.target.value })}
              />
            </div>
            <div>
              <Label>Scope</Label>
              <Select
                value={form.scope}
                onValueChange={(v) => setForm({ ...form, scope: v as 'FULL' | 'UNITS' })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FULL">Full project — every unit not already covered</SelectItem>
                  <SelectItem value="UNITS">Selected units</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Posting basis</Label>
              <Select
                value={form.posting_basis}
                onValueChange={(v) => setForm({ ...form, posting_basis: v as PostingBasis })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(POSTING_BASIS_LABEL) as PostingBasis[]).map((k) => (
                    <SelectItem key={k} value={k}>{POSTING_BASIS_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.posting_basis !== 'BU_MONTH' && (
              <div>
                <Label htmlFor="e-period">Posting period (MM/YYYY)</Label>
                <Input
                  id="e-period" placeholder="MM/YYYY" value={form.posting_period}
                  onChange={(e) => setForm({ ...form, posting_period: e.target.value })}
                />
              </div>
            )}
            <div className={form.posting_basis === 'BU_MONTH' ? 'sm:col-span-2' : ''}>
              <Label htmlFor="e-notes">Notes</Label>
              <Input
                id="e-notes" value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          {occupationFirst && (
            <Note tone="position">
              The project was occupied on {formCompletion}, before the BU permission of {form.bu_date}. Completion
              is the <strong>earlier</strong> of the two (Schedule II para 5(b); Notification 06/2019-CT(R)), so every
              unit's cut-off, the TDR/FSI time of supply and the ITC reversal year run from {formCompletion}.
            </Note>
          )}

          {form.posting_basis === 'BU_MONTH' && (
            <Note tone="warn">
              Posting into {prettyPeriodLabel(periodOfDate(formCompletion))}. If that return is already
              filed it cannot be revised — the liability would have to be declared in a later return
              instead, which is what the interest basis does.
            </Note>
          )}

          {form.scope === 'UNITS' && (
            <div>
              <Label className="mb-2 block">Units in this event ({selectedUnits.size} selected)</Label>
              <div className="max-h-48 overflow-y-auto rounded border p-2 space-y-1">
                {availableUnits.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                    <Checkbox
                      checked={selectedUnits.has(u.id)}
                      onCheckedChange={(c) => setSelectedUnits((prev) => {
                        const next = new Set(prev);
                        if (c) next.add(u.id); else next.delete(u.id);
                        return next;
                      })}
                    />
                    <span className="font-medium">{u.unit_no}</span>
                    <span className="text-muted-foreground">
                      {u.unit_type} · {formatSqM(u.carpet_area_sqm)}
                      {u.dastavej_date ? ` · dastavej ${u.dastavej_date}` : ''}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Live working preview */}
          <div className="rounded-lg border p-3 bg-muted/30">
            {isPreparing ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Computing the working…
              </div>
            ) : !preview ? (
              <p className="text-sm text-muted-foreground">Select units to see the working.</p>
            ) : (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-4 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Taxable units</p>
                    <p className="font-semibold">{preview.working.taxable.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Unbooked (Sch. III)</p>
                    <p className="font-semibold">{preview.working.unbooked.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Differential</p>
                    <p className="font-semibold">{formatINR(preview.working.totals.differentialValue)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">CGST + SGST</p>
                    <p className="font-semibold">
                      {formatINR(preview.working.totals.cgst + preview.working.totals.sgst)}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Posts as {formatINR(preview.working.totals.invoiceValue)} to Table 7, less{' '}
                  {formatINR(preview.working.totals.advanceToAdjust)} adjusted in Table 11B — netting to
                  the differential above in 3B Table 3.1(a).
                  {preview.working.totals.interest > 0 && (
                    <> Interest u/s 50: {formatINR(preview.working.totals.interest)}.</>
                  )}
                </p>
                {preview.working.unbooked.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Unbooked at cut-off: {formatSqM(preview.working.unbookedResidentialCarpet)} residential
                    carpet worth {formatINR(preview.working.unbookedResidentialValue)} — omitted from the
                    returns, and the base for the TDR/FSI proportion.
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={isSaving || isPreparing || !preview}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Prepare event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BuilderBuEventsPage;
