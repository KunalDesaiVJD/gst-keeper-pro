-- Client allotment: an employee can be limited to the clients allotted to them.
--
-- Default: nobody is limited. An employee is limited only once a GST Manager or
-- the superadmin switches on "Only allotted clients" for them (Settings → User
-- Control → Client access); from then on they see and change only the clients
-- on their list (an empty list = no clients). GST Managers and the superadmin
-- are never limited.
--
-- How it is held in the database. The app has no Supabase auth session
-- (auth.uid() is NULL), but every request to /rest/v1 carries x-gst-actor, the
-- user signed in in that tab (src/lib/changeLogHeaders.ts). One function,
-- gst_actor_client_scope(), reads it: NULL = no limit (no header: extension
-- without an app user, agent, pg_cron, Edge Functions; a client's portal
-- sign-in; a GST Manager; an employee not limited), else the allotted client
-- ids. A RESTRICTIVE policy on every table holding client_id (and on clients
-- itself) ANDs it with the open policies, so every read and write the app
-- makes, the GST Assistant's reads (anon key + x-gst-actor) included, keeps to
-- the list. Views over client data become security_invoker, so they are
-- filtered too, and the cross-client list functions that ran as their owner
-- (SECURITY DEFINER bypasses RLS) now run as the caller.
--
-- Allotments change only through staff_set_client_allotment (GST Manager /
-- superadmin), every change logged in staff_client_allotment_log.
--
-- Idempotent: safe to run again. A table added later with client_id gets the
-- guard by running the DO block in section 4 again.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_client_scope (
  user_id uuid PRIMARY KEY,
  restricted boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_client_allotments (
  user_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  allotted_by uuid,
  allotted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS staff_client_allotments_client_idx ON public.staff_client_allotments (client_id);

CREATE TABLE IF NOT EXISTS public.staff_client_allotment_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('limit on', 'limit off', 'allot', 'remove')),
  client_id uuid,
  client_name text
);
CREATE INDEX IF NOT EXISTS staff_client_allotment_log_user_idx ON public.staff_client_allotment_log (user_id, at DESC);

-- Readable by the app (the Client access screen, the sign-in's own scope);
-- written only by staff_set_client_allotment (no write policy).
ALTER TABLE public.staff_client_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_client_allotments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_client_allotment_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_client_scope_read ON public.staff_client_scope;
CREATE POLICY staff_client_scope_read ON public.staff_client_scope FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS staff_client_allotments_read ON public.staff_client_allotments;
CREATE POLICY staff_client_allotments_read ON public.staff_client_allotments FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS staff_client_allotment_log_read ON public.staff_client_allotment_log;
CREATE POLICY staff_client_allotment_log_read ON public.staff_client_allotment_log FOR SELECT TO public USING (true);

-- ---------------------------------------------------------------------------
-- 2. Whose request is this, and which clients may it reach
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gst_actor_client_scope()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_h text;
  v_actor uuid;
BEGIN
  BEGIN
    v_h := nullif(current_setting('request.headers', true), '')::json ->> 'x-gst-actor';
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF v_h IS NULL OR v_h !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  v_actor := v_h::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.staff_client_scope s WHERE s.user_id = v_actor AND s.restricted) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = v_actor AND r.role IN ('superadmin', 'gst_manager')) THEN
    RETURN NULL;
  END IF;
  RETURN coalesce(ARRAY(SELECT a.client_id FROM public.staff_client_allotments a WHERE a.user_id = v_actor), '{}'::uuid[]);
END;
$$;

