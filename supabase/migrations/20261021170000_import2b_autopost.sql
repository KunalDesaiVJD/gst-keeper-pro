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
--     the month already holds unlinked, not carried, with this month as its
--     reversal (in-2B) month (typed on 2B Reconciliation, or put back by a
--     Restore) links that entry instead of adding a twin (Post's twin
--     reversed the bill twice). Since verification round 2: an own entry
--     with a blank or another month's reversal month is never linked (a twin
--     goes beside it, as Post's did: 4B(2)(i) counts only this month's), and
--     a linked own entry keeps what it held (adopted_from) and, when its row
--     stops posting (another treatment, deleted, Delete 2B, in a filed month
--     through the door too), goes back to that and is unlinked, never
--     removed: the ledger ends where Post's twin, added and taken back, left
--     it (twob__autopost_effective / twob__autopost_adjust). Deleting a
--     books row or a 2B document takes back the entry it posted unless that
--     entry is filed (locked) or holds a decision, as Import 2B's delete did.
--     Writes of this release's own functions (twob.write 'rpc' / 'system':
--     the door, the carry, Re-run, Restore) post nothing here: they write the
--     ledger themselves.
--     Who may (verification round 1): a save that changes the ledger needs
--     Import 2B & post (work_2b_import), as Post did; the user the request
--     names (x-gst-actor; twob_import2b_save_book's p_actor_id for its call)
--     without it is refused, nothing of the save kept; a save that changes
--     nothing on the ledger goes through for any staff, a books row's
--     pairing call included (round 4: that call no longer asks for the
--     permission itself). A books row or 2B document deleted so that its
--     entry leaves the ledger or is put back is such a save too (round 4,
--     twob__autopost_gone).
--     A refusal says where to undo the decision (twob__undo_hint): Import
--     2B's Pending items list booked entries with Undo book entry since this
--     round. A reclaim (twob_import2b_reclaim), a document taken out of
--     Reclaim (twob_import2b_unreclaim, round 2) and a books row's pairing
--     (twob_import2b_save_book) are one call each: entry and document, or
--     documents and row, together or not at all.
--     A decision a carried entry brought into an open month from a filed
--     month (a book entry, a reclaim, an Expense out) stays as filed: direct
--     writes cannot change it there (twob__carried_decision_guard, round 2;
--     Pending items shows it without Undo). Clear Data undoes only the
--     month's own carried decisions (the guard lets the rest be removed).
--  2. Race-safe and idempotent by source id: the client's lock (the one every
--     writer of a client's 2B lists takes) is held while the plan is read and
--     written, the ledger rows taken back are locked and read again first (a
--     decision saved meanwhile is seen), and a unique index allows one ledger
--     row per books row / 2B document. A save takes its row's lock, then the
--     client's; Delete 2B, Clear Data and the catch-up take the client's
--     first, so they take the month's rows without waiting
--     (twob__lock_month_rows) and stop with a plain message when a save of
--     the month is running at that moment, instead of deadlocking. 2B
--     Reconciliation's Restore takes them in the saves' order (verification
--     round 7): the month's Reclaim documents, then the client's lock, then
--     the entries (before, it took the client's lock first and a document as
--     an entry named it, and deadlocked with an out of Reclaim of it); with
--     the client's lock held, it takes the month's books rows and documents
--     (which its entries name) without waiting, as the client-lock-first
--     functions do (round 8: a books row or document deleted on Import 2B
--     held its row and waited for the client's lock while Restore's key
--     check waited for the row, a deadlock).
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
--     The page's "not in step" line is read in one statement
--     (twob_import2b_step, STABLE, any staff; round 2). Both, and every
--     prior-month save, write only what their confirm showed (round 3): the
--     dry run returns a digest of the plan (twob__autopost_digest) or of the
--     door's preview (twob__prior_digest, built without row ids by
--     twob__prior_save_preview), the apply sends it back (p_digest), and the
--     plan made again under the client's lock, or the prior-month save as it
--     is made there (round 4: digested as its preview was, the door run once;
--     a second preview had run it three more times, 1.9 s for 1,000 rows),
--     must have it, or nothing is written ("changed while the confirm was
--     open"; as Post re-planned under the lock and posted nothing when the
--     plan differed).
--     A row the catch-up leaves out says whether its entry stays on the
--     ledger as last saved ('on_ledger').
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
--     while already marked behind by the same person. Each row of a
--     snapshot carries its Import 2B link, adoptedFrom, reclaimSubtype and
--     reclaimedViaDocId (round 2), and 2B Reconciliation's Restore calls
--     twob_restore_version_linked, which puts every entry back linked (the
--     version's link; for an older version the link its entry of the same
--     id holds; else, for this month's entries, by the document itself), so
--     the next save changes the entry instead of adding a second reversal;
--     it returns the month as it left it (rows_2b, rows_books), which the
--     page records as the RESTORE version (verification round 7: it
--     recorded the version restored, reclaims that came back in Awaiting
--     reclaim included).
--     20261021100000's twob_restore_version is left as it is (an app of
--     before calls it), so applying either file again never undoes the
--     other.
--  7. The money rules, held by the database whichever screen, tab or app
--     version writes (verification rounds 5 and 6):
--      - one reclaim per 2B document, and only with a document that is
--        Reclaim: an entry newly names a document only while that document
--        is Reclaim and no other entry names it, whoever writes it
--        (twob__reclaim_via_check, round 6; the document's row and lock held
--        while it checks, so two writers at once are seen); before, a stale
--        tab reclaimed a second entry with one document and 5.4 counted its
--        ITC twice, and a Restore put back a reclaim against a document no
--        longer Reclaim (counted in 5.1 and 5.4). twob_import2b_reclaim
--        also takes the treatment the page showed (p_expect_action) and
--        writes nothing, with the page's words, when the document holds
--        another one now or already evidences a reclaim, and makes the
--        document Reclaim before the entry names it. A pair recorded before
--        stays as it is (the check is on a new naming). A unique index on
--        bills_not_in_2b(reclaimed_via_doc_id) holds it a second time where
--        no document is named twice (section 1; not on live, see step 1).
--        Restore brings a reclaim back only while its document is in the
--        month, Reclaim and evidencing no other; otherwise the entry comes
--        back in Awaiting reclaim, named (reclaims_back). A reclaim comes
--        back reclaimed only with its document known exactly (round 9:
--        never by its amounts): the one the version names, else the one the
--        month's entry of that id names now, else the month's only original
--        invoice or debit note that is the same document (twob_doc_ident,
--        round 7: before, a version of before's reclaim came back with no
--        document, counted in 5.4 beside the document's count in 5.1), a
--        named document going to its own reclaim first; then on the same
--        terms, and linked to it. Otherwise, whenever the month holds any
--        2B document, for a Strict and a Liberal client alike, the entry
--        comes back in Awaiting reclaim, named ("reclaim it again on Import
--        2B"; round 8 looked by the amounts and moved reclaims between
--        entries of equal amounts, onto another supplier's document, and
--        left a Liberal client's counted twice); only a Liberal client's
--        reclaim in a month holding no 2B document (typed on 2B
--        Reconciliation) comes back as typed; a Strict client's comes back
--        in Awaiting reclaim then too (round 8: Delete 2B since). Round 10:
--        the version's own naming before the month's entry's, before the
--        same document; one found as the same document only while no other
--        reclaim of the version takes it and its amounts are the entry's
--        (Rs. 2 a head); and every Reclaim document a Restore leaves
--        evidencing no reclaim is named (docs_left), never changed, and
--        offered by Pending items' Link & Reclaim, its row saying its ITC
--        counts nowhere;
--      - a document stays Reclaim, and is not deleted, while an entry is
--        reclaimed against it (twob__reclaim_evidence_guard): only
--        twob_import2b_unreclaim and Delete 2B, which put the entry back in
--        Awaiting reclaim first in the same transaction, take it out (before,
--        a stale tab's Save made it Mismatched: its ITC in 5.1 and again in
--        5.4; a re-import's delete left the reclaim with no document);
--        twob_import2b_unreclaim refuses a document no longer Reclaim, or
--        evidencing another reclaim than the one the page showed on its row
--        (p_expect_entry, round 7: before, a stale tab's Save released a
--        reclaim another user had recorded with the document since; a
--        document two entries name, recorded before the rule, leaves with
--        either shown, both released, round 8); a
--        document a reclaim recorded before names while it is not Reclaim
--        can only be made Reclaim (round 6);
--      - an entry names its reclaiming document only while it holds the
--        reclaim (twob__reclaim_via_tidy): a reclaim cleared or made an
--        Expense out lets the document go in the same write;
--      - a books row is saved only while it holds what the page loaded:
--        twob_import2b_save_book and twob_import2b_prior_save (preview and
--        save) take p_expect and raise "was changed elsewhere" (TWB04),
--        nothing saved, when the row no longer holds it.
--
-- RLS: unchanged on the four tables (open: the app has no auth session).
-- twob_autopost_state: select open, written only by these functions.
-- Re-runnable: CREATE OR REPLACE, IF NOT EXISTS, triggers dropped and created
-- again. Tests: supabase/tests/twob_simple/run.sh applies this file twice
-- after 20261021100000, as a role that is not a superuser, and runs
-- test_9a_autopost.sql (every save kind, refusals, versions, Delete 2B, Clear
-- Data, catch-up, prior month), test_9b_autopost_race.sh (two sessions),
-- test_9c_autopost_timing.sql (1,000 rows), test_9d_autopost_round1.sql and
-- test_9e_autopost_locks.sh (the first verification round's findings),
-- test_9f_autopost_round2.sql (the second round's), test_9g_autopost_round3.sql
-- and round3.test.mjs (the third round's: the digests, the rows left out,
-- the app's scoped and gated calls), test_9h_autopost_round4.sql and
-- round4.test.mjs (the fourth round's: the employee's pairing, a delete off
-- the ledger needing Import 2B & post, the prior-month save's one door run;
-- the app's guarded Saves and Pending items decisions), test_9i_autopost_round5.sql
-- and round5.test.mjs (the fifth round's: one reclaim per document, a
-- document Reclaim while reclaimed against, a reclaim cleared letting its
-- document go, a stale books save refused in an open and a filed month,
-- Pending items over data of before, version numbers; each check recorded,
-- so run on the code of before each fails or passes on its own),
-- test_9j_autopost_round6.sql, test_9k_reclaim_race.sh and round6.test.mjs
-- (the sixth round's: Restore and a reclaim's document; one reclaim per
-- document held without the index, beside a pair recorded before, against
-- the app of before's own writes and two sessions at once; two saves of one
-- books row from one page), test_9l_autopost_round7.sql,
-- test_9m_restore_lock_order.sh and round7.test.mjs (the seventh round's: a
-- version of before's reclaim restored against its document; out of
-- Reclaim only for the reclaim the page showed; Restore and an out of
-- Reclaim of one document at the same moment; the RESTORE version as the
-- Restore left the month), test_9n_autopost_round8.sql, test_9m (cases 3
-- and 4) and round8.test.mjs (the eighth round's: a Strict client's reclaim
-- restored from a version that names no document, back in Awaiting reclaim
-- when it is not the same document; a pair of before out of Reclaim; a
-- books row or document deleted while a Restore runs; the page hearing its
-- own Restore), test_9o_autopost_round9.sql (the ninth round's: no reclaim
-- restored by its amounts, so none moves to another entry's or another
-- supplier's document and a Liberal client's is not counted twice; a named
-- reclaim first; two documents of one identity not guessed; a 1,000 +
-- 1,000 Restore timed), test_9p_autopost_round10.sql and round10.test.mjs
-- (the tenth round's: the documents a Restore leaves Reclaim evidencing
-- nothing named, and reclaimed with again from Pending items; two reclaims
-- of one identity never told apart by order, held to their amounts; the
-- version's naming first, the reason worded by its source) and
-- autopost.test.mjs
-- (the write-through against planImport2BPost + postImport2BToLedger on
-- twin clients, after every save kind; own entries adopted then taken back).
--
-- LIVE APPLY (project gcquafqxbykxkbexcdpy only; never SUPABASE_PROJECT_REF):
-- after the rest of the 21 Oct release (20261021160000, 100000, 110000,
-- 120000, 150000; all applied on 22 Oct 2026) and BEFORE the app goes out:
-- the app no longer has Post,
-- so without this file its saves would not reach the ledger, and it calls
-- twob_import2b_reclaim / twob_import2b_save_book / twob_import2b_unreclaim /
-- twob_import2b_step / twob_restore_version_linked. The app of before (still
-- with Post, live since 22 Oct 2026) keeps working against it in the
-- meantime: its saves write through here and its Post then finds nothing
-- left to do. It names its user on every request (x-gst-actor, through
-- changeLogFetch), so the Import 2B & post check applies to it from the
-- moment this file is applied: its employees without the permission are
-- refused every save that would change the ledger (marking a document Not
-- in Books, completing a Not in 2B books row, deleting a posted books row:
-- "Not saved: this change would change the 2B Reconciliation ledger, which
-- needs the Import 2B & post permission"), which that app allowed (only
-- its Post asked for it). So, before applying: give Import 2B & post to
-- every employee who works Import 2B (the read-only query at the end of
-- step 3 lists who lacks it; run it first), or deploy the app straight
-- after applying (step 5), whose page asks
-- each save first and says which saves need the permission.
-- The round-5 rules (item 7) hold the app of before too: a stale tab's Save
-- of a reclaimed document, or a bulk change over one, is refused ("... is
-- the evidence of the reclaim of ..., so it stays Reclaim") where it used to
-- count the document twice; its own way out of Reclaim (the entry released
-- first, then the document) and its Delete 2B (the reclaims released, then
-- the documents) still go through, and its re-import already keeps a
-- reclaim's document. It calls none of the functions whose signature this
-- round changed (they are new in this release). Its Reclaim on Import 2B
-- (round 6) is refused from the moment this file is applied: it names the
-- document in the entry before it makes the document Reclaim, two requests,
-- and an entry now names only a Reclaim document ("Not saved: the 2B
-- document ... is Matched on Import 2B, not Reclaim ..."; nothing is
-- written). Deploy the app straight after applying (step 5); its Reclaim
-- is one call that does both. A tab of before left open after the deploy
-- is refused the same way until it is reloaded.
-- Already applied in an earlier form? Applying this file again is safe
-- (re-runnable) and brings it to this form: the earlier signatures of
-- twob__autopost_apply, twob_import2b_catch_up and twob_import2b_prior_save
-- are dropped first (round 3 added p_digest; round 5 p_expect, and
-- p_expect_action to twob_import2b_reclaim, p_expect to
-- twob_import2b_save_book; round 7 p_expect_entry to
-- twob_import2b_unreclaim), so no call is ambiguous.
--  1. Dry checks (SELECT only):
--       -- needs 20261021100000 (true, true):
--       SELECT to_regprocedure('public.twob_prior_books_apply(uuid, uuid, text, jsonb, boolean)') IS NOT NULL,
--              to_regprocedure('public.twob__decision_message(text, jsonb, text)') IS NOT NULL;
--       -- one ledger row per source (0, 0 on 21 Oct 2026; the file refuses otherwise):
--       SELECT (SELECT count(*) FROM (SELECT source_book_id FROM public.bills_not_in_2b WHERE source_book_id IS NOT NULL
--                GROUP BY 1 HAVING count(*) > 1) x),
--              (SELECT count(*) FROM (SELECT source_doc_id FROM public.bills_not_in_books WHERE source_doc_id IS NOT NULL
--                GROUP BY 1 HAVING count(*) > 1) x);
--       -- One reclaim per 2B document (round 5): the 2B documents named as the
--       -- evidence of more than one reclaim. The unique index
--       -- bills_not_in_2b_reclaimed_via_uq is created only when this lists
--       -- none; otherwise the file is applied without it and warns (the
--       -- rule is held without it, for every new reclaim, by the trigger
--       -- trg_twob_zz_reclaim_via_one, round 6).
--       SELECT c.name, d.period_month, d.supplier_name, d.supplier_invoice_number, t.reclaimed_via_doc_id,
--              count(*) AS entries, string_agg(concat_ws(' ', t.supplier_invoice_number, t.reclaim_month), ', ') AS reclaims
--         FROM public.bills_not_in_2b t
--         LEFT JOIN public.twob_import_docs d ON d.id = t.reclaimed_via_doc_id
--         LEFT JOIN public.clients c ON c.id = d.client_id
--        WHERE t.reclaimed_via_doc_id IS NOT NULL
--        GROUP BY 1, 2, 3, 4, 5 HAVING count(*) > 1;
--       -- Read on 22 Oct 2026 (anon key, read only): 49 entries name a
--       -- reclaiming document; ONE document is named by two:
--       --   GROWQ PRIVATE LIMITED, 07/2026, REDEL SOURCING PRIVATE LIMITED
--       --   invoice 25 (afbe5e1d-ceb7-4de7-af40-a34f1ed5f0c6, Reclaim,
--       --   1,350 CGST + 1,350 SGST) is the evidence of the Jul 26 reclaims of
--       --   both REDEL 5 (reversed May 26) and REDEL 25 (reversed Jun 26),
--       --   two carried entries of Jul-26: July's 5.4 counts 2,700 + 2,700
--       --   on one document's 1,350 + 1,350.
--       -- So, as live stands, the index is NOT created (the file warns and
--       -- goes on). It is not needed for the rule: every new reclaim, by any
--       -- writer, is held to one per document by the trigger
--       -- trg_twob_zz_reclaim_via_one (round 6), which leaves this pair as it
--       -- is. For the lead: Jul-26 is a filed month, so nothing in the app
--       -- changes these two entries (twob_guard refuses every write to a
--       -- filed month's rows, a link cleared included; "Filed by mistake"
--       -- is for a return not filed on the portal, and reopens the whole
--       -- month). Which of the two the
--       -- document evidences (invoice 25, by its number), whether REDEL 5
--       -- has its own document, and whether July's record should change at
--       -- all (its 5.4 is as filed) is the firm's to decide. If it should, a
--       -- reviewed one-off SQL run as the owner, in one transaction, with
--       -- set_config('twob.write', 'system', true), clearing
--       -- reclaimed_via_doc_id (and, if so decided, reclaim_month) on the
--       -- one entry; applying this file again then creates the index.
--       -- Nothing here changes either entry.
--       -- Also read then (not refused by this file, for the lead): one
--       -- reclaim whose document is no longer Reclaim, the state rounds 5
--       -- and 6 now prevent (a named document stays Reclaim; an entry names
--       -- only a Reclaim document; this one, recorded before, can only be
--       -- made Reclaim again): ELENZA CALLISTA BUILDCON-NO ITC, 07/2026
--       -- (filed), Shashikant Singh A-2 reclaimed Jul 26 against its own
--       -- document, now Ineligible. And 3 Reclaim documents that no entry
--       -- names.
--       SELECT c.name, t.period_month, t.supplier_invoice_number, t.reclaim_month, d.itc_action
--         FROM public.bills_not_in_2b t JOIN public.twob_import_docs d ON d.id = t.reclaimed_via_doc_id
--         JOIN public.clients c ON c.id = t.client_id
--        WHERE d.itc_action <> 'RECLAIM';
--       -- Round 8 (for the lead, not refused): own entries reclaimed without
--       -- naming a 2B document. A Restore of a version holding one, in an open
--       -- month, brings it back in Awaiting reclaim, named, unless its
--       -- document is known exactly (round 9: the month's only document that
--       -- is the same document; never by its amounts), for a Strict and a
--       -- Liberal client alike while the month holds any 2B document.
--       -- Read on 22 Oct 2026 (anon key, read only): 36 such own entries, 34 of
--       -- Strict clients, all in months of Feb to Dec 2025 (Restore works only
--       -- on a client's latest month holding entries, and only while it is
--       -- open: the query's last column); 4,864 with the carried copies, which
--       -- Restore never touches.
--       SELECT c.name, c.liberal_2b_reconciliation AS liberal, t.period_month, count(*) AS entries,
--              public.twob_month_is_prior(t.client_id, t.period_month) AS filed
--         FROM public.bills_not_in_2b t JOIN public.clients c ON c.id = t.client_id
--        WHERE NULLIF(btrim(COALESCE(t.reclaim_month, '')), '') IS NOT NULL AND t.reclaim_subtype IS NULL
--          AND t.reclaimed_via_doc_id IS NULL AND NOT COALESCE(t.is_carried_forward, false)
--        GROUP BY 1, 2, 3, 5 ORDER BY 1, 3;
--  2. Apply this file (one transaction; lock_timeout 5 s: at a quiet time;
--     if it stops on the lock timeout, nothing changed: run it again).
--  3. Checks after applying:
--       SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_twob_zz_autopost%';            -- 8
--       SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_twob_zz_carried_decision';         -- 2
--       SELECT count(*) FROM pg_indexes WHERE indexname IN ('bills_not_in_2b_source_book_uq',
--              'bills_not_in_books_source_doc_uq');                                           -- 2
--       SELECT to_regprocedure('public.twob_import2b_reclaim(uuid, uuid, text, uuid, uuid, text)') IS NOT NULL,
--              to_regprocedure('public.twob_import2b_save_book(uuid, uuid, jsonb, uuid, uuid, jsonb)') IS NOT NULL,
--              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
--                       AND table_name = 'twob_autopost_state' AND column_name = 'changed_by');  -- t, t, t
--       -- the confirm's digest (round 3): t, t, t, f, f
--       SELECT to_regprocedure('public.twob_import2b_catch_up(uuid, uuid, text, boolean, text)') IS NOT NULL,
--              to_regprocedure('public.twob_import2b_prior_save(uuid, uuid, text, jsonb, boolean, boolean, text, jsonb)') IS NOT NULL,
--              to_regprocedure('public.twob__prior_save_preview(uuid, uuid, text, jsonb, jsonb, boolean)') IS NOT NULL,
--              to_regprocedure('public.twob_import2b_catch_up(uuid, uuid, text, boolean)') IS NOT NULL,
--              to_regprocedure('public.twob__autopost_apply(uuid, text, uuid[], uuid[], uuid, boolean, boolean)') IS NOT NULL;
--       SELECT to_regprocedure('public.twob_import2b_step(uuid, text)') IS NOT NULL,
--              to_regprocedure('public.twob_import2b_unreclaim(uuid, uuid, text, uuid, text, uuid)') IS NOT NULL,
--              to_regprocedure('public.twob_restore_version_linked(uuid, uuid, text, jsonb, jsonb)') IS NOT NULL,
--              (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
--                AND table_name IN ('bills_not_in_2b', 'bills_not_in_books') AND column_name = 'adopted_from');  -- t, t, t, 2
--       -- round 4: the user a save is checked for (a pairing call's own, else the request's),
--       -- and the check a delete runs as its caller: t, t
--       SELECT to_regprocedure('public.twob__acting_user()') IS NOT NULL,
--              to_regprocedure('public.twob__may_post(uuid)') IS NOT NULL;
--       -- rounds 5 and 6: the reclaim's rules and the guarded books saves: 4, t, f, f
--       -- (the index only once the dry check above lists no document):
--       SELECT (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_twob_zz_reclaim_via', 'trg_twob_zz_reclaim_via_one',
--                'trg_twob_zz_reclaim_evidence', 'trg_twob_zz_reclaim_evidence_gone')),
--              to_regprocedure('public.twob__expect_differs(jsonb, jsonb)') IS NOT NULL,
--              to_regprocedure('public.twob_import2b_reclaim(uuid, uuid, text, uuid, uuid)') IS NOT NULL,
--              to_regprocedure('public.twob_import2b_prior_save(uuid, uuid, text, jsonb, boolean, boolean, text)') IS NOT NULL;
--       SELECT count(*) FROM pg_indexes WHERE indexname = 'bills_not_in_2b_reclaimed_via_uq';  -- 1, or 0 with the warning
--       -- round 7: out of Reclaim takes the reclaim the page showed (the earlier
--       -- signature gone), and Restore returns the month it left: f, t
--       SELECT to_regprocedure('public.twob_import2b_unreclaim(uuid, uuid, text, uuid, text)') IS NOT NULL,
--              position('rows_2b' in pg_get_functiondef('public.twob_restore_version_linked(uuid, uuid, text, jsonb, jsonb)'::regprocedure)) > 0;
--       -- round 8: Restore knows Liberal from Strict and takes the month's rows
--       -- without waiting; out of Reclaim takes a pair of before: t, t, t
--       SELECT position('v_liberal' in pg_get_functiondef('public.twob_restore_version_linked(uuid, uuid, text, jsonb, jsonb)'::regprocedure)) > 0,
--              position('FOR KEY SHARE NOWAIT' in pg_get_functiondef('public.twob_restore_version_linked(uuid, uuid, text, jsonb, jsonb)'::regprocedure)) > 0,
--              position('= ANY (v_now)' in pg_get_functiondef('public.twob_import2b_unreclaim(uuid, uuid, text, uuid, text, uuid)'::regprocedure)) > 0;
--       -- round 9: Restore never looks for a document by its amounts, knows a
--       -- month holding no 2B document, and links an entry as it adds it: f, t, t
--       SELECT position('abs(md.tv' in pg_get_functiondef('public.twob_restore_version_linked(uuid, uuid, text, jsonb, jsonb)'::regprocedure)) > 0,
--              position('v_has_2b' in pg_get_functiondef('public.twob_restore_version_linked(uuid, uuid, text, jsonb, jsonb)'::regprocedure)) > 0,
--              position('ELSE rp.bid END' in pg_get_functiondef('public.twob_restore_version_linked(uuid, uuid, text, jsonb, jsonb)'::regprocedure)) > 0;
--       -- round 10: Restore names the Reclaim documents it leaves evidencing
--       -- nothing, ranks the version's naming first, and takes a document
--       -- found as the same one only for one reclaim: t, t, t
--       SELECT position('''docs_left''' in pg_get_functiondef('public.twob_restore_version_linked(uuid, uuid, text, jsonb, jsonb)'::regprocedure)) > 0,
--              position('ORDER BY e.via_by, e.o' in pg_get_functiondef('public.twob_restore_version_linked(uuid, uuid, text, jsonb, jsonb)'::regprocedure)) > 0,
--              position('k.via_by = 3 AND k.via_n > 1' in pg_get_functiondef('public.twob_restore_version_linked(uuid, uuid, text, jsonb, jsonb)'::regprocedure)) > 0;
--       -- round 11: two reclaims of one identity are never told apart by
--       -- amounts either (no amount test left in Restore): t, f
--       SELECT position('ident_rc = 1' in pg_get_functiondef('public.twob_restore_version_linked(uuid, uuid, text, jsonb, jsonb)'::regprocedure)) > 0,
--              position('ident_agrees' in pg_get_functiondef('public.twob_restore_version_linked(uuid, uuid, text, jsonb, jsonb)'::regprocedure)) > 0;
--       -- round 10 (read only, for the lead): the open months' Reclaim
--       -- invoices and debit notes that evidence no reclaim (their ITC counts
--       -- nowhere; Import 2B now says so on the row and offers each in Link &
--       -- Reclaim; 3 such documents, any month, were read on 22 Oct 2026).
--       SELECT c.name, d.period_month, d.supplier_name, d.supplier_invoice_number, d.input_igst + d.input_cgst + d.input_sgst AS tax,
--              public.twob_month_is_prior(d.client_id, d.period_month) AS filed
--         FROM public.twob_import_docs d JOIN public.clients c ON c.id = d.client_id
--        WHERE d.itc_action = 'RECLAIM' AND NOT COALESCE(d.is_amendment, false)
--          AND COALESCE(d.doc_type, 'INVOICE') IN ('INVOICE', 'DEBIT_NOTE')
--          AND NOT EXISTS (SELECT 1 FROM public.bills_not_in_2b z WHERE z.reclaimed_via_doc_id = d.id)
--        ORDER BY 1, public.twob_period_key(d.period_month), 4;
--       -- No entry is linked as an own entry yet (the column is new): 0
--       SELECT (SELECT count(*) FROM public.bills_not_in_2b WHERE adopted_from IS NOT NULL)
--            + (SELECT count(*) FROM public.bills_not_in_books WHERE adopted_from IS NOT NULL);
--       -- Who lacks Import 2B & post: from now on (the app of before too, see above)
--       -- each of them is refused a save that would change the ledger (a document
--       -- into or out of Not in Books, a Not in 2B books row with a date and supplier,
--       -- a delete taking an entry off); every other save stays open to them, and the
--       -- new app asks each save first. Give it to anyone who works Import 2B:
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
--         CROSS JOIN LATERAL public.twob__autopost_effective(m.client_id, m.period_month, NULL, NULL) p
--        WHERE p.op <> 'skip'
--        GROUP BY m.client_id, c.name, m.period_month, p.list, p.op
--        ORDER BY c.name, public.twob_period_key(m.period_month), p.list, p.op;
--     (op: insert = to add, link = an own entry of the month to be linked
--     instead, update, retract = to take back, unlink = an own entry to be put
--     back; skip = left out, with its reason.) The page shows the same for
--     the month it has open ("not in step", twob_import2b_step) with "Bring
--     the reconciliation up to date" for staff who may post.
--  5. Deploy the app (no Post button; prior-month books saves through
--     twob_import2b_prior_save; Delete 2B and Clear Data through their calls).
--  Rollback (only if the app is rolled back too): drop the eight triggers
--  trg_twob_zz_autopost_* on books_register and twob_import_docs; the old
--  app's Post works again. The round-5 triggers (trg_twob_zz_reclaim_via,
--  trg_twob_zz_reclaim_evidence, trg_twob_zz_reclaim_evidence_gone) and the
--  unique index hold for the old app as well and can stay; drop
--  trg_twob_zz_reclaim_via_one too (round 6), or the old app's Reclaim stays
--  refused (it names the document before making it Reclaim). The unique indexes, the adopted_from columns and
--  the two trg_twob_zz_carried_decision triggers can stay (the old app's
--  Restore calls twob_restore_version, untouched).

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

-- One reclaim per 2B document (verification round 5): a document is the
-- evidence of at most one entry's reclaim (ITC Summary 5.4 counts each
-- reclaim, so a second one on the same document counts its ITC twice).
-- The rule is held for every new reclaim, by every writer, by the trigger
-- trg_twob_zz_reclaim_via_one (section 6, round 6), which leaves a pair
-- recorded before as it is. This unique index is a second hold, created
-- only when no document is named by two entries now; otherwise the file
-- goes on without it and says which (live has one such pair, in a filed
-- month: see the header, step 1). It serves every lookup the plain index of
-- 20260814130000 did, which then goes.
DO $$
DECLARE
  v text;
BEGIN
  SELECT string_agg(format('%s %s, document %s (%s): %s entries (%s)', x.client, public.twob_month_name(x.period_month),
                           x.doc_no, x.doc_id, x.n, x.entries), '; ' ORDER BY x.client, x.doc_no) INTO v
    FROM (SELECT t.reclaimed_via_doc_id AS doc_id, count(*) AS n,
                 string_agg(concat_ws(' ', NULLIF(btrim(COALESCE(t.supplier_invoice_number, '')), ''), t.reclaim_month), ', ' ORDER BY t.id) AS entries,
                 min(c.name) AS client, min(d.period_month) AS period_month, min(d.supplier_invoice_number) AS doc_no
            FROM public.bills_not_in_2b t
            LEFT JOIN public.twob_import_docs d ON d.id = t.reclaimed_via_doc_id
            LEFT JOIN public.clients c ON c.id = d.client_id
           WHERE t.reclaimed_via_doc_id IS NOT NULL
           GROUP BY t.reclaimed_via_doc_id HAVING count(*) > 1) x;
  IF v IS NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS bills_not_in_2b_reclaimed_via_uq
      ON public.bills_not_in_2b (reclaimed_via_doc_id) WHERE reclaimed_via_doc_id IS NOT NULL;
    DROP INDEX IF EXISTS public.idx_bills_not_in_2b_reclaimed_via_doc_id;
  ELSE
    RAISE WARNING 'These 2B documents are each the evidence of more than one reclaim, recorded before this file (ITC Summary 5.4 counts their ITC more than once): %. They are left as they are (in a filed month only a reviewed one-off correction can change them; see the header, step 1), so the unique index bills_not_in_2b_reclaimed_via_uq is not created. One reclaim per document still holds for every new reclaim, whoever writes it (trigger trg_twob_zz_reclaim_via_one); everything else in this file is applied.', v;
  END IF;
END $$;

-- An entry of the month's own (typed on 2B Reconciliation, imported there,
-- or put back by a Restore of an old version) that a books row or 2B
-- document was linked to instead of adding a twin: what it held before
-- (verification round 2). When that row stops posting, the entry is put back
-- to it and unlinked, never removed, so the ledger ends where Post left it.
ALTER TABLE public.bills_not_in_2b ADD COLUMN IF NOT EXISTS adopted_from jsonb;
ALTER TABLE public.bills_not_in_books ADD COLUMN IF NOT EXISTS adopted_from jsonb;
COMMENT ON COLUMN public.bills_not_in_2b.adopted_from IS
  'Set when Import 2B''s write-through linked a books row to this entry instead of adding a twin (the month''s own unlinked entry of '
  'the same document, reversal month this month): its date, supplier, number, GSTIN and amounts before. Unlinked and put back to '
  'these, never removed, when the row stops posting (20261021170000; docs/2B_RECONCILIATION_FLOW.md §15).';
COMMENT ON COLUMN public.bills_not_in_books.adopted_from IS
  'Set when Import 2B''s write-through linked a 2B document to this entry instead of adding a twin (the month''s own unlinked entry of '
  'the same document, in-2B month this month): its date, supplier, number, GSTIN and amounts before. Unlinked and put back to '
  'these, never removed, when the document stops posting (20261021170000; docs/2B_RECONCILIATION_FLOW.md §15).';

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

-- A typed value as a uuid; NULL when blank or not one (a version's row ids).
CREATE OR REPLACE FUNCTION public.twob__try_uuid(p text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN btrim(COALESCE(p, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN btrim(p)::uuid END;
$$;

-- An entry's date, supplier, number, GSTIN and amounts (what adopted_from
-- keeps, and the door's update of an entry takes).
CREATE OR REPLACE FUNCTION public.twob__entry_figures(p_row jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object('date', p_row -> 'date', 'supplier_name', p_row -> 'supplier_name',
    'supplier_invoice_number', p_row -> 'supplier_invoice_number', 'supplier_gstin', p_row -> 'supplier_gstin',
    'taxable_value', p_row -> 'taxable_value', 'input_igst', p_row -> 'input_igst',
    'input_cgst', p_row -> 'input_cgst', 'input_sgst', p_row -> 'input_sgst');
$$;

-- A 2B document's treatment as Import 2B names it ('MATCHED' -> 'Matched').
CREATE OR REPLACE FUNCTION public.twob__treatment_label(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p WHEN 'MATCHED' THEN 'Matched' WHEN 'MISMATCHED' THEN 'Mismatched' WHEN 'NOT_IN_BOOKS' THEN 'Not in Books'
                WHEN 'INELIGIBLE' THEN 'Ineligible' WHEN 'ITC_OF_OTHERS' THEN 'ITC of Others' WHEN 'RECLAIM' THEN 'Reclaim'
                WHEN 'HELD' THEN 'Held' ELSE COALESCE(p, 'none') END;
$$;

-- The first column (by name) of p_expect whose value the row p_row no longer
-- holds, or NULL (verification round 5: a save guarded by the row as the
-- page loaded it). Amounts compare as numbers; the rest as text, an absent
-- or null value only with null.
CREATE OR REPLACE FUNCTION public.twob__expect_differs(p_row jsonb, p_expect jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT e.key FROM jsonb_each(COALESCE(p_expect, '{}'::jsonb)) e
   WHERE CASE WHEN e.key IN ('taxable_value', 'input_igst', 'input_cgst', 'input_sgst')
              THEN public.twob__try_num(p_row ->> e.key) IS DISTINCT FROM public.twob__try_num(e.value #>> '{}')
              ELSE (p_row ->> e.key) IS DISTINCT FROM (e.value #>> '{}') END
   ORDER BY e.key LIMIT 1;
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

-- The user a save's write-through is checked for (Import 2B & post): the one
-- a call of this release names for its own writes (twob.actor, set by
-- twob_import2b_save_book from its p_actor_id while it writes, as the other
-- calls check their p_actor_id; verification round 4), else the one the
-- request names (x-gst-actor), else NULL (a system writer: not checked).
CREATE OR REPLACE FUNCTION public.twob__acting_user()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(public.twob__try_uuid(current_setting('twob.actor', true)), public.twob__request_actor());
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

-- Whether p_user may change the ledger (Import 2B & post), for a check that
-- runs as the caller (twob__autopost_gone, a row trigger kept without
-- SECURITY DEFINER): twob__staff_may is not the caller's to run. Reads only.
CREATE OR REPLACE FUNCTION public.twob__may_post(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.twob__staff_may(p_user, 'work_2b_import');
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

-- What the write-through does: Post's plan (above), with two differences so
-- nothing is doubled now that no one reviews a Post dialog, and nothing of
-- the month's own is lost:
--  'link': an entry to add that the month already holds as its own entry,
--    unlinked, not carried, the same document (twob_doc_key: GSTIN or
--    supplier, number, date and amounts) and with this month as its
--    reversal month (Not in 2B) or in-2B month (Not in Books), as the entry
--    Post would add carries, is linked instead of added again, one to one
--    (ledger_id: that entry; the figures: what the add would write). An
--    entry with a blank or another month is a different entry for every
--    report (4B(2)(i) counts only this month's): the add goes beside it, as
--    Post's did.
--  'unlink': an entry to take back that was linked that way (adopted_from)
--    is put back to what it held before (the figures) and unlinked, never
--    removed: the ledger ends where Post's twin, added and then taken back,
--    left it.
-- Reads only. twob__autopost_adjust makes the two changes to a plan (the
-- write-through calls it only when its plan adds or takes back an entry);
-- twob__autopost_effective is the whole of it.
CREATE OR REPLACE FUNCTION public.twob__autopost_adjust(p_client_id uuid, p_period text, p_plan public.twob_autopost_row[])
RETURNS public.twob_autopost_row[]
LANGUAGE plpgsql
STABLE
SET plan_cache_mode = force_generic_plan
AS $$
DECLARE
  v_plan public.twob_autopost_row[] := p_plan;
  v_key integer := public.twob_period_key(p_period);
  n_ins2 integer;
  n_insb integer;
  n_ret integer;
BEGIN
  SELECT count(*) FILTER (WHERE x.list = 'bills_not_in_2b' AND x.op = 'insert'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_books' AND x.op = 'insert'),
         count(*) FILTER (WHERE x.op = 'retract')
    INTO n_ins2, n_insb, n_ret
    FROM unnest(v_plan) x;
  -- Taken back: an entry linked instead of added is put back and unlinked.
  IF n_ret > 0 AND (
       EXISTS (SELECT 1 FROM unnest(v_plan) x JOIN public.bills_not_in_2b t ON t.id = x.ledger_id
                WHERE x.list = 'bills_not_in_2b' AND x.op = 'retract' AND t.adopted_from IS NOT NULL)
    OR EXISTS (SELECT 1 FROM unnest(v_plan) x JOIN public.bills_not_in_books t ON t.id = x.ledger_id
                WHERE x.list = 'bills_not_in_books' AND x.op = 'retract' AND t.adopted_from IS NOT NULL)) THEN
    v_plan := ARRAY(
      SELECT CASE WHEN a.af IS NULL
               THEN ROW(x.list, x.op, x.ledger_id, x.source_id, x.date, x.supplier_name, x.supplier_invoice_number, x.supplier_gstin,
                        x.taxable_value, x.input_igst, x.input_cgst, x.input_sgst, x.reason)::public.twob_autopost_row
               ELSE ROW(x.list, 'unlink', x.ledger_id, x.source_id, public.twob__try_date(a.af ->> 'date'), a.af ->> 'supplier_name',
                        a.af ->> 'supplier_invoice_number', a.af ->> 'supplier_gstin',
                        COALESCE(public.twob__try_num(a.af ->> 'taxable_value'), 0), COALESCE(public.twob__try_num(a.af ->> 'input_igst'), 0),
                        COALESCE(public.twob__try_num(a.af ->> 'input_cgst'), 0), COALESCE(public.twob__try_num(a.af ->> 'input_sgst'), 0),
                        NULL::text)::public.twob_autopost_row END
        FROM unnest(v_plan) WITH ORDINALITY AS x(list, op, ledger_id, source_id, date, supplier_name, supplier_invoice_number,
                                                 supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, reason, o)
        LEFT JOIN LATERAL (
          SELECT CASE WHEN x.list = 'bills_not_in_2b'
                      THEN (SELECT t.adopted_from FROM public.bills_not_in_2b t WHERE t.id = x.ledger_id)
                      ELSE (SELECT t.adopted_from FROM public.bills_not_in_books t WHERE t.id = x.ledger_id) END AS af
           WHERE x.op = 'retract') a ON true
       ORDER BY x.o);
  END IF;

  -- Added: an identical own entry of this month, unlinked, is linked instead.
  IF (n_ins2 > 0 AND EXISTS (SELECT 1 FROM public.bills_not_in_2b t
                              WHERE t.client_id = p_client_id AND t.period_month = p_period AND t.source_book_id IS NULL
                                AND NOT COALESCE(t.is_carried_forward, false) AND public.twob_label_key(t.reversal_month) = v_key))
     OR (n_insb > 0 AND EXISTS (SELECT 1 FROM public.bills_not_in_books t
                                 WHERE t.client_id = p_client_id AND t.period_month = p_period AND t.source_doc_id IS NULL
                                   AND NOT COALESCE(t.is_carried_forward, false) AND public.twob_label_key(t.bill_in_2b_month) = v_key)) THEN
    v_plan := ARRAY(
      WITH x AS (
        SELECT * FROM unnest(v_plan) WITH ORDINALITY AS u(list, op, ledger_id, source_id, date, supplier_name, supplier_invoice_number,
                                                          supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, reason, o)),
      p AS (
        SELECT x.list, x.source_id,
               public.twob_doc_key(x.supplier_gstin, x.supplier_name, x.supplier_invoice_number, x.date,
                                   x.taxable_value, x.input_igst, x.input_cgst, x.input_sgst) AS k
          FROM x WHERE x.op = 'insert'),
      pn AS (SELECT p.*, row_number() OVER (PARTITION BY p.list, p.k ORDER BY p.source_id) AS rn FROM p),
      c AS (
        SELECT 'bills_not_in_2b'::text AS list, t.id,
               public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date,
                                   t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst) AS k
          FROM public.bills_not_in_2b t
         WHERE n_ins2 > 0 AND t.client_id = p_client_id AND t.period_month = p_period AND t.source_book_id IS NULL
           AND NOT COALESCE(t.is_carried_forward, false) AND public.twob_label_key(t.reversal_month) = v_key
        UNION ALL
        SELECT 'bills_not_in_books', t.id,
               public.twob_doc_key(t.supplier_gstin, t.supplier_name, t.supplier_invoice_number, t.date,
                                   t.taxable_value, t.input_igst, t.input_cgst, t.input_sgst)
          FROM public.bills_not_in_books t
         WHERE n_insb > 0 AND t.client_id = p_client_id AND t.period_month = p_period AND t.source_doc_id IS NULL
           AND NOT COALESCE(t.is_carried_forward, false) AND public.twob_label_key(t.bill_in_2b_month) = v_key),
      cn AS (SELECT c.*, row_number() OVER (PARTITION BY c.list, c.k ORDER BY c.id) AS rn FROM c),
      lk AS (SELECT pn.list, pn.source_id, cn.id FROM pn JOIN cn ON cn.list = pn.list AND cn.k = pn.k AND cn.rn = pn.rn)
      SELECT ROW(x.list, CASE WHEN lk.id IS NULL THEN x.op ELSE 'link' END, COALESCE(lk.id, x.ledger_id), x.source_id, x.date,
                 x.supplier_name, x.supplier_invoice_number, x.supplier_gstin, x.taxable_value, x.input_igst, x.input_cgst,
                 x.input_sgst, x.reason)::public.twob_autopost_row
        FROM x LEFT JOIN lk ON x.op = 'insert' AND lk.list = x.list AND lk.source_id = x.source_id
       ORDER BY x.o);
  END IF;
  RETURN v_plan;
END;
$$;

CREATE OR REPLACE FUNCTION public.twob__autopost_effective(p_client_id uuid, p_period text, p_book_ids uuid[], p_doc_ids uuid[])
RETURNS SETOF public.twob_autopost_row
LANGUAGE plpgsql
STABLE
SET plan_cache_mode = force_generic_plan
AS $$
DECLARE
  v_plan public.twob_autopost_row[];
BEGIN
  IF p_book_ids IS NULL OR array_length(p_book_ids, 1) > 0 THEN
    v_plan := ARRAY(SELECT p FROM public.twob__autopost_plan_books(p_client_id, p_period, p_book_ids) p);
  ELSE
    v_plan := '{}';
  END IF;
  IF p_doc_ids IS NULL OR array_length(p_doc_ids, 1) > 0 THEN
    v_plan := v_plan || ARRAY(SELECT p FROM public.twob__autopost_plan_docs(p_client_id, p_period, p_doc_ids) p);
  END IF;
  RETURN QUERY SELECT * FROM unnest(public.twob__autopost_adjust(p_client_id, p_period, v_plan));
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
-- (writePostVersion: View Versions and Restore read it unchanged), plus
-- what Restore needs to put an entry back as it was (verification round 2):
-- its Import 2B link (sourceBookId / sourceDocId, and adoptedFrom), its
-- Expense out (reclaimSubtype) and the 2B document its reclaim names
-- (reclaimedViaDocId). Within a
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
               'updatedAt', COALESCE(b.updated_at, v_now), 'version', COALESCE(b.version, 1),
               'reclaimSubtype', b.reclaim_subtype, 'reclaimedViaDocId', b.reclaimed_via_doc_id,
               'sourceBookId', b.source_book_id, 'adoptedFrom', b.adopted_from) ORDER BY b.date, b.id)
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
               'updatedAt', COALESCE(b.updated_at, v_now), 'version', COALESCE(b.version, 1),
               'sourceDocId', b.source_doc_id, 'adoptedFrom', b.adopted_from) ORDER BY b.date, b.id)
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

-- The digest of a plan: every row (list, op, the ledger entry and the source
-- row, the figures, the reason a row is left out), in a fixed order. Two
-- plans of a month with the same digest add, link, change, take back and
-- put back the same entries at the same figures.
CREATE OR REPLACE FUNCTION public.twob__autopost_digest(p_plan public.twob_autopost_row[])
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(COALESCE(string_agg(y.s, E'\n' ORDER BY y.s), ''))
    FROM (SELECT format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s', x.list, x.op, x.ledger_id, x.source_id, x.date,
                        x.supplier_name, x.supplier_invoice_number, x.supplier_gstin, x.taxable_value, x.input_igst,
                        x.input_cgst, x.input_sgst, x.reason) AS s
            FROM unnest(p_plan) x) y;
$$;

-- Applies the write-through for (client, month, books rows, 2B documents) to
-- the ledger (twob__autopost_effective: Post's plan, an identical own entry
-- linked instead of added, a linked own entry put back instead of removed),
-- or with p_dry_run says what it would do. The caller holds the client's
-- lock and has checked the month is open. Returns per list how many entries
-- are added ('add'), linked ('link'), changed, taken back ('remove') and put
-- back as they were ('unlink'), and 'written' (rows written); with p_report
-- also the rows not posted with their reason ('skipped') and the refusals.
-- A change that would take back an entry holding a reclaim, an Expense out
-- or a book entry is refused (raised; with p_dry_run listed), naming it and
-- where to undo it (an entry put back as it was keeps its decision).
-- With p_report the result also carries the plan's digest
-- (twob__autopost_digest), and a skipped row says whether its entry stays on
-- the ledger as last saved ('on_ledger'). p_digest (verification round 3):
-- the digest of the plan a confirm showed; the plan made now under the lock
-- must be the same, or nothing is written and the call raises "changed while
-- the confirm was open" (as Post re-planned under the lock and posted
-- nothing when the plan differed from the one confirmed). NULL: no check
-- (the write-through of a save, which shows no confirm).
DROP FUNCTION IF EXISTS public.twob__autopost_apply(uuid, text, uuid[], uuid[], uuid, boolean, boolean);
CREATE OR REPLACE FUNCTION public.twob__autopost_apply(
  p_client_id uuid, p_period text, p_book_ids uuid[], p_doc_ids uuid[], p_actor_id uuid,
  p_dry_run boolean DEFAULT false, p_report boolean DEFAULT true, p_digest text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET plan_cache_mode = force_generic_plan
AS $$
DECLARE
  v_label text := public.twob_period_label(p_period);
  v_plan public.twob_autopost_row[];
  v_digest text;
  v_refusals jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_linked2 uuid[] := '{}';
  v_linkedb uuid[] := '{}';
  c_skip integer;
  c2_ins integer; c2_lnk integer; c2_upd integer; c2_ret integer; c2_unl integer;
  cb_ins integer; cb_lnk integer; cb_upd integer; cb_ret integer; cb_unl integer;
  n2_ins integer := 0; n2_upd integer := 0; n2_ret integer := 0; n2_unl integer := 0;
  nb_ins integer := 0; nb_upd integer := 0; nb_ret integer := 0; nb_unl integer := 0;
BEGIN
  -- The two halves of the plan called directly (one call less a save), the
  -- links and put-backs worked in only when it adds or takes back.
  IF p_book_ids IS NULL OR array_length(p_book_ids, 1) > 0 THEN
    v_plan := ARRAY(SELECT p FROM public.twob__autopost_plan_books(p_client_id, p_period, p_book_ids) p);
  ELSE
    v_plan := '{}';
  END IF;
  IF p_doc_ids IS NULL OR array_length(p_doc_ids, 1) > 0 THEN
    v_plan := v_plan || ARRAY(SELECT p FROM public.twob__autopost_plan_docs(p_client_id, p_period, p_doc_ids) p);
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_plan) x WHERE x.op IN ('insert', 'retract')) THEN
    v_plan := public.twob__autopost_adjust(p_client_id, p_period, v_plan);
  END IF;
  -- What the plan holds, so a save of one row runs only the steps it needs.
  SELECT count(*) FILTER (WHERE x.op = 'skip'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_2b' AND x.op = 'insert'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_2b' AND x.op = 'link'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_2b' AND x.op = 'update'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_2b' AND x.op = 'retract'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_2b' AND x.op = 'unlink'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_books' AND x.op = 'insert'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_books' AND x.op = 'link'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_books' AND x.op = 'update'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_books' AND x.op = 'retract'),
         count(*) FILTER (WHERE x.list = 'bills_not_in_books' AND x.op = 'unlink')
    INTO c_skip, c2_ins, c2_lnk, c2_upd, c2_ret, c2_unl, cb_ins, cb_lnk, cb_upd, cb_ret, cb_unl
    FROM unnest(v_plan) x;
  -- A row left out says whether what it posted before stays on the ledger
  -- as last saved (a books row or 2B document without a date or supplier:
  -- its entry is still counted), so the confirm lists those apart from rows
  -- that are not on it (never posted, or a debit note or minus row whose
  -- entry this plan takes back).
  IF p_report AND c_skip > 0 THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('list', x.list, 'id', x.source_id, 'number', x.supplier_invoice_number,
             'reason', x.reason,
             'on_ledger', NOT EXISTS (SELECT 1 FROM unnest(v_plan) r
                                       WHERE r.list = x.list AND r.source_id = x.source_id AND r.op IN ('retract', 'unlink'))
                          AND CASE WHEN x.list = 'bills_not_in_2b'
                                   THEN EXISTS (SELECT 1 FROM public.bills_not_in_2b t WHERE t.source_book_id = x.source_id
                                                  AND t.client_id = p_client_id AND t.period_month = p_period)
                                   ELSE EXISTS (SELECT 1 FROM public.bills_not_in_books t WHERE t.source_doc_id = x.source_id
                                                  AND t.client_id = p_client_id AND t.period_month = p_period) END)
             ORDER BY x.list, x.supplier_invoice_number, x.source_id), '[]'::jsonb)
      INTO v_skipped FROM unnest(v_plan) x WHERE x.op = 'skip';
  END IF;
  -- The plan a confirm showed must be the plan now (verification round 3).
  IF p_report OR p_digest IS NOT NULL THEN
    v_digest := public.twob__autopost_digest(v_plan);
  END IF;
  IF p_digest IS NOT NULL AND NOT p_dry_run AND p_digest IS DISTINCT FROM v_digest THEN
    RAISE EXCEPTION 'Nothing was changed: % of this client changed while the confirm was open (a save in another tab or by someone else, or a change on 2B Reconciliation). Click Bring the reconciliation up to date again to see what it would do now.',
      public.twob_month_name(p_period)
      USING ERRCODE = 'TWB03';
  END IF;
  IF c2_ins + c2_lnk + c2_upd + c2_ret + c2_unl + cb_ins + cb_lnk + cb_upd + cb_ret + cb_unl = 0 THEN
    RETURN jsonb_build_object('dry_run', p_dry_run, 'written', 0,
      'bills_not_in_2b', jsonb_build_object('add', 0, 'link', 0, 'change', 0, 'remove', 0, 'unlink', 0),
      'bills_not_in_books', jsonb_build_object('add', 0, 'link', 0, 'change', 0, 'remove', 0, 'unlink', 0),
      'skipped', v_skipped, 'refusals', '[]'::jsonb, 'digest', v_digest);
  END IF;

  -- The entries to take back, locked and read again: a reclaim, Expense out
  -- or book entry saved meanwhile is seen below. (An entry to change, link
  -- or put back is locked by its own update, which writes no decision.)
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

  IF p_dry_run THEN
    RETURN jsonb_build_object('dry_run', true,
      'written', c2_ins + c2_lnk + c2_upd + c2_ret + c2_unl + cb_ins + cb_lnk + cb_upd + cb_ret + cb_unl,
      'undo_hint', CASE WHEN jsonb_array_length(v_refusals) > 0 THEN public.twob__undo_hint(v_refusals) END,
      'bills_not_in_2b', jsonb_build_object('add', c2_ins, 'link', c2_lnk, 'change', c2_upd, 'remove', c2_ret, 'unlink', c2_unl),
      'bills_not_in_books', jsonb_build_object('add', cb_ins, 'link', cb_lnk, 'change', cb_upd, 'remove', cb_ret, 'unlink', cb_unl),
      'skipped', v_skipped, 'refusals', v_refusals, 'digest', v_digest);
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

  -- Put back as it was and unlinked: an own entry linked instead of added.
  -- Its months and decisions stay.
  IF c2_unl > 0 THEN
    UPDATE public.bills_not_in_2b t
       SET date = x.date, supplier_name = x.supplier_name, supplier_invoice_number = x.supplier_invoice_number,
           supplier_gstin = x.supplier_gstin, taxable_value = x.taxable_value, input_igst = x.input_igst,
           input_cgst = x.input_cgst, input_sgst = x.input_sgst, source_book_id = NULL, adopted_from = NULL,
           updated_by = COALESCE(p_actor_id, t.updated_by), updated_at = now()
      FROM unnest(v_plan) x
     WHERE x.list = 'bills_not_in_2b' AND x.op = 'unlink' AND t.id = x.ledger_id;
    GET DIAGNOSTICS n2_unl = ROW_COUNT;
  END IF;
  IF cb_unl > 0 THEN
    UPDATE public.bills_not_in_books t
       SET date = x.date, supplier_name = x.supplier_name, supplier_invoice_number = x.supplier_invoice_number,
           supplier_gstin = x.supplier_gstin, taxable_value = x.taxable_value, input_igst = x.input_igst,
           input_cgst = x.input_cgst, input_sgst = x.input_sgst, source_doc_id = NULL, adopted_from = NULL,
           updated_by = COALESCE(p_actor_id, t.updated_by), updated_at = now()
      FROM unnest(v_plan) x
     WHERE x.list = 'bills_not_in_books' AND x.op = 'unlink' AND t.id = x.ledger_id;
    GET DIAGNOSTICS nb_unl = ROW_COUNT;
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

  -- Link an identical own entry, with the figures an add would write; what
  -- it held is kept (adopted_from), and its months and decisions stay.
  IF c2_lnk > 0 THEN
    WITH u AS (
      UPDATE public.bills_not_in_2b t
         SET source_book_id = x.source_id, adopted_from = public.twob__entry_figures(to_jsonb(t)),
             date = x.date, supplier_name = x.supplier_name,
             supplier_invoice_number = x.supplier_invoice_number, supplier_gstin = x.supplier_gstin,
             taxable_value = x.taxable_value, input_igst = x.input_igst, input_cgst = x.input_cgst, input_sgst = x.input_sgst,
             updated_by = COALESCE(p_actor_id, t.updated_by), updated_at = now()
        FROM unnest(v_plan) x
       WHERE x.list = 'bills_not_in_2b' AND x.op = 'link' AND t.id = x.ledger_id AND t.source_book_id IS NULL
      RETURNING t.source_book_id)
    SELECT COALESCE(array_agg(u.source_book_id), '{}') INTO v_linked2 FROM u;
  END IF;
  IF cb_lnk > 0 THEN
    WITH u AS (
      UPDATE public.bills_not_in_books t
         SET source_doc_id = x.source_id, adopted_from = public.twob__entry_figures(to_jsonb(t)),
             date = x.date, supplier_name = x.supplier_name,
             supplier_invoice_number = x.supplier_invoice_number, supplier_gstin = x.supplier_gstin,
             taxable_value = x.taxable_value, input_igst = x.input_igst, input_cgst = x.input_cgst, input_sgst = x.input_sgst,
             updated_by = COALESCE(p_actor_id, t.updated_by), updated_at = now()
        FROM unnest(v_plan) x
       WHERE x.list = 'bills_not_in_books' AND x.op = 'link' AND t.id = x.ledger_id AND t.source_doc_id IS NULL
      RETURNING t.source_doc_id)
    SELECT COALESCE(array_agg(u.source_doc_id), '{}') INTO v_linkedb FROM u;
  END IF;

  -- Add: this month as its reversal (in-2B) month, open, not carried (and a
  -- link that found its entry gone meanwhile).
  IF c2_ins + c2_lnk > 0 THEN
    INSERT INTO public.bills_not_in_2b (
      client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
      taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month,
      is_carried_forward, source_book_id, updated_by, updated_at)
    SELECT p_client_id, p_period, x.date, x.supplier_name, x.supplier_invoice_number, x.supplier_gstin,
           x.taxable_value, x.input_igst, x.input_cgst, x.input_sgst, v_label, NULL,
           false, x.source_id, p_actor_id, now()
      FROM unnest(v_plan) x
     WHERE x.list = 'bills_not_in_2b' AND (x.op = 'insert' OR (x.op = 'link' AND NOT (x.source_id = ANY (v_linked2))))
     ORDER BY x.date, x.source_id;
    GET DIAGNOSTICS n2_ins = ROW_COUNT;
  END IF;
  IF cb_ins + cb_lnk > 0 THEN
    INSERT INTO public.bills_not_in_books (
      client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
      taxable_value, input_igst, input_cgst, input_sgst, bill_in_2b_month, book_entry_month,
      is_carried_forward, source_doc_id, updated_by, updated_at)
    SELECT p_client_id, p_period, x.date, x.supplier_name, x.supplier_invoice_number, x.supplier_gstin,
           x.taxable_value, x.input_igst, x.input_cgst, x.input_sgst, v_label, NULL,
           false, x.source_id, p_actor_id, now()
      FROM unnest(v_plan) x
     WHERE x.list = 'bills_not_in_books' AND (x.op = 'insert' OR (x.op = 'link' AND NOT (x.source_id = ANY (v_linkedb))))
     ORDER BY x.date, x.source_id;
    GET DIAGNOSTICS nb_ins = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('dry_run', false,
    'written', n2_ins + n2_upd + n2_ret + n2_unl + nb_ins + nb_upd + nb_ret + nb_unl
               + COALESCE(array_length(v_linked2, 1), 0) + COALESCE(array_length(v_linkedb, 1), 0),
    'bills_not_in_2b', jsonb_build_object('add', n2_ins, 'link', COALESCE(array_length(v_linked2, 1), 0), 'change', n2_upd,
                                          'remove', n2_ret, 'unlink', n2_unl),
    'bills_not_in_books', jsonb_build_object('add', nb_ins, 'link', COALESCE(array_length(v_linkedb, 1), 0), 'change', nb_upd,
                                             'remove', nb_ret, 'unlink', nb_unl),
    'skipped', v_skipped, 'refusals', '[]'::jsonb, 'digest', v_digest);
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
-- system writer) is not checked here; the app names its user on every
-- request (x-gst-actor), the app of before this release too, and
-- twob_import2b_save_book's writes are checked for its p_actor_id
-- (twob__acting_user).
CREATE OR REPLACE FUNCTION public.twob__autopost_touch(
  p_client_id uuid, p_period text, p_book_ids uuid[], p_doc_ids uuid[], p_by uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v jsonb;
  v_actor uuid;
  v_req uuid := public.twob__acting_user();
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
-- says so first). An own entry it was linked to instead of adding one
-- (adopted_from) is put back as it was and unlinked, never removed (round
-- 2). The month is marked for a snapshot at the end of the
-- statement. Row level, so kept cheap: no SECURITY DEFINER, one index probe
-- when nothing was posted. Who may (verification round 4): a delete that
-- takes an entry off the ledger or puts one back is the Import 2B & post
-- permission's, as every other save that changes the ledger
-- (twob__autopost_touch): the user the request names without it is
-- refused and nothing of the delete is kept. A delete that leaves the
-- ledger as it is (no entry, or one that stays: filed, or holding a
-- decision, only unlinked) goes through for any staff, as before.
CREATE OR REPLACE FUNCTION public.twob__autopost_gone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  n integer := 0;
  v_rows integer := 0;
  v_key text;
  v_marks text;
  v_req uuid;
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
  -- An own entry it was linked to instead of adding one (adopted_from) is put
  -- back as it was and unlinked, never removed.
  IF TG_TABLE_NAME = 'books_register' THEN
    UPDATE public.bills_not_in_2b t
       SET date = COALESCE(public.twob__try_date(t.adopted_from ->> 'date'), t.date), supplier_name = COALESCE(t.adopted_from ->> 'supplier_name', t.supplier_name),
           supplier_invoice_number = t.adopted_from ->> 'supplier_invoice_number', supplier_gstin = t.adopted_from ->> 'supplier_gstin',
           taxable_value = public.twob__try_num(t.adopted_from ->> 'taxable_value'), input_igst = public.twob__try_num(t.adopted_from ->> 'input_igst'),
           input_cgst = public.twob__try_num(t.adopted_from ->> 'input_cgst'), input_sgst = public.twob__try_num(t.adopted_from ->> 'input_sgst'),
           source_book_id = NULL, adopted_from = NULL, updated_at = now()
     WHERE t.source_book_id = OLD.id AND t.adopted_from IS NOT NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    DELETE FROM public.bills_not_in_2b t
     WHERE t.source_book_id = OLD.id AND t.client_id = OLD.client_id AND t.period_month = OLD.period_month
       AND NOT COALESCE(t.is_locked, false)
       AND NULLIF(btrim(COALESCE(t.reclaim_month, '')), '') IS NULL AND t.reclaim_subtype IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  ELSE
    UPDATE public.bills_not_in_books t
       SET date = COALESCE(public.twob__try_date(t.adopted_from ->> 'date'), t.date), supplier_name = COALESCE(t.adopted_from ->> 'supplier_name', t.supplier_name),
           supplier_invoice_number = t.adopted_from ->> 'supplier_invoice_number', supplier_gstin = t.adopted_from ->> 'supplier_gstin',
           taxable_value = public.twob__try_num(t.adopted_from ->> 'taxable_value'), input_igst = public.twob__try_num(t.adopted_from ->> 'input_igst'),
           input_cgst = public.twob__try_num(t.adopted_from ->> 'input_cgst'), input_sgst = public.twob__try_num(t.adopted_from ->> 'input_sgst'),
           source_doc_id = NULL, adopted_from = NULL, updated_at = now()
     WHERE t.source_doc_id = OLD.id AND t.adopted_from IS NOT NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    DELETE FROM public.bills_not_in_books t
     WHERE t.source_doc_id = OLD.id AND t.client_id = OLD.client_id AND t.period_month = OLD.period_month
       AND NOT COALESCE(t.is_locked, false)
       AND NULLIF(btrim(COALESCE(t.book_entry_month, '')), '') IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END IF;
  n := n + v_rows;
  IF n > 0 THEN
    v_req := public.twob__acting_user();
    IF v_req IS NOT NULL AND NOT public.twob__may_post(v_req) THEN
      RAISE EXCEPTION 'Not saved: this change would change the 2B Reconciliation ledger, which needs the Import 2B & post permission. Ask a GST Manager to add it to your position.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
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

-- A filed month's decision on an open month's carried copy (verification
-- round 2): a carried entry whose reclaim, Expense out or book entry was
-- made in a filed month keeps it as filed. The filed month still holds it
-- (and its reports counted it), so the copy changing it alone would put the
-- entry back in this month's pending lists, the e-mailed list and the next
-- carry. Refused for direct writes (Import 2B's Pending items, 2B
-- Reconciliation); a decision of this month or a later one, and one whose
-- month is open again (reopened), change as before; this release's own
-- functions (twob.write 'rpc' / 'system': the door, the carry, Re-run,
-- Restore) are not checked. A carried entry holding it can still be
-- removed (the guard of 20261021100000: the next carry copies it back).
CREATE OR REPLACE FUNCTION public.twob__carried_decision_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
  v_key integer;
  v_verb text;
BEGIN
  IF NOT COALESCE(OLD.is_carried_forward, false) OR COALESCE(current_setting('twob.write', true), '') IN ('rpc', 'system') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'bills_not_in_2b' THEN
    IF NULLIF(btrim(COALESCE(NEW.reclaim_month, '')), '') IS NOT DISTINCT FROM NULLIF(btrim(COALESCE(OLD.reclaim_month, '')), '')
       AND NEW.reclaim_subtype IS NOT DISTINCT FROM OLD.reclaim_subtype THEN
      RETURN NEW;
    END IF;
    v_label := NULLIF(btrim(COALESCE(OLD.reclaim_month, '')), '');
    v_verb := CASE WHEN OLD.reclaim_subtype = 'EXPENSE_OUT' THEN 'expensed out' ELSE 'reclaimed' END;
  ELSE
    IF NULLIF(btrim(COALESCE(NEW.book_entry_month, '')), '') IS NOT DISTINCT FROM NULLIF(btrim(COALESCE(OLD.book_entry_month, '')), '') THEN
      RETURN NEW;
    END IF;
    v_label := NULLIF(btrim(COALESCE(OLD.book_entry_month, '')), '');
    v_verb := 'booked';
  END IF;
  v_key := public.twob_label_key(v_label);
  IF v_key IS NULL OR v_key >= public.twob_period_key(OLD.period_month)
     OR NOT public.twob_month_is_prior(OLD.client_id, public.twob_period_of_key(v_key)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '%: % (filed) % this entry. A filed month''s decision stays as filed, and this month''s carried copy keeps it. Nothing was saved.',
    COALESCE(public.twob__entry_name(to_jsonb(OLD)), 'This entry'), public.twob_month_name(public.twob_period_of_key(v_key)), v_verb
    USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS trg_twob_zz_carried_decision ON public.bills_not_in_2b;
CREATE TRIGGER trg_twob_zz_carried_decision BEFORE UPDATE OF reclaim_month, reclaim_subtype ON public.bills_not_in_2b
  FOR EACH ROW EXECUTE FUNCTION public.twob__carried_decision_guard();
DROP TRIGGER IF EXISTS trg_twob_zz_carried_decision ON public.bills_not_in_books;
CREATE TRIGGER trg_twob_zz_carried_decision BEFORE UPDATE OF book_entry_month ON public.bills_not_in_books
  FOR EACH ROW EXECUTE FUNCTION public.twob__carried_decision_guard();

-- A reclaim and its 2B document (verification round 5), held by the
-- database whichever screen, tab or app version writes:
--  - an entry names the document that evidences its reclaim
--    (reclaimed_via_doc_id) only while it holds that reclaim: a reclaim month
--    and no Expense out. A write that clears the reclaim month or makes it an
--    Expense out (2B Reconciliation's Reclaim cell, Pending items, an app of
--    before) lets the document go with it, so the document never stays
--    "evidence" of an entry that is no longer reclaimed (twob__reclaim_via_tidy);
--  - a document stays Reclaim while an entry is reclaimed against it, and is
--    not deleted while one is: only twob_import2b_unreclaim (Import 2B's Save
--    out of Reclaim) and Delete 2B, which put that entry back in Awaiting
--    reclaim first in the same transaction, take it out (before, a stale
--    Import 2B tab's Save made a reclaimed document Mismatched, so its ITC
--    counted in 5.1 and again through the reclaim in 5.4; a re-import's
--    delete left the reclaim counted with no document;
--    twob__reclaim_evidence_guard); a document named by a reclaim recorded
--    before these rules while it was not Reclaim can only be made Reclaim
--    (round 6);
--  - an entry newly names a document (any writer: a stale tab of any app
--    version, a Restore, a direct write) only while that document is Reclaim
--    and no other entry names it (twob__reclaim_via_check, verification
--    round 6): one reclaim per document, and never a reclaim against a
--    document counted in 5.1 (Matched, Mismatched) or not at all
--    (Ineligible). Before, a Restore put back a reclaim against a document
--    taken out of Reclaim since (its ITC in 5.1 and 5.4), and on live, where
--    the unique index of section 1 cannot be created (a filed month already
--    holds a document named twice), a stale tab of the app of before
--    reclaimed a second entry with one document. The document's row is held
--    (FOR SHARE) and the document's own lock taken while it is checked, so
--    two writers naming one document at once, or a document taken out of
--    Reclaim while it is named, are seen by whichever comes second. An entry
--    that already names its document keeps it (the check is on a new
--    naming only), so a filed month's pair recorded before stays as filed;
--  - one reclaim per document also by the unique index of section 1, where
--    the data allows it, and by twob_import2b_reclaim's own check (which
--    says so in the page's words).
-- A client being deleted takes its documents and entries with it.
CREATE OR REPLACE FUNCTION public.twob__reclaim_via_tidy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.reclaimed_via_doc_id := NULL;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_twob_zz_reclaim_via ON public.bills_not_in_2b;
CREATE TRIGGER trg_twob_zz_reclaim_via BEFORE INSERT OR UPDATE OF reclaim_month, reclaim_subtype, reclaimed_via_doc_id ON public.bills_not_in_2b
  FOR EACH ROW WHEN (NEW.reclaimed_via_doc_id IS NOT NULL
                     AND (NEW.reclaim_subtype IS NOT NULL OR NULLIF(btrim(COALESCE(NEW.reclaim_month, '')), '') IS NULL))
  EXECUTE FUNCTION public.twob__reclaim_via_tidy();

-- Fires after trg_twob_zz_reclaim_via (by name), so an entry that no longer
-- holds its reclaim has already let its document go.
CREATE OR REPLACE FUNCTION public.twob__reclaim_via_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc record;
  v_other jsonb;
  v_entry text;
  v_docname text;
BEGIN
  IF NEW.reclaimed_via_doc_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.reclaimed_via_doc_id IS NOT DISTINCT FROM OLD.reclaimed_via_doc_id) THEN
    RETURN NEW;
  END IF;
  -- The document's own lock: two writers naming it at once wait for each
  -- other here, and the second reads what the first saved.
  PERFORM pg_advisory_xact_lock(hashtextextended('twob-reclaim-doc:' || NEW.reclaimed_via_doc_id::text, 0));
  SELECT d.itc_action, d.supplier_name, d.supplier_invoice_number INTO v_doc
    FROM public.twob_import_docs d WHERE d.id = NEW.reclaimed_via_doc_id
     FOR SHARE;
  IF NOT FOUND THEN
    RETURN NEW;   -- no such document: the foreign key refuses it
  END IF;
  v_entry := COALESCE(public.twob__entry_name(to_jsonb(NEW)), 'this entry');
  v_docname := COALESCE(' ' || public.twob__entry_name(to_jsonb(v_doc)), '');
  IF v_doc.itc_action IS DISTINCT FROM 'RECLAIM' THEN
    RAISE EXCEPTION 'Not saved: the 2B document% is % on Import 2B, not Reclaim, so it cannot be the evidence of the reclaim of %. Reclaim it on Import 2B (reload the page if it does not offer it): the entry and the document are saved together there. Nothing was saved.',
      v_docname, public.twob__treatment_label(v_doc.itc_action), v_entry
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT to_jsonb(t) INTO v_other FROM public.bills_not_in_2b t
   WHERE t.reclaimed_via_doc_id = NEW.reclaimed_via_doc_id AND t.id <> NEW.id ORDER BY t.id LIMIT 1;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'Not saved: the 2B document% is already the evidence of the reclaim of % (%, %); one document evidences one reclaim, so % cannot be reclaimed with it. Nothing was saved.',
      v_docname, COALESCE(public.twob__entry_name(v_other), 'another entry'),
      COALESCE(NULLIF(btrim(COALESCE(v_other ->> 'reclaim_month', '')), ''), 'reclaimed'), public.twob_month_name(v_other ->> 'period_month'), v_entry
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_twob_zz_reclaim_via_one ON public.bills_not_in_2b;
CREATE TRIGGER trg_twob_zz_reclaim_via_one BEFORE INSERT OR UPDATE OF reclaimed_via_doc_id ON public.bills_not_in_2b
  FOR EACH ROW WHEN (NEW.reclaimed_via_doc_id IS NOT NULL)
  EXECUTE FUNCTION public.twob__reclaim_via_check();

CREATE OR REPLACE FUNCTION public.twob__reclaim_evidence_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry jsonb;
  v_doc text;
  v_what text;
BEGIN
  SELECT to_jsonb(t) INTO v_entry FROM public.bills_not_in_2b t WHERE t.reclaimed_via_doc_id = OLD.id ORDER BY t.id LIMIT 1;
  IF v_entry IS NULL
     OR (TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = OLD.client_id)) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_doc := COALESCE(public.twob__entry_name(to_jsonb(OLD)), 'this 2B document');
  v_what := format('the reclaim of %s (%s, %s)', COALESCE(public.twob__entry_name(v_entry), 'an entry'),
    COALESCE(NULLIF(btrim(COALESCE(v_entry ->> 'reclaim_month', '')), ''), 'reclaimed'), public.twob_month_name(v_entry ->> 'period_month'));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Not deleted: % is the evidence of %. Take it out of Reclaim on Import 2B first (Save puts that entry back in Awaiting reclaim), or use Delete 2B. Nothing was deleted.',
      v_doc, v_what USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.itc_action IS DISTINCT FROM 'RECLAIM' THEN
    -- Recorded before these rules (a reclaim against a document no longer
    -- Reclaim): it may only become Reclaim again, never another treatment
    -- (each would count its ITC again beside the reclaim, or not at all).
    RAISE EXCEPTION 'Not saved: % is the evidence of % although it is %, which was recorded before this rule; it can only be made Reclaim again. Nothing was saved.',
      v_doc, v_what, public.twob__treatment_label(OLD.itc_action) USING ERRCODE = 'check_violation';
  END IF;
  RAISE EXCEPTION 'Not saved: % is the evidence of %, so it stays Reclaim. To change it, take it out of Reclaim on Import 2B as the page shows it now (reload it if it does not show Reclaim): Save then puts that entry back in Awaiting reclaim with it. Nothing was saved.',
    v_doc, v_what USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS trg_twob_zz_reclaim_evidence ON public.twob_import_docs;
CREATE TRIGGER trg_twob_zz_reclaim_evidence BEFORE UPDATE OF itc_action ON public.twob_import_docs
  FOR EACH ROW WHEN (NEW.itc_action IS DISTINCT FROM OLD.itc_action AND NEW.itc_action IS DISTINCT FROM 'RECLAIM')
  EXECUTE FUNCTION public.twob__reclaim_evidence_guard();
DROP TRIGGER IF EXISTS trg_twob_zz_reclaim_evidence_gone ON public.twob_import_docs;
CREATE TRIGGER trg_twob_zz_reclaim_evidence_gone BEFORE DELETE ON public.twob_import_docs
  FOR EACH ROW EXECUTE FUNCTION public.twob__reclaim_evidence_guard();

-- ---------------------------------------------------------------------------
-- 7. What the screens call
-- ---------------------------------------------------------------------------
-- An open month out of step (posted before this change, or never posted):
-- brought up to date with the same rules, by staff who may post (Import 2B
-- & post). p_dry_run: what it would do (the confirm shows it), writing
-- nothing, with the plan's 'digest'. p_digest: the digest the confirm
-- showed; the plan made again under the client's lock must have it, or
-- nothing is written ("changed while the confirm was open"; verification
-- round 3: before, an entry corrected on 2B Reconciliation meanwhile was
-- changed back without the confirm saying so). The page always sends it;
-- NULL (no check) is left for the tests' direct calls. A month filed
-- meanwhile is refused (its books side through twob_import2b_prior_save).
DROP FUNCTION IF EXISTS public.twob_import2b_catch_up(uuid, uuid, text, boolean);
CREATE OR REPLACE FUNCTION public.twob_import2b_catch_up(
  p_actor_id uuid, p_client_id uuid, p_period text, p_dry_run boolean DEFAULT true, p_digest text DEFAULT NULL)
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
  v := public.twob__autopost_apply(p_client_id, p_period, NULL, NULL, p_actor_id, p_dry_run, true, p_digest);
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
-- the ledger). p_expect_action: the document's treatment as the page showed
-- it (verification round 5). Returns {ok, was}; {ok: false, gone: true,
-- what, message} when nothing is written: the document or the entry is no
-- longer there, the entry no longer awaits a reclaim, the document no
-- longer holds the treatment the page showed (another user changed it, or
-- reclaimed with it), or the document already evidences a reclaim (one
-- reclaim per document: a second one counted its ITC twice in 5.4).
DROP FUNCTION IF EXISTS public.twob_import2b_reclaim(uuid, uuid, text, uuid, uuid);
CREATE OR REPLACE FUNCTION public.twob_import2b_reclaim(
  p_actor_id uuid, p_client_id uuid, p_period text, p_pending_id uuid, p_doc_id uuid, p_expect_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc record;
  v_other jsonb;
BEGIN
  IF p_client_id IS NULL OR public.twob_period_key(p_period) IS NULL OR p_pending_id IS NULL OR p_doc_id IS NULL THEN
    RAISE EXCEPTION 'Choose the entry and the 2B document.';
  END IF;
  IF NULLIF(btrim(COALESCE(p_expect_action, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Say which treatment the page showed for the 2B document (p_expect_action). Nothing was saved.';
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
  -- The document as the page showed it, and the evidence of no other reclaim
  -- (read under the client's lock, which every writer of a reclaim takes).
  IF v_doc.itc_action IS DISTINCT FROM p_expect_action THEN
    RETURN jsonb_build_object('ok', false, 'gone', true, 'what', 'document', 'now', v_doc.itc_action,
      'message', format('This 2B document was changed elsewhere since the page showed it: it is %s now, not %s. Nothing was saved; the page shows the month as it is now.',
                        public.twob__treatment_label(v_doc.itc_action), public.twob__treatment_label(p_expect_action)));
  END IF;
  SELECT to_jsonb(t) INTO v_other FROM public.bills_not_in_2b t
   WHERE t.reclaimed_via_doc_id = p_doc_id AND t.id <> p_pending_id ORDER BY t.id LIMIT 1;
  IF v_other IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'gone', true, 'what', 'document',
      'message', format('This 2B document is already the evidence of the reclaim of %s (%s, %s); one document evidences one reclaim. Nothing was saved; the page shows the month as it is now.',
                        COALESCE(public.twob__entry_name(v_other), 'another entry'),
                        COALESCE(NULLIF(btrim(COALESCE(v_other ->> 'reclaim_month', '')), ''), 'reclaimed'), public.twob_month_name(v_other ->> 'period_month')));
  END IF;
  -- The entry, still awaiting a reclaim, held; then the document made
  -- Reclaim, then the entry names it (an entry names only a Reclaim
  -- document: twob__reclaim_via_check, round 6).
  PERFORM 1 FROM public.bills_not_in_2b t
   WHERE t.id = p_pending_id AND t.client_id = p_client_id AND t.period_month = p_period
     AND NULLIF(btrim(COALESCE(t.reclaim_month, '')), '') IS NULL AND t.reclaim_subtype IS NULL
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'gone', true, 'what', 'entry',
      'message', 'This entry is no longer awaiting a reclaim in this month. It was changed elsewhere (another tab, or a correction of a filed month that reached this month). Nothing was saved; the page shows the month as it is now.');
  END IF;
  UPDATE public.twob_import_docs SET itc_action = 'RECLAIM', updated_by = p_actor_id, updated_at = now() WHERE id = p_doc_id;
  UPDATE public.bills_not_in_2b t
     SET reclaim_month = public.twob_period_label(p_period), reclaim_subtype = NULL, reclaimed_via_doc_id = p_doc_id,
         updated_by = p_actor_id, updated_at = now()
   WHERE t.id = p_pending_id;
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
-- are written). Any staff level; who may is as for every save
-- (verification round 4): the write-throughs refuse, for p_actor_id
-- (twob__acting_user), any part that would
-- change the ledger without Import 2B & post (pairing a Not in Books
-- document that has an entry, a Not in 2B row with a date and supplier),
-- and nothing of the call is kept; a pairing that changes nothing on the
-- ledger (a Mismatched books row against a Matched document) saves for an
-- employee without it, as the direct writes of before did. p_expect
-- (verification round 5): the row's columns as the page loaded it (the keys
-- p_values may hold); when the row no longer holds one of them (another tab
-- or user saved it meanwhile) nothing is saved and this raises "was changed
-- elsewhere" (TWB04), so a stale page never writes its old copy back. The
-- page always sends it; NULL (no check) is left for the tests' direct calls.
-- Returns {ok, paired_was, row} (the paired document's treatment before, for
-- its amendments to follow; the row as saved).
DROP FUNCTION IF EXISTS public.twob_import2b_save_book(uuid, uuid, jsonb, uuid, uuid);
CREATE OR REPLACE FUNCTION public.twob_import2b_save_book(
  p_actor_id uuid, p_book_id uuid, p_values jsonb, p_release_doc_id uuid DEFAULT NULL, p_pair_doc_id uuid DEFAULT NULL,
  p_expect jsonb DEFAULT NULL)
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
  v_row jsonb;
BEGIN
  IF p_actor_id IS NULL OR COALESCE(public.staff_level_of(p_actor_id), '') NOT IN ('superadmin', 'gst_manager', 'employee') THEN
    RAISE EXCEPTION 'Only staff save the books register.';
  END IF;
  -- The write-throughs below check this user when the request names none.
  PERFORM set_config('twob.actor', p_actor_id::text, true);
  p_values := COALESCE(p_values, '{}'::jsonb);
  IF jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'No values were sent.';
  END IF;
  IF p_expect IS NOT NULL AND jsonb_typeof(p_expect) <> 'object' THEN
    RAISE EXCEPTION 'The row as the page loaded it was not sent.';
  END IF;
  SELECT k INTO v_bad FROM (SELECT jsonb_object_keys(p_values) UNION ALL SELECT jsonb_object_keys(COALESCE(p_expect, '{}'::jsonb))) x(k)
   WHERE k NOT IN ('date', 'supplier_name', 'supplier_invoice_number', 'supplier_gstin', 'taxable_value', 'input_igst',
                   'input_cgst', 'input_sgst', 'doc_type', 'book_treatment', 'matched_2b_id') LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A books row saves its date, supplier, number, GSTIN, amounts, type and treatment here (%).', v_bad;
  END IF;
  SELECT b.id, b.client_id, b.period_month, to_jsonb(b) AS j INTO v_book FROM public.books_register b WHERE b.id = p_book_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This books row is no longer here. Reload the page.';
  END IF;
  -- The row as the page loaded it (verification round 5), checked with the
  -- row locked, before anything is written.
  IF public.twob__expect_differs(v_book.j, p_expect) IS NOT NULL THEN
    RAISE EXCEPTION 'Nothing was saved: books row % was changed elsewhere since this page loaded it (another tab or another user; its %). The row is shown again as it is now.',
      COALESCE(public.twob__entry_name(v_book.j), '(no number)'), replace(public.twob__expect_differs(v_book.j, p_expect), '_', ' ')
      USING ERRCODE = 'TWB04';
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
   WHERE b.id = p_book_id
  RETURNING to_jsonb(b) INTO v_row;
  PERFORM set_config('twob.actor', '', true);
  RETURN jsonb_build_object('ok', true, 'paired_was', v_pair, 'row', v_row);
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
-- books row of the month), as the open month's (twob__autopost_effective):
-- 'door', the door's changes: an add (this month as its reversal month, the
-- books row linked), a change of the date, supplier, number, GSTIN and
-- amounts, a removal, and an own entry linked instead of added put back to
-- its figures (only when they moved); each books row with an entry change is
-- named too (a change that changes nothing), so the door does not also
-- write the entry's figures back onto it. 'links': an entry to add that the
-- month already holds as its own entry, unlinked, the same document with
-- this month as its reversal month (twob_doc_key: put back by a Restore, or
-- typed on 2B Reconciliation), linked to its books row instead of added (the
-- door would leave it out as held, and the month would stay out of step for
-- good: SORATH 07/2026), one to one; and an entry linked that way whose row
-- no longer posts, unlinked (never removed). A blank or other reversal month
-- is a different entry and is never linked. Not in Books entries follow the
-- filed 2B and are never part of it (§13).
CREATE OR REPLACE FUNCTION public.twob__prior_derived(p_client_id uuid, p_period text, p_book_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH p AS (
    SELECT x.*, t.j AS cur
      FROM public.twob__autopost_effective(p_client_id, p_period, p_book_ids, '{}'::uuid[]) x
      LEFT JOIN LATERAL (SELECT to_jsonb(t) AS j FROM public.bills_not_in_2b t WHERE t.id = x.ledger_id) t ON true
     WHERE x.op <> 'skip'),
  d AS (
    SELECT p.*, CASE p.op
      WHEN 'insert' THEN jsonb_build_object('table', 'bills_not_in_2b', 'op', 'insert', 'values', jsonb_build_object(
        'date', p.date, 'supplier_name', p.supplier_name, 'supplier_invoice_number', p.supplier_invoice_number,
        'supplier_gstin', p.supplier_gstin, 'taxable_value', p.taxable_value, 'input_igst', p.input_igst,
        'input_cgst', p.input_cgst, 'input_sgst', p.input_sgst, 'reversal_month', public.twob_period_label(p_period),
        'source_book_id', p.source_id))
      WHEN 'retract' THEN jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', p.ledger_id)
      WHEN 'link' THEN NULL
      ELSE CASE WHEN p.op = 'update' OR public.twob__entry_figures(p.cur) IS DISTINCT FROM public.twob__entry_figures(jsonb_build_object(
                  'date', p.date, 'supplier_name', p.supplier_name, 'supplier_invoice_number', p.supplier_invoice_number,
                  'supplier_gstin', p.supplier_gstin, 'taxable_value', p.taxable_value, 'input_igst', p.input_igst,
                  'input_cgst', p.input_cgst, 'input_sgst', p.input_sgst))
        THEN jsonb_build_object('table', 'bills_not_in_2b', 'op', 'update', 'id', p.ledger_id, 'values', jsonb_build_object(
          'date', p.date, 'supplier_name', p.supplier_name, 'supplier_invoice_number', p.supplier_invoice_number,
          'supplier_gstin', p.supplier_gstin, 'taxable_value', p.taxable_value, 'input_igst', p.input_igst,
          'input_cgst', p.input_cgst, 'input_sgst', p.input_sgst)) END END AS c
      FROM p)
  SELECT jsonb_build_object(
    'door', COALESCE((
      SELECT jsonb_agg(z.c ORDER BY z.o) FROM (
        SELECT 1 AS o, d.c FROM d WHERE d.c IS NOT NULL
        UNION ALL
        SELECT 2, jsonb_build_object('table', 'books_register', 'op', 'update', 'id', s.source_id, 'values', '{}'::jsonb)
          FROM (SELECT DISTINCT d.source_id FROM d
                 WHERE d.c IS NOT NULL AND EXISTS (SELECT 1 FROM public.books_register b WHERE b.id = d.source_id)) s) z), '[]'::jsonb),
    'links', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', d.ledger_id, 'source_book_id', CASE WHEN d.op = 'link' THEN d.source_id END,
                                          'action', d.op, 'entry', public.twob__entry_name(d.cur)) ORDER BY d.ledger_id)
        FROM d WHERE d.op IN ('link', 'unlink')), '[]'::jsonb));
$$;

-- The links of twob__prior_derived written (the door does not change a link,
-- and a link moves no figure: the entry is already the same document; an
-- unlink comes after the door put its figures back), and the preview's
-- changes for them, numbered after p_from. action 'link': the entry takes
-- the books row (what it held kept in adopted_from); 'unlink': the entry
-- goes back to the month's own.
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
  v_unlink boolean;
BEGIN
  FOR l IN SELECT value FROM jsonb_array_elements(COALESCE(p_links, '[]'::jsonb)) LOOP
    v_unlink := l ->> 'action' = 'unlink';
    IF p_apply THEN
      PERFORM set_config('twob.write', 'rpc', true);
      IF v_unlink THEN
        UPDATE public.bills_not_in_2b t SET source_book_id = NULL, adopted_from = NULL,
               updated_by = COALESCE(p_actor_id, t.updated_by), updated_at = now()
         WHERE t.id = (l ->> 'id')::uuid AND t.client_id = p_client_id AND t.period_month = p_period AND t.adopted_from IS NOT NULL;
      ELSE
        UPDATE public.bills_not_in_2b t SET source_book_id = (l ->> 'source_book_id')::uuid, adopted_from = public.twob__entry_figures(to_jsonb(t)),
               updated_by = COALESCE(p_actor_id, t.updated_by), updated_at = now()
         WHERE t.id = (l ->> 'id')::uuid AND t.client_id = p_client_id AND t.period_month = p_period AND t.source_book_id IS NULL;
      END IF;
      GET DIAGNOSTICS n = ROW_COUNT;
      PERFORM set_config('twob.write', COALESCE(v_prev, ''), true);
      CONTINUE WHEN n = 0;
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'index', p_from + i, 'table', 'bills_not_in_2b', 'op', 'update', 'entry', l ->> 'entry', 'id', l ->> 'id',
      'this', jsonb_build_object('action', CASE WHEN v_unlink THEN 'unlink' ELSE 'link' END, 'id', l ->> 'id'),
      'later', '[]'::jsonb, 'derived', true));
    i := i + 1;
  END LOOP;
  RETURN v_out;
