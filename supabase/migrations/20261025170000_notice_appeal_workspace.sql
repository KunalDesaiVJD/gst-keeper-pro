-- Notices · the Appeal workspace (the firm's request of 25 October 2026: "Once
-- appeal is filed, like work on case, work on appeal section also need to be
-- created: draft documents for filing an appeal, AI generated statement of
-- facts, grounds of appeal and also suggested detailed written submission based
-- on evidence and reading previous cases & our submissions. Where case is under
-- appeal, user can have 2 split views: Case and Appeal.").
--
-- An appeal is keyed by the order it is against (appeal_key = the order's
-- reference, upper case): the drafts made while preparing it (no ARN yet) stay
-- with it once it is filed. A case's appeals (notice_case_appeals) are the
-- APL-01s on record in the case (its case folder's APLCN items and the
-- portal's APPEL applications, 20261024120000 / 20261025140000) and the orders
-- of the case an appeal lies against with none on record yet ("to file").
--
-- Three documents per appeal, each kept in versions (notice_appeal_drafts):
-- facts (statement of facts), grounds (grounds of appeal), submission (the
-- detailed written submission for the hearing). The notice assistant drafts or
-- improves one (Edge Function notice-ai, action appeal; notice_appeal_ai_begin /
-- _finish, runs in notice_appeal_ai_runs) from: the order appealed as read,
-- every document of the case as read with its evidence labels
-- (case_document_labels), the firm's replies in the case, the issues and the
-- positions typed by staff, the appeal's other drafts, and precedents: the
-- firm's appeals and replies on other cases, and appeal drafts marked final.
-- A precedent from another client is used only when that client is chosen
-- under Reply Factory, Learning (clients.ai_learning) or the document itself is
-- (learning_included), as for the reply assistant's examples; this client's own
-- other cases always count. Same switches as the assistant: ai_settings.read_enabled,
-- ai_read_allowed (consent), and the assistant's daily cap (logged as purpose
-- assist). Every text is kept without a hyphen or dash (reply_dehyphen), the
-- firm's rule for what is filed. Nothing is filed by the app.
--
-- Additive only. RLS open to public as every app table (CLAUDE.md: the app has
-- no Supabase auth session; login and the permission keys are the gate).
--
-- Objects: notice_appeal_drafts, notice_appeal_ai_runs, notice_case_appeals(),
-- notice_appeal_order(), notice_appeal_context(), notice_appeal_ai_begin(),
-- notice_appeal_ai_finish(), notice_appeal_draft_save().

DO $$
BEGIN
  IF to_regclass('public.notice_appeal_drafts') IS NULL THEN
    CREATE TABLE public.notice_appeal_drafts (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id   uuid NOT NULL REFERENCES public.clients(id),
      case_key    text NOT NULL,
      appeal_key  text NOT NULL CHECK (appeal_key = upper(btrim(appeal_key)) AND appeal_key <> ''),
      doc_type    text NOT NULL CHECK (doc_type IN ('facts', 'grounds', 'submission')),
      version     int  NOT NULL CHECK (version >= 1),
      body        text NOT NULL CHECK (length(body) <= 200000),
      status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
      source      text NOT NULL DEFAULT 'staff' CHECK (source IN ('ai', 'staff')),
      run_id      uuid,
      author_name text,
      search      tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, left(body, 100000))) STORED,
      created_at  timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT notice_appeal_drafts_one UNIQUE (client_id, appeal_key, doc_type, version)
    );
    COMMENT ON TABLE public.notice_appeal_drafts IS
      'An appeal''s drafts (statement of facts, grounds of appeal, written submission), every version kept; appeal_key is the reference of the order appealed. A final draft is a precedent for later appeals.';
    CREATE INDEX notice_appeal_drafts_case_idx ON public.notice_appeal_drafts (client_id, case_key);
    CREATE INDEX notice_appeal_drafts_search_idx ON public.notice_appeal_drafts USING gin (search);
    ALTER TABLE public.notice_appeal_drafts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY notice_appeal_drafts_public ON public.notice_appeal_drafts
      FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
  IF to_regclass('public.notice_appeal_ai_runs') IS NULL THEN
    CREATE TABLE public.notice_appeal_ai_runs (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id         uuid NOT NULL REFERENCES public.clients(id),
      case_key          text NOT NULL,
      appeal_key        text NOT NULL,
      doc_type          text NOT NULL CHECK (doc_type IN ('facts', 'grounds', 'submission')),
      mode              text NOT NULL CHECK (mode IN ('draft', 'improve')),
      instructions      text,
      input_text        text,
      status            text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
      output            jsonb,
      precedents        jsonb,
      draft_id          uuid,
      model             text,
      usage             jsonb,
      cost_usd          numeric,
      error             text,
      reason_class      text,
      requested_by_name text,
      created_at        timestamptz NOT NULL DEFAULT now(),
      finished_at       timestamptz
    );
    COMMENT ON TABLE public.notice_appeal_ai_runs IS
      'Each time the notice assistant drafted or improved an appeal document: what it was asked, the precedents it was given, its answer and the draft version it made.';
    CREATE INDEX notice_appeal_ai_runs_appeal_idx ON public.notice_appeal_ai_runs (client_id, appeal_key, created_at DESC);
    ALTER TABLE public.notice_appeal_ai_runs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY notice_appeal_ai_runs_public ON public.notice_appeal_ai_runs
      FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── A case's appeals ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_case_appeals(p_client_id uuid, p_case_key text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := public.notice_case_root(p_client_id, p_case_key);
  v_out jsonb;
