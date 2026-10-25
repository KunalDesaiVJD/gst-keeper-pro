-- An appeal's pre-deposit is read from every shape of the APL-01 the portal
-- gives (20261025170000) and every appeal is audited (20261025190000). On live
-- 9 paid appeals once read "Pre-deposit short: ₹0 paid" because the amount was
-- in orddtl.paidamt, not orddtl.predepositamt.
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, gst_password, inactive_at_hand) VALUES
 ('11600000-0000-0000-0000-000000000001', 'Deposit Works', '24DEPOS0000D1Z5', 'depos', 'p1', false);

-- Four orders, each appealed with a different APL-01 shape.
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, case_id, financial_year, amount_of_demand) VALUES
 ('11600000-0000-0000-0000-0000000000a1', '11600000-0000-0000-0000-000000000001', 'notices', 'd1', 'Determination Of Tax',
  'Summary of the order (DRC-07)', '2024-02-19', 'ZD240224000001A', 'AD2408230000001', '2018-19', 4706466),
 ('11600000-0000-0000-0000-0000000000a2', '11600000-0000-0000-0000-000000000001', 'notices', 'd2', 'Determination Of Tax',
  'Summary of the order (DRC-07)', '2024-02-19', 'ZD240224000002B', 'AD2408230000002', '2018-19', 100000),
 ('11600000-0000-0000-0000-0000000000a3', '11600000-0000-0000-0000-000000000001', 'notices', 'd3', 'Determination Of Tax',
  'Summary of the order (DRC-07)', '2024-02-19', 'ZD240224000003C', 'AD2408230000003', '2018-19', 100000),
 ('11600000-0000-0000-0000-0000000000a4', '11600000-0000-0000-0000-000000000001', 'notices', 'd4', 'Determination Of Tax',
  'Summary of the order (DRC-07)', '2024-02-19', 'ZD240224000004D', 'AD2408230000004', '2018-19', 100000);
