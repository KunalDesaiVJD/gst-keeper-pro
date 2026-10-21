#!/usr/bin/env bash
# Two sessions at once (round 1, defect: a unit answered while a send runs
# showed as "replaced" on the newest link; round 2, defect: a dispute given
# while the send ran was wiped). Run by run.sh on a copy of the
# migrated test database, with the fixtures committed; every call as anon.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db="$1"
q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$db" -c "SET ROLE anon; $1" | grep -v '^SET$' || true; }
fail=0
expect() { if [ "$2" = "$3" ]; then echo "ok   race: $1"; else echo "FAIL race: $1: expected [$3], got [$2]"; fail=1; fi; }
reset() {
  # As the owner, with the confirmation functions' flag (the guard refuses
  # other writes, test_15).
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -c "SET app.bu_confirm_write = on; DELETE FROM t_proofs; DELETE FROM builder_bu_confirm_answer_history; DELETE FROM builder_bu_agreement_confirmations; DELETE FROM builder_bu_confirm_requests; DELETE FROM email_outbox;" >/dev/null
}
U1=a1000000-0000-0000-0000-000000000001; U2=a1000000-0000-0000-0000-000000000002; U3=a1000000-0000-0000-0000-000000000003
E1=e1000000-0000-0000-0000-000000000001; S=10000000-0000-0000-0000-000000000001
psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/fixtures.psql" >/dev/null

# 1. A reader confirms A-101 and disputes A-102 (answers in the reverse
#    order) and holds the transaction; staff, who opened the pop-up before
#    (every unit unanswered), press Send for A-101..A-103 meanwhile. Round 2
#    (defect: the send wiped the dispute and the browser re-sent at once):
#    the send waits, then reports BOTH units, the dispute with its note and
#    who gave it, and writes nothing; the dispute is kept.
reset
tok1=$(q "SELECT t_send(ARRAY['$U1','$U2']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'token'")
seen=$(q "SELECT t_seen(ARRAY['$U1','$U2','$U3']::uuid[])")
proof=$(q "SELECT t_proof('$tok1', 'owner@client.test')")
( psql -X -q -At -v ON_ERROR_STOP=1 -d "$db" >/dev/null <<SQL
BEGIN; SET ROLE anon;
SELECT builder_bu_confirm_respond('$tok1', jsonb_build_array(t_answer('$U2', 'DISPUTE', 'Now 54 lakh'), t_answer('$U1', 'CONFIRM')), 'Owner', 'owner@client.test', '$proof');
SELECT pg_sleep(2);
COMMIT;
SQL
) &
sleep 0.7
r2=$(q "SELECT t_send(ARRAY['$U1','$U2','$U3']::uuid[], ARRAY['new@client.test'], NULL, p_seen => '$seen'::jsonb)")
wait
expect "the send waited and saw both answers" "$(q "SELECT ('$r2'::jsonb ->> 'sent') || ':' || (SELECT string_agg((x ->> 'unit_no') || '=' || (x ->> 'status'), ',') FROM jsonb_array_elements('$r2'::jsonb -> 'already_answered') x)")" "false:A-101=CONFIRMED,A-102=DISPUTED"
expect "it reports the dispute's note and who gave it" "$(q "SELECT x ->> 'dispute_notes' || ' / ' || (x ->> 'responded_by_email') FROM jsonb_array_elements('$r2'::jsonb -> 'already_answered') x WHERE x ->> 'unit_no' = 'A-102'")" "Now 54 lakh / owner@client.test"
expect "no second request or e-mail" "$(q "SELECT (SELECT count(*) FROM builder_bu_confirm_requests) || '/' || (SELECT count(*) FROM email_outbox)")" "1/1"
expect "the dispute is kept" "$(q "SELECT status || '/' || dispute_notes || '/' || responded_by_name FROM builder_bu_agreement_confirmations WHERE unit_id = '$U2'")" "DISPUTED/Now 54 lakh/Owner"
expect "the first link shows the answers, nothing replaced" "$(q "SELECT t_states('$tok1')")" "A-101:CONFIRMED,A-102:DISPUTED"
# The browser stops on a dispute (it re-sends only when every unit answered
# meanwhile was confirmed or accepted): staff see it, and send the rest.
r3=$(q "SELECT t_send(ARRAY['$U3']::uuid[], ARRAY['new@client.test'], NULL, p_seen => '$seen'::jsonb)")
tok3=$(q "SELECT '$r3'::jsonb ->> 'token'")
expect "the send without them: the unit left is on the new link" "$(q "SELECT t_states('$tok3')")" "A-103:PENDING"
expect "the dispute is still there" "$(q "SELECT status FROM builder_bu_agreement_confirmations WHERE unit_id = '$U2'")" "DISPUTED"
expect "nothing went to the history (no dispute was cleared)" "$(q "SELECT count(*) FROM builder_bu_confirm_answer_history")" "0"

# 2. The firm accepts A-103, which had no row yet, and holds the transaction;
#    the first send for the event runs meanwhile. The send is undone whole.
reset
( psql -X -q -At -v ON_ERROR_STOP=1 -d "$db" >/dev/null <<SQL
BEGIN; SET ROLE anon;
SELECT builder_bu_agreement_override('$E1', '$U3', '$S', '');
SELECT pg_sleep(2);
COMMIT;
SQL
) &
sleep 0.7
r=$(q "SELECT t_send(ARRAY['$U1','$U2','$U3']::uuid[], ARRAY['owner@client.test'], NULL)")
wait
expect "the send reports the unit accepted meanwhile" "$(q "SELECT ('$r'::jsonb ->> 'sent') || ':' || (SELECT string_agg((x ->> 'unit_no') || '=' || (x ->> 'status'), ',') FROM jsonb_array_elements('$r'::jsonb -> 'already_answered') x)")" "false:A-103=OVERRIDDEN"
expect "and wrote nothing" "$(q "SELECT (SELECT count(*) FROM builder_bu_confirm_requests) || '/' || (SELECT count(*) FROM email_outbox) || '/' || (SELECT string_agg(status, ',') FROM builder_bu_agreement_confirmations)")" "0/0/OVERRIDDEN"
exit $fail
