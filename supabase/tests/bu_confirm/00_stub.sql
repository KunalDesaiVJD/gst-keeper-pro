-- The platform pieces the BU confirmation migrations expect, as on the live
-- project: Supabase's roles, pgcrypto in the extensions schema, and the
-- client, builder, staff and e-mail tables as they stood before
-- 20260811160000_builder_bu_agreement_confirm.sql (only the columns these
-- migrations and tests touch). Fictional only.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TYPE public.app_role AS ENUM ('superadmin', 'gst_manager', 'employee', 'client');
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL DEFAULT 'employee',
  UNIQUE (user_id, role)
);
CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  permission_key text NOT NULL,
  UNIQUE (user_id, permission_key)
);

CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  gstin text,
  email text
);

CREATE TABLE public.builder_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL
);
CREATE TABLE public.builder_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,
  unit_no text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  UNIQUE (project_id, unit_no)
);
CREATE TABLE public.builder_bu_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,
  bu_date date NOT NULL,
  posting_period text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PREPARED','POSTED'))
);
CREATE TABLE public.builder_bu_event_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bu_event_id uuid NOT NULL REFERENCES public.builder_bu_events(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  cut_off_date date NOT NULL,
  cut_off_source text NOT NULL DEFAULT 'BU' CHECK (cut_off_source IN ('BU','DASTAVEJ')),
  booked_at_cutoff boolean NOT NULL DEFAULT false,
  agreement_value numeric NOT NULL DEFAULT 0,
  UNIQUE (unit_id)
);

CREATE TABLE public.email_templates (
  key text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reminder','confirmation')),
  step int,
  subject text NOT NULL,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE TABLE public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reminder','confirmation')),
  template_key text NOT NULL REFERENCES public.email_templates(key),
  return_type text,
  period_month text,
  subject text NOT NULL,
  body text NOT NULL,
  render_vars jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','sent','failed','skipped','cancelled')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  sent_at timestamptz
);

-- The live policies these tables carry (open: the app has no auth session).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_roles','user_permissions','clients','builder_projects','builder_units',
                           'builder_bu_events','builder_bu_event_units','email_templates','email_outbox'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)', t || '_all', t);
  END LOOP;
END $$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION public.t_eq(p_actual anyelement, p_expected anyelement, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAILED %: expected [%], got [%]', p_label, p_expected, p_actual;
  END IF;
END $$;
-- Passes when p_sql raises an error whose message contains p_like.
CREATE FUNCTION public.t_raises(p_sql text, p_like text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_like in SQLERRM) = 0 THEN
      RAISE EXCEPTION 'FAILED %: raised [%], expected it to mention [%]', p_label, SQLERRM, p_like;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'FAILED %: did not raise', p_label;
END $$;
GRANT EXECUTE ON FUNCTION public.t_eq(anyelement, anyelement, text), public.t_raises(text, text, text) TO anon;
