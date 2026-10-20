-- Changing a client's e-mail address does not hide a link that never went
-- out. Links not claimed within 15 minutes, or claimed and not reported sent
-- within 15 minutes, are lost whatever the address: the e-mail trigger reports
-- them first (logged as link_failed, staff asked), like a retry or the sweep
-- would, and only then voids what went to the old address. Before, it voided
-- them as "the e-mail address changed" and, since none counted as live, filed
-- no staff request: the client who asked was left with nothing.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c9400000-0000-0000-0000-000000000001', 'Unclaimed Co', '24AAACU9401A1Z1', 'old@unclaimed.example', 'x'),
 ('c9400000-0000-0000-0000-000000000002', 'Unconfirmed Co', '24AAACU9402A1Z2', 'old@unconfirmed.example', 'x'),
 ('c9400000-0000-0000-0000-000000000003', 'Both Co', '24AAACU9403A1Z3', 'old@both.example', 'x'),
 ('c9400000-0000-0000-0000-000000000004', 'Lost And Live Co', '24AAACU9404A1Z4', 'old@lostlive.example', 'x');

-- (1) A link waiting to be claimed for 16 minutes (the mailer never ran).
INSERT INTO client_password_resets (id, client_id, via, sent_to, email_hint, created_at) VALUES
 ('c9400000-0000-0000-0000-0000000000a1', 'c9400000-0000-0000-0000-000000000001', 'self',
  'old@unclaimed.example', 'o•••@unclaimed.example', now() - interval '16 minutes');
-- (2) A link claimed 16 minutes ago and never reported sent.
INSERT INTO client_password_resets (id, client_id, via, sent_to, email_hint, created_at, claimed_at, expires_at, token_hash) VALUES
 ('c9400000-0000-0000-0000-0000000000a2', 'c9400000-0000-0000-0000-000000000002', 'self',
  'old@unconfirmed.example', 'o•••@unconfirmed.example', now() - interval '17 minutes',
  now() - interval '16 minutes', now() + interval '44 minutes', repeat('a2', 32));
-- (3) Both at once.
INSERT INTO client_password_resets (id, client_id, via, sent_to, email_hint, created_at) VALUES
 ('c9400000-0000-0000-0000-0000000000a3', 'c9400000-0000-0000-0000-000000000003', 'self',
  'old@both.example', 'o•••@both.example', now() - interval '20 minutes');
INSERT INTO client_password_resets (id, client_id, via, sent_to, email_hint, created_at, claimed_at, expires_at, token_hash) VALUES
 ('c9400000-0000-0000-0000-0000000000b3', 'c9400000-0000-0000-0000-000000000003', 'self',
  'old@both.example', 'o•••@both.example', now() - interval '18 minutes',
  now() - interval '16 minutes', now() + interval '44 minutes', repeat('b3', 32));
-- (4) A lost link and a live one (sent a minute ago, to the old address).
INSERT INTO client_password_resets (id, client_id, via, sent_to, email_hint, created_at) VALUES
 ('c9400000-0000-0000-0000-0000000000a4', 'c9400000-0000-0000-0000-000000000004', 'self',
  'old@lostlive.example', 'o•••@lostlive.example', now() - interval '30 minutes');
INSERT INTO client_password_resets (id, client_id, via, sent_to, email_hint, created_at, claimed_at, expires_at, sent_at, token_hash) VALUES
 ('c9400000-0000-0000-0000-0000000000b4', 'c9400000-0000-0000-0000-000000000004', 'staff',
  'old@lostlive.example', 'o•••@lostlive.example', now() - interval '2 minutes',
  now() - interval '2 minutes', now() + interval '58 minutes', now() - interval '1 minute', repeat('b4', 32));

SELECT t_eq((SELECT count(*) FROM password_reset_requests WHERE user_id::text LIKE 'c9400000%'), 0::bigint,
  'no staff request before the address changes');

UPDATE clients SET email = 'new@unclaimed.example' WHERE id = 'c9400000-0000-0000-0000-000000000001';
UPDATE clients SET email = 'new@unconfirmed.example' WHERE id = 'c9400000-0000-0000-0000-000000000002';
UPDATE clients SET email = 'new@both.example' WHERE id = 'c9400000-0000-0000-0000-000000000003';
UPDATE clients SET email = 'new@lostlive.example' WHERE id = 'c9400000-0000-0000-0000-000000000004';

-- Every client who asked gets exactly one pending staff request.
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = c.id AND status = 'pending'), 1::bigint,
            'one pending staff request: ' || c.name)
  FROM clients c WHERE c.id::text LIKE 'c9400000%';
-- The lost links are logged as lost, once each.
SELECT t_eq((SELECT count(*) FROM client_password_log
              WHERE client_id = 'c9400000-0000-0000-0000-000000000001' AND action = 'link_failed'), 1::bigint,
  '(1) the unclaimed link is logged as lost');
SELECT t_eq((SELECT detail FROM client_password_log
              WHERE client_id = 'c9400000-0000-0000-0000-000000000001' AND action = 'link_failed'),
  'The reset link for o•••@unclaimed.example was not sent within 15 minutes, so it was given up.', '(1) masked');
SELECT t_eq((SELECT count(*) FROM client_password_log
              WHERE client_id = 'c9400000-0000-0000-0000-000000000002' AND action = 'link_failed'), 1::bigint,
  '(2) the unconfirmed link is logged as lost');
SELECT t_eq((SELECT count(*) FROM client_password_log
              WHERE client_id = 'c9400000-0000-0000-0000-000000000003' AND action = 'link_failed'), 2::bigint,
  '(3) both lost links are logged');
SELECT t_eq((SELECT count(*) FROM client_password_log
              WHERE client_id = 'c9400000-0000-0000-0000-000000000004' AND action = 'link_failed'), 1::bigint,
  '(4) the lost link is logged as lost');
-- Lost links are reported as lost, not as voided by the address change.
SELECT t_eq((SELECT count(*) FROM client_password_resets
              WHERE void_reason = 'the e-mail address changed'
                AND id IN ('c9400000-0000-0000-0000-0000000000a1', 'c9400000-0000-0000-0000-0000000000a2',
                           'c9400000-0000-0000-0000-0000000000a3', 'c9400000-0000-0000-0000-0000000000b3',
                           'c9400000-0000-0000-0000-0000000000a4')), 0::bigint,
  'no lost link is put down to the address change');
SELECT t_eq((SELECT count(*) FROM client_password_log
              WHERE client_id::text LIKE 'c9400000%' AND action = 'fallback_request'), 4::bigint,
  'the private log says why staff were asked, once per client');
-- (4) The live link to the old address is still voided for the address change.
SELECT t_eq((SELECT void_reason FROM client_password_resets WHERE id = 'c9400000-0000-0000-0000-0000000000b4'),
  'the e-mail address changed', '(4) the live link to the old address is voided');
SELECT t_eq((SELECT count(*) FROM client_password_log
              WHERE client_id = 'c9400000-0000-0000-0000-000000000004' AND action = 'link_voided'), 1::bigint,
  '(4) and logged as voided');
-- Nothing is left open.
SELECT t_eq((SELECT count(*) FROM client_password_resets
              WHERE client_id::text LIKE 'c9400000%' AND voided_at IS NULL AND used_at IS NULL), 0::bigint,
  'no link to an old address is left open');
ROLLBACK;
