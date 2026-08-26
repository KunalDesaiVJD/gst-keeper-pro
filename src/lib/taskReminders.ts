// Per-staff private daily task reminders (Dashboard "Task Reminder" button).
// Privacy is enforced here, not in RLS (see the migration's comment) — every
// call below is scoped to the current user's id, and there is no read path
// anywhere in the app that omits that filter.
import { supabase } from '@/integrations/supabase/client';

export interface TaskReminderRow {
  id: string;
  user_id: string;
  task: string;
  client: string;
  reminder_frequency: string;
  deadline: string | null;
  allocated_to: string;
  received_from: string;
  ticket_status: string;
  is_done: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type TaskReminderPatch = Partial<
  Pick<TaskReminderRow, 'task' | 'client' | 'reminder_frequency' | 'deadline' | 'allocated_to' | 'received_from' | 'ticket_status' | 'is_done'>
>;

export const listTaskReminders = async (userId: string): Promise<TaskReminderRow[]> => {
  const { data, error } = await supabase
    .from('staff_task_reminders')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as TaskReminderRow[];
};

export const addTaskReminder = async (userId: string, sortOrder: number): Promise<TaskReminderRow> => {
  const { data, error } = await supabase
    .from('staff_task_reminders')
    .insert({ user_id: userId, sort_order: sortOrder })
    .select('*')
    .single();
  if (error) throw error;
  return data as TaskReminderRow;
};

export const updateTaskReminder = async (id: string, userId: string, patch: TaskReminderPatch): Promise<void> => {
  const { error } = await supabase
    .from('staff_task_reminders')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
};

export const deleteTaskReminder = async (id: string, userId: string): Promise<void> => {
  const { error } = await supabase
    .from('staff_task_reminders')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
};
