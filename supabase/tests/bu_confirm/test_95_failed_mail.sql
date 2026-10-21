-- A re-send whose e-mail fails (round 1, defect: the earlier link died for an
-- e-mail nobody got). While the newer request's e-mail is failed, skipped or
-- cancelled the earlier link keeps answering; once it is queued or sent the
-- earlier link shows "replaced". A confirmed or accepted unit shows its answer
-- on every link that asked.
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
SELECT t_eq(t_states(:'tok1'), 'A-101:PENDING,A-102:REPLACED,A-103:REPLACED', 'queued: the earlier link shows them replaced');

-- The newer e-mail fails: the earlier link answers again.
UPDATE email_outbox SET status = 'failed', error = 'sendMail 400' WHERE id = :'ob2';
SELECT t_eq(t_states(:'tok1'), 'A-101:PENDING,A-102:PENDING,A-103:PENDING', 'failed: the earlier link is open again');
SELECT t_eq(t_results(builder_bu_confirm_respond(:'tok1', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000002', 'CONFIRM')), 'Owner', 'owner@client.test')),
            'A-102:CONFIRMED', 'answered through the earlier link');
SELECT t_raises(format($q$SELECT builder_bu_confirm_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')), 'New', 'new@client.test')$q$, :'tok1'),
                'reached you at', 'by someone the earlier e-mail went to, not the failed one''s');
SELECT t_eq((SELECT request_id::text FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000002'), :'req2',
            'the unit stays on the newest request');
SELECT t_eq(t_states(:'tok2'), 'A-102:CONFIRMED,A-103:PENDING', 'the failed request''s page agrees');

-- Skipped and cancelled count as failed; pending, sending and sent as out.
UPDATE email_outbox SET status = 'skipped' WHERE id = :'ob2';
SELECT t_eq(t_states(:'tok1'), 'A-101:PENDING,A-102:CONFIRMED,A-103:PENDING', 'skipped: open');
UPDATE email_outbox SET status = 'cancelled' WHERE id = :'ob2';
SELECT t_eq(t_states(:'tok1'), 'A-101:PENDING,A-102:CONFIRMED,A-103:PENDING', 'cancelled: open');
UPDATE email_outbox SET status = 'sending' WHERE id = :'ob2';
SELECT t_eq(t_states(:'tok1'), 'A-101:PENDING,A-102:CONFIRMED,A-103:REPLACED', 'sending: replaced (a confirmed unit shows its answer)');
UPDATE email_outbox SET status = 'sent' WHERE id = :'ob2';
SELECT t_eq(t_states(:'tok1'), 'A-101:PENDING,A-102:CONFIRMED,A-103:REPLACED', 'sent: replaced');
SELECT t_eq(t_results(builder_bu_confirm_respond(:'tok1', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')), 'Owner', 'owner@client.test')),
            'A-103:REPLACED', 'and takes no answer for it');
ROLLBACK;

-- The same for a per-unit link e-mailed before this change.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
UPDATE clients SET email = 'owner@client.test' WHERE id = 'c1000000-0000-0000-0000-000000000001';
INSERT INTO builder_bu_agreement_confirmations (bu_event_id, unit_id, client_id, agreement_value_at_request, status, sent_at)
VALUES ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 4500000, 'PENDING', now());
SELECT token AS t1 FROM builder_bu_agreement_confirmations \gset
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['new@client.test'], NULL) ->> 'outbox_id' AS ob \gset
SELECT t_eq(t_states(:'t1'), 'A-101:REPLACED', 'queued: replaced');
UPDATE email_outbox SET status = 'failed' WHERE id = :'ob';
SELECT t_eq(t_states(:'t1'), 'A-101:PENDING', 'failed: the per-unit link is open again');
SELECT t_eq(t_results(builder_bu_confirm_respond(:'t1', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Owner', 'owner@client.test')), 'A-101:CONFIRMED', 'and answers');
ROLLBACK;
