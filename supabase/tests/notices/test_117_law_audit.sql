-- The law audit of 26 Oct 2026 (20261026100000 to 20261026130000): one
-- appealable list, limitation by year, the pre-deposit per Act, holidays in
-- working days, orders never "overdue", and appeal clocks met by an appeal.
BEGIN;

-- 1. One list: every active rule with an appeal section is an appealable form, and no other.
SELECT t_eq((SELECT string_agg(f, ',' ORDER BY f) FROM unnest(notice_appealable_forms()) f),
            (SELECT string_agg(form_code, ',' ORDER BY form_code) FROM notice_form_rules WHERE appeal_section IS NOT NULL AND is_active),
            'the appealable forms are the rules with an appeal section');

-- 2. Limitation.
SELECT t_eq(notice_limitation('2019-2020', '73') ->> 's73_order_by', '2024-08-31', 'FY 2019-20, s.73: order by 31 Aug 2024 (N. 56/2023)');
SELECT t_eq(notice_limitation('2019-20', '74') ->> 's74_order_by', '2026-03-31', 'FY 2019-20, s.74: 5 years from 31 Mar 2021');
SELECT t_eq(notice_limitation('2022-23', NULL) ->> 's73_scn_by', '2026-09-30', 's.73 notice 3 months before the order date');
SELECT t_eq(notice_limitation('2024-25', '73') ->> 'regime', '74A', 'FY 2024-25 is under s.74A');
SELECT t_eq(notice_limitation('2015-16', '73'), NULL::jsonb, 'a year before GST has no limits');

