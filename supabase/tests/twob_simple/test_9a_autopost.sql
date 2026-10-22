-- Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md §15),
-- as PostgREST runs it: the anon role, with the request headers the app sends
-- (x-gst-actor names the user; the change log and the ledger's updated_by
-- read it). Every save kind writes through to the ledger in the same
-- statement, by Post's rules:
--   A  books register: add, edit, type, treatment, delete; a debit note and a
--      minus row never post; no date or supplier: not posted, kept;
--   B  2B documents: an import (every kind of document), a bulk treatment
--      change, a pairing, the figures of a re-import, counted figures, a
--      delete; HELD and zero-change amendments never post; a credit note
--      posts negative;
--   C  an entry holding a reclaim, Expense out or book entry is never taken
--      back: the save is refused and names it; updates never touch a
--      decision;
--   D  an identical own entry the month holds unlinked is linked, not
--      doubled;
--   E  Delete 2B and Clear Data, one call each;
--   F  a month out of step (posted before this change) is brought up to date
--      by staff who may post, previewed;
--   G  version snapshots, coalesced per minute;
--   H  a prior month: refused directly; a GST Manager's save goes through the
--      door with its write-through and preview; an employee is refused;
--   I  one ledger row per source.
-- Fictional.
\set C 'a9000000-0000-0000-0000-000000000001'
\set P 'a9000000-0000-0000-0000-000000000002'
\set E 'a9000000-0000-0000-0000-000000000003'
\set F 'a9000000-0000-0000-0000-000000000004'

SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES
  (:'C', 'AP OPEN', '24APOPN0000A1Z5'),
  (:'E', 'AP DELETE', '24APDEL0000A1Z5'),
  (:'F', 'AP CATCH UP', '24APCAT0000A1Z5');
SELECT set_config('twob.write', '', false);

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);

CREATE TEMP VIEW l2 AS SELECT * FROM public.bills_not_in_2b;
CREATE TEMP VIEW lb AS SELECT * FROM public.bills_not_in_books;

-- ---------------------------------------------------------------------------
-- A. The books register
-- ---------------------------------------------------------------------------
-- A1: a blank row (as Add row makes it) posts nothing.
INSERT INTO public.books_register (id, client_id, period_month, book_treatment, doc_type)
VALUES ('a9000000-0000-0000-0000-0000000000b1', :'C', '07/2026', 'NOT_IN_2B', 'INVOICE');
SELECT public.t_eq((SELECT count(*)::integer FROM l2 WHERE client_id = :'C'), 0, 'A1: a blank books row posts nothing (no date)');
-- A2: filled in, cell by cell (one save each), it posts on the save that completes it.
UPDATE public.books_register SET supplier_name = '  KAVERI TRADERS ', supplier_gstin = '24KAVER0000A1Z5', supplier_invoice_number = 'K/101',
       taxable_value = 1000, input_cgst = 90, input_sgst = 90 WHERE id = 'a9000000-0000-0000-0000-0000000000b1';
SELECT public.t_eq((SELECT count(*)::integer FROM l2 WHERE client_id = :'C'), 0, 'A2: no date yet: still nothing');
UPDATE public.books_register SET date = '2026-07-15' WHERE id = 'a9000000-0000-0000-0000-0000000000b1';
SELECT public.t_eq((SELECT concat_ws('|', supplier_name, supplier_invoice_number, date, taxable_value, input_cgst, input_sgst, reversal_month,
                                     reclaim_month IS NULL, is_carried_forward, updated_by)
                      FROM l2 WHERE source_book_id = 'a9000000-0000-0000-0000-0000000000b1'),
  'KAVERI TRADERS|K/101|2026-07-15|1000.00|90.00|90.00|Jul 26|t|f|00000000-0000-0000-0000-0000000000a4',
  'A2: the save that gives it a date posts it: trimmed name, this month as reversal month, the user named by the request');
