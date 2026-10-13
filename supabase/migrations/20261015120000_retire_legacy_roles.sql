-- Retire the "Legacy access" roles (13 Oct 2026, the firm's decision).
--
-- The 12 Oct migration (20261014120000_staff_positions.sql) carried each
-- employee's one-by-one permissions into roles named "Legacy access N —
-- names". The firm wants roles only: the superadmin picks a role for each
-- person and its controls follow. So legacy roles:
--   * are marked is_legacy, and nobody can be newly placed on one;
--   * keep working for the people still on them, so nobody loses access
--     before the superadmin has chosen their new role;
--   * delete themselves when their last holder moves to another role.

BEGIN;

ALTER TABLE public.staff_positions ADD COLUMN IF NOT EXISTS is_legacy boolean NOT NULL DEFAULT false;
UPDATE public.staff_positions SET is_legacy = true WHERE name LIKE 'Legacy access %';

-- Nobody is placed on a legacy role.
CREATE OR REPLACE FUNCTION public.profiles_position_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.position_id IS DISTINCT FROM OLD.position_id
     AND NEW.position_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.staff_positions WHERE id = NEW.position_id AND is_legacy) THEN
    RAISE EXCEPTION 'Legacy roles are being retired — choose one of the firm''s roles.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_profiles_position_guard ON public.profiles;
CREATE TRIGGER trg_profiles_position_guard
  BEFORE UPDATE OF position_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_position_guard();

-- A legacy role nobody holds any more goes.
CREATE OR REPLACE FUNCTION public.profiles_position_drop_empty_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.position_id IS NOT NULL AND NEW.position_id IS DISTINCT FROM OLD.position_id THEN
    DELETE FROM public.staff_positions sp
     WHERE sp.id = OLD.position_id AND sp.is_legacy
       AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.position_id = sp.id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_profiles_position_drop_empty_legacy ON public.profiles;
CREATE TRIGGER trg_profiles_position_drop_empty_legacy
  AFTER UPDATE OF position_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_position_drop_empty_legacy();

-- Legacy roles nobody holds today (none at the time of writing) go now.
DELETE FROM public.staff_positions sp
 WHERE sp.is_legacy AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.position_id = sp.id);

COMMIT;
