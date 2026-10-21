-- Speed: a 1,000-row Import 2B insert and a 1,000-row ledger update (and a
-- 1,000-row delete) stay under 1 s with the logger on, as the public key with
-- the app's header, the statement and its log write at COMMIT together;
-- 1,000 statements of one row or none stay cheap and open no subtransaction
-- (round 2). Prints the times with and without the logger (the log write
-- apart: "log written at COMMIT", run here by SET CONSTRAINTS ... IMMEDIATE),
-- and the size of a log row (for the volume estimate in docs/GST_CHANGE_LOG.md).
SET search_path = public, extensions;
CREATE TEMP TABLE t_time (what text, ms numeric);
GRANT ALL ON t_time TO anon;

-- Ledger rows to update and delete.
INSERT INTO bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
                                taxable_value, input_igst, input_cgst, input_sgst, book_entry_month, bill_in_2b_month,
                                is_locked, is_carried_forward, updated_by, version)
SELECT '20000000-0000-0000-0000-000000000002', '08/2026', DATE '2026-08-01' + (g % 28), 'SUPPLIER ' || g, 'INV/' || g,
       '24SSSSS' || lpad(g::text, 4, '0') || 'S1Z1', g * 100, g * 18, 0, 0, NULL, '08/2026', false, false,
       '10000000-0000-0000-0000-000000000003', 1
  FROM generate_series(1, 1000) g;

-- The statement, then the log write its COMMIT makes (timed apart); returns both together.
CREATE OR REPLACE FUNCTION pg_temp.t_run(p_label text, p_sql text) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE t0 timestamptz; t1 timestamptz; ms numeric; wr numeric;
BEGIN
  t0 := clock_timestamp();
  EXECUTE p_sql;
  t1 := clock_timestamp();
  SET CONSTRAINTS public.gst_change_log_flush IMMEDIATE;
  SET CONSTRAINTS public.gst_change_log_flush DEFERRED;
  ms := round(extract(epoch FROM t1 - t0) * 1000, 1);
  wr := round(extract(epoch FROM clock_timestamp() - t1) * 1000, 1);
  INSERT INTO t_time VALUES (p_label, ms), (p_label || ', log written at COMMIT', wr);
  RETURN ms + wr;
END $$;

-- The Import 2B insert, as the app sends it (one statement, 1,000 rows).
CREATE TEMP VIEW t_import AS
SELECT gen_random_uuid() AS id, '20000000-0000-0000-0000-000000000002'::uuid AS client_id, '09/2026' AS period_month,
       DATE '2026-09-01' + (g % 28) AS date, 'SUPPLIER ' || g AS supplier_name, 'INV/' || g AS supplier_invoice_number,
       '24SSSSS' || lpad(g::text, 4, '0') || 'S1Z1' AS supplier_gstin, (g * 100)::numeric AS taxable_value,
       (g * 18)::numeric AS input_igst, 0::numeric AS input_cgst, 0::numeric AS input_sgst, 'R' AS invoice_type,
       (g * 118)::numeric AS invoice_value, '24-Gujarat' AS place_of_supply, 0::numeric AS cess, '082026' AS gstr1_period,
       DATE '2026-09-11' AS gstr1_filing_date, 'excel' AS source, 'B2B' AS source_sheet, 'MATCHED' AS bucket,
       false AS reverse_charge, true AS itc_available, '10000000-0000-0000-0000-000000000003'::uuid AS imported_by,
       'invoice' AS doc_type, false AS is_amendment, true AS full_2b
  FROM generate_series(1, 1000) g;
GRANT SELECT ON t_import TO anon;
CREATE TEMP TABLE t_import_rows AS SELECT * FROM t_import;
GRANT SELECT ON t_import_rows TO anon;

-- 1. Without the logger (baseline)
ALTER TABLE twob_import_docs DISABLE TRIGGER gst_change_log_ins;
ALTER TABLE bills_not_in_books DISABLE TRIGGER gst_change_log_upd;
ALTER TABLE bills_not_in_books DISABLE TRIGGER gst_change_log_del;
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000003","x-gst-source":"app"}');
SELECT pg_temp.t_run('import 2B insert 1000, logger off', $q$INSERT INTO twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number,
  supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, invoice_type, invoice_value, place_of_supply, cess, gstr1_period,
  gstr1_filing_date, source, source_sheet, bucket, reverse_charge, itc_available, imported_by, doc_type, is_amendment, full_2b)
  SELECT gen_random_uuid(), client_id, '10/2026', date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst,
  input_cgst, input_sgst, invoice_type, invoice_value, place_of_supply, cess, gstr1_period, gstr1_filing_date, source, source_sheet, bucket,
  reverse_charge, itc_available, imported_by, doc_type, is_amendment, full_2b FROM t_import_rows$q$);
