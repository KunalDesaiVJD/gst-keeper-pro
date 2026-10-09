-- One case per issue, a dashboard per kind, the overview filled from the case,
-- consent no longer strands work, learning chosen client by client
-- (migrations 20261011100000, 20261011110000).
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, gst_password, inactive_at_hand) VALUES
 ('10700000-0000-0000-0000-000000000001', 'Case Works', '24CASEW0000C1Z5', 'casew', 'p1', false),
 ('10700000-0000-0000-0000-000000000002', 'Teach Ltd', '24TEACH0000T1Z5', 'teach', 'p2', false);
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, case_id,
                         section_of_law, financial_year, first_seen_at) VALUES
 -- one case: DRC-01 then a hearing notice
 ('10700000-0000-0000-0000-0000000000a1', '10700000-0000-0000-0000-000000000001', 'notices', 'c1', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 60, 'ZC-1', 'AD-C1', 'Section 73', '2021-22', now() - interval '20 days'),
 ('10700000-0000-0000-0000-0000000000a2', '10700000-0000-0000-0000-000000000001', 'notices', 'c2', 'Determination Of Tax',
  'Personal hearing notice', ist_today() - 10, 'ZC-2', 'AD-C1', NULL, NULL, now() - interval '20 days'),
 -- two registration notices: one case for the client
 ('10700000-0000-0000-0000-0000000000a3', '10700000-0000-0000-0000-000000000001', 'notices', 'c3', 'Registration',
  'Notice for seeking additional information / clarification / documents relating to application for amendment (REG-03)', ist_today() - 300, 'ZR-1', NULL, NULL, NULL, now() - interval '20 days'),
 ('10700000-0000-0000-0000-0000000000a4', '10700000-0000-0000-0000-000000000001', 'notices', 'c4', 'Registration',
  'Order of approval of amendment (REG-15)', ist_today() - 2, 'ZR-2', NULL, NULL, NULL, now() - interval '2 days'),
 -- a refund case
 ('10700000-0000-0000-0000-0000000000a5', '10700000-0000-0000-0000-000000000001', 'notices', 'c5', 'Refunds',
  'Refund Sanction/Rejection Order (RFD-06)', ist_today() - 30, 'ZF-1', 'AF-C9', NULL, NULL, now() - interval '20 days');

SELECT t_eq((SELECT count(*) FROM notice_cases WHERE client_id = '10700000-0000-0000-0000-000000000001'), 3::bigint,
            'five notices, three cases: the DRC case, registration, the refund');
SELECT t_eq((SELECT track || '/' || notices FROM notice_cases WHERE case_key = 'AD-C1'), 'litigation/2', 'the DRC case is litigation, with both notices');
SELECT t_eq((SELECT track || '/' || notices || '/' || title FROM notice_cases WHERE client_id = '10700000-0000-0000-0000-000000000001' AND case_key = 'REG'),
            'registration/2/Registration', 'registration correspondence is one case per client');
SELECT t_eq((SELECT track FROM notice_cases WHERE case_key = 'AF-C9'), 'refund', 'the refund case');
SELECT t_eq(notice_track('Voluntary Payment'), 'other', 'voluntary payments are other');

-- A document the officer uploads after the first sync is new until the case is opened.
INSERT INTO gst_case_folder_items (id, client_id, case_id, portal_key, reference_number, folder_section, raw_json, first_seen_at) VALUES
 ('10700000-0000-0000-0000-0000000000f1', '10700000-0000-0000-0000-000000000001', 'AD-C1', 'f1', 'ZC-ORD', 'ORDRS', '{"refdt": "05/10/2026"}', now() - interval '1 day'),
 ('10700000-0000-0000-0000-0000000000f2', '10700000-0000-0000-0000-000000000001', 'AD-C1', 'f2', 'ZC-REP', 'REPLY', '{}', now() - interval '20 days');
SELECT t_eq((SELECT new_items || '/' || documents || '/' || latest_from FROM notice_cases WHERE case_key = 'AD-C1'), '1/2/department',
            'the order is new and from the department; the reply on the first sync is not new');
