import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, Note, SectionCard } from '@/components/gstr9/ui';
import {
  WS_CONTROL, WS_FILTER_LABEL, WS_PAGE, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR,
} from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { FileSignature, Loader2, Pencil, CheckCircle2, Percent } from 'lucide-react';
import { formatINR, type BuilderRateCode } from '@/utils/builderRates';
import {
  autoPostDastavejDifferential, clearDastavejDate, markLateDiscoveryInterestPaid, previewLateDiscoveryInterest,
  saveLateDiscoveryInterest,
} from '@/lib/builderBuPosting';
import type { LateDiscoveryInterest } from '@/utils/builderBuEvent';

interface RecoRow {
  unit_id: string;
  project_id: string;
  project_name: string;
  unit_no: string;
  unit_type: string;
  unit_status: string;
  dastavej_date: string | null;
  dastavej_value: number | null;
  opening_agreement_value: number;
  value_taxed: number;
  bu_event_id: string | null;
  bu_date: string | null;
  booked_at_cutoff: boolean | null;
  variance: number | null;
  cut_off_source: string | null;
}

interface PendingUnit {
  id: string;
  unit_no: string;
  project_id: string;
  dastavej_date: string | null;
  dastavej_value: number | null;
}

type Action =
  | { kind: 'NONE'; label: string; tone: 'ok' }
  | { kind: 'AUTO_TAXED'; label: string; tone: 'info' }
  | { kind: 'SCHEDULE_III'; label: string; tone: 'muted' }
  | { kind: 'SUPPLEMENTARY'; label: string; tone: 'warn' }
  | { kind: 'CREDIT_NOTE'; label: string; tone: 'warn' }
  | { kind: 'PENDING'; label: string; tone: 'muted' };

/**
 * What a variance calls for.
 *
 * Registration is not itself a taxable event under the firm's model — by the
 * time the deed is executed the unit is normally already fully taxed through
 * ordinary advances. Where that wasn't true, saving the date posts the
 * shortfall automatically (`autoPostDastavejDifferential`) — AUTO_TAXED is
 * that case made visible, so a receipt on this unit afterward reads as a
 * plain collection, not a fresh advance, and nobody has to wonder why it
 * didn't add tax.
 */
const resolveAction = (r: RecoRow): Action => {
  // Unbooked at its cut-off: Schedule III para 5, sale of a building after
  // completion is not a supply. The deed carries no GST and is omitted entirely.
  if (r.bu_event_id && r.booked_at_cutoff === false) {
    return { kind: 'SCHEDULE_III', label: 'Schedule III — no GST, omitted from returns', tone: 'muted' };
  }
  if (r.dastavej_value === null || r.dastavej_value === undefined) {
    return { kind: 'PENDING', label: 'Deed value not captured', tone: 'muted' };
  }
  const v = Number(r.variance) || 0;
  const autoTaxed = !!r.bu_event_id && r.cut_off_source === 'DASTAVEJ';
  if (Math.abs(v) <= 1) {
    return autoTaxed
      ? { kind: 'AUTO_TAXED', label: 'Taxed in full at registration — posted automatically, not owed again', tone: 'info' }
      : { kind: 'NONE', label: 'Reconciled', tone: 'ok' };
  }
  if (v > 0) {
    return {
      kind: 'SUPPLEMENTARY',
      label: 'Deed exceeds value taxed — supplementary invoice',
      tone: 'warn',
    };
  }
  return { kind: 'CREDIT_NOTE', label: 'Deed below value taxed — credit note, check the window', tone: 'warn' };
};

const today = () => new Date().toISOString().slice(0, 10);

const TONE_VARIANT: Record<Action['tone'], 'success' | 'info' | 'warning' | 'outline'> = {
  ok: 'success',
  info: 'info',
  warn: 'warning',
  muted: 'outline',
};

interface Props {
  /** Jump straight into recording the deed for one unit, instead of the full register. */
  focusUnit?: { id: string; unit_no: string; dastavej_date: string | null; dastavej_value: number | null };
  focusProjectId?: string;
}

