-- Nobody writes the record around the functions (round 3: a high and a
-- medium defect). With the public key, which the public page's own bundle
-- carries, anyone could add their own address to a request's To or CC and
-- then prove it with a code to their own mailbox, point a request at another
-- client's units, or write CONFIRMED and a responder straight into a unit's
-- row; the posting and filing gate then opened and BU Events showed
-- "Confirmed by" someone who never answered. The RLS policies stay open to
-- public (CLAUDE.md); the public key may only read these tables, and a
-- trigger refuses every write the send, the page's answer or the firm's
-- Accept did not make, from any role.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

-- A second client with its own BU event (Other Towers, T-1).
INSERT INTO clients (id, name, gstin, email) VALUES
  ('c2000000-0000-0000-0000-000000000002', 'Other Towers LLP', '24BBBBB0000B1Z5', 'owner@other.test');
INSERT INTO builder_projects (id, client_id, name) VALUES
  ('b2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000002', 'Other Towers');
INSERT INTO builder_units (id, project_id, unit_no, sort_order) VALUES
  ('a2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000002', 'T-1', 1);
INSERT INTO builder_bu_events (id, project_id, bu_date, posting_period, status) VALUES
  ('e2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000002', '2026-09-20', '10/2026', 'PREPARED');
INSERT INTO builder_bu_event_units (bu_event_id, unit_id, cut_off_date, booked_at_cutoff, agreement_value) VALUES
  ('e2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', '2026-09-20', true, 8000000);

-- The repro: To the owner, CC the firm's mailbox.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[],
              ARRAY['owner@client.test'], ARRAY['gst@vjdesai.com']) AS r \gset
SELECT :'r'::jsonb ->> 'token' AS tok, :'r'::jsonb ->> 'request_id' AS req, :'r'::jsonb ->> 'outbox_id' AS ob \gset
SELECT t_send(ARRAY['a2000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@other.test'], NULL,
              p_event => 'e2000000-0000-0000-0000-000000000002') AS r2 \gset
SELECT :'r2'::jsonb ->> 'request_id' AS req2 \gset

-- The public key reads these tables and writes none of them.
SELECT t_eq(has_table_privilege(r, 'public.' || t, 'SELECT'), true, r || ' reads ' || t)
  FROM unnest(ARRAY['anon', 'authenticated']) r,
       unnest(ARRAY['builder_bu_confirm_requests', 'builder_bu_agreement_confirmations', 'builder_bu_confirm_answer_history']) t;
SELECT t_eq(has_table_privilege(r, 'public.' || t, p), false, r || ' has no ' || p || ' on ' || t)
  FROM unnest(ARRAY['anon', 'authenticated']) r,
       unnest(ARRAY['builder_bu_confirm_requests', 'builder_bu_agreement_confirmations', 'builder_bu_confirm_answer_history']) t,
       unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p;
SELECT t_eq((SELECT count(*) FROM pg_policies WHERE tablename IN ('builder_bu_confirm_requests', 'builder_bu_agreement_confirmations',
                                                               'builder_bu_confirm_answer_history')
                AND 'public' = ANY (roles) AND qual = 'true')::int, 3, 'the policies stay open to public');

-- (1) An address added to the request (pa_bypass, and "mallory" in round 3).
SELECT t_raises(format($q$UPDATE builder_bu_confirm_requests SET cc_emails = array_append(cc_emails, 'owner.shah.personal@gmail.test') WHERE token = %L$q$, :'tok'),
                'permission denied', 'no address can be added to the CC');
SELECT t_raises(format($q$UPDATE builder_bu_confirm_requests SET to_emails = to_emails || ARRAY['mallory@evil.test'] WHERE token = %L$q$, :'tok'),
                'permission denied', 'nor to the To');
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tok', 'mallory@evil.test'), 'reached you at',
                'so no code goes to an address the e-mail did not go to');
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tok', 'owner.shah.personal@gmail.test'), 'reached you at', 'nor to the other one');
-- (2) A request pointed at another client's units (pe_cross).
SELECT t_raises(format($q$UPDATE builder_bu_confirm_requests SET bu_event_id = 'e2000000-0000-0000-0000-000000000002',
                                 unit_ids = ARRAY['a2000000-0000-0000-0000-000000000001']::uuid[] WHERE id = %L$q$, :'req'),
                'permission denied', 'a request cannot be pointed at another client''s units');
