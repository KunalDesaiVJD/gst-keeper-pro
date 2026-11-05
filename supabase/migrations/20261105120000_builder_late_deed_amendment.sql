-- A deed recorded after its month's GSTR-1 is filed (5 Nov 2026).
--
-- The dastavej differential of such a deed is reported in the first open
-- month's GSTR-1, but as an AMENDMENT of the deed's own month: its invoice in
-- Table 10 (b2csa) and its advance adjustment in Table 11B(2) (txpda), both
-- with omon = the deed's month, rather than as that open month's own Table 7
-- / 11B. `amends_period` (MM/YYYY) on the invoice and its adjustment legs
-- marks this; the view routes a marked row to the amendment table and carries
-- the month as original_period. source_type is unchanged, so the ledger, the
-- workpapers and the 3B tax of the posting month read these rows as before.
-- New columns need nothing from the change log (docs/GST_CHANGE_LOG.md).
-- docs/BUILDER_GST_POSITIONS.md §6.

ALTER TABLE public.builder_invoices
  ADD COLUMN IF NOT EXISTS amends_period text
  CHECK (amends_period IS NULL OR amends_period ~ '^(0[1-9]|1[0-2])/[0-9]{4}$');
ALTER TABLE public.builder_advance_adjustments
  ADD COLUMN IF NOT EXISTS amends_period text
  CHECK (amends_period IS NULL OR amends_period ~ '^(0[1-9]|1[0-2])/[0-9]{4}$');
ALTER TABLE public.builder_opening_balance_adjustments
  ADD COLUMN IF NOT EXISTS amends_period text
  CHECK (amends_period IS NULL OR amends_period ~ '^(0[1-9]|1[0-2])/[0-9]{4}$');

COMMENT ON COLUMN public.builder_invoices.amends_period IS
  'MM/YYYY of the filed month this invoice is reported as an amendment of (GSTR-1 Table 10), or NULL for an ordinary Table 7 invoice.';
COMMENT ON COLUMN public.builder_advance_adjustments.amends_period IS
  'MM/YYYY of the filed month this 11B leg restates (GSTR-1 Table 11B(2)), or NULL.';
COMMENT ON COLUMN public.builder_opening_balance_adjustments.amends_period IS
  'MM/YYYY of the filed month this 11B leg restates (GSTR-1 Table 11B(2)), or NULL.';

CREATE OR REPLACE VIEW public.builder_period_postings AS
 SELECT r.id AS source_id,
    'ADVANCE_11A'::text AS source_type,
    'Table 11A'::text AS gstr1_table,
    p.client_id,
    p.id AS project_id,
    u.id AS unit_id,
    u.unit_no,
    r.booking_id,
    r.period_month,
    r.receipt_date AS doc_date,
    r.rate_code,
    r.rate_pct,
    r.consideration,
    r.taxable_value,
    r.cgst,
    r.sgst,
    NULL::text AS original_period,
    r.doc_no,
    r.consideration - r.taxable_value AS land_deduction
   FROM builder_receipts r
     JOIN builder_units u ON u.id = r.unit_id
     JOIN builder_projects p ON p.id = u.project_id
  WHERE r.receipt_nature = 'ADVANCE'::text AND r.cheque_status <> 'Bounced'::text AND r.gst_already_discharged = false AND r.subsumed_by_bu_event_id IS NULL
UNION ALL
 SELECT a.id AS source_id,
    'ADVANCE_11B'::text AS source_type,
        CASE
            WHEN a.amends_period IS NULL THEN 'Table 11B'::text
            ELSE 'Table 11B(2)'::text
        END AS gstr1_table,
    p.client_id,
    p.id AS project_id,
    u.id AS unit_id,
    u.unit_no,
    i.booking_id,
    a.period_month,
    i.invoice_date AS doc_date,
    a.rate_code,
    a.rate_pct,
    - a.consideration_adjusted AS consideration,
    - a.taxable_value_adjusted AS taxable_value,
    - a.cgst AS cgst,
    - a.sgst AS sgst,
    a.amends_period AS original_period,
    NULL::text AS doc_no,
    - (a.consideration_adjusted - a.taxable_value_adjusted) AS land_deduction
   FROM builder_advance_adjustments a
     JOIN builder_invoices i ON i.id = a.invoice_id
     JOIN builder_units u ON u.id = i.unit_id
     JOIN builder_projects p ON p.id = u.project_id
UNION ALL
 SELECT oa.id AS source_id,
    'OPENING_11B'::text AS source_type,
        CASE
            WHEN oa.amends_period IS NULL THEN 'Table 11B'::text
            ELSE 'Table 11B(2)'::text
        END AS gstr1_table,
    p.client_id,
    p.id AS project_id,
    u.id AS unit_id,
    u.unit_no,
    i.booking_id,
    oa.period_month,
    i.invoice_date AS doc_date,
    oa.rate_code,
    oa.rate_pct,
    - oa.consideration_adjusted AS consideration,
    - oa.taxable_value_adjusted AS taxable_value,
    - oa.cgst AS cgst,
    - oa.sgst AS sgst,
    oa.amends_period AS original_period,
    NULL::text AS doc_no,
    - (oa.consideration_adjusted - oa.taxable_value_adjusted) AS land_deduction
   FROM builder_opening_balance_adjustments oa
     JOIN builder_invoices i ON i.id = oa.invoice_id
     JOIN builder_units u ON u.id = oa.unit_id
     JOIN builder_projects p ON p.id = u.project_id
