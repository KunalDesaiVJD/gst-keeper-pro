-- Per-unit links e-mailed before this change keep working on the new page,
-- with the same checks as a request, until a newer request about their unit
-- is out. The old per-unit answer function and its lookup are closed to the
-- public key (round 2, defect: they skipped every check of the new page).
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

-- Rows as the old app wrote them (direct table writes, one token and one
-- e-mail per unit, to the client master's address as it then stood).
INSERT INTO builder_bu_agreement_confirmations (bu_event_id, unit_id, client_id, agreement_value_at_request, status, sent_at)
SELECT eu.bu_event_id, eu.unit_id, 'c1000000-0000-0000-0000-000000000001', eu.agreement_value, 'PENDING', now()
  FROM builder_bu_event_units eu
 WHERE eu.bu_event_id = 'e1000000-0000-0000-0000-000000000001' AND eu.booked_at_cutoff;
WITH mail AS (
  INSERT INTO email_outbox (client_id, to_email, kind, template_key, subject, body, status)
  SELECT 'c1000000-0000-0000-0000-000000000001', 'Rajesh@Client.test', 'builder_agreement_confirm',
         'builder_bu_agreement_confirm', 'Please confirm the agreement value', c.id::text, 'sent'
    FROM builder_bu_agreement_confirmations c
  RETURNING id, body)
UPDATE builder_bu_agreement_confirmations c SET outbox_id = mail.id FROM mail WHERE c.id::text = mail.body;
SELECT max(token) FILTER (WHERE unit_id = 'a1000000-0000-0000-0000-000000000001') AS t1,
       max(token) FILTER (WHERE unit_id = 'a1000000-0000-0000-0000-000000000002') AS t2,
       max(token) FILTER (WHERE unit_id = 'a1000000-0000-0000-0000-000000000003') AS t3
  FROM builder_bu_agreement_confirmations \gset

-- The old lookup and answer function: closed to the public key, and the
-- answer function refuses even when called with more rights.
SELECT t_eq(has_function_privilege('anon', 'public.builder_bu_agreement_confirm(text,text,text)', 'EXECUTE'), false, 'anon cannot call the old answer function');
SELECT t_eq(has_function_privilege('authenticated', 'public.builder_bu_agreement_confirm(text,text,text)', 'EXECUTE'), false, 'nor can authenticated');
SELECT t_eq(has_function_privilege('anon', 'public.builder_bu_agreement_confirmation_lookup(text)', 'EXECUTE'), false, 'nor the old lookup');
SELECT t_raises(format('SELECT builder_bu_agreement_confirm(%L, %L, NULL)', :'t1', 'CONFIRM'), 'permission denied', 'old CONFIRM with no name, no e-mail: refused');
SELECT t_raises(format('SELECT builder_bu_agreement_confirm(%L, %L, NULL)', :'t2', 'DISPUTE'), 'permission denied', 'old DISPUTE with no note: refused');
SELECT t_raises(format('SELECT builder_bu_agreement_confirmation_lookup(%L)', :'t1'), 'permission denied', 'old lookup: refused');
RESET ROLE;
SELECT t_raises(format('SELECT builder_bu_agreement_confirm(%L, %L, NULL)', :'t1', 'CONFIRM'), 'answers are now given on the confirmation page', 'the old function refuses whoever calls it');
SET LOCAL ROLE anon;
SELECT t_eq((SELECT string_agg(status, ',' ORDER BY unit_id) FROM builder_bu_agreement_confirmations), 'PENDING,PENDING,PENDING', 'nothing recorded through it');

-- The new page reads a per-unit link as a request of one unit.
SELECT t_eq(builder_bu_confirm_lookup(:'t1') ->> 'kind', 'unit', 'a per-unit link');
SELECT t_eq(t_states(:'t1'), 'A-101:PENDING', 'its one unit');
SELECT t_eq(t_results(t_respond(:'t1', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Rajesh Shah', 'rajesh@client.test')),
            'A-101:CONFIRMED', 'confirmed through the new page');
SELECT t_eq((SELECT responded_by_name || '/' || responded_by_email FROM builder_bu_agreement_confirmations WHERE token = :'t1'),
            'Rajesh Shah/rajesh@client.test', 'with who answered');
SELECT t_raises(format($q$SELECT t_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000002', 'CONFIRM')), 'Rajesh Shah', 'rajesh@client.test')$q$, :'t1'),
                'not in this request', 'a per-unit link reaches only its unit');
SELECT t_raises(format($q$SELECT t_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')), 'Someone', 'someone@client.test')$q$, :'t3'),
                'reached you at', 'only the address that e-mail went to answers a per-unit link');

-- A dispute through the new page on an untouched per-unit link needs a note too.
SELECT t_raises(format($q$SELECT t_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000002', 'DISPUTE', NULL)), 'Rajesh Shah', 'rajesh@client.test')$q$, :'t2'),
                'what has changed', 'a per-unit dispute needs a note');
SELECT t_eq(t_results(t_respond(:'t2', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000002', 'DISPUTE', 'Changed')), 'Rajesh Shah', 'rajesh@client.test')),
            'A-102:DISPUTED', 'the new page records a dispute on a per-unit link');

-- A new request for A-102 and A-103 replaces their per-unit links.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003']::uuid[],
              ARRAY['owner@client.test'], NULL) AS r \gset
SELECT :'r'::jsonb ->> 'token' AS tok \gset
SELECT t_eq((:'r'::jsonb ->> 'earlier_link')::boolean, true, 'the request knows an earlier link reached the client');
SELECT t_eq((SELECT count(*) FROM builder_bu_agreement_confirmations)::int, 3, 'the same rows, not new ones');
SELECT t_eq((SELECT token FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000003'), :'t3', 'the per-unit token is kept');
SELECT t_eq(t_states(:'t3'), 'A-103:PENDING', 'while the new e-mail waits, the old link still answers');
UPDATE email_outbox SET status = 'sent' WHERE id = (:'r'::jsonb ->> 'outbox_id')::uuid;
SELECT t_eq(t_states(:'t3'), 'A-103:REPLACED', 'once it is out, the old link shows it replaced');
SELECT t_eq(t_states(:'t2'), 'A-102:REPLACED', 'the disputed one too');
SELECT t_eq(t_results(t_respond(:'t3', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')), 'Owner', 'owner@client.test')),
            'A-103:REPLACED', 'nor does the new page through the old link');
SELECT t_eq((SELECT status FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000003'), 'PENDING', 'still open, on the new request');
SELECT t_eq(t_states(:'tok'), 'A-102:PENDING,A-103:PENDING', 'the new link asks about both');
SELECT t_eq(t_states(:'t1'), 'A-101:CONFIRMED', 'the link not re-sent still shows its answer');
ROLLBACK;
