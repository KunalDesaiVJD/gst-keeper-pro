-- Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md
-- §15): the third verification round's database findings, as PostgREST runs
-- the app's calls (anon, with the request headers; a4 holds Import 2B &
-- post, a2 is a GST Manager):
--   L1 "Bring the reconciliation up to date" and a filed month's save write
--      only what their confirm showed: the dry run returns the plan's digest,
--      the apply sends it back, and a month changed meanwhile (an entry
--      corrected on 2B Reconciliation, a books row saved through the door)
--      writes nothing and says so; the digest of an unchanged month is the
--      same every time (a filed month's preview adding a row too, whose ids
--      are new on each run);
--   L5 the catch-up's rows left out say whether their entry stays on the
--      ledger as last saved (a row without a date that posted before) or is
--      not on it (never posted; a minus row, whose entry is taken back).
-- Fictional.
\set G 'a99a0000-0000-0000-0000-0000000000a1'
\set K 'a99a0000-0000-0000-0000-0000000000a2'
\set J 'a99a0000-0000-0000-0000-0000000000a3'

SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES
  (:'G', 'L1 CATCH UP', '24LONEG0000A1Z5'),
  (:'K', 'L5 SKIPPED', '24LFIVK0000A1Z5'),
  (:'J', 'L1 FILED', '24LONEJ0000A1Z5');
-- L1 (open Sep-26): B-1 posted (its entry 90/90, in step); D-1 parked Not in
-- Books before saves wrote through, never posted (out of step).
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, book_treatment, doc_type) VALUES
  ('a99a0000-0000-0000-0000-0000000000b1', :'G', '09/2026', '2026-09-03', 'GEE SUPPLIER', 'B-1', '24GEESU0000A1Z5', 1000, 90, 90, 'NOT_IN_2B', 'INVOICE');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward, source_book_id) VALUES
  ('a99a0000-0000-0000-0000-0000000000c1', :'G', '09/2026', '2026-09-03', 'GEE SUPPLIER', 'B-1', '24GEESU0000A1Z5', 1000, 0, 90, 90, 'Sep 26', false,
   'a99a0000-0000-0000-0000-0000000000b1');
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, doc_type, itc_action) VALUES
  ('a99a0000-0000-0000-0000-0000000000d1', :'G', '09/2026', '2026-09-04', 'DEE SUPPLIER', 'D-1', '24DEESU0000A1Z5', 2000, 360, 'INVOICE', 'NOT_IN_BOOKS');
-- L5 (open Sep-26): B-3 without a date, never posted; B-5 without a date,
-- posted before (its entry on the ledger); B-6 a minus row that posted
-- before (its entry is taken back).
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, book_treatment, doc_type) VALUES
  ('a99a0000-0000-0000-0000-0000000000b3', :'K', '09/2026', NULL, 'KAY ONE', 'B-3', '24KAYON0000A1Z5', 1000, 90, 90, 'NOT_IN_2B', 'INVOICE'),
  ('a99a0000-0000-0000-0000-0000000000b5', :'K', '09/2026', NULL, 'KAY FIVE', 'B-5', '24KAYFI0000A1Z5', 3000, 270, 270, 'NOT_IN_2B', 'INVOICE'),
  ('a99a0000-0000-0000-0000-0000000000b6', :'K', '09/2026', '2026-09-06', 'KAY SIX', 'B-6', '24KAYSI0000A1Z5', -600, -54, -54, 'NOT_IN_2B', 'INVOICE');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward, source_book_id) VALUES
  (:'K', '09/2026', '2026-09-02', 'KAY FIVE', 'B-5', '24KAYFI0000A1Z5', 3000, 0, 270, 270, 'Sep 26', false, 'a99a0000-0000-0000-0000-0000000000b5'),
  (:'K', '09/2026', '2026-09-06', 'KAY SIX', 'B-6', '24KAYSI0000A1Z5', 600, 0, 54, 54, 'Sep 26', false, 'a99a0000-0000-0000-0000-0000000000b6');
