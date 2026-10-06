-- Notices Phase 2 · the notice workspace's own data
-- (docs/NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf: roadmap Phase 2 task 1; findings
-- R-18, R-19, R-28, L-19, U-41-1, U-43-1, U-44-4).
--
-- The workspace at /notices/:id needs what a reply is made of, kept per notice:
--   notice_issues        the issues the notice raises, with the amount per
--                        notice, how much the firm's own data explains, and the
--                        position (typed by staff now; Phase 4 reads them from
--                        the PDF into the same table, source = 'extracted');
--   notice_drafts        reply draft versions and the partner review of each;
--   notice_doc_requests  documents asked of the client, received or waived;
--   notice_payments      DRC-03s and other payments made against the notice;
--   matter_documents     now also holds files uploaded on a notice with no
--                        matter (matter_id becomes optional).
-- Moves through the stages that these imply are made by triggers, attributed
-- to the person who made the change:
--   documents requested on a notice before Waiting on client → Waiting on client;
--   the last open request received or waived while Waiting   → Evidence;
--   a draft sent for review                                   → Partner review;
--   changes requested on a draft                              → Draft.
-- Every change here is logged to notice_events for the Activity tab.

-- ── Issues ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notice_issues (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id        uuid NOT NULL REFERENCES public.gst_notices (id) ON DELETE CASCADE,
  seq              int  NOT NULL DEFAULT 1,
  title            text NOT NULL CHECK (btrim(title) <> ''),
  detail           text,
  amount           numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  explained_amount numeric NOT NULL DEFAULT 0 CHECK (explained_amount >= 0),
  position         text,
  annexure         text,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'explained', 'pay', 'contest')),
  source           text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'extracted')),
  created_by       uuid,
  created_by_name  text,
  updated_by_name  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notice_issues_explained_le_amount CHECK (explained_amount <= amount)
);
COMMENT ON TABLE public.notice_issues IS
  'Issues a notice raises: amount per notice, amount explained by the firm''s own data, position and status (open / explained / pay / contest).';
CREATE INDEX IF NOT EXISTS idx_notice_issues_notice ON public.notice_issues (notice_id, seq);

-- ── Reply drafts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notice_drafts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id        uuid NOT NULL REFERENCES public.gst_notices (id) ON DELETE CASCADE,
  version          int  NOT NULL CHECK (version >= 1),
  body             text NOT NULL DEFAULT '',
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'in_review', 'changes_requested', 'approved', 'superseded')),
  author_id        uuid,
  author_name      text,
  review_note      text,
  reviewed_by      uuid,
  reviewed_by_name text,
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notice_id, version)
);
COMMENT ON TABLE public.notice_drafts IS
  'Reply draft versions for a notice and the partner review of each (draft → in_review → approved or changes_requested).';

-- ── Client document requests ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notice_doc_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id         uuid NOT NULL REFERENCES public.gst_notices (id) ON DELETE CASCADE,
  item              text NOT NULL CHECK (btrim(item) <> ''),
  status            text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'received', 'waived')),
  due_date          date,
  requested_by      uuid,
  requested_by_name text,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  resolved_by_name  text,
  resolved_at       timestamptz,
  note              text,
  document_id       uuid,
  reminders_sent    int NOT NULL DEFAULT 0,
  last_reminded_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notice_doc_requests_notice ON public.notice_doc_requests (notice_id, status);

