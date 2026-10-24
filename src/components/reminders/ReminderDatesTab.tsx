import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/gstr9/badge';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TR } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { prettyPeriod } from '@/lib/gstReminders';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Loader2, Pencil, RotateCcw, CalendarRange, AlertTriangle, CheckCircle2, Clock, MoveLeft } from 'lucide-react';
import {
  PLAN_RETURN_TYPES, STEPS, STEP_LABEL, type PeriodPlanRow, type ResolvedPlan, type StandardScheduleRow, type ReminderSent,
  addDays, clearPeriodPlan, currentReturnPeriod, formatDate, loadPeriodPlans, loadRemindersFor, loadStandardSchedule,
  periodStart, planProblems, resolvePlan, returnFiledForPeriod, savePeriodPlan, shiftPeriod, todayIST,
} from '@/lib/reminderPlans';
import StandardScheduleCard from './StandardScheduleCard';

const NO_EDIT = 'Needs the E-mail templates & reminder rules permission — ask a GST Manager to add it to your position';

type Draft = {
  due_date: string; due_date_y: string; data_by_date: string;
  r1: string; r2: string; r3: string; note: string;
};

const toDraft = (p: ResolvedPlan): Draft => ({
  due_date: p.dueDate, due_date_y: p.dueDateY ?? '', data_by_date: p.dataByDate,
  r1: p.dates[1] ?? '', r2: p.dates[2] ?? '', r3: p.dates[3] ?? '', note: p.note ?? '',
});

const toRow = (period: string, returnType: string, d: Draft): PeriodPlanRow => ({
  period_month: period, return_type: returnType,
  due_date: d.due_date, due_date_y: d.due_date_y || null, data_by_date: d.data_by_date || null,
  reminder_1_date: d.r1 || null, reminder_2_date: d.r2 || null, reminder_final_date: d.r3 || null,
  note: d.note.trim() || null,
});

