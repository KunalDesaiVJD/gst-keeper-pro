#!/usr/bin/env bash
# Replays the 2B ledger on a throwaway local database and runs the tests of
# the simple prior-month rule (20261021100000_twob_prior_month_simple.sql,
# docs/2B_RECONCILIATION_FLOW.md §13). The schema the 2B migrations build on
# is stubbed (00_stub.sql); the staff levels guard (staff_level_of), the 2B
# migrations and the old filing trigger are the real files, and this change
# is applied twice (it must be safe to re-run). Then the fixtures
# (01_fixtures.sql), the SQL tests (test_*.sql, written as PostgREST runs
# them: SET ROLE anon with the JWT claims set; a test's "timing:" notices are
# printed) and the GSTR-3B gates test (gates.test.mjs: the app's own gate
# code run against this database before and after a permitted change).
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
f=20261021100000_twob_prior_month_simple.sql
psql_q -f "$mig/$f" >/dev/null || { echo "FAILED applying $f"; exit 1; }
psql_q -f "$mig/$f" >/dev/null || { echo "FAILED re-applying $f"; exit 1; }
echo "ok   migration applied twice"
psql_q -f "$here/01_fixtures.sql" >/dev/null
status=0
shopt -s nullglob
for t in "$here"/test_*.sql; do
  if PGOPTIONS="--client-min-messages=notice" psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$t" >/dev/null 2>"$errf"; then
    echo "ok   $(basename "$t")"
    grep -ho 'timing: .*' "$errf" | sed 's/^/     /' || true
  else echo "FAIL $(basename "$t")"; cat "$errf"; status=1; fi
done
if [ -f "$here/gates.test.mjs" ]; then
  if TWOB_TEST_DB="$db" node "$here/gates.test.mjs"; then :; else status=1; fi
fi
exit $status
