# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Permanent rules (project-specific, do not violate)

- **Supabase project is `gcquafqxbykxkbexcdpy`.** This is the only backend. The credentials in `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`) point here. `.env` and `supabase/config.toml` both point here. Never reintroduce the old Lovable project id `mlgxmhzlqykwdvvybhnk`.
- **Ignore the `SUPABASE_PROJECT_REF` environment variable — it is wrong.** It is set to `hubyywmodekfdzhwiumb`, which is a *different, live* Supabase project on the same account ("info@vjdesai.com's Project"). Applying a migration to it would hit real data belonging to the firm. Always pass `gcquafqxbykxkbexcdpy` explicitly. `SUPABASE_ACCESS_TOKEN` is correct and can reach all three projects on the account, so nothing stops a wrong-project write except naming the ref by hand.
- **Apply DB migrations directly to project `gcquafqxbykxkbexcdpy`.** Add a new timestamped file under `supabase/migrations/` AND apply it to the live project — both must stay in sync. There is **no migration ledger**: this project has never been Supabase-CLI-managed, so `supabase_migrations.schema_migrations` does not exist and nothing records which files were applied. The directory is a convention held together by discipline; verify by checking that the objects a migration declares actually exist.
- **RLS policies must be open to `public`.** This app does not establish a Supabase auth session — it authenticates through its own `localStorage` session and talks to Postgres with the anon key, so **`auth.uid()` is always NULL at runtime**. Any policy gated on `auth.uid()` or `is_staff(auth.uid())` fails closed: reads come back empty, writes are rejected, and the build stays green. Use `FOR ALL TO public USING (true) WITH CHECK (true)` and let login, staff-only routing and the permission keys be the gate. The one deliberate exception is `portal_sessions` (RLS on, *no* policies), because those rows are session cookies reached only by the service-role key on the agent runner. Note also that the Supabase **management API bypasses RLS**, so tests run through it will pass against policies that break the app — verify writes with the anon key from `.env`.
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
- Permissions: `superadmin` and `gst_manager` implicitly have everything. `employee` permissions are row-based in the `user_permissions` table (keys like `manage_employees`, `unlock_sheets`, `delete_2b_rows`, etc.) and surfaced through `can*()` helpers on the auth context. Use those helpers for gating UI/actions rather than checking roles directly.

**Global state** is three nested React contexts (see `src/App.tsx`), in order: `AuthProvider` → `MonthProvider` → `ClientProvider`.
- `MonthContext` holds the selected GST return period as a `MM/YYYY` string, defaulting to the **previous** month (returns filed this month are for last month).
- `ClientContext` holds the currently selected client id. Many pages are scoped by the (month, client) pair.

**Routing.** `react-router-dom` in `src/App.tsx`. `/login` is public; everything else is nested under `MainLayout` (sidebar shell). Pages live in `src/pages/` (Dashboard, Clients, 2B Reconciliation, 2B & RCM, Suspended Reco, ITC Summary, RCM Summary, Manage Masters, Filing Status, GST Running Update, GSTR1 Data, Manage Employees, User Control, Settings).

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

## Import 2B → 2B Reconciliation → Suspended Reco → GSTR-3B

`twob_import_docs` / `books_register` (Import 2B tab) is the **only**
data-entry surface for 2B classification, RCM aside. "Post to Reconciliation"
(`src/lib/postImport2B.ts`) writes through to the live `bills_not_in_2b` /
`bills_not_in_books` ledger that ITC Summary, Suspended Reco and
month-to-month carry-forward already read from. `2B Reconciliation`
(`TwoBReconciliationPage.tsx`) is **read-only for Strict clients** (the
default) — display, export, version history/restore, and destructive Clear
Data only. A per-client `clients.liberal_2b_reconciliation` flag
(superadmin/gst_manager only, set from Edit Client) opts a specific client
into Liberal mode, which restores the full directly-editable page for that
client — see §5 of the doc below before assuming every client behaves the
same way.

**Read `docs/2B_RECONCILIATION_FLOW.md` before changing this flow.** The
per-document mapping (MATCHED/MISMATCHED claimed at the 2B value, INELIGIBLE
and ITC_OF_OTHERS excluded entirely, NOT_IN_BOOKS/NOT_IN_2B the only rows that
reach the ledger) and ITC Summary row 5.1's auto-link are elected positions,
not settled law — and were implemented without a firm sign-off conversation,
so treat them as reversible defaults pending confirmation, not fixed rules.

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
select-only); only a GST manager / superadmin can verify & lock; figures from a
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
