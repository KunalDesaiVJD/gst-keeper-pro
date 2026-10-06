// Staff edits to gst_notices carry who made them (edited_by_id / edited_by_name /
// edited_at). The app has no database session, so this is how the event trigger
// (migration 20261006112000) attributes a change to a person; the trigger then
// writes notice_events for every changed field and the alert engine picks them
// up — the browser no longer logs events or queues alerts itself.
//
// Before that migration is live the columns do not exist: the write is retried
// without them and the caller logs the events the old way (legacy = true).
import { supabase } from '@/integrations/supabase/client';
import type { TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export interface NoticeActor {
  id?: string | null;
  firstName?: string | null;
}

export function staffEditFields(actor: NoticeActor | null | undefined) {
  return {
    edited_by_id: actor?.id ?? null,
    edited_by_name: actor?.firstName ?? null,
    edited_at: new Date().toISOString(),
  };
}

function missingEditColumns(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === 'PGRST204' || /edited_(at|by_id|by_name)/.test(error.message ?? ''));
}

export async function updateNotices(
  ids: string[],
  payload: TablesUpdate<'gst_notices'>,
  actor: NoticeActor | null | undefined,
): Promise<{ error: { message: string } | null; legacy: boolean }> {
  if (ids.length === 0) return { error: null, legacy: false };
  const first = await supabase.from('gst_notices').update({ ...payload, ...staffEditFields(actor) }).in('id', ids);
  if (!missingEditColumns(first.error)) return { error: first.error, legacy: false };
  const second = await supabase.from('gst_notices').update(payload).in('id', ids);
  return { error: second.error, legacy: true };
}

/** A notice typed in by staff (Add Notice); the "captured" event names them. */
export async function insertManualNotice(
  row: TablesInsert<'gst_notices'>,
  actor: NoticeActor | null | undefined,
): Promise<{ id: string | null; error: { message: string } | null }> {
  const first = await supabase.from('gst_notices').insert({ ...row, ...staffEditFields(actor) }).select('id').single();
  if (!missingEditColumns(first.error)) return { id: first.data?.id ?? null, error: first.error };
  const second = await supabase.from('gst_notices').insert(row).select('id').single();
  return { id: second.data?.id ?? null, error: second.error };
}
