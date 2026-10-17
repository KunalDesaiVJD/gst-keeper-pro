-- staff_end_sessions (20261017110000) let anyone end their own sessions with
-- no check, and the functions cannot see who is calling: naming the
-- superadmin as both actor and target signed the superadmin out, again and
-- again, from anywhere with the public key. Now:
--   - an Employee's sessions: whoever manages employees (as before);
--   - a GST Manager's or the superadmin's: the superadmin, with their password;
--   - no "own sessions" shortcut (the app's own Log out never needed one: it
--     only clears the browser's sign-in).

-- The superadmin check now serves more than the level change: say it plainly.
CREATE OR REPLACE FUNCTION public.staff_require_superadmin(p_actor_id uuid, p_password text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
BEGIN
  IF p_actor_id IS NULL OR public.staff_level_of(p_actor_id) IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Only the superadmin can do this, with their password.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT password INTO v_hash FROM public.profiles WHERE user_id = p_actor_id LIMIT 1;
  IF v_hash IS NULL OR p_password IS NULL OR p_password = '' OR crypt(p_password, v_hash) <> v_hash THEN
    RAISE EXCEPTION 'The superadmin password is not correct.' USING ERRCODE = 'invalid_password';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.staff_require_superadmin(uuid, text) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.staff_end_sessions(uuid, uuid);

CREATE OR REPLACE FUNCTION public.staff_end_sessions(
  p_actor_id uuid, p_target_user_id uuid, p_actor_password text DEFAULT NULL)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level text := public.staff_level_of(p_target_user_id);
  v_at    timestamptz := now();
BEGIN
  IF v_level IS NULL THEN
    RAISE EXCEPTION 'No staff account found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_level = 'employee' THEN
    PERFORM public.staff_require_employee_manager(p_actor_id);
  ELSE
    PERFORM public.staff_require_superadmin(p_actor_id, p_actor_password);
  END IF;

  UPDATE public.profiles SET sessions_ended_at = v_at WHERE user_id = p_target_user_id;
  INSERT INTO public.staff_position_log (actor_id, action, position_name, user_id)
  VALUES (p_actor_id, 'logged out', public.staff_level_label(v_level), p_target_user_id);
  RETURN v_at;
END;
$$;
GRANT EXECUTE ON FUNCTION public.staff_end_sessions(uuid, uuid, text) TO anon, authenticated, service_role;
