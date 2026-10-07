// Autopilot settings (roadmap Phase 3; audit S-13: the schedule is a setting
// the page shows, not a hard-coded promise): the master switch, pause, the
// runs and their times (IST), retries, the e-mail trigger and, for the runner
// the settings name, its own limits — the scheduled Chrome's CAPTCHA wait, or
// the office agent's browsers, session reuse, CAPTCHA refresh and 09:00 nudge.
// A GST manager changes them; everyone else reads them.
import React, { useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Note } from '@/components/gstr9/ui';
import { SectionCard } from '@/components/notices/ui/Panel';
import { WS_BTN, WS_CONTROL } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { hhmm, runnerMode, saveAutopilotSettings, type AutopilotSettings, type AutopilotStatus } from '@/lib/autopilot';
import { AgentCard } from './AgentCard';
import { MasterSwitch } from './MasterSwitch';
import { cn } from '@/lib/utils';

type Draft = Pick<AutopilotSettings, 'schedule_enabled' | 'morning_at' | 'afternoon_at' | 'afternoon_scope' | 'nudge_at' | 'close_at' |
  'concurrency' | 'keep_sessions' | 'email_trigger' | 'max_attempts' | 'captcha_refresh_secs' | 'captcha_wait_secs'>;

const draftOf = (s: AutopilotSettings): Draft => ({
  schedule_enabled: s.schedule_enabled, morning_at: hhmm(s.morning_at), afternoon_at: hhmm(s.afternoon_at), afternoon_scope: s.afternoon_scope,
  nudge_at: hhmm(s.nudge_at), close_at: hhmm(s.close_at), concurrency: s.concurrency, keep_sessions: s.keep_sessions,
  email_trigger: s.email_trigger, max_attempts: s.max_attempts, captcha_refresh_secs: s.captcha_refresh_secs,
  captcha_wait_secs: s.captcha_wait_secs ?? 120,
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
  const s = status?.settings ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const canEdit = canManageNoticeAlerts();
  const actor = user ? { id: user.id, firstName: user.firstName } : null;
  const stamp = s ? `${s.updated_at}` : '';
  // Start from what is saved, and again whenever someone saves.
  useEffect(() => { if (s) setDraft(draftOf(s)); }, [stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !s) return <Skeleton className="h-96 w-full" />;
  if (!s || !draft) return <Note tone="warn">The autopilot settings are not in this database yet.</Note>;

  const chrome = runnerMode(status) === 'chrome';
  const save = async () => {
    setSaving(true);
    try {
      await saveAutopilotSettings(draft, actor);
      toast.success('Settings saved.');
      qc.invalidateQueries({ queryKey: ['autopilot-status'] });
      qc.invalidateQueries({ queryKey: ['autopilot-badge'] });
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };
  const changed = (Object.keys(draft) as (keyof Draft)[]).some((k) => String(draft[k]) !== String(draftOf(s)[k]));
  const badWait = chrome && (draft.captcha_wait_secs < 30 || draft.captcha_wait_secs > 900);
  const badRefresh = !chrome && (draft.captcha_refresh_secs < 60 || draft.captcha_refresh_secs > 900);
  const invalid = badWait || badRefresh || !draft.morning_at || !draft.afternoon_at || !draft.nudge_at || !draft.close_at;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const id = (k: string) => `${uid}-${k}`;
  /** For someone who may not change settings: the saved value as text instead of a control. */
  const ro = (text: string) => (canEdit ? undefined : text);
  const onOff = (v: boolean) => (v ? 'On' : 'Off');

  return (
    <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
      <div className="min-w-0 space-y-3">
        <MasterSwitch status={status} />
        <AgentCard status={status} />
      </div>

      <SectionCard title="Schedule and limits" description="Times are India time (IST).">
        <form className="divide-y" onSubmit={(e) => { e.preventDefault(); if (canEdit && changed && !invalid) save(); }}>
          <Field id={id('schedule')} value={ro(onOff(s.schedule_enabled))} label="Run on a schedule" hint="Off: only Sync now, Fetch a report and portal e-mails put clients on the queue.">
            <Switch id={id('schedule')} checked={draft.schedule_enabled} onCheckedChange={(v) => set('schedule_enabled', v)} />
          </Field>
          <Field id={id('morning')} value={ro(hhmm(s.morning_at))} label="Morning run"
            hint={chrome ? 'Every active client. A run that finds the scheduled Chrome closed starts when it opens within 3 hours.' : 'Every active client.'}>
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
          {chrome && (
            <Field id={id('wait')} value={ro(`${s.captcha_wait_secs ?? 120} s`)} label="Wait for the CAPTCHA (seconds)"
              hint="How long the scheduled Chrome waits for its CAPTCHA extension to fill the CAPTCHA (30–900). Not filled in time: the client is tried again later.">
              <Input id={id('wait')} type="number" min={30} max={900} step={10} value={draft.captcha_wait_secs}
                onChange={(e) => set('captcha_wait_secs', Number(e.target.value))} className={cn(WS_CONTROL, 'w-28')} />
            </Field>
          )}
          {!chrome && (
            <Field id={id('nudge')} value={ro(hhmm(s.nudge_at))} label="Reminder to staff" hint={'An e-mail when clients wait for a CAPTCHA (the alert rule "CAPTCHAs waiting" must be on).'}>
              <Input id={id('nudge')} type="time" value={draft.nudge_at} onChange={(e) => set('nudge_at', e.target.value)} className={cn(WS_CONTROL, 'w-28')} />
            </Field>
          )}
          <Field id={id('close')} value={ro(hhmm(s.close_at))} label="Close the day at" hint="Whatever still waits then is closed with its reason, so every client shows why it was not read.">
            <Input id={id('close')} type="time" value={draft.close_at} onChange={(e) => set('close_at', e.target.value)} className={cn(WS_CONTROL, 'w-28')} />
          </Field>
          {!chrome && (
            <>
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
            </>
          )}
          <Field id={id('email')} value={ro(onOff(s.email_trigger))} label="Portal e-mails queue a sync" hint="A GST portal e-mail about a client's notice puts that client at the front of the queue.">
            <Switch id={id('email')} checked={draft.email_trigger} onCheckedChange={(v) => set('email_trigger', v)} />
          </Field>
          <Field id={id('attempts')} value={ro(String(s.max_attempts))} label="Tries per job" hint="A failed try waits 5, 10, 20 … minutes before the next.">
            <Select value={String(draft.max_attempts)} onValueChange={(v) => set('max_attempts', Number(v))}>
              <SelectTrigger id={id('attempts')} className={cn(WS_CONTROL, 'w-28')}><SelectValue /></SelectTrigger>
              <SelectContent>{[1, 2, 3, 4, 5, 6].map((n) => <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {!chrome && (
            <Field id={id('refresh')} value={ro(`${s.captcha_refresh_secs} s`)} label="New CAPTCHA after (seconds)" hint="The portal's images expire; one nobody typed is replaced after this long (60–900).">
              <Input id={id('refresh')} type="number" min={60} max={900} step={10} value={draft.captcha_refresh_secs}
                onChange={(e) => set('captcha_refresh_secs', Number(e.target.value))} className={cn(WS_CONTROL, 'w-28')} />
            </Field>
          )}
          {canEdit && (
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2.5">
              {!chrome && draft.keep_sessions && !s.keep_sessions && <span className="mr-auto text-xs text-destructive-strong">Session reuse goes on when you save — has the partner agreed?</span>}
              {invalid && (
                <span className="mr-auto text-xs text-destructive-strong">
                  Fill every time; {chrome ? 'the CAPTCHA wait must be 30–900 seconds' : 'the CAPTCHA refresh must be 60–900 seconds'}.
                </span>
              )}
              <Button type="button" size="sm" variant="ghost" className={WS_BTN} disabled={!changed || saving} onClick={() => setDraft(draftOf(s))}>Undo changes</Button>
              <Button type="submit" size="sm" className={WS_BTN} disabled={!changed || invalid || saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Save
              </Button>
            </div>
          )}
        </form>
      </SectionCard>
    </div>
  );
};

export default SettingsTab;
