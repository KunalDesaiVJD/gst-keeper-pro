-- Round 2, defects 1 and 5. A pull that brings no checked PDF never lets a
-- PDF stored before it read as the pulled one. A PDF that no pull ever
-- checked (a System generated summary stored by 0.14.0, another month's
-- return attached by hand) is taken off the row (the log keeps its address)
-- and the row says why; a PDF an earlier pull checked is kept; a PDF attached
-- by hand under the superadmin's allowance is kept and still marked manual.

-- A row written before this migration (as 0.14.0 left 28 of them): Filed,
-- its PDF the System generated summary, no source.
SET LOCAL session_replication_role = replica;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date, return_pdf_url, is_locked)
VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '09/2026', 'Filed', 'AB240926000111X', current_date - 3,
  'https://mlgxmhzlqykwdvvybhnk.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/09-2026/GSTR-3B-AB240926000111X.pdf', true);
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

-- Pulled again: the checker refused the summary again, so no PDF comes.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '09/2026', 'AB240926000111X', current_date - 3,
  NULL, 'The portal gave the System generated summary, not the filed return.', '00000000-0000-0000-0000-00000000000c',
  '{"ext_version":"0.15.0"}'::jsonb))->>'outcome', 'refreshed', 'same ARN: refreshed');
SELECT t_eq((SELECT filed_source || '/' || COALESCE(return_pdf_url, 'no pdf') FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '09/2026'),
  'portal/no pdf', 'the unchecked PDF is no longer shown as the portal''s');
SELECT t_eq((SELECT pdf_note LIKE 'The portal gave the System generated summary, not the filed return.%not checked%' FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '09/2026'),
  true, 'the row says why it has no PDF, and that the old one was not checked');
SELECT t_eq((SELECT old_pdf_url FROM public.filing_status_log WHERE event = 'refreshed' AND period_month = '09/2026'),
  'https://mlgxmhzlqykwdvvybhnk.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/09-2026/GSTR-3B-AB240926000111X.pdf',
  'the log keeps the old address');

-- A later pull brings the checked PDF: stored, the note cleared.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '09/2026', 'AB240926000111X', current_date - 3,
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/09-2026/GSTR-3B-AB240926000111X-2.pdf',
  NULL, '00000000-0000-0000-0000-00000000000c'))->>'pdf_stored', 'true', 'checked PDF stored');
-- Pulled once more without a PDF (the download failed this time): the
-- checked PDF stays, with no "not checked" note.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '09/2026', 'AB240926000111X', current_date - 3,
  NULL, 'The PDF download did not finish.', '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'refreshed', 'refreshed again');
SELECT t_eq((SELECT regexp_replace(return_pdf_url, '^.*/', '') || '/' || COALESCE(pdf_note, 'no note') FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '09/2026'),
  'GSTR-3B-AB240926000111X-2.pdf/no note', 'the checked PDF is kept and not called unchecked');

-- Attached by hand under an allowance, then pulled without a PDF: the PDF
-- stays, still marked manual with its allowance.
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '07/2026',
  'filing:GSTR-3B', 'Portal password refused for weeks')).id IS NOT NULL;
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026',
  'AB240726123456X', '2026-08-20',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/07-2026/manual-AB240726123456X-1.pdf'))->>'outcome',
  'manual_attach', 'attached by hand');
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026', 'AB240726123456X', '2026-08-20',
  NULL, 'The portal gave the System generated summary, not the filed return.', '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'refreshed', 'manual row pulled again');
SELECT t_eq((SELECT filed_source || '/' || (manual_allowance_id IS NOT NULL)::text || '/' || regexp_replace(return_pdf_url, '^.*/', '') || '/' || COALESCE(pdf_note, 'no note')
              FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '07/2026'),
  'manual/true/manual-AB240726123456X-1.pdf/no note', 'the manual PDF stays, still marked manual');

-- A Filed row with no ARN (89 of them live) and a PDF: the pull's ARN goes
-- on, the unchecked PDF comes off.
SET LOCAL ROLE postgres;
SET LOCAL session_replication_role = replica;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, return_pdf_url)
VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-1', '08/2026', 'Filed',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/08-2026/GSTR-1.pdf');
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE anon;
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-1', '08/2026', 'AA240826123456X', '2026-09-10',
  NULL, 'No PDF came with the pull.', '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'filed', 'ARN from the portal');
SELECT t_eq((SELECT arn || '/' || COALESCE(return_pdf_url, 'no pdf') FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-1' AND period_month = '08/2026'),
  'AA240826123456X/no pdf', 'the PDF of a row with no ARN was not checked: taken off');
