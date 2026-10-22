-- Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md
-- §15): the second verification round's findings, one test each, as
-- PostgREST runs the app's calls (anon, with the request headers; a4 holds
-- Import 2B & post, a3 holds no permission):
--   F1 an own entry is linked instead of adding a twin only when it carries
--      this month as its reversal (in-2B) month; a blank or other month gets
--      a twin beside it, as Post's; a linked own entry whose row stops posting
--      (another treatment, deleted, Delete 2B) goes back to what it held and
--      stays, its decision too; in a filed month the same (the door);
--   F3 a book entry or Expense out carried into an open month from a filed
--      month cannot be undone or changed there (any staff, any screen); the
--      month's own decisions can; Clear Data still clears the month;
--   F5 Restore puts entries back linked (a version's link, an older
--      version's entry id, or the document itself), so the next save
--      changes the entry instead of adding a second reversal; Expense out
--      and the reclaiming document come back too;
--   F6 the "not in step" line is one read-only statement any staff may call,
--      counting what the write-through or the catch-up would write;
--   F7 taking a document out of Reclaim is one call: the reclaim released
--      and the treatment saved together, or neither.
-- Fictional.
\set A 'af000000-0000-0000-0000-000000000001'
\set N 'af000000-0000-0000-0000-000000000002'
\set P 'af000000-0000-0000-0000-000000000003'
\set S 'af000000-0000-0000-0000-000000000004'
\set R 'af000000-0000-0000-0000-000000000005'
\set K 'af000000-0000-0000-0000-000000000006'
\set U 'af000000-0000-0000-0000-000000000007'

SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES
  (:'A', 'F1 ADOPT', '24FONEA0000A1Z5'),
  (:'N', 'F1 ADOPT NIB', '24FONEN0000A1Z5'),
  (:'P', 'F1 ADOPT FILED', '24FONEP0000A1Z5'),
  (:'R', 'F5 RESTORE', '24FFIVR0000A1Z5'),
  (:'K', 'F6 STEP', '24FSIXK0000A1Z5'),
  (:'U', 'F7 UNRECLAIM', '24FSEVU0000A1Z5');
-- F1: three own Not in 2B entries of Sep, typed on 2B Reconciliation, the
-- same documents as the books rows about to be typed: a blank reversal month,
-- another month's, and this month's.
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('af000000-0000-0000-0000-0000000000a1', :'A', '09/2026', '2026-09-05', 'HAND SUPPLIER', 'H/1', '24HANDS0000A1Z5', 1000, 0, 90, 90, NULL, false),
  ('af000000-0000-0000-0000-0000000000a2', :'A', '09/2026', '2026-09-05', 'HAND SUPPLIER', 'H/2', '24HANDS0000A1Z5', 1000, 0, 90, 90, 'Aug 26', false),
  ('af000000-0000-0000-0000-0000000000a3', :'A', '09/2026', '2026-09-05', 'Hand Supplier ', 'H-3', '24hands0000a1z5', 1000, 0, 90, 90, 'Sep 26', false);
-- F1 Not in Books: two own entries of Sep and the 2B documents they stand for (Matched).
INSERT INTO public.bills_not_in_books (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, bill_in_2b_month, is_carried_forward) VALUES
  ('af000000-0000-0000-0000-0000000000c1', :'N', '09/2026', '2026-09-05', 'DOC SUPPLIER', 'D/1', '24DOCSU0000A1Z5', 1000, 180, 0, 0, 'Sep 26', false),
  ('af000000-0000-0000-0000-0000000000c2', :'N', '09/2026', '2026-09-05', 'DOC SUPPLIER', 'D/2', '24DOCSU0000A1Z5', 1000, 180, 0, 0, NULL, false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, doc_type, itc_action) VALUES
  ('af000000-0000-0000-0000-0000000000d1', :'N', '09/2026', '2026-09-05', 'DOC SUPPLIER', 'D/1', '24DOCSU0000A1Z5', 1000, 180, 'INVOICE', 'MATCHED'),
  ('af000000-0000-0000-0000-0000000000d2', :'N', '09/2026', '2026-09-05', 'DOC SUPPLIER', 'D/2', '24DOCSU0000A1Z5', 1000, 180, 'INVOICE', 'MATCHED');
-- F1 filed: July filed; two books rows never posted, each with an own entry
-- of the same document: P/1's has a blank reversal month, P/2's July's.
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, book_treatment, doc_type) VALUES
  ('af000000-0000-0000-0000-0000000000e1', :'P', '07/2026', '2026-07-10', 'FILED SUP', 'P/1', '24FILED0000A1Z5', 1000, 90, 90, 'NOT_IN_2B', 'INVOICE'),
  ('af000000-0000-0000-0000-0000000000e2', :'P', '07/2026', '2026-07-11', 'FILED SUP', 'P/2', '24FILED0000A1Z5', 2000, 180, 180, 'NOT_IN_2B', 'INVOICE');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('af000000-0000-0000-0000-0000000000f1', :'P', '07/2026', '2026-07-10', 'FILED SUP', 'P/1', '24FILED0000A1Z5', 1000, 0, 90, 90, NULL, false),
  ('af000000-0000-0000-0000-0000000000f2', :'P', '07/2026', '2026-07-11', 'FILED SUP', 'P/2', '24FILED0000A1Z5', 2000, 0, 180, 180, 'Jul 26', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status, filed_date, is_locked) VALUES
  (:'P', 'GSTR-3B', '07/2026', 'Filed', '2026-08-20', true);
