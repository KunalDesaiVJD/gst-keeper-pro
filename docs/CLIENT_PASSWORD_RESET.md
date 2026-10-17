# Client password reset (17 Oct 2026)

Migration `supabase/migrations/20261020100000_client_password_reset.sql`, Edge Function
`supabase/functions/client-password-reset/`, tests `supabase/tests/client_password/run.sh`
(local Postgres), `deno test supabase/functions/client-password-reset/test/` and
`node scripts/verify-client-reset-link.mjs`.
The positions below were engineering judgement, not a firm sign-off.

## The flow

1. **Ask.** Login page → "Forgot Password? (Clients)", or the client dashboard's
   "Change your password". `client_password_reset_request(identifier)` (anon) matches the
   GSTIN; otherwise every client with that User ID. A User ID several GSTINs share (two
   registrations of one PAN; it signs in to either) is a request for each of them, each
   under its own limits. For each client it queues a row in `client_password_resets`
   addressed to `clients.email` (every well-formed address in it), or files a staff
   request (below).
2. **Send.** The database wakes the Edge Function `client-password-reset` (pg_net, the
   Vault key `gst_cron_anon_key`); the app wakes it too. It calls
   `client_password_reset_claim` (service role only), which mints a 256-bit token, stores
   only its sha256 and returns the link `https://gst.vjdesai.com/reset-password#token=…`.
   The function checks the link is exactly that (`checkedLink` in `message.ts`; anything
   else is reported as failed, never sent), e-mails it through Microsoft Graph (not saved
   to Sent Items) and reports with `client_password_reset_mark`.
3. **Use.** `/reset-password` reads the token from the fragment, removes it from the
   address bar, checks it (`client_password_reset_check`) and sets the password
   (`client_password_reset_complete`, bcrypt, `is_first_login = false`). The client then
   signs in at `https://gst.vjdesai.com/login` with the GSTIN.

## Positions

- **One answer for everything.** No such client, no e-mail, rate limited or queued: the
  RPC returns `{"ok": true}` and the page says "if this GSTIN … is registered with us, a
  link is on its way …; if we cannot e-mail one, our team will reset it and contact you".
  (The `clients` table itself is still readable with the anon key, so this hides little
  until that is closed; it is the right shape for when it is.)
- **The link's address is fixed.** `https://gst.vjdesai.com`, written into
  `client_password_reset_claim` and into `message.ts` (`APP_ORIGIN`, `LOGIN_URL`). It is
  never read from `notice_settings.app_base_url` or any other setting: those tables can
  be changed with the anon key, and a link to another site would hand that site a working
  token for any client. The e-mail's sign-in link is always `https://gst.vjdesai.com/login`.
- **The link never goes through `email_outbox`.** Its rows, and `email_templates`, can be
  read and edited with the anon key; a token there would be a takeover of any client. The
  e-mail text is fixed in `message.ts` for the same reason.
- **Private tables.** `client_password_resets`, `client_password_reset_attempts` and
  `client_password_log` have RLS on, no policies and no anon/authenticated grants, like
  `portal_sessions`: open link tables would let anyone plant a token hash, and an open log
  or attempts table would show which GSTINs are clients and which have an e-mail, undoing
  the one answer. Staff read the log through `client_password_log_for(actor, client)`,
  which checks the actor holds a staff level (the same trust as
  `staff_set_client_password`). The log names e-mail addresses only masked
  (`p•••@navratna.com`); requests for identifiers that are not clients are kept only in
  the private attempts table, as a sha256.
- **The link:** once, 60 minutes from sending; a newer request (or a staff reset) voids
  it; until it is used the current password keeps working. Using it voids every other
  open link and resolves waiting staff requests.
- **Rate limits.** Per client: one link a minute; three of its own an hour; five an hour
  in all, its own and staff links together. Per caller address (the gateway's
  `cf-connecting-ip` / `x-real-ip` / `x-forwarded-for`): ten requests an hour, whatever
  they were for; an IPv6 address counts as its /64 block, an IPv4-mapped one as the IPv4
  address. All clients: 300 links an hour (the firm has about 130 clients).
- **Never a silent drop.** A client is never left with neither a link nor staff help.
  One pending `password_reset_requests` row (never two) is filed for staff on the
  Dashboard when: there is no usable e-mail; the per-address or all-clients limit refuses
  the request; the per-client limit refuses it and no earlier link is still open (on its
  way, or sent and not expired); the e-mail fails; or the link never goes out (below). A
  request the per-client limit refuses while a link from a moment ago is still open needs
  nothing more.
- **Links that never go out.** A link not claimed within the hour (the mailer did not
  run) is given up; one claimed but not reported sent within 15 minutes (the mailer
  stopped half way) is voided. Either way it is logged and staff are asked. The sweep
  (`client_password_reset_sweep`) runs on every claim and after every request, so it
  runs even when the mailer is down. A send reported after the sweep voided the link is
  recorded, and the log says the link does not work.
- **The staff request's note** is the same for every reason ("Asked for a reset link;
  none went out. Edit Client shows why.") and never names the e-mail address:
  `password_reset_requests` is open to the anon key. The reason is in the private log.
- **Password rules** (`client_password_problem`, mirrored in `src/lib/passwordRules.ts`):
  8 to 72 characters, no outer spaces, not the client's GSTIN, nothing shaped like a GSTIN.
- **Staff resets.** Every staff level (superadmin, GST Manager, any employee, no key)
  can set a client's password or e-mail it a link: Clients page key button, Edit Client →
  Client app login, Dashboard requests. `staff_set_client_password` keeps
  `is_first_login = true` and allows the GSTIN, so a staff reset to the GSTIN makes the
  client choose a new password at first sign-in. Setting a password is never limited.
  `staff_send_client_reset_link` is held to the same limits as every link (one a minute
  and five an hour per client, 300 an hour in all) and says which one stopped it. Every
  reset is logged.
- **Edit Client** names the e-mail address as saved, since that is where a link goes
  (`staff_send_client_reset_link` reads `clients.email`). While the e-mail field holds an
  address not yet saved, "E-mail reset link" is off with "Save the new e-mail first."
  (`src/lib/clientResetLink.ts`).
- **Edit Client** no longer writes the GST password into `client_password` on every save:
  only a *changed* GST password also sets the app login, through
  `staff_set_client_password` (hashed, logged). The firm may prefer to stop that sync.
- **Locks.** Whatever changes a client's links takes that client's advisory lock first;
  the sweep only tries it (and leaves a busy client to the next sweep), and the claim
  skips locked rows, so neither waits while holding a lock.

## Known limits

`staff_set_client_password`, `staff_send_client_reset_link` and `client_password_log_for`
trust `p_actor_id`, like every staff RPC in this app; `user_roles` is readable with the
anon key. A staff link only ever goes to the client's own address on record, and the
limits above bound how many. `password_reset_requests` (from 20260105095015) is open to
the anon key, so a pending client request, and the client it names, can be seen with it;
it never carries the e-mail address or the reason. Anyone can therefore file at most one
pending staff request per client by tripping a limit.
