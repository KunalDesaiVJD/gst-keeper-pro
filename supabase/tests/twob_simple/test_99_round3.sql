-- The findings of the third review round and the lead's decisions S1 to S7
-- (21 Oct 2026), one block each, as PostgREST runs them (anon). Each block
-- fails on the round-2 version of 20261021100000 (9f850ed) and passes on
-- this one. The push gate failing closed (S4) and the Post plan (S6, F15)
-- are app_writes.test.mjs; the six-month door timing is test_80.
\set A '99000000-0000-0000-0000-000000000001'
\set B '99000000-0000-0000-0000-000000000002'
\set C '99000000-0000-0000-0000-000000000003'
\set D '99000000-0000-0000-0000-000000000004'
\set E '99000000-0000-0000-0000-000000000005'
\set F '99000000-0000-0000-0000-000000000006'
\set G '99000000-0000-0000-0000-000000000007'
\set H '99000000-0000-0000-0000-000000000008'
\set N '99000000-0000-0000-0000-000000000009'
\set J '99000000-0000-0000-0000-00000000000a'
\set K '99000000-0000-0000-0000-00000000000b'
\set R '99000000-0000-0000-0000-00000000000c'
\set V '99000000-0000-0000-0000-00000000000d'

-- ---------------------------------------------------------------------------
-- F1 (high), S1. Marking a month Filed again never brings back an entry the
-- next month removed: the first carry is recorded (twob_carry_log) and never
-- made twice; nothing is carried into a filed month.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES
  (:'A', 'F1 refile, Aug filed', '24FONEA0000A1Z5', true), (:'B', 'F1 refile, Aug open', '24FONEB0000A1Z5', true);
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward)
SELECT c, m.p, m.d, m.s, m.n, m.g, 1000, m.x, m.x, m.l, false
  FROM unnest(ARRAY[:'A', :'B']::uuid[]) c,
       (VALUES ('07/2026', date '2026-07-10', 'JUL SUP', 'J-1', '24JULSU0000A1Z5', 90, 'Jul 26'),
               ('08/2026', date '2026-08-05', 'AUG SUP', 'A-1', '24AUGSU0000A1Z5', 45, 'Aug 26')) m(p, d, s, n, g, x, l);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'A', 'GSTR-3B', '07/2026', 'Filed'), (:'B', 'GSTR-3B', '07/2026', 'Filed');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'A' AND period_month = '08/2026' AND supplier_invoice_number = 'J-1'), 1,
  'F1: filing July carries J-1 into August');
-- August (open) removes J-1's copy: it turned up in August's 2B.
DELETE FROM public.bills_not_in_2b WHERE client_id IN (:'A', :'B') AND period_month = '08/2026' AND supplier_invoice_number = 'J-1';
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'A', 'GSTR-3B', '08/2026', 'Filed');
SELECT public.t_books_side(:'A', '08/2026') AS f1_aug \gset
SELECT public.t_books_side(:'A', '09/2026') AS f1_sep \gset
-- Unlock sheets and Filed again (Filing Status), and the extension's markFiled re-sending Filed.
UPDATE public.filing_status SET status = 'Prepared Pending', is_locked = false, filed_date = NULL WHERE client_id IN (:'A', :'B') AND period_month = '07/2026';
UPDATE public.filing_status SET status = 'Filed' WHERE client_id IN (:'A', :'B') AND period_month = '07/2026';
UPDATE public.filing_status SET status = 'Prepared Pending', is_locked = false WHERE client_id = :'B' AND period_month = '07/2026';
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn) VALUES (:'B', 'GSTR-3B', '07/2026', 'Filed', 'AA2407260000001')
ON CONFLICT (client_id, return_type, period_month) DO UPDATE SET status = EXCLUDED.status, arn = EXCLUDED.arn;
SELECT public.t_eq((SELECT array_agg(supplier_invoice_number ORDER BY supplier_invoice_number) FROM public.bills_not_in_2b WHERE client_id = :'A' AND period_month = '08/2026'),
  ARRAY['A-1'], 'F1: re-filing July does not bring J-1 back into filed August');
