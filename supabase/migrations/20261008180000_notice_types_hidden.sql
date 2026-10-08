-- Notices · a notice type hidden everywhere (the firm's request of 7 October 2026:
-- "do not show this notice anywhere in any client and keep always considered as non
-- priority to respond", for GSTR-3A, the notice to a return defaulter under s.46).
--
-- notice_type_settings gains `hidden`. A hidden type:
--   * is in no list, tile, plan, calendar, search, report, digest or e-mail: notice_facts
--     leaves it out, and everything the app and the alerts read is built on notice_facts
--     (plan, exposure, calendar, command centre, daily and weekly alerts, document
--     reminders, due coverage, the Reply Factory). The few readers of gst_notices that
--     show or count something learn the same rule here: search (notices_search), the
--     command centre's "auto-closed today" and "types off the dashboard", the
--     autopilot's capture metrics and the background evidence build;
--   * needs no reply and is off the dashboard (a CHECK keeps it so), so its reply
--     options are withdrawn, the notice reader skips it and it is never overdue;
--   * raises no e-mail: an event on a hidden notice is written already handled
--     (alert_processed_at), and hiding a type marks its waiting events the same way.
-- Its notices are still synced and kept (a GSTR-3A still closes itself when the return
-- is filed), so showing the type again brings every one of them back as it is.
-- A superadmin or GST manager hides or shows a type under Notice types ("Where it
-- shows": dashboard and lists / lists only / hidden everywhere); GSTR-3A starts hidden.

-- ── The setting ────────────────────────────────────────────────────────────
ALTER TABLE public.notice_type_settings ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE public.notice_type_settings ADD CONSTRAINT notice_type_settings_hidden_quiet
    CHECK (NOT hidden OR (response_need = 'none' AND NOT show_on_dashboard));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.notice_type_settings.hidden IS
  'Hidden everywhere: its notices are in no list, count, report or e-mail (notice_facts leaves them out); it then needs no reply and is off the dashboard.';
COMMENT ON TABLE public.notice_type_settings IS
  'Per notice type (form code): whether it needs a reply (critical / optional / none), whether the command centre shows it, and whether it is hidden everywhere. A type without a row is critical, shown and not hidden.';

CREATE OR REPLACE FUNCTION public.notice_type_hidden(p_form_code text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT coalesce((SELECT s.hidden FROM public.notice_type_settings s WHERE s.form_code = p_form_code), false)
$$;
GRANT EXECUTE ON FUNCTION public.notice_type_hidden(text) TO anon, authenticated, service_role;

-- ── Overview for the settings screen (hidden appended) ─────────────────────
CREATE OR REPLACE VIEW public.notice_type_overview WITH (security_invoker = true) AS
SELECT r.form_code, r.label, r.category, r.is_active, r.match_order,
       coalesce(s.response_need, 'critical') AS response_need,
       coalesce(s.show_on_dashboard, true) AS show_on_dashboard,
       s.updated_at, s.updated_by_name,
       coalesce(c.open_count, 0)::int AS open_count,
       coalesce(c.total_count, 0)::int AS total_count,
       coalesce(s.hidden, false) AS hidden
  FROM public.notice_form_rules r
  LEFT JOIN public.notice_type_settings s ON s.form_code = r.form_code
  LEFT JOIN (
    SELECT g.form_code,
           count(*) FILTER (WHERE NOT public.notice_is_closed(g.staff_status)) AS open_count,
           count(*) AS total_count
      FROM public.gst_notices g
     WHERE g.deleted_at IS NULL AND g.source = 'notices' AND g.form_code IS NOT NULL
     GROUP BY g.form_code
  ) c ON c.form_code = r.form_code;

-- ── Saving a type: p_hidden added (NULL leaves each setting as it is) ──────
DROP FUNCTION IF EXISTS public.notice_type_set(text, text, boolean, text);
CREATE OR REPLACE FUNCTION public.notice_type_set(p_form_code text, p_response_need text DEFAULT NULL,
                                                  p_show_on_dashboard boolean DEFAULT NULL, p_actor_name text DEFAULT NULL,
                                                  p_hidden boolean DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur      public.notice_type_settings;
  v        public.notice_type_settings;
  v_hidden boolean;
  v_need   text;
  v_dash   boolean;
BEGIN
  IF p_response_need IS NOT NULL AND p_response_need NOT IN ('critical', 'optional', 'none') THEN
    RAISE EXCEPTION 'notice_type_set: unknown reply need %', p_response_need USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notice_form_rules WHERE form_code = p_form_code) THEN
    RAISE EXCEPTION 'notice_type_set: unknown notice type %', p_form_code USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO cur FROM public.notice_type_settings WHERE form_code = p_form_code FOR UPDATE;
  v_hidden := coalesce(p_hidden, cur.hidden, false);
  v_need := coalesce(p_response_need, cur.response_need, 'critical');
  v_dash := coalesce(p_show_on_dashboard, cur.show_on_dashboard, true);
  IF v_hidden THEN
    IF (p_response_need IS NOT NULL AND p_response_need <> 'none') OR coalesce(p_show_on_dashboard, false) THEN
      RAISE EXCEPTION 'notice_type_set: % is hidden everywhere, so it needs no reply and is off the dashboard. Show it again first.', p_form_code
        USING ERRCODE = '22023';
    END IF;
    v_need := 'none';
    v_dash := false;
  END IF;
  INSERT INTO public.notice_type_settings AS s (form_code, response_need, show_on_dashboard, hidden, updated_by_name)
  VALUES (p_form_code, v_need, v_dash, v_hidden, p_actor_name)
  ON CONFLICT (form_code) DO UPDATE
     SET response_need = EXCLUDED.response_need,
         show_on_dashboard = EXCLUDED.show_on_dashboard,
         hidden = EXCLUDED.hidden,
         updated_by_name = p_actor_name,
         updated_at = now()
  RETURNING * INTO v;
  -- Hidden now: nothing of this type that is still waiting gets e-mailed.
  IF v_hidden AND NOT coalesce(cur.hidden, false) THEN
    UPDATE public.notice_events e SET alert_processed_at = now()
      FROM public.gst_notices g
     WHERE g.id = e.notice_id AND g.form_code = p_form_code AND e.alert_processed_at IS NULL;
  END IF;
  RETURN to_jsonb(v);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_type_set(text, text, boolean, text, boolean) TO anon, authenticated, service_role;

-- ── notice_facts: a hidden type is left out (same columns) ─────────────────
CREATE OR REPLACE VIEW public.notice_facts WITH (security_invoker = true) AS
WITH base AS (
  SELECT g.*,
         c.name AS client_name,
         c.gstin AS client_gstin,
         c.inactive_at_hand AS client_inactive,
         r.label AS form_label,
         r.category AS rule_category,
         r.default_priority,
         r.clock_basis,
         public.notice_computed_due(g.issue_date, g.case_id, g.form_code) AS computed_due,
         public.ist_today() AS today_ist,
         coalesce(ts.response_need, 'critical') AS response_need,
         coalesce(ts.show_on_dashboard, true) AS on_dashboard
    FROM public.gst_notices g
    JOIN public.clients c ON c.id = g.client_id
    LEFT JOIN public.notice_form_rules r ON r.form_code = g.form_code AND r.is_active
    LEFT JOIN public.notice_type_settings ts ON ts.form_code = g.form_code
   WHERE g.deleted_at IS NULL
     AND g.source = 'notices'
     -- 20261008180000: a type hidden everywhere is in no list, count, report or e-mail.
     AND NOT coalesce(ts.hidden, false)
), derived AS (
  SELECT b.*,
         NOT public.notice_is_closed(b.staff_status) AS open_flag,
         (b.reply_date IS NOT NULL) AS replied_flag,
         coalesce(b.extended_due_date, b.due_date, b.computed_due) AS eff_due,
         coalesce(nullif(b.case_id, ''), nullif(b.reference_number, ''), b.id::text) AS dispute,
         (NOT public.notice_is_closed(b.staff_status) AND b.matter_id IS NULL
          AND coalesce(b.amount_of_demand, 0) > 0) AS exposure_candidate
    FROM base b
)
SELECT
  d.id, d.client_id, d.client_name, d.client_gstin, d.client_inactive,
  d.source, d.portal_key, d.reference_number, d.case_id, d.notice_type, d.description,
  d.status AS portal_status,
  d.issue_date, d.due_date, d.extended_due_date, d.hearing_date,
  d.reply_date, d.reply_ref_number, d.order_date, d.order_number,
  d.submission_arn, d.submission_date,
  d.staff_status, d.close_reason,
  d.priority, d.default_priority, coalesce(d.priority, d.default_priority) AS effective_priority,
  d.assign_to, d.assign_to_user_id,
  d.amount_of_demand, d.financial_year, d.issued_by, d.remarks, d.pdf_url, d.matter_id,
  d.first_seen_at, d.last_seen_at, d.pulled_at, d.created_at, d.updated_at,
  d.form_code, d.form_label,
  public.notice_category(d.notice_type, d.description, d.rule_category) AS category,
  coalesce(d.notice_type = 'Refunds', false) AS is_refund_case,
  coalesce(d.notice_type = 'Voluntary Payment', false) AS is_drc03_case,
  d.open_flag AS is_open,
  d.replied_flag AS is_replied,
  d.eff_due AS effective_due,
  CASE WHEN d.extended_due_date IS NOT NULL THEN 'extended'
       WHEN d.due_date IS NOT NULL THEN 'portal'
       WHEN d.computed_due IS NOT NULL THEN 'computed' END AS due_basis,
  CASE WHEN d.extended_due_date IS NULL AND d.due_date IS NULL AND d.computed_due IS NOT NULL
       THEN d.clock_basis END AS due_basis_note,
  (d.eff_due - d.today_ist) AS days_to_due,
  coalesce(d.open_flag AND NOT d.replied_flag AND d.response_need <> 'none' AND d.eff_due < d.today_ist, false) AS is_overdue,
  coalesce(d.open_flag AND NOT d.replied_flag AND d.response_need <> 'none' AND d.eff_due BETWEEN d.today_ist AND d.today_ist + 7, false) AS is_due_in_7,
  coalesce(d.first_seen_at > now() - interval '24 hours', false) AS is_new,
  (d.open_flag AND d.assign_to_user_id IS NULL) AS is_unassigned,
  d.dispute AS dispute_key,
  CASE WHEN d.exposure_candidate
        AND row_number() OVER (PARTITION BY d.client_id, d.dispute, d.exposure_candidate
                               ORDER BY d.issue_date DESC NULLS LAST, d.id) = 1
       THEN d.amount_of_demand ELSE 0 END AS exposure_amount,
  d.today_ist,
  -- Phase 2
  d.stage,
  st.label AS stage_label,
  st.ord AS stage_ord,
  d.stage_changed_at,
  d.stage_changed_by,
  (d.today_ist - (d.stage_changed_at AT TIME ZONE 'Asia/Kolkata')::date) AS days_in_stage,
  d.hearing_note,
  -- Phase 4b: the notice type's reply need and dashboard choice
  d.response_need,
  d.on_dashboard
FROM derived d
JOIN public.notice_stages st ON st.key = d.stage;

-- ── Readers of gst_notices that show or count notices ──────────────────────
-- Ctrl K search: a hidden type is never a result.
CREATE OR REPLACE FUNCTION public.notices_search(p_q text, p_limit integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH q AS (
    SELECT btrim(coalesce(p_q, '')) AS raw,
           '%' || replace(replace(replace(btrim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat,
           greatest(1, least(coalesce(p_limit, 8), 25)) AS lim
  ),
  hit_clients AS (
    SELECT c.id, c.name, c.gstin
      FROM public.clients c, q
     WHERE length(q.raw) >= 2 AND (c.name ILIKE q.pat OR c.gstin ILIKE q.pat)
     ORDER BY (c.gstin ILIKE q.raw) DESC, c.name
     LIMIT (SELECT lim FROM q)
  ),
  folder_hits AS (
    SELECT DISTINCT i.client_id, i.case_id, i.reference_number AS matched
      FROM public.gst_case_folder_items i, q
     WHERE length(q.raw) >= 4 AND i.deleted_at IS NULL
       AND (i.reference_number ILIKE q.pat OR i.raw_json::text ILIKE q.pat)
     LIMIT 50
  ),
  hit_notices AS (
    SELECT g.id, g.client_id, c.name AS client_name, c.gstin, g.form_code, g.notice_type,
           g.reference_number, g.case_id, g.stage, g.issue_date,
           CASE
             WHEN g.reference_number ILIKE q.pat THEN 'reference'
             WHEN g.case_id ILIKE q.pat THEN 'case'
             WHEN g.submission_arn ILIKE q.pat OR g.reply_ref_number ILIKE q.pat THEN 'reply'
             WHEN g.order_number ILIKE q.pat THEN 'order'
             WHEN g.form_code ILIKE q.pat THEN 'form'
             WHEN EXISTS (SELECT 1 FROM folder_hits h WHERE h.client_id = g.client_id AND h.case_id = g.case_id) THEN 'folder'
             ELSE 'text'
           END AS matched_on
      FROM public.gst_notices g
      JOIN public.clients c ON c.id = g.client_id, q
     WHERE length(q.raw) >= 2 AND g.deleted_at IS NULL AND g.source = 'notices'
       AND NOT public.notice_type_hidden(g.form_code)
       AND (g.reference_number ILIKE q.pat OR g.case_id ILIKE q.pat OR g.submission_arn ILIKE q.pat
            OR g.reply_ref_number ILIKE q.pat OR g.order_number ILIKE q.pat OR g.form_code ILIKE q.pat
            OR (length(q.raw) >= 4 AND g.description ILIKE q.pat)
            OR c.name ILIKE q.pat OR c.gstin ILIKE q.pat
            OR EXISTS (SELECT 1 FROM folder_hits h WHERE h.client_id = g.client_id AND h.case_id = g.case_id))
     ORDER BY (g.reference_number ILIKE q.raw OR g.case_id ILIKE q.raw) DESC,
              (g.stage <> 'closed') DESC, g.issue_date DESC NULLS LAST
     LIMIT (SELECT lim FROM q)
  )
  SELECT jsonb_build_object(
    'clients', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'id', h.id, 'name', h.name, 'gstin', h.gstin,
                  'open', (SELECT count(*) FROM public.notice_facts f WHERE f.client_id = h.id AND f.is_open),
                  'overdue', (SELECT count(*) FROM public.notice_facts f WHERE f.client_id = h.id AND f.is_overdue))), '[]'::jsonb)
                  FROM hit_clients h),
    'notices', (SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.ord), '[]'::jsonb)
                  FROM (SELECT h.*, row_number() OVER () AS ord FROM hit_notices h) n)
  )
$function$;

GRANT EXECUTE ON FUNCTION public.notices_search(text, int) TO anon, authenticated, service_role;

-- Command centre: "types off the dashboard" counts the types still listed, and
-- "auto-closed today" counts what its list (notice_facts) shows.
CREATE OR REPLACE FUNCTION public.notices_command_centre(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- fa / pa: every notice (the top nav and sync health); f / p: the notice types
  -- the dashboard shows (notice_type_settings.show_on_dashboard), which every
  -- other figure counts. A list opened from here filters the same way (dash=1).
  WITH fa AS MATERIALIZED (SELECT * FROM public.notice_facts),
  f AS MATERIALIZED (SELECT * FROM fa WHERE fa.on_dashboard),
  pa AS MATERIALIZED (SELECT * FROM public.notice_plan),
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
      FROM public.litigation_matters m
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
      'matters', (SELECT count(*) FROM public.litigation_matters m WHERE m.status <> 'Closed'),
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

GRANT EXECUTE ON FUNCTION public.notices_command_centre(uuid) TO anon, authenticated, service_role;

-- Autopilot capture metrics: the notices the firm works on.
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

GRANT EXECUTE ON FUNCTION public.autopilot_metrics(int) TO anon, authenticated, service_role;

-- Background evidence build: never for a hidden type.
CREATE OR REPLACE FUNCTION public.reply_evidence_pending(p_limit integer DEFAULT 20)
 RETURNS TABLE(notice_id uuid, client_id uuid, form_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT g.id, g.client_id, g.form_code
    FROM public.gst_notices g
   WHERE g.deleted_at IS NULL AND g.source = 'notices' AND NOT public.notice_is_closed(g.staff_status)
     AND g.form_code IN ('ASMT-10', 'DRC-01A', 'DRC-01B', 'DRC-01C')
     AND NOT public.notice_type_hidden(g.form_code)
     AND NOT EXISTS (SELECT 1 FROM public.reply_annexures a WHERE a.notice_id = g.id AND a.is_current)
   ORDER BY coalesce(g.extended_due_date, g.due_date) NULLS LAST, g.issue_date DESC NULLS LAST, g.id
   LIMIT greatest(coalesce(p_limit, 20), 0)
$function$;

GRANT EXECUTE ON FUNCTION public.reply_evidence_pending(int) TO anon, authenticated, service_role;

-- ── No e-mail about a hidden notice ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_events_hidden_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.alert_processed_at IS NULL AND NEW.notice_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.gst_notices g
                   JOIN public.notice_type_settings s ON s.form_code = g.form_code AND s.hidden
                  WHERE g.id = NEW.notice_id) THEN
    NEW.alert_processed_at := now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notice_events_hidden_type ON public.notice_events;
CREATE TRIGGER trg_notice_events_hidden_type BEFORE INSERT ON public.notice_events
  FOR EACH ROW EXECUTE FUNCTION public.notice_events_hidden_type();

-- ── GSTR-3A starts hidden everywhere (the firm's request) ──────────────────
-- Its reply need becomes none, which withdraws its ready reply options (the
-- notice_type_settings trigger of 20261008160000).
INSERT INTO public.notice_type_settings AS s (form_code, response_need, show_on_dashboard, hidden, updated_by_name)
SELECT r.form_code, 'none', false, true, 'Setup (firm request of 7 Oct 2026)'
  FROM public.notice_form_rules r
 WHERE r.form_code = 'GSTR-3A'
ON CONFLICT (form_code) DO UPDATE
   SET response_need = 'none', show_on_dashboard = false, hidden = true,
       updated_by_name = EXCLUDED.updated_by_name, updated_at = now();

UPDATE public.notice_events e SET alert_processed_at = now()
  FROM public.gst_notices g
  JOIN public.notice_type_settings s ON s.form_code = g.form_code AND s.hidden
 WHERE g.id = e.notice_id AND e.alert_processed_at IS NULL;

NOTIFY pgrst, 'reload schema';
