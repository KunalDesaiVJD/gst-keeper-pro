-- Import 2B without "Post to Reconciliation": every save writes through to
-- the 2B Reconciliation ledger by itself (docs/2B_RECONCILIATION_FLOW.md §15).
--
-- The firm (21 Oct 2026): "No need of Post to Reconciliation in Import 2B
-- tab, as updation itself would automatically change the next report
-- wherever required."
--
--  1. The ledger follows Import 2B in an open month, in the same statement as
--     the change. Triggers on books_register and twob_import_docs re-plan the
--     rows a statement touched and write bills_not_in_2b / bills_not_in_books
--     before the statement ends, so the change and its ledger rows are saved
--     together or not at all: a books row added, edited, re-typed, re-treated
--     or deleted; a 2B document's treatment (one, a bulk change, a pairing),
--     figures or counted figures; an import or re-import (each of its
--     writes); a document deleted. The rules are Post's, unchanged
--     (src/lib/postImport2B.ts planImport2BPost, which the page still runs to
--     show what is out of step; twob__autopost_plan is the same plan in SQL,
--     tested against it): only Not in 2B books invoices and Not in Books 2B
--     documents post; a books debit note (purchase return) and a minus row
--     never post and take back what they posted; a row without a date or a
--     supplier is not posted and keeps what it posted (the page says why on
--     the row); a HELD amendment never posts; an amendment that changes no
--     figure does not post and takes back what it posted; a Not in Books
--     credit note posts negative; an update writes the date, supplier,
--     number, GSTIN and amounts only, never a reversal, reclaim, Expense out,
--     book entry or in-2B month. Two differences from Post, both so nothing
--     is lost or doubled silently now that no one reviews a Post dialog:
--     a change that would take back an entry holding a reclaim, Expense out
--     or book entry is refused, naming it (Post deleted the entry with its
--     decision); and a row Post would add beside an identical own entry
--     the month already holds unlinked (put back by Restore, or typed on 2B
--     Reconciliation) links that entry instead of adding a twin. Deleting a
--     books row or a 2B document takes back the entry it posted unless that
--     entry is filed (locked) or holds a decision, as Import 2B's delete did.
--     Writes of this release's own functions (twob.write 'rpc' / 'system':
--     the door, the carry, Re-run, Restore) post nothing here: they write the
--     ledger themselves.
--     Who may (verification round 1): a save that changes the ledger needs
--     Import 2B & post (work_2b_import), as Post did; the user the request
--     names (x-gst-actor) without it is refused, nothing of the save kept;
--     a save that changes nothing on the ledger goes through for any staff.
--     A refusal says where to undo the decision (twob__undo_hint): Import
--     2B's Pending items list booked entries with Undo book entry since this
--     round. A reclaim (twob_import2b_reclaim) and a books row's pairing
--     (twob_import2b_save_book) are one call each: entry and document, or
--     documents and row, together or not at all.
--  2. Race-safe and idempotent by source id: the client's lock (the one every
--     writer of a client's 2B lists takes) is held while the plan is read and
--     written, the ledger rows taken back are locked and read again first (a
--     decision saved meanwhile is seen), and a unique index allows one ledger
--     row per books row / 2B document. A save takes its row's lock, then the
--     client's; Delete 2B, Clear Data and the catch-up take the client's
--     first, so they take the month's rows without waiting
--     (twob__lock_month_rows) and stop with a plain message when a save of
--     the month is running at that moment, instead of deadlocking.
--  3. A prior month (twob_month_is_prior): the guard of 20261021100000 still
--     refuses every direct write, and the triggers post nothing. A GST
--     Manager or the superadmin saves a books row through
--     twob_import2b_prior_save, which sends the row and its Not in 2B
--     write-through to the door (twob_prior_books_apply), the later months'
--     carried copies included, previewed first (p_dry_run) and applied in one
--     transaction. The Not in Books side follows the filed 2B and is never
--     posted in a prior month (§13). Employees: read-only, as before. A books
--     row whose identical entry the month holds unlinked is linked to it
--     (twob__prior_links), never left "to add" for good.
--  4. Catch-up: twob_import2b_catch_up (open month) and
--     twob_import2b_prior_save(p_whole_month) bring a month whose ledger is
--     out of step (posted before this change, or not posted at all) up to
--     date with the same rules, previewed. Nothing is posted by this file.
--  5. Delete 2B (twob_import2b_delete_2b) is one call, 2B Reconciliation's
--     Clear Data (twob_clear_year) one call a month (a large client's year in
--     one call ran past the 3 s anon calls run under): it clears the month
--     and posts its Import 2B rows again at once, since Import 2B still holds
--     them (the dialog says so).
--  6. Version snapshots (twob_versions, the shape Post wrote, table_type
--     'import2b'): coalesced per minute. A write-through marks the month
--     changed, with whose save it was (changed_by); the page, after its own
--     save, asks for the marked months' snapshots (twob_import2b_flush_version,
--     every month of the client marked behind), and a write-through takes one
--     itself when the month's last one is more than a minute old. A snapshot
--     within a minute of the month's current write-through version updates
--     that version in place; otherwise it adds the next version. A version is
--     recorded as the saver's, never the flusher's. A month is marked once a
--     transaction (again after a snapshot in it), and not written again
--     while already marked behind by the same person.
--
-- RLS: unchanged on the four tables (open: the app has no auth session).
-- twob_autopost_state: select open, written only by these functions.
-- Re-runnable: CREATE OR REPLACE, IF NOT EXISTS, triggers dropped and created
-- again. Tests: supabase/tests/twob_simple/run.sh applies this file twice
-- after 20261021100000, as a role that is not a superuser, and runs
-- test_9a_autopost.sql (every save kind, refusals, versions, Delete 2B, Clear
-- Data, catch-up, prior month), test_9b_autopost_race.sh (two sessions),
-- test_9c_autopost_timing.sql (1,000 rows), test_9d_autopost_round1.sql and
-- test_9e_autopost_locks.sh (the first verification round's findings) and
-- autopost.test.mjs (the write-through against planImport2BPost +
-- postImport2BToLedger on twin clients, after every save kind).
--
-- LIVE APPLY (project gcquafqxbykxkbexcdpy only; never SUPABASE_PROJECT_REF):
-- after the rest of the 21 Oct release (20261021160000, 100000, 110000,
-- 120000, 150000) and BEFORE the app goes out: the app no longer has Post,
-- so without this file its saves would not reach the ledger, and it calls
-- twob_import2b_reclaim / twob_import2b_save_book. The app of before (still
-- with Post) keeps working against it in the meantime: its saves write
-- through here (it names no user in its requests, so the Import 2B & post
-- check does not apply to it), and its Post then finds nothing left to do.
-- Already applied in an earlier form? Applying this file again is safe
-- (re-runnable) and brings it to this form.
--  1. Dry checks (SELECT only):
--       -- needs 20261021100000 (true, true):
--       SELECT to_regprocedure('public.twob_prior_books_apply(uuid, uuid, text, jsonb, boolean)') IS NOT NULL,
--              to_regprocedure('public.twob__decision_message(text, jsonb, text)') IS NOT NULL;
--       -- one ledger row per source (0, 0 on 21 Oct 2026; the file refuses otherwise):
--       SELECT (SELECT count(*) FROM (SELECT source_book_id FROM public.bills_not_in_2b WHERE source_book_id IS NOT NULL
--                GROUP BY 1 HAVING count(*) > 1) x),
--              (SELECT count(*) FROM (SELECT source_doc_id FROM public.bills_not_in_books WHERE source_doc_id IS NOT NULL
--                GROUP BY 1 HAVING count(*) > 1) x);
--  2. Apply this file (one transaction; lock_timeout 5 s: at a quiet time;
--     if it stops on the lock timeout, nothing changed: run it again).
--  3. Checks after applying:
--       SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_twob_zz_autopost%';            -- 8
--       SELECT count(*) FROM pg_indexes WHERE indexname IN ('bills_not_in_2b_source_book_uq',
--              'bills_not_in_books_source_doc_uq');                                           -- 2
--       SELECT to_regprocedure('public.twob_import2b_reclaim(uuid, uuid, text, uuid, uuid)') IS NOT NULL,
--              to_regprocedure('public.twob_import2b_save_book(uuid, uuid, jsonb, uuid, uuid)') IS NOT NULL,
--              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
--                       AND table_name = 'twob_autopost_state' AND column_name = 'changed_by');  -- t, t, t
--       -- Who holds Import 2B & post (an employee without it sees Import 2B read-only,
--       -- Pending items aside); give it to anyone who works Import 2B before the app goes out:
--       SELECT p.first_name, r.role FROM public.user_roles r JOIN public.profiles p ON p.user_id = r.user_id
--        WHERE r.role = 'employee' AND NOT EXISTS (SELECT 1 FROM public.user_permissions u
--              WHERE u.user_id = r.user_id AND u.permission_key = 'work_2b_import') ORDER BY 1;
--  4. The months whose ledger differs from what Post would write (read only:
--     run it, nothing is posted; give the list to the lead). The map of
--     21 Oct 2026 (origin/main f9890f7) found 15 client-months with real
--     differences, 13 of them filed: 07/2026 ABHIJEET RAMNIKBHAI SATANI (NIB
--     +1), ELENZA CALLISTA BUILDCON-NO ITC (+3), PRIDE DRUGS & PHARMA (+3, an
--     unlinked twin of each already on the ledger), RAYWINGS SERVICES LLP
--     (+6), SHIVASHRAY DEVELOPERS-NO ITC (+15), SORATH BUILDERS (Not in 2B +1,
--     twin on the ledger), TAMNNA INFRASTRUCTURE-GUJARAT (+1); 08/2026
--     RAYWINGS (+2), REVTI INFRA-TAKE ITC (+1); 09/2026 ABHIJEET (+1, open),
--     HUMONEX INTELLIGENCE (+1, open), KWIKTEAM SUPPORT SERVICES (+14),
--     NAVRATNA S G HIGHWAY PROPERTIES (+52), POINT PACKERS (+4), TISHA
--     INTERNATIONAL (NIB -5, locked). Three more (ELENZA ARISTA 07, MICROCIRCUITS
--     08, PRIDE 09) differed only by a supplier name with a stray space,
--     which no longer counts. In a filed month only the Not in 2B side can be
--     brought up to date (Import 2B's line, a GST Manager or the superadmin,
--     through the door); its Not in Books side follows the filed 2B (§13).
--       SELECT c.name AS client, m.period_month,
--              public.twob_month_is_prior(m.client_id, m.period_month) AS filed,
--              p.list, p.op, count(*) AS entries
--         FROM (SELECT DISTINCT client_id, period_month FROM public.books_register
--               UNION SELECT DISTINCT client_id, period_month FROM public.twob_import_docs) m
--         JOIN public.clients c ON c.id = m.client_id
--         CROSS JOIN LATERAL public.twob__autopost_plan(m.client_id, m.period_month, NULL, NULL) p
--        WHERE p.op <> 'skip'
--        GROUP BY m.client_id, c.name, m.period_month, p.list, p.op
--        ORDER BY c.name, public.twob_period_key(m.period_month), p.list, p.op;
--     The page shows the same for the month it has open ("not in step") with
--     "Bring the reconciliation up to date" for staff who may post.
--  5. Deploy the app (no Post button; prior-month books saves through
--     twob_import2b_prior_save; Delete 2B and Clear Data through their calls).
--  Rollback (only if the app is rolled back too): drop the eight triggers
--  trg_twob_zz_autopost_* on books_register and twob_import_docs; the old
--  app's Post works again. The unique indexes can stay.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. What this builds on
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.twob_prior_books_apply(uuid, uuid, text, jsonb, boolean)') IS NULL
     OR to_regprocedure('public.twob__decision_message(text, jsonb, text)') IS NULL
     OR to_regprocedure('public.twob_month_is_prior(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261021100000_twob_prior_month_simple.sql first. Nothing was changed.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. One ledger row per source
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v text;
BEGIN
  SELECT string_agg(format('books row %s (%s entries)', x.s, x.n), ', ') INTO v
    FROM (SELECT source_book_id::text AS s, count(*) AS n FROM public.bills_not_in_2b
           WHERE source_book_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1 ORDER BY 1 LIMIT 10) x;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'More than one Not in 2B entry is linked to one Import 2B books row: %. Keep one of each on 2B Reconciliation, then apply again. Nothing was changed.', v;
  END IF;
  SELECT string_agg(format('2B document %s (%s entries)', x.s, x.n), ', ') INTO v
    FROM (SELECT source_doc_id::text AS s, count(*) AS n FROM public.bills_not_in_books
           WHERE source_doc_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1 ORDER BY 1 LIMIT 10) x;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'More than one Not in Books entry is linked to one Import 2B document: %. Keep one of each on 2B Reconciliation, then apply again. Nothing was changed.', v;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS bills_not_in_2b_source_book_uq
  ON public.bills_not_in_2b (source_book_id) WHERE source_book_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bills_not_in_books_source_doc_uq
  ON public.bills_not_in_books (source_doc_id) WHERE source_doc_id IS NOT NULL;
-- The unique indexes serve every lookup the plain ones of 20260814090000 did.
DROP INDEX IF EXISTS public.idx_bills_not_in_2b_source_book_id;
DROP INDEX IF EXISTS public.idx_bills_not_in_books_source_doc_id;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- JavaScript's String.prototype.trim (Post trims a supplier name with it):
-- spaces, tabs, line ends, NBSP, the Unicode spaces and the BOM.
CREATE OR REPLACE FUNCTION public.twob__js_trim(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(COALESCE(p, ''),
    '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$',
    '', 'g');
$$;

-- r2 of src/lib/twobDocs.ts: Math.round(v * 100) / 100 in binary floating
-- point (float8 is the same IEEE double), Math.round rounding half up and
-- exactly (0.49999999999999994 is 0, where floor(x + 0.5) would give 1).
CREATE OR REPLACE FUNCTION public.twob__js_r2(p float8)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT round((floor(p * 100) + CASE WHEN p * 100 - floor(p * 100) >= 0.5 THEN 1 ELSE 0 END)::numeric / 100, 2);
$$;

-- What a 2B document puts on the Not in Books ledger: its effect this month
-- with its sign (src/lib/twobDocs.ts signedEffect, the four heads Post
-- writes). A credit note reduces (minus); one IMS-accepted with "ITC to be
-- reduced: Yes" and a declared head counts the declared tax; an amendment
-- counts its full figures less the base (the version already counted), or
-- plus the base when it flips the note type, rounded to the paisa exactly
-- as Post rounds it (r2 in src/lib/twobDocs.ts: the sum in binary floating
-- point, then Math.round of a hundred times it, half up: -0.005 is 0.00,
-- not -0.01, and 100.005 less 100 is 0.00, its float being just under), so
-- the plan never differs from Post's on a figure typed with a third
-- decimal.
CREATE OR REPLACE FUNCTION public.twob__doc_effect(
  p_doc_type text, p_is_amendment boolean, p_original_doc_type text,
  p_taxable numeric, p_igst numeric, p_cgst numeric, p_sgst numeric,
  p_b_taxable numeric, p_b_igst numeric, p_b_cgst numeric, p_b_sgst numeric,
  p_ims text, p_d_igst numeric, p_d_cgst numeric, p_d_sgst numeric, p_d_cess numeric)
RETURNS TABLE (taxable_value numeric, input_igst numeric, input_cgst numeric, input_sgst numeric)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT x.s * CASE WHEN x.am THEN public.twob__js_r2(x.ft::float8 + x.k * COALESCE(p_b_taxable, 0)::float8) ELSE x.ft END,
         x.s * CASE WHEN x.am THEN public.twob__js_r2(x.fi::float8 + x.k * COALESCE(p_b_igst, 0)::float8) ELSE x.fi END,
         x.s * CASE WHEN x.am THEN public.twob__js_r2(x.fc::float8 + x.k * COALESCE(p_b_cgst, 0)::float8) ELSE x.fc END,
         x.s * CASE WHEN x.am THEN public.twob__js_r2(x.fs::float8 + x.k * COALESCE(p_b_sgst, 0)::float8) ELSE x.fs END
    FROM (SELECT COALESCE(p_is_amendment, false) AS am,
                 CASE WHEN p_doc_type = 'CREDIT_NOTE' THEN -1 ELSE 1 END AS s,
                 CASE WHEN COALESCE(p_is_amendment, false) AND COALESCE(p_original_doc_type, '') <> ''
                           AND (CASE WHEN p_original_doc_type = 'CREDIT_NOTE' THEN -1 ELSE 1 END)
                               <> (CASE WHEN p_doc_type = 'CREDIT_NOTE' THEN -1 ELSE 1 END)
                      THEN 1 ELSE -1 END AS k,
                 COALESCE(p_taxable, 0) AS ft,
                 CASE WHEN y.dcl THEN COALESCE(p_d_igst, 0) ELSE COALESCE(p_igst, 0) END AS fi,
                 CASE WHEN y.dcl THEN COALESCE(p_d_cgst, 0) ELSE COALESCE(p_cgst, 0) END AS fc,
                 CASE WHEN y.dcl THEN COALESCE(p_d_sgst, 0) ELSE COALESCE(p_sgst, 0) END AS fs
            FROM (SELECT COALESCE(p_doc_type = 'CREDIT_NOTE' AND p_ims = 'YES'
                                  AND (p_d_igst IS NOT NULL OR p_d_cgst IS NOT NULL OR p_d_sgst IS NOT NULL OR p_d_cess IS NOT NULL), false) AS dcl) y) x;
$$;

-- Whether a ledger row differs from what its source would post (Post's
-- amountsDiffer): the date, the supplier name as trimmed, the number and
-- GSTIN as they are, and each amount to the paisa (a source typed with more
-- decimals is stored rounded, and is the same amount).
CREATE OR REPLACE FUNCTION public.twob__ledger_differs(
  l_date date, l_name text, l_no text, l_gstin text, l_tv numeric, l_ig numeric, l_cg numeric, l_sg numeric,
  s_date date, s_name text, s_no text, s_gstin text, s_tv numeric, s_ig numeric, s_cg numeric, s_sg numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT l_date IS DISTINCT FROM s_date
      OR public.twob__js_trim(l_name) <> COALESCE(NULLIF(s_name, ''), 'Unknown supplier')
      OR COALESCE(l_no, '') <> COALESCE(s_no, '')
      OR COALESCE(l_gstin, '') <> COALESCE(s_gstin, '')
      OR abs(COALESCE(l_tv, 0) - COALESCE(s_tv, 0)) > 0.005000001
      OR abs(COALESCE(l_ig, 0) - COALESCE(s_ig, 0)) > 0.005000001
      OR abs(COALESCE(l_cg, 0) - COALESCE(s_cg, 0)) > 0.005000001
      OR abs(COALESCE(l_sg, 0) - COALESCE(s_sg, 0)) > 0.005000001;
$$;

-- The user the request names (x-gst-actor, as the change log reads it), or NULL.
CREATE OR REPLACE FUNCTION public.twob__request_actor()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v text := current_setting('request.headers', true);
  h json;
  a text;
BEGIN
  IF COALESCE(v, '') = '' OR NOT pg_input_is_valid(v, 'json') THEN
    RETURN NULL;
  END IF;
  h := v::json;
  IF json_typeof(h) <> 'object' THEN
    RETURN NULL;
  END IF;
  a := btrim(h ->> 'x-gst-actor');
  IF a ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN a::uuid;
  END IF;
  RETURN NULL;
END;
$$;

-- A GST Manager, the superadmin, or an employee whose position holds p_key.
CREATE OR REPLACE FUNCTION public.twob__staff_may(p_actor_id uuid, p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_actor_id IS NOT NULL
    AND (COALESCE(public.staff_level_of(p_actor_id) IN ('superadmin', 'gst_manager'), false)
         OR (public.staff_level_of(p_actor_id) = 'employee'
             AND EXISTS (SELECT 1 FROM public.user_permissions up
                          WHERE up.user_id = p_actor_id AND up.permission_key = p_key)));
$$;

-- ---------------------------------------------------------------------------
-- 3. The plan (Post's, in SQL)
-- ---------------------------------------------------------------------------
-- One row of the plan: an entry to add ('insert'), change ('update') or take
-- back ('retract') on one list, or a row not posted, with its reason
-- ('skip'); the figures are what an add or a change writes.
DO $$
BEGIN
  IF to_regtype('public.twob_autopost_row') IS NULL THEN
    CREATE TYPE public.twob_autopost_row AS (
      list text, op text, ledger_id uuid, source_id uuid, date date, supplier_name text,
      supplier_invoice_number text, supplier_gstin text,
      taxable_value numeric, input_igst numeric, input_cgst numeric, input_sgst numeric, reason text);
  END IF;
END $$;

-- What the Not in 2B list of (client, month) needs to follow the books rows
-- p_book_ids (NULL: every one of the month). Post's rules, row for row
-- (planImport2BPost in src/lib/postImport2B.ts): Not in 2B rows post; a
-- debit note (purchase return) or a row with a minus amount is skipped and
-- not postable (what it posted is taken back); a row without a date or a
-- supplier is skipped but postable (what it posted stays as it is); the rest
-- is added, or changed when its entry differs; an entry whose books row no
-- longer posts (another treatment, debit note, minus) is taken back. Reads
-- only. Generic plans: one row or the whole month, the plan is made once per
-- connection (a custom plan cost 5 ms to make, for every save).
CREATE OR REPLACE FUNCTION public.twob__autopost_plan_books(p_client_id uuid, p_period text, p_book_ids uuid[])
RETURNS SETOF public.twob_autopost_row
LANGUAGE plpgsql
STABLE
SET plan_cache_mode = force_generic_plan
AS $$
DECLARE
  v_ids uuid[] := p_book_ids;
BEGIN
  IF v_ids IS NULL THEN
    SELECT COALESCE(array_agg(x.id), '{}') INTO v_ids FROM (
      SELECT b.id FROM public.books_register b
       WHERE b.client_id = p_client_id AND b.period_month = p_period AND b.book_treatment = 'NOT_IN_2B'
      UNION
      SELECT t.source_book_id FROM public.bills_not_in_2b t
       WHERE t.client_id = p_client_id AND t.period_month = p_period AND t.source_book_id IS NOT NULL) x;
  END IF;
  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH bk AS MATERIALIZED (
    SELECT b.id, b.date, b.supplier_invoice_number, b.supplier_gstin,
           public.twob__js_trim(b.supplier_name) AS nm,
           COALESCE(b.taxable_value, 0) AS tv, COALESCE(b.input_igst, 0) AS ig,
           COALESCE(b.input_cgst, 0) AS cg, COALESCE(b.input_sgst, 0) AS sg,
           CASE WHEN b.doc_type = 'DEBIT_NOTE' THEN 'debit'
                WHEN COALESCE(b.taxable_value, 0) < 0 OR COALESCE(b.input_igst, 0) < 0
                  OR COALESCE(b.input_cgst, 0) < 0 OR COALESCE(b.input_sgst, 0) < 0 THEN 'minus'
                WHEN b.date IS NULL THEN 'nodate'
                WHEN public.twob__js_trim(b.supplier_name) = '' THEN 'nosupplier'
                ELSE 'post' END AS k
      FROM public.books_register b
     WHERE b.id = ANY (v_ids) AND b.client_id = p_client_id AND b.period_month = p_period AND b.book_treatment = 'NOT_IN_2B'),
  l2 AS MATERIALIZED (
    SELECT t.id, t.source_book_id, t.date, t.supplier_name, t.supplier_invoice_number, t.supplier_gstin,
           t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst
      FROM public.bills_not_in_2b t
     WHERE t.source_book_id = ANY (v_ids) AND t.client_id = p_client_id AND t.period_month = p_period)
  SELECT 'bills_not_in_2b'::text, 'skip'::text, NULL::uuid, bk.id, bk.date, NULLIF(bk.nm, ''), bk.supplier_invoice_number, bk.supplier_gstin,
         bk.tv, bk.ig, bk.cg, bk.sg,
         CASE bk.k
           WHEN 'debit' THEN 'Debit note (purchase return): no effect until the supplier''s credit note is in 2B; that 2B row then reduces ITC (row 5.3)'
           WHEN 'minus' THEN 'Minus amount: amounts in the books register are always plus. Your debit note (purchase return) is entered as Type "Debit note (purchase return)" at plus amounts; correct this row'
           WHEN 'nodate' THEN 'Missing date'
           ELSE 'Missing supplier name' END
    FROM bk WHERE bk.k <> 'post'
  UNION ALL
  SELECT 'bills_not_in_2b', 'insert', NULL::uuid, bk.id, bk.date, bk.nm, bk.supplier_invoice_number, bk.supplier_gstin,
         bk.tv, bk.ig, bk.cg, bk.sg, NULL::text
    FROM bk WHERE bk.k = 'post' AND NOT EXISTS (SELECT 1 FROM l2 WHERE l2.source_book_id = bk.id)
  UNION ALL
  SELECT 'bills_not_in_2b', 'update', l2.id, bk.id, bk.date, bk.nm, bk.supplier_invoice_number, bk.supplier_gstin,
         bk.tv, bk.ig, bk.cg, bk.sg, NULL::text
    FROM bk JOIN l2 ON l2.source_book_id = bk.id
   WHERE bk.k = 'post'
     AND public.twob__ledger_differs(l2.date, l2.supplier_name, l2.supplier_invoice_number, l2.supplier_gstin,
           l2.taxable_value, l2.input_igst, l2.input_cgst, l2.input_sgst,
           bk.date, bk.nm, bk.supplier_invoice_number, bk.supplier_gstin, bk.tv, bk.ig, bk.cg, bk.sg)
  UNION ALL
  SELECT 'bills_not_in_2b', 'retract', l2.id, l2.source_book_id, l2.date, l2.supplier_name, l2.supplier_invoice_number, l2.supplier_gstin,
         l2.taxable_value, l2.input_igst, l2.input_cgst, l2.input_sgst, NULL::text
    FROM l2
   WHERE NOT EXISTS (SELECT 1 FROM bk WHERE bk.id = l2.source_book_id AND bk.k IN ('post', 'nodate', 'nosupplier'));
END;
$$;

-- What the Not in Books list of (client, month) needs to follow the 2B
-- documents p_doc_ids (NULL: every one of the month): Not in Books rows of
-- every kind (reverse charge too) post at their signed effect; an
-- amendment that changes no figure is not posted and its entry taken back;
-- no date or supplier: skipped, kept. Reads only.
CREATE OR REPLACE FUNCTION public.twob__autopost_plan_docs(p_client_id uuid, p_period text, p_doc_ids uuid[])
RETURNS SETOF public.twob_autopost_row
LANGUAGE plpgsql
STABLE
SET plan_cache_mode = force_generic_plan
AS $$
DECLARE
  v_ids uuid[] := p_doc_ids;
BEGIN
  IF v_ids IS NULL THEN
    SELECT COALESCE(array_agg(x.id), '{}') INTO v_ids FROM (
      SELECT d.id FROM public.twob_import_docs d
       WHERE d.client_id = p_client_id AND d.period_month = p_period AND d.itc_action = 'NOT_IN_BOOKS'
      UNION
      SELECT t.source_doc_id FROM public.bills_not_in_books t
       WHERE t.client_id = p_client_id AND t.period_month = p_period AND t.source_doc_id IS NOT NULL) x;
  END IF;
  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH dk AS MATERIALIZED (
    SELECT dd.*,
           CASE WHEN dd.am AND abs(dd.tv) < 0.005 AND abs(dd.ig) < 0.005 AND abs(dd.cg) < 0.005 AND abs(dd.sg) < 0.005 THEN 'zero'
                WHEN dd.date IS NULL THEN 'nodate'
                WHEN dd.nm = '' THEN 'nosupplier'
                ELSE 'post' END AS k
      FROM (SELECT d.id, d.date, d.supplier_invoice_number, d.supplier_gstin, COALESCE(d.is_amendment, false) AS am,
                   public.twob__js_trim(d.supplier_name) AS nm,
                   e.taxable_value AS tv, e.input_igst AS ig, e.input_cgst AS cg, e.input_sgst AS sg
              FROM public.twob_import_docs d
              CROSS JOIN LATERAL public.twob__doc_effect(d.doc_type, d.is_amendment, d.original_doc_type,
                     d.taxable_value, d.input_igst, d.input_cgst, d.input_sgst,
                     d.base_taxable_value, d.base_input_igst, d.base_input_cgst, d.base_input_sgst,
                     d.ims_reduce_required, d.declared_igst, d.declared_cgst, d.declared_sgst, d.declared_cess) e
             WHERE d.id = ANY (v_ids) AND d.client_id = p_client_id AND d.period_month = p_period
               AND d.itc_action = 'NOT_IN_BOOKS') dd),
  lb AS MATERIALIZED (
    SELECT t.id, t.source_doc_id, t.date, t.supplier_name, t.supplier_invoice_number, t.supplier_gstin,
           t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst
      FROM public.bills_not_in_books t
     WHERE t.source_doc_id = ANY (v_ids) AND t.client_id = p_client_id AND t.period_month = p_period)
  SELECT 'bills_not_in_books'::text, 'skip'::text, NULL::uuid, dk.id, dk.date, NULLIF(dk.nm, ''), dk.supplier_invoice_number, dk.supplier_gstin,
         dk.tv, dk.ig, dk.cg, dk.sg,
         CASE dk.k WHEN 'nodate' THEN 'Missing date' ELSE 'Missing supplier name' END
    FROM dk WHERE dk.k IN ('nodate', 'nosupplier')
  UNION ALL
  SELECT 'bills_not_in_books', 'insert', NULL::uuid, dk.id, dk.date, dk.nm, dk.supplier_invoice_number, dk.supplier_gstin,
         dk.tv, dk.ig, dk.cg, dk.sg, NULL::text
    FROM dk WHERE dk.k = 'post' AND NOT EXISTS (SELECT 1 FROM lb WHERE lb.source_doc_id = dk.id)
  UNION ALL
  SELECT 'bills_not_in_books', 'update', lb.id, dk.id, dk.date, dk.nm, dk.supplier_invoice_number, dk.supplier_gstin,
         dk.tv, dk.ig, dk.cg, dk.sg, NULL::text
    FROM dk JOIN lb ON lb.source_doc_id = dk.id
   WHERE dk.k = 'post'
     AND public.twob__ledger_differs(lb.date, lb.supplier_name, lb.supplier_invoice_number, lb.supplier_gstin,
           lb.taxable_value, lb.input_igst, lb.input_cgst, lb.input_sgst,
           dk.date, dk.nm, dk.supplier_invoice_number, dk.supplier_gstin, dk.tv, dk.ig, dk.cg, dk.sg)
  UNION ALL
  SELECT 'bills_not_in_books', 'retract', lb.id, lb.source_doc_id, lb.date, lb.supplier_name, lb.supplier_invoice_number, lb.supplier_gstin,
         lb.taxable_value, lb.input_igst, lb.input_cgst, lb.input_sgst, NULL::text
    FROM lb
   WHERE NOT EXISTS (SELECT 1 FROM dk WHERE dk.id = lb.source_doc_id AND dk.k IN ('post', 'nodate', 'nosupplier'));
END;
$$;

-- The month's whole plan for the books rows p_book_ids and the 2B documents
-- p_doc_ids (NULL: every one of the month; '{}': none). The same plan as
-- planImport2BPost (src/lib/postImport2B.ts), row for row. Reads only.
CREATE OR REPLACE FUNCTION public.twob__autopost_plan(p_client_id uuid, p_period text, p_book_ids uuid[], p_doc_ids uuid[])
RETURNS SETOF public.twob_autopost_row
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF p_book_ids IS NULL OR array_length(p_book_ids, 1) > 0 THEN
    RETURN QUERY SELECT * FROM public.twob__autopost_plan_books(p_client_id, p_period, p_book_ids);
  END IF;
  IF p_doc_ids IS NULL OR array_length(p_doc_ids, 1) > 0 THEN
    RETURN QUERY SELECT * FROM public.twob__autopost_plan_docs(p_client_id, p_period, p_doc_ids);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Version snapshots, coalesced per minute
-- ---------------------------------------------------------------------------
-- When each month's ledger was last changed by a write-through and last
-- snapshotted (changed_at after snapped_at: the current version is behind).
-- changed_by: whose save it was (the snapshot is recorded as theirs, never
-- as whoever's page asks for it).
CREATE TABLE IF NOT EXISTS public.twob_autopost_state (
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  changed_at   timestamptz,
  snapped_at   timestamptz,
  PRIMARY KEY (client_id, period_month)
);
ALTER TABLE public.twob_autopost_state ADD COLUMN IF NOT EXISTS changed_by uuid;
COMMENT ON TABLE public.twob_autopost_state IS
  'When Import 2B''s write-through last changed a month''s 2B Reconciliation ledger, whose save it was, and when its '
  'version was last snapshotted (20261021170000; docs/2B_RECONCILIATION_FLOW.md §15). Written only by the write-through functions.';
ALTER TABLE public.twob_autopost_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view twob_autopost_state" ON public.twob_autopost_state;
CREATE POLICY "Anyone can view twob_autopost_state" ON public.twob_autopost_state FOR SELECT TO public USING (true);
GRANT SELECT ON public.twob_autopost_state TO anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.twob_autopost_state FROM anon, authenticated;

-- The month's two lists as they stand, in the shape Post wrote
-- (writePostVersion: View Versions and Restore read it unchanged). Within a
-- minute of the month's current write-through version, that version is
-- brought up to date in place; otherwise the next version is added. Recorded
-- as the save of whoever last changed the month through the write-through
-- (twob_autopost_state.changed_by), else p_actor_id (a catch-up, Delete 2B,
-- Clear Data: the caller). Returns the version number.
CREATE OR REPLACE FUNCTION public.twob__autopost_snapshot(p_client_id uuid, p_period text, p_actor_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_data jsonb;
  v_id uuid;
  v_num integer;
  v_type text;
  v_current boolean;
  v_since text;
BEGIN
  p_actor_id := COALESCE((SELECT s.changed_by FROM public.twob_autopost_state s
                           WHERE s.client_id = p_client_id AND s.period_month = p_period
                             AND s.changed_at > COALESCE(s.snapped_at, '-infinity'::timestamptz)), p_actor_id);
  SELECT jsonb_build_object(
    'billsNotIn2B', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', b.id, 'clientId', b.client_id, 'date', b.date, 'supplierName', b.supplier_name,
               'supplierInvoiceNumber', COALESCE(b.supplier_invoice_number, ''), 'supplierGstin', COALESCE(b.supplier_gstin, ''),
               'taxableValue', COALESCE(b.taxable_value, 0), 'inputIgst', COALESCE(b.input_igst, 0),
               'inputCgst', COALESCE(b.input_cgst, 0), 'inputSgst', COALESCE(b.input_sgst, 0),
               'reversalMonth', COALESCE(b.reversal_month, ''), 'reclaimMonth', COALESCE(b.reclaim_month, ''),
               'periodMonth', b.period_month, 'isLocked', COALESCE(b.is_locked, false),
               'isCarriedForward', COALESCE(b.is_carried_forward, false), 'updatedBy', COALESCE(b.updated_by::text, ''),
               'updatedAt', COALESCE(b.updated_at, v_now), 'version', COALESCE(b.version, 1)) ORDER BY b.date, b.id)
        FROM public.bills_not_in_2b b WHERE b.client_id = p_client_id AND b.period_month = p_period), '[]'::jsonb),
    'billsNotInBooks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', b.id, 'clientId', b.client_id, 'date', b.date, 'supplierName', b.supplier_name,
               'supplierInvoiceNumber', COALESCE(b.supplier_invoice_number, ''), 'supplierGstin', COALESCE(b.supplier_gstin, ''),
               'taxableValue', COALESCE(b.taxable_value, 0), 'inputIgst', COALESCE(b.input_igst, 0),
               'inputCgst', COALESCE(b.input_cgst, 0), 'inputSgst', COALESCE(b.input_sgst, 0),
               'bookEntryMonth', COALESCE(b.book_entry_month, ''), 'billIn2BMonth', COALESCE(b.bill_in_2b_month, ''),
               'periodMonth', b.period_month, 'isLocked', COALESCE(b.is_locked, false),
               'isCarriedForward', COALESCE(b.is_carried_forward, false), 'updatedBy', COALESCE(b.updated_by::text, ''),
               'updatedAt', COALESCE(b.updated_at, v_now), 'version', COALESCE(b.version, 1)) ORDER BY b.date, b.id)
        FROM public.bills_not_in_books b WHERE b.client_id = p_client_id AND b.period_month = p_period), '[]'::jsonb))
    INTO v_data;

  SELECT v.id, v.version_number, v.table_type, COALESCE(v.is_current, false), v.version_data ->> 'autopostSince'
    INTO v_id, v_num, v_type, v_current, v_since
    FROM public.twob_versions v
   WHERE v.client_id = p_client_id AND v.period_month = p_period
   ORDER BY v.version_number DESC NULLS LAST, v.updated_at DESC NULLS LAST
   LIMIT 1;
  IF v_id IS NOT NULL AND v_type = 'import2b' AND v_current AND v_since IS NOT NULL
     AND v_since::timestamptz > v_now - interval '1 minute' THEN
    UPDATE public.twob_versions
       SET version_data = v_data || jsonb_build_object('autopostSince', v_since),
           updated_at = v_now, updated_by = COALESCE(p_actor_id, updated_by)
     WHERE id = v_id;
  ELSE
    SELECT COALESCE(max(v.version_number), 0) + 1 INTO v_num
      FROM public.twob_versions v WHERE v.client_id = p_client_id AND v.period_month = p_period;
    UPDATE public.twob_versions SET is_current = false
     WHERE client_id = p_client_id AND period_month = p_period AND is_current IS DISTINCT FROM false;
    INSERT INTO public.twob_versions (client_id, period_month, table_type, version_number, version_data,
                                      updated_at, updated_by, is_current, action_type)
    VALUES (p_client_id, p_period, 'import2b', v_num, v_data || jsonb_build_object('autopostSince', v_now),
            v_now, p_actor_id, true, 'SAVE');
  END IF;
  INSERT INTO public.twob_autopost_state AS s (client_id, period_month, changed_at, snapped_at)
  VALUES (p_client_id, p_period, NULL, v_now)
  ON CONFLICT (client_id, period_month) DO UPDATE SET snapped_at = v_now;
  -- A change after this snapshot, in this transaction, marks the month again
  -- (twob__autopost_changed).
  PERFORM set_config('twob.autopost_marked',
    replace(COALESCE(current_setting('twob.autopost_marked', true), ''), p_client_id::text || '|' || p_period || ';', ''), true);
  RETURN v_num;
