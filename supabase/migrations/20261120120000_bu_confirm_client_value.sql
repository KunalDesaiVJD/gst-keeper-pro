-- BU agreement confirmation: the client's own figure, and the firm's approval of it
-- (the firm, 20 Nov 2026: Sweni's client disputed 21 units and typed its own values;
-- the firm must be able to approve the client's figures).
--
-- 1. A dispute on the confirmation page carries the value the client says is right
--    (client_value), entered as a number; the note is optional once a value is given.
-- 2. builder_bu_adopt_client_value: a GST Manager, the superadmin or a holder of
--    override_bu_agreement approves a disputed unit's value (the client's, or one the
--    firm typed after speaking to the client) while the event is PREPARED. The row
--    becomes OVERRIDDEN with adopted_value, which the BU working then uses
--    (deed value > adopted value > opening snapshot > classification).
-- 3. Accept without confirmation (builder_bu_agreement_override) keeps the working's
--    own value: it clears any adopted value.
-- 4. Asking about the unit again (PENDING / NOT_SENT) clears both values.
-- 5. Both functions refuse a person with no level (a missing user_roles row made
--    the role check NULL, which let the call through).

ALTER TABLE public.builder_bu_agreement_confirmations
  ADD COLUMN IF NOT EXISTS client_value  numeric(14,2),
  ADD COLUMN IF NOT EXISTS adopted_value numeric(14,2),
  ADD COLUMN IF NOT EXISTS adopted_by    uuid,
  ADD COLUMN IF NOT EXISTS adopted_at    timestamptz;

