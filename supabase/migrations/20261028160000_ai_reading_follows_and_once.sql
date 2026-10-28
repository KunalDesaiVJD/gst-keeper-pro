-- Notices & Litigation: every paper's reading shown on its case, and nothing read
-- twice (the firm, 28 October 2026: "in cases also, some the cases are not read by
-- assistant … make sure that whenever new pull refresh is done, the documents or
-- files which were already read before should not be read again to save the
-- tokens"). docs/NOTICES_LITIGATION_POSITIONS.md §38.
--
-- 1. A reading follows its file. A portal refresh can replace a case folder item
--    by a new row carrying the same files (the old one soft deleted). The
--    reading stayed on the old row, and the case timeline, the advice and its
--    inputs look a reading up by its folder item: 76 papers read showed nothing
--    on their case, 47 queued would have, and 14 were cancelled with the old row
--    though the new one carries them. ai_documents_follow_items moves each
--    reading of a file to the live item that carries the file now (a cancelled
--    one queued again), at every ai_sync and once here. A file read before is
--    never read again: its row is the same (keyed by the file's address), and a
--    new address with the same file is a copy carrying the reading (by its
--    fingerprint, 20261028120000).
-- 2. A notice's PDF read before is not read again when it comes back at a new
--    address with the same content (notice_read_hash, called by notice-ai 1.6.0
--    before it reads): the reading queued by the new address is dropped and the
--    earlier one keeps standing, its address brought up to date. A reading a
--    person asked for (Read the PDF) is always read.
-- 3. The case advice is worked out again only when the case changed: its hash
--    counts the distinct files read, not their rows, so a copy or a moved
--    reading of a file already counted does not start it again. Advice current
--    before is carried over (also advice made stale only by copies today).

-- ── 1. A reading follows its file ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ai_documents_follow_items()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  WITH live AS (
    SELECT DISTINCT ON (a ->> 'url') a ->> 'url' AS url, fi.id AS item_id, fi.case_id, fi.folder_section
      FROM public.gst_case_folder_items fi
     CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(fi.attachments) = 'array' THEN fi.attachments ELSE '[]'::jsonb END) a
     WHERE fi.deleted_at IS NULL AND coalesce(a ->> 'url', '') ~ '/storage/v1/object/'
     ORDER BY a ->> 'url', fi.last_seen_at DESC NULLS LAST, fi.first_seen_at DESC NULLS LAST
  ), moved AS (
    UPDATE public.ai_documents d
       SET folder_item_id = l.item_id,
           case_id = coalesce(l.case_id, d.case_id),
           status = CASE WHEN d.status = 'cancelled' AND d.reason_class = 'deleted' THEN 'queued' ELSE d.status END,
           attempts = CASE WHEN d.status = 'cancelled' AND d.reason_class = 'deleted' THEN 0 ELSE d.attempts END,
           finished_at = CASE WHEN d.status = 'cancelled' AND d.reason_class = 'deleted' THEN NULL ELSE d.finished_at END,
           reason_class = CASE WHEN d.status = 'cancelled' AND d.reason_class = 'deleted' THEN NULL ELSE d.reason_class END
      FROM live l
     WHERE d.source = 'folder' AND d.source_ref = l.url AND d.folder_item_id IS DISTINCT FROM l.item_id
       AND (d.folder_item_id IS NULL
            OR EXISTS (SELECT 1 FROM public.gst_case_folder_items o WHERE o.id = d.folder_item_id AND o.deleted_at IS NOT NULL))
    RETURNING 1)
  SELECT count(*)::int INTO v_n FROM moved;
  RETURN v_n;
END;
$$;
COMMENT ON FUNCTION public.ai_documents_follow_items() IS
  'Moves each folder reading to the live case folder item that carries its file now (a refresh replaces items), queuing again one cancelled with the old item (20261028160000).';
REVOKE ALL ON FUNCTION public.ai_documents_follow_items() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_documents_follow_items() TO service_role;

CREATE OR REPLACE FUNCTION public.ai_sync()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_s       public.ai_settings;
  v_items   int := 0;
  v_refunds int := 0;
  v_drafts  int := 0;
  v_notices int := 0;
  v_moved   int := 0;
  v_id      uuid;
BEGIN
  SELECT * INTO v_s FROM public.ai_settings WHERE id;
  -- A reading follows its file to the folder item that carries it now (1).
  v_moved := public.ai_documents_follow_items();
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
  RETURN jsonb_build_object('documents', v_items, 'refund_documents', v_refunds, 'drafts', v_drafts, 'notices', v_notices, 'moved', v_moved);
END;
$$;

-- ── 2. A notice's PDF read before is not read again ────────────────────────
CREATE OR REPLACE FUNCTION public.notice_read_hash(p_extraction_id uuid, p_agent text, p_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_x    public.notice_extractions;
  v_prev public.notice_extractions;
BEGIN
  SELECT * INTO v_x FROM public.notice_extractions WHERE id = p_extraction_id FOR UPDATE;
  IF v_x.id IS NULL THEN RETURN jsonb_build_object('error', 'gone'); END IF;
  IF v_x.status <> 'running' OR v_x.agent_id IS DISTINCT FROM p_agent THEN RETURN jsonb_build_object('error', 'not_yours'); END IF;
  UPDATE public.notice_extractions SET document_sha256 = p_sha256 WHERE id = v_x.id;
  -- A person asked for this reading: it is read.
  IF v_x.requested_by IS NOT NULL THEN RETURN jsonb_build_object('duplicate', false); END IF;
  SELECT * INTO v_prev FROM public.notice_extractions x
   WHERE x.notice_id = v_x.notice_id AND x.id <> v_x.id AND x.source = 'ai' AND x.status = 'done' AND x.document_sha256 = p_sha256
   ORDER BY x.finished_at DESC NULLS LAST LIMIT 1;
  IF v_prev.id IS NULL THEN RETURN jsonb_build_object('duplicate', false); END IF;
  -- The earlier reading stands, at the file's new address (so the refresh does not queue it again).
  UPDATE public.notice_extractions SET document_url = v_x.document_url, document_label = coalesce(v_x.document_label, document_label)
   WHERE id = v_prev.id;
  DELETE FROM public.notice_extractions WHERE id = v_x.id;
  RETURN jsonb_build_object('duplicate', true, 'of', v_prev.id);
END;
$$;
COMMENT ON FUNCTION public.notice_read_hash(uuid, text, text) IS
  'Before the AI reads a notice PDF: the same file read before for that notice (by SHA-256) is not read again unless a person asked; the queued reading is dropped and the earlier one stands at the new address (20261028160000).';
REVOKE ALL ON FUNCTION public.notice_read_hash(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notice_read_hash(uuid, text, text) TO service_role;

-- ── 3. The case advice again only when the case changed ────────────────────
-- Which advice is current now: by the hash as it was, or as it was but for today's copies.
CREATE OR REPLACE FUNCTION pg_temp.advice_hash_but_copies(p_client_id uuid, p_case_key text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT md5(concat_ws('|', c.stage, c.is_open, c.is_overdue, c.next_due, c.next_hearing, c.notices, c.documents, c.last_arrived_at,
    (SELECT count(*) FROM public.ai_documents d
      WHERE d.status = 'done' AND d.client_id = c.client_id AND coalesce(d.usage ->> 'copied_from', '') = ''
        AND (d.notice_id IN (SELECT f.id FROM public.notice_facts f
                              WHERE f.client_id = c.client_id
                                AND public.notice_case_key(f.client_id, f.case_id, f.category, f.id) = c.case_key)
          OR d.folder_item_id IN (SELECT fi.id FROM public.gst_case_folder_items fi
                                   WHERE fi.client_id = c.client_id AND fi.deleted_at IS NULL
                                     AND public.notice_case_root(fi.client_id, fi.case_id) = c.case_key)))))
    FROM public.notice_cases c
   WHERE c.client_id = p_client_id AND c.case_key = public.notice_case_root(p_client_id, p_case_key)
$$;
CREATE TEMP TABLE _advice_current AS
  SELECT a.client_id, a.case_key FROM public.notice_case_advice a
   WHERE a.status = 'done'
     AND (a.inputs_hash = public.notice_case_advice_hash(a.client_id, a.case_key)
          OR a.inputs_hash = pg_temp.advice_hash_but_copies(a.client_id, a.case_key));

CREATE OR REPLACE FUNCTION public.notice_case_advice_hash(p_client_id uuid, p_case_key text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT md5(concat_ws('|', c.stage, c.is_open, c.is_overdue, c.next_due, c.next_hearing, c.notices, c.documents, c.last_arrived_at,
    (SELECT count(DISTINCT coalesce(d.document_sha256, d.id::text)) FROM public.ai_documents d
      WHERE d.status = 'done' AND d.client_id = c.client_id
        AND (d.notice_id IN (SELECT f.id FROM public.notice_facts f
                              WHERE f.client_id = c.client_id
                                AND public.notice_case_key(f.client_id, f.case_id, f.category, f.id) = c.case_key)
          OR d.folder_item_id IN (SELECT fi.id FROM public.gst_case_folder_items fi
                                   WHERE fi.client_id = c.client_id AND fi.deleted_at IS NULL
                                     AND public.notice_case_root(fi.client_id, fi.case_id) = c.case_key)))))
    FROM public.notice_cases c
   WHERE c.client_id = p_client_id AND c.case_key = public.notice_case_root(p_client_id, p_case_key)
$$;

-- The hash of the current advice with the readings where they were, then the readings moved:
-- advice that now sees more of its case is worked out again, the rest is carried over.
CREATE TEMP TABLE _advice_before AS
  SELECT c.client_id, c.case_key, public.notice_case_advice_hash(c.client_id, c.case_key) AS h FROM _advice_current c;
SELECT public.ai_documents_follow_items();
UPDATE public.notice_case_advice a SET inputs_hash = b.h
  FROM _advice_before b
 WHERE a.client_id = b.client_id AND a.case_key = b.case_key AND a.status = 'done'
   AND public.notice_case_advice_hash(a.client_id, a.case_key) = b.h;
DROP TABLE _advice_before;
DROP TABLE _advice_current;
