-- Repair the three clients whose 2B carry-forward chain was permanently
-- broken by a GSTR-3B being marked Filed for month N+1 while month N's own
-- GSTR-3B was never filed.
--
-- Carry-forward is an event-sourced copy chain: pending 2B items only exist
-- in month N+1 because the "mark GSTR-3B Filed" event on month N physically
-- copied them there (auto_lock_on_filed(), plus the app-side
-- carryForwardToNextMonth()). Nothing ever fires on month N if month N is
-- skipped -- and once N+1 is filed, N+1 copies forward only what N+1 itself
-- happens to contain. Everything older than N then disappears from N+1
-- onwards, permanently. Filing Status has no guard requiring the previous
-- period's GSTR-3B to be filed first, so filing out of order is a normal
-- click, not an error state.
--
-- Found live on 2026-09-16 (reported as Amber Gum's Jun-2026 items missing
-- from Aug-2026):
--
--   AMBER GUM INDUSTRIES          Jun-2026 unfiled, Jul-2026 filed 2026-08-20
--                                 -> 6 rows (3 pending, Rs 2,190.20 tax) lost
--   NAVRATNA S G HIGHWAY PROP.    Dec-2025 unfiled, Jan-2026 filed 2026-03-28
--                                 -> 4 2B rows (Rs 1,90,395 tax) + 83 books
--                                    rows lost
--   SHIVON INFRA- NO ITC          Jun-2026 unfiled, Jul-2026 filed 2026-08-20
--                                 -> 1 row (already reclaimed, no value) lost
--
-- Why not just re-run carry-forward hop by hop: the existing recovery paths
-- (the "Re-run carry forward" button and the auto_lock_on_filed trigger) do
-- DELETE-all-CF-then-INSERT for a single hop. Replaying a nine-hop chain that
-- way would discard every Reclaim / Book Entry / In 2B value staff have since
-- typed onto a carried-forward row in a downstream period -- those edits live
-- on the copy, not on the origin row, so a delete-and-recopy loses them.
--
-- And the 2026-08-14 backfills can't close these gaps either: their guard was
-- "only insert where this client+period+table currently has ZERO carried-
-- forward rows". That is why NAVRATNA's Feb-2026 got its 35 rows back but
-- Mar-2026 (which already had carried-forward rows of its own) was skipped,
-- leaving Mar-2026 short by the same 35 -- a half-repaired chain still
-- visible in the data today.
--
-- So this migration is purely ADDITIVE and per-row: for each hop it inserts
-- only the rows present in month N that have no counterpart in month N+1,
-- matched as a multiset on the invoice's own identity (date, supplier,
-- invoice no, GSTIN, taxable value, and the three tax amounts). Deliberately
-- NOT part of that key: reclaim_month / book_entry_month / bill_in_2b_month.
-- A row staff have since marked reclaimed downstream still matches its
-- origin, so it is recognised as already carried and is neither duplicated
-- nor reset. Nothing is ever deleted or updated.
--
-- Scoped to these three client ids on purpose. A handful of other
-- client+periods carry one or two fewer rows than their source month
-- (VISHVAS POLYPACK Aug-2025, ELENZA CALLISTA Dec-2025, RAYWINGS SERVICES
-- Mar-2026, SALIENT INFRATECH Apr-2026). Those look like a superadmin
-- deleting a carried-forward row on purpose -- a supported action on the 2B
-- Reconciliation page -- and a blind repair would undo that deliberate
-- deletion, so they are left alone.

