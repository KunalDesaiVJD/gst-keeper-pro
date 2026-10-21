-- BU agreement value confirmation: one e-mail to several people, anyone who
-- got it may answer (the firm, 21 Oct 2026: "BU confirmation request can be
-- sent to multiple emails in CC if needed & anyone can provide confirmation
-- for the outstanding figures & the email can be typed directly on the button
-- pressed").
--
-- Until now "Send confirmation requests" queued one e-mail per unit, only to
-- clients.email, and failed when the client master had none. Now:
--
--   builder_bu_confirm_requests   one row per send: To and CC typed by staff
--                                 (several of each), the units asked about,
--                                 one token, one email_outbox row.
--   builder_bu_agreement_confirmations
--                                 still one row per unit, still the record the
--                                 posting gate reads. New: request_id (the
--                                 latest request that asked about the unit),
--                                 responded_by_name / responded_by_email (who
--                                 answered; the page asks for both).
--   builder_bu_confirm_request_send(...)
--                                 staff: creates the request, points each unit
--                                 at it (status PENDING, earlier answer
--                                 cleared) and queues the one e-mail. Refuses a
--                                 unit already confirmed or accepted.
--   builder_bu_confirm_lookup(token) / builder_bu_confirm_respond(...)
--                                 the public page (no login), scoped by the
--                                 token. A request's token reaches its units;
--                                 a per-unit token from an e-mail sent before
--                                 this change reaches its one unit, as before.
--
-- Positions (docs/BUILDER_GST_POSITIONS.md section 6):
--   * Only a PENDING unit takes an answer. A confirmed unit stays confirmed
--     ("a client's own confirmation is never replaced"); a disputed unit stays
--     disputed until staff send a new request for it.
--   * A new request for a unit replaces the earlier one for that unit: the
--     earlier link (request or per-unit) then shows "replaced by a newer
--     request" for it and takes no answer.
--   * The posting gate is unchanged: builder_bu_agreement_confirmation_blocked
--     is not touched; CONFIRMED or OVERRIDDEN clears a unit.
--
-- RLS: the new table is open to public like every app table (the app has no
-- Supabase auth session). The page's two functions are SECURITY DEFINER and
-- touch only what the token names. The send function checks the actor as the
-- BU Events page does (superadmin, GST Manager, or an employee holding
-- post_bu_event); the actor id is the browser's word, as for
-- builder_bu_agreement_override.
--
-- Re-runnable. Tests: supabase/tests/bu_confirm/run.sh (local PostgreSQL).
--
-- Live-apply steps (project gcquafqxbykxkbexcdpy only; never the project in
-- SUPABASE_PROJECT_REF):
--   1. Apply this file to gcquafqxbykxkbexcdpy (management API database query
--      or the SQL editor), before the app change is deployed: the new page and
--      the BU Events dialog call the new functions.
--   2. Check the objects exist: table builder_bu_confirm_requests; columns
--      request_id, responded_by_name, responded_by_email on
--      builder_bu_agreement_confirmations; functions
--      builder_bu_confirm_request_send, builder_bu_confirm_lookup,
--      builder_bu_confirm_respond; template row
--      builder_bu_agreement_confirm_request in email_templates.
--   3. With the anon key from .env: rpc builder_bu_confirm_lookup with a
--      made-up token returns null; select id from builder_bu_confirm_requests
--      returns [] (not an error).
--   4. No Edge Function redeploy: send-gst-email (v5) already sends to every
--      address in to_email and cc_email, comma or semicolon separated.
--   5. Deploy the app. Per-unit links already sent keep working.

BEGIN;

-- ── 1. Requests ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_bu_confirm_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token        text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  bu_event_id  uuid NOT NULL REFERENCES public.builder_bu_events(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  to_emails    text[] NOT NULL CHECK (cardinality(to_emails) BETWEEN 1 AND 20),
  cc_emails    text[] NOT NULL DEFAULT '{}' CHECK (cardinality(cc_emails) <= 20),
  unit_ids     uuid[] NOT NULL CHECK (cardinality(unit_ids) >= 1),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  outbox_id    uuid REFERENCES public.email_outbox(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_builder_bu_confirm_requests_event
  ON public.builder_bu_confirm_requests(bu_event_id);

COMMENT ON TABLE public.builder_bu_confirm_requests IS
  'One BU agreement value confirmation e-mail: To and CC typed by staff, the units asked about, one link '
  '(token). Anyone who got it may answer on /agreement-confirm/<token>. The per-unit answers live on '
  'builder_bu_agreement_confirmations (request_id = the latest request for the unit).';

ALTER TABLE public.builder_bu_confirm_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS builder_bu_confirm_requests_all ON public.builder_bu_confirm_requests;
CREATE POLICY builder_bu_confirm_requests_all ON public.builder_bu_confirm_requests
  FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_bu_confirm_requests TO anon, authenticated, service_role;

-- ── 2. Per-unit rows: the request and who answered ──────────────────────────
ALTER TABLE public.builder_bu_agreement_confirmations
  ADD COLUMN IF NOT EXISTS request_id         uuid,
  ADD COLUMN IF NOT EXISTS responded_by_name  text,
  ADD COLUMN IF NOT EXISTS responded_by_email text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'builder_bu_agreement_confirmations_request_id_fkey') THEN
    ALTER TABLE public.builder_bu_agreement_confirmations
      ADD CONSTRAINT builder_bu_agreement_confirmations_request_id_fkey
      FOREIGN KEY (request_id) REFERENCES public.builder_bu_confirm_requests(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_builder_bu_agreement_confirm_request
  ON public.builder_bu_agreement_confirmations(request_id);

COMMENT ON COLUMN public.builder_bu_agreement_confirmations.request_id IS
  'The latest builder_bu_confirm_requests row that asked about this unit. NULL for a unit asked about '
  'only by the per-unit e-mails sent before 21 Oct 2026 (its own token still works).';
COMMENT ON COLUMN public.builder_bu_agreement_confirmations.responded_by_name IS
  'Name the person who answered gave on the confirmation page.';
COMMENT ON COLUMN public.builder_bu_agreement_confirmations.responded_by_email IS
  'E-mail the person who answered gave on the confirmation page.';

-- ── 3. Template ─────────────────────────────────────────────────────────────
-- Wording only: the e-mail shell adds the greeting and the signature.
-- {{unit_table}} is one line per unit; {{confirm_link}} is required (the send
-- function puts the request's link there).
INSERT INTO public.email_templates (key, name, kind, step, subject, body, is_active, sort_order) VALUES
('builder_bu_agreement_confirm_request', 'Builder · BU agreement values to confirm', 'builder_agreement_confirm', NULL,
 'Please confirm the agreement values · {{project_name}} | {{client_name}}',
 E'The {{cutoff_label}} for {{project_name}} is dated {{bu_date}}. Under GST, the balance consideration for the units below becomes taxable then, whether or not it has been received.\n\n'
 || E'Our working uses these agreement values ({{unit_count}}, total Rs. {{total_value}}):\n\n'
 || E'{{unit_table}}\n\n'
 || E'Please open the link below to confirm them. You can confirm all at once, or confirm or dispute each unit. If a value has changed and we have not been told, please dispute it and give the right figure, so we can correct our working before filing.\n\n'
 || E'{{confirm_link}}\n\n'
 || E'Anyone who received this e-mail may answer on that page. It asks for your name and e-mail, and we keep them with your answer.\n\n'
 || E'We will hold the differential for each unit until it is confirmed.',
 true, 13)
ON CONFLICT (key) DO NOTHING;

-- ── 4. Helpers ──────────────────────────────────────────────────────────────
-- One e-mail address, as typed. The browser checks the same pattern
-- (src/lib/builderAgreementConfirmData.ts EMAIL_RE).
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_email_ok(p text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p IS NOT NULL AND length(p) <= 254
     AND p ~ '^[^[:space:]@,;<>()"]+@[^[:space:]@,;<>()"]+\.[^[:space:]@,;<>()".]+$';
$$;

-- Addresses trimmed, lower case, blanks and repeats dropped, order kept.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_email_list(p text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(a ORDER BY first_pos), '{}')
    FROM (SELECT a, min(pos) AS first_pos
            FROM (SELECT lower(btrim(x)) AS a, pos
                    FROM unnest(COALESCE(p, '{}'::text[])) WITH ORDINALITY AS t(x, pos)) s
           WHERE a <> ''
           GROUP BY a) d;
$$;

-- ── 5. Staff: send one request ──────────────────────────────────────────────
-- p_subject / p_body / p_render_vars are the template already filled in by the
-- browser, with {{confirm_link}} left in place: this function makes the token
-- and puts the link there, so the e-mail and the request are written together
-- or not at all.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_request_send(
  p_bu_event_id uuid,
  p_unit_ids    uuid[],
  p_to          text[],
  p_cc          text[],
  p_actor_id    uuid,
  p_link_base   text,
  p_subject     text,
  p_body        text,
  p_render_vars jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_to      text[] := public.builder_bu_confirm_email_list(p_to);
  v_cc      text[] := public.builder_bu_confirm_email_list(p_cc);
  v_units   uuid[];
  v_bad     text;
  v_client  uuid;
  v_status  text;
  v_req     public.builder_bu_confirm_requests;
  v_link    text;
  v_outbox  uuid;
  v_base    text := rtrim(btrim(COALESCE(p_link_base, '')), '/');
BEGIN
  IF NOT (
       EXISTS (SELECT 1 FROM public.user_roles
                WHERE user_id = p_actor_id AND role::text IN ('superadmin', 'gst_manager'))
    OR (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_actor_id AND role::text = 'employee')
        AND EXISTS (SELECT 1 FROM public.user_permissions
                     WHERE user_id = p_actor_id AND permission_key = 'post_bu_event'))) THEN
    RAISE EXCEPTION 'You are not allowed to send BU confirmation requests.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Addresses: at least one To; every one valid; a CC that is also a To goes once.
  IF cardinality(v_to) = 0 THEN
    RAISE EXCEPTION 'Enter at least one To address.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT a INTO v_bad FROM unnest(v_to || v_cc) a WHERE NOT public.builder_bu_confirm_email_ok(a) LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Not a valid e-mail address: %', v_bad USING ERRCODE = 'check_violation';
  END IF;
  v_cc := COALESCE(ARRAY(SELECT a FROM unnest(v_cc) WITH ORDINALITY t(a, n) WHERE a <> ALL (v_to) ORDER BY n), '{}');
  IF cardinality(v_to) > 20 OR cardinality(v_cc) > 20 THEN
    RAISE EXCEPTION 'At most 20 addresses in To and 20 in CC.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_base !~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?$' THEN
    RAISE EXCEPTION 'The link address is not valid.' USING ERRCODE = 'check_violation';
  END IF;
  IF position('{{confirm_link}}' IN COALESCE(p_body, '')) = 0 THEN
    RAISE EXCEPTION 'The e-mail has no {{confirm_link}}: add it back to the template under Reminders, Templates.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF btrim(COALESCE(p_subject, '')) = '' THEN
    RAISE EXCEPTION 'The e-mail has no subject.' USING ERRCODE = 'check_violation';
  END IF;

  -- The event, locked so two sends for it go one after the other.
  SELECT p.client_id, ev.status INTO v_client, v_status
    FROM public.builder_bu_events ev
    JOIN public.builder_projects p ON p.id = ev.project_id
   WHERE ev.id = p_bu_event_id
     FOR UPDATE OF ev;
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'That BU event no longer exists.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status = 'POSTED' THEN
    RAISE EXCEPTION 'This BU event is posted: there is nothing left to confirm.' USING ERRCODE = 'check_violation';
  END IF;

  v_units := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_unit_ids, '{}'::uuid[])) x WHERE x IS NOT NULL);
  IF cardinality(v_units) = 0 THEN
    RAISE EXCEPTION 'Tick at least one unit.' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_units) x
              WHERE NOT EXISTS (SELECT 1 FROM public.builder_bu_event_units eu
                                 WHERE eu.bu_event_id = p_bu_event_id AND eu.unit_id = x
                                   AND eu.booked_at_cutoff)) THEN
    RAISE EXCEPTION 'A unit asked about is not a taxable unit of this BU event.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT string_agg(u.unit_no, ', ' ORDER BY u.unit_no) INTO v_bad
    FROM public.builder_bu_agreement_confirmations c
    JOIN public.builder_units u ON u.id = c.unit_id
   WHERE c.bu_event_id = p_bu_event_id AND c.unit_id = ANY (v_units)
     AND c.status IN ('CONFIRMED', 'OVERRIDDEN');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Already confirmed or accepted: unit %. Close this window, open it again and send.', v_bad
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.builder_bu_confirm_requests (bu_event_id, client_id, to_emails, cc_emails, unit_ids, created_by)
  VALUES (p_bu_event_id, v_client, v_to, v_cc, v_units, p_actor_id)
  RETURNING * INTO v_req;
  v_link := v_base || '/agreement-confirm/' || v_req.token;

  INSERT INTO public.email_outbox
    (client_id, to_email, cc_email, kind, template_key, return_type, period_month,
     subject, body, render_vars, status, created_by)
  VALUES
    (v_client, array_to_string(v_to, ', '), NULLIF(array_to_string(v_cc, ', '), ''),
     'builder_agreement_confirm', 'builder_bu_agreement_confirm_request', NULL, NULL,
     replace(p_subject, '{{confirm_link}}', v_link),
     replace(p_body, '{{confirm_link}}', v_link),
     COALESCE(p_render_vars, '{}'::jsonb) || jsonb_build_object('confirm_link', v_link),
     'pending', p_actor_id)
  RETURNING id INTO v_outbox;

  UPDATE public.builder_bu_confirm_requests
     SET outbox_id = v_outbox, sent_at = now()
   WHERE id = v_req.id;

  -- Each unit now waits on this request; an earlier answer (a dispute) is cleared.
  INSERT INTO public.builder_bu_agreement_confirmations AS c
    (bu_event_id, unit_id, client_id, agreement_value_at_request, status, request_id,
     outbox_id, sent_at, created_by)
  SELECT p_bu_event_id, eu.unit_id, v_client, eu.agreement_value, 'PENDING', v_req.id,
         v_outbox, now(), p_actor_id
    FROM public.builder_bu_event_units eu
   WHERE eu.bu_event_id = p_bu_event_id AND eu.unit_id = ANY (v_units)
  ON CONFLICT (bu_event_id, unit_id) DO UPDATE
     SET status = 'PENDING',
         request_id = EXCLUDED.request_id,
         client_id = EXCLUDED.client_id,
         agreement_value_at_request = EXCLUDED.agreement_value_at_request,
         outbox_id = EXCLUDED.outbox_id,
         sent_at = EXCLUDED.sent_at,
         responded_at = NULL,
         responded_by_name = NULL,
         responded_by_email = NULL,
         response_ip = NULL,
         dispute_notes = NULL
   WHERE c.status NOT IN ('CONFIRMED', 'OVERRIDDEN');

  RETURN jsonb_build_object(
    'request_id', v_req.id,
    'token', v_req.token,
    'link', v_link,
    'outbox_id', v_outbox,
    'units', cardinality(v_units),
    'to', to_jsonb(v_to),
    'cc', to_jsonb(v_cc));
