-- Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md
-- §15): the tenth verification round, as PostgREST runs the app's calls
-- (anon, with the request headers; a4 holds Import 2B & post, a1 is the
-- superadmin). Restore, on the lead's rule (simplify, never guess):
--   O  A document left Reclaim evidencing nothing is named (docs_left),
--      never changed: the version held its entry in Awaiting reclaim (or
--      did not hold it at all), or named another document, so the reclaim
--      recorded with it since is undone and its ITC counts nowhere. Round 9
--      left it so without a word (reclaims_back names only the version's
--      reclaims). Then it is reclaimed with again on Import 2B (Link &
--      Reclaim sends Reclaim as the treatment the page shows).
--   T  Two reclaims of the version that are the same document (rule (3))
--      are never told apart by the version's order: a reclaim found by (3)
--      is that document's only while no other reclaim of the version takes
--      it, and only while its amounts are the document's (each head within
--      Link & Reclaim's Rs. 2: a reclaim is never made with a document of
--      other amounts). Round 9 gave the first the month's one document of
--      that identity, whatever its amounts, and the other's reclaim moved.
--   R  A document goes to the reclaim that knows it best: (1) the version
--      names it, before (2) the month's entry of that id names it now,
--      before (3); and the one left out says where the other's document is
--      known from ("in this version", "now"). Round 9 ranked (1) and (2)
--      alike, by the version's order, with a false reason.
-- Each check is recorded (t10_results) and the file fails, naming every
-- failed check, at the end: run against round 9's code, each check fails or
-- passes on its own. Fictional.
\set X '7ea00000-0000-0000-0000-0000000000c1'
\set Y '7ea00000-0000-0000-0000-0000000000c2'
\set Z '7ea00000-0000-0000-0000-0000000000c3'
\set V '7ea00000-0000-0000-0000-0000000000c4'
\set W '7ea00000-0000-0000-0000-0000000000c5'
\set K '7ea00000-0000-0000-0000-0000000000c6'
\set N '7ea00000-0000-0000-0000-0000000000c7'

