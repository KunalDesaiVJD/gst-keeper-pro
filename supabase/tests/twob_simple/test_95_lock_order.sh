#!/usr/bin/env bash
# Round 2, Q5 (low): the prior-month door and filing a later month never
# deadlock. Every writer of the 2B lists takes the client's lock before any
# row lock: the door, Re-run and the carry did already; marking a GSTR-3B
# Filed now does too, before it locks the month's rows. Session A (anon)
# holds the client's lock, as the door does while it works, then removes T-1
# in filed July (reaching September's copy). Session B (anon) marks September
# Filed meanwhile. Before the fix B locked September's rows first and then
# waited for the client's lock, while A waited for those rows: a deadlock.
# Run by run.sh with TWOB_TEST_DB set.
set -euo pipefail
db="$TWOB_TEST_DB"
q() { PGOPTIONS="--client-min-messages=warning" psql -X -At -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
T='95000000-0000-0000-0000-000000000001'
q -c "SELECT public.t_make_tamnna('$T', 'Lock order')" >/dev/null
t1=$(q -c "SELECT id FROM public.bills_not_in_2b WHERE client_id = '$T' AND period_month = '07/2026' AND supplier_invoice_number = 'T-1'")
outA="$(mktemp)"; outB="$(mktemp)"
trap 'rm -f "$outA" "$outB"' EXIT
set +e
q >"$outA" 2>&1 <<SQL &
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('twob:$T', 0));
SELECT pg_sleep(1.5);
SELECT public.twob_prior_books_apply(public.t_manager(), '$T', '07/2026', '[{"table": "bills_not_in_2b", "op": "delete", "id": "$t1"}]'::jsonb, false) ->> 'ok';
COMMIT;
SQL
pidA=$!
sleep 0.5
q >"$outB" 2>&1 <<SQL
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
UPDATE public.filing_status SET status = 'Filed', arn = 'AA2409260000095' WHERE client_id = '$T' AND period_month = '09/2026';
SQL
rcB=$?
wait $pidA
rcA=$?
set -e
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   lock order: $1"; else echo "FAIL lock order: $1 (expected [$3], got [$2])"; fail=1; fi; }
check "the GST Manager's removal in July goes through" "$rcA" "0"
check "marking September Filed meanwhile goes through" "$rcB" "0"
check "no deadlock" "$(cat "$outA" "$outB" | grep -c 'deadlock detected')" "0"
check "T-1 is gone from July, August and September" \
  "$(q -c "SELECT count(*) FROM public.bills_not_in_2b WHERE client_id = '$T' AND supplier_invoice_number = 'T-1'")" "0"
check "September's filing carried what September then held into October (T-2 only)" \
  "$(q -c "SELECT string_agg(supplier_invoice_number, ',') FROM public.bills_not_in_2b WHERE client_id = '$T' AND period_month = '10/2026'")" "T-2"
[ $fail = 0 ] || { echo "--- session A said:"; cat "$outA"; echo "--- session B said:"; cat "$outB"; }
exit $fail
