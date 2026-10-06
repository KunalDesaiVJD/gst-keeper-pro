-- Notices · Scheduled syncs in the firm's own Chrome, no CAPTCHA wall (the firm's
-- decision of 2026-10-06; docs/PORTAL_AUTOPILOT_POSITIONS.md §1a).
--
-- The firm runs the scheduled portal syncs in its own Chrome, where a CAPTCHA extension
-- of the firm's choosing fills the portal's login CAPTCHA. GST Keeper extension 0.7.0
-- ("Run scheduled syncs in this Chrome") claims the queue's jobs one at a time as agent
-- 'chrome:<id>' and runs each exactly like a person's sync: it fills the user ID and
-- password, waits for the CAPTCHA box to be filled, logs in and reads the portal. Nothing
-- is relayed to the app (there is no CAPTCHA wall); a CAPTCHA not filled within
-- captcha_wait_secs fails that client with captcha_timeout, which the queue retries up to
-- max_attempts. The schedule is unchanged: 05:30 IST every client, 13:00 the priority
-- clients, each slot within 3 hours of its time (a Chrome opened later still runs it).
-- The office agent's portal runner stays available behind runner = 'office_agent' (set by
-- SQL); its notice reader and portal e-mail poller work in either mode.
--
-- Changes: autopilot_settings.runner (default 'chrome') and captcha_wait_secs;
-- autopilot_runner_kind(); autopilot_agent_online() counts only the runner the settings
-- name; portal_job_claim serves only that runner (Chrome: one job at a time, never a job
-- parked for a typed CAPTCHA); autopilot_heartbeat returns the runner, the CAPTCHA wait and
-- the schedule; autopilot_tick sends the 09:00 CAPTCHA nudge only for the office agent and
-- words the day's close for the Chrome; autopilot_status lists the runners;
-- autopilot_badge stays quiet without a wall.

ALTER TABLE public.autopilot_settings
  ADD COLUMN IF NOT EXISTS runner            text NOT NULL DEFAULT 'chrome',
  ADD COLUMN IF NOT EXISTS captcha_wait_secs int  NOT NULL DEFAULT 120;
ALTER TABLE public.autopilot_settings DROP CONSTRAINT IF EXISTS autopilot_settings_runner_check;
ALTER TABLE public.autopilot_settings ADD CONSTRAINT autopilot_settings_runner_check
  CHECK (runner IN ('chrome', 'office_agent'));
ALTER TABLE public.autopilot_settings DROP CONSTRAINT IF EXISTS autopilot_settings_captcha_wait_secs_check;
ALTER TABLE public.autopilot_settings ADD CONSTRAINT autopilot_settings_captcha_wait_secs_check
  CHECK (captcha_wait_secs BETWEEN 30 AND 900);
COMMENT ON COLUMN public.autopilot_settings.runner IS
  'Who runs the queue: chrome = GST Keeper extension 0.7.0 in the firm''s own Chrome (its CAPTCHA extension fills the CAPTCHA; no wall); office_agent = the Phase 3 office agent with the CAPTCHA wall.';
COMMENT ON COLUMN public.autopilot_settings.captcha_wait_secs IS
  'How long the Chrome runner waits for the CAPTCHA box to be filled before it fails the client with captcha_timeout (retried by the queue).';

CREATE OR REPLACE FUNCTION public.autopilot_runner_kind(p_agent text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p_agent LIKE 'chrome:%' THEN 'chrome' ELSE 'office_agent' END
$$;

-- Online = a runner of the kind the settings name beat within 150 seconds (a Chrome
-- alarm beats about once a minute). The office agent kept for reading notices or
-- polling portal e-mail does not count while the Chrome runs the queue.
CREATE OR REPLACE FUNCTION public.autopilot_agent_online()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portal_agent_heartbeat h
     WHERE h.last_seen > now() - interval '150 seconds'
       AND public.autopilot_runner_kind(h.agent_id)
           = coalesce((SELECT s.runner FROM public.autopilot_settings s WHERE s.id), 'chrome'))
$$;

