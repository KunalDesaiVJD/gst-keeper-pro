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
--    no link still open) files one pending password_reset_requests row for
--    staff. Its note never names the e-mail address or the reason.
--  * client_password_log (who changed a password, how) is private too; staff
--    read it through client_password_log_for. It shows e-mail addresses only
--    masked.
--  * staff_set_client_password: any staff level (superadmin, GST Manager, any
--    employee, no permission key needed); logged; voids open links.
--  * Locks: whatever changes a client's links takes that client's advisory
--    lock first; the sweep only tries it, so it never waits.
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
  'queued: a link queued. no_email: no usable address, staff asked. rate_limited: refused, a recent link is still open (or, with no client, the address limit). staff_request: refused by a limit, staff asked instead. no_client, invalid.';
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
  action     text NOT NULL CHECK (action IN ('staff_reset', 'link_queued', 'link_sent', 'link_failed', 'link_used', 'fallback_request')),
  actor_id   uuid,
  actor_name text,
  detail     text
);
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
  PERFORM pg_advisory_xact_lock(hashtextextended('client_password_reset:' || p_client_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.password_reset_requests q
              WHERE q.user_id = p_client_id AND q.status = 'pending') THEN
    RETURN false;
  END IF;
  SELECT c.name, c.gstin INTO v_name, v_gstin FROM public.clients c WHERE c.id = p_client_id;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.password_reset_requests (user_id, requested_by_name, status, note)
  VALUES (p_client_id, v_name || ' (' || v_gstin || ')', 'pending',
          'Asked for a reset link; none went out. Edit Client shows why.');
  INSERT INTO public.client_password_log (client_id, action, detail)
  VALUES (p_client_id, 'fallback_request', btrim(COALESCE(p_why, '') || ' A request is waiting on the Dashboard.'));
  RETURN true;
END;
$$;

-- Is a link still on its way to the client, or in their mailbox and good?
-- (Waiting to be claimed within the hour, being sent for under 15 minutes,
-- or sent and not expired; never used, voided or failed.)
CREATE OR REPLACE FUNCTION public.client_password_has_open_link(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_password_resets r
     WHERE r.client_id = p_client_id
       AND r.used_at IS NULL AND r.voided_at IS NULL AND r.send_error IS NULL
       AND (   (r.claimed_at IS NULL AND r.created_at > now() - interval '60 minutes')
            OR (r.sent_at IS NULL AND r.claimed_at > now() - interval '15 minutes')
            OR (r.sent_at IS NOT NULL AND r.expires_at > now())))
$$;

-- Links that will never arrive: never claimed within the hour (the mailer did
-- not run), or claimed but not reported sent within 15 minutes (the mailer
-- stopped half way). Each is voided and staff are asked instead. Run by the
-- claim and after every request.
CREATE OR REPLACE FUNCTION public.client_password_reset_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT x.id, x.client_id, x.claimed_at IS NULL AS unclaimed, x.email_hint
      FROM public.client_password_resets x
     WHERE x.used_at IS NULL AND x.voided_at IS NULL AND x.sent_at IS NULL AND x.send_error IS NULL
       AND (   (x.claimed_at IS NULL AND x.created_at <= now() - interval '60 minutes')
            OR (x.claimed_at <= now() - interval '15 minutes'))
     ORDER BY x.created_at
     LIMIT 200
  LOOP
    -- Someone else is working on this client right now: the next sweep.
    CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('client_password_reset:' || r.client_id::text, 0));
    UPDATE public.client_password_resets x
       SET voided_at = now(),
           void_reason = CASE WHEN r.unclaimed THEN 'not sent in time' ELSE 'claimed but not sent' END
     WHERE x.id = r.id AND x.used_at IS NULL AND x.voided_at IS NULL AND x.sent_at IS NULL AND x.send_error IS NULL;
    CONTINUE WHEN NOT FOUND;
    n := n + 1;
    INSERT INTO public.client_password_log (client_id, action, detail)
    VALUES (r.client_id, 'link_failed',
            CASE WHEN r.unclaimed
                 THEN 'The reset link for ' || COALESCE(r.email_hint, 'the client') || ' was not sent within the hour, so it was given up.'
                 ELSE 'The mailer stopped before the reset link for ' || COALESCE(r.email_hint, 'the client') || ' was sent, so it was voided.'
            END);
    PERFORM public.client_password_staff_request(r.client_id, 'The reset link did not go out.');
  END LOOP;
  RETURN n;
END;
$$;

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
  -- One request per client at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('client_password_reset:' || p_client_id::text, 0));
  SELECT c.email INTO v_email FROM public.clients c WHERE c.id = p_client_id;
  IF NOT FOUND THEN RETURN 'no_client'; END IF;

  -- Per address: refused, so staff are asked instead.
  IF p_address_limited THEN
    PERFORM public.client_password_staff_request(p_client_id,
      'Asked for a reset link, but too many requests came from the same address this hour.');
    RETURN 'staff_request';
  END IF;

  -- Per client: one link a minute, three of its own an hour, five an hour in
  -- all (staff links too). A link from a moment ago is still open, so nothing
  -- more is needed; if none is, staff are asked.
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

  -- All clients: 300 links an hour (the firm has about 130 clients).
  IF (SELECT count(*) FROM public.client_password_resets r WHERE r.created_at > now() - interval '1 hour') >= 300 THEN
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
  v_id    uuid;
  v_token text;
