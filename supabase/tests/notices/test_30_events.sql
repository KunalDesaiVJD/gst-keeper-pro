-- Events from the database (migration 20261006112000).
BEGIN;
INSERT INTO clients (id, name, gstin) VALUES ('33333333-0000-0000-0000-000000000001', 'Delta Works', '24DDDDD0000D1Z5');

-- A sync insert (no edited_at): captured by the portal sync.
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, due_date, reference_number)
VALUES ('c0000000-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', 'notices', 'ZD31', 'Notice', 'ASMT-10 scrutiny', ist_today() - 5, ist_today() + 20, 'ZD31');
SELECT t_eq((SELECT actor_name || '/' || source FROM notice_events WHERE notice_id = 'c0000000-0000-0000-0000-000000000001' AND event_type = 'captured'),
            'Portal sync/sync', 'captured by the sync');
SELECT t_eq((SELECT due_date_source FROM gst_notices WHERE id = 'c0000000-0000-0000-0000-000000000001'), 'portal', 'portal due date source');

-- A staff edit: status closed, owner, reply, priority — each its own event, attributed to the person.
UPDATE gst_notices
   SET staff_status = 'Closed', close_reason = 'Replied', assign_to_user_id = '99999999-0000-0000-0000-000000000001', assign_to = 'Riya',
       reply_date = ist_today(), reply_ref_number = 'R-1', priority = 'High',
       edited_by_id = '99999999-0000-0000-0000-000000000002', edited_by_name = 'Kunal', edited_at = now()
 WHERE id = 'c0000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT string_agg(event_type, ',' ORDER BY event_type) FROM notice_events
              WHERE notice_id = 'c0000000-0000-0000-0000-000000000001' AND source = 'staff'),
            'assigned,closed,priority_changed,reply_logged', 'one event per change');
SELECT t_eq((SELECT count(*) FROM notice_events WHERE notice_id = 'c0000000-0000-0000-0000-000000000001'
              AND source = 'staff' AND actor_name = 'Kunal' AND actor_id = '99999999-0000-0000-0000-000000000002'), 4::bigint,
            'staff events carry the person');

-- A sync write that moves the portal due date: due_changed by the portal sync; no event for bookkeeping columns.
UPDATE gst_notices SET due_date = ist_today() + 25, last_seen_at = now() + interval '1 minute', pulled_at = now() + interval '1 minute'
 WHERE id = 'c0000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT actor_name FROM notice_events WHERE notice_id = 'c0000000-0000-0000-0000-000000000001' AND event_type = 'due_changed'),
            'Portal sync', 'due date moved by the portal');
UPDATE gst_notices SET last_seen_at = now() + interval '2 minutes', pulled_at = now() + interval '2 minutes'
 WHERE id = 'c0000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT count(*) FROM notice_events WHERE notice_id = 'c0000000-0000-0000-0000-000000000001'), 6::bigint,
            'a refresh with no change logs nothing');

-- Case rows: the sweep finds the due date in the folder; a sync write without a date keeps it.
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, case_id, reference_number)
VALUES ('c0000000-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000001', 'notices', 'ZA31', 'Determination Of Tax', 'Case', ist_today() - 30, 'AD31', 'ZA31');
INSERT INTO gst_case_folder_items (client_id, case_id, portal_key, folder_section, reference_number, raw_json)
VALUES ('33333333-0000-0000-0000-000000000001', 'AD31', 'NOTCE:N1', 'NOTCE', 'N1',
        jsonb_build_object('refdt', to_char(ist_today() - 3, 'DD/MM/YYYY'), 'sdtls', jsonb_build_object('duedate', to_char(ist_today() + 12, 'DD/MM/YYYY'))));
SELECT t_eq((SELECT event_type || '/' || actor_name FROM notice_events WHERE notice_id = 'c0000000-0000-0000-0000-000000000002'
              AND new_value ->> 'folder_section' = 'NOTCE'), 'notice_issued/Portal sync', 'folder notice logged on the case row');
