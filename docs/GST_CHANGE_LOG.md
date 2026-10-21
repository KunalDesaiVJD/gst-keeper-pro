# GST change log

The firm, 21 Oct 2026: "All data of GST working & history of every updation to be
maintained and traceable."

Every change to a GST working table is kept in `public.gst_change_log`: who made
it, when, from where, and what changed. The record cannot be edited or deleted.
Staff read it on the **Change history** page (`/change-history`) and through the
**History** button on the main GST working pages.

Migration: `supabase/migrations/20261021130000_gst_change_log.sql` (live-apply
steps in its header). Tests: `supabase/tests/change_log/run.sh`.

## 1. What is logged

One row per changed row, written by `AFTER ... FOR EACH STATEMENT` triggers with
transition tables (one `INSERT ... SELECT` per statement, not one per row). The
triggers are attached by `gst_change_log_attach()`; `gst_change_log_tables` lists
every attached table and how it is read.

**Full** (insert, update, delete, truncate), 91 tables:

- Import 2B and 2B Reconciliation: `twob_import_docs`, `books_register`,
  `bills_not_in_2b`, `bills_not_in_books`.
- ITC and the recos: `itc_summaries`, `suspended_reco`, `gst_receivable_reco`.
- Returns: `filing_status`, `gstr1_data`, `gstr1_manual_entries`,
  `gstr1_direct_filing_approvals`, `gstr3b_adjustments`.
- RCM and the update sheet: `rcm_data`, `rcm_masters`, `gst_running_updates`.
- Advances and works contracts: `advance_*`, `contract_projects`, `contract_ra_bills`.
- Client masters: `clients` (the GST fields only, see below), `client_annual_turnover`.
- The superadmin's manual-entry exceptions: `manual_source_allowances`.
- Portal pulls: the credit, cash and liability ledgers, the reversal and RCM
  ledgers, `gst_filed_returns`, `einvoice_docs`, `gstr2a_import_docs`,
  `gst_challans`, `gst_taxpayer_profile`, `portal_gstr1_category_figures`.
- Annual Return inputs kept outside the workings: the books, P&L, duties and
  taxes, RCM, carry-forward and reason tables, and the old `gstr9_*` /
  `gstr9c_*` tables.
- Every `builder_*` table (30), except the classification history below.

**History** (update and delete only; a deleted row is kept whole), 11 tables:
`twob_versions`, `itc_versions`, `rcm_versions`, `gst_update_versions`,
`gst_update_row_versions`, `gstr1_upload_versions`,
`gstr1_upload_versions_quarantine`, `gstr3b_push_versions`,
`client_scheme_history`, `builder_unit_classification_history`, `audit_log`.
A new version is itself the record, so its insert is not logged again; anyone
switching one off, editing a snapshot or deleting a version is.

**Not logged again:** `annual_return_docs` (complete per-figure log in
`annual_return_change_log`) and the Liberal switch (`client_liberal_log`). Both
appear in the same history view. Not GST working, not logged: the notices
module (it has `notice_events`), staff and positions (`staff_position_log`),
portal job and sync tables, e-mail queues.

**Never logged:** passwords. `clients` is logged only for `gstin`, `name`,
`registration_type`, `registration_date`, `selected_returns`,
`assigned_accountant`, the cancellation dates, `regular_sub_type`,
`builder_itc_type`, the areas, the target date groups, `inactive_at_hand`,
`gstr1_import_mode`, `notices_handled`, `notices_tracks_off`,
`einvoice_applicable`, `einvoice_exemption`, `gst_user_id` and
`gst_password_changed_at`. A portal password change shows as its date.

## 2. A log row

| Column | |
|---|---|
| `at` | the transaction's time (`now()`): every row of one save has the same time |
| `table_name`, `row_id`, `row_label` | the table, the row's key, and its name for people (supplier and invoice number, the return type, the unit number; up to 120 characters) |
| `client_id`, `period_month`, `financial_year` | the client (builder rows through their project or unit), the month as `MM/YYYY` whatever the table's own spelling (`Sep-26`, a date, `MMYYYY`), the financial year for FY tables |
| `op` | `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` |
| `actor_id`, `actor_name` | who; the name is resolved when the row is written, so it stays after the person is removed |
| `actor_source` | `app`, `extension`, `agent`, `system`, `unknown` (section 3) |
| `actor_basis` | `header` (the request named the person), `row` (taken from the row's own stamp), `none` |
| `changed` | what changed (below) |
| `request_id`, `txid` | the request (page and a short id from the app) and the database transaction |

`changed`:

- **UPDATE**: only the changed columns, `{"status": {"old": "Prepared", "new": "Filed"}}`.
  `updated_at` is never compared: a save that changes nothing else logs nothing.
- **INSERT / DELETE**: the row's filled columns (empty ones, the key and the
  client are left out).
