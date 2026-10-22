#!/usr/bin/env bash
# Filing Status pull-only (20261021110000): replays the migration twice on a
# throwaway local database over a stub of the live schema (00_stub.sql: the
# live trigger functions on filing_status, copied from the project) and runs
# the SQL tests in this folder. Writes are tested as PostgREST runs them: SET
# ROLE anon with request.jwt.claims. Needs a local PostgreSQL 15/16;
# connection from the usual PG* variables, e.g.
#   PGHOST=/tmp/pgsock PGPORT=55432 PGUSER=postgres supabase/tests/filing_pull/run.sh
# Never point it at the live project: it creates and drops its own database.
# The migration needs 20261021100000's auto_lock_on_filed (it refuses to
# apply on the live one): run.sh checks that refusal on the stub, then puts
# fixtures/twob_auto_lock.sql on it.
#
# Then the shared allowance block (manual_source_allowances and its
# functions, also in the reco branch's 20261021120000): the filing migration
# applies after the reco branch's first draft of it and after the shared
# block itself, the block applies after the migration, and, once both
# migrations are in the tree, the two copies are byte for byte the same.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mig="$here/../../migrations"
self="$mig/20261021110000_filing_status_pull_only.sql"
reco="$mig/20261021120000_reco_pull_push_gate.sql"
db="filing_pull_test_$$"
db2="filing_pull_order_$$"
keep="${KEEP_DB:-}"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
psql_2() { psql -X -q -v ON_ERROR_STOP=1 -d "$db2" "$@"; }
# The shared block of a migration: from its CREATE TABLE of
# manual_source_allowances to its GRANT on manual_source_revoke.
shared_block() { awk '/^CREATE TABLE IF NOT EXISTS public\.manual_source_allowances/{on=1} on{print} on&&/^GRANT EXECUTE ON FUNCTION public\.manual_source_revoke/{exit}' "$1"; }

createdb "$db"
trap '[ -n "$keep" ] || { dropdb --if-exists --force "$db"; dropdb --if-exists --force "$db2"; }' EXIT
PGOPTIONS="$PGOPTIONS -c client_min_messages=error" psql_q -f "$here/00_stub.sql" >/dev/null
status=0
# Round 2, defect 7: on the live auto_lock_on_filed (no GSTR-3B (Q) carry)
# the migration refuses to apply and names 20261021100000; nothing of it is
# left behind. Then the stub gets 20261021100000's auto_lock_on_filed.
if out="$(psql_q -f "$self" 2>&1 >/dev/null)"; then
  echo "FAIL applies without 20261021100000 (a pulled GSTR-3B (Q) would never be carried)"; status=1
elif ! grep -q '20261021100000' <<<"$out" || [ "$(psql_q -At -c "SELECT to_regclass('public.filing_status_log') IS NULL")" != t ]; then
  echo "FAIL refusal without 20261021100000"; echo "$out"; status=1
else
  echo "ok   refuses to apply before 20261021100000, and leaves nothing behind"
fi
psql_q -f "$here/fixtures/twob_auto_lock.sql" >/dev/null
# Applied twice: the migration must be safe to re-run.
for pass in 1 2; do
  psql_q -f "$self" >/dev/null \
    || { echo "FAILED applying the migration (pass $pass)"; exit 1; }
done
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

# ── The shared allowance block, in either order ──────────────────────────
block="$(mktemp)"; trap '[ -n "$keep" ] || { dropdb --if-exists --force "$db"; dropdb --if-exists --force "$db2"; }; rm -f "$block"' EXIT
shared_block "$self" > "$block"
if [ "$(wc -l < "$block")" -lt 100 ]; then echo "FAIL shared block: not found in the migration"; status=1; fi
createdb "$db2"
PGOPTIONS="$PGOPTIONS -c client_min_messages=error" psql_2 -f "$here/00_stub.sql" >/dev/null
psql_2 -f "$here/fixtures/twob_auto_lock.sql" >/dev/null
if out="$( { psql_2 -f "$here/fixtures/reco_first_draft_allowances.sql" && psql_2 -f "$self" \
             && psql_2 -f "$block" && psql_2 -f "$self"; } 2>&1 >/dev/null)"; then
  echo "ok   shared block: applies after the reco first draft, and the block and the migration after each other"
else
  echo "FAIL shared block order"; echo "$out"; status=1
fi
# Both copies of the block now behave as one: the superadmin allows, the
# filing route takes it, a direct write is refused.
if out="$(psql_2 -At 2>&1 <<'SQL'
SET client_min_messages = error;
BEGIN;
SET LOCAL ROLE anon;
SELECT (public.manual_source_allow('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '08/2026', 'filing:GSTR-3B', 'Portal down all day')).id IS NOT NULL;
SELECT t_eq((public.filing_attach_manual('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'GSTR-3B', '08/2026',
  'AB240826123456X', '2026-09-18',
  'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/11111111-1111-1111-1111-111111111111/GSTR-3B/08-2026/m.pdf'))->>'outcome',
  'manual_attach', 'attach under the shared allowance');
SELECT t_raises($$UPDATE public.manual_source_allowances SET used_at = NULL$$, 'Only the superadmin', 'direct write refused');
SELECT t_eq(to_regprocedure('public.manual_source_use(uuid,uuid,text,text)') IS NULL, true, 'the first draft''s manual_source_use is gone');
ROLLBACK;
SQL
)"; then
  echo "ok   shared block: one allowance mechanism after both"
else
  echo "FAIL shared block behaviour"; echo "$out"; status=1
fi
if [ -f "$reco" ]; then
  if diff <(shared_block "$reco") "$block" >/dev/null; then
    echo "ok   shared block: identical in 20261021120000"
  else
    echo "FAIL shared block: 20261021110000 and 20261021120000 differ"; diff <(shared_block "$reco") "$block" | head -20; status=1
  fi
else
  echo "skip shared block: 20261021120000 (reco branch) is not in this tree"
fi

[ -n "$keep" ] && echo "kept databases $db $db2"
exit $status
