-- Notices Phase 4 · Notice types: which notices need a reply, and which ones the
-- dashboard shows (asked by the firm on 2026-10-06; docs/REPLY_FACTORY_POSITIONS.md §11).
--
-- Every notice type (a form code of notice_form_rules) carries a reply need:
--   critical  a reply or an action is required, with a consequence if it is missed
--             (show cause notices, scrutiny, intimations with a reply clock, hearings,
--             summons, audit, attachment, recovery and demand orders);
--   optional  a reply is allowed but not required (DRC-01A, audit findings, orders
--             that only matter when adverse);
--   none      information only (acknowledgements, approvals, the firm's own filings
--             and payments): no reply clock, never overdue.
-- An admin also chooses which types the command centre shows. A hidden type stays in
-- every list; a list opened from the command centre carries dash=1 and filters to the
-- dashboard's types, so every number on the dashboard still equals its list.
--
-- Objects: notice_type_settings (seeded, editable), notice_type_overview, notice_type_set();
-- notice_facts gains response_need and on_dashboard, and its overdue / due-in-7 flags never
-- fire for a type that needs no reply; notice_plan is rebuilt with them (next action
-- read_close for a no-reply notice, optional ones rank lower); notice_calendar leaves out
-- reply dues of no-reply notices; notices_command_centre counts the dashboard's types only
-- (its nav and health stay whole) and reports what is hidden; notice_due_coverage counts a
-- no-reply notice as informational.

-- ── Settings per notice type ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notice_type_settings (
  form_code         text PRIMARY KEY REFERENCES public.notice_form_rules (form_code) ON UPDATE CASCADE ON DELETE CASCADE,
  response_need     text NOT NULL DEFAULT 'critical' CHECK (response_need IN ('critical', 'optional', 'none')),
  show_on_dashboard boolean NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by_name   text
);
COMMENT ON TABLE public.notice_type_settings IS
  'Per notice type (form code): whether it needs a reply (critical / optional / none) and whether the command centre shows it. A type without a row is critical and shown.';

ALTER TABLE public.notice_type_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notice_type_settings_public" ON public.notice_type_settings;
CREATE POLICY "notice_type_settings_public" ON public.notice_type_settings FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notice_type_settings TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_notice_type_settings_updated_at ON public.notice_type_settings;
CREATE TRIGGER trg_notice_type_settings_updated_at BEFORE UPDATE ON public.notice_type_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The firm's starting point. ON CONFLICT DO NOTHING: re-running never undoes an
-- admin's choice. Information-only types start hidden from the dashboard.
INSERT INTO public.notice_type_settings (form_code, response_need, show_on_dashboard)
SELECT r.form_code,
       CASE WHEN r.form_code IN ('DROPPED', 'ACCEPTED', 'LUT', 'LUT-APPROVED', 'APL-01', 'APL-02', 'REG-06', 'REG-15',
                                 'REG-22', 'SPL-APPROVED', 'DRC-03', 'PMT-03', 'RFD-04', 'ADT-CLOSURE') THEN 'none'
            WHEN r.form_code IN ('DRC-01A', 'ADT-02', 'RFD-06', 'REG-05', 'RECT-ORDER', 'REG-CANCEL-REJ') THEN 'optional'
            ELSE 'critical' END,
       r.form_code NOT IN ('DROPPED', 'ACCEPTED', 'LUT', 'LUT-APPROVED', 'APL-01', 'APL-02', 'REG-06', 'REG-15',
                           'REG-22', 'SPL-APPROVED', 'DRC-03', 'PMT-03', 'RFD-04', 'ADT-CLOSURE')
  FROM public.notice_form_rules r
ON CONFLICT (form_code) DO NOTHING;

-- ── Overview for the settings screen ───────────────────────────────────────
CREATE OR REPLACE VIEW public.notice_type_overview WITH (security_invoker = true) AS
SELECT r.form_code, r.label, r.category, r.is_active, r.match_order,
       coalesce(s.response_need, 'critical') AS response_need,
       coalesce(s.show_on_dashboard, true) AS show_on_dashboard,
       s.updated_at, s.updated_by_name,
       coalesce(c.open_count, 0)::int AS open_count,
       coalesce(c.total_count, 0)::int AS total_count
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
COMMENT ON VIEW public.notice_type_overview IS
  'Notice types with their reply need, dashboard choice and how many notices of each are open / on file.';
