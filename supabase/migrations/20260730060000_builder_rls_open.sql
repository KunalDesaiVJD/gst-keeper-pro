-- Builder module — align RLS with the app's actual auth model.
--
-- The builder tables shipped with `is_staff(auth.uid())` policies, copied from
-- the pattern in 20260725120000_gst_reminders.sql. That was a mistake: a later
-- migration, 20260725130000_gst_reminders_rls_open.sql, had already reversed
-- that exact pattern for this exact reason, and it was missed.
--
-- This app does NOT establish a Supabase auth session. It authenticates through
-- its own localStorage session and talks to Postgres with the anon key, so
-- auth.uid() is NULL at runtime and every is_staff(auth.uid()) policy fails
-- closed — reads come back empty and writes are rejected with
-- "new row violates row-level security policy", even though the build is clean.
--
-- Worth recording why this was not caught earlier: the module's end-to-end
-- database tests ran through the management API, which bypasses RLS. They
-- proved the SQL logic and the views, but never exercised the path the app
-- actually takes. The first real insert from the UI is what surfaced it.
--
-- Match the project convention already used by public.clients and the reminders
-- tables — open to the `public` role — and let the app's login, staff-only
-- routing and the builder permission keys be the gate. Every builder page is
-- staff-routed, and the write actions are additionally gated behind
-- canManageBuilderProjects / canManageBuilderUnits / canEnterBuilderReceipts /
-- canPostBuEvent / canPostBuilderAdjustments / canApproveFsiConsent.

DO $$
DECLARE
  t text;
  p text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'builder\_%'
  LOOP
    -- Drop whatever auth.uid()-gated policy this table carries, whatever it
    -- was named — the names were abbreviated on a couple of the longer tables.
    FOR p IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)',
      'app manage ' || t, t
    );
  END LOOP;
END $$;
