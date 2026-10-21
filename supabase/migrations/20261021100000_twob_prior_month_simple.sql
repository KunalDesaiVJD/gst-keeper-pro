-- Prior months of Import 2B and 2B Reconciliation: the simple rule (the
-- firm's choice of 21 Oct 2026; docs/2B_RECONCILIATION_FLOW.md §13).
--
-- The firm (17 Oct 2026): "if in prior months, if I do any changes in
-- adding/modified/deletion of any entry in import 2b or 2b reconciliation tab
-- then it should be carried forward to all the months and that permission
-- should only have it with gst manager & superadmin"; "make sure that the
-- changes in prior months should not affect our validation controls that we
-- have placed in pushing the GSTR-3B to portal"; "user cannot change anything
-- which can affect credit/suspended closing balance. Only books can be
-- added/edited/removed." Cases: SORATH BUILDERS (16 Not in 2B rows deleted in
-- filed July 2026, August's carried copies left as they were) and TAMNNA (an
-- invoice changed in July not corrected in later months; Re-run carry
-- forward wiped later months' reclaims).
--
-- 1. Prior month (twob_month_is_prior, twob_month_state): the client's
--    GSTR-3B for the month is Filed, a GSTR-3B (Q) is Filed for its quarter
--    (Filing Status records it at the quarter end), or a later month's
--    GSTR-3B / GSTR-3B (Q) is Filed. Every return ever marked Filed is kept in
--    twob_ever_filed (back-filled here, then written by a trigger), so
--    unlocking the sheets does not open the month again. A return marked
--    Filed by mistake is reopened by a GST Manager or the superadmin, with a
--    reason (twob_reopen_filed).
-- 2. In a prior month only a GST Manager or the superadmin changes anything,
--    and only books entries: Not in 2B and Not in Books rows and the Import
--    2B books register. 2B documents, reversal / reclaim / Expense out / book
--    entry / in-2B months, Clear Data, Restore and imports are refused for
--    everyone. Removing an entry or changing its amounts is refused while the
--    entry or a later copy holds a reclaim (Expense out) or a book entry,
--    naming the month ("Sep-26 has reclaimed this entry; undo that reclaim
--    first"); its date, supplier, number and GSTIN may change.
-- 3. One door: twob_prior_books_apply(p_actor_id, p_client_id, p_period,
--    p_changes, p_dry_run). Each change in the month and the same change on
--    every later month's carried copy (same document: GSTIN, or both blank and
--    the same supplier; number; date; amounts), twins one copy per month (a
--    copy without its own decision first); an added entry gets a carried copy
--    in every later month already holding a carried list, takes this month as
--    its reversal (in-2B) month, and is refused when the month or a later
--    month already holds it. The rows and copies it changes are locked first.
--    One transaction; p_dry_run returns the preview the screens show first.
-- 4. The guard (twob_guard) on bills_not_in_2b, bills_not_in_books,
--    books_register and twob_import_docs refuses every other write to a prior
--    month; still allowed: a change of the lock columns only (the filing lock,
--    Unlock sheets), a link cleared by its document's deletion, a deleted
--    client's rows, and the writes of this file's functions (the setting
--    twob.write, set with set_config inside them only; PostgREST cannot set
--    it). Moving a row to another month or client is refused in every month,
--    and so is deleting a carried row that holds its own month's decision (a
--    page opened before this change still runs the old delete-and-copy carry).
-- 5. The carry never wipes: filing (an update or a row added as Filed, a
--    quarterly return too; the extension's markFiled) copies into the next
--    month only a list the next month does not hold yet, and never into a
--    prior month (twob_carry_first). Re-run carry forward (twob_carry_rerun)
--    is a GST Manager's or the superadmin's, from the latest filed month into
--    the open month after it, previewed first: it adds the entries the next
--    month lacks, removes carried copies the month no longer holds and keeps
--    those holding the next month's own decision; an entry whose copy differs
--    in amount and holds a decision is named and left alone.
-- 6. Filed figures (twob_filed_figures): before the door first changes a
--    prior month, the month's 2B Reconciliation figures (4B(2)(i), 5.4 and
--    4D(1.2), summed from its live lists as the app sums them) are recorded;
--    every gate that reads that month reads them from then on. Until then the
--    live lists are its figures, as before this change, so applying it
--    changes no gate.
--
-- RLS: unchanged on the four tables (open, as the app has no auth session).
-- twob_ever_filed and twob_filed_figures: select open to public, written only
-- by this file's functions. Re-runnable: CREATE OR REPLACE, IF NOT EXISTS, ON
-- CONFLICT DO NOTHING, triggers dropped and created again. No function
-- carries a SET of a custom setting (a non-superuser cannot create one);
-- twob.write is set at run time with set_config, as app.filing_push is.
-- Tests: supabase/tests/twob_simple/run.sh (applies this file twice, as a
-- role that is not a superuser).
--
-- LIVE APPLY (project gcquafqxbykxkbexcdpy only; never SUPABASE_PROJECT_REF):
--  1. Dry checks, reads only, before applying (figures of 21 Oct 2026 from
--     anon reads):
--       -- Filed returns to record (1,369, of them 31 GSTR-3B (Q)):
--       SELECT count(*), count(*) FILTER (WHERE return_type::text = 'GSTR-3B (Q)')
--         FROM public.filing_status
--        WHERE status::text = 'Filed' AND return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)');
--       -- Filed months whose next month already holds carried rows (a later
--       -- filing of them carries nothing; 739 Not in 2B, 670 Not in Books):
--       SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.bills_not_in_2b b WHERE b.client_id = f.client_id
--                 AND b.period_month = to_char(to_date(f.period_month, 'MM/YYYY') + interval '1 month', 'MM/YYYY') AND b.is_carried_forward)) AS next_2b,
--              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.bills_not_in_books b WHERE b.client_id = f.client_id
--                 AND b.period_month = to_char(to_date(f.period_month, 'MM/YYYY') + interval '1 month', 'MM/YYYY') AND b.is_carried_forward)) AS next_books
--         FROM public.filing_status f
--        WHERE f.status::text = 'Filed' AND f.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)');
--       -- Identical twins in one month and list (4 groups / 8 rows Not in 2B,
--       -- 489 groups / 978 rows Not in Books):
--       SELECT 'bills_not_in_2b', count(*), sum(n) FROM (
--         SELECT count(*) n FROM public.bills_not_in_2b
--          GROUP BY client_id, period_month, upper(regexp_replace(COALESCE(supplier_gstin, ''), '\s', '', 'g')),
--                   CASE WHEN regexp_replace(COALESCE(supplier_gstin, ''), '\s', '', 'g') = '' THEN upper(btrim(supplier_name)) END,
--                   ltrim(regexp_replace(upper(COALESCE(supplier_invoice_number, '')), '[^A-Z0-9]', '', 'g'), '0'),
--                   date, COALESCE(taxable_value, 0), COALESCE(input_igst, 0), COALESCE(input_cgst, 0), COALESCE(input_sgst, 0)
--         HAVING count(*) > 1) x
--       UNION ALL
--       SELECT 'bills_not_in_books', count(*), sum(n) FROM (
--         SELECT count(*) n FROM public.bills_not_in_books
--          GROUP BY client_id, period_month, upper(regexp_replace(COALESCE(supplier_gstin, ''), '\s', '', 'g')),
--                   CASE WHEN regexp_replace(COALESCE(supplier_gstin, ''), '\s', '', 'g') = '' THEN upper(btrim(supplier_name)) END,
--                   ltrim(regexp_replace(upper(COALESCE(supplier_invoice_number, '')), '[^A-Z0-9]', '', 'g'), '0'),
--                   date, COALESCE(taxable_value, 0), COALESCE(input_igst, 0), COALESCE(input_cgst, 0), COALESCE(input_sgst, 0)
--         HAVING count(*) > 1) x;
--       -- Rows whose reversal month is later than their own month (4 of
--       -- 10,037 on 21 Oct 2026; the door refuses removing or re-amounting
--       -- such an entry while that later month is open):
--       SELECT count(*) FROM public.bills_not_in_2b
--        WHERE reversal_month ~* '^[a-z]{3}[ -]?[0-9]{2}$'
--          AND to_date(regexp_replace(reversal_month, '[ -]', '', 'g'), 'MonYY') > to_date(period_month, 'MM/YYYY');
--       -- Nothing of this file there yet, staff_level_of there (20261017100000):
--       SELECT to_regclass('public.twob_ever_filed'), to_regclass('public.twob_filed_figures'),
--              to_regprocedure('public.staff_level_of(uuid)'),
--              (SELECT count(*) FROM pg_proc WHERE proname LIKE 'twob%');   -- NULL, NULL, staff_level_of, 0
--       -- The filing trigger as 20260814190000 left it (BEFORE UPDATE only):
--       SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.filing_status'::regclass AND NOT tgisinternal;
--  2. Apply this file as one statement batch (it is one transaction). It
--     needs no superuser: no function stores a custom setting.
--  3. Check (reads only):
--       SELECT count(*) FROM public.twob_ever_filed;                 -- = step 1's first count
--       SELECT count(*) FROM public.twob_filed_figures;              -- 0: figures are recorded at a month's first change
--       SELECT tgrelid::regclass, tgname FROM pg_trigger WHERE tgname IN ('trg_twob_prior_guard', 'trg_twob_record_filed', 'trigger_auto_lock_on_filed');
--                                                                     -- 4 guards, the record trigger, the filing trigger (INSERT OR UPDATE)
--       SELECT has_function_privilege('anon', 'public.twob_prior_books_apply(uuid, uuid, text, jsonb, boolean)', 'EXECUTE'),  -- true
--              has_function_privilege('anon', 'public.twob_reopen_filed(uuid, uuid, text, text, text)', 'EXECUTE'),         -- true
--              has_function_privilege('anon', 'public.twob_carry_first(uuid, text)', 'EXECUTE'),                             -- false
--              to_regprocedure('public.twob_carry_after_filing(uuid, text)');                                                 -- NULL
--     and with the anon key (POST /rest/v1/rpc/...): twob_month_state for SORATH BUILDERS
--     (73449b01-54bd-405d-84ee-0f8877b296d2) and 07/2026 gives is_prior true; for a
--     client's month after its latest filed one, false.
--  4. Deploy the app built from this commit (it reads twob_month_state; before
--     step 2 its screens show every month read-only). Then ask everyone to
--     reload every open GST Keeper tab: a tab opened before the deploy still
--     runs the old carry and Restore. The database refuses their writes to a
--     prior month and their deletion of a carried entry that holds its own
--     month's decision, but an old tab's Restore of an open month whose
--     carried entries hold decisions can leave the month doubled.
--  5. SORATH BUILDERS: nothing to remove. A delete-and-copy re-run of
--     20 Oct 2026 (09:46 UTC) already brought August and September in line
--     with July. Confirm with Filing Status, Re-run carry forward on Aug-26
--     (the latest filed month): the preview shows 0 to add and 0 to remove.
--     Before anyone Posts July, delete July's books register row PERFECT
--     INDUSTRIES 19/26-27 (c379891a-6a14-4d7d-a64c-bcf448ceca3b, Not in 2B,
--     no longer linked) on Import 2B, or Post is refused: July's list already
--     holds that invoice.


BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Months
-- ---------------------------------------------------------------------------
-- "07/2026" -> a running month number (year * 12 + month - 1); NULL when the
-- text is not MM/YYYY.
CREATE OR REPLACE FUNCTION public.twob_period_key(p_period text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN p_period ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'
              THEN substr(p_period, 4, 4)::integer * 12 + substr(p_period, 1, 2)::integer - 1 END;
$$;

CREATE OR REPLACE FUNCTION public.twob_period_of_key(p_key integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN p_key IS NOT NULL THEN lpad((p_key % 12 + 1)::text, 2, '0') || '/' || (p_key / 12)::text END;
$$;

-- "07/2026" -> "Jul-26", as messages name a month.
CREATE OR REPLACE FUNCTION public.twob_month_name(p_period text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN public.twob_period_key(p_period) IS NOT NULL
              THEN (ARRAY['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])[substr(p_period, 1, 2)::integer]
                   || '-' || substr(p_period, 6, 2)
              ELSE p_period END;
$$;

-- "07/2026" -> "Jul 26", the label the month columns hold (postImport2B's
-- periodMonthLabel).
CREATE OR REPLACE FUNCTION public.twob_period_label(p_period text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN public.twob_period_key(p_period) IS NOT NULL
              THEN (ARRAY['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])[substr(p_period, 1, 2)::integer]
                   || ' ' || substr(p_period, 6, 2) END;
$$;

-- Whether a month label (reversal_month, reclaim_month, ...) names p_period,
-- exactly as the app matches it (monthMatches in src/lib/itcAutoLink.ts and
-- its copies): the month's three letters and the year's last digit, anywhere
-- in the label, ignoring case.
CREATE OR REPLACE FUNCTION public.twob_label_matches(p_label text, p_period text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN public.twob_period_key(p_period) IS NOT NULL AND p_label IS NOT NULL
              THEN strpos(lower(p_label), (ARRAY['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])[substr(p_period, 1, 2)::integer]) > 0
                   AND strpos(lower(p_label), substr(p_period, 7, 1)) > 0
              ELSE false END;
$$;

-- The last month a Filed return covers: its own month, or for a GSTR-3B (Q)
-- the end of its quarter (Filing Status records a quarterly return at the
-- quarter end; quarters are Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar).
CREATE OR REPLACE FUNCTION public.twob_cover_key(p_return_type text, p_period text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN p_return_type = 'GSTR-3B (Q)' THEN k + 2 - k % 3 ELSE k END
    FROM (SELECT public.twob_period_key(p_period) AS k) x;
$$;

-- Every GSTR-3B / GSTR-3B (Q) ever marked Filed, so unlocking the sheets
-- (Filing Status sets the return back to Prepared Pending) does not open the
-- month again. Written only by the trigger below and twob_reopen_filed (a
-- return marked Filed by mistake: reopened_at, with who and why).
CREATE TABLE IF NOT EXISTS public.twob_ever_filed (
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  return_type    text NOT NULL,
  period_month   text NOT NULL,
  cover_key      integer GENERATED ALWAYS AS (public.twob_cover_key(return_type, period_month)) STORED,
  first_filed_at timestamptz NOT NULL DEFAULT now(),
  reopened_at    timestamptz,
  reopened_by    uuid,
  reopen_reason  text,
  PRIMARY KEY (client_id, return_type, period_month)
);
COMMENT ON TABLE public.twob_ever_filed IS
  'Every GSTR-3B / GSTR-3B (Q) ever marked Filed (20261021100000). A month it covers, and every month before it, is a prior '
  'month for Import 2B and 2B Reconciliation (twob_month_is_prior), even after the sheets are unlocked, until a GST Manager '
  'or the superadmin reopens a return marked Filed by mistake (twob_reopen_filed: reopened_at, reopened_by, reopen_reason; '
  'the last reopen stays recorded when it is filed again). Written by the filing_status trigger and that function only.';
CREATE INDEX IF NOT EXISTS idx_twob_ever_filed_cover ON public.twob_ever_filed (client_id, cover_key) WHERE reopened_at IS NULL;
ALTER TABLE public.twob_ever_filed ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view twob_ever_filed" ON public.twob_ever_filed;
CREATE POLICY "Anyone can view twob_ever_filed" ON public.twob_ever_filed FOR SELECT TO public USING (true);
GRANT SELECT ON public.twob_ever_filed TO anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.twob_ever_filed FROM anon, authenticated;

INSERT INTO public.twob_ever_filed (client_id, return_type, period_month, first_filed_at)
SELECT f.client_id, f.return_type::text, f.period_month, COALESCE(f.filed_date::timestamptz, f.updated_at, now())
  FROM public.filing_status f
 WHERE f.status::text = 'Filed' AND f.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)')
   AND public.twob_period_key(f.period_month) IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.twob_record_filed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status::text = 'Filed' AND NEW.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)')
     AND public.twob_period_key(NEW.period_month) IS NOT NULL THEN
    INSERT INTO public.twob_ever_filed AS e (client_id, return_type, period_month)
    VALUES (NEW.client_id, NEW.return_type::text, NEW.period_month)
    ON CONFLICT (client_id, return_type, period_month) DO UPDATE
      SET reopened_at = NULL, first_filed_at = now()
      WHERE e.reopened_at IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_twob_record_filed ON public.filing_status;
CREATE TRIGGER trg_twob_record_filed AFTER INSERT OR UPDATE ON public.filing_status
  FOR EACH ROW EXECUTE FUNCTION public.twob_record_filed();

-- The latest month of the client that is prior: the furthest month a return
-- marked Filed (now, or ever, and not reopened) covers. NULL when none.
CREATE OR REPLACE FUNCTION public.twob_prior_through_key(p_client_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT max(e.cover_key) FROM public.twob_ever_filed e
   WHERE e.client_id = p_client_id AND e.reopened_at IS NULL;
$$;

-- Prior: the client's GSTR-3B for the month is Filed, or a GSTR-3B (Q) is
-- Filed for the quarter holding it, or any later month of the client has a
-- Filed GSTR-3B / GSTR-3B (Q). A month once Filed stays prior when its
-- sheets are unlocked. One index probe (the guard runs it for every row).
CREATE OR REPLACE FUNCTION public.twob_month_is_prior(p_client_id uuid, p_period text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.twob_ever_filed e
                  WHERE e.client_id = p_client_id AND e.reopened_at IS NULL
                    AND e.cover_key >= public.twob_period_key(p_period));
$$;

-- Filed and locked now: the lock an entry written into the month takes.
CREATE OR REPLACE FUNCTION public.twob_month_locked(p_client_id uuid, p_period text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.filing_status f
                  WHERE f.client_id = p_client_id AND f.status::text = 'Filed' AND COALESCE(f.is_locked, false)
                    AND f.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)')
                    AND public.twob_period_key(p_period) BETWEEN public.twob_period_key(f.period_month)
                        - CASE WHEN f.return_type::text = 'GSTR-3B (Q)' THEN 2 ELSE 0 END
                        AND public.twob_cover_key(f.return_type::text, f.period_month));
$$;

-- What the screens read (src/lib/twobPriorMonth.ts): whether the month is
-- prior, the latest prior month, and the later months that hold entries.
CREATE OR REPLACE FUNCTION public.twob_month_state(p_client_id uuid, p_period text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key integer := public.twob_period_key(p_period);
  v_through integer;
  v_later jsonb;
BEGIN
  IF p_client_id IS NULL OR v_key IS NULL THEN
    RETURN jsonb_build_object('is_prior', false, 'prior_through', NULL, 'later_months', '[]'::jsonb);
  END IF;
  v_through := public.twob_prior_through_key(p_client_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'period', x.period_month, 'rows_2b', x.r2, 'carried_2b', x.c2, 'rows_books', x.rb, 'carried_books', x.cb)
           ORDER BY x.k), '[]'::jsonb)
    INTO v_later
    FROM (SELECT u.period_month, public.twob_period_key(u.period_month) AS k,
                 sum(u.r2)::integer AS r2, sum(u.c2)::integer AS c2, sum(u.rb)::integer AS rb, sum(u.cb)::integer AS cb
            FROM (SELECT t.period_month, 1 AS r2, CASE WHEN t.is_carried_forward THEN 1 ELSE 0 END AS c2, 0 AS rb, 0 AS cb
                    FROM public.bills_not_in_2b t WHERE t.client_id = p_client_id
                  UNION ALL
                  SELECT t.period_month, 0, 0, 1, CASE WHEN t.is_carried_forward THEN 1 ELSE 0 END
                    FROM public.bills_not_in_books t WHERE t.client_id = p_client_id) u
           GROUP BY u.period_month) x
   WHERE x.k > v_key;
  RETURN jsonb_build_object(
    'is_prior', COALESCE(v_key <= v_through, false),
    'prior_through', public.twob_period_of_key(v_through),
    'later_months', v_later);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The same document
-- ---------------------------------------------------------------------------
-- As src/utils/matchTwob.ts normalises them: an invoice number without case,
-- punctuation or leading zeros; a GSTIN without case or spaces; a supplier
-- name without case or repeated spaces.
CREATE OR REPLACE FUNCTION public.twob_norm_no(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ltrim(regexp_replace(upper(COALESCE(p, '')), '[^A-Z0-9]', '', 'g'), '0');
$$;

CREATE OR REPLACE FUNCTION public.twob_norm_gstin(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(upper(COALESCE(p, '')), '\s', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.twob_norm_name(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(upper(btrim(COALESCE(p, ''))), '\s+', ' ', 'g');
$$;

-- Who issued it and which invoice: the same supplier GSTIN (or both blank
-- and the same supplier name), the same invoice number and date.
CREATE OR REPLACE FUNCTION public.twob_doc_ident(p_gstin text, p_name text, p_number text, p_date date)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT concat_ws('|', public.twob_norm_gstin(p_gstin),
                   CASE WHEN public.twob_norm_gstin(p_gstin) = '' THEN public.twob_norm_name(p_name) ELSE '' END,
                   public.twob_norm_no(p_number), p_date::text);
$$;

-- One document: the same invoice (twob_doc_ident) with the same amounts.
CREATE OR REPLACE FUNCTION public.twob_doc_key(
  p_gstin text, p_name text, p_number text, p_date date,
  p_taxable numeric, p_igst numeric, p_cgst numeric, p_sgst numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT concat_ws('|', public.twob_doc_ident(p_gstin, p_name, p_number, p_date),
                   round(COALESCE(p_taxable, 0), 2)::text, round(COALESCE(p_igst, 0), 2)::text,
                   round(COALESCE(p_cgst, 0), 2)::text, round(COALESCE(p_sgst, 0), 2)::text);
$$;

-- "Sep 26" (as the month columns hold it) -> "Sep-26", for messages.
CREATE OR REPLACE FUNCTION public.twob_label_name(p_label text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(btrim(COALESCE(p_label, '')), '\s+', '-', 'g');
$$;

CREATE INDEX IF NOT EXISTS idx_bills_not_in_2b_client_period ON public.bills_not_in_2b (client_id, period_month);
CREATE INDEX IF NOT EXISTS idx_bills_not_in_books_client_period ON public.bills_not_in_books (client_id, period_month);
CREATE INDEX IF NOT EXISTS idx_bills_not_in_2b_carried_doc
  ON public.bills_not_in_2b (client_id, public.twob_norm_no(supplier_invoice_number), date) WHERE is_carried_forward;
CREATE INDEX IF NOT EXISTS idx_bills_not_in_books_carried_doc
  ON public.bills_not_in_books (client_id, public.twob_norm_no(supplier_invoice_number), date) WHERE is_carried_forward;

-- An entry as the screens name it (and the preview lists it).
CREATE OR REPLACE FUNCTION public.twob__entry_json(p_row jsonb, p_message text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'id', p_row ->> 'id', 'period', p_row ->> 'period_month', 'date', p_row ->> 'date',
    'supplier_name', p_row ->> 'supplier_name', 'supplier_invoice_number', p_row ->> 'supplier_invoice_number',
    'tax', round(COALESCE((p_row ->> 'input_igst')::numeric, 0) + COALESCE((p_row ->> 'input_cgst')::numeric, 0)
                 + COALESCE((p_row ->> 'input_sgst')::numeric, 0), 2),
    'message', p_message));
$$;

-- The decision a ledger row holds (a reclaim or Expense out on Not in 2B, a
-- book entry on Not in Books), as the refusal names it; NULL when none.
-- p_period: the month holding the row, named when the decision has no month.
CREATE OR REPLACE FUNCTION public.twob__decision_message(p_table text, p_row jsonb, p_period text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_table = 'bills_not_in_2b' AND p_row ->> 'reclaim_subtype' = 'EXPENSE_OUT' THEN
      COALESCE(NULLIF(public.twob_label_name(p_row ->> 'reclaim_month'), ''), public.twob_month_name(p_period))
        || ' has expensed out this entry; undo that first'
    WHEN p_table = 'bills_not_in_2b' AND (NULLIF(btrim(p_row ->> 'reclaim_month'), '') IS NOT NULL OR p_row ->> 'reclaim_subtype' IS NOT NULL) THEN
      COALESCE(NULLIF(public.twob_label_name(p_row ->> 'reclaim_month'), ''), public.twob_month_name(p_period))
        || ' has reclaimed this entry; undo that reclaim first'
    WHEN p_table = 'bills_not_in_books' AND NULLIF(btrim(p_row ->> 'book_entry_month'), '') IS NOT NULL THEN
      public.twob_label_name(p_row ->> 'book_entry_month') || ' has booked this entry; undo that book entry first'
  END;
$$;

CREATE OR REPLACE FUNCTION public.twob__entry_name(p_row jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(btrim(concat_ws(' ', NULLIF(btrim(COALESCE(p_row ->> 'supplier_name', '')), ''),
                                     NULLIF(btrim(COALESCE(p_row ->> 'supplier_invoice_number', '')), ''))), '');
$$;

-- ---------------------------------------------------------------------------
-- 3. Filed figures
-- ---------------------------------------------------------------------------
-- A prior month's 2B Reconciliation figures as they stood before the door
-- first changed its books entries: 4B(2)(i) (rows whose reversal month names
-- the month), 5.4 (reclaims naming it, Expense out aside) and 4D(1.2) (its
-- Expense outs), summed from the month's own Not in 2B list as the app sums
-- them (src/lib/itcAutoLink.ts). Every gate that reads the month (its
-- Suspended Reco, the next month's GST Receivable Reco, ITC Summary, the
-- GSTR-3B draft) reads these once they exist, so a GST Manager's correction
-- moves only the Suspended Reco books side. No row: the live lists, as before.
CREATE TABLE IF NOT EXISTS public.twob_filed_figures (
  client_id         uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month      text NOT NULL,
  reversal_igst     numeric NOT NULL DEFAULT 0,
  reversal_cgst     numeric NOT NULL DEFAULT 0,
  reversal_sgst     numeric NOT NULL DEFAULT 0,
  reclaim_igst      numeric NOT NULL DEFAULT 0,
  reclaim_cgst      numeric NOT NULL DEFAULT 0,
  reclaim_sgst      numeric NOT NULL DEFAULT 0,
  expense_out_igst  numeric NOT NULL DEFAULT 0,
  expense_out_cgst  numeric NOT NULL DEFAULT 0,
  expense_out_sgst  numeric NOT NULL DEFAULT 0,
  frozen_at         timestamptz NOT NULL DEFAULT now(),
  frozen_by         uuid,
  PRIMARY KEY (client_id, period_month)
);
COMMENT ON TABLE public.twob_filed_figures IS
  'A prior month''s 4B(2)(i), 5.4 and 4D(1.2) from its Not in 2B list, recorded just before twob_prior_books_apply first '
  'changed the month (20261021100000; docs/2B_RECONCILIATION_FLOW.md §13). The gates read these instead of the live list '
  'once they exist. Removed only when twob_reopen_filed opens the month again.';
ALTER TABLE public.twob_filed_figures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view twob_filed_figures" ON public.twob_filed_figures;
CREATE POLICY "Anyone can view twob_filed_figures" ON public.twob_filed_figures FOR SELECT TO public USING (true);
GRANT SELECT ON public.twob_filed_figures TO anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.twob_filed_figures FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.twob__freeze_figures(p_client_id uuid, p_periods text[], p_actor_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.twob_filed_figures (client_id, period_month,
    reversal_igst, reversal_cgst, reversal_sgst, reclaim_igst, reclaim_cgst, reclaim_sgst,
    expense_out_igst, expense_out_cgst, expense_out_sgst, frozen_by)
  SELECT p_client_id, m.p,
         COALESCE(sum(b.input_igst) FILTER (WHERE r.rev), 0), COALESCE(sum(b.input_cgst) FILTER (WHERE r.rev), 0),
         COALESCE(sum(b.input_sgst) FILTER (WHERE r.rev), 0),
         COALESCE(sum(b.input_igst) FILTER (WHERE r.rcl AND NOT r.exo), 0), COALESCE(sum(b.input_cgst) FILTER (WHERE r.rcl AND NOT r.exo), 0),
         COALESCE(sum(b.input_sgst) FILTER (WHERE r.rcl AND NOT r.exo), 0),
         COALESCE(sum(b.input_igst) FILTER (WHERE r.rcl AND r.exo), 0), COALESCE(sum(b.input_cgst) FILTER (WHERE r.rcl AND r.exo), 0),
         COALESCE(sum(b.input_sgst) FILTER (WHERE r.rcl AND r.exo), 0),
         p_actor_id
    FROM (SELECT DISTINCT x AS p FROM unnest(p_periods) x WHERE public.twob_period_key(x) IS NOT NULL) m
    LEFT JOIN public.bills_not_in_2b b ON b.client_id = p_client_id AND b.period_month = m.p
    LEFT JOIN LATERAL (SELECT public.twob_label_matches(b.reversal_month, m.p) AS rev,
                              public.twob_label_matches(b.reclaim_month, m.p) AS rcl,
                              COALESCE(b.reclaim_subtype = 'EXPENSE_OUT', false) AS exo) r ON true
   GROUP BY m.p
  ON CONFLICT (client_id, period_month) DO NOTHING;
$$;

-- ---------------------------------------------------------------------------
-- 4. The guard
-- ---------------------------------------------------------------------------
-- A row of a prior month is written only by twob_prior_books_apply (twob.write
-- = 'rpc') or by a system function (twob.write = 'system': the filing carry,
-- Re-run). The setting is set, with set_config for the transaction, only by
-- the SECURITY DEFINER functions of this file, which put it back before they
-- return; PostgREST cannot set it. Allowed for everyone besides: a change of
-- the lock columns only (the filing lock, Unlock sheets), a link cleared by
-- its document's deletion (ON DELETE SET NULL), and the rows of a client
-- being deleted. In every month: moving a row to another month or client is
-- refused, and so is deleting a carried row that holds a decision of its own
-- (a reclaim, an Expense out, a book entry), as a page opened before this
-- change does when it carries or re-runs the old way.
CREATE OR REPLACE FUNCTION public.twob_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text := COALESCE(current_setting('twob.write', true), '');
  v_stamps text[] := ARRAY['is_locked', 'updated_at', 'updated_by', 'version'];
  v_links text[] := ARRAY['source_book_id', 'source_doc_id', 'reclaimed_via_doc_id', 'amends_doc_id'];
  v_old jsonb;
  v_new jsonb;
  v_client uuid;
  v_period text;
  v_msg text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.period_month IS DISTINCT FROM OLD.period_month) THEN
    RAISE EXCEPTION 'An entry cannot move to another month or client. Delete it and add it again in the right month.';
  END IF;
  IF v_mode IN ('rpc', 'system') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_client := NEW.client_id;
    v_period := NEW.period_month;
  ELSE
    v_client := OLD.client_id;
    v_period := OLD.period_month;
  END IF;

  IF EXISTS (SELECT 1 FROM public.twob_ever_filed e
              WHERE e.client_id = v_client AND e.reopened_at IS NULL
                AND e.cover_key >= public.twob_period_key(v_period)) THEN
    -- A prior month.
    IF TG_OP <> 'INSERT' AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_client) THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;   -- the rows of a client being deleted go with it
    END IF;
    IF TG_OP = 'UPDATE' THEN
      v_old := to_jsonb(OLD) - v_stamps;
      v_new := to_jsonb(NEW) - v_stamps;
      IF v_old = v_new THEN
        RETURN NEW;
      END IF;
      IF (v_old - v_links) = (v_new - v_links)
         AND NOT EXISTS (SELECT 1 FROM unnest(v_links) k
                          WHERE v_new ? k AND v_new -> k <> 'null'::jsonb AND v_new -> k IS DISTINCT FROM v_old -> k) THEN
        RETURN NEW;
      END IF;
    END IF;
    IF TG_TABLE_NAME = 'twob_import_docs' THEN
      RAISE EXCEPTION 'This month is filed. Its 2B documents cannot change. Only a GST Manager or the superadmin can change its books entries, from Import 2B or 2B Reconciliation.';
    END IF;
    RAISE EXCEPTION 'This month is filed. Only a GST Manager or the superadmin can change its books entries, from Import 2B or 2B Reconciliation.';
  END IF;

  -- An open month: a carried entry holding its own decision is not deleted
  -- directly (undo the decision first).
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME IN ('bills_not_in_2b', 'bills_not_in_books') THEN
    v_old := to_jsonb(OLD);
    IF COALESCE((v_old ->> 'is_carried_forward')::boolean, false) THEN
      v_msg := public.twob__decision_message(TG_TABLE_NAME, v_old, OLD.period_month);
      IF v_msg IS NOT NULL AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_client) THEN
        RAISE EXCEPTION '%', COALESCE(public.twob__entry_name(v_old) || ': ', '') || v_msg || ', then remove it.';
      END IF;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_twob_prior_guard ON public.bills_not_in_2b;
CREATE TRIGGER trg_twob_prior_guard BEFORE INSERT OR UPDATE OR DELETE ON public.bills_not_in_2b
  FOR EACH ROW EXECUTE FUNCTION public.twob_guard();
DROP TRIGGER IF EXISTS trg_twob_prior_guard ON public.bills_not_in_books;
CREATE TRIGGER trg_twob_prior_guard BEFORE INSERT OR UPDATE OR DELETE ON public.bills_not_in_books
  FOR EACH ROW EXECUTE FUNCTION public.twob_guard();
DROP TRIGGER IF EXISTS trg_twob_prior_guard ON public.books_register;
CREATE TRIGGER trg_twob_prior_guard BEFORE INSERT OR UPDATE OR DELETE ON public.books_register
  FOR EACH ROW EXECUTE FUNCTION public.twob_guard();
DROP TRIGGER IF EXISTS trg_twob_prior_guard ON public.twob_import_docs;
CREATE TRIGGER trg_twob_prior_guard BEFORE INSERT OR UPDATE OR DELETE ON public.twob_import_docs
  FOR EACH ROW EXECUTE FUNCTION public.twob_guard();

-- ---------------------------------------------------------------------------
-- 5. The carry: first carry only
-- ---------------------------------------------------------------------------
-- Copies a month's two lists into the next month, each list only when the
-- next month holds no carried rows on it yet (the first carry), and never
-- into a prior month (the door is its only writer). Otherwise it does
-- nothing, so a later month's reclaims and book entries stay. Internal:
-- called by the filing trigger.
CREATE OR REPLACE FUNCTION public.twob_carry_first(p_client_id uuid, p_period text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev text := current_setting('twob.write', true);
  v_key integer := public.twob_period_key(p_period);
  v_next text;
  v_skip_2b boolean;
  v_skip_books boolean;
  n2b integer := 0;
  nbk integer := 0;
BEGIN
  IF p_client_id IS NULL OR v_key IS NULL THEN
    RETURN NULL;
  END IF;
  v_next := public.twob_period_of_key(v_key + 1);
  IF public.twob_month_is_prior(p_client_id, v_next) THEN
    RETURN jsonb_build_object('period', p_period, 'next_period', v_next, 'next_prior', true,
      'carried_2b', 0, 'carried_books', 0, 'skipped_2b', true, 'skipped_books', true);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  PERFORM set_config('twob.write', 'system', true);
  v_skip_2b := EXISTS (SELECT 1 FROM public.bills_not_in_2b
                        WHERE client_id = p_client_id AND period_month = v_next AND is_carried_forward);
  v_skip_books := EXISTS (SELECT 1 FROM public.bills_not_in_books
                           WHERE client_id = p_client_id AND period_month = v_next AND is_carried_forward);
  IF NOT v_skip_2b THEN
    INSERT INTO public.bills_not_in_2b (
      client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
      taxable_value, input_igst, input_cgst, input_sgst,
      period_month, reversal_month, reclaim_month, reclaim_subtype, is_carried_forward)
    SELECT client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
           taxable_value, input_igst, input_cgst, input_sgst,
           v_next, reversal_month, reclaim_month, reclaim_subtype, true
      FROM public.bills_not_in_2b
     WHERE client_id = p_client_id AND period_month = p_period
     ORDER BY date, id;
    GET DIAGNOSTICS n2b = ROW_COUNT;
  END IF;
  IF NOT v_skip_books THEN
    INSERT INTO public.bills_not_in_books (
      client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
      taxable_value, input_igst, input_cgst, input_sgst,
      period_month, book_entry_month, bill_in_2b_month, is_carried_forward)
    SELECT client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
           taxable_value, input_igst, input_cgst, input_sgst,
           v_next, book_entry_month, bill_in_2b_month, true
      FROM public.bills_not_in_books
     WHERE client_id = p_client_id AND period_month = p_period
     ORDER BY date, id;
    GET DIAGNOSTICS nbk = ROW_COUNT;
  END IF;
  PERFORM set_config('twob.write', COALESCE(v_prev, ''), true);
  RETURN jsonb_build_object('period', p_period, 'next_period', v_next,
    'carried_2b', n2b, 'carried_books', nbk, 'skipped_2b', v_skip_2b, 'skipped_books', v_skip_books);
END;
$$;

-- Marking a GSTR-3B or GSTR-3B (Q) Filed (an update, or a row added as Filed:
-- the app's new rows and the extension's markFiled) locks the month's sheets
-- and makes the first carry into the next month (the month after, as the app
-- has always carried, a quarterly return included). An upsert whose row
-- already exists is handled by its update.
CREATE OR REPLACE FUNCTION public.auto_lock_on_filed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev text := current_setting('twob.write', true);
BEGIN
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM public.filing_status f
                                   WHERE f.client_id = NEW.client_id AND f.return_type = NEW.return_type
                                     AND f.period_month = NEW.period_month) THEN
    RETURN NEW;
  END IF;
  IF NEW.status::text = 'Filed' AND (TG_OP = 'INSERT' OR OLD.status IS NULL OR OLD.status::text <> 'Filed') THEN
    NEW.filed_date := COALESCE(NEW.filed_date, CURRENT_DATE);
    IF NEW.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)') THEN
      PERFORM set_config('twob.write', 'system', true);
      NEW.is_locked := TRUE;
      UPDATE public.bills_not_in_2b SET is_locked = TRUE
       WHERE client_id = NEW.client_id AND period_month = NEW.period_month AND is_locked IS DISTINCT FROM TRUE;
      UPDATE public.bills_not_in_books SET is_locked = TRUE
       WHERE client_id = NEW.client_id AND period_month = NEW.period_month AND is_locked IS DISTINCT FROM TRUE;
      UPDATE public.itc_summaries SET is_locked = TRUE
       WHERE client_id = NEW.client_id AND period_month = NEW.period_month;
      PERFORM public.twob_carry_first(NEW.client_id, NEW.period_month);
      PERFORM set_config('twob.write', COALESCE(v_prev, ''), true);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_auto_lock_on_filed ON public.filing_status;
CREATE TRIGGER trigger_auto_lock_on_filed BEFORE INSERT OR UPDATE ON public.filing_status
  FOR EACH ROW EXECUTE FUNCTION public.auto_lock_on_filed();

-- The app no longer carries after filing itself: the trigger above does it.
DROP FUNCTION IF EXISTS public.twob_carry_after_filing(uuid, text);

-- Re-run carry forward (Filing Status), a GST Manager or the superadmin only:
-- one list of the latest filed month against the next (open) month's carried
-- copies, document by document (twob_doc_key, twins one to one): entries to
-- add (no carried copy of the document in the next month), copies to remove
-- (no counterpart in the month and no decision of their own: a reclaim /
-- Expense out, or a book entry), copies kept because they hold one, and
-- conflicts: an entry whose next-month copy is the same invoice with other
-- amounts and holds a decision (TAMNNA's T-2). A conflict neither adds the
-- entry (that would let the invoice be reclaimed twice) nor drops the copy;
-- it is named until the decision is undone. p_dry_run: what it would do.
CREATE OR REPLACE FUNCTION public.twob__rerun_list(
  p_table text, p_client_id uuid, p_period text, p_next text, p_dry_run boolean)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_add uuid[];
  v_remove uuid[];
  v_keep uuid[];
  v_conflicts jsonb;
  v_out jsonb;
  v_locked boolean := public.twob_month_locked(p_client_id, p_next);
  v_dec text := CASE WHEN p_table = 'bills_not_in_2b'
                     THEN '(NULLIF(btrim(t.reclaim_month), '''') IS NOT NULL OR t.reclaim_subtype IS NOT NULL)'
                     ELSE '(NULLIF(btrim(t.book_entry_month), '''') IS NOT NULL)' END;
  v_cols text := 't.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date';
  v_amts text := 't.taxable_value, t.input_igst, t.input_cgst, t.input_sgst';
BEGIN
  IF NOT p_dry_run THEN
    -- The next month's copies, locked: a decision made meanwhile is seen.
    EXECUTE format('SELECT 1 FROM public.%I t WHERE t.client_id = $1 AND t.period_month = $2 AND t.is_carried_forward FOR UPDATE', p_table)
      USING p_client_id, p_next;
  END IF;
  EXECUTE format($q$
    WITH s AS (
      SELECT t.id, public.twob_doc_key(%3$s, %4$s) AS key, public.twob_doc_ident(%3$s) AS ident
        FROM public.%1$I t WHERE t.client_id = $1 AND t.period_month = $2),
    sn AS (SELECT s.*, row_number() OVER (PARTITION BY s.key ORDER BY s.id) AS rn FROM s),
    c AS (
      SELECT t.id, public.twob_doc_key(%3$s, %4$s) AS key, public.twob_doc_ident(%3$s) AS ident, %2$s AS decided
        FROM public.%1$I t WHERE t.client_id = $1 AND t.period_month = $3 AND t.is_carried_forward),
    cn AS (SELECT c.*, row_number() OVER (PARTITION BY c.key ORDER BY c.decided DESC, c.id) AS rn FROM c),
    j AS (SELECT sn.id AS sid, sn.ident AS sident, cn.id AS cid, cn.ident AS cident, cn.decided
            FROM sn FULL JOIN cn ON cn.key = sn.key AND cn.rn = sn.rn),
    ls AS (SELECT j.sid, row_number() OVER (PARTITION BY j.sident ORDER BY j.sid) AS rn, j.sident FROM j WHERE j.cid IS NULL),
    lc AS (SELECT j.cid, j.decided, row_number() OVER (PARTITION BY j.cident ORDER BY j.decided DESC, j.cid) AS rn, j.cident
             FROM j WHERE j.sid IS NULL),
    p AS (SELECT ls.sid, lc.cid, COALESCE(lc.decided, false) AS decided
            FROM ls FULL JOIN lc ON lc.cident = ls.sident AND lc.rn = ls.rn)
    SELECT array_agg(p.sid) FILTER (WHERE p.sid IS NOT NULL AND NOT (p.cid IS NOT NULL AND p.decided)),
           array_agg(p.cid) FILTER (WHERE p.cid IS NOT NULL AND NOT p.decided),
           array_agg(p.cid) FILTER (WHERE p.cid IS NOT NULL AND p.decided AND p.sid IS NULL),
           jsonb_agg(jsonb_build_object('entry', p.sid, 'copy', p.cid)) FILTER (WHERE p.sid IS NOT NULL AND p.cid IS NOT NULL AND p.decided)
      FROM p$q$, p_table, v_dec, v_cols, v_amts)
    INTO v_add, v_remove, v_keep, v_conflicts
    USING p_client_id, p_period, p_next;
  v_add := COALESCE(v_add, '{}');
  v_remove := COALESCE(v_remove, '{}');
  v_keep := COALESCE(v_keep, '{}');
  v_conflicts := COALESCE(v_conflicts, '[]'::jsonb);

  EXECUTE format($q$
    SELECT jsonb_build_object(
      'add', COALESCE((SELECT jsonb_agg(public.twob__entry_json(to_jsonb(t), NULL) ORDER BY t.date, t.id)
                         FROM public.%1$I t WHERE t.id = ANY ($1)), '[]'::jsonb),
      'remove', COALESCE((SELECT jsonb_agg(public.twob__entry_json(to_jsonb(t), NULL) ORDER BY t.date, t.id)
                            FROM public.%1$I t WHERE t.id = ANY ($2)), '[]'::jsonb),
      'keep', COALESCE((SELECT jsonb_agg(public.twob__entry_json(to_jsonb(t), public.twob__decision_message(%2$L, to_jsonb(t), $5)) ORDER BY t.date, t.id)
                          FROM public.%1$I t WHERE t.id = ANY ($3)), '[]'::jsonb),
      'conflict', COALESCE((SELECT jsonb_agg(public.twob__entry_json(to_jsonb(c),
                              format('%%s holds it at %%s tax and %%s''s copy at %%s; %%s, then re-run',
                                     public.twob_month_name($6), to_char(es.tax, 'FM99,99,99,99,990.00'),
                                     public.twob_month_name($5), to_char(cs.tax, 'FM99,99,99,99,990.00'),
                                     public.twob__decision_message(%2$L, to_jsonb(c), $5))) ORDER BY c.date, c.id)
                              FROM jsonb_array_elements($4) x
                              JOIN public.%1$I c ON c.id = (x ->> 'copy')::uuid
                              JOIN public.%1$I e ON e.id = (x ->> 'entry')::uuid
                              CROSS JOIN LATERAL (SELECT COALESCE(e.input_igst, 0) + COALESCE(e.input_cgst, 0) + COALESCE(e.input_sgst, 0) AS tax) es
                              CROSS JOIN LATERAL (SELECT COALESCE(c.input_igst, 0) + COALESCE(c.input_cgst, 0) + COALESCE(c.input_sgst, 0) AS tax) cs),
                           '[]'::jsonb))$q$, p_table, p_table)
    INTO v_out
    USING v_add, v_remove, v_keep, v_conflicts, p_next, p_period;

  IF NOT p_dry_run THEN
    IF p_table = 'bills_not_in_2b' THEN
      INSERT INTO public.bills_not_in_2b (
        client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
        taxable_value, input_igst, input_cgst, input_sgst,
        period_month, reversal_month, reclaim_month, reclaim_subtype, is_carried_forward, is_locked)
      SELECT client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
             taxable_value, input_igst, input_cgst, input_sgst,
             p_next, reversal_month, reclaim_month, reclaim_subtype, true, v_locked
        FROM public.bills_not_in_2b WHERE id = ANY (v_add) ORDER BY date, id;
      DELETE FROM public.bills_not_in_2b WHERE id = ANY (v_remove);
    ELSE
      INSERT INTO public.bills_not_in_books (
        client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
        taxable_value, input_igst, input_cgst, input_sgst,
        period_month, book_entry_month, bill_in_2b_month, is_carried_forward, is_locked)
      SELECT client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
             taxable_value, input_igst, input_cgst, input_sgst,
             p_next, book_entry_month, bill_in_2b_month, true, v_locked
        FROM public.bills_not_in_books WHERE id = ANY (v_add) ORDER BY date, id;
      DELETE FROM public.bills_not_in_books WHERE id = ANY (v_remove);
    END IF;
  END IF;
  RETURN v_out;
END;
$$;

-- Re-run runs from the latest filed month into the open month after it, and
-- only while no month after that holds carried entries: a filed next month
-- changes only through the door (which reaches every later month), and an
-- unfiled month carries when it is filed.
CREATE OR REPLACE FUNCTION public.twob_carry_rerun(
  p_actor_id uuid, p_client_id uuid, p_period text, p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev text := current_setting('twob.write', true);
  v_key integer := public.twob_period_key(p_period);
  v_next text;
  v_beyond text;
  v_out jsonb;
BEGIN
  IF p_actor_id IS NULL OR COALESCE(public.staff_level_of(p_actor_id), '') NOT IN ('superadmin', 'gst_manager') THEN
    RAISE EXCEPTION 'Only a GST Manager or the superadmin can re-run the carry forward.';
  END IF;
  IF p_client_id IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'Choose a client and a month.';
  END IF;
  v_next := public.twob_period_of_key(v_key + 1);
  IF NOT public.twob_month_is_prior(p_client_id, p_period) THEN
    RAISE EXCEPTION '% is not filed. Re-run works from a filed month; filing % carries its entries into %.',
      public.twob_month_name(p_period), public.twob_month_name(p_period), public.twob_month_name(v_next);
  END IF;
  IF public.twob_month_is_prior(p_client_id, v_next) THEN
    RAISE EXCEPTION '% is filed too. Re-run works only into a month not yet filed. Correct %''s books entries on Import 2B or 2B Reconciliation: each change reaches the later months.',
      public.twob_month_name(v_next), public.twob_month_name(v_next);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  SELECT public.twob_period_of_key(min(k)) INTO v_beyond
    FROM (SELECT public.twob_period_key(t.period_month) AS k FROM public.bills_not_in_2b t
           WHERE t.client_id = p_client_id AND t.is_carried_forward AND public.twob_period_key(t.period_month) > v_key + 1
          UNION ALL
          SELECT public.twob_period_key(t.period_month) FROM public.bills_not_in_books t
           WHERE t.client_id = p_client_id AND t.is_carried_forward AND public.twob_period_key(t.period_month) > v_key + 1) x;
  IF v_beyond IS NOT NULL THEN
    RAISE EXCEPTION '% already holds carried entries. Re-run works only into the last month that holds them.', public.twob_month_name(v_beyond);
  END IF;
  PERFORM set_config('twob.write', 'system', true);
  v_out := jsonb_build_object(
    'period', p_period, 'next_period', v_next, 'dry_run', p_dry_run,
    'bills_not_in_2b', public.twob__rerun_list('bills_not_in_2b', p_client_id, p_period, v_next, p_dry_run),
    'bills_not_in_books', public.twob__rerun_list('bills_not_in_books', p_client_id, p_period, v_next, p_dry_run));
  PERFORM set_config('twob.write', COALESCE(v_prev, ''), true);
  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Books entries of a prior month: twob_prior_books_apply
-- ---------------------------------------------------------------------------
-- The later months' carried copies of the Not in 2B / Not in Books entries
-- that p_changes updates or removes in p_period, matched once for the whole
-- call (twob_doc_key of each entry as it is now; twins one copy per month, a
-- copy without a decision of its own first). The entries and every candidate
-- copy (same number and date) are locked first, so a decision committed
-- meanwhile is seen and blocks the change. Per copy: its month, the decision
-- it holds (as the refusal names it), and whether its reversal month is its
-- own month (its removal would move that month's 4B(2)(i)).
CREATE OR REPLACE FUNCTION public.twob__match_copies(p_table text, p_client_id uuid, p_period text, p_changes jsonb)
RETURNS TABLE (idx integer, id uuid, period_month text, msg text, own_rev boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_key integer := public.twob_period_key(p_period);
  v_own text := CASE WHEN p_table = 'bills_not_in_2b' THEN 'public.twob_label_matches(t.reversal_month, t.period_month)' ELSE 'false' END;
  v_dec text := CASE WHEN p_table = 'bills_not_in_2b'
                     THEN '(NULLIF(btrim(t.reclaim_month), '''') IS NOT NULL OR t.reclaim_subtype IS NOT NULL)'
                     ELSE '(NULLIF(btrim(t.book_entry_month), '''') IS NOT NULL)' END;
  v_doc text := 'public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date, t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst)';
BEGIN
  EXECUTE format($q$
    SELECT 1 FROM public.%1$I t
     WHERE t.id IN (SELECT NULLIF(x.v ->> 'id', '')::uuid FROM jsonb_array_elements($1) x(v)
                     WHERE x.v ->> 'table' = %1$L AND x.v ->> 'op' IN ('update', 'delete'))
       AND t.client_id = $2 AND t.period_month = $3
     FOR UPDATE$q$, p_table) USING p_changes, p_client_id, p_period;
  EXECUTE format($q$
    SELECT 1 FROM public.%1$I t
      JOIN (SELECT DISTINCT public.twob_norm_no(s.supplier_invoice_number) AS no, s.date
              FROM public.%1$I s
             WHERE s.id IN (SELECT NULLIF(x.v ->> 'id', '')::uuid FROM jsonb_array_elements($1) x(v)
                             WHERE x.v ->> 'table' = %1$L AND x.v ->> 'op' IN ('update', 'delete'))
               AND s.client_id = $2 AND s.period_month = $3) n
        ON public.twob_norm_no(t.supplier_invoice_number) = n.no AND t.date = n.date
     WHERE t.client_id = $2 AND t.is_carried_forward AND public.twob_period_key(t.period_month) > $4
     FOR UPDATE OF t$q$, p_table) USING p_changes, p_client_id, p_period, v_key;
  -- Changes and copies meet on a slot (document key and twin number) looked
  -- up in one jsonb map: a join of the two sets was planned as a nested loop
  -- that re-ran the copies once per change.
  RETURN QUERY EXECUTE format($q$
    WITH ch AS MATERIALIZED (
      SELECT (x.o - 1)::integer AS idx, %2$s AS key,
             public.twob_norm_no(t.supplier_invoice_number) AS no, t.date
        FROM jsonb_array_elements($1) WITH ORDINALITY x(v, o)
        JOIN public.%1$I t ON t.id = NULLIF(x.v ->> 'id', '')::uuid
       WHERE x.v ->> 'table' = %1$L AND x.v ->> 'op' IN ('update', 'delete')
         AND t.client_id = $2 AND t.period_month = $3),
    mp AS MATERIALIZED (
      SELECT COALESCE(jsonb_object_agg(s.slot, s.idx), '{}'::jsonb) AS o
        FROM (SELECT ch.idx, ch.key || '#' || row_number() OVER (PARTITION BY ch.key ORDER BY ch.idx) AS slot FROM ch) s),
    cp AS MATERIALIZED (
      SELECT t.id, t.period_month, public.twob_period_key(t.period_month) AS pk, %2$s AS key,
             CASE WHEN %4$s THEN public.twob__decision_message(%1$L, to_jsonb(t), t.period_month) END AS msg, %3$s AS own_rev
        FROM public.%1$I t
        JOIN (SELECT DISTINCT ch.no, ch.date FROM ch) n
          ON public.twob_norm_no(t.supplier_invoice_number) = n.no AND t.date = n.date
       WHERE t.client_id = $2 AND t.is_carried_forward AND public.twob_period_key(t.period_month) > $4),
    cpn AS MATERIALIZED (
      SELECT cp.*, cp.key || '#' || row_number() OVER (PARTITION BY cp.pk, cp.key ORDER BY (cp.msg IS NOT NULL), cp.id) AS slot FROM cp)
    SELECT (mp.o ->> cpn.slot)::integer, cpn.id, cpn.period_month, cpn.msg, cpn.own_rev
      FROM cpn CROSS JOIN mp
     WHERE mp.o ? cpn.slot
     ORDER BY 1, cpn.pk$q$, p_table, v_doc, v_own, v_dec)
    USING p_changes, p_client_id, p_period, v_key;
END;
$$;

-- The changes that add an entry the month already holds, or that a later
-- month already holds as carried (the same document): the first such month
-- per change. A removed entry is not added back by a later Post this way,
-- and a later month never gets a second copy.
CREATE OR REPLACE FUNCTION public.twob__held_inserts(p_table text, p_client_id uuid, p_period text, p_changes jsonb)
RETURNS TABLE (idx integer, period_month text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_key integer := public.twob_period_key(p_period);
BEGIN
  RETURN QUERY EXECUTE format($q$
    WITH ins AS (
      SELECT (x.o - 1)::integer AS idx, x.v -> 'values' AS v
        FROM jsonb_array_elements($1) WITH ORDINALITY x(v, o)
       WHERE x.v ->> 'table' = %1$L AND x.v ->> 'op' = 'insert'
         AND jsonb_typeof(x.v -> 'values') = 'object'
         AND (x.v -> 'values' ->> 'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
    k AS (
      SELECT ins.idx, (ins.v ->> 'date')::date AS date, public.twob_norm_no(ins.v ->> 'supplier_invoice_number') AS no,
             public.twob_doc_key(ins.v ->> 'supplier_gstin', btrim(ins.v ->> 'supplier_name'), ins.v ->> 'supplier_invoice_number',
                                 (ins.v ->> 'date')::date, (ins.v ->> 'taxable_value')::numeric, (ins.v ->> 'input_igst')::numeric,
                                 (ins.v ->> 'input_cgst')::numeric, (ins.v ->> 'input_sgst')::numeric) AS key
        FROM ins)
    SELECT DISTINCT ON (k.idx) k.idx, t.period_month
      FROM k
      JOIN public.%1$I t ON t.client_id = $2 AND t.date = k.date
       AND public.twob_norm_no(t.supplier_invoice_number) = k.no
       AND public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date,
                               t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst) = k.key
     WHERE t.period_month = $3 OR (t.is_carried_forward AND public.twob_period_key(t.period_month) > $4)
     ORDER BY k.idx, public.twob_period_key(t.period_month)$q$, p_table)
    USING p_changes, p_client_id, p_period, v_key;
END;
$$;

-- Adds an entry to the month and a carried copy of it (no link to Import 2B)
-- to each of p_months, in one statement; returns {id, later: [{period, id}]}.
-- The month column a new entry may hold: its reversal month (Not in 2B) or
-- its in-2B month (Not in Books), already checked to be this month's label,
-- the same on its copies; never a decision. p_locked: the months whose
-- return is Filed and locked (their rows take the lock).
CREATE OR REPLACE FUNCTION public.twob__ledger_insert(
  p_table text, p_client_id uuid, p_period text, p_vals jsonb, p_months text[], p_locked text[], p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF p_table = 'bills_not_in_2b' THEN
    WITH m AS (
      SELECT p_period AS period, false AS carried
      UNION ALL SELECT x, true FROM unnest(COALESCE(p_months, '{}')) x),
    ins AS (
      INSERT INTO public.bills_not_in_2b (
        client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
        taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month, reclaim_subtype,
        is_carried_forward, is_locked, source_book_id, updated_by, updated_at)
      SELECT p_client_id, m.period, (p_vals ->> 'date')::date, btrim(p_vals ->> 'supplier_name'),
             p_vals ->> 'supplier_invoice_number', p_vals ->> 'supplier_gstin',
             COALESCE((p_vals ->> 'taxable_value')::numeric, 0), COALESCE((p_vals ->> 'input_igst')::numeric, 0),
             COALESCE((p_vals ->> 'input_cgst')::numeric, 0), COALESCE((p_vals ->> 'input_sgst')::numeric, 0),
             NULLIF(btrim(COALESCE(p_vals ->> 'reversal_month', '')), ''), NULL, NULL,
             m.carried, m.period = ANY (COALESCE(p_locked, '{}')),
             CASE WHEN m.carried THEN NULL ELSE NULLIF(p_vals ->> 'source_book_id', '')::uuid END,
             p_actor_id, now()
        FROM m
      RETURNING id, period_month, is_carried_forward)
    SELECT jsonb_build_object(
             'id', (SELECT i.id FROM ins i WHERE NOT i.is_carried_forward),
             'later', COALESCE((SELECT jsonb_agg(jsonb_build_object('period', i.period_month, 'action', 'add', 'id', i.id)
                                                 ORDER BY public.twob_period_key(i.period_month))
                                  FROM ins i WHERE i.is_carried_forward), '[]'::jsonb))
      INTO v_out;
  ELSE
    WITH m AS (
      SELECT p_period AS period, false AS carried
      UNION ALL SELECT x, true FROM unnest(COALESCE(p_months, '{}')) x),
    ins AS (
      INSERT INTO public.bills_not_in_books (
        client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
        taxable_value, input_igst, input_cgst, input_sgst, book_entry_month, bill_in_2b_month,
        is_carried_forward, is_locked, source_doc_id, updated_by, updated_at)
      SELECT p_client_id, m.period, (p_vals ->> 'date')::date, btrim(p_vals ->> 'supplier_name'),
             p_vals ->> 'supplier_invoice_number', p_vals ->> 'supplier_gstin',
             COALESCE((p_vals ->> 'taxable_value')::numeric, 0), COALESCE((p_vals ->> 'input_igst')::numeric, 0),
             COALESCE((p_vals ->> 'input_cgst')::numeric, 0), COALESCE((p_vals ->> 'input_sgst')::numeric, 0),
             NULL, NULLIF(btrim(COALESCE(p_vals ->> 'bill_in_2b_month', '')), ''),
             m.carried, m.period = ANY (COALESCE(p_locked, '{}')),
             CASE WHEN m.carried THEN NULL ELSE NULLIF(p_vals ->> 'source_doc_id', '')::uuid END,
             p_actor_id, now()
        FROM m
      RETURNING id, period_month, is_carried_forward)
    SELECT jsonb_build_object(
             'id', (SELECT i.id FROM ins i WHERE NOT i.is_carried_forward),
             'later', COALESCE((SELECT jsonb_agg(jsonb_build_object('period', i.period_month, 'action', 'add', 'id', i.id)
                                                 ORDER BY public.twob_period_key(i.period_month))
                                  FROM ins i WHERE i.is_carried_forward), '[]'::jsonb))
      INTO v_out;
  END IF;
  RETURN v_out;
END;
$$;

-- Writes the changed columns (p_set: date, supplier, number, GSTIN, amounts)
-- on the given rows (a ledger list, or the books register).
CREATE OR REPLACE FUNCTION public.twob__ledger_update(p_table text, p_ids uuid[], p_set jsonb, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format($q$
    UPDATE public.%I t SET
      date = CASE WHEN $1 ? 'date' THEN ($1 ->> 'date')::date ELSE t.date END,
      supplier_name = CASE WHEN $1 ? 'supplier_name' THEN btrim($1 ->> 'supplier_name') ELSE t.supplier_name END,
      supplier_invoice_number = CASE WHEN $1 ? 'supplier_invoice_number' THEN $1 ->> 'supplier_invoice_number' ELSE t.supplier_invoice_number END,
      supplier_gstin = CASE WHEN $1 ? 'supplier_gstin' THEN $1 ->> 'supplier_gstin' ELSE t.supplier_gstin END,
      taxable_value = CASE WHEN $1 ? 'taxable_value' THEN COALESCE(($1 ->> 'taxable_value')::numeric, 0) ELSE t.taxable_value END,
      input_igst = CASE WHEN $1 ? 'input_igst' THEN COALESCE(($1 ->> 'input_igst')::numeric, 0) ELSE t.input_igst END,
      input_cgst = CASE WHEN $1 ? 'input_cgst' THEN COALESCE(($1 ->> 'input_cgst')::numeric, 0) ELSE t.input_cgst END,
      input_sgst = CASE WHEN $1 ? 'input_sgst' THEN COALESCE(($1 ->> 'input_sgst')::numeric, 0) ELSE t.input_sgst END,
      updated_by = $3, updated_at = now()
     WHERE t.id = ANY ($2)$q$, p_table)
    USING p_set, p_ids, p_actor_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.twob__ledger_delete(p_table text, p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_table = 'bills_not_in_2b' THEN
    DELETE FROM public.bills_not_in_2b WHERE id = ANY (p_ids);
  ELSE
    DELETE FROM public.bills_not_in_books WHERE id = ANY (p_ids);
  END IF;
END;
$$;

-- One change of a Not in 2B / Not in Books entry in prior month p_period,
-- and the same change on every later month's carried copy of the entry
-- (p_copies: twob__match_copies' rows for this change). Returns what it did
-- (or would do): this month's effect, each later month touched, or a refusal
-- (then nothing of this change is written). p_months: the later months that
-- hold carried rows on this list (an added entry gets a carried copy in each).
-- p_held: the month already holding an added entry, if any. p_named_books:
-- the books register rows the call names itself (left to their own change).
CREATE OR REPLACE FUNCTION public.twob__apply_ledger(
  p_actor_id uuid, p_client_id uuid, p_period text,
  p_table text, p_op text, p_id uuid, p_vals jsonb, p_months text[], p_locked text[],
  p_copy_ids uuid[], p_copy_periods text[], p_copy_msgs text[], p_copy_own boolean[],
  p_held text, p_named_books uuid[])
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_is2b boolean := p_table = 'bills_not_in_2b';
  v_dec_col text := CASE WHEN p_table = 'bills_not_in_2b' THEN 'reclaim_month' ELSE 'book_entry_month' END;
  v_month_col text := CASE WHEN p_table = 'bills_not_in_2b' THEN 'reversal_month' ELSE 'bill_in_2b_month' END;
  v_link_col text := CASE WHEN p_table = 'bills_not_in_2b' THEN 'source_book_id' ELSE 'source_doc_id' END;
  v_desc text[] := ARRAY['date', 'supplier_name', 'supplier_invoice_number', 'supplier_gstin'];
  v_amt text[] := ARRAY['taxable_value', 'input_igst', 'input_cgst', 'input_sgst'];
  v_fixed text[] := ARRAY['reversal_month', 'reclaim_month', 'reclaim_subtype', 'reclaimed_via_doc_id',
                          'book_entry_month', 'bill_in_2b_month', 'source_book_id', 'source_doc_id',
                          'is_carried_forward', 'is_locked', 'client_id', 'period_month'];
  v_ignored text[] := ARRAY['id', 'updated_at', 'updated_by', 'version', 'created_at'];
  v_base jsonb;
  v_old jsonb;
  v_set jsonb := '{}'::jsonb;
  v_amount boolean := false;
  v_msg text;
  k text;
  n integer := COALESCE(array_length(p_copy_ids, 1), 0);
  j integer;
  v_later jsonb := '[]'::jsonb;
  v_action text;
  v_ins jsonb;
  v_book jsonb;
  v_book_done text;
  v_label text;
BEGIN
  v_base := jsonb_build_object('table', p_table, 'op', p_op);
  p_vals := COALESCE(p_vals, '{}'::jsonb);
  IF jsonb_typeof(p_vals) <> 'object' THEN
    RETURN v_base || jsonb_build_object('refusal', 'The change carries no values.');
  END IF;

  IF p_op = 'insert' THEN
    v_base := v_base || jsonb_build_object('entry', public.twob__entry_name(p_vals));
    FOR k IN SELECT jsonb_object_keys(p_vals) LOOP
      IF k = ANY (v_ignored) THEN CONTINUE; END IF;
      IF NOT (k = ANY (v_desc || v_amt || ARRAY[v_month_col, v_link_col, v_dec_col, 'reclaim_subtype'])) THEN
        RETURN v_base || jsonb_build_object('refusal', format('An entry holds only its date, supplier, number, GSTIN and amounts here (%s).', k));
      END IF;
    END LOOP;
    IF NULLIF(btrim(COALESCE(p_vals ->> v_dec_col, '')), '') IS NOT NULL OR NULLIF(btrim(COALESCE(p_vals ->> 'reclaim_subtype', '')), '') IS NOT NULL THEN
      RETURN v_base || jsonb_build_object('refusal', CASE WHEN v_is2b
        THEN 'A new entry in a filed month cannot be reclaimed or expensed out. Record that in an open month.'
        ELSE 'A new entry in a filed month cannot be booked. Record its book entry in an open month.' END);
    END IF;
    IF NULLIF(p_vals ->> 'date', '') IS NULL OR NULLIF(btrim(COALESCE(p_vals ->> 'supplier_name', '')), '') IS NULL THEN
      RETURN v_base || jsonb_build_object('refusal', 'Enter the date and the supplier of the new entry.');
    END IF;
    -- Its reversal (in-2B) month is this month, or none: a new entry never
    -- moves another month's figures.
    v_label := NULLIF(btrim(COALESCE(p_vals ->> v_month_col, '')), '');
    IF v_label IS NOT NULL THEN
      IF NOT public.twob_label_matches(v_label, p_period) THEN
        RETURN v_base || jsonb_build_object('refusal', format('A new entry in a filed month takes this month, %s, as its %s, or none (not %s).',
          public.twob_period_label(p_period), CASE WHEN v_is2b THEN 'reversal month' ELSE 'in-2B month' END, v_label));
      END IF;
      p_vals := p_vals || jsonb_build_object(v_month_col, public.twob_period_label(p_period));
    END IF;
    IF p_held IS NOT NULL THEN
      RETURN v_base || jsonb_build_object('refusal', CASE WHEN p_held = p_period
        THEN format('%s already holds this entry on its %s list; remove the books entry, or that entry, first',
                    public.twob_month_name(p_period), CASE WHEN v_is2b THEN 'Not in 2B' ELSE 'Not in Books' END)
        ELSE format('%s already holds this entry as a carried entry; it is not added again',
                    public.twob_month_name(p_held)) END);
    END IF;
    v_ins := public.twob__ledger_insert(p_table, p_client_id, p_period, p_vals, p_months, p_locked, p_actor_id);
    RETURN v_base || jsonb_build_object('this', jsonb_build_object('action', 'add', 'id', v_ins -> 'id'), 'later', v_ins -> 'later');
  END IF;

  IF p_op NOT IN ('update', 'delete') THEN
    RETURN v_base || jsonb_build_object('refusal', format('Unknown change: %s.', COALESCE(p_op, '(none)')));
  END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1', p_table) INTO v_old USING p_id;
  IF v_old IS NULL OR (v_old ->> 'client_id')::uuid IS DISTINCT FROM p_client_id OR v_old ->> 'period_month' IS DISTINCT FROM p_period THEN
    RETURN v_base || jsonb_build_object('refusal', 'This entry is not in this month any more. Reload the page.');
  END IF;
  v_base := v_base || jsonb_build_object('entry', public.twob__entry_name(v_old), 'id', p_id);

  IF p_op = 'update' THEN
    FOR k IN SELECT jsonb_object_keys(p_vals) LOOP
      IF k = ANY (v_ignored) THEN CONTINUE; END IF;
      IF k = 'date' THEN
        IF (p_vals ->> k)::date IS DISTINCT FROM (v_old ->> k)::date THEN
          IF NULLIF(p_vals ->> k, '') IS NULL THEN
            RETURN v_base || jsonb_build_object('refusal', 'An entry needs a date.');
          END IF;
          v_set := v_set || jsonb_build_object(k, p_vals -> k);
        END IF;
      ELSIF k = ANY (v_desc) THEN
        IF COALESCE(p_vals ->> k, '') IS DISTINCT FROM COALESCE(v_old ->> k, '') THEN
          IF k = 'supplier_name' AND NULLIF(btrim(COALESCE(p_vals ->> k, '')), '') IS NULL THEN
            RETURN v_base || jsonb_build_object('refusal', 'An entry needs a supplier name.');
          END IF;
          v_set := v_set || jsonb_build_object(k, p_vals -> k);
        END IF;
      ELSIF k = ANY (v_amt) THEN
        IF round(COALESCE((p_vals ->> k)::numeric, 0), 2) <> round(COALESCE((v_old ->> k)::numeric, 0), 2) THEN
          v_set := v_set || jsonb_build_object(k, p_vals -> k);
          v_amount := true;
        END IF;
      ELSIF k = ANY (v_fixed) THEN
        IF NULLIF(btrim(COALESCE(p_vals ->> k, '')), '') IS DISTINCT FROM NULLIF(btrim(COALESCE(v_old ->> k, '')), '') THEN
          RETURN v_base || jsonb_build_object('refusal', CASE
            WHEN k IN ('reversal_month', 'reclaim_month', 'reclaim_subtype', 'reclaimed_via_doc_id', 'book_entry_month', 'bill_in_2b_month')
              THEN 'The reversal, reclaim and book entry months of a filed month cannot change.'
            ELSE 'Only the date, supplier, number, GSTIN and amounts of an entry can change in a filed month.' END);
        END IF;
      ELSE
        RETURN v_base || jsonb_build_object('refusal', format('Only the date, supplier, number, GSTIN and amounts of an entry can change in a filed month (%s).', k));
      END IF;
    END LOOP;
    IF v_set = '{}'::jsonb THEN
      RETURN v_base || jsonb_build_object('this', jsonb_build_object('action', 'none', 'id', p_id), 'later', '[]'::jsonb);
    END IF;
  END IF;

  -- A Not in Books entry posted from a 2B document that is still Not in Books
  -- here would come back on the next Post: the document stays as filed.
  IF p_op = 'delete' AND NOT v_is2b AND v_old ->> 'source_doc_id' IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.twob_import_docs d
                  WHERE d.id = (v_old ->> 'source_doc_id')::uuid AND d.period_month = p_period AND d.itc_action = 'NOT_IN_BOOKS') THEN
    RETURN v_base || jsonb_build_object('refusal', 'It comes from this month''s 2B document, which stays as filed (Not in Books); the next Post would add it back');
  END IF;

  -- A removal or an amount change is refused when the entry, or the copy a
  -- later month would lose or change, holds a decision, or when that copy's
  -- month counts the entry's reversal and is not yet filed.
  IF p_op = 'delete' OR v_amount THEN
    v_msg := public.twob__decision_message(p_table, v_old, p_period);
    IF v_msg IS NOT NULL THEN
      RETURN v_base || jsonb_build_object('refusal', v_msg);
    END IF;
    FOR j IN 1 .. n LOOP
      IF p_copy_msgs[j] IS NOT NULL THEN
        RETURN v_base || jsonb_build_object('refusal', p_copy_msgs[j]);
      END IF;
      IF p_copy_own[j] AND NOT public.twob_month_is_prior(p_client_id, p_copy_periods[j]) THEN
        RETURN v_base || jsonb_build_object('refusal', format('Its reversal month is %s, which is not filed yet; correct it in %s',
          public.twob_month_name(p_copy_periods[j]), public.twob_month_name(p_copy_periods[j])));
      END IF;
    END LOOP;
  END IF;
  v_action := CASE WHEN p_op = 'delete' THEN 'remove' ELSE 'change' END;
  FOR j IN 1 .. n LOOP
    v_later := v_later || jsonb_build_array(jsonb_build_object('period', p_copy_periods[j], 'action', v_action, 'id', p_copy_ids[j]));
  END LOOP;

  -- An entry posted from Import 2B's books register (Not in 2B) keeps its
  -- books row in step, so the next Post neither adds it back nor undoes the
  -- change: a removed entry takes the books row with it while that row would
  -- post it again; a changed entry changes the books row too.
  IF v_is2b AND v_old ->> 'source_book_id' IS NOT NULL AND NOT ((v_old ->> 'source_book_id')::uuid = ANY (COALESCE(p_named_books, '{}'))) THEN
    SELECT to_jsonb(b) INTO v_book FROM public.books_register b
     WHERE b.id = (v_old ->> 'source_book_id')::uuid AND b.client_id = p_client_id AND b.period_month = p_period
     FOR UPDATE;
    IF v_book IS NOT NULL AND v_book ->> 'book_treatment' = 'NOT_IN_2B' AND COALESCE(v_book ->> 'doc_type', 'INVOICE') <> 'DEBIT_NOTE' THEN
      IF p_op = 'delete' THEN
        IF v_book ->> 'matched_2b_id' IS NULL
           AND COALESCE((v_book ->> 'taxable_value')::numeric, 0) >= 0 AND COALESCE((v_book ->> 'input_igst')::numeric, 0) >= 0
           AND COALESCE((v_book ->> 'input_cgst')::numeric, 0) >= 0 AND COALESCE((v_book ->> 'input_sgst')::numeric, 0) >= 0 THEN
          DELETE FROM public.books_register WHERE id = (v_book ->> 'id')::uuid;
          v_book_done := 'remove';
        END IF;
      ELSE
        PERFORM public.twob__ledger_update('books_register', ARRAY[(v_book ->> 'id')::uuid], v_set, p_actor_id);
        v_book_done := 'change';
      END IF;
    END IF;
  END IF;

  IF p_op = 'delete' THEN
    PERFORM public.twob__ledger_delete(p_table, ARRAY[p_id] || p_copy_ids);
  ELSE
    PERFORM public.twob__ledger_update(p_table, ARRAY[p_id] || p_copy_ids, v_set, p_actor_id);
  END IF;
  RETURN v_base || jsonb_build_object('this', jsonb_strip_nulls(jsonb_build_object('action', v_action, 'id', p_id,
    'fields', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_object_keys(v_set) x),
    'books_row', v_book_done)), 'later', v_later);
END;
$$;

-- One change of an Import 2B books register row in prior month p_period.
-- The register is per month and not carried (its rows reach the ledger only
-- by Post), so the change is this month's only. Its pairing with a 2B
-- document stays as it is: a filed month's 2B documents do not change.
CREATE OR REPLACE FUNCTION public.twob__apply_books_register(
  p_actor_id uuid, p_client_id uuid, p_period text, p_op text, p_id uuid, p_vals jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_cols text[] := ARRAY['date', 'supplier_name', 'supplier_invoice_number', 'supplier_gstin',
                         'taxable_value', 'input_igst', 'input_cgst', 'input_sgst', 'doc_type', 'book_treatment'];
  v_ignored text[] := ARRAY['id', 'updated_at', 'updated_by', 'created_at', 'client_id', 'period_month', 'posted_at', 'posted_by'];
  v_base jsonb := jsonb_build_object('table', 'books_register', 'op', p_op);
  v_old jsonb;
  v_new jsonb;
  v_set jsonb := '{}'::jsonb;
  v_id uuid;
  k text;
BEGIN
  p_vals := COALESCE(p_vals, '{}'::jsonb);
  IF p_op IN ('update', 'delete') THEN
    SELECT to_jsonb(b) INTO v_old FROM public.books_register b WHERE b.id = p_id FOR UPDATE;
    IF v_old IS NULL OR (v_old ->> 'client_id')::uuid IS DISTINCT FROM p_client_id OR v_old ->> 'period_month' IS DISTINCT FROM p_period THEN
      RETURN v_base || jsonb_build_object('refusal', 'This books entry is not in this month any more. Reload the page.');
    END IF;
    v_base := v_base || jsonb_build_object('entry', public.twob__entry_name(v_old), 'id', p_id);
  ELSIF p_op = 'insert' THEN
    v_base := v_base || jsonb_build_object('entry', public.twob__entry_name(p_vals));
  ELSE
    RETURN v_base || jsonb_build_object('refusal', format('Unknown change: %s.', COALESCE(p_op, '(none)')));
  END IF;

  IF p_op = 'delete' THEN
    DELETE FROM public.books_register WHERE id = p_id;
    RETURN v_base || jsonb_build_object('this', jsonb_build_object('action', 'remove', 'id', p_id), 'later', '[]'::jsonb);
  END IF;

  FOR k IN SELECT jsonb_object_keys(p_vals) LOOP
    IF k = ANY (v_ignored) THEN CONTINUE; END IF;
    IF k = 'matched_2b_id' THEN
      IF p_op = 'update' AND (p_vals ->> k) IS DISTINCT FROM (v_old ->> k) THEN
        RETURN v_base || jsonb_build_object('refusal', 'A books entry''s pairing with a 2B document cannot change in a filed month.');
      END IF;
      CONTINUE;
    END IF;
    IF NOT (k = ANY (v_cols)) THEN
      RETURN v_base || jsonb_build_object('refusal', format('A books entry holds only its date, type, supplier, number, GSTIN, amounts and treatment (%s).', k));
    END IF;
    IF p_op = 'insert' OR COALESCE(p_vals ->> k, '') IS DISTINCT FROM COALESCE(v_old ->> k, '') THEN
      v_set := v_set || jsonb_build_object(k, p_vals -> k);
    END IF;
  END LOOP;
  v_new := CASE WHEN p_op = 'insert' THEN v_set ELSE v_old || v_set END;
  IF COALESCE((v_new ->> 'taxable_value')::numeric, 0) < 0 OR COALESCE((v_new ->> 'input_igst')::numeric, 0) < 0
     OR COALESCE((v_new ->> 'input_cgst')::numeric, 0) < 0 OR COALESCE((v_new ->> 'input_sgst')::numeric, 0) < 0 THEN
    RETURN v_base || jsonb_build_object('refusal', 'Amounts in the books register are never minus.');
  END IF;
  IF COALESCE(v_new ->> 'doc_type', 'INVOICE') NOT IN ('INVOICE', 'DEBIT_NOTE') THEN
    RETURN v_base || jsonb_build_object('refusal', 'A books entry is an invoice or a debit note (purchase return).');
  END IF;
  IF COALESCE(v_new ->> 'book_treatment', 'NOT_IN_2B') NOT IN ('NOT_IN_2B', 'MISMATCHED', 'NOT_ELIGIBLE') THEN
    RETURN v_base || jsonb_build_object('refusal', 'Unknown books treatment.');
  END IF;

  IF p_op = 'insert' THEN
    INSERT INTO public.books_register (
      client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
      taxable_value, input_igst, input_cgst, input_sgst, doc_type, book_treatment, updated_by, updated_at)
    VALUES (
      p_client_id, p_period, NULLIF(v_set ->> 'date', '')::date, v_set ->> 'supplier_name', v_set ->> 'supplier_invoice_number',
      v_set ->> 'supplier_gstin', COALESCE((v_set ->> 'taxable_value')::numeric, 0), COALESCE((v_set ->> 'input_igst')::numeric, 0),
      COALESCE((v_set ->> 'input_cgst')::numeric, 0), COALESCE((v_set ->> 'input_sgst')::numeric, 0),
      COALESCE(v_set ->> 'doc_type', 'INVOICE'), COALESCE(v_set ->> 'book_treatment', 'NOT_IN_2B'), p_actor_id, now())
    RETURNING id INTO v_id;
    RETURN v_base || jsonb_build_object('this', jsonb_build_object('action', 'add', 'id', v_id), 'later', '[]'::jsonb);
  END IF;
  IF v_set = '{}'::jsonb THEN
    RETURN v_base || jsonb_build_object('this', jsonb_build_object('action', 'none', 'id', p_id), 'later', '[]'::jsonb);
  END IF;
  UPDATE public.books_register b SET
    date = CASE WHEN v_set ? 'date' THEN NULLIF(v_set ->> 'date', '')::date ELSE b.date END,
    supplier_name = CASE WHEN v_set ? 'supplier_name' THEN v_set ->> 'supplier_name' ELSE b.supplier_name END,
    supplier_invoice_number = CASE WHEN v_set ? 'supplier_invoice_number' THEN v_set ->> 'supplier_invoice_number' ELSE b.supplier_invoice_number END,
    supplier_gstin = CASE WHEN v_set ? 'supplier_gstin' THEN v_set ->> 'supplier_gstin' ELSE b.supplier_gstin END,
    taxable_value = CASE WHEN v_set ? 'taxable_value' THEN COALESCE((v_set ->> 'taxable_value')::numeric, 0) ELSE b.taxable_value END,
    input_igst = CASE WHEN v_set ? 'input_igst' THEN COALESCE((v_set ->> 'input_igst')::numeric, 0) ELSE b.input_igst END,
    input_cgst = CASE WHEN v_set ? 'input_cgst' THEN COALESCE((v_set ->> 'input_cgst')::numeric, 0) ELSE b.input_cgst END,
    input_sgst = CASE WHEN v_set ? 'input_sgst' THEN COALESCE((v_set ->> 'input_sgst')::numeric, 0) ELSE b.input_sgst END,
    doc_type = CASE WHEN v_set ? 'doc_type' THEN v_set ->> 'doc_type' ELSE b.doc_type END,
    book_treatment = CASE WHEN v_set ? 'book_treatment' THEN v_set ->> 'book_treatment' ELSE b.book_treatment END,
    updated_by = p_actor_id, updated_at = now()
   WHERE b.id = p_id;
  RETURN v_base || jsonb_build_object('this', jsonb_build_object('action', 'change', 'id', p_id,
    'fields', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_object_keys(v_set) x)), 'later', '[]'::jsonb);
END;
$$;

-- The one door for a prior month's books entries (Import 2B's books register,
-- its Post, 2B Reconciliation's Save and delete), a GST Manager or the
-- superadmin only. p_changes: [{table: 'bills_not_in_2b' | 'bills_not_in_books'
-- | 'books_register', op: 'insert' | 'update' | 'delete', id?, values?}], each
-- entry named once. Each change is applied in p_period and, on the two ledger
-- lists, to every later month's carried copy of the entry. Before the first
-- write the month's figures are recorded (twob_filed_figures). One
-- transaction: any refusal leaves everything as it was. p_dry_run: what it
-- would do (this month, each later month, the refusals), writing nothing;
-- the screens show it before applying ("Also changes Aug-26 (1)").
CREATE OR REPLACE FUNCTION public.twob_prior_books_apply(
  p_actor_id uuid, p_client_id uuid, p_period text, p_changes jsonb, p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev text := current_setting('twob.write', true);
  v_key integer := public.twob_period_key(p_period);
  v_changes jsonb;
  v_list jsonb[] := '{}';
  v_refusals jsonb := '[]'::jsonb;
  v_one jsonb;
  c jsonb;
  i integer := -1;
  v_months_2b text[];
  v_months_books text[];
  v_locked text[];
  v_later jsonb;
  v_table text;
  v_id uuid;
  v_named_books uuid[];
  -- the later copies of every update / delete, in change order
  m_idx integer[];
  m_id uuid[];
  m_per text[];
  m_msg text[];
  m_own boolean[];
  m_n integer;
  p integer := 1;
  q integer;
  -- the added entries some month already holds
  h_idx integer[];
  h_per text[];
  v_held text;
BEGIN
  IF p_client_id IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'Choose a client and a month.';
  END IF;
  IF NOT public.twob_month_is_prior(p_client_id, p_period) THEN
    RAISE EXCEPTION 'This month is not filed. Save its entries as usual.';
  END IF;
  IF p_actor_id IS NULL OR COALESCE(public.staff_level_of(p_actor_id), '') NOT IN ('superadmin', 'gst_manager') THEN
    RAISE EXCEPTION 'This month is filed. Only a GST Manager or the superadmin can change its books entries, from Import 2B or 2B Reconciliation.';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_changes) x WHERE jsonb_typeof(x) <> 'object') THEN
    RAISE EXCEPTION 'No changes were sent.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_changes) x
              WHERE NULLIF(x ->> 'id', '') IS NOT NULL
              GROUP BY x ->> 'table', x ->> 'id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'One save names the same entry twice. Reload the page and save again.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  -- The later months that hold carried rows on each list: an added entry
  -- gets a carried copy in each (never a list in a month that has none).
  SELECT COALESCE(array_agg(DISTINCT t.period_month), '{}') INTO v_months_2b
    FROM public.bills_not_in_2b t
   WHERE t.client_id = p_client_id AND t.is_carried_forward AND public.twob_period_key(t.period_month) > v_key;
  SELECT COALESCE(array_agg(DISTINCT t.period_month), '{}') INTO v_months_books
    FROM public.bills_not_in_books t
   WHERE t.client_id = p_client_id AND t.is_carried_forward AND public.twob_period_key(t.period_month) > v_key;
  -- The months whose rows take the filing lock.
  SELECT COALESCE(array_agg(x), '{}') INTO v_locked
    FROM (SELECT DISTINCT unnest(ARRAY[p_period] || v_months_2b || v_months_books) AS x) m
   WHERE public.twob_month_locked(p_client_id, m.x);
  SELECT COALESCE(array_agg(DISTINCT NULLIF(x ->> 'id', '')::uuid), '{}') INTO v_named_books
    FROM jsonb_array_elements(p_changes) x WHERE x ->> 'table' = 'books_register' AND NULLIF(x ->> 'id', '') IS NOT NULL;

  BEGIN
    PERFORM set_config('twob.write', 'rpc', true);
    -- What was filed: the figures of this month and of the later prior months
    -- the call may write, as they stand before its first change.
    PERFORM public.twob__freeze_figures(p_client_id,
      ARRAY[p_period] || ARRAY(SELECT DISTINCT x FROM unnest(v_months_2b || v_months_books) x
                                WHERE public.twob_month_is_prior(p_client_id, x)),
      p_actor_id);
    -- The later copies of every entry changed or removed, matched once (rows locked).
    SELECT COALESCE(array_agg(x.idx ORDER BY x.idx, x.ord), '{}'), COALESCE(array_agg(x.id ORDER BY x.idx, x.ord), '{}'),
           COALESCE(array_agg(x.period_month ORDER BY x.idx, x.ord), '{}'), COALESCE(array_agg(x.msg ORDER BY x.idx, x.ord), '{}'),
           COALESCE(array_agg(x.own_rev ORDER BY x.idx, x.ord), '{}')
      INTO m_idx, m_id, m_per, m_msg, m_own
      FROM (SELECT mc.*, row_number() OVER () AS ord FROM public.twob__match_copies('bills_not_in_2b', p_client_id, p_period, p_changes) mc
            UNION ALL
            SELECT mc.*, row_number() OVER () FROM public.twob__match_copies('bills_not_in_books', p_client_id, p_period, p_changes) mc) x;
    m_n := COALESCE(array_length(m_idx, 1), 0);
    SELECT COALESCE(array_agg(h.idx), '{}'), COALESCE(array_agg(h.period_month), '{}') INTO h_idx, h_per
      FROM (SELECT * FROM public.twob__held_inserts('bills_not_in_2b', p_client_id, p_period, p_changes)
            UNION ALL
            SELECT * FROM public.twob__held_inserts('bills_not_in_books', p_client_id, p_period, p_changes)) h;

    FOR c IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
      i := i + 1;
      v_table := c ->> 'table';
      v_id := NULLIF(c ->> 'id', '')::uuid;
      IF v_table IN ('bills_not_in_2b', 'bills_not_in_books') THEN
        WHILE p <= m_n AND m_idx[p] < i LOOP p := p + 1; END LOOP;
        q := p;
        WHILE q <= m_n AND m_idx[q] = i LOOP q := q + 1; END LOOP;
        v_held := CASE WHEN c ->> 'op' = 'insert' THEN h_per[array_position(h_idx, i)] END;
        v_one := public.twob__apply_ledger(p_actor_id, p_client_id, p_period, v_table, c ->> 'op', v_id, c -> 'values',
          CASE WHEN v_table = 'bills_not_in_2b' THEN v_months_2b ELSE v_months_books END, v_locked,
          m_id[p:q - 1], m_per[p:q - 1], m_msg[p:q - 1], m_own[p:q - 1], v_held, v_named_books);
        p := q;
      ELSIF v_table = 'books_register' THEN
        v_one := public.twob__apply_books_register(p_actor_id, p_client_id, p_period, c ->> 'op', v_id, c -> 'values');
      ELSE
        v_one := jsonb_build_object('table', v_table, 'op', c ->> 'op',
          'refusal', 'Only books entries change in a filed month: Not in 2B, Not in Books and the books register.');
      END IF;
      v_one := v_one || jsonb_build_object('index', i);
      IF v_one ? 'refusal' THEN
        v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
          'index', i, 'entry', v_one -> 'entry', 'message', v_one ->> 'refusal'));
      END IF;
      -- (appended in place: a jsonb array concatenated once per change grew quadratically)
      v_list := array_append(v_list, v_one);
    END LOOP;
    IF p_dry_run OR jsonb_array_length(v_refusals) > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'TWB01', MESSAGE = 'twob: written nothing';
    END IF;
  EXCEPTION WHEN SQLSTATE 'TWB01' THEN
    NULL;
  END;
  PERFORM set_config('twob.write', COALESCE(v_prev, ''), true);

  v_changes := to_jsonb(v_list);
  IF NOT p_dry_run AND jsonb_array_length(v_refusals) > 0 THEN
    RAISE EXCEPTION '%', (SELECT string_agg(COALESCE((r ->> 'entry') || ': ', '') || (r ->> 'message') || '.', ' ')
                            FROM jsonb_array_elements(v_refusals) r);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('period', x.p, 'count', x.n) ORDER BY public.twob_period_key(x.p)), '[]'::jsonb)
    INTO v_later
    FROM (SELECT l ->> 'period' AS p, count(*)::integer AS n
            FROM jsonb_array_elements(v_changes) ch
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ch -> 'later', '[]'::jsonb)) l
           WHERE NOT (ch ? 'refusal')
           GROUP BY 1) x;
  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_refusals) = 0, 'dry_run', p_dry_run, 'period', p_period,
    'changes', v_changes, 'refusals', v_refusals, 'later_months', v_later);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. A return marked Filed by mistake
-- ---------------------------------------------------------------------------
-- A GST Manager or the superadmin reopens it for Import 2B and 2B
-- Reconciliation once its status is no longer Filed, writing why. The record
-- stays (reopened_at, reopened_by, reopen_reason); the months it no longer
-- keeps prior read their live lists again (their recorded figures go). Its
-- next month keeps the entries the mistaken filing carried into it; Re-run
-- carry forward brings them in line once the month is filed for real.
CREATE OR REPLACE FUNCTION public.twob_reopen_filed(
  p_actor_id uuid, p_client_id uuid, p_return_type text, p_period text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_through integer;
BEGIN
  IF p_actor_id IS NULL OR COALESCE(public.staff_level_of(p_actor_id), '') NOT IN ('superadmin', 'gst_manager') THEN
    RAISE EXCEPTION 'Only a GST Manager or the superadmin can reopen a return marked Filed by mistake.';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Write why Filed was set by mistake.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.filing_status f
              WHERE f.client_id = p_client_id AND f.return_type::text = p_return_type AND f.period_month = p_period
                AND f.status::text = 'Filed') THEN
    RAISE EXCEPTION 'Its status is still Filed. Change the status first, then reopen it.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  UPDATE public.twob_ever_filed
     SET reopened_at = now(), reopened_by = p_actor_id, reopen_reason = btrim(p_reason)
   WHERE client_id = p_client_id AND return_type = p_return_type AND period_month = p_period AND reopened_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This return is not recorded as filed for Import 2B and 2B Reconciliation.';
  END IF;
  v_through := public.twob_prior_through_key(p_client_id);
  DELETE FROM public.twob_filed_figures
   WHERE client_id = p_client_id AND (v_through IS NULL OR public.twob_period_key(period_month) > v_through);
  RETURN public.twob_month_state(p_client_id, p_period);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Who may call what
-- ---------------------------------------------------------------------------
-- The screens call these (src/lib/twobPriorMonth.ts, FilingStatusPage); the
-- writers check the acting user themselves.
GRANT EXECUTE ON FUNCTION
  public.twob_month_state(uuid, text),
  public.twob_month_is_prior(uuid, text),
  public.twob_prior_books_apply(uuid, uuid, text, jsonb, boolean),
  public.twob_carry_rerun(uuid, uuid, text, boolean),
  public.twob_reopen_filed(uuid, uuid, text, text, text)
TO anon, authenticated, service_role;

-- Internal: they write without checking who acts, or are triggers.
REVOKE ALL ON FUNCTION
  public.twob_carry_first(uuid, text),
  public.twob__rerun_list(text, uuid, text, text, boolean),
  public.twob__freeze_figures(uuid, text[], uuid),
  public.twob__match_copies(text, uuid, text, jsonb),
  public.twob__held_inserts(text, uuid, text, jsonb),
  public.twob__ledger_insert(text, uuid, text, jsonb, text[], text[], uuid),
  public.twob__ledger_update(text, uuid[], jsonb, uuid),
  public.twob__ledger_delete(text, uuid[]),
  public.twob__apply_ledger(uuid, uuid, text, text, text, uuid, jsonb, text[], text[], uuid[], text[], text[], boolean[], text, uuid[]),
  public.twob__apply_books_register(uuid, uuid, text, text, uuid, jsonb),
  public.twob_guard(),
  public.twob_record_filed(),
  public.auto_lock_on_filed()
FROM PUBLIC, anon, authenticated;

-- The one-off chain repair of 16 Sep 2026 (20260916120000) is for the SQL
-- editor only. In a prior month the guard refuses its writes unless the same
-- transaction first runs SELECT set_config('twob.write', 'system', true).
DO $$
BEGIN
  IF to_regprocedure('public.repair_carry_forward_chain(uuid, text, text, date)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.repair_carry_forward_chain(uuid, text, text, date) FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

COMMIT;
