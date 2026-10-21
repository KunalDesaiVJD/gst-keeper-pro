-- Round 3, finding 1 (the lead's decision): a pull that brings no checked
-- PDF never takes a PDF attached by hand off the row: it stays, marked
-- "attached by hand, not checked by a pull", is never counted as checked (no
-- allowance closed by it, a manual upload under an allowance may replace
-- it), and a later pull with the checked PDF replaces it.

-- ── a. A PDF attached by hand before 21 Oct 2026 ─────────────────────────
-- As the old page stored it: <client>/<type>/<MM-YYYY>/<ms>_<file name>,
-- on the old Lovable host (2,474 such rows live).
SET LOCAL session_replication_role = replica;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date, return_pdf_url, is_locked)
VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'Filed', 'AB240826123456X', '2026-09-18',
  'https://mlgxmhzlqykwdvvybhnk.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/1758000000000_GSTR3B_Aug.pdf', true);
SET LOCAL session_replication_role = origin;

-- The superadmin has allowed a manual upload for it (open, unused).
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '08/2026',
  'filing:GSTR-3B', 'Portal password refused for weeks')).id IS NOT NULL;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT t_eq(public.filing_pdf_from_old_pull('https://mlgxmhzlqykwdvvybhnk.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/1758000000000_GSTR3B_Aug.pdf'),
  false, 'a hand upload''s address is not an old pull''s');
SELECT t_eq(public.filing_pdf_from_old_pull('https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/35fcc448-fa13-4d7f-8f7e-abc3b613fbaf/09-2026/GSTR-3B-AB2409267192250.pdf'),
  true, 'extension 0.14.0''s address is');
SELECT t_eq(public.filing_pdf_from_old_pull('https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/c1/09-2026/GSTR-3B-AB240926123456X-1761030000000.pdf')
  OR public.filing_pdf_from_old_pull('https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/c1/GSTR-3B/09-2026/manual-AB240926123456X-1761030000000.pdf')
  OR public.filing_pdf_from_old_pull(NULL),
  false, '0.15.0''s checked PDF and the manual route''s are not');

-- Pulled again: same ARN, the portal gave only the System generated summary.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  NULL, 'The portal gave the System generated summary, not the filed return.', '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'refreshed', 'same ARN: refreshed');
SELECT t_eq((SELECT filed_source || '/' || regexp_replace(COALESCE(return_pdf_url, 'no pdf'), '^.*/', '') FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '08/2026'),
  'portal/1758000000000_GSTR3B_Aug.pdf', 'the PDF attached by hand stays on the row');
SELECT t_eq((SELECT pdf_note FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '08/2026'),
  'Attached by hand, not checked by a pull. The portal gave the System generated summary, not the filed return.', 'marked attached by hand, not checked by a pull');
SELECT t_eq((SELECT message LIKE '%the PDF attached by hand is kept, marked as not checked by a pull.' FROM public.filing_status_log
              WHERE event = 'refreshed' AND period_month = '08/2026'), true, 'the log says so');
SELECT t_eq((SELECT revoked_at IS NULL AND used_at IS NULL FROM public.manual_source_allowances WHERE scope = 'filing:GSTR-3B' AND period_month = '08/2026'),
  true, 'an unchecked PDF closes no allowance');
-- Pulled once more without a PDF: still kept, still marked.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  NULL, 'The PDF download did not finish.', '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'refreshed', 'refreshed again');
SELECT t_eq((SELECT regexp_replace(return_pdf_url, '^.*/', '') || '/' || pdf_note FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '08/2026'),
  '1758000000000_GSTR3B_Aug.pdf/Attached by hand, not checked by a pull. The PDF download did not finish.', 'kept again, marked again');
-- Under the open allowance, a manual upload may replace the unchecked PDF.
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026',
  'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/manual-AB240826123456X-1.pdf'))->>'outcome',
  'manual_attach', 'a manual upload replaces an unchecked PDF');
SELECT t_eq((SELECT filed_source || '/' || COALESCE(pdf_note, 'no note') FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '08/2026'),
  'manual/no note', 'now manual, no note');
-- A pull with the checked PDF replaces it.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/08-2026/GSTR-3B-AB240826123456X-1761030000000.pdf',
  NULL, '00000000-0000-0000-0000-00000000000c'))->>'pdf_stored', 'true', 'checked PDF stored');
SELECT t_eq((SELECT filed_source || '/' || regexp_replace(return_pdf_url, '^.*/', '') || '/' || COALESCE(pdf_note, 'no note') FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '08/2026'),
  'portal/GSTR-3B-AB240826123456X-1761030000000.pdf/no note', 'the checked PDF replaces it');

-- A portal row whose kept PDF is unchecked is not "pulled with its checked
-- PDF": a GSTR-1 07/2026 the same way, then an allowance and an attach.
SET LOCAL ROLE postgres;
SET LOCAL session_replication_role = replica;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date, return_pdf_url)
VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-1', '07/2026', 'Filed', 'AA240726123456X', '2026-08-11',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-1/07-2026/1755000000000_r1.pdf');
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE anon;
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-1', '07/2026', 'AA240726123456X', '2026-08-11',
  NULL, 'The portal gave the consolidated GSTR-1 / GSTR-1A, not the GSTR-1.', '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'refreshed', 'GSTR-1 refreshed');
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '07/2026',
  'filing:GSTR-1', 'Only the consolidated PDF comes from the portal')).id IS NOT NULL;
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'GSTR-1', '07/2026',
  'AA240726123456X', '2026-08-11',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-1/07-2026/manual-AA240726123456X-1.pdf'))->>'outcome',
  'manual_attach', 'attached over the unchecked PDF');

