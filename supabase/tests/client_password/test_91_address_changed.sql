-- A link is good only while every address it went to is still on record.
-- Staff replace an address (a mistyped domain, an ex-accountant's mailbox):
-- links to the old one are voided at once, the mailer never mints a token for
-- one, a send report for one closes no staff request, and the reset page
-- refuses one. A client who asked is never left with neither a link nor a
-- staff request.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c9100000-0000-0000-0000-000000000001', 'Retry Co', '24AAACR9101A1Z1', 'old@typo.example', 'x'),
 ('c9100000-0000-0000-0000-000000000002', 'Old Mailbox Co', '24AAACR9102A1Z2', 'ex@accountant.example', 'Before#2026'),
 ('c9100000-0000-0000-0000-000000000003', 'Two Addresses Co', '24AAACR9103A1Z3', 'a@two.example, b@two.example', 'x'),
 ('c9100000-0000-0000-0000-000000000004', 'Added Address Co', '24AAACR9104A1Z4', 'one@add.example', 'x'),
 ('c9100000-0000-0000-0000-000000000005', 'Claim Race Co', '24AAACR9105A1Z5', 'old@claim.example', 'x'),
 ('c9100000-0000-0000-0000-000000000006', 'Mark Race Co', '24AAACR9106A1Z6', 'old@mark.example', 'x'),
 ('c9100000-0000-0000-0000-000000000007', 'Page Race Co', '24AAACR9107A1Z7', 'old@page.example', 'Before#2026'),
 ('c9100000-0000-0000-0000-000000000008', 'Mark Alone Co', '24AAACR9108A1Z8', 'old@alone.example', 'x'),
 ('c9100000-0000-0000-0000-000000000009', 'Other Edit Co', '24AAACR9109A1Z9', 'keep@edit.example', 'x');

SELECT t_eq(client_password_sent_to_current('a@x.com', 'A@X.com;'), true, 'same address, other spelling');
SELECT t_eq(client_password_sent_to_current('a@x.com, b@y.com', 'b@y.com a@x.com'), true, 'same addresses, other order');
SELECT t_eq(client_password_sent_to_current('a@x.com', 'a@x.com, c@z.com'), true, 'an address added since');
SELECT t_eq(client_password_sent_to_current('a@x.com, b@y.com', 'a@x.com'), false, 'an address removed since');
SELECT t_eq(client_password_sent_to_current('a@x.com', 'new@x.com'), false, 'the address replaced');
SELECT t_eq(client_password_sent_to_current('a@x.com', NULL), false, 'no address on record now');

-- ── (1) The reported case: the link is still waiting when staff correct ───
-- the address, and the client asks again within the minute.
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACR9101A1Z1'); RESET ROLE;
SELECT id AS l1 FROM client_password_resets WHERE client_id = 'c9100000-0000-0000-0000-000000000001' \gset
UPDATE clients SET email = 'accounts@right.example' WHERE id = 'c9100000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT void_reason FROM client_password_resets WHERE id = :'l1'), 'the e-mail address changed',
  '(1) the link to the old address is voided when the address changes');
SET LOCAL ROLE anon;
SELECT t_eq(client_password_reset_request('24AAACR9101A1Z1'), '{"ok": true}'::jsonb, '(1) the same answer');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c9100000-0000-0000-0000-000000000001' AND status = 'pending'),
  1::bigint, '(1) one staff request, not two');
-- The mailer runs: claims what is waiting and reports each one sent.
SET LOCAL ROLE service_role;
CREATE TEMP TABLE t_claimed1 AS SELECT * FROM client_password_reset_claim(10);
SELECT client_password_reset_mark(reset_id, NULL) FROM t_claimed1;
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM t_claimed1 WHERE client_id = 'c9100000-0000-0000-0000-000000000001'),
  0::bigint, '(1) the mailer gets nothing for the old address');
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c9100000-0000-0000-0000-000000000001' AND token_hash IS NOT NULL),
  0::bigint, '(1) no token was ever minted for it');
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c9100000-0000-0000-0000-000000000001' AND status = 'pending'),
  1::bigint, '(1) the staff request is still waiting');
SELECT t_eq((SELECT detail FROM client_password_log WHERE client_id = 'c9100000-0000-0000-0000-000000000001' AND action = 'link_voided'),
  'The e-mail address on record changed, so the reset link to o•••@typo.example was voided.', '(1) logged, masked');

