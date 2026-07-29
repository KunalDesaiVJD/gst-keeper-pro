-- ─────────────────────────────────────────────────────────────────────────
-- BUILDER MODULE — PHASE 4: the things that go wrong after the fact
--
-- Five mechanisms, each answering a different question:
--
--  1. RECLASSIFICATION  A unit taxed at 1.5% turns out never to have been
--     affordable, because its gross consideration crossed Rs. 45 lakh. The
--     concession never applied, so 7.5% is due on everything already offered to
--     tax. All buyers are unregistered, so the correction is an AMENDMENT of the
--     earlier B2CS entries in Table 10, not a debit note. Interest u/s 50 runs
--     from EACH original period's due date, which is why the schedule is
--     period-wise rather than a single lump.
--
--  2. CONVERSION  A member moves from one unit to another. Not a ledger entry —
--     a cancellation plus a fresh booking. Where the rates differ the carried
--     value is re-taxed, and if the credit-note window on the old unit has
--     closed the old tax cannot be recovered at all.
--
--  3. CREDIT NOTES  Cancellations, conversions and downward dastavej variances.
--     s.34 permits the tax adjustment only until 30 November following the
--     financial year of the original document. Intra-state B2C notes are netted
--     inside Table 7 — CDNUR is for inter-state unregistered supplies, which
--     cannot arise here.
--
--  4. BOUNCE REVERSALS  A cheque that bounces after the return is filed. Only
--     available where the receipt was an un-invoiced advance: on an invoiced
--     amount with the booking intact there is no s.34 ground, the payment simply
--     failed. Offsets against later months at the SAME rate in the SAME project,
--     carrying forward what will not fit — the portal rejects a negative 11A.
--
--  5. EXCESS TAX  A receipt inclusive of GST on which tax was computed over the
--     whole figure, so tax was paid on the tax. Restating it under Rule 35 both
--     books the excess and RAISES the BU differential, because the overstated
--     consideration had inflated the unit's value taxed.
-- ─────────────────────────────────────────────────────────────────────────

-- Delay interest recovered from members is billed at a flat 18% by election,
-- as a supply separate from construction — so no 1/3rd land deduction applies
-- to it. Only invoices can carry this code.
ALTER TABLE public.builder_invoices DROP CONSTRAINT IF EXISTS builder_invoices_rate_code_check;
ALTER TABLE public.builder_invoices ADD CONSTRAINT builder_invoices_rate_code_check
  CHECK (rate_code IN ('AFFORDABLE','OTHER_RESIDENTIAL','COMMERCIAL_RREP',
                       'COMMERCIAL_REP','DELAY_INTEREST_18'));

-- ── 1. builder_reclassifications ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_reclassifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id            uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  triggered_on       date NOT NULL DEFAULT CURRENT_DATE,

  from_rate_code     text NOT NULL,
  from_rate_pct      numeric NOT NULL,
  to_rate_code       text NOT NULL,
  to_rate_pct        numeric NOT NULL,

  -- What tipped it over. Usually a charge head added long after booking.
  gross_before       numeric NOT NULL DEFAULT 0,
  gross_after        numeric NOT NULL DEFAULT 0,
  reason             text,

  posting_period     text NOT NULL,                 -- 'MM/YYYY'
  total_value_retaxed numeric NOT NULL DEFAULT 0,
  total_differential_tax numeric NOT NULL DEFAULT 0,
  total_interest     numeric NOT NULL DEFAULT 0,

  status             text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED')),
  posted_at          timestamptz,
  posted_by          uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_builder_reclass_unit ON public.builder_reclassifications(unit_id);

