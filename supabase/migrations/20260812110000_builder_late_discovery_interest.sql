-- A dastavej/BU shortfall discovered long after the fact, where the buyer
-- kept paying and each payment was already taxed normally as an ordinary
-- Table 11A advance in its own month. Posting the full shortfall as a fresh
-- differential at discovery would tax that money twice — see
-- computeLateDiscoveryInterest() in src/utils/builderBuEvent.ts. This table
-- is the working paper: the shortfall as of the cut-off, the later
-- ordinary-advance tranches allocated against it, and the s.50 interest
-- priced on each — a record only, since interest here is settled by
-- voluntary payment on the portal, the same as the DRC-03 re-rating
-- interest, never through GSTR-1/3B.

CREATE TABLE IF NOT EXISTS public.builder_dastavej_late_interest (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id               uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  project_id            uuid NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,
  dastavej_date         date NOT NULL,
  cut_off_period        text NOT NULL,
  rate_code             text NOT NULL,
  shortfall_value       numeric NOT NULL DEFAULT 0,
  tranches              jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_allocated       numeric NOT NULL DEFAULT 0,
  total_interest        numeric NOT NULL DEFAULT 0,
  residual_unrecovered  numeric NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'COMPUTED' CHECK (status IN ('COMPUTED', 'PAID')),
  paid_date             date,
  arn                   text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid
);
CREATE INDEX IF NOT EXISTS idx_builder_late_interest_unit ON public.builder_dastavej_late_interest(unit_id);
CREATE INDEX IF NOT EXISTS idx_builder_late_interest_project ON public.builder_dastavej_late_interest(project_id);

ALTER TABLE public.builder_dastavej_late_interest ENABLE ROW LEVEL SECURITY;
CREATE POLICY builder_dastavej_late_interest_all ON public.builder_dastavej_late_interest
  FOR ALL TO public USING (true) WITH CHECK (true);
