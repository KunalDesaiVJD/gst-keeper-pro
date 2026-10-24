-- Notices · linked cases you can see linked or apart (the firm's request of 24
-- October 2026: "In Tamnna-GJ one appeal is filed against a case and both are
-- showing but not linked"; "in MJ Surgical one refund was partially rejected
-- and an appeal was filed, both showing but not linked"; "create an
-- intelligent eco-system wherein our portal can understand how and in what
-- manner it is linked", seen "as linked way and also unlinked way").
--
-- 20261012100000 linked a case into another only when an appeal or waiver
-- application (folder sections APLCN / ORDRS) named the reference of a notice
-- in the other case. An appeal whose order is only a document in the other
-- case's folder (an RFD-06 refund order, a DRC-07 filed as a folder item), or
-- whose number sits in another field, stayed apart.
--
-- 1. The papers of a case and what they name (notice_case_idents): every
--    portal number (15 characters, two letters, two digits: notice and order
--    references, ARNs, case IDs) on a notice's own fields, its description and
--    portal detail, every case folder item's reference and raw JSON, and what
--    the AI read in its documents. What a case is (notice_case_parts): an
--    appeal, a waiver or a rectification; a refund application; the order it
--    holds (form, number, date); its dates, year, amount and refund outcome.
-- 2. Certain, linked by itself (notice_case_links_refresh): two cases of the
--    same client carrying the same portal number (one that appears in at most
--    three cases) belong together. The appeal (waiver, rectification) is the
--    child; between two of a kind, or neither, the later one; a case-less
--    notice always joins the portal case. Refund applications sharing a number
--    are a reapplication. Never into a circle, never the registration bucket.
-- 3. A person decides (notice_case_link_set): a link they make survives every
--    refresh, and so does an unlink (notice_case_link_blocks): the system never
--    links that pair again until a person links it or hands it back
--    (notice_case_link_reset). Unlinking an appeal puts its order back in the
--    order stage when the appeal had moved it.
-- 4. Not certain, suggested (notice_case_link_candidates): the client's other
--    cases scored on kind (an appeal against a case holding an order), dates
--    (filed within 120 days of the order), financial year, amount (the demand,
--    or the refund rejected), a refund appeal against a refund case, and
--    whether that order has an appeal yet. 40 and above is offered.
-- 5. Seen linked or apart: notice_cases stays the linked view (one row per
--    chain); notice_cases_flat is the same row per portal case, with the chain
--    it belongs to (root_key, parent_key, link_kind, link_source), and
--    notice_cases_counts_flat its counts. notice_case_chain lists a chain's
--    cases with how each is linked; correspondence and notice_case_items carry
--    each item's own case (own_key), so a case page can show one case alone.
--
-- Objects: notice_case_links (kind reapplication, reason, score),
-- notice_case_link_blocks (+ RLS open to public), notice_ref_tokens(),
-- notice_case_idents(), notice_case_parts(), notice_case_is_ancestor(),
-- notice_case_links_refresh(), gst_case_folder_items_link() (+ trigger),
-- notice_case_link_set(), notice_case_link_reset(), notice_case_chain(),
-- notice_case_link_candidates(), notice_case_correspondence (own_key),
-- notice_case_items(), notice_cases_flat, notice_cases_counts_flat().

-- ── 1. Links: one more kind, and why ───────────────────────────────────────
ALTER TABLE public.notice_case_links DROP CONSTRAINT IF EXISTS notice_case_links_kind_check;
ALTER TABLE public.notice_case_links ADD CONSTRAINT notice_case_links_kind_check
  CHECK (kind IN ('appeal', 'waiver', 'rectification', 'reapplication', 'related'));
ALTER TABLE public.notice_case_links ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.notice_case_links ADD COLUMN IF NOT EXISTS score int;
COMMENT ON COLUMN public.notice_case_links.reason IS 'Why the cases are linked, in words (the number both carry, or who linked them).';

-- A pair a person unlinked: the refresh never links it again (either way round).
CREATE TABLE IF NOT EXISTS public.notice_case_link_blocks (
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  child_key       text NOT NULL,
  parent_key      text NOT NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, child_key, parent_key)
);
COMMENT ON TABLE public.notice_case_link_blocks IS
  'Two notice cases a person unlinked: notice_case_links_refresh does not link them again until a person links them or hands the case back (notice_case_link_reset).';
