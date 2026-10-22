-- What follows a return becoming Filed now runs in the database, on every
-- route, once: the client's confirmation e-mail, the advance set-off
-- override stamp, the GSTR-3B (Q) sheet locks; GSTR-3B's own locks and carry
-- forward stay with auto_lock_on_filed. A refresh or a second filing of the
-- same return (after Unlock) queues nothing new.
INSERT INTO public.bills_not_in_2b (client_id, date, supplier_name, period_month) VALUES
  ('11111111-1111-1111-1111-111111111111', '2026-09-03', 'SUPPLIER ONE', '09/2026'),
  ('22222222-2222-2222-2222-222222222222', '2026-09-04', 'SUPPLIER TWO', '09/2026');
INSERT INTO public.itc_summaries (client_id, period_month) VALUES ('22222222-2222-2222-2222-222222222222', '09/2026');
INSERT INTO public.advance_setoff_overrides (client_id, period_month, return_type, status, requested_at) VALUES
  ('11111111-1111-1111-1111-111111111111', '09/2026', 'FILING_STATUS:GSTR-3B', 'APPROVED', now() - interval '2 days'),
  ('11111111-1111-1111-1111-111111111111', '09/2026', 'GSTR-3B', 'REJECTED', now() - interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', '09/2026', 'GSTR-3B', 'APPROVED', now() - interval '3 days'),
  ('11111111-1111-1111-1111-111111111111', '09/2026', 'GSTR-1', 'APPROVED', now() - interval '3 days');

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '09/2026', 'AB240926123456X', current_date - 1,
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/09-2026/GSTR-3B-AB240926123456X.pdf',
  NULL, '00000000-0000-0000-0000-00000000000c'))->>'outcome', 'filed', 'filed by the pull');

-- The confirmation, rendered as the app rendered it.
SELECT t_eq((SELECT count(*)::int FROM public.email_outbox WHERE kind = 'confirmation'), 1, 'one confirmation queued');
SELECT t_eq((SELECT subject FROM public.email_outbox WHERE kind = 'confirmation'),
  'Filed - GSTR-3B for September 2026 | ARN AB240926123456X | FICTIONAL FABRICS', 'subject rendered');
SELECT t_eq((SELECT body FROM public.email_outbox WHERE kind = 'confirmation'),
  'Dear FICTIONAL FABRICS, your GSTR-3B for September 2026 was filed on ' || to_char(current_date - 1, 'YYYY-MM-DD')
  || ' (ARN AB240926123456X). Regards, Chetan', 'body rendered, unknown variable blank, staff named');
SELECT t_eq((SELECT to_email || '/' || status || '/' || (filing_status_id IS NOT NULL)::text || '/' || (render_vars->>'period')
              FROM public.email_outbox WHERE kind = 'confirmation'),
  'owner@fabrics.example/pending/true/September 2026', 'outbox row as before');
-- The advance override: the latest request per key, approved only.
SELECT t_eq((SELECT string_agg(return_type || ':' || status || ':' || filed_after_override::text || ':' || COALESCE(arn, '-'), ' ' ORDER BY return_type, requested_at)
              FROM public.advance_setoff_overrides),
  'FILING_STATUS:GSTR-3B:APPROVED:true:AB240926123456X GSTR-1:APPROVED:false:- GSTR-3B:APPROVED:false:- GSTR-3B:REJECTED:false:-',
  'stamped: the approved Filing Status override; not a superseded or other return''s one');
SELECT t_eq((SELECT bool_and(is_locked) FROM public.bills_not_in_2b WHERE client_id = '11111111-1111-1111-1111-111111111111' AND period_month = '09/2026'),
  true, '3B sheets locked');
SELECT t_eq((SELECT (detail->'on_filed'->>'confirmation') || '/' || (detail->'on_filed'->>'advance_overrides_stamped') FROM public.filing_status_log
              WHERE event = 'filed' AND period_month = '09/2026'), 'queued/1', 'side effects recorded in the log');

-- Pulled again: nothing new.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '09/2026', 'AB240926123456X', current_date - 1, p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'refreshed', 'refreshed');
SELECT t_eq((SELECT count(*)::int FROM public.email_outbox), 1, 'no second e-mail on a refresh');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status_log WHERE detail ? 'on_filed'), 1, 'side effects ran once');

-- Unlock (GST Manager): unlocked, ARN and date kept; an employee without unlock_sheets cannot.
SELECT t_raises($$SELECT public.filing_status_unlock('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', '09/2026')$$,
  'needs the Unlock sheets permission', 'employee without unlock_sheets cannot unlock');
SELECT t_eq(public.filing_status_unlock('00000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', '09/2026'), 1, 'unlocked');
SELECT t_eq((SELECT status::text || '/' || arn || '/' || (filed_date = current_date - 1)::text || '/' || is_locked::text || '/' || filed_source
              FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '09/2026'),
  'Prepared Pending/AB240926123456X/true/false/portal', 'unlocked row keeps the ARN, date and source');
-- Pulled again: Filed again, locked again; still one e-mail.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '09/2026', 'AB240926123456X', current_date - 1, p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'filed', 'filed again after unlock');
SELECT t_eq((SELECT status::text || '/' || is_locked::text FROM public.filing_status
              WHERE client_id = '11111111-1111-1111-1111-111111111111' AND return_type = 'GSTR-3B' AND period_month = '09/2026'),
  'Filed/true', 'locked again');
