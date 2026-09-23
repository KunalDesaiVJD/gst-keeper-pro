-- Every fresh staff/client login was broken live (confirmed: authenticate_staff
-- and authenticate_client throw "function crypt(text, text) does not exist"
-- for ANY identifier/password, unconditionally). Root cause: at some point the
-- live database was upgraded, outside any migration file, to verify/hash
-- passwords with pgcrypto's crypt()/gen_salt() — but authenticate_staff,
-- authenticate_client, complete_first_login and complete_client_first_login
-- all carry `SET search_path TO 'public'`, and pgcrypto's functions live in
-- the `extensions` schema on this project, not `public`, so crypt() is
-- unresolvable inside every one of them. Already-logged-in staff never
-- noticed because sessions persist via localStorage and never re-hit this
-- RPC; any FRESH login (staff or client) was completely broken.
--
-- Also: the reset_employee_password / reset_client_password functions
-- restored earlier today (20260923115630_...) were copied verbatim from an
-- old migration file that predates this bcrypt upgrade — they wrote the new
-- password as plaintext, inconsistent with the live crypt()-based
-- verification. Rewriting them here to match complete_first_login's
-- crypt(new_password, gen_salt('bf', 10)) pattern.

ALTER FUNCTION public.authenticate_staff(text, text) SET search_path TO 'public', 'extensions';
ALTER FUNCTION public.authenticate_client(text, text) SET search_path TO 'public', 'extensions';
ALTER FUNCTION public.complete_first_login(uuid, text, text) SET search_path TO 'public', 'extensions';
ALTER FUNCTION public.complete_client_first_login(uuid, text, text) SET search_path TO 'public', 'extensions';

CREATE OR REPLACE FUNCTION public.reset_employee_password(target_user_id uuid, new_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  UPDATE public.profiles
  SET password = crypt(new_password, gen_salt('bf', 10)),
      updated_at = now()
  WHERE user_id = target_user_id;

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
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  UPDATE public.clients
  SET client_password = crypt(new_password, gen_salt('bf', 10)),
      is_first_login = true,
      updated_at = now()
  WHERE id = target_client_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_client_password(uuid, text) TO PUBLIC;

-- Note: reset_employee_password/reset_client_password wrote plaintext for
-- anyone reset between 20260923115630 (this morning) and this migration —
-- confirmed affected: Gulab. Those need re-hashing via the dashboard's own
-- "Set New Password" action (now fixed) rather than a literal password here.
