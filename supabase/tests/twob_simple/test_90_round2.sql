-- The defects of the second review round (21 Oct 2026), one block each, as
-- PostgREST runs them (anon). Each fails on the round-1 version of
-- 20261021100000 (fe3b49f) and passes on this one. The deadlock (Q5) is
-- test_95_lock_order.sh; the app's own writes (Q8 the stale reclaim, Q12 the
-- open-month delete, Q13 the filing toast) are app_writes.test.mjs.
\set A '90000000-0000-0000-0000-000000000001'
\set B '90000000-0000-0000-0000-000000000002'
\set C '90000000-0000-0000-0000-000000000003'
\set D '90000000-0000-0000-0000-000000000004'
\set E '90000000-0000-0000-0000-000000000005'
\set F '90000000-0000-0000-0000-000000000006'
\set G '90000000-0000-0000-0000-000000000007'
\set H '90000000-0000-0000-0000-000000000008'
\set I '90000000-0000-0000-0000-000000000009'
\set J '90000000-0000-0000-0000-00000000000a'
\set K '90000000-0000-0000-0000-00000000000b'
\set L '90000000-0000-0000-0000-00000000000c'
\set M '90000000-0000-0000-0000-00000000000d'

-- ---------------------------------------------------------------------------
-- Q1 (medium). A month filed after its next month (its PDF came late) still
-- carries: into the filed next month, which held no carried rows, and on
-- into each later month up to the open one, each getting what it lacks. The
-- filed month's figures are recorded first. Filing it again does nothing.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'A', 'Q1 late filing', '24QONEA0000A1Z5'), (:'B', 'Q1 late, empty', '24QONEB0000A1Z5');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  (:'A', '07/2026', '2026-07-03', 'JUL SUP', 'J-1', '24JULSU0000A1Z5', 1000, 90, 90, 'Jul 26', false),
  (:'A', '07/2026', '2026-07-04', 'JUL SUP', 'J-2', '24JULSU0000A1Z5', 2000, 180, 180, 'Jul 26', false),
  (:'A', '08/2026', '2026-08-05', 'AUG SUP', 'A-1', '24AUGSU0000A1Z5', 500, 45, 45, 'Aug 26', false),
  (:'B', '07/2026', '2026-07-03', 'JUL SUP', 'J-1', '24JULSU0000A1Z5', 1000, 90, 90, 'Jul 26', false);
INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, bill_in_2b_month, is_carried_forward) VALUES
  (:'A', '07/2026', '2026-07-09', 'NIB SUP', 'N-1', '24NIBSU0000A1Z5', 100, 9, 9, 'Jul 26', false);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'A', 'GSTR-3B', '08/2026', 'Filed');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'A' AND period_month = '09/2026'), 1,
  'Q1: filing August first carries its own entry into September');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'A', 'GSTR-3B', '07/2026', 'Filed');
SELECT public.t_eq((SELECT array_agg(supplier_invoice_number || CASE WHEN is_carried_forward THEN '+c' ELSE '' END || CASE WHEN is_locked THEN '+l' ELSE '' END
                                     ORDER BY supplier_invoice_number) FROM public.bills_not_in_2b WHERE client_id = :'A' AND period_month = '08/2026'),
  ARRAY['A-1+l', 'J-1+c+l', 'J-2+c+l'], 'Q1: filing July then carries J-1 and J-2 into filed August (locked, as August is)');
SELECT public.t_eq((SELECT array_agg(supplier_invoice_number ORDER BY supplier_invoice_number) FROM public.bills_not_in_2b
                     WHERE client_id = :'A' AND period_month = '09/2026' AND is_carried_forward AND NOT is_locked),
  ARRAY['A-1', 'J-1', 'J-2'], 'Q1: ... and on into open September, which already held August''s carry');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE client_id = :'A' AND period_month IN ('08/2026', '09/2026') AND supplier_invoice_number = 'N-1'), 2,
  'Q1: the Not in Books list too');
