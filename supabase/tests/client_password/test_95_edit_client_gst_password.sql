-- Edit Client's GST-password sync (a changed GST password also sets the app
-- login, EditClientPage.performSave) passes p_close_resets false: the staff
-- member was changing the portal password, the client did not ask and has
-- not been told, so a client waiting for staff keeps their request on the
-- Dashboard and a link in their mailbox keeps working. A reset from the reset
-- dialog (the default) still voids links and answers the request.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c9500000-0000-0000-0000-000000000001', 'No Mail Co', '24AAACD9501A1Z1', NULL, 'x'),
 ('c9500000-0000-0000-0000-000000000002', 'Mail Co', '24AAACD9502A1Z2', 'acc@mail.example', 'x'),
 ('c9500000-0000-0000-0000-000000000003', 'Quiet Co', '24AAACD9503A1Z3', 'acc@quiet.example', 'x');
INSERT INTO user_roles (user_id, role) VALUES ('c9500000-0000-0000-0000-0000000000e1', 'employee');
INSERT INTO profiles (user_id, first_name) VALUES ('c9500000-0000-0000-0000-0000000000e1', 'Riya');

-- (1) No e-mail: the client asks; staff are asked ("our team will reset it
-- and contact you").
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACD9501A1Z1'); RESET ROLE;
SELECT t_eq((SELECT status FROM password_reset_requests WHERE user_id = 'c9500000-0000-0000-0000-000000000001'),
  'pending', '(1) a request is waiting for staff');
-- (2) With an e-mail: the link is claimed and sent.
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACD9502A1Z2'); RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r2, token AS t2 FROM client_password_reset_claim(10)
 WHERE client_id = 'c9500000-0000-0000-0000-000000000002' \gset
SELECT client_password_reset_mark(:'r2', NULL);
RESET ROLE;
SET LOCAL ROLE anon;
SELECT t_eq(client_password_reset_check(:'t2') ->> 'valid', 'true', '(2) the client holds a good link');

-- An employee changes each client's GST portal password in Edit Client
-- (the call staffSetClientPassword makes with keepResets: named arguments).
SELECT t_eq(staff_set_client_password(p_actor_id => 'c9500000-0000-0000-0000-0000000000e1',
  p_client_id => 'c9500000-0000-0000-0000-000000000001', p_new_password => 'Portal#2026',
  p_note => 'GST password changed in Edit Client; app login set to match.', p_close_resets => false),
  true, 'the GST-password sync sets the app password (no e-mail client)');
SELECT t_eq(staff_set_client_password(p_actor_id => 'c9500000-0000-0000-0000-0000000000e1',
  p_client_id => 'c9500000-0000-0000-0000-000000000002', p_new_password => 'Portal#2026',
  p_note => 'GST password changed in Edit Client; app login set to match.', p_close_resets => false),
  true, 'and for the client holding a link');
SELECT t_eq(staff_set_client_password(p_actor_id => 'c9500000-0000-0000-0000-0000000000e1',
  p_client_id => 'c9500000-0000-0000-0000-000000000003', p_new_password => 'Portal#2026',
  p_note => 'GST password changed in Edit Client; app login set to match.', p_close_resets => false),
  true, 'and for a client who asked for nothing');
SELECT t_eq(t_login('24AAACD9501A1Z1', 'Portal#2026') AND t_login('24AAACD9502A1Z2', 'Portal#2026')
            AND t_login('24AAACD9503A1Z3', 'Portal#2026'), true, 'the new app password works for all three');
SELECT t_eq(client_password_reset_check(:'t2') ->> 'valid', 'true', 'the link in the client''s mailbox still works');
RESET ROLE;
SELECT t_eq((SELECT status FROM password_reset_requests WHERE user_id = 'c9500000-0000-0000-0000-000000000001'),
  'pending', 'the waiting request stays on the Dashboard, so somebody still contacts the client');
SELECT t_eq((SELECT string_agg(c.name || ': ' || l.detail, ' / ' ORDER BY c.name) FROM client_password_log l
               JOIN clients c ON c.id = l.client_id
              WHERE l.client_id::text LIKE 'c9500000%' AND l.action = 'staff_reset'),
  'Mail Co: GST password changed in Edit Client; app login set to match. The client''s open reset link was kept.'
  || ' / No Mail Co: GST password changed in Edit Client; app login set to match. The request waiting on the Dashboard stays open.'
  || ' / Quiet Co: GST password changed in Edit Client; app login set to match.',
  'logged, saying what was kept');

-- The client uses the link they hold: their own password, the request
-- answered as before.
SET LOCAL ROLE anon;
SELECT t_eq(client_password_reset_complete(:'t2', 'Mine#20266') ->> 'ok', 'true', 'the kept link sets the client''s own password');
SELECT t_eq(t_login('24AAACD9502A1Z2', 'Mine#20266'), true, 'which works');
RESET ROLE;

-- The reset dialog (no p_close_resets: the default) still acts on the
-- client's reset state: it voids the open link and answers the request.
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes'
 WHERE client_id = 'c9500000-0000-0000-0000-000000000002';
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACD9502A1Z2');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r3, token AS t3 FROM client_password_reset_claim(10)
 WHERE client_id = 'c9500000-0000-0000-0000-000000000002' \gset
SELECT client_password_reset_mark(:'r3', NULL);
RESET ROLE;
SET LOCAL ROLE anon;
SELECT t_eq(staff_set_client_password('c9500000-0000-0000-0000-0000000000e1', 'c9500000-0000-0000-0000-000000000002', 'Dialog#2026'),
  true, 'a reset from the dialog');
SELECT t_eq(client_password_reset_check(:'t3') ->> 'valid', 'false', 'voids the open link');
SELECT t_eq(staff_set_client_password('c9500000-0000-0000-0000-0000000000e1', 'c9500000-0000-0000-0000-000000000001', 'Dialog#2026'),
  true, 'and for the client waiting for staff');
RESET ROLE;
SELECT t_eq((SELECT status || ' by ' || resolved_by FROM password_reset_requests WHERE user_id = 'c9500000-0000-0000-0000-000000000001'),
  'resolved by c9500000-0000-0000-0000-0000000000e1', 'answers the waiting request');
SELECT t_eq((SELECT count(*) FROM client_password_log
              WHERE client_id = 'c9500000-0000-0000-0000-000000000001' AND action = 'staff_reset'
                AND detail = 'Password set by staff.'),
  1::bigint, 'logged as a staff reset, with nothing said kept');
ROLLBACK;