END;
$$;

-- A write-through changed the month's ledger: marked (with whose save it
-- was), and snapshotted now only when the last snapshot is more than a
-- minute old (the page asks for one when its save is done:
-- twob_import2b_flush_version). Read first: a month already marked behind by
-- the same person is not written again (a re-import's 1,000 requests write
-- the mark once, not 1,000 times).
CREATE OR REPLACE FUNCTION public.twob__autopost_changed(p_client_id uuid, p_period text, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_snapped timestamptz;
  v_changed timestamptz;
  v_by uuid;
  v_found boolean;
  v_key text := p_client_id::text || '|' || p_period || ';';
  v_marked text := COALESCE(current_setting('twob.autopost_marked', true), '');
BEGIN
  -- Marked once a transaction is enough (changed_at only has to be later
  -- than the last snapshot): a month marked after its snapshot in this
  -- transaction is not marked again.
  IF strpos(v_marked, v_key) > 0 THEN
    RETURN;
  END IF;
  SELECT s.snapped_at, s.changed_at, s.changed_by, true INTO v_snapped, v_changed, v_by, v_found
    FROM public.twob_autopost_state s WHERE s.client_id = p_client_id AND s.period_month = p_period;
  IF COALESCE(v_found, false) AND v_snapped IS NOT NULL AND v_snapped >= clock_timestamp() - interval '1 minute'
     AND v_changed > v_snapped AND v_by IS NOT DISTINCT FROM p_actor_id THEN
    PERFORM set_config('twob.autopost_marked', v_marked || v_key, true);
    RETURN;
  END IF;
  INSERT INTO public.twob_autopost_state AS s (client_id, period_month, changed_at, changed_by)
  VALUES (p_client_id, p_period, clock_timestamp(), p_actor_id)
  ON CONFLICT (client_id, period_month) DO UPDATE SET changed_at = clock_timestamp(), changed_by = EXCLUDED.changed_by
  RETURNING s.snapped_at INTO v_snapped;
  IF v_snapped IS NULL OR v_snapped < clock_timestamp() - interval '1 minute' THEN
    -- Snapshotted now: the next change in this transaction marks it again.
    PERFORM public.twob__autopost_snapshot(p_client_id, p_period, p_actor_id);
  ELSE
    PERFORM set_config('twob.autopost_marked', v_marked || v_key, true);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Writing the plan
-- ---------------------------------------------------------------------------
-- Where staff undo the decisions a refused save names: a book entry or an
-- Expense out under Import 2B's Pending items (Booked, Expensed out: Undo);
-- a reclaim by changing the treatment of the 2B document that reclaims it
-- (Import 2B), which puts the entry back in Awaiting reclaim.
CREATE OR REPLACE FUNCTION public.twob__undo_hint(p_refusals jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN bool_or(r ->> 'message' LIKE '%(filed)%') THEN
      'A filed month''s decision stays as filed; save this change in a way that keeps the entry.'
    ELSE 'Undo it on Import 2B, then save again: '
         || concat_ws('; ',
              CASE WHEN bool_or(r ->> 'message' LIKE '%booked this entry%') THEN 'a book entry under Pending items, Booked (Undo book entry)' END,
              CASE WHEN bool_or(r ->> 'message' LIKE '%expensed out this entry%') THEN 'an Expense out under Pending items, Expensed out (Undo)' END,
              CASE WHEN bool_or(r ->> 'message' LIKE '%reclaimed this entry%') THEN 'a reclaim by changing the treatment of the 2B document that reclaims it' END)
         || '.'
  END
  FROM jsonb_array_elements(COALESCE(p_refusals, '[]'::jsonb)) r;
$$;
-- Applies the plan for (client, month, books rows, 2B documents) to the
-- ledger, or with p_dry_run says what it would do. The caller holds the
-- client's lock and has checked the month is open. Returns per list how
-- many entries are added ('add'), linked ('link': an identical own entry the
-- month holds unlinked), changed and taken back, and 'written' (rows
-- written); with p_report also the rows not posted with their reason
-- ('skipped') and the refusals. A change that would take back an entry
-- holding a reclaim, an Expense out or a book entry is refused (raised; with
-- p_dry_run listed), naming it and where to undo it.
CREATE OR REPLACE FUNCTION public.twob__autopost_apply(
  p_client_id uuid, p_period text, p_book_ids uuid[], p_doc_ids uuid[], p_actor_id uuid,
  p_dry_run boolean DEFAULT false, p_report boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SET plan_cache_mode = force_generic_plan
AS $$
DECLARE
  v_label text := public.twob_period_label(p_period);
  v_plan public.twob_autopost_row[];
  v_refusals jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_adopt_src uuid[] := '{}';
  v_adopt_led uuid[] := '{}';
  v_adopt_list text[] := '{}';
  v_adopted2 uuid[] := '{}';
  v_adoptedb uuid[] := '{}';
  c_skip integer; c2_ins integer; c2_upd integer; c2_ret integer;
  cb_ins integer; cb_upd integer; cb_ret integer;
  a2 integer := 0; ab integer := 0;
  n2_ins integer := 0; n2_upd integer := 0; n2_ret integer := 0;
  nb_ins integer := 0; nb_upd integer := 0; nb_ret integer := 0;
BEGIN
  -- The two halves of the plan called directly (one call less a save).
  IF p_book_ids IS NULL OR array_length(p_book_ids, 1) > 0 THEN
    v_plan := ARRAY(SELECT p FROM public.twob__autopost_plan_books(p_client_id, p_period, p_book_ids) p);
  ELSE
    v_plan := '{}';
  END IF;
  IF p_doc_ids IS NULL OR array_length(p_doc_ids, 1) > 0 THEN
    v_plan := v_plan || ARRAY(SELECT p FROM public.twob__autopost_plan_docs(p_client_id, p_period, p_doc_ids) p);
  END IF;
  -- What the plan holds, so a save of one row runs only the steps it needs.
  SELECT count(*) FILTER (WHERE x.op = 'skip'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_2b' AND x.op = 'insert'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_2b' AND x.op = 'update'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_2b' AND x.op = 'retract'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_books' AND x.op = 'insert'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_books' AND x.op = 'update'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_books' AND x.op = 'retract')
    INTO c_skip, c2_ins, c2_upd, c2_ret, cb_ins, cb_upd, cb_ret
    FROM unnest(v_plan) x;
  IF p_report AND c_skip > 0 THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('list', x.list, 'id', x.source_id, 'number', x.supplier_invoice_number,
             'reason', x.reason)), '[]'::jsonb)
      INTO v_skipped FROM unnest(v_plan) x WHERE x.op = 'skip';
  END IF;
  IF c2_ins + c2_upd + c2_ret + cb_ins + cb_upd + cb_ret = 0 THEN
    RETURN jsonb_build_object('dry_run', p_dry_run, 'written', 0,
      'bills_not_in_2b', jsonb_build_object('add', 0, 'link', 0, 'change', 0, 'remove', 0),
      'bills_not_in_books', jsonb_build_object('add', 0, 'link', 0, 'change', 0, 'remove', 0),
      'skipped', v_skipped, 'refusals', '[]'::jsonb);
  END IF;

  -- The entries to take back, locked and read again: a reclaim, Expense out
  -- or book entry saved meanwhile is seen below. (An entry to change is
  -- locked by its own update, which writes no decision.)
  IF c2_ret > 0 THEN
    PERFORM 1 FROM public.bills_not_in_2b t
     WHERE t.id IN (SELECT x.ledger_id FROM unnest(v_plan) x WHERE x.list = 'bills_not_in_2b' AND x.op = 'retract')
     ORDER BY t.id FOR UPDATE;
  END IF;
  IF cb_ret > 0 THEN
    PERFORM 1 FROM public.bills_not_in_books t
     WHERE t.id IN (SELECT x.ledger_id FROM unnest(v_plan) x WHERE x.list = 'bills_not_in_books' AND x.op = 'retract')
     ORDER BY t.id FOR UPDATE;
  END IF;

  -- Taking back an entry that holds a decision would lose it: refused.
  IF c2_ret + cb_ret > 0 THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('list', r.list, 'id', r.id, 'entry', r.entry, 'message', r.msg) ORDER BY r.list, r.entry), '[]'::jsonb)
      INTO v_refusals
      FROM (SELECT 'bills_not_in_2b' AS list, t.id, public.twob__entry_name(to_jsonb(t)) AS entry,
                   public.twob__decision_message('bills_not_in_2b', to_jsonb(t), p_period) AS msg
              FROM public.bills_not_in_2b t
             WHERE t.id IN (SELECT x.ledger_id FROM unnest(v_plan) x WHERE x.list = 'bills_not_in_2b' AND x.op = 'retract')
               AND (NULLIF(btrim(COALESCE(t.reclaim_month, '')), '') IS NOT NULL OR t.reclaim_subtype IS NOT NULL)
            UNION ALL
            SELECT 'bills_not_in_books', t.id, public.twob__entry_name(to_jsonb(t)),
                   public.twob__decision_message('bills_not_in_books', to_jsonb(t), p_period)
              FROM public.bills_not_in_books t
             WHERE t.id IN (SELECT x.ledger_id FROM unnest(v_plan) x WHERE x.list = 'bills_not_in_books' AND x.op = 'retract')
               AND NULLIF(btrim(COALESCE(t.book_entry_month, '')), '') IS NOT NULL) r
     WHERE r.msg IS NOT NULL;
    IF jsonb_array_length(v_refusals) > 0 AND NOT p_dry_run THEN
      RAISE EXCEPTION 'Not saved: this change would take an entry off the 2B Reconciliation ledger that holds a reclaim, Expense out or book entry. % %',
        (SELECT string_agg(COALESCE((r ->> 'entry') || ': ', '') || (r ->> 'message') || '.', ' ') FROM jsonb_array_elements(v_refusals) r),
        public.twob__undo_hint(v_refusals);
    END IF;
  END IF;

  -- An entry to add that the month already holds as its own, unlinked (the
  -- same document: GSTIN or supplier, number, date and amounts), is linked
  -- instead of added again; one to one.
  IF (c2_ins > 0 AND EXISTS (SELECT 1 FROM public.bills_not_in_2b t
                              WHERE t.client_id = p_client_id AND t.period_month = p_period
                                AND t.source_book_id IS NULL AND NOT COALESCE(t.is_carried_forward, false)))
     OR (cb_ins > 0 AND EXISTS (SELECT 1 FROM public.bills_not_in_books t
                                 WHERE t.client_id = p_client_id AND t.period_month = p_period
                                   AND t.source_doc_id IS NULL AND NOT COALESCE(t.is_carried_forward, false))) THEN
    WITH p AS (
      SELECT x.list, x.source_id,
             public.twob_doc_key(x.supplier_gstin, x.supplier_name, x.supplier_invoice_number, x.date,
                                 x.taxable_value, x.input_igst, x.input_cgst, x.input_sgst) AS k
        FROM unnest(v_plan) x WHERE x.op = 'insert'),
    pn AS (SELECT p.*, row_number() OVER (PARTITION BY p.list, p.k ORDER BY p.source_id) AS rn FROM p),
    c AS (
      SELECT 'bills_not_in_2b' AS list, t.id,
             public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date,
                                 t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst) AS k
        FROM public.bills_not_in_2b t
       WHERE c2_ins > 0 AND t.client_id = p_client_id AND t.period_month = p_period AND t.source_book_id IS NULL
         AND NOT COALESCE(t.is_carried_forward, false)
      UNION ALL
      SELECT 'bills_not_in_books', t.id,
             public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date,
                                 t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst)
        FROM public.bills_not_in_books t
       WHERE cb_ins > 0 AND t.client_id = p_client_id AND t.period_month = p_period AND t.source_doc_id IS NULL
         AND NOT COALESCE(t.is_carried_forward, false)),
    cn AS (SELECT c.*, row_number() OVER (PARTITION BY c.list, c.k ORDER BY c.id) AS rn FROM c)
    SELECT COALESCE(array_agg(pn.source_id), '{}'), COALESCE(array_agg(cn.id), '{}'), COALESCE(array_agg(pn.list), '{}'),
           count(*) FILTER (WHERE pn.list = 'bills_not_in_2b'), count(*) FILTER (WHERE pn.list = 'bills_not_in_books')
      INTO v_adopt_src, v_adopt_led, v_adopt_list, a2, ab
      FROM pn JOIN cn ON cn.list = pn.list AND cn.k = pn.k AND cn.rn = pn.rn;
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object('dry_run', true,
      'written', c2_ins + c2_upd + c2_ret + cb_ins + cb_upd + cb_ret,
      'undo_hint', CASE WHEN jsonb_array_length(v_refusals) > 0 THEN public.twob__undo_hint(v_refusals) END,
      'bills_not_in_2b', jsonb_build_object('add', c2_ins - a2, 'link', a2, 'change', c2_upd, 'remove', c2_ret),
      'bills_not_in_books', jsonb_build_object('add', cb_ins - ab, 'link', ab, 'change', cb_upd, 'remove', cb_ret),
      'skipped', v_skipped, 'refusals', v_refusals);
  END IF;

  -- Take back.
  IF c2_ret > 0 THEN
    DELETE FROM public.bills_not_in_2b t
     WHERE t.id IN (SELECT x.ledger_id FROM unnest(v_plan) x WHERE x.list = 'bills_not_in_2b' AND x.op = 'retract');
    GET DIAGNOSTICS n2_ret = ROW_COUNT;
  END IF;
  IF cb_ret > 0 THEN
    DELETE FROM public.bills_not_in_books t
     WHERE t.id IN (SELECT x.ledger_id FROM unnest(v_plan) x WHERE x.list = 'bills_not_in_books' AND x.op = 'retract');
    GET DIAGNOSTICS nb_ret = ROW_COUNT;
  END IF;

  -- Change: the date, supplier, number, GSTIN and amounts only.
  IF c2_upd > 0 THEN
    UPDATE public.bills_not_in_2b t
       SET date = x.date, supplier_name = x.supplier_name, supplier_invoice_number = x.supplier_invoice_number,
           supplier_gstin = x.supplier_gstin, taxable_value = x.taxable_value, input_igst = x.input_igst,
           input_cgst = x.input_cgst, input_sgst = x.input_sgst, updated_by = COALESCE(p_actor_id, t.updated_by), updated_at = now()
      FROM unnest(v_plan) x
     WHERE x.list = 'bills_not_in_2b' AND x.op = 'update' AND t.id = x.ledger_id;
    GET DIAGNOSTICS n2_upd = ROW_COUNT;
  END IF;
  IF cb_upd > 0 THEN
    UPDATE public.bills_not_in_books t
       SET date = x.date, supplier_name = x.supplier_name, supplier_invoice_number = x.supplier_invoice_number,
           supplier_gstin = x.supplier_gstin, taxable_value = x.taxable_value, input_igst = x.input_igst,
           input_cgst = x.input_cgst, input_sgst = x.input_sgst, updated_by = COALESCE(p_actor_id, t.updated_by), updated_at = now()
      FROM unnest(v_plan) x
     WHERE x.list = 'bills_not_in_books' AND x.op = 'update' AND t.id = x.ledger_id;
    GET DIAGNOSTICS nb_upd = ROW_COUNT;
  END IF;

  -- Link an identical own entry, with the figures an add would write; its
  -- months and decisions stay.
  IF a2 > 0 THEN
    WITH u AS (
      UPDATE public.bills_not_in_2b t
         SET source_book_id = a.src, date = x.date, supplier_name = x.supplier_name,
             supplier_invoice_number = x.supplier_invoice_number, supplier_gstin = x.supplier_gstin,
             taxable_value = x.taxable_value, input_igst = x.input_igst, input_cgst = x.input_cgst, input_sgst = x.input_sgst,
             updated_by = COALESCE(p_actor_id, t.updated_by), updated_at = now()
        FROM unnest(v_adopt_src, v_adopt_led, v_adopt_list) AS a(src, led, list)
        JOIN unnest(v_plan) x ON x.list = 'bills_not_in_2b' AND x.op = 'insert' AND x.source_id = a.src
       WHERE a.list = 'bills_not_in_2b' AND t.id = a.led AND t.source_book_id IS NULL
      RETURNING t.source_book_id)
    SELECT COALESCE(array_agg(u.source_book_id), '{}') INTO v_adopted2 FROM u;
  END IF;
  IF ab > 0 THEN
    WITH u AS (
      UPDATE public.bills_not_in_books t
         SET source_doc_id = a.src, date = x.date, supplier_name = x.supplier_name,
             supplier_invoice_number = x.supplier_invoice_number, supplier_gstin = x.supplier_gstin,
             taxable_value = x.taxable_value, input_igst = x.input_igst, input_cgst = x.input_cgst, input_sgst = x.input_sgst,
             updated_by = COALESCE(p_actor_id, t.updated_by), updated_at = now()
        FROM unnest(v_adopt_src, v_adopt_led, v_adopt_list) AS a(src, led, list)
        JOIN unnest(v_plan) x ON x.list = 'bills_not_in_books' AND x.op = 'insert' AND x.source_id = a.src
       WHERE a.list = 'bills_not_in_books' AND t.id = a.led AND t.source_doc_id IS NULL
      RETURNING t.source_doc_id)
    SELECT COALESCE(array_agg(u.source_doc_id), '{}') INTO v_adoptedb FROM u;
  END IF;

  -- Add: this month as its reversal (in-2B) month, open, not carried.
  IF c2_ins > 0 THEN
    INSERT INTO public.bills_not_in_2b (
      client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
      taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month,
      is_carried_forward, source_book_id, updated_by, updated_at)
    SELECT p_client_id, p_period, x.date, x.supplier_name, x.supplier_invoice_number, x.supplier_gstin,
           x.taxable_value, x.input_igst, x.input_cgst, x.input_sgst, v_label, NULL,
           false, x.source_id, p_actor_id, now()
      FROM unnest(v_plan) x
     WHERE x.list = 'bills_not_in_2b' AND x.op = 'insert' AND NOT (x.source_id = ANY (v_adopted2))
     ORDER BY x.date, x.source_id;
    GET DIAGNOSTICS n2_ins = ROW_COUNT;
  END IF;
  IF cb_ins > 0 THEN
    INSERT INTO public.bills_not_in_books (
      client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
      taxable_value, input_igst, input_cgst, input_sgst, bill_in_2b_month, book_entry_month,
      is_carried_forward, source_doc_id, updated_by, updated_at)
    SELECT p_client_id, p_period, x.date, x.supplier_name, x.supplier_invoice_number, x.supplier_gstin,
           x.taxable_value, x.input_igst, x.input_cgst, x.input_sgst, v_label, NULL,
           false, x.source_id, p_actor_id, now()
      FROM unnest(v_plan) x
     WHERE x.list = 'bills_not_in_books' AND x.op = 'insert' AND NOT (x.source_id = ANY (v_adoptedb))
     ORDER BY x.date, x.source_id;
    GET DIAGNOSTICS nb_ins = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('dry_run', false,
    'written', n2_ins + n2_upd + n2_ret + nb_ins + nb_upd + nb_ret
               + COALESCE(array_length(v_adopted2, 1), 0) + COALESCE(array_length(v_adoptedb, 1), 0),
    'bills_not_in_2b', jsonb_build_object('add', n2_ins, 'link', COALESCE(array_length(v_adopted2, 1), 0), 'change', n2_upd, 'remove', n2_ret),
    'bills_not_in_books', jsonb_build_object('add', nb_ins, 'link', COALESCE(array_length(v_adoptedb, 1), 0), 'change', nb_upd, 'remove', nb_ret),
    'skipped', v_skipped, 'refusals', '[]'::jsonb);
