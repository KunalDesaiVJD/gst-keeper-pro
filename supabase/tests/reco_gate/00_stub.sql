-- The platform pieces 20261020150000 and 20261021120000 expect, as on the
-- live project (column types and constraints read from it on 21 Oct 2026):
-- Supabase's roles, the staff tables and staff_level_of, clients, the two
-- recos, and the tables their differences read. Fictional only.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE TYPE public.app_role AS ENUM ('superadmin', 'gst_manager', 'employee', 'client');
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  first_name text NOT NULL
);
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL DEFAULT 'employee',
  UNIQUE (user_id, role)
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view profiles" ON public.profiles FOR SELECT TO public USING (true);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view user_roles" ON public.user_roles FOR SELECT TO public USING (true);

-- As live (20261017100000_staff_levels_guard.sql).
CREATE OR REPLACE FUNCTION public.staff_level_of(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN bool_or(role = 'superadmin') THEN 'superadmin'
    WHEN bool_or(role = 'gst_manager') THEN 'gst_manager'
    WHEN bool_or(role = 'employee') THEN 'employee'
  END
    FROM public.user_roles WHERE user_id = p_user_id;
$$;
GRANT EXECUTE ON FUNCTION public.staff_level_of(uuid) TO anon, authenticated, service_role;

CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  gstin text,
  regular_sub_type text,
  builder_itc_type text,
  commercial_area numeric,
  residential_area numeric
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY clients_open ON public.clients FOR ALL TO public USING (true) WITH CHECK (true);

CREATE TYPE public.return_type AS ENUM ('GSTR-1','GSTR-3B','ITC-04','GSTR-6','GSTR-7','CMP-08','GSTR-1 (IFF)','GSTR-3B (Q)','GSTR-1A','GSTR-9','GSTR-9C');
CREATE TYPE public.filing_status_type AS ENUM ('Prepared','Data Pending','Mismatch in Data','Not Verified','Filed','Prepared Pending','Data Received','Not to File','Pushed');
CREATE TABLE public.filing_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  return_type public.return_type NOT NULL,
  period_month text NOT NULL,
  status public.filing_status_type,
  is_nil boolean DEFAULT false,
  pushed_at timestamptz,
  UNIQUE (client_id, return_type, period_month)
);
CREATE TABLE public.bills_not_in_2b (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text,
  input_igst numeric(15,2),
  input_cgst numeric(15,2),
  input_sgst numeric(15,2),
  reversal_month text,
  reclaim_month text,
  reclaim_subtype text
);
CREATE TABLE public.itc_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  data jsonb,
  is_locked boolean DEFAULT false,
  UNIQUE (client_id, period_month)
);
CREATE TABLE public.rcm_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  month text,
  cgst_2_5 numeric, cgst_9 numeric, sgst_2_5 numeric, sgst_9 numeric, igst_5 numeric, igst_18 numeric
);
CREATE TABLE public.gstr3b_push_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  actor_id uuid,
  action_at timestamptz NOT NULL DEFAULT now(),
  status text,
  summary text,
  filled_count integer,
  skipped jsonb,
  payload jsonb
);
-- How a push is recorded (20261009200000, cut down to what the gate needs):
-- filing_record_push stamps the GSTR-3B row Pushed (unless Filed), and the
-- trigger on gstr3b_push_versions calls it for every 'ok' row, as live
-- before 20261021120000.
CREATE OR REPLACE FUNCTION public.filing_record_push(p_client_id uuid, p_return_type text, p_period_month text, p_actor uuid, p_at timestamptz)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.filing_status (client_id, return_type, period_month, status, pushed_at)
  VALUES (p_client_id, p_return_type::public.return_type, p_period_month, 'Pushed', p_at)
  ON CONFLICT (client_id, return_type, period_month) DO UPDATE SET
    pushed_at = EXCLUDED.pushed_at,
    status = CASE WHEN public.filing_status.status::text = 'Filed' THEN public.filing_status.status ELSE 'Pushed' END;
  RETURN 'Pushed';
