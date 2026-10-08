-- A CAPTCHA failure is not a password issue (migration 20261010120000).
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, gst_password, inactive_at_hand) VALUES
 ('10600000-0000-0000-0000-000000000001', 'Captcha Ltd', '24CAPTC0000C1Z5', 'capt', 'pw', false),
 ('10600000-0000-0000-0000-000000000002', 'Refused Ltd', '24REFUS0000C1Z5', 'refu', 'pw', false);
CREATE TEMP TABLE t106 AS SELECT coalesce((notices_command_centre(NULL) -> 'health' -> 'failing' ->> 'login_failed')::int, 0) AS lf,
  coalesce((notices_command_centre(NULL) -> 'health' -> 'failing' ->> 'captcha_failed')::int, 0) AS cf;
-- an older extension: three rejected CAPTCHAs logged as login_failed
SELECT sync_log_step(NULL, '10600000-0000-0000-0000-000000000001', 'login', 'failed', 'login_failed', 'Enter valid Letters shown.');
SELECT sync_log_step(NULL, '10600000-0000-0000-0000-000000000002', 'login', 'failed', 'login_failed', 'Invalid Username or Password. Please try again.');
SELECT t_eq((SELECT reason_class FROM sync_run_items WHERE client_id = '10600000-0000-0000-0000-000000000001'), 'captcha_failed', 'CAPTCHA failure filed as captcha_failed');
SELECT t_eq((SELECT reason_class FROM sync_run_items WHERE client_id = '10600000-0000-0000-0000-000000000002'), 'login_failed', 'refused password stays login_failed');
SELECT t_eq(login_failure_is_captcha('Login did not succeed after 3 automatic retries.'), true, 'old fallback is a CAPTCHA failure');
SELECT t_eq(login_failure_is_captcha('Invalid username, password or captcha'), false, 'a message naming the password is not');
SELECT t_eq((notices_command_centre(NULL) -> 'health' -> 'failing' ->> 'captcha_failed')::int, (SELECT cf + 1 FROM t106), 'status names the CAPTCHA');
SELECT t_eq((notices_command_centre(NULL) -> 'health' -> 'failing' ->> 'login_failed')::int, (SELECT lf + 1 FROM t106), 'only the refused password is a login (password) failure');
SELECT t_eq((SELECT portal_login_issue FROM clients WHERE id = '10600000-0000-0000-0000-000000000001') IS NULL, true, 'no password issue recorded');
ROLLBACK;
