-- Restore staff auth functions that existed only in the old Lovable project
-- (created ad-hoc in the SQL editor, never captured in migration files).
-- Definitions copied verbatim from old project mlgxmhzlqykwdvvybhnk.

CREATE OR REPLACE FUNCTION public.authenticate_staff(identifier text, pass text)
 RETURNS TABLE(user_id uuid, first_name text, email text, role app_role, is_first_login boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    p.user_id,
    p.first_name,
    COALESCE(p.email, '') AS email,
    r.role,
    COALESCE(r.is_first_login, true) AS is_first_login
  FROM public.profiles p
  JOIN public.user_roles r ON r.user_id = p.user_id
  WHERE r.role IN ('superadmin', 'gst_manager', 'employee')
    AND (
      (position('@' in identifier) > 0 AND p.email = identifier)
      OR
      (position('@' in identifier) = 0 AND lower(p.first_name) = lower(identifier))
    )
    AND p.password = pass
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_first_login(target_user_id uuid, new_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.profiles
  SET password = new_password,
      updated_at = now()
  WHERE user_id = target_user_id;

  UPDATE public.user_roles
  SET is_first_login = false
  WHERE user_id = target_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_snapshot(target_user_id uuid)
 RETURNS TABLE(user_id uuid, first_name text, email text, role app_role)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.user_id,
    p.first_name,
    COALESCE(p.email, '') AS email,
    r.role
  FROM public.profiles p
  JOIN public.user_roles r ON r.user_id = p.user_id
  WHERE p.user_id = target_user_id
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.authenticate_staff(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_first_login(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_snapshot(uuid) TO anon, authenticated;
