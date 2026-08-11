-- Firm decision: re-ratings are discharged going forward via DRC-03
-- (voluntary payment: differential tax + s.50 interest, computed here and
-- paid manually on the GST portal outside the return) instead of a GSTR-1
-- Table 10 amendment + 3B liability.
--
-- Why: a Table 10 amendment risks a duplicate effect when the client's own
-- team has already hand-corrected the portal (exactly what happened on
-- E-1004 — see 20260811143252_builder_reclassification_reverse.sql), and it
-- structurally cannot reach a unit's pre-onboarding history at all, because
-- builder_period_postings excludes builder_opening_balances. DRC-03 fixes
-- both: nothing is re-filed against an already-filed return, and staff can
-- enter a unit's pre-onboarding date-wise receipts by hand (new
-- builder_historical_receipts below) so interest is computed against real
-- history rather than left uncounted.
--
-- Mechanically: builder_reclassifications gains discharge_mode, defaulting
-- to 'DRC03'. The view's two Table 10 legs are re-gated to only emit for
-- discharge_mode = 'GSTR1_AMENDMENT' — a manual, DB-only escape hatch for a
-- deliberate exception, not a UI toggle. Everything already computed by
-- builder_reclassification_periods (taxable_value, old/new cgst/sgst,
-- differential_tax, due_date, interest_days, interest_amount) is reused
-- as-is; only its destination changes.

-- ── 1. builder_reclassifications — discharge mode + DRC-03 filing state ────
ALTER TABLE public.builder_reclassifications
  ADD COLUMN IF NOT EXISTS discharge_mode text NOT NULL DEFAULT 'DRC03'
    CHECK (discharge_mode IN ('DRC03', 'GSTR1_AMENDMENT')),
  ADD COLUMN IF NOT EXISTS drc03_status text NOT NULL DEFAULT 'PENDING'
    CHECK (drc03_status IN ('PENDING', 'FILED')),
  ADD COLUMN IF NOT EXISTS drc03_arn text,
  ADD COLUMN IF NOT EXISTS drc03_filed_date date,
  ADD COLUMN IF NOT EXISTS drc03_filed_by uuid;

COMMENT ON COLUMN public.builder_reclassifications.discharge_mode IS
  'DRC03 (default, firm decision going forward): differential tax + interest '
  'paid by voluntary DRC-03, never reported in GSTR-1/3B. GSTR1_AMENDMENT is '
  'a manual, DB-only exception — not offered in the UI.';

-- ── 2. builder_historical_receipts — pre-onboarding date-wise entry ────────
-- A unit's history before this firm's onboarding into the app sits only in
-- the single-row builder_opening_balances snapshot (unit_id PRIMARY KEY, one
-- lump "as at" figure) — invisible to the reclassification engine, which
-- only ever reads builder_period_postings. This table lets staff reconstruct
-- it by hand, date by date, when a re-rating case actually requires it.
--
-- Floored at 01.04.2019: Notification 03/2019-CT(R) is the earliest date
-- src/utils/builderRates.ts models any rate for. A receipt before that sits
-- in a pre-GST-scheme regime this app has no rate table for — deliberately
-- kept out of this tool and left a manual firm judgment call, rather than
-- silently computed with the wrong-regime rate.
CREATE TABLE IF NOT EXISTS public.builder_historical_receipts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id       uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  receipt_date  date NOT NULL,
  amount        numeric NOT NULL CHECK (amount > 0),
  notes         text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT builder_historical_receipts_gst_era CHECK (receipt_date >= '2019-04-01')
);
CREATE INDEX IF NOT EXISTS idx_builder_historical_receipts_unit
  ON public.builder_historical_receipts(unit_id);

COMMENT ON CONSTRAINT builder_historical_receipts_gst_era ON public.builder_historical_receipts IS
  'Floor is Notification 03/2019-CT(R), the earliest date builderRates.ts models a rate for. '
  'Earlier receipts are pre-affordable-scheme and out of this tool''s scope by design.';
COMMENT ON TABLE public.builder_historical_receipts IS
  'Manually entered pre-onboarding date-wise receipts for a unit, used only to compute '
  'DRC-03 differential tax and s.50 interest for periods builder_opening_balances '
  'cannot break out on its own. Never flows into builder_period_postings / GSTR-1 / 3B.';

ALTER TABLE public.builder_historical_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS builder_historical_receipts_all ON public.builder_historical_receipts;
CREATE POLICY builder_historical_receipts_all ON public.builder_historical_receipts
  FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_historical_receipts TO anon, authenticated;

-- ── 3. builder_period_postings — gate Table 10 legs to GSTR1_AMENDMENT only ─
-- Unchanged from 20260810120000_builder_land_deduction_nongst.sql except the
-- two RECLASS_10_OLD/RECLASS_10_NEW WHERE clauses. With discharge_mode
-- defaulting to 'DRC03', every reclassification saved from here on simply
-- stops appearing in this view — it never reaches GSTR-1 Table 10 or 3B.
CREATE OR REPLACE VIEW public.builder_period_postings AS
SELECT
  r.id AS source_id, 'ADVANCE_11A'::text AS source_type, 'Table 11A'::text AS gstr1_table,
  p.client_id, p.id AS project_id, u.id AS unit_id, u.unit_no, r.booking_id,
  r.period_month, r.receipt_date AS doc_date, r.rate_code, r.rate_pct,
  r.consideration, r.taxable_value, r.cgst, r.sgst,
  NULL::text AS original_period,
  r.doc_no,
  (r.consideration - r.taxable_value) AS land_deduction
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
  -a.consideration_adjusted, -a.taxable_value_adjusted, -a.cgst, -a.sgst,
  NULL::text, NULL::text,
  -(a.consideration_adjusted - a.taxable_value_adjusted)
