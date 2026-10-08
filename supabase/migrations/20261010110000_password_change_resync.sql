-- Notices · a changed portal password re-queues the client (the firm's request of
-- 8 October 2026: when the password is updated in Clients > Credentials, the
-- notices section should pick it up, "understand the sequence of timings of
-- updation of password" and show those clients as not synced instead of failing).
--
-- clients.gst_password_changed_at is stamped whenever the portal password or user
-- ID changes (Clients > Credentials, Edit Client, anywhere). A login or notices
-- failure recorded before that moment no longer counts as failing: the client
-- counts as not synced until its next sync, which logs in with the new password
-- (the extension reads it at login), and the password issue is cleared so every
-- sync includes it again. The command centre's health counts and the Clients list
-- (components/notices/clients/syncHealth.ts) apply the same rule.

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS gst_password_changed_at timestamptz;
COMMENT ON COLUMN public.clients.gst_password_changed_at IS
  'When the GST portal password or user ID last changed; failures before it no longer count as failing (Notices).';

CREATE OR REPLACE FUNCTION public.clients_notices_switches()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.notices_handled IS DISTINCT FROM OLD.notices_handled THEN
    NEW.notices_sync_excluded := NOT NEW.notices_handled;
  END IF;
  IF NEW.gst_password IS DISTINCT FROM OLD.gst_password OR NEW.gst_user_id IS DISTINCT FROM OLD.gst_user_id THEN
    NEW.gst_password_changed_at := clock_timestamp();
    NEW.portal_login_issue := NULL;
    NEW.portal_login_issue_message := NULL;
    NEW.portal_login_issue_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

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
     WHERE coalesce(c.gst_user_id, '') <> '' AND NOT coalesce(c.inactive_at_hand, false)
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
                WHEN login_status = 'failed' AND login_at >= coalesce(last_success_at, '-infinity') THEN login_reason
                WHEN last_status = 'failed' THEN last_reason_class END AS reason
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

GRANT EXECUTE ON FUNCTION public.notices_command_centre(uuid, jsonb) TO anon, authenticated, service_role;

-- One time: a client whose login failed and whose record was edited afterwards
-- (before the stamp existed, most likely its password being fixed) gets that edit
-- as its change time, so it is retried rather than left failing. If the password
-- is still wrong, the next sync records the failure again.
UPDATE public.clients c
   SET gst_password_changed_at = c.updated_at
  FROM public.client_sync_status l
 WHERE l.client_id = c.id AND l.step = 'login' AND l.last_status = 'failed'
   AND c.gst_password_changed_at IS NULL AND c.updated_at > l.last_attempt_at;

NOTIFY pgrst, 'reload schema';
