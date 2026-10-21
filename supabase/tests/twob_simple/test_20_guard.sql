-- The guard on the four tables, as PostgREST writes (anon): a prior month is
-- refused for every direct write, whoever sends it; an open month works as
-- before; the lock columns, a link cleared by its document's deletion and a
-- client's deletion stay allowed; moving a row is refused in every month.
\set G '20000000-0000-0000-0000-000000000001'
\set D '20000000-0000-0000-0000-000000000002'
SELECT public.t_make_sorath(:'G', 'Guard', false);
SELECT public.t_make_tamnna(:'D', 'Guard delete');
-- A Sep-26 Import 2B document and books row (Sep is open), and a July one
-- written before the month was filed (as live).
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, input_cgst, input_sgst, itc_action)
VALUES ('20000000-0000-0000-0000-0000000000d7', :'G', '07/2026', '2026-07-03', 'DOC SUPPLIER', 'D-7', '24DOCSU0000A1Z5', 10, 10, 'NOT_IN_BOOKS'),
       ('20000000-0000-0000-0000-0000000000d9', :'G', '09/2026', '2026-09-03', 'DOC SUPPLIER', 'D-9', '24DOCSU0000A1Z5', 10, 10, 'NOT_IN_BOOKS');
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, input_cgst, input_sgst)
VALUES ('20000000-0000-0000-0000-0000000000b7', :'G', '07/2026', '2026-07-03', 'BOOK SUPPLIER', 'K-7', '24BOOKS0000A1Z5', 10, 10),
       ('20000000-0000-0000-0000-0000000000b9', :'G', '09/2026', '2026-09-03', 'BOOK SUPPLIER', 'K-9', '24BOOKS0000A1Z5', 10, 10);
UPDATE public.bills_not_in_books SET source_doc_id = '20000000-0000-0000-0000-0000000000d7'
 WHERE client_id = :'G' AND period_month = '07/2026' AND supplier_invoice_number = 'N-1';
SELECT set_config('twob.write', '', false);

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);

-- Prior month (Jul-26): every direct write refused, on all four tables.
SELECT public.t_raises($$INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, input_cgst, input_sgst, reversal_month)
  VALUES ('20000000-0000-0000-0000-000000000001', '07/2026', '2026-07-30', 'NEW', 5, 5, 'Jul 26')$$,
  'This month is filed. Only a GST Manager or the superadmin can change its books entries, from Import 2B or 2B Reconciliation.', 'Jul-26: adding a Not in 2B row refused');
SELECT public.t_raises($$UPDATE public.bills_not_in_2b SET supplier_name = 'RENAMED' WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '07/2026' AND supplier_name = 'OLD A'$$,
  'This month is filed', 'Jul-26: changing a Not in 2B row refused');
SELECT public.t_raises($$UPDATE public.bills_not_in_2b SET reclaim_month = 'Jul 26' WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '07/2026' AND supplier_name = 'OLD A'$$,
  'This month is filed', 'Jul-26: a reclaim month refused');
SELECT public.t_raises($$UPDATE public.bills_not_in_2b SET reclaim_month = 'Jul 26', reclaim_subtype = 'EXPENSE_OUT' WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '07/2026' AND supplier_name = 'OLD B'$$,
  'This month is filed', 'Jul-26: Expense out refused');
SELECT public.t_raises($$DELETE FROM public.bills_not_in_2b WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '07/2026' AND supplier_name = 'BOI - CC'$$,
  'This month is filed', 'Jul-26: deleting Not in 2B rows refused');
SELECT public.t_raises($$UPDATE public.bills_not_in_books SET book_entry_month = 'Jul 26' WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '07/2026'$$,
  'This month is filed', 'Jul-26: a book entry month refused');
SELECT public.t_raises($$DELETE FROM public.bills_not_in_books WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '07/2026'$$,
  'This month is filed', 'Jul-26: deleting a Not in Books row refused');
SELECT public.t_raises($$INSERT INTO public.books_register (client_id, period_month, book_treatment) VALUES ('20000000-0000-0000-0000-000000000001', '07/2026', 'NOT_IN_2B')$$,
  'This month is filed', 'Jul-26: adding a books register row refused');
SELECT public.t_raises($$UPDATE public.books_register SET input_cgst = 99 WHERE id = '20000000-0000-0000-0000-0000000000b7'$$,
  'This month is filed', 'Jul-26: changing a books register row refused');
SELECT public.t_raises($$DELETE FROM public.books_register WHERE id = '20000000-0000-0000-0000-0000000000b7'$$,
  'This month is filed', 'Jul-26: deleting a books register row refused');
SELECT public.t_raises($$INSERT INTO public.twob_import_docs (client_id, period_month, supplier_name, itc_action) VALUES ('20000000-0000-0000-0000-000000000001', '07/2026', 'IMPORTED', 'MATCHED')$$,
  'This month is filed. Its 2B documents cannot change.', 'Jul-26: importing a 2B document refused');
SELECT public.t_raises($$UPDATE public.twob_import_docs SET itc_action = 'MATCHED' WHERE id = '20000000-0000-0000-0000-0000000000d7'$$,
  'Its 2B documents cannot change', 'Jul-26: a 2B document treatment refused');
