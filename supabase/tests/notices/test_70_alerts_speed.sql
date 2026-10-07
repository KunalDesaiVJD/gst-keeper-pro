-- The alert engine must finish inside the API's statement timeout as anon
-- (live 2026-10-06: 419 backlog events timed out; migration 20261006117000).
BEGIN;
-- GSTR-3A is hidden everywhere since 20261008180000 (test_100d covers that); this test
-- shows it again, as it was seeded, to keep exercising it.
SELECT notice_type_set('GSTR-3A', 'critical', true, 'Test', false);
INSERT INTO profiles (user_id, first_name, email) VALUES
 ('77777777-0000-0000-0000-00000000000a', 'Riya', 'riya@firm.test'),
 ('77777777-0000-0000-0000-00000000000b', 'Kunal', 'kunal@firm.test');
INSERT INTO user_roles (user_id, role) VALUES
 ('77777777-0000-0000-0000-00000000000a', 'employee'), ('77777777-0000-0000-0000-00000000000b', 'gst_manager');
INSERT INTO clients (id, name, gstin, assigned_accountant)
SELECT ('77777777-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'Client ' || g, '24ZZZZZ' || lpad(g::text, 4, '0') || 'Z1Z5', CASE WHEN g % 2 = 0 THEN 'Riya' END
  FROM generate_series(1, 60) g;
INSERT INTO gst_notices (client_id, source, portal_key, notice_type, description, issue_date, due_date, first_seen_at)
SELECT ('77777777-0000-0000-0000-' || lpad((1 + g % 60)::text, 12, '0'))::uuid, 'notices', 'S' || g,
       CASE WHEN g % 5 = 0 THEN 'Voluntary Payment' ELSE 'Notice' END,
       CASE WHEN g % 5 = 0 THEN 'Acknowledgement of acceptance' WHEN g % 3 = 0 THEN 'Notice to return defaulter u/s 46 for not filing return'
            ELSE 'Scrutiny of returns ASMT-10' END,
       ist_today() - (g % 400), ist_today() + (g % 30) - 15, now() - interval '3 days'
  FROM generate_series(1, 2000) g;
UPDATE notice_events SET alert_processed_at = now();     -- the capture backlog is history here
SELECT notices_sweep(NULL);                                -- ~400 "closed" events, as on the live project
UPDATE gst_notices SET staff_status = 'Reply drafted', edited_by_id = '77777777-0000-0000-0000-00000000000b',
       edited_by_name = 'Kunal', edited_at = now()
 WHERE portal_key IN (SELECT 'S' || g FROM generate_series(1, 2000, 2) g) AND staff_status IS NULL;  -- ~800 status events
UPDATE gst_notices SET assign_to_user_id = '77777777-0000-0000-0000-00000000000a', assign_to = 'Riya',
       edited_by_id = '77777777-0000-0000-0000-00000000000b', edited_by_name = 'Kunal', edited_at = now() + interval '1 second'
 WHERE portal_key IN (SELECT 'S' || g FROM generate_series(2, 600, 2) g);                             -- ~300 assignments
SELECT t_eq((SELECT count(*) > 1400 FROM notice_events WHERE alert_processed_at IS NULL), true, 'a large backlog');
UPDATE notice_settings SET quiet_start = '00:00', quiet_end = '00:00';

SET LOCAL ROLE anon;
SET LOCAL statement_timeout = '3s';
SELECT t_eq((notice_alerts_run('events') -> 'events' ->> 'events_processed')::int > 1400, true, 'backlog processed within 3 s as anon');
SELECT t_eq((notice_alerts_run('all') ->> 'mode'), 'all', 'events and the morning run within 3 s as anon');
RESET statement_timeout;
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM notice_events WHERE alert_processed_at IS NULL), 0::bigint, 'nothing left behind');
SELECT t_eq((SELECT count(*) > 0 FROM email_outbox WHERE template_key = 'notice_assigned'), true, 'assignments alerted');
ROLLBACK;
