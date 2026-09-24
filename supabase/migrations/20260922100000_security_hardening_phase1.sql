-- Phase 1: Emergency Security Hardening
-- Hashes all passwords with pgcrypto, adds old-password verification to
-- self-service RPCs, adds server-side password validation, and hashes
-- new passwords on write.

-- 1. Enable pgcrypto for bcrypt hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Hash existing plaintext passwords in-place
UPDATE public.clients
SET client_password = crypt(client_password, gen_salt('bf', 10))
WHERE client_password IS NOT NULL
  AND client_password NOT LIKE '$2a$%'
  AND client_password NOT LIKE '$2b$%';

UPDATE public.profiles
SET password = crypt(password, gen_salt('bf', 10))
WHERE password IS NOT NULL
  AND password NOT LIKE '$2a$%'
  AND password NOT LIKE '$2b$%';

-- 3. Rewrite authenticate_client to use bcrypt comparison
CREATE OR REPLACE FUNCTION public.authenticate_client(identifier text, pass text)
RETURNS TABLE(
  client_id uuid,
  client_name text,
  client_email text,
  gstin text,
  is_first_login boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS client_id,
    c.name AS client_name,
    COALESCE(c.email, '') AS client_email,
    c.gstin,
    COALESCE(c.is_first_login, true) AS is_first_login
  FROM public.clients c
  WHERE (
    upper(c.gstin) = upper(identifier)
    OR
    upper(c.client_user_id) = upper(identifier)
  )
  AND c.client_password = crypt(pass, c.client_password)
  LIMIT 1;
END;
$$;

-- 4. Rewrite authenticate_staff to use bcrypt comparison
CREATE OR REPLACE FUNCTION public.authenticate_staff(identifier text, pass text)
RETURNS TABLE(user_id uuid, first_name text, email text, role app_role, is_first_login boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    AND p.password = crypt(pass, p.password)
  LIMIT 1;
END;
$$;

-- 5. Rewrite complete_client_first_login: require old password, validate new password
CREATE OR REPLACE FUNCTION public.complete_client_first_login(
  target_client_id uuid,
  old_password text,
  new_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  stored_hash text;
BEGIN
  SELECT client_password INTO stored_hash
  FROM public.clients
  WHERE id = target_client_id;

  IF stored_hash IS NULL THEN
    RAISE EXCEPTION 'Client not found';
  END IF;

  IF stored_hash != crypt(old_password, stored_hash) THEN
    RAISE EXCEPTION 'Current password is incorrect';
  END IF;

  IF length(new_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;

  UPDATE public.clients
  SET client_password = crypt(new_password, gen_salt('bf', 10)),
      is_first_login = false,
      updated_at = now()
  WHERE id = target_client_id;
END;
$$;

-- 6. Rewrite complete_first_login (staff): require old password, validate new password
CREATE OR REPLACE FUNCTION public.complete_first_login(
  target_user_id uuid,
  old_password text,
  new_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  stored_hash text;
BEGIN
  SELECT password INTO stored_hash
  FROM public.profiles
  WHERE user_id = target_user_id;

  IF stored_hash IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF stored_hash != crypt(old_password, stored_hash) THEN
    RAISE EXCEPTION 'Current password is incorrect';
  END IF;

  IF length(new_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;

  UPDATE public.profiles
  SET password = crypt(new_password, gen_salt('bf', 10)),
      updated_at = now()
  WHERE user_id = target_user_id;

  UPDATE public.user_roles
  SET is_first_login = false
  WHERE user_id = target_user_id;
END;
$$;

-- 7. Rewrite reset_client_password: hash new password, validate length
CREATE OR REPLACE FUNCTION public.reset_client_password(target_client_id uuid, new_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF length(new_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;

  UPDATE public.clients
  SET client_password = crypt(new_password, gen_salt('bf', 10)),
      is_first_login = true,
      updated_at = now()
  WHERE id = target_client_id;

  RETURN FOUND;
END;
$$;

-- 8. Rewrite reset_employee_password: hash new password, validate length
CREATE OR REPLACE FUNCTION public.reset_employee_password(target_user_id uuid, new_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF length(new_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;

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

-- Drop old 2-param overloads (they bypass old-password verification)
DROP FUNCTION IF EXISTS public.complete_client_first_login(uuid, text);
DROP FUNCTION IF EXISTS public.complete_first_login(uuid, text);

-- Re-grant execute (signatures changed for complete_client_first_login and complete_first_login)
GRANT EXECUTE ON FUNCTION public.authenticate_client(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_staff(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_client_first_login(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_first_login(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_client_password(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_employee_password(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_snapshot(uuid) TO anon, authenticated;
