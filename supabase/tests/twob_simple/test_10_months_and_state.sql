-- Prior months (twob_month_is_prior / twob_month_state), as the app reads
-- them through PostgREST (anon), and who may call what.
\set S '10000000-0000-0000-0000-000000000001'
\set Q '10000000-0000-0000-0000-000000000002'
SELECT public.t_make_sorath(:'S', 'Months', false);
INSERT INTO public.clients (id, name) VALUES (:'Q', 'Quarterly');
INSERT INTO public.filing_status (client_id, return_type, period_month, status, filed_date) VALUES
  (:'Q', 'GSTR-3B (Q)', '06/2026', 'Filed', '2026-07-22'),
  (:'Q', 'GSTR-3B (Q)', '09/2026', 'Data Pending', NULL);

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);

-- Monthly: the filed months, an unfiled month before a filed one, the open month.
SELECT public.t_eq(public.twob_month_is_prior(:'S', '07/2026'), true, 'Jul-26 Filed: prior');
SELECT public.t_eq(public.twob_month_is_prior(:'S', '08/2026'), true, 'Aug-26 Filed: prior');
SELECT public.t_eq(public.twob_month_is_prior(:'S', '05/2026'), true, 'May-26 has no return but later months are Filed: prior');
SELECT public.t_eq(public.twob_month_is_prior(:'S', '09/2026'), false, 'Sep-26 Data Received: open');
SELECT public.t_eq(public.twob_month_is_prior(:'S', '10/2026'), false, 'Oct-26: open');
SELECT public.t_eq(public.twob_month_is_prior(:'S', 'Jul 26'), false, 'not a month: not prior');

-- The state the screens read.
SELECT public.t_eq((public.twob_month_state(:'S', '07/2026') ->> 'is_prior')::boolean, true, 'state: Jul-26 prior');
SELECT public.t_eq(public.twob_month_state(:'S', '07/2026') ->> 'prior_through', '08/2026', 'state: prior through Aug-26');
SELECT public.t_eq((public.twob_month_state(:'S', '09/2026') ->> 'is_prior')::boolean, false, 'state: Sep-26 open');
SELECT public.t_eq(jsonb_array_length(public.twob_month_state(:'S', '07/2026') -> 'later_months'), 2, 'state: Aug-26 and Sep-26 hold rows after Jul-26');
SELECT public.t_eq(public.twob_month_state(:'S', '07/2026') -> 'later_months' -> 0 ->> 'period', '08/2026', 'state: first later month Aug-26');
SELECT public.t_eq((public.twob_month_state(:'S', '07/2026') -> 'later_months' -> 0 ->> 'carried_2b')::integer, 19, 'state: Aug-26 carries 19 Not in 2B rows');
SELECT public.t_eq((public.twob_month_state(:'S', '07/2026') -> 'later_months' -> 0 ->> 'rows_2b')::integer, 20, 'state: Aug-26 holds 20 Not in 2B rows');
SELECT public.t_eq((public.twob_month_state(:'S', '07/2026') -> 'later_months' -> 1 ->> 'carried_books')::integer, 1, 'state: Sep-26 carries 1 Not in Books row');

-- Unlocking the sheets (as Filing Status does: Prepared Pending, unlocked)
-- does not open the month again.
UPDATE public.filing_status SET status = 'Prepared Pending', is_locked = false, filed_date = NULL
 WHERE client_id = :'S' AND period_month = '08/2026' AND return_type = 'GSTR-3B';
UPDATE public.bills_not_in_2b SET is_locked = false WHERE client_id = :'S' AND period_month = '08/2026';
UPDATE public.bills_not_in_books SET is_locked = false WHERE client_id = :'S' AND period_month = '08/2026';
SELECT public.t_eq(public.twob_month_is_prior(:'S', '08/2026'), true, 'Aug-26 unlocked: still prior');
SELECT public.t_raises($$UPDATE public.bills_not_in_2b SET supplier_name = 'X' WHERE client_id = '10000000-0000-0000-0000-000000000001' AND period_month = '08/2026'$$,
  'This month is filed. Only a GST Manager or the superadmin can change its books entries', 'Aug-26 unlocked: a direct change still refused');

-- Quarterly: a GSTR-3B (Q) recorded at the quarter end covers its three months.
SELECT public.t_eq(public.twob_month_is_prior(:'Q', '04/2026'), true, 'QRMP: Apr-26 in the filed Apr-Jun quarter: prior');
SELECT public.t_eq(public.twob_month_is_prior(:'Q', '05/2026'), true, 'QRMP: May-26 prior');
SELECT public.t_eq(public.twob_month_is_prior(:'Q', '06/2026'), true, 'QRMP: Jun-26 prior');
SELECT public.t_eq(public.twob_month_is_prior(:'Q', '03/2026'), true, 'QRMP: Mar-26 before a filed quarter: prior');
SELECT public.t_eq(public.twob_month_is_prior(:'Q', '07/2026'), false, 'QRMP: Jul-26, its quarter not filed: open');
SELECT public.t_eq(public.twob_month_is_prior(:'Q', '09/2026'), false, 'QRMP: Sep-26 quarter end not filed: open');