END;
$$;

-- The functions that take the client's lock before any row (the catch-up,
-- Delete 2B, Clear Data) lock the month's Import 2B rows they will add
-- entries from, or delete, without waiting: a save takes its row's lock
-- first and the client's lock after it (in its write-through), so one
-- running right now would otherwise wait for this call while this call
-- waited for its row (a deadlock). Instead this call stops at once with a
-- plain message, and the save goes through. p_docs_for_update: the month's
-- 2B documents are about to be deleted (FOR UPDATE: any save of one stops
-- it); otherwise both tables are share-locked (FOR KEY SHARE, as an entry's
-- key check locks them: only a row being deleted stops it).
CREATE OR REPLACE FUNCTION public.twob__lock_month_rows(p_client_id uuid, p_periods text[], p_docs_for_update boolean)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_docs_for_update THEN
    PERFORM 1 FROM public.twob_import_docs d
     WHERE d.client_id = p_client_id AND d.period_month = ANY (p_periods) ORDER BY d.id FOR UPDATE NOWAIT;
  ELSE
    PERFORM 1 FROM public.books_register b
     WHERE b.client_id = p_client_id AND b.period_month = ANY (p_periods) AND b.book_treatment = 'NOT_IN_2B'
     ORDER BY b.id FOR KEY SHARE NOWAIT;
    PERFORM 1 FROM public.twob_import_docs d
     WHERE d.client_id = p_client_id AND d.period_month = ANY (p_periods) AND d.itc_action = 'NOT_IN_BOOKS'
     ORDER BY d.id FOR KEY SHARE NOWAIT;
  END IF;
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION 'Nothing was changed: % of this client is being saved by someone else right now. Try again in a moment.',
    CASE WHEN array_length(p_periods, 1) = 1 THEN public.twob_month_name(p_periods[1]) ELSE 'a month' END
    USING ERRCODE = 'lock_not_available';
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. The write-through on every save of an open month
-- ---------------------------------------------------------------------------
-- The rows a statement touched in one month: posted under the client's lock.
-- A prior month posts nothing here (the guard lets only the door and this
-- release's own functions write there, and they write the ledger
-- themselves). A month filed while the statement waited for the lock stops
-- the statement: nothing of it is saved. Who may: a save that changes the
-- ledger is the "Import 2B & post" permission's (a GST Manager, the
-- superadmin, or an employee whose position holds work_2b_import), as Post
-- was; the user the request names (x-gst-actor) without it is refused, and
-- nothing of the save is kept. A save that changes nothing on the ledger
-- goes through for any staff, as before. A request naming no user (a
-- system writer, or the app of before this release) is not checked here.
CREATE OR REPLACE FUNCTION public.twob__autopost_touch(
  p_client_id uuid, p_period text, p_book_ids uuid[], p_doc_ids uuid[], p_by uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v jsonb;
  v_actor uuid;
  v_req uuid := public.twob__request_actor();
BEGIN
  IF p_client_id IS NULL OR public.twob_period_key(p_period) IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client_id) THEN
    RETURN;   -- a client being deleted
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  -- The guard (20261021100000) refuses a save in a prior month before this
  -- runs (it lets through only stamps and links, which post nothing); a
  -- month marked filed while the statement waited for the lock stops it
  -- here. twob_month_is_prior's condition, written out as the guard writes
  -- it: a statement's plan is kept for the session, a SQL function's is made
  -- again in every transaction, and every save is one.
  IF EXISTS (SELECT 1 FROM public.twob_ever_filed e
              WHERE e.client_id = p_client_id AND e.reopened_at IS NULL
                AND e.cover_key >= public.twob_period_key(p_period)) THEN
    RAISE EXCEPTION 'Not saved: % was just marked filed. Reload the page.', public.twob_month_name(p_period);
  END IF;
  v_actor := COALESCE(v_req, p_by);
  -- twob__staff_may(v_req, 'work_2b_import'), written out: this runs on
  -- every save, and the function (through staff_level_of, SECURITY DEFINER
  -- with its own search_path) cost more than the rest of a save's
  -- write-through.
  IF v_req IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = v_req
          AND (ur.role IN ('superadmin', 'gst_manager')
               OR (ur.role = 'employee' AND EXISTS (SELECT 1 FROM public.user_permissions up
                                                     WHERE up.user_id = v_req AND up.permission_key = 'work_2b_import')))) THEN
    v := public.twob__autopost_apply(p_client_id, p_period, p_book_ids, p_doc_ids, v_req, true, false);
    IF COALESCE((v ->> 'written')::integer, 0) > 0 THEN
      RAISE EXCEPTION 'Not saved: this change would change the 2B Reconciliation ledger, which needs the Import 2B & post permission. Ask a GST Manager to add it to your position.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN;
  END IF;
  v := public.twob__autopost_apply(p_client_id, p_period, p_book_ids, p_doc_ids, v_actor, false, false);
  IF COALESCE((v ->> 'written')::integer, 0) > 0 THEN
    PERFORM public.twob__autopost_changed(p_client_id, p_period, v_actor);
  END IF;
