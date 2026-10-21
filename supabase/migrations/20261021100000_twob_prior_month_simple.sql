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
--    unlocking the sheets does not open the month again.
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
--    in every later month already holding a carried list. One transaction;
--    p_dry_run returns the preview the screens show first.
-- 4. The guard (twob_guard) on bills_not_in_2b, bills_not_in_books,
--    books_register and twob_import_docs refuses every other write to a prior
--    month; still allowed: a change of the lock columns only (the filing lock,
--    Unlock sheets), a link cleared by its document's deletion, a deleted
--    client's rows, and the writes of this file's functions (twob.write, set
--    on those functions only; PostgREST cannot set it). Moving a row to
--    another month or client is refused in every month.
-- 5. The carry never wipes: filing (an update or a row added as Filed, a
--    quarterly return too; the app's carry after filing; the extension's
--    markFiled) copies into the next month only a list the next month does
--    not hold yet (twob_carry_first). Re-run carry forward (twob_carry_rerun)
--    is a GST Manager's or the superadmin's, previewed first, and adds the
--    entries the next month lacks, removes carried copies the month no longer
--    holds and keeps those holding the next month's own decision.
--
-- RLS: unchanged on the four tables (open, as the app has no auth session).
-- twob_ever_filed: select open to public, written only by its trigger.
-- Re-runnable: CREATE OR REPLACE, IF NOT EXISTS, ON CONFLICT DO NOTHING,
-- triggers dropped and created again. Tests: supabase/tests/twob_simple/run.sh.
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
--       -- Nothing of this file there yet, staff_level_of there (20261017100000):
--       SELECT to_regclass('public.twob_ever_filed'), to_regprocedure('public.staff_level_of(uuid)'),
--              (SELECT count(*) FROM pg_proc WHERE proname LIKE 'twob%');   -- NULL, staff_level_of, 0
--       -- The filing trigger as 20260814190000 left it (BEFORE UPDATE only):
--       SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.filing_status'::regclass AND NOT tgisinternal;
--  2. Apply this file as one statement batch (it is one transaction).
--  3. Check (reads only):
--       SELECT count(*) FROM public.twob_ever_filed;                 -- = step 1's first count
--       SELECT tgrelid::regclass, tgname FROM pg_trigger WHERE tgname IN ('trg_twob_prior_guard', 'trg_twob_record_filed', 'trigger_auto_lock_on_filed');
--                                                                     -- 4 guards, the record trigger, the filing trigger (INSERT OR UPDATE)
--       SELECT has_function_privilege('anon', 'public.twob_prior_books_apply(uuid, uuid, text, jsonb, boolean)', 'EXECUTE'),  -- true
--              has_function_privilege('anon', 'public.twob_carry_first(uuid, text)', 'EXECUTE');                               -- false
--     and with the anon key (POST /rest/v1/rpc/...): twob_month_state for SORATH BUILDERS
--     (73449b01-54bd-405d-84ee-0f8877b296d2) and 07/2026 gives is_prior true; for a
--     client's month after its latest filed one, false.
--  4. Deploy the app built from this commit (it reads twob_month_state; before
--     step 2 its screens show every month read-only). The old app keeps working
--     in open months; in a prior month its writes are refused with the message.
--  5. SORATH: July's 16 rows were deleted before this change, so August (and
--     September) still hold their carried copies. A GST Manager removes them in
--     August on 2B Reconciliation (Save previews the September copies going too).


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
-- month again. Written only by the trigger below; select-only for the app.
CREATE TABLE IF NOT EXISTS public.twob_ever_filed (
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  return_type    text NOT NULL,
  period_month   text NOT NULL,
  first_filed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, return_type, period_month)
);
COMMENT ON TABLE public.twob_ever_filed IS
  'Every GSTR-3B / GSTR-3B (Q) ever marked Filed (20261021100000). A month it covers, and every month before it, is a prior '
  'month for Import 2B and 2B Reconciliation (twob_month_is_prior), even after the sheets are unlocked. Written by the '
  'filing_status trigger only.';
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
    INSERT INTO public.twob_ever_filed (client_id, return_type, period_month)
    VALUES (NEW.client_id, NEW.return_type::text, NEW.period_month)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_twob_record_filed ON public.filing_status;
CREATE TRIGGER trg_twob_record_filed AFTER INSERT OR UPDATE OF status ON public.filing_status
  FOR EACH ROW EXECUTE FUNCTION public.twob_record_filed();

