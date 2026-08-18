-- Client-level annual turnover data — the one piece of data Phase 4 (interest
-- & ITC-reversal scrutiny) needs that nothing else in the schema tracks.
-- Two things read this:
--   1. Late fee slab under s.47 (the cap tier depends on aggregate turnover).
--   2. Rule 42 ITC-reversal ratio (exempt turnover / aggregate turnover).
-- See docs/INTEREST_LATE_FEE_POSITIONS.md for exactly how these are used and
-- why this is entered by hand rather than derived — the app has no turnover
-- figure anywhere else to derive it from.

CREATE TABLE IF NOT EXISTS public.client_annual_turnover (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,               -- e.g. "2026-27"
  aggregate_turnover numeric,                 -- whole-entity turnover, for the s.47 late-fee slab
  exempt_turnover numeric,                    -- Rule 42 numerator (exempt + nil-rated + non-GST outward supply)
  itc_directly_attributable_exempt numeric,   -- optional Rule 42 "T1" — ITC used exclusively for exempt supplies, nets out of common credit before the ratio is applied
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year)
);

ALTER TABLE public.client_annual_turnover ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_annual_turnover_all" ON public.client_annual_turnover
  FOR ALL TO public USING (true) WITH CHECK (true);