END;
$$;

-- Books register: added rows (Not in 2B ones post), changed rows (a column
-- Post reads changed, on a row that is or was Not in 2B or holds an entry).
CREATE OR REPLACE FUNCTION public.twob__autopost_books_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF COALESCE(current_setting('twob.write', true), '') IN ('rpc', 'system') THEN
    RETURN NULL;
  END IF;
  FOR r IN SELECT n.client_id, n.period_month, array_agg(n.id) AS ids,
                  (array_agg(n.updated_by) FILTER (WHERE n.updated_by IS NOT NULL))[1] AS actor
             FROM new_rows n WHERE n.book_treatment = 'NOT_IN_2B'
            GROUP BY n.client_id, n.period_month ORDER BY n.client_id, n.period_month LOOP
    PERFORM public.twob__autopost_touch(r.client_id, r.period_month, r.ids, '{}'::uuid[], r.actor);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.twob__autopost_books_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF COALESCE(current_setting('twob.write', true), '') IN ('rpc', 'system') THEN
    RETURN NULL;
  END IF;
  FOR r IN SELECT n.client_id, n.period_month, array_agg(n.id) AS ids,
                  (array_agg(n.updated_by) FILTER (WHERE n.updated_by IS NOT NULL))[1] AS actor
             FROM new_rows n JOIN old_rows o ON o.id = n.id
            WHERE (o.book_treatment, o.doc_type, o.date, o.supplier_name, o.supplier_invoice_number, o.supplier_gstin,
                   o.taxable_value, o.input_igst, o.input_cgst, o.input_sgst)
                  IS DISTINCT FROM
                  (n.book_treatment, n.doc_type, n.date, n.supplier_name, n.supplier_invoice_number, n.supplier_gstin,
                   n.taxable_value, n.input_igst, n.input_cgst, n.input_sgst)
              AND (o.book_treatment = 'NOT_IN_2B' OR n.book_treatment = 'NOT_IN_2B'
                   OR EXISTS (SELECT 1 FROM public.bills_not_in_2b t WHERE t.source_book_id = n.id))
            GROUP BY n.client_id, n.period_month ORDER BY n.client_id, n.period_month LOOP
    PERFORM public.twob__autopost_touch(r.client_id, r.period_month, r.ids, '{}'::uuid[], r.actor);
  END LOOP;
  RETURN NULL;
