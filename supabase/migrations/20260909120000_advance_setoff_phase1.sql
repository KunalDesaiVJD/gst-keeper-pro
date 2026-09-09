-- Advance receipt & set-off — Phase 1 storage.
-- See docs/ADVANCE_SETOFF_POSITIONS.md; §3 for opening balances, §6 for the
-- override governance these two tables carry.
--
-- Nothing here stores the advance balance itself: that is derived on read from
-- the GSTR-1 JSONs already in gstr1_data (§2, Layer 1). A stored balance would
-- be a second source of truth that silently drifts from the returns.
--
-- RLS stays open to public per the project's standing rule — this app never
-- establishes a Supabase auth session, so auth.uid() is always NULL and any
-- policy gated on it fails closed. Authorisation is enforced in the app layer
-- (canOverrideAdvanceSetoff / canApproveAdvanceOverride in AuthContext).

-- ---------------------------------------------------------------------------
-- Opening balances — for clients whose advance history predates the app's
-- first imported return. Without this the engine treats a pre-app advance as
-- never having existed and never prompts for its set-off.
--
-- Keyed the same way Table 11A is reported (POS + rate + supply type), because
-- that is the only granularity the GSTR-1 JSON carries.
-- ---------------------------------------------------------------------------
CREATE TABLE public.advance_opening_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- MM/YYYY. The balance is treated as open from the START of this period.
  as_on_period TEXT NOT NULL,
  pos TEXT NOT NULL,
  rate_pct NUMERIC NOT NULL DEFAULT 0,
  -- 'INTRA' | 'INTER'
  sply_ty TEXT NOT NULL DEFAULT 'INTRA',
  taxable NUMERIC NOT NULL DEFAULT 0,
  igst NUMERIC NOT NULL DEFAULT 0,
  cgst NUMERIC NOT NULL DEFAULT 0,
  sgst NUMERIC NOT NULL DEFAULT 0,
  cess NUMERIC NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  -- An opening balance that is wrong makes the ledger permanently wrong, so
  -- who entered it is part of the record, not an audit nicety.
  entered_by UUID,
  entered_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One row per key per client: two opening balances for the same POS+rate
  -- would silently double the opening position.
  CONSTRAINT advance_opening_balances_unique_key UNIQUE (client_id, pos, rate_pct, sply_ty)
);

CREATE INDEX idx_advance_opening_balances_client ON public.advance_opening_balances(client_id);

ALTER TABLE public.advance_opening_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "advance_opening_balances_all" ON public.advance_opening_balances
  FOR ALL TO public USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Override requests and decisions.
--
-- An employee hitting a hard block requests an override with a reason; a GST
-- Manager approves or rejects. Filing stays blocked while status = 'PENDING'.
-- A manager hitting the block self-overrides in one step, recorded identically
-- with requested_by = decided_by.
--
-- findings_fingerprint binds the approval to the findings the approver saw. If
-- the draft changes, the checker's fingerprint changes, the stored approval no
-- longer matches, and the block returns (the app marks it LAPSED). Approving
-- once must not authorise filing anything.
-- ---------------------------------------------------------------------------
CREATE TABLE public.advance_setoff_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- MM/YYYY
  period_month TEXT NOT NULL,
  -- Which gate was being passed: 'GSTR-1' | 'GSTR-3B' | 'FILING_STATUS'.
  -- Scoped deliberately: an override never carries to another return or month.
  return_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'hard',
  -- The full AdvanceFinding[] as the requester saw it, so the certificate PDF
  -- can be reprinted years later without re-deriving anything.
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  findings_fingerprint TEXT NOT NULL DEFAULT '',
  requested_by UUID,
  requested_by_name TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_reason TEXT NOT NULL,
  -- PENDING | APPROVED | REJECTED | LAPSED
  status TEXT NOT NULL DEFAULT 'PENDING',
  decided_by UUID,
  decided_by_name TEXT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT NOT NULL DEFAULT '',
  -- Set once the return actually goes out under this override, with its ARN
  -- where we have one — this is what makes the row evidence rather than intent.
  filed_after_override BOOLEAN NOT NULL DEFAULT FALSE,
  arn TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_advance_setoff_overrides_lookup
  ON public.advance_setoff_overrides(client_id, period_month, return_type);
-- The manager's pending-approvals inbox reads this one.
CREATE INDEX idx_advance_setoff_overrides_status
  ON public.advance_setoff_overrides(status) WHERE status = 'PENDING';

ALTER TABLE public.advance_setoff_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "advance_setoff_overrides_all" ON public.advance_setoff_overrides
  FOR ALL TO public USING (true) WITH CHECK (true);
