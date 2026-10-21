-- A per-unit e-mail sent before 21 Oct 2026 keeps its own record when a
-- request later asks about its unit (round 3, low defect: the send overwrote
-- the row's outbox_id with the request's e-mail, so (a) the person the old
-- e-mail went to was refused on its still-open link once the client master
-- had changed, and (b) a later request said no e-mail had reached the client
-- although the old link still took answers).
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
UPDATE clients SET email = 'rajesh@client.test' WHERE id = 'c1000000-0000-0000-0000-000000000001';
-- As the old app wrote it: one row and one e-mail, sent to the master as it then stood.
SELECT t_old_app($f$
INSERT INTO builder_bu_agreement_confirmations (bu_event_id, unit_id, client_id, agreement_value_at_request, status, sent_at)
VALUES ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 4500000, 'PENDING', now());
WITH mail AS (INSERT INTO email_outbox (client_id, to_email, kind, template_key, subject, body, status)
  VALUES ('c1000000-0000-0000-0000-000000000001', 'rajesh@client.test', 'builder_agreement_confirm', 'builder_bu_agreement_confirm',
          'Please confirm the agreement value', 'old', 'sent') RETURNING id)
UPDATE builder_bu_agreement_confirmations SET outbox_id = (SELECT id FROM mail);
$f$);
SELECT token AS t1, outbox_id AS old_ob FROM builder_bu_agreement_confirmations \gset

-- (a) The master changes; a request for the unit goes to the new address and is still queued.
UPDATE clients SET email = 'accounts@client.test' WHERE id = 'c1000000-0000-0000-0000-000000000001';
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['accounts@client.test'], NULL) AS r \gset
SELECT t_eq((:'r'::jsonb ->> 'earlier_link')::boolean, true, 'the request knows the old e-mail reached the client');
SELECT t_eq((SELECT legacy_outbox_id::text || '/' || (outbox_id = (:'r'::jsonb ->> 'outbox_id')::uuid)::text FROM builder_bu_agreement_confirmations
               WHERE unit_id = 'a1000000-0000-0000-0000-000000000001'),
            :'old_ob' || '/true', 'the row keeps the old e-mail beside the new one');
SELECT t_eq(t_states(:'t1'), 'A-101:PENDING', 'the new e-mail waits: the old link is open');
SELECT t_eq((builder_bu_confirm_code_request(:'t1', 'rajesh@client.test') ->> 'ok')::boolean, true,
            'the person the old e-mail went to gets a code for it');
SELECT t_eq(t_results(t_respond(:'t1', jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Rajesh', 'rajesh@client.test')),
            'A-101:CONFIRMED', 'and answers it');
SELECT t_raises(format($q$SELECT builder_bu_confirm_code_request(%L, %L)$q$, :'t1', 'someone@client.test'), 'reached you at', 'a stranger still cannot');
ROLLBACK;

-- (b) The old e-mail was sent; two requests for its unit both fail. Each
-- knows a link reached the client, and the old link still answers.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
UPDATE clients SET email = 'rajesh@client.test' WHERE id = 'c1000000-0000-0000-0000-000000000001';
SELECT t_old_app($f$
INSERT INTO builder_bu_agreement_confirmations (bu_event_id, unit_id, client_id, agreement_value_at_request, status, sent_at)
VALUES ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 4500000, 'PENDING', now());
WITH mail AS (INSERT INTO email_outbox (client_id, to_email, kind, template_key, subject, body, status)
  VALUES ('c1000000-0000-0000-0000-000000000001', 'rajesh@client.test', 'builder_agreement_confirm', 'builder_bu_agreement_confirm',
          'Please confirm the agreement value', 'old', 'sent') RETURNING id)
UPDATE builder_bu_agreement_confirmations SET outbox_id = (SELECT id FROM mail);
$f$);
SELECT token AS t1, outbox_id AS old_ob FROM builder_bu_agreement_confirmations \gset
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['typo@clent.test'], NULL) AS r1 \gset
SELECT t_eq((:'r1'::jsonb ->> 'earlier_link')::boolean, true, 'R1: an earlier link reached the client');
UPDATE email_outbox SET status = 'failed' WHERE id = (:'r1'::jsonb ->> 'outbox_id')::uuid;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['typo2@clent.test'], NULL) AS r2 \gset
SELECT t_eq((:'r2'::jsonb ->> 'earlier_link')::boolean, true, 'R2 too: the per-unit e-mail did, whatever request the row is on now');
SELECT t_eq((SELECT earlier_link FROM builder_bu_confirm_requests WHERE id = (:'r2'::jsonb ->> 'request_id')::uuid), true,
            'as BU Events reads it');
SELECT t_eq((SELECT legacy_outbox_id::text FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000001'), :'old_ob', 'the old e-mail is kept through both sends');
UPDATE email_outbox SET status = 'failed' WHERE id = (:'r2'::jsonb ->> 'outbox_id')::uuid;
SELECT t_eq(t_states(:'t1'), 'A-101:PENDING', 'the old link still takes answers');
SELECT t_eq(t_results(t_respond(:'t1', jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Rajesh', 'rajesh@client.test')),
            'A-101:CONFIRMED', 'and is answered');
ROLLBACK;

-- (c) A unit never e-mailed per unit has no old e-mail, however often it is asked.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'outbox_id' AS ob1 \gset
UPDATE email_outbox SET status = 'failed' WHERE id = :'ob1';
SELECT t_eq(t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'earlier_link', 'false',
            'a failed request is no earlier link');
SELECT t_eq((SELECT count(*) FROM builder_bu_agreement_confirmations WHERE legacy_outbox_id IS NOT NULL)::int, 0, 'no old e-mail recorded');
ROLLBACK;
