-- Notices Phase 1 · one canonical notice set
-- (docs/NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf: roadmap Phase 1 task 6; findings L-04, L-12,
-- L-13, L-21, L-24, L-26, L-27, L-35, L-36).
--
-- Every tile, list, report, e-mail and MIS used to re-derive "open", "overdue",
-- "due in 7 days", "new", the category and the exposure on its own, in the
-- browser's clock, with small differences — so a tile said 14 and the list it
-- opened showed 69. notice_facts states each definition once, in SQL, on the
-- IST calendar date; the app, the alert engine and the tests all read it.
--
-- Definitions (also in docs/NOTICES_LITIGATION_POSITIONS.md §2):
--   open         staff_status does not start with Closed/Withdrawn/Dropped/
--                Disposed/Deleted/Adjudged
--   replied      reply_date is set
--   effective due extended_due_date, else the portal due_date, else the short
--                clock of the form (portal-list notices issued on/after
--                notice_settings.computed_clock_from only)
--   overdue      open, not replied, effective due before today (IST)
--   due in 7     open, not replied, effective due today .. today + 7 (IST)
--   new          first seen by a sync in the last 24 hours
--   exposure     open notice not linked to a litigation matter, with a demand,
--                counted once per dispute (case id, else reference number) at
--                the latest notice's amount; a linked matter's own outstanding
--                demand is counted from the matter instead (notice_exposure).

-- One-row settings for the notices module (the alert engine adds its own columns).
CREATE TABLE IF NOT EXISTS public.notice_settings (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  computed_clock_from  date NOT NULL DEFAULT date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::date,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text
);
COMMENT ON COLUMN public.notice_settings.computed_clock_from IS
  'Short reply clocks (notice_form_rules.reply_days) apply only to notices issued on or after this date; older notices without a portal due date stay in the triage bucket instead of turning overdue at go-live.';
INSERT INTO public.notice_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.notice_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notice_settings_public" ON public.notice_settings;
CREATE POLICY "notice_settings_public" ON public.notice_settings FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.notice_settings TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ist_today()
RETURNS date
LANGUAGE sql STABLE
AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

-- Working days for the REG-series clocks: Sundays are skipped, Saturdays and
-- public holidays are counted, so a computed date is never later than the
-- real one (the safe side).
CREATE OR REPLACE FUNCTION public.add_working_days(p_from date, p_days int)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  d date := p_from;
  n int := 0;
BEGIN
  IF p_from IS NULL OR p_days IS NULL THEN RETURN NULL; END IF;
  WHILE n < p_days LOOP
    d := d + 1;
    IF extract(isodow FROM d) <> 7 THEN n := n + 1; END IF;
  END LOOP;
  RETURN d;
END;
$$;

CREATE OR REPLACE FUNCTION public.notice_is_closed(p_status text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$ SELECT coalesce(btrim(p_status), '') ~* '^(closed|withdrawn|dropped|disposed|deleted|adjudged)' $$;

-- The form's short clock, from the issue date — the same definition the
-- canonical view uses (portal-list notices issued on/after computed_clock_from).
CREATE OR REPLACE FUNCTION public.notice_computed_due(p_issue date, p_case_id text, p_form_code text)
RETURNS date
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN r.reply_days IS NULL OR p_issue IS NULL OR p_case_id IS NOT NULL
                OR p_issue < s.computed_clock_from THEN NULL
           WHEN r.reply_day_kind = 'working' THEN public.add_working_days(p_issue, r.reply_days)
           ELSE p_issue + r.reply_days
         END
    FROM public.notice_settings s
    LEFT JOIN public.notice_form_rules r ON r.form_code = p_form_code AND r.is_active
   WHERE s.id
$$;

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
         public.ist_today() AS today_ist
    FROM public.gst_notices g
    JOIN public.clients c ON c.id = g.client_id
    LEFT JOIN public.notice_form_rules r ON r.form_code = g.form_code AND r.is_active
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
  coalesce(d.rule_category, public.notice_category_legacy(d.notice_type, d.description)) AS category,
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
  coalesce(d.open_flag AND NOT d.replied_flag AND d.eff_due < d.today_ist, false) AS is_overdue,
  coalesce(d.open_flag AND NOT d.replied_flag AND d.eff_due BETWEEN d.today_ist AND d.today_ist + 7, false) AS is_due_in_7,
  coalesce(d.first_seen_at > now() - interval '24 hours', false) AS is_new,
  (d.open_flag AND d.assign_to_user_id IS NULL) AS is_unassigned,
  d.dispute AS dispute_key,
  CASE WHEN d.exposure_candidate
        AND row_number() OVER (PARTITION BY d.client_id, d.dispute, d.exposure_candidate
                               ORDER BY d.issue_date DESC NULLS LAST, d.id) = 1
       THEN d.amount_of_demand ELSE 0 END AS exposure_amount,
  d.today_ist
FROM derived d;

COMMENT ON VIEW public.notice_facts IS
  'Canonical notice set: live portal notices (source notices, not soft-deleted) with every derived flag the module uses. Definitions: docs/NOTICES_LITIGATION_POSITIONS.md section 2.';
GRANT SELECT ON public.notice_facts TO anon, authenticated, service_role;

-- Refunds and DRC-03 as one set each: the dedicated table's rows plus the
-- refund / voluntary-payment case rows that no dedicated row covers (same
-- ARN = same case). The Notice Summary's Refund and DRC 03 rows count these,
-- and the Refunds / DRC-03 lists show exactly these rows.
CREATE OR REPLACE VIEW public.refund_facts WITH (security_invoker = true) AS
SELECT 'application'::text AS origin, a.id, a.client_id, c.name AS client_name, c.gstin AS client_gstin,
       a.arn, a.refund_type, a.filed_date, a.status, a.claimed_amount, a.sanctioned_amount, a.documents,
       NULL::uuid AS notice_id,
       coalesce(a.status ~* 'disburs|withdraw|reject|recredit', false) AS is_closed
  FROM public.gst_refund_applications a
  JOIN public.clients c ON c.id = a.client_id
 WHERE a.deleted_at IS NULL
UNION ALL
(SELECT DISTINCT ON (f.client_id, f.case_id)
        'case'::text, f.id, f.client_id, f.client_name, f.client_gstin,
        f.case_id, f.notice_type, f.issue_date, f.staff_status, NULL::numeric, NULL::numeric, NULL::jsonb,
        f.id,
        NOT f.is_open
   FROM public.notice_facts f
  WHERE f.is_refund_case AND f.case_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.gst_refund_applications a
                     WHERE a.deleted_at IS NULL AND a.client_id = f.client_id AND a.arn = f.case_id)
  ORDER BY f.client_id, f.case_id, f.issue_date DESC NULLS LAST, f.id);