END;
$$;

-- 2B documents: added rows (Not in Books ones post), changed rows (a column
-- the effect or the entry reads changed, on a row that is or was Not in
-- Books or holds an entry).
CREATE OR REPLACE FUNCTION public.twob__autopost_docs_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF COALESCE(current_setting('twob.write', true), '') IN ('rpc', 'system') THEN
    RETURN NULL;
  END IF;
  FOR r IN SELECT n.client_id, n.period_month, array_agg(n.id) AS ids,
                  (array_agg(n.updated_by) FILTER (WHERE n.updated_by IS NOT NULL))[1] AS actor
             FROM new_rows n WHERE n.itc_action = 'NOT_IN_BOOKS'
            GROUP BY n.client_id, n.period_month ORDER BY n.client_id, n.period_month LOOP
    PERFORM public.twob__autopost_touch(r.client_id, r.period_month, '{}'::uuid[], r.ids, r.actor);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.twob__autopost_docs_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF COALESCE(current_setting('twob.write', true), '') IN ('rpc', 'system') THEN
    RETURN NULL;
  END IF;
  FOR r IN SELECT n.client_id, n.period_month, array_agg(n.id) AS ids,
                  (array_agg(n.updated_by) FILTER (WHERE n.updated_by IS NOT NULL))[1] AS actor
             FROM new_rows n JOIN old_rows o ON o.id = n.id
            WHERE (o.itc_action, o.doc_type, o.is_amendment, o.original_doc_type, o.date, o.supplier_name,
                   o.supplier_invoice_number, o.supplier_gstin, o.taxable_value, o.input_igst, o.input_cgst, o.input_sgst,
                   o.base_taxable_value, o.base_input_igst, o.base_input_cgst, o.base_input_sgst,
                   o.ims_reduce_required, o.declared_igst, o.declared_cgst, o.declared_sgst, o.declared_cess)
                  IS DISTINCT FROM
                  (n.itc_action, n.doc_type, n.is_amendment, n.original_doc_type, n.date, n.supplier_name,
                   n.supplier_invoice_number, n.supplier_gstin, n.taxable_value, n.input_igst, n.input_cgst, n.input_sgst,
                   n.base_taxable_value, n.base_input_igst, n.base_input_cgst, n.base_input_sgst,
                   n.ims_reduce_required, n.declared_igst, n.declared_cgst, n.declared_sgst, n.declared_cess)
              AND (o.itc_action = 'NOT_IN_BOOKS' OR n.itc_action = 'NOT_IN_BOOKS'
                   OR EXISTS (SELECT 1 FROM public.bills_not_in_books t WHERE t.source_doc_id = n.id))
            GROUP BY n.client_id, n.period_month ORDER BY n.client_id, n.period_month LOOP
    PERFORM public.twob__autopost_touch(r.client_id, r.period_month, '{}'::uuid[], r.ids, r.actor);
  END LOOP;
  RETURN NULL;
