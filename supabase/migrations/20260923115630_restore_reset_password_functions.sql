-- Re-apply reset_employee_password and reset_client_password, which turned
-- out to be missing on the live project despite being defined in
-- 20260113100458_... and 20260126073221_... — confirmed live via the
-- dashboard's "Set New Password" action returning a 404 (PostgREST "function
-- not found") on both RPCs, per CLAUDE.md's migration-drift warning (no
-- migration ledger exists, so a file being in this folder never guaranteed
-- it was actually applied). Definitions copied verbatim from those files.

CREATE OR REPLACE FUNCTION public.reset_employee_password(target_user_id uuid, new_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Update password in profiles table
  UPDATE public.profiles
  SET password = new_password,
      updated_at = now()
  WHERE user_id = target_user_id;

  -- Also reset is_first_login flag to false since admin set a known password
  UPDATE public.user_roles
  SET is_first_login = false
  WHERE user_id = target_user_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_employee_password(uuid, text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.reset_client_password(target_client_id uuid, new_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.clients
  SET client_password = new_password,
      is_first_login = true,
      updated_at = now()
  WHERE id = target_client_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_client_password(uuid, text) TO PUBLIC;
