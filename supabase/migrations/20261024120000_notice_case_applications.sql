-- Notices · an application filed on the portal joins the case it is against
-- (24 October 2026).
--
-- M J Surgical's appeal AD241225010791I (APL-01, Appeal Submitted on 11 December
-- 2025) against the refund order ZD240925036738Y of case AA240725124515C, and
-- Tamnna Infrastructure-Gujarat's AD241025009582I (17 October 2025) against
-- ZD240725066729V of case AD240624007234I, were never linked: an appeal only
-- submitted has no case folder or notice yet, and is kept only in
-- gst_portal_applications (sync_ingest_applications), which the linker never read.
-- Its refId is the order it is against.
--
-- 1. notice_case_idents: an application is its ARN's own and names its refId,
--    so notice_case_links_refresh links it under the case holding that order
--    (an appeal, waiver or rectification by its case type).
-- 2. notice_case_parts: an application is a case by its ARN (marker from the
--    case type, filed date, form, status as title, open until decided).
-- 3. notice_case_chain: each member carries its application (form, status,
--    filed date, the order it is against).
-- 4. notice_case_correspondence: an application with no folder or notice of its
--    own is listed in the case it is against (kind application, from us).
-- 5. A trigger on gst_portal_applications links the client's cases again.

-- ── 1. Numbers ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_case_idents(p_client_id uuid)
RETURNS TABLE (own_key text, ident text, item_kind text, item_id uuid, is_notice_ref boolean, owns boolean)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH n AS (
    SELECT f.id, f.case_id, public.notice_case_key(f.case_id, f.category, f.id) AS own_key,
           f.reference_number, f.order_number, f.submission_arn, f.reply_ref_number, f.description, f.remarks
      FROM public.notice_facts f
     WHERE f.client_id = p_client_id
  ), raw AS (
    SELECT n.own_key, 'notice'::text AS kind, n.id, v.x, v.is_ref, v.owns
      FROM n CROSS JOIN LATERAL (VALUES (n.reference_number, true, true), (n.order_number, true, true), (n.submission_arn, false, true),
                                        (n.reply_ref_number, false, true), (n.case_id, false, true)) v(x, is_ref, owns)
    UNION ALL
    SELECT n.own_key, 'notice', n.id, t.tok, false, false
      FROM n CROSS JOIN LATERAL public.notice_ref_tokens(concat_ws(' ', n.description, n.remarks,
                                  (SELECT g.portal_detail::text FROM public.gst_notices g WHERE g.id = n.id))) t(tok)
    UNION ALL
    -- A folder item's own reference belongs to its case, unless it is an
    -- application or reply, whose reference may be the order it answers.
    SELECT fi.case_id, 'document', fi.id, v.x, false, v.owns
      FROM public.gst_case_folder_items fi
      CROSS JOIN LATERAL (VALUES (fi.reference_number, upper(coalesce(fi.folder_section, '')) NOT IN ('APLCN', 'REPLY', 'REPLIES')),
                                 (fi.case_id, true)) v(x, owns)
     WHERE fi.client_id = p_client_id AND fi.deleted_at IS NULL AND nullif(btrim(fi.case_id), '') IS NOT NULL
    UNION ALL
    SELECT fi.case_id, 'document', fi.id, t.tok, false, false
      FROM public.gst_case_folder_items fi CROSS JOIN LATERAL public.notice_ref_tokens(fi.raw_json::text) t(tok)
     WHERE fi.client_id = p_client_id AND fi.deleted_at IS NULL AND nullif(btrim(fi.case_id), '') IS NOT NULL
    UNION ALL
    -- What the AI read in a case's documents (an appeal's grounds quote the order).
    SELECT d.case_id, 'document', d.folder_item_id, t.tok, false, false
      FROM public.ai_documents d CROSS JOIN LATERAL public.notice_ref_tokens(concat_ws(' ', d.title, d.summary, d.overview::text)) t(tok)
     WHERE d.client_id = p_client_id AND d.status = 'done' AND nullif(btrim(d.case_id), '') IS NOT NULL
    UNION ALL
    -- 20261024120000: an application filed on the portal (appeal, s.128A waiver,
    -- rectification) is its ARN's own, and names the order it is against (refId).
    SELECT upper(btrim(a.arn)), 'application', a.id, v.x, false, v.owns
      FROM public.gst_portal_applications a
      CROSS JOIN LATERAL (VALUES (a.arn, true), (a.raw_json -> 'appItem' ->> 'refId', false)) v(x, owns)
     WHERE a.client_id = p_client_id AND a.deleted_at IS NULL AND nullif(btrim(a.arn), '') IS NOT NULL
  )
  SELECT r.own_key, upper(btrim(r.x)), r.kind, r.id, bool_or(r.is_ref),
         -- A case's own ID is its own wherever it appears.
         bool_or(r.owns) OR upper(btrim(r.x)) = upper(r.own_key)
    FROM raw r
   WHERE length(btrim(coalesce(r.x, ''))) >= 6 AND r.own_key IS NOT NULL AND r.own_key <> 'REG'
   GROUP BY r.own_key, upper(btrim(r.x)), r.kind, r.id
