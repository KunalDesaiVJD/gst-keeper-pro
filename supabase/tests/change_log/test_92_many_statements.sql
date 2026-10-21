-- Round 3 review: a function that saves entry by entry spent more time
-- logging than saving. The prior-month door removes an entry in three small
-- statements (its books row, the entry's link to it, the entry and its three
-- carried copies), so 1,000 removals are 3,000 statements; round 2's
-- statement logger added about 0.2 ms to each (0.65 s on a 0.6 s call), and
-- twob-simple's own 1 s gate failed. The log is now kept row by row and
-- written at COMMIT: the call stays near its own time, and the call and its
-- COMMIT together cost about half of what round 2 added. Best of three runs
-- of each (this machine is shared), as the public key with the app's header.
SET search_path = public, extensions;
CREATE TEMP TABLE t_many (what text, run int, ms numeric);
GRANT ALL ON t_many TO anon;
CREATE INDEX IF NOT EXISTS t_many_ledger ON bills_not_in_2b (client_id, supplier_invoice_number);
CREATE INDEX IF NOT EXISTS t_many_books ON books_register (client_id, supplier_invoice_number);

-- 1,000 books rows, each posted as an entry in July carried to Aug, Sep, Oct.
CREATE OR REPLACE FUNCTION pg_temp.t_many_setup() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM bills_not_in_2b WHERE client_id = '20000000-0000-0000-0000-000000000002' AND supplier_invoice_number LIKE 'M/%';
  DELETE FROM books_register WHERE client_id = '20000000-0000-0000-0000-000000000002' AND supplier_invoice_number LIKE 'M/%';
  INSERT INTO books_register (id, client_id, period_month, supplier_name, supplier_invoice_number, taxable_value, input_igst)
  SELECT gen_random_uuid(), '20000000-0000-0000-0000-000000000002', '07/2026', 'MANY ' || g, 'M/' || g, 100, 18
    FROM generate_series(1, 1000) g;
  INSERT INTO bills_not_in_2b (client_id, period_month, supplier_name, supplier_invoice_number, input_igst, is_carried_forward, source_book_id,
                               updated_by)
  SELECT '20000000-0000-0000-0000-000000000002', m, b.supplier_name, b.supplier_invoice_number, 18, m <> '07/2026',
         CASE WHEN m = '07/2026' THEN b.id END, '10000000-0000-0000-0000-000000000003'
    FROM books_register b, unnest(ARRAY['07/2026', '08/2026', '09/2026', '10/2026']) m
   WHERE b.client_id = '20000000-0000-0000-0000-000000000002' AND b.supplier_invoice_number LIKE 'M/%';
END $$;

-- The removals as the door makes them, then the COMMIT's log write (timed apart).
CREATE OR REPLACE FUNCTION pg_temp.t_many_remove(p_label text, p_run int) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t0 timestamptz; t1 timestamptz; i int; v_book uuid;
BEGIN
  t0 := clock_timestamp();
  FOR i IN 1 .. 1000 LOOP
    SELECT id INTO v_book FROM books_register
     WHERE client_id = '20000000-0000-0000-0000-000000000002' AND supplier_invoice_number = 'M/' || i;
    DELETE FROM books_register WHERE id = v_book;
    UPDATE bills_not_in_2b SET source_book_id = NULL WHERE source_book_id = v_book
       AND client_id = '20000000-0000-0000-0000-000000000002' AND supplier_invoice_number = 'M/' || i;
    DELETE FROM bills_not_in_2b WHERE client_id = '20000000-0000-0000-0000-000000000002' AND supplier_invoice_number = 'M/' || i;
  END LOOP;
  t1 := clock_timestamp();
  IF to_regclass('public.gst_change_log_pending') IS NOT NULL THEN
    SET CONSTRAINTS public.gst_change_log_flush IMMEDIATE;
    SET CONSTRAINTS public.gst_change_log_flush DEFERRED;
  END IF;
  INSERT INTO t_many VALUES (p_label || ', the call', p_run, round(extract(epoch FROM t1 - t0) * 1000, 1)),
                            (p_label || ', call and COMMIT', p_run, round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1));
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.t_many_remove(text, int) TO anon;

