-- Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md
-- §15): the first verification round's findings, one test each, as
-- PostgREST runs the app's calls (anon, with the request headers; a4 holds
-- Import 2B & post, a3 holds no permission):
--   R1 a reclaim is one call: refused by its document's write-through (a
--      booked Not in Books entry), nothing of it is kept; once the book entry
--      is undone it goes through, entry and document together;
--   R2 a books row's pairing is one call: refused (an Expense out the pairing
--      would take back), neither document nor row changes; once undone, the
--      document, the row and their entries move together; a release too;
--   R3 a save that changes the ledger needs Import 2B & post (the user the
--      request names); a save that changes nothing on it does not; a request
--      naming no user is not checked;
--   R4 a filed month's books row whose identical entry the month holds
--      unlinked: linked through the prior-month save, never left "to add";
--   R5 an amendment's effect rounds half a paisa as Math.round does;
--   R6 version snapshots are recorded as the saver's, never the flusher's,
--      and the flush reaches every month a save marked;
--   R7 a catch-up refused names where to undo.
-- Fictional.
\set C 'ad000000-0000-0000-0000-000000000001'
\set D 'ad000000-0000-0000-0000-000000000002'
\set Q 'ad000000-0000-0000-0000-000000000003'
\set T 'ad000000-0000-0000-0000-000000000004'
\set V 'ad000000-0000-0000-0000-000000000005'

SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES
  (:'C', 'R1 RECLAIM', '24RONEC0000A1Z5'),
  (:'D', 'R2 PAIRING', '24RTWOC0000A1Z5'),
  (:'Q', 'R3 PERMISSION', '24RTHRC0000A1Z5'),
  (:'V', 'R6 VERSIONS', '24RSIXC0000A1Z5');
-- R1: a carried Not in 2B entry from August, awaiting reclaim in September.
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, reversal_month, is_carried_forward)
VALUES ('ad000000-0000-0000-0000-0000000000a1', :'C', '09/2026', '2026-08-20', 'LATE SUP', 'L/77', '24LATES0000A1Z5', 1000, 180, 'Aug 26', true);
SELECT set_config('twob.write', '', false);

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);

-- ---------------------------------------------------------------------------
-- R1. A reclaim, one call.
-- ---------------------------------------------------------------------------
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, doc_type, itc_action)
VALUES ('ad000000-0000-0000-0000-0000000000d1', :'C', '09/2026', '2026-08-20', 'LATE SUP', 'L/77', '24LATES0000A1Z5', 1000, 180, 'INVOICE', 'NOT_IN_BOOKS');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE source_doc_id = 'ad000000-0000-0000-0000-0000000000d1'), 1,
  'R1: the import posts the document''s Not in Books entry');
UPDATE public.bills_not_in_books SET book_entry_month = 'Sep 26' WHERE source_doc_id = 'ad000000-0000-0000-0000-0000000000d1';
SELECT public.t_raises(format($q$SELECT public.twob_import2b_reclaim(public.t_poster(), '%s', '09/2026', 'ad000000-0000-0000-0000-0000000000a1', 'ad000000-0000-0000-0000-0000000000d1')$q$, :'C'),
  'LATE SUP L/77: Sep-26 has booked this entry; undo that book entry first. Undo it on Import 2B, then save again: a book entry under Pending items, Booked (Undo book entry).',
  'R1: the reclaim is refused by its document''s write-through, naming the book entry and where to undo it');
SELECT public.t_eq((SELECT concat_ws('|', COALESCE(reclaim_month, '-'), COALESCE(reclaimed_via_doc_id::text, '-'))
                      FROM public.bills_not_in_2b WHERE id = 'ad000000-0000-0000-0000-0000000000a1'), '-|-',
  'R1: ... the August entry is not reclaimed (nothing of the call is kept)');
SELECT public.t_eq((SELECT itc_action FROM public.twob_import_docs WHERE id = 'ad000000-0000-0000-0000-0000000000d1'), 'NOT_IN_BOOKS',
  'R1: ... the document stays Not in Books');
SELECT public.t_eq((SELECT concat_ws('|', input_igst, book_entry_month) FROM public.bills_not_in_books WHERE source_doc_id = 'ad000000-0000-0000-0000-0000000000d1'),
  '180.00|Sep 26', 'R1: ... and its booked entry is as it was (claimed once, in 5.2)');
