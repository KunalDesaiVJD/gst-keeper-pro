-- GST reminders — align RLS with the app's actual auth model.
--
-- This app does NOT establish a Supabase auth session; it authenticates through
-- its own localStorage session and talks to Postgres with the anon key. So
-- auth.uid() is NULL at runtime and the is_staff(auth.uid()) policies created in
-- 20260725120000 block EVERY request from the app (reads come back empty, writes
-- fail) even though the build is clean.
--
-- Match the project convention already used by public.clients (which is wide
-- open to the public role via "... for development" policies) and let the app's
-- login + staff-only routing be the gate: the template editor lives in the
-- staff Settings tab, the per-client card on the staff-only Edit Client page,
-- and the Reminders page hard-blocks non-staff.

drop policy if exists "staff manage email_templates"           on public.email_templates;
drop policy if exists "staff manage client_reminder_settings"  on public.client_reminder_settings;
drop policy if exists "staff manage email_outbox"              on public.email_outbox;

create policy "app manage email_templates"
  on public.email_templates          for all to public using (true) with check (true);

create policy "app manage client_reminder_settings"
  on public.client_reminder_settings for all to public using (true) with check (true);

create policy "app manage email_outbox"
  on public.email_outbox             for all to public using (true) with check (true);
