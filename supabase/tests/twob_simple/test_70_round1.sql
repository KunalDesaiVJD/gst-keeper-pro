-- The defects of the first review round (21 Oct 2026), one block each, as
-- PostgREST runs them (anon). Each fails on the first version of
-- 20261021100000 and passes on this one.
\set A '70000000-0000-0000-0000-000000000001'
\set B '70000000-0000-0000-0000-000000000002'
\set C '70000000-0000-0000-0000-000000000003'
\set D '70000000-0000-0000-0000-000000000004'
\set E '70000000-0000-0000-0000-000000000005'
\set F '70000000-0000-0000-0000-000000000006'
\set G '70000000-0000-0000-0000-000000000007'
\set H '70000000-0000-0000-0000-000000000008'

-- ---------------------------------------------------------------------------
-- R1 (high). Re-run never adds a second, pending copy beside a reclaimed copy
-- of the same invoice. July (filed) holds T-2 at 600 (corrected before this
-- change); August (open) holds the old copy at 500, reclaimed in August.
-- ---------------------------------------------------------------------------
SELECT public.t_make_tamnna(:'A', 'R1 rerun conflict');
SELECT set_config('twob.write', 'system', false);
UPDATE public.filing_status SET status = 'Data Received', is_locked = false, filed_date = NULL
 WHERE client_id = :'A' AND period_month = '08/2026';
DELETE FROM public.twob_ever_filed WHERE client_id = :'A' AND period_month = '08/2026';
DELETE FROM public.bills_not_in_2b WHERE client_id = :'A' AND period_month = '09/2026';
UPDATE public.bills_not_in_2b SET input_cgst = 600, input_sgst = 600 WHERE client_id = :'A' AND period_month = '07/2026' AND supplier_invoice_number = 'T-2';
UPDATE public.bills_not_in_2b SET reclaim_month = 'Aug 26', is_locked = false WHERE client_id = :'A' AND period_month = '08/2026' AND supplier_invoice_number = 'T-2';
SELECT set_config('twob.write', '', false);

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.twob_carry_rerun(public.t_manager(), :'A', '07/2026', true) -> 'bills_not_in_2b' AS r1 \gset
SELECT public.t_eq(:'r1'::jsonb -> 'add', '[]'::jsonb, 'R1 preview: T-2 at 600 is not added beside the reclaimed copy');
SELECT public.t_eq(:'r1'::jsonb -> 'remove', '[]'::jsonb, 'R1 preview: the reclaimed copy is not removed');
SELECT public.t_eq(:'r1'::jsonb -> 'conflict' -> 0 ->> 'message',
  'Jul-26 holds it at 1,200.00 tax and Aug-26''s copy at 1,000.00; Aug-26 has reclaimed this entry; undo that reclaim first, then re-run',
  'R1 preview: the conflict names both amounts and the reclaim');
SELECT public.twob_carry_rerun(public.t_manager(), :'A', '07/2026', false) AS r1a \gset
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'A' AND period_month = '08/2026' AND supplier_invoice_number = 'T-2'), 1,
  'R1 applied: Aug-26 holds T-2 once (no second, pending copy)');
SELECT public.t_eq((SELECT reclaim_month FROM public.bills_not_in_2b WHERE client_id = :'A' AND period_month = '08/2026' AND supplier_invoice_number = 'T-2'), 'Aug 26',
  'R1 applied: its reclaim stays');
-- The verifier's own shape: July and August filed, September open, T-2 reclaimed in September.
RESET ROLE;
SELECT public.t_make_tamnna(:'B', 'R1 legacy');
SELECT set_config('twob.write', 'system', false);
UPDATE public.bills_not_in_2b SET input_cgst = 600, input_sgst = 600 WHERE client_id = :'B' AND period_month = '07/2026' AND supplier_invoice_number = 'T-2';
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.t_books_side(:'B', '09/2026') AS b_sep_before \gset
SELECT public.t_raises(format($q$SELECT public.twob_carry_rerun(public.t_manager(), '%s', '07/2026', false)$q$, :'B'),
  'Aug-26 is filed too. Re-run works only into a month not yet filed.', 'R1 legacy: Re-run of July into filed August refused');
