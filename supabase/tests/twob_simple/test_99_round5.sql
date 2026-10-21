-- The findings of the fifth review round (21 Oct 2026), one block each, as
-- PostgREST runs them (anon). Each block fails on the round-4 version of
-- 20261021100000 (da73a98) and passes on this one. The stale open-month
-- Save of 2B Reconciliation, Filing Status's Re-run when it has nothing to
-- add, the words of the new carry outcomes and Suspended Reco's reads are
-- app_writes.test.mjs.
\set A 'a5000000-0000-0000-0000-000000000001'
\set B 'a5000000-0000-0000-0000-000000000002'
\set B2 'a5000000-0000-0000-0000-000000000003'
\set C 'a5000000-0000-0000-0000-000000000004'
\set D 'a5000000-0000-0000-0000-000000000005'
\set E 'a5000000-0000-0000-0000-000000000006'
\set F 'a5000000-0000-0000-0000-000000000007'
\set G 'a5000000-0000-0000-0000-000000000008'
\set H 'a5000000-0000-0000-0000-000000000009'
\set DOC 'a5000000-0000-0000-0000-0000000000d1'

-- ---------------------------------------------------------------------------
-- 1 (medium). Removing an entry and adding it again in one Save (the only way
-- to give it this month's reversal month): it is added, in this month and in
-- the later months whose copies the removal took, never "already held" by
-- rows the same Save removes. The same for an entry renamed away and a new
-- entry with the old number. A Save that keeps the document still notes it.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES (:'A', 'R5 delete and add again', '24RFIVA0000A1Z5', true);
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  (:'A', '07/2026', '2026-04-10', 'SUP', 'K-1', '24SUPPL0000A1Z5', 1000, 100, 100, 'Apr 26', true),
  (:'A', '07/2026', '2026-07-03', 'SUP', 'J-1', '24SUPPL0000A1Z5', 500, 50, 50, 'Jul 26', false);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'A', 'GSTR-3B', '07/2026', 'Filed');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'A', 'GSTR-3B', '08/2026', 'Filed');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'A' AND supplier_invoice_number = 'K-1'), 3,
  '1: K-1 is in July and carried into August and September');
SELECT public.t_books_side(:'A', '09/2026') AS r1_sep_before \gset
SELECT public.twob_prior_books_apply(public.t_manager(), :'A', '07/2026', jsonb_build_array(
  jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete',
    'id', (SELECT id FROM public.bills_not_in_2b WHERE client_id = :'A' AND period_month = '07/2026' AND supplier_invoice_number = 'K-1')),
  jsonb_build_object('table', 'bills_not_in_2b', 'op', 'insert', 'values', jsonb_build_object('date', '2026-04-10', 'supplier_name', 'SUP',
    'supplier_invoice_number', 'K-1', 'supplier_gstin', '24SUPPL0000A1Z5', 'taxable_value', 1000, 'input_cgst', 100, 'input_sgst', 100, 'reversal_month', 'Jul 26'))),
  false) AS r1 \gset
SELECT public.t_eq((:'r1'::jsonb ->> 'ok')::boolean, true, '1: the Save goes through');
SELECT public.t_eq(:'r1'::jsonb -> 'notes', '[]'::jsonb, '1: no note says July already holds K-1');
SELECT public.t_eq((SELECT array_agg(period_month || ':' || reversal_month ORDER BY period_month) FROM public.bills_not_in_2b
                     WHERE client_id = :'A' AND supplier_invoice_number = 'K-1'),
  ARRAY['07/2026:Jul 26', '08/2026:Jul 26', '09/2026:Jul 26'], '1: K-1 is in every month once, with July as its reversal month');
