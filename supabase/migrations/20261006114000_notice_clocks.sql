-- Notices Phase 1 · statutory clocks
-- (docs/NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf: roadmap Phase 1 task 5; findings L-09, L-32).
--
-- matter_deadlines existed, and the drawer, the litigation pages and the
-- limitation alert (E5) read it, but nothing ever wrote a row. This writer
-- keeps one row per notice and clock:
--   reply_due                the effective due date (portal, officer's extension,
--                            case folder, or the form's short clock) while the
--                            notice is open; met when a reply is logged
--   hearing                  the personal hearing date while the notice is open
--   appeal_s107 / _s112      the appeal window from the order date — a staff-
--                            logged order on the notice, or the notice itself when
--                            it is an appealable order (REG-19, DRC-07, MOV-09 for
--                            s.107; APL-04 for s.112)
--   appeal_s107_condonation  the outer limit with condonation
--   / appeal_s112_condonation
--   attachment_expiry        DRC-22 provisional attachment lapses after one year
-- Periods come from litigation_rules (keys appeal_months.*, appeal_condonation.*,
-- drc22_validity.s83). An appeal or attachment clock is kept until 30 days after
-- its last possible day (so a just-missed window still shows), then dropped:
-- orders from years ago carry no live clock. Each row carries its basis, the date it runs from, the
-- rule key and whether the firm has confirmed that period (litigation_rules
-- .confirmed_at). A date a person overrides (source = 'override') is never
-- replaced; computed_date keeps showing what the rule says beside it.

ALTER TABLE public.litigation_rules
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by text;

ALTER TABLE public.matter_deadlines
  ADD COLUMN IF NOT EXISTS computed_date date,
  ADD COLUMN IF NOT EXISTS base_date date,
  ADD COLUMN IF NOT EXISTS period_key text,
  ADD COLUMN IF NOT EXISTS period_confirmed boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.matter_deadlines.source IS
  'computed (written by notice_clocks_refresh) or override (a person set deadline_date; the writer then only updates computed_date).';

-- One row per notice and clock (nothing wrote this table before, so duplicates
-- are not expected; keep the newest if any exist).
DELETE FROM public.matter_deadlines a
 USING public.matter_deadlines b
 WHERE a.notice_id = b.notice_id AND a.deadline_type = b.deadline_type
   AND (a.updated_at < b.updated_at OR (a.updated_at = b.updated_at AND a.id < b.id));
CREATE UNIQUE INDEX IF NOT EXISTS uq_matter_deadlines_notice_type
  ON public.matter_deadlines (notice_id, deadline_type);

-- base + a litigation_rules period (unit months or days); NULL if the key is missing.
CREATE OR REPLACE FUNCTION public.litigation_rule_add(p_base date, p_key text)
RETURNS date
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN p_base IS NULL THEN NULL
           WHEN lr.unit = 'months' THEN (p_base + make_interval(months => lr.value::int))::date
           WHEN lr.unit = 'days' THEN p_base + lr.value::int
         END
    FROM public.litigation_rules lr
   WHERE lr.key = p_key
$$;

CREATE OR REPLACE FUNCTION public.notice_clocks_refresh(p_notice_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_written int := 0;
  v_removed int := 0;
BEGIN
  WITH n AS (
    SELECT g.id, g.client_id, g.issue_date, g.order_date, g.hearing_date, g.reply_date, g.form_code,
           NOT public.notice_is_closed(g.staff_status) AS is_open,
           r.appeal_section,
           coalesce(g.extended_due_date, g.due_date,
                    public.notice_computed_due(g.issue_date, g.case_id, g.form_code)) AS eff_due,
           CASE
             WHEN g.extended_due_date IS NOT NULL THEN 'Due date extended by the officer'
             WHEN g.due_date IS NOT NULL THEN
               CASE g.due_date_source
                 WHEN 'case_folder' THEN 'Due date in the portal case folder'
                 WHEN 'manual' THEN 'Due date entered with the notice'
                 ELSE 'Due date on the portal notice'
               END
             ELSE r.clock_basis
           END AS due_basis,
           (g.extended_due_date IS NOT NULL OR g.due_date IS NOT NULL OR r.confirmed_at IS NOT NULL) AS due_confirmed,
           CASE WHEN g.order_date IS NOT NULL THEN g.order_date
                WHEN r.appeal_section IS NOT NULL THEN g.issue_date END AS order_base,
           CASE WHEN r.appeal_section = 's112' THEN 's112' ELSE 's107' END AS appeal_sec,
           -- The last day an appeal can still be filed (with condonation).
           public.litigation_rule_add(
             public.litigation_rule_add(
               CASE WHEN g.order_date IS NOT NULL THEN g.order_date WHEN r.appeal_section IS NOT NULL THEN g.issue_date END,
               'appeal_months.' || CASE WHEN r.appeal_section = 's112' THEN 's112' ELSE 's107' END),
             'appeal_condonation.' || CASE WHEN r.appeal_section = 's112' THEN 's112' ELSE 's107' END) AS appeal_outer
      FROM public.gst_notices g
      LEFT JOIN public.notice_form_rules r ON r.form_code = g.form_code AND r.is_active
     WHERE g.deleted_at IS NULL AND g.source = 'notices'
       AND (p_notice_id IS NULL OR g.id = p_notice_id)
  ),
  desired AS (
    SELECT n.id AS notice_id, n.client_id, 'reply_due'::text AS deadline_type, n.eff_due AS d,
           n.due_basis AS basis, NULL::date AS base_date, NULL::text AS period_key,
           n.due_confirmed AS confirmed, (n.reply_date IS NOT NULL) AS met, n.reply_date AS met_on
      FROM n WHERE n.is_open AND n.eff_due IS NOT NULL
    UNION ALL
    SELECT n.id, n.client_id, 'hearing', n.hearing_date, 'Personal hearing fixed by the officer',
           NULL, NULL, true, false, NULL
      FROM n WHERE n.is_open AND n.hearing_date IS NOT NULL
    UNION ALL
    SELECT n.id, n.client_id, 'appeal_' || n.appeal_sec,
           public.litigation_rule_add(n.order_base, 'appeal_months.' || n.appeal_sec),
           coalesce(lr.note, 'Appeal period') || ', from the order dated ' || to_char(n.order_base, 'DD Mon YYYY'),
           n.order_base, lr.key, lr.confirmed_at IS NOT NULL, false, NULL
      FROM n JOIN public.litigation_rules lr ON lr.key = 'appeal_months.' || n.appeal_sec
     WHERE n.order_base IS NOT NULL AND n.appeal_outer >= public.ist_today() - 30
    UNION ALL
    SELECT n.id, n.client_id, 'appeal_' || n.appeal_sec || '_condonation',
           public.litigation_rule_add(public.litigation_rule_add(n.order_base, 'appeal_months.' || n.appeal_sec),
                                      'appeal_condonation.' || n.appeal_sec),
           coalesce(lr.note, 'Condonation window') || ' (outer limit), from the order dated '
             || to_char(n.order_base, 'DD Mon YYYY'),
           n.order_base, lr.key, lr.confirmed_at IS NOT NULL, false, NULL
      FROM n JOIN public.litigation_rules lr ON lr.key = 'appeal_condonation.' || n.appeal_sec
     WHERE n.order_base IS NOT NULL AND n.appeal_outer >= public.ist_today() - 30
    UNION ALL
    SELECT n.id, n.client_id, 'attachment_expiry',
           public.litigation_rule_add(n.issue_date, 'drc22_validity.s83'),
           coalesce(lr.note, 'Provisional attachment validity') || ', from the attachment dated '
             || to_char(n.issue_date, 'DD Mon YYYY'),
           n.issue_date, lr.key, lr.confirmed_at IS NOT NULL, false, NULL
      FROM n JOIN public.litigation_rules lr ON lr.key = 'drc22_validity.s83'
     WHERE n.form_code = 'DRC-22' AND n.issue_date IS NOT NULL
       AND public.litigation_rule_add(n.issue_date, 'drc22_validity.s83') >= public.ist_today() - 30
  ),
  written AS (
    INSERT INTO public.matter_deadlines AS m
      (notice_id, client_id, deadline_type, deadline_date, computed_date, statutory_basis, source,
       is_met, met_at, met_by, base_date, period_key, period_confirmed)
    SELECT d.notice_id, d.client_id, d.deadline_type, d.d, d.d, d.basis, 'computed',
           d.met, d.met_on::timestamptz, CASE WHEN d.met THEN 'auto: reply logged' END,
           d.base_date, d.period_key, d.confirmed
      FROM desired d
     WHERE d.d IS NOT NULL
    ON CONFLICT (notice_id, deadline_type) DO UPDATE SET
      computed_date    = EXCLUDED.computed_date,
      deadline_date    = CASE WHEN m.source = 'override' THEN m.deadline_date ELSE EXCLUDED.deadline_date END,
      statutory_basis  = EXCLUDED.statutory_basis,
      base_date        = EXCLUDED.base_date,
      period_key       = EXCLUDED.period_key,
      period_confirmed = EXCLUDED.period_confirmed,
      is_met           = CASE WHEN m.deadline_type = 'reply_due' THEN EXCLUDED.is_met ELSE m.is_met END,
      met_at           = CASE WHEN m.deadline_type = 'reply_due' THEN EXCLUDED.met_at ELSE m.met_at END,
      met_by           = CASE WHEN m.deadline_type = 'reply_due' THEN EXCLUDED.met_by ELSE m.met_by END,
      updated_at       = now()
    WHERE (m.computed_date, m.deadline_date, m.statutory_basis, m.base_date, m.period_key, m.period_confirmed,
           m.is_met, m.met_at)
          IS DISTINCT FROM
          (EXCLUDED.computed_date,
           CASE WHEN m.source = 'override' THEN m.deadline_date ELSE EXCLUDED.deadline_date END,
           EXCLUDED.statutory_basis, EXCLUDED.base_date, EXCLUDED.period_key, EXCLUDED.period_confirmed,
           CASE WHEN m.deadline_type = 'reply_due' THEN EXCLUDED.is_met ELSE m.is_met END,
           CASE WHEN m.deadline_type = 'reply_due' THEN EXCLUDED.met_at ELSE m.met_at END)
    RETURNING 1
  ),
  removed AS (
    DELETE FROM public.matter_deadlines m
     WHERE m.source = 'computed'
       AND (p_notice_id IS NULL OR m.notice_id = p_notice_id)
       AND NOT EXISTS (SELECT 1 FROM desired d
                        WHERE d.notice_id = m.notice_id AND d.deadline_type = m.deadline_type AND d.d IS NOT NULL)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM written), (SELECT count(*) FROM removed) INTO v_written, v_removed;

  RETURN jsonb_build_object('written', v_written, 'removed', v_removed);
END;
$$;

COMMENT ON FUNCTION public.notice_clocks_refresh(uuid) IS
  'Writes matter_deadlines for one notice (or all when NULL): reply due, hearing, s.107/s.112 appeal and condonation from the order date, DRC-22 attachment expiry. Never replaces an override.';
GRANT EXECUTE ON FUNCTION public.notice_clocks_refresh(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gst_notices_refresh_clocks()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.notice_clocks_refresh(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_gst_notices_clocks_insert ON public.gst_notices;
CREATE TRIGGER trg_gst_notices_clocks_insert
  AFTER INSERT ON public.gst_notices
  FOR EACH ROW EXECUTE FUNCTION public.gst_notices_refresh_clocks();

DROP TRIGGER IF EXISTS trg_gst_notices_clocks_update ON public.gst_notices;
CREATE TRIGGER trg_gst_notices_clocks_update
  AFTER UPDATE ON public.gst_notices
  FOR EACH ROW
  WHEN (OLD.due_date IS DISTINCT FROM NEW.due_date
     OR OLD.extended_due_date IS DISTINCT FROM NEW.extended_due_date
     OR OLD.due_date_source IS DISTINCT FROM NEW.due_date_source
     OR OLD.hearing_date IS DISTINCT FROM NEW.hearing_date
     OR OLD.order_date IS DISTINCT FROM NEW.order_date
     OR OLD.reply_date IS DISTINCT FROM NEW.reply_date
     OR OLD.staff_status IS DISTINCT FROM NEW.staff_status
     OR OLD.issue_date IS DISTINCT FROM NEW.issue_date
     OR OLD.form_code IS DISTINCT FROM NEW.form_code
     OR OLD.case_id IS DISTINCT FROM NEW.case_id
     OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION public.gst_notices_refresh_clocks();

-- A changed period, form rule or clock start date re-computes every clock.
CREATE OR REPLACE FUNCTION public.notice_clocks_refresh_all_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.notice_clocks_refresh(NULL);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_litigation_rules_clocks ON public.litigation_rules;
CREATE TRIGGER trg_litigation_rules_clocks
  AFTER INSERT OR UPDATE OR DELETE ON public.litigation_rules
  FOR EACH STATEMENT EXECUTE FUNCTION public.notice_clocks_refresh_all_trigger();
DROP TRIGGER IF EXISTS trg_notice_form_rules_clocks ON public.notice_form_rules;
CREATE TRIGGER trg_notice_form_rules_clocks
  AFTER INSERT OR UPDATE OR DELETE ON public.notice_form_rules
  FOR EACH STATEMENT EXECUTE FUNCTION public.notice_clocks_refresh_all_trigger();
DROP TRIGGER IF EXISTS trg_notice_settings_clocks ON public.notice_settings;
CREATE TRIGGER trg_notice_settings_clocks
  AFTER UPDATE ON public.notice_settings
  FOR EACH STATEMENT EXECUTE FUNCTION public.notice_clocks_refresh_all_trigger();

-- Write the clocks for what is already on file.
SELECT public.notice_clocks_refresh(NULL);
