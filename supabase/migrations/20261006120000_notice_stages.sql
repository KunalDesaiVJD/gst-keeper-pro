-- Notices Phase 2 · one stage vocabulary
-- (docs/NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf: roadmap Phase 2 task 3; findings
-- L-25, U-13-2, U-31-1, U-42-1, U-45-3).
--
-- Before: the dashboard queue offered nine statuses, the drawer drew a nine-step
-- stepper from a regex over the free-text staff_status, the list offered Open /
-- Closed, and matters had their own eleven stages. Now one vocabulary:
--
--   New → Triaged → Evidence → Waiting on client → Draft → Partner review →
--   Filed → Hearing → Order → Appeal → Closed
--
-- held in public.notice_stages and stored as a key in gst_notices.stage and
-- litigation_matters.stage. staff_status stays, as a mirror the Phase 0–1
-- logic reads (notice_is_closed, the closing sweep, the alert engine):
--   * setting stage writes staff_status (the stage's label; NULL for New;
--     'Closed' unless a closed variant such as 'Withdrawn' is already there);
--   * a writer that still sets only staff_status (the sweep, an older screen)
--     moves stage to match;
--   * facts move the stage forward when nobody set it in the same write:
--       a staff member sets the owner of a New notice      → Triaged
--       a reply is logged before Filed                      → Filed
--       an order is logged before Order                     → Order
--       a hearing date (today or later) is fixed once Filed → Hearing
--     Nothing ever moves a notice backwards by itself.
-- These are positions (docs/NOTICES_LITIGATION_POSITIONS.md §13), not law.

-- ── The vocabulary ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notice_stages (
  key         text PRIMARY KEY,
  ord         int  NOT NULL UNIQUE,
  label       text NOT NULL,
  description text NOT NULL,
  is_closed   boolean NOT NULL DEFAULT false
);
COMMENT ON TABLE public.notice_stages IS
  'The one workflow vocabulary for notices and matters (Phase 2). Keys are stored in gst_notices.stage and litigation_matters.stage.';

INSERT INTO public.notice_stages (key, ord, label, description, is_closed) VALUES
  ('new',            10, 'New',               'Captured; nobody has acted on it yet', false),
  ('triaged',        20, 'Triaged',           'Owner set and the next step decided', false),
  ('evidence',       30, 'Evidence',          'Reconciliations and working being built', false),
  ('waiting_client', 40, 'Waiting on client', 'Documents or data requested from the client', false),
  ('draft',          50, 'Draft',             'Reply being drafted', false),
  ('partner_review', 60, 'Partner review',    'Draft with a partner for approval', false),
  ('filed',          70, 'Filed',             'Reply filed; awaiting the officer', false),
  ('hearing',        80, 'Hearing',           'Personal hearing fixed or attended', false),
  ('order',          90, 'Order',             'Order received; accept, rectify or appeal', false),
  ('appeal',        100, 'Appeal',            'Appeal or further proceedings under way', false),
  ('closed',        110, 'Closed',            'Nothing more to do', true)
ON CONFLICT (key) DO UPDATE
  SET ord = EXCLUDED.ord, label = EXCLUDED.label,
      description = EXCLUDED.description, is_closed = EXCLUDED.is_closed;

ALTER TABLE public.notice_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notice_stages_read" ON public.notice_stages;
CREATE POLICY "notice_stages_read" ON public.notice_stages FOR SELECT TO public USING (true);
GRANT SELECT ON public.notice_stages TO anon, authenticated, service_role;

