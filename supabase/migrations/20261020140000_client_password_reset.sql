-- Client "Forgot password" by e-mail, and client password resets for every
-- staff member (17 Oct 2026, the firm's request). Positions:
-- docs/CLIENT_PASSWORD_RESET.md.
--
--  * A client asks from the login page (GSTIN or User ID). The answer is the
--    same whatever happened (no such client, no e-mail, too many requests,
--    queued), so the form cannot be used to test which GSTINs are clients.
--    A User ID several GSTINs share asks for each of them.
--  * A queued link waits in client_password_resets, which nobody but the
--    service role can read: RLS on and NO policies, like portal_sessions. The
--    Edge Function client-password-reset claims it, which mints the token
--    (only its sha256 is stored), e-mails the link through Microsoft Graph and
--    marks it sent or failed. The link never goes through email_outbox,
--    whose rows anyone with the anon key can read.
--  * The link always points at https://gst.vjdesai.com, fixed here: never
--    read from a table the anon key can change (notice_settings is open).
--  * The link works once, for 60 minutes; a newer request voids it; using it
--    sets the password (bcrypt), voids every other open link and is logged.
--    Until it is used the current password keeps working.
--  * A client is never left with neither a link nor staff help: no usable
--    e-mail, a failed or lost e-mail, or a request refused by a limit (with
--    no link still open to the address on record) files one pending
--    password_reset_requests row for staff. Its note never names the e-mail
--    address or the reason. A link that does go out, to the address on
--    record, answers that request.
--  * A link is good only while every address it went to is still on record:
--    changing clients.email voids links to an address no longer there (a
--    trigger; staff asked if one was still live), the mailer never mints a
--    token for one, and the reset page refuses one.
--  * A link not claimed within 15 minutes, or claimed and its send not
--    confirmed within 15 minutes, is lost: voided, logged, staff asked.
--    pg_cron checks every 5 minutes (and wakes the mailer again for links
--    still waiting); a request, a claim and an e-mail change check too, so a
--    retry or a new address never voids a lost link unreported. The mailer
--    retries its report; a report repeated changes nothing.
--  * client_password_log (who changed a password, how) is private too; staff
--    read it through client_password_log_for. It shows e-mail addresses only
--    masked.
--  * staff_set_client_password: any staff level (superadmin, GST Manager, any
--    employee, no permission key needed); logged; voids open links.
--  * Locks, one order everywhere: the client's clients row, then the
--    client's advisory lock. An Edit Client save holds the row (FOR UPDATE
--    when it changes the GSTIN, a key column) when its e-mail trigger takes
--    the advisory lock, and every insert into a table with a foreign key to
--    clients locks the row FOR KEY SHARE; so whatever waits locks the row
--    (FOR KEY SHARE, or FOR NO KEY UPDATE to change it) before the advisory
--    lock, and the sweep and the claim, which never wait, try both and leave
--    a busy client to the next run.
--
-- Safe to re-run.

BEGIN;

-- ── The queue of links (private) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_password_resets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  via               text NOT NULL CHECK (via IN ('self', 'staff')),
  requested_by      uuid,
  requested_by_name text,
  requested_ip      text,
  sent_to           text NOT NULL,
  email_hint        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  token_hash        text UNIQUE,
  claimed_at        timestamptz,
  expires_at        timestamptz,
  sent_at           timestamptz,
  send_error        text,
  used_at           timestamptz,
  voided_at         timestamptz,
  void_reason       text
);
COMMENT ON TABLE public.client_password_resets IS
  'Client password reset links. Private: RLS on, no policies, service role only. token_hash is the sha256 (hex) of the token in the e-mailed link; the token itself is never stored.';
CREATE INDEX IF NOT EXISTS idx_client_password_resets_client
  ON public.client_password_resets (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_password_resets_created
  ON public.client_password_resets (created_at);
CREATE INDEX IF NOT EXISTS idx_client_password_resets_queue
  ON public.client_password_resets (created_at)
  WHERE claimed_at IS NULL AND voided_at IS NULL AND used_at IS NULL;

-- Every request from the login page, for the rate limits (private, 30 days).
-- One row per client a request reached (a shared User ID reaches several),
-- one row when it reached none; request_id ties them together. ip is the
-- address the limit counts: an IPv4 address, or an IPv6 /64 block.
CREATE TABLE IF NOT EXISTS public.client_password_reset_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL DEFAULT gen_random_uuid(),
  at              timestamptz NOT NULL DEFAULT now(),
  ip              text,
  identifier_hash text,
  client_id       uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  outcome         text NOT NULL
);
-- (An earlier draft of this file had no request_id.)
ALTER TABLE public.client_password_reset_attempts
  ADD COLUMN IF NOT EXISTS request_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.client_password_reset_attempts
  DROP CONSTRAINT IF EXISTS client_password_reset_attempts_outcome_check;
ALTER TABLE public.client_password_reset_attempts
  ADD CONSTRAINT client_password_reset_attempts_outcome_check
  CHECK (outcome IN ('queued', 'no_client', 'no_email', 'rate_limited', 'staff_request', 'invalid'));
COMMENT ON COLUMN public.client_password_reset_attempts.outcome IS
  'queued: a link queued. no_email: no usable address, staff asked. rate_limited: refused by a limit, a link to the address on record is still open (or, with no client, the address limit). staff_request: refused by a limit, staff asked instead. no_client, invalid.';
CREATE INDEX IF NOT EXISTS idx_client_password_reset_attempts_at ON public.client_password_reset_attempts (at);
CREATE INDEX IF NOT EXISTS idx_client_password_reset_attempts_ip ON public.client_password_reset_attempts (ip, at) WHERE ip IS NOT NULL;

ALTER TABLE public.client_password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_password_reset_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_password_resets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.client_password_reset_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.client_password_resets TO service_role;
GRANT ALL ON public.client_password_reset_attempts TO service_role;

-- ── Who changed a client's password, and how (private; staff read it ───────
-- through client_password_log_for). Open, it would show which identifiers
-- are clients and which have an e-mail, undoing the one answer.
CREATE TABLE IF NOT EXISTS public.client_password_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at         timestamptz NOT NULL DEFAULT now(),
  client_id  uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  action     text NOT NULL,
  actor_id   uuid,
  actor_name text,
  detail     text
);
ALTER TABLE public.client_password_log DROP CONSTRAINT IF EXISTS client_password_log_action_check;
ALTER TABLE public.client_password_log ADD CONSTRAINT client_password_log_action_check
  CHECK (action IN ('staff_reset', 'link_queued', 'link_sent', 'link_failed', 'link_voided', 'link_used', 'fallback_request'));
