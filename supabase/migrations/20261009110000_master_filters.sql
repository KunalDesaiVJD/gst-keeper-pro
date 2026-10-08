-- Notices Phase 7 · master filters (the firm's request of 7 October 2026: "master
-- filters required to filter out anything", and year filters on litigation). The
-- module's pages share five filters, set once under its tabs: client, financial
-- year, owner, form and priority (src/lib/masterFilters.ts). The lists apply them
-- in the app; the command centre's one RPC takes them here, so every number on it
-- still equals the list it opens (which carries the same filters).
--
-- Requires 20261008180000_notice_types_hidden.sql (the RPC as it stands there).
-- Objects: notice_fy_key(), notice_master_match(), matter_master_match(),
-- notices_command_centre(uuid, jsonb) (replaces notices_command_centre(uuid)).

-- "2019-2020", "2019-20", "2019/20" → "2019-20".
CREATE OR REPLACE FUNCTION public.notice_fy_key(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE WHEN p ~ '\d{4}\s*[-–/]\s*\d{2,4}'
              THEN substring(p from '(\d{4})\s*[-–/]\s*\d{2,4}') || '-' || right(substring(p from '\d{4}\s*[-–/]\s*(\d{2,4})'), 2)
              ELSE nullif(btrim(p), '') END
$$;

-- A notice against the master filters. owner: a user id or "none"; fy and form:
-- a value or "none" (not stated).
CREATE OR REPLACE FUNCTION public.notice_master_match(
  p_filters jsonb, p_client uuid, p_fy text, p_owner uuid, p_form text, p_priority text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT p_filters IS NULL OR (
        (coalesce(p_filters ->> 'client', '') = '' OR p_client::text = p_filters ->> 'client')
    AND (coalesce(p_filters ->> 'fy', '') = ''
         OR (p_filters ->> 'fy' = 'none' AND public.notice_fy_key(p_fy) IS NULL)
         OR public.notice_fy_key(p_fy) = public.notice_fy_key(p_filters ->> 'fy'))
    AND (coalesce(p_filters ->> 'owner', '') = ''
         OR (p_filters ->> 'owner' = 'none' AND p_owner IS NULL)
         OR p_owner::text = p_filters ->> 'owner')
    AND (coalesce(p_filters ->> 'form', '') = ''
         OR (p_filters ->> 'form' = 'none' AND p_form IS NULL)
         OR p_form = p_filters ->> 'form')
    AND (coalesce(p_filters ->> 'priority', '') = '' OR p_priority = p_filters ->> 'priority'))
$$;

-- A matter: its client, owner and priority; any of its financial years; any of
-- its notices' forms.
CREATE OR REPLACE FUNCTION public.matter_master_match(p_filters jsonb, p_matter_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_filters IS NULL OR EXISTS (
    SELECT 1 FROM public.litigation_matters m
     WHERE m.id = p_matter_id
       AND (coalesce(p_filters ->> 'client', '') = '' OR m.client_id::text = p_filters ->> 'client')
       AND (coalesce(p_filters ->> 'owner', '') = ''
            OR (p_filters ->> 'owner' = 'none' AND m.owner_user_id IS NULL)
            OR m.owner_user_id::text = p_filters ->> 'owner')
       AND (coalesce(p_filters ->> 'priority', '') = '' OR m.priority = p_filters ->> 'priority')
       AND (coalesce(p_filters ->> 'fy', '') = ''
            OR (p_filters ->> 'fy' = 'none' AND coalesce(cardinality(m.financial_years), 0) = 0)
            OR EXISTS (SELECT 1 FROM unnest(m.financial_years) y WHERE public.notice_fy_key(y) = public.notice_fy_key(p_filters ->> 'fy')))
       AND (coalesce(p_filters ->> 'form', '') = ''
            OR EXISTS (SELECT 1 FROM public.notice_facts n WHERE n.matter_id = m.id
                         AND ((p_filters ->> 'form' = 'none' AND n.form_code IS NULL) OR n.form_code = p_filters ->> 'form'))))
$$;
GRANT EXECUTE ON FUNCTION public.notice_fy_key(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notice_master_match(jsonb, uuid, text, uuid, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.matter_master_match(jsonb, uuid) TO anon, authenticated, service_role;

-- The command centre, with the filters (otherwise as in 20261008180000).
DROP FUNCTION IF EXISTS public.notices_command_centre(uuid);
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
           l.last_status AS login_status, l.last_reason_class AS login_reason, l.last_attempt_at AS login_at
      FROM eligible e
      LEFT JOIN public.client_sync_status s ON s.client_id = e.id AND s.step = 'notices'
      LEFT JOIN public.client_sync_status l ON l.client_id = e.id AND l.step = 'login'
  ),
  failing AS (
    SELECT client_id,
           CASE WHEN login_status = 'failed' AND login_at >= coalesce(last_success_at, '-infinity') THEN login_reason
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
      'fresh', (SELECT count(*) FROM sync_state WHERE last_success_at > now() - interval '24 hours'),
      'never', (SELECT count(*) FROM sync_state WHERE last_success_at IS NULL AND last_attempt_at IS NULL AND login_at IS NULL),
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
