-- Notices · whose work it is, whose move it is, and closing for good (the
-- firm's request of 12 October 2026):
--  1. "In some clients we do refunds, we do litigation, some is handled by
--     another CA": per client, the kinds of work the firm does
--     (clients.notices_tracks_off: litigation, refund, registration, other), and
--     per case "handled elsewhere" (gst_notices.excluded_at, set for the whole
--     case and carried to notices that arrive in it later). Both leave
--     notice_facts, so no tile, list, count or e-mail shows them.
--  2. "Rights to superadmin and GST manager to hard close the case":
--     notice_case_close / notice_case_reopen, checked against user_roles.
--  3. "Which is closed, which is pending with the department, which with us":
--     notice_cases.waiting_on (us / department / closed); a case with the
--     department is neither overdue nor due (we have replied, filed or appealed);
--     notice_cases_counts gains with_us, with_dept and closed.
--  4. "Every document to be read through Haiku only": ai_settings.doc_model
--     (default claude-haiku-4-5), used by ai_claim_next for documents.
--  5. The case advice is written again, half as long (notice-ai 1.4.0).

-- ── 1. Whose work it is ─────────────────────────────────────────────────────
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS notices_tracks_off text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.clients.notices_tracks_off IS
  'Kinds of notice work the firm does not do for this client (litigation, refund, registration, other): left out of notice_facts.';

ALTER TABLE public.gst_notices
  ADD COLUMN IF NOT EXISTS excluded_at timestamptz,
  ADD COLUMN IF NOT EXISTS excluded_by_name text,
  ADD COLUMN IF NOT EXISTS excluded_reason text;
COMMENT ON COLUMN public.gst_notices.excluded_at IS
  'Set when the case is handled elsewhere (another CA): the notice is left out of notice_facts.';

CREATE OR REPLACE FUNCTION public.notices_client_tracks_set(p_client_ids uuid[], p_track text, p_handled boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n int;
BEGIN
  IF p_track NOT IN ('litigation', 'refund', 'registration', 'other') THEN RAISE EXCEPTION 'unknown kind %', p_track; END IF;
  UPDATE public.clients
     SET notices_tracks_off = CASE WHEN p_handled THEN array_remove(notices_tracks_off, p_track)
                                   ELSE array_append(array_remove(notices_tracks_off, p_track), p_track) END
   WHERE id = ANY (p_client_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notices_client_tracks_set(uuid[], text, boolean) TO anon, authenticated, service_role;

-- Superadmin or GST manager: the only people who close or exclude a whole case.
CREATE OR REPLACE FUNCTION public.notice_case_admin(p_actor_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p_actor_id AND r.role::text IN ('superadmin', 'gst_manager'))
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_admin(uuid) TO anon, authenticated, service_role;

-- The notices of a case, open or closed, in or out of notice_facts.
CREATE OR REPLACE FUNCTION public.notice_case_notice_ids(p_client_id uuid, p_case_key text)
RETURNS SETOF uuid
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.id
    FROM public.gst_notices g
    LEFT JOIN public.notice_form_rules r ON r.form_code = g.form_code AND r.is_active
   WHERE g.client_id = p_client_id AND g.deleted_at IS NULL AND g.source = 'notices'
     AND public.notice_case_key(g.client_id, g.case_id, public.notice_category(g.notice_type, g.description, r.category), g.id)
         = public.notice_case_root(p_client_id, p_case_key)
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_notice_ids(uuid, text) TO anon, authenticated, service_role;

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
         edited_by_id = p_actor_id, edited_by_name = left(p_actor_name, 120), edited_at = now()
   WHERE g.id IN (SELECT public.notice_case_notice_ids(p_client_id, p_case_key));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('notices', v_n);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_exclude(uuid, text, boolean, text, uuid, text) TO anon, authenticated, service_role;

-- A notice that arrives in a case handled elsewhere is handled elsewhere too.
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
     LIMIT 1;
    IF FOUND THEN
      NEW.excluded_at := now(); NEW.excluded_by_name := v.excluded_by_name; NEW.excluded_reason := v.excluded_reason;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_gst_notices_inherit_exclusion ON public.gst_notices;
CREATE TRIGGER trg_gst_notices_inherit_exclusion BEFORE INSERT ON public.gst_notices
  FOR EACH ROW EXECUTE FUNCTION public.gst_notices_inherit_exclusion();

-- The cases handled elsewhere, to bring one back.
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
             count(*)::int AS notices, string_agg(DISTINCT coalesce(g.form_code, g.notice_type), ', ') AS forms
        FROM public.gst_notices g
        JOIN public.clients c ON c.id = g.client_id
        LEFT JOIN public.notice_form_rules r ON r.form_code = g.form_code AND r.is_active
       WHERE g.excluded_at IS NOT NULL AND g.deleted_at IS NULL
       GROUP BY 1, 2, 3, 4
    ) x
$$;
GRANT EXECUTE ON FUNCTION public.notice_cases_excluded() TO anon, authenticated, service_role;

-- ── 2. Closing a case for good ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_case_close(p_client_id uuid, p_case_key text, p_reason text, p_actor_id uuid, p_actor_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n int;
BEGIN
  IF NOT public.notice_case_admin(p_actor_id) THEN RETURN jsonb_build_object('error', 'Only a superadmin or GST manager can close a case.'); END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN RETURN jsonb_build_object('error', 'Give the reason.'); END IF;
  UPDATE public.gst_notices g
     SET stage = 'closed', close_reason = left(btrim(p_reason), 500),
         edited_by_id = p_actor_id, edited_by_name = left(p_actor_name, 120), edited_at = now()
   WHERE g.id IN (SELECT public.notice_case_notice_ids(p_client_id, p_case_key))
     AND NOT public.notice_is_closed(g.staff_status);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('closed', v_n);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_close(uuid, text, text, uuid, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notice_case_reopen(p_client_id uuid, p_case_key text, p_actor_id uuid, p_actor_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n int; v_id uuid;
BEGIN
  IF NOT public.notice_case_admin(p_actor_id) THEN RETURN jsonb_build_object('error', 'Only a superadmin or GST manager can reopen a case.'); END IF;
  -- The latest notice of the case is reopened; the rest stay as they were.
  SELECT g.id INTO v_id FROM public.gst_notices g
   WHERE g.id IN (SELECT public.notice_case_notice_ids(p_client_id, p_case_key))
   ORDER BY g.issue_date DESC NULLS LAST, g.first_seen_at DESC LIMIT 1;
  UPDATE public.gst_notices SET stage = 'triaged', close_reason = NULL,
         edited_by_id = p_actor_id, edited_by_name = left(p_actor_name, 120), edited_at = now()
   WHERE id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('reopened', v_n, 'notice_id', v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_reopen(uuid, text, uuid, text) TO anon, authenticated, service_role;

-- ── 3. The views ────────────────────────────────────────────────────────────
-- notice_facts as in 20261012100000, without cases handled elsewhere or kinds the firm does not do.
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
     -- 20261010100000: a client whose litigation the firm does not handle is in no task, list, count or e-mail.
     AND coalesce(c.notices_handled, true)
     -- 20261013110000: a case another firm handles is out, and so is a kind of work the firm does not do for this client.
     AND g.excluded_at IS NULL
     AND NOT (public.notice_track(public.notice_category(g.notice_type, g.description, r.category)) = ANY (coalesce(c.notices_tracks_off, '{}'::text[])))
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
  -- 20261012100000: an order under appeal has met its clock (the appeal is the task now).
  coalesce(d.open_flag AND NOT d.replied_flag AND d.response_need <> 'none' AND coalesce(d.stage, '') <> 'appeal' AND d.eff_due < d.today_ist, false) AS is_overdue,
  coalesce(d.open_flag AND NOT d.replied_flag AND d.response_need <> 'none' AND coalesce(d.stage, '') <> 'appeal' AND d.eff_due BETWEEN d.today_ist AND d.today_ist + 7, false) AS is_due_in_7,
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

-- notice_cases as in 20261012100000, with whose move it is (waiting_on, appended).
CREATE OR REPLACE VIEW public.notice_cases AS
WITH n AS (
  SELECT f.*, public.notice_case_key(f.client_id, f.case_id, f.category, f.id) AS case_key, public.notice_track(f.category) AS track
    FROM public.notice_facts f
), lead AS (
  -- The notice the case is worked on: the open one due first, else the latest.
  SELECT DISTINCT ON (n.client_id, n.case_key) n.*
    FROM n
   ORDER BY n.client_id, n.case_key, n.is_open DESC, (CASE WHEN n.is_open THEN n.effective_due END) ASC NULLS LAST,
            n.issue_date DESC NULLS LAST, n.first_seen_at DESC
), agg AS (
  SELECT n.client_id, n.case_key,
         count(*)::int AS notices,
         count(*) FILTER (WHERE n.is_open)::int AS open_notices,
         coalesce(bool_and(n.is_replied) FILTER (WHERE n.is_open), false) AS all_replied,
         bool_or(n.is_open) AS is_open,
         coalesce(bool_or(n.is_open AND n.is_overdue), false) AS is_overdue,
         coalesce(bool_or(n.is_open AND n.is_due_in_7), false) AS is_due_in_7,
         coalesce(bool_or(n.is_open AND n.is_unassigned), false) AS is_unassigned,
         min(n.effective_due) FILTER (WHERE n.is_open) AS next_due,
         min(n.hearing_date) FILTER (WHERE n.hearing_date >= n.today_ist) AS next_hearing,
         min(n.issue_date) AS first_issue_date,
         max(n.issue_date) AS last_issue_date,
         coalesce(sum(n.exposure_amount) FILTER (WHERE n.is_open), 0) AS exposure,
         max(n.amount_of_demand) AS amount_of_demand,
         string_agg(DISTINCT public.notice_fy_key(n.financial_year), ', ') AS financial_years,
         array_agg(DISTINCT n.form_code) FILTER (WHERE n.form_code IS NOT NULL) AS forms,
         bool_or(n.on_dashboard) AS on_dashboard,
         CASE WHEN bool_or(n.track = 'litigation') THEN 'litigation' WHEN bool_or(n.track = 'refund') THEN 'refund'
              WHEN bool_or(n.track = 'registration') THEN 'registration' ELSE 'other' END AS track
    FROM n
   GROUP BY n.client_id, n.case_key
), corr AS (
  SELECT c.client_id, c.case_key,
         count(*) FILTER (WHERE c.kind = 'document')::int AS documents,
         count(*) FILTER (WHERE c.is_new)::int AS new_items,
         max(c.first_seen_at) FILTER (WHERE c.is_new) AS new_at,
         max(c.first_seen_at) AS last_arrived_at,
         max(c.seen_at) AS seen_at
    FROM public.notice_case_correspondence c
   GROUP BY c.client_id, c.case_key
), latest AS (
  SELECT DISTINCT ON (c.client_id, c.case_key) c.client_id, c.case_key, c.kind, c.label, c.from_party, c.item_date, c.first_seen_at, c.is_new
    FROM public.notice_case_correspondence c
   ORDER BY c.client_id, c.case_key, c.item_date DESC NULLS LAST, c.first_seen_at DESC
)
SELECT
  l.client_id, l.client_name, l.client_gstin, l.case_key,
  CASE WHEN l.case_key LIKE 'N:%' OR l.case_key = 'REG' THEN NULL ELSE l.case_key END AS case_id,
  a.track,
  CASE WHEN l.case_key = 'REG' THEN 'Registration' ELSE coalesce(l.form_label, l.notice_type, 'Notice') END AS title,
  l.id AS lead_notice_id, l.id, l.form_code, l.form_label, l.category, l.reference_number,
  l.stage, l.stage_label, l.stage_ord, l.assign_to, l.assign_to_user_id, l.effective_priority,
  coalesce(public.notice_fy_key(l.financial_year), split_part(a.financial_years, ', ', 1)) AS financial_year,
  a.financial_years, a.forms, a.notices, a.open_notices, a.is_open,
  (a.is_overdue AND w.waiting_on = 'us') AS is_overdue, (a.is_due_in_7 AND w.waiting_on = 'us') AS is_due_in_7, a.is_unassigned,
  a.next_due, a.next_hearing, a.first_issue_date, a.last_issue_date, a.exposure, a.amount_of_demand, a.on_dashboard,
  coalesce(co.documents, 0) AS documents, coalesce(co.new_items, 0) AS new_items, co.new_at, co.last_arrived_at, co.seen_at,
  lt.label AS latest_label, lt.kind AS latest_kind, lt.from_party AS latest_from, lt.item_date AS latest_date,
  greatest(a.last_issue_date, lt.item_date) AS last_activity_date,
  l.today_ist,
  w.waiting_on
FROM lead l
JOIN agg a ON a.client_id = l.client_id AND a.case_key = l.case_key
LEFT JOIN corr co ON co.client_id = l.client_id AND co.case_key = l.case_key
LEFT JOIN latest lt ON lt.client_id = l.client_id AND lt.case_key = l.case_key
-- 20261013110000: whose move it is. Closed; with the department when we have
-- replied, filed or appealed (the stage, every open notice replied, or the
-- latest paper is ours); else with us.
CROSS JOIN LATERAL (SELECT CASE
    WHEN NOT a.is_open THEN 'closed'
    WHEN l.stage IN ('filed', 'hearing', 'appeal') OR a.all_replied OR lt.from_party = 'taxpayer' THEN 'department'
    ELSE 'us' END AS waiting_on) w;

-- The counts per kind, with whose move it is.
CREATE OR REPLACE FUNCTION public.notice_cases_counts(p_filters jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_object_agg(t.track, t.counts), '{}'::jsonb)
    FROM (
      SELECT c.track, jsonb_build_object(
               'cases', count(*),
               'open', count(*) FILTER (WHERE c.is_open),
               'new', count(*) FILTER (WHERE c.new_items > 0),
               'new_items', coalesce(sum(c.new_items), 0),
               'overdue', count(*) FILTER (WHERE c.is_overdue),
               'due7', count(*) FILTER (WHERE c.is_due_in_7),
               'hearings', count(*) FILTER (WHERE c.next_hearing IS NOT NULL),
               'unassigned', count(*) FILTER (WHERE c.is_unassigned),
               'exposure', coalesce(sum(c.exposure), 0),
               'in_appeal', count(*) FILTER (WHERE c.is_open AND c.stage = 'appeal'),
               'with_us', count(*) FILTER (WHERE c.waiting_on = 'us'),
               'with_dept', count(*) FILTER (WHERE c.waiting_on = 'department'),
               'closed', count(*) FILTER (WHERE c.waiting_on = 'closed'),
               'next_due', min(c.next_due) FILTER (WHERE c.is_open AND c.next_due >= c.today_ist),
               'next_hearing', min(c.next_hearing),
               'oldest_overdue_days', max(c.today_ist - c.next_due) FILTER (WHERE c.is_overdue),
               'overdue_age', jsonb_build_object(
                 'd30', count(*) FILTER (WHERE c.is_overdue AND c.today_ist - c.next_due <= 30),
                 'd90', count(*) FILTER (WHERE c.is_overdue AND c.today_ist - c.next_due BETWEEN 31 AND 90),
                 'd365', count(*) FILTER (WHERE c.is_overdue AND c.today_ist - c.next_due BETWEEN 91 AND 365),
                 'older', count(*) FILTER (WHERE c.is_overdue AND c.today_ist - c.next_due > 365))) AS counts
        FROM public.notice_cases c
       WHERE public.notice_master_match(p_filters, c.client_id, c.financial_year, c.assign_to_user_id, c.form_code, c.effective_priority)
       GROUP BY c.track
    ) t
$$;
GRANT EXECUTE ON FUNCTION public.notice_cases_counts(jsonb) TO anon, authenticated, service_role;


-- ── 4. Documents read by Haiku ──────────────────────────────────────────────
ALTER TABLE public.ai_settings ADD COLUMN IF NOT EXISTS doc_model text NOT NULL DEFAULT 'claude-haiku-4-5';
COMMENT ON COLUMN public.ai_settings.doc_model IS 'The model that reads case folder documents (the firm''s choice of 12 October 2026: Haiku, to save tokens).';

-- ai_claim_next as in 20261009100000, documents with doc_model.
CREATE OR REPLACE FUNCTION public.ai_claim_next(p_agent text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s    public.ai_settings;
  v_x    public.notice_extractions;
  v_d    public.ai_documents;
  v_why  text;
  v_g    record;
  v_np   int;
  v_dp   int;
  v_kind text;
  i      int := 0;
BEGIN
  SELECT * INTO v_s FROM public.ai_settings WHERE id;
  IF NOT coalesce(v_s.read_enabled, false) THEN RETURN jsonb_build_object('idle', 'off'); END IF;
  IF coalesce(v_s.runner, 'edge') <> 'edge' THEN RETURN jsonb_build_object('idle', 'runner'); END IF;
  PERFORM public.ai_jobs_reap();
  IF public.ai_spend_today_usd() >= v_s.daily_cap_usd THEN RETURN jsonb_build_object('capped', true); END IF;
  LOOP
    i := i + 1;
    EXIT WHEN i > 25;
    v_x := NULL;
    v_d := NULL;
    SELECT x.priority INTO v_np FROM public.notice_extractions x
     WHERE x.source = 'ai' AND x.status = 'queued' AND (x.not_before IS NULL OR x.not_before <= now())
     ORDER BY x.priority DESC LIMIT 1;
    SELECT d.priority INTO v_dp FROM public.ai_documents d
     WHERE v_s.read_documents AND d.status = 'queued' AND (d.not_before IS NULL OR d.not_before <= now())
       AND NOT (d.role = 'reply' AND d.case_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.notice_extractions x2 JOIN public.gst_notices g2 ON g2.id = x2.notice_id
              WHERE g2.client_id = d.client_id AND g2.case_id = d.case_id AND x2.source = 'ai' AND x2.status IN ('queued', 'running')))
     ORDER BY d.priority DESC LIMIT 1;
    IF v_np IS NULL AND v_dp IS NULL THEN RETURN NULL; END IF;
    v_kind := CASE WHEN v_np IS NOT NULL AND (v_dp IS NULL OR v_np >= v_dp) THEN 'notice' ELSE 'document' END;

    IF v_kind = 'notice' THEN
      SELECT x.* INTO v_x FROM public.notice_extractions x JOIN public.gst_notices g ON g.id = x.notice_id
       WHERE x.source = 'ai' AND x.status = 'queued' AND (x.not_before IS NULL OR x.not_before <= now())
       ORDER BY x.priority DESC, g.issue_date DESC NULLS LAST, x.created_at
       LIMIT 1
       FOR UPDATE OF x SKIP LOCKED;
      IF v_x.id IS NULL THEN RETURN NULL; END IF;
      v_why := public.ai_read_allowed(v_x.client_id);
      IF v_why IS NOT NULL THEN
        UPDATE public.notice_extractions SET status = 'cancelled', reason_class = v_why, finished_at = now() WHERE id = v_x.id;
        CONTINUE;
      END IF;
      UPDATE public.notice_extractions
         SET status = 'running', agent_id = p_agent, claimed_at = now(), attempts = attempts + 1
       WHERE id = v_x.id;
      SELECT g.form_code, g.reference_number, g.issue_date, c.gstin
        INTO v_g FROM public.gst_notices g JOIN public.clients c ON c.id = g.client_id WHERE g.id = v_x.notice_id;
      RETURN jsonb_build_object(
        'kind', 'notice',
        'extraction_id', v_x.id, 'notice_id', v_x.notice_id, 'client_id', v_x.client_id,
        'document_url', v_x.document_url, 'document_label', v_x.document_label,
        'form_code', v_g.form_code, 'reference_number', v_g.reference_number, 'issue_date', v_g.issue_date,
        'client_gstin', v_g.gstin, 'attempt', v_x.attempts + 1,
        'model', v_s.model, 'effort', v_s.effort, 'max_pages', v_s.max_pages,
        'price_in_per_mtok', v_s.price_in_per_mtok, 'price_out_per_mtok', v_s.price_out_per_mtok,
        'issue_codes', (SELECT jsonb_agg(jsonb_build_object('code', t.code, 'title', t.title) ORDER BY t.sort)
                          FROM public.reply_issue_types t WHERE t.is_active));
    END IF;

    SELECT d.* INTO v_d FROM public.ai_documents d
     WHERE d.status = 'queued' AND (d.not_before IS NULL OR d.not_before <= now())
       AND NOT (d.role = 'reply' AND d.case_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.notice_extractions x2 JOIN public.gst_notices g2 ON g2.id = x2.notice_id
              WHERE g2.client_id = d.client_id AND g2.case_id = d.case_id AND x2.source = 'ai' AND x2.status IN ('queued', 'running')))
     ORDER BY d.priority DESC, d.sort_date DESC NULLS LAST, d.created_at
     LIMIT 1
     FOR UPDATE SKIP LOCKED;
    IF v_d.id IS NULL THEN RETURN NULL; END IF;
    v_why := public.ai_read_allowed(v_d.client_id);
    IF v_why IS NOT NULL THEN
      UPDATE public.ai_documents SET status = 'cancelled', reason_class = v_why, finished_at = now() WHERE id = v_d.id;
      CONTINUE;
    END IF;
    UPDATE public.ai_documents
       SET status = 'running', agent_id = p_agent, claimed_at = now(), attempts = attempts + 1
     WHERE id = v_d.id;
    SELECT g.form_code, g.reference_number, g.issue_date, g.financial_year, c.gstin
      INTO v_g FROM public.clients c LEFT JOIN public.gst_notices g ON g.id = v_d.notice_id WHERE c.id = v_d.client_id;
    RETURN jsonb_build_object(
      'kind', 'document',
      'document_id', v_d.id, 'client_id', v_d.client_id, 'notice_id', v_d.notice_id, 'case_id', v_d.case_id,
      'source', v_d.source, 'role', v_d.role, 'folder_section', v_d.folder_section,
      'document_url', v_d.url, 'document_label', v_d.label, 'body', v_d.body, 'context', coalesce(v_d.context, '{}'::jsonb),
      'form_code', v_g.form_code, 'reference_number', v_g.reference_number, 'issue_date', v_g.issue_date,
      'financial_year', v_g.financial_year, 'client_gstin', v_g.gstin, 'attempt', v_d.attempts + 1,
      'model', coalesce(nullif(v_s.doc_model, ''), v_s.model), 'effort', v_s.doc_effort, 'max_pages', v_s.doc_max_pages,
      'price_in_per_mtok', v_s.price_in_per_mtok, 'price_out_per_mtok', v_s.price_out_per_mtok,
      'issue_codes', (SELECT jsonb_agg(jsonb_build_object('code', t.code, 'title', t.title) ORDER BY t.sort)
                        FROM public.reply_issue_types t WHERE t.is_active),
      'case_paragraphs', CASE WHEN v_d.role = 'reply' THEN public.ai_case_paragraphs(v_d.client_id, v_d.case_id, v_d.notice_id) END);
  END LOOP;
  RETURN NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ai_claim_next(text) TO anon, authenticated, service_role;

-- ── 5. Advice written again, shorter ────────────────────────────────────────
UPDATE public.notice_case_advice SET inputs_hash = NULL WHERE status = 'done';