/** Reminder dates for one return period: what goes out when, changeable for this period only. */
const ReminderDatesTab: React.FC = () => {
  const { user, canManageEmailTemplates } = useAuth();
  const canEdit = canManageEmailTemplates();
  const [period, setPeriod] = useState(currentReturnPeriod());
  const [standard, setStandard] = useState<StandardScheduleRow[]>([]);
  const [plans, setPlans] = useState<PeriodPlanRow[]>([]);
  const [sent, setSent] = useState<ReminderSent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ returnType: string; draft: Draft; plan: ResolvedPlan } | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const today = todayIST();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, r] = await Promise.all([loadStandardSchedule(), loadPeriodPlans([period]), loadRemindersFor([period])]);
      setStandard(s); setPlans(p); setSent(r);
    } catch (e) {
      toast.error(`Could not load the reminder dates: ${(e as Error).message}`);
    }
    setLoading(false);
  }, [period]);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => PLAN_RETURN_TYPES.map((rt) => ({
    returnType: rt,
    filed: returnFiledForPeriod(rt, period),
    plan: resolvePlan(period, rt, standard, plans),
  })), [period, standard, plans]);

  // How many reminders of each step have been queued / sent for this period.
  const sentCount = useMemo(() => {
    const m = new Map<string, { queued: number; sent: number }>();
    for (const r of sent) {
      if (!r.reminder_step || r.status === 'cancelled') continue;
      const k = `${r.return_type}__${r.reminder_step}`;
      const e = m.get(k) ?? { queued: 0, sent: 0 };
      if (r.status === 'sent') e.sent++; else if (r.status === 'pending' || r.status === 'sending') e.queued++;
      m.set(k, e);
    }
    return m;
  }, [sent]);

  const thisMonth = shiftPeriod(currentReturnPeriod(), 1);
  const periodChips = [
    { p: currentReturnPeriod(), label: `Filing now · ${prettyPeriod(currentReturnPeriod())}` },
    { p: thisMonth, label: `Next · ${prettyPeriod(thisMonth)}` },
  ];

  const dateCell = (rt: string, plan: ResolvedPlan, step: 1 | 2 | 3) => {
    const d = plan.dates[step];
    if (!d) return <span className="text-xs text-muted-foreground">Not sent</span>;
    const c = sentCount.get(`${rt}__${step}`);
    const state = d < today ? 'past' : d === today ? 'today' : 'upcoming';
    return (
      <div className="space-y-0.5">
        <div className={cn('whitespace-nowrap tabular-nums', state === 'past' && !c && 'text-muted-foreground')}>{formatDate(d)}</div>
        {c && (c.sent || c.queued) ? (
          <div className="flex items-center gap-1 text-[11px] text-success-strong">
            <CheckCircle2 className="h-3 w-3" />{c.sent ? `${c.sent} sent` : ''}{c.sent && c.queued ? ' · ' : ''}{c.queued ? `${c.queued} queued` : ''}
          </div>
        ) : state === 'today' ? (
          <div className="flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400"><Clock className="h-3 w-3" />Today</div>
        ) : null}
      </div>
    );
  };

  const openEdit = (returnType: string, plan: ResolvedPlan) => {
    if (!canEdit) { toast.error(NO_EDIT); return; }
    setEditing({ returnType, plan, draft: toDraft(plan) });
  };

  const resetToStandard = async (returnType: string) => {
    if (!canEdit) { toast.error(NO_EDIT); return; }
    if (!window.confirm(`Use the standard dates again for ${returnType}, ${prettyPeriod(period)}?`)) return;
    try {
      await clearPeriodPlan(period, returnType);
      toast.success(`${returnType} ${prettyPeriod(period)} is back on the standard dates.`);
      void load();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-3">
      <SectionCard
        title={<span className="flex items-center gap-2"><CalendarRange className="h-4 w-4" /> Reminder dates for {prettyPeriod(period)}</span>}
        description="Pick a return period to see when each reminder goes out. Change any date for this period only, for example to send before Diwali or to follow a CBIC extension. Other periods keep the standard dates."
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size="sm" className={WS_BTN} onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Previous period"><ChevronLeft className="h-3.5 w-3.5" /></Button>
            <Input
              type="month"
              aria-label="Return period"
              value={`${period.slice(3)}-${period.slice(0, 2)}`}
              onChange={(e) => { const v = e.target.value; if (/^\d{4}-\d{2}$/.test(v)) setPeriod(`${v.slice(5)}/${v.slice(0, 4)}`); }}
              className="h-8 w-[9.5rem] text-xs"
            />
            <Button variant="outline" size="sm" className={WS_BTN} onClick={() => setPeriod(shiftPeriod(period, 1))} aria-label="Next period"><ChevronRight className="h-3.5 w-3.5" /></Button>
            {periodChips.map((c) => (
              <Button key={c.p} size="sm" variant={c.p === period ? 'default' : 'ghost'} className={WS_BTN} onClick={() => setPeriod(c.p)}>{c.label}</Button>
            ))}
          </div>
        }
      >
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className={WS_TABLE_WRAP}>
              <table className={WS_TABLE}>
                <thead>
                  <tr>
                    <th className={WS_TH}>Return</th>
                    <th className={WS_TH}>Due date</th>
                    {STEPS.map((s) => <th key={s} className={WS_TH}>{STEP_LABEL[s]}</th>)}
                    <th className={WS_TH}>Send data by</th>
                    <th className={WS_TH}>Dates</th>
                    <th className={cn(WS_TH, 'w-0')} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ returnType, filed, plan }) => (
                    <tr key={returnType} className={cn(WS_TR, 'align-top')}>
                      <td className={cn(WS_TD, 'whitespace-nowrap font-medium')}>{returnType}</td>
                      {!filed ? (
                        <td className={cn(WS_TD, 'text-xs text-muted-foreground')} colSpan={7}>Not filed for {prettyPeriod(period)}: quarterly, filed for March, June, September and December.</td>
                      ) : !plan ? (
                        <td className={cn(WS_TD, 'text-xs text-muted-foreground')} colSpan={7}>No standard dates set.</td>
                      ) : (
                        <>
                          <td className={cn(WS_TD, 'whitespace-nowrap tabular-nums')}>
                            {formatDate(plan.dueDate)}
                            {plan.dueDateY && plan.dueDateY !== plan.dueDate && (
                              <div className="text-[11px] text-muted-foreground" title="Delhi, Punjab, UP, Bihar, West Bengal and the other states of the 24th group">{formatDate(plan.dueDateY)} for the 24th group</div>
                            )}
                            {today > (plan.dueDateY ?? plan.dueDate) && <div className="text-[11px] text-muted-foreground">Passed</div>}
                          </td>
                          {STEPS.map((s) => <td key={s} className={WS_TD}>{dateCell(returnType, plan, s)}</td>)}
                          <td className={cn(WS_TD, 'whitespace-nowrap tabular-nums')}>{formatDate(plan.dataByDate)}</td>
                          <td className={WS_TD}>
                            {plan.source === 'period'
                              ? <Badge variant="info" title={plan.note ?? undefined}>Changed for {prettyPeriod(period).split(' ')[0]}</Badge>
                              : <Badge variant="secondary">Standard</Badge>}
                            {plan.note && <div className="mt-0.5 max-w-[12rem] truncate text-[11px] text-muted-foreground" title={plan.note}>{plan.note}</div>}
                          </td>
                          <td className={cn(WS_TD, 'whitespace-nowrap')}>
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" className={WS_BTN} disabled={!canEdit} title={canEdit ? `Change ${returnType} dates for ${prettyPeriod(period)}` : NO_EDIT} onClick={() => openEdit(returnType, plan)}>
                                <Pencil className="h-3.5 w-3.5" /> Change
                              </Button>
                              {plan.source === 'period' && (
                                <Button size="sm" variant="ghost" className={WS_BTN} disabled={!canEdit} title="Use the standard dates again" onClick={() => void resetToStandard(returnType)}>
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
              <span>
                The daily run at 9:30 am IST sends each client at most one reminder a day: the latest one whose date has come.
                A reminder whose date was missed is skipped, and nothing goes out after the due date or once the return is no longer Data Pending.
              </span>
              <Button size="sm" variant="outline" className={WS_BTN} disabled={!canEdit} title={canEdit ? undefined : NO_EDIT} onClick={() => setShiftOpen(true)}>
                <MoveLeft className="h-3.5 w-3.5" /> Move several returns' reminders
              </Button>
            </div>
          </>
        )}
      </SectionCard>

      <StandardScheduleCard onSaved={() => void load()} />

      {editing && (
        <EditPlanDialog
          period={period}
          returnType={editing.returnType}
          initial={editing.draft}
          today={today}
          sentSteps={STEPS.filter((s) => sentCount.has(`${editing.returnType}__${s}`))}
          onClose={() => setEditing(null)}
          onSave={async (draft) => {
            await savePeriodPlan(toRow(period, editing.returnType, draft), { id: user?.id ?? null, name: user?.firstName ?? null });
            toast.success(`${editing.returnType} ${prettyPeriod(period)}: dates saved.`);
            setEditing(null);
            void load();
          }}
        />
      )}

      {shiftOpen && (
        <ShiftDialog
          period={period}
          rows={rows.filter((r) => r.filed && r.plan).map((r) => ({ returnType: r.returnType, plan: r.plan! }))}
          onClose={() => setShiftOpen(false)}
          onSave={async (changes) => {
            for (const c of changes) {
              await savePeriodPlan(toRow(period, c.returnType, c.draft), { id: user?.id ?? null, name: user?.firstName ?? null });
            }
            toast.success(`Dates saved for ${changes.length} return${changes.length === 1 ? '' : 's'}, ${prettyPeriod(period)}.`);
            setShiftOpen(false);
            void load();
          }}
        />
      )}
    </div>
  );
};

// ── Change one return's dates ─────────────────────────────────────────────────
const EditPlanDialog: React.FC<{
  period: string;
  returnType: string;
  initial: Draft;
  today: string;
  sentSteps: number[];
  onClose: () => void;
  onSave: (d: Draft) => Promise<void>;
}> = ({ period, returnType, initial, today, sentSteps, onClose, onSave }) => {
  const [d, setD] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [shiftBy, setShiftBy] = useState(3);
  const problems = planProblems({
    period_month: period, due_date: d.due_date, due_date_y: d.due_date_y || null, data_by_date: d.data_by_date || null,
    reminder_1_date: d.r1 || null, reminder_2_date: d.r2 || null, reminder_final_date: d.r3 || null,
  });
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD((x) => ({ ...x, [k]: e.target.value }));
  const minDate = periodStart(period);
  const passed = ([['r1', 1], ['r2', 2], ['r3', 3]] as const).filter(([k, s]) => d[k] && d[k] < today && !sentSteps.includes(s));
  const shift = (days: number) => setD((x) => ({
    ...x,
    r1: x.r1 ? addDays(x.r1, days) : '', r2: x.r2 ? addDays(x.r2, days) : '', r3: x.r3 ? addDays(x.r3, days) : '',
    data_by_date: x.data_by_date ? addDays(x.data_by_date, days) : '',
  }));

  const field = (label: string, k: keyof Draft, hint?: string, optional = false) => (
    <label className="grid grid-cols-[9rem_1fr] items-center gap-2 text-sm">
      <span className="font-medium">{label}{hint && <span className="block text-[11px] font-normal text-muted-foreground">{hint}</span>}</span>
      <span className="flex items-center gap-1.5">
        <Input type="date" min={minDate} value={d[k]} onChange={set(k)} className="h-8 w-[10.5rem] text-sm" />
        {optional && d[k] && <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setD((x) => ({ ...x, [k]: '' }))}>Don't send</Button>}
        {d[k] && <span className="text-xs text-muted-foreground">{formatDate(d[k])}</span>}
      </span>
    </label>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">{returnType} · {prettyPeriod(period)}</DialogTitle>
          <DialogDescription>These dates apply to {prettyPeriod(period)} only. Any date from {formatDate(minDate)} up to the due date works.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2.5">
          {field('Due date', 'due_date', 'Move it if CBIC extends the date')}
          {returnType === 'GSTR-3B (Q)' && field('Due, 24th group', 'due_date_y', 'Delhi, Punjab, UP, West Bengal …')}
          <div className="my-1 border-t" />
          {field('1st reminder', 'r1', undefined, true)}
          {field('2nd reminder', 'r2', undefined, true)}
          {field('Final reminder', 'r3', undefined, true)}
          {field('Send data by', 'data_by_date', 'Shown in the e-mail')}
          <div className="flex flex-wrap items-center gap-1.5 pl-[9.5rem] text-xs">
            <span className="text-muted-foreground">Move all reminders</span>
            <Input type="number" min={1} max={30} value={shiftBy} onChange={(e) => setShiftBy(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} className="h-7 w-14 text-xs" />
            <span className="text-muted-foreground">days</span>
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => shift(-shiftBy)}>Earlier</Button>
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => shift(shiftBy)}>Later</Button>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Note <span className="font-normal text-muted-foreground">(optional, e.g. "Diwali: brought forward")</span></span>
            <Textarea rows={2} value={d.note} onChange={set('note')} className="text-sm" />
          </label>
          {sentSteps.length > 0 && (
            <p className="rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
              Already queued or sent for this period: {sentSteps.map((s) => STEP_LABEL[s as 1 | 2 | 3].toLowerCase()).join(', ')}. Those are never sent again.
            </p>
          )}
          {passed.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-md border border-warning/50 bg-warning/10 px-2.5 py-1.5 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {passed.map(([, s]) => STEP_LABEL[s]).join(', ')} {passed.length === 1 ? 'is' : 'are'} before today, so {passed.length === 1 ? 'it' : 'they'} will be skipped unless a later reminder is also due. Use Send now to send one today.
            </p>
          )}
          {problems.length > 0 && (
            <ul className="space-y-0.5 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive-strong">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving || problems.length > 0}
            onClick={async () => {
              setSaving(true);
              try { await onSave(d); } catch (e) { toast.error((e as Error).message); }
              setSaving(false);
            }}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save for {prettyPeriod(period)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── Move several returns at once (Diwali, a holiday, an extension) ─────────────
const ShiftDialog: React.FC<{
  period: string;
  rows: { returnType: string; plan: ResolvedPlan }[];
  onClose: () => void;
  onSave: (changes: { returnType: string; draft: Draft }[]) => Promise<void>;
}> = ({ period, rows, onClose, onSave }) => {
  const [chosen, setChosen] = useState<Set<string>>(new Set(rows.map((r) => r.returnType)));
  const [days, setDays] = useState(5);
  const [direction, setDirection] = useState<-1 | 1>(-1);
  const [moveDue, setMoveDue] = useState(false);
  const [saving, setSaving] = useState(false);

  const changes = rows.filter((r) => chosen.has(r.returnType)).map(({ returnType, plan }) => {
    const by = direction * days;
    const base = toDraft(plan);
    const mv = (x: string) => (x ? addDays(x, by) : '');
    const draft: Draft = {
      ...base,
      r1: mv(base.r1), r2: mv(base.r2), r3: mv(base.r3), data_by_date: mv(base.data_by_date),
      due_date: moveDue ? mv(base.due_date) : base.due_date,
      due_date_y: moveDue ? mv(base.due_date_y) : base.due_date_y,
      note: base.note || (direction < 0 ? `Brought forward ${days} days` : `Moved ${days} days later`),
    };
    const problems = planProblems({
      period_month: period, due_date: draft.due_date, due_date_y: draft.due_date_y || null, data_by_date: draft.data_by_date || null,
      reminder_1_date: draft.r1 || null, reminder_2_date: draft.r2 || null, reminder_final_date: draft.r3 || null,
    });
    return { returnType, draft, problems };
  });
  const bad = changes.filter((c) => c.problems.length);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">Move reminders · {prettyPeriod(period)}</DialogTitle>
          <DialogDescription>Move the reminders of several returns by the same number of days, for {prettyPeriod(period)} only.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span>Move by</span>
            <Input type="number" min={1} max={40} value={days} onChange={(e) => setDays(Math.max(1, Math.min(40, Number(e.target.value) || 1)))} className="h-8 w-16" />
            <span>days</span>
            <Button size="sm" variant={direction < 0 ? 'default' : 'outline'} className={WS_BTN} onClick={() => setDirection(-1)}>Earlier</Button>
            <Button size="sm" variant={direction > 0 ? 'default' : 'outline'} className={WS_BTN} onClick={() => setDirection(1)}>Later</Button>
            <label className="ml-2 flex items-center gap-1.5"><Checkbox checked={moveDue} onCheckedChange={(v) => setMoveDue(!!v)} /> Move the due date too (an extension)</label>
          </div>
          <div className={WS_TABLE_WRAP}>
            <table className={WS_TABLE}>
              <thead>
                <tr>
                  <th className={cn(WS_TH, 'w-0')} />
                  <th className={WS_TH}>Return</th>
                  <th className={WS_TH}>Reminders</th>
                  <th className={WS_TH}>Due</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td className={WS_TD} colSpan={4}>No returns for this period.</td></tr>
                )}
                {rows.map(({ returnType }) => {
                  const c = changes.find((x) => x.returnType === returnType);
                  return (
                    <tr key={returnType} className={WS_TR}>
                      <td className={WS_TD}>
                        <Checkbox
                          checked={chosen.has(returnType)}
                          onCheckedChange={(v) => setChosen((s) => { const n = new Set(s); if (v) n.add(returnType); else n.delete(returnType); return n; })}
                          aria-label={returnType}
                        />
                      </td>
                      <td className={cn(WS_TD, 'font-medium')}>{returnType}</td>
                      <td className={cn(WS_TD, 'text-xs tabular-nums')}>
                        {c ? [c.draft.r1, c.draft.r2, c.draft.r3].filter(Boolean).map(formatDate).join(' · ') : '—'}
                        {c?.problems.length ? <div className="text-destructive-strong">{c.problems[0]}</div> : null}
                      </td>
                      <td className={cn(WS_TD, 'text-xs tabular-nums')}>{c ? formatDate(c.draft.due_date) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving || !changes.length || bad.length > 0}
            onClick={async () => {
              setSaving(true);
              try { await onSave(changes); } catch (e) { toast.error((e as Error).message); }
              setSaving(false);
            }}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save {changes.length} return{changes.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReminderDatesTab;
