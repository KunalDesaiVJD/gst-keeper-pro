-- Staff positions (12 Oct 2026, the firm's request): an employee's controls are
-- no longer ticked one by one on the person. Each employee holds ONE position
-- (Article Assistant, GST Executive, Builder Accountant …) and the position
-- carries the permission keys. Change a position and everyone in it changes.
--
-- user_permissions stays, as the DERIVED per-user set: every check already in
-- the app, the DB (annual_return_actor) and the gst-push Edge Function reads
-- it, so they keep working unchanged. It is written only by
-- staff_positions_sync_user() below; a direct write is refused, so a grant can
-- no longer be given to one person behind the position's back.
--
-- superadmin / gst_manager keep every permission by role, as before; a
-- position on them is informational only.
--
-- Existing access is preserved: each distinct set of keys employees hold today
-- becomes a position named after them ("Legacy access — <names>"), which the
-- firm can rename, merge or retire from Settings → User Control.
--
-- RLS open to public (CLAUDE.md: the app has no Supabase auth session); the
-- gate is canManageEmployees() in the app.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_positions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  sort_order  int  NOT NULL DEFAULT 100,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_positions_name_nonblank CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_positions_name_uq ON public.staff_positions (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.staff_position_permissions (
  position_id    uuid NOT NULL REFERENCES public.staff_positions(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  granted_by     uuid,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (position_id, permission_key)
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS position_id uuid REFERENCES public.staff_positions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS profiles_position_idx ON public.profiles (position_id);

-- Who changed what: one row per position / assignment change.
CREATE TABLE IF NOT EXISTS public.staff_position_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  action      text NOT NULL,        -- grant | revoke | assign | unassign | create | rename | retire | delete
  position_id uuid,
  position_name text,
  user_id     uuid,
  permission_key text
);
CREATE INDEX IF NOT EXISTS staff_position_log_at_idx ON public.staff_position_log (at DESC);

ALTER TABLE public.staff_positions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_position_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_position_log         ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_positions_all ON public.staff_positions;
CREATE POLICY staff_positions_all ON public.staff_positions FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS staff_position_permissions_all ON public.staff_position_permissions;
CREATE POLICY staff_position_permissions_all ON public.staff_position_permissions FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS staff_position_log_read ON public.staff_position_log;
CREATE POLICY staff_position_log_read ON public.staff_position_log FOR SELECT TO public USING (true);
-- The log is written by triggers only (SECURITY DEFINER).

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_positions, public.staff_position_permissions TO anon, authenticated, service_role;
GRANT SELECT ON public.staff_position_log TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Derive user_permissions from the position
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_positions_sync_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_position uuid;
BEGIN
  SELECT position_id INTO v_position FROM public.profiles WHERE user_id = p_user_id LIMIT 1;
  PERFORM set_config('app.position_sync', 'on', true);
  DELETE FROM public.user_permissions up
   WHERE up.user_id = p_user_id
     AND NOT EXISTS (
       SELECT 1 FROM public.staff_position_permissions spp
        JOIN public.staff_positions sp ON sp.id = spp.position_id AND sp.is_active
        WHERE spp.position_id = v_position AND spp.permission_key = up.permission_key);
  INSERT INTO public.user_permissions (user_id, permission_key, granted_by)
  SELECT p_user_id, spp.permission_key, spp.granted_by
    FROM public.staff_position_permissions spp
    JOIN public.staff_positions sp ON sp.id = spp.position_id AND sp.is_active
   WHERE spp.position_id = v_position
  ON CONFLICT (user_id, permission_key) DO NOTHING;
  PERFORM set_config('app.position_sync', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_positions_sync_position(p_position_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT user_id FROM public.profiles WHERE position_id = p_position_id LOOP
    PERFORM public.staff_positions_sync_user(r.user_id);
  END LOOP;
END;
$$;

-- Direct writes to user_permissions are refused: grants come from positions.
CREATE OR REPLACE FUNCTION public.user_permissions_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('app.position_sync', true), 'off') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Permissions are given through positions. Assign the employee a position (Settings → User Control), or change the position''s permissions.'
    USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS trg_user_permissions_guard ON public.user_permissions;
CREATE TRIGGER trg_user_permissions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.user_permissions_guard();

-- A position's keys change → everyone holding it.
CREATE OR REPLACE FUNCTION public.staff_position_permissions_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pos uuid := COALESCE(NEW.position_id, OLD.position_id);
  v_name text;
BEGIN
  SELECT name INTO v_name FROM public.staff_positions WHERE id = v_pos;
  INSERT INTO public.staff_position_log (actor_id, action, position_id, position_name, permission_key)
  VALUES (CASE WHEN TG_OP = 'DELETE' THEN NULLIF(current_setting('app.actor_id', true), '')::uuid ELSE NEW.granted_by END,
          CASE WHEN TG_OP = 'DELETE' THEN 'revoke' ELSE 'grant' END,
          v_pos, v_name, COALESCE(NEW.permission_key, OLD.permission_key));
  IF v_name IS NOT NULL THEN  -- skip while the position itself is being deleted
    PERFORM public.staff_positions_sync_position(v_pos);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_staff_position_permissions_after ON public.staff_position_permissions;
CREATE TRIGGER trg_staff_position_permissions_after
  AFTER INSERT OR DELETE ON public.staff_position_permissions
  FOR EACH ROW EXECUTE FUNCTION public.staff_position_permissions_after();

-- A position retired / reactivated / renamed / deleted.
CREATE OR REPLACE FUNCTION public.staff_positions_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.staff_position_log (actor_id, action, position_id, position_name)
    VALUES (NEW.created_by, 'create', NEW.id, NEW.name);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      INSERT INTO public.staff_position_log (action, position_id, position_name)
      VALUES ('rename', NEW.id, OLD.name || ' → ' || NEW.name);
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      INSERT INTO public.staff_position_log (action, position_id, position_name)
      VALUES (CASE WHEN NEW.is_active THEN 'reactivate' ELSE 'retire' END, NEW.id, NEW.name);
      PERFORM public.staff_positions_sync_position(NEW.id);
    END IF;
  ELSE
    INSERT INTO public.staff_position_log (action, position_id, position_name)
    VALUES ('delete', OLD.id, OLD.name);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_staff_positions_after ON public.staff_positions;
CREATE TRIGGER trg_staff_positions_after
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_positions
  FOR EACH ROW EXECUTE FUNCTION public.staff_positions_after();

-- Deleting a position sets profiles.position_id NULL (FK), which fires the
-- profile trigger below and clears those users' derived permissions.

-- An employee moved to another position (or none).
CREATE OR REPLACE FUNCTION public.profiles_position_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.position_id IS DISTINCT FROM OLD.position_id THEN
    INSERT INTO public.staff_position_log (actor_id, action, position_id, position_name, user_id)
    SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid,
           CASE WHEN NEW.position_id IS NULL THEN 'unassign' ELSE 'assign' END,
           COALESCE(NEW.position_id, OLD.position_id),
           (SELECT name FROM public.staff_positions WHERE id = COALESCE(NEW.position_id, OLD.position_id)),
           NEW.user_id;
    PERFORM public.staff_positions_sync_user(NEW.user_id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_profiles_position_after ON public.profiles;
CREATE TRIGGER trg_profiles_position_after
  AFTER UPDATE OF position_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_position_after();

-- Assign with attribution (the app sends who is acting; no auth session).
CREATE OR REPLACE FUNCTION public.staff_assign_position(p_user_id uuid, p_position_id uuid, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.actor_id', COALESCE(p_actor_id::text, ''), true);
  UPDATE public.profiles SET position_id = p_position_id, updated_at = now() WHERE user_id = p_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.staff_assign_position(uuid, uuid, uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Carry today's access into positions
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  s record;
  v_pos uuid;
  v_names text;
  v_n int := 0;
BEGIN
  FOR s IN
    WITH sets AS (
      SELECT up.user_id, string_agg(up.permission_key, ',' ORDER BY up.permission_key) AS keyset
        FROM public.user_permissions up
        JOIN public.user_roles r ON r.user_id = up.user_id AND r.role = 'employee'
       GROUP BY up.user_id
    )
    SELECT ks.keyset, array_agg(ks.user_id) AS users, count(*) AS n
      FROM sets ks GROUP BY ks.keyset ORDER BY count(*) DESC, ks.keyset
  LOOP
    v_n := v_n + 1;
    SELECT string_agg(p.first_name, ', ' ORDER BY p.first_name) INTO v_names
      FROM public.profiles p WHERE p.user_id = ANY (s.users);
    INSERT INTO public.staff_positions (name, description, sort_order)
    VALUES (left('Legacy access ' || v_n || ' — ' || COALESCE(v_names, 'staff'), 120),
            'Carried over on 12 Oct 2026 from the permissions these employees held one by one. Rename it to the job it stands for, or move its people to a standard position and retire it.',
            900 + v_n)
    RETURNING id INTO v_pos;
    INSERT INTO public.staff_position_permissions (position_id, permission_key)
    SELECT v_pos, k FROM unnest(string_to_array(s.keyset, ',')) k;
    UPDATE public.profiles SET position_id = v_pos WHERE user_id = ANY (s.users);
  END LOOP;

  -- Employees who held no key at all still did the work every staff member
  -- could do; they get a position too, so the seeded keys below reach them.
  SELECT string_agg(p.first_name, ', ' ORDER BY p.first_name) INTO v_names
    FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.user_id AND r.role = 'employee'
   WHERE p.position_id IS NULL;
  IF v_names IS NOT NULL THEN
    INSERT INTO public.staff_positions (name, description, sort_order)
    VALUES (left('Legacy access ' || (v_n + 1) || ' — ' || v_names, 120),
            'Carried over on 12 Oct 2026 for employees who held no permission one by one. Rename it, or move its people to a standard position and retire it.',
            900 + v_n + 1)
    RETURNING id INTO v_pos;
    UPDATE public.profiles p SET position_id = v_pos
      FROM public.user_roles r
     WHERE r.user_id = p.user_id AND r.role = 'employee' AND p.position_id IS NULL;
  END IF;

  -- New keys (12 Oct 2026) for actions every staff member could do until now:
  -- every carried-over position keeps them, so nobody loses daily work today.
  -- Actions newly gated by an EXISTING key (exports, filing status, 2B deletes)
  -- are not seeded — the firm already chose who holds those keys.
  INSERT INTO public.staff_position_permissions (position_id, permission_key)
  SELECT sp.id, k
    FROM public.staff_positions sp
    CROSS JOIN unnest(ARRAY['work_2b_import', 'send_client_emails']) k
   WHERE sp.name LIKE 'Legacy access %'
  ON CONFLICT DO NOTHING;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Passwords: the caller must be allowed to set this password
-- ---------------------------------------------------------------------------
-- reset_employee_password / reset_client_password took any user id and any
-- password from anyone holding the anon key — including the superadmin's —
-- and "change my password" never checked the current one. They are revoked;
-- the app calls these instead, naming who is acting. With no Supabase auth
-- session the actor id is still the browser's word, so this stops mistakes
-- and casual misuse, not a determined insider (same footing as
-- annual_return_actor, docs/GSTR9_9C_WORKINGS.md §6.20).
CREATE OR REPLACE FUNCTION public.staff_set_password(
  p_actor_id uuid, p_target_user_id uuid, p_new_password text, p_current_password text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor_role  text;
  v_target_role text;
  v_hash        text;
BEGIN
  IF p_new_password IS NULL OR length(p_new_password) < 8 THEN
    RAISE EXCEPTION 'The new password must be at least 8 characters.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT role::text INTO v_actor_role FROM public.user_roles WHERE user_id = p_actor_id LIMIT 1;
  SELECT role::text INTO v_target_role FROM public.user_roles WHERE user_id = p_target_user_id LIMIT 1;
  IF v_target_role IS NULL OR v_target_role = 'client' THEN
    RAISE EXCEPTION 'No staff account found.' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_actor_id = p_target_user_id THEN
    SELECT password INTO v_hash FROM public.profiles WHERE user_id = p_target_user_id LIMIT 1;
    IF v_hash IS NOT NULL AND (p_current_password IS NULL OR crypt(p_current_password, v_hash) <> v_hash) THEN
      RAISE EXCEPTION 'The current password is not correct.' USING ERRCODE = 'invalid_password';
    END IF;
  ELSIF v_actor_role = 'superadmin' THEN
    NULL;
  ELSIF v_target_role = 'superadmin' THEN
    RAISE EXCEPTION 'Only the superadmin can change the superadmin''s password.' USING ERRCODE = 'insufficient_privilege';
  ELSIF v_actor_role = 'gst_manager' THEN
    NULL;
  ELSIF v_target_role = 'gst_manager' THEN
    RAISE EXCEPTION 'Only a GST Manager or the superadmin can reset a GST Manager''s password.' USING ERRCODE = 'insufficient_privilege';
  ELSIF v_actor_role = 'employee' AND EXISTS (
      SELECT 1 FROM public.user_permissions WHERE user_id = p_actor_id AND permission_key = 'manage_employees') THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'You are not allowed to reset this password.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.profiles
     SET password = crypt(p_new_password, gen_salt('bf', 10)), updated_at = now()
   WHERE user_id = p_target_user_id;
  UPDATE public.user_roles SET is_first_login = false WHERE user_id = p_target_user_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_set_client_password(p_actor_id uuid, p_client_id uuid, p_new_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_actor_role text;
BEGIN
  IF p_new_password IS NULL OR length(p_new_password) < 8 THEN
    RAISE EXCEPTION 'The new password must be at least 8 characters.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT role::text INTO v_actor_role FROM public.user_roles WHERE user_id = p_actor_id LIMIT 1;
  IF NOT (v_actor_role IN ('superadmin', 'gst_manager')
          OR (v_actor_role = 'employee' AND EXISTS (
                SELECT 1 FROM public.user_permissions WHERE user_id = p_actor_id
                   AND permission_key IN ('manage_employees', 'add_edit_clients')))) THEN
    RAISE EXCEPTION 'You are not allowed to reset a client''s password.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.clients
     SET client_password = crypt(p_new_password, gen_salt('bf', 10)), is_first_login = true, updated_at = now()
   WHERE id = p_client_id;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_set_password(uuid, uuid, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_set_client_password(uuid, uuid, text) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.reset_employee_password(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_client_password(uuid, text) FROM PUBLIC, anon, authenticated;

COMMIT;
