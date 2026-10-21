-- The rules of the one door (twob_prior_books_apply), case by case.
\set R '50000000-0000-0000-0000-000000000001'
SELECT public.t_make_sorath(:'R', 'Rules', true);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT id AS old_a FROM public.bills_not_in_2b WHERE client_id = :'R' AND period_month = '07/2026' AND supplier_name = 'OLD A' \gset
SELECT id AS nib FROM public.bills_not_in_books WHERE client_id = :'R' AND period_month = '07/2026' \gset
SELECT id AS sep_old_a FROM public.bills_not_in_2b WHERE client_id = :'R' AND period_month = '09/2026' AND supplier_name = 'OLD A' \gset

-- Who and where.
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_employee(), '%s', '07/2026', '[]'::jsonb, true)$q$, :'R'),
  'Only a GST Manager or the superadmin can change its books entries', 'an employee is refused, preview too');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(NULL, '%s', '07/2026', '[]'::jsonb, true)$q$, :'R'),
  'Only a GST Manager or the superadmin', 'no acting user: refused');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_superadmin(), '%s', '09/2026', '[]'::jsonb, true)$q$, :'R'),
  'This month is not filed. Save its entries as usual.', 'an open month does not go through the door');
SELECT public.t_ok(format($q$SELECT public.twob_prior_books_apply(public.t_superadmin(), '%s', '07/2026', '[]'::jsonb, true)$q$, :'R'), 'the superadmin may');

-- Months and decisions never change in a prior month, for anyone.
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_superadmin(), '%s', '07/2026', '[{"table": "bills_not_in_2b", "op": "update", "id": "%s", "values": {"reversal_month": "Jul 26"}}]'::jsonb, false)$q$, :'R', :'old_a'),
  'The reversal, reclaim and book entry months of a filed month cannot change.', 'a reversal month change refused');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_superadmin(), '%s', '07/2026', '[{"table": "bills_not_in_2b", "op": "update", "id": "%s", "values": {"reclaim_month": "Jul 26"}}]'::jsonb, false)$q$, :'R', :'old_a'),
  'cannot change', 'a reclaim refused');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_superadmin(), '%s', '07/2026', '[{"table": "bills_not_in_2b", "op": "update", "id": "%s", "values": {"reclaim_month": "Jul 26", "reclaim_subtype": "EXPENSE_OUT"}}]'::jsonb, false)$q$, :'R', :'old_a'),
  'cannot change', 'an Expense out refused');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_books", "op": "update", "id": "%s", "values": {"book_entry_month": "Jul 26"}}]'::jsonb, false)$q$, :'R', :'nib'),
  'cannot change', 'a book entry month refused');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_books", "op": "update", "id": "%s", "values": {"bill_in_2b_month": "Aug 26"}}]'::jsonb, false)$q$, :'R', :'nib'),
  'cannot change', 'an in-2B month refused');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_2b", "op": "insert", "values": {"date": "2026-07-30", "supplier_name": "NEW", "input_cgst": 5, "input_sgst": 5, "reversal_month": "Jul 26", "reclaim_month": "Jul 26"}}]'::jsonb, false)$q$, :'R'),
  'A new entry in a filed month cannot be reclaimed or expensed out.', 'a new entry with a reclaim refused');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "twob_import_docs", "op": "update", "id": "%s", "values": {"itc_action": "MATCHED"}}]'::jsonb, false)$q$, :'R', :'old_a'),
  'Only books entries change in a filed month', 'a 2B document refused');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_2b", "op": "update", "id": "%s", "values": {"input_cgst": 7}}]'::jsonb, false)$q$, :'R', :'sep_old_a'),
  'This entry is not in this month any more', 'a row of another month refused');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_2b", "op": "update", "id": "%s", "values": {"period_month": "09/2026"}}]'::jsonb, false)$q$, :'R', :'old_a'),
  'Only the date, supplier, number, GSTIN and amounts', 'moving through the door refused');

-- A book entry made in August on its copy stops the Not in Books entry's removal.
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_books", "op": "delete", "id": "%s"}]'::jsonb, false)$q$, :'R', :'nib'),
  'NIB SUPPLIER N-1: Aug-26 has booked this entry; undo that book entry first', 'a booked copy stops the removal');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_books", "op": "update", "id": "%s", "values": {"input_cgst": 95}}]'::jsonb, false)$q$, :'R', :'nib'),
  'Aug-26 has booked this entry', 'a booked copy stops an amount change');
SELECT public.t_ok(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_books", "op": "update", "id": "%s", "values": {"supplier_gstin": "24NIBSU0000A1Z6"}}]'::jsonb, false)$q$, :'R', :'nib'),
  'a GSTIN correction passes');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE client_id = :'R' AND supplier_gstin = '24NIBSU0000A1Z6'), 3, 'the GSTIN reaches Aug and Sep-26');

-- Expense out on a copy names it.
RESET ROLE;
SELECT set_config('twob.write', 'system', false);
UPDATE public.bills_not_in_2b SET reclaim_month = 'Sep 26', reclaim_subtype = 'EXPENSE_OUT' WHERE id = :'sep_old_a';
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_2b", "op": "delete", "id": "%s"}]'::jsonb, false)$q$, :'R', :'old_a'),
  'OLD A A-1: Sep-26 has expensed out this entry; undo that first', 'an Expense out on a copy stops the removal');