INSERT INTO gst_case_folder_items (client_id, case_id, portal_key, reference_number, folder_section, raw_json) VALUES
 -- 1. Live shape (Unity Organics): no predepositamt, the amount in paidamt, a PRN.
 ('11600000-0000-0000-0000-000000000001', 'AD240224000001P', 'f1', 'ZD240224000001A', 'APLCN',
  '{"arn": "AD240224000001P", "aplnum": "APPEAL", "aplsts": "SUB", "authdtls": {"dt": "24/02/2024"},
    "orddtl": {"ordnum": "ZD240224000001A", "orddt": "19/02/2024", "ordcommdt": "19/02/2024", "predepotax": "10", "prn": "IP2402240010857",
               "dispamt": {"total": {"tx": 1590022, "tot": 4706466}}, "paidamt": {"total": {"tx": 159004, "tot": 159004}},
               "payableamt": {"total": {"tot": 0}}, "initamt": {"total": {"tot": 4706466}}}}'),
 -- 2. Paid in paidamt, no PRN (SBL-GJ's shape).
 ('11600000-0000-0000-0000-000000000001', 'AD240224000002P', 'f2', 'ZD240224000002B', 'APLCN',
  '{"arn": "AD240224000002P", "aplnum": "APPEAL", "aplsts": "SUB", "authdtls": {"dt": "24/02/2024"},
    "orddtl": {"ordnum": "ZD240224000002B", "orddt": "19/02/2024", "predepotax": "10",
               "dispamt": {"total": {"tx": 150870, "tot": 300000}}, "paidamt": {"total": {"tot": 15088}}}}'),
 -- 3. A record with an amount below 10%: short, and said so.
 ('11600000-0000-0000-0000-000000000001', 'AD240224000003P', 'f3', 'ZD240224000003C', 'APLCN',
  '{"arn": "AD240224000003P", "aplnum": "APPEAL", "aplsts": "SUB", "authdtls": {"dt": "24/02/2024"},
    "orddtl": {"ordnum": "ZD240224000003C", "orddt": "19/02/2024", "predepotax": "10",
               "dispamt": {"total": {"tx": 100000, "tot": 200000}}, "paidamt": {"total": {"tot": 5000}}}}'),
 -- 4. No amount at all, and a deposit field the reader does not know.
 ('11600000-0000-0000-0000-000000000001', 'AD240224000004P', 'f4', 'ZD240224000004D', 'APLCN',
  '{"arn": "AD240224000004P", "aplnum": "APPEAL", "aplsts": "SUB", "authdtls": {"dt": "24/02/2024"},
    "orddtl": {"ordnum": "ZD240224000004D", "orddt": "19/02/2024", "predepotax": "10",
               "dispamt": {"total": {"tx": 100000, "tot": 200000}}, "depositpaiddtl": {"total": {"tot": 10000}}}}');
SELECT notices_sweep_linked('11600000-0000-0000-0000-000000000001');

CREATE TEMP TABLE pd AS
  SELECT k AS case_key, x FROM unnest(ARRAY['AD2408230000001', 'AD2408230000002', 'AD2408230000003', 'AD2408230000004']) k
   CROSS JOIN LATERAL jsonb_array_elements(notice_case_key_dates('11600000-0000-0000-0000-000000000001', k)) x
   WHERE x ->> 'kind' = 'predeposit';

SELECT t_eq((SELECT x ->> 'title' FROM pd WHERE case_key = 'AD2408230000001'), 'Pre-deposit of ₹1,59,004 paid with the appeal',
            'the amount paid is read from paidamt when predepositamt is missing');
SELECT t_eq((SELECT (x ->> 'tone') || '/' || (x ->> 'prn') FROM pd WHERE case_key = 'AD2408230000001'), 'ok/IP2402240010857',
            'paid, with the payment''s PRN');
SELECT t_eq((SELECT position('PRN IP2402240010857' IN x ->> 'detail') > 0 FROM pd WHERE case_key = 'AD2408230000001'), true,
            'the PRN is named on the line');
SELECT t_eq((SELECT (x ->> 'tone') || '/' || (x ->> 'title') FROM pd WHERE case_key = 'AD2408230000002'),
            'ok/Pre-deposit of ₹15,088 paid with the appeal', 'paid with no PRN on the record');
SELECT t_eq((SELECT (x ->> 'tone') || '/' || (x ->> 'title') FROM pd WHERE case_key = 'AD2408230000003'),
            'danger/Pre-deposit short: ₹5,000 paid, ₹10,000 required', 'a real shortfall is still shown');
SELECT t_eq((SELECT (x ->> 'tone') || '/' || (x ->> 'title') FROM pd WHERE case_key = 'AD2408230000004'),
            'info/Pre-deposit not shown on the portal record', 'no amount is never "₹0 paid"');
SELECT t_eq((SELECT count(*) FROM pd WHERE x ->> 'title' LIKE '%₹0 paid%'), 0::bigint, 'nothing reads ₹0 paid');

-- The audit: the same reader, a verdict for each appeal.
SELECT t_eq((SELECT string_agg(appeal_arn || '=' || verdict, ',' ORDER BY appeal_arn) FROM notice_predeposit_audit()
              WHERE client_id = '11600000-0000-0000-0000-000000000001'),
            'AD240224000001P=paid,AD240224000002P=paid,AD240224000003P=short,AD240224000004P=unread',
            'each appeal gets a verdict');
SELECT t_eq((SELECT array_to_string(unread_fields, ',') FROM notice_predeposit_audit() WHERE appeal_arn = 'AD240224000004P'),
            'depositpaiddtl', 'a deposit field the reader does not know is named, so the reader is taught it');
SELECT t_eq((SELECT paid::text || '/' || required::text || '/' || prn FROM notice_predeposit_audit() WHERE appeal_arn = 'AD240224000001P'),
            '159004/159002/IP2402240010857', 'the audit reads what the timeline reads');
ROLLBACK;
