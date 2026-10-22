-- Test helpers, created after the migrations (they call the new functions).

-- The statuses of some units of an event as the BU Events pop-up reads them:
-- { "<unit_id>": { "status", "responded_at" } } (NOT_SENT for a unit with no row),
-- and the unit's request with p_request (as the pop-up sends it since round 3;
-- without it, as an older page did).
CREATE FUNCTION public.t_seen(p_units uuid[], p_event uuid DEFAULT 'e1000000-0000-0000-0000-000000000001',
                               p_request boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_object_agg(x::text, jsonb_build_object('status', COALESCE(c.status, 'NOT_SENT'),
                                                                'responded_at', c.responded_at)
                                            || CASE WHEN p_request THEN jsonb_build_object('request_id', c.request_id)
                                                    ELSE '{}'::jsonb END), '{}'::jsonb)
    FROM unnest(p_units) x
    LEFT JOIN public.builder_bu_agreement_confirmations c ON c.bu_event_id = p_event AND c.unit_id = x;
$$;

-- What the app wrote straight into builder_bu_agreement_confirmations before
-- 20261021140000 (the per-unit e-mails, their rows and outbox links), which
-- the guard now refuses: fixtures only. Runs the statement as the owner with
-- the confirmation functions' flag, then clears it.
CREATE FUNCTION public.t_old_app(p_sql text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  PERFORM set_config('app.bu_confirm_write', 'on', true);
  EXECUTE p_sql;
  PERFORM set_config('app.bu_confirm_write', 'off', true);
END $$;
GRANT EXECUTE ON FUNCTION public.t_old_app(text) TO anon;

-- What 20261021140000 does once, when it is applied (section 6c): each row a
-- per-unit e-mail of the old app made records the addresses that e-mail went
-- to. Fixtures call it after writing the old app's rows, as if the change were
-- applied after them (the function itself is not callable by the public key).
CREATE FUNCTION public.t_legacy_snapshot() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  RETURN public.builder_bu_confirm_legacy_snapshot();
END $$;
GRANT EXECUTE ON FUNCTION public.t_legacy_snapshot() TO anon;

-- Send a request for event e1…01 the way the BU Events dialog does: the
-- template filled in with {{confirm_link}} left for the function, and the
-- statuses the pop-up showed (by default, as they are now: a pop-up opened
-- just before Send).
CREATE FUNCTION public.t_send(p_units uuid[], p_to text[], p_cc text[],
                               p_actor uuid DEFAULT '10000000-0000-0000-0000-000000000001',
                               p_event uuid DEFAULT 'e1000000-0000-0000-0000-000000000001',
                               p_seen jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.builder_bu_confirm_request_send(
    p_event, p_units, p_to, p_cc, p_actor, 'https://gst.vjdesai.com/',
    'Please confirm the agreement values · Test Heights | Shree Test Infra',
    E'Our working uses these agreement values (3 units):\n\nUnit A-101: Rs. 45,00,000.00\n\n{{confirm_link}}\n\nAnyone who received this e-mail may answer.',
    '{"project_name": "Test Heights", "confirm_link": "{{confirm_link}}"}'::jsonb,
    COALESCE(p_seen, public.t_seen(p_units, p_event)));
$$;

-- The page's view of a link: "A-101:PENDING,A-102:CONFIRMED,…".
CREATE FUNCTION public.t_states(p_token text) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg((u ->> 'unit_no') || ':' || (u ->> 'state'), ',' ORDER BY ord)
    FROM jsonb_array_elements(public.builder_bu_confirm_lookup(p_token) -> 'units') WITH ORDINALITY t(u, ord);
$$;
-- One answer as the page sends it.
CREATE FUNCTION public.t_answer(p_unit uuid, p_action text, p_notes text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql AS $$ SELECT jsonb_build_object('unit_id', p_unit, 'action', p_action, 'notes', p_notes) $$;
-- The results of a respond call: "A-101:CONFIRMED,…".
CREATE FUNCTION public.t_results(p jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg((r ->> 'unit_no') || ':' || (r ->> 'result'), ',' ORDER BY ord)
    FROM jsonb_array_elements(p) WITH ORDINALITY t(r, ord);
$$;

-- What the Edge Function bu-confirm-code does with the service role: claim
-- the code (the only moment its digits exist), "e-mail" it, report it sent.
-- Here it hands the digits back, standing in for the reader's mailbox.
-- SECURITY DEFINER: the caller stays anon, which may not claim.
CREATE FUNCTION public.t_mailbox(p_code_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text;
BEGIN
  SELECT code INTO v_code FROM public.builder_bu_confirm_code_claim(p_code_id);
  PERFORM public.builder_bu_confirm_code_mark(p_code_id, NULL);
  RETURN v_code;
END $$;
GRANT EXECUTE ON FUNCTION public.t_mailbox(uuid) TO anon;

-- The reader asks for a code (as anon), reads it in their mailbox, types it
-- with the code_id the request gave the page (as anon): the proof the page
-- then sends with each answer.
CREATE FUNCTION public.t_proof(p_token text, p_email text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v jsonb; v_id uuid;
BEGIN
  v_id := (public.builder_bu_confirm_code_request(p_token, p_email) ->> 'code_id')::uuid;
  v := public.builder_bu_confirm_code_verify(p_token, p_email, public.t_mailbox(v_id), v_id);
  IF NOT COALESCE((v ->> 'ok')::boolean, false) THEN
    RAISE EXCEPTION 'code refused: %', v ->> 'message';
  END IF;
  RETURN v ->> 'proof';
END $$;

-- A proof the reader got earlier, while a unit on the link was still open:
-- since 20261021160000 a link with nothing waiting takes no code request, so
-- a test that answers on such a link (to see REPLACED or ALREADY_...) stands
-- for a reader who checked their address before. Written as the owner (the
-- codes are private); the address is still checked by the respond call.
CREATE FUNCTION public.t_proof_earlier(p_token text, p_email text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE l record; v_proof text := encode(extensions.gen_random_bytes(32), 'hex');
BEGIN
  SELECT * INTO l FROM public.builder_bu_confirm_link(p_token);
  INSERT INTO public.builder_bu_confirm_codes (request_id, confirmation_id, email, created_at, claimed_at, sent_at,
                                               proof_hash, verified_at)
  VALUES (l.o_req, l.o_cf, lower(btrim(p_email)), now() - interval '20 minutes', now() - interval '20 minutes',
          now() - interval '20 minutes', encode(extensions.digest(v_proof, 'sha256'), 'hex'), now() - interval '10 minutes');
  RETURN v_proof;
END $$;
GRANT EXECUTE ON FUNCTION public.t_proof_earlier(text, text) TO anon;

-- Answer as the page does: the reader proves their address once (the proof
-- is kept for later answers on the same link), then answers. On a link with
-- nothing left to answer, the reader proved it earlier (t_proof_earlier).
CREATE TABLE public.t_proofs (token text, email text, proof text, PRIMARY KEY (token, email));
GRANT ALL ON public.t_proofs TO anon;
CREATE FUNCTION public.t_respond(p_token text, p_answers jsonb, p_name text, p_email text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_proof text;
BEGIN
  SELECT proof INTO v_proof FROM public.t_proofs WHERE token = p_token AND email = lower(btrim(p_email));
  IF v_proof IS NULL THEN
    BEGIN
      v_proof := public.t_proof(p_token, p_email);
    EXCEPTION WHEN check_violation THEN
      IF position('Nothing on this link is waiting' IN SQLERRM) = 0 THEN RAISE; END IF;
      v_proof := public.t_proof_earlier(p_token, p_email);
    END;
    INSERT INTO public.t_proofs VALUES (p_token, lower(btrim(p_email)), v_proof);
  END IF;
  RETURN public.builder_bu_confirm_respond(p_token, p_answers, p_name, p_email, v_proof);
END $$;