SELECT public.twob_carry_rerun(public.t_manager(), :'B', '08/2026', false) -> 'bills_not_in_2b' AS b2 \gset
SELECT public.t_eq(:'b2'::jsonb -> 'add', '[]'::jsonb, 'R1 legacy: Re-run of August adds nothing to September');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'B' AND period_month = '09/2026' AND supplier_invoice_number = 'T-2'), 1,
  'R1 legacy: September holds T-2 once');
SELECT public.t_eq(public.t_books_side(:'B', '09/2026'), :'b_sep_before'::numeric, 'R1 legacy: September''s books side unchanged');
-- ... and correcting August's copy through the door is refused while September has reclaimed it.
SELECT id AS b_aug_t2 FROM public.bills_not_in_2b WHERE client_id = :'B' AND period_month = '08/2026' AND supplier_invoice_number = 'T-2' \gset
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '08/2026', '[{"table": "bills_not_in_2b", "op": "update", "id": "%s", "values": {"input_cgst": 600, "input_sgst": 600}}]'::jsonb, false)$q$, :'B', :'b_aug_t2'),
  'Sep-26 has reclaimed this entry; undo that reclaim first', 'R1 legacy: the door names September''s reclaim');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- R2 (medium). Re-run never removes a copy in a filed month, and never runs
-- into a month followed by more carried months. SORATH's legacy deletion:
-- July's T-2 removed by the old app, so filed August and open September
-- still hold copies, September's reclaimed.
-- ---------------------------------------------------------------------------
SELECT public.t_make_tamnna(:'C', 'R2 rerun later copies');
SELECT set_config('twob.write', 'system', false);
DELETE FROM public.bills_not_in_2b WHERE client_id = :'C' AND period_month = '07/2026' AND supplier_invoice_number = 'T-2';
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.t_books_side(:'C', '08/2026') AS c_aug_before \gset
SELECT public.t_raises(format($q$SELECT public.twob_carry_rerun(public.t_manager(), '%s', '07/2026', false)$q$, :'C'),
  'Aug-26 is filed too', 'R2: Re-run into filed August refused');
SELECT public.t_eq(public.t_books_side(:'C', '08/2026'), :'c_aug_before'::numeric, 'R2: August''s books side unchanged');
SELECT public.t_eq(public.t_count(:'C', '08/2026', 'OTHER SUPPLIER'), 1, 'R2: August keeps T-2 (September''s reclaim depends on it)');
-- A month after the next one holding carried rows: refused.
RESET ROLE;
SELECT set_config('twob.write', 'system', false);
UPDATE public.filing_status SET status = 'Data Received', is_locked = false, filed_date = NULL WHERE client_id = :'C' AND period_month = '08/2026';
DELETE FROM public.twob_ever_filed WHERE client_id = :'C' AND period_month = '08/2026';
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.t_raises(format($q$SELECT public.twob_carry_rerun(public.t_manager(), '%s', '07/2026', true)$q$, :'C'),
  'Sep-26 already holds carried entries. Re-run works only into the last month that holds them.', 'R2: Re-run with later carried months refused');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- R4 (medium). A new entry in a prior month takes that month as its reversal
