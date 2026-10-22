#!/usr/bin/env bash
# One reclaim per 2B document, and only with a Reclaim document, when two
# sessions write at the same moment (20261021170000, verification round 6;
# docs §15), as live stands: no unique index (a filed month's pair recorded
# before keeps it from being made), so the trigger trg_twob_zz_reclaim_via_one
# alone holds it. Two sessions as anon, as PostgREST runs two browsers:
#  1. two tabs of the app of before reclaim two entries with one Reclaim
#     document at once: the second waits for the first, sees its reclaim and
#     is refused; one entry reclaimed with it;
#  2. a document taken out of Reclaim (twob_import2b_unreclaim) while another
#     tab names it: the naming waits, sees it Matched and is refused;
#  3. the other way round: the naming first, the way out of Reclaim waiting
#     for it, then releasing it with the document: no entry is left naming a
#     document that is not Reclaim.
# Run by run.sh with TWOB_TEST_DB set.
set -euo pipefail
db="$TWOB_TEST_DB"
q() { PGOPTIONS="--client-min-messages=warning" psql -X -At -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
C='6f000000-0000-0000-0000-000000000001'
D='6f000000-0000-0000-0000-0000000000d1'
D2='6f000000-0000-0000-0000-0000000000d2'
E1='6f000000-0000-0000-0000-0000000000e1'
E2='6f000000-0000-0000-0000-0000000000e2'
E3='6f000000-0000-0000-0000-0000000000e3'
E4='6f000000-0000-0000-0000-0000000000e4'
had_index="$(q -c "SELECT count(*) FROM pg_indexes WHERE indexname = 'bills_not_in_2b_reclaimed_via_uq'")"
q >/dev/null <<SQL
DROP INDEX IF EXISTS public.bills_not_in_2b_reclaimed_via_uq;
CREATE INDEX IF NOT EXISTS idx_bills_not_in_2b_reclaimed_via_doc_id
  ON public.bills_not_in_2b (reclaimed_via_doc_id) WHERE reclaimed_via_doc_id IS NOT NULL;
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES ('$C', 'R6 RACE', '24RSIXR0000A1Z5');
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action) VALUES
  ('$D', '$C', '10/2026', '2026-10-01', 'RACE', 'R-1', '24RACEE0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'RECLAIM'),
  ('$D2', '$C', '10/2026', '2026-10-02', 'RACE', 'R-2', '24RACEE0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'RECLAIM');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('$E1', '$C', '10/2026', '2026-10-01', 'RACE', 'R-1', '24RACEE0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false),
  ('$E2', '$C', '10/2026', '2026-10-01', 'RACE', 'R-1B', '24RACEE0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false),
  ('$E3', '$C', '10/2026', '2026-10-02', 'RACE', 'R-2', '24RACEE0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false),
  ('$E4', '$C', '10/2026', '2026-10-02', 'RACE', 'R-2B', '24RACEE0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false);
SQL
as_user='SET ROLE anon;
SELECT set_config('"'"'request.jwt.claims'"'"', '"'"'{"role":"anon"}'"'"', false);
SELECT set_config('"'"'request.headers'"'"', '"'"'{"x-gst-actor":"00000000-0000-0000-0000-0000000000a4"}'"'"', false);'
outA="$(mktemp)"; outB="$(mktemp)"
cleanup() {
  rm -f "$outA" "$outB"
  q >/dev/null <<SQL || true
DELETE FROM public.clients WHERE id = '$C';
SQL
  if [ "$had_index" = "1" ]; then
    q >/dev/null <<SQL || true
CREATE UNIQUE INDEX IF NOT EXISTS bills_not_in_2b_reclaimed_via_uq
  ON public.bills_not_in_2b (reclaimed_via_doc_id) WHERE reclaimed_via_doc_id IS NOT NULL;
DROP INDEX IF EXISTS public.idx_bills_not_in_2b_reclaimed_via_doc_id;
SQL
  fi
}
trap cleanup EXIT
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   reclaim race: $1"; else echo "FAIL reclaim race: $1 (expected [$3], got [$2])"; fail=1; fi; }

# 1. Two tabs name one document at once.
q >"$outA" 2>&1 <<SQL &
$as_user
BEGIN;
UPDATE public.bills_not_in_2b SET reclaim_month = 'Oct 26', reclaimed_via_doc_id = '$D' WHERE id = '$E1';
SELECT pg_sleep(1.5);
COMMIT;
SQL
pidA=$!
sleep 0.5
q >"$outB" 2>&1 <<SQL || true
$as_user
UPDATE public.bills_not_in_2b SET reclaim_month = 'Oct 26', reclaimed_via_doc_id = '$D' WHERE id = '$E2';
SQL
wait $pidA
check "1: two entries reclaimed with one document at once: one reclaim" \
  "$(q -c "SELECT count(*) || ':' || min(supplier_invoice_number) FROM public.bills_not_in_2b WHERE reclaimed_via_doc_id = '$D'")" "1:R-1"
check "1: ... the second waited, then was refused saying which entry the document evidences" \
  "$(grep -c 'is already the evidence of the reclaim of RACE R-1' "$outB" || true)" "1"

# 2. Out of Reclaim while another tab names the document.
q >"$outA" 2>&1 <<SQL &
$as_user
BEGIN;
SELECT public.twob_import2b_unreclaim('00000000-0000-0000-0000-0000000000a4', '$C', '10/2026', '$D2', 'MATCHED', NULL);
SELECT pg_sleep(1.5);
COMMIT;
SQL
pidA=$!
sleep 0.5
q >"$outB" 2>&1 <<SQL || true
$as_user
UPDATE public.bills_not_in_2b SET reclaim_month = 'Oct 26', reclaimed_via_doc_id = '$D2' WHERE id = '$E3';
SQL
wait $pidA
check "2: a document taken out of Reclaim while a tab names it: the naming is refused" \
  "$(q -c "SELECT d.itc_action || ':' || (SELECT count(*) FROM public.bills_not_in_2b t WHERE t.reclaimed_via_doc_id = d.id) FROM public.twob_import_docs d WHERE d.id = '$D2'")" "MATCHED:0"
check "2: ... saying the document is Matched, not Reclaim" \
  "$(grep -c 'is Matched on Import 2B, not Reclaim' "$outB" || true)" "1"

# 3. The naming first, the way out of Reclaim waiting for it.
q >/dev/null <<SQL
SELECT set_config('twob.write', 'system', false);
UPDATE public.twob_import_docs SET itc_action = 'RECLAIM' WHERE id = '$D2';
SQL
q >"$outA" 2>&1 <<SQL &
$as_user
BEGIN;
UPDATE public.bills_not_in_2b SET reclaim_month = 'Oct 26', reclaimed_via_doc_id = '$D2' WHERE id = '$E4';
SELECT pg_sleep(1.5);
COMMIT;
SQL
pidA=$!
sleep 0.5
q >"$outB" 2>&1 <<SQL || true
$as_user
SELECT public.twob_import2b_unreclaim('00000000-0000-0000-0000-0000000000a4', '$C', '10/2026', '$D2', 'MATCHED', '$E4') ->> 'released';
SQL
wait $pidA
check "3: the way out of Reclaim waits for the naming, then releases it with the document" \
  "$(q -c "SELECT d.itc_action || ':' || (SELECT count(*) FROM public.bills_not_in_2b t WHERE t.reclaimed_via_doc_id = d.id) || ':' || (SELECT COALESCE(reclaim_month, '-') FROM public.bills_not_in_2b WHERE id = '$E4') FROM public.twob_import_docs d WHERE d.id = '$D2'")" "MATCHED:0:-"
check "3: ... no entry names a document that is not Reclaim" \
  "$(q -c "SELECT count(*) FROM public.bills_not_in_2b t JOIN public.twob_import_docs d ON d.id = t.reclaimed_via_doc_id WHERE t.client_id = '$C' AND d.itc_action <> 'RECLAIM'")" "0"

exit $fail