CREATE INDEX IF NOT EXISTS idx_client_password_log_client ON public.client_password_log (client_id, at DESC);
ALTER TABLE public.client_password_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app read client_password_log" ON public.client_password_log;
REVOKE ALL ON public.client_password_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.client_password_log TO service_role;

-- Requests filed for staff carry a note (never the e-mail address or why:
-- password_reset_requests is open to the anon key).
ALTER TABLE public.password_reset_requests ADD COLUMN IF NOT EXISTS note text;

-- ── Helpers ────────────────────────────────────────────────────────────────
-- The well-formed addresses in clients.email (comma, semicolon or space
-- separated), first spelling of each kept, in the order written.
CREATE OR REPLACE FUNCTION public.client_email_list(p_email text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(array_agg(s.e ORDER BY s.ord), '{}'::text[])
    FROM (
      SELECT DISTINCT ON (lower(btrim(t.x))) btrim(t.x) AS e, t.ord
        FROM unnest(regexp_split_to_array(COALESCE(p_email, ''), '[,;[:space:]]+')) WITH ORDINALITY AS t(x, ord)
       WHERE btrim(t.x) ~ '^[^@[:space:]<>"]+@[^@[:space:]<>"]+\.[^@[:space:]<>".]{2,}$'
       ORDER BY lower(btrim(t.x)), t.ord
    ) s
$$;

-- p•••@navratna.com (and "+ 1 more" when there are several).
CREATE OR REPLACE FUNCTION public.client_email_hint(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN cardinality(l) = 0 THEN NULL
    ELSE left(split_part(l[1], '@', 1), 1) || '•••@' || split_part(l[1], '@', 2)
         || CASE WHEN cardinality(l) > 1 THEN ' + ' || (cardinality(l) - 1) || ' more' ELSE '' END
  END
  FROM (SELECT public.client_email_list(p_email) AS l) s
$$;

-- Did a link go only to addresses still on record? p_sent_to is the link's
-- sent_to, p_email the client's clients.email now. Case, separators and order
-- do not matter, and an address added since does not either; a link that
-- went to an address staff have since removed or replaced is no longer the
-- client's (a mistyped domain, an ex-accountant).
CREATE OR REPLACE FUNCTION public.client_password_sent_to_current(p_sent_to text, p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT cardinality(public.client_email_list(p_sent_to)) > 0
     AND NOT EXISTS (
       SELECT 1 FROM unnest(public.client_email_list(p_sent_to)) AS s(e)
        WHERE lower(s.e) <> ALL (SELECT lower(x.e) FROM unnest(public.client_email_list(p_email)) AS x(e)))
$$;

-- The rules a client's own new password must meet (mirrored in
-- src/lib/passwordRules.ts). NULL when the password is fine.
CREATE OR REPLACE FUNCTION public.client_password_problem(p_password text, p_gstin text DEFAULT NULL)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_password IS NULL OR length(p_password) < 8 THEN 'The new password must be at least 8 characters.'
    WHEN length(p_password) > 72 THEN 'The new password can be at most 72 characters.'
    WHEN p_password <> btrim(p_password) THEN 'The new password cannot start or end with a space.'
    WHEN p_gstin IS NOT NULL AND upper(p_password) = upper(btrim(p_gstin)) THEN 'The new password cannot be your GSTIN.'
    WHEN upper(p_password) ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' THEN 'The new password cannot be a GSTIN.'
    ELSE NULL
  END
$$;

-- The caller's address as the API gateway passed it on (best effort; NULL
-- outside a PostgREST request).
CREATE OR REPLACE FUNCTION public.client_password_request_ip()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE h json; v text;
BEGIN
  BEGIN
    h := NULLIF(current_setting('request.headers', true), '')::json;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF h IS NULL THEN RETURN NULL; END IF;
  v := COALESCE(NULLIF(btrim(h ->> 'cf-connecting-ip'), ''),
                NULLIF(btrim(h ->> 'x-real-ip'), ''),
                NULLIF(btrim(split_part(COALESCE(h ->> 'x-forwarded-for', ''), ',', 1)), ''));
  RETURN left(v, 64);
END;
$$;

-- What the per-address limit counts: an IPv4 address as it is, an IPv6
-- address by its /64 block (one home or office line gets a whole /64), an
-- IPv4-mapped IPv6 address as its IPv4 address. Anything else as written.
CREATE OR REPLACE FUNCTION public.client_password_ip_key(p_ip text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE v inet;
BEGIN
  IF p_ip IS NULL OR btrim(p_ip) = '' THEN RETURN NULL; END IF;
  BEGIN
    v := btrim(p_ip)::inet;
  EXCEPTION WHEN others THEN
    RETURN left(lower(btrim(p_ip)), 64);
  END;
  IF family(v) = 6 THEN
    IF v << '::ffff:0.0.0.0/96'::inet THEN
      RETURN host('0.0.0.0'::inet + (set_masklen(v, 128) - '::ffff:0.0.0.0'::inet));
    END IF;
    RETURN network(set_masklen(v, 64))::text;
  END IF;
  RETURN host(v);
END;
$$;

-- Wake the mailer (Edge Function client-password-reset) once this
-- transaction commits. pg_net and the Vault key the cron jobs use
-- (20260726130000); a missing piece only means the app's own call or the next
-- request sends the link.
CREATE OR REPLACE FUNCTION public.client_password_reset_ping()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_key text;
BEGIN
  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RETURN;
  END IF;
  BEGIN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''gst_cron_anon_key'' LIMIT 1'
       INTO v_key;
    IF v_key IS NULL THEN RETURN; END IF;
    PERFORM net.http_post(
      url := 'https://gcquafqxbykxkbexcdpy.supabase.co/functions/v1/client-password-reset',
      body := '{}'::jsonb,
      params := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      timeout_milliseconds := 30000);
  EXCEPTION WHEN others THEN
    NULL;
  END;
END;
$$;

-- The note on every request this file files for staff (and how a sent link
-- finds the requests it answers). It names the Dashboard's own "Reset
-- password" button, whose dialog shows why (client_password_log_for, any
-- staff level), never a screen some staff cannot open (Edit Client).
CREATE OR REPLACE FUNCTION public.client_password_staff_note()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 'Asked for a reset link; none reached the client. Reset password shows why.'::text $$;

-- One pending request for staff per client (the Dashboard). p_why goes to the
-- private log only; the open request carries a fixed note. True when filed.
CREATE OR REPLACE FUNCTION public.client_password_staff_request(p_client_id uuid, p_why text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_name text; v_gstin text;
BEGIN
  -- The clients row, then the client's lock (see Locks above).
  PERFORM 1 FROM public.clients c WHERE c.id = p_client_id FOR KEY SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('client_password_reset:' || p_client_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.password_reset_requests q
              WHERE q.user_id = p_client_id AND q.status = 'pending') THEN
    RETURN false;
  END IF;
  SELECT c.name, c.gstin INTO v_name, v_gstin FROM public.clients c WHERE c.id = p_client_id;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.password_reset_requests (user_id, requested_by_name, status, note)
  VALUES (p_client_id, v_name || ' (' || v_gstin || ')', 'pending', public.client_password_staff_note());
  INSERT INTO public.client_password_log (client_id, action, detail)
  VALUES (p_client_id, 'fallback_request', btrim(COALESCE(p_why, '') || ' A request is waiting on the Dashboard.'));
  RETURN true;
END;
$$;

-- Is a link still on its way to the client, or in their mailbox and good?
-- (Waiting to be claimed for under 15 minutes, being sent for under 15
-- minutes, or sent and not expired; never used, voided or failed; and sent
-- only to addresses on record now, since a link to an address staff have
-- since corrected is no help to the client.)
CREATE OR REPLACE FUNCTION public.client_password_has_open_link(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_password_resets r
      JOIN public.clients c ON c.id = r.client_id
     WHERE r.client_id = p_client_id
       AND r.used_at IS NULL AND r.voided_at IS NULL AND r.send_error IS NULL
       AND public.client_password_sent_to_current(r.sent_to, c.email)
       AND (   (r.claimed_at IS NULL AND r.created_at > now() - interval '15 minutes')
            OR (r.sent_at IS NULL AND r.claimed_at > now() - interval '15 minutes')
            OR (r.sent_at IS NOT NULL AND r.expires_at > now())))
$$;

-- One client's links that will never arrive: not claimed within 15 minutes
-- (the mailer did not run; a working one claims in seconds), or claimed but
-- its send not confirmed within 15 minutes (the mailer stopped half way, or
-- its report back never arrived: the e-mail may have gone, so nothing says
-- it did not). Each is voided and logged, and staff are asked instead
-- (p_ask_staff false: staff are sending a link right now). The caller holds
-- the client's row and lock.
CREATE OR REPLACE FUNCTION public.client_password_reset_sweep_client(p_client_id uuid, p_ask_staff boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE r record; n integer := 0; v_unconfirmed boolean := false;
BEGIN
  -- Already held by every caller (row locks and advisory locks are
  -- re-entrant): never waits. In the usual order for any other caller.
  PERFORM 1 FROM public.clients c WHERE c.id = p_client_id FOR KEY SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended('client_password_reset:' || p_client_id::text, 0));
  FOR r IN
    SELECT x.id, x.claimed_at IS NULL AS unclaimed, x.email_hint
      FROM public.client_password_resets x
     WHERE x.client_id = p_client_id
       AND x.used_at IS NULL AND x.voided_at IS NULL AND x.sent_at IS NULL AND x.send_error IS NULL
       AND (   (x.claimed_at IS NULL AND x.created_at <= now() - interval '15 minutes')
            OR (x.claimed_at <= now() - interval '15 minutes'))
     ORDER BY x.created_at
  LOOP
    -- Checked again on the row: a claim that just committed keeps its link.
    UPDATE public.client_password_resets x
       SET voided_at = now(),
           void_reason = CASE WHEN r.unclaimed THEN 'not sent in time' ELSE 'the send could not be confirmed' END
     WHERE x.id = r.id AND x.used_at IS NULL AND x.voided_at IS NULL AND x.sent_at IS NULL AND x.send_error IS NULL
       AND (   (x.claimed_at IS NULL AND x.created_at <= now() - interval '15 minutes')
            OR (x.claimed_at <= now() - interval '15 minutes'));
    CONTINUE WHEN NOT FOUND;
    n := n + 1;
    v_unconfirmed := v_unconfirmed OR NOT r.unclaimed;
    INSERT INTO public.client_password_log (client_id, action, detail)
    VALUES (p_client_id, 'link_failed',
            CASE WHEN r.unclaimed
                 THEN 'The reset link for ' || COALESCE(r.email_hint, 'the client') || ' was not sent within 15 minutes, so it was given up.'
                 ELSE 'The send of the reset link to ' || COALESCE(r.email_hint, 'the client')
                      || ' could not be confirmed within 15 minutes, so the link was voided.'
            END);
  END LOOP;
  IF n > 0 AND p_ask_staff THEN
    PERFORM public.client_password_staff_request(p_client_id,
      CASE WHEN v_unconfirmed THEN 'The send of the reset link could not be confirmed.'
           ELSE 'The reset link did not go out.' END);
  END IF;
  RETURN n;
END;
$$;

-- Every client's lost links. Run by pg_cron every 5 minutes (through
-- client_password_reset_tick), by the claim and after every request. It only
-- tries each client's row and lock (in that order), so it never waits while
-- holding one; a busy client is left to the next sweep.
CREATE OR REPLACE FUNCTION public.client_password_reset_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_cid uuid; n integer := 0;
BEGIN
  FOR v_cid IN
    SELECT x.client_id
      FROM public.client_password_resets x
     WHERE x.used_at IS NULL AND x.voided_at IS NULL AND x.sent_at IS NULL AND x.send_error IS NULL
       AND (   (x.claimed_at IS NULL AND x.created_at <= now() - interval '15 minutes')
            OR (x.claimed_at <= now() - interval '15 minutes'))
     GROUP BY x.client_id
     ORDER BY min(x.created_at)
     LIMIT 200
  LOOP
    -- A row held by a save (say a GSTIN change, whose e-mail trigger is about
    -- to take the client's lock) is skipped, never waited for.
    PERFORM 1 FROM public.clients c WHERE c.id = v_cid FOR KEY SHARE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
    CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('client_password_reset:' || v_cid::text, 0));
    n := n + public.client_password_reset_sweep_client(v_cid);
  END LOOP;
  RETURN n;
END;
$$;

-- pg_cron, every 5 minutes (scheduled at the end of this file): the sweep,
-- whatever the traffic, and one more wake-up for the mailer while a link is
-- still waiting (the first one may have been lost).
CREATE OR REPLACE FUNCTION public.client_password_reset_tick()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE n integer;
BEGIN
  n := public.client_password_reset_sweep();
  IF EXISTS (SELECT 1 FROM public.client_password_resets r
              WHERE r.claimed_at IS NULL AND r.voided_at IS NULL AND r.used_at IS NULL
                AND r.created_at > now() - interval '15 minutes') THEN
    PERFORM public.client_password_reset_ping();
  END IF;
  RETURN n;
END;
$$;

-- ── The client's e-mail address changes (Edit Client, any update) ─────────
-- Links that never went out are reported first, as everywhere (logged as
-- lost, staff asked): voided here as "the e-mail address changed" they would
-- not count as live, and a client who asked would be left with nothing.
-- Then links that went, or would go, to an address no longer on record are
-- voided and logged: whoever holds the old mailbox must not be able to use
-- one. If one of them was still live (on its way, or sent and not expired)
-- and no link to the address on record is open, staff are asked. The row is
-- already locked by the update; the client's advisory lock comes second (see
-- Locks above).
CREATE OR REPLACE FUNCTION public.client_password_email_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE r record; v_live boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('client_password_reset:' || NEW.id::text, 0));
  PERFORM public.client_password_reset_sweep_client(NEW.id);
  FOR r IN
    SELECT x.id, x.email_hint,
           x.send_error IS NULL AND (
                (x.claimed_at IS NULL AND x.created_at > now() - interval '15 minutes')
             OR (x.sent_at IS NULL AND x.claimed_at > now() - interval '15 minutes')
             OR (x.sent_at IS NOT NULL AND x.expires_at > now())) AS live
      FROM public.client_password_resets x
     WHERE x.client_id = NEW.id AND x.used_at IS NULL AND x.voided_at IS NULL
       AND NOT public.client_password_sent_to_current(x.sent_to, NEW.email)
     ORDER BY x.created_at
     FOR UPDATE
  LOOP
    UPDATE public.client_password_resets x
       SET voided_at = now(), void_reason = 'the e-mail address changed'
     WHERE x.id = r.id;
    v_live := v_live OR r.live;
    INSERT INTO public.client_password_log (client_id, action, detail)
    VALUES (NEW.id, 'link_voided',
            'The e-mail address on record changed, so the reset link to ' || COALESCE(r.email_hint, 'the old address')
            || ' was voided.');
  END LOOP;
  IF v_live AND NOT public.client_password_has_open_link(NEW.id) THEN
    PERFORM public.client_password_staff_request(NEW.id,
      'The e-mail address changed while a reset link was open, so the link was voided.');
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS client_password_email_changed ON public.clients;
CREATE TRIGGER client_password_email_changed
  AFTER UPDATE OF email ON public.clients
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.client_password_email_changed();

