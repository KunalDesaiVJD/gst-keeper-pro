#!/usr/bin/env bash
# Integration round (21 Oct 2026, medium): applied while a long query reads a
# table it alters, a 21 Oct migration gives up after 5 s (SET LOCAL
# lock_timeout) and changes nothing, instead of queueing every app read of
# that table behind its exclusive lock until the long query ends. Session A
# reads the table for 12 s (a Reports Hub style read); B applies the file
# again as its owner (not a superuser, as Supabase applies it); C, the app's
# read through PostgREST (anon, statement_timeout 9 s; for the BU code table,
# closed to anon, the service role's read the Edge Function makes), starts
# just after B.
# Expected: B stops with "lock timeout" in under 9 s, C answers, A is never
# disturbed. Before the files set lock_timeout, B waited for A (12 s) and C,
# queued behind B, was cancelled by its statement_timeout. 20261021100000 is
# checked on this suite's own database; 20261021110000, 20261021120000 and
# 20261021160000 where they are in (the combined harness), each against the
# table it alters first. A failed apply is one rolled-back transaction, so
# nothing the later tests read changes. Run by run.sh with TWOB_TEST_DB set.
set -euo pipefail
db="$TWOB_TEST_DB"
here="$(cd "$(dirname "$0")" && pwd)"
mig="$here/../../migrations"
owner=twob_mig_owner
q() { PGOPTIONS="--client-min-messages=warning" psql -X -At -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   apply lock timeout: $1"; else echo "FAIL apply lock timeout: $1 (expected [$3], got [$2])"; fail=1; fi; }
ms() { echo $(( ($(date +%s%N) - $1) / 1000000 )); }
outA="$(mktemp)"; outB="$(mktemp)"; outC="$(mktemp)"
trap 'rm -f "$outA" "$outB" "$outC"' EXIT

try() {
  local file=$1 table=$2 role=${3:-anon}
  set +e
  q >"$outA" 2>&1 <<SQL &
BEGIN;
SELECT count(*) FROM public.$table;
SELECT pg_sleep(12);
COMMIT;
SQL
  local pidA=$!
  sleep 1
  local t0; t0=$(date +%s%N)
  PGOPTIONS="--client-min-messages=warning" psql -X -q -v ON_ERROR_STOP=1 -U "$owner" -d "$db" -f "$mig/$file" >/dev/null 2>"$outB" &
  local pidB=$!
  sleep 0.5
  local t1; t1=$(date +%s%N)
  q >"$outC" 2>&1 <<SQL
SET ROLE $role;
SET statement_timeout = 9000;
SELECT count(*) >= 0 FROM public.$table;
SQL
  local rcC=$? msC; msC=$(ms "$t1")
  wait $pidB; local rcB=$? msB; msB=$(ms "$t0")
  wait $pidA; local rcA=$?
  set -e
  local short=${file%%_*}
  check "$short behind a 12 s read of $table: refused" "$rcB" "3"
  check "$short: ... with lock timeout" "$(grep -c 'canceling statement due to lock timeout' "$outB")" "1"
  check "$short: ... in under 9 s" "$([ "$msB" -lt 9000 ] && echo yes || echo "no ($msB ms)")" "yes"
  check "$short: the app's read of $table queued behind it still answers" "$rcC/$(tail -1 "$outC")" "0/t"
  check "$short: ... in under 8 s" "$([ "$msC" -lt 8000 ] && echo yes || echo "no ($msC ms)")" "yes"
  check "$short: the long read is never disturbed" "$rcA" "0"
  [ $fail = 0 ] || { echo "--- apply said:"; cat "$outB"; echo "--- app read said:"; cat "$outC"; }
}

try 20261021100000_twob_prior_month_simple.sql filing_status
if [ "$(q -c "SELECT to_regclass('public.filing_status_log') IS NOT NULL")" = t ]; then
  try 20261021110000_filing_status_pull_only.sql filing_status
fi
if [ "$(q -c "SELECT to_regclass('public.reco_opening_log') IS NOT NULL")" = t ]; then
  try 20261021120000_reco_pull_push_gate.sql suspended_reco
fi
if [ "$(q -c "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'builder_bu_confirm_codes' AND column_name = 'typed_elsewhere_at'")" = 1 ]; then
  try 20261021160000_bu_confirm_followup.sql builder_bu_confirm_codes service_role
fi
exit $fail
