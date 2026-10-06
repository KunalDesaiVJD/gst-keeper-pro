-- Notices Phase 4 · Reply Factory I, part 3: evidence annexures
-- (roadmap Phase 4 "Evidence recipes"; audit R-10, R-23). Read
-- docs/REPLY_FACTORY_POSITIONS.md before changing anything here.
--
-- The recipes are code in the app (src/lib/reply/recipes): deterministic,
-- FY-wide wrappers over the month-scoped reports, reading only the portal
-- figures the extension pulled (never the app's own GSTR-1 / GSTR-3B drafts).
-- Each run is saved here as a version: what it computed (summary), the
-- annexure tables with each row's source (table, period, ARN, when pulled),
-- the data it needed and what was missing (readiness). A run with the same
-- inputs saves nothing new; a run with different inputs becomes the next
-- version. Missing portal data is queued on the office agent through the
-- existing autopilot_enqueue (origin 'evidence') when the autopilot is on.

CREATE TABLE IF NOT EXISTS public.reply_annexures (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id         uuid NOT NULL REFERENCES public.gst_notices(id) ON DELETE CASCADE,
  client_id         uuid NOT NULL,
  issue_id          uuid REFERENCES public.notice_issues(id) ON DELETE SET NULL,
  recipe_key        text NOT NULL,
  version           int  NOT NULL CHECK (version >= 1),
  is_current        boolean NOT NULL DEFAULT true,
  status            text NOT NULL CHECK (status IN ('ready', 'partial', 'needs_data', 'not_applicable', 'failed')),
  title             text,
  periods           text[] NOT NULL DEFAULT '{}',
  financial_year    text,
  summary           jsonb,
  tables            jsonb,
  readiness         jsonb,
  inputs_hash       text,
  explained_amount  numeric,
  to_pay_amount     numeric,
  generated_by_name text,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  note              text
);
COMMENT ON TABLE public.reply_annexures IS
  'Evidence for a notice, one version per recipe run with different inputs: summary, annexure tables (rows carry their source: table, period, ARN, pulled_at) and readiness (data needed and missing). generated_by_name ''Auto'' when the app built it without a click.';
CREATE UNIQUE INDEX IF NOT EXISTS uq_reply_annexures_version
  ON public.reply_annexures (notice_id, recipe_key, coalesce(issue_id, '00000000-0000-0000-0000-000000000000'::uuid), version);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reply_annexures_current
  ON public.reply_annexures (notice_id, recipe_key, coalesce(issue_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_reply_annexures_notice ON public.reply_annexures (notice_id, generated_at DESC);
ALTER TABLE public.reply_annexures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reply_annexures_all ON public.reply_annexures;
CREATE POLICY reply_annexures_all ON public.reply_annexures FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reply_annexures TO anon, authenticated, service_role;

-- Which explained amount came from a recipe (so a later run may update it)
-- and which a person typed (never replaced).
ALTER TABLE public.notice_issues ADD COLUMN IF NOT EXISTS explained_by uuid;
COMMENT ON COLUMN public.notice_issues.explained_by IS
  'The reply_annexures row that set explained_amount; NULL when staff typed it (a recipe then leaves it alone).';

-- Save a run: unchanged inputs and status → nothing new; otherwise the next version.
CREATE OR REPLACE FUNCTION public.reply_annexure_save(
  p_notice_id uuid, p_issue_id uuid, p_recipe_key text, p_status text, p_title text,
  p_periods text[], p_financial_year text, p_summary jsonb, p_tables jsonb, p_readiness jsonb,
  p_inputs_hash text, p_explained numeric DEFAULT NULL, p_to_pay numeric DEFAULT NULL,
  p_actor_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client uuid;
  v_cur    public.reply_annexures;
  v_ver    int;
  v_id     uuid;
  v_issue  public.notice_issues;
  nil      constant uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('ready', 'partial', 'needs_data', 'not_applicable', 'failed') THEN
    RAISE EXCEPTION 'reply_annexure_save: unknown status %', p_status USING ERRCODE = '22023';
  END IF;
  SELECT g.client_id INTO v_client FROM public.gst_notices g WHERE g.id = p_notice_id;
  IF v_client IS NULL THEN RETURN jsonb_build_object('error', 'gone'); END IF;

  SELECT * INTO v_cur FROM public.reply_annexures a
   WHERE a.notice_id = p_notice_id AND a.recipe_key = p_recipe_key
     AND coalesce(a.issue_id, nil) = coalesce(p_issue_id, nil) AND a.is_current
   FOR UPDATE;
  IF v_cur.id IS NOT NULL AND v_cur.inputs_hash IS NOT DISTINCT FROM p_inputs_hash AND v_cur.status = p_status THEN
    RETURN jsonb_build_object('id', v_cur.id, 'version', v_cur.version, 'unchanged', true);
  END IF;

  SELECT coalesce(max(a.version), 0) + 1 INTO v_ver FROM public.reply_annexures a
   WHERE a.notice_id = p_notice_id AND a.recipe_key = p_recipe_key AND coalesce(a.issue_id, nil) = coalesce(p_issue_id, nil);
  UPDATE public.reply_annexures SET is_current = false WHERE id = v_cur.id;
  INSERT INTO public.reply_annexures (notice_id, client_id, issue_id, recipe_key, version, status, title, periods,
                                      financial_year, summary, tables, readiness, inputs_hash, explained_amount,
                                      to_pay_amount, generated_by_name)
  VALUES (p_notice_id, v_client, p_issue_id, p_recipe_key, v_ver, p_status, p_title, coalesce(p_periods, '{}'),
          p_financial_year, p_summary, p_tables, p_readiness, p_inputs_hash, p_explained, p_to_pay,
          coalesce(nullif(btrim(p_actor_name), ''), 'Auto'))
  RETURNING id INTO v_id;

  -- The issue's explained amount follows the recipe unless a person typed it.
  IF p_issue_id IS NOT NULL AND p_status IN ('ready', 'partial') AND p_explained IS NOT NULL THEN
    SELECT * INTO v_issue FROM public.notice_issues WHERE id = p_issue_id AND notice_id = p_notice_id FOR UPDATE;
    IF v_issue.id IS NOT NULL AND (v_issue.explained_by IS NOT NULL OR v_issue.explained_amount = 0) AND v_issue.amount > 0 THEN
      UPDATE public.notice_issues
         SET explained_amount = least(greatest(p_explained, 0), amount), explained_by = v_id
       WHERE id = p_issue_id;
    END IF;
  END IF;

  IF p_status IN ('ready', 'partial') THEN
    PERFORM public.notice_log_event(p_notice_id, 'evidence_built', NULL,
      jsonb_build_object('recipe', p_recipe_key, 'version', v_ver, 'status', p_status,
                         'explained', p_explained, 'to_pay', p_to_pay, 'annexure_id', v_id),
      NULL, coalesce(nullif(btrim(p_actor_name), ''), 'Evidence builder'));
  END IF;
  RETURN jsonb_build_object('id', v_id, 'version', v_ver, 'unchanged', false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.reply_annexure_save(uuid, uuid, text, text, text, text[], text, jsonb, jsonb, jsonb, text, numeric, numeric, text)
  TO anon, authenticated, service_role;

-- ── Evidence nobody has built yet ──────────────────────────────────────────
-- Open notices of the forms the acceptance counts (ASMT-10, DRC-01A, DRC-01B,
-- DRC-01C) with no current annexure at all, the soonest due first: what the
-- app builds in the background when staff open the notices module (saved as
-- Auto; docs/REPLY_FACTORY_POSITIONS.md §6). A notice built once, even to
-- "needs data", is left to the Evidence tab and "Build evidence for all".
CREATE OR REPLACE FUNCTION public.reply_evidence_pending(p_limit int DEFAULT 20)
RETURNS TABLE (notice_id uuid, client_id uuid, form_code text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.id, g.client_id, g.form_code
    FROM public.gst_notices g
   WHERE g.deleted_at IS NULL AND g.source = 'notices' AND NOT public.notice_is_closed(g.staff_status)
     AND g.form_code IN ('ASMT-10', 'DRC-01A', 'DRC-01B', 'DRC-01C')
     AND NOT EXISTS (SELECT 1 FROM public.reply_annexures a WHERE a.notice_id = g.id AND a.is_current)
   ORDER BY coalesce(g.extended_due_date, g.due_date) NULLS LAST, g.issue_date DESC NULLS LAST, g.id
   LIMIT greatest(coalesce(p_limit, 20), 0)
$$;
GRANT EXECUTE ON FUNCTION public.reply_evidence_pending(int) TO anon, authenticated, service_role;
