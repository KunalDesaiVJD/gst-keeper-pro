import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  ArrowLeft, Loader2, Plus, CalendarCheck, AlertTriangle, Send, Undo2, Trash2, Info,
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
  isBuAgreementConfirmationBlocked, requestAgreementConfirmations,
  type AgreementConfirmStatus,
} from '@/lib/builderAgreementConfirmData';

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
const currentPeriod = () => {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const emptyEvent = {
  bu_date: today(),
  bu_ref_no: '',
  scope: 'FULL' as 'FULL' | 'UNITS',
  discovered_on: today(),
  posting_basis: 'DISCOVERY_WITH_INTEREST' as PostingBasis,
  posting_period: currentPeriod(),
  notes: '',
};

const BuilderBuEventsPage: React.FC = () => {
  const projectId = useBuilderProjectId();
  const embedded = useBuilderEmbedded();
  const navigate = useNavigate();
  const { canPostBuEvent, user } = useAuth();

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [charges, setCharges] = useState<Record<string, ChargeRow[]>>({});
  const [settings, setSettings] = useState<ChargeInclusionSettings>(DEFAULT_CHARGE_INCLUSIONS);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventUnits, setEventUnits] = useState<Record<string, EventUnitRow[]>>({});
  const [confirmations, setConfirmations] = useState<Record<string, AgreementConfirmStatus[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingConfirm, setIsSendingConfirm] = useState<string | null>(null);

  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState(emptyEvent);
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PreparedEvent | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);

  const [openEvent, setOpenEvent] = useState<string | null>(null);

  const canPost = canPostBuEvent();

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

        const { data: cf } = await supabase
          .from('builder_bu_agreement_confirmations').select('bu_event_id, unit_id, status, dispute_notes')
          .in('bu_event_id', eventRows.map((e) => e.id));
        type CfRow = { bu_event_id: string; unit_id: string; status: string; dispute_notes: string | null };
        const cmap: Record<string, AgreementConfirmStatus[]> = {};
        ((cf || []) as unknown as CfRow[]).forEach((r) => {
          (cmap[r.bu_event_id] ||= []).push({
            unitId: r.unit_id, status: r.status as AgreementConfirmStatus['status'], disputeNotes: r.dispute_notes,
          });
        });
        setConfirmations(cmap);
      } else { setEventUnits({}); setConfirmations({}); }
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
        buDate: form.bu_date,
        postingPeriod: form.posting_basis === 'BU_MONTH' ? periodOfDate(form.bu_date) : form.posting_period,
        postingBasis: form.posting_basis,
        units: unitsInScope,
        classification,
      }));
    } catch (e) {
      toast.error(`Could not prepare: ${(e as Error).message}`);
    } finally {
      setIsPreparing(false);
    }
  }, [unitsInScope, form.bu_date, form.posting_basis, form.posting_period, classification]);

  useEffect(() => {
    if (!dialog) return;
    void runPreview();
  }, [dialog, runPreview]);

  const effectivePeriod = form.posting_basis === 'BU_MONTH'
    ? periodOfDate(form.bu_date) : form.posting_period;

  const handleCreate = async () => {
    if (!projectId || !preview) return;
    if (!unitsInScope.length) { toast.error('No units in scope'); return; }
    setIsSaving(true);
    try {
      const { data, error } = await supabase.from('builder_bu_events').insert({
        project_id: projectId,
        bu_date: form.bu_date,
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
   *  can never leave the firm exposed. */
  const handleSendConfirmations = async (ev: EventRow) => {
    if (!project) return;
    const rows = (eventUnits[ev.id] || []).filter((r) => r.booked_at_cutoff);
    if (!rows.length) return;
    setIsSendingConfirm(ev.id);
    try {
      const res = await requestAgreementConfirmations({
        buEventId: ev.id,
        clientId: project.client_id,
        projectName: project.name,
        buDate: ev.bu_date,
        staffName: user?.firstName ?? null,
        userId: user?.id ?? null,
        units: rows.map((r) => ({
          unitId: r.unit_id, unitNo: units.find((u) => u.id === r.unit_id)?.unit_no || '',
          agreementValue: r.agreement_value,
        })),
      });
      if (res.ok) toast.success(`Confirmation request sent for ${res.sent} unit(s)`);
      else toast.error(res.reason || 'Could not send confirmation requests');
      await load();
    } catch (e) {
      toast.error(`Could not send: ${(e as Error).message}`);
    } finally {
      setIsSendingConfirm(null);
    }
  };

  const handlePost = async (ev: EventRow) => {
    if (!project) return;
    const rows0 = eventUnits[ev.id] || [];
    const taxable0 = rows0.filter((r) => r.booked_at_cutoff);
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
        + `adjustment(s), ${res.receiptsSubsumed} receipt(s) subsumed`,
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
      <div className="flex items-center gap-2 text-muted-foreground text-sm p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading BU events…
      </div>
    );
  }
  if (!project) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${project.name} — BU Events`}
        subtitle="The whole balance on every unit booked before its cut-off becomes taxable in the BU month"
        icon={<CalendarCheck className="h-5 w-5" />}
        actions={
          <div className="flex gap-2">
            {!embedded && (
              <Button variant="outline" onClick={() => navigate(`/builder-projects/${projectId}`)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Project
              </Button>
            )}
            {canPost && availableUnits.length > 0 && (
              <Button onClick={() => { setForm(emptyEvent); setSelectedUnits(new Set()); setDialog(true); }}>
                <Plus className="h-4 w-4 mr-2" /> New BU event
              </Button>
            )}
          </div>
        }
      />

      <div className="flex gap-2 rounded-lg border bg-muted/30 p-3 text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p className="text-xs">
          A unit's cut-off is the <strong>earlier</strong> of the BU date and its dastavej date. Units
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
        </p>
      </div>

      {events.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <CalendarCheck className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No BU events yet for this project.</p>
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
          const cfConfirmed = taxable.filter((r) => cfByUnit.get(r.unit_id)?.status === 'CONFIRMED').length;
          const cfOutstanding = taxable.length - cfConfirmed;

          return (
            <Card key={ev.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      BU dated {ev.bu_date}
                      {ev.bu_ref_no && <span className="text-muted-foreground font-normal">· {ev.bu_ref_no}</span>}
                      <Badge
                        className={
                          ev.status === 'POSTED'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : 'bg-amber-100 text-amber-800 border-amber-200'
                        }
                      >
                        {ev.status}
                      </Badge>
                      {ev.status !== 'POSTED' && taxable.length > 0 && (
                        <Badge
                          variant="outline"
                          className={cfOutstanding === 0 ? 'text-emerald-700 border-emerald-200' : 'text-amber-700 border-amber-200'}
                        >
                          Agreement value: {cfConfirmed}/{taxable.length} confirmed
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {ev.scope === 'FULL' ? 'Full project' : `${rows.length} selected unit(s)`}
                      {' · posts to '}{prettyPeriodLabel(ev.posting_period)}
                      {' · '}{POSTING_BASIS_LABEL[ev.posting_basis]}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setOpenEvent(isOpen ? null : ev.id)}>
                      {isOpen ? 'Hide working' : 'Show working'}
                    </Button>
                    {canPost && ev.status !== 'POSTED' && taxable.length > 0 && (
                      <Button
                        variant="outline" size="sm"
                        onClick={() => void handleSendConfirmations(ev)}
                        disabled={isSendingConfirm === ev.id}
                      >
                        {isSendingConfirm === ev.id
                          ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          : <Send className="h-4 w-4 mr-2" />}
                        {cfRows.length ? 'Re-send confirmations' : 'Send confirmation requests'}
                      </Button>
                    )}
                    {canPost && ev.status !== 'POSTED' && (
                      <>
                        <Button
                          size="sm" onClick={() => void handlePost(ev)} disabled={isSaving}
                          title={cfOutstanding > 0 ? `${cfOutstanding} unit(s) still awaiting client confirmation` : undefined}
                        >
                          <Send className="h-4 w-4 mr-2" /> Post
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(ev)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                    {canPost && ev.status === 'POSTED' && (
                      <Button variant="outline" size="sm" onClick={() => handleUnpost(ev)} disabled={isSaving}>
                        <Undo2 className="h-4 w-4 mr-2" /> Unpost
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <div>
                    <p className="text-xs text-muted-foreground">Taxable units</p>
                    <p className="text-sm font-semibold">{taxable.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Unbooked (Sch. III)</p>
                    <p className="text-sm font-semibold">{unbooked.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Differential value</p>
                    <p className="text-sm font-semibold">{formatINR(tot.diff)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Taxable value</p>
                    <p className="text-sm font-semibold">{formatINR(tot.taxable)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">CGST + SGST</p>
                    <p className="text-sm font-semibold">{formatINR(tot.cgst + tot.sgst)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Interest u/s 50</p>
                    <p className="text-sm font-semibold">{tot.interest > 0 ? formatINR(tot.interest) : '—'}</p>
                  </div>
                </div>

                {ev.status === 'POSTED' && (
                  <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <p className="text-xs">
                      These units are taxed in full. GST law gives no bad-debt relief, so if a booking
                      cancels the tax is recoverable only through a credit note u/s 34 — deadline{' '}
                      <strong>{creditNoteDeadline(ev.posting_period)}</strong>.
                    </p>
                  </div>
                )}

                {isOpen && (
                  <div className="overflow-x-auto rounded border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Unit</TableHead>
                          <TableHead>Cut-off</TableHead>
                          <TableHead>Status at cut-off</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">Agreement</TableHead>
                          <TableHead>Confirmed?</TableHead>
                          <TableHead className="text-right">Taxed to opening</TableHead>
                          <TableHead className="text-right">Differential</TableHead>
                          <TableHead className="text-right">Taxable value</TableHead>
                          <TableHead className="text-right">CGST</TableHead>
                          <TableHead className="text-right">SGST</TableHead>
                          <TableHead className="text-right">Interest</TableHead>
                          <TableHead className="text-right">Tie-out</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((r) => {
                          const u = units.find((x) => x.id === r.unit_id);
                          return (
                            <TableRow key={r.id} className={r.booked_at_cutoff ? '' : 'opacity-60'}>
                              <TableCell className="font-medium">{u?.unit_no || '—'}</TableCell>
                              <TableCell className="text-sm">
                                {r.cut_off_date}
                                <span className="block text-xs text-muted-foreground">
                                  via {r.cut_off_source === 'DASTAVEJ' ? 'dastavej' : 'BU'}
                                </span>
                              </TableCell>
                              <TableCell>
                                {r.booked_at_cutoff ? (
                                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Booked</Badge>
                                ) : (
                                  <Badge variant="outline">Unbooked — Sch. III</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right text-sm">{r.rate_pct}%</TableCell>
                              <TableCell className="text-right text-sm">{formatINR(r.agreement_value)}</TableCell>
                              <TableCell>
                                {!r.booked_at_cutoff ? (
                                  <span className="text-muted-foreground text-xs">—</span>
                                ) : (() => {
                                  const cf = cfByUnit.get(r.unit_id);
                                  const status = cf?.status || 'NOT_SENT';
                                  const cls = status === 'CONFIRMED'
                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                    : status === 'DISPUTED'
                                      ? 'bg-red-100 text-red-800 border-red-200'
                                      : status === 'PENDING'
                                        ? 'bg-amber-100 text-amber-800 border-amber-200'
                                        : 'bg-slate-100 text-slate-600 border-slate-200';
                                  return (
                                    <>
                                      <Badge className={cls}>{status === 'NOT_SENT' ? 'Not sent' : status}</Badge>
                                      {status === 'DISPUTED' && cf?.disputeNotes && (
                                        <span className="block text-xs text-muted-foreground mt-0.5" title={cf.disputeNotes}>
                                          {cf.disputeNotes}
                                        </span>
                                      )}
                                    </>
                                  );
                                })()}
                              </TableCell>
                              <TableCell className="text-right text-sm">{formatINR(r.value_taxed_upto_opening)}</TableCell>
                              <TableCell className="text-right text-sm font-medium">
                                {r.booked_at_cutoff ? formatINR(r.differential_value) : '—'}
                              </TableCell>
                              <TableCell className="text-right text-sm">
                                {r.booked_at_cutoff ? formatINR(r.differential_taxable_value) : '—'}
                              </TableCell>
                              <TableCell className="text-right text-sm">
                                {r.booked_at_cutoff ? formatINR(r.differential_cgst) : '—'}
                              </TableCell>
                              <TableCell className="text-right text-sm">
                                {r.booked_at_cutoff ? formatINR(r.differential_sgst) : '—'}
                              </TableCell>
                              <TableCell className="text-right text-sm">
                                {r.interest_amount > 0 ? (
                                  <>
                                    {formatINR(r.interest_amount)}
                                    <span className="block text-xs text-muted-foreground">{r.interest_days}d</span>
                                  </>
                                ) : '—'}
                              </TableCell>
                              <TableCell className="text-right text-sm">
                                {Math.abs(Number(r.tie_out_diff) || 0) < 1 ? (
                                  <span className="text-muted-foreground">OK</span>
                                ) : (
                                  <span className="text-destructive">{formatINR(r.tie_out_diff)}</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

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

          {form.posting_basis === 'BU_MONTH' && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="text-xs">
                Posting into {prettyPeriodLabel(periodOfDate(form.bu_date))}. If that return is already
                filed it cannot be revised — the liability would have to be declared in a later return
                instead, which is what the interest basis does.
              </p>
            </div>
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