-- ── (2) A sent link sits in the old mailbox: it stops working. ────────────
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACR9102A1Z2'); RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r2, token AS t2 FROM client_password_reset_claim(10) WHERE client_id = 'c9100000-0000-0000-0000-000000000002' \gset
SELECT client_password_reset_mark(:'r2', NULL);
RESET ROLE;
SELECT t_eq(client_password_reset_check(:'t2') ->> 'valid', 'true', '(2) the link works while the address is on record');
UPDATE clients SET email = 'accounts@oldmailbox.example' WHERE id = 'c9100000-0000-0000-0000-000000000002';
SET LOCAL ROLE anon;
SELECT t_eq(client_password_reset_check(:'t2') ->> 'valid', 'false', '(2) not after the address is replaced');
SELECT t_eq(t_error(format($$SELECT client_password_reset_complete(%L, 'Attacker#Pass1')$$, :'t2')),
  'This link is invalid or has expired. Ask for a new one from the login page.', '(2) and it cannot set a password');
RESET ROLE;
SELECT t_eq(t_login('24AAACR9102A1Z2', 'Attacker#Pass1'), false, '(2) the old mailbox cannot sign in');
SELECT t_eq(t_login('24AAACR9102A1Z2', 'Before#2026'), true, '(2) the client''s password is unchanged');
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c9100000-0000-0000-0000-000000000002' AND status = 'pending'),
  1::bigint, '(2) the client had asked and holds no link now: staff are asked');

-- ── (3) Removing one of two addresses voids; adding one does not. ─────────
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACR9103A1Z3');
SELECT client_password_reset_request('24AAACR9104A1Z4');
RESET ROLE;
SET LOCAL ROLE service_role;
CREATE TEMP TABLE t_claimed3 AS SELECT * FROM client_password_reset_claim(10);
SELECT reset_id AS r3, token AS t3 FROM t_claimed3 WHERE client_id = 'c9100000-0000-0000-0000-000000000003' \gset
SELECT reset_id AS r4, token AS t4 FROM t_claimed3 WHERE client_id = 'c9100000-0000-0000-0000-000000000004' \gset
SELECT client_password_reset_mark(:'r3', NULL), client_password_reset_mark(:'r4', NULL);
RESET ROLE;
UPDATE clients SET email = 'one@add.example; two@add.example' WHERE id = 'c9100000-0000-0000-0000-000000000004';
UPDATE clients SET email = 'B@two.example' WHERE id = 'c9100000-0000-0000-0000-000000000003';
SELECT t_eq(client_password_reset_check(:'t4') ->> 'valid', 'true', '(3) an address added: the link still works');
SELECT t_eq(client_password_has_open_link('c9100000-0000-0000-0000-000000000004'), true, '(3) and counts as open');
SELECT t_eq(client_password_reset_check(:'t3') ->> 'valid', 'false', '(3) an address it went to removed: void');

-- ── (4) A save that leaves the address alone leaves the link alone. ───────
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACR9109A1Z9'); RESET ROLE;
UPDATE clients SET name = 'Other Edit Co Ltd', email = email WHERE id = 'c9100000-0000-0000-0000-000000000009';
UPDATE clients SET email = ' KEEP@edit.example ' WHERE id = 'c9100000-0000-0000-0000-000000000009';
SELECT t_eq((SELECT count(*) FROM client_password_resets WHERE client_id = 'c9100000-0000-0000-0000-000000000009' AND voided_at IS NULL),
  1::bigint, '(4) other edits, or the same address respelt, void nothing');

-- ── (5) Backstops: an address change the trigger did not see (committed ───
-- in the same moment as the request). Triggers off, to stand in for it.
ALTER TABLE clients DISABLE TRIGGER USER;

-- The mailer never mints a token for the old address; staff are asked.
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACR9105A1Z5'); RESET ROLE;
UPDATE clients SET email = 'new@claim.example' WHERE id = 'c9100000-0000-0000-0000-000000000005';
SET LOCAL ROLE service_role;
SELECT t_eq((SELECT count(*) FROM client_password_reset_claim(10) WHERE client_id = 'c9100000-0000-0000-0000-000000000005'),
  0::bigint, '(5a) the claim hands the mailer nothing for the old address');
