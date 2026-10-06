-- Portal Autopilot (migrations 20261007120000–123000): the queue, the claim,
-- the CAPTCHA wall, retries, the schedule, portal e-mails, applications,
-- GSTR-3A closing on filing, and the status the page reads.
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, email, inactive_at_hand, notices_sync_excluded) VALUES
 ('99999999-0000-0000-0000-00000000000a', 'Urgent Traders', '24URGNT0000U1Z5', 'urgent', 'urgent@example.com', false, false),
 ('99999999-0000-0000-0000-00000000000b', 'Never Synced Co', '24NEVER0000N1Z5', 'never', NULL, false, false),
 ('99999999-0000-0000-0000-00000000000c', 'Fresh Fabrics', '24FRESH0000F1Z5', 'fresh', NULL, false, false),
 ('99999999-0000-0000-0000-00000000000d', 'No Creds Ltd', '24NOCRD0000N1Z5', NULL, NULL, false, false),
 ('99999999-0000-0000-0000-00000000000e', 'Sleeping LLP', '24SLEEP0000S1Z5', 'sleep', NULL, true, false),
 ('99999999-0000-0000-0000-00000000000f', 'Opted Out Co', '24OPTED0000O1Z5', 'optout', NULL, false, true);
-- Urgent: a notice due in 3 days. Fresh: a good pull an hour ago.
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, due_date, reference_number) VALUES
 ('e9900000-0000-0000-0000-000000000001', '99999999-0000-0000-0000-00000000000a', 'notices', 'ap1', 'Notice',
  'ASMT-10 scrutiny', ist_today() - 4, ist_today() + 3, 'ZD-AP-1');
INSERT INTO sync_runs (id, mode, status, clients_total) VALUES ('99999999-0000-0000-0000-0000000000f1', 'notices_bundle', 'done', 1);
INSERT INTO sync_run_items (run_id, client_id, step, status, created_at)
VALUES ('99999999-0000-0000-0000-0000000000f1', '99999999-0000-0000-0000-00000000000c', 'notices', 'ok', now() - interval '1 hour');

-- Only these test clients matter here.
UPDATE clients SET inactive_at_hand = true WHERE id::text NOT LIKE '99999999-%';

-- ── Enqueue ────────────────────────────────────────────────────────────────
SELECT t_eq((autopilot_enqueue(NULL, 'PULL_NOTICES_BUNDLE', '{}', 'schedule_morning') ->> 'queued')::int, 3, 'every active client with credentials is queued once');
SELECT t_eq((SELECT string_agg(c.name || ':' || j.priority, ', ' ORDER BY j.queue_rank)
               FROM portal_jobs j JOIN clients c ON c.id = j.client_id WHERE j.active_key = 'PULL_NOTICES_BUNDLE'),
            'Urgent Traders:65, Never Synced Co:60, Fresh Fabrics:50', 'urgent first, then never synced, then the rest');
SELECT t_eq((SELECT (autopilot_enqueue(ARRAY['99999999-0000-0000-0000-00000000000d', '99999999-0000-0000-0000-00000000000f']::uuid[])
                     -> 'skipped')::text),
            '{"excluded": 1, "inactive": 0, "no_credentials": 1}', 'a client without credentials or opted out is skipped and counted');
SELECT t_eq((SELECT count(*) FROM sync_runs WHERE mode LIKE 'autopilot:%' AND clients_total = 0), 0::bigint,
            'an enqueue that queued nothing leaves no run behind');
SELECT t_eq((autopilot_enqueue(NULL, 'PULL_NOTICES_BUNDLE', '{}', 'schedule_morning') ->> 'already')::int, 3, 'enqueue twice: the active jobs stay, no duplicates');
SELECT t_eq((SELECT count(*) FROM portal_jobs WHERE active_key = 'PULL_NOTICES_BUNDLE'), 3::bigint, 'still three jobs');
-- A portal e-mail for a queued client raises its priority.
SELECT t_eq((autopilot_enqueue(ARRAY['99999999-0000-0000-0000-00000000000c']::uuid[], 'PULL_NOTICES_BUNDLE', '{}', 'email', 90) ->> 'queued')::int,
            0, 'already queued');
