-- Clean-up and settings (migration 20261010100000): notices the portal has
-- moved past close themselves; a client not handled leaves every list and
-- e-mail; a portal password issue is recorded and cleared by a new password.
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, gst_password, inactive_at_hand) VALUES
 ('10400000-0000-0000-0000-000000000001', 'Sweep Works', '24SWEEP0000S1Z5', 'sweep', 'p1', false),
 ('10400000-0000-0000-0000-000000000002', 'Elsewhere Ltd', '24ELSEW0000E1Z5', 'else', 'p2', false);
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, case_id) VALUES
 -- a case: ASMT-10 then DRC-01 then DRC-07
 ('10400000-0000-0000-0000-0000000000a1', '10400000-0000-0000-0000-000000000001', 'notices', 's1', 'Scrutiny Of Returns',
  'Notice for intimating discrepancies in the return after scrutiny (ASMT-10)', ist_today() - 400, 'ZS-1', 'AD-S1'),
 ('10400000-0000-0000-0000-0000000000a2', '10400000-0000-0000-0000-000000000001', 'notices', 's2', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 300, 'ZS-2', 'AD-S1'),
 ('10400000-0000-0000-0000-0000000000a3', '10400000-0000-0000-0000-000000000001', 'notices', 's3', 'Determination Of Tax',
  'Summary of the order (DRC-07)', ist_today() - 200, 'ZS-3', 'AD-S1'),
 -- a DRC-01 replied, no order yet: stays
 ('10400000-0000-0000-0000-0000000000a4', '10400000-0000-0000-0000-000000000001', 'notices', 's4', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 20, 'ZS-4', 'AD-S2'),
 -- registration: an old query, a recent one
 ('10400000-0000-0000-0000-0000000000a5', '10400000-0000-0000-0000-000000000001', 'notices', 's5', 'Registration',
  'Notice for seeking additional information / clarification / documents relating to application for amendment (REG-03)', ist_today() - 500, 'ZS-5', NULL),
 ('10400000-0000-0000-0000-0000000000a6', '10400000-0000-0000-0000-000000000001', 'notices', 's6', 'Registration',
  'Notice for seeking additional information / clarification / documents relating to application for amendment (REG-03)', ist_today() - 3, 'ZS-6', NULL),
 -- the other client's open notice
 ('10400000-0000-0000-0000-0000000000b1', '10400000-0000-0000-0000-000000000002', 'notices', 'e1', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 5, 'ZE-1', 'AD-E1');
INSERT INTO gst_case_folder_items (client_id, case_id, portal_key, reference_number, folder_section, raw_json) VALUES
 ('10400000-0000-0000-0000-000000000001', 'AD-S2', 'REPLY:r1', 'ZS-4', 'REPLY', '{}');

SELECT t_eq((SELECT form_code FROM gst_notices WHERE id = '10400000-0000-0000-0000-0000000000a5'), 'REG-03', 'the registration query is classified');
SELECT public.notices_sweep('10400000-0000-0000-0000-000000000001');
SELECT t_eq((SELECT string_agg(reference_number || '=' || coalesce(close_reason, 'open'), ' ' ORDER BY reference_number)
               FROM gst_notices WHERE client_id = '10400000-0000-0000-0000-000000000001'),
            'ZS-1=auto:superseded_in_case ZS-2=auto:superseded_in_case ZS-3=open ZS-4=open ZS-5=auto:registration_concluded ZS-6=open',
            'moved past: closed; the order, the live reply and the recent query stay');
-- replied and decided: an order arrives in the case of ZS-4
INSERT INTO gst_case_folder_items (client_id, case_id, portal_key, reference_number, folder_section, raw_json) VALUES
 ('10400000-0000-0000-0000-000000000001', 'AD-S2', 'ORDRS:o1', 'ZS-9', 'ORDRS', '{}');
SELECT public.notices_sweep('10400000-0000-0000-0000-000000000001');
SELECT t_eq((SELECT close_reason FROM gst_notices WHERE id = '10400000-0000-0000-0000-0000000000a4'), 'auto:replied_and_decided', 'replied and decided');
-- a person's own status is never touched
UPDATE gst_notices SET staff_status = 'Open' WHERE id = '10400000-0000-0000-0000-0000000000a6';
UPDATE gst_notices SET issue_date = ist_today() - 200 WHERE id = '10400000-0000-0000-0000-0000000000a6';
SELECT public.notices_sweep('10400000-0000-0000-0000-000000000001');
SELECT t_eq((SELECT close_reason FROM gst_notices WHERE id = '10400000-0000-0000-0000-0000000000a6') IS NULL, true, 'triaged: left alone');

-- ── a client not handled ─────────────────────────────────────────────────
SELECT t_eq((SELECT count(*) FROM notice_facts WHERE client_id = '10400000-0000-0000-0000-000000000002')::int, 1, 'handled: listed');
SELECT t_eq(notices_clients_handled_set(ARRAY['10400000-0000-0000-0000-000000000002'::uuid], false), 1, 'switched off');
SELECT t_eq((SELECT count(*) FROM notice_facts WHERE client_id = '10400000-0000-0000-0000-000000000002')::int, 0, 'not handled: in no list');
SELECT t_eq((SELECT notices_sync_excluded FROM clients WHERE id = '10400000-0000-0000-0000-000000000002'), true, 'and not synced');
SELECT t_eq((SELECT open_notices FROM notices_client_settings() WHERE id = '10400000-0000-0000-0000-000000000002')::int, 1, 'the settings page still counts it');
INSERT INTO notice_events (notice_id, client_id, event_type, actor_name) VALUES ('10400000-0000-0000-0000-0000000000b1', '10400000-0000-0000-0000-000000000002', 'stage_changed', 'test 104');
SELECT t_eq((SELECT bool_and(alert_processed_at IS NOT NULL) FROM notice_events WHERE notice_id = '10400000-0000-0000-0000-0000000000b1' AND actor_name = 'test 104'), true, 'no e-mail');
SELECT notices_clients_handled_set(ARRAY['10400000-0000-0000-0000-000000000002'::uuid], true);
SELECT t_eq((SELECT count(*) FROM notice_facts WHERE client_id = '10400000-0000-0000-0000-000000000002')::int, 1, 'back on: listed again');
SELECT t_eq((SELECT notices_sync_excluded FROM clients WHERE id = '10400000-0000-0000-0000-000000000002'), false, 'and synced again');

-- ── a portal password issue ──────────────────────────────────────────────
SELECT client_login_issue_set('10400000-0000-0000-0000-000000000001', 'account_locked', 'Your account has been locked.');
SELECT t_eq((SELECT portal_login_issue FROM notices_client_settings() WHERE id = '10400000-0000-0000-0000-000000000001'), 'account_locked', 'recorded');
UPDATE clients SET name = 'Sweep Works Pvt Ltd' WHERE id = '10400000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT portal_login_issue FROM clients WHERE id = '10400000-0000-0000-0000-000000000001'), 'account_locked', 'another edit keeps it');
UPDATE clients SET gst_password = 'p1-new' WHERE id = '10400000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT portal_login_issue IS NULL AND portal_login_issue_at IS NULL FROM clients WHERE id = '10400000-0000-0000-0000-000000000001'), true, 'a new password clears it');
SELECT client_login_issue_set('10400000-0000-0000-0000-000000000001', 'wrong_password', 'x');
SELECT client_login_issue_set('10400000-0000-0000-0000-000000000001', NULL, NULL);
SELECT t_eq((SELECT portal_login_issue FROM clients WHERE id = '10400000-0000-0000-0000-000000000001') IS NULL, true, 'a login that works clears it');
ROLLBACK;
