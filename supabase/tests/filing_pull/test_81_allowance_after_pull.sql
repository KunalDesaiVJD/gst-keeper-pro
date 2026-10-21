-- Round 2, defect 2. A pull that files the return with its checked PDF
-- closes the superadmin's allowance for it (used or not): revoked, with the
-- puller as revoked_by, and logged. Staff can then never put a manual upload
-- over the pulled return, even under a later allowance. A pull without a
-- checked PDF leaves the allowance open: the PDF still has to be attached.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '08/2026',
  'filing:GSTR-3B', 'Portal password refused today')).id IS NOT NULL;
-- The password is fixed and the return is pulled with its checked PDF.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/08-2026/GSTR-3B-AB240826123456X-1.pdf',
  NULL, '00000000-0000-0000-0000-00000000000c', '{"ext_version":"0.15.0"}'))->>'outcome', 'filed', 'pulled');
SELECT t_eq((SELECT (revoked_at IS NOT NULL)::text || '/' || COALESCE(revoked_by::text, '-') || '/' || (used_at IS NULL)::text
              FROM public.manual_source_allowances WHERE client_id = '11111111-1111-1111-1111-111111111111' AND period_month = '08/2026'),
  'true/00000000-0000-0000-0000-00000000000c/true', 'the allowance is closed by the pull, the puller named, never used');
SELECT t_eq((SELECT message LIKE '%allowed for this return was closed by this pull%' FROM public.filing_status_log
              WHERE event = 'filed' AND period_month = '08/2026'), true, 'the log says so');
-- Staff cannot attach by hand over it.
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026',
  'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/manual-AB240826123456X-9.pdf')$$,
  'pulled from the portal with its checked PDF', 'no manual upload over a pulled return');
-- Not even under an allowance given after the pull.
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '08/2026',
  'filing:GSTR-3B', 'Allowed again by mistake')).id IS NOT NULL;
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026',
  'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/manual-AB240826123456X-9.pdf')$$,
  'pulled from the portal with its checked PDF', 'refused under a later allowance too');
SELECT t_eq((SELECT filed_source || '/' || regexp_replace(return_pdf_url, '^.*/', '') FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '08/2026'),
  'portal/GSTR-3B-AB240826123456X-1.pdf', 'the pulled return is untouched');
SELECT t_eq((SELECT count(*)::int FROM public.manual_source_allowances WHERE used_at IS NOT NULL), 0, 'no allowance used');

-- A pull without a checked PDF leaves the allowance open, and the PDF can
-- then be attached by hand under it.
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', '06/2026',
  'filing:GSTR-3B (Q)', 'Portal gives only the summary for this quarter')).id IS NOT NULL;
SELECT t_eq((public.filing_record_pull('22222222-2222-2222-2222-222222222222', 'GSTR-3B (Q)', '06/2026', 'AB240626222222X', '2026-07-22',
  NULL, 'The portal gave the System generated summary, not the filed return.', '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'filed', 'filed without a PDF');
SELECT t_eq((SELECT revoked_at IS NULL FROM public.manual_source_allowances WHERE client_id = '22222222-2222-2222-2222-222222222222'),
  true, 'the allowance stays open: the PDF is still missing');
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'GSTR-3B (Q)', '06/2026',
  'AB240626222222X', '2026-07-22',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/22222222-2222-2222-2222-222222222222/GSTR-3B%20(Q)/06-2026/manual-AB240626222222X-1.pdf'))->>'outcome',
  'manual_attach', 'the PDF attached under the allowance');
