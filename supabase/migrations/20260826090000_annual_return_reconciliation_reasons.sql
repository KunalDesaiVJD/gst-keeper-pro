-- Phase 3 of the Annual Return roadmap: the reconciliation engine's audit
-- trail. Books/portal values themselves are never stored here — they're
-- always computed fresh from books_turnover_lines / books_purchase_lines /
-- gst_filed_returns, so a reason can never end up attached to a stale
-- number. This table holds only the one thing that needs to survive and be
-- attributable: the explanation for a gap, and who wrote it, when.
--
-- One current reason per (client, FY, line) — not a full multi-entry
-- history yet; upsert on edit. line_key values in use today: 'outward_tax',
-- 'itc_claimed', 'itc_2b_vs_claimed'.

CREATE TABLE IF NOT EXISTS public.reconciliation_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  line_key text NOT NULL,
  reason text NOT NULL,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, line_key)
);

ALTER TABLE public.reconciliation_reasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reconciliation_reasons_all" ON public.reconciliation_reasons
  FOR ALL TO public USING (true) WITH CHECK (true);
