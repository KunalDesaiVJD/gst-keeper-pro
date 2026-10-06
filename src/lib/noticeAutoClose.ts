import { supabase } from '@/integrations/supabase/client';

// The closing sweep runs in the database: public.notices_sweep(p_client_id)
// (supabase/migrations/20261006101000_notices_sweep_function.sql). It fills case
// due dates from the case folder and auto-closes untriaged rows by rule — see
// docs/NOTICES_LITIGATION_POSITIONS.md §3–§4. The extension calls it after each
// client's sync and pg_cron runs it nightly; this wrapper serves the dashboard's
// "run the closing sweep" link. (The previous client-side version filtered a
// column that never existed, gst_case_folder_items.notice_id, and never ran.)
export interface NoticeSweepResult {
  closed: number;
  dueDatesSet: number;
  errors: string[];
}

export async function runNoticeSweep(clientId?: string): Promise<NoticeSweepResult> {
  const { data, error } = await supabase.rpc('notices_sweep', clientId ? { p_client_id: clientId } : {});
  if (error) return { closed: 0, dueDatesSet: 0, errors: [error.message] };
  const d = (data ?? {}) as { closed?: number; due_dates_set?: number };
  return { closed: d.closed ?? 0, dueDatesSet: d.due_dates_set ?? 0, errors: [] };
}
