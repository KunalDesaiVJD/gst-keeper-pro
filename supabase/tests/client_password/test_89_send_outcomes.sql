-- What a send report does to the staff request. A failed send of a link a
-- newer one already replaced asks nobody (the newer link is in the mailbox).
-- A link that does go out closes a request filed because none had gone out,
-- so staff do not act on it and void the link the client holds.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c8900000-0000-0000-0000-000000000001', 'Replaced Co', '24AAACR8901A1Z1', 'rep@example.com', 'x'),
 ('c8900000-0000-0000-0000-000000000002', 'Second Try Co', '24AAACR8902A1Z2', 'second@example.com', 'x'),
 ('c8900000-0000-0000-0000-000000000003', 'Only Link Fails Co', '24AAACR8903A1Z3', 'only@example.com', 'x'),
 ('c8900000-0000-0000-0000-000000000004', 'Late Void Co', '24AAACR8904A1Z4', 'late@example.com', 'x'),
 ('c8900000-0000-0000-0000-000000000005', 'Other Request Co', '24AAACR8905A1Z5', 'other@example.com', 'x');

-- ── (a) A is claimed (slow mailer); the client asks again; B goes out; A ──
-- then fails.
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACR8901A1Z1'); RESET ROLE;
SET LOCAL ROLE service_role; SELECT reset_id AS ra FROM client_password_reset_claim(10) \gset
RESET ROLE;
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes', claimed_at = claimed_at - interval '2 minutes';
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACR8901A1Z1'); RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS rb, token AS tb FROM client_password_reset_claim(10) \gset
SELECT client_password_reset_mark(:'rb', NULL);
SELECT client_password_reset_mark(:'ra', 'sendMail 503');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c8900000-0000-0000-0000-000000000001'),
  0::bigint, '(a) no "none went out" request: B went out');
SELECT t_eq(client_password_reset_check(:'tb') ->> 'valid', 'true', '(a) B works');
SELECT t_eq((SELECT detail FROM client_password_log WHERE client_id = 'c8900000-0000-0000-0000-000000000001' AND action = 'link_failed'),
  'The reset link could not be e-mailed to r•••@example.com: sendMail 503 (It was already void: a newer link was asked for.)',
  '(a) the failure is still logged');

-- ── (b) C fails (staff asked); the client asks again; D goes out. ─────────
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACR8902A1Z2'); RESET ROLE;
SET LOCAL ROLE service_role; SELECT reset_id AS rc FROM client_password_reset_claim(10) \gset
SELECT client_password_reset_mark(:'rc', 'sendMail 503');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c8900000-0000-0000-0000-000000000002' AND status = 'pending'),
  1::bigint, '(b) the failed send asks staff');
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes', claimed_at = claimed_at - interval '2 minutes' WHERE id = :'rc';
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACR8902A1Z2'); RESET ROLE;
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c8900000-0000-0000-0000-000000000002' AND status = 'pending'),
  1::bigint, '(b) a new link only queued: the request stays');
SET LOCAL ROLE service_role;
SELECT reset_id AS rd, token AS td FROM client_password_reset_claim(10) \gset
SELECT client_password_reset_mark(:'rd', NULL);
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c8900000-0000-0000-0000-000000000002' AND status = 'pending'),
  0::bigint, '(b) D went out: the request is closed');
SELECT t_eq((SELECT status FROM password_reset_requests WHERE user_id = 'c8900000-0000-0000-0000-000000000002'),
  'resolved', '(b) as resolved');
SELECT t_eq((SELECT detail FROM client_password_log WHERE client_id = 'c8900000-0000-0000-0000-000000000002' AND action = 'link_sent'),
  'Reset link e-mailed to s•••@example.com. The request waiting on the Dashboard was closed: this link answers it.', '(b) and says so');
SELECT t_eq(client_password_reset_check(:'td') ->> 'valid', 'true', '(b) the link the client holds works');

-- ── (c) The client's only link fails: staff are asked, as before. ─────────
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACR8903A1Z3'); RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS re FROM client_password_reset_claim(10) \gset
SELECT client_password_reset_mark(:'re', 'sendMail 550');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c8900000-0000-0000-0000-000000000003' AND status = 'pending'),
  1::bigint, '(c) staff asked');

-- ── (d) A link reported sent after the sweep voided it closes nothing. ────
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACR8904A1Z4'); RESET ROLE;
SET LOCAL ROLE service_role; SELECT reset_id AS rf FROM client_password_reset_claim(10) \gset
RESET ROLE;
UPDATE client_password_resets SET created_at = created_at - interval '20 minutes', claimed_at = claimed_at - interval '20 minutes' WHERE id = :'rf';
SELECT client_password_reset_tick();
SET LOCAL ROLE service_role; SELECT client_password_reset_mark(:'rf', NULL); RESET ROLE;
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c8900000-0000-0000-0000-000000000004' AND status = 'pending'),
  1::bigint, '(d) the void link does not answer the request');

-- ── (e) A request not filed by this flow is left to staff. ────────────────
INSERT INTO password_reset_requests (user_id, requested_by_name, status)
VALUES ('c8900000-0000-0000-0000-000000000005', 'Other Request Co', 'pending');
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACR8905A1Z5'); RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS rg FROM client_password_reset_claim(10) \gset
SELECT client_password_reset_mark(:'rg', NULL);
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c8900000-0000-0000-0000-000000000005' AND status = 'pending'),
  1::bigint, '(e) left alone');
ROLLBACK;
