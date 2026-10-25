import React, { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { SectionCard } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import { WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TR } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { prettyPeriod } from '@/lib/gstReminders';
import { toast } from 'sonner';
import { Eye, Loader2, Send, CalendarCheck } from 'lucide-react';
import {
  PLAN_RETURN_TYPES, STEP_LABEL, STEP_TEMPLATE, currentReturnPeriod, formatDate, loadReminderTemplates, queueReminders, shiftPeriod,
  type QueueItem, type QueueResult, type ReminderEmail,
} from '@/lib/reminderPlans';
import ReminderEmailComposer from './ReminderEmailComposer';

const NO_SEND = 'Needs the Send client e-mails permission — ask a GST Manager to add it to your position';
const OTHER_RETURNS = ['ITC-04', 'CMP-08', 'GSTR-1A'];

const itemKey = (i: QueueItem) => `${i.client_id}__${i.return_type}__${i.period}`;

/** Send one reminder now, whatever the dates; or check what today's run sends. */
const SendNowTab: React.FC<{ onQueued: () => void }> = ({ onQueued }) => {
  const { user, canSendClientEmails } = useAuth();
  const canSend = canSendClientEmails();
  const [period, setPeriod] = useState(currentReturnPeriod());
  const [types, setTypes] = useState<Set<string>>(new Set(['GSTR-1', 'GSTR-1 (IFF)']));
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [preview, setPreview] = useState<QueueResult | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'find' | 'send' | 'today' | 'run' | null>(null);
  const [todayPreview, setTodayPreview] = useState<QueueResult | null>(null);
  // This send's own wording, instead of the template (not saved anywhere).
  const [own, setOwn] = useState<ReminderEmail | null>(null);
  const ownOk = !own || (!!own.subject.trim() && !!own.body.trim());

  const writeOwn = async () => {
    try {
      const t = (await loadReminderTemplates())[step];
      setOwn({ subject: t?.subject ?? '', body: t?.body ?? '' });
    } catch (e) { toast.error(`Could not load the template: ${(e as Error).message}`); }
  };

  const ready = preview?.items.filter((i) => i.result === 'would_queue') ?? [];
  const skipped = preview?.items.filter((i) => i.result === 'skipped') ?? [];

  const find = async () => {
    if (!types.size) { toast.error('Choose at least one return.'); return; }
    setBusy('find');
    try {
      const r = await queueReminders({ mode: 'now', period, step, returnTypes: [...types], dryRun: true, customEmail: own });
      setPreview(r);
      setChosen(new Set(r.items.filter((i) => i.result === 'would_queue').map(itemKey)));
    } catch (e) { toast.error(`Could not list the clients: ${(e as Error).message}`); }
    setBusy(null);
  };

  const send = async () => {
    if (!canSend) { toast.error(NO_SEND); return; }
    const picked = ready.filter((i) => chosen.has(itemKey(i)));
    if (!picked.length) return;
    if (!ownOk) { toast.error('Write a subject and a message, or use the template.'); return; }
    if (!window.confirm(`Queue ${own ? 'your own e-mail' : `the ${STEP_LABEL[step].toLowerCase()}`} for ${picked.length} client${picked.length === 1 ? '' : 's'} (${prettyPeriod(period)})? It goes out within 15 minutes.`)) return;
    setBusy('send');
    let queued = 0;
    let notQueued = 0;
    try {
      // One call per return, so a client unticked for one return is not sent another.
      const byType = new Map<string, string[]>();
      for (const i of picked) byType.set(i.return_type, [...(byType.get(i.return_type) ?? []), i.client_id]);
      for (const [rt, clientIds] of byType) {
        const r = await queueReminders({ mode: 'now', period, step, returnTypes: [rt], clientIds, staffName: user?.firstName ?? null, customEmail: own });
        queued += r.queued;
        notQueued += r.items.filter((i) => i.result === 'skipped').length;
      }
      toast.success(`Queued ${queued} reminder${queued === 1 ? '' : 's'}${notQueued ? ` · ${notQueued} not queued (already reminded today)` : ''}.`);
      setPreview(null);
      setOwn(null);
      onQueued();
    } catch (e) { toast.error(`Queue failed: ${(e as Error).message}`); }
    setBusy(null);
  };

  const checkToday = async () => {
    setBusy('today');
    try {
      const [a, b] = await Promise.all([
        queueReminders({ mode: 'due', period: currentReturnPeriod(), dryRun: true }),
        queueReminders({ mode: 'due', period: shiftPeriod(currentReturnPeriod(), 1), dryRun: true }),
      ]);
      setTodayPreview({ ...a, periods: [...a.periods, ...b.periods], items: [...a.items, ...b.items], would_queue: a.would_queue + b.would_queue, skipped: a.skipped + b.skipped });
    } catch (e) { toast.error(`Could not check today's run: ${(e as Error).message}`); }
    setBusy(null);
  };

  const runToday = async () => {
    if (!canSend) { toast.error(NO_SEND); return; }
    if (!window.confirm(`Queue the ${todayPreview?.would_queue ?? ''} reminders due today now, instead of waiting for the 9:30 am run?`)) return;
    setBusy('run');
    try {
      let n = 0;
      for (const p of [currentReturnPeriod(), shiftPeriod(currentReturnPeriod(), 1)]) {
        n += (await queueReminders({ mode: 'due', period: p, staffName: user?.firstName ?? null })).queued;
      }
      toast.success(n ? `Queued ${n} reminder${n === 1 ? '' : 's'} due today.` : 'Nothing due today.');
      setTodayPreview(null);
      onQueued();
    } catch (e) { toast.error(`Queue failed: ${(e as Error).message}`); }
    setBusy(null);
  };

  const toggleType = (rt: string) => setTypes((s) => { const n = new Set(s); if (n.has(rt)) n.delete(rt); else n.add(rt); return n; });
  const skippedByReason = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of skipped) m.set(i.reason ?? 'skipped', (m.get(i.reason ?? 'skipped') ?? 0) + 1);
    return [...m.entries()];
  }, [skipped]);
  const todayDue = todayPreview?.items.filter((i) => i.result === 'would_queue') ?? [];

  return (
    <div className="space-y-3">
      <SectionCard
        title={<span className="flex items-center gap-2"><Send className="h-4 w-4" /> Send a reminder now</span>}
        description="For any period and return, whatever the dates. Only clients with reminders on whose return is still Data Pending, and never twice to the same client on one day. You see the list before anything is queued."
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              <span className="block">Return period</span>
              <Input
                type="month"
                value={`${period.slice(3)}-${period.slice(0, 2)}`}
                onChange={(e) => { const v = e.target.value; if (/^\d{4}-\d{2}$/.test(v)) { setPeriod(`${v.slice(5)}/${v.slice(0, 4)}`); setPreview(null); } }}
                className="h-8 w-[9.5rem] text-xs"
              />
            </label>
            <div className="space-y-1">
              <span className="block text-xs font-medium text-muted-foreground">Which e-mail</span>
              <div className="flex gap-1">
                {([1, 2, 3] as const).map((s) => (
                  <Button key={s} size="sm" variant={step === s ? 'default' : 'outline'} className={WS_BTN} onClick={() => { setStep(s); setPreview(null); }}>{STEP_LABEL[s]}</Button>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">Returns</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {[...PLAN_RETURN_TYPES, ...OTHER_RETURNS].map((rt) => (
                <label key={rt} className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={types.has(rt)} onCheckedChange={() => { toggleType(rt); setPreview(null); }} /> {rt}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Wording</span>
              <Button size="sm" variant={!own ? 'default' : 'outline'} className={WS_BTN} onClick={() => setOwn(null)}>The template</Button>
              <Button size="sm" variant={own ? 'default' : 'outline'} className={WS_BTN} onClick={() => { if (!own) void writeOwn(); }}>Write my own for this send</Button>
              {own && <span className="text-[11px] text-muted-foreground">Used for this send only; the template is not changed.</span>}
            </div>
            {own && (
              <ReminderEmailComposer
                value={own}
                onChange={setOwn}
                templateKey={STEP_TEMPLATE[step]}
                sample={{ return_type: [...types][0] ?? 'GSTR-1', period: prettyPeriod(period), due_date: '(its due date)', data_by_date: '(send data by)' }}
              />
            )}
          </div>
          <div>
            <Button size="sm" variant="outline" className={WS_BTN} onClick={() => void find()} disabled={busy !== null}>
              {busy === 'find' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Show who gets it
            </Button>
          </div>

          {preview && (
            <div className="space-y-2">
              {ready.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody to remind for {prettyPeriod(period)}.</p>
              ) : (
                <div className={cn(WS_TABLE_WRAP, 'max-h-[50vh]')}>
                  <table className={WS_TABLE}>
                    <thead>
                      <tr>
                        <th className={cn(WS_TH, 'w-0')}>
                          <Checkbox
                            checked={chosen.size === ready.length}
                            onCheckedChange={(v) => setChosen(v ? new Set(ready.map(itemKey)) : new Set())}
                            aria-label="All"
                          />
                        </th>
                        <th className={WS_TH}>Client</th>
                        <th className={WS_TH}>Return</th>
                        <th className={WS_TH}>Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ready.map((i) => (
                        <tr key={itemKey(i)} className={WS_TR}>
                          <td className={WS_TD}>
                            <Checkbox
                              checked={chosen.has(itemKey(i))}
                              onCheckedChange={(v) => setChosen((s) => { const n = new Set(s); if (v) n.add(itemKey(i)); else n.delete(itemKey(i)); return n; })}
                              aria-label={i.client_name}
                            />
                          </td>
                          <td className={WS_TD}>
                            <div className="font-medium">{i.client_name}</div>
                            <div className="text-xs text-muted-foreground">{i.to_email}</div>
                          </td>
                          <td className={cn(WS_TD, 'whitespace-nowrap')}>
                            {i.return_type}
                            {i.custom === 'period' && <div className="text-[11px] text-muted-foreground">this month's own e-mail</div>}
                          </td>
                          <td className={cn(WS_TD, 'whitespace-nowrap tabular-nums')}>{formatDate(i.due_date) || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {skippedByReason.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Not included: {skippedByReason.map(([r, n]) => `${n} ${r}`).join(' · ')}.
                </p>
              )}
              {ready.length > 0 && (
                <Button size="sm" className={WS_BTN} onClick={() => void send()} disabled={busy !== null || !chosen.size || !canSend || !ownOk} title={canSend ? undefined : NO_SEND}>
                  {busy === 'send' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Queue for {chosen.size} client{chosen.size === 1 ? '' : 's'}
                </Button>
              )}
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title={<span className="flex items-center gap-2"><CalendarCheck className="h-4 w-4" /> Today's scheduled reminders</span>}
        description={`The daily run at 9:30 am IST queues these by itself, for ${prettyPeriod(currentReturnPeriod())} and ${prettyPeriod(shiftPeriod(currentReturnPeriod(), 1))}. Check the list, or queue them now.`}
        actions={
          <Button size="sm" variant="outline" className={WS_BTN} onClick={() => void checkToday()} disabled={busy !== null}>
            {busy === 'today' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Check today
          </Button>
        }
      >
        {!todayPreview ? (
          <p className="text-sm text-muted-foreground">Click Check today to see what goes out today.</p>
        ) : todayDue.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is due today (or it has already been queued).</p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(todayDue.reduce<Record<string, number>>((m, i) => {
                const k = `${i.return_type} · ${prettyPeriod(i.period)} · ${STEP_LABEL[(i.step ?? 1) as 1 | 2 | 3]}`;
                m[k] = (m[k] ?? 0) + 1;
                return m;
              }, {})).map(([k, n]) => <Badge key={k} variant="info">{k}: {n}</Badge>)}
            </div>
            <Button size="sm" className={WS_BTN} onClick={() => void runToday()} disabled={busy !== null || !canSend} title={canSend ? undefined : NO_SEND}>
              {busy === 'run' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Queue today's {todayDue.length} now
            </Button>
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default SendNowTab;