-- What PostgREST lets the public key call.
SELECT public.t_eq(has_function_privilege('anon', 'public.twob_month_state(uuid, text)', 'EXECUTE'), true, 'anon calls twob_month_state');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob_month_is_prior(uuid, text)', 'EXECUTE'), true, 'anon calls twob_month_is_prior');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob_prior_books_apply(uuid, uuid, text, jsonb, boolean)', 'EXECUTE'), true, 'anon calls twob_prior_books_apply');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob_carry_rerun(uuid, uuid, text, boolean)', 'EXECUTE'), true, 'anon calls twob_carry_rerun');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob_reopen_filed(uuid, uuid, text, text, text)', 'EXECUTE'), true, 'anon calls twob_reopen_filed');
SELECT public.t_eq(to_regprocedure('public.twob_carry_after_filing(uuid, text)') IS NULL, true, 'no carry after filing callable by anyone (the filing trigger carries)');
SELECT public.t_eq(has_function_privilege('anon', 'public.staff_level_of(uuid)', 'EXECUTE'), true, 'anon calls staff_level_of');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob_carry_first(uuid, text)', 'EXECUTE'), false, 'anon cannot call twob_carry_first');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob__apply_ledger(uuid, uuid, text, text, text, uuid, jsonb, text[], text[], uuid[], text[], text[], boolean[], text, uuid[], text)', 'EXECUTE'), false, 'anon cannot call twob__apply_ledger');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob__match_copies(text, uuid, text, jsonb)', 'EXECUTE'), false, 'anon cannot call twob__match_copies');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob__held_inserts(text, uuid, text, jsonb)', 'EXECUTE'), false, 'anon cannot call twob__held_inserts');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob__freeze_figures(uuid, text[], uuid)', 'EXECUTE'), false, 'anon cannot call twob__freeze_figures');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob__apply_books_register(uuid, uuid, text, text, uuid, jsonb)', 'EXECUTE'), false, 'anon cannot call twob__apply_books_register');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob__ledger_insert(text, uuid, text, jsonb, text[], text[], uuid)', 'EXECUTE'), false, 'anon cannot call twob__ledger_insert');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob__ledger_update(text, uuid[], jsonb, uuid)', 'EXECUTE'), false, 'anon cannot call twob__ledger_update');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob__ledger_delete(text, uuid[])', 'EXECUTE'), false, 'anon cannot call twob__ledger_delete');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob__rerun_list(text, uuid, text, text, boolean, boolean)', 'EXECUTE'), false, 'anon cannot call twob__rerun_list');
SELECT public.t_eq(has_function_privilege('anon', 'public.twob_restore_version(uuid, uuid, text, jsonb, jsonb)', 'EXECUTE'), true, 'anon calls twob_restore_version');
SELECT public.t_eq(to_regprocedure('public.twob__carry_into(text, uuid, text, text[])') IS NULL, true, 'no late carry function left');
SELECT public.t_raises($$INSERT INTO public.twob_carry_log (client_id, period_month, list, next_period, last_outcome) VALUES ('10000000-0000-0000-0000-000000000001', '09/2026', 'bills_not_in_2b', '10/2026', 'carried')$$,
  'permission denied', 'anon cannot write the carry record');
SELECT public.t_raises($$DELETE FROM public.twob_carry_log WHERE client_id = '10000000-0000-0000-0000-000000000001'$$,
  'permission denied', 'anon cannot remove the carry record');
SELECT public.t_eq(has_function_privilege('anon', 'public.repair_carry_forward_chain(uuid, text, text, date)', 'EXECUTE'), false, 'anon cannot call repair_carry_forward_chain');
SELECT public.t_raises($$SELECT public.twob_carry_first('10000000-0000-0000-0000-000000000001', '08/2026')$$, 'permission denied', 'anon calling twob_carry_first is refused');
-- The record of filed returns: readable, never written by the public key.
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_ever_filed WHERE client_id = '10000000-0000-0000-0000-000000000001'), 3, 'Jun, Jul and Aug-26 recorded as filed');
SELECT public.t_raises($$INSERT INTO public.twob_ever_filed (client_id, return_type, period_month) VALUES ('10000000-0000-0000-0000-000000000001', 'GSTR-3B', '09/2026')$$,
  'permission denied', 'anon cannot record a filing');
SELECT public.t_raises($$DELETE FROM public.twob_ever_filed WHERE client_id = '10000000-0000-0000-0000-000000000001'$$,
  'permission denied', 'anon cannot remove a recorded filing');
SELECT public.t_raises($$UPDATE public.twob_ever_filed SET reopened_at = now() WHERE client_id = '10000000-0000-0000-0000-000000000001'$$,
  'permission denied', 'anon cannot reopen a recorded filing by hand');
SELECT public.t_raises($$INSERT INTO public.twob_filed_figures (client_id, period_month) VALUES ('10000000-0000-0000-0000-000000000001', '07/2026')$$,
  'permission denied', 'anon cannot write filed figures');
SELECT public.t_eq((SELECT count(*)::integer FROM public.twob_filed_figures), 0, 'filed figures readable, none recorded before a change');
RESET ROLE;
