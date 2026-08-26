-- Closes a critical gap the UX audit found in Annexure3Card.tsx (25 Aug
-- 2026 audit): the DRC-03 pre-calculation's bold "Total" silently excluded
-- "Any other payment" because no entry surface existed for it anywhere —
-- it was hard-coded to zero. This gives it a real, persisted manual field,
-- at the same single-figure-per-client-per-FY granularity the card's other
-- three rows (Clause 9 diff, RCM to be paid, Excess ITC) already use.

CREATE TABLE IF NOT EXISTS public.annexure3_other_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  notes text,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year)
);

ALTER TABLE public.annexure3_other_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "annexure3_other_payments_all" ON public.annexure3_other_payments
  FOR ALL TO public USING (true) WITH CHECK (true);