-- (in-2B) month, or none.
-- ---------------------------------------------------------------------------
SELECT public.t_make_tamnna(:'D', 'R4 insert months');
SET ROLE anon;
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_2b", "op": "insert", "values": {"date": "2026-07-20", "supplier_name": "NEW JULY", "input_cgst": 900, "input_sgst": 900, "reversal_month": "Sep 26"}}]'::jsonb, false)$q$, :'D'),
  'A new entry in a filed month takes this month, Jul 26, as its reversal month, or none (not Sep 26).', 'R4: reversal month Sep 26 refused');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_2b", "op": "insert", "values": {"date": "2026-07-20", "supplier_name": "NEW JULY", "input_cgst": 900, "input_sgst": 900, "reversal_month": "xyz"}}]'::jsonb, false)$q$, :'D'),
  'not xyz', 'R4: free text refused');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_books", "op": "insert", "values": {"date": "2026-07-20", "supplier_name": "NEW NIB", "input_cgst": 9, "input_sgst": 9, "bill_in_2b_month": "Aug 26"}}]'::jsonb, false)$q$, :'D'),
  'as its in-2B month, or none', 'R4: Not in Books in-2B month Aug 26 refused');
SELECT public.t_books_side(:'D', '09/2026') AS d_sep_before \gset
SELECT public.twob_prior_books_apply(public.t_manager(), :'D', '07/2026', '[{"table": "bills_not_in_2b", "op": "insert", "values": {"date": "2026-07-20", "supplier_name": "NEW JULY", "input_cgst": 900, "input_sgst": 900, "reversal_month": "jul-2026"}}]'::jsonb, false) AS d_ok \gset
SELECT public.t_eq((SELECT array_agg(DISTINCT reversal_month) FROM public.bills_not_in_2b WHERE client_id = :'D' AND supplier_name = 'NEW JULY'), ARRAY['Jul 26'],
  'R4: jul-2026 accepted, kept as Jul 26 in July and on every copy');
SELECT public.t_eq((SELECT COALESCE(sum(input_cgst), 0) FROM public.bills_not_in_2b WHERE client_id = :'D' AND period_month = '09/2026'
                     AND public.twob_label_matches(reversal_month, '09/2026')), 0::numeric, 'R4: open September''s 4B(2)(i) unmoved');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- R5 (medium). No carry into a prior month, and no carry after filing for
-- anyone to call: only the filing trigger carries.
-- ---------------------------------------------------------------------------
SELECT public.t_make_tamnna(:'E', 'R5 carry into prior');
SET ROLE anon;
SELECT public.t_eq(to_regprocedure('public.twob_carry_after_filing(uuid, text)') IS NULL, true, 'R5: twob_carry_after_filing is gone');
SELECT public.twob_prior_books_apply(public.t_manager(), :'E', '07/2026', '[{"table": "bills_not_in_books", "op": "insert", "values": {"date": "2026-07-21", "supplier_name": "NIB NEW", "input_cgst": 9, "input_sgst": 9, "bill_in_2b_month": "Jul 26"}}]'::jsonb, false) -> 'later_months' AS e_later \gset
SELECT public.t_eq(:'e_later'::jsonb, '[]'::jsonb, 'R5: no later month holds a Not in Books list, so none is made');
-- July unlocked and filed again: filed August holds no carried Not in Books
-- rows, so July's list is carried into it and on into open September (round
-- 2, D1: the filings that would have carried it have passed). Its Not in 2B
-- list, carried before, is left as it is.
UPDATE public.filing_status SET status = 'Prepared Pending', is_locked = false, filed_date = NULL WHERE client_id = :'E' AND period_month = '07/2026';
UPDATE public.filing_status SET status = 'Filed', filed_date = '2026-10-21' WHERE client_id = :'E' AND period_month = '07/2026';
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE client_id = :'E' AND period_month IN ('08/2026', '09/2026') AND is_carried_forward), 2,
  'R5: re-filing July carries its Not in Books entry into filed August and open September');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'E' AND period_month = '08/2026'), 2,
  'R5: August''s Not in 2B list is left as it is');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- R6 (medium). A page opened before this change runs the old delete-and-copy
