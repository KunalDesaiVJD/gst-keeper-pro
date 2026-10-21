-- Round 4, finding 2. Accepting a pull conflict follows the rule of
-- filing_record_pull: when the pull brought no checked PDF, a PDF attached
-- by hand on the return (holding no ARN, or the pulled one) stays, marked
-- "attached by hand, not checked by a pull", and a filing date typed by hand
-- stays, marked as such, when the pull read none. Only a PDF stored by
-- extension 0.14.0's own pull, or one that goes with another ARN the
-- conflict showed, is taken off (the log keeps it).

SET LOCAL session_replication_role = replica;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date, return_pdf_url, is_locked) VALUES
 -- s3: 08/2026 Filed by hand with its PDF but no ARN; its ARN typed on 07/2026 by mistake.
 ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'Filed', NULL, '2026-09-18',
  'https://mlgxmhzlqykwdvvybhnk.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/1758000000000_GSTR3B_Aug.pdf', true),
 ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026', 'Filed', 'AB240826123456X', '2026-08-19',
  'https://mlgxmhzlqykwdvvybhnk.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/07-2026/1755000000000_GSTR3B_Jul.pdf', true),
 -- The same for 06/2026, where the pull reads no filing date.
 ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '06/2026', 'Filed', NULL, '2026-07-18',
  'https://mlgxmhzlqykwdvvybhnk.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/06-2026/1752000000000_GSTR3B_Jun.pdf', true),
 ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '05/2026', 'Filed', 'AB240626123456X', '2026-06-19',
  'https://mlgxmhzlqykwdvvybhnk.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/05-2026/1750000000000_GSTR3B_May.pdf', true),
 -- 04/2026: the PDF on the row is one extension 0.14.0's pull stored (unchecked).
 ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '04/2026', 'Filed', NULL, '2026-05-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/04-2026/GSTR-3B-AB240426123456X.pdf', true),
 ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '03/2026', 'Filed', 'AB240426123456X', '2026-04-19',
  'https://mlgxmhzlqykwdvvybhnk.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/03-2026/1745000000000_GSTR3B_Mar.pdf', true);
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

-- ── s3: the portal gave the System generated summary; date read ──────────
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  NULL, 'The portal gave the System generated summary, not the filed return.', '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'conflict', 's3: conflict');
SELECT t_eq((SELECT COALESCE(old_arn, '(none)') || '/' || regexp_replace(old_pdf_url, '^.*/', '') FROM public.filing_status_log
              WHERE event = 'conflict' AND period_month = '08/2026'),
  '(none)/1758000000000_GSTR3B_Aug.pdf', 'the conflict shows the row''s PDF');
SELECT t_eq((public.filing_pull_conflict_decide('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.filing_status_log WHERE event = 'conflict' AND period_month = '08/2026'), true, 'The ARN belongs to August'))->>'outcome',
  'accepted', 's3: accepted');
SELECT t_eq((SELECT status::text || '/' || arn || '/' || filed_source || '/' || regexp_replace(COALESCE(return_pdf_url, 'no pdf'), '^.*/', '')
                    || '/' || filed_date::text || '/' || COALESCE(date_note, 'no date note')
               FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '08/2026'),
  'Filed/AB240826123456X/portal/1758000000000_GSTR3B_Aug.pdf/2026-09-18/no date note', 's3: the PDF attached by hand stays on the return');
SELECT t_eq((SELECT pdf_note FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '08/2026'),
  'Attached by hand, not checked by a pull. The portal gave the System generated summary, not the filed return.',
  's3: marked attached by hand, not checked by a pull');
SELECT t_eq((SELECT message LIKE '%the PDF attached by hand is kept, marked as not checked by a pull.%' FROM public.filing_status_log
              WHERE event = 'conflict_accepted' AND period_month = '08/2026'), true, 's3: the log says so');

-- ── No date read: the date typed by hand stays, marked ───────────────────
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '06/2026', 'AB240626123456X', NULL,
  NULL, 'The PDF download did not finish.', '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'conflict', 'no date: conflict');
SELECT t_eq((public.filing_pull_conflict_decide('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.filing_status_log WHERE event = 'conflict' AND period_month = '06/2026'), true))->>'outcome', 'accepted', 'no date: accepted');
SELECT t_eq((SELECT regexp_replace(COALESCE(return_pdf_url, 'no pdf'), '^.*/', '') || '/' || COALESCE(filed_date::text, 'no date') || '/' || COALESCE(date_note, 'no date note')
               FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '06/2026'),
  '1752000000000_GSTR3B_Jun.pdf/2026-07-18/Typed by hand; no pull has read the portal''s filing date yet.',
  'no date: the PDF and the date typed by hand stay, the date marked');

-- ── A PDF extension 0.14.0's pull stored is taken off, as by a pull ──────
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '04/2026', 'AB240426123456X', '2026-05-18',
  NULL, 'The portal gave the System generated summary, not the filed return.', '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'conflict', 'old pull PDF: conflict');
SELECT t_eq((public.filing_pull_conflict_decide('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.filing_status_log WHERE event = 'conflict' AND period_month = '04/2026'), true))->>'outcome', 'accepted', 'old pull PDF: accepted');
SELECT t_eq((SELECT COALESCE(return_pdf_url, 'no pdf') || '/' || (pdf_note LIKE '%the log keeps its address%')::text
               FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '04/2026'),
  'no pdf/true', 'old pull PDF: taken off, the log keeps it');
SELECT t_eq((SELECT regexp_replace(old_pdf_url, '^.*/', '') FROM public.filing_status_log
              WHERE event = 'conflict_accepted' AND period_month = '04/2026'), 'GSTR-3B-AB240426123456X.pdf', 'old pull PDF: in the log');

-- ── A PDF that goes with another ARN (the one the conflict showed) ───────
SET LOCAL ROLE postgres;
SET LOCAL session_replication_role = replica;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date, return_pdf_url, is_locked) VALUES
 ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '02/2026', 'Filed', 'AB2402260000ZZZ', '2026-03-18',
  'https://mlgxmhzlqykwdvvybhnk.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/02-2026/1741000000000_GSTR3B_Feb.pdf', true),
 ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '01/2026', 'Filed', 'AB240226123456X', '2026-02-19',
  'https://mlgxmhzlqykwdvvybhnk.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/01-2026/1739000000000_GSTR3B_Jan.pdf', true);
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE anon;
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '02/2026', 'AB240226123456X', NULL,
  NULL, 'The PDF download did not finish.', '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'conflict', 'other ARN: conflict');
SELECT t_eq((public.filing_pull_conflict_decide('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.filing_status_log WHERE event = 'conflict' AND period_month = '02/2026'), true))->>'outcome', 'accepted', 'other ARN: accepted');
SELECT t_eq((SELECT COALESCE(return_pdf_url, 'no pdf') || '/' || COALESCE(filed_date::text, 'no date') || '/'
                    || (pdf_note LIKE '%went with ARN AB2402260000ZZZ%')::text
               FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '02/2026'),
  'no pdf/no date/true', 'other ARN: its PDF and date are taken off, and the row says why');