-- A3: an amount change updates the entry, never its decision; a decision on
-- it stays through the update (Post's rule).
SELECT set_config('twob.write', '', false);
UPDATE public.bills_not_in_2b SET reclaim_month = 'Jul 26', reclaim_subtype = 'EXPENSE_OUT' WHERE source_book_id = 'a9000000-0000-0000-0000-0000000000b1';
UPDATE public.books_register SET input_cgst = 99, input_sgst = 99, taxable_value = 1100 WHERE id = 'a9000000-0000-0000-0000-0000000000b1';
SELECT public.t_eq((SELECT concat_ws('|', taxable_value, input_cgst, reversal_month, reclaim_month, reclaim_subtype)
                      FROM l2 WHERE source_book_id = 'a9000000-0000-0000-0000-0000000000b1'),
  '1100.00|99.00|Jul 26|Jul 26|EXPENSE_OUT', 'A3: the amounts follow; the reversal month and the Expense out stay');
-- C1: taking back an entry that holds a decision is refused, naming it; the
-- books row keeps its treatment (the statement is undone).
SELECT public.t_raises($$UPDATE public.books_register SET book_treatment = 'MISMATCHED' WHERE id = 'a9000000-0000-0000-0000-0000000000b1'$$,
  'Not saved: this change would take an entry off the 2B Reconciliation ledger that holds a reclaim, Expense out or book entry. KAVERI TRADERS K/101: Jul-26 has expensed out this entry; undo that first.',
  'C1: Mismatched would take back an expensed-out entry: refused, named');
SELECT public.t_eq((SELECT book_treatment FROM public.books_register WHERE id = 'a9000000-0000-0000-0000-0000000000b1'), 'NOT_IN_2B',
  'C1: ... and the books row is still Not in 2B');
UPDATE public.bills_not_in_2b SET reclaim_month = NULL, reclaim_subtype = NULL WHERE source_book_id = 'a9000000-0000-0000-0000-0000000000b1';
-- A4: treatment away and back.
UPDATE public.books_register SET book_treatment = 'MISMATCHED' WHERE id = 'a9000000-0000-0000-0000-0000000000b1';
SELECT public.t_eq((SELECT count(*)::integer FROM l2 WHERE client_id = :'C'), 0, 'A4: Mismatched takes its entry back');
UPDATE public.books_register SET book_treatment = 'NOT_IN_2B' WHERE id = 'a9000000-0000-0000-0000-0000000000b1';
SELECT public.t_eq((SELECT count(*)::integer FROM l2 WHERE source_book_id = 'a9000000-0000-0000-0000-0000000000b1'), 1, 'A4: Not in 2B again posts it again');
-- A5: Type: a debit note (purchase return) never posts; Invoice again posts.
UPDATE public.books_register SET doc_type = 'DEBIT_NOTE' WHERE id = 'a9000000-0000-0000-0000-0000000000b1';
SELECT public.t_eq((SELECT count(*)::integer FROM l2 WHERE client_id = :'C'), 0, 'A5: a books debit note takes its entry back');
UPDATE public.books_register SET doc_type = 'INVOICE' WHERE id = 'a9000000-0000-0000-0000-0000000000b1';
SELECT public.t_eq((SELECT count(*)::integer FROM l2 WHERE source_book_id = 'a9000000-0000-0000-0000-0000000000b1'), 1, 'A5: Invoice again posts it');
-- A6: a minus amount never posts (the page refuses it; written anyway, the entry goes back).
UPDATE public.books_register SET input_cgst = -99 WHERE id = 'a9000000-0000-0000-0000-0000000000b1';
SELECT public.t_eq((SELECT count(*)::integer FROM l2 WHERE client_id = :'C'), 0, 'A6: a minus amount takes its entry back');
UPDATE public.books_register SET input_cgst = 99 WHERE id = 'a9000000-0000-0000-0000-0000000000b1';
-- A7: a cleared date: not posted, and what it posted stays as it was (Post's rule).
UPDATE public.books_register SET date = NULL, input_cgst = 50 WHERE id = 'a9000000-0000-0000-0000-0000000000b1';
SELECT public.t_eq((SELECT concat_ws('|', date, input_cgst) FROM l2 WHERE source_book_id = 'a9000000-0000-0000-0000-0000000000b1'),
  '2026-07-15|99.00', 'A7: no date: the entry stays as posted');
UPDATE public.books_register SET supplier_name = ' ', date = '2026-07-16' WHERE id = 'a9000000-0000-0000-0000-0000000000b1';
SELECT public.t_eq((SELECT concat_ws('|', date, input_cgst) FROM l2 WHERE source_book_id = 'a9000000-0000-0000-0000-0000000000b1'),
  '2026-07-15|99.00', 'A7: no supplier: the same');
UPDATE public.books_register SET supplier_name = 'KAVERI TRADERS' WHERE id = 'a9000000-0000-0000-0000-0000000000b1';
SELECT public.t_eq((SELECT concat_ws('|', date, input_cgst) FROM l2 WHERE source_book_id = 'a9000000-0000-0000-0000-0000000000b1'),
  '2026-07-16|50.00', 'A7: complete again: the entry follows');
-- A8: a books row deleted takes back its entry; one whose entry is reclaimed
-- or locked leaves it on the ledger, unlinked (as Import 2B's delete did).
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, book_treatment, doc_type)
VALUES ('a9000000-0000-0000-0000-0000000000b2', :'C', '07/2026', '2026-07-02', 'RECLAIMED CO', 'R-2', '24RECLA0000A1Z5', 500, 90, 'NOT_IN_2B', 'INVOICE'),
       ('a9000000-0000-0000-0000-0000000000b3', :'C', '07/2026', '2026-07-03', 'GONE CO', 'G-3', '24GONEC0000A1Z5', 400, 72, 'NOT_IN_2B', 'INVOICE');
SELECT public.t_eq((SELECT count(*)::integer FROM l2 WHERE client_id = :'C'), 3, 'A8: two books rows added in one statement post two entries');
UPDATE public.bills_not_in_2b SET reclaim_month = 'Jul 26' WHERE source_book_id = 'a9000000-0000-0000-0000-0000000000b2';
DELETE FROM public.books_register WHERE id IN ('a9000000-0000-0000-0000-0000000000b2', 'a9000000-0000-0000-0000-0000000000b3');
SELECT public.t_eq((SELECT count(*)::integer FROM l2 WHERE client_id = :'C' AND supplier_name = 'GONE CO'), 0, 'A8: the deleted row''s entry goes');
SELECT public.t_eq((SELECT concat_ws('|', count(*), bool_and(source_book_id IS NULL)) FROM l2 WHERE client_id = :'C' AND supplier_name = 'RECLAIMED CO'), '1|t',
  'A8: the reclaimed entry stays, unlinked');

-- ---------------------------------------------------------------------------
-- B. 2B documents
-- ---------------------------------------------------------------------------
-- B1: an import of every kind of document in one statement.
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, cess, doc_type, is_amendment, original_doc_type,
  base_taxable_value, base_input_igst, base_input_cgst, base_input_sgst, base_cess,
  ims_reduce_required, declared_igst, reverse_charge, itc_action) VALUES
  ('a9000000-0000-0000-0000-0000000000d1', :'C', '07/2026', '2026-07-10', 'SUPPLIER', 'INV/1', '24AAAAA0000A1Z5', 1000, 180, 0, 0, 0, 'INVOICE', false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, 'NOT_IN_BOOKS'),
  ('a9000000-0000-0000-0000-0000000000d2', :'C', '07/2026', '2026-07-10', 'SUPPLIER', 'DN/1', '24AAAAA0000A1Z5', 500, 0, 45, 45, 0, 'DEBIT_NOTE', false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, 'NOT_IN_BOOKS'),
  ('a9000000-0000-0000-0000-0000000000d3', :'C', '07/2026', '2026-07-10', 'SUPPLIER', 'CN/1', '24AAAAA0000A1Z5', 200, 36, 0, 0, 0, 'CREDIT_NOTE', false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, 'NOT_IN_BOOKS'),
  ('a9000000-0000-0000-0000-0000000000d4', :'C', '07/2026', '2026-07-10', 'SUPPLIER', 'CN/2', '24AAAAA0000A1Z5', 200, 36, 0, 0, 0, 'CREDIT_NOTE', false, NULL, NULL, NULL, NULL, NULL, NULL, 'YES', 10, false, 'NOT_IN_BOOKS'),
  ('a9000000-0000-0000-0000-0000000000d5', :'C', '07/2026', '2026-07-10', 'SUPPLIER', 'CN/0A', '24AAAAA0000A1Z5', 150, 27, 0, 0, 0, 'CREDIT_NOTE', true, 'CREDIT_NOTE', 100, 18, 0, 0, 0, NULL, NULL, false, 'NOT_IN_BOOKS'),
  ('a9000000-0000-0000-0000-0000000000d6', :'C', '07/2026', '2026-07-10', 'SUPPLIER', 'DN/9A', '24AAAAA0000A1Z5', 100, 18, 0, 0, 0, 'DEBIT_NOTE', true, 'CREDIT_NOTE', 100, 18, 0, 0, 0, NULL, NULL, false, 'NOT_IN_BOOKS'),
  ('a9000000-0000-0000-0000-0000000000d7', :'C', '07/2026', '2026-07-10', 'SUPPLIER', 'INV/7A', '24AAAAA0000A1Z5', 700, 126, 0, 0, 0, 'INVOICE', true, NULL, 700, 126, 0, 0, 0, NULL, NULL, false, 'NOT_IN_BOOKS'),
  ('a9000000-0000-0000-0000-0000000000d8', :'C', '07/2026', '2026-07-10', 'SUPPLIER', 'INV/8A', '24AAAAA0000A1Z5', 800, 144, 0, 0, 0, 'INVOICE', true, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, 'HELD'),
  ('a9000000-0000-0000-0000-0000000000d9', :'C', '07/2026', '2026-07-10', 'SUPPLIER', 'INV/9', '24AAAAA0000A1Z5', 900, 162, 0, 0, 0, 'INVOICE', false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, 'MATCHED'),
  ('a9000000-0000-0000-0000-0000000000da', :'C', '07/2026', '2026-07-10', 'RCM SUPPLIER', 'R/1', '24RCMSU0000A1Z5', 300, 54, 0, 0, 0, 'INVOICE', false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 'NOT_IN_BOOKS'),
  ('a9000000-0000-0000-0000-0000000000db', :'C', '07/2026', NULL, 'SUPPLIER', 'NODATE/1', '24AAAAA0000A1Z5', 100, 18, 0, 0, 0, 'INVOICE', false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, 'NOT_IN_BOOKS'),
  ('a9000000-0000-0000-0000-0000000000dc', :'C', '07/2026', '2026-07-10', '  ', 'NONAME/1', '24AAAAA0000A1Z5', 100, 18, 0, 0, 0, 'INVOICE', false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, 'NOT_IN_BOOKS');
SELECT public.t_eq((SELECT string_agg(concat_ws(':', d.supplier_invoice_number, l.taxable_value, l.input_igst, l.input_cgst, l.input_sgst, l.bill_in_2b_month), ' ' ORDER BY d.supplier_invoice_number)
                      FROM lb l JOIN public.twob_import_docs d ON d.id = l.source_doc_id WHERE l.client_id = :'C'),
  'CN/0A:-50.00:-9.00:0.00:0.00:Jul 26 CN/1:-200.00:-36.00:0.00:0.00:Jul 26 CN/2:-200.00:-10.00:0.00:0.00:Jul 26 DN/1:500.00:0.00:45.00:45.00:Jul 26 DN/9A:200.00:36.00:0.00:0.00:Jul 26 INV/1:1000.00:180.00:0.00:0.00:Jul 26 R/1:300.00:54.00:0.00:0.00:Jul 26',
  'B1: an import posts each Not in Books document at its signed effect (credit notes minus, IMS declared tax, amendments their difference, a flip adds the base, reverse charge too); a zero-change amendment, a HELD one, a Matched one and one without a date or supplier do not');
-- B2: a bulk treatment change (Save, staged rows) takes entries back and posts them again.
UPDATE public.twob_import_docs SET itc_action = 'MATCHED' WHERE id IN ('a9000000-0000-0000-0000-0000000000d1', 'a9000000-0000-0000-0000-0000000000d2', 'a9000000-0000-0000-0000-0000000000d3');
SELECT public.t_eq((SELECT count(*)::integer FROM lb WHERE client_id = :'C'), 4, 'B2: three documents Matched: their entries go back');
UPDATE public.twob_import_docs SET itc_action = 'NOT_IN_BOOKS' WHERE id IN ('a9000000-0000-0000-0000-0000000000d1', 'a9000000-0000-0000-0000-0000000000d3', 'a9000000-0000-0000-0000-0000000000d9');
SELECT public.t_eq((SELECT count(*)::integer FROM lb WHERE client_id = :'C'), 7, 'B2: three Not in Books again: posted');
-- B3: a pairing (a books entry Mismatched with the document) takes the document's entry back.
UPDATE public.twob_import_docs SET itc_action = 'MISMATCHED', matched_book_id = 'a9000000-0000-0000-0000-0000000000b1' WHERE id = 'a9000000-0000-0000-0000-0000000000d9';
SELECT public.t_eq((SELECT count(*)::integer FROM lb WHERE source_doc_id = 'a9000000-0000-0000-0000-0000000000d9'), 0, 'B3: paired, Mismatched: its entry goes back');
-- B4: a re-import's figures.
UPDATE public.twob_import_docs SET taxable_value = 1100, input_igst = 198 WHERE id = 'a9000000-0000-0000-0000-0000000000d1';
SELECT public.t_eq((SELECT concat_ws('|', taxable_value, input_igst) FROM lb WHERE source_doc_id = 'a9000000-0000-0000-0000-0000000000d1'), '1100.00|198.00',
  'B4: new figures from a re-import: the entry follows');
UPDATE public.twob_import_docs SET taxable_value = 1100, input_igst = 198, posted_at = now() WHERE id = 'a9000000-0000-0000-0000-0000000000d1';
-- B5: counted figures entered (or found) for an amendment: its difference follows; a zero difference takes it back.
UPDATE public.twob_import_docs SET base_input_igst = 20, base_taxable_value = 110 WHERE id = 'a9000000-0000-0000-0000-0000000000d5';
SELECT public.t_eq((SELECT concat_ws('|', taxable_value, input_igst) FROM lb WHERE source_doc_id = 'a9000000-0000-0000-0000-0000000000d5'), '-40.00|-7.00',
  'B5: a new base: the amendment''s entry holds the new difference');
UPDATE public.twob_import_docs SET base_input_igst = 27, base_taxable_value = 150 WHERE id = 'a9000000-0000-0000-0000-0000000000d5';
SELECT public.t_eq((SELECT count(*)::integer FROM lb WHERE source_doc_id = 'a9000000-0000-0000-0000-0000000000d5'), 0,
  'B5: a base equal to the revised figures: nothing to post, the entry goes back');
-- B6: HELD settled into Not in Books posts it (its full value: no base).
UPDATE public.twob_import_docs SET itc_action = 'NOT_IN_BOOKS' WHERE id = 'a9000000-0000-0000-0000-0000000000d8';
SELECT public.t_eq((SELECT input_igst FROM lb WHERE source_doc_id = 'a9000000-0000-0000-0000-0000000000d8'), 144.00::numeric, 'B6: a held amendment settled Not in Books posts');
-- C2: a book entry recorded on a Not in Books entry: the document cannot leave Not in Books until it is undone.
UPDATE public.bills_not_in_books SET book_entry_month = 'Jul 26' WHERE source_doc_id = 'a9000000-0000-0000-0000-0000000000d8';
SELECT public.t_raises($$UPDATE public.twob_import_docs SET itc_action = 'MATCHED' WHERE id = 'a9000000-0000-0000-0000-0000000000d8'$$,
  'SUPPLIER INV/8A: Jul-26 has booked this entry; undo that book entry first.', 'C2: a booked entry is not taken back: refused, named');
SELECT public.t_eq((SELECT itc_action FROM public.twob_import_docs WHERE id = 'a9000000-0000-0000-0000-0000000000d8'), 'NOT_IN_BOOKS', 'C2: ... the document keeps its treatment');
-- C3: ... and the figures of a booked entry still follow (an update never touches the book entry).
UPDATE public.twob_import_docs SET input_igst = 150 WHERE id = 'a9000000-0000-0000-0000-0000000000d8';
SELECT public.t_eq((SELECT concat_ws('|', input_igst, book_entry_month) FROM lb WHERE source_doc_id = 'a9000000-0000-0000-0000-0000000000d8'), '150.00|Jul 26',
  'C3: a booked entry''s figures follow; its book entry stays');
UPDATE public.bills_not_in_books SET book_entry_month = NULL WHERE source_doc_id = 'a9000000-0000-0000-0000-0000000000d8';
-- B7: a Not in Books document deleted takes its entry back.
DELETE FROM public.twob_import_docs WHERE id = 'a9000000-0000-0000-0000-0000000000d8';
SELECT public.t_eq((SELECT count(*)::integer FROM lb WHERE client_id = :'C' AND supplier_invoice_number = 'INV/8A'), 0, 'B7: a deleted document''s entry goes');

-- ---------------------------------------------------------------------------
-- D. An identical own entry, unlinked (a Restore, a row typed on 2B
-- Reconciliation): linked, not doubled.
-- ---------------------------------------------------------------------------
INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, bill_in_2b_month, book_entry_month, is_carried_forward)
VALUES (:'C', '07/2026', '2026-07-10', 'Supplier', 'INV-2', '24AAAAA0000A1Z5', 2000, 360, 0, 0, 'Jul 26', NULL, false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, doc_type, itc_action)
VALUES ('a9000000-0000-0000-0000-0000000000e1', :'C', '07/2026', '2026-07-10', 'SUPPLIER', 'INV/2', '24AAAAA0000A1Z5', 2000, 360, 'INVOICE', 'NOT_IN_BOOKS');
SELECT public.t_eq((SELECT concat_ws('|', count(*), count(source_doc_id), min(supplier_name), min(supplier_invoice_number))
                      FROM lb WHERE client_id = :'C' AND input_igst = 360),
  '1|1|SUPPLIER|INV/2', 'D: the unlinked entry of the same invoice is linked (and takes the document''s name and number), not doubled');

