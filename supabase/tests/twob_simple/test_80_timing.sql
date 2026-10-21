-- Timing, as PostgREST runs it (anon): a 1,000-row Post in a prior month
-- with three later months (Aug, Sep, Oct-26 hold carried lists of 600 rows
-- each), previewed and applied; 1,000 removals carried to three months; and
-- a first carry of 1,000 rows on each list when a month is filed, also when
-- the month is filed after its next month (round 2: the carry then reaches
-- the filed next month and the open month after it). Each under 1 s.
\set P '80000000-0000-0000-0000-000000000001'
\set C '80000000-0000-0000-0000-000000000002'
\set Q '80000000-0000-0000-0000-000000000003'
\set W '80000000-0000-0000-0000-000000000004'
\set L '80000000-0000-0000-0000-000000000005'
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name) VALUES (:'P', 'Timing post'), (:'C', 'Timing carry'), (:'Q', 'Timing blank numbers'), (:'W', 'Timing guard'),
  (:'L', 'Timing late carry');
-- Round 2: 1,000 entries on each list in Jul-26 and in Aug-26; August is
-- filed first (its list carried into September), July later.
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month)
SELECT :'L', m.p, date '2026-07-01' + (g % 60), 'SUP ' || m.p || ' ' || g, 'L-' || m.l || '-' || g, '24SUPPL' || lpad(g::text, 4, '0') || 'A1Z5', 1000, 90, 90, m.l
  FROM generate_series(1, 1000) g, (VALUES ('07/2026', 'Jul 26'), ('08/2026', 'Aug 26')) m(p, l);
INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, bill_in_2b_month)
SELECT :'L', m.p, date '2026-07-01' + (g % 60), 'NIB ' || m.p || ' ' || g, 'LN-' || m.l || '-' || g, '24NIBSU' || lpad(g::text, 4, '0') || 'A1Z5', 1000, 90, 90, m.l
  FROM generate_series(1, 1000) g, (VALUES ('07/2026', 'Jul 26'), ('08/2026', 'Aug 26')) m(p, l);
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'L', 'GSTR-3B', '08/2026', 'Filed');
-- R8: 400 bank-charge entries without a number on one date, and 400
-- identical twins, carried Apr -> Sep (five later months), April filed.
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number,
  taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward)
SELECT :'Q', m.p, date '2026-04-30', CASE WHEN g <= 400 THEN 'BANK ' || g ELSE 'TWIN' END, NULL,
       100, CASE WHEN g <= 400 THEN g ELSE 9 END, CASE WHEN g <= 400 THEN g ELSE 9 END, 'Apr 26', m.p <> '04/2026'
  FROM generate_series(1, 800) g, (VALUES ('04/2026'), ('05/2026'), ('06/2026'), ('07/2026'), ('08/2026'), ('09/2026')) m(p);
INSERT INTO public.filing_status (client_id, return_type, period_month, status, filed_date, is_locked) VALUES
  (:'Q', 'GSTR-3B', '04/2026', 'Filed', '2026-05-20', true);
-- R20: the guard on open-month bulk writes, a client with 36 filed months.
INSERT INTO public.filing_status (client_id, return_type, period_month, status, filed_date, is_locked)
SELECT :'W', 'GSTR-3B', to_char(date '2023-07-01' + make_interval(months => g), 'MM/YYYY'), 'Filed', date '2023-08-20' + make_interval(months => g), true
  FROM generate_series(0, 35) g;
-- 600 entries carried Jul -> Aug -> Sep -> Oct, 1,000 books register rows in July not yet posted.
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month, is_carried_forward)
SELECT :'P', m.p, date '2026-04-01' + (g % 90), 'OLD ' || g, 'O-' || g, '24OLDSU' || lpad(g::text, 4, '0') || 'A1Z5',
       1000 + g, 90 + g, 90 + g, 'Apr 26', m.p <> '07/2026'
  FROM generate_series(1, 600) g, (VALUES ('07/2026'), ('08/2026'), ('09/2026'), ('10/2026')) m(p);