-- Undo book entry (Pending items, Booked), then the reclaim goes through.
UPDATE public.bills_not_in_books SET book_entry_month = NULL WHERE source_doc_id = 'ad000000-0000-0000-0000-0000000000d1';
SELECT public.t_eq(public.twob_import2b_reclaim(public.t_poster(), :'C', '09/2026', 'ad000000-0000-0000-0000-0000000000a1', 'ad000000-0000-0000-0000-0000000000d1'),
  '{"ok": true, "was": "NOT_IN_BOOKS"}'::jsonb, 'R1: undone, the reclaim is recorded (and says the document was Not in Books)');
SELECT public.t_eq((SELECT concat_ws('|', reclaim_month, reclaimed_via_doc_id = 'ad000000-0000-0000-0000-0000000000d1',
                                     (SELECT itc_action FROM public.twob_import_docs WHERE id = 'ad000000-0000-0000-0000-0000000000d1'),
                                     (SELECT count(*) FROM public.bills_not_in_books WHERE source_doc_id = 'ad000000-0000-0000-0000-0000000000d1'))
                      FROM public.bills_not_in_2b WHERE id = 'ad000000-0000-0000-0000-0000000000a1'),
  'Sep 26|t|RECLAIM|0', 'R1: ... the entry reclaimed in Sep 26 by the document, the document Reclaim, its Not in Books entry taken back: claimed once, in 5.4');
SELECT public.t_eq(public.twob_import2b_reclaim(public.t_poster(), :'C', '09/2026', 'ad000000-0000-0000-0000-0000000000a1', 'ad000000-0000-0000-0000-0000000000d1') ->> 'what',
  'entry', 'R1: the same reclaim again: the entry no longer awaits one, nothing written');
SELECT public.t_eq(public.twob_import2b_reclaim(public.t_poster(), :'C', '09/2026', 'ad000000-0000-0000-0000-0000000000a1', 'ad000000-0000-0000-0000-0000000000ff') ->> 'what',
  'document', 'R1: a document no longer in the month: said, nothing written');
SELECT public.t_raises(format($q$SELECT public.twob_import2b_reclaim(NULL, '%s', '09/2026', 'ad000000-0000-0000-0000-0000000000a1', 'ad000000-0000-0000-0000-0000000000d1')$q$, :'C'),
  'Only staff record a reclaim', 'R1: no user named: refused');

-- ---------------------------------------------------------------------------
-- R2. A books row's pairing, one call.
-- ---------------------------------------------------------------------------
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, book_treatment, doc_type)
VALUES ('ad000000-0000-0000-0000-0000000000b1', :'D', '09/2026', '2026-09-05', 'PAIR SUP', 'P/5', '24PAIRS0000A1Z5', 1000, 180, 'NOT_IN_2B', 'INVOICE');
UPDATE public.bills_not_in_2b SET reclaim_month = 'Sep 26', reclaim_subtype = 'EXPENSE_OUT' WHERE source_book_id = 'ad000000-0000-0000-0000-0000000000b1';
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, doc_type, itc_action)
VALUES ('ad000000-0000-0000-0000-0000000000d2', :'D', '09/2026', '2026-09-05', 'PAIR SUP', 'P/5', '24PAIRS0000A1Z5', 1000, 180, 'INVOICE', 'MATCHED');
SELECT public.t_raises($q$SELECT public.twob_import2b_save_book(public.t_poster(), 'ad000000-0000-0000-0000-0000000000b1',
    '{"date":"2026-09-05","supplier_name":"PAIR SUP","supplier_invoice_number":"P/5","supplier_gstin":"24PAIRS0000A1Z5","taxable_value":1000,"input_igst":180,"input_cgst":0,"input_sgst":0,"doc_type":"INVOICE","book_treatment":"MISMATCHED","matched_2b_id":"ad000000-0000-0000-0000-0000000000d2"}'::jsonb,
    NULL, 'ad000000-0000-0000-0000-0000000000d2')$q$,
  'PAIR SUP P/5: Sep-26 has expensed out this entry; undo that first. Undo it on Import 2B, then save again: an Expense out under Pending items, Expensed out (Undo).',
  'R2: the pairing is refused by the books row''s write-through, naming the Expense out');
SELECT public.t_eq((SELECT concat_ws('|', itc_action, COALESCE(matched_book_id::text, 'unpaired')) FROM public.twob_import_docs WHERE id = 'ad000000-0000-0000-0000-0000000000d2'),
  'MATCHED|unpaired', 'R2: ... the document is neither paired nor Mismatched (nothing of the call is kept)');