-- Jobs parked for a typed CAPTCHA by the office agent have no wall to wait for once the
-- Chrome runs the queue: they go back to the queue (here, and on every tick below).
UPDATE public.portal_jobs
   SET status = 'queued', claimed_by = NULL, human_prompt = NULL, human_response = NULL, prompt_id = NULL, updated_at = now()
 WHERE status = 'waiting_captcha'
   AND coalesce((SELECT s.runner FROM public.autopilot_settings s WHERE s.id), 'chrome') = 'chrome';

-- ── Heartbeat: what the runner needs to know ───────────────────────────────
CREATE OR REPLACE FUNCTION public.autopilot_heartbeat(p_agent text, p_info jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_set public.autopilot_settings;
BEGIN
  INSERT INTO public.portal_agent_heartbeat (agent_id, last_seen, info)
  VALUES (p_agent, now(), coalesce(p_info, '{}'::jsonb))
  ON CONFLICT (agent_id) DO UPDATE SET last_seen = now(), info = EXCLUDED.info;
  SELECT * INTO v_set FROM public.autopilot_settings WHERE id;
  RETURN jsonb_build_object(
    'enabled', coalesce(v_set.enabled, false),
    'paused', coalesce(v_set.paused_until > now(), false),
    'paused_until', v_set.paused_until,
    'concurrency', coalesce(v_set.concurrency, 1),
    'keep_sessions', coalesce(v_set.keep_sessions, false),
    'email_trigger', coalesce(v_set.email_trigger, false),
    'captcha_refresh_secs', coalesce(v_set.captcha_refresh_secs, 150),
    'max_attempts', coalesce(v_set.max_attempts, 3),
    'wall_open', coalesce(v_set.runner, 'chrome') = 'office_agent' AND public.autopilot_wall_open(),
    'runner', coalesce(v_set.runner, 'chrome'),
    'serves', public.autopilot_runner_kind(p_agent) = coalesce(v_set.runner, 'chrome'),
    'captcha_wait_secs', coalesce(v_set.captcha_wait_secs, 120),
    'morning_at', v_set.morning_at,
    'afternoon_at', v_set.afternoon_at,
    'afternoon_scope', v_set.afternoon_scope,
    'schedule_enabled', coalesce(v_set.schedule_enabled, false),
    'server_time', now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.autopilot_heartbeat(text, jsonb) TO anon, authenticated, service_role;

-- ── Claim: only the named runner; Chrome one at a time, no wall ────────────
CREATE OR REPLACE FUNCTION public.portal_job_claim(p_agent text, p_wall_open boolean DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_set  public.autopilot_settings;
  v_wall boolean;
  v_busy int;
  v_id   uuid;
  v_job  public.portal_jobs;
BEGIN
  SELECT * INTO v_set FROM public.autopilot_settings WHERE id;
  IF NOT coalesce(v_set.enabled, false) OR coalesce(v_set.paused_until > now(), false) THEN RETURN NULL; END IF;
  -- Only the runner the settings name gets work: a Chrome runner ('chrome:<id>') or the office agent.
  IF public.autopilot_runner_kind(p_agent) <> coalesce(v_set.runner, 'chrome') THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_busy FROM public.portal_jobs
   WHERE claimed_by = p_agent AND status IN ('claimed', 'running', 'needs_human');
  -- A Chrome runner works one client at a time; there is no CAPTCHA wall for it, so a
  -- job parked for a typed CAPTCHA is never handed to it.
  IF v_busy >= (CASE WHEN coalesce(v_set.runner, 'chrome') = 'chrome' THEN 1 ELSE v_set.concurrency END) THEN RETURN NULL; END IF;
  v_wall := CASE WHEN coalesce(v_set.runner, 'chrome') = 'chrome' THEN false
                 ELSE coalesce(p_wall_open, public.autopilot_wall_open()) END;

  SELECT j.id INTO v_id
    FROM public.portal_jobs j
   WHERE j.job_type IN ('PULL_NOTICES_BUNDLE', 'FETCH_REPORT', 'LOGIN_TEST')
     AND ((j.status = 'queued' AND (j.not_before IS NULL OR j.not_before <= now()))
          OR (v_wall AND j.status = 'waiting_captcha'))
   ORDER BY j.priority DESC, j.created_at, j.queue_rank NULLS LAST, j.id
   LIMIT 1
     FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.portal_jobs
     SET status = 'claimed', claimed_by = p_agent, human_prompt = NULL, human_response = NULL, prompt_id = NULL,
         updated_at = now()
   WHERE id = v_id
  RETURNING * INTO v_job;
  RETURN to_jsonb(v_job)
         || (SELECT jsonb_build_object('client_name', c.name, 'gstin', c.gstin) FROM public.clients c WHERE c.id = v_job.client_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.portal_job_claim(text, boolean) TO anon, authenticated, service_role;

-- ── Badge: quiet without a wall ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.autopilot_badge()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Without a CAPTCHA wall (the Chrome runner) there is nothing for a person to type.
  SELECT jsonb_build_object(
    'live', CASE WHEN r.runner = 'office_agent' THEN count(j.id) FILTER (WHERE j.status = 'needs_human') ELSE 0 END,
    'waiting', CASE WHEN r.runner = 'office_agent' THEN count(j.id) FILTER (WHERE j.status = 'waiting_captcha') ELSE 0 END,
    'enabled', r.enabled,
    'runner', r.runner)
    FROM (SELECT coalesce(s.runner, 'chrome') AS runner, s.enabled FROM public.autopilot_settings s WHERE s.id) r
    LEFT JOIN public.portal_jobs j ON j.status IN ('needs_human', 'waiting_captcha')
   GROUP BY r.runner, r.enabled
$$;
GRANT EXECUTE ON FUNCTION public.autopilot_badge() TO anon, authenticated, service_role;

-- ── Tick: CAPTCHA nudge only for the office agent; the day's close wording ─
CREATE OR REPLACE FUNCTION public.autopilot_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_set   public.autopilot_settings;
  v_local timestamp := now() AT TIME ZONE 'Asia/Kolkata';
  v_day   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_t     time := (now() AT TIME ZONE 'Asia/Kolkata')::time;
  v_out   jsonb := '{}'::jsonb;
  v_res   jsonb;
  v_n     int;
  v_job   record;
  v_online boolean := public.autopilot_agent_online();
BEGIN
  SELECT * INTO v_set FROM public.autopilot_settings WHERE id;

  UPDATE public.portal_jobs j
     SET status = 'queued', claimed_by = NULL, human_prompt = NULL, human_response = NULL, prompt_id = NULL,
         updated_at = now()
   WHERE j.status IN ('claimed', 'running', 'needs_human')
     AND j.updated_at < now() - interval '3 minutes'
     AND NOT EXISTS (SELECT 1 FROM public.portal_agent_heartbeat h
                      WHERE h.agent_id = j.claimed_by AND h.last_seen > now() - interval '3 minutes');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_out := v_out || jsonb_build_object('released', v_n);

  -- No wall for the Chrome: a job parked for a typed CAPTCHA goes back to the queue.
  IF coalesce(v_set.runner, 'chrome') = 'chrome' THEN
    UPDATE public.portal_jobs
       SET status = 'queued', claimed_by = NULL, human_prompt = NULL, human_response = NULL, prompt_id = NULL, updated_at = now()
     WHERE status = 'waiting_captcha';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN v_out := v_out || jsonb_build_object('requeued_from_wall', v_n); END IF;
  END IF;

  IF NOT coalesce(v_set.enabled, false) THEN
    RETURN v_out || jsonb_build_object('enabled', false);
  END IF;

  IF v_set.schedule_enabled AND NOT coalesce(v_set.paused_until > now(), false) THEN
    IF (v_t - v_set.morning_at) BETWEEN interval '0' AND interval '3 hours'
       AND NOT EXISTS (SELECT 1 FROM public.autopilot_slot_runs WHERE slot = 'morning' AND ist_date = v_day) THEN
      v_res := public.autopilot_enqueue(NULL, 'PULL_NOTICES_BUNDLE', '{}'::jsonb, 'schedule_morning', NULL, NULL, 'Schedule', 'all');
      INSERT INTO public.autopilot_slot_runs (slot, ist_date, run_id, jobs, note)
      VALUES ('morning', v_day, (v_res ->> 'run_id')::uuid, coalesce((v_res ->> 'queued')::int, 0), v_res::text)
      ON CONFLICT DO NOTHING;
      v_out := v_out || jsonb_build_object('morning', v_res);
    END IF;
    IF v_set.afternoon_scope <> 'off'
       AND (v_t - v_set.afternoon_at) BETWEEN interval '0' AND interval '3 hours'
       AND NOT EXISTS (SELECT 1 FROM public.autopilot_slot_runs WHERE slot = 'afternoon' AND ist_date = v_day) THEN
      v_res := public.autopilot_enqueue(NULL, 'PULL_NOTICES_BUNDLE', '{}'::jsonb, 'schedule_afternoon', NULL, NULL, 'Schedule',
                                        v_set.afternoon_scope);
      INSERT INTO public.autopilot_slot_runs (slot, ist_date, run_id, jobs, note)
      VALUES ('afternoon', v_day, (v_res ->> 'run_id')::uuid, coalesce((v_res ->> 'queued')::int, 0), v_res::text)
      ON CONFLICT DO NOTHING;
      v_out := v_out || jsonb_build_object('afternoon', v_res);
    END IF;
  END IF;

  -- The 09:00 nudge is about CAPTCHAs waiting on the wall: the office agent only.
  IF coalesce(v_set.runner, 'chrome') = 'office_agent'
     AND (v_t - v_set.nudge_at) BETWEEN interval '0' AND interval '2 hours'
     AND NOT EXISTS (SELECT 1 FROM public.autopilot_slot_runs WHERE slot = 'nudge' AND ist_date = v_day) THEN
    SELECT count(*) INTO v_n FROM public.portal_jobs WHERE status IN ('waiting_captcha', 'needs_human');
    INSERT INTO public.autopilot_slot_runs (slot, ist_date, jobs, note)
    VALUES ('nudge', v_day, v_n,
            CASE WHEN v_n > 0 THEN 'e-mails queued: ' || public.autopilot_send_nudge(v_n) ELSE 'nobody waiting' END)
    ON CONFLICT DO NOTHING;
    v_out := v_out || jsonb_build_object('nudge', v_n);
  END IF;

  IF v_t >= v_set.close_at AND NOT EXISTS (SELECT 1 FROM public.autopilot_slot_runs WHERE slot = 'close' AND ist_date = v_day) THEN
    v_n := 0;
    FOR v_job IN
      SELECT id, status FROM public.portal_jobs
       WHERE status IN ('waiting_captcha', 'queued') AND created_at < now() - interval '1 hour'
    LOOP
      PERFORM public.portal_job_finish(v_job.id, NULL, 'failed',
        CASE WHEN v_job.status = 'waiting_captcha' THEN 'captcha_timeout'
             WHEN v_online THEN 'not_reached' ELSE 'agent_offline' END,
        CASE WHEN v_job.status = 'waiting_captcha' THEN 'Nobody typed the CAPTCHA for this client today.'
             WHEN coalesce(v_set.runner, 'chrome') = 'chrome' AND v_online THEN 'The scheduled Chrome did not reach this client today.'
             WHEN coalesce(v_set.runner, 'chrome') = 'chrome' THEN 'The scheduled Chrome was offline.'
             WHEN v_online THEN 'The agent did not reach this client today.'
             ELSE 'The office agent was offline.' END);
      v_n := v_n + 1;
    END LOOP;
    UPDATE public.sync_runs r SET status = 'done', finished_at = now()
     WHERE r.status = 'running' AND r.mode LIKE 'autopilot:%' AND r.started_at < now() - interval '1 hour'
       AND NOT EXISTS (SELECT 1 FROM public.portal_jobs j WHERE j.run_id = r.id
                         AND j.status IN ('queued', 'claimed', 'running', 'needs_human', 'waiting_captcha'));
    INSERT INTO public.autopilot_slot_runs (slot, ist_date, jobs, note) VALUES ('close', v_day, v_n, 'closed the day')
    ON CONFLICT DO NOTHING;
    v_out := v_out || jsonb_build_object('closed', v_n);
  END IF;

  DELETE FROM public.autopilot_presence WHERE last_seen < now() - interval '1 day';
  RETURN v_out || jsonb_build_object('at', v_local);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.autopilot_tick() FROM PUBLIC, anon, authenticated;

-- ── Status: the runners ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.autopilot_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz := ((now() AT TIME ZONE 'Asia/Kolkata')::date)::timestamp AT TIME ZONE 'Asia/Kolkata';
  v_day   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_set   public.autopilot_settings;
  v_out   jsonb;
BEGIN
  SELECT * INTO v_set FROM public.autopilot_settings WHERE id;

  WITH elig AS (
    SELECT c.id, c.name, c.gstin
      FROM public.clients c
     WHERE coalesce(c.gst_user_id, '') <> '' AND NOT coalesce(c.inactive_at_hand, false)
       AND NOT coalesce(c.notices_sync_excluded, false)
  ), st AS (
    SELECT s.client_id,
           max(s.last_success_at) FILTER (WHERE s.step = 'notices') AS last_ok,
           (array_agg(jsonb_build_object('step', s.step, 'reason', coalesce(s.last_reason_class, 'other'),
                                         'message', s.last_message, 'at', s.last_attempt_at)
                      ORDER BY s.last_attempt_at DESC NULLS LAST) FILTER (WHERE s.last_status = 'failed'))[1] AS last_fail,
           max(s.last_attempt_at) AS last_attempt
      FROM public.client_sync_status s
     WHERE s.step IN ('notices', 'login')
     GROUP BY s.client_id
  ), cl AS (
    SELECT e.id, e.name, e.gstin, st.last_ok, st.last_fail, st.last_attempt,
           coalesce(st.last_ok > now() - interval '24 hours', false) AS fresh,
           st.last_fail IS NOT NULL
             AND (st.last_ok IS NULL OR (st.last_fail ->> 'at')::timestamptz > st.last_ok) AS failing
      FROM elig e LEFT JOIN st ON st.client_id = e.id
  ), fails AS (
    SELECT cl.*, cl.last_fail ->> 'reason' AS reason,
           CASE WHEN cl.last_fail ->> 'reason' = 'login_failed'
                THEN public.autopilot_login_fix(cl.last_fail ->> 'message') END AS fix
      FROM cl WHERE cl.failing
  )
  SELECT jsonb_build_object(
    'freshness', jsonb_build_object(
      'eligible', (SELECT count(*) FROM cl),
      'fresh', (SELECT count(*) FROM cl WHERE fresh),
      'named', (SELECT count(*) FROM cl WHERE NOT fresh AND failing
                  AND (last_fail ->> 'at')::timestamptz > now() - interval '24 hours'),
      'never', (SELECT count(*) FROM cl WHERE last_attempt IS NULL),
      'stale', (SELECT count(*) FROM cl WHERE NOT fresh AND NOT failing AND last_attempt IS NOT NULL)),
    'failures', coalesce((
      SELECT jsonb_agg(g ORDER BY g ->> 'reason', g ->> 'fix')
        FROM (SELECT jsonb_build_object(
                       'reason', f.reason, 'fix', f.fix, 'count', count(*),
                       'clients', jsonb_agg(jsonb_build_object('client_id', f.id, 'name', f.name, 'gstin', f.gstin,
                                                               'message', f.last_fail ->> 'message',
                                                               'at', f.last_fail ->> 'at', 'last_ok', f.last_ok)
                                            ORDER BY f.name)) AS g
                FROM fails f GROUP BY f.reason, f.fix) x), '[]'::jsonb))
    INTO v_out;

  RETURN v_out || jsonb_build_object(
    'settings', (SELECT to_jsonb(s) FROM public.autopilot_settings s WHERE s.id),
    'agent_online', public.autopilot_agent_online(),
    'runner', coalesce(v_set.runner, 'chrome'),
    'captcha_wait_secs', coalesce(v_set.captcha_wait_secs, 120),
    'runners', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'agent_id', h.agent_id, 'kind', public.autopilot_runner_kind(h.agent_id),
               'label', coalesce(h.info ->> 'label', CASE WHEN h.agent_id LIKE 'chrome:%' THEN 'Chrome' ELSE h.agent_id END),
               'version', h.info ->> 'version', 'online', h.last_seen > now() - interval '150 seconds',
               'last_seen', h.last_seen, 'busy', coalesce((h.info ->> 'busy')::boolean, false),
               'client_name', h.info ->> 'client_name', 'step', h.info ->> 'step')
             ORDER BY h.last_seen DESC)
        FROM public.portal_agent_heartbeat h
       WHERE public.autopilot_runner_kind(h.agent_id) = coalesce(v_set.runner, 'chrome')
         AND h.last_seen > now() - interval '30 days'), '[]'::jsonb),
    'agents', coalesce((
      SELECT jsonb_agg(jsonb_build_object('agent_id', h.agent_id, 'last_seen', h.last_seen,
                                          'online', h.last_seen > now() - interval '90 seconds', 'info', h.info)
                       ORDER BY h.last_seen DESC)
        FROM public.portal_agent_heartbeat h WHERE h.last_seen > now() - interval '30 days'), '[]'::jsonb),
    'wall', jsonb_build_object(
      'open', coalesce(v_set.runner, 'chrome') = 'office_agent' AND public.autopilot_wall_open(),
      'present', (SELECT coalesce(jsonb_agg(p.name ORDER BY p.name), '[]'::jsonb)
                    FROM public.autopilot_presence p WHERE p.last_attentive > now() - interval '30 seconds')),
    'queue', (SELECT jsonb_build_object(
                'queued', count(*) FILTER (WHERE status = 'queued' AND (not_before IS NULL OR not_before <= now())),
                'retrying', count(*) FILTER (WHERE status = 'queued' AND not_before > now()),
                'waiting_captcha', count(*) FILTER (WHERE status = 'waiting_captcha'),
                'needs_human', count(*) FILTER (WHERE status = 'needs_human'),
                'running', count(*) FILTER (WHERE status IN ('claimed', 'running')))
                FROM public.portal_jobs
               WHERE status IN ('queued', 'waiting_captcha', 'needs_human', 'claimed', 'running')),
    'today', (SELECT jsonb_build_object(
                'succeeded', count(*) FILTER (WHERE status = 'succeeded' AND finished_at >= v_start),
                'failed', count(*) FILTER (WHERE status = 'failed' AND finished_at >= v_start),
                'cancelled', count(*) FILTER (WHERE status = 'cancelled' AND finished_at >= v_start),
                'captchas_typed', count(*) FILTER (WHERE captcha_answered_at >= v_start),
                'typing_minutes', round(coalesce(sum(captcha_typing_ms) FILTER (WHERE captcha_answered_at >= v_start), 0) / 60000.0, 1),
                'sessions_reused', count(*) FILTER (WHERE session_reused AND started_at >= v_start))
                FROM public.portal_jobs
               WHERE finished_at >= v_start OR captcha_answered_at >= v_start OR started_at >= v_start),
    'human', jsonb_build_object(
      'wall_minutes', (SELECT round(coalesce(sum(w.seconds), 0) / 60.0, 1) FROM public.autopilot_wall_minutes w WHERE w.ist_date = v_day),
      'people', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', coalesce(w.name, 'Someone'),
                                                             'minutes', round(w.seconds / 60.0, 1)) ORDER BY w.seconds DESC), '[]'::jsonb)
                   FROM public.autopilot_wall_minutes w WHERE w.ist_date = v_day)),
    'slots', (SELECT coalesce(jsonb_object_agg(r.slot, jsonb_build_object('fired_at', r.fired_at, 'jobs', r.jobs, 'run_id', r.run_id)), '{}'::jsonb)
                FROM public.autopilot_slot_runs r WHERE r.ist_date = v_day),
    'email', jsonb_build_object(
      'enabled', coalesce(v_set.email_trigger, false),
      'address', v_set.inbox_address,
      'last_poll_at', v_set.inbox_last_poll_at,
      'last_error', v_set.inbox_last_error,
      'today', (SELECT jsonb_build_object('received', count(*),
                                          'queued', count(*) FILTER (WHERE status IN ('queued', 'already_queued', 'synced')),
                                          'unmatched', count(*) FILTER (WHERE status = 'unmatched'))
                  FROM public.portal_emails WHERE received_at >= v_start)),
    'server_time', now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.autopilot_status() TO anon, authenticated, service_role;