$$;
REVOKE ALL ON FUNCTION public.notice_case_idents(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.notice_case_idents(uuid) IS
  'Every portal number a client''s notice cases carry (own key, number, the notice or folder item, whether it is a notice''s or order''s own reference). notice_case_links_refresh links cases that share one.';

-- ── 2. What a case is ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_case_parts(p_client_id uuid)
RETURNS TABLE (
  own_key text, marker text, refund_app boolean, about_refund boolean, has_order boolean,
  order_form text, order_ref text, order_date date, first_date date, last_date date,
  financial_year text, amount numeric, track text, notices int, documents int, is_open boolean,
  lead_notice_id uuid, title text, form_code text, forms text[], stage text,
  refund_sanctioned numeric, refund_rejected numeric)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH n AS (
    SELECT f.*, public.notice_case_key(f.case_id, f.category, f.id) AS own_key,
           CASE WHEN f.system_generated THEN 'other' ELSE public.notice_track(f.category) END AS trk
      FROM public.notice_facts f
     WHERE f.client_id = p_client_id
  ), d AS (
    SELECT fi.id, fi.case_id AS own_key, fi.folder_section, fi.reference_number, fi.raw_json,
           upper(coalesce(fi.raw_json ->> 'formNo', '')) AS form_no,
           public.notice_folder_item_date(fi.raw_json) AS dt
      FROM public.gst_case_folder_items fi
     WHERE fi.client_id = p_client_id AND fi.deleted_at IS NULL AND nullif(btrim(fi.case_id), '') IS NOT NULL
  ), a AS (
    -- 20261024120000: applications filed on the portal; an appeal only submitted
    -- has no case folder or notice yet, and is a case by its ARN.
    SELECT upper(btrim(x.arn)) AS own_key, x.case_type_cd, x.status, x.filed_date,
           nullif(substring(upper(coalesce(x.form_number, '')) FROM '([A-Z]{2,4}-[0-9]{1,2}[A-Z]?)'), '') AS form,
           CASE x.case_type_cd WHEN 'APPEL' THEN 'appeal' WHEN 'ADJWS' THEN 'waiver' WHEN 'ADJRO' THEN 'rectification' END AS marker
      FROM public.gst_portal_applications x
     WHERE x.client_id = p_client_id AND x.deleted_at IS NULL AND nullif(btrim(x.arn), '') IS NOT NULL
  ), keys AS (
    SELECT n.own_key FROM n UNION SELECT d.own_key FROM d UNION SELECT a.own_key FROM a
  )
  SELECT k.own_key,
         CASE
           WHEN EXISTS (SELECT 1 FROM n WHERE n.own_key = k.own_key
                          AND (n.form_code LIKE 'APL-%' OR coalesce(n.notice_type, '') ILIKE 'appeal%' OR coalesce(n.category, '') ILIKE 'appeal%'))
             OR EXISTS (SELECT 1 FROM d WHERE d.own_key = k.own_key
                          AND (d.raw_json ->> 'apl' = 'APPEAL' OR d.raw_json ? 'aplnum' OR d.form_no LIKE 'APL%'))
             THEN 'appeal'
           WHEN EXISTS (SELECT 1 FROM n WHERE n.own_key = k.own_key AND n.form_code LIKE 'SPL-%')
             OR EXISTS (SELECT 1 FROM d WHERE d.own_key = k.own_key AND d.form_no LIKE 'SPL%')
             THEN 'waiver'
           WHEN EXISTS (SELECT 1 FROM n WHERE n.own_key = k.own_key AND n.form_code LIKE 'RECT-%' AND n.form_code <> 'RECT-ORDER')
             THEN 'rectification'
           ELSE (SELECT a.marker FROM a WHERE a.own_key = k.own_key AND a.marker IS NOT NULL ORDER BY a.filed_date DESC NULLS LAST LIMIT 1)
         END,
         EXISTS (SELECT 1 FROM d WHERE d.own_key = k.own_key AND d.form_no LIKE '%RFD-01%')
           OR EXISTS (SELECT 1 FROM n WHERE n.own_key = k.own_key AND n.form_code IN ('RFD-01', 'RFD-02')),
         EXISTS (SELECT 1 FROM n WHERE n.own_key = k.own_key
                   AND (n.trk = 'refund' OR coalesce(n.description, '') ILIKE '%refund%' OR coalesce(n.form_label, '') ILIKE '%refund%'))
           OR EXISTS (SELECT 1 FROM d WHERE d.own_key = k.own_key AND (d.form_no LIKE 'RFD%' OR d.raw_json::text ILIKE '%refund%')),
         o.form IS NOT NULL, o.form, o.ref, o.dt,
         (SELECT min(x) FROM (SELECT n.issue_date AS x FROM n WHERE n.own_key = k.own_key UNION ALL SELECT d.dt FROM d WHERE d.own_key = k.own_key
                                  UNION ALL SELECT a.filed_date FROM a WHERE a.own_key = k.own_key) z),
         (SELECT max(x) FROM (SELECT n.issue_date AS x FROM n WHERE n.own_key = k.own_key UNION ALL SELECT d.dt FROM d WHERE d.own_key = k.own_key
                                  UNION ALL SELECT a.filed_date FROM a WHERE a.own_key = k.own_key) z),
         (SELECT public.notice_fy_key(n.financial_year) FROM n WHERE n.own_key = k.own_key AND n.financial_year IS NOT NULL
           ORDER BY n.issue_date DESC NULLS LAST LIMIT 1),
         (SELECT max(n.amount_of_demand) FROM n WHERE n.own_key = k.own_key),
         coalesce((SELECT CASE WHEN bool_or(n.trk = 'litigation') THEN 'litigation' WHEN bool_or(n.trk = 'refund') THEN 'refund'
                               WHEN bool_or(n.trk = 'registration') THEN 'registration' ELSE 'other' END
                     FROM n WHERE n.own_key = k.own_key HAVING count(*) > 0),
                  CASE WHEN EXISTS (SELECT 1 FROM d WHERE d.own_key = k.own_key AND d.form_no LIKE 'RFD%') THEN 'refund' ELSE 'litigation' END),
         (SELECT count(*)::int FROM n WHERE n.own_key = k.own_key),
         (SELECT count(*)::int FROM d WHERE d.own_key = k.own_key),
         coalesce((SELECT bool_or(n.is_open) FROM n WHERE n.own_key = k.own_key),
                  -- An application with no notice yet is open until the portal shows it decided.
                  (SELECT bool_or(coalesce(a.status, '') !~* '(withdrawn|rejected|order|rectified|disposed|closed)') FROM a WHERE a.own_key = k.own_key),
                  false),
         l.id,
         coalesce(l.title, (SELECT a.status FROM a WHERE a.own_key = k.own_key ORDER BY a.filed_date DESC NULLS LAST LIMIT 1)),
         coalesce(l.form_code, (SELECT a.form FROM a WHERE a.own_key = k.own_key AND a.form IS NOT NULL LIMIT 1)),
         (SELECT array_agg(DISTINCT x) FROM (
            SELECT n.form_code AS x FROM n WHERE n.own_key = k.own_key AND n.form_code IS NOT NULL
            UNION SELECT substring(d.form_no FROM '([A-Z]{2,4}-[0-9]{1,2}[A-Z]?)') FROM d WHERE d.own_key = k.own_key
            UNION SELECT a.form FROM a WHERE a.own_key = k.own_key) z WHERE x IS NOT NULL),
         l.stage,
         (SELECT max((a.overview ->> 'refund_sanctioned')::numeric) FROM public.ai_documents a
           WHERE a.client_id = p_client_id AND a.case_id = k.own_key AND a.status = 'done'
             AND coalesce(a.overview ->> 'refund_sanctioned', '') ~ '^\d+(\.\d+)?$'),
         (SELECT max((a.overview ->> 'refund_rejected')::numeric) FROM public.ai_documents a
           WHERE a.client_id = p_client_id AND a.case_id = k.own_key AND a.status = 'done'
             AND coalesce(a.overview ->> 'refund_rejected', '') ~ '^\d+(\.\d+)?$')
    FROM keys k
    -- The case's order: a notice of an order form, else a document filed under orders.
    LEFT JOIN LATERAL (
      SELECT x.form, x.ref, x.dt FROM (
        SELECT n.form_code AS form, n.reference_number AS ref, coalesce(n.order_date, n.issue_date) AS dt, 1 AS pref
          FROM n WHERE n.own_key = k.own_key AND n.form_code = ANY (public.notice_order_forms())
        UNION ALL
        SELECT coalesce(substring(d.form_no FROM '([A-Z]{2,4}-[0-9]{1,2}[A-Z]?)'), 'Order'), d.reference_number, d.dt, 2
          FROM d WHERE d.own_key = k.own_key AND upper(coalesce(d.folder_section, '')) IN ('ORDRS', 'ORDER', 'ORDERS')
      ) x ORDER BY x.pref, x.dt DESC NULLS LAST LIMIT 1
    ) o ON true
    LEFT JOIN LATERAL (
      SELECT n.id, coalesce(n.form_label, n.notice_type, 'Notice') AS title, n.form_code, n.stage
        FROM n WHERE n.own_key = k.own_key
       ORDER BY n.is_open DESC, (CASE WHEN n.is_open THEN n.effective_due END) ASC NULLS LAST, n.issue_date DESC NULLS LAST
       LIMIT 1
    ) l ON true
   WHERE k.own_key IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.notice_case_parts(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.notice_case_parts(uuid) IS
  'Each portal case of a client as the linker sees it: appeal / waiver / rectification, refund application, the order it holds, dates, year, amount, refund outcome.';

-- ── 3. A chain ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_case_chain(p_client_id uuid, p_case_key text)
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH root AS (
    SELECT public.notice_case_root(p_client_id, p_case_key) AS k
  ), p AS (
    SELECT * FROM public.notice_case_parts(p_client_id)
  ), m AS (
    SELECT p.*, l.parent_key, l.kind, l.source, l.reason, l.via_ref, l.created_by_name AS linked_by, l.created_at AS linked_at
      FROM p
      LEFT JOIN public.notice_case_links l ON l.client_id = p_client_id AND l.child_key = p.own_key
     WHERE public.notice_case_root(p_client_id, p.own_key) = (SELECT k FROM root)
  )
  SELECT jsonb_build_object(
    'root_key', (SELECT k FROM root),
    'members', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'case_key', m.own_key,
        'case_id', CASE WHEN m.own_key LIKE 'N:%' OR m.own_key = 'REG' THEN NULL ELSE m.own_key END,
        'parent_key', m.parent_key, 'kind', m.kind, 'source', m.source, 'reason', m.reason, 'via_ref', m.via_ref,
        'linked_by', m.linked_by, 'linked_at', m.linked_at,
        'marker', m.marker, 'track', m.track, 'title', m.title, 'form_code', m.form_code, 'forms', m.forms,
        'lead_notice_id', m.lead_notice_id, 'stage', m.stage, 'is_open', m.is_open,
        'notices', m.notices, 'documents', m.documents, 'first_date', m.first_date, 'last_date', m.last_date,
        'financial_year', m.financial_year, 'amount', m.amount,
        -- 20261024120000: the application filed on the portal under this ARN.
        'application', (SELECT jsonb_build_object('form', x.form_number, 'status', x.status, 'filed_date', x.filed_date,
                                                  'against', x.raw_json -> 'appItem' ->> 'refId')
                          FROM public.gst_portal_applications x
                         WHERE x.client_id = p_client_id AND x.deleted_at IS NULL AND upper(btrim(x.arn)) = m.own_key
                         ORDER BY x.filed_date DESC NULLS LAST LIMIT 1),
        'order', CASE WHEN m.has_order THEN jsonb_build_object('form', m.order_form, 'ref', m.order_ref, 'date', m.order_date) END,
        'refund', CASE WHEN m.refund_sanctioned IS NOT NULL OR m.refund_rejected IS NOT NULL
                       THEN jsonb_build_object('sanctioned', m.refund_sanctioned, 'rejected', m.refund_rejected) END)
        ORDER BY m.first_date NULLS LAST, m.own_key) FROM m), '[]'::jsonb),
    -- Pairs a person unlinked, with this chain on one side.
    'unlinked', coalesce((SELECT jsonb_agg(jsonb_build_object('child_key', b.child_key, 'parent_key', b.parent_key,
                                                             'by', b.created_by_name, 'at', b.created_at) ORDER BY b.created_at DESC)
                            FROM public.notice_case_link_blocks b
                           WHERE b.client_id = p_client_id
                             AND (b.child_key IN (SELECT m.own_key FROM m) OR b.parent_key IN (SELECT m.own_key FROM m))), '[]'::jsonb))
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_chain(uuid, text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.notice_case_chain(uuid, text) IS
  'The portal cases linked into one chain with the given case (the root first by date), how each is linked, and the pairs a person unlinked.';

-- ── 4. Correspondence ────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.notice_case_correspondence AS
WITH n AS (
  SELECT f.id, f.client_id, f.case_id, f.category, f.form_code, f.form_label, f.notice_type, f.reference_number,
         f.issue_date, f.first_seen_at, public.notice_case_key(f.client_id, f.case_id, f.category, f.id) AS case_key,
         public.notice_case_key(f.case_id, f.category, f.id) AS own_key
    FROM public.notice_facts f
), firsts AS (
  SELECT g.client_id, min(g.first_seen_at) AS first_at FROM public.gst_notices g GROUP BY g.client_id
), items AS (
  SELECT n.client_id, n.case_key, 'notice'::text AS kind, n.id AS item_id, 'department'::text AS from_party,
         -- 20261014120000: the date on the notice; never the day it was synced.
         coalesce(n.issue_date, (SELECT public.notice_doc_date_ok(d.doc_date) FROM public.ai_documents d
                                  WHERE d.notice_id = n.id AND d.status = 'done' ORDER BY d.updated_at DESC LIMIT 1)) AS item_date, n.first_seen_at,
         coalesce(n.form_code || ' · ', '') || coalesce(n.form_label, n.notice_type, 'Notice') AS label,
         n.reference_number AS reference, NULL::text AS folder_section, n.own_key
    FROM n
  UNION ALL
  SELECT fi.client_id, public.notice_case_root(fi.client_id, fi.case_id), 'document', fi.id, public.notice_folder_from(fi.folder_section),
         -- 20261014120000: the date printed on the document (as the AI read it) first, then the portal's date; never the sync date.
         coalesce((SELECT public.notice_doc_date_ok(d.doc_date) FROM public.ai_documents d
                    WHERE d.folder_item_id = fi.id AND d.status = 'done' ORDER BY d.updated_at DESC LIMIT 1),
                  public.notice_folder_item_date(fi.raw_json)), fi.first_seen_at,
         public.notice_folder_label(fi.folder_section, fi.raw_json), fi.reference_number, fi.folder_section, fi.case_id
    FROM public.gst_case_folder_items fi
   WHERE fi.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM n WHERE n.client_id = fi.client_id AND n.case_key = public.notice_case_root(fi.client_id, fi.case_id))
     -- The folder's copy of a notice already listed is that notice, not another item.
     AND NOT EXISTS (SELECT 1 FROM n WHERE n.client_id = fi.client_id AND n.case_key = public.notice_case_root(fi.client_id, fi.case_id)
                       AND n.reference_number IS NOT NULL AND n.reference_number = fi.reference_number)
  UNION ALL
  -- 20261024120000: an application filed on the portal that has no case folder
  -- or notice of its own yet (an appeal only submitted), in the case it is against.
  SELECT a.client_id, public.notice_case_root(a.client_id, upper(btrim(a.arn))), 'application', a.id, 'taxpayer',
         a.filed_date, a.first_seen_at,
         coalesce(nullif(btrim(regexp_replace(coalesce(a.form_number, ''), '^GST\s+', '', 'i')), '') || ' · ', '')
           || coalesce(a.status, CASE a.case_type_cd WHEN 'APPEL' THEN 'Appeal' WHEN 'ADJWS' THEN 'Waiver application' WHEN 'ADJRO' THEN 'Rectification application' ELSE 'Application' END),
         upper(btrim(a.arn)), 'APLCN', upper(btrim(a.arn))
    FROM public.gst_portal_applications a
   WHERE a.deleted_at IS NULL AND nullif(btrim(a.arn), '') IS NOT NULL
     AND EXISTS (SELECT 1 FROM n WHERE n.client_id = a.client_id AND n.case_key = public.notice_case_root(a.client_id, upper(btrim(a.arn))))
     AND NOT EXISTS (SELECT 1 FROM n WHERE n.client_id = a.client_id AND n.own_key = upper(btrim(a.arn)))
     AND NOT EXISTS (SELECT 1 FROM public.gst_case_folder_items fi
                      WHERE fi.client_id = a.client_id AND fi.deleted_at IS NULL AND upper(btrim(fi.case_id)) = upper(btrim(a.arn)))
)
SELECT i.client_id, i.case_key, i.kind, i.item_id, i.from_party, i.item_date, i.first_seen_at, i.label, i.reference, i.folder_section,
       s.seen_at,
       (i.first_seen_at > fr.first_at + interval '1 hour'
        AND i.first_seen_at > now() - interval '30 days'
        AND i.first_seen_at > coalesce(s.seen_at, '-infinity'::timestamptz)) AS is_new,
       i.own_key
  FROM items i
  LEFT JOIN firsts fr ON fr.client_id = i.client_id
  LEFT JOIN public.notice_case_seen s ON s.client_id = i.client_id AND s.case_key = i.case_key;

-- ── 5. A new or changed application links its client's cases at once ──────
CREATE OR REPLACE FUNCTION public.gst_portal_applications_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.notice_case_links_refresh(coalesce(NEW.client_id, OLD.client_id));
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_gst_portal_applications_link ON public.gst_portal_applications;
CREATE TRIGGER trg_gst_portal_applications_link
  AFTER INSERT OR UPDATE OF arn, raw_json, deleted_at, case_type_cd ON public.gst_portal_applications
  FOR EACH ROW EXECUTE FUNCTION public.gst_portal_applications_link();

SELECT public.notice_case_links_refresh(NULL);
