// Autopilot settings (roadmap Phase 3; audit S-13: the schedule is a setting
// the page shows, not a hard-coded promise): the master switch, pause, the
// runs and their times (IST), how many browsers, session reuse, the e-mail
// trigger and retries. A GST manager changes them; everyone else reads them.
import React, { useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Pause, Play, Power } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Note, SectionCard } from '@/components/gstr9/ui';
import { WS_BTN, WS_CONTROL } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import {
  autopilotState, hhmm, nextFiveAm, pausedUntilWords, saveAutopilotSettings, type AutopilotSettings, type AutopilotStatus,
} from '@/lib/autopilot';
import { fmtAgo } from '@/lib/noticeFormat';
import { AgentCard } from './AgentCard';
import { cn } from '@/lib/utils';

type Draft = Pick<AutopilotSettings, 'schedule_enabled' | 'morning_at' | 'afternoon_at' | 'afternoon_scope' | 'nudge_at' | 'close_at' |
  'concurrency' | 'keep_sessions' | 'email_trigger' | 'max_attempts' | 'captcha_refresh_secs'>;

const draftOf = (s: AutopilotSettings): Draft => ({
  schedule_enabled: s.schedule_enabled, morning_at: hhmm(s.morning_at), afternoon_at: hhmm(s.afternoon_at), afternoon_scope: s.afternoon_scope,
  nudge_at: hhmm(s.nudge_at), close_at: hhmm(s.close_at), concurrency: s.concurrency, keep_sessions: s.keep_sessions,
  email_trigger: s.email_trigger, max_attempts: s.max_attempts, captcha_refresh_secs: s.captcha_refresh_secs,
});

const SCOPES: { value: string; label: string }[] = [
  { value: 'priority', label: 'Only clients that need it' },
  { value: 'all', label: 'Every active client' },
  { value: 'off', label: 'No afternoon run' },
];

/** A labelled row: the control on the right (or, read-only, the value), its explanation under the label. */
const Field: React.FC<{ id: string; label: string; hint?: React.ReactNode; value?: string; children: React.ReactNode }> = ({ id, label, hint, value, children }) => (
  <div className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
    <div className="min-w-0 space-y-0.5">
      {value === undefined ? <Label htmlFor={id} className="text-sm">{label}</Label> : <div className="text-sm font-medium">{label}</div>}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
    <div className="shrink-0">{value === undefined ? children : <span className="text-sm font-semibold">{value}</span>}</div>
  </div>
);

