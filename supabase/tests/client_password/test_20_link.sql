-- The link: minted by the mailer (service role only), stored as a hash,
-- 60 minutes, single use; the redeem sets the password and the old one stops
-- working; the old one works until then; a newer link voids the older.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password, is_first_login) VALUES
 ('c2000000-0000-0000-0000-000000000001', 'NAVRATNA TEST PROPERTIES PRIVATE LIMITED', '24AAACN0000A1ZK', 'p.owner@navratna.com',
  extensions.crypt('OldPass#2026', extensions.gen_salt('bf', 4)), true),
 ('c2000000-0000-0000-0000-000000000002', 'Failing Mail Co', '24AAACF0000K1Z9', 'bounce@example.com', 'x', true);
INSERT INTO password_reset_requests (user_id, requested_by_name, status)
VALUES ('c2000000-0000-0000-0000-000000000001', 'NAVRATNA (24AAACN0000A1ZK)', 'pending');

SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACN0000A1ZK');
-- Only the service role may mint and read tokens.
SELECT t_eq(t_error('SELECT * FROM client_password_reset_claim(10)') LIKE 'permission denied%', true, 'anon cannot claim');
SELECT t_eq(t_error('SELECT client_password_reset_mark(gen_random_uuid(), NULL)') LIKE 'permission denied%', true, 'anon cannot mark');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT t_eq(t_error('SELECT * FROM client_password_reset_claim(10)') LIKE 'permission denied%', true, 'authenticated cannot claim');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT reset_id AS r1, token AS t1, link AS l1, to_email AS to1, gstin AS g1, via AS via1,
       expires_at = now() + interval '60 minutes' AS exp60
  FROM client_password_reset_claim(10) \gset
SELECT t_eq((SELECT count(*) FROM client_password_reset_claim(10)), 0::bigint, 'a claimed link is not handed out twice');
RESET ROLE;

SELECT t_eq(:'t1' ~ '^[0-9a-f]{64}$', true, 'a 256-bit token');
SELECT t_eq(:'l1', 'https://gst.vjdesai.com/reset-password#token=' || :'t1', 'the link carries the token in the fragment');
SELECT t_eq(:'to1' || ' ' || :'g1' || ' ' || :'via1', 'p.owner@navratna.com 24AAACN0000A1ZK self', 'recipient and client handed to the mailer');
SELECT t_eq(:'exp60'::boolean, true, 'valid for 60 minutes');
SELECT t_eq((SELECT token_hash FROM client_password_resets WHERE id = :'r1'),
  encode(extensions.digest(:'t1', 'sha256'), 'hex'), 'only the sha256 of the token is stored');
SELECT t_eq((SELECT count(*) FROM client_password_resets r WHERE position(:'t1' IN row_to_json(r)::text) > 0), 0::bigint,
  'the token itself is nowhere in the table');
SELECT t_eq((SELECT count(*) FROM client_password_log l WHERE position(:'t1' IN row_to_json(l)::text) > 0), 0::bigint,
  'nor in the log');

SET LOCAL ROLE service_role;
SELECT client_password_reset_mark(:'r1', NULL);
RESET ROLE;
SELECT t_eq((SELECT sent_at IS NOT NULL FROM client_password_resets WHERE id = :'r1'), true, 'marked sent');
SELECT t_eq((SELECT detail FROM client_password_log WHERE action = 'link_sent'), 'Reset link e-mailed to p•••@navratna.com.', 'sent logged, the address masked');

