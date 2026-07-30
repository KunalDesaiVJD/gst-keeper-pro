-- GST Receivable Reco: persist DRC-03 / other credit-ledger debits (demand,
-- appeal, interest, penalty paid THROUGH the Electronic Credit Ledger). These
-- reduce the closing balance alongside the monthly return set-off. Auto-detected
-- from the Credit Ledger CSV and manually editable on the page.

BEGIN;

ALTER TABLE public.gst_receivable_reco
  ADD COLUMN IF NOT EXISTS drc_cgst numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drc_sgst numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drc_igst numeric DEFAULT 0;

COMMIT;
