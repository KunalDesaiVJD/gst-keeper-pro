-- GST change log: every change to the GST working kept, with who, when and
-- what (the firm, 21 Oct 2026: "All data of GST working & history of every
-- updation to be maintained and traceable").
--
--  * public.gst_change_log, one row per changed row: the table, the row's
--    key, the client and month (MM/YYYY; FY tables carry financial_year), the
--    operation, who did it and from where, and what changed: on UPDATE only
--    the changed columns, old and new; on INSERT the new row and on DELETE
--    the old row (empty fields left out; the key and client are in their own
--    columns). Large JSON documents (GSTR-1 raw_json, version snapshots,
--    portal pulls) are kept as an md5, a size and the top-level keys that
--    changed, never whole; smaller JSON (the ITC Summary's data) as a list of
--    the leaves that changed ("section4A[5.1].igst: 1000 -> 1200").
--  * Filled by AFTER ... FOR EACH STATEMENT triggers with transition tables
--    (one INSERT ... SELECT per statement, not one per row), attached by
--    gst_change_log_attach() to every GST working table listed in section 6
--    (gst_change_log_tables lists them). History tables (twob_versions,
--    itc_versions, rcm_versions, the GSTR-1 / GSTR-3B upload and push logs,
--    gst_update_*versions, client_scheme_history,
--    builder_unit_classification_history, audit_log) are watched for UPDATE
--    and DELETE only, and a deleted one is kept whole: their inserts are
--    already the record. annual_return_docs and the Liberal switch already
--    have complete logs (annual_return_change_log, client_liberal_log); they
--    are not logged twice but shown with this one in gst_change_history.
--  * Who: the app sends x-gst-actor (the signed-in user's id), x-gst-source
--    (app / extension / agent) and x-gst-request on every /rest/v1 request
--    (src/integrations/supabase/client.ts; extension 0.17.0; the office
--    agent). PostgREST puts request headers in request.headers. Proven in
--    Chromium on 21 Oct 2026 against the live project: the API gateway's
--    preflight allows these headers on /rest/v1 (Edge Functions keep their
--    own list, so the app never sends them there). Without the header the
--    actor comes from the row's own stamp (updated_by, posted_by, ...;
--    actor_basis 'row') or stays unknown (DELETE; actor_basis 'none'). The
--    header is trusted as every p_actor_id in this database is: the app has
--    no auth session (CLAUDE.md).
--  * Append-only: the log is select-only to every API role (RLS SELECT for
--    public, no write grants) and a trigger refuses UPDATE and TRUNCATE for
--    every role and DELETE unless a future superadmin-run retention function
--    turns app.gst_change_log_retention on (none exists). A failure while
--    logging never blocks the save: the statement is logged as an error row
--    instead ("_error").
--  * manual_source_allowances (the superadmin's exceptions for a manual
--    upload) is created here with the shared DDL, byte for byte as in
--    20261021110000 (filing) and 20261021120000 (reco). Its guard and RPCs are
--    created here only when neither of those migrations made them (section 0):
--    the two branches' versions differ (return type, setting name), and the
--    lead reconciles them; this file must not be a third, conflicting copy.
--
-- Re-runnable. Changes no existing row. docs/GST_CHANGE_LOG.md.
--
-- ===========================================================================
-- Live apply (project gcquafqxbykxkbexcdpy ONLY; never SUPABASE_PROJECT_REF)
-- ===========================================================================
-- Order: 20261021110000 (filing) and 20261021120000 (reco) first, then this.
-- 1. Dry checks (SELECT only), note the numbers:
--      SELECT to_regclass('public.gst_change_log');                               -- NULL
--      SELECT to_regprocedure('public.staff_level_of(uuid)') IS NOT NULL;          -- true
--      SELECT current_setting('server_version_num')::int >= 150000;               -- true (17.6 on 21 Oct)
--      SELECT to_regclass('public.manual_source_allowances');                     -- the filing/reco table
--      SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'gst_change_log%';       -- 0
--      SELECT pg_size_pretty(pg_database_size(current_database()));                -- 137 MB on 21 Oct
--      SELECT count(*) FROM unnest(ARRAY['twob_import_docs','books_register','bills_not_in_2b',
--        'bills_not_in_books','itc_summaries','suspended_reco','gst_receivable_reco','filing_status',
--        'gstr1_data','clients']) t WHERE to_regclass('public.' || t) IS NOT NULL;  -- 10
--      Row counts to compare after: SELECT (SELECT count(*) FROM filing_status),
--        (SELECT count(*) FROM bills_not_in_books), (SELECT count(*) FROM twob_import_docs),
--        (SELECT count(*) FROM clients);  -- 21 Oct: 8195, 45024, 3559, 127
-- 2. Apply this file once (safe to apply again; a re-run re-attaches the
--    triggers and changes nothing else).
-- 3. After checks:
--      SELECT mode, count(*) FROM gst_change_log_tables GROUP BY 1;  -- full 91, history 11 (102)
--        (every table in section 6 exists live, manual_source_allowances once the
--         filing / reco migration or this one made it; a smaller number names a
--         missing table: SELECT table_name FROM gst_change_log_tables ORDER BY 1)
--      SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'gst_change_log_%' AND NOT tgisinternal;
--        -- 91*4 + 11*3 = 397, plus 2 on gst_change_log itself (399)
--      SELECT count(*) FROM gst_change_log;                         -- 0 until the first save
--      The row counts of step 1 unchanged.
--      SELECT has_table_privilege('anon', 'public.gst_change_log', 'SELECT'),        -- true
--             has_table_privilege('anon', 'public.gst_change_log', 'INSERT'),        -- false
--             has_table_privilege('anon', 'public.gst_change_log', 'DELETE'),        -- false
--             has_function_privilege('anon', 'public.gst_change_log_whoami()', 'execute'),  -- true
--             has_function_privilege('anon', 'public.gst_change_log_attach(text,text,text,text,text[],text[],text[],text,text)', 'execute'); -- false
--    With the anon key from .env (a read; the header reaches the database):
--      curl "$URL/rest/v1/rpc/gst_change_log_whoami" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
--        -H "x-gst-actor: <a staff user_id>" -H "x-gst-source: app" -H "x-gst-request: check-1"
--      -> {"actor_id": "<that id>", "actor_name": "<their first name>", "source": "app", "request_id": "check-1"}
--    and a refused delete (changes nothing):
--      curl -X DELETE "$URL/rest/v1/gst_change_log?id=eq.1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
--      -> 401/403 "permission denied for table gst_change_log"
--    After the app is deployed and someone saves anything:
--      SELECT actor_source, actor_basis, count(*) FROM gst_change_log GROUP BY 1, 2;
--      -- app / header for the app's saves; extension / header once 0.17.0 runs a pull
--      SELECT pg_size_pretty(pg_total_relation_size('public.gst_change_log'));    -- watch monthly
-- 4. Release the same day, in this order: this migration, the app (Vercel:
--    sends the headers; Change history page), extension 0.17.0 in every
--    office Chrome (chrome://extensions -> Reload from the updated folder;
--    sends x-gst-source: extension and the app user's id for jobs the app
--    started), the office agent (git pull, npm ci, restart the service; sends
--    x-gst-source: agent). Until each part is updated its writes are still
--    logged, with the actor from the row (actor_source 'unknown'). No Edge
--    Function changes. MIN_EXTENSION_VERSION is not raised: an older
--    extension still works and is still logged.

BEGIN;

-- ===========================================================================
-- 0. Manual-source allowances (shared DDL, byte-identical in every branch)
-- ===========================================================================
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

-- The guard and the two RPCs belong to the filing and reco migrations (applied
-- first). Only when this file runs on a database without them are they made
-- here, as the filing branch writes them, so the table is never left open to
-- direct writes.
DO $do$
BEGIN
  IF to_regprocedure('public.manual_source_allowances_guard()') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION public.manual_source_allowances_guard()
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
      $$ $f$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.manual_source_allowances'::regclass
                    AND tgname = 'trg_manual_source_allowances_guard') THEN
    CREATE TRIGGER trg_manual_source_allowances_guard
      BEFORE INSERT OR UPDATE OR DELETE ON public.manual_source_allowances
      FOR EACH ROW EXECUTE FUNCTION public.manual_source_allowances_guard();
  END IF;
  IF to_regprocedure('public.manual_source_allow(uuid,uuid,text,text,text)') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION public.manual_source_allow(
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
      $$ $f$;
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.manual_source_allow(uuid, uuid, text, text, text) TO anon, authenticated, service_role';
  END IF;
  IF to_regprocedure('public.manual_source_revoke(uuid,uuid)') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION public.manual_source_revoke(
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
      $$ $f$;
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.manual_source_revoke(uuid, uuid) TO anon, authenticated, service_role';
  END IF;
END
$do$;

-- ===========================================================================
-- 1. The log
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.gst_change_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL,
  row_id text,
  row_label text,
  client_id uuid,
  period_month text,
  financial_year text,
  op text NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  actor_id uuid,
  actor_name text,
  actor_source text NOT NULL CHECK (actor_source IN ('app', 'extension', 'agent', 'system', 'unknown')),
  actor_basis text NOT NULL CHECK (actor_basis IN ('header', 'row', 'none')),
  changed jsonb NOT NULL,
  request_id text,
  txid bigint NOT NULL DEFAULT txid_current()
);
COMMENT ON TABLE public.gst_change_log IS
  'Every change to the GST working tables (gst_change_log_tables), append-only. 20261021130000_gst_change_log.sql, docs/GST_CHANGE_LOG.md.';

CREATE INDEX IF NOT EXISTS gst_change_log_client_month_at ON public.gst_change_log (client_id, period_month, at DESC);
CREATE INDEX IF NOT EXISTS gst_change_log_table_row ON public.gst_change_log (table_name, row_id);
CREATE INDEX IF NOT EXISTS gst_change_log_at_brin ON public.gst_change_log USING brin (at);

ALTER TABLE public.gst_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gst_change_log_read ON public.gst_change_log;
CREATE POLICY gst_change_log_read ON public.gst_change_log FOR SELECT TO public USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.gst_change_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.gst_change_log TO anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.gst_change_log_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- Which tables are logged, and how (written only by gst_change_log_attach).
CREATE TABLE IF NOT EXISTS public.gst_change_log_tables (
  table_name text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('full', 'history')),
  client_expr text NOT NULL,
  month_expr text NOT NULL,
  fy_expr text NOT NULL,
  label_expr text NOT NULL,
  key_columns text[] NOT NULL,
  actor_columns text[] NOT NULL,
  summary_columns text[] NOT NULL,
  skip_columns text[] NOT NULL,
  only_columns text[],
  attached_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gst_change_log_tables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gst_change_log_tables_read ON public.gst_change_log_tables;
CREATE POLICY gst_change_log_tables_read ON public.gst_change_log_tables FOR SELECT TO public USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.gst_change_log_tables FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.gst_change_log_tables TO anon, authenticated, service_role;

-- ===========================================================================
-- 2. Append-only
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.gst_change_log_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND COALESCE(current_setting('app.gst_change_log_retention', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'The change history cannot be changed or deleted.' USING ERRCODE = 'insufficient_privilege';
END;
$$;
DROP TRIGGER IF EXISTS gst_change_log_guard ON public.gst_change_log;
CREATE TRIGGER gst_change_log_guard
  BEFORE UPDATE OR DELETE ON public.gst_change_log
  FOR EACH ROW EXECUTE FUNCTION public.gst_change_log_guard();
DROP TRIGGER IF EXISTS gst_change_log_guard_truncate ON public.gst_change_log;
CREATE TRIGGER gst_change_log_guard_truncate
  BEFORE TRUNCATE ON public.gst_change_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.gst_change_log_guard();

-- ===========================================================================
-- 3. Who, from where, which request
-- ===========================================================================
-- The headers PostgREST put in request.headers: x-gst-actor (a user id),
-- x-gst-source (app / extension / agent), x-gst-request. No headers at all is
-- a direct database session (migration, pg_cron, SQL editor): 'system'; the
-- service_role key (Edge Functions): 'system'; the public key without the
-- header (an old tab, an old extension): 'unknown'.
CREATE OR REPLACE FUNCTION public.gst_change_log_context(
  OUT actor uuid, OUT actor_name text, OUT source text, OUT request text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  h json;
  v_claims json;
  v_actor text;
  v_source text;
BEGIN
  BEGIN
    h := NULLIF(current_setting('request.headers', true), '')::json;
  EXCEPTION WHEN others THEN
    h := NULL;
  END;
  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::json;
  EXCEPTION WHEN others THEN
    v_claims := NULL;
  END;
  v_actor := btrim(h ->> 'x-gst-actor');
  IF v_actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    actor := v_actor::uuid;
    actor_name := public.gst_change_log_actor_name(actor);
  END IF;
  v_source := lower(btrim(h ->> 'x-gst-source'));
  source := CASE
    WHEN v_source IN ('app', 'extension', 'agent') THEN v_source
    WHEN (v_claims ->> 'role') = 'service_role' THEN 'system'
    WHEN h IS NULL AND v_claims IS NULL THEN 'system'
    ELSE 'unknown'
  END;
  request := left(COALESCE(NULLIF(btrim(h ->> 'x-gst-request'), ''), h ->> 'sb-request-id', h ->> 'x-request-id', h ->> 'cf-ray'), 80);
END;
$$;

-- A staff member's first name, or a client's name for the client portal.
CREATE OR REPLACE FUNCTION public.gst_change_log_actor_name(p_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.first_name FROM public.profiles p WHERE p.user_id = p_id LIMIT 1),
    (SELECT c.name || ' (client)' FROM public.clients c WHERE c.id = p_id))
$$;

-- What this database sees of the caller (for the live check and the Change
-- history page's "your changes are recorded as" line). Reads only.
CREATE OR REPLACE FUNCTION public.gst_change_log_whoami()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('actor_id', c.actor, 'actor_name', c.actor_name, 'source', c.source, 'request_id', c.request)
    FROM public.gst_change_log_context() c
$$;

-- ===========================================================================
-- 4. What changed
-- ===========================================================================
-- A return period as MM/YYYY, from the spellings the tables use: MM/YYYY,
-- Mon-YY (GSTR-1, RCM, the update sheet), Mon-YYYY, YYYY-MM(-DD), MMYYYY.
CREATE OR REPLACE FUNCTION public.gst_change_log_month(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text := btrim(p);
  m int;
  y int;
BEGIN
  IF s IS NULL OR s = '' THEN RETURN NULL; END IF;
  IF s ~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN RETURN s; END IF;
  IF s ~ '^[0-9]{4}-(0[1-9]|1[0-2])($|-)' THEN RETURN substr(s, 6, 2) || '/' || substr(s, 1, 4); END IF;
  IF s ~ '^(0[1-9]|1[0-2])[-]?[0-9]{4}$' THEN RETURN substr(s, 1, 2) || '/' || right(s, 4); END IF;
  IF s ~* '^[a-z]{3}[a-z]*[- ]?[0-9]{2}([0-9]{2})?$' THEN
    m := array_position(ARRAY['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'], lower(substr(s, 1, 3)));
    IF m IS NULL THEN RETURN NULL; END IF;
    y := substring(s from '[0-9]+$')::int;
    IF y < 100 THEN y := 2000 + y; END IF;
    RETURN lpad(m::text, 2, '0') || '/' || y::text;
  END IF;
  RETURN NULL;
END;
$$;

-- A JSON value kept as a fingerprint: md5, size, and how many keys or items.
CREATE OR REPLACE FUNCTION public.gst_change_log_digest(v jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN NULL ELSE
    jsonb_strip_nulls(jsonb_build_object(
      'summary', true,
      'md5', md5(t.s),
      'bytes', octet_length(t.s),
      'keys', CASE WHEN jsonb_typeof(v) = 'object' THEN (SELECT count(*) FROM jsonb_object_keys(v)) END,
      'items', CASE WHEN jsonb_typeof(v) = 'array' THEN jsonb_array_length(v) END))
  END
  FROM (SELECT v::text AS s) t
$$;

-- An array element's name in a path: its srNo / label / key ..., else its index.
CREATE OR REPLACE FUNCTION public.gst_change_log_label(e jsonb, i int)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    CASE WHEN jsonb_typeof(e) = 'object' THEN
      left(NULLIF(btrim(COALESCE(e ->> 'srNo', e ->> 'sr_no', e ->> 'key', e ->> 'label', e ->> 'particular', e ->> 'name')), ''), 40)
    END,
    i::text)
$$;

-- The leaves that differ between two JSON values: {path, old, new}.
CREATE OR REPLACE FUNCTION public.gst_change_log_walk(o jsonb, n jsonb, p text)
RETURNS SETOF jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  k text;
  i int;
  len int;
BEGIN
  IF o IS NOT DISTINCT FROM n THEN RETURN; END IF;
  IF jsonb_typeof(o) = 'object' AND jsonb_typeof(n) = 'object' THEN
    FOR k IN SELECT x FROM (SELECT jsonb_object_keys(o) AS x UNION SELECT jsonb_object_keys(n)) z ORDER BY x LOOP
      IF (o -> k) IS DISTINCT FROM (n -> k) THEN
        RETURN QUERY SELECT public.gst_change_log_walk(o -> k, n -> k, CASE WHEN p = '' THEN k ELSE p || '.' || k END);
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(o) = 'array' AND jsonb_typeof(n) = 'array' THEN
    len := greatest(jsonb_array_length(o), jsonb_array_length(n));
    FOR i IN 0 .. len - 1 LOOP
      IF (o -> i) IS DISTINCT FROM (n -> i) THEN
        RETURN QUERY SELECT public.gst_change_log_walk(o -> i, n -> i,
          p || '[' || public.gst_change_log_label(COALESCE(n -> i, o -> i), i) || ']');
      END IF;
    END LOOP;
  ELSE
    RETURN NEXT jsonb_build_object('path', p, 'old', o, 'new', n);
  END IF;
END;
$$;

-- How one JSON column changed: the leaves (up to 100) or, for a large or
-- named-large column, the fingerprints and the top-level keys that changed.
CREATE OR REPLACE FUNCTION public.gst_change_log_json_change(o jsonb, n jsonb, p_summary boolean)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_changes jsonb;
  v_count int;
BEGIN
  IF p_summary OR COALESCE(pg_column_size(o), 0) > 65536 OR COALESCE(pg_column_size(n), 0) > 65536 THEN
    RETURN jsonb_build_object(
      'summary', true,
      'old', public.gst_change_log_digest(o),
      'new', public.gst_change_log_digest(n),
      'keys_changed', CASE WHEN jsonb_typeof(o) = 'object' AND jsonb_typeof(n) = 'object' THEN
        (SELECT COALESCE(jsonb_agg(z.k ORDER BY z.k), '[]'::jsonb)
           FROM (SELECT jsonb_object_keys(o) AS k UNION SELECT jsonb_object_keys(n)) z
          WHERE (o -> z.k) IS DISTINCT FROM (n -> z.k)) END);
  END IF;
  SELECT jsonb_agg(w.x), count(*) INTO v_changes, v_count
    FROM (SELECT x FROM public.gst_change_log_walk(o, n, '') x LIMIT 101) w;
  IF v_count > 100 THEN
    v_changes := v_changes - 100;
  END IF;
  RETURN jsonb_build_object('changes', COALESCE(v_changes, '[]'::jsonb), 'more', v_count > 100);
END;
$$;

-- An UPDATE's changed columns: {column: {old, new}} (JSON columns as above).
-- NULL when nothing but skipped columns changed.
CREATE OR REPLACE FUNCTION public.gst_change_log_diff(o jsonb, n jsonb, p_summary text[], p_skip text[], p_only text[])
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_object_agg(e.key, CASE
           WHEN jsonb_typeof(o -> e.key) IN ('object', 'array') OR jsonb_typeof(e.value) IN ('object', 'array')
             THEN public.gst_change_log_json_change(o -> e.key, e.value, e.key = ANY (p_summary))
           ELSE jsonb_build_object('old', o -> e.key, 'new', e.value)
         END)
    FROM jsonb_each(n) e
   WHERE (o -> e.key) IS DISTINCT FROM e.value
     AND NOT (e.key = ANY (p_skip))
     AND (p_only IS NULL OR e.key = ANY (p_only))
$$;

-- An inserted or deleted row: its filled columns (the key and client are in
-- the log's own columns); large JSON as a fingerprint unless p_keep_full.
CREATE OR REPLACE FUNCTION public.gst_change_log_row(r jsonb, p_summary text[], p_hide text[], p_only text[], p_keep_full boolean)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(jsonb_object_agg(e.key, CASE
           WHEN NOT p_keep_full AND (e.key = ANY (p_summary)
                OR (jsonb_typeof(e.value) IN ('object', 'array') AND pg_column_size(e.value) > 65536))
             THEN public.gst_change_log_digest(e.value)
           ELSE e.value
         END), '{}'::jsonb)
    FROM jsonb_each(r) e
   WHERE jsonb_typeof(e.value) <> 'null'
     AND NOT (e.key = ANY (p_hide))
     AND (p_only IS NULL OR e.key = ANY (p_only))
$$;

-- The client of a row that has no client_id of its own (builder tables, the
-- update sheet's row versions).
CREATE OR REPLACE FUNCTION public.gst_change_log_client_of(p_kind text, p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v uuid;
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;
  CASE p_kind
    WHEN 'project' THEN
      SELECT client_id INTO v FROM public.builder_projects WHERE id = p_id;
    WHEN 'unit' THEN
      SELECT p.client_id INTO v FROM public.builder_units u JOIN public.builder_projects p ON p.id = u.project_id WHERE u.id = p_id;
    WHEN 'booking' THEN
      SELECT p.client_id INTO v FROM public.builder_bookings b JOIN public.builder_units u ON u.id = b.unit_id
        JOIN public.builder_projects p ON p.id = u.project_id WHERE b.id = p_id;
    WHEN 'receipt' THEN
      SELECT p.client_id INTO v FROM public.builder_receipts r JOIN public.builder_units u ON u.id = r.unit_id
        JOIN public.builder_projects p ON p.id = u.project_id WHERE r.id = p_id;
    WHEN 'bounce_reversal' THEN
      SELECT p.client_id INTO v FROM public.builder_bounce_reversals b JOIN public.builder_projects p ON p.id = b.project_id WHERE b.id = p_id;
    WHEN 'reclassification' THEN
      SELECT p.client_id INTO v FROM public.builder_reclassifications x JOIN public.builder_units u ON u.id = x.unit_id
        JOIN public.builder_projects p ON p.id = u.project_id WHERE x.id = p_id;
    WHEN 'cancellation' THEN
      SELECT p.client_id INTO v FROM public.builder_cancellations c JOIN public.builder_projects p ON p.id = c.project_id WHERE c.id = p_id;
    WHEN 'itc_reversal_working' THEN
      SELECT client_id INTO v FROM public.builder_itc_reversal_workings WHERE id = p_id;
    WHEN 'running_update' THEN
      SELECT client_id INTO v FROM public.gst_running_updates WHERE id = p_id;
    ELSE
      v := NULL;
  END CASE;
  RETURN v;
END;
$$;

-- ===========================================================================
-- 5. The trigger
-- ===========================================================================
-- One function for every logged table; its arguments (set by
-- gst_change_log_attach) say how to read the table:
--   0 client expression, 1 month expression, 2 financial year expression
--   (SQL on the row, alias r), 3 key columns, 4 actor columns (uuid, in order
--   of preference), 5 JSON columns kept as fingerprints, 6 columns never
--   compared on UPDATE, 7 the only columns logged ('' = all), 8 mode
--   ('full', or 'history': a deleted row kept whole), 9 the row's name for
--   people (e.g. supplier and invoice number, the return type).
CREATE OR REPLACE FUNCTION public.gst_change_log_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_client text := TG_ARGV[0];
  c_month text := TG_ARGV[1];
  c_fy text := TG_ARGV[2];
  c_key text[] := string_to_array(TG_ARGV[3], ',');
  c_actor text[] := COALESCE(string_to_array(NULLIF(TG_ARGV[4], ''), ','), '{}');
  c_summary text[] := COALESCE(string_to_array(NULLIF(TG_ARGV[5], ''), ','), '{}');
  c_skip text[] := COALESCE(string_to_array(NULLIF(TG_ARGV[6], ''), ','), '{}');
  c_only text[] := string_to_array(NULLIF(TG_ARGV[7], ''), ',');
  c_mode text := COALESCE(NULLIF(TG_ARGV[8], ''), 'full');
  c_label text := COALESCE(NULLIF(TG_ARGV[9], ''), 'NULL');
  v_ctx record;
  v_hide text[];
  v_key_r text;
  v_key_o text;
  v_join text;
  v_actor_ins text;
  v_actor_upd text;
  v_sql text;
  v_err text;
  col text;
BEGIN
  SELECT * INTO v_ctx FROM public.gst_change_log_context();
  -- The row image leaves out what the log's own columns already hold.
  v_hide := c_key || ARRAY['client_id'];
  v_key_r := 'concat_ws(''|'', ' || (SELECT string_agg('r.' || quote_ident(k) || '::text', ', ') FROM unnest(c_key) k) || ')';
  v_key_o := 'concat_ws(''|'', ' || (SELECT string_agg('o.' || quote_ident(k) || '::text', ', ') FROM unnest(c_key) k) || ')';
  v_join := (SELECT string_agg('o.' || quote_ident(k) || ' = r.' || quote_ident(k), ' AND ') FROM unnest(c_key) k);
  v_actor_ins := 'NULL::uuid';
  v_actor_upd := 'NULL::uuid';
  IF cardinality(c_actor) > 0 THEN
    v_actor_ins := (SELECT string_agg('r.' || quote_ident(a), ', ') FROM unnest(c_actor) a);
    v_actor_upd := '';
    FOREACH col IN ARRAY c_actor LOOP
      v_actor_upd := v_actor_upd || format('CASE WHEN r.%1$I IS DISTINCT FROM o.%1$I THEN r.%1$I END, ', col);
    END LOOP;
    v_actor_upd := v_actor_upd || v_actor_ins;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_sql := format($q$
      INSERT INTO public.gst_change_log
        (table_name, row_id, row_label, client_id, period_month, financial_year, op, actor_id, actor_name, actor_source, actor_basis, changed, request_id)
      SELECT %1$L, %2$s, left((%7$s)::text, 120), %3$s, public.gst_change_log_month((%4$s)::text), (%5$s)::text, 'INSERT',
             a.id, COALESCE($2, public.gst_change_log_actor_name(a.id)), $3,
             CASE WHEN $1 IS NOT NULL THEN 'header' WHEN a.id IS NOT NULL THEN 'row' ELSE 'none' END,
             public.gst_change_log_row(to_jsonb(r), $5, $6, $7, false), $4
        FROM gst_cl_new r
        CROSS JOIN LATERAL (SELECT COALESCE($1, %6$s) AS id) a
    $q$, TG_TABLE_NAME, v_key_r, c_client, c_month, c_fy, v_actor_ins, c_label);
  ELSIF TG_OP = 'UPDATE' THEN
    v_sql := format($q$
      INSERT INTO public.gst_change_log
        (table_name, row_id, row_label, client_id, period_month, financial_year, op, actor_id, actor_name, actor_source, actor_basis, changed, request_id)
      SELECT %1$L, COALESCE(%2$s, %3$s), left((%9$s)::text, 120), %4$s, public.gst_change_log_month((%5$s)::text), (%6$s)::text, 'UPDATE',
             a.id, COALESCE($2, public.gst_change_log_actor_name(a.id)), $3,
             CASE WHEN $1 IS NOT NULL THEN 'header' WHEN a.id IS NOT NULL THEN 'row' ELSE 'none' END,
             d.changed, $4
        FROM gst_cl_new r
        FULL JOIN gst_cl_old o ON %7$s
        CROSS JOIN LATERAL (SELECT CASE
            WHEN o IS NULL OR r IS NULL THEN jsonb_build_object('_key_changed', true,
              'old', public.gst_change_log_row(to_jsonb(o), $5, '{}', $7, false),
              'new', public.gst_change_log_row(to_jsonb(r), $5, '{}', $7, false))
            ELSE public.gst_change_log_diff(to_jsonb(o), to_jsonb(r), $5, $8, $7) END AS changed) d
        CROSS JOIN LATERAL (SELECT COALESCE($1, %8$s) AS id) a
       WHERE d.changed IS NOT NULL
    $q$, TG_TABLE_NAME, v_key_r, v_key_o, c_client, c_month, c_fy, v_join, v_actor_upd, c_label);
  ELSE
    v_sql := format($q$
      INSERT INTO public.gst_change_log
        (table_name, row_id, row_label, client_id, period_month, financial_year, op, actor_id, actor_name, actor_source, actor_basis, changed, request_id)
      SELECT %1$L, %2$s, left((%7$s)::text, 120), %3$s, public.gst_change_log_month((%4$s)::text), (%5$s)::text, 'DELETE',
             $1, $2, $3, CASE WHEN $1 IS NOT NULL THEN 'header' ELSE 'none' END,
             public.gst_change_log_row(to_jsonb(r), $5, $6, $7, %6$L = 'history'), $4
        FROM gst_cl_old r
    $q$, TG_TABLE_NAME, v_key_r, c_client, c_month, c_fy, c_mode, c_label);
  END IF;

  BEGIN
    EXECUTE v_sql USING v_ctx.actor, v_ctx.actor_name, v_ctx.source, v_ctx.request,
      c_summary, v_hide, c_only, c_skip || ARRAY['updated_at'];
  EXCEPTION WHEN others THEN
    -- Never block the save: record that this statement could not be logged.
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    INSERT INTO public.gst_change_log (table_name, op, actor_id, actor_name, actor_source, actor_basis, changed, request_id)
    VALUES (TG_TABLE_NAME, TG_OP, v_ctx.actor, v_ctx.actor_name, v_ctx.source,
            CASE WHEN v_ctx.actor IS NOT NULL THEN 'header' ELSE 'none' END,
            jsonb_build_object('_error', left(v_err, 500)), v_ctx.request);
  END;
  RETURN NULL;
END;
$$;

-- TRUNCATE skips the row triggers: record that it happened and how many rows went.
CREATE OR REPLACE FUNCTION public.gst_change_log_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
  v_rows bigint;
BEGIN
  SELECT * INTO v_ctx FROM public.gst_change_log_context();
  EXECUTE format('SELECT count(*) FROM %I.%I', TG_TABLE_SCHEMA, TG_TABLE_NAME) INTO v_rows;
  INSERT INTO public.gst_change_log (table_name, op, actor_id, actor_name, actor_source, actor_basis, changed, request_id)
  VALUES (TG_TABLE_NAME, 'TRUNCATE', v_ctx.actor, v_ctx.actor_name, v_ctx.source,
          CASE WHEN v_ctx.actor IS NOT NULL THEN 'header' ELSE 'none' END,
          jsonb_build_object('rows', v_rows), v_ctx.request);
  RETURN NULL;
END;
$$;

-- Attaches the logger to one table (re-runnable; a table that does not
-- exist is skipped). Expressions are checked against the table here, so a
-- wrong column fails the migration, never a save.
CREATE OR REPLACE FUNCTION public.gst_change_log_attach(
  p_table text,
  p_client text DEFAULT 'r.client_id',
  p_month text DEFAULT 'r.period_month',
  p_fy text DEFAULT 'NULL',
  p_summary text[] DEFAULT '{}',
  p_skip text[] DEFAULT '{}',
  p_only text[] DEFAULT NULL,
  p_mode text DEFAULT 'full',
  p_label text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rel regclass := to_regclass('public.' || quote_ident(p_table));
  v_key text[];
  v_actor text[];
  v_args text;
  v_bad text;
  v_label text := p_label;
BEGIN
  IF v_rel IS NULL THEN
    RETURN p_table || ': missing, skipped';
  END IF;
  IF p_mode NOT IN ('full', 'history') THEN
    RAISE EXCEPTION 'gst_change_log_attach(%): mode must be full or history', p_table;
  END IF;
  SELECT array_agg(a.attname::text ORDER BY array_position(i.indkey::int2[], a.attnum))
    INTO v_key
    FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
   WHERE i.indrelid = v_rel AND i.indisprimary;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'gst_change_log_attach(%): the table has no primary key', p_table;
  END IF;
  -- Who: the first of these uuid columns the row has (on UPDATE, one that changed first).
  SELECT COALESCE(array_agg(k.c ORDER BY k.ord), '{}')
    INTO v_actor
    FROM unnest(ARRAY[
      'updated_by', 'last_uploaded_by', 'last_push_by', 'posted_by', 'decided_by', 'approved_by',
      'overridden_by', 'revoked_by', 'used_by', 'reversed_by', 'submitted_by', 'received_by',
      'drc03_filed_by', 'verified_by', 'reviewed_by', 'opening_override_by', 'opening_csv_uploaded_by',
      'opening_portal_pulled_by', 'liberal_changed_by', 'imported_by', 'pulled_by', 'uploaded_by',
      'created_by', 'entered_by', 'requested_by', 'allowed_by', 'actor_id', 'changed_by',
      'changed_by_employee_id']) WITH ORDINALITY k(c, ord)
   WHERE EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_rel AND a.attname = k.c
                    AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype);
  SELECT string_agg(x, ', ') INTO v_bad
    FROM unnest(p_summary || p_skip || COALESCE(p_only, '{}')) x
   WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_rel AND a.attname = x AND a.attnum > 0 AND NOT a.attisdropped);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'gst_change_log_attach(%): no column %', p_table, v_bad;
  END IF;
  -- The row's name for people: the first two of these columns the table has.
  IF v_label IS NULL THEN
    SELECT 'concat_ws('' · '', ' || string_agg('r.' || quote_ident(k.c) || '::text', ', ' ORDER BY k.ord) || ')'
      INTO v_label
      FROM (SELECT c, ord FROM unnest(ARRAY[
              'return_type', 'supplier_name', 'supplier_invoice_number', 'doc_no', 'receipt_no', 'invoice_no',
              'bill_ref', 'unit_no', 'name', 'gstin', 'section', 'table_type', 'category', 'expense_name',
              'ledger_head', 'line_key', 'scope', 'particulars', 'field_name', 'cpin', 'description', 'version_number'])
              WITH ORDINALITY x(c, ord)
             WHERE EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_rel AND a.attname = x.c AND a.attnum > 0 AND NOT a.attisdropped)
               AND (p_only IS NULL OR x.c = ANY (p_only))
             ORDER BY ord LIMIT 2) k;
    v_label := COALESCE(v_label, 'NULL');
  END IF;
  EXECUTE format('SELECT (%s)::uuid, public.gst_change_log_month((%s)::text), (%s)::text, (%s)::text FROM public.%I r LIMIT 0',
                 p_client, p_month, p_fy, v_label, p_table);

  v_args := format('%L, %L, %L, %L, %L, %L, %L, %L, %L, %L',
    p_client, p_month, p_fy, array_to_string(v_key, ','), array_to_string(v_actor, ','),
    array_to_string(p_summary, ','), array_to_string(p_skip, ','), COALESCE(array_to_string(p_only, ','), ''), p_mode, v_label);

  EXECUTE format('DROP TRIGGER IF EXISTS gst_change_log_ins ON public.%I', p_table);
  EXECUTE format('DROP TRIGGER IF EXISTS gst_change_log_upd ON public.%I', p_table);
  EXECUTE format('DROP TRIGGER IF EXISTS gst_change_log_del ON public.%I', p_table);
  EXECUTE format('DROP TRIGGER IF EXISTS gst_change_log_trunc ON public.%I', p_table);
  IF p_mode = 'full' THEN
    EXECUTE format('CREATE TRIGGER gst_change_log_ins AFTER INSERT ON public.%I REFERENCING NEW TABLE AS gst_cl_new '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.gst_change_log_capture(%s)', p_table, v_args);
  END IF;
  EXECUTE format('CREATE TRIGGER gst_change_log_upd AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS gst_cl_old NEW TABLE AS gst_cl_new '
                 'FOR EACH STATEMENT EXECUTE FUNCTION public.gst_change_log_capture(%s)', p_table, v_args);
  EXECUTE format('CREATE TRIGGER gst_change_log_del AFTER DELETE ON public.%I REFERENCING OLD TABLE AS gst_cl_old '
                 'FOR EACH STATEMENT EXECUTE FUNCTION public.gst_change_log_capture(%s)', p_table, v_args);
  EXECUTE format('CREATE TRIGGER gst_change_log_trunc BEFORE TRUNCATE ON public.%I '
                 'FOR EACH STATEMENT EXECUTE FUNCTION public.gst_change_log_truncate()', p_table);

  INSERT INTO public.gst_change_log_tables
    (table_name, mode, client_expr, month_expr, fy_expr, label_expr, key_columns, actor_columns, summary_columns, skip_columns, only_columns, attached_at)
  VALUES (p_table, p_mode, p_client, p_month, p_fy, v_label, v_key, v_actor, p_summary, p_skip, p_only, now())
  ON CONFLICT (table_name) DO UPDATE SET
    mode = EXCLUDED.mode, client_expr = EXCLUDED.client_expr, month_expr = EXCLUDED.month_expr,
    fy_expr = EXCLUDED.fy_expr, label_expr = EXCLUDED.label_expr, key_columns = EXCLUDED.key_columns, actor_columns = EXCLUDED.actor_columns,
    summary_columns = EXCLUDED.summary_columns, skip_columns = EXCLUDED.skip_columns,
    only_columns = EXCLUDED.only_columns, attached_at = EXCLUDED.attached_at;
  RETURN p_table || ': ' || p_mode;
END;
$$;

REVOKE ALL ON FUNCTION public.gst_change_log_attach(text, text, text, text, text[], text[], text[], text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.gst_change_log_client_of(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gst_change_log_actor_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gst_change_log_context() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gst_change_log_whoami() TO anon, authenticated, service_role;

-- ===========================================================================
-- 6. The tables
-- ===========================================================================
DO $attach$
DECLARE
  r text;
BEGIN
  FOR r IN
    -- Import 2B, 2B Reconciliation, ITC, recos
    SELECT public.gst_change_log_attach('twob_import_docs')
    UNION ALL SELECT public.gst_change_log_attach('books_register')
    UNION ALL SELECT public.gst_change_log_attach('bills_not_in_2b')
    UNION ALL SELECT public.gst_change_log_attach('bills_not_in_books')
    UNION ALL SELECT public.gst_change_log_attach('itc_summaries', p_summary => '{edit_history}')
    UNION ALL SELECT public.gst_change_log_attach('suspended_reco')
    UNION ALL SELECT public.gst_change_log_attach('gst_receivable_reco')
    -- Filing, GSTR-1, GSTR-3B
    UNION ALL SELECT public.gst_change_log_attach('filing_status')
    UNION ALL SELECT public.gst_change_log_attach('gstr1_data', p_summary => '{raw_json,last_upload_errors}')
    UNION ALL SELECT public.gst_change_log_attach('gstr1_manual_entries')
    UNION ALL SELECT public.gst_change_log_attach('gstr1_direct_filing_approvals')
    UNION ALL SELECT public.gst_change_log_attach('gstr3b_adjustments')
    -- RCM, GST Running Update
    UNION ALL SELECT public.gst_change_log_attach('rcm_data', p_month => 'r.month', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('rcm_masters', p_client => 'NULL', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('gst_running_updates', p_month => 'COALESCE(r.update_effect_month, r.effect_month)')
    -- Advances, works contracts
    UNION ALL SELECT public.gst_change_log_attach('advance_receipts')
    UNION ALL SELECT public.gst_change_log_attach('advance_adjustments')
    UNION ALL SELECT public.gst_change_log_attach('advance_opening_balances', p_month => 'r.as_on_period')
    UNION ALL SELECT public.gst_change_log_attach('advance_setoff_overrides')
    UNION ALL SELECT public.gst_change_log_attach('contract_projects', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('contract_ra_bills')
    -- Client masters: the GST fields only (never the passwords; the Liberal
    -- switch has its own log, client_liberal_log)
    UNION ALL SELECT public.gst_change_log_attach('clients', p_client => 'r.id', p_month => 'NULL',
      p_only => '{gstin,name,registration_type,registration_date,selected_returns,assigned_accountant,cancellation_date,registration_cancellation_date,regular_sub_type,builder_itc_type,commercial_area,residential_area,target_date_group1,target_date_group2,inactive_at_hand,gstr1_import_mode,notices_handled,notices_tracks_off,einvoice_applicable,einvoice_exemption,gst_user_id,gst_password_changed_at}')
    UNION ALL SELECT public.gst_change_log_attach('client_annual_turnover', p_month => 'NULL', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('manual_source_allowances')
    -- Portal pulls
    UNION ALL SELECT public.gst_change_log_attach('gst_credit_ledger_transactions')
    UNION ALL SELECT public.gst_change_log_attach('gst_cash_ledger_entries')
    UNION ALL SELECT public.gst_change_log_attach('gst_liability_ledger_entries')
    UNION ALL SELECT public.gst_change_log_attach('gst_credit_reversal_reclaim_entries', p_month => 'r.return_period', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('gst_rcm_liability_itc_entries', p_month => 'r.return_period', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('gst_filed_returns', p_summary => '{full_json}')
    UNION ALL SELECT public.gst_change_log_attach('einvoice_docs', p_summary => '{raw}', p_skip => '{last_seen_at}')
    UNION ALL SELECT public.gst_change_log_attach('gstr2a_import_docs')
    UNION ALL SELECT public.gst_change_log_attach('gst_challans', p_month => 'r.challan_date')
    UNION ALL SELECT public.gst_change_log_attach('gst_taxpayer_profile', p_month => 'NULL', p_summary => '{profile_json}')
    UNION ALL SELECT public.gst_change_log_attach('portal_gstr1_category_figures', p_month => 'NULL', p_fy => 'r.financial_year')
    -- Annual return inputs by financial year (annual_return_docs has its own log)
    UNION ALL SELECT public.gst_change_log_attach('annual_return_bs_pl_uploads', p_month => 'NULL', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('annual_return_carry_forward', p_month => 'NULL', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('reconciliation_reasons', p_month => 'NULL', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('expense_head_mappings', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('itc_reversal_lines', p_month => 'NULL', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('duties_taxes_input_monthly', p_month => 'r.month', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('duties_taxes_output_monthly', p_month => 'r.month', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('books_purchase_lines', p_month => 'NULL', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('books_turnover_lines', p_month => 'NULL', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('pl_input_lines', p_month => 'NULL', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('pl_output_lines', p_month => 'NULL', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('annexure3_other_payments', p_month => 'NULL', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('rcm_annual_return_lines', p_month => 'r.month', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('portal_tax_payment_entries', p_month => 'NULL', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach('gstr9_output_lines', p_month => 'NULL', p_fy => 'r.financial_year')
    UNION ALL SELECT public.gst_change_log_attach(t, p_month => 'NULL', p_fy => 'r.financial_year')
      FROM unnest(ARRAY['gstr9_table14_differential_tax', 'gstr9_table15_demands_refunds',
        'gstr9_table16_composition_deemed_approval', 'gstr9c_certification', 'gstr9c_part_v_additional_liability',
        'gstr9c_table11_additional_liability', 'gstr9c_table12_net_itc', 'gstr9c_table16_tax_payable_unreconciled_itc',
        'gstr9c_table5_turnover_reco', 'gstr9c_table7_taxable_turnover_reco', 'gstr9c_table9_rate_wise_liability_reco']) t
    -- Builder (client through the project or unit)
    UNION ALL SELECT public.gst_change_log_attach('builder_projects', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('builder_client_settings', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('builder_project_groups', p_client => 'public.gst_change_log_client_of(''project'', r.project_id)', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('builder_units', p_client => 'public.gst_change_log_client_of(''project'', r.project_id)', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('builder_unit_charges', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('builder_bookings', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('builder_booking_members', p_client => 'public.gst_change_log_client_of(''booking'', r.booking_id)', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('builder_receipts', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)')
    UNION ALL SELECT public.gst_change_log_attach('builder_invoices', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)')
    UNION ALL SELECT public.gst_change_log_attach('builder_credit_notes', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)')
    UNION ALL SELECT public.gst_change_log_attach('builder_advance_adjustments', p_client => 'public.gst_change_log_client_of(''receipt'', r.receipt_id)')
    UNION ALL SELECT public.gst_change_log_attach('builder_opening_balances', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('builder_opening_balance_adjustments', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)')
    UNION ALL SELECT public.gst_change_log_attach('builder_historical_receipts', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)', p_month => 'r.receipt_date')
    UNION ALL SELECT public.gst_change_log_attach('builder_bu_events', p_client => 'public.gst_change_log_client_of(''project'', r.project_id)', p_month => 'r.posting_period')
    UNION ALL SELECT public.gst_change_log_attach('builder_bu_event_units', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('builder_bu_agreement_confirmations', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('builder_cancellations', p_client => 'public.gst_change_log_client_of(''project'', r.project_id)', p_month => 'r.cancellation_date')
    UNION ALL SELECT public.gst_change_log_attach('builder_refund_payments', p_client => 'public.gst_change_log_client_of(''cancellation'', r.cancellation_id)')
    UNION ALL SELECT public.gst_change_log_attach('builder_conversions', p_client => 'public.gst_change_log_client_of(''unit'', r.from_unit_id)')
    UNION ALL SELECT public.gst_change_log_attach('builder_bounce_reversals', p_client => 'public.gst_change_log_client_of(''project'', r.project_id)', p_month => 'r.original_period')
    UNION ALL SELECT public.gst_change_log_attach('builder_bounce_offsets', p_client => 'public.gst_change_log_client_of(''bounce_reversal'', r.reversal_id)')
    UNION ALL SELECT public.gst_change_log_attach('builder_excess_tax', p_client => 'public.gst_change_log_client_of(''project'', r.project_id)', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('builder_reclassifications', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)', p_month => 'r.posting_period')
    UNION ALL SELECT public.gst_change_log_attach('builder_reclassification_periods', p_client => 'public.gst_change_log_client_of(''reclassification'', r.reclassification_id)')
    UNION ALL SELECT public.gst_change_log_attach('builder_dastavej_late_interest', p_client => 'public.gst_change_log_client_of(''project'', r.project_id)', p_month => 'r.cut_off_period')
    UNION ALL SELECT public.gst_change_log_attach('builder_fsi_workings', p_client => 'public.gst_change_log_client_of(''project'', r.project_id)')
    UNION ALL SELECT public.gst_change_log_attach('builder_fsi_consents')
    UNION ALL SELECT public.gst_change_log_attach('builder_itc_reversal_workings', p_month => 'r.posting_period')
    UNION ALL SELECT public.gst_change_log_attach('builder_itc_reversal_years', p_client => 'public.gst_change_log_client_of(''itc_reversal_working'', r.working_id)', p_month => 'NULL', p_fy => 'r.financial_year')
    -- History tables: UPDATE and DELETE only; a deleted one is kept whole
    UNION ALL SELECT public.gst_change_log_attach('twob_versions', p_summary => '{version_data}', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('itc_versions', p_summary => '{version_data}', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('rcm_versions', p_month => 'NULL', p_fy => 'r.financial_year', p_summary => '{version_data}', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('gst_update_versions', p_month => 'NULL', p_summary => '{version_data}', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('gst_update_row_versions', p_client => 'public.gst_change_log_client_of(''running_update'', r.row_id)', p_month => 'NULL', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('gstr1_upload_versions', p_summary => '{payload,errors}', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('gstr3b_push_versions', p_summary => '{payload}', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('client_scheme_history', p_month => 'NULL', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('builder_unit_classification_history', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)', p_month => 'NULL', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('audit_log', p_month => 'NULL', p_fy => 'r.financial_year', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('gstr1_upload_versions_quarantine', p_summary => '{payload,errors}', p_mode => 'history')
  LOOP
    RAISE NOTICE 'gst_change_log: %', r;
  END LOOP;
END
$attach$;

-- ===========================================================================
-- 7. One history to read: this log, the Annual Return log, the Liberal log
-- ===========================================================================
CREATE OR REPLACE VIEW public.gst_change_history WITH (security_invoker = true) AS
SELECT 'g' || l.id::text AS key,
       'gst_change_log'::text AS log,
       l.id AS log_id,
       l.at,
       l.table_name,
       l.row_id,
       l.client_id,
       l.period_month,
       l.financial_year,
       l.op,
       l.actor_id,
       l.actor_name,
       l.actor_source,
       l.actor_basis,
       l.changed,
       l.request_id,
       l.row_label
  FROM public.gst_change_log l
UNION ALL
SELECT 'a' || a.id::text,
       'annual_return_change_log',
       a.id,
       a.changed_at,
       'annual_return_docs',
       a.doc_key,
       a.client_id,
       NULL::text,
       a.financial_year,
       CASE a.kind WHEN 'add' THEN 'INSERT' WHEN 'remove' THEN 'DELETE' ELSE 'UPDATE' END,
       NULL::uuid,
       a.changed_by,
       'app',
       'row',
       jsonb_build_object(COALESCE(NULLIF(array_to_string(a.path, '.'), ''), a.kind),
                          jsonb_build_object('old', a.old_value, 'new', a.new_value)),
       NULL::text,
       COALESCE(a.row_label, a.action)
  FROM public.annual_return_change_log a
UNION ALL
SELECT 'l' || c.id::text,
       'client_liberal_log',
       NULL::bigint,
       c.changed_at,
       'clients',
       c.client_id::text,
       c.client_id,
       NULL::text,
       NULL::text,
       'UPDATE',
       c.changed_by,
       c.changed_by_name,
       'app',
       'row',
       jsonb_build_object('liberal_2b_reconciliation', jsonb_build_object('old', NOT c.liberal, 'new', c.liberal)),
       NULL::text,
       NULL::text
  FROM public.client_liberal_log c;

GRANT SELECT ON public.gst_change_history TO anon, authenticated, service_role;

COMMIT;