SELECT public.t_eq(public.t_books_side(:'A', '09/2026'), :'r1_sep_before'::numeric, '1: September''s books side is unchanged (K-1 is still pending there)');
-- An entry renamed away (J-1 -> J-9) and a new J-1 in the same Save.
SELECT (public.twob_prior_books_apply(public.t_manager(), :'A', '07/2026', jsonb_build_array(
  jsonb_build_object('table', 'bills_not_in_2b', 'op', 'update',
    'id', (SELECT id FROM public.bills_not_in_2b WHERE client_id = :'A' AND period_month = '07/2026' AND supplier_invoice_number = 'J-1'),
    'values', jsonb_build_object('supplier_invoice_number', 'J-9')),
  jsonb_build_object('table', 'bills_not_in_2b', 'op', 'insert', 'values', jsonb_build_object('date', '2026-07-03', 'supplier_name', 'SUP',
    'supplier_invoice_number', 'J-1', 'supplier_gstin', '24SUPPL0000A1Z5', 'taxable_value', 500, 'input_cgst', 50, 'input_sgst', 50, 'reversal_month', 'Jul 26'))),
  false) -> 'notes') AS r1b \gset
SELECT public.t_eq(:'r1b'::jsonb, '[]'::jsonb, '1: renaming J-1 away and adding a new J-1 in one Save adds it');
SELECT public.t_eq((SELECT array_agg(period_month || ':' || supplier_invoice_number ORDER BY period_month, supplier_invoice_number) FROM public.bills_not_in_2b
                     WHERE client_id = :'A' AND supplier_invoice_number IN ('J-1', 'J-9')),
  ARRAY['07/2026:J-1', '07/2026:J-9', '08/2026:J-1', '08/2026:J-9', '09/2026:J-1', '09/2026:J-9'], '1: ... J-1 and J-9 in every month');
-- A Save that changes J-9's supplier name only (the document stays J-9) and adds J-9 again: noted, not added.
SELECT public.twob_prior_books_apply(public.t_manager(), :'A', '07/2026', jsonb_build_array(
  jsonb_build_object('table', 'bills_not_in_2b', 'op', 'update',
    'id', (SELECT id FROM public.bills_not_in_2b WHERE client_id = :'A' AND period_month = '07/2026' AND supplier_invoice_number = 'J-9'),
    'values', jsonb_build_object('supplier_name', 'SUP RENAMED')),
  jsonb_build_object('table', 'bills_not_in_2b', 'op', 'insert', 'values', jsonb_build_object('date', '2026-07-03', 'supplier_name', 'SUP',
    'supplier_invoice_number', 'J-9', 'supplier_gstin', '24SUPPL0000A1Z5', 'taxable_value', 500, 'input_cgst', 50, 'input_sgst', 50))),
  true) AS r1c \gset
SELECT public.t_eq(:'r1c'::jsonb -> 'notes' -> 0 ->> 'message', 'Jul-26 already holds this entry on its Not in 2B list; it is not added again',
  '1: an entry the Save keeps is still noted as held');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2 and 9 (medium). A list the month holds nothing on has nothing to carry:
