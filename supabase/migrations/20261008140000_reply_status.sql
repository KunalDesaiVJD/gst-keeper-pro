-- Notices Phase 4 · Reply Factory I, part 5: the numbers (roadmap Phase 4
-- acceptance). Read docs/REPLY_FACTORY_POSITIONS.md §9 for the definitions.
--
--   reply_factory_status() → coverage of due dates with their source, the
--   automatic-annexure share of the four target forms, how the notice reader
--   fared against people's verifications, the readers' output, and document
--   request ageing — every count a list in the app can reproduce.

CREATE OR REPLACE FUNCTION public.reply_factory_status()
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cov AS (SELECT * FROM public.notice_due_coverage()),
  target AS (
    SELECT f.id, f.form_code,
           EXISTS (SELECT 1 FROM public.reply_annexures a
                    WHERE a.notice_id = f.id AND a.is_current AND a.status IN ('ready', 'partial')) AS has_annexure,
           EXISTS (SELECT 1 FROM public.reply_annexures a
                    WHERE a.notice_id = f.id AND a.status IN ('ready', 'partial') AND a.generated_by_name = 'Auto') AS auto_annexure,
           EXISTS (SELECT 1 FROM public.reply_annexures a
                    WHERE a.notice_id = f.id AND a.is_current AND a.status = 'needs_data') AS needs_data
      FROM public.notice_facts f
     WHERE f.is_open AND f.form_code IN ('ASMT-10', 'DRC-01A', 'DRC-01B', 'DRC-01C')
  ),
  ai_fields AS (
    SELECT g.id, e.key AS field, e.value AS rf, g.demand_total
      FROM public.gst_notices g
      CROSS JOIN LATERAL jsonb_each(g.read_fields) e
     WHERE g.deleted_at IS NULL AND e.value ->> 'source' = 'ai' AND coalesce((e.value ->> 'verified')::boolean, false)
  ),
  reqs AS (
    SELECT q.*, (now() - q.requested_at) AS age
      FROM public.notice_doc_requests q JOIN public.gst_notices g ON g.id = q.notice_id AND g.deleted_at IS NULL
  )
  SELECT jsonb_build_object(
    'due_coverage', jsonb_build_object(
      'open', (SELECT count(*) FROM cov),
      'covered', (SELECT count(*) FROM cov WHERE kind <> 'missing'),
      'share', (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE round(100.0 * count(*) FILTER (WHERE kind <> 'missing') / count(*), 1) END FROM cov),
      'by_kind', (SELECT coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) FROM (SELECT kind, count(*) n FROM cov GROUP BY kind) x),
      'by_source', (SELECT coalesce(jsonb_object_agg(coalesce(source, 'none'), n), '{}'::jsonb) FROM (SELECT source, count(*) n FROM cov GROUP BY source) y),
      'missing_by_form', (SELECT coalesce(jsonb_object_agg(coalesce(form_code, '(unknown)'), n), '{}'::jsonb)
                            FROM (SELECT form_code, count(*) n FROM cov WHERE kind = 'missing' GROUP BY form_code) z)),
    'annexures', jsonb_build_object(
      'target_open', (SELECT count(*) FROM target),
      'with_annexure', (SELECT count(*) FROM target WHERE has_annexure),
      'automatic', (SELECT count(*) FROM target WHERE auto_annexure),
      'needs_data', (SELECT count(*) FROM target WHERE needs_data AND NOT has_annexure),
      'share_automatic', (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE round(100.0 * count(*) FILTER (WHERE auto_annexure) / count(*), 1) END FROM target),
      'by_form', (SELECT coalesce(jsonb_object_agg(form_code, jsonb_build_object('open', n, 'automatic', a)), '{}'::jsonb)
                    FROM (SELECT form_code, count(*) n, count(*) FILTER (WHERE auto_annexure) a FROM target GROUP BY form_code) w)),
    'reading', jsonb_build_object(
      'portal_read', (SELECT count(*) FROM public.notice_extractions x WHERE x.source = 'portal'),
      'portal_applied', (SELECT count(*) FROM public.notice_extractions x WHERE x.source = 'portal' AND x.outcome = 'applied'),
      'issues_portal', (SELECT count(*) FROM public.notice_issues i WHERE i.source = 'portal'),
      'issues_form', (SELECT count(*) FROM public.notice_issues i WHERE i.source = 'form'),
      'issues_extracted', (SELECT count(*) FROM public.notice_issues i WHERE i.source = 'extracted'),
      'issues_unverified', (SELECT count(*) FROM public.notice_issues i WHERE NOT i.verified),
      'ai_done', (SELECT count(*) FROM public.notice_extractions x WHERE x.source = 'ai' AND x.status = 'done'),
      'ai_outcomes', (SELECT coalesce(jsonb_object_agg(coalesce(outcome, status), n), '{}'::jsonb)
                        FROM (SELECT outcome, status, count(*) n FROM public.notice_extractions WHERE source = 'ai' GROUP BY 1, 2) o)),
    'accuracy', jsonb_build_object(
      'due_date_verified', (SELECT count(*) FROM ai_fields WHERE field = 'due_date'),
      'due_date_exact', (SELECT count(*) FROM ai_fields WHERE field = 'due_date' AND rf ->> 'result' = 'confirmed'),
      'demand_verified', (SELECT count(*) FROM ai_fields WHERE field = 'demand'),
      'demand_within_1', (SELECT count(*) FROM ai_fields WHERE field = 'demand'
                            AND (rf ->> 'result' = 'confirmed'
                                 OR abs(public.reply_demand_total(rf -> 'value') - coalesce(demand_total, 0)) <= 1)),
      'fields_verified', (SELECT count(*) FROM ai_fields),
      'fields_confirmed', (SELECT count(*) FROM ai_fields WHERE rf ->> 'result' = 'confirmed'),
      'fields_rejected', (SELECT count(*) FROM ai_fields WHERE rf ->> 'result' = 'rejected')),
    'documents', jsonb_build_object(
      'open', (SELECT count(*) FROM reqs WHERE status = 'requested'),
      'open_over_7_days', (SELECT count(*) FROM reqs WHERE status = 'requested' AND age > interval '7 days'),
      'received_90d', (SELECT count(*) FROM reqs WHERE status = 'received' AND resolved_at >= now() - interval '90 days'),
      'via_portal_90d', (SELECT count(*) FROM reqs WHERE client_uploaded_at >= now() - interval '90 days'),
      'median_days_to_receive', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - requested_at) / 86400.0))::numeric, 1)
                                   FROM reqs WHERE status = 'received' AND resolved_at >= now() - interval '90 days'),
      'from_catalogue', (SELECT count(*) FROM reqs WHERE source = 'catalogue')),
    'ai', public.ai_read_status(),
    'server_time', now())
$$;
GRANT EXECUTE ON FUNCTION public.reply_factory_status() TO anon, authenticated, service_role;
