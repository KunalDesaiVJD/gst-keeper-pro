-- Staff are told what happened. Links stay a minute apart only when the last
-- one went out to an address still on record or is still on its way: a link
-- that failed, or was voided before it went because staff just corrected the
-- address, does not hold the next one back. The hourly limits count every
-- link asked for, and say so.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c9300000-0000-0000-0000-000000000001', 'Failed Send Co', '24AAACF9301A1Z1', 'acc@failed.example', 'x'),
 ('c9300000-0000-0000-0000-000000000002', 'Corrected Co', '24AAACF9302A1Z2', 'acc@typo.example', 'x'),
 ('c9300000-0000-0000-0000-000000000003', 'Sent Co', '24AAACF9303A1Z3', 'acc@sent.example', 'x');
INSERT INTO user_roles (user_id, role) VALUES ('a9300000-0000-0000-0000-000000000001', 'employee');
INSERT INTO profiles (user_id, first_name) VALUES ('a9300000-0000-0000-0000-000000000001', 'Asha');

-- ── The client's link fails; staff open the Dashboard request at once ─────
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACF9301A1Z1'); RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r1 FROM client_password_reset_claim(10) \gset
SELECT client_password_reset_mark(:'r1', 'sendMail 400: ErrorInvalidRecipients');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c9300000-0000-0000-0000-000000000001' AND status = 'pending'),
  1::bigint, 'the Dashboard shows a request');
SET LOCAL ROLE anon;
SELECT t_eq(staff_send_client_reset_link('a9300000-0000-0000-0000-000000000001', 'c9300000-0000-0000-0000-000000000001') ->> 'queued',
  'true', 'staff can send a link at once: the only one failed');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c9300000-0000-0000-0000-000000000001' AND status = 'pending'),
  0::bigint, 'and the request is answered');
-- While that link waits for the mailer, another is held back, and staff are told why.
SET LOCAL ROLE anon;
SELECT t_eq(t_error($$SELECT staff_send_client_reset_link('a9300000-0000-0000-0000-000000000001', 'c9300000-0000-0000-0000-000000000001')$$),
  'A reset link to this client is on its way. Try again in a minute, or set a password.', 'one on its way: said so');
RESET ROLE;

-- ── The client's link waits; staff correct the address and send at once ───
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACF9302A1Z2'); RESET ROLE;
UPDATE clients SET email = 'acc@right.example' WHERE id = 'c9300000-0000-0000-0000-000000000002';
SET LOCAL ROLE anon;
SELECT t_eq(staff_send_client_reset_link('a9300000-0000-0000-0000-000000000001', 'c9300000-0000-0000-0000-000000000002'),
  '{"queued": true, "sent_to": "acc@right.example"}'::jsonb, 'the corrected address gets a link at once');
RESET ROLE;

-- ── A link went out a moment ago: held back, and said so ──────────────────
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACF9303A1Z3'); RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r3 FROM client_password_reset_claim(10) WHERE client_id = 'c9300000-0000-0000-0000-000000000003' \gset
SELECT client_password_reset_mark(:'r3', NULL);
RESET ROLE;
SET LOCAL ROLE anon;
SELECT t_eq(t_error($$SELECT staff_send_client_reset_link('a9300000-0000-0000-0000-000000000001', 'c9300000-0000-0000-0000-000000000003')$$),
  'A reset link went to this client less than a minute ago. Try again in a minute, or set a password.', 'one sent: said so');
RESET ROLE;
ROLLBACK;
