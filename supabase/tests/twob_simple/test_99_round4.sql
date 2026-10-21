-- The findings of the fourth review round (21 Oct 2026), one block each, as
-- PostgREST runs them (anon). Each block fails on the round-3 version of
-- 20261021100000 (130b199) and passes on this one. The push gate's other
-- reads failing closed, the words of Filing Status and Re-run, and the carry
-- warning Filing Status keeps on a row are app_writes.test.mjs.
\set A '9a000000-0000-0000-0000-000000000001'
\set B '9a000000-0000-0000-0000-000000000002'
\set C '9a000000-0000-0000-0000-000000000003'
\set D '9a000000-0000-0000-0000-000000000004'
\set E '9a000000-0000-0000-0000-000000000005'
\set F '9a000000-0000-0000-0000-000000000006'
\set G '9a000000-0000-0000-0000-000000000007'
\set H '9a000000-0000-0000-0000-000000000008'
\set DOC '9a000000-0000-0000-0000-0000000000d1'

-- ---------------------------------------------------------------------------
-- F1 (medium). Restore of the open month after a GST Manager's correction of
-- a filed month: the correction stays. The month's own entries are restored
-- to the version; its carried entries stay as they stand (the SORATH BOI
-- copies the correction removed do not come back; a copy the door added is
-- not dropped).
-- ---------------------------------------------------------------------------
SELECT public.t_make_sorath(:'A', 'R4 restore after door', true);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
-- September (open) as the page saved it: its current version.
SELECT jsonb_agg(to_jsonb(b) - 'id' - 'client_id' - 'period_month') AS f1_v2b FROM public.bills_not_in_2b b WHERE client_id = :'A' AND period_month = '09/2026' \gset
SELECT COALESCE(jsonb_agg(to_jsonb(b) - 'id' - 'client_id' - 'period_month'), '[]') AS f1_vbk FROM public.bills_not_in_books b WHERE client_id = :'A' AND period_month = '09/2026' \gset
-- The GST Manager removes the 15 BOI entries from filed July and adds a late bill there.
SELECT (public.twob_prior_books_apply(public.t_manager(), :'A', '07/2026',
  (SELECT jsonb_agg(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', x)) FROM unnest(public.t_ids(:'A', '07/2026', 'BOI - CC')) x)
  || '[{"table":"bills_not_in_2b","op":"insert","values":{"date":"2026-07-25","supplier_name":"LATE BILL","supplier_invoice_number":"L-1","supplier_gstin":"24LATEB0000A1Z5","taxable_value":1000,"input_cgst":40,"input_sgst":40,"reversal_month":"Jul 26"}}]'::jsonb,
  false)) ->> 'ok' AS f1_ok \gset
SELECT public.t_eq(:'f1_ok'::boolean, true, 'F1: the door removes the BOI entries and adds L-1 in July');
-- September's own entry typed after that version.
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month)
VALUES (:'A', '09/2026', '2026-09-04', 'SEP NEW', 'S-4', '24SEPNE0000A1Z5', 100, 9, 9, 'Sep 26');
SELECT public.twob_restore_version(public.t_superadmin(), :'A', '09/2026', :'f1_v2b'::jsonb, :'f1_vbk'::jsonb) AS f1_r \gset
SELECT public.t_eq(public.t_count(:'A', '09/2026', 'BOI - CC'), 0, 'F1: the BOI copies the July correction removed do not come back to September');
SELECT public.t_eq(public.t_count(:'A', '09/2026', 'LATE BILL'), 1, 'F1: the copy the door added to September stays');
SELECT public.t_eq(public.t_count(:'A', '09/2026', 'SEP NEW'), 0, 'F1: September''s own entry typed after the version is restored away');
SELECT public.t_eq(public.t_books_side(:'A', '09/2026'), public.t_books_side(:'A', '08/2026'),
  'F1: September''s books side stays equal to August''s (both 8,425 after the correction)');
SELECT public.t_eq(public.t_books_side(:'A', '09/2026'), 8425::numeric, 'F1: ... 8,385 + L-1''s 40');
SELECT public.t_eq((:'f1_r'::jsonb ->> 'carried_kept_2b')::integer,
  (SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'A' AND period_month = '09/2026' AND is_carried_forward),
  'F1: the restore reports the carried entries it kept');
SELECT public.t_raises(format($q$SELECT public.twob_restore_version(public.t_superadmin(), '%s', '09/2026',
  '[{"date":"2026-09-04","supplier_name":"NO FLAG","input_cgst":1,"input_sgst":1}]'::jsonb, '[]'::jsonb)$q$, :'A'),
  'This version does not say which of its entries were carried, so it cannot be restored. Nothing was restored.',
  'F1: a version that does not say which entries were carried is refused');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- F2 and F6 (medium), S6. A carried Not in Books copy in a filed month is
-- neither removed nor re-amounted on its own: its chain may start at an entry
-- from a 2B document (D-7), which never changes in a filed month, and the
-- open month keeps the 2B's pending entry. A typed entry (T-7) is corrected in
-- the month that holds it as its own entry, and the change reaches its copies.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES (:'B', 'R4 S6 copies', '24SSIXB0000A1Z5', true);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, itc_action)
VALUES (:'DOC', :'B', '07/2026', '2026-07-12', 'TWOB SUP', 'D-7', '24TWOBS0000A1Z5', 1000, 90, 90, 'NOT_IN_BOOKS');
INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, bill_in_2b_month, is_carried_forward, source_doc_id) VALUES
  (:'B', '07/2026', '2026-07-12', 'TWOB SUP', 'D-7', '24TWOBS0000A1Z5', 1000, 90, 90, 'Jul 26', false, :'DOC'),
  (:'B', '07/2026', '2026-07-14', 'TYPED SUP', 'T-7', '24TYPED0000A1Z5', 500, 45, 45, 'Jul 26', false, NULL);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'B', 'GSTR-3B', '07/2026', 'Filed');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'B', 'GSTR-3B', '08/2026', 'Filed');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE client_id = :'B' AND supplier_invoice_number = 'D-7'), 3,
  'F2: D-7 is held by July (from its 2B document) and carried into filed August and open September');
