-- ─────────────────────────────────────────────────────────────────────────
-- BUILDER MODULE — PHASE 2: bookings, members, receipts, invoices, postings
--
-- The firm invoices only at milestones and at BU, so most money arrives as an
-- ADVANCE and bears tax in the month of receipt (s.13(2); Notification 66/2017
-- exempts advances for goods only, never for services). That advance is
-- reported in GSTR-1 Table 11A. When a milestone invoice is later raised, the
-- full invoice goes to Table 7 (B2CS) and the advance it absorbs is reversed in
-- Table 11B, so the same rupee is never taxed twice.
--
-- THE LEDGER INVARIANT
-- Every rupee of a unit's consideration sits in exactly one state at a time:
--     open_advance -> invoiced -> bu_differential_taxed -> reversed
-- Value moves between states; it is never taxed on entering the second.
--
--     value taxed = opening
--                 + SUM(advance receipts)
--                 + SUM(invoices)
--                 - SUM(advance adjustments)
--
-- That figure — not money received — is what the BU differential deducts from
-- in Phase 3.
--
-- All supply is intra-state: under s.12(3)(a) IGST Act the place of supply for
-- a service in relation to immovable property is the property's location, so
-- only CGST and SGST ever arise.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. builder_bookings ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_bookings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id                 uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  booking_date            date NOT NULL,

  -- Consideration agreed at booking. Snapshotted because the unit master can
  -- move afterwards (a PLC or parking charge added later is exactly what pushes
  -- a unit past Rs. 45 lakh), and the working papers must show both.
  total_consideration     numeric NOT NULL DEFAULT 0 CHECK (total_consideration >= 0),

  status                  text NOT NULL DEFAULT 'Active'
                            CHECK (status IN ('Active','Cancelled','Converted')),
  cancelled_on            date,
  cancellation_reason     text,
  -- Set when the member moves to another unit (Phase 4 conversion engine).
  converted_to_booking_id uuid REFERENCES public.builder_bookings(id) ON DELETE SET NULL,

  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid
);
CREATE INDEX IF NOT EXISTS idx_builder_bookings_unit ON public.builder_bookings(unit_id);
-- A unit can carry only one live booking; cancelled and converted ones remain
-- as history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_builder_bookings_active_unit
  ON public.builder_bookings(unit_id) WHERE status = 'Active';

-- ── 2. builder_booking_members ─────────────────────────────────────────────
-- Joint buyers share a unit in an agreed ratio, which is also how the 194-IA
-- deduction is split between them.
CREATE TABLE IF NOT EXISTS public.builder_booking_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES public.builder_bookings(id) ON DELETE CASCADE,
  name            text NOT NULL,
  pan             text,
  ownership_ratio numeric NOT NULL DEFAULT 100 CHECK (ownership_ratio > 0 AND ownership_ratio <= 100),
  email           text,
  phone           text,
  is_primary      boolean NOT NULL DEFAULT false,
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_builder_members_booking ON public.builder_booking_members(booking_id);