-- Period-wise, because interest u/s 50 runs from each original period's due
-- date. A single aggregate would understate it.
CREATE TABLE IF NOT EXISTS public.builder_reclassification_periods (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reclassification_id uuid NOT NULL REFERENCES public.builder_reclassifications(id) ON DELETE CASCADE,
  period_month        text NOT NULL,                -- the original period
  taxable_value       numeric NOT NULL DEFAULT 0,   -- as originally reported
  old_cgst            numeric NOT NULL DEFAULT 0,
  old_sgst            numeric NOT NULL DEFAULT 0,
  new_cgst            numeric NOT NULL DEFAULT 0,
  new_sgst            numeric NOT NULL DEFAULT 0,
  differential_tax    numeric NOT NULL DEFAULT 0,
  due_date            date,
  interest_days       int NOT NULL DEFAULT 0,
  interest_amount     numeric NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reclassification_id, period_month)
);

-- ── 2. builder_credit_notes ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_credit_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  booking_id      uuid REFERENCES public.builder_bookings(id) ON DELETE SET NULL,
  note_date       date NOT NULL,
  note_type       text NOT NULL DEFAULT 'CANCELLATION'
                    CHECK (note_type IN ('CANCELLATION','CONVERSION','DASTAVEJ_VARIANCE','OTHER')),

  consideration   numeric NOT NULL DEFAULT 0 CHECK (consideration >= 0),
  rate_code       text NOT NULL,
  rate_pct        numeric NOT NULL DEFAULT 0,
  taxable_value   numeric NOT NULL DEFAULT 0,
  cgst            numeric NOT NULL DEFAULT 0,
  sgst            numeric NOT NULL DEFAULT 0,

  -- 30 November following the FY of the ORIGINAL document. Past it the tax
  -- cannot be adjusted; the buyer's own refund u/s 54 (Circular 188/20/2022) is
  -- then the only route.
  window_expiry   date,
  within_window   boolean NOT NULL DEFAULT true,

  period_month    text NOT NULL,
  doc_series      text,
  doc_no          text,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid
);
CREATE INDEX IF NOT EXISTS idx_builder_cn_unit   ON public.builder_credit_notes(unit_id);
CREATE INDEX IF NOT EXISTS idx_builder_cn_period ON public.builder_credit_notes(period_month);

COMMENT ON COLUMN public.builder_credit_notes.within_window IS
  'false => tax cannot be adjusted; recorded for the trail, and excluded from the postings feed.';

-- ── 3. builder_conversions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_conversions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_unit_id      uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  to_unit_id        uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  from_booking_id   uuid REFERENCES public.builder_bookings(id) ON DELETE SET NULL,
  to_booking_id     uuid REFERENCES public.builder_bookings(id) ON DELETE SET NULL,
  conversion_date   date NOT NULL,
  period_month      text NOT NULL,

  carried_value     numeric NOT NULL DEFAULT 0,     -- value taxed on the old unit
  from_rate_code    text NOT NULL,
  from_rate_pct     numeric NOT NULL DEFAULT 0,
  to_rate_code      text NOT NULL,
  to_rate_pct       numeric NOT NULL DEFAULT 0,

  -- Positive => additional liability; negative => a credit note is needed, and
  -- only helps if the window on the old unit is still open.
  differential_tax  numeric NOT NULL DEFAULT 0,
  credit_note_id    uuid REFERENCES public.builder_credit_notes(id) ON DELETE SET NULL,
  invoice_id        uuid REFERENCES public.builder_invoices(id) ON DELETE SET NULL,

  status            text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid
);
CREATE INDEX IF NOT EXISTS idx_builder_conv_from ON public.builder_conversions(from_unit_id);
CREATE INDEX IF NOT EXISTS idx_builder_conv_to   ON public.builder_conversions(to_unit_id);

