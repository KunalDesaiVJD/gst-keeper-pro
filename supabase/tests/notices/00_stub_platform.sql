-- Test-only stand-ins for the Supabase platform and for the app tables the
-- notices migrations reference, so the real migration files (listed in
-- migrations.txt) can be replayed on a plain PostgreSQL 15/16.
-- NOT a migration: never apply this to the live project.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- Supabase Auth: the app never has a session, so auth.uid() is always NULL.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

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

-- pg_net and Vault (only referenced inside cron command text).
CREATE SCHEMA IF NOT EXISTS net;
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}',
  headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000) RETURNS bigint
LANGUAGE sql AS $$ SELECT 0::bigint $$;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE VIEW vault.decrypted_secrets AS SELECT 'gst_cron_anon_key'::text AS name, 'test'::text AS decrypted_secret;

-- Storage (Phase 0 drops one policy on storage.objects).
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can delete return PDFs" ON storage.objects FOR DELETE USING (true);

-- App enums and the slice of app tables the notices module touches.
CREATE TYPE public.app_role AS ENUM ('superadmin', 'gst_manager', 'employee', 'client');
CREATE TYPE public.return_type AS ENUM ('GSTR-1', 'GSTR-3B');

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  gstin text NOT NULL,
  email text,
  gst_user_id text,
  gst_password text,
  assigned_accountant text,
  inactive_at_hand boolean NOT NULL DEFAULT false,
  selected_returns text[],
  registration_date date NOT NULL DEFAULT '2017-07-01',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.filing_status (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid, return_type public.return_type, period_month text, status text, filed_date date,
  UNIQUE (client_id, return_type, period_month));
-- Taxpayer profile (20260817200000), so 0.6.0's registration status can be tested.
CREATE TABLE public.gst_taxpayer_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  legal_name text, trade_name text, constitution_of_business text, registration_date date,
  jurisdiction_state text, jurisdiction_centre text, principal_place_address text,
  aadhaar_authentication_status text, registration_certificate_url text,
  pulled_at timestamptz NOT NULL DEFAULT now(), pulled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  first_name text,
  email text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE FUNCTION public.is_staff(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role <> 'client') $$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- Test helper: fails the test file with a readable message.
CREATE FUNCTION public.t_eq(p_actual anyelement, p_expected anyelement, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAILED %: expected [%], got [%]', p_label, p_expected, p_actual;
  END IF;
END $$;
