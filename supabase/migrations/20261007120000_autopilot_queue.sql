-- Notices Phase 3 · Portal Autopilot, part 1: the queue the office agent works from
-- (builds on 20260713170000_portal_agent.sql; read docs/PORTAL_AUTOPILOT_POSITIONS.md).
--
-- The schedule, the app and portal e-mails put jobs on public.portal_jobs. The
-- agent on the office PC claims them, drives the GST Keeper extension through
-- the portal in its own browser and finishes them here; the extension writes
-- the data through sync_ingest exactly as it does for a person. A login needs
-- a CAPTCHA typed by a person: the agent shows it on the CAPTCHA wall only
-- while somebody has the wall open, and otherwise parks the job as
-- waiting_captcha. Nothing is claimed until autopilot_settings.enabled is
-- switched on (it ships off); the schedule has its own switch.
--
-- Objects: autopilot_settings, autopilot_presence, autopilot_wall_minutes,
-- autopilot_slot_runs; portal_jobs gains priority, origin, run, CAPTCHA
-- timings and the status waiting_captcha; RPCs autopilot_enqueue,
-- portal_job_claim / _start / _park / _captcha / _answer / _finish / _cancel /
-- _retry, portal_jobs_release, autopilot_heartbeat, autopilot_wall_ping,
-- autopilot_badge, autopilot_tick (pg_cron, every 5 minutes) with the 09:00
-- nudge (alert E16, off like every alert until switched on).

-- ── Settings (one row) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.autopilot_settings (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled              boolean NOT NULL DEFAULT false,
  schedule_enabled     boolean NOT NULL DEFAULT true,
  paused_until         timestamptz,
  morning_at           time NOT NULL DEFAULT '05:30',
  afternoon_at         time NOT NULL DEFAULT '13:00',
  afternoon_scope      text NOT NULL DEFAULT 'priority' CHECK (afternoon_scope IN ('all', 'priority', 'off')),
  nudge_at             time NOT NULL DEFAULT '09:00',
  close_at             time NOT NULL DEFAULT '23:30',
  concurrency          int  NOT NULL DEFAULT 2 CHECK (concurrency BETWEEN 1 AND 4),
  keep_sessions        boolean NOT NULL DEFAULT false,
  email_trigger        boolean NOT NULL DEFAULT false,
  max_attempts         int  NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 6),
  captcha_refresh_secs int  NOT NULL DEFAULT 150 CHECK (captcha_refresh_secs BETWEEN 60 AND 900),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by_name      text
);
ALTER TABLE public.autopilot_settings ADD COLUMN IF NOT EXISTS close_at time NOT NULL DEFAULT '23:30';
INSERT INTO public.autopilot_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE public.autopilot_settings IS
  'Portal Autopilot switches. enabled is the kill switch: off, no job is claimed. Times are IST.';

CREATE OR REPLACE FUNCTION public.autopilot_settings_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS autopilot_settings_touch ON public.autopilot_settings;
CREATE TRIGGER autopilot_settings_touch BEFORE UPDATE ON public.autopilot_settings
  FOR EACH ROW EXECUTE FUNCTION public.autopilot_settings_touch();

-- ── Who has the CAPTCHA wall open, and for how long each day ───────────────
-- The wall pings every few seconds while it is open. A person is attentive
-- while the wall is on screen or they typed on it in the last 10 minutes
-- (the wall alerts them when a CAPTCHA comes in while they work elsewhere);
-- the agent fetches CAPTCHAs only while someone is attentive.
CREATE TABLE IF NOT EXISTS public.autopilot_presence (
  user_id        uuid PRIMARY KEY,
  name           text,
  last_seen      timestamptz NOT NULL DEFAULT now(),
  last_attentive timestamptz
);
ALTER TABLE public.autopilot_presence ADD COLUMN IF NOT EXISTS last_attentive timestamptz;
CREATE TABLE IF NOT EXISTS public.autopilot_wall_minutes (
  ist_date date NOT NULL,
  user_id  uuid NOT NULL,
  name     text,
  seconds  numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (ist_date, user_id)
);
-- One row per schedule slot and IST day, so a slot fires once.
CREATE TABLE IF NOT EXISTS public.autopilot_slot_runs (
  slot     text NOT NULL CHECK (slot IN ('morning', 'afternoon', 'nudge', 'close')),
  ist_date date NOT NULL,
  fired_at timestamptz NOT NULL DEFAULT now(),
  run_id   uuid,
  jobs     int NOT NULL DEFAULT 0,
  note     text,
  PRIMARY KEY (slot, ist_date)
);