UNION ALL
 SELECT i.id AS source_id,
    'INVOICE_B2CS'::text AS source_type,
        CASE
            WHEN i.amends_period IS NULL THEN 'Table 7'::text
            ELSE 'Table 10'::text
        END AS gstr1_table,
    p.client_id,
    p.id AS project_id,
    u.id AS unit_id,
    u.unit_no,
    i.booking_id,
    i.period_month,
    i.invoice_date AS doc_date,
    i.rate_code,
    i.rate_pct,
    i.consideration,
    i.taxable_value,
    i.cgst,
    i.sgst,
    i.amends_period AS original_period,
    i.doc_no,
    i.consideration - i.taxable_value AS land_deduction
   FROM builder_invoices i
     JOIN builder_units u ON u.id = i.unit_id
     JOIN builder_projects p ON p.id = u.project_id
UNION ALL
 SELECT c.id AS source_id,
    'CREDIT_NOTE'::text AS source_type,
    'Table 7'::text AS gstr1_table,
    p.client_id,
    p.id AS project_id,
    u.id AS unit_id,
    u.unit_no,
    c.booking_id,
    c.period_month,
    c.note_date AS doc_date,
    c.rate_code,
    c.rate_pct,
    - c.consideration AS consideration,
    - c.taxable_value AS taxable_value,
    - c.cgst AS cgst,
    - c.sgst AS sgst,
    NULL::text AS original_period,
    c.doc_no,
    - (c.consideration - c.taxable_value) AS land_deduction
   FROM builder_credit_notes c
     JOIN builder_units u ON u.id = c.unit_id
     JOIN builder_projects p ON p.id = u.project_id
  WHERE c.within_window = true
UNION ALL
 SELECT rp.id AS source_id,
    'RECLASS_10_OLD'::text AS source_type,
    'Table 10'::text AS gstr1_table,
    p.client_id,
    p.id AS project_id,
    u.id AS unit_id,
    u.unit_no,
    NULL::uuid AS booking_id,
    rc.posting_period AS period_month,
    rc.triggered_on AS doc_date,
    rc.from_rate_code AS rate_code,
    rc.from_rate_pct AS rate_pct,
    0 AS consideration,
    - rp.taxable_value AS taxable_value,
    - rp.old_cgst AS cgst,
    - rp.old_sgst AS sgst,
    rp.period_month AS original_period,
    NULL::text AS doc_no,
    0::numeric AS land_deduction
   FROM builder_reclassification_periods rp
     JOIN builder_reclassifications rc ON rc.id = rp.reclassification_id
     JOIN builder_units u ON u.id = rc.unit_id
     JOIN builder_projects p ON p.id = u.project_id
  WHERE rc.status = 'POSTED'::text AND rc.discharge_mode = 'GSTR1_AMENDMENT'::text
UNION ALL
 SELECT rp.id AS source_id,
    'RECLASS_10_NEW'::text AS source_type,
    'Table 10'::text AS gstr1_table,
    p.client_id,
    p.id AS project_id,
    u.id AS unit_id,
    u.unit_no,
    NULL::uuid AS booking_id,
    rc.posting_period AS period_month,
    rc.triggered_on AS doc_date,
    rc.to_rate_code AS rate_code,
    rc.to_rate_pct AS rate_pct,
    0 AS consideration,
    rp.taxable_value,
    rp.new_cgst AS cgst,
    rp.new_sgst AS sgst,
    rp.period_month AS original_period,
    NULL::text AS doc_no,
    0::numeric AS land_deduction
   FROM builder_reclassification_periods rp
     JOIN builder_reclassifications rc ON rc.id = rp.reclassification_id
     JOIN builder_units u ON u.id = rc.unit_id
     JOIN builder_projects p ON p.id = u.project_id
  WHERE rc.status = 'POSTED'::text AND rc.discharge_mode = 'GSTR1_AMENDMENT'::text
UNION ALL
 SELECT bo.id AS source_id,
    'BOUNCE_REVERSAL'::text AS source_type,
    'Table 11A'::text AS gstr1_table,
    p.client_id,
    p.id AS project_id,
    u.id AS unit_id,
    u.unit_no,
    NULL::uuid AS booking_id,
    bo.period_month,
    bo.created_at::date AS doc_date,
    br.rate_code,
    br.rate_pct,
    - bo.consideration AS consideration,
    - bo.taxable_value AS taxable_value,
    - bo.cgst AS cgst,
    - bo.sgst AS sgst,
    NULL::text AS original_period,
    NULL::text AS doc_no,
    - (bo.consideration - bo.taxable_value) AS land_deduction
   FROM builder_bounce_offsets bo
     JOIN builder_bounce_reversals br ON br.id = bo.reversal_id
     JOIN builder_units u ON u.id = br.unit_id
     JOIN builder_projects p ON p.id = br.project_id
UNION ALL
 SELECT fp.id AS source_id,
    'CANCELLATION_OFFSET'::text AS source_type,
    'Table 11A'::text AS gstr1_table,
    p.client_id,
    bc.project_id,
    bc.unit_id,
    u.unit_no,
    NULL::uuid AS booking_id,
    fp.period_month,
    fp.payment_date AS doc_date,
    bc.rate_code,
    bc.rate_pct,
    - fp.offset_amount AS consideration,
    - fp.offset_taxable_value AS taxable_value,
    - fp.offset_cgst AS cgst,
    - fp.offset_sgst AS sgst,
    NULL::text AS original_period,
    NULL::text AS doc_no,
    - (fp.offset_amount - fp.offset_taxable_value) AS land_deduction
   FROM builder_refund_payments fp
     JOIN builder_cancellations bc ON bc.id = fp.cancellation_id
     JOIN builder_units u ON u.id = bc.unit_id
     JOIN builder_projects p ON p.id = bc.project_id
  WHERE fp.offset_amount > 0::numeric;
