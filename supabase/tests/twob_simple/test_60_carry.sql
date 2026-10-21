-- The carry never wipes. Filing (an update, a row added as Filed, the
-- extension's upsert) copies into the next month only when it holds no
-- carried rows on that list; a second filing does nothing. Re-run carry
-- forward: a GST Manager or the superadmin, a preview first, later decisions
-- kept, twins one to one.
\set F1 '60000000-0000-0000-0000-000000000001'
\set F2 '60000000-0000-0000-0000-000000000002'
\set F3 '60000000-0000-0000-0000-000000000003'
\set F4 '60000000-0000-0000-0000-000000000004'
\set FQ '60000000-0000-0000-0000-000000000005'

INSERT INTO public.clients (id, name) VALUES (:'F1', 'Carry one'), (:'F2', 'Carry insert'), (:'F3', 'Carry upsert'), (:'F4', 'Rerun'), (:'FQ', 'Carry quarterly');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES
  (:'F1', 'GSTR-3B', '09/2026', 'Prepared'),
  (:'F3', 'GSTR-3B', '05/2026', 'Pushed');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, input_cgst, input_sgst, reversal_month) VALUES
  (:'F1', '09/2026', '2026-09-01', 'S ONE', 'S-1', '24SONEE0000A1Z5', 100, 100, 'Sep 26'),
  (:'F1', '09/2026', '2026-09-02', 'S TWO', 'S-2', '24STWOO0000A1Z5', 200, 200, 'Sep 26'),
  (:'F2', '05/2026', '2026-05-01', 'M ONE', 'M-1', '24MONEE0000A1Z5', 10, 10, 'May 26'),
  (:'F3', '05/2026', '2026-05-01', 'U ONE', 'U-1', '24UONEE0000A1Z5', 10, 10, 'May 26'),
  (:'FQ', '06/2026', '2026-06-01', 'Q ONE', 'Q-1', '24QONEE0000A1Z5', 10, 10, 'Jun 26');
INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, input_cgst, input_sgst, bill_in_2b_month) VALUES
  (:'F1', '09/2026', '2026-09-03', 'NB ONE', 'NB-1', '24NBONE0000A1Z5', 50, 50, 'Sep 26');

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);

-- 1. Filing Sep-26 (as Filing Status does): the first carry into Oct-26.
UPDATE public.filing_status SET status = 'Filed', arn = 'AA2409260000001', filed_date = '2026-10-20' WHERE client_id = :'F1' AND period_month = '09/2026';
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'F1' AND period_month = '10/2026' AND is_carried_forward), 2, 'filing: Sep-26 carried into Oct-26');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_books WHERE client_id = :'F1' AND period_month = '10/2026' AND is_carried_forward), 1, 'filing: Not in Books carried');
SELECT public.t_eq((SELECT bool_and(is_locked) FROM public.bills_not_in_2b WHERE client_id = :'F1' AND period_month = '09/2026'), true, 'filing: Sep-26 rows locked');
SELECT public.t_eq((SELECT is_locked FROM public.filing_status WHERE client_id = :'F1' AND period_month = '09/2026'), true, 'filing: the return locked');

-- Oct-26 (open) decides on its copies and adds its own entry.
UPDATE public.bills_not_in_2b SET reclaim_month = 'Oct 26' WHERE client_id = :'F1' AND period_month = '10/2026' AND supplier_name = 'S ONE';
UPDATE public.bills_not_in_books SET book_entry_month = 'Oct 26' WHERE client_id = :'F1' AND period_month = '10/2026';
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, input_cgst, input_sgst, reversal_month)
VALUES (:'F1', '10/2026', '2026-10-05', 'OCT OWN', 7, 7, 'Oct 26');

-- 2. Sep-26 unlocked and filed again: nothing in Oct-26 moves.
UPDATE public.filing_status SET status = 'Prepared Pending', is_locked = false, filed_date = NULL WHERE client_id = :'F1' AND period_month = '09/2026';
UPDATE public.bills_not_in_2b SET is_locked = false WHERE client_id = :'F1' AND period_month = '09/2026';
UPDATE public.filing_status SET status = 'Filed', filed_date = '2026-10-21' WHERE client_id = :'F1' AND period_month = '09/2026';
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'F1' AND period_month = '10/2026'), 3, 'second filing: Oct-26 rows as they were');
SELECT public.t_eq((SELECT reclaim_month FROM public.bills_not_in_2b WHERE client_id = :'F1' AND period_month = '10/2026' AND supplier_name = 'S ONE'), 'Oct 26',
  'second filing: Oct-26 reclaim kept');
SELECT public.t_eq((SELECT book_entry_month FROM public.bills_not_in_books WHERE client_id = :'F1' AND period_month = '10/2026'), 'Oct 26',
  'second filing: Oct-26 book entry kept');
