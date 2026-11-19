-- Repair: Import 2B "Not in Books" documents missing from the ledger of a
-- filed month, and so never carried into the later months' 2B Reconciliation.
--
-- Root cause (read on live, 19 Nov 2026). Before 21 Oct 2026 Import 2B wrote
-- the ledger only through its Post button, and the old 2B Reconciliation Save
-- wrote back the whole month from what its tab had loaded. A tab opened before
-- a Post and saved after it put the month back as it was, deleting the posted
-- entries. KWIKTEAM SUPPORT SERVICES 09/2026: Post at 16 Oct 13:03 wrote 13
-- entries (version 3, 295 rows); a Save at 13:37 from a tab loaded earlier
-- wrote 282 (version 4), and the 13 were gone. Other months were never posted
-- at all. 20261021170000 made every Import 2B save write through and guarded
-- 2B Reconciliation's Save, so this cannot happen again, but it posts nothing
-- into a prior (filed) month and its catch-up refuses one, and the Not in
-- Books side of a filed month follows the filed 2B (§13): so nothing ever put
-- these back, and filing carried the short list on, month after month. Its
-- out-of-step map of 21 Oct listed them for the lead (KWIKTEAM 09/2026 +14,
-- NAVRATNA 09/2026 +52, POINT PACKERS +4, ...).
--
-- What this does, for every client: each Not in Books entry Import 2B's own
-- planner (twob__autopost_effective, Post's rules) says a prior month is
-- missing ('insert') is added to that month, linked to its document, and a
-- carried copy of it is added to every later month that holds the client's
-- Not in Books list or was carried into, locked where that month is filed.
-- An entry is left out, and named in a NOTICE, when its invoice number is
-- already anywhere on the client's ledger (either list, any month), in a
-- books register row of that month or later, or in a later month's 2B: a
-- person decides those. 'link', 'update' and 'retract' plans are not touched.
-- Idempotent: an added entry carries source_doc_id, so the planner no longer
-- asks for it. ITC already filed is not changed: an entry Not in Books is
-- claimed only when it is booked in an open month.

BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT set_config('twob.write', 'system', true);

CREATE TEMP TABLE _nib_fix ON COMMIT DROP AS
WITH m AS (SELECT DISTINCT client_id, period_month FROM public.twob_import_docs),
plan AS (
  SELECT m.client_id, m.period_month, x.*
    FROM m CROSS JOIN LATERAL public.twob__autopost_effective(m.client_id, m.period_month, NULL, NULL) x
   WHERE x.list = 'bills_not_in_books' AND x.op = 'insert' AND x.source_id IS NOT NULL
     AND public.twob_month_is_prior(m.client_id, m.period_month))
SELECT p.*, public.twob_norm_no(p.supplier_invoice_number) AS no,
       (EXISTS (SELECT 1 FROM public.bills_not_in_books b WHERE b.client_id = p.client_id
                 AND public.twob_norm_no(b.supplier_invoice_number) = public.twob_norm_no(p.supplier_invoice_number))
        OR EXISTS (SELECT 1 FROM public.bills_not_in_2b b WHERE b.client_id = p.client_id
                 AND public.twob_norm_no(b.supplier_invoice_number) = public.twob_norm_no(p.supplier_invoice_number))
        OR EXISTS (SELECT 1 FROM public.books_register r WHERE r.client_id = p.client_id
                 AND public.twob_period_key(r.period_month) >= public.twob_period_key(p.period_month)
                 AND public.twob_norm_no(r.supplier_invoice_number) = public.twob_norm_no(p.supplier_invoice_number))
        OR EXISTS (SELECT 1 FROM public.twob_import_docs d WHERE d.client_id = p.client_id
                 AND public.twob_period_key(d.period_month) > public.twob_period_key(p.period_month)
                 AND public.twob_norm_no(d.supplier_invoice_number) = public.twob_norm_no(p.supplier_invoice_number))
       ) AS held_elsewhere
  FROM plan p;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.name, f.period_month, f.supplier_invoice_number FROM _nib_fix f
             JOIN public.clients c ON c.id = f.client_id WHERE f.held_elsewhere ORDER BY 1, 2, 3 LOOP
    RAISE NOTICE 'Left for a person (invoice already elsewhere on the client''s ledger or books): % % %',
      r.name, r.period_month, r.supplier_invoice_number;
  END LOOP;
END $$;

-- The month's own entry.
INSERT INTO public.bills_not_in_books (
  client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, bill_in_2b_month, book_entry_month,
  is_carried_forward, is_locked, source_doc_id, updated_by, updated_at)
SELECT f.client_id, f.period_month, f.date, f.supplier_name, f.supplier_invoice_number, f.supplier_gstin,
       f.taxable_value, f.input_igst, f.input_cgst, f.input_sgst, public.twob_period_label(f.period_month), NULL,
       false, true, f.source_id, NULL, now()
  FROM _nib_fix f
 WHERE NOT f.held_elsewhere
   AND NOT EXISTS (SELECT 1 FROM public.bills_not_in_books z WHERE z.source_doc_id = f.source_id);

-- A carried copy in every later month the client's Not in Books list reaches.
INSERT INTO public.bills_not_in_books (
  client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, bill_in_2b_month, book_entry_month,
  is_carried_forward, is_locked, source_doc_id, updated_by, updated_at)
SELECT f.client_id, lm.p, f.date, f.supplier_name, f.supplier_invoice_number, f.supplier_gstin,
       f.taxable_value, f.input_igst, f.input_cgst, f.input_sgst, public.twob_period_label(f.period_month), NULL,
       true, public.twob_month_is_prior(f.client_id, lm.p), NULL, NULL, now()
  FROM _nib_fix f
  CROSS JOIN LATERAL (
    SELECT b.period_month AS p FROM public.bills_not_in_books b WHERE b.client_id = f.client_id
    UNION
    SELECT l.next_period FROM public.twob_carry_log l WHERE l.client_id = f.client_id AND l.list = 'bills_not_in_books'
  ) lm
 WHERE NOT f.held_elsewhere
   AND public.twob_period_key(lm.p) > public.twob_period_key(f.period_month)
   AND NOT EXISTS (SELECT 1 FROM public.bills_not_in_books z WHERE z.client_id = f.client_id AND z.period_month = lm.p
                    AND public.twob_norm_no(z.supplier_invoice_number) = f.no AND z.date IS NOT DISTINCT FROM f.date);

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.name, f.period_month, count(*) AS n FROM _nib_fix f JOIN public.clients c ON c.id = f.client_id
            WHERE NOT f.held_elsewhere GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'Added % Not in Books entries: % %, carried into the later months', r.n, r.name, r.period_month;
  END LOOP;
END $$;

COMMIT;

-- Checks after applying (both 0 rows / the left-for-a-person list only):
--   SELECT c.name, m.period_month, count(*) FROM (SELECT DISTINCT client_id, period_month FROM public.twob_import_docs) m
--     JOIN public.clients c ON c.id = m.client_id
--     CROSS JOIN LATERAL public.twob__autopost_effective(m.client_id, m.period_month, NULL, NULL) p
--    WHERE p.list = 'bills_not_in_books' AND p.op = 'insert' GROUP BY 1, 2;