-- ── 1. A client asks for a link (login page / client dashboard) ────────────
-- One client the request reached (the GSTIN, or one of the clients sharing a
-- User ID): queue a link, or say why not. Returns the attempt's outcome.
CREATE OR REPLACE FUNCTION public.client_password_reset_for_client(
  p_client_id uuid, p_ip text, p_address_limited boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email  text;
  v_emails text[];
  v_to     text;
  v_hint   text;
BEGIN
  -- One request per client at a time: the clients row, then the client's
  -- lock (see Locks above). The address is read under both, so an e-mail
  -- change saving right now is either seen here or voids this link when it
  -- commits.
  PERFORM 1 FROM public.clients c WHERE c.id = p_client_id FOR KEY SHARE;
  IF NOT FOUND THEN RETURN 'no_client'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('client_password_reset:' || p_client_id::text, 0));
  SELECT c.email INTO v_email FROM public.clients c WHERE c.id = p_client_id;

  -- An earlier link that never went out is reported first (logged, staff
  -- asked), so a retry never voids it unreported as "a newer link".
  PERFORM public.client_password_reset_sweep_client(p_client_id);

  -- Per address: refused. A link already on its way or in the client's
  -- mailbox (to the address on record) is enough; otherwise staff are asked.
  IF p_address_limited THEN
    IF public.client_password_has_open_link(p_client_id) THEN
      RETURN 'rate_limited';
    END IF;
    PERFORM public.client_password_staff_request(p_client_id,
      'Asked for a reset link, but too many requests came from the same address this hour.');
    RETURN 'staff_request';
  END IF;

  -- Per client: one link a minute, three of its own an hour, five an hour in
  -- all (staff links too). A link from a moment ago is still open (to the
  -- address on record now), so nothing more is needed; if none is, staff are
  -- asked.
  IF EXISTS (SELECT 1 FROM public.client_password_resets r
              WHERE r.client_id = p_client_id AND r.created_at > now() - interval '60 seconds')
     OR (SELECT count(*) FROM public.client_password_resets r
          WHERE r.client_id = p_client_id AND r.via = 'self' AND r.created_at > now() - interval '1 hour') >= 3
     OR (SELECT count(*) FROM public.client_password_resets r
          WHERE r.client_id = p_client_id AND r.created_at > now() - interval '1 hour') >= 5 THEN
    IF public.client_password_has_open_link(p_client_id) THEN
      RETURN 'rate_limited';
    END IF;
    PERFORM public.client_password_staff_request(p_client_id,
      'Asked for a reset link too often this hour, and no earlier link is still open.');
    RETURN 'staff_request';
  END IF;

  -- All clients: 300 links an hour (the firm has about 130 clients). Refused
  -- the same way: nothing more with a link open, staff asked without one.
  IF (SELECT count(*) FROM public.client_password_resets r WHERE r.created_at > now() - interval '1 hour') >= 300 THEN
    IF public.client_password_has_open_link(p_client_id) THEN
      RETURN 'rate_limited';
    END IF;
    PERFORM public.client_password_staff_request(p_client_id,
      'Asked for a reset link, but the hourly limit for all clients was reached.');
    RETURN 'staff_request';
  END IF;

  v_emails := public.client_email_list(v_email);
  IF cardinality(v_emails) = 0 THEN
    -- Nowhere to send it: staff are asked instead (once).
    PERFORM public.client_password_staff_request(p_client_id,
      'Asked for a reset link, but there is no e-mail address on record.');
    RETURN 'no_email';
  END IF;
  v_to := array_to_string(v_emails, ', ');
  v_hint := public.client_email_hint(v_to);

  -- A new link replaces any earlier one still open.
  UPDATE public.client_password_resets r
     SET voided_at = now(), void_reason = 'a newer link was asked for'
   WHERE r.client_id = p_client_id AND r.used_at IS NULL AND r.voided_at IS NULL;

  INSERT INTO public.client_password_resets (client_id, via, requested_ip, sent_to, email_hint)
  VALUES (p_client_id, 'self', p_ip, v_to, v_hint);
  INSERT INTO public.client_password_log (client_id, action, detail)
  VALUES (p_client_id, 'link_queued', 'The client asked for a reset link, to ' || v_hint || '.');

  PERFORM public.client_password_reset_ping();
  RETURN 'queued';