-- ── Payments against the notice ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notice_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id       uuid NOT NULL REFERENCES public.gst_notices (id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'drc03' CHECK (kind IN ('drc03', 'pre_deposit', 'other')),
  drc03_arn       text,
  paid_on         date,
  amount          numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  note            text,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notice_payments_arn
  ON public.notice_payments (notice_id, drc03_arn) WHERE drc03_arn IS NOT NULL;

-- ── Documents uploaded on a notice ─────────────────────────────────────────
ALTER TABLE public.matter_documents ALTER COLUMN matter_id DROP NOT NULL;
ALTER TABLE public.matter_documents ADD COLUMN IF NOT EXISTS uploaded_by_name text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_documents_owner_check') THEN
    ALTER TABLE public.matter_documents
      ADD CONSTRAINT matter_documents_owner_check CHECK (matter_id IS NOT NULL OR notice_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notice_doc_requests_document_fkey') THEN
    ALTER TABLE public.notice_doc_requests
      ADD CONSTRAINT notice_doc_requests_document_fkey
      FOREIGN KEY (document_id) REFERENCES public.matter_documents (id) ON DELETE SET NULL;
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS idx_matter_documents_notice ON public.matter_documents (notice_id) WHERE notice_id IS NOT NULL;

-- ── RLS: open, as everywhere in this app (CLAUDE.md) ───────────────────────
ALTER TABLE public.notice_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notice_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notice_doc_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notice_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notice_issues_public" ON public.notice_issues;
CREATE POLICY "notice_issues_public" ON public.notice_issues FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "notice_drafts_public" ON public.notice_drafts;
CREATE POLICY "notice_drafts_public" ON public.notice_drafts FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "notice_doc_requests_public" ON public.notice_doc_requests;
CREATE POLICY "notice_doc_requests_public" ON public.notice_doc_requests FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "notice_payments_public" ON public.notice_payments;
CREATE POLICY "notice_payments_public" ON public.notice_payments FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notice_issues, public.notice_drafts,
  public.notice_doc_requests, public.notice_payments TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_notice_issues_updated_at ON public.notice_issues;
CREATE TRIGGER trg_notice_issues_updated_at BEFORE UPDATE ON public.notice_issues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_notice_drafts_updated_at ON public.notice_drafts;
CREATE TRIGGER trg_notice_drafts_updated_at BEFORE UPDATE ON public.notice_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_notice_doc_requests_updated_at ON public.notice_doc_requests;
CREATE TRIGGER trg_notice_doc_requests_updated_at BEFORE UPDATE ON public.notice_doc_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Moving the notice and logging it ───────────────────────────────────────
-- Moves a notice's stage as the named person (the event trigger on gst_notices
-- then logs stage_changed with that actor). Internal.
CREATE OR REPLACE FUNCTION public.notice_move_stage(p_notice_id uuid, p_stage text, p_actor_id uuid, p_actor_name text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.gst_notices
     SET stage = p_stage, edited_by_id = p_actor_id,
         edited_by_name = coalesce(nullif(p_actor_name, ''), 'Staff'), edited_at = clock_timestamp()
   WHERE id = p_notice_id AND stage IS DISTINCT FROM p_stage
$$;

CREATE OR REPLACE FUNCTION public.notice_log_event(p_notice_id uuid, p_type text, p_old jsonb, p_new jsonb,
                                                   p_actor_id uuid, p_actor_name text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.notice_events (notice_id, client_id, event_type, old_value, new_value, actor_id, actor_name, source)
  SELECT g.id, g.client_id, p_type, p_old, p_new, p_actor_id, coalesce(nullif(p_actor_name, ''), 'Staff'), 'staff'
    FROM public.gst_notices g WHERE g.id = p_notice_id
$$;

CREATE OR REPLACE FUNCTION public.notice_issues_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.notice_log_event(NEW.notice_id, 'issue_added', NULL,
      jsonb_build_object('title', NEW.title, 'amount', NEW.amount, 'status', NEW.status, 'source', NEW.source),
      NEW.created_by, coalesce(NEW.created_by_name, CASE WHEN NEW.source = 'extracted' THEN 'Notice reader' END));
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW.status, NEW.amount, NEW.explained_amount, NEW.title)
       IS DISTINCT FROM (OLD.status, OLD.amount, OLD.explained_amount, OLD.title) THEN
      PERFORM public.notice_log_event(NEW.notice_id, 'issue_updated',
        jsonb_build_object('title', OLD.title, 'status', OLD.status, 'amount', OLD.amount, 'explained_amount', OLD.explained_amount),
        jsonb_build_object('title', NEW.title, 'status', NEW.status, 'amount', NEW.amount, 'explained_amount', NEW.explained_amount),
        NULL, coalesce(NEW.updated_by_name, NEW.created_by_name));
    END IF;
  ELSE
    PERFORM public.notice_log_event(OLD.notice_id, 'issue_removed',
      jsonb_build_object('title', OLD.title, 'amount', OLD.amount), NULL, NULL,
      coalesce(OLD.updated_by_name, OLD.created_by_name));
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notice_issues_log ON public.notice_issues;
CREATE TRIGGER trg_notice_issues_log AFTER INSERT OR UPDATE OR DELETE ON public.notice_issues
  FOR EACH ROW EXECUTE FUNCTION public.notice_issues_log();

CREATE OR REPLACE FUNCTION public.notice_drafts_flow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := CASE WHEN TG_OP = 'UPDATE' AND NEW.status IN ('approved', 'changes_requested') THEN NEW.reviewed_by ELSE NEW.author_id END;
  v_actor    text := CASE WHEN TG_OP = 'UPDATE' AND NEW.status IN ('approved', 'changes_requested') THEN NEW.reviewed_by_name ELSE NEW.author_name END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A new version supersedes the earlier open ones.
    UPDATE public.notice_drafts SET status = 'superseded'
     WHERE notice_id = NEW.notice_id AND id <> NEW.id AND status IN ('draft', 'changes_requested', 'in_review');
    PERFORM public.notice_log_event(NEW.notice_id, 'draft_saved', NULL,
      jsonb_build_object('version', NEW.version), v_actor_id, v_actor);
    IF NEW.status = 'draft' THEN
      UPDATE public.gst_notices g
         SET stage = 'draft', edited_by_id = v_actor_id, edited_by_name = coalesce(v_actor, 'Staff'), edited_at = clock_timestamp()
       WHERE g.id = NEW.notice_id AND g.stage IN ('new', 'triaged', 'evidence', 'waiting_client');
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'superseded' THEN
    PERFORM public.notice_log_event(NEW.notice_id,
      CASE NEW.status WHEN 'in_review' THEN 'draft_sent_for_review'
                      WHEN 'approved' THEN 'draft_approved'
                      WHEN 'changes_requested' THEN 'draft_changes_requested'
                      ELSE 'draft_saved' END,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('version', NEW.version, 'status', NEW.status, 'note', NEW.review_note),
      v_actor_id, v_actor);
    IF NEW.status = 'in_review' THEN
      PERFORM public.notice_move_stage(NEW.notice_id, 'partner_review', v_actor_id, v_actor);
    ELSIF NEW.status = 'changes_requested' THEN
      PERFORM public.notice_move_stage(NEW.notice_id, 'draft', v_actor_id, v_actor);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notice_drafts_flow ON public.notice_drafts;
CREATE TRIGGER trg_notice_drafts_flow AFTER INSERT OR UPDATE OF status ON public.notice_drafts
  FOR EACH ROW EXECUTE FUNCTION public.notice_drafts_flow();

CREATE OR REPLACE FUNCTION public.notice_doc_requests_flow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.notice_log_event(NEW.notice_id, 'documents_requested', NULL,
      jsonb_build_object('item', NEW.item, 'due_date', NEW.due_date), NEW.requested_by, NEW.requested_by_name);
    UPDATE public.gst_notices g
       SET stage = 'waiting_client', edited_by_id = NEW.requested_by,
           edited_by_name = coalesce(NEW.requested_by_name, 'Staff'), edited_at = clock_timestamp()
     WHERE g.id = NEW.notice_id AND g.stage IN ('new', 'triaged', 'evidence');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.notice_log_event(NEW.notice_id,
      CASE NEW.status WHEN 'received' THEN 'document_received' WHEN 'waived' THEN 'document_waived' ELSE 'documents_requested' END,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('item', NEW.item, 'status', NEW.status, 'note', NEW.note), NULL, NEW.resolved_by_name);
    IF NEW.status IN ('received', 'waived') THEN
      SELECT count(*) INTO v_open FROM public.notice_doc_requests
       WHERE notice_id = NEW.notice_id AND status = 'requested';
      IF v_open = 0 THEN
        UPDATE public.gst_notices g
           SET stage = 'evidence', edited_by_name = coalesce(NEW.resolved_by_name, 'Staff'), edited_at = clock_timestamp()
         WHERE g.id = NEW.notice_id AND g.stage = 'waiting_client';
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notice_doc_requests_flow ON public.notice_doc_requests;
CREATE TRIGGER trg_notice_doc_requests_flow AFTER INSERT OR UPDATE OF status ON public.notice_doc_requests
  FOR EACH ROW EXECUTE FUNCTION public.notice_doc_requests_flow();

CREATE OR REPLACE FUNCTION public.notice_payments_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.notice_log_event(NEW.notice_id, 'payment_linked', NULL,
      jsonb_build_object('kind', NEW.kind, 'drc03_arn', NEW.drc03_arn, 'amount', NEW.amount, 'paid_on', NEW.paid_on),
      NULL, NEW.created_by_name);
  ELSE
    PERFORM public.notice_log_event(OLD.notice_id, 'payment_unlinked',
      jsonb_build_object('kind', OLD.kind, 'drc03_arn', OLD.drc03_arn, 'amount', OLD.amount), NULL, NULL, NULL);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notice_payments_log ON public.notice_payments;
CREATE TRIGGER trg_notice_payments_log AFTER INSERT OR DELETE ON public.notice_payments
  FOR EACH ROW EXECUTE FUNCTION public.notice_payments_log();

-- Uploads on a notice show in its Activity.
CREATE OR REPLACE FUNCTION public.matter_documents_notice_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.notice_id IS NOT NULL THEN
    PERFORM public.notice_log_event(NEW.notice_id, 'document_added', NULL,
      jsonb_build_object('title', NEW.title, 'kind', NEW.kind), NEW.uploaded_by, NEW.uploaded_by_name);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_matter_documents_notice_log ON public.matter_documents;
CREATE TRIGGER trg_matter_documents_notice_log AFTER INSERT ON public.matter_documents
  FOR EACH ROW EXECUTE FUNCTION public.matter_documents_notice_log();

-- ── Asking the client by e-mail (rule E12, preview / live like every alert) ─
-- p_reminder: a reminder for the requests still open (counts them).
CREATE OR REPLACE FUNCTION public.notice_request_documents_send(
  p_notice_id uuid, p_actor_id uuid, p_actor_name text, p_reminder boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n     record;
  v_items text;
  v_count int;
  v_mode  text;
  v_sent  boolean;
BEGIN
  SELECT g.id, g.client_id, g.reference_number, g.case_id, g.notice_type, g.form_code, g.financial_year,
         c.name AS client_name, c.gstin, c.email
    INTO v_n
    FROM public.gst_notices g JOIN public.clients c ON c.id = g.client_id
   WHERE g.id = p_notice_id;
  IF v_n.id IS NULL THEN RAISE EXCEPTION 'notice % not found', p_notice_id; END IF;

  SELECT string_agg('• ' || r.item || CASE WHEN r.due_date IS NOT NULL
                                          THEN ' (by ' || public.fmt_ist_date(r.due_date) || ')' ELSE '' END,
                    E'\n' ORDER BY r.requested_at, r.item),
         count(*)
    INTO v_items, v_count
    FROM public.notice_doc_requests r
   WHERE r.notice_id = p_notice_id AND r.status = 'requested';
  IF coalesce(v_count, 0) = 0 THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'nothing_open');
  END IF;
  IF coalesce(btrim(v_n.email), '') = '' THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no_client_email', 'open', v_count);
  END IF;
  SELECT s.alerts_mode INTO v_mode FROM public.notice_settings s WHERE s.id;

  v_sent := public.notice_alert_enqueue(
    'E12_client_docs', v_n.email, v_n.client_name, NULL,
    jsonb_build_object(
      'client_name', v_n.client_name, 'gstin', v_n.gstin,
      'notice_type', coalesce(v_n.form_code, v_n.notice_type, 'notice'),
      'reference_number', coalesce(v_n.reference_number, v_n.case_id, ''),
      'financial_year', coalesce(v_n.financial_year, ''),
      'document_list', v_items, 'document_count', v_count::text,
      -- Signed by the person who asked, not "automated alert".
      'staff_name', coalesce(nullif(btrim(p_actor_name), ''), 'V. J. Desai & Co. (GST Team)')),
    -- One e-mail per notice per minute: a double click sends once.
    'E12:' || p_notice_id || ':' || to_char(clock_timestamp() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDDHH24MI'),
    p_notice_id, v_n.client_id);

  IF v_sent THEN
    UPDATE public.notice_doc_requests
       SET reminders_sent = reminders_sent + CASE WHEN p_reminder THEN 1 ELSE 0 END,
           last_reminded_at = clock_timestamp()
     WHERE notice_id = p_notice_id AND status = 'requested';
    PERFORM public.notice_log_event(p_notice_id, CASE WHEN p_reminder THEN 'client_reminded' ELSE 'client_emailed' END, NULL,
      jsonb_build_object('items', v_count, 'to', v_n.email, 'mode', coalesce(v_mode, 'preview')), p_actor_id, p_actor_name);
  END IF;
  RETURN jsonb_build_object('sent', v_sent, 'mode', coalesce(v_mode, 'preview'), 'open', v_count, 'to', v_n.email);
END;
$$;
REVOKE ALL ON FUNCTION public.notice_move_stage(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notice_log_event(uuid, text, jsonb, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notice_request_documents_send(uuid, uuid, text, boolean) TO anon, authenticated, service_role;
