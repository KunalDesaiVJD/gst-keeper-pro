-- Sync status before the run ledger (migration 20261006124000): clients synced
-- only by an older extension keep their last known state from client_sync_log
-- until the ledger has a row for them.
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id) VALUES
 ('97979797-0000-0000-0000-000000000001', 'Old Sync Traders', '24OLDSY0000O1Z5', 'oldsync1'),
 ('97979797-0000-0000-0000-000000000002', 'Login Broke Ltd', '24LOGBR0000L1Z5', 'logbroke'),
 ('97979797-0000-0000-0000-000000000003', 'Never Synced Co', '24NEVER0000N1Z5', 'never1'),
 ('97979797-0000-0000-0000-000000000004', 'Ledger Wins LLP', '24LEDGR0000L1Z5', 'ledger1');
INSERT INTO client_sync_log (client_id, action, status, message, created_at) VALUES
 ('97979797-0000-0000-0000-000000000001', 'notices', 'success', 'ok', now() - interval '20 days'),
 ('97979797-0000-0000-0000-000000000001', 'notices_gstr3a_debug', 'success', 'debug', now() - interval '19 days'),
 ('97979797-0000-0000-0000-000000000002', 'notices', 'success', 'ok', now() - interval '30 days'),
 ('97979797-0000-0000-0000-000000000002', 'login_failed', 'failed', 'Invalid username or password', now() - interval '10 days'),
 ('97979797-0000-0000-0000-000000000004', 'notices', 'success', 'ok', now() - interval '40 days');

SELECT t_eq((SELECT last_status || '/' || (last_success_at IS NOT NULL)::text || '/' || is_stale::text
               FROM client_sync_status WHERE client_id = '97979797-0000-0000-0000-000000000001' AND step = 'notices'),
            'ok/true/true', 'an old good pull counts: synced before, stale now');
SELECT t_eq((SELECT count(*) FROM client_sync_status WHERE client_id = '97979797-0000-0000-0000-000000000001'),
            1::bigint, 'debug rows in the old log are not steps');
SELECT t_eq((SELECT last_status || '/' || last_reason_class FROM client_sync_status
              WHERE client_id = '97979797-0000-0000-0000-000000000002' AND step = 'login'),
            'failed/login_failed', 'an old failed login after the last pull is a login failure');
SELECT t_eq((SELECT count(*) FROM client_sync_status WHERE client_id = '97979797-0000-0000-0000-000000000003'),
            0::bigint, 'a client with no sync anywhere has no status row (never synced)');

-- The command centre's health: never = only the client with no history at all.
SELECT t_eq((SELECT (notices_command_centre(NULL) -> 'health' ->> 'never')::int), 1, 'never synced counts only the truly never synced');
SELECT t_eq((SELECT (notices_command_centre(NULL) -> 'health' -> 'failing' ->> 'login_failed')::int), 1, 'the old failed login shows as failing');

-- Once the ledger has a row for the client and step, the ledger alone answers.
INSERT INTO sync_runs (id, mode, status, clients_total) VALUES ('97979797-0000-0000-0000-0000000000a1', 'notices', 'done', 1);
INSERT INTO sync_run_items (run_id, client_id, step, status, reason_class, created_at)
VALUES ('97979797-0000-0000-0000-0000000000a1', '97979797-0000-0000-0000-000000000004', 'notices', 'failed', 'captcha_timeout', now());
SELECT t_eq((SELECT last_status || '/' || last_reason_class || '/' || (last_success_at IS NULL)::text
               FROM client_sync_status WHERE client_id = '97979797-0000-0000-0000-000000000004' AND step = 'notices'),
            'failed/captcha_timeout/true', 'the ledger replaces the old log for that step');
SELECT t_eq((SELECT count(*) FROM client_sync_status WHERE client_id = '97979797-0000-0000-0000-000000000004'),
            1::bigint, 'no duplicate row from the old log');
ROLLBACK;
