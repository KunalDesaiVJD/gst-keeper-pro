-- Which link takes answers when e-mails are queued, sent or failed.
-- A link shows a unit as replaced only once a NEWER request about the unit
-- is out (outbox sent, or the row gone). Round 1: the earlier link died for
-- an e-mail nobody got. Round 2: (a) while the newer e-mail only waits in the
-- outbox or is stuck "sending", the earlier link keeps answering; (b) a link
-- replaced by a delivered request stays replaced when a still newer request
-- fails, so it never comes back to life. A confirmed or accepted unit shows
-- its answer on every link that asked.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
                    'a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@client.test'], NULL) AS r1 \gset
SELECT :'r1'::jsonb ->> 'token' AS tok1, :'r1'::jsonb ->> 'outbox_id' AS ob1 \gset
UPDATE email_outbox SET status = 'sent' WHERE id = :'ob1';

SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003']::uuid[],
              ARRAY['new@client.test'], NULL) AS r2 \gset
SELECT :'r2'::jsonb ->> 'token' AS tok2, :'r2'::jsonb ->> 'outbox_id' AS ob2, :'r2'::jsonb ->> 'request_id' AS req2 \gset
-- (a) Queued (the immediate send failed before it claimed the row; it waits
-- for the next run) or stuck sending: the client's only delivered link answers.
SELECT t_eq((SELECT status FROM email_outbox WHERE id = :'ob2'), 'pending', 'the newer e-mail waits in the outbox');
SELECT t_eq(t_states(:'tok1'), 'A-101:PENDING,A-102:PENDING,A-103:PENDING', 'pending: the earlier link still answers');
UPDATE email_outbox SET status = 'sending' WHERE id = :'ob2';
SELECT t_eq(t_states(:'tok1'), 'A-101:PENDING,A-102:PENDING,A-103:PENDING', 'stuck sending: the earlier link still answers');
SELECT t_eq(t_states(:'tok2'), 'A-102:PENDING,A-103:PENDING', 'and so does the newer one (it may have arrived)');
UPDATE email_outbox SET status = 'sent' WHERE id = :'ob2';
SELECT t_eq(t_states(:'tok1'), 'A-101:PENDING,A-102:REPLACED,A-103:REPLACED', 'sent: the earlier link shows them replaced');
SELECT t_eq(t_results(t_respond(:'tok1', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')), 'Owner', 'owner@client.test')),
            'A-103:REPLACED', 'and takes no answer for them');

-- The newer e-mail fails: the earlier link answers again.
UPDATE email_outbox SET status = 'failed', error = 'sendMail 400' WHERE id = :'ob2';
SELECT t_eq(t_states(:'tok1'), 'A-101:PENDING,A-102:PENDING,A-103:PENDING', 'failed: the earlier link is open again');
SELECT t_eq(t_results(t_respond(:'tok1', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000002', 'CONFIRM')), 'Owner', 'owner@client.test')),
            'A-102:CONFIRMED', 'answered through the earlier link');
SELECT t_raises(format($q$SELECT t_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')), 'New', 'new@client.test')$q$, :'tok1'),
                'reached you at', 'by someone the earlier e-mail went to, not the failed one''s');
SELECT t_eq((SELECT request_id::text FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000002'), :'req2',
            'the unit stays on the newest request');
SELECT t_eq(t_states(:'tok2'), 'A-102:CONFIRMED,A-103:PENDING', 'the failed request''s page agrees');

-- Skipped and cancelled count as not out.
UPDATE email_outbox SET status = 'skipped' WHERE id = :'ob2';
SELECT t_eq(t_states(:'tok1'), 'A-101:PENDING,A-102:CONFIRMED,A-103:PENDING', 'skipped: open');
UPDATE email_outbox SET status = 'cancelled' WHERE id = :'ob2';
SELECT t_eq(t_states(:'tok1'), 'A-101:PENDING,A-102:CONFIRMED,A-103:PENDING', 'cancelled: open');
-- An outbox row that is gone counts as out.
RESET ROLE;
DELETE FROM email_outbox WHERE id = :'ob2';
SET LOCAL ROLE anon;
SELECT t_eq(t_states(:'tok1'), 'A-101:PENDING,A-102:CONFIRMED,A-103:REPLACED', 'the newer e-mail''s row deleted: replaced');
ROLLBACK;

-- (b) A replaced link stays replaced (round 2, defect: a link replaced by a
-- delivered request worked again when a later request failed). R1 went to a
-- mistyped address, R2 to the right one; R3 fails.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@cliient.test'], NULL) AS r1 \gset
UPDATE email_outbox SET status = 'sent' WHERE id = (:'r1'::jsonb ->> 'outbox_id')::uuid;
-- The stranger at the mistyped address proves it before the fix goes out.
SELECT t_proof(:'r1'::jsonb ->> 'token', 'owner@cliient.test') AS stranger \gset
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL) AS r2 \gset
UPDATE email_outbox SET status = 'sent' WHERE id = (:'r2'::jsonb ->> 'outbox_id')::uuid;
SELECT t_eq(t_states(:'r1'::jsonb ->> 'token'), 'A-101:REPLACED', 'R2 out: R1 replaced');
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], ARRAY['ca@firm.test']) AS r3 \gset
UPDATE email_outbox SET status = 'failed', error = 'sendMail 400' WHERE id = (:'r3'::jsonb ->> 'outbox_id')::uuid;
SELECT t_eq(t_states(:'r1'::jsonb ->> 'token'), 'A-101:REPLACED', 'R3 failed: R1 stays replaced (R2, newer, is out)');
SELECT t_eq(t_results(builder_bu_confirm_respond(:'r1'::jsonb ->> 'token', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Stranger', 'owner@cliient.test', :'stranger')),
            'A-101:REPLACED', 'the stranger''s answer is not taken');
SELECT t_eq(t_states(:'r2'::jsonb ->> 'token'), 'A-101:PENDING', 'R2, the latest delivered link, answers');
SELECT t_eq(t_results(t_respond(:'r2'::jsonb ->> 'token', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Owner', 'owner@client.test')),
            'A-101:CONFIRMED', 'answered on R2');
SELECT t_eq((SELECT status || '/' || responded_by_email FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000001'), 'CONFIRMED/owner@client.test', 'by the right person');
SELECT t_eq((SELECT u ->> 'responded_by_email' FROM jsonb_array_elements(builder_bu_confirm_lookup(:'r1'::jsonb ->> 'token') -> 'units') u),
            'o…r@client.test', 'the stranger''s link shows who answered only masked');
ROLLBACK;

-- (b) again, with three units: R1 replaced whole by R2 (out), then R3 for one
-- unit to a new address fails. R1 stays replaced for every unit.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
                    'a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@client.test'], NULL) AS r1 \gset
UPDATE email_outbox SET status = 'sent' WHERE id = (:'r1'::jsonb ->> 'outbox_id')::uuid;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
                    'a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@client.test', 'accounts@client.test'], NULL) AS r2 \gset
UPDATE email_outbox SET status = 'sent' WHERE id = (:'r2'::jsonb ->> 'outbox_id')::uuid;
SELECT t_eq(t_states(:'r1'::jsonb ->> 'token'), 'A-101:REPLACED,A-102:REPLACED,A-103:REPLACED', 'R1 replaced');
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['third@client.test'], NULL) AS r3 \gset
UPDATE email_outbox SET status = 'failed' WHERE id = (:'r3'::jsonb ->> 'outbox_id')::uuid;
SELECT t_eq(t_states(:'r1'::jsonb ->> 'token'), 'A-101:REPLACED,A-102:REPLACED,A-103:REPLACED', 'R3 failed: R1 still replaced');
SELECT t_eq(t_results(t_respond(:'r1'::jsonb ->> 'token', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Old Reader', 'owner@client.test')),
            'A-101:REPLACED', 'R1 takes no answer');
SELECT t_eq(t_states(:'r2'::jsonb ->> 'token'), 'A-101:PENDING,A-102:PENDING,A-103:PENDING', 'R2 answers');
SELECT t_eq(t_results(t_respond(:'r2'::jsonb ->> 'token', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Accounts', 'accounts@client.test')),
            'A-101:CONFIRMED', 'answered on R2');
ROLLBACK;

-- The same for a per-unit link e-mailed before this change.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
UPDATE clients SET email = 'owner@client.test' WHERE id = 'c1000000-0000-0000-0000-000000000001';
SELECT t_old_app($f$INSERT INTO builder_bu_agreement_confirmations (bu_event_id, unit_id, client_id, agreement_value_at_request, status, sent_at)
VALUES ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 4500000, 'PENDING', now())$f$);
SELECT t_legacy_snapshot() = 1;
SELECT token AS t1 FROM builder_bu_agreement_confirmations \gset
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['new@client.test'], NULL) ->> 'outbox_id' AS ob \gset
SELECT t_eq(t_states(:'t1'), 'A-101:PENDING', 'queued: the per-unit link still answers');
UPDATE email_outbox SET status = 'sent' WHERE id = :'ob';
SELECT t_eq(t_states(:'t1'), 'A-101:REPLACED', 'sent: replaced');
UPDATE email_outbox SET status = 'failed' WHERE id = :'ob';
SELECT t_eq(t_states(:'t1'), 'A-101:PENDING', 'failed: the per-unit link is open again');
SELECT t_eq(t_results(t_respond(:'t1', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Owner', 'owner@client.test')), 'A-101:CONFIRMED', 'and answers');
ROLLBACK;
