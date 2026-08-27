-- GSTR-9C Table 16 — "Tax payable on un-reconciled difference in ITC (due
-- to reasons specified in Tables 13 & 15 above)" (verified against
-- GSTR_9C_Offline_Utility.xlsm v2.8, sheet "PT IV (16)", 27 Aug 2026).
-- Fixed 6-row grid, single "Amount payable" column, entirely manual — like
-- Table 11, this table IS the auditor's answer, not a reconciliation.

CREATE TABLE IF NOT EXISTS public.gstr9c_table16_tax_payable_unreconciled_itc (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  row_key text NOT NULL CHECK (row_key IN ('A', 'B', 'C', 'D', 'E', 'F')),
  amount numeric NOT NULL DEFAULT 0,
  entered_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, row_key)
);

ALTER TABLE public.gstr9c_table16_tax_payable_unreconciled_itc ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gstr9c_table16_tax_payable_unreconciled_itc_all" ON public.gstr9c_table16_tax_payable_unreconciled_itc
  FOR ALL TO public USING (true) WITH CHECK (true);
