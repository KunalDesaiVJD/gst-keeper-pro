-- Notices · a case linked to the case it belongs to (the firm's report of 9 October
-- 2026: an appeal hearing notice "has not been tagged to relevant notices";
-- "check all kind of other similar notices and fix everything").
--
-- The portal opens a new case for an appeal (APL-01), a waiver application under
-- section 128A or a rectification, separate from the case of the order it is
-- against. Its case folder names that order: the application's own reference, or
-- orddtl.ordnum / orddtl.dmdid, or an order's orginalOrderNo. Live on 9 October:
-- 12 such links (6 appeals and 4 waivers against DRC-07 orders, an accepted
-- ASMT-10, a dropped DRC-01) and 1 DRC-07 with no case ID whose order sits in
-- another case's folder.
--
-- 1. notice_case_links (rebuilt by notice_case_links_refresh, from the sweep and
--    whenever a case folder item arrives): child case → parent case, with how
--    (appeal, waiver, rectification, related). A case-less notice named by a
--    folder item is linked into that item's case.
-- 2. notice_case_root(client, key) follows the links (at most 6 steps, never in a
--    circle); notice_case_key(client, case_id, category, id) is the rooted key.
--    The case views and functions of 20261011100000 are rebuilt on it, so an
--    appeal, its hearings, the SCN and the order are one case, and a link to a
--    child case opens its root.
-- 3. The order's own clock: an order (DRC-07 and the like) with an appeal filed
--    against it moves to the stage "appeal" (still open, its demand still counted
--    as exposure, no longer overdue: notice_facts leaves a notice in that stage
--    out of overdue and due in 7); an order whose waiver under section 128A was
--    approved (SPL-APPROVED) closes (auto:waiver_settled). Sweep part 5.
--
-- Objects: notice_case_links (+ RLS open to public), notice_case_links_refresh(),
-- notice_case_root(), notice_case_key(uuid, text, text, uuid), trigger on
-- gst_case_folder_items, notices_sweep_linked(), notices_sweep_superseded()
-- (calls it), notice_facts (appeal stage not overdue), notice_case_correspondence,
-- notice_cases, notice_case_items(), notice_case_overview(),
-- notice_case_mark_seen().

-- ── 1. Links ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notice_case_links (
  client_id  uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  child_key  text NOT NULL,
  parent_key text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('appeal', 'waiver', 'rectification', 'related')),
  via_ref    text,
  item_id    uuid,
  -- auto: certain (the portal names the other case's notice); manual: a person accepted a suggestion.
  source     text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, child_key),
  CHECK (child_key <> parent_key)
);
COMMENT ON TABLE public.notice_case_links IS
  'A notice case that belongs to another (an appeal, a waiver application or a rectification against an order in another case; a case-less notice filed in a case''s folder). Rebuilt from the case folders by notice_case_links_refresh.';
ALTER TABLE public.notice_case_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notice_case_links_all ON public.notice_case_links;
CREATE POLICY notice_case_links_all ON public.notice_case_links FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notice_case_links TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notice_case_root(p_client_id uuid, p_key text)
RETURNS text
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key  text := p_key;
  v_next text;
  i      int := 0;
