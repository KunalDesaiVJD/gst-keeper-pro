-- The manual route: the superadmin allows one manual upload for a client,
-- period and return, with a reason; a staff member then attaches the PDF and
-- ARN once (the allowance is used up). Without an allowance nobody can, the
-- superadmin included. Returns with no pull (CMP-08 here) keep a manual route
-- without an allowance. Every call as the anon key.
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'Prepared');
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

-- No allowance: refused for every level.
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
  'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/m.pdf')$$,
  'no manual allowance', 'employee without allowance');
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111',
  'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/m.pdf')$$,
  'no manual allowance', 'GST Manager without allowance');
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
  'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/m.pdf')$$,
  'no manual allowance', 'superadmin without allowance');
SELECT t_raises($$SELECT public.filing_attach_manual(NULL, '11111111-1111-1111-1111-111111111111',
  'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/m.pdf')$$,
  'Only staff', 'nobody named');

-- Only the superadmin allows, with a reason.
SELECT t_raises($$SELECT public.manual_source_allow('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', '08/2026', 'filing:GSTR-3B', 'portal password wrong')$$,
  'Only the superadmin', 'employee cannot allow');
SELECT t_raises($$SELECT public.manual_source_allow('00000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', '08/2026', 'filing:GSTR-3B', 'portal password wrong')$$,
  'Only the superadmin', 'GST Manager cannot allow');
SELECT t_raises($$SELECT public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '08/2026', 'filing:GSTR-3B', 'no')$$,
  'reason of at least 5', 'a reason is needed');
SELECT t_raises($$SELECT public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '8/2026', 'filing:GSTR-3B', 'portal password wrong')$$,
  'MM/YYYY', 'period checked');
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '08/2026',
  'filing:GSTR-3B', 'Portal password changed by the client; pull not possible')).id IS NOT NULL;
SELECT t_raises($$SELECT public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '08/2026', 'filing:GSTR-3B', 'second time asked')$$,
  'already allowed', 'one live allowance');

-- The ARN must fit the client and period; the PDF must be in the client's folder.
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
  'GSTR-3B', '08/2026', 'AB270826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/m.pdf')$$,
  'state code 27', 'state code checked');
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
  'GSTR-3B', '08/2026', 'AB240726123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/m.pdf')$$,
  'tax period 07/2026', 'tax period checked');
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
  'GSTR-3B', '08/2026', 'AB2408261234', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/m.pdf')$$,
  'is not an ARN', 'ARN form checked');
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
  'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/22222222-2222-2222-2222-222222222222/m.pdf')$$,
  'Attach the filed return', 'PDF of another client refused');
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
  'GSTR-3B', '08/2026', 'AB240826123456X', '2026-07-30',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/m.pdf')$$,
  'filing date', 'date before the period refused');
-- None of those used the allowance.
SELECT t_eq((SELECT count(*)::int FROM public.manual_source_allowances WHERE used_at IS NULL AND revoked_at IS NULL), 1, 'allowance still unused');

-- Attached once, by an employee.
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
  'GSTR-3B', '08/2026', 'ab240826123456x', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/m.pdf'))->>'outcome',
  'manual_attach', 'attached under the allowance');
SELECT t_eq((SELECT status::text || '/' || arn || '/' || filed_date::text || '/' || filed_source || '/' || (manual_allowance_id IS NOT NULL)::text
              FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '08/2026'),
  'Filed/AB240826123456X/2026-09-18/manual/true', 'row marked manual with the allowance');
SELECT t_eq((SELECT used_by::text FROM public.manual_source_allowances WHERE scope = 'filing:GSTR-3B' AND period_month = '08/2026'),
  '00000000-0000-0000-0000-00000000000c', 'allowance used up by the employee');
SELECT t_eq((SELECT event || '/' || route || '/' || (allowance_id IS NOT NULL)::text || '/' || actor_id::text FROM public.filing_status_log
              WHERE return_type = 'GSTR-3B' AND period_month = '08/2026' AND event = 'manual_attach'),
  'manual_attach/manual/true/00000000-0000-0000-0000-00000000000c', 'logged with the allowance and who');