-- ── 3. builder_receipts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_receipts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id             uuid NOT NULL REFERENCES public.builder_bookings(id) ON DELETE CASCADE,
  unit_id                uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  receipt_date           date NOT NULL,

  -- ADVANCE          → tax now, reported in GSTR-1 Table 11A
  -- AGAINST_INVOICE  → collection only; the tax already went out with the
  --                    invoice, so this posts nothing
  receipt_nature         text NOT NULL DEFAULT 'ADVANCE'
                           CHECK (receipt_nature IN ('ADVANCE','AGAINST_INVOICE')),

  -- What was keyed, and whether that figure already carries GST.
  amount_entered         numeric NOT NULL DEFAULT 0 CHECK (amount_entered >= 0),
  amount_is_gst_inclusive boolean NOT NULL DEFAULT false,

  -- Derived. `consideration` is exclusive of GST and is the figure that counts
  -- toward the unit's value-taxed total. Where the entered amount was
  -- inclusive, this is the Rule 35 back-calculation:
  --     tax = inclusive x effective rate / (100 + effective rate)
  consideration          numeric NOT NULL DEFAULT 0,
  rate_code              text NOT NULL CHECK (rate_code IN
                           ('AFFORDABLE','OTHER_RESIDENTIAL','COMMERCIAL_RREP','COMMERCIAL_REP')),
  rate_pct               numeric NOT NULL DEFAULT 0,   -- notified, on 2/3rd value
  taxable_value          numeric NOT NULL DEFAULT 0,   -- 2/3rd of consideration
  cgst                   numeric NOT NULL DEFAULT 0,
  sgst                   numeric NOT NULL DEFAULT 0,

  -- Income-tax TDS u/s 194-IA. Recorded because the builder banks less than the
  -- consideration, NOT because it reduces the GST base — GST is computed on the
  -- full consideration regardless.
  tds_194ia              numeric NOT NULL DEFAULT 0 CHECK (tds_194ia >= 0),
  bank_credit            numeric,   -- money actually credited; memo, for variance

  instrument_type        text NOT NULL DEFAULT 'NEFT/RTGS'
                           CHECK (instrument_type IN
                             ('Cheque','NEFT/RTGS','UPI','Cash','Bank Transfer','Adjustment','Other')),
  instrument_ref         text,

  -- Time of supply attaches on entry in the books (Explanation to s.13), so a
  -- cheque is recognised before it clears and held provisional until it does.
  cheque_status          text NOT NULL DEFAULT 'Cleared'
                           CHECK (cheque_status IN ('Cleared','Pending','Bounced','Replaced')),
  bounced_on             date,

  -- Set when this receipt replaces an earlier one. Together with
  -- gst_already_discharged this is what stops a funding swap (member's own
  -- money returned, bank disbursement received for the same unit) being taxed
  -- a second time — the consideration never changed, only its source.
  replaces_receipt_id    uuid REFERENCES public.builder_receipts(id) ON DELETE SET NULL,
  gst_already_discharged boolean NOT NULL DEFAULT false,

  period_month           text NOT NULL,   -- 'MM/YYYY' the liability falls in
  doc_series             text,
  doc_no                 text,            -- receipt voucher no. u/s 31(3)(d)
  notes                  text,

  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid
);
CREATE INDEX IF NOT EXISTS idx_builder_receipts_booking ON public.builder_receipts(booking_id);
CREATE INDEX IF NOT EXISTS idx_builder_receipts_unit    ON public.builder_receipts(unit_id);
CREATE INDEX IF NOT EXISTS idx_builder_receipts_period  ON public.builder_receipts(period_month);

COMMENT ON COLUMN public.builder_receipts.gst_already_discharged IS
  'Money in, but no fresh GST — the consideration was already taxed on the receipt this one replaces.';
COMMENT ON COLUMN public.builder_receipts.tds_194ia IS
  'Income-tax TDS. Has no GST effect: tax is computed on the full consideration, never on the net banked.';

-- ── 4. builder_invoices ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES public.builder_bookings(id) ON DELETE CASCADE,
  unit_id           uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  invoice_date      date NOT NULL,

  invoice_type      text NOT NULL DEFAULT 'MILESTONE'
                      CHECK (invoice_type IN
                        ('MILESTONE','BU_DIFFERENTIAL','SUPPLEMENTARY','CONVERSION','DELAY_INTEREST')),
  milestone_label   text,

  consideration     numeric NOT NULL DEFAULT 0 CHECK (consideration >= 0),
  rate_code         text NOT NULL CHECK (rate_code IN
                      ('AFFORDABLE','OTHER_RESIDENTIAL','COMMERCIAL_RREP','COMMERCIAL_REP')),
  rate_pct          numeric NOT NULL DEFAULT 0,
  taxable_value     numeric NOT NULL DEFAULT 0,
  cgst              numeric NOT NULL DEFAULT 0,
  sgst              numeric NOT NULL DEFAULT 0,

  period_month      text NOT NULL,
  doc_series        text,
  doc_no            text,
  notes             text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);
CREATE INDEX IF NOT EXISTS idx_builder_invoices_booking ON public.builder_invoices(booking_id);
CREATE INDEX IF NOT EXISTS idx_builder_invoices_unit    ON public.builder_invoices(unit_id);
CREATE INDEX IF NOT EXISTS idx_builder_invoices_period  ON public.builder_invoices(period_month);

-- ── 5. builder_advance_adjustments ─────────────────────────────────────────
-- The 11B leg. One row per (invoice, receipt) pair absorbed, so a single
-- invoice can soak up several advances and an advance can be split across
-- invoices. The sum of these against a receipt can never exceed it.
CREATE TABLE IF NOT EXISTS public.builder_advance_adjustments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id            uuid NOT NULL REFERENCES public.builder_invoices(id) ON DELETE CASCADE,
  receipt_id            uuid NOT NULL REFERENCES public.builder_receipts(id) ON DELETE CASCADE,
  consideration_adjusted numeric NOT NULL DEFAULT 0 CHECK (consideration_adjusted >= 0),
  taxable_value_adjusted numeric NOT NULL DEFAULT 0,
  cgst                  numeric NOT NULL DEFAULT 0,
  sgst                  numeric NOT NULL DEFAULT 0,
  rate_code             text NOT NULL,
  rate_pct              numeric NOT NULL DEFAULT 0,
  period_month          text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  UNIQUE (invoice_id, receipt_id)
);
CREATE INDEX IF NOT EXISTS idx_builder_adj_invoice ON public.builder_advance_adjustments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_builder_adj_receipt ON public.builder_advance_adjustments(receipt_id);
CREATE INDEX IF NOT EXISTS idx_builder_adj_period  ON public.builder_advance_adjustments(period_month);

