-- Client password reset links: no time limit, and a newer request no longer
-- cancels an earlier link (the firm, 18 Nov 2026; docs/CLIENT_PASSWORD_RESET.md).
--
-- Clients clicked an earlier e-mail after asking again and were told the link
-- had expired. Now a link works until it is used: using any one voids every
-- other open link, a changed e-mail address voids links sent to the old one,
-- and a staff reset of the password voids them, as before. Rate limits are
-- unchanged.
--
-- 1. client_password_reset_claim: expires_at = 'infinity' (was now() + 60 min).
-- 2. client_password_reset_for_client, staff_send_client_reset_link: no longer
--    void the client's open links when a new one is asked for.
-- 3. Links already sent and unused get no expiry; those voided only because a
--    newer link was asked for come back, unless the client has since used a
--    link or the address changed (the check refuses those anyway).
-- Undo: re-create the three functions from 20261020140000.

CREATE OR REPLACE FUNCTION public.client_password_reset_claim(p_limit integer DEFAULT 10)
 RETURNS TABLE(reset_id uuid, token text, link text, client_id uuid, client_name text, gstin text, to_email text, expires_at timestamp with time zone, via text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
           expires_at = 'infinity'::timestamptz
     WHERE r.id = v_id;
    RETURN QUERY
      SELECT r.id, v_token, c_base || '/reset-password#token=' || v_token, c.id, c.name, c.gstin,
             r.sent_to, r.expires_at, r.via
        FROM public.client_password_resets r
        JOIN public.clients c ON c.id = r.client_id
       WHERE r.id = v_id;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.client_password_reset_for_client(p_client_id uuid, p_ip text, p_address_limited boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_email  text;
  v_emails text[];
  v_to     text;
  v_hint   text;
BEGIN
  -- The limits lock (already held by client_password_reset_request, its only
  -- caller: re-entrant, so it never waits here), then one request per client
  -- at a time: the clients row, then the client's lock (see Locks above). The
  -- address is read under both, so an e-mail change saving right now is
  -- either seen here or voids this link when it commits.
  PERFORM public.client_password_reset_limits_lock();
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

  -- A new link no longer replaces an earlier one (18 Nov 2026): every link
  -- sent stays good until one of them is used, which voids the rest.

  INSERT INTO public.client_password_resets (client_id, via, requested_ip, sent_to, email_hint)
  VALUES (p_client_id, 'self', p_ip, v_to, v_hint);
  INSERT INTO public.client_password_log (client_id, action, detail)
  VALUES (p_client_id, 'link_queued', 'The client asked for a reset link, to ' || v_hint || '.');

  PERFORM public.client_password_reset_ping();
  RETURN 'queued';
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_send_client_reset_link(p_actor_id uuid, p_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  -- The limits lock, then the clients row, then the client's lock (see Locks
  -- above): the all-clients count below sees every link a request or another
  -- staff link in flight has just made.
  PERFORM public.client_password_reset_limits_lock();
  SELECT c.id INTO v_cid FROM public.clients c WHERE c.id = p_client_id FOR KEY SHARE;
  IF v_cid IS NULL THEN
    RAISE EXCEPTION 'Client not found.' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('client_password_reset:' || v_cid::text, 0));
  -- The address is read under both, so an e-mail change that is saving
  -- right now is either seen here or voids this link when it commits.
  SELECT c.email INTO v_email FROM public.clients c WHERE c.id = v_cid;
  v_emails := public.client_email_list(v_email);
  -- (Never "in Edit Client": not every staff member who can send a link can
  -- open it.)
  IF btrim(COALESCE(v_email, '')) = '' THEN
    RAISE EXCEPTION 'This client has no e-mail address on record. Set a password instead, or have an address added to the client.'
      USING ERRCODE = 'check_violation';
  ELSIF cardinality(v_emails) = 0 THEN
    RAISE EXCEPTION 'This client has no usable e-mail address on record. Set a password instead, or have the address corrected.'
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
  -- Earlier links stay good until one is used (18 Nov 2026).
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
$function$;

UPDATE public.client_password_resets r
   SET voided_at = NULL, void_reason = NULL
 WHERE r.void_reason = 'a newer link was asked for' AND r.used_at IS NULL AND r.sent_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.client_password_resets u
                    WHERE u.client_id = r.client_id AND u.used_at IS NOT NULL AND u.used_at > r.sent_at);
UPDATE public.client_password_resets
   SET expires_at = 'infinity'::timestamptz
 WHERE used_at IS NULL AND voided_at IS NULL AND sent_at IS NOT NULL;
