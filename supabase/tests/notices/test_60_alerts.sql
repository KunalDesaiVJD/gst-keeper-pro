-- Alert engine (migration 20261006115000): preview mode, exactly once, owners,
-- batching, quiet hours, morning list, weekly MIS, opt-outs, escaping, grants.
BEGIN;
INSERT INTO profiles (user_id, first_name, email) VALUES
 ('66666666-0000-0000-0000-00000000000a', 'Riya', 'riya@firm.test'),
 ('66666666-0000-0000-0000-00000000000b', 'Kunal', 'Kunal@Firm.test '),
 ('66666666-0000-0000-0000-00000000000c', 'Asha', 'asha@firm.test'),
 ('66666666-0000-0000-0000-00000000000d', 'Client Login', 'owner@client.test');
INSERT INTO user_roles (user_id, role) VALUES
 ('66666666-0000-0000-0000-00000000000a', 'employee'),
 ('66666666-0000-0000-0000-00000000000b', 'gst_manager'),
 ('66666666-0000-0000-0000-00000000000c', 'superadmin'),
 ('66666666-0000-0000-0000-00000000000d', 'client');
INSERT INTO clients (id, name, gstin, assigned_accountant) VALUES
 ('66666666-0000-0000-0000-000000000001', 'Kappa <Industries> & Co', '24KKKKK0000K1Z5', 'Riya / 3'),
 ('66666666-0000-0000-0000-000000000002', 'Lambda Ltd', '24LLLLL0000L1Z5', NULL);
UPDATE notice_settings SET quiet_start = '00:00', quiet_end = '00:00', computed_clock_from = ist_today() - 60;
SELECT t_eq((SELECT alerts_mode FROM notice_settings), 'preview', 'alerts start in preview');

-- 1. A new notice: owner from the client master, E1 to the owner, written once.
SELECT sync_ingest('66666666-0000-0000-0000-000000000001', NULL, 'notices',
  jsonb_build_array(jsonb_build_object('portal_key', 'K1', 'reference_number', 'K1', 'notice_type', 'Notice',
    'description', 'Intimation of difference in liability DRC-01B', 'issue_date', (ist_today() - 1)::text, 'due_date', (ist_today() + 10)::text)));
SELECT t_eq((SELECT assign_to || '/' || assign_to_user_id FROM gst_notices WHERE portal_key = 'K1'),
            'Riya/66666666-0000-0000-0000-00000000000a', 'owner from the client master');
SELECT notice_alerts_run('events');
SELECT t_eq((SELECT string_agg(to_email || ':' || template_key || ':' || status, ',') FROM email_outbox),
            'riya@firm.test:notice_new:preview', 'E1 to the owner, as a preview');
SELECT t_eq((SELECT body LIKE '%Kappa &lt;Industries&gt; &amp; Co%' FROM email_outbox), true, 'body variables escaped');
SELECT t_eq((SELECT subject FROM email_outbox), 'New Intimation of liability difference, GSTR-1 vs GSTR-3B (DRC-01B) for Kappa <Industries> & Co (24KKKKK0000K1Z5)', 'subject unescaped');
SELECT t_eq((SELECT body LIKE '%<a href="https://gst.vjdesai.com/notices/' || notice_id || '">%' FROM email_outbox), true, 'deep link to the notice page');
SELECT t_eq((SELECT render_vars ->> 'cta_url' FROM email_outbox), 'https://gst.vjdesai.com/notices/' || (SELECT id FROM gst_notices WHERE portal_key = 'K1'), 'Open notice button');
SELECT t_eq((SELECT render_vars ->> 'headline' || ' | ' || (render_vars ->> '_audience') FROM email_outbox), 'New notice captured · due in 10 days | internal', 'internal headline');
SELECT t_eq((SELECT render_vars ->> '_shell' FROM email_outbox), 'notice_alert', 'shell follows days left, not priority: 10 days is calm');
SELECT t_eq((SELECT (render_vars ->> 'stage') || ' | ' || (render_vars ->> 'owner_name') FROM email_outbox), 'New | Riya', 'stage and owner in the facts');
SELECT t_eq((SELECT status FROM notice_alert_log), 'preview', 'logged as preview');
SELECT notice_alerts_run('events');
SELECT t_eq((SELECT count(*) FROM email_outbox), 1::bigint, 'rerun writes nothing twice');

-- 2. Three new notices for a client nobody owns: one e-mail per manager, the client login gets nothing.
SELECT sync_ingest('66666666-0000-0000-0000-000000000002', NULL, 'notices',
  (SELECT jsonb_agg(jsonb_build_object('portal_key', 'L' || g, 'reference_number', 'L' || g, 'notice_type', 'Notice',
     'description', 'ASMT-10 scrutiny ' || g, 'issue_date', (ist_today() - 2)::text, 'due_date', (ist_today() + 20 + g)::text))
     FROM generate_series(1, 3) g));