CREATE OR REPLACE FUNCTION public.repair_carry_forward_chain(
  p_client_id uuid,
  p_from_period text,       -- the period whose rows failed to carry (the break)
  p_to_period text,         -- last period to propagate into, inclusive
  p_max_row_date date DEFAULT NULL  -- optional: at the break period only, carry
                                    -- forward just the rows dated on or before
                                    -- this (see the NAVRATNA note below)
) RETURNS TABLE (period_month text, inserted_2b integer, inserted_books integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev date := to_date(p_from_period, 'MM/YYYY');
  v_last date := to_date(p_to_period, 'MM/YYYY');
  v_cur  date;
  v_prev_p text;
  v_cur_p  text;
  v_n2b integer;
  v_nbk integer;
BEGIN
  WHILE v_prev < v_last LOOP
    v_cur    := v_prev + INTERVAL '1 month';
    v_prev_p := to_char(v_prev, 'MM/YYYY');
    v_cur_p  := to_char(v_cur,  'MM/YYYY');

    -- ---- bills_not_in_2b -------------------------------------------------
    WITH prev AS (
      SELECT b.*,
             row_number() OVER (
               PARTITION BY b.date, b.supplier_name,
                            coalesce(b.supplier_invoice_number, ''),
                            coalesce(b.supplier_gstin, ''),
                            coalesce(b.taxable_value, 0), coalesce(b.input_igst, 0),
                            coalesce(b.input_cgst, 0), coalesce(b.input_sgst, 0)
               ORDER BY b.id
             ) AS rn
      FROM public.bills_not_in_2b b
      WHERE b.client_id = p_client_id AND b.period_month = v_prev_p
        AND (p_max_row_date IS NULL OR v_prev_p <> p_from_period OR b.date <= p_max_row_date)
    ),
    cur AS (
      SELECT b.date, b.supplier_name,
             coalesce(b.supplier_invoice_number, '') AS inv,
             coalesce(b.supplier_gstin, '')          AS gstin,
             coalesce(b.taxable_value, 0) AS tv, coalesce(b.input_igst, 0) AS ig,
             coalesce(b.input_cgst, 0)    AS cg, coalesce(b.input_sgst, 0) AS sg,
             count(*) AS n
      FROM public.bills_not_in_2b b
      WHERE b.client_id = p_client_id AND b.period_month = v_cur_p
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
    ),
    ins AS (
      INSERT INTO public.bills_not_in_2b (
        client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
        taxable_value, input_igst, input_cgst, input_sgst,
        period_month, reversal_month, reclaim_month, reclaim_subtype,
        is_carried_forward, is_locked
      )
      SELECT p.client_id, p.date, p.supplier_name, p.supplier_invoice_number, p.supplier_gstin,
             p.taxable_value, p.input_igst, p.input_cgst, p.input_sgst,
             v_cur_p, p.reversal_month, p.reclaim_month, p.reclaim_subtype,
             true,
             -- match the destination period's own lock state, so a repaired
             -- row in an already-filed period is locked like its neighbours
             COALESCE((SELECT bool_or(x.is_locked) FROM public.bills_not_in_2b x
                       WHERE x.client_id = p_client_id AND x.period_month = v_cur_p), false)
      FROM prev p
      LEFT JOIN cur c
        ON  c.date        = p.date
        AND c.supplier_name = p.supplier_name
        AND c.inv   = coalesce(p.supplier_invoice_number, '')
        AND c.gstin = coalesce(p.supplier_gstin, '')
        AND c.tv    = coalesce(p.taxable_value, 0)
        AND c.ig    = coalesce(p.input_igst, 0)
        AND c.cg    = coalesce(p.input_cgst, 0)
        AND c.sg    = coalesce(p.input_sgst, 0)
      WHERE p.rn > COALESCE(c.n, 0)
      RETURNING 1
    )
    SELECT count(*)::integer INTO v_n2b FROM ins;

    -- ---- bills_not_in_books ----------------------------------------------
    WITH prev AS (
      SELECT b.*,
             row_number() OVER (
               PARTITION BY b.date, b.supplier_name,
                            coalesce(b.supplier_invoice_number, ''),
                            coalesce(b.supplier_gstin, ''),
                            coalesce(b.taxable_value, 0), coalesce(b.input_igst, 0),
                            coalesce(b.input_cgst, 0), coalesce(b.input_sgst, 0)
               ORDER BY b.id
             ) AS rn
      FROM public.bills_not_in_books b
      WHERE b.client_id = p_client_id AND b.period_month = v_prev_p
        AND (p_max_row_date IS NULL OR v_prev_p <> p_from_period OR b.date <= p_max_row_date)
    ),
    cur AS (
      SELECT b.date, b.supplier_name,
             coalesce(b.supplier_invoice_number, '') AS inv,
             coalesce(b.supplier_gstin, '')          AS gstin,
             coalesce(b.taxable_value, 0) AS tv, coalesce(b.input_igst, 0) AS ig,
             coalesce(b.input_cgst, 0)    AS cg, coalesce(b.input_sgst, 0) AS sg,
             count(*) AS n
      FROM public.bills_not_in_books b
      WHERE b.client_id = p_client_id AND b.period_month = v_cur_p
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
    ),
    ins AS (
      INSERT INTO public.bills_not_in_books (
        client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
        taxable_value, input_igst, input_cgst, input_sgst,
        period_month, book_entry_month, bill_in_2b_month,
        is_carried_forward, is_locked
      )
      SELECT p.client_id, p.date, p.supplier_name, p.supplier_invoice_number, p.supplier_gstin,
             p.taxable_value, p.input_igst, p.input_cgst, p.input_sgst,
             v_cur_p, p.book_entry_month, p.bill_in_2b_month,
             true,
             COALESCE((SELECT bool_or(x.is_locked) FROM public.bills_not_in_books x
                       WHERE x.client_id = p_client_id AND x.period_month = v_cur_p), false)
      FROM prev p
      LEFT JOIN cur c
        ON  c.date        = p.date
        AND c.supplier_name = p.supplier_name
        AND c.inv   = coalesce(p.supplier_invoice_number, '')
        AND c.gstin = coalesce(p.supplier_gstin, '')
        AND c.tv    = coalesce(p.taxable_value, 0)
        AND c.ig    = coalesce(p.input_igst, 0)
        AND c.cg    = coalesce(p.input_cgst, 0)
        AND c.sg    = coalesce(p.input_sgst, 0)
      WHERE p.rn > COALESCE(c.n, 0)
      RETURNING 1
    )
    SELECT count(*)::integer INTO v_nbk FROM ins;

    period_month := v_cur_p;
    inserted_2b := v_n2b;
    inserted_books := v_nbk;
    RETURN NEXT;

    v_prev := v_cur;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.repair_carry_forward_chain(uuid, text, text, date) IS
  'Additively re-propagates a client''s bills_not_in_2b / bills_not_in_books '
  'rows forward one period at a time, inserting only the rows a destination '
  'period is missing (multiset-matched on invoice identity, ignoring '
  'reclaim/book-entry status). Never deletes or updates. Use to repair a '
  'carry-forward chain broken by an out-of-order GSTR-3B filing.';

-- --- what each client actually gets ----------------------------------
--
-- AMBER GUM INDUSTRIES -- clean repair. All 6 rows in Jun-2026 are genuine
-- (invoice dates Dec-2025 to Jun-2026, reversal months matching), 3 of them
-- still awaiting reclaim. They go into Jul-2026 and Aug-2026.
--
-- SHIVON INFRA- NO ITC -- 1 row, already reclaimed in May-2026, so no ITC is
-- at stake. Carried anyway so the ledger reads the same as every other
-- client's.
--
-- NAVRATNA S G HIGHWAY PROPERTIES -- partial, and deliberately so. Its
-- Dec-2025 bucket holds two different things:
--
--   * 61 bills_not_in_books rows dated Apr-2025..Dec-2025 -- the genuine
--     accumulated backlog that never carried. These are repaired.
--   * 22 bills_not_in_books rows AND all 4 bills_not_in_2b rows dated
--     Apr-2026 (reversal month "Apr 26"). These were keyed into Dec-2025 by
--     mistake -- almost certainly with the month selector left on Dec-2025 --
--     and the very same invoices already sit correctly in the Apr-2026
--     period. Carrying them forward would inject a phantom duplicate of
--     Rs 1,90,395 of reversal into every period from Jan-2026 to Aug-2026.
--     So the repair stops at 2025-12-31 for this client: the Apr-2026 rows
--     stay where they are and the mis-keyed Dec-2025 bucket is left for the
--     firm to clean up by hand (deleting them is a data decision, not a
--     migration's call).
--
-- Net effect on the 2B side for NAVRATNA is therefore zero -- nothing was
-- actually lost there, only mis-filed.

SELECT * FROM public.repair_carry_forward_chain(
  '5bd07358-313c-4966-979b-f30f9a6b8826', '06/2026', '08/2026');  -- AMBER GUM INDUSTRIES
SELECT * FROM public.repair_carry_forward_chain(
  'f1f95a3f-2935-49b3-a249-0f5f30bce37f', '06/2026', '08/2026');  -- SHIVON INFRA- NO ITC
SELECT * FROM public.repair_carry_forward_chain(
  'd6e9319e-4146-4cc0-9c97-8fd1fd4c26bc', '12/2025', '08/2026', DATE '2025-12-31');  -- NAVRATNA S G HIGHWAY
