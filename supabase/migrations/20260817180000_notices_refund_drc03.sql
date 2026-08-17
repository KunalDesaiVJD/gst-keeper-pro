-- Schema for 3 Phase-3 report categories: Notices & Orders, Refund, DRC-03.
-- Unlike gstr2a_import_docs (Phase 3 batch 1), NO extension automation
-- pulls into these tables yet — that would mean guessing the DOM structure
-- of three portal pages this codebase has never scraped before, with no
-- existing code to mirror the way GSTR-2A could mirror GSTR-2B. Shipping
-- fabricated selectors for pages nobody has verified risks silently
-- capturing the wrong data into what a firm relies on for compliance
-- reporting — worse than shipping nothing. These tables exist so the 8
-- reports built on them work the moment data lands, by manual entry today
-- and by extension automation once someone verifies real portal selectors.

CREATE TABLE IF NOT EXISTS public.gst_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  reference_number text,
  notice_type text,                          -- portal's own type label (SCN, Order, etc.)
  source text NOT NULL DEFAULT 'notices',    -- 'notices' | 'additional_notices'
  description text,
  issue_date date,
  due_date date,
  status text,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  pulled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gst_notices_client ON public.gst_notices (client_id);

CREATE TABLE IF NOT EXISTS public.gst_refund_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  arn text,
  refund_type text,                          -- portal's reason/category label
  source_ledger text,                        -- 'ITC' | 'Cash' | null (unclassified)
  filed_date date,
  claimed_amount numeric,
  sanctioned_amount numeric,
  status text,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  pulled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gst_refund_applications_client ON public.gst_refund_applications (client_id);

CREATE TABLE IF NOT EXISTS public.gst_drc03_filings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  arn text,
  cause_of_payment text,                     -- portal's "Cause of Payment" label
  filed_date date,
  period_from date,
  period_to date,
  cash_amount numeric,
  credit_amount numeric,
  status text,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  pulled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gst_drc03_filings_client ON public.gst_drc03_filings (client_id);

ALTER TABLE public.gst_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gst_refund_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gst_drc03_filings ENABLE ROW LEVEL SECURITY;

-- Same convention as every other staff-facing table: this app never
-- establishes a Supabase auth session (auth.uid() is always NULL at
-- runtime), so RLS is open to public and gating happens in the app layer.
CREATE POLICY "gst_notices_all" ON public.gst_notices FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "gst_refund_applications_all" ON public.gst_refund_applications FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "gst_drc03_filings_all" ON public.gst_drc03_filings FOR ALL TO public USING (true) WITH CHECK (true);
