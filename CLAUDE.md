# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Permanent rules (project-specific, do not violate)

- **Supabase project is `gcquafqxbykxkbexcdpy`.** This is the only backend. The credentials in `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`) point here. `.env` and `supabase/config.toml` both point here. Never reintroduce the old Lovable project id `mlgxmhzlqykwdvvybhnk`.
- **Ignore the `SUPABASE_PROJECT_REF` environment variable — it is wrong.** It is set to `hubyywmodekfdzhwiumb`, which is a *different, live* Supabase project on the same account ("info@vjdesai.com's Project"). Applying a migration to it would hit real data belonging to the firm. Always pass `gcquafqxbykxkbexcdpy` explicitly. `SUPABASE_ACCESS_TOKEN` is correct and can reach all three projects on the account, so nothing stops a wrong-project write except naming the ref by hand.
- **Apply DB migrations directly to project `gcquafqxbykxkbexcdpy`.** Add a new timestamped file under `supabase/migrations/` AND apply it to the live project — both must stay in sync. There is **no migration ledger**: this project has never been Supabase-CLI-managed, so `supabase_migrations.schema_migrations` does not exist and nothing records which files were applied. The directory is a convention held together by discipline; verify by checking that the objects a migration declares actually exist.
- **RLS policies must be open to `public`.** This app does not establish a Supabase auth session — it authenticates through its own `localStorage` session and talks to Postgres with the anon key, so **`auth.uid()` is always NULL at runtime**. Any policy gated on `auth.uid()` or `is_staff(auth.uid())` fails closed: reads come back empty, writes are rejected, and the build stays green. Use `FOR ALL TO public USING (true) WITH CHECK (true)` and let login, staff-only routing and the permission keys be the gate. The deliberate exceptions are `portal_sessions` (RLS on, *no* policies), because those rows are session cookies reached only by the service-role key on the agent runner, and on the same footing `client_password_resets` / `client_password_reset_attempts` / `client_password_log` (reset-link hashes, and records that would show which GSTINs are clients; reached only by SECURITY DEFINER functions and the service role, staff read the log through `client_password_log_for`). Note also that the Supabase **management API bypasses RLS**, so tests run through it will pass against policies that break the app — verify writes with the anon key from `.env`.
- **Run `npm run build` and `npm run typecheck` before committing.** Both must be green. `vite build` does not type-check, which is how queries naming columns that do not exist shipped to production; `npm run typecheck` (scripts/typecheck.mjs) fails on any type error in the notices & litigation module and on any new error elsewhere (existing ones are frozen in `scripts/tsc-baseline.json`).
- **Never edit via Lovable.** This repo has been migrated off Lovable; all changes happen through Claude Code. Do not rely on Lovable round-tripping, and ignore the Lovable instructions still present in `README.md`.
- **Unsubscribe from PR activity right after creating a PR, unless asked to watch it.** Still open a (draft) PR after every push, as usual. The platform auto-subscribes the session to the new PR's activity the instant `create_pull_request` returns — this is not something choosing not to call `subscribe_pr_activity` prevents, confirmed live on 2026-08-14 (PR #51 got a `subscription.created` system event despite no explicit subscribe call). So the actionable move is the opposite: call `unsubscribe_pr_activity` on the just-created PR immediately afterward, before ending the turn, unless a human explicitly asked this session to monitor/babysit that specific PR. Left subscribed, every GitHub event on the PR — including noisy third-party bot comments like a Vercel deploy-status ping on every push — gets relayed into the session as a wake-up.

## Commands

- `npm run dev` — Vite dev server on port 8080 (host `::`)
- `npm run build` — production build (run before every commit)
- `npm run typecheck` — type-check gate (run before every commit; `-- --update-baseline` only after fixing errors)
- `npm run build:dev` — development-mode build
- `npm run lint` — ESLint over the repo
- `npm run preview` — preview the production build

There is no test runner configured in this project.

## Architecture

Single-page React 18 + TypeScript app built with Vite (SWC), styled with Tailwind + shadcn/ui (Radix primitives in `src/components/ui`). It's a GST practice-management tool for a CA firm: staff manage clients, GST filings, 2B reconciliation, RCM, and ITC summaries; clients get a read-only-ish portal.

**Backend.** All data and auth go through Supabase (`@supabase/supabase-js`). The typed client lives in `src/integrations/supabase/client.ts` (auto-generated header — configured from `.env`), and `src/integrations/supabase/types.ts` holds generated DB types. Data fetching is done with direct `supabase.from(...)` calls and `@tanstack/react-query`.

