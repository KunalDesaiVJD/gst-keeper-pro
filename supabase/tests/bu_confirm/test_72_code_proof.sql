-- Who may answer, proved (round 2, defect: anyone holding the link answered
-- as the client by typing the client's To address, which every recipient,
-- the firm's copy in its Sent Items, and the BU Events page all show). An
-- answer now needs a proof that the reader read a code e-mailed to the
-- address they answer as. The code goes only to that mailbox: never through
-- email_outbox, never readable with the public key.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

-- The repro: To the owner, CC the firm's mailbox and a staff member's own address.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
                    'a1000000-0000-0000-0000-000000000003']::uuid[],
              ARRAY['owner@client.test'], ARRAY['gst@vjdesai.com', 'jay.junior@gmail.test']) ->> 'token' AS tok \gset
SELECT (SELECT count(*) FROM email_outbox) AS outbox_before \gset

-- The firm's copy holder cannot get a code for their own address...
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tok', 'gst@vjdesai.com'), 'staff cannot answer', 'no code for the firm''s mailbox');
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tok', 'Jay.Junior@gmail.test'), 'staff cannot answer', 'nor for a staff member''s own address');
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tok', 'someone@client.test'), 'reached you at', 'nor for an address not on the e-mail');
-- ...and asking one for the owner's address sends it to the owner, not to them.
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') AS req \gset
SELECT t_eq((:'req'::jsonb ->> 'ok')::boolean, true, 'a code is queued for the owner''s address');
SELECT t_eq(:'req'::jsonb ? 'code', false, 'the answer carries no code');
SELECT t_raises('SELECT count(*) FROM builder_bu_confirm_codes', 'permission denied', 'the public key cannot read the codes');
SELECT t_raises(format('SELECT * FROM builder_bu_confirm_code_claim(%L)', :'req'::jsonb ->> 'code_id'), 'permission denied', 'nor claim one (only the mailer can)');
SELECT t_raises(format('SELECT builder_bu_confirm_code_mark(%L, NULL)', :'req'::jsonb ->> 'code_id'), 'permission denied', 'nor report one sent');
SELECT t_raises('SELECT builder_bu_confirm_is_staff(''x@y.test'')', 'permission denied', 'the helpers are closed');
-- The mailer e-mails it (only the owner's mailbox sees the digits).
SELECT t_mailbox((:'req'::jsonb ->> 'code_id')::uuid) AS owner_code \gset
SELECT t_eq(:'owner_code' ~ '^[0-9]{6}$', true, 'a 6-digit code');
SELECT t_eq((SELECT count(*) FROM email_outbox)::int, :'outbox_before'::int, 'the code never goes through email_outbox');
SELECT t_eq((SELECT count(*) FROM email_outbox WHERE position(:'owner_code' IN body) > 0 OR position(:'owner_code' IN COALESCE(render_vars::text, '')) > 0)::int,
            0, 'and appears in no outbox row');
RESET ROLE;
SELECT t_eq((SELECT code_hash = encode(extensions.digest(id::text || ':' || :'owner_code', 'sha256'), 'hex') AND proof_hash IS NULL
               FROM builder_bu_confirm_codes), true, 'only a hash of the code is stored');
SET LOCAL ROLE anon;

-- The copy holder answers as the owner without the code: refused.
SELECT t_raises(format($q$SELECT builder_bu_confirm_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Owner', 'owner@client.test', NULL)$q$, :'tok'),
                'with the code we send', 'no proof: refused');
SELECT t_raises(format($q$SELECT builder_bu_confirm_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Owner', 'owner@client.test', %L)$q$, :'tok', repeat('ab', 32)),
                'with the code we send', 'a made-up proof: refused');
-- Guessing: a wrong code is counted and refused (not raised, so the count stays).
SELECT t_eq(builder_bu_confirm_code_verify(:'tok', 'owner@client.test', '000000') ->> 'ok', 'false', 'a wrong code');
SELECT t_eq(builder_bu_confirm_code_verify(:'tok', 'owner@client.test', '12ab56') ->> 'message', 'The code is the 6 digits in our latest e-mail.', 'not digits: not counted');
RESET ROLE;
SELECT t_eq((SELECT wrong_tries FROM builder_bu_confirm_codes), 1, 'one wrong try counted');
SET LOCAL ROLE anon;
SELECT builder_bu_confirm_code_verify(:'tok', 'owner@client.test', lpad(((:'owner_code'::int + n) % 1000000)::text, 6, '0'))
  FROM generate_series(1, 4) n;
SELECT t_eq(builder_bu_confirm_code_verify(:'tok', 'owner@client.test', :'owner_code') ->> 'message',
            'Too many wrong tries for this code. Please ask for a new one.', 'five wrong tries end the code, even for the right digits');
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), true, 'the gate stays shut');
SELECT t_eq((SELECT count(*) FROM builder_bu_agreement_confirmations WHERE status <> 'PENDING' OR responded_by_email IS NOT NULL)::int, 0, 'nothing recorded');

-- The owner asks again, reads the new code, and answers.
SELECT t_mailbox((builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id')::uuid) AS code2 \gset
SELECT builder_bu_confirm_code_verify(:'tok', 'Owner@Client.test', ' ' || :'code2' || ' ') AS v \gset
SELECT t_eq((:'v'::jsonb ->> 'ok')::boolean AND length(:'v'::jsonb ->> 'proof') = 64, true, 'the right code gives a proof');
SELECT :'v'::jsonb ->> 'proof' AS proof \gset
-- The proof is for that address on that link only.
SELECT t_raises(format($q$SELECT builder_bu_confirm_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Jay', 'jay.junior@gmail.test', %L)$q$, :'tok', :'proof'),
                'staff cannot answer', 'the proof does not let a staff address answer');
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test', 'accounts@client.test'], NULL,
              p_event => 'e1000000-0000-0000-0000-000000000001') ->> 'token' AS tok_other \gset
SELECT t_raises(format($q$SELECT builder_bu_confirm_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Owner', 'owner@client.test', %L)$q$, :'tok_other', :'proof'),
                'with the code we send', 'nor another link');
SELECT t_raises(format($q$SELECT builder_bu_confirm_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Accounts', 'accounts@client.test', %L)$q$, :'tok_other', :'proof'),
                'with the code we send', 'nor another address');
SELECT t_eq(t_results(builder_bu_confirm_respond(:'tok', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000002', 'CONFIRM'), t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')),
              'Owner', 'owner@client.test', :'proof')), 'A-102:CONFIRMED,A-103:CONFIRMED', 'the owner answers with the proof');
SELECT t_eq((SELECT string_agg(responded_by_email, ',') FROM builder_bu_agreement_confirmations WHERE status = 'CONFIRMED'),
            'owner@client.test,owner@client.test', 'recorded as the owner');
-- The proof works for later answers too, for 2 hours.
RESET ROLE;
UPDATE builder_bu_confirm_codes SET verified_at = now() - interval '2 hours 1 minute' WHERE proof_hash IS NOT NULL;
SET LOCAL ROLE anon;
SELECT t_raises(format($q$SELECT builder_bu_confirm_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Owner', 'owner@client.test', %L)$q$, :'tok', :'proof'),
                'with the code we send', 'a proof older than 2 hours: refused');
ROLLBACK;

-- Limits, expiry and a failed e-mail.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[],
              ARRAY['owner@client.test'], ARRAY['accounts@client.test', 'site@client.test']) ->> 'token' AS tok \gset
-- Asked, never typed: the code expires after 30 minutes.
SELECT t_mailbox((builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id')::uuid) AS c1 \gset
RESET ROLE;
UPDATE builder_bu_confirm_codes SET expires_at = now() - interval '1 second';
SET LOCAL ROLE anon;
SELECT t_eq(builder_bu_confirm_code_verify(:'tok', 'owner@client.test', :'c1') ->> 'message', 'This code has expired. Please ask for a new one.', 'expired');
-- Only the latest code counts.
SELECT t_mailbox((builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id')::uuid) AS c2 \gset
SELECT t_mailbox((builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id')::uuid) AS c3 \gset
SELECT t_eq((builder_bu_confirm_code_verify(:'tok', 'owner@client.test', :'c3') ->> 'ok')::boolean, true, 'the latest code works');
-- Five codes an hour to one address.
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') IS NOT NULL;
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') IS NOT NULL;
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tok', 'owner@client.test'), '5 codes to this address in the last hour', 'a sixth in the hour: refused');
-- Ten a day.
RESET ROLE;
UPDATE builder_bu_confirm_codes SET created_at = now() - interval '2 hours';
SET LOCAL ROLE anon;
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') FROM generate_series(1, 5);
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tok', 'owner@client.test'), '10 codes to this address today', 'an eleventh in the day: refused');
-- Twenty an hour on one link, whatever the address.
SELECT builder_bu_confirm_code_request(:'tok', 'accounts@client.test') FROM generate_series(1, 5);
SELECT builder_bu_confirm_code_request(:'tok', 'site@client.test') FROM generate_series(1, 4);
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_codes WHERE created_at > now() - interval '1 hour')::int, 14, '14 this hour');
INSERT INTO builder_bu_confirm_codes (request_id, email)
SELECT id, 'other' || g || '@client.test' FROM builder_bu_confirm_requests, generate_series(1, 6) g;
SET LOCAL ROLE anon;
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tok', 'site@client.test'), 'Too many codes were asked for on this link', 'twenty on a link in an hour: refused');
ROLLBACK;

-- Ten wrong tries a day end an address's codes on a link; a code the mailer
-- could not send never verifies.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'token' AS tok \gset
SELECT t_mailbox((builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id')::uuid) AS c1 \gset
SELECT builder_bu_confirm_code_verify(:'tok', 'owner@client.test', lpad(((:'c1'::int + n) % 1000000)::text, 6, '0')) FROM generate_series(1, 5) n;
SELECT t_mailbox((builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id')::uuid) AS c2 \gset
SELECT builder_bu_confirm_code_verify(:'tok', 'owner@client.test', lpad(((:'c2'::int + n) % 1000000)::text, 6, '0')) FROM generate_series(1, 5) n;
SELECT t_mailbox((builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id')::uuid) AS c3 \gset
SELECT t_eq(builder_bu_confirm_code_verify(:'tok', 'owner@client.test', :'c3') ->> 'message',
            'Too many wrong codes for this address today. Please try again tomorrow, or write to us at gst@vjdesai.com.', 'ten wrong tries a day: even the right code is refused');
-- A failed e-mail.
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id' AS cid \gset
RESET ROLE;
DELETE FROM builder_bu_confirm_codes WHERE id <> :'cid';
SELECT code AS c4 FROM builder_bu_confirm_code_claim(:'cid') \gset
SELECT builder_bu_confirm_code_mark(:'cid', 'sendMail 400: bad recipient');
SELECT builder_bu_confirm_code_mark(:'cid', NULL);
SELECT t_eq((SELECT sent_at IS NULL AND send_error LIKE 'sendMail 400%' FROM builder_bu_confirm_codes WHERE id = :'cid'), true, 'the first report stands');
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_code_claim(:'cid'))::int, 0, 'a code is claimed once');
SET LOCAL ROLE anon;
SELECT t_eq(builder_bu_confirm_code_verify(:'tok', 'owner@client.test', :'c4') ->> 'message', 'We could not e-mail that code. Please ask for a new one.', 'a code that failed to go never verifies');
-- Asked for and never claimed within 15 minutes: never sent.
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id' AS cid2 \gset
RESET ROLE;
UPDATE builder_bu_confirm_codes SET created_at = now() - interval '16 minutes' WHERE id = :'cid2';
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_code_claim(:'cid2'))::int, 0, 'a stale code is not sent');
SELECT t_eq((SELECT project_name || '/' || client_name || '/' || to_email
               FROM builder_bu_confirm_code_claim((SELECT (builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id')::uuid))),
            'Test Heights/Shree Test Infra/owner@client.test', 'the mailer gets what the e-mail says');
ROLLBACK;

-- A per-unit link of before this change: the code goes to the address that
-- e-mail went to, or the client master's.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
UPDATE clients SET email = 'Accounts <accounts@client.test>' WHERE id = 'c1000000-0000-0000-0000-000000000001';
INSERT INTO builder_bu_agreement_confirmations (bu_event_id, unit_id, client_id, agreement_value_at_request, status, sent_at)
VALUES ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 4500000, 'PENDING', now());
SELECT token AS t1 FROM builder_bu_agreement_confirmations \gset
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'t1', 'sam@vjdesai.com'), 'staff cannot answer', 'per-unit link: no code for staff');
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'t1', 'owner@client.test'), 'reached you at', 'per-unit link: none for a stranger');
SELECT t_eq(t_results(builder_bu_confirm_respond(:'t1', jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')),
                                                  'Accounts', 'accounts@client.test', t_proof(:'t1', 'accounts@client.test'))),
            'A-101:CONFIRMED', 'per-unit link: the master''s address proves it and answers');
RESET ROLE;
SELECT t_eq((SELECT confirmation_id IS NOT NULL AND request_id IS NULL FROM builder_bu_confirm_codes), true, 'the code belongs to the per-unit link');
ROLLBACK;
