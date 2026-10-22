-- TAMNNA (17 Oct 2026, Strict): an invoice corrected in filed July reaches
-- August and September. The correction goes as Import 2B sends it: the books
-- register row saved, then Post's plan (an update of the entry it posted).
-- A September reclaim stops an amount change of another entry, with the
-- message naming the month; a descriptive change of that entry still passes,
-- on the reclaimed copy too.
\set T '40000000-0000-0000-0000-000000000001'
SELECT public.t_make_tamnna(:'T', 'TAMNNA INFRASTRUCTURE-GUJARAT');

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.t_saved_digest(:'T') AS digest_before \gset
SELECT id AS book_id FROM public.books_register WHERE client_id = :'T' AND period_month = '07/2026' \gset
SELECT id AS t1 FROM public.bills_not_in_2b WHERE client_id = :'T' AND period_month = '07/2026' AND supplier_invoice_number = 'T-1' \gset
SELECT id AS t2 FROM public.bills_not_in_2b WHERE client_id = :'T' AND period_month = '07/2026' AND supplier_invoice_number = 'T-2' \gset

-- 1. The books register row (number and amounts corrected).
SELECT public.twob_prior_books_apply(public.t_manager(), :'T', '07/2026', jsonb_build_array(jsonb_build_object(
  'table', 'books_register', 'op', 'update', 'id', :'book_id',
  'values', jsonb_build_object('supplier_invoice_number', 'T-1A', 'taxable_value', 12222.22, 'input_cgst', 1100, 'input_sgst', 1100))), false) AS saved \gset
SELECT public.t_eq((SELECT supplier_invoice_number FROM public.books_register WHERE id = :'book_id'), 'T-1A', 'books register row corrected');
SELECT public.t_eq((:'saved'::jsonb -> 'later_months'), '[]'::jsonb, 'a books register change stays in its month');

-- 2. Post's plan: the entry it posted, updated.
SELECT jsonb_build_array(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'update', 'id', :'t1',
  'values', jsonb_build_object('date', '2026-07-15', 'supplier_name', 'TAMNNA SUPPLIER', 'supplier_invoice_number', 'T-1A',
    'supplier_gstin', '24TSUPP0000A1Z5', 'taxable_value', 12222.22, 'input_igst', 0, 'input_cgst', 1100, 'input_sgst', 1100))) AS post \gset
SELECT public.twob_prior_books_apply(public.t_manager(), :'T', '07/2026', :'post'::jsonb, true) AS preview \gset
SELECT public.t_eq(:'preview'::jsonb -> 'later_months', '[{"count": 1, "period": "08/2026"}, {"count": 1, "period": "09/2026"}]'::jsonb,
  'TAMNNA preview: also changes Aug-26 (1), Sep-26 (1)');
SELECT public.t_eq(:'preview'::jsonb -> 'changes' -> 0 -> 'this' -> 'fields', '["input_cgst", "input_sgst", "taxable_value", "supplier_invoice_number"]'::jsonb,
  'TAMNNA preview: number and amounts change');
SELECT public.twob_prior_books_apply(public.t_manager(), :'T', '07/2026', :'post'::jsonb, false) AS applied \gset
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'T' AND supplier_invoice_number = 'T-1A' AND input_cgst = 1100 AND taxable_value = 12222.22), 3,
  'T-1A at 1,100 in Jul, Aug and Sep-26');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'T' AND supplier_invoice_number = 'T-1'), 0, 'no T-1 left in any month');
SELECT public.t_eq((SELECT reversal_month FROM public.bills_not_in_2b WHERE client_id = :'T' AND period_month = '09/2026' AND supplier_invoice_number = 'T-1A'), 'Jul 26',
  'the copy keeps its reversal month');
SELECT public.t_eq((SELECT source_book_id FROM public.bills_not_in_2b WHERE id = :'t1'), :'book_id'::uuid, 'the July entry keeps its books register link');
SELECT public.t_eq((SELECT updated_by FROM public.bills_not_in_2b WHERE client_id = :'T' AND period_month = '08/2026' AND supplier_invoice_number = 'T-1A'), public.t_manager(),
  'the copies are stamped with who changed them');

-- 3. T-2 is reclaimed on its September copy: its amount cannot change.
SELECT public.twob_prior_books_apply(public.t_manager(), :'T', '07/2026', jsonb_build_array(jsonb_build_object(
  'table', 'bills_not_in_2b', 'op', 'update', 'id', :'t2', 'values', jsonb_build_object('input_cgst', 600, 'input_sgst', 600))), true) AS refused \gset
SELECT public.t_eq((:'refused'::jsonb ->> 'ok')::boolean, false, 'T-2 amount: refused in the preview');
SELECT public.t_eq(:'refused'::jsonb -> 'refusals' -> 0 ->> 'message', 'Sep-26 has reclaimed this entry; undo that reclaim first', 'T-2 amount: the message names Sep-26');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_2b", "op": "update", "id": "%s", "values": {"input_cgst": 600, "input_sgst": 600}}]'::jsonb, false)$q$, :'T', :'t2'),
  'OTHER SUPPLIER T-2: Sep-26 has reclaimed this entry; undo that reclaim first', 'T-2 amount: applying is refused too');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', '[{"table": "bills_not_in_2b", "op": "delete", "id": "%s"}]'::jsonb, false)$q$, :'T', :'t2'),
  'Sep-26 has reclaimed this entry; undo that reclaim first', 'T-2 removal refused');
SELECT public.t_eq((SELECT input_cgst FROM public.bills_not_in_2b WHERE id = :'t2'), 500.00, 'T-2 unchanged');

-- 4. A descriptive change of T-2 passes, on the reclaimed copy too.
SELECT public.twob_prior_books_apply(public.t_manager(), :'T', '07/2026', jsonb_build_array(jsonb_build_object(
  'table', 'bills_not_in_2b', 'op', 'update', 'id', :'t2',
  'values', jsonb_build_object('supplier_name', 'OTHER SUPPLIER LTD', 'supplier_invoice_number', 'T-2/A', 'date', '2026-07-17'))), false) AS described \gset
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'T' AND supplier_name = 'OTHER SUPPLIER LTD'
                     AND supplier_invoice_number = 'T-2/A' AND date = '2026-07-17'), 3, 'T-2 renamed in Jul, Aug and Sep-26');
SELECT public.t_eq((SELECT reclaim_month FROM public.bills_not_in_2b WHERE client_id = :'T' AND period_month = '09/2026' AND supplier_invoice_number = 'T-2/A'), 'Sep 26',
  'the September reclaim stays');
SELECT public.t_eq(public.t_saved_digest(:'T'), :'digest_before', 'nothing saved moved');
RESET ROLE;
