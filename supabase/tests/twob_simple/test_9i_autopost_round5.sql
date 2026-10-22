-- Import 2B without Post (20261021170000, docs/2B_RECONCILIATION_FLOW.md
-- §15): the fifth verification round's money rules, held by the database
-- whichever screen, tab or app version writes (as PostgREST runs the app's
-- calls: anon, with the request headers; a4 holds Import 2B & post, a2 is a
-- GST Manager, a1 the superadmin):
--   I1 one reclaim per 2B document: a stale tab's second reclaim with a
--      document another user has just reclaimed with is refused, nothing
--      written (before: both counted in 5.4); a reclaim with a document
--      whose treatment changed since the page showed it is refused; the
--      unique index refuses any other writer (round 6: the trigger
--      trg_twob_zz_reclaim_via_one, first, and where the index cannot be
--      made); Restore of a version holding two reclaims on one document keeps
--      one, the other back in Awaiting reclaim (round 6);
--   I2 a document leaves Reclaim, or is deleted, only with its reclaim
--      released in the same transaction (twob_import2b_unreclaim, Delete 2B):
--      a stale page's Save, a bulk change and a re-import's delete are
--      refused (before: the document counted in 5.1 and its reclaim in 5.4,
--      or the reclaim stayed counted with no document); out of Reclaim
--      refuses a document no longer Reclaim; an entry no longer reclaimed
--      (2B Reconciliation's Clear or Expense out) lets its document go; a
--      client being deleted takes both;
--   I3 a books row is saved only while it holds what the page loaded:
--      twob_import2b_save_book and twob_import2b_prior_save (preview and
--      save) refuse a row changed elsewhere since (p_expect), nothing saved.
-- Each check is recorded (t5_results) and the file fails, naming every
-- failed check, at the end: run against the code of before this round (the
-- calls go through t5_* wrappers that use the signature the database has),
-- each check fails or passes on its own. Fictional.
\set R  '5e000000-0000-0000-0000-0000000000c1'
\set R2 '5e000000-0000-0000-0000-0000000000c2'
\set R3 '5e000000-0000-0000-0000-0000000000c3'
\set P5 '5e000000-0000-0000-0000-0000000000c5'
\set R6 '5e000000-0000-0000-0000-0000000000c6'

CREATE TABLE public.t5_results (n serial PRIMARY KEY, label text NOT NULL, ok boolean NOT NULL, info text);
GRANT ALL ON public.t5_results TO anon;
GRANT USAGE ON SEQUENCE public.t5_results_n_seq TO anon;
CREATE FUNCTION public.t5_eq(p_actual anyelement, p_expected anyelement, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.t5_results (label, ok, info)
  VALUES (p_label, p_actual IS NOT DISTINCT FROM p_expected, format('expected [%s], got [%s]', p_expected, p_actual));
END $$;
CREATE FUNCTION public.t5_raises(p_sql text, p_like text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.t5_results (label, ok, info)
    VALUES (p_label, position(p_like in SQLERRM) > 0, format('raised [%s], expected it to mention [%s]', SQLERRM, p_like));
    RETURN;
  END;
  INSERT INTO public.t5_results (label, ok, info) VALUES (p_label, false, 'did not raise');
END $$;
-- The calls, in the signature the database has (this round added the
-- expectations; the code of before ignores them).
CREATE FUNCTION public.t5_reclaim(a uuid, c uuid, p text, e uuid, d uuid, x text) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF to_regprocedure('public.twob_import2b_reclaim(uuid, uuid, text, uuid, uuid, text)') IS NOT NULL THEN
    RETURN public.twob_import2b_reclaim(a, c, p, e, d, x);
  END IF;
  RETURN public.twob_import2b_reclaim(a, c, p, e, d);
END $$;
CREATE FUNCTION public.t5_save_book(a uuid, b uuid, v jsonb, x jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF to_regprocedure('public.twob_import2b_save_book(uuid, uuid, jsonb, uuid, uuid, jsonb)') IS NOT NULL THEN
    RETURN public.twob_import2b_save_book(a, b, v, NULL, NULL, x);
  END IF;
  RETURN public.twob_import2b_save_book(a, b, v, NULL, NULL);
END $$;
CREATE FUNCTION public.t5_prior_save(a uuid, c uuid, p text, ch jsonb, dry boolean, x jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF to_regprocedure('public.twob_import2b_prior_save(uuid, uuid, text, jsonb, boolean, boolean, text, jsonb)') IS NOT NULL THEN
    RETURN public.twob_import2b_prior_save(a, c, p, ch, dry, false, NULL, x);
  END IF;
  RETURN public.twob_import2b_prior_save(a, c, p, ch, dry, false, NULL);
END $$;
GRANT EXECUTE ON FUNCTION public.t5_eq(anyelement, anyelement, text), public.t5_raises(text, text, text),
  public.t5_reclaim(uuid, uuid, text, uuid, uuid, text), public.t5_save_book(uuid, uuid, jsonb, jsonb),
  public.t5_prior_save(uuid, uuid, text, jsonb, boolean, jsonb) TO anon;

-- Oct-26 open. R: five pending Not in 2B entries of the month's own and the
-- 2B documents that can evidence their reclaim (Matched), and Z-1, Reclaim
-- with no entry reclaimed against it (an app of before's leftover).
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES
  (:'R', 'R5 RECLAIMS', '24RFIVE0000A1Z5'), (:'R2', 'R5 DELETE 2B', '24RFIVF0000A1Z5'),
  (:'R3', 'R5 CLIENT GONE', '24RFIVG0000A1Z5'), (:'P5', 'R5 FILED BOOKS', '24RFIVH0000A1Z5'),
  (:'R6', 'R5 RESTORE', '24RFIVI0000A1Z5');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('5e000000-0000-0000-0000-0000000000e1', :'R', '10/2026', '2026-10-01', 'ALPHA', 'A-1', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false),
  ('5e000000-0000-0000-0000-0000000000e2', :'R', '10/2026', '2026-10-02', 'BETA', 'B-1', '24BETAS0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false),
  ('5e000000-0000-0000-0000-0000000000e3', :'R', '10/2026', '2026-10-03', 'GAMMA', 'G-1', '24GAMMA0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false),
  ('5e000000-0000-0000-0000-0000000000e4', :'R', '10/2026', '2026-10-04', 'DELTA', 'D-1', '24DELTA0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false),
  ('5e000000-0000-0000-0000-0000000000e5', :'R', '10/2026', '2026-10-05', 'EPSILON', 'E-1', '24EPSIL0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false),
  ('5e000000-0000-0000-0000-0000000000f1', :'R2', '10/2026', '2026-10-01', 'FOXTROT', 'F-1', '24FOXTR0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false);
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action) VALUES
  ('5e000000-0000-0000-0000-0000000000d1', :'R', '10/2026', '2026-10-01', 'ALPHA', 'A-1', '24ALPHA0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  ('5e000000-0000-0000-0000-0000000000d2', :'R', '10/2026', '2026-10-02', 'BETA', 'B-1', '24BETAS0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  ('5e000000-0000-0000-0000-0000000000d3', :'R', '10/2026', '2026-10-03', 'GAMMA', 'G-1', '24GAMMA0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  ('5e000000-0000-0000-0000-0000000000d4', :'R', '10/2026', '2026-10-04', 'DELTA', 'D-1', '24DELTA0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  ('5e000000-0000-0000-0000-0000000000d5', :'R', '10/2026', '2026-10-05', 'EPSILON', 'E-1', '24EPSIL0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  ('5e000000-0000-0000-0000-0000000000d6', :'R', '10/2026', '2026-10-06', 'ZETA', 'Z-1', '24ZETAS0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'RECLAIM'),
  ('5e000000-0000-0000-0000-0000000000a1', :'R2', '10/2026', '2026-10-01', 'FOXTROT', 'F-1', '24FOXTR0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED'),
  ('5e000000-0000-0000-0000-0000000000a3', :'R3', '10/2026', '2026-10-01', 'HOTEL', 'H-1', '24HOTEL0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'RECLAIM'),
  ('5e000000-0000-0000-0000-0000000000a6', :'R6', '10/2026', '2026-10-01', 'JULIET', 'J-1', '24JULIE0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'RECLAIM');
-- R3: an entry reclaimed against H-1 (the client is deleted below).
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month, reclaimed_via_doc_id, is_carried_forward) VALUES
  ('5e000000-0000-0000-0000-0000000000b3', :'R3', '10/2026', '2026-10-01', 'HOTEL', 'H-1', '24HOTEL0000A1Z5', 1000, 0, 90, 90, 'Oct 26', 'Oct 26',
   '5e000000-0000-0000-0000-0000000000a3', false);
-- P5: Jul-26 filed, a Not Eligible books row (posts nothing) to correct there.
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, book_treatment, doc_type) VALUES
  ('5e000000-0000-0000-0000-0000000000b5', :'P5', '07/2026', '2026-07-05', 'PRIOR ONE', 'PR-1', '24PRION0000A1Z5', 1000, 0, 100, 100, 'NOT_ELIGIBLE', 'INVOICE');
INSERT INTO public.filing_status (client_id, return_type, period_month, status, filed_date, is_locked)
VALUES (:'P5', 'GSTR-3B', '07/2026', 'Filed', '2026-08-20', true);
SELECT set_config('twob.write', '', false);

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);

-- ---------------------------------------------------------------------------
-- I1. One reclaim per 2B document.
-- ---------------------------------------------------------------------------
SELECT public.t5_eq(public.t5_reclaim(public.t_poster(), :'R', '10/2026', '5e000000-0000-0000-0000-0000000000e1',
  '5e000000-0000-0000-0000-0000000000d1', 'MATCHED') ->> 'ok', 'true', 'I1: tab B reclaims ALPHA A-1 with document A-1 (shown Matched)');
-- Tab A, not reloaded, still shows A-1 Matched, and reclaims BETA B-1 with it.
SELECT public.t5_reclaim(public.t_poster(), :'R', '10/2026', '5e000000-0000-0000-0000-0000000000e2',
  '5e000000-0000-0000-0000-0000000000d1', 'MATCHED') AS i1b \gset
SELECT public.t5_eq(:'i1b'::jsonb ->> 'ok', 'false', 'I1: tab A''s stale reclaim with the same document is refused');
SELECT public.t5_eq(position('it is Reclaim now, not Matched' in COALESCE(:'i1b'::jsonb ->> 'message', '')) > 0, true,
  'I1: ... saying the document changed elsewhere (Reclaim now, not Matched)');
SELECT public.t5_eq((SELECT concat_ws('|', (SELECT count(*) FROM public.bills_not_in_2b WHERE reclaimed_via_doc_id = '5e000000-0000-0000-0000-0000000000d1'),
                                      COALESCE(reclaim_month, '-'))
                       FROM public.bills_not_in_2b WHERE id = '5e000000-0000-0000-0000-0000000000e2'),
  '1|-', 'I1: ... one entry reclaimed with A-1 (its ITC once in 5.4), BETA B-1 still awaiting');
SELECT public.t5_eq(position('already the evidence of the reclaim of ALPHA A-1' in COALESCE(public.t5_reclaim(public.t_poster(), :'R', '10/2026',
  '5e000000-0000-0000-0000-0000000000e2', '5e000000-0000-0000-0000-0000000000d1', 'RECLAIM') ->> 'message', '')) > 0, true,
  'I1: a second reclaim with a document that evidences one is refused whatever the page showed');
-- Another user makes B-1 Ineligible; a tab still showing it Matched reclaims with it.
UPDATE public.twob_import_docs SET itc_action = 'INELIGIBLE' WHERE id = '5e000000-0000-0000-0000-0000000000d2';
SELECT public.t5_reclaim(public.t_poster(), :'R', '10/2026', '5e000000-0000-0000-0000-0000000000e2',
  '5e000000-0000-0000-0000-0000000000d2', 'MATCHED') AS i1c \gset
SELECT public.t5_eq(concat_ws('|', :'i1c'::jsonb ->> 'ok', position('it is Ineligible now, not Matched' in COALESCE(:'i1c'::jsonb ->> 'message', '')) > 0,
                              (SELECT itc_action FROM public.twob_import_docs WHERE id = '5e000000-0000-0000-0000-0000000000d2'),
                              (SELECT COALESCE(reclaim_month, '-') FROM public.bills_not_in_2b WHERE id = '5e000000-0000-0000-0000-0000000000e2')),
  'false|t|INELIGIBLE|-', 'I1: a reclaim with a document whose treatment changed since the page showed it is refused; the Ineligible stays');
-- (Round 6: refused first by trg_twob_zz_reclaim_via_one, which holds on
-- live too, where the unique index cannot be created.)
SELECT public.t5_raises($q$UPDATE public.bills_not_in_2b SET reclaim_month = 'Oct 26', reclaimed_via_doc_id = '5e000000-0000-0000-0000-0000000000d1'
                            WHERE id = '5e000000-0000-0000-0000-0000000000e3'$q$,
  'is already the evidence of the reclaim of ALPHA A-1', 'I1: any other writer naming a document a second entry already names is refused');
SELECT public.t5_raises(format($q$SELECT public.twob_import2b_reclaim(public.t_poster(), '%s', '10/2026', '5e000000-0000-0000-0000-0000000000e3',
                                  '5e000000-0000-0000-0000-0000000000d3', NULL)$q$, :'R'),
  'Say which treatment the page showed', 'I1: a reclaim must say the treatment the page showed');

-- ---------------------------------------------------------------------------
-- I2. A document leaves Reclaim only with its reclaim.
-- ---------------------------------------------------------------------------
SELECT public.t5_raises($q$UPDATE public.twob_import_docs SET itc_action = 'MISMATCHED' WHERE id = '5e000000-0000-0000-0000-0000000000d1'$q$,
  'is the evidence of the reclaim of ALPHA A-1', 'I2: a stale tab''s Save making the reclaimed A-1 Mismatched is refused');
SELECT public.t5_eq((SELECT concat_ws('|', d.itc_action, t.reclaim_month, t.reclaimed_via_doc_id = d.id)
                       FROM public.twob_import_docs d JOIN public.bills_not_in_2b t ON t.id = '5e000000-0000-0000-0000-0000000000e1'
                      WHERE d.id = '5e000000-0000-0000-0000-0000000000d1'),
  'RECLAIM|Oct 26|t', 'I2: ... A-1 stays Reclaim with its reclaim (counted in 5.4 only, not again in 5.1)');
SELECT public.t5_raises($q$UPDATE public.twob_import_docs SET itc_action = 'MATCHED'
                            WHERE id IN ('5e000000-0000-0000-0000-0000000000d1', '5e000000-0000-0000-0000-0000000000d3')$q$,
  'is the evidence of the reclaim', 'I2: a bulk change over it is refused');
SELECT public.t5_eq((SELECT itc_action FROM public.twob_import_docs WHERE id = '5e000000-0000-0000-0000-0000000000d1'), 'RECLAIM',
  'I2: ... nothing of the bulk change is kept');
SELECT public.t5_raises($q$DELETE FROM public.twob_import_docs WHERE id = '5e000000-0000-0000-0000-0000000000d1'$q$,
  'Not deleted: ALPHA A-1 is the evidence of the reclaim of ALPHA A-1', 'I2: deleting it (a re-import''s stale delete) is refused');
SELECT public.t5_eq((SELECT reclaimed_via_doc_id::text FROM public.bills_not_in_2b WHERE id = '5e000000-0000-0000-0000-0000000000e1'),
  '5e000000-0000-0000-0000-0000000000d1', 'I2: ... the reclaim keeps its document');
SELECT public.t5_eq(public.twob_import2b_unreclaim(public.t_poster(), :'R', '10/2026', '5e000000-0000-0000-0000-0000000000d1', 'MATCHED', '5e000000-0000-0000-0000-0000000000e1') ->> 'ok',
  'true', 'I2: out of Reclaim through Import 2B''s Save (twob_import2b_unreclaim) goes through');
SELECT public.t5_eq((SELECT concat_ws('|', d.itc_action, COALESCE(t.reclaim_month, '-'), COALESCE(t.reclaimed_via_doc_id::text, '-'))
                       FROM public.twob_import_docs d JOIN public.bills_not_in_2b t ON t.id = '5e000000-0000-0000-0000-0000000000e1'
                      WHERE d.id = '5e000000-0000-0000-0000-0000000000d1'),
  'MATCHED|-|-', 'I2: ... the entry back in Awaiting reclaim, the document Matched, together');
-- Another user then makes A-1 Ineligible; a tab still showing it Reclaim takes it out of Reclaim.
UPDATE public.twob_import_docs SET itc_action = 'INELIGIBLE' WHERE id = '5e000000-0000-0000-0000-0000000000d1';
SELECT public.twob_import2b_unreclaim(public.t_poster(), :'R', '10/2026', '5e000000-0000-0000-0000-0000000000d1', 'MATCHED', '5e000000-0000-0000-0000-0000000000e1') AS i2u \gset
SELECT public.t5_eq(concat_ws('|', :'i2u'::jsonb ->> 'ok', position('it is Ineligible now, not Reclaim' in COALESCE(:'i2u'::jsonb ->> 'message', '')) > 0,
                              (SELECT itc_action FROM public.twob_import_docs WHERE id = '5e000000-0000-0000-0000-0000000000d1')),
  'false|t|INELIGIBLE', 'I2: out of Reclaim for a document no longer Reclaim is refused; the Ineligible stays');
UPDATE public.twob_import_docs SET itc_action = 'MATCHED' WHERE id = '5e000000-0000-0000-0000-0000000000d6';
SELECT public.t5_eq((SELECT itc_action FROM public.twob_import_docs WHERE id = '5e000000-0000-0000-0000-0000000000d6'), 'MATCHED',
  'I2: a Reclaim document no entry is reclaimed against changes as before');
-- 2B Reconciliation's Reclaim cell cleared, and made an Expense out: the
-- entry no longer names the document, which then changes as any other.
SELECT public.t5_reclaim(public.t_poster(), :'R', '10/2026', '5e000000-0000-0000-0000-0000000000e4', '5e000000-0000-0000-0000-0000000000d4', 'MATCHED');
SELECT public.t5_reclaim(public.t_poster(), :'R', '10/2026', '5e000000-0000-0000-0000-0000000000e5', '5e000000-0000-0000-0000-0000000000d5', 'MATCHED');
UPDATE public.bills_not_in_2b SET reclaim_month = NULL, reclaim_subtype = NULL WHERE id = '5e000000-0000-0000-0000-0000000000e4';
UPDATE public.bills_not_in_2b SET reclaim_subtype = 'EXPENSE_OUT' WHERE id = '5e000000-0000-0000-0000-0000000000e5';
SELECT public.t5_eq((SELECT string_agg(concat_ws('|', supplier_invoice_number, COALESCE(reclaim_month, '-'), COALESCE(reclaim_subtype, '-'),
                                                 COALESCE(reclaimed_via_doc_id::text, '-')), ',' ORDER BY id)
                       FROM public.bills_not_in_2b WHERE id IN ('5e000000-0000-0000-0000-0000000000e4', '5e000000-0000-0000-0000-0000000000e5')),
  'D-1|-|-|-,E-1|Oct 26|EXPENSE_OUT|-', 'I2: a reclaim cleared or made an Expense out (2B Reconciliation) lets its document go');
UPDATE public.twob_import_docs SET itc_action = 'MATCHED' WHERE id = '5e000000-0000-0000-0000-0000000000d4';
SELECT public.t5_eq((SELECT itc_action FROM public.twob_import_docs WHERE id = '5e000000-0000-0000-0000-0000000000d4'), 'MATCHED',
  'I2: ... and that document changes as any other (nothing reclaimed against it)');
-- Delete 2B releases the month's reclaims first, then deletes.
SELECT public.t5_reclaim(public.t_poster(), :'R2', '10/2026', '5e000000-0000-0000-0000-0000000000f1', '5e000000-0000-0000-0000-0000000000a1', 'MATCHED');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a2","x-gst-source":"app"}', false);
SELECT public.t5_eq(public.twob_import2b_delete_2b(public.t_manager(), :'R2', '10/2026') ->> 'reclaims_released', '1',
  'I2: Delete 2B goes through, the reclaim released with it');
SELECT public.t5_eq((SELECT concat_ws('|', (SELECT count(*) FROM public.twob_import_docs WHERE client_id = :'R2'), COALESCE(reclaim_month, '-'))
                       FROM public.bills_not_in_2b WHERE id = '5e000000-0000-0000-0000-0000000000f1'),
  '0|-', 'I2: ... the documents gone, the entry back in Awaiting reclaim');
RESET ROLE;
DELETE FROM public.clients WHERE id = :'R3';
SET ROLE anon;
SELECT public.t5_eq((SELECT count(*)::integer FROM public.twob_import_docs WHERE client_id = :'R3'), 0,
  'I2: a client deleted takes its documents and reclaims with it');
-- Restore of a version holding two reclaims on one document (taken while
-- the double reclaim stood): one kept.
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.t5_eq(public.twob_restore_version_linked(public.t_superadmin(), :'R6', '10/2026',
  '[{"id":"5e000000-0000-0000-0000-0000000000a7","date":"2026-10-01","supplier_name":"JULIET","supplier_invoice_number":"J-1","supplier_gstin":"24JULIE0000A1Z5","taxable_value":1000,"input_igst":0,"input_cgst":90,"input_sgst":90,"reversal_month":"Oct 26","reclaim_month":"Oct 26","reclaimed_via_doc_id":"5e000000-0000-0000-0000-0000000000a6","is_carried_forward":false},
    {"id":"5e000000-0000-0000-0000-0000000000a8","date":"2026-10-01","supplier_name":"JULIET","supplier_invoice_number":"J-0","supplier_gstin":"24JULIE0000A1Z5","taxable_value":1000,"input_igst":0,"input_cgst":90,"input_sgst":90,"reversal_month":"Oct 26","reclaim_month":"Oct 26","reclaimed_via_doc_id":"5e000000-0000-0000-0000-0000000000a6","is_carried_forward":false}]'::jsonb,
  '[]'::jsonb) IS NOT NULL, true, 'I1: Restore of a version with two reclaims on one document is not refused');
SELECT public.t5_eq((SELECT string_agg(concat_ws(':', supplier_invoice_number, COALESCE(reclaimed_via_doc_id::text, '-')), ',' ORDER BY supplier_invoice_number DESC)
                       FROM public.bills_not_in_2b WHERE client_id = :'R6'),
  'J-1:5e000000-0000-0000-0000-0000000000a6,J-0:-', 'I1: ... the document names one reclaim (the version''s first); the other is restored without it');
-- Round 6: and the other comes back Awaiting reclaim, so 5.4 counts the one
-- document's ITC once (round 5 dropped only the link: 5.4 counted 180 on 90).
SELECT public.t5_eq((SELECT string_agg(concat_ws(':', supplier_invoice_number, COALESCE(reclaim_month, '-')), ',' ORDER BY supplier_invoice_number DESC)
                       FROM public.bills_not_in_2b WHERE client_id = :'R6'),
  'J-1:Oct 26,J-0:-', 'I1: ... the other is restored in Awaiting reclaim (round 6)');
SELECT public.t5_eq((SELECT sum(input_cgst)::numeric(12,2) FROM public.bills_not_in_2b WHERE client_id = :'R6' AND reclaim_month = 'Oct 26' AND reclaim_subtype IS NULL),
  90.00::numeric(12,2), 'I1: ... 5.4 CGST for Oct 26 is the one document''s 90 (round 6)');

-- ---------------------------------------------------------------------------
-- I3. A books row is saved only while it holds what the page loaded.
-- ---------------------------------------------------------------------------
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4","x-gst-source":"app"}', false);
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, book_treatment, doc_type, updated_by)
VALUES ('5e000000-0000-0000-0000-0000000000b1', :'R', '10/2026', '2026-10-09', 'BOOKS ONE', 'BK-1', '24BOOKS0000A1Z5', 1000, 0, 90, 90,
        'NOT_IN_2B', 'INVOICE', public.t_poster());
-- Tab B loads the row; tab A makes it Not Eligible (its reversal leaves the ledger).
SELECT jsonb_build_object('date', date, 'supplier_name', supplier_name, 'supplier_invoice_number', supplier_invoice_number,
         'supplier_gstin', supplier_gstin, 'taxable_value', taxable_value, 'input_igst', input_igst, 'input_cgst', input_cgst,
         'input_sgst', input_sgst, 'doc_type', doc_type, 'book_treatment', book_treatment, 'matched_2b_id', matched_2b_id) AS bexp
  FROM public.books_register WHERE id = '5e000000-0000-0000-0000-0000000000b1' \gset
UPDATE public.books_register SET book_treatment = 'NOT_ELIGIBLE' WHERE id = '5e000000-0000-0000-0000-0000000000b1';
SELECT public.t5_raises(format($q$SELECT public.t5_save_book(public.t_poster(), '5e000000-0000-0000-0000-0000000000b1',
  '{"supplier_name":"BOOKS ONE LTD"}'::jsonb, '%s'::jsonb)$q$, :'bexp'),
  'books row BOOKS ONE BK-1 was changed elsewhere since this page loaded it', 'I3: tab B''s save of the row it loaded before is refused (twob_import2b_save_book)');
SELECT public.t5_eq((SELECT concat_ws('|', supplier_name, book_treatment,
                                      (SELECT count(*) FROM public.bills_not_in_2b t WHERE t.source_book_id = b.id))
                       FROM public.books_register b WHERE b.id = '5e000000-0000-0000-0000-0000000000b1'),
  'BOOKS ONE|NOT_ELIGIBLE|0', 'I3: ... nothing saved: tab A''s Not Eligible stands, the reversal stays off the ledger');
SELECT jsonb_build_object('date', date, 'supplier_name', supplier_name, 'supplier_invoice_number', supplier_invoice_number,
         'supplier_gstin', supplier_gstin, 'taxable_value', taxable_value, 'input_igst', input_igst, 'input_cgst', input_cgst,
         'input_sgst', input_sgst, 'doc_type', doc_type, 'book_treatment', book_treatment, 'matched_2b_id', matched_2b_id) AS bexp
  FROM public.books_register WHERE id = '5e000000-0000-0000-0000-0000000000b1' \gset
SELECT public.t5_eq(public.t5_save_book(public.t_poster(), '5e000000-0000-0000-0000-0000000000b1',
  '{"supplier_name":"BOOKS ONE LTD"}'::jsonb, :'bexp'::jsonb) -> 'row' ->> 'supplier_name', 'BOOKS ONE LTD',
  'I3: reloaded, the save goes through and returns the row as saved');
-- A filed month: the GST Manager corrects PR-1 through the door while a
-- superadmin's tab still shows it as it was; that tab's save is refused.
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a2","x-gst-source":"app"}', false);
SELECT jsonb_build_object('5e000000-0000-0000-0000-0000000000b5', jsonb_build_object('date', date, 'supplier_name', supplier_name,
         'supplier_invoice_number', supplier_invoice_number, 'supplier_gstin', supplier_gstin, 'taxable_value', taxable_value,
         'input_igst', input_igst, 'input_cgst', input_cgst, 'input_sgst', input_sgst, 'doc_type', doc_type,
         'book_treatment', book_treatment, 'matched_2b_id', matched_2b_id)) AS pexp
  FROM public.books_register WHERE id = '5e000000-0000-0000-0000-0000000000b5' \gset
SELECT public.t5_eq(public.t5_prior_save(public.t_manager(), :'P5', '07/2026',
  '[{"table":"books_register","op":"update","id":"5e000000-0000-0000-0000-0000000000b5","values":{"input_cgst":90,"input_sgst":90}}]'::jsonb, false, NULL) ->> 'ok',
  'true', 'I3: the GST Manager corrects PR-1''s tax in filed Jul-26');
SELECT set_config('request.headers', '{"x-gst-actor":"00000000-0000-0000-0000-0000000000a1","x-gst-source":"app"}', false);
SELECT public.t5_raises(format($q$SELECT public.t5_prior_save(public.t_superadmin(), '%s', '07/2026',
  '[{"table":"books_register","op":"update","id":"5e000000-0000-0000-0000-0000000000b5","values":{"supplier_gstin":"24PRION0000A1Z9"}}]'::jsonb, true, '%s'::jsonb)$q$,
  :'P5', :'pexp'), 'books row PRIOR ONE PR-1 was changed elsewhere since this page loaded it',
  'I3: the stale tab''s preview of a filed month''s save is refused (twob_import2b_prior_save)');
SELECT public.t5_raises(format($q$SELECT public.t5_prior_save(public.t_superadmin(), '%s', '07/2026',
  '[{"table":"books_register","op":"update","id":"5e000000-0000-0000-0000-0000000000b5","values":{"supplier_gstin":"24PRION0000A1Z9"}}]'::jsonb, false, '%s'::jsonb)$q$,
  :'P5', :'pexp'), 'books row PRIOR ONE PR-1 was changed elsewhere since this page loaded it',
  'I3: ... and its save');
SELECT public.t5_eq((SELECT concat_ws('|', input_cgst::numeric(12,2), input_sgst::numeric(12,2), supplier_gstin) FROM public.books_register WHERE id = '5e000000-0000-0000-0000-0000000000b5'),
  '90.00|90.00|24PRION0000A1Z5', 'I3: ... the GST Manager''s correction of the filed month stands');
SELECT jsonb_build_object('5e000000-0000-0000-0000-0000000000b5', jsonb_build_object('date', date, 'supplier_name', supplier_name,
         'supplier_invoice_number', supplier_invoice_number, 'supplier_gstin', supplier_gstin, 'taxable_value', taxable_value,
         'input_igst', input_igst, 'input_cgst', input_cgst, 'input_sgst', input_sgst, 'doc_type', doc_type,
         'book_treatment', book_treatment, 'matched_2b_id', matched_2b_id)) AS pexp
  FROM public.books_register WHERE id = '5e000000-0000-0000-0000-0000000000b5' \gset
SELECT public.t5_eq(public.t5_prior_save(public.t_superadmin(), :'P5', '07/2026',
  '[{"table":"books_register","op":"update","id":"5e000000-0000-0000-0000-0000000000b5","values":{"supplier_gstin":"24PRION0000A1Z9"}}]'::jsonb, false, :'pexp'::jsonb) ->> 'ok',
  'true', 'I3: reloaded, the superadmin''s save goes through');
SELECT public.t5_eq((SELECT concat_ws('|', input_cgst::numeric(12,2), supplier_gstin) FROM public.books_register WHERE id = '5e000000-0000-0000-0000-0000000000b5'),
  '90.00|24PRION0000A1Z9', 'I3: ... with the GST Manager''s correction kept');

RESET ROLE;
DO $$
DECLARE
  v text;
  v_ok integer;
  v_all integer;
BEGIN
  SELECT count(*) FILTER (WHERE r.ok), count(*) INTO v_ok, v_all FROM public.t5_results r;
  SELECT string_agg(format('FAILED %s: %s', r.label, r.info), E'\n' ORDER BY r.n) INTO v FROM public.t5_results r WHERE NOT r.ok;
  RAISE NOTICE 'checks: round5 (SQL) % of % passed', v_ok, v_all;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION E'round5 (SQL): % of % checks passed\n%', v_ok, v_all, v;
  END IF;
END $$;
DROP TABLE public.t5_results;