BEGIN
  WITH filed_raw AS (
    -- The case folder's own APL-01 (the fuller record), then the portal's application.
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
  ), filed AS (
    SELECT arn,
           (SELECT f FROM filed_raw r WHERE r.arn = x.arn AND r.f ? 'order_ref' ORDER BY r.pri LIMIT 1) AS f,
           (SELECT r.f ->> 'portal_status' FROM filed_raw r WHERE r.arn = x.arn AND r.f ? 'portal_status' LIMIT 1) AS portal_status,
           (SELECT min((r.f ->> 'filed_on')::date) FROM filed_raw r WHERE r.arn = x.arn) AS filed_on
      FROM (SELECT DISTINCT arn FROM filed_raw) x
  ), appeals AS (
    SELECT upper(btrim(f ->> 'order_ref')) AS appeal_key, 'filed'::text AS status, arn, filed_on, portal_status, f
      FROM filed WHERE nullif(btrim(f ->> 'order_ref'), '') IS NOT NULL
    UNION ALL
    -- An order of the case an appeal lies against, with no appeal on record yet.
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
           'order_date', coalesce((a.f ->> 'order_date')::date, o.issue_date),
           'order_comm_date', (a.f ->> 'order_comm_date')::date,
           'order_form', o.form_code, 'order_notice_id', o.id,
           'last_day', (coalesce((a.f ->> 'order_comm_date')::date, (a.f ->> 'order_date')::date, o.issue_date) + interval '3 months')::date,
           'disputed_tax', a.f -> 'disputed_tax', 'disputed_total', a.f -> 'disputed_total',
           'predeposit', a.f -> 'predeposit', 'predeposit_pct', a.f -> 'predeposit_pct',
           'second_appeal', a.f -> 'second_appeal', 'issues', a.f -> 'issues',
           'demand', o.amount_of_demand,
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
                        ORDER BY g.issue_date DESC NULLS LAST LIMIT 1) o ON true;
  RETURN coalesce(v_out, '[]'::jsonb);
END;
$$;
COMMENT ON FUNCTION public.notice_case_appeals(uuid, text) IS
  'A case''s appeals: each APL-01 on record (filed) and each appealable order with none yet (to_file), keyed by the order''s reference, with the latest draft of each document.';

