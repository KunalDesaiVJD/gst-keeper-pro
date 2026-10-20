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
  way, or sent and not expired, and addressed to the e-mail on record now); the client's
  live link fails to send and nothing else is on its way; or a link never goes out
  (below). A request the per-client limit refuses while a link from a moment ago is still
  open needs nothing more. A link that went to an address staff have since corrected does
  not count as open: the client is not reading that mailbox.
- **A failed send of a replaced link asks nobody.** When a link a newer one already
  replaced (or a reset, a sweep or another used link already voided) fails to send, the
  failure is logged and no staff request is filed: the newer link is the one that
  matters, and it reports its own failure.
- **A link that goes out answers the request.** When a link is reported sent and still
  good, the client's pending requests filed by this flow (the fixed note) are resolved,
  and the log says so: the client has a link, and a staff reset would void it. Queuing a
  link does not resolve them (the mailer may be down); a link reported sent after it was
  voided does not either. Requests not filed by this flow are left to staff.
- **Links that never go out.** A link not claimed within 15 minutes (the mailer did not
  run; a working one claims in seconds) is given up; one claimed but not reported sent
  within 15 minutes (the mailer stopped half way) is voided. Either way it is logged
  (`link_failed`) and staff are asked. pg_cron runs `client_password_reset_tick` every 5
  minutes (job `client-password-reset-sweep`, 3, 8, 13 … past the hour), whatever the
  traffic: it sweeps (`client_password_reset_sweep`) and wakes the mailer again while a
  link is still waiting, in case the first wake-up was lost. The claim and every request
  sweep too. A client's own retry (and a staff link) first reports that client's lost
  links (`client_password_reset_sweep_client`, under the client's lock), so a lost link
  is never voided unreported as "a newer link was asked for"; a staff link over a lost
  one logs it without filing a request, since staff are acting. A send reported after the
  sweep voided the link is recorded, and the log says the link does not work.
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
  skips locked rows, so neither waits while holding a lock. The per-client sweep inside a
  request or a staff link runs under the lock the caller already holds, never another
  client's (a shared User ID takes its clients' locks in id order).

## Known limits

`staff_set_client_password`, `staff_send_client_reset_link` and `client_password_log_for`
trust `p_actor_id`, like every staff RPC in this app; `user_roles` is readable with the
anon key. A staff link only ever goes to the client's own address on record, and the
limits above bound how many. `password_reset_requests` (from 20260105095015) is open to
the anon key, so a pending client request, and the client it names, can be seen with it;
it never carries the e-mail address or the reason. Anyone can therefore file at most one
pending staff request per client by tripping a limit.