CREATE TABLE public.t10_results (n serial PRIMARY KEY, label text NOT NULL, ok boolean NOT NULL, info text);
GRANT ALL ON public.t10_results TO anon;
GRANT USAGE ON SEQUENCE public.t10_results_n_seq TO anon;
CREATE FUNCTION public.t10_eq(p_actual anyelement, p_expected anyelement, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.t10_results (label, ok, info)
  VALUES (p_label, p_actual IS NOT DISTINCT FROM p_expected, format('expected [%s], got [%s]', p_expected, p_actual));
END $$;
-- 5.1 CGST (Matched and Mismatched documents) and 5.4 CGST (entries
-- reclaimed in Oct 26), as ITC Summary reads them.
CREATE FUNCTION public.t10_itc(p_client uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT concat_ws('|',
    COALESCE((SELECT sum(d.input_cgst) FROM public.twob_import_docs d
               WHERE d.client_id = p_client AND d.period_month = '10/2026' AND d.itc_action IN ('MATCHED', 'MISMATCHED')), 0)::numeric(12,2),
    COALESCE((SELECT sum(t.input_cgst) FROM public.bills_not_in_2b t
               WHERE t.client_id = p_client AND t.reclaim_month = 'Oct 26' AND t.reclaim_subtype IS NULL), 0)::numeric(12,2));
$$;
-- The client's entries: number:CGST:reclaim month:the number of the
-- document its reclaim names; its documents: number=treatment.
CREATE FUNCTION public.t10_entries(p_client uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT string_agg(concat_ws(':', t.supplier_invoice_number, t.input_cgst::numeric(12,0), COALESCE(t.reclaim_month, '-'),
                              COALESCE((SELECT d.supplier_invoice_number FROM public.twob_import_docs d WHERE d.id = t.reclaimed_via_doc_id), '-')),
                    ',' ORDER BY t.date, t.supplier_invoice_number, t.input_cgst)
    FROM public.bills_not_in_2b t WHERE t.client_id = p_client;
$$;
CREATE FUNCTION public.t10_docs(p_client uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT string_agg(d.supplier_invoice_number || '=' || d.itc_action, ',' ORDER BY d.date, d.supplier_invoice_number)
    FROM public.twob_import_docs d WHERE d.client_id = p_client;
$$;
-- The names and messages of a Restore's reclaims_back / docs_left.
CREATE FUNCTION public.t10_said(p_res jsonb, p_key text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(string_agg((x ->> 'supplier_invoice_number') || ': ' || (x ->> 'message'), ' / ' ORDER BY o), '-')
    FROM jsonb_array_elements(COALESCE(p_res -> p_key, '[]'::jsonb)) WITH ORDINALITY e(x, o);
$$;
-- A month's own Not in 2B entries as a version holds them: as this release
-- records them (each reclaim naming its document), or as a version written
-- before (no document, no Import 2B link).
CREATE FUNCTION public.t10_version(p_client uuid, p_old boolean) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(CASE WHEN p_old THEN to_jsonb(t) - 'adopted_from' - 'source_book_id' - 'reclaimed_via_doc_id'
                                 ELSE to_jsonb(t) - 'adopted_from' END ORDER BY t.date, t.supplier_invoice_number, t.input_cgst), '[]'::jsonb)
    FROM public.bills_not_in_2b t WHERE t.client_id = p_client AND t.period_month = '10/2026' AND NOT t.is_carried_forward;
$$;
GRANT EXECUTE ON FUNCTION public.t10_eq(anyelement, anyelement, text), public.t10_itc(uuid), public.t10_entries(uuid),
  public.t10_docs(uuid), public.t10_said(jsonb, text), public.t10_version(uuid, boolean) TO anon;

SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES
  (:'X', 'R10 AWAITING IN THE VERSION', '24RTENX0000A1Z5', false),
  (:'Y', 'R10 ENTRY ADDED AFTER', '24RTENY0000A1Z5', false),
  (:'Z', 'R10 VERSION NAMES ANOTHER', '24RTENZ0000A1Z5', false),
  (:'V', 'R10 ONE INVOICE TWO LINES', '24RTENV0000A1Z5', false),
  (:'W', 'R10 TWO LINES ALIKE', '24RTENW0000A1Z5', false),
  (:'K', 'R10 VERSION NAMES FIRST', '24RTENK0000A1Z5', true),
  (:'N', 'R10 NAMED NOW', '24RTENN0000A1Z5', false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action) VALUES
  ('7ea00000-0000-0000-0000-0000000001d1', :'X', '10/2026', '2026-10-01', 'LANDLORD', 'RENT/2026/10', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'INVOICE', 'MATCHED'),
  ('7ea00000-0000-0000-0000-0000000002d1', :'Y', '10/2026', '2026-10-01', 'LANDLORD', 'RENT/2026/10', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'INVOICE', 'MATCHED'),
  ('7ea00000-0000-0000-0000-0000000003d1', :'Z', '10/2026', '2026-09-01', 'LANDLORD', 'RENT/2026/09', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'INVOICE', 'MATCHED'),
  ('7ea00000-0000-0000-0000-0000000003d2', :'Z', '10/2026', '2026-09-01', 'LANDLORD', 'RENT/2026/09-R', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'INVOICE', 'MATCHED'),
  -- V: VICTOR INV-9 (180) and INV-9A (50), the books holding INV-9 as two lines, 50 and 180.
  ('7ea00000-0000-0000-0000-0000000004d1', :'V', '10/2026', '2026-10-05', 'VICTOR', 'INV-9', '24VICTO0000A1Z5', 2000, 0, 180, 180, 'INVOICE', 'MATCHED'),
  ('7ea00000-0000-0000-0000-0000000004d2', :'V', '10/2026', '2026-10-06', 'VICTOR', 'INV-9A', '24VICTO0000A1Z5', 1000, 0, 50, 50, 'INVOICE', 'MATCHED'),
  -- W: WHISKY W-5 and W-5B, both 180; the books hold W-5 as two lines of 180.
  ('7ea00000-0000-0000-0000-0000000005d1', :'W', '10/2026', '2026-10-07', 'WHISKY', 'W-5', '24WHISK0000A1Z5', 2000, 0, 180, 180, 'INVOICE', 'MATCHED'),
  ('7ea00000-0000-0000-0000-0000000005d2', :'W', '10/2026', '2026-10-08', 'WHISKY', 'W-5B', '24WHISK0000A1Z5', 2000, 0, 180, 180, 'INVOICE', 'MATCHED'),
  ('7ea00000-0000-0000-0000-0000000006d1', :'K', '10/2026', '2026-10-01', 'LANDLORD', 'RENT/2026/10', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'INVOICE', 'MATCHED'),
  ('7ea00000-0000-0000-0000-0000000007d1', :'N', '10/2026', '2026-10-02', 'NOVA', 'NV-11', '24NOVAA0000A1Z5', 3000, 0, 270, 270, 'INVOICE', 'MATCHED');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month, is_carried_forward) VALUES
  ('7ea00000-0000-0000-0000-0000000001e1', :'X', '10/2026', '2026-10-01', 'LANDLORD', 'R-OCT', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'Oct 26', NULL, false),
  ('7ea00000-0000-0000-0000-0000000003e1', :'Z', '10/2026', '2026-09-01', 'LANDLORD', 'R-SEP', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'Oct 26', NULL, false),
  ('7ea00000-0000-0000-0000-0000000004e1', :'V', '10/2026', '2026-10-05', 'VICTOR', 'INV-9', '24VICTO0000A1Z5', 1000, 0, 50, 50, 'Oct 26', NULL, false),
  ('7ea00000-0000-0000-0000-0000000004e2', :'V', '10/2026', '2026-10-05', 'VICTOR', 'INV-9', '24VICTO0000A1Z5', 2000, 0, 180, 180, 'Oct 26', NULL, false),
  ('7ea00000-0000-0000-0000-0000000005e1', :'W', '10/2026', '2026-10-07', 'WHISKY', 'W-5', '24WHISK0000A1Z5', 2000, 0, 180, 180, 'Oct 26', NULL, false),
  ('7ea00000-0000-0000-0000-0000000005e2', :'W', '10/2026', '2026-10-07', 'WHISKY', 'W-5', '24WHISK0000A1Z5', 2000, 0, 180, 180, 'Oct 26', NULL, false),
  -- K (Liberal): R-B typed reclaimed (no document), R-A awaiting.
  ('7ea00000-0000-0000-0000-0000000006e1', :'K', '10/2026', '2026-09-30', 'LANDLORD', 'R-B', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'Oct 26', 'Oct 26', false),
  ('7ea00000-0000-0000-0000-0000000006e2', :'K', '10/2026', '2026-10-01', 'LANDLORD', 'R-A', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'Oct 26', NULL, false),
  -- N: NV-11 (the same document as NOVA NV-11) and N-BOOKS (numbered otherwise), both awaiting.
  ('7ea00000-0000-0000-0000-0000000007e1', :'N', '10/2026', '2026-10-02', 'NOVA', 'NV-11', '24NOVAA0000A1Z5', 3000, 0, 270, 270, 'Oct 26', NULL, false),
  ('7ea00000-0000-0000-0000-0000000007e2', :'N', '10/2026', '2026-10-02', 'NOVA', 'N-BOOKS', '24NOVAA0000A1Z5', 3000, 0, 270, 270, 'Oct 26', NULL, false);
SELECT set_config('twob.write', '', false);

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);

-- ---------------------------------------------------------------------------
-- O. A document left Reclaim evidencing nothing is named, never changed.
-- ---------------------------------------------------------------------------
-- (a) The usual "undo the last save": a version taken while R-OCT awaited a
-- reclaim; R-OCT then reclaimed on Import 2B with LANDLORD RENT/2026/10
-- (numbered otherwise); the version restored.
SELECT public.t10_version(:'X', false) AS vx \gset
SELECT public.t10_eq(public.twob_import2b_reclaim(public.t_poster(), :'X', '10/2026', '7ea00000-0000-0000-0000-0000000001e1',
  '7ea00000-0000-0000-0000-0000000001d1', 'MATCHED') ->> 'ok', 'true', 'O(a): R-OCT reclaimed with RENT/2026/10 after the version');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'X', '10/2026', :'vx'::jsonb, '[]'::jsonb) AS ox \gset
SELECT public.t10_eq(concat_ws('|', public.t10_entries(:'X'), public.t10_docs(:'X'), public.t10_itc(:'X'), public.t10_said(:'ox'::jsonb, 'reclaims_back')),
  'R-OCT:4500:-:-|RENT/2026/10=RECLAIM|0.00|0.00|-',
  'O(a): restored as the version holds it: R-OCT in Awaiting reclaim, the document left Reclaim (never changed by a Restore)');
SELECT public.t10_eq(public.t10_said(:'ox'::jsonb, 'docs_left'),
  'RENT/2026/10: stays Reclaim and evidences no reclaim now, so its ITC counts nowhere; before this Restore it evidenced the reclaim of LANDLORD R-OCT',
  'O(a): ... and named, with the reclaim it evidenced (round 9: said nothing, its ITC counted nowhere)');
-- Reclaimed with it again on Import 2B: Link & Reclaim offers it and sends
-- Reclaim, the treatment the page shows.
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t10_eq(public.twob_import2b_reclaim(public.t_poster(), :'X', '10/2026', '7ea00000-0000-0000-0000-0000000001e1',
  '7ea00000-0000-0000-0000-0000000001d1', 'RECLAIM')::text, '{"ok": true, "was": "RECLAIM"}', 'O(a): ... reclaimed with again from Pending items, sent as Reclaim');
SELECT public.t10_eq(concat_ws('|', public.t10_entries(:'X'), public.t10_itc(:'X')), 'R-OCT:4500:Oct 26:RENT/2026/10|0.00|4500.00',
  'O(a): ... its ITC counted again, once (5.4 4500)');
-- (b) R-OCT added after the version (which holds no own entry), then
-- reclaimed; the version restored takes R-OCT away: RENT/2026/10 named.
RESET ROLE;
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('7ea00000-0000-0000-0000-0000000002e1', :'Y', '10/2026', '2026-10-01', 'LANDLORD', 'R-OCT', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'Oct 26', false);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.t10_eq(public.twob_import2b_reclaim(public.t_poster(), :'Y', '10/2026', '7ea00000-0000-0000-0000-0000000002e1',
  '7ea00000-0000-0000-0000-0000000002d1', 'MATCHED') ->> 'ok', 'true', 'O(b): R-OCT, added after the version, reclaimed');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'Y', '10/2026', '[]'::jsonb, '[]'::jsonb) AS oy \gset
