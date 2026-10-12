-- What to do now on a case: claimed in order, kept, asked again when the case
-- changes or someone asks (migration 20261013100000).
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, gst_password, inactive_at_hand) VALUES
 ('10900000-0000-0000-0000-000000000001', 'Advice Co', '24ADVIC0000A1Z5', 'advic', 'p1', false);
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, case_id, due_date, first_seen_at) VALUES
 ('10900000-0000-0000-0000-0000000000a1', '10900000-0000-0000-0000-000000000001', 'notices', 'v1', 'Refunds',
  'Refund Sanction/Rejection Order (RFD-06)', ist_today() - 400, 'ZV-1', 'AV-R1', ist_today() - 300, now() - interval '200 days'),
 ('10900000-0000-0000-0000-0000000000a2', '10900000-0000-0000-0000-000000000001', 'notices', 'v2', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 5, 'ZV-2', 'AV-D1', ist_today() + 25, now() - interval '5 days');

UPDATE ai_settings SET read_enabled = false;
SELECT t_eq(notice_case_advice_claim('t'), NULL::jsonb, 'nothing is advised while the reader is off');
UPDATE ai_settings SET read_enabled = true;

-- The overdue case first, with what to read.
SELECT t_eq(notice_case_advice_claim('t') ->> 'case_key', 'AV-R1', 'the overdue refund case is advised first');
SELECT t_eq(notice_case_advice_context('10900000-0000-0000-0000-000000000001', 'AV-R1') -> 'case' ->> 'track', 'refund', 'the context says the kind');
SELECT t_eq(jsonb_array_length(notice_case_advice_context('10900000-0000-0000-0000-000000000001', 'AV-R1') -> 'items') >= 1, true, 'and the correspondence');
SELECT t_eq((SELECT status FROM notice_case_advice WHERE case_key = 'AV-R1'), 'running', 'claimed: running');
SELECT notice_case_advice_finish('10900000-0000-0000-0000-000000000001', 'AV-R1', 'done', '{"headline": "Close the case"}',
                                 notice_case_advice_hash('10900000-0000-0000-0000-000000000001', 'AV-R1'), 'm');
SELECT t_eq((SELECT advice ->> 'headline' FROM notice_case_advice WHERE case_key = 'AV-R1'), 'Close the case', 'the advice is kept');

-- Next claim: the other case; then nothing until something changes.
SELECT t_eq(notice_case_advice_claim('t') ->> 'case_key', 'AV-D1', 'then the DRC-01');
SELECT notice_case_advice_finish('10900000-0000-0000-0000-000000000001', 'AV-D1', 'failed', NULL, NULL, NULL, NULL, 'gateway down', 'error');
SELECT t_eq((SELECT status || '/' || error FROM notice_case_advice WHERE case_key = 'AV-D1'), 'failed/gateway down', 'a failure is recorded');
SELECT t_eq(notice_case_advice_claim('t'), NULL::jsonb, 'nothing changed and the failure is recent: nothing to advise');

-- A new document from the department changes the case: advised again.
INSERT INTO gst_case_folder_items (id, client_id, case_id, portal_key, reference_number, folder_section, raw_json, first_seen_at) VALUES
 ('10900000-0000-0000-0000-0000000000f1', '10900000-0000-0000-0000-000000000001', 'AV-R1', 'vf1', 'ZV-ORD', 'ORDRS', '{}', now());
SELECT t_eq(notice_case_advice_claim('t') ->> 'case_key', 'AV-R1', 'the refund case changed: advised again');
SELECT t_eq((SELECT advice ->> 'headline' FROM notice_case_advice WHERE case_key = 'AV-R1'), 'Close the case', 'the old advice stays on screen meanwhile');

-- Asked for by a person: first in line.
SELECT notice_case_advice_request('10900000-0000-0000-0000-000000000001', 'AV-D1', 'Partner');
SELECT t_eq((SELECT status || '/' || requested_by FROM notice_case_advice WHERE case_key = 'AV-D1'), 'queued/Partner', 'queued by the partner');
SELECT t_eq(notice_case_advice_claim('t') ->> 'case_key', 'AV-D1', 'asked for: claimed first');
ROLLBACK;