-- F3: the SORATH case (Aug-26 filed, Sep-26 open; Sep's carried copy of N-1
-- holds August's book entry), with a carried Expense out of August too.
SELECT public.t_make_sorath(:'S', 'F3 SORATH', false);
SELECT set_config('twob.write', 'system', false);
UPDATE public.bills_not_in_2b SET reclaim_month = 'Aug 26', reclaim_subtype = 'EXPENSE_OUT'
 WHERE client_id = :'S' AND period_month IN ('08/2026', '09/2026') AND supplier_name = 'OLD B';
SELECT set_config('twob.write', '', false);

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);

-- ---------------------------------------------------------------------------
-- F1. Which own entry is linked, and what becomes of it.
-- ---------------------------------------------------------------------------
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, book_treatment, doc_type) VALUES
  ('af000000-0000-0000-0000-0000000000b1', :'A', '09/2026', '2026-09-05', 'HAND SUPPLIER', 'H/1', '24HANDS0000A1Z5', 1000, 90, 90, 'NOT_IN_2B', 'INVOICE'),
  ('af000000-0000-0000-0000-0000000000b2', :'A', '09/2026', '2026-09-05', 'HAND SUPPLIER', 'H/2', '24HANDS0000A1Z5', 1000, 90, 90, 'NOT_IN_2B', 'INVOICE'),
  ('af000000-0000-0000-0000-0000000000b3', :'A', '09/2026', '2026-09-05', 'HAND SUPPLIER', 'H/3', '24HANDS0000A1Z5', 1000, 90, 90, 'NOT_IN_2B', 'INVOICE');
SELECT public.t_eq((SELECT string_agg(concat_ws(':', supplier_invoice_number, COALESCE(reversal_month, '-'), source_book_id IS NOT NULL), ',' ORDER BY supplier_invoice_number, reversal_month NULLS FIRST)
                      FROM public.bills_not_in_2b WHERE client_id = :'A' AND supplier_invoice_number = 'H/1'),
  'H/1:-:f,H/1:Sep 26:t', 'F1: an own entry with a blank reversal month gets a twin beside it, as Post added one (4B(2)(i) counts only this month''s)');
SELECT public.t_eq((SELECT string_agg(concat_ws(':', supplier_invoice_number, reversal_month, source_book_id IS NOT NULL), ',' ORDER BY reversal_month)
                      FROM public.bills_not_in_2b WHERE client_id = :'A' AND supplier_invoice_number = 'H/2'),
  'H/2:Aug 26:f,H/2:Sep 26:t', 'F1: ... and one with another month''s reversal month');
SELECT public.t_eq((SELECT concat_ws('|', count(*), bool_and(source_book_id = 'af000000-0000-0000-0000-0000000000b3'),
                                     min(supplier_invoice_number), min(adopted_from ->> 'supplier_invoice_number'), min(adopted_from ->> 'supplier_name'))
                      FROM public.bills_not_in_2b WHERE client_id = :'A' AND id = 'af000000-0000-0000-0000-0000000000a3'),
  '1|t|H/3|H-3|Hand Supplier ', 'F1: one with this month''s reversal month (the same document) is linked instead, what it held kept');
SELECT public.t_eq((SELECT sum(input_cgst) FROM public.bills_not_in_2b WHERE client_id = :'A' AND public.twob_label_matches(reversal_month, '09/2026')),
  270.00, 'F1: Sep 4B(2)(i) CGST: 90 for each of the three books rows, none twice');
UPDATE public.books_register SET input_cgst = 100, input_sgst = 100 WHERE id = 'af000000-0000-0000-0000-0000000000b3';
SELECT public.t_eq((SELECT concat_ws('|', input_cgst, adopted_from ->> 'input_cgst') FROM public.bills_not_in_2b WHERE id = 'af000000-0000-0000-0000-0000000000a3'),
  '100.00|90.00', 'F1: the linked entry follows its books row; what it held stays kept');
