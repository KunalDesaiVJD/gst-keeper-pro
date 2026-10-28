-- Notices & Litigation: every refund, case and appeal paper the AI can read is
-- read, and shown where it belongs (the firm, 28 October 2026: "some documents
-- and flow is not being read by AI CLI file … in refund, case & appeal").
--
-- 1. A refund's own documents (gst_refund_applications.documents) in no case
--    folder item were never queued: an application under a deficiency memo
--    keeps its uploads only on the refund, its folder holding the RFD-03. They
--    are queued as source 'refund' (case_id the ARN, the folder's section by
--    the portal's tab) by ai_sync after the folder's, so a file in both is read
--    once, as the folder's.
-- 2. A copy of a file read in another case (an order filed again with its
--    appeal, a refund paper filed again) was skipped as a duplicate and showed
--    no reading in its own case (121 on 28 October). It now carries the
--    reading of the file it copies (status done, reason_class duplicate kept,
--    no tokens, no learning pairs): at once when that one is done, and when it
--    is read or read again later.
-- 3. The refund documents in no folder are queued now (ai_sync keeps it so).
--    The documents left unread as too long or as scans are queued again by
--    20261028140000, once notice-ai 1.5.0 reads them.

-- ── 1. A refund's own documents ────────────────────────────────────────────
ALTER TABLE public.ai_documents DROP CONSTRAINT IF EXISTS ai_documents_source_check;
ALTER TABLE public.ai_documents ADD CONSTRAINT ai_documents_source_check
  CHECK (source IN ('folder', 'draft', 'workspace', 'refund'));

-- The case folder's section for a refund document's portal tab.
CREATE OR REPLACE FUNCTION public.ai_refund_tab_section(p_tab text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE upper(regexp_replace(coalesce(p_tab, ''), '[^A-Za-z]', '', 'g'))
    WHEN 'APPLICATIONS' THEN 'APLCN' WHEN 'APPLICATION' THEN 'APLCN'
    WHEN 'NOTICEACKNOWLEDGEMENT' THEN 'NOTAC' WHEN 'NOTICEACKNOWLEDGMENT' THEN 'NOTAC'
    WHEN 'ORDERS' THEN 'ORDRS' WHEN 'ORDER' THEN 'ORDRS'
    WHEN 'REPLIES' THEN 'REPLY' WHEN 'REPLY' THEN 'REPLY'
    ELSE 'OTHER' END
$$;

CREATE OR REPLACE FUNCTION public.ai_documents_register_refund(p_refund_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_r    public.gst_refund_applications;
  v_auto boolean;
  v_n    int;
BEGIN
  SELECT * INTO v_r FROM public.gst_refund_applications WHERE id = p_refund_id;
  IF v_r.id IS NULL OR v_r.deleted_at IS NOT NULL OR v_r.client_id IS NULL OR coalesce(v_r.arn, '') = '' THEN RETURN 0; END IF;
  SELECT s.learning_auto_include INTO v_auto FROM public.ai_settings s WHERE s.id;
  WITH att AS (
    SELECT a ->> 'url' AS url, nullif(btrim(a ->> 'label'), '') AS label, nullif(btrim(a ->> 'tab'), '') AS tab,
           public.ai_refund_tab_section(a ->> 'tab') AS section
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_r.documents) = 'array' THEN v_r.documents ELSE '[]'::jsonb END) a
     WHERE coalesce(a ->> 'url', '') ~ '/storage/v1/object/' AND coalesce(a ->> 'url', '') ~* '\.pdf($|\?)'
  ), counted AS (
    SELECT att.*, count(*) OVER (PARTITION BY att.section) AS n_sec FROM att
  ), todo AS (
    SELECT DISTINCT ON (c.url) c.* FROM counted c
     WHERE NOT EXISTS (SELECT 1 FROM public.ai_documents d WHERE d.source IN ('folder', 'refund') AND d.source_ref = c.url)
     ORDER BY c.url
  ), notice AS (
    SELECT g.id, g.issue_date FROM public.gst_notices g
     WHERE g.client_id = v_r.client_id AND g.case_id = v_r.arn AND g.deleted_at IS NULL
     ORDER BY g.issue_date DESC NULLS LAST
     LIMIT 1
  ), ins AS (
    INSERT INTO public.ai_documents (client_id, notice_id, case_id, source, source_ref, folder_section, role,
                                     url, label, context, sort_date, priority, learning_included)
    SELECT v_r.client_id, (SELECT id FROM notice), v_r.arn, 'refund', t.url, t.section, r.role,
           t.url, coalesce(t.label, 'Document'),
           jsonb_strip_nulls(jsonb_build_object('refund_tab', t.tab, 'arn', v_r.arn, 'refund_type', v_r.refund_type)),
           coalesce(v_r.filed_date, (SELECT issue_date FROM notice), v_r.first_seen_at::date, v_r.created_at::date),
           public.ai_role_priority(r.role),
           coalesce(v_auto, false) AND r.role = 'reply'
      FROM todo t CROSS JOIN LATERAL (SELECT public.ai_folder_role(t.section, t.label, '{}'::jsonb, t.n_sec::int) AS role) r
    ON CONFLICT (source, source_ref) DO NOTHING
    RETURNING 1)
  SELECT count(*)::int INTO v_n FROM ins;
  RETURN v_n;
END;
$$;
COMMENT ON FUNCTION public.ai_documents_register_refund(uuid) IS
  'Queues a refund application''s own documents (gst_refund_applications.documents) that no case folder item carries, as source refund with the ARN for case_id (20261028120000).';
REVOKE ALL ON FUNCTION public.ai_documents_register_refund(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_documents_register_refund(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_sync()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_s       public.ai_settings;
  v_items   int := 0;
  v_refunds int := 0;
  v_drafts  int := 0;
  v_notices int := 0;
  v_id      uuid;
BEGIN
  SELECT * INTO v_s FROM public.ai_settings WHERE id;
  FOR v_id IN
    SELECT fi.id FROM public.gst_case_folder_items fi
     WHERE fi.deleted_at IS NULL AND jsonb_typeof(fi.attachments) = 'array' AND jsonb_array_length(fi.attachments) > 0
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(fi.attachments) a
                    WHERE coalesce(a ->> 'url', '') ~ '/storage/v1/object/'
                      AND NOT EXISTS (SELECT 1 FROM public.ai_documents d WHERE d.source = 'folder' AND d.source_ref = a ->> 'url'))
  LOOP
    v_items := v_items + public.ai_documents_register_item(v_id);
  END LOOP;
  -- After the folder's, so a file the folder carries is read as the folder's.
  FOR v_id IN
    SELECT r.id FROM public.gst_refund_applications r
     WHERE r.deleted_at IS NULL AND r.client_id IS NOT NULL AND jsonb_typeof(r.documents) = 'array'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.documents) a
                    WHERE coalesce(a ->> 'url', '') ~ '/storage/v1/object/' AND coalesce(a ->> 'url', '') ~* '\.pdf($|\?)'
                      AND NOT EXISTS (SELECT 1 FROM public.ai_documents d WHERE d.source IN ('folder', 'refund') AND d.source_ref = a ->> 'url'))
  LOOP
    v_refunds := v_refunds + public.ai_documents_register_refund(v_id);
  END LOOP;
  FOR v_id IN
    SELECT DISTINCT d.notice_id FROM public.notice_drafts d
     WHERE d.status IN ('in_review', 'approved')
       AND NOT EXISTS (SELECT 1 FROM public.ai_documents x WHERE x.source = 'draft' AND x.source_ref = 'draft:' || d.notice_id)
  LOOP
    IF public.ai_documents_register_draft(v_id) THEN v_drafts := v_drafts + 1; END IF;
  END LOOP;

  IF coalesce(v_s.read_enabled, false) AND coalesce(v_s.read_backfill, false) THEN
    WITH cand AS (
      SELECT g.id, g.client_id, public.notice_read_document(g.id) AS doc
        FROM public.gst_notices g
       WHERE g.deleted_at IS NULL
         AND coalesce(g.form_code, '') NOT IN ('GSTR-3A', 'LUT', 'DRC-03')
         AND NOT public.notice_type_hidden(g.form_code)
         AND NOT EXISTS (SELECT 1 FROM public.notice_type_settings t WHERE t.form_code = g.form_code AND t.response_need = 'none')
         AND NOT EXISTS (SELECT 1 FROM public.notice_extractions x WHERE x.notice_id = g.id AND x.source = 'ai' AND x.status <> 'cancelled')
         AND public.ai_read_allowed(g.client_id) IS NULL
    ), ins AS (
      INSERT INTO public.notice_extractions (notice_id, client_id, source, status, priority, requested_by_name, document_url, document_label)
      SELECT cand.id, cand.client_id, 'ai', 'queued', 30, 'Reading every notice', cand.doc ->> 'url', cand.doc ->> 'label'
        FROM cand WHERE cand.doc IS NOT NULL
      ON CONFLICT DO NOTHING
      RETURNING 1)
    SELECT count(*)::int INTO v_notices FROM ins;
  END IF;

  -- A reply waits for its case's notices; those go first.
  UPDATE public.notice_extractions x SET priority = 45
    FROM public.gst_notices g
   WHERE x.notice_id = g.id AND x.source = 'ai' AND x.status = 'queued' AND x.priority < 45
     AND EXISTS (SELECT 1 FROM public.ai_documents d
                  WHERE d.client_id = g.client_id AND d.case_id = g.case_id AND d.role = 'reply' AND d.status = 'queued');

  UPDATE public.ai_runner_status SET last_sync_at = now() WHERE id;
  RETURN jsonb_build_object('documents', v_items, 'refund_documents', v_refunds, 'drafts', v_drafts, 'notices', v_notices);
END;
$$;

-- ── 2. A copy carries the reading of the file it copies ────────────────────
-- Skipped as a duplicate of a file already read: takes its reading at once.
CREATE OR REPLACE FUNCTION public.ai_documents_copy_reading()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_o public.ai_documents;
BEGIN
  IF NEW.status = 'skipped' AND NEW.reason_class = 'duplicate'
     AND coalesce(NEW.context ->> 'duplicate_of', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_o FROM public.ai_documents WHERE id = (NEW.context ->> 'duplicate_of')::uuid AND status = 'done' AND id <> NEW.id;
    IF v_o.id IS NOT NULL THEN
      NEW.status := 'done';
      NEW.doc_kind := v_o.doc_kind; NEW.title := v_o.title; NEW.summary := v_o.summary; NEW.doc_date := v_o.doc_date;
      NEW.reference := v_o.reference; NEW.outcome := v_o.outcome; NEW.paragraphs := v_o.paragraphs; NEW.key_facts := v_o.key_facts;
      NEW.overview := v_o.overview; NEW.pages := v_o.pages; NEW.text_layer := v_o.text_layer; NEW.model := v_o.model;
      NEW.usage := jsonb_build_object('copied_from', v_o.id);
      NEW.error := NULL;
      NEW.finished_at := coalesce(NEW.finished_at, now());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_documents_copy_reading ON public.ai_documents;
CREATE TRIGGER trg_ai_documents_copy_reading BEFORE UPDATE ON public.ai_documents
  FOR EACH ROW EXECUTE FUNCTION public.ai_documents_copy_reading();

-- Read (or read again): its copies take the reading.
CREATE OR REPLACE FUNCTION public.ai_documents_share_reading()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 3 THEN RETURN NULL; END IF;
  UPDATE public.ai_documents c
     SET status = 'done', doc_kind = NEW.doc_kind, title = NEW.title, summary = NEW.summary, doc_date = NEW.doc_date,
         reference = NEW.reference, outcome = NEW.outcome, paragraphs = NEW.paragraphs, key_facts = NEW.key_facts,
         overview = NEW.overview, pages = NEW.pages, text_layer = NEW.text_layer, model = NEW.model,
         usage = jsonb_build_object('copied_from', NEW.id), error = NULL, finished_at = coalesce(c.finished_at, now())
   WHERE c.context ->> 'duplicate_of' = NEW.id::text AND c.reason_class = 'duplicate' AND c.status IN ('skipped', 'done') AND c.id <> NEW.id
     AND (c.status <> 'done' OR c.summary IS DISTINCT FROM NEW.summary OR c.paragraphs IS DISTINCT FROM NEW.paragraphs
          OR c.overview IS DISTINCT FROM NEW.overview OR c.key_facts IS DISTINCT FROM NEW.key_facts);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_documents_share_reading ON public.ai_documents;
CREATE TRIGGER trg_ai_documents_share_reading AFTER UPDATE OF status, summary, paragraphs, overview, key_facts ON public.ai_documents
  FOR EACH ROW WHEN (NEW.status = 'done') EXECUTE FUNCTION public.ai_documents_share_reading();

-- The copies skipped so far.
UPDATE public.ai_documents SET status = status WHERE status = 'skipped' AND reason_class = 'duplicate';

-- ── 3. The refund documents in no folder ───────────────────────────────────
SELECT public.ai_documents_register_refund(r.id) FROM public.gst_refund_applications r WHERE r.deleted_at IS NULL;
