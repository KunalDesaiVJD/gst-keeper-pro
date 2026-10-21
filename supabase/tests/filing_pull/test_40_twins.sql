-- Scheme twins (GSTR-1 and GSTR-1 (IFF) for one period, GSTR-3B and
-- GSTR-3B (Q)): one return, one ARN. The pull lands on the twin that already
-- holds the ARN, else on the type Filing Status shows for the period; the
-- other twin is left alone (the page shows it "Not applicable") and there is
-- no duplicate-key error on UNIQUE(arn).

-- TWIN TRADERS has both GSTR-1 types selected (as GROWQ, 03/2026): the IFF
-- row was Filed by hand with the ARN before this change, the GSTR-1 row only
-- got the same PDF (UNIQUE(arn) refused its ARN).
SELECT public.filing__route('legacy', NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date, return_pdf_url) VALUES
  ('33333333-3333-3333-3333-333333333333', 'GSTR-1 (IFF)', '03/2026', 'Filed', 'AA270326123456X', '2026-04-11',
   'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/33333333-3333-3333-3333-333333333333/GSTR-1 (IFF)/03-2026/1_twin.pdf'),
  ('33333333-3333-3333-3333-333333333333', 'GSTR-1', '03/2026', 'Prepared', NULL, NULL,
   'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/33333333-3333-3333-3333-333333333333/GSTR-1/03-2026/2_twin.pdf');
SELECT public.filing__route_end();

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

-- The pull asks for GSTR-1 (the effective type for this client): the ARN is
-- on the IFF twin, so that row is refreshed. No duplicate key. (Its PDF
-- could not be read this time, so the PDF attached by hand before the rule
-- comes off: round 2, test_80.)
SELECT t_eq((public.filing_record_pull('33333333-3333-3333-3333-333333333333', 'GSTR-1', '03/2026', 'AA270326123456X', '2026-04-11',
  NULL, 'The PDF the portal gave could not be read.', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'return_type',
  'GSTR-1 (IFF)', 'pull refreshes the twin holding the ARN');
SELECT t_eq((SELECT string_agg(return_type::text || ':' || status::text || ':' || COALESCE(arn, '-'), ' ' ORDER BY return_type::text)
              FROM public.filing_status WHERE client_id = '33333333-3333-3333-3333-333333333333' AND period_month = '03/2026'),
  'GSTR-1:Prepared:- GSTR-1 (IFF):Filed:AA270326123456X', 'one twin Filed, the other untouched');

-- A month with no row yet: the pull lands on the type the sheet shows.
-- IMAGINARY IMPEX is an IFF client: its GSTR-1 is the GSTR-1 (IFF) row.
SELECT t_eq((public.filing_record_pull('22222222-2222-2222-2222-222222222222', 'GSTR-1', '08/2026', 'AA240826222222X', '2026-09-12', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'return_type',
  'GSTR-1 (IFF)', 'GSTR-1 pull of an IFF client lands on its IFF row');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status WHERE client_id = '22222222-2222-2222-2222-222222222222'
              AND period_month = '08/2026' AND return_type = 'GSTR-1'), 0, 'no stray GSTR-1 row');
-- Its quarter-end GSTR-3B is the GSTR-3B (Q) row, with its own target date.
SELECT t_eq((public.filing_record_pull('22222222-2222-2222-2222-222222222222', 'GSTR-3B', '06/2026', 'AB240626222222X', '2026-07-22', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'return_type',
  'GSTR-3B (Q)', 'GSTR-3B pull of a quarterly client lands on its (Q) row');
SELECT t_eq((SELECT target_date FROM public.filing_status WHERE client_id = '22222222-2222-2222-2222-222222222222'
              AND period_month = '06/2026'), 20, 'created row has the client''s target date');

-- The same ARN asked for on the other twin by hand: lands on the holder.
RESET ROLE;
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '33333333-3333-3333-3333-333333333333', '03/2026',
  'filing:GSTR-1', 'Attach the PDF the pull could not read')).id IS NOT NULL;
SET LOCAL ROLE anon;
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '33333333-3333-3333-3333-333333333333',
  'GSTR-1', '03/2026', 'AA270326123456X', '2026-04-11',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/33333333-3333-3333-3333-333333333333/GSTR-1/03-2026/manual.pdf'))->>'return_type',
  'GSTR-1 (IFF)', 'manual attach of the same ARN lands on the holder');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status WHERE arn = 'AA270326123456X'), 1, 'the ARN is on one row');