-- marked Filed after its next month, it is recorded as carried (0 rows) and
-- no warning stays. AMBER GUM: June, its entries carried into July before
-- this change, marked Filed by the extension after July: the Not in 2B list
-- shows the gap; a Re-run with nothing to add still records it, so the
-- warning goes.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'B', 'R5 empty month', '24RFIVB0000A1Z5'), (:'B2', 'R5 AMBER GUM shape', '24RFIVC0000A1Z5');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  (:'B2', '06/2026', '2026-06-04', 'AMBER SUP', 'AG-1', '24AMBER0000A1Z5', 1000, 90, 90, 'Jun 26', false),
  (:'B2', '07/2026', '2026-06-04', 'AMBER SUP', 'AG-1', '24AMBER0000A1Z5', 1000, 90, 90, 'Jun 26', true);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'B', 'GSTR-3B', '08/2026', 'Filed'), (:'B', 'GSTR-3B', '07/2026', 'Prepared Pending');
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn) VALUES (:'B', 'GSTR-3B', '07/2026', 'Filed', 'AA2407260000001')
ON CONFLICT (client_id, return_type, period_month) DO UPDATE SET status = EXCLUDED.status, arn = EXCLUDED.arn;
SELECT public.t_eq((SELECT array_agg(list || ':' || last_outcome || ':' || (carried_at IS NOT NULL) || ':' || carried_rows ORDER BY list)
                      FROM public.twob_carry_log WHERE client_id = :'B' AND period_month = '07/2026'),
  ARRAY['bills_not_in_2b:carried:true:0', 'bills_not_in_books:carried:true:0'], '2: an empty month filed after its next month counts as carried (nothing to carry)');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'B2', 'GSTR-3B', '07/2026', 'Filed'), (:'B2', 'GSTR-3B', '06/2026', 'Prepared Pending');
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn) VALUES (:'B2', 'GSTR-3B', '06/2026', 'Filed', 'AA2406260000001')
ON CONFLICT (client_id, return_type, period_month) DO UPDATE SET status = EXCLUDED.status, arn = EXCLUDED.arn;
SELECT public.t_eq((SELECT array_agg(list || ':' || last_outcome ORDER BY list) FROM public.twob_carry_log
                     WHERE client_id = :'B2' AND period_month = '06/2026' AND carried_at IS NULL),
  ARRAY['bills_not_in_2b:next_filed'], '9: June''s Not in 2B list shows the gap; its empty Not in Books list does not');
SELECT public.twob_carry_rerun(public.t_manager(), :'B2', '06/2026', true) AS r2_prev \gset
SELECT public.t_eq(jsonb_array_length(:'r2_prev'::jsonb -> 'bills_not_in_2b' -> 'add') + jsonb_array_length(:'r2_prev'::jsonb -> 'bills_not_in_books' -> 'add'), 0,
  '9: Re-run has nothing to add (July holds AG-1)');
SELECT public.twob_carry_rerun(public.t_manager(), :'B2', '06/2026', false) IS NOT NULL AS r2_applied \gset
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_carry_log WHERE client_id = :'B2' AND period_month = '06/2026' AND carried_at IS NULL), 0,
  '9: applied with nothing to add, the Re-run is recorded and the warning goes');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'B2' AND period_month = '07/2026'), 1, '9: ... and July is unchanged');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3 (medium). Restore of a version whose own entry the month now holds as a
-- carried entry (X-9 typed into September, moved to filed July through the
-- door, which carried it back in): the version's own X-9 is left out and
-- named; September holds X-9 once.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES (:'C', 'R5 restore', '24RFIVD0000A1Z5', true);
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month)
VALUES (:'C', '07/2026', '2026-07-03', 'SUP', 'J-1', '24SUPPL0000A1Z5', 1000, 100, 100, 'Jul 26');
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'C', 'GSTR-3B', '07/2026', 'Filed');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'C', 'GSTR-3B', '08/2026', 'Filed');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month)
VALUES (:'C', '09/2026', '2026-07-20', 'SUP', 'X-9', '24SUPPL0000A1Z5', 500, 50, 50, 'Sep 26');
SELECT jsonb_agg(to_jsonb(b) - 'id' - 'client_id' - 'period_month') AS r3_v1 FROM public.bills_not_in_2b b WHERE client_id = :'C' AND period_month = '09/2026' \gset
DELETE FROM public.bills_not_in_2b WHERE client_id = :'C' AND period_month = '09/2026' AND supplier_invoice_number = 'X-9';
SELECT (public.twob_prior_books_apply(public.t_manager(), :'C', '07/2026', jsonb_build_array(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'insert',
  'values', jsonb_build_object('date', '2026-07-20', 'supplier_name', 'SUP', 'supplier_invoice_number', 'X-9', 'supplier_gstin', '24SUPPL0000A1Z5',
    'taxable_value', 500, 'input_cgst', 50, 'input_sgst', 50, 'reversal_month', 'Jul 26'))), false) ->> 'ok')::boolean AS r3_ok \gset