**Auth is custom, not Supabase Auth's email flow.** `src/contexts/AuthContext.tsx` is the heart of it:
- Four roles via the `app_role` enum: `superadmin`, `gst_manager`, `employee`, `client`.
- Login calls Postgres RPCs: `authenticate_staff` and `authenticate_client` (clients log in by GSTIN or `client_user_id`, not email). First-login password changes go through `complete_first_login` / `complete_client_first_login`; staff snapshot via `get_user_snapshot`.
- Session is persisted in `localStorage` under the key `vjdesai_user` (a fallback layer alongside Supabase's own session).
- Permissions: `superadmin` and `gst_manager` implicitly have everything. An `employee` holds ONE position (`profiles.position_id` → `staff_positions`), and the position carries the keys (`staff_position_permissions`); a GST Manager / superadmin may also give one person extra keys on top of their role (`staff_user_extra_permissions`, only through `staff_set_user_extras`; never make a role for one person); the DB derives `user_permissions` = role keys ∪ extras and refuses direct writes (`20261014120000_staff_positions.sql`, `20261025100000_staff_roles_and_extras.sql`, tests `supabase/tests/staff/`). Keys, labels and groups live in `src/lib/permissionCatalog.ts`; checks go through the `can*()` helpers on the auth context — use those rather than checking roles directly. Positions are managed only by GST Manager / superadmin (Settings → User Control). Passwords change only through `staff_set_password` / `staff_set_client_password`, which check who is acting. Levels (`user_roles`) change only through `staff_set_level` / `staff_add_level` / `staff_remove` (a trigger refuses direct writes; the GST Manager level is the superadmin's alone, with their password; changed in Settings → User Control → People or Dashboard → User Management); `staff_end_sessions` signs a person out everywhere (`profiles.sessions_ended_at`, checked by AuthContext) — `20261017100000`/`110000`/`140000`/`150000` (a GST Manager's or the superadmin's sessions only by the superadmin, with their password), tests in `supabase/tests/staff/`. Clients reset their own password by e-mailed link (`/reset-password`, the `client_password_reset_*` RPCs, Edge Function `client-password-reset`, never `email_outbox`), and every staff level may reset a client's (logged in the private `client_password_log`); the link's address is fixed to `https://gst.vjdesai.com`, never read from a setting; one lock order, the limits lock (requests and staff links, so the hourly limits are hard), then the `clients` row, then the client's advisory lock; Edit Client's GST-password sync leaves the client's reset link and waiting request alone (`p_close_resets`) (`20261020140000`, tests in `supabase/tests/client_password/`); read `docs/CLIENT_PASSWORD_RESET.md` first.

**Global state** is three nested React contexts (see `src/App.tsx`), in order: `AuthProvider` → `MonthProvider` → `ClientProvider`.
- `MonthContext` holds the selected GST return period as a `MM/YYYY` string, defaulting to the **previous** month (returns filed this month are for last month).
- `ClientContext` holds the currently selected client id. Many pages are scoped by the (month, client) pair.

**Routing.** `react-router-dom` in `src/App.tsx`. `/login` is public; everything else is nested under `MainLayout` (sidebar shell). Pages live in `src/pages/` (Dashboard, Clients, 2B Reconciliation, 2B & RCM, Suspended Reco, ITC Summary, RCM Summary, Manage Masters, Filing Status, GST Running Update, GSTR1 Data, Manage Employees, User Control, Settings).

**Change log.** Every change to a GST working table (2B, ledgers, ITC, recos, filing status and the prior-month tables, GSTR-1/3B, RCM, advances, builder incl. BU confirmations, client GST fields, scheme changes and the Liberal switch, portal pulls incl. DRC-03 and refunds, manual-entry allowances; 109 tables) is kept append-only in `gst_change_log`: a row trigger keeps each changed row in the unlogged `gst_change_log_stage`, and at COMMIT a deferred trigger (`gst_change_log_flush`) writes the log rows, each table by its own `gst_change_log_for_<table>` written by `gst_change_log_attach` (migration `20261021150000`, sorts after the other 21 Oct migrations); the log of a transaction is visible only once it commits (`SET CONSTRAINTS public.gst_change_log_flush IMMEDIATE` to see it earlier), and a save whose log cannot be written fails its COMMIT, never saved untraced, so **a migration that renames or drops a column of a logged table must attach it again**. The person comes from the `x-gst-actor` / `x-gst-source` headers the app (`src/lib/changeLogHeaders.ts`, the tab's own user set by AuthContext, `/rest/v1` only), extension 0.17.0 (the app user's `actorId` on every job the app starts; the requester on queued jobs, Chrome runner and agent) and the agent send, else only a saved-by stamp the change itself wrote; builder rows deleted by a cascade keep their client (`gst_change_log_gone`). Read on `/change-history` (keyset pages by `(at, seq)`, each read led by its client, month, year (`fy`) or person as a one-value range so it reads that index; last 30 days unless a client, month, year or dates are chosen; a deleted client by the name and GSTIN its delete logged) and the pages' History buttons (key `view_change_history`); a new GST table gets `SELECT gst_change_log_attach(...)` in its migration (`p_private` for a token). Read `docs/GST_CHANGE_LOG.md` first.

**GST data reminders** (Settings → GST Reminders, `/reminders`): the dates live in `supabase/functions/_shared/reminderPlan.ts`, shared by the daily job `queue-gst-reminders` (pg_cron 9:30 IST, last month's period and this month's) and the page (`src/lib/reminderPlans.ts`). GSTR-1, GSTR-1 (IFF), GSTR-3B, GSTR-3B (Q, 22nd / 24th by state), GSTR-6 and GSTR-7 follow a period's own dates (`reminder_period_plans`, any day from the first of the period month to the due date) or else the standard days of the following month (`return_reminder_schedules`); at most one reminder a client, return and period a day, only the latest step whose date has come, nothing after the due date, a reminder queued before a step's date not standing for that step, a cancelled one never re-queued, each step deduped (`email_outbox.dedupe_key`); other returns keep the per-client interval ladder (`20261024150000`, `node --experimental-strip-types scripts/verify-reminder-plan.mjs`).

**Database.** Migrations are timestamped SQL files in `supabase/migrations/`. They define the enums (`app_role`, `registration_type`, `filing_status_type`, `return_type`), RLS policies (gated via the `has_role` SQL function), and the RPCs the auth flow depends on.
**Path alias.** `@/` → `src/` (configured in `vite.config.ts` and `tsconfig`).

**Other notable libs:** `react-hook-form` + `zod` for forms, `recharts` for charts, `jspdf`/`jspdf-autotable` and `xlsx` for PDF/Excel export, `date-fns`, `sonner` + the shadcn toaster for notifications.

## Builder module (GST on real estate promoters)

A self-contained module for promoter clients (`clients.regular_sub_type = 'Builder'`):
project and unit masters, bookings and receipts, BU events and the unit-wise
differential, a corrections layer, TDR/FSI reverse charge, and working papers.
Engines are `src/utils/builder*.ts`, data access `src/lib/builder*.ts`, pages
`src/pages/Builder*.tsx`, schema `supabase/migrations/*_builder_phase*.sql`.

**Read `docs/BUILDER_GST_POSITIONS.md` before changing anything here.** Several
behaviours are the firm's elected *positions*, not obvious defaults — the flat
18% on delay interest departs from s.15(2)(d) deliberately, bounce reversals are
unavailable on invoiced amounts, the BU cut-off deducts value *taxed* rather than
value *received*, and the 1%/5% cap on FSI is summed per unit rather than
blended. Changing one of these without reading why it is that way will produce
wrong tax, not just a failing test.
BU agreement value confirmation: one e-mail per send to typed To/CC addresses, one link listing the outstanding units; only an address on the e-mail may answer, proved by a 6-digit code e-mailed to it (Edge Function `bu-confirm-code`, never `email_outbox`, no Sent Items copy; hashes in the private `builder_bu_confirm_codes`, RLS on and no policies like `client_password_resets`), never the firm's own (`vjdesai.com`, staff profile e-mails: staff clear a unit only through the override); the send carries what the pop-up showed, so a dispute given meanwhile stops it and a dispute asked about again is kept in `builder_bu_confirm_answer_history`; a unit left unticked gets a `NOT_SENT` row that still blocks filing; a newer request replaces the earlier link only once its e-mail is out; the posting gate still reads `builder_bu_agreement_confirmations`; the public key only reads the requests, the per-unit rows and the history, and the trigger `builder_bu_confirm_write_guard` refuses any write the send, the answer or Accept did not make; a unit's own token answers only for a per-unit e-mail of before 21 Oct 2026, and only by `legacy_emails`, recorded once when the migration is applied (never from `clients.email` or `email_outbox`, which the public key can write); a caller (one IPv4 address or IPv6 /64) gets 5 codes an hour and 10 a day to an address on a link (a proof holds on one link only) and 20 a day over all links, and over every link and caller at most 40 codes are e-mailed a day to an address (none on a link with nothing open); each code e-mail is marked with a reference the page shows next to the Code box (never "the latest e-mail"), and a code whose digits are typed on another page is spent (`typed_elsewhere_at`), so that answer is no free guess; the proof lives only in the tab's sessionStorage (`20261021140000`, `20261021160000`, tests `supabase/tests/bu_confirm/run.sh`, `deno test --allow-read supabase/functions/bu-confirm-code/test/` and `node scripts/verify-bu-confirm.mjs`, §6 of the positions doc).

**Filing Status is pulled only** (20261021110000, extension 0.15.0; released inside 0.17.0, which also carries 0.16.0's reco pull and push gate and the change log's headers; `MIN_EXTENSION_VERSION` 0.16.0): Filed, ARN, filing date and PDF come from `filing_record_pull` (the extension's checked pull, for a staff member's request, PDF only at this project's return-pdfs address) or `filing_attach_manual`; pulled only are GSTR-1 and GSTR-3B (a manual upload needs a superadmin's `manual_source_allowances` entry, closed by a pull that lands the checked PDF), while GSTR-1 (IFF), GSTR-3B (Q), GSTR-6 and GSTR-7 keep a manual route until their pull is proven (`filing_pull_only` / `PULL_ONLY_RETURN_TYPES`, `filing_manual_reason`; proven = `filing_pulls_landed()`), as CMP-08 / ITC-04 (no pull), and the period's return decides a manual upload (`filing_effective_return_type` / `manualRuleType`: a monthly client's IFF / 3B (Q) twin row never files its GSTR-1 / 3B by hand); a pull without a checked PDF (or an accepted conflict) never takes a PDF attached by hand off (marked "attached by hand, not checked by a pull", `pdf_note`; only 0.14.0's own stored PDFs go) and keeps a typed date marked (`date_note`); a refused pull writes nothing; the page waits while the extension says the pull is running (`PullWatch`, `returnPullStatus`); a scheme change never takes a return off Filed, the extension runs one pull at a time and reports any it drops, the migration refuses to apply before 20261021100000; a trigger refuses every other write and any move of a filed row, side effects of Filed run in the database (no e-mail until the portal's date is read), every change is in `filing_status_log`; the allowance block is byte-identical with the reco branch's 20261021120000; read `docs/FILING_STATUS_PULL_ONLY.md` first.

## Import 2B → 2B Reconciliation → Suspended Reco → GSTR-3B

`twob_import_docs` / `books_register` (Import 2B tab) is the **only**
data-entry surface for 2B classification, RCM aside. There is no "Post to
Reconciliation" (the firm, 21 Oct 2026): every Import 2B save writes through,
in the database and in the same statement, to the live `bills_not_in_2b` /
`bills_not_in_books` ledger that ITC Summary, Suspended Reco and
month-to-month carry-forward already read from, by Post's rules
(`planImport2BPost` in `src/lib/postImport2B.ts`, mirrored row for row by the
triggers of `20261021170000_import2b_autopost.sql`; a save that would take
back an entry holding a reclaim, Expense out or book entry is refused and
says where to undo it, e.g. Pending items' Booked list). A save that changes
the ledger needs Import 2B & post (`work_2b_import`, DB: the user
`x-gst-actor` names, a pairing call's `p_actor_id`, a delete taking an entry
off included; the page asks each save first with
`docChangeTouchesLedger` / `bookSaveTouchesLedger`, and every other save stays
open to all staff, a books row's pairing that changes nothing on the ledger
included). A reclaim (`twob_import2b_reclaim`), a document out of
Reclaim (`twob_import2b_unreclaim`, only while it evidences the reclaim the
page shows on its row, `p_expect_entry` from `loadReclaimEvidence`; a pair
named before the one-reclaim rule leaves with either, both released) and a
books row's pairing (`twob_import2b_save_book`) are one call each, all or
nothing. The money
rules are database invariants, whatever screen, tab or app version writes:
an entry newly names a 2B document only while it is Reclaim and no other
entry names it (trigger `twob__reclaim_via_check`, the document locked while
it checks; it holds on live, where the unique index
`bills_not_in_2b_reclaimed_via_uq` cannot be made because a filed July
document already evidences two reclaims, left as filed; the index is a second
hold where the data allows), so the app of before's Reclaim (entry before
document) is refused once this migration is applied, and the reclaim call
also refuses, in the page's words, a document already evidencing one or no
longer holding the treatment the page showed (`p_expect_action`); a document
stays Reclaim, and undeleted, while an entry is reclaimed against it
(`twob__reclaim_evidence_guard`: only `twob_import2b_unreclaim` and Delete 2B,
which release it first, take it out; one named while not Reclaim, recorded
before, can only become Reclaim); an entry names its reclaiming document only
while it holds the reclaim (`twob__reclaim_via_tidy`); Restore brings a
version's reclaim back only on those terms, else the entry comes back
Awaiting reclaim, named (`reclaims_back`); a reclaim comes back reclaimed
only with its document known exactly, never looked for by its amounts
(round 9): the one the version names, before the one the month's entry of
that id names, before the month's only original invoice or debit note that
is the same document (`twob_doc_ident`), this last only while it is the
version's only reclaim naming nothing that is that document, whatever the
amounts (round 11), and no other reclaim of the version takes it (round 10),
and is linked to it; otherwise, whenever the month holds any
2B document, Strict and Liberal alike, it comes back Awaiting reclaim, named
("reclaim it again on Import 2B"); only a Liberal client's in a month with no
2B document comes back as typed; a Restore never changes a 2B document and
names each Reclaim one it leaves evidencing no reclaim (`docs_left`, its ITC
counted nowhere), which Pending items' Link & Reclaim offers and its row
flags (`reclaimCandidateDocs`, `reclaimNoEvidenceNote`); Restore takes the month's Reclaim documents before the client's lock
(the saves' order: documents, client, entries), then the month's books rows
and documents without waiting (a delete of one running stops it with a plain
message, never a deadlock), and returns the month as it left it, which the
page records as the RESTORE version (the page hears its own Restore as its
own, as a Save); a books row is saved only while it
holds what the page loaded (changed columns only, guarded; `p_expect` on the
pairing and filed-month calls; one page's saves of a row one at a time,
`queueBookSave`; `src/lib/import2bGuardedSaves.ts`), and the treatment Save
writes each document only while it holds the treatment loaded; a re-import
skips and names a refused row, and keeps (and lists) a document gone from 2B
while it has a Not in Books entry (`src/lib/twobReimport.ts`). An own unlinked entry of the same bill is
linked instead of a twin only when it carries this month's reversal (in-2B)
month, and goes back to what it held (`adopted_from`), never removed, when
its row stops posting. A prior month's books row is saved with its entry
through the door (`twob_import2b_prior_save`, same linking); a month out of
step shows a line read in one statement (`twob_import2b_step`) and "Bring the
reconciliation up to date" (`twob_import2b_catch_up`; a filed month's line
shows its Not in 2B side only); the catch-up and a filed month's save write
only what their confirm showed (the preview's digest sent back; a month
changed meanwhile writes nothing; a filed month's save runs the door once and
digests what it saved); Import 2B keys every read and save result
to the (client, month) it was started for (`src/lib/viewReads.ts`, one count
never restarted; Pending items' buttons write only in that month, and only
while the entry still holds the decision the list showed); 2B Reconciliation
never reloads over unsaved edits or pending deletes (a banner instead; a
change heard during its Save is looked at again when it ends; Save sends only
the changed rows, each update and delete guarded by every column the row held,
its reclaim, Expense out, book entry and link with the figures, and keeps the
edits when it stops before writing; `src/lib/twobLiveSync.ts`,
`writeOpenMonthSave`); Delete 2B is one call, Clear Data one call a
month (both stop at once, never deadlock, when a save of the month is
running); versions are coalesced per minute, recorded as the saver's, and
carry each entry's link, which Restore (`twob_restore_version_linked`) puts
back; a decision carried into an open month from a filed month cannot be
changed there (`twob__carried_decision_guard`) (§15 of the doc; tests
`supabase/tests/twob_simple/` test_9a to 9n, `autopost.test.mjs`, `round3.test.mjs` to `round8.test.mjs`;
`node scripts/verify-twob-live.mjs`). `2B Reconciliation`
(`TwoBReconciliationPage.tsx`) is **read-only for Strict clients** (the
default) — display, export, version history/restore, and destructive Clear
Data only. A per-client `clients.liberal_2b_reconciliation` flag
(superadmin/gst_manager only, set from Edit Client or the Clients page's
Liberal / Strict pop-up; every switch logged in `client_liberal_log`) opts a specific client
into Liberal mode, which restores the full directly-editable page for that
client — see §5 of the doc below before assuming every client behaves the
same way.

**Read `docs/2B_RECONCILIATION_FLOW.md` before changing this flow.** The
per-document mapping (MATCHED/MISMATCHED claimed at the 2B value, INELIGIBLE
and ITC_OF_OTHERS excluded entirely, NOT_IN_BOOKS/NOT_IN_2B the only rows that
reach the ledger) and ITC Summary row 5.1's auto-link are elected positions,
not settled law — and were implemented without a firm sign-off conversation,
so treat them as reversible defaults pending confirmation, not fixed rules.
Import 2B reads every B2B sheet of the 2B Excel (§10 of that doc): debit notes
count like invoices in 5.1; credit notes fill row 5.3 "Debit Note" for Strict
clients (`full_2b` months only), or, parked Not in Books like an invoice, wait on the
ledger as negative rows and, once booked, are reduced in row 5.2 (the one ITC Summary
row that takes a negative head); amendments count only revised minus the
earlier version's `base_*`, or are HELD; a re-import merges, never wipes.
The books register takes invoices and debit notes only, never a minus amount: a booked supplier credit note waits for its 2B row (`bookHasMinus`, §10). Document meaning (type, sign, effect, colour) lives in `src/lib/twobDocs.ts`.
A books register "Debit note" is the client's purchase return: no effect until the supplier's credit note is in 2B (never posted; pairs with 2B credit notes only; §10). From 06/2026 Suspended Reco / GST Receivable Reco openings (and ITC utilised, DRC-03) come only from the extension's pull (`reco_record_pull`, 0.16.0, Nil returns too), or once from a manual entry the superadmin allowed (`manual_source_allowances`, shared with Filing Status), and their overrides are the superadmin's or a GST Manager's, with a reason, through `reco_override_opening` (rows never move month or client; every door logs who in `reco_opening_log`, which outlives a deleted client; `reco_source_guard`, `opening_override_guard`); one function, `gstr3b_push_gate`, gates the GSTR-3B push, its JSON and the extension (fails closed; every head must tally, not only the total), and a Push History row carries the database's own gate answer: an `ok` push it does not pass is recorded but never marks the return Pushed, and `mark_filing_pushed` refuses a GSTR-3B it does not pass; the GSTR-3B page keeps its draft, gate answer and filing status with the client and month they were loaded for, so a switch never sends another pair's draft (`src/lib/gstr3bSelection.ts`) (§14 of the doc; 20261021120000).
Prior months (§13, `20261021100000`): a month is prior once its GSTR-3B, its quarter's GSTR-3B (Q) or any later month's is Filed (unlock does not reopen it; `twob_month_state`, `src/lib/twobPriorMonth.ts`); there only a GST Manager or the superadmin changes books entries (Not in 2B, the books register, Not in Books typed without a 2B source; a Not in Books entry from a 2B document, and a carried copy of one (`twob_nib_2b_copies`), follows the filed 2B and never changes), through `twob_prior_books_apply` (preview; reaches each later copy of the same entry, later copies paired one to one with this month's rows and the own entries of the months between, on the reversal / in-2B month first, then on the document alone; an added entry reaches up to the open month, and is not added where a row the same call keeps already holds it; refuses while a later month has reclaimed or booked it), the DB guard `twob_guard` refuses every other write; filing carries a list once, into an open next month with no carried list only (`twob_carry_first`, recorded in `twob_carry_log`; an empty list counts as carried; never into a filed month, never again on a re-file, nor after a reopen), and out-of-order filings are repaired only by Re-run (GST Manager / superadmin, previewed, one month at a time, adds only into a filed month and marks it to be re-run on; Filing Status marks a filed month not carried until a Re-run from it, which is recorded even with nothing to add); Restore only on the client's latest month holding entries, its own entries only, carried entries kept, a version's own entry the month now holds as carried left out and named (`twob_restore_version`); 2B Reconciliation's open-month Save writes only the columns changed and only while a row still holds what the page loaded (`src/lib/twobPendingWrites.ts`); every writer takes the client's advisory lock before row locks, and the 2B Reconciliation figures a check reads for a prior month are recorded just before its first such change (`twob_filed_figures`), never taken from the saved ITC Summary, and any push-check read that fails blocks Push with the read named (`src/lib/pushRecoGate.ts`); a return Filed by mistake is reopened by a GST Manager / superadmin with a reason (`twob_reopen_filed`), never one still holding an ARN or a filing source (Unlock keeps both; the superadmin's Take off Filed clears them first; the client's lock is taken before the rows are read), and Filing Status keys its Import 2B row actions on the row's own return type (`filingRowTwobActions`: a GSTR-3B (Q) row on the GSTR-3B tab); tests `supabase/tests/twob_simple/run.sh` (applies the migration as a non-superuser).
"Email bills not in books" (Import 2B header, §11) mails the client its open Not in Books list as an
Excel working paper via `email_outbox` (`attachments`, `cc_email`) and `send-gst-email` v5 (`src/lib/billsNotInBooksMail.ts`).

GSTR-3B Table 3.1 / 3.2 from GSTR-1: which row a document goes to (SEZ SEWP/SEWOP, exports and their notes 3.1(b); R, DE, CBW, B2C 3.1(a)) is decided only in `src/lib/gstr1/supplyKind.ts`; total liability is 3.1(a) + (b) + (d) everywhere; amendments are flagged, never folded. Read `docs/GSTR3B_OUTWARD_POSITIONS.md` and run `node scripts/verify-gstr3b-outward.mjs` after any change there.

## GSTR-2A vs GSTR-2B reconciliation (Reports Hub)

The report `gstr2a-vs-gstr2b-reco` (`src/utils/gstr2aVs2bReports.ts`) matches the portal-pulled 2A and 2B
(`gst_filed_returns`) document by document and gives each difference a reason and an action. The engine
`src/lib/itcReco/` is generic over document sources, so GSTR-9 Table 8A (2A vs 8A, 8A vs 2B, all three)
plugs in as another source: the reports `gstr2a-vs-gstr8a-reco`, `gstr2b-vs-gstr8a-reco` and
`gstr8a-vs-gstr2a-vs-gstr2b-reco` (per FY; the 8A uploaded from the portal's Table 8A document details as
`GSTR9_8A`, or pulled by extension 0.18.0's `gstr9_8a_pull` (the portal's file as it came, `gstk-8a-pull-v1`, read by
`src/lib/itcReco/eightAPull.ts`), else rebuilt from the year's 2B; the three-way one judges each document and the FY's final ITC,
`src/lib/itcReco/threeWay.ts`). **Read `docs/GSTR8A_RECO_POSITIONS.md` first**; run `node scripts/verify-gstr8a-reco.mjs`. Pull uses
extension 0.13.0's `gstr2a2b_pull` (one login, per-month `want`); older extensions pull one return type per
click; 0.14.0's 2A pull also reads the credit and debit notes (`summary.cdn`, not confirmed live; a failed read
leaves them "Not compared" with `_meta.cdnProblem`). **Read `docs/GSTR2A_2B_RECO_POSITIONS.md` before changing a reason rule**; run
`node scripts/verify-itc-reco.mjs` after any engine change.

