-- A changed portal password re-queues the client (migration 20261010110000):
-- failures before the change no longer count as failing; it is "not synced".
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, gst_password, inactive_at_hand) VALUES
 ('10500000-0000-0000-0000-000000000001', 'Changed Pass Ltd', '24CHPAS0000C1Z5', 'chpass', 'old', false);
SELECT sync_log_step(NULL, '10500000-0000-0000-0000-000000000001', 'login', 'failed', 'login_failed', 'Invalid Username or Password.');
SELECT t_eq((notices_command_centre(NULL, '{"client": "10500000-0000-0000-0000-000000000001"}') -> 'health' -> 'failing' ->> 'login_failed') IS NOT NULL, true, 'failing before the change');
SELECT client_login_issue_set('10500000-0000-0000-0000-000000000001', 'wrong_password', 'Invalid Username or Password.');
SELECT pg_sleep(0.01);
UPDATE clients SET gst_password = 'new' WHERE id = '10500000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT gst_password_changed_at IS NOT NULL AND portal_login_issue IS NULL FROM clients WHERE id = '10500000-0000-0000-0000-000000000001'), true, 'stamped, issue cleared');
-- (one transaction here: the change is placed after the failure explicitly)
UPDATE clients SET gst_password_changed_at = now() + interval '1 minute' WHERE id = '10500000-0000-0000-0000-000000000001';
SELECT t_eq((notices_command_centre(NULL) -> 'health' -> 'failing' ->> 'login_failed') IS NULL, true, 'no longer failing after the change');
SELECT t_eq((notices_command_centre(NULL) -> 'health' ->> 'never')::int >= 1, true, 'counted as not synced');
-- a later failure with the new password counts again
UPDATE clients SET gst_password_changed_at = now() - interval '1 minute' WHERE id = '10500000-0000-0000-0000-000000000001';
SELECT t_eq((notices_command_centre(NULL) -> 'health' -> 'failing' ->> 'login_failed') IS NOT NULL, true, 'a failure after the change counts again');
ROLLBACK;
