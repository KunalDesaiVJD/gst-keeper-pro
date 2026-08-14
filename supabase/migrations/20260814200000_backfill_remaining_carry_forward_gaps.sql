-- Follow-up to 20260814180000_backfill_missing_carry_forward.sql.
--
-- That migration re-ran its INSERT ... WHERE NOT EXISTS pass twice in one
-- transaction to close chained two-hop gaps (a client missing two
-- consecutive months of carry-forward). Three clients had chains three (or
-- more) hops deep -- BRICKSTONE INFRA (Nov-2025 through Feb-2026, a 4-hop
-- chain), RAYWINGS SERVICES LLP and NEW FORTUNE TYRES (3-hop chains) -- so
-- the fixed two-pass count left the last hop of each chain unfilled
-- (12 bills_not_in_2b rows + 1 bills_not_in_books row, confirmed by
-- re-running the same audit query the original migration was sized from).
--
-- Same insert, but wrapped in a loop that keeps re-running the pass until a
-- pass inserts zero rows, so it closes a gap chain of any depth in one go
-- instead of a fixed guess at hop count. Still purely additive (same
-- NOT EXISTS guard: only ever inserts into a client+period+table
-- combination that currently has zero carried-forward rows), so it is safe
-- to run more than once and cannot duplicate anything that already carried
-- forward correctly.

DO $$
DECLARE
  v_inserted integer;
BEGIN
  LOOP
    WITH ins_2b AS (
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
      )
      RETURNING 1
    ),
    ins_books AS (
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
      )
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM ins_2b) + (SELECT count(*) FROM ins_books) INTO v_inserted;

    EXIT WHEN v_inserted = 0;
  END LOOP;
END $$;