-- The latest month of the client that is prior: the furthest month a Filed
-- (now, or ever) GSTR-3B / GSTR-3B (Q) covers. NULL when none.
CREATE OR REPLACE FUNCTION public.twob_prior_through_key(p_client_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v integer;
BEGIN
  SELECT max(x.k) INTO v
    FROM (SELECT public.twob_cover_key(f.return_type::text, f.period_month) AS k
            FROM public.filing_status f
           WHERE f.client_id = p_client_id AND f.status::text = 'Filed'
             AND f.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)')
          UNION ALL
          SELECT public.twob_cover_key(e.return_type, e.period_month)
            FROM public.twob_ever_filed e
           WHERE e.client_id = p_client_id) x;
  RETURN v;
END;
$$;

-- Prior: the client's GSTR-3B for the month is Filed, or a GSTR-3B (Q) is
-- Filed for the quarter holding it, or any later month of the client has a
-- Filed GSTR-3B / GSTR-3B (Q). A month once Filed stays prior when its
-- sheets are unlocked.
CREATE OR REPLACE FUNCTION public.twob_month_is_prior(p_client_id uuid, p_period text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key integer := public.twob_period_key(p_period);
BEGIN
  IF p_client_id IS NULL OR v_key IS NULL THEN
    RETURN false;
  END IF;
  RETURN COALESCE(v_key <= public.twob_prior_through_key(p_client_id), false);
END;
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

-- One document: the same supplier GSTIN (or both blank and the same supplier
-- name), the same invoice number and date, and the same amounts.
CREATE OR REPLACE FUNCTION public.twob_doc_key(
  p_gstin text, p_name text, p_number text, p_date date,
  p_taxable numeric, p_igst numeric, p_cgst numeric, p_sgst numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT concat_ws('|', public.twob_norm_gstin(p_gstin),
                   CASE WHEN public.twob_norm_gstin(p_gstin) = '' THEN public.twob_norm_name(p_name) ELSE '' END,
                   public.twob_norm_no(p_number), p_date::text,
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

-- ---------------------------------------------------------------------------
-- 3. The guard
-- ---------------------------------------------------------------------------
-- A row of a prior month is written only by twob_prior_books_apply (twob.write
-- = 'rpc') or by a system function (twob.write = 'system': the filing carry
-- and Re-run). The setting is set only by the SECURITY DEFINER functions of
-- this file, for their own run (SET on the function); PostgREST cannot set it.
-- Allowed for everyone besides: a change of the lock columns only (the filing
-- lock, Unlock sheets), a link cleared by its document's deletion (ON DELETE
-- SET NULL), and the rows of a client being deleted. Moving a row to another
-- month or client is refused in every month.
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
    -- The rows of a client being deleted go with it.
    IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = OLD.client_id) THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
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
  IF public.twob_month_is_prior(v_client, v_period) THEN
    IF TG_TABLE_NAME = 'twob_import_docs' THEN
      RAISE EXCEPTION 'This month is filed. Its 2B documents cannot change. Only a GST Manager or the superadmin can change its books entries, from Import 2B or 2B Reconciliation.';
    END IF;
    RAISE EXCEPTION 'This month is filed. Only a GST Manager or the superadmin can change its books entries, from Import 2B or 2B Reconciliation.';
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
-- 4. The carry: first carry only
-- ---------------------------------------------------------------------------
-- Copies a month's two lists into the next month, each list only when the
-- next month holds no carried rows on it yet (the first carry). Otherwise it
-- does nothing, so a later month's reclaims and book entries stay. Internal:
-- called by the filing trigger and twob_carry_after_filing.
CREATE OR REPLACE FUNCTION public.twob_carry_first(p_client_id uuid, p_period text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET twob.write = 'system'
AS $$
DECLARE
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
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
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
SET twob.write = 'system'
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM public.filing_status f
                                   WHERE f.client_id = NEW.client_id AND f.return_type = NEW.return_type
                                     AND f.period_month = NEW.period_month) THEN
    RETURN NEW;
  END IF;
  IF NEW.status::text = 'Filed' AND (TG_OP = 'INSERT' OR OLD.status IS NULL OR OLD.status::text <> 'Filed') THEN
    NEW.filed_date := COALESCE(NEW.filed_date, CURRENT_DATE);
    IF NEW.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)') THEN
      NEW.is_locked := TRUE;
      UPDATE public.bills_not_in_2b SET is_locked = TRUE
       WHERE client_id = NEW.client_id AND period_month = NEW.period_month AND is_locked IS DISTINCT FROM TRUE;
      UPDATE public.bills_not_in_books SET is_locked = TRUE
       WHERE client_id = NEW.client_id AND period_month = NEW.period_month AND is_locked IS DISTINCT FROM TRUE;
      UPDATE public.itc_summaries SET is_locked = TRUE
       WHERE client_id = NEW.client_id AND period_month = NEW.period_month;
      PERFORM public.twob_carry_first(NEW.client_id, NEW.period_month);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_auto_lock_on_filed ON public.filing_status;
