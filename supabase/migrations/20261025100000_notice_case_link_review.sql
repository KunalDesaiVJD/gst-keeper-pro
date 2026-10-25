-- Notices · linked cases checked by a person when the system is not sure
-- (the firm, 25 October 2026: "apply more logics to create a strong validation
-- controls in cases section so that nothing can be missed while tagging.
-- Whenever ... confidence less than 90% then the system may ask human").
--
-- 1. notice_case_link_confidence: how sure an automatic link is, 0 to 99, and
--    why: the number both cases carry is the other case's order (95), a case's
--    own ID (90), a notice reference (85) or only a paper's reference (75); two
--    numbers or more in common +4; an appeal, waiver or rectification naming
--    the order +3; a link of the kind related between two portal cases -10.
-- 2. The gate (trigger notice_case_links_gate): an automatic link below
--    notice_case_link_min_confidence() (90) is never made; it waits in
--    notice_case_link_reviews for a person. A link made by a person is never
--    gated. The refresh is unchanged: it proposes, the gate decides.
-- 3. notice_case_review_queue: everything waiting for a person, per client or
--    for all: links the system was not sure of (still carrying the number),
--    appeals, waivers and rectifications linked to no order (with the best
--    suggestion), and cases that look like the same case twice (same order
--    form, year and amount, or the same notice reference).
-- 4. notice_case_review_decide: link (as a person), not linked (the pair is
--    never proposed again), or nothing to link / not a duplicate (the item
--    leaves the queue). Every decision is kept with who made it.

-- ── 1. Decisions and waiting links ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notice_case_link_reviews (
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  issue           text NOT NULL CHECK (issue IN ('low_confidence', 'unlinked', 'duplicate')),
  child_key       text NOT NULL,
  parent_key      text NOT NULL DEFAULT '',
  kind            text,
  confidence      int,
  reasons         text[],
  via_ref         text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'linked', 'not_linked', 'dismissed')),
  proposed_at     timestamptz NOT NULL DEFAULT now(),
  decided_by_name text,
  decided_at      timestamptz,
  PRIMARY KEY (client_id, issue, child_key, parent_key)
);
COMMENT ON TABLE public.notice_case_link_reviews IS
  'Links the system was not sure of (below notice_case_link_min_confidence) and a person''s decisions on the review queue (notice_case_review_queue / notice_case_review_decide).';
ALTER TABLE public.notice_case_link_reviews ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notice_case_link_reviews'
                   AND policyname = 'notice_case_link_reviews_all') THEN
    CREATE POLICY notice_case_link_reviews_all ON public.notice_case_link_reviews FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON public.notice_case_link_reviews TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notice_case_link_min_confidence()
RETURNS int
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT 90 $$;
GRANT EXECUTE ON FUNCTION public.notice_case_link_min_confidence() TO anon, authenticated, service_role;

