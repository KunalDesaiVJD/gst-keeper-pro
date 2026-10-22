-- BU agreement value confirmation, follow-up to 20261021140000_bu_confirm_cc.sql
-- (already applied live; this file changes only what the findings left after
-- its verification asked for, and is safe to run again).
--
--   1. The code limits now stop a mailbox being flooded (low). They were
--      counted per link, so every link ever sent took 10 codes a day to an
--      address from one caller, also links with nothing left to answer; a
--      caller rotating addresses inside one IPv6 /64 was a new caller each
--      time; and the caps over all callers spared every caller's first 2
--      codes, so they never held (104 codes to one address on one link, 50
--      from one caller over five links). Now:
--        * a caller is one IPv4 address, or one IPv6 /64 (a single host gets a
--          whole /64), builder_bu_confirm_caller, kept on each code (caller);
--        * per caller and address, 5 codes an hour and 10 a day on one link,
--          as before (a proof holds on one link only, so a reader with several
--          live links needs a code on each: counted over every link, as a
--          first version of this file did, the sixth link of a reader with six
--          was refused); the 5-an-hour refusal names the e-mail to type by its
--          reference. Over every link, 20 a day per caller and address, a
--          limit of its own that says so ("over all our links"); 20 an hour
--          per caller whatever the address or link;
--        * over all callers and every link, 30 codes e-mailed a day to one
--          address; past 30 only a caller's first 2 codes of the day to that
--          address go, and never more than 40 in all (a hard ceiling: once
--          40 are e-mailed nobody gets another that day, and the reader
--          writes to the firm, which may accept the value). On a link, 60
--          e-mailed an hour, past that only a caller's first 2, never more
--          than 80. "E-mailed" is a code the mailer claimed and did not
--          report failed, so codes asked for and never sent cost nothing
--          (round 4) and codes claimed but not yet reported count at once;
--        * the mailer checks the ceilings again when it claims a code, under
--          the same lock, so codes asked for in parallel cannot pass them
--          together (a code over a ceiling is never minted: send_error);
--        * no code is e-mailed on a link where nothing is waiting for an
--          answer (every unit confirmed, disputed, accepted, replaced or not
--          sent).
--   2. Another caller's code is no longer "the latest e-mail" (low). Every
--      code has a reference of 4 letters taken from its id
--      (builder_bu_confirm_code_ref; no digits, so it is never typed as the
--      code): the code e-mail carries it in its subject and body (Edge
--      Function bu-confirm-code), the page shows it next to the Code box, and
--      the messages point at "the e-mail marked <ref>", never at the latest
--      e-mail. Digits that are the code of another e-mail to the same address
--      on the same link (another page's code, or an earlier one) are said to
--      be that and are not counted as a wrong try, so a reader who types the
--      code another holder of the link asked for is never locked out by it.
--      That other code is spent by the same statement (typed_elsewhere_at,
--      new column; its page is told "That code was typed on another page"),
--      so the answer is useless to whoever typed the digits: a first version
--      of this file left it working, which made every counted wrong try a
--      check against every live code the guesser held (verification, medium).
--   3. A send records which of its units had an earlier link that reached the
--      client (builder_bu_confirm_requests.earlier_units, low): after a
--      failed send, BU Events and the pop-up say it per unit ("The earlier
--      link still takes answers for A-101. No link to A-102, A-103 has reached
--      the client."), not for every unit. earlier_link stays (true when any
--      unit had one; requests made before this file have no earlier_units).
--
-- Unchanged: who may answer, the proof, the guard trigger, the posting gate,
-- everything else in 20261021140000. The positions are in
-- docs/BUILDER_GST_POSITIONS.md section 6.
--
-- Tests: supabase/tests/bu_confirm/run.sh (local PostgreSQL; applies
-- 20261021140000 and then this file, each twice; test_76_code_flood.sql,
-- test_78_code_reference.sql, test_96_earlier_units.sql),
-- deno test --allow-read supabase/functions/bu-confirm-code/test/ and
-- node scripts/verify-bu-confirm.mjs.
--
-- Live-apply steps (project gcquafqxbykxkbexcdpy only; never the project in
-- SUPABASE_PROJECT_REF), in this order.
-- Merged release (controls-integration): live order this file,
-- 20261021100000, 20261021110000, 20261021120000, 20261021150000, each applied
-- in turn with no app deploy in between; the app goes out ONCE, after
-- 20261021150000 (step 3). The merged app calls functions of every one of
-- those files (gstr3b_push_gate, filing_record_pull, gst_change_history):
-- deployed after this file alone, every GSTR-3B push and JSON download is
-- locked ("Could not find the function public.gstr3b_push_gate") and no return
-- can be marked Filed.
--   1. Deploy the Edge Function bu-confirm-code again
--      (supabase/functions/bu-confirm-code, default verify_jwt): its e-mail
--      now carries the code's reference. It needs nothing from this file (the
--      reference is worked out from the code_id that the unchanged
--      builder_bu_confirm_code_claim returns), so it goes first: until this
--      file is applied the e-mails carry a mark the old page does not show,
--      which is harmless, whereas this file first would have the messages
--      name a mark ("the e-mail marked DRLK") that the old e-mail lacks.
--   2. Apply this file to gcquafqxbykxkbexcdpy (management API database query
--      or the SQL editor). It is safe before the app: the old page and pop-up
--      call the same functions with the same arguments (the send returns one
--      more key, earlier_units; the code request one more, ref). Apply it at a
--      quiet time (SELECT pid, now() - xact_start, left(query, 80) FROM
--      pg_stat_activity WHERE state <> 'idle' AND xact_start < now() -
--      interval '30 seconds' gives no rows): it adds columns to
--      builder_bu_confirm_codes and builder_bu_confirm_requests (an exclusive
--      lock each, held to COMMIT) and sets lock_timeout = 5 s, so behind a long
--      query it stops with "canceling statement due to lock timeout", changes
--      nothing (one transaction), and is applied again a minute later.
--   3. Deploy the app only once 20261021150000 is applied (merged release:
--      one deploy, after the last file of the live order; never right after
--      this file).
--   4. Check the objects exist: columns caller and typed_elsewhere_at on
--      builder_bu_confirm_codes (SELECT count(*) FILTER (WHERE requested_ip IS
--      NOT NULL AND caller IS NULL) FROM builder_bu_confirm_codes gives 0),
--      indexes idx_builder_bu_confirm_codes_email and
--      idx_builder_bu_confirm_codes_created; column earlier_units uuid[] on
--      builder_bu_confirm_requests; functions builder_bu_confirm_caller(text),
--      builder_bu_confirm_code_ref(uuid) (and SELECT
--      builder_bu_confirm_code_ref('3fa90000-0000-4000-8000-000000000000')
--      gives DRLK), builder_bu_confirm_code_request's body mentions
--      bu_confirm_code_addr, "Nothing on this link is waiting" and "over all
--      our links", builder_bu_confirm_code_claim's body mentions
--      bu_confirm_code_addr, builder_bu_confirm_code_verify's body mentions
--      "the e-mail marked" and typed_elsewhere_at,
--      builder_bu_confirm_request_send's body mentions earlier_units.
--   5. With the anon key from .env: rpc builder_bu_confirm_caller and
--      builder_bu_confirm_code_ref are refused (permission denied); rpc
--      builder_bu_confirm_code_request with a made-up token still answers
--      "This link is not valid."

