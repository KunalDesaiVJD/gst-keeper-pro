# Client password reset (17 Oct 2026)

Migration `supabase/migrations/20261020140000_client_password_reset.sql`, Edge Function
`supabase/functions/client-password-reset/`, tests `supabase/tests/client_password/run.sh`
(local Postgres 15/16 with the `dblink` contrib extension, which `test_99_lock_order.sql`
uses to run real concurrent sessions), `deno test supabase/functions/client-password-reset/test/`
and `node scripts/verify-client-reset-link.mjs`. Going live: [the last section](#going-live).
The positions below were engineering judgement, not a firm sign-off.

## The flow

1. **Ask.** Login page → "Forgot Password? (Clients)", or the client dashboard's
   "Change your password". `client_password_reset_request(identifier)` (anon) matches the
   GSTIN; otherwise every client with that User ID. A User ID several GSTINs share (two
   registrations of one PAN; it signs in to either) is a request for each of them, each
   under its own limits. For each client it queues a row in `client_password_resets`
   addressed to `clients.email` (every well-formed address in it: `client_email_list`,
   mirrored in `src/lib/clientResetLink.ts`), or files a staff request (below).
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
- **A link follows the address on record.** It is good only while every address it went
  to is still in `clients.email` (`client_password_sent_to_current`: case, separators and
  order do not matter, and an address added since does not either). Staff replace an
  address because the old one is not the client's (a mistyped domain, an ex-accountant),
  so whoever reads the old mailbox must not be able to use a link there:
  - changing `clients.email` (Edit Client, or any update) fires the trigger
    `client_password_email_changed`, which first reports the client's links that never
    went out (`client_password_reset_sweep_client`, as a retry or the sweep would: logged
    as `link_failed`, staff asked), then voids every link to an address no longer on
    record (`void_reason` "the e-mail address changed", logged as `link_voided`, masked)
    and, if one of them was still live and no other link is open, files the staff
    request. Without the first step a link that never went out would be voided as "the
    e-mail address changed", would not count as live, and the client who asked would be
    left with nothing;
  - `client_password_reset_claim` never mints a token for such a link (one queued in the
    same moment as the change): it voids it, logs it and asks staff instead;
  - `client_password_reset_mark` reports one sent as voided and resolves nothing;
  - `client_password_reset_check` / `_complete` refuse one, whatever its state.
  The trigger takes the client's lock, so it and a request never cross; the claim,
  mark and page checks are the backstop.
- **Rate limits.** Per client: one link a minute; three of its own an hour; five an hour
  in all, its own and staff links together. Per caller address (the gateway's
  `cf-connecting-ip` / `x-real-ip` / `x-forwarded-for`): ten requests an hour, whatever
  they were for; an IPv6 address counts as its /64 block, an IPv4-mapped one as the IPv4
  address. All clients: 300 links an hour (the firm has about 130 clients).
- **Never a silent drop.** A client is never left with neither a link nor staff help.
  One pending `password_reset_requests` row (never two) is filed for staff on the
  Dashboard when: there is no usable e-mail; any limit (per client, per address, all
  clients) refuses the request and no earlier link is still open (on its way, or sent and
  not expired, and addressed to the e-mail on record now); the client's live link fails
  to send and nothing else is on its way; a live link is voided because the address
  changed; or a link never goes out (below). A request a limit refuses while a link is
  still open needs nothing more: the client has a link, and a staff reset on a "none went
  out" request would void it. A link that went to an address staff have since corrected
  does not count as open: the client is not reading that mailbox.
- **A failed send of a replaced link asks nobody.** When a link a newer one already
  replaced (or a reset, a sweep or another used link already voided) fails to send, the
  failure is logged and no staff request is filed: the newer link is the one that
  matters, and it reports its own failure.
- **A link that goes out answers the request.** When a link is reported sent, still
  good and to the address on record, the client's pending requests filed by this flow
  (the fixed note) are resolved, and the log says so: the client has a link, and a staff
  reset would void it. Queuing a link does not resolve them (the mailer may be down); a
  link reported sent after it was voided does not either, nor one that went to an address
  no longer on record (that one is voided, and staff asked if nothing else is open).
  Requests not filed by this flow are left to staff.
- **Links that never go out.** A link not claimed within 15 minutes (the mailer did not
  run; a working one claims in seconds) is given up (`void_reason` "not sent in time");
  one claimed but whose send is not confirmed within 15 minutes is voided (`void_reason`
  "the send could not be confirmed"). The second may well have been e-mailed (the mailer
  stopped after sending, or its report never arrived), so nothing says it was not: the log
  reads "The send of the reset link to p•••@x.com could not be confirmed within 15
  minutes, so the link was voided." and the reason staff were asked "The send of the reset
  link could not be confirmed." Either way it is logged (`link_failed`) and staff are
  asked. pg_cron runs `client_password_reset_tick` every 5 minutes (job
  `client-password-reset-sweep`, 3, 8, 13 … past the hour), whatever the traffic: it
  sweeps (`client_password_reset_sweep`) and wakes the mailer again while a link is still
  waiting, in case the first wake-up was lost. The claim and every request sweep too. A
  client's own retry, a staff link and an e-mail change first report that client's lost
  links (`client_password_reset_sweep_client`, under the client's lock), so a lost link
  is never voided unreported as "a newer link was asked for" or "the e-mail address
  changed"; a staff link over a lost one logs it without filing a request, since staff
  are acting. A send reported after the sweep voided the link is recorded, and the log
  says the link does not work.
- **The mailer retries its report.** After each e-mail the Edge Function reports with
  `client_password_reset_mark`, retried up to three more times with backoff (0.5 s, 1.5 s,
  4 s; `mark.ts`), so a link that went out is not voided for a passing network or
  database error. A report can arrive and its answer still be lost, so a repeat must be
  harmless: `client_password_reset_mark` keeps a link's first report (sent, or failed)
  and ignores any after it (no second log row, no second staff request, `sent_at`
  unchanged).
- **The staff request's note** is the same for every reason ("Asked for a reset link;
  none reached the client. Reset password shows why.") and never names the e-mail address:
  `password_reset_requests` is open to the anon key. The reason is in the private log.
  The note names the Dashboard row's own "Reset password" button, never Edit Client, which
  not every employee can open: every staff member who sees the request can open that
  dialog, and opened from such a request (only these carry a note) it shows "Why no link
  reached the client" with the newest `fallback_request` entry of the client's log (read
  through `client_password_log_for`, any staff level; `src/lib/clientPasswordReason.ts`,
  without the log's "A request is waiting on the Dashboard." sentence). The database files one
  pending request per client and logs a reason only when it files one, so the newest
  reason is the waiting request's.
- **Password rules** (`client_password_problem`, mirrored in `src/lib/passwordRules.ts`):
  8 to 72 characters, no outer spaces, not the client's GSTIN, nothing shaped like a GSTIN.
- **Staff resets.** Every staff level (superadmin, GST Manager, any employee, no key)
  can set a client's password or e-mail it a link: Clients page key button, Edit Client →
  Client app login, Dashboard requests. `staff_set_client_password` keeps
  `is_first_login = true` and allows the GSTIN, so a staff reset to the GSTIN makes the
  client choose a new password at first sign-in. Setting a password is never limited.
  `staff_send_client_reset_link` is held to the same limits as every link (five an hour
  per client, every link asked for, staff and self together; 300 an hour in all) and to
  a minute's spacing, which counts only a link that went out to an address still on
  record or is still on its way: one that failed, or was voided before it went (say,
  because staff just corrected the address), does not hold the next one back. Its errors
  say what happened: "A reset link went to this client less than a minute ago." / "A
  reset link to this client is on its way." (each with "Try again in a minute, or set a
  password."), "Five reset links were asked for this client in the last hour.", "Too many
  reset links were asked for in the last hour." Every reset is logged.
- **The reset dialog** (Edit Client, the Clients page key button, the Dashboard) names
  only the addresses the database will e-mail (`resetLinkAddresses`, the same rule as
  `client_email_list`). When the field holds none it can use (say `accounts@sorath.com.`
  or `a@x.c`), "E-mail reset link" is off with "No usable e-mail address on record";
  Edit Client refuses to save such an address in the first place.
- **Edit Client** names the e-mail address as saved, since that is where a link goes
  (`staff_send_client_reset_link` reads `clients.email`). While the e-mail field holds an
  address not yet saved, "E-mail reset link" is off with "Save the new e-mail first."
  (`src/lib/clientResetLink.ts`). The Client app login card names the GSTIN (the User ID)
  and name as saved, since a password set there goes on the saved row; while the GSTIN
  field holds a new one not yet saved, "Reset app password" is off with "Save the new
  GSTIN first to reset the password."
- **Edit Client** no longer writes the GST password into `client_password` on every save:
  only a *changed* GST password also sets the app login, through
  `staff_set_client_password` (hashed, logged). The firm may prefer to stop that sync.
- **Locks: one order everywhere, the client's `clients` row, then the client's advisory
  lock.** An Edit Client save holds the row when its e-mail trigger takes the advisory
  lock, and holds it `FOR UPDATE` when it also changes the GSTIN (a unique, so key,
  column); every insert into a table with a foreign key to `clients`
  (`client_password_resets`, `client_password_log`, `client_password_reset_attempts`)
  locks the row `FOR KEY SHARE`. Anything that took the advisory lock first and touched
  the row afterwards therefore deadlocked with a GSTIN + e-mail save. So:
  - whatever waits locks the row first: `FOR KEY SHARE` in
    `client_password_reset_for_client`, `staff_send_client_reset_link`,
    `client_password_reset_mark`, `client_password_staff_request` and
    `client_password_reset_sweep_client`; `FOR NO KEY UPDATE` in
    `client_password_reset_complete` and `staff_set_client_password`, which change it;
    then `pg_advisory_xact_lock`;
  - the sweep and the claim never wait: they try the row (`FOR KEY SHARE SKIP LOCKED`)
    and then the advisory lock (`pg_try_advisory_xact_lock`), and leave a client whose
    row or lock is busy to the next run (the claim also skips link rows already locked);
  - both locks are re-entrant, so the helpers called under them never wait. The
    per-client sweep inside a request, a staff link or an e-mail change runs under the
    locks the caller already holds, never another client's (a shared User ID takes its
    clients' locks in id order). A request and a staff link read the address under both
    locks, so an e-mail change saving at that moment is either seen or voids the new link
    when it commits.
  `test_99_lock_order.sql` runs a GSTIN + e-mail change against a request half way
  through (two sessions), and checks the order in every function above.

## Known limits

`staff_set_client_password`, `staff_send_client_reset_link` and `client_password_log_for`
trust `p_actor_id`, like every staff RPC in this app; `user_roles` is readable with the
anon key. A staff link only ever goes to the client's own address on record, and the
limits above bound how many. `password_reset_requests` (from 20260105095015) is open to
the anon key, so a pending client request, and the client it names, can be seen with it;
it never carries the e-mail address or the reason. Anyone can therefore file at most one
pending staff request per client by tripping a limit.

## Going live

Never applied live yet. Everything below is for project **`gcquafqxbykxkbexcdpy`** only:
always name it (`--project-ref gcquafqxbykxkbexcdpy`, or the URL below), never
`SUPABASE_PROJECT_REF` (it points at another live project, `hubyywmodekfdzhwiumb`).
`SUPABASE_ACCESS_TOKEN` must be set. Order: database, secrets, Edge Function, then the
frontend. The current frontend keeps working on the new database (the 3-argument
`staff_set_client_password` call still resolves, `password_reset_requests.note` is a new
nullable column, the e-mail trigger only touches reset links); the new frontend calls RPCs
only the migration creates, and a link queued before the function is deployed would wait
for nothing.

1. **Check what the migration relies on** (read-only; expect `pgcrypto` in `extensions`,
   `pg_net`, `pg_cron`, and one Vault row, from 20260726130000):

   ```sql
   select extname, extnamespace::regnamespace from pg_extension where extname in ('pgcrypto', 'pg_net', 'pg_cron');
   select name from vault.decrypted_secrets where name = 'gst_cron_anon_key';
   ```

2. **Apply the migration** (one transaction, safe to re-run):

   ```bash
   jq -Rs '{query: .}' supabase/migrations/20261020140000_client_password_reset.sql \
     | curl -sS -X POST https://api.supabase.com/v1/projects/gcquafqxbykxkbexcdpy/database/query \
         -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' --data-binary @-
   ```

   Then check its objects exist (there is no migration ledger):

   ```sql
   select to_regclass('public.client_password_resets'), to_regclass('public.client_password_reset_attempts'),
          to_regclass('public.client_password_log');                                   -- three names
   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'client_email_list', 'client_email_hint', 'client_password_sent_to_current', 'client_password_problem',
      'client_password_request_ip', 'client_password_ip_key', 'client_password_reset_ping',
      'client_password_staff_note', 'client_password_staff_request', 'client_password_has_open_link',
      'client_password_reset_sweep_client', 'client_password_reset_sweep', 'client_password_reset_tick',
      'client_password_email_changed', 'client_password_reset_for_client', 'client_password_reset_request',
      'client_password_reset_claim', 'client_password_reset_mark', 'client_password_reset_check',
      'client_password_reset_complete', 'staff_set_client_password', 'staff_send_client_reset_link',
      'client_password_log_for');                                                        -- 23
   select pg_get_function_identity_arguments('public.staff_set_client_password'::regproc);
                                     -- p_actor_id uuid, p_client_id uuid, p_new_password text, p_note text
   select tgname from pg_trigger where tgname = 'client_password_email_changed';        -- one row
   select schedule, command from cron.job where jobname = 'client-password-reset-sweep';
                                     -- 3-59/5 * * * * | select public.client_password_reset_tick()
   select count(*) from pg_policies
    where tablename in ('client_password_resets', 'client_password_reset_attempts', 'client_password_log');  -- 0
   select public.client_password_staff_note();
                                     -- Asked for a reset link; none reached the client. Reset password shows why.
   ```

   And that the anon key cannot read the private tables (the management API bypasses
   RLS, so this one goes through PostgREST with the key from `.env`); each must answer
   `permission denied`:

   ```bash
   for t in client_password_resets client_password_reset_attempts client_password_log; do
     curl -sS "https://gcquafqxbykxkbexcdpy.supabase.co/rest/v1/$t?select=id&limit=1" \
       -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" -H "Authorization: Bearer $VITE_SUPABASE_PUBLISHABLE_KEY"; echo
   done
   ```

3. **Secrets.** The function reads `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`,
   `GRAPH_CLIENT_SECRET` and `GRAPH_SENDER` (`gst@vjdesai.com`), the same ones
   `send-gst-email` uses (function secrets are per project, so they should already be
   there; the Graph app needs the application permission Mail.Send for the sender).
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

   ```bash
   supabase secrets list --project-ref gcquafqxbykxkbexcdpy     # the four GRAPH_* names
   # only if one is missing:
   supabase secrets set GRAPH_SENDER=gst@vjdesai.com --project-ref gcquafqxbykxkbexcdpy
   ```

4. **Deploy the Edge Function** (it bundles `../_shared/graph.ts` and `../_shared/email.ts`;
   keep JWT verification on, the default: the database's wake-up and the app both call it
   with the anon key, a JWT):

   ```bash
   supabase functions deploy client-password-reset --project-ref gcquafqxbykxkbexcdpy
   curl -sS -X POST https://gcquafqxbykxkbexcdpy.supabase.co/functions/v1/client-password-reset \
     -H "Authorization: Bearer $VITE_SUPABASE_PUBLISHABLE_KEY" -H 'Content-Type: application/json' -d '{}'
                                     # {"ok":true}; with no link waiting it sends nothing
   ```

   `send-gst-email` need not be redeployed: the change to `_shared/email.ts` only adds the
   reset e-mail's shell.

5. **Deploy the frontend** (merge to `main`; Vercel builds it, and `vercel.json` adds
   `Referrer-Policy: no-referrer` on `/reset-password`). Only after steps 2 to 4.

6. **Check end to end** with a client whose e-mail on record is a firm mailbox: login page
   → "Forgot Password? (Clients)" with its GSTIN; the e-mail arrives within a minute; its
   button opens `https://gst.vjdesai.com/reset-password`; set a password and sign in with
   the GSTIN. Edit Client → Client app login shows link asked for, link e-mailed and set by
   the client. After 10 minutes, `select status, start_time from cron.job_run_details
   where jobid = (select jobid from cron.job where jobname = 'client-password-reset-sweep')
   order by start_time desc limit 3;` shows the sweep running.
