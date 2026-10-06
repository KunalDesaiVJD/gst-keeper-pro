-- Notices Phase 1 · events from the database
-- (docs/NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf: roadmap Phase 1 task 3; findings S-05, L-28, L-29).
--
-- notice_events used to be written by the browser after a few staff edits
-- only, so a notice the sync captured, a due date the portal moved, a reply or
-- an order appearing in the case folder, and every bulk action left no trace —
-- and the alert rules that wait on those events never fired. Triggers now
-- write them for every writer: staff edits, the extension, the closing sweep.
--
-- Who did it:
--   * a staff edit sends edited_by_id / edited_by_name / edited_at with the
--     update (the app has no database session, so this is the only way the
--     row can say who changed it); a statement that moves edited_at is a
--     staff edit,
--   * a server routine names itself with set_config('app.actor_name', ...),
--   * anything else that refreshes last_seen_at / pulled_at, or marks the row
--     gone, is the portal sync.
-- notice_events.alert_processed_at is the alert engine's cursor.

ALTER TABLE public.gst_notices
  ADD COLUMN IF NOT EXISTS edited_by_id uuid,
  ADD COLUMN IF NOT EXISTS edited_by_name text,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS due_date_source text;
COMMENT ON COLUMN public.gst_notices.edited_at IS
  'Set by the app on every staff edit (with edited_by_id / edited_by_name); the event trigger attributes a change to staff only when this moves.';
COMMENT ON COLUMN public.gst_notices.due_date_source IS
  'Where due_date came from: portal (notice list), case_folder (closing sweep), manual (Add Notice).';

ALTER TABLE public.notice_events ADD COLUMN IF NOT EXISTS source text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'notice_events'
                    AND column_name = 'alert_processed_at') THEN
    ALTER TABLE public.notice_events ADD COLUMN alert_processed_at timestamptz;
    -- Events written before the alert engine existed are history, not news.
    UPDATE public.notice_events SET alert_processed_at = created_at;
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS idx_notice_events_unprocessed
  ON public.notice_events (created_at) WHERE alert_processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notice_events_client_ts ON public.notice_events (client_id, created_at DESC);

-- Existing due dates: the portal's, except on manual notices.
UPDATE public.gst_notices
   SET due_date_source = CASE WHEN portal_key LIKE 'manual:%' THEN 'manual' ELSE 'portal' END
 WHERE due_date IS NOT NULL AND due_date_source IS NULL;

-- ── Sync guard (replaces the Phase 0 version) ──────────────────────────────
-- Adds: the portal's case list carries no due date, so a sync write must not
-- blank a date the closing sweep found in the case folder (it would come back
-- on the next sweep, logging two "due date changed" events per case per sync).
CREATE OR REPLACE FUNCTION public.gst_notices_sync_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at
     OR NEW.pulled_at IS DISTINCT FROM OLD.pulled_at THEN
    NEW.pdf_url      := COALESCE(NEW.pdf_url, OLD.pdf_url);
    NEW.case_id      := COALESCE(NEW.case_id, OLD.case_id);
    NEW.hearing_date := COALESCE(NEW.hearing_date, OLD.hearing_date);
    IF NEW.due_date IS NULL AND OLD.due_date IS NOT NULL AND OLD.due_date_source = 'case_folder' THEN
      NEW.due_date := OLD.due_date;
      NEW.due_date_source := OLD.due_date_source;
    ELSIF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
      NEW.due_date_source := CASE WHEN NEW.due_date IS NULL THEN NULL ELSE 'portal' END;
    END IF;
  END IF;
  IF OLD.portal_key LIKE 'manual:%'
     AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    NEW.deleted_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.gst_notices_due_source_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.due_date IS NOT NULL AND NEW.due_date_source IS NULL THEN
    NEW.due_date_source := CASE WHEN NEW.portal_key LIKE 'manual:%' THEN 'manual' ELSE 'portal' END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_gst_notices_due_source ON public.gst_notices;
CREATE TRIGGER trg_gst_notices_due_source
  BEFORE INSERT ON public.gst_notices
  FOR EACH ROW EXECUTE FUNCTION public.gst_notices_due_source_on_insert();

