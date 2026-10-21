-- A unit's own token opens nothing unless a per-unit e-mail of before this
-- change carried it, and that link's addresses cannot be changed (round 4,
-- high). Every row has a token the public key can read, rows a request made
-- too, whose tokens were never e-mailed; and the per-unit path took its
-- addresses live from clients.email and email_outbox, both of which the public
-- key can write. So one write to the client master let anyone confirm every
-- unit through the rows' own tokens and open the filing gate. Now a per-unit
-- link answers only by legacy_emails, recorded once when the change is
-- applied. Every statement below runs as the public key (anon).

-- (1) p1_master_swap: a request To the owner, delivered; the attacker reads
-- A-101's own token, marks the request's e-mail failed and puts their own
-- address on the client master.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[],
              ARRAY['owner@client.test'], NULL) AS r \gset
SELECT :'r'::jsonb ->> 'token' AS tok, :'r'::jsonb ->> 'outbox_id' AS ob \gset
UPDATE email_outbox SET status = 'sent', sent_at = now() WHERE id = :'ob';
SELECT max(token) FILTER (WHERE unit_id = 'a1000000-0000-0000-0000-000000000001') AS rowtok,
       max(token) FILTER (WHERE unit_id = 'a1000000-0000-0000-0000-000000000003') AS notsent_tok
  FROM builder_bu_agreement_confirmations \gset
SELECT t_eq(builder_bu_confirm_lookup(:'rowtok'), NULL::jsonb, 'a row a request made opens no page by its own token');
SELECT t_eq(builder_bu_confirm_lookup(:'notsent_tok'), NULL::jsonb, 'nor does a NOT_SENT row');
UPDATE email_outbox SET status = 'failed' WHERE id = :'ob';
UPDATE clients SET email = 'rajesh.shah.owner@gmail.test' WHERE id = 'c1000000-0000-0000-0000-000000000001';
SELECT t_eq(builder_bu_confirm_lookup(:'rowtok'), NULL::jsonb, 'nor after the client master and the e-mail''s status are rewritten');
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'rowtok', 'rajesh.shah.owner@gmail.test'),
                'This link is not valid', 'no code goes to the address put on the master');
SELECT t_eq(builder_bu_confirm_code_verify(:'rowtok', 'rajesh.shah.owner@gmail.test', '123456', gen_random_uuid()) ->> 'message',
            'This link is not valid.', 'no code is checked on it');
SELECT t_raises(format($q$SELECT builder_bu_confirm_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')),
                                                         'Rajesh Shah', 'rajesh.shah.owner@gmail.test', 'x')$q$, :'rowtok'),
                'This link is not valid', 'and no answer is taken on it');
-- The request's own link still works for the people it went to.
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tok', 'rajesh.shah.owner@gmail.test'),
                'reached you at', 'the master''s new address is not on the request either');
SELECT t_eq(t_results(t_respond(:'tok', jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')),
                                'Owner', 'owner@client.test')), 'A-101:CONFIRMED', 'the request''s link answers for its To');
SELECT t_eq((SELECT string_agg(u.unit_no || ':' || c.status || ':' || COALESCE(c.responded_by_email, '-'), ',' ORDER BY u.unit_no)
               FROM builder_bu_agreement_confirmations c JOIN builder_units u ON u.id = c.unit_id),
            'A-101:CONFIRMED:owner@client.test,A-102:PENDING:-,A-103:NOT_SENT:-', 'only the owner''s answer is recorded');
ROLLBACK;

