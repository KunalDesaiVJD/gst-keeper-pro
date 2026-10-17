-- The one answer is not undone elsewhere: the anon key cannot read which
-- identifiers were clients or which had an e-mail. client_password_log is
-- private (staff read it through client_password_log_for, which checks the
-- actor holds a staff level), it shows e-mail addresses only masked, and the
-- open password_reset_requests never carries an address or the reason.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c7000000-0000-0000-0000-000000000001', 'Has Mail Co', '24AAACH0001A1Z1', 'owner.name@hasmail.example', 'x'),
 ('c7000000-0000-0000-0000-000000000002', 'No Mail Co', '24AAACH0002A1Z2', NULL, 'x'),
 ('c7000000-0000-0000-0000-000000000003', 'Bounce Co', '24AAACH0003A1Z3', 'accounts@bounce.example; md@bounce.example', 'x');
INSERT INTO user_roles (user_id, role) VALUES
 ('a7000000-0000-0000-0000-00000000000a', 'superadmin'),
 ('a7000000-0000-0000-0000-00000000000c', 'employee'),
 ('c7000000-0000-0000-0000-000000000001', 'client');
INSERT INTO profiles (user_id, first_name) VALUES ('a7000000-0000-0000-0000-00000000000c', 'Junior');

-- Every kind of entry: asked (with and without an e-mail, and no client at
-- all), sent, failed, staff link, staff reset, used.
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACH0001A1Z1');
SELECT client_password_reset_request('24AAACH0002A1Z2');
SELECT client_password_reset_request('24AAACH0003A1Z3');
SELECT client_password_reset_request('24ZZZZZ0000Z1Z0');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r1, token AS t1 FROM client_password_reset_claim(10) WHERE client_id = 'c7000000-0000-0000-0000-000000000001' \gset
SELECT client_password_reset_mark(:'r1', NULL);
SELECT client_password_reset_mark(id, 'sendMail 550: mailbox unavailable')
  FROM client_password_resets WHERE client_id = 'c7000000-0000-0000-0000-000000000003';
RESET ROLE;
SET LOCAL ROLE anon;
SELECT client_password_reset_complete(:'t1', 'Chosen#2026');
RESET ROLE;
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes';
SET LOCAL ROLE anon;
SELECT staff_send_client_reset_link('a7000000-0000-0000-0000-00000000000c', 'c7000000-0000-0000-0000-000000000003');
SELECT staff_set_client_password('a7000000-0000-0000-0000-00000000000c', 'c7000000-0000-0000-0000-000000000002', 'Staff#20266');
RESET ROLE;

-- The anon key cannot read the log, the attempts or the links.
SET LOCAL ROLE anon;
SELECT t_eq(t_error('SELECT count(*) FROM client_password_log') LIKE 'permission denied%', true, 'anon cannot read the log');
SELECT t_eq(t_error('SELECT count(*) FROM client_password_reset_attempts') LIKE 'permission denied%', true, 'nor the attempts');
SELECT t_eq(t_error('SELECT count(*) FROM client_password_resets') LIKE 'permission denied%', true, 'nor the links');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT t_eq(t_error('SELECT count(*) FROM client_password_log') LIKE 'permission denied%', true, 'authenticated cannot read the log');
RESET ROLE;

-- No full e-mail address anywhere in the log; the masked hint instead.
SELECT t_eq((SELECT count(*) FROM client_password_log l
               JOIN clients c ON c.id = l.client_id
               CROSS JOIN LATERAL unnest(client_email_list(c.email)) e
              WHERE position(lower(e) IN lower(COALESCE(l.detail, ''))) > 0), 0::bigint, 'no e-mail address in the log');
SELECT t_eq((SELECT string_agg(action, ',' ORDER BY action) FROM client_password_log WHERE detail LIKE '%o•••@hasmail.example%'),
  'link_queued,link_sent', 'the hint instead (queued, sent)');
SELECT t_eq((SELECT detail FROM client_password_log WHERE client_id = 'c7000000-0000-0000-0000-000000000003' AND action = 'link_failed'),
  'The reset link could not be e-mailed to a•••@bounce.example + 1 more: sendMail 550: mailbox unavailable', 'a failure, masked');

-- The open table: no address, no reason; nothing for an identifier that is no client.
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE note LIKE '%@%' OR requested_by_name LIKE '%@%'), 0::bigint,
  'no e-mail address in a staff request');
SELECT t_eq((SELECT string_agg(DISTINCT note, ' | ') FROM password_reset_requests),
  'Asked for a reset link; none went out. Edit Client shows why.', 'one note for every reason');
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE requested_by_name LIKE '%24ZZZZZ%'), 0::bigint,
  'nothing filed for an identifier that is no client');

-- Staff read the log through client_password_log_for (the newest first).
SET LOCAL ROLE anon;
SELECT t_eq((SELECT string_agg(action, ',' ORDER BY at DESC, id) FROM client_password_log_for(
    'a7000000-0000-0000-0000-00000000000c', 'c7000000-0000-0000-0000-000000000003')),
  (SELECT string_agg(action, ',' ORDER BY at DESC, id) FROM (SELECT * FROM client_password_log_for(
    'a7000000-0000-0000-0000-00000000000a', 'c7000000-0000-0000-0000-000000000003')) s), 'an employee and the superadmin see the same');
SELECT t_eq((SELECT count(*) FROM client_password_log_for('a7000000-0000-0000-0000-00000000000c', 'c7000000-0000-0000-0000-000000000003')),
  4::bigint, 'queued, failed, staff asked, staff link');
SELECT t_eq((SELECT count(*) FROM client_password_log_for('a7000000-0000-0000-0000-00000000000c', 'c7000000-0000-0000-0000-000000000001', 2)),
  2::bigint, 'a limit');
SELECT t_eq((SELECT actor_name || ': ' || detail FROM client_password_log_for('a7000000-0000-0000-0000-00000000000c', 'c7000000-0000-0000-0000-000000000002')
              WHERE action = 'staff_reset'), 'Junior: Password set by staff.', 'who did what');
SELECT t_eq(t_error($$SELECT * FROM client_password_log_for('c7000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000001')$$),
  'Only a staff member can see a client''s password log.', 'a client cannot, even its own');
SELECT t_eq(t_error($$SELECT * FROM client_password_log_for('a7000000-0000-0000-0000-0000000000ff', 'c7000000-0000-0000-0000-000000000001')$$),
  'Only a staff member can see a client''s password log.', 'an id with no role cannot');
SELECT t_eq(t_error($$SELECT * FROM client_password_log_for(NULL, 'c7000000-0000-0000-0000-000000000001')$$),
  'Only a staff member can see a client''s password log.', 'no actor cannot');
RESET ROLE;
ROLLBACK;