-- carry: deleting an open month's carried rows that hold the month's own
-- decision is refused, so the reclaim stays.
-- ---------------------------------------------------------------------------
SELECT public.t_make_tamnna(:'F', 'R6 old tab');
SELECT set_config('twob.write', 'system', false);
UPDATE public.filing_status SET status = 'Data Received', is_locked = false, filed_date = NULL WHERE client_id = :'F' AND period_month = '08/2026';
DELETE FROM public.twob_ever_filed WHERE client_id = :'F' AND period_month = '08/2026';
DELETE FROM public.bills_not_in_2b WHERE client_id = :'F' AND period_month = '09/2026';
UPDATE public.bills_not_in_2b SET reclaim_month = 'Aug 26', is_locked = false WHERE client_id = :'F' AND period_month = '08/2026' AND supplier_invoice_number = 'T-2';
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.t_raises(format($q$DELETE FROM public.bills_not_in_2b WHERE client_id = '%s' AND period_month = '08/2026' AND is_carried_forward = true$q$, :'F'),
  'OTHER SUPPLIER T-2: Aug-26 has reclaimed this entry; undo that reclaim first, then remove it.', 'R6: the old carry''s delete is refused');
SELECT public.t_eq((SELECT reclaim_month FROM public.bills_not_in_2b WHERE client_id = :'F' AND period_month = '08/2026' AND supplier_invoice_number = 'T-2'), 'Aug 26',
  'R6: August''s reclaim stays');
SELECT public.t_ok(format($q$DELETE FROM public.bills_not_in_2b WHERE client_id = '%s' AND period_month = '08/2026' AND supplier_invoice_number = 'T-1'$q$, :'F'),
  'R6: an undecided carried row of an open month is still deleted');
-- The new app's Restore and Clear Data undo the decisions first (an intended wipe).
SELECT public.t_ok(format($q$UPDATE public.bills_not_in_2b SET reclaim_month = NULL, reclaim_subtype = NULL, reclaimed_via_doc_id = NULL WHERE client_id = '%s' AND period_month = '08/2026' AND is_carried_forward$q$, :'F'),
  'R6: decisions undone first');
SELECT public.t_ok(format($q$DELETE FROM public.bills_not_in_2b WHERE client_id = '%s' AND period_month = '08/2026'$q$, :'F'), 'R6: then the month clears');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- R7 (low). One call naming the same entry twice is refused.
-- ---------------------------------------------------------------------------
SELECT public.t_make_tamnna(:'G', 'R7 twice');
SET ROLE anon;
SELECT id AS g_t1 FROM public.bills_not_in_2b WHERE client_id = :'G' AND period_month = '07/2026' AND supplier_invoice_number = 'T-1' \gset
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_2b", "op": "update", "id": "%s", "values": {"input_cgst": 1100}}, {"table": "bills_not_in_2b", "op": "delete", "id": "%s"}]'::jsonb, false)$q$, :'G', :'g_t1', :'g_t1'),
  'One save names the same entry twice.', 'R7: update then delete of one entry refused');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_2b", "op": "update", "id": "%s", "values": {"supplier_invoice_number": "T-1A"}}, {"table": "bills_not_in_2b", "op": "update", "id": "%s", "values": {"supplier_invoice_number": "T-1B"}}]'::jsonb, false)$q$, :'G', :'g_t1', :'g_t1'),
  'One save names the same entry twice.', 'R7: two renames of one entry refused');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'G' AND supplier_invoice_number = 'T-1' AND input_cgst = 1000), 3,
  'R7: T-1 as it was in every month');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- R11 (medium). Re-run works only from a filed month: an unfiled month
-- carries when it is filed, so its next month never holds a list that the
-- filing would then leave stale.
-- ---------------------------------------------------------------------------
\set K '70000000-0000-0000-0000-00000000000b'
INSERT INTO public.clients (id, name) VALUES (:'K', 'R11 unfiled');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'K', 'GSTR-3B', '07/2026', 'Data Received');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, input_cgst, input_sgst, reversal_month)
VALUES (:'K', '07/2026', '2026-07-01', 'FIRST', 90, 90, 'Jul 26');
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.t_raises(format($q$SELECT public.twob_carry_rerun(public.t_manager(), '%s', '07/2026', false)$q$, :'K'),
  'Jul-26 is not filed. Re-run works from a filed month; filing Jul-26 carries its entries into Aug-26.', 'R11: Re-run of an unfiled month refused');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, input_cgst, input_sgst, reversal_month)