END;
$$;

-- A books row or 2B document deleted in an open month takes back the entry
-- it posted (before the key's ON DELETE SET NULL unlinks it), unless that
-- entry is filed (locked) or holds a reclaim, Expense out or book entry:
-- that one stays, unlinked, as Import 2B's delete always left it (the page
-- says so first). The month is marked for a snapshot at the end of the
-- statement. Row level, so kept cheap: no SECURITY DEFINER, one index probe
-- when nothing was posted.
CREATE OR REPLACE FUNCTION public.twob__autopost_gone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  n integer := 0;
  v_key text;
  v_marks text;
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
  IF TG_TABLE_NAME = 'books_register' THEN
    DELETE FROM public.bills_not_in_2b t
     WHERE t.source_book_id = OLD.id AND t.client_id = OLD.client_id AND t.period_month = OLD.period_month
       AND NOT COALESCE(t.is_locked, false)
       AND NULLIF(btrim(COALESCE(t.reclaim_month, '')), '') IS NULL AND t.reclaim_subtype IS NULL;
  ELSE
    DELETE FROM public.bills_not_in_books t
     WHERE t.source_doc_id = OLD.id AND t.client_id = OLD.client_id AND t.period_month = OLD.period_month
       AND NOT COALESCE(t.is_locked, false)
       AND NULLIF(btrim(COALESCE(t.book_entry_month, '')), '') IS NULL;
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    v_key := OLD.client_id::text || '|' || OLD.period_month || ';';
    v_marks := COALESCE(current_setting('twob.autopost_marks', true), '');
    IF strpos(v_marks, v_key) = 0 THEN
      PERFORM set_config('twob.autopost_marks', v_marks || v_key, true);
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.twob__autopost_gone_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_marks text := COALESCE(current_setting('twob.autopost_marks', true), '');
  m text;
BEGIN
  IF v_marks = '' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('twob.autopost_marks', '', true);
  FOREACH m IN ARRAY string_to_array(rtrim(v_marks, ';'), ';') LOOP
    PERFORM public.twob__autopost_changed(split_part(m, '|', 1)::uuid, split_part(m, '|', 2), public.twob__request_actor());
  END LOOP;
  RETURN NULL;
END;
$$;

-- Named to run after the guard (trg_twob_prior_guard) and the other
-- triggers of each kind (triggers of one kind fire in name order).
DROP TRIGGER IF EXISTS trg_twob_zz_autopost_added ON public.books_register;
CREATE TRIGGER trg_twob_zz_autopost_added AFTER INSERT ON public.books_register
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.twob__autopost_books_added();
DROP TRIGGER IF EXISTS trg_twob_zz_autopost_changed ON public.books_register;
CREATE TRIGGER trg_twob_zz_autopost_changed AFTER UPDATE ON public.books_register
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.twob__autopost_books_changed();
DROP TRIGGER IF EXISTS trg_twob_zz_autopost_gone ON public.books_register;
CREATE TRIGGER trg_twob_zz_autopost_gone BEFORE DELETE ON public.books_register
  FOR EACH ROW EXECUTE FUNCTION public.twob__autopost_gone();
DROP TRIGGER IF EXISTS trg_twob_zz_autopost_gone_done ON public.books_register;
CREATE TRIGGER trg_twob_zz_autopost_gone_done AFTER DELETE ON public.books_register
  FOR EACH STATEMENT EXECUTE FUNCTION public.twob__autopost_gone_done();

DROP TRIGGER IF EXISTS trg_twob_zz_autopost_added ON public.twob_import_docs;
CREATE TRIGGER trg_twob_zz_autopost_added AFTER INSERT ON public.twob_import_docs
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.twob__autopost_docs_added();
DROP TRIGGER IF EXISTS trg_twob_zz_autopost_changed ON public.twob_import_docs;
CREATE TRIGGER trg_twob_zz_autopost_changed AFTER UPDATE ON public.twob_import_docs
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.twob__autopost_docs_changed();
-- A document posts only while Not in Books (Delete 2B and the import's
-- merge take an entry off before they delete, or keep the document), so the
-- check runs only for those: an import's 2,000 stale documents cost nothing.
DROP TRIGGER IF EXISTS trg_twob_zz_autopost_gone ON public.twob_import_docs;
CREATE TRIGGER trg_twob_zz_autopost_gone BEFORE DELETE ON public.twob_import_docs
  FOR EACH ROW WHEN (OLD.itc_action = 'NOT_IN_BOOKS') EXECUTE FUNCTION public.twob__autopost_gone();
DROP TRIGGER IF EXISTS trg_twob_zz_autopost_gone_done ON public.twob_import_docs;
CREATE TRIGGER trg_twob_zz_autopost_gone_done AFTER DELETE ON public.twob_import_docs
  FOR EACH STATEMENT EXECUTE FUNCTION public.twob__autopost_gone_done();

-- ---------------------------------------------------------------------------
-- 7. What the screens call
-- ---------------------------------------------------------------------------
-- An open month out of step (posted before this change, or never posted):
-- brought up to date with the same rules, by staff who may post (Import 2B
-- & post). p_dry_run: what it would do (the confirm shows it), writing
-- nothing. A month filed meanwhile is refused (its books side through
-- twob_import2b_prior_save).
CREATE OR REPLACE FUNCTION public.twob_import2b_catch_up(
  p_actor_id uuid, p_client_id uuid, p_period text, p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
  v_num integer;
BEGIN
  IF p_client_id IS NULL OR public.twob_period_key(p_period) IS NULL THEN
    RAISE EXCEPTION 'Choose a client and a month.';
  END IF;
  IF NOT public.twob__staff_may(p_actor_id, 'work_2b_import') THEN
    RAISE EXCEPTION 'Needs the Import 2B & post permission. Ask a GST Manager to add it to your position.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  IF public.twob_month_is_prior(p_client_id, p_period) THEN
    RAISE EXCEPTION 'This month is filed. A GST Manager or the superadmin brings its Not in 2B side up to date, from Import 2B.';
  END IF;
  IF NOT p_dry_run THEN
    PERFORM public.twob__lock_month_rows(p_client_id, ARRAY[p_period], false);
  END IF;
  v := public.twob__autopost_apply(p_client_id, p_period, NULL, NULL, p_actor_id, p_dry_run);
  IF NOT p_dry_run AND COALESCE((v ->> 'written')::integer, 0) > 0 THEN
    PERFORM public.twob__autopost_changed(p_client_id, p_period, p_actor_id);
    v_num := public.twob__autopost_snapshot(p_client_id, p_period, p_actor_id);
  END IF;
  RETURN v || jsonb_build_object('period', p_period, 'version', v_num);
END;
$$;

-- A pending Not in 2B entry reclaimed against a 2B document of the open
-- month (Import 2B's Reclaim, from the document or from Pending items), in
-- one transaction: the entry takes this month as its reclaim month and the
-- document becomes Reclaim, or neither (the document's own write-through,
-- e.g. a Not in Books entry taken back that holds a book entry, refuses the
-- whole of it, and says what to undo). Locks as a save takes them: the
-- document's row, then the client's lock, then the entry. Any staff level
-- (the document's write-through asks for Import 2B & post when it changes
-- the ledger). Returns {ok, was}; {ok: false, gone: true, what, message} when the
-- document or the entry is no longer there or no longer awaiting a reclaim
-- (nothing written).
CREATE OR REPLACE FUNCTION public.twob_import2b_reclaim(
  p_actor_id uuid, p_client_id uuid, p_period text, p_pending_id uuid, p_doc_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc record;
  n integer;
BEGIN
  IF p_client_id IS NULL OR public.twob_period_key(p_period) IS NULL OR p_pending_id IS NULL OR p_doc_id IS NULL THEN
    RAISE EXCEPTION 'Choose the entry and the 2B document.';
  END IF;
  IF p_actor_id IS NULL OR COALESCE(public.staff_level_of(p_actor_id), '') NOT IN ('superadmin', 'gst_manager', 'employee') THEN
    RAISE EXCEPTION 'Only staff record a reclaim.';
  END IF;
  SELECT d.id, d.itc_action, d.doc_type, COALESCE(d.is_amendment, false) AS am INTO v_doc
    FROM public.twob_import_docs d
   WHERE d.id = p_doc_id AND d.client_id = p_client_id AND d.period_month = p_period
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'gone', true, 'what', 'document',
      'message', 'This 2B document is no longer in this month. Nothing was saved; the page shows the month as it is now.');
  END IF;
  IF v_doc.am OR COALESCE(v_doc.doc_type, 'INVOICE') NOT IN ('INVOICE', 'DEBIT_NOTE') THEN
    RAISE EXCEPTION 'Only an original invoice or debit note can evidence a reclaim.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  IF public.twob_month_is_prior(p_client_id, p_period) THEN
    RAISE EXCEPTION 'This month is filed. Its 2B documents and the reversal, reclaim and book entry months cannot change.';
  END IF;
  UPDATE public.bills_not_in_2b t
     SET reclaim_month = public.twob_period_label(p_period), reclaim_subtype = NULL, reclaimed_via_doc_id = p_doc_id,
         updated_by = p_actor_id, updated_at = now()
   WHERE t.id = p_pending_id AND t.client_id = p_client_id AND t.period_month = p_period
     AND NULLIF(btrim(COALESCE(t.reclaim_month, '')), '') IS NULL AND t.reclaim_subtype IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RETURN jsonb_build_object('ok', false, 'gone', true, 'what', 'entry',
      'message', 'This entry is no longer awaiting a reclaim in this month. It was changed elsewhere (another tab, or a correction of a filed month that reached this month). Nothing was saved; the page shows the month as it is now.');
  END IF;
  UPDATE public.twob_import_docs SET itc_action = 'RECLAIM', updated_by = p_actor_id, updated_at = now() WHERE id = p_doc_id;
  RETURN jsonb_build_object('ok', true, 'was', v_doc.itc_action);
END;
$$;

-- A books row of the open month saved with its pairing (Import 2B's books
-- register: a cell, the Type, or the re-match after an import), in one
-- transaction: the 2B document it leaves released (Mismatched back to
-- Matched), the one it pairs with paired (Matched, Mismatched or Not in
-- Books become Mismatched), and the row saved; their write-throughs with
-- them, or none of it (a refusal, e.g. an entry holding an Expense out the
-- pairing would take back, undoes the whole save and names it). Locks as a
-- save takes them: the rows first, then the client's lock (in their
-- write-throughs). p_values: the row's date, supplier, number, GSTIN,
-- amounts, doc_type, book_treatment and matched_2b_id (only the keys sent
-- are written). Import 2B & post. Returns {ok, paired_was} (the paired
-- document's treatment before, for its amendments to follow).
CREATE OR REPLACE FUNCTION public.twob_import2b_save_book(
  p_actor_id uuid, p_book_id uuid, p_values jsonb, p_release_doc_id uuid DEFAULT NULL, p_pair_doc_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_book record;
  r public.books_register;
  v_pair text;
  v_bad text;
BEGIN
  IF NOT public.twob__staff_may(p_actor_id, 'work_2b_import') THEN
    RAISE EXCEPTION 'Needs the Import 2B & post permission. Ask a GST Manager to add it to your position.';
  END IF;
  p_values := COALESCE(p_values, '{}'::jsonb);
  IF jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'No values were sent.';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_values) k
   WHERE k NOT IN ('date', 'supplier_name', 'supplier_invoice_number', 'supplier_gstin', 'taxable_value', 'input_igst',
                   'input_cgst', 'input_sgst', 'doc_type', 'book_treatment', 'matched_2b_id') LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A books row saves its date, supplier, number, GSTIN, amounts, type and treatment here (%).', v_bad;
  END IF;
  SELECT b.id, b.client_id, b.period_month INTO v_book FROM public.books_register b WHERE b.id = p_book_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This books row is no longer here. Reload the page.';
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
   WHERE b.id = p_book_id;
  RETURN jsonb_build_object('ok', true, 'paired_was', v_pair);
END;
$$;

-- The door's two results as one preview: the second call's changes follow
-- the first's (indexes moved on), and the later months add up.
CREATE OR REPLACE FUNCTION public.twob__door_merge(r1 jsonb, r2 jsonb, p_dry_run boolean, p_period text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  WITH a AS (SELECT COALESCE(r1, '{}'::jsonb) AS r), b AS (SELECT COALESCE(r2, '{}'::jsonb) AS r),
  n AS (SELECT jsonb_array_length(COALESCE((SELECT r FROM a) -> 'changes', '[]'::jsonb)) AS n1)
  SELECT jsonb_build_object(
    'ok', COALESCE(((SELECT r FROM a) ->> 'ok')::boolean, true) AND COALESCE(((SELECT r FROM b) ->> 'ok')::boolean, true),
    'dry_run', p_dry_run, 'period', p_period,
    'changes', COALESCE((SELECT r FROM a) -> 'changes', '[]'::jsonb)
               || COALESCE((SELECT jsonb_agg(e || jsonb_build_object('index', (e ->> 'index')::integer + (SELECT n1 FROM n), 'derived', true))
                              FROM jsonb_array_elements(COALESCE((SELECT r FROM b) -> 'changes', '[]'::jsonb)) e), '[]'::jsonb),
    'refusals', COALESCE((SELECT r FROM a) -> 'refusals', '[]'::jsonb)
               || COALESCE((SELECT jsonb_agg(e || jsonb_build_object('index', (e ->> 'index')::integer + (SELECT n1 FROM n)))
                              FROM jsonb_array_elements(COALESCE((SELECT r FROM b) -> 'refusals', '[]'::jsonb)) e), '[]'::jsonb),
    'notes', COALESCE((SELECT r FROM a) -> 'notes', '[]'::jsonb)
               || COALESCE((SELECT jsonb_agg(e || jsonb_build_object('index', (e ->> 'index')::integer + (SELECT n1 FROM n)))
                              FROM jsonb_array_elements(COALESCE((SELECT r FROM b) -> 'notes', '[]'::jsonb)) e), '[]'::jsonb),
    'later_months', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('period', x.p, 'count', x.c) ORDER BY public.twob_period_key(x.p))
        FROM (SELECT m ->> 'period' AS p, sum((m ->> 'count')::integer)::integer AS c
                FROM (SELECT jsonb_array_elements(COALESCE((SELECT r FROM a) -> 'later_months', '[]'::jsonb)) AS m
                      UNION ALL
                      SELECT jsonb_array_elements(COALESCE((SELECT r FROM b) -> 'later_months', '[]'::jsonb))) y
               GROUP BY 1) x), '[]'::jsonb));