END;
$$;

-- ── 6. The public page ──────────────────────────────────────────────────────
-- One unit as the page shows it. state: PENDING (open), CONFIRMED, DISPUTED,
-- ACCEPTED (the firm accepted it without confirmation) or REPLACED (a newer
-- request asks about it; this link no longer does).
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_unit_json(
  c public.builder_bu_agreement_confirmations, p_replaced boolean)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'unit_id', c.unit_id,
    'unit_no', u.unit_no,
    'agreement_value', c.agreement_value_at_request,
    'state', CASE WHEN p_replaced THEN 'REPLACED'
                  WHEN c.status = 'OVERRIDDEN' THEN 'ACCEPTED'
                  ELSE c.status END,
    'responded_by_name',  CASE WHEN p_replaced THEN NULL ELSE c.responded_by_name END,
    'responded_by_email', CASE WHEN p_replaced THEN NULL ELSE c.responded_by_email END,
    'responded_at',       CASE WHEN p_replaced THEN NULL ELSE c.responded_at END,
    'dispute_notes',      CASE WHEN p_replaced OR c.status <> 'DISPUTED' THEN NULL ELSE c.dispute_notes END)
  FROM public.builder_units u
  WHERE u.id = c.unit_id;
$$;

CREATE OR REPLACE FUNCTION public.builder_bu_confirm_lookup(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req   public.builder_bu_confirm_requests;
  v_cf    public.builder_bu_agreement_confirmations;
  v_units jsonb;
  v_event uuid;
  v_kind  text;
BEGIN
  IF _token IS NULL OR length(_token) < 32 THEN RETURN NULL; END IF;

  SELECT * INTO v_req FROM public.builder_bu_confirm_requests WHERE token = _token;
  IF FOUND THEN
    v_kind := 'request';
    v_event := v_req.bu_event_id;
    SELECT jsonb_agg(public.builder_bu_confirm_unit_json(c, c.request_id IS DISTINCT FROM v_req.id)
                     ORDER BY u.sort_order, u.unit_no)
      INTO v_units
      FROM public.builder_bu_agreement_confirmations c
      JOIN public.builder_units u ON u.id = c.unit_id
     WHERE c.bu_event_id = v_req.bu_event_id AND c.unit_id = ANY (v_req.unit_ids);
  ELSE
    SELECT * INTO v_cf FROM public.builder_bu_agreement_confirmations WHERE token = _token;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_kind := 'unit';
    v_event := v_cf.bu_event_id;
    v_units := jsonb_build_array(public.builder_bu_confirm_unit_json(v_cf, v_cf.request_id IS NOT NULL));
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'kind', v_kind,
      'project_name', p.name,
      'bu_date', ev.bu_date,
      'sent_at', CASE WHEN v_kind = 'request' THEN v_req.sent_at ELSE v_cf.sent_at END,
      'units', COALESCE(v_units, '[]'::jsonb))
      FROM public.builder_bu_events ev
      JOIN public.builder_projects p ON p.id = ev.project_id
     WHERE ev.id = v_event);