SELECT notices_sweep('33333333-0000-0000-0000-000000000001');
SELECT t_eq((SELECT due_date FROM gst_notices WHERE id = 'c0000000-0000-0000-0000-000000000002'), ist_today() + 12, 'sweep set the case due date');
SELECT t_eq((SELECT due_date_source FROM gst_notices WHERE id = 'c0000000-0000-0000-0000-000000000002'), 'case_folder', 'case folder source');
SELECT t_eq((SELECT actor_name FROM notice_events WHERE notice_id = 'c0000000-0000-0000-0000-000000000002' AND event_type = 'due_changed'),
            'Closing sweep', 'sweep names itself');
UPDATE gst_notices SET due_date = NULL, last_seen_at = now() + interval '3 minutes', pulled_at = now() + interval '3 minutes'
 WHERE id = 'c0000000-0000-0000-0000-000000000002';
SELECT t_eq((SELECT due_date FROM gst_notices WHERE id = 'c0000000-0000-0000-0000-000000000002'), ist_today() + 12, 'sync write keeps the folder date');
SELECT t_eq((SELECT count(*) FROM notice_events WHERE notice_id = 'c0000000-0000-0000-0000-000000000002' AND event_type = 'due_changed'), 1::bigint,
            'no due-date churn per sync');
-- A later notice in the case moves the date; the sweep keeps it current.
INSERT INTO gst_case_folder_items (client_id, case_id, portal_key, folder_section, reference_number, raw_json)
VALUES ('33333333-0000-0000-0000-000000000001', 'AD31', 'NOTCE:N2', 'NOTCE', 'N2',
        jsonb_build_object('refdt', to_char(ist_today() - 1, 'DD/MM/YYYY'), 'sdtls', jsonb_build_object('duedate', to_char(ist_today() + 20, 'DD/MM/YYYY'))));
SELECT notices_sweep('33333333-0000-0000-0000-000000000001');
SELECT t_eq((SELECT due_date FROM gst_notices WHERE id = 'c0000000-0000-0000-0000-000000000002'), ist_today() + 20, 'sweep follows the latest notice');

-- Order in the folder, closure by the sweep (one "closed" event, by the sweep).
INSERT INTO gst_case_folder_items (client_id, case_id, portal_key, folder_section, reference_number, raw_json)
VALUES ('33333333-0000-0000-0000-000000000001', 'AD31', 'CLSR:C1', 'CLSR', 'C1', '{}');
SELECT notices_sweep('33333333-0000-0000-0000-000000000001');
SELECT t_eq((SELECT count(*) FROM notice_events WHERE notice_id = 'c0000000-0000-0000-0000-000000000002' AND event_type = 'closed' AND actor_name = 'Closing sweep'),
            1::bigint, 'one closed event from the sweep');
SELECT t_eq(current_setting('app.actor_name', true), '', 'sweep restores the actor setting');

-- Removal: a DELETE becomes a soft delete, logged as removed by the sync.
DELETE FROM gst_notices WHERE id = 'c0000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT deleted_at IS NOT NULL FROM gst_notices WHERE id = 'c0000000-0000-0000-0000-000000000001'), true, 'soft deleted');
SELECT t_eq((SELECT actor_name FROM notice_events WHERE notice_id = 'c0000000-0000-0000-0000-000000000001' AND event_type = 'removed'),
            'Portal sync', 'removal logged');
UPDATE gst_case_folder_items SET deleted_at = now() WHERE portal_key = 'NOTCE:N1';
SELECT t_eq((SELECT count(*) FROM notice_events WHERE event_type = 'folder_item_removed'), 1::bigint, 'folder item removal logged');
-- New events wait for the alert engine.
SELECT t_eq((SELECT count(*) FROM notice_events WHERE alert_processed_at IS NOT NULL), 0::bigint, 'events start unprocessed');
ROLLBACK;
