-- Who, from where, and what: the actor from the header, from the row's own
-- stamp, or unknown; the source from the header or the role; INSERT keeps the
-- new row, UPDATE only the changed columns, DELETE the old row. Writes run as
-- PostgREST runs them: role anon, the request's claims and headers set.
SET search_path = public, extensions;
SET ROLE anon;

-- 1. The app's header names the actor (and wins over the row's own stamp)
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"t10-a"}');
INSERT INTO filing_status (id, client_id, return_type, period_month, status, updated_by)
VALUES ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'GSTR-3B', '09/2026', 'Prepared',
        '10000000-0000-0000-0000-000000000003');
UPDATE filing_status SET status = 'Filed', arn = 'AA240926000001', filed_date = '2026-10-20'
 WHERE id = '30000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT string_agg(op || ':' || actor_name || ':' || actor_source || ':' || actor_basis || ':' || request_id, ', ' ORDER BY id)
               FROM gst_change_log WHERE row_id = '30000000-0000-0000-0000-000000000001'),
            'INSERT:Gita:app:header:t10-a, UPDATE:Gita:app:header:t10-a', 'header actor, source and request on insert and update');
SELECT t_eq((SELECT changed FROM gst_change_log WHERE row_id = '30000000-0000-0000-0000-000000000001' AND op = 'UPDATE'),
            '{"arn": {"old": null, "new": "AA240926000001"}, "status": {"old": "Prepared", "new": "Filed"}, "filed_date": {"old": null, "new": "2026-10-20"}}'::jsonb,
            'update keeps only the changed columns, old and new');
SELECT t_eq((SELECT changed ->> 'status' FROM gst_change_log WHERE row_id = '30000000-0000-0000-0000-000000000001' AND op = 'INSERT'),
            'Prepared', 'insert keeps the new row');
SELECT t_eq((SELECT changed ? 'id' OR changed ? 'client_id' OR changed ? 'remarks' FROM gst_change_log
              WHERE row_id = '30000000-0000-0000-0000-000000000001' AND op = 'INSERT'), false,
            'the row image leaves out the key, the client (own columns) and empty fields');
SELECT t_eq((SELECT client_id::text || ' ' || period_month || ' ' || table_name FROM gst_change_log
              WHERE row_id = '30000000-0000-0000-0000-000000000001' AND op = 'INSERT'),
            '20000000-0000-0000-0000-000000000001 09/2026 filing_status', 'client, month and table recorded');
SELECT t_eq((SELECT string_agg(DISTINCT row_label, ',') FROM gst_change_log WHERE row_id = '30000000-0000-0000-0000-000000000001'),
            'GSTR-3B', 'every row of the return is named by its return type, the update too');

-- 2. No header: the row's own stamp, marked as such; a changed stamp wins
SELECT t_request('anon', NULL);
UPDATE filing_status SET remarks = 'Client called', updated_by = '10000000-0000-0000-0000-000000000001'
 WHERE id = '30000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT actor_id::text || ':' || actor_name || ':' || actor_source || ':' || actor_basis FROM gst_change_log
              WHERE row_id = '30000000-0000-0000-0000-000000000001' ORDER BY id DESC LIMIT 1),
            '10000000-0000-0000-0000-000000000001:Sam:unknown:row', 'no header: the actor from the row, source unknown');
INSERT INTO twob_import_docs (id, client_id, period_month, supplier_gstin, taxable_value, imported_by)
VALUES ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '09/2026', '24CCCCC2222C1Z7', 1000, '10000000-0000-0000-0000-000000000003');
SELECT t_eq((SELECT actor_name || ':' || actor_basis FROM gst_change_log WHERE row_id = '30000000-0000-0000-0000-000000000002' AND op = 'INSERT'),
            'Esha:row', 'insert without header: imported_by');
UPDATE twob_import_docs SET supplier_name = 'CRANE TRADERS', supplier_invoice_number = 'CT/77' WHERE id = '30000000-0000-0000-0000-000000000002';
SELECT t_eq((SELECT row_label FROM gst_change_log WHERE row_id = '30000000-0000-0000-0000-000000000002' ORDER BY id DESC LIMIT 1),
            'CRANE TRADERS · CT/77', 'a 2B document is named by supplier and invoice number');
