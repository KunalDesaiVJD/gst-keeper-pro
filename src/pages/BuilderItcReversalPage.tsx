import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, ChevronDown, ChevronRight, CloudDownload, Loader2, Plus, Save, Send, Undo2 } from 'lucide-react';
import { useExtensionBridge } from '@/components/gstr9/portal/useExtensionBridge';
import { compareVersions } from '@/lib/extensionVersion';
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
  HEADS, HEAD_LABEL, T7_KEYS, T7_LABEL, ZERO, add, computeItcReversal, fyLabel, fyRange, latestPostingPeriod, t7, tax, total,
  type T7Key, type Tax, type YearReference, type YearResult,
} from '@/utils/builderItcReversal';
import {
  approveWorking, createWorking, fetchBuEvents, fetchCarpetBasis, fetchFiledGstr9, fetchReferences, fetchWorking, isLocked, needsPortalFill,
  PORTAL_SOURCE_LABEL, fillYearFromPortal, gstr9PeriodOf, saveWorking, saveYear, setStartFy, submitWorking, toYearInput, withdrawWorking,
  type BuEventOption, type CarpetBasis, type FiledGstr9, type LockField, type WorkingRow, type YearRow,
} from '@/lib/builderItcReversalData';

/**
 * Builder › ITC Reversal — the final Rule 42/43 reversal at completion.
 * Engine and positions: src/utils/builderItcReversal.ts,
 * docs/BUILDER_GST_POSITIONS.md §7A.
 */

