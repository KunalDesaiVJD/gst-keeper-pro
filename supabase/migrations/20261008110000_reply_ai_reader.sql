-- Notices Phase 4 · Reply Factory I, part 2: reading the notice PDF with the
-- Claude API (roadmap Phase 4 "Document intelligence"; audit R-08, R-15, S
-- stage 6). Read docs/REPLY_FACTORY_POSITIONS.md before changing anything here.
--
-- Ships SWITCHED OFF. Nothing is sent to the Claude API until a manager turns
-- on ai_settings.read_enabled, the client has consent on file
-- (clients.ai_consent_at, the engagement-letter clause) and is not opted out,
-- and the office agent has an API key in agent/.env. The agent claims a job
-- here (SKIP LOCKED), reads the PDF, checks every field against the page text
-- and the amounts against each other, and finishes here; this side applies
-- only checked fields, only into empty columns, as "auto — verify".
--
-- Objects: ai_settings (one row), clients.ai_consent_at / ai_consent_note /
-- ai_opt_out, ai_audit_log (one row per API call, select-only for the app),
-- notice_read_document(), ai_read_allowed(), notice_read_request(),
-- notice_read_auto() + triggers, notice_read_claim(), notice_read_finish(),
-- notice_reads_release(), ai_set_consent(), ai_read_status().

-- ── Settings (one row) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_settings (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  read_enabled        boolean NOT NULL DEFAULT false,
  auto_read_new       boolean NOT NULL DEFAULT true,
  model               text    NOT NULL DEFAULT 'claude-opus-5-5',
  effort              text    NOT NULL DEFAULT 'high' CHECK (effort IN ('low', 'medium', 'high', 'xhigh', 'max')),
  daily_cap_usd       numeric NOT NULL DEFAULT 10 CHECK (daily_cap_usd >= 0),
  max_pages           int     NOT NULL DEFAULT 60 CHECK (max_pages BETWEEN 1 AND 600),
  price_in_per_mtok   numeric NOT NULL DEFAULT 4  CHECK (price_in_per_mtok >= 0),
  price_out_per_mtok  numeric NOT NULL DEFAULT 20 CHECK (price_out_per_mtok >= 0),
  usd_inr             numeric NOT NULL DEFAULT 84 CHECK (usd_inr > 0),
  updated_by_name     text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ai_settings IS
  'Reading notices with the Claude API (Phase 4). read_enabled ships false; the model, effort, daily spend cap and the prices used for cost estimates (USD per million tokens) are settings.';
INSERT INTO public.ai_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_settings_all ON public.ai_settings;
CREATE POLICY ai_settings_all ON public.ai_settings FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON public.ai_settings TO anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_ai_settings_updated_at ON public.ai_settings;
CREATE TRIGGER trg_ai_settings_updated_at BEFORE UPDATE ON public.ai_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Consent per client (engagement-letter clause) ──────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS ai_consent_at   date,
  ADD COLUMN IF NOT EXISTS ai_consent_note text,
  ADD COLUMN IF NOT EXISTS ai_opt_out      boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.clients.ai_consent_at IS
  'Date the client agreed (engagement-letter clause) that the firm may process its notices with the Claude API. NULL = no consent: nothing of this client''s is sent.';
COMMENT ON COLUMN public.clients.ai_opt_out IS 'The client asked that nothing of theirs be processed by AI; overrides a consent date.';

-- ── Audit: one row per API call ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_audit_log (
  id                bigserial PRIMARY KEY,
  at                timestamptz NOT NULL DEFAULT now(),
  purpose           text NOT NULL,
  notice_id         uuid,
  client_id         uuid,
  extraction_id     uuid,
  model             text,
  input_tokens      int,
  output_tokens     int,
  cost_usd          numeric,
  document_sha256   text,
  request_id        text,
  duration_ms       int,
  status            text NOT NULL CHECK (status IN ('ok', 'refused', 'error')),
  error             text,
  agent_id          text,
  requested_by_name text
);
COMMENT ON TABLE public.ai_audit_log IS
  'One row per Claude API call (who asked, which notice, model, tokens, estimated cost, the document''s hash). Written only by notice_read_finish; the app can read it.';
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_at ON public.ai_audit_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_notice ON public.ai_audit_log (notice_id);
ALTER TABLE public.ai_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_audit_log_read ON public.ai_audit_log;
CREATE POLICY ai_audit_log_read ON public.ai_audit_log FOR ALL TO public USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ai_audit_log FROM anon, authenticated;
GRANT SELECT ON public.ai_audit_log TO anon, authenticated;
GRANT ALL ON public.ai_audit_log TO service_role;

-- ── Which document to read ─────────────────────────────────────────────────
-- The notice's own PDF; else the first attachment of its own case-folder item
-- (the notice itself is the item's main document). Only files kept in the app's
-- own storage: the agent downloads from nowhere else.
CREATE OR REPLACE FUNCTION public.notice_read_document(p_notice_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object('url', g.pdf_url, 'label', 'Notice PDF')
       FROM public.gst_notices g WHERE g.id = p_notice_id AND coalesce(g.pdf_url, '') ~ '/storage/v1/object/'),
    (SELECT jsonb_build_object('url', a ->> 'url', 'label', coalesce(nullif(a ->> 'label', ''), 'Case folder document'))
       FROM public.gst_notices g
       JOIN public.gst_case_folder_items fi ON fi.client_id = g.client_id AND fi.case_id = g.case_id
                                          AND fi.reference_number = g.reference_number AND fi.deleted_at IS NULL
       CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(fi.attachments) = 'array' THEN fi.attachments ELSE '[]'::jsonb END)
                          WITH ORDINALITY x(a, n)
      WHERE g.id = p_notice_id AND coalesce(a ->> 'url', '') ~* '\.pdf($|\?)'
        AND coalesce(a ->> 'url', '') ~ '/storage/v1/object/'
      ORDER BY fi.last_seen_at DESC NULLS LAST, x.n
      LIMIT 1))
