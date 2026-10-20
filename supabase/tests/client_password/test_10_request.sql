-- Asking for a link (client_password_reset_request, as anon): one answer for
-- every outcome; a queued link only for a real client with an e-mail; one
-- staff request when there is no e-mail; the rate limits. (Requests a limit
-- refuses: test_60. A shared User ID: test_80.)
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_user_id, client_password, is_first_login) VALUES
 ('c0000000-0000-0000-0000-000000000001', 'NAVRATNA TEST PROPERTIES PRIVATE LIMITED', '24AAACN0000A1ZK', 'p.owner@navratna.com', NULL,
  extensions.crypt('OldPass#2026', extensions.gen_salt('bf', 4)), false),
 ('c0000000-0000-0000-0000-000000000002', 'No Mail Traders', '24AAACM0000B1Z5', NULL, 'NOMAIL', 'plain', true),
 ('c0000000-0000-0000-0000-000000000003', 'Shared Id One', '24AAACS0000C1Z1', 'one@example.com', 'SHARED', 'x', true),
 ('c0000000-0000-0000-0000-000000000004', 'Shared Id Two', '24AAACS0000D1Z2', 'two@example.com', 'shared', 'x', true),
 ('c0000000-0000-0000-0000-000000000005', 'Two Mails LLP', '24AAACT0000E1Z3', 'A.Accounts@Example.com; b@example.in, a.accounts@example.com', NULL, 'x', true),
 ('c0000000-0000-0000-0000-000000000006', 'User Id Co', '24AAACU0000F1Z4', 'uid@example.com', 'UNIQ01', 'x', true),
 ('c0000000-0000-0000-0000-000000000007', 'Ip Limited Co', '24AAACI0000G1Z6', 'ip@example.com', NULL, 'x', true),
 ('c0000000-0000-0000-0000-000000000008', 'Global Limited Co', '24AAACG0000H1Z7', 'global@example.com', NULL, 'x', true),
 ('c0000000-0000-0000-0000-000000000009', 'Bad Mail Co', '24AAACB0000J1Z8', 'not an address', NULL, 'x', true);

CREATE TABLE public.t_answers (label text, answer jsonb);

SET LOCAL ROLE anon;
INSERT INTO t_answers SELECT 'real (lower case, spaces)', client_password_reset_request('  24aaacn0000a1zk ');
INSERT INTO t_answers SELECT 'unknown GSTIN', client_password_reset_request('24ZZZZZ9999Z1Z9');
INSERT INTO t_answers SELECT 'no e-mail', client_password_reset_request('24AAACM0000B1Z5');
INSERT INTO t_answers SELECT 'no e-mail again', client_password_reset_request('nomail');
INSERT INTO t_answers SELECT 'bad e-mail', client_password_reset_request('24AAACB0000J1Z8');
INSERT INTO t_answers SELECT 'shared user id', client_password_reset_request('shared');
INSERT INTO t_answers SELECT 'several e-mails', client_password_reset_request('24AAACT0000E1Z3');
INSERT INTO t_answers SELECT 'unique user id', client_password_reset_request('uniq01');
INSERT INTO t_answers SELECT 'empty', client_password_reset_request('   ');
INSERT INTO t_answers SELECT 'null', client_password_reset_request(NULL);
INSERT INTO t_answers SELECT 'too long', client_password_reset_request(repeat('A', 65));
-- Within the minute: rate limited, same answer.
INSERT INTO t_answers SELECT 'again at once', client_password_reset_request('24AAACN0000A1ZK');
RESET ROLE;

-- The neutral answer.
SELECT t_eq((SELECT count(DISTINCT answer) FROM t_answers), 1::bigint, 'every outcome gets the same answer');
SELECT t_eq((SELECT answer FROM t_answers LIMIT 1), '{"ok": true}'::jsonb, 'the answer says nothing');

-- A queued link only for real clients with an e-mail.
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c0000000-0000-0000-0000-000000000001'), 1::bigint,
  'one link queued for the real client (rate limit kept it to one)');
SELECT t_eq((SELECT sent_to || ' | ' || email_hint || ' | ' || via FROM client_password_resets
              WHERE client_id = 'c0000000-0000-0000-0000-000000000001'),
  'p.owner@navratna.com | p•••@navratna.com | self', 'to the address on record');
SELECT t_eq((SELECT token_hash IS NULL AND claimed_at IS NULL AND expires_at IS NULL FROM client_password_resets
              WHERE client_id = 'c0000000-0000-0000-0000-000000000001'), true, 'no token until the mailer claims it');
SELECT t_eq((SELECT count(*) FROM client_password_resets
              WHERE client_id IN ('c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000009')), 0::bigint,
  'nothing queued without an e-mail, or with a bad e-mail');
SELECT t_eq((SELECT string_agg(sent_to, ', ' ORDER BY sent_to) FROM client_password_resets
              WHERE client_id IN ('c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000004')),
  'one@example.com, two@example.com', 'a User ID two clients share: a link to each');
SELECT t_eq((SELECT count(*) FROM client_password_resets), 5::bigint, 'five links queued in all');
SELECT t_eq((SELECT sent_to || ' | ' || email_hint FROM client_password_resets
              WHERE client_id = 'c0000000-0000-0000-0000-000000000005'),
  'A.Accounts@Example.com, b@example.in | A•••@Example.com + 1 more', 'several addresses, each once');
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c0000000-0000-0000-0000-000000000006'), 1::bigint,
  'a User ID that belongs to one client works');

-- No e-mail: one pending request for staff, however often asked.
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c0000000-0000-0000-0000-000000000002' AND status = 'pending'),
  1::bigint, 'one pending staff request for the client with no e-mail');