-- True when this request may reach the client (for checks in functions).
CREATE OR REPLACE FUNCTION public.gst_client_in_scope(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_client_id IS NULL
      OR public.gst_actor_client_scope() IS NULL
      OR p_client_id = ANY (public.gst_actor_client_scope());
$$;

GRANT EXECUTE ON FUNCTION public.gst_actor_client_scope() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gst_client_in_scope(uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The one door for changing an employee's allotment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_set_client_allotment(
  p_actor_id uuid, p_user_id uuid, p_restricted boolean, p_client_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[] := ARRAY(SELECT DISTINCT c.id FROM public.clients c WHERE c.id = ANY (coalesce(p_client_ids, '{}')));
  v_was boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_actor_id AND role IN ('superadmin', 'gst_manager')) THEN
    RAISE EXCEPTION 'Only a GST Manager or the superadmin allots clients.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'employee')
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role IN ('superadmin', 'gst_manager')) THEN
    RAISE EXCEPTION 'Clients are allotted to employees; a GST Manager sees every client.' USING ERRCODE = 'check_violation';
  END IF;
  -- One change at a time per person.
  PERFORM 1 FROM public.profiles WHERE user_id = p_user_id FOR UPDATE;

  SELECT restricted INTO v_was FROM public.staff_client_scope WHERE user_id = p_user_id;
  INSERT INTO public.staff_client_scope (user_id, restricted, updated_by, updated_at)
  VALUES (p_user_id, coalesce(p_restricted, false), p_actor_id, now())
  ON CONFLICT (user_id) DO UPDATE SET restricted = EXCLUDED.restricted, updated_by = EXCLUDED.updated_by, updated_at = now();
  IF coalesce(v_was, false) IS DISTINCT FROM coalesce(p_restricted, false) THEN
    INSERT INTO public.staff_client_allotment_log (actor_id, user_id, action)
    VALUES (p_actor_id, p_user_id, CASE WHEN p_restricted THEN 'limit on' ELSE 'limit off' END);
  END IF;

  WITH gone AS (
    DELETE FROM public.staff_client_allotments a
     WHERE a.user_id = p_user_id AND NOT (a.client_id = ANY (v_ids))
    RETURNING a.client_id
  )
  INSERT INTO public.staff_client_allotment_log (actor_id, user_id, action, client_id, client_name)
  SELECT p_actor_id, p_user_id, 'remove', g.client_id, c.name
    FROM gone g LEFT JOIN public.clients c ON c.id = g.client_id;

  WITH added AS (
    INSERT INTO public.staff_client_allotments (user_id, client_id, allotted_by)
    SELECT p_user_id, x, p_actor_id FROM unnest(v_ids) x
    ON CONFLICT (user_id, client_id) DO NOTHING
    RETURNING client_id
  )
  INSERT INTO public.staff_client_allotment_log (actor_id, user_id, action, client_id, client_name)
  SELECT p_actor_id, p_user_id, 'allot', a.client_id, c.name
    FROM added a LEFT JOIN public.clients c ON c.id = a.client_id;

  RETURN jsonb_build_object('restricted', coalesce(p_restricted, false), 'clients', coalesce(array_length(v_ids, 1), 0));
END;
$$;
REVOKE ALL ON FUNCTION public.staff_set_client_allotment(uuid, uuid, boolean, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.staff_set_client_allotment(uuid, uuid, boolean, uuid[]) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The guard on every table that holds a client's rows
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_pred text;
BEGIN
  FOR r IN
    SELECT c.relname, CASE WHEN c.relname = 'clients' THEN 'id' ELSE 'client_id' END AS col
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relrowsecurity
       AND c.relname NOT IN ('staff_client_scope', 'staff_client_allotments', 'staff_client_allotment_log')
       AND EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype
            AND a.attname = CASE WHEN c.relname = 'clients' THEN 'id' ELSE 'client_id' END)
  LOOP
    v_pred := format(
      '(%1$I IS NULL OR (SELECT public.gst_actor_client_scope()) IS NULL OR %1$I = ANY ((SELECT public.gst_actor_client_scope())))',
      r.col);
    EXECUTE format('DROP POLICY IF EXISTS staff_client_scope_guard ON public.%I', r.relname);
    EXECUTE format('CREATE POLICY staff_client_scope_guard ON public.%I AS RESTRICTIVE FOR ALL TO public USING %s WITH CHECK %s',
                   r.relname, v_pred, v_pred);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Views over client data are read as the caller, so the guard applies
--    (every table they read has an open SELECT policy; checked 25 Nov 2026)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'notice_cases', 'notice_cases_flat', 'notice_case_correspondence', 'notice_case_dispute_years',
    'notice_dispute_years', 'notice_dispute_year_sources', 'ai_learning_responses', 'ai_learning_clients',
    'builder_rcm_postings', 'builder_dastavej_reco', 'builder_unit_ledger', 'builder_period_postings',
    'builder_project_areas', 'client_fy_gstr1_turnover'
  ] LOOP
    IF to_regclass('public.' || v) IS NOT NULL THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Cross-client lists that ran as their owner now run as the caller
--    (they read only tables and views with open policies)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.notice_case_key_dates_range(date, date)',
    'public.notice_cases_counts(jsonb)',
    'public.notice_cases_counts_flat(jsonb)',
    'public.notice_cases_excluded()',
    'public.notice_stale_demands()',
    'public.notices_client_settings()',
    'public.sync_queue(uuid[])',
    'public.reply_evidence_pending(integer)'
  ] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SECURITY INVOKER', f);
    END IF;
  END LOOP;
END $$;
