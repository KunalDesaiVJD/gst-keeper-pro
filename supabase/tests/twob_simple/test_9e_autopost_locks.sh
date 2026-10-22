#!/usr/bin/env bash
# Import 2B's write-through (20261021170000, docs §15): the calls that take
# the client's lock first (Delete 2B, Clear Data) against a save running at
# the same moment, which takes its row's lock first and the client's lock
# after it, in its write-through. Two sessions as anon, as PostgREST runs two
# browsers. Before the fix each pair deadlocked (PostgreSQL aborted one of
# them with "deadlock detected"); now the call that came second to its rows
# stops at once with a plain message, and the save goes through:
#  1. a treatment saved while Delete 2B of the month runs;
#  2. a books row deleted while Clear Data of the month runs.
# Run by run.sh with TWOB_TEST_DB set.
set -euo pipefail
db="$TWOB_TEST_DB"
q() { PGOPTIONS="--client-min-messages=warning" psql -X -At -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
C='9e000000-0000-0000-0000-000000000001'
DOC='9e000000-0000-0000-0000-0000000000d1'
BK='9e000000-0000-0000-0000-0000000000b1'
q >/dev/null <<SQL
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES ('$C', 'AP LOCKS', '24APLOC0000A1Z5');
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, doc_type, itc_action)
VALUES ('$DOC', '$C', '09/2026', '2026-09-03', 'LOCK DOC', 'LD/1', '24LOCKD0000A1Z5', 100, 18, 'INVOICE', 'MATCHED');
SQL
as_user='SET ROLE anon;
SELECT set_config('"'"'request.jwt.claims'"'"', '"'"'{"role":"anon"}'"'"', false);
SELECT set_config('"'"'request.headers'"'"', '"'"'{"x-gst-actor":"00000000-0000-0000-0000-0000000000a2"}'"'"', false);'
outA="$(mktemp)"; outB="$(mktemp)"
trap 'rm -f "$outA" "$outB"' EXIT
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   autopost locks: $1"; else echo "FAIL autopost locks: $1 (expected [$3], got [$2])"; fail=1; fi; }

# 1. Delete 2B while a treatment save of the month waits for the client's
#    lock (session B stands in for Delete 2B's own first step, the client's
#    lock, and then calls it, as the finding's repro did).
set +e
q >"$outB" 2>&1 <<SQL &
$as_user
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('twob:$C', 0));
SELECT pg_sleep(1.5);
SELECT public.twob_import2b_delete_2b(public.t_manager(), '$C', '09/2026');
COMMIT;
SQL
pidB=$!
sleep 0.5
q >"$outA" 2>&1 <<SQL
$as_user
UPDATE public.twob_import_docs SET itc_action = 'NOT_IN_BOOKS' WHERE id = '$DOC';
SQL
rcA=$?
wait $pidB
rcB=$?
set -e
check "1: no deadlock" "$(cat "$outA" "$outB" | grep -c 'deadlock detected')" "0"
check "1: Delete 2B stops at once, saying the month is being saved" "$rcB:$(grep -c 'Nothing was changed: Sep-26 of this client is being saved by someone else right now. Try again in a moment.' "$outB")" "3:1"
check "1: the save goes through, with its entry" "$rcA:$(q -c "SELECT (SELECT itc_action FROM public.twob_import_docs WHERE id = '$DOC') || ':' || (SELECT count(*) FROM public.bills_not_in_books WHERE source_doc_id = '$DOC')")" "0:NOT_IN_BOOKS:1"
check "1: Delete 2B again, nothing running: done" "$(q -c "$as_user SELECT public.twob_import2b_delete_2b(public.t_manager(), '$C', '09/2026') ->> 'deleted'" | tail -1)" "1"

# 2. Clear Data while a books row of the month is being deleted (its
#    write-through waits for the client's lock holding the row's).
q >/dev/null <<SQL
$as_user
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_cgst, input_sgst, book_treatment, doc_type)
VALUES ('$BK', '$C', '09/2026', '2026-09-04', 'LOCK BOOK', 'LB/1', '24LOCKB0000A1Z5', 100, 9, 9, 'NOT_IN_2B', 'INVOICE');
SQL
set +e
q >"$outB" 2>&1 <<SQL &
$as_user
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('twob:$C', 0));
SELECT pg_sleep(1.5);
SELECT public.twob_clear_year(public.t_manager(), '$C', ARRAY['09/2026']);
COMMIT;
SQL
pidB=$!
sleep 0.5
q >"$outA" 2>&1 <<SQL
$as_user
DELETE FROM public.books_register WHERE id = '$BK';
SQL
rcA=$?
wait $pidB
rcB=$?
set -e
check "2: no deadlock" "$(cat "$outA" "$outB" | grep -c 'deadlock detected')" "0"
check "2: Clear Data stops at once, saying the month is being saved" "$rcB:$(grep -c 'Nothing was changed: Sep-26 of this client is being saved by someone else right now.' "$outB")" "3:1"
check "2: the books row is deleted, and its entry with it" "$rcA:$(q -c "SELECT (SELECT count(*) FROM public.books_register WHERE id = '$BK') || ':' || (SELECT count(*) FROM public.bills_not_in_2b WHERE client_id = '$C')")" "0:0:0"
[ $fail = 0 ] || { echo "--- session A said:"; cat "$outA"; echo "--- session B said:"; cat "$outB"; }
exit $fail
