-- Notices & Litigation load faster (the firm's request of 25 October 2026:
-- "pages are loading too much"). Same cases, same figures, same columns; each
-- part is worked out once instead of two or three times per read, and a read
-- of one client or one case reads only that client's notices:
--   * notice_case_correspondence resolves each case folder item's and each
--     application's case (notice_case_root) once, not three times;
--   * notice_cases and notice_cases_flat take the lead notice and the case's
--     figures in one pass (window aggregates), and the correspondence's figures
--     and latest paper in another, with no shared CTE, so a filter on client_id
--     (the case page, a client's cases) reaches notice_facts;
--   * ties are broken the same way every time where the pick used to depend on
--     the plan: the lead notice by id after the existing order (4 of 418 cases
--     had a tie), the latest paper by kind, then id (60 ties).
--   * notice_case_overview and notice_case_items name the client on their joins
--     to notice_facts, so the facts are read for that client only (the join on
--     id alone made the planner build every client's facts, ten times over in
--     the overview's loop). Their answers were compared on live: identical.
-- Measured on live before applying (418 cases, 1,344 papers; old → new):
--   Cases list (litigation, open)   346 → 173 ms
--   one case (the case page)        192 →  75 ms
--   one client's cases              192 →  77 ms
--   correspondence, all             132 →  95 ms
--   case overview                   418 →  87 ms
--   case counts (every Notices tab) 343 → 167 ms
-- Every figure was compared row by row (EXCEPT ALL) with the old views: none
-- differs; only the lead notice of the tied cases may be another of the tie.
-- Keep notice_cases and notice_cases_flat in step (test_114 compares their columns).

-- ── 1. Correspondence ──────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.notice_case_correspondence AS
WITH n AS MATERIALIZED (
  SELECT f.id, f.client_id, f.case_id, f.category, f.form_code, f.form_label, f.notice_type, f.reference_number,
         f.issue_date, f.first_seen_at, public.notice_case_key(f.client_id, f.case_id, f.category, f.id) AS case_key,
         public.notice_case_key(f.case_id, f.category, f.id) AS own_key
    FROM public.notice_facts f
), firsts AS (
  SELECT g.client_id, min(g.first_seen_at) AS first_at FROM public.gst_notices g GROUP BY g.client_id
), fi AS MATERIALIZED (
  -- 20261025200000: each folder item's case resolved once (notice_case_root was called three times an item).
  SELECT fi.*, public.notice_case_root(fi.client_id, fi.case_id) AS root
    FROM public.gst_case_folder_items fi
   WHERE fi.deleted_at IS NULL
), ap AS MATERIALIZED (
  SELECT a.*, upper(btrim(a.arn)) AS arn_key, public.notice_case_root(a.client_id, upper(btrim(a.arn))) AS root
    FROM public.gst_portal_applications a
   WHERE a.deleted_at IS NULL AND nullif(btrim(a.arn), '') IS NOT NULL
), items AS (
  SELECT n.client_id, n.case_key, 'notice'::text AS kind, n.id AS item_id, 'department'::text AS from_party,
         -- 20261014120000: the date on the notice; never the day it was synced.
         coalesce(n.issue_date, (SELECT public.notice_doc_date_ok(d.doc_date) FROM public.ai_documents d
                                  WHERE d.notice_id = n.id AND d.status = 'done' ORDER BY d.updated_at DESC LIMIT 1)) AS item_date, n.first_seen_at,
         coalesce(n.form_code || ' · ', '') || coalesce(n.form_label, n.notice_type, 'Notice') AS label,
         n.reference_number AS reference, NULL::text AS folder_section, n.own_key
    FROM n
  UNION ALL
  SELECT fi.client_id, fi.root, 'document', fi.id, public.notice_folder_from(fi.folder_section),
         -- 20261014120000: the date printed on the document (as the AI read it) first, then the portal's date; never the sync date.
         coalesce((SELECT public.notice_doc_date_ok(d.doc_date) FROM public.ai_documents d
                    WHERE d.folder_item_id = fi.id AND d.status = 'done' ORDER BY d.updated_at DESC LIMIT 1),
                  public.notice_folder_item_date(fi.raw_json)), fi.first_seen_at,
         -- 20261025140000: an appeal's own application is its APL-01.
         CASE WHEN upper(coalesce(fi.folder_section, '')) = 'APLCN' AND public.notice_is_appeal_form(fi.raw_json)
              THEN 'APL-01 · Appeal filed' || coalesce(' against ' || nullif(btrim(coalesce(fi.raw_json #>> '{orddtl,ordnum}', fi.raw_json #>> '{orddtl,dmdid}')), ''), '')
              ELSE public.notice_folder_label(fi.folder_section, fi.raw_json) END,
         fi.reference_number, fi.folder_section, fi.case_id
    FROM fi
   WHERE EXISTS (SELECT 1 FROM n WHERE n.client_id = fi.client_id AND n.case_key = fi.root)
     -- The folder's copy of a notice already listed is that notice, not another item
     -- (20261025140000: only a copy in the notice's own portal case, never an application or a reply).
     AND NOT EXISTS (SELECT 1 FROM n WHERE n.client_id = fi.client_id AND n.case_key = fi.root
                       AND n.reference_number IS NOT NULL AND n.reference_number = fi.reference_number
                       AND upper(coalesce(fi.folder_section, '')) NOT IN ('APLCN', 'REPLY', 'REPLIES')
                       AND (upper(n.own_key) = upper(btrim(fi.case_id)) OR n.own_key LIKE 'N:%' OR n.own_key = 'REG'))
  UNION ALL
  -- 20261024120000: an application filed on the portal that has no case folder
  -- or notice of its own yet (an appeal only submitted), in the case it is against.
  SELECT a.client_id, a.root, 'application', a.id, 'taxpayer',
         a.filed_date, a.first_seen_at,
         coalesce(nullif(btrim(regexp_replace(coalesce(a.form_number, ''), '^GST\s+', '', 'i')), '') || ' · ', '')
           || coalesce(a.status, CASE a.case_type_cd WHEN 'APPEL' THEN 'Appeal' WHEN 'ADJWS' THEN 'Waiver application' WHEN 'ADJRO' THEN 'Rectification application' ELSE 'Application' END),
         a.arn_key, 'APLCN', a.arn_key
    FROM ap a
   WHERE EXISTS (SELECT 1 FROM n WHERE n.client_id = a.client_id AND n.case_key = a.root)
     AND NOT EXISTS (SELECT 1 FROM n WHERE n.client_id = a.client_id AND n.own_key = a.arn_key)
     AND NOT EXISTS (SELECT 1 FROM fi WHERE fi.client_id = a.client_id AND upper(btrim(fi.case_id)) = a.arn_key)
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

-- ── 2. Cases, linked ───────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.notice_cases AS
WITH n AS (
  SELECT f.*, public.notice_case_key(f.client_id, f.case_id, f.category, f.id) AS case_key,
         CASE WHEN f.system_generated THEN 'other' ELSE public.notice_track(f.category) END AS track
    FROM public.notice_facts f
), nw AS (
  -- One pass over the case's notices: the lead (rn = 1) and the case's figures as
  -- window aggregates, so a read of one client or case reads only its notices.
  SELECT n.*,
         row_number() OVER (PARTITION BY n.client_id, n.case_key
                            ORDER BY n.is_open DESC, (CASE WHEN n.is_open THEN n.effective_due END) ASC NULLS LAST,
                                     n.issue_date DESC NULLS LAST, n.first_seen_at DESC, n.id) AS rn,
         count(*) OVER w AS a_notices,
         count(*) FILTER (WHERE n.is_open) OVER w AS a_open_notices,
         bool_and(n.is_replied) FILTER (WHERE n.is_open) OVER w AS a_all_replied,
         bool_or(n.is_open) OVER w AS a_is_open,
         bool_or(n.is_open AND n.is_overdue) OVER w AS a_is_overdue,
         bool_or(n.is_open AND n.is_due_in_7) OVER w AS a_is_due_in_7,
         bool_or(n.is_open AND n.is_unassigned) OVER w AS a_is_unassigned,
         min(n.effective_due) FILTER (WHERE n.is_open) OVER w AS a_next_due,
         min(n.hearing_date) FILTER (WHERE n.hearing_date >= n.today_ist) OVER w AS a_next_hearing,
         min(n.issue_date) OVER w AS a_first_issue_date,
         max(n.issue_date) OVER w AS a_last_issue_date,
         sum(n.exposure_amount) FILTER (WHERE n.is_open) OVER w AS a_exposure,
         max(n.amount_of_demand) OVER w AS a_amount_of_demand,
         array_agg(public.notice_fy_key(n.financial_year)) OVER w AS a_fys,
         array_agg(n.form_code) OVER w AS a_forms,
         bool_or(n.on_dashboard) OVER w AS a_on_dashboard,
         bool_or(n.track = 'litigation') OVER w AS t_lit, bool_or(n.track = 'refund') OVER w AS t_ref,
         bool_or(n.track = 'registration') OVER w AS t_reg
    FROM n
  WINDOW w AS (PARTITION BY n.client_id, n.case_key)
), lead AS (
  SELECT nw.*,
         (SELECT string_agg(DISTINCT x, ', ') FROM unnest(nw.a_fys) x) AS a_financial_years,
         (SELECT array_agg(DISTINCT x) FROM unnest(nw.a_forms) x WHERE x IS NOT NULL) AS a_forms_d,
         CASE WHEN nw.t_lit THEN 'litigation' WHEN nw.t_ref THEN 'refund' WHEN nw.t_reg THEN 'registration' ELSE 'other' END AS a_track
    FROM nw
   WHERE nw.rn = 1
), cc AS (
  -- 20261025200000: the correspondence read once, its figures and its latest paper together;
  -- papers of the same date and arrival break their tie the same way every time.
  SELECT DISTINCT ON (c.client_id, c.case_key) c.client_id, c.case_key, c.kind, c.label, c.from_party, c.item_date,
         count(*) FILTER (WHERE c.kind = 'document') OVER w AS documents,
         count(*) FILTER (WHERE c.is_new) OVER w AS new_items,
         max(c.first_seen_at) FILTER (WHERE c.is_new) OVER w AS new_at,
         max(c.first_seen_at) OVER w AS last_arrived_at,
         max(c.seen_at) OVER w AS seen_at
    FROM public.notice_case_correspondence c
  WINDOW w AS (PARTITION BY c.client_id, c.case_key)
   ORDER BY c.client_id, c.case_key, c.item_date DESC NULLS LAST, c.first_seen_at DESC, c.kind, c.item_id
)
SELECT
  l.client_id, l.client_name, l.client_gstin, l.case_key,
  CASE WHEN l.case_key LIKE 'N:%' OR l.case_key = 'REG' THEN NULL ELSE l.case_key END AS case_id,
  l.a_track AS track,
  CASE WHEN l.case_key = 'REG' THEN 'Registration' ELSE coalesce(l.form_label, l.notice_type, 'Notice') END AS title,
  l.id AS lead_notice_id, l.id, l.form_code, l.form_label, l.category, l.reference_number,
  l.stage, l.stage_label, l.stage_ord, l.assign_to, l.assign_to_user_id, l.effective_priority,
  coalesce(public.notice_fy_key(l.financial_year), split_part(l.a_financial_years, ', ', 1)) AS financial_year,
  l.a_financial_years AS financial_years, l.a_forms_d AS forms, l.a_notices::int AS notices, l.a_open_notices::int AS open_notices, l.a_is_open AS is_open,
  (coalesce(l.a_is_overdue, false) AND w.waiting_on = 'us') AS is_overdue, (coalesce(l.a_is_due_in_7, false) AND w.waiting_on = 'us') AS is_due_in_7,
  coalesce(l.a_is_unassigned, false) AS is_unassigned,
  l.a_next_due AS next_due, l.a_next_hearing AS next_hearing, l.a_first_issue_date AS first_issue_date, l.a_last_issue_date AS last_issue_date,
  coalesce(l.a_exposure, 0) AS exposure, l.a_amount_of_demand AS amount_of_demand, l.a_on_dashboard AS on_dashboard,
  coalesce(co.documents, 0)::int AS documents, coalesce(co.new_items, 0)::int AS new_items, co.new_at, co.last_arrived_at, co.seen_at,
  co.label AS latest_label, co.kind AS latest_kind, co.from_party AS latest_from, co.item_date AS latest_date,
  greatest(l.a_last_issue_date, co.item_date) AS last_activity_date,
  l.today_ist,
  w.waiting_on
FROM lead l
LEFT JOIN cc co ON co.client_id = l.client_id AND co.case_key = l.case_key
CROSS JOIN LATERAL (SELECT CASE
    WHEN NOT l.a_is_open THEN 'closed'
    WHEN l.stage IN ('filed', 'hearing', 'appeal') OR coalesce(l.a_all_replied, false) OR co.from_party = 'taxpayer' THEN 'department'
    ELSE 'us' END AS waiting_on) w;

-- ── 3. Cases, apart ────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.notice_cases_flat AS
WITH n AS (
  SELECT f.*, public.notice_case_key(f.case_id, f.category, f.id) AS case_key,
         CASE WHEN f.system_generated THEN 'other' ELSE public.notice_track(f.category) END AS track
    FROM public.notice_facts f
), nw AS (
  -- One pass over the case's notices: the lead (rn = 1) and the case's figures as
  -- window aggregates, so a read of one client or case reads only its notices.
  SELECT n.*,
         row_number() OVER (PARTITION BY n.client_id, n.case_key
                            ORDER BY n.is_open DESC, (CASE WHEN n.is_open THEN n.effective_due END) ASC NULLS LAST,
                                     n.issue_date DESC NULLS LAST, n.first_seen_at DESC, n.id) AS rn,
         count(*) OVER w AS a_notices,
         count(*) FILTER (WHERE n.is_open) OVER w AS a_open_notices,
         bool_and(n.is_replied) FILTER (WHERE n.is_open) OVER w AS a_all_replied,
         bool_or(n.is_open) OVER w AS a_is_open,
         bool_or(n.is_open AND n.is_overdue) OVER w AS a_is_overdue,
         bool_or(n.is_open AND n.is_due_in_7) OVER w AS a_is_due_in_7,
         bool_or(n.is_open AND n.is_unassigned) OVER w AS a_is_unassigned,
         min(n.effective_due) FILTER (WHERE n.is_open) OVER w AS a_next_due,
         min(n.hearing_date) FILTER (WHERE n.hearing_date >= n.today_ist) OVER w AS a_next_hearing,
         min(n.issue_date) OVER w AS a_first_issue_date,
         max(n.issue_date) OVER w AS a_last_issue_date,
         sum(n.exposure_amount) FILTER (WHERE n.is_open) OVER w AS a_exposure,
         max(n.amount_of_demand) OVER w AS a_amount_of_demand,
         array_agg(public.notice_fy_key(n.financial_year)) OVER w AS a_fys,
         array_agg(n.form_code) OVER w AS a_forms,
         bool_or(n.on_dashboard) OVER w AS a_on_dashboard,
         bool_or(n.track = 'litigation') OVER w AS t_lit, bool_or(n.track = 'refund') OVER w AS t_ref,
         bool_or(n.track = 'registration') OVER w AS t_reg
    FROM n
  WINDOW w AS (PARTITION BY n.client_id, n.case_key)
), lead AS (
  SELECT nw.*,
         (SELECT string_agg(DISTINCT x, ', ') FROM unnest(nw.a_fys) x) AS a_financial_years,
         (SELECT array_agg(DISTINCT x) FROM unnest(nw.a_forms) x WHERE x IS NOT NULL) AS a_forms_d,
         CASE WHEN nw.t_lit THEN 'litigation' WHEN nw.t_ref THEN 'refund' WHEN nw.t_reg THEN 'registration' ELSE 'other' END AS a_track
    FROM nw
   WHERE nw.rn = 1
), cc AS (
  -- 20261025200000: the correspondence read once, its figures and its latest paper together;
  -- papers of the same date and arrival break their tie the same way every time.
  SELECT DISTINCT ON (c.client_id, c.own_key) c.client_id, c.own_key AS case_key, c.kind, c.label, c.from_party, c.item_date,
         count(*) FILTER (WHERE c.kind = 'document') OVER w AS documents,
         count(*) FILTER (WHERE c.is_new) OVER w AS new_items,
         max(c.first_seen_at) FILTER (WHERE c.is_new) OVER w AS new_at,
         max(c.first_seen_at) OVER w AS last_arrived_at,
         max(c.seen_at) OVER w AS seen_at
    FROM public.notice_case_correspondence c
  WINDOW w AS (PARTITION BY c.client_id, c.own_key)
   ORDER BY c.client_id, c.own_key, c.item_date DESC NULLS LAST, c.first_seen_at DESC, c.kind, c.item_id
)
SELECT
  l.client_id, l.client_name, l.client_gstin, l.case_key,
  CASE WHEN l.case_key LIKE 'N:%' OR l.case_key = 'REG' THEN NULL ELSE l.case_key END AS case_id,
  l.a_track AS track,
  CASE WHEN l.case_key = 'REG' THEN 'Registration' ELSE coalesce(l.form_label, l.notice_type, 'Notice') END AS title,
  l.id AS lead_notice_id, l.id, l.form_code, l.form_label, l.category, l.reference_number,
  l.stage, l.stage_label, l.stage_ord, l.assign_to, l.assign_to_user_id, l.effective_priority,
  coalesce(public.notice_fy_key(l.financial_year), split_part(l.a_financial_years, ', ', 1)) AS financial_year,
  l.a_financial_years AS financial_years, l.a_forms_d AS forms, l.a_notices::int AS notices, l.a_open_notices::int AS open_notices, l.a_is_open AS is_open,
  (coalesce(l.a_is_overdue, false) AND w.waiting_on = 'us') AS is_overdue, (coalesce(l.a_is_due_in_7, false) AND w.waiting_on = 'us') AS is_due_in_7,
  coalesce(l.a_is_unassigned, false) AS is_unassigned,
  l.a_next_due AS next_due, l.a_next_hearing AS next_hearing, l.a_first_issue_date AS first_issue_date, l.a_last_issue_date AS last_issue_date,
  coalesce(l.a_exposure, 0) AS exposure, l.a_amount_of_demand AS amount_of_demand, l.a_on_dashboard AS on_dashboard,
  coalesce(co.documents, 0)::int AS documents, coalesce(co.new_items, 0)::int AS new_items, co.new_at, co.last_arrived_at, co.seen_at,
  co.label AS latest_label, co.kind AS latest_kind, co.from_party AS latest_from, co.item_date AS latest_date,
  greatest(l.a_last_issue_date, co.item_date) AS last_activity_date,
  l.today_ist,
  w.waiting_on,
  -- The chain this case belongs to (its root is itself when it is not linked).
  public.notice_case_root(l.client_id, l.case_key) AS root_key,
  lk.parent_key, lk.kind AS link_kind, lk.source AS link_source
FROM lead l
LEFT JOIN cc co ON co.client_id = l.client_id AND co.case_key = l.case_key
LEFT JOIN public.notice_case_links lk ON lk.client_id = l.client_id AND lk.child_key = l.case_key
CROSS JOIN LATERAL (SELECT CASE
    WHEN NOT l.a_is_open THEN 'closed'
    WHEN l.stage IN ('filed', 'hearing', 'appeal') OR coalesce(l.a_all_replied, false) OR co.from_party = 'taxpayer' THEN 'department'
    ELSE 'us' END AS waiting_on) w;

-- ── 4. A case's overview and papers read their client's facts only ─────────
-- As in 20261012100000 (overview) and 20261025140000 (items), each join to
-- notice_facts also naming p_client_id.
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
        -- 20261025140000: what the portal's own record of the item says (an appeal's order, amounts, pre-deposit,
        -- documents; a hearing's date and place; a due date).
        'facts', public.notice_case_item_facts(c.client_id, c.kind, c.item_id, c.own_key, c.reference),
        'stage', f.stage, 'stage_label', f.stage_label, 'is_open', f.is_open, 'pdf_url', g.pdf_url,
        -- A notice carries the files of its copy in the case folder (same reference).
        -- 20261025140000: its own case's copy only, never the appeal or reply that quotes it.
        'attachments', (SELECT coalesce(jsonb_agg(a), '[]'::jsonb)
                          FROM public.gst_case_folder_items fi
                          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(fi.attachments) = 'array' THEN fi.attachments ELSE '[]'::jsonb END) a
                         WHERE fi.deleted_at IS NULL
                           AND ((c.kind = 'document' AND fi.id = c.item_id)
                             OR (c.kind = 'notice' AND fi.client_id = c.client_id AND public.notice_case_root(fi.client_id, fi.case_id) = c.case_key AND fi.reference_number = c.reference
                                AND upper(coalesce(fi.folder_section, '')) NOT IN ('APLCN', 'REPLY', 'REPLIES')
                                AND (upper(btrim(fi.case_id)) = upper(c.own_key) OR c.own_key LIKE 'N:%' OR c.own_key = 'REG')))),
        'ai', (SELECT jsonb_build_object('title', d.title, 'summary', d.summary, 'doc_kind', d.doc_kind, 'outcome', d.outcome,
                                         'doc_date', d.doc_date, 'status', d.status, 'reason_class', d.reason_class,
                                         'usage', d.usage, 'model', d.model)
                 FROM public.ai_documents d
                WHERE (c.kind = 'document' AND d.folder_item_id = c.item_id)
                   OR (c.kind = 'notice' AND d.notice_id = c.item_id AND d.source = 'workspace')
                   OR (c.kind = 'notice' AND d.folder_item_id IN (
                         SELECT fi.id FROM public.gst_case_folder_items fi
                          WHERE fi.client_id = c.client_id AND public.notice_case_root(fi.client_id, fi.case_id) = c.case_key AND fi.reference_number = c.reference
                                AND upper(coalesce(fi.folder_section, '')) NOT IN ('APLCN', 'REPLY', 'REPLIES')
                                AND (upper(btrim(fi.case_id)) = upper(c.own_key) OR c.own_key LIKE 'N:%' OR c.own_key = 'REG') AND fi.deleted_at IS NULL))
                ORDER BY (d.status = 'done') DESC, (d.summary IS NOT NULL) DESC, d.sort_date DESC NULLS LAST
                LIMIT 1),
        'notice_read', CASE WHEN c.kind = 'notice' THEN
               (SELECT jsonb_build_object('status', x.status, 'outcome', x.outcome, 'summary', nullif(x.detail ->> 'summary', ''),
                                          'usage', x.usage, 'model', x.model)
                  FROM public.notice_extractions x WHERE x.notice_id = c.item_id AND x.source = 'ai'
                 ORDER BY x.created_at DESC LIMIT 1) END
      ) AS row
        FROM public.notice_case_correspondence c
        LEFT JOIN public.notice_facts f ON c.kind = 'notice' AND f.id = c.item_id AND f.client_id = p_client_id
        LEFT JOIN public.gst_notices g ON c.kind = 'notice' AND g.id = c.item_id
       WHERE c.client_id = p_client_id AND c.case_key = public.notice_case_root(p_client_id, p_case_key)
    ) x
$$;

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
          JOIN public.notice_facts f ON f.id = g.id AND f.client_id = p_client_id
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
            SELECT g.id FROM public.gst_notices g JOIN public.notice_facts f ON f.id = g.id AND f.client_id = p_client_id
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
                  FROM public.gst_notices g JOIN public.notice_facts f ON f.id = g.id AND f.client_id = p_client_id
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
GRANT EXECUTE ON FUNCTION public.notice_case_items(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notice_case_overview(uuid, text, uuid) TO anon, authenticated, service_role;