-- A decision on it, then its books row stops posting: put back, unlinked, the decision kept (not refused).
UPDATE public.bills_not_in_2b SET reclaim_month = 'Sep 26' WHERE id = 'af000000-0000-0000-0000-0000000000a3';
UPDATE public.books_register SET book_treatment = 'MISMATCHED' WHERE id = 'af000000-0000-0000-0000-0000000000b3';
SELECT public.t_eq((SELECT concat_ws('|', count(*), min(input_cgst), bool_or(source_book_id IS NOT NULL), bool_or(adopted_from IS NOT NULL), min(supplier_invoice_number), min(reclaim_month))
                      FROM public.bills_not_in_2b WHERE client_id = :'A' AND id = 'af000000-0000-0000-0000-0000000000a3'),
  '1|90.00|f|f|H-3|Sep 26', 'F1: its row no longer posting, the own entry is put back as it was and unlinked, never removed; its reclaim stays');
UPDATE public.bills_not_in_2b SET reclaim_month = NULL WHERE id = 'af000000-0000-0000-0000-0000000000a3';
UPDATE public.books_register SET book_treatment = 'NOT_IN_2B', input_cgst = 90, input_sgst = 90 WHERE id = 'af000000-0000-0000-0000-0000000000b3';
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'A' AND source_book_id = 'af000000-0000-0000-0000-0000000000b3' AND id = 'af000000-0000-0000-0000-0000000000a3'),
  1, 'F1: posting again, it is linked again');
UPDATE public.books_register SET input_cgst = 120, input_sgst = 120 WHERE id = 'af000000-0000-0000-0000-0000000000b3';
DELETE FROM public.books_register WHERE id = 'af000000-0000-0000-0000-0000000000b3';
SELECT public.t_eq((SELECT concat_ws('|', count(*), min(input_cgst), bool_or(source_book_id IS NOT NULL), bool_or(adopted_from IS NOT NULL))
                      FROM public.bills_not_in_2b WHERE client_id = :'A' AND supplier_invoice_number IN ('H/3', 'H-3')),
  '1|90.00|f|f', 'F1: its books row deleted, the own entry goes back to what it held and stays (Post''s twin, added and taken back, left it so)');
DELETE FROM public.books_register WHERE id = 'af000000-0000-0000-0000-0000000000b1';
SELECT public.t_eq((SELECT string_agg(COALESCE(reversal_month, '-'), ',') FROM public.bills_not_in_2b WHERE client_id = :'A' AND supplier_invoice_number = 'H/1'),
  '-', 'F1: the twin added beside a blank-month entry is taken back with its row; the own entry stays');

-- Not in Books: a document parked Not in Books and back.
UPDATE public.twob_import_docs SET itc_action = 'NOT_IN_BOOKS' WHERE id IN ('af000000-0000-0000-0000-0000000000d1', 'af000000-0000-0000-0000-0000000000d2');
SELECT public.t_eq((SELECT concat_ws('|', count(*) FILTER (WHERE supplier_invoice_number = 'D/1'), count(*) FILTER (WHERE supplier_invoice_number = 'D/2'),
                                     bool_and(source_doc_id IS NOT NULL) FILTER (WHERE id = 'af000000-0000-0000-0000-0000000000c1'))
                      FROM public.bills_not_in_books WHERE client_id = :'N'),
  '1|2|t', 'F1: Not in Books: the own entry with this month as its in-2B month is linked; one with a blank month gets a twin');
UPDATE public.twob_import_docs SET itc_action = 'MATCHED' WHERE id = 'af000000-0000-0000-0000-0000000000d1';
SELECT public.t_eq((SELECT concat_ws('|', count(*), bool_or(source_doc_id IS NOT NULL), bool_or(adopted_from IS NOT NULL), min(input_igst))
                      FROM public.bills_not_in_books WHERE client_id = :'N' AND supplier_invoice_number = 'D/1'),
  '1|f|f|180.00', 'F1: the document back to Matched, the own entry stays, unlinked (Post would have left it)');
UPDATE public.twob_import_docs SET itc_action = 'NOT_IN_BOOKS' WHERE id = 'af000000-0000-0000-0000-0000000000d1';
SELECT public.t_eq((SELECT public.twob_import2b_delete_2b(public.t_manager(), :'N', '09/2026') ->> 'deleted'), '2',
  'F1: Delete 2B deletes the month''s documents');
SELECT public.t_eq((SELECT string_agg(concat_ws(':', supplier_invoice_number, COALESCE(bill_in_2b_month, '-'), source_doc_id IS NOT NULL), ',' ORDER BY supplier_invoice_number, bill_in_2b_month NULLS FIRST)
                      FROM public.bills_not_in_books WHERE client_id = :'N'),
  'D/1:Sep 26:f,D/2:-:f', 'F1: ... the own entries stay (D/1 put back, unlinked), the twin it added goes');

