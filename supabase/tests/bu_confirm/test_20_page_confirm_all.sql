-- The page: lookup by token, the name and e-mail required, confirm every unit
-- at once; the next reader sees the answer and cannot change it.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001',
                    'a1000000-0000-0000-0000-000000000002']::uuid[],
              ARRAY['owner@client.test'], ARRAY['accounts@client.test', 'ca@firm.test']) ->> 'token' AS tok \gset

SELECT builder_bu_confirm_lookup(:'tok') AS page \gset
SELECT t_eq(:'page'::jsonb ->> 'kind', 'request', 'a request link');
SELECT t_eq(:'page'::jsonb ->> 'project_name', 'Test Heights', 'the project');
SELECT t_eq(:'page'::jsonb ->> 'bu_date', '2026-09-15', 'the BU date');
SELECT t_eq(t_states(:'tok'), 'A-101:PENDING,A-102:PENDING,A-103:PENDING', 'every unit, in unit order, open');
SELECT t_eq((SELECT (u ->> 'agreement_value')::numeric FROM jsonb_array_elements(:'page'::jsonb -> 'units') u WHERE u ->> 'unit_no' = 'A-102'), 5200000::numeric, 'with its agreement value');
SELECT t_eq(builder_bu_confirm_lookup(repeat('0', 48)), NULL::jsonb, 'an unknown token shows nothing');
SELECT t_eq(builder_bu_confirm_lookup(NULL), NULL::jsonb, 'no token shows nothing');
SELECT t_eq(builder_bu_confirm_lookup('short'), NULL::jsonb, 'a short token shows nothing');

-- Bad answers record nothing.
SELECT t_raises(format($q$SELECT builder_bu_confirm_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), ' ', 'r@client.test')$q$, :'tok'), 'give your name', 'no name');
SELECT t_raises(format($q$SELECT builder_bu_confirm_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Rajesh Shah', 'rajesh')$q$, :'tok'), 'valid e-mail', 'a bad e-mail');
SELECT t_raises(format($q$SELECT builder_bu_confirm_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Rajesh Shah', NULL)$q$, :'tok'), 'valid e-mail', 'no e-mail');
SELECT t_raises(format($q$SELECT builder_bu_confirm_respond(%L, '[]', 'Rajesh Shah', 'rajesh@client.test')$q$, :'tok'), 'Nothing to record', 'no answers');
SELECT t_raises(format($q$SELECT builder_bu_confirm_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000004', 'CONFIRM')), 'Rajesh Shah', 'rajesh@client.test')$q$, :'tok'), 'not in this request', 'a unit outside the request');
SELECT t_raises(format($q$SELECT builder_bu_confirm_respond(%L, '[{"unit_id": "nope", "action": "CONFIRM"}]', 'Rajesh Shah', 'rajesh@client.test')$q$, :'tok'), 'not in this request', 'not a unit id');
SELECT t_raises(format($q$SELECT builder_bu_confirm_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'APPROVE')), 'Rajesh Shah', 'rajesh@client.test')$q$, :'tok'), 'Invalid action', 'an unknown action');
SELECT t_raises($q$SELECT builder_bu_confirm_respond(repeat('0', 48), jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Rajesh Shah', 'rajesh@client.test')$q$, 'not valid', 'a wrong token');
SELECT t_eq(t_states(:'tok'), 'A-101:PENDING,A-102:PENDING,A-103:PENDING', 'still open after the refusals');

-- Confirm all at once.
SELECT t_eq(t_results(builder_bu_confirm_respond(:'tok', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM'),
              t_answer('a1000000-0000-0000-0000-000000000002', 'confirm'),
              t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')), '  Rajesh   Shah ', ' Rajesh@Client.TEST')),
            'A-101:CONFIRMED,A-102:CONFIRMED,A-103:CONFIRMED', 'confirm all');
SELECT t_eq((SELECT count(*) FROM builder_bu_agreement_confirmations
              WHERE status = 'CONFIRMED' AND responded_by_name = 'Rajesh Shah' AND responded_by_email = 'rajesh@client.test'
                AND responded_at IS NOT NULL AND dispute_notes IS NULL)::int, 3, 'who answered, and when, on every unit');
SELECT t_eq(t_states(:'tok'), 'A-101:CONFIRMED,A-102:CONFIRMED,A-103:CONFIRMED', 'the page shows the answers');
SELECT t_eq((SELECT u ->> 'responded_by_name' || ' <' || (u ->> 'responded_by_email') || '>'
               FROM jsonb_array_elements(builder_bu_confirm_lookup(:'tok') -> 'units') u WHERE u ->> 'unit_no' = 'A-101'),
            'Rajesh Shah <rajesh@client.test>', 'and who gave them');

-- The next reader (in CC) cannot undo a confirmation.
SELECT t_eq(t_results(builder_bu_confirm_respond(:'tok', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'DISPUTE', 'I think it is 46 lakh')), 'Accounts', 'accounts@client.test')),
            'A-101:ALREADY_CONFIRMED', 'a confirmed unit stays confirmed');
SELECT t_eq((SELECT status || '/' || responded_by_email FROM builder_bu_agreement_confirmations
              WHERE unit_id = 'a1000000-0000-0000-0000-000000000001'), 'CONFIRMED/rajesh@client.test', 'the first answer kept');

-- Every unit confirmed: the period is no longer blocked.
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), false, 'not blocked');
ROLLBACK;