The view (`ReasonReconciliationView` + `views/reco/*`) reads `table.reco` (`viewModel.ts`: one signed row per
pair, aggregates by supplier / month / reason) and filters every facet through `src/lib/itcReco/filters.ts`;
several months merge through the report's own `merge` hook (a Month column, summaries recomputed), not period bands.

**Every Reports Hub download is a Big4 working paper:** `renderReportToExcel` / `renderReportToPdf` (async) go
through `src/lib/reportExport/` (`excel.ts` ExcelJS on demand, `pdf.ts` on the `reportTheme` letterhead), which
lay out any `ReportTable` from `layout.ts` (identification strip from the subtitle's "Label: value" parts, column
kinds from the values, TOTAL / period / section rows) plus its optional hints (`meta`, `kpis`, `columnGroups`,
`headerLabels`, `rowTones`, `extraSheets`). Checks: `scripts/verify-report-exports.mjs`, `verify-report-pdf.mjs`,
`verify-doc-table-model.mjs` (the table kit's filters, `views/tableKit/tableModel.ts`, shared by every view through `useTableKit`).

## GSTR-1 e-invoices (IRN)

**Read `docs/GSTR1_EINVOICE_POSITIONS.md` before changing any e-invoice code** (`src/lib/einvoice/einvoice.ts`, `excel.ts`, the GSTR-1 page's e-invoice parts, the extension's GSTR-1 upload or e-invoice pull): the elected mechanism is "keep, don't re-send" (e-invoices already on the portal with the same figures are left out of the upload; the app never writes irn / irngendate / srctyp), matching is by exact document identity only, and e-invoice clients are found by evidence, PAN-wide.

## Notices module

Data from the GST portal's notices, refunds, and LUT cases, synced by a
Chrome Extension (MV3, in `extension/`; the app refuses to sync from versions
below `MIN_EXTENSION_VERSION` in `src/lib/extensionVersion.ts`). The sync uses
upsert + soft-delete (`deleted_at` timestamp) — all notice queries filter
`deleted_at IS NULL`. DB triggers on `gst_notices` keep sync writes from blanking
`pdf_url`/`case_id`, protect `manual:` notices and turn hard deletes into soft
deletes; clients with notices or matters cannot be deleted (FK RESTRICT).

**Tables:** `gst_notices` (notices + tasks), `gst_case_folder_items`
(case-folder contents with `raw_json`, joined to notices on `(client_id,
case_id)`). Refund status tracked in `gst_refund_applications`, DRC-03 in
`gst_drc03_filings` — both have `client_id`, `arn`, `status`.

**One canonical set (Phase 1):** every tile, list, report, e-mail and MIS reads the
view `notice_facts` (plus `refund_facts`, `drc03_facts`, `notice_exposure`), whose
flags (`is_open`, `is_overdue`, `is_due_in_7`, `is_new`, `is_unassigned`,
`effective_due`, `exposure_amount` once per dispute) are computed in the DB against
today IST. Load through `src/lib/noticeFacts.ts` / `src/lib/noticeQueries.ts`; don't re-derive
flags in the browser (`src/utils/noticeDefinitions.ts` only reads them, with a
fallback for an old DB). Staff writes go through `src/lib/noticeWrites.ts` (stamps
`edited_by_*`, which the event triggers attribute).

**Server side:** form rules (`notice_form_rules` → `form_code`, short clocks,
auto-close), the sweep `notices_sweep(client)`, events (`notice_events`, written by
triggers), statutory clocks (`notice_clocks_refresh` → `matter_deadlines`), the
extension's ingest door + run ledger (`sync_ingest`, `sync_runs`, `sync_run_items`,
`client_sync_status`) and the alert engine (`notice_alerts_run`, pg_cron; starts in
**preview** — `notice_settings.alerts_mode`). Tests: `supabase/tests/notices/run.sh`
(local Postgres) and `extension/test/notices-sync.sim.mjs`; see the README there.

