-- GST data reminders on any date (the firm, 24 Oct 2026: "we want to bring
-- these reminders anytime ... as Diwali is coming up we need to change the
-- reminder dates in October but are not able to").
--
-- Before: one firm-wide row per return of days of the month AFTER the period
-- (return_reminder_schedules), so a reminder could never go out inside the
-- period month, a date could not be moved for one month, and a day typed after
-- the due day (GSTR-1 saved as 28 / 28 / 2 on 24 Oct 2026) silently sent every
-- reminder after the return was due.
--
-- Now (supabase/functions/_shared/reminderPlan.ts holds the rules):
--   1. return_reminder_schedules stays the standard schedule, checked: each
--      reminder day before the next and none after the due day. GSTR-1 (IFF)
--      (due the 13th) and GSTR-3B (Q) (due the 22nd, or the 24th by state,
--      due_day_y) get rows of their own instead of borrowing GSTR-1's 11th
--      and GSTR-3B's 20th.
--   2. reminder_period_plans: real calendar dates for one period and return,
--      from the first of the period month up to the due date, and a due date
--      that follows a CBIC extension. A period without one uses the standard
--      schedule.
--   3. email_outbox reminder rows carry a dedupe key per step (set by the
--      queue function), so a step is never queued twice even if two runs or
--      two clicks overlap.
--
-- RLS open to public, per CLAUDE.md (no Supabase auth session in this app).
-- Additive and re-runnable: nothing is dropped.

BEGIN;

-- 1. Standard schedule ----------------------------------------------------------
ALTER TABLE public.return_reminder_schedules
  ADD COLUMN IF NOT EXISTS due_day_y int CHECK (due_day_y BETWEEN 1 AND 28);

-- GSTR-1 was saved as 28 / 28 / 2 against a due day of 11 on 24 Oct 2026: every
-- reminder would have gone out after the return was due. Put back the days
-- the September reminders went out on (5 / 6 / 7 Oct 2026). Any other row
-- that breaks the new check is left for staff, so the check is added only
-- when all rows pass (the page then refuses a wrong save).
UPDATE public.return_reminder_schedules
   SET reminder_1_day = 5, reminder_2_day = 6, reminder_final_day = 7
 WHERE return_type = 'GSTR-1'
   AND (reminder_1_day > due_day OR reminder_2_day > due_day OR reminder_final_day > due_day
        OR reminder_2_day <= reminder_1_day OR reminder_final_day <= reminder_2_day);

INSERT INTO public.return_reminder_schedules (return_type, due_day, due_day_y, reminder_1_day, reminder_2_day, reminder_final_day)
SELECT 'GSTR-1 (IFF)', 13, NULL, reminder_1_day, reminder_2_day, reminder_final_day
  FROM public.return_reminder_schedules WHERE return_type = 'GSTR-1'
ON CONFLICT (return_type) DO NOTHING;

INSERT INTO public.return_reminder_schedules (return_type, due_day, due_day_y, reminder_1_day, reminder_2_day, reminder_final_day)
SELECT 'GSTR-3B (Q)', 22, 24, reminder_1_day, reminder_2_day, reminder_final_day
  FROM public.return_reminder_schedules WHERE return_type = 'GSTR-3B'
ON CONFLICT (return_type) DO NOTHING;

-- Additive only: the check is added once, NOT VALID, then validated.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'return_reminder_schedules_order'
                   AND conrelid = 'public.return_reminder_schedules'::regclass) THEN
    ALTER TABLE public.return_reminder_schedules ADD CONSTRAINT return_reminder_schedules_order CHECK (
          reminder_1_day <= due_day AND reminder_2_day <= due_day AND reminder_final_day <= due_day
      AND reminder_1_day < reminder_2_day AND reminder_2_day < reminder_final_day
      AND (due_day_y IS NULL OR due_day_y >= due_day)
    ) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  ALTER TABLE public.return_reminder_schedules VALIDATE CONSTRAINT return_reminder_schedules_order;
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'return_reminder_schedules: a row breaks the new order check; it stays NOT VALID until staff fix it';
END $$;

-- 2. A period's own dates ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reminder_period_plans (
  period_month        text NOT NULL CHECK (period_month ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
  return_type         public.return_type NOT NULL,
  due_date            date NOT NULL,
  due_date_y          date,
  data_by_date        date,
  reminder_1_date     date,
  reminder_2_date     date,
  reminder_final_date date,
  note                text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid,
  updated_by_name     text,
  PRIMARY KEY (period_month, return_type),
  CONSTRAINT reminder_period_plans_dates CHECK (
        COALESCE(reminder_1_date, reminder_2_date, reminder_final_date) IS NOT NULL
    -- nothing before the first of the period month
    AND due_date >= make_date(substr(period_month, 4, 4)::int, substr(period_month, 1, 2)::int, 1)
    AND COALESCE(reminder_1_date, reminder_2_date, reminder_final_date) >= make_date(substr(period_month, 4, 4)::int, substr(period_month, 1, 2)::int, 1)
    -- nothing after the (latest) due date
    AND (reminder_1_date IS NULL OR reminder_1_date <= GREATEST(due_date, COALESCE(due_date_y, due_date)))
    AND (reminder_2_date IS NULL OR reminder_2_date <= GREATEST(due_date, COALESCE(due_date_y, due_date)))
    AND (reminder_final_date IS NULL OR reminder_final_date <= GREATEST(due_date, COALESCE(due_date_y, due_date)))
    AND (data_by_date IS NULL OR data_by_date <= GREATEST(due_date, COALESCE(due_date_y, due_date)))
    -- in order
    AND (reminder_1_date IS NULL OR reminder_2_date IS NULL OR reminder_1_date < reminder_2_date)
    AND (reminder_2_date IS NULL OR reminder_final_date IS NULL OR reminder_2_date < reminder_final_date)
    AND (reminder_1_date IS NULL OR reminder_final_date IS NULL OR reminder_1_date < reminder_final_date)
    AND (due_date_y IS NULL OR due_date_y >= due_date)
  )
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_reminder_period_plans_updated_at') THEN
    CREATE TRIGGER trg_reminder_period_plans_updated_at BEFORE UPDATE ON public.reminder_period_plans
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

ALTER TABLE public.reminder_period_plans ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reminder_period_plans'
                   AND policyname = 'app manage reminder_period_plans') THEN
    CREATE POLICY "app manage reminder_period_plans"
      ON public.reminder_period_plans FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_period_plans TO anon, authenticated;

-- 3. Reminder rows: look-ups by (client, return, period) --------------------------
CREATE INDEX IF NOT EXISTS idx_email_outbox_reminder_lookup
  ON public.email_outbox (period_month, client_id, return_type)
  WHERE kind = 'reminder';

COMMIT;
