-- Move the carry-forward step into the same DB trigger that already locks the
-- 2B/ITC sheets when a GSTR-3B is filed, so it can never again be silently
-- skipped by a browser tab navigating away mid-flight.
--
-- The app-side carryForwardToNextMonth() in FilingStatusPage.tsx runs as a
-- sequence of separate awaited network round-trips *after* the filing_status
-- update has already committed — if the page unloads or the tab is closed
-- between those awaits, the copy into next period silently never happens
-- (that's exactly what caused the incident documented in
-- docs/2B_RECONCILIATION_FLOW.md §6: 21 clients' June-2026 -> July-2026
-- carry-forward went missing, still happening live the day it was found).
--
-- A BEFORE UPDATE trigger runs inside the SAME atomic transaction as the
-- filing_status row's own update — it cannot be interrupted by anything
-- happening in the browser, because by the time the browser's fetch for
-- that update even resolves, the trigger (and everything it did) has
-- already committed server-side.
--
-- This does not replace the app-side call — it stays as a second, now
-- error-checked, self-healing pass (harmless: the operation is a full
-- delete-then-insert, not an append, so running it twice in a row produces
-- the same end state, not duplicates) and is still the only path for a
-- filing_status row created fresh as already-Filed (an INSERT, which this
-- UPDATE-only trigger does not fire for), plus the manual "Re-run carry
-- forward" button for on-demand re-sync.
--
-- Scoped to return_type = 'GSTR-3B' only, matching the existing lock logic
-- in this same trigger — GSTR-3B (Q) (quarterly) still relies on the
-- app-side path only. Every carry-forward incident found (2026-08-14) was on
-- plain monthly GSTR-3B; widening this to quarterly would need a
-- quarter-aware next-period calculation (next quarter-end, not +1 month),
-- which is a separate, unverified change and out of scope here.

CREATE OR REPLACE FUNCTION public.auto_lock_on_filed()
RETURNS TRIGGER AS $$
DECLARE
  v_next_period text;
BEGIN
  -- Only set filed_date when status changes to Filed
  IF NEW.status = 'Filed' AND (OLD.status IS NULL OR OLD.status != 'Filed') THEN
    NEW.filed_date := COALESCE(NEW.filed_date, CURRENT_DATE);

    -- ONLY lock 2B and ITC data when GSTR-3B is filed
    IF NEW.return_type = 'GSTR-3B' THEN
      NEW.is_locked := TRUE;

      -- Lock 2B data for this client and month
      UPDATE public.bills_not_in_2b
      SET is_locked = TRUE
      WHERE client_id = NEW.client_id AND period_month = NEW.period_month;

      UPDATE public.bills_not_in_books
      SET is_locked = TRUE
      WHERE client_id = NEW.client_id AND period_month = NEW.period_month;

      -- Lock ITC Summary
      UPDATE public.itc_summaries
      SET is_locked = TRUE
      WHERE client_id = NEW.client_id AND period_month = NEW.period_month;

      -- Carry forward all bills_not_in_2b / bills_not_in_books rows for this
      -- client+period into next period, exactly matching
      -- carryForwardToNextMonth()'s semantics: delete existing carried-forward
      -- rows there first (so this is safe to run more than once), then copy
      -- every row (regardless of reclaim/book-entry status) forward.
      v_next_period := to_char(to_date(NEW.period_month, 'MM/YYYY') + INTERVAL '1 month', 'MM/YYYY');

      DELETE FROM public.bills_not_in_2b
      WHERE client_id = NEW.client_id AND period_month = v_next_period AND is_carried_forward = true;

      INSERT INTO public.bills_not_in_2b (
        client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
        taxable_value, input_igst, input_cgst, input_sgst,
        period_month, reversal_month, reclaim_month, reclaim_subtype, is_carried_forward
      )
      SELECT
        client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
        taxable_value, input_igst, input_cgst, input_sgst,
        v_next_period, reversal_month, reclaim_month, reclaim_subtype, true
      FROM public.bills_not_in_2b
      WHERE client_id = NEW.client_id AND period_month = NEW.period_month;

      DELETE FROM public.bills_not_in_books
      WHERE client_id = NEW.client_id AND period_month = v_next_period AND is_carried_forward = true;

      INSERT INTO public.bills_not_in_books (
        client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
        taxable_value, input_igst, input_cgst, input_sgst,
        period_month, book_entry_month, bill_in_2b_month, is_carried_forward
      )
      SELECT
        client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
        taxable_value, input_igst, input_cgst, input_sgst,
        v_next_period, book_entry_month, bill_in_2b_month, true
      FROM public.bills_not_in_books
      WHERE client_id = NEW.client_id AND period_month = NEW.period_month;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