-- Twins: a removal takes a copy without a decision; when only decided copies remain, it is refused.
RESET ROLE;
SELECT set_config('twob.write', 'system', false);
UPDATE public.bills_not_in_2b SET reclaim_month = 'Sep 26'
 WHERE id = (SELECT id FROM public.bills_not_in_2b WHERE client_id = :'R' AND period_month = '09/2026' AND supplier_name = 'PERFECT INDUSTRIES' ORDER BY id LIMIT 1);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.twob_prior_books_apply(public.t_manager(), :'R', '07/2026', jsonb_build_array(jsonb_build_object(
  'table', 'bills_not_in_2b', 'op', 'delete', 'id', (public.t_ids(:'R', '07/2026', 'PERFECT INDUSTRIES', 1))[1])), false) AS twin1 \gset
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'R' AND period_month = '09/2026' AND supplier_name = 'PERFECT INDUSTRIES'), 1, 'twins: one Sep copy removed');
SELECT public.t_eq((SELECT reclaim_month FROM public.bills_not_in_2b WHERE client_id = :'R' AND period_month = '09/2026' AND supplier_name = 'PERFECT INDUSTRIES'), 'Sep 26',
  'twins: the reclaimed copy stays, the undecided one went');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_2b", "op": "delete", "id": "%s"}]'::jsonb, false)$q$,
  :'R', (public.t_ids(:'R', '07/2026', 'PERFECT INDUSTRIES', 1))[1]),
  'PERFECT INDUSTRIES 19/26-27: Sep-26 has reclaimed this entry; undo that reclaim first', 'twins: only a decided copy left, refused');
SELECT public.t_eq(public.t_count(:'R', '07/2026', 'PERFECT INDUSTRIES'), 1, 'twins: the refused removal left July as it was');

-- One transaction: a refusal anywhere writes nothing.
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_2b", "op": "delete", "id": "%s"}, {"table": "bills_not_in_2b", "op": "delete", "id": "%s"}]'::jsonb, false)$q$,
  :'R', (public.t_ids(:'R', '07/2026', 'BOI - CC', 1))[1], :'old_a'), 'expensed out', 'a refused change in the batch refuses the batch');
SELECT public.t_eq(public.t_count(:'R', '07/2026', 'BOI - CC') + public.t_count(:'R', '09/2026', 'BOI - CC'), 30, 'the batch wrote nothing');

-- An entry added in a prior month gets a carried copy in every later month holding a list.
SELECT public.twob_prior_books_apply(public.t_manager(), :'R', '07/2026', '[{"table": "bills_not_in_2b", "op": "insert", "values": {"date": "2026-07-30", "supplier_name": "MISSED BILL", "supplier_invoice_number": "M-1", "supplier_gstin": "24MISSE0000A1Z5", "taxable_value": 1000, "input_igst": 0, "input_cgst": 90, "input_sgst": 90, "reversal_month": "Jul 26"}}]'::jsonb, false) AS added \gset
SELECT public.t_eq(:'added'::jsonb -> 'later_months', '[{"count": 1, "period": "08/2026"}, {"count": 1, "period": "09/2026"}]'::jsonb, 'added: copies in Aug and Sep-26');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'R' AND supplier_name = 'MISSED BILL' AND reversal_month = 'Jul 26'
                     AND reclaim_month IS NULL AND is_carried_forward = (period_month <> '07/2026')), 3, 'added: Jul entry, Aug and Sep carried copies, same reversal month');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'R' AND supplier_name = 'MISSED BILL' AND period_month = '10/2026'), 0,
  'added: no list made in Oct-26');
SELECT public.t_eq((SELECT bool_and(is_locked) FROM public.bills_not_in_2b WHERE client_id = :'R' AND supplier_name = 'MISSED BILL' AND period_month IN ('07/2026', '08/2026')), true,
  'added: rows in filed months take the filing lock');
SELECT public.t_eq((SELECT is_locked FROM public.bills_not_in_2b WHERE client_id = :'R' AND supplier_name = 'MISSED BILL' AND period_month = '09/2026'), false,
  'added: the open month''s copy is not locked');

-- The books register: added, changed and removed in its month only; never a minus amount.
SELECT public.twob_prior_books_apply(public.t_manager(), :'R', '07/2026', '[{"table": "books_register", "op": "insert", "values": {"date": "2026-07-31", "supplier_name": "BOOKED", "supplier_invoice_number": "K-1", "input_cgst": 10, "input_sgst": 10}}]'::jsonb, false) -> 'changes' -> 0 -> 'this' ->> 'id' AS book \gset
SELECT public.t_eq((SELECT book_treatment FROM public.books_register WHERE id = :'book'), 'NOT_IN_2B', 'books register: added, Not in 2B');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "books_register", "op": "update", "id": "%s", "values": {"input_cgst": -10}}]'::jsonb, false)$q$, :'R', :'book'),
  'Amounts in the books register are never minus.', 'books register: a minus amount refused');
SELECT public.t_ok(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "books_register", "op": "update", "id": "%s", "values": {"book_treatment": "NOT_ELIGIBLE", "doc_type": "DEBIT_NOTE"}}]'::jsonb, false)$q$, :'R', :'book'),
  'books register: treatment and type changed');
SELECT public.t_ok(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "books_register", "op": "delete", "id": "%s"}]'::jsonb, false)$q$, :'R', :'book'),
  'books register: removed');
SELECT public.t_eq((SELECT count(*)::integer FROM public.books_register WHERE id = :'book'), 0, 'books register: gone');
RESET ROLE;