END;
$$;

-- The digest of a prior month's preview (verification round 3): every
-- change the door names (list, operation, entry, what happens to it here
-- and in each later month, a refusal or note), the figures of the 2B
-- Reconciliation entries the save brings with it, and the later months'
-- counts, without row ids (an added row's id is new each time) and in a
-- fixed order. Two previews with the same digest change the same entries
-- in the same way at the same figures.
CREATE OR REPLACE FUNCTION public.twob__prior_digest(p_out jsonb, p_door jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(concat_ws(E'\n--\n',
    (SELECT string_agg(y.s, E'\n' ORDER BY y.s) FROM (
       SELECT format('%s|%s|%s|%s|%s|%s|%s|%s|%s', c ->> 'table', c ->> 'op', c ->> 'entry', c -> 'this' ->> 'action',
                     c ->> 'refusal', c ->> 'note', c -> 'this' ->> 'books_row', c ->> 'derived',
                     (SELECT string_agg(format('%s:%s', l ->> 'period', l ->> 'action'), ',' ORDER BY l ->> 'period', l ->> 'action')
                        FROM jsonb_array_elements(COALESCE(c -> 'later', '[]'::jsonb)) l)) AS s
         FROM jsonb_array_elements(COALESCE(p_out -> 'changes', '[]'::jsonb)) c) y),
    (SELECT string_agg(y.s, E'\n' ORDER BY y.s) FROM (
       SELECT ((d - 'id') || jsonb_build_object('values', COALESCE(d -> 'values', '{}'::jsonb) - 'source_book_id'))::text AS s
         FROM jsonb_array_elements(COALESCE(p_door, '[]'::jsonb)) d) y),
    (SELECT string_agg(y.s, E'\n' ORDER BY y.s) FROM (
       SELECT r ->> 'message' AS s FROM jsonb_array_elements(COALESCE(p_out -> 'refusals', '[]'::jsonb)) r) y),
    COALESCE((p_out -> 'later_months')::text, '')));
$$;

-- The preview of a prior month's save (twob_import2b_prior_save's dry run):
-- the books rows saved through the door, their Not in 2B write-through
-- worked out after, then all of it undone; with its digest. p_phase1: the
-- books register changes with the entries a removed row takes with it;
-- p_unlinks: own entries a removed row was linked to, put back.
CREATE OR REPLACE FUNCTION public.twob__prior_save_preview(
  p_actor_id uuid, p_client_id uuid, p_period text, p_phase1 jsonb, p_unlinks jsonb, p_whole_month boolean)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  r1 jsonb;
  r2 jsonb;
  v_out jsonb;
  v_derived jsonb;
  v_touched uuid[];
BEGIN
  IF jsonb_array_length(p_phase1) > 0 THEN
    r1 := public.twob_prior_books_apply(p_actor_id, p_client_id, p_period, p_phase1, true);
    IF NOT COALESCE((r1 ->> 'ok')::boolean, false) THEN
      v_out := public.twob__door_merge(r1, NULL, true, p_period);
      RETURN v_out || jsonb_build_object('digest', public.twob__prior_digest(v_out, NULL));
    END IF;
  END IF;
  BEGIN
    IF jsonb_array_length(p_phase1) > 0 THEN
      v_out := public.twob_prior_books_apply(p_actor_id, p_client_id, p_period, p_phase1, false);
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
  v_out := v_out || jsonb_build_object('changes', (v_out -> 'changes')
    || public.twob__prior_links(p_client_id, p_period, COALESCE(p_unlinks, '[]'::jsonb) || COALESCE(v_derived -> 'links', '[]'::jsonb),
                                jsonb_array_length(v_out -> 'changes'), false, p_actor_id));
  RETURN v_out || jsonb_build_object('digest', public.twob__prior_digest(v_out, v_derived -> 'door'));
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
-- worked out after, then all of it undone), with its 'digest'. p_digest
-- (verification round 3): the digest of the preview the confirm showed; the
-- save itself, made under the client's lock, must have it, or nothing is
-- saved ("changed while the confirm was open"). The page always sends it;
-- NULL (no check) is left for the tests' direct calls. The door runs once
-- for the save (verification round 4): its result is digested as the
-- preview's was (the door gives the same changes, refusals, notes and later
-- months dry or for real; the links listed only when written), and a
-- different digest rolls the whole save back. Before, the preview was made
-- a second time under the lock first, which ran the door three more times:
-- 1,000 rows took 1.9 s (2.5 s with the change log), near the 3 s anon
-- calls run under. p_expect (verification round 5): per books row the page
-- saves ({id: its columns as the page loaded it}); when a row no longer
-- holds them (another tab or user saved it meanwhile, before the preview
-- too) nothing is saved, and this raises "was changed elsewhere" (TWB04),
-- in the preview and in the save: the digest covers only the time between
-- the two, not a page already stale before the preview. The page always
-- sends it; NULL (no check) is left for the tests' direct calls.
DROP FUNCTION IF EXISTS public.twob_import2b_prior_save(uuid, uuid, text, jsonb, boolean, boolean);
DROP FUNCTION IF EXISTS public.twob_import2b_prior_save(uuid, uuid, text, jsonb, boolean, boolean, text);
CREATE OR REPLACE FUNCTION public.twob_import2b_prior_save(
  p_actor_id uuid, p_client_id uuid, p_period text, p_changes jsonb,
  p_dry_run boolean DEFAULT true, p_whole_month boolean DEFAULT false, p_digest text DEFAULT NULL,
  p_expect jsonb DEFAULT NULL)
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
  v_unlinks jsonb := '[]'::jsonb;
  v_wrote boolean := false;
  v_num integer;
  e record;
  v_b jsonb;
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
  IF p_expect IS NOT NULL AND (jsonb_typeof(p_expect) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_each(p_expect) x WHERE jsonb_typeof(x.value) <> 'object')) THEN
    RAISE EXCEPTION 'The rows as the page loaded them were not sent.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));

  -- Each books row as the page loaded it (verification round 5): read under
  -- the client's lock, which every writer of a filed month takes (the door).
  FOR e IN SELECT x.key, x.value FROM jsonb_each(COALESCE(p_expect, '{}'::jsonb)) x ORDER BY x.key LOOP
    SELECT to_jsonb(b) INTO v_b FROM public.books_register b
     WHERE b.id = public.twob__try_uuid(e.key) AND b.client_id = p_client_id AND b.period_month = p_period;
    IF v_b IS NULL THEN
      RAISE EXCEPTION 'Nothing was saved: a books row this page shows is no longer in % (deleted elsewhere since this page loaded it). The month is shown again as it is now.',
        public.twob_month_name(p_period) USING ERRCODE = 'TWB04';
    END IF;
    IF public.twob__expect_differs(v_b, e.value) IS NOT NULL THEN
      RAISE EXCEPTION 'Nothing was saved: books row % was changed elsewhere since this page loaded it (another tab or another user; its %). The row is shown again as it is now.',
        COALESCE(public.twob__entry_name(v_b), '(no number)'), replace(public.twob__expect_differs(v_b, e.value), '_', ' ')
        USING ERRCODE = 'TWB04';
    END IF;
  END LOOP;

  -- The books rows; a removed one takes the Not in 2B entry it posted, and
  -- that entry's later copies, with it (named before the row, as Import 2B
  -- always sent them). An own entry it was linked to instead of adding one
  -- (adopted_from) is put back to its figures (when they moved) and
  -- unlinked after the door, never removed.
  FOR c IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    IF c ->> 'op' = 'delete' AND NULLIF(c ->> 'id', '') IS NOT NULL THEN
      v_phase1 := v_phase1 || COALESCE((
        SELECT jsonb_agg(CASE WHEN t.adopted_from IS NULL
                              THEN jsonb_build_object('table', 'bills_not_in_2b', 'op', 'delete', 'id', t.id)
                              ELSE jsonb_build_object('table', 'bills_not_in_2b', 'op', 'update', 'id', t.id, 'values', t.adopted_from) END
                         ORDER BY t.id)
          FROM public.bills_not_in_2b t
         WHERE t.source_book_id = (c ->> 'id')::uuid AND t.client_id = p_client_id AND t.period_month = p_period
           AND (t.adopted_from IS NULL OR public.twob__entry_figures(to_jsonb(t)) IS DISTINCT FROM public.twob__entry_figures(t.adopted_from))), '[]'::jsonb);
      v_unlinks := v_unlinks || COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', t.id, 'action', 'unlink', 'entry', public.twob__entry_name(to_jsonb(t))) ORDER BY t.id)
          FROM public.bills_not_in_2b t
         WHERE t.source_book_id = (c ->> 'id')::uuid AND t.client_id = p_client_id AND t.period_month = p_period
           AND t.adopted_from IS NOT NULL), '[]'::jsonb);
    END IF;
    v_phase1 := v_phase1 || jsonb_build_array(c);
  END LOOP;

  IF p_dry_run THEN
    RETURN public.twob__prior_save_preview(p_actor_id, p_client_id, p_period, v_phase1, v_unlinks, p_whole_month);
  END IF;

  -- The door refusing what its preview let through (a row removed or
  -- changed meanwhile) is the month having changed while the confirm was
  -- open: said as such, with the door's reason.
  BEGIN
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
  EXCEPTION WHEN raise_exception THEN
    IF p_digest IS NULL THEN
      RAISE;
    END IF;
    RAISE EXCEPTION 'Nothing was saved: % of this client changed while the confirm was open (a save in another tab or by someone else): %. Look at it again and save once more.',
      public.twob_month_name(p_period), rtrim(SQLERRM, '. ')
      USING ERRCODE = 'TWB03';
  END;
  v_out := public.twob__door_merge(r1, r2, false, p_period);
  v_links := public.twob__prior_links(p_client_id, p_period, v_unlinks || COALESCE(v_derived -> 'links', '[]'::jsonb),
                                     jsonb_array_length(v_out -> 'changes'), true, p_actor_id);
  v_wrote := v_wrote OR jsonb_array_length(v_links) > 0;
  v_out := v_out || jsonb_build_object('changes', (v_out -> 'changes') || v_links);
  -- What the confirm showed must be what was saved: the save digested as
  -- its preview was; a difference undoes all of it (verification rounds 3, 4).
  IF p_digest IS NOT NULL AND p_digest IS DISTINCT FROM public.twob__prior_digest(v_out, v_derived -> 'door') THEN
    RAISE EXCEPTION 'Nothing was saved: % of this client changed while the confirm was open (a save in another tab or by someone else). Look at it again and save once more.',
      public.twob_month_name(p_period)
      USING ERRCODE = 'TWB03';
  END IF;
  IF v_wrote THEN
    PERFORM public.twob__autopost_changed(p_client_id, p_period, p_actor_id);
    v_num := public.twob__autopost_snapshot(p_client_id, p_period, p_actor_id);
  END IF;
  RETURN v_out || jsonb_build_object('version', v_num);
