-- Firm decision (13/08/2026, per the firm's own Sales Guide): when a
-- dastavej/BU differential falls due on a unit whose earlier consideration
-- was recognised only via its builder_opening_balances snapshot (not
-- itemized receipts — pre-onboarding history that can't be broken out that
-- way), the return must still show the transaction on BOTH legs: the full
-- sale gross in GSTR-1 Table 7, offset by an equal advance-adjustment in
-- Table 11B — not silently netted to nothing, which is what this app did
-- before and is why Plot 148 (Shree Maruti Infra) showed nothing at all.
--
-- builder_advance_adjustments can't carry this: its receipt_id is NOT NULL,
-- and an opening balance has no itemized builder_receipts row to attach to
-- (deliberately — see docs/BUILDER_GST_POSITIONS.md §8 on why pre-onboarding
-- history is never reconstructed into live receipts). This is a parallel,
-- unit-keyed table instead, mirroring advance_adjustments' shape.
--
-- The net tax owed is unaffected: computeDifferential() (src/utils/
-- builderBuEvent.ts) still floors differentialValue at the same figure as
-- before. Only the GROSS Table 7 / Table 11B split changes — invoiceValue no
-- longer nets the opening balance out directly, and advanceToAdjust now
-- draws on it (after real advances) instead.

CREATE TABLE IF NOT EXISTS public.builder_opening_balance_adjustments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id             uuid NOT NULL REFERENCES public.builder_invoices(id) ON DELETE CASCADE,
  unit_id                uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  consideration_adjusted numeric NOT NULL DEFAULT 0 CHECK (consideration_adjusted >= 0),
  taxable_value_adjusted numeric NOT NULL DEFAULT 0,
  cgst                   numeric NOT NULL DEFAULT 0,
  sgst                   numeric NOT NULL DEFAULT 0,
  rate_code              text NOT NULL,
  rate_pct               numeric NOT NULL DEFAULT 0,
  period_month           text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid
);
CREATE INDEX IF NOT EXISTS idx_builder_opening_adj_invoice ON public.builder_opening_balance_adjustments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_builder_opening_adj_unit ON public.builder_opening_balance_adjustments(unit_id);
CREATE INDEX IF NOT EXISTS idx_builder_opening_adj_period ON public.builder_opening_balance_adjustments(period_month);

ALTER TABLE public.builder_opening_balance_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY builder_opening_balance_adjustments_all ON public.builder_opening_balance_adjustments
  FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_opening_balance_adjustments TO anon, authenticated;

-- ── builder_period_postings — add the Table 11B leg for opening-balance adjustments ──
-- Byte-identical to 20260811150000_builder_reclass_drc03.sql except the new
-- OPENING_11B branch, inserted right after ADVANCE_11B with the identical
-- shape and sign convention (negative; reported as the positive magnitude
-- GSTR-1 expects, same as every other Table 11B row).
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
  oa.id, 'OPENING_11B', 'Table 11B',
  p.client_id, p.id, u.id, u.unit_no, i.booking_id,
  oa.period_month, i.invoice_date, oa.rate_code, oa.rate_pct,
  -oa.consideration_adjusted, -oa.taxable_value_adjusted, -oa.cgst, -oa.sgst,
  NULL::text, NULL::text,
  -(oa.consideration_adjusted - oa.taxable_value_adjusted)
FROM public.builder_opening_balance_adjustments oa
JOIN public.builder_invoices i ON i.id = oa.invoice_id
JOIN public.builder_units u ON u.id = oa.unit_id
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
  '(see 20260811150000_builder_reclass_drc03.sql). '
  'OPENING_11B is the opening-balance counterpart of ADVANCE_11B — see '
  '20260813150000_builder_opening_balance_adjustments.sql.';
