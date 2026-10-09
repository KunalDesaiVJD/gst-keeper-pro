-- Notices · one case per issue, a dashboard per kind, and an overview the AI keeps
-- filled (the firm's request of 9 October 2026: "categorise all these notices and
-- create different dashboard view for every single issue … on main dashboard, all
-- notices are not required to be displayed instead a central issue to be displayed
-- and all the correspondence inside that should be merged but user should be aware
-- of when any notice or documents comes up from the department or uploaded by the
-- officer … on any single client AI needs to review all the documents & keep
-- updating the basic overview").
--
-- 1. Kinds (notice_track): every notice category belongs to one of four
--    dashboards: litigation (notices and demands: DRC, ASMT, audit, enforcement,
--    recovery, appeal, rectification), refund, registration and other (LUT,
--    voluntary payments, approvals).
-- 2. Cases (notice_case_key, view notice_cases): a notice's case is its portal
--    case ID; registration correspondence, which the portal files under no case,
--    is one case per client ("REG"); a notice with neither is its own case
--    ("N:<id>"). A case's kind is the most serious kind among its notices.
--    Its correspondence is its notices and every document in its portal case
--    folder (notice_case_items), each marked as from the department or from the
--    taxpayer. Anything that arrived on a later sync than the client's first, in
--    the last 30 days, and after someone last opened the case
--    (notice_case_seen), is new.
-- 3. The overview (notice_case_overview): section, financial year, tax period,
--    DIN, reply due, hearing, officer and demand, each taken from the notice
--    itself, else the case's other notices, else what the AI read in the case's
--    documents (ai_documents.overview, new; the reader returns it from now on),
--    with where each value came from.
-- 4. The AI reads every client's documents (ai_settings.consent_scope =
--    'all_clients', as the firm asked), and work cancelled for want of consent is
--    queued again whenever consent is given or the scope widens: before this, a
--    client whose consent was recorded after its documents were registered never
--    had them read.
--
-- Objects: notice_track(), notice_case_key(), notice_folder_from(),
-- notice_folder_item_date(), notice_folder_label(), notice_case_seen (+ RLS open to
-- public), notice_case_mark_seen(), view notice_cases, notice_case_items(),
-- notice_case_overview(), notice_cases_counts(), ai_documents.overview,
-- ai_document_finish() (stores the overview), ai_requeue_consent() + triggers on
-- clients and ai_settings.

