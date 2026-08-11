-- Two things, found investigating why SWENI CORPORATION's F-Shop 22 and
-- F-Shop 23 (both unit_type = 'Commercial') had receipts posted at the
-- AFFORDABLE (1.5%, a Residential-only code) rate:
--
--   1. Root cause: resolveRateCode() in src/utils/builderRates.ts cannot
--      itself produce AFFORDABLE for a Commercial unit_type — every receipt-
--      entry path (both bulk dialogs, the single "Record receipt" dialog)
--      derives rate_code fresh from the unit's CURRENT classification, with
--      no manual override anywhere in the UI. So the mismatch could only
--      happen if unit_type genuinely wasn't 'Commercial' yet when the
--      receipt was entered — confirmed against builder_units/builder_receipts
--      timestamps: the unit was corrected to Commercial 14 minutes AFTER the
--      receipt posted, by the same staff member.
--   2. Gap: nothing enforced rate_code/unit_type consistency at write time —
--      the app got it right by construction, but nothing would have caught
--      a script, a future code path, or a stale cross-tab write getting it
--      wrong. Guard 1 below closes that at the database.
--
-- Because both receipts were never filed (July 2026 sits at status=Prepared,
-- is_locked=false), the correct fix is to correct the source documents
-- directly rather than layer a Table 10 amendment on top — so the
-- auto-posted reclassification for these two units (itself a duplicate; see
-- 20260811120000_builder_reclass_dedupe_unique.sql) is now entirely
-- redundant and is removed rather than deduped, to avoid double-correcting
-- the same rupee.

-- ── 1. Guard: rate_code must agree with the unit's unit_type ────────────────
-- DELAY_INTEREST_18 (builder_invoices only, per the phase-4 CHECK extension)
-- is exempt — it is a rate on a supply separate from construction, valid
-- for a unit of either type, not a per-unit classification code.
CREATE OR REPLACE FUNCTION public.builder_check_rate_code_matches_unit_type()
RETURNS trigger AS $$
DECLARE
  u_type text;
BEGIN
  IF NEW.rate_code = 'DELAY_INTEREST_18' THEN
    RETURN NEW;
  END IF;

  SELECT unit_type INTO u_type FROM public.builder_units WHERE id = NEW.unit_id;
  IF u_type IS NULL THEN
    RETURN NEW; -- unit_id's own existence is enforced by its FK
  END IF;

  IF u_type = 'Commercial' AND NEW.rate_code NOT IN ('COMMERCIAL_RREP', 'COMMERCIAL_REP') THEN
    RAISE EXCEPTION 'rate_code % is invalid for unit % — a Commercial unit can only carry COMMERCIAL_RREP or COMMERCIAL_REP',
      NEW.rate_code, NEW.unit_id;
  END IF;
  IF u_type = 'Residential' AND NEW.rate_code NOT IN ('AFFORDABLE', 'OTHER_RESIDENTIAL') THEN
    RAISE EXCEPTION 'rate_code % is invalid for unit % — a Residential unit can only carry AFFORDABLE or OTHER_RESIDENTIAL',
      NEW.rate_code, NEW.unit_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS builder_receipts_check_rate_code ON public.builder_receipts;
CREATE TRIGGER builder_receipts_check_rate_code
  BEFORE INSERT OR UPDATE ON public.builder_receipts
  FOR EACH ROW EXECUTE FUNCTION public.builder_check_rate_code_matches_unit_type();

DROP TRIGGER IF EXISTS builder_invoices_check_rate_code ON public.builder_invoices;
CREATE TRIGGER builder_invoices_check_rate_code
  BEFORE INSERT OR UPDATE ON public.builder_invoices
  FOR EACH ROW EXECUTE FUNCTION public.builder_check_rate_code_matches_unit_type();

-- ── 2. Fix: the two receipts, corrected in place ─────────────────────────────
-- consideration and taxable_value are unchanged (§ engine note above — the
-- land split runs off consideration, not rate). Figures hand-verified
-- against computeTax(consideration, 'COMMERCIAL_RREP') for both:
--   F-Shop 22: 625000 consideration -> 416666.67 taxable -> 7.5% -> 15625/15625
--   F-Shop 23: 1198000 consideration -> 798666.67 taxable -> 7.5% -> 29950/29950
UPDATE public.builder_receipts
  SET rate_code = 'COMMERCIAL_RREP', rate_pct = 7.5, cgst = 15625.00, sgst = 15625.00
  WHERE id = 'eb8aa9c4-b19e-48cb-9498-2503d76afe0e';

UPDATE public.builder_receipts
  SET rate_code = 'COMMERCIAL_RREP', rate_pct = 7.5, cgst = 29950.00, sgst = 29950.00
  WHERE id = 'ce93a2a9-38e3-4583-878e-08c15b83c1f6';

-- ── 3. Remove the now-redundant auto-reclassification for these two units ──
-- Cascades to builder_reclassification_periods. Must run BEFORE the unique
-- constraint below, since both units currently carry duplicate rows.
DELETE FROM public.builder_reclassifications
  WHERE unit_id IN ('637a5e69-4f1d-4a6b-8e48-1497d1957125', 'a98ac530-abba-48c4-b474-36c1f1d77680');

-- ── 4. Guard: no two POSTED reclassifications for the same unit ─────────────
-- Idempotent against 20260811120000 having already added this, whichever
-- migration lands first.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'builder_reclassifications_unit_id_unique'
  ) THEN
    ALTER TABLE public.builder_reclassifications
      ADD CONSTRAINT builder_reclassifications_unit_id_unique UNIQUE (unit_id);
  END IF;
END $$;
