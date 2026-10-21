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
--                                 one token, one email_outbox row. seq orders
--                                 the requests of an event (newer = higher).
--   builder_bu_agreement_confirmations
--                                 still one row per unit, still the record the
--                                 posting gate reads. New: request_id (the
--                                 latest request that asked about the unit),
--                                 responded_by_name / responded_by_email (who
--                                 answered), and the status NOT_SENT (a
--                                 taxable unit of the event that no request
--                                 has asked about yet).
--   builder_bu_confirm_codes      PRIVATE (RLS on, no policies, service role
--                                 only, like client_password_resets): the
--                                 one-time codes that prove a reader controls
--                                 the address they give. Only hashes are kept.
--   builder_bu_confirm_answer_history
--                                 a dispute a later request cleared: the
--                                 note, who gave it and when, and the request
--                                 that asked again. Open to public.
--   builder_bu_confirm_request_send(...)
--                                 staff: creates the request, points each unit
--                                 at it (status PENDING; a dispute is copied
--                                 to the history, then cleared), writes
--                                 NOT_SENT for the event's other taxable units
--                                 that have no row, cancels an earlier
--                                 request's e-mail still waiting in the outbox
--                                 when this one asks everything it asked, and
--                                 queues the one e-mail. p_seen carries the
--                                 status and answer time of each ticked unit
--                                 as the pop-up showed them: a unit answered
--                                 since (confirmed, accepted or disputed), or
--                                 confirmed or accepted at all, is not asked:
--                                 nothing is written and the function returns
--                                 those units (already_answered).
--   builder_bu_confirm_lookup(token)
--   builder_bu_confirm_code_request(token, email)   anon: queue a code
--   builder_bu_confirm_code_claim / _mark            service role: the Edge
--                                 Function bu-confirm-code mints the code,
--                                 e-mails it, reports back
--   builder_bu_confirm_code_verify(token, email, code)   anon: returns a proof
--   builder_bu_confirm_respond(token, answers, name, email, proof)
--                                 the public page (no login), scoped by the
--                                 token. A request's token reaches its units;
--                                 a per-unit token from an e-mail sent before
--                                 this change reaches its one unit.
--   builder_bu_confirm_firm_addresses(actor, list)
--                                 staff: which typed addresses count as the
--                                 firm's own (the pop-up shows them).
--
-- Positions (docs/BUILDER_GST_POSITIONS.md section 6):
--   * Only people the e-mail went to may answer, and they prove it. The page
--     asks the reader's name and e-mail; the e-mail must be one of the
--     request's To or CC addresses (for a per-unit link, the address that
--     e-mail went to or the client master's) and not the firm's own. The
--     database then queues a 6-digit code to that address; the Edge Function
--     bu-confirm-code e-mails it straight through Microsoft Graph (never
--     through email_outbox, which the anon key can read) and does not keep a
--     copy in the firm's Sent Items. The code works for 30 minutes and 5
--     tries, at most 10 wrong tries a day per address, at most 5 codes an
--     hour and 10 a day per address, 20 an hour per link. A right code gives
--     a proof (a random key, kept as a hash) good for 2 hours; every answer
--     needs it. So a staff member holding the firm's copy of the e-mail, who
--     sees the client's address in its header, cannot answer as the client:
--     the code goes to the client's mailbox. Staff clear a unit only with
--     builder_bu_agreement_override, its permission and reason.
--   * The firm's own addresses (@vjdesai.com, and any staff member's e-mail in
--     profiles) never answer. A request needs at least one address outside
--     the firm; a refusal names the addresses that count as the firm's.
--   * Only a PENDING unit takes an answer. A confirmed unit stays confirmed
--     ("a client's own confirmation is never replaced"); a disputed unit stays
--     disputed until staff send a new request for it. A dispute given while
--     the pop-up was open is never cleared by that send: the send reports it.
--     A dispute staff ask about again is kept in the history.
--   * A link shows a unit as "replaced by a newer request" (and takes no
--     answer for it) once a newer request that asks about the unit has gone
--     out (outbox status sent, or the outbox row is gone). While the newer
--     e-mail is still queued, being sent, or failed, the earlier link keeps
--     answering. A per-unit link counts every request as newer. A confirmed
--     or accepted unit shows that answer on every link that asked.
--   * The posting gate function is unchanged: builder_bu_agreement_confirmation_blocked
--     is not touched; CONFIRMED or OVERRIDDEN clears a unit. Every send
--     writes a row for each taxable unit of the event (NOT_SENT for those not
--     ticked), so a unit staff left out still blocks filing.
--   * The per-unit answer function of the old e-mails
--     (builder_bu_agreement_confirm) and its lookup are closed to the public
--     key: a per-unit link is answered on the new page, with the same checks.
--
-- RLS: builder_bu_confirm_requests and builder_bu_confirm_answer_history are
-- open to public like every app table (the app has no Supabase auth session).
-- builder_bu_confirm_codes is private (RLS on, no policies), on the footing
-- of client_password_resets: its rows prove who answered. The page's
-- functions are SECURITY DEFINER and touch only what the token names. The
-- send and the firm-address check verify the actor as the BU Events page
-- does (superadmin, GST Manager, or an employee holding post_bu_event); the
-- actor id is the browser's word, as for builder_bu_agreement_override.
--
-- Re-runnable. Tests: supabase/tests/bu_confirm/run.sh (local PostgreSQL) and
-- deno test supabase/functions/bu-confirm-code/test/.
--
-- Live-apply steps (project gcquafqxbykxkbexcdpy only; never the project in
-- SUPABASE_PROJECT_REF):
--   1. Deploy the Edge Function bu-confirm-code (supabase/functions/bu-confirm-code,
--      default verify_jwt: the page calls it with the anon key). It uses the
--      Graph secrets client-password-reset already has (GRAPH_TENANT_ID,
--      GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER); check they are set
--      for it.
--   2. Apply this file to gcquafqxbykxkbexcdpy (management API database query
--      or the SQL editor), then deploy the app at once: the old public page
--      calls builder_bu_agreement_confirm / _confirmation_lookup, which this
--      file closes, and the BU Events pop-up calls the new functions.
--   3. Check the objects exist: tables builder_bu_confirm_requests (with seq,
--      earlier_link), builder_bu_confirm_codes, builder_bu_confirm_answer_history;
--      columns request_id, responded_by_name, responded_by_email on
--      builder_bu_agreement_confirmations, and NOT_SENT in its status check;
--      functions builder_bu_confirm_request_send (10 arguments),
--      builder_bu_confirm_lookup, builder_bu_confirm_code_request,
--      builder_bu_confirm_code_claim, builder_bu_confirm_code_mark,
--      builder_bu_confirm_code_verify, builder_bu_confirm_respond (5
--      arguments), builder_bu_confirm_firm_addresses; template row
--      builder_bu_agreement_confirm_request in email_templates (section 5
--      of this file inserts it when missing).
--   4. With the anon key from .env: rpc builder_bu_confirm_lookup with a
--      made-up token returns null; select id from builder_bu_confirm_requests
--      returns [] (not an error); select id from builder_bu_confirm_codes is
--      refused; rpc builder_bu_confirm_code_claim, builder_bu_confirm_is_staff
--      and builder_bu_agreement_confirm are refused.
--   5. No redeploy of send-gst-email: v5 already sends to every address in
--      to_email and cc_email, comma or semicolon separated.
--   6. Per-unit links already sent keep working on the new page.

