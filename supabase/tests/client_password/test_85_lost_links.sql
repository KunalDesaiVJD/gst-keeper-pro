-- Links that will never arrive are not left hanging: one claimed by a mailer
-- that stopped before reporting (no _mark) is voided after 15 minutes, one
-- never claimed within the hour is given up, and either way staff get one
-- pending request. The claim runs the sweep, and so does every request.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c8500000-0000-0000-0000-000000000001', 'Lost Link Co', '24AAACL0001A1Z1', 'lost@example.com', 'x'),
 ('c8500000-0000-0000-0000-000000000002', 'Swept By Request Co', '24AAACL0002A1Z2', 'swept@example.com', 'x'),
 ('c8500000-0000-0000-0000-000000000003', 'Never Claimed Co', '24AAACL0003A1Z3', 'never@example.com', 'x'),
 ('c8500000-0000-0000-0000-000000000004', 'Bystander Co', '24AAACL0004A1Z4', 'by@example.com', 'x');

SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACL0001A1Z1');
RESET ROLE;
-- The mailer claims it and stops (no mark).
SET LOCAL ROLE service_role;
SELECT reset_id AS r1, token AS t1 FROM client_password_reset_claim(10) \gset
RESET ROLE;

-- Ten minutes on: still being sent, left alone.
UPDATE client_password_resets SET claimed_at = claimed_at - interval '10 minutes', created_at = created_at - interval '10 minutes';
SET LOCAL ROLE service_role;
SELECT t_eq((SELECT count(*) FROM client_password_reset_claim(10)), 0::bigint, 'nothing new to claim');
RESET ROLE;
SELECT t_eq((SELECT voided_at IS NULL FROM client_password_resets WHERE id = :'r1'), true, 'ten minutes: not voided yet');
SELECT t_eq(client_password_has_open_link('c8500000-0000-0000-0000-000000000001'), true, 'and counts as on its way');
SELECT t_eq((SELECT count(*) FROM password_reset_requests), 0::bigint, 'no staff request yet');

-- Sixteen minutes on: voided, staff asked.
UPDATE client_password_resets SET claimed_at = claimed_at - interval '6 minutes', created_at = created_at - interval '6 minutes';
SELECT t_eq(client_password_has_open_link('c8500000-0000-0000-0000-000000000001'), false, 'past 15 minutes it is not open');
SET LOCAL ROLE service_role;
SELECT t_eq((SELECT count(*) FROM client_password_reset_claim(10)), 0::bigint, 'the claim sweeps');
RESET ROLE;
SELECT t_eq((SELECT void_reason FROM client_password_resets WHERE id = :'r1'), 'claimed but not sent', 'the lost link is voided');
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c8500000-0000-0000-0000-000000000001' AND status = 'pending'),
  1::bigint, 'staff get a request');
SELECT t_eq((SELECT note FROM password_reset_requests WHERE user_id = 'c8500000-0000-0000-0000-000000000001'),
  'Asked for a reset link; none went out. Edit Client shows why.', 'the usual note');
SELECT t_eq((SELECT detail FROM client_password_log WHERE client_id = 'c8500000-0000-0000-0000-000000000001' AND action = 'link_failed'),
  'The mailer stopped before the reset link for l•••@example.com was sent, so it was voided.', 'logged');
SET LOCAL ROLE anon;
SELECT t_eq(client_password_reset_check(:'t1') ->> 'valid', 'false', 'the token no longer works');
RESET ROLE;
-- Swept again: no second request.
SET LOCAL ROLE service_role;
SELECT count(*) FROM client_password_reset_claim(10);
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c8500000-0000-0000-0000-000000000001'), 1::bigint, 'one request, not two');
-- The mailer reports late that it did send it: recorded, the link stays void.
SET LOCAL ROLE service_role;
SELECT client_password_reset_mark(:'r1', NULL);
RESET ROLE;
SELECT t_eq((SELECT sent_at IS NOT NULL AND voided_at IS NOT NULL FROM client_password_resets WHERE id = :'r1'), true, 'sent late, still void');
SELECT t_eq((SELECT detail FROM client_password_log WHERE client_id = 'c8500000-0000-0000-0000-000000000001' AND action = 'link_sent'),
  'Reset link e-mailed to l•••@example.com. It was already void (claimed but not sent), so it does not work.', 'and says so');

-- Any request sweeps too, even with the mailer down: a lost link for another client.
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACL0002A1Z2');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r2 FROM client_password_reset_claim(10) \gset
RESET ROLE;
UPDATE client_password_resets SET claimed_at = claimed_at - interval '20 minutes', created_at = created_at - interval '20 minutes' WHERE id = :'r2';
-- A link never claimed within the hour (the mailer never ran).
INSERT INTO client_password_resets (id, client_id, via, sent_to, email_hint, created_at)
VALUES ('c8500000-0000-0000-0000-0000000000ff', 'c8500000-0000-0000-0000-000000000003', 'self', 'never@example.com', 'n•••@example.com',
        now() - interval '61 minutes');
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACL0004A1Z4');
RESET ROLE;
SELECT t_eq((SELECT void_reason FROM client_password_resets WHERE id = :'r2'), 'claimed but not sent', 'a request swept the lost link');
SELECT t_eq((SELECT void_reason FROM client_password_resets WHERE id = 'c8500000-0000-0000-0000-0000000000ff'), 'not sent in time',
  'and the one never claimed');
SELECT t_eq((SELECT string_agg(c.gstin, ',' ORDER BY c.gstin) FROM password_reset_requests q JOIN clients c ON c.id = q.user_id
              WHERE q.status = 'pending'), '24AAACL0001A1Z1,24AAACL0002A1Z2,24AAACL0003A1Z3', 'staff asked for each, once');
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c8500000-0000-0000-0000-000000000004' AND voided_at IS NULL),
  1::bigint, 'the bystander''s own link is untouched');
ROLLBACK;