SELECT public.t_eq((SELECT array_agg(supplier_invoice_number ORDER BY supplier_invoice_number) FROM public.bills_not_in_2b WHERE client_id = :'A' AND period_month = '09/2026'),
  ARRAY['A-1'], 'F1: ... nor into open September');
SELECT public.t_eq(public.t_books_side(:'A', '08/2026') + public.t_books_side(:'A', '09/2026'), :'f1_aug'::numeric + :'f1_sep'::numeric,
  'F1: the Suspended Reco books side of August and September unchanged');
SELECT public.t_eq((SELECT array_agg(supplier_invoice_number ORDER BY supplier_invoice_number) FROM public.bills_not_in_2b WHERE client_id = :'B' AND period_month = '08/2026'),
  ARRAY['A-1'], 'F1: with August open, re-filing July (and markFiled again) brings nothing back');
SELECT public.t_eq((SELECT array_agg(last_outcome ORDER BY list) FROM public.twob_carry_log WHERE client_id = :'A' AND period_month = '07/2026'),
  ARRAY['done_before', 'done_before'], 'F1: the carry record says July was carried before');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- F2 and F7 (high, medium), S1. Filings out of order carry nothing by
-- themselves; Re-run (a GST Manager, previewed) repairs them one month at a
-- time: into a filed month it only adds, its figures recorded first.
-- (a) x1: Sep filed, then Jul, then Aug. (b) x6 / p5: Aug filed first, a
-- July entry added through the door, then Jul filed.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'C', 'F7 out of order', '24FSEVC0000A1Z5'), (:'D', 'F2 door then late', '24FTWOD0000A1Z5');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  (:'C', '07/2026', '2026-07-10', 'JUL OWN', 'J-1', '24JULOW0000A1Z5', 1000, 100, 100, 'Jul 26', false),
  (:'C', '08/2026', '2026-08-10', 'AUG OWN', 'A-1', '24AUGOW0000A1Z5', 1000, 200, 200, 'Aug 26', false),
  (:'C', '09/2026', '2026-09-10', 'SEP OWN', 'S-1', '24SEPOW0000A1Z5', 1000, 300, 300, 'Sep 26', false),
  (:'D', '07/2026', '2026-07-10', 'JUL PENDING', 'P-1', '24JULPE0000A1Z5', 1000, 10, 10, 'Jul 26', false),
  (:'D', '07/2026', '2026-07-11', 'JUL PENDING', 'P-2', '24JULPE0000A1Z5', 1000, 20, 20, 'Jul 26', false),
  (:'D', '08/2026', '2026-08-10', 'AUG OWN', 'A-1', '24AUGOW0000A1Z5', 1000, 40, 40, 'Aug 26', false);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'C', 'GSTR-3B', '09/2026', 'Filed');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'C', 'GSTR-3B', '07/2026', 'Filed');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'C', 'GSTR-3B', '08/2026', 'Filed');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'C' AND is_carried_forward), 1,
  'F7: of the three filings only September''s (in order) carried, into October');
SELECT public.t_eq((SELECT array_agg(period_month || ':' || last_outcome ORDER BY period_month) FROM public.twob_carry_log WHERE client_id = :'C' AND list = 'bills_not_in_2b'),
  ARRAY['07/2026:next_prior', '08/2026:next_filed', '09/2026:carried'], 'F7: the carry record says why July and August carried nothing (round 4: August only counted as filed when July was filed)');
SELECT public.t_raises(format($q$SELECT public.twob_carry_rerun(public.t_employee(), '%s', '07/2026', true)$q$, :'C'),
  'Only a GST Manager or the superadmin', 'F7: an employee cannot re-run');
