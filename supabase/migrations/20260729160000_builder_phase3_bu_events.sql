-- ─────────────────────────────────────────────────────────────────────────
-- BUILDER MODULE — PHASE 3: BU events and the unit-wise differential
--
-- THE FIRM'S PRACTICE. For every unit booked before its cut-off, the entire
-- balance consideration becomes taxable in the BU month, received or not.
-- Anchored in s.31(5)(c) r/w s.13(2)(a): where payment is linked to the
-- completion of an event, the invoice falls due on the date that event
-- completes. BU is that event — the construction service is fully rendered.
--
-- THE CUT-OFF is the EARLIER of the block's BU date and the unit's dastavej
-- (registered sale deed) date. A unit registered before BU therefore closes out
-- at dastavej rather than waiting for BU.
--
-- THE BASE. The differential deducts value on which GST was DISCHARGED up to
-- the OPENING of the BU month — not money received, and not including anything
-- in the BU month itself:
--
--     differential = agreement value - value taxed up to opening of BU month
--
-- Receipts falling inside the BU month for a unit in the event are therefore
-- SUBSUMED into the differential, never taxed separately. That is what
-- builder_receipts.subsumed_by_bu_event_id records.
--
-- HOW IT POSTS. The differential is the NET liability, but GSTR-1 needs the
-- gross legs, because advances sitting in Table 11A must eventually be adjusted
-- out through Table 11B rather than left open forever:
--
--     BU invoice (Table 7) = agreement value - invoices already raised
--     Advance adjusted (11B) = open advances at opening of the BU month
--     Net into 3B 3.1(a)     = differential
--
-- Both routes agree by construction, and afterwards the unit's value taxed ties
-- exactly to its agreement value.
--
-- UNBOOKED AT CUT-OFF. Schedule III para 5 — sale of a building after the
-- completion certificate is not a supply at all. Those units are omitted
-- entirely from GSTR-1 and 3B, and instead feed the TDR/FSI working.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. builder_bu_events ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_bu_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,

  -- The date printed on the BU permission, not the date it reached the firm.
  bu_date         date NOT NULL,
  bu_ref_no       text,

  -- FULL sweeps in every unit not already covered by an earlier event; UNITS
  -- covers an explicit selection, since BU permission can arrive block-wise or
  -- even wing-wise.
  scope           text NOT NULL DEFAULT 'FULL' CHECK (scope IN ('FULL','UNITS')),

  -- When the firm learned of the BU. Differs from bu_date on a back-dated
  -- permission, and that gap is what the interest schedule runs over.
  discovered_on   date,

  -- DISCOVERY                 post in the current open month, no interest
  -- BU_MONTH                  post in the BU month; flags an already-filed return
  -- DISCOVERY_WITH_INTEREST   post now, with s.50 interest from the BU month's
  --                           due date. The default: the liability belongs to
  --                           the BU month and GST returns cannot be revised.
  posting_basis   text NOT NULL DEFAULT 'DISCOVERY_WITH_INTEREST'
                    CHECK (posting_basis IN ('DISCOVERY','BU_MONTH','DISCOVERY_WITH_INTEREST')),
  posting_period  text NOT NULL,            -- 'MM/YYYY'

  status          text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','PREPARED','POSTED')),
  posted_at       timestamptz,
  posted_by       uuid,

  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid
);
CREATE INDEX IF NOT EXISTS idx_builder_bu_events_project ON public.builder_bu_events(project_id);

COMMENT ON COLUMN public.builder_bu_events.posting_basis IS
  'DISCOVERY_WITH_INTEREST is the default: the liability belongs to the BU month, and returns cannot be revised.';

-- ── 2. builder_bu_event_units ──────────────────────────────────────────────
-- The unit-wise working, persisted so it can be reviewed before posting and
-- reproduced afterwards exactly as it stood.
CREATE TABLE IF NOT EXISTS public.builder_bu_event_units (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bu_event_id             uuid NOT NULL REFERENCES public.builder_bu_events(id) ON DELETE CASCADE,
  unit_id                 uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,

  -- LEAST(bu_date, dastavej_date); BU alone where no deed is registered.
  cut_off_date            date NOT NULL,
  cut_off_source          text NOT NULL DEFAULT 'BU' CHECK (cut_off_source IN ('BU','DASTAVEJ')),

  -- Booked before the cut-off => taxable. Unbooked => Schedule III, omitted.
  booked_at_cutoff        boolean NOT NULL DEFAULT false,
  booking_id              uuid REFERENCES public.builder_bookings(id) ON DELETE SET NULL,

  -- Snapshot of the classification at the moment of the working.
  unit_type               text NOT NULL,
  carpet_area_sqm         numeric NOT NULL DEFAULT 0,
  rate_code               text NOT NULL,
  rate_pct                numeric NOT NULL DEFAULT 0,

  agreement_value         numeric NOT NULL DEFAULT 0,
  -- The P6 base: value taxed as at the OPENING of the BU month.
  value_taxed_upto_opening numeric NOT NULL DEFAULT 0,
  invoiced_before         numeric NOT NULL DEFAULT 0,
  open_advance_before     numeric NOT NULL DEFAULT 0,
  received_upto_cutoff    numeric NOT NULL DEFAULT 0,  -- memo only

  -- The net incremental liability.
  differential_value      numeric NOT NULL DEFAULT 0,
  differential_taxable_value numeric NOT NULL DEFAULT 0,
  differential_cgst       numeric NOT NULL DEFAULT 0,
  differential_sgst       numeric NOT NULL DEFAULT 0,

  -- s.50 interest, where the posting basis calls for it.
  interest_days           int NOT NULL DEFAULT 0,
  interest_amount         numeric NOT NULL DEFAULT 0,

  -- agreement - (value taxed after posting). Anything but zero needs a look.
  tie_out_diff            numeric NOT NULL DEFAULT 0,

  -- The BU_DIFFERENTIAL invoice created when the event is posted.
  invoice_id              uuid REFERENCES public.builder_invoices(id) ON DELETE SET NULL,
  subsumed_receipt_count  int NOT NULL DEFAULT 0,

  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  -- A unit belongs to exactly one BU event, ever. To move it, remove it from
  -- the first.
  UNIQUE (unit_id)
);
CREATE INDEX IF NOT EXISTS idx_builder_bu_event_units_event ON public.builder_bu_event_units(bu_event_id);

