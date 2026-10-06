-- Classifier and short clocks (migration 20261006110000, view in 20261006111000).
BEGIN;
INSERT INTO clients (id, name, gstin) VALUES ('11111111-0000-0000-0000-000000000001', 'Alpha Traders', '24AAAAA0000A1Z5');
UPDATE notice_settings SET computed_clock_from = ist_today() - 60;

INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, priority, case_id) VALUES
 ('a0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'notices', 'k1', 'Notice', 'Intimation of difference in liability reported in GSTR-1 and GSTR-3B (DRC-01B)', ist_today() - 2, NULL, NULL),
 ('a0000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'notices', 'k2', 'Notice', 'ITC mismatch between GSTR-2B and GSTR-3B', ist_today() - 2, NULL, NULL),
 ('a0000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'notices', 'k3', 'Notice', 'Notice to return defaulter u/s 46 for not filing return', ist_today() - 20, NULL, NULL),
 ('a0000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'notices', 'k4', 'Notice', 'Show Cause Notice for cancellation of registration', ist_today() - 1, NULL, NULL),
 ('a0000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', 'notices', 'k5', 'Determination Of Tax', 'Case created', ist_today() - 90, NULL, 'AD240000001'),
 ('a0000000-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', 'notices', 'k6', 'Letter Of Undertaking', 'LUT application', ist_today() - 5, NULL, 'AD240000002'),
 ('a0000000-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001', 'notices', 'k7', 'Voluntary Payment', 'Payment intimation', ist_today() - 5, NULL, 'AD240000003'),
 ('a0000000-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001', 'notices', 'k8', 'Order', 'Order passed for something', ist_today() - 5, NULL, NULL),
 ('a0000000-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', 'notices', 'k9', 'Notice', 'Intimation of difference in liability (DRC-01B)', ist_today() - 2, 'Low', NULL),
 ('a0000000-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', 'notices', 'k10', 'Notice', 'Intimation of difference in liability (DRC-01B)', ist_today() - 400, NULL, NULL),
 ('a0000000-0000-0000-0000-00000000000b', '11111111-0000-0000-0000-000000000001', 'notices', 'k11', 'Notice', 'Summary of the order (DRC-07)', ist_today() - 3, NULL, NULL),
 ('a0000000-0000-0000-0000-00000000000c', '11111111-0000-0000-0000-000000000001', 'notices', 'k12', 'Order', 'Summary of the demand after issue of order by the Appellate Authority (APL-04)', ist_today() - 3, NULL, NULL);

SELECT t_eq((SELECT count(*) FROM notice_facts WHERE client_id = '11111111-0000-0000-0000-000000000001'), 12::bigint, 'all fixtures visible');
SELECT t_eq(form_code, 'DRC-01B', 'DRC-01B code'), t_eq(priority, 'High', 'DRC-01B default priority')
  FROM gst_notices WHERE id = 'a0000000-0000-0000-0000-000000000001';
SELECT t_eq(form_code, 'DRC-01C', 'DRC-01C code') FROM gst_notices WHERE id = 'a0000000-0000-0000-0000-000000000002';
SELECT t_eq(form_code, 'GSTR-3A', 'GSTR-3A code') FROM gst_notices WHERE id = 'a0000000-0000-0000-0000-000000000003';
SELECT t_eq(form_code, 'REG-17', 'REG-17 code') FROM gst_notices WHERE id = 'a0000000-0000-0000-0000-000000000004';
SELECT t_eq(form_code, 'DRC-01', 'case type maps to DRC-01') FROM gst_notices WHERE id = 'a0000000-0000-0000-0000-000000000005';
SELECT t_eq(form_code, 'LUT', 'LUT code'), t_eq(priority, 'Low', 'LUT default priority')
  FROM gst_notices WHERE id = 'a0000000-0000-0000-0000-000000000006';
SELECT t_eq(form_code, 'DRC-03', 'voluntary payment code') FROM gst_notices WHERE id = 'a0000000-0000-0000-0000-000000000007';
SELECT t_eq(form_code, NULL::text, 'unknown order has no code'), t_eq(priority, NULL::text, 'no rule, no demand: no priority')
  FROM gst_notices WHERE id = 'a0000000-0000-0000-0000-000000000008';
SELECT t_eq(priority, 'Low', 'a supplied priority is never replaced') FROM gst_notices WHERE id = 'a0000000-0000-0000-0000-000000000009';
SELECT t_eq(form_code, 'DRC-07', 'DRC-07 code') FROM gst_notices WHERE id = 'a0000000-0000-0000-0000-00000000000b';
SELECT t_eq(form_code, 'APL-04', 'APL-04 wins over DRC-07 summary wording') FROM gst_notices WHERE id = 'a0000000-0000-0000-0000-00000000000c';

-- Categories: rule category first, then the older text buckets (same as the JS classifier).
SELECT t_eq(category, 'Demand Notice', 'DRC-01B category') FROM notice_facts WHERE id = 'a0000000-0000-0000-0000-000000000001';
SELECT t_eq(category, 'Non filers', 'GSTR-3A category') FROM notice_facts WHERE id = 'a0000000-0000-0000-0000-000000000003';
SELECT t_eq(category, 'Registration', 'REG-17 category') FROM notice_facts WHERE id = 'a0000000-0000-0000-0000-000000000004';
SELECT t_eq(category, 'DRC 01', 'case DRC-01 category') FROM notice_facts WHERE id = 'a0000000-0000-0000-0000-000000000005';
SELECT t_eq(category, 'LUT', 'LUT category') FROM notice_facts WHERE id = 'a0000000-0000-0000-0000-000000000006';
SELECT t_eq(category, 'Voluntary Payment', 'DRC-03 keeps the legacy bucket'), t_eq(is_drc03_case, true, 'drc03 case flag')
  FROM notice_facts WHERE id = 'a0000000-0000-0000-0000-000000000007';
SELECT t_eq(category, 'Order', 'unmatched order keeps its type') FROM notice_facts WHERE id = 'a0000000-0000-0000-0000-000000000008';
SELECT t_eq(category, 'Appeal', 'APL-04 category') FROM notice_facts WHERE id = 'a0000000-0000-0000-0000-00000000000c';
SELECT t_eq(notice_category_legacy(NULL, NULL), 'Uncategorised', 'legacy empty'),
       t_eq(notice_category_legacy('', 'x'), 'Uncategorised', 'legacy empty type'),
       t_eq(notice_category_legacy('Pre-Gst Recovery', 'x'), 'Recovery', 'legacy case map'),
       t_eq(notice_category_legacy('Notice', 'Application for registration'), 'Registration', 'legacy registration');

-- Short clocks: only for portal-list notices issued on/after the start date, only without a portal due date.
SELECT t_eq(effective_due, issue_date + 7, 'DRC-01B 7-day clock'), t_eq(due_basis, 'computed', 'computed basis'),
       t_eq(due_basis_note IS NOT NULL, true, 'basis text shown')
  FROM notice_facts WHERE id = 'a0000000-0000-0000-0000-000000000001';
SELECT t_eq(effective_due, add_working_days(issue_date, 7), 'REG-17 7 working days'),
       t_eq(extract(isodow FROM effective_due) <> 7, true, 'never lands on a Sunday')
  FROM notice_facts WHERE id = 'a0000000-0000-0000-0000-000000000004';
SELECT t_eq(effective_due, NULL::date, 'no clock before computed_clock_from') FROM notice_facts WHERE id = 'a0000000-0000-0000-0000-00000000000a';
SELECT t_eq(effective_due, NULL::date, 'no computed clock for case rows') FROM notice_facts WHERE id = 'a0000000-0000-0000-0000-000000000005';
SELECT t_eq(add_working_days(DATE '2026-10-03', 1), DATE '2026-10-05', 'working days skip Sunday'),
       t_eq(add_working_days(DATE '2026-10-03', 7), DATE '2026-10-12', 'seven working days from a Saturday');
UPDATE gst_notices SET due_date = issue_date + 10 WHERE id = 'a0000000-0000-0000-0000-000000000001';
SELECT t_eq(effective_due, issue_date + 10, 'portal due date wins'), t_eq(due_basis, 'portal', 'portal basis')
  FROM notice_facts WHERE id = 'a0000000-0000-0000-0000-000000000001';

-- Editing the rules re-classifies.
UPDATE notice_form_rules SET is_active = false WHERE form_code = 'DRC-01C';
SELECT t_eq(form_code, NULL::text, 'deactivated rule re-classifies') FROM gst_notices WHERE id = 'a0000000-0000-0000-0000-000000000002';
ROLLBACK;