SELECT public.twob_prior_books_apply(public.t_manager(), :'B', '08/2026', jsonb_build_array(jsonb_build_object('table', 'bills_not_in_books', 'op', 'delete',
  'id', (SELECT id FROM public.bills_not_in_books WHERE client_id = :'B' AND period_month = '08/2026' AND supplier_invoice_number = 'D-7'))), true) AS f2_del \gset
SELECT public.t_eq((:'f2_del'::jsonb ->> 'ok')::boolean, false, 'F2: removing August''s copy of D-7 through the door is refused');
SELECT public.t_eq(:'f2_del'::jsonb -> 'refusals' -> 0 ->> 'message',
  'This Not in Books entry is carried from an earlier month. In a filed month it changes only in the month that holds it as its own entry, and the change reaches its copies',
  'F2: ... in words');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '08/2026', jsonb_build_array(jsonb_build_object('table', 'bills_not_in_books', 'op', 'update',
  'id', (SELECT id FROM public.bills_not_in_books WHERE client_id = '%s' AND period_month = '08/2026' AND supplier_invoice_number = 'D-7'), 'values', '{"input_cgst": 10, "input_sgst": 10}'::jsonb)), false)$q$, :'B', :'B'),
  'is carried from an earlier month', 'F6: re-amounting it is refused too');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '07/2026', jsonb_build_array(jsonb_build_object('table', 'bills_not_in_books', 'op', 'delete',
  'id', (SELECT id FROM public.bills_not_in_books WHERE client_id = '%s' AND period_month = '07/2026' AND supplier_invoice_number = 'D-7'))), false)$q$, :'B', :'B'),
  'comes from a 2B document', 'F2: July''s entry from the 2B document is refused, as before (S6)');
SELECT public.t_eq((SELECT array_agg(period_month ORDER BY period_month) FROM public.bills_not_in_books WHERE client_id = :'B' AND supplier_invoice_number = 'D-7'),
  ARRAY['07/2026', '08/2026', '09/2026'], 'F2: every month keeps D-7, so open September still waits for its book entry');
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_manager(), '%s', '08/2026', jsonb_build_array(jsonb_build_object('table', 'bills_not_in_books', 'op', 'update',
  'id', (SELECT id FROM public.bills_not_in_books WHERE client_id = '%s' AND period_month = '08/2026' AND supplier_invoice_number = 'T-7'), 'values', '{"supplier_invoice_number": "T-77"}'::jsonb)), false)$q$, :'B', :'B'),
  'is carried from an earlier month', 'F6: a typed entry''s copy is not corrected on its own either');