-- L1 filed (Jul-26 filed, Aug-26 open): J-1 posted, its entry carried into Aug.
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, book_treatment, doc_type) VALUES
  ('a99a0000-0000-0000-0000-0000000000e1', :'J', '07/2026', '2026-07-10', 'JAY SUPPLIER', 'J-1', '24JAYSU0000A1Z5', 10000, 900, 900, 'NOT_IN_2B', 'INVOICE'),
  ('a99a0000-0000-0000-0000-0000000000e4', :'J', '07/2026', '2026-07-14', 'JAY FOUR', 'J-4', '24JAYFO0000A1Z5', 10000, 900, 900, 'NOT_IN_2B', 'INVOICE');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward, source_book_id) VALUES
  ('a99a0000-0000-0000-0000-0000000000f1', :'J', '07/2026', '2026-07-10', 'JAY SUPPLIER', 'J-1', '24JAYSU0000A1Z5', 10000, 0, 900, 900, 'Jul 26', false,
   'a99a0000-0000-0000-0000-0000000000e1'),
  ('a99a0000-0000-0000-0000-0000000000f4', :'J', '07/2026', '2026-07-14', 'JAY FOUR', 'J-4', '24JAYFO0000A1Z5', 10000, 0, 900, 900, 'Jul 26', false,
   'a99a0000-0000-0000-0000-0000000000e4');
SELECT public.t_copy_month(:'J', '07/2026', '08/2026');
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status, filed_date, is_locked) VALUES
  (:'J', 'GSTR-3B', '07/2026', 'Filed', '2026-08-20', true);
SELECT set_config('twob.write', '', false);

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);

-- ---------------------------------------------------------------------------
-- L1. The catch-up writes only the plan its confirm showed.
-- ---------------------------------------------------------------------------
SELECT public.twob_import2b_catch_up(public.t_poster(), :'G', '09/2026', true) AS p1 \gset
SELECT public.t_eq((:'p1'::jsonb -> 'bills_not_in_books' ->> 'add') || '|' || (:'p1'::jsonb ->> 'written'), '1|1',
  'L1: the preview: Not in Books 1 to add, nothing else');
SELECT public.t_eq(length(:'p1'::jsonb ->> 'digest'), 32, 'L1: ... with the plan''s digest');
SELECT public.t_eq(public.twob_import2b_catch_up(public.t_poster(), :'G', '09/2026', true) ->> 'digest', :'p1'::jsonb ->> 'digest',
  'L1: the same month planned again has the same digest');
-- Meanwhile, a Liberal user corrects B-1's entry on 2B Reconciliation.
UPDATE public.bills_not_in_2b SET input_cgst = 95, input_sgst = 95 WHERE id = 'a99a0000-0000-0000-0000-0000000000c1';
SELECT public.t_raises(format($q$SELECT public.twob_import2b_catch_up(public.t_poster(), '%s', '09/2026', false, '%s')$q$, :'G', :'p1'::jsonb ->> 'digest'),
  'changed while the confirm was open', 'L1: the confirm accepted after the month changed: nothing is written, and it says why');
SELECT public.t_eq((SELECT concat_ws('|', (SELECT count(*) FROM public.bills_not_in_books WHERE client_id = :'G'),
                                     (SELECT input_cgst FROM public.bills_not_in_2b WHERE id = 'a99a0000-0000-0000-0000-0000000000c1'))),
  '0|95.00', 'L1: ... D-1 is not added, and B-1''s correction is not changed back without the confirm saying so');
SELECT public.twob_import2b_catch_up(public.t_poster(), :'G', '09/2026', true) AS p2 \gset
SELECT public.t_eq(concat_ws('|', :'p2'::jsonb -> 'bills_not_in_2b' ->> 'change', :'p2'::jsonb -> 'bills_not_in_books' ->> 'add',
                             (:'p2'::jsonb ->> 'digest') <> (:'p1'::jsonb ->> 'digest')),
  '1|1|t', 'L1: the new preview names B-1''s change too, with another digest');
SELECT public.t_eq((public.twob_import2b_catch_up(public.t_poster(), :'G', '09/2026', false, :'p2'::jsonb ->> 'digest') ->> 'written')::integer, 2,
  'L1: confirmed as previewed, it is written');
SELECT public.t_eq((SELECT concat_ws('|', (SELECT count(*) FROM public.bills_not_in_books WHERE client_id = :'G' AND source_doc_id = 'a99a0000-0000-0000-0000-0000000000d1'),
                                     (SELECT input_cgst FROM public.bills_not_in_2b WHERE id = 'a99a0000-0000-0000-0000-0000000000c1'))),
  '1|90.00', 'L1: ... D-1 added, B-1 back to its books row, as the confirm said');

