-- Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md
-- §15): the seventh verification round's findings, as PostgREST runs the
-- app's calls (anon, with the request headers; a4 holds Import 2B & post, a2
-- is a GST Manager, a1 the superadmin):
--   F1 Restore of a version that holds a reclaim without naming its 2B
--      document (every version written before this release: Post's, a 2B
--      Reconciliation Save's, their RESTORE copies; and the app of before's
--      during the change-over), its entry of that id gone or naming none: the
--      reclaim is linked to the month's original invoice or debit note of the
--      same document (twob_doc_ident) while that document is Reclaim and
--      evidences no other reclaim; otherwise the entry comes back in Awaiting
--      reclaim, named with why (reclaims_back). Only a reclaim with no such
--      document in the month (typed for a Liberal client) comes back as
--      typed. Before: it came back reclaimed with no document beside the
--      document's own count in 5.1 (5.1 90 and 5.4 90), said nothing, and
--      the document, evidencing nothing, could move freely after.
--   F2 A document taken out of Reclaim (twob_import2b_unreclaim) only while
--      the reclaim it evidences is the one the page showed (p_expect_entry,
--      or none): a stale tab's Save no longer undoes a reclaim another user
--      recorded since with the same document (out of Reclaim and reclaimed
--      again in between). Before: it released the new reclaim without a word.
-- (Restore against a document leaving Reclaim at the same moment, two
-- sessions: test_9m_restore_lock_order.sh.)
-- Each check is recorded (t7_results) and the file fails, naming every
-- failed check, at the end: run against the code of before this round, each
-- check fails or passes on its own (the out-of-Reclaim call is made as that
-- code's page made it, without the reclaim it showed). Fictional.
\set A '7e000000-0000-0000-0000-0000000000c1'
\set B '7e000000-0000-0000-0000-0000000000c2'
\set K '7e000000-0000-0000-0000-0000000000c3'
\set L '7e000000-0000-0000-0000-0000000000c4'
\set F '7e000000-0000-0000-0000-0000000000c5'

CREATE TABLE public.t7_results (n serial PRIMARY KEY, label text NOT NULL, ok boolean NOT NULL, info text);
GRANT ALL ON public.t7_results TO anon;
GRANT USAGE ON SEQUENCE public.t7_results_n_seq TO anon;
CREATE FUNCTION public.t7_eq(p_actual anyelement, p_expected anyelement, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.t7_results (label, ok, info)
  VALUES (p_label, p_actual IS NOT DISTINCT FROM p_expected, format('expected [%s], got [%s]', p_expected, p_actual));
END $$;
CREATE FUNCTION public.t7_raises(p_sql text, p_like text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.t7_results (label, ok, info)
    VALUES (p_label, position(p_like in SQLERRM) > 0, format('raised [%s], expected it to mention [%s]', SQLERRM, p_like));
    RETURN;
  END;
  INSERT INTO public.t7_results (label, ok, info) VALUES (p_label, false, 'did not raise');
END $$;
-- What ITC Summary reads for a client's month: 5.1 CGST (Matched and
-- Mismatched documents) and 5.4 CGST (entries reclaimed in it).
CREATE FUNCTION public.t7_itc(p_client uuid, p_label text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT concat_ws('|',
    COALESCE((SELECT sum(d.input_cgst) FROM public.twob_import_docs d
               WHERE d.client_id = p_client AND public.twob_period_label(d.period_month) = p_label
                 AND d.itc_action IN ('MATCHED', 'MISMATCHED')), 0)::numeric(12,2),
    COALESCE((SELECT sum(t.input_cgst) FROM public.bills_not_in_2b t
               WHERE t.client_id = p_client AND t.reclaim_month = p_label AND t.reclaim_subtype IS NULL), 0)::numeric(12,2));
$$;
-- Import 2B's Save of a document out of Reclaim, as the page sends it: with
-- the reclaim it shows the document evidencing (this round), or, on the code
-- of before, as that page sent it (without).
CREATE FUNCTION public.t7_unreclaim(p_actor uuid, p_client uuid, p_doc uuid, p_action text, p_expect uuid) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
BEGIN
  IF to_regprocedure('public.twob_import2b_unreclaim(uuid, uuid, text, uuid, text, uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT public.twob_import2b_unreclaim($1, $2, ''10/2026'', $3, $4, $5)' INTO v USING p_actor, p_client, p_doc, p_action, p_expect;
  ELSE
    EXECUTE 'SELECT public.twob_import2b_unreclaim($1, $2, ''10/2026'', $3, $4)' INTO v USING p_actor, p_client, p_doc, p_action;
  END IF;
  RETURN v;
END $$;
-- A month's own Not in 2B entries as a version written before this release
-- holds them (2B Reconciliation's Save of before, Post's toVersionRow2B):
-- no document named, no Import 2B link.
CREATE FUNCTION public.t7_old_version(p_client uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg((to_jsonb(t) - 'adopted_from' - 'source_book_id' - 'reclaimed_via_doc_id') ORDER BY t.id), '[]'::jsonb)
    FROM public.bills_not_in_2b t WHERE t.client_id = p_client AND t.period_month = '10/2026' AND NOT t.is_carried_forward;
$$;
GRANT EXECUTE ON FUNCTION public.t7_eq(anyelement, anyelement, text), public.t7_raises(text, text, text), public.t7_itc(uuid, text),
  public.t7_unreclaim(uuid, uuid, uuid, text, uuid), public.t7_old_version(uuid) TO anon;

SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES
  (:'A', 'R7 OLD VERSION MATCHED', '24RSEVA0000A1Z5'), (:'B', 'R7 OLD VERSION RELINK', '24RSEVB0000A1Z5'),
  (:'K', 'R7 OLD VERSION KEPT', '24RSEVK0000A1Z5'), (:'L', 'R7 LIBERAL TYPED', '24RSEVL0000A1Z5'),
  (:'F', 'R7 STALE OUT OF RECLAIM', '24RSEVF0000A1Z5');
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action) VALUES
  -- A: A-1 Matched, its pending entry A-1 (the verifier's case).
  ('7e000000-0000-0000-0000-0000000001d1', :'A', '10/2026', '2026-09-20', 'ALPHA', 'A-1', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  -- B: B-1 Matched (reclaimed below), and debit note B-2, its number
  -- written otherwise on the books (b/2), reclaimed below too.
  ('7e000000-0000-0000-0000-0000000002d1', :'B', '10/2026', '2026-09-21', 'BRAVO', 'B-1', '24BRAVO0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  ('7e000000-0000-0000-0000-0000000002d2', :'B', '10/2026', '2026-09-22', 'BRAVO', 'B-2', '24BRAVO0000A1Z5', 1000, 0, 40, 40, 'DEBIT_NOTE', 'MATCHED'),
  -- K: K-1 Reclaim, the evidence of the reclaim of K-0 (a carried entry the
  -- month keeps); an own entry K-1 of the same document reclaimed in a
  -- version of before.
  ('7e000000-0000-0000-0000-0000000003d1', :'K', '10/2026', '2026-09-23', 'KILO', 'K-1', '24KILOO0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'RECLAIM'),
  -- F: D-1 Matched; E1 (Sep's carried copy) and E2 (Oct's own entry), both
  -- awaiting a reclaim, both of which D-1 could evidence.
  ('7e000000-0000-0000-0000-0000000005d1', :'F', '10/2026', '2026-10-01', 'FOXTROT', 'D-1', '24FOXTR0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month, reclaimed_via_doc_id, is_carried_forward) VALUES
  ('7e000000-0000-0000-0000-0000000001e1', :'A', '10/2026', '2026-09-20', 'ALPHA', 'A-1', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'Oct 26', NULL, NULL, false),
  ('7e000000-0000-0000-0000-0000000002e1', :'B', '10/2026', '2026-09-21', 'BRAVO', 'B-1', '24BRAVO0000A1Z5', 1000, 0, 90, 90, 'Oct 26', NULL, NULL, false),
  ('7e000000-0000-0000-0000-0000000002e2', :'B', '10/2026', '2026-09-22', 'BRAVO', 'b/2', '24BRAVO0000A1Z5', 1000, 0, 40, 40, 'Oct 26', NULL, NULL, false),
  ('7e000000-0000-0000-0000-0000000003e0', :'K', '10/2026', '2026-09-01', 'KILO', 'K-0', '24KILOO0000A1Z5', 1000, 0, 90, 90, 'Sep 26', 'Oct 26',
   '7e000000-0000-0000-0000-0000000003d1', true),
  ('7e000000-0000-0000-0000-0000000005e1', :'F', '10/2026', '2026-10-01', 'FOXTROT', 'D-1', '24FOXTR0000A1Z5', 1000, 0, 90, 90, 'Sep 26', NULL, NULL, true),
  ('7e000000-0000-0000-0000-0000000005e2', :'F', '10/2026', '2026-10-01', 'FOXTROT', 'D-1', '24FOXTR0000A1Z5', 1000, 0, 90, 90, 'Oct 26', NULL, NULL, false);
SELECT set_config('twob.write', '', false);

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);

-- ---------------------------------------------------------------------------
-- F1. Restore of a version that names no document for its reclaim.
-- ---------------------------------------------------------------------------
-- (a) A-1 reclaimed with its document; the month as a version of before
-- holds it (no document named); the document taken out of Reclaim (Matched);
-- the superadmin restores that version.
SELECT public.t7_eq(public.twob_import2b_reclaim(public.t_poster(), :'A', '10/2026', '7e000000-0000-0000-0000-0000000001e1',
  '7e000000-0000-0000-0000-0000000001d1', 'MATCHED') ->> 'ok', 'true', 'F1: the poster reclaims A-1 with its document');
SELECT public.t7_old_version(:'A') AS va \gset
SELECT public.t7_eq(public.t7_unreclaim(public.t_poster(), :'A', '7e000000-0000-0000-0000-0000000001d1', 'MATCHED',
  '7e000000-0000-0000-0000-0000000001e1') ->> 'ok', 'true', 'F1: ... then takes the document out of Reclaim (Matched)');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'A', '10/2026', :'va'::jsonb, '[]'::jsonb) AS f1a \gset
SELECT public.t7_eq((SELECT concat_ws('|', d.itc_action, COALESCE(t.reclaim_month, '-'), COALESCE(t.reclaimed_via_doc_id::text, '-'))
                       FROM public.twob_import_docs d, public.bills_not_in_2b t
                      WHERE d.id = '7e000000-0000-0000-0000-0000000001d1' AND t.client_id = :'A'),
  'MATCHED|-|-', 'F1: a version of before (no document named) restored: A-1 back in Awaiting reclaim, its document being Matched now');
SELECT public.t7_eq(public.t7_itc(:'A', 'Oct 26'), '90.00|0.00',
  'F1: ... the document''s ITC counted once (5.1 90, 5.4 none; before: 5.1 90 and 5.4 90)');
SELECT public.t7_eq(COALESCE(:'f1a'::jsonb -> 'reclaims_back' -> 0 ->> 'message', '-'), 'its 2B document is Matched now, not Reclaim',
  'F1: ... and the Restore names it, with why (before: nothing said)');
-- (b) B-1 and B-2 (debit note) reclaimed with their documents; a version of
-- before; Clear Data's way (a Restore of a version without them) takes the
-- entries away, the documents staying Reclaim and evidencing nothing; the
-- version of before restored: each reclaim linked again to its document,
-- found as the same document (GSTIN, number as normalised, date).
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t7_eq(concat_ws('|',
  public.twob_import2b_reclaim(public.t_poster(), :'B', '10/2026', '7e000000-0000-0000-0000-0000000002e1', '7e000000-0000-0000-0000-0000000002d1', 'MATCHED') ->> 'ok',
  public.twob_import2b_reclaim(public.t_poster(), :'B', '10/2026', '7e000000-0000-0000-0000-0000000002e2', '7e000000-0000-0000-0000-0000000002d2', 'MATCHED') ->> 'ok'),
  'true|true', 'F1: B-1 and b/2 reclaimed with their documents');
SELECT public.t7_old_version(:'B') AS vb \gset
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT (public.twob_restore_version_linked(public.t_superadmin(), :'B', '10/2026', '[]'::jsonb, '[]'::jsonb) ->> 'bills_not_in_2b') AS b0 \gset
SELECT public.t7_eq((SELECT string_agg(d.itc_action || ':' || (SELECT count(*) FROM public.bills_not_in_2b t WHERE t.reclaimed_via_doc_id = d.id), ',' ORDER BY d.id)
                       FROM public.twob_import_docs d WHERE d.client_id = :'B'),
  'RECLAIM:0,RECLAIM:0', 'F1: (the entries taken away; both documents Reclaim, evidencing nothing)');
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'B', '10/2026', :'vb'::jsonb, '[]'::jsonb) AS f1b \gset
SELECT public.t7_eq((SELECT string_agg(concat_ws(':', t.supplier_invoice_number, COALESCE(t.reclaim_month, '-'), COALESCE(t.reclaimed_via_doc_id::text, '-')), ',' ORDER BY t.id)
                       FROM public.bills_not_in_2b t WHERE t.client_id = :'B'),
  'B-1:Oct 26:7e000000-0000-0000-0000-0000000002d1,b/2:Oct 26:7e000000-0000-0000-0000-0000000002d2',
  'F1: the version of before restored: each reclaim back, linked to its Reclaim document found as the same document (before: no document)');
SELECT public.t7_eq(concat_ws('|', jsonb_array_length(:'f1b'::jsonb -> 'reclaims_back'), public.t7_itc(:'B', 'Oct 26')), '0|0.00|130.00',
  'F1: ... nothing said, and 5.4 counts each document''s ITC once (90 + 40)');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t7_raises($q$UPDATE public.twob_import_docs SET itc_action = 'MISMATCHED' WHERE id = '7e000000-0000-0000-0000-0000000002d1'$q$,
  'so it stays Reclaim', 'F1: ... so the document is held Reclaim again (before: it could be made Mismatched, its ITC in 5.1 and 5.4)');
-- (c) A version of before holding K-1 reclaimed (no document named), its
-- document the evidence of the reclaim of K-0, a carried entry the month
-- keeps: K-1 back in Awaiting reclaim, named.
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'K', '10/2026',
  '[{"id":"7e000000-0000-0000-0000-0000000003e1","date":"2026-09-23","supplier_name":"KILO","supplier_invoice_number":"K-1","supplier_gstin":"24KILOO0000A1Z5","taxable_value":1000,"input_igst":0,"input_cgst":90,"input_sgst":90,"reversal_month":"Oct 26","reclaim_month":"Oct 26","is_carried_forward":false}]'::jsonb,
  '[]'::jsonb) AS f1c \gset
SELECT public.t7_eq((SELECT string_agg(concat_ws(':', supplier_invoice_number, COALESCE(reclaim_month, '-'), reclaimed_via_doc_id IS NOT NULL), ',' ORDER BY supplier_invoice_number)
                       FROM public.bills_not_in_2b WHERE client_id = :'K'),
  'K-0:Oct 26:t,K-1:-:f', 'F1: a version of before''s reclaim on a document a kept entry evidences comes back in Awaiting reclaim');
SELECT public.t7_eq(public.t7_itc(:'K', 'Oct 26'), '0.00|90.00', 'F1: ... 5.4 counts the one document''s 90 once (before: 180)');
SELECT public.t7_eq(position('already evidences the reclaim of KILO K-0' in COALESCE(:'f1c'::jsonb -> 'reclaims_back' -> 0 ->> 'message', '')) > 0, true,
  'F1: ... named, with the entry it evidences');
-- (d) Two reclaims of one document in one version of before: the first
-- linked, the second back in Awaiting reclaim, named.
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'B', '10/2026',
  (:'vb'::jsonb) || '[{"id":"7e000000-0000-0000-0000-0000000002e3","date":"2026-09-21","supplier_name":"BRAVO","supplier_invoice_number":"B1","supplier_gstin":"24BRAVO0000A1Z5","taxable_value":1000,"input_igst":0,"input_cgst":90,"input_sgst":90,"reversal_month":"Oct 26","reclaim_month":"Oct 26","is_carried_forward":false}]'::jsonb,
  '[]'::jsonb) AS f1d \gset
SELECT public.t7_eq((SELECT string_agg(concat_ws(':', t.supplier_invoice_number, COALESCE(t.reclaim_month, '-'), t.reclaimed_via_doc_id IS NOT NULL), ',' ORDER BY t.id)
                       FROM public.bills_not_in_2b t WHERE t.client_id = :'B'),
  'B-1:Oct 26:t,b/2:Oct 26:t,B1:-:f', 'F1: two reclaims of one document in a version of before: one linked, the other back in Awaiting reclaim');
SELECT public.t7_eq(concat_ws('|', public.t7_itc(:'B', 'Oct 26'),
                              position('evidences the reclaim of BRAVO B-1 in this version' in COALESCE(:'f1d'::jsonb -> 'reclaims_back' -> 0 ->> 'message', '')) > 0),
  '0.00|130.00|t', 'F1: ... 5.4 counts B-1''s 90 once, and the other is named');
-- (e) A reclaim typed on 2B Reconciliation (Liberal), no document of it in
-- the month: comes back as typed.
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'L', '10/2026',
  '[{"id":"7e000000-0000-0000-0000-0000000004e1","date":"2026-09-24","supplier_name":"LIMA","supplier_invoice_number":"L-1","supplier_gstin":"24LIMAA0000A1Z5","taxable_value":1000,"input_igst":0,"input_cgst":60,"input_sgst":60,"reversal_month":"Sep 26","reclaim_month":"Oct 26","is_carried_forward":false}]'::jsonb,
  '[]'::jsonb) AS f1e \gset
SELECT public.t7_eq(concat_ws('|', (SELECT concat_ws(':', reclaim_month, reclaimed_via_doc_id IS NULL) FROM public.bills_not_in_2b WHERE client_id = :'L'),
                              jsonb_array_length(:'f1e'::jsonb -> 'reclaims_back')),
  'Oct 26:t|0', 'F1: a reclaim typed with no document of it in the month comes back as typed, nothing said');

-- ---------------------------------------------------------------------------
-- F2. Out of Reclaim only while the reclaim is the one the page showed.
-- ---------------------------------------------------------------------------
-- Tab A (the GST Manager) reclaims E1 with D-1: tab A now shows D-1 Reclaim,
-- the evidence of the reclaim of E1. Tab B (the poster) takes D-1 out of
-- Reclaim (E1 was the wrong entry), then reclaims E2 with it.
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a2","x-gst-source":"app"}', false);
SELECT public.t7_eq(public.twob_import2b_reclaim(public.t_manager(), :'F', '10/2026', '7e000000-0000-0000-0000-0000000005e1',
  '7e000000-0000-0000-0000-0000000005d1', 'MATCHED') ->> 'ok', 'true', 'F2: tab A reclaims E1 (Sep''s copy) with D-1');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t7_eq(concat_ws('|',
  public.t7_unreclaim(public.t_poster(), :'F', '7e000000-0000-0000-0000-0000000005d1', 'MATCHED', '7e000000-0000-0000-0000-0000000005e1') ->> 'ok',
  public.twob_import2b_reclaim(public.t_poster(), :'F', '10/2026', '7e000000-0000-0000-0000-0000000005e2', '7e000000-0000-0000-0000-0000000005d1', 'MATCHED') ->> 'ok'),
  'true|true', 'F2: tab B takes D-1 out of Reclaim (it showed E1), then reclaims E2 with it');
-- Tab A, not reloaded (it shows D-1 the evidence of E1), saves D-1 Ineligible.
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a2","x-gst-source":"app"}', false);
SELECT public.t7_unreclaim(public.t_manager(), :'F', '7e000000-0000-0000-0000-0000000005d1', 'INELIGIBLE', '7e000000-0000-0000-0000-0000000005e1') AS f2a \gset
SELECT public.t7_eq(concat_ws('|', :'f2a'::jsonb ->> 'ok', :'f2a'::jsonb ->> 'gone'), 'false|true',
  'F2: tab A''s stale Save out of Reclaim is refused (before: ok, released 1)');
SELECT public.t7_eq((SELECT string_agg(concat_ws(':', t.reversal_month, COALESCE(t.reclaim_month, '-'), t.reclaimed_via_doc_id IS NOT NULL), ',' ORDER BY t.id)
                       FROM public.bills_not_in_2b t WHERE t.client_id = :'F')
                    || '|' || (SELECT itc_action FROM public.twob_import_docs WHERE id = '7e000000-0000-0000-0000-0000000005d1'),
  'Sep 26:-:f,Oct 26:Oct 26:t|RECLAIM', 'F2: ... nothing written: E2 keeps tab B''s reclaim, D-1 stays Reclaim');
SELECT public.t7_eq(position('changed elsewhere' in COALESCE(:'f2a'::jsonb ->> 'message', '')) > 0
                    AND position('FOXTROT D-1' in COALESCE(:'f2a'::jsonb ->> 'message', '')) > 0, true,
  'F2: ... said: changed elsewhere, and which reclaim the document evidences now');
-- The page showing none while one is recorded, refused too; the reclaim the
-- page shows goes through.
SELECT public.t7_eq(public.t7_unreclaim(public.t_manager(), :'F', '7e000000-0000-0000-0000-0000000005d1', 'INELIGIBLE', NULL) ->> 'ok', 'false',
  'F2: a Save sent showing no reclaim while one is recorded is refused');
SELECT public.t7_eq(public.t7_unreclaim(public.t_manager(), :'F', '7e000000-0000-0000-0000-0000000005d1', 'INELIGIBLE', '7e000000-0000-0000-0000-0000000005e2')::text,
  '{"ok": true, "was": "RECLAIM", "released": 1}', 'F2: the reloaded tab (showing E2) takes D-1 out of Reclaim: E2 released with it');
SELECT public.t7_eq((SELECT string_agg(COALESCE(t.reclaim_month, '-'), ',' ORDER BY t.id) FROM public.bills_not_in_2b t WHERE t.client_id = :'F')
                    || '|' || public.t7_itc(:'F', 'Oct 26'),
  '-,-|0.00|0.00', 'F2: ... both entries awaiting, the document Ineligible, nothing counted twice');

RESET ROLE;
DELETE FROM public.clients WHERE id IN (:'A', :'B', :'K', :'L', :'F');

DO $$
DECLARE
  v text;
  v_ok integer;
  v_all integer;
BEGIN
  SELECT count(*) FILTER (WHERE r.ok), count(*) INTO v_ok, v_all FROM public.t7_results r;
  SELECT string_agg(format('FAILED %s: %s', r.label, r.info), E'\n' ORDER BY r.n) INTO v FROM public.t7_results r WHERE NOT r.ok;
  RAISE NOTICE 'checks: round7 (SQL) % of % passed', v_ok, v_all;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION E'round7 (SQL): % of % checks passed\n%', v_ok, v_all, v;
  END IF;
END $$;
DROP TABLE public.t7_results;
DROP FUNCTION public.t7_eq(anyelement, anyelement, text), public.t7_raises(text, text, text), public.t7_itc(uuid, text),
  public.t7_unreclaim(uuid, uuid, uuid, text, uuid), public.t7_old_version(uuid);
