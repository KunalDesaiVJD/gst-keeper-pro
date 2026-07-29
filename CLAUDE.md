# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Permanent rules (project-specific, do not violate)

- **Supabase project is `gcquafqxbykxkbexcdpy`.** This is the only backend. The credentials in `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`) point here. `.env` and `supabase/config.toml` both point here. Never reintroduce the old Lovable project id `mlgxmhzlqykwdvvybhnk`.
- **Apply DB migrations directly to project `gcquafqxbykxkbexcdpy`.** Add a new timestamped file under `supabase/migrations/` AND apply it to the live project — both must stay in sync.
- **Run `npm run build` before committing.** A green build is the gate for any commit.
- **Never edit via Lovable.** This repo has been migrated off Lovable; all changes happen through Claude Code. Do not rely on Lovable round-tripping, and ignore the Lovable instructions still present in `README.md`.

## Commands

- `npm run dev` — Vite dev server on port 8080 (host `::`)
- `npm run build` — production build (run before every commit)
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

