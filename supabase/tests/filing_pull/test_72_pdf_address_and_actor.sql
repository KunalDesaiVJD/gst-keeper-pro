-- Round 1, defect 3: the pull door and the manual door store a PDF only at
-- this project's return-pdfs address, in the client's folder, ending .pdf;
-- the pull is recorded only for a staff member's request (who asked, the
-- page's request id and the extension version are logged). The anon key can
-- still forge a staff member's id: this is a record, not a proof.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

-- Another host: Filed from the portal, the PDF not stored.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  'https://files.example.net/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/anything.pdf',
  NULL, '00000000-0000-0000-0000-00000000000c', '{"ext_version":"0.15.0","request_id":"r-1"}'))->>'outcome', 'filed', 'filed');
SELECT t_eq((SELECT COALESCE(return_pdf_url, 'none') || '|' || pdf_note FROM public.filing_status WHERE arn = 'AB240826123456X'),
  'none|The PDF was not in this client''s folder of return PDFs in GST Keeper, so it was not stored.', 'another host not stored');
SELECT t_eq((SELECT (detail->>'ext_version') || '/' || (detail->>'request_id') || '/' || actor_id::text FROM public.filing_status_log WHERE event = 'filed'),
  '0.15.0/r-1/00000000-0000-0000-0000-00000000000c', 'who asked, the request and the extension version logged');

-- A javascript: address, a .html file, a path that climbs out: not stored.
SELECT t_eq(public.filing_pdf_url_ok('11111111-1111-1111-1111-111111111111',
  'javascript:alert(document.domain)//storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/'), false, 'javascript: refused');
SELECT t_eq(public.filing_pdf_url_ok('11111111-1111-1111-1111-111111111111',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/x.html'), false, '.html refused');
SELECT t_eq(public.filing_pdf_url_ok('11111111-1111-1111-1111-111111111111',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/../22222222-2222-2222-2222-222222222222/a.pdf'), false, '.. refused');
SELECT t_eq(public.filing_pdf_url_ok('11111111-1111-1111-1111-111111111111',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/22222222-2222-2222-2222-222222222222/a.pdf'), false, 'another client refused');
SELECT t_eq(public.filing_pdf_url_ok('11111111-1111-1111-1111-111111111111',
  'http://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/a.pdf'), false, 'http refused');
SELECT t_eq(public.filing_pdf_url_ok('11111111-1111-1111-1111-111111111111', NULL), false, 'none is not ok');
-- What the extension and the app store are accepted.
SELECT t_eq(public.filing_pdf_url_ok('22222222-2222-2222-2222-222222222222',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/22222222-2222-2222-2222-222222222222/09-2026/GSTR-3B (Q)-AB240926222222X-1761030000000.pdf'), true, 'extension path');
SELECT t_eq(public.filing_pdf_url_ok('22222222-2222-2222-2222-222222222222',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/22222222-2222-2222-2222-222222222222/GSTR-3B%20(Q)/09-2026/manual-AB240926222333Q-1761030000000.pdf'), true, 'app manual path');

SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026', 'AB240726123456X', '2026-08-18',
  'javascript:alert(document.domain)//storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/',
  NULL, '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'filed', 'filed');
SELECT t_eq((SELECT return_pdf_url IS NULL FROM public.filing_status WHERE arn = 'AB240726123456X'), true, 'javascript: address not stored');

-- The manual door refuses another host outright.
RESET ROLE;
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '06/2026',
  'filing:GSTR-3B', 'Portal down on the due date')).id IS NOT NULL;
SET LOCAL ROLE anon;
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
  'GSTR-3B', '06/2026', 'AB240626123456X', '2026-07-20',
  'https://files.example.net/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/06-2026/m.pdf')$$,
  'Attach the filed return', 'manual: another host refused');
SELECT t_eq((SELECT used_at IS NULL FROM public.manual_source_allowances WHERE period_month = '06/2026'), true, 'allowance not used by the refusal');

-- No staff member behind the pull: refused and logged, nothing written.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-1', '08/2026', 'AA240826123456X', '2026-09-10',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/08-2026/GSTR-1-AA240826123456X.pdf'))->>'outcome',
  'refused', 'no actor: refused');
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-1', '08/2026', 'AA240826123456X', '2026-09-10',
  NULL, NULL, '11111111-1111-1111-1111-111111111111'))->>'outcome', 'refused', 'an id that is not staff: refused');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status WHERE arn = 'AA240826123456X'), 0, 'nothing filed');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status_log WHERE event = 'refused' AND return_type = 'GSTR-1'
              AND message LIKE '%did not come from a GST Keeper staff member%' AND detail->>'ext_version' = 'not given'), 2, 'both refusals logged');