DO $$ BEGIN
  ALTER TABLE public.builder_bu_agreement_confirmations
    ADD CONSTRAINT builder_bu_confirm_client_value_ok CHECK (client_value IS NULL OR (client_value > 0 AND client_value < 100000000000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.builder_bu_agreement_confirmations
    ADD CONSTRAINT builder_bu_confirm_adopted_value_ok CHECK (
      adopted_value IS NULL OR (adopted_value > 0 AND adopted_value < 100000000000 AND status = 'OVERRIDDEN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Asking again clears the client's figure and any approval of it.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_values_tidy()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status IN ('PENDING', 'NOT_SENT') THEN
    NEW.client_value := NULL;
  END IF;
  IF NEW.status <> 'OVERRIDDEN' THEN
    NEW.adopted_value := NULL;
    NEW.adopted_by := NULL;
    NEW.adopted_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_builder_bu_confirm_values_tidy ON public.builder_bu_agreement_confirmations;
CREATE TRIGGER trg_builder_bu_confirm_values_tidy
  BEFORE INSERT OR UPDATE ON public.builder_bu_agreement_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.builder_bu_confirm_values_tidy();

-- 1. The confirmation page shows the client's figure back.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_unit_json(c builder_bu_agreement_confirmations, p_req_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'unit_id', c.unit_id,
    'unit_no', u.unit_no,
    'agreement_value', c.agreement_value_at_request,
    'state', s.state,
    'responded_by_name',  CASE WHEN s.state IN ('CONFIRMED', 'DISPUTED') THEN c.responded_by_name END,
    'responded_by_email', CASE WHEN s.state IN ('CONFIRMED', 'DISPUTED') THEN public.builder_bu_confirm_mask(c.responded_by_email) END,
    'responded_at',       CASE WHEN s.state IN ('CONFIRMED', 'DISPUTED') THEN c.responded_at END,
    'dispute_notes',      CASE WHEN s.state = 'DISPUTED' THEN c.dispute_notes END,
    'client_value',       CASE WHEN s.state = 'DISPUTED' THEN c.client_value END)
  FROM public.builder_units u,
       LATERAL (SELECT public.builder_bu_confirm_state(c, p_req_id) AS state) s
  WHERE u.id = c.unit_id;
$function$;

-- 1. A dispute carries the client's value ("value" in each answer).
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_respond(_token text, _answers jsonb, _name text, _email text, _proof text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name    text := btrim(regexp_replace(COALESCE(_name, ''), '[[:space:]]+', ' ', 'g'));
  v_email   text := lower(btrim(COALESCE(_email, '')));
  l         record;
  a         jsonb;
  v_unit    uuid;
  v_action  text;
  v_notes   text;
  v_value   numeric;
  v_row     public.builder_bu_agreement_confirmations;
  v_state   text;
  v_unit_no text;
  v_result  text;
  v_ip      text := public.builder_bu_confirm_request_ip();
  v_out     jsonb := '[]'::jsonb;
BEGIN
  IF length(v_name) < 2 OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'Please give your name.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.builder_bu_confirm_email_ok(v_email) THEN
    RAISE EXCEPTION 'Please give a valid e-mail address.' USING ERRCODE = 'check_violation';
  END IF;
  IF _answers IS NULL OR jsonb_typeof(_answers) <> 'array' OR jsonb_array_length(_answers) = 0 THEN
    RAISE EXCEPTION 'Nothing to record.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO l FROM public.builder_bu_confirm_link(_token);
  IF l.o_event IS NULL THEN
    RAISE EXCEPTION 'This link is not valid.' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM public.builder_bu_confirm_check_answerer(l.o_allowed, v_email);
  IF NOT EXISTS (SELECT 1 FROM public.builder_bu_confirm_codes k
                  WHERE (k.request_id = l.o_req OR k.confirmation_id = l.o_cf) AND k.email = v_email
                    AND k.proof_hash = encode(extensions.digest(btrim(COALESCE(_proof, '')), 'sha256'), 'hex')
                    AND k.verified_at > now() - interval '2 hours') THEN
    RAISE EXCEPTION 'Please check your e-mail address with the code we send to it, then answer.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Check every answer before recording any.
  FOR a IN SELECT value FROM jsonb_array_elements(_answers) LOOP
    BEGIN
      v_unit := (a ->> 'unit_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'That unit is not in this request.' USING ERRCODE = 'check_violation';
    END;
    IF v_unit IS NULL OR NOT (v_unit = ANY (l.o_units)) THEN
      RAISE EXCEPTION 'That unit is not in this request.' USING ERRCODE = 'check_violation';
    END IF;
    v_action := upper(COALESCE(a ->> 'action', ''));
    IF v_action NOT IN ('CONFIRM', 'DISPUTE') THEN
      RAISE EXCEPTION 'Invalid action' USING ERRCODE = 'check_violation';
    END IF;
    v_notes := btrim(COALESCE(a ->> 'notes', ''));
    BEGIN
      v_value := NULLIF(btrim(COALESCE(a ->> 'value', '')), '')::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Please give the value as a number.' USING ERRCODE = 'check_violation';
    END;
    SELECT unit_no INTO v_unit_no FROM public.builder_units WHERE id = v_unit;
    IF v_value IS NOT NULL AND (v_value <= 0 OR v_value >= 100000000000) THEN
      RAISE EXCEPTION 'Please give a correct value for unit %.', v_unit_no USING ERRCODE = 'check_violation';
    END IF;
    IF v_action = 'DISPUTE' AND v_notes = '' AND v_value IS NULL THEN
      RAISE EXCEPTION 'Please give the correct value for unit %.', v_unit_no USING ERRCODE = 'check_violation';
    END IF;
    IF length(v_notes) > 2000 THEN
      RAISE EXCEPTION 'Please keep the note under 2000 characters.' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- The rows answered, locked in the order a send locks them.
  PERFORM 1 FROM public.builder_bu_agreement_confirmations
   WHERE bu_event_id = l.o_event
     AND unit_id IN (SELECT (x ->> 'unit_id')::uuid FROM jsonb_array_elements(_answers) x)
   ORDER BY unit_id
     FOR UPDATE;

  -- The answers pass the guard of section 6b.
  PERFORM set_config('app.bu_confirm_write', 'on', true);
  FOR a IN SELECT value FROM jsonb_array_elements(_answers) LOOP
    v_unit := (a ->> 'unit_id')::uuid;
    v_action := upper(a ->> 'action');
    v_notes := NULLIF(btrim(COALESCE(a ->> 'notes', '')), '');
    v_value := round(NULLIF(btrim(COALESCE(a ->> 'value', '')), '')::numeric, 2);

    SELECT * INTO v_row FROM public.builder_bu_agreement_confirmations c
     WHERE c.bu_event_id = l.o_event AND c.unit_id = v_unit;
    IF NOT FOUND OR (l.o_req IS NULL AND v_row.id IS DISTINCT FROM l.o_cf) THEN
      v_result := 'REPLACED';
    ELSE
      v_state := public.builder_bu_confirm_state(v_row, l.o_req);
      IF v_state = 'PENDING' THEN
        UPDATE public.builder_bu_agreement_confirmations c
           SET status = CASE WHEN v_action = 'CONFIRM' THEN 'CONFIRMED' ELSE 'DISPUTED' END,
               responded_at = now(),
               responded_by_name = v_name,
               responded_by_email = v_email,
               response_ip = v_ip,
               dispute_notes = CASE WHEN v_action = 'DISPUTE'
                                    THEN COALESCE(v_notes, 'Correct value: Rs. ' || to_char(v_value, 'FM99999999999990.00'))
                                    ELSE NULL END,
               client_value = CASE WHEN v_action = 'DISPUTE' THEN v_value ELSE NULL END
         WHERE c.id = v_row.id
        RETURNING * INTO v_row;
        v_result := v_row.status;
      ELSIF v_state IN ('REPLACED', 'NOT_SENT') THEN
        v_result := 'REPLACED';
      ELSE
        v_result := 'ALREADY_' || v_state;
      END IF;
    END IF;
    SELECT unit_no INTO v_unit_no FROM public.builder_units WHERE id = v_unit;
    v_out := v_out || jsonb_build_object('unit_id', v_unit, 'unit_no', v_unit_no, 'result', v_result);
  END LOOP;
  PERFORM set_config('app.bu_confirm_write', 'off', true);

  RETURN v_out;
END;
$function$;

-- 3. Accept without confirmation keeps the working's own value.
CREATE OR REPLACE FUNCTION public.builder_bu_agreement_override(p_bu_event_id uuid, p_unit_id uuid, p_actor_id uuid, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role   text;
  v_client uuid;
  v_value  numeric;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = p_actor_id LIMIT 1;
  v_role := COALESCE(v_role, '');   -- no level at all is refused, never let through by a NULL
  IF NOT (v_role IN ('superadmin', 'gst_manager')
          OR (v_role = 'employee' AND EXISTS (
                SELECT 1 FROM public.user_permissions
                 WHERE user_id = p_actor_id AND permission_key = 'override_bu_agreement'))) THEN
    RAISE EXCEPTION 'You are not allowed to accept an agreement value without the client''s confirmation.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_role <> 'superadmin' AND (v_reason IS NULL OR length(v_reason) < 10) THEN
    RAISE EXCEPTION 'Give a reason (at least 10 characters) for accepting the agreement value without the client''s confirmation.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT p.client_id, eu.agreement_value INTO v_client, v_value
    FROM public.builder_bu_event_units eu
    JOIN public.builder_bu_events ev ON ev.id = eu.bu_event_id
    JOIN public.builder_projects p ON p.id = ev.project_id
   WHERE eu.bu_event_id = p_bu_event_id AND eu.unit_id = p_unit_id
   LIMIT 1;
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'That unit is not in this BU event.' USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM set_config('app.bu_confirm_write', 'on', true);
  INSERT INTO public.builder_bu_agreement_confirmations AS c
    (bu_event_id, unit_id, client_id, agreement_value_at_request, status,
     overridden_by, overridden_at, override_reason, created_by)
  VALUES (p_bu_event_id, p_unit_id, v_client, COALESCE(v_value, 0), 'OVERRIDDEN',
          p_actor_id, now(), COALESCE(v_reason, 'Accepted by the superadmin'), p_actor_id)
  ON CONFLICT (bu_event_id, unit_id) DO UPDATE
    SET status = 'OVERRIDDEN',
        overridden_by = EXCLUDED.overridden_by,
        overridden_at = EXCLUDED.overridden_at,
        override_reason = EXCLUDED.override_reason,
        adopted_value = NULL, adopted_by = NULL, adopted_at = NULL
    WHERE c.status <> 'CONFIRMED';   -- a client's own confirmation is never replaced
  PERFORM set_config('app.bu_confirm_write', 'off', true);

  RETURN (SELECT status FROM public.builder_bu_agreement_confirmations
           WHERE bu_event_id = p_bu_event_id AND unit_id = p_unit_id);
END;
$function$;

-- 2. Approve the client's value (or the value agreed with the client) for a disputed unit.
CREATE OR REPLACE FUNCTION public.builder_bu_adopt_client_value(
  p_bu_event_id uuid, p_unit_id uuid, p_actor_id uuid, p_value numeric, p_reason text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role    text;
  v_status  text;
  v_unit_no text;
  v_row     public.builder_bu_agreement_confirmations;
  v_value   numeric := round(p_value, 2);
  v_reason  text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = p_actor_id LIMIT 1;
  v_role := COALESCE(v_role, '');   -- no level at all is refused, never let through by a NULL
  IF NOT (v_role IN ('superadmin', 'gst_manager')
          OR (v_role = 'employee' AND EXISTS (
                SELECT 1 FROM public.user_permissions
                 WHERE user_id = p_actor_id AND permission_key = 'override_bu_agreement'))) THEN
    RAISE EXCEPTION 'You are not allowed to approve a client''s value.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT unit_no INTO v_unit_no FROM public.builder_units WHERE id = p_unit_id;
  IF v_value IS NULL OR v_value <= 0 OR v_value >= 100000000000 THEN
    RAISE EXCEPTION 'Give a correct value for unit %.', v_unit_no USING ERRCODE = 'check_violation';
  END IF;

  SELECT status INTO v_status FROM public.builder_bu_events WHERE id = p_bu_event_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'That BU event is gone.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'PREPARED' THEN
    RAISE EXCEPTION 'The BU event is posted. Unpost it before approving a value for unit %.', v_unit_no
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_row FROM public.builder_bu_agreement_confirmations
   WHERE bu_event_id = p_bu_event_id AND unit_id = p_unit_id FOR UPDATE;
  IF NOT FOUND OR NOT (v_row.status = 'DISPUTED' OR (v_row.status = 'OVERRIDDEN' AND v_row.adopted_value IS NOT NULL)) THEN
    RAISE EXCEPTION 'Unit % has no disputed value to approve (it is %).', v_unit_no, COALESCE(v_row.status, 'not asked')
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('app.bu_confirm_write', 'on', true);
  UPDATE public.builder_bu_agreement_confirmations
     SET status = 'OVERRIDDEN',
         adopted_value = v_value,
         adopted_by = p_actor_id,
         adopted_at = now(),
         overridden_by = p_actor_id,
         overridden_at = now(),
         override_reason = COALESCE(v_reason,
           CASE WHEN client_value = v_value THEN 'Client''s value approved'
                ELSE 'Value approved after the client''s dispute' END)
   WHERE id = v_row.id
  RETURNING * INTO v_row;
  PERFORM set_config('app.bu_confirm_write', 'off', true);

  RETURN jsonb_build_object('unit_id', p_unit_id, 'unit_no', v_unit_no, 'status', v_row.status,
                            'adopted_value', v_row.adopted_value, 'working_value', v_row.agreement_value_at_request);
END;
$function$;

REVOKE ALL ON FUNCTION public.builder_bu_adopt_client_value(uuid, uuid, uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.builder_bu_adopt_client_value(uuid, uuid, uuid, numeric, text) TO anon, authenticated, service_role;

-- The change log reads the new columns too.
SELECT public.gst_change_log_attach('builder_bu_agreement_confirmations', p_month => 'NULL', p_private => '{token}');