END;
$$;

CREATE OR REPLACE FUNCTION public.client_password_reset_request(p_identifier text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  -- One answer for every outcome.
  c_answer constant jsonb := jsonb_build_object('ok', true);
  v_ident  text := upper(btrim(COALESCE(p_identifier, '')));
  v_ip     text := public.client_password_request_ip();
  v_key    text := public.client_password_ip_key(v_ip);
  v_req    uuid := gen_random_uuid();
  v_hash   text;
  v_ids    uuid[];
  v_cid    uuid;
  v_limited boolean;
BEGIN
  DELETE FROM public.client_password_reset_attempts WHERE at < now() - interval '30 days';

  IF v_ident = '' OR length(v_ident) > 64 THEN
    INSERT INTO public.client_password_reset_attempts (request_id, ip, outcome) VALUES (v_req, v_key, 'invalid');
    RETURN c_answer;
  END IF;
  v_hash := encode(digest(v_ident, 'sha256'), 'hex');

  -- The GSTIN; otherwise every client with that User ID (two GSTINs of one
  -- PAN can share one, and it signs in to either): each is its own request.
  SELECT array_agg(c.id ORDER BY c.id) INTO v_ids
    FROM public.clients c WHERE upper(btrim(c.gstin)) = v_ident;
  IF v_ids IS NULL THEN
    SELECT array_agg(c.id ORDER BY c.id) INTO v_ids
      FROM public.clients c WHERE upper(btrim(c.client_user_id)) = v_ident;
  END IF;

  -- Per address (IPv6 by /64): ten requests an hour, whatever they were for.
  v_limited := v_key IS NOT NULL AND (
    SELECT count(DISTINCT a.request_id) FROM public.client_password_reset_attempts a
     WHERE a.ip = v_key AND a.at > now() - interval '1 hour') >= 10;

  IF v_ids IS NULL THEN
    INSERT INTO public.client_password_reset_attempts (request_id, ip, identifier_hash, outcome)
    VALUES (v_req, v_key, v_hash, CASE WHEN v_limited THEN 'rate_limited' ELSE 'no_client' END);
    RETURN c_answer;
  END IF;

  FOREACH v_cid IN ARRAY v_ids LOOP
    INSERT INTO public.client_password_reset_attempts (request_id, ip, identifier_hash, client_id, outcome)
    VALUES (v_req, v_key, v_hash, v_cid, public.client_password_reset_for_client(v_cid, v_ip, v_limited));
  END LOOP;

  -- Last, so it never waits on a lock while holding one.
  PERFORM public.client_password_reset_sweep();
  RETURN c_answer;
END;
$$;

-- ── 2. The mailer claims waiting links (service role only) ─────────────────
-- Mints each token here, stores only its sha256, and hands the token to the
-- Edge Function, which e-mails it and calls client_password_reset_mark.
CREATE OR REPLACE FUNCTION public.client_password_reset_claim(p_limit integer DEFAULT 10)
RETURNS TABLE (reset_id uuid, token text, link text, client_id uuid, client_name text,
               gstin text, to_email text, expires_at timestamptz, via text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  -- The app's address, fixed. Never read from a table: notice_settings (and
  -- every other app table) can be changed with the anon key, and a link to
  -- another site would hand it a working token.
  c_base  constant text := 'https://gst.vjdesai.com';
  v       record;
  v_id    uuid;
  v_token text;
BEGIN
  -- Links that will never arrive are voided and staff asked instead.
  PERFORM public.client_password_reset_sweep();

  -- (Waiting for under 15 minutes; an older one has just been given up.)
  FOR v IN
    SELECT r.id, r.client_id, r.email_hint,
           public.client_password_sent_to_current(r.sent_to, c.email) AS to_record
      FROM public.client_password_resets r
      JOIN public.clients c ON c.id = r.client_id
     WHERE r.claimed_at IS NULL AND r.voided_at IS NULL AND r.used_at IS NULL
       AND r.created_at > now() - interval '15 minutes'
     ORDER BY r.created_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50))
     FOR UPDATE OF r SKIP LOCKED
  LOOP
    v_id := v.id;
    IF NOT v.to_record THEN
      -- The address on record changed after this link was asked for (the
      -- e-mail trigger voids such links; this catches one queued in the same
      -- moment). No token for an address that is no longer the client's: the
      -- link is voided, logged, and staff asked unless another is on its way.
      -- A client busy right now (its row or its lock held) is left to the
      -- next claim: both are only tried, the row first.
      PERFORM 1 FROM public.clients c WHERE c.id = v.client_id FOR KEY SHARE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;
      CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('client_password_reset:' || v.client_id::text, 0));
      UPDATE public.client_password_resets r
         SET voided_at = now(), void_reason = 'the e-mail address changed'
       WHERE r.id = v_id AND r.claimed_at IS NULL AND r.voided_at IS NULL AND r.used_at IS NULL
         AND NOT public.client_password_sent_to_current(
               r.sent_to, (SELECT c.email FROM public.clients c WHERE c.id = r.client_id));
      CONTINUE WHEN NOT FOUND;
      INSERT INTO public.client_password_log (client_id, action, detail)
      VALUES (v.client_id, 'link_voided',
              'The e-mail address on record changed before the reset link to ' || COALESCE(v.email_hint, 'the old address')
              || ' was sent, so it was voided.');
      IF NOT public.client_password_has_open_link(v.client_id) THEN
        PERFORM public.client_password_staff_request(v.client_id,
          'The e-mail address changed before the reset link was sent.');
      END IF;
      CONTINUE;
    END IF;
    v_token := encode(gen_random_bytes(32), 'hex');
    UPDATE public.client_password_resets r
       SET token_hash = encode(digest(v_token, 'sha256'), 'hex'),
           claimed_at = now(),
           expires_at = now() + interval '60 minutes'
     WHERE r.id = v_id;
    RETURN QUERY
      SELECT r.id, v_token, c_base || '/reset-password#token=' || v_token, c.id, c.name, c.gstin,
             r.sent_to, r.expires_at, r.via
        FROM public.client_password_resets r
        JOIN public.clients c ON c.id = r.client_id
       WHERE r.id = v_id;
  END LOOP;