-- 3. History: a notice issued long ago and long closed on the portal side gets no alert.
SELECT sync_ingest('66666666-0000-0000-0000-000000000001', NULL, 'notices',
  jsonb_build_array(
    jsonb_build_object('portal_key', 'K1', 'reference_number', 'K1', 'notice_type', 'Notice', 'description', 'Intimation of difference in liability DRC-01B', 'issue_date', (ist_today() - 1)::text, 'due_date', (ist_today() + 10)::text),
    jsonb_build_object('portal_key', 'K0', 'reference_number', 'K0', 'notice_type', 'Order', 'description', 'Old order', 'issue_date', (ist_today() - 200)::text)));
SELECT notice_alerts_run('events');
SELECT t_eq((SELECT string_agg(to_email || ':' || template_key, ',' ORDER BY to_email) FROM email_outbox WHERE client_id = '66666666-0000-0000-0000-000000000002'),
            'asha@firm.test:notice_new_batch,kunal@firm.test:notice_new_batch', 'batched per client, to managers');
SELECT t_eq((SELECT subject FROM email_outbox WHERE to_email = 'kunal@firm.test'), '3 new notices for Lambda Ltd (24LLLLL0000L1Z5)', 'batch subject');
SELECT t_eq((SELECT count(*) FROM email_outbox WHERE notice_id = (SELECT id FROM gst_notices WHERE portal_key = 'K0')), 0::bigint, 'history not alerted');
SELECT t_eq((SELECT count(*) FROM notice_events WHERE alert_processed_at IS NULL), 0::bigint, 'every event processed');

-- 4. Assignment by a manager: E6 to the new owner, never to the person who did it.
UPDATE gst_notices SET assign_to_user_id = '66666666-0000-0000-0000-00000000000a', assign_to = 'Riya',
       edited_by_id = '66666666-0000-0000-0000-00000000000b', edited_by_name = 'Kunal', edited_at = now()
 WHERE portal_key = 'L1';
UPDATE gst_notices SET assign_to_user_id = '66666666-0000-0000-0000-00000000000b', assign_to = 'Kunal',
       edited_by_id = '66666666-0000-0000-0000-00000000000b', edited_by_name = 'Kunal', edited_at = now() + interval '1 second'
 WHERE portal_key = 'L2';
SELECT notice_alerts_run('events');
SELECT t_eq((SELECT string_agg(to_email, ',') FROM email_outbox WHERE template_key = 'notice_assigned'), 'riya@firm.test', 'E6 to the new owner only');

-- 5. Quiet hours hold E6 back (E1 is not quiet-hours bound), then it goes.
UPDATE notice_settings SET quiet_start = ((now() AT TIME ZONE 'Asia/Kolkata') - interval '1 hour')::time,
                           quiet_end = ((now() AT TIME ZONE 'Asia/Kolkata') + interval '1 hour')::time;
SELECT t_eq(notice_alerts_in_quiet_hours(), true, 'inside quiet hours');
UPDATE gst_notices SET assign_to_user_id = '66666666-0000-0000-0000-00000000000a', assign_to = 'Riya',
       edited_by_id = '66666666-0000-0000-0000-00000000000b', edited_by_name = 'Kunal', edited_at = now() + interval '2 seconds'
 WHERE portal_key = 'L3';
SELECT sync_ingest('66666666-0000-0000-0000-000000000001', NULL, 'notices',
  jsonb_build_array(
    jsonb_build_object('portal_key', 'K1', 'reference_number', 'K1', 'notice_type', 'Notice', 'description', 'Intimation of difference in liability DRC-01B', 'issue_date', (ist_today() - 1)::text, 'due_date', (ist_today() + 10)::text),
    jsonb_build_object('portal_key', 'K0', 'reference_number', 'K0', 'notice_type', 'Order', 'description', 'Old order', 'issue_date', (ist_today() - 200)::text),
    jsonb_build_object('portal_key', 'K2', 'reference_number', 'K2', 'notice_type', 'Notice', 'description', 'Show cause notice for cancellation REG-17', 'issue_date', ist_today()::text)));
SELECT t_eq((notice_alerts_run('events') -> 'events' ->> 'events_deferred')::int, 1, 'E6 deferred in quiet hours');
SELECT t_eq((SELECT count(*) FROM email_outbox WHERE notice_id = (SELECT id FROM gst_notices WHERE portal_key = 'K2')), 1::bigint, 'E1 not held by quiet hours');
UPDATE notice_settings SET quiet_start = '00:00', quiet_end = '00:00';
SELECT notice_alerts_run('events');
SELECT t_eq((SELECT count(*) FROM email_outbox WHERE template_key = 'notice_assigned'), 2::bigint, 'E6 sent after quiet hours');

