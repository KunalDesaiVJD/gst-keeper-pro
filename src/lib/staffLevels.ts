// Staff levels (Employee / GST Manager) change only through the database
// functions of supabase/migrations/20261017100000_staff_levels_guard.sql: a
// trigger refuses every direct write to user_roles. Only the superadmin
// gives or takes away the GST Manager level, with their password; an
// Employee is added or removed by whoever manages employees. Sessions end
// through staff_end_sessions (20261017110000).
import { supabase } from '@/integrations/supabase/client';

export type StaffLevel = 'employee' | 'gst_manager';

export const STAFF_LEVEL_LABEL: Record<StaffLevel, string> = { employee: 'Employee', gst_manager: 'GST Manager' };

/** What the database said, as a sentence for a toast. */
const fail = (error: { message?: string } | null): never => {
  throw new Error(error?.message || 'The change was not saved.');
};

/** Employee ↔ GST Manager: the superadmin, with their own password. */
export async function setStaffLevel(actorId: string, password: string, targetUserId: string, level: StaffLevel): Promise<boolean> {
  const { data, error } = await supabase.rpc('staff_set_level', {
    p_actor_id: actorId, p_actor_password: password, p_target_user_id: targetUserId, p_level: level,
  });
  if (error) fail(error);
  return data === true;
}

/** The level of a new staff member whose profile is already added (a GST Manager needs the superadmin's password). */
export async function addStaffLevel(actorId: string, targetUserId: string, level: StaffLevel, password?: string): Promise<void> {
  const { error } = await supabase.rpc('staff_add_level', {
    p_actor_id: actorId, p_target_user_id: targetUserId, p_level: level, p_actor_password: password ?? null,
  });
  if (error) fail(error);
}

/** Removes a staff member: level, permissions and profile together (a GST Manager needs the superadmin's password). */
export async function removeStaff(actorId: string, targetUserId: string, password?: string): Promise<void> {
  const { error } = await supabase.rpc('staff_remove', {
    p_actor_id: actorId, p_target_user_id: targetUserId, p_actor_password: password ?? null,
  });
  if (error) fail(error);
}

/** Signs the person out of every browser: they must log in again. */
export async function endStaffSessions(actorId: string, targetUserId: string): Promise<void> {
  const { error } = await supabase.rpc('staff_end_sessions', { p_actor_id: actorId, p_target_user_id: targetUserId });
  if (error) fail(error);
}

/** When the person's sessions were last ended (null: never), or undefined when it could not be read. */
export async function sessionsEndedAt(userId: string): Promise<string | null | undefined> {
  const { data, error } = await supabase.from('profiles').select('sessions_ended_at').eq('user_id', userId).maybeSingle();
  if (error) return undefined;
  return data?.sessions_ended_at ?? null;
}