SELECT public.t_eq((SELECT concat_ws('|', book_treatment, COALESCE(matched_2b_id::text, 'unpaired'),
                                     (SELECT reclaim_subtype FROM public.bills_not_in_2b WHERE source_book_id = 'ad000000-0000-0000-0000-0000000000b1'))
                      FROM public.books_register WHERE id = 'ad000000-0000-0000-0000-0000000000b1'),
  'NOT_IN_2B|unpaired|EXPENSE_OUT', 'R2: ... the books row and its expensed-out entry are as they were');
UPDATE public.bills_not_in_2b SET reclaim_month = NULL, reclaim_subtype = NULL WHERE source_book_id = 'ad000000-0000-0000-0000-0000000000b1';
SELECT public.t_eq(public.twob_import2b_save_book(public.t_poster(), 'ad000000-0000-0000-0000-0000000000b1',
    '{"input_igst":181,"book_treatment":"MISMATCHED","matched_2b_id":"ad000000-0000-0000-0000-0000000000d2"}'::jsonb,
    NULL, 'ad000000-0000-0000-0000-0000000000d2'), '{"ok": true, "paired_was": "MATCHED"}'::jsonb, 'R2: undone, the pairing goes through');
SELECT public.t_eq((SELECT concat_ws('|', d.itc_action, d.matched_book_id = b.id, b.book_treatment, b.matched_2b_id = d.id, b.input_igst,
                                     (SELECT count(*) FROM public.bills_not_in_2b t WHERE t.source_book_id = b.id))
                      FROM public.twob_import_docs d, public.books_register b
                     WHERE d.id = 'ad000000-0000-0000-0000-0000000000d2' AND b.id = 'ad000000-0000-0000-0000-0000000000b1'),
  'MISMATCHED|t|MISMATCHED|t|181|0', 'R2: ... the document paired and Mismatched, the row saved, its reversal taken back, together');
-- A release: the row moves off the document (Not in 2B again).
SELECT public.t_eq(public.twob_import2b_save_book(public.t_poster(), 'ad000000-0000-0000-0000-0000000000b1',
    '{"book_treatment":"NOT_IN_2B","matched_2b_id":null}'::jsonb, 'ad000000-0000-0000-0000-0000000000d2', NULL) ->> 'ok',
  'true', 'R2: a release');
SELECT public.t_eq((SELECT concat_ws('|', d.itc_action, d.matched_book_id IS NULL, b.book_treatment,
                                     (SELECT count(*) FROM public.bills_not_in_2b t WHERE t.source_book_id = b.id))
                      FROM public.twob_import_docs d, public.books_register b
                     WHERE d.id = 'ad000000-0000-0000-0000-0000000000d2' AND b.id = 'ad000000-0000-0000-0000-0000000000b1'),
  'MATCHED|t|NOT_IN_2B|1', 'R2: ... the document back to Matched and unpaired, the row Not in 2B and reversed again');
-- A Not in Books document paired: its entry taken back with it; paired_was says so (its amendments follow).
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, doc_type, itc_action)
VALUES ('ad000000-0000-0000-0000-0000000000d3', :'D', '09/2026', '2026-09-06', 'NIB SUP', 'N/6', '24NIBSU0000A1Z5', 500, 90, 'INVOICE', 'NOT_IN_BOOKS');
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, book_treatment, doc_type)
VALUES ('ad000000-0000-0000-0000-0000000000b3', :'D', '09/2026', '2026-09-06', 'NIB SUP', 'N/6', '24NIBSU0000A1Z5', 520, 94, 'NOT_IN_2B', 'INVOICE');
SELECT public.t_eq(public.twob_import2b_save_book(public.t_poster(), 'ad000000-0000-0000-0000-0000000000b3',
    '{"book_treatment":"MISMATCHED","matched_2b_id":"ad000000-0000-0000-0000-0000000000d3"}'::jsonb, NULL, 'ad000000-0000-0000-0000-0000000000d3') ->> 'paired_was',
  'NOT_IN_BOOKS', 'R2: pairing a Not in Books document says it was Not in Books');
SELECT public.t_eq((SELECT (SELECT count(*) FROM public.bills_not_in_books WHERE source_doc_id = 'ad000000-0000-0000-0000-0000000000d3')
                         || ':' || (SELECT count(*) FROM public.bills_not_in_2b WHERE source_book_id = 'ad000000-0000-0000-0000-0000000000b3')), '0:0',
  'R2: ... both entries taken back (the document is claimed in 5.1)');
