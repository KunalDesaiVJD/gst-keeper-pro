-- Advance receipt & set-off — Phase 4: government contractor projects.
-- See docs/ADVANCE_SETOFF_POSITIONS.md §9.
--
-- Structurally parallel to the Builder module and sharing none of its code.
-- The difference that drives the schema: a promoter's advance is absorbed by
-- the unit it was booked against, whereas a contractor's MOBILISATION ADVANCE
-- is received once against a bank guarantee and recovered proportionately from
-- EVERY RA bill until exhausted. One receipt therefore has a dozen adjustment
-- legs, and the recovery is a schedule to be checked, not a one-off set-off.
--
-- RLS open to public per the project's standing rule (no Supabase auth session
-- exists, so auth.uid() is always NULL and any policy gated on it fails
-- closed). Authorisation is enforced in the app layer.

CREATE TABLE public.contract_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  work_order_no TEXT NOT NULL DEFAULT '',
  work_order_date DATE,
  contract_value NUMERIC NOT NULL DEFAULT 0,

  -- Place of supply for a works contract is the location of the immovable
  -- property (s.12(3)), NOT the client's own state. Holding it on the project
  -- and inheriting it onto every receipt and RA bill removes the IGST/CGST
  -- misclassification at source — a second, independent error class this layer
  -- eliminates for free.
  pos_state TEXT NOT NULL,
  rate_pct NUMERIC NOT NULL DEFAULT 18,

  mobilisation_advance_pct NUMERIC NOT NULL DEFAULT 0,
  -- PCT_PER_RA_BILL — recover recovery_pct of every RA bill until the advance
  --                   is exhausted (the common case).
  -- LUMPSUM_AT_BILL_N — recover the whole advance at RA bill number
  --                     recovery_at_bill_no.
  recovery_rule TEXT NOT NULL DEFAULT 'PCT_PER_RA_BILL',
  recovery_pct NUMERIC NOT NULL DEFAULT 10,
  recovery_at_bill_no INTEGER,

  -- The bank guarantee the advance was released against. Expiry feeds the
  -- existing reminders module; an expired BG on a live advance is the
  -- contractor's problem long before it is a GST one, but we are the ones
  -- holding the date.
  bg_no TEXT NOT NULL DEFAULT '',
  bg_amount NUMERIC NOT NULL DEFAULT 0,
  bg_expiry DATE,

  retention_pct NUMERIC NOT NULL DEFAULT 0,
  -- ACTIVE | COMPLETED | CLOSED
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  notes TEXT NOT NULL DEFAULT '',

  created_by UUID,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contract_projects_client ON public.contract_projects(client_id);
CREATE INDEX idx_contract_projects_bg_expiry ON public.contract_projects(bg_expiry) WHERE bg_expiry IS NOT NULL;

ALTER TABLE public.contract_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contract_projects_all" ON public.contract_projects
  FOR ALL TO public USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- RA bills — the running-account invoices the advance is recovered from.
--
-- Stored rather than derived from the GSTR-1 JSON because the JSON carries no
-- project reference: two projects for the same client, both billed in the same
-- month, are indistinguishable in the return. Without these rows there is no
-- per-project working paper and no expected-recovery to check against.
-- ---------------------------------------------------------------------------
CREATE TABLE public.contract_ra_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.contract_projects(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- Sequence within the project. Drives LUMPSUM_AT_BILL_N and orders the
  -- recovery schedule; two bills sharing a number would make the schedule
  -- ambiguous.
  bill_no INTEGER NOT NULL,
  bill_ref TEXT NOT NULL DEFAULT '',
  bill_date DATE NOT NULL,
  -- MM/YYYY
  period_month TEXT NOT NULL,

  gross_value NUMERIC NOT NULL DEFAULT 0,
  taxable_value NUMERIC NOT NULL DEFAULT 0,
  rate_pct NUMERIC NOT NULL DEFAULT 18,
  igst NUMERIC NOT NULL DEFAULT 0,
  cgst NUMERIC NOT NULL DEFAULT 0,
  sgst NUMERIC NOT NULL DEFAULT 0,

  retention_held NUMERIC NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',

  created_by UUID,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT contract_ra_bills_unique_no UNIQUE (project_id, bill_no)
);

CREATE INDEX idx_contract_ra_bills_project ON public.contract_ra_bills(project_id);
CREATE INDEX idx_contract_ra_bills_client_period ON public.contract_ra_bills(client_id, period_month);

ALTER TABLE public.contract_ra_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contract_ra_bills_all" ON public.contract_ra_bills
  FOR ALL TO public USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Wire the register to projects. project_id was added unconstrained in Phase 3
-- precisely so this could land without a data migration.
--
-- ON DELETE SET NULL, not CASCADE: deleting a project must never delete the
-- advance receipts under it. Those rows are the evidence for tax already paid
-- in Table 11A — they outlive the project master.
-- ---------------------------------------------------------------------------
ALTER TABLE public.advance_receipts
  ADD CONSTRAINT advance_receipts_project_fk
  FOREIGN KEY (project_id) REFERENCES public.contract_projects(id) ON DELETE SET NULL;

ALTER TABLE public.advance_adjustments
  ADD CONSTRAINT advance_adjustments_project_fk
  FOREIGN KEY (project_id) REFERENCES public.contract_projects(id) ON DELETE SET NULL;

-- Which RA bill a set-off leg was recovered from. Without it the expected
-- recovery for a bill can't be compared with what was actually adjusted.
ALTER TABLE public.advance_adjustments
  ADD COLUMN ra_bill_id UUID REFERENCES public.contract_ra_bills(id) ON DELETE SET NULL;

CREATE INDEX idx_advance_adjustments_ra_bill ON public.advance_adjustments(ra_bill_id);