END;
$$;

-- ── 3. The mailer reports back (service role only) ─────────────────────────
-- The mailer retries a report it could not make (it cannot tell whether one
-- that failed on the way arrived), so a link's first report stands and a
-- repeat changes nothing.
CREATE OR REPLACE FUNCTION public.client_password_reset_mark(p_reset_id uuid, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v record; v_cid uuid; v_hint text; v_closed integer := 0; v_moved boolean;
BEGIN
  SELECT r.client_id INTO v_cid FROM public.client_password_resets r WHERE r.id = p_reset_id;
  IF v_cid IS NULL THEN RETURN; END IF;
  -- The clients row, then the client's lock (see Locks above).
  PERFORM 1 FROM public.clients c WHERE c.id = v_cid FOR KEY SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended('client_password_reset:' || v_cid::text, 0));
  SELECT r.id, r.client_id, r.email_hint, r.requested_by, r.requested_by_name, r.via, r.used_at,
         r.voided_at, r.void_reason, r.sent_to, r.sent_at, r.send_error
    INTO v
    FROM public.client_password_resets r
   WHERE r.id = p_reset_id
   FOR UPDATE;
  IF v.sent_at IS NOT NULL OR v.send_error IS NOT NULL THEN
    RETURN;  -- Already reported.
  END IF;
  v_hint := COALESCE(v.email_hint, 'the client');
  -- Did it go to an address staff have since removed or replaced?
  v_moved := NOT public.client_password_sent_to_current(
               v.sent_to, (SELECT c.email FROM public.clients c WHERE c.id = v.client_id));

  IF p_error IS NULL THEN
    UPDATE public.client_password_resets SET sent_at = now(), send_error = NULL WHERE id = p_reset_id;
    IF v.used_at IS NULL AND v.voided_at IS NULL AND v_moved THEN
      -- In a mailbox that is no longer the client's: it must not work there,
      -- and it answers nothing. Staff are asked unless another link is open.
      UPDATE public.client_password_resets
         SET voided_at = now(), void_reason = 'the e-mail address changed'
       WHERE id = p_reset_id;
    ELSIF v.used_at IS NULL AND v.voided_at IS NULL THEN
      -- A good link is now in the client's mailbox, at the address on record.
      -- A request filed for staff because none reached the client is answered
      -- by it, and acting on that request (a password, another link) would
      -- void the link the client holds.
      UPDATE public.password_reset_requests q
         SET status = 'resolved', resolved_at = now()
       WHERE q.user_id = v.client_id AND q.status = 'pending'
         AND q.note = public.client_password_staff_note();
      GET DIAGNOSTICS v_closed = ROW_COUNT;
    END IF;
    INSERT INTO public.client_password_log (client_id, action, actor_id, actor_name, detail)
    VALUES (v.client_id, 'link_sent', v.requested_by, v.requested_by_name,
            'Reset link e-mailed to ' || v_hint || '.'
            || CASE WHEN v.used_at IS NULL AND v.voided_at IS NOT NULL
                    THEN ' It was already void (' || COALESCE(v.void_reason, 'voided') || '), so it does not work.'
                    WHEN v.used_at IS NULL AND v_moved
                    THEN ' That address is no longer on record, so the link was voided and does not work.'
                    ELSE '' END
            || CASE WHEN v_closed > 0 THEN ' The request waiting on the Dashboard was closed: this link answers it.'
                    ELSE '' END);
    IF v.used_at IS NULL AND v.voided_at IS NULL AND v_moved
       AND NOT public.client_password_has_open_link(v.client_id) THEN
      PERFORM public.client_password_staff_request(v.client_id,
        'The reset link went to an e-mail address that is no longer on record.');
    END IF;
    RETURN;
  END IF;

  UPDATE public.client_password_resets
     SET send_error = left(p_error, 500),
         voided_at = COALESCE(voided_at, now()),
         void_reason = COALESCE(void_reason, 'the e-mail could not be sent')
   WHERE id = p_reset_id AND used_at IS NULL;
  INSERT INTO public.client_password_log (client_id, action, actor_id, actor_name, detail)
  VALUES (v.client_id, 'link_failed', v.requested_by, v.requested_by_name,
          'The reset link could not be e-mailed to ' || v_hint || ': ' || left(p_error, 300)
          || CASE WHEN v.used_at IS NULL AND v.voided_at IS NOT NULL
                  THEN ' (It was already void: ' || COALESCE(v.void_reason, 'voided') || '.)'
                  ELSE '' END);
  -- Staff are asked only when this was the client's live link and nothing
  -- else is on its way. A link already replaced by a newer one (or voided by
  -- a reset, a sweep, another link used) needs nothing more: the newer link
  -- reports its own failure.
  IF v.used_at IS NULL AND v.voided_at IS NULL AND NOT public.client_password_has_open_link(v.client_id) THEN
    PERFORM public.client_password_staff_request(v.client_id, 'The e-mail with the reset link could not be sent.');
  END IF;
