-- GST Receivable Reco: persist the ITC actually utilized (per head) when it is
-- pulled from the Electronic Credit Ledger CSV. The page reads these back to
-- decide whether to use the exact portal debit (utilizedFromCsv) or fall back
-- to the estimated GSTR-3B output. They were referenced in code but never added
-- to the table, so the CSV upload failed with "Could not find the
-- 'utilized_cgst' column ... in the schema cache".

BEGIN;

ALTER TABLE public.gst_receivable_reco
  ADD COLUMN IF NOT EXISTS utilized_cgst numeric,
  ADD COLUMN IF NOT EXISTS utilized_sgst numeric,
  ADD COLUMN IF NOT EXISTS utilized_igst numeric;

COMMIT;
