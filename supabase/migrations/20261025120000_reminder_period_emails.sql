-- GST data reminders: an e-mail written for one period instead of the template.
--
-- reminder_period_emails holds the subject and wording of one reminder step
-- (1st, 2nd, final) of one return for one period, e.g. GSTR-1 for 10/2026's
-- 2nd reminder before Diwali. The daily job queue-gst-reminders uses it in
-- place of the email_templates row for that step, for that period only; every
-- other period keeps the template. The same {{variables}} as the templates.
-- (Send now's own one-off wording is not stored here: it goes with the call.)
--
-- RLS open to public, per CLAUDE.md (no Supabase auth session in this app).
-- Additive and re-runnable: nothing is dropped.

BEGIN;

CREATE TABLE IF NOT EXISTS public.reminder_period_emails (
  period_month    text NOT NULL CHECK (period_month ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
  return_type     public.return_type NOT NULL,
  step            smallint NOT NULL CHECK (step BETWEEN 1 AND 3),
  subject         text NOT NULL CHECK (btrim(subject) <> ''),
  body            text NOT NULL CHECK (btrim(body) <> ''),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  updated_by_name text,
  PRIMARY KEY (period_month, return_type, step)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_reminder_period_emails_updated_at') THEN
    CREATE TRIGGER trg_reminder_period_emails_updated_at BEFORE UPDATE ON public.reminder_period_emails
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

ALTER TABLE public.reminder_period_emails ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reminder_period_emails'
                   AND policyname = 'app manage reminder_period_emails') THEN
    CREATE POLICY "app manage reminder_period_emails"
      ON public.reminder_period_emails FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
