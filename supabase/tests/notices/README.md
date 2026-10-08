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
| `test_80_stages` | the one stage vocabulary: stage ↔ status mirror, facts move it forward, matters on the same keys (legacy labels mapped) |
| `test_90_workspace` | issues, drafts and partner review, document requests and E12, payments, uploads, the stage moves they imply |
| `test_95_command_centre` | every command-centre number equals the count of the list or plan tab it opens; calendar, hearings, search |
| `test_96_scale` | 5,000 notices: the command centre, plan and list queries stay well under the first-paint budget |
| `test_97_sync_legacy` | sync status before the run ledger: clients synced only by an older extension keep their last known state from `client_sync_log`; "never synced" means no history at all |
| `test_98_owner_names` | owners from the accountant names on file |
| `test_99_autopilot` | the Phase 3 queue with the office agent and its CAPTCHA wall (`runner = 'office_agent'`) |
| `test_99b_chrome_runner` | scheduled syncs in the firm's own Chrome: only the named runner claims, one job at a time, no wall, CAPTCHA timeouts retried, status and close |
| `test_100_reply` | reading a notice (portal and form readers, verify), the AI reading queue (consent, cap, finish, only new open notices), evidence annexures, document requests and reminders, the Reply Factory numbers |
| `test_100b_notice_types` | reply need and dashboard choice per notice type; flags, plan, calendar and coverage follow; every dashboard number still equals its list |
| `test_100d_notice_types_hidden` | a type hidden everywhere (GSTR-3A): left out of facts, plan, calendar, search and the command centre's counts, no reply options or alert e-mail, kept on record, back as it was when shown again |
| `test_100c_reply_options` | the hyphen free wording helpers, options prepared when a notice arrives or changes, using one to start a draft, a failing reply never blocking a sync write |
| `test_101_reply_templates` | the firm's 64 templates on every form, with all facts and with none: no dash, no unfilled placeholder, letter shape and numbering, issue paragraphs, re-runs keep the firm's edits |
| `test_102_ai_assistant` | the Notice Response AI Assistant: every case-folder PDF, sent draft and typed position registered; backfill and claim order (a reply after its notice); copies not read twice; reply pairs, the admin's choice of past and ongoing responses, the closest examples, the assistant's run (no dashes, examples counted, separate cap), edited paragraphs kept, the runner's lease and the cron tick |
| `test_103_master_filters` | the master filters: one key for every spelling of a year, owner / FY / form "none", and the command centre counting, filter by filter, exactly what its lists show (notices and matters) |

Phase 2's e-mail changes (deep links to `/notices/<id>`, headline, button, grouped
overdue list) are covered in `test_60_alerts`.

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
