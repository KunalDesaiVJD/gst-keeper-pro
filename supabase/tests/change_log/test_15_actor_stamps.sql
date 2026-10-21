-- A write with no person in its header is never pinned on whoever last
-- stamped the row. On UPDATE the actor comes from the header, or from a stamp
-- column this statement changed, or no one (actor_basis 'none'). Round 1
-- review: an extension pull, an old extension and a service-role remark were
-- logged as the previous editor.
SET search_path = public, extensions;
CREATE UNIQUE INDEX IF NOT EXISTS t_filing_status_one ON filing_status (client_id, return_type, period_month);
CREATE UNIQUE INDEX IF NOT EXISTS t_suspended_reco_one ON suspended_reco (client_id, period_month);
SET ROLE anon;

-- (a) Esha saves the Suspended Reco; a scheduled pull of extension 0.17.0
-- (source only, no person) then changes the opening figures.
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000003","x-gst-source":"app"}');
INSERT INTO suspended_reco (id, client_id, period_month, opening_igst, opening_source, updated_by) VALUES
 ('31000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '07/2026', 0, 'manual', '10000000-0000-0000-0000-000000000003');
SELECT t_request('anon', '{"x-gst-source":"extension"}');
UPDATE suspended_reco SET opening_igst = 12345, opening_source = 'portal', opening_portal_pulled_at = now()
 WHERE id = '31000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT COALESCE(actor_id::text, '-') || ':' || COALESCE(actor_name, '-') || ':' || actor_source || ':' || actor_basis
               FROM gst_change_log WHERE row_id = '31000000-0000-0000-0000-000000000001' AND op = 'UPDATE'),
            '-:-:extension:none', 'an extension pull without a person is not put on the last editor (Esha)');

-- (b) Gita marks GSTR-3B Prepared; an old extension (no headers) then upserts
-- it as Filed with an ARN, a date and a PDF; the service key adds a remark.
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app"}');
INSERT INTO filing_status (id, client_id, return_type, period_month, status, updated_by) VALUES
 ('31000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'GSTR-3B', '07/2026', 'Prepared', '10000000-0000-0000-0000-000000000002');
-- Extension 0.17.0's Filing Status pull (markFiled, no updated_by) on a scheduled run: source, no person.
SELECT t_request('anon', '{"x-gst-source":"extension"}');
INSERT INTO filing_status (client_id, return_type, period_month, status, arn, filed_date)
VALUES ('20000000-0000-0000-0000-000000000002', 'GSTR-3B', '07/2026', 'Filed', 'AA240926000099', '2026-10-20')
ON CONFLICT (client_id, return_type, period_month) DO UPDATE
   SET status = EXCLUDED.status, arn = EXCLUDED.arn, filed_date = EXCLUDED.filed_date;
SELECT t_eq((SELECT COALESCE(actor_id::text, '-') || ':' || actor_source || ':' || actor_basis || ':' || (changed -> 'status' ->> 'new')
               FROM gst_change_log WHERE row_id = '31000000-0000-0000-0000-000000000002' AND op = 'UPDATE' ORDER BY id DESC LIMIT 1),
            '-:extension:none:Filed', 'extension 0.17.0''s Filed upsert without a person is not put on Gita');
-- An extension older than 0.17.0 (no headers at all) attaches the PDF.
SELECT t_request('anon', NULL);
INSERT INTO filing_status (client_id, return_type, period_month, status, arn, filed_date, return_pdf_url)
VALUES ('20000000-0000-0000-0000-000000000002', 'GSTR-3B', '07/2026', 'Filed', 'AA240926000099', '2026-10-20', 'c2/3b-072026.pdf')
ON CONFLICT (client_id, return_type, period_month) DO UPDATE
   SET status = EXCLUDED.status, arn = EXCLUDED.arn, filed_date = EXCLUDED.filed_date, return_pdf_url = EXCLUDED.return_pdf_url;
SELECT t_eq((SELECT COALESCE(actor_id::text, '-') || ':' || actor_source || ':' || actor_basis || ':' || (changed ->> 'return_pdf_url' IS NOT NULL)::text
               FROM gst_change_log WHERE row_id = '31000000-0000-0000-0000-000000000002' AND op = 'UPDATE' ORDER BY id DESC LIMIT 1),
            '-:unknown:none:true', 'an old extension''s PDF upsert is not put on Gita');
RESET ROLE;
SELECT t_request('service_role', '{}');
SET ROLE service_role;
UPDATE filing_status SET remarks = 'Filed on the portal' WHERE id = '31000000-0000-0000-0000-000000000002';
RESET ROLE;
SELECT t_eq((SELECT COALESCE(actor_id::text, '-') || ':' || actor_source || ':' || actor_basis
               FROM gst_change_log WHERE row_id = '31000000-0000-0000-0000-000000000002' AND op = 'UPDATE' ORDER BY id DESC LIMIT 1),
            '-:system:none', 'a service-key remark is the system, not Gita');

-- (c) Sam overrides the opening IGST; the extension's ledger pull (no *_by
-- set) and then an extension older than 0.17.0 change it.
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000001","x-gst-source":"app"}');
UPDATE suspended_reco SET opening_igst = 5000, opening_source = 'manual', opening_override_by = '10000000-0000-0000-0000-000000000001',
       opening_override_at = now(), opening_override_justification = 'Per the client''s books'
 WHERE id = '31000000-0000-0000-0000-000000000001';
