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
--  * Kept as each row changes, written at COMMIT (round 3). A row trigger on
--    every logged table (gst_change_log_stage_row, one function for all)
--    keeps the row as it was and as it is in the UNLOGGED table
--    gst_change_log_stage and marks the transaction once
--    (gst_change_log_pending); at COMMIT a deferred trigger
--    (gst_change_log_flush) writes the transaction's log rows table by
--    table, each with its own function gst_change_log_for_<table> (written by
--    gst_change_log_attach() with fixed SQL, planned once per connection).
--    Round 2 wrote the log at the end of every statement, about 0.2 ms a
--    statement: a function that saves entry by entry (1,000 prior-month
--    removals are 3,000 statements) spent more time logging than saving and
--    failed twob-simple's own 1 s timing gate. Now a save pays about 15 to
--    20 µs a row and nothing per statement (a statement that changes no row
--    fires nothing); the log rows are written once, set-based, at COMMIT.
--    What a savepoint rolls back goes with it (kept rows and mark alike).
--    Nothing opens a subtransaction. A save whose rows the log cannot read
--    (only a wrong attach expression could do that) fails its COMMIT: it is
--    refused, never saved untraced.
--    'record' tables are logged on insert too, with a deleted row kept whole:
--    the GSTR-1 upload and GSTR-3B push logs, a client's scheme change
--    (client_scheme_history: its effective date and notes are the only record
--    of why filing rows were reset) and a unit's classification
--    (builder_unit_classification_history: its rate code and affordable flag
--    live only there) (round 3). 'history' tables (twob_versions,
--    itc_versions, rcm_versions, gst_update_*versions, audit_log,
--    builder_bu_confirm_answer_history) are watched for UPDATE and DELETE
--    only: their inserts are already the record. annual_return_docs has a
--    complete log (annual_return_change_log), shown with this one in
--    gst_change_history; the Liberal switch is logged here as well as in
--    client_liberal_log, which goes with a deleted client.
--    Round 3 also logs the portal's DRC-03 payments and refund applications
--    (gst_drc03_filings, gst_refund_applications: a re-pull that only touches
--    when they were seen is no change) and the BU agreement confirmations of
--    20261021140000 (never a link's token: p_private).
--  * Builder rows reach their client through their project, unit, booking
--    ...; before a parent row is deleted its client is kept for the deleting
--    transaction (gst_change_log_gone), so the rows its delete cascades to
--    are logged with the client (round 2).
--  * Who: the app sends x-gst-actor (the user signed in in that tab),
--    x-gst-source (app / extension / agent) and x-gst-request on every
--    /rest/v1 request (src/lib/changeLogHeaders.ts, set by AuthContext;
--    extension 0.17.0, both runners; the office agent). PostgREST puts
--    request headers in request.headers (they last to the COMMIT, where the
--    log reads them once). Proven in Chromium on 21 Oct 2026 against the live
--    project: the API gateway's preflight allows these headers on /rest/v1
--    (Edge Functions keep their own list, so the app never sends them
--    there). Without the header the actor comes only from a saved-by stamp
--    the change itself wrote (on INSERT the row's stamp, on UPDATE a stamp
--    whose value changed; actor_basis 'row'), never from one the last editor
--    left; else no one (actor_basis 'none'). The header is trusted as every
--    p_actor_id in this database is: the app has no auth session (CLAUDE.md).
--  * Append-only: the log is select-only to every API role (RLS SELECT for
--    public, no write grants) and a trigger refuses UPDATE and TRUNCATE for
--    every role and DELETE unless a future superadmin-run retention function
--    turns app.gst_change_log_retention on (none exists). The kept rows and
--    the marks are open to no API role (no grants, RLS with no policy): no
--    one can add a made-up row to be logged at COMMIT, or take one away.
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
-- Order: in filename order, after the other 21 Oct 2026 migrations:
-- 20261021100000 (prior months), 20261021110000 (filing), 20261021120000
-- (reco) and 20261021140000 (BU confirmation, live since 21 Oct). Round 3
-- renamed this file from 20261021130000 so a replay in filename order (a
-- fresh environment, a rebuild) attaches their tables; a table missing when
-- it runs is skipped. If one of 100000 / 110000 / 120000 goes live after
-- this file, apply this file again after it (re-runnable), or, as the
-- postgres role, run the lines of section 6 that name its tables, e.g.
--   SELECT public.gst_change_log_attach('twob_ever_filed');
--   SELECT public.gst_change_log_attach('twob_filed_figures');
--   SELECT public.gst_change_log_attach('twob_carry_log', p_label => 'r.list');
-- 20261021160000 (BU follow-up, sorts after this file) needs nothing: the
-- column it adds to builder_bu_confirm_requests (earlier_units) is logged as
-- it comes (that table is logged by p_private, not p_only), and it adds
-- columns only to builder_bu_confirm_codes, which is not logged.
-- Apply at a quiet time (not during a bulk import or a report run): attaching
-- takes a short ACCESS EXCLUSIVE lock on each of the 109 tables, held until
-- COMMIT. The file sets lock_timeout = 5 s: if a long query holds a table, the
-- apply stops with "canceling statement due to lock timeout", changes nothing
-- (one transaction), and is simply run again a minute later. A re-run takes the
-- same locks again (it re-attaches every trigger), so it is not free either.
-- 1. Dry checks (SELECT only), note the numbers:
--      SELECT to_regclass('public.gst_change_log'), to_regclass('public.gst_change_log_stage');  -- NULL, NULL
--      SELECT to_regprocedure('public.staff_level_of(uuid)') IS NOT NULL;          -- true
--      SELECT current_setting('server_version_num')::int >= 160000;               -- true (17.6 on 21 Oct; pg_input_is_valid)
--      SELECT to_regclass('public.manual_source_allowances');                     -- the filing/reco table
--      SELECT count(*) FROM unnest(ARRAY['twob_ever_filed','twob_filed_figures','twob_carry_log',
--        'builder_bu_confirm_requests','builder_bu_confirm_answer_history','filing_status_log',
--        'reco_opening_log']) t WHERE to_regclass('public.' || t) IS NOT NULL;      -- 7 (the sibling migrations are in)
--      SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
--         AND table_name = 'builder_bu_agreement_confirmations'
--         AND column_name IN ('token', 'request_id', 'responded_by_email');       -- 3 (20261021140000 is in)
--      SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'gst_change_log%';       -- 0
--      SELECT pg_size_pretty(pg_database_size(current_database()));                -- 137 MB on 21 Oct
--      SELECT count(*) FROM unnest(ARRAY['twob_import_docs','books_register','bills_not_in_2b',
--        'bills_not_in_books','itc_summaries','suspended_reco','gst_receivable_reco','filing_status',
--        'gstr1_data','clients','gst_drc03_filings','gst_refund_applications','client_scheme_history']) t
--        WHERE to_regclass('public.' || t) IS NOT NULL;                           -- 13
--      Row counts to compare after: SELECT (SELECT count(*) FROM filing_status),
--        (SELECT count(*) FROM bills_not_in_books), (SELECT count(*) FROM twob_import_docs),
--        (SELECT count(*) FROM clients), (SELECT count(*) FROM builder_receipts),
--        (SELECT count(*) FROM gst_drc03_filings);
--        -- 21 Oct: 8195, 45024, 3559, 127, the builder receipts, 254
--      No long query on the GST tables right now (expect no rows):
--      SELECT pid, now() - xact_start AS running, left(query, 80) FROM pg_stat_activity
--       WHERE state <> 'idle' AND xact_start < now() - interval '30 seconds';
-- 2. Apply this file once (safe to apply again; a re-run re-attaches the
--    triggers and changes nothing else). On "lock timeout": wait a minute and
--    apply again.
-- 3. After checks:
--      SELECT mode, count(*) FROM gst_change_log_tables GROUP BY 1;  -- full 97, record 5, history 7 (109)
--        (with every sibling migration in; without 20261021100000: full 94; without
--         20261021140000: full 96, history 6. A smaller number names a missing table:
--         SELECT table_name FROM gst_change_log_tables ORDER BY 1)
--      SELECT table_name, private_columns FROM gst_change_log_tables WHERE private_columns <> '{}';
--        -- builder_bu_agreement_confirmations {token}, builder_bu_confirm_requests {token}
--      SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
--         AND starts_with(proname, 'gst_change_log_for_') AND pronargs = 5;  -- 109, one log writer per table
--      SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'gst_change_log_%' AND NOT tgisinternal;
--        -- (97 + 5)*4 + 7*3 = 429 row triggers (and truncate), plus 2 on gst_change_log itself,
--        -- 16 (keep / forget on the 8 builder parents) and the flush = 448
--      SELECT count(*) FROM pg_trigger WHERE tgname IN ('gst_change_log_ins','gst_change_log_upd','gst_change_log_del')
--         AND (tgtype & 1) = 0;                                       -- 0 (every one a row trigger)
--      SELECT relname, relpersistence FROM pg_class WHERE relname IN ('gst_change_log_stage','gst_change_log_pending');
--        -- both 'u' (unlogged)
--      SELECT tgdeferrable, tginitdeferred FROM pg_trigger WHERE tgname = 'gst_change_log_flush';  -- t, t
--      SELECT string_agg(indexname, ',' ORDER BY indexname) FROM pg_indexes WHERE tablename = 'gst_change_log';
--        -- gst_change_log_actor_at,gst_change_log_at_id,gst_change_log_client_month_at,gst_change_log_fy_at,
--        -- gst_change_log_month_at,gst_change_log_pkey,gst_change_log_table_row
--      EXPLAIN SELECT key FROM gst_change_history ORDER BY at DESC, seq DESC LIMIT 201;
--        -- an Index Scan using gst_change_log_at_id (never a Seq Scan on gst_change_log)
--      EXPLAIN SELECT key FROM gst_change_history WHERE fy >= '2025-26' AND fy <= '2025-26'
--        ORDER BY fy, at DESC, seq DESC LIMIT 201;  -- an Index (Only) Scan using gst_change_log_fy_at
--      SELECT count(*) FROM gst_change_log;                         -- 0 until the first save
--      SELECT count(*) FROM gst_change_log_gone;                    -- 0 until a builder parent is deleted
--      SELECT (SELECT count(*) FROM gst_change_log_stage), (SELECT count(*) FROM gst_change_log_pending);
--        -- 0, 0: kept rows live only until their transaction ends
--      The row counts of step 1 unchanged.
--      SELECT has_table_privilege('anon', 'public.gst_change_log', 'SELECT'),        -- true
--             has_table_privilege('anon', 'public.gst_change_log', 'INSERT'),        -- false
--             has_table_privilege('anon', 'public.gst_change_log', 'DELETE'),        -- false
--             has_table_privilege('anon', 'public.gst_change_log_gone', 'INSERT'),   -- false
--             has_table_privilege('anon', 'public.gst_change_log_stage', 'INSERT'),  -- false
--             has_table_privilege('anon', 'public.gst_change_log_stage', 'SELECT'),  -- false
--             has_table_privilege('anon', 'public.gst_change_log_pending', 'INSERT'),-- false
--             has_function_privilege('anon', 'public.gst_change_log_whoami()', 'execute'),  -- true
--             has_function_privilege('anon', 'public.gst_change_log_for_filing_status(bigint,uuid,text,text,text)', 'execute'), -- false
--             has_function_privilege('anon', 'public.gst_change_log_attach(text,text,text,text,text[],text[],text[],text,text,text[])', 'execute'); -- false
--    With the anon key from .env (a read; the header reaches the database):
--      curl "$URL/rest/v1/rpc/gst_change_log_whoami" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
--        -H "x-gst-actor: <a staff user_id>" -H "x-gst-source: app" -H "x-gst-request: check-1"
--      -> {"actor_id": "<that id>", "actor_name": "<their first name>", "source": "app", "request_id": "check-1"}
--    and a refused delete (changes nothing):
--      curl -X DELETE "$URL/rest/v1/gst_change_log?id=eq.1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
--      -> 401/403 "permission denied for table gst_change_log"
--    After the app is deployed and someone saves anything (the log row is there
--    once the save's request has returned):
--      SELECT actor_source, actor_basis, count(*) FROM gst_change_log GROUP BY 1, 2;
--      -- app / header for the app's saves; extension / header once 0.17.0 runs a pull
--      SELECT (SELECT count(*) FROM gst_change_log_stage), (SELECT count(*) FROM gst_change_log_pending);
--      -- 0, 0 between requests (a non-zero count that stays means a transaction is still open)
--      SELECT pg_size_pretty(pg_total_relation_size('public.gst_change_log'));    -- watch monthly
-- 4. Release the same day, in this order: this migration, the app (Vercel:
--    sends the headers, each tab its own user; Change history page, deleted
--    clients by their kept name and GSTIN), extension 0.17.0 in every office
--    Chrome (chrome://extensions -> Reload from the updated folder; sends
--    x-gst-source: extension and the app user's id for every job the app
--    started, and the requester's for a job someone queued, on the Chrome
--    runner and the agent), the office agent (git pull, npm ci, restart the
--    service; sends x-gst-source: agent and the job's requester to the
--    extension). Until each part is updated its writes are still logged, with
--    no person unless they write a saved-by stamp (actor_source 'unknown').
--    No Edge Function changes.
--    MIN_EXTENSION_VERSION is not raised now: an older extension still works
--    and is still logged. Once every office Chrome shows 0.17.0, raise it to
--    0.17.0 (src/lib/extensionVersion.ts) so no write arrives without the
--    source.
-- 5. Later migrations: one that renames or drops a column of a logged table
--    must attach that table again in the same file (the log writer names the
--    columns it reads; a save whose log cannot be written fails its COMMIT).
--    A new column is logged as it comes, except on a table logged in part by
--    p_only (clients: add it to the list and attach again).

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
  IF y ~ '^[0-9]{4}-[0-9]{4}$' THEN
    IF right(y, 4)::int = left(y, 4)::int + 1 THEN RETURN left(y, 5) || right(y, 2); END IF;
    y := NULL;  -- several years (a DRC-03 for 2017-2022): no one financial year
  END IF;
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
  'Every change to the GST working tables (gst_change_log_tables), append-only. 20261021150000_gst_change_log.sql, docs/GST_CHANGE_LOG.md.';

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
ALTER TABLE public.gst_change_log_tables ADD COLUMN IF NOT EXISTS private_columns text[] NOT NULL DEFAULT '{}';
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
-- header (an old tab, an old extension): 'unknown'. Read once per COMMIT
-- (by the flush, section 5; whoami too) and opens no subtransaction (a value
-- that is not JSON, which PostgREST never sends, is read as no headers); what
-- it found is kept for the rest of the transaction while the headers stay the
-- same (gst_change_log.context).
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
-- connection. Called only inside the flush and the context, which run as the
-- owner, so neither needs SECURITY DEFINER nor its search_path switch per
-- row; no API role may call them.)
CREATE OR REPLACE FUNCTION public.gst_change_log_actor_name(p_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
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
-- its client through its project, unit, booking ...; when its log row is
-- written (at COMMIT, round 3) a parent deleted in that transaction is gone
-- (round 2: the receipts, bookings and charges of a deleted unit were logged
-- with no client). So before a parent row goes, gst_change_log_keep_client()
-- keeps its client here, with the deleting transaction, and
-- gst_change_log_client_of() reads it once the parent is gone. The next
-- delete of a parent removes what finished transactions kept (a few rows at
-- most). Read by the log writers, written only by those triggers.
CREATE TABLE IF NOT EXISTS public.gst_change_log_gone (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL,
  txid bigint NOT NULL DEFAULT txid_current()
);
CREATE INDEX IF NOT EXISTS gst_change_log_gone_txid ON public.gst_change_log_gone (txid);
COMMENT ON TABLE public.gst_change_log_gone IS
  'The client of a builder parent row being deleted, for the change log of the rows its delete cascades to; kept for the deleting transaction. 20261021150000_gst_change_log.sql.';
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
-- 5. The loggers: kept as each row changes, written to the log at COMMIT
-- ===========================================================================
-- Round 3: the save itself only keeps each changed row. A row trigger on
-- every logged table (gst_change_log_stage_row, one function for all) copies
-- the row as it was and as it is into gst_change_log_stage, about 15 µs a
-- row, and marks the transaction (gst_change_log_pending, once). At COMMIT a
-- deferred trigger (gst_change_log_flush) writes the log rows of the whole
-- transaction, table by table, each by its own function
-- gst_change_log_for_<table> (written by gst_change_log_attach from how the
-- table is read: its key, client, month, year and name, its saved-by stamps,
-- its JSON columns): one INSERT ... SELECT for all the table's rows, planned
-- once per connection. Round 2 logged at the end of every statement, about
-- 0.2 ms a statement and 0.05 ms a row; a function that saves entry by entry
-- (the prior-month door: 1,000 removals are 3,000 statements) spent more time
-- logging than saving (round 3 review). A statement that changes no row costs
-- nothing (no row trigger fires).
-- Nothing is lost or half-kept: the staged rows are part of the transaction
-- (a rolled-back savepoint takes its rows and its mark with it), the log rows
-- are written before the transaction commits, and an error writing them
-- (only a wrong attach expression could cause one; every expression is
-- checked when attaching) fails the COMMIT, so the save is refused, never
-- kept untraced. The stage is UNLOGGED (no WAL: its rows live only until
-- their transaction commits) and open to no API role.
-- Who: the x-gst-actor header, read once at COMMIT (a request's headers do
-- not change within it); without it, a stamp column the change itself wrote
-- (on INSERT the row's own stamp; on UPDATE only a stamp that changed, never
-- one left as the last editor stamped it); else no one.
-- Within one transaction the log rows go table by table (in the order each
-- table was first written), each table's rows in the order they changed; a
-- transaction's rows share one moment (now()), as before.
-- Reading the log in the transaction that wrote it shows nothing yet; SET
-- CONSTRAINTS ALL IMMEDIATE writes what is kept so far (the tests use it).
CREATE OR REPLACE FUNCTION public.gst_change_log_fn_name(p_table text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN length('gst_change_log_for_' || p_table) <= 63 THEN 'gst_change_log_for_' || p_table
              ELSE 'gst_change_log_for_' || left(p_table, 35) || '_' || left(md5(p_table), 8) END
$$;

-- TRUNCATE skips the row triggers: record at once that it happened and how many rows went.
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

-- The rows changed by transactions still open: the row as it was (o) and as
-- it is (n), each whole as JSON (a table logged in part keeps only the
-- columns its log reads: clients never its passwords). Emptied by the flush
-- before COMMIT. Large values go out of line uncompressed (STORAGE EXTERNAL):
-- they are read back once, moments later.
CREATE UNLOGGED TABLE IF NOT EXISTS public.gst_change_log_stage (
  id bigserial,
  txid bigint NOT NULL,
  table_name text NOT NULL,
  op "char" NOT NULL,
  o jsonb,
  n jsonb
);
ALTER TABLE public.gst_change_log_stage ALTER COLUMN o SET STORAGE EXTERNAL, ALTER COLUMN n SET STORAGE EXTERNAL;
CREATE INDEX IF NOT EXISTS gst_change_log_stage_txid ON public.gst_change_log_stage (txid);
COMMENT ON TABLE public.gst_change_log_stage IS
  'Rows changed by open transactions, written to gst_change_log at their COMMIT (gst_change_log_flush). 20261021150000_gst_change_log.sql.';
-- One row per open transaction that kept rows; its deferred trigger is the flush.
CREATE UNLOGGED TABLE IF NOT EXISTS public.gst_change_log_pending (
  txid bigint PRIMARY KEY
);
COMMENT ON TABLE public.gst_change_log_pending IS
  'An open transaction with rows in gst_change_log_stage; its deferred trigger writes them to gst_change_log at COMMIT. 20261021150000_gst_change_log.sql.';
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gst_change_log_stage', 'gst_change_log_pending'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
  EXECUTE 'REVOKE ALL ON SEQUENCE public.gst_change_log_stage_id_seq FROM PUBLIC, anon, authenticated, service_role';
END
$do$;

-- The row trigger of every logged table: keep the row (as it was, as it is)
-- and mark the transaction once. Its arguments, when given, are the only
-- columns kept, or, after a first '-', the columns never kept (a link's
-- token). (Each branch one statement: this runs for every row saved.)
CREATE OR REPLACE FUNCTION public.gst_change_log_stage_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_NARGS > 0 AND TG_ARGV[0] = '-' THEN
    INSERT INTO public.gst_change_log_stage (txid, table_name, op, o, n)
    VALUES (txid_current(), TG_TABLE_NAME, left(TG_OP, 1)::"char",
            CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - TG_ARGV[1:TG_NARGS - 1] END,
            CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - TG_ARGV[1:TG_NARGS - 1] END);
  ELSIF TG_NARGS > 0 THEN
    INSERT INTO public.gst_change_log_stage (txid, table_name, op, o, n)
    SELECT txid_current(), TG_TABLE_NAME, left(TG_OP, 1)::"char",
           (SELECT jsonb_object_agg(k, x.o -> k) FROM unnest(TG_ARGV) k WHERE x.o ? k),
           (SELECT jsonb_object_agg(k, x.n -> k) FROM unnest(TG_ARGV) k WHERE x.n ? k)
      FROM (SELECT CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END AS o,
                   CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END AS n) x;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.gst_change_log_stage (txid, table_name, op, o, n)
    VALUES (txid_current(), TG_TABLE_NAME, 'U', to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.gst_change_log_stage (txid, table_name, op, n)
    VALUES (txid_current(), TG_TABLE_NAME, 'I', to_jsonb(NEW));
  ELSE
    INSERT INTO public.gst_change_log_stage (txid, table_name, op, o)
    VALUES (txid_current(), TG_TABLE_NAME, 'D', to_jsonb(OLD));
  END IF;
  IF current_setting('gst_change_log.pending', true) IS DISTINCT FROM 'on' THEN
    INSERT INTO public.gst_change_log_pending (txid) VALUES (txid_current()) ON CONFLICT DO NOTHING;
    PERFORM set_config('gst_change_log.pending', 'on', true);
  END IF;
  RETURN NULL;
END;
$$;

-- At COMMIT (deferred): write the transaction's kept rows to the log, table
-- by table. Clears the mark first, so a write made after this (by another
-- deferred trigger) marks the transaction again and is written too.
CREATE OR REPLACE FUNCTION public.gst_change_log_flush()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx bigint := NEW.txid;
  v_ctx record;
  t record;
BEGIN
  PERFORM set_config('gst_change_log.pending', '', true);
  DELETE FROM public.gst_change_log_pending WHERE txid = v_tx;
  SELECT * INTO v_ctx FROM public.gst_change_log_context();
  FOR t IN
    SELECT s.table_name, min(s.id) AS first_id
      FROM public.gst_change_log_stage s
     WHERE s.txid = v_tx
     GROUP BY s.table_name
     ORDER BY 2
  LOOP
    EXECUTE format('SELECT public.%I($1, $2, $3, $4, $5)', public.gst_change_log_fn_name(t.table_name))
      USING v_tx, v_ctx.actor, v_ctx.actor_name, v_ctx.source, v_ctx.request;
  END LOOP;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS gst_change_log_flush ON public.gst_change_log_pending;
CREATE CONSTRAINT TRIGGER gst_change_log_flush
  AFTER INSERT ON public.gst_change_log_pending
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.gst_change_log_flush();

-- Attaches the logger to one table (re-runnable; a table that does not
-- exist is skipped): writes its function gst_change_log_for_<table> (the
-- table's part of the flush) and its row triggers. Expressions are SQL on
-- the row (alias r) and are checked against the table here, and the
-- function is run once on nothing, so a wrong column fails the migration,
-- never a save. p_only: the only columns logged (and kept); p_private:
-- columns never kept or logged (a column added later is logged, unlike with
-- p_only).
-- (Round 2's attach had no p_private: dropped so a call is never ambiguous.)
DROP FUNCTION IF EXISTS public.gst_change_log_attach(text, text, text, text, text[], text[], text[], text, text);
CREATE OR REPLACE FUNCTION public.gst_change_log_attach(
  p_table text,
  p_client text DEFAULT 'r.client_id',
  p_month text DEFAULT 'r.period_month',
  p_fy text DEFAULT 'NULL',
  p_summary text[] DEFAULT '{}',
  p_skip text[] DEFAULT '{}',
  p_only text[] DEFAULT NULL,
  p_mode text DEFAULT 'full',
  p_label text DEFAULT NULL,
  p_private text[] DEFAULT '{}')
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
  v_key_moved text;
  v_actor_ins text := 'NULL::uuid';
  v_actor_upd text := 'NULL::uuid';
  v_summary text := quote_literal(p_summary::text) || '::text[]';
  v_only text := CASE WHEN p_only IS NULL THEN 'NULL::text[]' ELSE quote_literal(p_only::text) || '::text[]' END;
  v_skip text := quote_literal((p_skip || ARRAY['updated_at'])::text) || '::text[]';
  v_hide text;
  v_keep_full text := CASE WHEN p_mode IN ('history', 'record') THEN 'true' ELSE 'false' END;
  v_row_new text;
  v_row_old text;
  v_m text;
  v_y text;
  v_kept text[];
  v_args text := '';
  v_cols text;
  v_fy_expr text;
  v_diff text;
BEGIN
  IF v_rel IS NULL THEN
    RETURN p_table || ': missing, skipped';
  END IF;
  IF p_mode NOT IN ('full', 'history', 'record') THEN
    RAISE EXCEPTION 'gst_change_log_attach(%): mode must be full, history or record', p_table;
  END IF;
  IF p_only IS NOT NULL AND cardinality(p_private) > 0 THEN
    RAISE EXCEPTION 'gst_change_log_attach(%): give p_only or p_private, not both', p_table;
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
    FROM unnest(p_summary || p_skip || COALESCE(p_only, '{}') || p_private) x
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

  -- The pieces of the table's SQL. r is the row (typed, from its JSON); s
  -- the kept row: s.o as it was, s.n as it is.
  v_key_r := 'concat_ws(''|'', ' || (SELECT string_agg('r.' || quote_ident(k) || '::text', ', ' ORDER BY o) FROM unnest(v_key) WITH ORDINALITY u(k, o)) || ')';
  v_key_moved := (SELECT string_agg(format('(s.o -> %1$L) IS DISTINCT FROM (s.n -> %1$L)', k), ' OR ') FROM unnest(v_key) k);
  v_hide := quote_literal((v_key || ARRAY['client_id'])::text) || '::text[]';
  -- An inserted or deleted row: on a table without JSON columns, every
  -- filled column, read by built-in functions (most rows logged are ledger
  -- rows); otherwise gst_change_log_row, which fingerprints large JSON.
  IF cardinality(p_summary) = 0 AND p_only IS NULL
     AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped
                        AND a.atttypid IN ('json'::regtype, 'jsonb'::regtype)) THEN
    v_row_new := format('(jsonb_strip_nulls(s.n) - %s)', v_hide);
    v_row_old := format('(jsonb_strip_nulls(s.o) - %s)', v_hide);
  ELSE
    v_row_new := format('public.gst_change_log_row(s.n, %s, %s, %s, false)', v_summary, v_hide, v_only);
    v_row_old := format('public.gst_change_log_row(s.o, %s, %s, %s, %s)', v_summary, v_hide, v_only, v_keep_full);
  END IF;
  IF cardinality(v_actor) > 0 THEN
    v_actor_ins := (SELECT string_agg(format('(s.n ->> %L)::uuid', a), ', ' ORDER BY o) FROM unnest(v_actor) WITH ORDINALITY u(a, o)) || ', NULL::uuid';
    v_actor_upd := (SELECT string_agg(format('CASE WHEN (s.n -> %1$L) IS DISTINCT FROM (s.o -> %1$L) THEN (s.n ->> %1$L)::uuid END', a), ', ' ORDER BY o)
                      FROM unnest(v_actor) WITH ORDINALITY u(a, o)) || ', NULL::uuid';
  END IF;

  -- The month and year (MM/YYYY as it is, any other spelling normalised).
  v_m := CASE WHEN p_month = 'NULL' THEN 'NULL::text' ELSE format(
    '(CASE WHEN (%1$s)::text ~ ''^(0[1-9]|1[0-2])/[0-9]{4}$'' THEN (%1$s)::text ELSE public.gst_change_log_month((%1$s)::text) END)', p_month) END;
  v_y := format('(%s)::text', p_fy);
  -- Checked here, so a month or year that cannot be read fails the migration.
  EXECUTE format('SELECT %s, public.gst_change_log_fy(%s, %s) FROM public.%I r LIMIT 0', v_m, v_y, v_m, p_table);
  -- The year of a change with no year column of its own, from its month
  -- (x.m is MM/YYYY or NULL), worked out in place (gst_change_log_fy, without
  -- a function call per row).
  v_fy_expr := CASE WHEN p_fy = 'NULL' THEN
    '(CASE WHEN x.m IS NULL THEN NULL ELSE (right(x.m, 4)::int - (left(x.m, 2)::int < 4)::int)::text || ''-'' '
    || '|| lpad(((right(x.m, 4)::int - (left(x.m, 2)::int < 4)::int + 1) % 100)::text, 2, ''0'') END)'
    ELSE 'public.gst_change_log_fy(x.y, x.m)' END;

  -- The row r, typed, with only the columns its key and expressions read
  -- (read from its JSON as jsonb_populate_record would, column by column).
  SELECT string_agg(quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
    INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped
     AND (a.attname = ANY (v_key)
          OR a.attname IN (SELECT m[1] FROM regexp_matches(concat_ws(' ', p_client, p_month, p_fy, v_label),
                                                           '\mr\.([a-z_][a-z0-9_]*)', 'g') m));
  -- An update's changed columns, {column: {old, new}} (JSON values and
  -- lists as the leaves that changed): gst_change_log_diff's SQL, written in
  -- place (a function call per row cost a planned statement per row).
  v_diff := format($d$(SELECT jsonb_object_agg(e.key, CASE
           WHEN jsonb_typeof(s.o -> e.key) IN ('object', 'array') OR jsonb_typeof(e.value) IN ('object', 'array')
             THEN public.gst_change_log_json_change(s.o -> e.key, e.value, e.key = ANY (%1$s))
           ELSE jsonb_build_object('old', s.o -> e.key, 'new', e.value)
         END)
    FROM jsonb_each(s.n) e
   WHERE (s.o -> e.key) IS DISTINCT FROM e.value
     AND NOT (e.key = ANY (%2$s))%3$s)$d$, v_summary, v_skip,
    CASE WHEN p_only IS NULL THEN '' ELSE format(' AND e.key = ANY (%s)', v_only) END);

  -- A table logged in part keeps only what its log reads: the listed
  -- columns, its key, its stamps and the columns its expressions name.
  IF p_only IS NOT NULL THEN
    SELECT array_agg(DISTINCT c ORDER BY c) INTO v_kept
      FROM (SELECT unnest(p_only || v_key || v_actor) AS c
            UNION SELECT m[1] FROM regexp_matches(concat_ws(' ', p_client, p_month, p_fy, v_label), '\mr\.([a-z_][a-z0-9_]*)', 'g') m) x
     WHERE EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_rel AND a.attname = x.c AND a.attnum > 0 AND NOT a.attisdropped);
    v_args := (SELECT string_agg(quote_literal(c), ', ' ORDER BY c) FROM unnest(v_kept) c);
  ELSIF cardinality(p_private) > 0 THEN
    IF EXISTS (SELECT 1 FROM unnest(p_private) c WHERE c = ANY (v_key)) THEN
      RAISE EXCEPTION 'gst_change_log_attach(%): a key column cannot be private', p_table;
    END IF;
    v_args := '''-'', ' || (SELECT string_agg(quote_literal(c), ', ' ORDER BY c) FROM unnest(p_private) c);
  END IF;

  -- The table's part of the flush: its kept rows of transaction p_txid, as
  -- log rows, in the order they changed. A row whose key changed is logged
  -- under its old key and its new one, each with both sides. An update of
  -- skipped columns only (updated_at) is no change. Whole rows are always
  -- written alias.* (a table may have a column named like an alias).
  EXECUTE format($gen$
CREATE OR REPLACE FUNCTION public.%1$I(p_txid bigint, p_actor uuid, p_name text, p_source text, p_request text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
-- The change log of public.%2$I, written at COMMIT by gst_change_log_flush.
-- Written by gst_change_log_attach (20261021150000_gst_change_log.sql):
-- attach the table again to change it.
BEGIN
  WITH s AS (
    DELETE FROM public.gst_change_log_stage g
     WHERE g.txid = p_txid AND g.table_name = %2$L
    RETURNING g.id, g.op, g.o, g.n)
  INSERT INTO public.gst_change_log
    (table_name, row_id, row_label, client_id, period_month, financial_year, fy, op, actor_id, actor_name, actor_source, actor_basis, changed, request_id)
  SELECT %2$L, %3$s, left((%4$s)::text, 120), (%5$s)::uuid, x.m, x.y, %17$s,
         CASE s.op WHEN 'I' THEN 'INSERT' WHEN 'U' THEN 'UPDATE' ELSE 'DELETE' END,
         a.id, CASE WHEN p_actor IS NOT NULL THEN p_name WHEN a.id IS NOT NULL THEN public.gst_change_log_actor_name(a.id) END,
         p_source, CASE WHEN p_actor IS NOT NULL THEN 'header' WHEN a.id IS NOT NULL THEN 'row' ELSE 'none' END,
         d.changed, p_request
    FROM s
   CROSS JOIN LATERAL (SELECT false AS old_side UNION ALL SELECT true WHERE s.op = 'U' AND (%6$s)) k
   CROSS JOIN LATERAL jsonb_to_record(CASE WHEN k.old_side THEN s.o ELSE COALESCE(s.n, s.o) END) AS r(%16$s)
   CROSS JOIN LATERAL (SELECT %7$s AS m, %8$s AS y OFFSET 0) x
   CROSS JOIN LATERAL (SELECT CASE s.op
       WHEN 'I' THEN %9$s
       WHEN 'D' THEN %10$s
       ELSE CASE WHEN %6$s THEN jsonb_build_object('_key_changed', true,
              'old', public.gst_change_log_row(s.o, %11$s, '{}'::text[], %12$s, false),
              'new', public.gst_change_log_row(s.n, %11$s, '{}'::text[], %12$s, false))
            ELSE %18$s END
     END AS changed OFFSET 0) d
   CROSS JOIN LATERAL (SELECT CASE s.op WHEN 'D' THEN p_actor WHEN 'I' THEN COALESCE(p_actor, %14$s)
                                        ELSE COALESCE(p_actor, %15$s) END AS id) a
   WHERE d.changed IS NOT NULL
   ORDER BY s.id, k.old_side;
END
$fn$
$gen$, v_fn, p_table, v_key_r, v_label, p_client, v_key_moved, v_m, v_y, v_row_new, v_row_old,
       v_summary, v_only, v_skip, v_actor_ins, v_actor_upd, v_cols, v_fy_expr, v_diff);
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(bigint, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role', v_fn);
  -- Run once on nothing: plans its SQL, so an error shows here.
  EXECUTE format('SELECT public.%I(-1, NULL, NULL, NULL, NULL)', v_fn);

  EXECUTE format('DROP TRIGGER IF EXISTS gst_change_log_ins ON public.%I', p_table);
  EXECUTE format('DROP TRIGGER IF EXISTS gst_change_log_upd ON public.%I', p_table);
  EXECUTE format('DROP TRIGGER IF EXISTS gst_change_log_del ON public.%I', p_table);
  EXECUTE format('DROP TRIGGER IF EXISTS gst_change_log_trunc ON public.%I', p_table);
  -- Round 2's statement logger of this table (never applied live).
  EXECUTE format('DROP FUNCTION IF EXISTS public.%I()', v_fn);
  IF p_mode IN ('full', 'record') THEN
    EXECUTE format('CREATE TRIGGER gst_change_log_ins AFTER INSERT ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.gst_change_log_stage_row(%s)', p_table, v_args);
  END IF;
  -- An update that rewrote the row as it was (same bytes) is no change.
  EXECUTE format('CREATE TRIGGER gst_change_log_upd AFTER UPDATE ON public.%I '
                 'FOR EACH ROW WHEN (OLD *<> NEW) EXECUTE FUNCTION public.gst_change_log_stage_row(%s)', p_table, v_args);
  EXECUTE format('CREATE TRIGGER gst_change_log_del AFTER DELETE ON public.%I '
                 'FOR EACH ROW EXECUTE FUNCTION public.gst_change_log_stage_row(%s)', p_table, v_args);
  EXECUTE format('CREATE TRIGGER gst_change_log_trunc BEFORE TRUNCATE ON public.%I '
                 'FOR EACH STATEMENT EXECUTE FUNCTION public.gst_change_log_truncate()', p_table);

  INSERT INTO public.gst_change_log_tables
    (table_name, mode, client_expr, month_expr, fy_expr, label_expr, key_columns, actor_columns, summary_columns, skip_columns, only_columns,
     private_columns, attached_at)
  VALUES (p_table, p_mode, p_client, p_month, p_fy, v_label, v_key, v_actor, p_summary, p_skip, p_only, p_private, now())
  ON CONFLICT (table_name) DO UPDATE SET
    mode = EXCLUDED.mode, client_expr = EXCLUDED.client_expr, month_expr = EXCLUDED.month_expr,
    fy_expr = EXCLUDED.fy_expr, label_expr = EXCLUDED.label_expr, key_columns = EXCLUDED.key_columns, actor_columns = EXCLUDED.actor_columns,
    summary_columns = EXCLUDED.summary_columns, skip_columns = EXCLUDED.skip_columns,
    only_columns = EXCLUDED.only_columns, private_columns = EXCLUDED.private_columns, attached_at = EXCLUDED.attached_at;
  RETURN p_table || ': ' || p_mode;
END;
$$;

REVOKE ALL ON FUNCTION public.gst_change_log_attach(text, text, text, text, text[], text[], text[], text, text, text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.gst_change_log_client_of(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gst_change_log_actor_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gst_change_log_context() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gst_change_log_stage_row() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.gst_change_log_flush() FROM PUBLIC, anon, authenticated, service_role;
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
    -- DRC-03 payments (Annual Return set-offs name them) and refund
    -- applications, as the notices sync pulls them; a re-pull that only
    -- touches when it was seen or pulled is no change
    UNION ALL SELECT public.gst_change_log_attach('gst_drc03_filings', p_month => 'NULL', p_fy => 'r.financial_year',
      p_skip => '{last_seen_at,pulled_at,pulled_by,portal_hash}', p_label => 'concat_ws('' · '', r.arn, r.cause_of_payment)')
    UNION ALL SELECT public.gst_change_log_attach('gst_refund_applications', p_month => 'NULL',
      p_skip => '{last_seen_at,pulled_at,pulled_by,portal_hash}', p_label => 'concat_ws('' · '', r.arn, r.refund_type)')
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
    -- BU agreement confirmations and their e-mails (20261021140000, live
    -- since 21 Oct; skipped where missing): never a link's token; the
    -- one-time codes (builder_bu_confirm_codes) are private and not logged
    UNION ALL SELECT public.gst_change_log_attach('builder_bu_agreement_confirmations', p_month => 'NULL', p_private => '{token}')
    UNION ALL SELECT public.gst_change_log_attach('builder_bu_confirm_requests', p_month => 'NULL', p_private => '{token}',
      p_label => 'array_to_string(r.to_emails, '', '')')
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
    -- fingerprint); edited or deleted, logged too, a deleted one kept whole.
    -- So are a scheme change (round 3: its effective date and notes are the
    -- only record of why filing rows were reset) and a unit's
    -- classification (its rate code and affordable flag live only there)
    UNION ALL SELECT public.gst_change_log_attach('client_scheme_history', p_month => 'NULL', p_mode => 'record')
    UNION ALL SELECT public.gst_change_log_attach('builder_unit_classification_history', p_client => 'public.gst_change_log_client_of(''unit'', r.unit_id)', p_month => 'NULL', p_mode => 'record')
    UNION ALL SELECT public.gst_change_log_attach('gstr1_upload_versions', p_summary => '{payload,errors}', p_mode => 'record')
    UNION ALL SELECT public.gst_change_log_attach('gstr1_upload_versions_quarantine', p_summary => '{payload,errors}', p_mode => 'record')
    UNION ALL SELECT public.gst_change_log_attach('gstr3b_push_versions', p_summary => '{payload}', p_mode => 'record')
    -- History tables: UPDATE and DELETE only; a deleted one is kept whole
    UNION ALL SELECT public.gst_change_log_attach('twob_versions', p_summary => '{version_data}', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('itc_versions', p_summary => '{version_data}', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('rcm_versions', p_month => 'NULL', p_fy => 'r.financial_year', p_summary => '{version_data}', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('gst_update_versions', p_month => 'NULL', p_summary => '{version_data}', p_mode => 'history')
    UNION ALL SELECT public.gst_change_log_attach('gst_update_row_versions', p_client => 'public.gst_change_log_client_of(''running_update'', r.row_id)', p_month => 'NULL', p_mode => 'history')
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