BEGIN;

-- ── 1. Requests ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_bu_confirm_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq          bigint GENERATED ALWAYS AS IDENTITY,
  token        text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  bu_event_id  uuid NOT NULL REFERENCES public.builder_bu_events(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  to_emails    text[] NOT NULL CHECK (cardinality(to_emails) BETWEEN 1 AND 20),
  cc_emails    text[] NOT NULL DEFAULT '{}' CHECK (cardinality(cc_emails) <= 20),
  unit_ids     uuid[] NOT NULL CHECK (cardinality(unit_ids) >= 1),
  earlier_link boolean NOT NULL DEFAULT false,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  outbox_id    uuid REFERENCES public.email_outbox(id) ON DELETE SET NULL
);
-- (Earlier drafts of this file had neither column.)
ALTER TABLE public.builder_bu_confirm_requests
  ADD COLUMN IF NOT EXISTS seq bigint GENERATED ALWAYS AS IDENTITY,
  ADD COLUMN IF NOT EXISTS earlier_link boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_builder_bu_confirm_requests_event
  ON public.builder_bu_confirm_requests(bu_event_id);

COMMENT ON TABLE public.builder_bu_confirm_requests IS
  'One BU agreement value confirmation e-mail: To and CC typed by staff, the units asked about, one link '
  '(token). Anyone it was sent to may answer on /agreement-confirm/<token>, after proving the address with a '
  'code. The per-unit answers live on builder_bu_agreement_confirmations (request_id = the latest request for '
  'the unit). seq orders the requests (newer = higher).';
COMMENT ON COLUMN public.builder_bu_confirm_requests.earlier_link IS
  'When sent, an earlier e-mail with a link to some of these units had gone out (a request, or a per-unit '
  'e-mail of before 21 Oct 2026): while this e-mail is not out, that link still takes answers.';

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
  'E-mail the person who answered gave on the confirmation page: one the e-mail was sent to, proved by a '
  'code e-mailed to it (builder_bu_confirm_codes).';

