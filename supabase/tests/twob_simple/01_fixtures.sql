-- Fixtures for the prior-month tests (loaded after the migrations). Fictional.
--
-- Staff: a superadmin, a GST Manager and an employee (written as the staff
-- functions write them).
-- t_make_sorath(client, name, liberal): the SORATH case of 17 Oct 2026.
--   GSTR-3B Jun-26, Jul-26 and Aug-26 Filed (locked), Sep-26 Data Received.
--   Jul-26 Not in 2B: two entries carried from earlier months (OLD A, Apr 26;
--   OLD B, Jun 26), two IDENTICAL PERFECT INDUSTRIES 19/26-27 (2,835 CGST and
--   SGST each, reversed Jul 26) and fifteen BOI bank-charge entries without a
--   GSTIN (reversed Jul 26, 6,036.09 CGST and SGST in all); a Not in Books
--   entry (N-1). Aug-26: the carry of July and Aug's own reversal (AUG OWN,
--   1,215, Aug 26); the Not in Books copy booked in Aug (book entry Aug 26).
--   Sep-26: the carry of August. ITC Summaries saved for Jun to Aug (locked)
--   and Sep; Suspended Reco and GST Receivable Reco rows for Jul to Sep.
-- t_make_tamnna(client, name): the TAMNNA case (Strict). Jul-26 Not in 2B:
--   T-1 (1,000 CGST and SGST, posted from the books register) and T-2 (500),
--   both reversed Jul 26; carried into filed Aug-26 and open Sep-26, where
--   T-2's copy is reclaimed in Sep (Sep 26).
-- The ledger rows are written as the carry wrote them (system writes), the
-- filing rows last, as live.
SET check_function_bodies = off;

SET app.staff_roles_write = 'on';
INSERT INTO public.profiles (user_id, first_name) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Super'),
  ('00000000-0000-0000-0000-0000000000a2', 'Manager'),
  ('00000000-0000-0000-0000-0000000000a3', 'Employee')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'superadmin'),
  ('00000000-0000-0000-0000-0000000000a2', 'gst_manager'),
  ('00000000-0000-0000-0000-0000000000a3', 'employee')
ON CONFLICT DO NOTHING;
RESET app.staff_roles_write;

CREATE OR REPLACE FUNCTION public.t_superadmin() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-0000-0000-0000000000a1'::uuid $$;
CREATE OR REPLACE FUNCTION public.t_manager() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-0000-0000-0000000000a2'::uuid $$;
CREATE OR REPLACE FUNCTION public.t_employee() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-0000-0000-0000000000a3'::uuid $$;