-- ── 1. Kinds ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_track(p_category text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_category = 'Refunds' THEN 'refund'
    WHEN p_category = 'Registration' THEN 'registration'
    WHEN p_category IS NULL OR p_category IN ('LUT', 'Voluntary Payment', 'Others') THEN 'other'
    ELSE 'litigation' END
$$;
COMMENT ON FUNCTION public.notice_track(text) IS
  'Which dashboard a notice category belongs to: litigation (notices and demands), refund, registration or other.';

-- ── 2. Cases ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_case_key(p_case_id text, p_category text, p_id uuid)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT coalesce(nullif(btrim(p_case_id), ''),
                  CASE WHEN p_category = 'Registration' THEN 'REG' ELSE 'N:' || p_id::text END)
$$;
COMMENT ON FUNCTION public.notice_case_key(text, text, uuid) IS
  'A notice''s case within its client: the portal case ID, else REG for registration correspondence, else N:<notice id>.';

-- Who filed a case folder section: the department (notices, intimations, orders,
-- closures, recovery) or the taxpayer (replies, applications).
CREATE OR REPLACE FUNCTION public.notice_folder_from(p_section text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE WHEN upper(coalesce(p_section, '')) IN ('REPLY', 'REPLIES', 'APLCN') THEN 'taxpayer' ELSE 'department' END
$$;

-- A case folder item's own date, from whichever key its sub-type carries.
CREATE OR REPLACE FUNCTION public.notice_folder_item_date(p_raw jsonb)
RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT coalesce(
    public.notices_parse_portal_date(p_raw ->> 'refdt'), public.notices_parse_portal_date(p_raw ->> 'ntcdt'),
    public.notices_parse_portal_date(p_raw ->> 'ntcDt'), public.notices_parse_portal_date(p_raw ->> 'replydt'),
    public.notices_parse_portal_date(p_raw ->> 'arndt'), public.notices_parse_portal_date(p_raw ->> 'arnGenDate'),
    public.notices_parse_portal_date(p_raw ->> 'rfdSubDt'), public.notices_parse_portal_date(p_raw ->> 'lutfiledt'),
    public.notices_parse_portal_date(p_raw ->> 'crndt'), public.notices_parse_portal_date(p_raw ->> 'insertTimeStamp'))
$$;

CREATE OR REPLACE FUNCTION public.notice_folder_label(p_section text, p_raw jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE upper(coalesce(p_section, ''))
           WHEN 'NOTCE' THEN 'Notice' WHEN 'NOTAC' THEN 'Notice or acknowledgement' WHEN 'INTIM' THEN 'Intimation'
           WHEN 'ORDRS' THEN 'Order' WHEN 'CLSR' THEN 'Closure' WHEN 'CLOSR' THEN 'Closure' WHEN 'DRC7A' THEN 'Recovery order'
           WHEN 'RTAUD' THEN 'Audit' WHEN 'REPLY' THEN 'Reply' WHEN 'APLCN' THEN 'Application'
           ELSE 'Document' END
         || coalesce(' ' || nullif(btrim(coalesce(p_raw ->> 'formNo', p_raw ->> 'ntcNo', p_raw ->> 'refid', p_raw ->> 'refId',
                                                   p_raw ->> 'arn', p_raw ->> 'applnAckNum', '')), ''), '')
$$;

-- When someone last opened a case (the whole firm's view: one row per case).
CREATE TABLE IF NOT EXISTS public.notice_case_seen (
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  case_key     text NOT NULL,
  seen_at      timestamptz NOT NULL DEFAULT now(),
  seen_by_name text,
  PRIMARY KEY (client_id, case_key)
);
COMMENT ON TABLE public.notice_case_seen IS
  'When someone last opened a notice case: correspondence that arrived before it is no longer new.';
ALTER TABLE public.notice_case_seen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notice_case_seen_all ON public.notice_case_seen;
CREATE POLICY notice_case_seen_all ON public.notice_case_seen FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notice_case_seen TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notice_case_mark_seen(p_client_id uuid, p_case_key text, p_by_name text DEFAULT NULL)
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.notice_case_seen (client_id, case_key, seen_at, seen_by_name)
  VALUES (p_client_id, p_case_key, now(), left(p_by_name, 120))
  ON CONFLICT (client_id, case_key) DO UPDATE SET seen_at = excluded.seen_at, seen_by_name = excluded.seen_by_name
  RETURNING seen_at
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_mark_seen(uuid, text, text) TO anon, authenticated, service_role;

-- Every item of correspondence of the cases in notice_facts (so hidden types and
-- clients not handled stay out), with whether it is new.
CREATE OR REPLACE VIEW public.notice_case_correspondence AS
WITH n AS (
  SELECT f.id, f.client_id, f.case_id, f.category, f.form_code, f.form_label, f.notice_type, f.reference_number,
         f.issue_date, f.first_seen_at, public.notice_case_key(f.case_id, f.category, f.id) AS case_key
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
  SELECT fi.client_id, fi.case_id, 'document', fi.id, public.notice_folder_from(fi.folder_section),
         coalesce(public.notice_folder_item_date(fi.raw_json), (fi.first_seen_at AT TIME ZONE 'Asia/Kolkata')::date), fi.first_seen_at,
         public.notice_folder_label(fi.folder_section, fi.raw_json), fi.reference_number, fi.folder_section
    FROM public.gst_case_folder_items fi
   WHERE fi.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM n WHERE n.client_id = fi.client_id AND n.case_key = fi.case_id)
     -- The folder's copy of a notice already listed is that notice, not another item.
     AND NOT EXISTS (SELECT 1 FROM n WHERE n.client_id = fi.client_id AND n.case_key = fi.case_id
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
  SELECT f.*, public.notice_case_key(f.case_id, f.category, f.id) AS case_key, public.notice_track(f.category) AS track
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

-- A case's correspondence, newest first, with what the AI read in each document.
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
                             OR (c.kind = 'notice' AND fi.client_id = c.client_id AND fi.case_id = c.case_key AND fi.reference_number = c.reference))),
        'ai', (SELECT jsonb_build_object('title', d.title, 'summary', d.summary, 'doc_kind', d.doc_kind, 'outcome', d.outcome,
                                         'doc_date', d.doc_date, 'status', d.status, 'reason_class', d.reason_class)
                 FROM public.ai_documents d
                WHERE (c.kind = 'document' AND d.folder_item_id = c.item_id)
                   OR (c.kind = 'notice' AND d.notice_id = c.item_id AND d.source = 'workspace')
                   OR (c.kind = 'notice' AND d.folder_item_id IN (
                         SELECT fi.id FROM public.gst_case_folder_items fi
                          WHERE fi.client_id = c.client_id AND fi.case_id = c.case_key AND fi.reference_number = c.reference AND fi.deleted_at IS NULL))
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
       WHERE c.client_id = p_client_id AND c.case_key = p_case_key
    ) x
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_items(uuid, text) TO anon, authenticated, service_role;

-- ── 3. What the AI reads into the overview ─────────────────────────────────
ALTER TABLE public.ai_documents ADD COLUMN IF NOT EXISTS overview jsonb;
COMMENT ON COLUMN public.ai_documents.overview IS
  'The case facts the AI read in this document (section_of_law, financial_year, period_from, period_to, din, reply_due, hearing_date, hearing_time, hearing_venue, officer, demand_tax, demand_interest, demand_penalty, demand_total; for refunds refund_claimed, refund_provisional, refund_sanctioned, refund_rejected, refund_net_payable, refund_paid; for registration application_type, application_arn, application_date; "" when not stated). notice_case_overview fills a notice''s blanks from it.';

-- The case's overview: each fact from the notice itself (p_notice_id), else the
-- case's other notices (newest first), else the AI's reading of the case's
-- documents (newest first), with its source.
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
         WHERE g.client_id = p_client_id AND public.notice_case_key(g.case_id, f.category, g.id) = p_case_key
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
             AND (d.case_id = p_case_key OR (p_case_key LIKE 'N:%' AND d.notice_id::text = substr(p_case_key, 3)))
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
   WHERE a.client_id = p_client_id AND a.case_id = p_case_key AND a.deleted_at IS NULL AND a.folder_section = 'APLCN'
     AND coalesce(a.raw_json ->> 'formNo', '') ILIKE '%RFD-01%'
   ORDER BY a.first_seen_at DESC
   LIMIT 1;
  FOREACH k IN ARRAY ARRAY['refund_provisional', 'refund_sanctioned', 'refund_rejected', 'refund_net_payable', 'refund_paid', 'refund_claimed'] LOOP
    SELECT jsonb_build_object('value', (d.overview ->> k)::numeric, 'document_id', d.id, 'label', coalesce(nullif(d.title, ''), d.label), 'date', d.doc_date)
      INTO v_val
      FROM public.ai_documents d
     WHERE d.client_id = p_client_id AND d.status = 'done' AND d.case_id = p_case_key
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
     AND (d.case_id = p_case_key OR (p_case_key = 'REG' AND d.notice_id IN (
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
                 WHERE g.client_id = p_client_id AND public.notice_case_key(g.case_id, f.category, g.id) = p_case_key AND g.form_code IS NOT NULL
                UNION
                SELECT upper(m[1]) || '-' || lpad(m[2], 2, '0')
                  FROM public.gst_case_folder_items fi
                  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(fi.attachments) = 'array' THEN fi.attachments ELSE '[]'::jsonb END) a
                  CROSS JOIN LATERAL regexp_matches(coalesce(a ->> 'label', '') || ' ' || coalesce(a ->> 'url', ''), '(RFD|REG|DRC|ASMT|ADT|APL)[-_ ]?(\d{1,2})', 'gi') m
                 WHERE fi.client_id = p_client_id AND fi.case_id = p_case_key AND fi.deleted_at IS NULL
                UNION
                SELECT upper(replace(replace(fi.raw_json ->> 'formNo', 'GST ', ''), ' ', '-'))
                  FROM public.gst_case_folder_items fi
                 WHERE fi.client_id = p_client_id AND fi.case_id = p_case_key AND fi.deleted_at IS NULL AND fi.raw_json ? 'formNo') x
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
                   AND (d.case_id = p_case_key OR (p_case_key LIKE 'N:%' AND d.notice_id::text = substr(p_case_key, 3)))),
    'summaries', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                     'document_id', d.id, 'title', d.title, 'summary', d.summary, 'doc_kind', d.doc_kind, 'outcome', d.outcome,
                     'date', d.doc_date, 'from', public.notice_folder_from(d.folder_section))
                     ORDER BY d.doc_date DESC NULLS LAST, d.finished_at DESC), '[]'::jsonb)
                    FROM (SELECT DISTINCT ON (coalesce(d0.document_sha256, d0.id::text)) d0.*
                            FROM public.ai_documents d0
                           WHERE d0.client_id = p_client_id AND d0.status = 'done' AND nullif(d0.summary, '') IS NOT NULL
                             AND (d0.case_id = p_case_key OR (p_case_key LIKE 'N:%' AND d0.notice_id::text = substr(p_case_key, 3)))
                           ORDER BY coalesce(d0.document_sha256, d0.id::text), d0.finished_at DESC) d));
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_overview(uuid, text, uuid) TO anon, authenticated, service_role;