VALUES (:'K', '07/2026', '2026-07-02', 'LATER', 450, 450, 'Jul 26');
UPDATE public.filing_status SET status = 'Filed', arn = 'AA2407260000011' WHERE client_id = :'K' AND period_month = '07/2026';
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'K' AND period_month = '08/2026'), 2,
  'R11: filing carries both FIRST and LATER into Aug-26');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- R12 (medium). A removal on 2B Reconciliation is not undone by the next
-- Post, and an entry the month (or a later month) already holds is not
-- added again.
-- ---------------------------------------------------------------------------
SELECT public.t_make_tamnna(:'H', 'R12 post re-add');
SET ROLE anon;
SELECT id AS h_t1 FROM public.bills_not_in_2b WHERE client_id = :'H' AND period_month = '07/2026' AND supplier_invoice_number = 'T-1' \gset
SELECT source_book_id AS h_book FROM public.bills_not_in_2b WHERE id = :'h_t1' \gset
SELECT public.twob_prior_books_apply(public.t_manager(), :'H', '07/2026', format('[{"table": "bills_not_in_2b", "op": "delete", "id": "%s"}]', :'h_t1')::jsonb, true) AS h_prev \gset
SELECT public.t_eq(:'h_prev'::jsonb -> 'changes' -> 0 -> 'this' ->> 'books_row', 'remove', 'R12 preview: its books register row goes too');
SELECT public.twob_prior_books_apply(public.t_manager(), :'H', '07/2026', format('[{"table": "bills_not_in_2b", "op": "delete", "id": "%s"}]', :'h_t1')::jsonb, false) AS h_done \gset
SELECT public.t_eq((SELECT count(*)::integer FROM public.books_register WHERE id = :'h_book'), 0, 'R12: the books row that posted T-1 is gone, so Post cannot add it back');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'H' AND supplier_invoice_number = 'T-1'), 0, 'R12: T-1 gone from July, August and September');
-- Adding T-2 again (July holds it) or an entry August holds as carried: not
-- added, and named (round 2: a note, the rest of the call goes ahead).
SELECT public.twob_prior_books_apply(public.t_manager(), :'H', '07/2026', '[{"table": "bills_not_in_2b", "op": "insert", "values": {"date": "2026-07-16", "supplier_name": "OTHER SUPPLIER", "supplier_invoice_number": "T-2", "supplier_gstin": "24OTHER0000A1Z5", "taxable_value": 5555.56, "input_igst": 0, "input_cgst": 500, "input_sgst": 500, "reversal_month": "Jul 26"}}]'::jsonb, false) AS h_twice \gset
SELECT public.t_eq(:'h_twice'::jsonb -> 'notes' -> 0 ->> 'message', 'Jul-26 already holds this entry on its Not in 2B list; it is not added again', 'R12: a document July holds is not added twice');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'H' AND supplier_invoice_number = 'T-2'), 3, 'R12: T-2 still once a month');
RESET ROLE;
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward)
VALUES (:'H', '08/2026', '2026-06-30', 'ORPHAN CO', 'O-9', '24ORPHA0000A1Z5', 100, 9, 9, 'Jun 26', true);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.twob_prior_books_apply(public.t_manager(), :'H', '07/2026', '[{"table": "bills_not_in_2b", "op": "insert", "values": {"date": "2026-06-30", "supplier_name": "ORPHAN CO", "supplier_invoice_number": "O-9", "supplier_gstin": "24ORPHA0000A1Z5", "taxable_value": 100, "input_cgst": 9, "input_sgst": 9, "reversal_month": "Jul 26"}}]'::jsonb, false) AS h_orphan \gset
SELECT public.t_eq(:'h_orphan'::jsonb -> 'notes' -> 0 ->> 'message', 'Aug-26 already holds this entry on its Not in 2B list; it is not added again', 'R12: a document August carries is not given a second copy');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'H' AND supplier_invoice_number = 'O-9'), 1, 'R12: ORPHAN CO still only in August');
-- A changed entry keeps its books row in step (the next Post does not undo it).
SELECT id AS h_t2 FROM public.bills_not_in_2b WHERE client_id = :'H' AND period_month = '07/2026' AND supplier_invoice_number = 'T-2' \gset
RESET ROLE;
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, book_treatment, doc_type)
VALUES ('70000000-0000-0000-0000-0000000000b2', :'H', '07/2026', '2026-07-16', 'OTHER SUPPLIER', 'T-2', '24OTHER0000A1Z5', 5555.56, 500, 500, 'NOT_IN_2B', 'INVOICE');
UPDATE public.bills_not_in_2b SET source_book_id = '70000000-0000-0000-0000-0000000000b2' WHERE id = :'h_t2';
UPDATE public.bills_not_in_2b SET reclaim_month = NULL WHERE client_id = :'H' AND supplier_invoice_number = 'T-2';
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.twob_prior_books_apply(public.t_manager(), :'H', '07/2026', format('[{"table": "bills_not_in_2b", "op": "update", "id": "%s", "values": {"supplier_invoice_number": "T-2/A", "input_cgst": 550, "input_sgst": 550}}]', :'h_t2')::jsonb, false) AS h_upd \gset
SELECT public.t_eq((SELECT supplier_invoice_number || ' ' || input_cgst FROM public.books_register WHERE id = '70000000-0000-0000-0000-0000000000b2'), 'T-2/A 550',
  'R12: the books row takes the same correction');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- R13 (medium). A return marked Filed by mistake is reopened, with a reason,
