-- R1 of the corrected Annual Return rebuild (docs/GSTR9_9C_DATA_MODEL.md v2).
-- Replaces the flat, wrong-grain Step 1-4 tables with one table per sheet's
-- actual manual-entry surface, matching MASTER_PMS.xlsx exactly rather than
-- merging sheets that the firm keeps as separate entry surfaces on purpose
-- (firm decision, 27 Aug 2026 - see roadmap section 11).
--
-- books_turnover_lines / books_purchase_lines are NOT dropped here - the
-- existing Books Input tab still reads/writes them until R2 replaces it.
-- Their data is copied forward (not moved) into the new tables below so
-- nothing already entered is lost; copied rows are flagged via a migration
-- note in `notes` for staff to review, since the old tables carried no
-- part/section/category split to infer with confidence.

-- ---------------------------------------------------------------------
-- PL-OUTPUT: Part A (taxable) / Part B (non-taxable), annual, no month.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pl_output_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  part text NOT NULL CHECK (part IN ('A', 'B')),
  ledger_head text NOT NULL,
  bifurcation text CHECK (bifurcation IN ('export_wo_tax', 'sez_wo_tax', 'non_gst')), -- Part B only
  sr_no integer,
  rate text,
  taxable_value numeric NOT NULL DEFAULT 0,
  igst numeric NOT NULL DEFAULT 0,
  cgst numeric NOT NULL DEFAULT 0,
  sgst numeric NOT NULL DEFAULT 0,
  notes text,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pl_output_lines_client_fy_idx ON public.pl_output_lines (client_id, financial_year);
ALTER TABLE public.pl_output_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pl_output_lines_all" ON public.pl_output_lines FOR ALL TO public USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- PL-INPUT: (A) Purchase / (B) Expense / (C) Capital Goods, annual, no month.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pl_input_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  section text NOT NULL CHECK (section IN ('purchase', 'expense', 'capital_goods')),
  ledger_head text NOT NULL,
  expense_head text CHECK (expense_head IN (
    'Purchases', 'Freight', 'Power & Fuel', 'Imported Goods',
    'Rent & Insurance', 'Goods Lost/Destroyed/Gifted', 'Royalties',
    'Employees'' Cost', 'Conveyance', 'Bank Charges', 'Entertainment',
    'Stationery', 'Repair & Maintenance', 'Capital Goods', 'RCM', 'Other'
  )),
  sr_no integer,
  rate text,
  taxable_value numeric NOT NULL DEFAULT 0,
  igst numeric NOT NULL DEFAULT 0,
  cgst numeric NOT NULL DEFAULT 0,
  sgst numeric NOT NULL DEFAULT 0,
  notes text,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pl_input_lines_client_fy_idx ON public.pl_input_lines (client_id, financial_year);
