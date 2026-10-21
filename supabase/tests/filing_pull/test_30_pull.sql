-- The portal pull, as extension 0.15.0 calls it with the anon key: filed,
-- refreshed on the same ARN, a different ARN never put over the stored one
-- (a conflict for the superadmin), an ARN of another period refused, no PDF
-- when the pull could not check one, no filing date when the portal gave
-- none (never the pull's day), and every outcome logged.
INSERT INTO public.bills_not_in_2b (client_id, date, supplier_name, period_month) VALUES
  ('11111111-1111-1111-1111-111111111111', '2026-08-03', 'SUPPLIER ONE', '08/2026');
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

-- Filed from the portal: a row that did not exist yet.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/08-2026/GSTR-3B-AB240826123456X.pdf',
  NULL, '00000000-0000-0000-0000-00000000000c', '{"ext_version":"0.15.0"}'))->>'outcome', 'filed', 'pull files the return');
SELECT t_eq((SELECT status::text || '/' || arn || '/' || filed_date::text || '/' || filed_source || '/' || (pulled_at IS NOT NULL)::text
                    || '/' || is_locked::text || '/' || updated_by::text
              FROM public.filing_status WHERE return_type = 'GSTR-3B' AND period_month = '08/2026'),
  'Filed/AB240826123456X/2026-09-18/portal/true/true/00000000-0000-0000-0000-00000000000c', 'row as pulled');
SELECT t_eq((SELECT bool_and(is_locked) FROM public.bills_not_in_2b WHERE period_month = '08/2026'), true, 'GSTR-3B sheets locked (auto_lock_on_filed)');
SELECT t_eq((SELECT event || '/' || route || '/' || (detail->'pulled'->>'arn') || '/' || (detail->>'ext_version') FROM public.filing_status_log
              WHERE return_type = 'GSTR-3B' AND period_month = '08/2026'),
  'filed/portal/AB240826123456X/0.15.0', 'logged as filed from the portal');

-- The same ARN again: refreshed; a pull without a date keeps the stored date.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826123456X', NULL,
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/08-2026/GSTR-3B-AB240826123456X-2.pdf', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'refreshed', 'same ARN refreshes');
SELECT t_eq((SELECT filed_date::text || '/' || regexp_replace(return_pdf_url, '^.*/', '') FROM public.filing_status WHERE return_type = 'GSTR-3B' AND period_month = '08/2026'),
  '2026-09-18/GSTR-3B-AB240826123456X-2.pdf', 'date kept, PDF refreshed');
-- A refresh with no checked PDF keeps the one an earlier pull checked, with
-- no "not checked" note (round 2: test_80 has the unchecked cases).
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  NULL, 'The portal gave the System generated summary, not the filed return.', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'refreshed', 'refresh without a PDF');
SELECT t_eq((SELECT regexp_replace(return_pdf_url, '^.*/', '') || '|' || COALESCE(pdf_note, '-') FROM public.filing_status WHERE return_type = 'GSTR-3B' AND period_month = '08/2026'),
  'GSTR-3B-AB240826123456X-2.pdf|-', 'checked PDF kept, no note');

-- A different ARN for the same return: nothing changes, a conflict waits.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826999999Z', '2026-09-19',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/08-2026/GSTR-3B-AB240826999999Z.pdf', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'conflict', 'a different ARN is a conflict');
SELECT t_eq((SELECT arn FROM public.filing_status WHERE return_type = 'GSTR-3B' AND period_month = '08/2026'), 'AB240826123456X', 'stored ARN untouched');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status_log WHERE event = 'conflict' AND resolved_at IS NULL), 1, 'one open conflict');

-- An ARN of another month (a wrong e-Filed Returns row) is refused.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-1', '08/2026', 'AA240726123456X', '2026-09-10', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'refused', 'ARN of another period refused');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status WHERE return_type = 'GSTR-1' AND period_month = '08/2026' AND status = 'Filed'), 0, 'nothing filed');
SELECT t_eq((SELECT message FROM public.filing_status_log WHERE event = 'refused' AND return_type = 'GSTR-1'),
  'The pull was not recorded. ARN AA240726123456X is for the tax period 07/2026, not 08/2026.', 'refusal says why');

-- No checked PDF and no portal date: Filed with the ARN, the PDF left out
-- with its reason, the date blank (never CURRENT_DATE).
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-1', '08/2026', 'AA240826123456X', NULL, NULL,
  'The downloaded PDF did not show ARN AA240826123456X.', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'filed', 'filed without a PDF');
SELECT t_eq((SELECT status::text || '/' || COALESCE(filed_date::text, 'no date') || '/' || COALESCE(return_pdf_url, 'no pdf') || '/' || pdf_note
              FROM public.filing_status WHERE return_type = 'GSTR-1' AND period_month = '08/2026'),
  'Filed/no date/no pdf/The downloaded PDF did not show ARN AA240826123456X.', 'no PDF, no date, reason kept');

-- A date that cannot be the filing date (before the period) is left out.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026', 'AB240726123456X', '2026-06-30',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/07-2026/GSTR-3B-AB240726123456X.pdf', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'filed', 'filed with a bad date');
SELECT t_eq((SELECT filed_date FROM public.filing_status WHERE return_type = 'GSTR-3B' AND period_month = '07/2026'), NULL::date, 'bad date left blank');