-- ---------------------------------------------------------------------------
-- L5. Rows left out: on the ledger as last saved, or not on it.
-- ---------------------------------------------------------------------------
SELECT public.twob_import2b_catch_up(public.t_poster(), :'K', '09/2026', true) AS k1 \gset
SELECT public.t_eq((SELECT string_agg(concat_ws(':', s ->> 'number', s ->> 'reason', s ->> 'on_ledger'), ',' ORDER BY s ->> 'number')
                      FROM jsonb_array_elements(:'k1'::jsonb -> 'skipped') s),
  'B-3:Missing date:false,B-5:Missing date:true,B-6:Minus amount: amounts in the books register are always plus. Your debit note (purchase return) is entered as Type "Debit note (purchase return)" at plus amounts; correct this row:false',
  'L5: B-3 never posted (not on the ledger); B-5 posted before (stays as last saved); B-6 a minus row whose entry is taken back (not on it)');
SELECT public.t_eq(:'k1'::jsonb -> 'bills_not_in_2b' ->> 'remove', '1', 'L5: ... B-6''s entry is the one taken back');

-- ---------------------------------------------------------------------------
-- L1 (filed month). A GST Manager's save through the door writes only what
-- its preview showed.
-- ---------------------------------------------------------------------------
SELECT public.twob_import2b_prior_save(public.t_manager(), :'J', '07/2026',
  '[{"table":"books_register","op":"update","id":"a99a0000-0000-0000-0000-0000000000e1","values":{"input_cgst":1000,"input_sgst":1000}}]'::jsonb, true) AS q1 \gset
SELECT public.t_eq(concat_ws('|', :'q1'::jsonb ->> 'ok', length(:'q1'::jsonb ->> 'digest')), 'true|32', 'L1 filed: the preview, with its digest');
SELECT public.t_eq(public.twob_import2b_prior_save(public.t_manager(), :'J', '07/2026',
  '[{"table":"books_register","op":"update","id":"a99a0000-0000-0000-0000-0000000000e1","values":{"input_cgst":1000,"input_sgst":1000}}]'::jsonb, true) ->> 'digest',
  :'q1'::jsonb ->> 'digest', 'L1 filed: previewed again, the same digest');
SELECT public.t_eq(public.twob_import2b_prior_save(public.t_manager(), :'J', '07/2026',
  '[{"table":"books_register","op":"update","id":"a99a0000-0000-0000-0000-0000000000e1","values":{"input_cgst":1000,"input_sgst":1000}}]'::jsonb, false, false,
  :'q1'::jsonb ->> 'digest') ->> 'ok', 'true', 'L1 filed: confirmed as previewed, it is saved');
SELECT public.t_eq((SELECT string_agg(period_month || ':' || input_cgst, ',' ORDER BY period_month) FROM public.bills_not_in_2b
                     WHERE client_id = :'J' AND supplier_invoice_number = 'J-1'),
  '07/2026:1000.00,08/2026:1000.00', 'L1 filed: ... the entry and its August copy follow');
-- Previewed, then J-1's entry removed on 2B Reconciliation by someone else
-- (its books row goes with it): the confirm accepted saves nothing.
SELECT public.twob_import2b_prior_save(public.t_manager(), :'J', '07/2026',
  '[{"table":"books_register","op":"update","id":"a99a0000-0000-0000-0000-0000000000e1","values":{"input_cgst":1100,"input_sgst":1100}}]'::jsonb, true) AS q2 \gset
SELECT public.t_eq(public.twob_prior_books_apply(public.t_superadmin(), :'J', '07/2026',
  '[{"table":"bills_not_in_2b","op":"delete","id":"a99a0000-0000-0000-0000-0000000000f1"}]'::jsonb, false) ->> 'ok',
  'true', 'L1 filed: meanwhile J-1''s entry is removed on 2B Reconciliation');
SELECT public.t_raises(format($q$SELECT public.twob_import2b_prior_save(public.t_manager(), '%s', '07/2026',
  '[{"table":"books_register","op":"update","id":"a99a0000-0000-0000-0000-0000000000e1","values":{"input_cgst":1100,"input_sgst":1100}}]'::jsonb, false, false, '%s')$q$,
  :'J', :'q2'::jsonb ->> 'digest'),
  'changed while the confirm was open', 'L1 filed: the confirm accepted after the month changed: nothing is saved, and it says why');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'J' AND supplier_invoice_number = 'J-1'), 0,
  'L1 filed: ... J-1 is not put back by the stale confirm');