SELECT public.t_eq((SELECT reversal_cgst FROM public.twob_filed_figures WHERE client_id = :'A' AND period_month = '08/2026'), 45::numeric,
  'Q1: August''s 4B(2)(i) recorded as filed (its own entry only) before the carry');
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_filed_figures WHERE client_id = :'A' AND period_month = '09/2026'), 0,
  'Q1: open September records nothing');
-- Filing July again: August holds carried rows now, nothing happens.
UPDATE public.filing_status SET status = 'Prepared Pending', is_locked = false, filed_date = NULL WHERE client_id = :'A' AND period_month = '07/2026';
UPDATE public.filing_status SET status = 'Filed' WHERE client_id = :'A' AND period_month = '07/2026';
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'A' AND period_month IN ('08/2026', '09/2026')), 6,
  'Q1: filing July again adds nothing');
-- The verifier's shape: August filed first with nothing on its list.
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'B', 'GSTR-3B', '08/2026', 'Filed');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'B', 'GSTR-3B', '07/2026', 'Filed');
SELECT public.t_eq((SELECT array_agg(period_month ORDER BY period_month) FROM public.bills_not_in_2b WHERE client_id = :'B' AND is_carried_forward),
  ARRAY['08/2026', '09/2026'], 'Q1: an empty filed August and open September both take July''s entry');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Q2 (medium). An entry added to a filed month reaches every later month up
-- to the latest one holding carried rows, a filed month in between included
-- when it holds none yet; Re-run then finds the chain whole.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'C', 'Q2 skip month', '24QTWOC0000A1Z5');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward)
VALUES (:'C', '08/2026', '2026-08-03', 'AUG SUP', 'A-1', '24AUGSU0000A1Z5', 1000, 90, 90, 'Aug 26', false);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'C', 'GSTR-3B', '07/2026', 'Filed');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'C', 'GSTR-3B', '08/2026', 'Filed');
SELECT public.twob_prior_books_apply(public.t_manager(), :'C', '07/2026',
  '[{"table":"bills_not_in_2b","op":"insert","values":{"date":"2026-07-10","supplier_name":"JUL SUP","supplier_invoice_number":"J-1","supplier_gstin":"24JULSU0000A1Z5","taxable_value":500,"input_cgst":45,"input_sgst":45,"reversal_month":"Jul 26"}}]'::jsonb,
  false) -> 'later_months' AS q2_later \gset
SELECT public.t_eq(:'q2_later'::jsonb, '[{"count": 1, "period": "08/2026"}, {"count": 1, "period": "09/2026"}]'::jsonb,
  'Q2: the forgotten July bill reaches filed August (no carried rows yet) and September');
SELECT public.twob_carry_rerun(public.t_manager(), :'C', '08/2026', true) -> 'bills_not_in_2b' AS q2_rerun \gset
SELECT public.t_eq((:'q2_rerun'::jsonb -> 'remove') || (:'q2_rerun'::jsonb -> 'add'), '[]'::jsonb, 'Q2: Re-run of August finds nothing to add or remove');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Q3 (medium). Re-run never adds a second, pending copy beside a copy whose
-- number was corrected in the open month and then reclaimed, nor beside the
-- open month's own entry of the same document.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES (:'D', 'Q3 rerun', '24QTHRD0000A1Z5', true);
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  (:'D', '08/2026', '2026-08-03', 'SUP E', 'E/101', '24SUPEE0000A1Z5', 1000, 90, 90, 'Aug 26', false),
  (:'D', '08/2026', '2026-08-04', 'SUP F', 'F-7', '24SUPFF0000A1Z5', 300, 27, 27, 'Aug 26', false);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'D', 'GSTR-3B', '08/2026', 'Filed');
-- September (open, Liberal): E's copy gets 2B's number and is reclaimed; F's
-- copy is deleted and F entered again as September's own entry.
UPDATE public.bills_not_in_2b SET supplier_invoice_number = 'E-1101', reclaim_month = 'Sep 26'
 WHERE client_id = :'D' AND period_month = '09/2026' AND supplier_invoice_number = 'E/101';