-- The reset page.
SET LOCAL ROLE anon;
SELECT t_eq(client_password_reset_check(:'t1') ->> 'valid', 'true', 'the link is good');
SELECT t_eq(client_password_reset_check(:'t1') ->> 'gstin_masked', '24••••••••••1ZK', 'GSTIN masked');
SELECT t_eq(client_password_reset_check(:'t1') ->> 'client_name', 'NAVRATNA TEST PROPERTIES PRIVATE LIMITED', 'client named');
SELECT t_eq(client_password_reset_check(upper(:'t1')) ->> 'valid', 'false', 'tokens are lower-case hex only');
SELECT t_eq(client_password_reset_check('abc') ->> 'valid', 'false', 'a malformed token');
SELECT t_eq(client_password_reset_check(NULL) ->> 'valid', 'false', 'no token');
SELECT t_eq(client_password_reset_check(repeat('0', 64)) ->> 'valid', 'false', 'an unknown token');
-- Until the link is used, the old password still works.
SELECT t_eq(t_login('24AAACN0000A1ZK', 'OldPass#2026'), true, 'old password works until the link is used');

-- The password rules, on the server.
SELECT t_eq(t_error(format('SELECT client_password_reset_complete(%L, %L)', :'t1', 'short')),
  'The new password must be at least 8 characters.', 'too short');
SELECT t_eq(t_error(format('SELECT client_password_reset_complete(%L, %L)', :'t1', repeat('x', 73))),
  'The new password can be at most 72 characters.', 'too long for bcrypt');
SELECT t_eq(t_error(format('SELECT client_password_reset_complete(%L, %L)', :'t1', '24aaacn0000a1zk')),
  'The new password cannot be your GSTIN.', 'not the GSTIN, any case');
SELECT t_eq(t_error(format('SELECT client_password_reset_complete(%L, %L)', :'t1', '27AAACX1234Y1Z5')),
  'The new password cannot be a GSTIN.', 'not shaped like a GSTIN');
SELECT t_eq(t_error(format('SELECT client_password_reset_complete(%L, %L)', :'t1', ' Padded#2026 ')),
  'The new password cannot start or end with a space.', 'no outer spaces');
SELECT t_eq(client_password_reset_check(:'t1') ->> 'valid', 'true', 'a refused password leaves the link usable');

-- Redeem.
SELECT t_eq(client_password_reset_complete(:'t1', 'NewPass#2026'), '{"ok": true, "user_id": "24AAACN0000A1ZK"}'::jsonb, 'password set');
SELECT t_eq(t_login('24AAACN0000A1ZK', 'NewPass#2026'), true, 'the new password works');
SELECT t_eq(t_login('24AAACN0000A1ZK', 'OldPass#2026'), false, 'the old password stops working');
-- Single use.
SELECT t_eq(t_error(format('SELECT client_password_reset_complete(%L, %L)', :'t1', 'Another#2026')),
  'This link is invalid or has expired. Ask for a new one from the login page.', 'a used link is refused');
SELECT t_eq(client_password_reset_check(:'t1') ->> 'valid', 'false', 'and shows as invalid');
SELECT t_eq(t_login('24AAACN0000A1ZK', 'NewPass#2026'), true, 'the refused reuse changed nothing');
RESET ROLE;
SELECT t_eq((SELECT client_password LIKE '$2a$10$%' FROM clients WHERE id = 'c2000000-0000-0000-0000-000000000001'), true, 'stored as bcrypt (cost 10)');
SELECT t_eq((SELECT is_first_login FROM clients WHERE id = 'c2000000-0000-0000-0000-000000000001'), false, 'no forced change after a self reset');
SELECT t_eq((SELECT used_at IS NOT NULL FROM client_password_resets WHERE id = :'r1'), true, 'marked used');
SELECT t_eq((SELECT status FROM password_reset_requests WHERE user_id = 'c2000000-0000-0000-0000-000000000001'), 'resolved',
  'a waiting staff request is resolved');
SELECT t_eq((SELECT count(*) FROM client_password_log WHERE client_id = 'c2000000-0000-0000-0000-000000000001' AND action = 'link_used'),
  1::bigint, 'use logged');

