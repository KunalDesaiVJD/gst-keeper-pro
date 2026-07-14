-- Portal Agent G0: allow opening balances to be pulled from the portal.
-- Adds opening_source = 'portal' + provenance to the reco tables. NOT applied to
-- live yet — lives on the feat/portal-agent branch until confirmed.

BEGIN;

-- Suspended Reco
ALTER TABLE public.suspended_reco DROP CONSTRAINT IF EXISTS suspended_reco_opening_source_check;
ALTER TABLE public.suspended_reco
  ADD CONSTRAINT suspended_reco_opening_source_check
  CHECK (opening_source IN ('manual', 'csv', 'not_applicable', 'portal'));
ALTER TABLE public.suspended_reco ADD COLUMN IF NOT EXISTS opening_portal_pulled_at timestamptz;
ALTER TABLE public.suspended_reco ADD COLUMN IF NOT EXISTS opening_portal_pulled_by uuid;

-- GST Receivable Reco (same opening-source pattern)
ALTER TABLE public.gst_receivable_reco DROP CONSTRAINT IF EXISTS gst_receivable_reco_opening_source_check;
ALTER TABLE public.gst_receivable_reco
  ADD CONSTRAINT gst_receivable_reco_opening_source_check
  CHECK (opening_source IN ('manual', 'csv', 'not_applicable', 'portal'));
ALTER TABLE public.gst_receivable_reco ADD COLUMN IF NOT EXISTS opening_portal_pulled_at timestamptz;
ALTER TABLE public.gst_receivable_reco ADD COLUMN IF NOT EXISTS opening_portal_pulled_by uuid;

-- Storage bucket for filed-return PDFs (Feature A). Idempotent — likely already exists.
INSERT INTO storage.buckets (id, name, public)
  VALUES ('return-pdfs', 'return-pdfs', false)
  ON CONFLICT (id) DO NOTHING;

COMMIT;