**Phase 2:** one stage vocabulary — `notice_stages` keys in `gst_notices.stage` and
`litigation_matters.stage` (FK); label and tone from `src/lib/noticeStages.ts`, never
the old labels; `staff_status` is only a mirror. One page per notice at
`/notices/:id` (`src/lib/noticeWorkspace.ts`; `notice_issues`, `notice_drafts`,
`notice_doc_requests`, `notice_payments`). The command centre is one RPC
(`notices_command_centre`) over `notice_facts` + `notice_plan` (rank, next action), so
every number equals its list's count; Ctrl K is `notices_search`. Module pages use
`NoticesShell` and the WS_* house style. Alert e-mails link to `/notices/<id>`; their
shell is `supabase/functions/_shared/email.ts` (redeploy `send-gst-email` before
alerts go live).

**Phase 3 (Portal Autopilot):** jobs on `portal_jobs` (`portal_job_claim`, SKIP LOCKED)
are run by `autopilot_settings.runner`. Default since 2026-10-06 (the firm's decision):
`chrome` = extension 0.7.0 in the firm's own Chrome ("Run scheduled syncs in this
Chrome"), one client at a time, CAPTCHA filled by the firm's own CAPTCHA extension, no
CAPTCHA wall. `office_agent` = `agent/` on an office PC driving the extension
(`startAgentJob`) with people typing CAPTCHAs on the wall. Never build or ship a CAPTCHA
solver, OCR or solving service, a proxy or a cloud runner. Ships off
(`autopilot_settings.enabled`); schedule (05:30 / 13:00 IST) and close via
`autopilot_tick` (pg_cron). Portal e-mails queue a priority sync
(`portal_email_ingest`). Tests: `test_99_autopilot.sql`, the extension sim and
`agent/test/agent.e2e.test.ts` (fake portal), `test_99b_chrome_runner.sql`. **Read
`docs/PORTAL_AUTOPILOT_POSITIONS.md` before changing the agent, the runner or its hooks.**

**Phase 4 (Reply Factory I):** notices are read into typed facts with provenance
(`read_fields`) and issues (`reply_issue_types` codes): the portal case folder always,
the PDF through the Claude API in the office agent (`agent/src/read/`, off by default,
per-client consent). Evidence recipes (`src/lib/reply/`) build versioned annexures from
portal-pulled figures only. Notice types (`notice_type_settings`: critical / optional /
none, and whether the command centre shows them; lists opened from it carry `dash=1`;
or `hidden` everywhere, left out of `notice_facts`: GSTR-3A since 7 Oct 2026).
Reply options are rendered by DB triggers from `reply_templates` when a notice arrives
or changes, with no hyphen or dash anywhere (CHECK constraints), and start drafts. Notices
& Litigation is one sidebar entry, last; its pages are reached from `NoticesTopNav`.
Read `docs/REPLY_FACTORY_POSITIONS.md` and `docs/REPLY_TEMPLATES.md` first.

**Phase 7 (AI assistant, master filters):** the Edge Function `notice-ai`
(`supabase/functions/notice-ai/`, Deno; tests `deno test test/`) reads notices and every
case folder document (`ai_documents`, pg_cron `notice-ai-tick`), keeps reply ↔ paragraph
pairs (`ai_learning_pairs`) that an admin chooses to learn from (Reply Factory → Learning),
and drafts or improves replies on the notice page; off until `ai_settings.read_enabled`,
reaches Claude through the firm's Claude CLI gateway (`CLAUDE_CLI_GATEWAY_URL` / `CLAUDE_CLI_GATEWAY_SECRET`, `cli.ts`), the API key only for scans or as fallback (§13 of the Reply Factory positions). Master filters
(client, FY, owner, form, priority) run on every list page via `src/lib/masterFilters.ts`
and in `notices_command_centre(p_user_id, p_filters)`. Module pages use the panels in
`src/components/notices/ui/Panel.tsx` (pairs of equal height, explanations behind (i)).
Extension 0.8.2 offers a refused portal password once and records it on the client (`clients.portal_login_issue`, skipped by every sync); 0.8.3 files a rejected CAPTCHA as `captcha_failed`, never a password issue. Notices · Settings (`/notices-settings`) switches litigation handling per client (`clients.notices_handled`, off = out of `notice_facts`); closing sweep part 4 closes notices the portal has moved past (§20 of the positions).

**Cases and kinds (9 Oct 2026):** notices are grouped into one case per issue (view
`notice_cases`: the portal case ID, registration one case per client) with a tab per kind
(`notice_track`: notices & demands, refunds, registration, other) on the command centre and
`/notices-cases`; a case's page `/notices-case/:clientId/:caseKey` merges its notices and
case folder documents and flags what is new. Notice pages show the facts and tabs of their
kind (`src/lib/noticeCases.ts`, §21 of the positions). Every client's documents are read by
the AI and fill the overview (`notice_case_overview`); Learning is chosen per client
(`clients.ai_learning`). Lines under a page title show problems only (`ProblemLine`). Linked cases (§28, `20261024100000`): cases sharing a portal number on their papers link by themselves (`notice_case_links_refresh`), others are scored suggestions (`notice_case_link_candidates`), a person's link or unlink stands (`notice_case_link_blocks`); Cases shows them Linked (`notice_cases`) or Apart (`notice_cases_flat`, kept in step with `notice_cases`), the case page the chain (`notice_case_chain`). Every open case gets an AI "What to do now" (`notice_case_advice`, notice-ai `advise`, pg_cron `notice-ai-advise`; the usual step per form until then, `src/lib/noticeAdvice.ts`; §23). Per client the firm handles chosen kinds (`clients.notices_tracks_off`) and a superadmin/GST manager can hide a case as handled elsewhere (`gst_notices.excluded_at`) or close it for good (`notice_case_close`); every case is with us / with the department / closed (`notice_cases.waiting_on`); documents are read by `ai_settings.doc_model` (Haiku) (§24). Extension 0.10.0 fetches only fresh notices and documents (new or changed; open cases weekly; full pass every 30 days); officers' mobiles live in `notice_officers` (§25). Inactive clients are synced for notices; only password/CAPTCHA problems count as failing (`sync_reason_actionable`); one notice can be hidden (`notice_exclude`); system generated notices and DRC-01B/01C need no reply and sit under Other (`notice_facts.system_generated`); correspondence is dated by the paper, then the portal, never the sync (§26, §27).

**Read `docs/NOTICES_LITIGATION_POSITIONS.md` before changing auto-close
logic, tile definitions, due dates, clocks, stages, the plan ranking or alerts.** The positions were
implemented by engineering judgement, not confirmed in a firm sign-off.


## Annual Return module (GSTR-9 / GSTR-9C)

`/annual-return` rebuilds the firm's `MASTER_PMS.xlsx` working as a guided
step workspace. Its home lists every client for the FY with the aggregate
turnover (`client_annual_turnover`) and decides who files GSTR-9 / 9C
(`src/lib/gstr9/applicability.ts`: above ₹2 crore / ₹5 crore, or by the
client's wish below). Workings are one JSONB doc per (client, FY, sheet) in
`annual_return_docs` (version-checked saves, DB-enforced lock, history);
every figure comes from the pure engine `src/lib/gstr9/engine.ts`. Every
saved change is logged per figure by a DB trigger (`annual_return_change_log`,
select-only); each working is allotted, then prepared → verified → reviewed &
locked by three different people (review & lock: GST manager / superadmin;
verify and lock only inside the working — `src/lib/gstr9/signoffFlow.ts`); figures from a
source (portal data, filled-in overrides — `src/lib/gstr9/sourceLock.ts`) can be
typed over only by the superadmin, enforced in the DB too; payables are
set off only via an imported DRC-03 or a GSTR-3B effect with its copy
(`annual_return_payable_setoffs`, not blocked by the lock).

**Read `docs/GSTR9_9C_WORKINGS.md` before changing anything here.** Two
rules are firm decisions: the workings never read the app's own GSTR-1 /
GSTR-3B data (portal figures come only from the extension's portal pulls,
uploads or typing), and several figures deliberately depart from the
workbook (§6 positions). After any engine change run
`node scripts/verify-gstr9-engine.mjs /path/to/MASTER_PMS.xlsx` (275 figures).
