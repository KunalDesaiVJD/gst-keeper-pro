-- Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md
-- §15): the fourth verification round's database findings, as PostgREST
-- runs the app's calls (anon, with the request headers; a3 is an employee
-- without Import 2B & post, a4 holds it, a2 is a GST Manager):
--   M1 an employee without Import 2B & post saves a books row the matcher
--      pairs with a 2B document (twob_import2b_save_book) when the save
--      changes nothing on the ledger (a Mismatched row against a Matched
--      document), as the direct writes of before did; a pairing that would
--      take a Not in Books entry off the ledger is still refused, the request
--      naming no user too (the call's p_actor_id is checked then), and a
--      caller who is not staff is refused;
--   L3 deleting a books row or a 2B document whose entry would leave the
--      ledger is the permission's too: the employee's delete is refused and
--      nothing of it kept; a delete leaving the ledger as it is goes through;
--   M2 a filed month's save sent with its preview's digest runs the door
--      once for the save (the rows, then their write-through), with no
--      second preview under the lock (counted with track_functions; before,
--      one, running the door three more times): 1,000 books rows brought up
--      to date, timed; the digest still stops a
--      month changed while the confirm was open, and an added row (new ids
--      on every run) saves with its preview's digest.
-- Fictional.
\set E 'a4000000-0000-0000-0000-0000000000e1'
\set P 'a4000000-0000-0000-0000-0000000000e2'

SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES
  (:'E', 'R4 EMPLOYEE PAIRS', '24RFOUR0000A1Z5'),
  (:'P', 'R4 PRIOR TIMING', '24RFOUP0000A1Z5');
-- M1 / L3 (open Oct-26). INV-77 Matched at IGST 180; N-1 Not in Books with
-- its entry on the ledger; B-0 a blank books row (as "Add row" makes it);
-- DB-1 a Not in 2B books row posted (its entry on the ledger); DB-2 a Not in
-- 2B books row without a date (never posted).
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, doc_type, itc_action) VALUES
  ('a4000000-0000-0000-0000-0000000000d1', :'E', '10/2026', '2026-10-05', 'PAIRS SUPPLIER', 'INV-77', '24PAIRS0000A1Z5', 1000, 180, 'INVOICE', 'MATCHED'),
  ('a4000000-0000-0000-0000-0000000000d2', :'E', '10/2026', '2026-10-06', 'NIB SUPPLIER', 'N-1', '24NIBSU0000A1Z5', 1000, 180, 'INVOICE', 'NOT_IN_BOOKS'),
  ('a4000000-0000-0000-0000-0000000000d3', :'E', '10/2026', '2026-10-07', 'NIB THREE', 'N-3', '24NIBTH0000A1Z5', 500, 90, 'INVOICE', 'NOT_IN_BOOKS');
INSERT INTO public.bills_not_in_books (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, bill_in_2b_month, is_carried_forward, source_doc_id) VALUES
  ('a4000000-0000-0000-0000-0000000000f2', :'E', '10/2026', '2026-10-06', 'NIB SUPPLIER', 'N-1', '24NIBSU0000A1Z5', 1000, 180, 0, 0, 'Oct 26', false,
   'a4000000-0000-0000-0000-0000000000d2'),
  ('a4000000-0000-0000-0000-0000000000f3', :'E', '10/2026', '2026-10-07', 'NIB THREE', 'N-3', '24NIBTH0000A1Z5', 500, 90, 0, 0, 'Oct 26', false,
   'a4000000-0000-0000-0000-0000000000d3');
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, book_treatment, doc_type) VALUES
  ('a4000000-0000-0000-0000-0000000000b0', :'E', '10/2026', NULL, '', NULL, NULL, 0, 0, 0, 0, 'NOT_IN_2B', 'INVOICE'),
  ('a4000000-0000-0000-0000-0000000000b9', :'E', '10/2026', '2026-10-06', 'NIB SUPPLIER', 'N-1', '24NIBSU0000A1Z5', 1000, 170, 0, 0, 'NOT_IN_2B', 'INVOICE'),
  ('a4000000-0000-0000-0000-0000000000b1', :'E', '10/2026', '2026-10-08', 'DEE BEE ONE', 'DB-1', '24DEEBE0000A1Z5', 1000, 0, 90, 90, 'NOT_IN_2B', 'INVOICE'),
  ('a4000000-0000-0000-0000-0000000000b2', :'E', '10/2026', NULL, 'DEE BEE TWO', 'DB-2', '24DEEBT0000A1Z5', 1000, 0, 90, 90, 'NOT_IN_2B', 'INVOICE');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward, source_book_id) VALUES
  ('a4000000-0000-0000-0000-0000000000c1', :'E', '10/2026', '2026-10-08', 'DEE BEE ONE', 'DB-1', '24DEEBE0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false,
   'a4000000-0000-0000-0000-0000000000b1');
