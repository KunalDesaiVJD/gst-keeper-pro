-- Suspended Reco and GST Receivable Reco: portal figures by pull only, and one
-- GSTR-3B push gate (the firm's decisions of 21 Oct 2026).
--
--  (a) From the Jun-2026 return period (06/2026) the opening balances, and
--      the GST Receivable Reco's ITC utilised and DRC-03 figures, come only
--      from the browser extension's pull, for every client, Nil returns
--      included. The CSV upload, Not Applicable, and any save that changes
--      opening_* / utilized_* / drc_* / opening_source or the pull and CSV
--      stamps are refused by reco_source_guard. The pull writes through
--      reco_record_pull, which stamps who pulled and when (server time) and
--      clears a stale override, CSV stamps and allowance. Typed books figures
--      (books_closing_*) and the Suspended Reco's portal_* snapshot stay
--      editable. Periods before 06/2026 keep today's behaviour.
--  (b) When a pull cannot be done (wrong portal password, portal down, no
--      access), the superadmin may allow a manual entry for one client, month
--      and reco: a row in manual_source_allowances (scope 'reco:suspended' or
--      'reco:receivable'), given with a reason through manual_source_allow and
--      taken back through manual_source_revoke. reco_manual_opening uses it
--      once (CSV upload or Not Applicable) and links the row to it
--      (opening_allowance_id); everything shows it as "manual (allowed by X:
--      reason)". The table, its guard and the two RPCs are shared with the
--      filing branch: keep them byte-identical there.
--  (c) The opening balance override may be made by the superadmin and GST
--      Managers (was the superadmin only, 20261020150000), with a reason of at
--      least 5 characters; the time is the database's.
--  (d) Every change of a reco's portal side (pull, manual entry, override,
--      insert, delete) is written to reco_opening_log (select only).
--
-- The GSTR-3B push gate is one function, gstr3b_push_gate(client, period),
-- used by the GSTR-3B page's push and its JSON download and by the extension
-- (0.16.0) before it opens the portal. It passes only when, for that client
-- and month:
--  * Suspended Reco is pulled (or allowed manual) and its difference is 0
--    after the ₹10 tolerance per head (Builder + NO_ITC: the difference is
--    waived, as before; the pull is still needed);
--  * GST Receivable Reco (from 06/2026) is pulled (or allowed manual) and its
--    difference is 0 after the ₹10 tolerance.
-- Nil returns are included. A missing row blocks. Any error blocks ("fails
-- closed"); the app treats an error calling it the same way. Before 06/2026
-- it checks only the Suspended Reco difference, with no tolerance, as the
-- page did. The differences are suspended_reco_difference and
-- gst_receivable_reco_difference, ports of src/lib/suspendedRecoCalc.ts and
-- src/lib/gstReceivableRecoCalc.ts (supabase/tests/reco_gate/parity.mjs runs
-- both on the same rows); a change to either formula must be made in both.
-- One deliberate change in both: from 06/2026 a pulled (or allowed) GST
-- Receivable Reco takes ITC utilised from the credit ledger only, a pull that
-- saw no set-off debit meaning 0; the GSTR-1 estimate is shown only before
-- the pull. docs/2B_RECONCILIATION_FLOW.md §13.
--
-- Who acts is the p_actor_id the app sends (the app has no auth session, so
-- auth.uid() is NULL), as for every staff_* function. RLS stays open to
-- public; the gates are the triggers and the SECURITY DEFINER functions.
--
-- Re-runnable. Changes no existing row.
--
-- ===========================================================================
-- Live apply (project gcquafqxbykxkbexcdpy ONLY; never SUPABASE_PROJECT_REF)
-- ===========================================================================
-- 1. Dry checks (SELECT only), note the numbers:
--      SELECT to_regprocedure('public.staff_level_of(uuid)') IS NOT NULL;            -- true
--      SELECT to_regprocedure('public.opening_override_guard()') IS NOT NULL;        -- true
--      SELECT to_regclass('public.manual_source_allowances');                        -- NULL, or the filing
--        -- branch's table: then compare its columns with the DDL below first.
--      SELECT opening_source, count(*) FROM suspended_reco GROUP BY 1 ORDER BY 1;    -- 21 Oct 09:10 IST: csv 8,
--        -- manual 354, not_applicable 2, portal 126 (490 rows)
--      SELECT opening_source, count(*) FROM gst_receivable_reco GROUP BY 1 ORDER BY 1; -- csv 5, manual 3, portal 132 (140)
--      SELECT count(*) FROM suspended_reco WHERE opening_override_justification IS NOT NULL;      -- 8
--      SELECT count(*) FROM gst_receivable_reco WHERE opening_override_justification IS NOT NULL; -- 0
--      SELECT count(*) FROM gstr3b_push_versions;                                    -- 271
--      SELECT count(*) FROM suspended_reco WHERE opening_source = 'portal' AND opening_portal_pulled_at IS NULL;  -- 0
--      (the same on gst_receivable_reco: 0; a pull row without a time would read as not pulled)
-- 2. Apply this file once (it is safe to apply again).
-- 3. After checks: the counts in step 1 are unchanged; reco_opening_log and
--    manual_source_allowances have 0 rows;
--      SELECT has_function_privilege('anon', p, 'execute') FROM unnest(ARRAY[
--        'public.gstr3b_push_gate(uuid,text)', 'public.manual_source_allow(uuid,uuid,text,text,text)',
--        'public.manual_source_revoke(uuid,uuid)', 'public.reco_record_pull(uuid,text,uuid,text,jsonb,jsonb,jsonb,text)',
--        'public.reco_manual_opening(uuid,text,uuid,text,text,jsonb,jsonb,jsonb,text)']) p;  -- all true
--      SELECT has_function_privilege('anon', 'public.manual_source_use(uuid,uuid,text,text)', 'execute'); -- false
--    The gate for 09/2026 (every client with a GSTR-3B / GSTR-3B (Q) row):
--      SELECT g->>'ok', count(*) FROM (SELECT public.gstr3b_push_gate(f.client_id, f.period_month) g
--        FROM filing_status f WHERE f.return_type::text IN ('GSTR-3B','GSTR-3B (Q)')
--        AND f.period_month = '09/2026') x GROUP BY 1;
--    On a copy of the live rows of 21 Oct the wider base (a 3B row, a reco row
--    or a push: 86 clients) gave 38 pass, 48 blocked: 43 neither reco pulled,
--    3 Suspended Reco not pulled, 1 Suspended Reco difference (NAVRATNA S G
--    HIGHWAY, already Filed), 1 GST Receivable Reco difference (SHIVAM PLY &
--    FURNITURE). Expect the same give or take pulls made since. 10/2026 has
--    no reco row yet for any client, so every October push is blocked until
--    both recos are pulled.
--    With the anon key from .env (never the management API, which bypasses
--    RLS), a refused write changes nothing and proves the guard:
--      PATCH /rest/v1/suspended_reco?client_id=eq.<id>&period_month=eq.09/2026 {"opening_source":"csv"}
--      -> 4xx "From Jun 2026 the opening balance comes only from the portal pull..."
-- 4. Release in this order, the same hour: this migration, the app (Vercel),
--    then extension 0.16.0 in every office Chrome (chrome://extensions ->
--    Reload from the updated extension folder). Until 0.16.0 is loaded a pull
--    from an older extension is refused by the guard (the reco pages ask for
--    0.16.0 before they start one), and the app asks for 0.16.0 before a
--    GSTR-3B push. No Edge Function changes.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Manual source allowances (shared with the filing branch: keep identical)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.manual_source_allowances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL CHECK (period_month ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
  scope text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  allowed_by uuid NOT NULL,
  allowed_at timestamptz NOT NULL DEFAULT now(),
  used_by uuid,
  used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS manual_source_allowances_one_live ON public.manual_source_allowances (client_id, period_month, scope) WHERE revoked_at IS NULL;
ALTER TABLE public.manual_source_allowances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manual_source_allowances_public ON public.manual_source_allowances;
CREATE POLICY manual_source_allowances_public ON public.manual_source_allowances FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_source_allowances TO anon, authenticated, service_role;

-- Rows change only inside manual_source_allow / manual_source_revoke /
-- manual_source_use (app.manual_source = 'on' for that moment), never by a
-- direct write. A client's deletion still removes its rows (the cascade runs
-- one trigger level down).
CREATE OR REPLACE FUNCTION public.manual_source_allowances_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('app.manual_source', true), '') = 'on'
     OR (TG_OP = 'DELETE' AND pg_trigger_depth() > 1) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Manual entries are allowed and revoked only by the superadmin, on the page concerned.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
