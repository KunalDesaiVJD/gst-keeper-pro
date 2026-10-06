-- Statutory clocks (migration 20261006114000).
BEGIN;
INSERT INTO clients (id, name, gstin) VALUES ('55555555-0000-0000-0000-000000000001', 'Iota Exports', '24IIIII0000I1Z5');
UPDATE notice_settings SET computed_clock_from = ist_today() - 60;

-- Open SCN with a portal due date: reply_due; hearing fixed: hearing.
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, due_date, hearing_date)
VALUES ('d0000000-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 'notices', 'k1', 'Notice', 'Show cause notice DRC-01', ist_today() - 10, ist_today() + 20, ist_today() + 25);
SELECT t_eq((SELECT deadline_date FROM matter_deadlines WHERE notice_id = 'd0000000-0000-0000-0000-000000000001' AND deadline_type = 'reply_due'), ist_today() + 20, 'reply due clock');
SELECT t_eq((SELECT statutory_basis FROM matter_deadlines WHERE notice_id = 'd0000000-0000-0000-0000-000000000001' AND deadline_type = 'reply_due'), 'Due date on the portal notice', 'reply due basis');
SELECT t_eq((SELECT deadline_date FROM matter_deadlines WHERE notice_id = 'd0000000-0000-0000-0000-000000000001' AND deadline_type = 'hearing'), ist_today() + 25, 'hearing clock');

-- Reply logged: met; order logged: s.107 appeal + condonation from the order date.
UPDATE gst_notices SET reply_date = ist_today(), order_date = DATE '2026-09-15' WHERE id = 'd0000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT is_met FROM matter_deadlines WHERE notice_id = 'd0000000-0000-0000-0000-000000000001' AND deadline_type = 'reply_due'), true, 'reply met');
SELECT t_eq((SELECT deadline_date FROM matter_deadlines WHERE notice_id = 'd0000000-0000-0000-0000-000000000001' AND deadline_type = 'appeal_s107'), DATE '2026-12-15', 's.107 three months');
SELECT t_eq((SELECT deadline_date FROM matter_deadlines WHERE notice_id = 'd0000000-0000-0000-0000-000000000001' AND deadline_type = 'appeal_s107_condonation'), DATE '2027-01-15', 's.107 condonation one more month');
SELECT t_eq((SELECT period_confirmed FROM matter_deadlines WHERE notice_id = 'd0000000-0000-0000-0000-000000000001' AND deadline_type = 'appeal_s107'), false, 'period unconfirmed by default');
SELECT t_eq((SELECT base_date FROM matter_deadlines WHERE notice_id = 'd0000000-0000-0000-0000-000000000001' AND deadline_type = 'appeal_s107'), DATE '2026-09-15', 'runs from the order date');

-- Closing the notice drops reply and hearing, keeps the appeal clocks.
UPDATE gst_notices SET staff_status = 'Adjudged' WHERE id = 'd0000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT string_agg(deadline_type, ',' ORDER BY deadline_type) FROM matter_deadlines WHERE notice_id = 'd0000000-0000-0000-0000-000000000001'),
            'appeal_s107,appeal_s107_condonation', 'closed notice keeps only the appeal clocks');

-- The firm confirms a period: the clocks say so; a person's override is kept.
UPDATE litigation_rules SET confirmed_at = now(), confirmed_by = 'Partner' WHERE key = 'appeal_months.s107';
SELECT t_eq((SELECT period_confirmed FROM matter_deadlines WHERE notice_id = 'd0000000-0000-0000-0000-000000000001' AND deadline_type = 'appeal_s107'), true, 'confirmed period');
UPDATE matter_deadlines SET source = 'override', deadline_date = DATE '2026-12-01'
 WHERE notice_id = 'd0000000-0000-0000-0000-000000000001' AND deadline_type = 'appeal_s107';
UPDATE gst_notices SET order_date = DATE '2026-09-20' WHERE id = 'd0000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT deadline_date || '/' || computed_date FROM matter_deadlines WHERE notice_id = 'd0000000-0000-0000-0000-000000000001' AND deadline_type = 'appeal_s107'),
            '2026-12-01/2026-12-20', 'override kept, computed date updated beside it');

-- APL-04 runs the s.112 clock from its own date; DRC-22 the attachment expiry and objection window.
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date) VALUES
 ('d0000000-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000001', 'notices', 'k2', 'Order', 'Summary of order in appeal APL-04', DATE '2026-09-10'),
 ('d0000000-0000-0000-0000-000000000003', '55555555-0000-0000-0000-000000000001', 'notices', 'k3', 'Order', 'Provisional attachment of property DRC-22', ist_today() - 2);
SELECT t_eq((SELECT deadline_date FROM matter_deadlines WHERE notice_id = 'd0000000-0000-0000-0000-000000000002' AND deadline_type = 'appeal_s112'), DATE '2026-12-10', 's.112 from APL-04');
SELECT t_eq((SELECT deadline_date FROM matter_deadlines WHERE notice_id = 'd0000000-0000-0000-0000-000000000002' AND deadline_type = 'appeal_s112_condonation'), DATE '2027-03-10', 's.112 condonation three months');
SELECT t_eq((SELECT deadline_date FROM matter_deadlines WHERE notice_id = 'd0000000-0000-0000-0000-000000000003' AND deadline_type = 'attachment_expiry'), ist_today() - 2 + 365, 'DRC-22 lapses in a year');
SELECT t_eq((SELECT deadline_date FROM matter_deadlines WHERE notice_id = 'd0000000-0000-0000-0000-000000000003' AND deadline_type = 'reply_due'), ist_today() + 5, 'DRC-22 objection in 7 days');

-- Full refresh is idempotent; removal of the notice removes computed clocks only.
SELECT t_eq((notice_clocks_refresh(NULL) ->> 'written')::int, 0, 'nothing to rewrite');
UPDATE gst_notices SET deleted_at = now() WHERE id = 'd0000000-0000-0000-0000-000000000001';
SELECT t_eq((SELECT string_agg(deadline_type || ':' || source, ',') FROM matter_deadlines WHERE notice_id = 'd0000000-0000-0000-0000-000000000001'),
            'appeal_s107:override', 'computed clocks of a removed notice go, overrides stay');
ROLLBACK;