-- M2: Apr-26 to Sep-26 filed; 1,000 Not in 2B books rows of Apr-26 never posted.
INSERT INTO public.books_register (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, book_treatment, doc_type)
SELECT :'P', '04/2026', '2026-04-10', 'PT ' || g, 'PT-' || g, '24PTSUP' || lpad(g::text, 4, '0') || 'A1Z5', 100, 9, 9, 'NOT_IN_2B', 'INVOICE'
  FROM generate_series(1, 1000) g;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, filed_date, is_locked)
SELECT :'P', 'GSTR-3B', lpad(m::text, 2, '0') || '/2026', 'Filed', '2026-10-20', true FROM generate_series(4, 9) m;
SELECT set_config('twob.write', '', false);
ANALYZE public.books_register;
ANALYZE public.bills_not_in_2b;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a3","x-gst-source":"app"}', false);

-- ---------------------------------------------------------------------------
-- M1. The employee's pairing that changes nothing on the ledger saves.
-- ---------------------------------------------------------------------------
-- B-0 typed as INV-77 at IGST 150: the matcher pairs it Mismatched with the
-- Matched document; the page sends one call (saveBookWithPairing).
SELECT public.t_eq(public.twob_import2b_save_book(public.t_employee(), 'a4000000-0000-0000-0000-0000000000b0',
  '{"date":"2026-10-05","supplier_name":"PAIRS SUPPLIER","supplier_invoice_number":"INV-77","supplier_gstin":"24PAIRS0000A1Z5","input_igst":150,"book_treatment":"MISMATCHED","matched_2b_id":"a4000000-0000-0000-0000-0000000000d1"}'::jsonb,
  NULL, 'a4000000-0000-0000-0000-0000000000d1') ->> 'ok', 'true',
  'M1: an employee without Import 2B & post pairs a books row Mismatched with a Matched document (nothing on the ledger changes)');
SELECT public.t_eq((SELECT concat_ws('|', b.book_treatment, b.input_igst, d.itc_action, d.matched_book_id = b.id,
                                     (SELECT count(*) FROM public.bills_not_in_2b t WHERE t.client_id = :'E'),
                                     (SELECT count(*) FROM public.bills_not_in_books t WHERE t.client_id = :'E'))
                      FROM public.books_register b JOIN public.twob_import_docs d ON d.id = 'a4000000-0000-0000-0000-0000000000d1'
                     WHERE b.id = 'a4000000-0000-0000-0000-0000000000b0'),
  'MISMATCHED|150|MISMATCHED|t|1|2', 'M1: ... the row and the document are saved paired; the ledger is as it was');
-- B-9 (N-1 at IGST 170) paired with N-1, Not in Books with an entry: the
-- document turns Mismatched and its entry would leave the ledger.
SELECT public.t_raises($q$SELECT public.twob_import2b_save_book(public.t_employee(), 'a4000000-0000-0000-0000-0000000000b9',
  '{"book_treatment":"MISMATCHED","matched_2b_id":"a4000000-0000-0000-0000-0000000000d2"}'::jsonb, NULL, 'a4000000-0000-0000-0000-0000000000d2')$q$,
  'needs the Import 2B & post permission', 'M1: a pairing that would take a Not in Books entry off the ledger is refused for the employee');
SELECT public.t_eq((SELECT concat_ws('|', b.book_treatment, d.itc_action, d.matched_book_id IS NULL,
                                     (SELECT count(*) FROM public.bills_not_in_books t WHERE t.source_doc_id = d.id))
                      FROM public.books_register b JOIN public.twob_import_docs d ON d.id = 'a4000000-0000-0000-0000-0000000000d2'
                     WHERE b.id = 'a4000000-0000-0000-0000-0000000000b9'),
  'NOT_IN_2B|NOT_IN_BOOKS|t|1', 'M1: ... nothing of it is kept: the row, the document and its entry as they were');