CREATE TRIGGER trigger_auto_lock_on_filed BEFORE INSERT OR UPDATE ON public.filing_status
  FOR EACH ROW EXECUTE FUNCTION public.auto_lock_on_filed();

-- The app's carry after filing (FilingStatusPage): the same first carry, for
-- a month whose GSTR-3B / GSTR-3B (Q) is Filed; nothing otherwise.
CREATE OR REPLACE FUNCTION public.twob_carry_after_filing(p_client_id uuid, p_period text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET twob.write = 'system'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.filing_status f
                  WHERE f.client_id = p_client_id AND f.period_month = p_period AND f.status::text = 'Filed'
                    AND f.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)')) THEN
    RETURN jsonb_build_object('period', p_period, 'not_filed', true, 'carried_2b', 0, 'carried_books', 0);
  END IF;
  RETURN public.twob_carry_first(p_client_id, p_period);
END;
$$;

-- Re-run carry forward (Filing Status), a GST Manager or the superadmin only.
-- One list of one month against the next month's carried copies, document
-- by document (twob_doc_key, twins one to one): entries to add (no carried
-- copy of the document in the next month), copies to remove (no counterpart
-- in the month and no decision of their own: a reclaim / Expense out, or a
-- book entry) and copies kept because they hold one. p_dry_run: what it would
-- do, writing nothing.
CREATE OR REPLACE FUNCTION public.twob__rerun_list(
  p_table text, p_client_id uuid, p_period text, p_next text, p_dry_run boolean)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_add uuid[];
  v_remove uuid[];
  v_keep uuid[];
  v_out jsonb;
  v_locked boolean := public.twob_month_locked(p_client_id, p_next);