ALTER TABLE public.autopilot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autopilot_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autopilot_wall_minutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autopilot_slot_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS autopilot_settings_all ON public.autopilot_settings;
CREATE POLICY autopilot_settings_all ON public.autopilot_settings FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS autopilot_presence_all ON public.autopilot_presence;
CREATE POLICY autopilot_presence_all ON public.autopilot_presence FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS autopilot_wall_minutes_all ON public.autopilot_wall_minutes;
CREATE POLICY autopilot_wall_minutes_all ON public.autopilot_wall_minutes FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS autopilot_slot_runs_all ON public.autopilot_slot_runs;
CREATE POLICY autopilot_slot_runs_all ON public.autopilot_slot_runs FOR ALL TO public USING (true) WITH CHECK (true);

-- ── The job queue ──────────────────────────────────────────────────────────
ALTER TABLE public.portal_jobs
  ADD COLUMN IF NOT EXISTS priority            int NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS queue_rank          int,
  ADD COLUMN IF NOT EXISTS active_key          text,
  ADD COLUMN IF NOT EXISTS not_before          timestamptz,
  ADD COLUMN IF NOT EXISTS reason_class        text,
  ADD COLUMN IF NOT EXISTS origin              text,
  ADD COLUMN IF NOT EXISTS run_id              uuid REFERENCES public.sync_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS started_at          timestamptz,
  ADD COLUMN IF NOT EXISTS prompt_id           uuid,
  ADD COLUMN IF NOT EXISTS captcha_shown_at    timestamptz,
  ADD COLUMN IF NOT EXISTS captcha_answered_at timestamptz,
  ADD COLUMN IF NOT EXISTS captcha_count       int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS captcha_wait_secs   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS captcha_typing_ms   int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS answered_by_name    text,
  ADD COLUMN IF NOT EXISTS session_reused      boolean,
  ADD COLUMN IF NOT EXISTS requested_by_name   text;
COMMENT ON COLUMN public.portal_jobs.active_key IS
  'Dedupe key while the job is active: PULL_NOTICES_BUNDLE, or FETCH_REPORT:<mode>:<periods>.';
COMMENT ON COLUMN public.portal_jobs.origin IS
  'schedule_morning | schedule_afternoon | manual | report | email';

