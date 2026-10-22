-- Round 3, finding 4: a filing date typed by hand that no pull read is
-- kept and marked (date_note), not shown as the portal's; a pull that reads
-- the date replaces it and clears the mark.

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

-- ── c. A filing date typed by hand ────────────────────────────────────────
-- As the old page left 78 rows: Filed with the click date.
SET LOCAL ROLE postgres;
SET LOCAL session_replication_role = replica;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date, return_pdf_url, is_locked)
VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026', 'Filed', 'AB240726123456X', '2026-10-20',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/07-2026/GSTR-3B-AB240726123456X.pdf', true);
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE anon;
-- Pulled with the checked PDF but no date read.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026', 'AB240726123456X', NULL,
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/07-2026/GSTR-3B-AB240726123456X-1761030000000.pdf',
  NULL, '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'refreshed', 'refreshed, no date read');
SELECT t_eq((SELECT filed_source || '/' || filed_date::text || '/' || COALESCE(date_note, 'no note') FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '07/2026'),
  'portal/2026-10-20/Typed by hand; no pull has read the portal''s filing date yet.', 'the typed date is kept, marked typed by hand');
SELECT t_eq((SELECT message LIKE '%the date typed by hand is kept, marked as such.' FROM public.filing_status_log
              WHERE event = 'refreshed' AND period_month = '07/2026' AND return_type = 'GSTR-3B'), true, 'the log says so');
-- Pulled again, still no date: still marked (the portal row keeps its mark).
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026', 'AB240726123456X', NULL,
  NULL, 'The PDF download did not finish.', '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'refreshed', 'refreshed again');
SELECT t_eq((SELECT COALESCE(date_note, 'no note') FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '07/2026'),
  'Typed by hand; no pull has read the portal''s filing date yet.', 'still marked');
-- A pull that reads the date: the portal's, mark cleared.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026', 'AB240726123456X', '2026-08-19',
  NULL, NULL, '00000000-0000-0000-0000-00000000000c'))->>'filed_date', '2026-08-19', 'the portal''s date');
SELECT t_eq((SELECT COALESCE(date_note, 'no note') FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '07/2026'),
  'no note', 'the mark is cleared');
-- Then a pull without a date keeps the portal's date, unmarked.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026', 'AB240726123456X', NULL,
  NULL, NULL, '00000000-0000-0000-0000-00000000000c'))->>'filed_date', '2026-08-19', 'the portal''s date kept');
SELECT t_eq((SELECT COALESCE(date_note, 'no note') FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '07/2026'),
  'no note', 'and not marked');
-- The mark is written by the routes only.
SELECT t_raises($$UPDATE public.filing_status SET date_note = 'x' WHERE return_type = 'GSTR-3B' AND period_month = '07/2026'$$,
  'GSTR-3B is marked Filed only by the portal pull', 'date_note is written by the routes only');