-- 6. Opt-out.
INSERT INTO staff_notification_prefs (user_id, channel, alert_kind, enabled) VALUES ('66666666-0000-0000-0000-00000000000a', 'email', 'E6_assigned', false);
UPDATE gst_notices SET assign_to_user_id = NULL, assign_to = NULL, edited_at = now() + interval '3 seconds' WHERE portal_key = 'L1';
UPDATE gst_notices SET assign_to_user_id = '66666666-0000-0000-0000-00000000000a', assign_to = 'Riya',
       edited_by_id = '66666666-0000-0000-0000-00000000000b', edited_by_name = 'Kunal', edited_at = now() + interval '4 seconds'
 WHERE portal_key = 'L1';
SELECT notice_alerts_run('events');
SELECT t_eq((SELECT count(*) FROM email_outbox WHERE template_key = 'notice_assigned'), 2::bigint, 'opt-out respected');

-- 7. Morning list.
INSERT INTO gst_notices (client_id, source, portal_key, notice_type, description, issue_date, due_date, reply_date, hearing_date, first_seen_at, assign_to_user_id, assign_to) VALUES
 ('66666666-0000-0000-0000-000000000001', 'notices', 'D0', 'Notice', 'Due today', ist_today() - 9, ist_today(), NULL, NULL, now() - interval '5 days', '66666666-0000-0000-0000-00000000000a', 'Riya'),
 ('66666666-0000-0000-0000-000000000001', 'notices', 'D1', 'Notice', 'Due tomorrow', ist_today() - 9, ist_today() + 1, NULL, NULL, now() - interval '5 days', '66666666-0000-0000-0000-00000000000a', 'Riya'),
 ('66666666-0000-0000-0000-000000000001', 'notices', 'D1R', 'Notice', 'Due tomorrow, replied', ist_today() - 9, ist_today() + 1, ist_today(), NULL, now() - interval '5 days', '66666666-0000-0000-0000-00000000000a', 'Riya'),
 ('66666666-0000-0000-0000-000000000001', 'notices', 'D3', 'Notice', 'Due in 3', ist_today() - 9, ist_today() + 3, NULL, NULL, now() - interval '5 days', '66666666-0000-0000-0000-00000000000a', 'Riya'),
 ('66666666-0000-0000-0000-000000000001', 'notices', 'D7', 'Notice', 'Due in 7', ist_today() - 9, ist_today() + 7, NULL, ist_today() + 7, now() - interval '5 days', '66666666-0000-0000-0000-00000000000a', 'Riya'),
 ('66666666-0000-0000-0000-000000000001', 'notices', 'DX', 'Notice', 'Overdue', ist_today() - 40, ist_today() - 4, NULL, NULL, now() - interval '5 days', '66666666-0000-0000-0000-00000000000a', 'Riya'),
 ('66666666-0000-0000-0000-000000000001', 'notices', 'A22', 'Order', 'Provisional attachment DRC-22', ist_today() - 358, NULL, NULL, NULL, now() - interval '5 days', '66666666-0000-0000-0000-00000000000a', 'Riya'),
 ('66666666-0000-0000-0000-000000000002', 'notices', 'U1', 'Notice', 'Unowned, due tomorrow', ist_today() - 9, ist_today() + 1, NULL, NULL, now() - interval '5 days', NULL, NULL),
 ('66666666-0000-0000-0000-000000000002', 'notices', 'UX', 'Notice', 'Unowned, overdue', ist_today() - 40, ist_today() - 2, NULL, NULL, now() - interval '5 days', NULL, NULL);
UPDATE notice_events SET alert_processed_at = now() WHERE alert_processed_at IS NULL;
SELECT notice_alerts_run('daily');
SELECT t_eq((SELECT count(*) FROM email_outbox WHERE template_key = 'notice_daily_digest' AND to_email = 'riya@firm.test'), 1::bigint, 'one morning list for the owner');
SELECT t_eq((SELECT subject FROM email_outbox WHERE template_key = 'notice_daily_digest' AND to_email = 'riya@firm.test'),
            'Notices for ' || fmt_ist_date(ist_today()) || ': 1 overdue, 1 due today, 1 due tomorrow, 1 due in 3 days, 1 due in 7 days, 1 hearing soon, 1 clock',
            'owner summary: replied skipped, hearing and DRC-22 expiry included');
SELECT t_eq((SELECT body LIKE '%Provisional attachment lapses (period not yet confirmed by the firm)%' FROM email_outbox
              WHERE template_key = 'notice_daily_digest' AND to_email = 'riya@firm.test'), true, 'unconfirmed period flagged');
SELECT t_eq((SELECT body LIKE '%<em>(no owner)</em>%' AND body NOT LIKE '%Unowned, overdue%' FROM email_outbox
              WHERE template_key = 'notice_daily_digest' AND to_email = 'kunal@firm.test'), true, 'managers get unowned items, overdue ones via E2');
