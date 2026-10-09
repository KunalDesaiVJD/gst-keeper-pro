#!/usr/bin/env bash
# Replays the notices-module migrations on a throwaway local database and runs
# the SQL tests in this folder. Needs a local PostgreSQL 15/16 you can create
# databases on; connection comes from the usual PG* variables, e.g.
#   PGHOST=/tmp/pgsock PGPORT=55432 PGUSER=postgres supabase/tests/notices/run.sh
# Never point it at the live project: it creates and drops its own database.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mig="$here/../../migrations"
db="notices_test_$$"
keep="${KEEP_DB:-}"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }

createdb "$db"
trap '[ -n "$keep" ] || dropdb --if-exists "$db"' EXIT
psql_q -f "$here/00_stub_platform.sql" >/dev/null
# Every Phase 1+ migration is applied twice in a row: each must be safe to
# re-run (SKIP_REAPPLY=1 applies it once).
while read -r f; do
  case "$f" in ''|'#'*) continue ;; esac
  psql_q -f "$mig/$f" >/dev/null || { echo "FAILED applying $f"; exit 1; }
  if [ -z "${SKIP_REAPPLY:-}" ]; then
    case "$f" in 2026100611*|2026100612*|2026100712*|202610081*|2026100910*|2026101010*|2026101011*|2026101012*|2026101110*|2026101111*|2026101210*) psql_q -f "$mig/$f" >/dev/null || { echo "FAILED re-applying $f"; exit 1; } ;; esac
  fi
done < "$here/migrations.txt"
status=0
shopt -s nullglob
for t in "$here"/test_*.sql; do
  if psql_q -f "$t" >/dev/null 2>"$here/.last_error"; then echo "ok   $(basename "$t")"; else echo "FAIL $(basename "$t")"; cat "$here/.last_error"; status=1; fi
done
rm -f "$here/.last_error"
[ -n "$keep" ] && echo "kept database $db"
exit $status
