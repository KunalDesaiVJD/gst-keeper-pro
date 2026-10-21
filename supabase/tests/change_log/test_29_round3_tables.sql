-- Round 3 review: tables whose insert is the only record of a decision, the
-- BU confirmation tables of 20261021140000, and the portal's DRC-03 payments
-- and refund applications. Writes as PostgREST runs them (role anon, the
-- app's or the extension's header).
SET search_path = public, extensions;
SET ROLE anon;

-- 1. A scheme change: the Edit Client save inserts the scheme history row and
-- changes the client's registration type. Both are logged, the scheme row
-- with its effective date and notes (round 2 watched it for update and
-- delete only, so the reason filing rows were reset could not be traced).
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000003","x-gst-source":"app","x-gst-request":"t29-scheme"}');
INSERT INTO client_scheme_history (id, client_id, old_scheme, new_scheme, effective_from_date, changed_by, notes)
VALUES ('29000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Regular', 'Composition', '2026-04-01',
        '10000000-0000-0000-0000-000000000003', 'opted in from April');
UPDATE clients SET registration_type = 'Composition' WHERE id = '20000000-0000-0000-0000-000000000002';
SELECT t_eq((SELECT string_agg(table_name || ':' || op || ':' || actor_name, ',' ORDER BY id) FROM gst_change_log WHERE request_id = 't29-scheme'),
            'client_scheme_history:INSERT:Esha,clients:UPDATE:Esha', 'the scheme change and the client''s new type, by Esha');
SELECT t_eq((SELECT client_id::text || ' ' || (changed ->> 'new_scheme') || ' ' || (changed ->> 'effective_from_date') || ' ' || (changed ->> 'notes')
               FROM gst_change_log WHERE request_id = 't29-scheme' AND table_name = 'client_scheme_history'),
            '20000000-0000-0000-0000-000000000002 Composition 2026-04-01 opted in from April', 'with its client, effective date and notes');
UPDATE clients SET registration_type = 'Regular' WHERE id = '20000000-0000-0000-0000-000000000002';

-- 2. A unit's classification: its rate code and affordable flag live only in
-- this history, so its insert is logged too.
RESET ROLE;
INSERT INTO builder_projects (id, client_id, name) VALUES ('29000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000002', 'Rate Towers');
INSERT INTO builder_units (id, project_id, unit_no) VALUES ('29000000-0000-0000-0000-000000000012', '29000000-0000-0000-0000-000000000011', 'R-1');
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"t29-class"}');
INSERT INTO builder_unit_classification_history (unit_id, effective_from, is_affordable, rate_code, rate_pct, reason)
VALUES ('29000000-0000-0000-0000-000000000012', '2026-04-01', true, 'AFF_1', 1, 'carpet area under 60 sq m');
SELECT t_eq((SELECT op || ' ' || client_id::text || ' ' || (changed ->> 'rate_code') || ' ' || (changed ->> 'is_affordable') || ' ' || actor_name
               FROM gst_change_log WHERE request_id = 't29-class'),
            'INSERT 20000000-0000-0000-0000-000000000002 AFF_1 true Gita', 'the classification with its client, rate code and flag');

-- 3. BU agreement confirmations (20261021140000): who answered and on which
-- request is logged; the per-unit link's token never is.
RESET ROLE;
INSERT INTO builder_bu_events (id, project_id) VALUES ('29000000-0000-0000-0000-000000000013', '29000000-0000-0000-0000-000000000011');
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"t29-bu"}');
INSERT INTO builder_bu_confirm_requests (id, client_id, bu_event_id, to_emails, unit_ids, created_by, token)
VALUES ('29000000-0000-0000-0000-000000000014', '20000000-0000-0000-0000-000000000002', '29000000-0000-0000-0000-000000000013',
        '{owner@example.com}', '{29000000-0000-0000-0000-000000000012}', '10000000-0000-0000-0000-000000000002', 'secret-request-token-29');
INSERT INTO builder_bu_agreement_confirmations (id, bu_event_id, unit_id, client_id, agreement_value_at_request, token, status, request_id)
VALUES ('29000000-0000-0000-0000-000000000015', '29000000-0000-0000-0000-000000000013', '29000000-0000-0000-0000-000000000012',
        '20000000-0000-0000-0000-000000000002', 4500000, 'secret-unit-token-29', 'PENDING', '29000000-0000-0000-0000-000000000014');
UPDATE builder_bu_agreement_confirmations SET status = 'CONFIRMED', responded_by_name = 'Owner', responded_by_email = 'owner@example.com',
       responded_at = now(), token = 'secret-unit-token-30'
 WHERE id = '29000000-0000-0000-0000-000000000015';
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE changed::text ~ 'secret-(unit|request)-token')::int, 0,
            'no link token, of a request or of a unit, reaches the log');
SELECT t_eq((SELECT (changed -> 'status' ->> 'new') || ' ' || (changed -> 'responded_by_email' ->> 'new') || ' ' || (changed ? 'token')::text
               FROM gst_change_log WHERE request_id = 't29-bu' AND table_name = 'builder_bu_agreement_confirmations' AND op = 'UPDATE'),
            'CONFIRMED owner@example.com false', 'the answer and who gave it');
