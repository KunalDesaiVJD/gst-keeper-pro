-- GSTR-9C Table 12 — "Reconciliation of Net Input Tax Credit (ITC)"
-- (portal roadmap, 27 Aug 2026, verified against GSTR 9C_Offline_Utility.xlsm
-- v2.8's "PT IV (12)" sheet). A 3-figure manual entry, single row per
-- client+FY: A (ITC per audited financials), B (ITC booked in an earlier FY,
-- claimed this FY), C (ITC booked this FY, to be claimed in a later FY).
-- D=A+B-C, E (ITC claimed in GSTR-9) and F=E-D are computed, not stored.
--
-- This is distinct from the view previously and incorrectly labelled
-- "Table 12B" (src/components/annualReturn/Gstr9cTable12bView.tsx), which
-- is actually the per-expense-head breakdown that belongs to Table 14, not
-- Table 12 — corrected in the same pass as this migration.

CREATE TABLE IF NOT EXISTS public.gstr9c_table12_net_itc (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  itc_per_financials numeric NOT NULL DEFAULT 0,
  itc_earlier_fy_claimed_this_fy numeric NOT NULL DEFAULT 0,
  itc_this_fy_claimed_later_fy numeric NOT NULL DEFAULT 0,
  entered_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year)
);

ALTER TABLE public.gstr9c_table12_net_itc ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gstr9c_table12_net_itc_all" ON public.gstr9c_table12_net_itc
  FOR ALL TO public USING (true) WITH CHECK (true);