SELECT t_eq((SELECT new_items FROM notice_cases WHERE case_key = 'REG' AND client_id = '10700000-0000-0000-0000-000000000001'), 1,
            'the REG-15 captured two days ago is new');
SELECT notice_case_mark_seen('10700000-0000-0000-0000-000000000001', 'AD-C1', 'Partner');
SELECT t_eq((SELECT new_items FROM notice_cases WHERE case_key = 'AD-C1'), 0, 'opened: nothing new');
SELECT t_eq(jsonb_array_length(notice_case_items('10700000-0000-0000-0000-000000000001', 'AD-C1')), 4, 'two notices and two documents in the timeline');
SELECT t_eq(notice_case_items('10700000-0000-0000-0000-000000000001', 'AD-C1') -> 0 ->> 'from', 'department', 'newest first: the order');
SELECT t_eq((notice_cases_counts(NULL) -> 'litigation' ->> 'cases')::int >= 1, true, 'counts per dashboard');
SELECT t_eq((notice_cases_counts('{"client": "10700000-0000-0000-0000-000000000002"}') -> 'litigation') IS NULL, true, 'the master filter applies');

-- The overview: the hearing notice has no section or year of its own; the case has.
SELECT t_eq(notice_case_overview('10700000-0000-0000-0000-000000000001', 'AD-C1', '10700000-0000-0000-0000-0000000000a2') -> 'fields' -> 'section_of_law' ->> 'value',
            'Section 73', 'a blank is filled from the case''s other notice');
SELECT t_eq(notice_case_overview('10700000-0000-0000-0000-000000000001', 'AD-C1', '10700000-0000-0000-0000-0000000000a2') -> 'fields' -> 'section_of_law' ->> 'notice_id',
            '10700000-0000-0000-0000-0000000000a1', 'and says which notice');
INSERT INTO ai_documents (client_id, case_id, folder_item_id, source, source_ref, role, folder_section, label, status, title, summary, doc_date, overview)
VALUES ('10700000-0000-0000-0000-000000000001', 'AD-C1', '10700000-0000-0000-0000-0000000000f1', 'folder', 'x:f1', 'order', 'ORDRS', 'ORDER.pdf', 'done',
        'Order in DRC-07 for 2021-22', 'Demand confirmed in part.', ist_today() - 4,
        '{"din": "20261005ABCDEFGH", "officer": "Deputy Commissioner, Ward 5", "demand_total": "125000", "section_of_law": ""}');
SELECT t_eq(notice_case_overview('10700000-0000-0000-0000-000000000001', 'AD-C1', '10700000-0000-0000-0000-0000000000a2') -> 'fields' -> 'din' ->> 'source',
            'ai', 'the DIN comes from what the AI read in the order');
SELECT t_eq(notice_case_overview('10700000-0000-0000-0000-000000000001', 'AD-C1', NULL) -> 'fields' -> 'amount_of_demand' ->> 'value',
            '125000', 'the demand total too');
SELECT t_eq(jsonb_array_length(notice_case_overview('10700000-0000-0000-0000-000000000001', 'AD-C1', NULL) -> 'summaries'), 1, 'the order''s summary');

-- A refund case: the application as filed, the amounts read from its orders.
INSERT INTO gst_case_folder_items (client_id, case_id, portal_key, reference_number, folder_section, raw_json, first_seen_at) VALUES
 ('10700000-0000-0000-0000-000000000001', 'AF-C9', 'a1', 'AA2408260919920', 'APLCN',
  '{"formNo": "GST RFD-01", "applnAckNum": "AA2408260919920", "refundRsn": "EXPWP", "fromRetPrd": "042024", "toRetPrd": "032025", "ttlRfdAmt": "89266", "rfdSubDt": "26/08/2024"}', now() - interval '20 days');
INSERT INTO ai_documents (client_id, case_id, source, source_ref, role, label, status, title, doc_date, overview)
VALUES ('10700000-0000-0000-0000-000000000001', 'AF-C9', 'folder', 'x:r1', 'order', 'RFD06.pdf', 'done', 'RFD-06 order', ist_today() - 8,
        '{"refund_sanctioned": "89266", "refund_provisional": "80339.40", "refund_net_payable": "8926.60", "refund_rejected": "0"}');
