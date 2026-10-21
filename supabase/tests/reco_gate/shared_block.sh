#!/usr/bin/env bash
# manual_source_allowances is shared with the filing branch
# (20261021110000_filing_status_pull_only.sql): the table, its guard and
# manual_source_allow / _revoke / _take must be byte-identical in both
# migrations, and either must apply after the other. This compares the two
# blocks (from the CREATE TABLE to the GRANT on manual_source_revoke) and
# applies them in both orders on throwaway databases, then gives and uses one
# allowance through each branch's functions.
# The filing migration is read from supabase/migrations once merged, else from
# the filing-pull-only branch; without either the check is skipped.
# Needs a local PostgreSQL (PG* variables); never the live project.
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
here="$(cd "$(dirname "$0")" && pwd)"
mig="$here/../../migrations"
mine="$mig/20261021120000_reco_pull_push_gate.sql"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"; for d in "${dbs[@]:-}"; do [ -n "$d" ] && dropdb --if-exists "$d"; done' EXIT
dbs=()

filing="$mig/20261021110000_filing_status_pull_only.sql"
if [ ! -f "$filing" ]; then
  if git -C "$here" show filing-pull-only:supabase/migrations/20261021110000_filing_status_pull_only.sql > "$tmp/filing.sql" 2>/dev/null; then
    filing="$tmp/filing.sql"
  else
    echo "skip shared_block: the filing migration is not here or on branch filing-pull-only"
    exit 0
  fi
fi

block() {
  awk '/^CREATE TABLE IF NOT EXISTS public\.manual_source_allowances \(/{on=1}
       on{print}
       /^GRANT EXECUTE ON FUNCTION public\.manual_source_revoke\(uuid, uuid\) TO anon, authenticated, service_role;$/{if(on) exit}' "$1"
}
block "$filing" > "$tmp/filing_block.sql"
block "$mine" > "$tmp/mine_block.sql"
if [ ! -s "$tmp/mine_block.sql" ] || ! cmp -s "$tmp/filing_block.sql" "$tmp/mine_block.sql"; then
  echo "FAIL shared_block: manual_source_allowances differs from the filing branch's"
  diff -u "$tmp/filing_block.sql" "$tmp/mine_block.sql" | head -40 || true
  exit 1
fi
{ echo 'BEGIN;'; cat "$tmp/filing_block.sql"; echo 'COMMIT;'; } > "$tmp/filing_alone.sql"

# One allowance given and used through each branch's functions.
cat > "$tmp/use.sql" <<'SQL'
INSERT INTO public.profiles (user_id, first_name) VALUES ('00000000-0000-0000-0000-0000000000d1', 'Sonal'), ('00000000-0000-0000-0000-0000000000d3', 'Emil');
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000d1', 'superadmin'), ('00000000-0000-0000-0000-0000000000d3', 'employee');
INSERT INTO public.clients (id, name) VALUES ('41000000-0000-0000-0000-000000000001', 'SHARED');
DO $$
DECLARE
  c uuid := '41000000-0000-0000-0000-000000000001';
  s uuid := '00000000-0000-0000-0000-0000000000d1';
  e uuid := '00000000-0000-0000-0000-0000000000d3';
  a public.manual_source_allowances;
BEGIN
  -- the filing branch's use: filing_attach_manual calls manual_source_take
  a := public.manual_source_allow(s, c, '09/2026', 'filing:GSTR-3B', 'Portal down for the filing pull');
  PERFORM public.t_eq((public.manual_source_take(e, c, '09/2026', 'filing:GSTR-3B')).id, a.id, 'the filing use takes its allowance');
  -- this branch's use: reco_manual_opening
  a := public.manual_source_allow(s, c, '09/2026', 'reco:suspended', 'Portal password refused');
  PERFORM public.reco_manual_opening(e, 'suspended', c, '09/2026', 'not_applicable', NULL);
  PERFORM public.t_eq((SELECT used_by FROM public.manual_source_allowances WHERE id = a.id), e, 'the reco use takes its allowance');
  PERFORM public.t_eq(public.gstr3b_push_gate(c, '09/2026')->'suspended'->>'status', 'manual', 'and the gate reads it');
END $$;
SQL

run_order() {
  local label="$1" first="$2" second="$3"
  local db="shared_${label}_$$"
  dbs+=("$db")
  createdb "$db"
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/00_stub.sql" >/dev/null
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$mig/20261020150000_opening_override_superadmin.sql" >/dev/null
  if ! psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$first" >/dev/null 2>"$tmp/err" \
     || ! psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$second" >/dev/null 2>>"$tmp/err"; then
    echo "FAIL shared_block ($label): a migration did not apply"; cat "$tmp/err"; return 1
  fi
  if ! psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$tmp/use.sql" >/dev/null 2>"$tmp/err"; then
    echo "FAIL shared_block ($label): giving or using an allowance failed"; cat "$tmp/err"; return 1
  fi
  echo "ok   shared_block ($label)"
}
status=0
run_order filing_then_reco "$tmp/filing_alone.sql" "$mine" || status=1
run_order reco_then_filing "$mine" "$tmp/filing_alone.sql" || status=1
exit $status
