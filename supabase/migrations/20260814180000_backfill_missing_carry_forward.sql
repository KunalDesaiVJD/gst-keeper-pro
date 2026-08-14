-- One-time data repair: carryForwardToNextMonth() in FilingStatusPage.tsx never
-- checked errors on its insert() calls and its outer catch silently swallowed
-- failures ("don't fail the filing just because carry forward failed"). If a
-- staff member navigated away right after marking a GSTR-3B Filed, the copy
-- into the next period's bills_not_in_2b / bills_not_in_books silently never
-- happened. Root-caused 2026-08-14: 21 clients' June-2026 -> July-2026 carry
-- forward (plus one older Dec-2025 -> Jan-2026 case) were missing entirely,
-- roughly half of all clients who filed that period — confirming this is an
-- intermittent failure, not a universal one.
--
-- Purely additive: only inserts a client+period+table combination that has
-- ZERO carried-forward rows yet, so it cannot duplicate anything that already
-- carried forward correctly, and is safe to run more than once (needed here
-- to fix any chained two-hop gaps in one sitting).
--
-- Dry-run counted 355 bills_not_in_2b rows + 1,111 bills_not_in_books rows.
-- See the paired code fix in FilingStatusPage.tsx (checks errors, surfaces a
-- warning instead of a false "success", adds a manual re-run action) so this
-- doesn't need doing by hand again.

BEGIN;

INSERT INTO public.bills_not_in_2b (client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, period_month, reversal_month, reclaim_month, reclaim_subtype, is_carried_forward)
SELECT b.client_id, b.date, b.supplier_name, b.supplier_invoice_number, b.supplier_gstin,
  b.taxable_value, b.input_igst, b.input_cgst, b.input_sgst,
  to_char(to_date(b.period_month, 'MM/YYYY') + INTERVAL '1 month', 'MM/YYYY'),
  b.reversal_month, b.reclaim_month, b.reclaim_subtype, true
FROM public.bills_not_in_2b b
JOIN public.filing_status fs ON fs.client_id = b.client_id AND fs.period_month = b.period_month
  AND fs.return_type IN ('GSTR-3B', 'GSTR-3B (Q)') AND fs.status = 'Filed'
WHERE NOT EXISTS (
  SELECT 1 FROM public.bills_not_in_2b x
  WHERE x.client_id = b.client_id
    AND x.period_month = to_char(to_date(b.period_month, 'MM/YYYY') + INTERVAL '1 month', 'MM/YYYY')
    AND x.is_carried_forward = true
);

INSERT INTO public.bills_not_in_books (client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, period_month, book_entry_month, bill_in_2b_month, is_carried_forward)
SELECT b.client_id, b.date, b.supplier_name, b.supplier_invoice_number, b.supplier_gstin,
  b.taxable_value, b.input_igst, b.input_cgst, b.input_sgst,
  to_char(to_date(b.period_month, 'MM/YYYY') + INTERVAL '1 month', 'MM/YYYY'),
  b.book_entry_month, b.bill_in_2b_month, true
FROM public.bills_not_in_books b
JOIN public.filing_status fs ON fs.client_id = b.client_id AND fs.period_month = b.period_month
  AND fs.return_type IN ('GSTR-3B', 'GSTR-3B (Q)') AND fs.status = 'Filed'
WHERE NOT EXISTS (
  SELECT 1 FROM public.bills_not_in_books x
  WHERE x.client_id = b.client_id
    AND x.period_month = to_char(to_date(b.period_month, 'MM/YYYY') + INTERVAL '1 month', 'MM/YYYY')
    AND x.is_carried_forward = true
);

-- Run the same two inserts a second time in the same transaction to close any
-- chained two-hop gap the first pass just fixed the first hop of (the second
-- pass's NOT EXISTS now sees the rows the first pass created).
INSERT INTO public.bills_not_in_2b (client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, period_month, reversal_month, reclaim_month, reclaim_subtype, is_carried_forward)
SELECT b.client_id, b.date, b.supplier_name, b.supplier_invoice_number, b.supplier_gstin,
  b.taxable_value, b.input_igst, b.input_cgst, b.input_sgst,
  to_char(to_date(b.period_month, 'MM/YYYY') + INTERVAL '1 month', 'MM/YYYY'),
  b.reversal_month, b.reclaim_month, b.reclaim_subtype, true
FROM public.bills_not_in_2b b
JOIN public.filing_status fs ON fs.client_id = b.client_id AND fs.period_month = b.period_month
  AND fs.return_type IN ('GSTR-3B', 'GSTR-3B (Q)') AND fs.status = 'Filed'
WHERE NOT EXISTS (
  SELECT 1 FROM public.bills_not_in_2b x
  WHERE x.client_id = b.client_id
    AND x.period_month = to_char(to_date(b.period_month, 'MM/YYYY') + INTERVAL '1 month', 'MM/YYYY')
    AND x.is_carried_forward = true
);

INSERT INTO public.bills_not_in_books (client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, period_month, book_entry_month, bill_in_2b_month, is_carried_forward)
SELECT b.client_id, b.date, b.supplier_name, b.supplier_invoice_number, b.supplier_gstin,
  b.taxable_value, b.input_igst, b.input_cgst, b.input_sgst,
  to_char(to_date(b.period_month, 'MM/YYYY') + INTERVAL '1 month', 'MM/YYYY'),
  b.book_entry_month, b.bill_in_2b_month, true
FROM public.bills_not_in_books b
JOIN public.filing_status fs ON fs.client_id = b.client_id AND fs.period_month = b.period_month
  AND fs.return_type IN ('GSTR-3B', 'GSTR-3B (Q)') AND fs.status = 'Filed'
WHERE NOT EXISTS (
  SELECT 1 FROM public.bills_not_in_books x
  WHERE x.client_id = b.client_id
    AND x.period_month = to_char(to_date(b.period_month, 'MM/YYYY') + INTERVAL '1 month', 'MM/YYYY')
    AND x.is_carried_forward = true
);

COMMIT;