-- ── 3. Disputes a later request cleared ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_bu_confirm_answer_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bu_event_id        uuid NOT NULL REFERENCES public.builder_bu_events(id) ON DELETE CASCADE,
  unit_id            uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  request_id         uuid REFERENCES public.builder_bu_confirm_requests(id) ON DELETE SET NULL,
  status             text NOT NULL,
  agreement_value    numeric,
  dispute_notes      text,
  responded_by_name  text,
  responded_by_email text,
  responded_at       timestamptz,
  cleared_at         timestamptz NOT NULL DEFAULT now(),
  cleared_by         uuid,
  cleared_by_request uuid REFERENCES public.builder_bu_confirm_requests(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_builder_bu_confirm_answer_history_event
  ON public.builder_bu_confirm_answer_history(bu_event_id, unit_id);
COMMENT ON TABLE public.builder_bu_confirm_answer_history IS
  'An answer a later request cleared (a dispute staff asked about again): the note, who gave it, when, on '
  'which request (NULL: a per-unit link), at what value, and the request that asked again. Written by '
  'builder_bu_confirm_request_send.';
ALTER TABLE public.builder_bu_confirm_answer_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS builder_bu_confirm_answer_history_all ON public.builder_bu_confirm_answer_history;
CREATE POLICY builder_bu_confirm_answer_history_all ON public.builder_bu_confirm_answer_history
  FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_bu_confirm_answer_history TO anon, authenticated, service_role;

-- ── 4. One-time codes (private) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.builder_bu_confirm_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             bigint GENERATED ALWAYS AS IDENTITY,
  request_id      uuid REFERENCES public.builder_bu_confirm_requests(id) ON DELETE CASCADE,
  confirmation_id uuid REFERENCES public.builder_bu_agreement_confirmations(id) ON DELETE CASCADE,
  email           text NOT NULL,
  requested_ip    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  code_hash       text,
  claimed_at      timestamptz,
  expires_at      timestamptz,
  sent_at         timestamptz,
  send_error      text,
  wrong_tries     integer NOT NULL DEFAULT 0,
  proof_hash      text UNIQUE,
  verified_at     timestamptz,
  CHECK ((request_id IS NULL) <> (confirmation_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_builder_bu_confirm_codes_request
  ON public.builder_bu_confirm_codes(request_id, email) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_builder_bu_confirm_codes_confirmation
  ON public.builder_bu_confirm_codes(confirmation_id, email) WHERE confirmation_id IS NOT NULL;
COMMENT ON TABLE public.builder_bu_confirm_codes IS
  'One-time codes that prove a reader of a BU confirmation link controls the address they answer as. '
  'Private: RLS on, no policies, service role only. code_hash = sha256(id:code); proof_hash = sha256 of '
  'the proof the page sends with each answer. The code itself is never stored.';
ALTER TABLE public.builder_bu_confirm_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.builder_bu_confirm_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.builder_bu_confirm_codes TO service_role;

-- ── 5. Template ─────────────────────────────────────────────────────────────
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
 || E'Anyone this e-mail was sent to, in To or CC, may answer on that page. It asks for your name and the e-mail address this message reached you at, and sends a short code to that address to check it. We keep your name and e-mail with your answer.\n\n'
 || E'We will hold the differential for each unit until it is confirmed.',
 true, 13)
ON CONFLICT (key) DO NOTHING;

-- ── 6. Helpers ──────────────────────────────────────────────────────────────
-- One e-mail address, as typed: a dot-atom local part (no leading, trailing or
-- doubled dot) and a domain of labels made of letters, digits and inner
-- hyphens. The browser checks the same pattern
-- (src/lib/builderConfirmRules.ts EMAIL_RE).
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

-- May this actor send requests? As the BU Events page: superadmin, GST
-- Manager, or an employee holding post_bu_event.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_may_send(p_actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = p_actor_id AND role::text IN ('superadmin', 'gst_manager'))
      OR (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_actor_id AND role::text = 'employee')
          AND EXISTS (SELECT 1 FROM public.user_permissions
                       WHERE user_id = p_actor_id AND permission_key = 'post_bu_event'));
$$;

-- The caller's address as the API gateway passed it on (best effort; NULL
-- outside a PostgREST request).
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_request_ip()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE h json;
BEGIN
  h := NULLIF(current_setting('request.headers', true), '')::json;
  RETURN left(COALESCE(NULLIF(btrim(h ->> 'cf-connecting-ip'), ''),
                       NULLIF(btrim(h ->> 'x-real-ip'), ''),
                       NULLIF(btrim(split_part(COALESCE(h ->> 'x-forwarded-for', ''), ',', 1)), '')), 64);
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- Has this request's e-mail gone out? true when the outbox row is sent, or is
-- gone; false while it waits, is being sent, or failed, was skipped or
-- cancelled (round 2: a queued or stuck e-mail no longer counts as out).
DROP FUNCTION IF EXISTS public.builder_bu_confirm_request_live(uuid);
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_request_out(p_request uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT r.outbox_id IS NULL OR o.id IS NULL OR o.status = 'sent'
                     FROM public.builder_bu_confirm_requests r
                     LEFT JOIN public.email_outbox o ON o.id = r.outbox_id
                    WHERE r.id = p_request), false);
$$;

-- How a unit stands on one link. p_req_id: the link's request (NULL for a
-- per-unit link, whose row the caller found by its token). The caller checks
-- that the link asked about the unit.
--   CONFIRMED / ACCEPTED   final: shown on every link that asked about it
--   NOT_SENT               no request asks about it
--   REPLACED               a request newer than this link (for a per-unit
--                          link: any request) asks about it and is out
--   PENDING / DISPUTED     otherwise
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
    WHEN EXISTS (
      SELECT 1
        FROM public.builder_bu_confirm_requests n
       WHERE n.bu_event_id = c.bu_event_id
         AND c.unit_id = ANY (n.unit_ids)
         AND n.seq > COALESCE((SELECT l.seq FROM public.builder_bu_confirm_requests l WHERE l.id = p_req_id), 0)
         AND public.builder_bu_confirm_request_out(n.id)) THEN 'REPLACED'
    ELSE c.status
  END;
