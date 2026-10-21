-- Round 3, finding 5 (the lead's decision): GSTR-1 (IFF) and GSTR-3B (Q)
-- are attached by hand without an allowance, but asking for one of them never
-- files the client's GSTR-1 / GSTR-3B twin row without the superadmin's
-- allowance; their pull still files them from the portal.

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

-- ── d. GSTR-1 (IFF) and GSTR-3B (Q) by hand; not their twins ──────────────
-- IMAGINARY IMPEX (IFF scheme): its GSTR-1 (IFF) and GSTR-3B (Q) by hand,
-- no allowance.
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'GSTR-1 (IFF)', '06/2026',
  'AA240626111111K', '2026-07-13',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/22222222-2222-2222-2222-222222222222/GSTR-1 (IFF)/06-2026/manual-x.pdf'))->>'message',
  'Attached by hand (the portal pull for GSTR-1 (IFF) is not proven yet).', 'GSTR-1 (IFF) by hand without an allowance');
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'GSTR-3B (Q)', '06/2026',
  'AB240626111111K', '2026-07-22',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/22222222-2222-2222-2222-222222222222/GSTR-3B (Q)/06-2026/manual-x.pdf'))->>'return_type',
  'GSTR-3B (Q)', 'GSTR-3B (Q) by hand without an allowance, on its own row');
-- FICTIONAL FABRICS (monthly): asking for GSTR-1 (IFF) / GSTR-3B (Q) lands on
-- its GSTR-1 / GSTR-3B row, so the allowance is needed.
SET LOCAL ROLE postgres;
INSERT INTO public.filing_status (client_id, return_type, period_month, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-1', '06/2026', 'Prepared'),
       ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '06/2026', 'Prepared');
SET LOCAL ROLE anon;
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'GSTR-1 (IFF)', '06/2026',
  'AA240626222222K', '2026-07-11',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-1 (IFF)/06-2026/manual-x.pdf')$$,
  'no manual allowance', 'the IFF door does not file a monthly GSTR-1 without an allowance');
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'GSTR-3B (Q)', '06/2026',
  'AB240626222222K', '2026-07-20',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B (Q)/06-2026/manual-x.pdf')$$,
  'no manual allowance', 'nor the 3B (Q) door a monthly GSTR-3B');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111'
              AND period_month = '06/2026' AND status::text = 'Filed'), 0, 'nothing filed');
-- With the allowance for the GSTR-1 row, it goes through, taking that one.
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '06/2026',
  'filing:GSTR-1', 'Portal down on the due date')).id IS NOT NULL;
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'GSTR-1 (IFF)', '06/2026',
  'AA240626222222K', '2026-07-11',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-1 (IFF)/06-2026/manual-x.pdf'))->>'return_type',
  'GSTR-1', 'with the allowance it lands on the GSTR-1 row');
SELECT t_eq((SELECT used_at IS NOT NULL FROM public.manual_source_allowances WHERE scope = 'filing:GSTR-1' AND period_month = '06/2026'), true, 'and uses the allowance');
-- The pull of an IFF return still works and writes as for GSTR-1.
SELECT t_eq((public.filing_record_pull('22222222-2222-2222-2222-222222222222', 'GSTR-1 (IFF)', '05/2026', 'AA240526333333K', '2026-06-13',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/22222222-2222-2222-2222-222222222222/05-2026/GSTR-1 (IFF)-AA240526333333K-1761030000000.pdf',
  NULL, '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'filed', 'an IFF pull files it from the portal');
SELECT t_eq((SELECT filed_source FROM public.filing_status WHERE arn = 'AA240526333333K'), 'portal', 'marked portal');