-- A saved ITC Summary as the app keeps it (the rows the gates read).
CREATE OR REPLACE FUNCTION public.t_itc(p_51 numeric, p_4b2i numeric, p_54 numeric DEFAULT 0) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'section4A', jsonb_build_array(
      jsonb_build_object('srNo', '(1)', 'particular', 'Import of Goods', 'igst', 0, 'cgst', 0, 'sgst', 0),
      jsonb_build_object('srNo', '(2)', 'particular', 'Import of Services', 'igst', 0, 'cgst', 0, 'sgst', 0),
      jsonb_build_object('srNo', '(3)', 'particular', 'RCM ITC', 'igst', 0, 'cgst', 0, 'sgst', 0),
      jsonb_build_object('srNo', '(4)', 'particular', 'Inward Supplies from ISD', 'igst', 0, 'cgst', 0, 'sgst', 0),
      jsonb_build_object('srNo', '(5)', 'particular', 'All other ITC', 'igst', 0, 'cgst', 0, 'sgst', 0, 'isHeader', true),
      jsonb_build_object('srNo', '5.1', 'particular', 'ITC for the Month', 'igst', 0, 'cgst', p_51, 'sgst', p_51),
      jsonb_build_object('srNo', '5.2', 'particular', 'ITC for Previous Month, if any', 'igst', 0, 'cgst', 0, 'sgst', 0),
      jsonb_build_object('srNo', '5.3', 'particular', 'Debit Note', 'igst', 0, 'cgst', 0, 'sgst', 0),
      jsonb_build_object('srNo', '5.4', 'particular', 'Reclaim of ITC Reversed for Previous months', 'igst', 0, 'cgst', p_54, 'sgst', p_54),
      jsonb_build_object('srNo', '5.5', 'particular', 'Reclaim of ITC Reversed due to 180 days rule/Others', 'igst', 0, 'cgst', 0, 'sgst', 0)),
    'section4B', jsonb_build_array(
      jsonb_build_object('srNo', '(1)', 'particular', 'ITC Reversal under Rule 38, 42 & 43, and Section 17(5)', 'igst', 0, 'cgst', 0, 'sgst', 0),
      jsonb_build_object('srNo', '(2)', 'particular', 'Others', 'igst', 0, 'cgst', 0, 'sgst', 0, 'isHeader', true),
      jsonb_build_object('srNo', '(i)', 'particular', 'ITC Reversal for current month as per 2B RECO', 'igst', 0, 'cgst', p_4b2i, 'sgst', p_4b2i),
      jsonb_build_object('srNo', '(ii)', 'particular', 'ITC Reversal for previous months, if any', 'igst', 0, 'cgst', 0, 'sgst', 0),
      jsonb_build_object('srNo', '(iii)', 'particular', 'ITC Reversal due to 180 days Analysis', 'igst', 0, 'cgst', 0, 'sgst', 0)),
    'section4D', jsonb_build_array(
      jsonb_build_object('srNo', '(1)', 'particular', 'ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period', 'igst', 0, 'cgst', p_54, 'sgst', p_54),
      jsonb_build_object('srNo', '1.1', 'particular', 'Reclaim of ITC Reversed for Previous months', 'igst', 0, 'cgst', p_54, 'sgst', p_54),
      jsonb_build_object('srNo', '1.2', 'particular', 'Reclaim of ITC Reversed due to 180 days rule/Others', 'igst', 0, 'cgst', 0, 'sgst', 0),
      jsonb_build_object('srNo', '(2)', 'particular', 'Ineligible ITC under section 16(4) & ITC restricted due to PoS rules', 'igst', 0, 'cgst', 0, 'sgst', 0)));
$$;

-- The next month's carry of a month, as the old delete-and-copy made it.
CREATE OR REPLACE FUNCTION public.t_copy_month(p_client uuid, p_from text, p_to text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
    taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month, reclaim_subtype, is_carried_forward)
  SELECT client_id, p_to, date, supplier_name, supplier_invoice_number, supplier_gstin,
         taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month, reclaim_subtype, true
    FROM public.bills_not_in_2b WHERE client_id = p_client AND period_month = p_from ORDER BY date, id;
  INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
    taxable_value, input_igst, input_cgst, input_sgst, bill_in_2b_month, book_entry_month, is_carried_forward)
  SELECT client_id, p_to, date, supplier_name, supplier_invoice_number, supplier_gstin,
         taxable_value, input_igst, input_cgst, input_sgst, bill_in_2b_month, book_entry_month, true
    FROM public.bills_not_in_books WHERE client_id = p_client AND period_month = p_from ORDER BY date, id;
$$;

CREATE OR REPLACE FUNCTION public.t_make_sorath(p_client uuid, p_name text, p_liberal boolean) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  boi numeric[] := ARRAY[1.26, 4.41, 588.20, 4.41, 4.41, 4.41, 4.41, 2.25, 2.16, 4.50, 2.25, 4.41, 12.38, 5388.53, 8.10];
  i int;
