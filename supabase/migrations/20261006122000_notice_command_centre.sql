-- Notices Phase 2 · command centre, work queue, calendar and search
-- (docs/NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf: roadmap Phase 2 task 2; mock §7;
-- findings U-01-1, U-01-4, U-03-1, U-04-1, U-11-*, U-24-*, U-72-1).
--
--   notice_plan              every open notice with the date that drives it,
--                            how ready it is, its one next action and a rank.
--                            "Today's plan" on the dashboard and the Work queue
--                            page are this view, so their counts agree.
--   notices_command_centre() every other number on the dashboard in one call,
--                            each defined over notice_facts / notice_plan so the
--                            list it opens has the same count.
--   notice_calendar()        reply dues, hearings and statutory clocks by day
--                            (the 14-day strip and the Calendar page).
--   notices_search()         Ctrl K: clients by name / GSTIN, notices by
--                            reference, case ID / ARN, reply or order number,
--                            form, and the DIN or reference inside folder items.
--
-- Ranking (a position, docs/NOTICES_LITIGATION_POSITIONS.md §14):
--   score = urgency × value × (0.6 + 0.4 × readiness) × priority weight
--   urgency   overdue 1.5–2.5 (more for longer overdue, capped at 60 days),
--             due today 1.2, then 1.2 / (1 + days / 3); no date 0.15
--   value     1 + ln(1 + amount / ₹1 lakh), amount = exposure, else demand,
--             else the issues' total
--   readiness 0–1 from the stage, documents received and the draft's state
--   priority  High × 1.3, Low × 0.8

