-- Roles plus extra permissions (25 Oct 2026, the firm's request).
--
-- 20261014120000 gave every employee ONE role (staff_positions) and carried
-- the one-by-one permissions into a role per distinct set, named after the
-- people ("Legacy access N — names"): sixteen roles for twenty employees, and
-- no way to give one person one more control without inventing another role.
--
-- Now:
--   * a small set of named roles holds the usual job's controls;
--   * a person can be given EXTRA controls on top of their role
--     (staff_user_extra_permissions), set from Settings → User Control;
--   * user_permissions stays the DERIVED set every check reads (the app, the
--     DB functions, gst-push): role keys ∪ extra keys. Direct writes are still
--     refused (user_permissions_guard).
--
-- Every employee on a legacy role moves to the largest standard role whose
-- controls they all hold, and keeps the rest as extras, so each person's
-- user_permissions is the same set of keys before and after. The data step
-- checks that and rolls everything back if anyone's set would change. The
-- legacy roles then delete themselves (trg_profiles_position_drop_empty_legacy,
-- 20261015120000).
--
-- RLS open to public (CLAUDE.md: no Supabase auth session); the app gates the
-- page to GST Managers and the superadmin, and staff_set_user_extras checks
-- who is acting.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extras, per person
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_user_extra_permissions (
  user_id        uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  granted_by     uuid,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_key)
);

ALTER TABLE public.staff_user_extra_permissions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'staff_user_extra_permissions' AND policyname = 'staff_user_extra_permissions_read') THEN
    CREATE POLICY staff_user_extra_permissions_read ON public.staff_user_extra_permissions
      FOR SELECT TO public USING (true);
  END IF;
END $$;
-- Written only by staff_set_user_extras (and this migration): no write policy.
GRANT SELECT ON public.staff_user_extra_permissions TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Derived set = role keys ∪ extras
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
        WHERE spp.position_id = v_position AND spp.permission_key = up.permission_key)
     AND NOT EXISTS (
       SELECT 1 FROM public.staff_user_extra_permissions x
        WHERE x.user_id = p_user_id AND x.permission_key = up.permission_key);
  INSERT INTO public.user_permissions (user_id, permission_key, granted_by)
  SELECT p_user_id, spp.permission_key, spp.granted_by
    FROM public.staff_position_permissions spp
    JOIN public.staff_positions sp ON sp.id = spp.position_id AND sp.is_active
   WHERE spp.position_id = v_position
  UNION ALL
  SELECT p_user_id, x.permission_key, x.granted_by
    FROM public.staff_user_extra_permissions x
   WHERE x.user_id = p_user_id
  ON CONFLICT (user_id, permission_key) DO NOTHING;
  PERFORM set_config('app.position_sync', 'off', true);
END;
$$;

-- An extra given or taken → log it and re-derive that person.
CREATE OR REPLACE FUNCTION public.staff_user_extra_permissions_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  INSERT INTO public.staff_position_log (actor_id, action, user_id, permission_key)
  VALUES (CASE WHEN TG_OP = 'DELETE' THEN NULLIF(current_setting('app.actor_id', true), '')::uuid ELSE NEW.granted_by END,
          CASE WHEN TG_OP = 'DELETE' THEN 'revoke extra' ELSE 'grant extra' END,
          v_user, COALESCE(NEW.permission_key, OLD.permission_key));
  PERFORM public.staff_positions_sync_user(v_user);
  RETURN NULL;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_staff_user_extra_permissions_after'
                  AND tgrelid = 'public.staff_user_extra_permissions'::regclass) THEN
    CREATE TRIGGER trg_staff_user_extra_permissions_after
      AFTER INSERT OR DELETE ON public.staff_user_extra_permissions
      FOR EACH ROW EXECUTE FUNCTION public.staff_user_extra_permissions_after();
  END IF;
END $$;

