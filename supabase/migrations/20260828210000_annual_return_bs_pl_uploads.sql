-- Annual Return module's first real file-upload capability: attaching the
-- audited Balance Sheet and Profit & Loss statement (the source documents
-- GSTR-9C's Table 5/7/9/12/14 reconcile against) to a client/year, so the
-- working papers carry the actual audited financials alongside the figures
-- typed in elsewhere. Files live in the existing 'return-pdfs' storage
-- bucket (already used by FilingStatusPage and AddNoticeDialog) under a
-- new 'annual-return/' prefix — no new bucket needed.

CREATE TABLE IF NOT EXISTS public.annual_return_bs_pl_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  doc_type text NOT NULL CHECK (doc_type IN ('balance_sheet', 'profit_loss', 'other')),
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size bigint,
  description text,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.annual_return_bs_pl_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "annual_return_bs_pl_uploads_all" ON public.annual_return_bs_pl_uploads
  FOR ALL TO public USING (true) WITH CHECK (true);