-- ── The order appealed, as read ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_appeal_order(p_client_id uuid, p_appeal_key text)
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH g AS (
    SELECT g.* FROM public.gst_notices g
     WHERE g.client_id = p_client_id AND g.deleted_at IS NULL AND upper(btrim(g.reference_number)) = upper(btrim(p_appeal_key))
     ORDER BY g.issue_date DESC NULLS LAST LIMIT 1
  )
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'reference', upper(btrim(p_appeal_key)),
    'form_code', (SELECT form_code FROM g), 'issue_date', (SELECT issue_date FROM g),
    'section_of_law', (SELECT section_of_law FROM g), 'financial_year', (SELECT financial_year FROM g),
    'period_from', (SELECT period_from FROM g), 'period_to', (SELECT period_to FROM g),
    'amount_of_demand', (SELECT amount_of_demand FROM g), 'issued_by', (SELECT issued_by FROM g),
    'description', (SELECT left(description, 600) FROM g),
    'reading', (SELECT left(x.detail ->> 'summary', 2000) FROM public.notice_extractions x, g
                 WHERE x.notice_id = g.id AND x.source = 'ai' AND x.status = 'done' ORDER BY x.finished_at DESC NULLS LAST LIMIT 1),
    'documents', (SELECT jsonb_agg(jsonb_build_object(
                     'title', coalesce(d.title, d.label), 'date', coalesce(d.doc_date, d.sort_date), 'summary', left(d.summary, 1500),
                     'outcome', d.outcome, 'key_facts', d.key_facts,
                     'paragraphs', (SELECT jsonb_agg(jsonb_build_object('kind', p ->> 'kind', 'para', p ->> 'para', 'text', left(p ->> 'text', 900)))
                                      FROM (SELECT p FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.paragraphs) = 'array' THEN d.paragraphs ELSE '[]'::jsonb END) p
                                            LIMIT 40) pp)))
                    FROM (SELECT d.* FROM public.ai_documents d
                           WHERE d.client_id = p_client_id AND d.status = 'done' AND d.source <> 'workspace'
                             AND (d.notice_id = (SELECT id FROM g)
                               OR d.folder_item_id IN (SELECT fi.id FROM public.gst_case_folder_items fi
                                                        WHERE fi.client_id = p_client_id AND fi.deleted_at IS NULL
                                                          AND upper(btrim(fi.reference_number)) = upper(btrim(p_appeal_key))
                                                          AND upper(coalesce(fi.folder_section, '')) NOT IN ('APLCN', 'REPLY', 'REPLIES')))
                           ORDER BY (d.role = 'order') DESC, coalesce(d.doc_date, d.sort_date) DESC NULLS LAST
                           LIMIT 3) d)))
$$;