SELECT t_eq((notice_case_overview('10700000-0000-0000-0000-000000000001', 'AF-C9') -> 'refund' ->> 'claimed')::numeric, 89266::numeric, 'claimed, from the application');
SELECT t_eq(notice_case_overview('10700000-0000-0000-0000-000000000001', 'AF-C9') -> 'refund' ->> 'reason', 'EXPWP', 'its reason');
SELECT t_eq((notice_case_overview('10700000-0000-0000-0000-000000000001', 'AF-C9') -> 'refund' -> 'refund_net_payable' ->> 'value')::numeric, 8926.60, 'net payable, from the order');

-- Consent recorded later re-queues work cancelled for want of it.
UPDATE ai_settings SET consent_scope = 'consented', read_enabled = true;
INSERT INTO ai_documents (id, client_id, case_id, source, source_ref, role, label, status, reason_class)
VALUES ('10700000-0000-0000-0000-0000000000d1', '10700000-0000-0000-0000-000000000002', 'AD-T1', 'folder', 'x:d1', 'notice', 'N.pdf', 'cancelled', 'no_consent');
UPDATE clients SET ai_consent_at = now() WHERE id = '10700000-0000-0000-0000-000000000002';
SELECT t_eq((SELECT status FROM ai_documents WHERE id = '10700000-0000-0000-0000-0000000000d1'), 'queued', 'consent given: queued again');
UPDATE ai_documents SET status = 'cancelled', reason_class = 'no_consent' WHERE id = '10700000-0000-0000-0000-0000000000d1';
UPDATE clients SET ai_consent_at = NULL WHERE id = '10700000-0000-0000-0000-000000000002';
UPDATE ai_settings SET consent_scope = 'all_clients';
SELECT t_eq((SELECT status FROM ai_documents WHERE id = '10700000-0000-0000-0000-0000000000d1'), 'queued', 'every client in scope: queued again');

-- Learning, client by client.
INSERT INTO ai_documents (id, client_id, case_id, source, source_ref, role, label, status, title)
VALUES ('10700000-0000-0000-0000-0000000000d2', '10700000-0000-0000-0000-000000000002', 'AD-T1', 'folder', 'x:d2', 'reply', 'REPLY.pdf', 'done', 'Reply 1');
INSERT INTO ai_learning_pairs (document_id, client_id, origin, issue_code, allegation, response, included)
VALUES ('10700000-0000-0000-0000-0000000000d2', '10700000-0000-0000-0000-000000000002', 'portal_reply', 'OTHER', 'Alleged', 'Answered', false);
SELECT t_eq((SELECT responses || '/' || responses_included || '/' || ai_learning FROM ai_learning_clients WHERE client_id = '10700000-0000-0000-0000-000000000002'),
            '1/0/false', 'the client with one response, not chosen');
SELECT t_eq((ai_learning_client_set(ARRAY['10700000-0000-0000-0000-000000000002']::uuid[], true, 'Partner') ->> 'pairs')::int, 1, 'choosing the client chooses its pairs');
SELECT t_eq((SELECT responses_included || '/' || pairs_included || '/' || ai_learning FROM ai_learning_clients WHERE client_id = '10700000-0000-0000-0000-000000000002'),
            '1/1/true', 'the client teaches');
INSERT INTO ai_documents (id, client_id, case_id, source, source_ref, role, label, status)
VALUES ('10700000-0000-0000-0000-0000000000d3', '10700000-0000-0000-0000-000000000002', 'AD-T2', 'folder', 'x:d3', 'reply', 'REPLY2.pdf', 'queued');
SELECT t_eq((SELECT learning_included FROM ai_documents WHERE id = '10700000-0000-0000-0000-0000000000d3'), true, 'a later reply of the client is chosen as it arrives');
SELECT ai_learning_client_set(ARRAY['10700000-0000-0000-0000-000000000002']::uuid[], false, 'Partner');
SELECT t_eq((SELECT count(*) FROM ai_documents WHERE client_id = '10700000-0000-0000-0000-000000000002' AND learning_included), 0::bigint, 'left out: all of them');
ROLLBACK;