const BuilderDastavejPage: React.FC<Props> = ({ focusUnit, focusProjectId }) => {
  const { canManageBuilderUnits, user } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();

  const [clients, setClients] = useState<{ id: string; name: string; gstin: string | null }[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectFilter, setProjectFilter] = useState('ALL');
  const [rows, setRows] = useState<RecoRow[]>([]);
  const [pending, setPending] = useState<PendingUnit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const [dialog, setDialog] = useState(false);
  const [editUnit, setEditUnit] = useState<{ id: string; unit_no: string } | null>(null);
  const [form, setForm] = useState({ dastavej_date: '', dastavej_value: '' });

  const [interestUnit, setInterestUnit] = useState<{ id: string; unit_no: string; dastavej_date: string; project_id: string } | null>(null);
  const [interestPreview, setInterestPreview] = useState<(LateDiscoveryInterest & { rateCode: BuilderRateCode; cutOffPeriod: string; bookedAtCutOff: boolean }) | null>(null);
  const [interestLoading, setInterestLoading] = useState(false);
  const [interestSavedId, setInterestSavedId] = useState<string | null>(null);
  const [interestArn, setInterestArn] = useState('');
  const [interestPaidDate, setInterestPaidDate] = useState('');

  const canEdit = canManageBuilderUnits();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('clients').select('id, name, gstin')
        .eq('regular_sub_type', 'Builder').order('name');
      setClients((data || []) as { id: string; name: string; gstin: string | null }[]);
    })();
  }, []);

  useEffect(() => {
    if (!selectedClientId) { setProjects([]); return; }
    (async () => {
      const { data } = await supabase
        .from('builder_projects').select('id, name').eq('client_id', selectedClientId).order('name');
      setProjects((data || []) as { id: string; name: string }[]);
      setProjectFilter('ALL');
    })();
  }, [selectedClientId]);

  const load = useCallback(async () => {
    if (!selectedClientId) { setRows([]); setPending([]); return; }
    setIsLoading(true);
    try {
      let q = supabase.from('builder_dastavej_reco').select('*').eq('client_id', selectedClientId);
      if (projectFilter !== 'ALL') q = q.eq('project_id', projectFilter);
      const { data, error } = await q;
      if (error) throw error;
      setRows((data || []) as unknown as RecoRow[]);

      // Units with no deed recorded at all, so one can be captured from here.
      const projectIds = projectFilter === 'ALL' ? projects.map((p) => p.id) : [projectFilter];
      if (projectIds.length) {
        const { data: units } = await supabase
          .from('builder_units')
          .select('id, unit_no, project_id, dastavej_date, dastavej_value')
          .in('project_id', projectIds)
          .is('dastavej_date', null)
          .order('unit_no');
        setPending((units || []) as unknown as PendingUnit[]);
      } else setPending([]);
    } catch (e) {
      toast.error(`Could not load: ${(e as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  }, [selectedClientId, projectFilter, projects]);

  useEffect(() => { void load(); }, [load]);

  // Scope the project select once its options are in, rather than racing the
  // client-change effect above that resets it to "All projects".
  useEffect(() => {
    if (focusProjectId && projects.some((p) => p.id === focusProjectId)) {
      setProjectFilter(focusProjectId);
    }
  }, [projects, focusProjectId]);

  const handledFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusUnit || handledFocusRef.current === focusUnit.id) return;
    handledFocusRef.current = focusUnit.id;
    openEdit(focusUnit.id, focusUnit.unit_no, focusUnit.dastavej_date, focusUnit.dastavej_value);
  }, [focusUnit]);

  const openEdit = (unitId: string, unitNo: string, date: string | null, value: number | null) => {
    setEditUnit({ id: unitId, unit_no: unitNo });
    setForm({ dastavej_date: date || '', dastavej_value: value === null ? '' : String(value) });
    setDialog(true);
  };

  const openLateInterest = async (unitId: string, unitNo: string, dastavejDate: string, projectId: string) => {
    setInterestUnit({ id: unitId, unit_no: unitNo, dastavej_date: dastavejDate, project_id: projectId });
    setInterestPreview(null);
    setInterestSavedId(null);
    setInterestArn('');
    setInterestPaidDate(today());
    setInterestLoading(true);
    try {
      const result = await previewLateDiscoveryInterest({ unitId, dastavejDate });
      setInterestPreview(result);
    } catch (e) {
      toast.error(`Could not compute: ${(e as Error).message}`);
      setInterestUnit(null);
    } finally {
      setInterestLoading(false);
    }
  };

  const handleSaveInterest = async () => {
    if (!interestUnit || !interestPreview) return;
    setInterestLoading(true);
    try {
      const { id } = await saveLateDiscoveryInterest({
        unitId: interestUnit.id, projectId: interestUnit.project_id, dastavejDate: interestUnit.dastavej_date,
        preview: interestPreview, userId: user?.id ?? null,
      });
      setInterestSavedId(id);
      toast.success('Working paper saved');
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setInterestLoading(false);
    }
  };

  const handleMarkInterestPaid = async () => {
    if (!interestSavedId || !interestArn.trim() || !interestPaidDate) {
      toast.error('ARN and paid date are required');
      return;
    }
    setInterestLoading(true);
    try {
      await markLateDiscoveryInterestPaid({ id: interestSavedId, arn: interestArn.trim(), paidDate: interestPaidDate });
      toast.success('Marked as paid');
      setInterestUnit(null);
    } catch (e) {
      toast.error(`Could not mark paid: ${(e as Error).message}`);
    } finally {
      setInterestLoading(false);
    }
  };

  const handleSave = async () => {
    if (!editUnit) return;
    if (!form.dastavej_date) { toast.error('Dastavej date is required.'); return; }
    setIsSaving(true);
    try {
      const { error } = await supabase.from('builder_units').update({
        dastavej_date: form.dastavej_date || null,
        dastavej_value: form.dastavej_value === '' ? null : parseFloat(form.dastavej_value),
      }).eq('id', editUnit.id);
      if (error) throw error;

      // A date was actually set (not cleared) — the deed is a completed
      // transfer either way, so check whether it's still owed anything.
      if (form.dastavej_date) {
        try {
          const result = await autoPostDastavejDifferential({
            unitId: editUnit.id, dastavejDate: form.dastavej_date, userId: user?.id ?? null,
          });
          if (result.action === 'POSTED') {
            toast.success(
              `Dastavej saved — ${formatINR(result.differentialValue)} taxed at registration `
              + `(CGST ${formatINR(result.cgst)}, SGST ${formatINR(result.sgst)}), since it wasn't `
              + 'fully covered by advances yet.',
            );
          } else if (result.action === 'SCHEDULE_III') {
            toast.info('Dastavej saved — this unit was unbooked at that date, recorded under Schedule III.');
          } else if (result.action === 'EXCLUDED') {
            toast.info(
              'Dastavej saved for the register — this unit is flagged closed before onboarding, so no '
              + 'automatic differential is computed for it.',
            );
          } else if (result.action === 'ALREADY_TAXED') {
            toast.success('Dastavej saved — already fully taxed by advances, nothing further to post.');
          } else {
            toast.success('Dastavej details saved');
          }
        } catch (autoErr) {
          // The date is saved regardless; only the automatic differential
          // failed, and that's worth surfacing rather than swallowing.
          toast.error(`Dastavej saved, but the automatic differential failed: ${(autoErr as Error).message}`);
        }
      } else {
        toast.success('Dastavej details saved');
      }
      setDialog(false);
      await load();
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * A wrong date/value entirely — not a date that should move, which is just
   * an overwrite via Save. See clearDastavejDate() for the guards: blocked
   * outright if the posted differential's period is already filed, or if the
   * event covers other units too; otherwise unposted and cleared in one step.
   */
  const handleClear = async () => {
    if (!editUnit) return;
    setIsClearing(true);
    try {
      await clearDastavejDate(editUnit.id);
      toast.success('Dastavej date cleared');
      setDialog(false);
      await load();
    } catch (e) {
      toast.error(`Could not clear: ${(e as Error).message}`);
    } finally {
      setIsClearing(false);
    }
  };

  const summary = useMemo(() => {
    const acc = { reconciled: 0, autoTaxed: 0, supplementary: 0, creditNote: 0, scheduleIII: 0, pending: 0 };
    rows.forEach((r) => {
      const a = resolveAction(r);
      if (a.kind === 'NONE') acc.reconciled += 1;
      else if (a.kind === 'AUTO_TAXED') acc.autoTaxed += 1;
      else if (a.kind === 'SUPPLEMENTARY') acc.supplementary += 1;
      else if (a.kind === 'CREDIT_NOTE') acc.creditNote += 1;
      else if (a.kind === 'SCHEDULE_III') acc.scheduleIII += 1;
      else acc.pending += 1;
    });
    return acc;
  }, [rows]);

  return (
    <div className={WS_PAGE}>
      <PageHeader
        compact
        embedded
        title="Dastavej Reconciliation"
        subtitle="Registered deed value against the value actually offered to tax"
        icon={<FileSignature />}
      />

      <Card>
        <CardContent className="px-3 py-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[220px] max-w-xs flex-1 space-y-0.5">
              <span className={WS_FILTER_LABEL}>Builder client</span>
              <SearchableSelect
                options={clients.map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin || undefined }))}
                value={selectedClientId || ''}
                onValueChange={setSelectedClientId}
                placeholder="Search builder client..."
                searchPlaceholder="Type to search..."
                emptyText="No builder clients found."
                className={WS_CONTROL}
              />
            </label>
            <label className="w-56 space-y-0.5">
              <span className={WS_FILTER_LABEL}>Project</span>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className={WS_CONTROL} aria-label="Project"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All projects</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          </div>
        </CardContent>
      </Card>

      <Note>
        Registration usually creates no fresh GST — by the time the deed is executed the unit is normally
        already fully taxed through ordinary advances, and this page exists to catch variances. Where it
        isn't — the unit registered before advances caught up — saving the date taxes the shortfall
        automatically, right here, so nothing is left open until some future BU event. Where the deed is
        registered at a jantri value above the agreement value, GST still follows the actual transaction
        value u/s 15; the reconciliation just needs to be documented, because it is a standard audit query.
      </Note>

      {isLoading && (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </CardContent>
        </Card>
      )}

      {!isLoading && selectedClientId && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <KpiTile label="Reconciled" value={summary.reconciled} tone={summary.reconciled ? 'ok' : 'neutral'} />
            <KpiTile label="Taxed at registration" value={summary.autoTaxed} />
            <KpiTile label="Supplementary due" value={summary.supplementary} tone={summary.supplementary ? 'warn' : 'neutral'} />
            <KpiTile label="Credit note due" value={summary.creditNote} tone={summary.creditNote ? 'warn' : 'neutral'} />
            <KpiTile label="Schedule III" value={summary.scheduleIII} />
            <KpiTile label="Value not captured" value={summary.pending} tone={summary.pending ? 'warn' : 'neutral'} />
          </div>

          <SectionCard
            title={`Registered units (${rows.length})`}
            description={(
              <>
                A unit unbooked at its BU cut-off falls under Schedule III — its later sale is not a supply,
                so the deed carries no GST and appears in no return.
              </>
            )}
          >
            {rows.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No units with dastavej details recorded yet.
              </p>
            ) : (
              <div className={WS_TABLE_WRAP}>
                <table className={WS_TABLE}>
                  <thead>
                    <tr>
                      <th className={WS_TH}>Project</th>
                      <th className={WS_TH}>Unit</th>
                      <th className={WS_TH}>Dastavej date</th>
                      <th className={WS_TH}>Cut-off date</th>
                      <th className={cn(WS_TH, 'text-right')}>Deed value</th>
                      <th className={cn(WS_TH, 'text-right')}>Value taxed</th>
                      <th className={cn(WS_TH, 'text-right')}>Variance</th>
                      <th className={WS_TH}>Action</th>
                      <th className={cn(WS_TH, 'w-16')}><span className="sr-only">Edit</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const action = resolveAction(r);
                      return (
                        <tr key={r.unit_id} className={WS_TR}>
                          <td className={cn(WS_TD, 'text-muted-foreground')}>{r.project_name}</td>
                          <td className={cn(WS_TD, 'font-medium')}>
                            {r.unit_no}
                            <span className="block text-[11px] font-normal text-muted-foreground">{r.unit_type}</span>
                          </td>
                          <td className={cn(WS_TD, 'whitespace-nowrap')}>{r.dastavej_date || '—'}</td>
                          <td className={cn(WS_TD, 'whitespace-nowrap')}>
                            {r.bu_date ? (
                              <>
                                {r.bu_date}
                                <span className="block text-[11px] text-muted-foreground">
                                  {r.cut_off_source === 'DASTAVEJ' ? 'via dastavej' : 'via BU'}
                                </span>
                              </>
                            ) : '—'}
                          </td>
                          <td className={WS_TD_NUM}>
                            {r.dastavej_value === null ? '—' : formatINR(r.dastavej_value)}
                          </td>
                          <td className={WS_TD_NUM}>{formatINR(r.value_taxed)}</td>
                          <td className={cn(WS_TD_NUM, 'font-medium')}>
                            {r.variance === null ? '—' : formatINR(r.variance)}
                          </td>
                          <td className={WS_TD}>
                            <Badge variant={TONE_VARIANT[action.tone]} className="text-[10px] font-medium">
                              {action.label}
                            </Badge>
                          </td>
                          <td className={cn(WS_TD, 'py-0.5')}>
                            <div className="flex items-center">
                              {canEdit && (
                                <Button
                                  variant="ghost" size="icon" className="h-7 w-7" title="Edit dastavej"
                                  onClick={() => openEdit(r.unit_id, r.unit_no, r.dastavej_date, r.dastavej_value)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {canEdit && r.dastavej_date && (
                                <Button
                                  variant="ghost" size="icon" className="h-7 w-7" title="Late-discovery interest"
                                  onClick={() => openLateInterest(r.unit_id, r.unit_no, r.dastavej_date!, r.project_id)}
                                >
                                  <Percent className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {pending.length > 0 && (
            <SectionCard
              title={`Awaiting registration (${pending.length})`}
              description={(
                <>
                  Units with no deed recorded. A dastavej dated before the BU permission pulls that unit's
                  cut-off earlier, so capturing it matters before a BU event is prepared.
                </>
              )}
            >
              <div className={WS_TABLE_WRAP}>
                <table className={WS_TABLE}>
                  <thead>
                    <tr>
                      <th className={WS_TH}>Unit</th>
                      <th className={cn(WS_TH, 'w-12')}><span className="sr-only">Edit</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.slice(0, 50).map((u) => (
                      <tr key={u.id} className={WS_TR}>
                        <td className={cn(WS_TD, 'font-medium')}>{u.unit_no}</td>
                        <td className={cn(WS_TD, 'py-0.5')}>
                          {canEdit && (
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7" title="Record dastavej"
                              onClick={() => openEdit(u.id, u.unit_no, u.dastavej_date, u.dastavej_value)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pending.length > 50 && (
                <p className="text-xs text-muted-foreground">
                  Showing the first 50 of {pending.length}.
                </p>
              )}
            </SectionCard>
          )}
        </>
      )}

      {!selectedClientId && !isLoading && (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <FileSignature className="h-4 w-4 opacity-60" /> Select a builder client.
          </CardContent>
        </Card>
      )}

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Dastavej — unit {editUnit?.unit_no}</DialogTitle>
            <DialogDescription>
              The deed date is one half of the unit's BU cut-off: whichever of the BU date and this date
              is earlier.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="d-date">Dastavej date <span className="text-destructive">*</span></Label>
              <Input
                id="d-date" type="date" required value={form.dastavej_date}
                onChange={(e) => setForm({ ...form, dastavej_date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="d-value">Deed value (excl. GST)</Label>
              <Input
                id="d-value" type="number" step="0.01" value={form.dastavej_value}
                onChange={(e) => setForm({ ...form, dastavej_value: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                The consideration in the deed, not the jantri value.
              </p>
            </div>
          </div>

          <Note tone="warn">
            Saving a date on a unit not yet closed against any event checks it immediately: fully taxed
            already → nothing happens; a shortfall → it's posted right now, dated to this deed. Changing
            the date on a unit <strong>already</strong> covered by a posted event does not re-run that
            working — unpost it and prepare it again if the cut-off should move.
          </Note>

          <DialogFooter>
            {form.dastavej_date && (
              <Button
                variant="destructive" className="mr-auto"
                onClick={handleClear} disabled={isSaving || isClearing}
              >
                {isClearing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Clear date
              </Button>
            )}
            <Button variant="outline" onClick={() => setDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving || isClearing}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Late-discovery interest ─────────────────────────────────────── */}
      <Dialog open={!!interestUnit} onOpenChange={(o) => !o && setInterestUnit(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Late-discovery interest — unit {interestUnit?.unit_no}</DialogTitle>
            <DialogDescription>
              For a shortfall that sat unposted while the buyer kept paying normally — prices s.50
              interest on what was already collected and taxed as ordinary advances, instead of taxing
              it a second time as a fresh differential.
            </DialogDescription>
          </DialogHeader>

          {interestLoading && !interestPreview && (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          )}

          {interestPreview && (
            <div className="space-y-4">
              {!interestPreview.bookedAtCutOff ? (
                <Note open>Unbooked at this cut-off — Schedule III, no GST involved.</Note>
              ) : interestPreview.shortfallValue <= 0 ? (
                <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 px-2.5 py-1.5 text-foreground">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-strong" />
                  <p className="text-xs">
                    No shortfall as of {interestPreview.cutOffPeriod} — advances before the cut-off already
                    covered the agreement value. Nothing to price here.
                  </p>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
                    <div className="flex justify-between">
                      <span>Shortfall as of {interestPreview.cutOffPeriod} (cut-off)</span>
                      <span className="font-medium">{formatINR(interestPreview.shortfallValue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Recovered via later ordinary advances</span>
                      <span className="font-medium">{formatINR(interestPreview.totalAllocated)}</span>
                    </div>
                  </div>

                  {interestPreview.tranches.length > 0 && (
                    <div className={WS_TABLE_WRAP}>
                      <table className={WS_TABLE}>
                        <thead>
                          <tr>
                            <th className={WS_TH}>Period</th>
                            <th className={cn(WS_TH, 'text-right')}>Allocated</th>
                            <th className={cn(WS_TH, 'text-right')}>Tax</th>
                            <th className={cn(WS_TH, 'text-right')}>Days late</th>
                            <th className={cn(WS_TH, 'text-right')}>Interest</th>
                          </tr>
                        </thead>
                        <tbody>
                          {interestPreview.tranches.map((t) => (
                            <tr key={t.periodMonth} className={WS_TR}>
                              <td className={WS_TD}>{t.periodMonth}</td>
                              <td className={WS_TD_NUM}>{formatINR(t.allocated)}</td>
                              <td className={WS_TD_NUM}>{formatINR(t.tax)}</td>
                              <td className={WS_TD_NUM}>{t.interestDays}</td>
                              <td className={cn(WS_TD_NUM, 'font-medium')}>{formatINR(t.interestAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="rounded-md border border-info/40 bg-info/10 px-3 py-2 text-foreground">
                    <p className="text-sm font-medium">Total interest owed: {formatINR(interestPreview.totalInterest)}</p>
                    <p className="text-xs mt-1">Settled by voluntary payment on the portal — never through GSTR-1/3B.</p>
                  </div>

                  {interestPreview.residualUnrecovered > 0.005 && (
                    <Note tone="warn">
                      {formatINR(interestPreview.residualUnrecovered)} of the shortfall was never
                      recovered by any later advance — still genuinely untaxed. This portion needs an
                      ordinary differential post (BU Events page, single unit, Discovery-with-interest
                      basis) for fresh tax plus interest to today, on top of the amount above.
                    </Note>
                  )}

                  {!interestSavedId ? (
                    <Button onClick={handleSaveInterest} disabled={interestLoading}>
                      {interestLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save working paper
                    </Button>
                  ) : (
                    <div className="rounded-lg border p-3 space-y-2">
                      <p className="text-sm font-medium">Working paper saved. Record the portal payment once made:</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label htmlFor="li-arn">DRC-03 ARN</Label>
                          <Input id="li-arn" value={interestArn} onChange={(e) => setInterestArn(e.target.value)} />
                        </div>
                        <div>
                          <Label htmlFor="li-date">Paid date</Label>
                          <Input
                            id="li-date" type="date" value={interestPaidDate}
                            onChange={(e) => setInterestPaidDate(e.target.value)}
                          />
                        </div>
                      </div>
                      <Button onClick={handleMarkInterestPaid} disabled={interestLoading} size="sm">
                        {interestLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Mark as paid
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setInterestUnit(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BuilderDastavejPage;