SELECT t_request('anon', '{"x-gst-source":"extension"}');
UPDATE suspended_reco SET opening_igst = 4200 WHERE id = '31000000-0000-0000-0000-000000000001';
SELECT t_request('anon', NULL);
UPDATE suspended_reco SET opening_igst = 4300 WHERE id = '31000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT string_agg(COALESCE(actor_name, '-') || '/' || actor_source || '/' || actor_basis, ', ' ORDER BY id)
               FROM gst_change_log WHERE row_id = '31000000-0000-0000-0000-000000000001' AND op = 'UPDATE'
                AND changed ? 'opening_igst' AND (changed -> 'opening_igst' ->> 'new')::numeric IN (5000, 4200, 4300)),
            'Sam/app/header, -/extension/none, -/unknown/none', 'the override is Sam''s; the two pulls after it name no one');

-- A stamp the statement changed still names the person (no header).
UPDATE suspended_reco SET opening_igst = 4400, opening_portal_pulled_by = '10000000-0000-0000-0000-000000000002'
 WHERE id = '31000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT actor_name || ':' || actor_basis FROM gst_change_log WHERE row_id = '31000000-0000-0000-0000-000000000001' ORDER BY id DESC LIMIT 1),
            'Gita:row', 'a stamp written by this change names its person');
-- The same stamp written again (unchanged) is not proof: no one.
UPDATE suspended_reco SET opening_igst = 4500, opening_portal_pulled_by = '10000000-0000-0000-0000-000000000002'
 WHERE id = '31000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT COALESCE(actor_name, '-') || ':' || actor_basis FROM gst_change_log WHERE row_id = '31000000-0000-0000-0000-000000000001' ORDER BY id DESC LIMIT 1),
            '-:none', 'an unchanged stamp names no one');
RESET ROLE;

-- The person filter of the Change history page (actor_id) files none of these under Esha or Gita.
SELECT t_eq((SELECT count(*) FROM gst_change_history WHERE op = 'UPDATE' AND row_id = '31000000-0000-0000-0000-000000000001'
              AND actor_id = '10000000-0000-0000-0000-000000000003')::int, 0, 'no Suspended Reco change filed under Esha');
SELECT t_eq((SELECT count(*) FROM gst_change_history WHERE op = 'UPDATE' AND row_id = '31000000-0000-0000-0000-000000000002'
              AND actor_id = '10000000-0000-0000-0000-000000000002')::int, 0, 'the Filed upsert and the remark not filed under Gita');
