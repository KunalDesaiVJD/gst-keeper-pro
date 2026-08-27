-- GSTR-9C Table 5 — "Reconciliation of Gross Turnover" (verified against the
-- real GSTR_9C_Offline_Utility.xlsm v2.8, sheet "PT II (5)", 27 Aug 2026).
-- Fixed row grid A-O + Q, single "Amount" column per row, matching the
-- offline utility exactly. P (adjusted turnover) and R (unreconciled) are
-- formula cells in the real sheet — computed in the app, never stored.
-- Q ("Turnover as declared in Annual Return GSTR9") is a mandatory manual
-- field in the real utility (not auto-derived even there) — kept manual
-- here too rather than linked to this app's existing GSTR-9 Table 4/5
-- view, whose "Value" column sums only igst+cgst+sgst (a tax total, not a
-- turnover total) and would silently corrupt this reconciliation.

CREATE TABLE IF NOT EXISTS public.gstr9c_table5_turnover_reco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  row_key text NOT NULL CHECK (row_key IN ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'Q')),
  amount numeric NOT NULL DEFAULT 0,
  entered_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, row_key)
);

ALTER TABLE public.gstr9c_table5_turnover_reco ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gstr9c_table5_turnover_reco_all" ON public.gstr9c_table5_turnover_reco
  FOR ALL TO public USING (true) WITH CHECK (true);

-- GSTR-9C Table 7 — "Reconciliation of Taxable Turnover" (sheet "PT II (7)").
-- A is a formula in the real sheet (='PT II (5)'!H21, i.e. Table 5's P) —
-- computed in the app from gstr9c_table5_turnover_reco, never stored here.
-- E and G are formula cells too. B, C, D, D1, F are the real sheet's manual
-- entries (F is "Taxable turnover as per liability declared in Annual
-- Return (GSTR9)*" — mandatory manual even in the government tool, for the
-- same reason Table 5's Q is kept manual above).

CREATE TABLE IF NOT EXISTS public.gstr9c_table7_taxable_turnover_reco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  row_key text NOT NULL CHECK (row_key IN ('B', 'C', 'D', 'D1', 'F')),
  amount numeric NOT NULL DEFAULT 0,
  entered_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, row_key)
);

ALTER TABLE public.gstr9c_table7_taxable_turnover_reco ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gstr9c_table7_taxable_turnover_reco_all" ON public.gstr9c_table7_taxable_turnover_reco
  FOR ALL TO public USING (true) WITH CHECK (true);
