-- Builder rows deleted with their parent keep their client (round 2 review):
-- a builder row reaches its client through its project, unit, booking ...,
-- and a delete that cascades removes the parent before the child's statement
-- is logged. Each parent keeps its client for the deleting transaction
-- (gst_change_log_gone), so the unit's charges, bookings, members, receipts,
-- invoices and set-offs are logged with the client, and show in the client's
-- Change history. Receipts and bookings carry a name. Writes as PostgREST runs
-- them, with the app's header (Gita).
SET search_path = public, extensions;

CREATE TEMP TABLE t_ids (k text PRIMARY KEY, id uuid);
INSERT INTO t_ids VALUES
 ('project', '25000000-0000-0000-0000-000000000001'), ('unit', '25000000-0000-0000-0000-000000000002'),
 ('booking', '25000000-0000-0000-0000-000000000003'), ('member', '25000000-0000-0000-0000-000000000004'),
 ('charge', '25000000-0000-0000-0000-000000000005'), ('receipt', '25000000-0000-0000-0000-000000000006'),
 ('invoice', '25000000-0000-0000-0000-000000000007'), ('setoff', '25000000-0000-0000-0000-000000000008');
GRANT SELECT ON t_ids TO anon;

SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"bld-add"}');
INSERT INTO builder_projects (id, client_id, name) VALUES ('25000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Sunrise Towers');
INSERT INTO builder_units (id, project_id, unit_no) VALUES ('25000000-0000-0000-0000-000000000002', '25000000-0000-0000-0000-000000000001', 'T-101');
INSERT INTO builder_bookings (id, unit_id, booking_date, status) VALUES ('25000000-0000-0000-0000-000000000003', '25000000-0000-0000-0000-000000000002', '2026-04-02', 'ACTIVE');
INSERT INTO builder_booking_members (id, booking_id, name) VALUES ('25000000-0000-0000-0000-000000000004', '25000000-0000-0000-0000-000000000003', 'A. Buyer');
INSERT INTO builder_unit_charges (id, unit_id, charge_head, amount) VALUES ('25000000-0000-0000-0000-000000000005', '25000000-0000-0000-0000-000000000002', 'PARKING', 300000);
INSERT INTO builder_receipts (id, booking_id, unit_id, receipt_date, receipt_nature, period_month, consideration, cgst, sgst)
VALUES ('25000000-0000-0000-0000-000000000006', '25000000-0000-0000-0000-000000000003', '25000000-0000-0000-0000-000000000002',
        '2026-04-10', 'ADVANCE', '04/2026', 100000, 2500, 2500);
INSERT INTO builder_invoices (id, booking_id, unit_id, invoice_date, period_month, cgst, sgst, doc_series, doc_no)
VALUES ('25000000-0000-0000-0000-000000000007', '25000000-0000-0000-0000-000000000003', '25000000-0000-0000-0000-000000000002',
        '2026-05-01', '05/2026', 2500, 2500, 'INV', '7');
INSERT INTO builder_advance_adjustments (id, invoice_id, receipt_id, period_month, cgst, sgst)
VALUES ('25000000-0000-0000-0000-000000000008', '25000000-0000-0000-0000-000000000007', '25000000-0000-0000-0000-000000000006', '05/2026', 2500, 2500);

-- 1. The unit is deleted: everything under it goes with it.
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"bld-del"}');
DELETE FROM builder_units WHERE id = '25000000-0000-0000-0000-000000000002';
RESET ROLE;
SELECT t_eq((SELECT string_agg(table_name, ',' ORDER BY table_name) FROM gst_change_log WHERE request_id = 'bld-del'),
            'builder_advance_adjustments,builder_booking_members,builder_bookings,builder_invoices,builder_receipts,builder_unit_charges,builder_units',
            'the unit and every row its delete cascaded to are logged');
