-- Annual Return (GSTR-9 / GSTR-9C): the superadmin's override of applicability.
--
-- The register on the Annual Return home decides who files from the aggregate
-- turnover (src/lib/gstr9/applicability.ts): GSTR-9 above ₹2 crore, GSTR-9C
-- above ₹5 crore, below only at the client's wish. The superadmin may now set
-- a client's year to Required or Not required, for GSTR-9 and GSTR-9C each,
-- whatever the turnover says, with a reason; clearing both puts the year back
-- on the turnover rule ("Auto").
--
--   * Only through annual_return_set_applicability_override, which checks the
--     actor is the superadmin (annual_return_actor). The trigger
--     client_annual_turnover_override_guard refuses every other write of the
--     override columns, so the register's own upsert (turnover, wishes, note)
--     can never set or clear one.
--   * 9C goes with the GSTR-9 it reconciles: 9C Required with GSTR-9 Not
--     required is refused.
--   * A registration that files no GSTR-9 at all (composition, TDS, ISD, not
--     registered in the year) stays Not applicable; the override does not
--     reach it (the engine decides that, not this table).
--   * Who and when are on the row (override_by_name, override_at, reason) for
--     the register's marker, and every change is in gst_change_log, which
--     logs every column of client_annual_turnover (columns added later too).
--
-- Idempotent: safe to run more than once.

ALTER TABLE public.client_annual_turnover
  ADD COLUMN IF NOT EXISTS gstr9_override text,
  ADD COLUMN IF NOT EXISTS gstr9c_override text,
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS override_by uuid,
  ADD COLUMN IF NOT EXISTS override_by_name text,
  ADD COLUMN IF NOT EXISTS override_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_annual_turnover_override_values') THEN
    ALTER TABLE public.client_annual_turnover
      ADD CONSTRAINT client_annual_turnover_override_values CHECK (
        (gstr9_override IS NULL OR gstr9_override IN ('required', 'not_required'))
        AND (gstr9c_override IS NULL OR gstr9c_override IN ('required', 'not_required'))
        AND NOT (gstr9_override = 'not_required' AND gstr9c_override = 'required')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.client_annual_turnover.gstr9_override IS
  'The superadmin''s decision for GSTR-9 this year (required / not_required), over the turnover rule; NULL = auto.';
COMMENT ON COLUMN public.client_annual_turnover.gstr9c_override IS
  'The superadmin''s decision for GSTR-9C this year (required / not_required), over the turnover rule; NULL = auto.';

-- ---------------------------------------------------------------------------
-- Guard: the override columns change only through the function below
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_annual_turnover_override_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('annual_return.override_door', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.gstr9_override IS NOT NULL OR NEW.gstr9c_override IS NOT NULL OR NEW.override_reason IS NOT NULL
       OR NEW.override_by IS NOT NULL OR NEW.override_by_name IS NOT NULL OR NEW.override_at IS NOT NULL THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_OVERRIDE_NOT_ALLOWED: Only the superadmin overrides GSTR-9 / 9C applicability, on All clients.'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.gstr9_override IS DISTINCT FROM OLD.gstr9_override
     OR NEW.gstr9c_override IS DISTINCT FROM OLD.gstr9c_override
     OR NEW.override_reason IS DISTINCT FROM OLD.override_reason
     OR NEW.override_by IS DISTINCT FROM OLD.override_by
     OR NEW.override_by_name IS DISTINCT FROM OLD.override_by_name
     OR NEW.override_at IS DISTINCT FROM OLD.override_at THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_OVERRIDE_NOT_ALLOWED: Only the superadmin overrides GSTR-9 / 9C applicability, on All clients.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_annual_turnover_override_guard ON public.client_annual_turnover;
CREATE TRIGGER client_annual_turnover_override_guard
  BEFORE INSERT OR UPDATE ON public.client_annual_turnover
  FOR EACH ROW EXECUTE FUNCTION public.client_annual_turnover_override_guard();

-- ---------------------------------------------------------------------------
-- The one door: set or clear the override (superadmin only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.annual_return_set_applicability_override(
  p_client_id uuid,
  p_financial_year text,
  p_actor_id uuid,
  p_gstr9 text,
  p_gstr9c text,
  p_reason text
)
RETURNS TABLE (
  gstr9_override text, gstr9c_override text, override_reason text,
  override_by_name text, override_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_name text;
  v_role text;
  v_g9 text := NULLIF(btrim(COALESCE(p_gstr9, '')), '');
  v_g9c text := NULLIF(btrim(COALESCE(p_gstr9c, '')), '');
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_clear boolean;
BEGIN
  SELECT a.name, a.role INTO v_name, v_role FROM public.annual_return_actor(p_actor_id) a;
  IF v_role IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_OVERRIDE_NOT_ALLOWED: Only the superadmin overrides GSTR-9 / 9C applicability.'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_financial_year IS NULL OR p_financial_year !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_OVERRIDE_FY: % is not a financial year (e.g. 2025-26).', p_financial_year USING ERRCODE = 'P0001';
  END IF;
  IF (v_g9 IS NOT NULL AND v_g9 NOT IN ('required', 'not_required'))
     OR (v_g9c IS NOT NULL AND v_g9c NOT IN ('required', 'not_required')) THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_OVERRIDE_VALUE: Choose Required, Not required or Auto.' USING ERRCODE = 'P0001';
  END IF;
  IF v_g9 = 'not_required' AND v_g9c = 'required' THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_OVERRIDE_9C: GSTR-9C goes with the GSTR-9 it reconciles. Set GSTR-9 to Required or Auto first.'
      USING ERRCODE = 'P0001';
  END IF;
  v_clear := v_g9 IS NULL AND v_g9c IS NULL;
  IF NOT v_clear AND v_reason IS NULL THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_OVERRIDE_REASON: Give a reason for the override.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client_id) THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_OVERRIDE_CLIENT: No such client.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('annual_return.override_door', 'on', true);
  INSERT INTO public.client_annual_turnover AS t (
    client_id, financial_year, gstr9_override, gstr9c_override, override_reason,
    override_by, override_by_name, override_at, updated_at, updated_by_name
  )
  VALUES (
    p_client_id, p_financial_year, v_g9, v_g9c, CASE WHEN v_clear THEN NULL ELSE v_reason END,
    CASE WHEN v_clear THEN NULL ELSE p_actor_id END, CASE WHEN v_clear THEN NULL ELSE v_name END,
    CASE WHEN v_clear THEN NULL ELSE now() END, now(), v_name
  )
  ON CONFLICT (client_id, financial_year) DO UPDATE SET
    gstr9_override = EXCLUDED.gstr9_override,
    gstr9c_override = EXCLUDED.gstr9c_override,
    override_reason = EXCLUDED.override_reason,
    override_by = EXCLUDED.override_by,
    override_by_name = EXCLUDED.override_by_name,
    override_at = EXCLUDED.override_at,
    updated_at = now(),
    updated_by_name = v_name;
  PERFORM set_config('annual_return.override_door', '', true);

  RETURN QUERY
    SELECT t.gstr9_override, t.gstr9c_override, t.override_reason, t.override_by_name, t.override_at
      FROM public.client_annual_turnover t
     WHERE t.client_id = p_client_id AND t.financial_year = p_financial_year;
END;
$$;

REVOKE ALL ON FUNCTION public.annual_return_set_applicability_override(uuid, text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.annual_return_set_applicability_override(uuid, text, uuid, text, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
