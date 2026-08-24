-- Closes the gap R4 flagged in docs/GSTR9_9C_DATA_MODEL.md §7: GSTR-9
-- Table 7's rule-wise ITC reversals (Rule 37/37A/38/39/42/43, and s.17(5)
-- ineligible ITC) had no table anywhere in the schema. Needed before Table
-- 7 and GSTR 9C Table 14 can be assembled for real in R6.

CREATE TABLE IF NOT EXISTS public.itc_reversal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  rule text NOT NULL CHECK (rule IN ('37', '37A', '38', '39', '42', '43', '17_5')),
  igst numeric NOT NULL DEFAULT 0,
  cgst numeric NOT NULL DEFAULT 0,
  sgst numeric NOT NULL DEFAULT 0,
  notes text,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, rule)
);

ALTER TABLE public.itc_reversal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "itc_reversal_lines_all" ON public.itc_reversal_lines
  FOR ALL TO public USING (true) WITH CHECK (true);
