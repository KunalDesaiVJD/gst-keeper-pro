#!/usr/bin/env bash
# Replays the 2B ledger on a throwaway local database and runs the tests of
# the simple prior-month rule (20261021100000_twob_prior_month_simple.sql,
# docs/2B_RECONCILIATION_FLOW.md §13). The schema the 2B migrations build on
# is stubbed (00_stub.sql); the staff levels guard (staff_level_of), the 2B
# migrations and the old filing trigger are the real files, and this change
# is applied twice (it must be safe to re-run). Then the fixtures
# (01_fixtures.sql), the SQL tests (test_*.sql, written as PostgREST runs
# them: SET ROLE anon with the JWT claims set; a test's "timing:" notices are
# printed), the two-session tests (test_*.sh, e.g. a reclaim committed while a
# removal runs, the lock order of the door and filing), the GSTR-3B gates test
# (gates.test.mjs: the app's own gate code run against this database before
# and after a permitted change, and against origin/main's code before it) and
# the app's own writes and words (app_writes.test.mjs: a stale page's
# reclaim, the open-month delete, the words after filing and of Re-run, the
# GSTR-3B push gate failing closed, a prior month's Post plan, the stale
# open-month Save, Suspended Reco's reads) and Import 2B's write-through
# against Post as it was (autopost.test.mjs: twin clients, the same saves,
# the database's write-through on one and planImport2BPost +
# postImport2BToLedger on the other, ledgers compared after every save kind;
# test_9a/9b/9c: the write-through's rules, two sessions saving at once, and
# 1,000-row saves under a second; test_9d/9e: the first verification round's
# findings, a reclaim and a pairing in one call each, who may change the
# ledger, a filed month's twin linked, rounding, versions as the saver's,
# and Delete 2B / Clear Data against a save running at the same moment;
# test_9f: the second round's: which own entry is linked and how it is put
# back, a filed decision on a carried copy, Restore linked, the line in one
# read-only statement, out of Reclaim in one call, timing; test_9g and
# round3.test.mjs: the third round's: the catch-up and a filed month's save
# write only what their confirm showed (the plan's digest), the rows left out
# on the ledger as last saved or not, a Pending items button acting only on
# its own month, the e-mail pop-up's reason per document, and an employee
# without Import 2B & post asked up front exactly what the database lets
# through); test_9h and round4.test.mjs: the fourth round's: 2B
# Reconciliation's Save and Import 2B's Pending items never write over a
# decision recorded elsewhere meanwhile (every column guarded; a Save stopped
# before its first write says so, and the page keeps the edits), an
# employee's pairing that changes nothing on the ledger saved through the
# page's own call, a delete taking an entry off the ledger needing the
# permission, and a filed month's save running the door once (timed at
# 1,000 rows); test_9i and round5.test.mjs: the fifth round's money rules
# held by the database: one reclaim per 2B document, a document Reclaim (and
# undeleted) while an entry is reclaimed against it, a reclaim cleared
# letting its document go, books saves guarded by the row as loaded in an
# open and a filed month, Pending items over data of before, version numbers
# read at Save time (each check recorded: run on the code of before, each
# fails or passes on its own); test_9j, test_9k and round6.test.mjs: the
# sixth round's: Restore brings a reclaim back only while its document is
# Reclaim and evidences no other (the rest Awaiting reclaim, named), an
# entry names only a Reclaim document no other names whoever writes, held
# without the unique index as live stands (beside a filed month's pair
# recorded before, against the app of before's own writes, and two sessions
# at once), and two saves of one books row from one page both kept; test_9l,
# test_9m and round7.test.mjs: the seventh round's: a version of before's
# reclaim (no document named) restored against the month's document of it,
# linked or back in Awaiting reclaim and named; out of Reclaim only for the
# reclaim the page shows; Restore and an out of Reclaim of one document at
# the same moment without a deadlock; the RESTORE version as the Restore
# left the month; test_9n, test_9m (cases 3 and 4) and round8.test.mjs: the
# eighth round's: a Strict client's reclaim restored from a version that
# names no document when it is not the same document (no GSTIN on the books
# entry, numbered otherwise, Delete 2B and imported again): back in Awaiting
# reclaim, named; a pair recorded before the one-reclaim rule out of
# Reclaim; a books row or 2B document deleted while a Restore runs, without
# a deadlock; the page hearing its own Restore as its own; test_9o: the
# ninth round's: Restore never looks for a reclaim's document by its
# amounts (a reclaim comes back reclaimed only with its document known
# exactly: named by the version, by the month's entry of that id, or the
# month's only document that is the same one, named ones first; otherwise
# back in Awaiting reclaim, named, for a Strict and a Liberal client alike
# while the month holds any 2B document), so no reclaim moves to another
# entry's or another supplier's document and a Liberal client's is not
# counted twice; a 1,000 + 1,000 Restore timed; test_9p and round10.test.mjs:
# the tenth round's: Restore names each Reclaim document it leaves
# evidencing no reclaim (docs_left, with the entry it evidenced before),
# never changing it; two reclaims of the version that are one document are
# never told apart by order, and one found as the same document is held to
# its amounts (Rs. 2 a head); a document goes to the reclaim the version
# names before the one the month's entry names now, worded by which; and
# Pending items' Link & Reclaim offers a Reclaim document that evidences no
# reclaim, its row saying its ITC counts nowhere.
#
# Needs a local PostgreSQL 15/16 and node (with the checkout's node_modules);
# connection from the usual PG* variables, e.g.
#   PGHOST=/tmp/pgsock PGPORT=55432 PGUSER=postgres supabase/tests/twob_simple/run.sh
# Never point it at the live project: it creates and drops its own database.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mig="$here/../../migrations"
db="twob_simple_test_$$"
psql_q() { PGOPTIONS="--client-min-messages=warning" psql -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
createdb "$db"
errf="$(mktemp)"
trap 'dropdb --if-exists "$db"; rm -f "$errf"' EXIT
psql_q -f "$here/00_stub.sql" >/dev/null
for f in 20261017100000_staff_levels_guard.sql \
         20260711130000_twob_import_staging.sql 20260713100000_twob_import_dropdown_values.sql \
         20260713140000_twob_import_not_in_books.sql 20260814090000_2b_import_post_to_ledger.sql \
         20260814130000_2b_reclaim_matching_and_fk_fix.sql 20261018100000_import_2b_notes_amendments.sql \
         20260814190000_carry_forward_trigger_hardening.sql 20260916120000_repair_broken_carry_forward_chains.sql; do
  psql_q -f "$mig/$f" >/dev/null || { echo "FAILED applying $f"; exit 1; }
done
# This change is applied as Supabase applies it: by a role that owns the
# schema's objects but is not a superuser (a superuser may do what the live
# project's postgres role may not, such as storing a custom setting in a
# function). The objects so far are handed to that role first.
owner="twob_mig_owner"
psql_q >/dev/null <<SQL
DO \$\$ BEGIN CREATE ROLE $owner NOSUPERUSER NOCREATEROLE LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
GRANT CREATE, USAGE ON SCHEMA public TO $owner;
DO \$\$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.oid::regclass AS t FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'S') LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO $owner', r.t);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO $owner', r.f);
  END LOOP;
