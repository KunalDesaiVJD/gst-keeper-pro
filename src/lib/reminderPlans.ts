// GST data reminders: data access for the GST Reminders page. The date rules
// live in supabase/functions/_shared/reminderPlan.ts (shared with the daily
// job queue-gst-reminders, so the page shows exactly what the job will do).
import { supabase } from '@/integrations/supabase/client';
import type { PeriodPlanRow, StandardScheduleRow } from '../../supabase/functions/_shared/reminderPlan.ts';

export * from '../../supabase/functions/_shared/reminderPlan.ts';

/** One reminder row of email_outbox, as the page needs it. */
export interface ReminderSent {
  id: string;
  client_id: string;
  return_type: string;
  period_month: string;
  reminder_step: number | null;
  status: string;
  created_at: string;
  sent_at: string | null;
}

export async function loadStandardSchedule(): Promise<StandardScheduleRow[]> {
  const { data, error } = await supabase.from('return_reminder_schedules').select('*');
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as StandardScheduleRow[];
}

export async function saveStandardSchedule(rows: StandardScheduleRow[], userId: string | null): Promise<void> {
  const { error } = await supabase
    .from('return_reminder_schedules')
    .upsert(rows.map((r) => ({ ...r, updated_by: userId })) as never, { onConflict: 'return_type' });
  if (error) throw new Error(friendlyCheck(error.message));
}

export async function loadPeriodPlans(periods: string[]): Promise<PeriodPlanRow[]> {
  const { data, error } = await supabase.from('reminder_period_plans' as never).select('*').in('period_month', periods);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PeriodPlanRow[];
}

export async function savePeriodPlan(row: PeriodPlanRow, user: { id: string | null; name: string | null }): Promise<void> {
  const { error } = await supabase
    .from('reminder_period_plans' as never)
    .upsert({ ...row, updated_by: user.id, updated_by_name: user.name } as never, { onConflict: 'period_month,return_type' });
  if (error) throw new Error(friendlyCheck(error.message));
}

/** Back to the standard schedule for this period and return. */
export async function clearPeriodPlan(period: string, returnType: string): Promise<void> {
  const { error } = await supabase
    .from('reminder_period_plans' as never)
    .delete()
    .eq('period_month', period)
    .eq('return_type', returnType);
  if (error) throw new Error(error.message);
}

export async function loadRemindersFor(periods: string[]): Promise<ReminderSent[]> {
  const out: ReminderSent[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('email_outbox')
      .select('id, client_id, return_type, period_month, reminder_step, status, created_at, sent_at')
      .eq('kind', 'reminder')
      .in('period_month', periods)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as ReminderSent[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export interface QueueItem {
  client_id: string;
  client_name: string;
  to_email: string;
  return_type: string;
  period: string;
  step: number | null;
  template: string | null;
  due_date: string;
  result: 'queued' | 'would_queue' | 'skipped';
  reason?: string;
}
export interface QueueResult {
  mode: 'due' | 'now';
  dryRun: boolean;
  today: string;
  periods: string[];
  queued: number;
  would_queue: number;
  skipped: number;
  items: QueueItem[];
}

/** Calls queue-gst-reminders: today's due reminders, or one reminder now. */
export async function queueReminders(body: {
  mode: 'due' | 'now';
  period: string;
  step?: 1 | 2 | 3;
  returnTypes?: string[];
  clientIds?: string[];
  dryRun?: boolean;
  staffName?: string | null;
}): Promise<QueueResult> {
  const { data, error } = await supabase.functions.invoke('queue-gst-reminders', { body });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as Partial<QueueResult> & { error?: string };
  if (r.error) throw new Error(r.error);
  return { mode: body.mode, dryRun: !!body.dryRun, today: '', periods: [body.period], queued: 0, would_queue: 0, skipped: 0, items: [], ...r } as QueueResult;
}

/** Stops queued e-mails (status pending → cancelled); a cancelled reminder is never queued again. */
export async function cancelQueued(ids: string[], who: string | null): Promise<number> {
  let n = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('email_outbox')
      .update({ status: 'cancelled', error: `Cancelled by ${who || 'staff'} on the GST Reminders page` })
      .in('id', ids.slice(i, i + 200))
      .eq('status', 'pending')
      .select('id');
    if (error) throw new Error(error.message);
    n += data?.length ?? 0;
  }
  return n;
}

function friendlyCheck(msg: string): string {
  if (/reminder_period_plans_dates|return_reminder_schedules_order/.test(msg)) {
    return 'The dates are not in order: each reminder must come after the one before, none before the period starts and none after the due date.';
  }
  return msg;
}
