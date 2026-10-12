-- Notices · sync scope, what counts as failing, hiding one notice, and two
-- forms that need no urgent reply (the firm's requests of 12 October 2026):
--  1. "Some clients are inactive … but may be active for notice & litigation":
--     an inactive client (clients.inactive_at_hand) is still synced for notices.
--     Returns pulls still skip it. sync_queue, autopilot_enqueue (notices jobs
--     only), autopilot_status, autopilot_metrics and notices_command_centre no
--     longer leave it out. A client the firm does not handle stays out
--     (notices_handled / notices_sync_excluded).
--  2. "Agent offline status should not be displayed; only password or CAPTCHA
--     issues": failing counts only what staff can act on
--     (sync_reason_actionable: a refused login or password, a CAPTCHA). The
--     scheduled Chrome being offline, a portal hiccup or a client with no notices
--     on the portal is not a failing client.
--  3. "Superadmin / GST manager should be able to exclude an individual notice":
--     notice_exclude (one notice; gst_notices.excluded_scope = 'notice'), apart
--     from a whole case (notice_case_exclude, scope 'case'); only a case-wide
--     exclusion is carried to notices that arrive later.
--  4. "DRC-01B & DRC-01C are non priority in terms of response": reply optional,
--     priority Low.

CREATE OR REPLACE FUNCTION public.sync_reason_actionable(p_reason text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT p_reason IS NOT NULL AND (p_reason IN ('login_failed', 'captcha_failed', 'captcha_timeout', 'session_mismatch')
                                   OR p_reason LIKE '%password%')
$$;
COMMENT ON FUNCTION public.sync_reason_actionable(text) IS
  'A sync failure staff can act on: a refused login or password, a CAPTCHA, the wrong GSTIN in the session. Only these count as failing.';
GRANT EXECUTE ON FUNCTION public.sync_reason_actionable(text) TO anon, authenticated, service_role;

-- ── 3. One notice, or a whole case ──────────────────────────────────────────
ALTER TABLE public.gst_notices ADD COLUMN IF NOT EXISTS excluded_scope text;
DO $$ BEGIN
  ALTER TABLE public.gst_notices ADD CONSTRAINT gst_notices_excluded_scope_chk CHECK (excluded_scope IS NULL OR excluded_scope IN ('case', 'notice'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
UPDATE public.gst_notices SET excluded_scope = 'case' WHERE excluded_at IS NOT NULL AND excluded_scope IS NULL;

CREATE OR REPLACE FUNCTION public.notice_case_exclude(p_client_id uuid, p_case_key text, p_exclude boolean,
                                                      p_reason text, p_actor_id uuid, p_actor_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n int;
BEGIN
  IF NOT public.notice_case_admin(p_actor_id) THEN RETURN jsonb_build_object('error', 'Only a superadmin or GST manager can do this.'); END IF;
  UPDATE public.gst_notices g
     SET excluded_at = CASE WHEN p_exclude THEN now() END,
         excluded_by_name = CASE WHEN p_exclude THEN left(p_actor_name, 120) END,
         excluded_reason = CASE WHEN p_exclude THEN left(coalesce(nullif(btrim(p_reason), ''), 'Handled by another CA'), 300) END,
         excluded_scope = CASE WHEN p_exclude THEN 'case' END,
         edited_by_id = p_actor_id, edited_by_name = left(p_actor_name, 120), edited_at = now()
   WHERE g.id IN (SELECT public.notice_case_notice_ids(p_client_id, p_case_key));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('notices', v_n);
END;
$$;

CREATE OR REPLACE FUNCTION public.gst_notices_inherit_exclusion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v record;
BEGIN
  IF NEW.excluded_at IS NULL AND nullif(btrim(NEW.case_id), '') IS NOT NULL THEN
    SELECT g.excluded_at, g.excluded_by_name, g.excluded_reason INTO v
      FROM public.gst_notices g
     WHERE g.client_id = NEW.client_id AND g.case_id = NEW.case_id AND g.excluded_at IS NOT NULL AND g.deleted_at IS NULL
       AND coalesce(g.excluded_scope, 'case') = 'case'
     LIMIT 1;
    IF FOUND THEN
      NEW.excluded_at := now(); NEW.excluded_by_name := v.excluded_by_name; NEW.excluded_reason := v.excluded_reason; NEW.excluded_scope := 'case';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notice_exclude(p_notice_id uuid, p_exclude boolean, p_reason text, p_actor_id uuid, p_actor_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n int;
BEGIN
  IF NOT public.notice_case_admin(p_actor_id) THEN RETURN jsonb_build_object('error', 'Only a superadmin or GST manager can do this.'); END IF;
  UPDATE public.gst_notices
     SET excluded_at = CASE WHEN p_exclude THEN now() END,
         excluded_by_name = CASE WHEN p_exclude THEN left(p_actor_name, 120) END,
         excluded_reason = CASE WHEN p_exclude THEN left(coalesce(nullif(btrim(p_reason), ''), 'Not required'), 300) END,
         excluded_scope = CASE WHEN p_exclude THEN 'notice' END,
         edited_by_id = p_actor_id, edited_by_name = left(p_actor_name, 120), edited_at = now()
   WHERE id = p_notice_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('notices', v_n);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_exclude(uuid, boolean, text, uuid, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notice_cases_excluded()
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY x.excluded_at DESC), '[]'::jsonb)
    FROM (
      SELECT g.client_id, c.name AS client_name, c.gstin AS client_gstin,
             public.notice_case_key(g.client_id, g.case_id, public.notice_category(g.notice_type, g.description, r.category), g.id) AS case_key,
             max(g.excluded_at) AS excluded_at, max(g.excluded_by_name) AS excluded_by_name, max(g.excluded_reason) AS excluded_reason,
             count(*)::int AS notices, string_agg(DISTINCT coalesce(g.form_code, g.notice_type), ', ') AS forms,
             bool_and(coalesce(g.excluded_scope, 'case') = 'notice') AS single_notices,
             string_agg(DISTINCT g.reference_number, ', ') AS references
        FROM public.gst_notices g
        JOIN public.clients c ON c.id = g.client_id
        LEFT JOIN public.notice_form_rules r ON r.form_code = g.form_code AND r.is_active
       WHERE g.excluded_at IS NOT NULL AND g.deleted_at IS NULL
       GROUP BY 1, 2, 3, 4
    ) x
$$;

-- ── 4. DRC-01B and DRC-01C: reply optional, priority Low ────────────────────
UPDATE public.notice_type_settings SET response_need = 'optional', updated_at = now(), updated_by_name = 'Firm request 12 Oct 2026'
 WHERE form_code IN ('DRC-01B', 'DRC-01C');
UPDATE public.notice_form_rules SET default_priority = 'Low' WHERE form_code IN ('DRC-01B', 'DRC-01C');

-- ── 1 and 2. Sync scope and failing ─────────────────────────────────────────

-- sync_queue: as before, inactive clients synced for notices.
CREATE OR REPLACE FUNCTION public.sync_queue(p_client_ids uuid[] DEFAULT NULL)
RETURNS TABLE (client_id uuid, name text, gstin text, urgent_notices int, last_success_at timestamptz, queue_reason text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH eligible AS (
    SELECT c.id, c.name, c.gstin
      FROM public.clients c
     WHERE c.gst_user_id IS NOT NULL AND c.gst_user_id <> ''
       AND CASE WHEN p_client_ids IS NULL
                THEN NOT coalesce(c.notices_sync_excluded, false)
                ELSE c.id = ANY (p_client_ids) AND NOT coalesce(c.notices_sync_excluded, false) END
  ), urgent AS (
    SELECT f.client_id, count(*)::int AS n
      FROM public.notice_facts f
     WHERE f.is_overdue OR f.is_due_in_7
     GROUP BY f.client_id
  ), synced AS (
    SELECT s.client_id, max(s.last_success_at) AS last_success_at
      FROM public.client_sync_status s
     WHERE s.step = 'notices'
     GROUP BY s.client_id
  )
  SELECT e.id, e.name, e.gstin, coalesce(u.n, 0), y.last_success_at,
         CASE WHEN coalesce(u.n, 0) > 0 THEN 'due within 7 days'
              WHEN y.last_success_at IS NULL THEN 'never synced'
              ELSE 'stalest first' END
    FROM eligible e
    LEFT JOIN urgent u ON u.client_id = e.id
    LEFT JOIN synced y ON y.client_id = e.id
   ORDER BY (coalesce(u.n, 0) > 0) DESC, coalesce(u.n, 0) DESC,
            (y.last_success_at IS NULL) DESC, y.last_success_at ASC NULLS FIRST, e.name
$$;

-- autopilot_enqueue: as before, inactive clients synced for notices.
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
         count(*) FILTER (WHERE b.has_creds AND p_client_ids IS NULL AND b.inactive AND p_job_type <> 'PULL_NOTICES_BUNDLE'
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
       -- 20261014110000: an inactive client is still synced for notices (it may get them).
       AND NOT (p_client_ids IS NULL AND p_job_type <> 'PULL_NOTICES_BUNDLE' AND coalesce(c.inactive_at_hand, false))
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

-- autopilot_status: as before, inactive clients synced for notices.
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
     WHERE coalesce(c.gst_user_id, '') <> ''
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

-- autopilot_metrics: as before, inactive clients synced for notices.
CREATE OR REPLACE FUNCTION public.autopilot_metrics(p_days integer DEFAULT 14)
 RETURNS TABLE(day date, working boolean, eligible integer, fresh integer, named integer, share numeric, wall_minutes numeric, captchas integer, typing_minutes numeric, jobs_done integer, jobs_failed integer, notices_captured integer, captured_within_24h integer, capture_median_hours numeric, short_form_emails integer, short_form_within_4h integer, email_median_minutes numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH days AS (
    SELECT d::date AS day
      FROM generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - (least(greatest(coalesce(p_days, 14), 1), 92) - 1),
                           (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day') AS g(d)
  ), bounds AS (
    SELECT day, day::timestamp AT TIME ZONE 'Asia/Kolkata' AS d0,
           least((day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata', now()) AS d1,
           (day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' AS d2
      FROM days
  ), elig AS (
    SELECT c.id FROM public.clients c
     WHERE coalesce(c.gst_user_id, '') <> ''
       AND NOT coalesce(c.notices_sync_excluded, false)
  ), per_day AS (
    SELECT b.day, b.d0, b.d1, b.d2,
           (SELECT count(*) FROM elig)::int AS eligible,
           (SELECT count(DISTINCT i.client_id) FROM public.sync_run_items i
             WHERE i.step = 'notices' AND i.status IN ('ok', 'held')
               AND i.created_at > b.d1 - interval '24 hours' AND i.created_at <= b.d1
               AND i.client_id IN (SELECT id FROM elig))::int AS fresh,
           (SELECT count(DISTINCT i.client_id) FROM public.sync_run_items i
             WHERE i.step IN ('notices', 'login') AND i.status = 'failed' AND i.reason_class IS NOT NULL
               AND i.created_at > b.d1 - interval '24 hours' AND i.created_at <= b.d1
               AND i.client_id IN (SELECT id FROM elig)
               AND NOT EXISTS (SELECT 1 FROM public.sync_run_items k
                                WHERE k.client_id = i.client_id AND k.step = 'notices' AND k.status IN ('ok', 'held')
                                  AND k.created_at > b.d1 - interval '24 hours' AND k.created_at <= b.d1))::int AS named
      FROM bounds b
  )
  SELECT p.day,
         extract(isodow FROM p.day) <> 7,
         p.eligible, p.fresh, p.named,
         CASE WHEN p.eligible > 0 THEN round(100.0 * (p.fresh + p.named) / p.eligible, 1) END,
         (SELECT round(coalesce(sum(w.seconds), 0) / 60.0, 1) FROM public.autopilot_wall_minutes w WHERE w.ist_date = p.day),
         (SELECT count(*) FROM public.portal_jobs j WHERE j.captcha_answered_at >= p.d0 AND j.captcha_answered_at < p.d2)::int,
         (SELECT round(coalesce(sum(j.captcha_typing_ms), 0) / 60000.0, 1) FROM public.portal_jobs j
           WHERE j.captcha_answered_at >= p.d0 AND j.captcha_answered_at < p.d2),
         (SELECT count(*) FROM public.portal_jobs j WHERE j.status = 'succeeded' AND j.finished_at >= p.d0 AND j.finished_at < p.d2)::int,
         (SELECT count(*) FROM public.portal_jobs j WHERE j.status = 'failed' AND j.finished_at >= p.d0 AND j.finished_at < p.d2)::int,
         n.captured, n.within_24h, n.median_hours,
         e.short_n, e.short_4h, e.median_min
    FROM per_day p
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS captured,
             count(*) FILTER (WHERE g.first_seen_at < (g.issue_date + 2)::timestamp AT TIME ZONE 'Asia/Kolkata')::int AS within_24h,
             round((percentile_cont(0.5) WITHIN GROUP (
               ORDER BY extract(epoch FROM g.first_seen_at - g.issue_date::timestamp AT TIME ZONE 'Asia/Kolkata') / 3600.0))::numeric, 1) AS median_hours
        FROM public.gst_notices g
       WHERE g.first_seen_at >= p.d0 AND g.first_seen_at < p.d2
         AND coalesce(g.source, '') <> 'manual' AND coalesce(g.portal_key, '') NOT LIKE 'manual:%'
         AND g.issue_date IS NOT NULL
         AND g.issue_date >= (g.first_seen_at AT TIME ZONE 'Asia/Kolkata')::date - 10
         AND NOT public.notice_type_hidden(g.form_code)
    ) n ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE r.reply_days <= 7)::int AS short_n,
             count(*) FILTER (WHERE r.reply_days <= 7 AND em.notice_seen_at <= em.received_at + interval '4 hours')::int AS short_4h,
             round((percentile_cont(0.5) WITHIN GROUP (
               ORDER BY greatest(0, extract(epoch FROM em.notice_seen_at - em.received_at)) / 60.0))::numeric, 0) AS median_min
        FROM public.portal_emails em
        LEFT JOIN public.gst_notices gn ON gn.id = em.notice_id
        LEFT JOIN public.notice_form_rules r ON r.form_code = coalesce(gn.form_code, em.form_code)
       WHERE em.received_at >= p.d0 AND em.received_at < p.d2 AND em.client_id IS NOT NULL
    ) e ON true
   ORDER BY p.day DESC
$function$;

-- notices_command_centre: as before, inactive clients synced for notices.
CREATE OR REPLACE FUNCTION public.notices_command_centre(p_user_id uuid DEFAULT NULL::uuid, p_filters jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- fa / pa: every notice (the top nav and sync health); f / p: the notice types
  -- the dashboard shows (notice_type_settings.show_on_dashboard), which every
  -- other figure counts. A list opened from here filters the same way (dash=1).
  -- p_filters: the master filters (20261009110000): {"client", "fy", "owner",
  -- "form", "priority"}; every figure below counts only what they keep.
  WITH fa AS MATERIALIZED (SELECT n.* FROM public.notice_facts n
                            WHERE public.notice_master_match(p_filters, n.client_id, n.financial_year, n.assign_to_user_id, n.form_code, n.effective_priority)),
  f AS MATERIALIZED (SELECT * FROM fa WHERE fa.on_dashboard),
  pa AS MATERIALIZED (SELECT n.* FROM public.notice_plan n
                       WHERE public.notice_master_match(p_filters, n.client_id, n.financial_year, n.assign_to_user_id, n.form_code, n.effective_priority)),
  mx AS MATERIALIZED (SELECT m.* FROM public.litigation_matters m WHERE public.matter_master_match(p_filters, m.id)),
  p AS MATERIALIZED (SELECT * FROM pa WHERE pa.on_dashboard),
  today AS (SELECT public.ist_today() AS d),
  month_start AS (SELECT date_trunc('month', (SELECT d FROM today))::date AS m),
  eligible AS (
    SELECT c.id FROM public.clients c
     WHERE coalesce(c.gst_user_id, '') <> ''
       AND NOT coalesce(c.notices_sync_excluded, false)
  ),
  sync_state AS (
    SELECT e.id AS client_id,
           s.last_success_at, s.last_attempt_at, s.last_status, s.last_reason_class,
           l.last_status AS login_status, l.last_reason_class AS login_reason, l.last_attempt_at AS login_at,
           -- 20261010110000: the portal password (or user ID) was changed after
           -- every attempt so far: what failed before is no longer the client's
           -- state; it waits for its next sync ("not synced").
           (c.gst_password_changed_at IS NOT NULL
            AND c.gst_password_changed_at > coalesce(greatest(s.last_attempt_at, l.last_attempt_at), '-infinity')) AS pw_reset
      FROM eligible e
      JOIN public.clients c ON c.id = e.id
      LEFT JOIN public.client_sync_status s ON s.client_id = e.id AND s.step = 'notices'
      LEFT JOIN public.client_sync_status l ON l.client_id = e.id AND l.step = 'login'
  ),
  failing AS (
    SELECT client_id,
           CASE WHEN pw_reset THEN NULL
                -- 20261014110000: only what staff can act on is failing: a password or a CAPTCHA.
                WHEN login_status = 'failed' AND login_at >= coalesce(last_success_at, '-infinity')
                     AND public.sync_reason_actionable(login_reason) THEN login_reason
                WHEN last_status = 'failed' AND public.sync_reason_actionable(last_reason_class) THEN last_reason_class END AS reason
      FROM sync_state
  ),
  cal AS MATERIALIZED (
    SELECT c.* FROM public.notice_calendar((SELECT d FROM today), (SELECT d FROM today) + 13) c
     WHERE c.notice_id IN (SELECT f.id FROM f)
  ),
  exposure_rows AS (
    SELECT f.stage, f.exposure_amount AS amount, 'notice' AS kind
      FROM f WHERE f.is_open AND f.exposure_amount > 0
    UNION ALL
    SELECT m.stage,
           greatest(coalesce(m.demand_tax, 0) + coalesce(m.demand_interest, 0) + coalesce(m.demand_penalty, 0)
                    + coalesce(m.demand_cess, 0) - coalesce(m.paid_total, 0) - coalesce(m.pre_deposit_total, 0), 0),
           'matter'
      FROM mx m
     WHERE m.status <> 'Closed'
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'dashboard', jsonb_build_object(
      'hidden_types', (SELECT count(*) FROM public.notice_type_settings s WHERE NOT s.show_on_dashboard AND NOT s.hidden),
      'hidden_open', (SELECT count(*) FROM fa WHERE fa.is_open AND NOT fa.on_dashboard),
      'hidden_overdue', (SELECT count(*) FROM fa WHERE fa.is_overdue AND NOT fa.on_dashboard)),
    'today', (SELECT d FROM today),
    'tiles', jsonb_build_object(
      'open', (SELECT count(*) FROM f WHERE f.is_open),
      'overdue', jsonb_build_object(
        'count', (SELECT count(*) FROM f WHERE f.is_overdue),
        'amount', (SELECT coalesce(sum(coalesce(f.amount_of_demand, 0)), 0) FROM f WHERE f.is_overdue),
        'oldest_days', (SELECT max((SELECT d FROM today) - f.effective_due) FROM f WHERE f.is_overdue)),
      'due7', jsonb_build_object(
        'count', (SELECT count(*) FROM f WHERE f.is_due_in_7),
        'next_date', (SELECT min(f.effective_due) FROM f WHERE f.is_due_in_7),
        'next_client', (SELECT f.client_name FROM f WHERE f.is_due_in_7 ORDER BY f.effective_due, f.client_name LIMIT 1),
        'hearings', (SELECT count(*) FROM cal WHERE cal.kind = 'hearing' AND cal.day <= (SELECT d FROM today) + 7),
        'clocks', (SELECT count(*) FROM cal WHERE cal.kind IN ('appeal', 'attachment') AND cal.day <= (SELECT d FROM today) + 7)),
      'new', jsonb_build_object(
        'count', (SELECT count(*) FROM f WHERE f.is_new),
        'with_demand', (SELECT count(*) FROM f WHERE f.is_new AND coalesce(f.amount_of_demand, 0) > 0),
        'unassigned', (SELECT count(*) FROM f WHERE f.is_new AND f.is_unassigned)),
      'unassigned', (SELECT count(*) FROM f WHERE f.is_unassigned),
      'review', jsonb_build_object(
        'count', (SELECT count(*) FROM f WHERE f.is_open AND f.stage = 'partner_review'),
        'approved', (SELECT count(*) FROM p WHERE p.stage = 'partner_review' AND p.draft_status = 'approved')),
      'waiting_client', (SELECT count(*) FROM f WHERE f.is_open AND f.stage = 'waiting_client'),
      'exposure', jsonb_build_object(
        'total', (SELECT coalesce(sum(amount), 0) FROM exposure_rows),
        'notices', (SELECT count(*) FROM exposure_rows WHERE kind = 'notice'),
        'notices_amount', (SELECT coalesce(sum(amount), 0) FROM exposure_rows WHERE kind = 'notice'),
        'matters', (SELECT count(*) FROM exposure_rows WHERE kind = 'matter' AND amount > 0),
        'matters_amount', (SELECT coalesce(sum(amount), 0) FROM exposure_rows WHERE kind = 'matter'))),
    'nav', jsonb_build_object(
      'queue', (SELECT count(*) FROM pa WHERE pa.in_plan),
      'open', (SELECT count(*) FROM fa WHERE fa.is_open),
      'matters', (SELECT count(*) FROM mx m WHERE m.status <> 'Closed'),
      'hearings', (SELECT count(*) FROM public.notice_hearings_upcoming(NULL))),
    'plan_counts', jsonb_build_object(
      'team', (SELECT count(*) FROM p WHERE p.in_plan),
      'mine', (SELECT count(*) FROM p WHERE p.in_plan AND p_user_id IS NOT NULL AND p.assign_to_user_id = p_user_id),
      'unassigned', (SELECT count(*) FROM p WHERE p.in_plan AND p.assign_to_user_id IS NULL),
      'review', (SELECT count(*) FROM p WHERE p.in_plan AND p.next_action = 'review_draft')),
    'pipeline', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'stage', st.key, 'label', st.label, 'count', coalesce(x.n, 0),
               'median_days', x.median_days) ORDER BY st.ord), '[]'::jsonb)
        FROM public.notice_stages st
        LEFT JOIN (
          SELECT f.stage, count(*) AS n,
                 round((percentile_cont(0.5) WITHIN GROUP (ORDER BY f.days_in_stage))::numeric, 1) AS median_days
            FROM f WHERE f.is_open GROUP BY f.stage
        ) x ON x.stage = st.key
       WHERE NOT st.is_closed),
    'replies', jsonb_build_object(
      'this_month', (SELECT count(*) FROM f WHERE f.reply_date >= (SELECT m FROM month_start)),
      'median_days_this_month', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY f.reply_date - f.issue_date))::numeric, 1)
                                   FROM f WHERE f.reply_date >= (SELECT m FROM month_start) AND f.issue_date IS NOT NULL),
      'median_days_last_month', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY f.reply_date - f.issue_date))::numeric, 1)
                                   FROM f WHERE f.reply_date >= ((SELECT m FROM month_start) - interval '1 month')::date
                                            AND f.reply_date < (SELECT m FROM month_start) AND f.issue_date IS NOT NULL)),
    'health', jsonb_build_object(
      'eligible', (SELECT count(*) FROM eligible),
      'fresh', (SELECT count(*) FROM sync_state WHERE last_success_at > now() - interval '24 hours' AND NOT pw_reset),
      'never', (SELECT count(*) FROM sync_state WHERE (last_success_at IS NULL AND last_attempt_at IS NULL AND login_at IS NULL) OR pw_reset),
      'failing', (SELECT coalesce(jsonb_object_agg(reason, n), '{}'::jsonb)
                    FROM (SELECT reason, count(*) AS n FROM failing WHERE reason IS NOT NULL GROUP BY reason) r),
      'last_run', (SELECT jsonb_build_object('started_at', r.started_at, 'finished_at', r.finished_at, 'status', r.status,
                                             'clients_total', r.clients_total, 'clients_done', r.clients_done,
                                             'ext_version', r.ext_version)
                     FROM public.sync_runs r ORDER BY r.started_at DESC LIMIT 1),
      'last_success_at', (SELECT max(last_success_at) FROM sync_state),
      'new_today', (SELECT count(*) FROM fa WHERE (fa.first_seen_at AT TIME ZONE 'Asia/Kolkata')::date = (SELECT d FROM today)),
      'auto_closed_today', (SELECT count(*) FROM public.notice_events e
                             WHERE e.event_type = 'closed' AND e.actor_name = 'Closing sweep'
                               AND e.notice_id IN (SELECT fa.id FROM fa)
                               AND (e.created_at AT TIME ZONE 'Asia/Kolkata')::date = (SELECT d FROM today)),
      'ext_versions', (SELECT coalesce(jsonb_agg(DISTINCT i.ext_version), '[]'::jsonb) FROM public.sync_run_items i
                        WHERE i.created_at > now() - interval '7 days' AND i.ext_version IS NOT NULL),
      'alerts_mode', (SELECT s.alerts_mode FROM public.notice_settings s WHERE s.id),
      'alerts_today', (SELECT count(*) FROM public.email_outbox o
                        WHERE o.kind = 'notice_alert' AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date = (SELECT d FROM today))),
    'next14', (
      SELECT jsonb_agg(jsonb_build_object(
               'date', g.day,
               'reply', (SELECT count(*) FROM cal WHERE cal.day = g.day AND cal.kind = 'reply'),
               'hearing', (SELECT count(*) FROM cal WHERE cal.day = g.day AND cal.kind = 'hearing'),
               'clock', (SELECT count(*) FROM cal WHERE cal.day = g.day AND cal.kind IN ('appeal', 'attachment')),
               'total', (SELECT count(*) FROM cal WHERE cal.day = g.day)) ORDER BY g.day)
        FROM (SELECT ((SELECT d FROM today) + i) AS day FROM generate_series(0, 13) AS i) g),
    'exposure_by_stage', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('stage', st.key, 'label', st.label,
               'notices', coalesce(x.notices, 0), 'matters', coalesce(x.matters, 0),
               'total', coalesce(x.notices, 0) + coalesce(x.matters, 0)) ORDER BY st.ord), '[]'::jsonb)
        FROM public.notice_stages st
        JOIN (SELECT stage,
                     sum(amount) FILTER (WHERE kind = 'notice') AS notices,
                     sum(amount) FILTER (WHERE kind = 'matter') AS matters
                FROM exposure_rows GROUP BY stage) x ON x.stage = st.key
       WHERE coalesce(x.notices, 0) + coalesce(x.matters, 0) > 0),
    'clients', (
      SELECT coalesce(jsonb_agg(row_to_json(c) ORDER BY c.overdue DESC, c.exposure DESC, c.open DESC, c.name), '[]'::jsonb)
        FROM (
          SELECT f.client_id, f.client_name AS name, f.client_gstin AS gstin,
                 count(*) FILTER (WHERE f.is_open) AS open,
                 count(*) FILTER (WHERE f.is_overdue) AS overdue,
                 coalesce(sum(f.exposure_amount) FILTER (WHERE f.is_open), 0) AS exposure
            FROM f
           GROUP BY f.client_id, f.client_name, f.client_gstin
          HAVING count(*) FILTER (WHERE f.is_open) > 0
           ORDER BY count(*) FILTER (WHERE f.is_overdue) DESC,
                    coalesce(sum(f.exposure_amount) FILTER (WHERE f.is_open), 0) DESC,
                    count(*) FILTER (WHERE f.is_open) DESC, f.client_name
           LIMIT 8
        ) c)
  )
$function$;