ALTER TABLE public.pl_input_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pl_input_lines_all" ON public.pl_input_lines FOR ALL TO public USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- DUTIES & TAXES-OUTPUT: month-wise, entered separately from PL-Output
-- (firm decision - cross-checked against it, not derived from it).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.duties_taxes_output_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  month text NOT NULL, -- "Apr-25" etc.
  sales_igst numeric NOT NULL DEFAULT 0,
  sales_cgst numeric NOT NULL DEFAULT 0,
  sales_sgst numeric NOT NULL DEFAULT 0,
  credit_note_igst numeric NOT NULL DEFAULT 0,
  credit_note_cgst numeric NOT NULL DEFAULT 0,
  credit_note_sgst numeric NOT NULL DEFAULT 0,
  as_per_3b_igst numeric NOT NULL DEFAULT 0,
  as_per_3b_cgst numeric NOT NULL DEFAULT 0,
  as_per_3b_sgst numeric NOT NULL DEFAULT 0,
  other_adjustment_igst numeric NOT NULL DEFAULT 0,
  other_adjustment_cgst numeric NOT NULL DEFAULT 0,
  other_adjustment_sgst numeric NOT NULL DEFAULT 0,
  other_adjustment_reason text,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, month)
);
ALTER TABLE public.duties_taxes_output_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "duties_taxes_output_monthly_all" ON public.duties_taxes_output_monthly FOR ALL TO public USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- DUTIES & TAXES-INPUT: month-wise, entered separately from PL-Input.
-- Reversal/reclaim/180-day columns are running totals (firm decision -
-- not linked to a specific original transaction).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.duties_taxes_input_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  month text NOT NULL, -- "Apr-25" .. "Mar-26", or the special value "Last Year Effect"
  purchase_igst numeric NOT NULL DEFAULT 0,
  purchase_cgst numeric NOT NULL DEFAULT 0,
  purchase_sgst numeric NOT NULL DEFAULT 0,
  debit_note_igst numeric NOT NULL DEFAULT 0,
  debit_note_cgst numeric NOT NULL DEFAULT 0,
  debit_note_sgst numeric NOT NULL DEFAULT 0,
  suspended_reversed_igst numeric NOT NULL DEFAULT 0,
  suspended_reversed_cgst numeric NOT NULL DEFAULT 0,
  suspended_reversed_sgst numeric NOT NULL DEFAULT 0,
  suspended_reversed_180d_igst numeric NOT NULL DEFAULT 0,
  suspended_reversed_180d_cgst numeric NOT NULL DEFAULT 0,
  suspended_reversed_180d_sgst numeric NOT NULL DEFAULT 0,
  suspended_reclaim_igst numeric NOT NULL DEFAULT 0,
  suspended_reclaim_cgst numeric NOT NULL DEFAULT 0,
  suspended_reclaim_sgst numeric NOT NULL DEFAULT 0,
  suspended_reclaim_180d_igst numeric NOT NULL DEFAULT 0,
  suspended_reclaim_180d_cgst numeric NOT NULL DEFAULT 0,
  suspended_reclaim_180d_sgst numeric NOT NULL DEFAULT 0,
  as_per_3b_igst numeric NOT NULL DEFAULT 0,
  as_per_3b_cgst numeric NOT NULL DEFAULT 0,
  as_per_3b_sgst numeric NOT NULL DEFAULT 0,
  other_adjustment_igst numeric NOT NULL DEFAULT 0,
  other_adjustment_cgst numeric NOT NULL DEFAULT 0,
  other_adjustment_sgst numeric NOT NULL DEFAULT 0,
  other_adjustment_reason text,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, month)
);
ALTER TABLE public.duties_taxes_input_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "duties_taxes_input_monthly_all" ON public.duties_taxes_input_monthly FOR ALL TO public USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- RCM (this module's own Part B) - dedicated, independent of rcm_data
-- (firm decision - staff re-enter even though it duplicates 3B-prep effort).
-- Part A is computed from portal figures (gst_filed_returns), not stored here.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rcm_annual_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  month text NOT NULL,
  category text NOT NULL, -- e.g. "Transportation Exp", "Delivery Exp", "Office Rent Expense", "Advocate Fees"
  taxable_value numeric NOT NULL DEFAULT 0,
  igst numeric NOT NULL DEFAULT 0,
  cgst numeric NOT NULL DEFAULT 0,
  sgst numeric NOT NULL DEFAULT 0,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, month, category)
);
ALTER TABLE public.rcm_annual_return_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rcm_annual_return_lines_all" ON public.rcm_annual_return_lines FOR ALL TO public USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- GSTR 9-OUTPUT, column A (books) - B2C/B2B/SEZ/etc. classification that
-- PL-Output doesn't carry as a dimension. Annual.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gstr9_output_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  category text NOT NULL CHECK (category IN ('b2c', 'b2b', 'sez_with', 'sez_without', 'zero_rated', 'deemed_export', 'credit_note')),
  taxable_value numeric NOT NULL DEFAULT 0,
  igst numeric NOT NULL DEFAULT 0,
  cgst numeric NOT NULL DEFAULT 0,
  sgst numeric NOT NULL DEFAULT 0,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, category)
);
ALTER TABLE public.gstr9_output_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gstr9_output_lines_all" ON public.gstr9_output_lines FOR ALL TO public USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- GSTR 9-OUTPUT, column B (auto-populated) - GSTR-1 category figures.
-- Populated by an R3 rollup job from gstr1_data where complete; source
-- distinguishes an auto-computed row from a manual fallback entry.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.portal_gstr1_category_figures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  category text NOT NULL CHECK (category IN ('b2c', 'b2b', 'sez_with', 'sez_without', 'zero_rated', 'deemed_export', 'credit_note')),
  taxable_value numeric NOT NULL DEFAULT 0,
  igst numeric NOT NULL DEFAULT 0,
  cgst numeric NOT NULL DEFAULT 0,
  sgst numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('auto', 'manual')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, category)
);
ALTER TABLE public.portal_gstr1_category_figures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portal_gstr1_category_figures_all" ON public.portal_gstr1_category_figures FOR ALL TO public USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- Tax actually paid (GSTR-9 Table 9 / Annexure 1 / Notice Format).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.portal_tax_payment_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  tax_head text NOT NULL CHECK (tax_head IN ('igst', 'cgst', 'sgst', 'cess')),
  payable numeric NOT NULL DEFAULT 0,
  paid_cash numeric NOT NULL DEFAULT 0,
  paid_itc numeric NOT NULL DEFAULT 0,
  interest numeric NOT NULL DEFAULT 0,
  late_fee numeric NOT NULL DEFAULT 0,
  penalty numeric NOT NULL DEFAULT 0,
  entered_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, tax_head)
);
ALTER TABLE public.portal_tax_payment_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portal_tax_payment_entries_all" ON public.portal_tax_payment_entries FOR ALL TO public USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- Next-year carry-forward items (GSTR-9 Tables 8C/10-13, Annexure 4).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.annual_return_carry_forward (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('claimed_in_next_fy', 'claimed_from_prev_fy', 'turnover_declared_next_fy', 'turnover_reduced_next_fy')),
  clause_ref text CHECK (clause_ref IN ('8C', '10', '11', '12', '13')),
  taxable_value numeric NOT NULL DEFAULT 0,
  igst numeric NOT NULL DEFAULT 0,
  cgst numeric NOT NULL DEFAULT 0,
  sgst numeric NOT NULL DEFAULT 0,
  cess numeric NOT NULL DEFAULT 0,
  notes text,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS annual_return_carry_forward_client_fy_idx ON public.annual_return_carry_forward (client_id, financial_year);
