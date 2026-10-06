-- One ingest door and the run ledger (migration 20261006113000).
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id) VALUES
 ('44444444-0000-0000-0000-000000000001', 'Epsilon Ltd', '24EEEEE0000E1Z5', 'eps'),
 ('44444444-0000-0000-0000-000000000002', 'Zeta Ltd', '24FFFFF0000F1Z5', 'zeta'),
 ('44444444-0000-0000-0000-000000000003', 'Eta Ltd', '24GGGGG0000G1Z5', 'eta'),
 ('44444444-0000-0000-0000-000000000004', 'Theta Ltd (inactive)', '24HHHHH0000H1Z5', 'theta');
UPDATE clients SET inactive_at_hand = true WHERE id = '44444444-0000-0000-0000-000000000004';

-- The extension runs as anon.
SET LOCAL ROLE anon;
CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb);
INSERT INTO r SELECT 'run', to_jsonb(sync_run_start('notices_bundle', 3, '0.5.0', 'PC-1'));

INSERT INTO r SELECT 'i1', sync_ingest('44444444-0000-0000-0000-000000000001', (SELECT (v #>> '{}')::uuid FROM r WHERE k = 'run'), 'notices',
  '[{"portal_key":"ZD41","reference_number":"ZD41","notice_type":"Notice","description":"ASMT-10","issue_date":"2026-09-01","due_date":"2026-12-01","pdf_url":"https://x/1.pdf"},
    {"portal_key":"ZD42","reference_number":"ZD42","notice_type":"Notice","description":"Order","issue_date":"31/02/2026"},
    {"portal_key":"ZD43","reference_number":"ZD43","notice_type":"Notice","description":"Third"},
    {"portal_key":"ZD43","reference_number":"ZD43","notice_type":"Notice","description":"Third (dup, last wins)"}]'::jsonb, '0.5.0');
SELECT t_eq((SELECT v ->> 'new' FROM r WHERE k = 'i1'), '3', 'three new rows (duplicate key folded)');
SELECT t_eq((SELECT issue_date FROM gst_notices WHERE portal_key = 'ZD42'), NULL::date, 'malformed portal date becomes NULL');
SELECT t_eq((SELECT description FROM gst_notices WHERE portal_key = 'ZD43'), 'Third (dup, last wins)', 'last duplicate wins');

-- Same pull again: nothing new, nothing changed; PDF kept when the pull carries none.
INSERT INTO r SELECT 'i2', sync_ingest('44444444-0000-0000-0000-000000000001', NULL, 'notices',
  '[{"portal_key":"ZD41","reference_number":"ZD41","notice_type":"Notice","description":"ASMT-10","issue_date":"2026-09-01","due_date":"2026-12-01"},
    {"portal_key":"ZD42","reference_number":"ZD42","notice_type":"Notice","description":"Order","issue_date":"31/02/2026"},
    {"portal_key":"ZD43","reference_number":"ZD43","notice_type":"Notice","description":"Third (dup, last wins)"}]'::jsonb, '0.5.0');
SELECT t_eq((SELECT (v ->> 'new') || '/' || (v ->> 'changed') || '/' || (v ->> 'unchanged') || '/' || (v ->> 'removed') FROM r WHERE k = 'i2'),
            '0/0/3/0', 'repeat pull: all unchanged');
SELECT t_eq((SELECT pdf_url FROM gst_notices WHERE portal_key = 'ZD41'), 'https://x/1.pdf', 'stored PDF kept');

-- One changed, one gone: counted and soft-deleted (1 of 3 is under the guard).
INSERT INTO r SELECT 'i3', sync_ingest('44444444-0000-0000-0000-000000000001', NULL, 'notices',
  '[{"portal_key":"ZD41","reference_number":"ZD41","notice_type":"Notice","description":"ASMT-10","issue_date":"2026-09-01","due_date":"2026-12-15"},
    {"portal_key":"ZD42","reference_number":"ZD42","notice_type":"Notice","description":"Order","issue_date":"31/02/2026"}]'::jsonb, '0.5.0');
SELECT t_eq((SELECT (v ->> 'changed') || '/' || (v ->> 'removed') FROM r WHERE k = 'i3'), '1/1', 'one changed, one removed');
SELECT t_eq((SELECT deleted_at IS NOT NULL FROM gst_notices WHERE portal_key = 'ZD43'), true, 'missing row soft-deleted');
-- It comes back: counted as changed, restored.
INSERT INTO r SELECT 'i4', sync_ingest('44444444-0000-0000-0000-000000000001', NULL, 'notices',
  '[{"portal_key":"ZD41","reference_number":"ZD41","notice_type":"Notice","description":"ASMT-10","issue_date":"2026-09-01","due_date":"2026-12-15"},
    {"portal_key":"ZD42","reference_number":"ZD42","notice_type":"Notice","description":"Order","issue_date":"31/02/2026"},
    {"portal_key":"ZD43","reference_number":"ZD43","notice_type":"Notice","description":"Third (dup, last wins)"}]'::jsonb, '0.5.0');
SELECT t_eq((SELECT v ->> 'changed' FROM r WHERE k = 'i4'), '1', 'restored row counted as changed');
SELECT t_eq((SELECT deleted_at FROM gst_notices WHERE portal_key = 'ZD43'), NULL::timestamptz, 'restored');

-- Guards: an empty pull, a partial pull and a mass removal are held.
INSERT INTO r SELECT 'g1', sync_ingest('44444444-0000-0000-0000-000000000001', NULL, 'notices', '[]'::jsonb, '0.5.0');
SELECT t_eq((SELECT (v ->> 'status') || '/' || (v ->> 'held') FROM r WHERE k = 'g1'), 'held/3', 'empty pull held');
INSERT INTO r SELECT 'g2', sync_ingest('44444444-0000-0000-0000-000000000001', NULL, 'notices',
  '[{"portal_key":"ZD41","reference_number":"ZD41","notice_type":"Notice","description":"ASMT-10","issue_date":"2026-09-01","due_date":"2026-12-15"}]'::jsonb, '0.5.0', false);
SELECT t_eq((SELECT v ->> 'status' FROM r WHERE k = 'g2'), 'held', 'partial pull held');
SELECT t_eq((SELECT count(*) FROM gst_notices WHERE client_id = '44444444-0000-0000-0000-000000000001' AND deleted_at IS NULL), 3::bigint, 'nothing removed while held');
INSERT INTO r SELECT 'g3', sync_ingest('44444444-0000-0000-0000-000000000002', NULL, 'notices',
  (SELECT jsonb_agg(jsonb_build_object('portal_key', 'Z' || g, 'notice_type', 'Notice', 'description', 'n' || g)) FROM generate_series(1, 10) g), '0.5.0');
INSERT INTO r SELECT 'g4', sync_ingest('44444444-0000-0000-0000-000000000002', NULL, 'notices', '[{"portal_key":"Z1","notice_type":"Notice","description":"n1"}]'::jsonb, '0.5.0');
SELECT t_eq((SELECT (v ->> 'status') || '/' || (v ->> 'held') FROM r WHERE k = 'g4'), 'held/9', 'mass removal held');
RESET ROLE;

-- Manual notices are never marked missing; last_seen_at never moves backwards.
INSERT INTO gst_notices (client_id, source, portal_key, notice_type, description) VALUES
 ('44444444-0000-0000-0000-000000000001', 'notices', 'manual:abc', 'Notice', 'Typed in');
UPDATE gst_notices SET last_seen_at = now() + interval '1 day' WHERE portal_key = 'ZD41';
SELECT sync_ingest('44444444-0000-0000-0000-000000000001', NULL, 'notices',
  '[{"portal_key":"ZD41","reference_number":"ZD41","notice_type":"Notice","description":"ASMT-10","issue_date":"2026-09-01","due_date":"2026-12-15"},
    {"portal_key":"ZD42","reference_number":"ZD42","notice_type":"Notice","description":"Order"}]'::jsonb, '0.5.0');
SELECT t_eq((SELECT deleted_at FROM gst_notices WHERE portal_key = 'manual:abc'), NULL::timestamptz, 'manual notice untouched');
SELECT t_eq((SELECT last_seen_at > now() + interval '23 hours' FROM gst_notices WHERE portal_key = 'ZD41'), true, 'last_seen_at never moves back');

-- Case folder: scope required, attachments merged, removal per case.
DO $$ BEGIN
  PERFORM sync_ingest('44444444-0000-0000-0000-000000000001', NULL, 'case_folder', '[]'::jsonb, '0.5.0');
  RAISE EXCEPTION 'case_folder without a case id should fail';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
SELECT sync_ingest('44444444-0000-0000-0000-000000000001', NULL, 'case_folder',
  '[{"portal_key":"ORDRS:O1","folder_section":"ORDRS","reference_number":"O1","attachments":[{"label":"a.pdf","url":"u1"}],"raw_json":{"x":1}}]'::jsonb,
  '0.5.0', true, 'AD41');
SELECT sync_ingest('44444444-0000-0000-0000-000000000001', NULL, 'case_folder',
  '[{"portal_key":"ORDRS:O1","folder_section":"ORDRS","reference_number":"O1","attachments":[{"label":"b.pdf","url":"u2"}],"raw_json":{"x":1}}]'::jsonb,
  '0.5.0', true, 'AD41');
SELECT t_eq((SELECT jsonb_array_length(attachments) FROM gst_case_folder_items WHERE portal_key = 'ORDRS:O1'), 2, 'attachments merged, none lost');

-- Refunds and DRC-03.
SELECT t_eq(sync_ingest('44444444-0000-0000-0000-000000000003', NULL, 'refunds',
  '[{"portal_key":"AA1","arn":"AA1","refund_type":"Export","filed_date":"2026-08-01","claimed_amount":1000,"status":"Filed"}]'::jsonb, '0.5.0') ->> 'new', '1', 'refund ingested');
SELECT t_eq(sync_ingest('44444444-0000-0000-0000-000000000003', NULL, 'drc03',
  '[{"portal_key":"AD1","arn":"AD1","cause_of_payment":"Voluntary","filed_date":"2026-08-01","status":"Acknowledged","cash_amount":5}]'::jsonb, '0.5.0') ->> 'new', '1', 'DRC-03 ingested');
SELECT t_eq(sync_ingest('44444444-0000-0000-0000-000000000003', NULL, 'drc03', '[]'::jsonb, '0.5.0') ? 'sweep', true, 'sweep runs after DRC-03');

-- Ledger and status.
SELECT t_eq((SELECT count(*) FROM sync_run_items WHERE client_id = '44444444-0000-0000-0000-000000000001' AND step = 'notices'), 7::bigint, 'one ledger row per ingest');
SELECT t_eq((SELECT rows_new FROM sync_run_items WHERE run_id IS NOT NULL), 3, 'run item counts');
SELECT sync_log_step(NULL, '44444444-0000-0000-0000-000000000003', 'notices', 'failed', 'login_failed', 'Invalid password', '0.5.0');
SELECT t_eq((SELECT last_reason_class || '/' || is_stale FROM client_sync_status WHERE client_id = '44444444-0000-0000-0000-000000000003' AND step = 'notices'),
            'login_failed/true', 'failure reason and staleness');
SELECT t_eq((SELECT last_status FROM client_sync_status WHERE client_id = '44444444-0000-0000-0000-000000000001' AND step = 'notices'), 'ok', 'latest attempt ok');
UPDATE sync_run_items SET created_at = now() - interval '2 days' WHERE client_id = '44444444-0000-0000-0000-000000000002';
SELECT sync_run_finish((SELECT (v #>> '{}')::uuid FROM r WHERE k = 'run'));
SELECT t_eq((SELECT status || '/' || clients_done FROM sync_runs), 'done/1', 'run finished with its client count');

-- Queue: urgent first (overdue notice), then never synced, then stalest; inactive left out.
INSERT INTO gst_notices (client_id, source, portal_key, notice_type, description, issue_date, due_date)
VALUES ('44444444-0000-0000-0000-000000000002', 'notices', 'URG', 'Notice', 'Urgent', ist_today() - 10, ist_today() - 1);
SELECT t_eq((SELECT string_agg(name, ' > ' ORDER BY ord) FROM (SELECT name, row_number() OVER () AS ord FROM sync_queue(NULL)) q),
            'Zeta Ltd > Eta Ltd > Epsilon Ltd', 'risk order');
SELECT t_eq((SELECT count(*) FROM sync_queue(ARRAY['44444444-0000-0000-0000-000000000004'::uuid])), 1::bigint, 'inactive client syncs when picked by hand');
ROLLBACK;