-- ---------------------------------------------------------------------------
-- I. One ledger row per source.
-- ---------------------------------------------------------------------------
SELECT public.t_raises(format($q$INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, source_book_id) VALUES ('%s', '07/2026', '2026-07-01', 'X', 'a9000000-0000-0000-0000-0000000000b1')$q$, :'C'),
  'bills_not_in_2b_source_book_uq', 'I: a second entry for one books row is refused');
SELECT public.t_raises(format($q$INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, source_doc_id) VALUES ('%s', '07/2026', '2026-07-01', 'X', 'a9000000-0000-0000-0000-0000000000d1')$q$, :'C'),
  'bills_not_in_books_source_doc_uq', 'I: a second entry for one 2B document is refused');

-- ---------------------------------------------------------------------------
-- G. Version snapshots: one per minute, the latest state in it.
-- ---------------------------------------------------------------------------
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_versions WHERE client_id = :'C' AND period_month = '07/2026' AND table_type = 'import2b'), 1,
  'G: every write-through of the last minute went into one version');
SELECT public.t_eq((SELECT is_current FROM public.twob_versions WHERE client_id = :'C' AND period_month = '07/2026'), true, 'G: ... the current one');
SELECT (public.twob_import2b_flush_version(public.t_employee(), :'C', '07/2026') ->> 'version')::integer AS v1 \gset
SELECT public.t_eq((SELECT jsonb_array_length(version_data -> 'billsNotInBooks') FROM public.twob_versions WHERE client_id = :'C' AND period_month = '07/2026' AND version_number = :v1),
  (SELECT count(*)::integer FROM lb WHERE client_id = :'C' AND period_month = '07/2026'), 'G: after the page''s flush the version holds the ledger as it stands');
