-- Import 2B's write-through (20261021170000, docs §15): a 1,000-row import
-- and the saves around it write through in under a second each, as the app
-- sends them (anon, statement by statement):
--   T1 an import of 1,000 Not in Books documents (two inserts of 500, as the
--      page chunks them);
--   T2 a re-import that changes the figures of all 1,000 (one update a
--      document, as the merge writes them): 1,000 statements in one
--      transaction under 1 s; and as the page sends them, 1,000 requests
--      each committed on its own, the write-through adding under 1.5 ms a
--      request to the same requests written by hand (the document and its
--      entry, as Post wrote them; the page sends them 8 at a time, and a
--      request's round trip over the network, tens of ms, is what the
--      person waits for);
--   T3 Save of 1,000 treatment changes, in chunks of 100 (Not in Books to
--      Matched: 1,000 entries taken back), and back;
--   T4 1,000 books rows added Not in 2B in one statement;
--   T5 the catch-up of a month of 1,000 + 1,000 rows never posted;
--   T6 Delete 2B of a month of 1,000 Not in Books documents.
-- Fictional.
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES
  ('9c000000-0000-0000-0000-000000000001', 'AP TIMING', '24APTIM0000A1Z5'),
  ('9c000000-0000-0000-0000-000000000002', 'AP TIMING CATCH UP', '24APTIC0000A1Z5');
-- A month never posted (T5): 1,000 books rows and 1,000 documents.
INSERT INTO public.books_register (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, book_treatment, doc_type)
SELECT '9c000000-0000-0000-0000-000000000002', '10/2026', date '2026-10-01' + (g % 28), 'BOOK ' || g, 'B/' || g, '24BOOKS0000A1Z5', 1000 + g, 90, 90, 'NOT_IN_2B', 'INVOICE'
  FROM generate_series(1, 1000) g;
INSERT INTO public.twob_import_docs (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, doc_type, itc_action)
SELECT '9c000000-0000-0000-0000-000000000002', '10/2026', date '2026-10-01' + (g % 28), 'DOC ' || g, 'D/' || g, '24DOCSS0000A1Z5', 1000 + g, 180, 'INVOICE', 'NOT_IN_BOOKS'
  FROM generate_series(1, 1000) g;
SELECT set_config('twob.write', '', false);
ANALYZE public.books_register;
ANALYZE public.twob_import_docs;
ANALYZE public.bills_not_in_2b;
ANALYZE public.bills_not_in_books;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a3","x-gst-source":"app"}', false);
DO $$
DECLARE
  t0 timestamptz;
  ms numeric;
  c constant uuid := '9c000000-0000-0000-0000-000000000001';
  ids uuid[];
  i integer;
  r jsonb;
BEGIN
  -- T1
  t0 := clock_timestamp();
  INSERT INTO public.twob_import_docs (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
    taxable_value, input_igst, doc_type, itc_action, updated_by)
  SELECT c, '07/2026', date '2026-07-01' + (g % 28), 'SUPPLIER ' || (g % 50), 'INV/' || g, '24SUPPL' || lpad((g % 50)::text, 4, '0') || 'A1Z5',
         1000 + g, 180, CASE WHEN g % 10 = 0 THEN 'CREDIT_NOTE' ELSE 'INVOICE' END, 'NOT_IN_BOOKS', '00000000-0000-0000-0000-0000000000a3'
    FROM generate_series(1, 500) g;
  INSERT INTO public.twob_import_docs (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
    taxable_value, input_igst, doc_type, itc_action, updated_by)
  SELECT c, '07/2026', date '2026-07-01' + (g % 28), 'SUPPLIER ' || (g % 50), 'INV/' || g, '24SUPPL' || lpad((g % 50)::text, 4, '0') || 'A1Z5',
         1000 + g, 180, CASE WHEN g % 10 = 0 THEN 'CREDIT_NOTE' ELSE 'INVOICE' END, 'NOT_IN_BOOKS', '00000000-0000-0000-0000-0000000000a3'
    FROM generate_series(501, 1000) g;
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: T1 import of 1,000 Not in Books documents (2 statements), written through: % ms', ms;
  PERFORM public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE client_id = c AND source_doc_id IS NOT NULL), 1000, 'T1: 1,000 entries');
  PERFORM public.t_eq((SELECT sum(input_igst) FROM public.bills_not_in_books WHERE client_id = c), (900 * 180 - 100 * 180)::numeric, 'T1: credit notes minus');
  PERFORM public.t_eq(ms < 1000, true, 'timing: T1 under 1 s');
END $$;
-- The live tables carry their statistics (a plan is made once per connection
-- and kept): the tables are analysed after the import, as autovacuum would.
RESET ROLE;
ANALYZE public.twob_import_docs;
ANALYZE public.bills_not_in_books;
SET ROLE anon;
-- T2: 1,000 statements in one transaction, then as the merge sends them, a
-- request (a transaction) each, committed one by one.
DO $$
DECLARE
  t0 timestamptz;
  ms numeric;
  c constant uuid := '9c000000-0000-0000-0000-000000000001';
  ids uuid[];
  i integer;
BEGIN
  SELECT array_agg(id ORDER BY id) INTO ids FROM public.twob_import_docs WHERE client_id = c;
  t0 := clock_timestamp();
  FOR i IN 1 .. 1000 LOOP
    UPDATE public.twob_import_docs SET taxable_value = taxable_value + 1, input_igst = 181 WHERE id = ids[i];
  END LOOP;
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: T2 re-import changing 1,000 documents'' figures (1,000 statements, one transaction), written through: % ms', ms;
  PERFORM public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE client_id = c AND abs(input_igst) = 181), 1000, 'T2: 1,000 entries follow');
  PERFORM public.t_eq(ms < 1000, true, 'timing: T2 under 1 s');