-- The same call sent without the request naming anyone: the call's own user is checked.
SELECT set_config('request.headers', '{}', false);
SELECT public.t_raises($q$SELECT public.twob_import2b_save_book(public.t_employee(), 'a4000000-0000-0000-0000-0000000000b9',
  '{"book_treatment":"MISMATCHED","matched_2b_id":"a4000000-0000-0000-0000-0000000000d2"}'::jsonb, NULL, 'a4000000-0000-0000-0000-0000000000d2')$q$,
  'needs the Import 2B & post permission', 'M1: ... with no user named in the request, the call''s p_actor_id is checked instead');
SELECT public.t_raises($q$SELECT public.twob_import2b_save_book('a4000000-0000-0000-0000-00000000dead', 'a4000000-0000-0000-0000-0000000000b9',
  '{"book_treatment":"MISMATCHED"}'::jsonb)$q$,
  'Only staff save the books register', 'M1: a caller who is not staff is refused');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t_eq(public.twob_import2b_save_book(public.t_poster(), 'a4000000-0000-0000-0000-0000000000b9',
  '{"book_treatment":"MISMATCHED","matched_2b_id":"a4000000-0000-0000-0000-0000000000d2"}'::jsonb, NULL, 'a4000000-0000-0000-0000-0000000000d2') ->> 'paired_was',
  'NOT_IN_BOOKS', 'M1: the poster (Import 2B & post) makes the same pairing');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE source_doc_id = 'a4000000-0000-0000-0000-0000000000d2'), 0,
  'M1: ... and N-1''s entry leaves the ledger');

-- ---------------------------------------------------------------------------
-- L3. Deleting a row whose entry would leave the ledger needs the permission.
-- ---------------------------------------------------------------------------
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a3","x-gst-source":"app"}', false);
SELECT public.t_raises($q$DELETE FROM public.books_register WHERE id = 'a4000000-0000-0000-0000-0000000000b1'$q$,
  'needs the Import 2B & post permission', 'L3: the employee''s delete of a posted books row is refused');
SELECT public.t_eq((SELECT concat_ws('|', (SELECT count(*) FROM public.books_register WHERE id = 'a4000000-0000-0000-0000-0000000000b1'),
                                     (SELECT count(*) FROM public.bills_not_in_2b WHERE id = 'a4000000-0000-0000-0000-0000000000c1'))),
  '1|1', 'L3: ... the row and its entry stay');
SELECT public.t_raises($q$DELETE FROM public.twob_import_docs WHERE id = 'a4000000-0000-0000-0000-0000000000d3'$q$,
  'needs the Import 2B & post permission', 'L3: ... and of a Not in Books 2B document with an entry');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE id = 'a4000000-0000-0000-0000-0000000000f3'), 1,
  'L3: ... its entry stays');
DELETE FROM public.books_register WHERE id = 'a4000000-0000-0000-0000-0000000000b2';
SELECT public.t_eq((SELECT count(*)::integer FROM public.books_register WHERE id = 'a4000000-0000-0000-0000-0000000000b2'), 0,
  'L3: a delete that leaves the ledger as it is (a row never posted) goes through for the employee');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
DELETE FROM public.books_register WHERE id = 'a4000000-0000-0000-0000-0000000000b1';
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE id = 'a4000000-0000-0000-0000-0000000000c1'), 0,
  'L3: the poster''s delete takes the entry off the ledger');

-- ---------------------------------------------------------------------------
-- M2. A filed month's save with its digest runs the door once.
-- ---------------------------------------------------------------------------
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a2","x-gst-source":"app"}', false);
SELECT public.twob_import2b_prior_save(public.t_manager(), :'P', '04/2026', '[]'::jsonb, true, true) ->> 'digest' AS pd \gset
-- A month changed while the confirm was open: nothing is saved.
RESET ROLE;
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.books_register (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, book_treatment, doc_type)
VALUES (:'P', '04/2026', '2026-04-12', 'PT LATE', 'PT-LATE', '24PTLAT0000A1Z5', 100, 9, 9, 'NOT_IN_2B', 'INVOICE');
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.t_raises(format($q$SELECT public.twob_import2b_prior_save(public.t_manager(), '%s', '04/2026', '[]'::jsonb, false, true, '%s')$q$, :'P', :'pd'),
  'changed while the confirm was open', 'M2: the save digested as it is made: a month changed meanwhile saves nothing');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'P'), 0, 'M2: ... not one entry written');