BEGIN
  PERFORM set_config('twob.write', 'system', true);
  INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES (p_client, p_name, '24AAAAA9999A1Z5', p_liberal);
  INSERT INTO public.itc_summaries (client_id, period_month, data, is_locked) VALUES
    (p_client, '06/2026', public.t_itc(100000, 500), true),
    (p_client, '07/2026', public.t_itc(90000, 11706.09), true),
    (p_client, '08/2026', public.t_itc(80000, 1215), true),
    (p_client, '09/2026', public.t_itc(40000, 0), false);
  INSERT INTO public.suspended_reco (client_id, period_month, opening_cgst, opening_sgst, portal_cgst, portal_sgst) VALUES
    (p_client, '07/2026', 1500, 1500, 2835, 2835),
    (p_client, '08/2026', 4335, 4335, 1215, 1215),
    (p_client, '09/2026', 5550, 5550, 0, 0);
  INSERT INTO public.gst_receivable_reco (client_id, period_month, opening_cgst, opening_sgst, opening_igst,
    books_closing_cgst, books_closing_sgst, books_closing_igst, utilized_cgst, utilized_sgst, utilized_igst, drc_cgst, drc_sgst, drc_igst) VALUES
    (p_client, '08/2026', 10000, 10000, 0, 88293.91, 88293.91, 0, 0, 0, 0, 0, 0, 0),
    (p_client, '09/2026', 88293.91, 88293.91, 0, 167078.91, 167078.91, 0, 0, 0, 0, 0, 0, 0);

  INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
    taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
    (p_client, '07/2026', '2026-04-10', 'OLD A', 'A-1', '24OLDAA0000A1Z5', 5555.56, 0, 1000, 1000, 'Apr 26', true),
    (p_client, '07/2026', '2026-06-11', 'OLD B', 'B-1', '24OLDBB0000A1Z5', 2777.78, 0, 500, 500, 'Jun 26', true),
    (p_client, '07/2026', '2026-07-07', 'PERFECT INDUSTRIES', '19/26-27', '24PERFE0000A1Z5', 31500, 0, 2835, 2835, 'Jul 26', false),
    (p_client, '07/2026', '2026-07-07', 'PERFECT INDUSTRIES', '19/26-27', '24PERFE0000A1Z5', 31500, 0, 2835, 2835, 'Jul 26', false);
  FOR i IN 1 .. array_length(boi, 1) LOOP
    INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number,
      taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward)
    VALUES (p_client, '07/2026', make_date(2026, 7, i), 'BOI - CC', (600 + i)::text, round(boi[i] / 0.09, 2), 0, boi[i], boi[i], 'Jul 26', false);
  END LOOP;
  INSERT INTO public.bills_not_in_books (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
    taxable_value, input_igst, input_cgst, input_sgst, bill_in_2b_month, book_entry_month, is_carried_forward) VALUES
    (p_client, '07/2026', '2026-07-20', 'NIB SUPPLIER', 'N-1', '24NIBSU0000A1Z5', 1000, 0, 90, 90, 'Jul 26', NULL, false);

  PERFORM public.t_copy_month(p_client, '07/2026', '08/2026');
  UPDATE public.bills_not_in_books SET book_entry_month = 'Aug 26' WHERE client_id = p_client AND period_month = '08/2026';
  INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
    taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
    (p_client, '08/2026', '2026-08-05', 'AUG OWN', 'G-8', '24AUGOW0000A1Z5', 6750, 0, 1215, 1215, 'Aug 26', false);
  PERFORM public.t_copy_month(p_client, '08/2026', '09/2026');

  INSERT INTO public.filing_status (client_id, return_type, period_month, status, filed_date, is_locked) VALUES
    (p_client, 'GSTR-3B', '06/2026', 'Filed', '2026-07-20', true),
    (p_client, 'GSTR-3B', '07/2026', 'Filed', '2026-08-20', true),
    (p_client, 'GSTR-3B', '08/2026', 'Filed', '2026-09-20', true),
    (p_client, 'GSTR-3B', '09/2026', 'Data Received', NULL, false);
  UPDATE public.bills_not_in_2b SET is_locked = true WHERE client_id = p_client AND period_month IN ('07/2026', '08/2026');
  UPDATE public.bills_not_in_books SET is_locked = true WHERE client_id = p_client AND period_month IN ('07/2026', '08/2026');
  PERFORM set_config('twob.write', '', true);
END $$;

