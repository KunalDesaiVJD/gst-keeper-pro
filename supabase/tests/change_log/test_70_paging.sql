-- Reading the history (round 1 review): a GSTR-3B push and a GSTR-1 upload
-- are logged when made; pages run newest first by (at, seq) and the next page
-- starts below the last row read, so changes saved meanwhile neither repeat
-- nor hide a row; the page queries the app sends use an index, never a scan
-- of the whole log.
SET search_path = public, extensions;
SET ROLE anon;

-- 1. A push and an upload, as the extension records them: logged on insert,
-- the payload as a fingerprint, the person from the header.
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000003","x-gst-source":"extension","x-gst-request":"t70-push"}');
INSERT INTO gstr3b_push_versions (id, client_id, period_month, version_number, actor_id, status, summary, filled_count, payload)
VALUES ('70000000-0000-0000-0000-000000000101', '20000000-0000-0000-0000-000000000001', '08/2026', 1, '10000000-0000-0000-0000-000000000003',
        'ok', 'Filled 12 cells', 12, jsonb_build_object('sup_details', jsonb_build_object('osup_det', jsonb_build_object('txval', 1000))));
INSERT INTO gstr1_upload_versions (id, client_id, period_month, version_number, actor_id, action_type, status, summary, payload)
VALUES ('70000000-0000-0000-0000-000000000102', '20000000-0000-0000-0000-000000000001', '08/2026', 1, '10000000-0000-0000-0000-000000000003',
        'upload', 'ok', '42 invoices', '{"b2b":[]}');
SELECT t_eq((SELECT string_agg(table_name || ':' || op || ':' || actor_name || ':' || actor_source || ':' || (changed -> 'payload' ->> 'summary') || ':' || (changed ->> 'status'), ', ' ORDER BY table_name)
               FROM gst_change_history WHERE request_id = 't70-push'),
            'gstr1_upload_versions:INSERT:Esha:extension:true:ok, gstr3b_push_versions:INSERT:Esha:extension:true:ok',
            'a push and an upload are in the history when made, the payload as a fingerprint');
SELECT t_eq((SELECT count(*) FROM gst_change_history WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '08/2026'
              AND table_name IN ('gstr3b_adjustments', 'gstr3b_push_versions'))::int, 1, 'the GSTR-3B History button finds the push');
-- The Nil toggle on the GSTR-3B page is a filing_status row named by its return type.
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app"}');
INSERT INTO filing_status (client_id, return_type, period_month, status, is_nil) VALUES
 ('20000000-0000-0000-0000-000000000001', 'GSTR-3B', '08/2026', 'Data Pending', true),
 ('20000000-0000-0000-0000-000000000001', 'GSTR-1', '08/2026', 'Data Pending', false);
SELECT t_eq((SELECT string_agg(row_label, ',' ORDER BY row_label) FROM gst_change_history
              WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '08/2026' AND table_name = 'filing_status'),
            'GSTR-1,GSTR-3B', 'filing rows are named by their return, so a return''s page can pick its own');
RESET ROLE;

-- 2. Keyset pages over 600 changes saved in one statement (one moment), with
-- 30 more saved between the first and second page.
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000003","x-gst-source":"app","x-gst-request":"t70-many"}');
INSERT INTO books_register (client_id, period_month, supplier_name, taxable_value)
SELECT '20000000-0000-0000-0000-000000000002', '06/2026', 'SUPPLIER ' || g, g FROM generate_series(1, 600) g;
RESET ROLE;
CREATE TEMP TABLE t_pages (page int, key text);
DO $$
DECLARE
  v_at timestamptz;
  v_seq bigint;
  v_page int := 0;
  v_n int;
BEGIN
  LOOP
    INSERT INTO t_pages
    SELECT v_page, h.key FROM (
      SELECT key, at, seq FROM gst_change_history
       WHERE client_id = '20000000-0000-0000-0000-000000000002' AND period_month = '06/2026'
         AND (v_at IS NULL OR (at <= v_at AND (at < v_at OR seq < v_seq)))
       ORDER BY at DESC, seq DESC LIMIT 200) h;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    EXIT WHEN v_n = 0;
    -- the last row of the page: the smallest (at, seq) read
    SELECT h.at, h.seq INTO v_at, v_seq FROM gst_change_history h JOIN t_pages p ON p.key = h.key AND p.page = v_page
     ORDER BY h.at, h.seq LIMIT 1;
    IF v_page = 0 THEN
      PERFORM set_config('request.headers', '{"x-gst-source":"app","x-gst-request":"t70-late"}', false);
      INSERT INTO books_register (client_id, period_month, supplier_name, taxable_value)
      SELECT '20000000-0000-0000-0000-000000000002', '06/2026', 'LATE ' || g, g FROM generate_series(1, 30) g;
    END IF;
    v_page := v_page + 1;
    EXIT WHEN v_page > 10;
  END LOOP;