END;
$$;

-- ── 4. The reset page: is the link good? ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.client_password_reset_check(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v record;
BEGIN
  IF p_token IS NULL OR btrim(p_token) !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('valid', false);
  END IF;
  -- (A link that went to an address no longer on record is not good either.)
  SELECT r.expires_at, c.name, c.gstin INTO v
    FROM public.client_password_resets r
    JOIN public.clients c ON c.id = r.client_id
   WHERE r.token_hash = encode(digest(btrim(p_token), 'sha256'), 'hex')
     AND r.used_at IS NULL AND r.voided_at IS NULL AND r.expires_at > now()
     AND public.client_password_sent_to_current(r.sent_to, c.email);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false);
  END IF;
  RETURN jsonb_build_object(
    'valid', true,
    'client_name', v.name,
    'gstin_masked', left(v.gstin, 2) || repeat('•', GREATEST(length(v.gstin) - 5, 0)) || right(v.gstin, 3),
    'expires_at', v.expires_at);
END;
$$;

-- ── 5. The reset page: set the new password ────────────────────────────────
CREATE OR REPLACE FUNCTION public.client_password_reset_complete(p_token text, p_new_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id      uuid;
  v_cid     uuid;
  v_used    timestamptz;
  v_voided  timestamptz;
  v_expires timestamptz;
  v_gstin   text;
  v_current boolean;
  v_problem text;
BEGIN
  IF p_token IS NOT NULL AND btrim(p_token) ~ '^[0-9a-f]{64}$' THEN
    SELECT r.client_id INTO v_cid
      FROM public.client_password_resets r
     WHERE r.token_hash = encode(digest(btrim(p_token), 'sha256'), 'hex');
  END IF;
  IF v_cid IS NOT NULL THEN
    -- The clients row first, then the advisory lock (the order an e-mail
    -- change takes them in), so the two never wait on each other.
    PERFORM 1 FROM public.clients c WHERE c.id = v_cid FOR NO KEY UPDATE;
    PERFORM pg_advisory_xact_lock(hashtextextended('client_password_reset:' || v_cid::text, 0));
    SELECT r.id, r.used_at, r.voided_at, r.expires_at, c.gstin,
           public.client_password_sent_to_current(r.sent_to, c.email)
      INTO v_id, v_used, v_voided, v_expires, v_gstin, v_current
      FROM public.client_password_resets r
      JOIN public.clients c ON c.id = r.client_id
     WHERE r.token_hash = encode(digest(btrim(p_token), 'sha256'), 'hex')
     FOR UPDATE OF r;
  END IF;
  -- A link that went to an address no longer on record does not work: its
  -- mailbox is not the client's any more.
  IF v_id IS NULL OR v_used IS NOT NULL OR v_voided IS NOT NULL OR v_expires IS NULL OR v_expires <= now()
     OR v_current IS NOT TRUE THEN
    RAISE EXCEPTION 'This link is invalid or has expired. Ask for a new one from the login page.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_problem := public.client_password_problem(p_new_password, v_gstin);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problem USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.clients
     SET client_password = crypt(p_new_password, gen_salt('bf', 10)), is_first_login = false, updated_at = now()
   WHERE id = v_cid;
  UPDATE public.client_password_resets SET used_at = now() WHERE id = v_id;
  UPDATE public.client_password_resets r
     SET voided_at = now(), void_reason = 'another link was used'
   WHERE r.client_id = v_cid AND r.id <> v_id AND r.used_at IS NULL AND r.voided_at IS NULL;
  UPDATE public.password_reset_requests
     SET status = 'resolved', resolved_at = now()
   WHERE user_id = v_cid AND status = 'pending';
  INSERT INTO public.client_password_log (client_id, action, detail)
  VALUES (v_cid, 'link_used', 'The client set a new password with the e-mailed link.');
  RETURN jsonb_build_object('ok', true, 'user_id', v_gstin);
END;
$$;

-- ── 6. Staff: set a client's password (any staff level) ────────────────────
-- Same three arguments as before (20261014120000) plus an optional note for
-- the log; the 3-argument version is replaced.
DROP FUNCTION IF EXISTS public.staff_set_client_password(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.staff_set_client_password(
  p_actor_id uuid, p_client_id uuid, p_new_password text, p_note text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_name text;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = p_actor_id AND ur.role::text IN ('superadmin', 'gst_manager', 'employee')) THEN
    RAISE EXCEPTION 'Only a staff member can reset a client''s password.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_new_password IS NULL OR length(p_new_password) < 8 THEN
    RAISE EXCEPTION 'The new password must be at least 8 characters.' USING ERRCODE = 'check_violation';
  END IF;
  IF length(p_new_password) > 72 THEN
    RAISE EXCEPTION 'The new password can be at most 72 characters.' USING ERRCODE = 'check_violation';
  END IF;

  IF p_client_id IS NOT NULL THEN
    -- The clients row first, then the advisory lock (as an e-mail change).
    PERFORM 1 FROM public.clients c WHERE c.id = p_client_id FOR NO KEY UPDATE;
    PERFORM pg_advisory_xact_lock(hashtextextended('client_password_reset:' || p_client_id::text, 0));
  END IF;
  UPDATE public.clients
     SET client_password = crypt(p_new_password, gen_salt('bf', 10)), is_first_login = true, updated_at = now()
   WHERE id = p_client_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT p.first_name INTO v_name FROM public.profiles p WHERE p.user_id = p_actor_id LIMIT 1;
  UPDATE public.client_password_resets r
     SET voided_at = now(), void_reason = 'staff set a password'
   WHERE r.client_id = p_client_id AND r.used_at IS NULL AND r.voided_at IS NULL;
  UPDATE public.password_reset_requests
     SET status = 'resolved', resolved_at = now(), resolved_by = p_actor_id
   WHERE user_id = p_client_id AND status = 'pending';
  INSERT INTO public.client_password_log (client_id, action, actor_id, actor_name, detail)
  VALUES (p_client_id, 'staff_reset', p_actor_id, v_name,
          COALESCE(NULLIF(btrim(p_note), ''), 'Password set by staff.'));
  RETURN true;
END;
$$;

-- ── 7. Staff: e-mail the client a reset link (any staff level) ─────────────
-- The same per-client limits bind every link, whoever asked: five an hour per
-- client (staff and self together, every link asked for), 300 an hour in all.
-- Links are a minute apart, counting only one that went out to an address
-- still on record or is still on its way: a failed one, or one voided before
-- it went (say, because staff just corrected the address), does not hold the
-- next one back. Each error says what happened.
CREATE OR REPLACE FUNCTION public.staff_send_client_reset_link(p_actor_id uuid, p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_cid    uuid;
  v_email  text;
  v_name   text;
  v_emails text[];
  v_to     text;
  v_hint   text;
  v_recent record;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = p_actor_id AND ur.role::text IN ('superadmin', 'gst_manager', 'employee')) THEN
    RAISE EXCEPTION 'Only a staff member can send a client a reset link.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- The clients row, then the client's lock (see Locks above).
  SELECT c.id INTO v_cid FROM public.clients c WHERE c.id = p_client_id FOR KEY SHARE;
  IF v_cid IS NULL THEN
    RAISE EXCEPTION 'Client not found.' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('client_password_reset:' || v_cid::text, 0));
  -- The address is read under both, so an e-mail change that is saving
  -- right now is either seen here or voids this link when it commits.
  SELECT c.email INTO v_email FROM public.clients c WHERE c.id = v_cid;
  v_emails := public.client_email_list(v_email);
  IF cardinality(v_emails) = 0 THEN
    RAISE EXCEPTION 'This client has no e-mail address on record. Add one in Edit Client, or set a password instead.'
      USING ERRCODE = 'check_violation';
  END IF;
  v_to := array_to_string(v_emails, ', ');
  v_hint := public.client_email_hint(v_to);

  -- An earlier link that never went out is logged as lost, not voided as "a
  -- newer link" unreported. No staff request: staff are acting now.
  PERFORM public.client_password_reset_sweep_client(v_cid, false);
  SELECT r.sent_at IS NOT NULL AS sent INTO v_recent
    FROM public.client_password_resets r
   WHERE r.client_id = v_cid AND r.created_at > now() - interval '60 seconds'
     AND r.send_error IS NULL
     AND public.client_password_sent_to_current(r.sent_to, v_email)
     AND (r.sent_at IS NOT NULL OR (r.used_at IS NULL AND r.voided_at IS NULL))
   ORDER BY r.sent_at IS NOT NULL DESC, r.created_at DESC
   LIMIT 1;
  IF FOUND AND v_recent.sent THEN
    RAISE EXCEPTION 'A reset link went to this client less than a minute ago. Try again in a minute, or set a password.'
      USING ERRCODE = 'check_violation';
  ELSIF FOUND THEN
    RAISE EXCEPTION 'A reset link to this client is on its way. Try again in a minute, or set a password.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM public.client_password_resets r
       WHERE r.client_id = v_cid AND r.created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Five reset links were asked for this client in the last hour. Set a password instead.' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM public.client_password_resets r WHERE r.created_at > now() - interval '1 hour') >= 300 THEN
    RAISE EXCEPTION 'Too many reset links were asked for in the last hour. Set a password instead.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT p.first_name INTO v_name FROM public.profiles p WHERE p.user_id = p_actor_id LIMIT 1;
  UPDATE public.client_password_resets r
     SET voided_at = now(), void_reason = 'a newer link was asked for'
   WHERE r.client_id = v_cid AND r.used_at IS NULL AND r.voided_at IS NULL;
  INSERT INTO public.client_password_resets (client_id, via, requested_by, requested_by_name, sent_to, email_hint)
  VALUES (v_cid, 'staff', p_actor_id, v_name, v_to, v_hint);
  UPDATE public.password_reset_requests
     SET status = 'resolved', resolved_at = now(), resolved_by = p_actor_id
   WHERE user_id = v_cid AND status = 'pending';
  INSERT INTO public.client_password_log (client_id, action, actor_id, actor_name, detail)
  VALUES (v_cid, 'link_queued', p_actor_id, v_name, 'Reset link asked for by staff, to ' || v_hint || '.');

  PERFORM public.client_password_reset_ping();
  RETURN jsonb_build_object('queued', true, 'sent_to', v_to);
END;
$$;

-- ── 8. Staff: read a client's password log (any staff level) ───────────────
CREATE OR REPLACE FUNCTION public.client_password_log_for(p_actor_id uuid, p_client_id uuid, p_limit integer DEFAULT 8)
RETURNS TABLE (id uuid, at timestamptz, action text, actor_name text, detail text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = p_actor_id AND ur.role::text IN ('superadmin', 'gst_manager', 'employee')) THEN
    RAISE EXCEPTION 'Only a staff member can see a client''s password log.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT l.id, l.at, l.action, l.actor_name, l.detail
      FROM public.client_password_log l
     WHERE l.client_id = p_client_id
     ORDER BY l.at DESC, l.id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 8), 100));