CREATE OR REPLACE FUNCTION pg_temp.t_many_logger(p_on boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t text; g text;
BEGIN
  FOREACH t IN ARRAY ARRAY['books_register', 'bills_not_in_2b'] LOOP
    FOREACH g IN ARRAY ARRAY['gst_change_log_ins', 'gst_change_log_upd', 'gst_change_log_del'] LOOP
      EXECUTE format('ALTER TABLE public.%I %s TRIGGER %I', t, CASE WHEN p_on THEN 'ENABLE' ELSE 'DISABLE' END, g);
    END LOOP;
  END LOOP;
END $$;

SELECT pg_temp.t_many_logger(false), pg_temp.t_many_setup();
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"t92-off"}');
SELECT pg_temp.t_many_remove('logger off', 1);
RESET ROLE;
SELECT pg_temp.t_many_logger(true), pg_temp.t_many_setup();
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"t92-on"}');
SELECT pg_temp.t_many_remove('logger on', 1);
RESET ROLE;
SELECT t_eq((SELECT string_agg(table_name || ' ' || op || ' ' || n, ', ' ORDER BY table_name, op) FROM
              (SELECT table_name, op, count(*) n FROM gst_change_log WHERE request_id = 't92-on' GROUP BY 1, 2) x),
            'bills_not_in_2b DELETE 4000, bills_not_in_2b UPDATE 1000, books_register DELETE 1000',
            'every removal logged: the books row, the link, the entry and its copies');
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE request_id = 't92-on' AND (actor_name IS DISTINCT FROM 'Gita' OR client_id IS NULL))::int, 0,
            'each with the person and the client');
SELECT t_eq((SELECT count(*) FROM gst_change_log_stage)::int + (SELECT count(*) FROM gst_change_log_pending)::int, 0,
            'nothing left waiting once the log is written');
-- Two more runs of each.
SELECT pg_temp.t_many_logger(false), pg_temp.t_many_setup();
SET ROLE anon;
SELECT pg_temp.t_many_remove('logger off', 2);
RESET ROLE;
SELECT pg_temp.t_many_logger(true), pg_temp.t_many_setup();
SET ROLE anon;
SELECT pg_temp.t_many_remove('logger on', 2);
RESET ROLE;
SELECT pg_temp.t_many_logger(false), pg_temp.t_many_setup();
SET ROLE anon;
SELECT pg_temp.t_many_remove('logger off', 3);
RESET ROLE;
SELECT pg_temp.t_many_logger(true), pg_temp.t_many_setup();
SET ROLE anon;
SELECT pg_temp.t_many_remove('logger on', 3);
RESET ROLE;

CREATE TEMP VIEW t_many_best AS SELECT what, min(ms) AS ms FROM t_many GROUP BY what;
SELECT t_eq((SELECT (SELECT ms FROM t_many_best WHERE what = 'logger on, the call') - (SELECT ms FROM t_many_best WHERE what = 'logger off, the call') < 250), true,
            '3,000 small statements: the logger adds under 0.25 s to the call (round 2 added about 0.65 s)');
SELECT t_eq((SELECT (SELECT ms FROM t_many_best WHERE what = 'logger on, call and COMMIT') - (SELECT ms FROM t_many_best WHERE what = 'logger off, call and COMMIT') < 500), true,
            'and under 0.5 s with the log written at COMMIT');
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT what, ms FROM t_many_best ORDER BY what LOOP
    RAISE NOTICE 'TIMING % ms  1,000 removals in 3,000 statements (best of 3), %', lpad(r.ms::text, 7), r.what;
  END LOOP;
END $$;
DROP INDEX t_many_ledger;
DROP INDEX t_many_books;