SELECT public.twob_carry_rerun(public.t_manager(), :'C', '07/2026', true) AS f7_prev \gset
SELECT public.t_eq((:'f7_prev'::jsonb ->> 'next_filed')::boolean AND jsonb_array_length(:'f7_prev'::jsonb -> 'bills_not_in_2b' -> 'add') = 1, true,
  'F7: Re-run of July previews adding J-1 to filed August');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'C' AND period_month = '08/2026'), 1, 'F7: the preview wrote nothing');
SELECT public.twob_carry_rerun(public.t_manager(), :'C', '07/2026', false) IS NOT NULL AS f7_a \gset
SELECT public.twob_carry_rerun(public.t_manager(), :'C', '08/2026', false) IS NOT NULL AS f7_b \gset
SELECT public.twob_carry_rerun(public.t_manager(), :'C', '09/2026', false) IS NOT NULL AS f7_c \gset
SELECT public.t_eq((SELECT array_agg(supplier_invoice_number ORDER BY supplier_invoice_number) FROM public.bills_not_in_2b WHERE client_id = :'C' AND period_month = '10/2026'),
  ARRAY['A-1', 'J-1', 'S-1'], 'F7: after Re-run of July, August and September, open October holds all three');
SELECT public.t_eq(public.t_books_side(:'C', '10/2026'), 600::numeric, 'F7: October''s books side 100 + 200 + 300');
SELECT public.t_eq((SELECT array_agg(period_month ORDER BY period_month) FROM public.twob_filed_figures WHERE client_id = :'C'),
  ARRAY['08/2026', '09/2026'], 'F7: the figures of filed August and September recorded before Re-run added to them');
SELECT public.t_eq((SELECT reversal_cgst FROM public.twob_filed_figures WHERE client_id = :'C' AND period_month = '09/2026'), 300::numeric,
  'F7: September''s 4B(2)(i) as filed (its own entry only)');
-- (b) August filed first; a GST Manager adds a July bill through the door (it reaches August and September); July filed later.
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'D', 'GSTR-3B', '08/2026', 'Filed');
SELECT public.twob_prior_books_apply(public.t_manager(), :'D', '07/2026',
  '[{"table":"bills_not_in_2b","op":"insert","values":{"date":"2026-07-12","supplier_name":"JUL DOOR","supplier_invoice_number":"P-3","supplier_gstin":"24JULDO0000A1Z5","taxable_value":1000,"input_cgst":30,"input_sgst":30,"reversal_month":"Jul 26"}}]'::jsonb,
  false) -> 'later_months' AS f2_door \gset
SELECT public.t_eq(:'f2_door'::jsonb, '[{"count": 1, "period": "08/2026"}, {"count": 1, "period": "09/2026"}]'::jsonb, 'F2: the door''s July bill reaches August and September');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'D', 'GSTR-3B', '07/2026', 'Filed');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'D' AND supplier_name = 'JUL PENDING' AND period_month <> '07/2026'), 0,
  'F2: filing July after August carries nothing by itself');
SELECT public.twob_carry_rerun(public.t_manager(), :'D', '07/2026', false) -> 'bills_not_in_2b' -> 'add' AS f2_add \gset
SELECT public.t_eq((SELECT array_agg(x ->> 'supplier_invoice_number' ORDER BY x ->> 'supplier_invoice_number') FROM jsonb_array_elements(:'f2_add'::jsonb) x),
  ARRAY['P-1', 'P-2'], 'F2: Re-run of July adds P-1 and P-2 to August, beside the door''s P-3 (not added twice)');
SELECT public.twob_carry_rerun(public.t_manager(), :'D', '08/2026', false) IS NOT NULL AS f2_b \gset
SELECT public.t_eq((SELECT array_agg(supplier_invoice_number ORDER BY supplier_invoice_number) FROM public.bills_not_in_2b WHERE client_id = :'D' AND period_month = '09/2026'),
  ARRAY['A-1', 'P-1', 'P-2', 'P-3'], 'F2: ... and Re-run of August carries them into open September');
