-- With auto_lock_on_filed as 20261021100000 (twob-simple) defines it on
-- 21 Oct 2026 (fixtures/twob_auto_lock.sql, which run.sh puts on the stub:
-- BEFORE INSERT OR UPDATE, GSTR-3B and GSTR-3B (Q), the first carry): a
-- pull still files once, the carry runs once per filing, the filing date
-- stays the portal's (or blank), never CURRENT_DATE. Round 2, defect 7: a
-- pulled GSTR-3B (Q) is carried (the migration refuses to apply without
-- this auto_lock_on_filed; run.sh checks that refusal).

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

-- GSTR-3B (Q), no portal date: Filed, carried once, date blank.
SELECT t_eq((public.filing_record_pull('22222222-2222-2222-2222-222222222222', 'GSTR-3B (Q)', '09/2026', 'AB240926222222X', NULL,
  NULL, 'No PDF came with the pull.', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'filed', 'filed');
SELECT t_eq((SELECT count(*)::int FROM public.t_carry_calls), 1, 'carried once');
SELECT t_eq((SELECT filed_date FROM public.filing_status WHERE client_id = '22222222-2222-2222-2222-222222222222' AND period_month = '09/2026'),
  NULL::date, 'no CURRENT_DATE from auto_lock_on_filed');
-- Refreshed: no second carry.
SELECT t_eq((public.filing_record_pull('22222222-2222-2222-2222-222222222222', 'GSTR-3B (Q)', '09/2026', 'AB240926222222X', current_date - 1, p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'refreshed', 'refreshed');
SELECT t_eq((SELECT count(*)::int FROM public.t_carry_calls), 1, 'still carried once');
SELECT t_eq((SELECT filed_date FROM public.filing_status WHERE client_id = '22222222-2222-2222-2222-222222222222' AND period_month = '09/2026'),
  current_date - 1, 'the portal date, when it comes');
SELECT t_eq((SELECT count(*)::int FROM public.email_outbox), 1, 'one e-mail');
