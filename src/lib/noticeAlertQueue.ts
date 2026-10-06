// Notice alerts are generated in the database (public.notice_alerts_run,
// migration 20261006115000): pg_cron runs it every 15 minutes for events
// (new notice, assignment, portal updates, sync anomalies), at 09:30 IST for
// the morning reminders and on Mondays for the MIS. This wrapper only runs it
// on demand ("Run alerts"); it never writes the same alert twice, so pressing
// it again is harmless. While notice_settings.alerts_mode is 'preview' the
// alerts land in Reminders → Email outbox with status "preview" and are not sent.
import { supabase } from '@/integrations/supabase/client';

export type AlertsMode = 'off' | 'preview' | 'live';
export type AlertRunMode = 'events' | 'daily' | 'weekly' | 'all';

export interface AlertRunResult {
  queued: number;
  alertsMode: AlertsMode | null;
  error: string | null;
}

interface RunPayload {
  alerts_mode?: AlertsMode;
  events?: { queued?: number };
  daily?: { queued?: number };
  weekly?: { queued?: number };
}

export async function runNoticeAlerts(mode: AlertRunMode = 'all'): Promise<AlertRunResult> {
  const { data, error } = await supabase.rpc('notice_alerts_run', { p_mode: mode });
  if (error) {
    const missing = /notice_alerts_run/.test(error.message) && /(find|exist)/i.test(error.message);
    return {
      queued: 0,
      alertsMode: null,
      error: missing
        ? 'The alert engine is not installed on the database yet (migration 20261006115000).'
        : `Alerts failed: ${error.message}`,
    };
  }
  const p = (data ?? {}) as RunPayload;
  const queued = (p.events?.queued ?? 0) + (p.daily?.queued ?? 0) + (p.weekly?.queued ?? 0);
  return { queued, alertsMode: p.alerts_mode ?? null, error: null };
}

export function describeAlertRun(r: AlertRunResult): string {
  const n = `${r.queued} alert${r.queued === 1 ? '' : 's'}`;
  if (r.alertsMode === 'off') return 'Alerts are switched off — nothing was written.';
  if (r.queued === 0) return 'No new alerts due right now.';
  if (r.alertsMode === 'live') return `${n} queued for sending.`;
  return `${n} written as previews (preview mode — nothing was e-mailed). See Reminders → Email outbox.`;
}

export async function setAlertsMode(mode: AlertsMode, by: string | null): Promise<string | null> {
  const { error } = await supabase.from('notice_settings')
    .update({ alerts_mode: mode, alerts_mode_changed_at: new Date().toISOString(), updated_by: by })
    .eq('id', true);
  return error ? error.message : null;
}
