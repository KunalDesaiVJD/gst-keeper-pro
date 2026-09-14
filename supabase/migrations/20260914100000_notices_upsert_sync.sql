-- Phase 0.1: Convert notice/refund/DRC-03/case-folder sync from destructive
-- DELETE-then-INSERT to upsert via PostgREST's on_conflict + merge-duplicates.
-- Staff workflow columns (staff_status, priority, reply_*, order_*, etc.) are
-- no longer wiped on every portal pull.

-- Shared updated_at trigger (idempotent)
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. gst_notices
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.gst_notices
  ADD COLUMN IF NOT EXISTS portal_key text,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at    timestamptz;

-- Back-fill portal_key from the best available identifier
UPDATE public.gst_notices SET portal_key = CASE
  WHEN reference_number IS NOT NULL AND reference_number <> '' THEN reference_number
  WHEN case_id IS NOT NULL AND case_id <> '' THEN 'case:' || case_id
  ELSE 'legacy:' || id::text
END WHERE portal_key IS NULL;

ALTER TABLE public.gst_notices ALTER COLUMN portal_key SET NOT NULL;

-- Deduplicate before adding the unique constraint — keep the most recent pull
DELETE FROM public.gst_notices a
USING public.gst_notices b
WHERE a.client_id = b.client_id
  AND a.source = b.source
  AND a.portal_key = b.portal_key
  AND a.id <> b.id
  AND (a.pulled_at < b.pulled_at OR (a.pulled_at = b.pulled_at AND a.id < b.id));

ALTER TABLE public.gst_notices
  ADD CONSTRAINT uq_gst_notices_portal UNIQUE (client_id, source, portal_key);

DROP TRIGGER IF EXISTS trg_gst_notices_updated_at ON public.gst_notices;
CREATE TRIGGER trg_gst_notices_updated_at
  BEFORE UPDATE ON public.gst_notices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. gst_refund_applications
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.gst_refund_applications
  ADD COLUMN IF NOT EXISTS portal_key    text,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at    timestamptz;

UPDATE public.gst_refund_applications SET portal_key = CASE
  WHEN arn IS NOT NULL AND arn <> '' THEN arn
  ELSE 'legacy:' || id::text
END WHERE portal_key IS NULL;

ALTER TABLE public.gst_refund_applications ALTER COLUMN portal_key SET NOT NULL;

DELETE FROM public.gst_refund_applications a
USING public.gst_refund_applications b
WHERE a.client_id = b.client_id
  AND a.portal_key = b.portal_key
  AND a.id <> b.id
  AND (a.pulled_at < b.pulled_at OR (a.pulled_at = b.pulled_at AND a.id < b.id));

ALTER TABLE public.gst_refund_applications
  ADD CONSTRAINT uq_gst_refund_applications_portal UNIQUE (client_id, portal_key);

DROP TRIGGER IF EXISTS trg_gst_refund_applications_updated_at ON public.gst_refund_applications;
CREATE TRIGGER trg_gst_refund_applications_updated_at
  BEFORE UPDATE ON public.gst_refund_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. gst_drc03_filings
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.gst_drc03_filings
  ADD COLUMN IF NOT EXISTS portal_key    text,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at    timestamptz;

UPDATE public.gst_drc03_filings SET portal_key = CASE
  WHEN arn IS NOT NULL AND arn <> '' THEN arn
  ELSE 'legacy:' || id::text
END WHERE portal_key IS NULL;

ALTER TABLE public.gst_drc03_filings ALTER COLUMN portal_key SET NOT NULL;

DELETE FROM public.gst_drc03_filings a
USING public.gst_drc03_filings b
WHERE a.client_id = b.client_id
  AND a.portal_key = b.portal_key
  AND a.id <> b.id
  AND (a.pulled_at < b.pulled_at OR (a.pulled_at = b.pulled_at AND a.id < b.id));

ALTER TABLE public.gst_drc03_filings
  ADD CONSTRAINT uq_gst_drc03_filings_portal UNIQUE (client_id, portal_key);

DROP TRIGGER IF EXISTS trg_gst_drc03_filings_updated_at ON public.gst_drc03_filings;
CREATE TRIGGER trg_gst_drc03_filings_updated_at
  BEFORE UPDATE ON public.gst_drc03_filings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. gst_case_folder_items
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.gst_case_folder_items
  ADD COLUMN IF NOT EXISTS portal_key    text,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at    timestamptz;

UPDATE public.gst_case_folder_items SET portal_key = CASE
  WHEN reference_number IS NOT NULL AND reference_number <> ''
    THEN coalesce(folder_section, '_') || ':' || reference_number
  ELSE 'legacy:' || id::text
END WHERE portal_key IS NULL;

ALTER TABLE public.gst_case_folder_items ALTER COLUMN portal_key SET NOT NULL;

DELETE FROM public.gst_case_folder_items a
USING public.gst_case_folder_items b
WHERE a.client_id = b.client_id
  AND a.case_id = b.case_id
  AND a.portal_key = b.portal_key
  AND a.id <> b.id
  AND (a.pulled_at < b.pulled_at OR (a.pulled_at = b.pulled_at AND a.id < b.id));

ALTER TABLE public.gst_case_folder_items
  ADD CONSTRAINT uq_gst_case_folder_items_portal UNIQUE (client_id, case_id, portal_key);