$$;

-- NULL when this client's notices may be read now, else why not.
CREATE OR REPLACE FUNCTION public.ai_read_allowed(p_client_id uuid)
RETURNS text
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN NOT coalesce((SELECT s.read_enabled FROM public.ai_settings s WHERE s.id), false) THEN 'off'
           WHEN c.id IS NULL THEN 'no_client'
           WHEN coalesce(c.ai_opt_out, false) THEN 'opted_out'
           WHEN c.ai_consent_at IS NULL THEN 'no_consent'
         END
    FROM (SELECT 1) one
    LEFT JOIN public.clients c ON c.id = p_client_id
$$;

-- ── Queue a read ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_read_request(
  p_notice_id uuid, p_actor_id uuid DEFAULT NULL, p_actor_name text DEFAULT NULL, p_priority int DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n      record;
  v_why    text;
  v_doc    jsonb;
  v_active uuid;
  v_id     uuid;
BEGIN
  SELECT g.id, g.client_id INTO v_n FROM public.gst_notices g WHERE g.id = p_notice_id AND g.deleted_at IS NULL;
  IF v_n.id IS NULL THEN RETURN jsonb_build_object('queued', false, 'reason', 'gone'); END IF;
  v_why := public.ai_read_allowed(v_n.client_id);
  IF v_why IS NOT NULL THEN RETURN jsonb_build_object('queued', false, 'reason', v_why); END IF;
  v_doc := public.notice_read_document(p_notice_id);
  IF v_doc IS NULL THEN RETURN jsonb_build_object('queued', false, 'reason', 'no_document'); END IF;
  SELECT x.id INTO v_active FROM public.notice_extractions x
   WHERE x.notice_id = p_notice_id AND x.source = 'ai' AND x.status IN ('queued', 'running');
  IF v_active IS NOT NULL THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'already', 'extraction_id', v_active);
  END IF;
  INSERT INTO public.notice_extractions (notice_id, client_id, source, status, priority, requested_by, requested_by_name,
                                         document_url, document_label)
  VALUES (p_notice_id, v_n.client_id, 'ai', 'queued', coalesce(p_priority, CASE WHEN p_actor_name IS NULL THEN 50 ELSE 80 END),
          p_actor_id, p_actor_name, v_doc ->> 'url', v_doc ->> 'label')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('queued', false, 'reason', 'already'); END IF;
  RETURN jsonb_build_object('queued', true, 'extraction_id', v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_read_request(uuid, uuid, text, int) TO anon, authenticated, service_role;

-- New notices are read by themselves (when switched on): notices that need an
-- answer, or whose form is unknown — not GSTR-3A (the app rebuilds those) nor
-- acknowledgements; each document once.
CREATE OR REPLACE FUNCTION public.notice_read_auto(p_notice_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n   record;
  v_doc jsonb;
BEGIN
  IF NOT coalesce((SELECT s.read_enabled AND s.auto_read_new FROM public.ai_settings s WHERE s.id), false) THEN
    RETURN false;
  END IF;
  SELECT g.id, g.client_id, g.form_code, g.staff_status, g.issue_date, r.auto_close_reason
    INTO v_n
    FROM public.gst_notices g LEFT JOIN public.notice_form_rules r ON r.form_code = g.form_code
   WHERE g.id = p_notice_id AND g.deleted_at IS NULL;
  IF v_n.id IS NULL OR v_n.auto_close_reason IS NOT NULL OR v_n.form_code IN ('GSTR-3A', 'LUT', 'DRC-03') THEN RETURN false; END IF;
  -- Only new, open notices read themselves: a client's first sync brings years of closed
  -- and old notices, and reading those is a person's choice (Read the PDF).
  IF public.notice_is_closed(v_n.staff_status)
     OR v_n.issue_date < public.ist_today() - coalesce((SELECT s.new_notice_max_age_days FROM public.notice_settings s LIMIT 1), 30) THEN
    RETURN false;
  END IF;
  -- A notice type that needs no reply (20261008150000) is not read either.
  IF to_regclass('public.notice_type_settings') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.notice_type_settings t WHERE t.form_code = v_n.form_code AND t.response_need = 'none') THEN
      RETURN false;
    END IF;
  END IF;
  IF public.ai_read_allowed(v_n.client_id) IS NOT NULL THEN RETURN false; END IF;
  v_doc := public.notice_read_document(p_notice_id);
  IF v_doc IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.notice_extractions x
              WHERE x.notice_id = p_notice_id AND x.source = 'ai'
                AND (x.status IN ('queued', 'running') OR (x.document_url = v_doc ->> 'url' AND x.status IN ('done', 'failed')))) THEN
    RETURN false;
  END IF;
  RETURN coalesce((public.notice_read_request(p_notice_id, NULL, NULL, 50) ->> 'queued')::boolean, false);
