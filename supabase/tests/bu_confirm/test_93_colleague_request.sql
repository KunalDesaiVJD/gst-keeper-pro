-- A colleague's request sent while the pop-up was open (round 3, low defect:
-- the pop-up said the unit was "answered ... (changed)" when nobody had
-- answered; a newer request had gone to someone else, and the pop-up did not
-- say so or to whom). The send reports the unit with that request's To and
-- CC, and with the request the pop-up sends (as it does since round 3), a
-- colleague's newer request for a unit that showed pending is reported too
-- rather than silently replaced.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

-- The pop-up opens: A-101 never sent, A-102 pending on R1.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000002']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'request_id' AS req1 \gset
SELECT t_seen(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[], p_request => true) AS seen \gset
SELECT t_eq(:'seen'::jsonb -> 'a1000000-0000-0000-0000-000000000002' ->> 'request_id', :'req1', 'the pop-up keeps each unit''s request');

-- Meanwhile the GST Manager asks about both, To priya, CC accounts.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[],
              ARRAY['priya@client.test'], ARRAY['accounts@client.test'], '10000000-0000-0000-0000-000000000002') ->> 'request_id' AS req2 \gset

-- Staff press Send: nothing is sent, and the report says who was asked.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[],
              ARRAY['owner@client.test'], NULL, p_seen => :'seen'::jsonb) AS r \gset
SELECT t_eq(:'r'::jsonb ->> 'sent', 'false', 'not sent');
SELECT t_eq((SELECT string_agg((x ->> 'unit_no') || ':' || (x ->> 'status') || ':' || (x ->> 'request_id' = :'req2')::text
                                || ':' || (x -> 'request_to')::text || ':' || (x -> 'request_cc')::text
                                || ':' || COALESCE(x ->> 'responded_by_name', '-'), ',' ORDER BY x ->> 'unit_no')
               FROM jsonb_array_elements(:'r'::jsonb -> 'already_answered') x),
            'A-101:PENDING:true:["priya@client.test"]:["accounts@client.test"]:-,A-102:PENDING:true:["priya@client.test"]:["accounts@client.test"]:-',
            'both reported as asked in the colleague''s request, to priya, CC accounts, answered by nobody');
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_requests)::int, 2, 'no third request');

-- An older page sends no request: A-101 (never sent, now pending) still
-- stops the send; A-102 (pending before and after) does not, as before.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[],
              ARRAY['owner@client.test'], NULL,
              p_seen => :'seen'::jsonb #- '{a1000000-0000-0000-0000-000000000001,request_id}'
                                      #- '{a1000000-0000-0000-0000-000000000002,request_id}') AS old \gset
SELECT t_eq((SELECT string_agg(x ->> 'unit_no', ',') FROM jsonb_array_elements(:'old'::jsonb -> 'already_answered') x), 'A-101',
            'an older page: only the unit whose status changed');
-- Read again (the pop-up reloads after a stopped send), staff may send it, knowingly.
SELECT t_eq(t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL,
                   p_seen => t_seen(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], p_request => true)) ->> 'sent',
            'true', 'with the statuses read again, it goes');
ROLLBACK;
