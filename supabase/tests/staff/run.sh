#!/usr/bin/env bash
# Replays the staff migrations on a throwaway local database and runs the SQL
# tests in this folder: staff positions (20261014120000_staff_positions.sql),
# staff levels (20261017100000), ending sessions (20261017110000, hardened
# 20261017140000) and roles plus extras (20261025100000), each new
# one applied twice (they must be safe to re-run). Needs a local PostgreSQL
# 15/16; connection from the usual PG* variables, e.g.
#   PGHOST=/tmp/pgsock PGPORT=55432 PGUSER=postgres supabase/tests/staff/run.sh
# Never point it at the live project: it creates and drops its own database.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mig="$here/../../migrations"
db="staff_test_$$"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
createdb "$db"
trap 'dropdb --if-exists "$db"' EXIT
psql_q -f "$here/00_stub.sql" >/dev/null
psql_q -f "$mig/20261014120000_staff_positions.sql" >/dev/null || { echo "FAILED applying staff positions"; exit 1; }
for f in 20261015120000_retire_legacy_roles.sql 20261017100000_staff_levels_guard.sql 20261017110000_staff_end_sessions.sql 20261017140000_staff_end_sessions_harden.sql 20261017150000_staff_levels_guard_message.sql 20261025100000_staff_roles_and_extras.sql; do
  psql_q -f "$mig/$f" >/dev/null || { echo "FAILED applying $f"; exit 1; }
  psql_q -f "$mig/$f" >/dev/null || { echo "FAILED re-applying $f"; exit 1; }
done
status=0
shopt -s nullglob
for t in "$here"/test_*.sql; do
  if psql_q -f "$t" >/dev/null 2>"$here/.last_error"; then echo "ok   $(basename "$t")"; else echo "FAIL $(basename "$t")"; cat "$here/.last_error"; status=1; fi
done
rm -f "$here/.last_error"
exit $status