-- (2) p3_gate_pending: every taxable unit asked, the e-mail still queued; the
-- attacker rewrites only the client master and answers through each row's
-- own token. The filing gate stays shut.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
                    'a1000000-0000-0000-0000-000000000003']::uuid[],
              ARRAY['owner@client.test'], ARRAY['accounts@client.test']) ->> 'sent' = 'true';
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), true, 'blocked before');
UPDATE clients SET email = 'owner.client.accounts@gmail.test' WHERE id = 'c1000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE tried (unit_no text, outcome text);
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.token, c.unit_id, u.unit_no FROM builder_bu_agreement_confirmations c JOIN builder_units u ON u.id = c.unit_id LOOP
    BEGIN
      PERFORM t_respond(r.token, jsonb_build_array(t_answer(r.unit_id, 'CONFIRM')), 'Rajesh Shah', 'owner.client.accounts@gmail.test');
      INSERT INTO tried VALUES (r.unit_no, 'answered');
    EXCEPTION WHEN others THEN
      INSERT INTO tried VALUES (r.unit_no, SQLERRM);
    END;
  END LOOP;
END $$;
SELECT t_eq((SELECT string_agg(unit_no || ': ' || outcome, ' | ' ORDER BY unit_no) FROM tried),
            'A-101: This link is not valid. | A-102: This link is not valid. | A-103: This link is not valid.',
            'every row''s own token is refused');
SELECT t_eq((SELECT count(*) FROM builder_bu_agreement_confirmations WHERE status <> 'PENDING')::int, 0, 'no unit answered');
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), true,
            'the posting and filing gate stays shut');
ROLLBACK;

-- (3) p2_legacy_outbox: a per-unit e-mail of before this change, sent to
-- rajesh@client.test. The attacker adds their own address to that old
-- e-mail's To and CC and to the client master: the link still answers only
-- for rajesh.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
UPDATE clients SET email = 'rajesh@client.test' WHERE id = 'c1000000-0000-0000-0000-000000000001';
SELECT t_old_app($f$
INSERT INTO email_outbox (id, client_id, to_email, cc_email, kind, template_key, subject, body, status, sent_at)
VALUES ('0b000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Rajesh <Rajesh@client.test>',
        'site@client.test', 'builder_agreement_confirm', 'builder_bu_agreement_confirm', 's', 'b', 'sent', now());
INSERT INTO builder_bu_agreement_confirmations (bu_event_id, unit_id, client_id, agreement_value_at_request, status, outbox_id, sent_at)
VALUES ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001',
        5200000, 'PENDING', '0b000000-0000-0000-0000-000000000001', now());
-- An old row whose e-mail never went (the old app wrote the row, then failed to queue its e-mail).
INSERT INTO builder_bu_agreement_confirmations (bu_event_id, unit_id, client_id, agreement_value_at_request, status)
VALUES ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001',
        3900000, 'PENDING');
$f$);
SELECT t_eq(t_legacy_snapshot(), 1, 'one per-unit e-mail recorded');
SELECT max(token) FILTER (WHERE unit_id = 'a1000000-0000-0000-0000-000000000002') AS rowtok,
       max(token) FILTER (WHERE unit_id = 'a1000000-0000-0000-0000-000000000003') AS unsent_tok
  FROM builder_bu_agreement_confirmations \gset
SELECT t_eq((SELECT legacy_emails FROM builder_bu_agreement_confirmations WHERE token = :'rowtok'),
            ARRAY['rajesh@client.test', 'site@client.test'], 'it records its To and CC');
SELECT t_eq(builder_bu_confirm_lookup(:'unsent_tok'), NULL::jsonb, 'a row whose e-mail never went opens nothing');
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'rowtok', 'mallory@evil.test'),
                'reached you at', 'mallory is refused');
UPDATE email_outbox SET to_email = 'mallory@evil.test', cc_email = 'mallory@evil.test' WHERE id = '0b000000-0000-0000-0000-000000000001';
UPDATE clients SET email = 'mallory@evil.test' WHERE id = 'c1000000-0000-0000-0000-000000000001';
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'rowtok', 'mallory@evil.test'),
                'reached you at', 'and still refused after rewriting the old e-mail and the client master');
-- The record itself cannot be changed: no grant for the public key, and the
-- guard refuses it from anyone, the functions' own flag included.
SELECT t_raises(format($q$UPDATE builder_bu_agreement_confirmations SET legacy_emails = ARRAY['mallory@evil.test'] WHERE token = %L$q$, :'rowtok'),
                'permission denied', 'the public key cannot rewrite it');