$$;

-- Is a unit as the pop-up showed it? p_seen: { status, responded_at } as read
-- (no entry: taken as unanswered, so a dispute staff did not see is never
-- cleared).
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_seen_same(p_seen jsonb, p_status text, p_responded_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF p_seen IS NULL OR jsonb_typeof(p_seen) <> 'object' THEN
    RETURN p_status IN ('PENDING', 'NOT_SENT');
  END IF;
  RETURN COALESCE(p_seen ->> 'status', '') = p_status
     AND (NULLIF(p_seen ->> 'responded_at', ''))::timestamptz IS NOT DISTINCT FROM p_responded_at;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;

-- The ticked units a send must not ask: confirmed or accepted, or not as the
-- pop-up showed them (answered since, a dispute included). NULL when none.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_changed(p_event uuid, p_units uuid[], p_seen jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_agg(jsonb_build_object(
           'unit_id', x, 'unit_no', u.unit_no, 'status', COALESCE(c.status, 'NOT_SENT'),
           'responded_by_name', c.responded_by_name, 'responded_by_email', c.responded_by_email,
           'responded_at', c.responded_at, 'dispute_notes', c.dispute_notes)
         ORDER BY u.sort_order, u.unit_no)
    FROM unnest(p_units) x
    JOIN public.builder_units u ON u.id = x
    LEFT JOIN public.builder_bu_agreement_confirmations c ON c.bu_event_id = p_event AND c.unit_id = x
   WHERE COALESCE(c.status, 'NOT_SENT') IN ('CONFIRMED', 'OVERRIDDEN')
      OR NOT public.builder_bu_confirm_seen_same(
               CASE WHEN jsonb_typeof(p_seen) = 'object' THEN p_seen -> x::text END,
               COALESCE(c.status, 'NOT_SENT'), c.responded_at);
$$;

-- A link, by its token: the request (o_req) or the per-unit row (o_cf), the
-- event, the units it reaches, and the addresses the e-mail went to (a
-- request: its To and CC; a per-unit link: the address that e-mail went to,
-- or the newer request's once one asked about the unit, and the client
-- master's). All NULL when the token reaches nothing (a NOT_SENT row's token
-- was never e-mailed).
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_link(
  _token text,
  OUT o_req uuid, OUT o_cf uuid, OUT o_event uuid, OUT o_units uuid[], OUT o_allowed text[])
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_req public.builder_bu_confirm_requests;
  v_cf  public.builder_bu_agreement_confirmations;
BEGIN
  IF _token IS NULL OR length(_token) < 32 THEN RETURN; END IF;
  SELECT * INTO v_req FROM public.builder_bu_confirm_requests r WHERE r.token = _token;
  IF FOUND THEN
    o_req := v_req.id;
    o_event := v_req.bu_event_id;
    o_units := v_req.unit_ids;
    o_allowed := v_req.to_emails || v_req.cc_emails;
    RETURN;
  END IF;
  SELECT * INTO v_cf FROM public.builder_bu_agreement_confirmations c
   WHERE c.token = _token AND c.status <> 'NOT_SENT';
  IF NOT FOUND THEN RETURN; END IF;
  o_cf := v_cf.id;
  o_event := v_cf.bu_event_id;
  o_units := ARRAY[v_cf.unit_id];
  o_allowed := COALESCE((SELECT public.builder_bu_confirm_addresses(cl.email)
                           FROM public.clients cl WHERE cl.id = v_cf.client_id), '{}')
            || COALESCE((SELECT public.builder_bu_confirm_addresses(o.to_email)
                                || public.builder_bu_confirm_addresses(o.cc_email)
                           FROM public.email_outbox o WHERE o.id = v_cf.outbox_id), '{}');
END;
$$;

-- Refuses an answerer who is the firm's own, or not on the e-mail.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_check_answerer(p_allowed text[], p_email text)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF public.builder_bu_confirm_is_staff(p_email) THEN
    RAISE EXCEPTION 'The firm''s staff cannot answer here. To accept a value without the client, use Accept on the BU Events page.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (p_email = ANY (COALESCE(p_allowed, '{}'))) THEN
    RAISE EXCEPTION 'Please give the e-mail address our e-mail reached you at. Only the people it was sent to (To or CC) can answer.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

-- ── 7. Staff: which typed addresses are the firm's own ──────────────────────
-- For the pop-up's "The firm's own" line (a staff member's personal address
-- is one, which the browser cannot tell). Only for an actor who may send.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_firm_addresses(p_actor_id uuid, p_addresses text[])
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_list text[] := public.builder_bu_confirm_email_list(p_addresses);
BEGIN
  IF NOT public.builder_bu_confirm_may_send(p_actor_id) THEN
    RAISE EXCEPTION 'You are not allowed to send BU confirmation requests.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF cardinality(v_list) > 40 THEN
    RAISE EXCEPTION 'At most 20 addresses in To and 20 in CC.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(ARRAY(SELECT a FROM unnest(v_list) WITH ORDINALITY t(a, n)
                         WHERE public.builder_bu_confirm_is_staff(a) ORDER BY n), '{}');