FROM public.builder_advance_adjustments a
JOIN public.builder_invoices i ON i.id = a.invoice_id
JOIN public.builder_units u ON u.id = i.unit_id
JOIN public.builder_projects p ON p.id = u.project_id

UNION ALL
SELECT
  i.id, 'INVOICE_B2CS', 'Table 7',
  p.client_id, p.id, u.id, u.unit_no, i.booking_id,
  i.period_month, i.invoice_date, i.rate_code, i.rate_pct,
  i.consideration, i.taxable_value, i.cgst, i.sgst,
  NULL::text, i.doc_no,
  (i.consideration - i.taxable_value)
FROM public.builder_invoices i
JOIN public.builder_units u ON u.id = i.unit_id
JOIN public.builder_projects p ON p.id = u.project_id

UNION ALL
SELECT
  c.id, 'CREDIT_NOTE', 'Table 7',
  p.client_id, p.id, u.id, u.unit_no, c.booking_id,
  c.period_month, c.note_date, c.rate_code, c.rate_pct,
  -c.consideration, -c.taxable_value, -c.cgst, -c.sgst,
  NULL::text, c.doc_no,
  -(c.consideration - c.taxable_value)
FROM public.builder_credit_notes c
JOIN public.builder_units u ON u.id = c.unit_id
JOIN public.builder_projects p ON p.id = u.project_id
WHERE c.within_window = true

UNION ALL
SELECT
  rp.id, 'RECLASS_10_OLD', 'Table 10',
  p.client_id, p.id, u.id, u.unit_no, NULL::uuid,
  rc.posting_period, rc.triggered_on, rc.from_rate_code, rc.from_rate_pct,
  0, -rp.taxable_value, -rp.old_cgst, -rp.old_sgst,
  rp.period_month, NULL::text,
  0::numeric
FROM public.builder_reclassification_periods rp
JOIN public.builder_reclassifications rc ON rc.id = rp.reclassification_id
JOIN public.builder_units u ON u.id = rc.unit_id
JOIN public.builder_projects p ON p.id = u.project_id
WHERE rc.status = 'POSTED' AND rc.discharge_mode = 'GSTR1_AMENDMENT'

UNION ALL
SELECT
  rp.id, 'RECLASS_10_NEW', 'Table 10',
  p.client_id, p.id, u.id, u.unit_no, NULL::uuid,
  rc.posting_period, rc.triggered_on, rc.to_rate_code, rc.to_rate_pct,
  0, rp.taxable_value, rp.new_cgst, rp.new_sgst,
  rp.period_month, NULL::text,
  0::numeric
FROM public.builder_reclassification_periods rp
JOIN public.builder_reclassifications rc ON rc.id = rp.reclassification_id
JOIN public.builder_units u ON u.id = rc.unit_id
JOIN public.builder_projects p ON p.id = u.project_id
WHERE rc.status = 'POSTED' AND rc.discharge_mode = 'GSTR1_AMENDMENT'

UNION ALL
SELECT
  bo.id, 'BOUNCE_REVERSAL', 'Table 11A',
  p.client_id, p.id, u.id, u.unit_no, NULL::uuid,
  bo.period_month, bo.created_at::date, br.rate_code, br.rate_pct,
  -bo.consideration, -bo.taxable_value, -bo.cgst, -bo.sgst,
  NULL::text, NULL::text,
  -(bo.consideration - bo.taxable_value)
FROM public.builder_bounce_offsets bo
JOIN public.builder_bounce_reversals br ON br.id = bo.reversal_id
JOIN public.builder_units u ON u.id = br.unit_id
JOIN public.builder_projects p ON p.id = br.project_id

UNION ALL
SELECT
  fp.id, 'CANCELLATION_OFFSET', 'Table 11A',
  p.client_id, bc.project_id, bc.unit_id, u.unit_no, NULL::uuid,
  fp.period_month, fp.payment_date, bc.rate_code, bc.rate_pct,
  -fp.offset_amount, -fp.offset_taxable_value, -fp.offset_cgst, -fp.offset_sgst,
  NULL::text, NULL::text,
  -(fp.offset_amount - fp.offset_taxable_value)
FROM public.builder_refund_payments fp
JOIN public.builder_cancellations bc ON bc.id = fp.cancellation_id
JOIN public.builder_units u ON u.id = bc.unit_id
JOIN public.builder_projects p ON p.id = bc.project_id
WHERE fp.offset_amount > 0;

COMMENT ON VIEW public.builder_period_postings IS
  'Every builder posting that reaches GSTR-1, one row per source document. '
  'original_period is set only on Table 10 amendment legs (omon in the JSON). '
  'doc_no is set only on legs that issue a document of their own — receipt '
  'vouchers, invoices and credit notes — and drives Table 13. '
  'CANCELLATION_OFFSET carries no doc_no: it amends an existing pool, not a '
  'new document, exactly like BOUNCE_REVERSAL. '
  'land_deduction is the 1/3rd deemed land value (Notif 11/2017 para 2), '
  'reported as Non-GST supply (GSTR-1 Table 8, 3B Table 3.1(e)) per the '
  'firm''s election. '
  'RECLASS_10_OLD/NEW only emit for discharge_mode = GSTR1_AMENDMENT — the '
  'firm''s default going forward is DRC03, which never reaches this view '
  '(see 20260811150000_builder_reclass_drc03.sql).';