SELECT public.t_eq(:'r3_ok'::boolean, true, '3: X-9 added to July reaches August and September');
SELECT public.t_books_side(:'C', '09/2026') AS r3_before \gset
SELECT public.twob_restore_version(public.t_superadmin(), :'C', '09/2026', :'r3_v1'::jsonb, '[]'::jsonb) AS r3 \gset
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'C' AND period_month = '09/2026' AND supplier_invoice_number = 'X-9'), 1,
  '3: September holds X-9 once after the restore (its carried copy)');
SELECT public.t_eq(public.t_books_side(:'C', '09/2026'), :'r3_before'::numeric, '3: September''s books side does not double');
SELECT public.t_eq(:'r3'::jsonb -> 'left_out' -> 0 ->> 'supplier_invoice_number', 'X-9', '3: the version''s own X-9 is named as left out');
SELECT public.t_eq(:'r3'::jsonb -> 'left_out' -> 0 ->> 'message', 'Sep-26 holds it as a carried entry now, so the version''s own entry is left out', '3: ... in words');
SELECT public.t_eq((:'r3'::jsonb ->> 'bills_not_in_2b')::integer, 0, '3: no own entry restored');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4 and 10 (low). A month marked Filed by mistake, reopened, given another
-- entry and filed for real by the extension's markFiled: it carries nothing
-- again by itself, but its record shows the gap (Filing Status warns), and a
-- Re-run brings the new entry into the next month.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'D', 'R5 reopened', '24RFIVE0000A1Z5');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month)
VALUES (:'D', '07/2026', '2026-07-03', 'J SUPP', 'J-1', '24JSUPP0000A1Z5', 1000, 100, 100, 'Jul 26');
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'D', 'GSTR-3B', '06/2026', 'Filed');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'D', 'GSTR-3B', '07/2026', 'Filed');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'D' AND period_month = '08/2026'), 1, '4: the mistaken filing carried J-1 into August');
UPDATE public.filing_status SET status = 'Prepared Pending', is_locked = false WHERE client_id = :'D' AND period_month = '07/2026';
SELECT public.twob_reopen_filed(public.t_manager(), :'D', 'GSTR-3B', '07/2026', 'Marked Filed by mistake') IS NOT NULL AS r4_reopened \gset
SELECT public.t_eq((SELECT array_agg(last_outcome || ':' || (carried_at IS NULL) || ':' || COALESCE(carried_how, '-') ORDER BY list) FROM public.twob_carry_log WHERE client_id = :'D' AND period_month = '07/2026'),
  ARRAY['reopened:true:carried', 'reopened:true:carried'], '4: the reopen marks July''s carry as undone (how it was carried is kept)');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month)
VALUES (:'D', '07/2026', '2026-07-09', 'K SUPP', 'J-2', '24KSUPP0000A1Z5', 2000, 200, 200, 'Jul 26');
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn) VALUES (:'D', 'GSTR-3B', '07/2026', 'Filed', 'AA2407260000002')
ON CONFLICT (client_id, return_type, period_month) DO UPDATE SET status = EXCLUDED.status, arn = EXCLUDED.arn;
SELECT public.t_eq((SELECT array_agg(list || ':' || last_outcome || ':' || (carried_at IS NULL) ORDER BY list) FROM public.twob_carry_log WHERE client_id = :'D' AND period_month = '07/2026'),
  ARRAY['bills_not_in_2b:refiled:true', 'bills_not_in_books:carried:false'],
  '10: filed for real, July carries nothing again and its Not in 2B list shows the gap (the empty Not in Books list has nothing to carry)');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'D' AND period_month = '08/2026'), 1, '10: ... August still holds only J-1');