SELECT public.t_eq((SELECT version_data -> 'billsNotIn2B' -> 0 ->> 'reversalMonth' FROM public.twob_versions WHERE client_id = :'C' AND version_number = :v1), 'Jul 26',
  'G: in the shape Post wrote (camelCase)');
RESET ROLE;
-- A minute later (moved back by hand): the next change adds the next version.
UPDATE public.twob_versions SET version_data = jsonb_set(version_data, '{autopostSince}', to_jsonb(now() - interval '2 minutes'))
 WHERE client_id = :'C' AND period_month = '07/2026';
UPDATE public.twob_autopost_state SET snapped_at = now() - interval '2 minutes' WHERE client_id = :'C' AND period_month = '07/2026';
SET ROLE anon;
UPDATE public.twob_import_docs SET input_igst = 199 WHERE id = 'a9000000-0000-0000-0000-0000000000d1';
SELECT public.t_eq((SELECT string_agg(version_number || ':' || is_current, ',' ORDER BY version_number) FROM public.twob_versions WHERE client_id = :'C' AND period_month = '07/2026'),
  '1:false,2:true', 'G: more than a minute after the last version, a change adds version 2');
UPDATE public.twob_import_docs SET input_igst = 200 WHERE id = 'a9000000-0000-0000-0000-0000000000d1';
SELECT public.twob_import2b_flush_version(public.t_employee(), :'C', '07/2026');
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_versions WHERE client_id = :'C' AND period_month = '07/2026'), 2, 'G: a change within its minute adds none');
SELECT public.t_eq((SELECT (e ->> 'inputIgst')::numeric FROM public.twob_versions v, jsonb_array_elements(v.version_data -> 'billsNotInBooks') e
                     WHERE v.client_id = :'C' AND v.version_number = 2 AND e ->> 'supplierInvoiceNumber' = 'INV/1'), 200::numeric,
  'G: ... and version 2 holds it once the page flushes');
