-- Round 2, defect 11, and round 3 (the lead's decision on round 2's defect
-- 8). Pulled only: GSTR-1 and GSTR-3B (the firm's "1 & 3B"); a manual
-- upload of one needs the superadmin's allowance. GSTR-1 (IFF), GSTR-3B (Q),
-- GSTR-6 and GSTR-7 keep a manual route with no allowance until their pull
-- is proven (round 2 had made GSTR-6 / 7 pulled only), as CMP-08 and ITC-04
-- (no pull at all); each says why it may be attached by hand. Pulling and
-- attaching need the Filing status permission, as the page offers them: an
-- employee without it is refused (and a refused pull is logged).
SET LOCAL session_replication_role = replica;
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000ee', 'employee');
INSERT INTO public.profiles (user_id, first_name) VALUES ('00000000-0000-0000-0000-0000000000ee', 'Esha');
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT t_eq(public.filing_pull_only('GSTR-1') AND public.filing_pull_only('GSTR-3B'), true, 'GSTR-1 and GSTR-3B are pulled only');
SELECT t_eq(public.filing_pull_only('GSTR-1 (IFF)') OR public.filing_pull_only('GSTR-3B (Q)') OR public.filing_pull_only('GSTR-6')
  OR public.filing_pull_only('GSTR-7') OR public.filing_pull_only('CMP-08') OR public.filing_pull_only('ITC-04') OR public.filing_pull_only(NULL),
  false, 'IFF, 3B (Q), GSTR-6, GSTR-7, CMP-08 and ITC-04 keep a manual route');
SELECT t_eq(public.filing_manual_reason('GSTR-7') || ' | ' || public.filing_manual_reason('CMP-08') || ' | ' || COALESCE(public.filing_manual_reason('GSTR-3B'), 'none'),
  'the portal pull for GSTR-7 is not proven yet | CMP-08 has no portal pull yet | none', 'the reason for each manual route');

-- GSTR-7 by hand, no allowance: allowed, and it says why.
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'GSTR-7', '09/2026',
  'AA240926999999K', '2026-10-09',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-7/09-2026/manual-x.pdf'))->>'message',
  'Attached by hand (the portal pull for GSTR-7 is not proven yet).', 'GSTR-7 attached by hand without an allowance');
SELECT t_eq((SELECT filed_source || '/' || (manual_allowance_id IS NULL)::text FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-7' AND period_month = '09/2026'),
  'manual/true', 'marked manual, no allowance');
-- GSTR-6 too, by the superadmin.
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'GSTR-6', '09/2026',
  'AA240926999998K', '2026-10-09',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-6/09-2026/manual-x.pdf'))->>'outcome',
  'manual_attach', 'GSTR-6 attached by hand');
-- GSTR-3B by hand without an allowance: refused, even for the superadmin.
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'GSTR-3B', '09/2026',
  'AB240926999997K', '2026-10-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/09-2026/manual-x.pdf')$$,
  'no manual allowance', 'GSTR-3B by hand needs the superadmin''s allowance');
-- Direct writes of a filed GSTR-7 name the attach, of a GSTR-3B the pull.
SELECT t_raises($$INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, return_pdf_url)
  VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-7', '08/2026', 'Filed', 'AA240826999999K', 'x')$$,
  'A filed GSTR-7 is recorded only through Attach filed return', 'the guard names the attach for GSTR-7');
SELECT t_raises($$INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, return_pdf_url)
  VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026', 'Filed', 'AB240726999999K', 'x')$$,
  'GSTR-3B is marked Filed only by the portal pull', 'the guard names the pull for GSTR-3B');
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