END;
$$;

-- Import 2B's Delete 2B, in one call: the reclaims the month's documents
-- evidence go back to Awaiting reclaim, the Not in Books entries they posted
-- leave the ledger (an own entry a document was linked to instead goes back
-- to what it held and stays; a filed, locked one stays, and its document with it, so
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
  n_unl integer := 0;
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
  -- An own entry a document was linked to instead of adding one goes back
  -- to what it held, unlinked, and stays (round 2).
  UPDATE public.bills_not_in_books t
     SET date = COALESCE(public.twob__try_date(t.adopted_from ->> 'date'), t.date),
         supplier_name = COALESCE(t.adopted_from ->> 'supplier_name', t.supplier_name),
         supplier_invoice_number = t.adopted_from ->> 'supplier_invoice_number', supplier_gstin = t.adopted_from ->> 'supplier_gstin',
         taxable_value = public.twob__try_num(t.adopted_from ->> 'taxable_value'), input_igst = public.twob__try_num(t.adopted_from ->> 'input_igst'),
         input_cgst = public.twob__try_num(t.adopted_from ->> 'input_cgst'), input_sgst = public.twob__try_num(t.adopted_from ->> 'input_sgst'),
         source_doc_id = NULL, adopted_from = NULL, updated_by = p_actor_id, updated_at = now()
   WHERE t.source_doc_id = ANY (v_ids) AND t.adopted_from IS NOT NULL;
  GET DIAGNOSTICS n_unl = ROW_COUNT;
  DELETE FROM public.bills_not_in_books t
   WHERE t.source_doc_id = ANY (v_ids) AND NOT COALESCE(t.is_locked, false) AND NOT COALESCE(t.is_carried_forward, false);
  GET DIAGNOSTICS n_nib = ROW_COUNT;
  n_nib := n_nib + n_unl;
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
    -- delete a carried entry holding one (clearing the year is meant). One
    -- carried in from a filed month stays as filed until the row goes
    -- (twob__carried_decision_guard; the guard lets such a row be removed).
    UPDATE public.bills_not_in_2b t SET reclaim_month = NULL, reclaim_subtype = NULL, reclaimed_via_doc_id = NULL
     WHERE t.client_id = p_client_id AND t.period_month = ANY (v_open) AND t.is_carried_forward
       AND (t.reclaim_month IS NOT NULL OR t.reclaim_subtype IS NOT NULL)
       AND public.twob__decision_is_own('bills_not_in_2b', to_jsonb(t));
    UPDATE public.bills_not_in_books t SET book_entry_month = NULL
     WHERE t.client_id = p_client_id AND t.period_month = ANY (v_open) AND t.is_carried_forward AND t.book_entry_month IS NOT NULL
       AND public.twob__decision_is_own('bills_not_in_books', to_jsonb(t));
    DELETE FROM public.bills_not_in_2b WHERE client_id = p_client_id AND period_month = ANY (v_open);
    GET DIAGNOSTICS n1 = ROW_COUNT;
    DELETE FROM public.bills_not_in_books WHERE client_id = p_client_id AND period_month = ANY (v_open);
    GET DIAGNOSTICS n2 = ROW_COUNT;
    FOREACH m IN ARRAY v_open LOOP
      v := public.twob__autopost_apply(p_client_id, m, NULL, NULL, p_actor_id, false, false);
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

-- 2B Reconciliation's Restore, as 20261021100000's twob_restore_version (the
-- superadmin, open months only), now putting each entry back as it was
-- (verification round 2). Its own name, so applying either file again, in
-- either order, never puts back the other's: this release's app calls this
-- one; twob_restore_version stays for an app of before. An entry Import 2B
-- posted takes back its link to
-- the books row or 2B document that posted it, so the next save of that row
-- changes it instead of adding a second one beside it (a second reversal in
-- 4B(2)(i)). The link is the version's (source_book_id / source_doc_id, in
-- versions written from this release), or, for a version written before
-- (Post's or a 2B Reconciliation Save, which named only the entry's id), the
-- link the month's entry of that id holds now; kept only while that row is
-- still in this client's month, once per row; failing both, by the document
-- itself (below). Its adopted_from goes with it, and an entry keeps its id
-- when no row holds it. A reclaim the version made with a 2B document
-- (reclaimed_via_doc_id) comes back with it only while that document is
-- still in the month, is Reclaim now, and evidences no other reclaim (the
-- month's kept entries', or the version's first one naming it); otherwise
-- the entry comes back in Awaiting reclaim, and 'reclaims_back' names it
-- with why (verification round 6; round 5 dropped only the link, and the
-- reclaim still counted in 5.4 beside the document's count in 5.1). A
-- reclaim comes back reclaimed only with its document known exactly
-- (verification round 9, never looked for by its amounts): the one the
-- version names, before the one the month's entry of that id names now,
-- before the month's only original invoice or debit note that is the same
-- document (twob_doc_ident: GSTIN or supplier, number and date; round 7)
-- and of the entry's amounts (each head within Rs. 2, a check on that one
-- document; round 10), this last only while no other reclaim of the
-- version takes that document (round 10: two of one identity went by the
-- version's order); then on the same terms, and linked to it. Otherwise,
-- whenever the month holds any 2B document, for a Strict and a Liberal
-- client alike, the entry comes back in Awaiting reclaim, named ("reclaim
-- it again on Import 2B", which Pending items' Link & Reclaim offers for a
-- Reclaim document evidencing nothing): Import 2B's Link &
-- Reclaim pairs an entry and a document by their amounts alone, so a books
-- entry without the supplier's GSTIN, or numbered as the books wrote it, is
-- reclaimed with a document no Restore can tell for certain (round 8 looked
-- by the amounts, row by row, and moved reclaims between entries of equal
-- amounts and onto another supplier's document). Only a Liberal client's
-- reclaim in a month holding no 2B document (typed on 2B Reconciliation)
-- comes back as the version holds it; a Strict client's comes back in
-- Awaiting reclaim then too (round 8: a Strict client reclaims only on
-- Import 2B, against a document, e.g. one gone with Delete 2B since).
-- A Restore never changes a 2B document: each Reclaim original invoice or
-- debit note of the month it leaves evidencing no reclaim (its ITC counted
-- nowhere) is named in 'docs_left', with the entry whose reclaim it
-- evidenced before the Restore, if any (verification round 10: a version
-- holding that entry in Awaiting reclaim, or not at all, or naming another
-- document for it, left the document so without a word).
-- Locks: the month's Reclaim documents, then the client's lock, then the
-- entries, as every writer of a reclaim takes them (round 7); with the
-- client's lock held, the month's books rows and documents, which the
-- entries it writes name, without waiting (round 8: a delete of one held
-- its row and waited for the client's lock while Restore's key check
-- waited for the row). Returns, with
-- the counts, the month's two lists as left (rows_2b, rows_books), which the
-- page records as the RESTORE version (round 7). Everything
-- else as before: the month's carried entries are never touched, the
-- version's carried rows are left out, and so is a version's own entry the
-- month now holds as a carried entry (named in left_out).
CREATE OR REPLACE FUNCTION public.twob_restore_version_linked(
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
  v_cur2b jsonb;
  v_curbk jsonb;
  v_linked integer := 0;
  v_reclaims_back jsonb;
  v_liberal boolean;
  v_has_2b boolean;
  v_held jsonb;
  v_docs_left jsonb;
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
  -- Locks in the order every writer of a reclaim takes them (verification
  -- round 7): the documents first, then the client's lock, then the
  -- entries. The month's Reclaim documents (the only ones an entry may name)
  -- are held FOR SHARE, in id order, waiting for a save of one that is
  -- running (Import 2B's out of Reclaim, a reclaim, a pairing: each holds its
  -- document, then waits for the client's lock); before, Restore took the
  -- client's lock first and the document only as it named it, and the two
  -- deadlocked. One made Reclaim between the two locks (by a save that
  -- finished meanwhile) is taken without waiting once the client's lock is
  -- held; a save of it running at that moment stops the Restore with a plain
  -- message instead of a deadlock.
  -- The month's books rows and 2B documents, which the entries it writes may
  -- name (an Import 2B link, a reclaiming document: each name's key check
  -- takes the row FOR KEY SHARE), are taken the same way once the client's
  -- lock is held, without waiting (verification round 8): a delete of one
  -- (Import 2B's books row delete, a re-import's documents no longer in the
  -- file) holds its row, then waits for the client's lock in its
  -- write-through (twob__autopost_gone), so the Restore's key check waiting
  -- for that row deadlocked. Now a delete running at that moment stops the
  -- Restore with the plain message, and one starting after waits for it.
  PERFORM 1 FROM public.twob_import_docs d
   WHERE d.client_id = p_client_id AND d.period_month = p_period AND d.itc_action = 'RECLAIM'
   ORDER BY d.id FOR SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  BEGIN
    PERFORM 1 FROM public.twob_import_docs d
     WHERE d.client_id = p_client_id AND d.period_month = p_period AND d.itc_action = 'RECLAIM'
     ORDER BY d.id FOR SHARE NOWAIT;
    PERFORM 1 FROM public.twob_import_docs d
     WHERE d.client_id = p_client_id AND d.period_month = p_period
     ORDER BY d.id FOR KEY SHARE NOWAIT;
    PERFORM 1 FROM public.books_register b
     WHERE b.client_id = p_client_id AND b.period_month = p_period
     ORDER BY b.id FOR KEY SHARE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'Nothing was restored: a books row or 2B document of % is being saved on Import 2B right now. Try again in a moment.',
      public.twob_month_name(p_period) USING ERRCODE = 'lock_not_available';
  END;
  SELECT COALESCE(c.liberal_2b_reconciliation, false) INTO v_liberal FROM public.clients c WHERE c.id = p_client_id;
  v_liberal := COALESCE(v_liberal, false);
  v_has_2b := EXISTS (SELECT 1 FROM public.twob_import_docs d WHERE d.client_id = p_client_id AND d.period_month = p_period);
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
  -- The month's own entries as they stand, by id, before they go: a version
  -- that names no link takes back the link its entry of the same id holds.
  -- And, by document, the entry each reclaiming document evidenced the
  -- reclaim of (named in docs_left if the Restore leaves it evidencing none).
  SELECT COALESCE(jsonb_object_agg(t.id::text, jsonb_build_object('src', t.source_book_id, 'af', t.adopted_from,
                                                                  'via', t.reclaimed_via_doc_id)), '{}'::jsonb),
         COALESCE(jsonb_object_agg(t.reclaimed_via_doc_id::text, jsonb_build_object('supplier_name', t.supplier_name,
                    'supplier_invoice_number', t.supplier_invoice_number)) FILTER (WHERE t.reclaimed_via_doc_id IS NOT NULL), '{}'::jsonb)
    INTO v_cur2b, v_held FROM public.bills_not_in_2b t
   WHERE t.client_id = p_client_id AND t.period_month = p_period AND NOT COALESCE(t.is_carried_forward, false);
  SELECT COALESCE(jsonb_object_agg(t.id::text, jsonb_build_object('src', t.source_doc_id, 'af', t.adopted_from)), '{}'::jsonb)
    INTO v_curbk FROM public.bills_not_in_books t
   WHERE t.client_id = p_client_id AND t.period_month = p_period AND NOT COALESCE(t.is_carried_forward, false);
  DELETE FROM public.bills_not_in_2b WHERE client_id = p_client_id AND period_month = p_period AND NOT COALESCE(is_carried_forward, false);
  DELETE FROM public.bills_not_in_books WHERE client_id = p_client_id AND period_month = p_period AND NOT COALESCE(is_carried_forward, false);
  WITH e0 AS (
    SELECT x.x, x.o, public.twob__try_uuid(x.x ->> 'id') AS vid,
           COALESCE(public.twob__try_uuid(x.x ->> 'source_book_id'),
                    public.twob__try_uuid(v_cur2b -> (x.x ->> 'id') ->> 'src')) AS src,
           CASE WHEN public.twob__try_uuid(x.x ->> 'source_book_id') IS NOT NULL
                THEN CASE jsonb_typeof(x.x -> 'adopted_from') WHEN 'object' THEN x.x -> 'adopted_from' END
                ELSE CASE jsonb_typeof(v_cur2b -> (x.x ->> 'id') -> 'af') WHEN 'object' THEN v_cur2b -> (x.x ->> 'id') -> 'af' END END AS af,
           NULLIF(btrim(COALESCE(x.x ->> 'reclaim_month', '')), '') IS NOT NULL
             AND NULLIF(btrim(COALESCE(x.x ->> 'reclaim_subtype', '')), '') IS NULL AS reclaimed,
           public.twob__try_uuid(x.x ->> 'reclaimed_via_doc_id') AS named_v,
           public.twob__try_uuid(v_cur2b -> (x.x ->> 'id') ->> 'via') AS named_c
      FROM jsonb_array_elements(p_bills_2b) WITH ORDINALITY x(x, o)
     WHERE lower(x.x ->> 'is_carried_forward') IN ('false', 'f', '0') AND NOT (x.o = ANY (v_skip_2b))),
  -- A reclaim comes back reclaimed only with its 2B document known exactly
  -- (verification round 9: no document is ever looked for by its amounts),
  -- in this order (via_by): (1) the one the version names
  -- (reclaimed_via_doc_id, in versions written from this release), else (2)
  -- the one the month's entry of that id names now, else (3) the month's
  -- only original invoice or debit note (the only documents that evidence a
  -- reclaim) that is the same document (GSTIN or supplier, number and date,
  -- twob_doc_ident), and only while it is the version's only reclaim that
  -- names nothing and is that document (round 11: two such reclaims are
  -- never told apart, by order or by amounts, whatever their amounts; round
  -- 10 told them apart by amounts within Rs. 2, but an entry's amounts can
  -- move after its reclaim, a books correction, and then a reclaim moved
  -- onto the other line's document). A document goes to the reclaim that knows it best, (1)
  -- before (2) before (3), then in the version's order (via_rn below; round
  -- 10: (1) and (2) ranked alike before, so a document the month's entry
  -- names now took a version's own one by the version's order); one found
  -- by (3) is that reclaim's only while no other reclaim of the version
  -- takes it by any of the three (round 10: two of the same document went
  -- by the version's order, and the first took the other's document).
  -- Round 8 looked for the document by its amounts as well, row by row, and
  -- so moved reclaims between entries of equal amounts, onto another
  -- supplier's document, or (for a Liberal client) not at all.
  e1 AS (
    SELECT e0.*,
           CASE WHEN e0.reclaimed AND e0.named_v IS NULL AND e0.named_c IS NULL
                THEN public.twob_doc_ident(e0.x ->> 'supplier_gstin', e0.x ->> 'supplier_name', e0.x ->> 'supplier_invoice_number',
                                           public.twob__try_date(e0.x ->> 'date')) END AS ident
      FROM e0),
  md AS MATERIALIZED (
    SELECT public.twob_doc_ident(d.supplier_gstin, d.supplier_name, d.supplier_invoice_number, d.date) AS ident,
           (array_agg(d.id))[1] AS id, count(*) AS n,
           (array_agg(jsonb_build_object('supplier_name', d.supplier_name, 'supplier_invoice_number', d.supplier_invoice_number,
              'taxable_value', d.taxable_value, 'input_igst', d.input_igst, 'input_cgst', d.input_cgst, 'input_sgst', d.input_sgst)))[1] AS doc
      FROM public.twob_import_docs d
     WHERE d.client_id = p_client_id AND d.period_month = p_period
       AND NOT COALESCE(d.is_amendment, false) AND COALESCE(d.doc_type, 'INVOICE') IN ('INVOICE', 'DEBIT_NOTE')
       AND EXISTS (SELECT 1 FROM e1 WHERE e1.ident IS NOT NULL)
     GROUP BY 1),
  e2 AS (
    SELECT e1.*, md.n AS ident_n, md.doc AS ident_doc,
           count(e1.ident) OVER (PARTITION BY e1.ident) AS ident_rc,
           md.id AS ident_id
      FROM e1 LEFT JOIN md ON md.ident = e1.ident),
  e AS (
    SELECT e2.*,
           CASE WHEN NOT e2.reclaimed THEN NULL
                WHEN e2.named_v IS NOT NULL THEN e2.named_v
                WHEN e2.named_c IS NOT NULL THEN e2.named_c
                WHEN e2.ident_n = 1 AND e2.ident_rc = 1 THEN e2.ident_id END AS via,
           CASE WHEN e2.named_v IS NOT NULL THEN 1 WHEN e2.named_c IS NOT NULL THEN 2 ELSE 3 END AS via_by
      FROM e2),
  k AS (
    SELECT e.*,
           row_number() OVER (PARTITION BY e.vid ORDER BY e.o) AS vid_rn,
           row_number() OVER (PARTITION BY e.src ORDER BY e.o) AS src_rn,
           row_number() OVER (PARTITION BY e.via ORDER BY e.via_by, e.o) AS via_rn,
           count(*) OVER (PARTITION BY e.via) AS via_n,
           first_value(e.x) OVER (PARTITION BY e.via ORDER BY e.via_by, e.o) AS via_first,
           first_value(e.via_by) OVER (PARTITION BY e.via ORDER BY e.via_by, e.o) AS via_first_by,
           EXISTS (SELECT 1 FROM public.books_register b WHERE b.id = e.src AND b.client_id = p_client_id AND b.period_month = p_period)
             AND NOT EXISTS (SELECT 1 FROM public.bills_not_in_2b z WHERE z.source_book_id = e.src) AS src_ok,
           -- The document's treatment now (NULL: no longer in this month),
           -- and an entry the month keeps that it already evidences (read
           -- by the document's id alone, and only for a reclaim's document).
           CASE WHEN e.via IS NOT NULL
                THEN (SELECT CASE WHEN d.client_id = p_client_id AND d.period_month = p_period THEN d.itc_action END
                        FROM public.twob_import_docs d WHERE d.id = e.via) END AS via_now,
           CASE WHEN e.via IS NOT NULL
                THEN (SELECT to_jsonb(z) FROM public.bills_not_in_2b z WHERE z.reclaimed_via_doc_id = e.via ORDER BY z.id LIMIT 1) END AS via_kept
      FROM e),
  -- A reclaim comes back only while its document is in the month, is
  -- Reclaim now, and evidences no other reclaim (the month's kept entries,
  -- or the version's own first one, the best known first); otherwise the
  -- entry comes back in Awaiting reclaim, named with why (verification
  -- round 6: before, a reclaim against a document taken out of Reclaim
  -- since, or a version's second reclaim on one document, came back counted
  -- in 5.4 beside the document's own count in 5.1). A reclaim whose document
  -- is not known exactly (none of the three, or found by (3) while another
  -- reclaim of the version takes it too) comes back in Awaiting reclaim,
  -- named ("reclaim it again on Import 2B"), for a Strict and a Liberal
  -- client alike, whenever the month holds any 2B document (round 9: kept
  -- without it, it counted in 5.4 beside that document's own count in 5.1,
  -- if the document was the one it was made with, and nothing can tell that
  -- it was not). Only a Liberal client's reclaim in a month that holds no 2B
  -- document at all (typed on 2B Reconciliation, which a Liberal client
  -- may) comes back as typed; a Strict client reclaims only on Import 2B,
  -- against a document, so its reclaim comes back in Awaiting reclaim then
  -- too (round 8: after Delete 2B, the re-import's document counted in 5.1
  -- beside it).
  kk AS (
    SELECT k.*,
           COALESCE(k.reclaimed AND (
             (k.via IS NOT NULL AND ((k.via_by = 3 AND k.via_n > 1) OR k.via_rn > 1
                                     OR k.via_now IS DISTINCT FROM 'RECLAIM' OR k.via_kept IS NOT NULL))
             OR (k.via IS NULL AND (v_has_2b OR NOT v_liberal))), false) AS reclaim_back
      FROM k),
  -- An entry the version names no link for (and its entry of that id has
  -- since been replaced: a Clear Data, an earlier Restore), whose reversal
  -- (in-2B) month is this month, as an entry Post adds carries, is linked as
  -- it is added by the document it is (GSTIN or supplier, number and date;
  -- its amounts may differ: a version of before an edit) to a books row (2B
  -- document) of this month that posts and holds no entry, one to one.
  -- Linked as an own entry (adopted_from: as restored): the next save of
  -- that row changes it instead of adding a second one, and if the row stops
  -- posting it goes back to what was restored and stays. (Verification round
  -- 9, for time: linked in the insert, not by an update of the entries just
  -- added, which the planner took for one row and joined to the books side
  -- by a nested loop, sorting it once per entry, and which the change log
  -- recorded a second time; the two sides numbered in one list and paired by
  -- grouping; the rows holding an entry read once, as the client's links. A
  -- 1,000 + 1,000 Restore of a version of before took 2.2 to 2.7 s with the
  -- change log.)
  rl AS (
    SELECT 1 AS side, kk.o, NULL::uuid AS id,
           public.twob_doc_ident(kk.x ->> 'supplier_gstin', kk.x ->> 'supplier_name', kk.x ->> 'supplier_invoice_number',
                                 public.twob__try_date(kk.x ->> 'date')) AS k
      FROM kk
     WHERE NOT (kk.src_ok AND kk.src_rn = 1)
       AND public.twob_label_key(NULLIF(btrim(COALESCE(kk.x ->> 'reversal_month', '')), '')) = v_key
    UNION ALL
    SELECT 2, NULL, b.id, public.twob_doc_ident(b.supplier_gstin, b.supplier_name, b.supplier_invoice_number, b.date)
      FROM public.books_register b
     WHERE b.client_id = p_client_id AND b.period_month = p_period AND b.book_treatment = 'NOT_IN_2B'
       AND COALESCE(b.doc_type, 'INVOICE') <> 'DEBIT_NOTE' AND b.date IS NOT NULL
       AND COALESCE(b.taxable_value, 0) >= 0 AND COALESCE(b.input_igst, 0) >= 0
       AND COALESCE(b.input_cgst, 0) >= 0 AND COALESCE(b.input_sgst, 0) >= 0
       AND b.id NOT IN (SELECT z.source_book_id FROM public.bills_not_in_2b z
                         WHERE z.client_id = p_client_id AND z.source_book_id IS NOT NULL)
       AND b.id NOT IN (SELECT kk.src FROM kk WHERE kk.src_ok AND kk.src_rn = 1)),
  rp AS (
    SELECT (array_agg(r.o) FILTER (WHERE r.side = 1))[1] AS o, (array_agg(r.id) FILTER (WHERE r.side = 2))[1] AS bid
      FROM (SELECT rl.*, row_number() OVER (PARTITION BY rl.k, rl.side ORDER BY rl.o, rl.id) AS rn FROM rl) r
     GROUP BY r.k, r.rn),
  ins AS (
    INSERT INTO public.bills_not_in_2b (
      id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
      taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month, reclaim_subtype, reclaimed_via_doc_id,
      is_carried_forward, source_book_id, adopted_from, updated_by, updated_at)
    SELECT CASE WHEN kk.vid IS NOT NULL AND kk.vid_rn = 1 AND NOT EXISTS (SELECT 1 FROM public.bills_not_in_2b z WHERE z.id = kk.vid)
                THEN kk.vid ELSE gen_random_uuid() END,
           p_client_id, p_period, public.twob__try_date(kk.x ->> 'date'), kk.x ->> 'supplier_name',
           NULLIF(kk.x ->> 'supplier_invoice_number', ''), NULLIF(kk.x ->> 'supplier_gstin', ''),
           COALESCE(public.twob__try_num(kk.x ->> 'taxable_value'), 0), COALESCE(public.twob__try_num(kk.x ->> 'input_igst'), 0),
           COALESCE(public.twob__try_num(kk.x ->> 'input_cgst'), 0), COALESCE(public.twob__try_num(kk.x ->> 'input_sgst'), 0),
           NULLIF(btrim(COALESCE(kk.x ->> 'reversal_month', '')), ''),
           CASE WHEN NOT kk.reclaim_back THEN NULLIF(btrim(COALESCE(kk.x ->> 'reclaim_month', '')), '') END,
           CASE WHEN NOT kk.reclaim_back THEN NULLIF(btrim(COALESCE(kk.x ->> 'reclaim_subtype', '')), '') END,
           CASE WHEN kk.reclaimed AND NOT kk.reclaim_back THEN kk.via END,
           false,
           CASE WHEN kk.src_ok AND kk.src_rn = 1 THEN kk.src ELSE rp.bid END,
           CASE WHEN kk.src_ok AND kk.src_rn = 1 THEN kk.af
                WHEN rp.bid IS NOT NULL
                THEN public.twob__entry_figures(jsonb_build_object('date', public.twob__try_date(kk.x ->> 'date'),
                       'supplier_name', kk.x ->> 'supplier_name', 'supplier_invoice_number', NULLIF(kk.x ->> 'supplier_invoice_number', ''),
                       'supplier_gstin', NULLIF(kk.x ->> 'supplier_gstin', ''),
                       'taxable_value', COALESCE(public.twob__try_num(kk.x ->> 'taxable_value'), 0)::numeric(15,2),
                       'input_igst', COALESCE(public.twob__try_num(kk.x ->> 'input_igst'), 0)::numeric(15,2),
                       'input_cgst', COALESCE(public.twob__try_num(kk.x ->> 'input_cgst'), 0)::numeric(15,2),
                       'input_sgst', COALESCE(public.twob__try_num(kk.x ->> 'input_sgst'), 0)::numeric(15,2))) END,
           p_actor_id, now()
      FROM kk LEFT JOIN rp ON rp.o = kk.o AND rp.bid IS NOT NULL
     ORDER BY kk.o
    RETURNING source_book_id)
  SELECT (SELECT count(*) FROM ins), (SELECT count(*) FROM ins WHERE ins.source_book_id IS NOT NULL),
         COALESCE((SELECT jsonb_agg(public.twob__entry_json(jsonb_build_object('period_month', p_period, 'date', kk.x ->> 'date',
             'supplier_name', kk.x ->> 'supplier_name', 'supplier_invoice_number', kk.x ->> 'supplier_invoice_number',
             'input_igst', public.twob__try_num(kk.x ->> 'input_igst'), 'input_cgst', public.twob__try_num(kk.x ->> 'input_cgst'),
             'input_sgst', public.twob__try_num(kk.x ->> 'input_sgst')),
             CASE WHEN kk.via IS NULL AND NOT v_has_2b
                    THEN 'its 2B document cannot be found: this version does not name it, and this month holds no 2B document; reclaim it again on Import 2B'
                  WHEN kk.via IS NULL AND kk.ident_n > 1
                    THEN format('its 2B document cannot be told: this version does not name it, and %s 2B documents of this month have its GSTIN or supplier, number and date; reclaim it again on Import 2B', kk.ident_n)
                  WHEN kk.via IS NULL AND kk.ident_n = 1
                    THEN format('its 2B document cannot be told: this version does not name it, and %s of its reclaims are the same document as %s, the one 2B document of this month with their GSTIN or supplier, number and date; reclaim it again on Import 2B',
                                kk.ident_rc, COALESCE(public.twob__entry_name(kk.ident_doc), 'the document'))
                  WHEN kk.via IS NULL
                    THEN 'its 2B document cannot be found: this version does not name it, and no 2B document of this month has its GSTIN or supplier, number and date; reclaim it again on Import 2B'
                  -- Found by (3) while another reclaim of the version takes
                  -- the same document (round 10): not guessed.
                  WHEN kk.via_by = 3 AND kk.via_n > 1 AND kk.via_first_by = 3
                    THEN format('its 2B document cannot be told: this version does not name it, and %s of its reclaims are the same document as %s, the one 2B document of this month with their GSTIN or supplier, number and date; reclaim it again on Import 2B',
                                kk.via_n, COALESCE(public.twob__entry_name(kk.ident_doc), 'the document'))
                  WHEN kk.via_by = 3 AND kk.via_n > 1
                    THEN format('its 2B document cannot be told: this version does not name it, and %s, the one 2B document of this month with its GSTIN or supplier, number and date, evidences the reclaim of %s %s; reclaim it again on Import 2B',
                                COALESCE(public.twob__entry_name(kk.ident_doc), 'the document'), COALESCE(public.twob__entry_name(kk.via_first), 'another entry'),
                                CASE WHEN kk.via_first_by = 1 THEN 'in this version' ELSE 'now' END)
                  WHEN kk.via_now IS NULL THEN 'its 2B document is no longer in this month'
                  WHEN kk.via_now IS DISTINCT FROM 'RECLAIM' THEN format('its 2B document is %s now, not Reclaim', public.twob__treatment_label(kk.via_now))
                  WHEN kk.via_kept IS NOT NULL THEN format('its 2B document already evidences the reclaim of %s',
                                                          COALESCE(public.twob__entry_name(kk.via_kept), 'another entry'))
                  -- Worded by where the other reclaim's document is known
                  -- from (round 10): the version names it, or the month's
                  -- entry of that id names it now.
                  ELSE format('its 2B document evidences the reclaim of %s %s (one document, one reclaim)',
                              COALESCE(public.twob__entry_name(kk.via_first), 'another entry'),
                              CASE WHEN kk.via_first_by = 1 THEN 'in this version' ELSE 'now' END) END)
             ORDER BY kk.o) FROM kk WHERE kk.reclaim_back), '[]'::jsonb)
    INTO n2b, v_linked, v_reclaims_back;
  -- The month's Reclaim original invoices and debit notes that, as the
  -- Restore leaves the month, evidence no reclaim (verification round 10):
  -- their ITC counts nowhere (not in 5.1, and no entry reclaims it in 5.4)
  -- until an entry is reclaimed with one again on Import 2B (Pending items,
  -- Link & Reclaim, which offers them) or it is taken out of Reclaim. The
  -- Restore never changes a document; it names each, with the entry whose
  -- reclaim it evidenced before the Restore, if any (before, a version in
  -- which that entry was Awaiting reclaim, or did not exist, left its
  -- document so without a word), and those a Clear Data left so, whose
  -- reclaims a version of before cannot link back (each named in
  -- reclaims_back, "reclaim it again on Import 2B").
  SELECT COALESCE(jsonb_agg(public.twob__entry_json(to_jsonb(d),
             CASE WHEN v_held ? d.id::text
                  THEN format('stays Reclaim and evidences no reclaim now, so its ITC counts nowhere; before this Restore it evidenced the reclaim of %s',
                              COALESCE(public.twob__entry_name(v_held -> d.id::text), 'an entry'))
                  ELSE 'is Reclaim and evidences no reclaim, so its ITC counts nowhere' END)
           ORDER BY d.date, d.supplier_invoice_number, d.id), '[]'::jsonb)
    INTO v_docs_left
    FROM public.twob_import_docs d
   WHERE d.client_id = p_client_id AND d.period_month = p_period AND d.itc_action = 'RECLAIM'
     AND NOT COALESCE(d.is_amendment, false) AND COALESCE(d.doc_type, 'INVOICE') IN ('INVOICE', 'DEBIT_NOTE')
     AND NOT EXISTS (SELECT 1 FROM public.bills_not_in_2b z WHERE z.reclaimed_via_doc_id = d.id);
  WITH e AS (
    SELECT x.x, x.o, public.twob__try_uuid(x.x ->> 'id') AS vid,
           COALESCE(public.twob__try_uuid(x.x ->> 'source_doc_id'),
                    public.twob__try_uuid(v_curbk -> (x.x ->> 'id') ->> 'src')) AS src,
           CASE WHEN public.twob__try_uuid(x.x ->> 'source_doc_id') IS NOT NULL
                THEN CASE jsonb_typeof(x.x -> 'adopted_from') WHEN 'object' THEN x.x -> 'adopted_from' END
                ELSE CASE jsonb_typeof(v_curbk -> (x.x ->> 'id') -> 'af') WHEN 'object' THEN v_curbk -> (x.x ->> 'id') -> 'af' END END AS af
      FROM jsonb_array_elements(p_bills_books) WITH ORDINALITY x(x, o)
     WHERE lower(x.x ->> 'is_carried_forward') IN ('false', 'f', '0') AND NOT (x.o = ANY (v_skip_books))),
  k AS (
    SELECT e.*,
           row_number() OVER (PARTITION BY e.vid ORDER BY e.o) AS vid_rn,
           row_number() OVER (PARTITION BY e.src ORDER BY e.o) AS src_rn,
           EXISTS (SELECT 1 FROM public.twob_import_docs d WHERE d.id = e.src AND d.client_id = p_client_id AND d.period_month = p_period)
             AND NOT EXISTS (SELECT 1 FROM public.bills_not_in_books z WHERE z.source_doc_id = e.src) AS src_ok
      FROM e),
  -- Linked as it is added, by the document it is, as on the other side.
  rl AS (
    SELECT 1 AS side, k.o, NULL::uuid AS id,
           public.twob_doc_ident(k.x ->> 'supplier_gstin', k.x ->> 'supplier_name', k.x ->> 'supplier_invoice_number',
                                 public.twob__try_date(k.x ->> 'date')) AS kd
      FROM k
     WHERE NOT (k.src_ok AND k.src_rn = 1)
       AND public.twob_label_key(NULLIF(btrim(COALESCE(k.x ->> 'bill_in_2b_month', '')), '')) = v_key
    UNION ALL
    SELECT 2, NULL, d.id, public.twob_doc_ident(d.supplier_gstin, d.supplier_name, d.supplier_invoice_number, d.date)
      FROM public.twob_import_docs d
     WHERE d.client_id = p_client_id AND d.period_month = p_period AND d.itc_action = 'NOT_IN_BOOKS' AND d.date IS NOT NULL
       AND d.id NOT IN (SELECT z.source_doc_id FROM public.bills_not_in_books z
                         WHERE z.client_id = p_client_id AND z.source_doc_id IS NOT NULL)
       AND d.id NOT IN (SELECT k.src FROM k WHERE k.src_ok AND k.src_rn = 1)),
  rp AS (
    SELECT (array_agg(r.o) FILTER (WHERE r.side = 1))[1] AS o, (array_agg(r.id) FILTER (WHERE r.side = 2))[1] AS did
      FROM (SELECT rl.*, row_number() OVER (PARTITION BY rl.kd, rl.side ORDER BY rl.o, rl.id) AS rn FROM rl) r
     GROUP BY r.kd, r.rn),
  ins AS (
    INSERT INTO public.bills_not_in_books (
      id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
      taxable_value, input_igst, input_cgst, input_sgst, book_entry_month, bill_in_2b_month,
      is_carried_forward, source_doc_id, adopted_from, updated_by, updated_at)
    SELECT CASE WHEN k.vid IS NOT NULL AND k.vid_rn = 1 AND NOT EXISTS (SELECT 1 FROM public.bills_not_in_books z WHERE z.id = k.vid)
                THEN k.vid ELSE gen_random_uuid() END,
           p_client_id, p_period, public.twob__try_date(k.x ->> 'date'), k.x ->> 'supplier_name',
           NULLIF(k.x ->> 'supplier_invoice_number', ''), NULLIF(k.x ->> 'supplier_gstin', ''),
           COALESCE(public.twob__try_num(k.x ->> 'taxable_value'), 0), COALESCE(public.twob__try_num(k.x ->> 'input_igst'), 0),
           COALESCE(public.twob__try_num(k.x ->> 'input_cgst'), 0), COALESCE(public.twob__try_num(k.x ->> 'input_sgst'), 0),
           NULLIF(btrim(COALESCE(k.x ->> 'book_entry_month', '')), ''), NULLIF(btrim(COALESCE(k.x ->> 'bill_in_2b_month', '')), ''),
           false,
           CASE WHEN k.src_ok AND k.src_rn = 1 THEN k.src ELSE rp.did END,
           CASE WHEN k.src_ok AND k.src_rn = 1 THEN k.af
                WHEN rp.did IS NOT NULL
                THEN public.twob__entry_figures(jsonb_build_object('date', public.twob__try_date(k.x ->> 'date'),
                       'supplier_name', k.x ->> 'supplier_name', 'supplier_invoice_number', NULLIF(k.x ->> 'supplier_invoice_number', ''),
                       'supplier_gstin', NULLIF(k.x ->> 'supplier_gstin', ''),
                       'taxable_value', COALESCE(public.twob__try_num(k.x ->> 'taxable_value'), 0)::numeric(15,2),
                       'input_igst', COALESCE(public.twob__try_num(k.x ->> 'input_igst'), 0)::numeric(15,2),
                       'input_cgst', COALESCE(public.twob__try_num(k.x ->> 'input_cgst'), 0)::numeric(15,2),
                       'input_sgst', COALESCE(public.twob__try_num(k.x ->> 'input_sgst'), 0)::numeric(15,2))) END,
           p_actor_id, now()
      FROM k LEFT JOIN rp ON rp.o = k.o AND rp.did IS NOT NULL
     ORDER BY k.o
    RETURNING source_doc_id)
  SELECT count(*), v_linked + count(*) FILTER (WHERE ins.source_doc_id IS NOT NULL) INTO nbk, v_linked FROM ins;
  PERFORM set_config('twob.write', COALESCE(v_prev, ''), true);
  -- The month's two lists as this Restore left them (its carried entries
  -- with them), for the RESTORE version the page records (verification
  -- round 7: it recorded the version restored, reclaims that came back in
  -- Awaiting reclaim and entries left out included).
  RETURN jsonb_build_object('period', p_period, 'bills_not_in_2b', n2b, 'bills_not_in_books', nbk,
                            'carried_kept_2b', c2b, 'carried_kept_books', cbk, 'left_out', v_left, 'linked', v_linked,
                            'reclaims_back', v_reclaims_back, 'docs_left', v_docs_left,
                            'rows_2b', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.date, t.id), '[]'::jsonb) FROM public.bills_not_in_2b t
                                         WHERE t.client_id = p_client_id AND t.period_month = p_period),
                            'rows_books', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.date, t.id), '[]'::jsonb) FROM public.bills_not_in_books t
                                            WHERE t.client_id = p_client_id AND t.period_month = p_period));