END;
$$;

-- ── 8. Staff: send one request ──────────────────────────────────────────────
-- p_subject / p_body / p_render_vars are the template already filled in by the
-- browser, with {{confirm_link}} left in place: this function makes the token
-- and puts the link there, so the e-mail and the request are written together
-- or not at all. p_seen: { "<unit_id>": { "status", "responded_at" } } for
-- each ticked unit, as the pop-up showed it.
--
-- Returns { sent: true, request_id, token, link, outbox_id, units, to, cc,
-- earlier_link, cancelled_earlier }, or { sent: false, already_answered:
-- [{ unit_id, unit_no, status, responded_by_name, responded_by_email,
-- responded_at, dispute_notes }] } when a ticked unit is confirmed or
-- accepted, or was answered (a dispute included) after the pop-up read it:
-- nothing is written then. The browser drops confirmed and accepted units and
-- sends again; it stops and shows a dispute.
DROP FUNCTION IF EXISTS public.builder_bu_confirm_request_send(uuid, uuid[], text[], text[], uuid, text, text, text, jsonb);
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_request_send(
  p_bu_event_id uuid,
  p_unit_ids    uuid[],
  p_to          text[],
  p_cc          text[],
  p_actor_id    uuid,
  p_link_base   text,
  p_subject     text,
  p_body        text,
  p_render_vars jsonb,
  p_seen        jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_to        text[] := public.builder_bu_confirm_email_list(p_to);
  v_cc        text[] := public.builder_bu_confirm_email_list(p_cc);
  v_units     uuid[];
  v_bad       text;
  v_client    uuid;
  v_status    text;
  v_req       public.builder_bu_confirm_requests;
  v_link      text;
  v_outbox    uuid;
  v_answered  jsonb;
  v_earlier   boolean;
  v_cancelled integer := 0;
  v_base      text := rtrim(btrim(COALESCE(p_link_base, '')), '/');
BEGIN
  IF NOT public.builder_bu_confirm_may_send(p_actor_id) THEN
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
    RAISE EXCEPTION 'Add at least one address outside the firm. These are the firm''s own and cannot answer: %.',
      array_to_string(v_to || v_cc, ', ')
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

  -- Confirmed or accepted, or answered since the pop-up read it.
  v_answered := public.builder_bu_confirm_changed(p_bu_event_id, v_units, p_seen);
  IF v_answered IS NOT NULL THEN
    RETURN jsonb_build_object('sent', false, 'already_answered', v_answered);
  END IF;

  -- Did a link to any of these units reach someone already? A request that is
  -- out, or a per-unit e-mail of before 21 Oct 2026 that was sent. While
  -- this e-mail is not out, that link still takes answers.
  v_earlier := EXISTS (
    SELECT 1
      FROM public.builder_bu_agreement_confirmations c
     WHERE c.bu_event_id = p_bu_event_id AND c.unit_id = ANY (v_units)
       AND c.status IN ('PENDING', 'DISPUTED')
       AND (EXISTS (SELECT 1 FROM public.builder_bu_confirm_requests r
                     WHERE r.bu_event_id = p_bu_event_id AND c.unit_id = ANY (r.unit_ids)
                       AND public.builder_bu_confirm_request_out(r.id))
            OR (c.request_id IS NULL
                AND EXISTS (SELECT 1 FROM public.email_outbox o WHERE o.id = c.outbox_id AND o.status = 'sent'))));

  BEGIN
    INSERT INTO public.builder_bu_confirm_requests
      (bu_event_id, client_id, to_emails, cc_emails, unit_ids, earlier_link, created_by)
    VALUES (p_bu_event_id, v_client, v_to, v_cc, v_units, v_earlier, p_actor_id)
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

    -- A dispute asked about again is kept: who gave it, why, when, at what
    -- value, and the request that asks again.
    INSERT INTO public.builder_bu_confirm_answer_history
      (bu_event_id, unit_id, request_id, status, agreement_value, dispute_notes,
       responded_by_name, responded_by_email, responded_at, cleared_by, cleared_by_request)
    SELECT c.bu_event_id, c.unit_id, c.request_id, c.status, c.agreement_value_at_request, c.dispute_notes,
           c.responded_by_name, c.responded_by_email, c.responded_at, p_actor_id, v_req.id
      FROM public.builder_bu_agreement_confirmations c
     WHERE c.bu_event_id = p_bu_event_id AND c.unit_id = ANY (v_units) AND c.status = 'DISPUTED';

    -- Each unit now waits on this request; the earlier answer (a dispute,
    -- kept above) is cleared.
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

    -- An earlier request whose e-mail is still waiting in the outbox, and
    -- that asks nothing this one does not (or that is not answered), would
    -- reach the client later with a dead link: it is not sent.
    UPDATE public.email_outbox o
       SET status = 'cancelled',
           error = 'Replaced by a newer confirmation request before it was sent.'
      FROM public.builder_bu_confirm_requests r
     WHERE r.bu_event_id = p_bu_event_id AND r.id <> v_req.id
       AND o.id = r.outbox_id AND o.status = 'pending'
       AND NOT EXISTS (
         SELECT 1 FROM unnest(r.unit_ids) x
          WHERE NOT (x = ANY (v_units))
            AND NOT EXISTS (SELECT 1 FROM public.builder_bu_agreement_confirmations c
                             WHERE c.bu_event_id = p_bu_event_id AND c.unit_id = x
                               AND c.status IN ('CONFIRMED', 'OVERRIDDEN')));
    GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  EXCEPTION WHEN SQLSTATE 'BUC01' THEN
    RETURN jsonb_build_object('sent', false, 'already_answered',
      COALESCE(public.builder_bu_confirm_changed(p_bu_event_id, v_units, p_seen), '[]'::jsonb));
  END;

  RETURN jsonb_build_object(
    'sent', true,
    'request_id', v_req.id,
    'token', v_req.token,
    'link', v_link,
    'outbox_id', v_outbox,
    'units', cardinality(v_units),
    'to', to_jsonb(v_to),
    'cc', to_jsonb(v_cc),
    'earlier_link', v_earlier,
    'cancelled_earlier', v_cancelled);
END;
$$;

-- ── 9. The public page ──────────────────────────────────────────────────────
-- "rajesh@client.com" → "r…h@client.com": the page shows who answered to
-- anyone holding the link, without the whole address.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_mask(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p IS NULL OR position('@' IN p) = 0 THEN NULL
    WHEN length(split_part(p, '@', 1)) <= 2 THEN left(p, 1) || '…@' || split_part(p, '@', 2)
    ELSE left(p, 1) || '…' || right(split_part(p, '@', 1), 1) || '@' || split_part(p, '@', 2)
  END;
$$;

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
    'responded_by_email', CASE WHEN s.state IN ('CONFIRMED', 'DISPUTED') THEN public.builder_bu_confirm_mask(c.responded_by_email) END,
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
  l       record;
  v_cf    public.builder_bu_agreement_confirmations;
  v_units jsonb;
  v_sent  timestamptz;
BEGIN
  SELECT * INTO l FROM public.builder_bu_confirm_link(_token);
  IF l.o_event IS NULL THEN RETURN NULL; END IF;

  IF l.o_req IS NOT NULL THEN
    SELECT r.sent_at INTO v_sent FROM public.builder_bu_confirm_requests r WHERE r.id = l.o_req;
    SELECT jsonb_agg(public.builder_bu_confirm_unit_json(c, l.o_req) ORDER BY u.sort_order, u.unit_no)
      INTO v_units
      FROM public.builder_bu_agreement_confirmations c
      JOIN public.builder_units u ON u.id = c.unit_id
     WHERE c.bu_event_id = l.o_event AND c.unit_id = ANY (l.o_units);
  ELSE
    SELECT * INTO v_cf FROM public.builder_bu_agreement_confirmations c WHERE c.id = l.o_cf;
    v_sent := v_cf.sent_at;
    v_units := jsonb_build_array(public.builder_bu_confirm_unit_json(v_cf, NULL));
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'kind', CASE WHEN l.o_req IS NOT NULL THEN 'request' ELSE 'unit' END,
      'project_name', p.name,
      'bu_date', ev.bu_date,
      'sent_at', v_sent,
      'units', COALESCE(v_units, '[]'::jsonb))
      FROM public.builder_bu_events ev
      JOIN public.builder_projects p ON p.id = ev.project_id
     WHERE ev.id = l.o_event);