BEGIN
  IF p_key IS NULL THEN RETURN NULL; END IF;
  LOOP
    i := i + 1;
    EXIT WHEN i > 6;
    SELECT l.parent_key INTO v_next FROM public.notice_case_links l WHERE l.client_id = p_client_id AND l.child_key = v_key;
    EXIT WHEN v_next IS NULL OR v_next = p_key;
    v_key := v_next;
  END LOOP;
  RETURN v_key;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_root(uuid, text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.notice_case_root(uuid, text) IS
  'The case a notice case belongs to, following notice_case_links (itself when not linked).';

CREATE OR REPLACE FUNCTION public.notice_case_key(p_client_id uuid, p_case_id text, p_category text, p_id uuid)
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT public.notice_case_root(p_client_id, public.notice_case_key(p_case_id, p_category, p_id))
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_key(uuid, text, text, uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notice_case_links_refresh(p_client_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  DELETE FROM public.notice_case_links WHERE source = 'auto' AND (p_client_id IS NULL OR client_id = p_client_id);
  WITH refs AS (
    SELECT fi.id AS item_id, fi.client_id, fi.case_id, fi.folder_section, r.ref
      FROM public.gst_case_folder_items fi
      CROSS JOIN LATERAL (VALUES (fi.reference_number), (fi.raw_json -> 'orddtl' ->> 'ordnum'),
                                 (fi.raw_json -> 'orddtl' ->> 'dmdid'), (fi.raw_json ->> 'orginalOrderNo')) r(ref)
     WHERE fi.deleted_at IS NULL AND nullif(btrim(r.ref), '') IS NOT NULL
       AND upper(coalesce(fi.folder_section, '')) IN ('APLCN', 'ORDRS', 'ORDER', 'ORDERS')
       AND (p_client_id IS NULL OR fi.client_id = p_client_id)
  ), hits AS (
    SELECT DISTINCT ON (child_key) x.*
      FROM (
        SELECT r.client_id, r.item_id, r.ref,
               -- A case-less notice named by a folder item belongs to the item's case;
               -- otherwise the item's case belongs to the notice's.
               CASE WHEN nullif(btrim(g.case_id), '') IS NULL THEN 'N:' || g.id::text ELSE r.case_id END AS child_key,
               CASE WHEN nullif(btrim(g.case_id), '') IS NULL THEN r.case_id ELSE g.case_id END AS parent_key,
               g.issue_date
          FROM refs r
          JOIN public.gst_notices g ON g.client_id = r.client_id AND g.reference_number = r.ref AND g.deleted_at IS NULL
         WHERE coalesce(g.case_id, '') <> r.case_id
      ) x
     ORDER BY child_key, x.issue_date DESC NULLS LAST
  )
  INSERT INTO public.notice_case_links (client_id, child_key, parent_key, kind, via_ref, item_id)
  SELECT h.client_id, h.child_key, h.parent_key,
         CASE
           WHEN EXISTS (SELECT 1 FROM public.gst_notices n WHERE n.client_id = h.client_id AND n.case_id = h.child_key AND n.deleted_at IS NULL
                          AND (n.form_code LIKE 'APL-%' OR n.notice_type ILIKE 'appeal%'))
             OR EXISTS (SELECT 1 FROM public.gst_case_folder_items i WHERE i.client_id = h.client_id AND i.case_id = h.child_key
                          AND i.deleted_at IS NULL AND (i.raw_json ->> 'apl' = 'APPEAL' OR i.raw_json ? 'aplnum'))
             THEN 'appeal'
           WHEN EXISTS (SELECT 1 FROM public.gst_notices n WHERE n.client_id = h.client_id AND n.case_id = h.child_key AND n.deleted_at IS NULL
                          AND n.form_code LIKE 'SPL-%')
             THEN 'waiver'
           WHEN EXISTS (SELECT 1 FROM public.gst_notices n WHERE n.client_id = h.client_id AND n.case_id = h.child_key AND n.deleted_at IS NULL
                          AND n.form_code LIKE 'RECT-%')
             THEN 'rectification'
           ELSE 'related' END,
         h.ref, h.item_id
    FROM hits h
   WHERE h.child_key <> h.parent_key
  ON CONFLICT (client_id, child_key) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_links_refresh(uuid) TO anon, authenticated, service_role;

-- A new case folder item (an appeal application arriving with the sync) links its case at once.
CREATE OR REPLACE FUNCTION public.gst_case_folder_items_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF upper(coalesce(NEW.folder_section, '')) IN ('APLCN', 'ORDRS', 'ORDER', 'ORDERS') THEN
    PERFORM public.notice_case_links_refresh(NEW.client_id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_gst_case_folder_items_link ON public.gst_case_folder_items;
CREATE TRIGGER trg_gst_case_folder_items_link
  AFTER INSERT OR UPDATE OF raw_json, reference_number, deleted_at ON public.gst_case_folder_items
  FOR EACH ROW EXECUTE FUNCTION public.gst_case_folder_items_link();

-- ── 3. The order's own clock ───────────────────────────────────────────────
-- Sweep part 5: an order with an appeal filed against it is in the appeal stage;
-- one whose waiver was approved is settled.
CREATE OR REPLACE FUNCTION public.notices_sweep_linked(p_client_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int := 0;
  v_k int;
BEGIN
  PERFORM public.notice_case_links_refresh(p_client_id);
  PERFORM public.notice_payments_auto(p_client_id);

  -- Waiver approved: the order is settled.
  UPDATE public.gst_notices g SET staff_status = 'Closed', close_reason = 'auto:waiver_settled'
    FROM public.notice_case_links l
   WHERE l.client_id = g.client_id AND l.parent_key = g.case_id AND l.kind = 'waiver'
     AND l.via_ref = g.reference_number
     AND EXISTS (SELECT 1 FROM public.gst_notices s WHERE s.client_id = l.client_id AND s.case_id = l.child_key
                   AND s.deleted_at IS NULL AND s.form_code = 'SPL-APPROVED')
     AND g.deleted_at IS NULL AND g.staff_status IS NULL
     AND (p_client_id IS NULL OR g.client_id = p_client_id);
  GET DIAGNOSTICS v_k = ROW_COUNT;
  v_n := v_n + v_k;

  -- Appeal filed: the order moves to the appeal stage (open, its demand still exposure).
  UPDATE public.gst_notices g SET stage = 'appeal', stage_changed_at = now(), stage_changed_by = 'auto: appeal filed'
    FROM public.notice_case_links l
   WHERE l.client_id = g.client_id AND l.parent_key = g.case_id AND l.kind = 'appeal'
     AND l.via_ref = g.reference_number
     AND g.deleted_at IS NULL AND NOT public.notice_is_closed(g.staff_status)
     AND coalesce(g.stage, 'new') NOT IN ('appeal', 'closed')
     AND (p_client_id IS NULL OR g.client_id = p_client_id);
  GET DIAGNOSTICS v_k = ROW_COUNT;
  RETURN v_n + v_k;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notices_sweep_linked(uuid) TO anon, authenticated, service_role;


-- ── 4. Payments linked when certain ────────────────────────────────────────
ALTER TABLE public.notice_payments ADD COLUMN IF NOT EXISTS auto_ref text;
COMMENT ON COLUMN public.notice_payments.auto_ref IS
  'Set when the link was made automatically because it is certain: drc03:<ARN> (the DRC-03 names the notice''s reference) or predeposit:<appeal item> (the appeal application states its pre-deposit).';
CREATE UNIQUE INDEX IF NOT EXISTS uq_notice_payments_auto ON public.notice_payments (notice_id, auto_ref) WHERE auto_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.notice_payments_auto(p_client_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int := 0;
  v_k int;
BEGIN
  -- A DRC-03 whose cause of payment names a notice of the same client (its reference).
  INSERT INTO public.notice_payments (notice_id, kind, drc03_arn, paid_on, amount, note, created_by_name, auto_ref)
  SELECT DISTINCT ON (g.id, d.arn) g.id, 'drc03', d.arn, d.filed_date,
         coalesce(d.cash_amount, 0) + coalesce(d.credit_amount, 0), left(d.cause_of_payment, 500),
         'auto: the DRC-03 names this notice', 'drc03:' || d.arn
    FROM public.gst_drc03_filings d
    CROSS JOIN LATERAL regexp_matches(upper(coalesce(d.cause_of_payment, '')), '\m(Z[A-Z][0-9A-Z]{13})\M', 'g') m
    JOIN public.gst_notices g ON g.client_id = d.client_id AND upper(g.reference_number) = m[1] AND g.deleted_at IS NULL
   WHERE d.deleted_at IS NULL AND d.arn IS NOT NULL
     AND (p_client_id IS NULL OR d.client_id = p_client_id)
     AND NOT EXISTS (SELECT 1 FROM public.notice_payments p WHERE p.notice_id = g.id AND p.drc03_arn = d.arn)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_k = ROW_COUNT;
  v_n := v_n + v_k;

  -- The pre-deposit an appeal application states, on the order it appeals.
  INSERT INTO public.notice_payments (notice_id, kind, paid_on, amount, note, created_by_name, auto_ref)
  SELECT g.id, 'pre_deposit',
         public.notices_parse_portal_date(coalesce(fi.raw_json ->> 'insertTimeStamp', fi.raw_json ->> 'rfdSubDt')),
         (fi.raw_json -> 'orddtl' -> 'predepositamt' -> 'total' ->> 'tot')::numeric,
         'Pre-deposit stated in the appeal application' || coalesce(' ' || nullif(fi.raw_json ->> 'aplnum', ''), ''),
         'auto: the appeal application states it', 'predeposit:' || fi.id::text
    FROM public.gst_case_folder_items fi
    JOIN public.gst_notices g ON g.client_id = fi.client_id AND g.deleted_at IS NULL
     AND g.reference_number = coalesce(fi.raw_json -> 'orddtl' ->> 'ordnum', fi.reference_number)
   WHERE fi.deleted_at IS NULL AND upper(coalesce(fi.folder_section, '')) = 'APLCN'
     AND coalesce(fi.raw_json -> 'orddtl' -> 'predepositamt' -> 'total' ->> 'tot', '') ~ '^\d+(\.\d+)?$'
     AND (fi.raw_json -> 'orddtl' -> 'predepositamt' -> 'total' ->> 'tot')::numeric > 0
     AND (p_client_id IS NULL OR fi.client_id = p_client_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_k = ROW_COUNT;
  RETURN v_n + v_k;
END;
$$;
REVOKE ALL ON FUNCTION public.notice_payments_auto(uuid) FROM PUBLIC, anon, authenticated;

-- ── 5. Suggestions when not certain ────────────────────────────────────────
-- For a notice: DRC-03s of its client linked to nothing, and (for a case of its
-- own with no link, such as an appeal whose application is not in the folder)
-- the orders it may belong to, each with a score and the reasons, best first.
CREATE OR REPLACE FUNCTION public.notice_link_suggestions(p_notice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n       public.gst_notices;
  v_fy    text;
  v_key   text;
  v_drc   jsonb;
  v_cases jsonb := '[]'::jsonb;
  v_apl   boolean;
BEGIN
  SELECT * INTO n FROM public.gst_notices WHERE id = p_notice_id;
  IF n.id IS NULL THEN RETURN '{}'::jsonb; END IF;
  v_fy := public.notice_fy_key(n.financial_year);

  SELECT coalesce(jsonb_agg(x ORDER BY (x ->> 'score')::int DESC, x ->> 'filed_date' DESC), '[]'::jsonb) INTO v_drc
    FROM (
      SELECT jsonb_build_object(
               'arn', d.arn, 'filed_date', d.filed_date, 'amount', coalesce(d.cash_amount, 0) + coalesce(d.credit_amount, 0),
               'cause', left(d.cause_of_payment, 300), 'financial_year', d.financial_year,
               'score', sc.score, 'reasons', sc.reasons) AS x
        FROM public.gst_drc03_filings d
        CROSS JOIN LATERAL (
          SELECT (CASE WHEN v_fy IS NOT NULL AND public.notice_fy_key(d.financial_year) = v_fy THEN 40 ELSE 0 END
                + CASE WHEN n.issue_date IS NOT NULL AND d.filed_date >= n.issue_date THEN 20 ELSE 0 END
                + CASE WHEN coalesce(d.cause_of_payment, '') ~* '(scn|show cause|drc[- ]?01|asmt|notice|audit|scrutiny|demand|order)' THEN 20 ELSE 0 END
                + CASE WHEN coalesce(n.amount_of_demand, 0) > 0
                        AND abs(coalesce(d.cash_amount, 0) + coalesce(d.credit_amount, 0) - n.amount_of_demand) <= greatest(n.amount_of_demand * 0.05, 1) THEN 20 ELSE 0 END) AS score,
                 to_jsonb(array_remove(ARRAY[
                   CASE WHEN v_fy IS NOT NULL AND public.notice_fy_key(d.financial_year) = v_fy THEN 'same financial year' END,
                   CASE WHEN n.issue_date IS NOT NULL AND d.filed_date >= n.issue_date THEN 'paid after the notice' END,
                   CASE WHEN coalesce(d.cause_of_payment, '') ~* '(scn|show cause|drc[- ]?01|asmt|notice|audit|scrutiny|demand|order)' THEN 'its cause mentions a notice' END,
                   CASE WHEN coalesce(n.amount_of_demand, 0) > 0
                         AND abs(coalesce(d.cash_amount, 0) + coalesce(d.credit_amount, 0) - n.amount_of_demand) <= greatest(n.amount_of_demand * 0.05, 1) THEN 'amount matches the demand' END
                 ], NULL)) AS reasons
        ) sc
       WHERE d.client_id = n.client_id AND d.deleted_at IS NULL AND d.arn IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.notice_payments p WHERE p.drc03_arn = d.arn)
         AND sc.score >= 40
       LIMIT 50
    ) s;

  -- A case of its own that is not linked, opened by an appeal: the orders it may be against.
  v_key := public.notice_case_key(n.case_id, (SELECT f.category FROM public.notice_facts f WHERE f.id = n.id), n.id);
  v_apl := n.form_code LIKE 'APL-%' OR coalesce(n.notice_type, '') ILIKE 'appeal%';
  IF v_apl AND n.case_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.notice_case_links l WHERE l.client_id = n.client_id AND l.child_key = n.case_id) THEN
    SELECT coalesce(jsonb_agg(x ORDER BY (x ->> 'score')::int DESC, x ->> 'issue_date' DESC), '[]'::jsonb) INTO v_cases
      FROM (
        SELECT jsonb_build_object(
                 'notice_id', o.id, 'form_code', o.form_code, 'reference', o.reference_number, 'case_id', o.case_id,
                 'issue_date', o.issue_date, 'financial_year', o.financial_year, 'amount', o.amount_of_demand,
                 'score', 50 + CASE WHEN o.issue_date <= coalesce(n.issue_date, current_date) AND o.issue_date >= coalesce(n.issue_date, current_date) - 400 THEN 30 ELSE 0 END
                             + CASE WHEN NOT EXISTS (SELECT 1 FROM public.notice_case_links l2 WHERE l2.client_id = o.client_id AND l2.parent_key = o.case_id AND l2.kind = 'appeal') THEN 20 ELSE 0 END,
                 'reasons', to_jsonb(array_remove(ARRAY['an order of this client',
                   CASE WHEN o.issue_date <= coalesce(n.issue_date, current_date) AND o.issue_date >= coalesce(n.issue_date, current_date) - 400 THEN 'issued in the year before the appeal' END,
                   CASE WHEN NOT EXISTS (SELECT 1 FROM public.notice_case_links l2 WHERE l2.client_id = o.client_id AND l2.parent_key = o.case_id AND l2.kind = 'appeal') THEN 'no appeal linked to it yet' END], NULL))) AS x
          FROM public.gst_notices o
         WHERE o.client_id = n.client_id AND o.deleted_at IS NULL AND o.case_id IS NOT NULL AND o.case_id <> n.case_id
           AND o.form_code IN ('DRC-07', 'ASMT-13', 'ASMT-15', 'ASMT-16', 'ADT-03', 'RFD-06', 'REG-05', 'REG-19', 'RECT-ORDER')
      ) s;
  END IF;
  RETURN jsonb_build_object('drc03', v_drc, 'cases', v_cases, 'case_key', v_key);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_link_suggestions(uuid) TO anon, authenticated, service_role;

-- A person accepts a suggested case link (or removes one they made).
CREATE OR REPLACE FUNCTION public.notice_case_link_set(p_client_id uuid, p_child_key text, p_parent_key text, p_kind text, p_by text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_parent_key IS NULL THEN
    DELETE FROM public.notice_case_links WHERE client_id = p_client_id AND child_key = p_child_key AND source = 'manual';
    RETURN FOUND;
  END IF;
  IF p_child_key = p_parent_key OR public.notice_case_root(p_client_id, p_parent_key) = p_child_key THEN
    RAISE EXCEPTION 'A case cannot be linked into itself.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.notice_case_links (client_id, child_key, parent_key, kind, source, created_by_name)
  VALUES (p_client_id, p_child_key, p_parent_key, coalesce(p_kind, 'related'), 'manual', left(p_by, 120))
  ON CONFLICT (client_id, child_key) DO UPDATE
     SET parent_key = excluded.parent_key, kind = excluded.kind, source = 'manual', created_by_name = excluded.created_by_name, created_at = now();
  PERFORM public.notices_sweep_linked(p_client_id);
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_link_set(uuid, text, text, text, text) TO anon, authenticated, service_role;

-- notices_sweep_superseded as in 20261010100000_notices_cleanup_settings.sql, now with part 5.
CREATE OR REPLACE FUNCTION public.notices_sweep_superseded(p_client_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_n integer := 0;
  v_k integer;
BEGIN
  -- A notice that asks for a reply, once its case has moved on.
  WITH cand AS (
    SELECT n.id,
           CASE
             WHEN EXISTS (SELECT 1 FROM public.gst_notices n2
                           WHERE n2.client_id = n.client_id AND n2.case_id = n.case_id AND n2.deleted_at IS NULL
                             AND n2.id <> n.id AND n2.issue_date > n.issue_date)
               THEN 'auto:superseded_in_case'
             WHEN EXISTS (SELECT 1 FROM public.gst_case_folder_items i
                           WHERE i.client_id = n.client_id AND i.case_id = n.case_id AND i.deleted_at IS NULL
                             AND upper(btrim(coalesce(i.folder_section, ''))) IN ('REPLY', 'REPLIES'))
              AND EXISTS (SELECT 1 FROM public.gst_case_folder_items i
                           WHERE i.client_id = n.client_id AND i.case_id = n.case_id AND i.deleted_at IS NULL
                             AND upper(btrim(coalesce(i.folder_section, ''))) IN ('ORDRS', 'ORDER', 'ORDERS'))
               THEN 'auto:replied_and_decided'
           END AS reason
      FROM public.gst_notices n
     WHERE n.deleted_at IS NULL AND n.staff_status IS NULL AND n.source = 'notices'
       AND n.case_id IS NOT NULL AND n.issue_date IS NOT NULL
       AND n.form_code IN ('ASMT-10', 'ASMT-02', 'DRC-01', 'DRC-01A', 'DRC-01B', 'DRC-01C', 'RFD-03', 'RFD-08',
                           'ADT-01', 'ADT-02', 'APL-HEARING', 'SUMMONS')
       AND (p_client_id IS NULL OR n.client_id = p_client_id)
  )
  UPDATE public.gst_notices g SET staff_status = 'Closed', close_reason = c.reason
    FROM cand c
   WHERE g.id = c.id AND c.reason IS NOT NULL AND g.staff_status IS NULL;
  GET DIAGNOSTICS v_k = ROW_COUNT;
  v_n := v_n + v_k;

  -- Registration: a query, a show cause notice or a rejection that is concluded.
  UPDATE public.gst_notices n SET staff_status = 'Closed', close_reason = 'auto:registration_concluded'
   WHERE n.deleted_at IS NULL AND n.staff_status IS NULL AND n.source = 'notices'
     AND n.form_code IN ('REG-03', 'REG-SCN', 'REG-17', 'REG-05', 'REG-CANCEL-REJ')
     AND (p_client_id IS NULL OR n.client_id = p_client_id)
     AND (n.issue_date < public.ist_today() - 120
          OR EXISTS (SELECT 1 FROM public.gst_notices n2
                      WHERE n2.client_id = n.client_id AND n2.deleted_at IS NULL AND n2.id <> n.id
                        AND n2.form_code LIKE 'REG-%' AND n2.issue_date > n.issue_date));
  GET DIAGNOSTICS v_k = ROW_COUNT;
  v_n := v_n + v_k;

  -- A cancellation order, once the registration is active again or revoked.
  UPDATE public.gst_notices n SET staff_status = 'Closed', close_reason = 'auto:registration_restored'
   WHERE n.deleted_at IS NULL AND n.staff_status IS NULL AND n.source = 'notices'
     AND n.form_code = 'REG-19'
     AND (p_client_id IS NULL OR n.client_id = p_client_id)
     AND (EXISTS (SELECT 1 FROM public.gst_notices n2
                   WHERE n2.client_id = n.client_id AND n2.deleted_at IS NULL AND n2.form_code = 'REG-22'
                     AND n2.issue_date > n.issue_date)
          OR EXISTS (SELECT 1 FROM public.gst_taxpayer_profile p
                      WHERE p.client_id = n.client_id AND coalesce(p.gstin_status, '') ~* '^\s*active'));
  GET DIAGNOSTICS v_k = ROW_COUNT;
  v_n := v_n + v_k;

  -- Part 5 (20261012100000): orders with an appeal or an approved waiver in a linked case.
  RETURN v_n + public.notices_sweep_linked(p_client_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notices_sweep_superseded(uuid) TO anon, authenticated, service_role;

-- ── 2. The case views on the rooted key ─────────────────────────────────────
-- notice_facts as in 20261010100000, an order in the appeal stage neither overdue nor due in 7.
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
         public.ist_today() AS today_ist,
         coalesce(ts.response_need, 'critical') AS response_need,
         coalesce(ts.show_on_dashboard, true) AS on_dashboard
    FROM public.gst_notices g
    JOIN public.clients c ON c.id = g.client_id
    LEFT JOIN public.notice_form_rules r ON r.form_code = g.form_code AND r.is_active
    LEFT JOIN public.notice_type_settings ts ON ts.form_code = g.form_code
   WHERE g.deleted_at IS NULL
     AND g.source = 'notices'
     -- 20261008180000: a type hidden everywhere is in no list, count, report or e-mail.
     AND NOT coalesce(ts.hidden, false)
     -- 20261010100000: a client whose litigation the firm does not handle is in no task, list, count or e-mail.
     AND coalesce(c.notices_handled, true)
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
  -- 20261012100000: an order under appeal has met its clock (the appeal is the task now).
  coalesce(d.open_flag AND NOT d.replied_flag AND d.response_need <> 'none' AND coalesce(d.stage, '') <> 'appeal' AND d.eff_due < d.today_ist, false) AS is_overdue,
  coalesce(d.open_flag AND NOT d.replied_flag AND d.response_need <> 'none' AND coalesce(d.stage, '') <> 'appeal' AND d.eff_due BETWEEN d.today_ist AND d.today_ist + 7, false) AS is_due_in_7,
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
  d.hearing_note,
  -- Phase 4b: the notice type's reply need and dashboard choice
  d.response_need,
  d.on_dashboard
FROM derived d
JOIN public.notice_stages st ON st.key = d.stage;


-- As in 20261011100000_notice_cases.sql, on the rooted case key.
CREATE OR REPLACE VIEW public.notice_case_correspondence AS
WITH n AS (
  SELECT f.id, f.client_id, f.case_id, f.category, f.form_code, f.form_label, f.notice_type, f.reference_number,
         f.issue_date, f.first_seen_at, public.notice_case_key(f.client_id, f.case_id, f.category, f.id) AS case_key
    FROM public.notice_facts f
), firsts AS (
  SELECT g.client_id, min(g.first_seen_at) AS first_at FROM public.gst_notices g GROUP BY g.client_id
), items AS (
  SELECT n.client_id, n.case_key, 'notice'::text AS kind, n.id AS item_id, 'department'::text AS from_party,
         coalesce(n.issue_date, (n.first_seen_at AT TIME ZONE 'Asia/Kolkata')::date) AS item_date, n.first_seen_at,
         coalesce(n.form_code || ' · ', '') || coalesce(n.form_label, n.notice_type, 'Notice') AS label,
         n.reference_number AS reference, NULL::text AS folder_section
    FROM n
  UNION ALL
  SELECT fi.client_id, public.notice_case_root(fi.client_id, fi.case_id), 'document', fi.id, public.notice_folder_from(fi.folder_section),
         coalesce(public.notice_folder_item_date(fi.raw_json), (fi.first_seen_at AT TIME ZONE 'Asia/Kolkata')::date), fi.first_seen_at,
         public.notice_folder_label(fi.folder_section, fi.raw_json), fi.reference_number, fi.folder_section
    FROM public.gst_case_folder_items fi
   WHERE fi.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM n WHERE n.client_id = fi.client_id AND n.case_key = public.notice_case_root(fi.client_id, fi.case_id))
     -- The folder's copy of a notice already listed is that notice, not another item.
     AND NOT EXISTS (SELECT 1 FROM n WHERE n.client_id = fi.client_id AND n.case_key = public.notice_case_root(fi.client_id, fi.case_id)
                       AND n.reference_number IS NOT NULL AND n.reference_number = fi.reference_number)
)
SELECT i.*,
       s.seen_at,
       (i.first_seen_at > fr.first_at + interval '1 hour'
        AND i.first_seen_at > now() - interval '30 days'
        AND i.first_seen_at > coalesce(s.seen_at, '-infinity'::timestamptz)) AS is_new
  FROM items i
  LEFT JOIN firsts fr ON fr.client_id = i.client_id
  LEFT JOIN public.notice_case_seen s ON s.client_id = i.client_id AND s.case_key = i.case_key;
COMMENT ON VIEW public.notice_case_correspondence IS
  'Every notice and case folder document of the notice cases, with who sent it and whether it is new (arrived on a later sync than the client''s first, in the last 30 days, after the case was last opened).';
GRANT SELECT ON public.notice_case_correspondence TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.notice_cases AS
WITH n AS (
  SELECT f.*, public.notice_case_key(f.client_id, f.case_id, f.category, f.id) AS case_key, public.notice_track(f.category) AS track
    FROM public.notice_facts f
), lead AS (
  -- The notice the case is worked on: the open one due first, else the latest.
  SELECT DISTINCT ON (n.client_id, n.case_key) n.*
    FROM n
   ORDER BY n.client_id, n.case_key, n.is_open DESC, (CASE WHEN n.is_open THEN n.effective_due END) ASC NULLS LAST,
            n.issue_date DESC NULLS LAST, n.first_seen_at DESC
), agg AS (
  SELECT n.client_id, n.case_key,
         count(*)::int AS notices,
         count(*) FILTER (WHERE n.is_open)::int AS open_notices,
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
  SELECT c.client_id, c.case_key,
         count(*) FILTER (WHERE c.kind = 'document')::int AS documents,
         count(*) FILTER (WHERE c.is_new)::int AS new_items,
         max(c.first_seen_at) FILTER (WHERE c.is_new) AS new_at,
         max(c.first_seen_at) AS last_arrived_at,
         max(c.seen_at) AS seen_at
    FROM public.notice_case_correspondence c
   GROUP BY c.client_id, c.case_key
), latest AS (
  SELECT DISTINCT ON (c.client_id, c.case_key) c.client_id, c.case_key, c.kind, c.label, c.from_party, c.item_date, c.first_seen_at, c.is_new
    FROM public.notice_case_correspondence c
   ORDER BY c.client_id, c.case_key, c.item_date DESC NULLS LAST, c.first_seen_at DESC
)
SELECT
  l.client_id, l.client_name, l.client_gstin, l.case_key,
  CASE WHEN l.case_key LIKE 'N:%' OR l.case_key = 'REG' THEN NULL ELSE l.case_key END AS case_id,
  a.track,
  CASE WHEN l.case_key = 'REG' THEN 'Registration' ELSE coalesce(l.form_label, l.notice_type, 'Notice') END AS title,
  l.id AS lead_notice_id, l.id, l.form_code, l.form_label, l.category, l.reference_number,
  l.stage, l.stage_label, l.stage_ord, l.assign_to, l.assign_to_user_id, l.effective_priority,
  coalesce(public.notice_fy_key(l.financial_year), split_part(a.financial_years, ', ', 1)) AS financial_year,
  a.financial_years, a.forms, a.notices, a.open_notices, a.is_open, a.is_overdue, a.is_due_in_7, a.is_unassigned,
  a.next_due, a.next_hearing, a.first_issue_date, a.last_issue_date, a.exposure, a.amount_of_demand, a.on_dashboard,
  coalesce(co.documents, 0) AS documents, coalesce(co.new_items, 0) AS new_items, co.new_at, co.last_arrived_at, co.seen_at,
  lt.label AS latest_label, lt.kind AS latest_kind, lt.from_party AS latest_from, lt.item_date AS latest_date,
  greatest(a.last_issue_date, lt.item_date) AS last_activity_date,
  l.today_ist
FROM lead l
JOIN agg a ON a.client_id = l.client_id AND a.case_key = l.case_key
LEFT JOIN corr co ON co.client_id = l.client_id AND co.case_key = l.case_key
LEFT JOIN latest lt ON lt.client_id = l.client_id AND lt.case_key = l.case_key;
COMMENT ON VIEW public.notice_cases IS
  'One row per notice case (the central issue): its kind (track), the notice it is worked on (lead), counts, the next due date and hearing, open exposure, its latest correspondence and how much of it is new. Columns client_id, financial_year, assign_to_user_id, form_code and effective_priority are the lead''s, for the master filters.';
GRANT SELECT ON public.notice_cases TO anon, authenticated, service_role;

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
        'stage', f.stage, 'stage_label', f.stage_label, 'is_open', f.is_open, 'pdf_url', g.pdf_url,
        -- A notice carries the files of its copy in the case folder (same reference).
        'attachments', (SELECT coalesce(jsonb_agg(a), '[]'::jsonb)
                          FROM public.gst_case_folder_items fi
                          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(fi.attachments) = 'array' THEN fi.attachments ELSE '[]'::jsonb END) a
                         WHERE fi.deleted_at IS NULL
                           AND ((c.kind = 'document' AND fi.id = c.item_id)
                             OR (c.kind = 'notice' AND fi.client_id = c.client_id AND public.notice_case_root(fi.client_id, fi.case_id) = c.case_key AND fi.reference_number = c.reference))),
        'ai', (SELECT jsonb_build_object('title', d.title, 'summary', d.summary, 'doc_kind', d.doc_kind, 'outcome', d.outcome,
                                         'doc_date', d.doc_date, 'status', d.status, 'reason_class', d.reason_class)
                 FROM public.ai_documents d
                WHERE (c.kind = 'document' AND d.folder_item_id = c.item_id)
                   OR (c.kind = 'notice' AND d.notice_id = c.item_id AND d.source = 'workspace')
                   OR (c.kind = 'notice' AND d.folder_item_id IN (
                         SELECT fi.id FROM public.gst_case_folder_items fi
                          WHERE fi.client_id = c.client_id AND public.notice_case_root(fi.client_id, fi.case_id) = c.case_key AND fi.reference_number = c.reference AND fi.deleted_at IS NULL))
                ORDER BY (d.status = 'done') DESC, (d.summary IS NOT NULL) DESC, d.sort_date DESC NULLS LAST
                LIMIT 1),
        'notice_read', CASE WHEN c.kind = 'notice' THEN
               (SELECT jsonb_build_object('status', x.status, 'outcome', x.outcome, 'summary', nullif(x.detail ->> 'summary', ''))
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

CREATE OR REPLACE FUNCTION public.notice_case_overview(p_client_id uuid, p_case_key text, p_notice_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fields jsonb := '{}'::jsonb;
  k        text;
  v_val    jsonb;
  v_today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_refund jsonb;
  v_reg    jsonb;
  v_keys   text[] := ARRAY['section_of_law', 'financial_year', 'period_from', 'period_to', 'din', 'reply_due',
                           'hearing_date', 'hearing_note', 'officer', 'amount_of_demand'];
BEGIN
  -- A linked case (an appeal against an order, …) is read as the case it belongs to.
  p_case_key := public.notice_case_root(p_client_id, p_case_key);
  FOREACH k IN ARRAY v_keys LOOP
    v_val := NULL;
    -- The case's notices, the one on screen first.
    SELECT jsonb_build_object('value', x.v, 'source', 'notice', 'notice_id', x.id, 'label', x.label, 'date', x.issue_date)
      INTO v_val
      FROM (
        SELECT g.id, g.issue_date, coalesce(g.form_code || ' ', '') || coalesce(g.reference_number, '') AS label,
               CASE k
                 WHEN 'section_of_law' THEN g.section_of_law
                 WHEN 'financial_year' THEN public.notice_fy_key(g.financial_year)
                 WHEN 'period_from' THEN g.period_from::text
                 WHEN 'period_to' THEN g.period_to::text
                 WHEN 'din' THEN g.din
                 WHEN 'reply_due' THEN CASE WHEN f.is_open THEN f.effective_due::text END
                 WHEN 'hearing_date' THEN g.hearing_date::text
                 WHEN 'hearing_note' THEN g.hearing_note
                 WHEN 'officer' THEN g.issued_by
                 WHEN 'amount_of_demand' THEN nullif(g.amount_of_demand, 0)::text
               END AS v
          FROM public.gst_notices g
          JOIN public.notice_facts f ON f.id = g.id
         WHERE g.client_id = p_client_id AND public.notice_case_key(g.client_id, g.case_id, f.category, g.id) = p_case_key
         ORDER BY (g.id = p_notice_id) DESC NULLS LAST,
                  CASE WHEN k = 'hearing_date' THEN g.hearing_date END DESC NULLS LAST,
                  g.issue_date DESC NULLS LAST
      ) x
     WHERE nullif(btrim(x.v), '') IS NOT NULL
     LIMIT 1;
    -- What the AI read in the case's documents.
    IF v_val IS NULL THEN
      SELECT jsonb_build_object('value', x.v, 'source', 'ai', 'document_id', x.id, 'label', x.label, 'date', x.doc_date)
        INTO v_val
        FROM (
          SELECT d.id, d.doc_date, coalesce(nullif(d.title, ''), d.label, 'a case document') AS label,
                 nullif(btrim(CASE k
                   WHEN 'officer' THEN d.overview ->> 'officer'
                   WHEN 'amount_of_demand' THEN coalesce(nullif(d.overview ->> 'demand_total', ''), '')
                   WHEN 'reply_due' THEN d.overview ->> 'reply_due'
                   WHEN 'hearing_note' THEN concat_ws(' · ', nullif(d.overview ->> 'hearing_time', ''), nullif(d.overview ->> 'hearing_venue', ''))
                   ELSE d.overview ->> k END), '') AS v
            FROM public.ai_documents d
           WHERE d.client_id = p_client_id AND d.status = 'done' AND d.overview IS NOT NULL
             AND (public.notice_case_root(p_client_id, d.case_id) = p_case_key OR (p_case_key LIKE 'N:%' AND d.notice_id::text = substr(p_case_key, 3)))
           ORDER BY d.doc_date DESC NULLS LAST, d.finished_at DESC
        ) x
       WHERE x.v IS NOT NULL
         -- A past reply date or hearing in an old document says nothing about now.
         AND (k NOT IN ('reply_due', 'hearing_date') OR (x.v ~ '^\d{4}-\d{2}-\d{2}$' AND x.v::date >= v_today - 30))
         AND (k <> 'amount_of_demand' OR x.v ~ '^\d+(\.\d+)?$')
       LIMIT 1;
    END IF;
    IF v_val IS NOT NULL THEN v_fields := v_fields || jsonb_build_object(k, v_val); END IF;
  END LOOP;

  -- A refund case: the application as filed on the portal (its case folder item
  -- and the refund list), and the amounts the AI read in its orders.
  SELECT jsonb_strip_nulls(jsonb_build_object(
           'arn', coalesce(a.raw_json ->> 'applnAckNum', a.raw_json ->> 'arn', a.reference_number),
           'reason', a.raw_json ->> 'refundRsn',
           'period_from', nullif(a.raw_json ->> 'fromRetPrd', ''),
           'period_to', nullif(a.raw_json ->> 'toRetPrd', ''),
           'claimed', CASE WHEN coalesce(a.raw_json ->> 'ttlRfdAmt', '') ~ '^\d+(\.\d+)?$' THEN (a.raw_json ->> 'ttlRfdAmt')::numeric END,
           'filed_on', public.notices_parse_portal_date(a.raw_json ->> 'rfdSubDt'),
           'status', (SELECT r.status FROM public.refund_facts r
                       WHERE r.client_id = p_client_id AND r.origin = 'application'
                         AND r.arn = coalesce(a.raw_json ->> 'applnAckNum', a.raw_json ->> 'arn', a.reference_number)
                       LIMIT 1)))
    INTO v_refund
    FROM public.gst_case_folder_items a
   WHERE a.client_id = p_client_id AND public.notice_case_root(p_client_id, a.case_id) = p_case_key AND a.deleted_at IS NULL AND a.folder_section = 'APLCN'
     AND coalesce(a.raw_json ->> 'formNo', '') ILIKE '%RFD-01%'
   ORDER BY a.first_seen_at DESC
   LIMIT 1;
  FOREACH k IN ARRAY ARRAY['refund_provisional', 'refund_sanctioned', 'refund_rejected', 'refund_net_payable', 'refund_paid', 'refund_claimed'] LOOP
    SELECT jsonb_build_object('value', (d.overview ->> k)::numeric, 'document_id', d.id, 'label', coalesce(nullif(d.title, ''), d.label), 'date', d.doc_date)
      INTO v_val
      FROM public.ai_documents d
     WHERE d.client_id = p_client_id AND d.status = 'done' AND public.notice_case_root(p_client_id, d.case_id) = p_case_key
       AND coalesce(d.overview ->> k, '') ~ '^\d+(\.\d+)?$'
     ORDER BY d.doc_date DESC NULLS LAST, d.finished_at DESC
     LIMIT 1;
    IF v_val IS NOT NULL THEN v_refund := coalesce(v_refund, '{}'::jsonb) || jsonb_build_object(k, v_val); END IF;
  END LOOP;
  -- A registration case: what the AI read about the application.
  SELECT jsonb_strip_nulls(jsonb_build_object(
           'application_type', nullif(d.overview ->> 'application_type', ''),
           'application_arn', nullif(d.overview ->> 'application_arn', ''),
           'application_date', nullif(d.overview ->> 'application_date', ''),
           'document_id', d.id, 'label', coalesce(nullif(d.title, ''), d.label)))
    INTO v_reg
    FROM public.ai_documents d
   WHERE d.client_id = p_client_id AND d.status = 'done' AND d.overview IS NOT NULL
     AND (public.notice_case_root(p_client_id, d.case_id) = p_case_key OR (p_case_key = 'REG' AND d.notice_id IN (
            SELECT g.id FROM public.gst_notices g JOIN public.notice_facts f ON f.id = g.id
             WHERE g.client_id = p_client_id AND f.category = 'Registration')))
     AND coalesce(d.overview ->> 'application_type', d.overview ->> 'application_arn', '') <> ''
   ORDER BY d.doc_date DESC NULLS LAST
   LIMIT 1;

  RETURN jsonb_build_object(
    'fields', v_fields,
    -- Every form the case holds: its notices' and the forms named by the files
    -- in its portal case folder (an RFD-02 acknowledgement, an RFD-05 payment
    -- order), for the steps a refund or registration matter shows.
    'forms', (SELECT coalesce(jsonb_agg(DISTINCT x.form ORDER BY x.form), '[]'::jsonb) FROM (
                SELECT g.form_code AS form
                  FROM public.gst_notices g JOIN public.notice_facts f ON f.id = g.id
                 WHERE g.client_id = p_client_id AND public.notice_case_key(g.client_id, g.case_id, f.category, g.id) = p_case_key AND g.form_code IS NOT NULL
                UNION
                SELECT upper(m[1]) || '-' || lpad(m[2], 2, '0')
                  FROM public.gst_case_folder_items fi
                  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(fi.attachments) = 'array' THEN fi.attachments ELSE '[]'::jsonb END) a
                  CROSS JOIN LATERAL regexp_matches(coalesce(a ->> 'label', '') || ' ' || coalesce(a ->> 'url', ''), '(RFD|REG|DRC|ASMT|ADT|APL)[-_ ]?(\d{1,2})', 'gi') m
                 WHERE fi.client_id = p_client_id AND public.notice_case_root(p_client_id, fi.case_id) = p_case_key AND fi.deleted_at IS NULL
                UNION
                SELECT upper(replace(replace(fi.raw_json ->> 'formNo', 'GST ', ''), ' ', '-'))
                  FROM public.gst_case_folder_items fi
                 WHERE fi.client_id = p_client_id AND public.notice_case_root(p_client_id, fi.case_id) = p_case_key AND fi.deleted_at IS NULL AND fi.raw_json ? 'formNo') x
               WHERE x.form IS NOT NULL),
    'refund', v_refund,
    'registration', v_reg,
    'reading', (SELECT jsonb_build_object(
                  'documents', count(*),
                  'done', count(*) FILTER (WHERE d.status = 'done'),
                  'queued', count(*) FILTER (WHERE d.status IN ('queued', 'running')),
                  'failed', count(*) FILTER (WHERE d.status = 'failed'))
                  FROM public.ai_documents d
                 WHERE d.client_id = p_client_id
                   AND (public.notice_case_root(p_client_id, d.case_id) = p_case_key OR (p_case_key LIKE 'N:%' AND d.notice_id::text = substr(p_case_key, 3)))),
    'summaries', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                     'document_id', d.id, 'title', d.title, 'summary', d.summary, 'doc_kind', d.doc_kind, 'outcome', d.outcome,
                     'date', d.doc_date, 'from', public.notice_folder_from(d.folder_section))
                     ORDER BY d.doc_date DESC NULLS LAST, d.finished_at DESC), '[]'::jsonb)
                    FROM (SELECT DISTINCT ON (coalesce(d0.document_sha256, d0.id::text)) d0.*
                            FROM public.ai_documents d0
                           WHERE d0.client_id = p_client_id AND d0.status = 'done' AND nullif(d0.summary, '') IS NOT NULL
                             AND (public.notice_case_root(p_client_id, d0.case_id) = p_case_key OR (p_case_key LIKE 'N:%' AND d0.notice_id::text = substr(p_case_key, 3)))
                           ORDER BY coalesce(d0.document_sha256, d0.id::text), d0.finished_at DESC) d));
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_overview(uuid, text, uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notice_case_mark_seen(p_client_id uuid, p_case_key text, p_by_name text DEFAULT NULL)
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.notice_case_seen (client_id, case_key, seen_at, seen_by_name)
  VALUES (p_client_id, public.notice_case_root(p_client_id, p_case_key), now(), left(p_by_name, 120))
  ON CONFLICT (client_id, case_key) DO UPDATE SET seen_at = excluded.seen_at, seen_by_name = excluded.seen_by_name
  RETURNING seen_at
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_mark_seen(uuid, text, text) TO anon, authenticated, service_role;

-- Now: build the links and apply part 5.
SELECT public.notices_sweep_linked(NULL);
