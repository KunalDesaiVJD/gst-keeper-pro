// The autopilot's kill switch (roadmap Phase 3; audit S-13): on, off, or paused
// for an hour or until 05:00. A GST manager changes it; everyone else reads it.
// Shown on the scheduled-Chrome overview and in Settings; it says what switching
// on starts for the runner the settings name (the firm's Chrome, or the office
// agent and its CAPTCHA wall).
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Pause, Play, Power } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Note } from '@/components/gstr9/ui';
import { SectionCard } from '@/components/notices/ui/Panel';
import { WS_BTN } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import {
  autopilotState, nextFiveAm, pausedUntilWords, runnerMode, saveAutopilotSettings, type AutopilotSettings, type AutopilotStatus,
} from '@/lib/autopilot';
import { fmtAgo } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

export const MasterSwitch: React.FC<{ status: AutopilotStatus | undefined }> = ({ status }) => {
  const { user, canManageNoticeAlerts } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [saving, setSaving] = useState<string | null>(null);
  const s = status?.settings ?? null;
  if (!s) return null;
  const canEdit = canManageNoticeAlerts();
  const chrome = runnerMode(status) === 'chrome';
  const state = autopilotState(s);
  const actor = user ? { id: user.id, firstName: user.firstName } : null;

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
  const toggle = async () => {
    const on = !s.enabled;
    const ok = await confirm(on ? {
      title: 'Switch the portal autopilot on?',
      description: chrome
        ? 'The scheduled Chrome starts working the queue: the scheduled runs log in to the portal for every active client in that Chrome, where its CAPTCHA extension fills the CAPTCHA. Nothing is filed on the portal; it only reads.'
        : 'The office agent starts working the queue: the scheduled runs log in to the portal for every active client, and CAPTCHAs come to the CAPTCHA wall. Nothing is filed on the portal; it only reads.',
      confirmText: 'Switch on',
    } : {
      title: 'Switch the portal autopilot off?',
      description: 'Nothing is fetched from the portal while it is off: no scheduled run, no portal e-mail sync, no report fetch. Jobs already queued wait until it is switched on again.',
      confirmText: 'Switch off', destructive: true,
    });
    if (!ok) return;
    save({ enabled: on, paused_until: null }, on ? 'The autopilot is on.' : 'The autopilot is off. Nothing is fetched until it is switched on.', 'master');
  };

  return (
    <SectionCard title="Autopilot switch"
      description={state === 'on' ? `On: ${chrome ? 'the scheduled Chrome' : 'the office agent'} works the queue.`
        : state === 'paused' ? `Paused ${pausedUntilWords(s.paused_until)}.` : 'Off: nothing is fetched from the portal.'}
      actions={<span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', state === 'on' ? 'bg-success/15 text-success-strong' : state === 'paused' ? 'bg-warning/25 text-foreground' : 'bg-muted text-foreground')}>
        {state === 'on' ? 'On' : state === 'paused' ? 'Paused' : 'Off'}
      </span>}>
      {!canEdit && <Note tone="info">Only a GST manager can change the autopilot's settings. You can read them.</Note>}
      <p className="text-xs text-muted-foreground">
        While the autopilot is off, no job is claimed: the morning and afternoon runs, portal e-mails and report fetches only wait.
        Pausing keeps everything on but stops new logins until the time you pick; a client already logged in finishes its pull.
      </p>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={s.enabled ? 'outline' : 'default'} className={WS_BTN} disabled={saving === 'master'} onClick={toggle}>
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
  );
};

export default MasterSwitch;