INSERT INTO public.books_register (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, book_treatment)
SELECT :'P', '07/2026', date '2026-07-01' + (g % 30), 'BOOK ' || g, 'P-' || g, '24BOOKS' || lpad(g::text, 4, '0') || 'A1Z5', 500 + g, 45, 45, 'NOT_IN_2B'
  FROM generate_series(1, 1000) g;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, filed_date, is_locked) VALUES
  (:'P', 'GSTR-3B', '07/2026', 'Filed', '2026-08-20', true),
  (:'P', 'GSTR-3B', '08/2026', 'Filed', '2026-09-20', true);
-- 1,000 entries on each list in Sep-26 for the carry.
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, reversal_month)
SELECT :'C', '09/2026', date '2026-09-01' + (g % 30), 'SUP ' || g, 'S-' || g, '24SUPPL' || lpad(g::text, 4, '0') || 'A1Z5', 1000, 90, 90, 'Sep 26'
  FROM generate_series(1, 1000) g;
INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_cgst, input_sgst, bill_in_2b_month)
SELECT :'C', '09/2026', date '2026-09-01' + (g % 30), 'NIB ' || g, 'N-' || g, '24NIBSU' || lpad(g::text, 4, '0') || 'A1Z5', 1000, 90, 90, 'Sep 26'
  FROM generate_series(1, 1000) g;
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES (:'C', 'GSTR-3B', '09/2026', 'Prepared');
SELECT set_config('twob.write', '', false);
ANALYZE public.bills_not_in_2b;
ANALYZE public.bills_not_in_books;
ANALYZE public.books_register;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
DO $$
DECLARE
  v_changes jsonb;
  t0 timestamptz;
  ms numeric;
  r jsonb;
