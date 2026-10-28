-- Notices & Litigation: appeals against refund orders (the firm's request of
-- 28 October 2026: "there is no work on it in appeal in refunds"). The refund
-- page now carries the Appeal view, so the case's appeals say what a refund
-- order rejected: notice_case_appeals as in 20261026120000, with
--   * subject 'refund', refund_claimed and refund_rejected for an appeal
--     against an RFD-06 or RFD-07, read from the RFD-06's own record on the
--     portal (refund_order_amount, 20261027110000);
--   * an RFD-06 whose figures show it rejected nothing (sanctioned in full) no
--     longer offered as an appeal to file. One without figures still is.
-- Additive: one function replaced in place. §33 of
-- docs/NOTICES_LITIGATION_POSITIONS.md.

CREATE OR REPLACE FUNCTION public.notice_case_appeals(p_client_id uuid, p_case_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text := public.notice_case_root(p_client_id, p_case_key);
  v_out jsonb;
BEGIN
  WITH filed_raw AS (
    SELECT upper(btrim(fi.case_id)) AS arn, public.notice_folder_facts('APLCN', fi.raw_json) AS f, 1 AS pri
      FROM public.gst_case_folder_items fi
     WHERE fi.client_id = p_client_id AND fi.deleted_at IS NULL AND upper(coalesce(fi.folder_section, '')) = 'APLCN'
       AND public.notice_is_appeal_form(fi.raw_json) AND public.notice_case_root(fi.client_id, fi.case_id) = v_key
    UNION ALL
    SELECT upper(btrim(a.arn)),
           coalesce(public.notice_folder_facts('APLCN', public.notice_try_jsonb(a.raw_json #>> '{appItem,itemJson}')), '{}'::jsonb)
             || jsonb_strip_nulls(jsonb_build_object('portal_status', a.status, 'filed_on', a.filed_date,
                  'order_ref', nullif(btrim(a.raw_json #>> '{appItem,refId}'), ''))), 2
      FROM public.gst_portal_applications a
     WHERE a.client_id = p_client_id AND a.deleted_at IS NULL AND a.case_type_cd = 'APPEL' AND nullif(btrim(a.arn), '') IS NOT NULL
       AND public.notice_case_root(a.client_id, upper(btrim(a.arn))) = v_key
    UNION ALL
    -- 20261026120000: a Tribunal appeal staff recorded against an APL-04 of this case.
    SELECT coalesce(t.arn, 'GSTAT:' || t.order_ref),
           jsonb_strip_nulls(jsonb_build_object('order_ref', t.order_ref, 'filed_on', t.filed_on, 'predeposit', t.predeposit,
             'second_appeal', true, 'forum', 'tribunal',
             'portal_status', CASE t.status WHEN 'withdrawn' THEN 'Appeal Withdrawn' WHEN 'decided' THEN 'Disposed' ELSE 'Filed before the Tribunal' END)), 0
      FROM public.notice_tribunal_appeals t
     WHERE t.client_id = p_client_id
       AND EXISTS (SELECT 1 FROM public.notice_facts n WHERE n.client_id = p_client_id AND upper(btrim(n.reference_number)) = t.order_ref
                     AND public.notice_case_key(n.client_id, n.case_id, n.category, n.id) = v_key)
  ), filed AS (
    SELECT arn,
           (SELECT f FROM filed_raw r WHERE r.arn = x.arn AND r.f ? 'order_ref' ORDER BY r.pri LIMIT 1) AS f,
           (SELECT r.f ->> 'portal_status' FROM filed_raw r WHERE r.arn = x.arn AND r.f ? 'portal_status' ORDER BY r.pri LIMIT 1) AS portal_status,
           (SELECT min((r.f ->> 'filed_on')::date) FROM filed_raw r WHERE r.arn = x.arn) AS filed_on
      FROM (SELECT DISTINCT arn FROM filed_raw) x
  ), appeals AS (
    SELECT upper(btrim(f ->> 'order_ref')) AS appeal_key, 'filed'::text AS status, arn, filed_on, portal_status, f
      FROM filed WHERE nullif(btrim(f ->> 'order_ref'), '') IS NOT NULL
    UNION ALL
    (SELECT DISTINCT ON (upper(btrim(n.reference_number))) upper(btrim(n.reference_number)), 'to_file', NULL, NULL, NULL,
           jsonb_strip_nulls(jsonb_build_object('order_ref', btrim(n.reference_number), 'order_date', n.issue_date))
      FROM public.notice_facts n
     WHERE n.client_id = p_client_id AND public.notice_case_key(n.client_id, n.case_id, n.category, n.id) = v_key
       AND n.form_code = ANY (public.notice_appealable_forms()) AND nullif(btrim(n.reference_number), '') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM filed WHERE upper(btrim(filed.f ->> 'order_ref')) = upper(btrim(n.reference_number)))
     ORDER BY upper(btrim(n.reference_number)), n.issue_date DESC NULLS LAST)
  )
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'appeal_key', a.appeal_key, 'status', a.status, 'arn', a.arn, 'filed_on', a.filed_on, 'portal_status', a.portal_status,
           'order_ref', a.f ->> 'order_ref',
           -- P5: how long a filed appeal has been pending.
           'pending_days', CASE WHEN a.status = 'filed' AND a.filed_on IS NOT NULL THEN public.ist_today() - a.filed_on END,
           'order_date', coalesce((a.f ->> 'order_date')::date, o.issue_date),
           'order_comm_date', (a.f ->> 'order_comm_date')::date,
           'order_form', o.form_code, 'order_notice_id', o.id,
           'forum', CASE WHEN o.form_code = 'APL-04' OR a.f ->> 'forum' = 'tribunal' THEN 'tribunal' ELSE 'appellate authority' END,
           'last_day', CASE WHEN o.form_code = 'APL-04'
                              AND coalesce((a.f ->> 'order_comm_date')::date, (a.f ->> 'order_date')::date, o.issue_date) < DATE '2026-04-01'
                            -- Tribunal backlog: orders communicated before 1 Apr 2026 could be appealed until 30 Jun 2026.
                            THEN greatest((coalesce((a.f ->> 'order_comm_date')::date, (a.f ->> 'order_date')::date, o.issue_date) + interval '3 months')::date, DATE '2026-06-30')
                            ELSE (coalesce((a.f ->> 'order_comm_date')::date, (a.f ->> 'order_date')::date, o.issue_date) + interval '3 months')::date END,
           'condonation_months', CASE WHEN o.form_code = 'APL-04' THEN coalesce(public.litigation_rule_value('condonation_months.s112'), 3)::int ELSE 1 END,
           'disputed_tax', a.f -> 'disputed_tax', 'disputed_total', a.f -> 'disputed_total',
           'predeposit', a.f -> 'predeposit', 'predeposit_pct', a.f -> 'predeposit_pct',
           'second_appeal', a.f -> 'second_appeal', 'issues', a.f -> 'issues',
           'demand', o.amount_of_demand,
           -- 20261028100000: an appeal against a refund order, with what the order rejected.
           'subject', CASE WHEN o.form_code IN ('RFD-06', 'RFD-07') THEN 'refund' END,
           'refund_claimed', nullif(rf.claimed, 0), 'refund_rejected', nullif(rf.rejected, 0),
           'drafts', (SELECT jsonb_object_agg(d.doc_type, jsonb_build_object('version', d.version, 'status', d.status, 'source', d.source,
                                                                              'at', d.created_at, 'by', d.author_name))
                        FROM (SELECT DISTINCT ON (doc_type) * FROM public.notice_appeal_drafts dd
                               WHERE dd.client_id = p_client_id AND dd.appeal_key = a.appeal_key
                               ORDER BY doc_type, version DESC) d)))
           ORDER BY (a.status = 'filed') DESC, a.filed_on DESC NULLS LAST, a.appeal_key)
    INTO v_out
    FROM appeals a
    LEFT JOIN LATERAL (SELECT g.id, g.form_code, g.issue_date, g.amount_of_demand FROM public.gst_notices g
                        WHERE g.client_id = p_client_id AND g.deleted_at IS NULL AND upper(btrim(g.reference_number)) = a.appeal_key
                        ORDER BY g.issue_date DESC NULLS LAST LIMIT 1) o ON true
    LEFT JOIN LATERAL (SELECT public.refund_order_rejects(fi.raw_json) AS rejects,
                              jsonb_typeof(fi.raw_json -> 'sdtls' -> 'sancordervo' -> 'sancamtdtl') = 'object' AS has_figures,
                              public.refund_order_amount(fi.raw_json -> 'sdtls' -> 'sancordervo', 'clmamt') AS claimed,
                              public.refund_order_amount(fi.raw_json -> 'sdtls' -> 'sancordervo', 'inadmamt') AS rejected
                         FROM public.gst_case_folder_items fi
                        WHERE o.form_code = 'RFD-06' AND fi.client_id = p_client_id AND fi.deleted_at IS NULL
                          AND upper(btrim(fi.reference_number)) = a.appeal_key
                          AND jsonb_typeof(fi.raw_json -> 'sdtls' -> 'sancordervo') = 'object'
                        ORDER BY fi.last_seen_at DESC NULLS LAST LIMIT 1) rf ON true
   -- A sanction order that rejects nothing (its own figures say so) is not appealed.
   WHERE NOT (a.status = 'to_file' AND coalesce(rf.has_figures, false) AND NOT coalesce(rf.rejects, false));
  RETURN coalesce(v_out, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.notice_case_appeals(uuid, text) IS
  'The case''s appeals (filed, or orders an appeal still lies against), each keyed by the order; refund orders carry what they rejected and a full sanction is not offered (20261028100000).';
