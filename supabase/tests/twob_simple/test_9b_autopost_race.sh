#!/usr/bin/env bash
# Import 2B's write-through (20261021170000, docs §15) when two users save the
# same month at the same moment (two sessions as anon, as PostgREST runs two
# browsers):
#  1. both save the same books row: the second waits for the first, then
#     finds the entry the first posted and changes it: one entry, never two;
#  2. each saves another books row: both post, one entry each, one version;
#  3. two catch-ups of the same month out of step: the second finds nothing
#     left to do; every source posted once;
#  4. a reclaim committed while a save would take its entry back: the save
#     waits, sees the reclaim and is refused; the entry stays, reclaimed;
#  5. the month marked Filed while a save of it waits (filing holds the
#     client's lock): the save is refused, nothing of it kept, and the filed
#     month's ledger is as filing left it.
# Run by run.sh with TWOB_TEST_DB set.
set -euo pipefail
db="$TWOB_TEST_DB"
q() { PGOPTIONS="--client-min-messages=warning" psql -X -At -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
C='9b000000-0000-0000-0000-000000000001'
X='9b000000-0000-0000-0000-0000000000b1'
Y='9b000000-0000-0000-0000-0000000000b2'
Z='9b000000-0000-0000-0000-0000000000b3'
q >/dev/null <<SQL
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES ('$C', 'AP RACE', '24APRAC0000A1Z5');
INSERT INTO public.books_register (id, client_id, period_month, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, book_treatment, doc_type) VALUES
  ('$X', '$C', '10/2026', 'RACE X', 'X/1', '24RACEX0000A1Z5', 100, 9, 9, 'NOT_IN_2B', 'INVOICE'),
  ('$Y', '$C', '10/2026', 'RACE Y', 'Y/1', '24RACEY0000A1Z5', 200, 18, 18, 'NOT_IN_2B', 'INVOICE');
SQL
as_user='SET ROLE anon;
SELECT set_config('"'"'request.jwt.claims'"'"', '"'"'{"role":"anon"}'"'"', false);
SELECT set_config('"'"'request.headers'"'"', '"'"'{"x-gst-actor":"00000000-0000-0000-0000-0000000000a2"}'"'"', false);'
outA="$(mktemp)"; outB="$(mktemp)"
trap 'rm -f "$outA" "$outB"' EXIT
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   autopost race: $1"; else echo "FAIL autopost race: $1 (expected [$3], got [$2])"; fail=1; fi; }

# 1. The same books row.
q >"$outA" 2>&1 <<SQL &
$as_user
BEGIN;
UPDATE public.books_register SET date = '2026-10-05' WHERE id = '$X';
SELECT pg_sleep(1.5);
COMMIT;
SQL
pidA=$!
sleep 0.5
q >"$outB" 2>&1 <<SQL
$as_user
UPDATE public.books_register SET date = '2026-10-05', input_cgst = 10, input_sgst = 10 WHERE id = '$X';
SQL
wait $pidA
check "1: the same books row saved twice at once: one entry" \
  "$(q -c "SELECT count(*) || ':' || min(input_cgst) FROM public.bills_not_in_2b WHERE source_book_id = '$X'")" "1:10.00"

# 2. Two books rows of the month.
q >"$outA" 2>&1 <<SQL &
$as_user
BEGIN;
UPDATE public.books_register SET input_cgst = 11 WHERE id = '$X';
SELECT pg_sleep(1.5);
COMMIT;
SQL
pidA=$!
sleep 0.5
q >"$outB" 2>&1 <<SQL
$as_user
UPDATE public.books_register SET date = '2026-10-06' WHERE id = '$Y';
SQL
wait $pidA
check "2: two rows saved at once: both posted, one entry each" \
  "$(q -c "SELECT string_agg(supplier_name || ':' || input_cgst, ',' ORDER BY supplier_name) FROM public.bills_not_in_2b WHERE client_id = '$C'")" "RACE X:11.00,RACE Y:18.00"
check "2: ... one version of the month, current" \
  "$(q -c "SELECT count(*) || ':' || count(*) FILTER (WHERE is_current) FROM public.twob_versions WHERE client_id = '$C' AND period_month = '10/2026'")" "1:1"

# 3. Two catch-ups of a month out of step.
q >/dev/null <<SQL
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, book_treatment, doc_type)
SELECT gen_random_uuid(), '$C', '11/2026', date '2026-11-01' + (g % 28), 'LATE ' || g, 'L/' || g, '24LATEE0000A1Z5', 100, 9, 9, 'NOT_IN_2B', 'INVOICE' FROM generate_series(1, 50) g;
SQL
q >"$outA" 2>&1 <<SQL &
$as_user
BEGIN;
SELECT public.twob_import2b_catch_up(public.t_manager(), '$C', '11/2026', false) ->> 'written';
SELECT pg_sleep(1.5);
COMMIT;
SQL
pidA=$!
sleep 0.5
q >"$outB" 2>&1 <<SQL
$as_user
SELECT public.twob_import2b_catch_up(public.t_manager(), '$C', '11/2026', false) ->> 'written';
SQL
wait $pidA
check "3: the first catch-up writes 50" "$(grep -c '^50$' "$outA")" "1"
check "3: the second, waiting for it, finds nothing left" "$(grep -c '^0$' "$outB")" "1"
check "3: every books row posted once" \
  "$(q -c "SELECT count(*) || ':' || count(DISTINCT source_book_id) FROM public.bills_not_in_2b WHERE client_id = '$C' AND period_month = '11/2026'")" "50:50"

