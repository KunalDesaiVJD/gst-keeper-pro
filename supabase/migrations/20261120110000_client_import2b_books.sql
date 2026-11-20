-- A client's own login works the whole of Import 2B on its own GSTIN like
-- staff (the firm, 20 Nov 2026, after 20261120100000 opened only the Action
-- column): it also saves and pairs its books register rows, deletes them, and
-- brings an out-of-step open month up to date. These accept the client as the
-- actor for its own rows, as they accept a holder of Import 2B & post:
--   twob_import2b_save_book   a books row's save / pairing (the row's client)
--   twob__autopost_gone       a deleted books row or document that held a ledger entry
--   twob_import2b_catch_up    "Bring the reconciliation up to date"
-- Still staff-only: deleting the month's 2B (twob_import2b_delete_2b), Clear
-- Data, Restore, prior (filed) months, importing or pulling 2B.
-- Undo: re-create the three functions from 20261021170000.

CREATE OR REPLACE FUNCTION public.twob_import2b_save_book(p_actor_id uuid, p_book_id uuid, p_values jsonb, p_release_doc_id uuid DEFAULT NULL::uuid, p_pair_doc_id uuid DEFAULT NULL::uuid, p_expect jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_book record;
  r public.books_register;
  v_pair text;
  v_bad text;
  v_row jsonb;
BEGIN
  -- Staff, or the client's own login on its own books row (20261120110000).
  IF p_actor_id IS NULL OR (COALESCE(public.staff_level_of(p_actor_id), '') NOT IN ('superadmin', 'gst_manager', 'employee')
     AND NOT EXISTS (SELECT 1 FROM public.books_register br WHERE br.id = p_book_id AND br.client_id = p_actor_id)) THEN
    RAISE EXCEPTION 'Only staff, or the client on its own GSTIN, save the books register.';
  END IF;
  -- The write-throughs below check this user when the request names none.
  PERFORM set_config('twob.actor', p_actor_id::text, true);
  p_values := COALESCE(p_values, '{}'::jsonb);
  IF jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'No values were sent.';
  END IF;
  IF p_expect IS NOT NULL AND jsonb_typeof(p_expect) <> 'object' THEN
    RAISE EXCEPTION 'The row as the page loaded it was not sent.';
  END IF;
  SELECT k INTO v_bad FROM (SELECT jsonb_object_keys(p_values) UNION ALL SELECT jsonb_object_keys(COALESCE(p_expect, '{}'::jsonb))) x(k)
   WHERE k NOT IN ('date', 'supplier_name', 'supplier_invoice_number', 'supplier_gstin', 'taxable_value', 'input_igst',
                   'input_cgst', 'input_sgst', 'doc_type', 'book_treatment', 'matched_2b_id') LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A books row saves its date, supplier, number, GSTIN, amounts, type and treatment here (%).', v_bad;
  END IF;
  SELECT b.id, b.client_id, b.period_month, to_jsonb(b) AS j INTO v_book FROM public.books_register b WHERE b.id = p_book_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This books row is no longer here. Reload the page.';
  END IF;
  -- The row as the page loaded it (verification round 5), checked with the
  -- row locked, before anything is written.
  IF public.twob__expect_differs(v_book.j, p_expect) IS NOT NULL THEN
    RAISE EXCEPTION 'Nothing was saved: books row % was changed elsewhere since this page loaded it (another tab or another user; its %). The row is shown again as it is now.',
      COALESCE(public.twob__entry_name(v_book.j), '(no number)'), replace(public.twob__expect_differs(v_book.j, p_expect), '_', ' ')
      USING ERRCODE = 'TWB04';
  END IF;
  -- The documents, in id order, from this client's month only.
  PERFORM 1 FROM public.twob_import_docs d
   WHERE d.id IN (p_release_doc_id, p_pair_doc_id) AND d.client_id = v_book.client_id AND d.period_month = v_book.period_month
   ORDER BY d.id FOR NO KEY UPDATE;
  IF p_release_doc_id IS NOT NULL AND p_release_doc_id IS DISTINCT FROM p_pair_doc_id THEN
    UPDATE public.twob_import_docs d
       SET matched_book_id = NULL,
           itc_action = CASE WHEN d.itc_action = 'MISMATCHED' THEN 'MATCHED' ELSE d.itc_action END,
           updated_by = p_actor_id, updated_at = now()
     WHERE d.id = p_release_doc_id AND d.client_id = v_book.client_id AND d.period_month = v_book.period_month
       AND (d.matched_book_id = p_book_id OR d.matched_book_id IS NULL);
  END IF;
  IF p_pair_doc_id IS NOT NULL THEN
    SELECT d.itc_action INTO v_pair FROM public.twob_import_docs d
     WHERE d.id = p_pair_doc_id AND d.client_id = v_book.client_id AND d.period_month = v_book.period_month;
    IF v_pair IS NULL THEN
      RAISE EXCEPTION 'The 2B document this row pairs with is no longer in this month. Reload the page.';
    END IF;
    UPDATE public.twob_import_docs d
       SET matched_book_id = p_book_id,
           itc_action = CASE WHEN d.itc_action IN ('MATCHED', 'MISMATCHED', 'NOT_IN_BOOKS') THEN 'MISMATCHED' ELSE d.itc_action END,
           updated_by = p_actor_id, updated_at = now()
     WHERE d.id = p_pair_doc_id;
  END IF;
  r := jsonb_populate_record(NULL::public.books_register, p_values);
  UPDATE public.books_register b SET
    date = CASE WHEN p_values ? 'date' THEN r.date ELSE b.date END,
    supplier_name = CASE WHEN p_values ? 'supplier_name' THEN r.supplier_name ELSE b.supplier_name END,
    supplier_invoice_number = CASE WHEN p_values ? 'supplier_invoice_number' THEN r.supplier_invoice_number ELSE b.supplier_invoice_number END,
    supplier_gstin = CASE WHEN p_values ? 'supplier_gstin' THEN r.supplier_gstin ELSE b.supplier_gstin END,
    taxable_value = CASE WHEN p_values ? 'taxable_value' THEN r.taxable_value ELSE b.taxable_value END,
    input_igst = CASE WHEN p_values ? 'input_igst' THEN r.input_igst ELSE b.input_igst END,
    input_cgst = CASE WHEN p_values ? 'input_cgst' THEN r.input_cgst ELSE b.input_cgst END,
    input_sgst = CASE WHEN p_values ? 'input_sgst' THEN r.input_sgst ELSE b.input_sgst END,
    doc_type = CASE WHEN p_values ? 'doc_type' THEN r.doc_type ELSE b.doc_type END,
    book_treatment = CASE WHEN p_values ? 'book_treatment' THEN r.book_treatment ELSE b.book_treatment END,
    matched_2b_id = CASE WHEN p_values ? 'matched_2b_id' THEN r.matched_2b_id ELSE b.matched_2b_id END,
    updated_by = p_actor_id, updated_at = now()
   WHERE b.id = p_book_id
  RETURNING to_jsonb(b) INTO v_row;
  PERFORM set_config('twob.actor', '', true);
  RETURN jsonb_build_object('ok', true, 'paired_was', v_pair, 'row', v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.twob__autopost_gone()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  n integer := 0;
  v_rows integer := 0;
  v_key text;
  v_marks text;
  v_req uuid;
BEGIN
  IF COALESCE(current_setting('twob.write', true), '') IN ('rpc', 'system') THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'books_register' THEN
    IF NOT EXISTS (SELECT 1 FROM public.bills_not_in_2b t WHERE t.source_book_id = OLD.id) THEN
      RETURN OLD;
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.bills_not_in_books t WHERE t.source_doc_id = OLD.id) THEN
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = OLD.client_id)
     OR public.twob_month_is_prior(OLD.client_id, OLD.period_month) THEN
    RETURN OLD;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || OLD.client_id::text, 0));
  -- An own entry it was linked to instead of adding one (adopted_from) is put
  -- back as it was and unlinked, never removed.
  IF TG_TABLE_NAME = 'books_register' THEN
    UPDATE public.bills_not_in_2b t
       SET date = COALESCE(public.twob__try_date(t.adopted_from ->> 'date'), t.date), supplier_name = COALESCE(t.adopted_from ->> 'supplier_name', t.supplier_name),
           supplier_invoice_number = t.adopted_from ->> 'supplier_invoice_number', supplier_gstin = t.adopted_from ->> 'supplier_gstin',
           taxable_value = public.twob__try_num(t.adopted_from ->> 'taxable_value'), input_igst = public.twob__try_num(t.adopted_from ->> 'input_igst'),
           input_cgst = public.twob__try_num(t.adopted_from ->> 'input_cgst'), input_sgst = public.twob__try_num(t.adopted_from ->> 'input_sgst'),
           source_book_id = NULL, adopted_from = NULL, updated_at = now()
     WHERE t.source_book_id = OLD.id AND t.adopted_from IS NOT NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    DELETE FROM public.bills_not_in_2b t
     WHERE t.source_book_id = OLD.id AND t.client_id = OLD.client_id AND t.period_month = OLD.period_month
       AND NOT COALESCE(t.is_locked, false)
       AND NULLIF(btrim(COALESCE(t.reclaim_month, '')), '') IS NULL AND t.reclaim_subtype IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  ELSE
    UPDATE public.bills_not_in_books t
       SET date = COALESCE(public.twob__try_date(t.adopted_from ->> 'date'), t.date), supplier_name = COALESCE(t.adopted_from ->> 'supplier_name', t.supplier_name),
           supplier_invoice_number = t.adopted_from ->> 'supplier_invoice_number', supplier_gstin = t.adopted_from ->> 'supplier_gstin',
           taxable_value = public.twob__try_num(t.adopted_from ->> 'taxable_value'), input_igst = public.twob__try_num(t.adopted_from ->> 'input_igst'),
           input_cgst = public.twob__try_num(t.adopted_from ->> 'input_cgst'), input_sgst = public.twob__try_num(t.adopted_from ->> 'input_sgst'),
           source_doc_id = NULL, adopted_from = NULL, updated_at = now()
     WHERE t.source_doc_id = OLD.id AND t.adopted_from IS NOT NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    DELETE FROM public.bills_not_in_books t
     WHERE t.source_doc_id = OLD.id AND t.client_id = OLD.client_id AND t.period_month = OLD.period_month
       AND NOT COALESCE(t.is_locked, false)
       AND NULLIF(btrim(COALESCE(t.book_entry_month, '')), '') IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END IF;
  n := n + v_rows;
  IF n > 0 THEN
    v_req := public.twob__acting_user();
    IF v_req IS NOT NULL AND v_req IS DISTINCT FROM OLD.client_id AND NOT public.twob__may_post(v_req) THEN
      RAISE EXCEPTION 'Not saved: this change would change the 2B Reconciliation ledger, which needs the Import 2B & post permission. Ask a GST Manager to add it to your position.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_key := OLD.client_id::text || '|' || OLD.period_month || ';';
    v_marks := COALESCE(current_setting('twob.autopost_marks', true), '');
    IF strpos(v_marks, v_key) = 0 THEN
      PERFORM set_config('twob.autopost_marks', v_marks || v_key, true);
    END IF;
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.twob_import2b_catch_up(p_actor_id uuid, p_client_id uuid, p_period text, p_dry_run boolean DEFAULT true, p_digest text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
  v_num integer;
BEGIN
  IF p_client_id IS NULL OR public.twob_period_key(p_period) IS NULL THEN
    RAISE EXCEPTION 'Choose a client and a month.';
  END IF;
  IF p_actor_id IS DISTINCT FROM p_client_id AND NOT public.twob__staff_may(p_actor_id, 'work_2b_import') THEN
    RAISE EXCEPTION 'Needs the Import 2B & post permission. Ask a GST Manager to add it to your position.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  IF public.twob_month_is_prior(p_client_id, p_period) THEN
    RAISE EXCEPTION 'This month is filed. A GST Manager or the superadmin brings its Not in 2B side up to date, from Import 2B.';
  END IF;
  IF NOT p_dry_run THEN
    PERFORM public.twob__lock_month_rows(p_client_id, ARRAY[p_period], false);
  END IF;
  v := public.twob__autopost_apply(p_client_id, p_period, NULL, NULL, p_actor_id, p_dry_run, true, p_digest);
  IF NOT p_dry_run AND COALESCE((v ->> 'written')::integer, 0) > 0 THEN
    PERFORM public.twob__autopost_changed(p_client_id, p_period, p_actor_id);
    v_num := public.twob__autopost_snapshot(p_client_id, p_period, p_actor_id);
  END IF;
  RETURN v || jsonb_build_object('period', p_period, 'version', v_num);
END;
$function$;
