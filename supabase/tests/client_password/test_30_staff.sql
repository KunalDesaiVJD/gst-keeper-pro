-- Staff resets: any staff level (superadmin, GST Manager, an employee with no
-- permission keys) can set a client's password or e-mail it a link; a client
-- or an unknown id cannot; every reset is logged and voids open links.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password, is_first_login) VALUES
 ('c3000000-0000-0000-0000-000000000001', 'Navratna Highway Test Pvt Ltd', '24AAACN0000A1ZK', 'p.owner@navratna.com',
  extensions.crypt('OldPass#2026', extensions.gen_salt('bf', 4)), false),
 ('c3000000-0000-0000-0000-000000000002', 'No Mail Traders', '24AAACM0000B1Z5', NULL, 'x', true);
INSERT INTO user_roles (user_id, role) VALUES
 ('a3000000-0000-0000-0000-00000000000a', 'superadmin'),
 ('a3000000-0000-0000-0000-00000000000b', 'gst_manager'),
 ('a3000000-0000-0000-0000-00000000000c', 'employee'),
 ('c3000000-0000-0000-0000-000000000001', 'client');
INSERT INTO profiles (user_id, first_name) VALUES
 ('a3000000-0000-0000-0000-00000000000a', 'Admin'),
 ('a3000000-0000-0000-0000-00000000000b', 'Manager'),
 ('a3000000-0000-0000-0000-00000000000c', 'Junior');
INSERT INTO password_reset_requests (user_id, requested_by_name, status)
VALUES ('c3000000-0000-0000-0000-000000000001', 'Navratna (24AAACN0000A1ZK)', 'pending');

-- An open link, to see a staff reset void it.
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACN0000A1ZK');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT token AS t1 FROM client_password_reset_claim(10) \gset
RESET ROLE;

SET LOCAL ROLE anon;
-- An employee with no permission keys at all, called the way PostgREST does (named arguments, no note).
SELECT t_eq(staff_set_client_password(p_actor_id => 'a3000000-0000-0000-0000-00000000000c',
  p_client_id => 'c3000000-0000-0000-0000-000000000001', p_new_password => 'Employee#2026'), true, 'an employee can reset');
SELECT t_eq(t_login('24AAACN0000A1ZK', 'Employee#2026'), true, 'the employee''s password works');
SELECT t_eq(t_login('24AAACN0000A1ZK', 'OldPass#2026'), false, 'the old one does not');
SELECT t_eq(client_password_reset_check(:'t1') ->> 'valid', 'false', 'a staff reset voids the open link');
SELECT t_eq(staff_set_client_password('a3000000-0000-0000-0000-00000000000b', 'c3000000-0000-0000-0000-000000000001', 'Manager#2026',
  'GST password changed in Edit Client.'), true, 'a GST Manager can reset');
SELECT t_eq(staff_set_client_password('a3000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-000000000001', '24AAACN0000A1ZK'),
  true, 'the superadmin can reset (to the GSTIN, so the client must change it at first sign-in)');
SELECT t_eq(t_login('24AAACN0000A1ZK', '24AAACN0000A1ZK'), true, 'superadmin''s password works');
SELECT t_eq(staff_set_client_password('a3000000-0000-0000-0000-00000000000c', gen_random_uuid(), 'Nobody#2026'), false,
  'an unknown client: nothing changed');