DROP TRIGGER IF EXISTS trg_manual_source_allowances_guard ON public.manual_source_allowances;
CREATE TRIGGER trg_manual_source_allowances_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.manual_source_allowances
  FOR EACH ROW EXECUTE FUNCTION public.manual_source_allowances_guard();

-- The superadmin allows a manual entry for one client, month and scope
-- (e.g. 'reco:suspended', 'filing:GSTR-3B'). One live allowance per client,
-- month and scope: revoke the old one first.
CREATE OR REPLACE FUNCTION public.manual_source_allow(
  p_actor_id uuid, p_client_id uuid, p_period text, p_scope text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text := btrim(coalesce(p_scope, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_row public.manual_source_allowances;
BEGIN
  IF p_actor_id IS NULL OR public.staff_level_of(p_actor_id) IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Only the superadmin can allow a manual entry.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_period IS NULL OR p_period !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN
    RAISE EXCEPTION 'The month must be MM/YYYY.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_scope !~ '^[a-z0-9_]+:[A-Za-z0-9][A-Za-z0-9 ()/._-]*$' OR length(v_scope) > 60 THEN
    RAISE EXCEPTION 'Unknown scope "%".', v_scope USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Give a reason of at least 5 characters.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'No such client.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('manual_source:' || p_client_id::text || ':' || p_period || ':' || v_scope, 0));
  IF EXISTS (SELECT 1 FROM public.manual_source_allowances
              WHERE client_id = p_client_id AND period_month = p_period AND scope = v_scope AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'A manual entry is already allowed for this client and month. Revoke it first.'
      USING ERRCODE = 'unique_violation';
  END IF;
  PERFORM set_config('app.manual_source', 'on', true);
  INSERT INTO public.manual_source_allowances (client_id, period_month, scope, reason, allowed_by)
  VALUES (p_client_id, p_period, v_scope, v_reason, p_actor_id)
  RETURNING * INTO v_row;
  PERFORM set_config('app.manual_source', '', true);
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.manual_source_revoke(p_actor_id uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.manual_source_allowances;
BEGIN
  IF p_actor_id IS NULL OR public.staff_level_of(p_actor_id) IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Only the superadmin can revoke a manual entry.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_row FROM public.manual_source_allowances WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such allowance.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This allowance is already revoked.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('app.manual_source', 'on', true);
  UPDATE public.manual_source_allowances SET revoked_at = now(), revoked_by = p_actor_id
   WHERE id = p_id RETURNING * INTO v_row;
  PERFORM set_config('app.manual_source', '', true);
  RETURN to_jsonb(v_row);
END;
$$;

-- Uses the live, unused allowance for a client, month and scope, once: marks
-- it used and returns its id. Called only from SECURITY DEFINER functions
-- (here reco_manual_opening); never granted to the public key.
CREATE OR REPLACE FUNCTION public.manual_source_use(
  p_actor_id uuid, p_client_id uuid, p_period text, p_scope text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.manual_source_allowances
   WHERE client_id = p_client_id AND period_month = p_period AND scope = p_scope
     AND revoked_at IS NULL AND used_at IS NULL
   FOR UPDATE;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No manual entry is allowed for this client and month. Pull it from the portal, or ask the superadmin to allow a manual entry.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('app.manual_source', 'on', true);
  UPDATE public.manual_source_allowances SET used_by = p_actor_id, used_at = now() WHERE id = v_id;
  PERFORM set_config('app.manual_source', '', true);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.manual_source_use(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manual_source_use(uuid, uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manual_source_allow(uuid, uuid, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manual_source_revoke(uuid, uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Reco columns, helpers and the change log
-- ---------------------------------------------------------------------------
ALTER TABLE public.suspended_reco
  ADD COLUMN IF NOT EXISTS opening_allowance_id uuid REFERENCES public.manual_source_allowances(id);
ALTER TABLE public.gst_receivable_reco
  ADD COLUMN IF NOT EXISTS opening_allowance_id uuid REFERENCES public.manual_source_allowances(id);
-- The gate result the extension (or the page) checked before a GSTR-3B push.
ALTER TABLE public.gstr3b_push_versions ADD COLUMN IF NOT EXISTS gate jsonb;

-- 'MM/YYYY' -> YYYYMM, or NULL for anything else.
CREATE OR REPLACE FUNCTION public.reco_period_key(p_period text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_period ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'
    THEN substr(p_period, 4, 4)::int * 100 + substr(p_period, 1, 2)::int END
$$;

CREATE OR REPLACE FUNCTION public.reco_prev_period(p_period text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_period ~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN
    CASE WHEN substr(p_period, 1, 2) = '01' THEN '12/' || (substr(p_period, 4, 4)::int - 1)::text
         ELSE lpad((substr(p_period, 1, 2)::int - 1)::text, 2, '0') || '/' || substr(p_period, 4, 4) END END
$$;

-- 'MM/YYYY' -> 'Mon-YY' (gstr1_data / rcm_data month keys) and 'Mon YYYY'.
CREATE OR REPLACE FUNCTION public.reco_short_month(p_period text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[substr(p_period, 1, 2)::int]
    || '-' || substr(p_period, 6, 2)
$$;
CREATE OR REPLACE FUNCTION public.reco_month_label(p_period text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_period ~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN
    (ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[substr(p_period, 1, 2)::int]
    || ' ' || substr(p_period, 4, 4) ELSE coalesce(p_period, '') END
$$;

-- bills_not_in_2b.reversal_month / reclaim_month are free text ("Jun-26",
-- "June 2026", "06/2026"): the pages' monthMatches (month name and a year
-- digit anywhere in the text).
CREATE OR REPLACE FUNCTION public.reco_month_matches(p_stored text, p_period text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  WITH s AS (SELECT lower(regexp_replace(coalesce(p_stored, ''), '^\s+|\s+$', '', 'g')) AS t)
  SELECT CASE WHEN p_stored IS NULL OR p_stored = '' THEN false ELSE
    position((ARRAY['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'])[substr(p_period, 1, 2)::int] IN s.t) > 0
    AND (position(right(p_period, 2) IN s.t) > 0 OR position(right(p_period, 1) IN s.t) > 0 OR position(right(p_period, 4) IN s.t) > 0)
  END FROM s
$$;

-- JavaScript's Number(v) || 0 for an ITC Summary figure.
CREATE OR REPLACE FUNCTION public.reco_num(v jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  t text;
BEGIN
  IF v IS NULL THEN RETURN 0; END IF;
  CASE jsonb_typeof(v)
    WHEN 'number' THEN RETURN (v #>> '{}')::numeric;
    WHEN 'boolean' THEN RETURN CASE WHEN v = 'true'::jsonb THEN 1 ELSE 0 END;
    WHEN 'string' THEN
      t := regexp_replace(v #>> '{}', '^\s+|\s+$', '', 'g');
      IF t ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$' THEN RETURN t::numeric; END IF;
      RETURN 0;
    ELSE RETURN 0;
  END CASE;
END;
$$;

-- JavaScript truthiness of a JSON value (isHeader).
CREATE OR REPLACE FUNCTION public.reco_truthy(v jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE jsonb_typeof(v)
    WHEN 'boolean' THEN v = 'true'::jsonb
    WHEN 'number' THEN (v #>> '{}')::numeric <> 0
    WHEN 'string' THEN (v #>> '{}') <> ''
    WHEN 'object' THEN true
    WHEN 'array' THEN true
    ELSE false END
$$;

CREATE OR REPLACE FUNCTION public.reco_arr(v jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$ SELECT CASE WHEN jsonb_typeof(v) = 'array' THEN v ELSE '[]'::jsonb END $$;

-- Math.round(x * 100) / 100, and the ₹10 tolerance.
CREATE OR REPLACE FUNCTION public.reco_round2(x numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$ SELECT floor(x * 100 + 0.5) / 100 $$;
CREATE OR REPLACE FUNCTION public.reco_tol(x numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$ SELECT CASE WHEN abs(x) <= 10 THEN 0 ELSE x END $$;

-- Every change of a reco's portal side, one row each. Read by the reco
-- pages; written only by the trigger below (SELECT policy only).
CREATE TABLE IF NOT EXISTS public.reco_opening_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reco text NOT NULL CHECK (reco IN ('suspended', 'receivable')),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  action text NOT NULL,
  source text,
  actor_id uuid,
  reason text,
  allowance_id uuid,
  before jsonb,
  after jsonb,
  logged_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reco_opening_log_client_idx ON public.reco_opening_log (client_id, period_month, logged_at DESC);
ALTER TABLE public.reco_opening_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reco_opening_log_read ON public.reco_opening_log;
CREATE POLICY reco_opening_log_read ON public.reco_opening_log FOR SELECT TO public USING (true);
GRANT SELECT ON public.reco_opening_log TO anon, authenticated;

-- The columns that make up a reco's portal side.
CREATE OR REPLACE FUNCTION public.reco_portal_side(p_reco text, r jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN r IS NULL THEN NULL ELSE
    jsonb_build_object(
      'opening_cgst', r->'opening_cgst', 'opening_sgst', r->'opening_sgst', 'opening_igst', r->'opening_igst',
      'opening_source', r->'opening_source',
      'opening_csv_period_month', r->'opening_csv_period_month',
      'opening_csv_uploaded_at', r->'opening_csv_uploaded_at', 'opening_csv_uploaded_by', r->'opening_csv_uploaded_by',
      'opening_portal_pulled_at', r->'opening_portal_pulled_at', 'opening_portal_pulled_by', r->'opening_portal_pulled_by',
      'opening_allowance_id', r->'opening_allowance_id',
      'opening_override_justification', r->'opening_override_justification',
      'opening_override_at', r->'opening_override_at', 'opening_override_by', r->'opening_override_by')
    || CASE WHEN p_reco = 'receivable' THEN jsonb_build_object(
      'utilized_cgst', r->'utilized_cgst', 'utilized_sgst', r->'utilized_sgst', 'utilized_igst', r->'utilized_igst',
      'drc_cgst', r->'drc_cgst', 'drc_sgst', r->'drc_sgst', 'drc_igst', r->'drc_igst') ELSE '{}'::jsonb END
  END
$$;

CREATE OR REPLACE FUNCTION public.reco_opening_log_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reco text := CASE WHEN TG_TABLE_NAME = 'gst_receivable_reco' THEN 'receivable' ELSE 'suspended' END;
  v_mode text := coalesce(current_setting('app.reco_write', true), '');
  v_old jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN public.reco_portal_side(v_reco, to_jsonb(OLD)) END;
  v_new jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN public.reco_portal_side(v_reco, to_jsonb(NEW)) END;
  v_row jsonb := to_jsonb(COALESCE(NEW, OLD));
  v_action text;
  v_actor uuid;
  v_reason text;
  v_allowance uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND v_old IS NOT DISTINCT FROM v_new THEN
    RETURN NULL;
  END IF;
  v_allowance := NULLIF(v_row->>'opening_allowance_id', '')::uuid;
  IF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_actor := NULLIF(v_row->>'updated_by', '')::uuid;
  ELSIF v_mode = 'pull' THEN
    v_action := 'pull';
    v_actor := NULLIF(v_row->>'opening_portal_pulled_by', '')::uuid;
  ELSIF v_mode = 'manual' THEN
    v_action := 'manual';
    v_actor := NULLIF(v_row->>'updated_by', '')::uuid;
    SELECT reason INTO v_reason FROM public.manual_source_allowances WHERE id = v_allowance;
  ELSIF NEW.opening_override_justification IS NOT NULL
        AND (TG_OP = 'INSERT' OR (v_new->'opening_override_at') IS DISTINCT FROM (v_old->'opening_override_at')
             OR (v_new->'opening_override_by') IS DISTINCT FROM (v_old->'opening_override_by')
             OR (v_new->'opening_override_justification') IS DISTINCT FROM (v_old->'opening_override_justification')) THEN
    v_action := 'override';
    v_actor := NEW.opening_override_by;
    v_reason := NEW.opening_override_justification;
  ELSE
    v_action := CASE WHEN TG_OP = 'INSERT' THEN 'insert' ELSE 'save' END;
    v_actor := NULLIF(v_row->>'updated_by', '')::uuid;
  END IF;
  INSERT INTO public.reco_opening_log (reco, client_id, period_month, action, source, actor_id, reason, allowance_id, before, after)
  VALUES (v_reco, (v_row->>'client_id')::uuid, v_row->>'period_month', v_action, v_row->>'opening_source',
          v_actor, v_reason, v_allowance, v_old, v_new);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_suspended_reco_opening_log ON public.suspended_reco;
CREATE TRIGGER trg_suspended_reco_opening_log
  AFTER INSERT OR UPDATE OR DELETE ON public.suspended_reco
  FOR EACH ROW EXECUTE FUNCTION public.reco_opening_log_write();
DROP TRIGGER IF EXISTS trg_gst_receivable_reco_opening_log ON public.gst_receivable_reco;
CREATE TRIGGER trg_gst_receivable_reco_opening_log
  AFTER INSERT OR UPDATE OR DELETE ON public.gst_receivable_reco
  FOR EACH ROW EXECUTE FUNCTION public.reco_opening_log_write();

-- ---------------------------------------------------------------------------
-- 3. The guard: from 06/2026 the portal side changes only by pull, manual
--    entry (with an allowance) or an override
-- ---------------------------------------------------------------------------
-- reco_record_pull and reco_manual_opening open it for their own write
-- (app.reco_write = 'pull' / 'manual'). Otherwise a new row carries no
-- portal-side figures (an override's opening aside), and an update leaves
-- them as they are, except the opening figures of a new override (who may
-- override is opening_override_guard's to say). An override is never removed
-- by hand. Deleting a row (Clear Data) is allowed: the gate then reads it as
-- not pulled. Rows before 06/2026 keep today's behaviour.
CREATE OR REPLACE FUNCTION public.reco_source_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reco text := CASE WHEN TG_TABLE_NAME = 'gst_receivable_reco' THEN 'receivable' ELSE 'suspended' END;
  v_key integer := public.reco_period_key(NEW.period_month);
  v_new jsonb;
  v_old jsonb;
  v_exists boolean;
  v_new_override boolean;
  k text;
  v_stamps text[] := ARRAY['opening_source', 'opening_csv_period_month', 'opening_csv_uploaded_at', 'opening_csv_uploaded_by',
                           'opening_portal_pulled_at', 'opening_portal_pulled_by', 'opening_allowance_id'];
  v_figures text[] := CASE WHEN TG_TABLE_NAME = 'gst_receivable_reco'
    THEN ARRAY['utilized_cgst', 'utilized_sgst', 'utilized_igst', 'drc_cgst', 'drc_sgst', 'drc_igst'] ELSE ARRAY[]::text[] END;
  v_msg text := 'From Jun 2026 the opening balance comes only from the portal pull. '
    || 'Pull it with the browser extension, or ask the superadmin to allow a manual entry for this month.';
BEGIN
  IF coalesce(current_setting('app.reco_write', true), '') IN ('pull', 'manual') THEN
    RETURN NEW;
  END IF;
  IF v_key IS NOT NULL AND v_key < 202606 THEN
    RETURN NEW;
  END IF;
  v_new := to_jsonb(NEW);
  IF TG_OP = 'INSERT' THEN
    -- An upsert of an existing row fires this first; its UPDATE half decides.
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE client_id = $1 AND period_month = $2)', TG_TABLE_NAME)
      INTO v_exists USING NEW.client_id, NEW.period_month;
    IF v_exists THEN
      RETURN NEW;
    END IF;
    IF NEW.opening_source IS DISTINCT FROM 'manual'
       OR NEW.opening_csv_period_month IS NOT NULL OR NEW.opening_csv_uploaded_at IS NOT NULL
       OR NEW.opening_csv_uploaded_by IS NOT NULL OR NEW.opening_portal_pulled_at IS NOT NULL
       OR NEW.opening_portal_pulled_by IS NOT NULL OR NEW.opening_allowance_id IS NOT NULL
       OR (NEW.opening_override_justification IS NULL
           AND (coalesce(NEW.opening_cgst, 0) <> 0 OR coalesce(NEW.opening_sgst, 0) <> 0 OR coalesce(NEW.opening_igst, 0) <> 0)) THEN
      RAISE EXCEPTION '%', v_msg USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_reco = 'receivable' AND (v_new->'utilized_cgst' <> 'null'::jsonb OR v_new->'utilized_sgst' <> 'null'::jsonb
       OR v_new->'utilized_igst' <> 'null'::jsonb OR public.reco_num(v_new->'drc_cgst') <> 0
       OR public.reco_num(v_new->'drc_sgst') <> 0 OR public.reco_num(v_new->'drc_igst') <> 0) THEN
      RAISE EXCEPTION '%', v_msg USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  v_old := to_jsonb(OLD);
  FOREACH k IN ARRAY v_stamps || v_figures LOOP
    IF (v_new->k) IS DISTINCT FROM (v_old->k) THEN
      RAISE EXCEPTION '%', v_msg USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  IF OLD.opening_override_justification IS NOT NULL AND NEW.opening_override_justification IS NULL THEN
    RAISE EXCEPTION 'An override is cleared only by a new pull or an allowed manual entry.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_new_override := NEW.opening_override_justification IS NOT NULL
    AND (NEW.opening_override_justification IS DISTINCT FROM OLD.opening_override_justification
         OR NEW.opening_override_at IS DISTINCT FROM OLD.opening_override_at
         OR NEW.opening_override_by IS DISTINCT FROM OLD.opening_override_by);
  IF NOT v_new_override
     AND (NEW.opening_cgst IS DISTINCT FROM OLD.opening_cgst OR NEW.opening_sgst IS DISTINCT FROM OLD.opening_sgst
          OR NEW.opening_igst IS DISTINCT FROM OLD.opening_igst) THEN
    RAISE EXCEPTION '%', v_msg USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_suspended_reco_source_guard ON public.suspended_reco;
CREATE TRIGGER trg_suspended_reco_source_guard
  BEFORE INSERT OR UPDATE ON public.suspended_reco
  FOR EACH ROW EXECUTE FUNCTION public.reco_source_guard();
DROP TRIGGER IF EXISTS trg_gst_receivable_reco_source_guard ON public.gst_receivable_reco;
CREATE TRIGGER trg_gst_receivable_reco_source_guard
  BEFORE INSERT OR UPDATE ON public.gst_receivable_reco
  FOR EACH ROW EXECUTE FUNCTION public.reco_source_guard();

-- ---------------------------------------------------------------------------
-- 4. The override: superadmin and GST Managers, with a reason
-- ---------------------------------------------------------------------------
-- Same rule as 20261020150000 otherwise: a save that carries an override
-- unchanged is not a new override. A new one needs the superadmin or a GST
-- Manager (opening_override_by, as the app sends it) and a reason of at
-- least 5 characters; its time is the database's.
CREATE OR REPLACE FUNCTION public.opening_override_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF NEW.opening_override_justification IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- An upsert of an existing row fires this first; its UPDATE half decides.
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE client_id = $1 AND period_month = $2)', TG_TABLE_NAME)
      INTO v_exists USING NEW.client_id, NEW.period_month;
    IF v_exists THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.opening_override_justification IS NOT DISTINCT FROM OLD.opening_override_justification
    AND NEW.opening_override_at IS NOT DISTINCT FROM OLD.opening_override_at
    AND NEW.opening_override_by IS NOT DISTINCT FROM OLD.opening_override_by THEN
    RETURN NEW;
  END IF;
  IF coalesce(public.staff_level_of(NEW.opening_override_by), '') NOT IN ('superadmin', 'gst_manager') THEN
    RAISE EXCEPTION 'Only the superadmin or a GST Manager can override an opening balance.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(btrim(NEW.opening_override_justification)) < 5 THEN
    RAISE EXCEPTION 'Give a reason for the override (at least 5 characters).'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.opening_override_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_suspended_reco_opening_override ON public.suspended_reco;
CREATE TRIGGER trg_suspended_reco_opening_override
  BEFORE INSERT OR UPDATE ON public.suspended_reco
  FOR EACH ROW EXECUTE FUNCTION public.opening_override_guard();
DROP TRIGGER IF EXISTS trg_gst_receivable_reco_opening_override ON public.gst_receivable_reco;
CREATE TRIGGER trg_gst_receivable_reco_opening_override
  BEFORE INSERT OR UPDATE ON public.gst_receivable_reco
  FOR EACH ROW EXECUTE FUNCTION public.opening_override_guard();

-- ---------------------------------------------------------------------------
-- 5. The pull and the allowed manual entry
-- ---------------------------------------------------------------------------
-- {"igst": n, "cgst": n, "sgst": n} -> the head, or NULL for a NULL object.
CREATE OR REPLACE FUNCTION public.reco_head(p jsonb, p_head text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p IS NULL OR p = 'null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(p) <> 'object' OR jsonb_typeof(p->p_head) IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'The figure for % is not a number.', upper(p_head) USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN (p->>p_head)::numeric;
END;
$$;

-- The extension's pull (0.16.0): credit ledger -> GST Receivable Reco
-- (opening, ITC utilised, DRC-03), reversal ledger -> Suspended Reco
-- (opening). p_actor_id is the app user who asked for it (kept only when
-- staff; NULL for the popup's full sync). Clears the CSV stamps, any
-- override and allowance: the portal's figure replaces them.
CREATE OR REPLACE FUNCTION public.reco_record_pull(
  p_actor_id uuid, p_reco text, p_client_id uuid, p_period text,
  p_opening jsonb, p_utilised jsonb DEFAULT NULL, p_drc jsonb DEFAULT NULL, p_ext_version text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := CASE WHEN p_actor_id IS NOT NULL AND public.staff_level_of(p_actor_id) IS NOT NULL THEN p_actor_id END;
  v_now timestamptz := now();
  v_id uuid;
BEGIN
  IF p_reco IS NULL OR p_reco NOT IN ('suspended', 'receivable') THEN
    RAISE EXCEPTION 'Unknown reco "%".', p_reco USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_period IS NULL OR p_period !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN
    RAISE EXCEPTION 'The month must be MM/YYYY.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'No such client.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_opening IS NULL OR jsonb_typeof(p_opening) <> 'object' THEN
    RAISE EXCEPTION 'The pull sent no opening balance.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('app.reco_write', 'pull', true);
  IF p_reco = 'suspended' THEN
    INSERT INTO public.suspended_reco AS r (client_id, period_month, opening_igst, opening_cgst, opening_sgst,
      opening_source, opening_portal_pulled_at, opening_portal_pulled_by,
      opening_csv_period_month, opening_csv_uploaded_at, opening_csv_uploaded_by,
      opening_override_justification, opening_override_at, opening_override_by, opening_allowance_id,
      updated_by, updated_at)
    VALUES (p_client_id, p_period, public.reco_head(p_opening, 'igst'), public.reco_head(p_opening, 'cgst'),
      public.reco_head(p_opening, 'sgst'), 'portal', v_now, v_actor, NULL, NULL, NULL, NULL, NULL, NULL, NULL, v_actor, v_now)
    ON CONFLICT (client_id, period_month) DO UPDATE SET
      opening_igst = EXCLUDED.opening_igst, opening_cgst = EXCLUDED.opening_cgst, opening_sgst = EXCLUDED.opening_sgst,
      opening_source = 'portal', opening_portal_pulled_at = v_now, opening_portal_pulled_by = v_actor,
      opening_csv_period_month = NULL, opening_csv_uploaded_at = NULL, opening_csv_uploaded_by = NULL,
      opening_override_justification = NULL, opening_override_at = NULL, opening_override_by = NULL,
      opening_allowance_id = NULL, updated_by = COALESCE(v_actor, r.updated_by), updated_at = v_now
    RETURNING r.id INTO v_id;
  ELSE
    INSERT INTO public.gst_receivable_reco AS r (client_id, period_month, opening_igst, opening_cgst, opening_sgst,
      opening_source, opening_portal_pulled_at, opening_portal_pulled_by,
      opening_csv_period_month, opening_csv_uploaded_at, opening_csv_uploaded_by,
      opening_override_justification, opening_override_at, opening_override_by, opening_allowance_id,
      utilized_igst, utilized_cgst, utilized_sgst, drc_igst, drc_cgst, drc_sgst, updated_by, updated_at)
    VALUES (p_client_id, p_period, public.reco_head(p_opening, 'igst'), public.reco_head(p_opening, 'cgst'),
      public.reco_head(p_opening, 'sgst'), 'portal', v_now, v_actor, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      public.reco_head(p_utilised, 'igst'), public.reco_head(p_utilised, 'cgst'), public.reco_head(p_utilised, 'sgst'),
      coalesce(public.reco_head(p_drc, 'igst'), 0), coalesce(public.reco_head(p_drc, 'cgst'), 0),
      coalesce(public.reco_head(p_drc, 'sgst'), 0), v_actor, v_now)
    ON CONFLICT (client_id, period_month) DO UPDATE SET
      opening_igst = EXCLUDED.opening_igst, opening_cgst = EXCLUDED.opening_cgst, opening_sgst = EXCLUDED.opening_sgst,
      opening_source = 'portal', opening_portal_pulled_at = v_now, opening_portal_pulled_by = v_actor,
      opening_csv_period_month = NULL, opening_csv_uploaded_at = NULL, opening_csv_uploaded_by = NULL,
      opening_override_justification = NULL, opening_override_at = NULL, opening_override_by = NULL,
      opening_allowance_id = NULL,
      utilized_igst = EXCLUDED.utilized_igst, utilized_cgst = EXCLUDED.utilized_cgst, utilized_sgst = EXCLUDED.utilized_sgst,
      drc_igst = EXCLUDED.drc_igst, drc_cgst = EXCLUDED.drc_cgst, drc_sgst = EXCLUDED.drc_sgst,
      updated_by = COALESCE(v_actor, r.updated_by), updated_at = v_now
    RETURNING r.id INTO v_id;
  END IF;
  PERFORM set_config('app.reco_write', '', true);
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'reco', p_reco, 'pulled_at', v_now, 'pulled_by', v_actor,
    'ext_version', p_ext_version);
END;
$$;

-- An allowed manual entry: the credit-ledger / reversal CSV upload
-- (p_source 'csv') or Not Applicable (zeros). Uses the client's live,
-- unused allowance for 'reco:<p_reco>' and that month, once; refused without.
CREATE OR REPLACE FUNCTION public.reco_manual_opening(
  p_actor_id uuid, p_reco text, p_client_id uuid, p_period text, p_source text,
  p_opening jsonb, p_utilised jsonb DEFAULT NULL, p_drc jsonb DEFAULT NULL, p_csv_period text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_allowance uuid;
  v_na boolean := p_source = 'not_applicable';
  v_open jsonb := CASE WHEN p_source = 'not_applicable' THEN '{"igst":0,"cgst":0,"sgst":0}'::jsonb ELSE p_opening END;
  v_id uuid;
BEGIN
  IF p_actor_id IS NULL OR public.staff_level_of(p_actor_id) IS NULL THEN
    RAISE EXCEPTION 'Only staff can enter an opening balance.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reco IS NULL OR p_reco NOT IN ('suspended', 'receivable') THEN
    RAISE EXCEPTION 'Unknown reco "%".', p_reco USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('csv', 'not_applicable') THEN
    RAISE EXCEPTION 'Unknown source "%".', p_source USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_period IS NULL OR p_period !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN
    RAISE EXCEPTION 'The month must be MM/YYYY.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_open IS NULL OR jsonb_typeof(v_open) <> 'object' THEN
    RAISE EXCEPTION 'No opening balance was sent.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_allowance := public.manual_source_use(p_actor_id, p_client_id, p_period, 'reco:' || p_reco);
  PERFORM set_config('app.reco_write', 'manual', true);
  IF p_reco = 'suspended' THEN
    INSERT INTO public.suspended_reco AS r (client_id, period_month, opening_igst, opening_cgst, opening_sgst,
      opening_source, opening_portal_pulled_at, opening_portal_pulled_by,
      opening_csv_period_month, opening_csv_uploaded_at, opening_csv_uploaded_by,
      opening_override_justification, opening_override_at, opening_override_by, opening_allowance_id,
      updated_by, updated_at)
    VALUES (p_client_id, p_period, public.reco_head(v_open, 'igst'), public.reco_head(v_open, 'cgst'),
      public.reco_head(v_open, 'sgst'), p_source, NULL, NULL,
      CASE WHEN v_na THEN NULL ELSE p_csv_period END, CASE WHEN v_na THEN NULL ELSE v_now END,
      CASE WHEN v_na THEN NULL ELSE p_actor_id END, NULL, NULL, NULL, v_allowance, p_actor_id, v_now)
    ON CONFLICT (client_id, period_month) DO UPDATE SET
      opening_igst = EXCLUDED.opening_igst, opening_cgst = EXCLUDED.opening_cgst, opening_sgst = EXCLUDED.opening_sgst,
      opening_source = EXCLUDED.opening_source, opening_portal_pulled_at = NULL, opening_portal_pulled_by = NULL,
      opening_csv_period_month = EXCLUDED.opening_csv_period_month, opening_csv_uploaded_at = EXCLUDED.opening_csv_uploaded_at,
      opening_csv_uploaded_by = EXCLUDED.opening_csv_uploaded_by,
      opening_override_justification = NULL, opening_override_at = NULL, opening_override_by = NULL,
      opening_allowance_id = EXCLUDED.opening_allowance_id, updated_by = p_actor_id, updated_at = v_now
    RETURNING r.id INTO v_id;
  ELSE
    INSERT INTO public.gst_receivable_reco AS r (client_id, period_month, opening_igst, opening_cgst, opening_sgst,
      opening_source, opening_portal_pulled_at, opening_portal_pulled_by,
      opening_csv_period_month, opening_csv_uploaded_at, opening_csv_uploaded_by,
      opening_override_justification, opening_override_at, opening_override_by, opening_allowance_id,
      utilized_igst, utilized_cgst, utilized_sgst, drc_igst, drc_cgst, drc_sgst, updated_by, updated_at)
    VALUES (p_client_id, p_period, public.reco_head(v_open, 'igst'), public.reco_head(v_open, 'cgst'),
      public.reco_head(v_open, 'sgst'), p_source, NULL, NULL,
      CASE WHEN v_na THEN NULL ELSE p_csv_period END, CASE WHEN v_na THEN NULL ELSE v_now END,
      CASE WHEN v_na THEN NULL ELSE p_actor_id END, NULL, NULL, NULL, v_allowance,
      CASE WHEN v_na THEN NULL ELSE public.reco_head(p_utilised, 'igst') END,
      CASE WHEN v_na THEN NULL ELSE public.reco_head(p_utilised, 'cgst') END,
      CASE WHEN v_na THEN NULL ELSE public.reco_head(p_utilised, 'sgst') END,
      CASE WHEN v_na THEN 0 ELSE coalesce(public.reco_head(p_drc, 'igst'), 0) END,
      CASE WHEN v_na THEN 0 ELSE coalesce(public.reco_head(p_drc, 'cgst'), 0) END,
      CASE WHEN v_na THEN 0 ELSE coalesce(public.reco_head(p_drc, 'sgst'), 0) END,
      p_actor_id, v_now)
    ON CONFLICT (client_id, period_month) DO UPDATE SET
      opening_igst = EXCLUDED.opening_igst, opening_cgst = EXCLUDED.opening_cgst, opening_sgst = EXCLUDED.opening_sgst,
      opening_source = EXCLUDED.opening_source, opening_portal_pulled_at = NULL, opening_portal_pulled_by = NULL,
      opening_csv_period_month = EXCLUDED.opening_csv_period_month, opening_csv_uploaded_at = EXCLUDED.opening_csv_uploaded_at,
      opening_csv_uploaded_by = EXCLUDED.opening_csv_uploaded_by,
      opening_override_justification = NULL, opening_override_at = NULL, opening_override_by = NULL,
      opening_allowance_id = EXCLUDED.opening_allowance_id,
      utilized_igst = EXCLUDED.utilized_igst, utilized_cgst = EXCLUDED.utilized_cgst, utilized_sgst = EXCLUDED.utilized_sgst,
      drc_igst = EXCLUDED.drc_igst, drc_cgst = EXCLUDED.drc_cgst, drc_sgst = EXCLUDED.drc_sgst,
      updated_by = p_actor_id, updated_at = v_now
    RETURNING r.id INTO v_id;
  END IF;
  PERFORM set_config('app.reco_write', '', true);
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'reco', p_reco, 'source', p_source, 'allowance_id', v_allowance);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reco_record_pull(uuid, text, uuid, text, jsonb, jsonb, jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reco_manual_opening(uuid, text, uuid, text, text, jsonb, jsonb, jsonb, text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The differences (ports of the app's calculations) and the gate
-- ---------------------------------------------------------------------------
-- The first element of an ITC Summary section whose srNo is exactly p_sr
-- (a string, as the pages' === compares it).
CREATE OR REPLACE FUNCTION public.reco_find_sr(p_rows jsonb, p_sr text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT e FROM jsonb_array_elements(public.reco_arr(p_rows)) WITH ORDINALITY AS t(e, i)
   WHERE jsonb_typeof(e->'srNo') = 'string' AND e->>'srNo' = p_sr
   ORDER BY i LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.reco_find_particular(p_rows jsonb, p_text text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT e FROM jsonb_array_elements(public.reco_arr(p_rows)) WITH ORDINALITY AS t(e, i)
   WHERE jsonb_typeof(e->'particular') = 'string' AND position(p_text IN e->>'particular') > 0
   ORDER BY i LIMIT 1
$$;

-- Suspended Reco: opening + (4B(2)(i) + 4B(2)(ii)) - (5.4 + 5.5 + 4(D) 1.2)
-- - books, per head; from 06/2026 a head of ₹10 or less reads 0. Mirrors
-- src/lib/suspendedRecoCalc.ts. A missing row is an opening of 0.
CREATE OR REPLACE FUNCTION public.suspended_reco_difference(p_client_id uuid, p_period text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key integer := public.reco_period_key(p_period);
  v_new boolean;
  o_c numeric := 0; o_s numeric := 0; o_i numeric := 0;
  rv_c numeric; rv_s numeric; rv_i numeric;
  rn_c numeric; rn_s numeric; rn_i numeric;
  rx_c numeric; rx_s numeric; rx_i numeric;
  b_c numeric; b_s numeric; b_i numeric;
  v_itc jsonb;
  f4b jsonb; f55 jsonb; f4d jsonb;
  ii_c numeric := 0; ii_s numeric := 0; ii_i numeric := 0;
  r55_c numeric := 0; r55_s numeric := 0; r55_i numeric := 0;
  d_c numeric := 0; d_s numeric := 0; d_i numeric := 0;
  p_c numeric; p_s numeric; p_i numeric;
  x_c numeric; x_s numeric; x_i numeric;
  v_row boolean;
BEGIN
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'The month must be MM/YYYY.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_new := v_key >= 202606;
  SELECT coalesce(opening_cgst, 0), coalesce(opening_sgst, 0), coalesce(opening_igst, 0), true
    INTO o_c, o_s, o_i, v_row
    FROM public.suspended_reco WHERE client_id = p_client_id AND period_month = p_period;
  o_c := coalesce(o_c, 0); o_s := coalesce(o_s, 0); o_i := coalesce(o_i, 0);

  SELECT coalesce(sum(input_cgst), 0), coalesce(sum(input_sgst), 0), coalesce(sum(input_igst), 0)
    INTO rv_c, rv_s, rv_i
    FROM public.bills_not_in_2b
   WHERE client_id = p_client_id AND period_month = p_period AND reversal_month IS NOT NULL
     AND public.reco_month_matches(reversal_month, p_period);

  SELECT coalesce(sum(input_cgst) FILTER (WHERE reclaim_subtype IS DISTINCT FROM 'EXPENSE_OUT'), 0),
         coalesce(sum(input_sgst) FILTER (WHERE reclaim_subtype IS DISTINCT FROM 'EXPENSE_OUT'), 0),
         coalesce(sum(input_igst) FILTER (WHERE reclaim_subtype IS DISTINCT FROM 'EXPENSE_OUT'), 0),
         coalesce(sum(input_cgst) FILTER (WHERE reclaim_subtype = 'EXPENSE_OUT'), 0),
         coalesce(sum(input_sgst) FILTER (WHERE reclaim_subtype = 'EXPENSE_OUT'), 0),
         coalesce(sum(input_igst) FILTER (WHERE reclaim_subtype = 'EXPENSE_OUT'), 0)
    INTO rn_c, rn_s, rn_i, rx_c, rx_s, rx_i
    FROM public.bills_not_in_2b
   WHERE client_id = p_client_id AND period_month = p_period AND reclaim_month IS NOT NULL
     AND public.reco_month_matches(reclaim_month, p_period);

  SELECT data INTO v_itc FROM public.itc_summaries WHERE client_id = p_client_id AND period_month = p_period;
  IF public.reco_truthy(v_itc) THEN
    SELECT e INTO f4b FROM jsonb_array_elements(public.reco_arr(v_itc->'section4B')) WITH ORDINALITY AS t(e, i)
     WHERE (jsonb_typeof(e->'srNo') = 'string' AND e->>'srNo' IN ('(ii)', '4(B)(2)(ii)'))
        OR (jsonb_typeof(e->'particular') = 'string' AND position('ITC Reversal for previous months' IN e->>'particular') > 0)
     ORDER BY i LIMIT 1;
    IF f4b IS NOT NULL THEN
      ii_c := public.reco_num(f4b->'cgst'); ii_s := public.reco_num(f4b->'sgst'); ii_i := public.reco_num(f4b->'igst');
    END IF;
    f55 := public.reco_find_sr(v_itc->'section4A', '5.5');
    IF f55 IS NOT NULL THEN
      r55_c := public.reco_num(f55->'cgst'); r55_s := public.reco_num(f55->'sgst'); r55_i := public.reco_num(f55->'igst');
    END IF;
    f4d := public.reco_find_sr(v_itc->'section4D', '1.2');
    d_c := public.reco_num(f4d->'cgst'); d_s := public.reco_num(f4d->'sgst'); d_i := public.reco_num(f4d->'igst');
  END IF;

  p_c := rv_c + ii_c - rn_c - r55_c - greatest(rx_c, d_c);
  p_s := rv_s + ii_s - rn_s - r55_s - greatest(rx_s, d_s);
  p_i := rv_i + ii_i - rn_i - r55_i - greatest(rx_i, d_i);

  SELECT coalesce(sum(input_cgst), 0), coalesce(sum(input_sgst), 0), coalesce(sum(input_igst), 0)
    INTO b_c, b_s, b_i
    FROM public.bills_not_in_2b
   WHERE client_id = p_client_id AND period_month = p_period
     AND coalesce(reclaim_month, '') = '' AND coalesce(reversal_month, '') <> '';

  x_c := public.reco_round2(o_c + p_c - b_c);
  x_s := public.reco_round2(o_s + p_s - b_s);
  x_i := public.reco_round2(o_i + p_i - b_i);
  IF v_new THEN
    x_c := public.reco_tol(x_c); x_s := public.reco_tol(x_s); x_i := public.reco_tol(x_i);
  END IF;
  RETURN jsonb_build_object(
    'row', coalesce(v_row, false),
    'opening', jsonb_build_object('cgst', o_c, 'sgst', o_s, 'igst', o_i),
    'portal', jsonb_build_object('cgst', p_c, 'sgst', p_s, 'igst', p_i),
    'books', jsonb_build_object('cgst', b_c, 'sgst', b_s, 'igst', b_i),
    'cgst', x_c, 'sgst', x_s, 'igst', x_i,
    'total', public.reco_round2(x_c + x_s + x_i));
END;
$$;

-- GST Receivable Reco (06/2026 on; NULL before): opening + Net ITC available
-- (M-1's 4C, once M-1's GSTR-3B is Filed) - ITC utilised - DRC-03 (closing
-- at 0 or more) - books closing; ₹10 tolerance per head and on the total.
-- Mirrors src/lib/gstReceivableRecoCalc.ts for a pulled (or allowed) row:
-- ITC utilised is the credit ledger's, NULL read as 0.
CREATE OR REPLACE FUNCTION public.gst_receivable_reco_difference(p_client_id uuid, p_period text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key integer := public.reco_period_key(p_period);
  v_prev text := public.reco_prev_period(p_period);
  r record;
  v_row boolean := false;
  o_c numeric := 0; o_s numeric := 0; o_i numeric := 0;
  bk_c numeric := 0; bk_s numeric := 0; bk_i numeric := 0;
  dr_c numeric := 0; dr_s numeric := 0; dr_i numeric := 0;
  u_c numeric := 0; u_s numeric := 0; u_i numeric := 0;
  av_c numeric := 0; av_s numeric := 0; av_i numeric := 0;
  v_itc jsonb;
  v_filed boolean;
  rcm_c numeric; rcm_s numeric; rcm_i numeric;
  lr_c numeric; lr_s numeric; lr_i numeric;
  lc_c numeric; lc_s numeric; lc_i numeric;
  rows_a jsonb; rows_b jsonb;
  a51 jsonb; a52 jsonb; a53 jsonb; a55 jsonb;
  t5_c numeric; t5_s numeric; t5_i numeric;
  r14_c numeric := 0; r14_s numeric := 0; r14_i numeric := 0;
  t4a_c numeric; t4a_s numeric; t4a_i numeric;
  t4b_c numeric := 0; t4b_s numeric := 0; t4b_i numeric := 0;
  e jsonb;
  n integer := 0;
  v_type text; v_comm numeric; v_res numeric;
  v_noitc boolean; v_partial boolean; v_ratio numeric;
  adj jsonb; prevrev jsonb;
  ii_c numeric; ii_s numeric; ii_i numeric;
  r2_c numeric; r2_s numeric; r2_i numeric;
  i_c numeric; i_s numeric; i_i numeric;
  iii_c numeric; iii_s numeric; iii_i numeric;
  r1_c numeric; r1_s numeric; r1_i numeric;
  cl_c numeric; cl_s numeric; cl_i numeric;
BEGIN
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'The month must be MM/YYYY.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_key < 202606 THEN
    RETURN NULL;
  END IF;
  SELECT * INTO r FROM public.gst_receivable_reco WHERE client_id = p_client_id AND period_month = p_period;
  IF FOUND THEN
    v_row := true;
    o_c := coalesce(r.opening_cgst, 0); o_s := coalesce(r.opening_sgst, 0); o_i := coalesce(r.opening_igst, 0);
    bk_c := coalesce(r.books_closing_cgst, 0); bk_s := coalesce(r.books_closing_sgst, 0); bk_i := coalesce(r.books_closing_igst, 0);
    dr_c := coalesce(r.drc_cgst, 0); dr_s := coalesce(r.drc_sgst, 0); dr_i := coalesce(r.drc_igst, 0);
    u_c := coalesce(r.utilized_cgst, 0); u_s := coalesce(r.utilized_sgst, 0); u_i := coalesce(r.utilized_igst, 0);
  END IF;

  SELECT data INTO v_itc FROM public.itc_summaries WHERE client_id = p_client_id AND period_month = v_prev;
  SELECT EXISTS (SELECT 1 FROM public.filing_status
                  WHERE client_id = p_client_id AND period_month = v_prev
                    AND return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)') AND status::text = 'Filed')
    INTO v_filed;

  IF public.reco_truthy(v_itc) AND v_filed THEN
    rows_a := public.reco_arr(v_itc->'section4A');
    rows_b := public.reco_arr(v_itc->'section4B');
    SELECT coalesce(sum(coalesce(cgst_2_5, 0) + coalesce(cgst_9, 0)), 0),
           coalesce(sum(coalesce(sgst_2_5, 0) + coalesce(sgst_9, 0)), 0),
           coalesce(sum(coalesce(igst_5, 0) + coalesce(igst_18, 0)), 0)
      INTO rcm_c, rcm_s, rcm_i
      FROM public.rcm_data WHERE client_id = p_client_id AND month = public.reco_short_month(v_prev);
    SELECT coalesce(sum(coalesce(input_cgst, 0)), 0), coalesce(sum(coalesce(input_sgst, 0)), 0), coalesce(sum(coalesce(input_igst, 0)), 0)
      INTO lr_c, lr_s, lr_i
      FROM public.bills_not_in_2b
     WHERE client_id = p_client_id AND period_month = v_prev AND reversal_month IS NOT NULL
       AND public.reco_month_matches(reversal_month, v_prev);
    SELECT coalesce(sum(coalesce(input_cgst, 0)), 0), coalesce(sum(coalesce(input_sgst, 0)), 0), coalesce(sum(coalesce(input_igst, 0)), 0)
      INTO lc_c, lc_s, lc_i
      FROM public.bills_not_in_2b
     WHERE client_id = p_client_id AND period_month = v_prev AND reclaim_month IS NOT NULL
       AND reclaim_subtype IS DISTINCT FROM 'EXPENSE_OUT'
       AND public.reco_month_matches(reclaim_month, v_prev);

    a51 := public.reco_find_sr(rows_a, '5.1'); a52 := public.reco_find_sr(rows_a, '5.2');
    a53 := public.reco_find_sr(rows_a, '5.3'); a55 := public.reco_find_sr(rows_a, '5.5');
    t5_c := public.reco_num(a51->'cgst') + public.reco_num(a52->'cgst') - public.reco_num(a53->'cgst') + lc_c + public.reco_num(a55->'cgst');
    t5_s := public.reco_num(a51->'sgst') + public.reco_num(a52->'sgst') - public.reco_num(a53->'sgst') + lc_s + public.reco_num(a55->'sgst');
    t5_i := public.reco_num(a51->'igst') + public.reco_num(a52->'igst') - public.reco_num(a53->'igst') + lc_i + public.reco_num(a55->'igst');

    -- Rows (1) to (4): the first four elements, row (3) the live RCM ITC.
    FOR e IN SELECT x FROM jsonb_array_elements(rows_a) WITH ORDINALITY AS t(x, i) ORDER BY i LIMIT 4 LOOP
      IF jsonb_typeof(e->'srNo') = 'string' AND e->>'srNo' = '(3)' THEN
        r14_c := r14_c + rcm_c; r14_s := r14_s + rcm_s; r14_i := r14_i + rcm_i;
      ELSE
        r14_c := r14_c + public.reco_num(e->'cgst'); r14_s := r14_s + public.reco_num(e->'sgst'); r14_i := r14_i + public.reco_num(e->'igst');
      END IF;
    END LOOP;
    t4a_c := r14_c + t5_c; t4a_s := r14_s + t5_s; t4a_i := r14_i + t5_i;

    SELECT builder_itc_type, commercial_area, residential_area INTO v_type, v_comm, v_res
      FROM public.clients WHERE id = p_client_id;
    v_noitc := v_type IS NOT DISTINCT FROM 'NO_ITC';
    v_partial := v_type IS NOT DISTINCT FROM 'PARTIAL_ITC' OR v_noitc;
    IF v_partial THEN
      v_comm := CASE WHEN v_noitc THEN 0 ELSE coalesce(v_comm, 0) END;
      v_res := CASE WHEN v_noitc THEN 1 ELSE coalesce(v_res, 0) END;
      v_ratio := CASE WHEN v_comm + v_res > 0 THEN v_res / (v_comm + v_res) ELSE 0 END;
      adj := public.reco_find_particular(rows_b, 'Previous Month Adjustment');
      ii_c := public.reco_num(adj->'cgst'); ii_s := public.reco_num(adj->'sgst'); ii_i := public.reco_num(adj->'igst');
      prevrev := public.reco_find_particular(rows_b, 'previous months, if any');
      r2_c := lr_c + public.reco_num(prevrev->'cgst'); r2_s := lr_s + public.reco_num(prevrev->'sgst'); r2_i := lr_i + public.reco_num(prevrev->'igst');
      i_c := public.reco_round2(t4a_c * v_ratio); i_s := public.reco_round2(t4a_s * v_ratio); i_i := public.reco_round2(t4a_i * v_ratio);
      iii_c := public.reco_round2(-r2_c * v_ratio); iii_s := public.reco_round2(-r2_s * v_ratio); iii_i := public.reco_round2(-r2_i * v_ratio);
      r1_c := public.reco_round2(i_c + ii_c + iii_c); r1_s := public.reco_round2(i_s + ii_s + iii_s); r1_i := public.reco_round2(i_i + ii_i + iii_i);
      t4b_c := r1_c + r2_c; t4b_s := r1_s + r2_s; t4b_i := r1_i + r2_i;
    ELSE
      FOR e IN SELECT x FROM jsonb_array_elements(rows_b) WITH ORDINALITY AS t(x, i) ORDER BY i LOOP
        CONTINUE WHEN public.reco_truthy(e->'isHeader');
        IF jsonb_typeof(e->'particular') = 'string' AND position('current month as per 2B RECO' IN e->>'particular') > 0 THEN
          t4b_c := t4b_c + lr_c; t4b_s := t4b_s + lr_s; t4b_i := t4b_i + lr_i;
        ELSE
          t4b_c := t4b_c + public.reco_num(e->'cgst'); t4b_s := t4b_s + public.reco_num(e->'sgst'); t4b_i := t4b_i + public.reco_num(e->'igst');
        END IF;
      END LOOP;
    END IF;
    av_c := t4a_c - t4b_c; av_s := t4a_s - t4b_s; av_i := t4a_i - t4b_i;
  END IF;

  cl_c := greatest(0, o_c + av_c - u_c - dr_c);
  cl_s := greatest(0, o_s + av_s - u_s - dr_s);
  cl_i := greatest(0, o_i + av_i - u_i - dr_i);
  RETURN jsonb_build_object(
    'row', v_row,
    'opening', jsonb_build_object('cgst', o_c, 'sgst', o_s, 'igst', o_i),
    'availed', jsonb_build_object('cgst', av_c, 'sgst', av_s, 'igst', av_i),
    'utilised', jsonb_build_object('cgst', u_c, 'sgst', u_s, 'igst', u_i),
    'drc', jsonb_build_object('cgst', dr_c, 'sgst', dr_s, 'igst', dr_i),
    'closing', jsonb_build_object('cgst', cl_c, 'sgst', cl_s, 'igst', cl_i),
    'books', jsonb_build_object('cgst', bk_c, 'sgst', bk_s, 'igst', bk_i),
    'prev_return_filed', v_filed,
    'cgst', public.reco_tol(cl_c - bk_c), 'sgst', public.reco_tol(cl_s - bk_s), 'igst', public.reco_tol(cl_i - bk_i),
    'total', public.reco_tol((cl_c + cl_s + cl_i) - (bk_c + bk_s + bk_i)));
END;
$$;

-- How one reco stands for the gate: pulled, manual (allowed), or not.
CREATE OR REPLACE FUNCTION public.reco_gate_source(p_reco text, p_client_id uuid, p_period text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_allow public.manual_source_allowances;
  v_status text;
  v_name text;
BEGIN
  IF p_reco = 'suspended' THEN
    SELECT to_jsonb(s) INTO v_row FROM public.suspended_reco s WHERE client_id = p_client_id AND period_month = p_period;
  ELSE
    SELECT to_jsonb(g) INTO v_row FROM public.gst_receivable_reco g WHERE client_id = p_client_id AND period_month = p_period;
  END IF;
  IF v_row IS NULL THEN
    RETURN jsonb_build_object('status', 'missing');
  END IF;
  IF NULLIF(v_row->>'opening_allowance_id', '') IS NOT NULL THEN
    SELECT * INTO v_allow FROM public.manual_source_allowances WHERE id = (v_row->>'opening_allowance_id')::uuid;
  END IF;
  IF v_row->>'opening_source' = 'portal' AND NULLIF(v_row->>'opening_portal_pulled_at', '') IS NOT NULL THEN
    v_status := 'pulled';
  ELSIF v_row->>'opening_source' IN ('csv', 'not_applicable') AND v_allow.id IS NOT NULL
        AND v_allow.scope = 'reco:' || p_reco AND v_allow.used_at IS NOT NULL AND v_allow.revoked_at IS NULL THEN
    v_status := 'manual';
  ELSIF v_allow.id IS NOT NULL AND v_allow.revoked_at IS NOT NULL THEN
    v_status := 'revoked';
  ELSE
    v_status := 'not_pulled';
  END IF;
  SELECT first_name INTO v_name FROM public.profiles WHERE user_id = (v_row->>'opening_portal_pulled_by')::uuid;
  RETURN jsonb_build_object(
    'status', v_status,
    'source', v_row->>'opening_source',
    'pulled_at', v_row->'opening_portal_pulled_at',
    'pulled_by', v_row->'opening_portal_pulled_by',
    'pulled_by_name', v_name,
    'override', CASE WHEN v_row->>'opening_override_justification' IS NOT NULL THEN jsonb_build_object(
      'by', v_row->'opening_override_by',
      'by_name', (SELECT first_name FROM public.profiles WHERE user_id = (v_row->>'opening_override_by')::uuid),
      'at', v_row->'opening_override_at', 'reason', v_row->'opening_override_justification') END,
    'allowance', CASE WHEN v_allow.id IS NOT NULL THEN jsonb_build_object(
      'id', v_allow.id, 'reason', v_allow.reason, 'allowed_by', v_allow.allowed_by,
      'allowed_by_name', (SELECT first_name FROM public.profiles WHERE user_id = v_allow.allowed_by),
      'allowed_at', v_allow.allowed_at, 'used_by', v_allow.used_by, 'used_at', v_allow.used_at,
      'revoked_at', v_allow.revoked_at) END);
END;
$$;

-- The GSTR-3B push gate. Never raises: any error is a "could not run"
-- reason with ok false.
CREATE OR REPLACE FUNCTION public.gstr3b_push_gate(p_client_id uuid, p_period text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key integer;
  v_new boolean;
  v_label text;
  v_noitc boolean;
  v_reasons jsonb := '[]'::jsonb;
  s_src jsonb; g_src jsonb;
  s_diff jsonb; g_diff jsonb;
  s_status text; g_status text;
  v_suspended jsonb; v_receivable jsonb;
BEGIN
  BEGIN
    v_key := public.reco_period_key(p_period);
    IF v_key IS NULL THEN
      RAISE EXCEPTION 'the month must be MM/YYYY';
    END IF;
    IF p_client_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id) THEN
      RAISE EXCEPTION 'no such client';
    END IF;
    v_new := v_key >= 202606;
    v_label := public.reco_month_label(p_period);
    SELECT regular_sub_type = 'Builder' AND builder_itc_type = 'NO_ITC' INTO v_noitc FROM public.clients WHERE id = p_client_id;
    v_noitc := coalesce(v_noitc, false);

    -- Suspended Reco
    s_src := public.reco_gate_source('suspended', p_client_id, p_period);
    s_status := s_src->>'status';
    IF v_new AND s_status NOT IN ('pulled', 'manual') THEN
      v_reasons := v_reasons || jsonb_build_object('code', 'suspended_not_pulled', 'message',
        CASE s_status
          WHEN 'missing' THEN 'Suspended Reco for ' || v_label || ' is not pulled from the portal.'
          WHEN 'revoked' THEN 'The manual entry allowed for Suspended Reco for ' || v_label || ' was revoked. Pull it from the portal.'
          WHEN 'not_pulled' THEN CASE WHEN s_src->>'source' = 'portal'
            THEN 'Suspended Reco for ' || v_label || ' has no pull recorded. Pull it from the portal.'
            ELSE 'Suspended Reco for ' || v_label || ' is not pulled from the portal (its opening was '
              || CASE s_src->>'source' WHEN 'csv' THEN 'uploaded' WHEN 'not_applicable' THEN 'marked Not Applicable' ELSE 'entered' END
              || ' by hand).' END
          ELSE 'Suspended Reco for ' || v_label || ' is not pulled from the portal.' END);
    ELSE
      s_diff := public.suspended_reco_difference(p_client_id, p_period);
      IF (s_diff->>'total')::numeric <> 0 AND NOT v_noitc THEN
        v_reasons := v_reasons || jsonb_build_object('code', 'suspended_difference', 'message',
          'Suspended Reco for ' || v_label || ' has a difference of ₹' || to_char((s_diff->>'total')::numeric, 'FM999999999990.00') || '.');
      END IF;
    END IF;
    v_suspended := s_src || jsonb_build_object('required_pull', v_new, 'difference', s_diff, 'waived', v_noitc);

    -- GST Receivable Reco (06/2026 on)
    IF v_new THEN
      g_src := public.reco_gate_source('receivable', p_client_id, p_period);
      g_status := g_src->>'status';
      IF g_status NOT IN ('pulled', 'manual') THEN
        v_reasons := v_reasons || jsonb_build_object('code', 'receivable_not_pulled', 'message',
          CASE g_status
            WHEN 'missing' THEN 'GST Receivable Reco for ' || v_label || ' is not pulled from the portal.'
            WHEN 'revoked' THEN 'The manual entry allowed for GST Receivable Reco for ' || v_label || ' was revoked. Pull it from the portal.'
            WHEN 'not_pulled' THEN CASE WHEN g_src->>'source' = 'portal'
              THEN 'GST Receivable Reco for ' || v_label || ' has no pull recorded. Pull it from the portal.'
              ELSE 'GST Receivable Reco for ' || v_label || ' is not pulled from the portal (its opening was '
                || CASE g_src->>'source' WHEN 'csv' THEN 'uploaded' WHEN 'not_applicable' THEN 'marked Not Applicable' ELSE 'entered' END
                || ' by hand).' END
            ELSE 'GST Receivable Reco for ' || v_label || ' is not pulled from the portal.' END);
      ELSE
        g_diff := public.gst_receivable_reco_difference(p_client_id, p_period);
        IF (g_diff->>'total')::numeric <> 0 THEN
          v_reasons := v_reasons || jsonb_build_object('code', 'receivable_difference', 'message',
            'GST Receivable Reco for ' || v_label || ' has a difference of ₹' || to_char((g_diff->>'total')::numeric, 'FM999999999990.00') || '.');
        END IF;
      END IF;
      v_receivable := g_src || jsonb_build_object('required', true, 'difference', g_diff);
    ELSE
      v_receivable := jsonb_build_object('required', false);
    END IF;

    RETURN jsonb_build_object(
      'ok', jsonb_array_length(v_reasons) = 0,
      'client_id', p_client_id, 'period_month', p_period, 'checked_at', now(),
      'reasons', v_reasons, 'suspended', v_suspended, 'receivable', v_receivable);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', true,
      'client_id', p_client_id, 'period_month', p_period, 'checked_at', now(),
      'reasons', jsonb_build_array(jsonb_build_object('code', 'error', 'message',
        'The reconciliation check could not run: ' || SQLERRM || '.')));
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gstr3b_push_gate(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.suspended_reco_difference(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gst_receivable_reco_difference(uuid, text) TO anon, authenticated, service_role;

COMMIT;
