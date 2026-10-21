-- The platform pieces the 2B migrations expect, as on the live project:
-- Supabase's roles, the staff tables (the real 20261017100000 then adds
-- staff_level_of and its guard), clients, filing_status and itc_summaries,
-- the 2B ledger as the Lovable-era schema created it (20260103112822, with
-- reclaim_subtype of 20260217113535 and without the auth.users keys), the
-- filing trigger before 20260814190000, and the tables the GSTR-3B gates read.
-- The real migrations for twob_import_docs / books_register, the ledger links,
-- the filing trigger and this change are applied on top (run.sh). Fictional.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
-- As Supabase sets it up: new functions in public are executable by the API roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE TYPE public.app_role AS ENUM ('superadmin', 'gst_manager', 'employee', 'client');
CREATE TYPE public.filing_status_type AS ENUM ('Prepared', 'Data Pending', 'Mismatch in Data', 'Not Verified', 'Filed', 'Prepared Pending', 'Data Received', 'Not to File', 'Pushed');
CREATE TYPE public.return_type AS ENUM ('GSTR-1', 'GSTR-3B', 'ITC-04', 'GSTR-6', 'GSTR-7', 'CMP-08', 'GSTR-1 (IFF)', 'GSTR-3B (Q)');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  first_name text NOT NULL,
  password text
);
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL DEFAULT 'employee',
  is_first_login boolean DEFAULT true,
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
  registration_type text DEFAULT 'Regular',
  regular_sub_type text DEFAULT 'Normal',
  builder_itc_type text,
  commercial_area numeric,
  residential_area numeric,
  liberal_2b_reconciliation boolean NOT NULL DEFAULT false
);
CREATE TABLE public.filing_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  return_type public.return_type NOT NULL,
  period_month text NOT NULL,
  status public.filing_status_type DEFAULT 'Prepared',
  filed_date date,
  arn text,
  is_locked boolean DEFAULT false,
  updated_by uuid,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (client_id, return_type, period_month)
);
CREATE TABLE public.itc_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  data jsonb,
  is_locked boolean DEFAULT false,
  updated_by uuid,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (client_id, period_month)
);

-- The ledger, as created in 20260103112822 (+ reclaim_subtype, 20260217113535).
CREATE TABLE public.bills_not_in_2b (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,
  supplier_name text NOT NULL,
  supplier_invoice_number text,
  supplier_gstin text,
  taxable_value numeric(15,2) DEFAULT 0,
  input_igst numeric(15,2) DEFAULT 0,
  input_cgst numeric(15,2) DEFAULT 0,
  input_sgst numeric(15,2) DEFAULT 0,
  reversal_month text,
  reclaim_month text,
  period_month text NOT NULL,
  is_locked boolean DEFAULT false,
  is_carried_forward boolean DEFAULT false,
  updated_by uuid,
  updated_at timestamptz DEFAULT now(),
  version integer DEFAULT 1
);
ALTER TABLE public.bills_not_in_2b ADD COLUMN IF NOT EXISTS reclaim_subtype text NULL;
CREATE TABLE public.bills_not_in_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,
  supplier_name text NOT NULL,
  supplier_invoice_number text,
  supplier_gstin text,
  taxable_value numeric(15,2) DEFAULT 0,
  input_igst numeric(15,2) DEFAULT 0,
  input_cgst numeric(15,2) DEFAULT 0,
  input_sgst numeric(15,2) DEFAULT 0,
  book_entry_month text,
  bill_in_2b_month text,
  period_month text NOT NULL,
  is_locked boolean DEFAULT false,
  is_carried_forward boolean DEFAULT false,
  updated_by uuid,
  updated_at timestamptz DEFAULT now(),
  version integer DEFAULT 1
);

-- 2B Reconciliation's saved versions (20260103112822 + action_type of 20260206095416).
CREATE TABLE public.twob_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  period_month text NOT NULL,
  table_type text NOT NULL,
  version_number integer DEFAULT 1,
  version_data jsonb,
  updated_by uuid,
  updated_at timestamptz DEFAULT now(),
  is_current boolean DEFAULT true,
  action_type text DEFAULT 'SAVE',
  restored_from_version_id uuid REFERENCES public.twob_versions(id)
);

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER update_bills_not_in_2b_updated_at BEFORE UPDATE ON public.bills_not_in_2b FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bills_not_in_books_updated_at BEFORE UPDATE ON public.bills_not_in_books FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_filing_status_updated_at BEFORE UPDATE ON public.filing_status FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- The filing trigger as 20260107122424 left it; 20260814190000 and this change replace its body.
CREATE FUNCTION public.auto_lock_on_filed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trigger_auto_lock_on_filed BEFORE UPDATE ON public.filing_status FOR EACH ROW EXECUTE FUNCTION public.auto_lock_on_filed();

-- What the GSTR-3B gates read besides the ledger (columns as the app reads them).
CREATE TABLE public.suspended_reco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  opening_cgst numeric DEFAULT 0, opening_sgst numeric DEFAULT 0, opening_igst numeric DEFAULT 0,
  portal_cgst numeric DEFAULT 0, portal_sgst numeric DEFAULT 0, portal_igst numeric DEFAULT 0,
  UNIQUE (client_id, period_month)
);
CREATE TABLE public.gst_receivable_reco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  opening_cgst numeric, opening_sgst numeric, opening_igst numeric,
  books_closing_cgst numeric, books_closing_sgst numeric, books_closing_igst numeric,
  utilized_cgst numeric, utilized_sgst numeric, utilized_igst numeric,
  drc_cgst numeric, drc_sgst numeric, drc_igst numeric,
  UNIQUE (client_id, period_month)
);
CREATE TABLE public.gstr1_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  raw_json jsonb
);
CREATE TABLE public.rcm_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  month text NOT NULL,
  financial_year text,
  taxable_value numeric DEFAULT 0,
  cgst_2_5 numeric DEFAULT 0, cgst_9 numeric DEFAULT 0, sgst_2_5 numeric DEFAULT 0, sgst_9 numeric DEFAULT 0,
  igst_5 numeric DEFAULT 0, igst_18 numeric DEFAULT 0
);
CREATE TABLE public.gstr3b_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  table_ref text, label text,
  taxable_value numeric DEFAULT 0, igst numeric DEFAULT 0, cgst numeric DEFAULT 0, sgst numeric DEFAULT 0, cess numeric DEFAULT 0
);
CREATE TABLE public.builder_rcm_postings (
  client_id uuid NOT NULL,
  period_month text NOT NULL,
  taxable_value numeric, cgst numeric, sgst numeric
);
CREATE TABLE public.gstr3b_push_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  version_number integer,
  status text,
  payload jsonb,
  action_at timestamptz DEFAULT now()
);

-- Open policies, as live (the app has no auth session).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_roles', 'user_permissions', 'profiles', 'clients', 'filing_status', 'itc_summaries',
                           'bills_not_in_2b', 'bills_not_in_books', 'suspended_reco', 'gst_receivable_reco', 'gstr1_data',
                           'rcm_data', 'gstr3b_adjustments', 'gstr3b_push_versions', 'twob_versions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "open" ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Test helpers (callable as anon: the tests act as PostgREST does)
-- ---------------------------------------------------------------------------
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
-- Passes when p_sql runs without an error.
CREATE FUNCTION public.t_ok(p_sql text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FAILED %: raised [%]', p_label, SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public.t_eq(anyelement, anyelement, text), public.t_raises(text, text, text), public.t_ok(text, text) TO anon;