DELETE FROM public.bills_not_in_2b WHERE client_id = :'D' AND period_month = '09/2026' AND supplier_invoice_number = 'F-7';
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward)
VALUES (:'D', '09/2026', '2026-08-04', 'SUP F', 'F-7', '24SUPFF0000A1Z5', 300, 27, 27, 'Aug 26', false);
SELECT public.t_books_side(:'D', '09/2026') AS q3_books \gset
SELECT public.twob_carry_rerun(public.t_manager(), :'D', '08/2026', true) -> 'bills_not_in_2b' AS q3 \gset
SELECT public.t_eq(:'q3'::jsonb -> 'add', '[]'::jsonb, 'Q3 preview: nothing added');
SELECT public.t_eq((SELECT count(*)::integer FROM jsonb_array_elements(:'q3'::jsonb -> 'conflict') x
                     WHERE x ->> 'message' LIKE 'Sep-26''s copy E-1101 of 03-08-2026 has the same supplier and amounts and holds a decision (Sep-26 has reclaimed this entry; undo that reclaim first)%'), 1,
  'Q3 preview: E/101 named against the corrected, reclaimed copy E-1101');
SELECT public.t_eq((SELECT count(*)::integer FROM jsonb_array_elements(:'q3'::jsonb -> 'conflict') x
                     WHERE x ->> 'message' = 'Sep-26 holds this entry as its own entry; it is not added again'), 1,
  'Q3 preview: F-7 named as September''s own entry');
SELECT public.twob_carry_rerun(public.t_manager(), :'D', '08/2026', false) AS q3_done \gset
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'D' AND period_month = '09/2026'), 2,
  'Q3 applied: September still holds two entries');
SELECT public.t_eq(public.t_books_side(:'D', '09/2026'), :'q3_books'::numeric, 'Q3 applied: September''s books side unchanged');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Q4 (medium). A page opened before the deploy restores an open month the
-- old way (delete, error ignored, then add): the add is refused too, so the
-- month is not doubled. The new Restore (decisions undone, month deleted,
-- version added back, twins with a reclaim among them) still works.
-- ---------------------------------------------------------------------------
SELECT public.t_make_tamnna(:'E', 'Q4 old restore');
SET ROLE anon;
SELECT public.t_books_side(:'E', '09/2026') AS q4_books \gset
SELECT public.t_raises(format($q$DELETE FROM public.bills_not_in_2b WHERE client_id = '%s' AND period_month = '09/2026'$q$, :'E'),
  'Sep-26 has reclaimed this entry; undo that reclaim first, then remove it.', 'Q4: the old Restore''s delete is refused');
SELECT public.t_raises(format($q$INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month, reclaim_month, is_carried_forward)
  SELECT client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst,
         reversal_month, reclaim_month, is_carried_forward
    FROM public.bills_not_in_2b WHERE client_id = '%s' AND period_month = '09/2026'$q$, :'E'),
  'OTHER SUPPLIER T-2: Sep-26 already holds this carried entry, with a reclaim, Expense out or book entry; it is not added again.',
  'Q4: ... and so is its add');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'E' AND period_month = '09/2026'), 2, 'Q4: September holds 2 rows, not 4');
SELECT public.t_eq(public.t_books_side(:'E', '09/2026'), :'q4_books'::numeric, 'Q4: September''s books side unchanged');
-- The new Restore: decisions undone, the month deleted, the version added back (twins, one reclaimed).
SELECT public.t_ok(format($q$UPDATE public.bills_not_in_2b SET reclaim_month = NULL, reclaim_subtype = NULL, reclaimed_via_doc_id = NULL
  WHERE client_id = '%s' AND period_month = '09/2026' AND is_carried_forward$q$, :'E'), 'Q4: new Restore undoes the decisions');