SELECT public.twob_carry_rerun(public.t_manager(), :'D', '07/2026', false) -> 'bills_not_in_2b' -> 'add' AS r4_add \gset
SELECT public.t_eq((SELECT array_agg(x ->> 'supplier_invoice_number') FROM jsonb_array_elements(:'r4_add'::jsonb) x), ARRAY['J-2'], '10: Re-run adds J-2 to August');
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_carry_log WHERE client_id = :'D' AND period_month = '07/2026' AND carried_at IS NULL), 0, '10: ... and the warning goes');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5 (low). A December entry (an April bill, reversal Apr 26) carried to
-- April, where it was also typed as April's own entry: removing it in
-- December removes one copy in every later month, April's carried copy and
-- one of the two copies in May and June included; April's own entry and its
-- copies stay.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'E', 'R5 chain pairing', '24RFIVF0000A1Z5');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward)
SELECT :'E', p, '2026-04-05', 'SUP', 'W-1', '24SUPPL0000A1Z5', 1000, 100, 100, 'Apr 26', c
  FROM (VALUES ('12/2025', false), ('01/2026', true), ('02/2026', true), ('03/2026', true), ('04/2026', true), ('04/2026', false),
               ('05/2026', true), ('05/2026', true), ('06/2026', true), ('06/2026', true)) v(p, c);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'E', 'GSTR-3B', '05/2026', 'Filed');
SELECT public.twob_prior_books_apply(public.t_manager(), :'E', '12/2025', jsonb_build_array(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete',
  'id', (SELECT id FROM public.bills_not_in_2b WHERE client_id = :'E' AND period_month = '12/2025'))), false) AS r5 \gset
SELECT public.t_eq(:'r5'::jsonb -> 'later_months',
  '[{"count": 1, "period": "01/2026"}, {"count": 1, "period": "02/2026"}, {"count": 1, "period": "03/2026"}, {"count": 1, "period": "04/2026"}, {"count": 1, "period": "05/2026"}, {"count": 1, "period": "06/2026"}]'::jsonb,
  '5: one copy goes from every later month, April to June included');
SELECT public.t_eq((SELECT array_agg(period_month || ':' || CASE WHEN is_carried_forward THEN 'c' ELSE 'own' END ORDER BY public.twob_period_key(period_month), is_carried_forward)
                      FROM public.bills_not_in_2b WHERE client_id = :'E'),
  ARRAY['04/2026:own', '05/2026:c', '06/2026:c'], '5: April''s own entry stays, with its one copy in May and June');
SELECT public.t_eq(:'r5'::jsonb -> 'notes' -> 0 ->> 'message', 'Apr-26 holds this entry as its own entry too; that entry and its copies stay as they are',
  '5: the preview names April''s own entry');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 6 (low), S6. A carried Not in Books copy in a filed month whose entry is
-- typed, or gone (a chain starting mid-history), is a books entry: it changes
-- through the door, with its later copies. A copy of an invoice an earlier
-- month holds from a 2B document stays refused; twob_nib_2b_copies names it
-- for the screen.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES (:'F', 'R5 orphan copies', '24RFIVG0000A1Z5', true);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, itc_action)
VALUES (:'DOC', :'F', '07/2026', '2026-07-12', 'TWOB SUP', 'D-7', '24TWOBS0000A1Z5', 1000, 90, 90, 'NOT_IN_BOOKS');
INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, bill_in_2b_month, is_carried_forward, source_doc_id) VALUES
  (:'F', '07/2026', '2026-07-12', 'TWOB SUP', 'D-7', '24TWOBS0000A1Z5', 1000, 90, 90, 'Jul 26', false, :'DOC'),
  (:'F', '07/2026', '2026-03-02', 'ORPHAN SUP', 'O-1', '24ORPHA0000A1Z5', 300, 27, 27, 'Mar 26', true, NULL);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'F', 'GSTR-3B', '07/2026', 'Filed');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'F', 'GSTR-3B', '08/2026', 'Filed');