BEGIN
  IF p_table = 'bills_not_in_2b' THEN
    WITH s AS (
      SELECT t.id, k.key, row_number() OVER (PARTITION BY k.key ORDER BY t.id) AS rn
        FROM public.bills_not_in_2b t
        CROSS JOIN LATERAL (SELECT public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date,
                                   t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst) AS key) k
       WHERE t.client_id = p_client_id AND t.period_month = p_period),
    c AS (
      SELECT t.id, k.key, d.decided,
             row_number() OVER (PARTITION BY k.key ORDER BY d.decided DESC, t.id) AS rn
        FROM public.bills_not_in_2b t
        CROSS JOIN LATERAL (SELECT public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date,
                                   t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst) AS key) k
        CROSS JOIN LATERAL (SELECT (NULLIF(btrim(t.reclaim_month), '') IS NOT NULL OR t.reclaim_subtype IS NOT NULL) AS decided) d
       WHERE t.client_id = p_client_id AND t.period_month = p_next AND t.is_carried_forward)
    SELECT array_agg(s.id) FILTER (WHERE c.id IS NULL),
           array_agg(c.id) FILTER (WHERE s.id IS NULL AND NOT c.decided),
           array_agg(c.id) FILTER (WHERE s.id IS NULL AND c.decided)
      INTO v_add, v_remove, v_keep
      FROM s FULL JOIN c ON c.key = s.key AND c.rn = s.rn;
  ELSE
    WITH s AS (
      SELECT t.id, k.key, row_number() OVER (PARTITION BY k.key ORDER BY t.id) AS rn
        FROM public.bills_not_in_books t
        CROSS JOIN LATERAL (SELECT public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date,
                                   t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst) AS key) k
       WHERE t.client_id = p_client_id AND t.period_month = p_period),
    c AS (
      SELECT t.id, k.key, d.decided,
             row_number() OVER (PARTITION BY k.key ORDER BY d.decided DESC, t.id) AS rn
        FROM public.bills_not_in_books t
        CROSS JOIN LATERAL (SELECT public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date,
                                   t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst) AS key) k
        CROSS JOIN LATERAL (SELECT (NULLIF(btrim(t.book_entry_month), '') IS NOT NULL) AS decided) d
       WHERE t.client_id = p_client_id AND t.period_month = p_next AND t.is_carried_forward)
    SELECT array_agg(s.id) FILTER (WHERE c.id IS NULL),
           array_agg(c.id) FILTER (WHERE s.id IS NULL AND NOT c.decided),
           array_agg(c.id) FILTER (WHERE s.id IS NULL AND c.decided)
      INTO v_add, v_remove, v_keep
      FROM s FULL JOIN c ON c.key = s.key AND c.rn = s.rn;
  END IF;
  v_add := COALESCE(v_add, '{}');
  v_remove := COALESCE(v_remove, '{}');
  v_keep := COALESCE(v_keep, '{}');

  IF p_table = 'bills_not_in_2b' THEN
    SELECT jsonb_build_object(
      'add', COALESCE(jsonb_agg(public.twob__entry_json(to_jsonb(t), NULL)) FILTER (WHERE t.id = ANY (v_add)), '[]'::jsonb),
      'remove', COALESCE(jsonb_agg(public.twob__entry_json(to_jsonb(t), NULL)) FILTER (WHERE t.id = ANY (v_remove)), '[]'::jsonb),
      'keep', COALESCE(jsonb_agg(public.twob__entry_json(to_jsonb(t), public.twob__decision_message('bills_not_in_2b', to_jsonb(t), p_next)))
                       FILTER (WHERE t.id = ANY (v_keep)), '[]'::jsonb))
      INTO v_out
      FROM public.bills_not_in_2b t
     WHERE t.id = ANY (v_add || v_remove || v_keep);
  ELSE
    SELECT jsonb_build_object(
      'add', COALESCE(jsonb_agg(public.twob__entry_json(to_jsonb(t), NULL)) FILTER (WHERE t.id = ANY (v_add)), '[]'::jsonb),
      'remove', COALESCE(jsonb_agg(public.twob__entry_json(to_jsonb(t), NULL)) FILTER (WHERE t.id = ANY (v_remove)), '[]'::jsonb),
      'keep', COALESCE(jsonb_agg(public.twob__entry_json(to_jsonb(t), public.twob__decision_message('bills_not_in_books', to_jsonb(t), p_next)))
                       FILTER (WHERE t.id = ANY (v_keep)), '[]'::jsonb))
      INTO v_out
      FROM public.bills_not_in_books t
     WHERE t.id = ANY (v_add || v_remove || v_keep);
  END IF;
  v_out := COALESCE(v_out, jsonb_build_object('add', '[]'::jsonb, 'remove', '[]'::jsonb, 'keep', '[]'::jsonb));

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

