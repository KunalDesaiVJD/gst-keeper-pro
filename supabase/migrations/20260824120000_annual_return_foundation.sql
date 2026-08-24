-- Foundation for GSTR-9 / GSTR-9C annual return preparation (Phase 0 of the
-- Annual Return roadmap). This migration adds only the anchor the rest of
-- the module builds on:
--   1. GSTR-9 / GSTR-9C as recognised return types, so filing_status and
--      clients.selected_returns can track them like every other return.
--   2. annual_return_periods — one row per (client, financial_year), holding
--      prep/lock state. This is the "is this year ready to file" anchor;
--      the actual working-paper data (books entries, portal figures,
--      reconciliation lines) lands in later migrations as each phase ships.
--
-- Note: a per-client "no-ITC scheme" flag is NOT added here — clients.
-- builder_itc_type ('NO_ITC' | 'CLAIM_ITC' | 'PARTIAL_ITC', for
-- regular_sub_type = 'Builder') already carries this. The reconciliation
-- engine (a later phase) reads that existing column rather than duplicating
-- it.

ALTER TYPE public.return_type ADD VALUE IF NOT EXISTS 'GSTR-9';
ALTER TYPE public.return_type ADD VALUE IF NOT EXISTS 'GSTR-9C';

CREATE TABLE IF NOT EXISTS public.annual_return_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,                 -- e.g. "2025-26"
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'locked')),
  prepared_by uuid,
  reviewed_by uuid,
  locked_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year)
);

ALTER TABLE public.annual_return_periods ENABLE ROW LEVEL SECURITY;

-- No Supabase Auth session exists at runtime (auth.uid() is always null) —
-- gate access at the app layer, same as every other table in this project.
CREATE POLICY "annual_return_periods_all" ON public.annual_return_periods
  FOR ALL TO public USING (true) WITH CHECK (true);
