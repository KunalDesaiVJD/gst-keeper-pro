-- Adds a free-text "Ticket Status" column to the per-staff Task Reminder
-- grid (see 20260828110000_staff_task_reminders.sql).
ALTER TABLE public.staff_task_reminders
  ADD COLUMN ticket_status TEXT NOT NULL DEFAULT '';
