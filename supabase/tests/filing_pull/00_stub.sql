-- What the filing-status migration (20261021110000) expects, as on project
-- gcquafqxbykxkbexcdpy on 21 Oct 2026: Supabase's roles, the enums, the
-- tables it reads and writes (only the columns it touches, plus the live
-- constraints and open policies), and the live trigger functions on
-- filing_status, copied from pg_get_functiondef. Fictional data only.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
DO $$ BEGIN CREATE PUBLICATION supabase_realtime; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TYPE public.app_role AS ENUM ('superadmin', 'gst_manager', 'employee', 'client');
CREATE TYPE public.registration_type AS ENUM ('Regular', 'Composition', 'Tax Deductor', 'ISD', 'IFF');
CREATE TYPE public.return_type AS ENUM ('GSTR-1', 'GSTR-3B', 'ITC-04', 'GSTR-6', 'GSTR-7', 'CMP-08', 'GSTR-1 (IFF)', 'GSTR-3B (Q)', 'GSTR-1A', 'GSTR-9', 'GSTR-9C');
CREATE TYPE public.filing_status_type AS ENUM ('Prepared', 'Data Pending', 'Mismatch in Data', 'Not Verified', 'Filed', 'Prepared Pending', 'Data Received', 'Not to File', 'Pushed');

CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE, first_name text NOT NULL);
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL, UNIQUE (user_id, role));
CREATE TABLE public.user_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, permission_key text NOT NULL, granted_by uuid, granted_at timestamptz DEFAULT now());
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gstin text NOT NULL,
  name text NOT NULL,
  registration_type public.registration_type NOT NULL DEFAULT 'Regular',
  email text,
  selected_returns public.return_type[] DEFAULT '{}'::public.return_type[],
  target_date_group1 integer DEFAULT 11,
  target_date_group2 integer DEFAULT 20
);
CREATE TABLE public.client_scheme_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  old_scheme text NOT NULL, new_scheme text NOT NULL, effective_from_date date NOT NULL,
  changed_by uuid, changed_at timestamptz NOT NULL DEFAULT now(), notes text
);
CREATE TABLE public.filing_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  return_type public.return_type NOT NULL,
  period_month text NOT NULL,
  status public.filing_status_type DEFAULT 'Prepared',
  target_date integer DEFAULT 11,
  filed_date date,
  remarks text,
  is_locked boolean DEFAULT false,
  updated_by uuid,
  updated_at timestamptz DEFAULT now(),
  arn text,
  return_pdf_url text,
  is_nil boolean NOT NULL DEFAULT false,
  pushed_at timestamptz,
  CONSTRAINT filing_status_arn_unique UNIQUE (arn),
  CONSTRAINT filing_status_client_id_return_type_period_month_key UNIQUE (client_id, return_type, period_month)
);
CREATE TABLE public.bills_not_in_2b (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, date date NOT NULL, supplier_name text NOT NULL,
  supplier_invoice_number text, supplier_gstin text, taxable_value numeric DEFAULT 0, input_igst numeric DEFAULT 0,
  input_cgst numeric DEFAULT 0, input_sgst numeric DEFAULT 0, reversal_month text, reclaim_month text,
  period_month text NOT NULL, is_locked boolean DEFAULT false, is_carried_forward boolean DEFAULT false,
  updated_by uuid, updated_at timestamptz DEFAULT now(), reclaim_subtype text
);
CREATE TABLE public.bills_not_in_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, date date NOT NULL, supplier_name text NOT NULL,
  supplier_invoice_number text, supplier_gstin text, taxable_value numeric DEFAULT 0, input_igst numeric DEFAULT 0,
  input_cgst numeric DEFAULT 0, input_sgst numeric DEFAULT 0, book_entry_month text, bill_in_2b_month text,
  period_month text NOT NULL, is_locked boolean DEFAULT false, is_carried_forward boolean DEFAULT false,
  updated_by uuid, updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.itc_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, period_month text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}', is_locked boolean DEFAULT false, updated_by uuid, updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.email_templates (key text PRIMARY KEY, name text NOT NULL, kind text NOT NULL, subject text NOT NULL, body text NOT NULL, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.client_reminder_settings (client_id uuid PRIMARY KEY, send_confirmation boolean NOT NULL DEFAULT true);