SELECT public.t_ok(format($q$DELETE FROM public.bills_not_in_2b WHERE client_id = '%s' AND period_month = '09/2026'$q$, :'E'), 'Q4: new Restore clears the month');
SELECT public.t_ok(format($q$INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month, reclaim_month, is_carried_forward) VALUES
  ('%1$s', '09/2026', '2026-07-16', 'OTHER SUPPLIER', 'T-2', '24OTHER0000A1Z5', 5555.56, 500, 500, 'Jul 26', 'Sep 26', true),
  ('%1$s', '09/2026', '2026-07-16', 'OTHER SUPPLIER', 'T-2', '24OTHER0000A1Z5', 5555.56, 500, 500, 'Jul 26', NULL, true)$q$, :'E'),
  'Q4: new Restore adds the version back, twins with a reclaim among them');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Q6 (medium/low). An entry a later month already holds as its own (a July
-- bill booked late in September) is not added to July: no second copy in
-- September. The rest of the call goes ahead, and the preview names it.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'F', 'Q6 held own', '24QSIXF0000A1Z5');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward)
VALUES (:'F', '07/2026', '2026-07-02', 'OLD', 'O-1', '24OLDSU0000A1Z5', 100, 9, 9, 'Jul 26', false);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'F', 'GSTR-3B', '07/2026', 'Filed');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'F', 'GSTR-3B', '08/2026', 'Filed');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward)
VALUES (:'F', '09/2026', '2026-07-20', 'LATE SUP', 'L-77', '24LATES0000A1Z5', 10000, 900, 900, 'Sep 26', false);
SELECT public.t_books_side(:'F', '09/2026') AS q6_books \gset
SELECT public.twob_prior_books_apply(public.t_manager(), :'F', '07/2026',
  '[{"table":"bills_not_in_2b","op":"insert","values":{"date":"2026-07-20","supplier_name":"LATE SUP","supplier_invoice_number":"L-77","supplier_gstin":"24LATES0000A1Z5","taxable_value":10000,"input_igst":0,"input_cgst":900,"input_sgst":900,"reversal_month":"Jul 26"}},
    {"table":"bills_not_in_2b","op":"insert","values":{"date":"2026-07-21","supplier_name":"NEW SUP","supplier_invoice_number":"W-1","supplier_gstin":"24NEWSU0000A1Z5","taxable_value":100,"input_cgst":9,"input_sgst":9,"reversal_month":"Jul 26"}}]'::jsonb,
  false) AS q6 \gset
SELECT public.t_eq((:'q6'::jsonb ->> 'ok')::boolean, true, 'Q6: the call goes ahead');
SELECT public.t_eq(:'q6'::jsonb -> 'notes' -> 0 ->> 'message', 'Sep-26 already holds this entry on its Not in 2B list; it is not added again',
  'Q6: L-77 named as already in September');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'F' AND supplier_invoice_number = 'L-77'), 1, 'Q6: L-77 not added anywhere');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'F' AND supplier_invoice_number = 'W-1'), 3, 'Q6: W-1 added to July, August and September');
SELECT public.t_eq(public.t_books_side(:'F', '09/2026'), :'q6_books'::numeric + 9, 'Q6: September''s books side moves by W-1 only');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Q7 (medium). One Post of a filed month whose plan holds a document a later
-- month already holds (TAMNNA's JAY INFRASTRUCTURE, booked in September)
-- posts the rest, and names that document.
-- ---------------------------------------------------------------------------
SELECT public.t_make_tamnna(:'G', 'Q7 Post held');
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, itc_action)
VALUES ('90000000-0000-0000-0000-0000000000d7', :'G', '07/2026', '2026-07-12', 'JAY INFRASTRUCTURE', '16/2026-27', '24JAYIN0000A1Z5', 1000, 0, 90, 90, 'NOT_IN_BOOKS');
INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, bill_in_2b_month, book_entry_month, is_carried_forward) VALUES
  (:'G', '09/2026', '2026-07-12', 'JAY INFRASTRUCTURE', '16/2026-27', '24JAYIN0000A1Z5', 1000, 90, 90, 'Jul 26', 'Sep 26', true);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.twob_prior_books_apply(public.t_manager(), :'G', '07/2026',
  '[{"table":"bills_not_in_books","op":"insert","values":{"date":"2026-07-12","supplier_name":"JAY INFRASTRUCTURE","supplier_invoice_number":"16/2026-27","supplier_gstin":"24JAYIN0000A1Z5","taxable_value":1000,"input_igst":0,"input_cgst":90,"input_sgst":90,"bill_in_2b_month":"Jul 26","source_doc_id":"90000000-0000-0000-0000-0000000000d7"}},
    {"table":"bills_not_in_2b","op":"insert","values":{"date":"2026-07-18","supplier_name":"NS SUPPLIER","supplier_invoice_number":"NS/1","supplier_gstin":"24NSSUP0000A1Z5","taxable_value":100,"input_cgst":9,"input_sgst":9,"reversal_month":"Jul 26"}}]'::jsonb,
  false) AS q7 \gset
