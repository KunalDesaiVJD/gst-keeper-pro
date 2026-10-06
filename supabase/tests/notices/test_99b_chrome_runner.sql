-- Scheduled syncs in the firm's own Chrome (migration 20261008170000): the runner the
-- settings name, one job at a time, no CAPTCHA wall, CAPTCHA timeouts retried, the
-- heartbeat, the badge, the tick and the status the Autopilot page reads.
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, email, inactive_at_hand, notices_sync_excluded) VALUES
 ('99b99999-0000-0000-0000-00000000000a', 'Chrome One Traders', '24CHONE0000C1Z5', 'one', NULL, false, false),
 ('99b99999-0000-0000-0000-00000000000b', 'Chrome Two Traders', '24CHTWO0000C1Z5', 'two', NULL, false, false),
 ('99b99999-0000-0000-0000-00000000000c', 'Chrome Three LLP', '24CHTHR0000C1Z5', 'three', NULL, false, false);
UPDATE clients SET inactive_at_hand = true WHERE id::text NOT LIKE '99b99999-%';

-- ── The firm's Chrome runs the queue by default ────────────────────────────
SELECT t_eq((SELECT runner FROM autopilot_settings WHERE id), 'chrome', 'the default runner is the firm''s Chrome');
SELECT t_eq((SELECT captcha_wait_secs FROM autopilot_settings WHERE id), 120, 'it waits two minutes for the CAPTCHA box');
DO $$ BEGIN
  UPDATE autopilot_settings SET runner = 'cloud' WHERE id;
  RAISE EXCEPTION 'an unknown runner was accepted';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  UPDATE autopilot_settings SET captcha_wait_secs = 5 WHERE id;
  RAISE EXCEPTION 'a five second CAPTCHA wait was accepted';
EXCEPTION WHEN check_violation THEN NULL; END $$;

SELECT t_eq(autopilot_runner_kind('chrome:6f1c'), 'chrome', 'a chrome: agent is a Chrome runner');
SELECT t_eq(autopilot_runner_kind('office-pc'), 'office_agent', 'anything else is the office agent');

-- ── Heartbeat and online ───────────────────────────────────────────────────
UPDATE autopilot_settings SET enabled = true, schedule_enabled = false, close_at = '23:59:59', max_attempts = 2,
                              nudge_at = time '00:00';
SELECT t_eq((autopilot_heartbeat('office-pc', '{"version": "1.1.0"}') ->> 'serves')::boolean, false,
            'the office agent is told it does not run the queue');
SELECT t_eq(autopilot_agent_online(), false, 'an office agent kept for reading notices does not make the runner online');
SELECT t_eq((autopilot_heartbeat('chrome:a', '{"kind": "chrome", "label": "Front desk PC", "version": "0.7.0"}') ->> 'runner'),
            'chrome', 'the heartbeat names the runner');
SELECT t_eq((autopilot_heartbeat('chrome:a', '{"kind": "chrome", "label": "Front desk PC", "version": "0.7.0"}') ->> 'wall_open')::boolean,
            false, 'there is no wall for the Chrome');
SELECT t_eq((autopilot_heartbeat('chrome:a', '{"kind": "chrome", "label": "Front desk PC", "version": "0.7.0"}') ->> 'captcha_wait_secs')::int,
            120, 'the heartbeat carries the CAPTCHA wait');
SELECT t_eq(autopilot_agent_online(), true, 'a Chrome heartbeat makes the runner online');

-- ── Claim ──────────────────────────────────────────────────────────────────
SELECT t_eq((autopilot_enqueue(NULL, 'PULL_NOTICES_BUNDLE', '{}', 'schedule_morning') ->> 'queued')::int, 3, 'three clients queued');
SELECT t_eq(portal_job_claim('office-pc') IS NULL, true, 'the office agent gets nothing while the Chrome runs the queue');
SELECT t_eq(portal_job_claim('chrome:a', true) ->> 'status', 'claimed', 'the Chrome claims a job');
SELECT t_eq(portal_job_claim('chrome:a', true) IS NULL, true, 'one job at a time per Chrome, whatever its concurrency');
SELECT t_eq(portal_job_claim('chrome:b') ->> 'status', 'claimed', 'a second Chrome takes another job');
SELECT t_eq((SELECT count(DISTINCT claimed_by) FROM portal_jobs WHERE status = 'claimed'), 2::bigint, 'never the same job twice');

-- A job parked for a typed CAPTCHA (office agent days) is never handed to the Chrome.
UPDATE portal_jobs SET status = 'waiting_captcha', claimed_by = NULL
 WHERE status = 'queued' AND client_id = '99b99999-0000-0000-0000-00000000000c';
