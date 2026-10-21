-- Re-sending replaces the earlier request for the units it asks about: the
-- earlier link shows them as replaced and takes no answer for them; a unit
-- confirmed or accepted is never asked again.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
                    'a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@client.test'], NULL) AS r1 \gset
SELECT :'r1'::jsonb ->> 'token' AS tok1, :'r1'::jsonb ->> 'request_id' AS req1 \gset
SELECT t_eq(t_results(builder_bu_confirm_respond(:'tok1', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM'),
              t_answer('a1000000-0000-0000-0000-000000000002', 'DISPUTE', 'Value is 50 lakh')), 'Meena Patel', 'meena@ca.test')),
            'A-101:CONFIRMED,A-102:DISPUTED', 'first answers');

-- A confirmed unit cannot be asked again.
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[], ARRAY['owner@client.test'], NULL)$$,
                'Already confirmed or accepted: unit A-101', 'a confirmed unit is not re-sent');

-- Re-send the disputed and the open unit, by an employee holding post_bu_event.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003']::uuid[],
              ARRAY['owner@client.test'], ARRAY['site@client.test'], '10000000-0000-0000-0000-000000000003') AS r2 \gset
SELECT :'r2'::jsonb ->> 'token' AS tok2, :'r2'::jsonb ->> 'request_id' AS req2 \gset
SELECT t_eq((SELECT count(*) FROM email_outbox)::int, 2, 'one e-mail per send');
SELECT t_eq((SELECT status || '/' || COALESCE(responded_by_name, '-') || '/' || COALESCE(dispute_notes, '-') || '/' || (request_id::text = :'req2')::text
               FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000002'),
            'PENDING/-/-/true', 'the disputed unit is open again on the new request');
SELECT t_eq((SELECT (request_id::text = :'req1')::text || '/' || status || '/' || responded_by_email
               FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000001'),
            'true/CONFIRMED/meena@ca.test', 'the confirmed unit stays on the first request');

-- The first link: replaced for the units the new request took.
SELECT t_eq(t_states(:'tok1'), 'A-101:CONFIRMED,A-102:REPLACED,A-103:REPLACED', 'the earlier link shows them replaced');
SELECT t_eq((SELECT u ->> 'responded_by_name' FROM jsonb_array_elements(builder_bu_confirm_lookup(:'tok1') -> 'units') u WHERE u ->> 'unit_no' = 'A-102'),
            NULL::text, 'a replaced unit shows no answer');
SELECT t_eq(t_results(builder_bu_confirm_respond(:'tok1', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')), 'Old Reader', 'old@client.test')),
            'A-103:REPLACED', 'the earlier link takes no answer for it');
SELECT t_eq((SELECT status FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000003'), 'PENDING', 'still open');

-- The new link.
SELECT t_eq(t_states(:'tok2'), 'A-102:PENDING,A-103:PENDING', 'the new link asks about its two units');
SELECT t_eq(t_results(builder_bu_confirm_respond(:'tok2', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000002', 'CONFIRM')), 'Site Office', 'site@client.test')),
            'A-102:CONFIRMED', 'answered on the new link');

-- The firm accepts the last one: the page shows it accepted; it is never asked again.
SELECT t_eq(builder_bu_agreement_override('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003',
                                          '10000000-0000-0000-0000-000000000001', ''), 'OVERRIDDEN', 'accepted by the firm');
SELECT t_eq(t_states(:'tok2'), 'A-102:CONFIRMED,A-103:ACCEPTED', 'the page shows it accepted');
SELECT t_eq(t_results(builder_bu_confirm_respond(:'tok2', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000003', 'DISPUTE', 'no')), 'Site Office', 'site@client.test')),
            'A-103:ALREADY_ACCEPTED', 'an accepted unit takes no answer');
SELECT t_raises($$SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@client.test'], NULL)$$,
                'Already confirmed or accepted: unit A-103', 'an accepted unit is not re-sent');
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), false, 'every unit cleared');

-- Deleting the event takes its requests with it.
RESET ROLE;
DELETE FROM builder_bu_events WHERE id = 'e1000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_requests)::int, 0, 'requests go with the event');
ROLLBACK;