-- Expiry.
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes';
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACN0000A1ZK');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r2, token AS t2 FROM client_password_reset_claim(10) \gset
RESET ROLE;
UPDATE client_password_resets SET expires_at = now() - interval '1 second' WHERE id = :'r2';
SET LOCAL ROLE anon;
SELECT t_eq(client_password_reset_check(:'t2') ->> 'valid', 'false', 'an expired link is invalid');
SELECT t_eq(t_error(format('SELECT client_password_reset_complete(%L, %L)', :'t2', 'Expired#2026')),
  'This link is invalid or has expired. Ask for a new one from the login page.', 'an expired link is refused');
SELECT t_eq(t_login('24AAACN0000A1ZK', 'NewPass#2026'), true, 'and changes nothing');
RESET ROLE;

-- A newer request voids the older link, even one already e-mailed.
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes';
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACN0000A1ZK');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r3, token AS t3 FROM client_password_reset_claim(10) \gset
SELECT client_password_reset_mark(:'r3', NULL);
RESET ROLE;
-- (past the three-an-hour limit for this client)
UPDATE client_password_resets SET created_at = created_at - interval '61 minutes';
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACN0000A1ZK');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r4, token AS t4 FROM client_password_reset_claim(10) \gset
RESET ROLE;
SET LOCAL ROLE anon;
SELECT t_eq(client_password_reset_check(:'t3') ->> 'valid', 'false', 'the older link is void');
SELECT t_eq(t_error(format('SELECT client_password_reset_complete(%L, %L)', :'t3', 'Older#20266')) IS NOT NULL, true, 'and refused');
SELECT t_eq(client_password_reset_check(:'t4') ->> 'valid', 'true', 'the newest link works');
SELECT client_password_reset_complete(:'t4', 'Newest#2026');
SELECT t_eq(t_login('24AAACN0000A1ZK', 'Newest#2026'), true, 'set by the newest link');
RESET ROLE;

-- The e-mail fails: the link is void and staff are asked instead.
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACF0000K1Z9');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r5, token AS t5 FROM client_password_reset_claim(10) \gset
SELECT client_password_reset_mark(:'r5', 'sendMail 503: try later');
RESET ROLE;
SELECT t_eq((SELECT send_error || ' | ' || void_reason FROM client_password_resets WHERE id = :'r5'),
  'sendMail 503: try later | the e-mail could not be sent', 'failure recorded, link voided');
SELECT t_eq(client_password_reset_check(:'t5') ->> 'valid', 'false', 'a link whose e-mail failed does not work');
SELECT t_eq((SELECT note FROM password_reset_requests WHERE user_id = 'c2000000-0000-0000-0000-000000000002' AND status = 'pending'),
  'Asked for a reset link; none went out. Edit Client shows why.', 'one staff request filed, without the address');
SELECT t_eq((SELECT detail FROM client_password_log WHERE client_id = 'c2000000-0000-0000-0000-000000000002' AND action = 'link_failed'),
  'The reset link could not be e-mailed to b•••@example.com: sendMail 503: try later', 'failure logged, the address masked');

-- A link the mailer never picked up within the hour is given up, not sent late.
INSERT INTO client_password_resets (id, client_id, via, sent_to, created_at)
VALUES ('c2000000-0000-0000-0000-0000000000ff', 'c2000000-0000-0000-0000-000000000002', 'self', 'bounce@example.com', now() - interval '61 minutes');
SET LOCAL ROLE service_role;
SELECT t_eq((SELECT count(*) FROM client_password_reset_claim(10)), 0::bigint, 'a stale link is not handed out');
RESET ROLE;
SELECT t_eq((SELECT void_reason FROM client_password_resets WHERE id = 'c2000000-0000-0000-0000-0000000000ff'), 'not sent in time', 'and is voided');
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c2000000-0000-0000-0000-000000000002' AND status = 'pending'),
  1::bigint, 'staff asked once, not twice');
SELECT t_eq((SELECT count(*) FROM email_outbox), 0::bigint, 'nothing written to email_outbox');
ROLLBACK;