-- ── 4. builder_bounce_reversals ────────────────────────────────────────────
-- Only ever raised against an un-invoiced advance. On an invoiced amount with
-- the booking intact there is no s.34 ground — the supply did not change, the
-- payment failed — and GST has no bad-debt relief.
CREATE TABLE IF NOT EXISTS public.builder_bounce_reversals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id        uuid NOT NULL REFERENCES public.builder_receipts(id) ON DELETE CASCADE,
  unit_id           uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,

  bounced_on        date NOT NULL,
  original_period   text NOT NULL,                  -- the period already filed
  rate_code         text NOT NULL,
  rate_pct          numeric NOT NULL DEFAULT 0,

  consideration     numeric NOT NULL DEFAULT 0,
  taxable_value     numeric NOT NULL DEFAULT 0,
  cgst              numeric NOT NULL DEFAULT 0,
  sgst              numeric NOT NULL DEFAULT 0,

  -- Consideration offset so far against later months' bookings.
  adjusted_value    numeric NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN','PARTIAL','ADJUSTED','WRITTEN_OFF')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receipt_id)
);
CREATE INDEX IF NOT EXISTS idx_builder_bounce_project ON public.builder_bounce_reversals(project_id);

-- Each offset actually taken, in the month it was taken. Same rate, same
-- project; the remainder carries forward.
CREATE TABLE IF NOT EXISTS public.builder_bounce_offsets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reversal_id   uuid NOT NULL REFERENCES public.builder_bounce_reversals(id) ON DELETE CASCADE,
  period_month  text NOT NULL,
  consideration numeric NOT NULL DEFAULT 0,
  taxable_value numeric NOT NULL DEFAULT 0,
  cgst          numeric NOT NULL DEFAULT 0,
  sgst          numeric NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);
CREATE INDEX IF NOT EXISTS idx_builder_bounce_offsets_period ON public.builder_bounce_offsets(period_month);

-- ── 5. builder_excess_tax ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_excess_tax (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id              uuid NOT NULL REFERENCES public.builder_receipts(id) ON DELETE CASCADE,
  unit_id                 uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  project_id              uuid NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,
  identified_on           date NOT NULL DEFAULT CURRENT_DATE,

  original_consideration  numeric NOT NULL DEFAULT 0,
  restated_consideration  numeric NOT NULL DEFAULT 0,
  original_tax            numeric NOT NULL DEFAULT 0,
  restated_tax            numeric NOT NULL DEFAULT 0,
  excess_tax              numeric NOT NULL DEFAULT 0,

  treatment               text NOT NULL DEFAULT 'ADJUST'
                            CHECK (treatment IN ('ADJUST','REFUND','ABSORB')),
  adjusted_value          numeric NOT NULL DEFAULT 0,
  status                  text NOT NULL DEFAULT 'OPEN'
                            CHECK (status IN ('OPEN','PARTIAL','SETTLED')),
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receipt_id)
);
CREATE INDEX IF NOT EXISTS idx_builder_excess_project ON public.builder_excess_tax(project_id);

-- ── 6. Postings view — three new legs ──────────────────────────────────────
-- Table 10 amendments carry a matched pair: the original B2CS entry reversed at
-- the old rate, and the same taxable value re-reported at the new one. The
-- difference is the additional tax.
CREATE OR REPLACE VIEW public.builder_period_postings AS
SELECT
  r.id AS source_id, 'ADVANCE_11A'::text AS source_type, 'Table 11A'::text AS gstr1_table,
  p.client_id, p.id AS project_id, u.id AS unit_id, u.unit_no, r.booking_id,
  r.period_month, r.receipt_date AS doc_date, r.rate_code, r.rate_pct,
  r.consideration, r.taxable_value, r.cgst, r.sgst
FROM public.builder_receipts r
JOIN public.builder_units u ON u.id = r.unit_id
JOIN public.builder_projects p ON p.id = u.project_id
WHERE r.receipt_nature = 'ADVANCE' AND r.cheque_status <> 'Bounced'
  AND r.gst_already_discharged = false AND r.subsumed_by_bu_event_id IS NULL

UNION ALL
SELECT
  a.id, 'ADVANCE_11B', 'Table 11B',
  p.client_id, p.id, u.id, u.unit_no, i.booking_id,
  a.period_month, i.invoice_date, a.rate_code, a.rate_pct,
  -a.consideration_adjusted, -a.taxable_value_adjusted, -a.cgst, -a.sgst
