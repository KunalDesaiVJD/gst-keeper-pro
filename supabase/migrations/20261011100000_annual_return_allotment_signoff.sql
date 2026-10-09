-- Annual Return (GSTR-9 / GSTR-9C): allotment and the three-stage sign-off.
--
-- Each client's working for a year is allotted (a preparer, and optionally a
-- verifier and a reviewer) and signed off in three stages by three different
-- people:
--   Prepared            — the preparer (or a GST manager / superadmin for them);
--   Verified            — the verifier (or a GST manager / superadmin);
--   Reviewed & locked   — a GST manager or the superadmin. The lock keeps the
--                         status value 'locked', so the doc guard trigger
--                         (annual_return_docs_guard) is untouched.
-- The stage is derived, never stored: locked > sent back > verified > prepared
-- > preparing (a sheet saved, or status in_progress) > not started.
--
-- Who is acting is looked up here from profiles / user_roles / user_permissions
-- by the user id the app sends (p_actor_id) — the browser no longer declares
-- its own role or name. There is no Supabase auth session in this app, so this
-- stops mistakes, not a determined insider (docs/GSTR9_9C_WORKINGS.md §6.20).
--
-- Every sign-off carries the signoff_rev the user was looking at: a click made
-- on a stale view is refused (ANNUAL_RETURN_SIGNOFF_STALE), never applied.
-- Verification and the lock also carry how many figure changes the signer was
-- shown and acknowledged since the previous stamp; more than that is refused
-- (ANNUAL_RETURN_CHANGED_SINCE). Changes are change-log rows on the sheets —
-- not the status rows, payables or reasons for differences — made by anyone
-- but the signer.
--
-- Replaces set_annual_return_status (new signature) and mark_annual_return_prepared.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.annual_return_periods
  ADD COLUMN IF NOT EXISTS preparer_id uuid,
  ADD COLUMN IF NOT EXISTS preparer_name text,
  ADD COLUMN IF NOT EXISTS preparer_allotted_at timestamptz,
  ADD COLUMN IF NOT EXISTS verifier_id uuid,
  ADD COLUMN IF NOT EXISTS verifier_name text,
  ADD COLUMN IF NOT EXISTS reviewer_id uuid,
  ADD COLUMN IF NOT EXISTS reviewer_name text,
  ADD COLUMN IF NOT EXISTS allotted_at timestamptz,
  ADD COLUMN IF NOT EXISTS allotted_by_name text,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verified_by_name text,
  ADD COLUMN IF NOT EXISTS verified_role text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_note text,
  ADD COLUMN IF NOT EXISTS changes_at_verify integer,
  ADD COLUMN IF NOT EXISTS changes_at_lock integer,
  ADD COLUMN IF NOT EXISTS returned_to text,
  ADD COLUMN IF NOT EXISTS returned_by_name text,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_note text,
  ADD COLUMN IF NOT EXISTS signoff_overrides jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS signoff_rev integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.annual_return_periods.prepared_by IS 'Who marked the working prepared (profiles.user_id).';
COMMENT ON COLUMN public.annual_return_periods.reviewed_by IS 'Who reviewed and locked the year (profiles.user_id).';
COMMENT ON COLUMN public.annual_return_periods.preparer_id IS 'Allotted preparer (profiles.user_id); preparer_name is their name at allotment.';
COMMENT ON COLUMN public.annual_return_periods.verifier_id IS 'Allotted verifier; NULL = any GST manager or the superadmin.';
COMMENT ON COLUMN public.annual_return_periods.reviewer_id IS 'Allotted reviewer (a GST manager or the superadmin); NULL = any of them.';
COMMENT ON COLUMN public.annual_return_periods.signoff_rev IS 'Bumped by every sign-off change; a sign-off sent with an older value is refused.';
COMMENT ON COLUMN public.annual_return_periods.signoff_overrides IS 'Superadmin overrides recorded at the lock: [{kind, by, at, reason}]. Cleared on unlock (the log keeps them).';

ALTER TABLE public.annual_return_periods DROP CONSTRAINT IF EXISTS annual_return_periods_returned_to_chk;
ALTER TABLE public.annual_return_periods
  ADD CONSTRAINT annual_return_periods_returned_to_chk CHECK (returned_to IS NULL OR returned_to IN ('preparer', 'verifier'));
