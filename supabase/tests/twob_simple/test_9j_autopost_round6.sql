-- Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md
-- §15): the sixth verification round's findings, as PostgREST runs the app's
-- calls (anon, with the request headers; a4 holds Import 2B & post, a1 is the
-- superadmin):
--   H1 Restore brings a version's reclaim back only while its 2B document is
--      in the month, Reclaim now, and evidences no other reclaim; otherwise
--      the entry comes back in Awaiting reclaim, named with why
--      (reclaims_back). Before: a reclaim against a document taken out of
--      Reclaim since came back counted in 5.4 beside the document's own count
--      in 5.1; a version's second reclaim on one document, or one on a
--      document a kept carried entry already evidences, came back counted
--      twice in 5.4. Any writer naming a document that is not Reclaim is
--      refused (an entry names only a Reclaim document), and a document a
--      reclaim recorded before names while it is not Reclaim can only be
--      made Reclaim again;
--   H2 one reclaim per 2B document holds where the unique index cannot be
--      created (live: a filed month's pair recorded before): the app of
--      before's own writes from a stale tab are refused, the pair recorded
--      before is left as it is.
-- (Two sessions at once: test_9k_reclaim_race.sh.)
-- Each check is recorded (t6_results) and the file fails, naming every
-- failed check, at the end: run against the code of before this round, each
-- check fails or passes on its own. Fictional.
\set R1 '6e000000-0000-0000-0000-0000000000c1'
\set R2 '6e000000-0000-0000-0000-0000000000c2'
\set R3 '6e000000-0000-0000-0000-0000000000c3'
\set R4 '6e000000-0000-0000-0000-0000000000c4'
\set G  '6e000000-0000-0000-0000-0000000000c7'
\set O  '6e000000-0000-0000-0000-0000000000c8'

CREATE TABLE public.t6_results (n serial PRIMARY KEY, label text NOT NULL, ok boolean NOT NULL, info text);
GRANT ALL ON public.t6_results TO anon;
GRANT USAGE ON SEQUENCE public.t6_results_n_seq TO anon;
CREATE FUNCTION public.t6_eq(p_actual anyelement, p_expected anyelement, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.t6_results (label, ok, info)
  VALUES (p_label, p_actual IS NOT DISTINCT FROM p_expected, format('expected [%s], got [%s]', p_expected, p_actual));
END $$;
CREATE FUNCTION public.t6_raises(p_sql text, p_like text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.t6_results (label, ok, info)
    VALUES (p_label, position(p_like in SQLERRM) > 0, format('raised [%s], expected it to mention [%s]', SQLERRM, p_like));
    RETURN;
  END;
  INSERT INTO public.t6_results (label, ok, info) VALUES (p_label, false, 'did not raise');
END $$;
-- What ITC Summary reads for a client's month: 5.1 CGST (Matched and
-- Mismatched documents) and 5.4 CGST (entries reclaimed in it).
CREATE FUNCTION public.t6_itc(p_client uuid, p_label text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT concat_ws('|',
    COALESCE((SELECT sum(d.input_cgst) FROM public.twob_import_docs d
               WHERE d.client_id = p_client AND public.twob_period_label(d.period_month) = p_label
                 AND d.itc_action IN ('MATCHED', 'MISMATCHED')), 0)::numeric(12,2),
    COALESCE((SELECT sum(t.input_cgst) FROM public.bills_not_in_2b t
               WHERE t.client_id = p_client AND t.reclaim_month = p_label AND t.reclaim_subtype IS NULL), 0)::numeric(12,2));
$$;
GRANT EXECUTE ON FUNCTION public.t6_eq(anyelement, anyelement, text), public.t6_raises(text, text, text), public.t6_itc(uuid, text) TO anon;

SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin, liberal_2b_reconciliation) VALUES
  (:'R1', 'R6 RESTORE BACK', '24RSIXA0000A1Z5', false), (:'R2', 'R6 RESTORE KEPT', '24RSIXB0000A1Z5', false),
  (:'R3', 'R6 RESTORE GONE', '24RSIXC0000A1Z5', true), (:'R4', 'R6 DIRECT WRITES', '24RSIXD0000A1Z5', false),
  (:'G', 'R6 GROWQ LIKE', '24RSIXG0000A1Z5', false), (:'O', 'R6 OLD APP TABS', '24RSIXO0000A1Z5', false);
-- R1: an own entry A-1 and its document A-1 (Matched), Oct-26 open.
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('6e000000-0000-0000-0000-0000000001e1', :'R1', '10/2026', '2026-10-01', 'ALPHA', 'A-1', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action) VALUES
  ('6e000000-0000-0000-0000-0000000001d1', :'R1', '10/2026', '2026-10-01', 'ALPHA', 'A-1', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  -- R2: K-1 Reclaim, the evidence of the reclaim of K-0, a carried entry the month keeps.
  ('6e000000-0000-0000-0000-0000000002d1', :'R2', '10/2026', '2026-10-01', 'KILO', 'K-1', '24KILOO0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'RECLAIM'),
  -- R4: documents of each treatment.
  ('6e000000-0000-0000-0000-0000000004d1', :'R4', '10/2026', '2026-10-01', 'MIKE', 'M-1', '24MIKEE0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  ('6e000000-0000-0000-0000-0000000004d2', :'R4', '10/2026', '2026-10-02', 'NOVEMBER', 'N-1', '24NOVEM0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'INELIGIBLE'),
  ('6e000000-0000-0000-0000-0000000004d3', :'R4', '10/2026', '2026-10-03', 'OSCAR', 'OS-1', '24OSCAR0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'RECLAIM'),
  ('6e000000-0000-0000-0000-0000000004d4', :'R4', '10/2026', '2026-10-04', 'PAPA', 'P-1', '24PAPAA0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'INELIGIBLE'),
  ('6e000000-0000-0000-0000-0000000004d5', :'R4', '10/2026', '2026-10-05', 'QUEBEC', 'Q-1', '24QUEBE0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month, reclaimed_via_doc_id, is_carried_forward) VALUES
  ('6e000000-0000-0000-0000-0000000002e0', :'R2', '10/2026', '2026-09-01', 'KILO', 'K-0', '24KILOO0000A1Z5', 1000, 0, 90, 90, 'Sep 26', 'Oct 26',
   '6e000000-0000-0000-0000-0000000002d1', true);
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('6e000000-0000-0000-0000-0000000004e1', :'R4', '10/2026', '2026-10-01', 'MIKE', 'M-1', '24MIKEE0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false),
  ('6e000000-0000-0000-0000-0000000004e3', :'R4', '10/2026', '2026-10-03', 'OSCAR', 'OS-1', '24OSCAR0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false),
  ('6e000000-0000-0000-0000-0000000004e5', :'R4', '10/2026', '2026-10-05', 'QUEBEC', 'Q-1', '24QUEBE0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false);
SELECT set_config('twob.write', '', false);
-- R4: a reclaim recorded before these rules against P-1, since made
-- Ineligible (live has one such, in a filed month).
ALTER TABLE public.bills_not_in_2b DISABLE TRIGGER USER;
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month, reclaimed_via_doc_id, is_carried_forward) VALUES
  ('6e000000-0000-0000-0000-0000000004e4', :'R4', '10/2026', '2026-10-04', 'PAPA', 'P-1', '24PAPAA0000A1Z5', 1000, 0, 90, 90, 'Oct 26', 'Oct 26',
   '6e000000-0000-0000-0000-0000000004d4', false);
ALTER TABLE public.bills_not_in_2b ENABLE TRIGGER USER;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);

-- ---------------------------------------------------------------------------
-- H1. Restore and a reclaim's document.
-- ---------------------------------------------------------------------------
-- (a) A-1 reclaimed with its document; the month as a version holds it; the
-- document then taken out of Reclaim (back to Matched); the superadmin
-- restores that version.
SELECT public.t6_eq(public.twob_import2b_reclaim(public.t_poster(), :'R1', '10/2026', '6e000000-0000-0000-0000-0000000001e1',
  '6e000000-0000-0000-0000-0000000001d1', 'MATCHED') ->> 'ok', 'true', 'H1: the poster reclaims A-1 with its document (Pending items)');
SELECT jsonb_agg(to_jsonb(t) - 'adopted_from') AS v1 FROM public.bills_not_in_2b t WHERE t.client_id = :'R1' AND t.period_month = '10/2026' \gset
SELECT public.t6_eq(public.twob_import2b_unreclaim(public.t_poster(), :'R1', '10/2026', '6e000000-0000-0000-0000-0000000001d1', 'MATCHED',
  '6e000000-0000-0000-0000-0000000001e1') ->> 'ok', 'true', 'H1: ... then takes the document out of Reclaim (Matched), the entry back in Awaiting reclaim');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'R1', '10/2026', :'v1'::jsonb, '[]'::jsonb) AS h1a \gset
SELECT public.t6_eq((SELECT concat_ws('|', d.itc_action, COALESCE(t.reclaim_month, '-'), COALESCE(t.reclaimed_via_doc_id::text, '-'))
                       FROM public.twob_import_docs d, public.bills_not_in_2b t
                      WHERE d.id = '6e000000-0000-0000-0000-0000000001d1' AND t.client_id = :'R1'),
  'MATCHED|-|-', 'H1: the Restore brings A-1 back in Awaiting reclaim: its document is Matched now');
SELECT public.t6_eq(public.t6_itc(:'R1', 'Oct 26'), '90.00|0.00',
  'H1: ... the document''s ITC counted once (5.1 90, 5.4 none; before: 5.1 90 and 5.4 90)');
SELECT public.t6_eq(COALESCE(:'h1a'::jsonb -> 'reclaims_back' -> 0 ->> 'message', '-'), 'its 2B document is Matched now, not Reclaim',
  'H1: ... and the Restore names it, with why');
-- (b) A version's reclaim against a document a carried entry the month
-- keeps already evidences.
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'R2', '10/2026',
  '[{"id":"6e000000-0000-0000-0000-0000000002e2","date":"2026-10-01","supplier_name":"KILO","supplier_invoice_number":"K-2","supplier_gstin":"24KILOO0000A1Z5","taxable_value":1000,"input_igst":0,"input_cgst":90,"input_sgst":90,"reversal_month":"Oct 26","reclaim_month":"Oct 26","reclaimed_via_doc_id":"6e000000-0000-0000-0000-0000000002d1","is_carried_forward":false}]'::jsonb,
  '[]'::jsonb) AS h1b \gset
SELECT public.t6_eq((SELECT string_agg(concat_ws(':', supplier_invoice_number, COALESCE(reclaim_month, '-'), reclaimed_via_doc_id IS NOT NULL), ',' ORDER BY supplier_invoice_number)
                       FROM public.bills_not_in_2b WHERE client_id = :'R2'),
  'K-0:Oct 26:t,K-2:-:f', 'H1: a version''s reclaim on a document a kept carried entry evidences comes back in Awaiting reclaim');
SELECT public.t6_eq(public.t6_itc(:'R2', 'Oct 26'), '0.00|90.00', 'H1: ... 5.4 counts the one document''s 90 once (before: 180)');
SELECT public.t6_eq(position('already evidences the reclaim of KILO K-0' in COALESCE(:'h1b'::jsonb -> 'reclaims_back' -> 0 ->> 'message', '')) > 0, true,
  'H1: ... named, with the entry it evidences');
-- (c) A version's reclaim whose document is no longer in the month, and one
-- typed on 2B Reconciliation without a document (R3 is Liberal), which comes
-- back as the version holds it. (A Strict client's reclaim with no document
-- comes back in Awaiting reclaim, named, since round 8: test_9n.)
SELECT public.twob_restore_version_linked(public.t_superadmin(), :'R3', '10/2026',
  '[{"id":"6e000000-0000-0000-0000-0000000003e1","date":"2026-10-01","supplier_name":"ROMEO","supplier_invoice_number":"RO-1","supplier_gstin":"24ROMEO0000A1Z5","taxable_value":1000,"input_igst":0,"input_cgst":90,"input_sgst":90,"reversal_month":"Oct 26","reclaim_month":"Oct 26","reclaimed_via_doc_id":"6e000000-0000-0000-0000-0000000003d9","is_carried_forward":false},
    {"id":"6e000000-0000-0000-0000-0000000003e2","date":"2026-10-02","supplier_name":"SIERRA","supplier_invoice_number":"SI-1","supplier_gstin":"24SIERR0000A1Z5","taxable_value":1000,"input_igst":0,"input_cgst":50,"input_sgst":50,"reversal_month":"Sep 26","reclaim_month":"Oct 26","is_carried_forward":false}]'::jsonb,
  '[]'::jsonb) AS h1c \gset
SELECT public.t6_eq((SELECT string_agg(concat_ws(':', supplier_invoice_number, COALESCE(reclaim_month, '-')), ',' ORDER BY supplier_invoice_number)
                       FROM public.bills_not_in_2b WHERE client_id = :'R3'),
  'RO-1:-,SI-1:Oct 26', 'H1: a reclaim whose document is gone comes back Awaiting; one with no document as the version holds it');
SELECT public.t6_eq(COALESCE(:'h1c'::jsonb -> 'reclaims_back' -> 0 ->> 'message', '-'), 'its 2B document is no longer in this month',
  'H1: ... the gone one named, with why');
-- (d) Any writer: an entry names only a Reclaim document.
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t6_raises($q$UPDATE public.bills_not_in_2b SET reclaim_month = 'Oct 26', reclaimed_via_doc_id = '6e000000-0000-0000-0000-0000000004d1'
                            WHERE id = '6e000000-0000-0000-0000-0000000004e1'$q$,
  'is Matched on Import 2B, not Reclaim', 'H1: a direct write reclaiming M-1 with its Matched document is refused (5.1 and 5.4 both)');
SELECT public.t6_raises(format($q$INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, input_cgst,
                                    reversal_month, reclaim_month, reclaimed_via_doc_id)
                                  VALUES ('%s', '10/2026', '2026-10-02', 'NOVEMBER', 'N-1', 90, 'Oct 26', 'Oct 26', '6e000000-0000-0000-0000-0000000004d2')$q$, :'R4'),
  'is Ineligible on Import 2B, not Reclaim', 'H1: ... and an entry added naming an Ineligible document');
SELECT public.t6_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE client_id = :'R4' AND reclaim_month IS NOT NULL AND supplier_name IN ('MIKE', 'NOVEMBER')),
  0, 'H1: ... nothing of either written');
UPDATE public.bills_not_in_2b SET reclaim_month = 'Oct 26', reclaimed_via_doc_id = '6e000000-0000-0000-0000-0000000004d3' WHERE id = '6e000000-0000-0000-0000-0000000004e3';
SELECT public.t6_eq((SELECT reclaimed_via_doc_id::text FROM public.bills_not_in_2b WHERE id = '6e000000-0000-0000-0000-0000000004e3'),
  '6e000000-0000-0000-0000-0000000004d3', 'H1: naming a Reclaim document no other entry names goes through');
SELECT public.t6_eq(public.twob_import2b_reclaim(public.t_poster(), :'R4', '10/2026', '6e000000-0000-0000-0000-0000000004e5',
  '6e000000-0000-0000-0000-0000000004d5', 'MATCHED') ->> 'ok', 'true', 'H1: Import 2B''s reclaim (one call: the document made Reclaim, then named) goes through');
SELECT public.t6_eq((SELECT concat_ws('|', d.itc_action, t.reclaim_month, t.reclaimed_via_doc_id = d.id)
                       FROM public.twob_import_docs d JOIN public.bills_not_in_2b t ON t.id = '6e000000-0000-0000-0000-0000000004e5'
                      WHERE d.id = '6e000000-0000-0000-0000-0000000004d5'), 'RECLAIM|Oct 26|t', 'H1: ... the entry and the document together');
-- A reclaim recorded before against P-1, now Ineligible: P-1 can only be
-- made Reclaim again (as Matched its ITC would count in 5.1 and 5.4).
SELECT public.t6_raises($q$UPDATE public.twob_import_docs SET itc_action = 'MATCHED' WHERE id = '6e000000-0000-0000-0000-0000000004d4'$q$,
  'it can only be made Reclaim again', 'H1: a document a reclaim recorded before names while Ineligible is not made Matched');
UPDATE public.twob_import_docs SET itc_action = 'RECLAIM' WHERE id = '6e000000-0000-0000-0000-0000000004d4';
SELECT public.t6_eq((SELECT itc_action FROM public.twob_import_docs WHERE id = '6e000000-0000-0000-0000-0000000004d4'), 'RECLAIM',
  'H1: ... it can be made Reclaim again');

-- ---------------------------------------------------------------------------
-- H2. One reclaim per document where the unique index cannot be made (live).
-- ---------------------------------------------------------------------------
RESET ROLE;
DROP INDEX IF EXISTS public.bills_not_in_2b_reclaimed_via_uq;
CREATE INDEX IF NOT EXISTS idx_bills_not_in_2b_reclaimed_via_doc_id
  ON public.bills_not_in_2b (reclaimed_via_doc_id) WHERE reclaimed_via_doc_id IS NOT NULL;
-- G: Jul-26 filed, one document the evidence of two reclaims (recorded
-- before; GROWQ's REDEL 25 on live). O: Oct-26 open, two entries awaiting a
-- reclaim and the one document both match (Matched).
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action) VALUES
  ('6e000000-0000-0000-0000-0000000007d1', :'G', '07/2026', '2026-06-02', 'REDEL', '25', '24REDEL0000A1Z5', 15000, 0, 1350, 1350, 'INVOICE', 'RECLAIM'),
  ('6e000000-0000-0000-0000-0000000008d1', :'O', '10/2026', '2026-09-01', 'ACME', 'S-1', '24ACMEE0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('6e000000-0000-0000-0000-0000000008e1', :'O', '10/2026', '2026-09-01', 'ACME', 'S-1', '24ACMEE0000A1Z5', 1000, 0, 90, 90, 'Sep 26', true),
  ('6e000000-0000-0000-0000-0000000008e2', :'O', '10/2026', '2026-09-02', 'ACME', 'S-2', '24ACMEE0000A1Z5', 1000, 0, 90, 90, 'Sep 26', true);
ALTER TABLE public.bills_not_in_2b DISABLE TRIGGER USER;
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month, reclaimed_via_doc_id, is_carried_forward) VALUES
  ('6e000000-0000-0000-0000-0000000007e1', :'G', '07/2026', '2026-05-01', 'REDEL', '5', '24REDEL0000A1Z5', 15000, 0, 1350, 1350, 'May 26', 'Jul 26',
   '6e000000-0000-0000-0000-0000000007d1', true),
  ('6e000000-0000-0000-0000-0000000007e2', :'G', '07/2026', '2026-06-02', 'REDEL', '25', '24REDEL0000A1Z5', 15000, 0, 1350, 1350, 'Jun 26', 'Jul 26',
   '6e000000-0000-0000-0000-0000000007d1', true);
ALTER TABLE public.bills_not_in_2b ENABLE TRIGGER USER;
INSERT INTO public.filing_status (client_id, return_type, period_month, status, filed_date, is_locked)
VALUES (:'G', 'GSTR-3B', '07/2026', 'Filed', '2026-08-20', true);
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
SELECT public.t6_eq((SELECT count(*)::integer FROM pg_indexes WHERE indexname = 'bills_not_in_2b_reclaimed_via_uq'), 0,
  'H2: (as live: no unique index, a pair recorded before stands)');
-- Tab B, the app of before (origin/main recordReclaim): the entry first,
-- naming the Matched document, then the document.
SELECT public.t6_raises($q$UPDATE public.bills_not_in_2b SET reclaim_month = 'Oct 26', reclaim_subtype = NULL,
                              reclaimed_via_doc_id = '6e000000-0000-0000-0000-0000000008d1'
                            WHERE id = '6e000000-0000-0000-0000-0000000008e1'$q$,
  'is Matched on Import 2B, not Reclaim', 'H2: the app of before''s reclaim (the entry before its document) is refused, nothing written');
-- This app's reclaim of S-1 with the document (one call).
SELECT public.t6_eq(public.twob_import2b_reclaim(public.t_poster(), :'O', '10/2026', '6e000000-0000-0000-0000-0000000008e1',
  '6e000000-0000-0000-0000-0000000008d1', 'MATCHED') ->> 'ok', 'true', 'H2: tab B reclaims S-1 with document S-1');
-- Tab A, the app of before, not reloaded: S-2 with the same document.
SELECT public.t6_raises($q$UPDATE public.bills_not_in_2b SET reclaim_month = 'Oct 26', reclaim_subtype = NULL,
                              reclaimed_via_doc_id = '6e000000-0000-0000-0000-0000000008d1'
                            WHERE id = '6e000000-0000-0000-0000-0000000008e2'$q$,
  'is already the evidence of the reclaim of ACME S-1', 'H2: tab A''s stale reclaim of S-2 with the same document is refused without the index');
UPDATE public.twob_import_docs SET itc_action = 'RECLAIM' WHERE id = '6e000000-0000-0000-0000-0000000008d1';
SELECT public.t6_eq(concat_ws('|', (SELECT count(*) FROM public.bills_not_in_2b WHERE reclaimed_via_doc_id = '6e000000-0000-0000-0000-0000000008d1'),
                              public.t6_itc(:'O', 'Oct 26')),
  '1|0.00|90.00', 'H2: ... one entry reclaimed with it: 5.4 CGST 90 on the document''s 90 (before: 2 entries, 180)');
-- A direct insert of a second one, and a direct write naming the pair's document again, are refused too.
SELECT public.t6_raises(format($q$INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, input_cgst,
                                    reversal_month, reclaim_month, reclaimed_via_doc_id)
                                  VALUES ('%s', '10/2026', '2026-09-03', 'ACME', 'S-3', 90, 'Sep 26', 'Oct 26', '6e000000-0000-0000-0000-0000000008d1')$q$, :'O'),
  'is already the evidence of the reclaim of ACME S-1', 'H2: an entry added naming it is refused');
-- The pair recorded before is left as it is (Jul-26 filed; the firm decides).
SELECT public.t6_eq((SELECT count(*)::integer FROM public.bills_not_in_2b WHERE reclaimed_via_doc_id = '6e000000-0000-0000-0000-0000000007d1'), 2,
  'H2: the filed month''s pair recorded before is left as it is');

-- Tidy up: the unique index back for the files that follow (G and O go:
-- on the code of before, O holds two reclaims with one document).
RESET ROLE;
DELETE FROM public.clients WHERE id IN (:'G', :'O');
CREATE UNIQUE INDEX IF NOT EXISTS bills_not_in_2b_reclaimed_via_uq
  ON public.bills_not_in_2b (reclaimed_via_doc_id) WHERE reclaimed_via_doc_id IS NOT NULL;
DROP INDEX IF EXISTS public.idx_bills_not_in_2b_reclaimed_via_doc_id;

DO $$
DECLARE
  v text;
  v_ok integer;
  v_all integer;
BEGIN
  SELECT count(*) FILTER (WHERE r.ok), count(*) INTO v_ok, v_all FROM public.t6_results r;
  SELECT string_agg(format('FAILED %s: %s', r.label, r.info), E'\n' ORDER BY r.n) INTO v FROM public.t6_results r WHERE NOT r.ok;
  RAISE NOTICE 'checks: round6 (SQL) % of % passed', v_ok, v_all;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION E'round6 (SQL): % of % checks passed\n%', v_ok, v_all, v;
  END IF;
END $$;
DROP TABLE public.t6_results;
