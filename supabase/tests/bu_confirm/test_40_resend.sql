-- Re-sending replaces the earlier request for the units it asks about: the
-- earlier link shows them as replaced and takes no answer for them; a unit
-- confirmed or accepted is never asked again.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
                    'a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@client.test'], ARRAY['meena@ca.test']) AS r1 \gset
SELECT :'r1'::jsonb ->> 'token' AS tok1, :'r1'::jsonb ->> 'request_id' AS req1 \gset
SELECT t_eq(t_results(t_respond(:'tok1', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM'),
              t_answer('a1000000-0000-0000-0000-000000000002', 'DISPUTE', 'Value is 50 lakh')), 'Meena Patel', 'meena@ca.test')),
            'A-101:CONFIRMED,A-102:DISPUTED', 'first answers');

-- A confirmed unit is not asked again: the send writes nothing and names it.
SELECT t_eq(t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[], ARRAY['owner@client.test'], NULL)
              -> 'already_answered' -> 0 ->> 'unit_no', 'A-101', 'a confirmed unit is not re-sent');
SELECT t_eq((SELECT count(*) FROM email_outbox)::int, 1, 'and nothing was queued');

-- Re-send the disputed and the open unit, by an employee holding post_bu_event.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003']::uuid[],
              ARRAY['owner@client.test'], ARRAY['site@client.test'], '10000000-0000-0000-0000-000000000003') AS r2 \gset
SELECT :'r2'::jsonb ->> 'token' AS tok2, :'r2'::jsonb ->> 'request_id' AS req2 \gset
SELECT t_eq((SELECT count(*) FROM email_outbox)::int, 2, 'one e-mail per send');
-- The dispute it asks about again is kept, with who gave it and the request that asked again.
SELECT t_eq((SELECT count(*) || '/' || max(u.unit_no) || '/' || max(h.status) || '/' || max(h.dispute_notes) || '/' || max(h.responded_by_email)
                    || '/' || max(h.agreement_value) || '/' || (max(h.request_id::text) = :'req1') || '/' || (max(h.cleared_by_request::text) = :'req2')
                    || '/' || max(h.cleared_by::text)
               FROM builder_bu_confirm_answer_history h JOIN builder_units u ON u.id = h.unit_id),
            '1/A-102/DISPUTED/Value is 50 lakh/meena@ca.test/5200000/true/true/10000000-0000-0000-0000-000000000003',
            'the cleared dispute is in the history');
SELECT t_eq((SELECT status || '/' || COALESCE(responded_by_name, '-') || '/' || COALESCE(dispute_notes, '-') || '/' || (request_id::text = :'req2')::text
               FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000002'),
            'PENDING/-/-/true', 'the disputed unit is open again on the new request');
SELECT t_eq((SELECT (request_id::text = :'req1')::text || '/' || status || '/' || responded_by_email
               FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000001'),
            'true/CONFIRMED/meena@ca.test', 'the confirmed unit stays on the first request');

-- The first link: while the new e-mail waits in the outbox it still answers;
-- once it is out, the units the new request took show as replaced.
SELECT t_eq(t_states(:'tok1'), 'A-101:CONFIRMED,A-102:PENDING,A-103:PENDING', 'new e-mail not out yet: the earlier link still answers');
UPDATE email_outbox SET status = 'sent' WHERE id = (:'r2'::jsonb ->> 'outbox_id')::uuid;
SELECT t_eq(t_states(:'tok1'), 'A-101:CONFIRMED,A-102:REPLACED,A-103:REPLACED', 'the earlier link shows them replaced');
SELECT t_eq((SELECT u ->> 'responded_by_name' FROM jsonb_array_elements(builder_bu_confirm_lookup(:'tok1') -> 'units') u WHERE u ->> 'unit_no' = 'A-102'),
            NULL::text, 'a replaced unit shows no answer');
SELECT t_eq(t_results(t_respond(:'tok1', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')), 'Old Reader', 'owner@client.test')),
            'A-103:REPLACED', 'the earlier link takes no answer for it');
SELECT t_eq((SELECT status FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000003'), 'PENDING', 'still open');

-- The new link.
SELECT t_eq(t_states(:'tok2'), 'A-102:PENDING,A-103:PENDING', 'the new link asks about its two units');
SELECT t_eq(t_results(t_respond(:'tok2', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000002', 'CONFIRM')), 'Site Office', 'site@client.test')),
            'A-102:CONFIRMED', 'answered on the new link');

-- The firm accepts the last one: the page shows it accepted; it is never asked again.
SELECT t_eq(builder_bu_agreement_override('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003',
                                          '10000000-0000-0000-0000-000000000001', ''), 'OVERRIDDEN', 'accepted by the firm');
SELECT t_eq(t_states(:'tok2'), 'A-102:CONFIRMED,A-103:ACCEPTED', 'the page shows it accepted');
SELECT t_eq(t_results(t_respond(:'tok2', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000003', 'DISPUTE', 'no')), 'Site Office', 'site@client.test')),
            'A-103:ALREADY_ACCEPTED', 'an accepted unit takes no answer');
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@client.test'], NULL) AS r103 \gset
SELECT t_eq((:'r103'::jsonb #- '{already_answered,0,request_id}' #- '{already_answered,0,request_sent_at}')::text,
            '{"sent": false, "already_answered": [{"status": "OVERRIDDEN", "unit_id": "a1000000-0000-0000-0000-000000000003", "unit_no": "A-103", "request_cc": ["site@client.test"], "request_to": ["owner@client.test"], "responded_at": null, "dispute_notes": null, "responded_by_name": null, "responded_by_email": null}]}',
            'an accepted unit is not re-sent');
SELECT t_eq(:'r103'::jsonb -> 'already_answered' -> 0 ->> 'request_id', :'req2', 'the report names the unit''s request');
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), false, 'every unit cleared');

-- Deleting the event takes its requests with it.
RESET ROLE;
DELETE FROM builder_bu_events WHERE id = 'e1000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_requests)::int, 0, 'requests go with the event');
ROLLBACK;
