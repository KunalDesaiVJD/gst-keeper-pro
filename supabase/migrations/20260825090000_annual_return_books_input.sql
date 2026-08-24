-- Phase 1 of the Annual Return roadmap: books-input layer. This is the
-- source of truth for FY 2025-26 preparation — GSTR-1/3B automation isn't
-- reliable yet, so books entry leads and every later phase (portal capture,
-- reconciliation, the GSTR-9/9C tables) reconciles against these rows
-- rather than the other way round.
--
-- Mirrors the firm's PL-INPUT / PL-OUTPUT sheets: one row per ledger head,
-- rate-wise, per (client, financial year). books_purchase_lines additionally
-- carries an expense_head so it can feed GSTR-9C Table 14 without staff
-- re-classifying every purchase line by hand every year.

CREATE TABLE IF NOT EXISTS public.books_turnover_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,               -- e.g. "2025-26"
  ledger_head text NOT NULL,
  rate text,                                  -- "18%", "5%", "0%" — text, not numeric: LUT/exempt rows aren't a %
  taxable_value numeric NOT NULL DEFAULT 0,
  igst numeric NOT NULL DEFAULT 0,
  cgst numeric NOT NULL DEFAULT 0,
  sgst numeric NOT NULL DEFAULT 0,
  notes text,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS books_turnover_lines_client_fy_idx
  ON public.books_turnover_lines (client_id, financial_year);

ALTER TABLE public.books_turnover_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "books_turnover_lines_all" ON public.books_turnover_lines
  FOR ALL TO public USING (true) WITH CHECK (true);

-- The fixed GSTR-9C Table 12B expense-head categories. Kept as a CHECK
-- rather than a lookup table — it's a government-defined closed list, not
-- something staff extend.
CREATE TABLE IF NOT EXISTS public.books_purchase_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  ledger_head text NOT NULL,
  rate text,
  taxable_value numeric NOT NULL DEFAULT 0,
  igst numeric NOT NULL DEFAULT 0,
  cgst numeric NOT NULL DEFAULT 0,
  sgst numeric NOT NULL DEFAULT 0,
  expense_head text CHECK (expense_head IN (
    'Purchases', 'Freight', 'Power & Fuel', 'Imported Goods',
    'Rent & Insurance', 'Goods Lost/Destroyed/Gifted', 'Royalties',
    'Employees'' Cost', 'Conveyance', 'Bank Charges', 'Entertainment',
    'Stationery', 'Repair & Maintenance', 'Capital Goods', 'RCM', 'Other'
  )),
  notes text,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS books_purchase_lines_client_fy_idx
  ON public.books_purchase_lines (client_id, financial_year);

ALTER TABLE public.books_purchase_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "books_purchase_lines_all" ON public.books_purchase_lines
  FOR ALL TO public USING (true) WITH CHECK (true);

-- Remembers the last expense_head a client's staff picked for a given
-- ledger head, so the next year's entry pre-fills instead of re-classifying
-- "Freight Inward (RCM)" from scratch every FY.
CREATE TABLE IF NOT EXISTS public.expense_head_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ledger_head text NOT NULL,
  expense_head text NOT NULL CHECK (expense_head IN (
    'Purchases', 'Freight', 'Power & Fuel', 'Imported Goods',
    'Rent & Insurance', 'Goods Lost/Destroyed/Gifted', 'Royalties',
    'Employees'' Cost', 'Conveyance', 'Bank Charges', 'Entertainment',
    'Stationery', 'Repair & Maintenance', 'Capital Goods', 'RCM', 'Other'
  )),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, ledger_head)
);

ALTER TABLE public.expense_head_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expense_head_mappings_all" ON public.expense_head_mappings
  FOR ALL TO public USING (true) WITH CHECK (true);