UPDATE twob_import_docs SET posted_by = '10000000-0000-0000-0000-000000000002', posted_at = now(), updated_by = '10000000-0000-0000-0000-000000000003'
 WHERE id = '30000000-0000-0000-0000-000000000002';
UPDATE twob_import_docs SET itc_action = 'Claim', posted_by = '10000000-0000-0000-0000-000000000001'
 WHERE id = '30000000-0000-0000-0000-000000000002';
SELECT t_eq((SELECT actor_name FROM gst_change_log WHERE row_id = '30000000-0000-0000-0000-000000000002' AND op = 'UPDATE' ORDER BY id DESC LIMIT 1),
            'Sam', 'the stamp that changed (posted_by) wins over an unchanged updated_by');
-- A delete has no stamp of its own: unknown unless the header says
DELETE FROM twob_import_docs WHERE id = '30000000-0000-0000-0000-000000000002';
SELECT t_eq((SELECT COALESCE(actor_id::text, '-') || ':' || actor_basis || ':' || (changed ->> 'supplier_gstin')
               FROM gst_change_log WHERE row_id = '30000000-0000-0000-0000-000000000002' AND op = 'DELETE'),
            '-:none:24CCCCC2222C1Z7', 'delete without header: no actor, the old row kept');
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000003","x-gst-source":"app"}');
DELETE FROM filing_status WHERE id = '30000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT actor_name || ':' || actor_basis || ':' || (changed ->> 'arn') FROM gst_change_log
              WHERE row_id = '30000000-0000-0000-0000-000000000001' AND op = 'DELETE'),
            'Esha:header:AA240926000001', 'delete with header: the deleter, and the ARN that went with the row');

-- 3. Sources
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"extension"}');
INSERT INTO gst_credit_ledger_transactions (id, client_id, period_month, is_debit, igst) VALUES
 ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '09/2026', true, 500);
SELECT t_eq((SELECT actor_name || ':' || actor_source FROM gst_change_log WHERE row_id = '30000000-0000-0000-0000-000000000003'),
            'Gita:extension', 'the extension, for the app user who started the pull');
SELECT t_request('anon', '{"x-gst-source":"agent"}');
UPDATE gst_credit_ledger_transactions SET igst = 600 WHERE id = '30000000-0000-0000-0000-000000000003';
SELECT t_eq((SELECT COALESCE(actor_name, '-') || ':' || actor_source || ':' || actor_basis FROM gst_change_log
              WHERE row_id = '30000000-0000-0000-0000-000000000003' AND op = 'UPDATE'),
            '-:agent:none', 'the office agent, no person');
SELECT t_request('anon', '{"x-gst-actor":"not-a-uuid","x-gst-source":"browser"}');
UPDATE gst_credit_ledger_transactions SET igst = 700 WHERE id = '30000000-0000-0000-0000-000000000003';
SELECT t_eq((SELECT COALESCE(actor_name, '-') || ':' || actor_source FROM gst_change_log
              WHERE row_id = '30000000-0000-0000-0000-000000000003' AND op = 'UPDATE' ORDER BY id DESC LIMIT 1),
            '-:unknown', 'a malformed actor and an unknown source are not believed');
RESET ROLE;
SELECT t_request('service_role', '{}');
SET ROLE service_role;
UPDATE gst_credit_ledger_transactions SET igst = 800 WHERE id = '30000000-0000-0000-0000-000000000003';
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false), set_config('request.headers', '', false);
UPDATE gst_credit_ledger_transactions SET igst = 900 WHERE id = '30000000-0000-0000-0000-000000000003';
SELECT t_eq((SELECT string_agg(actor_source, ',' ORDER BY id) FROM (SELECT id, actor_source FROM gst_change_log
              WHERE row_id = '30000000-0000-0000-0000-000000000003' ORDER BY id DESC LIMIT 2) x),
            'system,system', 'the service key, and a direct session (migration, pg_cron), are system');