SELECT t_eq((SELECT priority || '/' || origin FROM portal_jobs WHERE client_id = '99999999-0000-0000-0000-00000000000c'),
            '90/email', 'its priority went up to the e-mail''s');

-- Reports: a mode the agent may run, with periods where it needs them.
DO $$ BEGIN
  PERFORM autopilot_enqueue(ARRAY['99999999-0000-0000-0000-00000000000a']::uuid[], 'FETCH_REPORT', '{"mode": "gstr3b_pull"}', 'report');
  RAISE EXCEPTION 'a monthly report without a period was accepted';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
DO $$ BEGIN
  PERFORM autopilot_enqueue(ARRAY['99999999-0000-0000-0000-00000000000a']::uuid[], 'FETCH_REPORT', '{"mode": "gstr1_upload", "periods": ["04/2026"]}', 'report');
  RAISE EXCEPTION 'an upload was accepted as a report';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
DO $$ BEGIN
  PERFORM autopilot_enqueue(ARRAY['99999999-0000-0000-0000-00000000000a']::uuid[], 'FETCH_REPORT', '{"mode": "gstr9_pull", "periods": ["04/2026"]}', 'report');
  RAISE EXCEPTION 'GSTR-9 for a month was accepted';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
SELECT t_eq((autopilot_enqueue(ARRAY['99999999-0000-0000-0000-00000000000a']::uuid[], 'FETCH_REPORT',
                               '{"mode": "gstr3b_pull", "periods": ["05/2026", "04/2026", "bad"]}', 'report') ->> 'queued')::int,
            1, 'a report is queued');
SELECT t_eq((SELECT active_key || ' ' || (payload -> 'periods')::text FROM portal_jobs WHERE job_type = 'FETCH_REPORT'),
            'FETCH_REPORT:gstr3b_pull:04/2026,05/2026 ["04/2026", "05/2026"]', 'periods cleaned, sorted and part of the key');
SELECT t_eq((autopilot_enqueue(ARRAY['99999999-0000-0000-0000-00000000000a']::uuid[], 'FETCH_REPORT',
                               '{"mode": "gstr3b_pull", "periods": ["06/2026"]}', 'report') ->> 'queued')::int,
            1, 'the same report for other periods is another job');

-- ── Claim ──────────────────────────────────────────────────────────────────
SELECT t_eq(portal_job_claim('pc-1') IS NULL, true, 'switched off: nothing is claimed');
UPDATE autopilot_settings SET enabled = true, concurrency = 1, schedule_enabled = false, close_at = '23:59:59',
                              nudge_at = ((now() AT TIME ZONE 'Asia/Kolkata')::time + interval '6 hours')::time;
SELECT t_eq((autopilot_heartbeat('pc-1', '{"version": "1.0.0"}') ->> 'enabled')::boolean, true, 'the heartbeat returns the switches');
SELECT t_eq(autopilot_agent_online(), true, 'the agent is online after a heartbeat');
SELECT t_eq((SELECT (portal_job_claim('pc-1') ->> 'client_name')), 'Fresh Fabrics', 'highest priority first (the e-mailed client)');
SELECT t_eq(portal_job_claim('pc-1') IS NULL, true, 'at its concurrency the agent gets nothing more');
UPDATE autopilot_settings SET paused_until = now() + interval '1 hour', concurrency = 2;
SELECT t_eq(portal_job_claim('pc-1') IS NULL, true, 'paused: nothing is claimed');
UPDATE autopilot_settings SET paused_until = NULL;

-- Nobody at the wall: the job is parked without holding a browser.
SELECT t_eq(portal_job_park((SELECT id FROM portal_jobs WHERE client_id = '99999999-0000-0000-0000-00000000000c' AND job_type = 'PULL_NOTICES_BUNDLE'), 'pc-1'),
            true, 'parked');
SELECT t_eq((SELECT status || '/' || coalesce(claimed_by, '-') FROM portal_jobs WHERE client_id = '99999999-0000-0000-0000-00000000000c' AND job_type = 'PULL_NOTICES_BUNDLE'),
            'waiting_captcha/-', 'parked jobs wait for a person and belong to no agent');
