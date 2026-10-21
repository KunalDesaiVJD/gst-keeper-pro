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

-- 3. The page queries use an index on a large log (200,000 rows over the
-- last two years, a change every five minutes, each to the month before it,
-- as the firm works; rolled back). Round 2: a year or a month with no client
-- read the whole log newest first.
BEGIN;
INSERT INTO gst_change_log (at, table_name, row_id, client_id, period_month, fy, op, actor_id, actor_source, actor_basis, changed)
SELECT t.at, 'bills_not_in_books', g::text,
       CASE WHEN g % 50 = 0 THEN '20000000-0000-0000-0000-000000000001'::uuid ELSE gen_random_uuid() END, m.p,
       gst_change_log_fy(NULL, m.p), 'UPDATE',
       CASE WHEN g % 1000 = 0 THEN '10000000-0000-0000-0000-000000000001'::uuid END, 'app', 'header',
       jsonb_build_object('input_igst', jsonb_build_object('old', g, 'new', g + 1))
  FROM generate_series(1, 200000) g
 CROSS JOIN LATERAL (SELECT now() - make_interval(secs => g * 300) AS at) t
 CROSS JOIN LATERAL (SELECT CASE WHEN g % 50 = 0 THEN '09/2026' ELSE to_char(t.at - interval '20 days', 'MM/YYYY') END AS p) m;
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
-- As the app sends them (src/lib/changeHistory.ts): the leading filter (the
-- client, else the month, else the year, else the person) as a range of one
-- value, and the order led by it, so the read is that filter's index.
SELECT pg_temp.t_plan('one person', $q$SELECT key FROM gst_change_history WHERE actor_id >= '10000000-0000-0000-0000-000000000001'
  AND actor_id <= '10000000-0000-0000-0000-000000000001' ORDER BY actor_id, at DESC, seq DESC LIMIT 201$q$);
SELECT pg_temp.t_plan('one client and month', $q$SELECT key FROM gst_change_history WHERE client_id >= '20000000-0000-0000-0000-000000000001' AND client_id <= '20000000-0000-0000-0000-000000000001'
  AND period_month = '09/2026' ORDER BY client_id, at DESC, seq DESC LIMIT 201$q$);
SELECT pg_temp.t_plan('one client and a year with no changes', $q$SELECT key FROM gst_change_history WHERE client_id >= '20000000-0000-0000-0000-000000000001' AND client_id <= '20000000-0000-0000-0000-000000000001'
  AND fy = '2025-26' ORDER BY client_id, at DESC, seq DESC LIMIT 201$q$);
SELECT pg_temp.t_plan('a financial year, no client', $q$SELECT key FROM gst_change_history WHERE fy >= '2025-26' AND fy <= '2025-26'
  ORDER BY fy, at DESC, seq DESC LIMIT 201$q$);
SELECT pg_temp.t_plan('a financial year with no changes', $q$SELECT key FROM gst_change_history WHERE fy >= '2019-20' AND fy <= '2019-20'
  ORDER BY fy, at DESC, seq DESC LIMIT 201$q$);
SELECT pg_temp.t_plan('a financial year, next page', $q$SELECT key FROM gst_change_history WHERE fy >= '2025-26' AND fy <= '2025-26'
  AND at <= now() - interval '400 days' AND (at < now() - interval '400 days' OR seq < 1) ORDER BY fy, at DESC, seq DESC LIMIT 201$q$);
SELECT pg_temp.t_plan('a month, no client', $q$SELECT key FROM gst_change_history WHERE period_month >= '05/2025' AND period_month <= '05/2025'
  ORDER BY period_month, at DESC, seq DESC LIMIT 201$q$);
-- Round 2 review: the same year sent as an equality alone reads the log newest first.
SELECT pg_temp.t_plan('(an equality alone, for comparison)', $q$SELECT key FROM gst_change_history WHERE fy = '2025-26'
  ORDER BY at DESC, seq DESC LIMIT 201$q$);
RESET ROLE;
SELECT t_eq((SELECT string_agg(what, ', ') FROM t_plans WHERE plan ~ 'Seq Scan on gst_change_log'), NULL::text, 'no page query scans the whole log');
SELECT t_eq((SELECT string_agg(what, ', ') FROM t_plans WHERE what NOT LIKE '(%' AND (substring(plan from 'Rows Removed by Filter: ([0-9]+)'))::int > 5000), NULL::text,
            'no page query reads thousands of rows it does not show');
SELECT t_eq((SELECT plan ~ 'gst_change_log_at_id' FROM t_plans WHERE what = 'first page, no filter'), true, 'the first page reads the (at, id) index');
SELECT t_eq((SELECT plan ~ 'gst_change_log_at_id' FROM t_plans WHERE what = 'next page, no filter'), true, 'the next page too, from where it left off');
SELECT t_eq((SELECT plan ~ 'gst_change_log_actor_at' FROM t_plans WHERE what = 'one person'), true, 'one person: the (actor, at) index');
SELECT t_eq((SELECT string_agg(what, ', ') FROM t_plans WHERE what LIKE 'one client%' AND plan !~ 'gst_change_log_client_month_at'), NULL::text,
            'one client, with a month or a year: the (client, month, at) index');
SELECT t_eq((SELECT string_agg(what, ', ' ORDER BY what) FROM t_plans WHERE what LIKE 'a financial year%' AND plan !~ 'gst_change_log_fy_at'), NULL::text,
            'a year with no client, with or without changes, next page too: the (fy, at) index');
SELECT t_eq((SELECT plan ~ 'gst_change_log_month_at' FROM t_plans WHERE what = 'a month, no client'), true, 'a month with no client: the (month, at) index');
SELECT t_eq((SELECT (substring(plan from 'gst_change_log_fy_at on gst_change_log l \(actual rows=([0-9]+)'))::int <= 202 FROM t_plans WHERE what = 'a financial year, no client'),
            true, 'a year reads about a page of the log, not the whole year');
SELECT t_eq((SELECT (substring(plan from 'Rows Removed by Filter: ([0-9]+)'))::int > 10000 FROM t_plans WHERE what = '(an equality alone, for comparison)'),
            true, 'for comparison: the year as an equality alone reads tens of thousands of rows (why the app leads with a range)');
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT what, ms FROM t_plans ORDER BY what LOOP
    RAISE NOTICE 'TIMING % ms  history page (200,000 log rows): %', lpad(r.ms::text, 7), r.what;
  END LOOP;
END $$;
SELECT t_eq((SELECT max(ms) < 200 FROM t_plans), true, 'each page query well under the 3 s limit');
ROLLBACK;