END \$\$;
ALTER DEFAULT PRIVILEGES FOR ROLE $owner IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE $owner IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
SQL
psql_owner() { PGOPTIONS="--client-min-messages=warning" psql -X -q -v ON_ERROR_STOP=1 -U "$owner" -d "$db" "$@"; }
# The prior-month rule, then Import 2B's write-through (20261021170000,
# docs §15), each applied twice.
for f in 20261021100000_twob_prior_month_simple.sql 20261021170000_import2b_autopost.sql; do
  psql_owner -f "$mig/$f" >/dev/null 2>"$errf" || { echo "FAILED applying $f as $owner (not a superuser)"; cat "$errf"; exit 1; }
  psql_owner -f "$mig/$f" >/dev/null 2>"$errf" || { echo "FAILED re-applying $f as $owner"; cat "$errf"; exit 1; }
done
[ "$(psql_q -Atc "SELECT rolsuper FROM pg_roles WHERE rolname = '$owner'")" = "f" ] || { echo "FAILED: $owner is a superuser"; exit 1; }
echo "ok   migrations applied twice, by a role that is not a superuser"
psql_q -f "$here/01_fixtures.sql" >/dev/null
status=0
shopt -s nullglob
for t in "$here"/test_*.sql; do
  if PGOPTIONS="--client-min-messages=notice" psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$t" >/dev/null 2>"$errf"; then
    echo "ok   $(basename "$t")"
    grep -ho '\(timing\|checks\): .*' "$errf" | sed 's/^/     /' || true
  else echo "FAIL $(basename "$t")"; cat "$errf"; status=1; fi
done
for t in "$here"/test_*.sh; do
  if TWOB_TEST_DB="$db" bash "$t"; then :; else echo "FAIL $(basename "$t")"; status=1; fi
done
for t in "$here"/gates.test.mjs "$here"/app_writes.test.mjs "$here"/autopost.test.mjs "$here"/round3.test.mjs "$here"/round4.test.mjs "$here"/round5.test.mjs "$here"/round6.test.mjs "$here"/round7.test.mjs "$here"/round8.test.mjs "$here"/round10.test.mjs; do
  if [ -f "$t" ]; then
    if TWOB_TEST_DB="$db" node "$t"; then :; else status=1; fi
  fi
done
exit $status