-- 4. A save that changes nothing is not a change; an upsert logs what it did
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app"}');
INSERT INTO suspended_reco (id, client_id, period_month, opening_igst, opening_source) VALUES
 ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '09/2026', 100, 'portal');
UPDATE suspended_reco SET updated_at = now() + interval '1 minute', opening_igst = 100 WHERE id = '30000000-0000-0000-0000-000000000004';
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE row_id = '30000000-0000-0000-0000-000000000004')::int, 1,
            'touching updated_at alone logs nothing');
RESET ROLE;
CREATE UNIQUE INDEX IF NOT EXISTS t_suspended_reco_one ON suspended_reco (client_id, period_month);
SET ROLE anon;
INSERT INTO suspended_reco (client_id, period_month, opening_igst, opening_source) VALUES
 ('20000000-0000-0000-0000-000000000001', '09/2026', 150, 'portal'),
 ('20000000-0000-0000-0000-000000000001', '08/2026', 90, 'portal')
ON CONFLICT (client_id, period_month) DO UPDATE SET opening_igst = EXCLUDED.opening_igst, opening_source = EXCLUDED.opening_source;
SELECT t_eq((SELECT string_agg(op || ':' || period_month, ', ' ORDER BY op) FROM gst_change_log
              WHERE table_name = 'suspended_reco' AND id > (SELECT max(id) - 2 FROM gst_change_log)),
            'INSERT:08/2026, UPDATE:09/2026', 'an upsert: the new row inserted, the existing one updated');
SELECT t_eq((SELECT changed FROM gst_change_log WHERE table_name = 'suspended_reco' AND op = 'UPDATE' ORDER BY id DESC LIMIT 1),
            '{"opening_igst": {"old": 100, "new": 150}}'::jsonb, 'the upsert update: the changed figure only');

-- 5. Months in other spellings are filed under MM/YYYY
SELECT t_eq(gst_change_log_month('Sep-26'), '09/2026', 'Mon-YY');
SELECT t_eq(gst_change_log_month('September 2026'), '09/2026', 'Month YYYY');
SELECT t_eq(gst_change_log_month('2026-09-15'), '09/2026', 'a date');
SELECT t_eq(gst_change_log_month('092026'), '09/2026', 'MMYYYY');
SELECT t_eq(gst_change_log_month('09/2026'), '09/2026', 'MM/YYYY');
SELECT t_eq(gst_change_log_month('Q2'), NULL::text, 'anything else: no month');
INSERT INTO rcm_data (id, client_id, financial_year, month, taxable_value) VALUES
 ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', '2026-27', 'Sep-26', 1000);
SELECT t_eq((SELECT period_month || ' ' || financial_year FROM gst_change_log WHERE row_id = '30000000-0000-0000-0000-000000000005'),
            '09/2026 2026-27', 'RCM: month from Mon-YY, the financial year kept');

-- 6. Client masters: the GST fields only; passwords never reach the log
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000001","x-gst-source":"app"}');
UPDATE clients SET gst_password = 'Portal-Secret-9', gst_password_changed_at = '2026-10-21T10:00:00+05:30',
                   client_password = 'Client-Secret-9', mobile = '9999999999'
 WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT jsonb_object_keys(changed) FROM gst_change_log WHERE table_name = 'clients' ORDER BY id DESC LIMIT 1),
            'gst_password_changed_at', 'a portal password change shows as its date, never the password');
UPDATE clients SET liberal_2b_reconciliation = true WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT changed -> 'liberal_2b_reconciliation' FROM gst_change_log WHERE table_name = 'clients' ORDER BY id DESC LIMIT 1),
            '{"old": false, "new": true}'::jsonb, 'the Liberal switch is logged on the client too (round 2: it outlives the client)');
UPDATE clients SET name = 'SUNRISE TRADERS LLP', gstin = '24AAAAA0000A2Z4' WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT changed -> 'name' ->> 'new' FROM gst_change_log WHERE table_name = 'clients' ORDER BY id DESC LIMIT 1),
            'SUNRISE TRADERS LLP', 'a GST field change is logged');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE changed::text ~ '(Portal|Client)-Secret')::int, 0, 'no password anywhere in the log');