-- A filed month: the same rule through the door.
RESET ROLE;
SELECT public.t_eq((SELECT jsonb_agg(l ->> 'id') FROM jsonb_array_elements(public.twob__prior_derived(:'P', '07/2026', NULL) -> 'links') l),
  '["af000000-0000-0000-0000-0000000000f2"]'::jsonb, 'F1 (filed): only the own entry with July as its reversal month is to be linked');
SET ROLE anon;
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a2","x-gst-source":"app"}', false);
SELECT public.twob_import2b_prior_save(public.t_manager(), :'P', '07/2026', '[]'::jsonb, false, true);
SELECT public.t_eq((SELECT concat_ws('|', source_book_id = 'af000000-0000-0000-0000-0000000000e2', adopted_from IS NOT NULL)
                      FROM public.bills_not_in_2b WHERE id = 'af000000-0000-0000-0000-0000000000f2'),
  't|t', 'F1 (filed): brought up to date, the July entry is linked, what it held kept');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'P' AND period_month = '07/2026' AND supplier_invoice_number = 'P/2'), 1,
  'F1 (filed): ... no twin of it');
SELECT public.t_eq((SELECT source_book_id IS NULL FROM public.bills_not_in_2b WHERE id = 'af000000-0000-0000-0000-0000000000f1'), true,
  'F1 (filed): the blank-month entry is never linked');
SELECT public.twob_import2b_prior_save(public.t_manager(), :'P', '07/2026',
  '[{"table": "books_register", "op": "delete", "id": "af000000-0000-0000-0000-0000000000e2"}]'::jsonb, false);
SELECT public.t_eq((SELECT concat_ws('|', count(*), bool_or(source_book_id IS NOT NULL), bool_or(adopted_from IS NOT NULL), min(input_cgst))
                      FROM public.bills_not_in_2b WHERE client_id = :'P' AND period_month = '07/2026' AND supplier_invoice_number = 'P/2'),
  '1|f|f|180.00', 'F1 (filed): its books row deleted through the door, the own entry stays, unlinked, as it was');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);

-- ---------------------------------------------------------------------------
-- F3. A filed month's decision on an open month's carried copy.
-- ---------------------------------------------------------------------------
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a3","x-gst-source":"app"}', false);
SELECT public.t_raises(format($q$UPDATE public.bills_not_in_books SET book_entry_month = NULL, updated_by = '00000000-0000-0000-0000-0000000000a3'
                                WHERE client_id = '%s' AND period_month = '09/2026' AND supplier_invoice_number = 'N-1'$q$, :'S'),
  'NIB SUPPLIER N-1: Aug-26 (filed) booked this entry. A filed month''s decision stays as filed',
  'F3: an employee''s Undo book entry on Sep''s carried copy of a book entry made in filed Aug is refused');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a2","x-gst-source":"app"}', false);
SELECT public.t_raises(format($q$UPDATE public.bills_not_in_books SET book_entry_month = 'Sep 26'
                                WHERE client_id = '%s' AND period_month = '09/2026' AND supplier_invoice_number = 'N-1'$q$, :'S'),
  'Aug-26 (filed) booked this entry', 'F3: ... a GST Manager''s change of it too (2B Reconciliation)');
SELECT public.t_raises(format($q$UPDATE public.bills_not_in_2b SET reclaim_month = NULL, reclaim_subtype = NULL
                                WHERE client_id = '%s' AND period_month = '09/2026' AND supplier_name = 'OLD B'$q$, :'S'),
  'OLD B B-1: Aug-26 (filed) expensed out this entry', 'F3: ... and an Undo of an Expense out made in filed Aug');
SELECT public.t_eq((SELECT string_agg(concat_ws(':', period_month, book_entry_month), ',' ORDER BY period_month)
                      FROM public.bills_not_in_books WHERE client_id = :'S' AND supplier_invoice_number = 'N-1'),
  '07/2026,08/2026:Aug 26,09/2026:Aug 26', 'F3: ... Aug and Sep still say booked in Aug 26');
-- The month's own decisions change as before, on a carried copy too.
UPDATE public.bills_not_in_2b SET reclaim_month = 'Sep 26' WHERE client_id = :'S' AND period_month = '09/2026' AND supplier_name = 'OLD A';
UPDATE public.bills_not_in_2b SET reclaim_month = NULL WHERE client_id = :'S' AND period_month = '09/2026' AND supplier_name = 'OLD A';
SELECT public.t_eq((SELECT reclaim_month FROM public.bills_not_in_2b WHERE client_id = :'S' AND period_month = '09/2026' AND supplier_name = 'OLD A'),
  NULL::text, 'F3: Sep''s own reclaim of a carried entry is made and undone as before');