CREATE OR REPLACE FUNCTION public.twob_carry_rerun(
  p_actor_id uuid, p_client_id uuid, p_period text, p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET twob.write = 'system'
AS $$
DECLARE
  v_key integer := public.twob_period_key(p_period);
  v_next text;
BEGIN
  IF p_actor_id IS NULL OR COALESCE(public.staff_level_of(p_actor_id), '') NOT IN ('superadmin', 'gst_manager') THEN
    RAISE EXCEPTION 'Only a GST Manager or the superadmin can re-run the carry forward.';
  END IF;
  IF p_client_id IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'Choose a client and a month.';
  END IF;
  v_next := public.twob_period_of_key(v_key + 1);
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  RETURN jsonb_build_object(
    'period', p_period, 'next_period', v_next, 'dry_run', p_dry_run,
    'bills_not_in_2b', public.twob__rerun_list('bills_not_in_2b', p_client_id, p_period, v_next, p_dry_run),
    'bills_not_in_books', public.twob__rerun_list('bills_not_in_books', p_client_id, p_period, v_next, p_dry_run));
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Books entries of a prior month: twob_prior_books_apply
-- ---------------------------------------------------------------------------
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

-- One ledger row as jsonb (NULL when none).
CREATE OR REPLACE FUNCTION public.twob__ledger_row(p_table text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v jsonb;
BEGIN
  IF p_table = 'bills_not_in_2b' THEN
    SELECT to_jsonb(t) INTO v FROM public.bills_not_in_2b t WHERE t.id = p_id;
  ELSE
    SELECT to_jsonb(t) INTO v FROM public.bills_not_in_books t WHERE t.id = p_id;
  END IF;
  RETURN v;
END;
$$;

-- The later months' carried copies of a document (p_doc: the row's values
-- before the change), one per month: a copy without a decision of its own
-- when there is one (twins: one copy per month), else one with a decision.
CREATE OR REPLACE FUNCTION public.twob__ledger_copies(
  p_table text, p_client_id uuid, p_key integer, p_doc jsonb, p_exclude uuid[])
RETURNS TABLE (id uuid, period_month text, row_json jsonb, decided boolean)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_no text := public.twob_norm_no(p_doc ->> 'supplier_invoice_number');
  v_date date := (p_doc ->> 'date')::date;
  v_key text := public.twob_doc_key(p_doc ->> 'supplier_gstin', p_doc ->> 'supplier_name', p_doc ->> 'supplier_invoice_number',
                                    (p_doc ->> 'date')::date, (p_doc ->> 'taxable_value')::numeric, (p_doc ->> 'input_igst')::numeric,
                                    (p_doc ->> 'input_cgst')::numeric, (p_doc ->> 'input_sgst')::numeric);
BEGIN
  IF p_table = 'bills_not_in_2b' THEN
    RETURN QUERY
      SELECT DISTINCT ON (public.twob_period_key(t.period_month)) t.id, t.period_month, to_jsonb(t),
             (NULLIF(btrim(t.reclaim_month), '') IS NOT NULL OR t.reclaim_subtype IS NOT NULL)
        FROM public.bills_not_in_2b t
       WHERE t.client_id = p_client_id AND t.is_carried_forward
         AND public.twob_norm_no(t.supplier_invoice_number) = v_no AND t.date = v_date
         AND public.twob_period_key(t.period_month) > p_key
         AND public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date,
                                 t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst) = v_key
         AND NOT (t.id = ANY (COALESCE(p_exclude, '{}')))
       ORDER BY public.twob_period_key(t.period_month),
                (NULLIF(btrim(t.reclaim_month), '') IS NOT NULL OR t.reclaim_subtype IS NOT NULL), t.id;
  ELSE
    RETURN QUERY
      SELECT DISTINCT ON (public.twob_period_key(t.period_month)) t.id, t.period_month, to_jsonb(t),
             (NULLIF(btrim(t.book_entry_month), '') IS NOT NULL)
        FROM public.bills_not_in_books t
       WHERE t.client_id = p_client_id AND t.is_carried_forward
         AND public.twob_norm_no(t.supplier_invoice_number) = v_no AND t.date = v_date
         AND public.twob_period_key(t.period_month) > p_key
         AND public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date,
                                 t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst) = v_key
         AND NOT (t.id = ANY (COALESCE(p_exclude, '{}')))
       ORDER BY public.twob_period_key(t.period_month),
                (NULLIF(btrim(t.book_entry_month), '') IS NOT NULL), t.id;
  END IF;
END;
$$;

