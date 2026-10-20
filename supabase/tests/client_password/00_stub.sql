-- Test-only stand-ins for the Supabase platform and the slice of app tables
-- that 20261020100000_client_password_reset.sql touches, so the real
-- migration can be replayed on a plain PostgreSQL 15/16.
-- NOT a migration: never apply this to the live project.

-- Roles and Supabase's default grants (anon and authenticated get everything
-- new in public; RLS is what keeps them out).
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- pgcrypto lives in the extensions schema on the live project, not public:
-- the functions must find it through their search_path.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

-- pg_net: record each call so the tests can see the mailer being woken.
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE net.calls (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb, at timestamptz DEFAULT now());
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}',
  headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000) RETURNS bigint
LANGUAGE sql AS $$ INSERT INTO net.calls (url, body, headers) VALUES (url, body, headers) RETURNING id $$;
-- pg_cron: schedule() upserts by job name, like the real extension.
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean
LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = job_name RETURNING true $$;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE VIEW vault.decrypted_secrets AS SELECT 'gst_cron_anon_key'::text AS name, 'test-anon-key'::text AS decrypted_secret;

-- App tables (only the columns used).
CREATE TYPE public.app_role AS ENUM ('superadmin', 'gst_manager', 'employee', 'client');

CREATE TABLE public.clients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  gstin           text NOT NULL UNIQUE,
  email           text,
  client_user_id  text,
  client_password text,
  is_first_login  boolean DEFAULT true,
  updated_at      timestamptz DEFAULT now()
);
CREATE TABLE public.user_roles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  role           public.app_role NOT NULL,
  is_first_login boolean DEFAULT false
);
CREATE TABLE public.profiles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE,
  first_name text NOT NULL
);
-- As 20260105095015: open to the public role.
CREATE TABLE public.password_reset_requests (
  id                uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           uuid NOT NULL,
  requested_by_name text NOT NULL,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'pending',
  resolved_at       timestamptz,
  resolved_by       uuid
);
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can manage reset requests for development" ON public.password_reset_requests
  FOR ALL USING (true) WITH CHECK (true);
CREATE TABLE public.notice_settings (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  app_base_url text NOT NULL DEFAULT 'https://gst.vjdesai.com'
);
INSERT INTO public.notice_settings (id) VALUES (true);
-- The general outbox, readable by anyone with the anon key: a reset link must
-- never land here.
CREATE TABLE public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), to_email text, subject text, body text,
  render_vars jsonb, created_at timestamptz DEFAULT now()
);

-- Assertions.
CREATE FUNCTION public.t_eq(p_actual anyelement, p_expected anyelement, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAILED %: expected [%], got [%]', p_label, p_expected, p_actual;
  END IF;
END $$;
-- The error text of a statement that must fail (NULL if it succeeded).
CREATE FUNCTION public.t_error(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN SQLERRM;
END $$;
-- Signing in: a bcrypt password is checked with crypt(), a legacy plain one
-- by comparison (the shape of the live authenticate_client).
CREATE FUNCTION public.t_login(p_gstin text, p_pass text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  SELECT EXISTS (SELECT 1 FROM public.clients c
                  WHERE upper(c.gstin) = upper(p_gstin)
                    AND CASE WHEN c.client_password LIKE '$2%' THEN c.client_password = crypt(p_pass, c.client_password)
                             ELSE c.client_password = p_pass END)
$$;
GRANT EXECUTE ON FUNCTION public.t_eq(anyelement, anyelement, text), public.t_error(text), public.t_login(text, text)
  TO anon, authenticated, service_role;