-- ── Everything the assistant reads for one appeal document ─────────────────
CREATE OR REPLACE FUNCTION public.notice_appeal_context(p_client_id uuid, p_case_key text, p_appeal_key text, p_doc_type text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key      text := public.notice_case_root(p_client_id, p_case_key);
  v_ak       text := upper(btrim(p_appeal_key));
  v_appeal   jsonb;
  v_order    jsonb;
  v_case     jsonb;
  v_notices  uuid[];
  v_items    uuid[];
  v_caseids  text[];
  v_arn      text;
  v_docs     jsonb;
  v_appdocs  jsonb;
  v_replies  jsonb;
  v_issues   jsonb;
  v_drafts   jsonb;
  v_tsq      tsquery;
  v_prec     jsonb := '[]'::jsonb;
BEGIN
  SELECT a INTO v_appeal FROM jsonb_array_elements(public.notice_case_appeals(p_client_id, v_key)) a WHERE a ->> 'appeal_key' = v_ak LIMIT 1;
  IF v_appeal IS NULL THEN RETURN NULL; END IF;
  v_arn := v_appeal ->> 'arn';
  v_order := public.notice_appeal_order(p_client_id, v_ak);

  SELECT jsonb_strip_nulls(jsonb_build_object('client', c.client_name, 'gstin', c.client_gstin, 'title', c.title, 'forms', c.forms,
           'case_id', c.case_id, 'stage', c.stage_label, 'financial_years', c.financial_years, 'amount_of_demand', c.amount_of_demand,
           'exposure', c.exposure, 'first_issue_date', c.first_issue_date, 'today', c.today_ist))
    INTO v_case FROM public.notice_cases c WHERE c.client_id = p_client_id AND c.case_key = v_key;

  SELECT array_agg(f.id) INTO v_notices FROM public.notice_facts f
   WHERE f.client_id = p_client_id AND public.notice_case_key(f.client_id, f.case_id, f.category, f.id) = v_key;
  SELECT array_agg(fi.id), array_agg(DISTINCT upper(btrim(fi.case_id))) INTO v_items, v_caseids FROM public.gst_case_folder_items fi
   WHERE fi.client_id = p_client_id AND fi.deleted_at IS NULL AND public.notice_case_root(fi.client_id, fi.case_id) = v_key;
  v_caseids := coalesce(v_caseids, '{}') || coalesce((SELECT array_agg(DISTINCT upper(btrim(f.case_id))) FROM public.notice_facts f
                                                       WHERE f.id = ANY (coalesce(v_notices, '{}')) AND f.case_id IS NOT NULL), '{}');

  -- The case's documents as read, oldest first (the story), with what staff named them.
  SELECT jsonb_agg(x.j ORDER BY x.dt NULLS FIRST) INTO v_docs FROM (
    SELECT coalesce(d.doc_date, d.sort_date) AS dt, jsonb_strip_nulls(jsonb_build_object(
             'title', coalesce(l.title, d.title, d.label), 'role', d.role, 'doc_kind', d.doc_kind, 'section', d.folder_section,
             'date', coalesce(d.doc_date, d.sort_date), 'reference', d.reference, 'outcome', d.outcome,
             'evidence', CASE WHEN coalesce(l.is_evidence, d.role = 'reply_support') THEN coalesce(l.evidence_type, 'supporting') END,
             'staff_note', l.note, 'summary', left(d.summary, 900), 'key_facts', d.key_facts,
             'paragraphs', (SELECT jsonb_agg(jsonb_build_object('kind', p ->> 'kind', 'para', p ->> 'para', 'text', left(p ->> 'text', 500)))
                              FROM (SELECT p FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.paragraphs) = 'array' THEN d.paragraphs ELSE '[]'::jsonb END) p
                                    LIMIT 8) pp))) AS j
      FROM public.ai_documents d
      LEFT JOIN public.case_document_labels l ON l.client_id = d.client_id AND l.doc_key = d.url
      LEFT JOIN public.gst_case_folder_items fi ON fi.id = d.folder_item_id
     WHERE d.client_id = p_client_id AND d.status = 'done' AND d.source <> 'workspace'
       AND (d.notice_id = ANY (coalesce(v_notices, '{}')) OR d.folder_item_id = ANY (coalesce(v_items, '{}')))
       AND (v_arn IS NULL OR fi.id IS NULL OR upper(btrim(fi.case_id)) <> v_arn)
       AND (fi.id IS NULL OR upper(btrim(coalesce(fi.reference_number, ''))) <> v_ak OR upper(coalesce(fi.folder_section, '')) IN ('APLCN', 'REPLY', 'REPLIES'))
     ORDER BY public.ai_role_priority(d.role) DESC, coalesce(d.doc_date, d.sort_date) DESC NULLS LAST
     LIMIT 30) x;

  -- The appeal's own papers on the portal (its APL-01, the grounds as filed, annexures).
  IF v_arn IS NOT NULL THEN
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('title', coalesce(d.title, d.label), 'date', coalesce(d.doc_date, d.sort_date),
             'summary', left(d.summary, 1500),
             'paragraphs', (SELECT jsonb_agg(jsonb_build_object('kind', p ->> 'kind', 'para', p ->> 'para', 'text', left(p ->> 'text', 900)))
                              FROM (SELECT p FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.paragraphs) = 'array' THEN d.paragraphs ELSE '[]'::jsonb END) p
                                    LIMIT 30) pp))))
      INTO v_appdocs
      FROM public.ai_documents d JOIN public.gst_case_folder_items fi ON fi.id = d.folder_item_id
     WHERE d.client_id = p_client_id AND d.status = 'done' AND fi.deleted_at IS NULL AND upper(btrim(fi.case_id)) = v_arn;
  END IF;

  -- The firm's replies in the case (the latest draft of each notice) and the issues with staff's positions.
  SELECT jsonb_agg(jsonb_build_object('notice', coalesce(f.form_code, 'Notice') || coalesce(' ' || f.reference_number, ''),
           'date', f.issue_date, 'status', d.status, 'body', left(d.body, 6000)) ORDER BY f.issue_date NULLS FIRST)
    INTO v_replies
    FROM public.notice_facts f
    JOIN LATERAL (SELECT * FROM public.notice_drafts nd WHERE nd.notice_id = f.id AND btrim(coalesce(nd.body, '')) <> ''
                   ORDER BY nd.version DESC LIMIT 1) d ON true
   WHERE f.id = ANY (coalesce(v_notices, '{}'));
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('notice', f.form_code, 'seq', ni.seq, 'title', ni.title, 'issue_code', ni.issue_code,
           'detail', left(ni.detail, 800), 'amount', ni.amount, 'explained_amount', ni.explained_amount, 'status', ni.status,
           'position', left(ni.position, 2000))) ORDER BY f.issue_date NULLS FIRST, ni.seq)
    INTO v_issues
    FROM public.notice_issues ni JOIN public.notice_facts f ON f.id = ni.notice_id
   WHERE ni.notice_id = ANY (coalesce(v_notices, '{}'));

  -- The appeal's drafts as they stand (grounds build on the facts, the submission on both).
  SELECT jsonb_object_agg(d.doc_type, jsonb_build_object('version', d.version, 'status', d.status, 'body', left(d.body, 30000)))
    INTO v_drafts
    FROM (SELECT DISTINCT ON (doc_type) * FROM public.notice_appeal_drafts dd
           WHERE dd.client_id = p_client_id AND dd.appeal_key = v_ak ORDER BY doc_type, version DESC) d;

  -- Precedents: the firm's appeals and replies on other cases, closest to the order first.
  SELECT (SELECT string_agg(quote_literal(u.lexeme), ' | ')
            FROM unnest(to_tsvector('english'::regconfig, left(concat_ws(' ', v_order ->> 'reading', v_order ->> 'description',
                   (SELECT string_agg(concat_ws(' ', e ->> 'summary', (SELECT string_agg(p ->> 'text', ' ') FROM jsonb_array_elements(coalesce(e -> 'paragraphs', '[]'::jsonb)) p)), ' ')
                      FROM jsonb_array_elements(coalesce(v_order -> 'documents', '[]'::jsonb)) e),
                   (SELECT string_agg(x, ' ') FROM jsonb_array_elements_text(coalesce(v_appeal -> 'issues', '[]'::jsonb)) x)), 8000))) u
           WHERE length(u.lexeme) > 3)::tsquery
    INTO v_tsq;

  IF v_tsq IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(p.j ORDER BY p.score DESC), '[]'::jsonb) INTO v_prec FROM (
      -- The firm's appeals filed on other cases (their APL-01 papers as read).
      (SELECT ts_rank_cd(to_tsvector('english'::regconfig, left(concat_ws(' ', d.title, d.summary,
                (SELECT string_agg(p ->> 'text', ' ') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.paragraphs) = 'array' THEN d.paragraphs ELSE '[]'::jsonb END) p)), 60000)), v_tsq, 32)
              + CASE WHEN d.client_id = p_client_id THEN 0.1 ELSE 0 END AS score,
              jsonb_strip_nulls(jsonb_build_object('id', d.id, 'kind', 'filed_appeal', 'same_client', d.client_id = p_client_id,
                'title', coalesce(d.title, d.label), 'date', coalesce(d.doc_date, d.sort_date), 'summary', left(d.summary, 1200),
                'paragraphs', (SELECT jsonb_agg(jsonb_build_object('kind', p ->> 'kind', 'text', left(p ->> 'text', 900)))
                                 FROM (SELECT p FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.paragraphs) = 'array' THEN d.paragraphs ELSE '[]'::jsonb END) p
                                       LIMIT 14) pp))) AS j
         FROM public.ai_documents d
         JOIN public.gst_case_folder_items fi ON fi.id = d.folder_item_id AND fi.deleted_at IS NULL
         JOIN public.clients c ON c.id = d.client_id
        WHERE d.status = 'done' AND d.role = 'application' AND upper(coalesce(fi.folder_section, '')) = 'APLCN'
          AND public.notice_is_appeal_form(fi.raw_json)
          AND NOT (d.client_id = p_client_id AND upper(btrim(coalesce(d.case_id, ''))) = ANY (v_caseids))
          AND (d.client_id = p_client_id OR c.ai_learning OR d.learning_included)
          AND to_tsvector('english'::regconfig, left(concat_ws(' ', d.title, d.summary), 20000)) @@ v_tsq
        ORDER BY 1 DESC LIMIT 4)
      UNION ALL
      -- The firm's replies on other cases (how it argued the same points before).
      (SELECT ts_rank_cd(to_tsvector('english'::regconfig, left(concat_ws(' ', d.title, d.summary,
                (SELECT string_agg(p ->> 'text', ' ') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.paragraphs) = 'array' THEN d.paragraphs ELSE '[]'::jsonb END) p)), 60000)), v_tsq, 32)
              + CASE WHEN d.client_id = p_client_id THEN 0.1 ELSE 0 END,
              jsonb_strip_nulls(jsonb_build_object('id', d.id, 'kind', 'reply', 'same_client', d.client_id = p_client_id,
                'title', coalesce(d.title, d.label), 'date', coalesce(d.doc_date, d.sort_date), 'summary', left(d.summary, 1200),
                'paragraphs', (SELECT jsonb_agg(jsonb_build_object('kind', p ->> 'kind', 'text', left(p ->> 'text', 900)))
                                 FROM (SELECT p FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.paragraphs) = 'array' THEN d.paragraphs ELSE '[]'::jsonb END) p
                                       LIMIT 10) pp)))
         FROM public.ai_documents d
         JOIN public.clients c ON c.id = d.client_id
        WHERE d.status = 'done' AND d.role = 'reply' AND d.source <> 'workspace'
          AND NOT (d.client_id = p_client_id AND (upper(btrim(coalesce(d.case_id, ''))) = ANY (v_caseids) OR d.notice_id = ANY (coalesce(v_notices, '{}'))))
          AND (d.client_id = p_client_id OR c.ai_learning OR d.learning_included)
          AND to_tsvector('english'::regconfig, left(concat_ws(' ', d.title, d.summary), 20000)) @@ v_tsq
        ORDER BY 1 DESC LIMIT 3)
      UNION ALL
      -- Appeal documents of the same kind the firm marked final on other appeals.
      (SELECT ts_rank_cd(ad.search, v_tsq, 32) + 0.2 + CASE WHEN ad.client_id = p_client_id THEN 0.1 ELSE 0 END,
              jsonb_build_object('id', ad.id, 'kind', 'final_' || ad.doc_type, 'same_client', ad.client_id = p_client_id,
                'title', CASE ad.doc_type WHEN 'facts' THEN 'Statement of facts' WHEN 'grounds' THEN 'Grounds of appeal' ELSE 'Written submission' END
                         || ' against ' || ad.appeal_key, 'date', ad.created_at::date, 'body', left(ad.body, 9000))
         FROM (SELECT DISTINCT ON (dd.client_id, dd.appeal_key) dd.* FROM public.notice_appeal_drafts dd
                WHERE dd.status = 'final' AND dd.doc_type = p_doc_type AND NOT (dd.client_id = p_client_id AND dd.appeal_key = v_ak)
                ORDER BY dd.client_id, dd.appeal_key, dd.version DESC) ad
         JOIN public.clients c ON c.id = ad.client_id
        WHERE (ad.client_id = p_client_id OR c.ai_learning) AND ad.search @@ v_tsq
        ORDER BY 1 DESC LIMIT 2)
    ) p;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'doc_type', p_doc_type, 'case', v_case, 'appeal', v_appeal, 'order', v_order,
    'documents', coalesce(v_docs, '[]'::jsonb), 'appeal_documents', coalesce(v_appdocs, '[]'::jsonb),
    'replies', coalesce(v_replies, '[]'::jsonb), 'issues', coalesce(v_issues, '[]'::jsonb),
    'drafts', coalesce(v_drafts, '{}'::jsonb), 'precedents', v_prec));
