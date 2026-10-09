-- Linked cases, the order's clock, payments linked when certain, suggestions (20261012100000).
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, gst_password, inactive_at_hand) VALUES
 ('10800000-0000-0000-0000-000000000001', 'Link Works', '24LINKW0000L1Z5', 'linkw', 'p1', false);
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, case_id, financial_year, amount_of_demand) VALUES
 ('10800000-0000-0000-0000-0000000000a1', '10800000-0000-0000-0000-000000000001', 'notices', 'l1', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 300, 'ZD2401010000001', 'AD-ORIG', '2019-20', 1610440),
 ('10800000-0000-0000-0000-0000000000a2', '10800000-0000-0000-0000-000000000001', 'notices', 'l2', 'Determination Of Tax',
  'Summary of the order (DRC-07)', ist_today() - 200, 'ZD2401010000002', 'AD-ORIG', '2019-20', 1610440),
 ('10800000-0000-0000-0000-0000000000a3', '10800000-0000-0000-0000-000000000001', 'notices', 'l3', 'Appeal',
  'Hearing notice issued', ist_today() - 20, 'ZD2401010000003', 'AD-APPEAL', NULL, NULL);
INSERT INTO gst_case_folder_items (client_id, case_id, portal_key, reference_number, folder_section, raw_json) VALUES
 ('10800000-0000-0000-0000-000000000001', 'AD-APPEAL', 'a1', 'ZD2401010000002', 'APLCN',
  '{"apl": "APPEAL", "orddtl": {"ordnum": "ZD2401010000002", "predepositamt": {"total": {"tot": 50974}}}}');
INSERT INTO gst_drc03_filings (client_id, portal_key, arn, cause_of_payment, filed_date, cash_amount, credit_amount, financial_year) VALUES
 ('10800000-0000-0000-0000-000000000001', 'd99', 'AD2401010000099', 'Against DRC-01 Ref No.: ZD2401010000001 dated 01.01.2024', ist_today() - 250, 1000, 0, '2019-20'),
 ('10800000-0000-0000-0000-000000000001', 'd98', 'AD2401010000098', 'Payment at the time of audit', ist_today() - 240, 500, 0, '2019-20');
SELECT notices_sweep_linked('10800000-0000-0000-0000-000000000001');

SELECT t_eq((SELECT parent_key || '/' || kind FROM notice_case_links WHERE child_key = 'AD-APPEAL'), 'AD-ORIG/appeal', 'the appeal case belongs to the order''s case');
SELECT t_eq((SELECT count(*) FROM notice_cases WHERE client_id = '10800000-0000-0000-0000-000000000001'), 1::bigint, 'one case: SCN, order and appeal');
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = '10800000-0000-0000-0000-0000000000a2'), 'appeal', 'the order is in appeal');
SELECT t_eq((SELECT is_overdue FROM notice_facts WHERE id = '10800000-0000-0000-0000-0000000000a2'), false, 'an order under appeal is not overdue');
SELECT t_eq((SELECT is_open FROM notice_facts WHERE id = '10800000-0000-0000-0000-0000000000a2'), true, 'and stays open');
SELECT t_eq(notice_case_overview('10800000-0000-0000-0000-000000000001', 'AD-APPEAL', '10800000-0000-0000-0000-0000000000a3') -> 'fields' -> 'financial_year' ->> 'value',
            '2019-20', 'the hearing notice takes the year from the order');
SELECT t_eq((SELECT amount FROM notice_payments WHERE notice_id = '10800000-0000-0000-0000-0000000000a2' AND kind = 'pre_deposit'), 50974::numeric, 'the pre-deposit is recorded on the order');
SELECT t_eq((SELECT notice_id::text FROM notice_payments WHERE drc03_arn = 'AD2401010000099'), '10800000-0000-0000-0000-0000000000a1', 'the DRC-03 naming the SCN is linked to it');
SELECT t_eq((SELECT count(*) FROM notice_payments WHERE drc03_arn = 'AD2401010000098'), 0::bigint, 'one that names nothing is not');
SELECT t_eq(jsonb_array_length(notice_link_suggestions('10800000-0000-0000-0000-0000000000a2') -> 'drc03') >= 1, true, 'but it is suggested');
SELECT notices_sweep_linked('10800000-0000-0000-0000-000000000001');
SELECT t_eq((SELECT count(*) FROM notice_payments WHERE notice_id IN ('10800000-0000-0000-0000-0000000000a1', '10800000-0000-0000-0000-0000000000a2')), 2::bigint, 'running again adds nothing');
-- An appeal with no application in its folder: suggestions, then a person links it.
DELETE FROM gst_case_folder_items WHERE case_id = 'AD-APPEAL';
SELECT notice_case_links_refresh('10800000-0000-0000-0000-000000000001');
SELECT t_eq(notice_link_suggestions('10800000-0000-0000-0000-0000000000a3') -> 'cases' -> 0 ->> 'reference', 'ZD2401010000002', 'the order is suggested for the appeal');
SELECT notice_case_link_set('10800000-0000-0000-0000-000000000001', 'AD-APPEAL', 'AD-ORIG', 'appeal', 'Partner');
SELECT notice_case_links_refresh('10800000-0000-0000-0000-000000000001');
SELECT t_eq((SELECT source FROM notice_case_links WHERE child_key = 'AD-APPEAL'), 'manual', 'a person''s link survives the refresh');
ROLLBACK;
