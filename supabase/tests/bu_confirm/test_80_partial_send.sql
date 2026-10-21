-- A unit left unticked (round 1, defect: the filing gate opened while a
-- taxable unit was never asked or accepted). Every send writes a row for each
-- taxable unit of the event: NOT_SENT for those not asked, which the gate
-- (unchanged) counts as outstanding, and which takes no answer.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[],
              ARRAY['owner@client.test'], NULL) ->> 'token' AS tok \gset
SELECT t_eq((SELECT string_agg(u.unit_no || ':' || c.status || ':' || COALESCE((c.request_id IS NOT NULL)::text, '-'), ',' ORDER BY u.unit_no)
               FROM builder_bu_agreement_confirmations c JOIN builder_units u ON u.id = c.unit_id),
            'A-101:PENDING:true,A-102:PENDING:true,A-103:NOT_SENT:false', 'the unticked taxable unit gets a NOT_SENT row; the unbooked one none');
SELECT t_eq((SELECT agreement_value_at_request FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000003'),
            3900000::numeric, 'at the working''s value');
SELECT t_eq(t_states(:'tok'), 'A-101:PENDING,A-102:PENDING', 'the link asks only about the ticked units');

-- Both asked units confirmed: the period is still blocked by the one not asked.
SELECT t_eq(t_results(t_respond(:'tok', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM'),
              t_answer('a1000000-0000-0000-0000-000000000002', 'CONFIRM')), 'Owner', 'owner@client.test')),
            'A-101:CONFIRMED,A-102:CONFIRMED', 'both answered');
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), true,
            'partial send, all answered: the gate stays shut');

-- A NOT_SENT row's own token was never e-mailed: it opens nothing and answers nothing.
SELECT token AS t3 FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000003' \gset
SELECT t_eq(builder_bu_confirm_lookup(:'t3'), NULL::jsonb, 'a NOT_SENT token shows nothing');
SELECT t_raises(format($q$SELECT t_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')), 'Owner', 'owner@client.test')$q$, :'t3'),
                'not valid', 'a NOT_SENT token answers nothing');
SELECT t_raises(format('SELECT builder_bu_agreement_confirm(%L, %L, NULL)', :'t3', 'CONFIRM'), 'permission denied', 'nor through the old function (closed)');
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'t3', 'owner@client.test'), 'not valid', 'nor can a code be asked for on it');
SELECT t_raises(format($q$SELECT t_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')), 'Owner', 'owner@client.test')$q$, :'tok'),
                'not in this request', 'nor through the request link');

-- A second send for the unit left out: the same row moves to PENDING; no new rows.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'token' AS tok2 \gset
SELECT t_eq((SELECT count(*) FROM builder_bu_agreement_confirmations)::int, 3, 'one row per taxable unit, still');
SELECT t_eq((SELECT status FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000003'), 'PENDING', 'asked now');
SELECT t_eq(t_states(:'tok'), 'A-101:CONFIRMED,A-102:CONFIRMED', 'the first link is untouched');
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), true, 'still shut while it waits');
SELECT t_eq(t_results(t_respond(:'tok2', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')), 'Owner', 'owner@client.test')), 'A-103:CONFIRMED', 'answered');
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), false, 'every taxable unit cleared: open');
ROLLBACK;

-- A NOT_SENT unit may instead be accepted by the firm, which clears it.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[],
              ARRAY['owner@client.test'], NULL) ->> 'token' AS tok \gset
SELECT t_eq(builder_bu_agreement_override('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003',
                                          '10000000-0000-0000-0000-000000000002', 'Confirmed on the phone by the director'),
            'OVERRIDDEN', 'the GST Manager accepts the unit not asked');
SELECT t_eq(t_results(t_respond(:'tok', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM'),
              t_answer('a1000000-0000-0000-0000-000000000002', 'CONFIRM')), 'Owner', 'owner@client.test')),
            'A-101:CONFIRMED,A-102:CONFIRMED', 'the others answered');
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), false, 'open');
-- And the gate gives the same answer for the same statuses with NOT_SENT in play.
UPDATE builder_bu_agreement_confirmations SET status = 'NOT_SENT' WHERE unit_id = 'a1000000-0000-0000-0000-000000000003';
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), true, 'NOT_SENT blocks like PENDING');
ROLLBACK;