SELECT public.t_raises($$DELETE FROM public.twob_import_docs WHERE id = '20000000-0000-0000-0000-0000000000d7'$$,
  'Its 2B documents cannot change', 'Jul-26: deleting a 2B document (Delete 2B) refused');
SELECT public.t_raises($$UPDATE public.twob_import_docs SET posted_at = now() WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '07/2026'$$,
  'Its 2B documents cannot change', 'Jul-26: even a posting stamp refused');

-- Allowed in a prior month: the lock columns only (the filing lock, Unlock sheets).
SELECT public.t_ok($$UPDATE public.bills_not_in_2b SET is_locked = false WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '07/2026'$$, 'Jul-26: unlocking the rows');
SELECT public.t_ok($$UPDATE public.bills_not_in_2b SET is_locked = true WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '07/2026'$$, 'Jul-26: locking the rows');
SELECT public.t_ok($$UPDATE public.bills_not_in_books SET is_locked = true, updated_at = now() WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '07/2026'$$, 'Jul-26: locking Not in Books');
-- ... and a link cleared, as its document's deletion clears it (ON DELETE SET NULL).
SELECT public.t_ok($$UPDATE public.bills_not_in_books SET source_doc_id = NULL WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '07/2026'$$, 'Jul-26: a cleared link');
SELECT public.t_raises($$UPDATE public.bills_not_in_books SET source_doc_id = '20000000-0000-0000-0000-0000000000d7' WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '07/2026'$$,
  'This month is filed', 'Jul-26: setting a link refused');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'G' AND period_month = '07/2026'), 19, 'Jul-26: every row still there');

-- Open month (Sep-26): the app's writes work as before.
SELECT public.t_ok($$INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, input_cgst, input_sgst, reversal_month)
  VALUES ('20000000-0000-0000-0000-000000000001', '09/2026', '2026-09-30', 'SEP NEW', 5, 5, 'Sep 26')$$, 'Sep-26: adding a row');
SELECT public.t_ok($$UPDATE public.bills_not_in_2b SET reclaim_month = 'Sep 26' WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '09/2026' AND supplier_name = 'OLD A'$$, 'Sep-26: a reclaim');
SELECT public.t_ok($$DELETE FROM public.bills_not_in_2b WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '09/2026' AND supplier_name = 'SEP NEW'$$, 'Sep-26: deleting a row');
SELECT public.t_ok($$UPDATE public.twob_import_docs SET itc_action = 'MATCHED' WHERE id = '20000000-0000-0000-0000-0000000000d9'$$, 'Sep-26: a 2B document treatment');
SELECT public.t_ok($$UPDATE public.books_register SET input_cgst = 11, input_sgst = 11 WHERE id = '20000000-0000-0000-0000-0000000000b9'$$, 'Sep-26: a books register row');
SELECT public.t_ok($$INSERT INTO public.twob_import_docs (client_id, period_month, supplier_name, itc_action) VALUES ('20000000-0000-0000-0000-000000000001', '09/2026', 'IMPORTED', 'MATCHED')$$, 'Sep-26: importing');
SELECT public.t_ok($$DELETE FROM public.twob_import_docs WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '09/2026' AND supplier_name = 'IMPORTED'$$, 'Sep-26: Delete 2B');

-- Moving a row to another month or client: refused in every month.
SELECT public.t_raises($$UPDATE public.bills_not_in_2b SET period_month = '10/2026' WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '09/2026' AND supplier_name = 'OLD B'$$,
  'cannot move to another month or client', 'Sep-26: moving a row to Oct-26 refused');
SELECT public.t_raises($$UPDATE public.bills_not_in_2b SET client_id = '20000000-0000-0000-0000-000000000002' WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '09/2026' AND supplier_name = 'OLD B'$$,
  'cannot move to another month or client', 'Sep-26: moving a row to another client refused');
SELECT public.t_raises($$UPDATE public.bills_not_in_2b SET period_month = '09/2026' WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '07/2026' AND supplier_name = 'OLD B'$$,
  'cannot move to another month or client', 'Jul-26: moving a row out of a filed month refused');
SELECT public.t_raises($$UPDATE public.books_register SET period_month = '10/2026' WHERE id = '20000000-0000-0000-0000-0000000000b9'$$,
  'cannot move to another month or client', 'Sep-26: moving a books register row refused');
SELECT public.t_raises($$UPDATE public.twob_import_docs SET period_month = '10/2026' WHERE id = '20000000-0000-0000-0000-0000000000d9'$$,
  'cannot move to another month or client', 'Sep-26: moving a 2B document refused');

-- A client deleted takes its rows, filed months included.
SELECT public.t_ok($$DELETE FROM public.clients WHERE id = '20000000-0000-0000-0000-000000000002'$$, 'deleting a client with filed months');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'D'), 0, 'its ledger rows went with it');
SELECT public.t_eq((SELECT count(*)::integer FROM public.books_register WHERE client_id = :'D'), 0, 'its books register went with it');
RESET ROLE;
