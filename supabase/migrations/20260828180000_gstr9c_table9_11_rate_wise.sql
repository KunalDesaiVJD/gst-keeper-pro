-- GSTR-9C Table 9 — "Reconciliation of rate wise liability and amount
-- payable thereon" (verified against GSTR_9C_Offline_Utility.xlsm v2.8,
-- sheet "PT III (9)", 27 Aug 2026). Fixed 20-rate-slab row grid (A-O,
-- including the RC variants, 40% slab, and the e-commerce 9(5) row) plus
-- a 'Q' pseudo-row for "Total amount payable as declared in Annual Return
-- (GSTR9)". P (sum A-O) and R (Q-P) are formula cells in the real sheet —
-- computed in the app, never stored. Q is kept manual, same reasoning as
-- Table 5's Q / Table 7's F: this app has no rate-wise breakdown of its
-- own GSTR-9 Table 9 tax-paid figures to link to.

CREATE TABLE IF NOT EXISTS public.gstr9c_table9_rate_wise_liability_reco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  row_key text NOT NULL CHECK (row_key IN (
    'A', 'B', 'B1', 'C', 'D', 'E', 'F', 'G', 'H', 'H1', 'H2', 'I', 'J', 'K', 'K1', 'K2',
    'L', 'M', 'N', 'O', 'Q'
  )),
  taxable_value numeric NOT NULL DEFAULT 0,
  central_tax numeric NOT NULL DEFAULT 0,
  state_tax numeric NOT NULL DEFAULT 0,
  integrated_tax numeric NOT NULL DEFAULT 0,
  cess numeric NOT NULL DEFAULT 0,
  entered_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, row_key)
);

ALTER TABLE public.gstr9c_table9_rate_wise_liability_reco ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gstr9c_table9_rate_wise_liability_reco_all" ON public.gstr9c_table9_rate_wise_liability_reco
  FOR ALL TO public USING (true) WITH CHECK (true);

-- GSTR-9C Table 11 — "Additional amount payable but not paid (due to
-- reasons specified under Tables 6, 8 and 10 above)" (sheet "PT III (11)").
-- Entirely manual, no formula cells in the real sheet — this table IS the
-- auditor's answer, not a reconciliation of something else. Fixed
-- 15-rate-slab row grid (A-K, including the 40% slab and e-commerce 9(5)),
-- column labelled "Paid through Cash/ITC" rather than "Tax payable".

CREATE TABLE IF NOT EXISTS public.gstr9c_table11_additional_liability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  row_key text NOT NULL CHECK (row_key IN ('A', 'A1', 'B', 'C', 'D', 'D1', 'E', 'F', 'G', 'G1', 'G2', 'H', 'I', 'J', 'K')),
  taxable_value numeric NOT NULL DEFAULT 0,
  central_tax numeric NOT NULL DEFAULT 0,
  state_tax numeric NOT NULL DEFAULT 0,
  integrated_tax numeric NOT NULL DEFAULT 0,
  cess numeric NOT NULL DEFAULT 0,
  entered_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, row_key)
);

ALTER TABLE public.gstr9c_table11_additional_liability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gstr9c_table11_additional_liability_all" ON public.gstr9c_table11_additional_liability
  FOR ALL TO public USING (true) WITH CHECK (true);