-- Adds an entry to the month and a carried copy of it (no link to Import 2B)
-- to each of p_months, in one statement; returns {id, later: [{period, id}]}.
-- The month columns a new entry may hold: its reversal month (Not in 2B) or
-- its in-2B month (Not in Books), the same on its copies; never a decision.
-- p_locked: the months whose return is Filed and locked (their rows take the
-- lock).
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
-- on the given rows.
CREATE OR REPLACE FUNCTION public.twob__ledger_update(p_table text, p_ids uuid[], p_set jsonb, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_table = 'bills_not_in_2b' THEN
    UPDATE public.bills_not_in_2b t SET
      date = CASE WHEN p_set ? 'date' THEN (p_set ->> 'date')::date ELSE t.date END,
      supplier_name = CASE WHEN p_set ? 'supplier_name' THEN btrim(p_set ->> 'supplier_name') ELSE t.supplier_name END,
      supplier_invoice_number = CASE WHEN p_set ? 'supplier_invoice_number' THEN p_set ->> 'supplier_invoice_number' ELSE t.supplier_invoice_number END,
      supplier_gstin = CASE WHEN p_set ? 'supplier_gstin' THEN p_set ->> 'supplier_gstin' ELSE t.supplier_gstin END,
      taxable_value = CASE WHEN p_set ? 'taxable_value' THEN COALESCE((p_set ->> 'taxable_value')::numeric, 0) ELSE t.taxable_value END,
      input_igst = CASE WHEN p_set ? 'input_igst' THEN COALESCE((p_set ->> 'input_igst')::numeric, 0) ELSE t.input_igst END,
      input_cgst = CASE WHEN p_set ? 'input_cgst' THEN COALESCE((p_set ->> 'input_cgst')::numeric, 0) ELSE t.input_cgst END,
      input_sgst = CASE WHEN p_set ? 'input_sgst' THEN COALESCE((p_set ->> 'input_sgst')::numeric, 0) ELSE t.input_sgst END,
      updated_by = p_actor_id, updated_at = now()
     WHERE t.id = ANY (p_ids);
  ELSE
    UPDATE public.bills_not_in_books t SET
      date = CASE WHEN p_set ? 'date' THEN (p_set ->> 'date')::date ELSE t.date END,
      supplier_name = CASE WHEN p_set ? 'supplier_name' THEN btrim(p_set ->> 'supplier_name') ELSE t.supplier_name END,
      supplier_invoice_number = CASE WHEN p_set ? 'supplier_invoice_number' THEN p_set ->> 'supplier_invoice_number' ELSE t.supplier_invoice_number END,
      supplier_gstin = CASE WHEN p_set ? 'supplier_gstin' THEN p_set ->> 'supplier_gstin' ELSE t.supplier_gstin END,
      taxable_value = CASE WHEN p_set ? 'taxable_value' THEN COALESCE((p_set ->> 'taxable_value')::numeric, 0) ELSE t.taxable_value END,
      input_igst = CASE WHEN p_set ? 'input_igst' THEN COALESCE((p_set ->> 'input_igst')::numeric, 0) ELSE t.input_igst END,
      input_cgst = CASE WHEN p_set ? 'input_cgst' THEN COALESCE((p_set ->> 'input_cgst')::numeric, 0) ELSE t.input_cgst END,
      input_sgst = CASE WHEN p_set ? 'input_sgst' THEN COALESCE((p_set ->> 'input_sgst')::numeric, 0) ELSE t.input_sgst END,
      updated_by = p_actor_id, updated_at = now()
     WHERE t.id = ANY (p_ids);
  END IF;
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
-- and the same change on every later month's carried copy of the entry.
-- Returns what it did (or would do): this month's effect, each later month
-- touched, or a refusal (then nothing of this change is written).
-- p_months: the later months that hold carried rows on this list (an added
-- entry gets a carried copy in each). p_touched: copies already changed in
-- this call, never matched twice.
CREATE OR REPLACE FUNCTION public.twob__apply_ledger(
  p_actor_id uuid, p_client_id uuid, p_period text, p_key integer,
  p_table text, p_op text, p_id uuid, p_vals jsonb, p_months text[], p_locked text[], p_touched uuid[])
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
  v_ids uuid[] := '{}';
  v_later jsonb := '[]'::jsonb;
  r record;
  v_action text;
  v_ins jsonb;
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
    v_ins := public.twob__ledger_insert(p_table, p_client_id, p_period, p_vals, p_months, p_locked, p_actor_id);
    RETURN v_base || jsonb_build_object('this', jsonb_build_object('action', 'add', 'id', v_ins -> 'id'), 'later', v_ins -> 'later');
  END IF;

  IF p_op NOT IN ('update', 'delete') THEN
    RETURN v_base || jsonb_build_object('refusal', format('Unknown change: %s.', COALESCE(p_op, '(none)')));
  END IF;
  v_old := public.twob__ledger_row(p_table, p_id);
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

  -- A removal or an amount change is refused when the entry, or the copy a
  -- later month would lose or change, holds a decision.
  IF p_op = 'delete' OR v_amount THEN
    v_msg := public.twob__decision_message(p_table, v_old, p_period);
    IF v_msg IS NOT NULL THEN
      RETURN v_base || jsonb_build_object('refusal', v_msg);
    END IF;
  END IF;
  v_action := CASE WHEN p_op = 'delete' THEN 'remove' ELSE 'change' END;
  FOR r IN SELECT * FROM public.twob__ledger_copies(p_table, p_client_id, p_key, v_old, p_touched) LOOP
    IF (p_op = 'delete' OR v_amount) AND r.decided THEN
      RETURN v_base || jsonb_build_object('refusal', public.twob__decision_message(p_table, r.row_json, r.period_month));
    END IF;
    v_ids := v_ids || r.id;
    v_later := v_later || jsonb_build_array(jsonb_build_object('period', r.period_month, 'action', v_action, 'id', r.id));
  END LOOP;

  IF p_op = 'delete' THEN
    PERFORM public.twob__ledger_delete(p_table, ARRAY[p_id] || v_ids);
  ELSE
    PERFORM public.twob__ledger_update(p_table, ARRAY[p_id] || v_ids, v_set, p_actor_id);
  END IF;
  RETURN v_base || jsonb_build_object('this', jsonb_build_object('action', v_action, 'id', p_id,
    'fields', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_object_keys(v_set) x)), 'later', v_later);
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
    SELECT to_jsonb(b) INTO v_old FROM public.books_register b WHERE b.id = p_id;
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
-- | 'books_register', op: 'insert' | 'update' | 'delete', id?, values?}].
-- Each change is applied in p_period and, on the two ledger lists, to every
-- later month's carried copy of the entry (twob__apply_ledger). One
-- transaction: any refusal leaves everything as it was. p_dry_run: what it
-- would do (this month, each later month, the refusals), writing nothing;
-- the screens show it before applying ("Also changes Aug-26 (1)").
CREATE OR REPLACE FUNCTION public.twob_prior_books_apply(
  p_actor_id uuid, p_client_id uuid, p_period text, p_changes jsonb, p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET twob.write = 'rpc'
AS $$
DECLARE
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
  v_touched uuid[] := '{}';
  v_later jsonb;
  v_table text;
  v_id uuid;
  v_l jsonb;
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
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'No changes were sent.';
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

  BEGIN
    FOR c IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
      i := i + 1;
      v_table := c ->> 'table';
      v_id := NULLIF(c ->> 'id', '')::uuid;
      IF v_table IN ('bills_not_in_2b', 'bills_not_in_books') THEN
        v_one := public.twob__apply_ledger(p_actor_id, p_client_id, p_period, v_key, v_table, c ->> 'op', v_id, c -> 'values',
          CASE WHEN v_table = 'bills_not_in_2b' THEN v_months_2b ELSE v_months_books END, v_locked, v_touched);
        FOR v_l IN SELECT value FROM jsonb_array_elements(COALESCE(v_one -> 'later', '[]'::jsonb)) LOOP
          v_touched := array_append(v_touched, (v_l ->> 'id')::uuid);
        END LOOP;
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
-- 6. Who may call what
-- ---------------------------------------------------------------------------
-- The screens call these (src/lib/twobPriorMonth.ts, FilingStatusPage); the
-- writers check the acting user themselves.
GRANT EXECUTE ON FUNCTION
  public.twob_month_state(uuid, text),
  public.twob_month_is_prior(uuid, text),
  public.twob_prior_books_apply(uuid, uuid, text, jsonb, boolean),
  public.twob_carry_rerun(uuid, uuid, text, boolean),
  public.twob_carry_after_filing(uuid, text)
TO anon, authenticated, service_role;

-- Internal: they write without checking who acts, or are triggers.
REVOKE ALL ON FUNCTION
  public.twob_carry_first(uuid, text),
  public.twob__rerun_list(text, uuid, text, text, boolean),
  public.twob__ledger_row(text, uuid),
  public.twob__ledger_copies(text, uuid, integer, jsonb, uuid[]),
  public.twob__ledger_insert(text, uuid, text, jsonb, text[], text[], uuid),
  public.twob__ledger_update(text, uuid[], jsonb, uuid),
  public.twob__ledger_delete(text, uuid[]),
  public.twob__apply_ledger(uuid, uuid, text, integer, text, text, uuid, jsonb, text[], text[], uuid[]),
  public.twob__apply_books_register(uuid, uuid, text, text, uuid, jsonb),
  public.twob_guard(),
  public.twob_record_filed(),
  public.auto_lock_on_filed()
FROM PUBLIC, anon, authenticated;

-- The one-off chain repair of 16 Sep 2026 (20260916120000) writes the carry
-- as a system function, and only from the SQL editor.
DO $$
BEGIN
  IF to_regprocedure('public.repair_carry_forward_chain(uuid, text, text, date)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.repair_carry_forward_chain(uuid, text, text, date) SET twob.write = ''system''';
    EXECUTE 'REVOKE ALL ON FUNCTION public.repair_carry_forward_chain(uuid, text, text, date) FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

COMMIT;
