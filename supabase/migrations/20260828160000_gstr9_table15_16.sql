-- GSTR-9 Table 15 — "Particulars of Demands and Refunds" (portal roadmap,
-- 27 Aug 2026). Fixed 7-row grid (A-G: claimed/sanctioned/rejected/pending
-- refunds, then demand of taxes/taxes paid/demands pending), each split by
-- Central Tax, State/UT Tax, Integrated Tax, Cess, Interest, Penalty. No
-- dependency on any figure already computed elsewhere — standalone manual
-- entry, same fixed-row-grid convention as gstr9_table14_differential_tax.

CREATE TABLE IF NOT EXISTS public.gstr9_table15_demands_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  row_key text NOT NULL CHECK (row_key IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')),
  central_tax numeric NOT NULL DEFAULT 0,
  state_tax numeric NOT NULL DEFAULT 0,
  integrated_tax numeric NOT NULL DEFAULT 0,
  cess numeric NOT NULL DEFAULT 0,
  interest numeric NOT NULL DEFAULT 0,
  penalty numeric NOT NULL DEFAULT 0,
  entered_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, row_key)
);

ALTER TABLE public.gstr9_table15_demands_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gstr9_table15_demands_refunds_all" ON public.gstr9_table15_demands_refunds
  FOR ALL TO public USING (true) WITH CHECK (true);

-- GSTR-9 Table 16 — "Supplies received from Composition taxpayers, deemed
-- supply under section 143 and goods sent on approval basis". Fixed 3-row
-- grid (A: composition supplies, B: deemed supply u/s 143, C: goods sent on
-- approval not returned), each with Taxable Value plus Central/State/
-- Integrated Tax and Cess. Standalone manual entry, same convention.

CREATE TABLE IF NOT EXISTS public.gstr9_table16_composition_deemed_approval (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  row_key text NOT NULL CHECK (row_key IN ('A', 'B', 'C')),
  taxable_value numeric NOT NULL DEFAULT 0,
  central_tax numeric NOT NULL DEFAULT 0,
  state_tax numeric NOT NULL DEFAULT 0,
  integrated_tax numeric NOT NULL DEFAULT 0,
  cess numeric NOT NULL DEFAULT 0,
  entered_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, row_key)
);

ALTER TABLE public.gstr9_table16_composition_deemed_approval ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gstr9_table16_composition_deemed_approval_all" ON public.gstr9_table16_composition_deemed_approval
  FOR ALL TO public USING (true) WITH CHECK (true);
