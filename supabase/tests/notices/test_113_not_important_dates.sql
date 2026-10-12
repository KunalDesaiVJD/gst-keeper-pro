-- Not important and paper dates (migration 20261014120000).
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, gst_password, inactive_at_hand) VALUES
 ('11300000-0000-0000-0000-000000000001', 'Paper Co', '24PAPER0000P1Z5', 'paper', 'p', false);
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, due_date, reference_number, case_id, issued_by, first_seen_at) VALUES
 ('11300000-0000-0000-0000-0000000000a1', '11300000-0000-0000-0000-000000000001', 'notices', 'p1', 'Intimation',
  'Intimation of ITC difference, GSTR-2B vs GSTR-3B (DRC-01C)', ist_today() - 40, ist_today() - 20, 'ZP-1', 'AP-1', 'Gujarat', now()),
 ('11300000-0000-0000-0000-0000000000a2', '11300000-0000-0000-0000-000000000001', 'notices', 'p2', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 30, ist_today() - 5, 'ZP-2', 'AP-2', 'System Generated', now()),
 ('11300000-0000-0000-0000-0000000000a3', '11300000-0000-0000-0000-000000000001', 'notices', 'p3', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 30, ist_today() - 5, 'ZP-3', 'AP-3', 'STATE TAX OFFICER', now());

SELECT t_eq((SELECT system_generated::text || '/' || response_need || '/' || is_overdue::text || '/' || on_dashboard::text FROM notice_facts WHERE id = '11300000-0000-0000-0000-0000000000a1'),
            'true/none/false/false', 'a DRC-01C: not important, never overdue, off the dashboard');
SELECT t_eq((SELECT system_generated::text || '/' || is_overdue::text FROM notice_facts WHERE id = '11300000-0000-0000-0000-0000000000a2'),
            'true/false', 'a system generated notice: the same');
SELECT t_eq((SELECT system_generated::text || '/' || is_overdue::text FROM notice_facts WHERE id = '11300000-0000-0000-0000-0000000000a3'),
            'false/true', 'an officer''s notice stays important');
SELECT t_eq((SELECT track FROM notice_cases WHERE case_key = 'AP-1'), 'other', 'the DRC-01C case is under Other');
SELECT t_eq((SELECT track FROM notice_cases WHERE case_key = 'AP-3'), 'litigation', 'the officer''s case stays under notices and demands');

-- Dates: a folder document with a portal date and an AI date, one with neither.
INSERT INTO gst_case_folder_items (id, client_id, case_id, portal_key, reference_number, folder_section, raw_json, first_seen_at) VALUES
 ('11300000-0000-0000-0000-0000000000f1', '11300000-0000-0000-0000-000000000001', 'AP-3', 'pf1', 'ZP-ORD', 'ORDRS', '{"refdt": "05/10/2026"}', now()),
 ('11300000-0000-0000-0000-0000000000f2', '11300000-0000-0000-0000-000000000001', 'AP-3', 'pf2', 'ZP-REP', 'REPLY', '{}', now());
SELECT t_eq((SELECT item_date FROM notice_case_correspondence WHERE item_id = '11300000-0000-0000-0000-0000000000f1'), DATE '2026-10-05', 'the portal date when nothing better');
SELECT t_eq((SELECT item_date FROM notice_case_correspondence WHERE item_id = '11300000-0000-0000-0000-0000000000f2'), NULL::date, 'no date: undated, never the sync date');
INSERT INTO ai_documents (client_id, case_id, folder_item_id, source, source_ref, role, folder_section, label, status, doc_date)
VALUES ('11300000-0000-0000-0000-000000000001', 'AP-3', '11300000-0000-0000-0000-0000000000f1', 'folder', 'x:pf1', 'order', 'ORDRS', 'ORDER.pdf', 'done', DATE '2026-09-30');
SELECT t_eq((SELECT item_date FROM notice_case_correspondence WHERE item_id = '11300000-0000-0000-0000-0000000000f1'), DATE '2026-09-30', 'the date printed on the document comes first');
ROLLBACK;
