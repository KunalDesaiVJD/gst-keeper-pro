-- Replaces the 3 named PDF columns from the previous migration (never
-- written by any shipped code — the extension's document capture is being
-- rebuilt to walk My Applications' Case Details folder, which turned out to
-- expose an open-ended set of documents per application: 2A, 2B, All
-- Declaration, Refund Cal, Sales Register, Job Work, CA Certificate, plus
-- whatever a Notice/Reply/Order/Audit History tab adds — not just an
-- application/query-memo/order triple). A single jsonb array of
-- {tab, label, url} keeps this open-ended rather than needing a new column
-- (and a new migration) every time a different refund reason exposes a
-- differently-named document.

ALTER TABLE public.gst_refund_applications
  DROP COLUMN IF EXISTS application_pdf_url,
  DROP COLUMN IF EXISTS query_memo_pdf_url,
  DROP COLUMN IF EXISTS order_pdf_url,
  ADD COLUMN IF NOT EXISTS documents jsonb NOT NULL DEFAULT '[]'::jsonb;
