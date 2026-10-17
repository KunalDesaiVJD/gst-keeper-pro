-- Client "Forgot password" by e-mail, and client password resets for every
-- staff member (17 Oct 2026, the firm's request). Positions:
-- docs/CLIENT_PASSWORD_RESET.md.
--
--  * A client asks from the login page (GSTIN or User ID). The answer is the
--    same whatever happened (no such client, no e-mail, too many requests,
--    queued), so the form cannot be used to test which GSTINs are clients.
--  * A queued link waits in client_password_resets, which nobody but the
--    service role can read: RLS on and NO policies, like portal_sessions. The
--    Edge Function client-password-reset claims it, which mints the token
--    (only its sha256 is stored), e-mails the link through Microsoft Graph and
--    marks it sent or failed. The link never goes through email_outbox,
--    whose rows anyone with the anon key can read.
--  * The link works once, for 60 minutes; a newer request voids it; using it
--    sets the password (bcrypt), voids every other open link and is logged.
--    Until it is used the current password keeps working.
--  * A client with no usable e-mail (or whose e-mail fails) gets the same
--    answer and one pending password_reset_requests row for staff.
--  * staff_set_client_password: any staff level (superadmin, GST Manager, any
--    employee, no permission key needed); logged; voids open links.
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
CREATE INDEX IF NOT EXISTS idx_client_password_resets_queue
  ON public.client_password_resets (created_at)
  WHERE claimed_at IS NULL AND voided_at IS NULL AND used_at IS NULL;

-- Every request from the login page, for the rate limits (private, 30 days).
CREATE TABLE IF NOT EXISTS public.client_password_reset_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at              timestamptz NOT NULL DEFAULT now(),
  ip              text,
  identifier_hash text,
  client_id       uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  outcome         text NOT NULL CHECK (outcome IN ('queued', 'no_client', 'no_email', 'rate_limited', 'invalid'))
);
CREATE INDEX IF NOT EXISTS idx_client_password_reset_attempts_at ON public.client_password_reset_attempts (at);
CREATE INDEX IF NOT EXISTS idx_client_password_reset_attempts_ip ON public.client_password_reset_attempts (ip, at) WHERE ip IS NOT NULL;

ALTER TABLE public.client_password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_password_reset_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_password_resets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.client_password_reset_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.client_password_resets TO service_role;
GRANT ALL ON public.client_password_reset_attempts TO service_role;

-- ── Who changed a client's password, and how (staff can read it) ───────────
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
CREATE POLICY "app read client_password_log" ON public.client_password_log
  FOR SELECT TO public USING (true);
-- Written only by the SECURITY DEFINER functions below.
REVOKE ALL ON public.client_password_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.client_password_log TO anon, authenticated;
GRANT ALL ON public.client_password_log TO service_role;

-- Requests filed for staff say why (no e-mail on record, e-mail failed).
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

-- ── 1. A client asks for a link (login page / client dashboard) ────────────
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
  v_hash   text;
  v_cid    uuid;
  v_cname  text;
  v_gstin  text;
  v_email  text;
  v_n      int;
  v_emails text[];
  v_to     text;
