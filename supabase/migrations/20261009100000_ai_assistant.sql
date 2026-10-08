-- Notices Phase 7 · Notice Response AI Assistant (the firm's request of 7 October
-- 2026): the Claude API reads every notice, attachment and reply, from Supabase
-- itself (the Edge Function notice-ai, with an ANTHROPIC_API_KEY secret), keeps the
-- firm's own replies as paragraph-to-response examples, and drafts replies from the
-- examples an admin chose to keep. Read docs/REPLY_FACTORY_POSITIONS.md §13 first.
--
-- Requires 20261008180000_notice_types_hidden.sql (notice_type_hidden).
--
-- Still SWITCHED OFF until a manager turns on ai_settings.read_enabled. Nothing of
-- a client is sent while the client has no consent date (or opted out), unless the
-- firm sets consent_scope to every client. Spending stops at the day's caps:
-- daily_cap_usd for reading, assist_daily_cap_usd for the assistant.
--
-- Objects: ai_settings (runner, consent_scope, read_backfill, read_documents,
-- doc_effort, doc_max_pages, assist_effort, assist_daily_cap_usd,
-- learning_auto_include, edge_seconds), ai_runner_status, ai_documents,
-- ai_learning_pairs, ai_assist_runs, ai_learning_responses (view); ai_read_allowed,
-- ai_spend_today_usd, ai_assist_spend_today_usd, notice_read_claim (runner check),
-- ai_documents_register_item, ai_documents_register_draft, ai_issue_position_learn,
-- ai_sync, ai_jobs_reap, ai_claim_next, ai_document_hash, ai_document_finish,
-- ai_documents_request, ai_documents_retry, ai_learning_select,
-- ai_learning_select_where, ai_learning_pair_set, ai_learning_examples,
-- ai_assist_begin, ai_assist_finish, ai_assist_feedback, ai_runner_begin,
-- ai_runner_end, ai_job_release, ai_tick_dispatch (+ pg_cron notice-ai-tick), ai_read_status.

-- ── Settings ───────────────────────────────────────────────────────────────
ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS runner                text    NOT NULL DEFAULT 'edge' CHECK (runner IN ('edge', 'office_agent')),
  ADD COLUMN IF NOT EXISTS consent_scope         text    NOT NULL DEFAULT 'consented' CHECK (consent_scope IN ('consented', 'all_clients')),
  ADD COLUMN IF NOT EXISTS read_backfill         boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS read_documents        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS doc_effort            text    NOT NULL DEFAULT 'low' CHECK (doc_effort IN ('low', 'medium', 'high', 'xhigh', 'max')),
  ADD COLUMN IF NOT EXISTS doc_max_pages         int     NOT NULL DEFAULT 40 CHECK (doc_max_pages BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS assist_effort         text    NOT NULL DEFAULT 'high' CHECK (assist_effort IN ('low', 'medium', 'high', 'xhigh', 'max')),
  ADD COLUMN IF NOT EXISTS assist_daily_cap_usd  numeric NOT NULL DEFAULT 5 CHECK (assist_daily_cap_usd >= 0),
  ADD COLUMN IF NOT EXISTS learning_auto_include boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS edge_seconds          int     NOT NULL DEFAULT 140 CHECK (edge_seconds BETWEEN 60 AND 400);
COMMENT ON COLUMN public.ai_settings.runner IS
  'Who reads: edge (the Supabase Edge Function notice-ai, with the ANTHROPIC_API_KEY secret; the default since 7 Oct 2026) or office_agent (agent/ on an office PC, with the key in agent/.env).';
COMMENT ON COLUMN public.ai_settings.consent_scope IS
  'consented: only clients with a consent date (clients.ai_consent_at); all_clients: every client that has not opted out.';
COMMENT ON COLUMN public.ai_settings.read_backfill IS 'Also read notices from before reading was switched on (oldest last), not only new ones.';
COMMENT ON COLUMN public.ai_settings.read_documents IS 'Also read the case folder''s attachments, replies and orders, and the approved drafts.';
COMMENT ON COLUMN public.ai_settings.learning_auto_include IS
  'New replies join the assistant''s examples by themselves. Off: an admin picks them (Reply Factory · Learning).';
COMMENT ON COLUMN public.ai_settings.edge_seconds IS
  'Seconds one run of the Edge Function may take (the plan''s wall clock: 150 on the free plan, 400 on a paid plan).';

-- ── The Edge runner's own status (one row) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_runner_status (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_tick_at   timestamptz,
  last_work_at   timestamptz,
  last_sync_at   timestamptz,
  last_error     text,
  last_error_at  timestamptz,
  key_ok         boolean,
  version        text,
  lease_holder   text,
  lease_until    timestamptz
);
COMMENT ON TABLE public.ai_runner_status IS
  'The notice-ai Edge Function''s heartbeat: when it last ran and worked, whether the ANTHROPIC_API_KEY secret is set and accepted, the last error, and the lease that keeps two runs from overlapping.';
INSERT INTO public.ai_runner_status (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.ai_runner_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_runner_status_all ON public.ai_runner_status;
CREATE POLICY ai_runner_status_all ON public.ai_runner_status FOR ALL TO public USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ai_runner_status FROM anon, authenticated;
GRANT SELECT ON public.ai_runner_status TO anon, authenticated;
GRANT ALL ON public.ai_runner_status TO service_role;

-- ── Every document the AI reads, besides the notice's own PDF ──────────────
-- source folder: an attachment in a case folder (notice, reply, order, application);
-- draft: a notice's reply draft once sent for review or approved (text);
-- workspace: what staff typed on the notice page (issue positions, assistant
-- paragraphs used), kept as examples without being read.
CREATE TABLE IF NOT EXISTS public.ai_documents (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  notice_id                 uuid REFERENCES public.gst_notices (id) ON DELETE SET NULL,
  case_id                   text,
  folder_item_id            uuid REFERENCES public.gst_case_folder_items (id) ON DELETE SET NULL,
  draft_id                  uuid REFERENCES public.notice_drafts (id) ON DELETE SET NULL,
  source                    text NOT NULL CHECK (source IN ('folder', 'draft', 'workspace')),
  source_ref                text NOT NULL,
  folder_section            text,
  role                      text NOT NULL CHECK (role IN ('notice', 'reply', 'reply_support', 'order', 'application', 'other')),
  url                       text,
  label                     text,
  body                      text,
  context                   jsonb,
  sort_date                 date,
  priority                  int  NOT NULL DEFAULT 10,
  status                    text NOT NULL DEFAULT 'queued'
                            CHECK (status IN ('queued', 'running', 'done', 'failed', 'skipped', 'cancelled')),
  attempts                  int  NOT NULL DEFAULT 0,
  not_before                timestamptz,
  agent_id                  text,
  claimed_at                timestamptz,
  finished_at               timestamptz,
  document_sha256           text,
  pages                     int,
  text_layer                boolean,
  model                     text,
  usage                     jsonb,
  doc_kind                  text,
  title                     text,
  summary                   text,
  doc_date                  date,
  reference                 text,
  outcome                   text,
  paragraphs                jsonb,
  key_facts                 jsonb,
  error                     text,
  reason_class              text,
  learning_included         boolean NOT NULL DEFAULT false,
  learning_decided_by_name  text,
  learning_decided_at       timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_ref)
);
COMMENT ON TABLE public.ai_documents IS
  'Every document the AI reads besides the notice PDF (case-folder attachments, replies, orders, approved drafts), with what it found: kind, summary, paragraphs (allegations, responses, findings) and key facts. Replies (role reply) are the firm''s responses: learning_included says whether an admin chose to keep them as the assistant''s examples.';
CREATE INDEX IF NOT EXISTS idx_ai_documents_queue ON public.ai_documents (status, priority DESC, sort_date DESC) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_ai_documents_case ON public.ai_documents (client_id, case_id);
CREATE INDEX IF NOT EXISTS idx_ai_documents_notice ON public.ai_documents (notice_id);
CREATE INDEX IF NOT EXISTS idx_ai_documents_sha ON public.ai_documents (document_sha256) WHERE document_sha256 IS NOT NULL;
ALTER TABLE public.ai_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_documents_all ON public.ai_documents;
CREATE POLICY ai_documents_all ON public.ai_documents FOR ALL TO public USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ai_documents FROM anon, authenticated;
GRANT SELECT ON public.ai_documents TO anon, authenticated;
GRANT ALL ON public.ai_documents TO service_role;
DROP TRIGGER IF EXISTS trg_ai_documents_updated_at ON public.ai_documents;
CREATE TRIGGER trg_ai_documents_updated_at BEFORE UPDATE ON public.ai_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Learning: a notice's paragraph and the firm's response to it ───────────
CREATE TABLE IF NOT EXISTS public.ai_learning_pairs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      uuid NOT NULL REFERENCES public.ai_documents (id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  notice_id        uuid REFERENCES public.gst_notices (id) ON DELETE SET NULL,
  issue_id         uuid,
  case_id          text,
  origin           text NOT NULL CHECK (origin IN ('portal_reply', 'draft', 'position', 'assistant_edit')),
  form_code        text,
  section_of_law   text,
  financial_year   text,
  issue_code       text NOT NULL DEFAULT 'OTHER',
  issue_title      text,
  allegation       text NOT NULL CHECK (btrim(allegation) <> ''),
  response         text NOT NULL CHECK (btrim(response) <> ''),
  ai_text          text,
  seq              int,
  page             int,
  verified         boolean NOT NULL DEFAULT false,
  outcome          text,
  included         boolean NOT NULL DEFAULT false,
  decided_by_name  text,
  decided_at       timestamptz,
  uses             int NOT NULL DEFAULT 0,
  last_used_at     timestamptz,
  search           tsvector GENERATED ALWAYS AS (
                     to_tsvector('english'::regconfig, coalesce(issue_title, '') || ' ' || allegation)) STORED,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ai_learning_pairs IS
  'The firm''s own answers, paragraph by paragraph: what a notice alleged (allegation) and how the firm responded (response), from filed portal replies, approved drafts, issue positions typed by staff and assistant paragraphs staff edited and used (ai_text keeps what the assistant had suggested). Only included pairs are given to the assistant as examples; an admin decides.';
CREATE INDEX IF NOT EXISTS idx_ai_learning_pairs_doc ON public.ai_learning_pairs (document_id);
CREATE INDEX IF NOT EXISTS idx_ai_learning_pairs_search ON public.ai_learning_pairs USING gin (search);
CREATE INDEX IF NOT EXISTS idx_ai_learning_pairs_code ON public.ai_learning_pairs (issue_code) WHERE included;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_learning_pairs_issue ON public.ai_learning_pairs (issue_id, origin)
  WHERE issue_id IS NOT NULL AND origin IN ('position', 'assistant_edit');
ALTER TABLE public.ai_learning_pairs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_learning_pairs_all ON public.ai_learning_pairs;
CREATE POLICY ai_learning_pairs_all ON public.ai_learning_pairs FOR ALL TO public USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ai_learning_pairs FROM anon, authenticated;
GRANT SELECT ON public.ai_learning_pairs TO anon, authenticated;
GRANT ALL ON public.ai_learning_pairs TO service_role;
DROP TRIGGER IF EXISTS trg_ai_learning_pairs_updated_at ON public.ai_learning_pairs;
CREATE TRIGGER trg_ai_learning_pairs_updated_at BEFORE UPDATE ON public.ai_learning_pairs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── The assistant's runs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_assist_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id         uuid NOT NULL REFERENCES public.gst_notices (id) ON DELETE CASCADE,
  client_id         uuid NOT NULL,
  issue_id          uuid,
  mode              text NOT NULL CHECK (mode IN ('draft', 'ask', 'improve')),
  question          text,
  input_text        text,
  status            text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  output            jsonb,
  answer            text,
  examples          jsonb,
  examples_used     uuid[],
  model             text,
  usage             jsonb,
  cost_usd          numeric,
  error             text,
  reason_class      text,
  requested_by_name text,
  feedback          text CHECK (feedback IN ('used', 'discarded')),
  final_text        text,
  feedback_by_name  text,
  feedback_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz
);
COMMENT ON TABLE public.ai_assist_runs IS
  'Each request to the Notice Response AI Assistant: draft (a reply paragraph per issue), ask (a question about the notice) or improve (rewrite a text), what it answered, which learned examples it was given and used, its cost, and what staff did with it (used, with the text as finally edited, or discarded).';