-- by a GST Manager or the superadmin.
-- ---------------------------------------------------------------------------
\set M '70000000-0000-0000-0000-000000000009'
SELECT public.t_make_tamnna(:'M', 'R13 reopen');
SET ROLE anon;
UPDATE public.filing_status SET status = 'Filed', arn = 'AA2409260000099' WHERE client_id = :'M' AND period_month = '09/2026';
UPDATE public.filing_status SET status = 'Data Received', is_locked = false, filed_date = NULL, arn = NULL WHERE client_id = :'M' AND period_month = '09/2026';
SELECT public.t_eq(public.twob_month_is_prior(:'M', '09/2026'), true, 'R13: back to Data Received, September is still prior');
SELECT public.t_raises(format($q$SELECT public.twob_reopen_filed(public.t_employee(), '%s', 'GSTR-3B', '09/2026', 'set by mistake')$q$, :'M'),
  'Only a GST Manager or the superadmin can reopen', 'R13: an employee cannot reopen');
SELECT public.t_raises(format($q$SELECT public.twob_reopen_filed(public.t_manager(), '%s', 'GSTR-3B', '09/2026', '  ')$q$, :'M'),
  'Write why Filed was set by mistake.', 'R13: a reason is needed');
SELECT public.t_raises(format($q$SELECT public.twob_reopen_filed(public.t_manager(), '%s', 'GSTR-3B', '08/2026', 'set by mistake')$q$, :'M'),
  'Its status is still Filed.', 'R13: a return still Filed is not reopened');
SELECT public.twob_reopen_filed(public.t_manager(), :'M', 'GSTR-3B', '09/2026', 'Filed clicked on the wrong client') AS m_state \gset
SELECT public.t_eq((:'m_state'::jsonb ->> 'is_prior')::boolean, false, 'R13: September is open again');
SELECT public.t_eq((SELECT reopen_reason FROM public.twob_ever_filed WHERE client_id = :'M' AND period_month = '09/2026'), 'Filed clicked on the wrong client',
  'R13: the reason is recorded');