SELECT public.t10_eq(concat_ws('|', COALESCE(public.t10_entries(:'Y'), '-'), public.t10_docs(:'Y'), public.t10_itc(:'Y'), public.t10_said(:'oy'::jsonb, 'docs_left')),
  '-|RENT/2026/10=RECLAIM|0.00|0.00|RENT/2026/10: stays Reclaim and evidences no reclaim now, so its ITC counts nowhere; before this Restore it evidenced the reclaim of LANDLORD R-OCT',
  'O(b): restored: R-OCT gone, RENT/2026/10 left Reclaim and named with it (round 9: nothing said)');
-- (c) A version naming RENT/2026/09 for R-SEP; RENT/2026/09 then taken out
-- of Reclaim and R-SEP reclaimed with RENT/2026/09-R; the version restored:
-- R-SEP back in Awaiting reclaim (its document Matched now), and
-- RENT/2026/09-R named.
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t10_eq(public.twob_import2b_reclaim(public.t_poster(), :'Z', '10/2026', '7ea00000-0000-0000-0000-0000000003e1',
  '7ea00000-0000-0000-0000-0000000003d1', 'MATCHED') ->> 'ok', 'true', 'O(c): R-SEP reclaimed with RENT/2026/09');
SELECT public.t10_version(:'Z', false) AS vz \gset
SELECT public.t10_eq(concat_ws('|',
  public.twob_import2b_unreclaim(public.t_poster(), :'Z', '10/2026', '7ea00000-0000-0000-0000-0000000003d1', 'MATCHED', '7ea00000-0000-0000-0000-0000000003e1') ->> 'ok',
  public.twob_import2b_reclaim(public.t_poster(), :'Z', '10/2026', '7ea00000-0000-0000-0000-0000000003e1', '7ea00000-0000-0000-0000-0000000003d2', 'MATCHED') ->> 'ok'),
  'true|true', 'O(c): ... RENT/2026/09 out of Reclaim, R-SEP reclaimed with RENT/2026/09-R');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'Z', '10/2026', :'vz'::jsonb, '[]'::jsonb) AS oz \gset
