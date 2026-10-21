#!/usr/bin/env bash
# Two sessions at once (round 1, defect: a unit answered while a send runs
# showed as "replaced" on the newest link). Run by run.sh on a copy of the
# migrated test database, with the fixtures committed; every call as anon.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db="$1"
q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$db" -c "SET ROLE anon; $1" | grep -v '^SET$' || true; }
fail=0
expect() { if [ "$2" = "$3" ]; then echo "ok   race: $1"; else echo "FAIL race: $1: expected [$3], got [$2]"; fail=1; fi; }
reset() {
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -c "DELETE FROM builder_bu_agreement_confirmations; DELETE FROM builder_bu_confirm_requests; DELETE FROM email_outbox;" >/dev/null
}
U1=a1000000-0000-0000-0000-000000000001; U2=a1000000-0000-0000-0000-000000000002; U3=a1000000-0000-0000-0000-000000000003
E1=e1000000-0000-0000-0000-000000000001; S=10000000-0000-0000-0000-000000000001
psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/fixtures.psql" >/dev/null

# 1. A reader confirms A-101 (and disputes A-102, answers in the reverse
#    order) and holds the transaction; staff send A-101..A-103 meanwhile.
reset
tok1=$(q "SELECT t_send(ARRAY['$U1','$U2']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'token'")
( psql -X -q -At -v ON_ERROR_STOP=1 -d "$db" >/dev/null <<SQL
BEGIN; SET ROLE anon;
SELECT builder_bu_confirm_respond('$tok1', jsonb_build_array(t_answer('$U2', 'DISPUTE', 'Now 54 lakh'), t_answer('$U1', 'CONFIRM')), 'Owner', 'owner@client.test');
SELECT pg_sleep(2);
COMMIT;
SQL
) &
sleep 0.7
r2=$(q "SELECT t_send(ARRAY['$U1','$U2','$U3']::uuid[], ARRAY['new@client.test'], NULL)")
wait
expect "the send waited and saw the answers" "$(q "SELECT ('$r2'::jsonb ->> 'sent') || ':' || (SELECT string_agg(x ->> 'unit_no', ',') FROM jsonb_array_elements('$r2'::jsonb -> 'already_answered') x)")" "false:A-101"
expect "no second request or e-mail" "$(q "SELECT (SELECT count(*) FROM builder_bu_confirm_requests) || '/' || (SELECT count(*) FROM email_outbox)")" "1/1"
expect "the first link shows the answers, nothing replaced" "$(q "SELECT t_states('$tok1')")" "A-101:CONFIRMED,A-102:DISPUTED"
r3=$(q "SELECT t_send(ARRAY['$U2','$U3']::uuid[], ARRAY['new@client.test'], NULL)")
tok3=$(q "SELECT '$r3'::jsonb ->> 'token'")
expect "the send without it: every unit on the new link is its own" "$(q "SELECT t_states('$tok3')")" "A-102:PENDING,A-103:PENDING"

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
