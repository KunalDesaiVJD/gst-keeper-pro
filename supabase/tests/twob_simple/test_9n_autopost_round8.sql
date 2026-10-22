-- Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md
-- §15): the eighth verification round's findings, as PostgREST runs the
-- app's calls (anon, with the request headers; a4 holds Import 2B & post, a2
-- is a GST Manager, a1 the superadmin):
--   H  Restore of a version that holds a Strict client's reclaim without
--      naming its 2B document, when the entry is not the same document as
--      the 2B one by twob_doc_ident (Import 2B's Link & Reclaim pairs them by
--      their amounts alone): a books entry without the supplier's GSTIN, one
--      numbered as the books wrote it, or a document gone with Delete 2B and
--      imported again. Each comes back in Awaiting reclaim, named ("reclaim
--      it again on Import 2B"): since round 9 a document is never looked for
--      by its amounts (round 8's lookup moved reclaims between entries:
--      test_9o), and a reclaim comes back reclaimed only with its document
--      known exactly. Only a Liberal client's reclaim in a month holding no
--      2B document comes back as typed. Before (round 7): each came back
--      reclaimed with no document beside the document's count in 5.1 (5.1
--      140 and 5.4 140), nothing said, the documents free to move after.
--   L2 A document two entries name, recorded before the one-reclaim rule
--      (GROWQ's July REDEL 25 on live), taken out of Reclaim on Import 2B
--      in an open month: the page shows one of the two and sends it; the
--      Save goes through and releases both. Before: every Save was refused
--      as "changed elsewhere", naming the reclaim the page showed.
-- (A books row or 2B document deleted while a Restore runs:
-- test_9m_restore_lock_order.sh.)
-- Each check is recorded (t8_results) and the file fails, naming every
-- failed check, at the end: run against the code of before this round, each
-- check fails or passes on its own. Fictional.
\set G '7e100000-0000-0000-0000-0000000000c1'
\set J '7e100000-0000-0000-0000-0000000000c2'
\set D '7e100000-0000-0000-0000-0000000000c3'
\set L '7e100000-0000-0000-0000-0000000000c4'
\set S '7e100000-0000-0000-0000-0000000000c5'
\set P '7e100000-0000-0000-0000-0000000000c6'

CREATE TABLE public.t8_results (n serial PRIMARY KEY, label text NOT NULL, ok boolean NOT NULL, info text);
GRANT ALL ON public.t8_results TO anon;
GRANT USAGE ON SEQUENCE public.t8_results_n_seq TO anon;
CREATE FUNCTION public.t8_eq(p_actual anyelement, p_expected anyelement, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.t8_results (label, ok, info)
  VALUES (p_label, p_actual IS NOT DISTINCT FROM p_expected, format('expected [%s], got [%s]', p_expected, p_actual));
END $$;
CREATE FUNCTION public.t8_raises(p_sql text, p_like text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.t8_results (label, ok, info)
    VALUES (p_label, position(p_like in SQLERRM) > 0, format('raised [%s], expected it to mention [%s]', SQLERRM, p_like));
    RETURN;
  END;
  INSERT INTO public.t8_results (label, ok, info) VALUES (p_label, false, 'did not raise');
END $$;
-- What ITC Summary reads for a client's month: 5.1 CGST (Matched and
-- Mismatched documents) and 5.4 CGST (entries reclaimed in it).
CREATE FUNCTION public.t8_itc(p_client uuid, p_label text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT concat_ws('|',
    COALESCE((SELECT sum(d.input_cgst) FROM public.twob_import_docs d
               WHERE d.client_id = p_client AND public.twob_period_label(d.period_month) = p_label
                 AND d.itc_action IN ('MATCHED', 'MISMATCHED')), 0)::numeric(12,2),
    COALESCE((SELECT sum(t.input_cgst) FROM public.bills_not_in_2b t
               WHERE t.client_id = p_client AND t.reclaim_month = p_label AND t.reclaim_subtype IS NULL), 0)::numeric(12,2));
$$;
-- A month's own Not in 2B entries as a version written before this release
-- holds them (2B Reconciliation's Save of before, Post's toVersionRow2B): no
-- document named, no Import 2B link.
CREATE FUNCTION public.t8_old_version(p_client uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg((to_jsonb(t) - 'adopted_from' - 'source_book_id' - 'reclaimed_via_doc_id') ORDER BY t.id), '[]'::jsonb)
    FROM public.bills_not_in_2b t WHERE t.client_id = p_client AND t.period_month = '10/2026' AND NOT t.is_carried_forward;
$$;
-- The client's entries: number:reclaim month:reclaiming document named.
CREATE FUNCTION public.t8_entries(p_client uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT string_agg(concat_ws(':', t.supplier_invoice_number, COALESCE(t.reclaim_month, '-'), t.reclaimed_via_doc_id IS NOT NULL), ',' ORDER BY t.id)
    FROM public.bills_not_in_2b t WHERE t.client_id = p_client;
$$;
GRANT EXECUTE ON FUNCTION public.t8_eq(anyelement, anyelement, text), public.t8_raises(text, text, text), public.t8_itc(uuid, text),
  public.t8_old_version(uuid), public.t8_entries(uuid) TO anon;

SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES
  (:'G', 'R8 STRICT NOT THE SAME DOCUMENT', '24REIGA0000A1Z5', false),
  (:'J', 'R8 STRICT LINKED BY AMOUNTS', '24REIGJ0000A1Z5', false),
  (:'D', 'R8 STRICT DELETE 2B', '24REIGD0000A1Z5', false),
  (:'L', 'R8 LIBERAL TYPED', '24REIGL0000A1Z5', true),
  (:'S', 'R8 STRICT TYPED', '24REIGS0000A1Z5', false),
  (:'P', 'R8 PAIR OF BEFORE', '24REIGP0000A1Z5', false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action) VALUES
  -- G: bank charges (the books entry has no GSTIN) and an invoice the books
  -- numbered otherwise (G-42/26-27 for G/2026/0042): Matched.
  ('7e100000-0000-0000-0000-0000000001d1', :'G', '10/2026', '2026-09-20', 'BANK OF INDIA', 'BC-77', '24BOIBK0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  ('7e100000-0000-0000-0000-0000000001d2', :'G', '10/2026', '2026-09-21', 'GAMMA', 'G/2026/0042', '24GAMMA0000A1Z5', 2000, 0, 50, 50, 'INVOICE', 'MATCHED'),
  -- J: JL/77, its books entry numbered JL-0077-A; another document of the
  -- same amounts by another supplier, Matched.
  ('7e100000-0000-0000-0000-0000000002d1', :'J', '10/2026', '2026-09-22', 'JULIET', 'JL/77', '24JULIE0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  ('7e100000-0000-0000-0000-0000000002d2', :'J', '10/2026', '2026-09-23', 'KILO', 'K-5', '24KILOO0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  -- D: A-1, Matched.
  ('7e100000-0000-0000-0000-0000000003d1', :'D', '10/2026', '2026-09-20', 'ALPHA', 'A-1', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  -- L: a Matched document of the same amounts as L-1's typed reclaim, another supplier.
  ('7e100000-0000-0000-0000-0000000004d1', :'L', '10/2026', '2026-09-24', 'MIKE', 'M-1', '24MIKEE0000A1Z5', 1000, 0, 60, 60, 'INVOICE', 'MATCHED'),
  -- P: REDEL 25, Reclaim, named by two entries (below).
  ('7e100000-0000-0000-0000-0000000006d1', :'P', '10/2026', '2026-09-20', 'REDEL', '25', '24REDEL0000A1Z5', 15000, 0, 1350, 1350, 'INVOICE', 'RECLAIM');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('7e100000-0000-0000-0000-0000000001e1', :'G', '10/2026', '2026-09-20', 'BOI BANK CHARGES', 'BC-77', NULL, 1000, 0, 90, 90, 'Oct 26', false),
  ('7e100000-0000-0000-0000-0000000001e2', :'G', '10/2026', '2026-09-21', 'GAMMA', 'G-42/26-27', '24GAMMA0000A1Z5', 2000, 0, 50, 50, 'Oct 26', false),
  ('7e100000-0000-0000-0000-0000000002e1', :'J', '10/2026', '2026-09-22', 'JULIET', 'JL-0077-A', '24JULIE0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false),
  ('7e100000-0000-0000-0000-0000000003e1', :'D', '10/2026', '2026-09-20', 'ALPHA', 'A-1', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false);
SELECT set_config('twob.write', '', false);

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);

-- ---------------------------------------------------------------------------
-- H. A Strict client's reclaim restored from a version that names no document.
-- ---------------------------------------------------------------------------
-- (a, b) The books entry without GSTIN (BC-77) and the one numbered as the
-- books wrote it (G-42/26-27), each reclaimed on Import 2B with its document
-- (Link & Reclaim, matched on the amounts); a version of before; both
-- documents taken out of Reclaim (Matched); the superadmin restores the
-- version.
SELECT public.t8_eq(concat_ws('|',
  public.twob_import2b_reclaim(public.t_poster(), :'G', '10/2026', '7e100000-0000-0000-0000-0000000001e1', '7e100000-0000-0000-0000-0000000001d1', 'MATCHED') ->> 'ok',
  public.twob_import2b_reclaim(public.t_poster(), :'G', '10/2026', '7e100000-0000-0000-0000-0000000001e2', '7e100000-0000-0000-0000-0000000001d2', 'MATCHED') ->> 'ok'),
  'true|true', 'H: BC-77 (no GSTIN) and G-42/26-27 reclaimed with their documents');
SELECT public.t8_old_version(:'G') AS vg \gset
SELECT public.t8_eq(concat_ws('|',
  public.twob_import2b_unreclaim(public.t_poster(), :'G', '10/2026', '7e100000-0000-0000-0000-0000000001d1', 'MATCHED', '7e100000-0000-0000-0000-0000000001e1') ->> 'ok',
  public.twob_import2b_unreclaim(public.t_poster(), :'G', '10/2026', '7e100000-0000-0000-0000-0000000001d2', 'MATCHED', '7e100000-0000-0000-0000-0000000001e2') ->> 'ok'),
  'true|true', 'H: ... then both documents taken out of Reclaim (Matched)');
SELECT public.t8_eq(public.t8_itc(:'G', 'Oct 26'), '140.00|0.00', 'H: ... 5.1 140, 5.4 none');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'G', '10/2026', :'vg'::jsonb, '[]'::jsonb) AS hg \gset
SELECT public.t8_eq(public.t8_entries(:'G'), 'BC-77:-:f,G-42/26-27:-:f',
  'H(a, b): the version restored: both back in Awaiting reclaim, their documents being Matched now (before: both reclaimed, no document)');
SELECT public.t8_eq(public.t8_itc(:'G', 'Oct 26'), '140.00|0.00',
  'H(a, b): ... each document''s ITC counted once (before: 5.1 140 and 5.4 140)');
SELECT public.t8_eq((SELECT string_agg(x ->> 'supplier_invoice_number' || ': ' || (x ->> 'message'), ' / ' ORDER BY x ->> 'supplier_invoice_number')
                       FROM jsonb_array_elements(:'hg'::jsonb -> 'reclaims_back') x),
  'BC-77: its 2B document cannot be found: this version does not name it, and no 2B document of this month has its GSTIN or supplier, number and date; reclaim it again on Import 2B'
  || ' / G-42/26-27: its 2B document cannot be found: this version does not name it, and no 2B document of this month has its GSTIN or supplier, number and date; reclaim it again on Import 2B',
  'H(a, b): ... and the Restore names each, with why (before: nothing said; round 8: found by its amounts)');

-- (c) JL-0077-A reclaimed with JL/77; a version of before; the entries taken
-- away by a Restore of a version without them (JL/77 stays Reclaim,
-- evidencing nothing); the version of before restored: JL-0077-A is not the
-- same document as JL/77, and KILO K-5 has the same amounts, so nothing
-- tells which document it was reclaimed with: back in Awaiting reclaim,
-- named (round 8 linked it to JL/77 by its amounts; round 9 never guesses),
-- and reclaimed again on Import 2B as the message says.
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t8_eq(public.twob_import2b_reclaim(public.t_poster(), :'J', '10/2026', '7e100000-0000-0000-0000-0000000002e1',
  '7e100000-0000-0000-0000-0000000002d1', 'MATCHED') ->> 'ok', 'true', 'H(c): JL-0077-A reclaimed with JL/77');
SELECT public.t8_old_version(:'J') AS vj \gset
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT (public.twob_restore_version_linked(public.t_superadmin(), :'J', '10/2026', '[]'::jsonb, '[]'::jsonb) ->> 'bills_not_in_2b') AS j0 \gset
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'J', '10/2026', :'vj'::jsonb, '[]'::jsonb) AS hj \gset
SELECT public.t8_eq(concat_ws('|', public.t8_entries(:'J'),
                              position('reclaim it again on Import 2B' in COALESCE(:'hj'::jsonb -> 'reclaims_back' -> 0 ->> 'message', '')) > 0,
                              public.t8_itc(:'J', 'Oct 26')),
  'JL-0077-A:-:f|t|90.00|0.00',
  'H(c): restored, JL-0077-A back in Awaiting reclaim, named, no document guessed (before: reclaimed, no document named; round 8: linked by its amounts)');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t8_eq(concat_ws('|',
  public.twob_import2b_unreclaim(public.t_poster(), :'J', '10/2026', '7e100000-0000-0000-0000-0000000002d1', 'MATCHED', NULL) ->> 'ok',
  public.twob_import2b_reclaim(public.t_poster(), :'J', '10/2026', '7e100000-0000-0000-0000-0000000002e1', '7e100000-0000-0000-0000-0000000002d1', 'MATCHED') ->> 'ok'),
  'true|true', 'H(c): ... reclaimed again on Import 2B (JL/77 out of Reclaim, then Link & Reclaim)');
SELECT public.t8_eq(concat_ws('|', public.t8_entries(:'J'), public.t8_itc(:'J', 'Oct 26')), 'JL-0077-A:Oct 26:t|90.00|90.00',
  'H(c): ... linked, 5.4 90 once');
SELECT public.t8_raises($q$UPDATE public.twob_import_docs SET itc_action = 'MISMATCHED' WHERE id = '7e100000-0000-0000-0000-0000000002d1'$q$,
  'so it stays Reclaim', 'H(c): ... and JL/77 held Reclaim again');

-- (d) A-1 reclaimed; a version of before; Delete 2B (the reclaim released,
-- the documents gone); the superadmin restores the version; the 2B file
-- imported again (A-1 comes back Matched).
SELECT public.t8_eq(public.twob_import2b_reclaim(public.t_poster(), :'D', '10/2026', '7e100000-0000-0000-0000-0000000003e1',
  '7e100000-0000-0000-0000-0000000003d1', 'MATCHED') ->> 'ok', 'true', 'H(d): A-1 reclaimed with its document');
SELECT public.t8_old_version(:'D') AS vd \gset
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a2","x-gst-source":"app"}', false);
SELECT public.t8_eq(public.twob_import2b_delete_2b(public.t_manager(), :'D', '10/2026') ->> 'reclaims_released', '1',
  'H(d): Delete 2B releases the reclaim');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'D', '10/2026', :'vd'::jsonb, '[]'::jsonb) AS hd \gset
SELECT public.t8_eq(concat_ws('|', public.t8_entries(:'D'),
                              position('this month holds no 2B document; reclaim it again on Import 2B' in COALESCE(:'hd'::jsonb -> 'reclaims_back' -> 0 ->> 'message', '')) > 0),
  'A-1:-:f|t', 'H(d): the version restored with no document in the month: A-1 back in Awaiting reclaim, named (before: reclaimed, no document, nothing said)');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
INSERT INTO public.twob_import_docs (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action)
VALUES (:'D', '10/2026', '2026-09-20', 'ALPHA', 'A-1', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED');
SELECT public.t8_eq(public.t8_itc(:'D', 'Oct 26'), '90.00|0.00',
  'H(d): ... the 2B file imported again: A-1''s ITC counted once (before: 5.1 90 and 5.4 90)');

-- (e) A Liberal client's reclaim typed on 2B Reconciliation, the month
-- holding a 2B document (MIKE M-1, Matched, of the same amounts): its
-- document is not known exactly, so it comes back in Awaiting reclaim,
-- named, as a Strict client's (round 9: round 8 brought it back as typed,
-- and a Liberal client's Import 2B reclaim, paired by its amounts, so
-- counted twice: test_9o). With no 2B document in the month it comes back
-- as typed (test_9l (e)). A Strict client's reclaim with no document of it
-- anywhere: back in Awaiting reclaim, named.
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'L', '10/2026',
  '[{"id":"7e100000-0000-0000-0000-0000000004e1","date":"2026-09-24","supplier_name":"LIMA","supplier_invoice_number":"L-1","supplier_gstin":"24LIMAA0000A1Z5","taxable_value":1000,"input_igst":0,"input_cgst":60,"input_sgst":60,"reversal_month":"Sep 26","reclaim_month":"Oct 26","is_carried_forward":false}]'::jsonb,
  '[]'::jsonb) AS hl \gset
SELECT public.t8_eq(concat_ws('|', public.t8_entries(:'L'),
                              position('reclaim it again on Import 2B' in COALESCE(:'hl'::jsonb -> 'reclaims_back' -> 0 ->> 'message', '')) > 0),
  'L-1:-:f|t', 'H(e): a Liberal client''s reclaim whose document is not known, the month holding a 2B document: back in Awaiting reclaim, named (round 8: as typed)');
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'S', '10/2026',
  '[{"id":"7e100000-0000-0000-0000-0000000005e1","date":"2026-09-24","supplier_name":"SIERRA","supplier_invoice_number":"S-1","supplier_gstin":"24SIERR0000A1Z5","taxable_value":1000,"input_igst":0,"input_cgst":60,"input_sgst":60,"reversal_month":"Sep 26","reclaim_month":"Oct 26","is_carried_forward":false}]'::jsonb,
  '[]'::jsonb) AS hs \gset
SELECT public.t8_eq(concat_ws('|', public.t8_entries(:'S'),
                              position('reclaim it again on Import 2B' in COALESCE(:'hs'::jsonb -> 'reclaims_back' -> 0 ->> 'message', '')) > 0),
  'S-1:-:f|t', 'H(e): a Strict client''s reclaim with no document back in Awaiting reclaim, named (before: as typed)');

-- ---------------------------------------------------------------------------
-- L2. A document two entries name, recorded before the rule, out of Reclaim.
-- ---------------------------------------------------------------------------
RESET ROLE;
DROP INDEX IF EXISTS public.bills_not_in_2b_reclaimed_via_uq;
CREATE INDEX IF NOT EXISTS idx_bills_not_in_2b_reclaimed_via_doc_id
  ON public.bills_not_in_2b (reclaimed_via_doc_id) WHERE reclaimed_via_doc_id IS NOT NULL;
SELECT set_config('twob.write', 'system', false);
ALTER TABLE public.bills_not_in_2b DISABLE TRIGGER USER;
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month, reclaimed_via_doc_id, is_carried_forward) VALUES
  ('7e100000-0000-0000-0000-0000000006e1', :'P', '10/2026', '2026-05-01', 'REDEL', '5', '24REDEL0000A1Z5', 15000, 0, 1350, 1350, 'May 26', 'Oct 26',
   '7e100000-0000-0000-0000-0000000006d1', true),
  ('7e100000-0000-0000-0000-0000000006e2', :'P', '10/2026', '2026-09-20', 'REDEL', '25', '24REDEL0000A1Z5', 15000, 0, 1350, 1350, 'Oct 26', 'Oct 26',
   '7e100000-0000-0000-0000-0000000006d1', false);
ALTER TABLE public.bills_not_in_2b ENABLE TRIGGER USER;
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a2","x-gst-source":"app"}', false);
-- An entry that does not name the document is still refused.
SELECT public.t8_eq(public.twob_import2b_unreclaim(public.t_manager(), :'P', '10/2026', '7e100000-0000-0000-0000-0000000006d1', 'MATCHED',
  '7e100000-0000-0000-0000-0000000001e1') ->> 'ok', 'false', 'L2: a Save showing an entry that does not name the document is refused');
-- The page shows REDEL 25 the evidence of the first entry by id and sends it.
SELECT public.twob_import2b_unreclaim(public.t_manager(), :'P', '10/2026', '7e100000-0000-0000-0000-0000000006d1', 'MATCHED',
  '7e100000-0000-0000-0000-0000000006e1') AS l2 \gset
SELECT public.t8_eq(concat_ws('|', :'l2'::jsonb ->> 'ok', :'l2'::jsonb ->> 'released'), 'true|2',
  'L2: the pair''s document out of Reclaim with the reclaim the page shows (one of the two): both released (before: refused, changed elsewhere)');
SELECT public.t8_eq(concat_ws('|', public.t8_entries(:'P'), (SELECT itc_action FROM public.twob_import_docs WHERE id = '7e100000-0000-0000-0000-0000000006d1'),
                              public.t8_itc(:'P', 'Oct 26')),
  '5:-:f,25:-:f|MATCHED|1350.00|0.00', 'L2: ... both awaiting, the document Matched, its ITC counted once');

RESET ROLE;
DELETE FROM public.clients WHERE id IN (:'G', :'J', :'D', :'L', :'S', :'P');
CREATE UNIQUE INDEX IF NOT EXISTS bills_not_in_2b_reclaimed_via_uq
  ON public.bills_not_in_2b (reclaimed_via_doc_id) WHERE reclaimed_via_doc_id IS NOT NULL;
DROP INDEX IF EXISTS public.idx_bills_not_in_2b_reclaimed_via_doc_id;

DO $$
DECLARE
  v text;
  v_ok integer;
  v_all integer;
BEGIN
  SELECT count(*) FILTER (WHERE r.ok), count(*) INTO v_ok, v_all FROM public.t8_results r;
  SELECT string_agg(format('FAILED %s: %s', r.label, r.info), E'\n' ORDER BY r.n) INTO v FROM public.t8_results r WHERE NOT r.ok;
  RAISE NOTICE 'checks: round8 (SQL) % of % passed', v_ok, v_all;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION E'round8 (SQL): % of % checks passed\n%', v_ok, v_all, v;
  END IF;
END $$;
DROP TABLE public.t8_results;
DROP FUNCTION public.t8_eq(anyelement, anyelement, text), public.t8_raises(text, text, text), public.t8_itc(uuid, text),
  public.t8_old_version(uuid), public.t8_entries(uuid);
