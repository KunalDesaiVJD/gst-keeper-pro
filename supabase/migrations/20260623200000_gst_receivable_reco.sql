-- New "GST Receivable Reconciliation" tab inside the 2B Reconciliation page.
-- Mirrors the suspended_reco shape but for the Electronic Credit Ledger (input
-- ITC), reconciling portal closing balance vs books closing balance.
--
-- Only the *manual* inputs are persisted here. The four auto-fetched rows
-- (ITC Availed / Utilized / Reversed / Reclaimed) are computed live in the
-- page from itc_summaries + gstr1_data, so they auto-refresh whenever those
-- source tables change.

BEGIN;

CREATE TABLE IF NOT EXISTS public.gst_receivable_reco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,

  -- Opening balance (portal) — same source-tracking model as suspended_reco
  opening_cgst numeric DEFAULT 0,
  opening_sgst numeric DEFAULT 0,
  opening_igst numeric DEFAULT 0,
  opening_source text NOT NULL DEFAULT 'manual',
  opening_csv_period_month text,
  opening_csv_uploaded_at timestamptz,
  opening_csv_uploaded_by uuid,
  opening_override_justification text,
  opening_override_at timestamptz,
  opening_override_by uuid,

  -- Manually entered closing balance per books
  books_closing_cgst numeric DEFAULT 0,
  books_closing_sgst numeric DEFAULT 0,
  books_closing_igst numeric DEFAULT 0,

  updated_by uuid,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT gst_receivable_reco_client_period_unique UNIQUE (client_id, period_month)
);

ALTER TABLE public.gst_receivable_reco
  DROP CONSTRAINT IF EXISTS gst_receivable_reco_opening_source_check;
ALTER TABLE public.gst_receivable_reco
  ADD CONSTRAINT gst_receivable_reco_opening_source_check
    CHECK (opening_source IN ('manual', 'csv', 'not_applicable'));

ALTER TABLE public.gst_receivable_reco ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view gst_receivable_reco" ON public.gst_receivable_reco;
CREATE POLICY "Anyone can view gst_receivable_reco"
  ON public.gst_receivable_reco
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Staff can manage gst_receivable_reco" ON public.gst_receivable_reco;
CREATE POLICY "Staff can manage gst_receivable_reco"
  ON public.gst_receivable_reco
  FOR ALL USING (true) WITH CHECK (true);

COMMIT;