COMMENT ON COLUMN public.builder_bu_event_units.value_taxed_upto_opening IS
  'Value on which GST was discharged up to the opening of the BU month. Receipts inside the BU month are subsumed, not deducted here.';

-- ── 3. Receipt subsumption + unit linkage ──────────────────────────────────
-- A receipt inside the BU month for a unit in the event is covered by the
-- differential, so it must stop posting to Table 11A on its own account.
ALTER TABLE public.builder_receipts
  ADD COLUMN IF NOT EXISTS subsumed_by_bu_event_id uuid
    REFERENCES public.builder_bu_events(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_builder_receipts_subsumed
  ON public.builder_receipts(subsumed_by_bu_event_id)
  WHERE subsumed_by_bu_event_id IS NOT NULL;

ALTER TABLE public.builder_units
  ADD COLUMN IF NOT EXISTS bu_event_id uuid
    REFERENCES public.builder_bu_events(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.builder_receipts.subsumed_by_bu_event_id IS
  'Receipt fell inside the BU month and is covered by the differential — posts nothing on its own.';

-- ── 4. Postings view — exclude subsumed receipts ───────────────────────────
-- Same three legs as Phase 2, with the subsumption rule added to the 11A leg.
-- The BU differential itself needs no new leg: it posts as a
-- BU_DIFFERENTIAL invoice and rides the existing Table 7 and 11B legs.
CREATE OR REPLACE VIEW public.builder_period_postings AS
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
  AND r.subsumed_by_bu_event_id IS NULL

UNION ALL

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

-- ── 5. Unit ledger — same subsumption rule ─────────────────────────────────
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
  WHERE receipt_nature = 'ADVANCE' AND cheque_status <> 'Bounced'
    AND gst_already_discharged = false AND subsumed_by_bu_event_id IS NULL
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
  SELECT unit_id,
         SUM(COALESCE(bank_credit, consideration + cgst + sgst - tds_194ia)) AS received,
         SUM(tds_194ia) AS tds
  FROM public.builder_receipts WHERE cheque_status <> 'Bounced' GROUP BY unit_id
) rec ON rec.unit_id = u.id;

-- ── 6. Dastavej reconciliation view ────────────────────────────────────────
-- A registered sale deed creates no GST of its own — by then the unit is fully
-- taxed. Its job is to reconcile: deed value against the value actually offered
-- to tax, so a variance surfaces instead of sitting unnoticed until an audit.
CREATE OR REPLACE VIEW public.builder_dastavej_reco AS
SELECT
  u.id                AS unit_id,
  u.project_id,
  p.client_id,
  p.name              AS project_name,
  u.unit_no,
  u.unit_type,
  u.status            AS unit_status,
  u.dastavej_date,
  u.dastavej_value,
  COALESCE(ob.agreement_value, 0) AS opening_agreement_value,
  l.value_taxed,
  beu.bu_event_id,
  ev.bu_date,
  beu.booked_at_cutoff,
  CASE
    WHEN u.dastavej_value IS NULL THEN NULL
    ELSE ROUND(u.dastavej_value - l.value_taxed, 2)
  END                 AS variance
FROM public.builder_units u
JOIN public.builder_projects    p ON p.id = u.project_id
JOIN public.builder_unit_ledger l ON l.unit_id = u.id
LEFT JOIN public.builder_opening_balances ob ON ob.unit_id = u.id
LEFT JOIN public.builder_bu_event_units   beu ON beu.unit_id = u.id
LEFT JOIN public.builder_bu_events        ev  ON ev.id = beu.bu_event_id
WHERE u.dastavej_date IS NOT NULL OR u.dastavej_value IS NOT NULL;

COMMENT ON VIEW public.builder_dastavej_reco IS
  'Deed value vs value offered to tax. Registration itself is not a taxable event under the firm''s model.';

-- ── 7. updated_at trigger ──────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_builder_bu_events_updated_at ON public.builder_bu_events;
CREATE TRIGGER trg_builder_bu_events_updated_at BEFORE UPDATE ON public.builder_bu_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 8. RLS: staff-only ─────────────────────────────────────────────────────
ALTER TABLE public.builder_bu_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_bu_event_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff manage builder_bu_events" ON public.builder_bu_events;
CREATE POLICY "staff manage builder_bu_events" ON public.builder_bu_events
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff manage builder_bu_event_units" ON public.builder_bu_event_units;
CREATE POLICY "staff manage builder_bu_event_units" ON public.builder_bu_event_units
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_bu_events      TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_bu_event_units TO anon, authenticated;
GRANT SELECT ON public.builder_dastavej_reco TO anon, authenticated;