-- Used once only: taking it off Filed and attaching again needs a new allowance.
SELECT (public.filing_status_unfile('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '08/2026'),
  'wrong PDF attached')).status::text;
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
  'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/n.pdf')$$,
  'no manual allowance', 'a used allowance does not work twice');
SELECT t_raises($$SELECT public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '08/2026', 'filing:GSTR-3B', 'second time asked')$$,
  'was used', 'a used allowance is taken back before another');
SELECT t_raises($$SELECT public.manual_source_revoke('00000000-0000-0000-0000-00000000000b',
  (SELECT id FROM public.manual_source_allowances WHERE scope = 'filing:GSTR-3B' AND period_month = '08/2026'))$$,
  'Only the superadmin', 'GST Manager cannot take back');
SELECT (public.manual_source_revoke('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.manual_source_allowances WHERE scope = 'filing:GSTR-3B' AND period_month = '08/2026'))).revoked_at IS NOT NULL;
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '08/2026',
  'filing:GSTR-3B', 'Wrong PDF the first time; attach the filed return')).id IS NOT NULL;
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111',
  'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/n.pdf'))->>'outcome',
  'manual_attach', 'attached again under a new allowance');
SELECT t_eq((SELECT count(*)::int FROM public.manual_source_allowances WHERE period_month = '08/2026'), 2, 'two allowances on record');

-- A revoked, unused allowance cannot be used.
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '07/2026',
  'filing:GSTR-3B', 'Portal down on the due date')).id IS NOT NULL;
SELECT (public.manual_source_revoke('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.manual_source_allowances WHERE period_month = '07/2026'))).revoked_at IS NOT NULL;
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
  'GSTR-3B', '07/2026', 'AB240726123456X', '2026-08-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/07-2026/m.pdf')$$,
  'no manual allowance', 'a revoked allowance does not work');

-- GSTR-1 from 09/2026 still needs a push or a direct-filing approval; the
-- allowance is not used when that refuses.
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '09/2026',
  'filing:GSTR-1', 'Portal down, pull not possible')).id IS NOT NULL;
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
  'GSTR-1', '09/2026', 'AA240926123456X', current_date - 1,
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-1/09-2026/m.pdf')$$,
  'was not pushed through GST Keeper', 'direct-filing rule still applies');
SELECT t_eq((SELECT used_at IS NULL FROM public.manual_source_allowances WHERE period_month = '09/2026' AND scope = 'filing:GSTR-1'), true,
  'refused attach leaves the allowance unused');

-- A return with no pull (CMP-08): attached without an allowance, still marked manual.
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '44444444-4444-4444-4444-444444444444',
  'CMP-08', '09/2026', 'AB240926123456Y', current_date - 1,
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/44444444-4444-4444-4444-444444444444/CMP-08/09-2026/m.pdf'))->>'outcome',
  'manual_attach', 'CMP-08 manual route kept');
SELECT t_eq((SELECT filed_source || '/' || (manual_allowance_id IS NULL)::text FROM public.filing_status
              WHERE client_id = '44444444-4444-4444-4444-444444444444' AND return_type = 'CMP-08'), 'manual/true', 'CMP-08 marked manual, no allowance');
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '44444444-4444-4444-4444-444444444444',
  'CMP-08', '09/2026', 'AB240926654321Y', current_date - 1,
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/44444444-4444-4444-4444-444444444444/CMP-08/09-2026/o.pdf')$$,
  'already holds ARN', 'a different ARN is not put over a filed one');

-- The client's allowances and filed rows go with the client (the deferred
-- foreign key is checked here, not at the end of the test).
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
DELETE FROM public.clients WHERE id = '11111111-1111-1111-1111-111111111111';
SELECT t_eq((SELECT count(*)::int FROM public.manual_source_allowances WHERE client_id = '11111111-1111-1111-1111-111111111111'), 0, 'allowances deleted with the client');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111'), 0, 'rows deleted with the client');
