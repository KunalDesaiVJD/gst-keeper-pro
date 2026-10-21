#!/usr/bin/env bash
# Integration round (21 Oct 2026, low): "Filed by mistake" racing a pull that
# files the month. twob_reopen_filed used to check the status before it took
# the client's lock, so a pull committing while it waited left the month
# Filed (with its ARN) and reopened, open to every staff member until some
# later write re-fired the record trigger. It now takes the client's lock
# first (the one auto_lock_on_filed takes while the pull files the month) and
# reads the rows after it. July was taken off Filed (no ARN); session X holds
# the client's lock, as a long door call would; session A files July (the
# extension's pull where 20261021110000 is in, a status write otherwise) and
# waits on that lock; session B, a GST Manager's reopen, waits behind A. Then
# the other order: B queued before A reopens July, and A's filing records it
# as filed again. Either way a Filed month is prior. Run by run.sh with
# TWOB_TEST_DB set.
set -euo pipefail
db="$TWOB_TEST_DB"
q() { PGOPTIONS="--client-min-messages=warning" psql -X -At -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
combined=$(q -c "SELECT to_regprocedure('public.filing_record_pull(uuid,text,text,text,date,text,text,uuid,jsonb)') IS NOT NULL")
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   reopen race: $1"; else echo "FAIL reopen race: $1 (expected [$3], got [$2])"; fail=1; fi; }

# One client, July recorded as filed and taken off Filed (no ARN).
setup() {
  local c=$1 g=$2
  q >/dev/null <<SQL
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES ('$c', 'Reopen race', '$g');
INSERT INTO public.bills_not_in_2b (client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, reversal_month)
VALUES ('$c', '07/2026', '2026-07-05', 'SUPPLIER A', 'A-1', '24AAAAA0000A1Z5', 1000, 180, 'Jul 26');
SELECT set_config('twob.write', '', false);
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES ('$c', 'GSTR-3B', '07/2026', 'Filed');
UPDATE public.filing_status SET status = 'Prepared', is_locked = false, filed_date = NULL WHERE client_id = '$c' AND period_month = '07/2026';
SQL
}
# Files July: the extension's pull when the filing migration is in.
file_july() {
  local c=$1 arn=$2
  if [ "$combined" = t ]; then
    echo "SELECT public.filing_record_pull('$c', 'GSTR-3B', '07/2026', '$arn', '2026-08-20', NULL, NULL, public.t_manager(), '{}') ->> 'outcome';"
  else
    echo "UPDATE public.filing_status SET status = 'Filed', arn = '$arn' WHERE client_id = '$c' AND period_month = '07/2026';"
  fi
}
hold() {
  q >/dev/null 2>&1 <<SQL
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('twob:$1', 0));
SELECT pg_sleep(2);
COMMIT;
SQL
}
reopen() {
  q 2>&1 <<SQL
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT public.twob_reopen_filed(public.t_manager(), '$1', 'GSTR-3B', '07/2026', 'Filed by mistake') ->> 'is_prior';
SQL
}
state() {
  q -c "SELECT (SELECT status::text FROM public.filing_status WHERE client_id = '$1' AND period_month = '07/2026') || ' prior=' || public.twob_month_is_prior('$1', '07/2026')
          || ' reopened=' || (SELECT (reopened_at IS NOT NULL)::text FROM public.twob_ever_filed WHERE client_id = '$1' AND return_type = 'GSTR-3B' AND period_month = '07/2026')"
}
outA="$(mktemp)"; outB="$(mktemp)"
trap 'rm -f "$outA" "$outB"' EXIT

# Order 1: the pull queues first, the reopen behind it.
C1='96000000-0000-0000-0000-000000000001'
setup "$C1" '24RACEA0000A1Z5'
set +e
hold "$C1" & pidX=$!
sleep 0.4
{ echo "SET ROLE anon;"; echo "SELECT set_config('request.jwt.claims', '{\"role\":\"anon\"}', false);"; file_july "$C1" 'AA2407260000096'; } | q >"$outA" 2>&1 & pidA=$!
sleep 0.6
reopen "$C1" >"$outB" 2>&1 & pidB=$!
wait $pidX; wait $pidA; rcA=$?; wait $pidB; rcB=$?
set -e
check "pull first: the pull files July" "$rcA" "0"
check "pull first: the reopen, waiting behind it, sees Filed and is refused" "$(grep -c 'Its status is still Filed' "$outB")" "1"
check "pull first: July is Filed, prior and not reopened" "$(state "$C1")" "Filed prior=true reopened=false"
check "pull first: no deadlock" "$(cat "$outA" "$outB" | grep -c 'deadlock detected')" "0"
[ $fail = 0 ] || { echo "--- pull said:"; cat "$outA"; echo "--- reopen said:"; cat "$outB"; }

# Order 2: the reopen queues first; the pull then files July again.
C2='96000000-0000-0000-0000-000000000002'
setup "$C2" '24RACEB0000A1Z5'
set +e
hold "$C2" & pidX=$!
sleep 0.4
reopen "$C2" >"$outB" 2>&1 & pidB=$!
sleep 0.6
{ echo "SET ROLE anon;"; echo "SELECT set_config('request.jwt.claims', '{\"role\":\"anon\"}', false);"; file_july "$C2" 'AA2407260000097'; } | q >"$outA" 2>&1 & pidA=$!
wait $pidX; wait $pidB; rcB=$?; wait $pidA; rcA=$?
set -e
check "reopen first: the reopen goes through" "$rcB" "0"
check "reopen first: the pull files July after it" "$rcA" "0"
check "reopen first: July is Filed and prior again (recorded as filed again)" "$(state "$C2")" "Filed prior=true reopened=false"
check "reopen first: no deadlock" "$(cat "$outA" "$outB" | grep -c 'deadlock detected')" "0"
[ $fail = 0 ] || { echo "--- pull said:"; cat "$outA"; echo "--- reopen said:"; cat "$outB"; }
exit $fail