SELECT public.t_eq((:'q7'::jsonb ->> 'ok')::boolean, true, 'Q7: the Post goes ahead');
SELECT public.t_eq(:'q7'::jsonb -> 'notes' -> 0 ->> 'message', 'Sep-26 already holds this 2B document on its Not in Books list; it is not added again',
  'Q7: the 2B document is named, in words about the document');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE client_id = :'G' AND supplier_invoice_number = '16/2026-27'), 1, 'Q7: no second copy of it');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'G' AND supplier_invoice_number = 'NS/1'), 3, 'Q7: NS/1 posted to July and its later months');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Q9 (low). Refusals name a decision of a filed month as final, and a month
-- column that is not a month as such; only an open month's decision is to be
-- undone first. Re-run keeps a copy holding a filed month's reclaim in the
-- same words.
-- ---------------------------------------------------------------------------
SELECT public.t_make_sorath(:'H', 'Q9 messages', true);
SELECT public.t_make_tamnna(:'I', 'Q9 junk label');
SELECT set_config('twob.write', 'system', false);
UPDATE public.bills_not_in_2b SET reclaim_month = '2425788' WHERE client_id = :'I' AND period_month = '09/2026' AND supplier_invoice_number = 'T-2';
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT id AS q9_n1 FROM public.bills_not_in_books WHERE client_id = :'H' AND period_month = '07/2026' \gset
SELECT public.twob_prior_books_apply(public.t_manager(), :'H', '07/2026',
  jsonb_build_array(jsonb_build_object('table', 'bills_not_in_books', 'op', 'delete', 'id', :'q9_n1')), true) -> 'refusals' -> 0 ->> 'message' AS q9_a \gset
SELECT public.t_eq(:'q9_a'::text, 'Aug-26 (filed) has booked this entry, so it cannot be removed or its amounts changed', 'Q9: a filed month''s book entry is final');
SELECT id AS q9_t2 FROM public.bills_not_in_2b WHERE client_id = :'I' AND period_month = '07/2026' AND supplier_invoice_number = 'T-2' \gset
SELECT public.twob_prior_books_apply(public.t_manager(), :'I', '07/2026',
  jsonb_build_array(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', :'q9_t2')), true) -> 'refusals' -> 0 ->> 'message' AS q9_b \gset
SELECT public.t_eq(:'q9_b'::text, 'Sep-26 holds a reclaim month that is not a month (2425788); clear it in Sep-26 first', 'Q9: an unreadable reclaim month is named');
RESET ROLE;
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name) VALUES (:'J', 'Q9 rerun keep');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, input_cgst, input_sgst, reversal_month, reclaim_month, is_carried_forward) VALUES
  (:'J', '08/2026', '2026-08-01', 'TW', 'TW-1', '24TWINS0000A1Z5', 100, 100, 'Aug 26', NULL, false),
  (:'J', '09/2026', '2026-08-01', 'TW', 'TW-1', '24TWINS0000A1Z5', 100, 100, 'Aug 26', NULL, true),
  (:'J', '09/2026', '2026-07-05', 'GONE', 'G-1', '24GONEE0000A1Z5', 70, 70, 'Jul 26', 'Aug 26', true);
