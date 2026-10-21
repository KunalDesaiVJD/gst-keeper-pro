-- Filed, the ARN, the filing date and the return PDF cannot be written
-- directly: not by an employee, a GST Manager or the superadmin (the app sends
-- who acts as updated_by; auth.uid() is NULL), not by the old extension's
-- markFiled upsert. Other columns stay writable. Run as PostgREST runs a
-- request: role anon with request.jwt.claims.
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'Prepared'),
  ('11111111-1111-1111-1111-111111111111', 'GSTR-1', '08/2026', 'Prepared');

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT t_raises($$UPDATE public.filing_status SET status = 'Filed', arn = 'AB240826123456X', filed_date = '2026-09-18',
  return_pdf_url = 'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/a.pdf',
  updated_by = '00000000-0000-0000-0000-00000000000c'
  WHERE return_type = 'GSTR-3B' AND period_month = '08/2026'$$, 'marked Filed only by the portal pull', 'employee: manual Filed refused');
SELECT t_raises($$UPDATE public.filing_status SET status = 'Filed', arn = 'AB240826123456X', filed_date = '2026-09-18',
  return_pdf_url = 'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/a.pdf',
  updated_by = '00000000-0000-0000-0000-00000000000b'
  WHERE return_type = 'GSTR-3B' AND period_month = '08/2026'$$, 'marked Filed only by the portal pull', 'GST Manager: manual Filed refused');
SELECT t_raises($$UPDATE public.filing_status SET status = 'Filed', arn = 'AB240826123456X', filed_date = '2026-09-18',
  return_pdf_url = 'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/a.pdf',
  updated_by = '00000000-0000-0000-0000-00000000000a'
  WHERE return_type = 'GSTR-3B' AND period_month = '08/2026'$$, 'marked Filed only by the portal pull', 'superadmin: manual Filed refused');
SELECT t_raises($$UPDATE public.filing_status SET return_pdf_url = 'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/b.pdf'
  WHERE return_type = 'GSTR-1' AND period_month = '08/2026'$$, 'marked Filed only by the portal pull', 'PDF attached by hand refused');
SELECT t_raises($$UPDATE public.filing_status SET arn = 'AA240826123456X' WHERE return_type = 'GSTR-1' AND period_month = '08/2026'$$,
  'marked Filed only by the portal pull', 'ARN typed by hand refused');
SELECT t_raises($$UPDATE public.filing_status SET filed_date = '2026-09-11' WHERE return_type = 'GSTR-1' AND period_month = '08/2026'$$,
  'marked Filed only by the portal pull', 'filing date typed by hand refused');
SELECT t_raises($$UPDATE public.filing_status SET filed_source = 'portal' WHERE return_type = 'GSTR-1' AND period_month = '08/2026'$$,
  'marked Filed only by the portal pull', 'source cannot be faked');
SELECT t_raises($$INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, return_pdf_url)
  VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '07/2026', 'Filed', 'AB240726123456X',
          'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/c.pdf')$$,
  'marked Filed only by the portal pull', 'Filed row inserted by hand refused');
-- Extension 0.14.0's markFiled: an upsert on (client_id, return_type, period_month).
SELECT t_raises($$INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, filed_date, return_pdf_url, updated_at)
  VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'Filed', 'AB240826123456X', '2026-09-18',
          'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/d.pdf', now())
  ON CONFLICT (client_id, return_type, period_month) DO UPDATE
    SET status = EXCLUDED.status, arn = EXCLUDED.arn, filed_date = EXCLUDED.filed_date,
        return_pdf_url = EXCLUDED.return_pdf_url, updated_at = EXCLUDED.updated_at$$,
  'marked Filed only by the portal pull', 'old extension markFiled upsert refused');
-- A return with no pull keeps a manual route, but not a direct one.
SELECT t_raises($$INSERT INTO public.filing_status (client_id, return_type, period_month, status, arn, return_pdf_url)
  VALUES ('44444444-4444-4444-4444-444444444444', 'CMP-08', '09/2026', 'Filed', 'AB240926123456X',
          'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/44444444-4444-4444-4444-444444444444/e.pdf')$$,
  'only through Attach filed return', 'CMP-08 direct Filed refused');

-- Everything else stays writable.
UPDATE public.filing_status SET status = 'Data Pending', remarks = 'waiting for sales', is_nil = true, target_date = 9
 WHERE return_type = 'GSTR-1' AND period_month = '08/2026';
SELECT t_eq((SELECT status::text || '/' || remarks || '/' || is_nil::text || '/' || target_date::text FROM public.filing_status
              WHERE return_type = 'GSTR-1' AND period_month = '08/2026'), 'Data Pending/waiting for sales/true/9', 'other columns writable');
INSERT INTO public.filing_status (client_id, return_type, period_month, status, remarks)
VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '06/2026', 'Data Pending', 'new row');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status WHERE period_month = '06/2026'), 1, 'plain rows can be added');