END;
$$;

-- The reader asks for a code: their address must be one the e-mail went to,
-- outside the firm. Limits (per link, in one queue so two requests count each
-- other): 5 codes an hour and 10 a day to one address, 20 an hour on a link.
-- Returns { ok, code_id, email }; the page then calls the Edge Function
-- bu-confirm-code with code_id, which e-mails it.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_code_request(_token text, _email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(COALESCE(_email, '')));
  l       record;
  v_id    uuid;
BEGIN
  IF NOT public.builder_bu_confirm_email_ok(v_email) THEN
    RAISE EXCEPTION 'Please give a valid e-mail address.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO l FROM public.builder_bu_confirm_link(_token);
  IF l.o_event IS NULL THEN
    RAISE EXCEPTION 'This link is not valid.' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM public.builder_bu_confirm_check_answerer(l.o_allowed, v_email);

  PERFORM pg_advisory_xact_lock(hashtextextended('bu_confirm_code:' || COALESCE(l.o_req, l.o_cf)::text, 0));
  IF (SELECT count(*) FROM public.builder_bu_confirm_codes k
       WHERE (k.request_id = l.o_req OR k.confirmation_id = l.o_cf) AND k.email = v_email
         AND k.created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'We have sent 10 codes to this address today. Please try again tomorrow, or write to us at gst@vjdesai.com.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM public.builder_bu_confirm_codes k
       WHERE (k.request_id = l.o_req OR k.confirmation_id = l.o_cf) AND k.email = v_email
         AND k.created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'We have sent 5 codes to this address in the last hour. Please use the latest one, or try again later.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM public.builder_bu_confirm_codes k
       WHERE (k.request_id = l.o_req OR k.confirmation_id = l.o_cf)
         AND k.created_at > now() - interval '1 hour') >= 20 THEN
    RAISE EXCEPTION 'Too many codes were asked for on this link in the last hour. Please try again later.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.builder_bu_confirm_codes (request_id, confirmation_id, email, requested_ip)
  VALUES (l.o_req, l.o_cf, v_email, public.builder_bu_confirm_request_ip())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'code_id', v_id, 'email', v_email);
