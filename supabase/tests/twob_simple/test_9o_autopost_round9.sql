-- Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md
-- §15): the ninth verification round, as PostgREST runs the app's calls
-- (anon, with the request headers; a4 holds Import 2B & post, a1 is the
-- superadmin). The lead's decision (simplify, never guess): Restore never
-- looks for a reclaim's 2B document by its amounts. A reclaimed entry of the
-- version comes back reclaimed only with its document known exactly: (1)
-- the one the version names, (2) the one the month's entry of that id names
-- now, (3) the month's only original invoice or debit note that is the same
-- document (twob_doc_ident: GSTIN or supplier, number and date); a document
-- named by (1) or (2) goes to its own entry first; then on the usual terms
-- (Reclaim now, evidencing no other reclaim). Otherwise, whenever the month
-- holds any 2B document, for a Strict and a Liberal client alike, the entry
-- comes back in Awaiting reclaim, named in reclaims_back ("reclaim it again
-- on Import 2B"); only a Liberal client's reclaim in a month holding no 2B
-- document at all comes back as typed. Round 8's findings, shown unable to
-- happen now:
--   M1 Moved reclaims: two rents of equal amounts, each reclaimed with its
--      own 2B document (the books numbered otherwise), restored from a
--      version of before after Clear Data: round 8 linked the first entry
--      to the first document by amounts and named the second entry as
--      "evidences the reclaim of" the first, the second document left
--      Reclaim and counted nowhere (5.4 halved). And with one rent taken
--      out of Reclaim before the Restore: round 8 moved the other rent's
--      reclaim to it, against the user's decision.
--   M2 Another supplier: an entry restored onto another supplier's free
--      Reclaim document while its own was Matched (one invoice in 5.1 and
--      5.4, the other supplier's document locked as its evidence).
--   M3 A Liberal client's Import 2B reclaim (paired by its amounts) restored
--      as typed beside its document's count in 5.1.
-- And: a named reclaim takes its document before an entry found as the
-- same document (precedence); two documents of one identity tell nothing
-- (not guessed); the timing of a 1,000 + 1,000 Restore.
-- Round 10 (test_9p): a Restore also names the Reclaim documents it leaves
-- evidencing no reclaim (docs_left): M1(a)'s two rents after Clear Data,
-- M2's BETA B1 with BX-9's reclaim it evidenced, Q's two documents; and the
-- entry found as the same document, losing to a named one, is told so
-- ("cannot be told"); the timed Restores count them too.
-- Each check is recorded (t9_results) and the file fails, naming every
-- failed check, at the end: run against round 8's code, each check fails or
-- passes on its own. Fictional.
\set A '7e200000-0000-0000-0000-0000000000c1'
\set C '7e200000-0000-0000-0000-0000000000c2'
\set B '7e200000-0000-0000-0000-0000000000c3'
\set L '7e200000-0000-0000-0000-0000000000c4'
\set N '7e200000-0000-0000-0000-0000000000c5'
\set P '7e200000-0000-0000-0000-0000000000c6'
\set Q '7e200000-0000-0000-0000-0000000000c7'
\set T '7e200000-0000-0000-0000-0000000000c8'
\set U '7e200000-0000-0000-0000-0000000000c9'

CREATE TABLE public.t9_results (n serial PRIMARY KEY, label text NOT NULL, ok boolean NOT NULL, info text);
GRANT ALL ON public.t9_results TO anon;
GRANT USAGE ON SEQUENCE public.t9_results_n_seq TO anon;
CREATE FUNCTION public.t9_eq(p_actual anyelement, p_expected anyelement, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.t9_results (label, ok, info)
  VALUES (p_label, p_actual IS NOT DISTINCT FROM p_expected, format('expected [%s], got [%s]', p_expected, p_actual));
END $$;
-- What ITC Summary reads for a client's month: 5.1 CGST (Matched and
-- Mismatched documents) and 5.4 CGST (entries reclaimed in it).
CREATE FUNCTION public.t9_itc(p_client uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT concat_ws('|',
    COALESCE((SELECT sum(d.input_cgst) FROM public.twob_import_docs d
               WHERE d.client_id = p_client AND d.period_month = '10/2026' AND d.itc_action IN ('MATCHED', 'MISMATCHED')), 0)::numeric(12,2),
    COALESCE((SELECT sum(t.input_cgst) FROM public.bills_not_in_2b t
               WHERE t.client_id = p_client AND t.reclaim_month = 'Oct 26' AND t.reclaim_subtype IS NULL), 0)::numeric(12,2));
$$;
-- A month's own Not in 2B entries as a version written before this release
-- holds them (2B Reconciliation's Save of before, Post's toVersionRow2B): no
-- document named, no Import 2B link. As this release's Save records them:
-- with the document each reclaim names.
CREATE FUNCTION public.t9_old_version(p_client uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg((to_jsonb(t) - 'adopted_from' - 'source_book_id' - 'reclaimed_via_doc_id') ORDER BY t.date, t.supplier_invoice_number), '[]'::jsonb)
    FROM public.bills_not_in_2b t WHERE t.client_id = p_client AND t.period_month = '10/2026' AND NOT t.is_carried_forward;
$$;
CREATE FUNCTION public.t9_new_version(p_client uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg((to_jsonb(t) - 'adopted_from') ORDER BY t.date, t.supplier_invoice_number), '[]'::jsonb)
    FROM public.bills_not_in_2b t WHERE t.client_id = p_client AND t.period_month = '10/2026' AND NOT t.is_carried_forward;
$$;
-- The client's entries: number:reclaim month:the number of the document its
-- reclaim names; and its documents: number=treatment.
CREATE FUNCTION public.t9_entries(p_client uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT string_agg(concat_ws(':', t.supplier_invoice_number, COALESCE(t.reclaim_month, '-'),
                              COALESCE((SELECT d.supplier_invoice_number FROM public.twob_import_docs d WHERE d.id = t.reclaimed_via_doc_id), '-')),
                    ',' ORDER BY t.date, t.supplier_invoice_number)
    FROM public.bills_not_in_2b t WHERE t.client_id = p_client;
$$;
CREATE FUNCTION public.t9_docs(p_client uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT string_agg(d.supplier_invoice_number || '=' || d.itc_action, ',' ORDER BY d.date, d.supplier_invoice_number, d.doc_type)
    FROM public.twob_import_docs d WHERE d.client_id = p_client;
$$;
-- The names and messages a Restore returned in reclaims_back, and (round
-- 10) in docs_left: the month's Reclaim documents it left evidencing no
-- reclaim.
CREATE FUNCTION public.t9_back(p_res jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(string_agg((x ->> 'supplier_invoice_number') || ': ' || (x ->> 'message'), ' / ' ORDER BY o), '-')
    FROM jsonb_array_elements(COALESCE(p_res -> 'reclaims_back', '[]'::jsonb)) WITH ORDINALITY e(x, o);
$$;
CREATE FUNCTION public.t9_left(p_res jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(string_agg((x ->> 'supplier_invoice_number') || ': ' || (x ->> 'message'), ' / ' ORDER BY o), '-')
    FROM jsonb_array_elements(COALESCE(p_res -> 'docs_left', '[]'::jsonb)) WITH ORDINALITY e(x, o);
$$;
GRANT EXECUTE ON FUNCTION public.t9_eq(anyelement, anyelement, text), public.t9_itc(uuid), public.t9_old_version(uuid),
  public.t9_new_version(uuid), public.t9_entries(uuid), public.t9_docs(uuid), public.t9_back(jsonb), public.t9_left(jsonb) TO anon;

SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES
  (:'A', 'R9 TWO RENTS CLEAR DATA', '24RNINA0000A1Z5', false),
  (:'C', 'R9 TWO RENTS ONE OUT', '24RNINC0000A1Z5', false),
  (:'B', 'R9 OTHER SUPPLIER', '24RNINB0000A1Z5', false),
  (:'L', 'R9 LIBERAL IMPORT 2B', '24RNINL0000A1Z5', true),
  (:'N', 'R9 LIBERAL NO 2B', '24RNINN0000A1Z5', true),
  (:'P', 'R9 NAMED FIRST', '24RNINP0000A1Z5', false),
  (:'Q', 'R9 TWO OF ONE IDENTITY', '24RNINQ0000A1Z5', false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action) VALUES
  -- A, C: the landlord's two rents, equal amounts, Matched.
  ('7e200000-0000-0000-0000-0000000001d1', :'A', '10/2026', '2026-09-01', 'LANDLORD', 'RENT/2026/09', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'INVOICE', 'MATCHED'),
  ('7e200000-0000-0000-0000-0000000001d2', :'A', '10/2026', '2026-10-01', 'LANDLORD', 'RENT/2026/10', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'INVOICE', 'MATCHED'),
  ('7e200000-0000-0000-0000-0000000002d1', :'C', '10/2026', '2026-09-01', 'LANDLORD', 'RENT/2026/09', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'INVOICE', 'MATCHED'),
  ('7e200000-0000-0000-0000-0000000002d2', :'C', '10/2026', '2026-10-01', 'LANDLORD', 'RENT/2026/10', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'INVOICE', 'MATCHED'),
  -- B: ALPHA A1 and BETA B1, equal amounts, Matched.
  ('7e200000-0000-0000-0000-0000000003d1', :'B', '10/2026', '2026-09-20', 'ALPHA', 'A1', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  ('7e200000-0000-0000-0000-0000000003d2', :'B', '10/2026', '2026-09-22', 'BETA', 'B1', '24BETAA0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  -- L: GAMMA G/2026/0042, Matched (its books entry G-42/26-27).
  ('7e200000-0000-0000-0000-0000000004d1', :'L', '10/2026', '2026-09-21', 'GAMMA', 'G/2026/0042', '24GAMMA0000A1Z5', 2000, 0, 50, 50, 'INVOICE', 'MATCHED'),
  -- P: PAPA P-1, Reclaim, evidencing nothing yet.
  ('7e200000-0000-0000-0000-0000000006d1', :'P', '10/2026', '2026-09-23', 'PAPA', 'P-1', '24PAPAA0000A1Z5', 1000, 0, 70, 70, 'INVOICE', 'RECLAIM'),
  -- Q: QUEBEC Q-7 twice, an invoice and a debit note of one number and date, both Reclaim.
  ('7e200000-0000-0000-0000-0000000007d1', :'Q', '10/2026', '2026-09-24', 'QUEBEC', 'Q-7', '24QUEBE0000A1Z5', 1000, 0, 30, 30, 'INVOICE', 'RECLAIM'),
  ('7e200000-0000-0000-0000-0000000007d2', :'Q', '10/2026', '2026-09-24', 'QUEBEC', 'Q-7', '24QUEBE0000A1Z5', 1000, 0, 30, 30, 'DEBIT_NOTE', 'RECLAIM');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('7e200000-0000-0000-0000-0000000001e1', :'A', '10/2026', '2026-09-01', 'LANDLORD', 'R-SEP', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'Oct 26', false),
  ('7e200000-0000-0000-0000-0000000001e2', :'A', '10/2026', '2026-10-01', 'LANDLORD', 'R-OCT', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'Oct 26', false),
  ('7e200000-0000-0000-0000-0000000002e1', :'C', '10/2026', '2026-09-01', 'LANDLORD', 'R-SEP', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'Oct 26', false),
  ('7e200000-0000-0000-0000-0000000002e2', :'C', '10/2026', '2026-10-01', 'LANDLORD', 'R-OCT', '24LANDL0000A1Z5', 50000, 0, 4500, 4500, 'Oct 26', false),
  ('7e200000-0000-0000-0000-0000000003e1', :'B', '10/2026', '2026-09-20', 'ALPHA', 'INV-77', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false),
  ('7e200000-0000-0000-0000-0000000003e2', :'B', '10/2026', '2026-09-22', 'BETA', 'BX-9', '24BETAA0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false),
  ('7e200000-0000-0000-0000-0000000004e1', :'L', '10/2026', '2026-09-21', 'GAMMA', 'G-42/26-27', '24GAMMA0000A1Z5', 2000, 0, 50, 50, 'Oct 26', false);
SELECT set_config('twob.write', '', false);

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);

-- ---------------------------------------------------------------------------
-- M1. Two rents of equal amounts: no reclaim moves to the other's document.
-- ---------------------------------------------------------------------------
-- (a) Each rent reclaimed with its own document on Import 2B (Link &
-- Reclaim, by the amounts: the books numbered R-SEP / R-OCT); a version of
-- before and one as this release records it; Clear Data of the month; the
-- version of before restored.
SELECT public.t9_eq(concat_ws('|',
  public.twob_import2b_reclaim(public.t_poster(), :'A', '10/2026', '7e200000-0000-0000-0000-0000000001e1', '7e200000-0000-0000-0000-0000000001d1', 'MATCHED') ->> 'ok',
  public.twob_import2b_reclaim(public.t_poster(), :'A', '10/2026', '7e200000-0000-0000-0000-0000000001e2', '7e200000-0000-0000-0000-0000000001d2', 'MATCHED') ->> 'ok'),
  'true|true', 'M1: R-SEP and R-OCT reclaimed with their own rents');
SELECT public.t9_eq(public.t9_itc(:'A'), '0.00|9000.00', 'M1: ... (5.4 9000)');
SELECT public.t9_old_version(:'A') AS va_old, public.t9_new_version(:'A') AS va_new \gset
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.t9_eq(public.twob_clear_year(public.t_superadmin(), :'A', ARRAY['10/2026']) ->> 'deleted', '2', 'M1: Clear Data of the month (both rents stay Reclaim)');
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'A', '10/2026', :'va_old'::jsonb, '[]'::jsonb) AS ma \gset
SELECT public.t9_eq(concat_ws('|', public.t9_entries(:'A'), public.t9_docs(:'A'), public.t9_itc(:'A')),
  'R-SEP:-:-,R-OCT:-:-|RENT/2026/09=RECLAIM,RENT/2026/10=RECLAIM|0.00|0.00',
  'M1(a): the version of before restored: neither reclaim linked to a document it may not have been made with (round 8: R-SEP on RENT/2026/09 by its amounts, R-OCT back, RENT/2026/10 counted nowhere, 5.4 4500)');
SELECT public.t9_eq(public.t9_back(:'ma'::jsonb),
  'R-SEP: its 2B document cannot be found: this version does not name it, and no 2B document of this month has its GSTIN or supplier, number and date; reclaim it again on Import 2B'
  || ' / R-OCT: its 2B document cannot be found: this version does not name it, and no 2B document of this month has its GSTIN or supplier, number and date; reclaim it again on Import 2B',
  'M1(a): ... both back in Awaiting reclaim, each named, "reclaim it again on Import 2B" (round 8: R-OCT "evidences the reclaim of LANDLORD R-SEP", a false reason)');
SELECT public.t9_eq(public.t9_left(:'ma'::jsonb),
  'RENT/2026/09: is Reclaim and evidences no reclaim, so its ITC counts nowhere / RENT/2026/10: is Reclaim and evidences no reclaim, so its ITC counts nowhere',
  'M1(a): ... and both rents, left Reclaim by Clear Data, named (round 10: the documents to reclaim them with again)');
-- (b) The version as this release records it (each reclaim naming its
-- document) restored: each back with its own rent.
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'A', '10/2026', :'va_new'::jsonb, '[]'::jsonb) AS mb \gset
SELECT public.t9_eq(concat_ws('|', public.t9_entries(:'A'), public.t9_back(:'mb'::jsonb), public.t9_left(:'mb'::jsonb), public.t9_itc(:'A')),
  'R-SEP:Oct 26:RENT/2026/09,R-OCT:Oct 26:RENT/2026/10|-|-|0.00|9000.00',
  'M1(b): a version naming each reclaim''s document restored: each back with its own rent, nothing said, 5.4 9000');
-- (c) The same two rents; a version of before; RENT/2026/09 taken out of
-- Reclaim on Import 2B (R-SEP back in Awaiting reclaim); the version
-- restored: R-OCT keeps RENT/2026/10 (its entry of that id names it), R-SEP
-- stays in Awaiting reclaim, named; the month as it was.
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t9_eq(concat_ws('|',
  public.twob_import2b_reclaim(public.t_poster(), :'C', '10/2026', '7e200000-0000-0000-0000-0000000002e1', '7e200000-0000-0000-0000-0000000002d1', 'MATCHED') ->> 'ok',
  public.twob_import2b_reclaim(public.t_poster(), :'C', '10/2026', '7e200000-0000-0000-0000-0000000002e2', '7e200000-0000-0000-0000-0000000002d2', 'MATCHED') ->> 'ok'),
  'true|true', 'M1(c): R-SEP and R-OCT reclaimed with their own rents');
SELECT public.t9_old_version(:'C') AS vc \gset
SELECT public.t9_eq(public.twob_import2b_unreclaim(public.t_poster(), :'C', '10/2026', '7e200000-0000-0000-0000-0000000002d1', 'MATCHED',
  '7e200000-0000-0000-0000-0000000002e1') ->> 'ok', 'true', 'M1(c): RENT/2026/09 taken out of Reclaim (Matched)');
SELECT concat_ws('|', public.t9_entries(:'C'), public.t9_docs(:'C'), public.t9_itc(:'C')) AS c_before \gset
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'C', '10/2026', :'vc'::jsonb, '[]'::jsonb) AS mc \gset
SELECT public.t9_eq(concat_ws('|', public.t9_entries(:'C'), public.t9_docs(:'C'), public.t9_itc(:'C')),
  'R-SEP:-:-,R-OCT:Oct 26:RENT/2026/10|RENT/2026/09=MATCHED,RENT/2026/10=RECLAIM|4500.00|4500.00',
  'M1(c): restored: R-OCT keeps RENT/2026/10, R-SEP stays in Awaiting reclaim (round 8: R-SEP took RENT/2026/10, R-OCT lost its reclaim)');
SELECT public.t9_eq(concat_ws('|', :'c_before' = concat_ws('|', public.t9_entries(:'C'), public.t9_docs(:'C'), public.t9_itc(:'C')),
                              position('R-SEP: its 2B document cannot be found' in public.t9_back(:'mc'::jsonb)) = 1,
                              position('R-OCT' in public.t9_back(:'mc'::jsonb)) = 0, public.t9_left(:'mc'::jsonb)),
  't|t|t|-', 'M1(c): ... the month as before the Restore, the out-of-Reclaim decision kept; only R-SEP named, no document left');

-- ---------------------------------------------------------------------------
-- M2. Never another supplier's document.
-- ---------------------------------------------------------------------------
-- ALPHA INV-77 reclaimed with ALPHA A1 (by the amounts); a version of
-- before; A1 taken out of Reclaim; BETA BX-9 reclaimed with BETA B1; the
-- version restored (BX-9 awaiting in it).
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t9_eq(public.twob_import2b_reclaim(public.t_poster(), :'B', '10/2026', '7e200000-0000-0000-0000-0000000003e1',
  '7e200000-0000-0000-0000-0000000003d1', 'MATCHED') ->> 'ok', 'true', 'M2: INV-77 reclaimed with ALPHA A1');
SELECT public.t9_old_version(:'B') AS vb \gset
SELECT public.t9_eq(concat_ws('|',
  public.twob_import2b_unreclaim(public.t_poster(), :'B', '10/2026', '7e200000-0000-0000-0000-0000000003d1', 'MATCHED', '7e200000-0000-0000-0000-0000000003e1') ->> 'ok',
  public.twob_import2b_reclaim(public.t_poster(), :'B', '10/2026', '7e200000-0000-0000-0000-0000000003e2', '7e200000-0000-0000-0000-0000000003d2', 'MATCHED') ->> 'ok'),
  'true|true', 'M2: A1 out of Reclaim, then BX-9 reclaimed with BETA B1');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'B', '10/2026', :'vb'::jsonb, '[]'::jsonb) AS mbb \gset
SELECT public.t9_eq(concat_ws('|', public.t9_entries(:'B'), public.t9_itc(:'B'),
                              position('INV-77: its 2B document cannot be found' in public.t9_back(:'mbb'::jsonb)) = 1),
  'INV-77:-:-,BX-9:-:-|90.00|0.00|t',
  'M2: restored: INV-77 back in Awaiting reclaim, named, never on BETA B1; A1''s ITC once (round 8: INV-77 on B1, nothing said, 5.1 90 and 5.4 90)');
SELECT public.t9_eq(public.t9_left(:'mbb'::jsonb),
  'B1: stays Reclaim and evidences no reclaim now, so its ITC counts nowhere; before this Restore it evidenced the reclaim of BETA BX-9',
  'M2: ... BX-9 back in Awaiting reclaim as the version holds it, and BETA B1, left Reclaim with its 90 counted nowhere, named with it (round 9: neither named)');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t9_eq(concat_ws('|',
  public.twob_import2b_unreclaim(public.t_poster(), :'B', '10/2026', '7e200000-0000-0000-0000-0000000003d2', 'MATCHED', NULL) ->> 'ok',
  public.twob_import2b_reclaim(public.t_poster(), :'B', '10/2026', '7e200000-0000-0000-0000-0000000003e2', '7e200000-0000-0000-0000-0000000003d2', 'MATCHED') ->> 'ok'),
  'true|true',
  'M2: ... BETA B1 is no other supplier''s evidence: BX-9 reclaimed with it again (round 8: refused, "already the evidence of the reclaim of ALPHA INV-77")');
SELECT public.t9_eq(concat_ws('|', public.t9_entries(:'B'), public.t9_itc(:'B')), 'INV-77:-:-,BX-9:Oct 26:B1|90.00|90.00',
  'M2: ... A1 and B1 each counted once');

-- ---------------------------------------------------------------------------
-- M3. A Liberal client: the same rule.
-- ---------------------------------------------------------------------------
-- G-42/26-27 reclaimed on Import 2B with G/2026/0042 (by the amounts); a
-- version of before; the document taken out of Reclaim; the version restored.
SELECT public.t9_eq(public.twob_import2b_reclaim(public.t_poster(), :'L', '10/2026', '7e200000-0000-0000-0000-0000000004e1',
  '7e200000-0000-0000-0000-0000000004d1', 'MATCHED') ->> 'ok', 'true', 'M3: a Liberal client''s G-42/26-27 reclaimed on Import 2B');
SELECT public.t9_old_version(:'L') AS vl \gset
SELECT public.t9_eq(public.twob_import2b_unreclaim(public.t_poster(), :'L', '10/2026', '7e200000-0000-0000-0000-0000000004d1', 'MATCHED',
  '7e200000-0000-0000-0000-0000000004e1') ->> 'ok', 'true', 'M3: ... then its document taken out of Reclaim (5.1 50, 5.4 none)');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'L', '10/2026', :'vl'::jsonb, '[]'::jsonb) AS ml \gset
SELECT public.t9_eq(concat_ws('|', public.t9_entries(:'L'), public.t9_itc(:'L'),
                              position('reclaim it again on Import 2B' in public.t9_back(:'ml'::jsonb)) > 0),
  'G-42/26-27:-:-|50.00|0.00|t',
  'M3: restored: back in Awaiting reclaim, named, the invoice counted once (round 8: as typed, 5.1 50 and 5.4 50, nothing said)');
-- A Liberal client's reclaim typed on 2B Reconciliation in a month holding
-- no 2B document at all: back as typed, nothing said.
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'N', '10/2026',
  '[{"id":"7e200000-0000-0000-0000-0000000005e1","date":"2026-09-24","supplier_name":"NOVEMBER","supplier_invoice_number":"N-1","supplier_gstin":"24NOVEM0000A1Z5","taxable_value":1000,"input_igst":0,"input_cgst":60,"input_sgst":60,"reversal_month":"Sep 26","reclaim_month":"Oct 26","is_carried_forward":false}]'::jsonb,
  '[]'::jsonb) AS mn \gset
SELECT public.t9_eq(concat_ws('|', public.t9_entries(:'N'), public.t9_back(:'mn'::jsonb)), 'N-1:Oct 26:-|-',
  'M3: a Liberal client''s typed reclaim, no 2B document in the month: back as typed, nothing said');

-- ---------------------------------------------------------------------------
-- A named reclaim first; one identity, two documents.
-- ---------------------------------------------------------------------------
-- P-1 (the same document as PAPA P-1, first in the version, naming none)
-- and P1-BOOKS (naming PAPA P-1): P1-BOOKS takes it, P-1 back in Awaiting
-- reclaim, named (round 8 went by the version's order: P-1 took it).
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'P', '10/2026',
  '[{"id":"7e200000-0000-0000-0000-0000000006e1","date":"2026-09-23","supplier_name":"PAPA","supplier_invoice_number":"P-1","supplier_gstin":"24PAPAA0000A1Z5","taxable_value":1000,"input_igst":0,"input_cgst":70,"input_sgst":70,"reversal_month":"Oct 26","reclaim_month":"Oct 26","is_carried_forward":false},
    {"id":"7e200000-0000-0000-0000-0000000006e2","date":"2026-09-23","supplier_name":"PAPA","supplier_invoice_number":"P1-BOOKS","supplier_gstin":"24PAPAA0000A1Z5","taxable_value":1000,"input_igst":0,"input_cgst":70,"input_sgst":70,"reversal_month":"Oct 26","reclaim_month":"Oct 26","reclaimed_via_doc_id":"7e200000-0000-0000-0000-0000000006d1","is_carried_forward":false}]'::jsonb,
  '[]'::jsonb) AS mp \gset
SELECT public.t9_eq(concat_ws('|', public.t9_entries(:'P'), public.t9_back(:'mp'::jsonb), public.t9_itc(:'P')),
  'P-1:-:-,P1-BOOKS:Oct 26:P-1|P-1: its 2B document cannot be told: this version does not name it, and PAPA P-1, the one 2B document of this month with its GSTIN or supplier, number and date, evidences the reclaim of PAPA P1-BOOKS in this version; reclaim it again on Import 2B|0.00|70.00',
  'precedence: the reclaim naming PAPA P-1 takes it before the entry found as the same document; 5.4 70 once');
-- Q-7 reclaimed in a version naming no document; the month holds an
-- invoice and a debit note Q-7 of one date: nothing tells which, so back in
-- Awaiting reclaim, named (round 8 chose one).
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'Q', '10/2026',
  '[{"id":"7e200000-0000-0000-0000-0000000007e1","date":"2026-09-24","supplier_name":"QUEBEC","supplier_invoice_number":"Q-7","supplier_gstin":"24QUEBE0000A1Z5","taxable_value":1000,"input_igst":0,"input_cgst":30,"input_sgst":30,"reversal_month":"Oct 26","reclaim_month":"Oct 26","is_carried_forward":false}]'::jsonb,
  '[]'::jsonb) AS mq \gset
SELECT public.t9_eq(concat_ws('|', public.t9_entries(:'Q'), public.t9_back(:'mq'::jsonb), public.t9_left(:'mq'::jsonb)),
  'Q-7:-:-|Q-7: its 2B document cannot be told: this version does not name it, and 2 2B documents of this month have its GSTIN or supplier, number and date; reclaim it again on Import 2B'
  || '|Q-7: is Reclaim and evidences no reclaim, so its ITC counts nowhere / Q-7: is Reclaim and evidences no reclaim, so its ITC counts nowhere',
  'two documents of one identity: not guessed, back in Awaiting reclaim, named; both documents named (round 10)');

-- ---------------------------------------------------------------------------
-- Timing: a 1,000 + 1,000 month restored.
-- ---------------------------------------------------------------------------
-- T: 1,000 books rows Not in 2B and 1,000 Not in Books documents written
-- through; 200 of the entries reclaimed with Matched documents numbered
-- otherwise. U: 1,000 documents, half Reclaim; a version of before holding
-- 1,000 reclaims of them, 500 the same documents, 500 numbered otherwise.
RESET ROLE;
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES (:'T', 'R9 RESTORE TIMING', '24RNINT0000A1Z5'), (:'U', 'R9 RESTORE RECLAIMS', '24RNINU0000A1Z5');
INSERT INTO public.twob_import_docs (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action)
SELECT :'U', '10/2026', '2026-09-20', 'SUP ' || g, 'D/' || g, '24SUPP' || lpad(g::text, 4, '0') || 'A1Z5', 1000 + g * 10, 0, 90 + g, 90 + g, 'INVOICE',
       CASE WHEN g % 2 = 0 THEN 'RECLAIM' ELSE 'MATCHED' END
  FROM generate_series(1, 1000) g;
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
INSERT INTO public.books_register (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, book_treatment)
SELECT :'T', '10/2026', '2026-10-03', 'BK ' || g, 'BK-' || g, '24BKSUP' || lpad(g::text, 4, '0') || 'Z5', 1000 + g, 0, 90 + g, 90 + g, 'NOT_IN_2B'
  FROM generate_series(1, 1000) g;
INSERT INTO public.twob_import_docs (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action)
SELECT :'T', '10/2026', '2026-10-04', 'NB ' || g, 'NB-' || g, '24NBSUP' || lpad(g::text, 4, '0') || 'Z5', 2000 + g, 0, 180 + g, 180 + g, 'INVOICE', 'NOT_IN_BOOKS'
  FROM generate_series(1, 1000) g;
INSERT INTO public.twob_import_docs (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action)
SELECT :'T', '10/2026', '2026-10-03', 'BK ' || g, 'RC/' || g, '24BKSUP' || lpad(g::text, 4, '0') || 'Z5', 1000 + g, 0, 90 + g, 90 + g, 'INVOICE', 'MATCHED'
  FROM generate_series(1, 200) g;
SELECT public.t9_eq(count(*), 200::bigint, 'timing: (200 of T''s entries reclaimed with documents numbered otherwise)') FROM (
  SELECT public.twob_import2b_reclaim(public.t_poster(), :'T', '10/2026', t.id, d.id, 'MATCHED') ->> 'ok' AS ok
    FROM public.bills_not_in_2b t
    JOIN public.twob_import_docs d ON d.client_id = t.client_id AND d.supplier_invoice_number = 'RC/' || substr(t.supplier_invoice_number, 4)
   WHERE t.client_id = :'T') x WHERE ok = 'true';
RESET ROLE;
-- The versions as the page sends them: T's as this release records it, and
-- as a version of before (other ids, no links); U's of before.
CREATE TABLE public.t9_v AS SELECT
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.date, t.id) FROM public.bills_not_in_2b t WHERE t.client_id = :'T') AS n2b,
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.date, t.id) FROM public.bills_not_in_books t WHERE t.client_id = :'T') AS nbk,
  (SELECT jsonb_agg(to_jsonb(t) - 'source_book_id' - 'reclaimed_via_doc_id' - 'adopted_from' || jsonb_build_object('id', gen_random_uuid()) ORDER BY t.date, t.id)
     FROM public.bills_not_in_2b t WHERE t.client_id = :'T') AS o2b,
  (SELECT jsonb_agg(to_jsonb(t) - 'source_doc_id' - 'adopted_from' || jsonb_build_object('id', gen_random_uuid()) ORDER BY t.date, t.id)
     FROM public.bills_not_in_books t WHERE t.client_id = :'T') AS obk,
  (SELECT jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'date', '2026-09-20', 'supplier_name', 'SUP ' || g,
     'supplier_gstin', CASE WHEN g <= 500 THEN '24SUPP' || lpad(g::text, 4, '0') || 'A1Z5' END,
     'supplier_invoice_number', CASE WHEN g <= 500 THEN 'D/' || g ELSE 'B-' || g END,
     'taxable_value', 1000 + g * 10, 'input_igst', 0, 'input_cgst', 90 + g, 'input_sgst', 90 + g,
     'reversal_month', 'Oct 26', 'reclaim_month', 'Oct 26', 'is_carried_forward', false)) FROM generate_series(1, 1000) g) AS u2b;
