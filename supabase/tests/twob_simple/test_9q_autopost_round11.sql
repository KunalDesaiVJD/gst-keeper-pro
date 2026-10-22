-- Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md
-- §15): the eleventh verification round, as PostgREST runs the app's calls
-- (anon, with the request headers; a4 holds Import 2B & post, a1 is the
-- superadmin). Restore of a version written before this release (no
-- document named), after Clear Data, on the lead's rule (never guess):
--   D1 A reclaimed entry whose books row was corrected after its reclaim
--      (the write-through moves the entry's amounts and keeps the reclaim)
--      comes back with its document when that is the month's only document
--      of its identity and the version's only reclaim of it: amounts are
--      not a test (round 10 sent it to Awaiting reclaim, saying the reclaim
--      was not made with that document, which was false).
--   D2 Two lines of one invoice number, one reclaimed with INV-9A and one
--      with INV-9, the second's books row then corrected: both come back in
--      Awaiting reclaim, "cannot be told", and both documents are named as
--      evidencing nothing (round 10: the first line's reclaim moved onto the
--      second's document by amounts and the second's was lost).
-- Each check is recorded (t11_results) and the file fails, naming every
-- failed check, at the end. Fictional.
\set P1 '7eb00000-0000-0000-0000-0000000000c1'
\set D1 '7eb00000-0000-0000-0000-0000000001d1'
\set B1 '7eb00000-0000-0000-0000-0000000001b1'
\set P2 '7eb00000-0000-0000-0000-0000000000c2'
\set DA '7eb00000-0000-0000-0000-0000000002d1'
\set DB '7eb00000-0000-0000-0000-0000000002d2'
\set BA '7eb00000-0000-0000-0000-0000000002b1'
\set BB '7eb00000-0000-0000-0000-0000000002b2'

CREATE TABLE public.t11_results (n serial PRIMARY KEY, label text NOT NULL, ok boolean NOT NULL, info text);
GRANT ALL ON public.t11_results TO anon;
GRANT USAGE ON SEQUENCE public.t11_results_n_seq TO anon;
CREATE FUNCTION public.t11_eq(p_actual anyelement, p_expected anyelement, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.t11_results (label, ok, info)
  VALUES (p_label, p_actual IS NOT DISTINCT FROM p_expected, format('expected [%s], got [%s]', p_expected, p_actual));
END $$;
-- The client's entries (CGST:reclaim month:the number of the document its
-- reclaim names) and 5.4 CGST (entries reclaimed in Oct 26).
CREATE FUNCTION public.t11_entries(p_client uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT concat_ws('|',
    string_agg(concat_ws(':', t.input_cgst::numeric(12,0), COALESCE(t.reclaim_month, '-'),
                         COALESCE((SELECT d.supplier_invoice_number FROM public.twob_import_docs d WHERE d.id = t.reclaimed_via_doc_id), '-')),
               ',' ORDER BY t.input_cgst, t.reclaim_month),
    COALESCE(sum(t.input_cgst) FILTER (WHERE t.reclaim_month = 'Oct 26' AND t.reclaim_subtype IS NULL), 0)::numeric(12,2))
    FROM public.bills_not_in_2b t WHERE t.client_id = p_client;
$$;
CREATE FUNCTION public.t11_said(p_res jsonb, p_key text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(string_agg((x ->> 'supplier_invoice_number') || ': ' || (x ->> 'message'), ' / ' ORDER BY o), '-')
    FROM jsonb_array_elements(COALESCE(p_res -> p_key, '[]'::jsonb)) WITH ORDINALITY e(x, o);
$$;
-- A version as one written before this release holds it (no document, no
-- Import 2B link), in the page's order.
CREATE FUNCTION public.t11_version_old(p_client uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'adopted_from' - 'source_book_id' - 'reclaimed_via_doc_id' ORDER BY t.date, t.source_book_id), '[]'::jsonb)
    FROM public.bills_not_in_2b t WHERE t.client_id = p_client AND t.period_month = '10/2026' AND NOT t.is_carried_forward;
$$;
GRANT EXECUTE ON FUNCTION public.t11_eq(anyelement, anyelement, text), public.t11_entries(uuid), public.t11_said(jsonb, text),
  public.t11_version_old(uuid) TO anon;

SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES
  (:'P1', 'R11 BOOKS CORRECTED', '24RELVA0000A1Z5', false),
  (:'P2', 'R11 TWO LINES CORRECTED', '24RELVB0000A1Z5', false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action) VALUES
  (:'D1', :'P1', '10/2026', '2026-09-15', 'DELTA', 'DL/77', '24DELTA0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  (:'DB', :'P2', '10/2026', '2026-10-05', 'VICTOR', 'INV-9', '24VICTO0000A1Z5', 2000, 0, 180, 180, 'INVOICE', 'MATCHED'),
  (:'DA', :'P2', '10/2026', '2026-10-06', 'VICTOR', 'INV-9A', '24VICTO0000A1Z5', 2000, 0, 180, 180, 'INVOICE', 'MATCHED');
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, book_treatment) VALUES
  (:'B1', :'P1', '10/2026', '2026-09-15', 'DELTA', 'DL/77', '24DELTA0000A1Z5', 1000, 0, 90, 90, 'NOT_IN_2B'),
  (:'BA', :'P2', '10/2026', '2026-10-05', 'VICTOR', 'INV-9', '24VICTO0000A1Z5', 2000, 0, 180, 180, 'NOT_IN_2B'),
  (:'BB', :'P2', '10/2026', '2026-10-05', 'VICTOR', 'INV-9', '24VICTO0000A1Z5', 2000, 0, 180, 180, 'NOT_IN_2B');

-- ---------------------------------------------------------------------------
-- D1. One reclaim, its books row corrected after it.
-- ---------------------------------------------------------------------------
SELECT public.t11_eq(concat_ws('|',
  public.twob_import2b_reclaim(public.t_poster(), :'P1', '10/2026',
    (SELECT t.id FROM public.bills_not_in_2b t WHERE t.source_book_id = :'B1'), :'D1', 'MATCHED') ->> 'ok',
  public.twob_import2b_save_book(public.t_poster(), :'B1', '{"input_cgst": 95, "input_sgst": 95}'::jsonb, NULL, NULL, NULL) ->> 'ok'),
  'true|true', 'D1: DL/77 reclaimed with DL/77 (90), the books row then corrected to 95');
SELECT public.t11_eq(public.t11_entries(:'P1'), '95:Oct 26:DL/77|95.00', 'D1: ... the reclaim kept at 95');
SELECT public.t11_version_old(:'P1') AS v1 \gset
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.t11_eq(public.twob_clear_year(public.t_superadmin(), :'P1', ARRAY['10/2026']) ->> 'deleted', '1', 'D1: Clear Data of the month');
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'P1', '10/2026', :'v1'::jsonb, '[]'::jsonb) AS r1 \gset
SELECT public.t11_eq(concat_ws(' || ', public.t11_entries(:'P1'), public.t11_said(:'r1'::jsonb, 'reclaims_back'), public.t11_said(:'r1'::jsonb, 'docs_left')),
  '95:Oct 26:DL/77|95.00 || - || -',
  'D1: restored: back reclaimed with DL/77, the month''s only document of its identity and the version''s only reclaim of it, though its amounts moved (round 10: Awaiting reclaim, "the reclaim was not made with it")');

-- ---------------------------------------------------------------------------
-- D2. Two lines of INV-9: A reclaimed with INV-9A, B with INV-9, B's books
-- row then corrected to 185.
-- ---------------------------------------------------------------------------
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t11_eq(concat_ws('|',
  public.twob_import2b_reclaim(public.t_poster(), :'P2', '10/2026',
    (SELECT t.id FROM public.bills_not_in_2b t WHERE t.source_book_id = :'BA'), :'DA', 'MATCHED') ->> 'ok',
  public.twob_import2b_reclaim(public.t_poster(), :'P2', '10/2026',
    (SELECT t.id FROM public.bills_not_in_2b t WHERE t.source_book_id = :'BB'), :'DB', 'MATCHED') ->> 'ok',
  public.twob_import2b_save_book(public.t_poster(), :'BB', '{"input_cgst": 185, "input_sgst": 185}'::jsonb, NULL, NULL, NULL) ->> 'ok'),
  'true|true|true', 'D2: A reclaimed with INV-9A, B with INV-9, B corrected to 185');
SELECT public.t11_eq(public.t11_entries(:'P2'), '180:Oct 26:INV-9A,185:Oct 26:INV-9|365.00', 'D2: ... 5.4 365');
SELECT public.t11_version_old(:'P2') AS v2 \gset
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.t11_eq(public.twob_clear_year(public.t_superadmin(), :'P2', ARRAY['10/2026']) ->> 'deleted', '2', 'D2: Clear Data of the month');
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'P2', '10/2026', :'v2'::jsonb, '[]'::jsonb) AS r2 \gset
SELECT public.t11_eq(public.t11_entries(:'P2'), '180:-:-,185:-:-|0.00',
  'D2: restored: both lines in Awaiting reclaim; neither reclaim moved onto the other''s document (round 10: A on INV-9, B lost, 5.4 180)');