BEGIN
  -- Links that will never arrive are voided and staff asked instead.
  PERFORM public.client_password_reset_sweep();

  FOR v_id IN
    SELECT r.id FROM public.client_password_resets r
     WHERE r.claimed_at IS NULL AND r.voided_at IS NULL AND r.used_at IS NULL
       AND r.created_at > now() - interval '60 minutes'
     ORDER BY r.created_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50))
     FOR UPDATE SKIP LOCKED
  LOOP
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
CREATE OR REPLACE FUNCTION public.client_password_reset_mark(p_reset_id uuid, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v record; v_cid uuid; v_hint text;
BEGIN
  SELECT r.client_id INTO v_cid FROM public.client_password_resets r WHERE r.id = p_reset_id;
  IF v_cid IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('client_password_reset:' || v_cid::text, 0));
  SELECT r.id, r.client_id, r.email_hint, r.requested_by, r.requested_by_name, r.via, r.used_at,
         r.voided_at, r.void_reason
    INTO v
    FROM public.client_password_resets r
   WHERE r.id = p_reset_id
   FOR UPDATE;
  v_hint := COALESCE(v.email_hint, 'the client');

  IF p_error IS NULL THEN
    UPDATE public.client_password_resets SET sent_at = now(), send_error = NULL WHERE id = p_reset_id;
    INSERT INTO public.client_password_log (client_id, action, actor_id, actor_name, detail)
    VALUES (v.client_id, 'link_sent', v.requested_by, v.requested_by_name,
            'Reset link e-mailed to ' || v_hint || '.'
            || CASE WHEN v.used_at IS NULL AND v.voided_at IS NOT NULL
                    THEN ' It was already void (' || COALESCE(v.void_reason, 'voided') || '), so it does not work.'
                    ELSE '' END);
    RETURN;
  END IF;

  UPDATE public.client_password_resets
     SET send_error = left(p_error, 500),
         voided_at = COALESCE(voided_at, now()),
         void_reason = COALESCE(void_reason, 'the e-mail could not be sent')
   WHERE id = p_reset_id AND used_at IS NULL;
  INSERT INTO public.client_password_log (client_id, action, actor_id, actor_name, detail)
  VALUES (v.client_id, 'link_failed', v.requested_by, v.requested_by_name,
          'The reset link could not be e-mailed to ' || v_hint || ': ' || left(p_error, 300));
  PERFORM public.client_password_staff_request(v.client_id, 'The e-mail with the reset link could not be sent.');
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
  SELECT r.expires_at, c.name, c.gstin INTO v
    FROM public.client_password_resets r
    JOIN public.clients c ON c.id = r.client_id
   WHERE r.token_hash = encode(digest(btrim(p_token), 'sha256'), 'hex')
     AND r.used_at IS NULL AND r.voided_at IS NULL AND r.expires_at > now();
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
  v_problem text;
BEGIN
  IF p_token IS NOT NULL AND btrim(p_token) ~ '^[0-9a-f]{64}$' THEN
    SELECT r.client_id INTO v_cid
      FROM public.client_password_resets r
     WHERE r.token_hash = encode(digest(btrim(p_token), 'sha256'), 'hex');
  END IF;
  IF v_cid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('client_password_reset:' || v_cid::text, 0));
    SELECT r.id, r.used_at, r.voided_at, r.expires_at, c.gstin
      INTO v_id, v_used, v_voided, v_expires, v_gstin
      FROM public.client_password_resets r
      JOIN public.clients c ON c.id = r.client_id
     WHERE r.token_hash = encode(digest(btrim(p_token), 'sha256'), 'hex')
     FOR UPDATE OF r;
  END IF;
  IF v_id IS NULL OR v_used IS NOT NULL OR v_voided IS NOT NULL OR v_expires IS NULL OR v_expires <= now() THEN
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
-- The same per-client limits bind every link, whoever asked: one a minute,
-- five an hour per client (staff and self together), 300 an hour in all.
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
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = p_actor_id AND ur.role::text IN ('superadmin', 'gst_manager', 'employee')) THEN
    RAISE EXCEPTION 'Only a staff member can send a client a reset link.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT c.id, c.email INTO v_cid, v_email FROM public.clients c WHERE c.id = p_client_id;
  IF v_cid IS NULL THEN
    RAISE EXCEPTION 'Client not found.' USING ERRCODE = 'no_data_found';
  END IF;
  v_emails := public.client_email_list(v_email);
  IF cardinality(v_emails) = 0 THEN
    RAISE EXCEPTION 'This client has no e-mail address on record. Add one in Edit Client, or set a password instead.'
      USING ERRCODE = 'check_violation';
  END IF;
  v_to := array_to_string(v_emails, ', ');
  v_hint := public.client_email_hint(v_to);

  PERFORM pg_advisory_xact_lock(hashtextextended('client_password_reset:' || v_cid::text, 0));
  IF EXISTS (SELECT 1 FROM public.client_password_resets r
              WHERE r.client_id = v_cid AND r.created_at > now() - interval '60 seconds') THEN
    RAISE EXCEPTION 'A reset link went to this client less than a minute ago.' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM public.client_password_resets r
       WHERE r.client_id = v_cid AND r.created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Five reset links went to this client in the last hour. Set a password instead.' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM public.client_password_resets r WHERE r.created_at > now() - interval '1 hour') >= 300 THEN
    RAISE EXCEPTION 'Too many reset links went out in the last hour. Set a password instead.' USING ERRCODE = 'check_violation';
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
REVOKE EXECUTE ON FUNCTION public.client_password_reset_for_client(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_staff_request(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_has_open_link(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_request_ip() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_ip_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_password_reset_claim(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_mark(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_ping() TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_sweep() TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_for_client(uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_staff_request(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_has_open_link(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_request_ip() TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_ip_key(text) TO service_role;

GRANT EXECUTE ON FUNCTION public.client_password_reset_request(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_check(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_complete(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_set_client_password(uuid, uuid, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_send_client_reset_link(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_password_log_for(uuid, uuid, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_password_problem(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_email_list(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_email_hint(text) TO anon, authenticated, service_role;

COMMIT;
