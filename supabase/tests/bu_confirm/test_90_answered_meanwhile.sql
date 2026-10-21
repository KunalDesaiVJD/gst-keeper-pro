-- A unit answered while staff had the pop-up open (round 1, defect: the
-- refusal looped). The send writes nothing and returns the units answered
-- meanwhile, with who answered; the browser drops them and sends again. The
-- message never tells staff to reopen the window.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
                    'a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@client.test'], ARRAY['accounts@client.test']) AS r1 \gset
SELECT :'r1'::jsonb ->> 'token' AS tok1, :'r1'::jsonb ->> 'request_id' AS req1 \gset
SELECT t_eq((:'r1'::jsonb ->> 'sent')::boolean, true, 'a send says it was sent');

-- A CC reader confirms A-101; the firm accepts A-103.
SELECT t_eq(t_results(builder_bu_confirm_respond(:'tok1', jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')),
                                                 'Accounts', 'accounts@client.test')), 'A-101:CONFIRMED', 'answered by a CC reader');
SELECT t_eq(builder_bu_agreement_override('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003',
                                          '10000000-0000-0000-0000-000000000001', ''), 'OVERRIDDEN', 'accepted');

-- Staff, from a stale list, re-send all three.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
                    'a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@client.test'], NULL) AS r2 \gset
SELECT t_eq((:'r2'::jsonb ->> 'sent')::boolean, false, 'not sent');
SELECT t_eq(:'r2'::jsonb ? 'request_id', false, 'no request');
SELECT t_eq((SELECT string_agg((x ->> 'unit_no') || ':' || (x ->> 'status') || ':' || COALESCE(x ->> 'responded_by_email', '-'), ',' ORDER BY n)
               FROM jsonb_array_elements(:'r2'::jsonb -> 'already_answered') WITH ORDINALITY t(x, n)),
            'A-101:CONFIRMED:accounts@client.test,A-103:OVERRIDDEN:-', 'the units answered meanwhile, and who answered');
SELECT t_eq((SELECT count(*) FROM email_outbox)::int, 1, 'no e-mail queued');
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_requests)::int, 1, 'no request written');
SELECT t_eq((SELECT request_id::text FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000002'), :'req1',
            'the open unit stays on the first request');
SELECT t_eq(t_states(:'tok1'), 'A-101:CONFIRMED,A-102:PENDING,A-103:ACCEPTED', 'the first link is untouched');

-- The browser sends again without them: it goes.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000002']::uuid[], ARRAY['owner@client.test'], NULL) AS r3 \gset
SELECT t_eq((:'r3'::jsonb ->> 'sent')::boolean AND (:'r3'::jsonb ->> 'units')::int = 1, true, 'sent for the one left');
SELECT t_eq(t_states(:'tok1'), 'A-101:CONFIRMED,A-102:REPLACED,A-103:ACCEPTED', 'the first link: replaced only where asked again');

-- The message the old refusal carried is gone from the function.
SELECT t_eq((SELECT position('open it again' IN prosrc) FROM pg_proc WHERE proname = 'builder_bu_confirm_request_send'), 0,
            'no "close this window, open it again"');
ROLLBACK;