SELECT t_eq((SELECT changed ->> 'request_id' FROM gst_change_log WHERE request_id = 't29-bu'
              AND table_name = 'builder_bu_agreement_confirmations' AND op = 'INSERT'),
            '29000000-0000-0000-0000-000000000014', 'the request it was asked on');
SELECT t_eq((SELECT private_columns FROM gst_change_log_tables WHERE table_name = 'builder_bu_confirm_requests'), '{token}'::text[],
            'the request''s token is private, every other column is logged (one added later too)');
RESET ROLE;
ALTER TABLE builder_bu_confirm_requests ADD COLUMN t29_later uuid[];
SET ROLE anon;
UPDATE builder_bu_confirm_requests SET t29_later = '{29000000-0000-0000-0000-000000000012}', token = 'secret-request-token-30'
 WHERE id = '29000000-0000-0000-0000-000000000014';
SELECT t_eq((SELECT jsonb_object_keys(changed) FROM gst_change_log WHERE request_id = 't29-bu' AND table_name = 'builder_bu_confirm_requests' AND op = 'UPDATE'),
            't29_later', 'a column added after attaching is logged; the token change is not');
RESET ROLE;
ALTER TABLE builder_bu_confirm_requests DROP COLUMN t29_later;

-- 4. DRC-03 payments and refund applications as the extension's sync writes
-- them: a new one, a changed status, a soft delete; a re-pull that changes
-- nothing but when it was seen, by whom and its hash is no change.
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"extension","x-gst-request":"t29-drc"}');
INSERT INTO gst_drc03_filings (id, client_id, arn, cause_of_payment, financial_year, cash_amount, status, portal_key, portal_hash, last_seen_at, pulled_by)
VALUES ('29000000-0000-0000-0000-000000000021', '20000000-0000-0000-0000-000000000001', 'AD240925000001X', 'Annual Return', '2025-2026', 12000,
        'Filed', 'k1', 'h1', now(), '10000000-0000-0000-0000-000000000002'),
       ('29000000-0000-0000-0000-000000000022', '20000000-0000-0000-0000-000000000001', 'AD240925000002X', 'Audit', '2017-2022', 500,
        'Filed', 'k2', 'h2', now(), '10000000-0000-0000-0000-000000000002');
UPDATE gst_drc03_filings SET last_seen_at = now() + interval '1 day', pulled_at = now() + interval '1 day', portal_hash = 'h1b',
       pulled_by = '10000000-0000-0000-0000-000000000001'
 WHERE id = '29000000-0000-0000-0000-000000000021';
UPDATE gst_drc03_filings SET status = 'Cancelled', portal_hash = 'h1c' WHERE id = '29000000-0000-0000-0000-000000000021';
UPDATE gst_drc03_filings SET deleted_at = now() WHERE id = '29000000-0000-0000-0000-000000000022';
SELECT t_eq((SELECT string_agg(op || ':' || COALESCE(fy, '-') || ':' || row_label, ', ' ORDER BY id) FROM gst_change_log WHERE request_id = 't29-drc'),
            'INSERT:2025-26:AD240925000001X · Annual Return, INSERT:-:AD240925000002X · Audit, UPDATE:2025-26:AD240925000001X · Annual Return, UPDATE:-:AD240925000002X · Audit',
            'two payments, a status change and a soft delete; the re-pull logs nothing; a year of five years is no financial year');
SELECT t_eq((SELECT string_agg(k, ',' ORDER BY k) FROM gst_change_log l, jsonb_object_keys(l.changed) k
              WHERE l.request_id = 't29-drc' AND l.op = 'UPDATE'),
            'deleted_at,status', 'what changed: the status, the soft delete');
SELECT t_eq((SELECT actor_name || ':' || actor_source FROM gst_change_log WHERE request_id = 't29-drc' LIMIT 1), 'Gita:extension',
            'the extension, for the person who started the sync');
INSERT INTO gst_refund_applications (id, client_id, arn, refund_type, claimed_amount, status, documents, portal_key)
VALUES ('29000000-0000-0000-0000-000000000023', '20000000-0000-0000-0000-000000000001', 'AA2409250000099', 'Excess balance in cash ledger', 7500,
        'Filed', '[{"name": "RFD-01", "date": "2026-09-30"}]', 'r1');
UPDATE gst_refund_applications SET status = 'Sanctioned', sanctioned_amount = 7500,
       documents = '[{"name": "RFD-01", "date": "2026-09-30"}, {"name": "RFD-06", "date": "2026-10-15"}]'
 WHERE id = '29000000-0000-0000-0000-000000000023';
SELECT t_eq((SELECT (changed -> 'status' ->> 'new') || ' ' || (changed -> 'documents' -> 'changes' -> 0 ->> 'path') || '=' || (changed -> 'documents' -> 'changes' -> 0 ->> 'new')
               FROM gst_change_log WHERE request_id = 't29-drc' AND table_name = 'gst_refund_applications' AND op = 'UPDATE'),
            'Sanctioned [RFD-06].date=2026-10-15', 'a refund''s new status and the document added');
RESET ROLE;
SELECT t_request('anon', NULL);