GRANT SELECT ON public.notice_type_overview TO anon, authenticated, service_role;

-- NULL leaves a setting as it is. The app lets only a superadmin or GST manager call it.
CREATE OR REPLACE FUNCTION public.notice_type_set(p_form_code text, p_response_need text DEFAULT NULL,
                                                  p_show_on_dashboard boolean DEFAULT NULL, p_actor_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.notice_type_settings;
BEGIN
  IF p_response_need IS NOT NULL AND p_response_need NOT IN ('critical', 'optional', 'none') THEN
    RAISE EXCEPTION 'notice_type_set: unknown reply need %', p_response_need USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notice_form_rules WHERE form_code = p_form_code) THEN
    RAISE EXCEPTION 'notice_type_set: unknown notice type %', p_form_code USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.notice_type_settings AS s (form_code, response_need, show_on_dashboard, updated_by_name)
  VALUES (p_form_code, coalesce(p_response_need, 'critical'), coalesce(p_show_on_dashboard, true), p_actor_name)
  ON CONFLICT (form_code) DO UPDATE
     SET response_need = coalesce(p_response_need, s.response_need),
         show_on_dashboard = coalesce(p_show_on_dashboard, s.show_on_dashboard),
         updated_by_name = p_actor_name,
         updated_at = now()
  RETURNING * INTO v;
  RETURN to_jsonb(v);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_type_set(text, text, boolean, text) TO anon, authenticated, service_role;

-- ── notice_facts: reply need and dashboard choice (appended columns) ───────
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

GRANT SELECT ON public.notice_facts TO anon, authenticated, service_role;

-- ── notice_plan rebuilt over the new columns ───────────────────────────────
-- Dropped and created again: its columns come from notice_facts.*, so the new
-- columns would land in the middle, which CREATE OR REPLACE refuses. Nothing
-- in the database depends on the view itself.
DROP VIEW IF EXISTS public.notice_plan;
CREATE VIEW public.notice_plan WITH (security_invoker = true) AS
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
         (f.hearing_date IS NOT NULL AND f.hearing_date BETWEEN f.today_ist AND f.today_ist + 14) AS hearing_soon,
         -- a notice that needs no reply has no reply date to drive it
         CASE WHEN f.response_need = 'none' THEN NULL ELSE f.effective_due END AS reply_due
    FROM f
    LEFT JOIN clock c ON c.notice_id = f.id
    LEFT JOIN docs dc ON dc.notice_id = f.id
    LEFT JOIN draft dr ON dr.notice_id = f.id
    LEFT JOIN issues i ON i.notice_id = f.id
), acted AS (
  SELECT b.*,
    CASE
      WHEN b.response_need = 'none' AND b.stage IN ('new', 'triaged') THEN 'read_close'
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
      WHEN b.hearing_soon AND b.hearing_date < coalesce(b.reply_due, b.hearing_date + 1) THEN b.hearing_date
      ELSE b.reply_due
    END AS plan_due,
    CASE
      WHEN b.stage IN ('order', 'appeal') THEN
        CASE WHEN b.clock_date IS NULL THEN NULL
             WHEN b.clock_type = 'attachment_expiry' THEN 'attachment' ELSE 'appeal' END
      WHEN b.stage IN ('filed', 'hearing') THEN CASE WHEN b.hearing_date IS NOT NULL THEN 'hearing' END
      WHEN b.hearing_soon AND b.hearing_date < coalesce(b.reply_due, b.hearing_date + 1) THEN 'hearing'
      WHEN b.reply_due IS NOT NULL THEN 'reply'
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
    * CASE a.response_need WHEN 'optional' THEN 0.7 WHEN 'none' THEN 0.5 ELSE 1.0 END
  )::numeric, 4) AS plan_score