BEGIN
  DELETE FROM public.client_password_reset_attempts WHERE at < now() - interval '30 days';

  IF v_ident = '' OR length(v_ident) > 64 THEN
    INSERT INTO public.client_password_reset_attempts (ip, outcome) VALUES (v_ip, 'invalid');
    RETURN c_answer;
  END IF;
  v_hash := encode(digest(v_ident, 'sha256'), 'hex');

  -- Per address: 10 requests an hour, whatever they were for.
  IF v_ip IS NOT NULL AND (SELECT count(*) FROM public.client_password_reset_attempts a
                            WHERE a.ip = v_ip AND a.at > now() - interval '1 hour') >= 10 THEN
    INSERT INTO public.client_password_reset_attempts (ip, identifier_hash, outcome)
    VALUES (v_ip, v_hash, 'rate_limited');
    RETURN c_answer;
  END IF;

  -- The GSTIN, or a User ID that belongs to exactly one client.
  SELECT c.id, c.name, c.gstin, c.email INTO v_cid, v_cname, v_gstin, v_email
    FROM public.clients c WHERE upper(btrim(c.gstin)) = v_ident LIMIT 1;
  IF v_cid IS NULL THEN
    SELECT count(*) INTO v_n FROM public.clients c WHERE upper(btrim(c.client_user_id)) = v_ident;
    IF v_n = 1 THEN
      SELECT c.id, c.name, c.gstin, c.email INTO v_cid, v_cname, v_gstin, v_email
        FROM public.clients c WHERE upper(btrim(c.client_user_id)) = v_ident;
    END IF;
  END IF;
  IF v_cid IS NULL THEN
    INSERT INTO public.client_password_reset_attempts (ip, identifier_hash, outcome)
    VALUES (v_ip, v_hash, 'no_client');
    RETURN c_answer;
  END IF;

  -- One request per client at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('client_password_reset:' || v_cid::text, 0));

  -- Per client: one link a minute, three an hour; all clients: 60 an hour.
  IF EXISTS (SELECT 1 FROM public.client_password_resets r
              WHERE r.client_id = v_cid AND r.created_at > now() - interval '60 seconds')
     OR (SELECT count(*) FROM public.client_password_resets r
          WHERE r.client_id = v_cid AND r.via = 'self' AND r.created_at > now() - interval '1 hour') >= 3
     OR (SELECT count(*) FROM public.client_password_resets r
          WHERE r.via = 'self' AND r.created_at > now() - interval '1 hour') >= 60 THEN
    INSERT INTO public.client_password_reset_attempts (ip, identifier_hash, client_id, outcome)
    VALUES (v_ip, v_hash, v_cid, 'rate_limited');
    RETURN c_answer;
  END IF;

  v_emails := public.client_email_list(v_email);
  IF cardinality(v_emails) = 0 THEN
    -- Nowhere to send it: staff are asked instead (once).
    IF NOT EXISTS (SELECT 1 FROM public.password_reset_requests q
                    WHERE q.user_id = v_cid AND q.status = 'pending') THEN
      INSERT INTO public.password_reset_requests (user_id, requested_by_name, status, note)
      VALUES (v_cid, v_cname || ' (' || v_gstin || ')', 'pending',
              'Asked for a reset link; no e-mail address on record.');
      INSERT INTO public.client_password_log (client_id, action, detail)
      VALUES (v_cid, 'fallback_request', 'Asked for a reset link, but there is no e-mail address on record. A request is waiting on the Dashboard.');
    END IF;
    INSERT INTO public.client_password_reset_attempts (ip, identifier_hash, client_id, outcome)
    VALUES (v_ip, v_hash, v_cid, 'no_email');
    RETURN c_answer;
  END IF;
  v_to := array_to_string(v_emails, ', ');

  -- A new link replaces any earlier one still open.
  UPDATE public.client_password_resets r
     SET voided_at = now(), void_reason = 'a newer link was asked for'
   WHERE r.client_id = v_cid AND r.used_at IS NULL AND r.voided_at IS NULL;

  INSERT INTO public.client_password_resets (client_id, via, requested_ip, sent_to, email_hint)
  VALUES (v_cid, 'self', v_ip, v_to, public.client_email_hint(v_to));
  INSERT INTO public.client_password_reset_attempts (ip, identifier_hash, client_id, outcome)
  VALUES (v_ip, v_hash, v_cid, 'queued');
  INSERT INTO public.client_password_log (client_id, action, detail)
  VALUES (v_cid, 'link_queued', 'The client asked for a reset link, to ' || v_to || '.');

  PERFORM public.client_password_reset_ping();
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
  v_base  text;
  v_id    uuid;
  v_token text;