INSERT INTO public.filing_status (client_id, return_type, period_month, status, is_locked) VALUES (:'J', 'GSTR-3B', '08/2026', 'Filed', true);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.twob_carry_rerun(public.t_manager(), :'J', '08/2026', true) -> 'bills_not_in_2b' -> 'keep' -> 0 ->> 'message' AS q9_c \gset
SELECT public.t_eq(:'q9_c'::text, 'Aug-26 (filed) has reclaimed this entry, so it cannot be removed or its amounts changed', 'Q9: Re-run keeps a copy holding a filed month''s reclaim, in final words');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Q10 (medium). Removing a posted Not in 2B entry takes its books register row
-- too when that row is paired with a 2B document, so Post never adds it back.
-- ---------------------------------------------------------------------------
SELECT public.t_make_tamnna(:'K', 'Q10 paired books row');
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, itc_action)
VALUES ('90000000-0000-0000-0000-0000000000da', :'K', '07/2026', '2026-07-15', 'TAMNNA SUPPLIER', 'T-1', '24TSUPP0000A1Z5', 11111.11, 0, 900, 900, 'MATCHED');
UPDATE public.books_register SET matched_2b_id = '90000000-0000-0000-0000-0000000000da' WHERE client_id = :'K';
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT id AS q10_t1 FROM public.bills_not_in_2b WHERE client_id = :'K' AND period_month = '07/2026' AND supplier_invoice_number = 'T-1' \gset
SELECT COALESCE(public.twob_prior_books_apply(public.t_manager(), :'K', '07/2026',
  jsonb_build_array(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', :'q10_t1')), true) -> 'changes' -> 0 -> 'this' ->> 'books_row', '(none)') AS q10_prev \gset
SELECT public.t_eq(:'q10_prev'::text, 'remove', 'Q10 preview: its paired books row goes too');
SELECT public.twob_prior_books_apply(public.t_manager(), :'K', '07/2026',
  jsonb_build_array(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', :'q10_t1')), false) IS NOT NULL AS q10_done \gset
SELECT public.t_eq((SELECT count(*)::integer FROM public.books_register WHERE client_id = :'K'), 0, 'Q10: the paired books row is gone, so Post cannot add T-1 back');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'K' AND supplier_invoice_number = 'T-1'), 0, 'Q10: T-1 gone from every month');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Q11 (low). A link of a filed month's row is cleared only once the row it
-- names is gone (the key's ON DELETE SET NULL), never by hand.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name) VALUES (:'L', 'Q11 links');
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, itc_action) VALUES
  ('90000000-0000-0000-0000-0000000000db', :'L', '07/2026', '2026-07-10', 'NIB', 'N-9', '24NIBXX0000A1Z5', 1000, 0, 90, 90, 'NOT_IN_BOOKS'),
  ('90000000-0000-0000-0000-0000000000dc', :'L', '09/2026', '2026-09-10', 'RCL', 'R-9', '24RCLXX0000A1Z5', 1000, 0, 50, 50, 'RECLAIM');
INSERT INTO public.bills_not_in_books (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, bill_in_2b_month, source_doc_id)
VALUES ('90000000-0000-0000-0000-0000000000b1', :'L', '07/2026', '2026-07-10', 'NIB', 'N-9', '24NIBXX0000A1Z5', 1000, 90, 90, 'Jul 26', '90000000-0000-0000-0000-0000000000db');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month, reclaimed_via_doc_id)
VALUES ('90000000-0000-0000-0000-0000000000b2', :'L', '07/2026', '2026-07-11', 'RCL', 'R-9', '24RCLXX0000A1Z5', 1000, 50, 50, 'Jul 26', '90000000-0000-0000-0000-0000000000dc');
INSERT INTO public.filing_status (client_id, return_type, period_month, status, is_locked) VALUES (:'L', 'GSTR-3B', '07/2026', 'Filed', true);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.t_raises($$UPDATE public.bills_not_in_books SET source_doc_id = NULL WHERE id = '90000000-0000-0000-0000-0000000000b1'$$,
  'This month is filed', 'Q11: clearing a link by hand in a filed month is refused');
SELECT public.t_eq(public.twob_prior_books_apply(public.t_manager(), :'L', '07/2026', '[{"table":"bills_not_in_books","op":"delete","id":"90000000-0000-0000-0000-0000000000b1"}]', true) -> 'refusals' -> 0 ->> 'message',
  'It comes from this month''s 2B document, which stays as filed (Not in Books); the next Post would add it back', 'Q11: so the door''s protection stays');
SELECT public.t_ok($$DELETE FROM public.twob_import_docs WHERE id = '90000000-0000-0000-0000-0000000000dc'$$, 'Q11: deleting an open month''s 2B document still clears a filed row''s link to it');
SELECT public.t_eq((SELECT reclaimed_via_doc_id FROM public.bills_not_in_2b WHERE id = '90000000-0000-0000-0000-0000000000b2'), NULL::uuid, 'Q11: the link is cleared');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Q12 (low). A cleared date cell or a typed amount that is not a number is
-- refused in words, not with a raw cast error.
-- ---------------------------------------------------------------------------
SELECT public.t_make_tamnna(:'M', 'Q12 casts');
SET ROLE anon;
SELECT id AS q12_c8 FROM public.bills_not_in_2b WHERE client_id = :'M' AND period_month = '08/2026' AND supplier_invoice_number = 'T-1' \gset
SELECT public.t_eq(public.twob_prior_books_apply(public.t_manager(), :'M', '08/2026',
  jsonb_build_array(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'update', 'id', :'q12_c8', 'values', jsonb_build_object('date', ''))), true) -> 'refusals' -> 0 ->> 'message',
  'An entry needs a date.', 'Q12: a cleared date');
SELECT public.t_eq(public.twob_prior_books_apply(public.t_manager(), :'M', '08/2026',
  jsonb_build_array(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'update', 'id', :'q12_c8', 'values', jsonb_build_object('input_cgst', '12a'))), true) -> 'refusals' -> 0 ->> 'message',
  '12a is not an amount.', 'Q12: an amount that is not a number');