SELECT public.t10_eq(concat_ws('|', public.t10_entries(:'Z'), public.t10_docs(:'Z'), public.t10_itc(:'Z')),
  'R-SEP:4500:-:-|RENT/2026/09=MATCHED,RENT/2026/09-R=RECLAIM|4500.00|0.00',
  'O(c): restored: R-SEP in Awaiting reclaim, RENT/2026/09 Matched, RENT/2026/09-R left Reclaim');
SELECT public.t10_eq(concat_ws(' || ', public.t10_said(:'oz'::jsonb, 'reclaims_back'), public.t10_said(:'oz'::jsonb, 'docs_left')),
  'R-SEP: its 2B document is Matched now, not Reclaim || RENT/2026/09-R: stays Reclaim and evidences no reclaim now, so its ITC counts nowhere; before this Restore it evidenced the reclaim of LANDLORD R-SEP',
  'O(c): ... both named: R-SEP with why, RENT/2026/09-R with the reclaim it evidenced (round 9: RENT/2026/09-R not named)');

-- ---------------------------------------------------------------------------
-- T. Two reclaims of one identity are never told apart by order.
-- ---------------------------------------------------------------------------
-- (a) VICTOR INV-9 in the books as two lines, 50 and 180: the 180 line
-- reclaimed with INV-9 (180), the 50 line with INV-9A (50, numbered
-- otherwise). A version of before; Clear Data; the version restored.
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t10_eq(concat_ws('|',
  public.twob_import2b_reclaim(public.t_poster(), :'V', '10/2026', '7ea00000-0000-0000-0000-0000000004e2', '7ea00000-0000-0000-0000-0000000004d1', 'MATCHED') ->> 'ok',
  public.twob_import2b_reclaim(public.t_poster(), :'V', '10/2026', '7ea00000-0000-0000-0000-0000000004e1', '7ea00000-0000-0000-0000-0000000004d2', 'MATCHED') ->> 'ok'),
  'true|true', 'T(a): the 180 line reclaimed with INV-9, the 50 line with INV-9A (5.4 230)');