SELECT t_eq((SELECT portal_job_claim('pc-1', false) ->> 'client_name'), 'Urgent Traders', 'wall closed: the parked job is passed over');
SELECT t_eq((SELECT portal_job_claim('pc-1', true) ->> 'client_name'), 'Fresh Fabrics', 'wall open: the parked job comes back first');

-- ── The CAPTCHA wall ───────────────────────────────────────────────────────
CREATE TEMP TABLE _ap (k text PRIMARY KEY, v text);
INSERT INTO _ap SELECT 'job', id::text FROM portal_jobs WHERE client_id = '99999999-0000-0000-0000-00000000000c' AND job_type = 'PULL_NOTICES_BUNDLE';
SELECT t_eq(portal_job_start((SELECT v::uuid FROM _ap WHERE k = 'job'), 'pc-1', false), true, 'started');
INSERT INTO _ap SELECT 'prompt', portal_job_captcha((SELECT v::uuid FROM _ap WHERE k = 'job'), 'pc-1', 'data:image/png;base64,AAAA', 1)::text;
SELECT t_eq((SELECT status FROM portal_jobs WHERE id = (SELECT v::uuid FROM _ap WHERE k = 'job')), 'needs_human', 'a live CAPTCHA');
DO $$ BEGIN
  PERFORM portal_job_captcha((SELECT v::uuid FROM _ap WHERE k = 'job'), 'pc-1', 'https://example.com/x.png', 1);
  RAISE EXCEPTION 'a non-image CAPTCHA was accepted';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
SELECT t_eq((SELECT jsonb_array_length(autopilot_wall_ping('a0000000-0000-0000-0000-0000000000a1', 'Riya') -> 'captchas')), 1, 'the wall shows it');
SELECT t_eq((SELECT autopilot_wall_ping('a0000000-0000-0000-0000-0000000000a1', 'Riya') -> 'captchas' -> 0 ->> 'client_name'),
            'Fresh Fabrics', 'with the client');
SELECT t_eq(autopilot_wall_open(), true, 'someone is at the wall');
UPDATE autopilot_presence SET last_seen = now() - interval '20 seconds';
SELECT autopilot_wall_ping('a0000000-0000-0000-0000-0000000000a1', 'Riya');
SELECT t_eq((SELECT round(seconds) FROM autopilot_wall_minutes WHERE user_id = 'a0000000-0000-0000-0000-0000000000a1'), 20::numeric,
            'time at the wall is counted between pings');
SELECT t_eq(portal_job_answer((SELECT v::uuid FROM _ap WHERE k = 'job'), gen_random_uuid(), 'abc123'), 'stale', 'an answer to an old CAPTCHA is refused');
SELECT t_eq(portal_job_answer((SELECT v::uuid FROM _ap WHERE k = 'job'), (SELECT v::uuid FROM _ap WHERE k = 'prompt'), '  '), 'empty', 'an empty answer is refused');
SELECT t_eq(portal_job_answer((SELECT v::uuid FROM _ap WHERE k = 'job'), (SELECT v::uuid FROM _ap WHERE k = 'prompt'), ' 4 8 2 6 1 9 ', 'answer', 999999, NULL, 'Riya'),
            'ok', 'the answer is taken');
SELECT t_eq((SELECT status || '/' || (human_response ->> 'captcha') || '/' || captcha_typing_ms || '/' || answered_by_name || '/' || (human_prompt IS NULL)::text
               FROM portal_jobs WHERE id = (SELECT v::uuid FROM _ap WHERE k = 'job')),
            'running/482619/120000/Riya/true', 'spaces dropped, typing time capped, the image deleted');
SELECT t_eq(portal_job_answer((SELECT v::uuid FROM _ap WHERE k = 'job'), (SELECT v::uuid FROM _ap WHERE k = 'prompt'), '482619'), 'stale', 'answered once');

-- ── Finish, retry, ledger ──────────────────────────────────────────────────
SELECT t_eq((portal_job_finish((SELECT v::uuid FROM _ap WHERE k = 'job'), 'pc-2', 'succeeded') ->> 'status'), 'not_yours', 'another agent cannot finish it');
SELECT t_eq((portal_job_finish((SELECT v::uuid FROM _ap WHERE k = 'job'), 'pc-1', 'retry', 'portal_error', 'HTTP 503') ->> 'status'), 'queued',
            'a transient failure goes back on the queue');
