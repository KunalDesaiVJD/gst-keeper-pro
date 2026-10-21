-- Round 2, defect 3. A scheme change (Edit Client, any staff member with
-- Add/Edit clients, any back date) never takes a return off Filed: only the
-- superadmin does, with a reason (filing_status_unfile). A filed return of a
-- scheme the client has left stays Filed with its ARN, date, PDF and source,
-- and the log says it was kept. A locked row holding no filed return is
-- still reset, as before.
INSERT INTO public.filing_status (client_id, return_type, period_month, status, is_locked) VALUES
  ('11111111-1111-1111-1111-111111111111', 'GSTR-1', '07/2026', 'Prepared', true);
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/08-2026/x.pdf',
  NULL, '00000000-0000-0000-0000-00000000000c', '{}'))->>'outcome', 'filed', 'pulled');

-- An employee changes the scheme from a back date.
INSERT INTO public.client_scheme_history (client_id, old_scheme, new_scheme, effective_from_date, changed_by)
VALUES ('11111111-1111-1111-1111-111111111111', 'Regular', 'Composition', '2017-07-01', '00000000-0000-0000-0000-00000000000c');

SELECT t_eq((SELECT status::text || '/' || arn || '/' || filed_date::text || '/' || filed_source || '/' || (return_pdf_url IS NOT NULL)::text
              FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '08/2026'),
  'Filed/AB240826123456X/2026-09-18/portal/true', 'the filed return stays Filed with everything it holds');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status_log WHERE event = 'scheme_change' AND old_arn = 'AB240826123456X'
               AND new_arn = 'AB240826123456X' AND message LIKE 'Kept Filed%'), 1, 'logged as kept');
SELECT t_eq((SELECT status::text || '/' || is_locked::text FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-1' AND period_month = '07/2026'),
  'Data Pending/false', 'a locked row holding no filed return is still reset');