SELECT public.t10_version(:'V', true) AS vv \gset
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.t10_eq(public.twob_clear_year(public.t_superadmin(), :'V', ARRAY['10/2026']) ->> 'deleted', '2', 'T(a): Clear Data of the month');
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'V', '10/2026', :'vv'::jsonb, '[]'::jsonb) AS tv \gset
SELECT public.t10_eq(concat_ws('|', public.t10_entries(:'V'), public.t10_docs(:'V'), public.t10_itc(:'V')),
  'INV-9:50:-:-,INV-9:180:Oct 26:INV-9|INV-9=RECLAIM,INV-9A=RECLAIM|0.00|180.00',
  'T(a): restored: the 180 line back with INV-9 (the same document, its amounts), the 50 line in Awaiting reclaim, never on INV-9 (round 9: the 50 line on INV-9 of 180, the 180 line awaiting, 5.4 50)');
SELECT public.t10_eq(public.t10_said(:'tv'::jsonb, 'reclaims_back'),
  'INV-9: its 2B document cannot be found: this version does not name it, and VICTOR INV-9, the one 2B document of this month with its GSTIN or supplier, number and date, has other amounts (more than Rs. 2 apart on a head), so the reclaim was not made with it; reclaim it again on Import 2B',
  'T(a): ... the 50 line named, with why');
SELECT public.t10_eq(public.t10_said(:'tv'::jsonb, 'docs_left'), 'INV-9A: is Reclaim and evidences no reclaim, so its ITC counts nowhere',
  'T(a): ... INV-9A named, left Reclaim evidencing nothing (round 9: not named)');
-- ... and the 50 line reclaimed with INV-9A again from Pending items.
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t10_eq(public.twob_import2b_reclaim(public.t_poster(), :'V', '10/2026',
    (SELECT t.id FROM public.bills_not_in_2b t WHERE t.client_id = :'V' AND t.input_cgst = 50), '7ea00000-0000-0000-0000-0000000004d2', 'RECLAIM') ->> 'ok',
  'true', 'T(a): ... the 50 line reclaimed with INV-9A again from Pending items');
