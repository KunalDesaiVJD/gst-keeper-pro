-- Blocks new/edited/deleted receipts and invoices in a period whose GSTR-1
-- has already been Filed for that client. Deliberately scoped to just these
-- two tables — the primary entry points, where "editing a document dated in
-- an already-filed month" is unambiguous. NOT extended to the correction/
-- amendment tables (builder_reclassifications, builder_credit_notes,
-- builder_bounce_offsets, builder_refund_payments, builder_conversions):
-- their entire purpose is to correct figures for a period that is already
-- filed — reclassification's own period_month column even documents itself
-- as "the original period" being retaxed. Locking on that column would
-- disable the correction mechanism the firm actually relies on. Their own
-- POSTING period (posting_period on builder_reclassifications, period_month
-- on the others) is a separate, real gap this migration does not close —
-- left for a follow-up once each table's exact semantics are re-verified
-- one at a time, the same way builder_reclassification_periods nearly
-- became a false positive here.

CREATE OR REPLACE FUNCTION public.builder_assert_gstr1_not_filed(p_unit_id uuid, p_period text)
RETURNS void AS $$
DECLARE
  v_client_id uuid;
  v_filed boolean;
BEGIN
  IF p_period IS NULL OR p_period = '' THEN
    RETURN;
  END IF;

  SELECT p.client_id INTO v_client_id
    FROM public.builder_units u
    JOIN public.builder_projects p ON p.id = u.project_id
    WHERE u.id = p_unit_id;
  IF v_client_id IS NULL THEN
    RETURN; -- unit_id's own existence is enforced by its FK
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.filing_status
    WHERE client_id = v_client_id
      AND return_type = 'GSTR-1'
      AND period_month = p_period
      AND status = 'Filed'
  ) INTO v_filed;

  IF v_filed THEN
    RAISE EXCEPTION 'GSTR-1 for % is already Filed for this client — Builder receipts/invoices for that period are locked',
      p_period;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.builder_receipts_check_period_lock()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.builder_assert_gstr1_not_filed(OLD.unit_id, OLD.period_month);
    RETURN OLD;
  END IF;
  PERFORM public.builder_assert_gstr1_not_filed(NEW.unit_id, NEW.period_month);
  IF TG_OP = 'UPDATE' AND NEW.period_month IS DISTINCT FROM OLD.period_month THEN
    PERFORM public.builder_assert_gstr1_not_filed(OLD.unit_id, OLD.period_month);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.builder_invoices_check_period_lock()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.builder_assert_gstr1_not_filed(OLD.unit_id, OLD.period_month);
    RETURN OLD;
  END IF;
  PERFORM public.builder_assert_gstr1_not_filed(NEW.unit_id, NEW.period_month);
  IF TG_OP = 'UPDATE' AND NEW.period_month IS DISTINCT FROM OLD.period_month THEN
    PERFORM public.builder_assert_gstr1_not_filed(OLD.unit_id, OLD.period_month);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS builder_receipts_period_lock ON public.builder_receipts;
CREATE TRIGGER builder_receipts_period_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.builder_receipts
  FOR EACH ROW EXECUTE FUNCTION public.builder_receipts_check_period_lock();

DROP TRIGGER IF EXISTS builder_invoices_period_lock ON public.builder_invoices;
CREATE TRIGGER builder_invoices_period_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.builder_invoices
  FOR EACH ROW EXECUTE FUNCTION public.builder_invoices_check_period_lock();