-- Rewriting the same decision, or another column, is no change of it.
UPDATE public.bills_not_in_books SET book_entry_month = 'Aug 26', updated_by = public.t_manager()
 WHERE client_id = :'S' AND period_month = '09/2026' AND supplier_invoice_number = 'N-1';
-- Clear Data still clears the open month (the carried copy goes with its filed decision; the carry brings it back).
SELECT public.t_eq((SELECT (public.twob_clear_year(public.t_manager(), :'S', ARRAY['09/2026']) -> 'cleared')), '["09/2026"]'::jsonb,
  'F3: Clear Data of the open month is not stopped by the filed decisions its carried copies hold');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE client_id = :'S' AND period_month = '09/2026'), 0,
  'F3: ... the month cleared');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);

-- ---------------------------------------------------------------------------
-- F5. Restore puts entries back linked.
-- ---------------------------------------------------------------------------
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, book_treatment, doc_type) VALUES
  ('af000000-0000-0000-0000-0000000005b1', :'R', '09/2026', '2026-09-05', 'IOTA', 'I-1', '24IOTAA0000A1Z5', 3000, 300, 300, 'NOT_IN_2B', 'INVOICE');
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, doc_type, itc_action) VALUES
  ('af000000-0000-0000-0000-0000000005d1', :'R', '09/2026', '2026-09-06', 'ZETA', 'Z-1', '24ZETAA0000A1Z5', 7000, 700, 700, 'INVOICE', 'RECLAIM');
SELECT public.twob_import2b_flush_version(public.t_poster(), :'R', '09/2026');
SELECT public.t_eq((SELECT version_data -> 'billsNotIn2B' -> 0 ->> 'sourceBookId' FROM public.twob_versions WHERE client_id = :'R' ORDER BY version_number DESC LIMIT 1),
  'af000000-0000-0000-0000-0000000005b1', 'F5: the write-through''s version records each entry''s Import 2B link');
-- The version as the page sends it (snake_case, from the version's rows).
CREATE TEMP TABLE f5_v1 AS
  SELECT jsonb_agg(jsonb_build_object('id', r ->> 'id', 'date', r ->> 'date', 'supplier_name', r ->> 'supplierName',
           'supplier_invoice_number', r ->> 'supplierInvoiceNumber', 'supplier_gstin', r ->> 'supplierGstin',
           'taxable_value', r -> 'taxableValue', 'input_igst', r -> 'inputIgst', 'input_cgst', r -> 'inputCgst', 'input_sgst', r -> 'inputSgst',
           'reversal_month', r ->> 'reversalMonth', 'reclaim_month', NULLIF(r ->> 'reclaimMonth', ''), 'is_carried_forward', r -> 'isCarriedForward',
           'reclaim_subtype', r ->> 'reclaimSubtype', 'reclaimed_via_doc_id', r ->> 'reclaimedViaDocId',
           'source_book_id', r ->> 'sourceBookId', 'adopted_from', r -> 'adoptedFrom')) AS rows
    FROM public.twob_versions v, jsonb_array_elements(v.version_data -> 'billsNotIn2B') r
   WHERE v.client_id = 'af000000-0000-0000-0000-000000000005' AND v.version_number = 1;
UPDATE public.books_register SET input_cgst = 320, input_sgst = 320 WHERE id = 'af000000-0000-0000-0000-0000000005b1';
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.t_eq((SELECT public.twob_restore_version_linked(public.t_superadmin(), :'R', '09/2026', (SELECT rows FROM f5_v1), '[]'::jsonb) ->> 'linked'), '1',
  'F5: the superadmin restores v1 (I-1 at 300): its entry is linked again');
SELECT public.t_eq((SELECT concat_ws('|', count(*), min(input_cgst), bool_and(source_book_id = 'af000000-0000-0000-0000-0000000005b1')) FROM public.bills_not_in_2b WHERE client_id = :'R'),
  '1|300.00|t', 'F5: ... I-1 at 300, linked to its books row');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
UPDATE public.books_register SET input_cgst = 330, input_sgst = 330 WHERE id = 'af000000-0000-0000-0000-0000000005b1';
SELECT public.t_eq((SELECT concat_ws('|', count(*), sum(input_cgst)) FROM public.bills_not_in_2b WHERE client_id = :'R' AND public.twob_label_matches(reversal_month, '09/2026')),
  '1|330.00', 'F5: the next save changes the restored entry: one reversal, 4B(2)(i) CGST 330, not 300 + 330');
-- A version of before this release (no link; the entry of that id is the month's now).
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'R', '09/2026',
  (SELECT jsonb_agg(e - 'source_book_id' - 'adopted_from' || jsonb_build_object('input_cgst', 310, 'input_sgst', 310)) FROM jsonb_array_elements((SELECT rows FROM f5_v1)) e), '[]'::jsonb);
SELECT public.t_eq((SELECT concat_ws('|', count(*), min(input_cgst), bool_and(source_book_id IS NOT NULL), bool_and(adopted_from IS NULL)) FROM public.bills_not_in_2b WHERE client_id = :'R'),
  '1|310.00|t|t', 'F5: an older version (no link) takes back the link its entry of the same id holds');
-- One whose entry id is gone (a Clear Data since): linked by the document, as an own entry.
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'R', '09/2026',
  '[{"id": "af000000-0000-0000-0000-00000000f5f5", "date": "2026-09-05", "supplier_name": "IOTA", "supplier_invoice_number": "I-1", "supplier_gstin": "24IOTAA0000A1Z5",
     "taxable_value": 3000, "input_igst": 0, "input_cgst": 305, "input_sgst": 305, "reversal_month": "Sep 26", "is_carried_forward": false},
    {"id": "af000000-0000-0000-0000-00000000f5f6", "date": "2026-09-01", "supplier_name": "OLD EXP", "supplier_invoice_number": "X-1", "supplier_gstin": "24OLDEX0000A1Z5",
     "taxable_value": 100, "input_igst": 18, "input_cgst": 0, "input_sgst": 0, "reversal_month": "Aug 26", "reclaim_month": "Sep 26", "reclaim_subtype": "EXPENSE_OUT",
     "is_carried_forward": false},
    {"id": "af000000-0000-0000-0000-00000000f5f7", "date": "2026-08-20", "supplier_name": "ZETA OLD", "supplier_invoice_number": "R-9", "supplier_gstin": "24ZETOL0000A1Z5",
     "taxable_value": 7000, "input_igst": 0, "input_cgst": 700, "input_sgst": 700, "reversal_month": "Aug 26", "reclaim_month": "Sep 26",
     "reclaimed_via_doc_id": "af000000-0000-0000-0000-0000000005d1", "is_carried_forward": false}]'::jsonb, '[]'::jsonb);