SELECT t_eq((SELECT string_agg(table_name, ',' ORDER BY table_name) FROM gst_change_log
              WHERE request_id = 'bld-del' AND client_id IS DISTINCT FROM '20000000-0000-0000-0000-000000000001'), NULL::text,
            'each with the client (SUNRISE)');
SELECT t_eq((SELECT string_agg(table_name || '=' || actor_name || '/' || actor_basis, ',' ORDER BY table_name) FROM gst_change_log
              WHERE request_id = 'bld-del' AND actor_name IS DISTINCT FROM 'Gita'), NULL::text, 'each by Gita, from the header');
SELECT t_eq((SELECT row_label FROM gst_change_log WHERE request_id = 'bld-del' AND table_name = 'builder_receipts'),
            'Receipt 2026-04-10 · ADVANCE', 'a receipt is named by its date and nature');
SELECT t_eq((SELECT row_label FROM gst_change_log WHERE request_id = 'bld-del' AND table_name = 'builder_bookings'),
            'Booking 2026-04-02 · ACTIVE', 'a booking by its date and status');
SELECT t_eq((SELECT row_label FROM gst_change_log WHERE request_id = 'bld-del' AND table_name = 'builder_invoices'),
            'INV/7 · Invoice 2026-05-01', 'an invoice by its number and date');
SELECT t_eq((SELECT row_label FROM gst_change_log WHERE request_id = 'bld-del' AND table_name = 'builder_unit_charges'),
            'PARKING', 'a charge by its head');
SELECT t_eq((SELECT period_month || ' ' || (changed ->> 'cgst') || ' ' || (changed ->> 'sgst') FROM gst_change_log
              WHERE request_id = 'bld-del' AND table_name = 'builder_receipts'),
            '04/2026 2500 2500', 'the receipt''s month and the GST it carried');
SET ROLE anon;
SELECT t_eq((SELECT string_agg(table_name, ',' ORDER BY table_name) FROM gst_change_history
              WHERE client_id = '20000000-0000-0000-0000-000000000001' AND request_id = 'bld-del' AND op = 'DELETE'),
            'builder_advance_adjustments,builder_booking_members,builder_bookings,builder_invoices,builder_receipts,builder_unit_charges,builder_units',
            'all of it in the client''s Change history');
RESET ROLE;
SELECT t_eq((SELECT count(DISTINCT txid) FROM gst_change_log_gone)::int, 1, 'the unit''s delete kept its parents'' clients');

-- 2. A whole project is deleted: units, bookings, receipts, reversals,
-- reclassifications, cancellations, ITC reversal workings and their rows.
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"bld-add2"}');
INSERT INTO builder_units (id, project_id, unit_no) VALUES ('25000000-0000-0000-0000-000000000012', '25000000-0000-0000-0000-000000000001', 'T-102');
INSERT INTO builder_bookings (id, unit_id, booking_date, status) VALUES ('25000000-0000-0000-0000-000000000013', '25000000-0000-0000-0000-000000000012', '2026-06-01', 'ACTIVE');
INSERT INTO builder_booking_members (booking_id, name) VALUES ('25000000-0000-0000-0000-000000000013', 'B. Buyer');
INSERT INTO builder_receipts (id, booking_id, unit_id, receipt_date, period_month, cgst, sgst)
VALUES ('25000000-0000-0000-0000-000000000016', '25000000-0000-0000-0000-000000000013', '25000000-0000-0000-0000-000000000012', '2026-06-05', '06/2026', 900, 900);
INSERT INTO builder_bounce_reversals (id, receipt_id, unit_id, project_id, original_period, cgst, sgst)
VALUES ('25000000-0000-0000-0000-000000000017', '25000000-0000-0000-0000-000000000016', '25000000-0000-0000-0000-000000000012',
        '25000000-0000-0000-0000-000000000001', '06/2026', 900, 900);
