-- Audit history for GSTR-3B "Push to GST Portal" attempts: one row per push
-- so the operator can see who pushed a client's draft, when, and how many
-- fields the extension actually managed to fill vs skip. Mirrors
-- gstr1_upload_versions (see 20260731170000_gstr1_upload_versions.sql).

BEGIN;

CREATE TABLE IF NOT EXISTS public.gstr3b_push_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,        -- "MM/YYYY", matches MonthContext / filing_status
  version_number integer NOT NULL,   -- auto-assigned per (client, period) via trigger
  actor_id uuid,                     -- user who triggered the push
  action_at timestamptz DEFAULT now() NOT NULL,
  status text,                       -- 'ok' | 'failed'
  summary text,
  filled_count integer,
  skipped jsonb                      -- string[] of "field — reason"
);

CREATE INDEX IF NOT EXISTS gstr3b_push_versions_lookup_idx
  ON public.gstr3b_push_versions (client_id, period_month, version_number DESC);

CREATE OR REPLACE FUNCTION public.gstr3b_push_versions_assign()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.version_number IS NULL OR NEW.version_number = 0 THEN
    SELECT COALESCE(MAX(version_number), 0) + 1
      INTO NEW.version_number
      FROM public.gstr3b_push_versions
     WHERE client_id = NEW.client_id
       AND period_month = NEW.period_month;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gstr3b_push_versions_assign_trg
  ON public.gstr3b_push_versions;
CREATE TRIGGER gstr3b_push_versions_assign_trg
  BEFORE INSERT ON public.gstr3b_push_versions
  FOR EACH ROW EXECUTE FUNCTION public.gstr3b_push_versions_assign();

ALTER TABLE public.gstr3b_push_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can manage gstr3b push versions"
  ON public.gstr3b_push_versions;
CREATE POLICY "Anyone can manage gstr3b push versions"
  ON public.gstr3b_push_versions
  FOR ALL TO public USING (true) WITH CHECK (true);

COMMIT;
