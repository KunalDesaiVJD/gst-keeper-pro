-- Manual GSTR-1 preparation: for clients whose GSTR-1 is built by keying in
-- invoices directly (not imported from a Tally JSON). One row per invoice
-- line (or per fixed-shape NIL/Documents-Issued row); "Generate JSON" on the
-- manual entry page assembles all sections for a (client, period) into the
-- exact portal JSON shape and writes it into gstr1_data.raw_json — from that
-- point on, Upload to Portal / Version History / Error Reports work
-- identically to an imported return.

BEGIN;

CREATE TABLE IF NOT EXISTS public.gstr1_manual_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,   -- short label, "Jul-26"
  section text NOT NULL,        -- 'b2b' | 'b2cl' | 'b2cs' | 'cdnr' | 'cdnur' | 'exp' | 'nil' | 'doc'
  row_order integer NOT NULL DEFAULT 0,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,  -- section-specific fields, see gstr1ManualBuild.ts
  updated_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS gstr1_manual_entries_lookup_idx
  ON public.gstr1_manual_entries (client_id, period_month, section, row_order);

ALTER TABLE public.gstr1_manual_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can manage gstr1 manual entries" ON public.gstr1_manual_entries;
CREATE POLICY "Anyone can manage gstr1 manual entries"
  ON public.gstr1_manual_entries
  FOR ALL TO public USING (true) WITH CHECK (true);

COMMIT;
