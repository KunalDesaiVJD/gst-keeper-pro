-- Confirm one unit and dispute another (a dispute needs a note); several
-- people answer different units of the same request; each answer carries its
-- own responder.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
                    'a1000000-0000-0000-0000-000000000003']::uuid[],
              ARRAY['owner@client.test', 'director@client.test'], ARRAY['meena@ca.test']) ->> 'token' AS tok \gset

-- A dispute without a note: nothing is recorded, not even the confirmation.
SELECT t_raises(format($q$SELECT t_respond(%L, jsonb_build_array(
                   t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM'),
                   t_answer('a1000000-0000-0000-0000-000000000002', 'DISPUTE', '   ')), 'Meena Patel', 'meena@ca.test')$q$, :'tok'),
                'what has changed for unit A-102', 'a dispute needs a note');
SELECT t_eq(t_states(:'tok'), 'A-101:PENDING,A-102:PENDING,A-103:PENDING', 'nothing recorded');

SELECT t_eq(t_results(t_respond(:'tok', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM'),
              t_answer('a1000000-0000-0000-0000-000000000002', 'DISPUTE', 'Agreement revised to Rs. 54 lakh on 2 Sep 2026')),
              'Meena Patel', 'meena@ca.test')),
            'A-101:CONFIRMED,A-102:DISPUTED', 'confirm one, dispute another');
SELECT t_eq((SELECT status || '/' || dispute_notes || '/' || responded_by_name || '/' || responded_by_email
               FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000002'),
            'DISPUTED/Agreement revised to Rs. 54 lakh on 2 Sep 2026/Meena Patel/meena@ca.test', 'the dispute, its note and who raised it');
SELECT t_eq(t_states(:'tok'), 'A-101:CONFIRMED,A-102:DISPUTED,A-103:PENDING', 'the page shows both answers and the open unit');
SELECT t_eq((SELECT u ->> 'dispute_notes' FROM jsonb_array_elements(builder_bu_confirm_lookup(:'tok') -> 'units') u WHERE u ->> 'unit_no' = 'A-102'),
            'Agreement revised to Rs. 54 lakh on 2 Sep 2026', 'the next reader sees the note');
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), true, 'still blocked');

-- Another reader: the dispute stands; the open unit takes their answer.
SELECT t_eq(t_results(t_respond(:'tok', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000002', 'CONFIRM'),
              t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')), 'Ravi Mehta', 'Director@Client.test')),
            'A-102:ALREADY_DISPUTED,A-103:CONFIRMED', 'a disputed unit waits for staff; the open one is confirmed');
SELECT t_eq((SELECT string_agg(u.unit_no || '=' || c.responded_by_email, ',' ORDER BY u.unit_no)
               FROM builder_bu_agreement_confirmations c JOIN builder_units u ON u.id = c.unit_id),
            'A-101=meena@ca.test,A-102=meena@ca.test,A-103=director@client.test', 'each unit keeps its own responder');
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), true, 'the dispute still blocks');
ROLLBACK;