ALTER TABLE public.notice_case_link_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notice_case_link_blocks_all ON public.notice_case_link_blocks;
CREATE POLICY notice_case_link_blocks_all ON public.notice_case_link_blocks FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notice_case_link_blocks TO anon, authenticated, service_role;

-- ── 2. What a case's papers name, and what a case is ──────────────────────
-- Portal numbers in free text: 15 characters, two letters, two digits, eleven
-- letters or digits (ZD2401230012345, AA240123001234X). A GSTIN starts with
-- digits and a DIN is 20 characters, so neither is taken.
CREATE OR REPLACE FUNCTION public.notice_ref_tokens(p_text text)
RETURNS SETOF text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT DISTINCT m[1] FROM regexp_matches(coalesce(p_text, ''), '(?:^|[^0-9A-Za-z])([A-Z]{2}[0-9]{2}[0-9A-Z]{11})(?![0-9A-Za-z])', 'g') m
$$;

CREATE OR REPLACE FUNCTION public.notice_case_idents(p_client_id uuid)
RETURNS TABLE (own_key text, ident text, item_kind text, item_id uuid, is_notice_ref boolean)
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
    SELECT n.own_key, 'notice'::text AS kind, n.id, v.x, v.is_ref
      FROM n CROSS JOIN LATERAL (VALUES (n.reference_number, true), (n.order_number, true), (n.submission_arn, false),
                                        (n.reply_ref_number, false), (n.case_id, false)) v(x, is_ref)
    UNION ALL
    SELECT n.own_key, 'notice', n.id, t.tok, false
      FROM n CROSS JOIN LATERAL public.notice_ref_tokens(concat_ws(' ', n.description, n.remarks,
                                  (SELECT g.portal_detail::text FROM public.gst_notices g WHERE g.id = n.id))) t(tok)
    UNION ALL
    SELECT fi.case_id, 'document', fi.id, v.x, false
      FROM public.gst_case_folder_items fi CROSS JOIN LATERAL (VALUES (fi.reference_number), (fi.case_id)) v(x)
     WHERE fi.client_id = p_client_id AND fi.deleted_at IS NULL AND nullif(btrim(fi.case_id), '') IS NOT NULL
    UNION ALL
    SELECT fi.case_id, 'document', fi.id, t.tok, false
      FROM public.gst_case_folder_items fi CROSS JOIN LATERAL public.notice_ref_tokens(fi.raw_json::text) t(tok)
     WHERE fi.client_id = p_client_id AND fi.deleted_at IS NULL AND nullif(btrim(fi.case_id), '') IS NOT NULL
    UNION ALL
    -- What the AI read in a case's documents (an appeal's grounds quote the order).
    SELECT d.case_id, 'document', d.folder_item_id, t.tok, false
      FROM public.ai_documents d CROSS JOIN LATERAL public.notice_ref_tokens(concat_ws(' ', d.title, d.summary, d.overview::text)) t(tok)
     WHERE d.client_id = p_client_id AND d.status = 'done' AND nullif(btrim(d.case_id), '') IS NOT NULL
  )
  SELECT r.own_key, upper(btrim(r.x)), r.kind, r.id, bool_or(r.is_ref)
    FROM raw r
   WHERE length(btrim(coalesce(r.x, ''))) >= 6 AND r.own_key IS NOT NULL AND r.own_key <> 'REG'
   GROUP BY r.own_key, upper(btrim(r.x)), r.kind, r.id