SELECT pg_temp.t_run('ledger update 1000, logger off', $q$UPDATE bills_not_in_books SET input_igst = input_igst + 1, book_entry_month = '09/2026',
  updated_by = '10000000-0000-0000-0000-000000000002' WHERE client_id = '20000000-0000-0000-0000-000000000002' AND period_month = '08/2026'$q$);
RESET ROLE;
ALTER TABLE twob_import_docs ENABLE TRIGGER gst_change_log_ins;
ALTER TABLE bills_not_in_books ENABLE TRIGGER gst_change_log_upd;
ALTER TABLE bills_not_in_books ENABLE TRIGGER gst_change_log_del;

-- 2. With the logger
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000003","x-gst-source":"app","x-gst-request":"t90"}');
SELECT t_eq(pg_temp.t_run('import 2B insert 1000, logger on', $q$INSERT INTO twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number,
  supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, invoice_type, invoice_value, place_of_supply, cess, gstr1_period,
  gstr1_filing_date, source, source_sheet, bucket, reverse_charge, itc_available, imported_by, doc_type, is_amendment, full_2b)
  SELECT id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst,
  input_cgst, input_sgst, invoice_type, invoice_value, place_of_supply, cess, gstr1_period, gstr1_filing_date, source, source_sheet, bucket,
  reverse_charge, itc_available, imported_by, doc_type, is_amendment, full_2b FROM t_import_rows$q$) < 1000, true, 'a 1,000-row Import 2B insert under 1 s');
SELECT t_eq(pg_temp.t_run('ledger update 1000, logger on', $q$UPDATE bills_not_in_books SET input_igst = input_igst + 1, book_entry_month = '10/2026',
  updated_by = '10000000-0000-0000-0000-000000000003' WHERE client_id = '20000000-0000-0000-0000-000000000002' AND period_month = '08/2026'$q$) < 1000,
  true, 'a 1,000-row ledger update under 1 s');
SELECT t_eq(pg_temp.t_run('ledger delete 1000, logger on', $q$DELETE FROM bills_not_in_books
  WHERE client_id = '20000000-0000-0000-0000-000000000002' AND period_month = '08/2026'$q$) < 1000, true, 'a 1,000-row ledger delete under 1 s');
RESET ROLE;

SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE request_id = 't90' AND table_name = 'twob_import_docs' AND op = 'INSERT')::int, 1000, '1,000 inserts logged');
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE request_id = 't90' AND table_name = 'bills_not_in_books' AND op = 'UPDATE')::int, 1000, '1,000 updates logged');
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE request_id = 't90' AND table_name = 'bills_not_in_books' AND op = 'DELETE')::int, 1000, '1,000 deletes logged');
SELECT t_eq((SELECT changed FROM gst_change_log WHERE request_id = 't90' AND table_name = 'bills_not_in_books' AND op = 'UPDATE' LIMIT 1) ?& ARRAY['input_igst', 'book_entry_month', 'updated_by'],
            true, 'each update names its changed columns');

-- 3. Round 2: a statement that changes one row or none costs little, and the
-- logger opens no subtransaction (a function that saves row by row stayed
-- fast and never overflowed the subtransaction cache). 1,000 statements in a
-- loop, as a row-by-row function makes them; first without the logger.
INSERT INTO bills_not_in_2b (client_id, period_month, supplier_name, supplier_invoice_number, input_igst, updated_by)
SELECT '20000000-0000-0000-0000-000000000002', '08/2026', 'LOOP ' || g, 'L/' || g, g, '10000000-0000-0000-0000-000000000003'
  FROM generate_series(1, 1000) g;
CREATE TEMP TABLE t_loop_ids AS SELECT id, row_number() OVER (ORDER BY id) AS n FROM bills_not_in_2b
 WHERE client_id = '20000000-0000-0000-0000-000000000002' AND supplier_name LIKE 'LOOP %';