SELECT t_eq(portal_job_claim('chrome:c', true) IS NULL, true, 'a waiting_captcha job is not given to a Chrome, even with p_wall_open');
SELECT t_eq((autopilot_badge() ->> 'waiting')::int, 0, 'no CAPTCHA badge without a wall');
UPDATE portal_jobs SET status = 'queued' WHERE status = 'waiting_captcha';

-- ── A CAPTCHA not filled in time: retried, then failed ─────────────────────
SELECT t_eq((SELECT portal_job_start(id, 'chrome:a') FROM portal_jobs WHERE claimed_by = 'chrome:a'), true, 'the Chrome starts its job');
SELECT t_eq((SELECT portal_job_finish(id, 'chrome:a', 'retry', 'captcha_timeout', 'The CAPTCHA was not filled within 120 seconds.')
               ->> 'status' FROM portal_jobs WHERE claimed_by = 'chrome:a'), 'queued', 'captcha_timeout goes back to the queue');
SELECT t_eq((SELECT not_before > now() FROM portal_jobs WHERE reason_class = 'captcha_timeout'), true, 'with a wait before the next try');
UPDATE portal_jobs SET not_before = now() - interval '1 second' WHERE reason_class = 'captcha_timeout';
-- Leave only the retried job claimable.
SELECT portal_job_cancel(id, 'Test') FROM portal_jobs WHERE client_id = '99b99999-0000-0000-0000-00000000000c' AND status = 'queued';
SELECT t_eq((WITH c AS MATERIALIZED (SELECT portal_job_claim('chrome:a') AS j)
              SELECT p.reason_class FROM portal_jobs p, c WHERE p.id = (c.j ->> 'id')::uuid), 'captcha_timeout',
            'the Chrome picks it up again');
SELECT t_eq((SELECT portal_job_finish(id, 'chrome:a', 'retry', 'captcha_timeout', 'The CAPTCHA was not filled within 120 seconds.')
               ->> 'status' FROM portal_jobs WHERE claimed_by = 'chrome:a' AND status = 'claimed'), 'failed',
            'after max_attempts it fails with its reason');
SELECT t_eq((SELECT count(*) FROM sync_run_items i JOIN portal_jobs j ON j.run_id = i.run_id AND j.client_id = i.client_id
              WHERE j.reason_class = 'captcha_timeout' AND i.step = 'login' AND i.status = 'failed'), 1::bigint,
            'the failure reaches the run ledger as a login failure');

-- ── Tick: no CAPTCHA nudge; the day's close speaks of the Chrome ───────────
SELECT t_eq((autopilot_tick() ? 'nudge'), false, 'no 09:00 CAPTCHA nudge in Chrome mode');
UPDATE portal_agent_heartbeat SET last_seen = now() - interval '1 hour' WHERE agent_id LIKE 'chrome:%';
UPDATE portal_jobs SET created_at = now() - interval '2 hours', status = 'queued', claimed_by = NULL WHERE status IN ('claimed', 'running');
UPDATE autopilot_settings SET close_at = time '00:00' WHERE id;  -- already past, at any hour
SELECT t_eq((autopilot_tick() ->> 'closed')::int >= 1, true, 'the day closes what was not reached');
SELECT t_eq((SELECT min(error) FROM portal_jobs WHERE reason_class = 'agent_offline'), 'The scheduled Chrome was offline.',
            'in the Chrome''s words');

-- ── Status ─────────────────────────────────────────────────────────────────
SELECT autopilot_heartbeat('chrome:a', '{"kind": "chrome", "label": "Front desk PC", "version": "0.7.0", "busy": true, "client_name": "Chrome One Traders", "step": "login"}');
SELECT t_eq((autopilot_status() ->> 'runner'), 'chrome', 'the status names the runner');
SELECT t_eq((SELECT r ->> 'label' FROM jsonb_array_elements(autopilot_status() -> 'runners') r WHERE r ->> 'agent_id' = 'chrome:a'),
            'Front desk PC', 'runners carry their label');
SELECT t_eq((SELECT (r ->> 'busy')::boolean AND (r ->> 'online')::boolean FROM jsonb_array_elements(autopilot_status() -> 'runners') r
              WHERE r ->> 'agent_id' = 'chrome:a'), true, 'busy and online');
SELECT t_eq((SELECT count(*) FROM jsonb_array_elements(autopilot_status() -> 'runners') r WHERE r ->> 'agent_id' = 'office-pc'),
            0::bigint, 'the office agent is not listed as a runner');
SELECT t_eq((autopilot_status() -> 'wall' ->> 'open')::boolean, false, 'no wall');

-- ── Back to the office agent (by SQL) ──────────────────────────────────────
UPDATE autopilot_settings SET runner = 'office_agent' WHERE id;
SELECT t_eq(portal_job_claim('chrome:a') IS NULL, true, 'with the office agent named, a Chrome gets nothing');
ROLLBACK;
