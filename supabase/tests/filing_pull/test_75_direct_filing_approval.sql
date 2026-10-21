-- Round 1, defect 10 (the database side of it): a GSTR-1 from 09/2026 that
-- was filed directly on the portal is recorded once the superadmin approves
-- the direct-filing request (the page's Pull and paperclip now open that
-- request for every staff level): the allowed manual attach goes through,
-- as does the pull. Before the approval both are refused in the words the
-- page shows ("Request approval").
RESET ROLE;
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '09/2026',
  'filing:GSTR-1', 'Portal password changed; filed directly by the client')).id IS NOT NULL;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT t_raises($$SELECT public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
  'GSTR-1', '09/2026', 'AA240926123456X', current_date - 1,
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-1/09-2026/m.pdf')$$,
  'Request approval', 'refused before the approval, naming Request approval');
SELECT t_eq((SELECT used_at IS NULL FROM public.manual_source_allowances WHERE scope = 'filing:GSTR-1'), true, 'allowance still unused');

-- The superadmin approves the request (as decideDirectFilingApproval does).
RESET ROLE;
INSERT INTO public.gstr1_direct_filing_approvals (client_id, return_type, period_month, status, reason)
VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-1', '09/2026', 'approved', 'Filed by the client from their own login.');
SET LOCAL ROLE anon;
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
  'GSTR-1', '09/2026', 'AA240926123456X', current_date - 1,
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-1/09-2026/m.pdf'))->>'outcome',
  'manual_attach', 'attached by the employee after the approval');
SELECT t_eq((SELECT status::text || '/' || filed_source FROM public.filing_status WHERE arn = 'AA240926123456X'), 'Filed/manual', 'Filed, marked manual');
-- A pull of the same return then refreshes it (same ARN).
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-1', '09/2026', 'AA240926123456X', current_date - 1,
  NULL, NULL, '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'refreshed', 'the pull agrees');
