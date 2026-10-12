-- Whose work, whose move, closing for good (migration 20261013110000).
BEGIN;
INSERT INTO user_roles (user_id, role) VALUES
 ('11000000-0000-0000-0000-0000000000aa', 'gst_manager'),
 ('11000000-0000-0000-0000-0000000000bb', 'employee');
INSERT INTO clients (id, name, gstin, gst_user_id, gst_password, inactive_at_hand) VALUES
 ('11000000-0000-0000-0000-000000000001', 'Own Co', '24OWNCO0000O1Z5', 'ownco', 'p1', false);
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, case_id, due_date, first_seen_at) VALUES
 ('11000000-0000-0000-0000-0000000000a1', '11000000-0000-0000-0000-000000000001', 'notices', 'o1', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 60, 'ZO-1', 'AO-D1', ist_today() - 20, now() - interval '60 days'),
 ('11000000-0000-0000-0000-0000000000a2', '11000000-0000-0000-0000-000000000001', 'notices', 'o2', 'Refunds',
  'Refund Sanction/Rejection Order (RFD-06)', ist_today() - 10, 'ZO-2', 'AO-R1', ist_today() + 20, now() - interval '10 days'),
 ('11000000-0000-0000-0000-0000000000a3', '11000000-0000-0000-0000-000000000001', 'notices', 'o3', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 30, 'ZO-3', 'AO-D2', ist_today() - 5, now() - interval '30 days');

-- Whose move: the DRC-01 with nothing from us is with us and overdue.
SELECT t_eq((SELECT waiting_on || '/' || is_overdue FROM notice_cases WHERE case_key = 'AO-D1'), 'us/true', 'nothing filed: with us, overdue');
-- Our reply in the case folder: with the department, no longer overdue.
INSERT INTO gst_case_folder_items (id, client_id, case_id, portal_key, reference_number, folder_section, raw_json, first_seen_at) VALUES
 ('11000000-0000-0000-0000-0000000000f1', '11000000-0000-0000-0000-000000000001', 'AO-D1', 'of1', 'ZO-REP', 'REPLY', '{"refdt": "01/10/2026"}', now());
SELECT t_eq((SELECT waiting_on || '/' || is_overdue FROM notice_cases WHERE case_key = 'AO-D1'), 'department/false', 'replied: with the department, not overdue');
SELECT t_eq((notice_cases_counts(NULL) -> 'litigation' ->> 'with_dept')::int >= 1, true, 'counted with the department');

-- A kind the firm does not do for this client: refunds out.
SELECT notices_client_tracks_set(ARRAY['11000000-0000-0000-0000-000000000001']::uuid[], 'refund', false);
SELECT t_eq((SELECT count(*) FROM notice_facts WHERE client_id = '11000000-0000-0000-0000-000000000001' AND form_code = 'RFD-06'), 0::bigint, 'refunds not handled: out');
SELECT notices_client_tracks_set(ARRAY['11000000-0000-0000-0000-000000000001']::uuid[], 'refund', true);
SELECT t_eq((SELECT count(*) FROM notice_facts WHERE client_id = '11000000-0000-0000-0000-000000000001' AND form_code = 'RFD-06'), 1::bigint, 'back on: in again');

-- A case handled by another CA: only an admin, and later notices follow it.
SELECT t_eq(notice_case_exclude('11000000-0000-0000-0000-000000000001', 'AO-D2', true, 'Other CA', '11000000-0000-0000-0000-0000000000bb', 'Emp') ? 'error', true, 'an employee cannot');
SELECT t_eq((notice_case_exclude('11000000-0000-0000-0000-000000000001', 'AO-D2', true, 'Other CA', '11000000-0000-0000-0000-0000000000aa', 'Mgr') ->> 'notices')::int, 1, 'the manager can');
SELECT t_eq((SELECT count(*) FROM notice_cases WHERE case_key = 'AO-D2'), 0::bigint, 'out of the cases');
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, case_id, first_seen_at) VALUES
 ('11000000-0000-0000-0000-0000000000a4', '11000000-0000-0000-0000-000000000001', 'notices', 'o4', 'Determination Of Tax',
  'Personal hearing notice', ist_today(), 'ZO-4', 'AO-D2', now());
SELECT t_eq((SELECT excluded_reason FROM gst_notices WHERE id = '11000000-0000-0000-0000-0000000000a4'), 'Other CA', 'a later notice in it follows');
SELECT t_eq(jsonb_array_length(notice_cases_excluded()) >= 1, true, 'listed to bring back');
SELECT notice_case_exclude('11000000-0000-0000-0000-000000000001', 'AO-D2', false, NULL, '11000000-0000-0000-0000-0000000000aa', 'Mgr');
SELECT t_eq((SELECT notices FROM notice_cases WHERE case_key = 'AO-D2'), 2, 'brought back with both notices');

-- Closing for good.
SELECT t_eq(notice_case_close('11000000-0000-0000-0000-000000000001', 'AO-D1', 'Nothing to do', '11000000-0000-0000-0000-0000000000bb', 'Emp') ? 'error', true, 'an employee cannot close a case');
SELECT t_eq((notice_case_close('11000000-0000-0000-0000-000000000001', 'AO-D1', 'Nothing to do', '11000000-0000-0000-0000-0000000000aa', 'Mgr') ->> 'closed')::int, 1, 'closed');
SELECT t_eq((SELECT waiting_on FROM notice_cases WHERE case_key = 'AO-D1'), 'closed', 'and shown closed');
SELECT t_eq((SELECT close_reason FROM gst_notices WHERE id = '11000000-0000-0000-0000-0000000000a1'), 'Nothing to do', 'with the reason');
SELECT notice_case_reopen('11000000-0000-0000-0000-000000000001', 'AO-D1', '11000000-0000-0000-0000-0000000000aa', 'Mgr');
SELECT t_eq((SELECT is_open FROM notice_cases WHERE case_key = 'AO-D1'), true, 'reopened');

-- Documents read by Haiku.
SELECT t_eq((SELECT doc_model FROM ai_settings), 'claude-haiku-4-5', 'documents default to Haiku');
ROLLBACK;