SELECT public.t_eq(public.twob_prior_books_apply(public.t_manager(), :'M', '07/2026',
  '[{"table":"bills_not_in_2b","op":"insert","values":{"date":"2026-02-30","supplier_name":"X","input_cgst":"","input_sgst":""}}]'::jsonb, true) -> 'refusals' -> 0 ->> 'message',
  '2026-02-30 is not a date.', 'Q12: a date that does not exist, on a new entry');
SELECT public.t_eq(public.twob_prior_books_apply(public.t_manager(), :'M', '07/2026',
  '[{"table":"books_register","op":"insert","values":{"date":"","supplier_name":"X","input_cgst":""}}]'::jsonb, true) ->> 'ok',
  'true', 'Q12: blank cells of a new books register row are taken as empty');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Q14 (medium). In an open month a carried entry holding a decision carried
-- in from an earlier month is deleted as before; one holding the month's own
-- decision is still refused (a page opened before the deploy would lose it).
-- ---------------------------------------------------------------------------
\set N '90000000-0000-0000-0000-00000000000e'
SELECT public.t_make_sorath(:'N', 'Q14 inherited', true);
SELECT set_config('twob.write', 'system', false);
UPDATE public.bills_not_in_2b SET reclaim_month = 'Jun 26' WHERE client_id = :'N' AND period_month = '09/2026' AND supplier_name = 'OLD B';
UPDATE public.bills_not_in_2b SET reclaim_month = 'Sep 26' WHERE client_id = :'N' AND period_month = '09/2026' AND supplier_name = 'OLD A';
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.t_ok(format($q$DELETE FROM public.bills_not_in_2b WHERE client_id = '%s' AND period_month = '09/2026' AND supplier_name = 'OLD B'$q$, :'N'),
  'Q14: a carried entry with an inherited reclaim (Jun 26) is deleted in open September');
SELECT public.t_raises(format($q$DELETE FROM public.bills_not_in_2b WHERE client_id = '%s' AND period_month = '09/2026' AND supplier_name = 'OLD A'$q$, :'N'),
  'OLD A A-1: Sep-26 has reclaimed this entry; undo that reclaim first, then remove it.', 'Q14: one with September''s own reclaim is still refused');
RESET ROLE;
