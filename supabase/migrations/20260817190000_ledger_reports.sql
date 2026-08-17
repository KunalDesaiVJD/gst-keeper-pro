-- Schema for the 3 remaining Ledger reports: Credit Ledger (full transaction
-- detail — distinct from the existing opening-balance-only Credit Ledger
-- reports), Liability Ledger, Cash Ledger.
--
-- gst_credit_ledger_transactions is HIGH confidence: it's populated by
-- extending handleLedger in content.js, which already visits
-- .../ledger/detailedledger and already scrapes every transaction row
-- (readLedgerRows(), proven in production for the ITC-utilised/DRC-03
-- classification on GST Receivable Reco) — this migration just persists
-- rows that scrape was already reading and discarding.
--
-- gst_liability_ledger_entries / gst_cash_ledger_entries are NOT wired to
-- any automation in this pass — the Electronic Liability Register and
-- Electronic Cash Ledger are portal pages this codebase has never visited,
-- with no proven code to mirror the way the credit ledger extension could
-- reuse readLedgerRows(). Same reasoning as Notices/Refund/DRC-03: schema
-- and reports first, automation only once someone verifies the real pages.

CREATE TABLE IF NOT EXISTS public.gst_credit_ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,        -- MM/YYYY
  is_debit boolean NOT NULL,
  description text,
  igst numeric,
  cgst numeric,
  sgst numeric,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gst_credit_ledger_txns_client_period
  ON public.gst_credit_ledger_transactions (client_id, period_month);

CREATE TABLE IF NOT EXISTS public.gst_liability_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  entry_date date,
  description text,
  is_debit boolean,
  igst numeric,
  cgst numeric,
  sgst numeric,
  cess numeric,
  balance numeric,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gst_liability_ledger_client_period
  ON public.gst_liability_ledger_entries (client_id, period_month);

CREATE TABLE IF NOT EXISTS public.gst_cash_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  entry_date date,
  description text,
  is_debit boolean,
  igst numeric,
  cgst numeric,
  sgst numeric,
  cess numeric,
  balance numeric,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gst_cash_ledger_client_period
  ON public.gst_cash_ledger_entries (client_id, period_month);

ALTER TABLE public.gst_credit_ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gst_liability_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gst_cash_ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gst_credit_ledger_transactions_all" ON public.gst_credit_ledger_transactions FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "gst_liability_ledger_entries_all" ON public.gst_liability_ledger_entries FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "gst_cash_ledger_entries_all" ON public.gst_cash_ledger_entries FOR ALL TO public USING (true) WITH CHECK (true);
