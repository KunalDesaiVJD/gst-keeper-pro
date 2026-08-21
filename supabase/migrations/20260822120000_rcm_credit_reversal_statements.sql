-- Electronic Credit Reversal and Re-claimed Statement, and RCM Liability/ITC
-- Statement — both REAL, portal-native features (Dashboard Quick Links under
-- Services > Ledger), NOT this app's own reconciliation estimate. Confirmed
-- live 2026-08-22 against return.gst.gov.in's own internalapi:
--
--   GET /returns/auth/internalapi/getRevRclmDetls?fdate=DD/MM/YYYY&tdate=DD/MM/YYYY
--     -> { opnbal, clsbal, tr: [ { trandt, refno, rtnprd, desc,
--          itc4a5 (Table 4A(5), "All Other ITC" claimed),
--          itc4b2 (Table 4B(2), ITC reversed — eligible to re-claim),
--          itc4d1 (Table 4D(1), ITC re-claimed), clsbal } ] }
--
--   GET /returns/auth/internalapi/getRcmDetls?fdate=DD/MM/YYYY&tdate=DD/MM/YYYY
--     -> { opnbal, tr: [ { trandt, refno, rtnprd, desc,
--          inwardsup_3_1d (Table 3.1(d), RCM liability paid),
--          itc4a2 (Table 4A(2), import of services — IGST/Cess only; RCM on
--            imports is always IGST under the IGST Act, so this head never
--            carries CGST/SGST on the portal's own response either),
--          itc4a3 (Table 4A(3), RCM ITC on all other inward supplies),
--          clsbal } ] }
--
-- Both accept an arbitrary date range in ONE call — unlike the per-month
-- Liability/Cash Ledger pulls (gst_liability_ledger_entries /
-- gst_cash_ledger_entries), the extension pulls a client's WHOLE financial
-- year in a single job. Replace-on-pull is scoped to (client_id,
-- financial_year), not (client_id, period_month).
CREATE TABLE IF NOT EXISTS public.gst_credit_reversal_reclaim_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,          -- '2026-2027'
  is_opening_balance boolean NOT NULL DEFAULT false,
  return_period text,                    -- MM/YYYY; null for the opening-balance row
  transaction_date date,
  reference_no text,
  description text,
  itc_claimed_igst numeric, itc_claimed_cgst numeric, itc_claimed_sgst numeric, itc_claimed_cess numeric,       -- Table 4A(5)
  itc_reversed_igst numeric, itc_reversed_cgst numeric, itc_reversed_sgst numeric, itc_reversed_cess numeric,   -- Table 4B(2)
  itc_reclaimed_igst numeric, itc_reclaimed_cgst numeric, itc_reclaimed_sgst numeric, itc_reclaimed_cess numeric, -- Table 4D(1)
  closing_balance_igst numeric, closing_balance_cgst numeric, closing_balance_sgst numeric, closing_balance_cess numeric,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gst_credit_reversal_reclaim_client_fy
  ON public.gst_credit_reversal_reclaim_entries (client_id, financial_year);

CREATE TABLE IF NOT EXISTS public.gst_rcm_liability_itc_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  is_opening_balance boolean NOT NULL DEFAULT false,
  return_period text,
  transaction_date date,
  reference_no text,
  description text,
  liability_3_1d_igst numeric, liability_3_1d_cgst numeric, liability_3_1d_sgst numeric, liability_3_1d_cess numeric, -- Table 3.1(d)
  itc_4a2_igst numeric, itc_4a2_cess numeric,                                                                        -- Table 4A(2), import of services (IGST/Cess only)
  itc_4a3_igst numeric, itc_4a3_cgst numeric, itc_4a3_sgst numeric, itc_4a3_cess numeric,                            -- Table 4A(3)
  closing_balance_igst numeric, closing_balance_cgst numeric, closing_balance_sgst numeric, closing_balance_cess numeric,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gst_rcm_liability_itc_client_fy
  ON public.gst_rcm_liability_itc_entries (client_id, financial_year);

ALTER TABLE public.gst_credit_reversal_reclaim_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gst_rcm_liability_itc_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gst_credit_reversal_reclaim_entries_all" ON public.gst_credit_reversal_reclaim_entries FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "gst_rcm_liability_itc_entries_all" ON public.gst_rcm_liability_itc_entries FOR ALL TO public USING (true) WITH CHECK (true);
