-- Notices · what is not important, and the right date on every paper (the
-- firm's requests of 12 October 2026):
--  1. "All system generated should be categorised as not important and not
--     relevant for answer; DRC-01B & DRC-01C the same, so not to be displayed":
--     a notice the portal marks "System generated" (issued_by), and every DRC-01B
--     and DRC-01C, needs no reply (response_need 'none': never overdue or due),
--     is off the dashboard and sits under Other (notice_facts.system_generated,
--     notice_cases.track 'other'). Still on record, never lost.
--  2. "Correspondence date: sometimes it is the sync date. The notice date first,
--     the portal date second": a case's correspondence is dated by the date on
--     the paper (the notice's date of issue; for a document, the date the AI read
--     printed on it), then the date the portal gives, and never the day it was
--     synced. With neither, the item is undated (sorted by when it arrived).

CREATE OR REPLACE FUNCTION public.notice_is_system_generated(p_issued_by text, p_form_code text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT coalesce(p_issued_by, '') ~* '^\s*system\s*generated' OR coalesce(p_form_code, '') IN ('DRC-01B', 'DRC-01C')
$$;
COMMENT ON FUNCTION public.notice_is_system_generated(text, text) IS
  'A notice that needs no reply and stays off the dashboard: one the portal issued as "System generated", or a DRC-01B / DRC-01C intimation.';

-- A document date the AI read, if it is a believable one (GST era, not in the future).
CREATE OR REPLACE FUNCTION public.notice_doc_date_ok(p_date date)
RETURNS date
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT CASE WHEN p_date BETWEEN DATE '2017-07-01' AND public.ist_today() THEN p_date END
$$;

CREATE INDEX IF NOT EXISTS idx_ai_documents_folder_item ON public.ai_documents (folder_item_id) WHERE folder_item_id IS NOT NULL;

UPDATE public.notice_type_settings SET response_need = 'none', show_on_dashboard = false, updated_at = now(),
       updated_by_name = 'Firm request 12 Oct 2026: not important'
 WHERE form_code IN ('DRC-01B', 'DRC-01C');

-- Their reply templates are switched off (kept, so the firm can switch them back on).
UPDATE public.reply_templates SET is_active = false
 WHERE cardinality(forms) > 0 AND forms <@ ARRAY['DRC-01B', 'DRC-01C']::text[] AND is_active;

-- notice_facts as in 20261013110000, with system_generated (appended).
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
         -- 20261014120000: system generated notices, and DRC-01B / DRC-01C, need no reply and stay off the dashboard.
         CASE WHEN public.notice_is_system_generated(g.issued_by, g.form_code) THEN 'none' ELSE coalesce(ts.response_need, 'critical') END AS response_need,
         (coalesce(ts.show_on_dashboard, true) AND NOT public.notice_is_system_generated(g.issued_by, g.form_code)) AS on_dashboard,
         public.notice_is_system_generated(g.issued_by, g.form_code) AS sys_gen
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
     -- 20261013110000: a case another firm handles is out, and so is a kind of work the firm does not do for this client.
     AND g.excluded_at IS NULL
     AND NOT (public.notice_track(public.notice_category(g.notice_type, g.description, r.category)) = ANY (coalesce(c.notices_tracks_off, '{}'::text[])))
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
  d.on_dashboard,
  d.sys_gen AS system_generated
FROM derived d
JOIN public.notice_stages st ON st.key = d.stage;

-- notice_cases as in 20261013110000, a system generated notice under Other.
CREATE OR REPLACE VIEW public.notice_cases AS
WITH n AS (
  SELECT f.*, public.notice_case_key(f.client_id, f.case_id, f.category, f.id) AS case_key,
         CASE WHEN f.system_generated THEN 'other' ELSE public.notice_track(f.category) END AS track
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
  a.financial_years, a.forms, a.notices, a.open_notices, a.is_open,
  (a.is_overdue AND w.waiting_on = 'us') AS is_overdue, (a.is_due_in_7 AND w.waiting_on = 'us') AS is_due_in_7, a.is_unassigned,
  a.next_due, a.next_hearing, a.first_issue_date, a.last_issue_date, a.exposure, a.amount_of_demand, a.on_dashboard,
  coalesce(co.documents, 0) AS documents, coalesce(co.new_items, 0) AS new_items, co.new_at, co.last_arrived_at, co.seen_at,
  lt.label AS latest_label, lt.kind AS latest_kind, lt.from_party AS latest_from, lt.item_date AS latest_date,
  greatest(a.last_issue_date, lt.item_date) AS last_activity_date,
  l.today_ist,
  w.waiting_on
FROM lead l
JOIN agg a ON a.client_id = l.client_id AND a.case_key = l.case_key
LEFT JOIN corr co ON co.client_id = l.client_id AND co.case_key = l.case_key
LEFT JOIN latest lt ON lt.client_id = l.client_id AND lt.case_key = l.case_key
-- 20261013110000: whose move it is. Closed; with the department when we have
-- replied, filed or appealed (the stage, every open notice replied, or the
-- latest paper is ours); else with us.
CROSS JOIN LATERAL (SELECT CASE
    WHEN NOT a.is_open THEN 'closed'
    WHEN l.stage IN ('filed', 'hearing', 'appeal') OR a.all_replied OR lt.from_party = 'taxpayer' THEN 'department'
    ELSE 'us' END AS waiting_on) w;

-- notice_case_correspondence as in 20261012100000, dated by the paper, never the sync.
CREATE OR REPLACE VIEW public.notice_case_correspondence AS
WITH n AS (
  SELECT f.id, f.client_id, f.case_id, f.category, f.form_code, f.form_label, f.notice_type, f.reference_number,
         f.issue_date, f.first_seen_at, public.notice_case_key(f.client_id, f.case_id, f.category, f.id) AS case_key
    FROM public.notice_facts f
), firsts AS (
  SELECT g.client_id, min(g.first_seen_at) AS first_at FROM public.gst_notices g GROUP BY g.client_id
), items AS (
  SELECT n.client_id, n.case_key, 'notice'::text AS kind, n.id AS item_id, 'department'::text AS from_party,
         -- 20261014120000: the date on the notice; never the day it was synced.
         coalesce(n.issue_date, (SELECT public.notice_doc_date_ok(d.doc_date) FROM public.ai_documents d
                                  WHERE d.notice_id = n.id AND d.status = 'done' ORDER BY d.updated_at DESC LIMIT 1)) AS item_date, n.first_seen_at,
         coalesce(n.form_code || ' · ', '') || coalesce(n.form_label, n.notice_type, 'Notice') AS label,
         n.reference_number AS reference, NULL::text AS folder_section
    FROM n
  UNION ALL
  SELECT fi.client_id, public.notice_case_root(fi.client_id, fi.case_id), 'document', fi.id, public.notice_folder_from(fi.folder_section),
         -- 20261014120000: the date printed on the document (as the AI read it) first, then the portal's date; never the sync date.
         coalesce((SELECT public.notice_doc_date_ok(d.doc_date) FROM public.ai_documents d
                    WHERE d.folder_item_id = fi.id AND d.status = 'done' ORDER BY d.updated_at DESC LIMIT 1),
                  public.notice_folder_item_date(fi.raw_json)), fi.first_seen_at,
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

-- The portal's date of a folder item, from more of the places the portal keeps
-- it (as in 20261011100000, then: a reply's date and declaration, a payment's
-- date, a filing date, a draft's date, the notice's date of issue).
CREATE OR REPLACE FUNCTION public.notice_folder_item_date(p_raw jsonb)
RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT coalesce(
    public.notices_parse_portal_date(p_raw ->> 'refdt'), public.notices_parse_portal_date(p_raw ->> 'ntcdt'),
    public.notices_parse_portal_date(p_raw ->> 'ntcDt'), public.notices_parse_portal_date(p_raw ->> 'replydt'),
    public.notices_parse_portal_date(p_raw ->> 'replyDate'),
    public.notices_parse_portal_date(p_raw #>> '{reply,decdtls,dt}'),
    public.notices_parse_portal_date(p_raw #>> '{vp,pysum,paymentdate}'),
    public.notices_parse_portal_date(p_raw #>> '{vp,pysum,decdtls,dt}'),
    public.notices_parse_portal_date(p_raw #>> '{decdtls,dt}'),
    public.notices_parse_portal_date(p_raw ->> 'arndt'), public.notices_parse_portal_date(p_raw ->> 'arnGenDate'),
    public.notices_parse_portal_date(p_raw ->> 'dof'), public.notices_parse_portal_date(p_raw ->> 'draftrefdt'),
    public.notices_parse_portal_date(p_raw ->> 'rfdSubDt'), public.notices_parse_portal_date(p_raw ->> 'lutfiledt'),
    public.notices_parse_portal_date(p_raw ->> 'crndt'), public.notices_parse_portal_date(p_raw ->> 'noticeIssuanceDate'),
    public.notices_parse_portal_date(p_raw ->> 'noticeDate'), public.notices_parse_portal_date(p_raw ->> 'insertTimeStamp'))
$$;
