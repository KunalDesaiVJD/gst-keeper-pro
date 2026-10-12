-- Sync scope, failing, one notice hidden, DRC-01B / 01C optional (migration 20261014110000).
BEGIN;
SELECT t_eq(sync_reason_actionable('login_failed'), true, 'a refused login is failing');
SELECT t_eq(sync_reason_actionable('captcha_timeout'), true, 'a CAPTCHA not typed is failing');
SELECT t_eq(sync_reason_actionable('agent_offline'), false, 'the scheduled Chrome offline is not');
SELECT t_eq(sync_reason_actionable('portal_error'), false, 'nor a portal hiccup');
SELECT t_eq((SELECT response_need FROM notice_type_settings WHERE form_code = 'DRC-01C'), 'optional', 'DRC-01C: reply optional');

INSERT INTO user_roles (user_id, role) VALUES ('11200000-0000-0000-0000-0000000000aa', 'superadmin');
INSERT INTO clients (id, name, gstin, gst_user_id, gst_password, inactive_at_hand) VALUES
 ('11200000-0000-0000-0000-000000000001', 'Scope Co', '24SCOPE0000S1Z5', 'scope', 'p', true);
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, case_id, first_seen_at) VALUES
 ('11200000-0000-0000-0000-0000000000a1', '11200000-0000-0000-0000-000000000001', 'notices', 's1', 'Determination Of Tax', 'Show Cause Notice (DRC-01)', ist_today() - 9, 'ZS-1', 'AS-1', now()),
 ('11200000-0000-0000-0000-0000000000a2', '11200000-0000-0000-0000-000000000001', 'notices', 's2', 'Determination Of Tax', 'Personal hearing notice', ist_today() - 2, 'ZS-2', 'AS-1', now());
SELECT t_eq((SELECT count(*) FROM sync_queue(NULL) q WHERE q.client_id = '11200000-0000-0000-0000-000000000001'), 1::bigint, 'an inactive client is in the notices sync');

SELECT notice_exclude('11200000-0000-0000-0000-0000000000a2', true, 'Duplicate', '11200000-0000-0000-0000-0000000000aa', 'SA');
SELECT t_eq((SELECT notices FROM notice_cases WHERE case_key = 'AS-1'), 1, 'one notice hidden, the case stays with the other');
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, case_id, first_seen_at) VALUES
 ('11200000-0000-0000-0000-0000000000a3', '11200000-0000-0000-0000-000000000001', 'notices', 's3', 'Determination Of Tax', 'Summary of the demand order (DRC-07)', ist_today(), 'ZS-3', 'AS-1', now());
SELECT t_eq((SELECT excluded_at IS NULL FROM gst_notices WHERE id = '11200000-0000-0000-0000-0000000000a3'), true, 'a notice hidden alone does not hide what arrives later');
SELECT t_eq((SELECT single_notices FROM jsonb_to_recordset(notice_cases_excluded()) AS x(case_key text, single_notices boolean) WHERE case_key = 'AS-1'), true, 'listed as a single notice');
ROLLBACK;