-- The app's carry after filing: the same first carry, nothing to do.
SELECT public.t_eq((public.twob_carry_after_filing(:'F1', '09/2026') ->> 'carried_2b')::integer, 0, 'app carry after filing: nothing carried again');
SELECT public.t_eq((public.twob_carry_after_filing(:'F1', '09/2026') ->> 'skipped_2b')::boolean, true, 'app carry after filing: Oct-26 already holds its list');
SELECT public.t_eq((public.twob_carry_after_filing(:'F1', '10/2026') ->> 'not_filed')::boolean, true, 'app carry after filing: an unfiled month carries nothing');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'F1' AND period_month = '11/2026'), 0, 'no carry out of an unfiled month');

-- 3. A row added as Filed (a new Filing Status row, the extension's markFiled of a new row).
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date)
VALUES (:'F2', 'GSTR-3B', '05/2026', 'Filed', 'AA2405260000001', '2026-06-20');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'F2' AND period_month = '06/2026' AND is_carried_forward), 1, 'added as Filed: carried into Jun-26');
SELECT public.t_eq((SELECT is_locked FROM public.filing_status WHERE client_id = :'F2' AND period_month = '05/2026'), true, 'added as Filed: locked');
SELECT public.t_eq((SELECT is_locked FROM public.bills_not_in_2b WHERE client_id = :'F2' AND period_month = '05/2026'), true, 'added as Filed: its rows locked');

-- 4. The extension's markFiled upsert on an existing row (Pushed -> Filed): carried once.
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date)
VALUES (:'F3', 'GSTR-3B', '05/2026', 'Filed', 'AA2405260000002', '2026-06-20')
ON CONFLICT (client_id, return_type, period_month) DO UPDATE SET status = EXCLUDED.status, arn = EXCLUDED.arn, filed_date = EXCLUDED.filed_date;
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'F3' AND period_month = '06/2026'), 1, 'upsert: carried exactly once');
SELECT public.t_eq((SELECT is_locked FROM public.filing_status WHERE client_id = :'F3' AND period_month = '05/2026'), true, 'upsert: locked');
-- ... and again (the portal sync re-sends Filed): nothing more.
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date)
VALUES (:'F3', 'GSTR-3B', '05/2026', 'Filed', 'AA2405260000002', '2026-06-20')
ON CONFLICT (client_id, return_type, period_month) DO UPDATE SET status = EXCLUDED.status, arn = EXCLUDED.arn, filed_date = EXCLUDED.filed_date;
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'F3' AND period_month = '06/2026'), 1, 'upsert again: nothing more');

-- 5. A quarterly return: locked and carried into the next month, as the app carries it.
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date)
VALUES (:'FQ', 'GSTR-3B (Q)', '06/2026', 'Filed', 'AA2406260000009', '2026-07-22');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'FQ' AND period_month = '07/2026' AND is_carried_forward), 1, 'quarterly: carried into Jul-26');
SELECT public.t_eq((SELECT is_locked FROM public.bills_not_in_2b WHERE client_id = :'FQ' AND period_month = '06/2026'), true, 'quarterly: Jun-26 rows locked');
SELECT public.t_eq(public.twob_month_is_prior(:'FQ', '05/2026'), true, 'quarterly: May-26 prior');
RESET ROLE;

