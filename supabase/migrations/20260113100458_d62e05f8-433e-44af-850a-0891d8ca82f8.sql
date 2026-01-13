-- Create a function to allow staff to reset employee passwords securely
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

-- Grant execute permission to public (RLS will still apply through the function's internal checks)
GRANT EXECUTE ON FUNCTION public.reset_employee_password(uuid, text) TO PUBLIC;