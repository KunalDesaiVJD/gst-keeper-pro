#!/usr/bin/env bash
# The Claude API key store (20261104100000_ai_api_key_vault.sql) on a local
# PostgreSQL with a stand-in Vault: save, mask, read, remove, the password and
# level checks, and that anon / authenticated can neither read nor call it.
# Usage: PGHOST=/tmp/pgt PGPORT=55432 supabase/tests/ai_api_key/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB=ai_key_test
psql -q -U postgres -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
psql -q -v ON_ERROR_STOP=1 -U postgres -d $DB -f supabase/tests/ai_api_key/setup.sql
psql -q -v ON_ERROR_STOP=1 -U postgres -d $DB -f supabase/migrations/20261104100000_ai_api_key_vault.sql
psql -q -v ON_ERROR_STOP=1 -U postgres -d $DB -f supabase/tests/ai_api_key/test.sql
echo "ai_api_key: all checks passed"