END;
$$;

-- The mailer (service role only) claims one waiting code: mints it here,
-- keeps only its hash, and hands it to the Edge Function with what the
-- e-mail says. A code not claimed within 15 minutes is not sent.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_code_claim(p_code_id uuid)
RETURNS TABLE (code_id uuid, code text, to_email text, project_name text, client_name text,
               gstin text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_id   uuid;
  v_b    bytea;
  v_code text;
BEGIN
  SELECT k.id INTO v_id
    FROM public.builder_bu_confirm_codes k
   WHERE k.id = p_code_id AND k.claimed_at IS NULL AND k.created_at > now() - interval '15 minutes'
     FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN RETURN; END IF;
  v_b := extensions.gen_random_bytes(4);
  v_code := lpad(((get_byte(v_b, 0)::bigint * 16777216 + get_byte(v_b, 1) * 65536
                   + get_byte(v_b, 2) * 256 + get_byte(v_b, 3)) % 1000000)::text, 6, '0');
  UPDATE public.builder_bu_confirm_codes k
     SET code_hash = encode(extensions.digest(v_id::text || ':' || v_code, 'sha256'), 'hex'),
         claimed_at = now(),
         expires_at = now() + interval '30 minutes'
   WHERE k.id = v_id;
  RETURN QUERY
    SELECT k.id, v_code, k.email, p.name, cl.name, cl.gstin, k.expires_at
      FROM public.builder_bu_confirm_codes k
      LEFT JOIN public.builder_bu_confirm_requests r ON r.id = k.request_id
      LEFT JOIN public.builder_bu_agreement_confirmations c ON c.id = k.confirmation_id
      JOIN public.builder_bu_events ev ON ev.id = COALESCE(r.bu_event_id, c.bu_event_id)
      JOIN public.builder_projects p ON p.id = ev.project_id
      JOIN public.clients cl ON cl.id = p.client_id
     WHERE k.id = v_id;
END;
$$;

-- The mailer reports back: sent, or failed (the code then never verifies).
-- The first report stands.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_code_mark(p_code_id uuid, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.builder_bu_confirm_codes
     SET sent_at = CASE WHEN p_error IS NULL THEN now() END,
         send_error = left(p_error, 500)
   WHERE id = p_code_id AND claimed_at IS NOT NULL AND sent_at IS NULL AND send_error IS NULL;
$$;

-- The reader types the code. Only the latest code to that address on that
-- link counts; 5 wrong tries end a code, 10 wrong tries a day end the
-- address's codes on that link until the next day. Never raises for a wrong
-- code (the count must stay): returns { ok: false, message } or { ok: true,
-- proof, email }. The proof goes with every answer for 2 hours.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_code_verify(_token text, _email text, _code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(COALESCE(_email, '')));
  v_code  text := regexp_replace(COALESCE(_code, ''), '[[:space:]-]', '', 'g');
  l       record;
  k       public.builder_bu_confirm_codes;
  v_proof text;
  v_no    CONSTANT jsonb := jsonb_build_object('ok', false);
BEGIN
  SELECT * INTO l FROM public.builder_bu_confirm_link(_token);
  IF l.o_event IS NULL THEN
    RETURN v_no || jsonb_build_object('message', 'This link is not valid.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bu_confirm_code:' || COALESCE(l.o_req, l.o_cf)::text, 0));

  IF (SELECT COALESCE(sum(c2.wrong_tries), 0) FROM public.builder_bu_confirm_codes c2
       WHERE (c2.request_id = l.o_req OR c2.confirmation_id = l.o_cf) AND c2.email = v_email
         AND c2.created_at > now() - interval '24 hours') >= 10 THEN
    RETURN v_no || jsonb_build_object('message',
      'Too many wrong codes for this address today. Please try again tomorrow, or write to us at gst@vjdesai.com.');
  END IF;

  SELECT * INTO k FROM public.builder_bu_confirm_codes c2
   WHERE (c2.request_id = l.o_req OR c2.confirmation_id = l.o_cf) AND c2.email = v_email
   ORDER BY c2.seq DESC
   LIMIT 1
     FOR UPDATE;
  IF NOT FOUND OR k.claimed_at IS NULL THEN
    RETURN v_no || jsonb_build_object('message', 'Please ask for a code first, then type it here.');
  END IF;
  IF k.send_error IS NOT NULL THEN
    RETURN v_no || jsonb_build_object('message', 'We could not e-mail that code. Please ask for a new one.');
  END IF;
  IF k.expires_at <= now() THEN
    RETURN v_no || jsonb_build_object('message', 'This code has expired. Please ask for a new one.');
  END IF;
  IF k.wrong_tries >= 5 THEN
    RETURN v_no || jsonb_build_object('message', 'Too many wrong tries for this code. Please ask for a new one.');
  END IF;
  IF v_code !~ '^[0-9]{6}$' THEN
    RETURN v_no || jsonb_build_object('message', 'The code is the 6 digits in our latest e-mail.');
  END IF;
  IF k.code_hash IS DISTINCT FROM encode(extensions.digest(k.id::text || ':' || v_code, 'sha256'), 'hex') THEN
    UPDATE public.builder_bu_confirm_codes SET wrong_tries = wrong_tries + 1 WHERE id = k.id;
    RETURN v_no || jsonb_build_object('message', 'That code is not right. Please check the latest e-mail from us.');
  END IF;

  v_proof := encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE public.builder_bu_confirm_codes
     SET proof_hash = encode(extensions.digest(v_proof, 'sha256'), 'hex'),
         verified_at = now()
   WHERE id = k.id;
  RETURN jsonb_build_object('ok', true, 'proof', v_proof, 'email', v_email);
END;
$$;

-- _answers: [{ "unit_id": uuid, "action": "CONFIRM" | "DISPUTE", "notes": text }]
-- Returns one { unit_id, unit_no, result } per answer; result is CONFIRMED or
-- DISPUTED when recorded, else REPLACED or ALREADY_<state> (someone answered
-- first, or the firm accepted it). Bad input records nothing. _email must be
-- one the e-mail was sent to, not the firm's own, and proved: _proof is what
-- builder_bu_confirm_code_verify gave for that address on this link.
DROP FUNCTION IF EXISTS public.builder_bu_confirm_respond(text, jsonb, text, text);
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_respond(
  _token text, _answers jsonb, _name text, _email text, _proof text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name    text := btrim(regexp_replace(COALESCE(_name, ''), '[[:space:]]+', ' ', 'g'));
  v_email   text := lower(btrim(COALESCE(_email, '')));
  l         record;
  a         jsonb;
  v_unit    uuid;
  v_action  text;
  v_notes   text;
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
    IF v_action = 'DISPUTE' AND v_notes = '' THEN
      SELECT unit_no INTO v_unit_no FROM public.builder_units WHERE id = v_unit;
      RAISE EXCEPTION 'Please say what has changed for unit %.', v_unit_no USING ERRCODE = 'check_violation';
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

  FOR a IN SELECT value FROM jsonb_array_elements(_answers) LOOP
    v_unit := (a ->> 'unit_id')::uuid;
    v_action := upper(a ->> 'action');
    v_notes := NULLIF(btrim(COALESCE(a ->> 'notes', '')), '');

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

-- ── 10. The per-unit answer function of the e-mails sent before this change ─
-- Closed: a per-unit link is answered on the new page, with the same checks as
-- a request (an address the e-mail went to, proved by a code; a note with a
-- dispute). The function now refuses, and the public key cannot call it or
-- the old lookup.
CREATE OR REPLACE FUNCTION public.builder_bu_agreement_confirm(_token text, _action text, _notes text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Please open the link in our e-mail again: answers are now given on the confirmation page.'
    USING ERRCODE = 'feature_not_supported';
END;
$$;
REVOKE ALL ON FUNCTION public.builder_bu_agreement_confirm(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_agreement_confirmation_lookup(text) FROM PUBLIC, anon, authenticated;

-- ── 11. Grants ──────────────────────────────────────────────────────────────
-- The page's functions, the send and the firm-address check are called with
-- the public key; the claim and the report only by the Edge Function (service
-- role); the helpers only through the others (Supabase grants new functions
-- to anon and authenticated by default, hence the explicit revokes).
REVOKE ALL ON FUNCTION public.builder_bu_confirm_request_send(uuid, uuid[], text[], text[], uuid, text, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_firm_addresses(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_code_request(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_code_verify(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_respond(text, jsonb, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_code_claim(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_code_mark(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_unit_json(public.builder_bu_agreement_confirmations, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_state(public.builder_bu_agreement_confirmations, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_is_staff(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_may_send(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_request_out(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_seen_same(jsonb, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_changed(uuid, uuid[], jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_link(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_check_answerer(text[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_request_ip() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_request_send(uuid, uuid[], text[], text[], uuid, text, text, text, jsonb, jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_firm_addresses(uuid, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_lookup(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_code_request(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_code_verify(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_respond(text, jsonb, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_code_claim(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_code_mark(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_email_ok(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_email_list(text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_addresses(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_mask(text) TO anon, authenticated, service_role;

COMMIT;
