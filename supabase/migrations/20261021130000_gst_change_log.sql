-- GST change log: every change to the GST working kept, with who, when and
-- what (the firm, 21 Oct 2026: "All data of GST working & history of every
-- updation to be maintained and traceable").
--
--  * public.gst_change_log, one row per changed row: the table, the row's
--    key and name, the client and month (MM/YYYY; FY tables carry
--    financial_year; fy is the change's financial year either way), the
--    operation, who did it and from where, and what changed: on UPDATE only
--    the changed columns, old and new; on INSERT the new row and on DELETE
--    the old row (empty fields left out; the key and client are in their own
--    columns). Large JSON documents (GSTR-1 raw_json, version snapshots,
--    portal pulls) are kept as an md5, a size and the top-level keys that
--    changed, never whole; smaller JSON (the ITC Summary's data) as a list of
--    the leaves that changed ("section4A[5.1].igst: 1000 -> 1200"), walked 20
--    levels deep at most (below that a differing part is one fingerprinted
--    leaf, so a crafted document cannot make the logger fail).
--  * Filled by AFTER ... FOR EACH STATEMENT triggers with transition tables,
--    one INSERT ... SELECT per statement. Each table has its own plpgsql
--    logger, gst_change_log_for_<table>, written by gst_change_log_attach()
--    with fixed SQL, so a connection plans it once (round 2: one generic
--    logger built and planned its SQL on every statement inside an exception
--    block, about 1 ms each, and overflowed the subtransaction cache). A
--    statement that changed no row returns at once; nothing opens a
--    subtransaction; a statement whose rows the logger cannot read (only a
--    wrong attach expression could do that) is refused, never saved untraced.
--    History tables (twob_versions, itc_versions, rcm_versions,
--    gst_update_*versions, client_scheme_history,
--    builder_unit_classification_history, audit_log,
--    builder_bu_confirm_answer_history) are watched for UPDATE and DELETE
--    only, and a deleted one is kept whole: their inserts are already the
--    record. The GSTR-1 upload and GSTR-3B push logs ('record') are logged on
--    insert too. annual_return_docs has a complete log
--    (annual_return_change_log), shown with this one in gst_change_history;
--    the Liberal switch is logged here as well as in client_liberal_log,
--    which goes with a deleted client.
--  * Builder rows reach their client through their project, unit, booking
--    ...; before a parent row is deleted its client is kept for the deleting
--    transaction (gst_change_log_gone), so the rows its delete cascades to
--    are logged with the client (round 2).
--  * Who: the app sends x-gst-actor (the user signed in in that tab),
--    x-gst-source (app / extension / agent) and x-gst-request on every
--    /rest/v1 request (src/lib/changeLogHeaders.ts, set by AuthContext;
--    extension 0.17.0, both runners; the office agent). PostgREST puts
--    request headers in request.headers. Proven in Chromium on 21 Oct 2026
--    against the live project: the API gateway's preflight allows these
--    headers on /rest/v1 (Edge Functions keep their own list, so the app
--    never sends them there). Without the header the actor comes only from a
--    saved-by stamp the statement itself wrote (on INSERT the row's stamp, on
--    UPDATE a stamp whose value changed; actor_basis 'row'), never from one
--    the last editor left; else no one (actor_basis 'none'). The header is
--    trusted as every p_actor_id in this database is: the app has no auth
--    session (CLAUDE.md).
--  * Append-only: the log is select-only to every API role (RLS SELECT for
--    public, no write grants) and a trigger refuses UPDATE and TRUNCATE for
--    every role and DELETE unless a future superadmin-run retention function
--    turns app.gst_change_log_retention on (none exists).
--  * Reading: the history leads each read with its narrowest filter (client,
--    month, financial year, person) as a range of one value and orders by it
--    first, so each read is one index (round 2: a year or a month with no
--    client read the whole log newest first).
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
-- Order: apply this file LAST of the 21 Oct 2026 migrations, after
-- 20261021100000 (prior months), 20261021110000 (filing), 20261021120000
-- (reco) and 20261021140000 (BU confirmation): it attaches their GST tables
-- only if they exist (a missing table is skipped). If one of them goes live
-- after this file, apply this file again after it (re-runnable), or, as the
-- postgres role, run the lines of section 6 that name its tables, e.g.
--   SELECT public.gst_change_log_attach('twob_ever_filed');
--   SELECT public.gst_change_log_attach('twob_filed_figures');
--   SELECT public.gst_change_log_attach('twob_carry_log', p_label => 'r.list');
-- (20261021140000: the builder_bu_confirm_requests and
-- builder_bu_confirm_answer_history lines of section 6, as written there).
-- Apply at a quiet time (not during a bulk import or a report run): attaching
-- takes a short ACCESS EXCLUSIVE lock on each of the 107 tables, held until
-- COMMIT. The file sets lock_timeout = 5 s: if a long query holds a table, the
-- apply stops with "canceling statement due to lock timeout", changes nothing
-- (one transaction), and is simply run again a minute later. A re-run takes the
-- same locks again (it re-attaches every trigger), so it is not free either.
-- 1. Dry checks (SELECT only), note the numbers:
--      SELECT to_regclass('public.gst_change_log');                               -- NULL
--      SELECT to_regprocedure('public.staff_level_of(uuid)') IS NOT NULL;          -- true
--      SELECT current_setting('server_version_num')::int >= 160000;               -- true (17.6 on 21 Oct; pg_input_is_valid)
--      SELECT to_regclass('public.manual_source_allowances');                     -- the filing/reco table
--      SELECT count(*) FROM unnest(ARRAY['twob_ever_filed','twob_filed_figures','twob_carry_log',
--        'builder_bu_confirm_requests','builder_bu_confirm_answer_history','filing_status_log',
--        'reco_opening_log']) t WHERE to_regclass('public.' || t) IS NOT NULL;      -- 7 (the sibling migrations are in)
--      SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'gst_change_log%';       -- 0
--      SELECT pg_size_pretty(pg_database_size(current_database()));                -- 137 MB on 21 Oct
--      SELECT count(*) FROM unnest(ARRAY['twob_import_docs','books_register','bills_not_in_2b',
--        'bills_not_in_books','itc_summaries','suspended_reco','gst_receivable_reco','filing_status',
--        'gstr1_data','clients']) t WHERE to_regclass('public.' || t) IS NOT NULL;  -- 10
--      Row counts to compare after: SELECT (SELECT count(*) FROM filing_status),
--        (SELECT count(*) FROM bills_not_in_books), (SELECT count(*) FROM twob_import_docs),
--        (SELECT count(*) FROM clients), (SELECT count(*) FROM builder_receipts);
--        -- 21 Oct: 8195, 45024, 3559, 127, and the builder receipts
--      No long query on the GST tables right now (expect no rows):
--      SELECT pid, now() - xact_start AS running, left(query, 80) FROM pg_stat_activity
--       WHERE state <> 'idle' AND xact_start < now() - interval '30 seconds';
-- 2. Apply this file once (safe to apply again; a re-run re-attaches the
--    triggers and changes nothing else). On "lock timeout": wait a minute and
--    apply again.
-- 3. After checks:
--      SELECT mode, count(*) FROM gst_change_log_tables GROUP BY 1;  -- full 95, record 3, history 9 (107)
--        (with every sibling migration in; without 20261021100000: full 92; without
--         20261021140000: full 94, history 8. A smaller number names a missing table:
--         SELECT table_name FROM gst_change_log_tables ORDER BY 1)
--      SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
--         AND starts_with(proname, 'gst_change_log_for_');            -- 107, one logger per table
--      SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'gst_change_log_%' AND NOT tgisinternal;
--        -- (95 + 3)*4 + 9*3 = 419, plus 2 on gst_change_log itself, plus 16 (keep / forget
--        -- on the 8 builder parents) = 437
--      SELECT string_agg(indexname, ',' ORDER BY indexname) FROM pg_indexes WHERE tablename = 'gst_change_log';
--        -- gst_change_log_actor_at,gst_change_log_at_id,gst_change_log_client_month_at,gst_change_log_fy_at,
--        -- gst_change_log_month_at,gst_change_log_pkey,gst_change_log_table_row
--      EXPLAIN SELECT key FROM gst_change_history ORDER BY at DESC, seq DESC LIMIT 201;
--        -- an Index Scan using gst_change_log_at_id (never a Seq Scan on gst_change_log)
--      EXPLAIN SELECT key FROM gst_change_history WHERE fy >= '2025-26' AND fy <= '2025-26'
--        ORDER BY fy, at DESC, seq DESC LIMIT 201;  -- an Index (Only) Scan using gst_change_log_fy_at
--      SELECT count(*) FROM gst_change_log;                         -- 0 until the first save
--      SELECT count(*) FROM gst_change_log_gone;                    -- 0 until a builder parent is deleted
--      The row counts of step 1 unchanged.
--      SELECT has_table_privilege('anon', 'public.gst_change_log', 'SELECT'),        -- true
--             has_table_privilege('anon', 'public.gst_change_log', 'INSERT'),        -- false
--             has_table_privilege('anon', 'public.gst_change_log', 'DELETE'),        -- false
--             has_table_privilege('anon', 'public.gst_change_log_gone', 'INSERT'),   -- false
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
--    sends the headers, each tab its own user; Change history page),
--    extension 0.17.0 in every office Chrome (chrome://extensions -> Reload
--    from the updated folder; sends x-gst-source: extension and the app
--    user's id for every job the app started, and the requester's for a job
--    someone queued, on the Chrome runner and the agent), the office agent
--    (git pull, npm ci, restart the service; sends x-gst-source: agent and
--    the job's requester to the extension). Until each part is updated its
--    writes are still logged, with no person unless they write a saved-by
--    stamp (actor_source 'unknown'). No Edge Function changes.
--    MIN_EXTENSION_VERSION is not raised now: an older extension still works
--    and is still logged. Once every office Chrome shows 0.17.0, raise it to
--    0.17.0 (src/lib/extensionVersion.ts) so no write arrives without the
--    source.
-- 5. Later migrations: one that renames or drops a column of a logged table
--    must attach that table again in the same file (the logger names the
--    columns it reads; a save whose logger cannot run is refused).

BEGIN;
-- Attaching takes a short exclusive lock on each logged table, held to COMMIT:
-- give up rather than queue the app's queries behind a long report.
SET LOCAL lock_timeout = '5s';

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
-- The financial year a change belongs to ('2026-27'): the row's own year, else
-- the year of its month. The logger stores it on each log row (fy), so the
-- history's year filter reads one index (round 2: "year X or one of its
-- twelve months" read the whole log when no client was chosen). Not a
-- generated column: PostgreSQL would plan its expression again for every
-- statement that writes the log, the logger's own plan computes it once.
CREATE OR REPLACE FUNCTION public.gst_change_log_fy(p_fy text, p_month text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  y text := btrim(p_fy);
  k int;
BEGIN
  IF y ~ '^[0-9]{4}-[0-9]{2}$' THEN RETURN y; END IF;
  IF y ~ '^[0-9]{4}-[0-9]{4}$' THEN RETURN left(y, 5) || right(y, 2); END IF;
  IF p_month ~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN
    k := right(p_month, 4)::int - CASE WHEN left(p_month, 2)::int >= 4 THEN 0 ELSE 1 END;
    RETURN k::text || '-' || lpad(((k + 1) % 100)::text, 2, '0');
  END IF;
  RETURN NULLIF(y, '');
END;
$$;

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
  txid bigint NOT NULL DEFAULT txid_current(),
  fy text
);
ALTER TABLE public.gst_change_log ADD COLUMN IF NOT EXISTS fy text;
COMMENT ON TABLE public.gst_change_log IS
  'Every change to the GST working tables (gst_change_log_tables), append-only. 20261021130000_gst_change_log.sql, docs/GST_CHANGE_LOG.md.';

-- The history reads newest first, a page at a time ((at, id) keyset): the
-- whole log, a client and month, a month or a year of every client, one row,
-- or one person.
CREATE INDEX IF NOT EXISTS gst_change_log_at_id ON public.gst_change_log (at DESC, id DESC);
CREATE INDEX IF NOT EXISTS gst_change_log_client_month_at ON public.gst_change_log (client_id, period_month, at DESC);
CREATE INDEX IF NOT EXISTS gst_change_log_month_at ON public.gst_change_log (period_month, at DESC, id DESC) WHERE period_month IS NOT NULL;
CREATE INDEX IF NOT EXISTS gst_change_log_fy_at ON public.gst_change_log (fy, at DESC, id DESC) WHERE fy IS NOT NULL;
CREATE INDEX IF NOT EXISTS gst_change_log_table_row ON public.gst_change_log (table_name, row_id);
CREATE INDEX IF NOT EXISTS gst_change_log_actor_at ON public.gst_change_log (actor_id, at DESC, id DESC) WHERE actor_id IS NOT NULL;
DROP INDEX IF EXISTS public.gst_change_log_at_brin;

ALTER TABLE public.gst_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gst_change_log_read ON public.gst_change_log;
CREATE POLICY gst_change_log_read ON public.gst_change_log FOR SELECT TO public USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.gst_change_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.gst_change_log TO anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.gst_change_log_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- Which tables are logged, and how (written only by gst_change_log_attach).
CREATE TABLE IF NOT EXISTS public.gst_change_log_tables (
  table_name text PRIMARY KEY,
  mode text NOT NULL,
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
-- full: insert, update, delete logged. history: a table that is its own
-- record (saved versions), update and delete logged, a deleted row kept whole.
-- record: a log of portal uploads and pushes, also shown on insert (payload as
-- a fingerprint), a deleted row kept whole.
ALTER TABLE public.gst_change_log_tables DROP CONSTRAINT IF EXISTS gst_change_log_tables_mode_check;
ALTER TABLE public.gst_change_log_tables ADD CONSTRAINT gst_change_log_tables_mode_check CHECK (mode IN ('full', 'history', 'record'));
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
-- header (an old tab, an old extension): 'unknown'. Read once per logged
-- statement and opens no subtransaction (a value that is not JSON, which
-- PostgREST never sends, is read as no headers); what it found is kept for
-- the rest of the transaction while the headers stay the same
-- (gst_change_log.context), so a function that saves row by row reads them
-- once.
CREATE OR REPLACE FUNCTION public.gst_change_log_context(
  OUT actor uuid, OUT actor_name text, OUT source text, OUT request text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw text := current_setting('request.headers', true);
  v_raw_claims text := current_setting('request.jwt.claims', true);
  v_seen text := COALESCE(v_raw, '') || chr(2) || COALESCE(v_raw_claims, '') || chr(3);
  v_cache text := current_setting('gst_change_log.context', true);
  v_parts text[];
  h json;
  v_claims json;
  v_actor text;
  v_source text;
BEGIN
  IF v_cache IS NOT NULL AND starts_with(v_cache, v_seen) THEN
    v_parts := string_to_array(substr(v_cache, length(v_seen) + 1), chr(1));
    actor := NULLIF(v_parts[1], '')::uuid;
    actor_name := NULLIF(v_parts[2], '');
    source := v_parts[3];
    request := NULLIF(v_parts[4], '');
    RETURN;
  END IF;
  IF v_raw <> '' AND pg_input_is_valid(v_raw, 'json') THEN
    h := v_raw::json;
    IF json_typeof(h) <> 'object' THEN h := NULL; END IF;
  END IF;
  IF v_raw_claims <> '' AND pg_input_is_valid(v_raw_claims, 'json') THEN
    v_claims := v_raw_claims::json;
    IF json_typeof(v_claims) <> 'object' THEN v_claims := NULL; END IF;
  END IF;
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
  PERFORM set_config('gst_change_log.context', v_seen || concat_ws(chr(1), COALESCE(actor::text, ''),
    COALESCE(replace(actor_name, chr(1), ' '), ''), source, COALESCE(replace(request, chr(1), ' '), '')), true);
END;
$$;

-- A staff member's first name, or a client's name for the client portal.
-- (The helpers the loggers call are plpgsql, not sql: PostgreSQL plans an sql
-- function's body again in every statement that calls it, plpgsql once per
-- connection.)
CREATE OR REPLACE FUNCTION public.gst_change_log_actor_name(p_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;
  RETURN COALESCE(
    (SELECT p.first_name FROM public.profiles p WHERE p.user_id = p_id LIMIT 1),
    (SELECT c.name || ' (client)' FROM public.clients c WHERE c.id = p_id));
END;
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
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
BEGIN
  IF v IS NULL OR jsonb_typeof(v) = 'null' THEN RETURN NULL; END IF;
  s := v::text;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'summary', true,
    'md5', md5(s),
    'bytes', octet_length(s),
    'keys', CASE WHEN jsonb_typeof(v) = 'object' THEN (SELECT count(*) FROM jsonb_object_keys(v)) END,
    'items', CASE WHEN jsonb_typeof(v) = 'array' THEN jsonb_array_length(v) END));
END;
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

-- The leaves that differ between two JSON values: {path, old, new}. No
-- working nests 20 levels deep: past that, a part that differs is one leaf
-- kept as fingerprints ("deep"), so a crafted document can never make the
-- walk run out of stack.
DROP FUNCTION IF EXISTS public.gst_change_log_walk(jsonb, jsonb, text);
CREATE OR REPLACE FUNCTION public.gst_change_log_walk(o jsonb, n jsonb, p text, d int)
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
  IF d >= 20 AND (jsonb_typeof(o) IN ('object', 'array') OR jsonb_typeof(n) IN ('object', 'array')) THEN
    RETURN NEXT jsonb_build_object('path', p,
      'old', CASE WHEN jsonb_typeof(o) IN ('object', 'array') THEN public.gst_change_log_digest(o) ELSE o END,
      'new', CASE WHEN jsonb_typeof(n) IN ('object', 'array') THEN public.gst_change_log_digest(n) ELSE n END,
      'deep', true);
    RETURN;
  END IF;
  -- A part added or removed (a new row of a table): its leaves, each from or to empty.
  IF jsonb_typeof(o) IN ('object', 'array') AND COALESCE(jsonb_typeof(n), 'null') = 'null' THEN
    n := CASE jsonb_typeof(o) WHEN 'object' THEN '{}'::jsonb ELSE '[]'::jsonb END;
  ELSIF jsonb_typeof(n) IN ('object', 'array') AND COALESCE(jsonb_typeof(o), 'null') = 'null' THEN
    o := CASE jsonb_typeof(n) WHEN 'object' THEN '{}'::jsonb ELSE '[]'::jsonb END;
  END IF;
  IF jsonb_typeof(o) = 'object' AND jsonb_typeof(n) = 'object' THEN
    FOR k IN SELECT x FROM (SELECT jsonb_object_keys(o) AS x UNION SELECT jsonb_object_keys(n)) z ORDER BY x LOOP
      IF (o -> k) IS DISTINCT FROM (n -> k) THEN
        RETURN QUERY SELECT public.gst_change_log_walk(o -> k, n -> k, CASE WHEN p = '' THEN k ELSE p || '.' || k END, d + 1);
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(o) = 'array' AND jsonb_typeof(n) = 'array' THEN
    len := greatest(jsonb_array_length(o), jsonb_array_length(n));
    FOR i IN 0 .. len - 1 LOOP
      IF (o -> i) IS DISTINCT FROM (n -> i) THEN
        RETURN QUERY SELECT public.gst_change_log_walk(o -> i, n -> i,
          p || '[' || public.gst_change_log_label(COALESCE(n -> i, o -> i), i) || ']', d + 1);
      END IF;
    END LOOP;
  ELSE
    -- A plain value, or a part that changed its kind (kept as a fingerprint).
    RETURN NEXT jsonb_build_object('path', p,
      'old', CASE WHEN jsonb_typeof(o) IN ('object', 'array') THEN public.gst_change_log_digest(o) ELSE o END,
      'new', CASE WHEN jsonb_typeof(n) IN ('object', 'array') THEN public.gst_change_log_digest(n) ELSE n END);
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
    FROM (SELECT x FROM public.gst_change_log_walk(o, n, '', 0) x LIMIT 101) w;
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
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN (
    SELECT jsonb_object_agg(e.key, CASE
             WHEN jsonb_typeof(o -> e.key) IN ('object', 'array') OR jsonb_typeof(e.value) IN ('object', 'array')
               THEN public.gst_change_log_json_change(o -> e.key, e.value, e.key = ANY (p_summary))
             ELSE jsonb_build_object('old', o -> e.key, 'new', e.value)
           END)
      FROM jsonb_each(n) e
     WHERE (o -> e.key) IS DISTINCT FROM e.value
       AND NOT (e.key = ANY (p_skip))
       AND (p_only IS NULL OR e.key = ANY (p_only)));
END;
$$;

-- An inserted or deleted row: its filled columns (the key and client are in
-- the log's own columns); large JSON as a fingerprint unless p_keep_full.
CREATE OR REPLACE FUNCTION public.gst_change_log_row(r jsonb, p_summary text[], p_hide text[], p_only text[], p_keep_full boolean)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_object_agg(e.key, CASE
             WHEN NOT p_keep_full AND (e.key = ANY (p_summary)
                  OR (jsonb_typeof(e.value) IN ('object', 'array') AND pg_column_size(e.value) > 65536))
               THEN public.gst_change_log_digest(e.value)
             ELSE e.value
           END), '{}'::jsonb)
      FROM jsonb_each(r) e
     WHERE jsonb_typeof(e.value) <> 'null'
       AND NOT (e.key = ANY (p_hide))
       AND (p_only IS NULL OR e.key = ANY (p_only)));
END;
$$;

-- The client of a builder row deleted with its parent. A builder row reaches
-- its client through its project, unit, booking ...; a delete that cascades
-- removes the parent before the child's statement is logged (the cascade's
-- statements are logged after the parent's statement ends; round 2: the
-- receipts, bookings and charges of a deleted unit were logged with no
-- client). So before a parent row goes, gst_change_log_keep_client() keeps
-- its client here, with the deleting transaction, and
-- gst_change_log_client_of() reads it once the parent is gone. The next
-- delete of a parent removes what finished transactions kept (a few rows at
-- most). Read by the logger, written only by those triggers.
CREATE TABLE IF NOT EXISTS public.gst_change_log_gone (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL,
  txid bigint NOT NULL DEFAULT txid_current()
);
CREATE INDEX IF NOT EXISTS gst_change_log_gone_txid ON public.gst_change_log_gone (txid);
COMMENT ON TABLE public.gst_change_log_gone IS
  'The client of a builder parent row being deleted, for the change log of the rows its delete cascades to; kept for the deleting transaction. 20261021130000_gst_change_log.sql.';
ALTER TABLE public.gst_change_log_gone ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gst_change_log_gone_read ON public.gst_change_log_gone;
CREATE POLICY gst_change_log_gone_read ON public.gst_change_log_gone FOR SELECT TO public USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.gst_change_log_gone FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.gst_change_log_gone TO anon, authenticated, service_role;

-- The client of a row that has no client_id of its own (builder tables, the
-- update sheet's row versions): through its parent, or, when this
-- transaction deleted the parent, the client kept for it.
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
  IF v IS NULL THEN
    SELECT g.client_id INTO v FROM public.gst_change_log_gone g WHERE g.id = p_id;
  END IF;
  RETURN v;
END;
$$;

-- Before a builder parent row is deleted: keep its client (see
-- gst_change_log_gone). Before each such delete statement: forget what
-- finished transactions kept.
CREATE OR REPLACE FUNCTION public.gst_change_log_keep_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o jsonb := to_jsonb(OLD);
  v uuid;
BEGIN
  IF TG_TABLE_NAME IN ('builder_projects', 'builder_itc_reversal_workings') THEN
    v := (o ->> 'client_id')::uuid;
  ELSIF TG_TABLE_NAME IN ('builder_units', 'builder_bounce_reversals', 'builder_cancellations') THEN
    v := public.gst_change_log_client_of('project', (o ->> 'project_id')::uuid);
  ELSIF TG_TABLE_NAME IN ('builder_bookings', 'builder_receipts', 'builder_reclassifications') THEN
    v := public.gst_change_log_client_of('unit', (o ->> 'unit_id')::uuid);
  END IF;
  IF v IS NOT NULL THEN
    INSERT INTO public.gst_change_log_gone (id, client_id) VALUES ((o ->> 'id')::uuid, v)
    ON CONFLICT (id) DO UPDATE SET client_id = EXCLUDED.client_id, txid = EXCLUDED.txid;
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.gst_change_log_forget_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.gst_change_log_gone WHERE txid < txid_snapshot_xmin(txid_current_snapshot());
  RETURN NULL;
END;
$$;

-- ===========================================================================
-- 5. The loggers
-- ===========================================================================
-- Each logged table has its own trigger function, gst_change_log_for_<table>,
-- written by gst_change_log_attach (below) from how the table is read: its
-- key, client, month, year and name, its saved-by stamps, its JSON columns.
-- Its SQL is fixed, so a connection plans it once and reuses the plan; a
-- statement that changed no row returns at once; nothing on the way opens a
-- subtransaction (round 2: one function for every table built and planned
-- its SQL on every statement inside an exception block, about 1 ms each, so
-- a loop of one-row saves ran 3 to 6 times slower and a long one overflowed
-- the subtransaction cache). A logger error is not caught: the save is
-- refused with it, so nothing changes without its trace. Every expression is
-- checked against the table when attaching, and the ones in section 6 are
-- column reads and lookups that cannot fail, so this never happens in use.
-- Who: the x-gst-actor header; without it, a stamp column this statement
-- wrote (on INSERT the row's own stamp; on UPDATE only a stamp that changed,
-- never one left as the last editor stamped it); else no one.
CREATE OR REPLACE FUNCTION public.gst_change_log_fn_name(p_table text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN length('gst_change_log_for_' || p_table) <= 63 THEN 'gst_change_log_for_' || p_table
              ELSE 'gst_change_log_for_' || left(p_table, 35) || '_' || left(md5(p_table), 8) END
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
-- exist is skipped): writes its logger function and its four triggers.
-- Expressions are SQL on the row (alias r) and are checked against the table
-- here, so a wrong column fails the migration, never a save.
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
  v_fn text := public.gst_change_log_fn_name(p_table);
  v_key text[];
  v_actor text[];
  v_bad text;
  v_label text := p_label;
  v_key_r text;
  v_join text;
  v_n_gone text;
  v_o_gone text;
  v_actor_ins text := 'NULL::uuid';
  v_actor_upd text := 'NULL::uuid';
  v_summary text := quote_literal(p_summary::text) || '::text[]';
  v_only text := CASE WHEN p_only IS NULL THEN 'NULL::text[]' ELSE quote_literal(p_only::text) || '::text[]' END;
  v_skip text := quote_literal((p_skip || ARRAY['updated_at'])::text) || '::text[]';
  v_hide text;
  v_keep_full text := CASE WHEN p_mode IN ('history', 'record') THEN 'true' ELSE 'false' END;
  v_row_new text;
  v_row_old text;
  v_who text;
  v_m text;
  v_y text;
BEGIN
  IF v_rel IS NULL THEN
    RETURN p_table || ': missing, skipped';
  END IF;
  IF p_mode NOT IN ('full', 'history', 'record') THEN
    RAISE EXCEPTION 'gst_change_log_attach(%): mode must be full, history or record', p_table;
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
      'opening_portal_pulled_by', 'liberal_changed_by', 'reopened_by', 'frozen_by', 'cleared_by',
      'imported_by', 'pulled_by', 'uploaded_by', 'created_by', 'entered_by', 'requested_by', 'allowed_by',
      'actor_id', 'changed_by', 'changed_by_employee_id']) WITH ORDINALITY k(c, ord)
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

  -- The pieces of the logger's SQL.
  v_key_r := 'concat_ws(''|'', ' || (SELECT string_agg('r.' || quote_ident(k) || '::text', ', ' ORDER BY o) FROM unnest(v_key) WITH ORDINALITY u(k, o)) || ')';
  v_join := (SELECT string_agg('o.' || quote_ident(k) || ' = n.' || quote_ident(k), ' AND ') FROM unnest(v_key) k);
  v_hide := quote_literal((v_key || ARRAY['client_id'])::text) || '::text[]';
  -- A side of the join that has no row (a key column of a real row is never NULL).
  v_n_gone := 'n.' || quote_ident(v_key[1]) || ' IS NULL';
  v_o_gone := 'o.' || quote_ident(v_key[1]) || ' IS NULL';
  -- An inserted or deleted row: on a table without JSON columns, every
  -- filled column, read by built-in functions (most rows logged are ledger
  -- rows); otherwise gst_change_log_row, which fingerprints large JSON.
  IF cardinality(p_summary) = 0 AND p_only IS NULL
     AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped
                        AND a.atttypid IN ('json'::regtype, 'jsonb'::regtype)) THEN
    v_row_new := format('(jsonb_strip_nulls(to_jsonb(r.*)) - %s)', v_hide);
    v_row_old := v_row_new;
  ELSE
    v_row_new := format('public.gst_change_log_row(to_jsonb(r.*), %s, %s, %s, false)', v_summary, v_hide, v_only);
    v_row_old := format('public.gst_change_log_row(to_jsonb(r.*), %s, %s, %s, %s)', v_summary, v_hide, v_only, v_keep_full);
  END IF;
  -- The person's name: the header's; for a saved-by stamp, looked up (a
  -- function call: a subquery here would make every row re-read the join).
  v_who := 'CASE WHEN v_actor IS NOT NULL THEN v_name WHEN a.id IS NOT NULL THEN public.gst_change_log_actor_name(a.id) END';
  IF cardinality(v_actor) > 0 THEN
    v_actor_ins := (SELECT string_agg('r.' || quote_ident(a), ', ' ORDER BY o) FROM unnest(v_actor) WITH ORDINALITY u(a, o)) || ', NULL::uuid';
    v_actor_upd := (SELECT string_agg(format('CASE WHEN n.%1$I IS DISTINCT FROM o.%1$I THEN n.%1$I END', a), ', ' ORDER BY o)
                      FROM unnest(v_actor) WITH ORDINALITY u(a, o)) || ', NULL::uuid';
  END IF;

  -- The month and year (MM/YYYY as it is, any other spelling normalised).
  v_m := CASE WHEN p_month = 'NULL' THEN 'NULL::text' ELSE format(
    '(CASE WHEN (%1$s)::text ~ ''^(0[1-9]|1[0-2])/[0-9]{4}$'' THEN (%1$s)::text ELSE public.gst_change_log_month((%1$s)::text) END)', p_month) END;
  v_y := format('(%s)::text', p_fy);
  -- Checked here, so a month or year that cannot be read fails the migration.
  EXECUTE format('SELECT %s, public.gst_change_log_fy(%s, %s) FROM public.%I r LIMIT 0', v_m, v_y, v_m, p_table);

  -- On UPDATE, n is the new row and o the old one, joined on the key (a
  -- full join, so the plan stays a hash or merge join whatever the number of
  -- rows); r is the new row, or the old one when the key itself changed (so
  -- a moved row keeps its client and month on both sides). Whole rows are
  -- always written alias.* (a table may have a column named like an alias).
  -- Each helper is a function call, not SQL written out here: the plan is
  -- cached, but its expressions are set up again for every statement.
  EXECUTE format($gen$
CREATE OR REPLACE FUNCTION public.%1$I()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
-- The change log of public.%2$I. Written by gst_change_log_attach
-- (20261021130000_gst_change_log.sql): attach the table again to change it.
DECLARE
  v_actor uuid;
  v_name text;
  v_source text;
  v_request text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM FROM gst_cl_old LIMIT 1;
  ELSE
    PERFORM FROM gst_cl_new LIMIT 1;
  END IF;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT c.actor, c.actor_name, c.source, c.request INTO v_actor, v_name, v_source, v_request
    FROM public.gst_change_log_context() c;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.gst_change_log
      (table_name, row_id, row_label, client_id, period_month, financial_year, fy, op, actor_id, actor_name, actor_source, actor_basis, changed, request_id)
    SELECT %2$L, %3$s, left((%4$s)::text, 120), (%5$s)::uuid, %6$s, %7$s, public.gst_change_log_fy(%7$s, %6$s), 'INSERT',
           a.id, %8$s, v_source,
           CASE WHEN v_actor IS NOT NULL THEN 'header' WHEN a.id IS NOT NULL THEN 'row' ELSE 'none' END,
           %9$s, v_request
      FROM gst_cl_new r
     CROSS JOIN LATERAL (SELECT COALESCE(v_actor, %10$s) AS id) a;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.gst_change_log
      (table_name, row_id, row_label, client_id, period_month, financial_year, fy, op, actor_id, actor_name, actor_source, actor_basis, changed, request_id)
    SELECT %2$L, %3$s, left((%4$s)::text, 120), (%5$s)::uuid, %6$s, %7$s, public.gst_change_log_fy(%7$s, %6$s), 'UPDATE',
           a.id, %8$s, v_source,
           CASE WHEN v_actor IS NOT NULL THEN 'header' WHEN a.id IS NOT NULL THEN 'row' ELSE 'none' END,
           d.changed, v_request
      FROM gst_cl_new n
      FULL JOIN gst_cl_old o ON %11$s
     CROSS JOIN LATERAL (SELECT n.* WHERE NOT (%12$s) UNION ALL SELECT o.* WHERE %12$s) r
     CROSS JOIN LATERAL (SELECT CASE
         WHEN %12$s OR %13$s THEN jsonb_build_object('_key_changed', true,
           'old', public.gst_change_log_row(to_jsonb(o.*), %14$s, '{}'::text[], %15$s, false),
           'new', public.gst_change_log_row(to_jsonb(n.*), %14$s, '{}'::text[], %15$s, false))
         ELSE public.gst_change_log_diff(to_jsonb(o.*), to_jsonb(n.*), %14$s, %16$s, %15$s) END AS changed OFFSET 0) d
     CROSS JOIN LATERAL (SELECT COALESCE(v_actor, %17$s) AS id) a
     WHERE d.changed IS NOT NULL;
  ELSE
    INSERT INTO public.gst_change_log
      (table_name, row_id, row_label, client_id, period_month, financial_year, fy, op, actor_id, actor_name, actor_source, actor_basis, changed, request_id)
    SELECT %2$L, %3$s, left((%4$s)::text, 120), (%5$s)::uuid, %6$s, %7$s, public.gst_change_log_fy(%7$s, %6$s), 'DELETE',
           v_actor, v_name, v_source, CASE WHEN v_actor IS NOT NULL THEN 'header' ELSE 'none' END,
           %18$s, v_request
      FROM gst_cl_old r;
  END IF;
  RETURN NULL;
END
$fn$
$gen$, v_fn, p_table, v_key_r, v_label, p_client, v_m, v_y, v_who, v_row_new, v_actor_ins,
       v_join, v_n_gone, v_o_gone, v_summary, v_only, v_skip, v_actor_upd, v_row_old);

  EXECUTE format('DROP TRIGGER IF EXISTS gst_change_log_ins ON public.%I', p_table);
  EXECUTE format('DROP TRIGGER IF EXISTS gst_change_log_upd ON public.%I', p_table);
  EXECUTE format('DROP TRIGGER IF EXISTS gst_change_log_del ON public.%I', p_table);
  EXECUTE format('DROP TRIGGER IF EXISTS gst_change_log_trunc ON public.%I', p_table);
  IF p_mode IN ('full', 'record') THEN
    EXECUTE format('CREATE TRIGGER gst_change_log_ins AFTER INSERT ON public.%I REFERENCING NEW TABLE AS gst_cl_new '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.%I()', p_table, v_fn);
  END IF;
  EXECUTE format('CREATE TRIGGER gst_change_log_upd AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS gst_cl_old NEW TABLE AS gst_cl_new '
                 'FOR EACH STATEMENT EXECUTE FUNCTION public.%I()', p_table, v_fn);
  EXECUTE format('CREATE TRIGGER gst_change_log_del AFTER DELETE ON public.%I REFERENCING OLD TABLE AS gst_cl_old '
                 'FOR EACH STATEMENT EXECUTE FUNCTION public.%I()', p_table, v_fn);
  EXECUTE format('CREATE TRIGGER gst_change_log_trunc BEFORE TRUNCATE ON public.%I '
                 'FOR EACH STATEMENT EXECUTE FUNCTION public.gst_change_log_truncate()', p_table);
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I() FROM PUBLIC, anon, authenticated', v_fn);

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
    -- Prior months (20261021100000): every return ever filed, a filed month's
    -- frozen 4B(2), 5.4 and 4D(1.2) (a reopen deletes them), each list's carry
    UNION ALL SELECT public.gst_change_log_attach('twob_ever_filed')
    UNION ALL SELECT public.gst_change_log_attach('twob_filed_figures')
    UNION ALL SELECT public.gst_change_log_attach('twob_carry_log', p_label => 'r.list')
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
    -- Client masters: the GST fields only, never the passwords. The Liberal
    -- switch too: client_liberal_log goes when the client is deleted, this
    -- log stays (the view shows a switch once).
    UNION ALL SELECT public.gst_change_log_attach('clients', p_client => 'r.id', p_month => 'NULL',
      p_only => '{gstin,name,registration_type,registration_date,selected_returns,assigned_accountant,cancellation_date,registration_cancellation_date,regular_sub_type,builder_itc_type,commercial_area,residential_area,target_date_group1,target_date_group2,inactive_at_hand,gstr1_import_mode,notices_handled,notices_tracks_off,einvoice_applicable,einvoice_exemption,gst_user_id,gst_password_changed_at,liberal_2b_reconciliation,liberal_changed_by,liberal_changed_at}')
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
    UNION ALL SELECT public.gst_change_log_attach('builder_unit_charges', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)', p_month => 'NULL',
      p_label => 'concat_ws('' · '', r.charge_head, r.label)')
    UNION ALL SELECT public.gst_change_log_attach('builder_bookings', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)', p_month => 'NULL',
      p_label => 'concat_ws('' · '', ''Booking '' || r.booking_date::text, r.status)')
    UNION ALL SELECT public.gst_change_log_attach('builder_booking_members', p_client => 'public.gst_change_log_client_of(''booking'', r.booking_id)', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('builder_receipts', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)',
      p_label => 'concat_ws('' · '', NULLIF(concat_ws(''/'', r.doc_series, r.doc_no), ''''), ''Receipt '' || r.receipt_date::text, r.receipt_nature)')
    UNION ALL SELECT public.gst_change_log_attach('builder_invoices', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)',
      p_label => 'concat_ws('' · '', NULLIF(concat_ws(''/'', r.doc_series, r.doc_no), ''''), ''Invoice '' || r.invoice_date::text)')
    UNION ALL SELECT public.gst_change_log_attach('builder_credit_notes', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)')
    UNION ALL SELECT public.gst_change_log_attach('builder_advance_adjustments', p_client => 'public.gst_change_log_client_of(''receipt'', r.receipt_id)')
    UNION ALL SELECT public.gst_change_log_attach('builder_opening_balances', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('builder_opening_balance_adjustments', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)')
    UNION ALL SELECT public.gst_change_log_attach('builder_historical_receipts', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)', p_month => 'r.receipt_date')
    UNION ALL SELECT public.gst_change_log_attach('builder_bu_events', p_client => 'public.gst_change_log_client_of(''project'', r.project_id)', p_month => 'r.posting_period')
    UNION ALL SELECT public.gst_change_log_attach('builder_bu_event_units', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)', p_month => 'NULL')
    UNION ALL SELECT public.gst_change_log_attach('builder_bu_agreement_confirmations', p_month => 'NULL')
    -- BU confirmation e-mails (20261021140000): never the link's token; the
    -- one-time codes (builder_bu_confirm_codes) are private and not logged
    UNION ALL SELECT public.gst_change_log_attach('builder_bu_confirm_requests', p_month => 'NULL',
      p_only => '{bu_event_id,to_emails,cc_emails,unit_ids,earlier_link,created_by,sent_at,outbox_id}', p_label => 'array_to_string(r.to_emails, '', '')')
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
    -- Portal uploads and pushes: each one shown when made (the payload as a
    -- fingerprint); edited or deleted, logged too, a deleted one kept whole
    UNION ALL SELECT public.gst_change_log_attach('gstr1_upload_versions', p_summary => '{payload,errors}', p_mode => 'record')
    UNION ALL SELECT public.gst_change_log_attach('gstr1_upload_versions_quarantine', p_summary => '{payload,errors}', p_mode => 'record')
    UNION ALL SELECT public.gst_change_log_attach('gstr3b_push_versions', p_summary => '{payload}', p_mode => 'record')
    -- History tables: UPDATE and DELETE only; a deleted one is kept whole
    UNION ALL SELECT public.gst_change_log_attach('twob_versions', p_summary => '{version_data}', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('itc_versions', p_summary => '{version_data}', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('rcm_versions', p_month => 'NULL', p_fy => 'r.financial_year', p_summary => '{version_data}', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('gst_update_versions', p_month => 'NULL', p_summary => '{version_data}', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('gst_update_row_versions', p_client => 'public.gst_change_log_client_of(''running_update'', r.row_id)', p_month => 'NULL', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('client_scheme_history', p_month => 'NULL', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('builder_unit_classification_history', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)', p_month => 'NULL', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('builder_bu_confirm_answer_history', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)', p_month => 'NULL', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('audit_log', p_month => 'NULL', p_fy => 'r.financial_year', p_mode => 'history')
  LOOP
    RAISE NOTICE 'gst_change_log: %', r;
  END LOOP;
END
$attach$;

-- Builder parents keep their client for the rows their delete cascades to
-- (gst_change_log_gone, section 4).
DO $keep$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['builder_projects', 'builder_units', 'builder_bookings', 'builder_receipts', 'builder_bounce_reversals',
                           'builder_reclassifications', 'builder_cancellations', 'builder_itc_reversal_workings'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('DROP TRIGGER IF EXISTS gst_change_log_keep ON public.%I', t);
    EXECUTE format('CREATE TRIGGER gst_change_log_keep BEFORE DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.gst_change_log_keep_client()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS gst_change_log_forget ON public.%I', t);
    EXECUTE format('CREATE TRIGGER gst_change_log_forget BEFORE DELETE ON public.%I '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.gst_change_log_forget_client()', t);
  END LOOP;
END
$keep$;
REVOKE ALL ON FUNCTION public.gst_change_log_keep_client() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gst_change_log_forget_client() FROM PUBLIC, anon, authenticated;

-- The first draft's one logger for every table, and its fallback (never
-- applied live; dropped so a database that ran a draft matches this file).
DROP FUNCTION IF EXISTS public.gst_change_log_capture();
DROP FUNCTION IF EXISTS public.gst_change_log_partial(jsonb, jsonb, text, text[], text[], text[], text);
DROP FUNCTION IF EXISTS public.gst_change_log_small(jsonb);

-- ===========================================================================
-- 7. One history to read: this log, the Annual Return log, the Liberal log
-- ===========================================================================
-- fy is the financial year of the change (the year filter reads it alone).
-- A Liberal switch is in this log since it went live (clients, above), and
-- in client_liberal_log, which keeps the switches made before; the view shows
-- client_liberal_log's row only when this log has no row for that switch
-- (same client, same moment).
-- Newest first is ORDER BY at DESC, seq DESC; the next page starts below the
-- last row's (at, seq) (keyset, so changes saved meanwhile never repeat or
-- skip a row). seq orders the rows of one moment: this log's id (served by
-- gst_change_log_at_id), the Annual Return log's id negated, a Liberal
-- switch's below both (from -2^50 down); the three ranges never meet, and
-- every seq stays within what a browser reads exactly (2^53). A person is actor_id in
-- every branch: the Annual Return log keeps only a name, matched to the one
-- staff member of that first name (none when two share it).
DROP VIEW IF EXISTS public.gst_change_history;
CREATE VIEW public.gst_change_history WITH (security_invoker = true) AS
SELECT 'g' || l.id::text AS key,
       'gst_change_log'::text AS log,
       l.id AS log_id,
       l.id AS seq,
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
       l.row_label,
       l.fy
  FROM public.gst_change_log l
UNION ALL
SELECT 'a' || a.id::text,
       'annual_return_change_log',
       a.id,
       -a.id,
       a.changed_at,
       'annual_return_docs',
       a.doc_key,
       a.client_id,
       NULL::text,
       a.financial_year,
       CASE a.kind WHEN 'add' THEN 'INSERT' WHEN 'remove' THEN 'DELETE' ELSE 'UPDATE' END,
       p.user_id,
       a.changed_by,
       'app',
       'row',
       jsonb_build_object(COALESCE(NULLIF(array_to_string(a.path, '.'), ''), a.kind),
                          jsonb_build_object('old', a.old_value, 'new', a.new_value)),
       NULL::text,
       COALESCE(a.row_label, a.action),
       a.financial_year
  FROM public.annual_return_change_log a
  LEFT JOIN (SELECT pr.first_name, min(pr.user_id::text)::uuid AS user_id
               FROM public.profiles pr
              WHERE pr.first_name IS NOT NULL
              GROUP BY pr.first_name
             HAVING count(*) = 1) p ON p.first_name = a.changed_by
UNION ALL
SELECT 'l' || c.id::text,
       'client_liberal_log',
       NULL::bigint,
       -1125899906842624 - (hashtext(c.id::text)::bigint & 2147483647),
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
       NULL::text,
       NULL::text
  FROM public.client_liberal_log c
 WHERE NOT EXISTS (SELECT 1 FROM public.gst_change_log g
                    WHERE g.table_name = 'clients' AND g.row_id = c.client_id::text AND g.at = c.changed_at
                      AND g.op IN ('INSERT', 'UPDATE') AND g.changed ? 'liberal_2b_reconciliation');

GRANT SELECT ON public.gst_change_history TO anon, authenticated, service_role;

COMMIT;
