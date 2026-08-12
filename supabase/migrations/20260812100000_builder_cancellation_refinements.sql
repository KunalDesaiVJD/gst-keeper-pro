-- Three refinements to booking cancellation, per firm review:
--
-- 1. A credit note raised for a cancellation should reference the actual
--    original document(s) it reverses — the milestone invoice(s) already
--    absorbed against the booking's receipts (via builder_advance_
--    adjustments), or the receipt voucher(s) themselves when nothing was
--    ever invoiced. Auto-derived from data the app already has, not typed
--    by hand — see cancelBooking() in src/lib/builderCancellationData.ts,
--    which builds this list before calling raiseCreditNote().
--
-- 2. A third correction method: refund the member in cash, with NO GST
--    correction attempted at all — no credit note, no set-off against a
--    later month's Table 11A pool. The firm simply absorbs the tax already
--    paid. Named 'NONE' to match this app's existing 'ABSORB' precedent
--    (builder_excess_tax.treatment) in spirit.

ALTER TABLE public.builder_credit_notes
  ADD COLUMN IF NOT EXISTS original_documents jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.builder_credit_notes.original_documents IS
  'Auto-derived list of the actual invoice(s)/receipt voucher(s) this note reverses: '
  '[{doc_type: INVOICE|RECEIPT, doc_no, doc_date, amount}, ...]. Never manually typed.';

ALTER TABLE public.builder_cancellations DROP CONSTRAINT IF EXISTS builder_cancellations_correction_method_check;
ALTER TABLE public.builder_cancellations ADD CONSTRAINT builder_cancellations_correction_method_check
  CHECK (correction_method IN ('CREDIT_NOTE', 'SETOFF', 'NONE'));
