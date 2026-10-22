-- Round 4, finding 3. "Has this return's pull landed with its checked PDF?"
-- (the migration header's step 7, before a return is made pulled only)
-- counts only pulls that left the checked PDF on the row: the log records
-- the address stored after filing_pdf_url_ok (detail.stored_pdf_url), and
-- filing_pulls_landed() counts the rows whose new PDF is that address. A
-- pull whose PDF address was refused, one that brought no PDF, and one whose
-- request said it stored one do not count.

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

-- s4: an IFF pull whose PDF is in another client's folder: not stored.
SELECT t_eq((public.filing_record_pull('22222222-2222-2222-2222-222222222222', 'GSTR-1 (IFF)', '05/2026', 'AA240526333333K', '2026-06-13',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/05-2026/GSTR-1 (IFF)-AA240526333333K-1761030000000.pdf',
  NULL, '00000000-0000-0000-0000-00000000000c'))->>'pdf_stored', 'false', 's4: the PDF was not stored');
SELECT t_eq((SELECT return_pdf_url FROM public.filing_status WHERE arn = 'AA240526333333K'), NULL::text, 's4: the row has no PDF');
-- A GSTR-3B (Q) pull with no PDF, whose request claims one was stored.
SELECT t_eq((public.filing_record_pull('22222222-2222-2222-2222-222222222222', 'GSTR-3B (Q)', '06/2026', 'AB240626333333K', '2026-07-22',
  NULL, 'The PDF download did not finish.', '00000000-0000-0000-0000-00000000000c',
  '{"stored_pdf_url": "https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/22222222-2222-2222-2222-222222222222/06-2026/x.pdf"}'))->>'outcome',
  'filed', 'a pull without a PDF files the 3B (Q)');
SELECT t_eq((SELECT count(*)::int FROM public.filing_pulls_landed()), 0, 'neither counts as landed with its checked PDF');

-- A pull that stores its checked PDF counts.
SELECT t_eq((public.filing_record_pull('22222222-2222-2222-2222-222222222222', 'GSTR-1 (IFF)', '05/2026', 'AA240526333333K', '2026-06-13',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/22222222-2222-2222-2222-222222222222/05-2026/GSTR-1 (IFF)-AA240526333333K-1761030000000.pdf',
  NULL, '00000000-0000-0000-0000-00000000000c'))->>'pdf_stored', 'true', 'the checked PDF is stored');
-- Pulled again without a PDF: the earlier checked one is kept, not counted twice.
SELECT t_eq((public.filing_record_pull('22222222-2222-2222-2222-222222222222', 'GSTR-1 (IFF)', '05/2026', 'AA240526333333K', '2026-06-13',
  NULL, 'The PDF download did not finish.', '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'refreshed', 'refreshed');
SELECT t_eq((SELECT string_agg(return_type || ' ' || landed, ', ') FROM public.filing_pulls_landed()), 'GSTR-1 (IFF) 1',
  'only the pull that stored its checked PDF counts');
SELECT t_eq(has_function_privilege('anon', 'public.filing_pulls_landed()', 'EXECUTE'), true, 'readable with the app''s key');
