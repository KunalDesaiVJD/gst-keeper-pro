-- Widens gst_drc03_filings from a cash/credit summary to the full detail the
-- firm asked for: section, financial year, per-head tax (IGST/CGST/SGST/
-- Cess), interest, late fee, penalty, and a saved copy of the DRC-03 PDF.
-- Source is litserv/auth/api/case/search (caseTypeCd=ADJVP) — one filing
-- (case) can carry several liability-detail lines (one per head x period),
-- so these are FILING-LEVEL SUMS across all of a case's lines, not a single
-- line's figures. period_from/period_to already followed the same
-- across-all-lines min/max convention.

ALTER TABLE public.gst_drc03_filings
  ADD COLUMN IF NOT EXISTS financial_year text,
  ADD COLUMN IF NOT EXISTS section text,               -- comma-joined unique section refs, e.g. "17(5)"
  ADD COLUMN IF NOT EXISTS taxable_value numeric,       -- sum of each line's tax-value base (portal's "tx")
  ADD COLUMN IF NOT EXISTS igst_amount numeric,
  ADD COLUMN IF NOT EXISTS cgst_amount numeric,
  ADD COLUMN IF NOT EXISTS sgst_amount numeric,
  ADD COLUMN IF NOT EXISTS cess_amount numeric,
  ADD COLUMN IF NOT EXISTS interest_amount numeric,
  ADD COLUMN IF NOT EXISTS late_fee_amount numeric,
  ADD COLUMN IF NOT EXISTS penalty_amount numeric,
  ADD COLUMN IF NOT EXISTS pdf_url text;