-- 3. The pre-deposit per Act.
SELECT t_eq((notice_predeposit_required(
  '{"demand": {"cgst": {"tot": 200000}, "sgst": {"tot": 200000}},
    "disputed": {"cgst": {"tx": 100000, "tot": 150000}, "sgst": {"tx": 100000, "tot": 150000}},
    "paid": {"cgst": {"tot": 60000}, "sgst": {"tot": 10000}}}', 'first', '2025-06-01') -> 'short')::text, '["SGST"]',
  'first appeal: admitted amount plus 10% per head; SGST short');
SELECT t_eq((notice_predeposit_required('{"disputed": {"igst": {"tx": 1000000, "tot": 1000000}}, "paid": {"igst": {"tot": 100000}}}', 'tribunal', '2025-06-01') ->> 'pct')::numeric,
            10::numeric, 'Tribunal: 10% from 1 Nov 2024');
SELECT t_eq((notice_predeposit_required('{"disputed": {"igst": {"tx": 1000000, "tot": 1000000}}}', 'tribunal', '2024-06-01') ->> 'pct')::numeric,
            20::numeric, 'Tribunal: 20% before');
SELECT t_eq((notice_predeposit_required('{"disputed": {"cgst": {"tx": 0, "pen": 500000, "tot": 500000}}}', 'first', '2025-06-01') ->> 'required')::numeric,
            0::numeric, 'penalty-only order appealed before 1 Oct 2025: nothing');
SELECT t_eq((notice_predeposit_required('{"disputed": {"cgst": {"tx": 0, "pen": 500000, "tot": 500000}}}', 'first', '2025-10-15') ->> 'required')::numeric,
            50000::numeric, 'penalty-only order from 1 Oct 2025: 10% of the penalty');
SELECT t_eq((notice_predeposit_required('{"disputed": {"igst": {"tx": 100000, "pen": 200000, "tot": 300000}}}', 's129', '2025-06-01') ->> 'required')::numeric,
            50000::numeric, 's.129 order: 25% of the penalty');
SELECT t_eq((notice_predeposit_required('{"disputed": {"cgst": {"tx": 5000000000, "tot": 5000000000}}}', 'first', '2025-06-01') #>> '{heads,0,capped}'),
            'true', 'capped at 20 crore a head');
SELECT t_eq(notice_predeposit_required(NULL, 'first', '2025-06-01'), NULL::jsonb, 'no heads on record: no verdict');

-- 4. Holidays in working days.
SELECT t_eq(add_working_days('2025-08-14', 1), '2025-08-16'::date, 'Independence Day is skipped');
SELECT gst_holiday_set('2025-08-16', 'Firm holiday', true, 'test');
SELECT t_eq(add_working_days('2025-08-14', 1), '2025-08-18'::date, 'a holiday the firm adds is skipped, and Sunday');
SELECT gst_holiday_set('2025-08-16', 'Firm holiday', false, 'test');
SELECT t_eq(add_working_days('2025-08-14', 1), '2025-08-16'::date, 'switched off, it counts again');

-- 5. A case: a s.73 notice for FY 2019-20 issued too late, and an order with its payment date past.
INSERT INTO clients (id, name, gstin, gst_user_id, gst_password, inactive_at_hand) VALUES
 ('11700000-0000-0000-0000-000000000001', 'Law Audit Co', '24LAWAU0000L1Z5', 'lawau', 'p1', false);
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, due_date, reference_number, case_id, financial_year, section_of_law, amount_of_demand) VALUES
 ('11700000-0000-0000-0000-0000000000a1', '11700000-0000-0000-0000-000000000001', 'notices', 'l1', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', '2024-09-01', '2024-10-01', 'ZL1', 'AD-LAW-1', '2019-20', '73', 100000),
 ('11700000-0000-0000-0000-0000000000a2', '11700000-0000-0000-0000-000000000001', 'notices', 'l2', 'Determination Of Tax',
  'Summary of the order (DRC-07)', ist_today() - 120, ist_today() - 30, 'ZL2', 'AD-LAW-2', '2021-22', '73', 250000),
 ('11700000-0000-0000-0000-0000000000a3', '11700000-0000-0000-0000-000000000001', 'notices', 'l3', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 200, ist_today() - 170, 'ZL3', 'AD-LAW-2', '2021-22', '73', 200000);

SELECT t_eq((SELECT count(*) FROM jsonb_array_elements(notice_case_key_dates('11700000-0000-0000-0000-000000000001', 'AD-LAW-1')) e
              WHERE e ->> 'kind' = 'limitation' AND e ->> 'title' LIKE 'Show cause notice issued after%'), 1::bigint,
            'a notice issued after the last date is flagged as a ground');
SELECT t_eq((SELECT count(*) FROM jsonb_array_elements(notice_case_key_dates('11700000-0000-0000-0000-000000000001', 'AD-LAW-1')) e
              WHERE e ->> 'kind' = 'limitation' AND (e ->> 'time_barred')::boolean), 1::bigint,
            'and, with no order, the proceedings are time-barred');
SELECT t_eq((SELECT is_overdue::text || '/' || is_payment_overdue::text FROM notice_facts WHERE id = '11700000-0000-0000-0000-0000000000a2'),
            'false/true', 'an order is never overdue; its payment date is its own flag');
SELECT t_eq((SELECT count(*) FROM jsonb_array_elements(notice_case_key_dates('11700000-0000-0000-0000-000000000001', 'AD-LAW-2')) e
              WHERE e ->> 'kind' = 'order_check' AND e ->> 'law' = 's.75(7)'), 1::bigint,
            'the order demands more than its show cause notice');
SELECT t_eq((SELECT count(*) FROM jsonb_array_elements(notice_case_key_dates('11700000-0000-0000-0000-000000000001', 'AD-LAW-2')) e
              WHERE e ->> 'kind' = 'order_check' AND e ->> 'law' = 's.75(4)'), 1::bigint,
            'and no hearing is on record before it');

-- 6. An appeal clock is met once an appeal names the order.
SELECT notice_clocks_refresh('11700000-0000-0000-0000-0000000000a2');
SELECT t_eq((SELECT bool_or(is_met) FROM matter_deadlines WHERE notice_id = '11700000-0000-0000-0000-0000000000a2' AND deadline_type LIKE 'appeal_%'),
            false, 'no appeal yet: the clock is open');
INSERT INTO gst_portal_applications (id, client_id, case_type_cd, portal_key, arn, case_id, form_number, status, filed_date, raw_json) VALUES
 ('11700000-0000-0000-0000-0000000000d1', '11700000-0000-0000-0000-000000000001', 'APPEL', 'AD-LAW-APL', 'AD-LAW-APL', '1', 'GST APL-01',
  'Submitted', ist_today() - 60, '{"arn": "AD-LAW-APL", "appItem": {"refId": "ZL2"}}');
SELECT t_eq((SELECT bool_and(is_met) FROM matter_deadlines WHERE notice_id = '11700000-0000-0000-0000-0000000000a2' AND deadline_type LIKE 'appeal_%'),
            true, 'the appeal arrives: its clocks are met');

-- 7. Sign-off needs a GST Manager or the superadmin.
SELECT t_eq(litigation_rule_confirm('predeposit_pct.s107', 10, NULL, '11700000-0000-0000-0000-0000000000ff', 'Nobody') ? 'error', true,
            'a person with no level cannot confirm a rule');
ROLLBACK;