-- A PDF outside the client's folder is not stored.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-1', '07/2026', 'AA240726123456X', '2026-08-11',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/22222222-2222-2222-2222-222222222222/x.pdf', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'filed', 'filed, foreign PDF dropped');
SELECT t_eq((SELECT return_pdf_url IS NULL FROM public.filing_status WHERE return_type = 'GSTR-1' AND period_month = '07/2026'), true, 'foreign PDF not stored');

-- GSTR-1 from 09/2026 without a push or approval: the direct-filing rule
-- refuses the pull, which is logged and shown.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-1', '09/2026', 'AA240926123456X', current_date - 1,
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/09-2026/GSTR-1-AA240926123456X.pdf', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'refused', 'direct-filing rule refuses the pull');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status_log WHERE event = 'refused' AND period_month = '09/2026'
              AND message LIKE '%was not pushed through GST Keeper%'), 1, 'refusal logged with the rule''s words');
-- Once pushed, the same pull files it.
RESET ROLE;
SELECT public.mark_filing_pushed('11111111-1111-1111-1111-111111111111', 'GSTR-1', '09/2026', NULL);
SET LOCAL ROLE anon;
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-1', '09/2026', 'AA240926123456X', current_date - 1,
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/09-2026/GSTR-1-AA240926123456X.pdf', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'filed', 'pushed return is filed by the pull');

-- Outcomes that write nothing are logged too.
SELECT public.filing_pull_report('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '09/2026', 'not_found',
  'No filed GSTR-3B for 09/2026 on the portal.', '00000000-0000-0000-0000-00000000000c', '{}') IS NOT NULL;
SELECT t_eq((SELECT event || '/' || message FROM public.filing_status_log WHERE event = 'not_found'),
  'not_found/No filed GSTR-3B for 09/2026 on the portal.', 'not found logged');
SELECT t_raises($$SELECT public.filing_pull_report('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '09/2026', 'filed', 'x')$$,
  'Unknown pull outcome', 'only outcomes that wrote nothing');

-- The superadmin decides the conflict. A GST Manager cannot.
SELECT t_raises($$SELECT public.filing_pull_conflict_decide('00000000-0000-0000-0000-00000000000b',
  (SELECT id FROM public.filing_status_log WHERE event = 'conflict'), true)$$, 'Only the superadmin', 'GST Manager cannot decide');
SELECT t_eq((public.filing_pull_conflict_decide('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.filing_status_log WHERE event = 'conflict'), true, 'the portal is right'))->>'outcome', 'accepted', 'superadmin accepts');
SELECT t_eq((SELECT arn || '/' || filed_date::text || '/' || regexp_replace(return_pdf_url, '^.*/', '') || '/' || filed_source
              FROM public.filing_status WHERE return_type = 'GSTR-3B' AND period_month = '08/2026'),
  'AB240826999999Z/2026-09-19/GSTR-3B-AB240826999999Z.pdf/portal', 'pulled ARN, date and PDF applied');
SELECT t_eq((SELECT resolution FROM public.filing_status_log WHERE event = 'conflict'), 'Accepted: the portal is right', 'conflict closed');
SELECT t_raises($$SELECT public.filing_pull_conflict_decide('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.filing_status_log WHERE event = 'conflict'), true)$$, 'already decided', 'decided once');

-- An ARN already on another client's return (same state): a conflict; accepted, that
-- return is taken off Filed first (both logged).
SELECT t_eq((public.filing_record_pull('22222222-2222-2222-2222-222222222222', 'GSTR-1 (IFF)', '07/2026', 'AA240726123456X', '2026-08-12', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'conflict', 'ARN on another client is a conflict');
SELECT t_eq((public.filing_pull_conflict_decide('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.filing_status_log WHERE event = 'conflict' AND resolved_at IS NULL), false, 'keep it'))->>'outcome', 'kept', 'kept');
SELECT t_eq((SELECT arn FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-1' AND period_month = '07/2026'),
  'AA240726123456X', 'kept: nothing moved');
SELECT t_eq((public.filing_record_pull('22222222-2222-2222-2222-222222222222', 'GSTR-1 (IFF)', '07/2026', 'AA240726123456X', '2026-08-12', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'conflict', 'pulled again: conflict again');
SELECT t_eq((public.filing_pull_conflict_decide('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.filing_status_log WHERE event = 'conflict' AND resolved_at IS NULL), true))->>'outcome', 'accepted', 'accepted');
SELECT t_eq((SELECT status::text || '/' || COALESCE(arn, 'none') FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-1' AND period_month = '07/2026'),
  'Prepared/none', 'the other return taken off Filed');
SELECT t_eq((SELECT status::text || '/' || arn || '/' || return_type::text FROM public.filing_status
              WHERE client_id = '22222222-2222-2222-2222-222222222222' AND period_month = '07/2026'),
  'Filed/AA240726123456X/GSTR-1 (IFF)', 'ARN on the pulled return');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status_log WHERE event = 'unfiled' AND old_arn = 'AA240726123456X'), 1, 'taking off logged with the ARN');