END;
$$;

-- ── Start a run (the Draft / Improve buttons) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_appeal_ai_begin(
  p_client_id uuid, p_case_key text, p_appeal_key text, p_doc_type text, p_mode text,
  p_text text DEFAULT NULL, p_instructions text DEFAULT NULL, p_actor text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s   public.ai_settings;
  v_why text;
  v_key text := public.notice_case_root(p_client_id, p_case_key);
  v_ak  text := upper(btrim(p_appeal_key));
  v_ctx jsonb;
  v_run uuid;
BEGIN
  IF p_doc_type NOT IN ('facts', 'grounds', 'submission') OR p_mode NOT IN ('draft', 'improve') THEN
    RETURN jsonb_build_object('error', 'bad_request');
  END IF;
  SELECT * INTO v_s FROM public.ai_settings WHERE id;
  IF NOT coalesce(v_s.read_enabled, false) THEN RETURN jsonb_build_object('error', 'off'); END IF;
  v_why := public.ai_read_allowed(p_client_id);
  IF v_why IS NOT NULL THEN RETURN jsonb_build_object('error', v_why); END IF;
  IF public.ai_assist_spend_today_usd() >= v_s.assist_daily_cap_usd THEN RETURN jsonb_build_object('error', 'capped'); END IF;
  IF p_mode = 'improve' AND btrim(coalesce(p_text, '')) = '' THEN RETURN jsonb_build_object('error', 'no_text'); END IF;
  -- A run left running for more than ten minutes ended without an answer.
  UPDATE public.notice_appeal_ai_runs SET status = 'failed', error = 'The run ended without an answer (took too long).',
         reason_class = 'timeout', finished_at = now()
   WHERE client_id = p_client_id AND appeal_key = v_ak AND status = 'running' AND created_at < now() - interval '10 minutes';
  IF EXISTS (SELECT 1 FROM public.notice_appeal_ai_runs WHERE client_id = p_client_id AND appeal_key = v_ak
                AND doc_type = p_doc_type AND status = 'running') THEN
    RETURN jsonb_build_object('error', 'busy');
  END IF;
  v_ctx := public.notice_appeal_context(p_client_id, v_key, v_ak, p_doc_type);
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  INSERT INTO public.notice_appeal_ai_runs (client_id, case_key, appeal_key, doc_type, mode, instructions, input_text, precedents, model, requested_by_name)
  VALUES (p_client_id, v_key, v_ak, p_doc_type, p_mode, nullif(left(btrim(coalesce(p_instructions, '')), 4000), ''),
          nullif(btrim(coalesce(p_text, '')), ''), v_ctx -> 'precedents', v_s.model, left(p_actor, 120))
  RETURNING id INTO v_run;
  RETURN jsonb_build_object('run_id', v_run,
    'settings', jsonb_build_object('model', v_s.model, 'effort', v_s.assist_effort),
    'context', v_ctx || jsonb_strip_nulls(jsonb_build_object('mode', p_mode,
      'instructions', nullif(btrim(coalesce(p_instructions, '')), ''), 'text', nullif(btrim(coalesce(p_text, '')), ''))));
END;
$$;

-- ── Keep the answer: a new version of the document ─────────────────────────
-- p_output: {"title", "sections": [{"heading", "text", "precedents_used"}], "prayer",
-- "client_questions", "cautions", "precedents_used": [ids]}.
CREATE OR REPLACE FUNCTION public.notice_appeal_ai_finish(
  p_run_id uuid, p_status text, p_output jsonb DEFAULT NULL, p_usage jsonb DEFAULT NULL,
  p_error text DEFAULT NULL, p_reason_class text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r    public.notice_appeal_ai_runs;
  v_s    public.ai_settings;
  v_cost numeric;
  v_out  jsonb := p_output;
  v_text text;
  v_ver  int;
  v_did  uuid;
BEGIN
  SELECT * INTO v_r FROM public.notice_appeal_ai_runs WHERE id = p_run_id FOR UPDATE;
  IF v_r.id IS NULL THEN RETURN jsonb_build_object('error', 'gone'); END IF;
  IF v_r.status <> 'running' THEN RETURN jsonb_build_object('error', 'finished'); END IF;
  SELECT * INTO v_s FROM public.ai_settings WHERE id;
  IF p_usage IS NOT NULL AND p_usage ? 'input_tokens' THEN
    v_cost := round((coalesce((p_usage ->> 'input_tokens')::numeric, 0) * v_s.price_in_per_mtok
                   + coalesce((p_usage ->> 'output_tokens')::numeric, 0) * v_s.price_out_per_mtok) / 1000000, 4);
    INSERT INTO public.ai_audit_log (purpose, client_id, model, input_tokens, output_tokens, cost_usd,
                                     request_id, duration_ms, status, error, agent_id, requested_by_name)
    VALUES ('assist', v_r.client_id, coalesce(p_usage ->> 'model', v_r.model),
            (p_usage ->> 'input_tokens')::int, (p_usage ->> 'output_tokens')::int, v_cost,
            p_usage ->> 'request_id', (p_usage ->> 'duration_ms')::int,
            CASE WHEN p_usage ->> 'status' IN ('ok', 'refused', 'error') THEN p_usage ->> 'status' ELSE 'ok' END,
            left(p_error, 500), 'edge:appeal', v_r.requested_by_name);
  END IF;
  IF p_status IS DISTINCT FROM 'done' OR v_out IS NULL THEN
    UPDATE public.notice_appeal_ai_runs SET status = 'failed', error = left(coalesce(p_error, 'No answer.'), 1000),
           reason_class = left(p_reason_class, 60), usage = p_usage, cost_usd = v_cost, finished_at = now()
     WHERE id = v_r.id;
    RETURN (SELECT to_jsonb(r) FROM public.notice_appeal_ai_runs r WHERE r.id = v_r.id);
  END IF;

  -- Every heading and text without a hyphen or dash, then the document as one text.
  v_out := v_out || jsonb_build_object(
    'title', public.reply_dehyphen(coalesce(v_out ->> 'title', '')),
    'prayer', public.reply_dehyphen(coalesce(v_out ->> 'prayer', '')),
    'sections', (SELECT coalesce(jsonb_agg(s || jsonb_build_object('heading', public.reply_dehyphen(coalesce(s ->> 'heading', '')),
                                                                    'text', public.reply_dehyphen(coalesce(s ->> 'text', ''))) ORDER BY n), '[]'::jsonb)
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_out -> 'sections') = 'array' THEN v_out -> 'sections' ELSE '[]'::jsonb END)
                        WITH ORDINALITY e(s, n)));
  v_text := concat_ws(E'\n\n',
    nullif(v_out ->> 'title', ''),
    (SELECT string_agg(btrim(concat_ws(E'\n\n', nullif(s ->> 'heading', ''), s ->> 'text')), E'\n\n' ORDER BY n)
       FROM jsonb_array_elements(v_out -> 'sections') WITH ORDINALITY e(s, n) WHERE btrim(coalesce(s ->> 'text', '')) <> ''),
    CASE WHEN nullif(v_out ->> 'prayer', '') IS NOT NULL THEN 'Prayer' || E'\n\n' || (v_out ->> 'prayer') END);
  IF btrim(coalesce(v_text, '')) = '' THEN
    UPDATE public.notice_appeal_ai_runs SET status = 'failed', error = 'The answer was empty.', reason_class = 'empty',
           usage = p_usage, cost_usd = v_cost, finished_at = now(), output = v_out
     WHERE id = v_r.id;
    RETURN (SELECT to_jsonb(r) FROM public.notice_appeal_ai_runs r WHERE r.id = v_r.id);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('notice_appeal_drafts:' || v_r.client_id::text || ':' || v_r.appeal_key || ':' || v_r.doc_type));
  SELECT coalesce(max(version), 0) + 1 INTO v_ver FROM public.notice_appeal_drafts
   WHERE client_id = v_r.client_id AND appeal_key = v_r.appeal_key AND doc_type = v_r.doc_type;
  INSERT INTO public.notice_appeal_drafts (client_id, case_key, appeal_key, doc_type, version, body, status, source, run_id, author_name)
  VALUES (v_r.client_id, v_r.case_key, v_r.appeal_key, v_r.doc_type, v_ver, left(v_text, 200000), 'draft', 'ai', v_r.id,
          coalesce(v_r.requested_by_name, 'AI assistant'))
  RETURNING id INTO v_did;
  UPDATE public.notice_appeal_ai_runs SET status = 'done', output = v_out, usage = p_usage, cost_usd = v_cost,
         model = coalesce(p_usage ->> 'model', model), draft_id = v_did, finished_at = now()
   WHERE id = v_r.id;
  RETURN (SELECT to_jsonb(r) FROM public.notice_appeal_ai_runs r WHERE r.id = v_r.id);