SELECT t_eq((SELECT attempts || '/' || round(extract(epoch FROM not_before - now()) / 60) || '/' || coalesce(claimed_by, '-')
               FROM portal_jobs WHERE id = (SELECT v::uuid FROM _ap WHERE k = 'job')),
            '1/5/-', 'after 5 minutes, released');
UPDATE portal_jobs SET status = 'running', claimed_by = 'pc-1', attempts = 2 WHERE id = (SELECT v::uuid FROM _ap WHERE k = 'job');
SELECT t_eq((portal_job_finish((SELECT v::uuid FROM _ap WHERE k = 'job'), 'pc-1', 'retry', 'portal_error', 'HTTP 503') ->> 'status'), 'failed',
            'after max attempts it fails');

-- Urgent Traders: the CAPTCHA was never typed today.
INSERT INTO _ap SELECT 'urgent', id::text FROM portal_jobs WHERE client_id = '99999999-0000-0000-0000-00000000000a' AND job_type = 'PULL_NOTICES_BUNDLE';
SELECT t_eq((portal_job_finish((SELECT v::uuid FROM _ap WHERE k = 'urgent'), 'pc-1', 'failed', 'captcha_timeout', 'Nobody typed the CAPTCHA.') ->> 'status'),
            'failed', 'failed');
SELECT t_eq((SELECT step || '/' || reason_class FROM sync_run_items
              WHERE client_id = '99999999-0000-0000-0000-00000000000a' AND reason_class = 'captcha_timeout'),
            'login/captcha_timeout', 'the client gets a named reason in the run ledger');
-- The last job of the run: the run is closed and counted.
INSERT INTO _ap SELECT 'never', id::text FROM portal_jobs WHERE client_id = '99999999-0000-0000-0000-00000000000b' AND job_type = 'PULL_NOTICES_BUNDLE';
UPDATE portal_jobs SET status = 'running', claimed_by = 'pc-1' WHERE id = (SELECT v::uuid FROM _ap WHERE k = 'never');
SELECT portal_job_finish((SELECT v::uuid FROM _ap WHERE k = 'never'), 'pc-1', 'succeeded', NULL, NULL, '{"notices": "ok"}');
SELECT t_eq((SELECT r.status || '/' || r.clients_done || '/' || r.clients_total FROM sync_runs r
              JOIN portal_jobs j ON j.run_id = r.id WHERE j.id = (SELECT v::uuid FROM _ap WHERE k = 'never')),
            'done/3/3', 'the run closes when its last job ends');
SELECT t_eq((portal_job_retry((SELECT v::uuid FROM _ap WHERE k = 'urgent')) ->> 'queued')::int, 1, 'a failed job can be run again');
SELECT t_eq(portal_job_cancel((SELECT id FROM portal_jobs WHERE client_id = '99999999-0000-0000-0000-00000000000a'
                                 AND job_type = 'PULL_NOTICES_BUNDLE' AND status = 'queued')), 'cancelled', 'and cancelled');

-- An agent that stops reporting gives its jobs back.
UPDATE portal_jobs SET status = 'running', claimed_by = 'pc-dead', updated_at = now() - interval '10 minutes'
 WHERE job_type = 'FETCH_REPORT' AND payload -> 'periods' ? '06/2026';
INSERT INTO portal_agent_heartbeat (agent_id, last_seen) VALUES ('pc-dead', now() - interval '10 minutes');
SELECT t_eq((autopilot_tick() ->> 'released')::int, 1, 'the clock releases a dead agent''s job');
UPDATE portal_jobs SET status = 'running', claimed_by = 'pc-1' WHERE job_type = 'FETCH_REPORT' AND payload -> 'periods' ? '06/2026';
SELECT t_eq(portal_jobs_release('pc-1'), 1, 'an agent restarting gives back what it held');

-- ── Portal e-mails ─────────────────────────────────────────────────────────
UPDATE autopilot_settings SET email_trigger = false;
SELECT t_eq(portal_email_ingest('<m1@gst.gov.in>', now(), 'donotreply@gst.gov.in', 'Notice issued', 'x',
                                ARRAY['24never0000n1z5'], 'DRC-01B', 'zd-ap-9') ->> 'status', 'autopilot_off', 'trigger off: recorded only');