-- ── 2. How sure ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_case_link_confidence(p_client_id uuid, p_child_key text, p_parent_key text, p_kind text)
RETURNS TABLE (confidence int, reasons text[], shared int, best_ref text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH i AS (
    SELECT * FROM public.notice_case_numbers(p_client_id) x WHERE x.own_key IN (p_child_key, p_parent_key)
  ), sh AS (
    SELECT i.ident,
           bool_or(i.is_notice_ref) AS notice_ref,
           bool_or(i.ident IN (upper(p_child_key), upper(p_parent_key))) AS case_id,
           bool_or(i.owns) AS owned
      FROM i
     GROUP BY i.ident
    HAVING count(DISTINCT i.own_key) = 2
  ), typed AS (
    SELECT sh.*,
           -- The order of one of the two cases: a notice of an order form, or a paper filed under its orders.
           EXISTS (SELECT 1 FROM public.notice_facts f
                    WHERE f.client_id = p_client_id AND f.form_code = ANY (public.notice_order_forms())
                      AND public.notice_case_key(f.case_id, f.category, f.id) IN (p_child_key, p_parent_key)
                      AND sh.ident IN (upper(btrim(coalesce(f.reference_number, ''))), upper(btrim(coalesce(f.order_number, '')))))
           OR EXISTS (SELECT 1 FROM public.gst_case_folder_items fi
                       WHERE fi.client_id = p_client_id AND fi.deleted_at IS NULL AND fi.case_id IN (p_child_key, p_parent_key)
                         AND upper(coalesce(fi.folder_section, '')) IN ('ORDRS', 'ORDER', 'ORDERS')
                         AND upper(btrim(coalesce(fi.reference_number, ''))) = sh.ident) AS is_order
      FROM sh
  ), best AS (
    SELECT t.*, CASE WHEN t.is_order THEN 95 WHEN t.case_id THEN 90 WHEN t.notice_ref THEN 85 WHEN t.owned THEN 75 ELSE 60 END AS pts
      FROM typed t
  ), top AS (
    SELECT * FROM best ORDER BY pts DESC, ident LIMIT 1
  ), m AS (
    SELECT (SELECT p.marker FROM public.notice_case_parts(p_client_id) p WHERE p.own_key = p_child_key) AS child_marker
  )
  SELECT greatest(0, least(99,
           coalesce((SELECT pts FROM top), 0)
           + CASE WHEN (SELECT count(*) FROM best) >= 2 THEN 4 ELSE 0 END
           + CASE WHEN (SELECT child_marker FROM m) IS NOT NULL AND coalesce((SELECT is_order FROM top), false) THEN 3 ELSE 0 END
           - CASE WHEN coalesce(p_kind, 'related') = 'related' AND p_child_key NOT LIKE 'N:%' AND p_parent_key NOT LIKE 'N:%' THEN 10 ELSE 0 END))::int,
         array_remove(ARRAY[
           CASE WHEN (SELECT is_order FROM top) THEN (SELECT ident FROM top) || ' is the order of one case, named on the papers of the other'
                WHEN (SELECT case_id FROM top) THEN (SELECT ident FROM top) || ', the case ID of one, is on the papers of the other'
                WHEN (SELECT notice_ref FROM top) THEN (SELECT ident FROM top) || ', a notice of one case, is on the papers of the other'
                WHEN (SELECT ident FROM top) IS NOT NULL THEN (SELECT ident FROM top) || ' is on the papers of both cases, but is neither''s order, notice or case ID'
                ELSE 'the two cases carry no number in common' END,
           CASE WHEN (SELECT count(*) FROM best) >= 2 THEN (SELECT count(*) FROM best) || ' numbers in common' END,
           CASE WHEN (SELECT child_marker FROM m) IS NOT NULL AND coalesce((SELECT is_order FROM top), false)
                THEN CASE (SELECT child_marker FROM m) WHEN 'appeal' THEN 'an appeal' WHEN 'waiver' THEN 'a waiver application' ELSE 'a rectification' END
                     || ' naming that order' END,
           CASE WHEN coalesce(p_kind, 'related') = 'related' AND p_child_key NOT LIKE 'N:%' AND p_parent_key NOT LIKE 'N:%'
                THEN 'only related: neither is an appeal, waiver, rectification or a refund filed again' END
         ], NULL),
         (SELECT count(*)::int FROM best),
         (SELECT ident FROM top)
$$;
REVOKE ALL ON FUNCTION public.notice_case_link_confidence(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notice_case_link_confidence(uuid, text, text, text) TO service_role;
COMMENT ON FUNCTION public.notice_case_link_confidence(uuid, text, text, text) IS
  'How sure a link of p_child_key into p_parent_key is (0 to 99) and why, from the portal numbers both cases carry. Below notice_case_link_min_confidence() the system does not link by itself.';

-- ── 3. The gate ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_case_links_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
BEGIN
  IF NEW.source IS DISTINCT FROM 'auto' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO c FROM public.notice_case_link_confidence(NEW.client_id, NEW.child_key, NEW.parent_key, NEW.kind);
  IF coalesce(c.confidence, 0) >= public.notice_case_link_min_confidence() THEN
    NEW.score := c.confidence;
    NEW.reason := coalesce(NEW.reason, array_to_string(c.reasons, '; ')) || ' (' || c.confidence || '% sure)';
    RETURN NEW;
  END IF;
  -- Not sure enough: a person decides. A pair a person already decided keeps the decision.
  INSERT INTO public.notice_case_link_reviews AS r
         (client_id, issue, child_key, parent_key, kind, confidence, reasons, via_ref, status, proposed_at)
  VALUES (NEW.client_id, 'low_confidence', NEW.child_key, NEW.parent_key, NEW.kind, coalesce(c.confidence, 0), c.reasons,
          coalesce(NEW.via_ref, c.best_ref), 'open', now())
  ON CONFLICT (client_id, issue, child_key, parent_key) DO UPDATE
     SET kind = excluded.kind, confidence = excluded.confidence, reasons = excluded.reasons, via_ref = excluded.via_ref,
         proposed_at = now();
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER trg_notice_case_links_gate
  BEFORE INSERT ON public.notice_case_links
  FOR EACH ROW EXECUTE FUNCTION public.notice_case_links_gate();

-- ── 4. What waits for a person ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_case_review_queue(p_client_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c   uuid;
  v_out jsonb := '[]'::jsonb;
  v_one jsonb;
BEGIN
  FOR v_c IN
    SELECT DISTINCT f.client_id FROM public.notice_facts f
     WHERE (p_client_id IS NULL OR f.client_id = p_client_id)
       AND (p_client_id IS NOT NULL
            -- Across all clients, only those with something that can wait: an appeal,
            -- waiver or rectification, an order, or a link waiting for a person.
            OR f.form_code LIKE 'APL-%' OR f.form_code LIKE 'SPL-%' OR f.form_code LIKE 'RECT-%'
            OR f.form_code = ANY (public.notice_order_forms())
            OR EXISTS (SELECT 1 FROM public.notice_case_link_reviews r WHERE r.client_id = f.client_id AND r.status = 'open')
            OR EXISTS (SELECT 1 FROM public.gst_portal_applications a WHERE a.client_id = f.client_id AND a.deleted_at IS NULL))
  LOOP
    WITH p AS (
      SELECT * FROM public.notice_case_parts(v_c)
    ), nums AS (
      SELECT * FROM public.notice_case_numbers(v_c)
    ), linked AS (
      SELECT l.child_key FROM public.notice_case_links l WHERE l.client_id = v_c
    ), dec AS (
      SELECT * FROM public.notice_case_link_reviews r WHERE r.client_id = v_c
    ), card AS (
      SELECT p.own_key, jsonb_build_object(
               'case_key', p.own_key, 'case_id', CASE WHEN p.own_key LIKE 'N:%' OR p.own_key = 'REG' THEN NULL ELSE p.own_key END,
               'marker', p.marker, 'track', p.track, 'title', p.title, 'form_code', p.form_code, 'forms', p.forms,
               'lead_notice_id', p.lead_notice_id, 'is_open', p.is_open, 'first_date', p.first_date, 'last_date', p.last_date,
               'financial_year', p.financial_year, 'amount', p.amount,
               'order', CASE WHEN p.has_order THEN jsonb_build_object('form', p.order_form, 'ref', p.order_ref, 'date', p.order_date) END) AS j
        FROM p
    ), low AS (
      -- Links the system was not sure of, while both cases still carry the number and nothing was decided.
      SELECT jsonb_build_object('issue', 'low_confidence', 'child_key', r.child_key, 'parent_key', r.parent_key, 'kind', r.kind,
                                'confidence', r.confidence, 'reasons', to_jsonb(r.reasons), 'via_ref', r.via_ref, 'proposed_at', r.proposed_at) AS j
        FROM dec r
       WHERE r.issue = 'low_confidence' AND r.status = 'open'
         AND NOT EXISTS (SELECT 1 FROM linked x WHERE x.child_key = r.child_key)
         AND NOT EXISTS (SELECT 1 FROM public.notice_case_link_blocks b WHERE b.client_id = v_c
                           AND ((b.child_key = r.child_key AND b.parent_key = r.parent_key) OR (b.child_key = r.parent_key AND b.parent_key = r.child_key)))
         AND EXISTS (SELECT 1 FROM nums a JOIN nums b ON b.ident = a.ident WHERE a.own_key = r.child_key AND b.own_key = r.parent_key)
    ), unl AS (
      -- An appeal, waiver or rectification linked to no order.
      SELECT p.own_key, p.marker FROM p
       WHERE p.marker IS NOT NULL AND p.own_key NOT LIKE 'N:%'
         AND NOT EXISTS (SELECT 1 FROM linked x WHERE x.child_key = p.own_key)
         AND NOT EXISTS (SELECT 1 FROM dec d WHERE d.issue = 'unlinked' AND d.child_key = p.own_key AND d.status <> 'open')
    ), unl_j AS (
      SELECT jsonb_build_object('issue', 'unlinked', 'child_key', u.own_key, 'parent_key', s.c ->> 'parent_key',
                                'kind', u.marker,
                                -- A suggestion is never sure enough to link by itself.
                                'confidence', CASE WHEN s.c IS NULL THEN NULL
                                                   ELSE least(89, round((s.c ->> 'score')::numeric * 100 / 135))::int END,
                                'reasons', coalesce(s.c -> 'reasons', '[]'::jsonb),
                                'suggestion', s.c) AS j
        FROM unl u
        LEFT JOIN LATERAL (
          SELECT x AS c FROM jsonb_array_elements(public.notice_case_link_candidates(v_c, u.own_key, 1)) x
           WHERE x ->> 'child_key' = u.own_key
           LIMIT 1
        ) s ON true
    ), dup AS (
      -- Two cases that look like one: the same order form, year and amount, or the same notice reference.
      SELECT DISTINCT least(a.own_key, b.own_key) AS k1, greatest(a.own_key, b.own_key) AS k2,
             CASE WHEN a.order_ref IS NOT NULL AND a.order_ref = b.order_ref THEN 'the same order ' || a.order_ref
                  ELSE 'the same ' || a.order_form || ', year ' || a.financial_year || ' and amount' END AS why
        FROM p a JOIN p b ON b.own_key > a.own_key
       WHERE a.own_key NOT IN ('REG') AND b.own_key NOT IN ('REG')
         AND public.notice_case_root(v_c, a.own_key) <> public.notice_case_root(v_c, b.own_key)
         AND ((a.order_ref IS NOT NULL AND a.order_ref = b.order_ref)
           OR (a.has_order AND b.has_order AND a.order_form = b.order_form AND a.financial_year IS NOT NULL
               AND a.financial_year = b.financial_year AND coalesce(a.amount, 0) > 0 AND abs(a.amount - b.amount) < 1))
    ), dup_j AS (
      SELECT jsonb_build_object('issue', 'duplicate', 'child_key', d.k2, 'parent_key', d.k1, 'kind', 'related',
                                'confidence', NULL, 'reasons', jsonb_build_array(d.why)) AS j
        FROM dup d
       WHERE NOT EXISTS (SELECT 1 FROM dec r WHERE r.issue = 'duplicate' AND r.child_key = d.k2 AND r.parent_key = d.k1 AND r.status <> 'open')
    ), allj AS (
      SELECT j FROM low UNION ALL SELECT j FROM unl_j UNION ALL SELECT j FROM dup_j
    )
    SELECT coalesce(jsonb_agg(a.j || jsonb_build_object(
             'client_id', v_c,
             'client_name', (SELECT c.name FROM public.clients c WHERE c.id = v_c),
             'child', (SELECT k.j FROM card k WHERE k.own_key = a.j ->> 'child_key'),
             'parent', (SELECT k.j FROM card k WHERE k.own_key = a.j ->> 'parent_key'))), '[]'::jsonb)
      INTO v_one
      FROM allj a;
    v_out := v_out || v_one;
  END LOOP;
  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_review_queue(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.notice_case_review_queue(uuid) IS
  'Everything about linking that waits for a person: links below the confidence the system acts on, appeals / waivers / rectifications linked to no order (with the best suggestion), and cases that look like the same case twice.';

-- ── 5. A person decides ───────────────────────────────────────────────────
-- p_decision: link (p_parent_key, p_kind), not_linked (the pair is never
-- proposed again), dismissed (nothing to link / not the same case).
CREATE OR REPLACE FUNCTION public.notice_case_review_decide(
  p_client_id uuid, p_issue text, p_child_key text, p_parent_key text, p_decision text, p_kind text DEFAULT NULL, p_by text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent text := coalesce(p_parent_key, '');
BEGIN
  IF p_issue NOT IN ('low_confidence', 'unlinked', 'duplicate') THEN
    RAISE EXCEPTION 'Unknown review item: %', p_issue USING ERRCODE = '22023';
  END IF;
  IF p_decision NOT IN ('link', 'not_linked', 'dismissed') THEN
    RAISE EXCEPTION 'Unknown decision: %', p_decision USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'link' THEN
    IF v_parent = '' THEN RAISE EXCEPTION 'Name the case to link it to.' USING ERRCODE = '22023'; END IF;
    PERFORM public.notice_case_link_set(p_client_id, p_child_key, v_parent, coalesce(p_kind, 'related'), p_by);
  ELSIF p_decision = 'not_linked' AND v_parent <> '' THEN
    INSERT INTO public.notice_case_link_blocks (client_id, child_key, parent_key, created_by_name)
    VALUES (p_client_id, p_child_key, v_parent, left(p_by, 120))
    ON CONFLICT (client_id, child_key, parent_key) DO UPDATE SET created_by_name = excluded.created_by_name, created_at = now();
  END IF;
  INSERT INTO public.notice_case_link_reviews AS r
         (client_id, issue, child_key, parent_key, kind, status, decided_by_name, decided_at)
  VALUES (p_client_id, p_issue, p_child_key,
          -- An unlinked appeal's decision is about the appeal, whichever case was suggested.
          CASE WHEN p_issue = 'unlinked' THEN '' ELSE v_parent END,
          p_kind, CASE p_decision WHEN 'link' THEN 'linked' ELSE p_decision END, left(p_by, 120), now())
  ON CONFLICT (client_id, issue, child_key, parent_key) DO UPDATE
     SET status = excluded.status, decided_by_name = excluded.decided_by_name, decided_at = now(),
         kind = coalesce(excluded.kind, r.kind);
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_review_decide(uuid, text, text, text, text, text, text) TO anon, authenticated, service_role;

-- Every automatic link through the gate now.
SELECT public.notice_case_links_refresh(NULL);