SELECT public.twob_prior_books_apply(public.t_manager(), :'B', '07/2026', jsonb_build_array(jsonb_build_object('table', 'bills_not_in_books', 'op', 'update',
  'id', (SELECT id FROM public.bills_not_in_books WHERE client_id = :'B' AND period_month = '07/2026' AND supplier_invoice_number = 'T-7'),
  'values', '{"supplier_invoice_number": "T-77"}'::jsonb)), false) -> 'later_months' AS f6_later \gset
SELECT public.t_eq(:'f6_later'::jsonb, '[{"count": 1, "period": "08/2026"}, {"count": 1, "period": "09/2026"}]'::jsonb,
  'F6: corrected in July, its own month, the typed entry''s number reaches August and September');
SELECT public.t_eq((SELECT array_agg(period_month || ':' || supplier_invoice_number ORDER BY period_month) FROM public.bills_not_in_books WHERE client_id = :'B' AND supplier_name = 'TYPED SUP'),
  ARRAY['07/2026:T-77', '08/2026:T-77', '09/2026:T-77'], 'F6: ... every copy holds T-77');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- F3 (low). Re-run's same-supplier-and-amounts pairing: two rent invoices of
-- one landlord at the same amounts (R-07, R-08); October's copy of R-07, its
-- date corrected and reclaimed there, R-08's copy deleted. R-07 pairs with its
-- copy on the number, R-08 is added, whatever the ids' order. With neither
-- number nor date to pair on, both are named and none is added.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES
  (:'C', 'R4 rent, R-07 id last', '24RENTC0000A1Z5', true), (:'D', 'R4 rent, R-07 id first', '24RENTD0000A1Z5', true),
  (:'E', 'R4 rent, no number or date', '24RENTE0000A1Z5', true);
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('9a000000-0000-0000-0000-0000000000f7', :'C', '09/2026', '2026-07-05', 'LANDLORD', 'R-07', '24LANDL0000A1Z5', 10000, 900, 900, 'Jul 26', true),
  ('9a000000-0000-0000-0000-0000000000a8', :'C', '09/2026', '2026-08-05', 'LANDLORD', 'R-08', '24LANDL0000A1Z5', 10000, 900, 900, 'Aug 26', true),
  ('9a000000-0000-0000-0000-0000000000a7', :'D', '09/2026', '2026-07-05', 'LANDLORD', 'R-07', '24LANDL0000A1Z5', 10000, 900, 900, 'Jul 26', true),
  ('9a000000-0000-0000-0000-0000000000f8', :'D', '09/2026', '2026-08-05', 'LANDLORD', 'R-08', '24LANDL0000A1Z5', 10000, 900, 900, 'Aug 26', true),
  ('9a000000-0000-0000-0000-0000000000e7', :'E', '09/2026', '2026-07-05', 'LANDLORD', 'R-07', '24LANDL0000A1Z5', 10000, 900, 900, 'Jul 26', true),
  ('9a000000-0000-0000-0000-0000000000e8', :'E', '09/2026', '2026-08-05', 'LANDLORD', 'R-08', '24LANDL0000A1Z5', 10000, 900, 900, 'Aug 26', true);
-- October (open): the copies as staff left them (C, D: R-07 dated 06-07 and reclaimed; E: numbered R-7X, dated 06-07).
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month, reclaim_month, is_carried_forward) VALUES
  (:'C', '10/2026', '2026-07-06', 'LANDLORD', 'R-07', '24LANDL0000A1Z5', 10000, 900, 900, 'Jul 26', 'Oct 26', true),
  (:'D', '10/2026', '2026-07-06', 'LANDLORD', 'R-07', '24LANDL0000A1Z5', 10000, 900, 900, 'Jul 26', 'Oct 26', true),
  (:'E', '10/2026', '2026-07-06', 'LANDLORD', 'R-7X', '24LANDL0000A1Z5', 10000, 900, 900, 'Jul 26', 'Oct 26', true);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
-- September filed: October already holds carried rows, so the filing carries nothing.
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'C', 'GSTR-3B', '09/2026', 'Filed'), (:'D', 'GSTR-3B', '09/2026', 'Filed'), (:'E', 'GSTR-3B', '09/2026', 'Filed');
SELECT public.twob_carry_rerun(public.t_manager(), :'C', '09/2026', true) -> 'bills_not_in_2b' AS f3_c \gset
SELECT public.twob_carry_rerun(public.t_manager(), :'D', '09/2026', true) -> 'bills_not_in_2b' AS f3_d \gset
SELECT public.t_eq((SELECT array_agg(x ->> 'supplier_invoice_number') FROM jsonb_array_elements(:'f3_c'::jsonb -> 'add') x), ARRAY['R-08'],
  'F3: R-08 is the entry to add (R-07''s id sorts last)');