SELECT public.twob_prior_books_apply(public.t_manager(), :'F', '07/2026', jsonb_build_array(jsonb_build_object('table', 'bills_not_in_books', 'op', 'update',
  'id', (SELECT id FROM public.bills_not_in_books WHERE client_id = :'F' AND period_month = '07/2026' AND supplier_invoice_number = 'O-1'),
  'values', '{"input_cgst": 18, "input_sgst": 18}'::jsonb)), false) AS r6 \gset
SELECT public.t_eq((:'r6'::jsonb ->> 'ok')::boolean, true, '6: an orphan carried copy (no entry upstream) is corrected in filed July');
SELECT public.t_eq(:'r6'::jsonb -> 'later_months', '[{"count": 1, "period": "08/2026"}, {"count": 1, "period": "09/2026"}]'::jsonb, '6: ... and the change reaches its copies');
SELECT public.t_eq((SELECT array_agg(DISTINCT input_cgst) FROM public.bills_not_in_books WHERE client_id = :'F' AND supplier_invoice_number = 'O-1'), ARRAY[18::numeric],
  '6: ... every month holds 18');
SELECT public.t_eq(public.twob_nib_2b_copies(:'F', '08/2026'),
  ARRAY(SELECT id FROM public.bills_not_in_books WHERE client_id = :'F' AND period_month = '08/2026' AND supplier_invoice_number = 'D-7'),
  '6: twob_nib_2b_copies names August''s copy of D-7, not the orphan');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '08/2026', jsonb_build_array(jsonb_build_object('table', 'bills_not_in_books', 'op', 'delete',
  'id', (SELECT id FROM public.bills_not_in_books WHERE client_id = '%s' AND period_month = '08/2026' AND supplier_invoice_number = 'D-7'))), false)$q$, :'F', :'F'),
  'is a copy of an entry from a 2B document', '6: August''s copy of D-7 is still refused');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob_nib_2b_copies(uuid, text)', 'EXECUTE'), true, '6: the screen can call twob_nib_2b_copies');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob__nib_follows_2b(uuid, text, jsonb)', 'EXECUTE'), false, '6: anon cannot call twob__nib_follows_2b');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 8 (medium). A Re-run of a month filed late into its filed next month marks
-- that month's list as not carried ('rerun_pending'), so Filing Status warns
-- on it until its own Re-run carries the entries into the open month.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'G', 'R5 two hops', '24RFIVH0000A1Z5');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month) VALUES
  (:'G', '07/2026', '2026-07-05', 'J SUPP', 'J-1', '24JSUPP0000A1Z5', 1000, 90, 90, 'Jul 26'),
  (:'G', '08/2026', '2026-08-05', 'A SUPP', 'A-1', '24ASUPP0000A1Z5', 1000, 90, 90, 'Aug 26');
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'G', 'GSTR-3B', '07/2026', 'Prepared Pending'), (:'G', 'GSTR-3B', '08/2026', 'Filed');
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn) VALUES (:'G', 'GSTR-3B', '07/2026', 'Filed', 'AA2407260000003')
ON CONFLICT (client_id, return_type, period_month) DO UPDATE SET status = EXCLUDED.status, arn = EXCLUDED.arn;
SELECT public.twob_carry_rerun(public.t_manager(), :'G', '07/2026', false) -> 'bills_not_in_2b' -> 'add' AS r8_add \gset
SELECT public.t_eq(jsonb_array_length(:'r8_add'::jsonb), 1, '8: Re-run of July adds J-1 to filed August');
SELECT public.t_eq((SELECT array_agg(list || ':' || last_outcome ORDER BY list) FROM public.twob_carry_log
                     WHERE client_id = :'G' AND period_month = '08/2026' AND carried_at IS NULL),
  ARRAY['bills_not_in_2b:rerun_pending'], '8: August''s Not in 2B list is marked: it has to carry J-1 on');
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_carry_log WHERE client_id = :'G' AND period_month = '07/2026' AND carried_at IS NULL), 0,
  '8: July''s warning goes');