BEGIN;
-- Adding columns takes an exclusive lock on the two tables, held to COMMIT:
-- give up rather than queue the app's queries behind a long report.
SET LOCAL lock_timeout = '5s';

-- ── 1. Who is one caller ────────────────────────────────────────────────────
-- One IPv4 address, or one IPv6 /64 (a home or office line, or a single cloud
-- host, gets a whole /64, so the address inside it is not a caller of its
-- own). An IPv4 address written as IPv6 (::ffff:a.b.c.d) is that IPv4
-- address. Anything that does not read as an address counts as itself; NULL
-- (no address passed on) is one bucket.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_caller(p_ip text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := lower(btrim(COALESCE(p_ip, '')));
  a inet;
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  v := regexp_replace(v, '^::ffff:([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)$', '\1');
  BEGIN
    a := v::inet;
  EXCEPTION WHEN others THEN
    RETURN left(v, 64);
  END;
  IF family(a) = 6 THEN
    RETURN host(network(set_masklen(a, 64))) || '/64';
  END IF;
  RETURN host(a);
END;
$$;

-- A code's reference: 4 letters from its id (no digits, and no I or O, so it
-- is never read or typed as the code). The Edge Function and the page work it
-- out the same way (supabase/functions/bu-confirm-code/message.ts codeRef,
-- src/lib/builderConfirmRules.ts codeRef).
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_code_ref(p_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT translate(left(replace(lower(p_id::text), '-', ''), 4), '0123456789abcdef', 'ABCDEFGHJKLMNPQR');
$$;

-- ── 2. Codes: the caller, and indexes for counting over every link ──────────
ALTER TABLE public.builder_bu_confirm_codes
  ADD COLUMN IF NOT EXISTS caller text;
COMMENT ON COLUMN public.builder_bu_confirm_codes.caller IS
  'Who asked, for the limits: one IPv4 address or one IPv6 /64 (builder_bu_confirm_caller of requested_ip).';
UPDATE public.builder_bu_confirm_codes
   SET caller = public.builder_bu_confirm_caller(requested_ip)
 WHERE caller IS NULL AND requested_ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_builder_bu_confirm_codes_email
  ON public.builder_bu_confirm_codes(email, created_at);
CREATE INDEX IF NOT EXISTS idx_builder_bu_confirm_codes_created
  ON public.builder_bu_confirm_codes(created_at);

-- ── 3. The reader asks for a code ───────────────────────────────────────────
-- The address must be one the e-mail went to, outside the firm, and the link
-- must have a unit waiting for an answer. Limits (finding of 21 Oct 2026: they
-- were counted per link, which never stopped a mailbox being flooded):
--   per caller (builder_bu_confirm_caller), to one address:
--     5 codes an hour and 10 a day on one link (as before: a proof holds on
--     one link only, so a reader with several live links needs a code on
--     each; verification of this file, low: counted over every link, the
--     sixth link of a reader with six was refused, told to type a code "this
--     page asked for" when it had asked for none);
--     20 a day over every link, a limit of its own that says so;
--   per caller, 20 codes an hour in all, whatever the address or link;
--   over all callers and every link, codes e-mailed (claimed, not failed):
--     30 a day to one address, past which only a caller's first 2 of the day
--     to that address (over every link) go, and never more than 40;
--     60 an hour on one link, past which only a caller's first 2 to that
--     address on that link go, and never more than 80.
-- Locked per link and per address, in that order (the claim takes the
-- address lock only), so two requests count each other.
-- Returns { ok, code_id, email, ref }: the page keeps code_id (only it has it)
-- and calls the Edge Function bu-confirm-code with it, which e-mails the code
-- with its reference.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_code_request(_token text, _email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email       text := lower(btrim(COALESCE(_email, '')));
  v_ip          text := public.builder_bu_confirm_request_ip();
  v_caller      text;
  l             record;
  v_id          uuid;
  n             record;
  v_caller_hour bigint;
  v_link_hour   bigint;
  v_last        uuid;
BEGIN
  IF NOT public.builder_bu_confirm_email_ok(v_email) THEN
    RAISE EXCEPTION 'Please give a valid e-mail address.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO l FROM public.builder_bu_confirm_link(_token);
  IF l.o_event IS NULL THEN
    RAISE EXCEPTION 'This link is not valid.' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM public.builder_bu_confirm_check_answerer(l.o_allowed, v_email);
  -- A link with nothing left to answer takes no code (finding: every link
  -- ever sent took codes, so old links multiplied the e-mails to an address).
  IF NOT EXISTS (SELECT 1 FROM public.builder_bu_agreement_confirmations c
                  WHERE c.bu_event_id = l.o_event AND c.unit_id = ANY (l.o_units)
                    AND (l.o_cf IS NULL OR c.id = l.o_cf)
                    AND public.builder_bu_confirm_state(c, l.o_req) = 'PENDING') THEN
    RAISE EXCEPTION 'Nothing on this link is waiting for an answer, so no code is needed. Please reload the page.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_caller := public.builder_bu_confirm_caller(v_ip);
  PERFORM pg_advisory_xact_lock(hashtextextended('bu_confirm_code:' || COALESCE(l.o_req, l.o_cf)::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('bu_confirm_code_addr:' || v_email, 0));

  SELECT count(*) FILTER (WHERE k.caller IS NOT DISTINCT FROM v_caller) AS mine_all_day,
         count(*) FILTER (WHERE k.caller IS NOT DISTINCT FROM v_caller
                            AND (k.request_id = l.o_req OR k.confirmation_id = l.o_cf)) AS mine_link_day,
         count(*) FILTER (WHERE k.caller IS NOT DISTINCT FROM v_caller
                            AND (k.request_id = l.o_req OR k.confirmation_id = l.o_cf)
                            AND k.created_at > now() - interval '1 hour') AS mine_link_hour,
         count(*) FILTER (WHERE k.claimed_at IS NOT NULL AND k.send_error IS NULL) AS address_day
    INTO n
    FROM public.builder_bu_confirm_codes k
   WHERE k.email = v_email
     AND k.created_at > now() - interval '24 hours';
  SELECT count(*) INTO v_caller_hour
    FROM public.builder_bu_confirm_codes k
   WHERE k.created_at > now() - interval '1 hour'
     AND k.caller IS NOT DISTINCT FROM v_caller;
  SELECT count(*) INTO v_link_hour
    FROM public.builder_bu_confirm_codes k
   WHERE (k.request_id = l.o_req OR k.confirmation_id = l.o_cf)
     AND k.created_at > now() - interval '1 hour'
     AND k.claimed_at IS NOT NULL AND k.send_error IS NULL;

  IF n.mine_link_day >= 10 THEN
    RAISE EXCEPTION 'We have sent 10 codes to this address today for this link. Please try again tomorrow, or write to us at gst@vjdesai.com.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF n.mine_link_hour >= 5 THEN
    -- Name the e-mail to type: the last code this caller asked for on this
    -- link to this address that was not refused by the mailer (the page that
    -- asked shows the same mark next to the Code box).
    SELECT k.id INTO v_last
      FROM public.builder_bu_confirm_codes k
     WHERE k.email = v_email AND k.caller IS NOT DISTINCT FROM v_caller
       AND (k.request_id = l.o_req OR k.confirmation_id = l.o_cf)
       AND k.created_at > now() - interval '1 hour' AND k.send_error IS NULL
     ORDER BY k.created_at DESC
     LIMIT 1;
    IF v_last IS NULL THEN
      RAISE EXCEPTION 'We have sent 5 codes to this address in the last hour for this link. Please ask again in an hour.'
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'We have sent 5 codes to this address in the last hour for this link. Please type the code from our e-mail marked %, or ask again in an hour.',
      public.builder_bu_confirm_code_ref(v_last)
      USING ERRCODE = 'check_violation';
  END IF;
  IF n.mine_all_day >= 20 THEN
    RAISE EXCEPTION 'We have sent 20 codes to this address today from your connection, over all our links. Please try again tomorrow, or write to us at gst@vjdesai.com.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_caller_hour >= 20 THEN
    RAISE EXCEPTION 'Too many codes were asked for from your connection in the last hour. Please try again later.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF n.address_day >= 40 OR (n.address_day >= 30 AND n.mine_all_day >= 2) THEN
    RAISE EXCEPTION 'Too many codes were e-mailed to this address today. Please try again tomorrow, or write to us at gst@vjdesai.com.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_link_hour >= 80 OR (v_link_hour >= 60 AND n.mine_link_day >= 2) THEN
    RAISE EXCEPTION 'Too many codes were asked for on this link in the last hour. Please try again later.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.builder_bu_confirm_codes (request_id, confirmation_id, email, requested_ip, caller)
  VALUES (l.o_req, l.o_cf, v_email, v_ip, v_caller)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'code_id', v_id, 'email', v_email,
                            'ref', public.builder_bu_confirm_code_ref(v_id));
END;
$$;

-- ── 4. The mailer claims a code ─────────────────────────────────────────────
-- As before (service role only; mints the code, keeps only its hash; a code
-- not claimed within 15 minutes is not sent), and the hard ceilings again,
-- under the address lock the request takes: codes asked for in parallel are
-- each let through by the request before any is e-mailed, so the claim is
-- where the ceilings hold. A code over one is never minted (send_error), and
-- the page is told it could not be e-mailed.
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_code_claim(p_code_id uuid)
RETURNS TABLE (code_id uuid, code text, to_email text, project_name text, client_name text,
               gstin text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_row  public.builder_bu_confirm_codes;
  v_b    bytea;
  v_code text;
BEGIN
  SELECT * INTO v_row
    FROM public.builder_bu_confirm_codes k
   WHERE k.id = p_code_id AND k.claimed_at IS NULL AND k.send_error IS NULL
     AND k.created_at > now() - interval '15 minutes'
     FOR UPDATE SKIP LOCKED;
  IF v_row.id IS NULL THEN RETURN; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('bu_confirm_code_addr:' || v_row.email, 0));
  IF (SELECT count(*) FROM public.builder_bu_confirm_codes k
       WHERE k.email = v_row.email AND k.created_at > now() - interval '24 hours'
         AND k.claimed_at IS NOT NULL AND k.send_error IS NULL) >= 40
     OR (SELECT count(*) FROM public.builder_bu_confirm_codes k
          WHERE (k.request_id = v_row.request_id OR k.confirmation_id = v_row.confirmation_id)
            AND k.created_at > now() - interval '1 hour'
            AND k.claimed_at IS NOT NULL AND k.send_error IS NULL) >= 80 THEN
    UPDATE public.builder_bu_confirm_codes k
       SET send_error = 'Not sent: too many codes were e-mailed to this address today, or on this link in the last hour.'
     WHERE k.id = v_row.id;
    RETURN;
  END IF;

  v_b := extensions.gen_random_bytes(4);
  v_code := lpad(((get_byte(v_b, 0)::bigint * 16777216 + get_byte(v_b, 1) * 65536
                   + get_byte(v_b, 2) * 256 + get_byte(v_b, 3)) % 1000000)::text, 6, '0');
  UPDATE public.builder_bu_confirm_codes k
     SET code_hash = encode(extensions.digest(v_row.id::text || ':' || v_code, 'sha256'), 'hex'),
         claimed_at = now(),
         expires_at = now() + interval '30 minutes'
   WHERE k.id = v_row.id;
  RETURN QUERY
    SELECT k.id, v_code, k.email, p.name, cl.name, cl.gstin, k.expires_at
      FROM public.builder_bu_confirm_codes k
      LEFT JOIN public.builder_bu_confirm_requests r ON r.id = k.request_id
      LEFT JOIN public.builder_bu_agreement_confirmations c ON c.id = k.confirmation_id
      JOIN public.builder_bu_events ev ON ev.id = COALESCE(r.bu_event_id, c.bu_event_id)
      JOIN public.builder_projects p ON p.id = ev.project_id
      JOIN public.clients cl ON cl.id = p.client_id
     WHERE k.id = v_row.id;
END;
$$;

-- ── 5. The reader types the code ────────────────────────────────────────────
-- A code whose digits were typed against another code (another page) is
-- spent: it never gives a proof (verification of this file, medium, below).
ALTER TABLE public.builder_bu_confirm_codes
  ADD COLUMN IF NOT EXISTS typed_elsewhere_at timestamptz;
COMMENT ON COLUMN public.builder_bu_confirm_codes.typed_elsewhere_at IS
  'When this code''s digits were typed against another code of the same address and link (another page): '
  'from then on it gives no proof (builder_bu_confirm_code_verify).';

-- As before (typed with the code_id the asking page got; 5 wrong tries end a
-- code; 10 wrong tries a day from one caller end that caller's codes to the
-- address on the link; never raises for a wrong code), with three changes
-- (finding of 21 Oct 2026: the reader typed the code another holder of the
-- link had asked for, the newest in their mailbox, because the page said
-- "check the latest e-mail", and was locked out for the day):
--   * every message names the e-mail by the code's reference ("the e-mail
--     marked DRLK"), never "the latest";
--   * digits that are the code of another e-mail to this address on this link
--     (another page's, or an earlier one) are said to be that and are not
--     counted as a wrong try;
--   * and that other code is spent by the same statement (typed_elsewhere_at,
--     expires_at now), so it never gives a proof, to anyone (verification of
--     this file, medium: the answer checked a guess against every live code
--     on the link for free, and a hit was then typed against its own code_id
--     for a proof, so every counted try tested as many codes as the guesser
--     held). Its own page is told it no longer works, and asks again.
-- The caller is builder_bu_confirm_caller (an IPv6 /64 is one caller).
CREATE OR REPLACE FUNCTION public.builder_bu_confirm_code_verify(_token text, _email text, _code text, _code_id uuid)
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
  v_ref   text;
  v_proof text;
  v_hits  integer;
  v_no    CONSTANT jsonb := jsonb_build_object('ok', false);
BEGIN
  SELECT * INTO l FROM public.builder_bu_confirm_link(_token);
  IF l.o_event IS NULL THEN
    RETURN v_no || jsonb_build_object('message', 'This link is not valid.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bu_confirm_code:' || COALESCE(l.o_req, l.o_cf)::text, 0));

  SELECT * INTO k FROM public.builder_bu_confirm_codes c2
   WHERE c2.id = _code_id
     AND (c2.request_id = l.o_req OR c2.confirmation_id = l.o_cf) AND c2.email = v_email
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN v_no || jsonb_build_object('message', 'Please ask for a code first, then type it here.');
  END IF;
  v_ref := public.builder_bu_confirm_code_ref(k.id);
  IF (SELECT COALESCE(sum(c2.wrong_tries), 0) FROM public.builder_bu_confirm_codes c2
       WHERE (c2.request_id = l.o_req OR c2.confirmation_id = l.o_cf) AND c2.email = v_email
         AND c2.caller IS NOT DISTINCT FROM k.caller
         AND c2.created_at > now() - interval '24 hours') >= 10 THEN
    RETURN v_no || jsonb_build_object('message',
      'Too many wrong codes for this address today. Please try again tomorrow, or write to us at gst@vjdesai.com.');
  END IF;
  -- Never claimed, or over a ceiling: the mailer did not e-mail it.
  IF k.claimed_at IS NULL OR k.send_error IS NOT NULL THEN
    RETURN v_no || jsonb_build_object('message', 'We could not e-mail that code. Please ask for a new one.');
  END IF;
  -- Its digits were typed on another page: spent, whatever is typed now.
  IF k.typed_elsewhere_at IS NOT NULL THEN
    RETURN v_no || jsonb_build_object('message',
      'That code was typed on another page, so it no longer works. Please ask for a new one.');
  END IF;
  IF k.expires_at <= now() THEN
    RETURN v_no || jsonb_build_object('message', 'This code has expired. Please ask for a new one.');
  END IF;
  IF k.wrong_tries >= 5 THEN
    RETURN v_no || jsonb_build_object('message', 'Too many wrong tries for this code. Please ask for a new one.');
  END IF;
  IF v_code !~ '^[0-9]{6}$' THEN
    RETURN v_no || jsonb_build_object('message', format('The code is the 6 digits in our e-mail marked %s.', v_ref));
  END IF;
  IF k.code_hash IS DISTINCT FROM encode(extensions.digest(k.id::text || ':' || v_code, 'sha256'), 'hex') THEN
    -- The code of another of our e-mails to this address on this link? Found
    -- and spent in one statement, so the match is useless to whoever typed it.
    UPDATE public.builder_bu_confirm_codes c2
       SET typed_elsewhere_at = COALESCE(c2.typed_elsewhere_at, now()),
           expires_at = LEAST(c2.expires_at, now())
     WHERE (c2.request_id = l.o_req OR c2.confirmation_id = l.o_cf) AND c2.email = v_email
       AND c2.id <> k.id AND c2.code_hash IS NOT NULL
       AND c2.created_at > now() - interval '24 hours'
       AND c2.code_hash = encode(extensions.digest(c2.id::text || ':' || v_code, 'sha256'), 'hex');
    GET DIAGNOSTICS v_hits = ROW_COUNT;
    IF v_hits > 0 THEN
      RETURN v_no || jsonb_build_object('other_code', true, 'message', format(
        'That is the code from another of our e-mails to this address. Please type the code from the e-mail marked %s.', v_ref));
    END IF;
    UPDATE public.builder_bu_confirm_codes SET wrong_tries = wrong_tries + 1 WHERE id = k.id;
    RETURN v_no || jsonb_build_object('message', format(
      'That code is not right. Please type the code from our e-mail marked %s.', v_ref));
  END IF;

  v_proof := encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE public.builder_bu_confirm_codes
     SET proof_hash = encode(extensions.digest(v_proof, 'sha256'), 'hex'),
         verified_at = now()
   WHERE id = k.id;
  RETURN jsonb_build_object('ok', true, 'proof', v_proof, 'email', v_email);
END;
$$;

-- ── 6. Which units of a send had an earlier link ────────────────────────────
ALTER TABLE public.builder_bu_confirm_requests
  ADD COLUMN IF NOT EXISTS earlier_units uuid[];
COMMENT ON COLUMN public.builder_bu_confirm_requests.earlier_units IS
  'When sent, the units of this request that an earlier link had reached the client for (a request that '
  'was out, or a per-unit e-mail of before 21 Oct 2026 that was out): while this e-mail is not out, that link '
  'still takes answers for them. NULL for requests sent before 20261021160000 (earlier_link only).';

-- builder_bu_confirm_request_send as in 20261021140000, but for the units
-- that had an earlier link: kept on the request (earlier_units) and returned,
-- so a failed send speaks of each unit (finding: "The earlier link still
-- takes answers" was said of every unit when only some had one).
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
  v_earlier   uuid[];
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

  -- Which of these units has a link that reached someone already? A request
  -- that is out, or a per-unit e-mail of before 21 Oct 2026 that is out (its
  -- record, section 6c of 20261021140000: sent, or its outbox row gone, as
  -- for a request). While this e-mail is not out, that link still takes
  -- answers for those units.
  v_earlier := COALESCE(ARRAY(
    SELECT c.unit_id
      FROM public.builder_bu_agreement_confirmations c
     WHERE c.bu_event_id = p_bu_event_id AND c.unit_id = ANY (v_units)
       AND c.status IN ('PENDING', 'DISPUTED')
       AND (EXISTS (SELECT 1 FROM public.builder_bu_confirm_requests r
                     WHERE r.bu_event_id = p_bu_event_id AND c.unit_id = ANY (r.unit_ids)
                       AND public.builder_bu_confirm_request_out(r.id))
            OR (cardinality(c.legacy_emails) > 0
                AND NOT EXISTS (SELECT 1 FROM public.email_outbox o
                                 WHERE o.id = c.legacy_outbox_id AND o.status <> 'sent')))
     ORDER BY c.unit_id), '{}');

  BEGIN
    -- The writes below pass the guard of 20261021140000 section 6b; an error
    -- undoes the flag with them.
    PERFORM set_config('app.bu_confirm_write', 'on', true);
    INSERT INTO public.builder_bu_confirm_requests
      (bu_event_id, client_id, to_emails, cc_emails, unit_ids, earlier_link, earlier_units, created_by)
    VALUES (p_bu_event_id, v_client, v_to, v_cc, v_units, cardinality(v_earlier) > 0, v_earlier, p_actor_id)
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
           -- (A per-unit e-mail of before 21 Oct 2026 keeps its record,
           -- legacy_emails and legacy_outbox_id.)
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
    PERFORM set_config('app.bu_confirm_write', 'off', true);
  EXCEPTION WHEN SQLSTATE 'BUC01' THEN
    PERFORM set_config('app.bu_confirm_write', 'off', true);
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
    'earlier_link', cardinality(v_earlier) > 0,
    'earlier_units', to_jsonb(v_earlier),
    'cancelled_earlier', v_cancelled);
END;
$$;

-- ── 7. Grants ───────────────────────────────────────────────────────────────
-- (CREATE OR REPLACE keeps the grants of the functions replaced; the new
-- helpers are reached only through them.)
REVOKE ALL ON FUNCTION public.builder_bu_confirm_caller(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_code_ref(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_code_request(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_code_verify(text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_code_claim(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_bu_confirm_request_send(uuid, uuid[], text[], text[], uuid, text, text, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_code_request(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_code_verify(text, text, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_code_claim(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_bu_confirm_request_send(uuid, uuid[], text[], text[], uuid, text, text, text, jsonb, jsonb)
  TO anon, authenticated, service_role;

COMMIT;
