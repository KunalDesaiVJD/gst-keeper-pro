-- Per-staff private daily task reminders (Dashboard "Task Reminder" button).
-- Mirrors the paper trail of Harsh's TASK REMINDER.xlsx: Task, Client,
-- Reminder frequency, Deadline for submission, Task allocated to, Task
-- received from — plus a done flag and a manual sort order for drag-free
-- reordering via up/down.
--
-- Privacy is enforced in the app layer only (filter every query by
-- user_id = the logged-in staff member's AppUser.id), same as every other
-- table here — this app never establishes a Supabase auth session, so
-- auth.uid() is always NULL and an RLS policy gated on it would fail
-- closed. RLS stays open to public per the project's standing rule.
CREATE TABLE public.staff_task_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  task TEXT NOT NULL DEFAULT '',
  client TEXT NOT NULL DEFAULT '',
  reminder_frequency TEXT NOT NULL DEFAULT '',
  deadline DATE,
  allocated_to TEXT NOT NULL DEFAULT '',
  received_from TEXT NOT NULL DEFAULT '',
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_task_reminders_user_id ON public.staff_task_reminders(user_id);

ALTER TABLE public.staff_task_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_task_reminders_all" ON public.staff_task_reminders
  FOR ALL TO public USING (true) WITH CHECK (true);