-- (Round 4: the call no longer asks for the permission itself; the
-- write-through refuses the part that would change the ledger, for the
-- call's own user.)
SELECT public.t_raises($q$SELECT public.twob_import2b_save_book(public.t_employee(), 'ad000000-0000-0000-0000-0000000000b1', '{"input_igst":1}'::jsonb)$q$,
  'needs the Import 2B & post permission', 'R2: an employee without Import 2B & post is refused a save that would change the ledger');
SELECT public.t_raises($q$SELECT public.twob_import2b_save_book(public.t_poster(), 'ad000000-0000-0000-0000-0000000000b1', '{"posted_at":"2026-01-01"}'::jsonb)$q$,
  'A books row saves its date, supplier, number, GSTIN, amounts, type and treatment here (posted_at)', 'R2: only the row''s own columns');

-- ---------------------------------------------------------------------------
-- R3. Who may change the ledger.
-- ---------------------------------------------------------------------------
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a3","x-gst-source":"app"}', false);
SELECT public.t_raises(format($q$INSERT INTO public.books_register (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, book_treatment, doc_type)
    VALUES ('%s', '09/2026', '2026-09-01', 'PERM SUP', 'PS/1', '24PERMS0000A1Z5', 100, 9, 9, 'NOT_IN_2B', 'INVOICE')$q$, :'Q'),
  'Not saved: this change would change the 2B Reconciliation ledger, which needs the Import 2B & post permission.',
  'R3: an employee without Import 2B & post: a books row that would post is refused');
SELECT public.t_eq((SELECT count(*)::integer FROM public.books_register WHERE client_id = :'Q'), 0, 'R3: ... and nothing of it is kept');
INSERT INTO public.books_register (id, client_id, period_month, book_treatment, doc_type)
VALUES ('ad000000-0000-0000-0000-0000000000b4', :'Q', '09/2026', 'NOT_IN_2B', 'INVOICE');
SELECT public.t_eq((SELECT count(*)::integer FROM public.books_register WHERE client_id = :'Q'), 1, 'R3: ... a blank row (posts nothing) is saved');
SELECT public.t_raises($q$UPDATE public.books_register SET date = '2026-09-02', supplier_name = 'PERM SUP', input_cgst = 9 WHERE id = 'ad000000-0000-0000-0000-0000000000b4'$q$,
  'needs the Import 2B & post permission', 'R3: ... filling it in so it would post: refused');
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, doc_type, itc_action)
VALUES ('ad000000-0000-0000-0000-0000000000d4', :'Q', '09/2026', '2026-09-03', 'PERM DOC', 'PD/1', '24PERMD0000A1Z5', 100, 18, 'INVOICE', 'MATCHED');
SELECT set_config('twob.write', '', false);
UPDATE public.twob_import_docs SET itc_action = 'INELIGIBLE' WHERE id = 'ad000000-0000-0000-0000-0000000000d4';
SELECT public.t_eq((SELECT itc_action FROM public.twob_import_docs WHERE id = 'ad000000-0000-0000-0000-0000000000d4'), 'INELIGIBLE',
  'R3: ... a treatment that changes nothing on the ledger is saved');
SELECT public.t_raises($q$UPDATE public.twob_import_docs SET itc_action = 'NOT_IN_BOOKS' WHERE id = 'ad000000-0000-0000-0000-0000000000d4'$q$,
  'needs the Import 2B & post permission', 'R3: ... Not in Books (it would post) is refused');
-- A GST Manager, and an employee holding the permission, post.
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a2","x-gst-source":"app"}', false);
UPDATE public.twob_import_docs SET itc_action = 'NOT_IN_BOOKS' WHERE id = 'ad000000-0000-0000-0000-0000000000d4';
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE source_doc_id = 'ad000000-0000-0000-0000-0000000000d4'), 1, 'R3: a GST Manager posts');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
UPDATE public.books_register SET date = '2026-09-02', supplier_name = 'PERM SUP', input_cgst = 9 WHERE id = 'ad000000-0000-0000-0000-0000000000b4';
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE source_book_id = 'ad000000-0000-0000-0000-0000000000b4'), 1, 'R3: an employee holding Import 2B & post posts');
-- A request naming no user (the app of before this release, a system writer): not checked.
SELECT set_config('request.headers', '{}', false);
UPDATE public.books_register SET input_cgst = 10 WHERE id = 'ad000000-0000-0000-0000-0000000000b4';
SELECT public.t_eq((SELECT input_cgst FROM public.bills_not_in_2b WHERE source_book_id = 'ad000000-0000-0000-0000-0000000000b4'), 10.00::numeric,
  'R3: a request naming no user writes through');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);

