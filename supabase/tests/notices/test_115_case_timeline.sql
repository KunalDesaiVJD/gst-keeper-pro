-- Every event of a case on its timeline (20261025130000): an appeal's APL-01 is
-- never taken for the order it names, items carry what the portal record says,
-- and the dates the law attaches to the papers are listed.
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, gst_password, inactive_at_hand) VALUES
 ('11500000-0000-0000-0000-000000000001', 'Timeline Works', '24TIMEL0000T1Z5', 'timel', 'p1', false);

-- The demand case: intimation, notice, an adjournment, the order.
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, case_id, financial_year, amount_of_demand) VALUES
 ('11500000-0000-0000-0000-0000000000a1', '11500000-0000-0000-0000-000000000001', 'notices', 't1', 'Determination Of Tax',
  'Intimation of tax ascertained being payable under section 73(5)/74(5) (DRC-01A)', '2025-09-19', 'ZD240925000001A', 'AD2409250000ORG', '2019-20', 1134184),
 ('11500000-0000-0000-0000-0000000000a2', '11500000-0000-0000-0000-000000000001', 'notices', 't2', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', '2025-09-26', 'ZD240925000002B', 'AD2409250000ORG', '2019-20', 1569214),
 ('11500000-0000-0000-0000-0000000000a3', '11500000-0000-0000-0000-000000000001', 'notices', 't3', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', '2026-02-23', 'ZD240226000003C', 'AD2409250000ORG', '2019-20', NULL),
 ('11500000-0000-0000-0000-0000000000a4', '11500000-0000-0000-0000-000000000001', 'notices', 't4', 'Determination Of Tax',
  'Summary of the order (DRC-07)', '2026-03-09', 'ZD240326000004D', 'AD2409250000ORG', '2019-20', 1610440),
 -- The appeal: its admission and a hearing.
 ('11500000-0000-0000-0000-0000000000a5', '11500000-0000-0000-0000-000000000001', 'notices', 't5', 'Appeal',
  'Hearing notice issued', '2026-07-14', 'ZD240726000005E', 'AD2406260000APL', NULL, NULL);
INSERT INTO gst_case_folder_items (client_id, case_id, portal_key, reference_number, folder_section, raw_json) VALUES
 ('11500000-0000-0000-0000-000000000001', 'AD2409250000ORG', 'f1', 'ZD240925000001A', 'INTIM',
  '{"refid": "ZD240925000001A", "refdt": "19/09/2025", "duedt": "25/09/2025", "sdtls": {"dtscn": {"fy": "2019-2020", "sec": "74", "type": "Intimation DRC-01A"}}}'),
 ('11500000-0000-0000-0000-000000000001', 'AD2409250000ORG', 'f2', 'ZD240925000002B', 'NOTCE',
  '{"refid": "ZD240925000002B", "refdt": "26/09/2025", "sdtls": {"dtscn": {"fy": "2019-2020", "sec": "74", "pht": "11:00", "phdt": "10/10/2025", "type": "SCN and DRC-01", "venu": "Unit 10", "duedt": "26/10/2025"}}}'),
 ('11500000-0000-0000-0000-000000000001', 'AD2409250000ORG', 'f3', 'ZD240226000003C', 'NOTCE',
  '{"refid": "ZD240226000003C", "refdt": "23/02/2026", "ntref": "ZD240925000002B", "sdtls": {"adjrn": {"fy": "2019-2020", "sec": "74", "pht": "11:00", "phdt": "26/02/2026", "type": "ADJOURNMENT", "venu": "unit 10"}}}'),
 ('11500000-0000-0000-0000-000000000001', 'AD2409250000ORG', 'f4', 'ZD240326000004D', 'ORDRS',
  '{"refid": "ZD240326000004D", "refdt": "09/03/2026", "sdtls": {"dtorder": {"fy": "2019-2020", "sec": "74", "type": "Assessment order and GST DRC-07", "duedt": "08/04/2026", "ntcno": "ZD240925000002B"}}}'),
 ('11500000-0000-0000-0000-000000000001', 'AD2409250000ORG', 'f5', 'ZD241025000006F', 'REPLY',
  '{"reply": {"fy": "2019-2020", "ntcno": "ZD240925000002B", "refId": "ZD241025000006F"}, "replydt": "29/10/2025"}'),
 -- The APL-01: its reference is the order's number.
 ('11500000-0000-0000-0000-000000000001', 'AD2406260000APL', 'f6', 'ZD240326000004D', 'APLCN',
  '{"arn": "AD2406260000APL", "aplnum": "APPEAL", "aplsts": "SUB", "insertTimeStamp": "09/06/2026 18:50:10", "authdtls": {"dt": "09/06/2026"},
    "orddtl": {"ordnum": "ZD240326000004D", "orddt": "09/03/2026", "ordcommdt": "09/03/2026", "predepotax": "10",
               "dispamt": {"total": {"tx": 509730, "tot": 1610440}}, "predepositamt": {"total": {"tot": 50974}}},
    "issuecat": [{"id": "16", "desc": "Ineligible ITC"}],
    "docappeal": {"id": "20260624101907", "docname": "GST APL-01.pdf"},
    "docothers": [{"id": "20260624101871", "name": "EXHIBIT A", "docname": "Binder1.pdf"}]}'),
 ('11500000-0000-0000-0000-000000000001', 'AD2406260000APL', 'f7', 'ZD240726000005E', 'NOTCE',
  '{"crn": "AD2406260000APL", "refid": "ZD240726000005E", "refdt": "14/07/2026", "sdtls": {"pht": "12:30 PM", "phdt": "21/07/2026", "venu": "DC, APPEAL-2"}}');
INSERT INTO gst_portal_applications (id, client_id, case_type_cd, portal_key, arn, case_id, form_number, status, filed_date, raw_json) VALUES
 ('11500000-0000-0000-0000-0000000000d1', '11500000-0000-0000-0000-000000000001', 'APPEL', 'AD2406260000APL', 'AD2406260000APL', '1', 'GST APL-01',
  'Hearing Notice Issued', '2026-06-09', '{"arn": "AD2406260000APL", "appItem": {"refId": "ZD240326000004D"}}');
SELECT notices_sweep_linked('11500000-0000-0000-0000-000000000001');

SELECT t_eq((SELECT parent_key || '/' || kind FROM notice_case_links WHERE child_key = 'AD2406260000APL'), 'AD2409250000ORG/appeal',
            'the appeal is linked under the order it names');
SELECT t_eq((SELECT form_code FROM notice_facts WHERE id = '11500000-0000-0000-0000-0000000000a4'), 'DRC-07', 'the order is a DRC-07');

-- 1. The APL-01 is on the timeline, labelled, with what its record says.
SELECT t_eq((SELECT x ->> 'label' FROM jsonb_array_elements(notice_case_items('11500000-0000-0000-0000-000000000001', 'AD2409250000ORG')) x
              WHERE x ->> 'section' = 'APLCN'), 'APL-01 · Appeal filed against ZD240326000004D',
            'the APL-01 is not taken for the DRC-07 whose number it carries');
SELECT t_eq((SELECT x ->> 'date' FROM jsonb_array_elements(notice_case_items('11500000-0000-0000-0000-000000000001', 'AD2409250000ORG')) x
              WHERE x ->> 'section' = 'APLCN'), '2026-06-09', 'dated the day it was filed');
SELECT t_eq((SELECT (x #>> '{facts,predeposit}') || '/' || (x #>> '{facts,disputed_tax}') || '/' || (x #>> '{facts,portal_status}') || '/' || jsonb_array_length(x #> '{facts,portal_docs}')
               FROM jsonb_array_elements(notice_case_items('11500000-0000-0000-0000-000000000001', 'AD2409250000ORG')) x
              WHERE x ->> 'section' = 'APLCN'), '50974/509730/Hearing Notice Issued/2',
            'its pre-deposit, tax in dispute, portal status and both documents filed with it');
SELECT t_eq((SELECT count(*) FROM jsonb_array_elements(notice_case_items('11500000-0000-0000-0000-000000000001', 'AD2409250000ORG')) x
              WHERE x ->> 'section' = 'REPLY'), 1::bigint, 'the reply is listed');
SELECT t_eq((SELECT count(*) FROM jsonb_array_elements(notice_case_items('11500000-0000-0000-0000-000000000001', 'AD2409250000ORG')) x
              WHERE x ->> 'section' IN ('NOTCE', 'ORDRS', 'INTIM')), 0::bigint, 'a notice''s own folder copy is still not listed twice');
SELECT t_eq((SELECT x #>> '{facts,hearing,date}' FROM jsonb_array_elements(notice_case_items('11500000-0000-0000-0000-000000000001', 'AD2409250000ORG')) x
              WHERE x ->> 'id' = '11500000-0000-0000-0000-0000000000a5'), '2026-07-21', 'a hearing notice carries its hearing date');

-- 2. The dates the law attaches.
CREATE TEMP TABLE kd AS SELECT x FROM jsonb_array_elements(notice_case_key_dates('11500000-0000-0000-0000-000000000001', 'AD2406260000APL')) x;
SELECT t_eq((SELECT x ->> 'title' FROM kd WHERE x ->> 'kind' = 'appeal_filed'), 'Appeal filed on the last day of the 3 months',
            'the appeal of 9 June against the order of 9 March was filed on the last day (s.107(1))');
SELECT t_eq((SELECT x ->> 'tone' FROM kd WHERE x ->> 'kind' = 'appeal_filed'), 'ok', 'in time');
SELECT t_eq((SELECT x ->> 'title' FROM kd WHERE x ->> 'kind' = 'predeposit'), 'Pre-deposit of ₹50,974 paid with the appeal',
            'the pre-deposit covers 10% of the tax in dispute');
SELECT t_eq((SELECT string_agg(x ->> 'date', ',' ORDER BY x ->> 'date') FROM kd WHERE x ->> 'kind' = 'hearing'), '2025-10-10,2026-02-26,2026-07-21',
            'every personal hearing, once');
SELECT t_eq((SELECT x ->> 'title' FROM kd WHERE x ->> 'kind' = 'adjournment'), 'Adjournment 1 of the 3 the law allows', 'adjournments counted (s.75(5))');
SELECT t_eq((SELECT string_agg(x ->> 'law', ',' ORDER BY x ->> 'date') FROM kd WHERE x ->> 'kind' = 'pay_to_close'), 's.74(5),s.74(8),s.74(11)',
            'the windows to pay and close with a reduced penalty');
SELECT t_eq((SELECT x ->> 'date' FROM kd WHERE x ->> 'kind' = 'payment_due'), '2026-04-08', 'the demand''s payment date');
SELECT t_eq((SELECT count(*) FROM kd WHERE x ->> 'kind' = 'appeal_window'), 0::bigint, 'no open appeal window once an appeal is filed');

-- 3. An order with no appeal: the time to appeal.
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number, case_id, financial_year, amount_of_demand) VALUES
 ('11500000-0000-0000-0000-0000000000b1', '11500000-0000-0000-0000-000000000001', 'notices', 't9', 'Determination Of Tax',
  'Summary of the order (DRC-07)', ist_today() - 10, 'ZD240326000009Z', 'AD2409250000NEW', '2021-22', 100000);
SELECT notices_sweep_linked('11500000-0000-0000-0000-000000000001');
SELECT t_eq((SELECT x ->> 'date' FROM jsonb_array_elements(notice_case_key_dates('11500000-0000-0000-0000-000000000001', 'AD2409250000NEW')) x
              WHERE x ->> 'kind' = 'appeal_window'), ((ist_today() - 10) + interval '3 months')::date::text, 'the last day to appeal, 3 months on');
SELECT t_eq(notice_inr(1610440), '₹16,10,440', 'amounts the Indian way');
ROLLBACK;