END;
$$;
REVOKE ALL ON FUNCTION public.notice_read_auto(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.gst_notices_read_auto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND (TG_OP = 'INSERT' OR NEW.pdf_url IS DISTINCT FROM OLD.pdf_url) THEN
    PERFORM public.notice_read_auto(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_gst_notices_read_auto ON public.gst_notices;
CREATE TRIGGER trg_gst_notices_read_auto
  AFTER INSERT OR UPDATE OF pdf_url ON public.gst_notices
  FOR EACH ROW EXECUTE FUNCTION public.gst_notices_read_auto();

CREATE OR REPLACE FUNCTION public.gst_case_folder_items_read_auto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NEW.reference_number IS NULL OR NEW.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.attachments IS NOT DISTINCT FROM OLD.attachments THEN RETURN NULL; END IF;
  FOR v_id IN SELECT g.id FROM public.gst_notices g
               WHERE g.client_id = NEW.client_id AND g.case_id = NEW.case_id
                 AND g.reference_number = NEW.reference_number AND g.deleted_at IS NULL LOOP
    PERFORM public.notice_read_auto(v_id);
  END LOOP;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_gst_case_folder_items_read_auto ON public.gst_case_folder_items;
CREATE TRIGGER trg_gst_case_folder_items_read_auto
  AFTER INSERT OR UPDATE OF attachments ON public.gst_case_folder_items
  FOR EACH ROW EXECUTE FUNCTION public.gst_case_folder_items_read_auto();

-- ── The office agent's side ────────────────────────────────────────────────
-- Today's spend (IST day) against the cap.
CREATE OR REPLACE FUNCTION public.ai_spend_today_usd()
RETURNS numeric
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(cost_usd), 0) FROM public.ai_audit_log
   WHERE at >= (((now() AT TIME ZONE 'Asia/Kolkata')::date)::timestamp AT TIME ZONE 'Asia/Kolkata')
$$;

-- One job, or NULL: switched on, under the day's cap, consent still on file.
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

CREATE OR REPLACE FUNCTION public.notice_reads_release(p_agent text)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH r AS (
    UPDATE public.notice_extractions SET status = 'queued', agent_id = NULL, claimed_at = NULL
     WHERE source = 'ai' AND status = 'running' AND agent_id = p_agent
    RETURNING 1)
  SELECT count(*)::int FROM r
$$;
GRANT EXECUTE ON FUNCTION public.notice_reads_release(text) TO anon, authenticated, service_role;

-- The agent's result. p_result: {"fields": {"<field>": {"value", "page", "quote",
-- "quote_ok"}}, "issues": [...], "checks": {...}, "detail": {...}, "pages",
-- "text_layer", "document_sha256", "model"}. p_usage: {"input_tokens",
-- "output_tokens", "duration_ms", "request_id", "status": ok|refused|error}.
CREATE OR REPLACE FUNCTION public.notice_read_finish(
  p_extraction_id uuid, p_agent text, p_status text, p_result jsonb DEFAULT NULL, p_usage jsonb DEFAULT NULL,
  p_error text DEFAULT NULL, p_reason_class text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_x       public.notice_extractions;
  v_s       public.ai_settings;
  v_cost    numeric;
  v_fields  jsonb := '{}'::jsonb;
  v_res     jsonb := jsonb_build_object('applied', '[]'::jsonb, 'conflicts', '{}'::jsonb);
  v_outcome text;
  v_issues  jsonb;
  v_withheld boolean := false;
  v_iss_sum numeric;
  v_cur_sum numeric;
  v_touched boolean;
  v_added   int := 0;
  k         text;
  f         jsonb;
  e         jsonb;
  n         int := 0;
BEGIN
  SELECT * INTO v_x FROM public.notice_extractions WHERE id = p_extraction_id FOR UPDATE;
  IF v_x.id IS NULL THEN RETURN jsonb_build_object('error', 'gone'); END IF;
  IF v_x.status <> 'running' OR v_x.agent_id IS DISTINCT FROM p_agent THEN
    RETURN jsonb_build_object('error', 'not_yours');
  END IF;
  SELECT * INTO v_s FROM public.ai_settings WHERE id;

  -- One audit row per API call that was made.
  IF p_usage IS NOT NULL AND p_usage ? 'input_tokens' THEN
    v_cost := round((coalesce((p_usage ->> 'input_tokens')::numeric, 0) * v_s.price_in_per_mtok
                   + coalesce((p_usage ->> 'output_tokens')::numeric, 0) * v_s.price_out_per_mtok) / 1000000, 4);
    INSERT INTO public.ai_audit_log (purpose, notice_id, client_id, extraction_id, model, input_tokens, output_tokens, cost_usd,
                                     document_sha256, request_id, duration_ms, status, error, agent_id, requested_by_name)
    VALUES ('notice_read', v_x.notice_id, v_x.client_id, v_x.id, coalesce(p_result ->> 'model', p_usage ->> 'model', v_s.model),
            (p_usage ->> 'input_tokens')::int, (p_usage ->> 'output_tokens')::int, v_cost,
            p_result ->> 'document_sha256', p_usage ->> 'request_id', (p_usage ->> 'duration_ms')::int,
            CASE WHEN p_usage ->> 'status' IN ('ok', 'refused', 'error') THEN p_usage ->> 'status' ELSE 'ok' END,
            left(p_error, 500), p_agent, v_x.requested_by_name);
  END IF;

  IF p_status = 'retry' THEN
    IF v_x.attempts >= 3 THEN
      UPDATE public.notice_extractions SET status = 'failed', error = left(p_error, 1000), reason_class = coalesce(p_reason_class, 'error'),
             finished_at = now(), usage = coalesce(p_usage, usage)
       WHERE id = v_x.id;
      RETURN jsonb_build_object('status', 'failed');
    END IF;
    UPDATE public.notice_extractions SET status = 'queued', agent_id = NULL, claimed_at = NULL,
           not_before = now() + make_interval(mins => 5 * power(2, greatest(v_x.attempts - 1, 0))::int),
           error = left(p_error, 1000), reason_class = p_reason_class
     WHERE id = v_x.id;
    RETURN jsonb_build_object('status', 'queued');
  ELSIF p_status IN ('failed', 'cancelled') THEN
    UPDATE public.notice_extractions SET status = p_status, error = left(p_error, 1000), reason_class = p_reason_class,
           finished_at = now(), usage = coalesce(p_usage, usage),
           document_sha256 = coalesce(p_result ->> 'document_sha256', document_sha256)
     WHERE id = v_x.id;
    RETURN jsonb_build_object('status', p_status);
  ELSIF p_status <> 'done' THEN
    RAISE EXCEPTION 'notice_read_finish: unknown status %', p_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.notice_extractions SET
    status = 'done', finished_at = now(), model = coalesce(p_result ->> 'model', v_s.model),
    usage = coalesce(p_usage, '{}'::jsonb) || jsonb_build_object('cost_usd', v_cost),
    fields = p_result -> 'fields', issues = p_result -> 'issues', checks = p_result -> 'checks', detail = p_result -> 'detail',
    pages = (p_result ->> 'pages')::int, text_layer = (p_result ->> 'text_layer')::boolean,
    document_sha256 = p_result ->> 'document_sha256', error = NULL, reason_class = NULL
  WHERE id = v_x.id;

  -- Earlier AI readings of this notice give way to this one.
  UPDATE public.notice_extractions SET status = 'superseded'
   WHERE notice_id = v_x.notice_id AND source = 'ai' AND status = 'done' AND id <> v_x.id;

  -- A notice addressed to another GSTIN is never applied.
  IF (p_result #>> '{checks,gstin,ok}') = 'false' THEN
    UPDATE public.notice_extractions SET outcome = 'gstin_mismatch' WHERE id = v_x.id;
    PERFORM public.notice_log_event(v_x.notice_id, 'read_by_ai', NULL,
      jsonb_build_object('outcome', 'gstin_mismatch', 'extraction_id', v_x.id), NULL, 'Notice reader');
    RETURN jsonb_build_object('status', 'done', 'outcome', 'gstin_mismatch');
  END IF;

  -- Only fields whose quote was found on the page (demand: amounts that add up).
  FOR k, f IN SELECT * FROM jsonb_each(coalesce(p_result -> 'fields', '{}'::jsonb)) LOOP
    CONTINUE WHEN NOT coalesce((f ->> 'quote_ok')::boolean, false);
    IF k = 'demand' AND (p_result #>> '{checks,sums,ok}') = 'false' THEN CONTINUE; END IF;
    IF k = 'officer' THEN v_fields := v_fields || jsonb_build_object('issued_by', f -> 'value');
    ELSIF k IN ('section_of_law', 'financial_year', 'period_from', 'period_to', 'din', 'demand', 'due_date',
                'hearing_date', 'hearing_note') THEN
      v_fields := v_fields || jsonb_build_object(k, f -> 'value');
    END IF;
  END LOOP;
  IF v_fields ? 'demand' THEN
    v_fields := v_fields || jsonb_build_object('amount_of_demand', public.reply_demand_total(v_fields -> 'demand'));
  END IF;
  v_res := public.notice_apply_reading(v_x.notice_id, v_x.id, 'ai', v_fields, false);

  -- Issues: added when the notice has none, or only untouched portal/form
  -- issues that this reading's issues add up to (within ₹1), which they replace.
  v_issues := CASE WHEN jsonb_typeof(p_result -> 'issues') = 'array' THEN p_result -> 'issues' ELSE '[]'::jsonb END;
  -- All or nothing: one issue whose quote does not check out, or issues the reader
  -- held back (detail.issues_withheld), leave the list to a person; a partial list
  -- would read as the whole notice.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_issues) e3 WHERE e3 ->> 'quote_ok' = 'false') THEN
    v_withheld := true;
    v_issues := '[]'::jsonb;
  END IF;
  v_withheld := v_withheld OR coalesce(jsonb_typeof(p_result -> 'detail' -> 'issues_withheld') = 'array'
                                       AND jsonb_array_length(p_result -> 'detail' -> 'issues_withheld') > 0, false);
  IF jsonb_array_length(v_issues) > 0 THEN
    SELECT coalesce(sum(coalesce((e2 ->> 'amount')::numeric, public.reply_demand_total(e2 -> 'demand'))), 0)
      INTO v_iss_sum FROM jsonb_array_elements(v_issues) e2;
    SELECT coalesce(sum(i.amount), 0),
           bool_or(i.source = 'manual' OR i.source = 'extracted' OR i.explained_amount > 0 OR i.status <> 'open' OR i.updated_by_name IS NOT NULL)
      INTO v_cur_sum, v_touched
      FROM public.notice_issues i WHERE i.notice_id = v_x.notice_id;
    IF NOT coalesce(v_touched, false) AND (v_cur_sum = 0 OR abs(v_cur_sum - v_iss_sum) <= 1) THEN
      DELETE FROM public.notice_issues i WHERE i.notice_id = v_x.notice_id AND i.source IN ('portal', 'form');
      FOR e IN SELECT * FROM jsonb_array_elements(v_issues) LOOP
        n := n + 1;
        INSERT INTO public.notice_issues (notice_id, seq, title, detail, amount, status, source, issue_code,
                                          period_from, period_to, demand, page, quote, verified, extraction_id, created_by_name)
        VALUES (v_x.notice_id, n, coalesce(nullif(btrim(e ->> 'title'), ''), 'Issue ' || n), left(e ->> 'detail', 2000),
                greatest(coalesce((e ->> 'amount')::numeric, public.reply_demand_total(e -> 'demand'), 0), 0),
                'open', 'extracted',
                CASE WHEN EXISTS (SELECT 1 FROM public.reply_issue_types t WHERE t.code = e ->> 'issue_code') THEN e ->> 'issue_code' ELSE 'OTHER' END,
                (e ->> 'period_from')::date, (e ->> 'period_to')::date, e -> 'demand', (e ->> 'page')::int, left(e ->> 'quote', 500),
                false, v_x.id, 'Notice reader');
        v_added := v_added + 1;
      END LOOP;
    END IF;
  END IF;

  v_outcome := CASE
    WHEN v_withheld OR (jsonb_array_length(v_issues) > 0 AND v_added = 0) THEN 'needs_review'
    WHEN v_res -> 'conflicts' <> '{}'::jsonb THEN 'conflict'
    WHEN jsonb_array_length(v_res -> 'applied') > 0 OR v_added > 0 THEN 'applied'
    ELSE 'nothing_new' END;
  UPDATE public.notice_extractions
     SET outcome = v_outcome,
         checks = coalesce(checks, '{}'::jsonb) || jsonb_build_object('conflicts', v_res -> 'conflicts', 'issues_added', v_added)
   WHERE id = v_x.id;
  PERFORM public.notice_log_event(v_x.notice_id, 'read_by_ai', NULL,
    jsonb_build_object('outcome', v_outcome, 'applied', v_res -> 'applied', 'issues_added', v_added, 'extraction_id', v_x.id),
    NULL, 'Notice reader');
  RETURN jsonb_build_object('status', 'done', 'outcome', v_outcome, 'applied', v_res -> 'applied',
                            'conflicts', v_res -> 'conflicts', 'issues_added', v_added);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_read_finish(uuid, text, text, jsonb, jsonb, text, text) TO anon, authenticated, service_role;

-- ── Consent in bulk, and the page's numbers ────────────────────────────────
CREATE OR REPLACE FUNCTION public.ai_set_consent(
  p_client_ids uuid[], p_consent_at date, p_note text DEFAULT NULL, p_opt_out boolean DEFAULT NULL)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH u AS (
    UPDATE public.clients c
       SET ai_consent_at = p_consent_at,
           ai_consent_note = CASE WHEN p_consent_at IS NULL THEN NULL ELSE coalesce(p_note, c.ai_consent_note) END,
           ai_opt_out = coalesce(p_opt_out, c.ai_opt_out)
     WHERE c.id = ANY (p_client_ids)
    RETURNING 1)
  SELECT count(*)::int FROM u
$$;
GRANT EXECUTE ON FUNCTION public.ai_set_consent(uuid[], date, text, boolean) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ai_read_status()
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'settings', (SELECT to_jsonb(s) FROM public.ai_settings s WHERE s.id),
    'agent_online', public.autopilot_agent_online(),
    'spend_today_usd', public.ai_spend_today_usd(),
    'queue', (SELECT jsonb_build_object(
                'queued', count(*) FILTER (WHERE status = 'queued'),
                'running', count(*) FILTER (WHERE status = 'running'),
                'done_today', count(*) FILTER (WHERE status = 'done' AND finished_at >= public.ist_today()::timestamp AT TIME ZONE 'Asia/Kolkata'),
                'failed_today', count(*) FILTER (WHERE status = 'failed' AND finished_at >= public.ist_today()::timestamp AT TIME ZONE 'Asia/Kolkata'))
                FROM public.notice_extractions WHERE source = 'ai'),
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