INSERT INTO builder_bounce_offsets (reversal_id, period_month, cgst, sgst) VALUES ('25000000-0000-0000-0000-000000000017', '07/2026', 900, 900);
INSERT INTO builder_reclassifications (id, unit_id, posting_period) VALUES ('25000000-0000-0000-0000-000000000018', '25000000-0000-0000-0000-000000000012', '07/2026');
INSERT INTO builder_reclassification_periods (reclassification_id, period_month, differential_tax) VALUES ('25000000-0000-0000-0000-000000000018', '06/2026', 120);
INSERT INTO builder_cancellations (id, project_id, unit_id, booking_id, cancellation_date)
VALUES ('25000000-0000-0000-0000-000000000019', '25000000-0000-0000-0000-000000000001', '25000000-0000-0000-0000-000000000012',
        '25000000-0000-0000-0000-000000000013', '2026-08-01');
INSERT INTO builder_refund_payments (cancellation_id, period_month, amount) VALUES ('25000000-0000-0000-0000-000000000019', '08/2026', 50000);
INSERT INTO builder_itc_reversal_workings (id, client_id, project_id, posting_period)
VALUES ('25000000-0000-0000-0000-000000000020', '20000000-0000-0000-0000-000000000001', '25000000-0000-0000-0000-000000000001', '09/2026');
INSERT INTO builder_itc_reversal_years (working_id, financial_year) VALUES ('25000000-0000-0000-0000-000000000020', '2025-26');
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000002","x-gst-source":"app","x-gst-request":"bld-del2"}');
DELETE FROM builder_projects WHERE id = '25000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT t_eq((SELECT count(DISTINCT table_name) FROM gst_change_log WHERE request_id = 'bld-del2')::int, 13,
            'the project and the 12 kinds of rows under it are logged');
SELECT t_eq((SELECT string_agg(table_name, ',' ORDER BY table_name) FROM gst_change_log
              WHERE request_id = 'bld-del2' AND client_id IS DISTINCT FROM '20000000-0000-0000-0000-000000000001'), NULL::text,
            'every one with the client, however deep the cascade');
SELECT t_eq((SELECT count(DISTINCT txid) FROM gst_change_log_gone)::int, 1, 'the next delete forgot what the finished one kept');

-- 3. Deleting the client itself: its builder rows too keep it.
INSERT INTO clients (id, name, gstin) VALUES ('20000000-0000-0000-0000-000000000025', 'GONE BUILDERS', '24GGGGG2525G1Z1');
SET ROLE anon;
INSERT INTO builder_projects (id, client_id, name) VALUES ('25000000-0000-0000-0000-000000000031', '20000000-0000-0000-0000-000000000025', 'Last Tower');
INSERT INTO builder_units (id, project_id, unit_no) VALUES ('25000000-0000-0000-0000-000000000032', '25000000-0000-0000-0000-000000000031', 'L-1');
INSERT INTO builder_receipts (unit_id, receipt_date, period_month, cgst, sgst) VALUES ('25000000-0000-0000-0000-000000000032', '2026-09-01', '09/2026', 10, 10);
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000001","x-gst-source":"app","x-gst-request":"bld-del3"}');
DELETE FROM clients WHERE id = '20000000-0000-0000-0000-000000000025';
RESET ROLE;
SELECT t_eq((SELECT string_agg(table_name || '=' || COALESCE(client_id::text, '-'), ',' ORDER BY table_name) FROM gst_change_log WHERE request_id = 'bld-del3'),
            'builder_projects=20000000-0000-0000-0000-000000000025,builder_receipts=20000000-0000-0000-0000-000000000025,'
            || 'builder_units=20000000-0000-0000-0000-000000000025,clients=20000000-0000-0000-0000-000000000025',
            'a client deleted: its project, unit and receipt logged with it');

-- 4. Nobody writes the kept clients but the triggers.
SET ROLE anon;
SELECT t_raises($$INSERT INTO gst_change_log_gone (id, client_id) VALUES (gen_random_uuid(), gen_random_uuid())$$, 'permission denied', 'no direct writes');
RESET ROLE;
