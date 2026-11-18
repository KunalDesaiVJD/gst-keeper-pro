-- Client password reset: no rate limits (the firm, 18 Nov 2026, urgent).
-- Removed: ten requests an hour per caller address, one link a minute / three
-- of its own / five in all an hour per client, and 300 links an hour over all
-- clients, in client_password_reset_request, client_password_reset_for_client
-- and staff_send_client_reset_link. Everything else is unchanged.
-- Undo: re-create the three functions from 20261020140000 (and 20261118100000).

CREATE OR REPLACE FUNCTION public.client_password_reset_request(p_identifier text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  -- Requests (and staff links) take turns, first thing and before any
  -- client's row or lock (see Locks above): the per-address count below and
  -- the all-clients count in client_password_reset_for_client read only
  -- committed rows, so two requests in flight at once would each count
  -- without the other and both get through. Held to commit, the next request
  -- counts this one's rows. Nothing else takes this lock.
  PERFORM public.client_password_reset_limits_lock();
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

  -- No limit per address (the firm, 18 Nov 2026).
  v_limited := false;

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

  -- No limit per client or for all clients (the firm, 18 Nov 2026).

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
  -- No limit per client or for all clients (the firm, 18 Nov 2026).

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
