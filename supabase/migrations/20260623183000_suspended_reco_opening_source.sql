-- Track the source of the OPENING BALANCE AS PER PORTAL row in suspended_reco:
-- 'manual'         => legacy / pre-Jun-26 behavior; user typed the value directly
-- 'csv'            => derived from an uploaded GST Electronic Credit Reversal CSV
-- 'not_applicable' => user explicitly marked this period as N/A; zeros are intentional
--
-- When a row's source is 'csv' or 'not_applicable', a staff user may layer a
-- manual override on top with a justification >= 20 characters. Override fields
-- record who did it and why, so the info popover on the page can show provenance.

BEGIN;

ALTER TABLE public.suspended_reco
  ADD COLUMN IF NOT EXISTS opening_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS opening_csv_period_month text,
  ADD COLUMN IF NOT EXISTS opening_csv_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS opening_csv_uploaded_by uuid,
  ADD COLUMN IF NOT EXISTS opening_override_justification text,
  ADD COLUMN IF NOT EXISTS opening_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS opening_override_by uuid;

ALTER TABLE public.suspended_reco
  DROP CONSTRAINT IF EXISTS suspended_reco_opening_source_check;
ALTER TABLE public.suspended_reco
  ADD CONSTRAINT suspended_reco_opening_source_check
    CHECK (opening_source IN ('manual', 'csv', 'not_applicable'));

COMMIT;