-- A Filed row cannot be taken off Filed or deleted directly.
RESET ROLE;
SELECT (public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/08-2026/GSTR-3B-AB240826123456X.pdf', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome';
SET LOCAL ROLE anon;
SELECT t_raises($$UPDATE public.filing_status SET status = 'Mismatch in Data', updated_by = '00000000-0000-0000-0000-00000000000b'
  WHERE return_type = 'GSTR-3B' AND period_month = '08/2026'$$, 'marked Filed only by the portal pull', 'GST Manager cannot move a Filed row');
SELECT t_raises($$DELETE FROM public.filing_status WHERE return_type = 'GSTR-3B' AND period_month = '08/2026'$$,
  'cannot be deleted', 'a filed row cannot be deleted');
UPDATE public.filing_status SET remarks = 'checked' WHERE return_type = 'GSTR-3B' AND period_month = '08/2026';
SELECT t_eq((SELECT remarks FROM public.filing_status WHERE return_type = 'GSTR-3B' AND period_month = '08/2026'), 'checked', 'remarks on a Filed row');

-- The allowances and the log are not written directly.
SELECT t_raises($$INSERT INTO public.manual_source_allowances (client_id, period_month, scope, reason, allowed_by)
  VALUES ('11111111-1111-1111-1111-111111111111', '08/2026', 'filing:GSTR-3B', 'portal down all day', '00000000-0000-0000-0000-00000000000a')$$,
  'Only the superadmin', 'allowance cannot be inserted directly');
SELECT t_raises($$INSERT INTO public.filing_status_log (client_id, return_type, period_month, event)
  VALUES ('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026', 'filed')$$, 'permission denied', 'log cannot be written directly');
SELECT t_raises($$DELETE FROM public.filing_status_log$$, 'permission denied', 'log cannot be deleted');
SELECT t_eq((SELECT count(*)::int > 0 FROM public.filing_status_log), true, 'log is readable');

-- What the app and the extension call is open to the anon key; the inner
-- functions are not.
SELECT t_eq(has_function_privilege('anon', 'public.filing_record_pull(uuid, text, text, text, date, text, text, uuid, jsonb)', 'EXECUTE'), true, 'anon: filing_record_pull');
SELECT t_eq(has_function_privilege('anon', 'public.filing_pull_report(uuid, text, text, text, text, uuid, jsonb)', 'EXECUTE'), true, 'anon: filing_pull_report');
SELECT t_eq(has_function_privilege('anon', 'public.filing_attach_manual(uuid, uuid, text, text, text, date, text)', 'EXECUTE'), true, 'anon: filing_attach_manual');
SELECT t_eq(has_function_privilege('anon', 'public.filing_status_unlock(uuid, uuid, text)', 'EXECUTE'), true, 'anon: filing_status_unlock');
SELECT t_eq(has_function_privilege('anon', 'public.filing_status_unfile(uuid, uuid, text)', 'EXECUTE'), true, 'anon: filing_status_unfile');
SELECT t_eq(has_function_privilege('anon', 'public.filing_pull_conflict_decide(uuid, uuid, boolean, text)', 'EXECUTE'), true, 'anon: filing_pull_conflict_decide');
SELECT t_eq(has_function_privilege('anon', 'public.manual_source_allow(uuid, uuid, text, text, text)', 'EXECUTE'), true, 'anon: manual_source_allow');
SELECT t_eq(has_function_privilege('anon', 'public.manual_source_revoke(uuid, uuid)', 'EXECUTE'), true, 'anon: manual_source_revoke');
SELECT t_eq(has_function_privilege('anon', 'public.filing_arn_problem(uuid, text, text, text)', 'EXECUTE'), true, 'anon: filing_arn_problem');
SELECT t_eq(has_function_privilege('anon', 'public.mark_filing_pushed(uuid, text, text, uuid)', 'EXECUTE'), true, 'anon: mark_filing_pushed still');
SELECT t_eq(has_function_privilege('anon', 'public.manual_source_take(uuid, uuid, text, text)', 'EXECUTE'), false, 'anon: not manual_source_take');
SELECT t_eq(has_function_privilege('anon', 'public.filing__route(text, text, uuid, text, jsonb, date, uuid)', 'EXECUTE'), false, 'anon: not filing__route');
SELECT t_eq(has_function_privilege('anon', 'public.filing__log(uuid, text, text, uuid, text, text, uuid, text, jsonb)', 'EXECUTE'), false, 'anon: not filing__log');
SELECT t_eq(has_function_privilege('anon', 'public.filing__target_row(uuid, text, text)', 'EXECUTE'), false, 'anon: not filing__target_row');
SELECT t_eq(has_function_privilege('anon', 'public.filing_status_on_filed(public.filing_status, uuid)', 'EXECUTE'), false, 'anon: not filing_status_on_filed');
SELECT t_eq(has_function_privilege('anon', 'public.filing_queue_confirmation(public.filing_status, uuid)', 'EXECUTE'), false, 'anon: not filing_queue_confirmation');
SELECT t_eq(has_function_privilege('anon', 'public.filing__can_edit(uuid)', 'EXECUTE'), false, 'anon: not filing__can_edit (round 2)');
RESET ROLE;
SELECT t_eq((SELECT count(*)::int FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
              AND tablename IN ('filing_status_log', 'manual_source_allowances', 'gstr1_direct_filing_approvals')), 3, 'realtime tables');