SELECT t_raises(format('SELECT t_old_app(%L)',
                       format('UPDATE builder_bu_agreement_confirmations SET legacy_emails = legacy_emails || %L::text WHERE token = %L',
                              'mallory@evil.test', :'rowtok')),
                'never changes', 'nor can the owner with the functions'' flag');
SELECT t_raises($q$SELECT t_old_app('UPDATE builder_bu_agreement_confirmations SET legacy_emails = ARRAY[''mallory@evil.test''] WHERE legacy_emails IS NULL')$q$,
                'never changes', 'nor give another row a record');
SELECT t_raises($q$SELECT t_old_app('UPDATE builder_bu_agreement_confirmations SET legacy_outbox_id = NULL')$q$,
                'never changes', 'nor drop the e-mail it records');
SELECT t_raises($q$SELECT t_old_app('INSERT INTO builder_bu_agreement_confirmations (bu_event_id, unit_id, client_id, status, legacy_emails)
                                      VALUES (''e1000000-0000-0000-0000-000000000001'', ''a1000000-0000-0000-0000-000000000001'',
                                              ''c1000000-0000-0000-0000-000000000001'', ''PENDING'', ARRAY[''mallory@evil.test''])')$q$,
                'never changes', 'nor write a new row with one');
SELECT t_eq(has_function_privilege('anon', 'public.builder_bu_confirm_legacy_snapshot()', 'EXECUTE'), false, 'the snapshot is not callable with the public key');
SELECT t_eq(has_function_privilege('service_role', 'public.builder_bu_confirm_legacy_snapshot()', 'EXECUTE'), false, 'nor by the service role');
SELECT t_eq(t_legacy_snapshot(), 0, 'and a second run records nothing new');
-- The people the old e-mail went to still answer.
SELECT t_eq(t_results(t_respond(:'rowtok', jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000002', 'CONFIRM')),
                                'Site Engineer', 'site@client.test')), 'A-102:CONFIRMED', 'its CC answers');
SELECT t_eq((SELECT responded_by_email FROM builder_bu_agreement_confirmations WHERE token = :'rowtok'), 'site@client.test', 'as recorded');
ROLLBACK;

-- (4) A request asks about a unit after its per-unit record was made: the old
-- link keeps its addresses (not the request's), and the request's row keeps
-- the old record through every later send.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_old_app($f$
INSERT INTO email_outbox (id, client_id, to_email, kind, template_key, subject, body, status)
VALUES ('0b000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'rajesh@client.test',
        'builder_agreement_confirm', 'builder_bu_agreement_confirm', 's', 'b', 'sent');
INSERT INTO builder_bu_agreement_confirmations (bu_event_id, unit_id, client_id, agreement_value_at_request, status, outbox_id, sent_at)
VALUES ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
        4500000, 'PENDING', '0b000000-0000-0000-0000-000000000002', now());
$f$);
SELECT t_legacy_snapshot() = 1;
SELECT token AS t1 FROM builder_bu_agreement_confirmations \gset
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['accounts@client.test'], NULL) ->> 'outbox_id' AS ob1 \gset
UPDATE email_outbox SET status = 'failed' WHERE id = :'ob1';
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['priya@client.test'], NULL) ->> 'outbox_id' AS ob2 \gset
SELECT t_eq((SELECT array_to_string(legacy_emails, ',') || '/' || legacy_outbox_id::text FROM builder_bu_agreement_confirmations
               WHERE unit_id = 'a1000000-0000-0000-0000-000000000001'),
            'rajesh@client.test/0b000000-0000-0000-0000-000000000002', 'the record is the same after two sends');
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'t1', 'priya@client.test'),
                'reached you at', 'a request''s address does not answer the old link');
SELECT t_eq(t_results(t_respond(:'t1', jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')),
                                'Rajesh', 'rajesh@client.test')), 'A-101:CONFIRMED', 'the old e-mail''s address does, while the new e-mail is queued');
ROLLBACK;