SELECT t_eq((SELECT string_agg(to_email, ',' ORDER BY to_email) FROM email_outbox WHERE template_key = 'notice_overdue_digest'),
            'asha@firm.test,kunal@firm.test', 'E2 to managers');
SELECT t_eq((SELECT body LIKE '%<strong>No owner (1)</strong><br>&bull; <a href="https://gst.vjdesai.com/notices/%">Lambda Ltd &middot; Notice</a> &middot; 2 days overdue%<strong>Riya (1)</strong>%'
              FROM email_outbox WHERE template_key = 'notice_overdue_digest' AND to_email = 'asha@firm.test'), true, 'E2 grouped by owner, unowned first, linked');
SELECT t_eq((SELECT render_vars ->> 'cta_url' FROM email_outbox WHERE template_key = 'notice_overdue_digest' AND to_email = 'asha@firm.test'),
            'https://gst.vjdesai.com/notices-all?filter=overdue', 'E2 opens the overdue list');
SELECT t_eq((SELECT body LIKE '%<a href="https://gst.vjdesai.com/notices/%">Kappa &lt;Industries&gt; &amp; Co &middot; Notice</a> &middot; % &middot; <strong>4 days late</strong>%'
              FROM email_outbox WHERE template_key = 'notice_daily_digest' AND to_email = 'riya@firm.test'), true, 'morning lines linked, with days late');
SELECT t_eq((SELECT count(*) FROM email_outbox WHERE template_key = 'notice_unassigned'), 2::bigint, 'E11 to managers');
SELECT t_eq((SELECT count(*) FROM email_outbox WHERE status <> 'preview'), 0::bigint, 'nothing leaves while in preview');
SELECT t_eq((notice_alerts_run('daily') -> 'daily' ->> 'queued')::int, 0, 'daily rerun writes nothing');

-- 8. Weekly MIS, once per week.
SELECT t_eq((notice_alerts_run('weekly') -> 'weekly' ->> 'queued')::int, 2, 'MIS to both managers');
SELECT t_eq((notice_alerts_run('weekly') -> 'weekly' ->> 'queued')::int, 0, 'MIS once per week');

-- 9. Live and off.
UPDATE notice_settings SET alerts_mode = 'live';
SELECT sync_ingest('66666666-0000-0000-0000-000000000001', NULL, 'notices',
  (SELECT jsonb_agg(jsonb_build_object('portal_key', portal_key, 'reference_number', reference_number, 'notice_type', notice_type,
     'description', description, 'issue_date', issue_date::text, 'due_date', due_date::text))
     FROM gst_notices WHERE client_id = '66666666-0000-0000-0000-000000000001' AND deleted_at IS NULL AND portal_key NOT LIKE 'manual:%')
  || jsonb_build_array(jsonb_build_object('portal_key', 'K9', 'reference_number', 'K9', 'notice_type', 'Notice', 'description', 'ASMT-10', 'issue_date', ist_today()::text)));
SELECT notice_alerts_run('events');
SELECT t_eq((SELECT status FROM email_outbox WHERE notice_id = (SELECT id FROM gst_notices WHERE portal_key = 'K9')), 'pending', 'live mode queues for sending');
UPDATE notice_settings SET alerts_mode = 'off';
SELECT sync_ingest('66666666-0000-0000-0000-000000000002', NULL, 'notices',
  (SELECT jsonb_agg(jsonb_build_object('portal_key', portal_key, 'reference_number', reference_number, 'notice_type', notice_type,
     'description', description, 'issue_date', issue_date::text, 'due_date', due_date::text))
     FROM gst_notices WHERE client_id = '66666666-0000-0000-0000-000000000002' AND deleted_at IS NULL)
  || jsonb_build_array(jsonb_build_object('portal_key', 'L9', 'reference_number', 'L9', 'notice_type', 'Notice', 'description', 'ASMT-10', 'issue_date', ist_today()::text)));
SELECT notice_alerts_run('events');
SELECT t_eq((SELECT count(*) FROM email_outbox WHERE notice_id = (SELECT id FROM gst_notices WHERE portal_key = 'L9')), 0::bigint, 'off writes nothing');
SELECT t_eq((SELECT count(*) FROM notice_events WHERE alert_processed_at IS NULL), 0::bigint, 'off still consumes events');

-- 10. Only the entry points are callable through the API.
SET LOCAL ROLE anon;
SELECT t_eq((notice_alerts_run('events') ->> 'alerts_mode'), 'off', 'anon may run the engine');
DO $$ BEGIN
  PERFORM notice_alert_enqueue('E1_new_notice', 'x@example.com', 'x', NULL, '{}'::jsonb, 'spam');
  RAISE EXCEPTION 'anon must not write e-mails directly';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
ROLLBACK;
