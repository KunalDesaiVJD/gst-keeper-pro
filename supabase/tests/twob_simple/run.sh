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
# and Delete 2B / Clear Data against a save running at the same moment).
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
    grep -ho 'timing: .*' "$errf" | sed 's/^/     /' || true
  else echo "FAIL $(basename "$t")"; cat "$errf"; status=1; fi
done
for t in "$here"/test_*.sh; do
  if TWOB_TEST_DB="$db" bash "$t"; then :; else echo "FAIL $(basename "$t")"; status=1; fi
done
for t in "$here"/gates.test.mjs "$here"/app_writes.test.mjs "$here"/autopost.test.mjs; do
  if [ -f "$t" ]; then
    if TWOB_TEST_DB="$db" node "$t"; then :; else status=1; fi
  fi
done
exit $status