-- Each dashboard's figures, under the master filters (on the case's lead notice).
CREATE OR REPLACE FUNCTION public.notice_cases_counts(p_filters jsonb DEFAULT NULL)
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
               'exposure', coalesce(sum(c.exposure), 0)) AS counts
        FROM public.notice_cases c
       WHERE public.notice_master_match(p_filters, c.client_id, c.financial_year, c.assign_to_user_id, c.form_code, c.effective_priority)
       GROUP BY c.track
    ) t
$$;
GRANT EXECUTE ON FUNCTION public.notice_cases_counts(jsonb) TO anon, authenticated, service_role;

-- ai_document_finish as in 20261009100000_ai_assistant.sql, now keeping the
-- overview the reader returns (p_result.overview).
CREATE OR REPLACE FUNCTION public.ai_document_finish(
  p_document_id uuid, p_agent text, p_status text, p_result jsonb DEFAULT NULL, p_usage jsonb DEFAULT NULL,
  p_error text DEFAULT NULL, p_reason_class text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d     public.ai_documents;
  v_s     public.ai_settings;
  v_cost  numeric;
  v_pairs int := 0;
  v_form  text;
  v_sec   text;
  v_fy    text;
  e       jsonb;
  v_nid   uuid;
BEGIN
  SELECT * INTO v_d FROM public.ai_documents WHERE id = p_document_id FOR UPDATE;
  IF v_d.id IS NULL THEN RETURN jsonb_build_object('error', 'gone'); END IF;
  IF v_d.status <> 'running' OR v_d.agent_id IS DISTINCT FROM p_agent THEN RETURN jsonb_build_object('error', 'not_yours'); END IF;
  SELECT * INTO v_s FROM public.ai_settings WHERE id;

  IF p_usage IS NOT NULL AND p_usage ? 'input_tokens' THEN
    v_cost := round((coalesce((p_usage ->> 'input_tokens')::numeric, 0) * v_s.price_in_per_mtok
                   + coalesce((p_usage ->> 'output_tokens')::numeric, 0) * v_s.price_out_per_mtok) / 1000000, 4);
    INSERT INTO public.ai_audit_log (purpose, notice_id, client_id, model, input_tokens, output_tokens, cost_usd,
                                     document_sha256, request_id, duration_ms, status, error, agent_id, requested_by_name)
    VALUES ('doc_read', v_d.notice_id, v_d.client_id, coalesce(p_result ->> 'model', p_usage ->> 'model', v_s.model),
            (p_usage ->> 'input_tokens')::int, (p_usage ->> 'output_tokens')::int, v_cost,
            coalesce(p_result ->> 'document_sha256', v_d.document_sha256), p_usage ->> 'request_id', (p_usage ->> 'duration_ms')::int,
            CASE WHEN p_usage ->> 'status' IN ('ok', 'refused', 'error') THEN p_usage ->> 'status' ELSE 'ok' END,
            left(p_error, 500), p_agent, NULL);
  END IF;

  IF p_status = 'retry' THEN
    IF v_d.attempts >= 3 THEN
      UPDATE public.ai_documents SET status = 'failed', error = left(p_error, 1000), reason_class = coalesce(p_reason_class, 'error'),
             finished_at = now(), agent_id = NULL, usage = coalesce(p_usage, usage)
       WHERE id = v_d.id;
      RETURN jsonb_build_object('status', 'failed');
    END IF;
    UPDATE public.ai_documents SET status = 'queued', agent_id = NULL, claimed_at = NULL,
           not_before = now() + make_interval(mins => 5 * power(2, greatest(v_d.attempts - 1, 0))::int),
           error = left(p_error, 1000), reason_class = p_reason_class
     WHERE id = v_d.id;
    RETURN jsonb_build_object('status', 'queued');
  ELSIF p_status IN ('failed', 'skipped', 'cancelled') THEN
    UPDATE public.ai_documents SET status = p_status, error = left(p_error, 1000), reason_class = p_reason_class,
           finished_at = now(), agent_id = NULL, usage = coalesce(p_usage, usage),
           pages = coalesce((p_result ->> 'pages')::int, pages),
           document_sha256 = coalesce(p_result ->> 'document_sha256', document_sha256)
     WHERE id = v_d.id;
    RETURN jsonb_build_object('status', p_status);
  ELSIF p_status IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'ai_document_finish: unknown status %', p_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.ai_documents SET
    status = 'done', finished_at = now(), agent_id = NULL, error = NULL, reason_class = NULL,
    model = coalesce(p_result ->> 'model', v_s.model),
    usage = coalesce(p_usage, '{}'::jsonb) || jsonb_build_object('cost_usd', v_cost),
    doc_kind = left(p_result ->> 'doc_kind', 40), title = left(p_result ->> 'title', 300), summary = left(p_result ->> 'summary', 2000),
    doc_date = CASE WHEN coalesce(p_result ->> 'doc_date', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (p_result ->> 'doc_date')::date END,
    reference = left(p_result ->> 'reference', 120), outcome = left(nullif(p_result ->> 'outcome', ''), 40),
    paragraphs = CASE WHEN jsonb_typeof(p_result -> 'paragraphs') = 'array' THEN p_result -> 'paragraphs' ELSE '[]'::jsonb END,
    key_facts = CASE WHEN jsonb_typeof(p_result -> 'key_facts') = 'array' THEN p_result -> 'key_facts' ELSE '[]'::jsonb END,
    pages = (p_result ->> 'pages')::int, text_layer = (p_result ->> 'text_layer')::boolean,
    document_sha256 = coalesce(p_result ->> 'document_sha256', document_sha256),
    overview = CASE WHEN jsonb_typeof(p_result -> 'overview') = 'object' THEN p_result -> 'overview' END
  WHERE id = v_d.id;

  IF v_d.role = 'reply' THEN
    DELETE FROM public.ai_learning_pairs WHERE document_id = v_d.id;
    FOR e IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_result -> 'pairs') = 'array' THEN p_result -> 'pairs' ELSE '[]'::jsonb END) LOOP
      CONTINUE WHEN btrim(coalesce(e ->> 'allegation', '')) = '' OR btrim(coalesce(e ->> 'response', '')) = '';
      v_nid := CASE WHEN coalesce(e ->> 'notice_id', '') ~ '^[0-9a-f-]{36}$' THEN (e ->> 'notice_id')::uuid ELSE v_d.notice_id END;
      v_form := NULL; v_sec := NULL; v_fy := NULL;
      SELECT g.form_code, g.section_of_law, g.financial_year INTO v_form, v_sec, v_fy
        FROM public.gst_notices g WHERE g.id = v_nid AND g.client_id = v_d.client_id;
      IF NOT FOUND THEN
        v_nid := v_d.notice_id;
        SELECT g.form_code, g.section_of_law, g.financial_year INTO v_form, v_sec, v_fy
          FROM public.gst_notices g WHERE g.id = v_nid;
      END IF;
      INSERT INTO public.ai_learning_pairs (document_id, client_id, notice_id, case_id, origin, form_code, section_of_law, financial_year,
                                            issue_code, issue_title, allegation, response, seq, page, verified, included)
      VALUES (v_d.id, v_d.client_id, v_nid, v_d.case_id, CASE WHEN v_d.source = 'draft' THEN 'draft' ELSE 'portal_reply' END,
              v_form, v_sec, v_fy,
              CASE WHEN EXISTS (SELECT 1 FROM public.reply_issue_types t WHERE t.code = e ->> 'issue_code') THEN e ->> 'issue_code' ELSE 'OTHER' END,
              left(nullif(btrim(e ->> 'issue_title'), ''), 200), left(btrim(e ->> 'allegation'), 4000), left(btrim(e ->> 'response'), 8000),
              (e ->> 'seq')::int, (e ->> 'page')::int, coalesce((e ->> 'verified')::boolean, false), v_d.learning_included);
      v_pairs := v_pairs + 1;
    END LOOP;
  END IF;
  UPDATE public.ai_runner_status SET last_work_at = now() WHERE id;
  RETURN jsonb_build_object('status', 'done', 'pairs', v_pairs);
