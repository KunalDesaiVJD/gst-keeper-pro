-- GSTR-3B Adjustments module: a place to record corrections that legitimately
-- belong in a given month's GSTR-3B but don't come from GSTR-1 / ITC Summary /
-- RCM for that same period — e.g. a GSTR-1A amendment filed after GSTR-1, or a
-- prior-period output-tax effect being trued up in the current month. These
-- rows are NOT blended into buildGstr3bJson's auto-computed totals; they are
-- surfaced as a separate, auditable line so the draft never silently drifts
-- from what GSTR-1/ITC/RCM actually contain.
--
-- 'GSTR-1A' also needs to exist as a return_type so its filing can be tracked
-- on the same filing_status table as every other return.

ALTER TYPE public.return_type ADD VALUE IF NOT EXISTS 'GSTR-1A';

BEGIN;

CREATE TABLE IF NOT EXISTS public.gstr3b_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,        -- "MM/YYYY", matches MonthContext / filing_status
  table_ref text NOT NULL,           -- e.g. '3.1(a)', '3.1(d)', '4A(5)', '4B(1)'
  label text NOT NULL,
  source text NOT NULL DEFAULT 'Manual', -- 'Manual' | 'GSTR-1A' | 'Prior Period'
  taxable_value numeric NOT NULL DEFAULT 0,
  igst numeric NOT NULL DEFAULT 0,
  cgst numeric NOT NULL DEFAULT 0,
  sgst numeric NOT NULL DEFAULT 0,
  cess numeric NOT NULL DEFAULT 0,
  reason text NOT NULL,
  created_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS gstr3b_adjustments_lookup_idx
  ON public.gstr3b_adjustments (client_id, period_month);

ALTER TABLE public.gstr3b_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can manage gstr3b adjustments"
  ON public.gstr3b_adjustments;
CREATE POLICY "Anyone can manage gstr3b adjustments"
  ON public.gstr3b_adjustments
  FOR ALL TO public USING (true) WITH CHECK (true);

COMMIT;
