#!/usr/bin/env bash
# 2B Reconciliation's Restore while Import 2B takes the document a version's
# reclaim names out of Reclaim (20261021170000, verification round 7; docs
# §15). Two sessions as anon, as PostgREST runs two browsers:
#  1. the superadmin's Restore of a version (padded, so it runs a few
#     seconds) whose reclaim names document DL-1 has taken the client's lock;
#     the poster's Save of DL-1 out of Reclaim (twob_import2b_unreclaim)
#     starts then. Before this round Restore took the client's lock first and
#     the document only as it named it, while the Save holds the document and
#     waits for the client's lock: a deadlock, one of the two rolled back
#     (the superadmin's Restore, in the verifier's run). Now Restore takes
#     the month's Reclaim documents before the client's lock (the order every
#     writer of a reclaim takes them in): the Save waits for the Restore,
#     then takes the restored reclaim out with the document;
#  2. the other way round (the Save first, the Restore while it runs): the
#     Restore waits for it, then brings the reclaim back in Awaiting reclaim
#     (its document Matched now), named;
#  3. (verification round 8) the poster deletes, on Import 2B, the books row
#     that posted one of the version's entries while the Restore runs. The
#     delete holds the row, then waits for the client's lock in its
#     write-through; the Restore's key check of the entry's link waited for
#     the row: a deadlock, the Restore rolled back. Now the Restore takes the
#     month's books rows and documents (FOR KEY SHARE) without waiting once
#     it holds the client's lock: the delete, starting after, waits for it,
#     then takes the restored entry off the ledger (one running at that very
#     moment stops the Restore with a plain message instead);
#  4. the same with a 2B document deleted (a re-import's documents no longer
#     in the file) whose Not in Books entry the version holds.
# Run by run.sh with TWOB_TEST_DB set.
set -euo pipefail
db="$TWOB_TEST_DB"
q() { PGOPTIONS="--client-min-messages=warning" psql -X -At -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
C='7f000000-0000-0000-0000-000000000001'
D='7f000000-0000-0000-0000-0000000000d1'
E='7f000000-0000-0000-0000-0000000000e1'
SUPER='00000000-0000-0000-0000-0000000000a1'
POSTER='00000000-0000-0000-0000-0000000000a4'
PAD="${PAD:-6000}"
as_user() {
  printf "SET ROLE anon;\nSELECT set_config('request.jwt.claims', '{\"role\":\"anon\"}', false);\nSELECT set_config('request.headers', '{\"x-gst-actor\":\"%s\",\"x-gst-source\":\"app\"}', false);\n" "$1"
}
outA="$(mktemp)"; outB="$(mktemp)"
cleanup() {
  rm -f "$outA" "$outB"
  q >/dev/null <<SQL || true
DELETE FROM public.clients WHERE id = '$C';
DROP TABLE IF EXISTS public.t7m_version;
DROP FUNCTION IF EXISTS public.t7m_unreclaim(uuid, uuid, uuid, text, uuid);
SQL
}
trap cleanup EXIT
# Import 2B's Save out of Reclaim as the page sends it (with the reclaim it
# shows; on the code of before this round, as that page sent it).
q >/dev/null <<'SQL'
CREATE OR REPLACE FUNCTION public.t7m_unreclaim(p_actor uuid, p_client uuid, p_doc uuid, p_action text, p_expect uuid) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
BEGIN
  IF to_regprocedure('public.twob_import2b_unreclaim(uuid, uuid, text, uuid, text, uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT public.twob_import2b_unreclaim($1, $2, ''10/2026'', $3, $4, $5)' INTO v USING p_actor, p_client, p_doc, p_action, p_expect;
  ELSE
    EXECUTE 'SELECT public.twob_import2b_unreclaim($1, $2, ''10/2026'', $3, $4)' INTO v USING p_actor, p_client, p_doc, p_action;
  END IF;
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION public.t7m_unreclaim(uuid, uuid, uuid, text, uuid) TO anon;
SQL
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   restore lock order: $1"; else echo "FAIL restore lock order: $1 (expected [$3], got [$2])"; fail=1; fi; }

# The month: DL-1 Matched, its pending entry DL-1, reclaimed with it
# (Import 2B's one call); a version holding that reclaim, padded with
# PAD entries typed on 2B Reconciliation (no document), DL-1 last.
setup() {
  q >/dev/null <<SQL
DELETE FROM public.clients WHERE id = '$C';
DROP TABLE IF EXISTS public.t7m_version;
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES ('$C', 'R7 RESTORE LOCK ORDER', '24RSEVM0000A1Z5');
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action) VALUES
  ('$D', '$C', '10/2026', '2026-10-01', 'DELTA', 'DL-1', '24DELTA0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'MATCHED');
INSERT INTO public.bills_not_in_2b (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, reversal_month, is_carried_forward) VALUES
  ('$E', '$C', '10/2026', '2026-10-01', 'DELTA', 'DL-1', '24DELTA0000A1Z5', 1000, 0, 90, 90, 'Oct 26', false);
SELECT set_config('twob.write', '', false);
$(as_user "$POSTER")
SELECT public.twob_import2b_reclaim('$POSTER', '$C', '10/2026', '$E', '$D', 'MATCHED');
RESET ROLE;
CREATE TABLE public.t7m_version AS
SELECT (SELECT jsonb_agg(jsonb_build_object('date', '2026-10-02', 'supplier_name', 'PAD', 'supplier_invoice_number', 'P-' || g,
          'taxable_value', 1, 'input_igst', 0, 'input_cgst', 1, 'input_sgst', 1, 'reversal_month', 'Oct 26', 'is_carried_forward', false))
          FROM generate_series(1, $PAD) g)
    || (SELECT jsonb_agg(to_jsonb(t) - 'adopted_from') FROM public.bills_not_in_2b t WHERE t.client_id = '$C') AS v;
GRANT SELECT ON public.t7m_version TO anon;
SQL
}
restore_sql() {
  as_user "$SUPER"
  echo "SELECT 'restored ' || (public.twob_restore_version_linked('$SUPER', '$C', '10/2026', (SELECT v FROM public.t7m_version), '[]'::jsonb) ->> 'bills_not_in_2b');"
}
unreclaim_sql() {
  as_user "$POSTER"
  echo "SELECT 'unreclaim ' || public.t7m_unreclaim('$POSTER', '$C', '$D', 'MATCHED', '$E')::text;"
}
# Waits (up to 20 s) until the session named $1 holds an advisory lock.
wait_advisory() {
  for _ in $(seq 1 200); do
    [ "$(q -c "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = '$1' AND l.locktype = 'advisory' AND l.granted")" != "0" ] && return 0
    sleep 0.1
  done
  return 1
}
state() {
  q -c "SELECT d.itc_action || '|' || COALESCE(t.reclaim_month, '-') || '|' || COALESCE(t.reclaimed_via_doc_id::text = d.id::text, false)
          FROM public.twob_import_docs d JOIN public.bills_not_in_2b t ON t.client_id = d.client_id AND t.supplier_name = 'DELTA'
         WHERE d.id = '$D'"
}

# 1. The Restore first (it has taken the client's lock), the Save then.
setup
restore_sql | PGAPPNAME=t7m_restore q >"$outA" 2>&1 &
pidA=$!
wait_advisory t7m_restore || echo "     (the Restore never held the client's lock)"
unreclaim_sql | PGAPPNAME=t7m_save q >"$outB" 2>&1 || true
wait $pidA || true
check "1: the Restore goes through, and nothing deadlocks (before: a deadlock, one of the two rolled back)" \
  "$(grep -c "^restored $((PAD + 1))$" "$outA" || true)|$(grep -c 'deadlock' "$outA" "$outB" | awk -F: '{s += $2} END {print s}')" "1|0"
check "1: ... the Save of DL-1 out of Reclaim waited for it, then took the restored reclaim out with the document" \
  "$(grep -c '^unreclaim {"ok": true, "was": "RECLAIM", "released": 1}$' "$outB" || true)|$(state)" "1|MATCHED|-|false"

# 2. The Save first, the Restore while it runs.
setup
{ as_user "$POSTER"; echo "BEGIN;"; unreclaim_sql | tail -1; echo "SELECT pg_sleep(1.5);"; echo "COMMIT;"; } | q >"$outB" 2>&1 &
pidB=$!
sleep 0.5
restore_sql | q >"$outA" 2>&1 || true
wait $pidB || true
check "2: the Save goes through; the Restore waits for it and goes through" \
  "$(grep -c '"ok": true' "$outB" || true)|$(grep -c "^restored $((PAD + 1))$" "$outA" || true)|$(grep -c 'deadlock' "$outA" "$outB" | awk -F: '{s += $2} END {print s}')" "1|1|0"
check "2: ... the reclaim back in Awaiting reclaim, its document Matched (counted once, in 5.1)" "$(state)" "MATCHED|-|false"

# 3. A books row deleted on Import 2B while the Restore runs. R-1 (Not in
# 2B) posted its entry, linked to it; the version holds that entry, padded.
R='7f000000-0000-0000-0000-0000000000b1'
N='7f000000-0000-0000-0000-0000000000d2'
setup_delete() {
  q >/dev/null <<SQL
DELETE FROM public.clients WHERE id = '$C';
DROP TABLE IF EXISTS public.t7m_version;
SELECT set_config('twob.write', 'system', false);
INSERT INTO public.clients (id, name, gstin) VALUES ('$C', 'R8 RESTORE AND A DELETE', '24RSEVM0000A1Z5');
SELECT set_config('twob.write', '', false);
$(as_user "$POSTER")
INSERT INTO public.books_register (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, book_treatment, doc_type)
VALUES ('$R', '$C', '10/2026', '2026-10-03', 'ROMEO', 'R-1', '24ROMEO0000A1Z5', 1000, 0, 90, 90, 'NOT_IN_2B', 'INVOICE');
INSERT INTO public.twob_import_docs (id, client_id, period_month, date, supplier_name, supplier_invoice_number, supplier_gstin,
  taxable_value, input_igst, input_cgst, input_sgst, doc_type, itc_action)
VALUES ('$N', '$C', '10/2026', '2026-10-04', 'NOVEMBER', 'N-1', '24NOVEM0000A1Z5', 1000, 0, 90, 90, 'INVOICE', 'NOT_IN_BOOKS');
RESET ROLE;
CREATE TABLE public.t7m_version AS
SELECT (SELECT jsonb_agg(jsonb_build_object('date', '2026-10-02', 'supplier_name', 'PAD', 'supplier_invoice_number', 'P-' || g,
          'taxable_value', 1, 'input_igst', 0, 'input_cgst', 1, 'input_sgst', 1, 'reversal_month', 'Oct 26', 'is_carried_forward', false))
          FROM generate_series(1, $PAD) g)
    || (SELECT jsonb_agg(to_jsonb(t) - 'adopted_from') FROM public.bills_not_in_2b t WHERE t.client_id = '$C') AS v,
       (SELECT jsonb_agg(jsonb_build_object('date', '2026-10-02', 'supplier_name', 'PAD', 'supplier_invoice_number', 'Q-' || g,
          'taxable_value', 1, 'input_igst', 0, 'input_cgst', 1, 'input_sgst', 1, 'bill_in_2b_month', 'Oct 26', 'is_carried_forward', false))
          FROM generate_series(1, $PAD) g)
    || (SELECT jsonb_agg(to_jsonb(t) - 'adopted_from') FROM public.bills_not_in_books t WHERE t.client_id = '$C') AS vb;
GRANT SELECT ON public.t7m_version TO anon;
SQL
}
restore_both_sql() {
  as_user "$SUPER"
  echo "SELECT 'restored ' || (public.twob_restore_version_linked('$SUPER', '$C', '10/2026', (SELECT v FROM public.t7m_version), (SELECT vb FROM public.t7m_version)) ->> 'bills_not_in_2b');"
}
# Either the Restore went through and the delete after it (the delete then
# takes the restored entry off the ledger), or the delete was running at
# the very moment the Restore took its locks and the Restore stopped with
# the plain message; never a deadlock, and the delete always goes through.
outcome() {
  local restored stopped deadlocks
  restored="$(grep -c "^restored $((PAD + 1))$" "$outA" || true)"
  stopped="$(grep -c 'Nothing was restored: a books row or 2B document of Oct-26 is being saved on Import 2B right now' "$outA" || true)"
  deadlocks="$(grep -c 'deadlock' "$outA" "$outB" | awk -F: '{s += $2} END {print s}')"
  echo "$((restored + stopped))|$deadlocks"
}
setup_delete
restore_both_sql | PGAPPNAME=t8m_restore q >"$outA" 2>&1 &
pidA=$!
wait_advisory t8m_restore || echo "     (the Restore never held the client's lock)"
{ as_user "$POSTER"; echo "DELETE FROM public.books_register WHERE id = '$R' RETURNING 'deleted ' || supplier_invoice_number;"; } | q >"$outB" 2>&1 || true
wait $pidA || true
check "3: a books row deleted on Import 2B while the Restore runs: the Restore goes through (or stops with the plain message), nothing deadlocks (before: a deadlock, the Restore rolled back)" \
  "$(outcome)" "1|0"
check "3: ... the delete goes through, and takes its entry off the ledger" \
  "$(grep -c '^deleted R-1$' "$outB" || true)|$(q -c "SELECT count(*) FROM public.books_register WHERE id = '$R'")|$(q -c "SELECT count(*) FROM public.bills_not_in_2b WHERE client_id = '$C' AND supplier_name = 'ROMEO'")" "1|0|0"

# 4. A 2B document deleted (a re-import's document no longer in the file)
# while the Restore runs; N-1 (Not in Books) posted its entry, which the
# version holds.
setup_delete
restore_both_sql | PGAPPNAME=t8m_restore q >"$outA" 2>&1 &
pidA=$!
wait_advisory t8m_restore || echo "     (the Restore never held the client's lock)"
{ as_user "$POSTER"; echo "DELETE FROM public.twob_import_docs WHERE id = '$N' RETURNING 'deleted ' || supplier_invoice_number;"; } | q >"$outB" 2>&1 || true
wait $pidA || true
check "4: a 2B document deleted while the Restore runs: the Restore goes through (or stops with the plain message), nothing deadlocks" \
  "$(outcome)" "1|0"
check "4: ... the delete goes through, and takes its entry off the ledger" \
  "$(grep -c '^deleted N-1$' "$outB" || true)|$(q -c "SELECT count(*) FROM public.twob_import_docs WHERE id = '$N'")|$(q -c "SELECT count(*) FROM public.bills_not_in_books WHERE client_id = '$C' AND supplier_name = 'NOVEMBER'")" "1|0|0"

exit $fail