SELECT public.t_eq((SELECT concat_ws('|', id, input_cgst, source_book_id = 'af000000-0000-0000-0000-0000000005b1', adopted_from ->> 'input_cgst')
                      FROM public.bills_not_in_2b WHERE client_id = :'R' AND supplier_invoice_number = 'I-1'),
  'af000000-0000-0000-0000-00000000f5f5|305.00|t|305.00', 'F5: an older version whose entry id is gone: linked by the document (amounts aside), keeping its id');
SELECT public.t_eq((SELECT concat_ws('|', reclaim_subtype, reclaim_month) FROM public.bills_not_in_2b WHERE client_id = :'R' AND supplier_invoice_number = 'X-1'),
  'EXPENSE_OUT|Sep 26', 'F5: an Expense out comes back as an Expense out (not a reclaim)');
SELECT public.t_eq((SELECT reclaimed_via_doc_id::text FROM public.bills_not_in_2b WHERE client_id = :'R' AND supplier_invoice_number = 'R-9'),
  'af000000-0000-0000-0000-0000000005d1', 'F5: a reclaim keeps the 2B document that evidences it');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
UPDATE public.books_register SET input_cgst = 340, input_sgst = 340 WHERE id = 'af000000-0000-0000-0000-0000000005b1';
SELECT public.t_eq((SELECT concat_ws('|', count(*), sum(input_cgst)) FROM public.bills_not_in_2b WHERE client_id = :'R' AND supplier_invoice_number = 'I-1'),
  '1|340.00', 'F5: ... the next save changes it, no second reversal');
DELETE FROM public.books_register WHERE id = 'af000000-0000-0000-0000-0000000005b1';
SELECT public.t_eq((SELECT concat_ws('|', count(*), min(input_cgst), bool_or(source_book_id IS NOT NULL)) FROM public.bills_not_in_2b WHERE client_id = :'R' AND supplier_invoice_number = 'I-1'),
  '1|305.00|f', 'F5: ... and its books row deleted, it goes back to what was restored and stays (Post would have left the restored entry)');