-- Several saves in one transaction, the first of them snapshotting: the
-- month is marked behind once after the snapshot, and the flush brings the
-- version up to the last of them.
RESET ROLE;
UPDATE public.twob_versions SET version_data = jsonb_set(version_data, '{autopostSince}', to_jsonb(now() - interval '2 minutes'))
 WHERE client_id = :'C' AND period_month = '07/2026';
UPDATE public.twob_autopost_state SET snapped_at = now() - interval '2 minutes' WHERE client_id = :'C' AND period_month = '07/2026';
SET ROLE anon;
BEGIN;
UPDATE public.twob_import_docs SET input_igst = 201 WHERE id = 'a9000000-0000-0000-0000-0000000000d1';
UPDATE public.twob_import_docs SET input_igst = 202 WHERE id = 'a9000000-0000-0000-0000-0000000000d1';
UPDATE public.twob_import_docs SET input_igst = 203 WHERE id = 'a9000000-0000-0000-0000-0000000000d1';
COMMIT;
SELECT public.t_eq((SELECT changed_at > snapped_at FROM public.twob_autopost_state WHERE client_id = :'C' AND period_month = '07/2026'), true,
  'G: saves after the snapshot in the same transaction leave the version marked behind');
SELECT public.twob_import2b_flush_version(public.t_employee(), :'C', '07/2026');
SELECT public.t_eq((SELECT string_agg(v.version_number || ':' || (e ->> 'inputIgst'), ',') FROM public.twob_versions v, jsonb_array_elements(v.version_data -> 'billsNotInBooks') e
                     WHERE v.client_id = :'C' AND v.period_month = '07/2026' AND v.is_current AND e ->> 'supplierInvoiceNumber' = 'INV/1'), '3:203.00',
  'G: ... and the flush brings version 3 up to the last of them');

