-- A send records which of its units had an earlier link that reached the
-- client (20261021160000, finding of 21 Oct 2026, low: earlier_link was true
-- when any one unit had one, so a failed send said "The earlier link still
-- takes answers" of every unit). R1 asks A-101 and is sent; staff then tick
-- A-101, A-102 and A-103 and the e-mail fails.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL) AS r1 \gset
SELECT t_eq(:'r1'::jsonb -> 'earlier_units', '[]'::jsonb, 'the first request: no unit had an earlier link');
UPDATE email_outbox SET status = 'sent' WHERE id = (:'r1'::jsonb ->> 'outbox_id')::uuid;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
                    'a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@clent.test'], NULL) AS r2 \gset
UPDATE email_outbox SET status = 'failed', error = '550 5.1.1 recipient rejected' WHERE id = (:'r2'::jsonb ->> 'outbox_id')::uuid;
SELECT t_eq(:'r2'::jsonb -> 'earlier_units', '["a1000000-0000-0000-0000-000000000001"]'::jsonb, 'the send returns A-101 only');
SELECT t_eq((:'r2'::jsonb ->> 'earlier_link')::boolean, true, 'earlier_link stays (any unit had one)');
SELECT t_eq((SELECT earlier_units FROM builder_bu_confirm_requests WHERE id = (:'r2'::jsonb ->> 'request_id')::uuid),
            ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], 'and the request keeps it for BU Events');
-- What the page then shows agrees: R1's link answers for A-101; nothing
-- reached the client for A-102 and A-103.
SELECT t_eq(t_states(:'r1'::jsonb ->> 'token'), 'A-101:PENDING', 'R1 still takes answers for A-101');
ROLLBACK;

-- A per-unit e-mail of before 21 Oct 2026 counts when it went out, not when
-- it failed.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
INSERT INTO email_templates (key, name, kind, subject, body)
VALUES ('builder_bu_agreement_confirm', 'old per-unit', 'confirmation', 's', 'b') ON CONFLICT (key) DO NOTHING;
INSERT INTO email_outbox (id, client_id, to_email, kind, template_key, subject, body, status, error) VALUES
  ('0b000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'rajesh@client.test', 'confirmation',
   'builder_bu_agreement_confirm', 's', 'b', 'sent', NULL),
  ('0b000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'rajesh@clent.test', 'confirmation',
   'builder_bu_agreement_confirm', 's', 'b', 'failed', '550 5.1.1 recipient rejected');
SELECT t_old_app($f$INSERT INTO builder_bu_agreement_confirmations (bu_event_id, unit_id, client_id, agreement_value_at_request, status, sent_at, outbox_id) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 4500000, 'PENDING', now(), '0b000000-0000-0000-0000-000000000001'),
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 5200000, 'PENDING', now(), '0b000000-0000-0000-0000-000000000002')$f$);
SELECT t_legacy_snapshot() = 2;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
                    'a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@client.test'], NULL) AS r \gset
SELECT t_eq(:'r'::jsonb -> 'earlier_units', '["a1000000-0000-0000-0000-000000000001"]'::jsonb,
            'A-101''s per-unit e-mail went out; A-102''s failed; A-103 had none');
ROLLBACK;