END;
$$;
CREATE OR REPLACE FUNCTION public.gstr3b_push_versions_record_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'ok' THEN RETURN NULL; END IF;
  IF NEW.period_month !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN RETURN NULL; END IF;
  PERFORM public.filing_record_push(NEW.client_id, 'GSTR-3B', NEW.period_month, NEW.actor_id, NEW.action_at);
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_gstr3b_push_versions_record_push
  AFTER INSERT ON public.gstr3b_push_versions
  FOR EACH ROW EXECUTE FUNCTION public.gstr3b_push_versions_record_push();

-- The recos as live (20260123070206, 20260623200000, 20260713180000 and later).
CREATE TABLE public.suspended_reco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  portal_cgst numeric DEFAULT 0,
  portal_sgst numeric DEFAULT 0,
  portal_igst numeric DEFAULT 0,
  updated_by uuid,
  updated_at timestamptz DEFAULT now(),
  opening_cgst numeric DEFAULT 0,
  opening_sgst numeric DEFAULT 0,
  opening_igst numeric DEFAULT 0,
  opening_source text NOT NULL DEFAULT 'manual',
  opening_csv_period_month text,
  opening_csv_uploaded_at timestamptz,
  opening_csv_uploaded_by uuid,
  opening_override_justification text,
  opening_override_at timestamptz,
  opening_override_by uuid,
  opening_portal_pulled_at timestamptz,
  opening_portal_pulled_by uuid,
  CONSTRAINT suspended_reco_client_id_period_month_key UNIQUE (client_id, period_month),
  CONSTRAINT suspended_reco_opening_source_check CHECK (opening_source IN ('manual', 'csv', 'not_applicable', 'portal'))
);
CREATE TABLE public.gst_receivable_reco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  opening_cgst numeric DEFAULT 0,
  opening_sgst numeric DEFAULT 0,
  opening_igst numeric DEFAULT 0,
  opening_source text NOT NULL DEFAULT 'manual',
  opening_csv_period_month text,
  opening_csv_uploaded_at timestamptz,
  opening_csv_uploaded_by uuid,
  opening_override_justification text,
  opening_override_at timestamptz,
  opening_override_by uuid,
  books_closing_cgst numeric DEFAULT 0,
  books_closing_sgst numeric DEFAULT 0,
  books_closing_igst numeric DEFAULT 0,
  updated_by uuid,
  updated_at timestamptz DEFAULT now(),
  opening_portal_pulled_at timestamptz,
  opening_portal_pulled_by uuid,
  utilized_cgst numeric,
  utilized_sgst numeric,
  utilized_igst numeric,
  drc_cgst numeric DEFAULT 0,
  drc_sgst numeric DEFAULT 0,
  drc_igst numeric DEFAULT 0,
  CONSTRAINT gst_receivable_reco_client_period_unique UNIQUE (client_id, period_month),
  CONSTRAINT gst_receivable_reco_opening_source_check CHECK (opening_source IN ('manual', 'csv', 'not_applicable', 'portal'))
);
-- The live policies: open to public (the app has no auth session).
ALTER TABLE public.suspended_reco ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can manage suspended reco" ON public.suspended_reco FOR ALL TO public USING (true) WITH CHECK (true);
ALTER TABLE public.gst_receivable_reco ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can manage gst_receivable_reco" ON public.gst_receivable_reco FOR ALL TO public USING (true) WITH CHECK (true);
ALTER TABLE public.bills_not_in_2b ENABLE ROW LEVEL SECURITY;
CREATE POLICY bills_open ON public.bills_not_in_2b FOR ALL TO public USING (true) WITH CHECK (true);
ALTER TABLE public.itc_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY itc_open ON public.itc_summaries FOR ALL TO public USING (true) WITH CHECK (true);
ALTER TABLE public.filing_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY fs_open ON public.filing_status FOR ALL TO public USING (true) WITH CHECK (true);
ALTER TABLE public.rcm_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY rcm_open ON public.rcm_data FOR ALL TO public USING (true) WITH CHECK (true);
ALTER TABLE public.gstr3b_push_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY pv_open ON public.gstr3b_push_versions FOR ALL TO public USING (true) WITH CHECK (true);
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
