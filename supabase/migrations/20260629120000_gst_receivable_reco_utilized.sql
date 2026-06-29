-- Persist the per-head ITC actually utilized from the Electronic Credit Ledger
-- CSV's M-1 Debit row, so the page's "Closing per Portal" tallies with the
-- portal exactly. Cross-head set-off (IGST credit paying CGST/SGST liability)
-- can't be derived from GSTR-1 output alone, so we read it from the credit
-- ledger itself at upload time.
--
-- Columns are nullable so old rows uploaded before this migration keep
-- working — the page falls back to the GSTR-1 estimate when these are NULL.

BEGIN;

ALTER TABLE public.gst_receivable_reco
  ADD COLUMN IF NOT EXISTS utilized_cgst numeric,
  ADD COLUMN IF NOT EXISTS utilized_sgst numeric,
  ADD COLUMN IF NOT EXISTS utilized_igst numeric;

COMMIT;