-- ---------------------------------------------------------------------------
-- E. Delete 2B and Clear Data
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, doc_type, itc_action) VALUES
  ('a9000000-0000-0000-0000-0000000000f1', :'E', '08/2026', '2026-08-01', 'E SUP', 'E/1', '24ESUPP0000A1Z5', 100, 18, 'INVOICE', 'NOT_IN_BOOKS'),
  ('a9000000-0000-0000-0000-0000000000f2', :'E', '08/2026', '2026-08-02', 'E SUP', 'E/2', '24ESUPP0000A1Z5', 200, 36, 'INVOICE', 'NOT_IN_BOOKS'),
  ('a9000000-0000-0000-0000-0000000000f3', :'E', '08/2026', '2026-08-03', 'E SUP', 'E/3', '24ESUPP0000A1Z5', 300, 54, 'INVOICE', 'RECLAIM');
INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, bill_in_2b_month, is_locked, source_doc_id) VALUES
  (:'E', '08/2026', '2026-08-01', 'E SUP', 'E/1', '24ESUPP0000A1Z5', 100, 18, 'Aug 26', false, 'a9000000-0000-0000-0000-0000000000f1'),
  (:'E', '08/2026', '2026-08-02', 'E SUP', 'E/2', '24ESUPP0000A1Z5', 200, 36, 'Aug 26', true, 'a9000000-0000-0000-0000-0000000000f2');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, input_igst, reversal_month, reclaim_month, reclaimed_via_doc_id)
VALUES (:'E', '08/2026', '2026-07-30', 'E OLD', 'O/1', 54, 'Jul 26', 'Aug 26', 'a9000000-0000-0000-0000-0000000000f3');
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, book_treatment, doc_type)
VALUES ('a9000000-0000-0000-0000-0000000000f4', :'E', '08/2026', '2026-08-04', 'E BOOK', 'EB/1', '24EBOOK0000A1Z5', 100, 18, 'NOT_IN_2B', 'INVOICE');
SELECT set_config('twob.write', '', false);
SELECT public.t_raises(format($q$SELECT public.twob_import2b_delete_2b(public.t_employee(), '%s', '08/2026')$q$, :'E'),
  'Needs the Delete 2B rows permission', 'E1: Delete 2B: an employee without the permission is refused');
SELECT public.t_eq(public.twob_import2b_delete_2b(public.t_manager(), :'E', '08/2026') - 'reclaims_released' - 'entries_removed',
  '{"deleted": 2, "kept_filed": 1}'::jsonb, 'E1: Delete 2B: two documents deleted, the one with a filed entry kept');
SELECT public.t_eq((SELECT concat_ws('|', reclaim_month IS NULL, reclaimed_via_doc_id IS NULL) FROM l2 WHERE client_id = :'E' AND supplier_name = 'E OLD'), 't|t',
  'E1: ... the reclaim its document evidenced back in Awaiting reclaim');
SELECT public.t_eq((SELECT string_agg(supplier_invoice_number, ',') FROM lb WHERE client_id = :'E'), 'E/2', 'E1: ... only the filed entry left');
-- Clear Data: the year's open months cleared, Import 2B's entries posted again at once.
SELECT public.t_raises(format($q$SELECT public.twob_clear_year(public.t_employee(), '%s', ARRAY['04/2026','05/2026','06/2026','07/2026','08/2026','09/2026','10/2026','11/2026','12/2026','01/2027','02/2027','03/2027'])$q$, :'E'),
  'Needs the Clear data permission', 'E2: Clear Data: an employee without the permission is refused');
SELECT public.t_eq(public.twob_clear_year(public.t_manager(), :'E', ARRAY['04/2026','05/2026','06/2026','07/2026','08/2026','09/2026','10/2026','11/2026','12/2026','01/2027','02/2027','03/2027']) ->> 'reposted',
  '2', 'E2: Clear Data clears the year and posts Import 2B''s two entries again (the books row, and the document Delete 2B kept)');
SELECT public.t_eq((SELECT string_agg(supplier_name, ',' ORDER BY supplier_name) FROM l2 WHERE client_id = :'E'), 'E BOOK',
  'E2: ... the Not in 2B list holds only what Import 2B posts');
SELECT public.t_eq((SELECT string_agg(supplier_invoice_number || ':' || (source_doc_id IS NOT NULL) || ':' || bill_in_2b_month, ',') FROM lb WHERE client_id = :'E'), 'E/2:true:Aug 26',
  'E2: ... and the Not in Books list only the document still Not in Books, linked, in 2B in Aug 26');
