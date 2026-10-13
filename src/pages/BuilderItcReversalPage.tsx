import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Plus, Save, Send, Undo2 } from 'lucide-react';
import { useBuilderEmbedded, useBuilderProjectId } from '@/contexts/BuilderWorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, Note, SectionCard } from '@/components/gstr9/ui';
import {
  WS_BTN, WS_CONTROL, WS_PAGE, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL,
} from '@/components/workspace/theme';
import {
  HEADS, HEAD_LABEL, ZERO, add, computeItcReversal, fyLabel, fyRange, latestPostingPeriod, tax, total,
  type Tax, type YearReference,
} from '@/utils/builderItcReversal';
import {
  approveWorking, createWorking, fetchBuEvents, fetchCarpetBasis, fetchReferences, fetchWorking, saveWorking,
  saveYear, setStartFy, submitWorking, toYearInput, withdrawWorking,
  type BuEventOption, type CarpetBasis, type WorkingRow, type YearRow,
} from '@/lib/builderItcReversalData';

/**
 * Builder › ITC Reversal — the final Rule 42/43 reversal at completion.
 * Engine and positions: src/utils/builderItcReversal.ts,
 * docs/BUILDER_GST_POSITIONS.md §7A.
 */

const inr = (n: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
type Field = 'inputs_services' | 'capital_goods' | 'reversed_r42' | 'reversed_r43';
const FIELDS: { key: Field; label: string; hint: string }[] = [
  { key: 'inputs_services', label: 'Inputs & input services (Rule 42)', hint: 'GSTR-9 Table 6 — common credit' },
  { key: 'capital_goods', label: 'Capital goods (Rule 43)', hint: 'GSTR-9 Table 6 — capital goods' },
  { key: 'reversed_r42', label: 'Already reversed — Rule 42', hint: 'GSTR-9 Table 7C' },
  { key: 'reversed_r43', label: 'Already reversed — Rule 43', hint: 'GSTR-9 Table 7D' },
];
const STATUS_VARIANT = { DRAFT: 'secondary', SUBMITTED: 'warning', APPROVED: 'success' } as const;

const BuilderItcReversalPage: React.FC = () => {
  const projectId = useBuilderProjectId();
  const embedded = useBuilderEmbedded();
  const { user, canPostBuEvent } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';
  const canEdit = canPostBuEvent();

  const [project, setProject] = useState<{ id: string; name: string; client_id: string } | null>(null);
  const [registrationDate, setRegistrationDate] = useState<string | null>(null);
  const [events, setEvents] = useState<BuEventOption[]>([]);
  const [eventId, setEventId] = useState('');
  const [basis, setBasis] = useState<CarpetBasis | null>(null);
  const [working, setWorking] = useState<WorkingRow | null>(null);
  const [years, setYears] = useState<YearRow[]>([]);
  const [refs, setRefs] = useState<Record<string, YearReference>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const event = events.find((e) => e.id === eventId) || null;
  const editable = canEdit && working?.status === 'DRAFT';

  const loadProject = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const { data: p, error } = await supabase.from('builder_projects')
        .select('id, name, client_id').eq('id', projectId).maybeSingle();
      if (error) throw error;
      const proj = p as { id: string; name: string; client_id: string } | null;
      setProject(proj);
      if (!proj) return;
      const { data: c } = await supabase.from('clients').select('registration_date').eq('id', proj.client_id).maybeSingle();
      setRegistrationDate((c as { registration_date: string | null } | null)?.registration_date ?? null);
      const evs = await fetchBuEvents(projectId);
      setEvents(evs);
      setEventId((cur) => cur || evs[evs.length - 1]?.id || '');
    } catch (e) {
      toast.error('Could not load: ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadWorking = useCallback(async () => {
    if (!projectId || !eventId || !project) return;
    try {
      const [b, w] = await Promise.all([fetchCarpetBasis(eventId, project.client_id), fetchWorking(projectId, eventId)]);
      setBasis(b);
      setWorking(w.working);
      setYears(w.years);
      setDirty(new Set());
      setRefs(await fetchReferences(project.client_id, w.years.map((y) => y.financial_year)));
    } catch (e) {
      toast.error('Could not load the working: ' + (e as Error).message);
    }
  }, [projectId, eventId, project]);

  useEffect(() => { void loadProject(); }, [loadProject]);
  useEffect(() => { void loadWorking(); }, [loadWorking]);

  const result = useMemo(() => {
    if (!working) return null;
    return computeItcReversal({
      completionDate: working.completion_date,
      totalCarpet: Number(working.total_carpet_sqm) || 0,
      exemptCarpet: Number(working.exempt_carpet_sqm) || 0,
      postingPeriod: working.posting_period,
      includeInterest: working.include_interest,
      years: years.map(toYearInput),
      references: refs,
    });
  }, [working, years, refs]);

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      await loadWorking();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = () => run(async () => {
    if (!project || !event || !basis) return;
    await createWorking({
      clientId: project.client_id, projectId: project.id, event, basis, registrationDate, actorId: user?.id ?? null,
    });
  }, 'Working started — enter each year\'s figures');

  const setYearField = (id: string, field: Field, head: keyof Tax, value: string) => {
    setYears((ys) => ys.map((y) => (y.id === id ? { ...y, [field]: { ...tax(y[field]), [head]: Number(value) || 0 } } : y)));
    setDirty((d) => new Set(d).add(id));
  };
  const setYearMeta = (id: string, patch: Partial<YearRow>) => {
    setYears((ys) => ys.map((y) => (y.id === id ? { ...y, ...patch } : y)));
    setDirty((d) => new Set(d).add(id));
  };

  const saveAll = () => run(async () => {
    for (const y of years.filter((yy) => dirty.has(yy.id))) {
      await saveYear(y.id, {
        inputs_services: tax(y.inputs_services), capital_goods: tax(y.capital_goods),
        reversed_r42: tax(y.reversed_r42), reversed_r43: tax(y.reversed_r43),
        gstr9_arn: y.gstr9_arn, gstr9_filed_on: y.gstr9_filed_on, gstr9_match: y.gstr9_match, remarks: y.remarks,
      }, user?.id ?? null);
    }
  }, 'Saved');

  const submit = () => run(async () => {
    if (!working || !result) return;
    if (dirty.size) throw new Error('Save your changes first.');
    if (result.problems.length) throw new Error(result.problems[0]);
    await submitWorking(working.id, result, user?.id ?? null);
  }, 'Submitted for the superadmin\'s approval');

  const approve = () => run(async () => {
    if (!working || !user?.id) return;
    const frozen = working.result ?? result;
    if (!frozen) return;
    const lines = frozen.lines.map((l) => `${l.tableRef}: ${HEADS.filter((h) => l.amount[h]).map((h) => `${HEAD_LABEL[h]} ₹${inr(l.amount[h])}`).join(', ')}`).join('\n');
    if (!window.confirm(`Approve and post into the GSTR-3B for ${working.posting_period}?\n\n${lines || 'No amounts.'}`)) return;
    await approveWorking(working.id, user.id, frozen);
  }, 'Approved — the reversal is in the GSTR-3B draft');

  const withdraw = () => run(async () => {
    if (!working || !user?.id) return;
    const what = working.status === 'APPROVED'
      ? 'Withdraw the approval? The GSTR-3B rows it wrote are removed and the working goes back to draft.'
      : 'Send the working back to draft?';
    if (!window.confirm(what)) return;
    await withdrawWorking(working.id, user.id);
  }, 'Back to draft');

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const buFy = working?.bu_fy;
  const fyOptions = buFy ? fyRange('2019-20', buFy) : [];
  const totals = result?.years.reduce((a, y) => ({
    availed: add(a.availed, add(tax(y.inputsServices), tax(y.capitalGoods))),
    attributable: add(a.attributable, add(y.attributableR42, y.attributableR43)),
    reversed: add(a.reversed, add(y.reversedR42, y.reversedR43)),
  }), { availed: ZERO, attributable: ZERO, reversed: ZERO });

  return (
    <div className={WS_PAGE}>
      <PageHeader
        compact
        embedded={embedded}
        title="ITC reversal at completion"
        subtitle="Rules 42 and 43 · final determination at BU"
        actions={working && (
          <Badge variant={STATUS_VARIANT[working.status]} className="text-[11px]">{working.status}</Badge>
        )}
      />

      {!events.length ? (
        <Note tone="warn">This project has no BU event yet. Record the BU on the BU Working tab first.</Note>
      ) : (
        <SectionCard
          title="Basis"
          description="Te / Tt by carpet area, from the BU event's frozen unit snapshot"
          actions={(
            <Select value={eventId} onValueChange={setEventId}>
              <SelectTrigger className={cn(WS_CONTROL, 'w-64')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {events.map((e) => (
                  <SelectItem key={e.id} value={e.id}>BU {e.buDate} · {e.status.toLowerCase()} · posts {e.postingPeriod}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        >
          {basis && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <KpiTile label="Total carpet (Tt)" value={`${inr(Number(working?.total_carpet_sqm ?? basis.totalCarpet))} sq m`} hint={`${basis.units} units`} />
              <KpiTile label="Exempt carpet (Te)" value={`${inr(Number(working?.exempt_carpet_sqm ?? basis.exemptCarpet))} sq m`} hint={`${basis.unbookedUnits} unbooked at completion`} />
              <KpiTile label="Exempt share" value={`${((result?.ratio ?? (basis.totalCarpet ? basis.exemptCarpet / basis.totalCarpet : 0)) * 100).toFixed(4)}%`} tone="warn" />
              <KpiTile label="ITC type" value={basis.itcType === 'PARTIAL_ITC' ? 'Partial ITC' : basis.itcType === 'CLAIM_ITC' ? 'Full ITC' : basis.itcType === 'NO_ITC' ? 'No ITC' : '—'} />
            </div>
          )}
          {basis?.itcType === 'NO_ITC' && (
            <Note tone="warn">This client takes no ITC — every month's credit is already reversed in full, so there is nothing to reverse at completion.</Note>
          )}
          {basis && <p className="text-xs text-muted-foreground">{working?.basis_note || basis.note}</p>}
          {!working && event && (
            <div>
              <Button size="sm" className={WS_BTN} onClick={() => void start()} disabled={!canEdit || busy || !basis}>
                <Plus className="h-3.5 w-3.5" /> Start the working for BU {event.buDate}
              </Button>
              {!canEdit && <p className="mt-1 text-xs text-muted-foreground">Needs the Post BU events permission.</p>}
            </div>
          )}
        </SectionCard>
      )}

      {working && result && (
        <>
          <SectionCard
            title="Settings"
            description={`Completion ${working.completion_date} · BU year ${fyLabel(working.bu_fy)}`}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">First financial year of the project</Label>
                <Select
                  value={working.start_fy}
                  disabled={!editable || busy}
                  onValueChange={(v) => void run(() => setStartFy(working, years, v, user?.id ?? null))}
                >
                  <SelectTrigger className={WS_CONTROL}><SelectValue /></SelectTrigger>
                  <SelectContent>{fyOptions.map((f) => <SelectItem key={f} value={f}>{fyLabel(f)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">GSTR-3B period it goes into (MM/YYYY)</Label>
                <Input
                  className={WS_CONTROL} defaultValue={working.posting_period} disabled={!editable || busy}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== working.posting_period && /^\d{2}\/\d{4}$/.test(v)) void run(() => saveWorking(working.id, { posting_period: v }));
                  }}
                />
                <p className="text-[11px] text-muted-foreground">Not later than {latestPostingPeriod(working.bu_fy)}.</p>
              </div>
              <label className="flex items-start gap-2 pt-5 text-sm">
                <Checkbox
                  checked={working.include_interest} disabled={!editable || busy}
                  onCheckedChange={(c) => void run(() => saveWorking(working.id, { include_interest: !!c }))}
                />
                <span>
                  Work out interest u/s 50 on past years (18% from 1 April after each year)
                  <span className="block text-[11px] text-muted-foreground">Shown for payment through Table 5.1 / DRC-03 — not written into the return.</span>
                </span>
              </label>
            </div>
          </SectionCard>

          <SectionCard
            title="Credit by financial year"
            description="Past years exactly as in that year's GSTR-9; the BU year (April to the BU month) by hand"
            actions={editable ? (
              <Button size="sm" className={WS_BTN} onClick={() => void saveAll()} disabled={busy || !dirty.size}>
                <Save className="h-3.5 w-3.5" /> Save{dirty.size ? ` (${dirty.size})` : ''}
              </Button>
            ) : undefined}
          >
            <div className="space-y-3">
              {years.map((y) => {
                const yr = result.years.find((r) => r.financialYear === y.financial_year);
                const ref = refs[y.financial_year];
                return (
                  <div key={y.id} className="rounded-md border">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-3 py-1.5">
                      <span className="text-sm font-semibold">
                        {fyLabel(y.financial_year)}
                        {y.is_bu_year && <Badge variant="warning" className="ml-2 text-[10px]">BU year · enter by hand</Badge>}
                      </span>
                      {!y.is_bu_year && (
                        <Badge
                          variant={y.gstr9_match === 'UNVERIFIED' ? 'destructive' : 'success'}
                          className="text-[10px]"
                        >
                          {y.gstr9_match === 'UNVERIFIED' ? 'GSTR-9 not matched' : y.gstr9_match === 'MATCHED_DATA' ? 'Matches the app\'s GSTR-9 data' : 'Confirmed with filed GSTR-9'}
                        </Badge>
                      )}
                    </div>
                    <div className={cn(WS_TABLE_WRAP, 'rounded-none border-0')}>
                      <table className={WS_TABLE}>
                        <thead>
                          <tr>
                            <th className={WS_TH}>{y.is_bu_year ? 'April to the BU month' : 'As in GSTR-9'}</th>
                            {HEADS.map((h) => <th key={h} className={cn(WS_TH, 'text-right')}>{HEAD_LABEL[h]}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {FIELDS.map((f) => (
                            <tr key={f.key} className={WS_TR}>
                              <td className={WS_TD}>
                                {f.label}
                                <span className="block text-[11px] text-muted-foreground">{y.is_bu_year ? 'From the books / GSTR-3B' : f.hint}</span>
                              </td>
                              {HEADS.map((h) => (
                                <td key={h} className={cn(WS_TD, 'p-0')}>
                                  {editable ? (
                                    <Input
                                      type="number" step="0.01" inputMode="decimal"
                                      className="h-9 rounded-none border-0 bg-transparent text-right tabular-nums shadow-none"
                                      value={tax(y[f.key])[h] || ''}
                                      onChange={(e) => setYearField(y.id, f.key, h, e.target.value)}
                                    />
                                  ) : (
                                    <span className="block px-2 py-1.5 text-right tabular-nums">{inr(tax(y[f.key])[h])}</span>
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                          {ref?.availed && (
                            <tr className="bg-muted/30 text-xs text-muted-foreground">
                              <td className={WS_TD}>App's figure: {ref.source}{ref.months < 12 && ref.source !== 'GSTR-9 Table 6A' ? ` (${ref.months} months)` : ''}</td>
                              {HEADS.map((h) => <td key={h} className={WS_TD_NUM}>{inr(ref.availed![h])}</td>)}
                            </tr>
                          )}
                          {yr && (
                            <tr className={WS_TR_TOTAL}>
                              <td className={WS_TD}>Net to reverse ({(result.ratio * 100).toFixed(2)}% − already reversed)</td>
                              {HEADS.map((h) => <td key={h} className={WS_TD_NUM}>{inr(yr.net[h])}</td>)}
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {!y.is_bu_year && (
                      <div className="grid gap-2 p-3 sm:grid-cols-4">
                        <div className="space-y-1">
                          <Label className="text-xs">GSTR-9 ARN</Label>
                          <Input className={WS_CONTROL} value={y.gstr9_arn || ''} disabled={!editable}
                            onChange={(e) => setYearMeta(y.id, { gstr9_arn: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Filed on</Label>
                          <Input type="date" className={WS_CONTROL} value={y.gstr9_filed_on || ''} disabled={!editable}
                            onChange={(e) => setYearMeta(y.id, { gstr9_filed_on: e.target.value || null })} />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-xs">Remarks (explain any difference from the app's figure)</Label>
                          <Input className={WS_CONTROL} value={y.remarks || ''} disabled={!editable}
                            onChange={(e) => setYearMeta(y.id, { remarks: e.target.value })} />
                        </div>
                        <label className="flex items-center gap-2 text-sm sm:col-span-4">
                          <Checkbox
                            checked={y.gstr9_match !== 'UNVERIFIED'} disabled={!editable}
                            onCheckedChange={(c) => setYearMeta(y.id, {
                              gstr9_match: c
                                ? (yr?.referenceDiff && HEADS.every((h) => Math.abs(yr.referenceDiff![h]) <= 1) ? 'MATCHED_DATA' : 'CONFIRMED')
                                : 'UNVERIFIED',
                            })}
                          />
                          I have checked these figures against the GSTR-9 filed for {fyLabel(y.financial_year)}
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard
            title="Working"
            description="Per year: common credit × exempt share, less what was already reversed under Rules 42/43"
          >
            <div className={WS_TABLE_WRAP}>
              <table className={WS_TABLE} aria-label="Rule 42/43 working">
                <thead>
                  <tr>
                    <th className={WS_TH}>Year</th>
                    <th className={cn(WS_TH, 'text-right')}>Credit availed</th>
                    <th className={cn(WS_TH, 'text-right')}>Attributable to exempt</th>
                    <th className={cn(WS_TH, 'text-right')}>Already reversed</th>
                    <th className={cn(WS_TH, 'text-right')}>Net now</th>
                    {working.include_interest && <th className={cn(WS_TH, 'text-right')}>Interest (days)</th>}
                  </tr>
                </thead>
                <tbody>
                  {result.years.map((y) => (
                    <tr key={y.financialYear} className={WS_TR}>
                      <td className={WS_TD}>{fyLabel(y.financialYear)}</td>
                      <td className={WS_TD_NUM}>{inr(total(add(y.inputsServices, y.capitalGoods)))}</td>
                      <td className={WS_TD_NUM}>{inr(total(add(y.attributableR42, y.attributableR43)))}</td>
                      <td className={WS_TD_NUM}>{inr(total(add(y.reversedR42, y.reversedR43)))}</td>
                      <td className={cn(WS_TD_NUM, 'font-medium')}>{inr(total(y.net))}</td>
                      {working.include_interest && <td className={WS_TD_NUM}>{inr(total(y.interest))} ({y.interestDays})</td>}
                    </tr>
                  ))}
                  {totals && (
                    <tr className={WS_TR_TOTAL}>
                      <td className={WS_TD}>Total</td>
                      <td className={WS_TD_NUM}>{inr(total(totals.availed))}</td>
                      <td className={WS_TD_NUM}>{inr(total(totals.attributable))}</td>
                      <td className={WS_TD_NUM}>{inr(total(totals.reversed))}</td>
                      <td className={WS_TD_NUM}>{inr(total(result.totalNet))}</td>
                      {working.include_interest && <td className={WS_TD_NUM}>{inr(total(result.totalInterest))}</td>}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-semibold">Into GSTR-3B for {working.posting_period}</p>
              {result.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing to post.</p>
              ) : result.lines.map((l) => (
                <p key={l.tableRef} className="text-sm">
                  <Badge variant="outline" className="mr-2 text-[10px]">Table {l.tableRef}</Badge>
                  {HEADS.filter((h) => l.amount[h]).map((h) => `${HEAD_LABEL[h]} ₹${inr(l.amount[h])}`).join(' · ')}
                  <span className="block text-xs text-muted-foreground">{l.reason}</span>
                </p>
              ))}
              {result.lines.some((l) => l.amount.x > 0) && (
                <Note tone="warn">The GSTR-3B draft carries no cess on ITC lines yet — pay any cess shown here by hand.</Note>
              )}
            </div>

            {result.problems.length > 0 && (
              <Note tone="warn">
                <span className="font-medium">Before it can be submitted:</span>
                <ul className="ml-4 list-disc">{result.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              </Note>
            )}
            {result.warnings.length > 0 && (
              <Note tone="info" open>
                <ul className="ml-4 list-disc">{result.warnings.map((p) => <li key={p}>{p}</li>)}</ul>
              </Note>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              {working.status === 'DRAFT' && canEdit && (
                <Button size="sm" className={WS_BTN} disabled={busy || result.problems.length > 0 || dirty.size > 0} onClick={() => void submit()}>
                  <Send className="h-3.5 w-3.5" /> Submit for approval
                </Button>
              )}
              {working.status === 'SUBMITTED' && isSuperadmin && (
                <Button size="sm" className={WS_BTN} disabled={busy} onClick={() => void approve()}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve and post to GSTR-3B
                </Button>
              )}
              {working.status === 'SUBMITTED' && !isSuperadmin && (
                <span className="text-sm text-muted-foreground">Waiting for the superadmin's approval.</span>
              )}
              {((working.status === 'SUBMITTED' && canEdit) || (working.status === 'APPROVED' && isSuperadmin)) && (
                <Button variant="outline" size="sm" className={WS_BTN} disabled={busy} onClick={() => void withdraw()}>
                  <Undo2 className="h-3.5 w-3.5" /> {working.status === 'APPROVED' ? 'Withdraw approval' : 'Back to draft'}
                </Button>
              )}
              {working.status === 'APPROVED' && (
                <span className="text-sm text-muted-foreground">
                  Approved {working.approved_at ? new Date(working.approved_at).toLocaleDateString('en-IN') : ''} — in the GSTR-3B draft for {working.posting_period} (GSTR-3B Adjustments).
                </span>
              )}
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
};

export default BuilderItcReversalPage;