-- Marking August Filed again (its status set back and forth) does not clear the mark.
UPDATE public.filing_status SET status = 'Prepared Pending', is_locked = false WHERE client_id = :'G' AND period_month = '08/2026';
UPDATE public.filing_status SET status = 'Filed' WHERE client_id = :'G' AND period_month = '08/2026';
SELECT public.t_eq((SELECT array_agg(list || ':' || last_outcome ORDER BY list) FROM public.twob_carry_log
                     WHERE client_id = :'G' AND period_month = '08/2026' AND carried_at IS NULL),
  ARRAY['bills_not_in_2b:refiled'], '8: filed again, August still carries nothing by itself and stays marked');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'G' AND period_month = '09/2026' AND supplier_invoice_number = 'J-1'), 0,
  '8: ... September does not get J-1 by itself');
SELECT public.twob_carry_rerun(public.t_manager(), :'G', '08/2026', false) -> 'bills_not_in_2b' -> 'add' AS r8_add2 \gset
SELECT public.t_eq((SELECT array_agg(x ->> 'supplier_invoice_number') FROM jsonb_array_elements(:'r8_add2'::jsonb) x), ARRAY['J-1'], '8: Re-run of August adds J-1 to open September');
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_carry_log WHERE client_id = :'G' AND period_month = '08/2026' AND carried_at IS NULL), 0,
  '8: ... and August''s warning goes');
SELECT public.t_eq(public.t_books_side(:'G', '09/2026'), 180::numeric, '8: September''s books side holds J-1 and A-1');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 12 (medium). Copies whose in-2B month (Not in Books) or reversal month (Not
-- in 2B) was filled in or cleared after the carry are still this entry's
-- copies: a removal in the entry's own month reaches them.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES (:'H', 'R5 changed tags', '24RFIVI0000A1Z5', true);
INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, bill_in_2b_month, is_carried_forward) VALUES
  (:'H', '07/2026', '2026-07-08', 'TYPED SUP', 'T-1', '24TYPED0000A1Z5', 1000, 90, 90, NULL, false),
  (:'H', '08/2026', '2026-07-08', 'TYPED SUP', 'T-1', '24TYPED0000A1Z5', 1000, 90, 90, 'Jul 26', true),
  (:'H', '09/2026', '2026-07-08', 'TYPED SUP', 'T-1', '24TYPED0000A1Z5', 1000, 90, 90, 'Jul 26', true);
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  (:'H', '07/2026', '2026-07-09', 'SKY SUP', 'S-1', '24SKYSU0000A1Z5', 1000, 90, 90, 'Jul 26', false),
  (:'H', '08/2026', '2026-07-09', 'SKY SUP', 'S-1', '24SKYSU0000A1Z5', 1000, 90, 90, 'Jul 26', true),
  (:'H', '09/2026', '2026-07-09', 'SKY SUP', 'S-1', '24SKYSU0000A1Z5', 1000, 90, 90, NULL, true);
INSERT INTO public.filing_status (client_id, return_type, period_month, status, is_locked) VALUES (:'H', 'GSTR-3B', '07/2026', 'Filed', true), (:'H', 'GSTR-3B', '08/2026', 'Filed', true);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.twob_prior_books_apply(public.t_manager(), :'H', '07/2026', jsonb_build_array(
  jsonb_build_object('table', 'bills_not_in_books', 'op', 'delete', 'id', (SELECT id FROM public.bills_not_in_books WHERE client_id = :'H' AND period_month = '07/2026')),
  jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', (SELECT id FROM public.bills_not_in_2b WHERE client_id = :'H' AND period_month = '07/2026'))),
  false) AS r12 \gset
SELECT public.t_eq(:'r12'::jsonb -> 'later_months', '[{"count": 2, "period": "08/2026"}, {"count": 2, "period": "09/2026"}]'::jsonb,
  '12: the removals reach the copies whose in-2B or reversal month changed after the carry');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE client_id = :'H') + (SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'H'), 0,
  '12: ... no month keeps T-1 or S-1');
RESET ROLE;
