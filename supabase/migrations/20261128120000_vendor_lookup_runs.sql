-- Vendor GSTIN Risk Report: a record of every lookup run, so a run that saves
-- nothing still leaves a trace (28 Nov 2026).
--
-- The app writes a row when Pull starts (what it asked for); the extension
-- (0.19.3+) updates it as it goes (stage, counts, heartbeat) and when it ends
-- (outcome, stop reason, and a snapshot of the portal page when it could not
-- read it, so selectors can be fixed from the row without another run).
-- The report shows the latest run and its outcome.
--
-- vendor_gstin_lookups.source also takes 'manual_upload' (a lookup sheet the
-- firm uploads on the report) beside 'gst_portal_search_taxpayer'.
--
-- RLS open to public (CLAUDE.md); client_id gets the allotment guard. Idempotent.

CREATE TABLE IF NOT EXISTS public.vendor_lookup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  fy text,
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  planned integer NOT NULL DEFAULT 0,       -- GSTINs the app asked for
  gstins text[],
  extension_version text,                   -- what the app saw installed
  -- planned -> started (the extension picked it up) -> running -> done / stopped / failed;
  -- refused = the app did not start it (extension missing or too old)
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'refused', 'started', 'running', 'done', 'stopped', 'failed')),
  stage text,                                -- login, search_page, looking_up, ...
  found integer NOT NULL DEFAULT 0,
  not_found integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  stop_reason text,
  page_url text,
  page_snapshot text,                        -- the page's text when it could not be read (trimmed)
  heartbeat_at timestamptz,
  finished_at timestamptz,
  detail jsonb
);

CREATE INDEX IF NOT EXISTS vendor_lookup_runs_client_idx
  ON public.vendor_lookup_runs (client_id, requested_at DESC);

ALTER TABLE public.vendor_lookup_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_lookup_runs_all ON public.vendor_lookup_runs;
CREATE POLICY vendor_lookup_runs_all ON public.vendor_lookup_runs
  FOR ALL TO public USING (true) WITH CHECK (true);

DO $$
DECLARE
  v_pred text := '(client_id IS NULL OR (SELECT public.gst_actor_client_scope()) IS NULL OR client_id = ANY ((SELECT public.gst_actor_client_scope())::uuid[]))';
BEGIN
  IF to_regprocedure('public.gst_actor_client_scope()') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS staff_client_scope_guard ON public.vendor_lookup_runs';
    EXECUTE format('CREATE POLICY staff_client_scope_guard ON public.vendor_lookup_runs AS RESTRICTIVE FOR ALL TO public USING %s WITH CHECK %s',
                   v_pred, v_pred);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_lookup_runs TO anon, authenticated;

-- A lookup row may point at its run.
ALTER TABLE public.vendor_gstin_lookups ADD COLUMN IF NOT EXISTS run_id uuid
  REFERENCES public.vendor_lookup_runs(id) ON DELETE SET NULL;