-- Any spelling the module has used for a stage or status → a key (NULL when
-- the text is not a stage at all).
CREATE OR REPLACE FUNCTION public.notice_stage_key(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_text IS NULL OR btrim(p_text) = '' THEN NULL
    WHEN public.notice_is_closed(p_text) THEN 'closed'
    ELSE (
      SELECT CASE
        WHEN t IN ('new', 'captured', 'no status') THEN 'new'
        WHEN t IN ('triaged', 'triage', 'open', 'assigned', 'in progress', 'under review') THEN 'triaged'
        WHEN t IN ('evidence', 'evidence built', 'working') THEN 'evidence'
        WHEN t IN ('waiting_client', 'waiting on client', 'awaiting data', 'awaiting client data',
                   'awaiting_data', 'awaiting documents', 'documents requested') THEN 'waiting_client'
        WHEN t IN ('draft', 'reply drafted', 'reply drafting', 'reply_drafting', 'drafting', 'draft ready') THEN 'draft'
        WHEN t IN ('partner_review', 'partner review', 'review') THEN 'partner_review'
        WHEN t IN ('filed', 'filed/submitted', 'reply filed', 'submitted') THEN 'filed'
        WHEN t IN ('hearing', 'hearing fixed') THEN 'hearing'
        WHEN t IN ('order', 'order received', 'ordered') THEN 'order'
        WHEN t IN ('appeal', 'appeal decision', 'appeal filed', 'appealed') THEN 'appeal'
      END
      FROM (SELECT lower(btrim(p_text)) AS t) s
    )
  END
$$;

-- The stage a row is at when only its status and facts are known (back-fill,
-- and writers that set staff_status only). p_floor: never move below it.
CREATE OR REPLACE FUNCTION public.notice_stage_from_status(
  p_status text, p_reply date, p_order date, p_owner uuid, p_floor text DEFAULT NULL)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  WITH k AS (SELECT public.notice_stage_key(p_status) AS key),
  derived AS (
    SELECT CASE
      WHEN k.key = 'closed' THEN 'closed'
      WHEN k.key IS NOT NULL AND k.key <> 'new' AND k.key <> 'triaged' THEN k.key
      WHEN p_order IS NOT NULL THEN 'order'
      WHEN p_reply IS NOT NULL THEN 'filed'
      WHEN k.key = 'triaged' OR p_owner IS NOT NULL
           OR (p_status IS NOT NULL AND btrim(p_status) <> '' AND k.key IS NULL) THEN 'triaged'
      ELSE 'new'
    END AS key
    FROM k
  )
  SELECT CASE
    WHEN p_floor IS NULL OR d.key = 'closed' OR p_floor = 'closed' THEN d.key
    WHEN (SELECT ord FROM public.notice_stages WHERE key = d.key)
         < (SELECT ord FROM public.notice_stages WHERE key = p_floor) THEN p_floor
    ELSE d.key
  END
  FROM derived d
$$;

-- The status text a stage writes into staff_status.
CREATE OR REPLACE FUNCTION public.notice_stage_status(p_stage text, p_current text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_stage = 'new' THEN NULL
    WHEN p_stage = 'closed' THEN
      CASE WHEN public.notice_is_closed(p_current) THEN p_current ELSE 'Closed' END
    ELSE (SELECT label FROM public.notice_stages WHERE key = p_stage)
  END
$$;

-- ── gst_notices.stage ──────────────────────────────────────────────────────
ALTER TABLE public.gst_notices
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stage_changed_by text,
  ADD COLUMN IF NOT EXISTS hearing_note text;
COMMENT ON COLUMN public.gst_notices.hearing_note IS 'A hearing''s time, venue and officer, typed with hearing_date.';
COMMENT ON COLUMN public.gst_notices.stage IS
  'Workflow stage (public.notice_stages.key). staff_status mirrors it; see 20261006120000_notice_stages.sql.';

UPDATE public.gst_notices
   SET stage = public.notice_stage_from_status(staff_status, reply_date, order_date, assign_to_user_id)
 WHERE stage IS NULL;
UPDATE public.gst_notices
   SET stage_changed_at = coalesce(edited_at, updated_at, first_seen_at, created_at, now())
 WHERE stage_changed_at IS NULL;
ALTER TABLE public.gst_notices ALTER COLUMN stage SET DEFAULT 'new';
ALTER TABLE public.gst_notices ALTER COLUMN stage SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gst_notices_stage_fkey') THEN
    ALTER TABLE public.gst_notices
      ADD CONSTRAINT gst_notices_stage_fkey FOREIGN KEY (stage) REFERENCES public.notice_stages (key);
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS idx_gst_notices_stage ON public.gst_notices (stage) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.gst_notices_stage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_staff boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage IS NULL OR NEW.stage = 'new' THEN
      -- Stage from the status and facts given (never from an auto-owner).
      NEW.stage := public.notice_stage_from_status(NEW.staff_status, NEW.reply_date, NEW.order_date, NULL);
      -- A spelling of a stage becomes its label, other wording is kept as typed.
      IF NEW.stage <> 'closed' AND public.notice_stage_key(NEW.staff_status) IS NOT NULL THEN
        NEW.staff_status := public.notice_stage_status(NEW.stage, NEW.staff_status);
      END IF;
    ELSE
      NEW.staff_status := public.notice_stage_status(NEW.stage, NEW.staff_status);
    END IF;
    NEW.stage_changed_at := coalesce(NEW.stage_changed_at, now());
    RETURN NEW;
  END IF;

  v_staff := NEW.edited_at IS DISTINCT FROM OLD.edited_at;

  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    -- Stage set by the writer: staff_status follows, reopening clears the
    -- close reason of the earlier closure.
    NEW.staff_status := public.notice_stage_status(NEW.stage, NEW.staff_status);
    IF OLD.stage = 'closed' AND NEW.stage <> 'closed'
       AND NEW.close_reason IS NOT DISTINCT FROM OLD.close_reason THEN
      NEW.close_reason := NULL;
    END IF;
  ELSIF NEW.staff_status IS DISTINCT FROM OLD.staff_status THEN
    -- Only staff_status set (closing sweep, an older screen): stage follows.
    NEW.stage := public.notice_stage_from_status(
      NEW.staff_status, NEW.reply_date, NEW.order_date, NEW.assign_to_user_id,
      CASE WHEN public.notice_is_closed(NEW.staff_status) OR OLD.stage = 'closed' THEN NULL ELSE OLD.stage END);
    IF NEW.stage <> 'closed' AND public.notice_stage_key(NEW.staff_status) IS NOT NULL THEN
      NEW.staff_status := public.notice_stage_status(NEW.stage, NEW.staff_status);
    END IF;
  ELSE
    -- Neither set: facts move the stage forward, never back.
    IF OLD.order_date IS NULL AND NEW.order_date IS NOT NULL
       AND NEW.stage NOT IN ('order', 'appeal', 'closed') THEN
      NEW.stage := 'order';
    ELSIF OLD.reply_date IS NULL AND NEW.reply_date IS NOT NULL
       AND NEW.stage IN ('new', 'triaged', 'evidence', 'waiting_client', 'draft', 'partner_review') THEN
      NEW.stage := 'filed';
    ELSIF NEW.hearing_date IS DISTINCT FROM OLD.hearing_date AND NEW.hearing_date >= public.ist_today()
       AND NEW.stage = 'filed' THEN
      NEW.stage := 'hearing';
    ELSIF v_staff AND OLD.assign_to_user_id IS NULL AND NEW.assign_to_user_id IS NOT NULL
       AND NEW.stage = 'new' THEN
      NEW.stage := 'triaged';
    END IF;
    IF NEW.stage IS DISTINCT FROM OLD.stage THEN
      NEW.staff_status := public.notice_stage_status(NEW.stage, NEW.staff_status);
    END IF;
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_changed_at := now();
    NEW.stage_changed_by := coalesce(
      CASE WHEN v_staff THEN nullif(NEW.edited_by_name, '') END,
      nullif(current_setting('app.actor_name', true), ''),
      CASE WHEN NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at THEN 'Portal sync' END,
      'System');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gst_notices_stage ON public.gst_notices;
CREATE TRIGGER trg_gst_notices_stage
  BEFORE INSERT OR UPDATE ON public.gst_notices
  FOR EACH ROW EXECUTE FUNCTION public.gst_notices_stage();

-- ── Events: one stage_changed event per move (replaces the staff_status ─────
-- block of 20261006112000; closed / reopened are kept for the alert rules).
CREATE OR REPLACE FUNCTION public.gst_notices_log_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff     boolean;
  v_actor_id  uuid;
  v_actor     text;
  v_source    text;
  v_named     text := nullif(current_setting('app.actor_name', true), '');
  v_old_due   date;
  v_new_due   date;
BEGIN
  v_staff := CASE WHEN TG_OP = 'INSERT' THEN NEW.edited_at IS NOT NULL
                  ELSE NEW.edited_at IS DISTINCT FROM OLD.edited_at END;
  IF v_staff THEN
    v_actor_id := NEW.edited_by_id;
    v_actor := coalesce(nullif(NEW.edited_by_name, ''), 'Staff');
    v_source := 'staff';
  ELSIF v_named IS NOT NULL THEN
    v_actor := v_named;
    v_source := CASE WHEN v_named = 'Portal sync' THEN 'sync' ELSE 'system' END;
  ELSIF TG_OP = 'INSERT'
        OR NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at
        OR NEW.pulled_at IS DISTINCT FROM OLD.pulled_at
        OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    v_actor := 'Portal sync';
    v_source := 'sync';
  ELSE
    v_actor := 'System';
    v_source := 'system';
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notice_events (notice_id, client_id, event_type, new_value, actor_id, actor_name, source)
    VALUES (NEW.id, NEW.client_id, 'captured',
            jsonb_build_object('reference_number', NEW.reference_number, 'notice_type', NEW.notice_type,
                               'form_code', NEW.form_code, 'issue_date', NEW.issue_date,
                               'due_date', NEW.due_date, 'manual', NEW.portal_key LIKE 'manual:%',
                               'stage', NEW.stage),
            v_actor_id, v_actor, v_source);
    RETURN NULL;
  END IF;

  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    INSERT INTO public.notice_events (notice_id, client_id, event_type, old_value, actor_id, actor_name, source)
    VALUES (NEW.id, NEW.client_id, 'removed',
            jsonb_build_object('reference_number', NEW.reference_number, 'last_seen_at', OLD.last_seen_at),
            v_actor_id, v_actor, v_source);
    RETURN NULL;
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    INSERT INTO public.notice_events (notice_id, client_id, event_type, new_value, actor_id, actor_name, source)
    VALUES (NEW.id, NEW.client_id, 'restored',
            jsonb_build_object('reference_number', NEW.reference_number), v_actor_id, v_actor, v_source);
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.notice_events (notice_id, client_id, event_type, old_value, new_value, actor_id, actor_name, source)
    VALUES (NEW.id, NEW.client_id,
            CASE WHEN NEW.stage = 'closed' THEN 'closed'
                 WHEN OLD.stage = 'closed' THEN 'reopened'
                 ELSE 'stage_changed' END,
            jsonb_build_object('stage', OLD.stage, 'staff_status', OLD.staff_status),
            jsonb_build_object('stage', NEW.stage, 'staff_status', NEW.staff_status, 'close_reason', NEW.close_reason),
            v_actor_id, v_actor, v_source);
  ELSIF NEW.staff_status IS DISTINCT FROM OLD.staff_status THEN
    -- Same stage, different wording (e.g. Closed → Withdrawn).
    INSERT INTO public.notice_events (notice_id, client_id, event_type, old_value, new_value, actor_id, actor_name, source)
    VALUES (NEW.id, NEW.client_id, 'status_changed',
            jsonb_build_object('staff_status', OLD.staff_status),
            jsonb_build_object('staff_status', NEW.staff_status, 'close_reason', NEW.close_reason),
            v_actor_id, v_actor, v_source);
  END IF;

  IF NEW.assign_to_user_id IS DISTINCT FROM OLD.assign_to_user_id THEN
    INSERT INTO public.notice_events (notice_id, client_id, event_type, old_value, new_value, actor_id, actor_name, source)
    VALUES (NEW.id, NEW.client_id, 'assigned',
            jsonb_build_object('assign_to_user_id', OLD.assign_to_user_id, 'assign_to', OLD.assign_to),
            jsonb_build_object('assign_to_user_id', NEW.assign_to_user_id, 'assign_to', NEW.assign_to),
            v_actor_id, v_actor, v_source);
  END IF;

  v_old_due := coalesce(OLD.extended_due_date, OLD.due_date);
  v_new_due := coalesce(NEW.extended_due_date, NEW.due_date);
  IF v_new_due IS DISTINCT FROM v_old_due THEN
    INSERT INTO public.notice_events (notice_id, client_id, event_type, old_value, new_value, actor_id, actor_name, source)
    VALUES (NEW.id, NEW.client_id, 'due_changed',
            jsonb_build_object('due', v_old_due, 'extended', OLD.extended_due_date IS NOT NULL),
            jsonb_build_object('due', v_new_due, 'extended', NEW.extended_due_date IS NOT NULL,
                               'due_date_source', NEW.due_date_source),
            v_actor_id, v_actor, v_source);
  END IF;

  IF NEW.hearing_date IS DISTINCT FROM OLD.hearing_date AND NEW.hearing_date IS NOT NULL THEN
    INSERT INTO public.notice_events (notice_id, client_id, event_type, old_value, new_value, actor_id, actor_name, source)
    VALUES (NEW.id, NEW.client_id, 'hearing_fixed',
            jsonb_build_object('hearing_date', OLD.hearing_date),
            jsonb_build_object('hearing_date', NEW.hearing_date),
            v_actor_id, v_actor, v_source);
  END IF;

  IF OLD.reply_date IS NULL AND NEW.reply_date IS NOT NULL THEN
    INSERT INTO public.notice_events (notice_id, client_id, event_type, new_value, actor_id, actor_name, source)
    VALUES (NEW.id, NEW.client_id, 'reply_logged',
            jsonb_build_object('reply_date', NEW.reply_date, 'reply_ref_number', NEW.reply_ref_number),
            v_actor_id, v_actor, v_source);
  END IF;

  IF OLD.submission_date IS NULL AND OLD.submission_arn IS NULL
     AND (NEW.submission_date IS NOT NULL OR NEW.submission_arn IS NOT NULL) THEN
    INSERT INTO public.notice_events (notice_id, client_id, event_type, new_value, actor_id, actor_name, source)
    VALUES (NEW.id, NEW.client_id, 'submission_logged',
            jsonb_build_object('submission_date', NEW.submission_date, 'submission_arn', NEW.submission_arn),
            v_actor_id, v_actor, v_source);
  END IF;

  IF OLD.order_date IS NULL AND NEW.order_date IS NOT NULL THEN
    INSERT INTO public.notice_events (notice_id, client_id, event_type, new_value, actor_id, actor_name, source)
    VALUES (NEW.id, NEW.client_id, 'order_logged',
            jsonb_build_object('order_date', NEW.order_date, 'order_number', NEW.order_number),
            v_actor_id, v_actor, v_source);
  END IF;

  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    INSERT INTO public.notice_events (notice_id, client_id, event_type, old_value, new_value, actor_id, actor_name, source)
    VALUES (NEW.id, NEW.client_id, 'priority_changed',
            jsonb_build_object('priority', OLD.priority), jsonb_build_object('priority', NEW.priority),
            v_actor_id, v_actor, v_source);
  END IF;

  IF NEW.matter_id IS DISTINCT FROM OLD.matter_id THEN
    INSERT INTO public.notice_events (notice_id, client_id, event_type, old_value, new_value, actor_id, actor_name, source)
    VALUES (NEW.id, NEW.client_id,
            CASE WHEN NEW.matter_id IS NULL THEN 'unlinked_from_matter' ELSE 'linked_to_matter' END,
            jsonb_build_object('matter_id', OLD.matter_id), jsonb_build_object('matter_id', NEW.matter_id),
            v_actor_id, v_actor, v_source);
  END IF;

  RETURN NULL;
END;
$$;

-- The status alert (template off by default) follows stage moves too.
UPDATE public.notice_alert_rules
   SET event_type = 'stage_changed,status_changed,closed,reopened'
 WHERE alert_key = 'E7_status_changed' AND event_type = 'status_changed,closed,reopened';

-- ── Matters on the same keys ───────────────────────────────────────────────
-- litigation_matters had its own labels ('Captured', 'Reply drafting', …).
UPDATE public.litigation_matters
   SET stage = coalesce(public.notice_stage_key(stage),
                        CASE WHEN status = 'Closed' THEN 'closed' ELSE 'triaged' END)
 WHERE stage NOT IN (SELECT key FROM public.notice_stages);
UPDATE public.matter_stage_history
   SET from_stage = coalesce(public.notice_stage_key(from_stage), from_stage)
 WHERE from_stage IS NOT NULL AND from_stage NOT IN (SELECT key FROM public.notice_stages);
UPDATE public.matter_stage_history
   SET to_stage = coalesce(public.notice_stage_key(to_stage), to_stage)
 WHERE to_stage NOT IN (SELECT key FROM public.notice_stages);
ALTER TABLE public.litigation_matters ALTER COLUMN stage SET DEFAULT 'new';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'litigation_matters_stage_fkey') THEN
    ALTER TABLE public.litigation_matters
      ADD CONSTRAINT litigation_matters_stage_fkey FOREIGN KEY (stage) REFERENCES public.notice_stages (key);
  END IF;
END;
$$;

-- A matter's status (Open / Closed) follows its stage, and the reverse. A
-- label from a client still on the old list ('Reply drafting', 'Triage') is
-- turned into its key before the foreign key is checked.
CREATE OR REPLACE FUNCTION public.litigation_matters_stage_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.stage := coalesce(public.notice_stage_key(NEW.stage), NEW.stage, 'new');
  IF TG_OP = 'INSERT' THEN
    -- A matter created closed (status only) is closed.
    IF NEW.status = 'Closed' AND NEW.stage IN ('new', 'triaged') THEN NEW.stage := 'closed'; END IF;
  ELSIF NEW.stage IS NOT DISTINCT FROM OLD.stage AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'Closed' AND NEW.stage <> 'closed' THEN NEW.stage := 'closed';
    ELSIF NEW.status <> 'Closed' AND NEW.stage = 'closed' THEN NEW.stage := 'triaged';
    END IF;
  END IF;
  IF NEW.stage = 'closed' THEN
    NEW.status := 'Closed';
    NEW.closed_at := coalesce(NEW.closed_at, now());
  ELSE
    IF NEW.status = 'Closed' THEN NEW.status := 'Open'; END IF;
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_litigation_matters_stage_status ON public.litigation_matters;
CREATE TRIGGER trg_litigation_matters_stage_status
  BEFORE INSERT OR UPDATE ON public.litigation_matters
  FOR EACH ROW EXECUTE FUNCTION public.litigation_matters_stage_status();

-- The stage history keeps keys too, whoever writes it.
CREATE OR REPLACE FUNCTION public.matter_stage_history_keys()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.from_stage := coalesce(public.notice_stage_key(NEW.from_stage), NEW.from_stage);
  NEW.to_stage := coalesce(public.notice_stage_key(NEW.to_stage), NEW.to_stage);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_matter_stage_history_keys ON public.matter_stage_history;
CREATE TRIGGER trg_matter_stage_history_keys
  BEFORE INSERT OR UPDATE ON public.matter_stage_history
  FOR EACH ROW EXECUTE FUNCTION public.matter_stage_history_keys();

-- ── notice_facts with the stage (columns appended to the 116000 version) ───
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
  coalesce(d.open_flag AND NOT d.replied_flag AND d.eff_due < d.today_ist, false) AS is_overdue,
  coalesce(d.open_flag AND NOT d.replied_flag AND d.eff_due BETWEEN d.today_ist AND d.today_ist + 7, false) AS is_due_in_7,
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
  d.hearing_note
FROM derived d
JOIN public.notice_stages st ON st.key = d.stage;

GRANT SELECT ON public.notice_facts TO anon, authenticated, service_role;
