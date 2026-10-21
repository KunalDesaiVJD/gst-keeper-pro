#!/usr/bin/env bash
# Filing Status pull-only (20261021110000): replays the migration twice on a
# throwaway local database over a stub of the live schema (00_stub.sql: the
# live trigger functions on filing_status, copied from the project) and runs
# the SQL tests in this folder. Writes are tested as PostgREST runs them: SET
# ROLE anon with request.jwt.claims. Needs a local PostgreSQL 15/16;
# connection from the usual PG* variables, e.g.
#   PGHOST=/tmp/pgsock PGPORT=55432 PGUSER=postgres supabase/tests/filing_pull/run.sh
# Never point it at the live project: it creates and drops its own database.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mig="$here/../../migrations"
db="filing_pull_test_$$"
keep="${KEEP_DB:-}"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }

createdb "$db"
trap '[ -n "$keep" ] || dropdb --if-exists --force "$db"' EXIT
PGOPTIONS="$PGOPTIONS -c client_min_messages=error" psql_q -f "$here/00_stub.sql" >/dev/null
# Applied twice: the migration must be safe to re-run.
for pass in 1 2; do
  psql_q -f "$mig/20261021110000_filing_status_pull_only.sql" >/dev/null \
    || { echo "FAILED applying the migration (pass $pass)"; exit 1; }
done
status=0
shopt -s nullglob
for t in "$here"/test_*.sql; do
  # Each test file runs in its own transaction and is rolled back, so the
  # files do not see each other's rows.
  if out="$( { echo 'BEGIN;'; cat "$t"; echo 'ROLLBACK;'; } | psql_q 2>&1 >/dev/null)"; then
    echo "ok   $(basename "$t")"
  else
    echo "FAIL $(basename "$t")"; echo "$out"; status=1
  fi
done
[ -n "$keep" ] && echo "kept database $db"
exit $status
