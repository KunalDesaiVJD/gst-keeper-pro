-- Refund orders are read by their figures, not their title (27 Oct 2026).
--
-- The portal titles every RFD-06 "Refund Sanction/Rejection Order", so the
-- closing sweep's test for a rejection (sdtls.sancordervo.ordertype ~* 'reject')
-- was true for every sanction order: a refund sanctioned in full and paid
-- (RFD-05 on file) kept its RFD-06 notice open for ever ("new", waiting on us).
-- Live, 27 Oct 2026: 5 such notices, 3 of them Crownglobe's.
--
-- The order carries its figures per head (sdtls.sancordervo.sancamtdtl.<igst|
-- cgst|sgst|cess>.<clmamt|provamt|grsamt|inadmamt|…>.<tax|intr|pen|fee|oth>):
-- inadmamt is the amount held inadmissible, i.e. rejected. So an order is a
-- rejection when it holds an inadmissible amount, or sanctions nothing of a
-- claim; an order without figures is still read by its title (an ambiguous
-- title counts as a possible rejection, as before, so it keeps its clock).
--
-- notices_sweep is left as it is (replacing it is not additive). Its refund
-- rule is now applied by notices_close_paid_refunds, run by triggers whenever
-- folder items or notices arrive, and once below for what is already on file.
-- Only notices no one has given a status (staff_status IS NULL) are closed,
-- with the sweep's own reason auto:refund_paid.

-- One part of an order's figures, summed over heads and over tax, interest,
-- penalty, fee and other.
CREATE OR REPLACE FUNCTION public.refund_order_amount(p_sanc jsonb, p_part text)
RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(sum(
           CASE WHEN coalesce(v.value, '') ~ '^\s*-?\d+(\.\d+)?\s*$' THEN btrim(v.value)::numeric ELSE 0 END), 0)
    FROM jsonb_each(CASE WHEN jsonb_typeof(p_sanc -> 'sancamtdtl') = 'object' THEN p_sanc -> 'sancamtdtl' ELSE '{}'::jsonb END) h,
         LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(h.value -> p_part) = 'object' THEN h.value -> p_part ELSE '{}'::jsonb END) v
$$;

-- Is this folder item a sanction order that rejects any part of the claim?
CREATE OR REPLACE FUNCTION public.refund_order_rejects(p_raw jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN jsonb_typeof(p_raw -> 'sdtls' -> 'sancordervo') IS DISTINCT FROM 'object' THEN false
           WHEN jsonb_typeof(p_raw -> 'sdtls' -> 'sancordervo' -> 'sancamtdtl') = 'object' THEN
             public.refund_order_amount(p_raw -> 'sdtls' -> 'sancordervo', 'inadmamt') > 0
             OR (public.refund_order_amount(p_raw -> 'sdtls' -> 'sancordervo', 'clmamt') > 0
                 AND public.refund_order_amount(p_raw -> 'sdtls' -> 'sancordervo', 'grsamt')
                   + public.refund_order_amount(p_raw -> 'sdtls' -> 'sancordervo', 'provamt') <= 0)
           ELSE coalesce(p_raw -> 'sdtls' -> 'sancordervo' ->> 'ordertype', '') ~* 'reject'
         END
$$;

-- The sweep's "Refund paid" rule, read by figures: a refund notice no one has
-- touched closes once its case holds a payment order (RFD-05) and no sanction
-- order that rejects any part.
CREATE OR REPLACE FUNCTION public.notices_close_paid_refunds(p_client_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_n int := 0;
  v_prev_actor text := coalesce(current_setting('app.actor_name', true), '');
BEGIN
  PERFORM set_config('app.actor_name', 'Closing sweep', true);
  WITH secs AS (
    SELECT fi.client_id, fi.case_id,
           bool_or(upper(btrim(coalesce(fi.folder_section, ''))) IN ('ORDRS', 'ORDER', 'ORDERS')
                   AND jsonb_typeof(fi.raw_json -> 'sdtls' -> 'payadviceordervo') = 'object') AS paid,
           bool_or(public.refund_order_rejects(fi.raw_json)) AS rejects
      FROM public.gst_case_folder_items fi
     WHERE fi.deleted_at IS NULL
       AND (p_client_id IS NULL OR fi.client_id = p_client_id)
     GROUP BY fi.client_id, fi.case_id
  )
  UPDATE public.gst_notices n
     SET staff_status = 'Closed', close_reason = 'auto:refund_paid'
    FROM secs s
   WHERE s.client_id = n.client_id AND s.case_id = n.case_id
     AND s.paid AND NOT s.rejects
     AND n.deleted_at IS NULL AND n.staff_status IS NULL AND n.case_id IS NOT NULL
     AND coalesce(n.notice_type, '') ~* 'refund'
     AND (p_client_id IS NULL OR n.client_id = p_client_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('app.actor_name', v_prev_actor, true);
  RETURN v_n;
END;
$$;

-- Run it for each client a statement touched (folder items or notices).
CREATE OR REPLACE FUNCTION public.notices_close_paid_refunds_after()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  c uuid;
BEGIN
  FOR c IN SELECT DISTINCT client_id FROM changed_rows WHERE client_id IS NOT NULL LOOP
    PERFORM public.notices_close_paid_refunds(c);
  END LOOP;
  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_case_folder_items_close_paid_refunds_ins') THEN
    CREATE TRIGGER trg_case_folder_items_close_paid_refunds_ins AFTER INSERT ON public.gst_case_folder_items
      REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION public.notices_close_paid_refunds_after();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_case_folder_items_close_paid_refunds_upd') THEN
    CREATE TRIGGER trg_case_folder_items_close_paid_refunds_upd AFTER UPDATE ON public.gst_case_folder_items
      REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION public.notices_close_paid_refunds_after();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_gst_notices_close_paid_refunds_ins') THEN
    CREATE TRIGGER trg_gst_notices_close_paid_refunds_ins AFTER INSERT ON public.gst_notices
      REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION public.notices_close_paid_refunds_after();
  END IF;
END $$;

-- What is already on file.
SELECT public.notices_close_paid_refunds(NULL);