SELECT public.t10_eq(public.t10_itc(:'V'), '0.00|230.00', 'T(a): ... 5.4 230, as before Clear Data');
-- (b) WHISKY W-5 in the books as two lines of 180, reclaimed with W-5 and
-- W-5B (both 180). A version of before; Clear Data; the version restored:
-- both are the same document as W-5, nothing tells which was reclaimed with
-- it, so neither is linked to it.
SELECT public.t10_eq(concat_ws('|',
  public.twob_import2b_reclaim(public.t_poster(), :'W', '10/2026', '7ea00000-0000-0000-0000-0000000005e1', '7ea00000-0000-0000-0000-0000000005d1', 'MATCHED') ->> 'ok',
  public.twob_import2b_reclaim(public.t_poster(), :'W', '10/2026', '7ea00000-0000-0000-0000-0000000005e2', '7ea00000-0000-0000-0000-0000000005d2', 'MATCHED') ->> 'ok'),
  'true|true', 'T(b): two lines of W-5, of 180 each, reclaimed with W-5 and W-5B');
SELECT public.t10_version(:'W', true) AS vw \gset
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.t10_eq(public.twob_clear_year(public.t_superadmin(), :'W', ARRAY['10/2026']) ->> 'deleted', '2', 'T(b): Clear Data of the month');
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'W', '10/2026', :'vw'::jsonb, '[]'::jsonb) AS tw \gset
SELECT public.t10_eq(concat_ws('|', public.t10_entries(:'W'), public.t10_itc(:'W')), 'W-5:180:-:-,W-5:180:-:-|0.00|0.00',
  'T(b): restored: both in Awaiting reclaim (round 9: the first by the version''s order took W-5)');
SELECT public.t10_eq(concat_ws(' || ', public.t10_said(:'tw'::jsonb, 'reclaims_back'), public.t10_said(:'tw'::jsonb, 'docs_left')),
  'W-5: its 2B document cannot be told: this version does not name it, and 2 of its reclaims are the same document as WHISKY W-5, the one 2B document of this month with their GSTIN or supplier, number and date; reclaim it again on Import 2B'
  || ' / W-5: its 2B document cannot be told: this version does not name it, and 2 of its reclaims are the same document as WHISKY W-5, the one 2B document of this month with their GSTIN or supplier, number and date; reclaim it again on Import 2B'
  || ' || W-5: is Reclaim and evidences no reclaim, so its ITC counts nowhere / W-5B: is Reclaim and evidences no reclaim, so its ITC counts nowhere',
  'T(b): ... each named, "cannot be told", and both documents named');

-- ---------------------------------------------------------------------------
-- R. The version's own naming first; the reason by where it is known from.
-- ---------------------------------------------------------------------------
-- (a) Liberal client. A version (this release) holding R-B (a typed reclaim,
-- no document, first) and R-A (reclaimed with RENT/2026/10). Then RENT out
-- of Reclaim (R-A awaiting), R-B's typed reclaim cleared and R-B reclaimed
-- with RENT; the version restored: R-A takes RENT back, as the version
-- names it; R-B, whose entry names it now, comes back in Awaiting reclaim.
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t10_eq(public.twob_import2b_reclaim(public.t_poster(), :'K', '10/2026', '7ea00000-0000-0000-0000-0000000006e2',
  '7ea00000-0000-0000-0000-0000000006d1', 'MATCHED') ->> 'ok', 'true', 'R(a): R-A reclaimed with RENT/2026/10');
SELECT public.t10_version(:'K', false) AS vk \gset
SELECT public.t10_eq(public.twob_import2b_unreclaim(public.t_poster(), :'K', '10/2026', '7ea00000-0000-0000-0000-0000000006d1', 'MATCHED',
  '7ea00000-0000-0000-0000-0000000006e2') ->> 'ok', 'true', 'R(a): ... RENT/2026/10 out of Reclaim');