SELECT public.t_eq(public.t_books_side(:'D', '09/2026'), 100::numeric, 'F2: September''s books side 10 + 20 + 30 + 40');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- F4 (low). Re-run does not add an entry again beside its reclaimed copy
-- whose GSTIN was corrected in the open month.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES (:'E', 'F4 gstin corrected', '24FFOUR0000A1Z5', true);
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward)
VALUES (:'E', '08/2026', '2026-08-03', 'SUP E', 'E-1', '24SUPEE0000A1Z5', 1000, 90, 90, 'Aug 26', false);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'E', 'GSTR-3B', '08/2026', 'Filed');
UPDATE public.bills_not_in_2b SET supplier_gstin = '24SUPEF0000A1Z5', reclaim_month = 'Sep 26'
 WHERE client_id = :'E' AND period_month = '09/2026' AND supplier_invoice_number = 'E-1';
SELECT public.t_books_side(:'E', '09/2026') AS f4_books \gset
SELECT public.twob_carry_rerun(public.t_manager(), :'E', '08/2026', true) -> 'bills_not_in_2b' AS f4 \gset
SELECT public.t_eq(:'f4'::jsonb -> 'add', '[]'::jsonb, 'F4: E-1 is not added beside its reclaimed copy');
SELECT public.t_eq((:'f4'::jsonb -> 'conflict' -> 0 ->> 'message') LIKE 'Sep-26''s copy from SUP E 24SUPEF0000A1Z5 has the same number, date and amounts and holds a decision%', true,
  'F4: the copy with the corrected GSTIN is named');
SELECT public.twob_carry_rerun(public.t_manager(), :'E', '08/2026', false) IS NOT NULL AS f4_done \gset
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'E' AND period_month = '09/2026'), 1, 'F4: September still holds E-1 once');
SELECT public.t_eq(public.t_books_side(:'E', '09/2026'), :'f4_books'::numeric, 'F4: September''s books side unchanged (the reclaimed invoice is not pending again)');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- F5 (low), S2. Twins differing only in their reversal month: removing one
-- removes the later copy of that one (the key holds the reversal month).
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'F', 'F5 twins by reversal', '24FFIVE0000A1Z5');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('99000000-0000-0000-0000-0000000000a1', :'F', '07/2026', '2026-07-05', 'TWIN SUP', 'T-9', '24TWINS0000A1Z5', 1000, 90, 90, 'Jul 26', false),
  ('99000000-0000-0000-0000-0000000000a2', :'F', '07/2026', '2026-07-05', 'TWIN SUP', 'T-9', '24TWINS0000A1Z5', 1000, 90, 90, NULL, false),
  ('99000000-0000-0000-0000-0000000000c1', :'F', '08/2026', '2026-07-05', 'TWIN SUP', 'T-9', '24TWINS0000A1Z5', 1000, 90, 90, 'Jul 26', true),
  ('99000000-0000-0000-0000-0000000000c2', :'F', '08/2026', '2026-07-05', 'TWIN SUP', 'T-9', '24TWINS0000A1Z5', 1000, 90, 90, NULL, true);
INSERT INTO public.filing_status (client_id, return_type, period_month, status, is_locked) VALUES (:'F', 'GSTR-3B', '07/2026', 'Filed', true);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.twob_prior_books_apply(public.t_manager(), :'F', '07/2026',
  '[{"table":"bills_not_in_2b","op":"delete","id":"99000000-0000-0000-0000-0000000000a2"}]'::jsonb, false) -> 'changes' -> 0 -> 'later' AS f5 \gset