$$;

-- The Not in 2B write-through of a prior month's books rows (NULL: every
-- books row of the month): 'door', the door's changes: an add (this month as
-- its reversal month, the books row linked), a change of the date, supplier,
-- number, GSTIN and amounts, a removal; each books row with an entry change
-- is named too (a change that changes nothing), so the door does not also
-- write the entry's figures back onto it. 'links': an entry to add that the
-- month already holds as its own entry, unlinked (the same document,
-- twob_doc_key: put back by a Restore, or typed on 2B Reconciliation), is
-- linked to its books row instead of added (the door would leave it out as
-- held, and the month would stay out of step for good: SORATH 07/2026),
-- one to one, as the open month's write-through links it. Not in Books
-- entries follow the filed 2B and are never part of it (§13).
CREATE OR REPLACE FUNCTION public.twob__prior_derived(p_client_id uuid, p_period text, p_book_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH p AS (
    SELECT * FROM public.twob__autopost_plan_books(p_client_id, p_period, p_book_ids) x WHERE x.op <> 'skip'),
  ins AS (
    SELECT p.source_id, public.twob_doc_key(p.supplier_gstin, p.supplier_name, p.supplier_invoice_number, p.date,
                                            p.taxable_value, p.input_igst, p.input_cgst, p.input_sgst) AS k
      FROM p WHERE p.op = 'insert'),
  insn AS (SELECT ins.*, row_number() OVER (PARTITION BY ins.k ORDER BY ins.source_id) AS rn FROM ins),
  own AS (
    SELECT t.id, to_jsonb(t) AS j,
           public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date,
                               t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst) AS k
      FROM public.bills_not_in_2b t
     WHERE EXISTS (SELECT 1 FROM ins) AND t.client_id = p_client_id AND t.period_month = p_period
       AND t.source_book_id IS NULL AND NOT COALESCE(t.is_carried_forward, false)),
  ownn AS (SELECT own.*, row_number() OVER (PARTITION BY own.k ORDER BY own.id) AS rn FROM own WHERE own.k IN (SELECT k FROM ins)),
  lk AS (SELECT insn.source_id, ownn.id AS ledger_id, ownn.j FROM insn JOIN ownn ON ownn.k = insn.k AND ownn.rn = insn.rn)
  SELECT jsonb_build_object(
    'door', COALESCE((
      SELECT jsonb_agg(c ORDER BY o) FROM (
        SELECT 1 AS o, CASE p.op
          WHEN 'insert' THEN jsonb_build_object('table', 'bills_not_in_2b', 'op', 'insert', 'values', jsonb_build_object(
            'date', p.date, 'supplier_name', p.supplier_name, 'supplier_invoice_number', p.supplier_invoice_number,
            'supplier_gstin', p.supplier_gstin, 'taxable_value', p.taxable_value, 'input_igst', p.input_igst,
            'input_cgst', p.input_cgst, 'input_sgst', p.input_sgst, 'reversal_month', public.twob_period_label(p_period),
            'source_book_id', p.source_id))
          WHEN 'update' THEN jsonb_build_object('table', 'bills_not_in_2b', 'op', 'update', 'id', p.ledger_id, 'values', jsonb_build_object(
            'date', p.date, 'supplier_name', p.supplier_name, 'supplier_invoice_number', p.supplier_invoice_number,
            'supplier_gstin', p.supplier_gstin, 'taxable_value', p.taxable_value, 'input_igst', p.input_igst,
            'input_cgst', p.input_cgst, 'input_sgst', p.input_sgst))
          ELSE jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', p.ledger_id) END AS c
          FROM p WHERE NOT (p.op = 'insert' AND p.source_id IN (SELECT lk.source_id FROM lk))
        UNION ALL
        SELECT 2, jsonb_build_object('table', 'books_register', 'op', 'update', 'id', s.source_id, 'values', '{}'::jsonb)
          FROM (SELECT DISTINCT p.source_id FROM p
                 WHERE NOT (p.op = 'insert' AND p.source_id IN (SELECT lk.source_id FROM lk))
                   AND EXISTS (SELECT 1 FROM public.books_register b WHERE b.id = p.source_id)) s) z), '[]'::jsonb),
    'links', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', lk.ledger_id, 'source_book_id', lk.source_id,
                                          'entry', public.twob__entry_name(lk.j)) ORDER BY lk.ledger_id)
        FROM lk), '[]'::jsonb));
$$;

-- The links of twob__prior_derived written (the door does not change a link,
-- and a link moves no figure: the entry is already the same document), and
-- the preview's changes for them, numbered after p_from.
CREATE OR REPLACE FUNCTION public.twob__prior_links(p_client_id uuid, p_period text, p_links jsonb, p_from integer, p_apply boolean, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev text := current_setting('twob.write', true);
  l jsonb;
  i integer := 0;
  v_out jsonb := '[]'::jsonb;
  n integer;
BEGIN
  FOR l IN SELECT value FROM jsonb_array_elements(COALESCE(p_links, '[]'::jsonb)) LOOP
    IF p_apply THEN
      PERFORM set_config('twob.write', 'rpc', true);
      UPDATE public.bills_not_in_2b t SET source_book_id = (l ->> 'source_book_id')::uuid, updated_by = COALESCE(p_actor_id, t.updated_by), updated_at = now()
       WHERE t.id = (l ->> 'id')::uuid AND t.client_id = p_client_id AND t.period_month = p_period AND t.source_book_id IS NULL;
      GET DIAGNOSTICS n = ROW_COUNT;
      PERFORM set_config('twob.write', COALESCE(v_prev, ''), true);
      CONTINUE WHEN n = 0;
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'index', p_from + i, 'table', 'bills_not_in_2b', 'op', 'update', 'entry', l ->> 'entry', 'id', l ->> 'id',
      'this', jsonb_build_object('action', 'link', 'id', l ->> 'id'), 'later', '[]'::jsonb, 'derived', true));
    i := i + 1;
  END LOOP;
  RETURN v_out;
END;
$$;