END;
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC by default (and Supabase to anon and
-- authenticated): the mailer's functions and the internal helpers are taken
-- back to the service role.
REVOKE EXECUTE ON FUNCTION public.client_password_reset_claim(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_reset_mark(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_reset_ping() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_reset_sweep() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_reset_sweep_client(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_reset_tick() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_staff_note() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_reset_for_client(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_staff_request(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_has_open_link(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_request_ip() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_ip_key(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_sent_to_current(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_email_changed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_password_reset_claim(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_mark(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_ping() TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_sweep() TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_sweep_client(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_tick() TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_staff_note() TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_for_client(uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_staff_request(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_has_open_link(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_request_ip() TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_ip_key(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_sent_to_current(text, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.client_password_reset_request(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_check(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_complete(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_set_client_password(uuid, uuid, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_send_client_reset_link(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_password_log_for(uuid, uuid, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_password_problem(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_email_list(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_email_hint(text) TO anon, authenticated, service_role;

-- ── Schedule: the sweep runs whatever the traffic ──────────────────────────
-- Every 5 minutes (3, 8, 13 ... past the hour, off the other jobs' minutes).
-- Without pg_cron (a plain local Postgres) it is only reported.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'client-password-reset-sweep') THEN
    PERFORM cron.unschedule('client-password-reset-sweep');
  END IF;
  PERFORM cron.schedule('client-password-reset-sweep', '3-59/5 * * * *',
                        $cmd$select public.client_password_reset_tick()$cmd$);
EXCEPTION WHEN undefined_table OR invalid_schema_name OR undefined_function THEN
  RAISE WARNING 'pg_cron is not available: schedule client-password-reset-sweep (select public.client_password_reset_tick(), every 5 minutes) by hand';
END $$;

COMMIT;
