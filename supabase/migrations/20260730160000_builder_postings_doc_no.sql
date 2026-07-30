-- Carry the document number through the postings feed.
--
-- GSTR-1 Table 13 ("Documents issued") reports, per document class, the serial
-- range issued in the period and how many were cancelled. The builder module
-- already stores a doc_no on receipts, invoices and credit notes — receipt
-- vouchers are required under s.31(3)(d), which is exactly what an advance
-- against a construction service takes — but the postings view dropped it, so
-- Table 13 could not be generated at all and came out empty for every builder
-- client.
--
-- Appended at the end so CREATE OR REPLACE stays legal. NULL on the legs that
-- have no document of their own: an advance adjustment is a movement against an
-- invoice already counted, and a re-rating or bounce offset amends earlier
-- documents rather than issuing new ones. Counting them would overstate the
-- series.

CREATE OR REPLACE VIEW public.builder_period_postings AS
SELECT
  r.id AS source_id, 'ADVANCE_11A'::text AS source_type, 'Table 11A'::text AS gstr1_table,
  p.client_id, p.id AS project_id, u.id AS unit_id, u.unit_no, r.booking_id,
  r.period_month, r.receipt_date AS doc_date, r.rate_code, r.rate_pct,
  r.consideration, r.taxable_value, r.cgst, r.sgst,
  NULL::text AS original_period,
  r.doc_no
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
  NULL::text, NULL::text
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
  NULL::text, i.doc_no
FROM public.builder_invoices i
JOIN public.builder_units u ON u.id = i.unit_id
JOIN public.builder_projects p ON p.id = u.project_id

UNION ALL
SELECT
  c.id, 'CREDIT_NOTE', 'Table 7',
  p.client_id, p.id, u.id, u.unit_no, c.booking_id,
  c.period_month, c.note_date, c.rate_code, c.rate_pct,
  -c.consideration, -c.taxable_value, -c.cgst, -c.sgst,
  NULL::text, c.doc_no
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
  rp.period_month, NULL::text
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
  rp.period_month, NULL::text
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
  NULL::text, NULL::text
FROM public.builder_bounce_offsets bo
JOIN public.builder_bounce_reversals br ON br.id = bo.reversal_id
JOIN public.builder_units u ON u.id = br.unit_id
JOIN public.builder_projects p ON p.id = br.project_id;

COMMENT ON VIEW public.builder_period_postings IS
  'Every builder posting that reaches GSTR-1, one row per source document. '
  'original_period is set only on Table 10 amendment legs (omon in the JSON). '
  'doc_no is set only on legs that issue a document of their own — receipt '
  'vouchers, invoices and credit notes — and drives Table 13.';
