-- Staff levels (app_role: superadmin / gst_manager / employee) change only
-- through the functions below; a trigger refuses every other write to
-- user_roles, and deleting the profile of someone who still holds a staff
-- level.
--
-- Until now user_roles was open to every caller ("Anyone can manage
-- user_roles for development"): with the app's public key anyone could make
-- anyone a GST Manager or the superadmin, or remove staff, whatever the
-- screen allowed. The policies stay open (the app signs in with its own
-- session, so auth.uid() is NULL and RLS cannot tell callers apart); the
-- gate is this trigger, as user_permissions_guard is for permissions.
--
-- The firm's rule (17 Oct 2026): only the superadmin changes a level. The
-- functions cannot see who is calling, so p_actor_id is the signed-in user's
-- id as the app sends it, as for staff_set_password. Anything that gives or
-- takes away the GST Manager level (which carries every permission) also
-- needs the superadmin's own password, so knowing the superadmin's id is not
-- enough. Adding or removing an Employee stays with whoever manages
-- employees (the superadmin, a GST Manager, an employee holding
-- manage_employees), as before. Nobody adds, removes or changes the
-- superadmin here. Every change is written to staff_position_log, which
-- Settings → User Control shows as its change log.

-- ---------------------------------------------------------------------------
-- 1. The guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_roles_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('app.staff_roles_write', true), 'off') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- The sign-in functions (complete_first_login, staff_set_password,
  -- reset_employee_password) clear the first-login flag; nothing else
  -- about a row may change outside the functions below.
  IF TG_OP = 'UPDATE'
     AND NEW.id = OLD.id AND NEW.user_id = OLD.user_id AND NEW.role = OLD.role
     AND (NEW.is_first_login IS NOT DISTINCT FROM OLD.is_first_login OR NEW.is_first_login IS FALSE) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Staff levels change only in Dashboard → User Management: a GST Manager level by the superadmin, with their password.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
DROP TRIGGER IF EXISTS trg_user_roles_guard ON public.user_roles;
CREATE TRIGGER trg_user_roles_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.user_roles_guard();

CREATE OR REPLACE FUNCTION public.profiles_staff_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('app.staff_roles_write', true), 'off') = 'on' THEN
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles r
              WHERE r.user_id = OLD.user_id AND r.role IN ('superadmin', 'gst_manager', 'employee')) THEN
    RAISE EXCEPTION 'Remove staff only in Dashboard → User Management.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_profiles_staff_delete_guard ON public.profiles;
CREATE TRIGGER trg_profiles_staff_delete_guard
  BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_staff_delete_guard();

