-- "Import 2B" feature — Phase 2 staging tables.
--
-- twob_import_docs : parsed GSTR-2B B2B documents (from the portal .xlsx).
-- books_register   : manually entered purchase-register (books) invoices.
--
-- These are INPUT staging only. The reconciliation engine (later phase) matches
-- them and writes the results into the existing bills_not_in_2b /
-- bills_not_in_books tables, so all downstream ITC / suspended-reco /
-- carry-forward / lock / version logic stays unchanged. Shared invoice columns
-- reuse the bills_* names so the engine can copy fields 1:1.

BEGIN;

-- 1) Parsed GSTR-2B documents -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.twob_import_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,                       -- MM/YYYY (return period)

  -- shared invoice fields (same names as bills_not_in_2b)
  date date,                                        -- invoice date
  supplier_name text,
  supplier_invoice_number text,
  supplier_gstin text,
  taxable_value numeric DEFAULT 0,
  input_igst numeric DEFAULT 0,
  input_cgst numeric DEFAULT 0,
  input_sgst numeric DEFAULT 0,

  -- 2B detail (audit / display)
  invoice_type text,
  invoice_value numeric DEFAULT 0,
  place_of_supply text,
  cess numeric DEFAULT 0,
  gstr1_period text,
  gstr1_filing_date date,
  source text,
  irn text,
  source_sheet text,

  -- portal classification (from the parser)
  bucket text NOT NULL DEFAULT 'available'
    CHECK (bucket IN ('available', 'reversal', 'rejected')),
  reverse_charge boolean NOT NULL DEFAULT false,
  itc_available boolean,
  itc_reason text,

  -- reconciliation state
  itc_action text NOT NULL DEFAULT 'ELIGIBLE'
    CHECK (itc_action IN ('ELIGIBLE', 'INELIGIBLE', 'RCM', 'REVERSAL', 'REJECTED')),
  match_status text
    CHECK (match_status IN ('matched', 'only_in_2b')),
  matched_book_id uuid,                             -- soft link to books_register.id

  import_batch_id uuid,                             -- groups one import; re-import replaces
  imported_at timestamptz DEFAULT now(),
  imported_by uuid,
  updated_by uuid,
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_twob_import_docs_client_period
  ON public.twob_import_docs (client_id, period_month);

-- 2) Manually entered books / purchase register -------------------------------
CREATE TABLE IF NOT EXISTS public.books_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,

  date date,
  supplier_name text,
  supplier_invoice_number text,
  supplier_gstin text,
  taxable_value numeric DEFAULT 0,
  input_igst numeric DEFAULT 0,
  input_cgst numeric DEFAULT 0,
  input_sgst numeric DEFAULT 0,

  -- treatment when a book invoice is NOT in 2B (engine translates to
  -- reversal_month / reclaim_month / reclaim_subtype on the bills_not_in_2b row)
  book_treatment text
    CHECK (book_treatment IN ('REVERSE_RECLAIM', 'RECLAIM', 'EXPENSE_OUT', 'PENDING')),

  match_status text
    CHECK (match_status IN ('matched', 'only_in_books')),
  matched_2b_id uuid,                               -- soft link to twob_import_docs.id

  updated_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_books_register_client_period
  ON public.books_register (client_id, period_month);

-- 3) RLS (permissive dev policies, matching the rest of the schema) -----------
ALTER TABLE public.twob_import_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.books_register  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view twob_import_docs" ON public.twob_import_docs;
CREATE POLICY "Anyone can view twob_import_docs"
  ON public.twob_import_docs FOR SELECT USING (true);
DROP POLICY IF EXISTS "Staff can manage twob_import_docs" ON public.twob_import_docs;
CREATE POLICY "Staff can manage twob_import_docs"
  ON public.twob_import_docs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can view books_register" ON public.books_register;
CREATE POLICY "Anyone can view books_register"
  ON public.books_register FOR SELECT USING (true);
DROP POLICY IF EXISTS "Staff can manage books_register" ON public.books_register;
CREATE POLICY "Staff can manage books_register"
  ON public.books_register FOR ALL USING (true) WITH CHECK (true);

COMMIT;