SELECT t_eq((SELECT note FROM password_reset_requests WHERE user_id = 'c0000000-0000-0000-0000-000000000002'),
  'Asked for a reset link; none reached the client. Edit Client shows why.', 'the open request does not say why');
SELECT t_eq((SELECT detail FROM client_password_log WHERE client_id = 'c0000000-0000-0000-0000-000000000002' AND action = 'fallback_request'),
  'Asked for a reset link, but there is no e-mail address on record. A request is waiting on the Dashboard.', 'the private log does');
SELECT t_eq((SELECT count(*) FROM client_password_log WHERE client_id = 'c0000000-0000-0000-0000-000000000002'), 1::bigint,
  'logged once, however often asked');
SELECT t_eq((SELECT requested_by_name FROM password_reset_requests WHERE user_id = 'c0000000-0000-0000-0000-000000000002'),
  'No Mail Traders (24AAACM0000B1Z5)', 'named like the old form did');
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c0000000-0000-0000-0000-000000000009'), 1::bigint,
  'a malformed address counts as no e-mail');

-- Every request recorded for the rate limits; the identifier only as a hash.
SELECT t_eq((SELECT string_agg(outcome || '=' || n, ',' ORDER BY outcome) FROM
              (SELECT outcome, count(*) AS n FROM client_password_reset_attempts GROUP BY outcome) s),
  'invalid=3,no_client=1,no_email=3,queued=5,rate_limited=1', 'attempts by outcome');
SELECT t_eq((SELECT count(DISTINCT request_id) FROM client_password_reset_attempts), 12::bigint,
  'twelve requests (the shared User ID is one request, two rows)');
SELECT t_eq((SELECT identifier_hash FROM client_password_reset_attempts WHERE outcome = 'no_client' ORDER BY at, identifier_hash LIMIT 1) ~ '^[0-9a-f]{64}$',
  true, 'identifier kept as sha256 only');
SELECT t_eq((SELECT count(*) FROM client_password_reset_attempts WHERE identifier_hash ILIKE '%24ZZZZZ%'), 0::bigint, 'no raw identifier');

-- The mailer is woken once per queued link, with the anon key; never via email_outbox.
SELECT t_eq((SELECT count(*) FROM net.calls), 5::bigint, 'one wake-up per queued link');
SELECT t_eq((SELECT url FROM net.calls LIMIT 1), 'https://gcquafqxbykxkbexcdpy.supabase.co/functions/v1/client-password-reset', 'wakes the mailer');
SELECT t_eq((SELECT headers ->> 'Authorization' FROM net.calls LIMIT 1), 'Bearer test-anon-key', 'with the Vault anon key');
SELECT t_eq((SELECT count(*) FROM email_outbox), 0::bigint, 'nothing written to email_outbox');
SELECT t_eq((SELECT detail FROM client_password_log WHERE client_id = 'c0000000-0000-0000-0000-000000000001' AND action = 'link_queued'),
  'The client asked for a reset link, to p•••@navratna.com.', 'queued link logged, the address masked');

-- A newer request voids the older link.
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes';
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACN0000A1ZK');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c0000000-0000-0000-0000-000000000001'), 2::bigint, 'second link after a minute');
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c0000000-0000-0000-0000-000000000001'
              AND voided_at IS NULL), 1::bigint, 'only the newest is open');
SELECT t_eq((SELECT void_reason FROM client_password_resets WHERE client_id = 'c0000000-0000-0000-0000-000000000001'
              AND voided_at IS NOT NULL), 'a newer link was asked for', 'the older one voided');

-- Three an hour per client.
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes';
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACN0000A1ZK');
RESET ROLE;
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes';
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACN0000A1ZK');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c0000000-0000-0000-0000-000000000001'), 3::bigint,
  'the fourth in the hour is refused');
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c0000000-0000-0000-0000-000000000001'
              AND voided_at IS NULL), 1::bigint, 'and the open link is untouched by a refused request');
-- An hour later it works again.
UPDATE client_password_resets SET created_at = created_at - interval '1 hour';
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACN0000A1ZK');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c0000000-0000-0000-0000-000000000001'), 4::bigint,
  'allowed again after an hour');

-- Ten an hour per caller address (the gateway's headers), whatever they asked for.
SELECT set_config('request.headers', '{"x-forwarded-for": "203.0.113.9, 10.0.0.1"}', true);
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24QQQQQ000' || g || 'Q1Z' || g) FROM generate_series(0, 9) g;
INSERT INTO t_answers SELECT 'address limited', client_password_reset_request('24AAACI0000G1Z6');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM client_password_reset_attempts WHERE ip = '203.0.113.9'), 11::bigint, 'the first address of x-forwarded-for');
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c0000000-0000-0000-0000-000000000007'), 0::bigint,
  'the eleventh request from one address is refused, even for a real client');
SELECT t_eq((SELECT outcome FROM client_password_reset_attempts WHERE ip = '203.0.113.9' AND client_id = 'c0000000-0000-0000-0000-000000000007'),
  'staff_request', 'recorded as refused, staff asked instead');
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c0000000-0000-0000-0000-000000000007' AND status = 'pending'),
  1::bigint, 'a staff request for the refused client');
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9"}', true);
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACI0000G1Z6');
RESET ROLE;
SELECT t_eq((SELECT requested_ip FROM client_password_resets WHERE client_id = 'c0000000-0000-0000-0000-000000000007'), '198.51.100.7',
  'another address is not limited (cf-connecting-ip first)');
SELECT set_config('request.headers', '', true);

SELECT t_eq((SELECT count(DISTINCT answer) FROM t_answers), 1::bigint, 'still the same answer when limited');
ROLLBACK;