BEGIN
  -- A link not picked up within the hour is given up.
  UPDATE public.client_password_resets r
     SET voided_at = now(), void_reason = 'not sent in time'
   WHERE r.claimed_at IS NULL AND r.voided_at IS NULL AND r.used_at IS NULL
     AND r.created_at < now() - interval '60 minutes';

  IF to_regclass('public.notice_settings') IS NOT NULL THEN
    EXECUTE 'SELECT app_base_url FROM public.notice_settings LIMIT 1' INTO v_base;
  END IF;
  v_base := COALESCE(NULLIF(rtrim(btrim(v_base), '/'), ''), 'https://gst.vjdesai.com');

  FOR v_id IN
    SELECT r.id FROM public.client_password_resets r
     WHERE r.claimed_at IS NULL AND r.voided_at IS NULL AND r.used_at IS NULL
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
      SELECT r.id, v_token, v_base || '/reset-password#token=' || v_token, c.id, c.name, c.gstin,
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
DECLARE v record;
BEGIN
  SELECT r.id, r.client_id, r.sent_to, r.requested_by, r.requested_by_name, r.via, r.used_at,
         c.name, c.gstin
    INTO v
    FROM public.client_password_resets r
    JOIN public.clients c ON c.id = r.client_id
   WHERE r.id = p_reset_id
   FOR UPDATE OF r;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_error IS NULL THEN
    UPDATE public.client_password_resets SET sent_at = now(), send_error = NULL WHERE id = p_reset_id;
    INSERT INTO public.client_password_log (client_id, action, actor_id, actor_name, detail)
    VALUES (v.client_id, 'link_sent', v.requested_by, v.requested_by_name,
            'Reset link e-mailed to ' || v.sent_to || '.');
    RETURN;
  END IF;

  UPDATE public.client_password_resets
     SET send_error = left(p_error, 500),
         voided_at = COALESCE(voided_at, now()),
         void_reason = COALESCE(void_reason, 'the e-mail could not be sent')
   WHERE id = p_reset_id AND used_at IS NULL;
  INSERT INTO public.client_password_log (client_id, action, actor_id, actor_name, detail)
  VALUES (v.client_id, 'link_failed', v.requested_by, v.requested_by_name,
          'The reset link could not be e-mailed to ' || v.sent_to || ': ' || left(p_error, 300));
  IF NOT EXISTS (SELECT 1 FROM public.password_reset_requests q
                  WHERE q.user_id = v.client_id AND q.status = 'pending') THEN
    INSERT INTO public.password_reset_requests (user_id, requested_by_name, status, note)
    VALUES (v.client_id, v.name || ' (' || v.gstin || ')', 'pending',
            'Asked for a reset link; the e-mail to ' || v.sent_to || ' could not be sent.');
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
    SELECT r.id, r.client_id, r.used_at, r.voided_at, r.expires_at, c.gstin
      INTO v_id, v_cid, v_used, v_voided, v_expires, v_gstin
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

  PERFORM pg_advisory_xact_lock(hashtextextended('client_password_reset:' || v_cid::text, 0));
  IF EXISTS (SELECT 1 FROM public.client_password_resets r
              WHERE r.client_id = v_cid AND r.created_at > now() - interval '60 seconds') THEN
    RAISE EXCEPTION 'A reset link went to this client less than a minute ago.' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM public.client_password_resets r
       WHERE r.client_id = v_cid AND r.via = 'staff' AND r.created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Five reset links went to this client in the last hour. Set a password instead.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT p.first_name INTO v_name FROM public.profiles p WHERE p.user_id = p_actor_id LIMIT 1;
  UPDATE public.client_password_resets r
     SET voided_at = now(), void_reason = 'a newer link was asked for'
   WHERE r.client_id = v_cid AND r.used_at IS NULL AND r.voided_at IS NULL;
  INSERT INTO public.client_password_resets (client_id, via, requested_by, requested_by_name, sent_to, email_hint)
  VALUES (v_cid, 'staff', p_actor_id, v_name, v_to, public.client_email_hint(v_to));
  UPDATE public.password_reset_requests
     SET status = 'resolved', resolved_at = now(), resolved_by = p_actor_id
   WHERE user_id = v_cid AND status = 'pending';
  INSERT INTO public.client_password_log (client_id, action, actor_id, actor_name, detail)
  VALUES (v_cid, 'link_queued', p_actor_id, v_name, 'Reset link asked for by staff, to ' || v_to || '.');

  PERFORM public.client_password_reset_ping();
  RETURN jsonb_build_object('queued', true, 'sent_to', v_to);
END;
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC by default (and Supabase to anon and
-- authenticated): the mailer's two functions are taken back to the service role.
REVOKE EXECUTE ON FUNCTION public.client_password_reset_claim(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_reset_mark(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_reset_ping() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.client_password_request_ip() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_password_reset_claim(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_mark(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_ping() TO service_role;
GRANT EXECUTE ON FUNCTION public.client_password_request_ip() TO service_role;

GRANT EXECUTE ON FUNCTION public.client_password_reset_request(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_check(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_password_reset_complete(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_set_client_password(uuid, uuid, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_send_client_reset_link(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_password_problem(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_email_list(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_email_hint(text) TO anon, authenticated, service_role;

COMMIT;
