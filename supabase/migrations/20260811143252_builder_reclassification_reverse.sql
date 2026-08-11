-- Lets a POSTED reclassification be reversed (e.g. it was triggered by a
-- charge that itself turned out to be a mistake and was removed minutes
-- later). Reversal is a status change, never a delete — "the trail matters"
-- (per the credit-notes position, §11 of BUILDER_GST_POSITIONS.md), and every
-- builder_period_postings branch that reads builder_reclassifications already
-- filters `WHERE rc.status = 'POSTED'`, so a REVERSED row drops out of the
-- return automatically — no view change needed.
--
-- This does NOT touch builder_receipts/builder_invoices rows whose own
-- rate_code may have been rewritten in place by an edit made while the unit
-- was locked at the higher rate (handleSaveReceipt/handleSaveInvoice rewrite
-- the derived tax on every save). Reconstructing "what it was before" from
-- builder_reclassification_periods is not reliable enough to automate, so
-- the reverse action instead surfaces which periods/receipts need a manual
-- check — see reverseReclassification() in builderAdjustmentsData.ts.

ALTER TABLE public.builder_reclassifications
  DROP CONSTRAINT IF EXISTS builder_reclassifications_status_check;

ALTER TABLE public.builder_reclassifications
  ADD CONSTRAINT builder_reclassifications_status_check
  CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED'));

ALTER TABLE public.builder_reclassifications
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text;

COMMENT ON COLUMN public.builder_reclassifications.status IS
  'DRAFT: scheduled, not yet posted to Table 10. POSTED: live, locks the unit at to_rate_code per the no-downgrade position (§8). REVERSED: voided — excluded from builder_period_postings, unit''s live classification governs again.';
