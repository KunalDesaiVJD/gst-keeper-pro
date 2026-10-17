# Client password reset (17 Oct 2026)

Migration `supabase/migrations/20261020100000_client_password_reset.sql`, Edge Function
`supabase/functions/client-password-reset/`, tests `supabase/tests/client_password/run.sh`.
The positions below were engineering judgement, not a firm sign-off.

## The flow

1. **Ask.** Login page → "Forgot Password? (Clients)", or the client dashboard's
   "Change your password". `client_password_reset_request(identifier)` (anon) matches the
   GSTIN, or a User ID that exactly one client has, and queues a row in
   `client_password_resets` addressed to `clients.email` (every well-formed address in it).
2. **Send.** The database wakes the Edge Function `client-password-reset` (pg_net, the
   Vault key `gst_cron_anon_key`); the app wakes it too. It calls
   `client_password_reset_claim` (service role only), which mints a 256-bit token, stores
   only its sha256 and returns the link `<notice_settings.app_base_url>/reset-password#token=…`.
   The function e-mails it through Microsoft Graph (not saved to Sent Items) and reports
   with `client_password_reset_mark`.
3. **Use.** `/reset-password` reads the token from the fragment, removes it from the
   address bar, checks it (`client_password_reset_check`) and sets the password
   (`client_password_reset_complete`, bcrypt, `is_first_login = false`). The client then
   signs in at `/login` with the GSTIN.

## Positions

- **One answer for everything.** No such client, no e-mail, rate limited or queued: the
  RPC returns `{"ok": true}` and the page says "if this GSTIN … is registered with us".
  (The `clients` table itself is still readable with the anon key, so this hides little
  until that is closed; it is the right shape for when it is.)
- **The link never goes through `email_outbox`.** Its rows, and `email_templates`, can be
  read and edited with the anon key; a token there would be a takeover of any client. The
  e-mail text is fixed in `message.ts` for the same reason.
- **Private tables.** `client_password_resets` and `client_password_reset_attempts` have
  RLS on, no policies and no anon/authenticated grants, like `portal_sessions`: open
  tables would let anyone plant a token hash. `client_password_log` is readable, written
  only by the functions.
- **The link:** once, 60 minutes from sending; a newer request (or a staff reset) voids
  it; a link not sent within the hour is given up; until it is used the current password
  keeps working. Using it voids every other open link and resolves waiting staff requests.
- **Rate limits:** per client one link a minute and three an hour; per caller address
  (the gateway's `cf-connecting-ip` / `x-forwarded-for`) ten requests an hour; sixty links
  an hour in all. Staff links: one a minute, five an hour per client.
- **No usable e-mail, or the e-mail fails:** one pending `password_reset_requests` row
  (with a `note`) for staff on the Dashboard.
- **Password rules** (`client_password_problem`, mirrored in `src/lib/passwordRules.ts`):
  8 to 72 characters, no outer spaces, not the client's GSTIN, nothing shaped like a GSTIN.
- **Staff resets.** Every staff level (superadmin, GST Manager, any employee, no key)
  can set a client's password or e-mail it a link: Clients page key button, Edit Client →
  Client app login, Dashboard requests. `staff_set_client_password` keeps
  `is_first_login = true` and allows the GSTIN, so a staff reset to the GSTIN makes the
  client choose a new password at first sign-in. Every reset is logged.
- **Edit Client** no longer writes the GST password into `client_password` on every save:
  only a *changed* GST password also sets the app login, through
  `staff_set_client_password` (hashed, logged). The firm may prefer to stop that sync.

## Known limits

`staff_set_client_password` and `staff_send_client_reset_link` trust `p_actor_id`, like
every staff RPC in this app; `user_roles` is readable with the anon key. A staff link only
ever goes to the client's own address on record.