-- ---------------------------------------------------------------------------
-- 2. Who is acting
-- ---------------------------------------------------------------------------
-- The acting user's level ('superadmin', 'gst_manager', 'employee', or NULL).
CREATE OR REPLACE FUNCTION public.staff_level_of(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN bool_or(role = 'superadmin') THEN 'superadmin'
    WHEN bool_or(role = 'gst_manager') THEN 'gst_manager'
    WHEN bool_or(role = 'employee') THEN 'employee'
  END
    FROM public.user_roles WHERE user_id = p_user_id;
$$;

-- Raises unless p_actor_id is the superadmin and p_password is their password.
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
    RAISE EXCEPTION 'Only the superadmin can give or take away the GST Manager level.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT password INTO v_hash FROM public.profiles WHERE user_id = p_actor_id LIMIT 1;
  IF v_hash IS NULL OR p_password IS NULL OR p_password = '' OR crypt(p_password, v_hash) <> v_hash THEN
    RAISE EXCEPTION 'The superadmin password is not correct.' USING ERRCODE = 'invalid_password';
  END IF;
END;
$$;

-- Raises unless p_actor_id may add or remove an Employee.
CREATE OR REPLACE FUNCTION public.staff_require_employee_manager(p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level text := public.staff_level_of(p_actor_id);
BEGIN
  IF v_level IN ('superadmin', 'gst_manager') THEN
    RETURN;
  END IF;
  IF v_level = 'employee' AND EXISTS (
       SELECT 1 FROM public.user_permissions WHERE user_id = p_actor_id AND permission_key = 'manage_employees') THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'You are not allowed to add or remove staff.' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_level_label(p_level text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_level WHEN 'gst_manager' THEN 'GST Manager' WHEN 'employee' THEN 'Employee'
                      WHEN 'superadmin' THEN 'Superadmin' ELSE COALESCE(p_level, '—') END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Change a level, add a level, remove staff
-- ---------------------------------------------------------------------------
-- Employee ↔ GST Manager: the superadmin, with their password.
CREATE OR REPLACE FUNCTION public.staff_set_level(
  p_actor_id uuid, p_actor_password text, p_target_user_id uuid, p_level text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current text;
BEGIN
  PERFORM public.staff_require_superadmin(p_actor_id, p_actor_password);
  IF p_level IS NULL OR p_level NOT IN ('employee', 'gst_manager') THEN
    RAISE EXCEPTION 'A staff level is Employee or GST Manager.' USING ERRCODE = 'check_violation';
  END IF;
  v_current := public.staff_level_of(p_target_user_id);
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'No staff account found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_current = 'superadmin' THEN
    RAISE EXCEPTION 'The superadmin''s level cannot be changed.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_current = p_level AND NOT EXISTS (
       SELECT 1 FROM public.user_roles WHERE user_id = p_target_user_id AND role IN ('employee', 'gst_manager') AND role::text <> p_level) THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.staff_roles_write', 'on', true);
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_target_user_id AND role::text = p_level) THEN
    -- Someone holding both staff levels keeps the one chosen.
    DELETE FROM public.user_roles
     WHERE user_id = p_target_user_id AND role IN ('employee', 'gst_manager') AND role::text <> p_level;
  ELSE
    UPDATE public.user_roles SET role = p_level::public.app_role
     WHERE user_id = p_target_user_id AND role IN ('employee', 'gst_manager');
  END IF;
  PERFORM set_config('app.staff_roles_write', 'off', true);

  INSERT INTO public.staff_position_log (actor_id, action, position_name, user_id)
  VALUES (p_actor_id, 'level', public.staff_level_label(v_current) || ' → ' || public.staff_level_label(p_level), p_target_user_id);
  -- An Employee's permissions come from their position again.
  PERFORM public.staff_positions_sync_user(p_target_user_id);
  RETURN true;
END;
$$;

-- A level for a new staff member (their profile already added): an
-- Employee by whoever manages employees, a GST Manager by the superadmin
-- with their password.
CREATE OR REPLACE FUNCTION public.staff_add_level(
  p_actor_id uuid, p_target_user_id uuid, p_level text, p_actor_password text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_level = 'gst_manager' THEN
    PERFORM public.staff_require_superadmin(p_actor_id, p_actor_password);
  ELSIF p_level = 'employee' THEN
    PERFORM public.staff_require_employee_manager(p_actor_id);
  ELSE
    RAISE EXCEPTION 'A staff level is Employee or GST Manager.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_target_user_id) THEN
    RAISE EXCEPTION 'Add the staff member''s profile first.' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_target_user_id) THEN
    RAISE EXCEPTION 'This person already has a level; change it instead.' USING ERRCODE = 'unique_violation';
  END IF;

  PERFORM set_config('app.staff_roles_write', 'on', true);
  INSERT INTO public.user_roles (user_id, role, is_first_login)
  VALUES (p_target_user_id, p_level::public.app_role, true);
  PERFORM set_config('app.staff_roles_write', 'off', true);

  INSERT INTO public.staff_position_log (actor_id, action, position_name, user_id)
  VALUES (p_actor_id, 'added', public.staff_level_label(p_level), p_target_user_id);
  RETURN true;
END;
$$;

-- Removes a staff member: their level, their derived permissions and their
-- profile, in one go. An Employee by whoever manages employees; a GST
-- Manager by the superadmin with their password; never the superadmin, nor
-- oneself.
CREATE OR REPLACE FUNCTION public.staff_remove(
  p_actor_id uuid, p_target_user_id uuid, p_actor_password text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level text := public.staff_level_of(p_target_user_id);
  v_name  text;
BEGIN
  IF v_level IS NULL THEN
    RAISE EXCEPTION 'No staff account found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_level = 'superadmin' THEN
    RAISE EXCEPTION 'The superadmin cannot be removed.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_actor_id IS NOT DISTINCT FROM p_target_user_id THEN
    RAISE EXCEPTION 'You cannot remove yourself.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_level = 'gst_manager' THEN
    PERFORM public.staff_require_superadmin(p_actor_id, p_actor_password);
  ELSE
    PERFORM public.staff_require_employee_manager(p_actor_id);
  END IF;

  SELECT first_name INTO v_name FROM public.profiles WHERE user_id = p_target_user_id LIMIT 1;
  INSERT INTO public.staff_position_log (actor_id, action, position_name, user_id)
  VALUES (p_actor_id, 'removed', public.staff_level_label(v_level) || COALESCE(' — ' || v_name, ''), p_target_user_id);

  PERFORM set_config('app.staff_roles_write', 'on', true);
  DELETE FROM public.user_roles WHERE user_id = p_target_user_id;
  PERFORM set_config('app.position_sync', 'on', true);
  DELETE FROM public.user_permissions WHERE user_id = p_target_user_id;
  PERFORM set_config('app.position_sync', 'off', true);
  DELETE FROM public.profiles WHERE user_id = p_target_user_id;
  PERFORM set_config('app.staff_roles_write', 'off', true);
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_set_level(uuid, text, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_add_level(uuid, uuid, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_remove(uuid, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_level_of(uuid) TO anon, authenticated, service_role;
-- The checks are for the functions above, not for calling on their own.
REVOKE EXECUTE ON FUNCTION public.staff_require_superadmin(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_require_employee_manager(uuid) FROM PUBLIC, anon, authenticated;