SELECT public.t_eq(:'f5'::jsonb -> 0 ->> 'id', '99000000-0000-0000-0000-0000000000c2', 'F5: the blank-reversal twin''s copy goes');
SELECT public.t_eq(public.t_books_side(:'F', '08/2026'), 90::numeric, 'F5: August keeps the reversed copy (books side 90, as July''s)');
SELECT public.t_eq(public.t_books_side(:'F', '07/2026'), 90::numeric, 'F5: July''s books side 90');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- F8 (medium), S3. An entry added to a filed month reaches the open month
-- even when no later month holds a list yet; the next filing carries it on.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'G', 'F8 door reach', '24FEIGH0000A1Z5');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward)
VALUES (:'G', '08/2026', '2026-08-03', 'AUG OWN', 'A-1', '24AUGOW0000A1Z5', 1000, 40, 40, 'Aug 26', false);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'G', 'GSTR-3B', '07/2026', 'Filed');
SELECT public.twob_prior_books_apply(public.t_manager(), :'G', '07/2026',
  '[{"table":"bills_not_in_2b","op":"insert","values":{"date":"2026-07-28","supplier_name":"LATE BILL","supplier_invoice_number":"L-1","supplier_gstin":"24LATEB0000A1Z5","taxable_value":5000,"input_cgst":500,"input_sgst":500,"reversal_month":"Jul 26"}}]'::jsonb,
  true) AS f8_prev \gset
SELECT public.t_eq(:'f8_prev'::jsonb -> 'later_months', '[{"count": 1, "period": "08/2026"}]'::jsonb, 'F8: the preview names August, the open month');
SELECT public.twob_prior_books_apply(public.t_manager(), :'G', '07/2026',
  '[{"table":"bills_not_in_2b","op":"insert","values":{"date":"2026-07-28","supplier_name":"LATE BILL","supplier_invoice_number":"L-1","supplier_gstin":"24LATEB0000A1Z5","taxable_value":5000,"input_cgst":500,"input_sgst":500,"reversal_month":"Jul 26"}}]'::jsonb,
  false) IS NOT NULL AS f8_done \gset
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'G', 'GSTR-3B', '08/2026', 'Filed');
SELECT public.t_eq((SELECT array_agg(supplier_invoice_number ORDER BY supplier_invoice_number) FROM public.bills_not_in_2b WHERE client_id = :'G' AND period_month = '09/2026'),
  ARRAY['A-1', 'L-1'], 'F8: filing August carries LATE BILL on into September');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- F10 (low), S6. A filed month's Not in Books entry from a 2B document is
-- neither changed nor removed through the door; one typed without a 2B
-- source is, with its later copies.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES (:'H', 'F10 NIB from 2B', '24FTENH0000A1Z5', true);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, itc_action)
VALUES ('99000000-0000-0000-0000-0000000000d7', :'H', '07/2026', '2026-07-07', 'DOC SUP', 'D-7', '24DOCSU0000A1Z5', 1000, 0, 90, 90, 'NOT_IN_BOOKS');
INSERT INTO public.bills_not_in_books (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, bill_in_2b_month, source_doc_id) VALUES
  ('99000000-0000-0000-0000-0000000000b7', :'H', '07/2026', '2026-07-07', 'DOC SUP', 'D-7', '24DOCSU0000A1Z5', 1000, 90, 90, 'Jul 26', '99000000-0000-0000-0000-0000000000d7'),
  ('99000000-0000-0000-0000-0000000000b8', :'H', '07/2026', '2026-07-08', 'TYPED SUP', 'Y-1', '24TYPED0000A1Z5', 500, 45, 45, 'Jul 26', NULL);
SELECT public.t_copy_month(:'H', '07/2026', '08/2026');
SELECT public.t_copy_month(:'H', '07/2026', '09/2026');
INSERT INTO public.filing_status (client_id, return_type, period_month, status, is_locked) VALUES (:'H', 'GSTR-3B', '07/2026', 'Filed', true), (:'H', 'GSTR-3B', '08/2026', 'Filed', true);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.t_eq(public.twob_prior_books_apply(public.t_manager(), :'H', '07/2026',
  '[{"table":"bills_not_in_books","op":"update","id":"99000000-0000-0000-0000-0000000000b7","values":{"input_cgst":80,"input_sgst":80}}]'::jsonb, true) -> 'refusals' -> 0 ->> 'message',
  'This Not in Books entry comes from a 2B document and follows the filed 2B, so it is neither changed nor removed in a filed month. Only books entries change in a filed month',
  'F10: editing a Not in Books entry from a 2B document is refused');