SELECT public.t_eq((SELECT array_agg(x ->> 'supplier_invoice_number') FROM jsonb_array_elements(:'f3_d'::jsonb -> 'add') x), ARRAY['R-08'],
  'F3: ... and the same when R-07''s id sorts first');
SELECT public.t_eq((SELECT array_agg(x ->> 'supplier_invoice_number') FROM jsonb_array_elements(:'f3_c'::jsonb -> 'conflict') x), ARRAY['R-07'],
  'F3: R-07 is named beside its date-corrected, reclaimed copy');
SELECT public.twob_carry_rerun(public.t_manager(), :'C', '09/2026', false) IS NOT NULL AS f3_applied \gset
SELECT public.t_eq((SELECT array_agg(supplier_invoice_number || '@' || date || COALESCE('/' || reclaim_month, '') ORDER BY supplier_invoice_number)
                      FROM public.bills_not_in_2b WHERE client_id = :'C' AND period_month = '10/2026'),
  ARRAY['R-07@2026-07-06/Oct 26', 'R-08@2026-08-05'], 'F3: October holds R-07 once (reclaimed) and R-08 pending');
SELECT public.t_eq(public.t_books_side(:'C', '10/2026'), 900::numeric, 'F3: October''s books side is R-08''s 900, not the reclaimed R-07 again');
SELECT public.twob_carry_rerun(public.t_manager(), :'E', '09/2026', true) -> 'bills_not_in_2b' AS f3_e \gset
SELECT public.t_eq(:'f3_e'::jsonb -> 'add', '[]'::jsonb, 'F3: with neither number nor date to pair on, nothing is added');
SELECT public.t_eq((SELECT array_agg(x ->> 'supplier_invoice_number' ORDER BY x ->> 'supplier_invoice_number') FROM jsonb_array_elements(:'f3_e'::jsonb -> 'conflict') x),
  ARRAY['R-07', 'R-08'], 'F3: ... and both are named');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- F4, F8, F12 (low) and F7 (medium). A month filed after a later month: the
-- record says its next month counts as filed ('next_prior') when that month
-- was not filed itself, 'next_filed' when it was. Re-run says which, and is
-- recorded, so the warning Filing Status keeps on the row (carried_at NULL)
-- goes; the extension's markFiled leaves the same record.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'F', 'R4 next counts as filed', '24NEXTF0000A1Z5'), (:'G', 'R4 markFiled late', '24LATEG0000A1Z5');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month) VALUES
  (:'F', '07/2026', '2026-07-10', 'JUL OWN', 'J-1', '24JULOW0000A1Z5', 1000, 100, 100, 'Jul 26'),
  (:'G', '07/2026', '2026-07-05', 'J SUPP', 'J-1', '24JSUPP0000A1Z5', 1000, 90, 90, 'Jul 26'),
  (:'G', '08/2026', '2026-08-05', 'A SUPP', 'A-1', '24ASUPP0000A1Z5', 1000, 45, 45, 'Aug 26');
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'F', 'GSTR-3B', '08/2026', 'Data Received'), (:'F', 'GSTR-3B', '09/2026', 'Filed');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'F', 'GSTR-3B', '07/2026', 'Filed');
SELECT public.t_eq((SELECT array_agg(list || ':' || last_outcome || ':' || (carried_at IS NULL) ORDER BY list) FROM public.twob_carry_log WHERE client_id = :'F' AND period_month = '07/2026'),
  ARRAY['bills_not_in_2b:next_prior:true', 'bills_not_in_books:next_prior:true'],
  'F4: July''s record says August only counts as filed (September is), not that August is filed');
SELECT public.twob_carry_rerun(public.t_manager(), :'F', '07/2026', true) AS f4_prev \gset
SELECT public.t_eq((:'f4_prev'::jsonb ->> 'next_filed')::boolean AND NOT (:'f4_prev'::jsonb ->> 'next_own_filed')::boolean, true,
  'F8: Re-run of July says August counts as filed but is not filed itself');
