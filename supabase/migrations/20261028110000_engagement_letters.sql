-- Engagement letters e-signed by the client (the firm's request of 28 October
-- 2026): "In Reply Factory → Client Consent, an Engagement Letter template which
-- I can send directly to a client by e-mail; the client opens it from the
-- e-mail and gives consent by e-signature. Check the DPDP Act, which applies to
-- CAs in India, and keep every relevant clause. The e-mail opens a one page
-- summary; only a link inside it opens the entire letter, so the one pager
-- refers to the detailed letter. Once the client e-signs, the portal records
-- everything." Read docs/ENGAGEMENT_LETTERS.md first.
--
-- How it fits together:
--   * engagement_letter_templates: the letter in versions (title, intro,
--     clauses with a one line summary each, the firm's details). Version 1 is
--     seeded here as a DRAFT: a GST Manager or the superadmin reads it, fills
--     the firm's details (FRN, address, the partner, the grievance officer)
--     and publishes it (engagement_letter_template_publish) before anything is
--     sent. One version is published at a time.
--   * engagement_letters: one letter per client per send, its text rendered
--     and fixed when it is made (engagement_letter_create), with the SHA-256
--     of that text (doc_sha256), so what was signed is provable.
--   * The link's token is minted by the Edge Function engagement-letter, which
--     stores only its hash (engagement_letter_tokens, private) and e-mails the
--     link through Microsoft Graph: never through email_outbox, which the
--     public key can read. The same holds for the 6 digit code that signs
--     (engagement_letter_codes, private, only its hash).
--   * The public page /engagement/<token> reads the letter
--     (engagement_letter_view), asks for a code (engagement_letter_code_request),
--     signs (engagement_letter_sign: only after the full letter was opened,
--     with the code, the signer's name and capacity, the two required consents
--     and an explicit yes or no to AI tools), may ask for changes
--     (engagement_letter_decline) and withdraw the AI consent later
--     (engagement_letter_withdraw_ai, with a code: as easy as giving it,
--     DPDP s.6(4)).
--   * Every step is an event with the caller's IP and browser
--     (engagement_letter_events, private); the drawn signature lives apart
--     (engagement_letter_signatures, private). Staff read both through
--     engagement_letter_audit (a staff member only).
--   * Signing records the consent on the client: AI tools yes = ai_consent_at
--     (the day signed) and the letter in ai_consent_note; no = ai_opt_out.
-- Tables the app lists are open to read (CLAUDE.md: no Supabase session);
-- every write goes through these functions (no write policy).

BEGIN;

-- ── Templates ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.engagement_letter_templates (
  version       int PRIMARY KEY,
  title         text NOT NULL,
  intro         text NOT NULL DEFAULT '',
  -- [{key, heading, summary, text}]: summary is the clause's line on the one page summary.
  clauses       jsonb NOT NULL,
  -- name, frn, address, email, phone, partner_name, partner_membership_no, grievance_name, grievance_email, city
  firm          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  published_at  timestamptz,
  published_by  text,
  CONSTRAINT engagement_letter_templates_clauses_array CHECK (jsonb_typeof(clauses) = 'array')
);
CREATE UNIQUE INDEX IF NOT EXISTS engagement_letter_templates_one_published
  ON public.engagement_letter_templates ((true)) WHERE status = 'published';

-- ── Letters ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.engagement_letters (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A deleted client keeps its signed letter: the name and GSTIN are kept here.
  client_id        uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name      text NOT NULL,
  client_gstin     text,
  template_version int NOT NULL REFERENCES public.engagement_letter_templates(version),
  to_email         text NOT NULL,
  cc_email         text,
  vars             jsonb NOT NULL DEFAULT '{}'::jsonb,
  title            text NOT NULL,
  intro            text NOT NULL,
  clauses          jsonb NOT NULL,
  firm             jsonb NOT NULL,
  doc_sha256       text NOT NULL,
  -- ready: made, not e-mailed yet; sent: its link is out; signed; revoked (withdrawn by the firm).
  status           text NOT NULL DEFAULT 'ready'
                   CHECK (status IN ('ready', 'sent', 'signed', 'revoked')),
  -- An e-mail of the link is due (made, or a resend asked); a failed one leaves the status as it was.
  send_pending     boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by_id    uuid,
  created_by_name  text,
  sent_at          timestamptz,
  sends            int NOT NULL DEFAULT 0,
  send_error       text,
  expires_at       timestamptz NOT NULL,
  first_opened_at  timestamptz,
  full_opened_at   timestamptz,
  signed_at        timestamptz,
  signer_name      text,
  signer_capacity  text,
  signer_email     text,
  consents         jsonb,
  decline_reason   text,
  declined_at      timestamptz,
  ai_withdrawn_at  timestamptz,
  revoked_at       timestamptz,
  revoked_by       text,
  revoke_reason    text,
  copy_sent_at     timestamptz,
  copy_error       text
);
CREATE INDEX IF NOT EXISTS engagement_letters_client ON public.engagement_letters (client_id, created_at DESC);

-- Private: the link's token (hash only), the codes (hash only), the audit trail and the drawn signature.
-- token_hash opens the letter; pending_hash is the next link's, which replaces it only once its e-mail is out;
-- view_hash is the signed copy's link (it opens the signed letter, and is where the AI consent is withdrawn).
CREATE TABLE IF NOT EXISTS public.engagement_letter_tokens (
  letter_id     uuid PRIMARY KEY REFERENCES public.engagement_letters(id) ON DELETE CASCADE,
  token_hash    text UNIQUE,
  pending_hash  text UNIQUE,
  issued_at     timestamptz
);
ALTER TABLE public.engagement_letter_tokens ADD COLUMN IF NOT EXISTS view_hash text UNIQUE;
CREATE TABLE IF NOT EXISTS public.engagement_letter_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id     uuid NOT NULL REFERENCES public.engagement_letters(id) ON DELETE CASCADE,
  purpose       text NOT NULL CHECK (purpose IN ('sign', 'withdraw')),
  to_email      text NOT NULL,
  requested_ip  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  claimed_at    timestamptz,
  code_hash     text,
  expires_at    timestamptz,
  sent_at       timestamptz,
  send_error    text,
  attempts      int NOT NULL DEFAULT 0,
  used_at       timestamptz
);
CREATE INDEX IF NOT EXISTS engagement_letter_codes_letter ON public.engagement_letter_codes (letter_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.engagement_letter_events (
  id         bigserial PRIMARY KEY,
  letter_id  uuid NOT NULL REFERENCES public.engagement_letters(id) ON DELETE CASCADE,
  at         timestamptz NOT NULL DEFAULT now(),
  kind       text NOT NULL,
  actor      text,
  ip         text,
  user_agent text,
  detail     jsonb
);
CREATE INDEX IF NOT EXISTS engagement_letter_events_letter ON public.engagement_letter_events (letter_id, at);
CREATE TABLE IF NOT EXISTS public.engagement_letter_signatures (
  letter_id   uuid PRIMARY KEY REFERENCES public.engagement_letters(id) ON DELETE CASCADE,
  typed_name  text NOT NULL,
  drawn_png   text,
  ip          text,
  user_agent  text,
  code_id     uuid,
  signed_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.engagement_letter_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_letter_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_letter_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_letter_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_letter_signatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS engagement_letter_templates_read ON public.engagement_letter_templates;
CREATE POLICY engagement_letter_templates_read ON public.engagement_letter_templates FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS engagement_letters_read ON public.engagement_letters;
CREATE POLICY engagement_letters_read ON public.engagement_letters FOR SELECT TO public USING (true);
-- tokens, codes, events and signatures: RLS on and no policy (reached only by the functions below).

-- ── Helpers ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.engagement_letter_caller()
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE h json;
BEGIN
  h := NULLIF(current_setting('request.headers', true), '')::json;
  RETURN jsonb_build_object(
    'ip', left(COALESCE(NULLIF(btrim(h ->> 'cf-connecting-ip'), ''), NULLIF(btrim(h ->> 'x-real-ip'), ''),
                        NULLIF(btrim(split_part(COALESCE(h ->> 'x-forwarded-for', ''), ',', 1)), '')), 64),
    'ua', left(NULLIF(btrim(h ->> 'user-agent'), ''), 400));
EXCEPTION WHEN others THEN
  RETURN '{}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.engagement_letter_log(p_letter_id uuid, p_kind text, p_detail jsonb DEFAULT NULL, p_actor text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c jsonb := public.engagement_letter_caller();
BEGIN
  INSERT INTO public.engagement_letter_events (letter_id, kind, actor, ip, user_agent, detail)
  VALUES (p_letter_id, p_kind, left(p_actor, 120), c ->> 'ip', c ->> 'ua', p_detail);
END;
$$;

-- '{{client_name}}' and the like, replaced by the letter's values (unknown ones left as they are).
CREATE OR REPLACE FUNCTION public.engagement_letter_fill(p_text text, p_vars jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE t text := COALESCE(p_text, ''); k text; v text;
BEGIN
  FOR k, v IN SELECT key, value FROM jsonb_each_text(COALESCE(p_vars, '{}'::jsonb)) LOOP
    t := replace(t, '{{' || k || '}}', COALESCE(v, ''));
  END LOOP;
  RETURN t;
END;
$$;

-- The letter as one text, the way it is hashed (and printed): title, intro, then each clause numbered.
CREATE OR REPLACE FUNCTION public.engagement_letter_doc_text(p_title text, p_intro text, p_clauses jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT concat_ws(E'\n\n', p_title, p_intro,
    (SELECT string_agg(n::text || '. ' || (c ->> 'heading') || E'\n' || (c ->> 'text'), E'\n\n' ORDER BY n)
       FROM jsonb_array_elements(COALESCE(p_clauses, '[]'::jsonb)) WITH ORDINALITY e(c, n)))
$$;

CREATE OR REPLACE FUNCTION public.engagement_letter_hash(p_token text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions AS $$
  SELECT encode(extensions.digest(convert_to(COALESCE(p_token, ''), 'UTF8'), 'sha256'), 'hex')
$$;

-- "ab***@example.com": enough for the reader to know where the code goes.
CREATE OR REPLACE FUNCTION public.engagement_letter_mask(p_email text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN position('@' IN COALESCE(p_email, '')) > 1
              THEN left(split_part(p_email, '@', 1), 2) || '***@' || split_part(p_email, '@', 2) ELSE '' END
$$;

CREATE OR REPLACE FUNCTION public.engagement_letter_email_ok(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(btrim(p), '') ~ '^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$'
$$;

-- A letter from its link: the token's hash names it.
CREATE OR REPLACE FUNCTION public.engagement_letter_by_token(p_token text)
RETURNS public.engagement_letters LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.* FROM public.engagement_letter_tokens t JOIN public.engagement_letters l ON l.id = t.letter_id
   WHERE length(COALESCE(p_token, '')) >= 32
     AND (t.token_hash = public.engagement_letter_hash(p_token) OR t.view_hash = public.engagement_letter_hash(p_token))
$$;

-- What a letter's page and list show as its state (an unsigned letter past its date has expired).
CREATE OR REPLACE FUNCTION public.engagement_letter_state(l public.engagement_letters)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN l.status IN ('signed', 'revoked') THEN l.status
              WHEN l.status = 'sent' AND l.expires_at < now() THEN 'expired'
              ELSE l.status END
$$;

-- ── The template: save a draft, publish it ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.engagement_letter_template_save(
  p_version int, p_title text, p_intro text, p_clauses jsonb, p_firm jsonb, p_note text, p_actor_id uuid, p_actor_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.engagement_letter_templates; n int;
BEGIN
  IF NOT public.notice_case_admin(p_actor_id) THEN
    RETURN jsonb_build_object('error', 'Only a GST Manager or the superadmin can change the engagement letter.');
  END IF;
  IF jsonb_typeof(p_clauses) IS DISTINCT FROM 'array' OR jsonb_array_length(p_clauses) = 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_clauses) c
                 WHERE btrim(COALESCE(c ->> 'heading', '')) = '' OR btrim(COALESCE(c ->> 'text', '')) = '') THEN
    RETURN jsonb_build_object('error', 'Every clause needs a heading and its text.');
  END IF;
  IF btrim(COALESCE(p_title, '')) = '' THEN RETURN jsonb_build_object('error', 'Give the letter a title.'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('engagement_letter_templates'));
  SELECT * INTO v FROM public.engagement_letter_templates WHERE version = p_version;
  IF v.version IS NULL OR v.status <> 'draft' THEN
    -- A published or retired version is never changed: the save starts the next version as a draft.
    SELECT COALESCE(max(version), 0) + 1 INTO n FROM public.engagement_letter_templates;
    INSERT INTO public.engagement_letter_templates (version, title, intro, clauses, firm, status, note, created_by, updated_by)
    VALUES (n, btrim(p_title), COALESCE(p_intro, ''), p_clauses, COALESCE(p_firm, '{}'::jsonb), 'draft', p_note,
            left(p_actor_name, 120), left(p_actor_name, 120));
    RETURN jsonb_build_object('version', n, 'new', true);
  END IF;
  UPDATE public.engagement_letter_templates
     SET title = btrim(p_title), intro = COALESCE(p_intro, ''), clauses = p_clauses, firm = COALESCE(p_firm, '{}'::jsonb),
         note = p_note, updated_at = now(), updated_by = left(p_actor_name, 120)
   WHERE version = v.version;
  RETURN jsonb_build_object('version', v.version, 'new', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.engagement_letter_template_publish(p_version int, p_actor_id uuid, p_actor_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.engagement_letter_templates; missing text[];
BEGIN
  IF NOT public.notice_case_admin(p_actor_id) THEN
    RETURN jsonb_build_object('error', 'Only a GST Manager or the superadmin can publish the engagement letter.');
  END IF;
  SELECT * INTO v FROM public.engagement_letter_templates WHERE version = p_version FOR UPDATE;
  IF v.version IS NULL THEN RETURN jsonb_build_object('error', 'No such version.'); END IF;
  IF v.status <> 'draft' THEN RETURN jsonb_build_object('error', 'Only a draft can be published.'); END IF;
  SELECT array_agg(k) INTO missing
    FROM unnest(ARRAY['name', 'frn', 'address', 'email', 'partner_name', 'partner_membership_no', 'grievance_name', 'grievance_email', 'city']) k
   WHERE btrim(COALESCE(v.firm ->> k, '')) = '';
  IF missing IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Fill the firm''s details first: ' || array_to_string(missing, ', ') || '.', 'missing', to_jsonb(missing));
  END IF;
  IF NOT public.engagement_letter_email_ok(v.firm ->> 'grievance_email') THEN
    RETURN jsonb_build_object('error', 'The grievance officer''s e-mail address is not valid.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('engagement_letter_templates'));
  UPDATE public.engagement_letter_templates SET status = 'retired' WHERE status = 'published';
  UPDATE public.engagement_letter_templates
     SET status = 'published', published_at = now(), published_by = left(p_actor_name, 120)
   WHERE version = v.version;
  RETURN jsonb_build_object('version', v.version, 'published', true);
END;
$$;

-- ── Staff make letters (one per client), resend, revoke ─────────────────────
-- p_to: the address for a single client (else each client's e-mail on file).
-- p_services: the services, one line each, as the send dialog lists them.
CREATE OR REPLACE FUNCTION public.engagement_letter_create(
  p_client_ids uuid[], p_to text, p_cc text, p_services text[], p_fees text, p_start_date date,
  p_valid_days int, p_message text, p_replace boolean, p_actor_id uuid, p_actor_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t       public.engagement_letter_templates;
  c       record;
  v_to    text;
  v_vars  jsonb;
  v_title text; v_intro text; v_clauses jsonb; v_id uuid;
  made    jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
  v_days  int := LEAST(GREATEST(COALESCE(p_valid_days, 30), 3), 90);
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_serv  text;
BEGIN
  IF NOT public.notice_case_admin(p_actor_id) THEN
    RETURN jsonb_build_object('error', 'Only a GST Manager or the superadmin can send engagement letters.');
  END IF;
  SELECT * INTO t FROM public.engagement_letter_templates WHERE status = 'published';
  IF t.version IS NULL THEN
    RETURN jsonb_build_object('error', 'No engagement letter is published yet: a GST Manager or the superadmin reads the draft, fills the firm''s details and publishes it.');
  END IF;
  IF COALESCE(array_length(p_client_ids, 1), 0) = 0 THEN RETURN jsonb_build_object('error', 'Choose a client.'); END IF;
  IF array_length(p_client_ids, 1) > 1 AND NULLIF(btrim(COALESCE(p_to, '')), '') IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'A typed address is for one client; many clients each get their own address on file.');
  END IF;
  IF NULLIF(btrim(COALESCE(p_cc, '')), '') IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(p_cc, '\s*[,;]\s*')) a WHERE btrim(a) <> '' AND NOT public.engagement_letter_email_ok(a)) THEN
    RETURN jsonb_build_object('error', 'A CC address is not valid.');
  END IF;
  IF COALESCE(array_length(p_services, 1), 0) = 0 THEN RETURN jsonb_build_object('error', 'Choose the services.'); END IF;
  IF btrim(COALESCE(p_fees, '')) = '' THEN RETURN jsonb_build_object('error', 'Say the fees.'); END IF;
  IF (SELECT count(*) FROM public.engagement_letters WHERE created_at > now() - interval '1 day') + array_length(p_client_ids, 1) > 300 THEN
    RETURN jsonb_build_object('error', 'At most 300 letters a day.');
  END IF;
  SELECT string_agg('• ' || left(btrim(s), 300), E'\n') INTO v_serv FROM unnest(p_services[1:25]) s WHERE btrim(s) <> '';

  FOR c IN SELECT id, name, gstin, email FROM public.clients WHERE id = ANY (p_client_ids) ORDER BY name LOOP
    v_to := lower(btrim(COALESCE(NULLIF(btrim(COALESCE(p_to, '')), ''), c.email, '')));
    IF NOT public.engagement_letter_email_ok(v_to) THEN
      skipped := skipped || jsonb_build_object('client_id', c.id, 'name', c.name, 'why', 'no valid e-mail address on file');
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.engagement_letters l WHERE l.client_id = c.id AND l.status IN ('ready', 'sent') AND l.expires_at > now()) THEN
      IF NOT COALESCE(p_replace, false) THEN
        skipped := skipped || jsonb_build_object('client_id', c.id, 'name', c.name, 'why', 'a letter sent earlier is still open (send with "replace" to withdraw it)');
        CONTINUE;
      END IF;
      UPDATE public.engagement_letters l SET status = 'revoked', revoked_at = now(), revoked_by = left(p_actor_name, 120), revoke_reason = 'replaced by a newer letter'
       WHERE l.client_id = c.id AND l.status IN ('ready', 'sent');
    END IF;
    v_vars := COALESCE(t.firm, '{}'::jsonb) || jsonb_build_object(
      'firm_name', COALESCE(t.firm ->> 'name', ''), 'firm_frn', COALESCE(t.firm ->> 'frn', ''), 'firm_address', COALESCE(t.firm ->> 'address', ''),
      'firm_email', COALESCE(t.firm ->> 'email', ''), 'firm_phone', COALESCE(t.firm ->> 'phone', ''),
      'client_name', c.name, 'gstin', COALESCE(c.gstin, ''),
      'pan', CASE WHEN length(COALESCE(c.gstin, '')) = 15 THEN substr(c.gstin, 3, 10) ELSE '' END,
      'services', v_serv, 'fees', left(btrim(p_fees), 2000),
      'start_date', to_char(COALESCE(p_start_date, v_today), 'FMDD FMMonth YYYY'),
      'letter_date', to_char(v_today, 'FMDD FMMonth YYYY'));
    v_title := public.engagement_letter_fill(t.title, v_vars);
    v_intro := public.engagement_letter_fill(t.intro, v_vars);
    SELECT jsonb_agg(jsonb_build_object('key', COALESCE(x ->> 'key', 'c' || n), 'heading', public.engagement_letter_fill(x ->> 'heading', v_vars),
             'summary', public.engagement_letter_fill(x ->> 'summary', v_vars), 'text', public.engagement_letter_fill(x ->> 'text', v_vars)) ORDER BY n)
      INTO v_clauses FROM jsonb_array_elements(t.clauses) WITH ORDINALITY e(x, n);
    INSERT INTO public.engagement_letters (client_id, client_name, client_gstin, template_version, to_email, cc_email, vars, title, intro, clauses, firm,
                                           doc_sha256, status, created_by_id, created_by_name, expires_at)
    VALUES (c.id, c.name, c.gstin, t.version, v_to, NULLIF(btrim(COALESCE(p_cc, '')), ''),
            v_vars || jsonb_build_object('message', left(NULLIF(btrim(COALESCE(p_message, '')), ''), 2000), 'services_list', to_jsonb(p_services[1:25])),
            v_title, v_intro, v_clauses, t.firm,
            encode(extensions.digest(convert_to(public.engagement_letter_doc_text(v_title, v_intro, v_clauses), 'UTF8'), 'sha256'), 'hex'),
            'ready', p_actor_id, left(p_actor_name, 120), now() + make_interval(days => v_days))
    RETURNING id INTO v_id;
    PERFORM public.engagement_letter_log(v_id, 'created', jsonb_build_object('version', t.version, 'to', v_to, 'cc', NULLIF(btrim(COALESCE(p_cc, '')), '')), p_actor_name);
    made := made || jsonb_build_object('id', v_id, 'client_id', c.id, 'name', c.name, 'to', v_to);
  END LOOP;
  RETURN jsonb_build_object('letters', made, 'skipped', skipped, 'version', t.version);
END;
$$;

CREATE OR REPLACE FUNCTION public.engagement_letter_resend(p_letter_id uuid, p_valid_days int, p_actor_id uuid, p_actor_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.engagement_letters;
BEGIN
  IF NOT public.notice_case_admin(p_actor_id) THEN
    RETURN jsonb_build_object('error', 'Only a GST Manager or the superadmin can resend an engagement letter.');
  END IF;
  SELECT * INTO l FROM public.engagement_letters WHERE id = p_letter_id FOR UPDATE;
  IF l.id IS NULL THEN RETURN jsonb_build_object('error', 'No such letter.'); END IF;
  IF l.status IN ('signed', 'revoked') THEN RETURN jsonb_build_object('error', 'A signed or withdrawn letter is not sent again; send a new one.'); END IF;
  -- A new link replaces the earlier one once its e-mail is out (engagement_letter_mark_sent); till then the earlier one works.
  UPDATE public.engagement_letters
     SET send_pending = true, send_error = NULL,
         expires_at = GREATEST(expires_at, now() + make_interval(days => LEAST(GREATEST(COALESCE(p_valid_days, 30), 3), 90)))
   WHERE id = l.id;
  PERFORM public.engagement_letter_log(l.id, 'resend_asked', NULL, p_actor_name);
  RETURN jsonb_build_object('id', l.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.engagement_letter_revoke(p_letter_id uuid, p_reason text, p_actor_id uuid, p_actor_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.engagement_letters;
BEGIN
  IF NOT public.notice_case_admin(p_actor_id) THEN
    RETURN jsonb_build_object('error', 'Only a GST Manager or the superadmin can withdraw an engagement letter.');
  END IF;
  SELECT * INTO l FROM public.engagement_letters WHERE id = p_letter_id FOR UPDATE;
  IF l.id IS NULL THEN RETURN jsonb_build_object('error', 'No such letter.'); END IF;
  IF l.status IN ('signed', 'revoked') THEN RETURN jsonb_build_object('error', 'A signed or withdrawn letter stays as it is.'); END IF;
  UPDATE public.engagement_letters SET status = 'revoked', revoked_at = now(), revoked_by = left(p_actor_name, 120),
         revoke_reason = left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 500)
   WHERE id = l.id;
  PERFORM public.engagement_letter_log(l.id, 'revoked', jsonb_build_object('reason', p_reason), p_actor_name);
  RETURN jsonb_build_object('id', l.id);
END;
$$;

-- The audit trail of a letter, for staff: every event with its IP and browser, and the signature.
CREATE OR REPLACE FUNCTION public.engagement_letter_audit(p_letter_id uuid, p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_actor_id
                                         AND ur.role::text IN ('superadmin', 'gst_manager', 'employee')) THEN
    RAISE EXCEPTION 'Only a staff member can see an engagement letter''s record.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN jsonb_build_object(
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'actor', e.actor, 'ip', e.ip,
                                                            'user_agent', e.user_agent, 'detail', e.detail) ORDER BY e.at, e.id)
                          FROM public.engagement_letter_events e WHERE e.letter_id = p_letter_id), '[]'::jsonb),
    'signature', (SELECT jsonb_build_object('typed_name', s.typed_name, 'drawn_png', s.drawn_png, 'ip', s.ip,
                                            'user_agent', s.user_agent, 'code_id', s.code_id, 'signed_at', s.signed_at)
                    FROM public.engagement_letter_signatures s WHERE s.letter_id = p_letter_id),
    'codes', COALESCE((SELECT jsonb_agg(jsonb_build_object('purpose', k.purpose, 'created_at', k.created_at, 'sent_at', k.sent_at,
                                                           'send_error', k.send_error, 'attempts', k.attempts, 'used_at', k.used_at) ORDER BY k.created_at)
                         FROM public.engagement_letter_codes k WHERE k.letter_id = p_letter_id), '[]'::jsonb));
END;
$$;

-- ── The Edge Function (service role): mint the link, mark the e-mail ───────
-- The function mints the token and hands its hash; what to e-mail, and to whom, comes from here.
CREATE OR REPLACE FUNCTION public.engagement_letter_issue(p_letter_id uuid, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.engagement_letters;
BEGIN
  IF COALESCE(p_token_hash, '') !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO l FROM public.engagement_letters WHERE id = p_letter_id FOR UPDATE SKIP LOCKED;
  IF l.id IS NULL OR NOT l.send_pending OR l.status NOT IN ('ready', 'sent') OR l.expires_at < now() THEN RETURN NULL; END IF;
  INSERT INTO public.engagement_letter_tokens (letter_id, pending_hash) VALUES (l.id, p_token_hash)
  ON CONFLICT (letter_id) DO UPDATE SET pending_hash = EXCLUDED.pending_hash;
  -- One e-mail at a time: a second call while this one sends finds nothing pending.
  UPDATE public.engagement_letters SET send_pending = false WHERE id = l.id;
  RETURN jsonb_build_object('id', l.id, 'to', l.to_email, 'cc', l.cc_email, 'client_name', l.client_name, 'gstin', l.client_gstin,
    'title', l.title, 'version', l.template_version, 'firm', l.firm, 'expires_at', l.expires_at,
    'message', l.vars ->> 'message', 'resend', l.sends > 0,
    'summary', (SELECT jsonb_agg(jsonb_build_object('n', n, 'key', c ->> 'key', 'heading', c ->> 'heading', 'summary', c ->> 'summary') ORDER BY n)
                  FROM jsonb_array_elements(l.clauses) WITH ORDINALITY e(c, n)));
END;
$$;

CREATE OR REPLACE FUNCTION public.engagement_letter_mark_sent(p_letter_id uuid, p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_error IS NULL THEN
    -- The new link now opens the letter; an earlier link stops working.
    UPDATE public.engagement_letter_tokens SET token_hash = pending_hash, pending_hash = NULL, issued_at = now()
     WHERE letter_id = p_letter_id AND pending_hash IS NOT NULL;
    UPDATE public.engagement_letters
       SET status = CASE WHEN status = 'ready' THEN 'sent' ELSE status END, sent_at = now(), sends = sends + 1, send_error = NULL
     WHERE id = p_letter_id AND status IN ('ready', 'sent');
  ELSE
    -- The e-mail did not go: its link never opens anything, an earlier link keeps working.
    UPDATE public.engagement_letter_tokens SET pending_hash = NULL WHERE letter_id = p_letter_id;
    UPDATE public.engagement_letters SET send_error = left(p_error, 500) WHERE id = p_letter_id;
  END IF;
  PERFORM public.engagement_letter_log(p_letter_id, CASE WHEN p_error IS NULL THEN 'sent' ELSE 'send_failed' END,
                                       CASE WHEN p_error IS NULL THEN NULL ELSE jsonb_build_object('error', left(p_error, 300)) END, 'e-mail');
END;
$$;

-- ── The client's page (the public key, by the link's token) ─────────────────
-- p_part: 'summary' (the one page) or 'full' (the whole letter): each first open is recorded.
CREATE OR REPLACE FUNCTION public.engagement_letter_view(p_token text, p_part text DEFAULT 'summary')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.engagement_letters; c jsonb := public.engagement_letter_caller(); v_kind text;
BEGIN
  l := public.engagement_letter_by_token(p_token);
  IF l.id IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  v_kind := CASE WHEN p_part = 'full' THEN 'opened_full' ELSE 'opened_summary' END;
  -- One record of each kind of open per caller an hour: a reload is not a new event.
  IF NOT EXISTS (SELECT 1 FROM public.engagement_letter_events e WHERE e.letter_id = l.id AND e.kind = v_kind
                   AND e.ip IS NOT DISTINCT FROM c ->> 'ip' AND e.at > now() - interval '1 hour') THEN
    PERFORM public.engagement_letter_log(l.id, v_kind);
  END IF;
  UPDATE public.engagement_letters
     SET first_opened_at = COALESCE(first_opened_at, now()),
         full_opened_at = CASE WHEN p_part = 'full' THEN COALESCE(full_opened_at, now()) ELSE full_opened_at END
   WHERE id = l.id AND (first_opened_at IS NULL OR (p_part = 'full' AND full_opened_at IS NULL))
  RETURNING * INTO l;
  IF l.id IS NULL THEN l := public.engagement_letter_by_token(p_token); END IF;
  RETURN jsonb_build_object(
    'id', l.id, 'ref', upper(left(replace(l.id::text, '-', ''), 8)), 'state', public.engagement_letter_state(l),
    'client_name', l.client_name, 'gstin', l.client_gstin, 'title', l.title, 'intro', l.intro, 'clauses', l.clauses,
    'firm', l.firm, 'version', l.template_version, 'doc_sha256', l.doc_sha256, 'sent_at', l.sent_at, 'expires_at', l.expires_at,
    'to_masked', public.engagement_letter_mask(l.to_email), 'full_opened', l.full_opened_at IS NOT NULL,
    'signed_at', l.signed_at, 'signer_name', l.signer_name, 'signer_capacity', l.signer_capacity, 'consents', l.consents,
    'declined_at', l.declined_at, 'ai_withdrawn_at', l.ai_withdrawn_at, 'revoke_reason', l.revoke_reason);
END;
$$;

-- A code to sign (or to withdraw the AI consent), e-mailed to the letter's address by the Edge Function.
CREATE OR REPLACE FUNCTION public.engagement_letter_code_request(p_token text, p_purpose text DEFAULT 'sign')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.engagement_letters; c jsonb := public.engagement_letter_caller(); n record; v_id uuid; v_purpose text := COALESCE(p_purpose, 'sign');
BEGIN
  l := public.engagement_letter_by_token(p_token);
  IF l.id IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_purpose NOT IN ('sign', 'withdraw') THEN RETURN jsonb_build_object('error', 'bad_request'); END IF;
  IF v_purpose = 'sign' AND public.engagement_letter_state(l) <> 'sent' THEN
    RETURN jsonb_build_object('error', public.engagement_letter_state(l));
  END IF;
  IF v_purpose = 'withdraw' AND (l.status <> 'signed' OR COALESCE((l.consents ->> 'ai_processing')::boolean, false) = false) THEN
    RETURN jsonb_build_object('error', 'nothing_to_withdraw');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('engagement_letter_code:' || l.id::text, 0));
  SELECT count(*) FILTER (WHERE k.created_at > now() - interval '1 hour') AS hour,
         count(*) FILTER (WHERE k.created_at > now() - interval '1 day') AS day
    INTO n FROM public.engagement_letter_codes k WHERE k.letter_id = l.id;
  IF n.hour >= 5 OR n.day >= 10 THEN RETURN jsonb_build_object('error', 'too_many'); END IF;
  INSERT INTO public.engagement_letter_codes (letter_id, purpose, to_email, requested_ip)
  VALUES (l.id, v_purpose, l.to_email, c ->> 'ip') RETURNING id INTO v_id;
  PERFORM public.engagement_letter_log(l.id, 'code_asked', jsonb_build_object('purpose', v_purpose, 'code_id', v_id));
  RETURN jsonb_build_object('code_id', v_id, 'to_masked', public.engagement_letter_mask(l.to_email),
                            'ref', upper(translate(left(replace(v_id::text, '-', ''), 4), '0123456789abcdef', 'ABCDEFGHJKLMNPQR')));
END;
$$;

-- The Edge Function mints the code it e-mails (service role); only its hash is kept.
CREATE OR REPLACE FUNCTION public.engagement_letter_code_claim(p_code_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE k public.engagement_letter_codes; l public.engagement_letters; v_b bytea; v_code text;
BEGIN
  SELECT * INTO k FROM public.engagement_letter_codes
   WHERE id = p_code_id AND claimed_at IS NULL AND created_at > now() - interval '15 minutes' FOR UPDATE SKIP LOCKED;
  IF k.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO l FROM public.engagement_letters WHERE id = k.letter_id;
  v_b := extensions.gen_random_bytes(4);
  v_code := lpad(((get_byte(v_b, 0)::bigint * 16777216 + get_byte(v_b, 1) * 65536 + get_byte(v_b, 2) * 256 + get_byte(v_b, 3)) % 1000000)::text, 6, '0');
  UPDATE public.engagement_letter_codes
     SET code_hash = encode(extensions.digest(k.id::text || ':' || v_code, 'sha256'), 'hex'), claimed_at = now(), expires_at = now() + interval '30 minutes'
   WHERE id = k.id;
  RETURN jsonb_build_object('code_id', k.id, 'code', v_code, 'to', k.to_email, 'purpose', k.purpose, 'client_name', l.client_name,
    'gstin', l.client_gstin, 'title', l.title, 'firm', l.firm,
    'ref', upper(translate(left(replace(k.id::text, '-', ''), 4), '0123456789abcdef', 'ABCDEFGHJKLMNPQR')));
END;
$$;

CREATE OR REPLACE FUNCTION public.engagement_letter_code_mark(p_code_id uuid, p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_letter uuid;
BEGIN
  UPDATE public.engagement_letter_codes SET sent_at = CASE WHEN p_error IS NULL THEN now() END, send_error = left(p_error, 500)
   WHERE id = p_code_id RETURNING letter_id INTO v_letter;
  IF v_letter IS NOT NULL THEN
    PERFORM public.engagement_letter_log(v_letter, CASE WHEN p_error IS NULL THEN 'code_sent' ELSE 'code_failed' END,
                                         jsonb_build_object('code_id', p_code_id), 'e-mail');
  END IF;
END;
$$;

-- Checks a code typed on the page: spends it when right, counts a wrong try (5 at most).
CREATE OR REPLACE FUNCTION public.engagement_letter_code_check(p_letter_id uuid, p_code_id uuid, p_code text, p_purpose text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE k public.engagement_letter_codes;
BEGIN
  SELECT * INTO k FROM public.engagement_letter_codes WHERE id = p_code_id AND letter_id = p_letter_id AND purpose = p_purpose FOR UPDATE;
  IF k.id IS NULL OR k.code_hash IS NULL THEN RETURN 'no_code'; END IF;
  IF k.used_at IS NOT NULL THEN RETURN 'code_used'; END IF;
  IF k.expires_at < now() THEN RETURN 'code_expired'; END IF;
  IF k.attempts >= 5 THEN RETURN 'code_spent'; END IF;
  IF k.code_hash <> encode(extensions.digest(k.id::text || ':' || btrim(COALESCE(p_code, '')), 'sha256'), 'hex') THEN
    UPDATE public.engagement_letter_codes SET attempts = attempts + 1 WHERE id = k.id;
    RETURN 'wrong_code';
  END IF;
  UPDATE public.engagement_letter_codes SET used_at = now() WHERE id = k.id;
  RETURN 'ok';
END;
$$;

-- E-sign: only an open letter, its full text opened, the code right, the name, the two
-- required consents and a yes or no to AI tools. Records the consent on the client.
CREATE OR REPLACE FUNCTION public.engagement_letter_sign(
  p_token text, p_code_id uuid, p_code text, p_name text, p_capacity text, p_consents jsonb, p_signature text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.engagement_letters; c jsonb := public.engagement_letter_caller(); v_check text; v_ai boolean;
  v_name text := left(regexp_replace(btrim(COALESCE(p_name, '')), '\s+', ' ', 'g'), 120);
  v_cap text := left(btrim(COALESCE(p_capacity, '')), 80);
  v_day date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_ref text;
BEGIN
  l := public.engagement_letter_by_token(p_token);
  IF l.id IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT * INTO l FROM public.engagement_letters WHERE id = l.id FOR UPDATE;
  IF public.engagement_letter_state(l) <> 'sent' THEN RETURN jsonb_build_object('error', public.engagement_letter_state(l)); END IF;
  IF l.full_opened_at IS NULL THEN RETURN jsonb_build_object('error', 'read_full'); END IF;
  IF length(v_name) < 3 THEN RETURN jsonb_build_object('error', 'name'); END IF;
  IF v_cap = '' THEN RETURN jsonb_build_object('error', 'capacity'); END IF;
  IF (p_consents -> 'engagement') IS DISTINCT FROM 'true'::jsonb OR (p_consents -> 'data_processing') IS DISTINCT FROM 'true'::jsonb THEN
    RETURN jsonb_build_object('error', 'consents');
  END IF;
  IF jsonb_typeof(p_consents -> 'ai_processing') IS DISTINCT FROM 'boolean' THEN RETURN jsonb_build_object('error', 'ai_choice'); END IF;
  v_ai := (p_consents ->> 'ai_processing')::boolean;
  IF p_signature IS NOT NULL AND (length(p_signature) > 400000 OR p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$') THEN
    RETURN jsonb_build_object('error', 'signature');
  END IF;
  v_check := public.engagement_letter_code_check(l.id, p_code_id, p_code, 'sign');
  IF v_check <> 'ok' THEN
    PERFORM public.engagement_letter_log(l.id, 'sign_refused', jsonb_build_object('why', v_check, 'code_id', p_code_id));
    RETURN jsonb_build_object('error', v_check);
  END IF;
  v_ref := upper(left(replace(l.id::text, '-', ''), 8));
  UPDATE public.engagement_letters
     SET status = 'signed', signed_at = now(), signer_name = v_name, signer_capacity = v_cap, signer_email = l.to_email,
         consents = jsonb_build_object('engagement', true, 'data_processing', true, 'ai_processing', v_ai)
   WHERE id = l.id;
  INSERT INTO public.engagement_letter_signatures (letter_id, typed_name, drawn_png, ip, user_agent, code_id)
  VALUES (l.id, v_name, p_signature, c ->> 'ip', c ->> 'ua', p_code_id);
  PERFORM public.engagement_letter_log(l.id, 'signed', jsonb_build_object('name', v_name, 'capacity', v_cap, 'email', l.to_email,
    'code_id', p_code_id, 'doc_sha256', l.doc_sha256, 'version', l.template_version, 'full_opened_at', l.full_opened_at,
    'consents', jsonb_build_object('engagement', true, 'data_processing', true, 'ai_processing', v_ai)), v_name);
  -- The consent on the client, as Client consent records it (ai_set_consent's columns).
  IF l.client_id IS NOT NULL THEN
    UPDATE public.clients
       SET ai_consent_at = CASE WHEN v_ai THEN v_day ELSE NULL END,
           ai_consent_note = left(CASE WHEN v_ai THEN 'Engagement letter v' || l.template_version || ' e-signed by ' || v_name || ' (' || v_cap || '), ref ' || v_ref
                                       ELSE 'Engagement letter v' || l.template_version || ' e-signed by ' || v_name || ': no to AI tools, ref ' || v_ref END, 500),
           ai_opt_out = NOT v_ai
     WHERE id = l.client_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'ref', v_ref, 'signed_at', now(), 'letter_id', l.id);
END;
$$;

-- The client asks for changes (or does not agree): recorded for the firm; the letter can still be signed.
CREATE OR REPLACE FUNCTION public.engagement_letter_decline(p_token text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.engagement_letters; v_reason text := left(btrim(COALESCE(p_reason, '')), 2000);
BEGIN
  l := public.engagement_letter_by_token(p_token);
  IF l.id IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF public.engagement_letter_state(l) <> 'sent' THEN RETURN jsonb_build_object('error', public.engagement_letter_state(l)); END IF;
  IF length(v_reason) < 5 THEN RETURN jsonb_build_object('error', 'reason'); END IF;
  IF (SELECT count(*) FROM public.engagement_letter_events e WHERE e.letter_id = l.id AND e.kind = 'declined' AND e.at > now() - interval '1 day') >= 5 THEN
    RETURN jsonb_build_object('error', 'too_many');
  END IF;
  UPDATE public.engagement_letters SET declined_at = now(), decline_reason = v_reason WHERE id = l.id;
  PERFORM public.engagement_letter_log(l.id, 'declined', jsonb_build_object('reason', v_reason));
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- The AI consent withdrawn by the client, from the signed letter's page, with a code.
CREATE OR REPLACE FUNCTION public.engagement_letter_withdraw_ai(p_token text, p_code_id uuid, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.engagement_letters; v_check text;
BEGIN
  l := public.engagement_letter_by_token(p_token);
  IF l.id IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT * INTO l FROM public.engagement_letters WHERE id = l.id FOR UPDATE;
  IF l.status <> 'signed' OR COALESCE((l.consents ->> 'ai_processing')::boolean, false) = false THEN
    RETURN jsonb_build_object('error', 'nothing_to_withdraw');
  END IF;
  v_check := public.engagement_letter_code_check(l.id, p_code_id, p_code, 'withdraw');
  IF v_check <> 'ok' THEN RETURN jsonb_build_object('error', v_check); END IF;
  UPDATE public.engagement_letters SET consents = consents || jsonb_build_object('ai_processing', false), ai_withdrawn_at = now() WHERE id = l.id;
  PERFORM public.engagement_letter_log(l.id, 'ai_withdrawn', jsonb_build_object('code_id', p_code_id), l.signer_name);
  IF l.client_id IS NOT NULL THEN
    UPDATE public.clients SET ai_consent_at = NULL, ai_opt_out = true,
           ai_consent_note = left('AI consent withdrawn by the client on ' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'FMDD Mon YYYY')
                                  || ' (engagement letter ref ' || upper(left(replace(l.id::text, '-', ''), 8)) || ')', 500)
     WHERE id = l.client_id;
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- The signed copy (service role): claimed once, then e-mailed by the Edge Function with its own link (p_view_hash).
DROP FUNCTION IF EXISTS public.engagement_letter_copy_claim(uuid);
CREATE OR REPLACE FUNCTION public.engagement_letter_copy_claim(p_letter_id uuid, p_view_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.engagement_letters;
BEGIN
  IF COALESCE(p_view_hash, '') !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  UPDATE public.engagement_letters SET copy_sent_at = now()
   WHERE id = p_letter_id AND status = 'signed' AND copy_sent_at IS NULL
  RETURNING * INTO l;
  IF l.id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.engagement_letter_tokens SET view_hash = p_view_hash WHERE letter_id = l.id;
  RETURN jsonb_build_object('id', l.id, 'ref', upper(left(replace(l.id::text, '-', ''), 8)), 'to', l.signer_email, 'cc', l.cc_email,
    'client_name', l.client_name, 'gstin', l.client_gstin, 'title', l.title, 'version', l.template_version, 'firm', l.firm,
    'signer_name', l.signer_name, 'signer_capacity', l.signer_capacity, 'signed_at', l.signed_at, 'consents', l.consents,
    'doc_sha256', l.doc_sha256);
END;
$$;

CREATE OR REPLACE FUNCTION public.engagement_letter_copy_mark(p_letter_id uuid, p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.engagement_letters SET copy_error = left(p_error, 500) WHERE id = p_letter_id;
  PERFORM public.engagement_letter_log(p_letter_id, CASE WHEN p_error IS NULL THEN 'copy_sent' ELSE 'copy_failed' END,
                                       CASE WHEN p_error IS NULL THEN NULL ELSE jsonb_build_object('error', left(p_error, 300)) END, 'e-mail');
END;
$$;

-- ── Who may call what ──────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.engagement_letter_caller() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.engagement_letter_log(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.engagement_letter_by_token(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.engagement_letter_code_check(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.engagement_letter_issue(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.engagement_letter_mark_sent(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.engagement_letter_code_claim(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.engagement_letter_code_mark(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.engagement_letter_copy_claim(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.engagement_letter_copy_mark(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.engagement_letter_issue(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.engagement_letter_mark_sent(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.engagement_letter_code_claim(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.engagement_letter_code_mark(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.engagement_letter_copy_claim(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.engagement_letter_copy_mark(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.engagement_letter_template_save(int, text, text, jsonb, jsonb, text, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.engagement_letter_template_publish(int, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.engagement_letter_create(uuid[], text, text, text[], text, date, int, text, boolean, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.engagement_letter_resend(uuid, int, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.engagement_letter_revoke(uuid, text, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.engagement_letter_audit(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.engagement_letter_view(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.engagement_letter_code_request(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.engagement_letter_sign(text, uuid, text, text, text, jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.engagement_letter_decline(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.engagement_letter_withdraw_ai(text, uuid, text) TO anon, authenticated, service_role;

-- ── Version 1 of the letter (a draft: a partner reads and publishes it) ─────
INSERT INTO public.engagement_letter_templates (version, title, intro, clauses, firm, status, note, created_by)
VALUES (1, 'Engagement letter for GST services',
$intro$Dear {{client_name}},

This letter, dated {{letter_date}}, sets out the terms on which {{firm_name}}, Chartered Accountants, will act for you on your affairs under the Goods and Services Tax laws, and how we look after the personal data you share with us under the Digital Personal Data Protection Act, 2023. The one page summary refers to each clause below; the clauses are the agreement. Please read them in full before you sign.$intro$,
$clauses$[
 {"key": "parties", "heading": "Who we are and what this letter covers",
  "summary": "{{firm_name}} (FRN {{firm_frn}}) acts for {{client_name}} (GSTIN {{gstin}}) from {{start_date}} on the terms below.",
  "text": "This letter is between {{firm_name}}, Chartered Accountants, firm registration number {{firm_frn}}, {{firm_address}} (\"we\", \"us\", \"the firm\"), and {{client_name}}, GSTIN {{gstin}} (\"you\", \"the client\").\n\nIt applies from {{start_date}} to the services in clause 2 and to any further GST work you ask us to do, unless we agree other terms for that work in writing. It replaces any earlier engagement letter for these services and continues until it is ended under clause 16."},
 {"key": "scope", "heading": "The services we will provide",
  "summary": "The GST work listed here; anything else needs a separate agreement.",
  "text": "We will provide these services:\n{{services}}\n\nAnything not listed is outside this engagement unless we agree it in writing (an e-mail is enough), for example audits or certifications under any law, representation before the Appellate Tribunal, the High Court or the Supreme Court, and advice on laws other than GST. Our work relies on the information and documents you give us: we do not audit or verify your books, invoices or other records unless we agree to do so separately."},
 {"key": "client_duties", "heading": "Your responsibilities",
  "summary": "You give complete and correct information on time, approve each return, pay the tax and stay responsible for what is filed.",
  "text": "You are responsible for:\n• keeping proper books, invoices, e-invoices, e-way bills and other records as the GST laws require;\n• giving us complete, correct and timely information and documents, by the dates in our reminders;\n• reviewing and approving each return, reply or application before we file it, and sharing the one time password (OTP) or electronic verification code needed to file it;\n• paying the tax, interest, late fee and penalty that is due, on time, from your electronic ledgers;\n• telling us promptly of any notice, letter, summons or order you receive other than on the GST portal, and of any change in your business, constitution, address, bank account, authorised signatory or e-mail address;\n• keeping your portal password and the e-mail and mobile number registered on the portal secure.\n\nUnder the GST laws the registered person remains responsible for the correctness of every return and form filed for it (self assessment under section 59 of the CGST Act, 2017), including those we prepare or file as your GST Practitioner (rule 83 of the CGST Rules, 2017), and for the tax, interest, late fee and penalty payable."},
 {"key": "firm_duties", "heading": "Our responsibilities",
  "summary": "We act with due care and skill under the standards of the ICAI and keep you informed of due dates.",
  "text": "We will carry out the services with due care and skill, in line with the standards and the Code of Ethics of the Institute of Chartered Accountants of India (ICAI). We will tell you of the due dates that apply to you, prepare and file returns on the basis of the information you give us, and tell you of anything we notice that needs your attention.\n\nWe file on time when we receive complete information and your approval in time. We are not responsible for a delay or an error that arises from information that is late, incomplete or wrong, from the GST portal or another government system being unavailable, or from a change in the law, a notification or a circular after our work was done."},
 {"key": "portal", "heading": "Access to the GST portal and authority to act",
  "summary": "You authorise us to log in to the GST portal for you, file what you approve and download your returns, notices and orders.",
  "text": "You authorise the firm, its partners and staff to log in to the GST portal (www.gst.gov.in) on your behalf with the credentials you share with us, and to act as your GST Practitioner where you engage us as one (rule 83 of the CGST Rules, 2017), in order to prepare, upload and file the returns, forms and replies you approve, and to view and download your returns, ledgers, notices, orders and case documents. We use our practice management system and its browser extension to do so; your credentials are kept in that system, are reachable only by our staff, and are used only for your work. Please tell us whenever you change your password.\n\nAppearing for you before a tax authority as your authorised representative (section 116 of the CGST Act, 2017) needs your written authority for each proceeding; we will ask for it when needed."},
 {"key": "notices", "heading": "Notices, replies and appeals",
  "summary": "We track notices on the portal and draft replies and appeals on your instructions; time limits depend on your timely instructions.",
  "text": "Where the services include notices and appeals, we follow the notices, orders and case documents on your portal, tell you of each one and its time limit, and draft the reply, application or appeal (the statement of facts, the grounds of appeal and the written submission) on your instructions, for your approval before it is filed. The time limits of the law are strict: we need your instructions and documents in good time. Any pre deposit, tax, interest, penalty or fee payable to file an appeal or to close a proceeding is payable by you. We will give you our professional view, but we cannot guarantee the outcome of any proceeding."},
 {"key": "fees", "heading": "Fees and payment",
  "summary": "Fees as agreed: {{fees}}. Government fees, interest and penalties are yours.",
  "text": "Our fees for the services are: {{fees}}.\n\nGST is charged on our fees at the rate in force. Out of pocket expenses agreed with you are charged at cost. Government fees, late fees, interest, penalties and taxes are payable by you. Our invoices are payable within 15 days. Work outside clause 2 is charged at the fees we agree for it. If fees remain unpaid for 60 days after a reminder, we may pause the work after telling you in writing, and we will still tell you of the due dates that fall in that time."},
 {"key": "confidentiality", "heading": "Confidentiality",
  "summary": "Your information stays confidential under the Chartered Accountants Act, 1949 and the ICAI Code of Ethics.",
  "text": "We keep your information confidential, as the Chartered Accountants Act, 1949 and the ICAI Code of Ethics require. We disclose it only with your consent; where a law, a court, a tax authority or a regulator requires it; to the ICAI or its quality or peer reviewers; and to the service providers who help us deliver the services, who are bound to keep it confidential (clause 10)."},
 {"key": "personal_data", "heading": "Personal data: our roles and what we process",
  "summary": "Under the DPDP Act we use personal data (names, PAN, contact and bank details, and the data in your records) only for these services and the law.",
  "text": "The Digital Personal Data Protection Act, 2023 (the DPDP Act) and the Digital Personal Data Protection Rules, 2025 (most of which apply from 13 May 2027) govern how we handle personal data. We follow them from the date of this letter.\n\nAs Data Fiduciary. For the personal data of you and of your proprietor, partners, directors and authorised persons, we decide how it is used for this engagement, and we process it only for: providing the services in clause 2; communicating with you; billing; and meeting our obligations under the GST laws, the Chartered Accountants Act, 1949 and other laws. This data is: names; PAN; the Aadhaar number only where the GST law needs it (for example registration and authentication); addresses; e-mail addresses and mobile numbers; designations and signatures; bank account details; and portal credentials.\n\nAs Data Processor. Your records may hold personal data of your customers, suppliers, employees and others (for example names, PAN or GSTIN, addresses and invoice details). For that data you are the Data Fiduciary and we process it only on your behalf and as this letter instructs (section 8(2) of the DPDP Act), for the services in clause 2. You confirm that you may share it with us for these purposes.\n\nYour consent. By signing you consent to the processing in this clause, which is needed for the services. The use of AI tools (clause 11) is a separate, optional consent. You may withdraw a consent at any time, as easily as you gave it (clause 13); withdrawing it does not affect processing done before, and processing that a law requires continues as the law allows."},
 {"key": "safeguards", "heading": "How we protect and share personal data",
  "summary": "Reasonable security safeguards, named service providers bound by contract, and no sale or advertising use of your data.",
  "text": "We take reasonable security safeguards to prevent a personal data breach (section 8(5) of the DPDP Act and rule 6 of the Rules): access only for the staff who work on your matters, with their own logins and levels of access; encrypted connections; records of access and of changes; backups; and contracts that bind our service providers to the same care.\n\nWe share personal data only with the service providers who help us deliver the services: our cloud database and hosting provider, our e-mail provider (Microsoft 365), the GST portal and the Goods and Services Tax Network, and, only with your consent under clause 11, the AI service named there. Some of them may store or process data outside India, as section 16 of the DPDP Act permits except to a country the Central Government restricts. We do not sell personal data and do not use it for advertising."},
 {"key": "ai", "heading": "AI tools (your optional consent)",
  "summary": "Only if you say yes: AI tools help read your notices and draft replies; a person reviews everything; you can withdraw at any time.",
  "text": "With your consent, which is optional and does not affect the rest of this engagement, we may use an artificial intelligence (AI) service, at present Anthropic's Claude, to read the notices, orders and documents of your GST case folders and to help draft replies and appeal documents. A member of the firm reviews every output before anything is filed or sent, and no decision about you is taken by the AI tool alone. We send it only what the work needs, and we use such a service only on terms that require the provider to keep your data confidential and to use it only to provide the service to us.\n\nYou may withdraw this consent at any time, from the link in the e-mail that confirms your signature, or by writing to {{grievance_email}}. After that no new document of yours is sent to the AI service."},
 {"key": "retention", "heading": "How long we keep records",
  "summary": "At least 72 months from the annual return's due date (section 36, CGST Act), longer while a proceeding is pending; then erased.",
  "text": "We keep your records for as long as the engagement lasts and then for as long as the law requires: at least 72 months from the due date of the annual return for the year they relate to (section 36 of the CGST Act, 2017), and longer while any appeal, revision, proceeding or investigation about them is pending. We keep this letter and the record of its signature for eight years after the engagement ends. When the purpose is served and no law requires us to keep personal data, we erase it or make it anonymous (section 8(7) of the DPDP Act)."},
 {"key": "rights", "heading": "Your rights and how to raise a grievance",
  "summary": "Access, correction, erasure, nomination and grievances through {{grievance_name}} ({{grievance_email}}); complaint to the Data Protection Board.",
  "text": "As a Data Principal you have the right to: a summary of the personal data we process about you and with whom we share it (section 11); correction, completion, updating and erasure of it (section 12); have a grievance redressed (section 13); and nominate a person to exercise these rights if you die or cannot act (section 14). You may withdraw a consent at any time (section 6(4)).\n\nWrite to our grievance officer, {{grievance_name}}, at {{grievance_email}}. We will acknowledge your request and answer it within the time the Rules allow, and in any case within 90 days. If you are not satisfied with our answer, you may complain to the Data Protection Board of India. In return, please give us authentic information and do not file a false or frivolous grievance (section 15)."},
 {"key": "breach", "heading": "If a personal data breach happens",
  "summary": "We tell you without delay and inform the Data Protection Board as the Rules require.",
  "text": "If a personal data breach affects personal data we process, we will tell the persons affected without delay: what happened and when, its likely consequences, what we are doing about it and what they can do to protect themselves, with a contact for questions. We will also inform the Data Protection Board of India without delay and give it the detailed report the Rules require (within 72 hours of becoming aware of the breach). Where we act as your Data Processor, we will tell you without delay so that you can meet your own obligations."},
 {"key": "liability", "heading": "Limitation of liability",
  "summary": "Our liability is limited to the fees for the service concerned in the previous 12 months; tax, interest and penalties remain yours.",
  "text": "Our total liability for any claim arising from this engagement is limited to the fees you paid for the service concerned in the 12 months before the claim, except where the law does not allow liability to be limited (for example fraud or wilful misconduct). We are not liable for any indirect or consequential loss, or for loss arising from information that was late, incomplete or wrong. Tax, interest, late fee and penalty under the GST laws are payable by you in any case."},
 {"key": "term", "heading": "Ending the engagement",
  "summary": "Either of us may end it with 30 days' notice by e-mail; we hand over your documents and keep copies only as clause 12 allows.",
  "text": "Either of us may end this engagement by giving 30 days' notice in writing (an e-mail is enough). We may end it at once if continuing would break a law or our professional standards. You pay the fees for the work done up to the end. We hand over your documents and data, or send them to your new adviser on your instructions, and keep copies only as clause 12 allows. Please change your portal password when the engagement ends; we will delete the credentials we hold."},
 {"key": "esign", "heading": "Communication and electronic signature",
  "summary": "We communicate by e-mail and the portal; signing here with a one time code is a valid electronic contract.",
  "text": "We communicate with you by e-mail, through our portal and by telephone or WhatsApp at the numbers you give us. E-mail can be delayed, misdirected or intercepted; please tell us if you prefer another way for sensitive documents.\n\nYou accept this letter electronically: signing it on our portal, after confirming a one time code sent to your e-mail address, forms a valid and binding contract (section 10A of the Information Technology Act, 2000). We keep a record of the signing (the time, your name and capacity, the code check, the network address and browser used, and the fingerprint of the text you signed) as evidence of it, and we e-mail you a copy. You may also sign a printed copy if you prefer."},
 {"key": "general", "heading": "General terms",
  "summary": "Indian law applies; disputes go first to discussion, then to arbitration at {{city}}.",
  "text": "This letter is the whole agreement between us on the services and replaces earlier understandings on them. A change to it is valid only in writing (an e-mail from each of us is enough). If a part of it is found invalid, the rest continues. Neither of us is responsible for a delay caused by events beyond our reasonable control.\n\nThis letter is governed by the laws of India. Any dispute is first discussed between us in good faith; if it is not settled within 30 days, it is referred to a sole arbitrator under the Arbitration and Conciliation Act, 1996, seated at {{city}}, in English. Subject to that, the courts at {{city}} have jurisdiction. Your right to raise a matter with the ICAI is not affected."}
]$clauses$::jsonb,
jsonb_build_object('name', 'V. J. Desai & Co. LLP', 'frn', '', 'address', '', 'email', 'gst@vjdesai.com', 'phone', '',
                   'partner_name', '', 'partner_membership_no', '', 'grievance_name', '', 'grievance_email', '', 'city', 'Ahmedabad'),
'draft', 'Drafted on 28 October 2026 by engineering for a partner''s review: read every clause, fill the firm''s details, then publish.', 'GST Keeper')
ON CONFLICT (version) DO NOTHING;

COMMENT ON TABLE public.engagement_letters IS
  'Engagement letters sent for e-signature (20261028110000): the text as sent, its SHA-256, and the signing. docs/ENGAGEMENT_LETTERS.md.';

COMMIT;
