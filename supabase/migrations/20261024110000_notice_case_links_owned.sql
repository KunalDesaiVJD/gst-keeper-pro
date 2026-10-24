-- Notices · linked cases, tightened after the first live run (24 October 2026).
--
-- 20261024100000 linked, on live, an M J Surgical refund into its LUT case (the
-- RFD-01 names the LUT it exports under), and two refunds through a third
-- case's ID that both replies quote. A link by itself now needs:
-- 1. a number that is one of the two cases' own: its case ID, the reference of
--    a notice or order in it, or a folder item's reference outside applications
--    and replies (notice_case_numbers.owns); a third case's number on both says
--    nothing certain;
-- 2. neither case of the kind other (LUT, voluntary payment, acceptance), which
--    many papers name without belonging to them.
-- Both stay open to a person (Link a case) and to the suggestions.
-- Tamnna Infrastructure-Gujarat's appeal (APL-02, its application naming the
-- DRC-07 ZD2403260211513) stays linked: that number is the order's own.

-- A new name rather than a changed return type: notice_case_idents (20261024100000)
-- stays, unused, so applying this drops nothing.
CREATE OR REPLACE FUNCTION public.notice_case_numbers(p_client_id uuid)
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
  )
  SELECT r.own_key, upper(btrim(r.x)), r.kind, r.id, bool_or(r.is_ref),
         -- A case's own ID is its own wherever it appears.
         bool_or(r.owns) OR upper(btrim(r.x)) = upper(r.own_key)
    FROM raw r
   WHERE length(btrim(coalesce(r.x, ''))) >= 6 AND r.own_key IS NOT NULL AND r.own_key <> 'REG'
   GROUP BY r.own_key, upper(btrim(r.x)), r.kind, r.id