GRANT SELECT ON public.t9_v TO anon;
-- Each timed three times (two runs undone, in a block rolled back, then the
-- one kept), with what its commit runs; the gate reads the median, held well
-- inside the 3 s an anon request has on Supabase. Before this round, with
-- the change log applied as on live: the version of before 2.2 to 2.7 s.
BEGIN;
SET LOCAL ROLE anon;
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', true);
DO $$
DECLARE
  t0 timestamptz;
  ms numeric[];
  med numeric;
  r jsonb;
  w text;
  i integer;
  c uuid;
  v2b jsonb;
  vbk jsonb;
  n_rc bigint;
BEGIN
  FOREACH w IN ARRAY ARRAY['new', 'old', 'reclaims'] LOOP
    c := CASE WHEN w = 'reclaims' THEN '7e200000-0000-0000-0000-0000000000c9'::uuid ELSE '7e200000-0000-0000-0000-0000000000c8'::uuid END;
    SELECT CASE w WHEN 'new' THEN n2b WHEN 'old' THEN o2b ELSE u2b END, CASE w WHEN 'new' THEN nbk WHEN 'old' THEN obk ELSE '[]'::jsonb END
      INTO v2b, vbk FROM public.t9_v;
    ms := '{}';
    FOR i IN 1..3 LOOP
      BEGIN
        t0 := clock_timestamp();
        r := public.twob_restore_version_linked(public.t_superadmin(), c, '10/2026', v2b, vbk);
        -- What the request's commit runs too (the change log's deferred
        -- flush, where 20261021150000 is applied, as on live).
        SET CONSTRAINTS ALL IMMEDIATE;
        SET CONSTRAINTS ALL DEFERRED;
        ms := ms || round(extract(epoch FROM clock_timestamp() - t0) * 1000);
        IF i < 3 THEN
          RAISE EXCEPTION USING ERRCODE = 'TWB9O', MESSAGE = 'undo this run';
        END IF;
      EXCEPTION WHEN SQLSTATE 'TWB9O' THEN NULL;
      END;
    END LOOP;
    SELECT x INTO med FROM unnest(ms) x ORDER BY x OFFSET 1 LIMIT 1;
    SELECT count(*) INTO n_rc FROM public.bills_not_in_2b t WHERE t.client_id = c AND t.reclaimed_via_doc_id IS NOT NULL;
    RAISE NOTICE 'timing: R% Restore of % (% + % entries, % linked, % reclaims with their document, % back in Awaiting reclaim, % Reclaim documents left evidencing none): median % ms of %',
      CASE w WHEN 'new' THEN 1 WHEN 'old' THEN 2 ELSE 3 END,
      CASE w WHEN 'new' THEN 'a 1,000 + 1,000 month as this release records it'
             WHEN 'old' THEN 'the same month as a version of before (other ids, no links)'
             ELSE '1,000 reclaims of a version of before against 1,000 documents' END,
      r ->> 'bills_not_in_2b', r ->> 'bills_not_in_books', r ->> 'linked', n_rc, jsonb_array_length(r -> 'reclaims_back'),
      jsonb_array_length(r -> 'docs_left'), med, array_to_string(ms, ', ');
    PERFORM public.t9_eq(concat_ws('|', r ->> 'bills_not_in_2b', r ->> 'bills_not_in_books', r ->> 'linked', n_rc, jsonb_array_length(r -> 'reclaims_back'),
                                   jsonb_array_length(r -> 'docs_left')),
      CASE w WHEN 'new' THEN '1000|1000|2000|200|0|0' WHEN 'old' THEN '1000|1000|2000|0|200|200' ELSE '1000|0|0|250|750|250' END,
      format('timing: R%s restored as expected (%s)', CASE w WHEN 'new' THEN 1 WHEN 'old' THEN 2 ELSE 3 END,
             CASE w WHEN 'new' THEN 'every link and reclaim back' WHEN 'old' THEN 'every entry linked by its document; the 200 reclaims numbered otherwise back in Awaiting reclaim, their 200 documents named'
                    ELSE 'the 250 the same Reclaim documents linked; the 250 of Matched ones and the 500 numbered otherwise back; the 250 other Reclaim documents named' END));
    PERFORM public.t9_eq(med < 1500, true, format('timing: R%s under 1.5 s, the median of three', CASE w WHEN 'new' THEN 1 WHEN 'old' THEN 2 ELSE 3 END));
  END LOOP;
END $$;
COMMIT;

RESET ROLE;
DROP TABLE public.t9_v;
SELECT set_config('twob.write', 'system', false);
DELETE FROM public.clients WHERE id IN (:'A', :'C', :'B', :'L', :'N', :'P', :'Q', :'T', :'U');
SELECT set_config('twob.write', '', false);

DO $$
DECLARE
  v text;
  v_ok integer;
  v_all integer;
BEGIN
  SELECT count(*) FILTER (WHERE r.ok), count(*) INTO v_ok, v_all FROM public.t9_results r;
  SELECT string_agg(format('FAILED %s: %s', r.label, r.info), E'\n' ORDER BY r.n) INTO v FROM public.t9_results r WHERE NOT r.ok;
  RAISE NOTICE 'checks: round9 (SQL) % of % passed', v_ok, v_all;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION E'round9 (SQL): % of % checks passed\n%', v_ok, v_all, v;
  END IF;
END $$;
DROP TABLE public.t9_results;
DROP FUNCTION public.t9_eq(anyelement, anyelement, text), public.t9_itc(uuid), public.t9_old_version(uuid), public.t9_new_version(uuid),
  public.t9_entries(uuid), public.t9_docs(uuid), public.t9_back(jsonb), public.t9_left(jsonb);