END;
$$;
REVOKE ALL ON FUNCTION public.notice_appeal_ai_finish(uuid, text, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;

-- ── Staff save a version (edited text, or marked final) ────────────────────
-- p_expect_version: the version the page loaded (0 for none); a newer one
-- saved meanwhile refuses the save, so nobody's edit is lost.
CREATE OR REPLACE FUNCTION public.notice_appeal_draft_save(
  p_client_id uuid, p_case_key text, p_appeal_key text, p_doc_type text, p_body text, p_status text,
  p_expect_version int, p_actor text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ak  text := upper(btrim(p_appeal_key));
  v_cur int;
  v_row public.notice_appeal_drafts;
BEGIN
  IF p_doc_type NOT IN ('facts', 'grounds', 'submission') OR p_status NOT IN ('draft', 'final') OR v_ak = '' THEN
    RETURN jsonb_build_object('error', 'bad_request');
  END IF;
  IF btrim(coalesce(p_body, '')) = '' THEN RETURN jsonb_build_object('error', 'empty'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('notice_appeal_drafts:' || p_client_id::text || ':' || v_ak || ':' || p_doc_type));
  SELECT coalesce(max(version), 0) INTO v_cur FROM public.notice_appeal_drafts
   WHERE client_id = p_client_id AND appeal_key = v_ak AND doc_type = p_doc_type;
  IF v_cur <> coalesce(p_expect_version, 0) THEN RETURN jsonb_build_object('error', 'stale', 'version', v_cur); END IF;
  INSERT INTO public.notice_appeal_drafts (client_id, case_key, appeal_key, doc_type, version, body, status, source, author_name)
  VALUES (p_client_id, public.notice_case_root(p_client_id, p_case_key), v_ak, p_doc_type, v_cur + 1,
          public.reply_dehyphen(p_body), p_status, 'staff', left(p_actor, 120))
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('version', v_row.version, 'status', v_row.status, 'id', v_row.id);
END;
$$;
