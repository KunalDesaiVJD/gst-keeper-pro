# gst-push edge function

Server-side proxy that pushes a client's stored GSTR-1 return to the GST portal
via the **Humonex Push API**. Called from the **GSTR-01** page ("Push to GST
Portal" button). Keeps the secret Humonex bearer token off the browser and
avoids CORS.

## What it does

1. Receives `{ clientId, periodMonth, actorId?, actorRole? }` (periodMonth is `MM/YYYY`).
2. Reads the client's `gst_user_id` / `gst_password` and the saved
   `gstr1_data.raw_json` for that period (service-role, server-side only).
3. Derives `quarter`, `financial_year`, `period` (Indian FY, Apr–Mar).
4. POSTs to `https://app.humonex.com/api/v1/gst-push/run` with
   `Authorization: Bearer $HUMONEX_BEARER_TOKEN`.
5. Writes a best-effort row to `audit_log` and returns the Humonex result.

## Deploy (one time)

Requires the Supabase CLI, logged in and linked to project `gcquafqxbykxkbexcdpy`.

```bash
# 1. Set the secret token (never commit it to source)
supabase secrets set HUMONEX_BEARER_TOKEN=zMUvsRC6o3Q3CbhHUKWCv4pDzugkvmsn \
  --project-ref gcquafqxbykxkbexcdpy

# 2. Deploy the function (verify_jwt=false is set in supabase/config.toml)
supabase functions deploy gst-push --project-ref gcquafqxbykxkbexcdpy
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the
platform — you do not set those.

To rotate the token later, re-run step 1 with the new value (no redeploy needed).

## Database

Apply the migration that adds the per-return push-status columns
(`last_pushed_at`, `last_push_status`, `last_push_by`, `last_push_message`) to
`gstr1_data`:

```bash
supabase db push --project-ref gcquafqxbykxkbexcdpy
# migration: supabase/migrations/20260711120000_gstr1_push_status.sql
```

The function degrades gracefully if this is not applied yet — pushes still work,
but the "last pushed" indicator stays hidden until the columns exist.

## Authorization

`verify_jwt = false`, but the function still authorizes the caller: it looks up
`actorId` in `user_roles` and requires superadmin/gst_manager, or an employee
holding the `edit_filing_status` permission (mirrors `canEditFilingStatus()` in
the app). The client-sent role is ignored. Because the app uses custom
localStorage auth, this is defense-in-depth rather than a cryptographic session
check — a caller would need a valid, authorized staff `user_id`.

## Notes

- `verify_jwt = false` because this app uses custom auth (no Supabase JWT).
  Authorization is enforced in the app; the sensitive token stays server-side.
- The function always returns HTTP 200 for handled outcomes with an `ok` flag,
  so the frontend can read `data` uniformly. Only unexpected crashes return 500.
