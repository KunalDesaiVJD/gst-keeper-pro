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
--                                 answered; the page asks for both), and the
--                                 status NOT_SENT (a taxable unit of the event
--                                 that no request has asked about yet).
--   builder_bu_confirm_request_send(...)
--                                 staff: creates the request, points each unit
--                                 at it (status PENDING, earlier answer
--                                 cleared), writes NOT_SENT for the event's
--                                 other taxable units that have no row, and
--                                 queues the one e-mail. A unit answered
--                                 meanwhile (confirmed or accepted) is not
--                                 asked: nothing is written and the function
--                                 returns those units (already_answered), so
--                                 the browser drops them and sends again.
--   builder_bu_confirm_lookup(token) / builder_bu_confirm_respond(...)
--                                 the public page (no login), scoped by the
--                                 token. A request's token reaches its units;
--                                 a per-unit token from an e-mail sent before
--                                 this change reaches its one unit, as before.
--
-- Positions (docs/BUILDER_GST_POSITIONS.md section 6):
--   * Only people the e-mail went to may answer. The page asks the reader's
--     name and e-mail; the e-mail must be one of the request's To or CC
--     addresses (for a per-unit link, the address that e-mail went to or the
--     client master's). The firm's own addresses (@vjdesai.com, and any staff
--     member's e-mail in profiles) never answer: a staff member who wants to
--     clear a unit uses builder_bu_agreement_override, with its permission
--     and reason. A request needs at least one address outside the firm.
--   * Only a PENDING unit takes an answer. A confirmed unit stays confirmed
--     ("a client's own confirmation is never replaced"); a disputed unit stays
--     disputed until staff send a new request for it.
--   * A new request for a unit replaces the earlier one for that unit: the
--     earlier link (request or per-unit) then shows "replaced by a newer
--     request" for it and takes no answer. While the newer e-mail has failed
--     (outbox failed, skipped or cancelled) the earlier link keeps answering,
--     so a failed send never leaves the client without a working link. A
--     confirmed or accepted unit shows that answer on every link that asked.
--   * The posting gate function is unchanged: builder_bu_agreement_confirmation_blocked
--     is not touched; CONFIRMED or OVERRIDDEN clears a unit. Every send
--     writes a row for each taxable unit of the event (NOT_SENT for those not
--     ticked), so a unit staff left out still blocks filing, as it did when
--     every send asked about every unit.
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
--      builder_bu_agreement_confirmations, and NOT_SENT in its status check;
--      functions builder_bu_confirm_request_send, builder_bu_confirm_lookup,
--      builder_bu_confirm_respond, builder_bu_confirm_state,
--      builder_bu_confirm_is_staff; template row
--      builder_bu_agreement_confirm_request in email_templates (step 3 of
--      this file inserts it when missing).
--   3. With the anon key from .env: rpc builder_bu_confirm_lookup with a
--      made-up token returns null; select id from builder_bu_confirm_requests
--      returns [] (not an error); rpc builder_bu_confirm_is_staff is refused.
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
  '(token). Anyone it was sent to may answer on /agreement-confirm/<token>. The per-unit answers live on '
  'builder_bu_agreement_confirmations (request_id = the latest request for the unit).';

ALTER TABLE public.builder_bu_confirm_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS builder_bu_confirm_requests_all ON public.builder_bu_confirm_requests;
CREATE POLICY builder_bu_confirm_requests_all ON public.builder_bu_confirm_requests
  FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_bu_confirm_requests TO anon, authenticated, service_role;

-- ── 2. Per-unit rows: the request, who answered, NOT_SENT ───────────────────
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

-- NOT_SENT: a taxable unit of an event that a request has gone out for, but
-- that no request has asked about yet (staff unticked it). It blocks posting
-- and filing like PENDING (the gate clears only CONFIRMED and OVERRIDDEN) and
-- takes no answer.
ALTER TABLE public.builder_bu_agreement_confirmations
  DROP CONSTRAINT IF EXISTS builder_bu_agreement_confirmations_status_check;
ALTER TABLE public.builder_bu_agreement_confirmations
  ADD CONSTRAINT builder_bu_agreement_confirmations_status_check
  CHECK (status IN ('PENDING', 'CONFIRMED', 'DISPUTED', 'OVERRIDDEN', 'NOT_SENT'));

COMMENT ON COLUMN public.builder_bu_agreement_confirmations.request_id IS
  'The latest builder_bu_confirm_requests row that asked about this unit. NULL for a unit asked about '
  'only by the per-unit e-mails sent before 21 Oct 2026 (its own token still works), and for NOT_SENT.';
COMMENT ON COLUMN public.builder_bu_agreement_confirmations.responded_by_name IS
  'Name the person who answered gave on the confirmation page.';
COMMENT ON COLUMN public.builder_bu_agreement_confirmations.responded_by_email IS
  'E-mail the person who answered gave on the confirmation page: one the e-mail was sent to (checked).';

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
 || E'Anyone this e-mail was sent to, in To or CC, may answer on that page. It asks for your name and the e-mail address this message reached you at, and we keep them with your answer.\n\n'
 || E'We will hold the differential for each unit until it is confirmed.',
 true, 13)
ON CONFLICT (key) DO NOTHING;

-- ── 4. Helpers ──────────────────────────────────────────────────────────────
-- One e-mail address, as typed: a dot-atom local part (no leading, trailing or
-- doubled dot) and a domain of labels made of letters, digits and inner
-- hyphens. The browser checks the same pattern
-- (src/lib/builderAgreementConfirmData.ts EMAIL_RE).
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_email_ok(p text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p IS NOT NULL AND length(p) <= 254 AND length(split_part(p, '@', 1)) <= 64
     AND p ~ ('^[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+)*'
              || '@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z][A-Za-z0-9-]{0,61}[A-Za-z0-9]$');
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

-- The addresses in a stored To / CC string (email_outbox.to_email, or
-- clients.email): comma, semicolon or space separated, "Name <addr>" allowed.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_addresses(p text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT lower(m[1])), '{}')
    FROM regexp_matches(COALESCE(p, ''), '([^[:space:],;<>()"]+@[^[:space:],;<>()"]+)', 'g') AS m;
$$;

-- The firm's own address: the firm's domain, or the e-mail of any staff member
-- (a profile whose user holds a staff level). Such an address may get a copy
-- of a request but never answers it.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_is_staff(p text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT split_part(lower(btrim(COALESCE(p, ''))), '@', 2) = 'vjdesai.com'
      OR split_part(lower(btrim(COALESCE(p, ''))), '@', 2) LIKE '%.vjdesai.com'
      OR EXISTS (SELECT 1
                   FROM public.profiles pr
                   JOIN public.user_roles r ON r.user_id = pr.user_id
                  WHERE lower(btrim(pr.email)) = lower(btrim(p))
                    AND r.role::text IN ('superadmin', 'gst_manager', 'employee'));
$$;

-- Is this request's e-mail out, or on its way? false when the outbox row
-- failed, was skipped or cancelled (nobody got it), or there is no request.
-- An outbox row that is gone counts as out.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_request_live(p_request uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT o.status IS NULL OR o.status NOT IN ('failed', 'skipped', 'cancelled')
                     FROM public.builder_bu_confirm_requests r
                     LEFT JOIN public.email_outbox o ON o.id = r.outbox_id
                    WHERE r.id = p_request), false);
$$;

-- How a unit stands on one link. p_req_id: the link's request (NULL for a
-- per-unit link, whose row the caller found by its token). The caller checks
-- that the link asked about the unit.
--   CONFIRMED / ACCEPTED   final: shown on every link that asked about it
--   PENDING / DISPUTED     when this link is the unit's latest request, or
--                          the latest one's e-mail never went out
--   REPLACED               a newer request, whose e-mail is out, asks about it
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_state(
  c public.builder_bu_agreement_confirmations, p_req_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN c.status = 'CONFIRMED' THEN 'CONFIRMED'
    WHEN c.status = 'OVERRIDDEN' THEN 'ACCEPTED'
    WHEN c.status = 'NOT_SENT' THEN 'NOT_SENT'
    WHEN c.request_id IS NOT DISTINCT FROM p_req_id THEN c.status
    WHEN public.builder_bu_confirm_request_live(c.request_id) THEN 'REPLACED'
    ELSE c.status
  END;
$$;

-- ── 5. Staff: send one request ──────────────────────────────────────────────
-- p_subject / p_body / p_render_vars are the template already filled in by the
-- browser, with {{confirm_link}} left in place: this function makes the token
-- and puts the link there, so the e-mail and the request are written together
-- or not at all.
--
-- Returns { sent: true, request_id, token, link, outbox_id, units, to, cc }, or
-- { sent: false, already_answered: [{ unit_id, unit_no, status,
-- responded_by_name, responded_by_email }] } when a ticked unit was confirmed
-- or accepted meanwhile: nothing is written then, and the browser sends again
-- without those units (the e-mail lists the units, so it is rendered again).
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
  v_to       text[] := public.builder_bu_confirm_email_list(p_to);
  v_cc       text[] := public.builder_bu_confirm_email_list(p_cc);
  v_units    uuid[];
  v_bad      text;
  v_client   uuid;
  v_status   text;
  v_req      public.builder_bu_confirm_requests;
  v_link     text;
  v_outbox   uuid;
  v_answered jsonb;
  v_base     text := rtrim(btrim(COALESCE(p_link_base, '')), '/');
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
  -- The firm's own addresses never answer, so a request only to them could
  -- never be answered (and must not be: that is what the override is for).
  IF NOT EXISTS (SELECT 1 FROM unnest(v_to || v_cc) a WHERE NOT public.builder_bu_confirm_is_staff(a)) THEN
    RAISE EXCEPTION 'Add at least one address outside the firm. The firm''s own addresses get a copy but cannot answer.'
      USING ERRCODE = 'check_violation';
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

  -- The event's rows, locked in one order (the page's answers lock them in
  -- the same order), so an answer given while this runs is either seen here
  -- or waits for this send.
  PERFORM 1 FROM public.builder_bu_agreement_confirmations
   WHERE bu_event_id = p_bu_event_id
   ORDER BY unit_id
     FOR UPDATE;

  SELECT jsonb_agg(jsonb_build_object('unit_id', c.unit_id, 'unit_no', u.unit_no, 'status', c.status,
                                      'responded_by_name', c.responded_by_name,
                                      'responded_by_email', c.responded_by_email)
                   ORDER BY u.sort_order, u.unit_no)
    INTO v_answered
    FROM public.builder_bu_agreement_confirmations c
    JOIN public.builder_units u ON u.id = c.unit_id
   WHERE c.bu_event_id = p_bu_event_id AND c.unit_id = ANY (v_units)
     AND c.status IN ('CONFIRMED', 'OVERRIDDEN');
  IF v_answered IS NOT NULL THEN
    RETURN jsonb_build_object('sent', false, 'already_answered', v_answered);
  END IF;

  BEGIN
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

    -- A unit the upsert did not take was cleared by someone else in the
    -- meantime (a row written after the lock above, by an acceptance): the
    -- e-mail would ask about it, so undo this send and report it.
    IF EXISTS (SELECT 1 FROM unnest(v_units) x
                WHERE NOT EXISTS (SELECT 1 FROM public.builder_bu_agreement_confirmations c
                                   WHERE c.bu_event_id = p_bu_event_id AND c.unit_id = x
                                     AND c.request_id = v_req.id)) THEN
      RAISE EXCEPTION 'answered meanwhile' USING ERRCODE = 'BUC01';
    END IF;

    -- Every other taxable unit of the event gets a row, so the filing gate
    -- (rows only) sees a unit staff left unticked.
    INSERT INTO public.builder_bu_agreement_confirmations
      (bu_event_id, unit_id, client_id, agreement_value_at_request, status, created_by)
    SELECT p_bu_event_id, eu.unit_id, v_client, eu.agreement_value, 'NOT_SENT', p_actor_id
      FROM public.builder_bu_event_units eu
     WHERE eu.bu_event_id = p_bu_event_id AND eu.booked_at_cutoff AND NOT (eu.unit_id = ANY (v_units))
    ON CONFLICT (bu_event_id, unit_id) DO NOTHING;
  EXCEPTION WHEN SQLSTATE 'BUC01' THEN
    SELECT jsonb_agg(jsonb_build_object('unit_id', c.unit_id, 'unit_no', u.unit_no, 'status', c.status,
                                        'responded_by_name', c.responded_by_name,
                                        'responded_by_email', c.responded_by_email)
                     ORDER BY u.sort_order, u.unit_no)
      INTO v_answered
      FROM public.builder_bu_agreement_confirmations c
      JOIN public.builder_units u ON u.id = c.unit_id
     WHERE c.bu_event_id = p_bu_event_id AND c.unit_id = ANY (v_units)
       AND c.status IN ('CONFIRMED', 'OVERRIDDEN');
    RETURN jsonb_build_object('sent', false, 'already_answered', COALESCE(v_answered, '[]'::jsonb));
  END;

  RETURN jsonb_build_object(
    'sent', true,
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
-- One unit as the page shows it (state from builder_bu_confirm_state:
-- PENDING, CONFIRMED, DISPUTED, ACCEPTED or REPLACED).
DROP FUNCTION IF EXISTS public.builder_bu_confirm_unit_json(public.builder_bu_agreement_confirmations, boolean);
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_unit_json(
  c public.builder_bu_agreement_confirmations, p_req_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'unit_id', c.unit_id,
    'unit_no', u.unit_no,
    'agreement_value', c.agreement_value_at_request,
    'state', s.state,
    'responded_by_name',  CASE WHEN s.state IN ('CONFIRMED', 'DISPUTED') THEN c.responded_by_name END,
    'responded_by_email', CASE WHEN s.state IN ('CONFIRMED', 'DISPUTED') THEN c.responded_by_email END,
    'responded_at',       CASE WHEN s.state IN ('CONFIRMED', 'DISPUTED') THEN c.responded_at END,
    'dispute_notes',      CASE WHEN s.state = 'DISPUTED' THEN c.dispute_notes END)
  FROM public.builder_units u,
       LATERAL (SELECT public.builder_bu_confirm_state(c, p_req_id) AS state) s
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
    SELECT jsonb_agg(public.builder_bu_confirm_unit_json(c, v_req.id) ORDER BY u.sort_order, u.unit_no)
      INTO v_units
      FROM public.builder_bu_agreement_confirmations c
      JOIN public.builder_units u ON u.id = c.unit_id
     WHERE c.bu_event_id = v_req.bu_event_id AND c.unit_id = ANY (v_req.unit_ids);
  ELSE
    -- A per-unit token. A NOT_SENT row's token was never e-mailed.
    SELECT * INTO v_cf FROM public.builder_bu_agreement_confirmations
     WHERE token = _token AND status <> 'NOT_SENT';
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_kind := 'unit';
    v_event := v_cf.bu_event_id;
    v_units := jsonb_build_array(public.builder_bu_confirm_unit_json(v_cf, NULL));
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
-- first, or the firm accepted it). Bad input records nothing. _email must be
-- one the e-mail was sent to, and not the firm's own.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_respond(
  _token text, _answers jsonb, _name text, _email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name    text := btrim(regexp_replace(COALESCE(_name, ''), '[[:space:]]+', ' ', 'g'));
  v_email   text := lower(btrim(COALESCE(_email, '')));
  v_req     public.builder_bu_confirm_requests;
  v_cf      public.builder_bu_agreement_confirmations;
  v_req_id  uuid;
  v_event   uuid;
  v_units   uuid[];
  v_allowed text[];
  v_ip      text;
  v_h       json;
  a         jsonb;
  v_unit    uuid;
  v_action  text;
  v_notes   text;
  v_row     public.builder_bu_agreement_confirmations;
  v_state   text;
  v_unit_no text;
  v_result  text;
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

  -- The link: a request (its To and CC may answer), or a per-unit link sent
  -- before 21 Oct 2026 (the addresses that e-mail went to, or the client
  -- master's, may answer).
  SELECT * INTO v_req FROM public.builder_bu_confirm_requests WHERE token = _token;
  IF FOUND THEN
    v_req_id := v_req.id;
    v_event := v_req.bu_event_id;
    v_units := v_req.unit_ids;
    v_allowed := v_req.to_emails || v_req.cc_emails;
  ELSE
    SELECT * INTO v_cf FROM public.builder_bu_agreement_confirmations
     WHERE token = _token AND status <> 'NOT_SENT';
    IF NOT FOUND OR _token IS NULL THEN
      RAISE EXCEPTION 'This link is not valid.' USING ERRCODE = 'no_data_found';
    END IF;
    v_event := v_cf.bu_event_id;
    v_units := ARRAY[v_cf.unit_id];
    -- outbox_id: that e-mail, or the newer request's once one asked about
    -- the unit (its To and CC got an e-mail about it too).
    SELECT public.builder_bu_confirm_addresses(cl.email) INTO v_allowed
      FROM public.clients cl WHERE cl.id = v_cf.client_id;
    IF v_cf.outbox_id IS NOT NULL THEN
      SELECT COALESCE(v_allowed, '{}') || public.builder_bu_confirm_addresses(o.to_email)
                                       || public.builder_bu_confirm_addresses(o.cc_email)
        INTO v_allowed
        FROM public.email_outbox o WHERE o.id = v_cf.outbox_id;
    END IF;
  END IF;

  IF public.builder_bu_confirm_is_staff(v_email) THEN
    RAISE EXCEPTION 'The firm''s staff cannot answer here. To accept a value without the client, use Accept on the BU Events page.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (v_email = ANY (COALESCE(v_allowed, '{}'))) THEN
    RAISE EXCEPTION 'Please give the e-mail address our e-mail reached you at. Only the people it was sent to (To or CC) can answer.'
      USING ERRCODE = 'insufficient_privilege';
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

  -- The rows answered, locked in the order a send locks them.
  PERFORM 1 FROM public.builder_bu_agreement_confirmations
   WHERE bu_event_id = v_event
     AND unit_id IN (SELECT (x ->> 'unit_id')::uuid FROM jsonb_array_elements(_answers) x)
   ORDER BY unit_id
     FOR UPDATE;

  FOR a IN SELECT value FROM jsonb_array_elements(_answers) LOOP
    v_unit := (a ->> 'unit_id')::uuid;
    v_action := upper(a ->> 'action');
    v_notes := NULLIF(btrim(COALESCE(a ->> 'notes', '')), '');

    SELECT * INTO v_row FROM public.builder_bu_agreement_confirmations c
     WHERE c.bu_event_id = v_event AND c.unit_id = v_unit;
    IF NOT FOUND OR (v_req_id IS NULL AND v_row.token IS DISTINCT FROM _token) THEN
      v_result := 'REPLACED';
    ELSE
      v_state := public.builder_bu_confirm_state(v_row, v_req_id);
      IF v_state = 'PENDING' THEN
        UPDATE public.builder_bu_agreement_confirmations c
           SET status = CASE WHEN v_action = 'CONFIRM' THEN 'CONFIRMED' ELSE 'DISPUTED' END,
               responded_at = now(),
               responded_by_name = v_name,
               responded_by_email = v_email,
               response_ip = v_ip,
               dispute_notes = CASE WHEN v_action = 'DISPUTE' THEN v_notes ELSE NULL END
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

-- The page's functions and the send are called with the public key; the
-- helpers are reached only through them (Supabase grants new functions to
-- anon and authenticated by default, hence the explicit revokes).
REVOKE ALL ON FUNCTION public.builder_bu_confirm_request_send(uuid, uuid[], text[], text[], uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_respond(text, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_unit_json(public.builder_bu_agreement_confirmations, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_state(public.builder_bu_agreement_confirmations, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_is_staff(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_request_live(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_request_send(uuid, uuid[], text[], text[], uuid, text, text, text, jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_lookup(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_respond(text, jsonb, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_email_ok(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_email_list(text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_addresses(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_agreement_confirm(text, text, text) TO anon, authenticated;

COMMIT;
