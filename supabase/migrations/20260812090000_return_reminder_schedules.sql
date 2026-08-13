-- Fixed-calendar-day reminder schedule per return type (GSTR-1, GSTR-3B,
-- GSTR-6, GSTR-7): one firm-wide due date + 3 reminder days, staff-editable.
--
-- Replaces the "every N days" ladder (client_reminder_settings.interval_days)
-- for these 4 return types only — queue-gst-reminders now fires reminder_1 /
-- reminder_2 / reminder_final on these exact days-of-month for every client
-- with reminders enabled, instead of walking the ladder at a per-client
-- interval. Any other return type (ITC-04, CMP-08, GSTR-1A, …) keeps using
-- the interval-based ladder unchanged — this table has no row for them.
--
-- 'GSTR-1 (IFF)' and 'GSTR-3B (Q)' are filing-frequency variants of GSTR-1 /
-- GSTR-3B and follow their base return's schedule (mapped in application code,
-- not duplicated here).
--
-- RLS: open to public, per the project convention (this app has no Supabase
-- auth session — auth.uid() is always NULL — see CLAUDE.md). The Reminders
-- page that edits this table is staff-only routing; that's the real gate.

BEGIN;

CREATE TABLE IF NOT EXISTS public.return_reminder_schedules (
  return_type        public.return_type PRIMARY KEY,
  due_day             int NOT NULL CHECK (due_day BETWEEN 1 AND 28),
  reminder_1_day      int NOT NULL CHECK (reminder_1_day BETWEEN 1 AND 28),
  reminder_2_day      int NOT NULL CHECK (reminder_2_day BETWEEN 1 AND 28),
  reminder_final_day  int NOT NULL CHECK (reminder_final_day BETWEEN 1 AND 28),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid
);

DROP TRIGGER IF EXISTS trg_return_reminder_schedules_updated_at ON public.return_reminder_schedules;
CREATE TRIGGER trg_return_reminder_schedules_updated_at BEFORE UPDATE ON public.return_reminder_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.return_reminder_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app manage return_reminder_schedules" ON public.return_reminder_schedules;
CREATE POLICY "app manage return_reminder_schedules"
  ON public.return_reminder_schedules FOR ALL TO public USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.return_reminder_schedules TO anon, authenticated;

-- Seed the 4 return types from the firm's reminder-day table (idempotent —
-- re-applying this migration won't clobber days staff have since edited).
INSERT INTO public.return_reminder_schedules (return_type, due_day, reminder_1_day, reminder_2_day, reminder_final_day) VALUES
('GSTR-1',  11, 7,  8,  9),
('GSTR-3B', 20, 16, 17, 18),
('GSTR-6',  13, 8,  9,  10),
('GSTR-7',  10, 6,  7,  8)
ON CONFLICT (return_type) DO NOTHING;

COMMIT;