SELECT public.t_eq((public.twob_prior_books_apply(public.t_manager(), :'H', '07/2026',
  '[{"table":"bills_not_in_books","op":"delete","id":"99000000-0000-0000-0000-0000000000b7"}]'::jsonb, true) -> 'refusals' -> 0 ->> 'message') LIKE 'This Not in Books entry comes from a 2B document%', true,
  'F10: ... and so is removing it');
SELECT public.twob_prior_books_apply(public.t_manager(), :'H', '07/2026',
  '[{"table":"bills_not_in_books","op":"update","id":"99000000-0000-0000-0000-0000000000b8","values":{"input_cgst":40,"input_sgst":40}}]'::jsonb, false) -> 'later_months' AS f10_typed \gset
SELECT public.t_eq(:'f10_typed'::jsonb, '[{"count": 1, "period": "08/2026"}, {"count": 1, "period": "09/2026"}]'::jsonb, 'F10: a typed Not in Books entry changes, with its copies');
SELECT public.t_eq((SELECT array_agg(DISTINCT input_cgst) FROM public.bills_not_in_books WHERE client_id = :'H' AND supplier_invoice_number = 'D-7'), ARRAY[90::numeric],
  'F10: D-7 stays as filed in every month');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- F12 (high), S2. NAVRATNA: April 2026 bills typed into filed Dec-25 (reversal
-- Apr 26), entered again in Apr-26 as its own entries and carried May to
-- Oct-26 (one reclaimed in filed Sep-26). Removing a December entry changes
-- only December (and its own copies before April), never April's entry or
-- its copies, and April's decisions do not refuse it.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'N', 'F12 wrong month', '24FTWEL0000A1Z5');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month, reclaim_month, is_carried_forward)
SELECT :'N', to_char(date '2025-12-01' + make_interval(months => k), 'MM/YYYY'), x.d, x.s, x.n, x.g, 68750, 6187.5, 6187.5, 'Apr 26',
       CASE WHEN x.n = '01/26-27' AND k >= 9 THEN 'Sep 26' END,
       NOT (k = 0 OR k = 4)
  FROM generate_series(0, 10) k,
       (VALUES (date '2026-04-15', 'V J DESAI', '38/2026-27', '24VJDES0000A1Z5'), (date '2026-04-16', 'AADARSH', '01/26-27', '24AADAR0000A1Z5')) x(d, s, n, g)
 WHERE k = 0 OR k >= 4 OR (k BETWEEN 1 AND 2 AND x.n = '38/2026-27');
INSERT INTO public.filing_status (client_id, return_type, period_month, status, is_locked) VALUES (:'N', 'GSTR-3B', '09/2026', 'Filed', true);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT id AS f12_vj FROM public.bills_not_in_2b WHERE client_id = :'N' AND period_month = '12/2025' AND supplier_invoice_number = '38/2026-27' \gset
SELECT id AS f12_aa FROM public.bills_not_in_2b WHERE client_id = :'N' AND period_month = '12/2025' AND supplier_invoice_number = '01/26-27' \gset
SELECT count(*) AS f12_from_apr FROM public.bills_not_in_2b WHERE client_id = :'N' AND public.twob_period_key(period_month) >= public.twob_period_key('04/2026') \gset
SELECT public.twob_prior_books_apply(public.t_manager(), :'N', '12/2025',
  jsonb_build_array(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', :'f12_vj'),
                    jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', :'f12_aa')), false) AS f12 \gset
SELECT public.t_eq((:'f12'::jsonb ->> 'ok')::boolean, true, 'F12: April''s reclaim in September does not refuse removing December''s entry');
SELECT public.t_eq(:'f12'::jsonb -> 'later_months', '[{"count": 1, "period": "01/2026"}, {"count": 1, "period": "02/2026"}]'::jsonb,
  'F12: only December''s own copies (Jan and Feb-26) go with it');
SELECT public.t_eq(:'f12'::jsonb -> 'notes' -> 0 ->> 'message', 'Apr-26 holds this entry as its own entry, so Apr-26 and the months after it are left as they are',
  'F12: the preview says where it stops');
SELECT public.t_eq((SELECT count(*) FROM public.bills_not_in_2b WHERE client_id = :'N' AND public.twob_period_key(period_month) >= public.twob_period_key('04/2026')), :'f12_from_apr'::bigint,
  'F12: April''s entries and their copies to October all stay');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'N' AND public.twob_period_key(period_month) < public.twob_period_key('04/2026')), 0,
  'F12: December to March hold nothing now');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- F13 (medium), S1. Nothing carries into a filed month by itself: (a) a