-- ── 6. builder_period_postings ─────────────────────────────────────────────
-- The single feed into GSTR-1 and 3B, derived rather than stored so it can
-- never drift from its sources. Later phases (BU differential, conversions,
-- bounce reversals) union additional legs onto this view.
--
--   ADVANCE_11A  → GSTR-1 Table 11A, tax liability on advances received
--   ADVANCE_11B  → GSTR-1 Table 11B, adjustment of advances (negative)
--   INVOICE_B2CS → GSTR-1 Table 7, supplies to unregistered persons
--
-- All three roll into 3B Table 3.1(a). Table 5 (B2CL), CDNUR and 3B Table 3.2
-- cannot arise — see the intra-state note at the head of this file.
CREATE OR REPLACE VIEW public.builder_period_postings AS
-- 11A: advances received. A bounced cheque never became consideration, and a
-- replacement receipt whose GST already went out with the original posts
-- nothing.
SELECT
  r.id                AS source_id,
  'ADVANCE_11A'::text AS source_type,
  'Table 11A'::text   AS gstr1_table,
  p.client_id,
  p.id                AS project_id,
  u.id                AS unit_id,
  u.unit_no,
  r.booking_id,
  r.period_month,
  r.receipt_date      AS doc_date,
  r.rate_code,
  r.rate_pct,
  r.consideration,
  r.taxable_value,
  r.cgst,
  r.sgst
FROM public.builder_receipts r
JOIN public.builder_units    u ON u.id = r.unit_id
JOIN public.builder_projects p ON p.id = u.project_id
WHERE r.receipt_nature = 'ADVANCE'
  AND r.cheque_status <> 'Bounced'
  AND r.gst_already_discharged = false

UNION ALL

-- 11B: advances absorbed into an invoice. Negative, so the rupee taxed at
-- receipt is not taxed again inside the invoice.
SELECT
  a.id                AS source_id,
  'ADVANCE_11B'::text AS source_type,
  'Table 11B'::text   AS gstr1_table,
  p.client_id,
  p.id                AS project_id,
  u.id                AS unit_id,
  u.unit_no,
  i.booking_id,
  a.period_month,
  i.invoice_date      AS doc_date,
  a.rate_code,
  a.rate_pct,
  -a.consideration_adjusted  AS consideration,
  -a.taxable_value_adjusted  AS taxable_value,
  -a.cgst                    AS cgst,
  -a.sgst                    AS sgst
FROM public.builder_advance_adjustments a
JOIN public.builder_invoices i ON i.id = a.invoice_id
JOIN public.builder_units    u ON u.id = i.unit_id
JOIN public.builder_projects p ON p.id = u.project_id

UNION ALL

-- Table 7: the invoices themselves. Buyers are unregistered individuals and
-- the property is intra-state, so B2CS is the only outward table in play.
SELECT
  i.id                 AS source_id,
  'INVOICE_B2CS'::text AS source_type,
  'Table 7'::text      AS gstr1_table,
  p.client_id,
  p.id                 AS project_id,
  u.id                 AS unit_id,
  u.unit_no,
  i.booking_id,
  i.period_month,
  i.invoice_date       AS doc_date,
  i.rate_code,
  i.rate_pct,
  i.consideration,
  i.taxable_value,
  i.cgst,
  i.sgst
FROM public.builder_invoices i
JOIN public.builder_units    u ON u.id = i.unit_id
JOIN public.builder_projects p ON p.id = u.project_id;

COMMENT ON VIEW public.builder_period_postings IS
  'Derived feed into GSTR-1 Tables 11A/11B/7 and 3B Table 3.1(a). Never stored, so it cannot drift.';

