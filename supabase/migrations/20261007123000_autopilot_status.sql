-- Notices Phase 3 · Portal Autopilot, part 4: what the Autopilot page and the
-- acceptance numbers read (follows parts 1–3, 20261007120000–122000).
--
-- autopilot_status() is the page: the agent, the queue, today's human time,
-- freshness and every client that needs a person, grouped by what fixes it.
-- autopilot_metrics(days) is the acceptance table, one row per IST day:
-- active GSTINs fresh (< 24 h) or with a named failure reason, minutes the
-- CAPTCHA wall was open, notices captured and how fast, and for short-clock
-- forms announced by a portal e-mail, how many were in the app within 4 hours.
-- autopilot_ask_client() is the one-click "ask the client" for a rejected
-- password or a locked portal account (alert E17, off until switched on).

-- ── Login failures, by what fixes them ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.autopilot_login_fix(p_message text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_message IS NULL OR btrim(p_message) = '' THEN 'other'
    WHEN p_message ~* 'no saved gst portal password' THEN 'no_password'
    WHEN p_message ~* '(lock|block|disabl|suspend|deactivat|frozen)' THEN 'account_locked'
    WHEN p_message ~* '(captcha|automatic retr)' THEN 'captcha'
    WHEN p_message ~* '(invalid|incorrect|wrong|mismatch|not match|does not exist)' THEN 'password'
    ELSE 'other' END
$$;

-- ── Ask the client (E17) ───────────────────────────────────────────────────
INSERT INTO public.email_templates (key, kind, name, step, subject, body, sort_order, is_active) VALUES
  ('client_portal_password', 'notice_alert', 'Client: portal password changed', NULL,
   'GST portal login · {{client_name}} ({{gstin}})',
   E'We could not log in to the GST portal for {{client_name}} (GSTIN {{gstin}}): the portal did not accept the saved password, so it may have been changed.\n\nPlease let us have the current password through your usual secure channel (a call to your contact at the firm is best). Please do not send the password by e-mail.\n\nWe use this access only to read notices and returns for you.',
   117, true),
  ('client_portal_locked', 'notice_alert', 'Client: portal account locked', NULL,
   'GST portal account locked · {{client_name}} ({{gstin}})',
   E'The GST portal shows the account of {{client_name}} (GSTIN {{gstin}}) as locked, so we cannot read your notices.\n\nPlease reset the password on the GST portal (Forgot Password; the OTP goes to your registered mobile and e-mail) and then let us have the new password through your usual secure channel. Please do not send the password by e-mail.',
   118, true)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.notice_alert_rules (alert_key, name, description, event_type, schedule, template_key, recipient,
                                       is_active, priority, quiet_hours, max_repeats, cooldown_hrs)
VALUES ('E17_client_portal_access', 'Client: portal access', 'Sent from the Autopilot page when the portal rejects the saved password or the account is locked',
        NULL, NULL, 'client_portal_password', 'client', false, 'normal', true, NULL, 72)
ON CONFLICT (alert_key) DO NOTHING;

-- notice_alert_enqueue as in 20261006123000_notice_email_links.sql, with E17 an e-mail
-- to the client (greeting and signature, no internal headline or button).
CREATE OR REPLACE FUNCTION public.notice_alert_enqueue(
  p_rule_key text, p_to_email text, p_to_name text, p_user_id uuid, p_vars jsonb, p_dedupe text,
  p_notice_id uuid DEFAULT NULL, p_client_id uuid DEFAULT NULL, p_event_id uuid DEFAULT NULL,
  p_critical boolean DEFAULT false, p_template_key text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode    text;
  v_base    text;
  v_rule    record;
  v_tpl_key text;
  v_tpl     record;
  v_client  boolean := p_rule_key IN ('E12_client_docs', 'E13_client_update', 'E17_client_portal_access');
  v_days    int;
  v_tone    text;
  v_raw     jsonb;
  v_body    jsonb;
  v_id      uuid;
BEGIN
  SELECT s.alerts_mode, s.app_base_url INTO v_mode, v_base FROM public.notice_settings s WHERE s.id;
  IF coalesce(v_mode, 'preview') = 'off' OR coalesce(btrim(p_to_email), '') = '' THEN RETURN false; END IF;
  SELECT r.id, r.is_active, r.template_key INTO v_rule FROM public.notice_alert_rules r WHERE r.alert_key = p_rule_key;
  IF v_rule.id IS NULL OR NOT v_rule.is_active THEN RETURN false; END IF;
  IF p_user_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.staff_notification_prefs np
        WHERE np.user_id = p_user_id AND np.channel = 'email' AND np.alert_kind = p_rule_key AND NOT np.enabled) THEN
    RETURN false;
  END IF;
  v_tpl_key := coalesce(p_template_key, v_rule.template_key);
  SELECT t.subject, t.body, t.is_active INTO v_tpl FROM public.email_templates t WHERE t.key = v_tpl_key;
  IF NOT FOUND OR v_tpl.is_active = false THEN RETURN false; END IF;

  v_raw := jsonb_build_object(
             'contact_person', coalesce(p_to_name, ''),
             'staff_name', CASE WHEN v_client THEN 'V. J. Desai & Co. (GST Team)' ELSE '' END,
             'firm_name', 'V. J. Desai & Co. LLP',
             'firm_email', 'gst@vjdesai.com')
           || coalesce(p_vars, '{}'::jsonb);

  -- Colour by days left: two days or less (or overdue) red, a week amber.
  v_days := CASE WHEN coalesce(v_raw ->> 'days_remaining', '') ~ '^-?\d+$' THEN (v_raw ->> 'days_remaining')::int END;
  v_tone := CASE WHEN v_days IS NOT NULL AND v_days <= 2 THEN 'urgent'
                 WHEN v_days IS NOT NULL AND v_days <= 7 THEN 'soon'
                 WHEN v_days IS NULL AND p_critical THEN 'urgent'
                 ELSE 'normal' END;

  v_raw := v_raw || jsonb_build_object(
    '_audience', CASE WHEN v_client THEN 'client' ELSE 'internal' END,
    'headline', CASE WHEN v_client THEN '' ELSE coalesce(nullif(v_raw ->> 'headline', ''),
      CASE p_rule_key
        WHEN 'E1_new_notice' THEN
          CASE WHEN v_raw ? 'notice_count' THEN (v_raw ->> 'notice_count') || ' new notices captured'
               ELSE 'New notice captured' END || coalesce(' · ' || nullif(v_raw ->> 'due_words', ''), '')
        WHEN 'E6_assigned' THEN 'Assigned to you' || coalesce(' · ' || nullif(v_raw ->> 'due_words', ''), '')
        WHEN 'E7_status_changed' THEN 'Stage changed' || coalesce(' · now ' || nullif(v_raw ->> 'stage', ''), '')
        WHEN 'E8_reply_logged' THEN 'Reply logged'
        WHEN 'E15_portal_update' THEN coalesce(nullif(v_raw ->> 'update_label', ''), 'Portal update') || ' on a case you own'
        WHEN 'E3_due_in_7' THEN 'Your notices for ' || coalesce(v_raw ->> 'report_date', 'today')
        WHEN 'E2_overdue_digest' THEN coalesce(v_raw ->> 'overdue_count', '') || ' overdue notices across the firm'
        WHEN 'E11_unassigned' THEN coalesce(v_raw ->> 'unassigned_count', '') || ' notices without an owner'
        WHEN 'E10_weekly_mis' THEN 'Weekly notices summary'
        WHEN 'E9_sync_anomaly' THEN 'The portal sync needs a look'
        ELSE '' END) END,
    'cta_url', CASE WHEN v_client THEN '' ELSE coalesce(
      nullif(v_raw ->> 'cta_url', ''), nullif(v_raw ->> 'notice_url', ''),
      substring(v_raw ->> 'link_html' from 'href="([^"]+)"'),
      CASE p_rule_key WHEN 'E9_sync_anomaly' THEN v_base || '/notices-company-list?status=failed'
                      WHEN 'E10_weekly_mis' THEN v_base || '/notices-dashboard' END, '') END,
    'cta_label', coalesce(
      nullif(v_raw ->> 'cta_label', ''),
      CASE WHEN v_raw ? 'notice_url' THEN 'Open notice' END,
      substring(v_raw ->> 'link_html' from '>([^<]+)</a>'),
      CASE p_rule_key WHEN 'E9_sync_anomaly' THEN 'Open the client list'
                      WHEN 'E10_weekly_mis' THEN 'Open the command centre' END,
      'Open GST Keeper'),
    '_tone', v_tone);

  SELECT jsonb_object_agg(k, CASE WHEN k LIKE '%\_html' THEN to_jsonb(v) ELSE to_jsonb(public.html_escape(v)) END)
    INTO v_body
    FROM jsonb_each_text(v_raw) AS e(k, v);
  v_body := v_body || jsonb_build_object('_shell', CASE v_tone WHEN 'urgent' THEN 'notice_alert_critical'
                                                               WHEN 'soon' THEN 'notice_alert_soon'
                                                               ELSE 'notice_alert' END);

  INSERT INTO public.email_outbox (to_email, kind, template_key, subject, body, render_vars, status,
                                   notice_id, client_id, dedupe_key)
  VALUES (lower(btrim(p_to_email)), 'notice_alert', v_tpl_key,
          left(regexp_replace(public.render_template(v_tpl.subject, v_raw), '\s+', ' ', 'g'), 250),
          public.render_template(v_tpl.body, v_body), v_body,
          CASE WHEN v_mode = 'live' THEN 'pending' ELSE 'preview' END,
          p_notice_id, p_client_id, p_dedupe)
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN false; END IF;

  INSERT INTO public.notice_alert_log (rule_id, notice_id, client_id, event_id, email_outbox_id, recipient_email, status, dedupe_key)
  VALUES (v_rule.id, p_notice_id, p_client_id, p_event_id, v_id, lower(btrim(p_to_email)),
          CASE WHEN v_mode = 'live' THEN 'queued' ELSE 'preview' END, p_dedupe);
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notice_alert_enqueue(text, text, text, uuid, jsonb, text, uuid, uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;

-- p_kind 'password' or 'account_locked'. Same answer shape as the document
-- requests: {sent, mode, to, reason}; reason no_client_email, or not_sent when
-- e-mails to clients are off.
CREATE OR REPLACE FUNCTION public.autopilot_ask_client(p_client_id uuid, p_kind text, p_actor_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c    record;
  v_mode text;
  v_sent boolean;
BEGIN
  IF p_kind NOT IN ('password', 'account_locked') THEN
    RAISE EXCEPTION 'autopilot_ask_client: unknown kind %', p_kind USING ERRCODE = '22023';
  END IF;
  SELECT c.id, c.name, c.gstin, c.email INTO v_c FROM public.clients c WHERE c.id = p_client_id;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'client % not found', p_client_id; END IF;
  IF coalesce(btrim(v_c.email), '') = '' THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no_client_email');
  END IF;
  SELECT s.alerts_mode INTO v_mode FROM public.notice_settings s WHERE s.id;
  v_sent := public.notice_alert_enqueue(
    'E17_client_portal_access', v_c.email, v_c.name, NULL,
    jsonb_build_object('client_name', v_c.name, 'gstin', coalesce(v_c.gstin, ''),
                       'staff_name', coalesce(nullif(btrim(p_actor_name), ''), 'V. J. Desai & Co. (GST Team)')),
    'E17:' || p_client_id || ':' || p_kind || ':' || to_char(clock_timestamp() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD'),
    NULL, p_client_id, NULL, false,
    CASE p_kind WHEN 'password' THEN 'client_portal_password' ELSE 'client_portal_locked' END);
  RETURN jsonb_build_object('sent', v_sent, 'mode', coalesce(v_mode, 'preview'), 'to', v_c.email,
                            'reason', CASE WHEN v_sent THEN NULL ELSE 'not_sent' END);
END;
$$;
GRANT EXECUTE ON FUNCTION public.autopilot_ask_client(uuid, text, text) TO anon, authenticated, service_role;

-- ── The Autopilot page ─────────────────────────────────────────────────────
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
    'agents', coalesce((
      SELECT jsonb_agg(jsonb_build_object('agent_id', h.agent_id, 'last_seen', h.last_seen,
                                          'online', h.last_seen > now() - interval '90 seconds', 'info', h.info)
                       ORDER BY h.last_seen DESC)
        FROM public.portal_agent_heartbeat h WHERE h.last_seen > now() - interval '30 days'), '[]'::jsonb),
    'wall', jsonb_build_object(
      'open', public.autopilot_wall_open(),
      'present', (SELECT coalesce(jsonb_agg(p.name ORDER BY p.name), '[]'::jsonb)
                    FROM public.autopilot_presence p WHERE p.last_seen > now() - interval '30 seconds')),
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

-- ── Acceptance, one row per IST day ────────────────────────────────────────
-- fresh: a notices pull succeeded in the 24 hours before the day's end (or
-- now). named: not fresh, but a login or notices attempt in those 24 hours
-- failed with a reason. Eligibility is today's client list. Notices captured
-- count new portal notices (issued at most 10 days before capture);
-- within_24h means captured before the end of the day after the issue date.
-- Short-clock forms (reply in 7 days or less) count when a portal e-mail
-- announced them: in the app within 4 hours of that e-mail.
CREATE OR REPLACE FUNCTION public.autopilot_metrics(p_days int DEFAULT 14)
RETURNS TABLE (day date, working boolean, eligible int, fresh int, named int, share numeric,
               wall_minutes numeric, captchas int, typing_minutes numeric, jobs_done int, jobs_failed int,
               notices_captured int, captured_within_24h int, capture_median_hours numeric,
               short_form_emails int, short_form_within_4h int, email_median_minutes numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
     WHERE coalesce(c.gst_user_id, '') <> '' AND NOT coalesce(c.inactive_at_hand, false)
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
$$;
GRANT EXECUTE ON FUNCTION public.autopilot_metrics(int) TO anon, authenticated, service_role;
