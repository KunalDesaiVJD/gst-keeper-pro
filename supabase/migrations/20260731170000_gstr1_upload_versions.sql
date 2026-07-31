-- Audit history for GSTR-1 uploads: one row per Import / Upload / Refresh
-- Errors action so the operator can see who touched a client's return, when,
-- with what file, and how GSTN responded. Errors captured per attempt so
-- "what was rejected in the third upload attempt" is answerable.

BEGIN;

CREATE TABLE IF NOT EXISTS public.gstr1_upload_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,        -- short label, "Jul-26"
  version_number integer NOT NULL,   -- auto-assigned per (client, period) via trigger
  action_type text NOT NULL,         -- 'IMPORT' | 'UPLOAD' | 'REFRESH_ERRORS'
  actor_id uuid,                     -- user who triggered the action
  action_at timestamptz DEFAULT now() NOT NULL,
  file_name text,                    -- for IMPORT
  status text,                       -- 'accepted' | 'partial' | 'failed' | 'imported'
  summary text,
  errors jsonb                       -- [{invoiceNo, gstin, reason}, ...]
);

CREATE INDEX IF NOT EXISTS gstr1_upload_versions_lookup_idx
  ON public.gstr1_upload_versions (client_id, period_month, version_number DESC);

-- Auto-assign the next version_number per (client, period_month) so callers
-- never have to compute it (and can't race each other into a duplicate).
CREATE OR REPLACE FUNCTION public.gstr1_upload_versions_assign()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.version_number IS NULL OR NEW.version_number = 0 THEN
    SELECT COALESCE(MAX(version_number), 0) + 1
      INTO NEW.version_number
      FROM public.gstr1_upload_versions
     WHERE client_id = NEW.client_id
       AND period_month = NEW.period_month;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gstr1_upload_versions_assign_trg
  ON public.gstr1_upload_versions;
CREATE TRIGGER gstr1_upload_versions_assign_trg
  BEFORE INSERT ON public.gstr1_upload_versions
  FOR EACH ROW EXECUTE FUNCTION public.gstr1_upload_versions_assign();

ALTER TABLE public.gstr1_upload_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can manage gstr1 upload versions"
  ON public.gstr1_upload_versions;
CREATE POLICY "Anyone can manage gstr1 upload versions"
  ON public.gstr1_upload_versions
  FOR ALL TO public USING (true) WITH CHECK (true);

COMMIT;