ALTER TABLE public.annual_return_periods DROP CONSTRAINT IF EXISTS annual_return_periods_verify_needs_prepare;
ALTER TABLE public.annual_return_periods
  ADD CONSTRAINT annual_return_periods_verify_needs_prepare CHECK (verified_at IS NULL OR prepared_at IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- Who a user is: name, highest staff role, and whether they may unlock.
-- No row = not staff (a client login, a removed user, a made-up id).
CREATE OR REPLACE FUNCTION public.annual_return_actor(p_user_id uuid)
RETURNS TABLE (name text, role text, can_unlock boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH r AS (
    SELECT ur.role::text AS role
      FROM public.user_roles ur
     WHERE ur.user_id = p_user_id AND ur.role::text IN ('superadmin', 'gst_manager', 'employee')
     ORDER BY CASE ur.role::text WHEN 'superadmin' THEN 1 WHEN 'gst_manager' THEN 2 ELSE 3 END
     LIMIT 1
  )
  SELECT COALESCE(NULLIF(btrim(p.first_name), ''), split_part(p.email, '@', 1)),
         r.role,
         r.role IN ('superadmin', 'gst_manager')
           OR EXISTS (SELECT 1 FROM public.user_permissions up WHERE up.user_id = p_user_id AND up.permission_key = 'unlock_sheets')
    FROM r
    JOIN public.profiles p ON p.user_id = p_user_id
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.annual_return_stage(
  p_status text, p_returned_at timestamptz, p_verified_at timestamptz, p_prepared_at timestamptz, p_sheets integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_status = 'locked' THEN 'locked'
    WHEN p_returned_at IS NOT NULL THEN 'sent_back'
    WHEN p_verified_at IS NOT NULL THEN 'verified'
    WHEN p_prepared_at IS NOT NULL THEN 'prepared'
    WHEN p_status = 'in_progress' OR COALESCE(p_sheets, 0) > 0 THEN 'preparing'
    ELSE 'not_started'
  END;
$$;

-- Figure changes on the sheets since a moment, optionally not counting one
-- person's own. Status rows, payables and reasons for differences do not count.
CREATE OR REPLACE FUNCTION public.annual_return_figure_changes(
  p_client_id uuid, p_financial_year text, p_since timestamptz, p_exclude_by text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
    FROM public.annual_return_change_log l
   WHERE l.client_id = p_client_id
     AND l.financial_year = p_financial_year
     AND p_since IS NOT NULL
     AND l.changed_at > p_since
     AND l.kind IN ('edit', 'add', 'remove')
     AND l.doc_key NOT IN ('period', 'payables', 'justifications')
     AND (p_exclude_by IS NULL OR l.changed_by IS DISTINCT FROM p_exclude_by);
$$;

-- Changes since the latest sign-off of every open (prepared, not locked)
-- working: the register's "changed since prepared / verified" flag.
CREATE OR REPLACE VIEW public.annual_return_signoff_changes
WITH (security_invoker = true) AS
SELECT p.client_id,
       p.financial_year,
       c.since_prepared,
       c.since_verified,
       c.last_change_at,
       c.last_change_by
  FROM public.annual_return_periods p
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS since_prepared,
           (count(*) FILTER (WHERE p.verified_at IS NOT NULL AND l.changed_at > p.verified_at))::int AS since_verified,
           max(l.changed_at) AS last_change_at,
           (array_agg(l.changed_by ORDER BY l.changed_at DESC))[1] AS last_change_by
      FROM public.annual_return_change_log l
     WHERE l.client_id = p.client_id
       AND l.financial_year = p.financial_year
       AND l.changed_at > p.prepared_at
       AND l.kind IN ('edit', 'add', 'remove')
       AND l.doc_key NOT IN ('period', 'payables', 'justifications')
  ) c
 WHERE p.prepared_at IS NOT NULL AND p.status <> 'locked';

GRANT SELECT ON public.annual_return_signoff_changes TO anon, authenticated;

-- The period row as the app reads it (without the payables snapshot), with
-- the number of sheets, the stage and the changes since sign-off.
CREATE OR REPLACE FUNCTION public.annual_return_signoff_row(p_client_id uuid, p_financial_year text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (to_jsonb(p) - 'payables_at_lock')
         || jsonb_build_object(
              'sheets', s.n,
              'last_saved_at', s.last_saved_at,
              'stage', public.annual_return_stage(p.status, p.returned_at, p.verified_at, p.prepared_at, s.n),
              'changes', (SELECT to_jsonb(c) - 'client_id' - 'financial_year'
                            FROM public.annual_return_signoff_changes c
                           WHERE c.client_id = p.client_id AND c.financial_year = p.financial_year))
    FROM public.annual_return_periods p
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS n, max(d.updated_at) AS last_saved_at
        FROM public.annual_return_docs d
       WHERE d.client_id = p.client_id AND d.financial_year = p.financial_year
    ) s
   WHERE p.client_id = p_client_id AND p.financial_year = p_financial_year;
$$;

GRANT EXECUTE ON FUNCTION public.annual_return_signoff_row(uuid, text) TO anon, authenticated;

-- How many changes by others since the latest stamp the signer has to check:
-- since Prepared for a verification, since Verified for the lock (since
-- Prepared when the superadmin locks without a verification).
CREATE OR REPLACE FUNCTION public.annual_return_unacked_changes(
  p_client_id uuid, p_financial_year text, p_for text, p_actor_id uuid
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_since timestamptz;
BEGIN
  SELECT a.name INTO v_name FROM public.annual_return_actor(p_actor_id) a;
  SELECT CASE WHEN p_for = 'verify' THEN p.prepared_at ELSE COALESCE(p.verified_at, p.prepared_at) END
    INTO v_since
    FROM public.annual_return_periods p
   WHERE p.client_id = p_client_id AND p.financial_year = p_financial_year;
  RETURN public.annual_return_figure_changes(p_client_id, p_financial_year, v_since, v_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.annual_return_unacked_changes(uuid, text, text, uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.annual_return_actor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.annual_return_figure_changes(uuid, text, timestamptz, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Allotment
-- ---------------------------------------------------------------------------
-- p_items: [{client_id, user_id | null, expect_user_id | null}] — user_id null
-- removes the allotment; expect_user_id is who the user saw in the slot (a row
-- that changed meanwhile is skipped, not overwritten). Only a GST manager or
-- the superadmin allots. Returns {results: [{client_id, applied, reason,
-- previous: {id, name}, row}]}; reason is one of locked, changed, signed,
-- not_staff, not_manager, same_person, unchanged.
CREATE OR REPLACE FUNCTION public.annual_return_allot(
  p_financial_year text,
  p_stage text,
  p_items jsonb,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor record;
  v_item record;
  v_p public.annual_return_periods%ROWTYPE;
  v_target record;
  v_cur_id uuid;
  v_cur_name text;
  v_new_name text;
  v_reason text;
  v_word text;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF p_stage NOT IN ('preparer', 'verifier', 'reviewer') THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_BAD_ACTION: unknown stage %', p_stage USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_BAD_ACTION: at most 500 workings at a time' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_actor FROM public.annual_return_actor(p_actor_id);
  IF v_actor.role IS NULL OR v_actor.role NOT IN ('superadmin', 'gst_manager') THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: only a GST manager or the superadmin can allot.' USING ERRCODE = 'P0001';
  END IF;
  v_word := CASE p_stage WHEN 'preparer' THEN 'preparer' WHEN 'verifier' THEN 'verifier' ELSE 'reviewer' END;

  -- In client order, so two bulk allotments never deadlock.
  FOR v_item IN
    SELECT (e->>'client_id')::uuid AS client_id,
           NULLIF(e->>'user_id', '')::uuid AS user_id,
           NULLIF(e->>'expect_user_id', '')::uuid AS expect_id
      FROM jsonb_array_elements(p_items) e
     ORDER BY 1
  LOOP
    INSERT INTO public.annual_return_periods (client_id, financial_year, status)
    VALUES (v_item.client_id, p_financial_year, 'not_started')
    ON CONFLICT (client_id, financial_year) DO NOTHING;
    SELECT * INTO v_p FROM public.annual_return_periods
     WHERE client_id = v_item.client_id AND financial_year = p_financial_year
     FOR UPDATE;

    v_cur_id := CASE p_stage WHEN 'preparer' THEN v_p.preparer_id WHEN 'verifier' THEN v_p.verifier_id ELSE v_p.reviewer_id END;
    v_cur_name := CASE p_stage WHEN 'preparer' THEN v_p.preparer_name WHEN 'verifier' THEN v_p.verifier_name ELSE v_p.reviewer_name END;
    v_reason := NULL;
    -- No row (a removal, or not staff) leaves every field NULL.
    SELECT * INTO v_target FROM public.annual_return_actor(v_item.user_id);
    v_new_name := v_target.name;

    IF v_p.status = 'locked' THEN
      v_reason := 'locked';
    ELSIF v_cur_id IS DISTINCT FROM v_item.expect_id THEN
      v_reason := 'changed';
    ELSIF (p_stage = 'preparer' AND v_p.prepared_at IS NOT NULL) OR (p_stage = 'verifier' AND v_p.verified_at IS NOT NULL) THEN
      v_reason := 'signed';
    ELSIF v_item.user_id IS NOT NULL AND v_target.role IS NULL THEN
      v_reason := 'not_staff';
    ELSIF v_item.user_id IS NOT NULL AND p_stage = 'reviewer' AND v_target.role NOT IN ('superadmin', 'gst_manager') THEN
      v_reason := 'not_manager';
    ELSIF v_item.user_id IS NOT NULL AND (
         (p_stage = 'preparer' AND v_item.user_id IN (v_p.verifier_id, v_p.verified_by, v_p.reviewer_id))
      OR (p_stage = 'verifier' AND v_item.user_id IN (v_p.preparer_id, v_p.prepared_by, v_p.reviewer_id))
      OR (p_stage = 'reviewer' AND v_item.user_id IN (v_p.preparer_id, v_p.prepared_by, v_p.verifier_id, v_p.verified_by))
    ) THEN
      v_reason := 'same_person';
    ELSIF v_cur_id IS NOT DISTINCT FROM v_item.user_id THEN
      v_reason := 'unchanged';
    END IF;

    IF v_reason IS NULL THEN
      IF p_stage = 'preparer' THEN
        UPDATE public.annual_return_periods
           SET preparer_id = v_item.user_id, preparer_name = v_new_name,
               preparer_allotted_at = CASE WHEN v_item.user_id IS NULL THEN NULL ELSE now() END
         WHERE id = v_p.id;
      ELSIF p_stage = 'verifier' THEN
        UPDATE public.annual_return_periods SET verifier_id = v_item.user_id, verifier_name = v_new_name WHERE id = v_p.id;
      ELSE
        UPDATE public.annual_return_periods SET reviewer_id = v_item.user_id, reviewer_name = v_new_name WHERE id = v_p.id;
      END IF;
      UPDATE public.annual_return_periods
         SET allotted_at = now(), allotted_by_name = v_actor.name, updated_at = now()
       WHERE id = v_p.id;
      INSERT INTO public.annual_return_change_log
        (client_id, financial_year, doc_key, path, kind, old_value, new_value, action, changed_by)
      VALUES
        (v_item.client_id, p_financial_year, 'period', ARRAY['allot', p_stage], 'status',
         CASE WHEN v_cur_id IS NULL THEN NULL ELSE jsonb_build_object('id', v_cur_id, 'name', v_cur_name) END,
         CASE WHEN v_item.user_id IS NULL THEN NULL ELSE jsonb_build_object('id', v_item.user_id, 'name', v_new_name) END,
         CASE WHEN v_item.user_id IS NULL THEN 'Removed ' || v_word || ': ' || COALESCE(v_cur_name, '—')
              WHEN v_cur_id IS NULL THEN 'Allotted ' || v_word || ': ' || v_new_name
              ELSE 'Changed ' || v_word || ': ' || COALESCE(v_cur_name, '—') || ' → ' || v_new_name END,
         v_actor.name);
    END IF;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'client_id', v_item.client_id,
      'applied', v_reason IS NULL,
      'reason', v_reason,
      'previous', CASE WHEN v_cur_id IS NULL THEN NULL ELSE jsonb_build_object('id', v_cur_id, 'name', v_cur_name) END,
      'row', public.annual_return_signoff_row(v_item.client_id, p_financial_year)));
  END LOOP;

  RETURN jsonb_build_object('results', v_results);
END;
$$;

GRANT EXECUTE ON FUNCTION public.annual_return_allot(text, text, jsonb, uuid) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Prepare / verify / send back (and their withdrawals)
-- ---------------------------------------------------------------------------
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
    IF v_p.preparer_id IS NOT NULL AND v_p.preparer_id <> p_actor_id AND NOT v_mgr THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: allotted to % to prepare.', v_p.preparer_name USING ERRCODE = 'P0001';
    END IF;
    v_action := CASE
      WHEN v_p.preparer_id IS NOT NULL AND v_p.preparer_id <> p_actor_id THEN 'Marked prepared for ' || v_p.preparer_name
      WHEN v_p.prepared_at IS NOT NULL THEN 'Marked prepared again'
      ELSE 'Marked prepared' END;
    UPDATE public.annual_return_periods
       SET status = CASE WHEN status = 'not_started' THEN 'in_progress' ELSE status END,
           prepared_by = p_actor_id, prepared_by_name = v_actor.name, prepared_at = now(), prepared_note = v_note,
           preparer_id = COALESCE(preparer_id, p_actor_id),
           preparer_name = CASE WHEN preparer_id IS NULL THEN v_actor.name ELSE preparer_name END,
           preparer_allotted_at = COALESCE(preparer_allotted_at, now()),
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
    IF p_actor_id = v_p.prepared_by THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: you prepared it — someone else must verify it.' USING ERRCODE = 'P0001';
    END IF;
    IF p_actor_id = v_p.preparer_id THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: you are allotted to prepare it — someone else must verify it.' USING ERRCODE = 'P0001';
    END IF;
    IF p_actor_id = v_p.reviewer_id THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: you are allotted to review it — someone else must verify it.' USING ERRCODE = 'P0001';
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
      WHEN v_p.verifier_id IS NOT NULL AND v_p.verifier_id <> p_actor_id THEN 'Verified for ' || v_p.verifier_name
      ELSE 'Verified' END
      || CASE WHEN v_unacked > 0 THEN ' after checking ' || v_unacked || ' change' || CASE WHEN v_unacked = 1 THEN '' ELSE 's' END || ' since prepared' ELSE '' END;
    UPDATE public.annual_return_periods
       SET verified_by = p_actor_id, verified_by_name = v_actor.name, verified_role = v_actor.role,
           verified_at = now(), verified_note = v_note, changes_at_verify = v_unacked,
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
           returned_at = now(), returned_note = v_note,
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
       'changes', CASE WHEN p_action = 'verify' AND v_unacked > 0 THEN v_unacked END)),
     v_action, v_actor.name);

  RETURN public.annual_return_signoff_row(p_client_id, p_financial_year);
END;
$$;

GRANT EXECUTE ON FUNCTION public.annual_return_signoff(uuid, text, text, integer, uuid, text, text, integer) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Review & lock, and unlock
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_annual_return_status(uuid, text, text, text, text, text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.mark_annual_return_prepared(uuid, text, text, text, boolean);

-- p_to 'locked' reviews and locks a verified working: a GST manager or the
-- superadmin who neither prepared nor verified it. The superadmin may lock
-- without a verification, or one they prepared or verified, only with a
-- reason (p_override_reason), which is recorded. Every sheet is snapshotted.
-- p_to 'in_progress' unlocks (superadmin, GST manager or the unlock-sheets
-- permission) with a reason; the year goes back to Verified — the prepared and
-- verified stamps stay, the review is cleared (the log keeps it).
CREATE OR REPLACE FUNCTION public.set_annual_return_status(
  p_client_id uuid,
  p_financial_year text,
  p_to text,
  p_expected_rev integer,
  p_actor_id uuid,
  p_note text DEFAULT NULL,
  p_checklist jsonb DEFAULT NULL,
  p_payables jsonb DEFAULT NULL,
  p_changes_ack integer DEFAULT NULL,
  p_override_reason text DEFAULT NULL
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
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_reason text := NULLIF(btrim(COALESCE(p_override_reason, '')), '');
  v_problem text;
  v_kind text;
  v_override jsonb := NULL;
  v_unacked integer;
  v_action text;
  v_role text;
BEGIN
  IF p_to NOT IN ('locked', 'in_progress') THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_BAD_ACTION: unknown status %', p_to USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_actor FROM public.annual_return_actor(p_actor_id);
  IF v_actor.role IS NULL THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: only staff can change the status.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.annual_return_periods (client_id, financial_year, status)
  VALUES (p_client_id, p_financial_year, 'not_started')
  ON CONFLICT (client_id, financial_year) DO NOTHING;
  SELECT * INTO v_p FROM public.annual_return_periods
   WHERE client_id = p_client_id AND financial_year = p_financial_year
   FOR UPDATE;
  SELECT count(*)::int INTO v_sheets FROM public.annual_return_docs
   WHERE client_id = p_client_id AND financial_year = p_financial_year;
  v_stage := public.annual_return_stage(v_p.status, v_p.returned_at, v_p.verified_at, v_p.prepared_at, v_sheets);
  IF v_p.signoff_rev IS DISTINCT FROM p_expected_rev THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_SIGNOFF_STALE: %', v_stage USING ERRCODE = 'P0001';
  END IF;

  IF p_to = 'locked' THEN
    IF v_p.status = 'locked' THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_SIGNOFF_STALE: locked' USING ERRCODE = 'P0001';
    END IF;
    IF v_actor.role NOT IN ('superadmin', 'gst_manager') THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: only a GST manager or the superadmin can review and lock the year.' USING ERRCODE = 'P0001';
    END IF;
    IF v_p.prepared_at IS NULL THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: it has to be prepared and verified first.' USING ERRCODE = 'P0001';
    END IF;
    -- Three different people sign. What stands in the way, if anything:
    IF v_p.verified_at IS NULL THEN
      v_problem := 'it has not been verified.'; v_kind := 'skip_verify';
    ELSIF p_actor_id IN (v_p.verified_by, v_p.verifier_id) THEN
      v_problem := 'you verified it — a third person must review it.'; v_kind := 'same_person';
    ELSIF p_actor_id IN (v_p.prepared_by, v_p.preparer_id) THEN
      v_problem := 'you prepared it — a third person must review it.'; v_kind := 'same_person';
    END IF;
    IF v_problem IS NOT NULL THEN
      IF v_actor.role <> 'superadmin' THEN
        RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: %', v_problem USING ERRCODE = 'P0001';
      END IF;
      IF v_reason IS NULL OR length(v_reason) < 5 THEN
        RAISE EXCEPTION 'ANNUAL_RETURN_OVERRIDE_REQUIRED: %', v_problem USING ERRCODE = 'P0001';
      END IF;
      v_override := jsonb_build_object('kind', v_kind, 'by', v_actor.name, 'at', now(), 'reason', v_reason);
    END IF;

    v_unacked := public.annual_return_figure_changes(p_client_id, p_financial_year, COALESCE(v_p.verified_at, v_p.prepared_at), v_actor.name);
    IF v_unacked > COALESCE(p_changes_ack, 0) THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_CHANGED_SINCE: %', v_unacked USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.annual_return_doc_history
      (doc_id, client_id, financial_year, doc_key, data, version, updated_by, updated_at, reason)
    SELECT id, client_id, financial_year, doc_key, data, version, updated_by, updated_at,
           'Locked — reviewed by ' || v_actor.name
      FROM public.annual_return_docs
     WHERE client_id = p_client_id AND financial_year = p_financial_year;
    UPDATE public.annual_return_periods
       SET status = 'locked', locked_at = now(), locked_by = v_actor.name,
           reviewed_by = p_actor_id, reviewed_by_name = v_actor.name, reviewed_role = v_actor.role, reviewed_at = now(),
           review_note = v_note, review_checklist = p_checklist, payables_at_lock = p_payables,
           changes_at_lock = v_unacked,
           reviewer_id = COALESCE(reviewer_id, p_actor_id),
           reviewer_name = CASE WHEN reviewer_id IS NULL THEN v_actor.name ELSE reviewer_name END,
           returned_to = NULL, returned_by_name = NULL, returned_at = NULL, returned_note = NULL,
           signoff_overrides = CASE WHEN v_override IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_override) END,
           signoff_rev = signoff_rev + 1, updated_at = now()
     WHERE id = v_p.id;
    v_action := CASE
      WHEN v_override IS NOT NULL THEN 'Reviewed and locked (superadmin override: ' || v_reason || ')'
      WHEN v_p.reviewer_id IS NOT NULL AND v_p.reviewer_id <> p_actor_id THEN 'Reviewed and locked for ' || v_p.reviewer_name
      ELSE 'Reviewed and locked' END;
    v_role := v_actor.role;
  ELSE
    IF v_p.status <> 'locked' THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_BAD_ACTION: only a locked year can be unlocked.' USING ERRCODE = 'P0001';
    END IF;
    IF NOT v_actor.can_unlock THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOT_ALLOWED: only the superadmin, a GST manager or a user with the unlock-sheets permission can unlock.' USING ERRCODE = 'P0001';
    END IF;
    IF v_note IS NULL OR length(v_note) < 5 THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_NOTE_REQUIRED: say why it is being unlocked.' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.annual_return_periods
       SET status = 'in_progress', locked_at = NULL, locked_by = NULL,
           reviewed_by = NULL, reviewed_by_name = NULL, reviewed_role = NULL, reviewed_at = NULL,
           review_note = NULL, review_checklist = NULL, payables_at_lock = NULL, changes_at_lock = NULL,
           signoff_overrides = '[]'::jsonb,
           signoff_rev = signoff_rev + 1, updated_at = now()
     WHERE id = v_p.id;
    v_action := CASE WHEN v_p.verified_at IS NOT NULL THEN 'Unlocked — back to Verified' ELSE 'Unlocked — back to Prepared' END;
    v_role := CASE WHEN v_actor.role IN ('superadmin', 'gst_manager') THEN v_actor.role ELSE 'unlock_sheets' END;
  END IF;

  INSERT INTO public.annual_return_change_log
    (client_id, financial_year, doc_key, path, kind, old_value, new_value, action, changed_by)
  VALUES
    (p_client_id, p_financial_year, 'period', ARRAY['status'], 'status', to_jsonb(v_stage),
     jsonb_strip_nulls(jsonb_build_object(
       'stage', public.annual_return_stage(CASE WHEN p_to = 'locked' THEN 'locked' ELSE 'in_progress' END,
                                           NULL, v_p.verified_at, v_p.prepared_at, v_sheets),
       'role', v_role, 'note', v_note, 'checklist', p_checklist,
       'changes', CASE WHEN p_to = 'locked' AND v_unacked > 0 THEN v_unacked END,
       'override', v_override)),
     v_action, v_actor.name);

  RETURN public.annual_return_signoff_row(p_client_id, p_financial_year);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_annual_return_status(uuid, text, text, integer, uuid, text, jsonb, jsonb, integer, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Existing rows (never invent a verification)
-- ---------------------------------------------------------------------------
-- Who signed, where a stored name matches exactly one staff member.
WITH s AS (
  SELECT lower(btrim(pr.first_name)) AS n, (array_agg(DISTINCT pr.user_id))[1] AS uid, count(DISTINCT pr.user_id) AS c
    FROM public.profiles pr
    JOIN public.user_roles ur ON ur.user_id = pr.user_id AND ur.role::text <> 'client'
   GROUP BY 1
)
UPDATE public.annual_return_periods p SET prepared_by = s.uid
  FROM s
 WHERE p.prepared_by IS NULL AND p.prepared_by_name IS NOT NULL AND lower(btrim(p.prepared_by_name)) = s.n AND s.c = 1;
WITH s AS (
  SELECT lower(btrim(pr.first_name)) AS n, (array_agg(DISTINCT pr.user_id))[1] AS uid, count(DISTINCT pr.user_id) AS c
    FROM public.profiles pr
    JOIN public.user_roles ur ON ur.user_id = pr.user_id AND ur.role::text <> 'client'
   GROUP BY 1
)
UPDATE public.annual_return_periods p SET reviewed_by = s.uid
  FROM s
 WHERE p.reviewed_by IS NULL AND p.reviewed_by_name IS NOT NULL AND lower(btrim(p.reviewed_by_name)) = s.n AND s.c = 1;
UPDATE public.annual_return_periods
   SET preparer_id = prepared_by, preparer_name = prepared_by_name, preparer_allotted_at = prepared_at
 WHERE preparer_id IS NULL AND prepared_by IS NOT NULL;
-- A year locked before this migration was verified and locked in one step.
UPDATE public.annual_return_periods
   SET signoff_overrides = '[{"kind":"legacy","reason":"Verified and locked in one step, before the three-stage sign-off"}]'::jsonb
 WHERE status = 'locked' AND verified_at IS NULL AND signoff_overrides = '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
