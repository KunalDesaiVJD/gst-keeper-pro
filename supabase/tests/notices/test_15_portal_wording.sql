-- Classifier refinements from the live wording (migration 20261006116000).
BEGIN;
INSERT INTO clients (id, name, gstin) VALUES ('15151515-0000-0000-0000-000000000001', 'Omicron Pvt', '24OOOOO0000O1Z5');
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, case_id, staff_status) VALUES
 ('f1000000-0000-0000-0000-000000000001', '15151515-0000-0000-0000-000000000001', 'notices', 'w1', 'Determination Of Tax', 'Order for Determination of Tax', ist_today() - 20, 'AD1', NULL),
 ('f1000000-0000-0000-0000-000000000002', '15151515-0000-0000-0000-000000000001', 'notices', 'w2', 'Determination Of Tax', 'Order for proceedings dropped', ist_today() - 20, 'AD2', NULL),
 ('f1000000-0000-0000-0000-000000000003', '15151515-0000-0000-0000-000000000001', 'notices', 'w3', 'Voluntary Payment', 'Acknowledgement of acceptance', ist_today() - 20, 'AD3', NULL),
 ('f1000000-0000-0000-0000-000000000004', '15151515-0000-0000-0000-000000000001', 'notices', 'w4', 'Letter Of Undertaking', 'Application for furnishing LUT having ARN AD24 is deemed approved as no action has been taken', ist_today() - 20, 'AD4', NULL),
 ('f1000000-0000-0000-0000-000000000005', '15151515-0000-0000-0000-000000000001', 'notices', 'w5', 'Order', 'Registration Certificate', ist_today() - 20, NULL, NULL),
 ('f1000000-0000-0000-0000-000000000006', '15151515-0000-0000-0000-000000000001', 'notices', 'w6', 'Order', 'Order of Amendment', ist_today() - 20, NULL, NULL),
 ('f1000000-0000-0000-0000-000000000007', '15151515-0000-0000-0000-000000000001', 'notices', 'w7', 'Notice', 'Registration SCN', ist_today() - 20, NULL, NULL),
 ('f1000000-0000-0000-0000-000000000008', '15151515-0000-0000-0000-000000000001', 'notices', 'w8', 'Notice', 'Cancellation SCN', ist_today() - 20, NULL, NULL),
 ('f1000000-0000-0000-0000-000000000009', '15151515-0000-0000-0000-000000000001', 'notices', 'w9', 'Enforcement Case', 'Show Cause Notice', ist_today() - 20, 'AD9', NULL),
 ('f1000000-0000-0000-0000-00000000000a', '15151515-0000-0000-0000-000000000001', 'notices', 'w10', 'Notice', 'Notice for Seeking Additional Information / Clarification / Documents relating to Application for Amendment', ist_today() - 20, NULL, NULL),
 ('f1000000-0000-0000-0000-00000000000b', '15151515-0000-0000-0000-000000000001', 'notices', 'w11', 'Order', 'Order of Amendment', ist_today() - 20, NULL, 'Reviewed'),
 ('f1000000-0000-0000-0000-00000000000c', '15151515-0000-0000-0000-000000000001', 'notices', 'w12', 'Order', 'Summary Order', ist_today() - 20, NULL, NULL),
 ('f1000000-0000-0000-0000-00000000000d', '15151515-0000-0000-0000-000000000001', 'notices', 'w13', 'Order', 'Registration Rejection Order', ist_today() - 2000, NULL, NULL);

SELECT t_eq((SELECT string_agg(portal_key || '=' || coalesce(form_code, '-'), ' ' ORDER BY portal_key) FROM gst_notices WHERE client_id = '15151515-0000-0000-0000-000000000001'),
  'w1=DRC-07 w10=REG-03 w11=REG-15 w12=DRC-07 w13=REG-05 w2=DROPPED w3=ACCEPTED w4=LUT-APPROVED w5=REG-06 w6=REG-15 w7=REG-SCN w8=REG-17 w9=DRC-01', 'form codes from the portal wording');
SELECT t_eq((SELECT string_agg(portal_key || '=' || category, ' ' ORDER BY portal_key) FROM notice_facts WHERE client_id = '15151515-0000-0000-0000-000000000001'),
  'w1=DRC 01 w10=Registration w11=Registration w12=DRC 01 w13=Registration w2=DRC 01 w3=Voluntary Payment w4=LUT w5=Registration w6=Registration w7=Registration w8=Registration w9=Enforcement',
  'generic buckets refined, specific buckets kept');
SELECT t_eq((SELECT count(*) FROM matter_deadlines WHERE notice_id = 'f1000000-0000-0000-0000-000000000001' AND deadline_type = 'appeal_s107'), 1::bigint,
  'an order for determination of tax starts the appeal clock');
SELECT t_eq((SELECT count(*) FROM matter_deadlines WHERE notice_id = 'f1000000-0000-0000-0000-00000000000d'), 0::bigint,
  'an order from years ago carries no clock');

SELECT notices_sweep('15151515-0000-0000-0000-000000000001');
SELECT t_eq((SELECT string_agg(portal_key || '=' || close_reason, ' ' ORDER BY portal_key) FROM gst_notices
              WHERE client_id = '15151515-0000-0000-0000-000000000001' AND close_reason LIKE 'auto:%'),
  'w13=auto:registration_concluded w2=auto:proceedings_dropped w3=auto:accepted w4=auto:lut_approval w5=auto:informational_order w6=auto:informational_order',
  'acknowledgements and favourable orders closed by rule');
SELECT t_eq((SELECT staff_status FROM gst_notices WHERE portal_key = 'w11'), 'Reviewed', 'a triaged notice is never auto-closed');
SELECT t_eq((SELECT count(*) FROM notice_events WHERE notice_id = 'f1000000-0000-0000-0000-000000000005' AND event_type = 'closed' AND actor_name = 'Closing sweep'), 1::bigint,
  'closures logged as the sweep');

-- The firm switches a rule's auto-close off.
UPDATE notice_form_rules SET auto_close_reason = NULL WHERE form_code = 'REG-06';
INSERT INTO gst_notices (client_id, source, portal_key, notice_type, description, issue_date)
VALUES ('15151515-0000-0000-0000-000000000001', 'notices', 'w14', 'Order', 'Registration Certificate', ist_today());
SELECT notices_sweep('15151515-0000-0000-0000-000000000001');
SELECT t_eq((SELECT staff_status FROM gst_notices WHERE portal_key = 'w14'), NULL::text, 'auto-close is data the firm controls');
ROLLBACK;