-- A prior month's books rows saved by a GST Manager or the superadmin, with
-- their Not in 2B write-through, through the door (twob_prior_books_apply),
-- which also reaches the later months' carried copies: p_changes are books
-- register changes only (insert, update, delete; a delete takes the entry
-- it posted with it). p_whole_month: also every other books row of the
-- month (bringing a month out of step up to date). One transaction: the
-- rows, their entries and the later copies, or nothing. p_dry_run: the
-- preview, as the door gives it (the rows saved first, their write-through
-- worked out after, then all of it undone).
CREATE OR REPLACE FUNCTION public.twob_import2b_prior_save(
  p_actor_id uuid, p_client_id uuid, p_period text, p_changes jsonb,
  p_dry_run boolean DEFAULT true, p_whole_month boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phase1 jsonb := '[]'::jsonb;
  v_derived jsonb;
  v_touched uuid[];
  r1 jsonb;
  r2 jsonb;
  c jsonb;
  v_out jsonb;
  v_links jsonb;
  v_wrote boolean := false;
  v_num integer;
BEGIN
  IF p_client_id IS NULL OR public.twob_period_key(p_period) IS NULL THEN
    RAISE EXCEPTION 'Choose a client and a month.';
  END IF;
  IF NOT public.twob_month_is_prior(p_client_id, p_period) THEN
    RAISE EXCEPTION 'This month is not filed. Its saves reach the 2B Reconciliation ledger by themselves.';
  END IF;
  IF p_actor_id IS NULL OR COALESCE(public.staff_level_of(p_actor_id), '') NOT IN ('superadmin', 'gst_manager') THEN
    RAISE EXCEPTION 'This month is filed. Only a GST Manager or the superadmin can change its books entries, from Import 2B or 2B Reconciliation.';
  END IF;
  p_changes := COALESCE(p_changes, '[]'::jsonb);
  IF jsonb_typeof(p_changes) <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_changes) x WHERE jsonb_typeof(x) <> 'object') THEN
    RAISE EXCEPTION 'No changes were sent.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_changes) x WHERE x ->> 'table' IS DISTINCT FROM 'books_register') THEN
    RAISE EXCEPTION 'Only Import 2B books rows are saved here; the 2B Reconciliation entries follow them.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));

  -- The books rows; a removed one takes the Not in 2B entry it posted, and
  -- that entry's later copies, with it (named before the row, as Import 2B
  -- always sent them).
  FOR c IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    IF c ->> 'op' = 'delete' AND NULLIF(c ->> 'id', '') IS NOT NULL THEN
      v_phase1 := v_phase1 || COALESCE((
        SELECT jsonb_agg(jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', t.id) ORDER BY t.id)
          FROM public.bills_not_in_2b t
         WHERE t.source_book_id = (c ->> 'id')::uuid AND t.client_id = p_client_id AND t.period_month = p_period), '[]'::jsonb);
    END IF;
    v_phase1 := v_phase1 || jsonb_build_array(c);
  END LOOP;

  IF p_dry_run THEN
    IF jsonb_array_length(v_phase1) > 0 THEN
      r1 := public.twob_prior_books_apply(p_actor_id, p_client_id, p_period, v_phase1, true);
      IF NOT COALESCE((r1 ->> 'ok')::boolean, false) THEN
        RETURN public.twob__door_merge(r1, NULL, true, p_period);
      END IF;
    END IF;
    BEGIN
      IF jsonb_array_length(v_phase1) > 0 THEN
        v_out := public.twob_prior_books_apply(p_actor_id, p_client_id, p_period, v_phase1, false);
      END IF;
      SELECT COALESCE(array_agg(DISTINCT (ch -> 'this' ->> 'id')::uuid), '{}') INTO v_touched
        FROM jsonb_array_elements(COALESCE(v_out -> 'changes', '[]'::jsonb)) ch
       WHERE ch ->> 'table' = 'books_register' AND ch ->> 'op' IN ('insert', 'update') AND ch -> 'this' ->> 'id' IS NOT NULL;
      v_derived := public.twob__prior_derived(p_client_id, p_period, CASE WHEN p_whole_month THEN NULL ELSE v_touched END);
      IF jsonb_array_length(v_derived -> 'door') > 0 THEN
        r2 := public.twob_prior_books_apply(p_actor_id, p_client_id, p_period, v_derived -> 'door', true);
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'TWB02', MESSAGE = 'twob: preview only';
    EXCEPTION WHEN SQLSTATE 'TWB02' THEN
      NULL;
    END;
    v_out := public.twob__door_merge(r1, r2, true, p_period);
    RETURN v_out || jsonb_build_object('changes', (v_out -> 'changes')
      || public.twob__prior_links(p_client_id, p_period, v_derived -> 'links', jsonb_array_length(v_out -> 'changes'), false, p_actor_id));
  END IF;

  IF jsonb_array_length(v_phase1) > 0 THEN
    r1 := public.twob_prior_books_apply(p_actor_id, p_client_id, p_period, v_phase1, false);
    v_wrote := EXISTS (SELECT 1 FROM jsonb_array_elements(r1 -> 'changes') ch
                        WHERE ch ->> 'table' <> 'books_register' AND ch -> 'this' ->> 'action' IN ('add', 'change', 'remove'));
  END IF;
  SELECT COALESCE(array_agg(DISTINCT (ch -> 'this' ->> 'id')::uuid), '{}') INTO v_touched
    FROM jsonb_array_elements(COALESCE(r1 -> 'changes', '[]'::jsonb)) ch
   WHERE ch ->> 'table' = 'books_register' AND ch ->> 'op' IN ('insert', 'update') AND ch -> 'this' ->> 'id' IS NOT NULL;
  v_derived := public.twob__prior_derived(p_client_id, p_period, CASE WHEN p_whole_month THEN NULL ELSE v_touched END);
  IF jsonb_array_length(v_derived -> 'door') > 0 THEN
    r2 := public.twob_prior_books_apply(p_actor_id, p_client_id, p_period, v_derived -> 'door', false);
    v_wrote := v_wrote OR EXISTS (SELECT 1 FROM jsonb_array_elements(r2 -> 'changes') ch
                                   WHERE ch ->> 'table' <> 'books_register' AND ch -> 'this' ->> 'action' IN ('add', 'change', 'remove'));
  END IF;
  v_out := public.twob__door_merge(r1, r2, false, p_period);
  v_links := public.twob__prior_links(p_client_id, p_period, v_derived -> 'links', jsonb_array_length(v_out -> 'changes'), true, p_actor_id);
  v_wrote := v_wrote OR jsonb_array_length(v_links) > 0;
  v_out := v_out || jsonb_build_object('changes', (v_out -> 'changes') || v_links);
  IF v_wrote THEN
    PERFORM public.twob__autopost_changed(p_client_id, p_period, p_actor_id);
    v_num := public.twob__autopost_snapshot(p_client_id, p_period, p_actor_id);
  END IF;
  RETURN v_out || jsonb_build_object('version', v_num);
END;
$$;

-- Import 2B's Delete 2B, in one call: the reclaims the month's documents
-- evidence go back to Awaiting reclaim, the Not in Books entries they posted
-- leave the ledger (a filed, locked one stays, and its document with it, so
-- a re-import merges into it), then the documents go. Open months only;
-- staff who may delete 2B rows.
CREATE OR REPLACE FUNCTION public.twob_import2b_delete_2b(p_actor_id uuid, p_client_id uuid, p_period text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  n_rel integer := 0;
  n_nib integer := 0;
  n_docs integer := 0;
  v_kept integer := 0;
BEGIN
  IF p_client_id IS NULL OR public.twob_period_key(p_period) IS NULL THEN
    RAISE EXCEPTION 'Choose a client and a month.';
  END IF;
  IF NOT public.twob__staff_may(p_actor_id, 'delete_2b_rows') THEN
    RAISE EXCEPTION 'Needs the Delete 2B rows permission. Ask a GST Manager to add it to your position.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  IF public.twob_month_is_prior(p_client_id, p_period) THEN
    RAISE EXCEPTION 'This month is filed. Its 2B documents and the reversal, reclaim and book entry months cannot change.';
  END IF;
  -- The documents locked without waiting: a save of one running right now
  -- (which takes this client's lock after its row's) stops this, not the save.
  PERFORM public.twob__lock_month_rows(p_client_id, ARRAY[p_period], true);
  SELECT COALESCE(array_agg(d.id), '{}') INTO v_ids FROM public.twob_import_docs d
   WHERE d.client_id = p_client_id AND d.period_month = p_period;
  UPDATE public.bills_not_in_2b t
     SET reclaim_month = NULL, reclaim_subtype = NULL, reclaimed_via_doc_id = NULL, updated_by = p_actor_id, updated_at = now()
   WHERE t.reclaimed_via_doc_id = ANY (v_ids);
  GET DIAGNOSTICS n_rel = ROW_COUNT;
  DELETE FROM public.bills_not_in_books t
   WHERE t.source_doc_id = ANY (v_ids) AND NOT COALESCE(t.is_locked, false) AND NOT COALESCE(t.is_carried_forward, false);
  GET DIAGNOSTICS n_nib = ROW_COUNT;
  DELETE FROM public.twob_import_docs d
   WHERE d.id = ANY (v_ids)
     AND NOT EXISTS (SELECT 1 FROM public.bills_not_in_books t WHERE t.source_doc_id = d.id);
  GET DIAGNOSTICS n_docs = ROW_COUNT;
  v_kept := COALESCE(array_length(v_ids, 1), 0) - n_docs;
  IF n_rel + n_nib > 0 THEN
    PERFORM public.twob__autopost_changed(p_client_id, p_period, p_actor_id);
    PERFORM public.twob__autopost_snapshot(p_client_id, p_period, p_actor_id);
  END IF;
  RETURN jsonb_build_object('deleted', n_docs, 'kept_filed', v_kept, 'reclaims_released', n_rel, 'entries_removed', n_nib);
END;
$$;

-- 2B Reconciliation's Clear Data: the open months named have their carried
-- decisions undone, both lists cleared, and the entries Import 2B posts
-- written again at once (Import 2B still holds them; delete them there to
-- have them gone; the dialog says so before CLEAR is typed). Filed months
-- are kept and named. Staff who may clear data. The dialog calls it once a
-- month (a large client's year in one call can pass the 3 s limit anon
-- calls run under), each month all or nothing.
CREATE OR REPLACE FUNCTION public.twob_clear_year(p_actor_id uuid, p_client_id uuid, p_months text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open text[];
  v_kept text[];
  n1 integer := 0;
  n2 integer := 0;
  v jsonb;
  v_reposted integer := 0;
  m text;
BEGIN
  IF p_client_id IS NULL OR p_months IS NULL OR EXISTS (SELECT 1 FROM unnest(p_months) x WHERE public.twob_period_key(x) IS NULL) THEN
    RAISE EXCEPTION 'Choose a client and a year.';
  END IF;
  IF NOT public.twob__staff_may(p_actor_id, 'clear_data') THEN
    RAISE EXCEPTION 'Needs the Clear data permission. Ask a GST Manager to add it to your position.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  SELECT COALESCE(array_agg(x ORDER BY public.twob_period_key(x)) FILTER (WHERE NOT public.twob_month_is_prior(p_client_id, x)), '{}'),
         COALESCE(array_agg(x ORDER BY public.twob_period_key(x)) FILTER (WHERE public.twob_month_is_prior(p_client_id, x)), '{}')
    INTO v_open, v_kept
    FROM (SELECT DISTINCT unnest(p_months) AS x) y;
  IF COALESCE(array_length(v_open, 1), 0) > 0 THEN
    PERFORM public.twob__lock_month_rows(p_client_id, v_open, false);
    -- A carried entry's own decision is undone first: the guard refuses to
    -- delete a carried entry holding one (clearing the year is meant).
    UPDATE public.bills_not_in_2b SET reclaim_month = NULL, reclaim_subtype = NULL, reclaimed_via_doc_id = NULL
     WHERE client_id = p_client_id AND period_month = ANY (v_open) AND is_carried_forward
       AND (reclaim_month IS NOT NULL OR reclaim_subtype IS NOT NULL);
    UPDATE public.bills_not_in_books SET book_entry_month = NULL
     WHERE client_id = p_client_id AND period_month = ANY (v_open) AND is_carried_forward AND book_entry_month IS NOT NULL;
    DELETE FROM public.bills_not_in_2b WHERE client_id = p_client_id AND period_month = ANY (v_open);
    GET DIAGNOSTICS n1 = ROW_COUNT;
    DELETE FROM public.bills_not_in_books WHERE client_id = p_client_id AND period_month = ANY (v_open);
    GET DIAGNOSTICS n2 = ROW_COUNT;
    FOREACH m IN ARRAY v_open LOOP
      v := public.twob__autopost_apply(p_client_id, m, NULL, NULL, p_actor_id, false);
      v_reposted := v_reposted + COALESCE((v ->> 'written')::integer, 0);
      IF COALESCE((v ->> 'written')::integer, 0) > 0
         OR EXISTS (SELECT 1 FROM public.twob_versions t WHERE t.client_id = p_client_id AND t.period_month = m) THEN
        PERFORM public.twob__autopost_changed(p_client_id, m, p_actor_id);
        PERFORM public.twob__autopost_snapshot(p_client_id, m, p_actor_id);
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('deleted', n1 + n2, 'reposted', v_reposted, 'cleared', to_jsonb(v_open), 'kept', to_jsonb(v_kept));
END;
$$;

-- The page's save is done: every month of the client whose ledger a
-- write-through changed since its last snapshot (this one, and another one a
-- save reached, e.g. a later month's amendment) has its version brought up
-- to date (in place within its minute), recorded as the save of whoever made
-- it (twob_autopost_state.changed_by), never as the caller's. The page calls
-- it after its own saves only, not on a plain load. Returns the month's
-- current version.
CREATE OR REPLACE FUNCTION public.twob_import2b_flush_version(p_actor_id uuid, p_client_id uuid, p_period text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_num integer;
  v_at timestamptz;
  m text;
BEGIN
  IF p_client_id IS NULL OR public.twob_period_key(p_period) IS NULL THEN
    RETURN jsonb_build_object('version', NULL, 'at', NULL);
  END IF;
  IF EXISTS (SELECT 1 FROM public.twob_autopost_state s
              WHERE s.client_id = p_client_id AND s.changed_at > COALESCE(s.snapped_at, '-infinity'::timestamptz)) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
    FOR m IN SELECT s.period_month FROM public.twob_autopost_state s
              WHERE s.client_id = p_client_id AND s.changed_at > COALESCE(s.snapped_at, '-infinity'::timestamptz)
              ORDER BY public.twob_period_key(s.period_month) LOOP
      PERFORM public.twob__autopost_snapshot(p_client_id, m, p_actor_id);
    END LOOP;
  END IF;
  SELECT v.version_number, v.updated_at INTO v_num, v_at FROM public.twob_versions v
   WHERE v.client_id = p_client_id AND v.period_month = p_period AND COALESCE(v.is_current, false)
   ORDER BY v.version_number DESC NULLS LAST LIMIT 1;
  RETURN jsonb_build_object('version', v_num, 'at', v_at);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Who may call what
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION
  public.twob_import2b_catch_up(uuid, uuid, text, boolean),
  public.twob_import2b_reclaim(uuid, uuid, text, uuid, uuid),
  public.twob_import2b_save_book(uuid, uuid, jsonb, uuid, uuid),
  public.twob_import2b_prior_save(uuid, uuid, text, jsonb, boolean, boolean),
  public.twob_import2b_delete_2b(uuid, uuid, text),
  public.twob_clear_year(uuid, uuid, text[]),
  public.twob_import2b_flush_version(uuid, uuid, text)
TO anon, authenticated, service_role;

-- Internal: they write without checking who acts, or are triggers.
REVOKE ALL ON FUNCTION
  public.twob__autopost_plan(uuid, text, uuid[], uuid[]),
  public.twob__autopost_apply(uuid, text, uuid[], uuid[], uuid, boolean, boolean),
  public.twob__autopost_plan_books(uuid, text, uuid[]),
  public.twob__autopost_plan_docs(uuid, text, uuid[]),
  public.twob__autopost_touch(uuid, text, uuid[], uuid[], uuid),
  public.twob__autopost_snapshot(uuid, text, uuid),
  public.twob__autopost_changed(uuid, text, uuid),
  public.twob__prior_derived(uuid, text, uuid[]),
  public.twob__prior_links(uuid, text, jsonb, integer, boolean, uuid),
  public.twob__lock_month_rows(uuid, text[], boolean),
  public.twob__undo_hint(jsonb),
  public.twob__door_merge(jsonb, jsonb, boolean, text),
  public.twob__staff_may(uuid, text),
  public.twob__autopost_books_added(),
  public.twob__autopost_books_changed(),
  public.twob__autopost_docs_added(),
  public.twob__autopost_docs_changed(),
  public.twob__autopost_gone(),
  public.twob__autopost_gone_done()
FROM PUBLIC, anon, authenticated;

COMMIT;