BEGIN
  -- Post's plan: every books row Not in 2B becomes a ledger entry (as postImport2B plans it).
  SELECT jsonb_agg(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'insert', 'values', jsonb_build_object(
           'date', b.date, 'supplier_name', b.supplier_name, 'supplier_invoice_number', b.supplier_invoice_number,
           'supplier_gstin', b.supplier_gstin, 'taxable_value', b.taxable_value, 'input_igst', 0, 'input_cgst', b.input_cgst,
           'input_sgst', b.input_sgst, 'reversal_month', 'Jul 26', 'source_book_id', b.id)))
    INTO v_changes
    FROM public.books_register b WHERE b.client_id = '80000000-0000-0000-0000-000000000001' AND b.period_month = '07/2026';

  t0 := clock_timestamp();
  r := public.twob_prior_books_apply('00000000-0000-0000-0000-0000000000a2', '80000000-0000-0000-0000-000000000001', '07/2026', v_changes, true);
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: 1,000-row Post preview, prior month, three later months: % ms', ms;
  PERFORM public.t_eq(r -> 'later_months', '[{"count": 1000, "period": "08/2026"}, {"count": 1000, "period": "09/2026"}, {"count": 1000, "period": "10/2026"}]'::jsonb, 'timing: preview reaches Aug, Sep and Oct-26');
  PERFORM public.t_eq(ms < 1000, true, 'timing: Post preview under 1 s');

  t0 := clock_timestamp();
  r := public.twob_prior_books_apply('00000000-0000-0000-0000-0000000000a2', '80000000-0000-0000-0000-000000000001', '07/2026', v_changes, false);
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: 1,000-row Post applied, prior month, three later months: % ms', ms;
  PERFORM public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = '80000000-0000-0000-0000-000000000001' AND supplier_name LIKE 'BOOK %'), 4000,
    'timing: 1,000 entries and 3,000 carried copies');
  PERFORM public.t_eq(ms < 1000, true, 'timing: Post applied under 1 s');

  -- 1,000 removals (the entries just posted), each with a copy to find in three months.
  SELECT jsonb_agg(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', x.id))
    INTO v_changes
    FROM (SELECT id FROM public.bills_not_in_2b WHERE client_id = '80000000-0000-0000-0000-000000000001' AND period_month = '07/2026'
           ORDER BY supplier_name LIMIT 1000) x;
  t0 := clock_timestamp();
  r := public.twob_prior_books_apply('00000000-0000-0000-0000-0000000000a2', '80000000-0000-0000-0000-000000000001', '07/2026', v_changes, false);
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: 1,000 removals applied, prior month, three later months: % ms', ms;
  PERFORM public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = '80000000-0000-0000-0000-000000000001'), 2400,
    'timing: 1,000 entries and their 3,000 copies removed');
  PERFORM public.t_eq(ms < 1000, true, 'timing: removals under 1 s');

  -- The first carry when Sep-26 is filed: 1,000 rows on each list.
  t0 := clock_timestamp();
  UPDATE public.filing_status SET status = 'Filed', arn = 'AA2409260000077', filed_date = '2026-10-20'
   WHERE client_id = '80000000-0000-0000-0000-000000000002' AND period_month = '09/2026';
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: first carry of 1,000 rows per list on filing: % ms', ms;
  PERFORM public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = '80000000-0000-0000-0000-000000000002' AND period_month = '10/2026'), 1000,
    'timing: 1,000 Not in 2B rows carried');
  PERFORM public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE client_id = '80000000-0000-0000-0000-000000000002' AND period_month = '10/2026'), 1000,
    'timing: 1,000 Not in Books rows carried');
  PERFORM public.t_eq(ms < 1000, true, 'timing: first carry under 1 s');

  -- Re-run preview over the same 1,000 + 1,000 (nothing to do).
  t0 := clock_timestamp();
  r := public.twob_carry_rerun('00000000-0000-0000-0000-0000000000a2', '80000000-0000-0000-0000-000000000002', '09/2026', true);
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: Re-run preview of 1,000 rows per list: % ms', ms;
  PERFORM public.t_eq(jsonb_array_length(r -> 'bills_not_in_2b' -> 'add') + jsonb_array_length(r -> 'bills_not_in_books' -> 'remove'), 0, 'timing: re-run finds nothing to do');
  PERFORM public.t_eq(ms < 1000, true, 'timing: re-run preview under 1 s');

  -- R8: 400 removals of entries without a number on one date, each matched
  -- among 400 look-alikes in five later months; 400 renames; 400 twins.
  SELECT jsonb_agg(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', x.id)) INTO v_changes
    FROM (SELECT id FROM public.bills_not_in_2b WHERE client_id = '80000000-0000-0000-0000-000000000003' AND period_month = '04/2026' AND supplier_name LIKE 'BANK %') x;
  t0 := clock_timestamp();
  r := public.twob_prior_books_apply('00000000-0000-0000-0000-0000000000a2', '80000000-0000-0000-0000-000000000003', '04/2026', v_changes, true);
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: 400 removals among 400 look-alikes, five later months (preview): % ms', ms;
  PERFORM public.t_eq(r -> 'later_months' -> 0 ->> 'count', '400', 'timing: each removal finds its copy');
  PERFORM public.t_eq(ms < 1000, true, 'timing: look-alike removals under 1 s');
  SELECT jsonb_agg(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'update', 'id', x.id, 'values', jsonb_build_object('supplier_invoice_number', 'BC-' || x.n))) INTO v_changes
    FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM public.bills_not_in_2b WHERE client_id = '80000000-0000-0000-0000-000000000003' AND period_month = '04/2026' AND supplier_name LIKE 'BANK %') x;
  t0 := clock_timestamp();
  r := public.twob_prior_books_apply('00000000-0000-0000-0000-0000000000a2', '80000000-0000-0000-0000-000000000003', '04/2026', v_changes, false);
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: 400 renames among 400 look-alikes, five later months: % ms', ms;
  PERFORM public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = '80000000-0000-0000-0000-000000000003' AND supplier_invoice_number LIKE 'BC-%'), 2400,
    'timing: every rename reaches its five copies');
  PERFORM public.t_eq(ms < 1000, true, 'timing: look-alike renames under 1 s');
  SELECT jsonb_agg(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', x.id)) INTO v_changes
    FROM (SELECT id FROM public.bills_not_in_2b WHERE client_id = '80000000-0000-0000-0000-000000000003' AND period_month = '04/2026' AND supplier_name = 'TWIN') x;
  t0 := clock_timestamp();
  r := public.twob_prior_books_apply('00000000-0000-0000-0000-0000000000a2', '80000000-0000-0000-0000-000000000003', '04/2026', v_changes, true);
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: 400 identical twins removed (preview), five later months: % ms', ms;
  PERFORM public.t_eq(r -> 'later_months' -> 4 ->> 'count', '400', 'timing: one copy per twin per month');
  PERFORM public.t_eq(ms < 1000, true, 'timing: twin removals under 1 s');

  -- Round 2: July filed after August: 1,000 entries per list carried into
  -- filed August and into open September (which holds August's carry).
  t0 := clock_timestamp();
  INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES ('80000000-0000-0000-0000-000000000005', 'GSTR-3B', '07/2026', 'Filed');
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: carry of 1,000 rows per list on filing a month after its next month (two months reached): % ms', ms;
  PERFORM public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = '80000000-0000-0000-0000-000000000005' AND period_month IN ('08/2026', '09/2026')), 4000,
    'timing: July''s 1,000 reach August (1,000 own) and September (1,000 carried)');
  PERFORM public.t_eq(ms < 1000, true, 'timing: late carry under 1 s');

  -- R20: 2,000 rows written to an open month (October) of a client with 36
  -- filed months: insert, update, delete, one statement each.
  t0 := clock_timestamp();
  INSERT INTO public.twob_import_docs (client_id, period_month, supplier_name, itc_action)
  SELECT '80000000-0000-0000-0000-000000000004', '07/2026', 'DOC ' || g, 'MATCHED' FROM generate_series(1, 2000) g;
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: guard, 2,000 2B documents imported in an open month: % ms', ms;
  PERFORM public.t_eq(ms < 500, true, 'timing: guarded import of 2,000 documents under 0.5 s');
  t0 := clock_timestamp();
  UPDATE public.twob_import_docs SET posted_at = now() WHERE client_id = '80000000-0000-0000-0000-000000000004';
  DELETE FROM public.twob_import_docs WHERE client_id = '80000000-0000-0000-0000-000000000004';
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: guard, 2,000 2B documents stamped and deleted: % ms', ms;
  PERFORM public.t_eq(ms < 1000, true, 'timing: guarded stamp and delete of 2,000 documents under 1 s');
  t0 := clock_timestamp();
  INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, input_cgst, input_sgst, reversal_month)
  SELECT '80000000-0000-0000-0000-000000000004', '07/2026', date '2026-07-01', 'ROW ' || g, 1, 1, 'Jul 26' FROM generate_series(1, 2000) g;
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: guard, 2,000 rows inserted in an open month: % ms', ms;
  PERFORM public.t_eq(ms < 500, true, 'timing: guarded insert of 2,000 rows under 0.5 s');
  t0 := clock_timestamp();
  INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, input_cgst, input_sgst, reversal_month, is_carried_forward)
  SELECT '80000000-0000-0000-0000-000000000004', '07/2026', date '2026-07-01', 'ROW ' || g, 1, 1, 'Jul 26', true FROM generate_series(1, 2000) g;
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: guard, 2,000 carried rows inserted beside 2,000 like them (an old page''s carry): % ms', ms;
  PERFORM public.t_eq(ms < 1000, true, 'timing: guarded carried insert of 2,000 rows under 1 s');
  t0 := clock_timestamp();
  UPDATE public.bills_not_in_2b SET supplier_name = supplier_name || '.' WHERE client_id = '80000000-0000-0000-0000-000000000004';
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: guard, 2,000 rows updated in an open month: % ms', ms;
  PERFORM public.t_eq(ms < 500, true, 'timing: guarded update of 2,000 rows under 0.5 s');
  t0 := clock_timestamp();
  DELETE FROM public.bills_not_in_2b WHERE client_id = '80000000-0000-0000-0000-000000000004';
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  RAISE NOTICE 'timing: guard, 2,000 rows deleted in an open month: % ms', ms;
  PERFORM public.t_eq(ms < 500, true, 'timing: guarded delete of 2,000 rows under 0.5 s');
END $$;
RESET ROLE;