CREATE OR REPLACE VIEW public.notice_plan WITH (security_invoker = true) AS
WITH f AS (
  SELECT * FROM public.notice_facts WHERE is_open
), clock AS (
  SELECT DISTINCT ON (d.notice_id) d.notice_id, d.deadline_type, d.deadline_date
    FROM public.matter_deadlines d
   WHERE d.notice_id IS NOT NULL AND NOT d.is_met
     AND d.deadline_type IN ('appeal_s107', 'appeal_s112', 'appeal_s107_condonation',
                             'appeal_s112_condonation', 'attachment_expiry')
     AND d.deadline_date >= public.ist_today() - 30
   ORDER BY d.notice_id, d.deadline_date
), docs AS (
  SELECT r.notice_id,
         count(*) AS docs_total,
         count(*) FILTER (WHERE r.status = 'requested') AS docs_open,
         max(r.reminders_sent) AS reminders_sent,
         max(r.last_reminded_at) AS last_reminded_at
    FROM public.notice_doc_requests r
   GROUP BY r.notice_id
), draft AS (
  SELECT DISTINCT ON (d.notice_id) d.notice_id, d.version AS draft_version, d.status AS draft_status
    FROM public.notice_drafts d
   WHERE d.status <> 'superseded'
   ORDER BY d.notice_id, d.version DESC
), issues AS (
  SELECT i.notice_id,
         count(*) AS issues_total,
         sum(i.amount) AS issues_amount,
         sum(i.explained_amount) AS issues_explained,
         coalesce(sum(i.amount - i.explained_amount) FILTER (WHERE i.status = 'pay'), 0) AS issues_to_pay
    FROM public.notice_issues i
   GROUP BY i.notice_id
), base AS (
  SELECT f.*,
         c.deadline_type AS clock_type, c.deadline_date AS clock_date,
         coalesce(dc.docs_total, 0) AS docs_total, coalesce(dc.docs_open, 0) AS docs_open,
         coalesce(dc.reminders_sent, 0) AS docs_reminders, dc.last_reminded_at AS docs_last_reminded_at,
         dr.draft_version, dr.draft_status,
         coalesce(i.issues_total, 0) AS issues_total, coalesce(i.issues_amount, 0) AS issues_amount,
         coalesce(i.issues_explained, 0) AS issues_explained, coalesce(i.issues_to_pay, 0) AS issues_to_pay,
         (f.hearing_date IS NOT NULL AND f.hearing_date BETWEEN f.today_ist AND f.today_ist + 14) AS hearing_soon
    FROM f
    LEFT JOIN clock c ON c.notice_id = f.id
    LEFT JOIN docs dc ON dc.notice_id = f.id
    LEFT JOIN draft dr ON dr.notice_id = f.id
    LEFT JOIN issues i ON i.notice_id = f.id
), acted AS (
  SELECT b.*,
    CASE
      WHEN b.assign_to_user_id IS NULL THEN 'assign'
      WHEN b.hearing_soon AND b.stage IN ('filed', 'hearing') THEN 'prepare_hearing'
      WHEN b.stage = 'new' THEN 'triage'
      WHEN b.stage = 'triaged' THEN 'start_work'
      WHEN b.stage = 'evidence' THEN 'build_evidence'
      WHEN b.stage = 'waiting_client' THEN CASE WHEN b.docs_open > 0 THEN 'chase_client' ELSE 'build_evidence' END
      WHEN b.stage = 'draft' THEN 'write_draft'
      WHEN b.stage = 'partner_review' THEN
        CASE WHEN b.draft_status = 'in_review' THEN 'review_draft' ELSE 'file_reply' END
      WHEN b.stage = 'order' THEN 'decide_order'
      WHEN b.stage = 'appeal' THEN 'follow_appeal'
      ELSE 'await_order'
    END AS next_action,
    -- The date that drives the notice: an order or appeal runs on its appeal /
    -- attachment clock; a filed reply on its hearing; before filing, the reply
    -- due date, or a hearing fixed earlier than it.
    CASE
      WHEN b.stage IN ('order', 'appeal') THEN b.clock_date
      WHEN b.stage IN ('filed', 'hearing') THEN b.hearing_date
      WHEN b.hearing_soon AND b.hearing_date < coalesce(b.effective_due, b.hearing_date + 1) THEN b.hearing_date
      ELSE b.effective_due
    END AS plan_due,
    CASE
      WHEN b.stage IN ('order', 'appeal') THEN
        CASE WHEN b.clock_date IS NULL THEN NULL
             WHEN b.clock_type = 'attachment_expiry' THEN 'attachment' ELSE 'appeal' END
      WHEN b.stage IN ('filed', 'hearing') THEN CASE WHEN b.hearing_date IS NOT NULL THEN 'hearing' END
      WHEN b.hearing_soon AND b.hearing_date < coalesce(b.effective_due, b.hearing_date + 1) THEN 'hearing'
      WHEN b.effective_due IS NOT NULL THEN 'reply'
    END AS plan_due_kind,
    least(1.0, greatest(0.0, CASE b.stage
      WHEN 'new' THEN 0.0
      WHEN 'triaged' THEN 0.1
      WHEN 'evidence' THEN 0.3 + CASE WHEN b.issues_amount > 0 THEN 0.2 * b.issues_explained / b.issues_amount ELSE 0 END
      WHEN 'waiting_client' THEN 0.25 + CASE WHEN b.docs_total > 0 THEN 0.25 * (b.docs_total - b.docs_open)::numeric / b.docs_total ELSE 0 END
      WHEN 'draft' THEN 0.6
      WHEN 'partner_review' THEN CASE b.draft_status WHEN 'approved' THEN 0.95 WHEN 'in_review' THEN 0.8 ELSE 0.75 END
      WHEN 'filed' THEN 1.0
      WHEN 'hearing' THEN 0.5
      WHEN 'order' THEN 0.2
      WHEN 'appeal' THEN 0.3
      ELSE 0.0 END)) AS readiness
  FROM base b
)
SELECT a.*,
  round(a.readiness * 100)::int AS readiness_pct,
  (a.plan_due - a.today_ist) AS days_to_plan_due,
  (a.next_action <> 'await_order') AS in_plan,
  round((
    CASE
      WHEN a.plan_due IS NULL THEN 0.15
      WHEN a.plan_due < a.today_ist THEN 1.5 + least(a.today_ist - a.plan_due, 60) / 60.0
      ELSE 1.2 / (1 + (a.plan_due - a.today_ist) / 3.0)
    END
    * (1 + ln(1 + greatest(coalesce(nullif(a.exposure_amount, 0), a.amount_of_demand, nullif(a.issues_amount, 0), 0), 0) / 100000.0))
    * (0.6 + 0.4 * a.readiness)
    * CASE a.effective_priority WHEN 'High' THEN 1.3 WHEN 'Low' THEN 0.8 ELSE 1.0 END
  )::numeric, 4) AS plan_score
FROM acted a;
COMMENT ON VIEW public.notice_plan IS
  'Open notices with the date that drives them (plan_due), readiness, one next action and a rank (plan_score). in_plan = has a next action; Today''s plan and the Work queue read it.';
GRANT SELECT ON public.notice_plan TO anon, authenticated, service_role;