END;
$$;

-- What the month's ledger lacks to follow its Import 2B, read in one
-- statement (one snapshot: a save landing meanwhile is wholly in it or not
-- at all), for the page's line ("not in step"): per list the entries to add,
-- link, change, take back and put back (twob__autopost_effective, what a
-- save or "Bring the reconciliation up to date" would write), and up to four
-- of their names. prior: the month is filed (the page then shows only the
-- Not in 2B side, which a GST Manager or the superadmin brings up to date
-- through the door; its Not in Books side follows the filed 2B and is only
-- named). Reads only; any staff (the line is shown to everyone).
CREATE OR REPLACE FUNCTION public.twob_import2b_step(p_client_id uuid, p_period text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.twob_autopost_row[];
  v_out jsonb;
BEGIN
  IF p_client_id IS NULL OR public.twob_period_key(p_period) IS NULL THEN
    RETURN NULL;
  END IF;
  v_plan := ARRAY(SELECT x FROM public.twob__autopost_effective(p_client_id, p_period, NULL, NULL) x WHERE x.op <> 'skip');
  SELECT jsonb_build_object('prior', public.twob_month_is_prior(p_client_id, p_period))
         || jsonb_object_agg(l.list, jsonb_build_object(
              'add', (SELECT count(*) FROM unnest(v_plan) x WHERE x.list = l.list AND x.op = 'insert'),
              'link', (SELECT count(*) FROM unnest(v_plan) x WHERE x.list = l.list AND x.op = 'link'),
              'change', (SELECT count(*) FROM unnest(v_plan) x WHERE x.list = l.list AND x.op = 'update'),
              'remove', (SELECT count(*) FROM unnest(v_plan) x WHERE x.list = l.list AND x.op = 'retract'),
              'unlink', (SELECT count(*) FROM unnest(v_plan) x WHERE x.list = l.list AND x.op = 'unlink'),
              'names', COALESCE((SELECT jsonb_agg(y.nm ORDER BY y.nm) FROM (
                  SELECT DISTINCT NULLIF(btrim(concat_ws(' ', btrim(COALESCE(x.supplier_name, '')), x.supplier_invoice_number)), '') AS nm
                    FROM unnest(v_plan) x WHERE x.list = l.list AND x.op IN ('insert', 'link', 'update')
                   ORDER BY 1 LIMIT 4) y WHERE y.nm IS NOT NULL), '[]'::jsonb)))
    INTO v_out
    FROM (VALUES ('bills_not_in_2b'), ('bills_not_in_books')) l(list);
  RETURN v_out;
END;
$$;

-- A 2B document of the open month taken out of Reclaim (Import 2B's Save of
-- a staged treatment), in one transaction (verification round 2): the
-- pending entry it evidences goes back to Awaiting reclaim and the document
-- takes its new treatment, with the document's write-through, or none of it
-- (before, two calls: a failure between them left the reclaim undone and the
-- document counted nowhere). Locks as every writer of a reclaim takes them:
-- the document's row, then the client's lock, then the entries (Restore
-- too, round 7). Import 2B & post. p_expect_entry (verification round 7):
-- the entry whose reclaim the page showed the document evidencing, or NULL
-- when it showed none; the entries naming the document now, read with them
-- held, must be exactly that one (or none), or nothing is written (before,
-- a stale tab's Save, after another user had taken the document out of
-- Reclaim and reclaimed another entry with it, released that new reclaim
-- without a word). Returns {ok, was, released}; {ok: false, gone: true,
-- message} when nothing is written: the document is no longer in the
-- month, no longer Reclaim (verification round 5: changed elsewhere since
-- the page showed it Reclaim; before, a stale tab's Save wrote its
-- treatment over the one another user had given it), or the reclaim it
-- evidences is not the one the page showed (a document two entries name,
-- recorded before the one-reclaim rule, shows either on the page and
-- leaves with both released: verification round 8). The only way out of Reclaim
-- while an entry is reclaimed against the document
-- (twob__reclaim_evidence_guard): its entries are released first, in the
-- same transaction.
DROP FUNCTION IF EXISTS public.twob_import2b_unreclaim(uuid, uuid, text, uuid, text);
CREATE OR REPLACE FUNCTION public.twob_import2b_unreclaim(
  p_actor_id uuid, p_client_id uuid, p_period text, p_doc_id uuid, p_action text, p_expect_entry uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_was text;
  v_now uuid[];
  v_entry jsonb;
  n integer;
BEGIN
  IF p_client_id IS NULL OR public.twob_period_key(p_period) IS NULL OR p_doc_id IS NULL THEN
    RAISE EXCEPTION 'Choose the 2B document.';
  END IF;
  IF NULLIF(btrim(COALESCE(p_action, '')), '') IS NULL OR p_action = 'RECLAIM' THEN
    RAISE EXCEPTION 'Choose the treatment the document takes instead of Reclaim.';
  END IF;
  IF NOT public.twob__staff_may(p_actor_id, 'work_2b_import') THEN
    RAISE EXCEPTION 'Needs the Import 2B & post permission. Ask a GST Manager to add it to your position.';
  END IF;
  SELECT d.itc_action INTO v_was FROM public.twob_import_docs d
   WHERE d.id = p_doc_id AND d.client_id = p_client_id AND d.period_month = p_period
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'gone', true,
      'message', 'This 2B document is no longer in this month. Nothing was saved; the page shows the month as it is now.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  IF public.twob_month_is_prior(p_client_id, p_period) THEN
    RAISE EXCEPTION 'This month is filed. Its 2B documents and the reversal, reclaim and book entry months cannot change.';
  END IF;
  IF v_was IS DISTINCT FROM 'RECLAIM' THEN
    RETURN jsonb_build_object('ok', false, 'gone', true, 'now', v_was,
      'message', format('This 2B document was changed elsewhere since the page showed it: it is %s now, not Reclaim. Nothing was saved; the page shows the month as it is now.',
                        public.twob__treatment_label(v_was)));
  END IF;
  -- The reclaim it evidences now, the entries held (no entry newly names
  -- the document meanwhile: that takes its row, held above), against the one
  -- the page showed. A document two entries name, recorded before the
  -- one-reclaim rule (GROWQ's July REDEL 25 on live), shows one of them on
  -- the page: either is the reclaim it showed, and both are released with it
  -- (verification round 8: before, every Save of it was refused as changed
  -- elsewhere, so it could never leave Reclaim). No entry newly names a
  -- document another names (twob__reclaim_via_check), so such a pair is
  -- never one recorded since the page loaded.
  SELECT COALESCE(array_agg(z.id ORDER BY z.id), '{}'::uuid[]) INTO v_now
    FROM (SELECT t.id FROM public.bills_not_in_2b t WHERE t.reclaimed_via_doc_id = p_doc_id ORDER BY t.id FOR NO KEY UPDATE) z;
  IF (CASE WHEN p_expect_entry IS NULL THEN cardinality(v_now) > 0 ELSE NOT (p_expect_entry = ANY (v_now)) END) THEN
    SELECT to_jsonb(t) INTO v_entry FROM public.bills_not_in_2b t WHERE t.id = v_now[1];
    RETURN jsonb_build_object('ok', false, 'gone', true, 'what', 'reclaim', 'now', to_jsonb(v_now),
      'message', format('The reclaim this 2B document evidences was changed elsewhere since the page showed it (another tab or another user): it is now the evidence of %s. Nothing was saved; the page shows the month as it is now.',
                        CASE WHEN v_entry IS NULL THEN 'no reclaim'
                             ELSE format('the reclaim of %s (%s, %s)', COALESCE(public.twob__entry_name(v_entry), 'an entry'),
                                         COALESCE(NULLIF(btrim(COALESCE(v_entry ->> 'reclaim_month', '')), ''), 'reclaimed'),
                                         public.twob_month_name(v_entry ->> 'period_month')) END));
  END IF;
  UPDATE public.bills_not_in_2b t
     SET reclaim_month = NULL, reclaim_subtype = NULL, reclaimed_via_doc_id = NULL, updated_by = p_actor_id, updated_at = now()
   WHERE t.reclaimed_via_doc_id = p_doc_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.twob_import_docs SET itc_action = p_action, updated_by = p_actor_id, updated_at = now() WHERE id = p_doc_id;
  RETURN jsonb_build_object('ok', true, 'was', v_was, 'released', n);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Who may call what
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION
  public.twob_import2b_catch_up(uuid, uuid, text, boolean, text),
  public.twob_import2b_reclaim(uuid, uuid, text, uuid, uuid, text),
  public.twob_import2b_save_book(uuid, uuid, jsonb, uuid, uuid, jsonb),
  public.twob_import2b_prior_save(uuid, uuid, text, jsonb, boolean, boolean, text, jsonb),
  public.twob_import2b_delete_2b(uuid, uuid, text),
  public.twob_clear_year(uuid, uuid, text[]),
  public.twob_import2b_flush_version(uuid, uuid, text),
  public.twob_import2b_step(uuid, text),
  public.twob_import2b_unreclaim(uuid, uuid, text, uuid, text, uuid),
  public.twob_restore_version_linked(uuid, uuid, text, jsonb, jsonb),
  public.twob__acting_user(),
  public.twob__may_post(uuid)
TO anon, authenticated, service_role;

-- Internal: they write without checking who acts, or are triggers.
REVOKE ALL ON FUNCTION
  public.twob__autopost_plan(uuid, text, uuid[], uuid[]),
  public.twob__autopost_apply(uuid, text, uuid[], uuid[], uuid, boolean, boolean, text),
  public.twob__autopost_digest(public.twob_autopost_row[]),
  public.twob__autopost_plan_books(uuid, text, uuid[]),
  public.twob__autopost_plan_docs(uuid, text, uuid[]),
  public.twob__autopost_effective(uuid, text, uuid[], uuid[]),
  public.twob__autopost_adjust(uuid, text, public.twob_autopost_row[]),
  public.twob__carried_decision_guard(),
  public.twob__autopost_touch(uuid, text, uuid[], uuid[], uuid),
  public.twob__autopost_snapshot(uuid, text, uuid),
  public.twob__autopost_changed(uuid, text, uuid),
  public.twob__prior_derived(uuid, text, uuid[]),
  public.twob__prior_links(uuid, text, jsonb, integer, boolean, uuid),
  public.twob__prior_save_preview(uuid, uuid, text, jsonb, jsonb, boolean),
  public.twob__prior_digest(jsonb, jsonb),
  public.twob__lock_month_rows(uuid, text[], boolean),
  public.twob__undo_hint(jsonb),
  public.twob__door_merge(jsonb, jsonb, boolean, text),
  public.twob__staff_may(uuid, text),
  public.twob__autopost_books_added(),
  public.twob__autopost_books_changed(),
  public.twob__autopost_docs_added(),
  public.twob__autopost_docs_changed(),
  public.twob__autopost_gone(),
  public.twob__autopost_gone_done(),
  public.twob__reclaim_via_tidy(),
  public.twob__reclaim_via_check(),
  public.twob__reclaim_evidence_guard()
FROM PUBLIC, anon, authenticated;

COMMIT;