END $$;
DO $$
DECLARE
  t0 timestamptz;
  ms numeric;
  hand numeric;
  c constant uuid := '9c000000-0000-0000-0000-000000000001';
  ids uuid[];
  i integer;
BEGIN
  SELECT array_agg(id ORDER BY id) INTO ids FROM public.twob_import_docs WHERE client_id = c;
  -- By hand: the document and its entry, the write-through off.
  t0 := clock_timestamp();
  FOR i IN 1 .. 1000 LOOP
    PERFORM set_config('twob.write', 'system', true);
    UPDATE public.twob_import_docs SET taxable_value = taxable_value + 1, input_igst = 183 WHERE id = ids[i];
    UPDATE public.bills_not_in_books SET taxable_value = taxable_value + 1, input_igst = sign(input_igst) * 183 WHERE source_doc_id = ids[i];
    COMMIT;
  END LOOP;
  hand := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  -- Written through.
  t0 := clock_timestamp();
  FOR i IN 1 .. 1000 LOOP
    UPDATE public.twob_import_docs SET taxable_value = taxable_value + 1, input_igst = 182 WHERE id = ids[i];
    COMMIT;
  END LOOP;
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: T2 ... as the page sends them (1,000 requests, each committed): % ms written through, % ms by hand: % ms a request more',
    ms, hand, round((ms - hand) / 1000, 2);
  PERFORM public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE client_id = c AND abs(input_igst) = 182), 1000, 'T2: 1,000 entries follow, request by request');
  PERFORM public.t_eq(ms - hand < 1500, true, 'timing: T2 the write-through adds under 1.5 ms a request');
END $$;
DO $$
DECLARE
  t0 timestamptz;
  ms numeric;
  c constant uuid := '9c000000-0000-0000-0000-000000000001';
  ids uuid[];
  i integer;
  r jsonb;
BEGIN
  SELECT array_agg(id ORDER BY id) INTO ids FROM public.twob_import_docs WHERE client_id = c;

  -- T3
  t0 := clock_timestamp();
  FOR i IN 0 .. 9 LOOP
    UPDATE public.twob_import_docs SET itc_action = 'MATCHED', updated_by = '00000000-0000-0000-0000-0000000000a3' WHERE id = ANY (ids[i * 100 + 1 : i * 100 + 100]);
  END LOOP;
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: T3 Save of 1,000 treatments (10 chunks of 100), 1,000 entries taken back: % ms', ms;
  PERFORM public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE client_id = c), 0, 'T3: every entry taken back');
  PERFORM public.t_eq(ms < 1000, true, 'timing: T3 under 1 s');
  t0 := clock_timestamp();
  FOR i IN 0 .. 9 LOOP
    UPDATE public.twob_import_docs SET itc_action = 'NOT_IN_BOOKS' WHERE id = ANY (ids[i * 100 + 1 : i * 100 + 100]);
  END LOOP;
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: T3 ... and back to Not in Books, 1,000 entries added: % ms', ms;
  PERFORM public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE client_id = c), 1000, 'T3: every entry back');
  PERFORM public.t_eq(ms < 1000, true, 'timing: T3 back under 1 s');

  -- T4
  t0 := clock_timestamp();
  INSERT INTO public.books_register (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
    taxable_value, input_cgst, input_sgst, book_treatment, doc_type, updated_by)
  SELECT c, '07/2026', date '2026-07-01' + (g % 28), 'VENDOR ' || (g % 40), 'P/' || g, '24VENDO' || lpad((g % 40)::text, 4, '0') || 'A1Z5',
         500 + g, 45, 45, 'NOT_IN_2B', 'INVOICE', '00000000-0000-0000-0000-0000000000a3'
    FROM generate_series(1, 1000) g;
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: T4 1,000 books rows added Not in 2B, written through: % ms', ms;
  PERFORM public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = c AND source_book_id IS NOT NULL), 1000, 'T4: 1,000 entries');
  PERFORM public.t_eq(ms < 1000, true, 'timing: T4 under 1 s');

  -- T5
  t0 := clock_timestamp();
  r := public.twob_import2b_catch_up(public.t_manager(), '9c000000-0000-0000-0000-000000000002', '10/2026', true);
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: T5 catch-up preview of 1,000 + 1,000 rows: % ms', ms;
  PERFORM public.t_eq((r ->> 'written')::integer, 2000, 'T5: the preview names 2,000');
  PERFORM public.t_eq(ms < 1000, true, 'timing: T5 preview under 1 s');
  t0 := clock_timestamp();
  r := public.twob_import2b_catch_up(public.t_manager(), '9c000000-0000-0000-0000-000000000002', '10/2026', false);
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: T5 catch-up of 1,000 + 1,000 rows applied: % ms', ms;
  PERFORM public.t_eq((r ->> 'written')::integer, 2000, 'T5: 2,000 written');
  PERFORM public.t_eq(ms < 1000, true, 'timing: T5 under 1 s');

  -- T6
  t0 := clock_timestamp();
  r := public.twob_import2b_delete_2b(public.t_manager(), c, '07/2026');
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: T6 Delete 2B of 1,000 Not in Books documents: % ms', ms;
  PERFORM public.t_eq((r ->> 'deleted')::integer, 1000, 'T6: 1,000 documents deleted');
  PERFORM public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE client_id = c), 0, 'T6: their entries gone');
  PERFORM public.t_eq(ms < 1000, true, 'timing: T6 under 1 s');
END $$;
RESET ROLE;