FROM public.builder_advance_adjustments a
JOIN public.builder_invoices i ON i.id = a.invoice_id
JOIN public.builder_units u ON u.id = i.unit_id
JOIN public.builder_projects p ON p.id = u.project_id

UNION ALL
SELECT
  i.id, 'INVOICE_B2CS', 'Table 7',
  p.client_id, p.id, u.id, u.unit_no, i.booking_id,
  i.period_month, i.invoice_date, i.rate_code, i.rate_pct,
  i.consideration, i.taxable_value, i.cgst, i.sgst
FROM public.builder_invoices i
JOIN public.builder_units u ON u.id = i.unit_id
JOIN public.builder_projects p ON p.id = u.project_id

UNION ALL
-- Credit notes. Intra-state B2C, so they net inside Table 7 rather than CDNUR.
-- Out-of-window notes are excluded: the tax cannot be adjusted, so they must
-- not reduce the return.
SELECT
  c.id, 'CREDIT_NOTE', 'Table 7',
  p.client_id, p.id, u.id, u.unit_no, c.booking_id,
  c.period_month, c.note_date, c.rate_code, c.rate_pct,
  -c.consideration, -c.taxable_value, -c.cgst, -c.sgst
FROM public.builder_credit_notes c
JOIN public.builder_units u ON u.id = c.unit_id
JOIN public.builder_projects p ON p.id = u.project_id
WHERE c.within_window = true

UNION ALL
-- Reclassification, old-rate leg reversed.
SELECT
  rp.id, 'RECLASS_10_OLD', 'Table 10',
  p.client_id, p.id, u.id, u.unit_no, NULL::uuid,
  rc.posting_period, rc.triggered_on, rc.from_rate_code, rc.from_rate_pct,
  0, -rp.taxable_value, -rp.old_cgst, -rp.old_sgst
FROM public.builder_reclassification_periods rp
JOIN public.builder_reclassifications rc ON rc.id = rp.reclassification_id
JOIN public.builder_units u ON u.id = rc.unit_id
JOIN public.builder_projects p ON p.id = u.project_id
WHERE rc.status = 'POSTED'

UNION ALL
-- Reclassification, same value re-reported at the correct rate.
SELECT
  rp.id, 'RECLASS_10_NEW', 'Table 10',
  p.client_id, p.id, u.id, u.unit_no, NULL::uuid,
  rc.posting_period, rc.triggered_on, rc.to_rate_code, rc.to_rate_pct,
  0, rp.taxable_value, rp.new_cgst, rp.new_sgst
FROM public.builder_reclassification_periods rp
JOIN public.builder_reclassifications rc ON rc.id = rp.reclassification_id
JOIN public.builder_units u ON u.id = rc.unit_id
JOIN public.builder_projects p ON p.id = u.project_id
WHERE rc.status = 'POSTED'

UNION ALL
-- Bounce offsets: a negative against later months' advances at the same rate.
SELECT
  bo.id, 'BOUNCE_REVERSAL', 'Table 11A',
  p.client_id, p.id, u.id, u.unit_no, NULL::uuid,
  bo.period_month, bo.created_at::date, br.rate_code, br.rate_pct,
  -bo.consideration, -bo.taxable_value, -bo.cgst, -bo.sgst
FROM public.builder_bounce_offsets bo
JOIN public.builder_bounce_reversals br ON br.id = bo.reversal_id
JOIN public.builder_units u ON u.id = br.unit_id
JOIN public.builder_projects p ON p.id = br.project_id;