const inr = (n: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
type Field = 'inputs_services' | 'capital_goods' | 'reversed_r42' | 'reversed_r43';
/** One line of a year's GSTR-9 Tables 6 and 7: typed (a column, or a Table 7 head) or worked out. */
type Line =
  | { kind: 'field'; field: Field; label: string; hint: string }
  | { kind: 't7'; key: T7Key; label: string }
  | { kind: 'calc'; label: string; hint?: string; value: (r: YearResult) => Tax; strong?: boolean };
const LINES: Line[] = [
  { kind: 'field', field: 'inputs_services', label: 'Inputs & input services', hint: 'Table 6 (ip + is) — Rule 42' },
  { kind: 'field', field: 'capital_goods', label: 'Capital goods', hint: 'Table 6 (cg) — Rule 43' },
  { kind: 'calc', label: '6O — Total ITC availed', value: (r) => r.availed, strong: true },
  { kind: 't7', key: 'a', label: T7_LABEL.a },
  { kind: 't7', key: 'b', label: T7_LABEL.b },
  { kind: 'field', field: 'reversed_r42', label: '7C — Rule 42', hint: 'already reversed under Rule 42' },
  { kind: 'field', field: 'reversed_r43', label: '7D — Rule 43', hint: 'already reversed under Rule 43' },
  { kind: 't7', key: 'e', label: T7_LABEL.e },
  { kind: 't7', key: 'f', label: T7_LABEL.f },
  { kind: 't7', key: 'g', label: T7_LABEL.g },
  { kind: 't7', key: 'h', label: T7_LABEL.h },
  { kind: 'calc', label: '7I — Total ITC reversed (7A to 7H)', value: (r) => r.t7i, strong: true },
  { kind: 'calc', label: '7J — Net ITC available (6O − 7I)', value: (r) => r.t7j, strong: true },
  { kind: 'calc', label: 'Common credit for Rules 42/43', hint: '7J + 7C + 7D', value: (r) => add(r.baseR42, r.baseR43) },
];
const STATUS_VARIANT = { DRAFT: 'secondary', SUBMITTED: 'warning', APPROVED: 'success' } as const;
/** First extension version that reads the filed GSTR-9's Tables 6 and 7 from the portal's own GSTR-9 page. */
const FILED_GSTR9_MIN_VERSION = '0.12.0';
const POLL_MS = 10_000;
const POLL_MAX = 36;

/** A year nobody has entered yet. */
const isBlank = (y: YearRow) => y.gstr9_match === 'UNVERIFIED'
  && [y.inputs_services, y.capital_goods, y.reversed_r42, y.reversed_r43].every((t) => total(tax(t)) === 0)
  && total(Object.values(t7(y.t7_other)).reduce(add, ZERO)) === 0;

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
  const [filed, setFiled] = useState<Record<string, FiledGstr9>>({});
  const [polling, setPolling] = useState<number | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  // Year cards start collapsed; the working can show each tax head.
  const [openYears, setOpenYears] = useState<Set<string>>(new Set());
  const [byHead, setByHead] = useState(false);
  const toggleYear = (id: string) => setOpenYears((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
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
      const fys = w.years.map((y) => y.financial_year);
      const [appRefs, portal] = await Promise.all([
        fetchReferences(project.client_id, fys),
        fetchFiledGstr9(project.client_id, fys.filter((fy) => fy !== w.working?.bu_fy)),
      ]);
      // The filed GSTR-9 is the reference wherever the portal gave it.
      const merged = { ...appRefs };
      for (const f of Object.values(portal)) {
        merged[f.financialYear] = {
          financialYear: f.financialYear,
          availed: f.itc.availed,
          source: f.source === 'GSTR9_FILED' || f.source === 'GSTR9_FILED_TOTALS' ? 'GSTR-9 as filed (portal)' : f.source === 'GSTR9_COMPUTED' ? 'GSTR-9 Table 6A' : 'GSTR-3B Table 4A (as filed)',
          months: 12,
        };
      }
      setRefs(merged);
      setFiled(portal);
      // Past years are filled from the portal at once: a filed GSTR-9 locks
      // what it gave; a year not filed yet is only prefilled while blank.
      if (w.working?.status === 'DRAFT') {
        const blanks = w.years.filter((y) => !y.is_bu_year && portal[y.financial_year] && needsPortalFill(y, portal[y.financial_year], isBlank(y)));
        if (blanks.length) {
          for (const y of blanks) await fillYearFromPortal(y.id, portal[y.financial_year], user?.id ?? null);
          toast.success(`Filled ${blanks.length} year(s) from the portal`);
          const again = await fetchWorking(projectId, eventId);
          setYears(again.years);
        }
      }
    } catch (e) {
      toast.error('Could not load the working: ' + (e as Error).message);
    }
  }, [projectId, eventId, project, user?.id]);

  useEffect(() => { void loadProject(); }, [loadProject]);

  // ── Fetch past years' GSTR-9 from the portal through the extension ──────
  const bridge = useExtensionBridge(project?.client_id || '');
  const pastYears = useMemo(() => years.filter((y) => !y.is_bu_year), [years]);
  const fetchFromPortal = () => {
    if (!project || !pastYears.length) return;
    if (!bridge.ready) {
      toast.error('The GST Keeper browser extension was not detected. Install or enable it, then try again.');
      return;
    }
    if (!bridge.version || compareVersions(bridge.version, FILED_GSTR9_MIN_VERSION) < 0) {
      toast.error(`Extension ${bridge.version ? `v${bridge.version}` : '(old)'} cannot read Table 7 of the filed GSTR-9. Update it to v${FILED_GSTR9_MIN_VERSION} (chrome://extensions → Reload), then try again.`);
      return;
    }
    const periods = pastYears.map((y) => gstr9PeriodOf(y.financial_year));
    bridge.start({ mode: 'gstr9_pull', period_month: periods[0], period_months: periods }, (ok, err) => {
      if (ok) toast.success(`A GST portal tab is opening for ${periods.length} year(s) — type the CAPTCHA there. The figures fill in here when they arrive.`);
      else { toast.error(`Could not start the pull: ${err || 'the extension did not answer'}`); setPolling(null); }
    });
    setPolling(0);
  };
  useEffect(() => {
    if (polling === null || !project) return;
    if (polling >= POLL_MAX) { setPolling(null); toast.message('Stopped waiting for the portal. Years that came back are filled; fetch again for the rest.'); return; }
    const t = setTimeout(async () => {
      try {
        const got = await fetchFiledGstr9(project.client_id, pastYears.map((y) => y.financial_year));
        if (Object.keys(got).length > Object.keys(filed).length) await loadWorking();
        if (pastYears.every((y) => got[y.financial_year])) { setPolling(null); return; }
      } catch { /* keep waiting */ }
      setPolling((n) => (n === null ? null : n + 1));
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [polling, project, pastYears, filed, loadWorking]);
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
  const setT7 = (id: string, key: T7Key, head: keyof Tax, value: string) => {
    setYears((ys) => ys.map((y) => {
      if (y.id !== id) return y;
      const cur = t7(y.t7_other);
      return { ...y, t7_other: { ...cur, [key]: { ...cur[key], [head]: Number(value) || 0 } } };
    }));
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
        reversed_r42: tax(y.reversed_r42), reversed_r43: tax(y.reversed_r43), t7_other: t7(y.t7_other),
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
    base: add(a.base, add(y.baseR42, y.baseR43)),
    attributable: add(a.attributable, add(y.attributableR42, y.attributableR43)),
  }), { base: ZERO, attributable: ZERO });
  // A working figure: its total, or (By tax head) each head that is not nil.
  const amt = (t: Tax) => (byHead ? (
    <span className="block space-y-0.5">
      {HEADS.filter((h) => h !== 'x' || t.x).map((h) => (
        <span key={h} className="block whitespace-nowrap"><span className="text-[11px] text-muted-foreground">{HEAD_LABEL[h]}</span> {inr(t[h])}</span>
      ))}
    </span>
  ) : inr(total(t)));

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
            description="Figures fetched from a filed GSTR-9 are locked (a superadmin can correct them); a year whose GSTR-9 is not filed, and the BU year (April to the BU month), are entered here"
            actions={editable ? (
              <>
                <Button variant="outline" size="sm" className={WS_BTN} onClick={fetchFromPortal} disabled={busy || polling !== null || !pastYears.length}>
                  {polling !== null ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
                  {polling !== null ? 'Waiting for the portal…' : 'Fetch past years from portal'}
                </Button>
                <Button size="sm" className={WS_BTN} onClick={() => void saveAll()} disabled={busy || !dirty.size}>
                  <Save className="h-3.5 w-3.5" /> Save{dirty.size ? ` (${dirty.size})` : ''}
                </Button>
              </>
            ) : undefined}
          >
            <div className="space-y-3">
              {years.map((y) => {
                const yr = result.years.find((r) => r.financialYear === y.financial_year);
                const portal = !y.is_bu_year ? filed[y.financial_year] : undefined;
                // What a filed GSTR-9 gave is the superadmin's to change (the DB
                // refuses anyone else); a year whose GSTR-9 is not filed stays editable.
                const canType = (f: LockField) => editable && (!isLocked(y, f) || isSuperadmin);
                const lockedAll = !y.is_bu_year && !!y.portal && (['inputs_services', 'capital_goods', 'reversed_r42', 'reversed_r43', 't7_other'] as LockField[]).every((f) => isLocked(y, f));
                const cell = (value: number, typable: boolean, onChange: (v: string) => void, key: string) => (
                  <td key={key} className={cn(WS_TD, 'p-0')}>
                    {typable ? (
                      <Input
                        type="number" step="0.01" inputMode="decimal"
                        className="h-9 rounded-none border-0 bg-transparent text-right tabular-nums shadow-none"
                        value={value || ''}
                        onChange={(e) => onChange(e.target.value)}
                      />
                    ) : (
                      <span className="block px-2 py-1.5 text-right tabular-nums">{inr(value)}</span>
                    )}
                  </td>
                );
                return (
                  <div key={y.id} className="rounded-md border">
                    <div
                      role="button" tabIndex={0} aria-expanded={openYears.has(y.id)}
                      onClick={() => toggleYear(y.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleYear(y.id); } }}
                      className={cn('flex cursor-pointer flex-wrap items-center justify-between gap-2 bg-muted/50 px-3 py-1.5', openYears.has(y.id) && 'border-b')}
                    >
                      <span className="flex items-center gap-1 text-sm font-semibold">
                        {openYears.has(y.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {fyLabel(y.financial_year)}
                        {yr && <span className="ml-2 text-xs font-normal text-muted-foreground">common credit ₹{inr(total(add(yr.baseR42, yr.baseR43)))}</span>}
                        {y.is_bu_year && <Badge variant="warning" className="ml-2 text-[10px]">BU year · enter by hand</Badge>}
                      </span>
                      {portal && (
                        <span className="flex items-center gap-2">
                          <Badge variant={portal.source === 'GSTR9_FILED' ? 'success' : 'warning'} className="text-[10px]">
                            {PORTAL_SOURCE_LABEL[portal.source]}{portal.arn ? ` · ARN ${portal.arn}` : ''}
                          </Badge>
                        </span>
                      )}
                      {!y.is_bu_year && !portal && (
                        <Badge
                          variant={y.gstr9_match === 'UNVERIFIED' ? 'destructive' : 'success'}
                          className="text-[10px]"
                        >
                          {y.gstr9_match === 'UNVERIFIED' ? 'GSTR-9 not matched' : y.gstr9_match === 'MATCHED_DATA' ? 'Matches the app\'s GSTR-9 data' : 'Confirmed with filed GSTR-9'}
                        </Badge>
                      )}
                    </div>
                    {openYears.has(y.id) && (<>
                    <div className={cn(WS_TABLE_WRAP, 'rounded-none border-0')}>
                      <table className={WS_TABLE}>
                        <thead>
                          <tr>
                            <th className={WS_TH}>{y.is_bu_year ? 'April to the BU month (books / GSTR-3B)' : 'GSTR-9 Tables 6 and 7'}</th>
                            {HEADS.map((h) => <th key={h} className={cn(WS_TH, 'text-right')}>{HEAD_LABEL[h]}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {LINES.map((l) => {
                            if (l.kind === 'calc') {
                              if (!yr) return null;
                              const v = l.value(yr);
                              return (
                                <tr key={l.label} className={cn(WS_TR, 'bg-muted/30', l.strong && 'font-medium')}>
                                  <td className={WS_TD}>{l.label}{l.hint && <span className="block text-[11px] font-normal text-muted-foreground">{l.hint}</span>}</td>
                                  {HEADS.map((h) => <td key={h} className={WS_TD_NUM}>{inr(v[h])}</td>)}
                                </tr>
                              );
                            }
                            if (l.kind === 't7') {
                              const v = t7(y.t7_other)[l.key];
                              const typable = canType('t7_other');
                              return (
                                <tr key={l.key} className={WS_TR}>
                                  <td className={WS_TD}>{l.label}{isLocked(y, 't7_other') && <span className="block text-[11px] text-muted-foreground">{isSuperadmin ? 'fetched (filed GSTR-9); superadmin may correct' : 'locked (filed GSTR-9); only a superadmin can change it'}</span>}</td>
                                  {HEADS.map((h) => cell(v[h], typable, (val) => setT7(y.id, l.key, h, val), h))}
                                </tr>
                              );
                            }
                            const v = tax(y[l.field]);
                            const typable = canType(l.field);
                            return (
                              <tr key={l.field} className={WS_TR}>
                                <td className={WS_TD}>
                                  {l.label}
                                  <span className="block text-[11px] text-muted-foreground">{l.hint}{isLocked(y, l.field) ? (isSuperadmin ? ' · fetched (filed GSTR-9); superadmin may correct' : ' · locked (filed GSTR-9); only a superadmin can change it') : ''}</span>
                                </td>
                                {HEADS.map((h) => cell(v[h], typable, (val) => setYearField(y.id, l.field, h, val), h))}
                              </tr>
                            );
                          })}
                          {yr?.filed7i && !isLocked(y, 't7_other') && (
                            <tr className={cn(WS_TR, 'text-xs text-muted-foreground')}>
                              <td className={WS_TD}>7I as in the filed GSTR-9 (portal) — the rows above must add up to it</td>
                              {HEADS.map((h) => <td key={h} className={WS_TD_NUM}>{inr(yr.filed7i![h])}</td>)}
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {portal?.note && !lockedAll && (
                      <p className="border-t px-3 py-2 text-xs text-muted-foreground">{portal.note}</p>
                    )}
                    {!y.is_bu_year && (portal?.source === 'GSTR9_COMPUTED' || portal?.source === 'GSTR9_FILED_TOTALS') && (
                      <label className="flex items-center gap-2 border-t px-3 py-2 text-sm">
                        <Checkbox
                          checked={y.gstr9_match !== 'UNVERIFIED'} disabled={!editable}
                          onCheckedChange={(c) => setYearMeta(y.id, { gstr9_match: c ? 'CONFIRMED' : 'UNVERIFIED' })}
                        />
                        Table 7 above is as in the GSTR-9 filed for {fyLabel(y.financial_year)}
                      </label>
                    )}
                    {!y.is_bu_year && !portal && (
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
                    </>)}
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard
            title="Working"
            description="Per year: common credit (GSTR-9 7J + 7C + 7D) × exempt share, less what 7C/7D already reversed"
            actions={(
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={byHead} onCheckedChange={(c) => setByHead(!!c)} />
                IGST / CGST / SGST break-up
              </label>
            )}
          >
            <div className={WS_TABLE_WRAP}>
              <table className={WS_TABLE} aria-label="Rule 42/43 working">
                <thead>
                  <tr>
                    <th className={WS_TH}>Year</th>
                    <th className={cn(WS_TH, 'text-right')}>Common credit (7J + 7C + 7D)</th>
                    <th className={cn(WS_TH, 'text-right')}>Attributable to exempt</th>
                    <th className={cn(WS_TH, 'text-right')}>Net now</th>
                    {working.include_interest && <th className={cn(WS_TH, 'text-right')}>Interest (days)</th>}
                  </tr>
                </thead>
                <tbody>
                  {result.years.map((y) => (
                    <tr key={y.financialYear} className={WS_TR}>
                      <td className={WS_TD}>{fyLabel(y.financialYear)}</td>
                      <td className={WS_TD_NUM}>{amt(add(y.baseR42, y.baseR43))}</td>
                      <td className={WS_TD_NUM}>{amt(add(y.attributableR42, y.attributableR43))}</td>
                      <td className={cn(WS_TD_NUM, 'font-medium')}>{amt(y.net)}</td>
                      {working.include_interest && <td className={WS_TD_NUM}>{amt(y.interest)} ({y.interestDays} days)</td>}
                    </tr>
                  ))}
                  {totals && (
                    <tr className={WS_TR_TOTAL}>
                      <td className={WS_TD}>Total</td>
                      <td className={WS_TD_NUM}>{amt(totals.base)}</td>
                      <td className={WS_TD_NUM}>{amt(totals.attributable)}</td>
                      <td className={WS_TD_NUM}>{amt(result.totalNet)}</td>
                      {working.include_interest && <td className={WS_TD_NUM}>{amt(result.totalInterest)}</td>}
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