SELECT t_raises(format($q$UPDATE builder_bu_confirm_requests SET unit_ids = unit_ids || 'a1000000-0000-0000-0000-000000000003'::uuid WHERE id = %L$q$, :'req'),
                'permission denied', 'nor given another unit');
SELECT t_raises(format($q$UPDATE builder_bu_confirm_requests SET token = 'x' || token WHERE id = %L$q$, :'req'), 'permission denied', 'nor a new token');
SELECT t_eq(t_states(:'tok'), 'A-101:PENDING,A-102:PENDING', 'the link reaches its own units only');
SELECT t_raises($q$INSERT INTO builder_bu_confirm_requests (bu_event_id, client_id, to_emails, unit_ids)
                   VALUES ('e2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000002',
                           ARRAY['mallory@evil.test'], ARRAY['a2000000-0000-0000-0000-000000000001']::uuid[])$q$,
                'permission denied', 'no request is made outside the send');
SELECT t_raises(format('DELETE FROM builder_bu_confirm_requests WHERE id = %L', :'req2'), 'permission denied', 'nor deleted');

-- (3) The gate's record: no confirmation, acceptance or responder written straight in.
SELECT t_raises($q$UPDATE builder_bu_agreement_confirmations SET status = 'CONFIRMED', responded_by_name = 'Rajesh Shah',
                          responded_by_email = 'owner@client.test', responded_at = now()
                    WHERE unit_id = 'a1000000-0000-0000-0000-000000000002'$q$,
                'permission denied', 'no confirmation written straight into a unit''s row');
SELECT t_raises($q$UPDATE builder_bu_agreement_confirmations SET status = 'OVERRIDDEN', override_reason = 'ok'
                    WHERE unit_id = 'a1000000-0000-0000-0000-000000000003'$q$, 'permission denied', 'nor an acceptance');
SELECT t_raises($q$UPDATE builder_bu_agreement_confirmations SET dispute_notes = NULL, status = 'PENDING'
                    WHERE unit_id = 'a1000000-0000-0000-0000-000000000001'$q$, 'permission denied', 'nor a status put back');
SELECT t_raises(format($q$UPDATE builder_bu_agreement_confirmations SET request_id = %L WHERE unit_id = 'a1000000-0000-0000-0000-000000000003'$q$, :'req'),
                'permission denied', 'nor a unit moved onto a request');
SELECT t_raises($q$UPDATE builder_bu_agreement_confirmations SET agreement_value_at_request = 1 WHERE unit_id = 'a1000000-0000-0000-0000-000000000001'$q$,
                'permission denied', 'nor the value asked about');
SELECT t_raises($q$UPDATE builder_bu_agreement_confirmations SET outbox_id = NULL, token = 'abc' WHERE unit_id = 'a1000000-0000-0000-0000-000000000001'$q$,
                'permission denied', 'nor the token or the e-mail');
SELECT t_raises($q$INSERT INTO builder_bu_agreement_confirmations (bu_event_id, unit_id, client_id, agreement_value_at_request, status)
                   VALUES ('e2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000004',
                           'c1000000-0000-0000-0000-000000000001', 1, 'CONFIRMED')$q$,
                'permission denied', 'no row made outside the functions');
SELECT t_raises($q$DELETE FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000003'$q$,
                'permission denied', 'nor the NOT_SENT row that holds the gate deleted');
-- The history.
SELECT t_raises($q$INSERT INTO builder_bu_confirm_answer_history (bu_event_id, unit_id, status)
                   VALUES ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'DISPUTED')$q$,
                'permission denied', 'no history made up');
SELECT t_raises('UPDATE builder_bu_confirm_answer_history SET dispute_notes = NULL', 'permission denied', 'nor changed');
SELECT t_raises('DELETE FROM builder_bu_confirm_answer_history', 'permission denied', 'nor deleted');

SELECT t_eq((SELECT string_agg(u.unit_no || ':' || c.status || ':' || COALESCE(c.responded_by_email, '-'), ',' ORDER BY u.unit_no)
               FROM builder_bu_agreement_confirmations c JOIN builder_units u ON u.id = c.unit_id),
            'A-101:PENDING:-,A-102:PENDING:-,A-103:NOT_SENT:-,T-1:PENDING:-', 'nothing changed');
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), true, 'the gate stays shut');
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c2000000-0000-0000-0000-000000000002', '10/2026'), true, 'for the other client too');

