-- A re-send while the earlier e-mail still waits in the outbox (round 2,
-- defect: the earlier e-mail went out later with a dead link). When the new
-- request asks everything the earlier one asked (or the rest is answered),
-- the earlier e-mail is cancelled in the same transaction. And whether an
-- earlier link reached the client (round 2, defect: a failed first send said
-- "the earlier link still takes answers" when there was none).
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

-- First send for the event: no earlier link.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[],
              ARRAY['owner@client.test'], NULL) AS r1 \gset
SELECT t_eq((:'r1'::jsonb ->> 'earlier_link')::boolean, false, 'a first send: no earlier link');
SELECT t_eq((SELECT earlier_link FROM builder_bu_confirm_requests WHERE id = (:'r1'::jsonb ->> 'request_id')::uuid), false, 'kept on the request');

-- R1's e-mail is still queued (the immediate send failed before it claimed
-- the row). R2 asks about the same units: R1's e-mail is cancelled.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[],
              ARRAY['owner@client.test'], ARRAY['accounts@client.test']) AS r2 \gset
SELECT t_eq((:'r2'::jsonb ->> 'cancelled_earlier')::int, 1, 'one earlier e-mail cancelled');
SELECT t_eq((SELECT status || '/' || error FROM email_outbox WHERE id = (:'r1'::jsonb ->> 'outbox_id')::uuid),
            'cancelled/Replaced by a newer confirmation request before it was sent.', 'R1''s e-mail will not go');
SELECT t_eq((SELECT status FROM email_outbox WHERE id = (:'r2'::jsonb ->> 'outbox_id')::uuid), 'pending', 'R2''s waits to go');
SELECT t_eq((:'r2'::jsonb ->> 'earlier_link')::boolean, false, 'R1 never went out: no earlier link');

-- R3 asks about A-101 only: R2 (A-101, A-102) is not cancelled, A-102 still needs it.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL) AS r3 \gset
SELECT t_eq((:'r3'::jsonb ->> 'cancelled_earlier')::int, 0, 'a partial re-send cancels nothing');
SELECT t_eq((SELECT status FROM email_outbox WHERE id = (:'r2'::jsonb ->> 'outbox_id')::uuid), 'pending', 'R2 still goes');

-- R2 goes out; A-102 is confirmed on it. R4 for A-101: R3 (A-101, queued) is
-- cancelled; R2 is sent, not touched. And an earlier link did reach the client.
UPDATE email_outbox SET status = 'sent' WHERE id = (:'r2'::jsonb ->> 'outbox_id')::uuid;
SELECT t_eq(t_results(t_respond(:'r2'::jsonb ->> 'token', jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000002', 'CONFIRM')),
                                'Accounts', 'accounts@client.test')), 'A-102:CONFIRMED', 'A-102 answered on R2');
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL) AS r4 \gset
SELECT t_eq((:'r4'::jsonb ->> 'cancelled_earlier')::int, 1, 'R3 cancelled');
SELECT t_eq((SELECT string_agg(o.status, ',' ORDER BY r.seq) FROM builder_bu_confirm_requests r JOIN email_outbox o ON o.id = r.outbox_id),
            'cancelled,sent,cancelled,pending', 'R1 cancelled, R2 sent, R3 cancelled, R4 waiting');
SELECT t_eq((:'r4'::jsonb ->> 'earlier_link')::boolean, true, 'R2 reached the client: an earlier link exists');
SELECT t_eq(t_states(:'r2'::jsonb ->> 'token'), 'A-101:PENDING,A-102:CONFIRMED', 'and it still answers while R4 waits');

-- An earlier request with A-102 answered and A-101 asked again is fully
-- covered: cancelled. (R5 queued for A-101, then R6 for A-101.)
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL) AS r5 \gset
SELECT t_eq((SELECT status FROM email_outbox WHERE id = (:'r4'::jsonb ->> 'outbox_id')::uuid), 'cancelled', 'R4 cancelled by R5');

-- A failed or sent e-mail is never touched.
UPDATE email_outbox SET status = 'failed' WHERE id = (:'r5'::jsonb ->> 'outbox_id')::uuid;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL) AS r6 \gset
SELECT t_eq((SELECT status FROM email_outbox WHERE id = (:'r5'::jsonb ->> 'outbox_id')::uuid), 'failed', 'a failed e-mail stays failed');
SELECT t_eq((SELECT status FROM email_outbox WHERE id = (:'r2'::jsonb ->> 'outbox_id')::uuid), 'sent', 'a sent one stays sent');
ROLLBACK;