SELECT public.t_eq((SELECT count(*)::integer FROM l2 WHERE client_id = :'E' AND supplier_name = 'E OLD'), 0, 'E2: ... the entry typed by hand is gone (cleared)');

-- ---------------------------------------------------------------------------
-- F. A month out of step: brought up to date, previewed.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);   -- written as before this change: nothing posted
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, book_treatment, doc_type) VALUES
  ('a9000000-0000-0000-0000-000000000c01', :'F', '09/2026', '2026-09-01', 'F ONE', 'F/1', '24FONEE0000A1Z5', 100, 9, 9, 'NOT_IN_2B', 'INVOICE'),
  ('a9000000-0000-0000-0000-000000000c02', :'F', '09/2026', '2026-09-02', 'F TWO', 'F/2', '24FTWOO0000A1Z5', 200, 18, 18, 'MISMATCHED', 'INVOICE');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month, source_book_id)
VALUES (:'F', '09/2026', '2026-09-02', 'F TWO', 'F/2', '24FTWOO0000A1Z5', 200, 18, 18, 'Sep 26', 'a9000000-0000-0000-0000-000000000c02');
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, doc_type, itc_action)
VALUES ('a9000000-0000-0000-0000-000000000c03', :'F', '09/2026', '2026-09-03', 'F DOC', 'FD/1', '24FDOCC0000A1Z5', 300, 54, 'INVOICE', 'NOT_IN_BOOKS');
SELECT set_config('twob.write', '', false);
SELECT public.t_raises(format($q$SELECT public.twob_import2b_catch_up(public.t_employee(), '%s', '09/2026', true)$q$, :'F'),
  'Needs the Import 2B & post permission', 'F: an employee without Import 2B & post is refused');
SELECT public.t_eq(public.twob_import2b_catch_up(public.t_manager(), :'F', '09/2026', true) -> 'bills_not_in_2b',
  '{"add": 1, "link": 0, "change": 0, "remove": 1, "unlink": 0}'::jsonb, 'F: the preview: Not in 2B 1 to add, 1 to take back');
SELECT public.t_eq(public.twob_import2b_catch_up(public.t_manager(), :'F', '09/2026', true) -> 'bills_not_in_books',
  '{"add": 1, "link": 0, "change": 0, "remove": 0, "unlink": 0}'::jsonb, 'F: ... Not in Books 1 to add');
SELECT public.t_eq((SELECT count(*)::integer FROM l2 WHERE client_id = :'F'), 1, 'F: the preview writes nothing');
SELECT public.t_eq((public.twob_import2b_catch_up(public.t_manager(), :'F', '09/2026', false) ->> 'written')::integer, 3, 'F: applied: three entries written');
SELECT public.t_eq((SELECT string_agg(supplier_name, ',') FROM l2 WHERE client_id = :'F'), 'F ONE', 'F: the Not in 2B list follows Import 2B');
SELECT public.t_eq((SELECT string_agg(supplier_name, ',') FROM lb WHERE client_id = :'F'), 'F DOC', 'F: ... and the Not in Books list');
SELECT public.t_eq((public.twob_import2b_catch_up(public.t_manager(), :'F', '09/2026', true) ->> 'written')::integer, 0, 'F: in step: nothing more to do');
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_versions WHERE client_id = :'F' AND is_current), 1, 'F: a version taken');

-- ---------------------------------------------------------------------------
-- H. A prior month: TAMNNA (T-1 posted from the books register in filed July,
-- carried into filed August and open September).
-- ---------------------------------------------------------------------------
RESET ROLE;
SELECT public.t_make_tamnna(:'P', 'AP PRIOR');
SET ROLE anon;
SELECT id AS pbook FROM public.books_register WHERE client_id = :'P' AND period_month = '07/2026' \gset
SELECT public.t_raises(format($q$UPDATE public.books_register SET input_cgst = 1200 WHERE id = '%s'$q$, :'pbook'),
  'This month is filed. Only a GST Manager or the superadmin', 'H1: a filed month''s books row is not written directly');
SELECT public.t_raises(format($q$SELECT public.twob_import2b_prior_save(public.t_employee(), '%s', '07/2026', '[{"table":"books_register","op":"update","id":"%s","values":{"input_cgst":1200}}]'::jsonb, true)$q$, :'P', :'pbook'),
  'Only a GST Manager or the superadmin', 'H2: an employee is refused, preview included');
SELECT public.twob_import2b_prior_save(public.t_manager(), :'P', '07/2026',
  format('[{"table":"books_register","op":"update","id":"%s","values":{"input_cgst":1200,"input_sgst":1200}}]', :'pbook')::jsonb, true) AS pv \gset
SELECT public.t_eq((:'pv'::jsonb ->> 'ok')::boolean, true, 'H3: the preview is ok');
SELECT public.t_eq((SELECT string_agg(concat_ws(':', c ->> 'table', c ->> 'op', c -> 'this' ->> 'action', COALESCE(c ->> 'derived', 'false')), ' ' ORDER BY (c ->> 'index')::integer)
                      FROM jsonb_array_elements(:'pv'::jsonb -> 'changes') c),
  'books_register:update:change:false bills_not_in_2b:update:change:true books_register:update:none:true',
  'H3: the preview: the books row, and the Not in 2B entry it posted, changed with it (the books row named, unchanged)');