CREATE OR REPLACE FUNCTION public.t_make_tamnna(p_client uuid, p_name text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_book uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('twob.write', 'system', true);
  INSERT INTO public.clients (id, name, gstin) VALUES (p_client, p_name, '24TAMNN0000A1Z5');
  INSERT INTO public.itc_summaries (client_id, period_month, data, is_locked) VALUES
    (p_client, '07/2026', public.t_itc(50000, 1500), true),
    (p_client, '08/2026', public.t_itc(60000, 0), true),
    (p_client, '09/2026', public.t_itc(70000, 0, 500), false);
  INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
    taxable_value, input_igst, input_cgst, input_sgst, book_treatment, doc_type) VALUES
    (v_book, p_client, '07/2026', '2026-07-15', 'TAMNNA SUPPLIER', 'T-1', '24TSUPP0000A1Z5', 11111.11, 0, 1000, 1000, 'NOT_IN_2B', 'INVOICE');
  INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
    taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward, source_book_id) VALUES
    (p_client, '07/2026', '2026-07-15', 'TAMNNA SUPPLIER', 'T-1', '24TSUPP0000A1Z5', 11111.11, 0, 1000, 1000, 'Jul 26', false, v_book),
    (p_client, '07/2026', '2026-07-16', 'OTHER SUPPLIER', 'T-2', '24OTHER0000A1Z5', 5555.56, 0, 500, 500, 'Jul 26', false, NULL);
  PERFORM public.t_copy_month(p_client, '07/2026', '08/2026');
  PERFORM public.t_copy_month(p_client, '08/2026', '09/2026');
  UPDATE public.bills_not_in_2b SET reclaim_month = 'Sep 26'
   WHERE client_id = p_client AND period_month = '09/2026' AND supplier_invoice_number = 'T-2';
  INSERT INTO public.filing_status (client_id, return_type, period_month, status, filed_date, is_locked) VALUES
    (p_client, 'GSTR-3B', '07/2026', 'Filed', '2026-08-20', true),
    (p_client, 'GSTR-3B', '08/2026', 'Filed', '2026-09-20', true),
    (p_client, 'GSTR-3B', '09/2026', 'Data Received', NULL, false);
  PERFORM set_config('twob.write', '', true);
END $$;

-- The Suspended Reco books side of a month (as the page and the filing check
-- sum it: reversal month set, reclaim month blank), CGST.
CREATE OR REPLACE FUNCTION public.t_books_side(p_client uuid, p_period text) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(input_cgst), 0) FROM public.bills_not_in_2b
   WHERE client_id = p_client AND period_month = p_period
     AND COALESCE(reversal_month, '') <> '' AND COALESCE(reclaim_month, '') = '';
$$;
CREATE OR REPLACE FUNCTION public.t_count(p_client uuid, p_period text, p_supplier text) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = p_client AND period_month = p_period AND supplier_name = p_supplier;
$$;

-- What every saved figure of a client holds (the saved figures that never change).
CREATE OR REPLACE FUNCTION public.t_saved_digest(p_client uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(to_jsonb(s)::text, ',' ORDER BY s.period_month) FROM public.itc_summaries s WHERE s.client_id = p_client),
    (SELECT string_agg(to_jsonb(s)::text, ',' ORDER BY s.period_month) FROM public.suspended_reco s WHERE s.client_id = p_client),
    (SELECT string_agg(to_jsonb(s)::text, ',' ORDER BY s.period_month) FROM public.gst_receivable_reco s WHERE s.client_id = p_client),
    (SELECT string_agg(to_jsonb(s)::text, ',' ORDER BY s.period_month, s.version_number) FROM public.gstr3b_push_versions s WHERE s.client_id = p_client),
    (SELECT string_agg((to_jsonb(s) - 'updated_at')::text, ',' ORDER BY s.period_month, s.return_type) FROM public.filing_status s WHERE s.client_id = p_client)));
$$;

-- The app's ids for the RPC calls: one change as the screens send it.
CREATE OR REPLACE FUNCTION public.t_ids(p_client uuid, p_period text, p_supplier text, p_limit integer DEFAULT 1000) RETURNS uuid[]
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(id ORDER BY date, id), '{}') FROM (
    SELECT id, date FROM public.bills_not_in_2b WHERE client_id = p_client AND period_month = p_period AND supplier_name = p_supplier
     ORDER BY date, id LIMIT p_limit) x;
$$;
GRANT EXECUTE ON FUNCTION public.t_superadmin(), public.t_manager(), public.t_employee(), public.t_books_side(uuid, text),
  public.t_count(uuid, text, text), public.t_saved_digest(uuid), public.t_ids(uuid, text, text, integer) TO anon;