END;
$$;

-- _answers: [{ "unit_id": uuid, "action": "CONFIRM" | "DISPUTE", "notes": text }]
-- Returns one { unit_id, unit_no, result } per answer; result is CONFIRMED or
-- DISPUTED when recorded, else REPLACED or ALREADY_<state> (someone answered
-- first, or the firm accepted it). Bad input records nothing.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_respond(
  _token text, _answers jsonb, _name text, _email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name   text := btrim(regexp_replace(COALESCE(_name, ''), '[[:space:]]+', ' ', 'g'));
  v_email  text := lower(btrim(COALESCE(_email, '')));
  v_req_id uuid;
  v_event  uuid;
  v_units  uuid[];
  v_kind   text;
  v_ip     text;
  v_h      json;
  a        jsonb;
  v_unit   uuid;
  v_action text;
  v_notes  text;
  v_row    public.builder_bu_agreement_confirmations;
  v_unit_no text;
  v_result text;
  v_out    jsonb := '[]'::jsonb;
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

  SELECT id, bu_event_id, unit_ids INTO v_req_id, v_event, v_units
    FROM public.builder_bu_confirm_requests WHERE token = _token;
  IF FOUND THEN
    v_kind := 'request';
  ELSE
    SELECT bu_event_id, ARRAY[unit_id] INTO v_event, v_units
      FROM public.builder_bu_agreement_confirmations WHERE token = _token;
    IF NOT FOUND OR _token IS NULL THEN
      RAISE EXCEPTION 'This link is not valid.' USING ERRCODE = 'no_data_found';
    END IF;
    v_kind := 'unit';
  END IF;

  -- Check every answer before recording any.
  FOR a IN SELECT value FROM jsonb_array_elements(_answers) LOOP
    BEGIN
      v_unit := (a ->> 'unit_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'That unit is not in this request.' USING ERRCODE = 'check_violation';
    END;
    IF v_unit IS NULL OR NOT (v_unit = ANY (v_units)) THEN
      RAISE EXCEPTION 'That unit is not in this request.' USING ERRCODE = 'check_violation';
    END IF;
    v_action := upper(COALESCE(a ->> 'action', ''));
    IF v_action NOT IN ('CONFIRM', 'DISPUTE') THEN
      RAISE EXCEPTION 'Invalid action' USING ERRCODE = 'check_violation';
    END IF;
    v_notes := btrim(COALESCE(a ->> 'notes', ''));
    IF v_action = 'DISPUTE' AND v_notes = '' THEN
      SELECT unit_no INTO v_unit_no FROM public.builder_units WHERE id = v_unit;
      RAISE EXCEPTION 'Please say what has changed for unit %.', v_unit_no USING ERRCODE = 'check_violation';
    END IF;
    IF length(v_notes) > 2000 THEN
      RAISE EXCEPTION 'Please keep the note under 2000 characters.' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  BEGIN
    v_h := NULLIF(current_setting('request.headers', true), '')::json;
    v_ip := left(COALESCE(NULLIF(btrim(v_h ->> 'cf-connecting-ip'), ''),
                          NULLIF(btrim(v_h ->> 'x-real-ip'), ''),
                          NULLIF(btrim(split_part(COALESCE(v_h ->> 'x-forwarded-for', ''), ',', 1)), '')), 64);
  EXCEPTION WHEN others THEN
    v_ip := NULL;
  END;

  FOR a IN SELECT value FROM jsonb_array_elements(_answers) LOOP
    v_unit := (a ->> 'unit_id')::uuid;
    v_action := upper(a ->> 'action');
    v_notes := NULLIF(btrim(COALESCE(a ->> 'notes', '')), '');

    UPDATE public.builder_bu_agreement_confirmations c
       SET status = CASE WHEN v_action = 'CONFIRM' THEN 'CONFIRMED' ELSE 'DISPUTED' END,
           responded_at = now(),
           responded_by_name = v_name,
           responded_by_email = v_email,
           response_ip = v_ip,
           dispute_notes = CASE WHEN v_action = 'DISPUTE' THEN v_notes ELSE NULL END
     WHERE c.bu_event_id = v_event AND c.unit_id = v_unit AND c.status = 'PENDING'
       AND CASE WHEN v_kind = 'request' THEN c.request_id = v_req_id
                ELSE c.token = _token AND c.request_id IS NULL END
    RETURNING * INTO v_row;

    IF FOUND THEN
      v_result := v_row.status;
    ELSE
      SELECT * INTO v_row FROM public.builder_bu_agreement_confirmations c
       WHERE c.bu_event_id = v_event AND c.unit_id = v_unit;
      v_result := CASE
        WHEN NOT FOUND THEN 'REPLACED'
        WHEN v_kind = 'request' AND v_row.request_id IS DISTINCT FROM v_req_id THEN 'REPLACED'
        WHEN v_kind = 'unit' AND v_row.request_id IS NOT NULL THEN 'REPLACED'
        WHEN v_row.status = 'OVERRIDDEN' THEN 'ALREADY_ACCEPTED'
        ELSE 'ALREADY_' || v_row.status END;
    END IF;
    SELECT unit_no INTO v_unit_no FROM public.builder_units WHERE id = v_unit;
    v_out := v_out || jsonb_build_object('unit_id', v_unit, 'unit_no', v_unit_no, 'result', v_result);
  END LOOP;

  RETURN v_out;
END;
$$;

-- ── 7. The per-unit answer function of the e-mails sent before this change ─
-- Unchanged, except that a unit a newer request asks about no longer takes an
-- answer through its old per-unit link.
CREATE OR REPLACE FUNCTION public.builder_bu_agreement_confirm(_token text, _action text, _notes text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_status text;
BEGIN
  IF _action NOT IN ('CONFIRM', 'DISPUTE') THEN
    RAISE EXCEPTION 'Invalid action';
  END IF;
  _new_status := CASE WHEN _action = 'CONFIRM' THEN 'CONFIRMED' ELSE 'DISPUTED' END;

  UPDATE public.builder_bu_agreement_confirmations
  SET status = _new_status,
      responded_at = now(),
      dispute_notes = CASE WHEN _action = 'DISPUTE' THEN _notes ELSE dispute_notes END
  WHERE token = _token AND status = 'PENDING' AND request_id IS NULL;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.builder_bu_confirm_request_send(uuid, uuid[], text[], text[], uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_respond(text, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_unit_json(public.builder_bu_agreement_confirmations, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_request_send(uuid, uuid[], text[], text[], uuid, text, text, text, jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_lookup(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_respond(text, jsonb, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_email_ok(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_email_list(text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_agreement_confirm(text, text, text) TO anon, authenticated;

COMMIT;