RESET ROLE;
SELECT t_eq((SELECT (token_hash IS NULL)::text || ' ' || void_reason FROM client_password_resets
              WHERE client_id = 'c9100000-0000-0000-0000-000000000005'),
  'true the e-mail address changed', '(5a) no token; voided');
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c9100000-0000-0000-0000-000000000005' AND status = 'pending'),
  1::bigint, '(5a) staff asked');

-- A link claimed for the old address, reported sent after the change and a
-- refused retry: the retry's staff request stays, the link is voided.
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACR9106A1Z6'); RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r6, token AS t6, to_email AS to6 FROM client_password_reset_claim(10) WHERE client_id = 'c9100000-0000-0000-0000-000000000006' \gset
RESET ROLE;
UPDATE clients SET email = 'new@mark.example' WHERE id = 'c9100000-0000-0000-0000-000000000006';
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACR9106A1Z6'); RESET ROLE;
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c9100000-0000-0000-0000-000000000006' AND status = 'pending'),
  1::bigint, '(5b) the refused retry asked staff');
SET LOCAL ROLE service_role; SELECT client_password_reset_mark(:'r6', NULL); RESET ROLE;
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c9100000-0000-0000-0000-000000000006' AND status = 'pending'),
  1::bigint, '(5b) a link sent to the replaced address does not close it');
SELECT t_eq((SELECT void_reason FROM client_password_resets WHERE id = :'r6'), 'the e-mail address changed', '(5b) it is voided');
SELECT t_eq((SELECT detail FROM client_password_log WHERE client_id = 'c9100000-0000-0000-0000-000000000006' AND action = 'link_sent'),
  'Reset link e-mailed to o•••@mark.example. That address is no longer on record, so the link was voided and does not work.',
  '(5b) and the log says so');
SELECT t_eq(client_password_reset_check(:'t6') ->> 'valid', 'false', '(5b) it does not work');

-- The same with no earlier request: the send report asks staff itself.
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACR9108A1Z8'); RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r8 FROM client_password_reset_claim(10) WHERE client_id = 'c9100000-0000-0000-0000-000000000008' \gset
RESET ROLE;
UPDATE clients SET email = 'new@alone.example' WHERE id = 'c9100000-0000-0000-0000-000000000008';
SET LOCAL ROLE service_role; SELECT client_password_reset_mark(:'r8', NULL); RESET ROLE;
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c9100000-0000-0000-0000-000000000008' AND status = 'pending'),
  1::bigint, '(5c) the client holds no link at its address: staff asked');

-- The reset page refuses a link to an address no longer on record.
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACR9107A1Z7'); RESET ROLE;
SET LOCAL ROLE service_role;
SELECT reset_id AS r7, token AS t7 FROM client_password_reset_claim(10) WHERE client_id = 'c9100000-0000-0000-0000-000000000007' \gset
SELECT client_password_reset_mark(:'r7', NULL);
RESET ROLE;
UPDATE clients SET email = 'new@page.example' WHERE id = 'c9100000-0000-0000-0000-000000000007';
SET LOCAL ROLE anon;
SELECT t_eq(client_password_reset_check(:'t7') ->> 'valid', 'false', '(5d) the page says the link is not good');
SELECT t_eq(t_error(format($$SELECT client_password_reset_complete(%L, 'Attacker#Pass1')$$, :'t7')),
  'This link is invalid or has expired. Ask for a new one from the login page.', '(5d) and will not set a password');
RESET ROLE;
SELECT t_eq(t_login('24AAACR9107A1Z7', 'Before#2026'), true, '(5d) the password is unchanged');
ALTER TABLE clients ENABLE TRIGGER USER;

-- Nobody who asked is left with neither a link nor a staff request.
SELECT t_eq((SELECT count(*) FROM clients c
              WHERE c.id::text LIKE 'c9100000%'
                AND NOT client_password_has_open_link(c.id)
                AND NOT EXISTS (SELECT 1 FROM password_reset_requests q WHERE q.user_id = c.id AND q.status = 'pending')
                -- (5d) is a race the trigger's lock rules out; the page refusing it is the backstop.
                AND c.id <> 'c9100000-0000-0000-0000-000000000007'),
  0::bigint, 'every client who asked has a link at its address or a staff request');
ROLLBACK;
