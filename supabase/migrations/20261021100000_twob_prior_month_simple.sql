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
--    reason (twob_reopen_filed), once no row of the return holds Filed, an
--    ARN or a filing source: a return Unlock left holding its portal ARN
--    is never reopened; the superadmin's Take off Filed clears it first.
-- 2. In a prior month only a GST Manager or the superadmin changes anything,
--    and only books entries: Not in 2B rows, the Import 2B books register,
--    and Not in Books rows typed without a 2B source. A Not in Books entry
--    posted from a 2B document (source_doc_id) follows the filed 2B and is
--    neither added, changed nor removed, and so is a carried copy of an
--    invoice an earlier month holds as such an entry (twob__nib_follows_2b;
--    twob_nib_2b_copies for the screen); other carried Not in Books copies
--    (of typed entries, or whose entry is gone) are books entries.
--    2B documents, reversal / reclaim /
--    Expense out / book entry / in-2B months, Clear Data, Restore and imports
--    are refused for everyone. Removing an entry or changing its amounts is
--    refused while the entry or a later copy holds a reclaim (Expense out) or
--    a book entry, naming the month ("Sep-26 has reclaimed this entry; undo
--    that reclaim first"; for a filed month's decision "Aug-26 (filed) has
--    booked this entry, so it cannot be removed or its amounts changed"); its
--    date, supplier, number and GSTIN may change.
-- 3. One door: twob_prior_books_apply(p_actor_id, p_client_id, p_period,
--    p_changes, p_dry_run). Each change in the month and the same change on
--    every later month's carried copy of the entry: a later month's carried
--    rows of a document (GSTIN, or both blank and the same supplier; number;
--    date; amounts) are paired one to one with the rows of it this month
--    holds and the own entries of the months in between, first on the same
--    reversal month (in-2B month on Not in Books: twob_month_tag), then on
--    the document alone (a copy whose month was filled in or cleared after
--    the carry), the months in between first, the changed rows last, a copy
--    without its own decision first (twob__match_copies). A later month's own
--    entry of the same invoice and its copies are never touched (named). An
--    added entry gets a carried copy in every later month up to the later of
--    the latest month holding a carried list on that list and the month after
--    the client's latest filed month (never further), takes this month as its
--    reversal (in-2B) month, and is left out, named in a note, when the month
--    or any later month already holds it as the call leaves it (rows the call
--    removes or changes do not count as they were; the rest goes ahead). A
--    removed posted entry takes its books register row with it. The rows and
--    copies it changes are locked first. One transaction; p_dry_run returns
--    the preview the screens show first.
-- 4. The guard (twob_guard) on bills_not_in_2b, bills_not_in_books,
--    books_register and twob_import_docs refuses every other write to a prior
--    month; still allowed: a change of the lock columns only (the filing lock,
--    Unlock sheets), a link cleared after the row it names is gone (ON DELETE
--    SET NULL, never by hand), a deleted client's rows, and the writes of this
--    file's functions (the setting twob.write, set with set_config inside them
--    only; PostgREST cannot set it). Moving a row to another month or client
--    is refused in every month. In an open month deleting a carried row that
--    holds a decision made in that month or later is refused, and so is adding
--    a carried row beside a decided carried row of the same document
--    (twob_guard_carried_insert): a page opened before this change still runs
--    the old delete-and-copy carry, and it neither wipes a reclaim nor
--    doubles the month. Its old Restore can still double an open month (it
--    adds the month's own entries back): that risk lasts until the page is
--    reloaded, so everyone reloads after the deploy (step 4).
-- 5. The carry runs once and never wipes: filing (an update or a row added as
--    Filed, a quarterly return too; the extension's markFiled) copies a list
--    into the next month only the first time (twob_carry_log; every month
--    filed before this change counts as carried, back-filled here), only when
--    the next month is not filed, and only when it holds no carried rows on
--    that list (twob_carry_first). Otherwise nothing, and the record says why
--    ('next_filed': the next month is filed itself; 'next_prior': only a later
--    month is, so it counts as filed). A list the month holds nothing on is
--    recorded as carried (nothing to carry). Filing Status says so after
--    filing and marks the month's row, from the record, until a Re-run has
--    run from it (the extension's markFiled included; recorded even when it
--    has nothing to add). Nothing carries by itself into a filed month or past
--    the next month; marking a month Filed again never carries anything, nor
--    does filing a month reopened as Filed by mistake ('reopened', then
--    'refiled': its row is marked until a Re-run). An out-of-order filing is
--    repaired only by Re-run carry forward (twob_carry_rerun, a GST Manager
--    or the superadmin, previewed, one month into the next, recorded in the
--    carry record): into an open month it adds, removes copies without a
--    decision and keeps decided ones; into a filed month it only adds, that
--    month's figures recorded first, and marks that month's list
--    ('rerun_pending') until a Re-run from it carries them on.
--    Same-supplier, same-amount entries pair with a decided copy on the same
--    number, then date; any left over are named, never added. An entry the next month holds as its
--    own, or whose copy differs in amount, or in number or date at the same
--    supplier and amounts, or in supplier or GSTIN at the same number, date
--    and amounts, and holds a decision, is named and left alone. Every writer
--    takes the client's lock before row locks.
-- 6. Filed figures (twob_filed_figures): before the door, or Re-run into a
--    filed month, first changes a prior month, the month's 2B Reconciliation
--    figures (4B(2)(i), 5.4 and 4D(1.2), summed from its live lists as the app
--    sums them) are recorded; every gate that reads that month reads them
--    from then on, and blocks when it cannot read them (the app fails
--    closed). Until then the live lists are its figures, as before this
--    change, so applying it changes no gate.
-- 7. Restore of a saved version (twob_restore_version, the superadmin): an
--    open month only, and only the client's latest month that holds rows on
--    either list; the month's own entries on both lists replaced in one call.
--    Its carried entries stay as they stand: a correction made through a
--    filed month reaches them and no version records it, so a restore never
--    brings back what that correction removed; a version's own entry the
--    month now holds as a carried entry is left out and named (left_out). A
--    version that does not say which rows were carried is refused.
--
-- RLS: unchanged on the four tables (open, as the app has no auth session).
-- twob_ever_filed, twob_filed_figures and twob_carry_log: select open to
-- public, written only by this file's functions. Re-runnable: CREATE OR
-- REPLACE, IF NOT EXISTS, ON CONFLICT DO NOTHING, triggers dropped and created
-- again. No function carries a SET of a custom setting (a non-superuser
-- cannot create one); twob.write is set at run time with set_config, as
-- app.filing_push is. Tests: supabase/tests/twob_simple/run.sh (applies this
-- file twice, as a role that is not a superuser).
--
-- LIVE APPLY (project gcquafqxbykxkbexcdpy only; never SUPABASE_PROJECT_REF):
-- Merged release (controls-integration): live order 20261021160000, this file,
-- 20261021110000, 20261021120000, 20261021150000, each applied in turn with no
-- app deploy in between; the app goes out ONCE, after 20261021150000 (step 4).
-- The merged app calls functions of every one of those files
-- (gstr3b_push_gate, filing_record_pull, gst_change_history): deployed after
-- this file alone, every GSTR-3B push and JSON download stays locked ("Could
-- not find the function public.gstr3b_push_gate") and no return can be marked
-- Filed until extension 0.17.0 and the later files are out.
--  1. Dry checks, reads only, before applying (figures of 21 Oct 2026 from
--     anon reads):
--       -- Filed returns to record (1,369, of them 31 GSTR-3B (Q)):
--       SELECT count(*), count(*) FILTER (WHERE return_type::text = 'GSTR-3B (Q)')
--         FROM public.filing_status
--        WHERE status::text = 'Filed' AND return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)');
--       -- Each filed month is recorded as carried on both lists
--       -- (twob_carry_log: 2 rows per client and month, 2,732; fewer than
--       -- twice 1,369, as three clients have both a GSTR-3B and a GSTR-3B (Q)
--       -- Filed for 12/2025, which is one month):
--       SELECT 2 * count(DISTINCT (client_id, period_month)) FROM public.filing_status
--        WHERE status::text = 'Filed' AND return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)')
--          AND period_month ~ '^(0[1-9]|1[0-2])/[0-9]{4}$';
--       -- Filed months whose next month already holds carried rows (739 Not
--       -- in 2B, 670 Not in Books); after this change no filed month carries
--       -- again, these or the others:
--       SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.bills_not_in_2b b WHERE b.client_id = f.client_id
--                 AND b.period_month = to_char(to_date(f.period_month, 'MM/YYYY') + interval '1 month', 'MM/YYYY') AND b.is_carried_forward)) AS next_2b,
--              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.bills_not_in_books b WHERE b.client_id = f.client_id
--                 AND b.period_month = to_char(to_date(f.period_month, 'MM/YYYY') + interval '1 month', 'MM/YYYY') AND b.is_carried_forward)) AS next_books
--         FROM public.filing_status f
--        WHERE f.status::text = 'Filed' AND f.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)');
--       -- Rows whose reversal month is later than their own month (4 of
--       -- 10,037 on 21 Oct 2026; the door refuses removing or re-amounting
--       -- such an entry while that later month is open):
--       SELECT count(*) FROM public.bills_not_in_2b
--        WHERE reversal_month ~* '^[a-z]{3}[ -]?[0-9]{2}$'
--          AND to_date(regexp_replace(reversal_month, '[ -]', '', 'g'), 'MonYY') > to_date(period_month, 'MM/YYYY');
--       -- Nothing of this file there yet, staff_level_of there (20261017100000):
--       SELECT to_regclass('public.twob_ever_filed'), to_regclass('public.twob_filed_figures'), to_regclass('public.twob_carry_log'),
--              to_regprocedure('public.staff_level_of(uuid)'),
--              (SELECT count(*) FROM pg_proc WHERE proname LIKE 'twob%');   -- NULL, NULL, NULL, staff_level_of, 0
--       -- The filing trigger as 20260814190000 left it (BEFORE UPDATE only):
--       SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.filing_status'::regclass AND NOT tgisinternal;
--     Quiet time: no long query on the 2B tables or filing_status right now
--     (expect no rows):
--       SELECT pid, now() - xact_start AS running, left(query, 80) FROM pg_stat_activity
--        WHERE state <> 'idle' AND xact_start < now() - interval '30 seconds';
--  2. Apply this file as one statement batch (it is one transaction). It
--     needs no superuser: no function stores a custom setting. It sets
--     lock_timeout = 5 s: its triggers are dropped and created again on
--     bills_not_in_2b, bills_not_in_books, books_register, twob_import_docs
--     and filing_status (an exclusive lock each, held to COMMIT), and behind a
--     long query that would queue every app read of those tables. On
--     "canceling statement due to lock timeout" nothing was changed (one
--     transaction): wait a minute and apply it again.
--  3. Check (reads only):
--       SELECT count(*) FROM public.twob_ever_filed;                 -- = step 1's first count (1,369)
--       SELECT count(*), count(*) FILTER (WHERE carried_how = 'backfill') FROM public.twob_carry_log;
--                                -- both = step 1's second count (2,732), and = this:
--       SELECT 2 * count(DISTINCT (client_id, period_month)) FROM public.twob_ever_filed;
--       SELECT count(*) FROM public.twob_filed_figures;              -- 0: figures are recorded at a month's first change
--       -- Identical twins in one month and list, as the door pairs them (the
--       -- same document and the same reversal / in-2B month; 4 groups / 8
--       -- rows Not in 2B, 461 groups / 922 rows Not in Books on 21 Oct 2026):
--       SELECT 'bills_not_in_2b', count(*), sum(n) FROM (
--         SELECT count(*) n FROM public.bills_not_in_2b
--          GROUP BY client_id, period_month, public.twob_month_tag(reversal_month),
--                   public.twob_doc_key(supplier_gstin, supplier_name, supplier_invoice_number, date, taxable_value, input_igst, input_cgst, input_sgst)
--         HAVING count(*) > 1) x
--       UNION ALL
--       SELECT 'bills_not_in_books', count(*), sum(n) FROM (
--         SELECT count(*) n FROM public.bills_not_in_books
--          GROUP BY client_id, period_month, public.twob_month_tag(bill_in_2b_month),
--                   public.twob_doc_key(supplier_gstin, supplier_name, supplier_invoice_number, date, taxable_value, input_igst, input_cgst, input_sgst)
--         HAVING count(*) > 1) x;
--       SELECT tgrelid::regclass, tgname FROM pg_trigger
--        WHERE tgname IN ('trg_twob_prior_guard', 'trg_twob_carried_insert', 'trg_twob_record_filed', 'trigger_auto_lock_on_filed');
--                                -- 4 guards, 2 carried-insert checks, the record trigger, the filing trigger (INSERT OR UPDATE)
--       SELECT has_function_privilege('anon', 'public.twob_prior_books_apply(uuid, uuid, text, jsonb, boolean)', 'EXECUTE'),  -- true
--              has_function_privilege('anon', 'public.twob_carry_rerun(uuid, uuid, text, boolean)', 'EXECUTE'),              -- true
--              has_function_privilege('anon', 'public.twob_reopen_filed(uuid, uuid, text, text, text)', 'EXECUTE'),         -- true
--              has_function_privilege('anon', 'public.twob_restore_version(uuid, uuid, text, jsonb, jsonb)', 'EXECUTE'),    -- true
--              has_function_privilege('anon', 'public.twob_nib_2b_copies(uuid, text)', 'EXECUTE'),                         -- true
--              has_function_privilege('anon', 'public.twob_carry_first(uuid, text)', 'EXECUTE'),                             -- false
--              to_regprocedure('public.twob__carry_into(text, uuid, text, text[])'),                                         -- NULL
--              to_regprocedure('public.twob_carry_after_filing(uuid, text)');                                                 -- NULL
--     and with the anon key (POST /rest/v1/rpc/...): twob_month_state for SORATH BUILDERS
--     (73449b01-54bd-405d-84ee-0f8877b296d2) and 07/2026 gives is_prior true; for a
--     client's month after its latest filed one, false.
--  4. Deploy the app built from this commit only once 20261021150000 is applied
--     (merged release: one deploy, after the last file of the live order;
--     Vercel deploys on merge, so merge then). Deployed before this file, its screens would
--     show every month read-only, its GSTR-3B Push would stay locked for
--     every client, and Suspended Reco would refuse Save, Upload, Not
--     Applicable and Override (GST Receivable Reco shows no 4C): the filed
--     figures they read would not exist yet, and a check that cannot read
--     them blocks. Then ask everyone to reload every open
--     GST Keeper tab: a tab opened before the deploy still runs the old carry,
--     Restore and open-month Save. The database refuses their writes to a
--     prior month, their deletion of a carried entry that holds its own
--     month's decision, and their adding of a carried entry beside a decided
--     one; until the tab is reloaded, an old tab's Restore of an open month
--     can still double that month, and its 2B Reconciliation Save of an open
--     month sends whole rows as it loaded them (the new Save sends only the
--     columns changed, and nothing when a row changed since it was loaded).
--  5. Prior months' Posts (census of 21 Oct 2026, the app's own plan of every
--     prior client-month with Import 2B rows): none writes anything on its
--     first Post. 16 had something to write before this change:
--       - the Not in Books side from the month's 2B documents, which a prior
--         month's Post now names and leaves out (it follows the filed 2B):
--         NAVRATNA Sep-26 (52 to add), SHIVASHRAY Jul-26 (15), KWIKTEAM Sep-26
--         (14), RAYWINGS Jul-26 (6) and Aug-26 (2), TISHA Sep-26 (5 to
--         remove), POINT PACKERS Sep-26 (4), ELENZA CALLISTA Jul-26 (3), PRIDE
--         DRUGS Jul-26 (3: MAHAVIR 347, RETAILEZ LKO1-622965, SHREE HARI 119),
--         ABHIJEET RAMNIKBHAI SATANI Jul-26 (1: Care Bio Medical Waste
--         ABD6932-2627), REVTI Aug-26 (1) and TAMNNA INFRASTRUCTURE-GUJARAT
--         Jul-26 (1: JAY INFRASTRUCTURE 16/2026-27, held by Sep-26 and Oct-26,
--         booked Sep 26). If one belongs on its list, add it in the open month;
--       - Not in 2B updates that changed nothing (the books supplier name had
--         a stray space): PRIDE DRUGS Sep-26 (3), ELENZA ARISTA Jul-26 (1),
--         MICROCIRCUITS Aug-26 (1), ELENZA CALLISTA Jul-26 (4); no longer
--         planned;
--       - SORATH BUILDERS Jul-26: PERFECT INDUSTRIES 19/26-27
--         (c379891a-6a14-4d7d-a64c-bcf448ceca3b, Not in 2B, no longer linked)
--         is named as already in July and left out; delete that books row on
--         Import 2B if it should not be there. SORATH has nothing to remove: a
--         delete-and-copy re-run of 20 Oct 2026 (09:46 UTC) already brought
--         August and September in line with July. Re-run carry forward on
--         Aug-26 (the latest filed month) previews 0 to add and 0 to remove.
--  6. After step 4, reads only: the months that are prior but not covered by
--     a Filed return of their own (a later month was filed first), with the
--     query below. Filing such a month later (from 20261021110000 by the
--     extension's pull, or an attach the superadmin allowed; before it, by
--     hand or the extension's markFiled) carries nothing, because its next month
--     counts as filed. When the month holds entries, Filing Status marks its
--     GSTR-3B row with a warning from the carry record (twob_carry_log,
--     carried_at NULL; a list the month holds nothing on is recorded as
--     carried and never warns). The warning goes when a GST Manager presses
--     Re-run on that row, which shows its preview first:
--       - its next month already holds every entry (AMBER GUM Jun-26, GROWQ
--         Apr-26, SHIVON Jun-26 on 21 Oct 2026: their next months hold their
--         entries): the preview has nothing to add, and the Re-run is
--         recorded all the same, so the warning goes;
--       - its next month is filed and lacks entries (REVTI Jul-26: 11 Not in
--         2B, 67 Not in Books; Aug-26 filed, Sep-26 open): Re-run adds them to
--         Aug-26 only, and Filing Status then warns on Aug-26's row ("Aug-26
--         holds entries Re-run carry forward brought in after it was filed")
--         until Re-run from Aug-26 carries them into Sep-26;
--       - its next month only counts as filed (SWENI Nov-24: 6 Not in Books
--         bills of Nov-2025; Dec-24 has no GSTR-3B row): Re-run adds them to
--         Dec-24, which is re-run once it is marked Filed itself;
--       - NAVRATNA Dec-25 holds 4 April 2026 bills typed into the wrong month,
--         which Apr-26 holds as its own entries: remove them from Dec-25
--         through 2B Reconciliation first (the door takes their copies, never
--         April's entries), then Re-run.
--     Carried Not in Books copies with no entry upstream (774 in prior
--     months, 8 clients, SORATH 352, on 21 Oct 2026; chains that start
--     mid-history) are books entries now: a GST Manager removes or corrects
--     one in the earliest month that holds it, and the door reaches its later
--     copies. Copies of an invoice an earlier month holds from a 2B document
--     (276) stay as filed.
--       SELECT c.name, x.client_id, x.period_month,
--              (SELECT count(*) FROM public.bills_not_in_2b b WHERE b.client_id = x.client_id AND b.period_month = x.period_month) AS not_in_2b,
--              (SELECT count(*) FROM public.bills_not_in_books b WHERE b.client_id = x.client_id AND b.period_month = x.period_month) AS not_in_books
--         FROM (SELECT client_id, period_month FROM public.bills_not_in_2b
--               UNION SELECT client_id, period_month FROM public.bills_not_in_books) x
--         JOIN public.clients c ON c.id = x.client_id
--        WHERE public.twob_month_is_prior(x.client_id, x.period_month)
--          AND NOT EXISTS (SELECT 1 FROM public.twob_ever_filed e
--                           WHERE e.client_id = x.client_id AND e.reopened_at IS NULL
--                             AND public.twob_period_key(x.period_month)
--                                 BETWEEN e.cover_key - CASE WHEN e.return_type = 'GSTR-3B (Q)' THEN 2 ELSE 0 END AND e.cover_key)
--        ORDER BY c.name, public.twob_period_key(x.period_month);
--     V J DESAI & CO LLP Jun-26 is not an out-of-order case: June (19 Jul) and
--     July (20 Aug) were filed in order, and July's carried Not in Books list
--     was emptied by staff before July was filed. Filing June again now
--     carries nothing back.


BEGIN;
-- Triggers are dropped and created again on the 2B tables and filing_status
-- (an exclusive lock each, held to COMMIT): give up rather than queue the
-- app's queries behind a long report.
SET LOCAL lock_timeout = '5s';

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

-- A month label as one month ("Sep 26", "sep-2026", "September 26") -> its
-- running month number; NULL when it does not read as one month (a number
-- typed into the column, free text). Used to tell when a decision was made.
CREATE OR REPLACE FUNCTION public.twob_label_key(p_label text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT (CASE WHEN length(m[2]) = 2 THEN 2000 + m[2]::integer ELSE m[2]::integer END) * 12
         + array_position(ARRAY['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], lower(m[1])) - 1
    FROM (SELECT regexp_match(btrim(COALESCE(p_label, '')), '^([A-Za-z]{3})[A-Za-z]*[\s.,''/-]*([0-9]{4}|[0-9]{2})$') AS m) x;
$$;

-- A typed value as a date or an amount; NULL when blank or not one (the
-- door then refuses it in words, never with a raw cast error).
CREATE OR REPLACE FUNCTION public.twob__try_date(p text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN NULLIF(btrim(COALESCE(p, '')), '')::date;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.twob__try_num(p text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN NULLIF(btrim(COALESCE(p, '')), '')::numeric;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
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

-- Filed itself: a GSTR-3B for the month, or a GSTR-3B (Q) for its quarter,
-- was marked Filed (and not reopened). A month can be prior without it, when
-- only a later month was marked Filed; the words say which (Filing Status).
CREATE OR REPLACE FUNCTION public.twob_month_own_filed(p_client_id uuid, p_period text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.twob_ever_filed e
                  WHERE e.client_id = p_client_id AND e.reopened_at IS NULL
                    AND public.twob_period_key(p_period)
                        BETWEEN e.cover_key - CASE WHEN e.return_type = 'GSTR-3B (Q)' THEN 2 ELSE 0 END AND e.cover_key);
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
-- and the same supplier name), the same invoice number and date. (PL/pgSQL
-- with the normalising written out: as nested SQL functions it was not
-- inlined and cost about 0.1 ms a row.)
CREATE OR REPLACE FUNCTION public.twob_doc_ident(p_gstin text, p_name text, p_number text, p_date date)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  g text := regexp_replace(upper(COALESCE(p_gstin, '')), '\s', '', 'g');
BEGIN
  RETURN concat_ws('|', g,
                   CASE WHEN g = '' THEN regexp_replace(upper(btrim(COALESCE(p_name, ''))), '\s+', ' ', 'g') ELSE '' END,
                   ltrim(regexp_replace(upper(COALESCE(p_number, '')), '[^A-Z0-9]', '', 'g'), '0'), p_date::text);
END;
$$;

-- One document: the same invoice (twob_doc_ident) with the same amounts.
CREATE OR REPLACE FUNCTION public.twob_doc_key(
  p_gstin text, p_name text, p_number text, p_date date,
  p_taxable numeric, p_igst numeric, p_cgst numeric, p_sgst numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  g text := regexp_replace(upper(COALESCE(p_gstin, '')), '\s', '', 'g');
BEGIN
  RETURN concat_ws('|', g,
                   CASE WHEN g = '' THEN regexp_replace(upper(btrim(COALESCE(p_name, ''))), '\s+', ' ', 'g') ELSE '' END,
                   ltrim(regexp_replace(upper(COALESCE(p_number, '')), '[^A-Z0-9]', '', 'g'), '0'), p_date::text,
                   round(COALESCE(p_taxable, 0), 2)::text, round(COALESCE(p_igst, 0), 2)::text,
                   round(COALESCE(p_cgst, 0), 2)::text, round(COALESCE(p_sgst, 0), 2)::text);
END;
$$;

-- The month an entry started from, as its copies carry it: its reversal
-- month (Not in 2B) or in-2B month (Not in Books), "Jul 26", "jul-2026" and
-- "July 26" alike; '' when blank. A later copy of an entry is the same
-- document (twob_doc_key) with the same such month, so a change reaches only
-- that entry's copies, never a later month's own entry of the same invoice
-- (which carries its own month) or that entry's copies.
CREATE OR REPLACE FUNCTION public.twob_month_tag(p_label text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(public.twob_label_key(p_label)::text, upper(regexp_replace(btrim(COALESCE(p_label, '')), '\s+', ' ', 'g')));
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
-- p_period: the month holding the row (p_row is the whole row, its client
-- included). A decision of an open month can be undone there first; one
-- made in a filed month, or held by a filed month's row, cannot, and the
-- message says so. A month column that does not read as a month is named.
CREATE OR REPLACE FUNCTION public.twob__decision_message(p_table text, p_row jsonb, p_period text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_client uuid := NULLIF(p_row ->> 'client_id', '')::uuid;
  v_label text;
  v_has boolean := false;
  v_verb text;
  v_noun text;
  v_key integer;
  v_dec text;
  v_row text := public.twob_month_name(p_period);
BEGIN
  IF p_table = 'bills_not_in_2b' THEN
    v_label := NULLIF(btrim(COALESCE(p_row ->> 'reclaim_month', '')), '');
    v_has := v_label IS NOT NULL OR p_row ->> 'reclaim_subtype' IS NOT NULL;
    IF p_row ->> 'reclaim_subtype' = 'EXPENSE_OUT' THEN
      v_verb := 'expensed out'; v_noun := 'Expense out';
    ELSE
      v_verb := 'reclaimed'; v_noun := 'reclaim';
    END IF;
  ELSIF p_table = 'bills_not_in_books' THEN
    v_label := NULLIF(btrim(COALESCE(p_row ->> 'book_entry_month', '')), '');
    v_has := v_label IS NOT NULL;
    v_verb := 'booked'; v_noun := 'book entry';
  END IF;
  IF NOT v_has THEN
    RETURN NULL;
  END IF;
  v_key := CASE WHEN v_label IS NULL THEN public.twob_period_key(p_period) ELSE public.twob_label_key(v_label) END;
  IF v_key IS NULL THEN
    IF public.twob_month_is_prior(v_client, p_period) THEN
      RETURN format('%s (filed) holds a %s month that is not a month (%s), so it cannot be removed or its amounts changed',
                    v_row, lower(v_noun), v_label);
    END IF;
    RETURN format('%s holds a %s month that is not a month (%s); clear it in %s first', v_row, lower(v_noun), v_label, v_row);
  END IF;
  v_dec := public.twob_month_name(public.twob_period_of_key(v_key));
  IF public.twob_month_is_prior(v_client, public.twob_period_of_key(v_key)) THEN
    RETURN format('%s (filed) has %s this entry, so it cannot be removed or its amounts changed', v_dec, v_verb);
  END IF;
  IF public.twob_month_is_prior(v_client, p_period) THEN
    RETURN format('%s (filed) holds this entry''s %s of %s, so it cannot be removed or its amounts changed', v_row, v_noun, v_dec);
  END IF;
  RETURN v_dec || ' has ' || v_verb || ' this entry; undo that '
         || CASE WHEN v_noun = 'Expense out' THEN '' ELSE v_noun || ' ' END || 'first';
END;
$$;

-- Whether the decision a ledger row holds was made in the row's own month or
-- later (its month label names that month or a later one; a reclaim or
-- Expense out without a label counts as the row's own). A decision carried in
-- from an earlier month (its label names that month) is not: the month it
-- was made in still holds it.
CREATE OR REPLACE FUNCTION public.twob__decision_is_own(p_table text, p_row jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(CASE
    WHEN p_table = 'bills_not_in_2b' THEN
      CASE WHEN NULLIF(btrim(COALESCE(p_row ->> 'reclaim_month', '')), '') IS NULL THEN p_row ->> 'reclaim_subtype' IS NOT NULL
           ELSE public.twob_label_key(p_row ->> 'reclaim_month') >= public.twob_period_key(p_row ->> 'period_month') END
    WHEN p_table = 'bills_not_in_books' THEN
      public.twob_label_key(p_row ->> 'book_entry_month') >= public.twob_period_key(p_row ->> 'period_month')
  END, false);
$$;

-- Whether the row a link column names still exists (a link is cleared
-- directly only after its row is gone: the ON DELETE SET NULL of the keys).
CREATE OR REPLACE FUNCTION public.twob__link_alive(p_col text, p_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN NULLIF(p_id, '') IS NULL THEN false
    WHEN p_col = 'source_book_id' THEN EXISTS (SELECT 1 FROM public.books_register b WHERE b.id = p_id::uuid)
    ELSE EXISTS (SELECT 1 FROM public.twob_import_docs d WHERE d.id = p_id::uuid)
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
-- (or Re-run into a filed month) first changed its books entries: 4B(2)(i) (rows whose reversal month names
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
  'A prior month''s 4B(2)(i), 5.4 and 4D(1.2) from its Not in 2B list, recorded just before twob_prior_books_apply (or '
  'Re-run carry forward into a filed month) first changed the month (20261021100000; docs/2B_RECONCILIATION_FLOW.md §13). '
  'The gates read these instead of the live list once they exist. Removed only when twob_reopen_filed opens the month again.';
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
-- the lock columns only (the filing lock, Unlock sheets), a link cleared
-- after the row it names is gone (the keys' ON DELETE SET NULL; a link to a
-- row that still exists stays), and the rows of a client being deleted. In
-- every month moving a row to another month or client is refused. In an open
-- month a carried row holding a decision made in that month or later (a
-- reclaim, an Expense out, a book entry) is not deleted directly: a page
-- opened before this change still carries and restores the old way, deleting
-- the month and copying it again, which would lose that decision. A decision
-- carried in from an earlier month is copied back by that same copy, so
-- such a row is deleted as before. The copy itself is checked by the
-- statement trigger after this one (twob_guard_carried_insert).
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
                          WHERE v_new -> k IS DISTINCT FROM v_old -> k
                            AND (v_new -> k <> 'null'::jsonb OR public.twob__link_alive(k, v_old ->> k))) THEN
        RETURN NEW;   -- links cleared because the rows they named are gone
      END IF;
    END IF;
    IF TG_TABLE_NAME = 'twob_import_docs' THEN
      RAISE EXCEPTION 'This month is filed. Its 2B documents cannot change. Only a GST Manager or the superadmin can change its books entries, from Import 2B or 2B Reconciliation.';
    END IF;
    RAISE EXCEPTION 'This month is filed. Only a GST Manager or the superadmin can change its books entries, from Import 2B or 2B Reconciliation.';
  END IF;

  -- An open month: a carried entry holding a decision made in this month (or
  -- later) is not deleted directly (undo the decision first).
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME IN ('bills_not_in_2b', 'bills_not_in_books') THEN
    v_old := to_jsonb(OLD);
    IF COALESCE((v_old ->> 'is_carried_forward')::boolean, false) AND public.twob__decision_is_own(TG_TABLE_NAME, v_old) THEN
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

-- An open month never gets a carried entry beside the same document's
-- carried entry that holds a decision (a reclaim, an Expense out, a book
-- entry). A page opened before this change restores a version, or carries,
-- by deleting the month and adding it again, and goes on to add when the
-- delete is refused (above): the add is refused too, so the month is never
-- doubled. Checked once per statement, against the rows that were there
-- before it (twins added together pass). This file's own functions are
-- exempt (twob.write).
CREATE OR REPLACE FUNCTION public.twob_guard_carried_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_dec text := CASE WHEN TG_TABLE_NAME = 'bills_not_in_2b'
                     THEN '(NULLIF(btrim(e.reclaim_month), '''') IS NOT NULL OR e.reclaim_subtype IS NOT NULL)'
                     ELSE '(NULLIF(btrim(e.book_entry_month), '''') IS NOT NULL)' END;
BEGIN
  IF COALESCE(current_setting('twob.write', true), '') IN ('rpc', 'system') THEN
    RETURN NULL;
  END IF;
  -- The decided carried rows of the months written to first (few), then the
  -- documents: a join on number and date alone was planned as a nested loop
  -- over every look-alike (2,000 rows without a number: over 1 s).
  EXECUTE format($q$
    WITH m AS (SELECT DISTINCT n.client_id, n.period_month FROM new_rows n WHERE COALESCE(n.is_carried_forward, false)),
    d AS MATERIALIZED (
      SELECT e.* FROM public.%1$I e JOIN m ON e.client_id = m.client_id AND e.period_month = m.period_month
       WHERE e.is_carried_forward AND %2$s
         AND NOT EXISTS (SELECT 1 FROM new_rows x WHERE x.id = e.id))
    SELECT to_jsonb(n) FROM new_rows n
      JOIN d e ON e.client_id = n.client_id AND e.period_month = n.period_month AND e.date = n.date
       AND public.twob_doc_key(e.supplier_gstin, e.supplier_name, e.supplier_invoice_number, e.date, e.taxable_value, e.input_igst, e.input_cgst, e.input_sgst)
         = public.twob_doc_key(n.supplier_gstin, n.supplier_name, n.supplier_invoice_number, n.date, n.taxable_value, n.input_igst, n.input_cgst, n.input_sgst)
     WHERE COALESCE(n.is_carried_forward, false)
     LIMIT 1$q$, TG_TABLE_NAME, v_dec) INTO v_row;
  IF v_row IS NOT NULL THEN
    RAISE EXCEPTION '%', COALESCE(public.twob__entry_name(v_row) || ': ', '')
      || public.twob_month_name(v_row ->> 'period_month')
      || ' already holds this carried entry, with a reclaim, Expense out or book entry; it is not added again. Reload the page and try again.';
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_twob_carried_insert ON public.bills_not_in_2b;
CREATE TRIGGER trg_twob_carried_insert AFTER INSERT ON public.bills_not_in_2b
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.twob_guard_carried_insert();
DROP TRIGGER IF EXISTS trg_twob_carried_insert ON public.bills_not_in_books;
CREATE TRIGGER trg_twob_carried_insert AFTER INSERT ON public.bills_not_in_books
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.twob_guard_carried_insert();

-- ---------------------------------------------------------------------------
-- 5. The carry: the first carry only, into the next month only
-- ---------------------------------------------------------------------------
-- The months an entry added to a prior month reaches on one list (the door,
-- twob_prior_books_apply): every month after p_period up to the later of the
-- latest month holding carried rows on that list and, with p_through_open,
-- the month after the client's latest filed month (the open month), whether
-- or not a month in between holds any yet. Never further. Empty when there
-- is none.
CREATE OR REPLACE FUNCTION public.twob__reach_months(p_table text, p_client_id uuid, p_period text, p_through_open boolean)
RETURNS text[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_key integer := public.twob_period_key(p_period);
  v_last integer;
BEGIN
  EXECUTE format('SELECT max(public.twob_period_key(t.period_month)) FROM public.%I t
                   WHERE t.client_id = $1 AND t.is_carried_forward AND public.twob_period_key(t.period_month) > $2', p_table)
    INTO v_last USING p_client_id, v_key;
  IF p_through_open THEN
    v_last := GREATEST(v_last, public.twob_prior_through_key(p_client_id) + 1);
  END IF;
  RETURN ARRAY(SELECT public.twob_period_of_key(g) FROM generate_series(v_key + 1, v_last) g ORDER BY g);
END;
$$;

-- What filing did to each list of a month, once per (client, month, list):
-- the first carry into the next month (carried_at, carried_how: 'carried',
-- also when the month held nothing on the list (0 rows: nothing to carry),
-- or 'next_held' when the next month already held a carried list at the
-- month's first filing, which counts as carried; 'backfill' for every month
-- filed before this change, whose filing carried it then; 'rerun' when
-- nothing was carried and a GST Manager then ran Re-run carry forward from
-- the month), and the outcome of the latest filing or Re-run (last_outcome:
-- 'carried', 'next_held', 'next_filed' when the next month was itself filed
-- already and nothing was carried, 'next_prior' when the next month was not
-- filed itself but counted as filed because a later month was,
-- 'done_before' when the first carry had happened, 'rerun' after a Re-run,
-- 'reopened' when a return marked Filed by mistake was reopened (its carry is
-- undone in the record: carried_at NULL, carried_how kept), 'refiled' when
-- such a month was filed again (it never carries again by itself),
-- 'rerun_pending' when a Re-run of the month before brought entries into this
-- filed month, which a Re-run from it carries on). Filing Status reads it to
-- say, list by list, what was carried, and marks a filed month whose list is
-- not carried (carried_at NULL) until a Re-run from it. Written only by
-- twob_carry_first, twob_carry_rerun, twob_reopen_filed and the back-fill
-- here.
CREATE TABLE IF NOT EXISTS public.twob_carry_log (
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  list         text NOT NULL CHECK (list IN ('bills_not_in_2b', 'bills_not_in_books')),
  next_period  text NOT NULL,
  carried_at   timestamptz,
  carried_how  text,
  carried_rows integer NOT NULL DEFAULT 0,
  last_outcome text NOT NULL,
  last_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, period_month, list)
);
ALTER TABLE public.twob_carry_log DROP CONSTRAINT IF EXISTS twob_carry_log_carried_how_check;
ALTER TABLE public.twob_carry_log ADD CONSTRAINT twob_carry_log_carried_how_check
  CHECK (carried_how IN ('carried', 'next_held', 'backfill', 'rerun'));
ALTER TABLE public.twob_carry_log DROP CONSTRAINT IF EXISTS twob_carry_log_last_outcome_check;
ALTER TABLE public.twob_carry_log ADD CONSTRAINT twob_carry_log_last_outcome_check
  CHECK (last_outcome IN ('carried', 'next_held', 'next_filed', 'next_prior', 'done_before', 'backfill', 'rerun',
                          'reopened', 'refiled', 'rerun_pending'));
COMMENT ON TABLE public.twob_carry_log IS
  'The filing carry of each list of a month (20261021100000; docs/2B_RECONCILIATION_FLOW.md §13): made once, into the next '
  'month only, when that month is not filed and holds no carried rows on the list (carried_at, carried_how, carried_rows); '
  'never again after that. carried_at NULL: not carried (Filing Status warns until a Re-run from the month). last_outcome: '
  'what the latest filing, Re-run or reopen of the month did. Written by twob_carry_first, twob_carry_rerun and '
  'twob_reopen_filed only.';
ALTER TABLE public.twob_carry_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view twob_carry_log" ON public.twob_carry_log;
CREATE POLICY "Anyone can view twob_carry_log" ON public.twob_carry_log FOR SELECT TO public USING (true);
GRANT SELECT ON public.twob_carry_log TO anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.twob_carry_log FROM anon, authenticated;

-- Every return filed before this change carried its month when it was filed
-- (the old delete-and-copy carry): that first carry has happened.
INSERT INTO public.twob_carry_log (client_id, period_month, list, next_period, carried_at, carried_how, carried_rows, last_outcome, last_at)
SELECT e.client_id, e.period_month, l.list, public.twob_period_of_key(public.twob_period_key(e.period_month) + 1),
       e.first_filed_at, 'backfill', 0, 'backfill', now()
  FROM public.twob_ever_filed e
 CROSS JOIN (VALUES ('bills_not_in_2b'), ('bills_not_in_books')) l(list)
 WHERE public.twob_period_key(e.period_month) IS NOT NULL
ON CONFLICT (client_id, period_month, list) DO NOTHING;

-- The late filing carry of round 2 is gone (docs §13): nothing carries into
-- a filed month or past the next month by itself.
DROP FUNCTION IF EXISTS public.twob__carry_into(text, uuid, text, text[]);

-- The carry when a month is marked Filed, list by list: the month's entries
-- are copied into the next month only the first time (no carry of this list
-- recorded yet), only when the next month is not filed, and only when it
-- holds no carried rows on the list; otherwise nothing, so a later month's
-- reclaims, book entries and removals stay. A list the month holds nothing
-- on has nothing to carry and is recorded as carried (0 rows), whatever the
-- next month is. A month filed after its next month (its PDF came late), or
-- after a later month (the next month then counts as filed: 'next_prior'),
-- carries nothing: Filing Status says so on the month's row, and a GST
-- Manager repairs it with Re-run carry forward, previewed. A month whose
-- carry record already exists but shows no carry (reopened as Filed by
-- mistake, or given entries by a Re-run of the month before) is not counted
-- as carried because its next month holds a carried list ('next_held' stays
-- a gap there), and one that carried before it was reopened never copies
-- again by itself ('refiled'). Internal: called by the filing trigger.
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
  v_next_prior boolean;
  v_done boolean;
  v_exists boolean;
  v_how text;
  v_any boolean;
  v_held boolean;
  v_outcome text;
  v_counts boolean;
  v_out jsonb := '{}'::jsonb;
  l text;
  n integer;
BEGIN
  IF p_client_id IS NULL OR v_key IS NULL THEN
    RETURN NULL;
  END IF;
  v_next := public.twob_period_of_key(v_key + 1);
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  PERFORM set_config('twob.write', 'system', true);
  v_next_prior := public.twob_month_is_prior(p_client_id, v_next);
  FOREACH l IN ARRAY ARRAY['bills_not_in_2b', 'bills_not_in_books'] LOOP
    n := 0;
    v_done := NULL;
    v_exists := false;
    v_how := NULL;
    SELECT g.carried_at IS NOT NULL, true, g.carried_how INTO v_done, v_exists, v_how FROM public.twob_carry_log g
     WHERE g.client_id = p_client_id AND g.period_month = p_period AND g.list = l;
    v_exists := COALESCE(v_exists, false);
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I t WHERE t.client_id = $1 AND t.period_month = $2)', l)
      INTO v_any USING p_client_id, p_period;
    IF COALESCE(v_done, false) THEN
      v_outcome := 'done_before';
    ELSIF NOT v_any THEN
      v_outcome := 'carried';   -- nothing to carry
    ELSIF v_next_prior THEN
      v_outcome := CASE WHEN public.twob_month_own_filed(p_client_id, v_next) THEN 'next_filed' ELSE 'next_prior' END;
    ELSIF v_how IS NOT NULL THEN
      v_outcome := 'refiled';   -- carried once, then reopened: never copied again by itself
    ELSE
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I t WHERE t.client_id = $1 AND t.period_month = $2 AND t.is_carried_forward)', l)
        INTO v_held USING p_client_id, v_next;
      IF v_held THEN
        v_outcome := 'next_held';
      ELSIF l = 'bills_not_in_2b' THEN
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
        GET DIAGNOSTICS n = ROW_COUNT;
        v_outcome := 'carried';
      ELSE
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
        GET DIAGNOSTICS n = ROW_COUNT;
        v_outcome := 'carried';
      END IF;
    END IF;
    -- Counts as carried: a copy made (or nothing to copy), or a carried list
    -- found in the next month at the month's very first filing.
    v_counts := v_outcome = 'carried' OR (v_outcome = 'next_held' AND NOT v_exists);
    INSERT INTO public.twob_carry_log AS g (client_id, period_month, list, next_period, carried_at, carried_how, carried_rows, last_outcome, last_at)
    VALUES (p_client_id, p_period, l, v_next,
            CASE WHEN v_counts THEN now() END,
            CASE WHEN v_counts THEN v_outcome END, n, v_outcome, now())
    ON CONFLICT (client_id, period_month, list) DO UPDATE
      SET next_period = EXCLUDED.next_period,
          carried_at = COALESCE(g.carried_at, EXCLUDED.carried_at),
          carried_how = COALESCE(g.carried_how, EXCLUDED.carried_how),
          carried_rows = CASE WHEN g.carried_at IS NULL THEN EXCLUDED.carried_rows ELSE g.carried_rows END,
          last_outcome = EXCLUDED.last_outcome, last_at = now();
    v_out := v_out || jsonb_build_object(l, jsonb_build_object('outcome', v_outcome, 'rows', n));
  END LOOP;
  PERFORM set_config('twob.write', COALESCE(v_prev, ''), true);
  RETURN v_out || jsonb_build_object('period', p_period, 'next_period', v_next, 'next_prior', v_next_prior);
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
      -- The client's lock first, as every writer of the 2B lists takes it
      -- before any row lock (two writers never wait on each other in turn).
      PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || NEW.client_id::text, 0));
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
-- one list of a filed month against the next month, document by document,
-- twins one to one, in this order:
--  1. the same document (twob_doc_key) carried: nothing to do;
--  2. the same document as the next month's own entry: not added again;
--  3. the same invoice (twob_doc_ident) carried at other amounts: the copy is
--     replaced when it holds no decision; when it holds one (TAMNNA's T-2) it
--     is a conflict, named and left alone, and the entry is not added (the
--     invoice would be reclaimed twice);
--  4. the same supplier at the same amounts, a carried copy holding a
--     decision (its number or date corrected in the next month, then
--     reclaimed there): a conflict too, for the same reason; paired first
--     on the same number, then on the same date, and when more entries than
--     such copies are left, every one of them is a conflict (none added);
--  5. the same number, date and amounts, a carried copy holding a decision
--     (its supplier or GSTIN corrected in the next month, then reclaimed
--     there): a conflict too;
-- then the entries left are added, the carried copies left without a
-- decision removed, and those holding one kept. p_add_only (the next month
-- is filed, an out-of-order filing repaired): entries are only added, never
-- a copy removed or replaced there (a copy at other amounts is a conflict;
-- the copies the month no longer holds are listed as left). p_dry_run: what
-- it would do.
CREATE OR REPLACE FUNCTION public.twob__rerun_list(
  p_table text, p_client_id uuid, p_period text, p_next text, p_dry_run boolean, p_add_only boolean)
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
  v_sup text := 'concat_ws(''|'', public.twob_norm_gstin(t.supplier_gstin), '
                || 'CASE WHEN public.twob_norm_gstin(t.supplier_gstin) = '''' THEN public.twob_norm_name(t.supplier_name) END, '
                || 'round(COALESCE(t.taxable_value, 0), 2), round(COALESCE(t.input_igst, 0), 2), '
                || 'round(COALESCE(t.input_cgst, 0), 2), round(COALESCE(t.input_sgst, 0), 2))';
  v_nda text := 'concat_ws(''|'', public.twob_norm_no(t.supplier_invoice_number), t.date, '
                || 'round(COALESCE(t.taxable_value, 0), 2), round(COALESCE(t.input_igst, 0), 2), '
                || 'round(COALESCE(t.input_cgst, 0), 2), round(COALESCE(t.input_sgst, 0), 2))';
BEGIN
  IF NOT p_dry_run THEN
    -- The next month's rows, locked: a decision made meanwhile is seen.
    EXECUTE format('SELECT 1 FROM public.%I t WHERE t.client_id = $1 AND t.period_month = $2 FOR UPDATE', p_table)
      USING p_client_id, p_next;
  END IF;
  EXECUTE format($q$
    WITH s AS (
      SELECT t.id, public.twob_doc_key(%3$s, %4$s) AS key, public.twob_doc_ident(%3$s) AS ident, %5$s AS sup, %6$s AS nda,
             public.twob_norm_no(t.supplier_invoice_number) AS no, t.date AS dt
        FROM public.%1$I t WHERE t.client_id = $1 AND t.period_month = $2),
    c AS (
      SELECT t.id, public.twob_doc_key(%3$s, %4$s) AS key, public.twob_doc_ident(%3$s) AS ident, %5$s AS sup, %6$s AS nda,
             public.twob_norm_no(t.supplier_invoice_number) AS no, t.date AS dt,
             %2$s AS decided, COALESCE(t.is_carried_forward, false) AS carried
        FROM public.%1$I t WHERE t.client_id = $1 AND t.period_month = $3),
    j1 AS (
      SELECT a.id AS sid, b.id AS cid
        FROM (SELECT s.id, s.key, row_number() OVER (PARTITION BY s.key ORDER BY s.id) AS rn FROM s) a
        JOIN (SELECT c.id, c.key, row_number() OVER (PARTITION BY c.key ORDER BY c.decided DESC, c.id) AS rn
                FROM c WHERE c.carried) b
          ON b.key = a.key AND b.rn = a.rn),
    j2 AS (
      SELECT a.id AS sid, b.id AS cid
        FROM (SELECT s.id, s.key, row_number() OVER (PARTITION BY s.key ORDER BY s.id) AS rn
                FROM s WHERE s.id NOT IN (SELECT j1.sid FROM j1)) a
        JOIN (SELECT c.id, c.key, row_number() OVER (PARTITION BY c.key ORDER BY c.id) AS rn
                FROM c WHERE NOT c.carried) b
          ON b.key = a.key AND b.rn = a.rn),
    j3 AS (
      SELECT a.id AS sid, b.id AS cid, b.decided
        FROM (SELECT s.id, s.ident, row_number() OVER (PARTITION BY s.ident ORDER BY s.id) AS rn
                FROM s WHERE s.id NOT IN (SELECT j1.sid FROM j1 UNION ALL SELECT j2.sid FROM j2)) a
        JOIN (SELECT c.id, c.ident, c.decided, row_number() OVER (PARTITION BY c.ident ORDER BY c.decided DESC, c.id) AS rn
                FROM c WHERE c.carried AND c.id NOT IN (SELECT j1.cid FROM j1)) b
          ON b.ident = a.ident AND b.rn = a.rn),
    -- 4: within one supplier and amounts, an entry pairs first with a decided
    -- copy of the same number, then of the same date; the entries left in a
    -- group that still holds a decided copy are all conflicts (none is added:
    -- any of them may be the corrected one), never paired by id order.
    r4 AS MATERIALIZED (
      SELECT s.id, s.sup, s.no, s.dt FROM s
       WHERE s.id NOT IN (SELECT j1.sid FROM j1 UNION ALL SELECT j2.sid FROM j2 UNION ALL SELECT j3.sid FROM j3)),
    c4 AS MATERIALIZED (
      SELECT c.id, c.sup, c.no, c.dt FROM c
       WHERE c.carried AND c.decided AND c.id NOT IN (SELECT j1.cid FROM j1 UNION ALL SELECT j3.cid FROM j3)),
    j4a AS (
      SELECT a.id AS sid, b.id AS cid
        FROM (SELECT r4.id, r4.sup, r4.no, row_number() OVER (PARTITION BY r4.sup, r4.no ORDER BY r4.id) AS rn FROM r4) a
        JOIN (SELECT c4.id, c4.sup, c4.no, row_number() OVER (PARTITION BY c4.sup, c4.no ORDER BY c4.id) AS rn FROM c4) b
          ON b.sup = a.sup AND b.no = a.no AND b.rn = a.rn),
    j4b AS (
      SELECT a.id AS sid, b.id AS cid
        FROM (SELECT r4.id, r4.sup, r4.dt, row_number() OVER (PARTITION BY r4.sup, r4.dt ORDER BY r4.id) AS rn
                FROM r4 WHERE r4.id NOT IN (SELECT j4a.sid FROM j4a)) a
        JOIN (SELECT c4.id, c4.sup, c4.dt, row_number() OVER (PARTITION BY c4.sup, c4.dt ORDER BY c4.id) AS rn
                FROM c4 WHERE c4.id NOT IN (SELECT j4a.cid FROM j4a)) b
          ON b.sup = a.sup AND b.dt = a.dt AND b.rn = a.rn),
    j4c AS (
      SELECT a.id AS sid, b.id AS cid
        FROM (SELECT r4.id, r4.sup, row_number() OVER (PARTITION BY r4.sup ORDER BY r4.id) AS rn
                FROM r4 WHERE r4.id NOT IN (SELECT j4a.sid FROM j4a UNION ALL SELECT j4b.sid FROM j4b)) a
        JOIN (SELECT c4.id, c4.sup, row_number() OVER (PARTITION BY c4.sup ORDER BY c4.id) AS rn, count(*) OVER (PARTITION BY c4.sup) AS n
                FROM c4 WHERE c4.id NOT IN (SELECT j4a.cid FROM j4a UNION ALL SELECT j4b.cid FROM j4b)) b
          ON b.sup = a.sup AND b.rn = (a.rn - 1) %% b.n + 1),
    j4 AS (SELECT j4a.sid, j4a.cid FROM j4a UNION ALL SELECT j4b.sid, j4b.cid FROM j4b UNION ALL SELECT j4c.sid, j4c.cid FROM j4c),
    j5 AS (
      SELECT a.id AS sid, b.id AS cid
        FROM (SELECT s.id, s.nda, row_number() OVER (PARTITION BY s.nda ORDER BY s.id) AS rn
                FROM s WHERE s.id NOT IN (SELECT j1.sid FROM j1 UNION ALL SELECT j2.sid FROM j2 UNION ALL SELECT j3.sid FROM j3
                                          UNION ALL SELECT j4.sid FROM j4)) a
        JOIN (SELECT c.id, c.nda, row_number() OVER (PARTITION BY c.nda ORDER BY c.id) AS rn
                FROM c WHERE c.carried AND c.decided
                  AND c.id NOT IN (SELECT j1.cid FROM j1 UNION ALL SELECT j3.cid FROM j3 UNION ALL SELECT j4.cid FROM j4)) b
          ON b.nda = a.nda AND b.rn = a.rn)
    SELECT
      (SELECT array_agg(s.id) FROM s
        WHERE s.id NOT IN (SELECT j1.sid FROM j1 UNION ALL SELECT j2.sid FROM j2 UNION ALL SELECT j4.sid FROM j4
                           UNION ALL SELECT j5.sid FROM j5 UNION ALL SELECT j3.sid FROM j3 WHERE j3.decided OR $4)),
      (SELECT array_agg(c.id) FROM c WHERE c.carried AND NOT c.decided AND c.id NOT IN (SELECT j1.cid FROM j1)
          AND NOT ($4 AND c.id IN (SELECT j3.cid FROM j3))),
      (SELECT array_agg(c.id) FROM c WHERE c.carried AND c.decided
          AND c.id NOT IN (SELECT j1.cid FROM j1 UNION ALL SELECT j3.cid FROM j3 UNION ALL SELECT j4.cid FROM j4 UNION ALL SELECT j5.cid FROM j5)),
      COALESCE((SELECT jsonb_agg(jsonb_build_object('entry', j3.sid, 'copy', j3.cid, 'kind', CASE WHEN j3.decided THEN 'amount' ELSE 'amount_filed' END))
                  FROM j3 WHERE j3.decided OR $4), '[]'::jsonb)
        || COALESCE((SELECT jsonb_agg(jsonb_build_object('entry', j4.sid, 'copy', j4.cid, 'kind', 'supplier')) FROM j4), '[]'::jsonb)
        || COALESCE((SELECT jsonb_agg(jsonb_build_object('entry', j5.sid, 'copy', j5.cid, 'kind', 'gstin')) FROM j5), '[]'::jsonb)
        || COALESCE((SELECT jsonb_agg(jsonb_build_object('entry', j2.sid, 'copy', j2.cid, 'kind', 'own')) FROM j2), '[]'::jsonb)
    $q$, p_table, v_dec, v_cols, v_amts, v_sup, v_nda)
    INTO v_add, v_remove, v_keep, v_conflicts
    USING p_client_id, p_period, p_next, p_add_only;
  v_add := COALESCE(v_add, '{}');
  v_remove := COALESCE(v_remove, '{}');
  v_keep := COALESCE(v_keep, '{}');
  v_conflicts := COALESCE(v_conflicts, '[]'::jsonb);

  EXECUTE format($q$
    SELECT jsonb_build_object(
      'add', COALESCE((SELECT jsonb_agg(public.twob__entry_json(to_jsonb(t), NULL) ORDER BY t.date, t.id)
                         FROM public.%1$I t WHERE t.id = ANY ($1)), '[]'::jsonb),
      CASE WHEN $7 THEN 'left' ELSE 'remove' END,
               COALESCE((SELECT jsonb_agg(public.twob__entry_json(to_jsonb(t), NULL) ORDER BY t.date, t.id)
                            FROM public.%1$I t WHERE t.id = ANY ($2)), '[]'::jsonb),
      CASE WHEN $7 THEN 'remove' ELSE 'left' END, '[]'::jsonb,
      'keep', COALESCE((SELECT jsonb_agg(public.twob__entry_json(to_jsonb(t), public.twob__decision_message(%2$L, to_jsonb(t), $5)) ORDER BY t.date, t.id)
                          FROM public.%1$I t WHERE t.id = ANY ($3)), '[]'::jsonb),
      'conflict', COALESCE((SELECT jsonb_agg(
                              CASE x ->> 'kind'
                                WHEN 'amount' THEN public.twob__entry_json(to_jsonb(c),
                                  format('%%s holds it at %%s tax and %%s''s copy at %%s; %%s, then re-run',
                                         public.twob_month_name($6), to_char(es.tax, 'FM99,99,99,99,990.00'),
                                         public.twob_month_name($5), to_char(cs.tax, 'FM99,99,99,99,990.00'),
                                         public.twob__decision_message(%2$L, to_jsonb(c), $5)))
                                WHEN 'amount_filed' THEN public.twob__entry_json(to_jsonb(c),
                                  format('%%s holds it at %%s tax and %%s''s copy at %%s. %%s is filed, so Re-run does not replace its copy: correct the copy there through Import 2B or 2B Reconciliation',
                                         public.twob_month_name($6), to_char(es.tax, 'FM99,99,99,99,990.00'),
                                         public.twob_month_name($5), to_char(cs.tax, 'FM99,99,99,99,990.00'), public.twob_month_name($5)))
                                WHEN 'supplier' THEN public.twob__entry_json(to_jsonb(e),
                                  format('%%s''s copy %%s has the same supplier and amounts and holds a decision (%%s). It may be this entry with its number or date corrected there, so this entry is not added beside it. Correct one of them, then re-run',
                                         public.twob_month_name($5),
                                         concat_ws(' ', NULLIF(btrim(COALESCE(c.supplier_invoice_number, '')), ''), 'of ' || to_char(c.date, 'DD-MM-YYYY')),
                                         public.twob__decision_message(%2$L, to_jsonb(c), $5)))
                                WHEN 'gstin' THEN public.twob__entry_json(to_jsonb(e),
                                  format('%%s''s copy from %%s has the same number, date and amounts and holds a decision (%%s). It may be this entry with its supplier or GSTIN corrected there, so this entry is not added beside it. Correct one of them, then re-run',
                                         public.twob_month_name($5),
                                         concat_ws(' ', NULLIF(btrim(COALESCE(c.supplier_name, '')), ''), NULLIF(btrim(COALESCE(c.supplier_gstin, '')), '')),
                                         public.twob__decision_message(%2$L, to_jsonb(c), $5)))
                                ELSE public.twob__entry_json(to_jsonb(e),
                                  format('%%s holds this entry as its own entry; it is not added again', public.twob_month_name($5)))
                              END ORDER BY e.date, e.id)
                              FROM jsonb_array_elements($4) x
                              JOIN public.%1$I c ON c.id = (x ->> 'copy')::uuid
                              JOIN public.%1$I e ON e.id = (x ->> 'entry')::uuid
                              CROSS JOIN LATERAL (SELECT COALESCE(e.input_igst, 0) + COALESCE(e.input_cgst, 0) + COALESCE(e.input_sgst, 0) AS tax) es
                              CROSS JOIN LATERAL (SELECT COALESCE(c.input_igst, 0) + COALESCE(c.input_cgst, 0) + COALESCE(c.input_sgst, 0) AS tax) cs),
                           '[]'::jsonb))$q$, p_table, p_table)
    INTO v_out
    USING v_add, v_remove, v_keep, v_conflicts, p_next, p_period, p_add_only;

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
      IF NOT p_add_only THEN
        DELETE FROM public.bills_not_in_2b WHERE id = ANY (v_remove);
      END IF;
    ELSE
      INSERT INTO public.bills_not_in_books (
        client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
        taxable_value, input_igst, input_cgst, input_sgst,
        period_month, book_entry_month, bill_in_2b_month, is_carried_forward, is_locked)
      SELECT client_id, date, supplier_name, supplier_invoice_number, supplier_gstin,
             taxable_value, input_igst, input_cgst, input_sgst,
             p_next, book_entry_month, bill_in_2b_month, true, v_locked
        FROM public.bills_not_in_books WHERE id = ANY (v_add) ORDER BY date, id;
      IF NOT p_add_only THEN
        DELETE FROM public.bills_not_in_books WHERE id = ANY (v_remove);
      END IF;
    END IF;
  END IF;
  RETURN v_out;
END;
$$;
DROP FUNCTION IF EXISTS public.twob__rerun_list(text, uuid, text, text, boolean);

-- Re-run runs from a filed month into the month after it, one month at a
-- time. Into an open month (the latest filed month's next month, while no
-- month after it holds carried entries) it adds, removes and keeps as above.
-- Into a month that is filed too (the month was filed after its next month,
-- so its filing carried nothing: the only repair of an out-of-order filing)
-- it only adds what that month lacks, its figures recorded first so no gate
-- moves; the GST Manager then re-runs that month into the next, and so on up
-- to the open month (Filing Status marks that month until then:
-- 'rerun_pending'). Previewed first (p_dry_run). next_own_filed: the next
-- month's own return is recorded as Filed (else it counts as filed only
-- because a later month is, and is re-run once it is marked Filed itself).
-- Applied, it is recorded in twob_carry_log (last_outcome 'rerun'), also
-- when it had nothing to do (Filing Status's warning on the month then goes).
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
  v_next_prior boolean;
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
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  v_next_prior := public.twob_month_is_prior(p_client_id, v_next);
  IF NOT v_next_prior THEN
    SELECT public.twob_period_of_key(min(k)) INTO v_beyond
      FROM (SELECT public.twob_period_key(t.period_month) AS k FROM public.bills_not_in_2b t
             WHERE t.client_id = p_client_id AND t.is_carried_forward AND public.twob_period_key(t.period_month) > v_key + 1
            UNION ALL
            SELECT public.twob_period_key(t.period_month) FROM public.bills_not_in_books t
             WHERE t.client_id = p_client_id AND t.is_carried_forward AND public.twob_period_key(t.period_month) > v_key + 1) x;
    IF v_beyond IS NOT NULL THEN
      RAISE EXCEPTION '% already holds carried entries. Re-run works only into the last month that holds them.', public.twob_month_name(v_beyond);
    END IF;
  END IF;
  PERFORM set_config('twob.write', 'system', true);
  IF v_next_prior AND NOT p_dry_run THEN
    PERFORM public.twob__freeze_figures(p_client_id, ARRAY[v_next], p_actor_id);
  END IF;
  v_out := jsonb_build_object(
    'period', p_period, 'next_period', v_next, 'next_filed', v_next_prior, 'dry_run', p_dry_run,
    'next_own_filed', public.twob_month_own_filed(p_client_id, v_next),
    'bills_not_in_2b', public.twob__rerun_list('bills_not_in_2b', p_client_id, p_period, v_next, p_dry_run, v_next_prior),
    'bills_not_in_books', public.twob__rerun_list('bills_not_in_books', p_client_id, p_period, v_next, p_dry_run, v_next_prior));
  IF NOT p_dry_run THEN
    -- Recorded: a month whose filing carried nothing is no longer marked on
    -- Filing Status once a Re-run has run from it, and filing it again
    -- carries nothing (the first carry is done).
    INSERT INTO public.twob_carry_log AS g (client_id, period_month, list, next_period, carried_at, carried_how, carried_rows, last_outcome, last_at)
    SELECT p_client_id, p_period, l.list, v_next, now(), 'rerun', jsonb_array_length(v_out -> l.list -> 'add'), 'rerun', now()
      FROM (VALUES ('bills_not_in_2b'), ('bills_not_in_books')) l(list)
    ON CONFLICT (client_id, period_month, list) DO UPDATE
      SET next_period = EXCLUDED.next_period,
          carried_at = COALESCE(g.carried_at, EXCLUDED.carried_at),
          carried_how = COALESCE(g.carried_how, EXCLUDED.carried_how),
          carried_rows = CASE WHEN g.carried_at IS NULL THEN EXCLUDED.carried_rows ELSE g.carried_rows END,
          last_outcome = 'rerun', last_at = now();
    -- Entries added into a month that is filed (or counts as filed) still
    -- have to reach the month after it: that month's list is marked not
    -- carried ('rerun_pending'), so Filing Status warns on it until a Re-run
    -- from it (filing it again carries nothing by itself).
    IF v_next_prior THEN
      INSERT INTO public.twob_carry_log AS g (client_id, period_month, list, next_period, carried_at, carried_how, carried_rows, last_outcome, last_at)
      SELECT p_client_id, v_next, l.list, public.twob_period_of_key(v_key + 2), NULL, NULL, 0, 'rerun_pending', now()
        FROM (VALUES ('bills_not_in_2b'), ('bills_not_in_books')) l(list)
       WHERE jsonb_array_length(v_out -> l.list -> 'add') > 0
      ON CONFLICT (client_id, period_month, list) DO UPDATE
        SET carried_at = NULL, last_outcome = 'rerun_pending', last_at = now();
    END IF;
  END IF;
  PERFORM set_config('twob.write', COALESCE(v_prev, ''), true);
  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Books entries of a prior month: twob_prior_books_apply
-- ---------------------------------------------------------------------------
-- The later months' carried copies of the Not in 2B / Not in Books entries
-- that p_changes updates or removes in p_period, matched once for the whole
-- call. A later month's carried rows of a document (twob_doc_key) stand for
-- the rows of that document the months before it hold: this month's rows
-- (its own entries and its carried ones) and the own entries of the months
-- in between (an invoice entered again there, as NAVRATNA's April bills
-- typed into December). They are paired one to one, per later month, first
-- on the same reversal month (Not in 2B) or in-2B month (Not in Books)
-- (twob_month_tag), then on the document alone (a copy whose in-2B or
-- reversal month was filled in or changed after the carry, SORATH's 'Nov 24'
-- copies); the months in between first, then this month's unchanged rows,
-- then the changed ones, each taking a copy without a decision before one
-- with a decision. So a change reaches only this entry's own copies, never
-- a later month's own entry or that entry's copies, and when a month holds
-- fewer copies than the rows they stand for, the unchanged rows keep theirs.
-- The first later month holding the document as its own entry is returned
-- with id NULL (the door names it: that entry stays). The entries and every
-- candidate copy (same number and date) are locked first, so a decision
-- committed meanwhile is seen and blocks the change. Per copy: its month,
-- the decision it holds (as the refusal names it), and whether its reversal
-- month is its own month (its removal would move that month's 4B(2)(i)).
-- (Planned without nested loops: the sets come from a jsonb array, which the
-- planner takes for one row, and nested over 1,000 removals took 11 s.)
CREATE OR REPLACE FUNCTION public.twob__match_copies(p_table text, p_client_id uuid, p_period text, p_changes jsonb)
RETURNS TABLE (idx integer, id uuid, period_month text, msg text, own_rev boolean)
LANGUAGE plpgsql
SET enable_nestloop = off
AS $$
DECLARE
  v_key integer := public.twob_period_key(p_period);
  v_own text := CASE WHEN p_table = 'bills_not_in_2b' THEN 'public.twob_label_matches(t.reversal_month, t.period_month)' ELSE 'false' END;
  v_dec text := CASE WHEN p_table = 'bills_not_in_2b'
                     THEN '(NULLIF(btrim(t.reclaim_month), '''') IS NOT NULL OR t.reclaim_subtype IS NOT NULL)'
                     ELSE '(NULLIF(btrim(t.book_entry_month), '''') IS NOT NULL)' END;
  v_doc text := 'public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date, t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst)';
  v_tag text := 'public.twob_month_tag(t.' || CASE WHEN p_table = 'bills_not_in_2b' THEN 'reversal_month' ELSE 'bill_in_2b_month' END || ')';
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
  RETURN QUERY EXECUTE format($q$
    WITH ch AS MATERIALIZED (
      SELECT (x.o - 1)::integer AS idx, t.id, %2$s AS doc,
             public.twob_norm_no(t.supplier_invoice_number) AS no, t.date
        FROM jsonb_array_elements($1) WITH ORDINALITY x(v, o)
        JOIN public.%1$I t ON t.id = NULLIF(x.v ->> 'id', '')::uuid
       WHERE x.v ->> 'table' = %1$L AND x.v ->> 'op' IN ('update', 'delete')
         AND t.client_id = $2 AND t.period_month = $3),
    -- Every row of these documents in this month and the later months.
    d AS MATERIALIZED (
      SELECT r.* FROM (
        SELECT t.id, public.twob_period_key(t.period_month) AS pk, t.period_month, %2$s AS doc, %5$s AS tag,
               COALESCE(t.is_carried_forward, false) AS carried,
               CASE WHEN %4$s THEN public.twob__decision_message(%1$L, to_jsonb(t), t.period_month) END AS msg, %3$s AS own_rev
          FROM public.%1$I t
          JOIN (SELECT DISTINCT ch.no, ch.date FROM ch) n
            ON public.twob_norm_no(t.supplier_invoice_number) = n.no AND t.date = n.date
         WHERE t.client_id = $2 AND public.twob_period_key(t.period_month) >= $4) r
       WHERE r.doc IN (SELECT ch.doc FROM ch)),
    cp AS MATERIALIZED (SELECT d.* FROM d WHERE d.carried AND d.pk > $4),
    mo AS MATERIALIZED (SELECT DISTINCT cp.pk, cp.doc FROM cp),
    -- What a later month's copies stand for: the months in between (cls 0),
    -- this month's unchanged rows (1), the changed ones (2).
    src AS MATERIALIZED (
      SELECT mo.pk, s.doc, s.tag, s.id, CASE WHEN s.pk > $4 THEN 0 WHEN ch.idx IS NULL THEN 1 ELSE 2 END AS cls, ch.idx
        FROM mo
        JOIN d s ON s.doc = mo.doc AND (s.pk = $4 OR (s.pk < mo.pk AND NOT s.carried))
        LEFT JOIN ch ON ch.id = s.id),
    p1 AS MATERIALIZED (
      SELECT a.pk, a.id AS sid, a.idx, b.id AS cid
        FROM (SELECT src.*, row_number() OVER (PARTITION BY src.pk, src.doc, src.tag ORDER BY src.cls, src.idx, src.id) AS rn FROM src) a
        JOIN (SELECT cp.pk, cp.doc, cp.tag, cp.id, row_number() OVER (PARTITION BY cp.pk, cp.doc, cp.tag ORDER BY (cp.msg IS NULL), cp.id) AS rn FROM cp) b
          ON b.pk = a.pk AND b.doc = a.doc AND b.tag = a.tag AND b.rn = a.rn),
    p2 AS MATERIALIZED (
      SELECT a.pk, a.id AS sid, a.idx, b.id AS cid
        FROM (SELECT src.*, row_number() OVER (PARTITION BY src.pk, src.doc ORDER BY src.cls, src.idx, src.id) AS rn
                FROM src WHERE NOT EXISTS (SELECT 1 FROM p1 WHERE p1.pk = src.pk AND p1.sid = src.id)) a
        JOIN (SELECT cp.pk, cp.doc, cp.id, row_number() OVER (PARTITION BY cp.pk, cp.doc ORDER BY (cp.msg IS NULL), cp.id) AS rn
                FROM cp WHERE NOT EXISTS (SELECT 1 FROM p1 WHERE p1.cid = cp.id)) b
          ON b.pk = a.pk AND b.doc = a.doc AND b.rn = a.rn)
    SELECT u.idx, u.id, u.period_month, u.msg, u.own_rev
      FROM (SELECT m.idx, cp.id, cp.period_month, cp.msg, cp.own_rev, cp.pk
              FROM (SELECT p1.idx, p1.cid FROM p1 WHERE p1.idx IS NOT NULL
                    UNION ALL SELECT p2.idx, p2.cid FROM p2 WHERE p2.idx IS NOT NULL) m
              JOIN cp ON cp.id = m.cid
            UNION ALL
            SELECT ch.idx, NULL::uuid, public.twob_period_of_key(o.pk), NULL::text, NULL::boolean, o.pk
              FROM ch JOIN (SELECT d.doc, min(d.pk) AS pk FROM d WHERE NOT d.carried AND d.pk > $4 GROUP BY d.doc) o ON o.doc = ch.doc) u
     ORDER BY u.idx, u.pk$q$, p_table, v_doc, v_own, v_dec, v_tag)
    USING p_changes, p_client_id, p_period, v_key;
END;
$$;

-- The changes that add an entry the month already holds, or that a later
-- month already holds (carried, or as that month's own entry: a bill booked
-- late), as the call leaves them: the first such month per change. Such an
-- entry is not added, in this month or any later one, and the rest of the
-- call goes ahead (a Post of the month posts everything else); the preview
-- names it. So a later month never gets a second copy of a document, and a
-- removed entry is not added back by a later Post that way. Rows the same
-- call removes or changes (p_gone: the entries it updates or deletes and
-- their matched copies) do not count as they are; an entry it changes counts
-- in this month with its new date, supplier, number and amounts. So deleting
-- an entry and adding it again (to give it this month's reversal month) in
-- one Save adds it, and the note never names a row the call removes.
DROP FUNCTION IF EXISTS public.twob__held_inserts(text, uuid, text, jsonb);
CREATE OR REPLACE FUNCTION public.twob__held_inserts(p_table text, p_client_id uuid, p_period text, p_changes jsonb, p_gone uuid[])
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
         AND public.twob__try_date(x.v -> 'values' ->> 'date') IS NOT NULL),
    k AS (
      SELECT ins.idx, public.twob__try_date(ins.v ->> 'date') AS date, public.twob_norm_no(ins.v ->> 'supplier_invoice_number') AS no,
             public.twob_doc_key(ins.v ->> 'supplier_gstin', btrim(ins.v ->> 'supplier_name'), ins.v ->> 'supplier_invoice_number',
                                 public.twob__try_date(ins.v ->> 'date'), public.twob__try_num(ins.v ->> 'taxable_value'),
                                 public.twob__try_num(ins.v ->> 'input_igst'), public.twob__try_num(ins.v ->> 'input_cgst'),
                                 public.twob__try_num(ins.v ->> 'input_sgst')) AS key
        FROM ins),
    -- The entries this call changes, with their new values (in this month).
    upd AS (
      SELECT public.twob_doc_key(
               CASE WHEN u ? 'supplier_gstin' THEN u ->> 'supplier_gstin' ELSE t.supplier_gstin END,
               CASE WHEN u ? 'supplier_name' THEN btrim(u ->> 'supplier_name') ELSE t.supplier_name END,
               CASE WHEN u ? 'supplier_invoice_number' THEN u ->> 'supplier_invoice_number' ELSE t.supplier_invoice_number END,
               CASE WHEN u ? 'date' THEN public.twob__try_date(u ->> 'date') ELSE t.date END,
               CASE WHEN u ? 'taxable_value' THEN COALESCE(public.twob__try_num(u ->> 'taxable_value'), 0) ELSE t.taxable_value END,
               CASE WHEN u ? 'input_igst' THEN COALESCE(public.twob__try_num(u ->> 'input_igst'), 0) ELSE t.input_igst END,
               CASE WHEN u ? 'input_cgst' THEN COALESCE(public.twob__try_num(u ->> 'input_cgst'), 0) ELSE t.input_cgst END,
               CASE WHEN u ? 'input_sgst' THEN COALESCE(public.twob__try_num(u ->> 'input_sgst'), 0) ELSE t.input_sgst END) AS key
        FROM (SELECT x.v ->> 'id' AS id, x.v -> 'values' AS u FROM jsonb_array_elements($1) x(v)
               WHERE x.v ->> 'table' = %1$L AND x.v ->> 'op' = 'update' AND jsonb_typeof(x.v -> 'values') = 'object') c
        JOIN public.%1$I t ON t.id = NULLIF(c.id, '')::uuid
       WHERE t.client_id = $2 AND t.period_month = $3)
    SELECT DISTINCT ON (h.idx) h.idx, h.period_month
      FROM (SELECT k.idx, t.period_month, public.twob_period_key(t.period_month) AS pk
              FROM k
              JOIN public.%1$I t ON t.client_id = $2 AND t.date = k.date
               AND public.twob_norm_no(t.supplier_invoice_number) = k.no
               AND public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date,
                                       t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst) = k.key
             WHERE public.twob_period_key(t.period_month) >= $4
               AND NOT (t.id = ANY ($5))
            UNION ALL
            SELECT k.idx, $3, $4 FROM k JOIN upd ON upd.key = k.key) h
     ORDER BY h.idx, h.pk$q$, p_table)
    USING p_changes, p_client_id, p_period, v_key, COALESCE(p_gone, '{}');
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
      SELECT p_client_id, m.period, public.twob__try_date(p_vals ->> 'date'), btrim(p_vals ->> 'supplier_name'),
             p_vals ->> 'supplier_invoice_number', p_vals ->> 'supplier_gstin',
             COALESCE(public.twob__try_num(p_vals ->> 'taxable_value'), 0), COALESCE(public.twob__try_num(p_vals ->> 'input_igst'), 0),
             COALESCE(public.twob__try_num(p_vals ->> 'input_cgst'), 0), COALESCE(public.twob__try_num(p_vals ->> 'input_sgst'), 0),
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
      SELECT p_client_id, m.period, public.twob__try_date(p_vals ->> 'date'), btrim(p_vals ->> 'supplier_name'),
             p_vals ->> 'supplier_invoice_number', p_vals ->> 'supplier_gstin',
             COALESCE(public.twob__try_num(p_vals ->> 'taxable_value'), 0), COALESCE(public.twob__try_num(p_vals ->> 'input_igst'), 0),
             COALESCE(public.twob__try_num(p_vals ->> 'input_cgst'), 0), COALESCE(public.twob__try_num(p_vals ->> 'input_sgst'), 0),
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
      date = CASE WHEN $1 ? 'date' THEN public.twob__try_date($1 ->> 'date') ELSE t.date END,
      supplier_name = CASE WHEN $1 ? 'supplier_name' THEN btrim($1 ->> 'supplier_name') ELSE t.supplier_name END,
      supplier_invoice_number = CASE WHEN $1 ? 'supplier_invoice_number' THEN $1 ->> 'supplier_invoice_number' ELSE t.supplier_invoice_number END,
      supplier_gstin = CASE WHEN $1 ? 'supplier_gstin' THEN $1 ->> 'supplier_gstin' ELSE t.supplier_gstin END,
      taxable_value = CASE WHEN $1 ? 'taxable_value' THEN COALESCE(public.twob__try_num($1 ->> 'taxable_value'), 0) ELSE t.taxable_value END,
      input_igst = CASE WHEN $1 ? 'input_igst' THEN COALESCE(public.twob__try_num($1 ->> 'input_igst'), 0) ELSE t.input_igst END,
      input_cgst = CASE WHEN $1 ? 'input_cgst' THEN COALESCE(public.twob__try_num($1 ->> 'input_cgst'), 0) ELSE t.input_cgst END,
      input_sgst = CASE WHEN $1 ? 'input_sgst' THEN COALESCE(public.twob__try_num($1 ->> 'input_sgst'), 0) ELSE t.input_sgst END,
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

-- Whether a carried Not in Books row (p_row, in p_period) is a copy of an
-- invoice an earlier month holds as an entry from a 2B document (the same
-- supplier GSTIN, or name without one, number and date: twob_doc_ident). Such
-- a copy follows the filed 2B like that entry, and changes in no filed
-- month. A copy of a typed entry, or one whose entry is gone (SORATH's,
-- SKYLARK's chains that start mid-history), is a books entry like any other.
CREATE OR REPLACE FUNCTION public.twob__nib_follows_2b(p_client_id uuid, p_period text, p_row jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.bills_not_in_books o
                  WHERE o.client_id = p_client_id AND o.source_doc_id IS NOT NULL
                    AND o.date = public.twob__try_date(p_row ->> 'date')
                    AND public.twob_norm_no(o.supplier_invoice_number) = public.twob_norm_no(p_row ->> 'supplier_invoice_number')
                    AND public.twob_period_key(o.period_month) < public.twob_period_key(p_period)
                    AND public.twob_doc_ident(o.supplier_gstin, o.supplier_name, o.supplier_invoice_number, o.date)
                      = public.twob_doc_ident(p_row ->> 'supplier_gstin', p_row ->> 'supplier_name', p_row ->> 'supplier_invoice_number',
                                              public.twob__try_date(p_row ->> 'date')));
$$;

-- The carried Not in Books rows of a month that follow a 2B document (as
-- above), for 2B Reconciliation: in a filed month they are read-only, with
-- the reason; the month's other carried rows change through the door.
CREATE OR REPLACE FUNCTION public.twob_nib_2b_copies(p_client_id uuid, p_period text)
RETURNS uuid[]
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(array_agg(t.id ORDER BY t.id), '{}')
    FROM public.bills_not_in_books t
   WHERE t.client_id = p_client_id AND t.period_month = p_period AND t.is_carried_forward
     AND EXISTS (SELECT 1 FROM public.bills_not_in_books o
                  WHERE o.client_id = p_client_id AND o.source_doc_id IS NOT NULL AND o.date = t.date
                    AND public.twob_norm_no(o.supplier_invoice_number) = public.twob_norm_no(t.supplier_invoice_number)
                    AND public.twob_period_key(o.period_month) < public.twob_period_key(p_period)
                    AND public.twob_doc_ident(o.supplier_gstin, o.supplier_name, o.supplier_invoice_number, o.date)
                      = public.twob_doc_ident(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date));
$$;

-- One change of a Not in 2B / Not in Books entry in prior month p_period,
-- and the same change on every later month's carried copy of the entry
-- (p_copies: twob__match_copies' rows for this change). Returns what it did
-- (or would do): this month's effect, each later month touched, or a refusal
-- (then nothing of this change is written), or a note (an added entry some
-- month already holds: nothing is written for it, the rest goes ahead).
-- p_months: the later months an added entry reaches (twob__reach_months).
-- p_held: the month already holding an added entry, if any. p_named_books:
-- the books register rows the call names itself (left to their own change).
-- p_stop: the first later month holding the entry as its own entry too
-- (that entry and its copies stay), named in the result.
-- A Not in Books entry posted from a 2B document (source_doc_id) follows the
-- filed 2B, not the books: it is neither added, changed nor removed here; nor
-- is a carried copy of an invoice an earlier month holds from a 2B document
-- (twob__nib_follows_2b).
DROP FUNCTION IF EXISTS public.twob__apply_ledger(uuid, uuid, text, text, text, uuid, jsonb, text[], text[], uuid[], text[], text[], boolean[], text, uuid[]);
CREATE OR REPLACE FUNCTION public.twob__apply_ledger(
  p_actor_id uuid, p_client_id uuid, p_period text,
  p_table text, p_op text, p_id uuid, p_vals jsonb, p_months text[], p_locked text[],
  p_copy_ids uuid[], p_copy_periods text[], p_copy_msgs text[], p_copy_own boolean[],
  p_held text, p_named_books uuid[], p_stop text)
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
    IF NOT v_is2b AND NULLIF(btrim(COALESCE(p_vals ->> 'source_doc_id', '')), '') IS NOT NULL THEN
      RETURN v_base || jsonb_build_object('refusal', 'A Not in Books entry from a 2B document is not added to a filed month: it follows the filed 2B, which stays as filed. Only books entries change in a filed month');
    END IF;
    IF NULLIF(btrim(COALESCE(p_vals ->> v_dec_col, '')), '') IS NOT NULL OR NULLIF(btrim(COALESCE(p_vals ->> 'reclaim_subtype', '')), '') IS NOT NULL THEN
      RETURN v_base || jsonb_build_object('refusal', CASE WHEN v_is2b
        THEN 'A new entry in a filed month cannot be reclaimed or expensed out. Record that in an open month.'
        ELSE 'A new entry in a filed month cannot be booked. Record its book entry in an open month.' END);
    END IF;
    IF NULLIF(btrim(COALESCE(p_vals ->> 'date', '')), '') IS NULL OR NULLIF(btrim(COALESCE(p_vals ->> 'supplier_name', '')), '') IS NULL THEN
      RETURN v_base || jsonb_build_object('refusal', 'Enter the date and the supplier of the new entry.');
    END IF;
    IF public.twob__try_date(p_vals ->> 'date') IS NULL THEN
      RETURN v_base || jsonb_build_object('refusal', format('%s is not a date.', p_vals ->> 'date'));
    END IF;
    SELECT format('%s is not an amount.', p_vals ->> a) INTO v_msg FROM unnest(v_amt) a
     WHERE NULLIF(btrim(COALESCE(p_vals ->> a, '')), '') IS NOT NULL AND public.twob__try_num(p_vals ->> a) IS NULL LIMIT 1;
    IF v_msg IS NOT NULL THEN
      RETURN v_base || jsonb_build_object('refusal', v_msg);
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
      RETURN v_base || jsonb_build_object('this', jsonb_build_object('action', 'none'), 'later', '[]'::jsonb,
        'note', format('%s already holds this entry on its %s list; it is not added again', public.twob_month_name(p_held),
          CASE WHEN v_is2b THEN 'Not in 2B' ELSE 'Not in Books' END));
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
  IF NOT v_is2b AND v_old ->> 'source_doc_id' IS NOT NULL THEN
    RETURN v_base || jsonb_build_object('refusal', 'This Not in Books entry comes from a 2B document and follows the filed 2B, so it is neither changed nor removed in a filed month. Only books entries change in a filed month');
  END IF;
  -- A carried Not in Books copy of an invoice an earlier month holds as an
  -- entry from a 2B document follows that document too: it is neither
  -- changed nor removed (a copy changed on its own would leave the later
  -- months without the 2B's pending entry). Copies of typed entries, and
  -- copies whose entry is gone, change here like any books entry.
  IF NOT v_is2b AND COALESCE((v_old ->> 'is_carried_forward')::boolean, false)
     AND public.twob__nib_follows_2b(p_client_id, p_period, v_old) THEN
    RETURN v_base || jsonb_build_object('refusal', 'This Not in Books entry is a copy of an entry from a 2B document and follows the filed 2B, so it is neither changed nor removed in a filed month. Only books entries change in a filed month');
  END IF;

  IF p_op = 'update' THEN
    FOR k IN SELECT jsonb_object_keys(p_vals) LOOP
      IF k = ANY (v_ignored) THEN CONTINUE; END IF;
      IF k = 'date' THEN
        IF NULLIF(btrim(COALESCE(p_vals ->> k, '')), '') IS NULL THEN
          RETURN v_base || jsonb_build_object('refusal', 'An entry needs a date.');
        ELSIF public.twob__try_date(p_vals ->> k) IS NULL THEN
          RETURN v_base || jsonb_build_object('refusal', format('%s is not a date.', p_vals ->> k));
        ELSIF public.twob__try_date(p_vals ->> k) IS DISTINCT FROM (v_old ->> k)::date THEN
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
        IF NULLIF(btrim(COALESCE(p_vals ->> k, '')), '') IS NOT NULL AND public.twob__try_num(p_vals ->> k) IS NULL THEN
          RETURN v_base || jsonb_build_object('refusal', format('%s is not an amount.', p_vals ->> k));
        END IF;
        IF round(COALESCE(public.twob__try_num(p_vals ->> k), 0), 2) <> round(COALESCE((v_old ->> k)::numeric, 0), 2) THEN
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
  -- post it again (paired with a 2B document or not: a filed month's 2B
  -- documents never pair again, and Post posts every Not in 2B invoice); a
  -- changed entry changes the books row too. The preview says so.
  IF v_is2b AND v_old ->> 'source_book_id' IS NOT NULL AND NOT ((v_old ->> 'source_book_id')::uuid = ANY (COALESCE(p_named_books, '{}'))) THEN
    SELECT to_jsonb(b) INTO v_book FROM public.books_register b
     WHERE b.id = (v_old ->> 'source_book_id')::uuid AND b.client_id = p_client_id AND b.period_month = p_period
     FOR UPDATE;
    IF v_book IS NOT NULL AND v_book ->> 'book_treatment' = 'NOT_IN_2B' AND COALESCE(v_book ->> 'doc_type', 'INVOICE') <> 'DEBIT_NOTE' THEN
      IF p_op = 'delete' THEN
        IF COALESCE((v_book ->> 'taxable_value')::numeric, 0) >= 0 AND COALESCE((v_book ->> 'input_igst')::numeric, 0) >= 0
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
    'books_row', v_book_done)), 'later', v_later)
    || CASE WHEN p_stop IS NOT NULL THEN jsonb_build_object('stop', format(
         '%s holds this entry as its own entry too; that entry and its copies stay as they are',
         public.twob_month_name(p_stop))) ELSE '{}'::jsonb END;
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
  v_bad text;
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
  IF NULLIF(btrim(COALESCE(v_set ->> 'date', '')), '') IS NOT NULL AND public.twob__try_date(v_set ->> 'date') IS NULL THEN
    RETURN v_base || jsonb_build_object('refusal', format('%s is not a date.', v_set ->> 'date'));
  END IF;
  SELECT format('%s is not an amount.', v_set ->> a) INTO v_bad FROM unnest(ARRAY['taxable_value', 'input_igst', 'input_cgst', 'input_sgst']) a
   WHERE NULLIF(btrim(COALESCE(v_set ->> a, '')), '') IS NOT NULL AND public.twob__try_num(v_set ->> a) IS NULL LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RETURN v_base || jsonb_build_object('refusal', v_bad);
  END IF;
  v_new := CASE WHEN p_op = 'insert' THEN v_set ELSE v_old || v_set END;
  IF COALESCE(public.twob__try_num(v_new ->> 'taxable_value'), 0) < 0 OR COALESCE(public.twob__try_num(v_new ->> 'input_igst'), 0) < 0
     OR COALESCE(public.twob__try_num(v_new ->> 'input_cgst'), 0) < 0 OR COALESCE(public.twob__try_num(v_new ->> 'input_sgst'), 0) < 0 THEN
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
      p_client_id, p_period, public.twob__try_date(v_set ->> 'date'), v_set ->> 'supplier_name', v_set ->> 'supplier_invoice_number',
      v_set ->> 'supplier_gstin', COALESCE(public.twob__try_num(v_set ->> 'taxable_value'), 0), COALESCE(public.twob__try_num(v_set ->> 'input_igst'), 0),
      COALESCE(public.twob__try_num(v_set ->> 'input_cgst'), 0), COALESCE(public.twob__try_num(v_set ->> 'input_sgst'), 0),
      COALESCE(v_set ->> 'doc_type', 'INVOICE'), COALESCE(v_set ->> 'book_treatment', 'NOT_IN_2B'), p_actor_id, now())
    RETURNING id INTO v_id;
    RETURN v_base || jsonb_build_object('this', jsonb_build_object('action', 'add', 'id', v_id), 'later', '[]'::jsonb);
  END IF;
  IF v_set = '{}'::jsonb THEN
    RETURN v_base || jsonb_build_object('this', jsonb_build_object('action', 'none', 'id', p_id), 'later', '[]'::jsonb);
  END IF;
  UPDATE public.books_register b SET
    date = CASE WHEN v_set ? 'date' THEN public.twob__try_date(v_set ->> 'date') ELSE b.date END,
    supplier_name = CASE WHEN v_set ? 'supplier_name' THEN v_set ->> 'supplier_name' ELSE b.supplier_name END,
    supplier_invoice_number = CASE WHEN v_set ? 'supplier_invoice_number' THEN v_set ->> 'supplier_invoice_number' ELSE b.supplier_invoice_number END,
    supplier_gstin = CASE WHEN v_set ? 'supplier_gstin' THEN v_set ->> 'supplier_gstin' ELSE b.supplier_gstin END,
    taxable_value = CASE WHEN v_set ? 'taxable_value' THEN COALESCE(public.twob__try_num(v_set ->> 'taxable_value'), 0) ELSE b.taxable_value END,
    input_igst = CASE WHEN v_set ? 'input_igst' THEN COALESCE(public.twob__try_num(v_set ->> 'input_igst'), 0) ELSE b.input_igst END,
    input_cgst = CASE WHEN v_set ? 'input_cgst' THEN COALESCE(public.twob__try_num(v_set ->> 'input_cgst'), 0) ELSE b.input_cgst END,
    input_sgst = CASE WHEN v_set ? 'input_sgst' THEN COALESCE(public.twob__try_num(v_set ->> 'input_sgst'), 0) ELSE b.input_sgst END,
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
  v_notes jsonb := '[]'::jsonb;
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
  v_gone uuid[];
  h_idx integer[];
  h_per text[];
  v_held text;
  -- the changes whose invoice a later month holds as its own entry too (named)
  s_idx integer[];
  s_per text[];
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
  -- The later months an added entry reaches on each list: every month up to
  -- the later of the latest one holding carried rows on that list and the
  -- month after the client's latest filed month (the open month), a month in
  -- between included even when it holds none yet. Never further.
  v_months_2b := public.twob__reach_months('bills_not_in_2b', p_client_id, p_period, true);
  v_months_books := public.twob__reach_months('bills_not_in_books', p_client_id, p_period, true);
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
    -- The later copies of every entry changed or removed, matched once (rows
    -- locked), and the first later month holding the invoice as its own
    -- entry too (a row without id, named in the preview).
    WITH x AS MATERIALIZED (
      SELECT mc.*, row_number() OVER () AS ord FROM public.twob__match_copies('bills_not_in_2b', p_client_id, p_period, p_changes) mc
      UNION ALL
      SELECT mc.*, row_number() OVER () FROM public.twob__match_copies('bills_not_in_books', p_client_id, p_period, p_changes) mc)
    SELECT COALESCE(array_agg(x.idx ORDER BY x.idx, x.ord) FILTER (WHERE x.id IS NOT NULL), '{}'),
           COALESCE(array_agg(x.id ORDER BY x.idx, x.ord) FILTER (WHERE x.id IS NOT NULL), '{}'),
           COALESCE(array_agg(x.period_month ORDER BY x.idx, x.ord) FILTER (WHERE x.id IS NOT NULL), '{}'),
           COALESCE(array_agg(x.msg ORDER BY x.idx, x.ord) FILTER (WHERE x.id IS NOT NULL), '{}'),
           COALESCE(array_agg(x.own_rev ORDER BY x.idx, x.ord) FILTER (WHERE x.id IS NOT NULL), '{}'),
           COALESCE(array_agg(x.idx ORDER BY x.idx) FILTER (WHERE x.id IS NULL), '{}'),
           COALESCE(array_agg(x.period_month ORDER BY x.idx) FILTER (WHERE x.id IS NULL), '{}')
      INTO m_idx, m_id, m_per, m_msg, m_own, s_idx, s_per
      FROM x;
    m_n := COALESCE(array_length(m_idx, 1), 0);
    -- The added entries some month already holds, as the call leaves it: the
    -- rows it removes or changes (the entries and their matched copies) do
    -- not count as they are.
    v_gone := m_id || ARRAY(SELECT NULLIF(x ->> 'id', '')::uuid FROM jsonb_array_elements(p_changes) x
                             WHERE x ->> 'op' IN ('update', 'delete') AND NULLIF(x ->> 'id', '') IS NOT NULL);
    SELECT COALESCE(array_agg(h.idx), '{}'), COALESCE(array_agg(h.period_month), '{}') INTO h_idx, h_per
      FROM (SELECT * FROM public.twob__held_inserts('bills_not_in_2b', p_client_id, p_period, p_changes, v_gone)
            UNION ALL
            SELECT * FROM public.twob__held_inserts('bills_not_in_books', p_client_id, p_period, p_changes, v_gone)) h;

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
          m_id[p:q - 1], m_per[p:q - 1], m_msg[p:q - 1], m_own[p:q - 1], v_held, v_named_books,
          CASE WHEN c ->> 'op' IN ('update', 'delete') THEN s_per[array_position(s_idx, i)] END);
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
      ELSIF v_one ? 'note' THEN
        v_notes := v_notes || jsonb_build_array(jsonb_build_object(
          'index', i, 'entry', v_one -> 'entry', 'message', v_one ->> 'note', 'kind', 'held'));
      ELSIF v_one ? 'stop' THEN
        v_notes := v_notes || jsonb_build_array(jsonb_build_object(
          'index', i, 'entry', v_one -> 'entry', 'message', v_one ->> 'stop', 'kind', 'stop'));
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
    'changes', v_changes, 'refusals', v_refusals, 'notes', v_notes, 'later_months', v_later);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. A return marked Filed by mistake
-- ---------------------------------------------------------------------------
-- A GST Manager or the superadmin reopens it for Import 2B and 2B
-- Reconciliation once its status is no longer Filed, writing why. Never a
-- return filed on the portal: while a row of the return (GSTR-3B or GSTR-3B
-- (Q), the period's twins included) still holds an ARN or a filing source
-- (filed_source, 20261021110000), as Unlock leaves it, the reopen is refused;
-- the superadmin's Take off Filed (filing_status_unfile) clears both first.
-- The client's lock is taken before the rows are read, so a pull filing the
-- month meanwhile (auto_lock_on_filed takes the same lock) is either seen
-- here and refused, or runs after the reopen and records the month as filed
-- again (trg_twob_record_filed). The rows are read without FOR UPDATE: a
-- pull locks its row before this lock, and the reverse order here would
-- deadlock with it. The record
-- stays (reopened_at, reopened_by, reopen_reason); the months it no longer
-- keeps prior read their live lists again (their recorded figures go). Its
-- next month keeps the entries the mistaken filing carried into it, and its
-- carry record is marked not carried (carried_at NULL, 'reopened'): filed
-- for real, the month carries nothing again by itself ('refiled', or
-- 'next_held' as a gap), Filing Status marks its row, and Re-run carry
-- forward brings the next month in line (the entries added since).
CREATE OR REPLACE FUNCTION public.twob_reopen_filed(
  p_actor_id uuid, p_client_id uuid, p_return_type text, p_period text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_through integer;
  v_row record;
BEGIN
  IF p_actor_id IS NULL OR COALESCE(public.staff_level_of(p_actor_id), '') NOT IN ('superadmin', 'gst_manager') THEN
    RAISE EXCEPTION 'Only a GST Manager or the superadmin can reopen a return marked Filed by mistake.';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Write why Filed was set by mistake.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  -- Read after the lock (a new snapshot): a pull that filed the month while
  -- this waited is seen. filed_source through to_jsonb: the column comes
  -- with 20261021110000, which is applied after this file.
  FOR v_row IN
    SELECT f.return_type::text AS return_type, f.status::text AS status, f.arn,
           to_jsonb(f) ->> 'filed_source' AS filed_source
      FROM public.filing_status f
     WHERE f.client_id = p_client_id AND f.period_month = p_period
       AND f.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)')
     ORDER BY (f.return_type::text = p_return_type) DESC
  LOOP
    IF v_row.status = 'Filed' THEN
      RAISE EXCEPTION 'Its status is still Filed. Change the status first, then reopen it.';
    END IF;
    IF v_row.arn IS NOT NULL OR v_row.filed_source IS NOT NULL THEN
      RAISE EXCEPTION 'Filed on the portal: % % still holds % (Unlock keeps it), so the month stays filed. If the return is not filed on the portal, the superadmin takes it off Filed first (Take off Filed); then it can be reopened.',
        v_row.return_type, p_period,
        CASE WHEN v_row.arn IS NOT NULL THEN 'ARN ' || v_row.arn ELSE 'its filing source (' || v_row.filed_source || ')' END;
    END IF;
  END LOOP;
  UPDATE public.twob_ever_filed
     SET reopened_at = now(), reopened_by = p_actor_id, reopen_reason = btrim(p_reason)
   WHERE client_id = p_client_id AND return_type = p_return_type AND period_month = p_period AND reopened_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This return is not recorded as filed for Import 2B and 2B Reconciliation.';
  END IF;
  v_through := public.twob_prior_through_key(p_client_id);
  DELETE FROM public.twob_filed_figures
   WHERE client_id = p_client_id AND (v_through IS NULL OR public.twob_period_key(period_month) > v_through);
  -- The mistaken filing's carry no longer counts: filed for real, the month
  -- carries nothing again by itself (its next month keeps what it holds),
  -- and Filing Status marks it until a Re-run brings the next month in line.
  UPDATE public.twob_carry_log
     SET carried_at = NULL, last_outcome = 'reopened', last_at = now()
   WHERE client_id = p_client_id AND period_month = p_period;
  RETURN public.twob_month_state(p_client_id, p_period);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7b. Restore of a saved version (2B Reconciliation, the superadmin)
-- ---------------------------------------------------------------------------
-- A month's own entries on its two lists replaced by a saved version's, in
-- one transaction. Only on the client's latest month that holds rows on
-- either list: an earlier month's restore would leave the later months'
-- carried copies as they are (its changes reach no later month), and a filed
-- month is never restored. The month's carried entries are never touched:
-- they follow the filed months (a GST Manager's correction there reaches
-- them, and no version of this month records it), so a restore never brings
-- back a copy a filed month removed (SORATH) nor drops one it added; the
-- version's carried rows are left out, and so is a version's own entry the
-- month now holds as a carried entry (named in left_out: restored, the month
-- would hold it twice). A version that does not say which of its rows were
-- carried is refused. p_bills_2b / p_bills_books: the
-- version's rows (snake_case, as the page reads them from twob_versions).
-- The page writes the version record after.
CREATE OR REPLACE FUNCTION public.twob_restore_version(
  p_actor_id uuid, p_client_id uuid, p_period text, p_bills_2b jsonb, p_bills_books jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev text := current_setting('twob.write', true);
  v_key integer := public.twob_period_key(p_period);
  v_latest text;
  v_bad text;
  n2b integer := 0;
  nbk integer := 0;
  c2b integer := 0;
  cbk integer := 0;
  v_skip_2b bigint[];
  v_skip_books bigint[];
  v_left jsonb;
BEGIN
  IF p_actor_id IS NULL OR COALESCE(public.staff_level_of(p_actor_id), '') <> 'superadmin' THEN
    RAISE EXCEPTION 'Only the superadmin can restore a version.';
  END IF;
  IF p_client_id IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'Choose a client and a month.';
  END IF;
  IF public.twob_month_is_prior(p_client_id, p_period) THEN
    RAISE EXCEPTION 'This month is filed. Its 2B documents and the reversal, reclaim and book entry months cannot change. Restore works on open months only.';
  END IF;
  p_bills_2b := COALESCE(p_bills_2b, '[]'::jsonb);
  p_bills_books := COALESCE(p_bills_books, '[]'::jsonb);
  IF jsonb_typeof(p_bills_2b) <> 'array' OR jsonb_typeof(p_bills_books) <> 'array' THEN
    RAISE EXCEPTION 'This version cannot be read. Nothing was restored.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  SELECT public.twob_period_of_key(max(k)) INTO v_latest
    FROM (SELECT public.twob_period_key(t.period_month) AS k FROM public.bills_not_in_2b t WHERE t.client_id = p_client_id
          UNION ALL
          SELECT public.twob_period_key(t.period_month) FROM public.bills_not_in_books t WHERE t.client_id = p_client_id) x
   WHERE x.k > v_key;
  IF v_latest IS NOT NULL THEN
    RAISE EXCEPTION 'Restore works only on the latest month that holds entries (%). Restoring % would not reach the entries % holds.',
      public.twob_month_name(v_latest), public.twob_month_name(p_period), public.twob_month_name(v_latest);
  END IF;
  SELECT CASE WHEN public.twob__try_date(x ->> 'date') IS NULL THEN 'An entry of this version has no date or a date that is not one.'
              WHEN NULLIF(btrim(COALESCE(x ->> 'supplier_name', '')), '') IS NULL THEN 'An entry of this version has no supplier name.'
              ELSE format('%s is not an amount.', COALESCE(
                CASE WHEN NULLIF(btrim(COALESCE(x ->> 'taxable_value', '')), '') IS NOT NULL AND public.twob__try_num(x ->> 'taxable_value') IS NULL THEN x ->> 'taxable_value' END,
                CASE WHEN NULLIF(btrim(COALESCE(x ->> 'input_igst', '')), '') IS NOT NULL AND public.twob__try_num(x ->> 'input_igst') IS NULL THEN x ->> 'input_igst' END,
                CASE WHEN NULLIF(btrim(COALESCE(x ->> 'input_cgst', '')), '') IS NOT NULL AND public.twob__try_num(x ->> 'input_cgst') IS NULL THEN x ->> 'input_cgst' END,
                CASE WHEN NULLIF(btrim(COALESCE(x ->> 'input_sgst', '')), '') IS NOT NULL AND public.twob__try_num(x ->> 'input_sgst') IS NULL THEN x ->> 'input_sgst' END)) END
    INTO v_bad
    FROM (SELECT x FROM jsonb_array_elements(p_bills_2b) x UNION ALL SELECT x FROM jsonb_array_elements(p_bills_books) x) e(x)
   WHERE jsonb_typeof(x) <> 'object'
      OR public.twob__try_date(x ->> 'date') IS NULL
      OR NULLIF(btrim(COALESCE(x ->> 'supplier_name', '')), '') IS NULL
      OR EXISTS (SELECT 1 FROM unnest(ARRAY['taxable_value', 'input_igst', 'input_cgst', 'input_sgst']) a
                  WHERE NULLIF(btrim(COALESCE(x ->> a, '')), '') IS NOT NULL AND public.twob__try_num(x ->> a) IS NULL)
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '% Nothing was restored.', v_bad;
  END IF;
  IF EXISTS (SELECT 1 FROM (SELECT x FROM jsonb_array_elements(p_bills_2b) x UNION ALL SELECT x FROM jsonb_array_elements(p_bills_books) x) e(x)
              WHERE lower(COALESCE(x ->> 'is_carried_forward', '')) NOT IN ('true', 't', '1', 'false', 'f', '0')) THEN
    RAISE EXCEPTION 'This version does not say which of its entries were carried, so it cannot be restored. Nothing was restored.';
  END IF;
  PERFORM set_config('twob.write', 'system', true);
  SELECT count(*) FILTER (WHERE x.l = 2), count(*) FILTER (WHERE x.l = 1) INTO c2b, cbk
    FROM (SELECT 2 AS l FROM public.bills_not_in_2b t WHERE t.client_id = p_client_id AND t.period_month = p_period AND t.is_carried_forward
          UNION ALL
          SELECT 1 FROM public.bills_not_in_books t WHERE t.client_id = p_client_id AND t.period_month = p_period AND t.is_carried_forward) x;
  -- The version's own entries the month now holds as carried entries (an
  -- entry typed here, later moved to the filed month it belongs to, whose
  -- correction carried it back in) are left out and named: restored, the
  -- month would hold it twice. One to one: as many as the month's carried
  -- rows of that document exceed the version's.
  WITH v AS (
    SELECT 2 AS l, e.o, e.x, lower(COALESCE(e.x ->> 'is_carried_forward', '')) IN ('true', 't', '1') AS carried,
           public.twob_doc_key(e.x ->> 'supplier_gstin', e.x ->> 'supplier_name', e.x ->> 'supplier_invoice_number',
             public.twob__try_date(e.x ->> 'date'), public.twob__try_num(e.x ->> 'taxable_value'), public.twob__try_num(e.x ->> 'input_igst'),
             public.twob__try_num(e.x ->> 'input_cgst'), public.twob__try_num(e.x ->> 'input_sgst')) AS doc
      FROM jsonb_array_elements(p_bills_2b) WITH ORDINALITY e(x, o)
    UNION ALL
    SELECT 1, e.o, e.x, lower(COALESCE(e.x ->> 'is_carried_forward', '')) IN ('true', 't', '1'),
           public.twob_doc_key(e.x ->> 'supplier_gstin', e.x ->> 'supplier_name', e.x ->> 'supplier_invoice_number',
             public.twob__try_date(e.x ->> 'date'), public.twob__try_num(e.x ->> 'taxable_value'), public.twob__try_num(e.x ->> 'input_igst'),
             public.twob__try_num(e.x ->> 'input_cgst'), public.twob__try_num(e.x ->> 'input_sgst'))
      FROM jsonb_array_elements(p_bills_books) WITH ORDINALITY e(x, o)),
  cur AS (
    SELECT 2 AS l, public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date,
                                        t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst) AS doc, count(*) AS n
      FROM public.bills_not_in_2b t WHERE t.client_id = p_client_id AND t.period_month = p_period AND t.is_carried_forward GROUP BY 2
    UNION ALL
    SELECT 1, public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date,
                                   t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst), count(*)
      FROM public.bills_not_in_books t WHERE t.client_id = p_client_id AND t.period_month = p_period AND t.is_carried_forward GROUP BY 2),
  vc AS (SELECT v.l, v.doc, count(*) AS n FROM v WHERE v.carried GROUP BY 1, 2),
  own AS (SELECT v.*, row_number() OVER (PARTITION BY v.l, v.doc ORDER BY v.o) AS rn FROM v WHERE NOT v.carried),
  sk AS (
    SELECT own.* FROM own
      JOIN cur ON cur.l = own.l AND cur.doc = own.doc
      LEFT JOIN vc ON vc.l = own.l AND vc.doc = own.doc
     WHERE own.rn <= cur.n - COALESCE(vc.n, 0))
  SELECT COALESCE(array_agg(sk.o) FILTER (WHERE sk.l = 2), '{}'), COALESCE(array_agg(sk.o) FILTER (WHERE sk.l = 1), '{}'),
         COALESCE(jsonb_agg(public.twob__entry_json(jsonb_build_object('period_month', p_period, 'date', sk.x ->> 'date',
             'supplier_name', sk.x ->> 'supplier_name', 'supplier_invoice_number', sk.x ->> 'supplier_invoice_number',
             'input_igst', public.twob__try_num(sk.x ->> 'input_igst'), 'input_cgst', public.twob__try_num(sk.x ->> 'input_cgst'),
             'input_sgst', public.twob__try_num(sk.x ->> 'input_sgst')),
           format('%s holds it as a carried entry now, so the version''s own entry is left out', public.twob_month_name(p_period)))
           ORDER BY sk.l DESC, sk.o), '[]'::jsonb)
    INTO v_skip_2b, v_skip_books, v_left
    FROM sk;
  DELETE FROM public.bills_not_in_2b WHERE client_id = p_client_id AND period_month = p_period AND NOT COALESCE(is_carried_forward, false);
  DELETE FROM public.bills_not_in_books WHERE client_id = p_client_id AND period_month = p_period AND NOT COALESCE(is_carried_forward, false);
  INSERT INTO public.bills_not_in_2b (
    client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
    taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month, reclaim_subtype,
    is_carried_forward, updated_by, updated_at)
  SELECT p_client_id, p_period, public.twob__try_date(x ->> 'date'), x ->> 'supplier_name',
         NULLIF(x ->> 'supplier_invoice_number', ''), NULLIF(x ->> 'supplier_gstin', ''),
         COALESCE(public.twob__try_num(x ->> 'taxable_value'), 0), COALESCE(public.twob__try_num(x ->> 'input_igst'), 0),
         COALESCE(public.twob__try_num(x ->> 'input_cgst'), 0), COALESCE(public.twob__try_num(x ->> 'input_sgst'), 0),
         NULLIF(btrim(COALESCE(x ->> 'reversal_month', '')), ''), NULLIF(btrim(COALESCE(x ->> 'reclaim_month', '')), ''),
         NULLIF(btrim(COALESCE(x ->> 'reclaim_subtype', '')), ''),
         false, p_actor_id, now()
    FROM jsonb_array_elements(p_bills_2b) WITH ORDINALITY e(x, o)
   WHERE lower(x ->> 'is_carried_forward') IN ('false', 'f', '0') AND NOT (o = ANY (v_skip_2b))
   ORDER BY o;
  GET DIAGNOSTICS n2b = ROW_COUNT;
  INSERT INTO public.bills_not_in_books (
    client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
    taxable_value, input_igst, input_cgst, input_sgst, book_entry_month, bill_in_2b_month,
    is_carried_forward, updated_by, updated_at)
  SELECT p_client_id, p_period, public.twob__try_date(x ->> 'date'), x ->> 'supplier_name',
         NULLIF(x ->> 'supplier_invoice_number', ''), NULLIF(x ->> 'supplier_gstin', ''),
         COALESCE(public.twob__try_num(x ->> 'taxable_value'), 0), COALESCE(public.twob__try_num(x ->> 'input_igst'), 0),
         COALESCE(public.twob__try_num(x ->> 'input_cgst'), 0), COALESCE(public.twob__try_num(x ->> 'input_sgst'), 0),
         NULLIF(btrim(COALESCE(x ->> 'book_entry_month', '')), ''), NULLIF(btrim(COALESCE(x ->> 'bill_in_2b_month', '')), ''),
         false, p_actor_id, now()
    FROM jsonb_array_elements(p_bills_books) WITH ORDINALITY e(x, o)
   WHERE lower(x ->> 'is_carried_forward') IN ('false', 'f', '0') AND NOT (o = ANY (v_skip_books))
   ORDER BY o;
  GET DIAGNOSTICS nbk = ROW_COUNT;
  PERFORM set_config('twob.write', COALESCE(v_prev, ''), true);
  RETURN jsonb_build_object('period', p_period, 'bills_not_in_2b', n2b, 'bills_not_in_books', nbk,
                            'carried_kept_2b', c2b, 'carried_kept_books', cbk, 'left_out', v_left);
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
  public.twob_reopen_filed(uuid, uuid, text, text, text),
  public.twob_restore_version(uuid, uuid, text, jsonb, jsonb),
  public.twob_nib_2b_copies(uuid, text)
TO anon, authenticated, service_role;

-- Internal: they write without checking who acts, or are triggers.
REVOKE ALL ON FUNCTION
  public.twob_carry_first(uuid, text),
  public.twob__reach_months(text, uuid, text, boolean),
  public.twob__rerun_list(text, uuid, text, text, boolean, boolean),
  public.twob__freeze_figures(uuid, text[], uuid),
  public.twob__match_copies(text, uuid, text, jsonb),
  public.twob__held_inserts(text, uuid, text, jsonb, uuid[]),
  public.twob__ledger_insert(text, uuid, text, jsonb, text[], text[], uuid),
  public.twob__ledger_update(text, uuid[], jsonb, uuid),
  public.twob__ledger_delete(text, uuid[]),
  public.twob__nib_follows_2b(uuid, text, jsonb),
  public.twob__apply_ledger(uuid, uuid, text, text, text, uuid, jsonb, text[], text[], uuid[], text[], text[], boolean[], text, uuid[], text),
  public.twob__apply_books_register(uuid, uuid, text, text, uuid, jsonb),
  public.twob_guard(),
  public.twob_guard_carried_insert(),
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