RESET ROLE;
SELECT set_config('twob.write', 'system', false);
UPDATE public.bills_not_in_2b SET reclaim_month = NULL WHERE id = '7ea00000-0000-0000-0000-0000000006e1';
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT public.t10_eq(public.twob_import2b_reclaim(public.t_poster(), :'K', '10/2026', '7ea00000-0000-0000-0000-0000000006e1',
  '7ea00000-0000-0000-0000-0000000006d1', 'MATCHED') ->> 'ok', 'true', 'R(a): ... R-B''s typed reclaim cleared, R-B reclaimed with RENT/2026/10');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'K', '10/2026', :'vk'::jsonb, '[]'::jsonb) AS rk \gset
SELECT public.t10_eq(concat_ws('|', public.t10_entries(:'K'), public.t10_itc(:'K'), public.t10_said(:'rk'::jsonb, 'reclaims_back')),
  'R-B:4500:-:-,R-A:4500:Oct 26:RENT/2026/10|0.00|4500.00|R-B: its 2B document evidences the reclaim of LANDLORD R-A in this version (one document, one reclaim)',
  'R(a): restored: R-A with RENT/2026/10 as the version names it, R-B back in Awaiting reclaim, rightly named (round 9: R-B kept RENT by the version''s order, R-A named as losing it to R-B, falsely)');
-- (b) A version of before holding NV-11 (the same document as NOVA NV-11,
-- first) and N-BOOKS, both reclaimed; the month's entry N-BOOKS names NV-11
-- now. N-BOOKS keeps it (the month's entry of that id names it, before a
-- document found as the same document); NV-11 back, named, "now".
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t10_eq(public.twob_import2b_reclaim(public.t_poster(), :'N', '10/2026', '7ea00000-0000-0000-0000-0000000007e2',
  '7ea00000-0000-0000-0000-0000000007d1', 'MATCHED') ->> 'ok', 'true', 'R(b): N-BOOKS reclaimed with NOVA NV-11');
SELECT jsonb_agg(CASE WHEN x ->> 'supplier_invoice_number' = 'NV-11' THEN x || '{"reclaim_month":"Oct 26"}'::jsonb ELSE x END
                 ORDER BY x ->> 'supplier_invoice_number' = 'NV-11' DESC) AS vn
  FROM jsonb_array_elements(public.t10_version(:'N', true)) x \gset
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'N', '10/2026', :'vn'::jsonb, '[]'::jsonb) AS rn \gset
SELECT public.t10_eq(concat_ws('|', public.t10_entries(:'N'), public.t10_itc(:'N'), public.t10_said(:'rn'::jsonb, 'reclaims_back'), public.t10_said(:'rn'::jsonb, 'docs_left')),
  'N-BOOKS:270:Oct 26:NV-11,NV-11:270:-:-|0.00|270.00|NV-11: its 2B document cannot be told: this version does not name it, and NOVA NV-11, the one 2B document of this month with its GSTIN or supplier, number and date, evidences the reclaim of NOVA N-BOOKS now; reclaim it again on Import 2B|-',
  'R(b): restored: N-BOOKS keeps NV-11, NV-11 in Awaiting reclaim, named with where the other''s document is known from ("now"); 5.4 270 once');

RESET ROLE;
SELECT set_config('twob.write', 'system', false);
DELETE FROM public.clients WHERE id IN (:'X', :'Y', :'Z', :'V', :'W', :'K', :'N');
SELECT set_config('twob.write', '', false);

DO $$
DECLARE
  v text;
  v_ok integer;
  v_all integer;
BEGIN
  SELECT count(*) FILTER (WHERE r.ok), count(*) INTO v_ok, v_all FROM public.t10_results r;
  SELECT string_agg(format('FAILED %s: %s', r.label, r.info), E'\n' ORDER BY r.n) INTO v FROM public.t10_results r WHERE NOT r.ok;
  RAISE NOTICE 'checks: round10 (SQL) % of % passed', v_ok, v_all;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION E'round10 (SQL): % of % checks passed\n%', v_ok, v_all, v;
  END IF;
END $$;
DROP TABLE public.t10_results;
DROP FUNCTION public.t10_eq(anyelement, anyelement, text), public.t10_itc(uuid), public.t10_entries(uuid), public.t10_docs(uuid),
  public.t10_said(jsonb, text), public.t10_version(uuid, boolean);