$$;
REVOKE ALL ON FUNCTION public.notice_case_idents(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.notice_case_idents(uuid) IS
  'Every portal number a client''s notice cases carry (own key, number, the notice or folder item, whether it is a notice''s or order''s own reference). notice_case_links_refresh links cases that share one.';

-- The orders a case can hold (an appeal, waiver or rectification is against one).
CREATE OR REPLACE FUNCTION public.notice_order_forms()
RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT ARRAY['DRC-07', 'DRC-08', 'DRC-09', 'ASMT-13', 'ASMT-15', 'ASMT-16', 'ASMT-17', 'ADT-03', 'ADT-04',
               'RFD-04', 'RFD-06', 'RFD-07', 'REG-05', 'REG-19', 'REG-22', 'RECT-ORDER', 'APL-04', 'APL-05']
$$;

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
  ), keys AS (
    SELECT n.own_key FROM n UNION SELECT d.own_key FROM d
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
         END,
         EXISTS (SELECT 1 FROM d WHERE d.own_key = k.own_key AND d.form_no LIKE '%RFD-01%')
           OR EXISTS (SELECT 1 FROM n WHERE n.own_key = k.own_key AND n.form_code IN ('RFD-01', 'RFD-02')),
         EXISTS (SELECT 1 FROM n WHERE n.own_key = k.own_key
                   AND (n.trk = 'refund' OR coalesce(n.description, '') ILIKE '%refund%' OR coalesce(n.form_label, '') ILIKE '%refund%'))
           OR EXISTS (SELECT 1 FROM d WHERE d.own_key = k.own_key AND (d.form_no LIKE 'RFD%' OR d.raw_json::text ILIKE '%refund%')),
         o.form IS NOT NULL, o.form, o.ref, o.dt,
         (SELECT min(x) FROM (SELECT n.issue_date AS x FROM n WHERE n.own_key = k.own_key UNION ALL SELECT d.dt FROM d WHERE d.own_key = k.own_key) z),
         (SELECT max(x) FROM (SELECT n.issue_date AS x FROM n WHERE n.own_key = k.own_key UNION ALL SELECT d.dt FROM d WHERE d.own_key = k.own_key) z),
         (SELECT public.notice_fy_key(n.financial_year) FROM n WHERE n.own_key = k.own_key AND n.financial_year IS NOT NULL
           ORDER BY n.issue_date DESC NULLS LAST LIMIT 1),
         (SELECT max(n.amount_of_demand) FROM n WHERE n.own_key = k.own_key),
         coalesce((SELECT CASE WHEN bool_or(n.trk = 'litigation') THEN 'litigation' WHEN bool_or(n.trk = 'refund') THEN 'refund'
                               WHEN bool_or(n.trk = 'registration') THEN 'registration' ELSE 'other' END
                     FROM n WHERE n.own_key = k.own_key HAVING count(*) > 0),
                  CASE WHEN EXISTS (SELECT 1 FROM d WHERE d.own_key = k.own_key AND d.form_no LIKE 'RFD%') THEN 'refund' ELSE 'litigation' END),
         (SELECT count(*)::int FROM n WHERE n.own_key = k.own_key),
         (SELECT count(*)::int FROM d WHERE d.own_key = k.own_key),
         coalesce((SELECT bool_or(n.is_open) FROM n WHERE n.own_key = k.own_key), false),
         l.id, l.title, l.form_code,
         (SELECT array_agg(DISTINCT x) FROM (
            SELECT n.form_code AS x FROM n WHERE n.own_key = k.own_key AND n.form_code IS NOT NULL
            UNION SELECT substring(d.form_no FROM '([A-Z]{2,4}-[0-9]{1,2}[A-Z]?)') FROM d WHERE d.own_key = k.own_key) z WHERE x IS NOT NULL),
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

-- Whether p_anc is p_key or one of its ancestors (a link from p_anc''s side would close a circle).
CREATE OR REPLACE FUNCTION public.notice_case_is_ancestor(p_client_id uuid, p_key text, p_anc text)
RETURNS boolean
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := p_key;
  i     int := 0;
BEGIN
  LOOP
    IF v_key IS NULL THEN RETURN false; END IF;
    IF v_key = p_anc THEN RETURN true; END IF;
    i := i + 1;
    EXIT WHEN i > 12;
    SELECT l.parent_key INTO v_key FROM public.notice_case_links l WHERE l.client_id = p_client_id AND l.child_key = v_key;
  END LOOP;
  RETURN true;  -- deeper than any real chain: treat as a circle
END;
$$;

-- ── 3. Certain: linked by itself ───────────────────────────────────────────
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
      SELECT * FROM public.notice_case_idents(p_client_id)
    ), spread AS (
      -- A number on papers of more than three cases says nothing certain.
      SELECT i.ident FROM i GROUP BY i.ident HAVING count(DISTINCT i.own_key) BETWEEN 2 AND 3
    ), p AS (
      SELECT * FROM public.notice_case_parts(p_client_id)
    ), pairs AS (
      SELECT a.own_key AS a_key, b.own_key AS b_key, a.ident,
             bool_or(a.is_notice_ref) AS a_ref, bool_or(b.is_notice_ref) AS b_ref,
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

-- A case folder item that can link cases (an application, an order, or one
-- naming an appeal) links its client's cases at once; every other document is
-- taken up by the sweep.
CREATE OR REPLACE FUNCTION public.gst_case_folder_items_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF upper(coalesce(NEW.folder_section, '')) IN ('APLCN', 'ORDRS', 'ORDER', 'ORDERS')
     OR NEW.raw_json ->> 'apl' = 'APPEAL' OR NEW.raw_json ? 'aplnum' OR NEW.raw_json ? 'orginalOrderNo' THEN
    PERFORM public.notice_case_links_refresh(NEW.client_id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_gst_case_folder_items_link ON public.gst_case_folder_items;
CREATE TRIGGER trg_gst_case_folder_items_link
  AFTER INSERT OR UPDATE OF raw_json, reference_number, deleted_at, case_id ON public.gst_case_folder_items
  FOR EACH ROW EXECUTE FUNCTION public.gst_case_folder_items_link();

-- ── 4. A person decides ────────────────────────────────────────────────────
-- Link p_child_key into p_parent_key (kind appeal, waiver, rectification,
-- reapplication, related), or with p_parent_key NULL unlink it: the link goes,
-- whoever made it, and the pair is never linked by itself again.
CREATE OR REPLACE FUNCTION public.notice_case_link_set(p_client_id uuid, p_child_key text, p_parent_key text, p_kind text, p_by text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old   public.notice_case_links;
  v_actor text;
BEGIN
  IF p_client_id IS NULL OR nullif(btrim(p_child_key), '') IS NULL THEN
    RAISE EXCEPTION 'Name the case to link.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_old FROM public.notice_case_links WHERE client_id = p_client_id AND child_key = p_child_key;

  IF p_parent_key IS NULL THEN
    IF v_old.child_key IS NULL THEN RETURN false; END IF;
    DELETE FROM public.notice_case_links WHERE client_id = p_client_id AND child_key = p_child_key;
    INSERT INTO public.notice_case_link_blocks (client_id, child_key, parent_key, created_by_name)
    VALUES (p_client_id, p_child_key, v_old.parent_key, left(p_by, 120))
    ON CONFLICT (client_id, child_key, parent_key) DO UPDATE SET created_by_name = excluded.created_by_name, created_at = now();
    -- The order the appeal had moved to the appeal stage (notices_sweep_linked)
    -- is an order again, unless another appeal still names it.
    IF v_old.kind = 'appeal' AND v_old.via_ref IS NOT NULL THEN
      v_actor := current_setting('app.actor_name', true);
      PERFORM set_config('app.actor_name', 'auto: appeal unlinked', true);
      UPDATE public.gst_notices g SET stage = 'order'
       WHERE g.client_id = p_client_id AND g.case_id = v_old.parent_key AND g.reference_number = v_old.via_ref
         AND g.deleted_at IS NULL AND g.stage = 'appeal'
         AND NOT EXISTS (SELECT 1 FROM public.notice_case_links l WHERE l.client_id = p_client_id AND l.parent_key = v_old.parent_key
                           AND l.kind = 'appeal' AND l.via_ref = v_old.via_ref);
      PERFORM set_config('app.actor_name', coalesce(v_actor, ''), true);
    END IF;
    PERFORM public.notices_sweep_linked(p_client_id);
    RETURN true;
  END IF;

  IF coalesce(p_kind, 'related') NOT IN ('appeal', 'waiver', 'rectification', 'reapplication', 'related') THEN
    RAISE EXCEPTION 'Unknown kind of link: %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_child_key = p_parent_key OR public.notice_case_is_ancestor(p_client_id, p_parent_key, p_child_key) THEN
    RAISE EXCEPTION 'A case cannot be linked into itself.' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.notice_case_link_blocks b
   WHERE b.client_id = p_client_id
     AND ((b.child_key = p_child_key AND b.parent_key = p_parent_key) OR (b.child_key = p_parent_key AND b.parent_key = p_child_key));
  INSERT INTO public.notice_case_links (client_id, child_key, parent_key, kind, source, created_by_name, reason, score)
  VALUES (p_client_id, p_child_key, p_parent_key, coalesce(p_kind, 'related'), 'manual', left(p_by, 120), 'Linked by ' || coalesce(nullif(left(p_by, 120), ''), 'a person'), 100)
  ON CONFLICT (client_id, child_key) DO UPDATE
     SET parent_key = excluded.parent_key, kind = excluded.kind, source = 'manual', created_by_name = excluded.created_by_name,
         reason = excluded.reason, score = excluded.score, via_ref = NULL, item_id = NULL, created_at = now();
  PERFORM public.notices_sweep_linked(p_client_id);
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_link_set(uuid, text, text, text, text) TO anon, authenticated, service_role;

-- Hand a case back to the system: a person's link or unlink of it goes, and it is linked again only when certain.
CREATE OR REPLACE FUNCTION public.notice_case_link_reset(p_client_id uuid, p_child_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.notice_case_links WHERE client_id = p_client_id AND child_key = p_child_key AND source = 'manual';
  DELETE FROM public.notice_case_link_blocks WHERE client_id = p_client_id AND (child_key = p_child_key OR parent_key = p_child_key);
  PERFORM public.notices_sweep_linked(p_client_id);
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_link_reset(uuid, text) TO anon, authenticated, service_role;

-- ── 5. A chain, and what may belong to it ─────────────────────────────────
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

-- The client's other cases that may belong with this chain, scored, best first
-- (p_min: the lowest score shown; the manual picker passes a low one to list them all).
CREATE OR REPLACE FUNCTION public.notice_case_link_candidates(p_client_id uuid, p_case_key text, p_min int DEFAULT 40)
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH root AS (
    SELECT public.notice_case_root(p_client_id, p_case_key) AS k
  ), p AS (
    SELECT p.*, public.notice_case_root(p_client_id, p.own_key) AS root_key FROM public.notice_case_parts(p_client_id) p
  ), mem AS (
    SELECT * FROM p WHERE p.root_key = (SELECT k FROM root)
  ), oth AS (
    -- Another chain is offered by its root (linking it brings the whole chain).
    SELECT * FROM p WHERE p.root_key <> (SELECT k FROM root) AND p.own_key = p.root_key AND p.own_key <> 'REG'
  ), pairs AS (
    SELECT m.own_key AS member_key, o.own_key AS other_key, m.root_key AS member_root,
           CASE WHEN m.own_key LIKE 'N:%' AND o.own_key NOT LIKE 'N:%' THEN true
                WHEN o.own_key LIKE 'N:%' AND m.own_key NOT LIKE 'N:%' THEN false
                WHEN m.marker IS NOT NULL AND o.marker IS NULL THEN true
                WHEN o.marker IS NOT NULL AND m.marker IS NULL THEN false
                ELSE coalesce(m.first_date, DATE '1900-01-01') >= coalesce(o.first_date, DATE '1900-01-01') END AS member_child
      FROM mem m CROSS JOIN oth o
     WHERE m.own_key <> 'REG'
       AND NOT EXISTS (SELECT 1 FROM public.notice_case_link_blocks b WHERE b.client_id = p_client_id
                         AND ((b.child_key = m.own_key AND b.parent_key = o.own_key) OR (b.child_key = o.own_key AND b.parent_key = m.own_key)))
  ), sides AS (
    SELECT x.member_key, x.other_key,
           CASE WHEN x.member_child THEN x.member_key ELSE x.other_key END AS child_key,
           CASE WHEN x.member_child THEN x.other_key ELSE x.member_key END AS parent_key
      FROM pairs x
     -- A case already linked under another stays there: only a chain's root moves.
     WHERE NOT x.member_child OR x.member_key = x.member_root
  ), scored AS (
    SELECT s.member_key, s.other_key, s.child_key, s.parent_key, sc.gap,
           c.marker AS c_marker, c.refund_app AS c_refund_app, c.about_refund AS c_about_refund, c.financial_year AS c_fy, c.amount AS c_amount,
           par.has_order AS p_has_order, par.order_form AS p_order_form, par.refund_app AS p_refund_app, par.financial_year AS p_fy,
           par.amount AS p_amount, par.refund_rejected AS p_rejected, par.track AS p_track,
           NOT EXISTS (SELECT 1 FROM public.notice_case_links l
                        WHERE l.client_id = p_client_id AND l.parent_key = par.own_key AND l.kind = 'appeal') AS p_free,
           o.own_key AS o_key, o.title AS o_title, o.form_code AS o_form, o.forms AS o_forms, o.track AS o_track, o.marker AS o_marker,
           o.is_open AS o_open, o.lead_notice_id AS o_lead, o.first_date AS o_first, o.last_date AS o_last, o.financial_year AS o_fy,
           o.amount AS o_amount, o.has_order AS o_has_order, o.order_form AS o_order_form, o.order_ref AS o_order_ref, o.order_date AS o_order_date,
           o.refund_sanctioned AS o_sanctioned, o.refund_rejected AS o_rejected
      FROM sides s
      JOIN p c ON c.own_key = s.child_key
      JOIN p par ON par.own_key = s.parent_key
      JOIN p o ON o.own_key = s.other_key
      CROSS JOIN LATERAL (SELECT (c.first_date - coalesce(par.order_date, par.last_date)) AS gap) sc
  ), points AS (
    SELECT s.*,
           (CASE WHEN s.c_marker IS NOT NULL AND s.p_has_order THEN 40
                 WHEN s.c_marker IS NULL AND s.c_refund_app AND s.p_refund_app THEN 25 ELSE 0 END)
         + (CASE WHEN s.gap BETWEEN 0 AND 120 THEN 30 WHEN s.gap BETWEEN 121 AND 400 THEN 10 WHEN s.gap < 0 THEN -20 ELSE 0 END)
         + (CASE WHEN s.c_fy IS NOT NULL AND s.c_fy = s.p_fy THEN 15 ELSE 0 END)
         + (CASE WHEN coalesce(s.c_amount, 0) > 0 AND coalesce(s.p_amount, 0) > 0
                  AND abs(s.c_amount - s.p_amount) <= greatest(s.p_amount * 0.05, 1) THEN 15
                 WHEN coalesce(s.c_amount, 0) > 0 AND coalesce(s.p_rejected, 0) > 0
                  AND abs(s.c_amount - s.p_rejected) <= greatest(s.p_rejected * 0.05, 1) THEN 20 ELSE 0 END)
         + (CASE WHEN s.c_marker = 'appeal' AND s.c_about_refund AND s.p_track = 'refund' THEN 20
                 WHEN s.c_marker = 'appeal' AND NOT s.c_about_refund AND s.p_track = 'litigation' THEN 10 ELSE 0 END)
         + (CASE WHEN s.c_marker = 'appeal' AND s.p_free THEN 10 ELSE 0 END) AS score
      FROM scored s
  )
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.score DESC, x.o_last DESC NULLS LAST), '[]'::jsonb)
    FROM (
      SELECT DISTINCT ON (s.other_key) s.other_key, s.score, s.o_last,
             jsonb_build_object(
               'member_key', s.member_key, 'other_key', s.other_key,
               'child_key', s.child_key, 'parent_key', s.parent_key,
               'kind', coalesce(s.c_marker, CASE WHEN s.c_refund_app AND s.p_refund_app THEN 'reapplication' ELSE 'related' END),
               'score', s.score,
               'reasons', to_jsonb(array_remove(ARRAY[
                 CASE WHEN s.c_marker IS NOT NULL AND s.p_has_order
                      THEN CASE s.c_marker WHEN 'appeal' THEN 'an appeal' WHEN 'waiver' THEN 'an application for waiver' ELSE 'an application for rectification' END
                           || ', and the other case holds an order (' || coalesce(s.p_order_form, 'order') || ')' END,
                 CASE WHEN s.c_marker IS NULL AND s.c_refund_app AND s.p_refund_app THEN 'both are refund applications' END,
                 CASE WHEN s.gap BETWEEN 0 AND 120 THEN 'filed ' || s.gap || ' days after the order'
                      WHEN s.gap BETWEEN 121 AND 400 THEN 'filed within about a year of the order'
                      WHEN s.gap < 0 THEN 'dated before the order' END,
                 CASE WHEN s.c_fy IS NOT NULL AND s.c_fy = s.p_fy THEN 'same financial year' END,
                 CASE WHEN coalesce(s.c_amount, 0) > 0 AND coalesce(s.p_amount, 0) > 0
                       AND abs(s.c_amount - s.p_amount) <= greatest(s.p_amount * 0.05, 1) THEN 'same amount'
                      WHEN coalesce(s.c_amount, 0) > 0 AND coalesce(s.p_rejected, 0) > 0
                       AND abs(s.c_amount - s.p_rejected) <= greatest(s.p_rejected * 0.05, 1) THEN 'the amount equals the refund rejected' END,
                 CASE WHEN s.c_marker = 'appeal' AND s.c_about_refund AND s.p_track = 'refund' THEN 'an appeal about a refund, against a refund case' END,
                 CASE WHEN s.c_marker = 'appeal' AND s.p_free THEN 'no appeal is linked to it yet' END
               ], NULL)),
               'other', jsonb_build_object(
                 'case_key', s.o_key,
                 'case_id', CASE WHEN s.o_key LIKE 'N:%' THEN NULL ELSE s.o_key END,
                 'title', s.o_title, 'form_code', s.o_form, 'forms', s.o_forms, 'track', s.o_track,
                 'marker', s.o_marker, 'is_open', s.o_open, 'lead_notice_id', s.o_lead,
                 'first_date', s.o_first, 'last_date', s.o_last, 'financial_year', s.o_fy, 'amount', s.o_amount,
                 'order', CASE WHEN s.o_has_order THEN jsonb_build_object('form', s.o_order_form, 'ref', s.o_order_ref, 'date', s.o_order_date) END,
                 'refund', CASE WHEN s.o_sanctioned IS NOT NULL OR s.o_rejected IS NOT NULL
                                THEN jsonb_build_object('sanctioned', s.o_sanctioned, 'rejected', s.o_rejected) END)) AS j
        FROM points s
       WHERE s.score >= coalesce(p_min, 40)
       ORDER BY s.other_key, s.score DESC
    ) x
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_link_candidates(uuid, text, int) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.notice_case_link_candidates(uuid, text, int) IS
  'Cases of the client that may belong with this chain, each with a score and the reasons (kind, dates, year, amount, refund), best first. 40 and above is offered as a suggestion.';

-- ── 6. Each item's own case ────────────────────────────────────────────────
-- notice_case_correspondence as in 20261014120000, with own_key (the portal
-- case the item itself is in) at the end.
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

-- notice_case_items as in 20261013120000, with each item's own case.
CREATE OR REPLACE FUNCTION public.notice_case_items(p_client_id uuid, p_case_key text)
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(row ORDER BY (row ->> 'date') DESC NULLS LAST, (row ->> 'arrived_at') DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'kind', c.kind, 'id', c.item_id, 'from', c.from_party, 'date', c.item_date, 'arrived_at', c.first_seen_at,
        'label', c.label, 'reference', c.reference, 'section', c.folder_section, 'is_new', c.is_new,
        'own_key', c.own_key,
        'stage', f.stage, 'stage_label', f.stage_label, 'is_open', f.is_open, 'pdf_url', g.pdf_url,
        -- A notice carries the files of its copy in the case folder (same reference).
        'attachments', (SELECT coalesce(jsonb_agg(a), '[]'::jsonb)
                          FROM public.gst_case_folder_items fi
                          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(fi.attachments) = 'array' THEN fi.attachments ELSE '[]'::jsonb END) a
                         WHERE fi.deleted_at IS NULL
                           AND ((c.kind = 'document' AND fi.id = c.item_id)
                             OR (c.kind = 'notice' AND fi.client_id = c.client_id AND public.notice_case_root(fi.client_id, fi.case_id) = c.case_key AND fi.reference_number = c.reference))),
        'ai', (SELECT jsonb_build_object('title', d.title, 'summary', d.summary, 'doc_kind', d.doc_kind, 'outcome', d.outcome,
                                         'doc_date', d.doc_date, 'status', d.status, 'reason_class', d.reason_class,
                                         'usage', d.usage, 'model', d.model)
                 FROM public.ai_documents d
                WHERE (c.kind = 'document' AND d.folder_item_id = c.item_id)
                   OR (c.kind = 'notice' AND d.notice_id = c.item_id AND d.source = 'workspace')
                   OR (c.kind = 'notice' AND d.folder_item_id IN (
                         SELECT fi.id FROM public.gst_case_folder_items fi
                          WHERE fi.client_id = c.client_id AND public.notice_case_root(fi.client_id, fi.case_id) = c.case_key AND fi.reference_number = c.reference AND fi.deleted_at IS NULL))
                ORDER BY (d.status = 'done') DESC, (d.summary IS NOT NULL) DESC, d.sort_date DESC NULLS LAST
                LIMIT 1),
        'notice_read', CASE WHEN c.kind = 'notice' THEN
               (SELECT jsonb_build_object('status', x.status, 'outcome', x.outcome, 'summary', nullif(x.detail ->> 'summary', ''),
                                          'usage', x.usage, 'model', x.model)
                  FROM public.notice_extractions x WHERE x.notice_id = c.item_id AND x.source = 'ai'
                 ORDER BY x.created_at DESC LIMIT 1) END
      ) AS row
        FROM public.notice_case_correspondence c
        LEFT JOIN public.notice_facts f ON c.kind = 'notice' AND f.id = c.item_id
        LEFT JOIN public.gst_notices g ON c.kind = 'notice' AND g.id = c.item_id
       WHERE c.client_id = p_client_id AND c.case_key = public.notice_case_root(p_client_id, p_case_key)
    ) x
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_items(uuid, text) TO anon, authenticated, service_role;

