-- Test helpers, created after the migrations (they call the new functions).

-- The statuses of some units of an event as the BU Events pop-up reads them:
-- { "<unit_id>": { "status", "responded_at" } } (NOT_SENT for a unit with no row).
CREATE FUNCTION public.t_seen(p_units uuid[], p_event uuid DEFAULT 'e1000000-0000-0000-0000-000000000001')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_object_agg(x::text, jsonb_build_object('status', COALESCE(c.status, 'NOT_SENT'),
                                                                'responded_at', c.responded_at)), '{}'::jsonb)
    FROM unnest(p_units) x
    LEFT JOIN public.builder_bu_agreement_confirmations c ON c.bu_event_id = p_event AND c.unit_id = x;
$$;

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
-- (as anon): the proof the page then sends with each answer.
CREATE FUNCTION public.t_proof(p_token text, p_email text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  v := public.builder_bu_confirm_code_verify(p_token, p_email,
         public.t_mailbox((public.builder_bu_confirm_code_request(p_token, p_email) ->> 'code_id')::uuid));
  IF NOT COALESCE((v ->> 'ok')::boolean, false) THEN
    RAISE EXCEPTION 'code refused: %', v ->> 'message';
  END IF;
  RETURN v ->> 'proof';
END $$;

-- Answer as the page does: the reader proves their address once (the proof
-- is kept for later answers on the same link), then answers.
CREATE TABLE public.t_proofs (token text, email text, proof text, PRIMARY KEY (token, email));
GRANT ALL ON public.t_proofs TO anon;
CREATE FUNCTION public.t_respond(p_token text, p_answers jsonb, p_name text, p_email text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_proof text;
BEGIN
  SELECT proof INTO v_proof FROM public.t_proofs WHERE token = p_token AND email = lower(btrim(p_email));
  IF v_proof IS NULL THEN
    v_proof := public.t_proof(p_token, p_email);
    INSERT INTO public.t_proofs VALUES (p_token, lower(btrim(p_email)), v_proof);
  END IF;
  RETURN public.builder_bu_confirm_respond(p_token, p_answers, p_name, p_email, v_proof);
END $$;
