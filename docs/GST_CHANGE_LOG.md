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
transition tables (one `INSERT ... SELECT` per statement, not one per row). Each
table has its own logger function, `gst_change_log_for_<table>`, written by
`gst_change_log_attach()` (section 8); `gst_change_log_tables` lists every
attached table and how it is read.

**Full** (insert, update, delete, truncate), 95 tables:

- Import 2B and 2B Reconciliation: `twob_import_docs`, `books_register`,
  `bills_not_in_2b`, `bills_not_in_books`.
- ITC and the recos: `itc_summaries`, `suspended_reco`, `gst_receivable_reco`.
- Prior months (migration 20261021100000): `twob_ever_filed` (every return
  ever filed, and a reopen with who and why), `twob_filed_figures` (a filed
  month's frozen 4B(2), 5.4 and 4D(1.2); a GST Manager's reopen deletes them,
  and the deleted figures stay in the log), `twob_carry_log`.
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
- Every `builder_*` table (30), except the classification history below, and
  the BU confirmation e-mails `builder_bu_confirm_requests` (migration
  20261021140000: who it went to and which units, never the link's token).

**Record** (insert, update, delete; the payload as a fingerprint; a deleted row
kept whole), 3 tables: `gstr1_upload_versions`, `gstr1_upload_versions_quarantine`,
`gstr3b_push_versions`. A GSTR-1 upload or a GSTR-3B push shows in the history
when it is made, with who, the status and the summary.

**History** (update and delete only; a deleted row is kept whole), 9 tables:
`twob_versions`, `itc_versions`, `rcm_versions`, `gst_update_versions`,
`gst_update_row_versions`, `client_scheme_history`,
`builder_unit_classification_history`, `audit_log`,
`builder_bu_confirm_answer_history`. A new version is itself the
record, so its insert is not logged again; anyone switching one off, editing a
snapshot or deleting a version is.

The sibling migrations' tables are attached only if they exist when this
migration is applied (attach skips a missing table): apply it last (its
header).

**Not logged again:** `annual_return_docs` (complete per-figure log in
`annual_return_change_log`), shown in the same history view. The Liberal switch
is logged on `clients` too (round 2: `client_liberal_log` goes when the client
is deleted, this log stays); the view shows `client_liberal_log`'s row only for
a switch this log does not have (those made before it went live).
`filing_status_log` (20261021110000) and `reco_opening_log` (20261021120000)
are not merged into the view: every change they describe is a change of
`filing_status`, `suspended_reco` or `gst_receivable_reco`, which this log has
with the person, the old and new values and the manual-entry badge; what they
add is the pull outcome that changed nothing (refused, not found, failed, a
conflict), which the Filing Status and reco pages show from those logs. Not GST
working, not logged: the notices module (it has `notice_events`), staff and
positions (`staff_position_log`), portal job and sync tables, e-mail queues, and
the BU confirmation one-time codes (`builder_bu_confirm_codes`: private, RLS
with no policies; their hashes must not reach a log everyone can read).

**Never logged:** passwords. `clients` is logged only for `gstin`, `name`,
`registration_type`, `registration_date`, `selected_returns`,
`assigned_accountant`, the cancellation dates, `regular_sub_type`,
`builder_itc_type`, the areas, the target date groups, `inactive_at_hand`,
`gstr1_import_mode`, `notices_handled`, `notices_tracks_off`,
`einvoice_applicable`, `einvoice_exemption`, `gst_user_id`,
`gst_password_changed_at`, and the Liberal switch (`liberal_2b_reconciliation`,
`liberal_changed_by`, `liberal_changed_at`). A portal password change shows as
its date.

## 2. A log row

| Column | |
|---|---|
| `at` | the transaction's time (`now()`): every row of one save has the same time |
| `table_name`, `row_id`, `row_label` | the table, the row's key, and its name for people (supplier and invoice number, the return type, the unit number; up to 120 characters) |
| `client_id`, `period_month`, `financial_year` | the client (builder rows through their project or unit, also when the delete of a parent cascaded to them), the month as `MM/YYYY` whatever the table's own spelling (`Sep-26`, a date, `MMYYYY`), the financial year for FY tables |
| `fy` | the financial year of the change: `financial_year`, else the year of `period_month` (`2026-27`); the history's year filter reads it alone (index `gst_change_log_fy_at`) |
| `op` | `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` |
| `actor_id`, `actor_name` | who; the name is resolved when the row is written, so it stays after the person is removed |
| `actor_source` | `app`, `extension`, `agent`, `system`, `unknown` (section 3) |
| `actor_basis` | `header` (the request named the person), `row` (a saved-by stamp this change wrote), `none` |
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
  A part added or removed (a new row of a table) is listed leaf by leaf, from or
  to empty. The walk goes 20 levels deep at most: no working nests deeper, and
  below that a part that differs is one leaf kept as fingerprints (`"deep": true`),
  so a crafted document cannot make the logger fail.
  Large ones (named per table: GSTR-1 `raw_json`, version snapshots, upload and
  push payloads, the portal's `raw` / `full_json` / `profile_json`), and any JSON
  over 64 KB, as a fingerprint: `md5`, `bytes`, key or item count, and on UPDATE
  the top-level keys that changed (`"keys_changed": ["hsn"]`). A deleted history
  row (a version) is kept whole.
- `TRUNCATE`: `{"rows": n}`.

A statement whose rows the logger cannot read (only a wrong expression in a
table's attach could do that; the ones in the migration are column reads and
lookups that cannot fail) is refused with the database's error, whose context
names `gst_change_log_for_<table>`: nothing changes without its trace. Round 1
logged such a statement in part instead, but that needed an exception block,
a subtransaction on every logged statement (round 2 review). The app still
reads the round 1 `_error` / `_partial` shape; no such row is written.

## 3. Who did it

The app has no Supabase auth session (`auth.uid()` is NULL), so the database
cannot know the user by itself. Every request to `/rest/v1` carries:

- `x-gst-actor`: the id of the user signed in **in that tab** (staff
  `user_id`, or the client id on the client portal). AuthContext sets it
  (`setChangeLogActor`) whenever its user changes, before React renders the
  change; it is never read from the saved sign-in at request time, which a
  sign-in in another tab overwrites while this tab still shows, and saves as,
  its own user (round 2; `scripts/verify-change-log-actor.mjs`);
- `x-gst-source`: `app`, `extension` or `agent`;
- `x-gst-request`: the page and a short id (`/itc-summary 4f3a2b1c`).

App: `src/lib/changeLogHeaders.ts`, the Supabase client's `global.fetch`
(`src/integrations/supabase/client.ts`). Extension 0.17.0: `background.js`
(`actorHeaders`), with the app user's id while a job the app started is running
(the job's `actorId`): every start message the app sends carries `actorId:
user.id` (reco Pull, Filing Status Portal and filing page, Import 2B pull,
Reports Hub and GSTR-9 section pulls, Company List / Notices bulk pulls, GSTR-1
upload, e-invoice pull, GSTR-3B push), `appbridge.js` passes it on, and every
`start*` keeps it on the job. A job someone queued (`portal_jobs.requested_by`)
names them on both runners: the scheduled Chrome runner (`runner.js`, the live
runner; round 2, `extension/test/18-runner-actor.test.mjs`) and the office
agent (`agent/src/jobStart.ts`). A scheduled sync names no one. Office agent:
`agent/src/db.ts` (`x-gst-source: agent`).

PostgREST puts request headers in `request.headers`; `gst_change_log_context()`
reads them. **CORS, checked in Chromium on 21 Oct 2026 against the live
project:** the API gateway's preflight on `/rest/v1` allows the requested
headers (`access-control-allow-headers: apikey,authorization,x-client-info,x-gst-actor,x-gst-request,x-gst-source`),
and a harmless GET of one client id with the headers returned 200. Each Edge
Function lists its own allowed headers (`authorization, x-client-info, apikey,
content-type`) and the browser refused the same headers there, so the app adds
them only to `/rest/v1` requests (never to `/functions/v1` or `/storage/v1`).

Without the header a person is named only from a saved-by stamp the change
itself wrote: on INSERT the row's first filled stamp (`updated_by`,
`imported_by`, `posted_by`, `created_by`, ...); on UPDATE only a stamp column
whose value this statement changed. A stamp left as the last editor set it is
never used: a scheduled pull, an old extension or a service-key remark that
follows Gita's save is not Gita's (`actor_id` NULL, `actor_basis = 'none'`, "no
person recorded"). A stamp written again with the same value is not proof
either. Rows named from a stamp are `actor_basis = 'row'` ("from the saved-by
field this change wrote"); the extension or agent is then the doer, "Extension,
saved as Gita", never "for Gita". A DELETE has no stamp of its own: without the
header no person is recorded.

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
  (a figure path as the field, `changed_by` as the name, matched to the one staff
  member of that first name as `actor_id`) and `client_liberal_log`, one shape.
  Newest first is `ORDER BY at DESC, seq DESC`: `seq` is this log's id (index
  `gst_change_log_at_id`), the Annual Return log's id negated, a Liberal switch's
  below both; the ranges never meet and stay within what a browser reads exactly.
- Paging is keyset: the next page is `at <= last.at AND (at < last.at OR seq <
  last.seq)`, so changes saved while the page is open never repeat or hide a row.
- Every read leads with its narrowest filter: the client, else the month, else
  the financial year (`fy`), else the person. That filter is sent as a range of
  one value (`gte` and `lte`) and the read is ordered by it first, so the
  database reads that filter's index (`gst_change_log_client_month_at`,
  `gst_change_log_month_at`, `gst_change_log_fy_at`, `gst_change_log_actor_at`)
  and stops after a page. Sent as an equality alone, the planner may read the
  whole log newest first, hoping to meet the rows soon: a quiet year or month,
  or a year with no changes at all, then read all of it (round 2 review: 160 to
  830 MB, past the live 3 s limit once out of cache). test_70: every page query
  0.05 to 5 ms on 200,000 rows spread over two years, no read of more than a
  client's own rows.
- Page `/change-history` (`src/pages/ChangeHistoryPage.tsx`): filters client,
  month or financial year, page (a group of tables), person, date range (India
  time). With no client, month, year or dates it shows the last 30 days. Who,
  when, client, month, page, action and "field: old → new" per line; an added
  or removed JSON working (the ITC Summary's first save) reads as its figures,
  cell by cell ("Figures: Table 4A, 5.1, IGST: 1,000"; empty and zero ones left
  out). A manual entry shows the badge "manual (allowed by X: reason)": on the
  allowance's own rows (given, used, taken back) and on the working that points
  at it (`manual_allowance_id`, `opening_allowance_id`; "manual" alone for
  `filed_source` / `opening_source` = manual). Load more (200 at a time).
  Export Excel: pages of 500 (the API sends at most 1,000 rows a request), one
  sheet row per changed field, text never cut, up to 5,000 changes, an "About"
  sheet with the filters and whether the file is complete; needs Export data.
- A page's rows: its tables, plus for GSTR-1 and GSTR-3B the Filing Status rows
  of their returns (`row_label` is the return: the Nil switch, Pushed, Filed),
  plus the manual allowances for its scope (`filing:*`, `filing:GSTR-3B*`,
  `reco:suspended`, `reco:receivable`).
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

| | without the logger | with it (round 2) | round 1 |
|---|---|---|---|
| Import 2B insert, 1,000 rows, one statement | 5 ms | 46 ms | 86–145 ms |
| ledger update, 1,000 rows, one statement | 7 ms | 87 ms | 109–192 ms |
| ledger delete, 1,000 rows, one statement | | 37 ms | 50–94 ms |
| 1,000 one-row updates (a row-by-row function) | 12 ms | 170–200 ms | about 1,000 ms |
| 1,000 updates of no row | 4 ms | 8 ms | about 550 ms |
| 1,000 deletes of no row | 3 ms | 7 ms | about 170 ms |

(`supabase/tests/change_log/test_90_timing.sql`, which fails above 1 s for the
bulk statements, 0.7 s for the one-row loop and 0.1 s for the loops of no row,
and if 100 logged statements in one transaction open any subtransaction.)

How the logger stays cheap (round 2): each table's logger is plpgsql with
fixed SQL, so a connection plans it once; a statement that changed no row
returns after one read of its transition table; the request headers are read
once per transaction while they stay the same (`gst_change_log.context`); no
exception block, so no subtransaction (round 1 opened one per statement, and
after 64 in one transaction the cache overflowed); the helpers it calls are
plpgsql, not sql (PostgreSQL plans an sql function's body again in every
statement that calls it); a row with no JSON column is read by built-in
functions; the person's name is a function call, not a subquery (a subquery
there made a 2,000-row update read its join 2,000 times: 1.3 s, now 0.24 s).
What remains is the log row itself (seven indexes) and, on UPDATE, comparing
the old and new row: about 0.1 ms a row, and about 0.15 ms for each statement
that changes a row.

**A function that saves row by row** pays that 0.15 ms per statement. The prior
months branch's timing test (`supabase/tests/twob_simple/test_80_timing.sql`,
migration 20261021100000) run with this migration applied, on this machine
(shared, so a spread):

| step | without the log | round 1 (review) | round 2 |
|---|---|---|---|
| 1,000-row Post preview | 340–515 ms | 1,322–1,534 ms | 690–920 ms |
| 1,000-row Post applied | 307–458 ms | 1,531–1,790 ms | 730–960 ms |
| 1,000 removals (3,000 statements, 5,000 rows logged) | 536–833 ms | 2,818–3,608 ms | 1,370–1,820 ms |
| 1,000 entries into six later months (7,000 rows logged) | 412–697 ms | | 880–1,390 ms |
| guarded update of 2,000 rows (one statement) | 141–185 ms | 576–637 ms | 460–520 ms |

All stay well under the live 3 s limit. Three of that test's own budgets (1 s
for the removals and the six-month insert, 0.5 s for the guarded update) are
exceeded with the log: that is the cost of logging thousands of rows written by
thousands of statements, not of the logger's machinery. Its functional tests
all pass with this migration applied.

A log row is about 960 bytes for an Import 2B insert, 720 for a ledger delete,
460 for a ledger update (heap only; the four indexes add about 200 bytes).

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

- `rcm_masters` and `expense_head_mappings` have no client.
- A builder row whose parent link is set to NULL by a delete (`ON DELETE SET
  NULL`, e.g. a credit note's booking) is logged through its other parent (its
  unit); a row with no other parent would be logged with no client (none of
  today's tables).
- A tab opened before the release, and an extension before 0.17.0, send no
  header: their writes are logged with a stamp they wrote, or no person. Raise
  `MIN_EXTENSION_VERSION` to 0.17.0 once every office Chrome runs it.
- The extension names a person only for jobs the app started or someone queued
  (`actorId`, both runners); scheduled syncs and the popup's own pulls name no
  one.
- `annual_return_change_log` goes with a deleted client (ON DELETE CASCADE), as
  `client_liberal_log` does. Today a client with Annual Return workings cannot
  be deleted (`annual_return_periods` keeps it), so nothing is lost; the Liberal
  switch is now in this log too.
- Server-side bulk work (backfills in a migration, pg_cron) is logged as
  `system`, row by row.

## 8. Adding a table

In a new migration: `SELECT public.gst_change_log_attach('my_table', ...)`.
It writes the table's logger function (`gst_change_log_for_my_table`) and its
four triggers.
Arguments: `p_client` (SQL on the row `r`; default `r.client_id`), `p_month`
(default `r.period_month`, any spelling), `p_fy`, `p_summary` (JSON columns kept
as fingerprints), `p_skip` (columns never compared), `p_only` (log only these
columns), `p_mode` (`full`, `history` or `record`), `p_label` (the row's name; by default
the first two of the usual name columns). It checks the expressions and column
names against the table, so a mistake fails the migration, never a save. Add
the table to a page in `HISTORY_PAGES` (`src/lib/changeHistory.ts`).

**A migration that renames or drops a column of a logged table must attach the
table again** (same arguments, in the same migration): the logger's SQL names
the columns its key, client, month, label and saved-by stamps come from, and a
save whose logger cannot run is refused. New columns need nothing: rows are
read whole. A builder table whose client comes through a parent that a delete
can cascade from also needs its parent in `gst_change_log_keep_client()` and in
the list that attaches `gst_change_log_keep` (section 6 of the migration).
