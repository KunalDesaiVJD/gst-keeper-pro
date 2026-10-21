-- Speed: a 1,000-row Import 2B insert and a 1,000-row ledger update (and a
-- 1,000-row delete) stay under 1 s with the logger on, as the public key with
-- the app's header. Prints the times with and without the logger, and the
-- size of a log row (for the volume estimate in docs/GST_CHANGE_LOG.md).
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

CREATE OR REPLACE FUNCTION pg_temp.t_run(p_label text, p_sql text) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE t0 timestamptz; ms numeric;
BEGIN
  t0 := clock_timestamp();
  EXECUTE p_sql;
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  INSERT INTO t_time VALUES (p_label, ms);
  RETURN ms;
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
