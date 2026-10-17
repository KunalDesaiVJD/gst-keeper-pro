-- End a staff member's sessions, so they must log in again.
--
-- The app keeps its own sign-in in the browser (localStorage), not a server
-- session, so nothing could sign a person out from elsewhere: an open tab
-- stayed signed in as long as their level existed. profiles.sessions_ended_at
-- records when their sessions were ended; the app notes when each sign-in
-- happened and signs out any sign-in older than that, on load, every minute
-- and when its tab comes back into view (src/contexts/AuthContext.tsx).
-- A tab still running an app version from before this change only checks
-- when it is next loaded.
--
-- Who may end sessions: the superadmin anyone's; a GST Manager, or an
-- employee holding manage_employees, an Employee's; anyone their own.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sessions_ended_at timestamptz;

CREATE OR REPLACE FUNCTION public.staff_end_sessions(p_actor_id uuid, p_target_user_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level text := public.staff_level_of(p_target_user_id);
  v_actor text := public.staff_level_of(p_actor_id);
  v_at    timestamptz := now();
BEGIN
  IF v_level IS NULL THEN
    RAISE EXCEPTION 'No staff account found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_actor_id IS DISTINCT FROM p_target_user_id AND v_actor IS DISTINCT FROM 'superadmin' THEN
    IF v_level <> 'employee' THEN
      RAISE EXCEPTION 'Only the superadmin can end a GST Manager''s or the superadmin''s sessions.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM public.staff_require_employee_manager(p_actor_id);
  END IF;

  UPDATE public.profiles SET sessions_ended_at = v_at WHERE user_id = p_target_user_id;
  INSERT INTO public.staff_position_log (actor_id, action, position_name, user_id)
  VALUES (p_actor_id, 'logged out', public.staff_level_label(v_level), p_target_user_id);
  RETURN v_at;
END;
$$;
GRANT EXECUTE ON FUNCTION public.staff_end_sessions(uuid, uuid) TO anon, authenticated, service_role;
