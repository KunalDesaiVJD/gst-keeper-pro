# Client allotment (employees limited to their clients)

Added 25 Nov 2026, migration `20261125140000_staff_client_allotment.sql`.

## What it does

A GST Manager or the superadmin opens **Settings → User Control → Client access**, picks an
employee, switches on **Only allotted clients** and ticks the clients. From the employee's next
page load they see and work on only those clients, in every module (client pickers, all-clients
reports, notices, Change History, the GST Assistant's reads).

- **Default: off.** An employee with the switch off sees every client, exactly as before. Ticked
  clients are kept while the switch is off but do nothing.
- **On with no client ticked = no clients.** The screen refuses to save that.
- GST Managers and the superadmin are never limited (the database ignores a limit on them).
- A limited employee cannot add a new client (it would sit outside their list); Add Client is
  hidden for them and the database refuses the insert.

## How the database holds it

The app has no Supabase auth session (`auth.uid()` is NULL); every `/rest/v1` request carries
`x-gst-actor` (`src/lib/changeLogHeaders.ts`). `gst_actor_client_scope()` reads it and returns
NULL (no limit) or the allotted client ids. NULL whenever there is no header (extension runs with
no app user, the office agent, pg_cron, Edge Functions on the service role), for a client's portal
sign-in, for a GST Manager / superadmin, and for an employee whose switch is off.

- RESTRICTIVE policy `staff_client_scope_guard` (FOR ALL, USING and WITH CHECK) on every RLS table
  holding a uuid `client_id`, and on `clients` (by `id`). Rows with a NULL `client_id` stay visible.
- Views over client data are `security_invoker`, so the guard applies through them.
- Cross-client list functions that were SECURITY DEFINER (`notice_cases_counts`, `_flat`,
  `notice_cases_excluded`, `notice_case_key_dates_range`, `notice_stale_demands`,
  `notices_client_settings`, `sync_queue`, `reply_evidence_pending`) now run as the caller.

## Limits (known, accepted)

- The header is sent by the app; like every other rule in this app (open RLS, login in
  `localStorage`), someone with the anon key and their own tools could leave it out. It keeps the
  app's screens to the list; it is not a defence against a hostile insider with developer tools.
- Child tables without `client_id` (builder units/receipts by project, notice drafts/issues by
  notice, matter_* by matter) are not guarded themselves; they are reached only through a parent
  row the guard already hides.
- SECURITY DEFINER functions that take one `p_client_id` are not checked; the app never offers
  them a client outside the list.
- Aggregate status functions (autopilot / AI reader counts) still count every client.

## Keeping it whole

- A new table with `client_id`: re-run section 4 of the migration (idempotent) in its migration.
- A new view over client data: `WITH (security_invoker = true)`.
- A new SECURITY DEFINER function that lists several clients' rows: filter by
  `public.gst_client_in_scope(client_id)`.