-- ---------------------------------------------------------------------------
-- R4. A filed month's identical unlinked entry: linked, not left to add
-- (SORATH BUILDERS 07/2026).
-- ---------------------------------------------------------------------------
RESET ROLE;
SELECT public.t_make_tamnna(:'T', 'R4 TWIN');
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, book_treatment, doc_type)
VALUES ('ad000000-0000-0000-0000-0000000000b5', :'T', '07/2026', '2026-07-20', 'TWIN CO', 'TW/1', '24TWINC0000A1Z5', 300, 27, 27, 'NOT_IN_2B', 'INVOICE');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward, is_locked)
VALUES ('ad000000-0000-0000-0000-0000000000e5', :'T', '07/2026', '2026-07-20', 'TWIN CO', 'TW/1', '24TWINC0000A1Z5', 300, 27, 27, 'Jul 26', false, true);
SELECT set_config('twob.write', '', false);
SELECT public.t_eq((SELECT string_agg(op, ',') FROM public.twob__autopost_plan(:'T', '07/2026', NULL, NULL) WHERE op <> 'skip'), 'insert',
  'R4: the plan reads the twin''s books row as an entry to add');
SET ROLE anon;
SELECT public.twob_import2b_prior_save(public.t_manager(), :'T', '07/2026', '[]'::jsonb, true, true) AS r4p \gset
SELECT public.t_eq((SELECT string_agg(concat_ws(':', c ->> 'table', c -> 'this' ->> 'action', c ->> 'id'), ' ') FROM jsonb_array_elements(:'r4p'::jsonb -> 'changes') c),
  'bills_not_in_2b:link:ad000000-0000-0000-0000-0000000000e5', 'R4: the filed month''s catch-up previews linking the entry the month holds, not adding it');
SELECT public.t_eq((SELECT count(*)::integer FROM jsonb_array_elements(:'r4p'::jsonb -> 'notes')), 0, 'R4: ... no "already held" note');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE source_book_id = 'ad000000-0000-0000-0000-0000000000b5'), 0, 'R4: the preview links nothing');
SELECT public.twob_import2b_prior_save(public.t_manager(), :'T', '07/2026', '[]'::jsonb, false, true);
SELECT public.t_eq((SELECT concat_ws('|', count(*), min(source_book_id::text), bool_and(is_locked)) FROM public.bills_not_in_2b
                     WHERE client_id = :'T' AND period_month = '07/2026' AND supplier_invoice_number = 'TW/1'),
  '1|ad000000-0000-0000-0000-0000000000b5|t', 'R4: applied: the one entry linked to its books row, still filed (locked), no twin added');
SELECT public.t_eq((SELECT count(*)::integer FROM jsonb_array_elements(public.twob_import2b_prior_save(public.t_manager(), :'T', '07/2026',
                      '[{"table":"books_register","op":"update","id":"ad000000-0000-0000-0000-0000000000b5","values":{"input_cgst":27,"input_sgst":27}}]'::jsonb, true) -> 'changes') c
                     WHERE c -> 'this' ->> 'action' <> 'none'), 0,
  'R4: a save of the row that changes nothing now has nothing to do (no "already held" toast on every blur)');
RESET ROLE;
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob__autopost_plan(:'T', '07/2026', NULL, NULL) WHERE op <> 'skip'), 0,
  'R4: ... and the month is in step: nothing left to add');
SET ROLE anon;

-- ---------------------------------------------------------------------------
-- R5. Half a paisa, rounded as Math.round rounds it.
-- ---------------------------------------------------------------------------
RESET ROLE;
-- (Post's r2 rounds the float of the difference: Math.round(-0.5) is 0,
-- 0.015 - 0.01 is 0.004999999999999999 and rounds to 0, 100.005 - 100 is
-- just under 0.005 too, and 1.004 - 0.009 is 0.995 and rounds to 1.)
SELECT public.t_eq((SELECT concat_ws('|', input_cgst, taxable_value) FROM public.twob__doc_effect('DEBIT_NOTE', true, 'DEBIT_NOTE',
                      0.015, 0, 0.005, 0, 0.01, 0, 0.01, 0, NULL, NULL, NULL, NULL, NULL)),
  '0.00|0.00', 'R5: -0.005 rounds to 0.00 (half up, as Math.round), and 0.015 - 0.01 to 0.00, as Post rounds them');