$$;
REVOKE ALL ON FUNCTION public.notice_case_numbers(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.notice_case_numbers(uuid) IS
  'Every portal number a client''s notice cases carry (own key, number, the notice or folder item, whether it is a notice''s or order''s own reference). notice_case_links_refresh links cases that share one.';

CREATE OR REPLACE FUNCTION public.notice_case_links_refresh(p_client_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int := 0;
  v_c uuid;
  r   record;
BEGIN
  IF p_client_id IS NULL THEN
    DELETE FROM public.notice_case_links l WHERE l.source = 'auto'
       AND NOT EXISTS (SELECT 1 FROM public.gst_notices g WHERE g.client_id = l.client_id AND g.deleted_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.gst_case_folder_items i WHERE i.client_id = l.client_id AND i.deleted_at IS NULL);
    FOR v_c IN
      SELECT g.client_id FROM public.gst_notices g WHERE g.deleted_at IS NULL
      UNION SELECT i.client_id FROM public.gst_case_folder_items i WHERE i.deleted_at IS NULL
    LOOP
      v_n := v_n + public.notice_case_links_refresh(v_c);
    END LOOP;
    RETURN v_n;
  END IF;

  DELETE FROM public.notice_case_links WHERE source = 'auto' AND client_id = p_client_id;
  FOR r IN
    WITH i AS (
      SELECT * FROM public.notice_case_numbers(p_client_id)
    ), spread AS (
      -- A number on papers of more than three cases says nothing certain.
      SELECT i.ident FROM i GROUP BY i.ident HAVING count(DISTINCT i.own_key) BETWEEN 2 AND 3
    ), p AS (
      SELECT * FROM public.notice_case_parts(p_client_id)
    ), pairs AS (
      SELECT a.own_key AS a_key, b.own_key AS b_key, a.ident,
             bool_or(a.is_notice_ref) AS a_ref, bool_or(b.is_notice_ref) AS b_ref,
             bool_or(a.owns) OR bool_or(b.owns) AS owned,
             (array_agg(a.item_id) FILTER (WHERE a.item_kind = 'document'))[1] AS a_item,
             (array_agg(b.item_id) FILTER (WHERE b.item_kind = 'document'))[1] AS b_item
        FROM i a
        JOIN i b ON b.ident = a.ident AND b.own_key > a.own_key
        JOIN spread s ON s.ident = a.ident
       GROUP BY a.own_key, b.own_key, a.ident
    ), dir AS (
      SELECT pr.*, x.a_child,
             CASE WHEN x.a_child THEN pr.a_key ELSE pr.b_key END AS child_key,
             CASE WHEN x.a_child THEN pr.b_key ELSE pr.a_key END AS parent_key,
             CASE WHEN x.a_child THEN pr.b_ref ELSE pr.a_ref END AS parent_ref,
             CASE WHEN x.a_child THEN pr.a_item ELSE pr.b_item END AS child_item,
             coalesce(CASE WHEN x.a_child THEN pa.marker ELSE pb.marker END,
                      CASE WHEN pa.refund_app AND pb.refund_app THEN 'reapplication' ELSE 'related' END) AS kind
        FROM pairs pr
        JOIN p pa ON pa.own_key = pr.a_key
        JOIN p pb ON pb.own_key = pr.b_key
        CROSS JOIN LATERAL (SELECT CASE
            -- A case-less notice joins the portal case.
            WHEN pr.a_key LIKE 'N:%' AND pr.b_key NOT LIKE 'N:%' THEN true
            WHEN pr.b_key LIKE 'N:%' AND pr.a_key NOT LIKE 'N:%' THEN false
            -- The appeal (waiver, rectification) belongs to the case it is against.
            WHEN pa.marker IS NOT NULL AND pb.marker IS NULL THEN true
            WHEN pb.marker IS NOT NULL AND pa.marker IS NULL THEN false
            -- Otherwise the later case belongs to the earlier.
            ELSE (coalesce(pa.first_date, DATE '1900-01-01'), pr.a_key) > (coalesce(pb.first_date, DATE '1900-01-01'), pr.b_key)
          END AS a_child) x
       WHERE pr.a_key <> 'REG' AND pr.b_key <> 'REG'
         -- The number must be one of the two cases' own (its ID, a notice or
         -- order of it): a third case's number on both says nothing certain.
         AND pr.owned
         -- An LUT, a voluntary payment or an acceptance is named on many
         -- papers (a refund names its LUT) without belonging to them.
         AND pa.track <> 'other' AND pb.track <> 'other'
    )
    SELECT d.child_key, d.parent_key, d.kind,
           -- The number to name: the other case's own notice or order reference first.
           (array_agg(d.ident ORDER BY d.parent_ref DESC, d.ident))[1] AS via_ref,
           (array_agg(d.child_item ORDER BY d.parent_ref DESC, d.ident) FILTER (WHERE d.child_item IS NOT NULL))[1] AS item_id,
           bool_or(d.parent_ref) AS parent_ref,
           count(*)::int AS shared
      FROM dir d
     GROUP BY d.child_key, d.parent_key, d.kind
     ORDER BY (d.kind <> 'related') DESC, bool_or(d.parent_ref) DESC, count(*) DESC, d.child_key, d.parent_key
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notice_case_links l WHERE l.client_id = p_client_id AND l.child_key = r.child_key);
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notice_case_link_blocks b WHERE b.client_id = p_client_id
                            AND ((b.child_key = r.child_key AND b.parent_key = r.parent_key)
                              OR (b.child_key = r.parent_key AND b.parent_key = r.child_key)));
    CONTINUE WHEN public.notice_case_is_ancestor(p_client_id, r.parent_key, r.child_key);
    INSERT INTO public.notice_case_links (client_id, child_key, parent_key, kind, via_ref, item_id, source, reason, score)
    VALUES (p_client_id, r.child_key, r.parent_key, r.kind, r.via_ref, r.item_id, 'auto',
            r.via_ref || CASE WHEN r.parent_ref THEN ', the number of a notice or order of the other case,' ELSE '' END
              || ' is on the papers of both cases' || CASE WHEN r.shared > 1 THEN ' (' || r.shared || ' numbers in common)' ELSE '' END,
            100)
    ON CONFLICT (client_id, child_key) DO NOTHING;
    IF FOUND THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_links_refresh(uuid) TO anon, authenticated, service_role;

-- Link again on the tighter rule.
SELECT public.notice_case_links_refresh(NULL);