-- The whole month brought up to date (its Not in 2B side), previewed; then
-- a books row saved by the app of before (no write-through) lands: the
-- confirm accepted writes nothing; previewed again, it goes through.
SELECT set_config('twob.write', 'system', false);
RESET ROLE;
UPDATE public.bills_not_in_2b SET input_cgst = 950, input_sgst = 950 WHERE id = 'a99a0000-0000-0000-0000-0000000000f4';
SET ROLE anon;
SELECT set_config('twob.write', '', false);
SELECT public.twob_import2b_prior_save(public.t_manager(), :'J', '07/2026', '[]'::jsonb, true, true) AS q3 \gset
SELECT public.t_eq(concat_ws('|', :'q3'::jsonb ->> 'ok', (SELECT count(*) FROM jsonb_array_elements(:'q3'::jsonb -> 'changes') c WHERE c -> 'this' ->> 'action' = 'change')),
  'true|1', 'L1 filed: the whole month''s preview: J-4''s entry to change');
SELECT set_config('twob.write', 'system', false);
RESET ROLE;
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, book_treatment, doc_type) VALUES
  ('a99a0000-0000-0000-0000-0000000000e6', :'J', '07/2026', '2026-07-16', 'JAY SIX', 'J-6', '24JAYSI0000A1Z5', 600, 54, 54, 'NOT_IN_2B', 'INVOICE');
SET ROLE anon;
SELECT set_config('twob.write', '', false);
SELECT public.t_raises(format($q$SELECT public.twob_import2b_prior_save(public.t_manager(), '%s', '07/2026', '[]'::jsonb, false, true, '%s')$q$,
  :'J', :'q3'::jsonb ->> 'digest'),
  'changed while the confirm was open', 'L1 filed: the whole month changed while its confirm was open: nothing is written');
SELECT public.t_eq((SELECT concat_ws('|', (SELECT input_cgst FROM public.bills_not_in_2b WHERE id = 'a99a0000-0000-0000-0000-0000000000f4'),
                                     (SELECT count(*) FROM public.bills_not_in_2b WHERE client_id = :'J' AND supplier_invoice_number = 'J-6'))),
  '950.00|0', 'L1 filed: ... neither J-4 changed nor J-6 added');
SELECT public.twob_import2b_prior_save(public.t_manager(), :'J', '07/2026', '[]'::jsonb, true, true) AS q4 \gset
SELECT public.t_eq(public.twob_import2b_prior_save(public.t_manager(), :'J', '07/2026', '[]'::jsonb, false, true, :'q4'::jsonb ->> 'digest') ->> 'ok', 'true',
  'L1 filed: previewed again (J-6 named too) and confirmed, it is written');
SELECT public.t_eq((SELECT concat_ws('|', (SELECT input_cgst FROM public.bills_not_in_2b WHERE id = 'a99a0000-0000-0000-0000-0000000000f4'),
                                     (SELECT count(*) FROM public.bills_not_in_2b WHERE client_id = :'J' AND period_month = '07/2026' AND supplier_invoice_number = 'J-6'))),
  '900.00|1', 'L1 filed: ... J-4 follows its books row and J-6 is added');
-- A save that adds a books row: the row and its entry have new ids on every
-- run, yet the preview's digest is the same.
SELECT public.t_eq(
  public.twob_import2b_prior_save(public.t_manager(), :'J', '07/2026',
    '[{"table":"books_register","op":"insert","values":{"date":"2026-07-12","supplier_name":"JAY TWO","supplier_invoice_number":"J-2","supplier_gstin":"24JAYTW0000A1Z5","taxable_value":500,"input_igst":0,"input_cgst":45,"input_sgst":45,"book_treatment":"NOT_IN_2B","doc_type":"INVOICE"}}]'::jsonb, true) ->> 'digest',
  public.twob_import2b_prior_save(public.t_manager(), :'J', '07/2026',
    '[{"table":"books_register","op":"insert","values":{"date":"2026-07-12","supplier_name":"JAY TWO","supplier_invoice_number":"J-2","supplier_gstin":"24JAYTW0000A1Z5","taxable_value":500,"input_igst":0,"input_cgst":45,"input_sgst":45,"book_treatment":"NOT_IN_2B","doc_type":"INVOICE"}}]'::jsonb, true) ->> 'digest',
  'L1 filed: an added row''s preview has the same digest on every run');

RESET ROLE;
