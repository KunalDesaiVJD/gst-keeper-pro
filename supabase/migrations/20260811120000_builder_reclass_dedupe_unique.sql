-- Fixes a confirmed live double-posting: autoReclassifyProject() checks
-- "does this unit already have a reclassification row?" and only then
-- inserts — with no DB-level guard, two near-simultaneous callers (it fires
-- from the Bookings page load, the Adjustments page load, and Builder
-- Returns' Generate step) can both read "no" before either write lands, and
-- both insert. Found live on builder_units F-Shop 22 and F-Shop 23
-- (SWENI CORPORATION), each carrying two identical builder_reclassifications
-- rows ~30-80ms apart, doubling their Table 10 differential tax and s.50
-- interest. Confirmed isolated to these two units across every builder
-- client in the database.
--
-- The application code already treats "any existing row for this unit_id"
-- as "already handled, never re-trigger" (see autoReclassifyProject's
-- `done` set) — a unit is only ever re-rated once, by design (BUILDER_GST_
-- POSITIONS.md §8: "No downgrade"). So a UNIQUE constraint on unit_id
-- matches the code's own already-encoded invariant exactly, and turns the
-- race's losing side into a caught, toasted error (every call site already
-- wraps this in try/catch; the Adjustments page's catch even re-surfaces
-- the candidate for manual posting) instead of a silent duplicate.

-- ── 1. Dedupe: keep the earliest row per unit, drop the rest ────────────────
-- Cascades to builder_reclassification_periods (ON DELETE CASCADE), which is
-- what builder_period_postings' RECLASS_10_OLD/RECLASS_10_NEW legs read from,
-- so this alone corrects the doubled Table 10 amendment.
DELETE FROM public.builder_reclassifications rc
WHERE rc.id NOT IN (
  SELECT DISTINCT ON (unit_id) id
  FROM public.builder_reclassifications
  ORDER BY unit_id, created_at ASC, id ASC
);

-- ── 2. Close the race ────────────────────────────────────────────────────────
ALTER TABLE public.builder_reclassifications
  ADD CONSTRAINT builder_reclassifications_unit_id_unique UNIQUE (unit_id);