-- prior month never filed (NAVRATNA Dec-25), marked Filed by the extension's
-- markFiled, carries nothing into filed January; (b) a month filed in order
-- whose next month's list staff emptied (V J DESAI), filed again, carries
-- nothing back.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'J', 'F13 unfiled prior', '24FTHIJ0000A1Z5'), (:'K', 'F13 emptied list', '24FTHIK0000A1Z5');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month)
VALUES (:'J', '12/2025', '2026-04-15', 'APRIL BILL', 'AB-1', '24APRIL0000A1Z5', 10000, 900, 900, 'Apr 26');
INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, bill_in_2b_month)
SELECT :'K', '06/2026', date '2026-06-01' + g, 'NIB ' || g, 'K-' || g, '24NIBKK0000A1Z5', 100, 9, 9, 'Jun 26' FROM generate_series(1, 12) g;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, is_locked) VALUES
  (:'J', 'GSTR-3B', '01/2026', 'Filed', true), (:'J', 'GSTR-3B', '02/2026', 'Filed', true), (:'J', 'GSTR-3B', '12/2025', 'Prepared Pending', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status, is_locked) VALUES (:'K', 'GSTR-3B', '06/2026', 'Filed', true);
DELETE FROM public.bills_not_in_books WHERE client_id = :'K' AND period_month = '07/2026';
INSERT INTO public.filing_status (client_id, return_type, period_month, status, is_locked) VALUES (:'K', 'GSTR-3B', '07/2026', 'Filed', true);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn) VALUES (:'J', 'GSTR-3B', '12/2025', 'Filed', 'AA2412250000001')
ON CONFLICT (client_id, return_type, period_month) DO UPDATE SET status = EXCLUDED.status, arn = EXCLUDED.arn;
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'J' AND period_month <> '12/2025'), 0,
  'F13: markFiled of December carries nothing into filed January or further');
UPDATE public.filing_status SET status = 'Prepared Pending', is_locked = false WHERE client_id = :'K' AND period_month = '06/2026';
UPDATE public.filing_status SET status = 'Filed' WHERE client_id = :'K' AND period_month = '06/2026';
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE client_id = :'K' AND period_month <> '06/2026'), 0,
  'F13: re-filing June brings nothing back into July''s emptied list');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- S1 back-fill. A month filed before this change counts as carried: filed
-- again after Unlock sheets, it carries nothing into its open next month,
-- whose carried list staff had emptied before the change.
-- ---------------------------------------------------------------------------
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'V', 'S1 back-fill', '24SONEV0000A1Z5');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, reversal_month)
VALUES (:'V', '08/2026', '2026-08-08', 'OLD AUG', 'V-1', '24OLDAU0000A1Z5', 1000, 90, 90, 'Aug 26');
ALTER TABLE public.filing_status DISABLE TRIGGER USER;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, is_locked, filed_date) VALUES (:'V', 'GSTR-3B', '08/2026', 'Filed', true, '2026-09-20');
ALTER TABLE public.filing_status ENABLE TRIGGER USER;
SELECT set_config('twob.write', '', false);
-- This change applied after that filing (as live): the back-fill records it.
SET ROLE twob_mig_owner;
\ir ../../migrations/20261021100000_twob_prior_month_simple.sql
RESET ROLE;
SET ROLE anon;
UPDATE public.filing_status SET status = 'Prepared Pending', is_locked = false WHERE client_id = :'V' AND period_month = '08/2026';
UPDATE public.filing_status SET status = 'Filed' WHERE client_id = :'V' AND period_month = '08/2026';
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'V' AND period_month = '09/2026'), 0,
  'S1: filed again, August carries nothing into September');
