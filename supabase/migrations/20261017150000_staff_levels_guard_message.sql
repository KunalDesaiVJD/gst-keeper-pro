-- A tab opened before the staff screens changed (17 Oct 2026) still writes
-- user_roles directly, and the guard of 20261017100000 refuses it with a
-- message that sends the person to the screen they are already on. Say what
-- to do instead: reload, then change the level where it is changed now
-- (Settings → User Control → People, or Dashboard → User Management).
-- Only the messages change; what is refused stays the same.

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
  -- about a row may change outside the staff_* level functions.
  IF TG_OP = 'UPDATE'
     AND NEW.id = OLD.id AND NEW.user_id = OLD.user_id AND NEW.role = OLD.role
     AND (NEW.is_first_login IS NOT DISTINCT FROM OLD.is_first_login OR NEW.is_first_login IS FALSE) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'This screen is out of date. Reload the page (Ctrl+Shift+R), then change the level in Settings → User Control → People: the superadmin, with their password.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

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
    RAISE EXCEPTION 'This screen is out of date. Reload the page (Ctrl+Shift+R), then remove the person in Dashboard → User Management.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END;
$$;
