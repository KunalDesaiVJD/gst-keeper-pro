-- Suspended Reco and GST Receivable Reco: portal figures by pull only, and one
-- GSTR-3B push gate (the firm's decisions of 21 Oct 2026).
--
--  (a) From the Jun-2026 return period (06/2026) the opening balances, and
--      the GST Receivable Reco's ITC utilised and DRC-03 figures, come only
--      from the browser extension's pull, for every client, Nil returns
--      included. The CSV upload, Not Applicable, and any save that changes
--      opening_* / utilized_* / drc_* / opening_source or the pull and CSV
--      stamps are refused by reco_source_guard. The pull writes through
--      reco_record_pull, which needs a staff member (the app user who pressed
--      Pull), stamps who and when (server time) and logs the extension
--      version. It keeps an override made against the same portal figure and
--      clears one made against another, clears the CSV stamps, and uses up an
--      open manual allowance for the month. A month whose statement has no
--      balance row on the portal is saved as 0 and marked so
--      (opening_portal_empty). A reco row never moves to another client or
--      month. Typed books figures (books_closing_*) and the Suspended Reco's
--      portal_* snapshot stay editable. Periods before 06/2026 keep today's
--      behaviour.
--  (b) When a pull cannot be done (wrong portal password, portal down, no
--      access), the superadmin may allow a manual entry for one client, month
--      and reco: a row in manual_source_allowances (scope 'reco:suspended' or
--      'reco:receivable'), given with a reason through manual_source_allow and
--      taken back through manual_source_revoke. reco_manual_opening uses it
--      once (CSV upload or Not Applicable, never over a pulled month) through
--      manual_source_take and links the row to it (opening_allowance_id);
--      everything shows it as "manual (allowed by X: reason)". The table, its
--      guard and the three functions are byte for byte the filing branch's
--      (20261021110000_filing_status_pull_only.sql);
--      supabase/tests/reco_gate/shared_block.sh checks that.
--  (c) The opening balance override is made only through
--      reco_override_opening, by the superadmin or a GST Manager (was the
--      superadmin only, 20261020150000, which trusted the client-sent
--      opening_override_by), with a reason of at least 5 characters; the time
--      is the database's. opening_override_guard refuses every other write of
--      the override fields, for every period.
--  (d) Every change of a reco's portal side (pull, manual entry, override,
--      insert, Clear Data, delete) is written to reco_opening_log (select
--      only), naming the person each door checked. Clear Data goes through
--      reco_clear; a direct delete names nobody; a client's deletion is
--      logged as "Client deleted" (the log has no foreign key to clients and
--      outlives the client).
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
-- auth.uid() is NULL), as for every staff_* function, checked against
-- staff_level_of. RLS stays open to public; the gates are the triggers and
-- the SECURITY DEFINER functions.
--
-- Re-runnable. Changes no existing row (adds columns with defaults).
--
-- ===========================================================================
-- Live apply (project gcquafqxbykxkbexcdpy ONLY; never SUPABASE_PROJECT_REF)
-- ===========================================================================
-- 1. Dry checks (SELECT only, management API read_only), note the numbers:
--      SELECT to_regprocedure('public.staff_level_of(uuid)') IS NOT NULL;            -- true
--      SELECT to_regprocedure('public.opening_override_guard()') IS NOT NULL;        -- true
--      SELECT to_regclass('public.reco_opening_log');                                -- NULL
--      SELECT to_regclass('public.manual_source_allowances');                        -- NULL, or the filing
--        -- branch's table if 20261021110000 went first: then also
--        -- SELECT count(*) FROM manual_source_allowances;  (note it)
--      SELECT opening_source, count(*) FROM suspended_reco GROUP BY 1 ORDER BY 1;    -- 21 Oct 11:18 UTC: csv 8,
--        -- manual 354, not_applicable 2, portal 126 (490 rows)
--      SELECT opening_source, count(*) FROM gst_receivable_reco GROUP BY 1 ORDER BY 1; -- csv 5, manual 3, portal 132 (140)
--      SELECT count(*) FROM suspended_reco WHERE opening_override_justification IS NOT NULL;      -- 8
--      SELECT count(*) FROM gst_receivable_reco WHERE opening_override_justification IS NOT NULL; -- 0
--      SELECT count(*) FROM gstr3b_push_versions;                                    -- 272
--      SELECT count(*) FROM suspended_reco WHERE opening_source = 'portal' AND opening_portal_pulled_at IS NULL;  -- 0
--      (the same on gst_receivable_reco: 0; a pull row without a time would read as not pulled)
--      SELECT count(DISTINCT client_id) FROM (SELECT client_id FROM suspended_reco
--        UNION SELECT client_id FROM gst_receivable_reco) u;                         -- 73 (of 127 clients)
--    Ask staff to finish any Override in an open reco page: from the apply on,
--    an override is saved only by the new app (reco_override_opening).
-- 2. Apply this file once (it has its own BEGIN / COMMIT; safe to apply again).
--    With the filing branch's 20261021110000: either order works (the shared
--    block is identical); apply both before the app goes out.
-- 3. After checks:
--    a. The counts in step 1 are unchanged; reco_opening_log has 0 rows;
--       manual_source_allowances has 0 rows (or the number noted in step 1).
--    b. SELECT count(*) FROM suspended_reco WHERE opening_portal_empty;           -- 0 (and on gst_receivable_reco)
--       SELECT count(*) FROM suspended_reco WHERE opening_override_base IS NOT NULL;  -- 0
--    c. SELECT has_function_privilege('anon', p, 'execute') FROM unnest(ARRAY[
--         'public.gstr3b_push_gate(uuid,text)', 'public.manual_source_allow(uuid,uuid,text,text,text)',
--         'public.manual_source_revoke(uuid,uuid)', 'public.reco_record_pull(uuid,text,uuid,text,jsonb,jsonb,jsonb,text,boolean)',
--         'public.reco_manual_opening(uuid,text,uuid,text,text,jsonb,jsonb,jsonb,text)',
--         'public.reco_override_opening(uuid,text,uuid,text,jsonb,text)', 'public.reco_clear(uuid,text,uuid,text[])']) p;  -- all true
--       SELECT has_function_privilege('anon', 'public.manual_source_take(uuid,uuid,text,text)', 'execute'),
--              has_function_privilege('anon', 'public.reco_door(text,uuid,text,text)', 'execute');  -- false, false
--       SELECT to_regprocedure('public.reco_record_pull(uuid,text,uuid,text,jsonb,jsonb,jsonb,text)');  -- NULL (old signature gone)
--       SELECT conname FROM pg_constraint WHERE conrelid = 'public.reco_opening_log'::regclass AND contype = 'f';  -- none
--    d. The gate for 09/2026 (every client with a GSTR-3B / GSTR-3B (Q) row):
--         SELECT g->>'ok', count(*) FROM (SELECT public.gstr3b_push_gate(f.client_id, f.period_month) g
--           FROM filing_status f WHERE f.return_type::text IN ('GSTR-3B','GSTR-3B (Q)')
--           AND f.period_month = '09/2026') x GROUP BY 1;
--       On a copy of the live rows of 21 Oct 11:17 UTC the wider base (a 3B row,
--       a reco row or a push: 86 clients) gave 38 pass, 48 blocked: 42 with
--       no row for one or both recos (not pulled), 4 entered by hand and not
--       allowed (TAMNNA INFRASTRUCTURE-GUJARAT, SORATH BUILDERS, K V INFOCOM,
--       SBL-GJ),
--       1 Suspended Reco difference (NAVRATNA S G HIGHWAY, already Filed),
--       1 GST Receivable Reco difference (SHIVAM PLY & FURNITURE). 10/2026: the
--       3 clients with a 3B row are blocked, no reco row pulled yet. Expect the
--       same give or take pulls made since.
--    e. With the ANON key from .env (never the management API, which bypasses
--       RLS), refused writes change nothing and prove the guards:
--         PATCH /rest/v1/suspended_reco?client_id=eq.<id>&period_month=eq.09/2026 {"opening_source":"csv"}
--           -> 4xx "From Jun 2026 the opening balance comes only from the portal pull..."
--         PATCH the same row {"period_month":"08/2026"}
--           -> 4xx "A reco row stays with its client and month..."
--         POST /rest/v1/rpc/reco_record_pull {"p_actor_id":null,"p_reco":"suspended",
--           "p_client_id":"<id>","p_period":"09/2026","p_opening":{"igst":0,"cgst":0,"sgst":0}}
--           -> 4xx "A pull is saved only for a staff member..."
-- 4. Release in this order, the same hour: this migration (and the filing
--    branch's), the app (Vercel), then extension 0.16.0 in every office
--    Chrome: copy extension/ over the extension folder on every PC that pulls
--    or pushes (the firm's Chrome with "Run scheduled syncs in this Chrome",
--    the office agent PC, staff PCs), chrome://extensions -> Reload, check the
--    popup shows 0.16.0. Until it is loaded a pull from an older extension is
--    refused by the guard (the reco pages ask for 0.16.0 before they start
--    one), and the app asks for 0.16.0 before a GSTR-3B push
--    (MIN_EXTENSION_VERSION). The popup's full sync no longer saves the recos
--    (it has no app user): pulls are made from the reco pages. No Edge
--    Function changes.
-- 5. After the release, pull one Nil client whose reversal ledger is empty
--    (PROMED ENTERPRISES LLP or UNITED DEVELOPERS-NO ITC, 09/2026) and check
--    Suspended Reco shows "Pulled from portal ..., no balance on the portal".
--    If the extension's diagnostic box says no balance row and nothing was
--    saved, the portal's wording for an empty month differs from the one
--    content.js looks for (ledgerSaysNoRecords): report it.
-- Undo: DROP TRIGGER trg_suspended_reco_source_guard ON public.suspended_reco;
--       DROP TRIGGER trg_gst_receivable_reco_source_guard ON public.gst_receivable_reco;
--       then re-run 20261020150000 for the old override guard. The new
--       columns, tables and functions can stay.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Manual source allowances (shared with the filing branch: keep identical)
-- ---------------------------------------------------------------------------
-- One superadmin exception for one client, period and scope ('filing:GSTR-3B',
-- 'reco:suspended', 'reco:receivable', ...), with a reason. Everything from
-- the CREATE TABLE below to the GRANT on manual_source_revoke is copied byte
-- for byte from 20261021110000_filing_status_pull_only.sql (filing branch);
-- supabase/tests/reco_gate/shared_block.sh checks that the two agree and that
-- either migration applies after the other. The reco write that uses an
-- allowance marks it used through manual_source_take.
--
-- This branch's first draft (never applied live) returned jsonb from
-- manual_source_allow / _revoke and had manual_source_use instead of _take:
-- drop those if a local database has them, so the shared definitions apply.
DO $$
BEGIN
  IF pg_get_function_result(to_regprocedure('public.manual_source_allow(uuid,uuid,text,text,text)')) = 'jsonb' THEN
    DROP FUNCTION public.manual_source_allow(uuid, uuid, text, text, text);
  END IF;
  IF pg_get_function_result(to_regprocedure('public.manual_source_revoke(uuid,uuid)')) = 'jsonb' THEN
    DROP FUNCTION public.manual_source_revoke(uuid, uuid);
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.manual_source_use(uuid, uuid, text, text);

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

-- Writes only from the three functions below (they turn
-- app.manual_source_write on for their own statement). A client's
-- allowances go with the client.
CREATE OR REPLACE FUNCTION public.manual_source_allowances_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('app.manual_source_write', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = OLD.client_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Only the superadmin gives or takes back a manual allowance, and only from GST Keeper.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_manual_source_allowances_guard ON public.manual_source_allowances;
CREATE TRIGGER trg_manual_source_allowances_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.manual_source_allowances
  FOR EACH ROW EXECUTE FUNCTION public.manual_source_allowances_guard();

-- The superadmin allows one manual upload for a client, period and scope.
-- One live allowance per client, period and scope: a used one is taken back
-- (manual_source_revoke) before another is given, so each exception stays a
-- separate, dated record.
CREATE OR REPLACE FUNCTION public.manual_source_allow(
  p_actor_id  uuid,
  p_client_id uuid,
  p_period    text,
  p_scope     text,
  p_reason    text
)
RETURNS public.manual_source_allowances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row  public.manual_source_allowances;
  v_live public.manual_source_allowances;
BEGIN
  IF p_actor_id IS NULL OR public.staff_level_of(p_actor_id) IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Only the superadmin can allow a manual upload.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client_id) THEN
    RAISE EXCEPTION 'Client not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_period IS NULL OR p_period !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN
    RAISE EXCEPTION 'The period must be MM/YYYY.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_scope IS NULL OR p_scope !~ '^[a-z][a-z0-9_]*:\S' THEN
    RAISE EXCEPTION 'Unknown allowance scope.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Give a reason of at least 5 characters.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_live FROM public.manual_source_allowances
   WHERE client_id = p_client_id AND period_month = p_period AND scope = p_scope AND revoked_at IS NULL
   FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION '%', CASE WHEN v_live.used_at IS NULL
      THEN 'A manual upload is already allowed for this. Take it back first to give it again.'
      ELSE 'The manual upload allowed for this was used. Take it back first to allow another.' END
      USING ERRCODE = 'unique_violation';
  END IF;

  PERFORM set_config('app.manual_source_write', 'on', true);
  BEGIN
    INSERT INTO public.manual_source_allowances (client_id, period_month, scope, reason, allowed_by)
    VALUES (p_client_id, p_period, p_scope, btrim(p_reason), p_actor_id)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    PERFORM set_config('app.manual_source_write', '', true);
    RAISE EXCEPTION 'A manual upload is already allowed for this. Take it back first to give it again.'
      USING ERRCODE = 'unique_violation';
  END;
  PERFORM set_config('app.manual_source_write', '', true);
  RETURN v_row;
END;
$$;

-- The superadmin takes an allowance back (used or not). Data entered under a
-- used one stays, still marked manual with this allowance's reason.
CREATE OR REPLACE FUNCTION public.manual_source_revoke(
  p_actor_id uuid,
  p_id       uuid
)
RETURNS public.manual_source_allowances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.manual_source_allowances;
BEGIN
  IF p_actor_id IS NULL OR public.staff_level_of(p_actor_id) IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Only the superadmin can take back a manual allowance.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_row FROM public.manual_source_allowances WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Allowance not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RETURN v_row;
  END IF;
  PERFORM set_config('app.manual_source_write', 'on', true);
  UPDATE public.manual_source_allowances
     SET revoked_at = now(), revoked_by = p_actor_id
   WHERE id = p_id
  RETURNING * INTO v_row;
  PERFORM set_config('app.manual_source_write', '', true);
  RETURN v_row;
END;
$$;

-- Internal (no grant): the live, unused allowance for a client, period and
-- scope, marked used by p_actor_id. Raises when there is none. Called inside
-- the SECURITY DEFINER function that writes the manual data, in the same
-- transaction, so a refused write leaves the allowance unused.
CREATE OR REPLACE FUNCTION public.manual_source_take(
  p_actor_id  uuid,
  p_client_id uuid,
  p_period    text,
  p_scope     text
)
RETURNS public.manual_source_allowances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.manual_source_allowances;
BEGIN
  SELECT * INTO v_row FROM public.manual_source_allowances
   WHERE client_id = p_client_id AND period_month = p_period AND scope = p_scope
     AND revoked_at IS NULL AND used_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no manual allowance for this. Ask the superadmin to allow a manual upload, with a reason.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('app.manual_source_write', 'on', true);
  UPDATE public.manual_source_allowances
     SET used_by = p_actor_id, used_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;
  PERFORM set_config('app.manual_source_write', '', true);
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.manual_source_take(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manual_source_allow(uuid, uuid, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manual_source_revoke(uuid, uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Reco columns, helpers and the change log
-- ---------------------------------------------------------------------------
-- opening_allowance_id: the manual entry allowance an opening was entered
-- under. opening_portal_empty: the pull found the month's statement with no
-- balance row (nothing on the portal) and saved 0. opening_override_base:
-- the opening an override replaced (the pulled figure); a later pull that
-- brings the same figure keeps the override, a different one clears it.
ALTER TABLE public.suspended_reco
  ADD COLUMN IF NOT EXISTS opening_allowance_id uuid REFERENCES public.manual_source_allowances(id);
ALTER TABLE public.gst_receivable_reco
  ADD COLUMN IF NOT EXISTS opening_allowance_id uuid REFERENCES public.manual_source_allowances(id);
ALTER TABLE public.suspended_reco ADD COLUMN IF NOT EXISTS opening_portal_empty boolean NOT NULL DEFAULT false;
ALTER TABLE public.gst_receivable_reco ADD COLUMN IF NOT EXISTS opening_portal_empty boolean NOT NULL DEFAULT false;
ALTER TABLE public.suspended_reco ADD COLUMN IF NOT EXISTS opening_override_base jsonb;
ALTER TABLE public.gst_receivable_reco ADD COLUMN IF NOT EXISTS opening_override_base jsonb;
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
-- pages; written only by the trigger below (SELECT policy only). No foreign
-- key to clients: the log outlives a deleted client, whose reco rows the
-- cascade deletes and the trigger logs ("Client deleted").
CREATE TABLE IF NOT EXISTS public.reco_opening_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reco text NOT NULL CHECK (reco IN ('suspended', 'receivable')),
  client_id uuid NOT NULL,
  period_month text NOT NULL,
  action text NOT NULL,
  source text,
  actor_id uuid,
  reason text,
  allowance_id uuid,
  ext_version text,
  before jsonb,
  after jsonb,
  logged_at timestamptz NOT NULL DEFAULT now()
);
-- This branch's first draft had a foreign key to clients (a client with reco
-- rows could not be deleted) and no ext_version.
ALTER TABLE public.reco_opening_log DROP CONSTRAINT IF EXISTS reco_opening_log_client_id_fkey;
ALTER TABLE public.reco_opening_log ADD COLUMN IF NOT EXISTS ext_version text;
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
      'opening_portal_empty', r->'opening_portal_empty',
      'opening_allowance_id', r->'opening_allowance_id',
      'opening_override_justification', r->'opening_override_justification',
      'opening_override_at', r->'opening_override_at', 'opening_override_by', r->'opening_override_by',
      'opening_override_base', r->'opening_override_base')
    || CASE WHEN p_reco = 'receivable' THEN jsonb_build_object(
      'utilized_cgst', r->'utilized_cgst', 'utilized_sgst', r->'utilized_sgst', 'utilized_igst', r->'utilized_igst',
      'drc_cgst', r->'drc_cgst', 'drc_sgst', r->'drc_sgst', 'drc_igst', r->'drc_igst') ELSE '{}'::jsonb END
  END
$$;

-- Who acted is the p_actor_id the door checked and set for its own write
-- (app.reco_actor): reco_record_pull, reco_manual_opening,
-- reco_override_opening, reco_clear (Clear Data). Any other write is a Save
-- of typed figures (named by its updated_by) or a direct delete, which
-- names nobody (it may be anyone's). The pull also logs the extension
-- version and what it did to an override or an open allowance (app.reco_note).
CREATE OR REPLACE FUNCTION public.reco_opening_log_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reco text := CASE WHEN TG_TABLE_NAME = 'gst_receivable_reco' THEN 'receivable' ELSE 'suspended' END;
  v_mode text := coalesce(current_setting('app.reco_write', true), '');
  v_door_actor uuid := NULLIF(coalesce(current_setting('app.reco_actor', true), ''), '')::uuid;
  v_old jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN public.reco_portal_side(v_reco, to_jsonb(OLD)) END;
  v_new jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN public.reco_portal_side(v_reco, to_jsonb(NEW)) END;
  v_row jsonb := to_jsonb(COALESCE(NEW, OLD));
  v_action text;
  v_actor uuid;
  v_reason text;
  v_allowance uuid;
  v_ext text;
BEGIN
  -- A Save that leaves the portal side alone is not logged; every door's
  -- write is (a pull of the same figures included).
  IF TG_OP = 'UPDATE' AND v_mode NOT IN ('pull', 'manual', 'override') AND v_old IS NOT DISTINCT FROM v_new THEN
    RETURN NULL;
  END IF;
  v_allowance := NULLIF(v_row->>'opening_allowance_id', '')::uuid;
  IF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_actor := CASE WHEN v_mode = 'clear' THEN v_door_actor END;
    v_reason := CASE
      WHEN NOT EXISTS (SELECT 1 FROM public.clients WHERE id = (v_row->>'client_id')::uuid) THEN 'Client deleted'
      WHEN v_mode = 'clear' THEN 'Clear Data' END;
  ELSIF v_mode = 'pull' THEN
    v_action := 'pull';
    v_actor := v_door_actor;
    v_reason := NULLIF(current_setting('app.reco_note', true), '');
    v_ext := NULLIF(current_setting('app.reco_ext', true), '');
  ELSIF v_mode = 'manual' THEN
    v_action := 'manual';
    v_actor := v_door_actor;
    SELECT reason INTO v_reason FROM public.manual_source_allowances WHERE id = v_allowance;
  ELSIF v_mode = 'override' THEN
    v_action := 'override';
    v_actor := v_door_actor;
    v_reason := NEW.opening_override_justification;
  ELSE
    v_action := CASE WHEN TG_OP = 'INSERT' THEN 'insert' ELSE 'save' END;
    v_actor := NULLIF(v_row->>'updated_by', '')::uuid;
  END IF;
  INSERT INTO public.reco_opening_log (reco, client_id, period_month, action, source, actor_id, reason, allowance_id,
                                       ext_version, before, after)
  VALUES (v_reco, (v_row->>'client_id')::uuid, v_row->>'period_month', v_action, v_row->>'opening_source',
          v_actor, v_reason, v_allowance, v_ext, v_old, v_new);
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
-- 3. The guard: from 06/2026 the portal side changes only through its doors
-- ---------------------------------------------------------------------------
-- reco_record_pull, reco_manual_opening and reco_override_opening open it
-- for their own write (app.reco_write = 'pull' / 'manual' / 'override').
-- Otherwise a new row carries no portal-side figure, and an update leaves
-- them as they are. A row never moves to another client or month (any
-- period, any door): that would carry a pull, an override or a cleared
-- difference into a month that has none. Deleting a row (Clear Data) is
-- allowed: the gate then reads it as not pulled. Rows before 06/2026 keep
-- today's behaviour (the override aside: opening_override_guard).
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
  k text;
  v_fields text[] := ARRAY['opening_cgst', 'opening_sgst', 'opening_igst',
                           'opening_source', 'opening_csv_period_month', 'opening_csv_uploaded_at', 'opening_csv_uploaded_by',
                           'opening_portal_pulled_at', 'opening_portal_pulled_by', 'opening_portal_empty', 'opening_allowance_id']
    || CASE WHEN TG_TABLE_NAME = 'gst_receivable_reco'
         THEN ARRAY['utilized_cgst', 'utilized_sgst', 'utilized_igst', 'drc_cgst', 'drc_sgst', 'drc_igst'] ELSE ARRAY[]::text[] END;
  v_msg text := 'From Jun 2026 the opening balance comes only from the portal pull. '
    || 'Pull it with the browser extension, or ask the superadmin to allow a manual entry for this month.';
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.period_month IS DISTINCT FROM OLD.period_month) THEN
    RAISE EXCEPTION 'A reco row stays with its client and month. Clear it, then pull the other month.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF coalesce(current_setting('app.reco_write', true), '') IN ('pull', 'manual', 'override') THEN
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
       OR NEW.opening_portal_empty IS DISTINCT FROM false
       OR coalesce(NEW.opening_cgst, 0) <> 0 OR coalesce(NEW.opening_sgst, 0) <> 0 OR coalesce(NEW.opening_igst, 0) <> 0 THEN
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
  FOREACH k IN ARRAY v_fields LOOP
    IF (v_new->k) IS DISTINCT FROM (v_old->k) THEN
      RAISE EXCEPTION '%', v_msg USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
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
-- 4. The override: superadmin and GST Managers, with a reason, by its door
-- ---------------------------------------------------------------------------
-- An override is made only through reco_override_opening, which checks who
-- acts (the superadmin or a GST Manager), wants a reason, stamps the time
-- and logs the person. Every other write of the override fields is refused,
-- for every period (20261020150000 checked the client-sent
-- opening_override_by instead, which anyone could fill in). The pull and the
-- allowed manual entry clear them through their own doors.
CREATE OR REPLACE FUNCTION public.opening_override_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF coalesce(current_setting('app.reco_write', true), '') IN ('pull', 'manual', 'override') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.opening_override_justification IS NULL AND NEW.opening_override_at IS NULL
       AND NEW.opening_override_by IS NULL AND NEW.opening_override_base IS NULL THEN
      RETURN NEW;
    END IF;
    -- An upsert of an existing row fires this first; its UPDATE half decides.
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE client_id = $1 AND period_month = $2)', TG_TABLE_NAME)
      INTO v_exists USING NEW.client_id, NEW.period_month;
    IF v_exists THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.opening_override_justification IS NOT DISTINCT FROM OLD.opening_override_justification
    AND NEW.opening_override_at IS NOT DISTINCT FROM OLD.opening_override_at
    AND NEW.opening_override_by IS NOT DISTINCT FROM OLD.opening_override_by
    AND NEW.opening_override_base IS NOT DISTINCT FROM OLD.opening_override_base THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'An opening balance is overridden only with the Override button, by the superadmin or a GST Manager.'
    USING ERRCODE = 'insufficient_privilege';
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
-- 5. The doors: the pull, the allowed manual entry, the override, Clear Data
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