-- ── 7. Per-unit ledger view ────────────────────────────────────────────────
-- "Value taxed" is the base the BU differential deducts from. Note the shape:
-- advances add, invoices add, adjustments subtract — so an advance later
-- absorbed into an invoice is counted once, not twice.
CREATE OR REPLACE VIEW public.builder_unit_ledger AS
SELECT
  u.id                                AS unit_id,
  u.project_id,
  p.client_id,
  u.unit_no,
  COALESCE(ob.cumulative_value_taxed, 0)
    + COALESCE(adv.consideration, 0)
    + COALESCE(inv.consideration, 0)
    - COALESCE(adj.consideration, 0)  AS value_taxed,
  COALESCE(ob.cumulative_cgst, 0) + COALESCE(adv.cgst, 0)
    + COALESCE(inv.cgst, 0) - COALESCE(adj.cgst, 0)     AS cgst_discharged,
  COALESCE(ob.cumulative_sgst, 0) + COALESCE(adv.sgst, 0)
    + COALESCE(inv.sgst, 0) - COALESCE(adj.sgst, 0)     AS sgst_discharged,
  -- Advances still sitting open, i.e. received but not yet absorbed by an
  -- invoice. This is what a milestone invoice draws down.
  COALESCE(adv.consideration, 0) - COALESCE(adj.consideration, 0) AS open_advance,
  COALESCE(rec.received, 0)           AS total_received,
  COALESCE(rec.tds, 0)                AS total_tds_194ia,
  COALESCE(ob.agreement_value, 0)     AS opening_agreement_value,
  COALESCE(ob.cumulative_value_taxed, 0) AS opening_value_taxed
FROM public.builder_units u
JOIN public.builder_projects p ON p.id = u.project_id
LEFT JOIN public.builder_opening_balances ob ON ob.unit_id = u.id
LEFT JOIN (
  SELECT unit_id, SUM(consideration) AS consideration, SUM(cgst) AS cgst, SUM(sgst) AS sgst
  FROM public.builder_receipts
  WHERE receipt_nature = 'ADVANCE' AND cheque_status <> 'Bounced' AND gst_already_discharged = false
  GROUP BY unit_id
) adv ON adv.unit_id = u.id
LEFT JOIN (
  SELECT unit_id, SUM(consideration) AS consideration, SUM(cgst) AS cgst, SUM(sgst) AS sgst
  FROM public.builder_invoices GROUP BY unit_id
) inv ON inv.unit_id = u.id
LEFT JOIN (
  SELECT i.unit_id,
         SUM(a.consideration_adjusted) AS consideration,
         SUM(a.cgst) AS cgst, SUM(a.sgst) AS sgst
  FROM public.builder_advance_adjustments a
  JOIN public.builder_invoices i ON i.id = a.invoice_id
  GROUP BY i.unit_id
) adj ON adj.unit_id = u.id
LEFT JOIN (
  -- Money actually in, regardless of how it was characterised for GST.
  SELECT unit_id,
         SUM(COALESCE(bank_credit, consideration + cgst + sgst - tds_194ia)) AS received,
         SUM(tds_194ia) AS tds
  FROM public.builder_receipts WHERE cheque_status <> 'Bounced' GROUP BY unit_id
) rec ON rec.unit_id = u.id;

COMMENT ON VIEW public.builder_unit_ledger IS
  'Per-unit position. value_taxed = opening + advances + invoices - adjustments; the BU differential deducts this, not total_received.';

-- ── 8. updated_at triggers ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_builder_bookings_updated_at ON public.builder_bookings;
CREATE TRIGGER trg_builder_bookings_updated_at BEFORE UPDATE ON public.builder_bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_builder_receipts_updated_at ON public.builder_receipts;
CREATE TRIGGER trg_builder_receipts_updated_at BEFORE UPDATE ON public.builder_receipts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_builder_invoices_updated_at ON public.builder_invoices;
CREATE TRIGGER trg_builder_invoices_updated_at BEFORE UPDATE ON public.builder_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 9. RLS: staff-only ─────────────────────────────────────────────────────
ALTER TABLE public.builder_bookings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_booking_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_receipts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_invoices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_advance_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff manage builder_bookings" ON public.builder_bookings;
CREATE POLICY "staff manage builder_bookings" ON public.builder_bookings
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff manage builder_booking_members" ON public.builder_booking_members;
CREATE POLICY "staff manage builder_booking_members" ON public.builder_booking_members
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff manage builder_receipts" ON public.builder_receipts;
CREATE POLICY "staff manage builder_receipts" ON public.builder_receipts
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff manage builder_invoices" ON public.builder_invoices;
CREATE POLICY "staff manage builder_invoices" ON public.builder_invoices
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff manage builder_advance_adjustments" ON public.builder_advance_adjustments;
CREATE POLICY "staff manage builder_advance_adjustments" ON public.builder_advance_adjustments
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_bookings            TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_booking_members     TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_receipts            TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_invoices            TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_advance_adjustments TO anon, authenticated;
GRANT SELECT ON public.builder_period_postings TO anon, authenticated;
GRANT SELECT ON public.builder_unit_ledger     TO anon, authenticated;