CREATE TABLE public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid, to_email text NOT NULL, kind text NOT NULL,
  template_key text NOT NULL, return_type public.return_type, period_month text, subject text NOT NULL, body text NOT NULL,
  status text NOT NULL DEFAULT 'pending', filing_status_id uuid REFERENCES public.filing_status(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, render_vars jsonb
);
CREATE UNIQUE INDEX uq_email_outbox_confirmation ON public.email_outbox (client_id, return_type, period_month) WHERE kind = 'confirmation';
CREATE TABLE public.advance_setoff_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, period_month text NOT NULL, return_type text NOT NULL,
  request_reason text NOT NULL DEFAULT 'x', status text NOT NULL DEFAULT 'PENDING', requested_at timestamptz NOT NULL DEFAULT now(),
  filed_after_override boolean NOT NULL DEFAULT false, arn text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.gstr1_direct_filing_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, return_type text NOT NULL, period_month text NOT NULL,
  status text NOT NULL DEFAULT 'pending', reason text NOT NULL DEFAULT 'x'
);
CREATE TABLE public.gst_filed_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL, return_type text NOT NULL, arn text, filed_date date, status text,
  summary jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, period_month, return_type)
);

-- The live policies (open: the app has no auth session).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','user_roles','user_permissions','clients','client_scheme_history','filing_status','bills_not_in_2b',
    'bills_not_in_books','itc_summaries','email_templates','client_reminder_settings','email_outbox',
    'advance_setoff_overrides','gstr1_direct_filing_approvals','gst_filed_returns'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY open_%s ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
ALTER PUBLICATION supabase_realtime ADD TABLE public.filing_status, public.clients;

