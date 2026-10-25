-- Roles plus extra permissions (25 Oct 2026, the firm's request).
--
-- 20261014120000 gave every employee ONE role (staff_positions) and carried
-- the one-by-one permissions into a role per distinct set, named after the
-- people ("Legacy access N — names"): fifteen roles for twenty employees, and
-- no way to give one person one more control without inventing another role.
--
-- Now:
--   * a small set of named roles holds the usual job's controls;
--   * a person can be given EXTRA controls on top of their role
--     (staff_user_extra_permissions, active while revoked_at IS NULL), set
--     only through staff_set_user_extras from Settings → User Control;
--   * user_permissions stays the DERIVED set every check reads (the app, the
--     DB functions, gst-push): role keys ∪ active extras. Direct writes are
--     still refused (user_permissions_guard).
--
-- Written additively: the existing sync (staff_positions_sync_user) is left
-- as it is and still sets a person to their role's keys; the extras are laid
-- back on top by staff_extras_reapply, called
--   * by staff_set_user_extras, right after its own sync;
--   * by the deferred constraint trigger on staff_position_log, at COMMIT of
--     every transaction that changed a role's keys, retired / reactivated or
--     deleted a role, or moved a person (each of those already writes a log
--     row, and runs the sync before COMMIT), so extras survive any of them.
--
-- Every employee on a legacy role moves to the largest standard role whose
-- controls they all hold, and keeps the rest as extras, so each person's
-- user_permissions is the same set of keys before and after. The data step
-- checks that and rolls everything back if anyone's set would change. The
-- legacy roles then go by themselves (trg_profiles_position_drop_empty_legacy,
-- 20261015120000).
--
-- RLS on, read open to public (CLAUDE.md: no Supabase auth session); no write
-- policy, so the table is written only by the SECURITY DEFINER functions here,
-- and staff_set_user_extras checks who is acting (GST Manager / superadmin).
-- Safe to run again.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extras, per person (a revoked extra is kept, with who and when)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_user_extra_permissions (
  id             bigserial PRIMARY KEY,
  user_id        uuid NOT NULL,
  permission_key text NOT NULL,
  granted_by     uuid,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  revoked_by     uuid,
  revoked_at     timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_user_extra_permissions_active_uq
  ON public.staff_user_extra_permissions (user_id, permission_key) WHERE revoked_at IS NULL;

ALTER TABLE public.staff_user_extra_permissions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'staff_user_extra_permissions' AND policyname = 'staff_user_extra_permissions_read') THEN
    CREATE POLICY staff_user_extra_permissions_read ON public.staff_user_extra_permissions
      FOR SELECT TO public USING (true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Lay a person's active extras on top of their role's keys
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.staff_extras_reapply(uuid)') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION public.staff_extras_reapply(p_user_id uuid)
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $b$
      BEGIN
        -- Employees only: a GST Manager holds every key by level, and a
        -- removed person (staff_remove) has no level left.
        IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'employee') THEN
          RETURN;
        END IF;
        PERFORM set_config('app.position_sync', 'on', true);
        INSERT INTO public.user_permissions (user_id, permission_key, granted_by)
        SELECT x.user_id, x.permission_key, x.granted_by
          FROM public.staff_user_extra_permissions x
         WHERE x.user_id = p_user_id AND x.revoked_at IS NULL
        ON CONFLICT (user_id, permission_key) DO NOTHING;
        PERFORM set_config('app.position_sync', 'off', true);
      END;
      $b$;
    $f$;
  END IF;
END $$;

-- At COMMIT, after every sync of the transaction: whoever a logged change
-- touched gets their extras back. A role-wide change (keys, retire, delete)
-- names the role, a move names the person.
DO $$
BEGIN
  IF to_regprocedure('public.staff_position_log_reapply_extras()') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION public.staff_position_log_reapply_extras()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $b$
      DECLARE r record;
      BEGIN
        IF NEW.user_id IS NOT NULL THEN
          PERFORM public.staff_extras_reapply(NEW.user_id);
        ELSIF NEW.position_id IS NOT NULL THEN
          FOR r IN SELECT user_id FROM public.profiles WHERE position_id = NEW.position_id LOOP
            PERFORM public.staff_extras_reapply(r.user_id);
          END LOOP;
        END IF;
        RETURN NULL;
      END;
      $b$;
    $f$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_staff_position_log_reapply_extras'
                  AND tgrelid = 'public.staff_position_log'::regclass) THEN
    CREATE CONSTRAINT TRIGGER trg_staff_position_log_reapply_extras
      AFTER INSERT ON public.staff_position_log
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION public.staff_position_log_reapply_extras();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Set one person's extras to exactly p_keys
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.staff_set_user_extras(uuid, uuid, text[])') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION public.staff_set_user_extras(p_actor_id uuid, p_user_id uuid, p_keys text[])
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $b$
      DECLARE
        v_keys text[] := ARRAY(SELECT DISTINCT btrim(k) FROM unnest(COALESCE(p_keys, '{}')) k WHERE btrim(k) <> '');
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_actor_id AND role IN ('superadmin', 'gst_manager')) THEN
          RAISE EXCEPTION 'Only a GST Manager or the superadmin gives extra permissions.' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'employee') THEN
          RAISE EXCEPTION 'Extra permissions are for employees; a GST Manager already holds every permission.' USING ERRCODE = 'check_violation';
        END IF;
        -- One change at a time per person.
        PERFORM 1 FROM public.profiles WHERE user_id = p_user_id FOR UPDATE;

        WITH gone AS (
          UPDATE public.staff_user_extra_permissions
             SET revoked_at = now(), revoked_by = p_actor_id
           WHERE user_id = p_user_id AND revoked_at IS NULL AND NOT (permission_key = ANY (v_keys))
          RETURNING permission_key
        )
        INSERT INTO public.staff_position_log (actor_id, action, user_id, permission_key)
        SELECT p_actor_id, 'revoke extra', p_user_id, permission_key FROM gone;

        WITH added AS (
          INSERT INTO public.staff_user_extra_permissions (user_id, permission_key, granted_by)
          SELECT p_user_id, k, p_actor_id FROM unnest(v_keys) k
           WHERE NOT EXISTS (SELECT 1 FROM public.staff_user_extra_permissions x
                              WHERE x.user_id = p_user_id AND x.permission_key = k AND x.revoked_at IS NULL)
          RETURNING permission_key
        )
        INSERT INTO public.staff_position_log (actor_id, action, user_id, permission_key)
        SELECT p_actor_id, 'grant extra', p_user_id, permission_key FROM added;

        -- Back to the role's keys, then the extras on top.
        PERFORM public.staff_positions_sync_user(p_user_id);
        PERFORM public.staff_extras_reapply(p_user_id);
      END;
      $b$;
    $f$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Standard roles, and everyone off the legacy ones
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_id uuid;
  v_role uuid;
  v_bad text;
  v_before jsonb;
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
  SELECT COALESCE(jsonb_object_agg(t.user_id, t.keys), '{}') INTO v_before
    FROM (SELECT up.user_id, to_jsonb(array_agg(up.permission_key ORDER BY up.permission_key)) AS keys
            FROM public.user_permissions up
            JOIN public.user_roles ur ON ur.user_id = up.user_id AND ur.role = 'employee'
           GROUP BY up.user_id) t;

  FOR r IN
    SELECT p.user_id,
           ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_before -> p.user_id::text, '[]'))) AS keys
      FROM public.profiles p
      JOIN public.staff_positions sp ON sp.id = p.position_id AND sp.is_legacy
      JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'employee'
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
    INSERT INTO public.staff_user_extra_permissions (user_id, permission_key)
    SELECT r.user_id, k FROM unnest(r.keys) k
     WHERE NOT EXISTS (SELECT 1 FROM public.staff_position_permissions
                        WHERE position_id = v_role AND permission_key = k)
       AND NOT EXISTS (SELECT 1 FROM public.staff_user_extra_permissions x
                        WHERE x.user_id = r.user_id AND x.permission_key = k AND x.revoked_at IS NULL);
    INSERT INTO public.staff_position_log (action, user_id, permission_key)
    SELECT 'grant extra', r.user_id, k FROM unnest(r.keys) k
     WHERE NOT EXISTS (SELECT 1 FROM public.staff_position_permissions
                        WHERE position_id = v_role AND permission_key = k);
    UPDATE public.profiles SET position_id = v_role, updated_at = now() WHERE user_id = r.user_id;
    PERFORM public.staff_extras_reapply(r.user_id);
  END LOOP;

  SELECT string_agg(p.first_name, ', ') INTO v_bad
    FROM jsonb_each(v_before) b
    JOIN public.profiles p ON p.user_id = b.key::uuid
   WHERE b.value IS DISTINCT FROM (
     SELECT to_jsonb(array_agg(up.permission_key ORDER BY up.permission_key))
       FROM public.user_permissions up WHERE up.user_id = b.key::uuid);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Moving to roles would change the access of: %', v_bad;
  END IF;
END $$;

COMMIT;
