-- Notices Phase 1 · alert engine, fast event step
-- (follows 20261006115000_notice_alerts_engine.sql).
--
-- Found on the live project on 2026-10-06: the first sweep wrote 419 events
-- (333 auto-closures, 86 case due dates) and notice_alerts_run('events') hit
-- the API's statement timeout. Each event looked its notice up in
-- notice_facts, and a single-row lookup there costs the whole view (~65 ms:
-- the exposure window function stops the filter from being pushed down) —
-- even for "closed" events whose only rule (E7) has its template switched off.
-- Now:
--   * rules whose template is inactive are dropped before any event is read;
--   * an event's variables come from indexed lookups on the base tables
--     (notice_alert_notice_vars), with the same effective due / priority /
--     label definitions the canonical view uses;
--   * new-notice batches (E1) read the base tables too.
-- Behaviour is unchanged; supabase/tests/notices/test_70_alerts_speed.sql
-- runs a 1,500-event backlog under a 3-second statement timeout as anon.

-- One notice's alert variables (escaped later by notice_alert_enqueue).
CREATE OR REPLACE FUNCTION public.notice_alert_notice_vars(p_notice_id uuid, p_base_url text)
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'notice_id', g.id,
           'client_id', g.client_id,
           'owner', g.assign_to_user_id,
           'critical', coalesce(g.priority, r.default_priority) = 'High',
           'notice_type', coalesce(r.label, g.notice_type, 'Notice'),
           'client_name', c.name,
           'gstin', c.gstin,
           'reference_number', coalesce(g.reference_number, ''),
           'issue_date', public.fmt_ist_date(g.issue_date),
           'due_date', public.fmt_ist_date(e.eff),
           'days_remaining', coalesce((e.eff - public.ist_today())::text, ''),
           'priority', coalesce(g.priority, r.default_priority, ''),
           'hearing_date', public.fmt_ist_date(g.hearing_date),
           'issued_by', coalesce(g.issued_by, ''),
           'description', coalesce(g.description, ''),
           'reply_date', public.fmt_ist_date(g.reply_date),
           'reply_ref_number', coalesce(g.reply_ref_number, ''),
           'case_id', coalesce(g.case_id, ''),
           'staff_status', coalesce(g.staff_status, ''),
           'link_html', '<a href="' || p_base_url || '/notices-all?noticeId=' || g.id || '">Open this notice in GST Keeper</a>')
    FROM public.gst_notices g
    JOIN public.clients c ON c.id = g.client_id
    LEFT JOIN public.notice_form_rules r ON r.form_code = g.form_code AND r.is_active
    CROSS JOIN LATERAL (SELECT coalesce(g.extended_due_date, g.due_date,
                                        public.notice_computed_due(g.issue_date, g.case_id, g.form_code)) AS eff) e
   WHERE g.id = p_notice_id AND g.deleted_at IS NULL AND g.source = 'notices'