-- ── Calendar: reply dues, hearings and clocks by day ───────────────────────
CREATE OR REPLACE FUNCTION public.notice_calendar(p_from date, p_to date)
RETURNS TABLE (day date, kind text, notice_id uuid, client_id uuid, client_name text, form_code text,
               reference text, title text, stage text, owner_id uuid, owner text, detail text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH f AS MATERIALIZED (SELECT * FROM public.notice_facts WHERE is_open)
  SELECT f.effective_due, 'reply', f.id, f.client_id, f.client_name, f.form_code,
         coalesce(f.reference_number, f.case_id), coalesce(f.form_label, f.notice_type), f.stage,
         f.assign_to_user_id, f.assign_to, f.due_basis
    FROM f
   WHERE NOT f.is_replied AND f.effective_due BETWEEN p_from AND p_to
  UNION ALL
  SELECT f.hearing_date, 'hearing', f.id, f.client_id, f.client_name, f.form_code,
         coalesce(f.reference_number, f.case_id), coalesce(f.form_label, f.notice_type), f.stage,
         f.assign_to_user_id, f.assign_to, NULL
    FROM f
   WHERE f.hearing_date BETWEEN p_from AND p_to
  UNION ALL
  SELECT d.deadline_date,
         CASE WHEN d.deadline_type = 'attachment_expiry' THEN 'attachment' ELSE 'appeal' END,
         f.id, f.client_id, f.client_name, f.form_code,
         coalesce(f.reference_number, f.case_id), coalesce(f.form_label, f.notice_type), f.stage,
         f.assign_to_user_id, f.assign_to, d.deadline_type
    FROM public.matter_deadlines d
    JOIN f ON f.id = d.notice_id
   WHERE NOT d.is_met AND d.deadline_date BETWEEN p_from AND p_to
     AND d.deadline_type NOT IN ('reply_due', 'hearing')
$$;
GRANT EXECUTE ON FUNCTION public.notice_calendar(date, date) TO anon, authenticated, service_role;

-- ── Upcoming hearings: open notices' hearing dates and open matters' hearings ─
CREATE OR REPLACE FUNCTION public.notice_hearings_upcoming(p_from date DEFAULT NULL)
RETURNS TABLE (kind text, ref_id uuid, notice_id uuid, matter_id uuid, client_id uuid, client_name text,
               hearing_on date, hearing_at timestamptz, title text, reference text, stage text,
               owner_id uuid, owner text, venue text, note text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 'notice', f.id, f.id, f.matter_id, f.client_id, f.client_name,
         f.hearing_date, NULL::timestamptz, coalesce(f.form_label, f.notice_type), coalesce(f.reference_number, f.case_id),
         f.stage, f.assign_to_user_id, f.assign_to, NULL, f.hearing_note
    FROM public.notice_facts f
   WHERE f.is_open AND f.hearing_date >= coalesce(p_from, public.ist_today())
  UNION ALL
  SELECT 'matter', h.id, NULL, m.id, m.client_id, c.name,
         (h.scheduled_at AT TIME ZONE 'Asia/Kolkata')::date, h.scheduled_at, coalesce(m.title, m.matter_no), m.matter_no,
         m.stage, m.owner_user_id, NULL, h.venue, h.notes
    FROM public.matter_hearings h
    JOIN public.litigation_matters m ON m.id = h.matter_id
    JOIN public.clients c ON c.id = m.client_id
   WHERE m.status <> 'Closed'
     AND (h.scheduled_at AT TIME ZONE 'Asia/Kolkata')::date >= coalesce(p_from, public.ist_today())
$$;
GRANT EXECUTE ON FUNCTION public.notice_hearings_upcoming(date) TO anon, authenticated, service_role;

-- ── Every dashboard figure in one call ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notices_command_centre(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH f AS MATERIALIZED (SELECT * FROM public.notice_facts),
  p AS MATERIALIZED (SELECT * FROM public.notice_plan),
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
    SELECT * FROM public.notice_calendar((SELECT d FROM today), (SELECT d FROM today) + 13)
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
      'queue', (SELECT count(*) FROM p WHERE p.in_plan),
      'open', (SELECT count(*) FROM f WHERE f.is_open),
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
      'new_today', (SELECT count(*) FROM f WHERE (f.first_seen_at AT TIME ZONE 'Asia/Kolkata')::date = (SELECT d FROM today)),
      'auto_closed_today', (SELECT count(*) FROM public.notice_events e
                             WHERE e.event_type = 'closed' AND e.actor_name = 'Closing sweep'
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
$$;
GRANT EXECUTE ON FUNCTION public.notices_command_centre(uuid) TO anon, authenticated, service_role;

-- ── Ctrl K ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notices_search(p_q text, p_limit int DEFAULT 8)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
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
$$;
GRANT EXECUTE ON FUNCTION public.notices_search(text, int) TO anon, authenticated, service_role;
