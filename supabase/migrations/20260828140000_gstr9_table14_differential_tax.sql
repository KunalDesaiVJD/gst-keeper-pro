-- GSTR-9 Table 14 — "Differential tax paid on account of declaration in
-- table no. 10 & 11" (portal roadmap, 27 Aug 2026). Table 10-13 already
-- lives in annual_return_carry_forward (Annexure 4); this is the payable/
-- paid tracking for the tax that results from those declarations. Fixed
-- 5-row set (igst/cgst/sgst/cess/interest), matching the real portal table
-- and the same fixed-row-grid convention as itc_reversal_lines.

CREATE TABLE IF NOT EXISTS public.gstr9_table14_differential_tax (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  tax_head text NOT NULL CHECK (tax_head IN ('igst', 'cgst', 'sgst', 'cess', 'interest')),
  payable numeric NOT NULL DEFAULT 0,
  paid numeric NOT NULL DEFAULT 0,
  entered_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, tax_head)
);

ALTER TABLE public.gstr9_table14_differential_tax ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gstr9_table14_differential_tax_all" ON public.gstr9_table14_differential_tax
  FOR ALL TO public USING (true) WITH CHECK (true);