SELECT public.t_eq(:'pv'::jsonb -> 'later_months', '[{"count": 1, "period": "08/2026"}, {"count": 1, "period": "09/2026"}]'::jsonb,
  'H3: ... reaching the copies in August and September');
SELECT public.t_eq((SELECT input_cgst FROM public.books_register WHERE id = :'pbook'), 1000.00::numeric, 'H3: the preview saved nothing (books row)');
SELECT public.t_eq((SELECT string_agg(input_cgst::text, ',' ORDER BY period_month) FROM l2 WHERE client_id = :'P' AND supplier_invoice_number = 'T-1'),
  '1000.00,1000.00,1000.00', 'H3: ... nor the ledger');
SELECT public.twob_import2b_prior_save(public.t_manager(), :'P', '07/2026',
  format('[{"table":"books_register","op":"update","id":"%s","values":{"input_cgst":1200,"input_sgst":1200}}]', :'pbook')::jsonb, false) AS pa \gset
SELECT public.t_eq((SELECT input_cgst FROM public.books_register WHERE id = :'pbook'), 1200::numeric, 'H4: applied: the books row');
SELECT public.t_eq((SELECT string_agg(input_cgst::text, ',' ORDER BY period_month) FROM l2 WHERE client_id = :'P' AND supplier_invoice_number = 'T-1'),
  '1200.00,1200.00,1200.00', 'H4: ... its entry and the later copies, together');
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_versions WHERE client_id = :'P' AND period_month = '07/2026' AND is_current), 1, 'H4: a version of July taken');
-- Treatment away: the entry and its copies go with it; back: added again, copies too.
SELECT public.twob_import2b_prior_save(public.t_manager(), :'P', '07/2026',
  format('[{"table":"books_register","op":"update","id":"%s","values":{"book_treatment":"NOT_ELIGIBLE"}}]', :'pbook')::jsonb, false);
SELECT public.t_eq((SELECT count(*)::integer FROM l2 WHERE client_id = :'P' AND supplier_invoice_number = 'T-1'), 0, 'H5: Not Eligible: the entry and its copies go');
SELECT public.t_eq((SELECT count(*)::integer FROM public.books_register WHERE id = :'pbook'), 1, 'H5: ... the books row stays');
SELECT public.twob_import2b_prior_save(public.t_manager(), :'P', '07/2026',
  format('[{"table":"books_register","op":"update","id":"%s","values":{"book_treatment":"NOT_IN_2B"}}]', :'pbook')::jsonb, false);
SELECT public.t_eq((SELECT string_agg(period_month || ':' || (source_book_id IS NOT NULL) || ':' || reversal_month, ',' ORDER BY period_month) FROM l2 WHERE client_id = :'P' AND supplier_invoice_number = 'T-1'),
  '07/2026:true:Jul 26,08/2026:false:Jul 26,09/2026:false:Jul 26', 'H6: Not in 2B again: added in July (linked) and to the later months');
-- A books row of the filed month never posted (written before this change): the month's catch-up through the door.
RESET ROLE;
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, book_treatment, doc_type)
VALUES ('a9000000-0000-0000-0000-000000000c11', :'P', '07/2026', '2026-07-20', 'LATE BOOK', 'LB/1', '24LATEB0000A1Z5', 100, 9, 9, 'NOT_IN_2B', 'INVOICE');
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, doc_type, itc_action)
VALUES ('a9000000-0000-0000-0000-000000000c12', :'P', '07/2026', '2026-07-21', 'NIB DOC', 'ND/1', '24NIBDO0000A1Z5', 100, 18, 'INVOICE', 'NOT_IN_BOOKS');
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.t_raises(format($q$SELECT public.twob_import2b_catch_up(public.t_manager(), '%s', '07/2026', true)$q$, :'P'),
  'This month is filed', 'H7: the open-month catch-up refuses a filed month');
SELECT public.twob_import2b_prior_save(public.t_manager(), :'P', '07/2026', '[]'::jsonb, true, true) AS pw \gset
SELECT public.t_eq((SELECT count(*)::integer FROM jsonb_array_elements(:'pw'::jsonb -> 'changes') c WHERE c -> 'this' ->> 'action' = 'add'), 1,
  'H7: the filed month''s catch-up previews the books entry to add');
SELECT public.twob_import2b_prior_save(public.t_manager(), :'P', '07/2026', '[]'::jsonb, false, true);
SELECT public.t_eq((SELECT string_agg(period_month, ',' ORDER BY period_month) FROM l2 WHERE client_id = :'P' AND supplier_invoice_number = 'LB/1'),
  '07/2026,08/2026,09/2026', 'H7: applied: July and its later months');
SELECT public.t_eq((SELECT count(*)::integer FROM lb WHERE client_id = :'P' AND supplier_invoice_number = 'ND/1'), 0,
  'H7: a filed month''s Not in Books side is never posted (it follows the filed 2B)');
SELECT public.t_raises(format($q$SELECT public.twob_import2b_prior_save(public.t_manager(), '%s', '07/2026', '[{"table":"bills_not_in_2b","op":"delete","id":"%s"}]'::jsonb, true)$q$, :'P', :'pbook'),
  'Only Import 2B books rows are saved here', 'H8: only books rows are sent; their entries are worked out');
SELECT public.t_raises(format($q$SELECT public.twob_import2b_prior_save(public.t_manager(), '%s', '09/2026', '[]'::jsonb, true, true)$q$, :'P'),
  'This month is not filed', 'H9: an open month is not saved through the door');
RESET ROLE;