ALTER TABLE public.portal_jobs DROP CONSTRAINT IF EXISTS portal_jobs_status_check;
ALTER TABLE public.portal_jobs ADD CONSTRAINT portal_jobs_status_check
  CHECK (status IN ('queued', 'claimed', 'running', 'needs_human', 'waiting_captcha', 'succeeded', 'failed', 'cancelled'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_jobs_active
  ON public.portal_jobs (client_id, active_key)
  WHERE active_key IS NOT NULL AND status IN ('queued', 'claimed', 'running', 'needs_human', 'waiting_captcha');
CREATE INDEX IF NOT EXISTS idx_portal_jobs_claim
  ON public.portal_jobs (priority DESC, created_at) WHERE status IN ('queued', 'waiting_captcha');
CREATE INDEX IF NOT EXISTS idx_portal_jobs_run ON public.portal_jobs (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_portal_jobs_finished ON public.portal_jobs (finished_at DESC) WHERE finished_at IS NOT NULL;

-- An autopilot run waits for people at the CAPTCHA wall for hours; only
-- extension runs are taken as abandoned after six (autopilot_tick closes
-- autopilot runs at the end of the day).
CREATE OR REPLACE FUNCTION public.sync_run_start(p_mode text, p_clients_total int DEFAULT NULL,
                                                 p_ext_version text DEFAULT NULL, p_machine text DEFAULT NULL)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- A run nobody finished within 6 hours is marked abandoned when the next one starts.
  WITH stale AS (
    UPDATE public.sync_runs SET status = 'abandoned', finished_at = coalesce(finished_at, now())
     WHERE status = 'running' AND started_at < now() - interval '6 hours'
       AND coalesce(mode, '') NOT LIKE 'autopilot:%'
  )
  INSERT INTO public.sync_runs (mode, clients_total, ext_version, machine)
  VALUES (p_mode, p_clients_total, p_ext_version, p_machine)
  RETURNING id
$$;

-- ── Small helpers ──────────────────────────────────────────────────────────
-- Extension modes the agent may run as a report. Pull-only; nothing files,
-- uploads or saves on the portal.
CREATE OR REPLACE FUNCTION public.autopilot_report_modes()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['notices_bundle', 'notices', 'refunds', 'refund_docs', 'drc03', 'taxpayerprofile', 'challans',
               'gstr3b_pull', 'gstr1_pull', 'gstr1_json_pull', 'gstr2a_pull', 'gstr2b_pull', 'gstr9_pull',
               'liabilityledger', 'cashledger', 'creditledgertxn', 'revrclm_pull', 'rcmliab_pull']
$$;
CREATE OR REPLACE FUNCTION public.autopilot_report_needs_period(p_mode text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_mode NOT IN ('notices_bundle', 'notices', 'refunds', 'refund_docs', 'drc03', 'taxpayerprofile', 'challans')
$$;
CREATE OR REPLACE FUNCTION public.autopilot_wall_open()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.autopilot_presence WHERE last_attentive > now() - interval '30 seconds')
$$;
CREATE OR REPLACE FUNCTION public.autopilot_agent_online()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.portal_agent_heartbeat WHERE last_seen > now() - interval '90 seconds')
$$;

-- ── Enqueue ────────────────────────────────────────────────────────────────
-- p_client_ids NULL = every client with saved credentials that is not marked
-- inactive (and, for notices, not excluded from the notices sync). p_scope
-- 'priority' keeps only clients with notices due within 7 days or overdue,
-- never synced, not synced for 20 hours, or failing. A client that already
-- has the same job active keeps it (its priority is raised if this one is
-- higher). Returns {queued, already, run_id, skipped: {...}, out_of_scope}.
CREATE OR REPLACE FUNCTION public.autopilot_enqueue(
  p_client_ids uuid[] DEFAULT NULL,
  p_job_type text DEFAULT 'PULL_NOTICES_BUNDLE',
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_origin text DEFAULT 'manual',
  p_priority int DEFAULT NULL,
  p_requested_by uuid DEFAULT NULL,
  p_requested_by_name text DEFAULT NULL,
  p_scope text DEFAULT 'all')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode    text := nullif(btrim(coalesce(p_payload ->> 'mode', '')), '');
  v_periods text[];
  v_payload jsonb;
  v_key     text;
  v_base    int;
  v_run     uuid;
  v_new     int := 0;
  v_dup     int := 0;
  v_nocreds int := 0;
  v_excl    int := 0;
  v_inact   int := 0;
  v_elig    int := 0;
  v_scoped  int := 0;
BEGIN
  IF p_job_type NOT IN ('PULL_NOTICES_BUNDLE', 'FETCH_REPORT', 'LOGIN_TEST') THEN
    RAISE EXCEPTION 'autopilot_enqueue: unknown job type %', p_job_type USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_scope, 'all') NOT IN ('all', 'priority') THEN
    RAISE EXCEPTION 'autopilot_enqueue: unknown scope %', p_scope USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(DISTINCT p ORDER BY p), '{}') INTO v_periods
    FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_payload -> 'periods') = 'array'
                                        THEN p_payload -> 'periods' ELSE '[]'::jsonb END) AS e(p)
   WHERE p ~ '^(0[1-9]|1[0-2])/20[0-9]{2}$';

  IF p_job_type = 'FETCH_REPORT' THEN
    IF v_mode IS NULL OR NOT v_mode = ANY (public.autopilot_report_modes()) THEN
      RAISE EXCEPTION 'autopilot_enqueue: unknown report %', coalesce(v_mode, '(none)') USING ERRCODE = '22023';
    END IF;
    IF public.autopilot_report_needs_period(v_mode) AND cardinality(v_periods) = 0 THEN
      RAISE EXCEPTION 'autopilot_enqueue: report % needs at least one period (MM/YYYY)', v_mode USING ERRCODE = '22023';
    END IF;
    IF NOT public.autopilot_report_needs_period(v_mode) THEN v_periods := '{}'; END IF;
    IF v_mode = 'gstr9_pull' AND EXISTS (SELECT 1 FROM unnest(v_periods) p WHERE p NOT LIKE '03/%') THEN
      RAISE EXCEPTION 'autopilot_enqueue: GSTR-9 periods are 03/YYYY (the year the FY ends)' USING ERRCODE = '22023';
    END IF;
    v_payload := jsonb_build_object('mode', v_mode, 'periods', to_jsonb(v_periods));
    v_key := 'FETCH_REPORT:' || v_mode || ':' || array_to_string(v_periods, ',');
  ELSIF p_job_type = 'PULL_NOTICES_BUNDLE' THEN
    v_payload := jsonb_build_object('mode', 'notices_bundle', 'periods', '[]'::jsonb);
    v_key := 'PULL_NOTICES_BUNDLE';
  ELSE
    v_payload := jsonb_build_object('mode', 'login', 'periods', '[]'::jsonb);
    v_key := 'LOGIN_TEST';
  END IF;

  v_base := coalesce(p_priority, CASE p_origin WHEN 'email' THEN 90 WHEN 'manual' THEN 70 WHEN 'report' THEN 60 ELSE 50 END);

  SELECT count(*) FILTER (WHERE NOT b.has_creds),
         count(*) FILTER (WHERE b.has_creds AND p_job_type = 'PULL_NOTICES_BUNDLE' AND b.excluded),
         count(*) FILTER (WHERE b.has_creds AND p_client_ids IS NULL AND b.inactive
                            AND NOT (p_job_type = 'PULL_NOTICES_BUNDLE' AND b.excluded))
    INTO v_nocreds, v_excl, v_inact
    FROM (SELECT coalesce(c.gst_user_id, '') <> '' AS has_creds,
                 coalesce(c.inactive_at_hand, false) AS inactive,
                 coalesce(c.notices_sync_excluded, false) AS excluded
            FROM public.clients c
           WHERE p_client_ids IS NULL OR c.id = ANY (p_client_ids)) b;

  INSERT INTO public.sync_runs (mode, machine, clients_total)
  VALUES ('autopilot:' || coalesce(p_origin, 'manual'), 'office agent', 0)
  RETURNING id INTO v_run;

  WITH elig AS (
    SELECT c.id
      FROM public.clients c
     WHERE (p_client_ids IS NULL OR c.id = ANY (p_client_ids))
       AND coalesce(c.gst_user_id, '') <> ''
       AND NOT (p_job_type = 'PULL_NOTICES_BUNDLE' AND coalesce(c.notices_sync_excluded, false))
       AND NOT (p_client_ids IS NULL AND coalesce(c.inactive_at_hand, false))
  ), urgent AS (
    SELECT f.client_id, count(*)::int AS n
      FROM public.notice_facts f
     WHERE (f.is_overdue OR f.is_due_in_7) AND f.client_id IN (SELECT id FROM elig)
     GROUP BY f.client_id
  ), st AS (
    SELECT s.client_id,
           max(s.last_success_at) FILTER (WHERE s.step = 'notices') AS last_ok,
           bool_or(s.last_status = 'failed') AS failing
      FROM public.client_sync_status s
     WHERE s.step IN ('notices', 'login') AND s.client_id IN (SELECT id FROM elig)
     GROUP BY s.client_id
  ), ranked AS (
    SELECT e.id AS client_id, coalesce(u.n, 0) AS urgent, st.last_ok, coalesce(st.failing, false) AS failing,
           row_number() OVER (ORDER BY (coalesce(u.n, 0) > 0) DESC, coalesce(u.n, 0) DESC,
                                       (st.last_ok IS NULL) DESC, st.last_ok ASC NULLS FIRST, e.id)::int AS rnk
      FROM elig e
      LEFT JOIN urgent u ON u.client_id = e.id
      LEFT JOIN st ON st.client_id = e.id
  ), scoped AS (
    SELECT r.*,
           least(100, v_base + CASE WHEN p_job_type <> 'PULL_NOTICES_BUNDLE' THEN 0
                                    WHEN r.urgent > 0 THEN 15
                                    WHEN r.last_ok IS NULL THEN 10
                                    ELSE 0 END) AS prio
      FROM ranked r
     WHERE coalesce(p_scope, 'all') = 'all'
        OR r.urgent > 0 OR r.last_ok IS NULL OR r.last_ok < now() - interval '20 hours' OR r.failing
  ), counted AS (
    SELECT (SELECT count(*) FROM elig)::int AS elig_n, (SELECT count(*) FROM scoped)::int AS scoped_n
  ), bumped AS (
    UPDATE public.portal_jobs j
       SET priority = s.prio,
           origin = CASE WHEN p_origin = 'email' THEN 'email' ELSE j.origin END,
           not_before = CASE WHEN p_origin IN ('email', 'manual') THEN NULL ELSE j.not_before END,
           updated_at = now()
      FROM scoped s
     WHERE j.client_id = s.client_id AND j.active_key = v_key
       AND j.status IN ('queued', 'claimed', 'running', 'needs_human', 'waiting_captcha')
       AND j.priority < s.prio
    RETURNING j.id
  ), ins AS (
    INSERT INTO public.portal_jobs (client_id, job_type, mode, status, payload, priority, queue_rank, active_key,
                                    origin, run_id, requested_by, requested_by_name)
    SELECT s.client_id, p_job_type, 'live', 'queued', v_payload, s.prio, s.rnk, v_key,
           coalesce(p_origin, 'manual'), v_run, p_requested_by, p_requested_by_name
      FROM scoped s
     WHERE NOT EXISTS (SELECT 1 FROM public.portal_jobs j
                        WHERE j.client_id = s.client_id AND j.active_key = v_key
                          AND j.status IN ('queued', 'claimed', 'running', 'needs_human', 'waiting_captcha'))
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT (SELECT count(*) FROM ins)::int, (SELECT elig_n FROM counted), (SELECT scoped_n FROM counted)
    INTO v_new, v_elig, v_scoped;
  v_dup := v_scoped - v_new;

  IF v_new = 0 THEN
    DELETE FROM public.sync_runs WHERE id = v_run;
    v_run := NULL;
  ELSE
    UPDATE public.sync_runs SET clients_total = v_new WHERE id = v_run;
  END IF;

  RETURN jsonb_build_object(
    'queued', v_new, 'already', v_dup, 'run_id', v_run, 'eligible', v_elig,
    'out_of_scope', v_elig - v_scoped,
    'skipped', jsonb_build_object('no_credentials', v_nocreds, 'excluded', v_excl, 'inactive', v_inact));
END;
$$;
GRANT EXECUTE ON FUNCTION public.autopilot_enqueue(uuid[], text, jsonb, text, int, uuid, text, text) TO anon, authenticated, service_role;

-- ── Agent side ─────────────────────────────────────────────────────────────
-- The agent reports every loop and gets its switches back.
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
    'wall_open', public.autopilot_wall_open(),
    'server_time', now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.autopilot_heartbeat(text, jsonb) TO anon, authenticated, service_role;

-- Jobs an agent held when it stopped (or restarted) go back to the queue.
CREATE OR REPLACE FUNCTION public.portal_jobs_release(p_agent text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  UPDATE public.portal_jobs
     SET status = 'queued', claimed_by = NULL, human_prompt = NULL, human_response = NULL, prompt_id = NULL,
         not_before = NULL, updated_at = now()
   WHERE claimed_by = p_agent AND status IN ('claimed', 'running', 'needs_human');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.portal_jobs_release(text) TO anon, authenticated, service_role;

-- One job, atomically: queued jobs whose backoff is over, and (while somebody
-- has the wall open) jobs parked for a CAPTCHA. Highest priority, oldest
-- first. NULL when switched off, paused, at the agent's concurrency, or empty.
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
  SELECT count(*) INTO v_busy FROM public.portal_jobs
   WHERE claimed_by = p_agent AND status IN ('claimed', 'running', 'needs_human');
  IF v_busy >= v_set.concurrency THEN RETURN NULL; END IF;
  v_wall := coalesce(p_wall_open, public.autopilot_wall_open());

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

CREATE OR REPLACE FUNCTION public.portal_job_start(p_job_id uuid, p_agent text, p_session_reused boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH u AS (
    UPDATE public.portal_jobs
       SET status = 'running', started_at = now(), session_reused = coalesce(p_session_reused, false), updated_at = now()
     WHERE id = p_job_id AND claimed_by = p_agent AND status IN ('claimed', 'running')
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM u)
$$;
GRANT EXECUTE ON FUNCTION public.portal_job_start(uuid, text, boolean) TO anon, authenticated, service_role;

-- Nobody at the wall: the job waits for a person without holding a browser.
CREATE OR REPLACE FUNCTION public.portal_job_park(p_job_id uuid, p_agent text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH u AS (
    UPDATE public.portal_jobs
       SET status = 'waiting_captcha', claimed_by = NULL, human_prompt = NULL, human_response = NULL,
           prompt_id = NULL, updated_at = now()
     WHERE id = p_job_id AND claimed_by = p_agent AND status IN ('claimed', 'running', 'needs_human')
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM u)
$$;
GRANT EXECUTE ON FUNCTION public.portal_job_park(uuid, text) TO anon, authenticated, service_role;

-- A live CAPTCHA for the wall. Returns the prompt id the answer must quote.
CREATE OR REPLACE FUNCTION public.portal_job_captcha(p_job_id uuid, p_agent text, p_image text, p_attempt int DEFAULT 1)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prompt uuid := gen_random_uuid();
BEGIN
  IF p_image IS NULL OR length(p_image) > 300000 OR p_image NOT LIKE 'data:image/%' THEN
    RAISE EXCEPTION 'portal_job_captcha: expected a data:image URL under 300 kB' USING ERRCODE = '22023';
  END IF;
  UPDATE public.portal_jobs
     SET status = 'needs_human', prompt_id = v_prompt,
         human_prompt = jsonb_build_object('kind', 'captcha', 'image', p_image, 'attempt', coalesce(p_attempt, 1),
                                           'shown_at', now()),
         human_response = NULL, captcha_shown_at = now(), captcha_count = captcha_count + 1, updated_at = now()
   WHERE id = p_job_id AND claimed_by = p_agent AND status IN ('claimed', 'running', 'needs_human');
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_prompt;
END;
$$;
GRANT EXECUTE ON FUNCTION public.portal_job_captcha(uuid, text, text, int) TO anon, authenticated, service_role;

-- From the wall: p_action 'answer' (the characters), 'refresh' (unreadable,
-- show another) or 'skip' (leave this client for today). 'ok', 'stale' (the
-- CAPTCHA was replaced or answered by someone else), 'empty' or 'gone'.
CREATE OR REPLACE FUNCTION public.portal_job_answer(p_job_id uuid, p_prompt_id uuid, p_text text DEFAULT NULL,
                                                    p_action text DEFAULT 'answer', p_typing_ms int DEFAULT NULL,
                                                    p_user_id uuid DEFAULT NULL, p_user_name text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.portal_jobs;
  v_action text := coalesce(p_action, 'answer');
BEGIN
  IF v_action NOT IN ('answer', 'refresh', 'skip') THEN
    RAISE EXCEPTION 'portal_job_answer: unknown action %', v_action USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_job FROM public.portal_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'gone'; END IF;
  IF v_job.status <> 'needs_human' OR v_job.prompt_id IS DISTINCT FROM p_prompt_id THEN RETURN 'stale'; END IF;
  IF v_action = 'answer' AND coalesce(btrim(p_text), '') = '' THEN RETURN 'empty'; END IF;

  UPDATE public.portal_jobs
     SET human_response = jsonb_build_object('action', v_action, 'prompt_id', p_prompt_id,
                                             'captcha', CASE WHEN v_action = 'answer' THEN regexp_replace(p_text, '\s', '', 'g') END,
                                             'by', p_user_name),
         human_prompt = NULL,
         status = 'running',
         captcha_answered_at = now(),
         captcha_wait_secs = captcha_wait_secs + greatest(0, extract(epoch FROM now() - coalesce(captcha_shown_at, now()))),
         captcha_typing_ms = captcha_typing_ms + least(greatest(coalesce(p_typing_ms, 0), 0), 120000),
         answered_by_name = coalesce(p_user_name, answered_by_name),
         updated_at = now()
   WHERE id = p_job_id;
  RETURN 'ok';
END;
$$;
GRANT EXECUTE ON FUNCTION public.portal_job_answer(uuid, uuid, text, text, int, uuid, text) TO anon, authenticated, service_role;

-- The end of an attempt. p_outcome: succeeded | failed | retry | cancelled.
-- A retry goes back on the queue after 5, 10, 20 … minutes until
-- max_attempts, then fails. A failure the extension could not record itself
-- (CAPTCHA never typed, agent error, skipped at the wall) is written to the
-- run ledger with its reason, so the client always shows a named reason.
CREATE OR REPLACE FUNCTION public.portal_job_finish(p_job_id uuid, p_agent text, p_outcome text,
                                                    p_reason_class text DEFAULT NULL, p_error text DEFAULT NULL,
                                                    p_result jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job      public.portal_jobs;
  v_max      int;
  v_attempts int;
  v_status   text;
  v_next     timestamptz;
BEGIN
  IF p_outcome NOT IN ('succeeded', 'failed', 'retry', 'cancelled') THEN
    RAISE EXCEPTION 'portal_job_finish: unknown outcome %', p_outcome USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_job FROM public.portal_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'gone'); END IF;
  IF v_job.status IN ('succeeded', 'failed', 'cancelled') THEN RETURN jsonb_build_object('status', v_job.status); END IF;
  IF p_agent IS NOT NULL AND v_job.claimed_by IS DISTINCT FROM p_agent THEN
    RETURN jsonb_build_object('status', 'not_yours');
  END IF;

  SELECT coalesce(max_attempts, 3) INTO v_max FROM public.autopilot_settings WHERE id;
  v_attempts := v_job.attempts + CASE WHEN p_outcome = 'cancelled' THEN 0 ELSE 1 END;
  v_status := CASE p_outcome WHEN 'succeeded' THEN 'succeeded'
                             WHEN 'cancelled' THEN 'cancelled'
                             WHEN 'retry' THEN CASE WHEN v_attempts < coalesce(v_max, 3) THEN 'queued' ELSE 'failed' END
                             ELSE 'failed' END;
  IF v_status = 'queued' THEN
    v_next := now() + make_interval(mins => (5 * power(2, greatest(v_attempts - 1, 0)))::int);
  END IF;

  UPDATE public.portal_jobs
     SET status = v_status,
         attempts = v_attempts,
         reason_class = CASE WHEN v_status = 'succeeded' THEN NULL ELSE coalesce(p_reason_class, reason_class) END,
         error = CASE WHEN v_status = 'succeeded' THEN NULL ELSE left(coalesce(p_error, error), 2000) END,
         result = coalesce(p_result, result),
         claimed_by = CASE WHEN v_status = 'queued' THEN NULL ELSE claimed_by END,
         not_before = v_next,
         finished_at = CASE WHEN v_status = 'queued' THEN NULL ELSE now() END,
         human_prompt = NULL, prompt_id = NULL,
         updated_at = now()
   WHERE id = p_job_id;

  IF v_status IN ('failed', 'cancelled') AND v_job.job_type = 'PULL_NOTICES_BUNDLE' AND v_job.run_id IS NOT NULL
     AND coalesce(p_reason_class, '') IN ('captcha_timeout', 'skipped_at_wall', 'agent_error', 'agent_offline', 'not_reached') THEN
    PERFORM public.sync_log_step(
      p_run_id => v_job.run_id, p_client_id => v_job.client_id,
      p_step => CASE WHEN p_reason_class IN ('captcha_timeout', 'skipped_at_wall') THEN 'login' ELSE 'notices' END,
      p_status => 'failed', p_reason_class => p_reason_class, p_message => p_error);
  END IF;

  IF v_status IN ('succeeded', 'failed', 'cancelled') AND v_job.run_id IS NOT NULL THEN
    UPDATE public.sync_runs r
       SET clients_done = (SELECT count(*) FROM public.portal_jobs j
                            WHERE j.run_id = r.id AND j.status IN ('succeeded', 'failed', 'cancelled'))
     WHERE r.id = v_job.run_id;
    IF NOT EXISTS (SELECT 1 FROM public.portal_jobs j
                    WHERE j.run_id = v_job.run_id
                      AND j.status IN ('queued', 'claimed', 'running', 'needs_human', 'waiting_captcha')) THEN
      UPDATE public.sync_runs SET status = 'done', finished_at = now()
       WHERE id = v_job.run_id AND status = 'running';
    END IF;
  END IF;

  RETURN jsonb_build_object('status', v_status, 'attempts', v_attempts, 'not_before', v_next);
END;
$$;
GRANT EXECUTE ON FUNCTION public.portal_job_finish(uuid, text, text, text, text, jsonb) TO anon, authenticated, service_role;

-- ── App side ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_job_cancel(p_job_id uuid, p_by_name text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.portal_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'gone'; END IF;
  IF v_status IN ('succeeded', 'failed', 'cancelled') THEN RETURN v_status; END IF;
  -- A job the agent is running is cancelled by the agent at its next check.
  PERFORM public.portal_job_finish(p_job_id, NULL, 'cancelled', 'cancelled',
                                   'Cancelled' || coalesce(' by ' || nullif(btrim(p_by_name), ''), '') || '.');
  RETURN 'cancelled';
END;
$$;
GRANT EXECUTE ON FUNCTION public.portal_job_cancel(uuid, text) TO anon, authenticated, service_role;

-- A failed or cancelled job, again now (same client and work).
CREATE OR REPLACE FUNCTION public.portal_job_retry(p_job_id uuid, p_by uuid DEFAULT NULL, p_by_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.portal_jobs;
BEGIN
  SELECT * INTO v_job FROM public.portal_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('queued', 0, 'error', 'gone'); END IF;
  RETURN public.autopilot_enqueue(ARRAY[v_job.client_id], v_job.job_type, v_job.payload,
                                  CASE WHEN v_job.job_type = 'FETCH_REPORT' THEN 'report' ELSE 'manual' END,
                                  NULL, p_by, p_by_name, 'all');
END;
$$;
GRANT EXECUTE ON FUNCTION public.portal_job_retry(uuid, uuid, text) TO anon, authenticated, service_role;

-- The wall polls this every few seconds while it is open: it marks the person
-- present (attentive: the wall is on screen or they typed on it in the last 10
-- minutes; only then does the agent open logins), counts attentive minutes,
-- and returns the live CAPTCHAs.
DROP FUNCTION IF EXISTS public.autopilot_wall_ping(uuid, text);
CREATE OR REPLACE FUNCTION public.autopilot_wall_ping(p_user_id uuid DEFAULT NULL, p_name text DEFAULT NULL,
                                                      p_attentive boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev  timestamptz;
  v_day   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_start timestamptz := ((now() AT TIME ZONE 'Asia/Kolkata')::date)::timestamp AT TIME ZONE 'Asia/Kolkata';
BEGIN
  IF p_user_id IS NOT NULL THEN
    SELECT last_attentive INTO v_prev FROM public.autopilot_presence WHERE user_id = p_user_id;
    INSERT INTO public.autopilot_presence (user_id, name, last_seen, last_attentive)
    VALUES (p_user_id, nullif(btrim(p_name), ''), now(), CASE WHEN coalesce(p_attentive, true) THEN now() END)
    ON CONFLICT (user_id) DO UPDATE
      SET last_seen = now(), name = coalesce(EXCLUDED.name, public.autopilot_presence.name),
          last_attentive = CASE WHEN coalesce(p_attentive, true) THEN now() ELSE public.autopilot_presence.last_attentive END;
    IF coalesce(p_attentive, true) AND v_prev IS NOT NULL AND v_prev > now() - interval '60 seconds' THEN
      INSERT INTO public.autopilot_wall_minutes (ist_date, user_id, name, seconds)
      VALUES (v_day, p_user_id, nullif(btrim(p_name), ''), extract(epoch FROM now() - v_prev))
      ON CONFLICT (ist_date, user_id)
      DO UPDATE SET seconds = public.autopilot_wall_minutes.seconds + EXCLUDED.seconds,
                    name = coalesce(EXCLUDED.name, public.autopilot_wall_minutes.name);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'captchas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'job_id', j.id, 'prompt_id', j.prompt_id, 'client_id', j.client_id, 'client_name', c.name,
               'gstin', c.gstin, 'image', j.human_prompt ->> 'image',
               'attempt', coalesce((j.human_prompt ->> 'attempt')::int, 1), 'shown_at', j.captcha_shown_at,
               'origin', j.origin, 'job_type', j.job_type, 'report', j.payload ->> 'mode')
             ORDER BY j.priority DESC, j.captcha_shown_at, j.id)
        FROM public.portal_jobs j JOIN public.clients c ON c.id = j.client_id
       WHERE j.status = 'needs_human' AND j.prompt_id IS NOT NULL AND j.human_prompt ? 'image'), '[]'::jsonb),
    'waiting', (SELECT count(*) FROM public.portal_jobs WHERE status = 'waiting_captcha'),
    'queued', (SELECT count(*) FROM public.portal_jobs WHERE status = 'queued'),
    'running', (SELECT count(*) FROM public.portal_jobs WHERE status IN ('claimed', 'running')),
    'typed_today', (SELECT count(*) FROM public.portal_jobs WHERE captcha_answered_at >= v_start),
    'done_today', (SELECT count(*) FROM public.portal_jobs WHERE status = 'succeeded' AND finished_at >= v_start),
    'agent_online', public.autopilot_agent_online(),
    'enabled', (SELECT s.enabled AND NOT coalesce(s.paused_until > now(), false) FROM public.autopilot_settings s WHERE s.id),
    'present', (SELECT coalesce(jsonb_agg(p.name ORDER BY p.name), '[]'::jsonb) FROM public.autopilot_presence p
                 WHERE p.last_attentive > now() - interval '30 seconds'));
END;
$$;
GRANT EXECUTE ON FUNCTION public.autopilot_wall_ping(uuid, text, boolean) TO anon, authenticated, service_role;

-- The header badge: how many clients wait for a person. No presence.
CREATE OR REPLACE FUNCTION public.autopilot_badge()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'live', count(*) FILTER (WHERE status = 'needs_human'),
    'waiting', count(*) FILTER (WHERE status = 'waiting_captcha'),
    'enabled', (SELECT s.enabled FROM public.autopilot_settings s WHERE s.id))
    FROM public.portal_jobs
   WHERE status IN ('needs_human', 'waiting_captcha')
$$;
GRANT EXECUTE ON FUNCTION public.autopilot_badge() TO anon, authenticated, service_role;

-- ── The 09:00 nudge (E16; off until the rule is switched on) ───────────────
INSERT INTO public.email_templates (key, kind, name, step, subject, body, sort_order, is_active) VALUES
  ('notice_captcha_waiting', 'notice_alert', 'CAPTCHAs Waiting', NULL,
   '{{waiting_count}} clients are waiting for a CAPTCHA',
   E'The portal autopilot has {{waiting_count}} clients waiting for a CAPTCHA. Open the CAPTCHA wall and type them; the agent logs each client in and reads the portal while you type the next.\n\n{{link_html}}',
   116, true)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.notice_alert_rules (alert_key, name, description, event_type, schedule, template_key, recipient,
                                       is_active, priority, quiet_hours, max_repeats, cooldown_hrs)
VALUES ('E16_captcha_waiting', 'CAPTCHAs waiting', 'Morning nudge (09:00 IST) when clients are waiting for a CAPTCHA on the autopilot wall',
        NULL, NULL, 'notice_captcha_waiting', 'team', false, 'normal', false, 1, 24)
ON CONFLICT (alert_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.autopilot_send_nudge(p_waiting int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base text;
  v_r    record;
  v_n    int := 0;
  v_day  text := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD');
BEGIN
  SELECT app_base_url INTO v_base FROM public.notice_settings WHERE id;
  FOR v_r IN SELECT * FROM public.notice_alert_recipients('team', NULL) LOOP
    IF public.notice_alert_enqueue('E16_captcha_waiting', v_r.email, v_r.name, v_r.user_id,
         jsonb_build_object('waiting_count', p_waiting,
                            'headline', p_waiting || ' clients are waiting for a CAPTCHA',
                            'cta_url', coalesce(v_base, '') || '/notices-autopilot',
                            'cta_label', 'Open the CAPTCHA wall',
                            'link_html', '<a href="' || coalesce(v_base, '') || '/notices-autopilot">Open the CAPTCHA wall</a>'),
         'E16:' || v_day || ':' || lower(v_r.email)) THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.autopilot_send_nudge(int) FROM PUBLIC, anon, authenticated;

-- ── The clock (pg_cron, every 5 minutes) ───────────────────────────────────
-- Releases jobs of an agent that stopped reporting; fires the morning and
-- afternoon runs and the 09:00 nudge once per IST day; from close_at (23:30 IST) closes
-- the day: whatever still waits gets its named reason (CAPTCHA never typed,
-- agent offline, not reached) and the day's autopilot runs are closed.
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

  IF (v_t - v_set.nudge_at) BETWEEN interval '0' AND interval '2 hours'
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autopilot-tick') THEN
    PERFORM cron.unschedule('autopilot-tick');
  END IF;
  PERFORM cron.schedule('autopilot-tick', '*/5 * * * *', $cmd$select public.autopilot_tick()$cmd$);
END $$;