UPDATE autopilot_settings SET email_trigger = true;
SELECT t_eq(portal_email_ingest('<m2@gst.gov.in>', now(), 'donotreply@gst.gov.in', 'Notice issued', 'x',
                                ARRAY['24NOMATCH000N1Z5'], NULL, NULL) ->> 'status', 'unmatched', 'an unknown GSTIN is unmatched');
SELECT t_eq(portal_email_ingest('<m3@gst.gov.in>', now(), 'donotreply@gst.gov.in', 'Notice issued', 'x',
                                ARRAY['24NEVER0000N1Z5'], 'DRC-01B', 'ZD-AP-9') ->> 'status', 'queued', 'a matched GSTIN queues a job');
SELECT t_eq((SELECT priority || '/' || origin FROM portal_jobs WHERE client_id = '99999999-0000-0000-0000-00000000000b' AND status = 'queued'),
            '100/email', 'at e-mail priority (plus never synced, capped at 100)');
SELECT t_eq((portal_email_ingest('<m3@gst.gov.in>', now(), NULL, NULL, NULL, '{}', NULL, NULL) ->> 'duplicate')::boolean, true, 'each e-mail once');
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number) VALUES
 ('e9900000-0000-0000-0000-000000000009', '99999999-0000-0000-0000-00000000000b', 'notices', 'ZD-AP-9', 'Notice',
  'Intimation of difference in liability (DRC-01B)', ist_today(), 'ZD-AP-9');
SELECT t_eq((SELECT status || '/' || (notice_id IS NOT NULL)::text FROM portal_emails WHERE message_id = '<m3@gst.gov.in>'),
            'synced/true', 'the notice arriving links the e-mail');

-- ── The schedule ───────────────────────────────────────────────────────────
UPDATE autopilot_settings SET schedule_enabled = true,
                              morning_at = ((now() AT TIME ZONE 'Asia/Kolkata')::time - interval '1 minute')::time,
                              nudge_at = ((now() AT TIME ZONE 'Asia/Kolkata')::time - interval '1 minute')::time,
                              afternoon_scope = 'off';
SELECT t_eq((autopilot_tick() -> 'morning' ->> 'queued')::int, 2, 'the morning run queues who has no active job (not the e-mailed client)');
SELECT t_eq((autopilot_tick() -> 'morning') IS NULL, true, 'and fires once a day');
SELECT t_eq((SELECT note FROM autopilot_slot_runs WHERE slot = 'nudge'), 'nobody waiting', 'the nudge looked and found nobody waiting');

-- ── Applications ───────────────────────────────────────────────────────────
SELECT t_eq((sync_ingest_applications('99999999-0000-0000-0000-00000000000a', NULL,
  '[{"case_type_cd": "APPEL", "portal_key": "AD24A1", "arn": "AD24A1", "status": "Submitted", "filed_date": "2026-05-02"},
    {"case_type_cd": "APPEL", "portal_key": "AD24A2", "arn": "AD24A2", "status": "Submitted", "filed_date": "2026-31-02"},
    {"case_type_cd": "ADJRO", "portal_key": "AD24R1", "arn": "AD24R1", "status": "Approved"}]', ARRAY['APPEL', 'ADJRO']) ->> 'new')::int,
            3, 'applications saved');
SELECT t_eq((SELECT filed_date IS NULL FROM gst_portal_applications WHERE portal_key = 'AD24A2'), true, 'an impossible date is dropped, not fatal');
SELECT t_eq((sync_ingest_applications('99999999-0000-0000-0000-00000000000a', NULL,
  '[{"case_type_cd": "APPEL", "portal_key": "AD24A1", "arn": "AD24A1", "status": "Order issued", "filed_date": "2026-05-02"}]',
  ARRAY['APPEL', 'ADJRO']))::text, '{"new": 0, "status": "ok", "changed": 1, "removed": 1, "unchanged": 0}',
            'a changed status counts; a type that listed rows drops what it no longer lists; an empty type removes nothing');
SELECT t_eq((SELECT count(*) FROM gst_portal_applications WHERE deleted_at IS NULL), 2::bigint, 'AD24A1 and AD24R1 remain');

-- ── GSTR-3A closes when the return is filed ────────────────────────────────
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, reference_number) VALUES
 ('e9900000-0000-0000-0000-000000000003', '99999999-0000-0000-0000-00000000000c', 'notices', 'ZD-3A-1', 'Notice',
  'Notice to return defaulter u/s 46 for not filing return (GSTR-3A)', ist_today() - 5, 'ZD-3A-1');
