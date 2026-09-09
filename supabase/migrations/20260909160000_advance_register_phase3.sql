-- Advance receipt & set-off — Phase 3: the register (Layer 2).
-- See docs/ADVANCE_SETOFF_POSITIONS.md §2 and §3.
--
-- Layer 1 (the balance engine) derives the open advance from the GSTR-1 JSONs
-- already stored, because Table 11A/11B carry only place of supply, rate and
-- supply type. That gives the BALANCE and nothing else. This layer records the
-- receipt vouchers and the invoice legs that close them out, which is what a
-- working paper needs and what the JSON can never provide.
--
-- The two layers reconcile, they do not compete. The filed GSTR-1 stays the
-- source of truth for the balance; the register is checked AGAINST it (rule 8
-- in advanceSetoffCheck). A register that silently replaced the returns as the
-- balance would be a second source of truth that drifts.
--
-- RLS open to public per the project's standing rule (no Supabase auth session
-- exists, so auth.uid() is always NULL and any policy gated on it fails
-- closed). Authorisation is enforced in the app layer.

-- ---------------------------------------------------------------------------
-- Receipt vouchers — the Table 11A leg.
-- ---------------------------------------------------------------------------
CREATE TABLE public.advance_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- Reserved for the contractor projects layer (Phase 4). Nullable and
  -- unconstrained for now so Phase 4 can add the FK without a data migration.
  project_id UUID,

  receipt_no TEXT NOT NULL DEFAULT '',
  receipt_date DATE NOT NULL,
  -- MM/YYYY — the period whose Table 11A this receipt was reported in.
  period_month TEXT NOT NULL,

  party_gstin TEXT NOT NULL DEFAULT '',
  party_name TEXT NOT NULL DEFAULT '',

  -- Must match how Table 11A is keyed, or the register can never be
  -- reconciled against the return.
  pos TEXT NOT NULL,
  rate_pct NUMERIC NOT NULL DEFAULT 0,
  sply_ty TEXT NOT NULL DEFAULT 'INTRA',

  -- What was received, and the value offered to tax once grossed down.
  gross_amount NUMERIC NOT NULL DEFAULT 0,
  taxable_value NUMERIC NOT NULL DEFAULT 0,
  igst NUMERIC NOT NULL DEFAULT 0,
  cgst NUMERIC NOT NULL DEFAULT 0,
  sgst NUMERIC NOT NULL DEFAULT 0,
  cess NUMERIC NOT NULL DEFAULT 0,

  -- 'SERVICE' | 'GOODS'. Only SERVICE creates a Table 11A liability:
  -- Notification 66/2017-CT removed tax-on-receipt for advances against goods.
  -- A GOODS row is a memo — it is tracked so a later invoice is not mistakenly
  -- 11B-adjusted against it, but it never contributes to the 11A position.
  supply_nature TEXT NOT NULL DEFAULT 'SERVICE',

  -- OPEN | PARTIAL | CLOSED | REFUNDED | WRITTEN_BACK. Derived from the
  -- adjustment legs on read; stored so a deliberate write-back or refund can
  -- close a receipt that no invoice will ever absorb.
  status TEXT NOT NULL DEFAULT 'OPEN',
  -- MANUAL | PASTE | GSTR1_11A
  source TEXT NOT NULL DEFAULT 'MANUAL',
  notes TEXT NOT NULL DEFAULT '',

  created_by UUID,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_advance_receipts_client_period ON public.advance_receipts(client_id, period_month);
CREATE INDEX idx_advance_receipts_party ON public.advance_receipts(client_id, party_gstin);
CREATE INDEX idx_advance_receipts_project ON public.advance_receipts(project_id);

ALTER TABLE public.advance_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "advance_receipts_all" ON public.advance_receipts
  FOR ALL TO public USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Adjustment legs — the Table 11B leg. One row per (receipt x invoice x rate),
-- the same shape builder_advance_adjustments uses, because that structure is
-- already proven against real returns.
--
-- A receipt has MANY legs: a government contractor's mobilisation advance is
-- recovered proportionately from every RA bill, so one receipt closes out over
-- a dozen invoices (Phase 4 computes the expected schedule; this table is what
-- it writes into).
-- ---------------------------------------------------------------------------
CREATE TABLE public.advance_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES public.advance_receipts(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id UUID,

  invoice_no TEXT NOT NULL DEFAULT '',
  invoice_date DATE,
  -- MM/YYYY — the period whose Table 11B carries this leg.
  period_month TEXT NOT NULL,

  rate_pct NUMERIC NOT NULL DEFAULT 0,
  consideration_adjusted NUMERIC NOT NULL DEFAULT 0,
  taxable_value_adjusted NUMERIC NOT NULL DEFAULT 0,
  igst NUMERIC NOT NULL DEFAULT 0,
  cgst NUMERIC NOT NULL DEFAULT 0,
  sgst NUMERIC NOT NULL DEFAULT 0,
  cess NUMERIC NOT NULL DEFAULT 0,

  -- INVOICE | REFUND_TO_PARTY | CANCELLATION | WRITE_BACK. Only INVOICE is a
  -- Table 11B adjustment; the others close a receipt without one, and must not
  -- be reported as an adjustment of advance.
  reason TEXT NOT NULL DEFAULT 'INVOICE',

  -- Amendment chain. An amended leg RESTATES an earlier one rather than adding
  -- to it (§7), so `amends_adjustment_id` points at what it supersedes and
  -- `original_period` is the MM/YYYY that Table 11(2)'s `omon` will carry.
  amends_adjustment_id UUID REFERENCES public.advance_adjustments(id) ON DELETE SET NULL,
  original_period TEXT,
  amendment_reason TEXT NOT NULL DEFAULT '',

  created_by UUID,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_advance_adjustments_receipt ON public.advance_adjustments(receipt_id);
CREATE INDEX idx_advance_adjustments_client_period ON public.advance_adjustments(client_id, period_month);
CREATE INDEX idx_advance_adjustments_amends ON public.advance_adjustments(amends_adjustment_id);

ALTER TABLE public.advance_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "advance_adjustments_all" ON public.advance_adjustments
  FOR ALL TO public USING (true) WITH CHECK (true);
