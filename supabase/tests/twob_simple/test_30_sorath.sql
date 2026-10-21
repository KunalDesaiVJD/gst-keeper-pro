-- SORATH BUILDERS (17 Oct 2026): in filed July, the duplicate PERFECT
-- INDUSTRIES entry and the fifteen BOI bank-charge entries are removed to
-- tally, through the one door (twob_prior_books_apply). August (filed) and
-- September (open) lose exactly one PERFECT copy and the fifteen BOI copies,
-- and their Suspended Reco books side drops by the same 8,871.09 a head.
-- Nothing saved for any month moves. An employee is refused.
\set S '30000000-0000-0000-0000-000000000001'
SELECT public.t_make_sorath(:'S', 'SORATH BUILDERS', true);

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);

SELECT public.t_saved_digest(:'S') AS digest_before \gset
SELECT public.t_books_side(:'S', '07/2026') AS jul_before, public.t_books_side(:'S', '08/2026') AS aug_before,
       public.t_books_side(:'S', '09/2026') AS sep_before \gset
SELECT public.t_eq(public.t_count(:'S', '08/2026', 'PERFECT INDUSTRIES'), 2, 'before: Aug-26 holds both PERFECT copies');
SELECT public.t_eq(public.t_count(:'S', '09/2026', 'BOI - CC'), 15, 'before: Sep-26 holds the fifteen BOI copies');

-- One PERFECT twin and the fifteen BOI entries, as 2B Reconciliation's Save sends them.
SELECT jsonb_agg(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', x.id)) AS changes
  FROM (SELECT unnest(public.t_ids(:'S', '07/2026', 'PERFECT INDUSTRIES', 1)) AS id
        UNION ALL SELECT unnest(public.t_ids(:'S', '07/2026', 'BOI - CC'))) x \gset

-- An employee is refused, whatever the screen shows.
SELECT public.t_raises(format($q$SELECT public.twob_prior_books_apply(public.t_employee(), '%s', '07/2026', '%s'::jsonb, false)$q$, :'S', :'changes'),
  'This month is filed. Only a GST Manager or the superadmin can change its books entries', 'SORATH: an employee is refused');

-- The preview (writes nothing): sixteen entries, sixteen copies in Aug-26 and in Sep-26.
SELECT public.twob_prior_books_apply(public.t_manager(), :'S', '07/2026', :'changes'::jsonb, true) AS preview \gset
SELECT public.t_eq((:'preview'::jsonb ->> 'ok')::boolean, true, 'SORATH preview: no refusal');
SELECT public.t_eq(:'preview'::jsonb -> 'later_months', '[{"count": 16, "period": "08/2026"}, {"count": 16, "period": "09/2026"}]'::jsonb,
  'SORATH preview: also changes Aug-26 (16), Sep-26 (16)');
SELECT public.t_eq(public.t_count(:'S', '07/2026', 'BOI - CC'), 15, 'SORATH preview wrote nothing');

-- Applied.
SELECT public.twob_prior_books_apply(public.t_manager(), :'S', '07/2026', :'changes'::jsonb, false) AS applied \gset
SELECT public.t_eq((:'applied'::jsonb ->> 'ok')::boolean, true, 'SORATH applied');
SELECT public.t_eq(public.t_count(:'S', '07/2026', 'PERFECT INDUSTRIES'), 1, 'Jul-26: one PERFECT left');
SELECT public.t_eq(public.t_count(:'S', '08/2026', 'PERFECT INDUSTRIES'), 1, 'Aug-26: exactly one PERFECT copy removed');
SELECT public.t_eq(public.t_count(:'S', '09/2026', 'PERFECT INDUSTRIES'), 1, 'Sep-26: exactly one PERFECT copy removed');
SELECT public.t_eq(public.t_count(:'S', '07/2026', 'BOI - CC') + public.t_count(:'S', '08/2026', 'BOI - CC') + public.t_count(:'S', '09/2026', 'BOI - CC'), 0,
  'the fifteen BOI entries gone from Jul, Aug and Sep-26');
SELECT public.t_eq(public.t_count(:'S', '08/2026', 'OLD A') + public.t_count(:'S', '09/2026', 'OLD B') + public.t_count(:'S', '09/2026', 'AUG OWN'), 3,
  'the other entries stay');
SELECT public.t_eq(round(:'aug_before'::numeric - public.t_books_side(:'S', '08/2026'), 2), 8871.09, 'Aug-26 Suspended Reco books side drops by 8,871.09');
SELECT public.t_eq(round(:'sep_before'::numeric - public.t_books_side(:'S', '09/2026'), 2), 8871.09, 'Sep-26 Suspended Reco books side drops by the same 8,871.09');
SELECT public.t_eq(round(:'jul_before'::numeric - public.t_books_side(:'S', '07/2026'), 2), 8871.09, 'Jul-26 books side drops by 8,871.09');
SELECT public.t_eq(public.t_saved_digest(:'S'), :'digest_before', 'nothing saved moved (ITC Summary, Suspended Reco, Receivable Reco, push versions, filing status)');
SELECT public.t_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'S' AND updated_by = public.t_manager()), 0,
  'removals leave no row stamped');

-- Removing the last PERFECT too: one more copy each month, none left.
SELECT public.twob_prior_books_apply(public.t_manager(), :'S', '07/2026',
  jsonb_build_array(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', (public.t_ids(:'S', '07/2026', 'PERFECT INDUSTRIES', 1))[1])), false) AS again \gset
SELECT public.t_eq(public.t_count(:'S', '08/2026', 'PERFECT INDUSTRIES') + public.t_count(:'S', '09/2026', 'PERFECT INDUSTRIES'), 0, 'the second twin takes the second copy');
RESET ROLE;