SELECT t_eq((SELECT count(*)::int FROM public.email_outbox), 1, 'still one e-mail');
SELECT t_eq((SELECT detail->'on_filed'->>'confirmation' FROM public.filing_status_log
              WHERE event = 'filed' AND period_month = '09/2026' AND old_status = 'Prepared Pending'), 'skipped: already queued', 'second filing skipped');

-- GSTR-3B (Q): the sheets and the row are locked, the e-mail queued.
SELECT t_eq((public.filing_record_pull('22222222-2222-2222-2222-222222222222', 'GSTR-3B (Q)', '09/2026', 'AB240926222222X', current_date - 1,
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/22222222-2222-2222-2222-222222222222/09-2026/GSTR-3B (Q)-AB240926222222X.pdf', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'filed', '3B (Q) filed');
SELECT t_eq((SELECT bool_and(is_locked) FROM public.bills_not_in_2b WHERE client_id = '22222222-2222-2222-2222-222222222222'), true, '3B (Q) 2B sheet locked');
SELECT t_eq((SELECT is_locked FROM public.itc_summaries WHERE client_id = '22222222-2222-2222-2222-222222222222'), true, '3B (Q) ITC summary locked');
SELECT t_eq((SELECT is_locked FROM public.filing_status WHERE client_id = '22222222-2222-2222-2222-222222222222' AND period_month = '09/2026'), true, '3B (Q) row locked');
SELECT t_eq((SELECT count(*)::int FROM public.email_outbox WHERE client_id = '22222222-2222-2222-2222-222222222222'), 1, '3B (Q) e-mail queued');

-- The manual route has the same side effects (CMP-08 here).
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '44444444-4444-4444-4444-444444444444',
  'CMP-08', '09/2026', 'AB240926444444X', current_date - 2,
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/44444444-4444-4444-4444-444444444444/CMP-08/09-2026/m.pdf'))->>'outcome',
  'manual_attach', 'CMP-08 attached');
SELECT t_eq((SELECT count(*)::int FROM public.email_outbox WHERE client_id = '44444444-4444-4444-4444-444444444444'), 1, 'manual route e-mails too');

-- No e-mail for a return filed long ago (a pull of an old period), or when the
-- client turned confirmations off, or has no address.
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-3B', '05/2026', 'AB240526123456X', '2026-06-20', p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'filed', 'old return pulled');
SELECT t_eq((SELECT count(*)::int FROM public.email_outbox WHERE period_month = '05/2026'), 0, 'no e-mail for an old filing');
RESET ROLE;
INSERT INTO public.client_reminder_settings (client_id, send_confirmation) VALUES ('11111111-1111-1111-1111-111111111111', false);
SELECT public.mark_filing_pushed('11111111-1111-1111-1111-111111111111', 'GSTR-1', '09/2026', NULL);
SELECT t_eq((SELECT route || '/' || new_status FROM public.filing_status_log WHERE return_type = 'GSTR-1' AND period_month = '09/2026'),
  'push/Pushed', 'a recorded push is logged as such');
SET LOCAL ROLE anon;
SELECT t_eq((public.filing_record_pull('11111111-1111-1111-1111-111111111111', 'GSTR-1', '09/2026', 'AA240926123456X', current_date - 1, p_actor_id => '00000000-0000-0000-0000-00000000000c'))->>'outcome',
  'filed', 'GSTR-1 filed');
SELECT t_eq((SELECT count(*)::int FROM public.email_outbox WHERE return_type = 'GSTR-1'), 0, 'confirmations off: none');
SELECT t_eq((SELECT detail->'on_filed'->>'confirmation' FROM public.filing_status_log WHERE event = 'filed' AND return_type = 'GSTR-1'),
  'skipped: confirmations are off for this client', 'reason logged');
SELECT t_eq((SELECT filed_after_override::text || '/' || arn FROM public.advance_setoff_overrides WHERE return_type = 'GSTR-1'),
  'true/AA240926123456X', 'GSTR-1 page''s approved override stamped');

-- A scheme change keeps filed returns as they are (round 2: only the
-- superadmin takes a return off Filed), and logs them as kept.
RESET ROLE;
INSERT INTO public.client_scheme_history (client_id, old_scheme, new_scheme, effective_from_date, changed_by)
VALUES ('11111111-1111-1111-1111-111111111111', 'Regular', 'IFF', '2026-09-01', '00000000-0000-0000-0000-00000000000a');
SELECT t_eq((SELECT string_agg(return_type::text || ':' || status::text || ':' || COALESCE(arn, '-'), ' ' ORDER BY return_type::text)
              FROM public.filing_status WHERE client_id = '11111111-1111-1111-1111-111111111111' AND period_month = '09/2026'),
  'GSTR-1:Filed:AA240926123456X GSTR-3B:Filed:AB240926123456X', 'a scheme change keeps filed returns');
SELECT t_eq((SELECT count(*)::int FROM public.filing_status_log WHERE event = 'scheme_change' AND old_arn IS NOT NULL AND message LIKE 'Kept Filed%'), 2, 'kept returns logged');