CREATE INDEX IF NOT EXISTS idx_ai_assist_runs_notice ON public.ai_assist_runs (notice_id, created_at DESC);
ALTER TABLE public.ai_assist_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_assist_runs_all ON public.ai_assist_runs;
CREATE POLICY ai_assist_runs_all ON public.ai_assist_runs FOR ALL TO public USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ai_assist_runs FROM anon, authenticated;
GRANT SELECT ON public.ai_assist_runs TO anon, authenticated;
GRANT ALL ON public.ai_assist_runs TO service_role;

-- ── Who may be read ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ai_read_allowed(p_client_id uuid)
RETURNS text
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN NOT coalesce(s.read_enabled, false) THEN 'off'
           WHEN c.id IS NULL THEN 'no_client'
           WHEN coalesce(c.ai_opt_out, false) THEN 'opted_out'
           WHEN c.ai_consent_at IS NULL AND coalesce(s.consent_scope, 'consented') <> 'all_clients' THEN 'no_consent'
         END
    FROM (SELECT 1) one
    LEFT JOIN public.ai_settings s ON s.id
    LEFT JOIN public.clients c ON c.id = p_client_id
$$;

-- Reading's spend today (IST day); the assistant has its own cap.
CREATE OR REPLACE FUNCTION public.ai_spend_today_usd()
RETURNS numeric
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(cost_usd), 0) FROM public.ai_audit_log
   WHERE at >= (((now() AT TIME ZONE 'Asia/Kolkata')::date)::timestamp AT TIME ZONE 'Asia/Kolkata')
     AND purpose <> 'assist'
$$;

CREATE OR REPLACE FUNCTION public.ai_assist_spend_today_usd()
RETURNS numeric
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(cost_usd), 0) FROM public.ai_audit_log
   WHERE at >= (((now() AT TIME ZONE 'Asia/Kolkata')::date)::timestamp AT TIME ZONE 'Asia/Kolkata')
     AND purpose = 'assist'
$$;
GRANT EXECUTE ON FUNCTION public.ai_assist_spend_today_usd() TO anon, authenticated, service_role;

