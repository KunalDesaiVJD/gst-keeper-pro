-- Loopholes of the law audit (20261027100000): the exclusion door, a portal
-- due date before the issue date, demands with no work, appeal ageing.
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, gst_password, inactive_at_hand) VALUES
 ('11800000-0000-0000-0000-000000000001', 'Loophole Co', '24LOOPH0000L1Z5', 'looph', 'p1', false);
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, due_date, reference_number, case_id, financial_year, amount_of_demand) VALUES
 ('11800000-0000-0000-0000-0000000000a1', '11800000-0000-0000-0000-000000000001', 'notices', 'p1', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 80, ist_today() - 85, 'ZP1', 'AD-LOOP-1', '2022-23', 5720000);

-- P2. A direct write cannot hide the notice.
DO $$ BEGIN
  UPDATE gst_notices SET excluded_at = now() WHERE id = '11800000-0000-0000-0000-0000000000a1';
  RAISE EXCEPTION 'FAILED a direct write hid a notice';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
SELECT t_eq((SELECT excluded_at FROM gst_notices WHERE id = '11800000-0000-0000-0000-0000000000a1') IS NULL, true, 'the direct write was refused');
SELECT t_eq(notice_exclude('11800000-0000-0000-0000-0000000000a1', true, 'x', '11800000-0000-0000-0000-0000000000ff', 'Nobody') ? 'error', true,
            'the door still checks the level');

-- P3. The portal's due date is before the issue date: the rule's period stands, with a note.
SELECT t_eq((SELECT due_basis FROM notice_facts WHERE id = '11800000-0000-0000-0000-0000000000a1'), 'computed', 'the rule''s period is used');
SELECT t_eq((SELECT effective_due > issue_date FROM notice_facts WHERE id = '11800000-0000-0000-0000-0000000000a1'), true, 'the date is after the issue date');
SELECT t_eq((SELECT due_basis_note LIKE 'The portal''s due date%' FROM notice_facts WHERE id = '11800000-0000-0000-0000-0000000000a1'), true, 'and says why');

-- P3. Still at New, past its date, above the amount: raised on Home.
SELECT t_eq((SELECT count(*) FROM notice_stale_demands() WHERE id = '11800000-0000-0000-0000-0000000000a1'), 1::bigint, 'a demand with no work is listed');
UPDATE gst_notices SET stage = 'draft' WHERE id = '11800000-0000-0000-0000-0000000000a1';
SELECT t_eq((SELECT count(*) FROM notice_stale_demands() WHERE id = '11800000-0000-0000-0000-0000000000a1'), 0::bigint, 'work started: off the list');
ROLLBACK;