SELECT public.t_eq((SELECT array_agg(carried_how || '/' || last_outcome ORDER BY list) FROM public.twob_carry_log WHERE client_id = :'V' AND period_month = '08/2026'),
  ARRAY['backfill/done_before', 'backfill/done_before'], 'S1: August, filed before the change, was recorded as carried');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- S5. Restore (twob_restore_version): the superadmin only, an open month
-- only, and only the client's latest month that holds entries; it replaces
-- the month's two lists in one call, decided carried rows included.
-- ---------------------------------------------------------------------------
SELECT public.t_make_tamnna(:'R', 'S5 restore');
SET ROLE anon;
SELECT public.t_raises(format($q$SELECT public.twob_restore_version(public.t_manager(), '%s', '09/2026', '[]'::jsonb, '[]'::jsonb)$q$, :'R'),
  'Only the superadmin can restore a version.', 'S5: a GST Manager cannot restore');
SELECT public.t_raises(format($q$SELECT public.twob_restore_version(public.t_superadmin(), '%s', '08/2026', '[]'::jsonb, '[]'::jsonb)$q$, :'R'),
  'Restore works on open months only.', 'S5: a filed month is never restored');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, input_cgst, input_sgst, reversal_month)
VALUES (:'R', '10/2026', '2026-10-02', 'OCT OWN', 'O-1', 5, 5, 'Oct 26');
SELECT public.t_raises(format($q$SELECT public.twob_restore_version(public.t_superadmin(), '%s', '09/2026', '[]'::jsonb, '[]'::jsonb)$q$, :'R'),
  'Restore works only on the latest month that holds entries (Oct-26).', 'S5: not while a later month holds entries');
DELETE FROM public.bills_not_in_2b WHERE client_id = :'R' AND period_month = '10/2026';
SELECT public.t_raises(format($q$SELECT public.twob_restore_version(public.t_superadmin(), '%s', '09/2026', '[{"supplier_name": "NO DATE"}]'::jsonb, '[]'::jsonb)$q$, :'R'),
  'An entry of this version has no date or a date that is not one. Nothing was restored.', 'S5: a bad version is refused in words');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'R' AND period_month = '09/2026'), 2, 'S5: ... and nothing changed');
SELECT public.twob_restore_version(public.t_superadmin(), :'R', '09/2026',
  '[{"date":"2026-07-15","supplier_name":"TAMNNA SUPPLIER","supplier_invoice_number":"T-1","supplier_gstin":"24TSUPP0000A1Z5","taxable_value":11111.11,"input_cgst":1000,"input_sgst":1000,"reversal_month":"Jul 26","is_carried_forward":true},
    {"date":"2026-09-03","supplier_name":"SEP OWN","supplier_invoice_number":"S-9","taxable_value":100,"input_cgst":9,"input_sgst":9,"reversal_month":"Sep 26","is_carried_forward":false}]'::jsonb,
  '[]'::jsonb) AS s5 \gset
SELECT public.t_eq((SELECT array_agg(supplier_invoice_number || CASE WHEN is_carried_forward THEN '+c' ELSE '' END || COALESCE('/' || reclaim_month, '') ORDER BY supplier_invoice_number)
                      FROM public.bills_not_in_2b WHERE client_id = :'R' AND period_month = '09/2026'), ARRAY['S-9', 'T-1+c', 'T-2+c/Sep 26'],
  'S5: September''s own entries restored to the version (S-9); its carried entries stay as they stand (round 4: T-2''s reclaimed copy kept)');
RESET ROLE;
