#!/usr/bin/env bash
# R3 / R14 (medium): a reclaim committed while a prior-month removal runs is
# never lost. Session A (anon) reclaims September's copy of T-1 and holds the
# transaction open; session B (anon, the GST Manager's id) removes T-1 in
# filed July through the door a moment later. B waits for A's row lock, then
# sees the reclaim and is refused; September's copy stays, reclaimed.
# Run by run.sh with TWOB_TEST_DB set.
set -euo pipefail
db="$TWOB_TEST_DB"
q() { PGOPTIONS="--client-min-messages=warning" psql -X -At -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
T='75000000-0000-0000-0000-000000000001'
q -c "SELECT public.t_make_tamnna('$T', 'Race')" >/dev/null
t1=$(q -c "SELECT id FROM public.bills_not_in_2b WHERE client_id = '$T' AND period_month = '07/2026' AND supplier_invoice_number = 'T-1'")
outA="$(mktemp)"; outB="$(mktemp)"
trap 'rm -f "$outA" "$outB"' EXIT
q >"$outA" 2>&1 <<SQL &
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
BEGIN;
UPDATE public.bills_not_in_2b SET reclaim_month = 'Sep 26' WHERE client_id = '$T' AND period_month = '09/2026' AND supplier_invoice_number = 'T-1';
SELECT pg_sleep(2);
COMMIT;
SQL
pidA=$!
sleep 0.7
set +e
q >"$outB" 2>&1 <<SQL
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.twob_prior_books_apply(public.t_manager(), '$T', '07/2026', '[{"table": "bills_not_in_2b", "op": "delete", "id": "$t1"}]'::jsonb, false);
SQL
rcB=$?
set -e
wait $pidA
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   race: $1"; else echo "FAIL race: $1 (expected [$3], got [$2])"; fail=1; fi; }
check "the removal is refused" "$rcB" "3"
check "with September's reclaim named" "$(grep -c 'Sep-26 has reclaimed this entry; undo that reclaim first' "$outB")" "1"
check "September's copy of T-1 is still there, reclaimed" \
  "$(q -c "SELECT count(*) FROM public.bills_not_in_2b WHERE client_id = '$T' AND period_month = '09/2026' AND supplier_invoice_number = 'T-1' AND reclaim_month = 'Sep 26'")" "1"
check "July's T-1 is still there" \
  "$(q -c "SELECT count(*) FROM public.bills_not_in_2b WHERE client_id = '$T' AND supplier_invoice_number = 'T-1'")" "3"
[ $fail = 0 ] || { echo "--- session B said:"; cat "$outB"; }
exit $fail