END $$;
SELECT t_eq((SELECT count(*) || ' ' || count(DISTINCT key) FROM t_pages), '600 600', 'every change read once, none twice');
SELECT t_eq((SELECT count(*) FROM t_pages p JOIN gst_change_log l ON 'g' || l.id = p.key WHERE l.request_id = 't70-late')::int, 0,
            'changes saved after the first page start a new first page, never inside the later pages');

-- 3. The page queries use an index on a large log (200,000 rows, rolled back).
BEGIN;
INSERT INTO gst_change_log (at, table_name, row_id, client_id, period_month, op, actor_id, actor_source, actor_basis, changed)
SELECT now() - (g || ' seconds')::interval, 'bills_not_in_books', g::text,
       CASE WHEN g % 50 = 0 THEN '20000000-0000-0000-0000-000000000001'::uuid ELSE gen_random_uuid() END, '09/2026', 'UPDATE',
       CASE WHEN g % 1000 = 0 THEN '10000000-0000-0000-0000-000000000001'::uuid END, 'app', 'header',
       jsonb_build_object('input_igst', jsonb_build_object('old', g, 'new', g + 1))
  FROM generate_series(1, 200000) g;
ANALYZE gst_change_log;
CREATE TEMP TABLE t_plans (what text, plan text, ms numeric);
GRANT ALL ON t_plans TO anon;
CREATE OR REPLACE FUNCTION pg_temp.t_plan(p_what text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_plan text := ''; v_line text; v_ms numeric;
BEGIN
  FOR v_line IN EXECUTE 'EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) ' || p_sql LOOP
    v_plan := v_plan || v_line || E'\n';
  END LOOP;
  v_ms := substring(v_plan from 'Execution Time: ([0-9.]+) ms')::numeric;
  INSERT INTO t_plans VALUES (p_what, v_plan, v_ms);
END $$;
SET ROLE anon;
SELECT pg_temp.t_plan('first page, no filter', $q$SELECT key, at, seq, changed FROM gst_change_history ORDER BY at DESC, seq DESC LIMIT 201$q$);
SELECT pg_temp.t_plan('next page, no filter', $q$SELECT key, at, seq FROM gst_change_history
  WHERE at <= now() - interval '5000 seconds' AND (at < now() - interval '5000 seconds' OR seq < 1) ORDER BY at DESC, seq DESC LIMIT 201$q$);
SELECT pg_temp.t_plan('one person', $q$SELECT key FROM gst_change_history WHERE actor_id = '10000000-0000-0000-0000-000000000001'
  ORDER BY at DESC, seq DESC LIMIT 201$q$);
SELECT pg_temp.t_plan('one client and month', $q$SELECT key FROM gst_change_history WHERE client_id = '20000000-0000-0000-0000-000000000001'
  AND period_month = '09/2026' ORDER BY at DESC, seq DESC LIMIT 201$q$);
RESET ROLE;
SELECT t_eq((SELECT string_agg(what, ', ') FROM t_plans WHERE plan ~ 'Seq Scan on gst_change_log'), NULL::text, 'no page query scans the whole log');
SELECT t_eq((SELECT plan ~ 'gst_change_log_at_id' FROM t_plans WHERE what = 'first page, no filter'), true, 'the first page reads the (at, id) index');
SELECT t_eq((SELECT plan ~ 'gst_change_log_at_id' FROM t_plans WHERE what = 'next page, no filter'), true, 'the next page too, from where it left off');
SELECT t_eq((SELECT plan ~ 'gst_change_log_actor_at' FROM t_plans WHERE what = 'one person'), true, 'one person: the (actor, at) index');
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT what, ms FROM t_plans ORDER BY what LOOP
    RAISE NOTICE 'TIMING % ms  history page (200,000 log rows): %', lpad(r.ms::text, 7), r.what;
  END LOOP;
END $$;
SELECT t_eq((SELECT max(ms) < 200 FROM t_plans), true, 'each page query well under the 3 s limit');
ROLLBACK;