export const SettingsTab: React.FC<{ status: AutopilotStatus | undefined; loading: boolean }> = ({ status, loading }) => {
  const uid = useId();
  const { user, canManageNoticeAlerts } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const s = status?.settings ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const canEdit = canManageNoticeAlerts();
  const actor = user ? { id: user.id, firstName: user.firstName } : null;
  const stamp = s ? `${s.updated_at}` : '';
  // Start from what is saved, and again whenever someone saves.
  useEffect(() => { if (s) setDraft(draftOf(s)); }, [stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !s) return <Skeleton className="h-96 w-full" />;
  if (!s || !draft) return <Note tone="warn">The autopilot settings are not in this database yet.</Note>;

  const state = autopilotState(s);
  const save = async (patch: Partial<AutopilotSettings>, what: string, key: string) => {
    setSaving(key);
    try {
      await saveAutopilotSettings(patch, actor);
      toast.success(what);
      qc.invalidateQueries({ queryKey: ['autopilot-status'] });
      qc.invalidateQueries({ queryKey: ['autopilot-badge'] });
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(null);
    }
  };
  const toggleMaster = async () => {
    const on = !s.enabled;
    const ok = await confirm(on ? {
      title: 'Switch the portal autopilot on?',
      description: 'The office agent starts working the queue: the scheduled runs log in to the portal for every active client, and CAPTCHAs come to the CAPTCHA wall. Nothing is filed on the portal; it only reads.',
      confirmText: 'Switch on',
    } : {
      title: 'Switch the portal autopilot off?',
      description: 'Nothing is fetched from the portal while it is off: no scheduled run, no portal e-mail sync, no report fetch. Jobs already queued wait until it is switched on again.',
      confirmText: 'Switch off', destructive: true,
    });
    if (!ok) return;
    save({ enabled: on, paused_until: null }, on ? 'The autopilot is on.' : 'The autopilot is off. Nothing is fetched until it is switched on.', 'master');
  };
  const changed = (Object.keys(draft) as (keyof Draft)[]).some((k) => String(draft[k]) !== String(draftOf(s)[k]));
  const invalid = draft.captcha_refresh_secs < 60 || draft.captcha_refresh_secs > 900 || !draft.morning_at || !draft.afternoon_at || !draft.nudge_at || !draft.close_at;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const id = (k: string) => `${uid}-${k}`;
  /** For someone who may not change settings: the saved value as text instead of a control. */
  const ro = (text: string) => (canEdit ? undefined : text);
  const onOff = (v: boolean) => (v ? 'On' : 'Off');

  return (
    <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
      <div className="min-w-0 space-y-3">
        <SectionCard title="Master switch"
          description={state === 'on' ? 'On: the office agent works the queue.' : state === 'paused' ? `Paused ${pausedUntilWords(s.paused_until)}.` : 'Off: nothing is fetched from the portal.'}
          actions={<span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', state === 'on' ? 'bg-success/15 text-success-strong' : state === 'paused' ? 'bg-warning/25 text-foreground' : 'bg-muted text-foreground')}>
            {state === 'on' ? 'On' : state === 'paused' ? 'Paused' : 'Off'}
          </span>}>
          {!canEdit && <Note tone="info">Only a GST manager can change these settings. You can read them.</Note>}
          <p className="text-xs text-muted-foreground">
            While the autopilot is off, no job is claimed: the morning and afternoon runs, portal e-mails and report fetches only wait.
            Pausing keeps everything on but stops new logins until the time you pick.
          </p>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={s.enabled ? 'outline' : 'default'} className={WS_BTN} disabled={saving === 'master'} onClick={toggleMaster}>
                {saving === 'master' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Power className="h-3.5 w-3.5" aria-hidden />}
                {s.enabled ? 'Switch off' : 'Switch on'}
              </Button>
              {s.enabled && state !== 'paused' && (
                <>
                  <Button size="sm" variant="outline" className={WS_BTN} disabled={!!saving}
                    onClick={() => save({ paused_until: new Date(Date.now() + 3_600_000).toISOString() }, 'Paused for an hour.', 'pause')}>
                    <Pause className="h-3.5 w-3.5" aria-hidden /> Pause for 1 hour
                  </Button>
                  <Button size="sm" variant="outline" className={WS_BTN} disabled={!!saving}
                    onClick={() => save({ paused_until: nextFiveAm() }, `Paused ${pausedUntilWords(nextFiveAm())}.`, 'pause')}>
                    <Pause className="h-3.5 w-3.5" aria-hidden /> Pause until 05:00
                  </Button>
                </>
              )}
              {state === 'paused' && (
                <Button size="sm" variant="outline" className={WS_BTN} disabled={!!saving} onClick={() => save({ paused_until: null }, 'Resumed.', 'pause')}>
                  <Play className="h-3.5 w-3.5" aria-hidden /> Resume now
                </Button>
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Last changed {fmtAgo(s.updated_at)}{s.updated_by_name ? ` by ${s.updated_by_name}` : ''}.
          </p>
        </SectionCard>
        <AgentCard status={status} />
      </div>

      <SectionCard title="Schedule and limits" description="Times are India time (IST).">
        <form className="divide-y" onSubmit={(e) => { e.preventDefault(); if (canEdit && changed && !invalid) save(draft, 'Settings saved.', 'form'); }}>
          <Field id={id('schedule')} value={ro(onOff(s.schedule_enabled))} label="Run on a schedule" hint="Off: only Sync now, Fetch a report and portal e-mails put clients on the queue.">
            <Switch id={id('schedule')} checked={draft.schedule_enabled} onCheckedChange={(v) => set('schedule_enabled', v)} />
          </Field>
          <Field id={id('morning')} value={ro(hhmm(s.morning_at))} label="Morning run" hint="Every active client.">
            <Input id={id('morning')} type="time" value={draft.morning_at} onChange={(e) => set('morning_at', e.target.value)} className={cn(WS_CONTROL, 'w-28')} />
          </Field>
          <Field id={id('afternoon')} value={ro(s.afternoon_scope === 'off' ? 'None' : hhmm(s.afternoon_at))} label="Afternoon run">
            <Input id={id('afternoon')} type="time" value={draft.afternoon_at} disabled={draft.afternoon_scope === 'off'}
              onChange={(e) => set('afternoon_at', e.target.value)} className={cn(WS_CONTROL, 'w-28')} />
          </Field>
          <Field id={id('scope')} value={ro(SCOPES.find((o) => o.value === s.afternoon_scope)?.label ?? s.afternoon_scope)} label="Who the afternoon run takes"
            hint="Clients that need it: a notice due within 7 days or overdue, never synced, not synced for 20 hours, or failing.">
            <Select value={draft.afternoon_scope} onValueChange={(v) => set('afternoon_scope', v)}>
              <SelectTrigger id={id('scope')} className={cn(WS_CONTROL, 'w-56')}><SelectValue /></SelectTrigger>
              <SelectContent>{SCOPES.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field id={id('nudge')} value={ro(hhmm(s.nudge_at))} label="Reminder to staff" hint={'An e-mail when clients wait for a CAPTCHA (the alert rule "CAPTCHAs waiting" must be on).'}>
            <Input id={id('nudge')} type="time" value={draft.nudge_at} onChange={(e) => set('nudge_at', e.target.value)} className={cn(WS_CONTROL, 'w-28')} />
          </Field>
          <Field id={id('close')} value={ro(hhmm(s.close_at))} label="Close the day at" hint="Whatever still waits then is closed with its reason, so every client shows why it was not read.">
            <Input id={id('close')} type="time" value={draft.close_at} onChange={(e) => set('close_at', e.target.value)} className={cn(WS_CONTROL, 'w-28')} />
          </Field>
          <Field id={id('concurrency')} value={ro(String(s.concurrency))} label="Browsers at once" hint="How many clients the office PC logs in to at the same time.">
            <Select value={String(draft.concurrency)} onValueChange={(v) => set('concurrency', Number(v))}>
              <SelectTrigger id={id('concurrency')} className={cn(WS_CONTROL, 'w-28')}><SelectValue /></SelectTrigger>
              <SelectContent>{[1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)} className="text-xs">{n} {n === 1 ? 'browser' : 'browsers'}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field id={id('keep')} value={ro(onOff(s.keep_sessions))} label="Keep portal sessions"
            hint={<>Off: log out after each client — the portal's normal behaviour. On: reuse a session that is still live, so fewer CAPTCHAs. <b className="font-semibold text-foreground">Ask the partner before switching it on.</b></>}>
            <Switch id={id('keep')} checked={draft.keep_sessions} onCheckedChange={(v) => set('keep_sessions', v)} />
          </Field>
          <Field id={id('email')} value={ro(onOff(s.email_trigger))} label="Portal e-mails queue a sync" hint="A GST portal e-mail about a client's notice puts that client at the front of the queue.">
            <Switch id={id('email')} checked={draft.email_trigger} onCheckedChange={(v) => set('email_trigger', v)} />
          </Field>
          <Field id={id('attempts')} value={ro(String(s.max_attempts))} label="Tries per job" hint="A failed try waits 5, 10, 20 … minutes before the next.">
            <Select value={String(draft.max_attempts)} onValueChange={(v) => set('max_attempts', Number(v))}>
              <SelectTrigger id={id('attempts')} className={cn(WS_CONTROL, 'w-28')}><SelectValue /></SelectTrigger>
              <SelectContent>{[1, 2, 3, 4, 5, 6].map((n) => <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field id={id('refresh')} value={ro(`${s.captcha_refresh_secs} s`)} label="New CAPTCHA after (seconds)" hint="The portal's images expire; one nobody typed is replaced after this long (60–900).">
            <Input id={id('refresh')} type="number" min={60} max={900} step={10} value={draft.captcha_refresh_secs}
              onChange={(e) => set('captcha_refresh_secs', Number(e.target.value))} className={cn(WS_CONTROL, 'w-28')} />
          </Field>
          {canEdit && (
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2.5">
              {draft.keep_sessions && !s.keep_sessions && <span className="mr-auto text-xs text-destructive-strong">Session reuse goes on when you save — has the partner agreed?</span>}
              {invalid && <span className="mr-auto text-xs text-destructive-strong">Fill every time; the CAPTCHA refresh must be 60–900 seconds.</span>}
              <Button type="button" size="sm" variant="ghost" className={WS_BTN} disabled={!changed || saving === 'form'} onClick={() => setDraft(draftOf(s))}>Undo changes</Button>
              <Button type="submit" size="sm" className={WS_BTN} disabled={!changed || invalid || saving === 'form'}>
                {saving === 'form' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Save
              </Button>
            </div>
          )}
        </form>
      </SectionCard>
    </div>
  );
};

export default SettingsTab;
