#!/usr/bin/env bash
# Round 2 of the review, defect 4: Clear Data deletes a reco row in one
# session while another session, with the public key, inserts a "pulled" row
# for the same client and month. Before the fix the guard saw the row being
# deleted (not yet committed), skipped its checks ("the UPDATE half
# decides"), and the insert went in once the delete committed: a pull nobody
# made, which the gate accepted. Now every insert is checked.
# Usage: race.sh [migration file] (default: this branch's). Needs a local
# PostgreSQL (PG* variables); never the live project.
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
here="$(cd "$(dirname "$0")" && pwd)"
mig="$here/../../migrations"
f="${1:-$mig/20261021120000_reco_pull_push_gate.sql}"
db="reco_gate_race_$$"
createdb "$db"
trap 'dropdb --if-exists "$db"' EXIT
q() { psql -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
q -f "$here/00_stub.sql" >/dev/null
q -f "$mig/20261020150000_opening_override_superadmin.sql" >/dev/null
q -f "$f" >/dev/null
c=33000000-0000-0000-0000-000000000001
e=00000000-0000-0000-0000-0000000000e3
q -c "INSERT INTO public.profiles (user_id, first_name) VALUES ('$e', 'Esha');
      INSERT INTO public.user_roles (user_id, role) VALUES ('$e', 'employee');
      INSERT INTO public.clients (id, name, regular_sub_type) VALUES ('$c', 'RACE', 'Normal');
      INSERT INTO public.suspended_reco (client_id, period_month) VALUES ('$c', '09/2026');
      SELECT public.reco_record_pull('$e', 'receivable', '$c', '09/2026', '{\"igst\":0,\"cgst\":0,\"sgst\":0}', '{\"igst\":0,\"cgst\":0,\"sgst\":0}', '{\"igst\":0,\"cgst\":0,\"sgst\":0}');" >/dev/null
# Session A: Clear Data, held open for 3 seconds.
psql -X -q -d "$db" -c "BEGIN; SET ROLE anon; SELECT public.reco_clear('$e', 'suspended', '$c', ARRAY['09/2026']); SELECT pg_sleep(3); COMMIT;" >/dev/null 2>&1 &
a=$!
sleep 1
# Session B: a forged "pulled" row for the same client and month.
out="$(psql -X -q -d "$db" -c "SET ROLE anon; INSERT INTO public.suspended_reco (client_id, period_month, opening_source, opening_portal_pulled_at) VALUES ('$c', '09/2026', 'portal', now());" 2>&1 || true)"
wait "$a"
status="$(psql -X -At -d "$db" -c "SELECT public.gstr3b_push_gate('$c', '09/2026')->'suspended'->>'status'")"
rows="$(psql -X -At -d "$db" -c "SELECT count(*) FROM public.suspended_reco WHERE client_id = '$c'")"
if [[ "$out" == *"comes only from the portal pull"* && "$status" != "pulled" && "$rows" == "0" ]]; then
  echo "ok   race (an insert during Clear Data is checked: refused, the month reads $status)"
else
  echo "FAIL race: insert said [${out//$'\n'/ }], the gate reads [$status], rows left [$rows]"
  exit 1
fi