-- ── Notice events ──────────────────────────────────────────────────────────
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
  v_was_closed boolean;
  v_is_closed  boolean;
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
                               'due_date', NEW.due_date, 'manual', NEW.portal_key LIKE 'manual:%'),
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

  IF NEW.staff_status IS DISTINCT FROM OLD.staff_status THEN
    v_was_closed := public.notice_is_closed(OLD.staff_status);
    v_is_closed := public.notice_is_closed(NEW.staff_status);
    INSERT INTO public.notice_events (notice_id, client_id, event_type, old_value, new_value, actor_id, actor_name, source)
    VALUES (NEW.id, NEW.client_id,
            CASE WHEN v_is_closed AND NOT v_was_closed THEN 'closed'
                 WHEN v_was_closed AND NOT v_is_closed THEN 'reopened'
                 ELSE 'status_changed' END,
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

DROP TRIGGER IF EXISTS trg_gst_notices_log_events ON public.gst_notices;
CREATE TRIGGER trg_gst_notices_log_events
  AFTER INSERT OR UPDATE ON public.gst_notices
  FOR EACH ROW EXECUTE FUNCTION public.gst_notices_log_events();

-- Case folder: a new item (reply, order, notice, closure) or a removed one is
-- logged against the case's notice row. Items saved before their case row
-- exists (a brand-new case) are covered by that row's own "captured" event.
CREATE OR REPLACE FUNCTION public.case_folder_items_log_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notice uuid;
  v_sec    text := upper(btrim(coalesce(NEW.folder_section, '')));
  v_type   text;
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  SELECT n.id INTO v_notice
    FROM public.gst_notices n
   WHERE n.client_id = NEW.client_id AND n.case_id = NEW.case_id AND n.deleted_at IS NULL
   ORDER BY n.issue_date DESC NULLS LAST, n.id
   LIMIT 1;
  IF v_notice IS NULL THEN RETURN NULL; END IF;

  v_type := CASE
    WHEN TG_OP = 'UPDATE' THEN 'folder_item_removed'
    WHEN v_sec IN ('REPLY', 'REPLIES', 'RPLY') THEN 'reply_filed'
    WHEN v_sec IN ('ORDRS', 'ORDER', 'ORDERS', 'DRC7A') THEN 'order_received'
    WHEN v_sec IN ('CLSR', 'CLOSR', 'CLOSURE') THEN 'closure_on_portal'
    WHEN v_sec IN ('INTIM', 'INTIMATIONS', 'NOTCE', 'NOTICE', 'NOTICES', 'NOTAC', 'NOTICE/ACKNOWLEDGEMENT') THEN 'notice_issued'
    ELSE 'folder_item_added'
  END;

  INSERT INTO public.notice_events (notice_id, client_id, event_type, new_value, actor_name, source)
  VALUES (v_notice, NEW.client_id, v_type,
          jsonb_build_object('case_id', NEW.case_id, 'folder_section', NEW.folder_section,
                             'reference_number', NEW.reference_number, 'item_id', NEW.id,
                             'due_date', public.notices_item_due_date(NEW.raw_json)),
          coalesce(nullif(current_setting('app.actor_name', true), ''), 'Portal sync'), 'sync');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_case_folder_items_log_events ON public.gst_case_folder_items;
CREATE TRIGGER trg_case_folder_items_log_events
  AFTER INSERT OR UPDATE OF deleted_at ON public.gst_case_folder_items
  FOR EACH ROW EXECUTE FUNCTION public.case_folder_items_log_events();

-- ── Closing sweep (replaces the Phase 0 version) ───────────────────────────
-- Changes: it names itself for the event trigger instead of writing its own
-- "closed" events, and it keeps a case's folder-derived due date current
-- (a later notice in the case moves it) instead of filling blanks only —
-- never touching a due date the portal list or a person supplied.
CREATE OR REPLACE FUNCTION public.notices_sweep(p_client_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_due int := 0;
  v_closed int := 0;
  v_prev_actor text := coalesce(current_setting('app.actor_name', true), '');
  r record;
BEGIN
  PERFORM set_config('app.actor_name', 'Closing sweep', true);

  WITH items AS (
    SELECT fi.client_id, fi.case_id, fi.reference_number,
           upper(btrim(coalesce(fi.folder_section, ''))) AS sec,
           public.notices_item_due_date(fi.raw_json) AS due,
           public.notices_parse_portal_date(CASE WHEN jsonb_typeof(fi.raw_json) = 'object' THEN fi.raw_json ->> 'refdt' END) AS issued
      FROM public.gst_case_folder_items fi
     WHERE fi.deleted_at IS NULL
       AND (p_client_id IS NULL OR fi.client_id = p_client_id)
  ),
  replied AS (
    SELECT fi.client_id, fi.case_id,
           COALESCE(fi.raw_json -> 'reply' ->> 'ntcno', CASE WHEN jsonb_typeof(fi.raw_json) = 'object' THEN fi.raw_json ->> 'ntcno' END) AS against
      FROM public.gst_case_folder_items fi
     WHERE fi.deleted_at IS NULL
       AND upper(btrim(coalesce(fi.folder_section, ''))) IN ('REPLY', 'REPLIES')
       AND (p_client_id IS NULL OR fi.client_id = p_client_id)
  ),
  due_items AS (
    SELECT i.*
      FROM items i
     WHERE i.due IS NOT NULL
       AND i.sec IN ('INTIM', 'INTIMATIONS', 'NOTCE', 'NOTICE', 'NOTICES', 'NOTAC', 'NOTICE/ACKNOWLEDGEMENT')
       AND NOT EXISTS (SELECT 1 FROM replied rp
                        WHERE rp.client_id = i.client_id AND rp.case_id = i.case_id
                          AND rp.against IS NOT NULL AND rp.against = i.reference_number)
  ),
  pick AS (
    SELECT n.id,
           COALESCE(
             (SELECT d.due FROM due_items d
               WHERE d.client_id = n.client_id AND d.case_id = n.case_id AND d.reference_number = n.reference_number
               ORDER BY d.due DESC LIMIT 1),
             (SELECT d.due FROM due_items d
               WHERE d.client_id = n.client_id AND d.case_id = n.case_id
               ORDER BY d.issued DESC NULLS LAST, d.due DESC LIMIT 1)
           ) AS due
      FROM public.gst_notices n
     WHERE n.deleted_at IS NULL AND n.case_id IS NOT NULL
       AND (n.due_date IS NULL OR n.due_date_source = 'case_folder')
       AND (p_client_id IS NULL OR n.client_id = p_client_id)
  )
  UPDATE public.gst_notices n
     SET due_date = p.due, due_date_source = 'case_folder'
    FROM pick p
   WHERE n.id = p.id AND p.due IS NOT NULL AND n.due_date IS DISTINCT FROM p.due;
  GET DIAGNOSTICS v_due = ROW_COUNT;

  FOR r IN
    WITH cand AS (
      SELECT n.id, n.client_id, n.case_id, n.reference_number, coalesce(n.notice_type, '') AS ntype
        FROM public.gst_notices n
       WHERE n.deleted_at IS NULL AND n.staff_status IS NULL AND n.case_id IS NOT NULL
         AND (p_client_id IS NULL OR n.client_id = p_client_id)
    ),
    secs AS (
      SELECT fi.client_id, fi.case_id,
             bool_or(upper(btrim(coalesce(fi.folder_section, ''))) IN ('CLSR', 'CLOSR', 'CLOSURE')) AS has_closure,
             bool_or(upper(btrim(coalesce(fi.folder_section, ''))) IN ('ORDRS', 'ORDER', 'ORDERS')) AS has_order,
             bool_or(upper(btrim(coalesce(fi.folder_section, ''))) IN ('ORDRS', 'ORDER', 'ORDERS')
                     AND jsonb_typeof(fi.raw_json -> 'sdtls' -> 'payadviceordervo') = 'object') AS has_payment_order,
             bool_or(coalesce(fi.raw_json -> 'sdtls' -> 'sancordervo' ->> 'ordertype', '') ~* 'reject') AS has_rejection
        FROM public.gst_case_folder_items fi
       WHERE fi.deleted_at IS NULL
         AND (p_client_id IS NULL OR fi.client_id = p_client_id)
       GROUP BY fi.client_id, fi.case_id
    )
    SELECT c.id, c.client_id,
           CASE
             WHEN s.has_closure THEN 'auto:closure'
             WHEN c.ntype ~* 'refund' AND s.has_payment_order AND NOT coalesce(s.has_rejection, false) THEN 'auto:refund_paid'
             WHEN c.ntype ~* '(letter of undertaking|\mlut\M)' AND s.has_order THEN 'auto:lut_approval'
             WHEN c.ntype ~* 'voluntary payment' AND EXISTS (
                    SELECT 1 FROM public.gst_drc03_filings d
                     WHERE d.client_id = c.client_id AND d.deleted_at IS NULL
                       AND (d.arn = c.case_id OR d.arn = c.reference_number)
                       AND coalesce(d.status, '') ~* 'acknowledg') THEN 'auto:drc03_acknowledged'
           END AS reason
      FROM cand c
      LEFT JOIN secs s ON s.client_id = c.client_id AND s.case_id = c.case_id
  LOOP
    CONTINUE WHEN r.reason IS NULL;
    UPDATE public.gst_notices
       SET staff_status = 'Closed', close_reason = r.reason
     WHERE id = r.id AND staff_status IS NULL;
    IF FOUND THEN v_closed := v_closed + 1; END IF;
  END LOOP;

  PERFORM set_config('app.actor_name', v_prev_actor, true);
  RETURN jsonb_build_object('closed', v_closed, 'due_dates_set', v_due, 'client_id', p_client_id, 'ran_at', now());
END;
$$;

COMMENT ON FUNCTION public.notices_sweep(uuid) IS
  'Closing sweep for the notices module: keeps case due dates current from the case folder and auto-closes untriaged rows by rule (closure folder, paid refund, approved LUT, acknowledged DRC-03). NULL = every client.';