-- ── 7. Every case apart ────────────────────────────────────────────────────
-- notice_cases (20261014120000) is the linked view: one row per chain. This is
-- the same row for each portal case on its own, keyed by its own case, with
-- the chain it belongs to at the end. Keep the two in step: a change to
-- notice_cases is made here too (test_114 compares their columns).
CREATE OR REPLACE VIEW public.notice_cases_flat AS
WITH n AS (
  SELECT f.*, public.notice_case_key(f.case_id, f.category, f.id) AS case_key,
         CASE WHEN f.system_generated THEN 'other' ELSE public.notice_track(f.category) END AS track
    FROM public.notice_facts f
), lead AS (
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
  SELECT c.client_id, c.own_key AS case_key,
         count(*) FILTER (WHERE c.kind = 'document')::int AS documents,
         count(*) FILTER (WHERE c.is_new)::int AS new_items,
         max(c.first_seen_at) FILTER (WHERE c.is_new) AS new_at,
         max(c.first_seen_at) AS last_arrived_at,
         max(c.seen_at) AS seen_at
    FROM public.notice_case_correspondence c
   GROUP BY c.client_id, c.own_key
), latest AS (
  SELECT DISTINCT ON (c.client_id, c.own_key) c.client_id, c.own_key AS case_key, c.kind, c.label, c.from_party, c.item_date, c.first_seen_at, c.is_new
    FROM public.notice_case_correspondence c
   ORDER BY c.client_id, c.own_key, c.item_date DESC NULLS LAST, c.first_seen_at DESC
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
  w.waiting_on,
  -- The chain this case belongs to (its root is itself when it is not linked).
  public.notice_case_root(l.client_id, l.case_key) AS root_key,
  lk.parent_key, lk.kind AS link_kind, lk.source AS link_source
FROM lead l
JOIN agg a ON a.client_id = l.client_id AND a.case_key = l.case_key
LEFT JOIN corr co ON co.client_id = l.client_id AND co.case_key = l.case_key
LEFT JOIN latest lt ON lt.client_id = l.client_id AND lt.case_key = l.case_key
LEFT JOIN public.notice_case_links lk ON lk.client_id = l.client_id AND lk.child_key = l.case_key
CROSS JOIN LATERAL (SELECT CASE
    WHEN NOT a.is_open THEN 'closed'
    WHEN l.stage IN ('filed', 'hearing', 'appeal') OR a.all_replied OR lt.from_party = 'taxpayer' THEN 'department'
    ELSE 'us' END AS waiting_on) w;
GRANT SELECT ON public.notice_cases_flat TO anon, authenticated, service_role;
COMMENT ON VIEW public.notice_cases_flat IS
  'notice_cases with every portal case apart (the unlinked view): one row per case, keyed by its own case, with the chain it belongs to (root_key, parent_key, link_kind, link_source).';

-- notice_cases_counts (20261013110000) over every case apart.
CREATE OR REPLACE FUNCTION public.notice_cases_counts_flat(p_filters jsonb DEFAULT NULL)
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
               'linked', count(*) FILTER (WHERE c.root_key <> c.case_key),
               'next_due', min(c.next_due) FILTER (WHERE c.is_open AND c.next_due >= c.today_ist),
               'next_hearing', min(c.next_hearing),
               'oldest_overdue_days', max(c.today_ist - c.next_due) FILTER (WHERE c.is_overdue),
               'overdue_age', jsonb_build_object(
                 'd30', count(*) FILTER (WHERE c.is_overdue AND c.today_ist - c.next_due <= 30),
                 'd90', count(*) FILTER (WHERE c.is_overdue AND c.today_ist - c.next_due BETWEEN 31 AND 90),
                 'd365', count(*) FILTER (WHERE c.is_overdue AND c.today_ist - c.next_due BETWEEN 91 AND 365),
                 'older', count(*) FILTER (WHERE c.is_overdue AND c.today_ist - c.next_due > 365))) AS counts
        FROM public.notice_cases_flat c
       WHERE public.notice_master_match(p_filters, c.client_id, c.financial_year, c.assign_to_user_id, c.form_code, c.effective_priority)
       GROUP BY c.track
    ) t
$$;
GRANT EXECUTE ON FUNCTION public.notice_cases_counts_flat(jsonb) TO anon, authenticated, service_role;

-- Link what is certain now.
SELECT public.notice_case_links_refresh(NULL);
