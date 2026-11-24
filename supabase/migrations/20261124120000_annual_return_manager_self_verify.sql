-- Annual Return sign-off: a GST manager / the superadmin may verify their own
-- preparation, with a reason (the firm, 24 Nov 2026).
--
-- Until now whoever marked a working prepared (or was allotted to prepare it)
-- could never verify it. The firm keeps that for employee-level staff, but a
-- GST manager or the superadmin who prepared a working may now verify it too,
-- with a reason of at least 5 characters (stored as the verification note,
-- logged "Verified own preparation (GST manager)" with self_verified = true).
-- Review & lock is unchanged: set_annual_return_status still refuses a
-- reviewer who prepared or verified it, so a third person still signs.
-- Replaces annual_return_signoff of 20261124100000 with only the verify
-- check changed. Idempotent: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.annual_return_signoff(
  p_client_id uuid,
  p_financial_year text,
  p_action text,
  p_expected_rev integer,
  p_actor_id uuid,
  p_note text DEFAULT NULL,
  p_return_to text DEFAULT NULL,
  p_changes_ack integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor record;
  v_p public.annual_return_periods%ROWTYPE;
  v_sheets integer;
  v_stage text;
  v_new_stage text;
  v_mgr boolean;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_unacked integer;
  v_action text;
  v_path text;
  v_now timestamptz;
  v_self boolean := false;
BEGIN
  IF p_action NOT IN ('prepare', 'withdraw_prepared', 'verify', 'withdraw_verified', 'send_back') THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_BAD_ACTION: unknown action %', p_action USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_actor FROM public.annual_return_actor(p_actor_id);
  IF v_actor.role IS NULL THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: only staff can sign off a working.' USING ERRCODE = 'P0001';
  END IF;
  v_mgr := v_actor.role IN ('superadmin', 'gst_manager');

  INSERT INTO public.annual_return_periods (client_id, financial_year, status)
  VALUES (p_client_id, p_financial_year, 'not_started')
  ON CONFLICT (client_id, financial_year) DO NOTHING;
  SELECT * INTO v_p FROM public.annual_return_periods
   WHERE client_id = p_client_id AND financial_year = p_financial_year
   FOR UPDATE;
  -- Held now: a save in flight has committed (and is counted below); a later one waits for this.
  v_now := clock_timestamp();
  SELECT count(*)::int INTO v_sheets FROM public.annual_return_docs
   WHERE client_id = p_client_id AND financial_year = p_financial_year;
  v_stage := public.annual_return_stage(v_p.status, v_p.returned_at, v_p.verified_at, v_p.prepared_at, v_sheets);

  IF v_p.signoff_rev IS DISTINCT FROM p_expected_rev THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_SIGNOFF_STALE: %', v_stage USING ERRCODE = 'P0001';
  END IF;
  IF v_p.status = 'locked' THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_LOCKED: FY % is locked for this client.', p_financial_year USING ERRCODE = 'P0001';
  END IF;

  IF p_action = 'prepare' THEN
    IF v_p.verified_at IS NOT NULL THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: it is verified — withdraw the verification first.' USING ERRCODE = 'P0001';
    END IF;
    IF v_sheets = 0 THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: nothing has been saved in the working yet.' USING ERRCODE = 'P0001';
    END IF;
    IF p_actor_id IN (v_p.verifier_id, v_p.reviewer_id) THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: you are allotted to % this — someone else must prepare it.',
        CASE WHEN p_actor_id = v_p.verifier_id THEN 'verify' ELSE 'review' END USING ERRCODE = 'P0001';
    END IF;
    -- Anyone on the GST team may mark it prepared, also for the allotted preparer
    -- (logged "Marked prepared for <preparer>"); the allotment stays as it was.
    v_action := CASE
      WHEN v_p.preparer_id IS NOT NULL AND v_p.preparer_id <> p_actor_id THEN 'Marked prepared for ' || v_p.preparer_name
      WHEN v_p.prepared_at IS NOT NULL THEN 'Marked prepared again'
      ELSE 'Marked prepared' END;
    UPDATE public.annual_return_periods
       SET status = CASE WHEN status = 'not_started' THEN 'in_progress' ELSE status END,
           prepared_by = p_actor_id, prepared_by_name = v_actor.name, prepared_at = v_now, prepared_note = v_note,
           preparer_id = COALESCE(preparer_id, p_actor_id),
           preparer_name = CASE WHEN preparer_id IS NULL THEN v_actor.name ELSE preparer_name END,
           preparer_allotted_at = COALESCE(preparer_allotted_at, v_now),
           returned_to = CASE WHEN returned_to = 'preparer' THEN NULL ELSE returned_to END,
           returned_by_name = CASE WHEN returned_to = 'preparer' THEN NULL ELSE returned_by_name END,
           returned_at = CASE WHEN returned_to = 'preparer' THEN NULL ELSE returned_at END,
           returned_note = CASE WHEN returned_to = 'preparer' THEN NULL ELSE returned_note END,
           signoff_rev = signoff_rev + 1, updated_at = now()
     WHERE id = v_p.id;
    v_path := 'prepared';

  ELSIF p_action = 'withdraw_prepared' THEN
    IF v_p.prepared_at IS NULL THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: it is not marked prepared.' USING ERRCODE = 'P0001';
    END IF;
    IF v_p.verified_at IS NOT NULL THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: it is verified — withdraw the verification first.' USING ERRCODE = 'P0001';
    END IF;
    IF v_p.prepared_by IS DISTINCT FROM p_actor_id AND NOT v_mgr THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: only % (who marked it prepared) or a GST manager can withdraw it.', v_p.prepared_by_name USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.annual_return_periods
       SET prepared_by = NULL, prepared_by_name = NULL, prepared_at = NULL, prepared_note = NULL,
           returned_to = NULL, returned_by_name = NULL, returned_at = NULL, returned_note = NULL,
           signoff_rev = signoff_rev + 1, updated_at = now()
     WHERE id = v_p.id;
    v_action := 'Withdrew prepared';
    v_path := 'prepared';

  ELSIF p_action = 'verify' THEN
    IF v_p.prepared_at IS NULL THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: it has to be prepared first.' USING ERRCODE = 'P0001';
    END IF;
    IF v_p.verified_at IS NOT NULL THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: it is already verified.' USING ERRCODE = 'P0001';
    END IF;
    IF p_actor_id = v_p.reviewer_id THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: you are allotted to review it — someone else must verify it.' USING ERRCODE = 'P0001';
    END IF;
    v_self := COALESCE(p_actor_id IN (v_p.prepared_by, v_p.preparer_id), false);
    IF v_self AND NOT v_mgr THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: % — someone else must verify it.',
        CASE WHEN p_actor_id = v_p.prepared_by THEN 'you prepared it' ELSE 'you are allotted to prepare it' END USING ERRCODE = 'P0001';
    END IF;
    -- A GST manager / the superadmin may verify their own preparation, with a reason.
    IF v_self AND (v_note IS NULL OR length(v_note) < 5) THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOTE_REQUIRED: you prepared it — give a reason for verifying it yourself.' USING ERRCODE = 'P0001';
    END IF;
    IF v_p.verifier_id IS DISTINCT FROM p_actor_id AND NOT v_mgr THEN
      IF v_p.verifier_id IS NULL THEN
        RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: no verifier is allotted — a GST manager or the superadmin verifies it, or allots a verifier.' USING ERRCODE = 'P0001';
      END IF;
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: allotted to % to verify.', v_p.verifier_name USING ERRCODE = 'P0001';
    END IF;
    v_unacked := public.annual_return_figure_changes(p_client_id, p_financial_year, v_p.prepared_at, v_actor.name);
    IF v_unacked > COALESCE(p_changes_ack, 0) THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_CHANGED_SINCE: %', v_unacked USING ERRCODE = 'P0001';
    END IF;
    v_action := CASE
      WHEN v_self THEN 'Verified own preparation (' || CASE WHEN v_actor.role = 'superadmin' THEN 'superadmin' ELSE 'GST manager' END || ')'
      WHEN v_p.verifier_id IS NOT NULL AND v_p.verifier_id <> p_actor_id THEN 'Verified for ' || v_p.verifier_name
      ELSE 'Verified' END
      || CASE WHEN v_unacked > 0 THEN ' after checking ' || v_unacked || ' change' || CASE WHEN v_unacked = 1 THEN '' ELSE 's' END || ' since prepared' ELSE '' END;
    UPDATE public.annual_return_periods
       SET verified_by = p_actor_id, verified_by_name = v_actor.name, verified_role = v_actor.role,
           verified_at = v_now, verified_note = v_note, changes_at_verify = v_unacked,
           verifier_id = COALESCE(verifier_id, p_actor_id),
           verifier_name = CASE WHEN verifier_id IS NULL THEN v_actor.name ELSE verifier_name END,
           returned_to = CASE WHEN returned_to = 'verifier' THEN NULL ELSE returned_to END,
           returned_by_name = CASE WHEN returned_to = 'verifier' THEN NULL ELSE returned_by_name END,
           returned_at = CASE WHEN returned_to = 'verifier' THEN NULL ELSE returned_at END,
           returned_note = CASE WHEN returned_to = 'verifier' THEN NULL ELSE returned_note END,
           signoff_rev = signoff_rev + 1, updated_at = now()
     WHERE id = v_p.id;
    v_path := 'verified';

  ELSIF p_action = 'withdraw_verified' THEN
    IF v_p.verified_at IS NULL THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: it is not verified.' USING ERRCODE = 'P0001';
    END IF;
    IF v_p.verified_by IS DISTINCT FROM p_actor_id AND NOT v_mgr THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: only % (who verified it) or a GST manager can withdraw the verification.', v_p.verified_by_name USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.annual_return_periods
       SET verified_by = NULL, verified_by_name = NULL, verified_role = NULL, verified_at = NULL,
           verified_note = NULL, changes_at_verify = NULL,
           signoff_rev = signoff_rev + 1, updated_at = now()
     WHERE id = v_p.id;
    v_action := 'Withdrew verification';
    v_path := 'verified';

  ELSE -- send_back
    IF v_note IS NULL OR length(v_note) < 5 THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOTE_REQUIRED: say what needs fixing.' USING ERRCODE = 'P0001';
    END IF;
    IF v_p.prepared_at IS NULL THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: it is not prepared yet, so there is nothing to send back.' USING ERRCODE = 'P0001';
    END IF;
    IF v_p.verified_at IS NULL THEN
      -- At Prepared: whoever may verify sends it back to the preparer.
      IF COALESCE(p_return_to, 'preparer') <> 'preparer' THEN
        RAISE EXCEPTION 'ANNUAL_RETURN_BAD_ACTION: it is not verified, so it can only go back to the preparer.' USING ERRCODE = 'P0001';
      END IF;
      IF NOT v_mgr AND v_p.verifier_id IS DISTINCT FROM p_actor_id THEN
        RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: only the verifier or a GST manager can send it back.' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      -- At Verified: whoever may review sends it back to the verifier or the preparer.
      IF COALESCE(p_return_to, '') NOT IN ('preparer', 'verifier') THEN
        RAISE EXCEPTION 'ANNUAL_RETURN_BAD_ACTION: send it back to the preparer or the verifier.' USING ERRCODE = 'P0001';
      END IF;
      IF NOT v_mgr THEN
        RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: only a GST manager or the superadmin can send back a verified working.' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    UPDATE public.annual_return_periods
       SET prepared_by = CASE WHEN COALESCE(p_return_to, 'preparer') = 'preparer' THEN NULL ELSE prepared_by END,
           prepared_by_name = CASE WHEN COALESCE(p_return_to, 'preparer') = 'preparer' THEN NULL ELSE prepared_by_name END,
           prepared_at = CASE WHEN COALESCE(p_return_to, 'preparer') = 'preparer' THEN NULL ELSE prepared_at END,
           prepared_note = CASE WHEN COALESCE(p_return_to, 'preparer') = 'preparer' THEN NULL ELSE prepared_note END,
           verified_by = NULL, verified_by_name = NULL, verified_role = NULL, verified_at = NULL,
           verified_note = NULL, changes_at_verify = NULL,
           returned_to = COALESCE(p_return_to, 'preparer'), returned_by_name = v_actor.name,
           returned_at = v_now, returned_note = v_note,
           signoff_rev = signoff_rev + 1, updated_at = now()
     WHERE id = v_p.id;
    v_action := CASE WHEN COALESCE(p_return_to, 'preparer') = 'preparer'
                     THEN 'Sent back to the preparer' || COALESCE(' (' || COALESCE(v_p.preparer_name, v_p.prepared_by_name) || ')', '')
                     ELSE 'Sent back to the verifier' || COALESCE(' (' || COALESCE(v_p.verifier_name, v_p.verified_by_name) || ')', '') END;
    v_path := 'returned';
  END IF;

  SELECT * INTO v_p FROM public.annual_return_periods WHERE client_id = p_client_id AND financial_year = p_financial_year;
  v_new_stage := public.annual_return_stage(v_p.status, v_p.returned_at, v_p.verified_at, v_p.prepared_at, v_sheets);
  INSERT INTO public.annual_return_change_log
    (client_id, financial_year, doc_key, path, kind, old_value, new_value, action, changed_by)
  VALUES
    (p_client_id, p_financial_year, 'period', ARRAY[v_path], 'status', to_jsonb(v_stage),
     jsonb_strip_nulls(jsonb_build_object('stage', v_new_stage, 'role', v_actor.role, 'note', v_note,
       'return_to', CASE WHEN p_action = 'send_back' THEN COALESCE(p_return_to, 'preparer') END,
       'changes', CASE WHEN p_action = 'verify' AND v_unacked > 0 THEN v_unacked END,
       'self_verified', CASE WHEN v_self THEN true END)),
     v_action, v_actor.name);

  RETURN public.annual_return_signoff_row(p_client_id, p_financial_year);
END;
$$;

GRANT EXECUTE ON FUNCTION public.annual_return_signoff(uuid, text, text, integer, uuid, text, text, integer) TO anon, authenticated;