FROM acted a;
COMMENT ON VIEW public.notice_plan IS
  'Open notices with the date that drives them (plan_due), readiness, one next action and a rank (plan_score). in_plan = has a next action; Today''s plan and the Work queue read it.';
GRANT SELECT ON public.notice_plan TO anon, authenticated, service_role;

-- ── Calendar: no reply-due rows for notices that need no reply ─────────────
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
   WHERE NOT f.is_replied AND f.response_need <> 'none' AND f.effective_due BETWEEN p_from AND p_to
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

-- ── Command centre: the dashboard's notice types only ──────────────────────
CREATE OR REPLACE FUNCTION public.notices_command_centre(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
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
      'hidden_types', (SELECT count(*) FROM public.notice_type_settings s WHERE NOT s.show_on_dashboard),
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

-- ── Due-date coverage: a no-reply notice is informational ──────────────────
CREATE OR REPLACE FUNCTION public.notice_due_coverage()
RETURNS TABLE (notice_id uuid, form_code text, kind text, due_on date, source text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.id, f.form_code,
         CASE WHEN f.response_need = 'none' THEN 'informational'
              WHEN f.effective_due IS NOT NULL THEN 'reply'
              WHEN f.hearing_date IS NOT NULL THEN 'hearing'
              WHEN ap.deadline_date IS NOT NULL THEN 'appeal'
              WHEN lapsed.outer_limit IS NOT NULL AND lapsed.outer_limit < public.ist_today() THEN 'appeal_lapsed'
              WHEN r.auto_close_reason IS NOT NULL THEN 'informational'
              ELSE 'missing' END,
         CASE WHEN f.response_need <> 'none' THEN
           coalesce(f.effective_due, f.hearing_date, ap.deadline_date,
                    CASE WHEN lapsed.outer_limit < public.ist_today() THEN lapsed.outer_limit END) END,
         CASE WHEN f.response_need = 'none' THEN 'no reply needed for this notice type'
              WHEN f.effective_due IS NOT NULL THEN
                CASE f.due_basis WHEN 'extended' THEN 'extended by staff'
                                 WHEN 'computed' THEN 'computed from the form''s reply period'
                                 ELSE CASE g.due_date_source WHEN 'case_folder' THEN 'portal case folder'
                                                             WHEN 'manual' THEN 'typed by staff'
                                                             WHEN 'read' THEN 'read from the notice (verify)'
                                                             ELSE 'portal notice list' END END
              WHEN f.hearing_date IS NOT NULL THEN 'hearing date'
              WHEN ap.deadline_date IS NOT NULL THEN 'appeal period from the order date'
              WHEN lapsed.outer_limit IS NOT NULL AND lapsed.outer_limit < public.ist_today() THEN 'appeal period over (review and close)'
              WHEN r.auto_close_reason IS NOT NULL THEN 'no reply needed (closes by itself)'
         END
    FROM public.notice_facts f
    JOIN public.gst_notices g ON g.id = f.id
    LEFT JOIN public.notice_form_rules r ON r.form_code = f.form_code
    LEFT JOIN LATERAL (
      SELECT d.deadline_date FROM public.matter_deadlines d
       WHERE d.notice_id = f.id AND d.deadline_type IN ('appeal_s107', 'appeal_s112')
       ORDER BY d.deadline_date LIMIT 1) ap ON true
    LEFT JOIN LATERAL (
      SELECT public.litigation_rule_add(public.litigation_rule_add(coalesce(g.order_date, g.issue_date),
               'appeal_months.' || CASE WHEN r.appeal_section = 's112' THEN 's112' ELSE 's107' END),
               'appeal_condonation.' || CASE WHEN r.appeal_section = 's112' THEN 's112' ELSE 's107' END) AS outer_limit
       WHERE r.appeal_section IS NOT NULL AND coalesce(g.order_date, g.issue_date) IS NOT NULL) lapsed ON true
   WHERE f.is_open
$$;
GRANT EXECUTE ON FUNCTION public.notice_due_coverage() TO anon, authenticated, service_role;