- **JSON columns**: small ones (the ITC Summary's `data`) as the leaves that
  changed, named by `srNo` / `label`, at most 100:
  `{"data": {"changes": [{"path": "section4A[5.1].igst", "old": 1000, "new": 1200}], "more": false}}`.
  Large ones (named per table: GSTR-1 `raw_json`, version snapshots, upload and
  push payloads, the portal's `raw` / `full_json` / `profile_json`), and any JSON
  over 64 KB, as a fingerprint: `md5`, `bytes`, key or item count, and on UPDATE
  the top-level keys that changed (`"keys_changed": ["hsn"]`). A deleted history
  row (a version) is kept whole.
- `{"_error": "..."}`: the logger could not read the statement. The save still
  went through; this row says it happened. Never seen in the tests.
- `TRUNCATE`: `{"rows": n}`.

## 3. Who did it

The app has no Supabase auth session (`auth.uid()` is NULL), so the database
cannot know the user by itself. Every request to `/rest/v1` carries:

- `x-gst-actor`: the signed-in user's id (staff `user_id`, or the client id on
  the client portal), from the saved sign-in;
- `x-gst-source`: `app`, `extension` or `agent`;
- `x-gst-request`: the page and a short id (`/itc-summary 4f3a2b1c`).

App: `src/lib/changeLogHeaders.ts`, the Supabase client's `global.fetch`
(`src/integrations/supabase/client.ts`). Extension 0.17.0: `background.js`
(`actorHeaders`), with the app user's id while a job the app started is running
(the job's `actorId`); a scheduled sync names no one. Office agent:
`agent/src/db.ts` (`x-gst-source: agent`).

PostgREST puts request headers in `request.headers`; `gst_change_log_context()`
reads them. **CORS, checked in Chromium on 21 Oct 2026 against the live
project:** the API gateway's preflight on `/rest/v1` allows the requested
headers (`access-control-allow-headers: apikey,authorization,x-client-info,x-gst-actor,x-gst-request,x-gst-source`),
and a harmless GET of one client id with the headers returned 200. Each Edge
Function lists its own allowed headers (`authorization, x-client-info, apikey,
content-type`) and the browser refused the same headers there, so the app adds
them only to `/rest/v1` requests (never to `/functions/v1` or `/storage/v1`).

Without the header the actor comes from the row's own stamp: on UPDATE the
first stamp column that changed (`updated_by`, `posted_by`, `decided_by`,
`revoked_by`, ...), else the row's `updated_by` / `created_by` / ...; on INSERT
the first filled one. These rows are marked `actor_basis = 'row'` ("from the
row's own stamp" on the page): a Liberal-mode edit that copies the old row
keeps the previous author, so a row stamp can be wrong. A DELETE has no stamp
of its own: without the header no person is recorded.

`actor_source`: the header's word when it is `app`, `extension` or `agent`; else
`system` for the service key (Edge Functions) and for a direct database session
(migrations, pg_cron, the SQL editor: no request headers at all); else
`unknown` (the public key without the header: a tab opened before the release,
an older extension).

The header is trusted the way every `p_actor_id` in this database is: anyone
with the public key could send any id. It records who the app says acted.

`gst_change_log_whoami()` (a read, granted to the public key) returns what the
database sees of the caller; the Change history page shows it ("Your changes are
recorded as Gita, from the app").

## 4. Append-only

- RLS: SELECT for everyone (`TO public USING (true)`), like every table; no
  write policy, and no INSERT, UPDATE, DELETE or TRUNCATE privilege for `anon`,
  `authenticated` or `service_role`. Only the logger (SECURITY DEFINER) writes.
- `gst_change_log_guard` refuses UPDATE and TRUNCATE for every role, the owner
  included, and DELETE unless `app.gst_change_log_retention` is on. Nothing sets
  it today. A future retention function must be run by the superadmin
  (`staff_level_of(p_actor_id) = 'superadmin'`), log itself, then set the
  setting for its own transaction.
- `gst_change_log_tables` is select-only too, and `gst_change_log_attach` is not
  callable from the API: no one can re-point or switch off the logger without
  a migration.
- The history outlives the client: `client_id` has no foreign key.
- What remains: the database owner can drop the trigger (DDL). That is outside
  the app's reach and would be a migration in this repo.

## 5. Reading it

- View `gst_change_history` (security invoker): this log, `annual_return_change_log`
  (a figure path as the field, `changed_by` as the name) and `client_liberal_log`,
  one shape, newest first.
- Page `/change-history` (`src/pages/ChangeHistoryPage.tsx`): filters client,
  month or financial year, page (a group of tables), person, date range (India
  time); who, when, client, month, page, action and "field: old → new" per line;
  a manual-entry allowance shows as "manual (allowed by X: reason)"; Load more
  (200 at a time); Export Excel (one sheet row per changed field, up to 5,000
  changes, needs Export data).
- **History** on ITC Summary, Suspended Reco, GST Receivable Reco, Import 2B,
  2B Reconciliation, Filing Status (the month, all clients), GSTR-1 and GSTR-3B:
  opens the page filtered to that client and month
  (`src/components/history/ChangeHistoryButton.tsx`).
- Who may see it: superadmin and GST Manager, and employees whose position has
  the key `view_change_history` ("Change history", Returns & filing group).
  Like the version history screens, it is an explicit key, off by default.
- Pure parts in `src/lib/changeHistory.ts` (pages, labels, filters, lines,
  export); checked by `node scripts/verify-change-history.mjs`.

## 6. Speed and size

Local PostgreSQL 16, as the public key with the app's header (test_90):

| | without the logger | with it |
|---|---|---|
| Import 2B insert, 1,000 rows | 5–8 ms | 87–118 ms |
| ledger update, 1,000 rows | 6–10 ms | 108–152 ms |
| ledger delete, 1,000 rows | | 45–81 ms |

(five runs of `supabase/tests/change_log/test_90_timing.sql`; the test fails above 1 s)

A log row is about 960 bytes for an Import 2B insert, 720 for a ledger delete,
460 for a ledger update (heap only; the three indexes add about 150 bytes).

Volume, from the live write counters (21 Oct 2026, 167 days since the last
reset) over the attached tables: about 22,300 inserts, 13,800 updates and 7,600
deletes per 30 days, so about 44,000 log rows and 36 MB per 30 days, about 440
MB a year. That is an upper bound: updates that change nothing are not logged,
and the biggest writers are the Not in Books carry-forward copies (deleted and
re-inserted each month, about 15,500 rows) and e-invoice pulls (about 8,000).
The live database was 137 MB. Watch `pg_total_relation_size('public.gst_change_log')`
monthly; if it matters, the firm decides a retention period (section 4) rather
than logging less.

## 7. Known limits

- Builder rows deleted together with their project (cascade) are logged with
  no client: the project is gone when they are read. The project's own delete
  row names the client, in the same transaction (`txid`).
- `rcm_masters` and `expense_head_mappings` have no client.
- A tab opened before the release, and an extension before 0.17.0, send no
  header: their writes are logged with the row's stamp, or no person.
- The extension names a person only for jobs the app started (`actorId`).
- Server-side bulk work (backfills in a migration, pg_cron) is logged as
  `system`, row by row.

## 8. Adding a table

In a new migration: `SELECT public.gst_change_log_attach('my_table', ...)`.
Arguments: `p_client` (SQL on the row `r`; default `r.client_id`), `p_month`
(default `r.period_month`, any spelling), `p_fy`, `p_summary` (JSON columns kept
as fingerprints), `p_skip` (columns never compared), `p_only` (log only these
columns), `p_mode` (`full` or `history`), `p_label` (the row's name; by default
the first two of the usual name columns). It checks the expressions and column
names against the table, so a mistake fails the migration, never a save. Add
the table to a page in `HISTORY_PAGES` (`src/lib/changeHistory.ts`).
