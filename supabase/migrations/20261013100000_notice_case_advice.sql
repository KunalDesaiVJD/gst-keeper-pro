-- Notices · "What to do now" for every open case (the firm's request of
-- 12 October 2026: "in refund it says overdue, then using AI a suggestion or
-- recommendation to be mentioned here: what is expected from the user?").
--
-- The notice assistant (Edge Function notice-ai, action advise / advise_next)
-- reads a case's whole correspondence as read, its facts and today's date, and
-- says what the firm is expected to do now: one line, the steps, the date that
-- governs, and whether the case can simply be closed. One row per case
-- (notice_case_advice), refreshed when the case changes (inputs_hash: stage,
-- due date, hearing, notices, documents and how many of them are read). The app
-- shows the usual step for the form until the AI's answer is in
-- (src/lib/noticeNextStep.ts). Advice is guidance for staff: nothing is filed,
-- paid or closed by it. Same switch as the reader (ai_settings.read_enabled).
--
-- Objects: notice_case_advice, notice_case_advice_hash(), notice_case_advice_context(),
-- notice_case_advice_begin(), notice_case_advice_claim(), notice_case_advice_finish(),
-- notice_case_advice_request(), notice_case_advice_dispatch() + pg_cron notice-ai-advise.

CREATE TABLE IF NOT EXISTS public.notice_case_advice (
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  case_key     text NOT NULL,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  advice       jsonb,
  inputs_hash  text,
  requested_by text,
  requested_at timestamptz,
  started_at   timestamptz,
  finished_at  timestamptz,
  agent        text,
  model        text,
  usage        jsonb,
  error        text,
  reason_class text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, case_key)
);
COMMENT ON TABLE public.notice_case_advice IS
  'What the firm is expected to do now on a notice case, as the notice assistant reads the case (advice: headline, situation, steps, deadline, can_close, cautions). Guidance for staff only.';
ALTER TABLE public.notice_case_advice ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notice_case_advice_all ON public.notice_case_advice;
CREATE POLICY notice_case_advice_all ON public.notice_case_advice FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notice_case_advice TO anon, authenticated, service_role;

-- What the advice depends on: when any of it changes, the case is advised again.
CREATE OR REPLACE FUNCTION public.notice_case_advice_hash(p_client_id uuid, p_case_key text)
RETURNS text
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT md5(concat_ws('|', c.stage, c.is_open, c.is_overdue, c.next_due, c.next_hearing, c.notices, c.documents, c.last_arrived_at,
    (SELECT count(*) FROM public.ai_documents d
      WHERE d.status = 'done' AND d.client_id = c.client_id
        AND (d.notice_id IN (SELECT f.id FROM public.notice_facts f
                              WHERE f.client_id = c.client_id
                                AND public.notice_case_key(f.client_id, f.case_id, f.category, f.id) = c.case_key)
          OR d.folder_item_id IN (SELECT fi.id FROM public.gst_case_folder_items fi
                                   WHERE fi.client_id = c.client_id AND fi.deleted_at IS NULL
                                     AND public.notice_case_root(fi.client_id, fi.case_id) = c.case_key)))))
    FROM public.notice_cases c
   WHERE c.client_id = p_client_id AND c.case_key = public.notice_case_root(p_client_id, p_case_key)
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_advice_hash(uuid, text) TO anon, authenticated, service_role;

-- What the assistant reads: the case, its facts, its correspondence as read (newest 20) and today.
CREATE OR REPLACE FUNCTION public.notice_case_advice_context(p_client_id uuid, p_case_key text)
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'today', c.today_ist,
    'case', jsonb_build_object(
      'client', c.client_name, 'track', c.track, 'title', c.title, 'form_code', c.form_code, 'forms', c.forms,
      'case_id', c.case_id, 'stage', c.stage_label, 'is_open', c.is_open, 'is_overdue', c.is_overdue,
      'next_due', c.next_due, 'next_hearing', c.next_hearing, 'first_issue_date', c.first_issue_date,
      'last_issue_date', c.last_issue_date, 'exposure', c.exposure, 'amount_of_demand', c.amount_of_demand,
      'financial_years', c.financial_years, 'notices', c.notices, 'documents', c.documents),
    'overview', public.notice_case_overview(p_client_id, c.case_key),
    'items', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'from', i ->> 'from', 'date', i ->> 'date', 'label', i ->> 'label', 'reference', i ->> 'reference',
                 'stage', i ->> 'stage_label', 'title', i #>> '{ai,title}', 'outcome', i #>> '{ai,outcome}',
                 'summary', left(coalesce(i #>> '{notice_read,summary}', i #>> '{ai,summary}'), 900))), '[]'::jsonb)
                FROM (SELECT i FROM jsonb_array_elements(public.notice_case_items(p_client_id, c.case_key)) i LIMIT 20) x)
  )
    FROM public.notice_cases c
   WHERE c.client_id = p_client_id AND c.case_key = public.notice_case_root(p_client_id, p_case_key)
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_advice_context(uuid, text) TO anon, authenticated, service_role;