-- ── 7. Unit ledger — credit notes reduce value taxed ───────────────────────
CREATE OR REPLACE VIEW public.builder_unit_ledger AS
SELECT
  u.id AS unit_id, u.project_id, p.client_id, u.unit_no,
  COALESCE(ob.cumulative_value_taxed, 0) + COALESCE(adv.consideration, 0)
    + COALESCE(inv.consideration, 0) - COALESCE(adj.consideration, 0)
    - COALESCE(cn.consideration, 0)   AS value_taxed,
  COALESCE(ob.cumulative_cgst, 0) + COALESCE(adv.cgst, 0) + COALESCE(inv.cgst, 0)
    - COALESCE(adj.cgst, 0) - COALESCE(cn.cgst, 0)        AS cgst_discharged,
  COALESCE(ob.cumulative_sgst, 0) + COALESCE(adv.sgst, 0) + COALESCE(inv.sgst, 0)
    - COALESCE(adj.sgst, 0) - COALESCE(cn.sgst, 0)        AS sgst_discharged,
  COALESCE(adv.consideration, 0) - COALESCE(adj.consideration, 0) AS open_advance,
  COALESCE(rec.received, 0) AS total_received,
  COALESCE(rec.tds, 0)      AS total_tds_194ia,
  COALESCE(ob.agreement_value, 0) AS opening_agreement_value,
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
  SELECT i.unit_id, SUM(a.consideration_adjusted) AS consideration,
         SUM(a.cgst) AS cgst, SUM(a.sgst) AS sgst
  FROM public.builder_advance_adjustments a
  JOIN public.builder_invoices i ON i.id = a.invoice_id
  GROUP BY i.unit_id
) adj ON adj.unit_id = u.id
LEFT JOIN (
  SELECT unit_id, SUM(consideration) AS consideration, SUM(cgst) AS cgst, SUM(sgst) AS sgst
  FROM public.builder_credit_notes WHERE within_window = true GROUP BY unit_id
) cn ON cn.unit_id = u.id
LEFT JOIN (
  SELECT unit_id,
         SUM(COALESCE(bank_credit, consideration + cgst + sgst - tds_194ia)) AS received,
         SUM(tds_194ia) AS tds
  FROM public.builder_receipts WHERE cheque_status <> 'Bounced' GROUP BY unit_id
) rec ON rec.unit_id = u.id;

-- ── 8. Triggers, RLS, grants ───────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_builder_reclass_updated_at ON public.builder_reclassifications;
CREATE TRIGGER trg_builder_reclass_updated_at BEFORE UPDATE ON public.builder_reclassifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_builder_bounce_updated_at ON public.builder_bounce_reversals;
CREATE TRIGGER trg_builder_bounce_updated_at BEFORE UPDATE ON public.builder_bounce_reversals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_builder_excess_updated_at ON public.builder_excess_tax;
CREATE TRIGGER trg_builder_excess_updated_at BEFORE UPDATE ON public.builder_excess_tax
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.builder_reclassifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_reclassification_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_credit_notes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_conversions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_bounce_reversals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_bounce_offsets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_excess_tax               ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff manage builder_reclassifications" ON public.builder_reclassifications;
CREATE POLICY "staff manage builder_reclassifications" ON public.builder_reclassifications
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "staff manage builder_reclass_periods" ON public.builder_reclassification_periods;
CREATE POLICY "staff manage builder_reclass_periods" ON public.builder_reclassification_periods
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "staff manage builder_credit_notes" ON public.builder_credit_notes;
CREATE POLICY "staff manage builder_credit_notes" ON public.builder_credit_notes
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "staff manage builder_conversions" ON public.builder_conversions;
CREATE POLICY "staff manage builder_conversions" ON public.builder_conversions
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "staff manage builder_bounce_reversals" ON public.builder_bounce_reversals;
CREATE POLICY "staff manage builder_bounce_reversals" ON public.builder_bounce_reversals
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "staff manage builder_bounce_offsets" ON public.builder_bounce_offsets;
CREATE POLICY "staff manage builder_bounce_offsets" ON public.builder_bounce_offsets
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "staff manage builder_excess_tax" ON public.builder_excess_tax;
CREATE POLICY "staff manage builder_excess_tax" ON public.builder_excess_tax
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_reclassifications        TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_reclassification_periods TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_credit_notes             TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_conversions              TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_bounce_reversals         TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_bounce_offsets           TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_excess_tax               TO anon, authenticated;
