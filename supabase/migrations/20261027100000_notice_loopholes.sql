-- Notices & Litigation, the law audit of 26 October 2026: the loopholes P2 to
-- P6 that need no extension change (P3's due date and P5, P6 on the timeline
-- are in 20261026110000 and 20261026120000). Additive. §35 of
-- docs/NOTICES_LITIGATION_POSITIONS.md.

-- ── P2. A case or notice is hidden only through its door ───────────────────
-- gst_notices is open to the public key (no Supabase session, CLAUDE.md), so
-- any write could set excluded_at and take a case out of every list. The
-- doors notice_case_exclude and notice_exclude, which check the level, set a
-- transaction flag; any other change to the exclusion columns is refused.
-- The person is still named by the browser: the lasting fix is a signed
-- session (§35).
CREATE OR REPLACE FUNCTION public.gst_notices_exclusion_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (NEW.excluded_at IS DISTINCT FROM OLD.excluded_at
      OR NEW.excluded_reason IS DISTINCT FROM OLD.excluded_reason
      OR NEW.excluded_scope IS DISTINCT FROM OLD.excluded_scope
      OR NEW.excluded_by_name IS DISTINCT FROM OLD.excluded_by_name)
     AND coalesce(current_setting('gst.notice_exclusion_door', true), '') <> 'on' THEN
    RAISE EXCEPTION 'A case or notice is hidden or brought back only by a GST Manager or the superadmin, from its page.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_gst_notices_exclusion_guard') THEN
    CREATE TRIGGER trg_gst_notices_exclusion_guard BEFORE UPDATE ON public.gst_notices
      FOR EACH ROW EXECUTE FUNCTION public.gst_notices_exclusion_guard();
  END IF;
END $$;

-- The two doors, as 20261014110000, now opening the guard for their own update.
CREATE OR REPLACE FUNCTION public.notice_case_exclude(p_client_id uuid, p_case_key text, p_exclude boolean,
                                                      p_reason text, p_actor_id uuid, p_actor_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n int;
BEGIN
  IF NOT public.notice_case_admin(p_actor_id) THEN RETURN jsonb_build_object('error', 'Only a superadmin or GST manager can do this.'); END IF;
  PERFORM set_config('gst.notice_exclusion_door', 'on', true);
  UPDATE public.gst_notices g
     SET excluded_at = CASE WHEN p_exclude THEN now() END,
         excluded_by_name = CASE WHEN p_exclude THEN left(p_actor_name, 120) END,
         excluded_reason = CASE WHEN p_exclude THEN left(coalesce(nullif(btrim(p_reason), ''), 'Handled by another CA'), 300) END,
         excluded_scope = CASE WHEN p_exclude THEN 'case' END,
         edited_by_id = p_actor_id, edited_by_name = left(p_actor_name, 120), edited_at = now()
   WHERE g.id IN (SELECT public.notice_case_notice_ids(p_client_id, p_case_key));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('gst.notice_exclusion_door', 'off', true);
  RETURN jsonb_build_object('notices', v_n);
END;
$$;

CREATE OR REPLACE FUNCTION public.notice_exclude(p_notice_id uuid, p_exclude boolean, p_reason text, p_actor_id uuid, p_actor_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n int;
BEGIN
  IF NOT public.notice_case_admin(p_actor_id) THEN RETURN jsonb_build_object('error', 'Only a superadmin or GST manager can do this.'); END IF;
  PERFORM set_config('gst.notice_exclusion_door', 'on', true);
  UPDATE public.gst_notices
     SET excluded_at = CASE WHEN p_exclude THEN now() END,
         excluded_by_name = CASE WHEN p_exclude THEN left(p_actor_name, 120) END,
         excluded_reason = CASE WHEN p_exclude THEN left(coalesce(nullif(btrim(p_reason), ''), 'Not required'), 300) END,
         excluded_scope = CASE WHEN p_exclude THEN 'notice' END,
         edited_by_id = p_actor_id, edited_by_name = left(p_actor_name, 120), edited_at = now()
   WHERE id = p_notice_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('gst.notice_exclusion_door', 'off', true);
  RETURN jsonb_build_object('notices', v_n);
END;
$$;

-- ── P3. Demands with no work recorded ──────────────────────────────────────
-- An open demand at New after its date has passed, above an amount the firm
-- sets: shown to partners on Notices Home every day (no e-mail: the alert
-- engine stays as the firm left it).
INSERT INTO public.litigation_rules (key, value, unit, effective_from, note) VALUES
  ('escalate_demand_rs', 500000, 'rupees', NULL, 'An open demand at New past its date, of at least this amount, is raised to the partners on Notices Home (P3 of the law audit)')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.notice_stale_demands()
RETURNS TABLE(id uuid, client_id uuid, client_name text, form_code text, reference_number text, case_id text,
              financial_year text, amount_of_demand numeric, effective_due date, days_overdue int, due_basis text, due_basis_note text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.client_id, f.client_name, f.form_code, f.reference_number, f.case_id, f.financial_year,
         f.amount_of_demand, f.effective_due, (public.ist_today() - f.effective_due)::int, f.due_basis, f.due_basis_note
    FROM public.notice_facts f
   WHERE f.is_open AND NOT f.is_replied AND f.stage = 'new'
     AND f.effective_due < public.ist_today()
     AND coalesce(f.amount_of_demand, 0) >= coalesce(public.litigation_rule_value('escalate_demand_rs'), 500000)
     AND f.response_need <> 'none'
   ORDER BY f.amount_of_demand DESC NULLS LAST, f.effective_due
$$;
GRANT EXECUTE ON FUNCTION public.notice_stale_demands() TO anon, authenticated, service_role;

-- ── P4. Papers the assistant could not read ────────────────────────────────
-- A scan that needs vision, a file that is not a PDF, or one too long to read
-- whole: drafts and advice are built without them, so each is named.
CREATE OR REPLACE FUNCTION public.notice_case_unread_papers(p_client_id uuid, p_case_key text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', d.id, 'label', coalesce(d.title, d.label, d.source_ref), 'date', d.doc_date, 'url', d.url,
           'why', CASE d.reason_class WHEN 'needs_vision' THEN 'a scan, which needs the page images read'
                                      WHEN 'not_pdf' THEN 'not a PDF'
                                      WHEN 'too_long' THEN 'too long to read whole'
                                      ELSE coalesce(d.reason_class, d.status) END))
           ORDER BY d.sort_date DESC NULLS LAST), '[]'::jsonb)
    FROM public.ai_documents d
   WHERE d.client_id = p_client_id
     AND ((d.status = 'failed' AND d.reason_class IN ('needs_vision', 'not_pdf')) OR (d.status = 'skipped' AND d.reason_class = 'too_long'))
     AND d.case_id IS NOT NULL
     AND public.notice_case_root(d.client_id, d.case_id) = public.notice_case_root(p_client_id, p_case_key)
$$;
GRANT EXECUTE ON FUNCTION public.notice_case_unread_papers(uuid, text) TO anon, authenticated, service_role;
