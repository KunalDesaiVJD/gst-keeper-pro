-- Overriding an opening balance (Suspended Reco, GST Receivable Reco) is the
-- superadmin's alone (the firm's decision, 20 Oct 2026). The screens show the
-- Override button to the superadmin only (canManualOverride); this refuses a
-- new or changed override stamped by anyone else, e.g. from an old open tab.
--
-- Who acted is the opening_override_by the app sends: the same trust as every
-- staff_* function here (the app has no auth session). Overrides already made
-- (7 on suspended_reco, by GST Managers and employees) stay as they are:
-- a save that carries them unchanged is not a new override. Upload, Not
-- Applicable and the portal pull clear or leave the override fields, so they
-- are never refused. Re-runnable.

CREATE OR REPLACE FUNCTION public.opening_override_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF NEW.opening_override_justification IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- An upsert of an existing row fires this first; its UPDATE half decides.
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE client_id = $1 AND period_month = $2)', TG_TABLE_NAME)
      INTO v_exists USING NEW.client_id, NEW.period_month;
    IF v_exists THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.opening_override_justification IS NOT DISTINCT FROM OLD.opening_override_justification
    AND NEW.opening_override_at IS NOT DISTINCT FROM OLD.opening_override_at
    AND NEW.opening_override_by IS NOT DISTINCT FROM OLD.opening_override_by THEN
    RETURN NEW;
  END IF;
  IF public.staff_level_of(NEW.opening_override_by) IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Only the superadmin can override an opening balance.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_suspended_reco_opening_override ON public.suspended_reco;
CREATE TRIGGER trg_suspended_reco_opening_override
  BEFORE INSERT OR UPDATE ON public.suspended_reco
  FOR EACH ROW EXECUTE FUNCTION public.opening_override_guard();

DROP TRIGGER IF EXISTS trg_gst_receivable_reco_opening_override ON public.gst_receivable_reco;
CREATE TRIGGER trg_gst_receivable_reco_opening_override
  BEFORE INSERT OR UPDATE ON public.gst_receivable_reco
  FOR EACH ROW EXECUTE FUNCTION public.opening_override_guard();
