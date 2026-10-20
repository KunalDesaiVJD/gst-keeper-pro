-- The per-address and all-clients limits treat a client who already holds a
-- good link like the per-client limit does: refused, nothing more needed. No
-- staff request saying none reached the client while a link sits in the mailbox (a
-- staff reset on it would void the link the client holds).
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c9200000-0000-0000-0000-000000000001', 'Open Link Co', '24AAACO9201A1Z1', 'owner@openlink.example', 'x'),
 ('c9200000-0000-0000-0000-000000000002', 'Cap Open Co', '24AAACO9202A1Z2', 'cap@openlink.example', 'x'),
 ('c9200000-0000-0000-0000-000000000003', 'Cap Shut Co', '24AAACO9203A1Z3', 'shut@openlink.example', 'x'),
 ('c9200000-0000-0000-0000-000000000004', 'Filler Co', '24AAACO9204A1Z4', 'fill@openlink.example', 'x');

-- ── Per address: the client's link went out and is good ──────────────────
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.7"}', true);
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACO9201A1Z1'); RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r1, token AS t1 FROM client_password_reset_claim(10) \gset
SELECT client_password_reset_mark(:'r1', NULL);
RESET ROLE;
-- (A few minutes ago, so only the address limit refuses the next ask.)
UPDATE client_password_resets SET created_at = created_at - interval '3 minutes', claimed_at = claimed_at - interval '3 minutes',
       sent_at = sent_at - interval '3 minutes';
SET LOCAL ROLE anon;
SELECT client_password_reset_request('NOTACLIENT' || g) FROM generate_series(1, 9) g;
SELECT t_eq(client_password_reset_request('24AAACO9201A1Z1'), '{"ok": true}'::jsonb, 'the same answer');
RESET ROLE;
SELECT t_eq((SELECT string_agg(outcome, ',' ORDER BY outcome) FROM client_password_reset_attempts
              WHERE client_id = 'c9200000-0000-0000-0000-000000000001'),
  'queued,rate_limited', 'the second ask is refused by the address limit');
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c9200000-0000-0000-0000-000000000001'),
  0::bigint, 'no staff request: the client holds a good link');
SELECT t_eq(client_password_reset_check(:'t1') ->> 'valid', 'true', 'which still works');
SELECT set_config('request.headers', '', true);

-- ── All clients: past 300 an hour ─────────────────────────────────────────
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACO9202A1Z2'); RESET ROLE;
UPDATE client_password_resets SET created_at = created_at - interval '2 minutes'
 WHERE client_id = 'c9200000-0000-0000-0000-000000000002';
INSERT INTO client_password_resets (client_id, via, sent_to, created_at, voided_at)
SELECT 'c9200000-0000-0000-0000-000000000004', 'self', 'fill@openlink.example', now() - interval '30 minutes', now()
  FROM generate_series(1, 300 - (SELECT count(*) FROM client_password_resets WHERE created_at > now() - interval '1 hour')::int);
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACO9202A1Z2');
SELECT client_password_reset_request('24AAACO9203A1Z3');
RESET ROLE;
SELECT t_eq((SELECT string_agg(outcome, ',' ORDER BY outcome) FROM client_password_reset_attempts
              WHERE client_id = 'c9200000-0000-0000-0000-000000000002'),
  'queued,rate_limited', 'past 300: refused, a link on its way');
SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id = 'c9200000-0000-0000-0000-000000000002'),
  0::bigint, 'so no staff request');
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c9200000-0000-0000-0000-000000000003' AND status = 'pending'),
  1::bigint, 'a client with no link open is still handed to staff');
ROLLBACK;
