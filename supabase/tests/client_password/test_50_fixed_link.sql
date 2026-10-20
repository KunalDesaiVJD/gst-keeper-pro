-- The link always points at the app, https://gst.vjdesai.com, fixed in the
-- database. notice_settings.app_base_url can be changed with the anon key
-- (the table is open, like every app table): if the link were built from it,
-- anyone could point it at their own site, ask for a reset for any GSTIN and
-- have the firm's mailbox hand that site a working token.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password, is_first_login) VALUES
 ('c5000000-0000-0000-0000-000000000001', 'Victim Pvt Ltd', '24AAACV1234A1Z5', 'victim@example.com',
  extensions.crypt('OldPass#2026', extensions.gen_salt('bf', 4)), false),
 ('c5000000-0000-0000-0000-000000000002', 'Second Victim LLP', '24AAACW1234A1Z6', 'second@example.com', 'x', true);
INSERT INTO user_roles (user_id, role) VALUES ('a5000000-0000-0000-0000-00000000000c', 'employee');
INSERT INTO profiles (user_id, first_name) VALUES ('a5000000-0000-0000-0000-00000000000c', 'Junior');

-- Anyone with the anon key points the app's address at another site ...
SET LOCAL ROLE anon;
UPDATE notice_settings SET app_base_url = 'https://evil.example';
SELECT t_eq((SELECT app_base_url FROM notice_settings), 'https://evil.example', 'anon can change app_base_url (an open table)');
SELECT client_password_reset_request('24AAACV1234A1Z5');
RESET ROLE;

-- ... and the mailer is still handed a link to the app.
SET LOCAL ROLE service_role;
SELECT token AS t1, link AS l1 FROM client_password_reset_claim(10) \gset
RESET ROLE;
SELECT t_eq(starts_with(:'l1', 'https://gst.vjdesai.com/reset-password#token='), true,
  'the claimed link starts with https://gst.vjdesai.com/reset-password#token=');
SELECT t_eq(:'l1', 'https://gst.vjdesai.com/reset-password#token=' || :'t1', 'and is exactly the app''s reset page with the token');
SELECT t_eq(position('evil' IN :'l1'), 0, 'nothing of the planted address');

-- A staff link too, whatever the setting holds.
SET LOCAL ROLE anon;
UPDATE notice_settings SET app_base_url = 'https://gst.vjdesai.com.evil.example/';
SELECT staff_send_client_reset_link('a5000000-0000-0000-0000-00000000000c', 'c5000000-0000-0000-0000-000000000002');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT token AS t2, link AS l2 FROM client_password_reset_claim(10) \gset
RESET ROLE;
SELECT t_eq(:'l2', 'https://gst.vjdesai.com/reset-password#token=' || :'t2', 'a staff link is the app''s too');

-- The real link still works on the app's page.
SET LOCAL ROLE anon;
SELECT t_eq(client_password_reset_check(:'t1') ->> 'valid', 'true', 'the link is good');
RESET ROLE;
ROLLBACK;