-- GSTR-3A closing is out of scope here.
CREATE FUNCTION public.notices_close_gstr3a_filed(p_client_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE OR REPLACE FUNCTION public.gstr1_direct_filing_rule_applies(p_return_type text, p_period text)
 RETURNS boolean LANGUAGE sql IMMUTABLE
AS $function$
  SELECT p_return_type IN ('GSTR-1', 'GSTR-1 (IFF)')
     AND p_period ~ '^[0-9]{2}/[0-9]{4}$'
     AND (split_part(p_period, '/', 2)::int * 100 + split_part(p_period, '/', 1)::int) >= 202609;
$function$;

-- Live function definitions (pg_get_functiondef, 21 Oct 2026).
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_level_of(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN bool_or(role = 'superadmin') THEN 'superadmin'
    WHEN bool_or(role = 'gst_manager') THEN 'gst_manager'
    WHEN bool_or(role = 'employee') THEN 'employee'
  END
    FROM public.user_roles WHERE user_id = p_user_id;
$function$;

CREATE OR REPLACE FUNCTION public.filing_effective_return_type(p_client_id uuid, p_base text, p_period_month text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scheme   text;
  v_selected text[];
  v_has_hist boolean;
  v_period   date;
  v_month    int;
  v_list     text[];
BEGIN
  IF p_base NOT IN ('GSTR-1', 'GSTR-1 (IFF)', 'GSTR-3B', 'GSTR-3B (Q)') THEN
    RETURN p_base;
  END IF;

  SELECT c.registration_type::text, c.selected_returns::text[]
    INTO v_scheme, v_selected
    FROM public.clients c
   WHERE c.id = p_client_id;

  IF p_period_month ~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN
    v_period := to_date('01/' || p_period_month, 'DD/MM/YYYY');
    v_month  := split_part(p_period_month, '/', 1)::int;
  END IF;

  v_has_hist := EXISTS (SELECT 1 FROM public.client_scheme_history h WHERE h.client_id = p_client_id);

  -- getEffectiveScheme() falls back to the current scheme for a period it
  -- cannot parse, history or not.
  IF v_has_hist AND v_period IS NOT NULL THEN
    v_scheme := COALESCE(
      (SELECT h.new_scheme FROM public.client_scheme_history h
        WHERE h.client_id = p_client_id
          AND date_trunc('month', h.effective_from_date)::date <= v_period
        ORDER BY h.effective_from_date DESC, h.changed_at DESC, h.id DESC
        LIMIT 1),
      (SELECT h.old_scheme FROM public.client_scheme_history h
        WHERE h.client_id = p_client_id
        ORDER BY h.effective_from_date, h.changed_at, h.id
        LIMIT 1));
  END IF;

  v_list := CASE
    WHEN v_has_hist THEN CASE v_scheme
      WHEN 'Regular'      THEN ARRAY['GSTR-1', 'GSTR-3B', 'ITC-04']
      WHEN 'Composition'  THEN ARRAY['CMP-08']
      WHEN 'Tax Deductor' THEN ARRAY['GSTR-7']
      WHEN 'ISD'          THEN ARRAY['GSTR-6']
      WHEN 'IFF'          THEN ARRAY['GSTR-1 (IFF)', 'GSTR-3B (Q)']
      ELSE ARRAY[]::text[]
    END
    ELSE COALESCE(v_selected, ARRAY[]::text[])
  END;

  IF p_base IN ('GSTR-1', 'GSTR-1 (IFF)') THEN
    RETURN CASE WHEN 'GSTR-1 (IFF)' = ANY (v_list) AND NOT ('GSTR-1' = ANY (v_list))
                THEN 'GSTR-1 (IFF)' ELSE 'GSTR-1' END;
  END IF;

  -- Filing Status shows 'GSTR-3B (Q)' only in a quarter-end month of a
  -- quarterly scheme, and never 'GSTR-3B' for one; outside the quarter end the
  -- plain type is the only one there is.
  RETURN CASE WHEN v_scheme IN ('IFF', 'Composition')
               AND v_month IN (3, 6, 9, 12)
               AND 'GSTR-3B (Q)' = ANY (v_list)
              THEN 'GSTR-3B (Q)' ELSE 'GSTR-3B' END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.filing_record_push(p_client_id uuid, p_base text, p_period_month text, p_actor uuid, p_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_family    text[];
  v_effective text;
  v_result    text;
BEGIN
  PERFORM set_config('app.filing_push', 'on', true);

  v_family := CASE
    WHEN p_base IN ('GSTR-1', 'GSTR-1 (IFF)') THEN ARRAY['GSTR-1', 'GSTR-1 (IFF)']
    WHEN p_base IN ('GSTR-3B', 'GSTR-3B (Q)') THEN ARRAY['GSTR-3B', 'GSTR-3B (Q)']
    ELSE ARRAY[p_base]
  END;
  v_effective := public.filing_effective_return_type(p_client_id, p_base, p_period_month);

  UPDATE public.filing_status
     SET pushed_at = p_at
   WHERE client_id = p_client_id
     AND period_month = p_period_month
     AND return_type::text = ANY (v_family)
     AND status::text = 'Filed'
     AND upper(btrim(arn)) ~ '^[A-Z0-9]{15}$'
     AND NULLIF(btrim(return_pdf_url), '') IS NOT NULL;

  UPDATE public.filing_status
     SET status     = 'Pushed'::filing_status_type,
         pushed_at  = p_at,
         updated_at = now(),
         updated_by = COALESCE(p_actor, updated_by)
   WHERE client_id = p_client_id
     AND period_month = p_period_month
     AND return_type::text = ANY (v_family)
     AND status::text IS DISTINCT FROM 'Filed';

  INSERT INTO public.filing_status
    (client_id, return_type, period_month, status, updated_by, updated_at, pushed_at)
  VALUES
    (p_client_id, v_effective::return_type, p_period_month,
     'Pushed'::filing_status_type, p_actor, now(), p_at)
  ON CONFLICT (client_id, return_type, period_month) DO NOTHING;

  SELECT status::text INTO v_result
    FROM public.filing_status
   WHERE client_id = p_client_id
     AND period_month = p_period_month
     AND return_type::text = v_effective;

  RETURN COALESCE(v_result, 'Pushed');
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_filing_pushed(p_client_id uuid, p_return_type text, p_period_month text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.filing_record_push(p_client_id, p_return_type, p_period_month, p_actor, now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_inapplicable_filing_status_after_scheme_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  applicable_returns public.return_type[];
BEGIN
  applicable_returns := CASE NEW.new_scheme
    WHEN 'Regular' THEN ARRAY['GSTR-1', 'GSTR-3B', 'ITC-04']::public.return_type[]
    WHEN 'IFF' THEN ARRAY['GSTR-1 (IFF)', 'GSTR-3B (Q)']::public.return_type[]
    WHEN 'Composition' THEN ARRAY['CMP-08']::public.return_type[]
    WHEN 'Tax Deductor' THEN ARRAY['GSTR-7']::public.return_type[]
    WHEN 'ISD' THEN ARRAY['GSTR-6']::public.return_type[]
    ELSE ARRAY[]::public.return_type[]
  END;

  UPDATE public.filing_status fs
  SET status = 'Data Pending',
      arn = NULL,
      filed_date = NULL,
      is_locked = false,
      updated_at = now()
  WHERE fs.client_id = NEW.client_id
    AND to_date('01/' || fs.period_month, 'DD/MM/YYYY') >= date_trunc('month', NEW.effective_from_date)::date
    AND NOT (fs.return_type = ANY(applicable_returns))
    AND (fs.status = 'Filed' OR fs.arn IS NOT NULL OR fs.filed_date IS NOT NULL OR fs.is_locked = true);

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_lock_on_filed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next_period text;
BEGIN
  -- Only set filed_date when status changes to Filed
  IF NEW.status = 'Filed' AND (OLD.status IS NULL OR OLD.status != 'Filed') THEN
    NEW.filed_date := COALESCE(NEW.filed_date, CURRENT_DATE);

    -- ONLY lock 2B and ITC data when GSTR-3B is filed
    IF NEW.return_type = 'GSTR-3B' THEN
      NEW.is_locked := TRUE;

      -- Lock 2B data for this client and month
      UPDATE public.bills_not_in_2b
      SET is_locked = TRUE
      WHERE client_id = NEW.client_id AND period_month = NEW.period_month;

      UPDATE public.bills_not_in_books
      SET is_locked = TRUE
      WHERE client_id = NEW.client_id AND period_month = NEW.period_month;

      -- Lock ITC Summary
      UPDATE public.itc_summaries
      SET is_locked = TRUE
      WHERE client_id = NEW.client_id AND period_month = NEW.period_month;

      -- Carry forward all bills_not_in_2b / bills_not_in_books rows for this
      -- client+period into next period, exactly matching
      -- carryForwardToNextMonth()'s semantics: delete existing carried-forward
      -- rows there first (so this is safe to run more than once), then copy
      -- every row (regardless of reclaim/book-entry status) forward.
      v_next_period := to_char(to_date(NEW.period_month, 'MM/YYYY') + INTERVAL '1 month', 'MM/YYYY');

      DELETE FROM public.bills_not_in_2b
      WHERE client_id = NEW.client_id AND period_month = v_next_period AND is_carried_forward = true;

      INSERT INTO public.bills_not_in_2b (
        client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
        taxable_value, input_igst, input_cgst, input_sgst,
        period_month, reversal_month, reclaim_month, reclaim_subtype, is_carried_forward
      )
      SELECT
        client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
        taxable_value, input_igst, input_cgst, input_sgst,
        v_next_period, reversal_month, reclaim_month, reclaim_subtype, true
      FROM public.bills_not_in_2b
      WHERE client_id = NEW.client_id AND period_month = NEW.period_month;

      DELETE FROM public.bills_not_in_books
      WHERE client_id = NEW.client_id AND period_month = v_next_period AND is_carried_forward = true;

      INSERT INTO public.bills_not_in_books (
        client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
        taxable_value, input_igst, input_cgst, input_sgst,
        period_month, book_entry_month, bill_in_2b_month, is_carried_forward
      )
      SELECT
        client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
        taxable_value, input_igst, input_cgst, input_sgst,
        v_next_period, book_entry_month, bill_in_2b_month, true
      FROM public.bills_not_in_books
      WHERE client_id = NEW.client_id AND period_month = NEW.period_month;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.filing_status_close_gstr3a()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.filed_date IS NOT NULL OR NEW.status::text = 'Filed' THEN
    PERFORM public.notices_close_gstr3a_filed(NEW.client_id);
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.filing_status_guard_direct_filing()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_pushed timestamptz;
  v_nil    boolean;
BEGIN
  IF NEW.status::text <> 'Filed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text = 'Filed' THEN RETURN NEW; END IF;
  IF NOT public.gstr1_direct_filing_rule_applies(NEW.return_type::text, NEW.period_month) THEN
    RETURN NEW;
  END IF;

  -- An upsert (INSERT ... ON CONFLICT DO UPDATE, as the extension's pull
  -- does) reaches BEFORE INSERT with only the incoming columns, so read the
  -- stored rows' marker, and the stored NIL flag of NEW's own type, as well.
  v_pushed := NEW.pushed_at;
  v_nil := COALESCE(NEW.is_nil, false);
  IF v_pushed IS NULL OR NOT v_nil THEN
    SELECT COALESCE(v_pushed, max(fs.pushed_at)),
           v_nil OR COALESCE(bool_or(fs.is_nil) FILTER (WHERE fs.return_type = NEW.return_type), false)
      INTO v_pushed, v_nil
      FROM public.filing_status fs
     WHERE fs.client_id = NEW.client_id
       AND fs.return_type::text IN ('GSTR-1', 'GSTR-1 (IFF)')
       AND fs.period_month = NEW.period_month;
  END IF;
  IF v_pushed IS NOT NULL OR COALESCE(v_nil, false) THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.gstr1_direct_filing_approvals a
     WHERE a.client_id = NEW.client_id
       AND a.return_type = NEW.return_type::text
       AND a.period_month = NEW.period_month
       AND a.status = 'approved'
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    '% for % was not pushed through GST Keeper, so it cannot be marked Filed or pulled from the portal until a superadmin approves a direct-filing request (Filing Status → Request approval).',
    NEW.return_type::text, NEW.period_month
    USING ERRCODE = 'check_violation';
END;
$function$;

CREATE OR REPLACE FUNCTION public.filing_status_guard_pushed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status::text = 'Pushed'
     AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'Pushed')
     AND coalesce(current_setting('app.filing_push', true), '') <> 'on'
  THEN
    RAISE EXCEPTION
      'Filing status "Pushed" is set automatically when a push to the GST portal succeeds. It cannot be selected by hand.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_filing_status_filed_requirements()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.arn := NULLIF(upper(btrim(NEW.arn)), '');

  IF NEW.status <> 'Filed' THEN
    NEW.arn := NULL;
    NEW.filed_date := NULL;
  END IF;

  IF NEW.status = 'Filed' THEN
    IF NEW.arn IS NULL THEN
      RAISE EXCEPTION 'ARN is mandatory before marking return as Filed';
    END IF;

    IF NEW.arn !~ '^[A-Z0-9]{15}$' THEN
      RAISE EXCEPTION 'ARN must be exactly 15 alphanumeric characters';
    END IF;

    IF NEW.return_pdf_url IS NULL OR btrim(NEW.return_pdf_url) = '' THEN
      RAISE EXCEPTION 'Return PDF is mandatory before marking return as Filed';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.filing_record_push(uuid, text, text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- The live triggers on filing_status and client_scheme_history.
CREATE TRIGGER filing_status_close_gstr3a AFTER INSERT OR UPDATE OF status, filed_date ON public.filing_status FOR EACH ROW EXECUTE FUNCTION filing_status_close_gstr3a();
CREATE TRIGGER trg_filing_status_guard_direct_filing BEFORE INSERT OR UPDATE ON public.filing_status FOR EACH ROW EXECUTE FUNCTION filing_status_guard_direct_filing();
CREATE TRIGGER trg_filing_status_guard_pushed BEFORE INSERT OR UPDATE ON public.filing_status FOR EACH ROW EXECUTE FUNCTION filing_status_guard_pushed();
CREATE TRIGGER trigger_auto_lock_on_filed BEFORE UPDATE ON public.filing_status FOR EACH ROW EXECUTE FUNCTION auto_lock_on_filed();
CREATE TRIGGER update_filing_status_updated_at BEFORE UPDATE ON public.filing_status FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER validate_filing_status_filed_requirements_trigger BEFORE INSERT OR UPDATE ON public.filing_status FOR EACH ROW EXECUTE FUNCTION validate_filing_status_filed_requirements();
CREATE TRIGGER clear_inapplicable_filing_status_after_scheme_change_trigger AFTER INSERT ON public.client_scheme_history FOR EACH ROW EXECUTE FUNCTION clear_inapplicable_filing_status_after_scheme_change();

-- Test helpers.
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

-- Fictional staff and clients used by every test.
INSERT INTO public.profiles (user_id, first_name) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'Asha'),      -- superadmin
  ('00000000-0000-0000-0000-00000000000b', 'Bharat'),    -- GST Manager
  ('00000000-0000-0000-0000-00000000000c', 'Chetan'),    -- employee
  ('00000000-0000-0000-0000-00000000000d', 'Divya');     -- employee whose position holds unlock_sheets
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'superadmin'),
  ('00000000-0000-0000-0000-00000000000b', 'gst_manager'),
  ('00000000-0000-0000-0000-00000000000c', 'employee'),
  ('00000000-0000-0000-0000-00000000000d', 'employee');
INSERT INTO public.user_permissions (user_id, permission_key) VALUES
  ('00000000-0000-0000-0000-00000000000c', 'edit_filing_status'),
  ('00000000-0000-0000-0000-00000000000d', 'edit_filing_status'),
  ('00000000-0000-0000-0000-00000000000d', 'unlock_sheets');
INSERT INTO public.clients (id, gstin, name, registration_type, email, selected_returns) VALUES
  ('11111111-1111-1111-1111-111111111111', '24ABCDE1234F1Z5', 'FICTIONAL FABRICS', 'Regular', 'owner@fabrics.example', '{GSTR-1,GSTR-3B}'),
  ('22222222-2222-2222-2222-222222222222', '24PQRSX5678K1Z2', 'IMAGINARY IMPEX', 'IFF', 'desk@impex.example', '{GSTR-1 (IFF),GSTR-3B (Q)}'),
  ('33333333-3333-3333-3333-333333333333', '27LMNOP4321Q1Z9', 'TWIN TRADERS', 'Regular', NULL, '{GSTR-1,GSTR-1 (IFF),GSTR-3B}'),
  ('44444444-4444-4444-4444-444444444444', '24ZZZZZ9999Z1Z1', 'COMPOSITE CO', 'Composition', 'a@composite.example', '{CMP-08}');
INSERT INTO public.email_templates (key, name, kind, subject, body) VALUES
  ('confirmation', 'Confirmation', 'confirmation', 'Filed - {{return_type}} for {{period}} | ARN {{arn}} | {{client_name}}',
   'Dear {{contact_person}}, your {{return_type}} for {{period}} was filed on {{filing_date}} (ARN {{arn}}). {{unknown_var}}Regards, {{staff_name}}');
