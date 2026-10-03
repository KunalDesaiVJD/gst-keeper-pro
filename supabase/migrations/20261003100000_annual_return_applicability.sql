-- Annual Return (GSTR-9 / GSTR-9C) applicability register.
--
-- The register lists every client for a financial year with its aggregate
-- turnover (client_annual_turnover.aggregate_turnover — the same figure the
-- late-fee slab reads, typed once) and decides who files GSTR-9 and 9C
-- (src/lib/gstr9/applicability.ts):
--   * GSTR-9 is required above ₹2 crore of aggregate turnover; up to ₹2 crore
--     it is exempt (Notification 15/2025-CT from FY 2024-25; year-wise
--     notifications before), and is prepared only if the client wishes;
--   * GSTR-9C is required above ₹5 crore (rule 80(3)); below that only if
--     the client wishes.
-- These columns hold the client's wish for a year that is exempt, and a note.

ALTER TABLE public.client_annual_turnover
  ADD COLUMN IF NOT EXISTS gstr9_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gstr9c_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS applicability_note text,
  ADD COLUMN IF NOT EXISTS updated_by_name text;

COMMENT ON COLUMN public.client_annual_turnover.gstr9_opt_in IS
  'GSTR-9 is exempt for this year (aggregate turnover up to the threshold) but the client wishes it filed.';
COMMENT ON COLUMN public.client_annual_turnover.gstr9c_opt_in IS
  'GSTR-9C is not required for this year (aggregate turnover up to the threshold) but the client wishes it prepared.';

-- When each client's working for a year was last saved, and how many sheets
-- it has — the register's status column, in one request. security_invoker:
-- it reads annual_return_docs under that table's own (open) policies.
CREATE OR REPLACE VIEW public.annual_return_activity
WITH (security_invoker = true) AS
  SELECT client_id, financial_year, max(updated_at) AS last_saved_at, count(*)::int AS sheets
  FROM public.annual_return_docs
  GROUP BY client_id, financial_year;

GRANT SELECT ON public.annual_return_activity TO anon, authenticated;