-- Set one person's extras to exactly p_keys. GST Managers and the superadmin
-- only (roles are theirs too); an employee only, since a GST Manager holds
-- every control by level.
CREATE OR REPLACE FUNCTION public.staff_set_user_extras(p_actor_id uuid, p_user_id uuid, p_keys text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keys text[] := ARRAY(SELECT DISTINCT btrim(k) FROM unnest(COALESCE(p_keys, '{}')) k WHERE btrim(k) <> '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_actor_id AND role IN ('superadmin', 'gst_manager')) THEN
    RAISE EXCEPTION 'Only a GST Manager or the superadmin gives extra permissions.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'employee') THEN
    RAISE EXCEPTION 'Extra permissions are for employees; a GST Manager already holds every permission.' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('app.actor_id', p_actor_id::text, true);
  DELETE FROM public.staff_user_extra_permissions
   WHERE user_id = p_user_id AND NOT (permission_key = ANY (v_keys));
  INSERT INTO public.staff_user_extra_permissions (user_id, permission_key, granted_by)
  SELECT p_user_id, k, p_actor_id FROM unnest(v_keys) k
  ON CONFLICT (user_id, permission_key) DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION public.staff_set_user_extras(uuid, uuid, text[]) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Standard roles, and everyone off the legacy ones
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_id uuid;
  v_role uuid;
  v_bad text;
BEGIN
  -- Seeded only when the role does not exist yet; the firm edits them freely.
  FOR r IN
    SELECT * FROM (VALUES
      (10, 'GST Assistant', 'Import 2B and e-mail clients',
         ARRAY['send_client_emails', 'work_2b_import']),
      (20, 'GST Executive', 'Runs a client''s monthly GST: clients, filing status, exports',
         ARRAY['send_client_emails', 'work_2b_import', 'add_edit_clients', 'edit_filing_status', 'export_data']),
      (30, 'Senior GST Executive', 'GST Executive who also deletes 2B rows and edits the GST Running Update',
         ARRAY['send_client_emails', 'work_2b_import', 'add_edit_clients', 'edit_filing_status', 'export_data',
               'delete_2b_rows', 'edit_update_sheet']),
      (40, 'Builder Accountant', 'Builder module: projects, units, receipts, adjustments, reports',
         ARRAY['send_client_emails', 'work_2b_import', 'manage_builder_projects', 'manage_builder_units',
               'enter_builder_receipts', 'post_builder_adjustments', 'view_builder_reports']),
      (50, 'GST & Builder Executive', 'GST Executive and Builder Accountant together',
         ARRAY['send_client_emails', 'work_2b_import', 'add_edit_clients', 'edit_filing_status', 'export_data',
               'manage_builder_projects', 'manage_builder_units', 'enter_builder_receipts',
               'post_builder_adjustments', 'view_builder_reports'])
    ) AS t(sort_order, name, description, keys)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.staff_positions WHERE lower(btrim(name)) = lower(r.name)) THEN
      INSERT INTO public.staff_positions (name, description, sort_order)
      VALUES (r.name, r.description, r.sort_order) RETURNING id INTO v_id;
      INSERT INTO public.staff_position_permissions (position_id, permission_key)
      SELECT v_id, k FROM unnest(r.keys) k;
    END IF;
  END LOOP;

  -- Today's keys per employee, to prove nobody's set changes.
  CREATE TEMP TABLE staff_before ON COMMIT DROP AS
  SELECT up.user_id, array_agg(up.permission_key ORDER BY up.permission_key) AS keys
    FROM public.user_permissions up
    JOIN public.user_roles ur ON ur.user_id = up.user_id AND ur.role = 'employee'
   GROUP BY up.user_id;

  FOR r IN
    SELECT p.user_id, COALESCE(b.keys, '{}') AS keys
      FROM public.profiles p
      JOIN public.staff_positions sp ON sp.id = p.position_id AND sp.is_legacy
      JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'employee'
      LEFT JOIN staff_before b ON b.user_id = p.user_id
  LOOP
    -- The largest standard role whose every key the person holds.
    SELECT sp.id INTO v_role
      FROM public.staff_positions sp
     WHERE sp.is_active AND NOT sp.is_legacy
       AND EXISTS (SELECT 1 FROM public.staff_position_permissions WHERE position_id = sp.id)
       AND NOT EXISTS (SELECT 1 FROM public.staff_position_permissions spp
                        WHERE spp.position_id = sp.id AND NOT (spp.permission_key = ANY (r.keys)))
     ORDER BY (SELECT count(*) FROM public.staff_position_permissions WHERE position_id = sp.id) DESC, sp.sort_order
     LIMIT 1;
    IF v_role IS NULL THEN
      CONTINUE;  -- nobody today; they stay on their legacy role
    END IF;
    -- Extras first, then the move: the derived set never dips in between.
    INSERT INTO public.staff_user_extra_permissions (user_id, permission_key)
    SELECT r.user_id, k FROM unnest(r.keys) k
     WHERE NOT EXISTS (SELECT 1 FROM public.staff_position_permissions
                        WHERE position_id = v_role AND permission_key = k)
    ON CONFLICT DO NOTHING;
    UPDATE public.profiles SET position_id = v_role, updated_at = now() WHERE user_id = r.user_id;
  END LOOP;

  SELECT string_agg(p.first_name, ', ') INTO v_bad
    FROM staff_before b
    JOIN public.profiles p ON p.user_id = b.user_id
   WHERE b.keys IS DISTINCT FROM (
     SELECT array_agg(up.permission_key ORDER BY up.permission_key)
       FROM public.user_permissions up WHERE up.user_id = b.user_id);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Moving to roles would change the access of: %', v_bad;
  END IF;
END $$;

COMMIT;
