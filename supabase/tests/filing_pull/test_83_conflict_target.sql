-- Round 2, defect 4. A conflict where the pulled ARN sits on another return
-- also names the ARN this return holds (the panel's "Holds"), so Accept
-- never drops an ARN nobody was shown. Accept is refused when the return
-- holds an ARN the conflict did not show (a conflict logged before this
-- fix, or a row changed since). The holder taken off Filed is unlocked, as
-- Take off Filed does.
INSERT INTO public.clients (id, gstin, name, registration_type, email, selected_returns)
VALUES ('55555555-5555-5555-5555-555555555555', '24BBBBB1111B1Z1', 'SECOND CO', 'Regular', NULL, '{GSTR-1,GSTR-3B}');
SET LOCAL session_replication_role = replica;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date, return_pdf_url, is_locked) VALUES
 ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'Filed', 'AB2408260000ZZZ', '2026-09-20',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/a.pdf', true),
 ('55555555-5555-5555-5555-555555555555', 'GSTR-3B', '08/2026', 'Filed', 'AB240826111111X', '2026-09-20',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/55555555-5555-5555-5555-555555555555/b.pdf', true);
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826111111X', '2026-09-20', NULL, NULL,
  '00000000-0000-0000-0000-00000000000c', '{"ext_version":"0.15.0"}'))->>'outcome', 'conflict', 'conflict');
SELECT t_eq((SELECT (filing_status_id IS NOT NULL)::text || '/' || COALESCE(old_arn, '-') FROM public.filing_status_log WHERE event = 'conflict'),
  'true/AB2408260000ZZZ', 'the conflict names this return''s row and the ARN it holds');
SELECT t_eq((SELECT message LIKE '%SECOND CO%' AND message LIKE '%AB2408260000ZZZ%' FROM public.filing_status_log WHERE event = 'conflict'),
  true, 'the message names both the other return and this one''s ARN');

-- Accepted (the shown ARN is replaced): the holder is taken off Filed and unlocked.
SELECT t_eq((public.filing_pull_conflict_decide('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.filing_status_log WHERE event = 'conflict'), true))->>'outcome', 'accepted', 'accepted');
SELECT t_eq((SELECT string_agg(c.name || ':' || f.status::text || ':' || COALESCE(f.arn, '-') || ':' || f.is_locked::text, ' ' ORDER BY c.name)
              FROM public.filing_status f JOIN public.clients c ON c.id = f.client_id WHERE f.period_month = '08/2026'),
  'FICTIONAL FABRICS:Filed:AB240826111111X:true SECOND CO:Prepared:-:false', 'the ARN moved; the holder is off Filed and unlocked');

-- A conflict logged without this return's ARN (as before this fix): Accept
-- is refused while the return holds an ARN the conflict did not show.
SET LOCAL ROLE postgres;
SET LOCAL session_replication_role = replica;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date, return_pdf_url, is_locked) VALUES
 ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026', 'Filed', 'AB2407260000ZZZ', '2026-08-20',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/c.pdf', true),
 ('55555555-5555-5555-5555-555555555555', 'GSTR-3B', '07/2026', 'Filed', 'AB240726111111X', '2026-08-20',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/55555555-5555-5555-5555-555555555555/d.pdf', true);
INSERT INTO public.filing_status_log (client_id, return_type, period_month, filing_status_id, event, route, actor_id, message, detail)
VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026', NULL, 'conflict', 'portal', '00000000-0000-0000-0000-00000000000c',
  'The portal gave ARN AB240726111111X, but that ARN is on SECOND CO, GSTR-3B 07/2026.',
  '{"pulled": {"arn": "AB240726111111X"}, "pulled_filed_date": "2026-08-20"}');
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE anon;
SELECT t_raises($$SELECT public.filing_pull_conflict_decide('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.filing_status_log WHERE event = 'conflict' AND period_month = '07/2026'), true)$$,
  'which this conflict did not show', 'accept refused: the return''s own ARN was never shown');
SELECT t_eq((SELECT string_agg(COALESCE(arn, '-'), ' ' ORDER BY arn) FROM public.filing_status WHERE period_month = '07/2026'),
  'AB2407260000ZZZ AB240726111111X', 'nothing changed');
-- Keep is still possible.
SELECT t_eq((public.filing_pull_conflict_decide('00000000-0000-0000-0000-00000000000a',
  (SELECT id FROM public.filing_status_log WHERE event = 'conflict' AND period_month = '07/2026'), false))->>'outcome', 'kept', 'kept');