SELECT t_eq((SELECT form_code FROM gst_notices WHERE id = 'e9900000-0000-0000-0000-000000000003'), 'GSTR-3A', 'classified as GSTR-3A');
SELECT t_eq(sync_notice_details('99999999-0000-0000-0000-00000000000c',
  '[{"portal_key": "ZD-3A-1", "detail": {"gstr3a": {"retTyp": "3B", "ret_period": "042026", "orderId": "ZD-3A-1"}}}]'), 1, 'detail kept');
SELECT t_eq(sync_notice_details('99999999-0000-0000-0000-00000000000c',
  '[{"portal_key": "ZD-3A-1", "detail": {"gstr3a": {"retTyp": "3B", "ret_period": "042026", "orderId": "ZD-3A-1"}}}]'), 0, 'unchanged detail is not rewritten');
SELECT t_eq(notice_gstr3a_period('{"ret_period": "April, 2026"}'), '04/2026', 'a period in words reads');
SELECT t_eq(notice_gstr3a_period('{"ret_period": "Apr-Jun 2026"}') IS NULL, true, 'a quarter is left alone');
SELECT t_eq((SELECT stage FROM gst_notices WHERE id = 'e9900000-0000-0000-0000-000000000003'), 'new', 'open while the return is unfiled');
INSERT INTO filing_status (client_id, return_type, period_month, status, filed_date)
VALUES ('99999999-0000-0000-0000-00000000000c', 'GSTR-3B', '04/2026', 'Filed', ist_today());
SELECT t_eq((SELECT stage || '/' || close_reason FROM gst_notices WHERE id = 'e9900000-0000-0000-0000-000000000003'),
            'closed/auto:return_filed', 'filing the return closes it');

-- ── What the page reads ────────────────────────────────────────────────────
INSERT INTO sync_run_items (run_id, client_id, step, status, reason_class, message, created_at) VALUES
 (NULL, '99999999-0000-0000-0000-00000000000b', 'login', 'failed', 'login_failed', 'Invalid Username or Password. Please try again.', now());
SELECT t_eq((SELECT f ->> 'fix' FROM jsonb_array_elements(autopilot_status() -> 'failures') f WHERE f ->> 'reason' = 'login_failed'),
            'password', 'a rejected password is grouped as a password fix');
SELECT t_eq(autopilot_login_fix('Your account is locked. Reset the password using OTP.'), 'account_locked', 'a locked account');
SELECT t_eq(autopilot_login_fix('Login did not succeed after 3 automatic retries.'), 'captcha', 'three wrong CAPTCHAs');
SELECT t_eq((autopilot_status() -> 'freshness' ->> 'eligible')::int, 3, 'eligible: the three active clients with credentials');
SELECT t_eq((autopilot_status() -> 'freshness' ->> 'fresh')::int, 1, 'fresh: the one pulled an hour ago');
SELECT t_eq((SELECT count(*) FROM autopilot_metrics(14)), 14::bigint, 'fourteen days of acceptance numbers');
SELECT t_eq((SELECT captchas FROM autopilot_metrics(1)), 1, 'today counts the CAPTCHA typed');
SELECT t_eq((autopilot_ask_client('99999999-0000-0000-0000-00000000000b', 'password') ->> 'reason'), 'no_client_email', 'no e-mail on file');
SELECT t_eq((autopilot_ask_client('99999999-0000-0000-0000-00000000000a', 'account_locked') ->> 'sent')::boolean, false,
            'with the rule off, nothing is e-mailed');
SELECT t_eq((autopilot_badge() ->> 'live')::int, 0, 'the badge counts live CAPTCHAs');
ROLLBACK;
