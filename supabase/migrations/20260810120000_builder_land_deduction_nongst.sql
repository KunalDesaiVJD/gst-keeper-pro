-- Firm election: report the 1/3rd deemed land deduction (para 2 of Notif
-- 11/2017, see docs/BUILDER_GST_POSITIONS.md §1) as Non-GST supply wherever
-- the 2/3rd taxable value is reported — the Builder module's own working
-- papers, Builder Reports, GSTR-1 Table 8, and 3B Table 3.1(e).
--
-- Every builder_period_postings branch already carries consideration
-- (pre-deduction) and taxable_value (post-deduction) from the same
-- computeTax()/computeFlatTax() call, so consideration - taxable_value IS
-- the land deduction for every branch EXCEPT the two Table 10 re-rating
-- legs: those hardcode consideration = 0 because a re-rating only swaps the
-- RATE applied to an already-established taxable value — it never
-- re-derives the land split, so their land contribution is correctly zero,
-- not "0 - taxable_value". land_deduction is therefore added as its own
-- explicit column per branch rather than left for callers to derive.
--
-- No GRANT re-declaration needed: GRANT SELECT ... TO anon, authenticated
-- was declared once in 20260729140000_builder_phase2_bookings_receipts.sql
-- and survives CREATE OR REPLACE VIEW across every later migration that has
-- already touched this view.

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
WHERE rc.status = 'POSTED'

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
WHERE rc.status = 'POSTED'

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
  'firm''s election — zero on the two Table 10 re-rating legs, since a '
  're-rating only swaps the rate on an already-established taxable value '
  'and never re-derives the land split. See BUILDER_GST_POSITIONS.md §1.';
