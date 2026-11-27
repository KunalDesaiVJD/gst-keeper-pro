-- Vendor GSTIN Risk Report (Reports Hub, 27 Nov 2026).
--
-- 1. vendor_gstin_lookups: every GST portal "Search Taxpayer" lookup the
--    extension (0.19.0, mode gstin_search) made for a supplier GSTIN, kept as
--    history: the portal's answer as it came (payload) plus the fields the
--    report reads. A GSTIN's registration is public data and is the same for
--    every client, so a row carries no client_id; via_client_id only records
--    whose portal login made the lookup.
-- 2. vendor_master_entries: a client's vendor master (name, code, GSTIN) as
--    uploaded on the report, so the report can compare the books name with
--    the portal's. Holds client_id, so it gets the client allotment guard.
-- 3. vendor_gstin_latest: the latest usable lookup of each GSTIN.
--
-- RLS open to public, as everywhere in this app (CLAUDE.md). Idempotent.

-- ---------------------------------------------------------------------------
-- 1. Lookups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendor_gstin_lookups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gstin text NOT NULL CHECK (gstin ~ '^[0-9A-Z]{15}$'),
  looked_up_at timestamptz NOT NULL DEFAULT now(),
  looked_up_by uuid,
  via_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  -- ok = the portal answered with the taxpayer; not_found = the portal said
  -- no such GSTIN; error = the lookup failed (says nothing about the GSTIN).
  status text NOT NULL CHECK (status IN ('ok', 'not_found', 'error')),
  error text,
  source text NOT NULL DEFAULT 'gst_portal_search_taxpayer',
  extension_version text,
  legal_name text,
  trade_name text,
  reg_status text,            -- as the portal words it: Active, Cancelled, Suspended, Inactive, ...
  reg_date date,
  cancel_date date,
  cancel_reason text,
  taxpayer_type text,         -- Regular, Composition, Casual Taxable Person, Non Resident, ISD, SEZ Unit, SEZ Developer, Tax Deductor, Tax Collector, ...
  constitution text,          -- Proprietorship, Partnership, Private Limited Company, ...
  state_jurisdiction text,
  centre_jurisdiction text,
  address text,
  nature_of_business text[],
  ato_slab text,              -- the portal's aggregate turnover slab, with its FY
  einvoice_status text,       -- the portal's e-invoice flag where it shows one, else NULL
  filings jsonb,              -- [{rtntype, fy, taxp, dof, status, mof}] from the return filing table
  payload jsonb               -- the portal's answer as it came
);

CREATE INDEX IF NOT EXISTS vendor_gstin_lookups_gstin_at_idx
  ON public.vendor_gstin_lookups (gstin, looked_up_at DESC);

ALTER TABLE public.vendor_gstin_lookups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_gstin_lookups_all ON public.vendor_gstin_lookups;
CREATE POLICY vendor_gstin_lookups_all ON public.vendor_gstin_lookups
  FOR ALL TO public USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2. A client's vendor master
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendor_master_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  gstin text NOT NULL,
  vendor_name text,
  vendor_code text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid,
  file_name text
);

CREATE INDEX IF NOT EXISTS vendor_master_entries_client_idx
  ON public.vendor_master_entries (client_id, gstin);

ALTER TABLE public.vendor_master_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_master_entries_all ON public.vendor_master_entries;
CREATE POLICY vendor_master_entries_all ON public.vendor_master_entries
  FOR ALL TO public USING (true) WITH CHECK (true);

-- The client allotment guard (20261125140000, section 4), for this table.
DO $$
DECLARE
  v_pred text := '(client_id IS NULL OR (SELECT public.gst_actor_client_scope()) IS NULL OR client_id = ANY ((SELECT public.gst_actor_client_scope())::uuid[]))';
BEGIN
  IF to_regprocedure('public.gst_actor_client_scope()') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS staff_client_scope_guard ON public.vendor_master_entries';
    EXECUTE format('CREATE POLICY staff_client_scope_guard ON public.vendor_master_entries AS RESTRICTIVE FOR ALL TO public USING %s WITH CHECK %s',
                   v_pred, v_pred);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Latest usable lookup per GSTIN (an error row never hides a good one)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vendor_gstin_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (gstin) *
  FROM public.vendor_gstin_lookups
 WHERE status IN ('ok', 'not_found')
 ORDER BY gstin, looked_up_at DESC;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_gstin_lookups TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_master_entries TO anon, authenticated;
GRANT SELECT ON public.vendor_gstin_latest TO anon, authenticated;
