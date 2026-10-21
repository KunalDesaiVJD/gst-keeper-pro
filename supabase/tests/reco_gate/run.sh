#!/usr/bin/env bash
# Replays the reco migrations on a throwaway local database and runs the tests
# in this folder: the pull-only guard, manual allowances, the override, the
# GSTR-3B push gate and the round 1 and round 2 reviews' defects
# (20261021120000_reco_pull_push_gate.sql, applied twice: it must be safe to
# re-run), shared_block.sh (the allowance table shared with the filing
# branch), then parity.mjs, which runs the app's own
# difference calculations and the database's on the same rows. Writes are
# tested as PostgREST runs them (SET ROLE anon with request.jwt.claims).
# Needs a local PostgreSQL 15/16 and node; connection from the usual PG*
# variables, e.g.
#   PGHOST=/tmp/pgsock PGPORT=55432 PGUSER=postgres supabase/tests/reco_gate/run.sh
# Never point it at the live project: it creates and drops its own databases.
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
here="$(cd "$(dirname "$0")" && pwd)"
mig="$here/../../migrations"
db="reco_gate_test_$$"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
createdb "$db"
trap 'dropdb --if-exists "$db"' EXIT
psql_q -f "$here/00_stub.sql" >/dev/null
psql_q -f "$mig/20261020150000_opening_override_superadmin.sql" >/dev/null || { echo "FAILED applying 20261020150000"; exit 1; }
f=20261021120000_reco_pull_push_gate.sql
psql_q -f "$mig/$f" >/dev/null || { echo "FAILED applying $f"; exit 1; }
psql_q -f "$mig/$f" >/dev/null || { echo "FAILED re-applying $f"; exit 1; }
status=0
shopt -s nullglob
for t in "$here"/test_*.sql; do
  if psql_q -f "$t" >/dev/null 2>"$here/.last_error"; then echo "ok   $(basename "$t")"; else echo "FAIL $(basename "$t")"; cat "$here/.last_error"; status=1; fi
done
rm -f "$here/.last_error"
# Round 2, defect 4: an insert racing Clear Data in another session is still checked.
if bash "$here/race.sh"; then :; else status=1; fi
# The allowance table and functions shared with the filing branch: identical, and either order applies.
if bash "$here/shared_block.sh"; then :; else status=1; fi
# The app's calculations and the database's, on the same rows, in a fresh database.
pdb="reco_gate_parity_$$"
createdb "$pdb"
trap 'dropdb --if-exists "$db"; dropdb --if-exists "$pdb"' EXIT
psql -X -q -v ON_ERROR_STOP=1 -d "$pdb" -f "$here/00_stub.sql" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$pdb" -f "$mig/20261020150000_opening_override_superadmin.sql" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$pdb" -f "$mig/$f" >/dev/null
if node "$here/parity.mjs" "$pdb"; then :; else status=1; fi
exit $status
