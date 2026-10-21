-- Round 2, defects 8 and 11. GSTR-6 and GSTR-7 have a pull (extension
-- 0.15.0 maps them and checks their form name), so they are pulled only:
-- a manual upload needs the superadmin's allowance, as for GSTR-1 / 3B.
-- CMP-08 and ITC-04 (no pull) keep the manual route. Pulling and attaching
-- need the Filing status permission, as the page offers them: an employee
-- without it is refused (and a refused pull is logged).
SET LOCAL session_replication_role = replica;
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000ee', 'employee');
INSERT INTO public.profiles (user_id, first_name) VALUES ('00000000-0000-0000-0000-0000000000ee', 'Esha');
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT t_eq(public.filing_pull_only('GSTR-6') AND public.filing_pull_only('GSTR-7'), true, 'GSTR-6 and GSTR-7 are pulled only');
SELECT t_eq(public.filing_pull_only('CMP-08') OR public.filing_pull_only('ITC-04'), false, 'CMP-08 and ITC-04 keep the manual route');

-- GSTR-7 by hand without an allowance: refused, even with the permission.
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'GSTR-7', '09/2026',
  'AA240926999999K', '2026-10-09',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-7/09-2026/manual-x.pdf')$$,
  'no manual allowance', 'GSTR-7 by hand needs the superadmin''s allowance');
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'GSTR-6', '09/2026',
  'AA240926999998K', '2026-10-09',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-6/09-2026/manual-x.pdf')$$,
  'no manual allowance', 'GSTR-6 too, for the superadmin as well');
-- Direct writes of a filed GSTR-7 name the pull.
SELECT t_raises($$INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, return_pdf_url)
  VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-7', '08/2026', 'Filed', 'AA240826999999K', 'x')$$,
  'GSTR-7 is marked Filed only by the portal pull', 'the guard names the pull for GSTR-7');
-- With an allowance: once.
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '09/2026',
  'filing:GSTR-7', 'Portal down on the due date')).id IS NOT NULL;
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'GSTR-7', '09/2026',
  'AA240926999999K', '2026-10-09',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-7/09-2026/manual-x.pdf'))->>'message',
  'Attached by hand, allowed by the superadmin: Portal down on the due date', 'GSTR-7 attached under the allowance');
-- CMP-08 keeps its manual route, worded as such.
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '44444444-4444-4444-4444-444444444444', 'CMP-08', '09/2026',
  'AA240926777777K', '2026-10-15',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/44444444-4444-4444-4444-444444444444/CMP-08/09-2026/manual-x.pdf'))->>'message',
  'Attached by hand (CMP-08 has no portal pull yet).', 'CMP-08 by hand, no allowance');

-- An employee without the Filing status permission: neither pull nor attach.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  NULL, NULL, '00000000-0000-0000-0000-0000000000ee'))->>'outcome', 'refused', 'pull refused without the permission');
SELECT t_eq((SELECT message LIKE '%Filing status & portal push permission%' FROM public.filing_status_log
              WHERE event = 'refused' AND actor_id = '00000000-0000-0000-0000-0000000000ee'), true, 'logged, naming the permission');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111'
              AND period_month = '08/2026' AND status::text = 'Filed'), 0, 'nothing filed');
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-0000000000ee', '44444444-4444-4444-4444-444444444444', 'CMP-08', '06/2026',
  'AA240626777777K', '2026-07-15',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/44444444-4444-4444-4444-444444444444/CMP-08/06-2026/manual-x.pdf')$$,
  'Filing status & portal push permission', 'attach refused without the permission');
-- The GST Manager and the superadmin pull without the key (their level holds every permission).
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  NULL, NULL, '00000000-0000-0000-0000-00000000000b'))->>'outcome', 'filed', 'GST Manager pulls');
