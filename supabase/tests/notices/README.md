# Notices module — local tests

Never run these against the live project: they create and drop their own database.

## SQL tests

`run.sh` creates a throwaway database on a **local** PostgreSQL 15/16, loads
`00_stub_platform.sql` (the Supabase pieces the migrations expect: roles, `auth.uid()`
returning NULL, `cron`, `net`, `vault`, `storage`, and the base tables), applies every
migration in `migrations.txt` — the Phase 1 ones twice, to prove they re-run cleanly —
and runs each `test_*.sql` inside `BEGIN … ROLLBACK`.

```
PGHOST=/path/to/socket PGPORT=55432 PGUSER=postgres supabase/tests/notices/run.sh
```

`KEEP_DB=1` keeps the database for poking around; `SKIP_REAPPLY=1` skips the second pass.

| Test | Covers |
|---|---|
| `test_10_classifier` | form rules → `form_code`, category, default priority |
| `test_15_portal_wording` | real portal wording; auto-close by form rule |
| `test_20_facts` | `notice_facts` flags in IST; **every dashboard number equals the row count of the list it opens** |
| `test_30_events` | event triggers and actor attribution |
| `test_40_ingest` | `sync_ingest` as `anon`: counts, guarded soft delete, ledger |
| `test_50_clocks` | `matter_deadlines` writer, overrides, outer-limit window |
| `test_60_alerts` | preview / live, dedupe (a rerun sends nothing twice), quiet hours, auto-owner |
| `test_70_alerts_speed` | a 1,500-event backlog under the anon 3 s statement timeout |

A new migration that touches these objects goes into `migrations.txt`.

## Extension simulation

`extension/test/notices-sync.sim.mjs` drives the real extension scripts against a
local PostgREST in front of a database built the same way (`KEEP_DB=1`, or load the
stub and `migrations.txt` into a database of your own). PostgREST needs the
`authenticator` role (login, member of `anon`), `db-anon-role = "anon"`, a JWT secret
and an anon JWT signed with it; give `anon` a 3 s `statement_timeout` to match the
hosted project. Then:

```
node extension/test/notices-sync.sim.mjs http://127.0.0.1:54399 /path/to/anon.jwt
```