-- ---------------------------------------------------------------------------
-- F6. The line, in one read-only statement.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
RESET ROLE;
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, book_treatment, doc_type) VALUES
  ('af000000-0000-0000-0000-0000000006b1', :'K', '09/2026', '2026-09-05', 'STEP SUP', 'K-1', '24STEPS0000A1Z5', 1000, 90, 90, 'NOT_IN_2B', 'INVOICE'),
  ('af000000-0000-0000-0000-0000000006b2', :'K', '09/2026', '2026-09-06', 'STEP SUP', 'K-2', '24STEPS0000A1Z5', 2000, 180, 180, 'NOT_IN_2B', 'INVOICE');
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, doc_type, itc_action) VALUES
  ('af000000-0000-0000-0000-0000000006d1', :'K', '09/2026', '2026-09-07', 'STEP DOC', 'KD-1', '24STEPD0000A1Z5', 500, 90, 'INVOICE', 'NOT_IN_BOOKS');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, source_book_id) VALUES
  (:'K', '09/2026', '2026-09-06', 'STEP SUP', 'K-2', '24STEPS0000A1Z5', 2000, 0, 150, 150, 'Sep 26', 'af000000-0000-0000-0000-0000000006b2');
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a3","x-gst-source":"app"}', false);
SELECT public.t_eq((SELECT public.twob_import2b_step(:'K', '09/2026')),
  '{"prior": false, "bills_not_in_2b": {"add": 1, "link": 0, "names": ["STEP SUP K-1", "STEP SUP K-2"], "change": 1, "remove": 0, "unlink": 0},
    "bills_not_in_books": {"add": 1, "link": 0, "names": ["STEP DOC KD-1"], "change": 0, "remove": 0, "unlink": 0}}'::jsonb,
  'F6: any staff reads the line: Not in 2B 1 to add, 1 to change; Not in Books 1 to add, named');
SELECT public.t_eq((SELECT (public.twob_import2b_step(:'K', '09/2026') -> 'bills_not_in_2b') - 'names'),
  public.twob_import2b_catch_up(public.t_poster(), :'K', '09/2026', true) -> 'bills_not_in_2b',
  'F6: ... counting what "Bring the reconciliation up to date" would write');
RESET ROLE;
SELECT public.t_eq((SELECT p.provolatile::text || p.prosecdef::text FROM pg_proc p WHERE p.oid = 'public.twob_import2b_step(uuid, text)'::regprocedure),
  'strue', 'F6: one read-only statement (STABLE: every read of it sees one snapshot)');
SET ROLE anon;
SELECT public.t_eq((SELECT public.twob_import2b_step(:'P', '07/2026') ->> 'prior'), 'true', 'F6: a filed month says so');
SELECT public.t_eq(public.twob_import2b_step(:'K', 'not a month'), NULL::jsonb, 'F6: no month, no line');

-- ---------------------------------------------------------------------------
-- F7. A document out of Reclaim, in one call.
-- ---------------------------------------------------------------------------
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
RESET ROLE;
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('af000000-0000-0000-0000-0000000007e1', :'U', '09/2026', '2026-08-20', 'GAMMA', 'G-301', '24GAMMA0000A1Z5', 1000, 180, 0, 0, 'Aug 26', true);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, doc_type, itc_action) VALUES
  ('af000000-0000-0000-0000-0000000007d1', :'U', '09/2026', '2026-08-20', 'GAMMA', 'G-301', '24GAMMA0000A1Z5', 1000, 180, 'INVOICE', 'MATCHED');
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.twob_import2b_reclaim(public.t_poster(), :'U', '09/2026', 'af000000-0000-0000-0000-0000000007e1', 'af000000-0000-0000-0000-0000000007d1', 'MATCHED');
-- A failure in the second half (the treatment refused) leaves both as they were.
SELECT public.t_raises(format($q$SELECT public.twob_import2b_unreclaim(public.t_poster(), '%s', '09/2026', 'af000000-0000-0000-0000-0000000007d1', 'BOGUS', 'af000000-0000-0000-0000-0000000007e1')$q$, :'U'),
  'twob_import_docs_itc_action_check', 'F7: a treatment the document cannot take is refused');
SELECT public.t_eq((SELECT concat_ws('|', reclaim_month, reclaimed_via_doc_id IS NOT NULL, (SELECT itc_action FROM public.twob_import_docs WHERE id = 'af000000-0000-0000-0000-0000000007d1'))
                      FROM public.bills_not_in_2b WHERE id = 'af000000-0000-0000-0000-0000000007e1'),
  'Sep 26|t|RECLAIM', 'F7: ... and nothing of the call is kept: the reclaim stands, the document stays Reclaim (counted in 5.4, not nowhere)');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a3","x-gst-source":"app"}', false);
SELECT public.t_raises(format($q$SELECT public.twob_import2b_unreclaim(public.t_employee(), '%s', '09/2026', 'af000000-0000-0000-0000-0000000007d1', 'NOT_IN_BOOKS', 'af000000-0000-0000-0000-0000000007e1')$q$, :'U'),
  'Needs the Import 2B & post permission', 'F7: an employee without Import 2B & post is refused');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t_eq(public.twob_import2b_unreclaim(public.t_poster(), :'U', '09/2026', 'af000000-0000-0000-0000-0000000007d1', 'NOT_IN_BOOKS', 'af000000-0000-0000-0000-0000000007e1'),
  '{"ok": true, "was": "RECLAIM", "released": 1}'::jsonb, 'F7: out of Reclaim to Not in Books, in one call');