SELECT public.t11_eq(public.t11_said(:'r2'::jsonb, 'reclaims_back'),
  'INV-9: its 2B document cannot be told: this version does not name it, and 2 of its reclaims are the same document as VICTOR INV-9, the one 2B document of this month with their GSTIN or supplier, number and date; reclaim it again on Import 2B'
  || ' / INV-9: its 2B document cannot be told: this version does not name it, and 2 of its reclaims are the same document as VICTOR INV-9, the one 2B document of this month with their GSTIN or supplier, number and date; reclaim it again on Import 2B',
  'D2: ... both named "cannot be told" (round 10: B said "the reclaim was not made with it", which was false)');
SELECT public.t11_eq(public.t11_said(:'r2'::jsonb, 'docs_left'),
  'INV-9: is Reclaim and evidences no reclaim, so its ITC counts nowhere / INV-9A: is Reclaim and evidences no reclaim, so its ITC counts nowhere',
  'D2: ... INV-9 and INV-9A both named as evidencing nothing');

RESET ROLE;
SELECT set_config('twob.write', 'system', false);
DELETE FROM public.clients WHERE id IN (:'P1', :'P2');
SELECT set_config('twob.write', '', false);

DO $$
DECLARE
  v text;
  v_ok integer;
  v_all integer;
BEGIN
  SELECT count(*) FILTER (WHERE r.ok), count(*) INTO v_ok, v_all FROM public.t11_results r;
  SELECT string_agg(format('FAILED %s: %s', r.label, r.info), E'\n' ORDER BY r.n) INTO v FROM public.t11_results r WHERE NOT r.ok;
  RAISE NOTICE 'checks: round11 (SQL) % of % passed', v_ok, v_all;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION E'round11 (SQL): % of % checks passed\n%', v_ok, v_all, v;
  END IF;
END $$;
DROP TABLE public.t11_results;
DROP FUNCTION public.t11_eq(anyelement, anyelement, text), public.t11_entries(uuid), public.t11_said(jsonb, text),
  public.t11_version_old(uuid);
