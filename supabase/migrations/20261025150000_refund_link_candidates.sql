-- Refund cases: what a refund may be linked to (the firm, 25 October 2026:
-- "in refund page, how case to be linked here? ... logical confusion").
--
-- notice_case_link_candidates (20261024100000) offered any two refund
-- applications of a client filed within 120 days of an order as "a fresh
-- application after it", so every refund case suggested a score of the
-- client's other quarters and types. A refund belongs with another case in
-- two ways only:
--   1. an appeal (APL-01), waiver or rectification against its order, scored
--      as before;
--   2. the same refund filed again (after a deficiency memo, a rejection or a
--      withdrawal): the same type of refund for the same (overlapping) period,
--      read from the application itself (gst_refund_applications.refund_type,
--      the RFD-01's fromRetPrd / toRetPrd in its case folder).
-- Refund applications of another type or period score 0, and a refund with a
-- case that neither appeals it nor files it again at most 20: never offered
-- (40 and above), still listed by the manual picker. Each suggestion also
-- carries the other case's refund type and period.
--
-- Additive: one new function, notice_refund_ident(); the candidates function
-- replaced with the same signature. No data changes.

CREATE OR REPLACE FUNCTION public.notice_refund_ident(p_client_id uuid, p_key text)
RETURNS TABLE (refund_type text, period_from text, period_to text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH a AS (
    SELECT upper(btrim(r.refund_type)) AS refund_type
      FROM public.gst_refund_applications r
     WHERE r.client_id = p_client_id AND upper(r.arn) = upper(p_key)
     LIMIT 1
  ), per AS (
    -- YYYYMM, or MMYYYY turned round.
    SELECT CASE WHEN f ~ '^20[0-9]{2}(0[1-9]|1[0-2])$' THEN f
                WHEN f ~ '^(0[1-9]|1[0-2])20[0-9]{2}$' THEN substr(f, 3, 4) || substr(f, 1, 2) END AS pf,
           CASE WHEN t ~ '^20[0-9]{2}(0[1-9]|1[0-2])$' THEN t
                WHEN t ~ '^(0[1-9]|1[0-2])20[0-9]{2}$' THEN substr(t, 3, 4) || substr(t, 1, 2) END AS pt
      FROM (SELECT btrim(i.raw_json ->> 'fromRetPrd') AS f, btrim(i.raw_json ->> 'toRetPrd') AS t
              FROM public.gst_case_folder_items i
             WHERE i.client_id = p_client_id AND upper(i.case_id) = upper(p_key)
               AND upper(coalesce(i.folder_section, '')) = 'APLCN' AND i.raw_json ? 'fromRetPrd'
             LIMIT 1) x
  )
  SELECT a.refund_type,
         to_char(to_date(per.pf, 'YYYYMM'), 'YYYY-MM'),
         to_char(to_date(coalesce(per.pt, per.pf), 'YYYYMM'), 'YYYY-MM')
    FROM a LEFT JOIN per ON true
$$;
GRANT EXECUTE ON FUNCTION public.notice_refund_ident(uuid, text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.notice_refund_ident(uuid, text) IS
  'A refund application''s type and period (YYYY-MM), from gst_refund_applications and the RFD-01 in its case folder; no row when the case is not a refund application.';

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
           o.refund_sanctioned AS o_sanctioned, o.refund_rejected AS o_rejected,
           c.track AS c_track, ci.refund_type AS c_rtype, ci.period_from AS c_pf, ci.period_to AS c_pt,
           pi.refund_type AS p_rtype, pi.period_from AS p_pf, pi.period_to AS p_pt,
           oi.refund_type AS o_rtype, oi.period_from AS o_pf, oi.period_to AS o_pt,
           -- Two refund applications belong together only as the same refund filed again:
           -- the same type of refund for the same (overlapping) period.
           (c.marker IS NULL AND c.refund_app AND par.refund_app) AS refund_pair,
           (ci.refund_type IS NOT NULL AND ci.refund_type = pi.refund_type
            AND ci.period_from <= pi.period_to AND pi.period_from <= ci.period_to) AS same_refund
      FROM sides s
      JOIN p c ON c.own_key = s.child_key
      JOIN p par ON par.own_key = s.parent_key
      JOIN p o ON o.own_key = s.other_key
      LEFT JOIN LATERAL public.notice_refund_ident(p_client_id, c.own_key) ci ON true
      LEFT JOIN LATERAL public.notice_refund_ident(p_client_id, par.own_key) pi ON true
      LEFT JOIN LATERAL public.notice_refund_ident(p_client_id, o.own_key) oi ON true
      CROSS JOIN LATERAL (SELECT (c.first_date - coalesce(par.order_date, par.last_date)) AS gap) sc
  ), points0 AS (
    SELECT s.*,
           (CASE WHEN s.c_marker IS NOT NULL AND s.p_has_order THEN 40
                 WHEN s.refund_pair AND s.same_refund THEN 50 ELSE 0 END)
         + (CASE WHEN s.gap BETWEEN 0 AND 120 THEN 30 WHEN s.gap BETWEEN 121 AND 400 THEN 10 WHEN s.gap < 0 THEN -20 ELSE 0 END)
         + (CASE WHEN s.c_fy IS NOT NULL AND s.c_fy = s.p_fy THEN 15 ELSE 0 END)
         + (CASE WHEN coalesce(s.c_amount, 0) > 0 AND coalesce(s.p_amount, 0) > 0
                  AND abs(s.c_amount - s.p_amount) <= greatest(s.p_amount * 0.05, 1) THEN 15
                 WHEN coalesce(s.c_amount, 0) > 0 AND coalesce(s.p_rejected, 0) > 0
                  AND abs(s.c_amount - s.p_rejected) <= greatest(s.p_rejected * 0.05, 1) THEN 20 ELSE 0 END)
         + (CASE WHEN s.c_marker = 'appeal' AND s.c_about_refund AND s.p_track = 'refund' THEN 20
                 WHEN s.c_marker = 'appeal' AND NOT s.c_about_refund AND s.p_track = 'litigation' THEN 10 ELSE 0 END)
         + (CASE WHEN s.c_marker = 'appeal' AND s.p_free THEN 10 ELSE 0 END) AS raw_score
      FROM scored s
  ), points AS (
    -- Refunds of other periods or types, and a refund with a case that neither
    -- appeals it nor files it again, are never offered (the manual picker,
    -- which lists every case, still shows them, at the bottom).
    SELECT s.*,
           CASE WHEN s.refund_pair AND NOT coalesce(s.same_refund, false) THEN least(s.raw_score, 0)
                WHEN s.c_marker IS NULL AND NOT s.refund_pair AND (s.c_track = 'refund' OR s.p_track = 'refund') THEN least(s.raw_score, 20)
                ELSE s.raw_score END AS score
      FROM points0 s
  )
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.score DESC, x.o_last DESC NULLS LAST), '[]'::jsonb)
    FROM (
      SELECT DISTINCT ON (s.other_key) s.other_key, s.score, s.o_last,
             jsonb_build_object(
               'member_key', s.member_key, 'other_key', s.other_key,
               'child_key', s.child_key, 'parent_key', s.parent_key,
               'kind', coalesce(s.c_marker, CASE WHEN s.refund_pair AND s.same_refund THEN 'reapplication' ELSE 'related' END),
               'score', s.score,
               'reasons', to_jsonb(array_remove(ARRAY[
                 CASE WHEN s.c_marker IS NOT NULL AND s.p_has_order
                      THEN CASE s.c_marker WHEN 'appeal' THEN 'an appeal' WHEN 'waiver' THEN 'an application for waiver' ELSE 'an application for rectification' END
                           || ', and the other case holds an order (' || coalesce(s.p_order_form, 'order') || ')' END,
                 CASE WHEN s.refund_pair AND s.same_refund THEN 'the same refund filed again: ' || s.c_rtype || ' for '
                        || to_char(to_date(s.c_pf, 'YYYY-MM'), 'Mon YYYY')
                        || CASE WHEN s.c_pt <> s.c_pf THEN ' to ' || to_char(to_date(s.c_pt, 'YYYY-MM'), 'Mon YYYY') ELSE '' END END,
                 CASE WHEN s.refund_pair AND NOT coalesce(s.same_refund, false)
                      THEN 'a refund of another ' || CASE WHEN s.c_rtype IS DISTINCT FROM s.p_rtype THEN 'type' ELSE 'period' END END,
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
                                THEN jsonb_build_object('sanctioned', s.o_sanctioned, 'rejected', s.o_rejected) END,
                 'refund_type', s.o_rtype, 'period_from', s.o_pf, 'period_to', s.o_pt)) AS j
        FROM points s
       WHERE s.score >= coalesce(p_min, 40)
       ORDER BY s.other_key, s.score DESC
    ) x
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_link_candidates(uuid, text, int) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.notice_case_link_candidates(uuid, text, int) IS
  'Cases of the client that may belong with this chain, each with a score and the reasons, best first; 40 and above is offered. Two refund applications only as the same refund filed again (same type, same period); refunds of another type or period are never offered (20261025150000).';