SELECT public.t_ok(format($q$INSERT INTO public.twob_import_docs (client_id, period_month, supplier_name, itc_action) VALUES ('%s', '09/2026', 'IMPORTED', 'MATCHED')$q$, :'M'),
  'R13: September''s 2B import works again');
UPDATE public.filing_status SET status = 'Filed', arn = 'AA2409260000100' WHERE client_id = :'M' AND period_month = '09/2026';
SELECT public.t_eq(public.twob_month_is_prior(:'M', '09/2026'), true, 'R13: filed for real, prior again');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- R17 (high). The figures a gate reads for a prior month are recorded just
-- before its first change: the live figures until then, unchanged after.
-- ---------------------------------------------------------------------------
\set N '70000000-0000-0000-0000-00000000000a'
SELECT public.t_make_sorath(:'N', 'R17 figures', false);
SET ROLE anon;
SELECT public.twob_prior_books_apply(public.t_manager(), :'N', '07/2026',
  jsonb_build_array(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', (public.t_ids(:'N', '07/2026', 'BOI - CC', 1))[1])), true) AS n_dry \gset
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_filed_figures WHERE client_id = :'N'), 0, 'R17: a preview records nothing');
SELECT COALESCE(sum(input_cgst), 0) AS n_live FROM public.bills_not_in_2b WHERE client_id = :'N' AND period_month = '07/2026' AND public.twob_label_matches(reversal_month, '07/2026') \gset
SELECT public.twob_prior_books_apply(public.t_manager(), :'N', '07/2026',
  jsonb_build_array(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', (public.t_ids(:'N', '07/2026', 'BOI - CC', 1))[1])), false) AS n_done \gset
SELECT public.t_eq((SELECT reversal_cgst FROM public.twob_filed_figures WHERE client_id = :'N' AND period_month = '07/2026'), :'n_live'::numeric,
  'R17: July''s 4B(2)(i) recorded as it stood before the change');
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_filed_figures WHERE client_id = :'N' AND period_month IN ('08/2026', '09/2026')), 1,
  'R17: filed August recorded too, open September not');
SELECT public.twob_prior_books_apply(public.t_manager(), :'N', '07/2026',
  jsonb_build_array(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', (public.t_ids(:'N', '07/2026', 'BOI - CC', 1))[1])), false) AS n_again \gset
SELECT public.t_eq((SELECT reversal_cgst FROM public.twob_filed_figures WHERE client_id = :'N' AND period_month = '07/2026'), :'n_live'::numeric,
  'R17: a second change keeps the first record');
SELECT public.t_eq((SELECT COALESCE(sum(input_cgst), 0) FROM public.bills_not_in_2b WHERE client_id = :'N' AND period_month = '07/2026' AND public.twob_label_matches(reversal_month, '07/2026')) < :'n_live'::numeric,
  true, 'R17: while July''s live list moved');
-- An entry reversed in a later, open month is not re-amounted from here.
RESET ROLE;
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  (:'N', '07/2026', '2026-07-29', 'LATE REV', 'L-1', '24LATER0000A1Z5', 100, 9, 9, 'Sep 26', false),
  (:'N', '08/2026', '2026-07-29', 'LATE REV', 'L-1', '24LATER0000A1Z5', 100, 9, 9, 'Sep 26', true),
  (:'N', '09/2026', '2026-07-29', 'LATE REV', 'L-1', '24LATER0000A1Z5', 100, 9, 9, 'Sep 26', true);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_2b", "op": "delete", "id": "%s"}]'::jsonb, false)$q$,
  :'N', (public.t_ids(:'N', '07/2026', 'LATE REV'))[1]),
  'LATE REV L-1: Its reversal month is Sep-26, which is not filed yet; correct it in Sep-26.', 'R17: an entry reversed in open September is refused');
RESET ROLE;