-- The office agent's claim (20261008110000), now only while the office agent is
-- the runner: the Edge Function claims through ai_claim_next.
CREATE OR REPLACE FUNCTION public.notice_read_claim(p_agent text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s  public.ai_settings;
  v_x  public.notice_extractions;
  v_why text;
  v_g  record;
  i    int := 0;
BEGIN
  SELECT * INTO v_s FROM public.ai_settings WHERE id;
  IF NOT coalesce(v_s.read_enabled, false) THEN RETURN NULL; END IF;
  IF coalesce(v_s.runner, 'edge') <> 'office_agent' THEN RETURN NULL; END IF;
  IF public.ai_spend_today_usd() >= v_s.daily_cap_usd THEN RETURN jsonb_build_object('capped', true); END IF;
  LOOP
    i := i + 1;
    EXIT WHEN i > 20;
    SELECT * INTO v_x FROM public.notice_extractions x
     WHERE x.source = 'ai' AND x.status = 'queued' AND (x.not_before IS NULL OR x.not_before <= now())
     ORDER BY x.priority DESC, x.created_at
     LIMIT 1
     FOR UPDATE SKIP LOCKED;
    IF v_x.id IS NULL THEN RETURN NULL; END IF;
    v_why := public.ai_read_allowed(v_x.client_id);
    IF v_why IS NOT NULL THEN
      UPDATE public.notice_extractions SET status = 'cancelled', reason_class = v_why, finished_at = now() WHERE id = v_x.id;
      CONTINUE;
    END IF;
    UPDATE public.notice_extractions
       SET status = 'running', agent_id = p_agent, claimed_at = now(), attempts = attempts + 1
     WHERE id = v_x.id;
    SELECT g.form_code, g.reference_number, g.issue_date, c.gstin
      INTO v_g FROM public.gst_notices g JOIN public.clients c ON c.id = g.client_id WHERE g.id = v_x.notice_id;
    RETURN jsonb_build_object(
      'extraction_id', v_x.id, 'notice_id', v_x.notice_id, 'client_id', v_x.client_id,
      'document_url', v_x.document_url, 'document_label', v_x.document_label,
      'form_code', v_g.form_code, 'reference_number', v_g.reference_number, 'issue_date', v_g.issue_date,
      'client_gstin', v_g.gstin, 'attempt', v_x.attempts + 1,
      'model', v_s.model, 'effort', v_s.effort, 'max_pages', v_s.max_pages,
      'price_in_per_mtok', v_s.price_in_per_mtok, 'price_out_per_mtok', v_s.price_out_per_mtok,
      'issue_codes', (SELECT jsonb_agg(jsonb_build_object('code', t.code, 'title', t.title) ORDER BY t.sort)
                        FROM public.reply_issue_types t WHERE t.is_active));
  END LOOP;
  RETURN NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_read_claim(text) TO anon, authenticated, service_role;

-- ── Registering documents ──────────────────────────────────────────────────
-- A case-folder section's documents are, for the AI: NOTCE / INTIM / DRC7A /
-- RTAUD the department's notices; REPLY the firm's reply (its main document; the
-- rest are its annexures); ORDRS / CLOSR orders; APLCN applications; anything else
-- (acknowledgements) other.
CREATE OR REPLACE FUNCTION public.ai_folder_role(p_section text, p_label text, p_raw jsonb, p_count int)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_section IN ('NOTCE', 'INTIM', 'DRC7A', 'RTAUD') THEN 'notice'
    WHEN p_section = 'REPLY' THEN
      CASE WHEN p_count = 1
             OR (coalesce(p_label, '') <> '' AND position(lower(p_label) IN lower(coalesce((p_raw #> '{reply,maindocs}')::text, ''))) > 0)
             OR coalesce(p_label, '') ~* 'reply|response|submission|explanation'
           THEN 'reply' ELSE 'reply_support' END
    WHEN p_section IN ('ORDRS', 'CLOSR') THEN 'order'
    WHEN p_section = 'APLCN' THEN 'application'
    ELSE 'other'
  END
$$;

CREATE OR REPLACE FUNCTION public.ai_role_priority(p_role text)
RETURNS int
LANGUAGE sql IMMUTABLE
AS $$
  -- Notice documents come after the notices' own readings (30 in the background),
  -- so a copy of a notice PDF already read is recognised by its hash, not read again.
  SELECT CASE p_role WHEN 'reply' THEN 40 WHEN 'order' THEN 25 WHEN 'notice' THEN 22
                     WHEN 'reply_support' THEN 12 WHEN 'application' THEN 6 ELSE 5 END
$$;

-- One case-folder item's PDFs (new ones queued; a deleted item's waiting ones cancelled).
CREATE OR REPLACE FUNCTION public.ai_documents_register_item(p_item_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fi   public.gst_case_folder_items;
  v_auto boolean;
  v_n    int;
BEGIN
  SELECT * INTO v_fi FROM public.gst_case_folder_items WHERE id = p_item_id;
  IF v_fi.id IS NULL THEN RETURN 0; END IF;
  IF v_fi.deleted_at IS NOT NULL THEN
    UPDATE public.ai_documents SET status = 'cancelled', reason_class = 'deleted', finished_at = now()
     WHERE folder_item_id = v_fi.id AND status = 'queued';
    RETURN 0;
  END IF;
  -- A case of a type hidden everywhere (GSTR-3A) is not read.
  IF EXISTS (SELECT 1 FROM public.gst_notices g
              WHERE g.client_id = v_fi.client_id AND g.case_id = v_fi.case_id AND g.deleted_at IS NULL
                AND public.notice_type_hidden(g.form_code)) THEN
    RETURN 0;
  END IF;
  SELECT s.learning_auto_include INTO v_auto FROM public.ai_settings s WHERE s.id;
  WITH att AS (
    SELECT a ->> 'url' AS url, nullif(btrim(a ->> 'label'), '') AS label,
           count(*) OVER () AS n_att
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_fi.attachments) = 'array' THEN v_fi.attachments ELSE '[]'::jsonb END) a
     WHERE coalesce(a ->> 'url', '') ~ '/storage/v1/object/' AND coalesce(a ->> 'url', '') ~* '\.pdf($|\?)'
  ), notice AS (
    SELECT g.id, g.issue_date FROM public.gst_notices g
     WHERE g.client_id = v_fi.client_id AND g.case_id = v_fi.case_id AND g.deleted_at IS NULL
     ORDER BY (g.reference_number = coalesce(v_fi.raw_json #>> '{reply,ntcno}', v_fi.reference_number)) DESC NULLS LAST,
              g.issue_date DESC NULLS LAST
     LIMIT 1
  ), ins AS (
    INSERT INTO public.ai_documents (client_id, notice_id, case_id, folder_item_id, source, source_ref, folder_section, role,
                                     url, label, context, sort_date, priority, learning_included)
    SELECT v_fi.client_id, (SELECT id FROM notice), v_fi.case_id, v_fi.id, 'folder', att.url, v_fi.folder_section, r.role,
           att.url, coalesce(att.label, 'Document'),
           jsonb_strip_nulls(jsonb_build_object(
             'reply_reason', nullif(btrim(v_fi.raw_json #>> '{reply,reason}'), ''),
             'reply_text', nullif(btrim(v_fi.raw_json ->> 'repText'), ''),
             'reply_type', nullif(btrim(v_fi.raw_json #>> '{reply,replyty}'), ''),
             'notice_ref', nullif(btrim(v_fi.raw_json #>> '{reply,ntcno}'), ''),
             'item_ref', v_fi.reference_number)),
           coalesce((SELECT issue_date FROM notice), v_fi.first_seen_at::date),
           public.ai_role_priority(r.role),
           coalesce(v_auto, false) AND r.role = 'reply'
      FROM att CROSS JOIN LATERAL (SELECT public.ai_folder_role(v_fi.folder_section, att.label, v_fi.raw_json, att.n_att::int) AS role) r
    ON CONFLICT (source, source_ref) DO NOTHING
    RETURNING 1)
  SELECT count(*)::int INTO v_n FROM ins;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_documents_register_item(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.gst_case_folder_items_ai_register()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.attachments IS NOT DISTINCT FROM OLD.attachments
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
    RETURN NULL;
  END IF;
  PERFORM public.ai_documents_register_item(NEW.id);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_gst_case_folder_items_ai_register ON public.gst_case_folder_items;
CREATE TRIGGER trg_gst_case_folder_items_ai_register
  AFTER INSERT OR UPDATE OF attachments, deleted_at ON public.gst_case_folder_items
  FOR EACH ROW EXECUTE FUNCTION public.gst_case_folder_items_ai_register();

-- A notice's reply draft, once a person sends it for review or approves it: its
-- latest such version is read again whenever it changes.
CREATE OR REPLACE FUNCTION public.ai_documents_register_draft(p_notice_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d    public.notice_drafts;
  v_g    record;
  v_auto boolean;
BEGIN
  SELECT * INTO v_d FROM public.notice_drafts d
   WHERE d.notice_id = p_notice_id AND d.status IN ('in_review', 'approved') AND btrim(d.body) <> ''
   ORDER BY d.version DESC LIMIT 1;
  IF v_d.id IS NULL THEN RETURN false; END IF;
  SELECT g.client_id, g.case_id, g.issue_date, g.form_code INTO v_g FROM public.gst_notices g WHERE g.id = p_notice_id;
  IF v_g.client_id IS NULL OR public.notice_type_hidden(v_g.form_code) THEN RETURN false; END IF;
  SELECT s.learning_auto_include INTO v_auto FROM public.ai_settings s WHERE s.id;
  INSERT INTO public.ai_documents (client_id, notice_id, case_id, draft_id, source, source_ref, role, label, body,
                                   sort_date, priority, learning_included)
  VALUES (v_g.client_id, p_notice_id, v_g.case_id, v_d.id, 'draft', 'draft:' || p_notice_id, 'reply',
          'Reply draft v' || v_d.version, v_d.body, coalesce(v_d.updated_at::date, v_g.issue_date), 45, coalesce(v_auto, false))
  ON CONFLICT (source, source_ref) DO UPDATE
     SET draft_id = EXCLUDED.draft_id, label = EXCLUDED.label, body = EXCLUDED.body, sort_date = EXCLUDED.sort_date,
         status = 'queued', attempts = 0, not_before = NULL, error = NULL, reason_class = NULL, finished_at = NULL
   WHERE public.ai_documents.body IS DISTINCT FROM EXCLUDED.body AND public.ai_documents.status <> 'running';
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_documents_register_draft(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notice_drafts_ai_register()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('in_review', 'approved') THEN
    PERFORM public.ai_documents_register_draft(NEW.notice_id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notice_drafts_ai_register ON public.notice_drafts;
CREATE TRIGGER trg_notice_drafts_ai_register
  AFTER INSERT OR UPDATE OF status, body ON public.notice_drafts
  FOR EACH ROW EXECUTE FUNCTION public.notice_drafts_ai_register();

-- The workspace document of a notice: what staff typed (one per notice, never read).
CREATE OR REPLACE FUNCTION public.ai_workspace_document(p_notice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id   uuid;
  v_g    record;
  v_auto boolean;
BEGIN
  SELECT id INTO v_id FROM public.ai_documents WHERE source = 'workspace' AND source_ref = 'workspace:' || p_notice_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT g.client_id, g.case_id, g.issue_date, g.reference_number INTO v_g FROM public.gst_notices g WHERE g.id = p_notice_id;
  IF v_g.client_id IS NULL THEN RETURN NULL; END IF;
  SELECT s.learning_auto_include INTO v_auto FROM public.ai_settings s WHERE s.id;
  INSERT INTO public.ai_documents (client_id, notice_id, case_id, source, source_ref, role, label, sort_date, status,
                                   finished_at, doc_kind, title, learning_included)
  VALUES (v_g.client_id, p_notice_id, v_g.case_id, 'workspace', 'workspace:' || p_notice_id, 'reply',
          'Typed on the notice page', v_g.issue_date, 'done', now(), 'reply',
          'Positions and paragraphs typed for ' || coalesce(v_g.reference_number, 'the notice'), coalesce(v_auto, false))
  ON CONFLICT (source, source_ref) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.ai_documents WHERE source = 'workspace' AND source_ref = 'workspace:' || p_notice_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_workspace_document(uuid) FROM PUBLIC, anon, authenticated;

-- Human behaviour, kept: an issue's position as staff typed it is the firm's
-- answer to that paragraph (at least 20 characters; cleared, it is forgotten).
CREATE OR REPLACE FUNCTION public.ai_issue_position_learn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc uuid;
  v_g   record;
  v_inc boolean;
  v_all text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.ai_learning_pairs WHERE issue_id = OLD.id AND origin = 'position';
    RETURN NULL;
  END IF;
  IF length(btrim(coalesce(NEW.position, ''))) < 20 THEN
    DELETE FROM public.ai_learning_pairs WHERE issue_id = NEW.id AND origin = 'position';
    RETURN NULL;
  END IF;
  v_all := btrim(concat_ws(E'\n', nullif(btrim(NEW.title), ''), nullif(btrim(NEW.detail), ''),
                           CASE WHEN coalesce(NEW.quote, '') <> '' THEN '"' || NEW.quote || '"' END));
  IF v_all = '' THEN RETURN NULL; END IF;
  SELECT g.client_id, g.case_id, g.form_code, g.section_of_law, g.financial_year, g.staff_status
    INTO v_g FROM public.gst_notices g WHERE g.id = NEW.notice_id;
  IF v_g.client_id IS NULL THEN RETURN NULL; END IF;
  v_doc := public.ai_workspace_document(NEW.notice_id);
  SELECT d.learning_included INTO v_inc FROM public.ai_documents d WHERE d.id = v_doc;
  INSERT INTO public.ai_learning_pairs (document_id, client_id, notice_id, issue_id, case_id, origin, form_code, section_of_law,
                                        financial_year, issue_code, issue_title, allegation, response, seq, page, verified, included)
  VALUES (v_doc, v_g.client_id, NEW.notice_id, NEW.id, v_g.case_id, 'position', v_g.form_code, v_g.section_of_law,
          v_g.financial_year, coalesce(NEW.issue_code, 'OTHER'), NEW.title, v_all, btrim(NEW.position), NEW.seq, NEW.page, true,
          coalesce(v_inc, false))
  ON CONFLICT (issue_id, origin) WHERE issue_id IS NOT NULL AND origin IN ('position', 'assistant_edit')
  DO UPDATE SET allegation = EXCLUDED.allegation, response = EXCLUDED.response, issue_code = EXCLUDED.issue_code,
                issue_title = EXCLUDED.issue_title, seq = EXCLUDED.seq, form_code = EXCLUDED.form_code,
                section_of_law = EXCLUDED.section_of_law, financial_year = EXCLUDED.financial_year;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notice_issues_ai_learn ON public.notice_issues;
CREATE TRIGGER trg_notice_issues_ai_learn
  AFTER INSERT OR UPDATE OF position, title, detail, issue_code OR DELETE ON public.notice_issues
  FOR EACH ROW EXECUTE FUNCTION public.ai_issue_position_learn();

-- ── Keeping the queues full ────────────────────────────────────────────────
-- Registers what triggers missed (items synced before this migration, drafts
-- approved earlier), queues the notices read in the background when read_backfill
-- is on (types needing a reply, not hidden, with a PDF in storage, never read), and
-- lets a reply's case notices be read before the reply.
CREATE OR REPLACE FUNCTION public.ai_sync()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s       public.ai_settings;
  v_items   int := 0;
  v_drafts  int := 0;
  v_notices int := 0;
  v_id      uuid;
BEGIN
  SELECT * INTO v_s FROM public.ai_settings WHERE id;
  FOR v_id IN
    SELECT fi.id FROM public.gst_case_folder_items fi
     WHERE fi.deleted_at IS NULL AND jsonb_typeof(fi.attachments) = 'array' AND jsonb_array_length(fi.attachments) > 0
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(fi.attachments) a
                    WHERE coalesce(a ->> 'url', '') ~ '/storage/v1/object/'
                      AND NOT EXISTS (SELECT 1 FROM public.ai_documents d WHERE d.source = 'folder' AND d.source_ref = a ->> 'url'))
  LOOP
    v_items := v_items + public.ai_documents_register_item(v_id);
  END LOOP;
  FOR v_id IN
    SELECT DISTINCT d.notice_id FROM public.notice_drafts d
     WHERE d.status IN ('in_review', 'approved')
       AND NOT EXISTS (SELECT 1 FROM public.ai_documents x WHERE x.source = 'draft' AND x.source_ref = 'draft:' || d.notice_id)
  LOOP
    IF public.ai_documents_register_draft(v_id) THEN v_drafts := v_drafts + 1; END IF;
  END LOOP;

  IF coalesce(v_s.read_enabled, false) AND coalesce(v_s.read_backfill, false) THEN
    WITH cand AS (
      SELECT g.id, g.client_id, public.notice_read_document(g.id) AS doc
        FROM public.gst_notices g
       WHERE g.deleted_at IS NULL
         AND coalesce(g.form_code, '') NOT IN ('GSTR-3A', 'LUT', 'DRC-03')
         AND NOT public.notice_type_hidden(g.form_code)
         AND NOT EXISTS (SELECT 1 FROM public.notice_type_settings t WHERE t.form_code = g.form_code AND t.response_need = 'none')
         AND NOT EXISTS (SELECT 1 FROM public.notice_extractions x WHERE x.notice_id = g.id AND x.source = 'ai' AND x.status <> 'cancelled')
         AND public.ai_read_allowed(g.client_id) IS NULL
    ), ins AS (
      INSERT INTO public.notice_extractions (notice_id, client_id, source, status, priority, requested_by_name, document_url, document_label)
      SELECT cand.id, cand.client_id, 'ai', 'queued', 30, 'Reading every notice', cand.doc ->> 'url', cand.doc ->> 'label'
        FROM cand WHERE cand.doc IS NOT NULL
      ON CONFLICT DO NOTHING
      RETURNING 1)
    SELECT count(*)::int INTO v_notices FROM ins;
  END IF;

  -- A reply waits for its case's notices; those go first.
  UPDATE public.notice_extractions x SET priority = 45
    FROM public.gst_notices g
   WHERE x.notice_id = g.id AND x.source = 'ai' AND x.status = 'queued' AND x.priority < 45
     AND EXISTS (SELECT 1 FROM public.ai_documents d
                  WHERE d.client_id = g.client_id AND d.case_id = g.case_id AND d.role = 'reply' AND d.status = 'queued');

  UPDATE public.ai_runner_status SET last_sync_at = now() WHERE id;
  RETURN jsonb_build_object('documents', v_items, 'drafts', v_drafts, 'notices', v_notices);
END;
$$;
GRANT EXECUTE ON FUNCTION public.ai_sync() TO anon, authenticated, service_role;

-- Work a run left behind (the worker was stopped by its plan's limits) goes back on
-- the queue; after a third try it fails, saying so.
CREATE OR REPLACE FUNCTION public.ai_jobs_reap()
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
    UPDATE public.notice_extractions
       SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
           reason_class = CASE WHEN attempts >= 3 THEN 'worker_limit' ELSE reason_class END,
           error = CASE WHEN attempts >= 3 THEN 'The reading was stopped three times before it finished (the Edge Function''s time limit). Raise "Seconds per run" in Settings if the plan allows, or read it again.' ELSE error END,
           finished_at = CASE WHEN attempts >= 3 THEN now() END,
           agent_id = NULL, claimed_at = NULL
     WHERE source = 'ai' AND status = 'running' AND agent_id LIKE 'edge%' AND claimed_at < now() - interval '12 minutes'
    RETURNING 1)
  SELECT count(*)::int INTO v_n FROM r;
  WITH r AS (
    UPDATE public.ai_documents
       SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
           reason_class = CASE WHEN attempts >= 3 THEN 'worker_limit' ELSE reason_class END,
           error = CASE WHEN attempts >= 3 THEN 'The reading was stopped three times before it finished (the Edge Function''s time limit).' ELSE error END,
           finished_at = CASE WHEN attempts >= 3 THEN now() END,
           agent_id = NULL, claimed_at = NULL
     WHERE status = 'running' AND claimed_at < now() - interval '12 minutes'
    RETURNING 1)
  SELECT count(*)::int INTO v_m FROM r;
  RETURN v_n + v_m;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_jobs_reap() FROM PUBLIC, anon, authenticated;

-- The paragraphs of a case's notices, for reading a reply: each notice's latest AI
-- reading, else its issues as entered, else the allegations read from the case's
-- notice documents.
CREATE OR REPLACE FUNCTION public.ai_case_paragraphs(p_client_id uuid, p_case_id text, p_notice_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  SELECT jsonb_agg(p ORDER BY p ->> 'issue_date' DESC NULLS LAST, (p ->> 'seq')::int) INTO v FROM (
    SELECT jsonb_build_object('notice_id', g.id, 'notice_ref', g.reference_number, 'form_code', g.form_code,
             'issue_date', g.issue_date, 'seq', e.n, 'para', coalesce(e.i ->> 'para', ''),
             'issue_code', coalesce(e.i ->> 'issue_code', 'OTHER'), 'title', coalesce(e.i ->> 'title', ''),
             'text', left(coalesce(nullif(e.i ->> 'text', ''), nullif(e.i ->> 'detail', ''), e.i ->> 'title', ''), 1500)) AS p
      FROM public.gst_notices g
      -- The reading's issues, or the ones it held back (unchecked, as on a scan): what
      -- the notice says either way.
      JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(x.issues) = 'array' AND jsonb_array_length(x.issues) > 0 THEN x.issues
                                ELSE x.detail -> 'issues_withheld' END AS issues
                      FROM public.notice_extractions x
                     WHERE x.notice_id = g.id AND x.source = 'ai' AND x.status = 'done'
                     ORDER BY x.finished_at DESC NULLS LAST LIMIT 1) xx ON true
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(xx.issues) = 'array' THEN xx.issues ELSE '[]'::jsonb END)
                         WITH ORDINALITY e(i, n)
     WHERE g.client_id = p_client_id AND g.deleted_at IS NULL
       AND ((p_case_id IS NOT NULL AND g.case_id = p_case_id) OR g.id = p_notice_id)
    UNION ALL
    SELECT jsonb_build_object('notice_id', g.id, 'notice_ref', g.reference_number, 'form_code', g.form_code,
             'issue_date', g.issue_date, 'seq', ni.seq, 'para', '', 'issue_code', coalesce(ni.issue_code, 'OTHER'),
             'title', coalesce(ni.title, ''),
             'text', left(btrim(concat_ws(E'\n', ni.title, ni.detail, CASE WHEN coalesce(ni.quote, '') <> '' THEN '"' || ni.quote || '"' END)), 1500))
      FROM public.gst_notices g JOIN public.notice_issues ni ON ni.notice_id = g.id
     WHERE g.client_id = p_client_id AND g.deleted_at IS NULL
       AND ((p_case_id IS NOT NULL AND g.case_id = p_case_id) OR g.id = p_notice_id)
       AND NOT EXISTS (SELECT 1 FROM public.notice_extractions x WHERE x.notice_id = g.id AND x.source = 'ai' AND x.status = 'done'
                         AND ((jsonb_typeof(x.issues) = 'array' AND jsonb_array_length(x.issues) > 0)
                              OR (jsonb_typeof(x.detail -> 'issues_withheld') = 'array' AND jsonb_array_length(x.detail -> 'issues_withheld') > 0)))
  ) s;
  IF v IS NULL AND p_case_id IS NOT NULL THEN
    SELECT jsonb_agg(p ORDER BY p ->> 'issue_date' DESC NULLS LAST, (p ->> 'seq')::int) INTO v FROM (
      SELECT jsonb_build_object('notice_id', d.notice_id, 'notice_ref', coalesce(d.reference, ''), 'form_code', '',
               'issue_date', d.doc_date, 'seq', e.n, 'para', coalesce(e.i ->> 'para', ''),
               'issue_code', coalesce(e.i ->> 'issue_code', 'OTHER'), 'title', coalesce(e.i ->> 'heading', ''),
               'text', left(coalesce(e.i ->> 'text', ''), 1500)) AS p
        FROM public.ai_documents d
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.paragraphs) = 'array' THEN d.paragraphs ELSE '[]'::jsonb END)
                           WITH ORDINALITY e(i, n)
       WHERE d.client_id = p_client_id AND d.case_id = p_case_id AND d.role = 'notice' AND d.status = 'done'
         AND e.i ->> 'kind' = 'allegation'
       LIMIT 40) s;
  END IF;
  RETURN coalesce(v, '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.ai_case_paragraphs(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- ── The Edge runner's claim ────────────────────────────────────────────────
-- One job, the higher priority first (a notice wins a tie): a notice reading
-- (kind notice, finished with notice_read_finish) or a document (kind document,
-- finished with ai_document_finish). A reply waits while its case's notices are
-- being read. NULL when there is nothing to do; {"idle": "off" | "runner"} or
-- {"capped": true} when reading may not go on now.
CREATE OR REPLACE FUNCTION public.ai_claim_next(p_agent text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s    public.ai_settings;
  v_x    public.notice_extractions;
  v_d    public.ai_documents;
  v_why  text;
  v_g    record;
  v_np   int;
  v_dp   int;
  v_kind text;
  i      int := 0;
BEGIN
  SELECT * INTO v_s FROM public.ai_settings WHERE id;
  IF NOT coalesce(v_s.read_enabled, false) THEN RETURN jsonb_build_object('idle', 'off'); END IF;
  IF coalesce(v_s.runner, 'edge') <> 'edge' THEN RETURN jsonb_build_object('idle', 'runner'); END IF;
  PERFORM public.ai_jobs_reap();
  IF public.ai_spend_today_usd() >= v_s.daily_cap_usd THEN RETURN jsonb_build_object('capped', true); END IF;
  LOOP
    i := i + 1;
    EXIT WHEN i > 25;
    v_x := NULL;
    v_d := NULL;
    SELECT x.priority INTO v_np FROM public.notice_extractions x
     WHERE x.source = 'ai' AND x.status = 'queued' AND (x.not_before IS NULL OR x.not_before <= now())
     ORDER BY x.priority DESC LIMIT 1;
    SELECT d.priority INTO v_dp FROM public.ai_documents d
     WHERE v_s.read_documents AND d.status = 'queued' AND (d.not_before IS NULL OR d.not_before <= now())
       AND NOT (d.role = 'reply' AND d.case_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.notice_extractions x2 JOIN public.gst_notices g2 ON g2.id = x2.notice_id
              WHERE g2.client_id = d.client_id AND g2.case_id = d.case_id AND x2.source = 'ai' AND x2.status IN ('queued', 'running')))
     ORDER BY d.priority DESC LIMIT 1;
    IF v_np IS NULL AND v_dp IS NULL THEN RETURN NULL; END IF;
    v_kind := CASE WHEN v_np IS NOT NULL AND (v_dp IS NULL OR v_np >= v_dp) THEN 'notice' ELSE 'document' END;

    IF v_kind = 'notice' THEN
      SELECT x.* INTO v_x FROM public.notice_extractions x JOIN public.gst_notices g ON g.id = x.notice_id
       WHERE x.source = 'ai' AND x.status = 'queued' AND (x.not_before IS NULL OR x.not_before <= now())
       ORDER BY x.priority DESC, g.issue_date DESC NULLS LAST, x.created_at
       LIMIT 1
       FOR UPDATE OF x SKIP LOCKED;
      IF v_x.id IS NULL THEN RETURN NULL; END IF;
      v_why := public.ai_read_allowed(v_x.client_id);
      IF v_why IS NOT NULL THEN
        UPDATE public.notice_extractions SET status = 'cancelled', reason_class = v_why, finished_at = now() WHERE id = v_x.id;
        CONTINUE;
      END IF;
      UPDATE public.notice_extractions
         SET status = 'running', agent_id = p_agent, claimed_at = now(), attempts = attempts + 1
       WHERE id = v_x.id;
      SELECT g.form_code, g.reference_number, g.issue_date, c.gstin
        INTO v_g FROM public.gst_notices g JOIN public.clients c ON c.id = g.client_id WHERE g.id = v_x.notice_id;
      RETURN jsonb_build_object(
        'kind', 'notice',
        'extraction_id', v_x.id, 'notice_id', v_x.notice_id, 'client_id', v_x.client_id,
        'document_url', v_x.document_url, 'document_label', v_x.document_label,
        'form_code', v_g.form_code, 'reference_number', v_g.reference_number, 'issue_date', v_g.issue_date,
        'client_gstin', v_g.gstin, 'attempt', v_x.attempts + 1,
        'model', v_s.model, 'effort', v_s.effort, 'max_pages', v_s.max_pages,
        'price_in_per_mtok', v_s.price_in_per_mtok, 'price_out_per_mtok', v_s.price_out_per_mtok,
        'issue_codes', (SELECT jsonb_agg(jsonb_build_object('code', t.code, 'title', t.title) ORDER BY t.sort)
                          FROM public.reply_issue_types t WHERE t.is_active));
    END IF;

    SELECT d.* INTO v_d FROM public.ai_documents d
     WHERE d.status = 'queued' AND (d.not_before IS NULL OR d.not_before <= now())
       AND NOT (d.role = 'reply' AND d.case_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.notice_extractions x2 JOIN public.gst_notices g2 ON g2.id = x2.notice_id
              WHERE g2.client_id = d.client_id AND g2.case_id = d.case_id AND x2.source = 'ai' AND x2.status IN ('queued', 'running')))
     ORDER BY d.priority DESC, d.sort_date DESC NULLS LAST, d.created_at
     LIMIT 1
     FOR UPDATE SKIP LOCKED;
    IF v_d.id IS NULL THEN RETURN NULL; END IF;
    v_why := public.ai_read_allowed(v_d.client_id);
    IF v_why IS NOT NULL THEN
      UPDATE public.ai_documents SET status = 'cancelled', reason_class = v_why, finished_at = now() WHERE id = v_d.id;
      CONTINUE;
    END IF;
    UPDATE public.ai_documents
       SET status = 'running', agent_id = p_agent, claimed_at = now(), attempts = attempts + 1
     WHERE id = v_d.id;
    SELECT g.form_code, g.reference_number, g.issue_date, g.financial_year, c.gstin
      INTO v_g FROM public.clients c LEFT JOIN public.gst_notices g ON g.id = v_d.notice_id WHERE c.id = v_d.client_id;
    RETURN jsonb_build_object(
      'kind', 'document',
      'document_id', v_d.id, 'client_id', v_d.client_id, 'notice_id', v_d.notice_id, 'case_id', v_d.case_id,
      'source', v_d.source, 'role', v_d.role, 'folder_section', v_d.folder_section,
      'document_url', v_d.url, 'document_label', v_d.label, 'body', v_d.body, 'context', coalesce(v_d.context, '{}'::jsonb),
      'form_code', v_g.form_code, 'reference_number', v_g.reference_number, 'issue_date', v_g.issue_date,
      'financial_year', v_g.financial_year, 'client_gstin', v_g.gstin, 'attempt', v_d.attempts + 1,
      'model', v_s.model, 'effort', v_s.doc_effort, 'max_pages', v_s.doc_max_pages,
      'price_in_per_mtok', v_s.price_in_per_mtok, 'price_out_per_mtok', v_s.price_out_per_mtok,
      'issue_codes', (SELECT jsonb_agg(jsonb_build_object('code', t.code, 'title', t.title) ORDER BY t.sort)
                        FROM public.reply_issue_types t WHERE t.is_active),
      'case_paragraphs', CASE WHEN v_d.role = 'reply' THEN public.ai_case_paragraphs(v_d.client_id, v_d.case_id, v_d.notice_id) END);
  END LOOP;
  RETURN NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ai_claim_next(text) TO anon, authenticated, service_role;

-- The same file read before (another item's copy, or the notice's own PDF) is not
-- sent again: the runner reports the file's hash before reading it.
CREATE OR REPLACE FUNCTION public.ai_document_hash(p_document_id uuid, p_agent text, p_sha256 text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d   public.ai_documents;
  v_dup uuid;
BEGIN
  SELECT * INTO v_d FROM public.ai_documents WHERE id = p_document_id FOR UPDATE;
  IF v_d.id IS NULL THEN RETURN jsonb_build_object('error', 'gone'); END IF;
  IF v_d.status <> 'running' OR v_d.agent_id IS DISTINCT FROM p_agent THEN RETURN jsonb_build_object('error', 'not_yours'); END IF;
  UPDATE public.ai_documents SET document_sha256 = p_sha256 WHERE id = v_d.id;
  SELECT d.id INTO v_dup FROM public.ai_documents d
   WHERE d.document_sha256 = p_sha256 AND d.id <> v_d.id AND d.status IN ('done', 'running') AND d.client_id = v_d.client_id
     -- A reply read as an attachment elsewhere is still read as the reply it is here
     -- (a reply's reading gives the paragraph pairs).
     AND (v_d.role <> 'reply' OR d.role = 'reply')
   ORDER BY (d.status = 'done') DESC, d.created_at LIMIT 1;
  IF v_dup IS NULL AND v_d.role <> 'reply' AND EXISTS (
       SELECT 1 FROM public.notice_extractions x WHERE x.document_sha256 = p_sha256 AND x.client_id = v_d.client_id
          AND x.source = 'ai' AND x.status IN ('done', 'superseded', 'running')) THEN
    UPDATE public.ai_documents SET status = 'skipped', reason_class = 'same_as_notice', finished_at = now(),
           agent_id = NULL, error = NULL WHERE id = v_d.id;
    RETURN jsonb_build_object('duplicate', true, 'of', 'notice');
  END IF;
  IF v_dup IS NOT NULL THEN
    UPDATE public.ai_documents SET status = 'skipped', reason_class = 'duplicate', finished_at = now(),
           agent_id = NULL, error = NULL, context = coalesce(context, '{}'::jsonb) || jsonb_build_object('duplicate_of', v_dup)
     WHERE id = v_d.id;
    RETURN jsonb_build_object('duplicate', true, 'of', v_dup);
  END IF;
  RETURN jsonb_build_object('duplicate', false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.ai_document_hash(uuid, text, text) TO anon, authenticated, service_role;

-- A document's reading. p_result: {"doc_kind", "title", "summary", "doc_date",
-- "reference", "outcome", "paragraphs": [...], "key_facts": [...], "pairs":
-- [{"notice_id", "seq", "issue_code", "issue_title", "allegation", "response",
-- "page", "verified"}], "pages", "text_layer", "document_sha256", "model"}.
-- A reply's pairs replace the ones read from it before; whether they are the
-- assistant's examples follows the reply's own choice.
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
    document_sha256 = coalesce(p_result ->> 'document_sha256', document_sha256)
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

-- "Read this case's documents now": first in the queue; failed ones tried again.
CREATE OR REPLACE FUNCTION public.ai_documents_request(p_notice_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_g record;
  v_n int;
BEGIN
  SELECT g.client_id, g.case_id INTO v_g FROM public.gst_notices g WHERE g.id = p_notice_id;
  IF v_g.client_id IS NULL THEN RETURN 0; END IF;
  WITH u AS (
    UPDATE public.ai_documents d
       SET priority = greatest(d.priority, 70),
           status = CASE WHEN d.status IN ('failed', 'cancelled') THEN 'queued' ELSE d.status END,
           attempts = CASE WHEN d.status IN ('failed', 'cancelled') THEN 0 ELSE d.attempts END,
           not_before = NULL
     WHERE d.client_id = v_g.client_id AND d.source <> 'workspace'
       AND ((v_g.case_id IS NOT NULL AND d.case_id = v_g.case_id) OR d.notice_id = p_notice_id)
       AND d.status IN ('queued', 'failed', 'cancelled')
    RETURNING 1)
  SELECT count(*)::int INTO v_n FROM u;
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ai_documents_request(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ai_documents_retry(p_ids uuid[])
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH u AS (
    UPDATE public.ai_documents SET status = 'queued', attempts = 0, not_before = NULL, error = NULL, reason_class = NULL, finished_at = NULL
     WHERE id = ANY (p_ids) AND status IN ('failed', 'cancelled', 'skipped') AND source <> 'workspace'
    RETURNING 1)
  SELECT count(*)::int FROM u
$$;
GRANT EXECUTE ON FUNCTION public.ai_documents_retry(uuid[]) TO anon, authenticated, service_role;

-- ── The admin's choice: which replies teach the assistant ──────────────────
CREATE OR REPLACE VIEW public.ai_learning_responses AS
SELECT d.id, d.client_id, c.name AS client_name, d.notice_id, g.reference_number AS notice_ref, g.form_code,
       coalesce(g.financial_year, '') AS financial_year, d.case_id, d.source, d.label, d.title, d.summary,
       d.status, coalesce(d.doc_date, d.sort_date) AS response_date,
       CASE WHEN d.source = 'folder' OR public.notice_is_closed(g.staff_status) THEN 'past' ELSE 'ongoing' END AS phase,
       d.learning_included, d.learning_decided_by_name, d.learning_decided_at,
       coalesce(p.pairs, 0) AS pairs, coalesce(p.pairs_included, 0) AS pairs_included, d.updated_at
  FROM public.ai_documents d
  JOIN public.clients c ON c.id = d.client_id
  LEFT JOIN public.gst_notices g ON g.id = d.notice_id
  LEFT JOIN (SELECT document_id, count(*)::int AS pairs, (count(*) FILTER (WHERE included))::int AS pairs_included
               FROM public.ai_learning_pairs GROUP BY document_id) p ON p.document_id = d.id
 WHERE d.role = 'reply' AND d.status NOT IN ('cancelled', 'skipped');
COMMENT ON VIEW public.ai_learning_responses IS
  'One row per response the firm gave (a reply filed on the portal, an approved draft, what staff typed on a notice page): past (filed, or its notice closed) or ongoing, with how many paragraph pairs it gave and how many of them the assistant may use.';
GRANT SELECT ON public.ai_learning_responses TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ai_learning_select(p_document_ids uuid[], p_include boolean, p_actor text DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n int;
BEGIN
  UPDATE public.ai_documents SET learning_included = p_include, learning_decided_by_name = p_actor, learning_decided_at = now()
   WHERE id = ANY (p_document_ids) AND role = 'reply';
  WITH u AS (
    UPDATE public.ai_learning_pairs SET included = p_include, decided_by_name = p_actor, decided_at = now()
     WHERE document_id = ANY (p_document_ids) AND included IS DISTINCT FROM p_include
    RETURNING 1)
  SELECT count(*)::int INTO v_n FROM u;
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ai_learning_select(uuid[], boolean, text) TO anon, authenticated, service_role;

-- In bulk: every response of the given clients (NULL: all clients), past, ongoing or both.
CREATE OR REPLACE FUNCTION public.ai_learning_select_where(
  p_client_ids uuid[], p_phase text, p_include boolean, p_actor text DEFAULT NULL)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.ai_learning_select(
    coalesce((SELECT array_agg(r.id) FROM public.ai_learning_responses r
               WHERE (p_client_ids IS NULL OR r.client_id = ANY (p_client_ids))
                 AND (coalesce(p_phase, 'all') = 'all' OR r.phase = p_phase)), '{}'::uuid[]),
    p_include, p_actor)
$$;
GRANT EXECUTE ON FUNCTION public.ai_learning_select_where(uuid[], text, boolean, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ai_learning_pair_set(p_pair_ids uuid[], p_include boolean, p_actor text DEFAULT NULL)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH u AS (
    UPDATE public.ai_learning_pairs SET included = p_include, decided_by_name = p_actor, decided_at = now()
     WHERE id = ANY (p_pair_ids)
    RETURNING 1)
  SELECT count(*)::int FROM u
$$;
GRANT EXECUTE ON FUNCTION public.ai_learning_pair_set(uuid[], boolean, text) TO anon, authenticated, service_role;

-- The included pairs closest to a paragraph: words in common (full text, any of
-- them), the same issue code, the same form.
CREATE OR REPLACE FUNCTION public.ai_learning_examples(
  p_text text, p_issue_code text DEFAULT NULL, p_form_code text DEFAULT NULL,
  p_exclude_notice uuid DEFAULT NULL, p_limit int DEFAULT 5)
RETURNS TABLE (id uuid, score real, issue_code text, form_code text, section_of_law text, issue_title text,
               allegation text, response text, origin text, verified boolean)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT (SELECT string_agg(quote_literal(u.lexeme), ' | ')
              FROM unnest(to_tsvector('english'::regconfig, left(coalesce(p_text, ''), 6000))) u
             WHERE length(u.lexeme) > 2)::tsquery AS tsq
  )
  SELECT p.id,
         (coalesce(ts_rank_cd(p.search, q.tsq, 32), 0)
          + CASE WHEN p_issue_code IS NOT NULL AND p_issue_code <> 'OTHER' AND p.issue_code = p_issue_code THEN 0.5 ELSE 0 END
          + CASE WHEN p_form_code IS NOT NULL AND p.form_code = p_form_code THEN 0.15 ELSE 0 END
          + CASE WHEN p.verified THEN 0.05 ELSE 0 END)::real AS score,
         p.issue_code, p.form_code, p.section_of_law, p.issue_title, p.allegation, p.response, p.origin, p.verified
    FROM public.ai_learning_pairs p CROSS JOIN q
   WHERE p.included
     AND (p_exclude_notice IS NULL OR p.notice_id IS DISTINCT FROM p_exclude_notice)
     AND ((q.tsq IS NOT NULL AND p.search @@ q.tsq)
          OR (p_issue_code IS NOT NULL AND p_issue_code <> 'OTHER' AND p.issue_code = p_issue_code))
   ORDER BY score DESC, p.updated_at DESC
   LIMIT greatest(1, least(coalesce(p_limit, 5), 20))
$$;
GRANT EXECUTE ON FUNCTION public.ai_learning_examples(text, text, text, uuid, int) TO anon, authenticated, service_role;

-- ── The assistant ──────────────────────────────────────────────────────────
-- Starts a run and hands the runner everything it needs: the notice, its issues
-- (with the paragraphs as read), the case's documents as read, the evidence, the
-- latest draft and the closest learned examples. {"error": reason} when the
-- assistant may not run now: off, no_consent, opted_out, capped, gone.
CREATE OR REPLACE FUNCTION public.ai_assist_begin(
  p_notice_id uuid, p_mode text, p_issue_id uuid DEFAULT NULL, p_question text DEFAULT NULL,
  p_text text DEFAULT NULL, p_actor text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s        public.ai_settings;
  v_g        record;
  v_why      text;
  v_run      uuid;
  v_reading  jsonb;
  v_issues   jsonb;
  v_docs     jsonb;
  v_ann      jsonb;
  v_draft    jsonb;
  v_examples jsonb := '[]'::jsonb;
  v_xid      uuid;
  v_seen     uuid[] := '{}';
  v_iss      record;
  v_ex       record;
BEGIN
  IF p_mode NOT IN ('draft', 'ask', 'improve') THEN
    RAISE EXCEPTION 'ai_assist_begin: unknown mode %', p_mode USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_s FROM public.ai_settings WHERE id;
  SELECT g.id, g.client_id, g.case_id, g.form_code, g.reference_number, g.issue_date, g.due_date, g.section_of_law,
         g.financial_year, g.period_from, g.period_to, g.amount_of_demand, g.description, g.issued_by, g.notice_type,
         g.staff_status, c.name AS client_name
    INTO v_g FROM public.gst_notices g JOIN public.clients c ON c.id = g.client_id
   WHERE g.id = p_notice_id AND g.deleted_at IS NULL;
  IF v_g.id IS NULL THEN RETURN jsonb_build_object('error', 'gone'); END IF;
  v_why := public.ai_read_allowed(v_g.client_id);
  IF v_why IS NOT NULL THEN RETURN jsonb_build_object('error', v_why); END IF;
  IF public.ai_assist_spend_today_usd() >= v_s.assist_daily_cap_usd THEN RETURN jsonb_build_object('error', 'capped'); END IF;
  IF p_mode = 'ask' AND btrim(coalesce(p_question, '')) = '' THEN RETURN jsonb_build_object('error', 'no_question'); END IF;
  IF p_mode = 'improve' AND btrim(coalesce(p_text, '')) = '' THEN RETURN jsonb_build_object('error', 'no_text'); END IF;

  SELECT x.id, jsonb_build_object('summary', x.detail ->> 'summary', 'documents_asked', x.detail -> 'documents_asked',
                                  'issues', CASE WHEN jsonb_typeof(x.issues) = 'array' AND jsonb_array_length(x.issues) > 0 THEN x.issues
                                                 ELSE x.detail -> 'issues_withheld' END)
    INTO v_xid, v_reading
    FROM public.notice_extractions x WHERE x.notice_id = p_notice_id AND x.source = 'ai' AND x.status = 'done'
   ORDER BY x.finished_at DESC NULLS LAST LIMIT 1;

  SELECT jsonb_agg(jsonb_build_object(
           'id', ni.id, 'seq', ni.seq, 'title', ni.title, 'detail', ni.detail, 'issue_code', ni.issue_code,
           'amount', ni.amount, 'explained_amount', ni.explained_amount, 'status', ni.status, 'position', ni.position,
           'quote', ni.quote,
           -- The paragraph as read: the issue's own entry when the reading made it, else
           -- the reading's issue with the same title or quote.
           'text', left(coalesce(
             CASE WHEN ni.extraction_id = v_xid AND ni.seq >= 1 THEN
               coalesce(nullif(v_reading #>> ARRAY['issues', (ni.seq - 1)::text, 'text'], ''),
                        v_reading #>> ARRAY['issues', (ni.seq - 1)::text, 'detail']) END,
             (SELECT coalesce(nullif(e ->> 'text', ''), e ->> 'detail')
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_reading -> 'issues') = 'array' THEN v_reading -> 'issues' ELSE '[]'::jsonb END) e
               WHERE (e ->> 'title') = ni.title OR (e ->> 'quote') = ni.quote LIMIT 1)), 2000))
           ORDER BY ni.seq)
    INTO v_issues FROM public.notice_issues ni WHERE ni.notice_id = p_notice_id;
  IF v_issues IS NULL AND jsonb_typeof(v_reading -> 'issues') = 'array' THEN
    SELECT jsonb_agg(jsonb_build_object('id', NULL, 'seq', e.n, 'title', e.i ->> 'title', 'detail', e.i ->> 'detail',
             'issue_code', e.i ->> 'issue_code', 'amount', (e.i ->> 'amount')::numeric, 'quote', e.i ->> 'quote',
             'text', left(coalesce(nullif(e.i ->> 'text', ''), e.i ->> 'detail'), 2000)) ORDER BY e.n)
      INTO v_issues FROM jsonb_array_elements(v_reading -> 'issues') WITH ORDINALITY e(i, n);
  END IF;
  IF p_issue_id IS NOT NULL THEN
    SELECT jsonb_agg(i) INTO v_issues FROM jsonb_array_elements(coalesce(v_issues, '[]'::jsonb)) i WHERE i ->> 'id' = p_issue_id::text;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'label', d.label, 'role', d.role, 'doc_kind', d.doc_kind, 'title', d.title, 'date', coalesce(d.doc_date, d.sort_date),
           'summary', d.summary, 'outcome', d.outcome,
           'paragraphs', (SELECT jsonb_agg(jsonb_build_object('kind', p ->> 'kind', 'para', p ->> 'para', 'text', left(p ->> 'text', 700)))
                            FROM (SELECT p FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.paragraphs) = 'array' THEN d.paragraphs ELSE '[]'::jsonb END) p
                                  LIMIT 12) pp),
           'key_facts', d.key_facts)
           ORDER BY public.ai_role_priority(d.role) DESC, coalesce(d.doc_date, d.sort_date) DESC NULLS LAST)
    INTO v_docs
    FROM (SELECT * FROM public.ai_documents d
           WHERE d.client_id = v_g.client_id AND d.status = 'done' AND d.source <> 'workspace'
             AND ((v_g.case_id IS NOT NULL AND d.case_id = v_g.case_id) OR d.notice_id = p_notice_id)
           ORDER BY public.ai_role_priority(d.role) DESC, coalesce(d.doc_date, d.sort_date) DESC NULLS LAST
           LIMIT 15) d;

  SELECT jsonb_agg(jsonb_build_object('title', a.title, 'financial_year', a.financial_year, 'status', a.status,
                                      'explained_amount', a.explained_amount, 'to_pay_amount', a.to_pay_amount, 'note', a.note))
    INTO v_ann FROM public.reply_annexures a WHERE a.notice_id = p_notice_id AND a.is_current;

  SELECT jsonb_build_object('version', d.version, 'status', d.status, 'body', left(d.body, 8000))
    INTO v_draft FROM public.notice_drafts d WHERE d.notice_id = p_notice_id ORDER BY d.version DESC LIMIT 1;

  -- Learned examples: per issue, or for the question / the text.
  IF p_mode = 'draft' THEN
    FOR v_iss IN SELECT i FROM jsonb_array_elements(coalesce(v_issues, '[]'::jsonb)) i LIMIT 12 LOOP
      FOR v_ex IN SELECT * FROM public.ai_learning_examples(
                 concat_ws(' ', v_iss.i ->> 'title', v_iss.i ->> 'detail', v_iss.i ->> 'text'), v_iss.i ->> 'issue_code', v_g.form_code,
                 p_notice_id, CASE WHEN p_issue_id IS NULL THEN 3 ELSE 6 END) LOOP
        CONTINUE WHEN v_ex.id = ANY (v_seen);
        v_seen := v_seen || v_ex.id;
        v_examples := v_examples || jsonb_build_object('id', v_ex.id, 'for_issue', v_iss.i ->> 'seq', 'score', round(v_ex.score::numeric, 3),
          'issue_code', v_ex.issue_code, 'form_code', v_ex.form_code, 'section_of_law', v_ex.section_of_law, 'issue_title', v_ex.issue_title,
          'allegation', left(v_ex.allegation, 1500), 'response', left(v_ex.response, 3000), 'origin', v_ex.origin, 'verified', v_ex.verified);
        EXIT WHEN jsonb_array_length(v_examples) >= 14;
      END LOOP;
    END LOOP;
    IF jsonb_array_length(v_examples) = 0 THEN
      FOR v_ex IN SELECT * FROM public.ai_learning_examples(concat_ws(' ', v_g.description, v_reading ->> 'summary'), NULL, v_g.form_code, p_notice_id, 5) LOOP
        v_examples := v_examples || jsonb_build_object('id', v_ex.id, 'for_issue', NULL, 'score', round(v_ex.score::numeric, 3),
          'issue_code', v_ex.issue_code, 'form_code', v_ex.form_code, 'section_of_law', v_ex.section_of_law, 'issue_title', v_ex.issue_title,
          'allegation', left(v_ex.allegation, 1500), 'response', left(v_ex.response, 3000), 'origin', v_ex.origin, 'verified', v_ex.verified);
      END LOOP;
    END IF;
  ELSE
    FOR v_ex IN SELECT * FROM public.ai_learning_examples(coalesce(nullif(btrim(p_question), ''), p_text), NULL, v_g.form_code, p_notice_id, 6) LOOP
      v_examples := v_examples || jsonb_build_object('id', v_ex.id, 'for_issue', NULL, 'score', round(v_ex.score::numeric, 3),
        'issue_code', v_ex.issue_code, 'form_code', v_ex.form_code, 'section_of_law', v_ex.section_of_law, 'issue_title', v_ex.issue_title,
        'allegation', left(v_ex.allegation, 1500), 'response', left(v_ex.response, 3000), 'origin', v_ex.origin, 'verified', v_ex.verified);
    END LOOP;
  END IF;

  INSERT INTO public.ai_assist_runs (notice_id, client_id, issue_id, mode, question, input_text, examples, model, requested_by_name)
  VALUES (p_notice_id, v_g.client_id, p_issue_id, p_mode, nullif(btrim(p_question), ''), nullif(btrim(p_text), ''),
          v_examples, v_s.model, p_actor)
  RETURNING id INTO v_run;

  RETURN jsonb_build_object(
    'run_id', v_run,
    'settings', jsonb_build_object('model', v_s.model, 'effort', v_s.assist_effort,
                                   'price_in_per_mtok', v_s.price_in_per_mtok, 'price_out_per_mtok', v_s.price_out_per_mtok),
    'context', jsonb_strip_nulls(jsonb_build_object(
      'mode', p_mode,
      'notice', jsonb_build_object('form_code', v_g.form_code, 'reference_number', v_g.reference_number, 'issue_date', v_g.issue_date,
                  'due_date', v_g.due_date, 'section_of_law', v_g.section_of_law, 'financial_year', v_g.financial_year,
                  'period_from', v_g.period_from, 'period_to', v_g.period_to, 'amount_of_demand', v_g.amount_of_demand,
                  'description', v_g.description, 'issued_by', v_g.issued_by, 'notice_type', v_g.notice_type),
      'reading', v_reading - 'issues',
      'issues', coalesce(v_issues, '[]'::jsonb),
      'documents', coalesce(v_docs, '[]'::jsonb),
      'annexures', coalesce(v_ann, '[]'::jsonb),
      'draft', v_draft,
      'question', nullif(btrim(p_question), ''),
      'text', nullif(btrim(p_text), ''),
      'examples', v_examples)));
END;
$$;
GRANT EXECUTE ON FUNCTION public.ai_assist_begin(uuid, text, uuid, text, text, text) TO anon, authenticated, service_role;

-- The run's answer. p_output: {"paragraphs": [{"issue_seq", "heading", "text",
-- "examples_used": [ids]}], "answer", "client_questions", "cautions"} (draft and
-- improve: every text without a hyphen or dash, as every reply).
CREATE OR REPLACE FUNCTION public.ai_assist_finish(
  p_run_id uuid, p_status text, p_output jsonb DEFAULT NULL, p_usage jsonb DEFAULT NULL,
  p_error text DEFAULT NULL, p_reason_class text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r    public.ai_assist_runs;
  v_s    public.ai_settings;
  v_cost numeric;
  v_out  jsonb := p_output;
  v_paras jsonb;
  v_used uuid[];
  v_text text;
BEGIN
  SELECT * INTO v_r FROM public.ai_assist_runs WHERE id = p_run_id FOR UPDATE;
  IF v_r.id IS NULL THEN RETURN jsonb_build_object('error', 'gone'); END IF;
  IF v_r.status <> 'running' THEN RETURN jsonb_build_object('error', 'finished'); END IF;
  SELECT * INTO v_s FROM public.ai_settings WHERE id;
  IF p_usage IS NOT NULL AND p_usage ? 'input_tokens' THEN
    v_cost := round((coalesce((p_usage ->> 'input_tokens')::numeric, 0) * v_s.price_in_per_mtok
                   + coalesce((p_usage ->> 'output_tokens')::numeric, 0) * v_s.price_out_per_mtok) / 1000000, 4);
    INSERT INTO public.ai_audit_log (purpose, notice_id, client_id, model, input_tokens, output_tokens, cost_usd,
                                     request_id, duration_ms, status, error, agent_id, requested_by_name)
    VALUES ('assist', v_r.notice_id, v_r.client_id, coalesce(p_usage ->> 'model', v_r.model),
            (p_usage ->> 'input_tokens')::int, (p_usage ->> 'output_tokens')::int, v_cost,
            p_usage ->> 'request_id', (p_usage ->> 'duration_ms')::int,
            CASE WHEN p_usage ->> 'status' IN ('ok', 'refused', 'error') THEN p_usage ->> 'status' ELSE 'ok' END,
            left(p_error, 500), 'edge', v_r.requested_by_name);
  END IF;
  IF p_status IS DISTINCT FROM 'done' OR v_out IS NULL THEN
    UPDATE public.ai_assist_runs SET status = 'failed', error = left(coalesce(p_error, 'No answer.'), 1000),
           reason_class = p_reason_class, usage = p_usage, cost_usd = v_cost, finished_at = now()
     WHERE id = v_r.id;
    RETURN (SELECT to_jsonb(r) FROM public.ai_assist_runs r WHERE r.id = v_r.id);
  END IF;

  IF v_r.mode IN ('draft', 'improve') THEN
    SELECT coalesce(jsonb_agg(p || jsonb_build_object('text', public.reply_dehyphen(coalesce(p ->> 'text', '')),
                                                      'heading', public.reply_dehyphen(coalesce(p ->> 'heading', '')))), '[]'::jsonb)
      INTO v_paras FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_out -> 'paragraphs') = 'array' THEN v_out -> 'paragraphs' ELSE '[]'::jsonb END) p;
    v_out := v_out || jsonb_build_object('paragraphs', v_paras);
    v_text := (SELECT string_agg(btrim(concat_ws(E'\n', nullif(p ->> 'heading', ''), p ->> 'text')), E'\n\n')
                 FROM jsonb_array_elements(v_out -> 'paragraphs') p);
    v_text := public.reply_dehyphen(coalesce(v_text, v_out ->> 'answer'));
  ELSE
    v_text := v_out ->> 'answer';
  END IF;

  -- Only examples this run was given count as used.
  SELECT array_agg(DISTINCT (ex ->> 'id')::uuid) INTO v_used
    FROM jsonb_array_elements(coalesce(v_r.examples, '[]'::jsonb)) ex
   WHERE (ex ->> 'id') IN (
     SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p -> 'examples_used') = 'array' THEN p -> 'examples_used' ELSE '[]'::jsonb END)
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_out -> 'paragraphs') = 'array' THEN v_out -> 'paragraphs' ELSE '[]'::jsonb END) p
     UNION ALL
     SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_out -> 'examples_used') = 'array' THEN v_out -> 'examples_used' ELSE '[]'::jsonb END));
  IF v_used IS NOT NULL THEN
    UPDATE public.ai_learning_pairs SET uses = uses + 1, last_used_at = now() WHERE id = ANY (v_used);
  END IF;

  UPDATE public.ai_assist_runs SET status = 'done', output = v_out, answer = v_text, examples_used = v_used,
         model = coalesce(p_usage ->> 'model', model), usage = p_usage, cost_usd = v_cost, finished_at = now()
   WHERE id = v_r.id;
  RETURN (SELECT to_jsonb(r) FROM public.ai_assist_runs r WHERE r.id = v_r.id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.ai_assist_finish(uuid, text, jsonb, jsonb, text, text) TO anon, authenticated, service_role;

-- What staff did with an answer. Used paragraphs, as finally edited, are the
-- firm's answer to that issue: p_items [{"issue_id", "text"}] (an issue's earlier
-- used paragraph is replaced).
CREATE OR REPLACE FUNCTION public.ai_assist_feedback(
  p_run_id uuid, p_action text, p_items jsonb DEFAULT NULL, p_actor text DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r    public.ai_assist_runs;
  v_g    record;
  v_doc  uuid;
  v_inc  boolean;
  v_n    int := 0;
  v_all  text := '';
  e      jsonb;
  ni     public.notice_issues;
  v_ai   text;
BEGIN
  IF p_action NOT IN ('used', 'discarded') THEN
    RAISE EXCEPTION 'ai_assist_feedback: unknown action %', p_action USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_r FROM public.ai_assist_runs WHERE id = p_run_id FOR UPDATE;
  IF v_r.id IS NULL THEN RETURN 0; END IF;
  IF p_action = 'used' AND v_r.mode IN ('draft', 'improve') THEN
    SELECT g.client_id, g.case_id, g.form_code, g.section_of_law, g.financial_year INTO v_g FROM public.gst_notices g WHERE g.id = v_r.notice_id;
    v_doc := public.ai_workspace_document(v_r.notice_id);
    SELECT d.learning_included INTO v_inc FROM public.ai_documents d WHERE d.id = v_doc;
    FOR e IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END) LOOP
      CONTINUE WHEN length(btrim(coalesce(e ->> 'text', ''))) < 20;
      v_all := v_all || CASE WHEN v_all = '' THEN '' ELSE E'\n\n' END || btrim(e ->> 'text');
      CONTINUE WHEN coalesce(e ->> 'issue_id', '') !~ '^[0-9a-f-]{36}$';
      SELECT * INTO ni FROM public.notice_issues WHERE id = (e ->> 'issue_id')::uuid AND notice_id = v_r.notice_id;
      CONTINUE WHEN ni.id IS NULL;
      SELECT p ->> 'text' INTO v_ai FROM jsonb_array_elements(coalesce(v_r.output -> 'paragraphs', '[]'::jsonb)) p
       WHERE (p ->> 'issue_seq') = ni.seq::text LIMIT 1;
      INSERT INTO public.ai_learning_pairs (document_id, client_id, notice_id, issue_id, case_id, origin, form_code, section_of_law,
                                            financial_year, issue_code, issue_title, allegation, response, ai_text, seq, page, verified, included)
      VALUES (v_doc, v_g.client_id, v_r.notice_id, ni.id, v_g.case_id, 'assistant_edit', v_g.form_code, v_g.section_of_law,
              v_g.financial_year, coalesce(ni.issue_code, 'OTHER'), ni.title,
              btrim(concat_ws(E'\n', nullif(btrim(ni.title), ''), nullif(btrim(ni.detail), ''),
                              CASE WHEN coalesce(ni.quote, '') <> '' THEN '"' || ni.quote || '"' END)),
              left(btrim(e ->> 'text'), 8000), coalesce(v_ai, v_r.answer), ni.seq, ni.page, true, coalesce(v_inc, false))
      ON CONFLICT (issue_id, origin) WHERE issue_id IS NOT NULL AND origin IN ('position', 'assistant_edit')
      DO UPDATE SET response = EXCLUDED.response, ai_text = EXCLUDED.ai_text, allegation = EXCLUDED.allegation,
                    issue_code = EXCLUDED.issue_code, issue_title = EXCLUDED.issue_title;
      v_n := v_n + 1;
    END LOOP;
  END IF;
  UPDATE public.ai_assist_runs SET feedback = p_action, final_text = nullif(v_all, ''), feedback_by_name = p_actor, feedback_at = now()
   WHERE id = v_r.id;
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ai_assist_feedback(uuid, text, jsonb, text) TO anon, authenticated, service_role;

-- ── The Edge runner's heartbeat and lease ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.ai_runner_begin(p_agent text, p_seconds int, p_key_ok boolean, p_version text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_st    public.ai_runner_status;
  v_s     public.ai_settings;
  v_lease boolean := false;
BEGIN
  SELECT * INTO v_s FROM public.ai_settings WHERE id;
  SELECT * INTO v_st FROM public.ai_runner_status WHERE id FOR UPDATE;
  IF coalesce(v_s.read_enabled, false) AND coalesce(v_s.runner, 'edge') = 'edge' AND p_key_ok
     AND (v_st.lease_until IS NULL OR v_st.lease_until < now() OR v_st.lease_holder = p_agent) THEN
    v_lease := true;
  END IF;
  UPDATE public.ai_runner_status
     SET last_tick_at = now(), key_ok = p_key_ok, version = coalesce(p_version, version),
         lease_holder = CASE WHEN v_lease THEN p_agent ELSE lease_holder END,
         lease_until = CASE WHEN v_lease THEN now() + make_interval(secs => greatest(coalesce(p_seconds, 140), 30) + 20) ELSE lease_until END,
         last_error = CASE WHEN p_key_ok THEN last_error ELSE 'No ANTHROPIC_API_KEY secret is set for the Edge Functions.' END,
         last_error_at = CASE WHEN p_key_ok THEN last_error_at ELSE now() END
   WHERE id;
  RETURN jsonb_build_object(
    'lease', v_lease,
    'read_enabled', coalesce(v_s.read_enabled, false),
    'runner', v_s.runner,
    'seconds', v_s.edge_seconds,
    'sync_due', v_st.last_sync_at IS NULL OR v_st.last_sync_at < now() - interval '15 minutes');
END;
$$;
GRANT EXECUTE ON FUNCTION public.ai_runner_begin(text, int, boolean, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ai_runner_end(p_agent text, p_done int DEFAULT 0, p_error text DEFAULT NULL, p_key_ok boolean DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ai_runner_status
     SET lease_holder = CASE WHEN lease_holder = p_agent THEN NULL ELSE lease_holder END,
         lease_until = CASE WHEN lease_holder = p_agent THEN NULL ELSE lease_until END,
         key_ok = coalesce(p_key_ok, key_ok),
         last_work_at = CASE WHEN coalesce(p_done, 0) > 0 THEN now() ELSE last_work_at END,
         last_error = CASE WHEN p_error IS NOT NULL THEN left(p_error, 500) WHEN coalesce(p_done, 0) > 0 THEN NULL ELSE last_error END,
         last_error_at = CASE WHEN p_error IS NOT NULL THEN now() ELSE last_error_at END
   WHERE id
$$;
GRANT EXECUTE ON FUNCTION public.ai_runner_end(text, int, text, boolean) TO anon, authenticated, service_role;

-- A job handed back untouched (the key was refused before it could be read): back on
-- the queue without using up one of its three tries.
CREATE OR REPLACE FUNCTION public.ai_job_release(p_agent text, p_kind text, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_kind = 'notice' THEN
    UPDATE public.notice_extractions SET status = 'queued', agent_id = NULL, claimed_at = NULL, attempts = greatest(attempts - 1, 0)
     WHERE id = p_id AND status = 'running' AND agent_id = p_agent;
  ELSE
    UPDATE public.ai_documents SET status = 'queued', agent_id = NULL, claimed_at = NULL, attempts = greatest(attempts - 1, 0)
     WHERE id = p_id AND status = 'running' AND agent_id = p_agent;
  END IF;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ai_job_release(text, text, uuid) TO anon, authenticated, service_role;

-- pg_cron, every two minutes: wakes the Edge Function when reading is on, no run
-- holds the lease, and there is work (or the queues are due a refresh).
CREATE OR REPLACE FUNCTION public.ai_tick_dispatch()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s  public.ai_settings;
  v_st public.ai_runner_status;
BEGIN
  SELECT * INTO v_s FROM public.ai_settings WHERE id;
  IF NOT coalesce(v_s.read_enabled, false) OR coalesce(v_s.runner, 'edge') <> 'edge' THEN RETURN false; END IF;
  SELECT * INTO v_st FROM public.ai_runner_status WHERE id;
  IF v_st.lease_until IS NOT NULL AND v_st.lease_until > now() THEN RETURN false; END IF;
  -- No key, or a refused one: tried again every half hour, not every two minutes.
  IF v_st.key_ok = false AND v_st.last_tick_at > now() - interval '30 minutes' THEN RETURN false; END IF;
  IF NOT (v_st.last_sync_at IS NULL OR v_st.last_sync_at < now() - interval '15 minutes'
          OR EXISTS (SELECT 1 FROM public.notice_extractions x WHERE x.source = 'ai' AND x.status = 'queued'
                       AND (x.not_before IS NULL OR x.not_before <= now()))
          OR (v_s.read_documents AND EXISTS (SELECT 1 FROM public.ai_documents d WHERE d.status = 'queued'
                                               AND (d.not_before IS NULL OR d.not_before <= now())))) THEN
    RETURN false;
  END IF;
  IF public.ai_spend_today_usd() >= v_s.daily_cap_usd AND v_st.last_sync_at IS NOT NULL
     AND v_st.last_sync_at >= now() - interval '15 minutes' THEN
    RETURN false;
  END IF;
  PERFORM net.http_post(
    url := 'https://gcquafqxbykxkbexcdpy.supabase.co/functions/v1/notice-ai',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'gst_cron_anon_key')),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 15000);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_tick_dispatch() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.schedule('notice-ai-tick', '*/2 * * * *', 'SELECT public.ai_tick_dispatch()');
EXCEPTION WHEN undefined_function OR invalid_schema_name THEN
  RAISE NOTICE 'pg_cron is not available: schedule notice-ai-tick by hand';
END $$;

-- ── The AI page's numbers ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ai_read_status()
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'settings', (SELECT to_jsonb(s) FROM public.ai_settings s WHERE s.id),
    -- The office agent (runner office_agent) or the Edge Function's last run (runner edge).
    'agent_online', CASE WHEN coalesce((SELECT s.runner FROM public.ai_settings s WHERE s.id), 'edge') = 'edge'
                         THEN coalesce((SELECT r.last_tick_at > now() - interval '10 minutes' AND coalesce(r.key_ok, false)
                                          FROM public.ai_runner_status r WHERE r.id), false)
                         ELSE EXISTS (SELECT 1 FROM public.portal_agent_heartbeat h
                                       WHERE h.agent_id NOT LIKE 'chrome:%' AND h.last_seen > now() - interval '150 seconds') END,
    'runner', (SELECT to_jsonb(r) - 'lease_holder' FROM public.ai_runner_status r WHERE r.id),
    'spend_today_usd', public.ai_spend_today_usd(),
    'assist_spend_today_usd', public.ai_assist_spend_today_usd(),
    'queue', (SELECT jsonb_build_object(
                'queued', count(*) FILTER (WHERE status = 'queued'),
                'running', count(*) FILTER (WHERE status = 'running'),
                'done', count(*) FILTER (WHERE status IN ('done', 'superseded')),
                'done_today', count(*) FILTER (WHERE status = 'done' AND finished_at >= public.ist_today()::timestamp AT TIME ZONE 'Asia/Kolkata'),
                'failed_today', count(*) FILTER (WHERE status = 'failed' AND finished_at >= public.ist_today()::timestamp AT TIME ZONE 'Asia/Kolkata'))
                FROM public.notice_extractions WHERE source = 'ai'),
    'documents', (SELECT jsonb_build_object(
                    'queued', count(*) FILTER (WHERE status = 'queued'),
                    'running', count(*) FILTER (WHERE status = 'running'),
                    'done', count(*) FILTER (WHERE status = 'done' AND source <> 'workspace'),
                    'failed', count(*) FILTER (WHERE status = 'failed'),
                    'skipped', count(*) FILTER (WHERE status = 'skipped'),
                    'done_today', count(*) FILTER (WHERE status = 'done' AND source <> 'workspace'
                                                   AND finished_at >= public.ist_today()::timestamp AT TIME ZONE 'Asia/Kolkata'))
                    FROM public.ai_documents),
    'learning', (SELECT jsonb_build_object(
                   'responses', (SELECT count(*) FROM public.ai_learning_responses),
                   'responses_included', (SELECT count(*) FROM public.ai_learning_responses WHERE learning_included),
                   'pairs', count(*), 'pairs_included', count(*) FILTER (WHERE included),
                   'uses', coalesce(sum(uses), 0))
                   FROM public.ai_learning_pairs),
    'assist', (SELECT jsonb_build_object('runs_today', count(*), 'used_today', count(*) FILTER (WHERE feedback = 'used'))
                 FROM public.ai_assist_runs WHERE created_at >= public.ist_today()::timestamp AT TIME ZONE 'Asia/Kolkata'),
    'consent', (SELECT jsonb_build_object(
                  'clients', count(*),
                  'with_consent', count(*) FILTER (WHERE c.ai_consent_at IS NOT NULL AND NOT c.ai_opt_out),
                  'opted_out', count(*) FILTER (WHERE c.ai_opt_out))
                  FROM public.clients c WHERE NOT coalesce(c.inactive_at_hand, false)),
    'month', (SELECT jsonb_build_object('calls', count(*), 'cost_usd', coalesce(sum(cost_usd), 0),
                                         'input_tokens', coalesce(sum(input_tokens), 0), 'output_tokens', coalesce(sum(output_tokens), 0))
                FROM public.ai_audit_log WHERE at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'))
$$;
GRANT EXECUTE ON FUNCTION public.ai_read_status() TO anon, authenticated, service_role;

-- What is already there: positions staff typed become examples (not yet chosen),
-- and every case-folder attachment and sent draft is registered.
DO $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT DISTINCT ni.notice_id FROM public.notice_issues ni
               JOIN public.gst_notices g ON g.id = ni.notice_id
              WHERE length(btrim(coalesce(ni.position, ''))) >= 20 LOOP
    PERFORM public.ai_workspace_document(v_id);
  END LOOP;
END $$;
INSERT INTO public.ai_learning_pairs (document_id, client_id, notice_id, issue_id, case_id, origin, form_code, section_of_law,
                                      financial_year, issue_code, issue_title, allegation, response, seq, page, verified, included)
SELECT d.id, g.client_id, g.id, ni.id, g.case_id, 'position', g.form_code, g.section_of_law, g.financial_year,
       coalesce(ni.issue_code, 'OTHER'), ni.title,
       btrim(concat_ws(E'\n', nullif(btrim(ni.title), ''), nullif(btrim(ni.detail), ''),
                       CASE WHEN coalesce(ni.quote, '') <> '' THEN '"' || ni.quote || '"' END)),
       btrim(ni.position), ni.seq, ni.page, true, d.learning_included
  FROM public.notice_issues ni
  JOIN public.gst_notices g ON g.id = ni.notice_id
  JOIN public.ai_documents d ON d.source = 'workspace' AND d.source_ref = 'workspace:' || g.id
 WHERE length(btrim(coalesce(ni.position, ''))) >= 20
   AND btrim(concat_ws(E'\n', nullif(btrim(ni.title), ''), nullif(btrim(ni.detail), ''))) <> ''
ON CONFLICT (issue_id, origin) WHERE issue_id IS NOT NULL AND origin IN ('position', 'assistant_edit') DO NOTHING;
SELECT public.ai_sync();
