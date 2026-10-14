-- Builder ITC reversal: the whole of GSTR-9 Table 7, and portal figures locked
-- (14 Oct 2026, the firm's request).
--
-- The working took each past year's Table 6 as the Rule 42/43 common credit
-- and only 7C/7D as reversed earlier. Credit reversed under the other heads
-- of Table 7 (7A Rule 37, 7B Rule 39, 7E s.17(5), 7F/7G TRAN, 7H other) was
-- never common credit, so it stayed in the base and the reversal came out too
-- high. Each year now carries those heads (t7_other), the working shows 7I and
-- 7J, and the Rule 42/43 base is 7J + 7C + 7D.
--
-- Figures fetched from the portal (a filed GSTR-9) are locked: `portal` holds
-- what was fetched, {source, fields: {column: value}}, and the trigger refuses
-- any write that leaves a locked column different from it. Refetching rewrites
-- `portal` and the columns together. A year whose GSTR-9 is not filed is not
-- locked (prefilled from the GSTR-3Bs, typed over freely).

BEGIN;

ALTER TABLE public.builder_itc_reversal_years
  ADD COLUMN IF NOT EXISTS t7_other jsonb NOT NULL DEFAULT '{}',   -- {a, b, e, f, g, h}: each {i, c, s, x}
  ADD COLUMN IF NOT EXISTS portal   jsonb;                         -- {source, fields: {column: value}}

CREATE OR REPLACE FUNCTION public.builder_itc_reversal_years_portal_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  k text;
BEGIN
  IF NEW.portal IS NULL OR jsonb_typeof(NEW.portal->'fields') <> 'object' THEN
    RETURN NEW;
  END IF;
  FOR k IN SELECT jsonb_object_keys(NEW.portal->'fields') LOOP
    IF (to_jsonb(NEW)->k) IS DISTINCT FROM (NEW.portal->'fields'->k) THEN
      RAISE EXCEPTION 'FY %: % was fetched from the filed GSTR-9 and cannot be changed — fetch it again from the portal instead.',
        NEW.financial_year, k USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_builder_itc_reversal_years_portal_lock ON public.builder_itc_reversal_years;
CREATE TRIGGER trg_builder_itc_reversal_years_portal_lock
  BEFORE INSERT OR UPDATE ON public.builder_itc_reversal_years
  FOR EACH ROW EXECUTE FUNCTION public.builder_itc_reversal_years_portal_lock();

COMMIT;
