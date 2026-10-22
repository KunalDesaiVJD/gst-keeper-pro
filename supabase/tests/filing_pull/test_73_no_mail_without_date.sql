-- Round 1, defect 4: no confirmation e-mail while the portal's filing date
-- is not read: not for an old period pulled without a readable date (the
-- 2024-25 re-pulls), not with a blank "filed on". When a later pull reads
-- the date, the confirmation goes then, under the usual rules (once, and
-- not for a return filed more than 30 days ago).
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

-- An old period, no date: Filed, no e-mail.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '04/2024', 'AB240424123456X', NULL,
  NULL, 'No PDF came with the pull.', '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'filed', 'old period filed');
SELECT t_eq((SELECT count(*)::int FROM public.email_outbox WHERE period_month = '04/2024'), 0, 'no e-mail for an old period without a date');
SELECT t_eq((SELECT detail->'on_filed'->>'confirmation' FROM public.filing_status_log WHERE event = 'filed' AND period_month = '04/2024'),
  'skipped: filing date not read', 'the reason is logged');
-- A date before the period is refused to blank: no e-mail either.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-1', '05/2024', 'AA240524123456X', '2024-04-02',
  NULL, NULL, '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'filed', 'filed with a refused date');
SELECT t_eq((SELECT count(*)::int FROM public.email_outbox WHERE period_month = '05/2024'), 0, 'no e-mail when the date was refused');

-- A current return pulled without its date: no e-mail yet ...
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '09/2026', 'AB240926123456X', NULL,
  NULL, NULL, '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'filed', 'filed without a date');
SELECT t_eq((SELECT count(*)::int FROM public.email_outbox WHERE period_month = '09/2026'), 0, 'no e-mail with a blank date');
-- ... and once a later pull reads it, one e-mail with the date.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '09/2026', 'AB240926123456X', current_date - 1,
  NULL, NULL, '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'refreshed', 'refreshed with the date');
SELECT t_eq((SELECT count(*)::int FROM public.email_outbox WHERE period_month = '09/2026'), 1, 'the confirmation goes once the date is read');
SELECT t_eq((SELECT position(to_char(current_date - 1, 'YYYY-MM-DD') IN body) > 0 FROM public.email_outbox WHERE period_month = '09/2026'),
  true, 'with the filing date in it');
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '09/2026', 'AB240926123456X', current_date - 1,
  NULL, NULL, '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'refreshed', 'refreshed again');
SELECT t_eq((SELECT count(*)::int FROM public.email_outbox WHERE period_month = '09/2026'), 1, 'still one');

-- An old period whose date arrives later: still no e-mail (filed long ago).
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '04/2024', 'AB240424123456X', '2024-05-20',
  NULL, NULL, '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'refreshed', 'old period date read');
SELECT t_eq((SELECT count(*)::int FROM public.email_outbox WHERE period_month = '04/2024'), 0, 'still no e-mail for the old period');