SELECT public.twob_import2b_prior_save(public.t_manager(), :'P', '04/2026', '[]'::jsonb, true, true) ->> 'digest' AS pd \gset
SELECT set_config('t.pd', :'pd', false);
RESET ROLE;
BEGIN;
SET LOCAL track_functions = 'pl';
SET LOCAL ROLE anon;
-- Timed three times (verification round 8: one run varied from 1.2 to
-- 1.8 s on one machine with the change log applied, and the gate failed
-- about half the time): two runs undone (each in a block rolled back), then
-- the one kept; the gate reads the median. The second preview the save made
-- before round 4 is caught by the count of previews made in it, not by the
-- time; the time is held well inside the 3 s an anon request has on
-- Supabase (its statement_timeout).
DO $$
DECLARE
  t0 timestamptz;
  ms numeric[] := '{}';
  med numeric;
  r jsonb;
  runs bigint;
  i integer;
BEGIN
  FOR i IN 1..2 LOOP
    BEGIN
      t0 := clock_timestamp();
      r := public.twob_import2b_prior_save(public.t_manager(), 'a4000000-0000-0000-0000-0000000000e2', '04/2026', '[]'::jsonb, false, true,
                                           current_setting('t.pd'));
      ms := ms || round(extract(epoch FROM clock_timestamp() - t0) * 1000);
      RAISE EXCEPTION USING ERRCODE = 'TWB9H', MESSAGE = 'undo this run';
    EXCEPTION WHEN SQLSTATE 'TWB9H' THEN NULL;
    END;
  END LOOP;
  t0 := clock_timestamp();
  r := public.twob_import2b_prior_save(public.t_manager(), 'a4000000-0000-0000-0000-0000000000e2', '04/2026', '[]'::jsonb, false, true,
                                       current_setting('t.pd'));
  ms := ms || round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  SELECT x INTO med FROM unnest(ms) x ORDER BY x OFFSET 1 LIMIT 1;
  runs := COALESCE(pg_stat_get_xact_function_calls('public.twob__prior_save_preview(uuid, uuid, text, jsonb, jsonb, boolean)'::regprocedure), 0);
  RAISE NOTICE 'timing: M2 a filed month''s save of 1,000 books rows with its preview''s digest: median % ms of % (previews made again in them: %)',
    med, array_to_string(ms, ', '), runs;
  PERFORM public.t_eq(r ->> 'ok', 'true', 'M2: confirmed as previewed, it is saved');
  PERFORM public.t_eq(runs, 0::bigint, 'M2: the save makes no second preview (each ran the door three more times)');
  PERFORM public.t_eq(med < 2000, true, 'timing: M2 under 2 s, the median of three (before: one run of 1.8 to 1.9 s, 2.5 s with the change log)');
END $$;
COMMIT;
SELECT public.t_eq((SELECT string_agg(period_month || ':' || n, ',' ORDER BY period_month)
                      FROM (SELECT period_month, count(*) AS n FROM public.bills_not_in_2b WHERE client_id = :'P' GROUP BY 1) x),
  '04/2026:1001,05/2026:1001,06/2026:1001,07/2026:1001,08/2026:1001,09/2026:1001,10/2026:1001',
  'M2: ... the 1,001 entries in Apr-26 and their copies in every later month');
SET ROLE anon;
-- An added row: new ids on every run, yet its preview's digest saves it.
SELECT public.twob_import2b_prior_save(public.t_manager(), :'P', '04/2026',
  '[{"table":"books_register","op":"insert","values":{"date":"2026-04-14","supplier_name":"PT ADDED","supplier_invoice_number":"PT-ADD","supplier_gstin":"24PTADD0000A1Z5","taxable_value":200,"input_igst":0,"input_cgst":18,"input_sgst":18,"book_treatment":"NOT_IN_2B","doc_type":"INVOICE"}}]'::jsonb, true) ->> 'digest' AS ad \gset
SELECT public.t_eq(public.twob_import2b_prior_save(public.t_manager(), :'P', '04/2026',
  '[{"table":"books_register","op":"insert","values":{"date":"2026-04-14","supplier_name":"PT ADDED","supplier_invoice_number":"PT-ADD","supplier_gstin":"24PTADD0000A1Z5","taxable_value":200,"input_igst":0,"input_cgst":18,"input_sgst":18,"book_treatment":"NOT_IN_2B","doc_type":"INVOICE"}}]'::jsonb,
  false, false, :'ad') ->> 'ok', 'true', 'M2: a row added through the door saves with its preview''s digest (ids left out of it)');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'P' AND supplier_invoice_number = 'PT-ADD'), 7,
  'M2: ... its entry in Apr-26 and every later month');

RESET ROLE;
