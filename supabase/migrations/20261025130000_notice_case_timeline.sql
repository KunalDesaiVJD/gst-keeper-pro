-- Notices · every event of a case on its timeline (asked by the firm, 25 October
-- 2026: "make sure that all events are shown here properly. APL-01 is missing
-- here. Document also and chronological event also ... what all events are
-- there in GST law and what all should be shown here for proper decision
-- making").
--
-- 1. notice_case_correspondence: a case folder item was hidden as "the folder's
--    copy of a notice already listed" whenever any notice of the chain carried
--    its reference. An appeal's application (APLCN) carries the number of the
--    order it is against, so once 20261024100000 linked the appeal under its
--    order, the APL-01 was taken for the DRC-07 and dropped (live: 10 items, 9
--    of them appeals, among them Tamnna Infrastructure-Gujarat's AD2406260074481).
--    A copy is now only an item of the notice's own portal case (or of a
--    case-less notice), never an application or a reply. An appeal's own
--    application is labelled "APL-01 · Appeal filed against <order>".
-- 2. notice_folder_facts / notice_case_item_facts: what the portal's own record
--    of an item says, read from its raw JSON: an appeal's order, the date the
--    order was communicated, the tax and total in dispute, the pre-deposit and
--    its rate, the date it was filed, the issues, the documents filed with it
--    (also those not downloaded yet); a hearing's date, time and place; a due
--    date; the section and financial year. notice_case_items carries it as facts.
-- 3. notice_case_key_dates: the dates the law attaches to the case's papers, on
--    the same timeline: the time to appeal an order (s.107(1), condonable one
--    month, s.107(4); against an appeal order to the Tribunal, s.112(1) and (6)),
--    whether an appeal was filed in time, its pre-deposit (s.107(6)) and the stay
--    of recovery (s.107(7)), personal hearings and how many adjournments were
--    granted (at most three, s.75(5)), replies due, the demand's payment date,
--    and the windows to pay and close with a reduced penalty (s.73(8), s.74(5),
--    s.74(8), s.74(11); only for periods before FY 2024-25, after which s.74A applies).
--    Positions: §30 of docs/NOTICES_LITIGATION_POSITIONS.md.

-- ── Helpers ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_try_jsonb(p text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p IS NULL OR btrim(p) = '' THEN RETURN NULL; END IF;
  RETURN p::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notice_try_num(p text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE WHEN btrim(coalesce(p, '')) ~ '^-?[0-9]+(\.[0-9]+)?$' THEN btrim(p)::numeric END
$$;

-- An amount the Indian way: ₹16,10,440.
CREATE OR REPLACE FUNCTION public.notice_inr(p numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE WHEN p IS NULL THEN NULL ELSE
    '₹' || CASE WHEN p < 0 THEN '-' ELSE '' END ||
    CASE WHEN length(abs(round(p))::bigint::text) <= 3 THEN abs(round(p))::bigint::text
         ELSE regexp_replace(left(abs(round(p))::bigint::text, length(abs(round(p))::bigint::text) - 3), '(\d)(?=(\d\d)+$)', '\1,', 'g')
              || ',' || right(abs(round(p))::bigint::text, 3) END END
$$;

-- An appeal's application (the portal's APL-01 item): an order it is against,
-- and either the APPEAL application number or a pre-deposit.
CREATE OR REPLACE FUNCTION public.notice_is_appeal_form(p_raw jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT coalesce(jsonb_typeof(p_raw) = 'object' AND jsonb_typeof(p_raw -> 'orddtl') = 'object'
                  AND (upper(coalesce(p_raw ->> 'aplnum', '')) = 'APPEAL' OR p_raw #> '{orddtl,predepositamt}' IS NOT NULL), false)
$$;

-- ── 2. What an item's portal record says ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_folder_facts(p_section text, p_raw jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  j jsonb := CASE WHEN jsonb_typeof(p_raw) = 'object' THEN p_raw ELSE '{}'::jsonb END;
  od jsonb := CASE WHEN jsonb_typeof(p_raw -> 'orddtl') = 'object' THEN p_raw -> 'orddtl' END;
  v_out jsonb := '{}'::jsonb;
  v_ph date;
  v_docs jsonb;
BEGIN
  IF j = '{}'::jsonb THEN RETURN NULL; END IF;
  v_ph := public.notices_parse_portal_date(jsonb_path_query_first(j, 'lax $.**.phdt') #>> '{}');
  IF v_ph IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('hearing', jsonb_strip_nulls(jsonb_build_object(
      'date', v_ph,
      'time', nullif(btrim(jsonb_path_query_first(j, 'lax $.**.pht') #>> '{}'), ''),
      'venue', nullif(btrim(jsonb_path_query_first(j, 'lax $.**.venu') #>> '{}'), ''))));
  END IF;
  v_out := v_out || jsonb_strip_nulls(jsonb_build_object(
    'due', public.notices_parse_portal_date(jsonb_path_query_first(j, 'lax $.**.duedt') #>> '{}'),
    'section_of_law', nullif(btrim(jsonb_path_query_first(j, 'lax $.**.sec') #>> '{}'), ''),
    'fy', nullif(btrim(jsonb_path_query_first(j, 'lax $.**.fy') #>> '{}'), ''),
    'type', nullif(btrim(jsonb_path_query_first(j, 'lax $.sdtls.*.type') #>> '{}'), '')));
  IF od IS NOT NULL THEN
    v_out := v_out || jsonb_strip_nulls(jsonb_build_object(
      'form', CASE WHEN public.notice_is_appeal_form(j) THEN 'APL-01' END,
      'order_ref', nullif(btrim(coalesce(od ->> 'ordnum', od ->> 'dmdid')), ''),
      'order_date', public.notices_parse_portal_date(od ->> 'orddt'),
      'order_comm_date', public.notices_parse_portal_date(od ->> 'ordcommdt'),
      'disputed_tax', public.notice_try_num(od #>> '{dispamt,total,tx}'),
      'disputed_total', public.notice_try_num(od #>> '{dispamt,total,tot}'),
      'predeposit', public.notice_try_num(od #>> '{predepositamt,total,tot}'),
      'predeposit_pct', coalesce(public.notice_try_num(od ->> 'predepotax'), public.notice_try_num(od #>> '{predepositpenality,percent}')),
      'filed_on', coalesce(public.notices_parse_portal_date(j #>> '{authdtls,dt}'), public.notices_parse_portal_date(j ->> 'insertTimeStamp')),
      'second_appeal', CASE WHEN j ->> 'scndAppeal' = 'true' THEN true END,
      'issues', (SELECT jsonb_agg(btrim(x ->> 'desc')) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(j -> 'issuecat') = 'array' THEN j -> 'issuecat' ELSE '[]'::jsonb END) x
                  WHERE nullif(btrim(x ->> 'desc'), '') IS NOT NULL)));
  END IF;
  -- Every document the record lists, downloaded or not (the portal spells the
  -- file name docName in one section and docname in another).
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', d.id, 'name', d.name, 'file', d.file)) ORDER BY d.ord)
    INTO v_docs
    FROM (SELECT DISTINCT ON (x ->> 'id') x ->> 'id' AS id,
                 nullif(btrim(coalesce(x ->> 'name', x ->> 'docttl', x ->> 'docname', x ->> 'docName')), '') AS name,
                 nullif(btrim(coalesce(x ->> 'docname', x ->> 'docName')), '') AS file, o AS ord
            FROM jsonb_path_query(j, 'lax $.** ? (exists(@.id) && (exists(@.docname) || exists(@.docName)))') WITH ORDINALITY q(x, o)
           WHERE jsonb_typeof(x) = 'object' AND nullif(btrim(x ->> 'id'), '') IS NOT NULL
           ORDER BY x ->> 'id', o) d;
  IF v_docs IS NOT NULL THEN v_out := v_out || jsonb_build_object('portal_docs', v_docs); END IF;
  RETURN nullif(v_out, '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.notice_case_item_facts(p_client_id uuid, p_kind text, p_item_id uuid, p_own_key text, p_reference text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_kind
    WHEN 'document' THEN
      (SELECT coalesce(public.notice_folder_facts(fi.folder_section, fi.raw_json), '{}'::jsonb)
              || coalesce((SELECT jsonb_build_object('portal_status', a.status)
                             FROM public.gst_portal_applications a
                            WHERE a.client_id = fi.client_id AND a.deleted_at IS NULL AND a.status IS NOT NULL
                              AND upper(coalesce(fi.folder_section, '')) = 'APLCN' AND upper(btrim(a.arn)) = upper(btrim(fi.case_id))
                            LIMIT 1), '{}'::jsonb)
         FROM public.gst_case_folder_items fi WHERE fi.id = p_item_id)
    WHEN 'notice' THEN
      (SELECT public.notice_folder_facts(fi.folder_section, fi.raw_json)
         FROM public.gst_case_folder_items fi
        WHERE fi.client_id = p_client_id AND fi.deleted_at IS NULL AND p_reference IS NOT NULL
          AND fi.reference_number = p_reference AND upper(btrim(fi.case_id)) = upper(p_own_key)
        ORDER BY (upper(coalesce(fi.folder_section, '')) IN ('APLCN', 'REPLY', 'REPLIES')), fi.last_seen_at DESC NULLS LAST
        LIMIT 1)
    WHEN 'application' THEN
      (SELECT coalesce(public.notice_folder_facts('APLCN', public.notice_try_jsonb(a.raw_json #>> '{appItem,itemJson}')), '{}'::jsonb)
              || jsonb_strip_nulls(jsonb_build_object('portal_status', a.status, 'filed_on', a.filed_date,
                   'form', nullif(btrim(regexp_replace(coalesce(a.form_number, ''), '^GST\s+', '', 'i')), ''),
                   'order_ref', nullif(btrim(a.raw_json #>> '{appItem,refId}'), '')))
         FROM public.gst_portal_applications a WHERE a.id = p_item_id)
  END
$$;
REVOKE ALL ON FUNCTION public.notice_case_item_facts(uuid, text, uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.notice_case_item_facts(uuid, text, uuid, text, text) TO anon, authenticated, service_role;

-- ── 1. Correspondence ──────────────────────────────────────────────────────
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
         -- 20261025130000: an appeal's own application is its APL-01.
         CASE WHEN upper(coalesce(fi.folder_section, '')) = 'APLCN' AND public.notice_is_appeal_form(fi.raw_json)
              THEN 'APL-01 · Appeal filed' || coalesce(' against ' || nullif(btrim(coalesce(fi.raw_json #>> '{orddtl,ordnum}', fi.raw_json #>> '{orddtl,dmdid}')), ''), '')
              ELSE public.notice_folder_label(fi.folder_section, fi.raw_json) END,
         fi.reference_number, fi.folder_section, fi.case_id
    FROM public.gst_case_folder_items fi
   WHERE fi.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM n WHERE n.client_id = fi.client_id AND n.case_key = public.notice_case_root(fi.client_id, fi.case_id))
     -- The folder's copy of a notice already listed is that notice, not another item.
     -- 20261025130000: only a copy in the notice's own portal case (or a case-less
     -- notice's), and never an application or a reply, whose reference is the
     -- order or notice it answers: once an appeal was linked under its order, its
     -- APL-01 (reference: the order's number) was taken for the order and hidden.
     AND NOT EXISTS (SELECT 1 FROM n WHERE n.client_id = fi.client_id AND n.case_key = public.notice_case_root(fi.client_id, fi.case_id)
                       AND n.reference_number IS NOT NULL AND n.reference_number = fi.reference_number
                       AND upper(coalesce(fi.folder_section, '')) NOT IN ('APLCN', 'REPLY', 'REPLIES')
                       AND (upper(n.own_key) = upper(btrim(fi.case_id)) OR n.own_key LIKE 'N:%' OR n.own_key = 'REG'))
  UNION ALL
  -- 20261024120000: an application filed on the portal that has no case folder
  -- or notice of its own yet (an appeal only submitted), in the case it is against.
  SELECT a.client_id, public.notice_case_root(a.client_id, upper(btrim(a.arn))), 'application', a.id, 'taxpayer',
         a.filed_date, a.first_seen_at,
         coalesce(nullif(btrim(regexp_replace(coalesce(a.form_number, ''), '^GST\s+', '', 'i')), '') || ' · ', '')
           || coalesce(a.status, CASE a.case_type_cd WHEN 'APPEL' THEN 'Appeal' WHEN 'ADJWS' THEN 'Waiver application' WHEN 'ADJRO' THEN 'Rectification application' ELSE 'Application' END),
         upper(btrim(a.arn)), 'APLCN', upper(btrim(a.arn))
    FROM public.gst_portal_applications a
   WHERE a.deleted_at IS NULL AND nullif(btrim(a.arn), '') IS NOT NULL
     AND EXISTS (SELECT 1 FROM n WHERE n.client_id = a.client_id AND n.case_key = public.notice_case_root(a.client_id, upper(btrim(a.arn))))
     AND NOT EXISTS (SELECT 1 FROM n WHERE n.client_id = a.client_id AND n.own_key = upper(btrim(a.arn)))
     AND NOT EXISTS (SELECT 1 FROM public.gst_case_folder_items fi
                      WHERE fi.client_id = a.client_id AND fi.deleted_at IS NULL AND upper(btrim(fi.case_id)) = upper(btrim(a.arn)))
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

-- notice_case_items as in 20261024100000, with each item's facts.
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
        -- 20261025130000: what the portal's own record of the item says (an appeal's order, amounts, pre-deposit,
        -- documents; a hearing's date and place; a due date).
        'facts', public.notice_case_item_facts(c.client_id, c.kind, c.item_id, c.own_key, c.reference),
        'stage', f.stage, 'stage_label', f.stage_label, 'is_open', f.is_open, 'pdf_url', g.pdf_url,
        -- A notice carries the files of its copy in the case folder (same reference).
        -- 20261025130000: its own case's copy only, never the appeal or reply that quotes it.
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
        LEFT JOIN public.notice_facts f ON c.kind = 'notice' AND f.id = c.item_id
        LEFT JOIN public.gst_notices g ON c.kind = 'notice' AND g.id = c.item_id
       WHERE c.client_id = p_client_id AND c.case_key = public.notice_case_root(p_client_id, p_case_key)
    ) x
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_items(uuid, text) TO anon, authenticated, service_role;

-- ── 3. The dates the law attaches to the case's papers ─────────────────────
-- Orders an appeal lies against before the appellate authority (s.107), and
-- the appellate authority's own order (to the Tribunal, s.112).
CREATE OR REPLACE FUNCTION public.notice_appealable_forms()
RETURNS text[]
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT ARRAY['DRC-07', 'DRC-08', 'ASMT-13', 'ASMT-15', 'RFD-06', 'RFD-07', 'REG-05', 'REG-19', 'REG-CANCEL-REJ', 'MOV-09', 'RECT-ORDER', 'APL-04']
$$;

CREATE OR REPLACE FUNCTION public.notice_case_key_dates(p_client_id uuid, p_case_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root text := public.notice_case_root(p_client_id, p_case_key);
  v_today date := public.ist_today();
  v_items jsonb;
  v_ev jsonb := '[]'::jsonb;
  o record;
  h record;
  v_ap jsonb;
  v_comm date;
  v_last date;
  v_condone date;
  v_filed date;
  v_tribunal boolean;
  v_cond_law text;
  v_req numeric;
  v_pct numeric;
  v_n int;
  v_sec text;
  v_fy_ok boolean;
BEGIN
  IF v_root IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'kind', c.kind, 'id', c.item_id, 'own_key', c.own_key, 'reference', c.reference, 'date', c.item_date,
           'section', upper(coalesce(c.folder_section, '')), 'label', c.label,
           'form', f.form_code, 'is_open', f.is_open, 'effective_due', f.effective_due, 'issue_date', f.issue_date,
           'facts', public.notice_case_item_facts(c.client_id, c.kind, c.item_id, c.own_key, c.reference))), '[]'::jsonb)
    INTO v_items
    FROM public.notice_case_correspondence c
    LEFT JOIN public.notice_facts f ON c.kind = 'notice' AND f.id = c.item_id
   WHERE c.client_id = p_client_id AND c.case_key = v_root;

  -- Personal hearings, each once (a notice and an item may name the same one).
  FOR h IN
    SELECT DISTINCT ON ((x #>> '{facts,hearing,date}'), coalesce(x #>> '{facts,hearing,time}', ''))
           (x #>> '{facts,hearing,date}')::date AS d, x #>> '{facts,hearing,time}' AS t, x #>> '{facts,hearing,venue}' AS venue,
           x ->> 'own_key' AS own_key, x ->> 'reference' AS ref, x ->> 'id' AS id, x ->> 'kind' AS kind
      FROM jsonb_array_elements(v_items) x
     WHERE x #>> '{facts,hearing,date}' IS NOT NULL
     ORDER BY (x #>> '{facts,hearing,date}'), coalesce(x #>> '{facts,hearing,time}', ''), (x ->> 'kind' = 'notice') DESC
  LOOP
    v_ev := v_ev || jsonb_build_object('date', h.d, 'kind', 'hearing', 'own_key', h.own_key, 'item_id', h.id,
      'title', 'Personal hearing' || coalesce(' at ' || h.t, ''),
      'detail', concat_ws(' · ', h.venue, CASE WHEN h.ref IS NOT NULL THEN 'fixed by ' || h.ref END),
      'tone', CASE WHEN h.d >= v_today THEN 'warn' ELSE 'muted' END, 'law', 's.75(4)');
  END LOOP;

  -- Adjournments granted, counted in each portal case (at most three, s.75(5)).
  FOR h IN
    SELECT (x ->> 'date')::date AS d, x ->> 'own_key' AS own_key, x ->> 'reference' AS ref, x ->> 'id' AS id,
           row_number() OVER (PARTITION BY x ->> 'own_key' ORDER BY x ->> 'date', x ->> 'reference') AS n
      FROM jsonb_array_elements(v_items) x
     WHERE x #>> '{facts,type}' ILIKE '%adjourn%' AND x ->> 'date' IS NOT NULL
  LOOP
    v_ev := v_ev || jsonb_build_object('date', h.d, 'kind', 'adjournment', 'own_key', h.own_key, 'item_id', h.id,
      'title', 'Adjournment ' || h.n || ' of the 3 the law allows',
      'detail', CASE WHEN h.n >= 3 THEN 'No further adjournment can be granted in these proceedings.'
                     ELSE (3 - h.n) || ' more can be granted, each for sufficient cause.' END,
      'tone', CASE WHEN h.n >= 3 THEN 'danger' ELSE 'info' END, 'law', 's.75(5)');
  END LOOP;

  -- Replies still due on open notices.
  FOR h IN
    SELECT (x ->> 'effective_due')::date AS d, x ->> 'own_key' AS own_key, x ->> 'id' AS id, x ->> 'label' AS label
      FROM jsonb_array_elements(v_items) x
     WHERE x ->> 'kind' = 'notice' AND (x ->> 'is_open')::boolean AND x ->> 'effective_due' IS NOT NULL
       AND coalesce(x ->> 'form', '') <> ALL (public.notice_appealable_forms())
  LOOP
    v_ev := v_ev || jsonb_build_object('date', h.d, 'kind', 'reply_due', 'own_key', h.own_key, 'item_id', h.id,
      'title', 'Reply due', 'detail', h.label,
      'tone', CASE WHEN h.d < v_today THEN 'danger' WHEN h.d <= v_today + 7 THEN 'warn' ELSE 'info' END);
  END LOOP;

  -- Show cause notices and intimations: the windows to pay and close with a
  -- reduced penalty (s.73 and s.74 periods only; from FY 2024-25 s.74A applies).
  FOR h IN
    SELECT x ->> 'form' AS form, coalesce((x ->> 'issue_date')::date, (x ->> 'date')::date) AS d, x ->> 'own_key' AS own_key, x ->> 'id' AS id,
           x #>> '{facts,section_of_law}' AS sec, x #>> '{facts,fy}' AS fy, (x #>> '{facts,due}')::date AS due
      FROM jsonb_array_elements(v_items) x
     WHERE x ->> 'kind' = 'notice' AND x ->> 'form' IN ('DRC-01', 'DRC-01A')
       -- An adjournment letter is filed under the notice it adjourns, not a notice of its own.
       AND coalesce(x #>> '{facts,type}', '') NOT ILIKE '%adjourn%'
  LOOP
    v_sec := substring(coalesce(h.sec, '') FROM '^(73|74)\M');
    v_fy_ok := h.fy IS NULL OR substring(h.fy FROM '^(\d{4})')::int < 2024;
    CONTINUE WHEN v_sec IS NULL OR NOT v_fy_ok OR h.d IS NULL;
    IF h.form = 'DRC-01A' AND v_sec = '74' THEN
      v_ev := v_ev || jsonb_build_object('date', coalesce(h.due, h.d + 30), 'kind', 'pay_to_close', 'own_key', h.own_key, 'item_id', h.id,
        'title', 'Last day to pay with a 15% penalty before a show cause notice',
        'detail', 'Tax, interest and 15% of the tax paid by DRC-03 against the DRC-01A ends the matter.',
        'tone', CASE WHEN coalesce(h.due, h.d + 30) >= v_today THEN 'warn' ELSE 'muted' END, 'law', 's.74(5)');
    ELSIF h.form = 'DRC-01' THEN
      v_ev := v_ev || jsonb_build_object('date', h.d + 30, 'kind', 'pay_to_close', 'own_key', h.own_key, 'item_id', h.id,
        'title', CASE WHEN v_sec = '73' THEN 'Last day to pay tax and interest with no penalty'
                      ELSE 'Last day to pay with a 25% penalty and close' END,
        'detail', 'Within 30 days of the show cause notice; the proceedings are then deemed concluded.',
        'tone', CASE WHEN h.d + 30 >= v_today THEN 'warn' ELSE 'muted' END,
        'law', CASE WHEN v_sec = '73' THEN 's.73(8)' ELSE 's.74(8)' END);
    END IF;
  END LOOP;

  -- Orders: the time to appeal, whether an appeal was filed in time, its
  -- pre-deposit, the payment date and the window to close with 50% penalty.
  FOR o IN
    SELECT x ->> 'form' AS form, x ->> 'id' AS id, x ->> 'own_key' AS own_key, x ->> 'reference' AS ref, (x ->> 'is_open')::boolean AS is_open,
           coalesce((x ->> 'issue_date')::date, (x ->> 'date')::date) AS d, x -> 'facts' AS facts
      FROM jsonb_array_elements(v_items) x
     WHERE x ->> 'kind' = 'notice' AND x ->> 'form' = ANY (public.notice_appealable_forms())
  LOOP
    CONTINUE WHEN o.d IS NULL;
    v_tribunal := o.form = 'APL-04';
    -- The appeal against this order: its application names the order.
    SELECT x -> 'facts' INTO v_ap
      FROM jsonb_array_elements(v_items) x
     WHERE x ->> 'kind' IN ('document', 'application') AND x #>> '{facts,order_ref}' IS NOT NULL
       AND upper(x #>> '{facts,order_ref}') = upper(coalesce(o.ref, ''))
     ORDER BY (x #>> '{facts,filed_on}') NULLS LAST
     LIMIT 1;
    v_comm := coalesce((v_ap ->> 'order_comm_date')::date, o.d);
    v_last := (v_comm + interval '3 months')::date;
    v_condone := (v_comm + CASE WHEN v_tribunal THEN interval '6 months' ELSE interval '4 months' END)::date;
    v_cond_law := CASE WHEN v_tribunal THEN 's.112(6)' ELSE 's.107(4)' END;
    v_filed := (v_ap ->> 'filed_on')::date;
    IF v_ap IS NOT NULL AND v_filed IS NOT NULL THEN
      v_ev := v_ev || jsonb_build_object('date', v_filed, 'kind', 'appeal_filed', 'own_key', o.own_key, 'item_id', o.id,
        'title', CASE WHEN v_filed < v_last THEN 'Appeal filed in time'
                      WHEN v_filed = v_last THEN 'Appeal filed on the last day of the 3 months'
                      WHEN v_filed <= v_condone THEN 'Appeal filed ' || (v_filed - v_last) || ' day' || CASE WHEN v_filed - v_last = 1 THEN '' ELSE 's' END || ' after the 3 months'
                      ELSE 'Appeal filed after the time the law allows' END,
        'detail', 'Against ' || coalesce(o.form || ' ', '') || coalesce(o.ref, 'the order') || ' communicated on ' || to_char(v_comm, 'DD Mon YYYY')
                  || '; the 3 months ran to ' || to_char(v_last, 'DD Mon YYYY') || ' (the day of the order not counted)'
                  || CASE WHEN v_filed > v_last AND v_filed <= v_condone
                          THEN '. The authority may condone a delay up to ' || to_char(v_condone, 'DD Mon YYYY') || ' for sufficient cause' ELSE '' END
                  || CASE WHEN v_ap ->> 'order_comm_date' IS NULL THEN '. Counted from the order''s date: if it reached the client later, the time runs from then' ELSE '' END || '.',
        'tone', CASE WHEN v_filed <= v_last THEN 'ok' WHEN v_filed <= v_condone THEN 'warn' ELSE 'danger' END,
        'law', CASE WHEN v_tribunal THEN 's.112(1)' ELSE 's.107(1)' END);
      v_pct := coalesce((v_ap ->> 'predeposit_pct')::numeric, CASE WHEN v_tribunal THEN 20 ELSE 10 END);
      IF (v_ap ->> 'disputed_tax') IS NOT NULL THEN
        v_req := round((v_ap ->> 'disputed_tax')::numeric * v_pct / 100);
        v_ev := v_ev || jsonb_build_object('date', v_filed, 'kind', 'predeposit', 'own_key', o.own_key, 'item_id', o.id,
          'title', CASE WHEN coalesce((v_ap ->> 'predeposit')::numeric, 0) + 1 >= v_req
                        THEN 'Pre-deposit of ' || public.notice_inr(coalesce((v_ap ->> 'predeposit')::numeric, 0)) || ' paid with the appeal'
                        ELSE 'Pre-deposit short: ' || public.notice_inr(coalesce((v_ap ->> 'predeposit')::numeric, 0)) || ' paid, ' || public.notice_inr(v_req) || ' required' END,
          'detail', trim(to_char(v_pct, 'FM990.##')) || '% of the tax in dispute, ' || public.notice_inr((v_ap ->> 'disputed_tax')::numeric)
                    || ', is ' || public.notice_inr(v_req) || coalesce(' (total in dispute ' || public.notice_inr((v_ap ->> 'disputed_total')::numeric) || ')', '')
                    || '. Once paid, recovery of the rest is stayed while the appeal is pending.',
          'tone', CASE WHEN coalesce((v_ap ->> 'predeposit')::numeric, 0) + 1 >= v_req THEN 'ok' ELSE 'danger' END,
          'law', CASE WHEN v_tribunal THEN 's.112(8), s.112(9)' ELSE 's.107(6), s.107(7)' END);
      END IF;
    ELSIF v_ap IS NOT NULL THEN
      v_ev := v_ev || jsonb_build_object('date', v_last, 'kind', 'appeal_window', 'own_key', o.own_key, 'item_id', o.id,
        'title', 'Appeal filed (date not on the portal record)', 'detail', 'The 3 months to appeal ran to ' || to_char(v_last, 'DD Mon YYYY') || '.',
        'tone', 'info', 'law', CASE WHEN v_tribunal THEN 's.112(1)' ELSE 's.107(1)' END);
    ELSIF v_today <= v_last THEN
      v_ev := v_ev || jsonb_build_object('date', v_last, 'kind', 'appeal_window', 'own_key', o.own_key, 'item_id', o.id,
        'title', 'Last day to appeal ' || coalesce(o.form || ' ', '') || coalesce(o.ref, 'the order'),
        'detail', (v_last - v_today) || ' days left. Then up to ' || to_char(v_condone, 'DD Mon YYYY') || ' only with a delay the authority condones.',
        'tone', 'warn', 'law', CASE WHEN v_tribunal THEN 's.112(1)' ELSE 's.107(1)' END);
    ELSIF v_today <= v_condone THEN
      v_ev := v_ev || jsonb_build_object('date', v_last, 'kind', 'appeal_window', 'own_key', o.own_key, 'item_id', o.id,
        'title', 'The 3 months to appeal ended, no appeal on record',
        'detail', 'An appeal can still be filed up to ' || to_char(v_condone, 'DD Mon YYYY') || ' with reasons for the delay.',
        'tone', 'danger', 'law', v_cond_law);
    ELSIF o.is_open OR o.form IN ('DRC-07', 'APL-04') THEN
      v_ev := v_ev || jsonb_build_object('date', v_condone, 'kind', 'appeal_window', 'own_key', o.own_key, 'item_id', o.id,
        'title', 'Time to appeal ' || coalesce(o.form || ' ', '') || coalesce(o.ref, 'the order') || ' is over, no appeal on record',
        'detail', 'The 3 months ran to ' || to_char(v_last, 'DD Mon YYYY') || ', the condonable time to ' || to_char(v_condone, 'DD Mon YYYY') || '.',
        'tone', CASE WHEN o.is_open THEN 'danger' ELSE 'muted' END, 'law', v_cond_law);
    END IF;

    IF o.form = 'DRC-07' THEN
      IF (o.facts ->> 'due') IS NOT NULL THEN
        v_ev := v_ev || jsonb_build_object('date', (o.facts ->> 'due')::date, 'kind', 'payment_due', 'own_key', o.own_key, 'item_id', o.id,
          'title', 'Demand payable by this date',
          'detail', CASE WHEN v_filed IS NOT NULL AND v_filed <= (o.facts ->> 'due')::date THEN 'Recovery of the rest is stayed by the appeal and its pre-deposit.'
                         WHEN v_filed IS NOT NULL THEN 'The appeal was filed after this date; recovery of the rest is stayed from the pre-deposit.'
                         ELSE 'Unpaid after this date, the demand can be recovered (s.79).' END,
          'tone', CASE WHEN v_filed IS NOT NULL OR (o.facts ->> 'due')::date < v_today THEN 'muted' ELSE 'warn' END, 'law', 's.78');
      END IF;
      v_sec := substring(coalesce(o.facts ->> 'section_of_law', '') FROM '^(74)\M');
      v_fy_ok := (o.facts ->> 'fy') IS NULL OR substring(o.facts ->> 'fy' FROM '^(\d{4})')::int < 2024;
      IF v_sec = '74' AND v_fy_ok THEN
        v_ev := v_ev || jsonb_build_object('date', v_comm + 30, 'kind', 'pay_to_close', 'own_key', o.own_key, 'item_id', o.id,
          'title', 'Last day to pay with a 50% penalty and close',
          'detail', 'Tax, interest and 50% of the penalty paid within 30 days of the order ends the proceedings.',
          'tone', CASE WHEN v_comm + 30 >= v_today THEN 'warn' ELSE 'muted' END, 'law', 's.74(11)');
      END IF;
    END IF;
  END LOOP;

  RETURN (SELECT coalesce(jsonb_agg(e || jsonb_build_object('upcoming', (e ->> 'date')::date >= v_today)
                                    ORDER BY (e ->> 'date')::date DESC, e ->> 'kind'), '[]'::jsonb)
            FROM jsonb_array_elements(v_ev) e WHERE e ->> 'date' IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.notice_case_key_dates(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.notice_case_key_dates(uuid, text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.notice_case_key_dates(uuid, text) IS
  'The dates GST law attaches to a case''s papers (time to appeal, pre-deposit, hearings, adjournments, replies due, payment and pay-to-close windows), for its timeline.';
