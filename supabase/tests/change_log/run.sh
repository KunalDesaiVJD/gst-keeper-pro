#!/usr/bin/env bash
# Replays 20261021130000_gst_change_log.sql on a throwaway local database and
# runs the SQL tests in this folder, then the app-level check of the Change
# history page's loading (scripts/verify-change-history.mjs) on the log rows
# the tests produced. The migration is applied twice (it must be safe to
# re-run). A second database checks that the migration leaves a sibling
# branch's manual_source_allow / manual_source_revoke alone. Needs a local
# PostgreSQL 15+ and node; connection from the usual PG* variables, e.g.
#   PGHOST=/tmp/pgsock PGPORT=55432 PGUSER=postgres supabase/tests/change_log/run.sh
# Never point it at the live project: it creates and drops its own databases.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
mig="$here/../../migrations/20261021130000_gst_change_log.sql"
db="change_log_test_$$"
db2="change_log_sibling_$$"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
createdb "$db"
trap 'dropdb --if-exists --force "$db"; dropdb --if-exists --force "$db2"; rm -f "$here/.last_error"; [ -n "${KEEP_ROWS:-}" ] || rm -f "$here/.rows.json"' EXIT
psql_q -f "$here/00_stub.sql" >/dev/null
psql_q -f "$mig" >/dev/null 2>&1 || { echo "FAILED applying the migration"; psql_q -f "$mig" 2>&1 | grep -v NOTICE | tail -5; exit 1; }
psql_q -f "$mig" >/dev/null 2>&1 || { echo "FAILED re-applying the migration"; exit 1; }
psql_q -f "$here/01_fixtures.sql" >/dev/null
status=0
shopt -s nullglob
for t in "$here"/test_*.sql; do
  if psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$t" >"$here/.last_out" 2>"$here/.last_error"; then
    echo "ok   $(basename "$t")"
    grep -h "^NOTICE:  TIMING\|^psql.*NOTICE:  TIMING" "$here/.last_error" | sed 's/.*NOTICE:  /     /' || true
  else
    echo "FAIL $(basename "$t")"; grep -v "^psql.*NOTICE" "$here/.last_error" | head -20; status=1
  fi
done
rm -f "$here/.last_out"

# The app-level check, on the rows the tests left in the log (as the app reads them: the view).
psql -X -q -At -d "$db" -c "SELECT COALESCE(json_agg(h ORDER BY h.at DESC, h.key DESC), '[]') FROM gst_change_history h" > "$here/.rows.json"
if node "$root/scripts/verify-change-history.mjs" "$here/.rows.json"; then echo "ok   verify-change-history.mjs (on the test log)"; else echo "FAIL verify-change-history.mjs"; status=1; fi

# A long read holding a logged table: a re-apply gives up after 5 s (lock_timeout)
# instead of queueing the app's queries behind it, and changes nothing.
psql -X -q -d "$db" -c "BEGIN; LOCK TABLE public.twob_import_docs IN ACCESS SHARE MODE; SELECT pg_sleep(20); COMMIT;" >/dev/null 2>&1 &
holder=$!
sleep 1
t0=$(date +%s)
if out=$(timeout 15 psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$mig" 2>&1); then lock_ok=no; else lock_ok=yes; fi
took=$(( $(date +%s) - t0 ))
kill "$holder" 2>/dev/null || true; wait "$holder" 2>/dev/null || true
if [ "$lock_ok" = yes ] && echo "$out" | grep -q "lock timeout" && [ "$took" -lt 12 ]; then
  echo "ok   a re-apply behind a long read stops at the lock timeout (${took} s), nothing half-done"
else
  echo "FAIL the apply did not stop at the lock timeout (took ${took} s)"; echo "$out" | grep -v NOTICE | tail -3; status=1
fi

# A sibling branch (reco) already made the allowance RPCs, returning jsonb: they stay.
createdb "$db2"
psql -X -q -v ON_ERROR_STOP=1 -d "$db2" -f "$here/00_stub.sql" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$db2" >/dev/null <<'SQL'
CREATE TABLE public.manual_source_allowances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL CHECK (period_month ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
  scope text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  allowed_by uuid NOT NULL,
  allowed_at timestamptz NOT NULL DEFAULT now(),
  used_by uuid,
  used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid
);
CREATE FUNCTION public.manual_source_allowances_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE FUNCTION public.manual_source_allow(p_actor_id uuid, p_client_id uuid, p_period text, p_scope text, p_reason text)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"sibling": true}'::jsonb $$;
CREATE FUNCTION public.manual_source_revoke(p_actor_id uuid, p_id uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"sibling": true}'::jsonb $$;
SQL
psql -X -q -v ON_ERROR_STOP=1 -d "$db2" -f "$mig" >/dev/null 2>&1 || { echo "FAIL applying over a sibling's allowance functions"; status=1; }
if [ "$(psql -X -At -d "$db2" -c "SELECT pg_get_function_result('public.manual_source_allow(uuid,uuid,text,text,text)'::regprocedure) || ',' || pg_get_function_result('public.manual_source_revoke(uuid,uuid)'::regprocedure) || ',' || (SELECT count(*) FROM gst_change_log_tables WHERE table_name = 'manual_source_allowances')")" = "jsonb,jsonb,1" ]; then
  echo "ok   a sibling's manual_source_allow / revoke left as they were; its table logged"
else
  echo "FAIL a sibling's allowance functions were replaced"; status=1
fi
exit $status
