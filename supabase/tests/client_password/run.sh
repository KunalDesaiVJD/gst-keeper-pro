#!/usr/bin/env bash
# Client password reset (20261020140000): replays the migration twice on a
# throwaway local database and runs the SQL tests in this folder. Needs a local
# PostgreSQL 15/16 you can create databases on, with the dblink contrib
# extension (test_99_lock_order.sql runs real concurrent sessions through it,
# connecting back as the same superuser over the server's own socket);
# connection from the usual PG* variables, e.g.
#   PGHOST=/tmp/pgsock PGPORT=55432 PGUSER=postgres supabase/tests/client_password/run.sh
# Never point it at the live project: it creates and drops its own database.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mig="$here/../../migrations"
db="client_password_test_$$"
keep="${KEEP_DB:-}"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }

createdb "$db"
trap '[ -n "$keep" ] || dropdb --if-exists --force "$db"' EXIT
psql_q -f "$here/00_stub.sql" >/dev/null
# Applied twice: the migration must be safe to re-run.
for pass in 1 2; do
  psql_q -f "$mig/20261020140000_client_password_reset.sql" >/dev/null \
    || { echo "FAILED applying the migration (pass $pass)"; exit 1; }
done
status=0
shopt -s nullglob
for t in "$here"/test_*.sql; do
  if out="$(psql_q -f "$t" 2>&1 >/dev/null)"; then
    echo "ok   $(basename "$t")"
  else
    echo "FAIL $(basename "$t")"; echo "$out"; status=1
  fi
done
[ -n "$keep" ] && echo "kept database $db"
exit $status