SELECT public.twob_carry_rerun(public.t_manager(), :'F', '07/2026', false) IS NOT NULL AS f4_applied \gset
SELECT public.t_eq((SELECT array_agg(carried_how || ':' || last_outcome || ':' || (carried_at IS NOT NULL) ORDER BY list) FROM public.twob_carry_log WHERE client_id = :'F' AND period_month = '07/2026'),
  ARRAY['rerun:rerun:true', 'rerun:rerun:true'], 'F7: the Re-run is recorded, so July''s row is no longer marked');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'F' AND period_month = '08/2026' AND supplier_invoice_number = 'J-1'), 1,
  'F8: ... and J-1 is in August');
UPDATE public.filing_status SET status = 'Filed' WHERE client_id = :'F' AND period_month = '08/2026';
SELECT public.t_eq((SELECT array_agg(last_outcome ORDER BY list) FROM public.twob_carry_log WHERE client_id = :'F' AND period_month = '08/2026'),
  ARRAY['next_filed', 'next_filed'], 'F12: August, filed after September, says September is filed (it is)');
SELECT public.t_eq((public.twob_carry_rerun(public.t_manager(), :'F', '08/2026', true) ->> 'next_own_filed')::boolean, true,
  'F8: Re-run of August says September is filed itself');
-- July unlocked and filed again: nothing more is carried (the Re-run was its first carry).
UPDATE public.filing_status SET status = 'Prepared Pending', is_locked = false WHERE client_id = :'F' AND period_month = '07/2026';
UPDATE public.filing_status SET status = 'Filed' WHERE client_id = :'F' AND period_month = '07/2026';
SELECT public.t_eq((SELECT array_agg(last_outcome ORDER BY list) FROM public.twob_carry_log WHERE client_id = :'F' AND period_month = '07/2026'),
  ARRAY['done_before', 'done_before'], 'F7: filing July again after its Re-run carries nothing');
-- The extension's markFiled (an upsert) of July, its PDF late, after August was filed.
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'G', 'GSTR-3B', '07/2026', 'Prepared Pending'), (:'G', 'GSTR-3B', '08/2026', 'Filed');
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date)
VALUES (:'G', 'GSTR-3B', '07/2026', 'Filed', 'AA240726123456X', '2026-08-19')
ON CONFLICT (client_id, return_type, period_month) DO UPDATE SET status = EXCLUDED.status, arn = EXCLUDED.arn, filed_date = EXCLUDED.filed_date;
SELECT public.t_eq((SELECT array_agg(list || ':' || last_outcome ORDER BY list) FROM public.twob_carry_log
                     WHERE client_id = :'G' AND period_month = '07/2026' AND carried_at IS NULL),
  ARRAY['bills_not_in_2b:next_filed', 'bills_not_in_books:next_filed'],
  'F7: after the extension''s markFiled, the record Filing Status reads marks July''s lists as not carried');
SELECT public.twob_carry_rerun(public.t_manager(), :'G', '07/2026', false) IS NOT NULL AS f7_applied \gset
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_carry_log WHERE client_id = :'G' AND period_month = '07/2026' AND carried_at IS NULL), 0,
  'F7: ... until a Re-run from July');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- F11 (low). The back-fill records each filed month once per list: a month
-- with both a GSTR-3B and a GSTR-3B (Q) Filed (three clients for 12/2025 on
-- 21 Oct 2026) gives 2 carry-record rows, not 4, as live-apply step 3 counts.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'H', 'R4 both returns', '24BOTHH0000A1Z5');
ALTER TABLE public.filing_status DISABLE TRIGGER USER;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, is_locked, filed_date) VALUES
  (:'H', 'GSTR-3B', '12/2025', 'Filed', true, '2026-01-20'), (:'H', 'GSTR-3B (Q)', '12/2025', 'Filed', true, '2026-01-22');
ALTER TABLE public.filing_status ENABLE TRIGGER USER;
SELECT set_config('twob.write', '', false);
SET ROLE twob_mig_owner;
\ir ../../migrations/20261021100000_twob_prior_month_simple.sql
RESET ROLE;
SET ROLE anon;
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_ever_filed WHERE client_id = :'H'), 2, 'F11: two filed returns recorded');
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_carry_log WHERE client_id = :'H' AND carried_how = 'backfill'),
  (SELECT 2 * count(DISTINCT period_month)::integer FROM public.twob_ever_filed WHERE client_id = :'H'),
  'F11: the carry record holds 2 rows per filed month (2), as step 3 now counts');
RESET ROLE;
