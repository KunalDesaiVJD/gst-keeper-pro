-- Canonical notice set (migration 20261006111000): every flag, exposure once per
-- dispute, refunds / DRC-03 de-duplicated, and every summary number equal to the
-- row count of the filtered list it opens.
BEGIN;
INSERT INTO clients (id, name, gstin) VALUES
 ('22222222-0000-0000-0000-000000000001', 'Beta Mills', '24BBBBB0000B1Z5'),
 ('22222222-0000-0000-0000-000000000002', 'Gamma Foods', '24CCCCC0000C1Z5');

INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, due_date,
                         extended_due_date, reply_date, staff_status, amount_of_demand, case_id, reference_number, first_seen_at) VALUES
 -- overdue: open, unreplied, due yesterday
 ('b0000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'notices', 'b1', 'Notice', 'Scrutiny of returns ASMT-10', ist_today() - 40, ist_today() - 1, NULL, NULL, NULL, 100000, NULL, 'ZD01', now() - interval '5 days'),
 -- replied: not overdue even though past due
 ('b0000000-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001', 'notices', 'b2', 'Notice', 'Scrutiny of returns ASMT-10', ist_today() - 40, ist_today() - 3, NULL, ist_today() - 5, NULL, NULL, NULL, 'ZD02', now() - interval '5 days'),
 -- closed: never overdue
 ('b0000000-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000001', 'notices', 'b3', 'Notice', 'x', ist_today() - 40, ist_today() - 3, NULL, NULL, 'Closed - replied', 50000, NULL, 'ZD03', now() - interval '5 days'),
 -- extended date wins: portal due passed, extended in 5 days -> due in 7
 ('b0000000-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000001', 'notices', 'b4', 'Notice', 'x', ist_today() - 40, ist_today() - 3, ist_today() + 5, NULL, NULL, NULL, NULL, 'ZD04', now() - interval '5 days'),
 -- due today: due in 7 (today counts)
 ('b0000000-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000001', 'notices', 'b5', 'Notice', 'x', ist_today() - 10, ist_today(), NULL, NULL, NULL, NULL, NULL, 'ZD05', now() - interval '5 days'),
 -- due in 8 days: neither
 ('b0000000-0000-0000-0000-000000000006', '22222222-0000-0000-0000-000000000001', 'notices', 'b6', 'Notice', 'x', ist_today() - 10, ist_today() + 8, NULL, NULL, NULL, NULL, NULL, 'ZD06', now() - interval '5 days'),
 -- replied, due in 2 days: not "due in 7" (replies skipped)
 ('b0000000-0000-0000-0000-000000000007', '22222222-0000-0000-0000-000000000001', 'notices', 'b7', 'Notice', 'x', ist_today() - 10, ist_today() + 2, NULL, ist_today() - 1, NULL, NULL, NULL, 'ZD07', now() - interval '5 days'),
 -- new (first seen an hour ago)
 ('b0000000-0000-0000-0000-000000000008', '22222222-0000-0000-0000-000000000002', 'notices', 'g1', 'Notice', 'x', ist_today(), NULL, NULL, NULL, NULL, NULL, NULL, 'ZD08', now() - interval '1 hour'),
 -- one dispute, two notices with demand: counted once, at the latest notice
 ('b0000000-0000-0000-0000-000000000009', '22222222-0000-0000-0000-000000000002', 'notices', 'g2', 'Determination Of Tax', 'SCN', ist_today() - 60, NULL, NULL, NULL, NULL, 200000, 'AD2401', 'ZD09', now() - interval '5 days'),
 ('b0000000-0000-0000-0000-00000000000a', '22222222-0000-0000-0000-000000000002', 'notices', 'g3', 'Determination Of Tax', 'Order', ist_today() - 10, NULL, NULL, NULL, NULL, 250000, 'AD2401', 'ZD10', now() - interval '5 days'),
 -- refund and voluntary-payment case rows
 ('b0000000-0000-0000-0000-00000000000b', '22222222-0000-0000-0000-000000000002', 'notices', 'g4', 'Refunds', 'Refund case', ist_today() - 30, NULL, NULL, NULL, NULL, NULL, 'AA-RF-1', 'ZA01', now() - interval '5 days'),
 ('b0000000-0000-0000-0000-00000000000c', '22222222-0000-0000-0000-000000000002', 'notices', 'g5', 'Refunds', 'Refund case', ist_today() - 30, NULL, NULL, NULL, 'Closed', NULL, 'AA-RF-2', 'ZA02', now() - interval '5 days'),
 ('b0000000-0000-0000-0000-00000000000d', '22222222-0000-0000-0000-000000000002', 'notices', 'g6', 'Voluntary Payment', 'DRC-03', ist_today() - 30, NULL, NULL, NULL, NULL, NULL, 'AD-VP-1', 'ZA03', now() - interval '5 days'),
 -- soft-deleted and other-source rows stay out of the set
 ('b0000000-0000-0000-0000-00000000000e', '22222222-0000-0000-0000-000000000002', 'notices', 'g7', 'Notice', 'x', ist_today() - 3, ist_today() - 1, NULL, NULL, NULL, NULL, NULL, 'ZD11', now()),
 ('b0000000-0000-0000-0000-00000000000f', '22222222-0000-0000-0000-000000000002', 'additional_notices', 'g8', 'Notice', 'x', ist_today() - 3, ist_today() - 1, NULL, NULL, NULL, NULL, NULL, 'ZD12', now());
UPDATE gst_notices SET deleted_at = now() WHERE id = 'b0000000-0000-0000-0000-00000000000e';

INSERT INTO gst_refund_applications (client_id, portal_key, arn, status) VALUES
 ('22222222-0000-0000-0000-000000000002', 'AA-RF-1', 'AA-RF-1', 'Refund Disbursed'),
 ('22222222-0000-0000-0000-000000000002', 'AA-RF-9', 'AA-RF-9', 'Filed');
INSERT INTO gst_drc03_filings (client_id, portal_key, arn, status) VALUES
 ('22222222-0000-0000-0000-000000000002', 'AD-VP-1', 'AD-VP-1', 'Acknowledged');
INSERT INTO litigation_matters (client_id, matter_no, status, demand_tax, demand_interest, paid_total, pre_deposit_total) VALUES
 ('22222222-0000-0000-0000-000000000002', 'M-1', 'Open', 300000, 20000, 10000, 30000),
 ('22222222-0000-0000-0000-000000000002', 'M-2', 'Closed', 900000, 0, 0, 0);

SELECT t_eq((SELECT count(*) FROM notice_facts WHERE client_id IN ('22222222-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002')), 13::bigint, 'deleted and other-source rows are not in the set');
SELECT t_eq((SELECT is_overdue FROM notice_facts WHERE id = 'b0000000-0000-0000-0000-000000000001'), true, 'overdue');
SELECT t_eq((SELECT is_overdue FROM notice_facts WHERE id = 'b0000000-0000-0000-0000-000000000002'), false, 'replied is not overdue');
SELECT t_eq((SELECT is_overdue FROM notice_facts WHERE id = 'b0000000-0000-0000-0000-000000000003'), false, 'closed is not overdue');
SELECT t_eq((SELECT is_due_in_7 FROM notice_facts WHERE id = 'b0000000-0000-0000-0000-000000000004'), true, 'extended date drives due in 7');
SELECT t_eq((SELECT is_overdue FROM notice_facts WHERE id = 'b0000000-0000-0000-0000-000000000004'), false, 'extended date is not overdue');
SELECT t_eq((SELECT is_due_in_7 FROM notice_facts WHERE id = 'b0000000-0000-0000-0000-000000000005'), true, 'due today is due in 7');
SELECT t_eq((SELECT days_to_due FROM notice_facts WHERE id = 'b0000000-0000-0000-0000-000000000005'), 0, 'days to due today');
SELECT t_eq((SELECT is_due_in_7 FROM notice_facts WHERE id = 'b0000000-0000-0000-0000-000000000006'), false, 'due in 8 days is not due in 7');
SELECT t_eq((SELECT is_due_in_7 FROM notice_facts WHERE id = 'b0000000-0000-0000-0000-000000000007'), false, 'replied is skipped from due in 7');
SELECT t_eq((SELECT is_new FROM notice_facts WHERE id = 'b0000000-0000-0000-0000-000000000008'), true, 'first seen an hour ago is new');
SELECT t_eq((SELECT is_new FROM notice_facts WHERE id = 'b0000000-0000-0000-0000-000000000001'), false, 'first seen 5 days ago is not new');
SELECT t_eq((SELECT exposure_amount FROM notice_facts WHERE id = 'b0000000-0000-0000-0000-00000000000a'), 250000::numeric, 'dispute counted at the latest notice');
SELECT t_eq((SELECT exposure_amount FROM notice_facts WHERE id = 'b0000000-0000-0000-0000-000000000009'), 0::numeric, 'earlier notice in the dispute not counted');
SELECT t_eq((SELECT exposure_amount FROM notice_facts WHERE id = 'b0000000-0000-0000-0000-000000000003'), 0::numeric, 'closed notice has no exposure');
SELECT t_eq((SELECT sum(amount) FROM notice_exposure WHERE client_id = '22222222-0000-0000-0000-000000000002'),
            (250000 + 300000 + 20000 - 10000 - 30000)::numeric, 'exposure: dispute plus open matter outstanding');

-- Linking the dispute's notice to a matter moves its exposure to the matter.
UPDATE gst_notices SET matter_id = (SELECT id FROM litigation_matters WHERE matter_no = 'M-1')
 WHERE id = 'b0000000-0000-0000-0000-00000000000a';
SELECT t_eq((SELECT exposure_amount FROM notice_facts WHERE id = 'b0000000-0000-0000-0000-000000000009'), 200000::numeric, 'unlinked notice of the dispute now carries it');

-- Refunds: application AA-RF-1 covers case AA-RF-1; case AA-RF-2 has no application; AA-RF-9 has no case.
SELECT t_eq((SELECT count(*) FROM refund_facts WHERE client_id = '22222222-0000-0000-0000-000000000002'), 3::bigint, 'refund set de-duplicated by ARN');
SELECT t_eq((SELECT origin FROM refund_facts WHERE arn = 'AA-RF-2'), 'case', 'case-only refund kept');
SELECT t_eq((SELECT is_closed FROM refund_facts WHERE arn = 'AA-RF-1'), true, 'disbursed refund closed');
SELECT t_eq((SELECT is_closed FROM refund_facts WHERE arn = 'AA-RF-9'), false, 'filed refund open');
SELECT t_eq((SELECT count(*) FROM drc03_facts WHERE client_id = '22222222-0000-0000-0000-000000000002'), 1::bigint, 'DRC-03 set de-duplicated by ARN');

-- Every dashboard number equals the row count of the list it opens (same predicate, same set).
DO $$
DECLARE
  s jsonb := notices_dashboard_summary(NULL);
  c text;
BEGIN
  PERFORM t_eq((s ->> 'open')::bigint, (SELECT count(*) FROM notice_facts WHERE is_open), 'open tile = list');
  PERFORM t_eq((s ->> 'overdue')::bigint, (SELECT count(*) FROM notice_facts WHERE is_overdue), 'overdue tile = list');
  PERFORM t_eq((s ->> 'due_in_7')::bigint, (SELECT count(*) FROM notice_facts WHERE is_due_in_7), 'due-in-7 tile = list');
  PERFORM t_eq((s ->> 'new')::bigint, (SELECT count(*) FROM notice_facts WHERE is_new), 'new tile = list');
  PERFORM t_eq((s ->> 'unassigned')::bigint, (SELECT count(*) FROM notice_facts WHERE is_unassigned), 'unassigned tile = list');
  PERFORM t_eq((s ->> 'notice_exposure_count')::bigint, (SELECT count(*) FROM notice_facts WHERE exposure_amount > 0), 'exposure count = list');
  FOR c IN SELECT DISTINCT category FROM notice_facts LOOP
    PERFORM t_eq((notices_dashboard_summary(c) ->> 'open')::bigint,
                 (SELECT count(*) FROM notice_facts WHERE category = c AND is_open), 'category ' || c || ' open = list');
  END LOOP;
  PERFORM t_eq((s ->> 'overdue')::int, 1, 'fixture overdue count');
  PERFORM t_eq((s ->> 'due_in_7')::int, 2, 'fixture due-in-7 count');
END $$;
ROLLBACK;