$$;
REVOKE EXECUTE ON FUNCTION public.notice_alert_notice_vars(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notice_alerts_process_events(p_limit int DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiet    boolean := coalesce(public.notice_alerts_in_quiet_hours(), false);
  v_settings record;
  v_rule     record;
  v_ev       record;
  v_r        record;
  v_b        record;
  v_queued   int := 0;
  v_done     int := 0;
  v_deferred int := 0;
  v_vars     jsonb;
  v_owner    uuid;
  v_link     text;
BEGIN
  SELECT * INTO v_settings FROM public.notice_settings WHERE id;

  DROP TABLE IF EXISTS pg_temp._alert_events;
  CREATE TEMP TABLE _alert_events ON COMMIT DROP AS
    SELECT e.id, e.notice_id, e.client_id, e.event_type, e.old_value, e.new_value, e.actor_id, e.actor_name, e.created_at
      FROM public.notice_events e WHERE false;
  WITH locked AS (
    SELECT e.id FROM public.notice_events e
     WHERE e.alert_processed_at IS NULL
     ORDER BY e.created_at, e.id
     LIMIT p_limit
       FOR UPDATE SKIP LOCKED
  )
  INSERT INTO _alert_events
  SELECT e.id, e.notice_id, e.client_id, e.event_type, e.old_value, e.new_value, e.actor_id, e.actor_name, e.created_at
    FROM public.notice_events e JOIN locked l ON l.id = e.id;

  -- Only rules that can actually write something: active, with an active template.
  DROP TABLE IF EXISTS pg_temp._alert_rules;
  CREATE TEMP TABLE _alert_rules ON COMMIT DROP AS
    SELECT r.id, r.alert_key, r.recipient, r.priority, r.quiet_hours,
           string_to_array(replace(r.event_type, ' ', ''), ',') AS events
      FROM public.notice_alert_rules r
      JOIN public.email_templates t ON t.key = r.template_key AND t.is_active
     WHERE r.is_active AND r.event_type IS NOT NULL;

  -- E1: new notices, one e-mail per client and recipient for this batch.
  SELECT * INTO v_rule FROM _alert_rules WHERE alert_key = 'E1_new_notice';
  IF v_rule.id IS NOT NULL AND (NOT v_quiet OR NOT v_rule.quiet_hours) THEN
    FOR v_b IN
      WITH cap AS (
        SELECT ev.id AS event_id, ev.actor_id, g.id, g.client_id, g.assign_to_user_id, g.reference_number,
               c.name AS client_name, c.gstin AS client_gstin,
               coalesce(fr.label, g.notice_type, 'Notice') AS label,
               g.issue_date, g.description, g.priority, fr.default_priority,
               coalesce(g.extended_due_date, g.due_date,
                        public.notice_computed_due(g.issue_date, g.case_id, g.form_code)) AS eff_due,
               NOT public.notice_is_closed(g.staff_status) AS is_open
          FROM _alert_events ev
          JOIN public.gst_notices g ON g.id = ev.notice_id AND g.deleted_at IS NULL AND g.source = 'notices'
          JOIN public.clients c ON c.id = g.client_id
          LEFT JOIN public.notice_form_rules fr ON fr.form_code = g.form_code AND fr.is_active
         WHERE ev.event_type = 'captured'
           AND (g.issue_date IS NULL
                OR g.issue_date >= (ev.created_at AT TIME ZONE 'Asia/Kolkata')::date - v_settings.new_notice_max_age_days
                OR (NOT public.notice_is_closed(g.staff_status)
                    AND coalesce(g.extended_due_date, g.due_date,
                                 public.notice_computed_due(g.issue_date, g.case_id, g.form_code)) >= public.ist_today()))
      ), routed AS (
        SELECT cap.*, rc.user_id AS to_user, rc.name AS to_name, rc.email AS to_email
          FROM cap
          CROSS JOIN LATERAL public.notice_alert_recipients(v_rule.recipient, cap.assign_to_user_id) rc
         WHERE rc.user_id IS DISTINCT FROM cap.actor_id
      )
      SELECT r.client_id, r.to_user, r.to_name, r.to_email,
             min(r.client_name) AS client_name, min(r.client_gstin) AS gstin,
             count(*) AS cnt,
             array_agg(r.event_id ORDER BY r.event_id) AS event_ids,
             (array_agg(r.id ORDER BY r.issue_date DESC NULLS LAST, r.id))[1] AS first_notice,
             bool_or(coalesce(r.priority, r.default_priority) = 'High') AS critical,
             string_agg('&bull; ' || public.html_escape(r.label)
                          || ' &mdash; ' || public.html_escape(coalesce(r.reference_number, 'no reference'))
                          || CASE WHEN r.eff_due IS NOT NULL
                                  THEN ' &mdash; due ' || public.fmt_ist_date(r.eff_due) ELSE '' END,
                        '<br>' ORDER BY r.eff_due NULLS LAST, r.issue_date DESC NULLS LAST) AS list_html
        FROM routed r
       GROUP BY r.client_id, r.to_user, r.to_name, r.to_email
    LOOP
      IF v_b.cnt = 1 THEN
        v_vars := public.notice_alert_notice_vars(v_b.first_notice, v_settings.app_base_url);
        CONTINUE WHEN v_vars IS NULL;
        IF public.notice_alert_enqueue('E1_new_notice', v_b.to_email, v_b.to_name, v_b.to_user, v_vars,
             'E1:' || md5(array_to_string(v_b.event_ids, ',')) || ':' || v_b.to_email,
             v_b.first_notice, v_b.client_id, v_b.event_ids[1], v_b.critical) THEN
          v_queued := v_queued + 1;
        END IF;
      ELSE
        v_link := v_settings.app_base_url || '/notices-all?client=' || v_b.client_id || '&filter=new';
        v_vars := jsonb_build_object(
          'notice_count', v_b.cnt, 'client_name', v_b.client_name, 'gstin', v_b.gstin,
          'notice_type', v_b.cnt || ' new notices', 'notice_list_html', v_b.list_html,
          'link_html', '<a href="' || v_link || '">Open these notices in GST Keeper</a>');
        IF public.notice_alert_enqueue('E1_new_notice', v_b.to_email, v_b.to_name, v_b.to_user, v_vars,
             'E1:' || md5(array_to_string(v_b.event_ids, ',')) || ':' || v_b.to_email,
             v_b.first_notice, v_b.client_id, v_b.event_ids[1], v_b.critical, 'notice_new_batch') THEN
          v_queued := v_queued + 1;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- One-to-one rules (E6, E7, E8, E15): only events some live rule listens for.
  FOR v_ev IN
    SELECT ev.*, r.alert_key, r.recipient, r.priority AS rule_priority, r.quiet_hours
      FROM _alert_events ev
      JOIN _alert_rules r ON ev.event_type = ANY (r.events) AND r.alert_key <> 'E1_new_notice'
     WHERE NOT (v_quiet AND r.quiet_hours)
       AND NOT (ev.event_type = 'assigned' AND (ev.new_value ->> 'assign_to_user_id') IS NULL)
     ORDER BY ev.created_at, ev.id
  LOOP
    v_vars := public.notice_alert_notice_vars(v_ev.notice_id, v_settings.app_base_url);
    CONTINUE WHEN v_vars IS NULL;
    v_owner := CASE WHEN v_ev.event_type = 'assigned' THEN (v_ev.new_value ->> 'assign_to_user_id')::uuid
                    ELSE (v_vars ->> 'owner')::uuid END;
    v_vars := v_vars || jsonb_build_object(
      'old_status', coalesce(v_ev.old_value ->> 'staff_status', ''),
      'new_status', coalesce(v_ev.new_value ->> 'staff_status', v_vars ->> 'staff_status', ''),
      'actor_name', coalesce(v_ev.actor_name, ''),
      'item_reference', coalesce(v_ev.new_value ->> 'reference_number', ''),
      'update_label', CASE v_ev.event_type WHEN 'order_received' THEN 'Order on the portal'
                                           WHEN 'notice_issued' THEN 'Notice on the portal'
                                           WHEN 'hearing_fixed' THEN 'Hearing fixed'
                                           ELSE initcap(replace(v_ev.event_type, '_', ' ')) END,
      'update_label_lower', CASE v_ev.event_type WHEN 'order_received' THEN 'order'
                                                 WHEN 'notice_issued' THEN 'notice'
                                                 WHEN 'hearing_fixed' THEN 'hearing date'
                                                 ELSE replace(v_ev.event_type, '_', ' ') END);
    FOR v_r IN SELECT * FROM public.notice_alert_recipients(v_ev.recipient, v_owner) LOOP
      CONTINUE WHEN v_r.user_id IS NOT DISTINCT FROM v_ev.actor_id;
      IF public.notice_alert_enqueue(v_ev.alert_key, v_r.email, v_r.name, v_r.user_id, v_vars,
           v_ev.alert_key || ':' || v_ev.id || ':' || v_r.email,
           v_ev.notice_id, v_ev.client_id, v_ev.id, v_ev.rule_priority = 'critical') THEN
        v_queued := v_queued + 1;
      END IF;
    END LOOP;
  END LOOP;

  -- Events a quiet-hours rule still waits on stay unprocessed; the rest are done.
  WITH waiting AS (
    SELECT DISTINCT ev.id
      FROM _alert_events ev
      JOIN _alert_rules r ON ev.event_type = ANY (r.events)
     WHERE v_quiet AND r.quiet_hours
       AND NOT (ev.event_type = 'assigned' AND (ev.new_value ->> 'assign_to_user_id') IS NULL)
  ), done AS (
    UPDATE public.notice_events e SET alert_processed_at = now()
      FROM _alert_events ev
     WHERE e.id = ev.id AND NOT EXISTS (SELECT 1 FROM waiting w WHERE w.id = ev.id)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM done), (SELECT count(*) FROM waiting) INTO v_done, v_deferred;

  -- E9: sync runs that held back a removal, read the wrong GSTIN, failed to save or stalled.
  SELECT * INTO v_rule FROM _alert_rules WHERE alert_key = 'E9_sync_anomaly';
  IF v_rule.id IS NULL THEN
    SELECT r.id, r.alert_key, r.recipient, r.priority, r.quiet_hours, NULL::text[] AS events INTO v_rule
      FROM public.notice_alert_rules r
      JOIN public.email_templates t ON t.key = r.template_key AND t.is_active
     WHERE r.alert_key = 'E9_sync_anomaly' AND r.is_active;
  END IF;
  IF v_rule.id IS NOT NULL AND (NOT v_quiet OR NOT v_rule.quiet_hours) THEN
    FOR v_ev IN
      SELECT i.*, c.name AS client_name, c.gstin
        FROM public.sync_run_items i JOIN public.clients c ON c.id = i.client_id
       WHERE i.alert_processed_at IS NULL AND i.status <> 'ok'
         AND (i.status = 'held' OR i.reason_class IN ('session_mismatch', 'save_failed', 'stalled'))
       ORDER BY i.created_at
       LIMIT 200
    LOOP
      v_vars := jsonb_build_object('client_name', v_ev.client_name, 'gstin', v_ev.gstin,
                  'notice_type', 'Sync ' || v_ev.step,
                  'anomaly_description', coalesce(v_ev.message, v_ev.reason_class, v_ev.status));
      FOR v_r IN SELECT * FROM public.notice_alert_recipients(v_rule.recipient, NULL) LOOP
        IF public.notice_alert_enqueue('E9_sync_anomaly', v_r.email, v_r.name, v_r.user_id, v_vars,
             'E9:' || v_ev.id || ':' || v_r.email, NULL, v_ev.client_id, NULL, true) THEN
          v_queued := v_queued + 1;
        END IF;
      END LOOP;
    END LOOP;
  END IF;
  UPDATE public.sync_run_items SET alert_processed_at = now()
   WHERE alert_processed_at IS NULL AND status <> 'ok'
     AND NOT (v_quiet AND EXISTS (SELECT 1 FROM public.notice_alert_rules r
                                   WHERE r.alert_key = 'E9_sync_anomaly' AND r.is_active AND r.quiet_hours));

  RETURN jsonb_build_object('queued', v_queued, 'events_processed', v_done, 'events_deferred', v_deferred,
                            'quiet_hours', v_quiet);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notice_alerts_process_events(int) FROM PUBLIC, anon, authenticated;