-- Not only the public key: the service role and the owner (the SQL editor,
-- the management API) are refused by the trigger.
SET LOCAL ROLE service_role;
SELECT t_raises($q$UPDATE builder_bu_agreement_confirmations SET status = 'CONFIRMED' WHERE unit_id = 'a1000000-0000-0000-0000-000000000002'$q$,
                'change only through the confirmation page', 'the service role cannot confirm a unit');
SELECT t_raises(format($q$UPDATE builder_bu_confirm_requests SET cc_emails = ARRAY['x@evil.test'] WHERE id = %L$q$, :'req'),
                'change only through the confirmation page', 'nor add an address');
SELECT t_raises($q$INSERT INTO builder_bu_confirm_answer_history (bu_event_id, unit_id, status)
                   VALUES ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'DISPUTED')$q$,
                'change only through the confirmation page', 'nor make up history');
RESET ROLE;
SELECT t_raises($q$DELETE FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000003'$q$,
                'change only through the confirmation page', 'the owner cannot delete a row either');
SELECT t_raises($q$UPDATE builder_bu_agreement_confirmations SET responded_by_name = 'Rajesh Shah' WHERE unit_id = 'a1000000-0000-0000-0000-000000000001'$q$,
                'change only through the confirmation page', 'nor write a responder');
SET LOCAL ROLE anon;

-- The functions still write, and leave the flag off behind them.
SELECT t_eq(t_results(t_respond(:'tok', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM'),
              t_answer('a1000000-0000-0000-0000-000000000002', 'DISPUTE', 'Now 54 lakh')), 'Rajesh Shah', 'owner@client.test')),
            'A-101:CONFIRMED,A-102:DISPUTED', 'the page records answers');
SELECT t_eq(COALESCE(current_setting('app.bu_confirm_write', true), 'off'), 'off', 'the flag is off after an answer');
SELECT t_raises($q$UPDATE builder_bu_agreement_confirmations SET status = 'CONFIRMED' WHERE unit_id = 'a1000000-0000-0000-0000-000000000002'$q$,
                'permission denied', 'a direct write after it is still refused');
SELECT t_eq(builder_bu_agreement_override('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003',
                                          '10000000-0000-0000-0000-000000000002', 'Confirmed on the phone by the director'),
            'OVERRIDDEN', 'the firm''s Accept writes');
SELECT t_eq(COALESCE(current_setting('app.bu_confirm_write', true), 'off'), 'off', 'the flag is off after an acceptance');
SELECT t_eq((t_send(ARRAY['a1000000-0000-0000-0000-000000000002']::uuid[], ARRAY['owner@client.test'], NULL,
                    p_seen => t_seen(ARRAY['a1000000-0000-0000-0000-000000000002']::uuid[])) ->> 'sent')::boolean,
            true, 'a send writes (the dispute asked about again)');
SELECT t_eq(COALESCE(current_setting('app.bu_confirm_write', true), 'off'), 'off', 'the flag is off after a send');
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_answer_history)::int, 1, 'the dispute went to the history');
SELECT t_eq(t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'sent', 'false',
            'a send that finds a unit answered writes nothing');
SELECT t_eq(COALESCE(current_setting('app.bu_confirm_write', true), 'off'), 'off', 'and leaves the flag off');
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), true, 'the gate: A-102 asked again');

-- Deleting an e-mail clears the link to it; deleting a BU event takes its
-- rows with it (the trigger lets foreign keys do their work).
DELETE FROM email_outbox WHERE id = :'ob';
SELECT t_eq((SELECT outbox_id IS NULL FROM builder_bu_confirm_requests WHERE id = :'req'), true, 'the request''s e-mail link is cleared');
SELECT t_eq((SELECT count(*) FROM builder_bu_agreement_confirmations WHERE outbox_id = :'ob')::int, 0, 'and the units''');
DELETE FROM builder_bu_events WHERE id = 'e2000000-0000-0000-0000-000000000002';
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_requests WHERE bu_event_id = 'e2000000-0000-0000-0000-000000000002')::int
          + (SELECT count(*) FROM builder_bu_agreement_confirmations WHERE bu_event_id = 'e2000000-0000-0000-0000-000000000002')::int,
            0, 'a deleted BU event takes its request and rows');
DELETE FROM builder_units WHERE id = 'a1000000-0000-0000-0000-000000000002';
SELECT t_eq((SELECT count(*) FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000002')::int
          + (SELECT count(*) FROM builder_bu_confirm_answer_history WHERE unit_id = 'a1000000-0000-0000-0000-000000000002')::int,
            0, 'a deleted unit takes its row and history');
ROLLBACK;