# 4. A reclaim committed while a save would take its entry back.
q >"$outA" 2>&1 <<SQL &
$as_user
BEGIN;
UPDATE public.bills_not_in_2b SET reclaim_month = 'Oct 26' WHERE source_book_id = '$Y';
SELECT pg_sleep(1.5);
COMMIT;
SQL
pidA=$!
sleep 0.5
set +e
q >"$outB" 2>&1 <<SQL
$as_user
UPDATE public.books_register SET book_treatment = 'NOT_ELIGIBLE' WHERE id = '$Y';
SQL
rcB=$?
set -e
wait $pidA
check "4: the save that would take back the entry is refused" "$rcB" "3"
check "4: ... naming the reclaim saved meanwhile" "$(grep -c 'RACE Y Y/1: Oct-26 has reclaimed this entry; undo that reclaim first' "$outB")" "1"
check "4: the entry is still there, reclaimed; the books row still Not in 2B" \
  "$(q -c "SELECT (SELECT count(*) FROM public.bills_not_in_2b WHERE source_book_id = '$Y' AND reclaim_month = 'Oct 26') || ':' || (SELECT book_treatment FROM public.books_register WHERE id = '$Y')")" "1:NOT_IN_2B"

# 5. The month marked Filed while a save of it waits.
W='9b000000-0000-0000-0000-0000000000b4'
q >/dev/null <<SQL
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, book_treatment, doc_type)
VALUES ('$W', '$C', '12/2026', '2026-12-05', 'RACE W', 'W/1', '24RACEW0000A1Z5', 300, 27, 27, 'NOT_ELIGIBLE', 'INVOICE');
INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES ('$C', 'GSTR-3B', '12/2026', 'Prepared');
SQL
q >"$outA" 2>&1 <<SQL &
$as_user
BEGIN;
UPDATE public.filing_status SET status = 'Filed', arn = 'AA2412260000095' WHERE client_id = '$C' AND period_month = '12/2026';
SELECT pg_sleep(1.5);
COMMIT;
SQL
pidA=$!
sleep 0.5
set +e
q >"$outB" 2>&1 <<SQL
$as_user
UPDATE public.books_register SET book_treatment = 'NOT_IN_2B' WHERE id = '$W';
SQL
rcB=$?
set -e
wait $pidA
check "5: a save waiting while its month is marked Filed is refused" "$rcB" "3"
check "5: ... saying so" "$(grep -c 'Not saved: Dec-26 was just marked filed. Reload the page.' "$outB")" "1"
check "5: nothing of it kept: the books row as it was, no entry" \
  "$(q -c "SELECT (SELECT book_treatment FROM public.books_register WHERE id = '$W') || ':' || (SELECT count(*) FROM public.bills_not_in_2b WHERE source_book_id = '$W') || ':' || public.twob_month_is_prior('$C', '12/2026')")" "NOT_ELIGIBLE:0:true"
[ $fail = 0 ] || { echo "--- session A said:"; cat "$outA"; echo "--- session B said:"; cat "$outB"; }
exit $fail