GRANT SELECT ON t_loop_ids TO anon;
CREATE OR REPLACE FUNCTION pg_temp.t_loops(p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t0 timestamptz; r record; i int;
BEGIN
  t0 := clock_timestamp();
  FOR r IN SELECT id FROM t_loop_ids ORDER BY n LOOP
    UPDATE bills_not_in_2b SET input_igst = input_igst + 1 WHERE id = r.id;
  END LOOP;
  INSERT INTO t_time VALUES ('1,000 one-row updates, ' || p_label, round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1));
  t0 := clock_timestamp();
  SET CONSTRAINTS public.gst_change_log_flush IMMEDIATE;
  SET CONSTRAINTS public.gst_change_log_flush DEFERRED;
  INSERT INTO t_time VALUES ('1,000 one-row updates, ' || p_label || ', log written at COMMIT', round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1));
  t0 := clock_timestamp();
  FOR i IN 1 .. 1000 LOOP
    UPDATE bills_not_in_2b SET input_igst = 0 WHERE id = '00000000-0000-0000-0000-000000000000';
  END LOOP;
  INSERT INTO t_time VALUES ('1,000 updates of no row, ' || p_label, round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1));
  t0 := clock_timestamp();
  FOR i IN 1 .. 1000 LOOP
    DELETE FROM bills_not_in_2b WHERE id = '00000000-0000-0000-0000-000000000000';
  END LOOP;
  INSERT INTO t_time VALUES ('1,000 deletes of no row, ' || p_label, round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1));
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.t_loops(text) TO anon;
ALTER TABLE bills_not_in_2b DISABLE TRIGGER gst_change_log_upd;
ALTER TABLE bills_not_in_2b DISABLE TRIGGER gst_change_log_del;
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000003","x-gst-source":"app","x-gst-request":"t90-loop-off"}');
SELECT pg_temp.t_loops('logger off');
RESET ROLE;
ALTER TABLE bills_not_in_2b ENABLE TRIGGER gst_change_log_upd;
ALTER TABLE bills_not_in_2b ENABLE TRIGGER gst_change_log_del;
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000003","x-gst-source":"app","x-gst-request":"t90-loop"}');
SELECT pg_temp.t_loops('logger on');
RESET ROLE;
SELECT t_eq((SELECT sum(ms) < 700 FROM t_time WHERE what LIKE '1,000 one-row updates, logger on%'), true,
            '1,000 one-row updates and their log write under 0.7 s (was about 1 s)');
SELECT t_eq((SELECT ms < 100 FROM t_time WHERE what = '1,000 updates of no row, logger on'), true, '1,000 updates of no row under 0.1 s (was about 0.55 s)');
SELECT t_eq((SELECT ms < 100 FROM t_time WHERE what = '1,000 deletes of no row, logger on'), true, '1,000 deletes of no row under 0.1 s (was about 0.17 s)');
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE request_id = 't90-loop')::int, 1000, 'each one-row update logged once, the rest nothing');
-- No subtransaction: 100 logged statements in one transaction.
BEGIN;
SET ROLE anon;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM t_loop_ids ORDER BY n LIMIT 100 LOOP
    UPDATE bills_not_in_2b SET input_igst = input_igst + 1 WHERE id = r.id;
  END LOOP;
END $$;
RESET ROLE;
SELECT t_eq((SELECT s.subxact_count || ' ' || s.subxact_overflowed FROM pg_stat_get_backend_idset() b(id)
               CROSS JOIN LATERAL pg_stat_get_backend_subxact(b.id) s WHERE pg_stat_get_backend_pid(b.id) = pg_backend_pid()),
            '0 false', '100 logged statements in one transaction open no subtransaction');
COMMIT;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT what, ms FROM t_time ORDER BY what LOOP
    RAISE NOTICE 'TIMING % ms  %', lpad(r.ms::text, 7), r.what;
  END LOOP;
  FOR r IN SELECT table_name || ' ' || op AS what, round(avg(pg_column_size(l.*))) AS b, count(*) AS n
             FROM gst_change_log l WHERE request_id = 't90' GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE 'TIMING log row % bytes on average  % (% rows)', lpad(r.b::text, 5), r.what, r.n;
  END LOOP;
  RAISE NOTICE 'TIMING log table now % for % rows (heap and indexes)',
    pg_size_pretty(pg_total_relation_size('public.gst_change_log')), (SELECT count(*) FROM gst_change_log);
END $$;
