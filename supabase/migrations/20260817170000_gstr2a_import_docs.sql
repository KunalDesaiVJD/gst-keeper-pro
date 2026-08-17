-- GSTR-2A import: a lean, report-only table for the 3 "ready" GSTR-2A
-- reports (Rate Wise, Supplier Wise, P.Y invoice showing in C.Y). Unlike
-- twob_import_docs (GSTR-2B), this table backs NO reconciliation workflow —
-- GSTR-2A here is purely informational, pulled from the portal by the
-- extension and read straight by report builders. B2B family only, mirroring
-- the scope of the existing GSTR-2B import (see parseGstr2b.ts).

CREATE TABLE IF NOT EXISTS public.gstr2a_import_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,               -- MM/YYYY, matches the app's month picker
  bucket text NOT NULL DEFAULT 'available',  -- available | amendment (amendment rows not parsed yet — parity with twob_import_docs' deferred-sheet handling)
  supplier_gstin text,
  supplier_name text,
  supplier_invoice_number text,
  invoice_type text,
  date date,
  invoice_value numeric,
  place_of_supply text,
  taxable_value numeric,
  input_igst numeric,
  input_cgst numeric,
  input_sgst numeric,
  cess numeric,
  reverse_charge boolean NOT NULL DEFAULT false,
  gstr1_filing_date date,
  gstr1_period text,
  source text,
  irn text,
  import_batch_id uuid,
  imported_at timestamptz NOT NULL DEFAULT now(),
  imported_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE INDEX IF NOT EXISTS idx_gstr2a_import_docs_client_period
  ON public.gstr2a_import_docs (client_id, period_month);

ALTER TABLE public.gstr2a_import_docs ENABLE ROW LEVEL SECURITY;

-- Same convention as every other staff-facing table in this app: this app
-- never establishes a Supabase auth session (auth.uid() is always NULL at
-- runtime), so the policy is open to public and login/permission gating
-- happens entirely in the app layer. See CLAUDE.md.
CREATE POLICY "gstr2a_import_docs_all" ON public.gstr2a_import_docs
  FOR ALL TO public USING (true) WITH CHECK (true);