-- 6. Re-run carry forward (TAMNNA: a re-run wiped later months' reclaims).
-- July: A, B, two identical C, and D (added after the carry). August (filed):
-- A reclaimed in Aug, B, the two C, a third C copy (stale, undecided), X
-- (stale, undecided), Y (stale, reclaimed in Aug) and Aug's own entry.
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, input_cgst, input_sgst, reversal_month, reclaim_month, is_carried_forward) VALUES
  (:'F4', '07/2026', '2026-07-01', 'A CO', 'A-1', '24ACOOO0000A1Z5', 10, 10, 'Jul 26', NULL, false),
  (:'F4', '07/2026', '2026-07-02', 'B CO', 'B-1', '24BCOOO0000A1Z5', 20, 20, 'Jul 26', NULL, false),
  (:'F4', '07/2026', '2026-07-03', 'C CO', 'C-1', '24CCOOO0000A1Z5', 30, 30, 'Jul 26', NULL, false),
  (:'F4', '07/2026', '2026-07-03', 'C CO', 'C-1', '24CCOOO0000A1Z5', 30, 30, 'Jul 26', NULL, false),
  (:'F4', '07/2026', '2026-07-04', 'D CO', 'D-1', '24DCOOO0000A1Z5', 40, 40, 'Jul 26', NULL, false),
  (:'F4', '08/2026', '2026-07-01', 'A CO', 'A-1', '24ACOOO0000A1Z5', 10, 10, 'Jul 26', 'Aug 26', true),
  (:'F4', '08/2026', '2026-07-02', 'B CO', 'B-1', '24BCOOO0000A1Z5', 20, 20, 'Jul 26', NULL, true),
  (:'F4', '08/2026', '2026-07-03', 'C CO', 'C-1', '24CCOOO0000A1Z5', 30, 30, 'Jul 26', NULL, true),
  (:'F4', '08/2026', '2026-07-03', 'C CO', 'C-1', '24CCOOO0000A1Z5', 30, 30, 'Jul 26', NULL, true),
  (:'F4', '08/2026', '2026-07-03', 'C CO', 'C-1', '24CCOOO0000A1Z5', 30, 30, 'Jul 26', NULL, true),
  (:'F4', '08/2026', '2026-06-05', 'X CO', 'X-1', '24XCOOO0000A1Z5', 50, 50, 'Jun 26', NULL, true),
  (:'F4', '08/2026', '2026-06-06', 'Y CO', 'Y-1', '24YCOOO0000A1Z5', 60, 60, 'Jun 26', 'Aug 26', true),
  (:'F4', '08/2026', '2026-08-01', 'AUG OWN', 'G-1', '24AUGOW0000A1Z5', 70, 70, 'Aug 26', NULL, false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status, filed_date, is_locked) VALUES
  (:'F4', 'GSTR-3B', '07/2026', 'Filed', '2026-08-20', true),
  (:'F4', 'GSTR-3B', '08/2026', 'Filed', '2026-09-20', true);
SELECT set_config('twob.write', '', false);

SET ROLE anon;
SELECT public.t_raises(format($q$SELECT public.twob_carry_rerun(public.t_employee(), '%s', '07/2026', true)$q$, :'F4'),
  'Only a GST Manager or the superadmin can re-run the carry forward.', 're-run: an employee is refused');
SELECT public.twob_carry_rerun(public.t_manager(), :'F4', '07/2026', true) AS preview \gset
SELECT public.t_eq((SELECT array_agg(x ->> 'supplier_name' ORDER BY x ->> 'supplier_name') FROM jsonb_array_elements(:'preview'::jsonb -> 'bills_not_in_2b' -> 'add') x),
  ARRAY['D CO'], 're-run preview: D to add');
SELECT public.t_eq((SELECT array_agg(x ->> 'supplier_name' ORDER BY x ->> 'supplier_name') FROM jsonb_array_elements(:'preview'::jsonb -> 'bills_not_in_2b' -> 'remove') x),
  ARRAY['C CO', 'X CO'], 're-run preview: the third C copy and X to remove');
SELECT public.t_eq((SELECT array_agg(x ->> 'supplier_name') FROM jsonb_array_elements(:'preview'::jsonb -> 'bills_not_in_2b' -> 'keep') x),
  ARRAY['Y CO'], 're-run preview: Y kept, it holds its own reclaim');
SELECT public.t_eq(:'preview'::jsonb -> 'bills_not_in_2b' -> 'keep' -> 0 ->> 'message', 'Aug-26 has reclaimed this entry; undo that reclaim first', 're-run preview: why Y is kept');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'F4' AND period_month = '08/2026'), 8, 're-run preview wrote nothing');

SELECT public.twob_carry_rerun(public.t_superadmin(), :'F4', '07/2026', false) AS applied \gset
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'F4' AND period_month = '08/2026'), 7, 're-run: Aug-26 holds 7 rows');
SELECT public.t_eq((SELECT reclaim_month FROM public.bills_not_in_2b WHERE client_id = :'F4' AND period_month = '08/2026' AND supplier_name = 'A CO'), 'Aug 26', 're-run: A''s Aug reclaim kept');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'F4' AND period_month = '08/2026' AND supplier_name = 'C CO'), 2, 're-run: twins one to one, two C copies');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'F4' AND period_month = '08/2026' AND supplier_name = 'D CO' AND is_carried_forward AND is_locked), 1,
  're-run: D carried into filed Aug-26, locked as the month');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'F4' AND period_month = '08/2026' AND supplier_name IN ('Y CO', 'AUG OWN')), 2,
  're-run: Y and Aug''s own entry stay');
SELECT public.twob_carry_rerun(public.t_manager(), :'F4', '07/2026', true) AS again \gset
SELECT public.t_eq(:'again'::jsonb -> 'bills_not_in_2b' -> 'add', '[]'::jsonb, 're-run again: nothing to add');
SELECT public.t_eq(:'again'::jsonb -> 'bills_not_in_2b' -> 'remove', '[]'::jsonb, 're-run again: nothing to remove');
RESET ROLE;