SELECT public.t_eq((SELECT concat_ws('|', input_cgst, input_igst) FROM public.twob__doc_effect('INVOICE', true, NULL, 0, 100.005, 1.004, 0, 0, 100, 0.009, 0, NULL, NULL, NULL, NULL, NULL)),
  '1.00|0.00', 'R5: 0.995 rounds to 1.00; 100.005 - 100 to 0.00');
SELECT public.t_eq(public.twob__js_r2(2.5::float8 / 100) || '|' || public.twob__js_r2(-2.5::float8 / 100) || '|' || public.twob__js_r2(0.0049999999999999992::float8),
  '0.03|-0.02|0.00', 'R5: halves round up, toward +infinity, as Math.round');
SET ROLE anon;

-- ---------------------------------------------------------------------------
-- R6. Versions recorded as the saver's.
-- ---------------------------------------------------------------------------
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, book_treatment, doc_type, updated_by)
VALUES ('ad000000-0000-0000-0000-0000000000b6', :'V', '10/2026', '2026-10-02', 'VER SUP', 'V/1', '24VERSU0000A1Z5', 100, 9, 9, 'NOT_IN_2B', 'INVOICE', '00000000-0000-0000-0000-0000000000a4'),
       ('ad000000-0000-0000-0000-0000000000b7', :'V', '11/2026', '2026-11-02', 'VER SUP', 'V/2', '24VERSU0000A1Z5', 100, 9, 9, 'NOT_IN_2B', 'INVOICE', '00000000-0000-0000-0000-0000000000a4');
SELECT public.t_eq((SELECT string_agg(period_month || ':' || updated_by, ',' ORDER BY period_month) FROM public.twob_versions WHERE client_id = :'V'),
  '10/2026:00000000-0000-0000-0000-0000000000a4,11/2026:00000000-0000-0000-0000-0000000000a4', 'R6: each month''s first write-through takes a version, as the saver''s');
UPDATE public.books_register SET input_cgst = 10, input_sgst = 10 WHERE client_id = :'V';
SELECT public.t_eq((SELECT string_agg(period_month || ':' || (changed_at > snapped_at) || ':' || changed_by, ',' ORDER BY period_month) FROM public.twob_autopost_state WHERE client_id = :'V'),
  '10/2026:true:00000000-0000-0000-0000-0000000000a4,11/2026:true:00000000-0000-0000-0000-0000000000a4', 'R6: a save within the minute marks both months behind, with whose save it was');
-- The GST Manager's page asks for the flush (as a page after its own save
-- does): both months are brought up to date, as a4's.
SELECT public.twob_import2b_flush_version(public.t_manager(), :'V', '10/2026');
SELECT public.t_eq((SELECT string_agg(v.period_month || ':' || v.updated_by || ':' || (e ->> 'inputCgst'), ',' ORDER BY v.period_month)
                      FROM public.twob_versions v, jsonb_array_elements(v.version_data -> 'billsNotIn2B') e WHERE v.client_id = :'V' AND v.is_current),
  '10/2026:00000000-0000-0000-0000-0000000000a4:10.00,11/2026:00000000-0000-0000-0000-0000000000a4:10.00',
  'R6: the flush brings both months up to date, recorded as the saver''s, never the flusher''s');
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_autopost_state WHERE client_id = :'V' AND changed_at > snapped_at), 0, 'R6: ... nothing left behind');

-- ---------------------------------------------------------------------------
-- R7. A catch-up refused says where to undo.
-- ---------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('twob.write', 'system', false);
UPDATE public.books_register SET book_treatment = 'NOT_ELIGIBLE' WHERE id = 'ad000000-0000-0000-0000-0000000000b4';
UPDATE public.bills_not_in_2b SET reclaim_month = 'Sep 26', reclaim_subtype = 'EXPENSE_OUT' WHERE source_book_id = 'ad000000-0000-0000-0000-0000000000b4';
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.t_eq(public.twob_import2b_catch_up(public.t_poster(), :'Q', '09/2026', true) ->> 'undo_hint',
  'Undo it on Import 2B, then save again: an Expense out under Pending items, Expensed out (Undo).', 'R7: the catch-up''s preview names where to undo');
RESET ROLE;