ALTER TABLE public.annual_return_carry_forward ENABLE ROW LEVEL SECURITY;
CREATE POLICY "annual_return_carry_forward_all" ON public.annual_return_carry_forward FOR ALL TO public USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- Migrate Step 1-4 data forward (copy, not move - old tables/UI still
-- work until R2 replaces them). No section/part split existed before,
-- so every copied row is flagged in `notes` for a human to re-check.
-- ---------------------------------------------------------------------
INSERT INTO public.pl_output_lines (client_id, financial_year, part, ledger_head, rate, taxable_value, igst, cgst, sgst, notes)
SELECT client_id, financial_year, 'A', ledger_head, rate, taxable_value, igst, cgst, sgst,
       'Migrated from books_turnover_lines (R1, 28 Aug 2026) - defaulted to Part A, please verify.'
FROM public.books_turnover_lines
ON CONFLICT DO NOTHING;

INSERT INTO public.pl_input_lines (client_id, financial_year, section, ledger_head, expense_head, rate, taxable_value, igst, cgst, sgst, notes)
SELECT client_id, financial_year, 'purchase', ledger_head, expense_head, rate, taxable_value, igst, cgst, sgst,
       'Migrated from books_purchase_lines (R1, 28 Aug 2026) - defaulted to Purchase section, please verify.'
FROM public.books_purchase_lines
ON CONFLICT DO NOTHING;