-- Not staff: refused, nothing changed.
SELECT t_eq(t_error($$SELECT staff_set_client_password('c3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'Client#2026')$$),
  'Only a staff member can reset a client''s password.', 'a client id as actor is refused');
SELECT t_eq(t_error($$SELECT staff_set_client_password('a3000000-0000-0000-0000-0000000000ff', 'c3000000-0000-0000-0000-000000000001', 'Ghost#20266')$$),
  'Only a staff member can reset a client''s password.', 'an id with no role is refused');
SELECT t_eq(t_error($$SELECT staff_set_client_password(NULL, 'c3000000-0000-0000-0000-000000000001', 'Ghost#20266')$$),
  'Only a staff member can reset a client''s password.', 'no actor is refused');
SELECT t_eq(t_error($$SELECT staff_set_client_password('a3000000-0000-0000-0000-00000000000c', 'c3000000-0000-0000-0000-000000000001', 'short')$$),
  'The new password must be at least 8 characters.', 'at least 8 characters');
SELECT t_eq(t_login('24AAACN0000A1ZK', '24AAACN0000A1ZK'), true, 'refusals changed nothing');
RESET ROLE;

SELECT t_eq((SELECT is_first_login FROM clients WHERE id = 'c3000000-0000-0000-0000-000000000001'), true, 'a staff reset keeps is_first_login on');
SELECT t_eq((SELECT client_password LIKE '$2a$10$%' FROM clients WHERE id = 'c3000000-0000-0000-0000-000000000001'), true, 'stored as bcrypt');
SELECT t_eq((SELECT string_agg(actor_name || ': ' || detail, ' / ' ORDER BY actor_name DESC) FROM client_password_log
              WHERE client_id = 'c3000000-0000-0000-0000-000000000001' AND action = 'staff_reset'),
  'Manager: GST password changed in Edit Client. / Junior: Password set by staff. / Admin: Password set by staff.',
  'every staff reset logged, with who did it');
SELECT t_eq((SELECT status || ' by ' || resolved_by FROM password_reset_requests WHERE user_id = 'c3000000-0000-0000-0000-000000000001'),
  'resolved by a3000000-0000-0000-0000-00000000000c', 'the waiting request is resolved by the first reset');

-- E-mail a link (any staff level).
SELECT count(*) AS calls0 FROM net.calls \gset
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes';
SET LOCAL ROLE anon;
SELECT t_eq(staff_send_client_reset_link('a3000000-0000-0000-0000-00000000000c', 'c3000000-0000-0000-0000-000000000001'),
  '{"queued": true, "sent_to": "p.owner@navratna.com"}'::jsonb, 'an employee can e-mail a link');
SELECT t_eq(t_error($$SELECT staff_send_client_reset_link('a3000000-0000-0000-0000-00000000000b', 'c3000000-0000-0000-0000-000000000001')$$),
  'A reset link went to this client less than a minute ago.', 'not twice in a minute');
SELECT t_eq(t_error($$SELECT staff_send_client_reset_link('a3000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-000000000002')$$),
  'This client has no e-mail address on record. Add one in Edit Client, or set a password instead.', 'no e-mail: says so');
SELECT t_eq(t_error($$SELECT staff_send_client_reset_link('c3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001')$$),
  'Only a staff member can send a client a reset link.', 'a client cannot');
SELECT t_eq(t_error($$SELECT staff_send_client_reset_link('a3000000-0000-0000-0000-00000000000c', gen_random_uuid())$$),
  'Client not found.', 'an unknown client');
RESET ROLE;
SELECT t_eq((SELECT via || ' ' || requested_by || ' ' || requested_by_name || ' ' || sent_to FROM client_password_resets
              WHERE client_id = 'c3000000-0000-0000-0000-000000000001' AND voided_at IS NULL),
  'staff a3000000-0000-0000-0000-00000000000c Junior p.owner@navratna.com', 'queued as a staff link');
SELECT t_eq((SELECT count(*) FROM net.calls) - :calls0, 1::bigint, 'the mailer is woken');
-- The staff link works like any other.
SET LOCAL ROLE service_role;
SELECT reset_id AS r2, token AS t2, via AS via2 FROM client_password_reset_claim(10) \gset
SELECT client_password_reset_mark(:'r2', NULL);
RESET ROLE;
SELECT t_eq(:'via2'::text, 'staff', 'handed to the mailer as a staff link');
SET LOCAL ROLE anon;
SELECT t_eq(client_password_reset_complete(:'t2', 'ByLink#2026') ->> 'ok', 'true', 'the client sets a password with it');
SELECT t_eq(t_login('24AAACN0000A1ZK', 'ByLink#2026'), true, 'which works');
RESET ROLE;
SELECT t_eq((SELECT actor_name FROM client_password_log WHERE action = 'link_sent' AND client_id = 'c3000000-0000-0000-0000-000000000001'),
  'Junior', 'the sent link is logged against the staff member who asked');

-- Five staff links an hour per client.
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes';
SELECT staff_send_client_reset_link('a3000000-0000-0000-0000-00000000000c', 'c3000000-0000-0000-0000-000000000001');
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes';
SELECT staff_send_client_reset_link('a3000000-0000-0000-0000-00000000000c', 'c3000000-0000-0000-0000-000000000001');
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes';
SELECT staff_send_client_reset_link('a3000000-0000-0000-0000-00000000000c', 'c3000000-0000-0000-0000-000000000001');
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes';
SELECT staff_send_client_reset_link('a3000000-0000-0000-0000-00000000000c', 'c3000000-0000-0000-0000-000000000001');
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes';
SELECT t_eq(t_error($$SELECT staff_send_client_reset_link('a3000000-0000-0000-0000-00000000000c', 'c3000000-0000-0000-0000-000000000001')$$),
  'Five reset links went to this client in the last hour. Set a password instead.', 'five staff links an hour');
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c3000000-0000-0000-0000-000000000001' AND voided_at IS NULL AND used_at IS NULL),
  1::bigint, 'only the newest staff link is open');
ROLLBACK;