END;
$$;
GRANT EXECUTE ON FUNCTION public.ai_document_finish(uuid, text, text, jsonb, jsonb, text, text) TO anon, authenticated, service_role;

-- ── 4. Every client's documents are read; consent no longer strands work ───
CREATE OR REPLACE FUNCTION public.ai_requeue_consent(p_client_id uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int := 0;
  v_m int := 0;
BEGIN
  WITH r AS (
    UPDATE public.ai_documents d
       SET status = 'queued', reason_class = NULL, error = NULL, finished_at = NULL, attempts = 0, not_before = NULL
     WHERE d.status = 'cancelled' AND d.reason_class IN ('no_consent', 'off')
       AND (p_client_id IS NULL OR d.client_id = p_client_id)
       AND public.ai_read_allowed(d.client_id) IS NULL
    RETURNING 1)
  SELECT count(*)::int INTO v_n FROM r;
  WITH r AS (
    UPDATE public.notice_extractions x
       SET status = 'queued', reason_class = NULL, error = NULL, finished_at = NULL, attempts = 0, not_before = NULL
     WHERE x.source = 'ai' AND x.status = 'cancelled' AND x.reason_class IN ('no_consent', 'off')
       AND (p_client_id IS NULL OR x.client_id = p_client_id)
       AND public.ai_read_allowed(x.client_id) IS NULL
    RETURNING 1)
  SELECT count(*)::int INTO v_m FROM r;
  RETURN v_n + v_m;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_requeue_consent(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.clients_ai_consent_requeue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.ai_consent_at IS NOT NULL AND OLD.ai_consent_at IS NULL)
     OR (coalesce(OLD.ai_opt_out, false) AND NOT coalesce(NEW.ai_opt_out, false)) THEN
    PERFORM public.ai_requeue_consent(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_clients_ai_consent_requeue ON public.clients;
CREATE TRIGGER trg_clients_ai_consent_requeue
  AFTER UPDATE OF ai_consent_at, ai_opt_out ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_ai_consent_requeue();

CREATE OR REPLACE FUNCTION public.ai_settings_consent_requeue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.consent_scope = 'all_clients' AND OLD.consent_scope IS DISTINCT FROM 'all_clients')
     OR (NEW.read_enabled AND NOT coalesce(OLD.read_enabled, false)) THEN
    PERFORM public.ai_requeue_consent(NULL);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_settings_consent_requeue ON public.ai_settings;
CREATE TRIGGER trg_ai_settings_consent_requeue
  AFTER UPDATE OF consent_scope, read_enabled ON public.ai_settings
  FOR EACH ROW EXECUTE FUNCTION public.ai_settings_consent_requeue();

-- The firm's decision (9 October 2026): every client's documents are read.
UPDATE public.ai_settings SET consent_scope = 'all_clients' WHERE id AND consent_scope IS DISTINCT FROM 'all_clients';
-- Work stranded before the triggers existed (consent recorded later).
SELECT public.ai_requeue_consent(NULL);
-- Documents read before the reader returned the overview are read again for it,
-- behind everything not yet read.
UPDATE public.ai_documents
   SET status = 'queued', attempts = 0, not_before = NULL, priority = least(priority, 5)
 WHERE status = 'done' AND overview IS NULL AND source = 'folder';