-- Start advising one case (the "Ask again" button, or a claim): returns what to read.
CREATE OR REPLACE FUNCTION public.notice_case_advice_begin(p_client_id uuid, p_case_key text, p_agent text DEFAULT NULL, p_actor text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := public.notice_case_root(p_client_id, p_case_key);
  v_s   public.ai_settings;
  v_ctx jsonb;
BEGIN
  SELECT * INTO v_s FROM public.ai_settings WHERE id;
  IF NOT coalesce(v_s.read_enabled, false) THEN RETURN jsonb_build_object('error', 'off'); END IF;
  v_ctx := public.notice_case_advice_context(p_client_id, v_key);
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  INSERT INTO public.notice_case_advice AS a (client_id, case_key, status, requested_by, requested_at, started_at, agent, updated_at)
  VALUES (p_client_id, v_key, 'running', left(p_actor, 120), CASE WHEN p_actor IS NOT NULL THEN now() END, now(), left(p_agent, 120), now())
  ON CONFLICT (client_id, case_key) DO UPDATE
     SET status = 'running', started_at = now(), agent = left(p_agent, 120), updated_at = now(),
         requested_by = coalesce(left(p_actor, 120), a.requested_by),
         requested_at = CASE WHEN p_actor IS NOT NULL THEN now() ELSE a.requested_at END;
  RETURN jsonb_build_object('client_id', p_client_id, 'case_key', v_key, 'hash', public.notice_case_advice_hash(p_client_id, v_key),
    'context', v_ctx, 'settings', jsonb_build_object('model', v_s.model, 'effort', v_s.assist_effort));
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_advice_begin(uuid, text, text, text) TO anon, authenticated, service_role;

-- The next case to advise: asked for first, then open cases never advised or
-- changed since, overdue first, then due this week, then with something new.
CREATE OR REPLACE FUNCTION public.notice_case_advice_claim(p_agent text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF NOT coalesce((SELECT read_enabled FROM public.ai_settings WHERE id), false) THEN RETURN NULL; END IF;
  FOR r IN
    SELECT c.client_id, c.case_key, a.status, a.inputs_hash, a.finished_at, a.started_at
      FROM public.notice_cases c
      LEFT JOIN public.notice_case_advice a ON a.client_id = c.client_id AND a.case_key = c.case_key
     WHERE c.is_open AND c.track <> 'other'
       AND (a.client_id IS NULL OR a.status = 'queued'
            OR (a.status = 'running' AND a.started_at < now() - interval '10 minutes')
            OR (a.status = 'done')
            OR (a.status = 'failed' AND a.finished_at < now() - interval '6 hours'))
     ORDER BY (a.status = 'queued') DESC NULLS LAST, (a.client_id IS NULL) DESC, c.is_overdue DESC, c.is_due_in_7 DESC,
              (c.new_items > 0) DESC, c.next_due ASC NULLS LAST
     LIMIT 120
  LOOP
    IF r.status IS NULL OR r.status IN ('queued', 'running', 'failed')
       OR r.inputs_hash IS DISTINCT FROM public.notice_case_advice_hash(r.client_id, r.case_key) THEN
      RETURN public.notice_case_advice_begin(r.client_id, r.case_key, p_agent, NULL);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_advice_claim(text) TO service_role;

CREATE OR REPLACE FUNCTION public.notice_case_advice_finish(
  p_client_id uuid, p_case_key text, p_status text, p_advice jsonb, p_hash text,
  p_model text DEFAULT NULL, p_usage jsonb DEFAULT NULL, p_error text DEFAULT NULL, p_reason_class text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.notice_case_advice;
BEGIN
  UPDATE public.notice_case_advice
     SET status = CASE WHEN p_status = 'done' THEN 'done' ELSE 'failed' END,
         advice = CASE WHEN p_status = 'done' THEN p_advice ELSE advice END,
         inputs_hash = CASE WHEN p_status = 'done' THEN p_hash ELSE inputs_hash END,
         finished_at = now(), model = coalesce(p_model, model), usage = p_usage,
         error = left(p_error, 1000), reason_class = left(p_reason_class, 60), updated_at = now()
   WHERE client_id = p_client_id AND case_key = p_case_key
  RETURNING * INTO v_row;
  IF v_row IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  RETURN jsonb_build_object('status', v_row.status, 'advice', v_row.advice, 'finished_at', v_row.finished_at, 'error', v_row.error);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_advice_finish(uuid, text, text, jsonb, text, text, jsonb, text, text) TO service_role;

-- Ask for a case to be advised again (picked first by the next run).
CREATE OR REPLACE FUNCTION public.notice_case_advice_request(p_client_id uuid, p_case_key text, p_actor text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.notice_case_advice AS a (client_id, case_key, status, requested_by, requested_at, updated_at)
  VALUES (p_client_id, public.notice_case_root(p_client_id, p_case_key), 'queued', left(p_actor, 120), now(), now())
  ON CONFLICT (client_id, case_key) DO UPDATE
     SET status = CASE WHEN a.status = 'running' AND a.started_at > now() - interval '10 minutes' THEN a.status ELSE 'queued' END,
         requested_by = left(p_actor, 120), requested_at = now(), updated_at = now()
  RETURNING true
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_advice_request(uuid, text, text) TO anon, authenticated, service_role;

-- pg_cron every five minutes: one run of advise_next while the reader is on.
CREATE OR REPLACE FUNCTION public.notice_case_advice_dispatch()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT coalesce((SELECT read_enabled AND coalesce(runner, 'edge') = 'edge' FROM public.ai_settings WHERE id), false) THEN RETURN false; END IF;
  PERFORM net.http_post(
    url := 'https://gcquafqxbykxkbexcdpy.supabase.co/functions/v1/notice-ai',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'gst_cron_anon_key')),
    body := '{"action":"advise_next"}'::jsonb,
    timeout_milliseconds := 15000);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.notice_case_advice_dispatch() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.schedule('notice-ai-advise', '1-59/5 * * * *', 'SELECT public.notice_case_advice_dispatch()');
EXCEPTION WHEN undefined_function OR invalid_schema_name THEN
  RAISE NOTICE 'pg_cron is not available: schedule notice-ai-advise by hand';
END $$;