GRANT SELECT ON public.refund_facts TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.drc03_facts WITH (security_invoker = true) AS
SELECT 'filing'::text AS origin, d.id, d.client_id, c.name AS client_name, c.gstin AS client_gstin,
       d.arn, d.cause_of_payment, d.filed_date, d.status, d.pdf_url,
       NULL::uuid AS notice_id,
       coalesce(d.status ~* 'acknowledg', false) AS is_closed
  FROM public.gst_drc03_filings d
  JOIN public.clients c ON c.id = d.client_id
 WHERE d.deleted_at IS NULL
UNION ALL
(SELECT DISTINCT ON (f.client_id, f.case_id)
        'case'::text, f.id, f.client_id, f.client_name, f.client_gstin,
        f.case_id, f.description, f.issue_date, f.staff_status, f.pdf_url,
        f.id,
        NOT f.is_open
   FROM public.notice_facts f
  WHERE f.is_drc03_case AND f.case_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.gst_drc03_filings d
                     WHERE d.deleted_at IS NULL AND d.client_id = f.client_id AND d.arn = f.case_id)
  ORDER BY f.client_id, f.case_id, f.issue_date DESC NULLS LAST, f.id);
GRANT SELECT ON public.drc03_facts TO anon, authenticated, service_role;

-- Exposure, one row per dispute: open unlinked notices (from notice_facts) and
-- open litigation matters (demand less paid less pre-deposit, as the
-- Litigation MIS computes it). Dashboard, GSTIN-wise count and MIS sum this.
CREATE OR REPLACE VIEW public.notice_exposure WITH (security_invoker = true) AS
SELECT 'notice'::text AS kind, f.id AS ref_id, f.client_id, f.exposure_amount AS amount
  FROM public.notice_facts f
 WHERE f.exposure_amount > 0
UNION ALL
SELECT 'matter'::text, m.id, m.client_id,
       coalesce(m.demand_tax, 0) + coalesce(m.demand_interest, 0) + coalesce(m.demand_penalty, 0)
         + coalesce(m.demand_cess, 0) - coalesce(m.paid_total, 0) - coalesce(m.pre_deposit_total, 0)
  FROM public.litigation_matters m
 WHERE lower(coalesce(m.status, '')) <> 'closed'
   AND coalesce(m.demand_tax, 0) + coalesce(m.demand_interest, 0) + coalesce(m.demand_penalty, 0)
         + coalesce(m.demand_cess, 0) - coalesce(m.paid_total, 0) - coalesce(m.pre_deposit_total, 0) <> 0;
GRANT SELECT ON public.notice_exposure TO anon, authenticated, service_role;

-- The dashboard's numbers in one call, from the same set the lists read
-- (used by the alert e-mails, the weekly MIS and the tests). p_category
-- narrows to one category, like the dashboard's category filter.
CREATE OR REPLACE FUNCTION public.notices_dashboard_summary(p_category text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'open',            count(*) FILTER (WHERE f.is_open),
    'overdue',         count(*) FILTER (WHERE f.is_overdue),
    'due_in_7',        count(*) FILTER (WHERE f.is_due_in_7),
    'new',             count(*) FILTER (WHERE f.is_new),
    'new_gstins',      count(DISTINCT f.client_id) FILTER (WHERE f.is_new),
    'unassigned',      count(*) FILTER (WHERE f.is_unassigned),
    'replied',         count(*) FILTER (WHERE f.is_replied),
    'demand_at_risk',  coalesce(sum(f.amount_of_demand) FILTER (WHERE f.is_overdue), 0),
    'oldest_overdue_days', coalesce(max(-f.days_to_due) FILTER (WHERE f.is_overdue), 0),
    'notice_exposure', coalesce(sum(f.exposure_amount), 0),
    'notice_exposure_count', count(*) FILTER (WHERE f.exposure_amount > 0),
    'today_ist',       public.ist_today()
  )
  FROM public.notice_facts f
  WHERE p_category IS NULL OR f.category = p_category
$$;
GRANT EXECUTE ON FUNCTION public.notices_dashboard_summary(text) TO anon, authenticated, service_role;