SELECT public.t_eq((SELECT concat_ws('|', COALESCE(reclaim_month, '-'), reclaimed_via_doc_id IS NULL, (SELECT itc_action FROM public.twob_import_docs WHERE id = 'af000000-0000-0000-0000-0000000007d1'),
                                     (SELECT count(*) FROM public.bills_not_in_books WHERE source_doc_id = 'af000000-0000-0000-0000-0000000007d1'))
                      FROM public.bills_not_in_2b WHERE id = 'af000000-0000-0000-0000-0000000007e1'),
  '-|t|NOT_IN_BOOKS|1', 'F7: ... the entry back in Awaiting reclaim, the document Not in Books with its entry posted');
SELECT public.t_eq(public.twob_import2b_unreclaim(public.t_poster(), :'U', '09/2026', 'af000000-0000-0000-0000-0000000007ff', 'MATCHED', NULL) ->> 'gone', 'true',
  'F7: a document no longer in the month: said, nothing written');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Timing: the line read over a month of 1,000 + 1,000 rows, and a 1,000-row
-- books import beside 1,000 own entries of the month (500 of them this
-- month's, linked; 500 of a blank month, a twin added beside each).
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES ('af000000-0000-0000-0000-0000000009f1', 'F TIMING', '24FTIME0000A1Z5');
INSERT INTO public.books_register (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, book_treatment, doc_type)
SELECT 'af000000-0000-0000-0000-0000000009f1', '10/2026', date '2026-10-01' + (g % 28), 'BOOK ' || g, 'B/' || g, '24BOOKS0000A1Z5', 1000 + g, 90, 90, 'NOT_IN_2B', 'INVOICE'
  FROM generate_series(1, 1000) g;
INSERT INTO public.twob_import_docs (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, doc_type, itc_action)
SELECT 'af000000-0000-0000-0000-0000000009f1', '10/2026', date '2026-10-01' + (g % 28), 'DOC ' || g, 'D/' || g, '24DOCSS0000A1Z5', 1000 + g, 180, 'INVOICE', 'NOT_IN_BOOKS'
  FROM generate_series(1, 1000) g;
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month)
SELECT 'af000000-0000-0000-0000-0000000009f1', '11/2026', date '2026-11-01' + (g % 28), 'OWN ' || g, 'O/' || g, '24OWNSS0000A1Z5', 1000 + g, 0, 90, 90,
       CASE WHEN g % 2 = 0 THEN 'Nov 26' END
  FROM generate_series(1, 1000) g;
SELECT set_config('twob.write', '', false);
ANALYZE public.books_register;
ANALYZE public.twob_import_docs;
ANALYZE public.bills_not_in_2b;
SET ROLE anon;
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
DO $$
DECLARE
  t0 timestamptz;
  ms numeric;
  r jsonb;
  c constant uuid := 'af000000-0000-0000-0000-0000000009f1';
BEGIN
  t0 := clock_timestamp();
  r := public.twob_import2b_step(c, '10/2026');
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: the "not in step" line over 1,000 + 1,000 rows never posted: % ms', ms;
  PERFORM public.t_eq(((r -> 'bills_not_in_2b' ->> 'add')::integer, (r -> 'bills_not_in_books' ->> 'add')::integer)::text, '(1000,1000)',
    'timing: the line counts every row');
  IF ms > 1000 THEN RAISE EXCEPTION 'FAILED timing: the line took % ms', ms; END IF;
  t0 := clock_timestamp();
  INSERT INTO public.books_register (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
    taxable_value, input_cgst, input_sgst, book_treatment, doc_type, updated_by)
  SELECT c, '11/2026', date '2026-11-01' + (g % 28), 'OWN ' || g, 'O/' || g, '24OWNSS0000A1Z5', 1000 + g, 90, 90, 'NOT_IN_2B', 'INVOICE', public.t_poster()
    FROM generate_series(1, 1000) g;
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: 1,000 books rows added beside 1,000 own entries (500 linked, 500 twins added): % ms', ms;
  PERFORM public.t_eq((SELECT (count(*) FILTER (WHERE adopted_from IS NOT NULL), count(*) FILTER (WHERE reversal_month IS NULL), count(*))::text
                         FROM public.bills_not_in_2b WHERE client_id = c AND period_month = '11/2026'),
    '(500,500,1500)', 'timing: 500 linked, 500 blank-month entries with a twin beside each');
  IF ms > 1000 THEN RAISE EXCEPTION 'FAILED timing: the import took % ms', ms; END IF;
END $$;
RESET ROLE;
