#!/usr/bin/env bash
# BU agreement value confirmation, one request to several people
# (20261021140000_bu_confirm_cc.sql): replays the confirmation migrations on a
# throwaway local database, each twice (they must be safe to re-run), and runs
# the SQL tests in this folder. Every test calls the functions as the public
# key (anon), as the app and the public page do. Needs a local PostgreSQL
# 15/16; connection from the usual PG* variables, e.g.
#   PGHOST=/tmp/pgsock PGPORT=55432 PGUSER=postgres supabase/tests/bu_confirm/run.sh
# Never point it at the live project: it creates and drops its own database.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mig="$here/../../migrations"
db="bu_confirm_test_$$"
# The live project resolves pgcrypto from the extensions schema.
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning -c search_path=public,extensions"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
createdb "$db"
trap 'dropdb --if-exists --force "$db"' EXIT
psql_q -f "$here/00_stub.sql" >/dev/null
for f in 20260811160000_builder_bu_agreement_confirm.sql \
         20260814120000_builder_agreement_confirm_dastavej_label.sql \
         20261015100000_builder_bu_agreement_override.sql \
         20261019100000_bills_not_in_books_email.sql \
         20261021140000_bu_confirm_cc.sql; do
  for pass in 1 2; do
    psql_q -f "$mig/$f" >/dev/null || { echo "FAILED applying $f (pass $pass)"; exit 1; }
  done
done
psql_q -f "$here/01_helpers.sql" >/dev/null
status=0
shopt -s nullglob
for t in "$here"/test_*.sql; do
  if out="$(psql_q -f "$t" 2>&1 >/dev/null)"; then
    echo "ok   $(basename "$t")"
  else
    echo "FAIL $(basename "$t")"; echo "$out"; status=1
  fi
done
exit $status