-- Sets (or, with NULLs, clears) what the doors tell the triggers.
CREATE OR REPLACE FUNCTION public.reco_door(p_mode text, p_actor uuid, p_note text DEFAULT NULL, p_ext text DEFAULT NULL)
RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('app.reco_write', coalesce(p_mode, ''), true),
         set_config('app.reco_actor', coalesce(p_actor::text, ''), true),
         set_config('app.reco_note', coalesce(p_note, ''), true),
         set_config('app.reco_ext', coalesce(p_ext, ''), true);
$$;
REVOKE ALL ON FUNCTION public.reco_door(text, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- The extension's pull (0.16.0): credit ledger -> GST Receivable Reco
-- (opening, ITC utilised, DRC-03), reversal ledger -> Suspended Reco
-- (opening). p_actor_id is the app user who asked for it, and must be staff:
-- a pull nobody can be named for is refused (the popup's full sync no longer
-- saves the recos). p_no_rows: the month's statement loaded with no balance
-- row (nothing on the portal), saved as 0 and marked so. Clears the CSV
-- stamps and the allowance link; uses up a live, unused manual entry
-- allowance for the month (no longer needed); keeps an override made
-- against the same portal figure, clears one made against another. The
-- log row names who, the extension version and what happened to an
-- override or allowance.
DROP FUNCTION IF EXISTS public.reco_record_pull(uuid, text, uuid, text, jsonb, jsonb, jsonb, text);
CREATE OR REPLACE FUNCTION public.reco_record_pull(
  p_actor_id uuid, p_reco text, p_client_id uuid, p_period text,
  p_opening jsonb, p_utilised jsonb DEFAULT NULL, p_drc jsonb DEFAULT NULL, p_ext_version text DEFAULT NULL,
  p_no_rows boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_empty boolean := coalesce(p_no_rows, false);
  v_open jsonb := CASE WHEN coalesce(p_no_rows, false) THEN '{"igst":0,"cgst":0,"sgst":0}'::jsonb ELSE p_opening END;
  v_scope text := 'reco:' || coalesce(p_reco, '');
  v_old jsonb;
  v_base jsonb;
  v_had_override boolean := false;
  v_keep boolean := false;
  v_name text;
  v_notes text[] := ARRAY[]::text[];
  v_closed uuid;
  v_id uuid;
  oi numeric; oc numeric; os numeric;
BEGIN
  IF p_actor_id IS NULL OR public.staff_level_of(p_actor_id) IS NULL THEN
    RAISE EXCEPTION 'A pull is saved only for a staff member. Start it with Pull on the Suspended Reco or GST Receivable Reco page.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reco IS NULL OR p_reco NOT IN ('suspended', 'receivable') THEN
    RAISE EXCEPTION 'Unknown reco "%".', p_reco USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_period IS NULL OR p_period !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN
    RAISE EXCEPTION 'The month must be MM/YYYY.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'No such client.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_open IS NULL OR jsonb_typeof(v_open) <> 'object' THEN
    RAISE EXCEPTION 'The pull sent no opening balance.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  oi := public.reco_head(v_open, 'igst'); oc := public.reco_head(v_open, 'cgst'); os := public.reco_head(v_open, 'sgst');

  -- The row as it stands, locked: is there an override, and was it made
  -- against the figure the portal shows now?
  IF p_reco = 'suspended' THEN
    SELECT to_jsonb(s) INTO v_old FROM public.suspended_reco s WHERE client_id = p_client_id AND period_month = p_period FOR UPDATE;
  ELSE
    SELECT to_jsonb(g) INTO v_old FROM public.gst_receivable_reco g WHERE client_id = p_client_id AND period_month = p_period FOR UPDATE;
  END IF;
  IF v_old IS NOT NULL AND v_old->>'opening_override_justification' IS NOT NULL THEN
    v_had_override := true;
    v_base := v_old->'opening_override_base';
    v_keep := jsonb_typeof(v_base) = 'object'
      AND public.reco_num(v_base->'igst') = oi AND public.reco_num(v_base->'cgst') = oc AND public.reco_num(v_base->'sgst') = os;
    SELECT first_name INTO v_name FROM public.profiles WHERE user_id = NULLIF(v_old->>'opening_override_by', '')::uuid;
    v_notes := v_notes || (CASE WHEN v_keep
      THEN 'Override by ' || coalesce(v_name, 'unknown') || ' kept: the portal figure is the one it was made against.'
      ELSE 'Override by ' || coalesce(v_name, 'unknown') || ' cleared: the portal figure is not the one it was made against.' END);
  END IF;
  IF v_empty THEN
    v_notes := v_notes || 'No balance row on the portal for the month; saved as 0.'::text;
  END IF;
  -- An open manual entry allowance is no longer needed: the pull uses it up.
  IF EXISTS (SELECT 1 FROM public.manual_source_allowances
              WHERE client_id = p_client_id AND period_month = p_period AND scope = v_scope
                AND revoked_at IS NULL AND used_at IS NULL) THEN
    v_closed := (public.manual_source_take(p_actor_id, p_client_id, p_period, v_scope)).id;
    v_notes := v_notes || 'The manual entry allowed for the month was closed by this pull.'::text;
  END IF;

  PERFORM public.reco_door('pull', p_actor_id, NULLIF(array_to_string(v_notes, ' '), ''), p_ext_version);
  IF p_reco = 'suspended' THEN
    INSERT INTO public.suspended_reco AS r (client_id, period_month, opening_igst, opening_cgst, opening_sgst,
      opening_source, opening_portal_pulled_at, opening_portal_pulled_by, opening_portal_empty,
      opening_csv_period_month, opening_csv_uploaded_at, opening_csv_uploaded_by,
      opening_override_justification, opening_override_at, opening_override_by, opening_override_base, opening_allowance_id,
      updated_by, updated_at)
    VALUES (p_client_id, p_period, oi, oc, os, 'portal', v_now, p_actor_id, v_empty,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, p_actor_id, v_now)
    ON CONFLICT (client_id, period_month) DO UPDATE SET
      opening_igst = CASE WHEN v_keep THEN r.opening_igst ELSE EXCLUDED.opening_igst END,
      opening_cgst = CASE WHEN v_keep THEN r.opening_cgst ELSE EXCLUDED.opening_cgst END,
      opening_sgst = CASE WHEN v_keep THEN r.opening_sgst ELSE EXCLUDED.opening_sgst END,
      opening_source = 'portal', opening_portal_pulled_at = v_now, opening_portal_pulled_by = p_actor_id,
      opening_portal_empty = v_empty,
      opening_csv_period_month = NULL, opening_csv_uploaded_at = NULL, opening_csv_uploaded_by = NULL,
      opening_override_justification = CASE WHEN v_keep THEN r.opening_override_justification END,
      opening_override_at = CASE WHEN v_keep THEN r.opening_override_at END,
      opening_override_by = CASE WHEN v_keep THEN r.opening_override_by END,
      opening_override_base = CASE WHEN v_keep THEN r.opening_override_base END,
      opening_allowance_id = NULL, updated_by = p_actor_id, updated_at = v_now
    RETURNING r.id INTO v_id;
  ELSE
    INSERT INTO public.gst_receivable_reco AS r (client_id, period_month, opening_igst, opening_cgst, opening_sgst,
      opening_source, opening_portal_pulled_at, opening_portal_pulled_by, opening_portal_empty,
      opening_csv_period_month, opening_csv_uploaded_at, opening_csv_uploaded_by,
      opening_override_justification, opening_override_at, opening_override_by, opening_override_base, opening_allowance_id,
      utilized_igst, utilized_cgst, utilized_sgst, drc_igst, drc_cgst, drc_sgst, updated_by, updated_at)
    VALUES (p_client_id, p_period, oi, oc, os, 'portal', v_now, p_actor_id, v_empty,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      public.reco_head(p_utilised, 'igst'), public.reco_head(p_utilised, 'cgst'), public.reco_head(p_utilised, 'sgst'),
      coalesce(public.reco_head(p_drc, 'igst'), 0), coalesce(public.reco_head(p_drc, 'cgst'), 0),
      coalesce(public.reco_head(p_drc, 'sgst'), 0), p_actor_id, v_now)
    ON CONFLICT (client_id, period_month) DO UPDATE SET
      opening_igst = CASE WHEN v_keep THEN r.opening_igst ELSE EXCLUDED.opening_igst END,
      opening_cgst = CASE WHEN v_keep THEN r.opening_cgst ELSE EXCLUDED.opening_cgst END,
      opening_sgst = CASE WHEN v_keep THEN r.opening_sgst ELSE EXCLUDED.opening_sgst END,
      opening_source = 'portal', opening_portal_pulled_at = v_now, opening_portal_pulled_by = p_actor_id,
      opening_portal_empty = v_empty,
      opening_csv_period_month = NULL, opening_csv_uploaded_at = NULL, opening_csv_uploaded_by = NULL,
      opening_override_justification = CASE WHEN v_keep THEN r.opening_override_justification END,
      opening_override_at = CASE WHEN v_keep THEN r.opening_override_at END,
      opening_override_by = CASE WHEN v_keep THEN r.opening_override_by END,
      opening_override_base = CASE WHEN v_keep THEN r.opening_override_base END,
      opening_allowance_id = NULL,
      utilized_igst = EXCLUDED.utilized_igst, utilized_cgst = EXCLUDED.utilized_cgst, utilized_sgst = EXCLUDED.utilized_sgst,
      drc_igst = EXCLUDED.drc_igst, drc_cgst = EXCLUDED.drc_cgst, drc_sgst = EXCLUDED.drc_sgst,
      updated_by = p_actor_id, updated_at = v_now
    RETURNING r.id INTO v_id;
  END IF;
  PERFORM public.reco_door(NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'reco', p_reco, 'pulled_at', v_now, 'pulled_by', p_actor_id,
    'ext_version', p_ext_version, 'no_rows', v_empty,
    'override', CASE WHEN NOT v_had_override THEN NULL WHEN v_keep THEN 'kept' ELSE 'cleared' END,
    'allowance_closed', v_closed);
END;
$$;

-- An allowed manual entry: the credit-ledger / reversal CSV upload
-- (p_source 'csv') or Not Applicable (zeros). Uses the client's live,
-- unused allowance for 'reco:<p_reco>' and that month, once
-- (manual_source_take); refused without one, and refused once the month is
-- pulled (a pulled figure is corrected by a new pull or an override).
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
  v_allow public.manual_source_allowances;
  v_na boolean := p_source = 'not_applicable';
  v_open jsonb := CASE WHEN p_source = 'not_applicable' THEN '{"igst":0,"cgst":0,"sgst":0}'::jsonb ELSE p_opening END;
  v_old jsonb;
  v_what text := CASE WHEN p_reco = 'receivable' THEN 'GST Receivable Reco' ELSE 'Suspended Reco' END;
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
  IF p_reco = 'suspended' THEN
    SELECT to_jsonb(s) INTO v_old FROM public.suspended_reco s WHERE client_id = p_client_id AND period_month = p_period FOR UPDATE;
  ELSE
    SELECT to_jsonb(g) INTO v_old FROM public.gst_receivable_reco g WHERE client_id = p_client_id AND period_month = p_period FOR UPDATE;
  END IF;
  IF v_old->>'opening_source' = 'portal' AND NULLIF(v_old->>'opening_portal_pulled_at', '') IS NOT NULL THEN
    RAISE EXCEPTION '% for % is already pulled from the portal. Pull it again to refresh it; a difference is cleared by an opening override.',
      v_what, public.reco_month_label(p_period) USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.manual_source_allowances
                  WHERE client_id = p_client_id AND period_month = p_period AND scope = 'reco:' || p_reco
                    AND revoked_at IS NULL AND used_at IS NULL) THEN
    RAISE EXCEPTION 'No manual entry is allowed for this client and month. Pull it from the portal, or ask the superadmin to allow a manual entry.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_allow := public.manual_source_take(p_actor_id, p_client_id, p_period, 'reco:' || p_reco);
  PERFORM public.reco_door('manual', p_actor_id);
  IF p_reco = 'suspended' THEN
    INSERT INTO public.suspended_reco AS r (client_id, period_month, opening_igst, opening_cgst, opening_sgst,
      opening_source, opening_portal_pulled_at, opening_portal_pulled_by, opening_portal_empty,
      opening_csv_period_month, opening_csv_uploaded_at, opening_csv_uploaded_by,
      opening_override_justification, opening_override_at, opening_override_by, opening_override_base, opening_allowance_id,
      updated_by, updated_at)
    VALUES (p_client_id, p_period, public.reco_head(v_open, 'igst'), public.reco_head(v_open, 'cgst'),
      public.reco_head(v_open, 'sgst'), p_source, NULL, NULL, false,
      CASE WHEN v_na THEN NULL ELSE p_csv_period END, CASE WHEN v_na THEN NULL ELSE v_now END,
      CASE WHEN v_na THEN NULL ELSE p_actor_id END, NULL, NULL, NULL, NULL, v_allow.id, p_actor_id, v_now)
    ON CONFLICT (client_id, period_month) DO UPDATE SET
      opening_igst = EXCLUDED.opening_igst, opening_cgst = EXCLUDED.opening_cgst, opening_sgst = EXCLUDED.opening_sgst,
      opening_source = EXCLUDED.opening_source, opening_portal_pulled_at = NULL, opening_portal_pulled_by = NULL,
      opening_portal_empty = false,
      opening_csv_period_month = EXCLUDED.opening_csv_period_month, opening_csv_uploaded_at = EXCLUDED.opening_csv_uploaded_at,
      opening_csv_uploaded_by = EXCLUDED.opening_csv_uploaded_by,
      opening_override_justification = NULL, opening_override_at = NULL, opening_override_by = NULL, opening_override_base = NULL,
      opening_allowance_id = EXCLUDED.opening_allowance_id, updated_by = p_actor_id, updated_at = v_now
    RETURNING r.id INTO v_id;
  ELSE
    INSERT INTO public.gst_receivable_reco AS r (client_id, period_month, opening_igst, opening_cgst, opening_sgst,
      opening_source, opening_portal_pulled_at, opening_portal_pulled_by, opening_portal_empty,
      opening_csv_period_month, opening_csv_uploaded_at, opening_csv_uploaded_by,
      opening_override_justification, opening_override_at, opening_override_by, opening_override_base, opening_allowance_id,
      utilized_igst, utilized_cgst, utilized_sgst, drc_igst, drc_cgst, drc_sgst, updated_by, updated_at)
    VALUES (p_client_id, p_period, public.reco_head(v_open, 'igst'), public.reco_head(v_open, 'cgst'),
      public.reco_head(v_open, 'sgst'), p_source, NULL, NULL, false,
      CASE WHEN v_na THEN NULL ELSE p_csv_period END, CASE WHEN v_na THEN NULL ELSE v_now END,
      CASE WHEN v_na THEN NULL ELSE p_actor_id END, NULL, NULL, NULL, NULL, v_allow.id,
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
      opening_portal_empty = false,
      opening_csv_period_month = EXCLUDED.opening_csv_period_month, opening_csv_uploaded_at = EXCLUDED.opening_csv_uploaded_at,
      opening_csv_uploaded_by = EXCLUDED.opening_csv_uploaded_by,
      opening_override_justification = NULL, opening_override_at = NULL, opening_override_by = NULL, opening_override_base = NULL,
      opening_allowance_id = EXCLUDED.opening_allowance_id,
      utilized_igst = EXCLUDED.utilized_igst, utilized_cgst = EXCLUDED.utilized_cgst, utilized_sgst = EXCLUDED.utilized_sgst,
      drc_igst = EXCLUDED.drc_igst, drc_cgst = EXCLUDED.drc_cgst, drc_sgst = EXCLUDED.drc_sgst,
      updated_by = p_actor_id, updated_at = v_now
    RETURNING r.id INTO v_id;
  END IF;
  PERFORM public.reco_door(NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'reco', p_reco, 'source', p_source, 'allowance_id', v_allow.id);
END;
$$;

-- The opening balance override: the superadmin or a GST Manager (who acts
-- is p_actor_id, checked here), with a reason of at least 5 characters; the
-- time is the database's and the log names the person. From 06/2026 only a
-- pulled (or allowed manual) opening can be overridden. opening_override_base
-- keeps the figure the first override replaced, so a later pull of the same
-- portal figure keeps the override.
CREATE OR REPLACE FUNCTION public.reco_override_opening(
  p_actor_id uuid, p_reco text, p_client_id uuid, p_period text, p_opening jsonb, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text := btrim(coalesce(p_reason, ''));
  v_key integer := public.reco_period_key(p_period);
  v_now timestamptz := now();
  v_old jsonb;
  v_status text;
  v_base jsonb;
  v_id uuid;
  oi numeric; oc numeric; os numeric;
BEGIN
  IF p_actor_id IS NULL OR coalesce(public.staff_level_of(p_actor_id), '') NOT IN ('superadmin', 'gst_manager') THEN
    RAISE EXCEPTION 'Only the superadmin or a GST Manager can override an opening balance.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Give a reason for the override (at least 5 characters).' USING ERRCODE = 'check_violation';
  END IF;
  IF p_reco IS NULL OR p_reco NOT IN ('suspended', 'receivable') THEN
    RAISE EXCEPTION 'Unknown reco "%".', p_reco USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'The month must be MM/YYYY.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'No such client.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_opening IS NULL OR jsonb_typeof(p_opening) <> 'object' THEN
    RAISE EXCEPTION 'No opening balance was sent.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  oi := public.reco_head(p_opening, 'igst'); oc := public.reco_head(p_opening, 'cgst'); os := public.reco_head(p_opening, 'sgst');
  IF p_reco = 'suspended' THEN
    SELECT to_jsonb(s) INTO v_old FROM public.suspended_reco s WHERE client_id = p_client_id AND period_month = p_period FOR UPDATE;
  ELSE
    SELECT to_jsonb(g) INTO v_old FROM public.gst_receivable_reco g WHERE client_id = p_client_id AND period_month = p_period FOR UPDATE;
  END IF;
  IF v_key >= 202606 THEN
    v_status := CASE WHEN v_old IS NULL THEN 'missing' ELSE public.reco_gate_source(p_reco, p_client_id, p_period)->>'status' END;
    IF v_status NOT IN ('pulled', 'manual') THEN
      RAISE EXCEPTION 'Pull it from the portal first. An override corrects a pulled opening.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  v_base := CASE
    WHEN v_old IS NULL THEN NULL
    WHEN v_old->>'opening_override_justification' IS NOT NULL THEN v_old->'opening_override_base'
    ELSE jsonb_build_object('igst', coalesce(public.reco_num(v_old->'opening_igst'), 0),
                            'cgst', coalesce(public.reco_num(v_old->'opening_cgst'), 0),
                            'sgst', coalesce(public.reco_num(v_old->'opening_sgst'), 0)) END;
  PERFORM public.reco_door('override', p_actor_id);
  IF p_reco = 'suspended' THEN
    INSERT INTO public.suspended_reco AS r (client_id, period_month, opening_igst, opening_cgst, opening_sgst,
      opening_override_justification, opening_override_at, opening_override_by, opening_override_base, updated_by, updated_at)
    VALUES (p_client_id, p_period, oi, oc, os, v_reason, v_now, p_actor_id, v_base, p_actor_id, v_now)
    ON CONFLICT (client_id, period_month) DO UPDATE SET
      opening_igst = EXCLUDED.opening_igst, opening_cgst = EXCLUDED.opening_cgst, opening_sgst = EXCLUDED.opening_sgst,
      opening_override_justification = EXCLUDED.opening_override_justification, opening_override_at = EXCLUDED.opening_override_at,
      opening_override_by = EXCLUDED.opening_override_by, opening_override_base = EXCLUDED.opening_override_base,
      updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
    RETURNING r.id INTO v_id;
  ELSE
    INSERT INTO public.gst_receivable_reco AS r (client_id, period_month, opening_igst, opening_cgst, opening_sgst,
      opening_override_justification, opening_override_at, opening_override_by, opening_override_base, updated_by, updated_at)
    VALUES (p_client_id, p_period, oi, oc, os, v_reason, v_now, p_actor_id, v_base, p_actor_id, v_now)
    ON CONFLICT (client_id, period_month) DO UPDATE SET
      opening_igst = EXCLUDED.opening_igst, opening_cgst = EXCLUDED.opening_cgst, opening_sgst = EXCLUDED.opening_sgst,
      opening_override_justification = EXCLUDED.opening_override_justification, opening_override_at = EXCLUDED.opening_override_at,
      opening_override_by = EXCLUDED.opening_override_by, opening_override_base = EXCLUDED.opening_override_base,
      updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
    RETURNING r.id INTO v_id;
  END IF;
  PERFORM public.reco_door(NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'reco', p_reco, 'at', v_now, 'by', p_actor_id);
END;
$$;

-- Clear Data on a reco: deletes the client's rows for the months given and
-- logs who did it (a direct delete is logged with nobody named).
CREATE OR REPLACE FUNCTION public.reco_clear(p_actor_id uuid, p_reco text, p_client_id uuid, p_periods text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF p_actor_id IS NULL OR public.staff_level_of(p_actor_id) IS NULL THEN
    RAISE EXCEPTION 'Only staff can clear reco data.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reco IS NULL OR p_reco NOT IN ('suspended', 'receivable') THEN
    RAISE EXCEPTION 'Unknown reco "%".', p_reco USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM public.reco_door('clear', p_actor_id);
  IF p_reco = 'suspended' THEN
    DELETE FROM public.suspended_reco WHERE client_id = p_client_id AND period_month = ANY (coalesce(p_periods, ARRAY[]::text[]));
  ELSE
    DELETE FROM public.gst_receivable_reco WHERE client_id = p_client_id AND period_month = ANY (coalesce(p_periods, ARRAY[]::text[]));
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.reco_door(NULL, NULL);
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reco_record_pull(uuid, text, uuid, text, jsonb, jsonb, jsonb, text, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reco_manual_opening(uuid, text, uuid, text, text, jsonb, jsonb, jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reco_override_opening(uuid, text, uuid, text, jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reco_clear(uuid, text, uuid, text[]) TO anon, authenticated, service_role;

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
  -- Only an allowance for this very client, month and reco counts.
  IF NULLIF(v_row->>'opening_allowance_id', '') IS NOT NULL THEN
    SELECT * INTO v_allow FROM public.manual_source_allowances
     WHERE id = (v_row->>'opening_allowance_id')::uuid
       AND client_id = p_client_id AND period_month = p_period AND scope = 'reco:' || p_reco;
  END IF;
  IF v_row->>'opening_source' = 'portal' AND NULLIF(v_row->>'opening_portal_pulled_at', '') IS NOT NULL THEN
    v_status := 'pulled';
  ELSIF v_row->>'opening_source' IN ('csv', 'not_applicable') AND v_allow.id IS NOT NULL
        AND v_allow.used_at IS NOT NULL AND v_allow.revoked_at IS NULL THEN
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
    'empty', coalesce((v_row->>'opening_portal_empty')::boolean, false),
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
            WHEN s_src->>'source' IN ('csv', 'not_applicable')
            THEN 'Suspended Reco for ' || v_label || ' is not pulled from the portal (its opening was '
              || CASE s_src->>'source' WHEN 'csv' THEN 'uploaded' ELSE 'marked Not Applicable' END
              || ' with no manual entry allowed).'
            ELSE 'Suspended Reco for ' || v_label || ' has no portal pull yet.' END
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
              WHEN g_src->>'source' IN ('csv', 'not_applicable')
              THEN 'GST Receivable Reco for ' || v_label || ' is not pulled from the portal (its opening was '
                || CASE g_src->>'source' WHEN 'csv' THEN 'uploaded' ELSE 'marked Not Applicable' END
                || ' with no manual entry allowed).'
              ELSE 'GST Receivable Reco for ' || v_label || ' has no portal pull yet.' END
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
