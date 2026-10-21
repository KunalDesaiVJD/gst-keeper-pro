-- The code limits stop a mailbox being flooded (20261021160000, finding of
-- 21 Oct 2026, low). They were counted per link: one caller got 10 codes a day
-- to an address on every link, also links with nothing left to answer (50 to
-- the owner from one caller over five links); a caller rotating addresses in
-- one IPv6 /64 was a new caller each time; and the caps over all callers never
-- refused a caller's first 2 codes, so 37 more callers sent 74 more (104 to
-- one address on one link). Every call as the public key; t_mailbox stands in
-- for the Edge Function e-mailing each code.

-- Who is one caller.
BEGIN;
SELECT t_eq(builder_bu_confirm_caller('2001:db8::1'), '2001:db8::/64', 'an IPv6 address is its /64');
SELECT t_eq(builder_bu_confirm_caller('2001:DB8:0:0:abcd:ef01:2:28'), '2001:db8::/64', 'any address in that /64 too');
SELECT t_eq(builder_bu_confirm_caller('2001:db8:0:1::1'), '2001:db8:0:1::/64', 'the next /64 is another caller');
SELECT t_eq(builder_bu_confirm_caller(' 198.51.100.7 '), '198.51.100.7', 'an IPv4 address is itself');
SELECT t_eq(builder_bu_confirm_caller('::ffff:198.51.100.7'), '198.51.100.7', 'an IPv4 address written as IPv6 is that address');
SELECT t_eq(builder_bu_confirm_caller('not an ip'), 'not an ip', 'anything else counts as itself');
SELECT t_eq(builder_bu_confirm_caller(NULL), NULL::text, 'no address: one bucket');
SET LOCAL ROLE anon;
SELECT t_raises('SELECT builder_bu_confirm_caller(''x'')', 'permission denied', 'a helper, closed to the public key');
ROLLBACK;

-- (a) One caller, several links To the owner: 10 a day to the address in all,
-- not 10 on each link.
BEGIN;
\ir fixtures.psql
CREATE FUNCTION pg_temp.an_hour_passes() RETURNS void LANGUAGE sql AS $$
  UPDATE builder_bu_confirm_codes SET created_at = created_at - interval '61 minutes' $$;
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'token' AS t1 \gset
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000002']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'token' AS t2 \gset
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'token' AS t3 \gset
UPDATE email_outbox SET status = 'sent', sent_at = now();
SELECT set_config('request.headers', '{"cf-connecting-ip": "203.0.113.7"}', true);
SELECT t_mailbox((builder_bu_confirm_code_request(t, 'owner@client.test') ->> 'code_id')::uuid) IS NOT NULL
  FROM unnest(ARRAY[:'t1', :'t2', :'t3', :'t1', :'t2']) t;
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'t3', 'owner@client.test'),
                '5 codes to this address in the last hour', 'five an hour to the address over every link');
RESET ROLE;
SELECT pg_temp.an_hour_passes();
SET LOCAL ROLE anon;
SELECT t_mailbox((builder_bu_confirm_code_request(t, 'owner@client.test') ->> 'code_id')::uuid) IS NOT NULL
  FROM unnest(ARRAY[:'t2', :'t3', :'t1', :'t2', :'t3']) t;
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'t3', 'owner@client.test'),
                'We have sent 10 codes to this address today', 'ten a day to the address from one caller, over every link');
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'t1', 'owner@client.test'),
                'We have sent 10 codes to this address today', 'on the other links too');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_codes WHERE email = 'owner@client.test' AND sent_at IS NOT NULL)::int,
            10, 'ten codes e-mailed to the owner, not ten per link');
ROLLBACK;

-- (a, the repro) Five requests To the owner, all out; the owner confirms on
-- the newest. No link has anything left to answer, so none takes a code.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
CREATE TEMP TABLE toks (n int, tok text);
DO $$
DECLARE i int; r jsonb;
BEGIN
  FOR i IN 1..5 LOOP
    r := t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL);
    INSERT INTO toks VALUES (i, r ->> 'token');
    UPDATE email_outbox SET status = 'sent', sent_at = now() WHERE id = (r ->> 'outbox_id')::uuid;
  END LOOP;
END $$;
SELECT tok AS t5 FROM toks WHERE n = 5 \gset
SELECT tok AS t1 FROM toks WHERE n = 1 \gset
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'t1', 'owner@client.test'),
                'Nothing on this link is waiting for an answer', 'a replaced link takes no code');
SELECT t_eq(t_results(t_respond(:'t5', jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')),
                                'Owner', 'owner@client.test')), 'A-101:CONFIRMED', 'the owner confirms on the newest link');
SELECT set_config('request.headers', '{"cf-connecting-ip": "203.0.113.7"}', true);
DO $$
DECLARE t record; refused int := 0;
BEGIN
  FOR t IN SELECT * FROM toks LOOP
    BEGIN
      PERFORM builder_bu_confirm_code_request(t.tok, 'owner@client.test');
    EXCEPTION WHEN check_violation THEN
      IF position('Nothing on this link is waiting' IN SQLERRM) > 0 THEN refused := refused + 1; END IF;
    END;
  END LOOP;
  PERFORM t_eq(refused, 5, 'every link refuses a code once nothing is left to answer');
END $$;
-- A disputed unit waits for staff: its link takes no code either; a link
-- with one unit still open does.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003']::uuid[],
              ARRAY['owner@client.test'], ARRAY['accounts@client.test']) ->> 'token' AS t6 \gset
SELECT t_eq(t_results(t_respond(:'t6', jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000002', 'DISPUTE', 'Now 54 lakh')),
                                'Owner', 'owner@client.test')), 'A-102:DISPUTED', 'A-102 disputed');
SELECT t_eq((builder_bu_confirm_code_request(:'t6', 'accounts@client.test') ->> 'ok')::boolean, true, 'A-103 is still open: a code goes');
SELECT t_eq(t_results(t_respond(:'t6', jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')),
                                'Owner', 'owner@client.test')), 'A-103:CONFIRMED', 'A-103 confirmed');
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'t6', 'accounts@client.test'),
                'Nothing on this link is waiting for an answer', 'one disputed, one confirmed: no code');
ROLLBACK;

-- A per-unit link of before 21 Oct 2026 whose unit a newer request asks
-- about, once that request is out: no code on the per-unit link.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_old_app($f$INSERT INTO builder_bu_agreement_confirmations (bu_event_id, unit_id, client_id, agreement_value_at_request, status, sent_at)
VALUES ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 4500000, 'PENDING', now())$f$);
UPDATE clients SET email = 'owner@client.test';
SELECT t_legacy_snapshot() = 1;
SELECT token AS tu FROM builder_bu_agreement_confirmations \gset
SELECT t_eq((builder_bu_confirm_code_request(:'tu', 'owner@client.test') ->> 'ok')::boolean, true, 'the per-unit link takes a code while its unit is open');
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'outbox_id' AS ob \gset
UPDATE email_outbox SET status = 'sent' WHERE id = :'ob';
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tu', 'owner@client.test'),
                'Nothing on this link is waiting for an answer', 'replaced by a request that is out: no code');
ROLLBACK;

-- (b) Rotating addresses inside one IPv6 /64 is one caller.
BEGIN;
\ir fixtures.psql
CREATE FUNCTION pg_temp.an_hour_passes() RETURNS void LANGUAGE sql AS $$
  UPDATE builder_bu_confirm_codes SET created_at = created_at - interval '61 minutes' $$;
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'token' AS tok \gset
SELECT set_config('my.tok', :'tok', true);
CREATE TEMP TABLE got (ip text, ok int, refused text);
DO $$
DECLARE i int; k int; ok int; msg text; ip text;
BEGIN
  FOR i IN 1..40 LOOP
    ip := '2001:db8::' || to_hex(i);
    PERFORM set_config('request.headers', json_build_object('cf-connecting-ip', ip)::text, true);
    ok := 0; msg := NULL;
    FOR k IN 1..12 LOOP
      BEGIN
        PERFORM t_mailbox((builder_bu_confirm_code_request(current_setting('my.tok'), 'owner@client.test') ->> 'code_id')::uuid);
        ok := ok + 1;
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM LIKE '%5 codes to this address in the last hour%' THEN
          EXECUTE 'RESET ROLE'; PERFORM pg_temp.an_hour_passes(); EXECUTE 'SET LOCAL ROLE anon';
          PERFORM set_config('request.headers', json_build_object('cf-connecting-ip', ip)::text, true);
        ELSE msg := SQLERRM; EXIT; END IF;
      END;
    END LOOP;
    INSERT INTO got VALUES (ip, ok, msg);
  END LOOP;
END $$;
SELECT t_eq((SELECT sum(ok)::int FROM got), 10, 'forty addresses in one /64: ten codes in all');
SELECT t_eq((SELECT count(*) FROM got WHERE refused LIKE 'We have sent 10 codes to this address today%')::int, 40,
            'every one of them is told ten went today');
-- Another /64 is another caller.
SELECT set_config('request.headers', '{"cf-connecting-ip": "2001:db8:0:1::5"}', true);
SELECT t_eq((builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'ok')::boolean, true, 'the next /64 still gets a code');
ROLLBACK;

-- (b) Many real callers (one IPv4 address each), over several links: at most
-- 40 codes e-mailed to one address in a day, whoever asks; from 30 on only a
-- caller's first 2 go.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'token' AS t1 \gset
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000002']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'token' AS t2 \gset
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'token' AS t3 \gset
UPDATE email_outbox SET status = 'sent', sent_at = now();
SELECT set_config('my.toks', concat_ws(',', :'t1', :'t2', :'t3'), true);
CREATE TEMP TABLE got (caller int, ok int, refused text);
DO $$
DECLARE i int; k int; ok int; msg text; toks text[] := string_to_array(current_setting('my.toks'), ',');
BEGIN
  FOR i IN 1..50 LOOP
    PERFORM set_config('request.headers', json_build_object('cf-connecting-ip', '203.0.113.' || i)::text, true);
    ok := 0; msg := NULL;
    FOR k IN 1..3 LOOP
      BEGIN
        PERFORM t_mailbox((builder_bu_confirm_code_request(toks[1 + (i + k) % 3], 'owner@client.test') ->> 'code_id')::uuid);
        ok := ok + 1;
      EXCEPTION WHEN check_violation THEN
        msg := SQLERRM;
      END;
    END LOOP;
    INSERT INTO got VALUES (i, ok, msg);
  END LOOP;
END $$;
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_codes WHERE email = 'owner@client.test' AND sent_at IS NOT NULL)::int,
            40, 'fifty callers over three links: forty codes reach the owner, no more');
SELECT t_eq((SELECT string_agg(ok::text, '' ORDER BY caller) FROM got WHERE caller BETWEEN 9 AND 17), '332222200',
            'ten callers get 3 each (30), then 2 each until 40, then none');
SELECT t_eq((SELECT count(*) FROM got WHERE caller > 15 AND refused LIKE 'Too many codes were e-mailed to this address today%')::int, 35,
            'everyone after is told so');
ROLLBACK;

-- The ceilings hold when codes are asked for in parallel: each request is let
-- through before any is e-mailed, so the mailer checks again when it claims.
-- And a link takes at most 80 e-mailed an hour, whoever asks.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'],
              ARRAY['site@client.test']) ->> 'token' AS tok \gset
RESET ROLE;
INSERT INTO builder_bu_confirm_codes (request_id, email, requested_ip, caller, created_at, claimed_at, sent_at)
SELECT id, 'owner@client.test', '192.0.2.' || g, '192.0.2.' || g, now() - interval '3 hours', now() - interval '3 hours', now() - interval '3 hours'
  FROM builder_bu_confirm_requests, generate_series(1, 39) g;
SET LOCAL ROLE anon;
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.1"}', true);
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id' AS p1 \gset
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.2"}', true);
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id' AS p2 \gset
SELECT t_eq(t_mailbox(:'p1') ~ '^[0-9]{6}$', true, 'the 40th is e-mailed');
SELECT t_eq(t_mailbox(:'p2'), NULL::text, 'the 41st, asked for at the same time, is never minted');
SELECT t_eq(builder_bu_confirm_code_verify(:'tok', 'owner@client.test', '123456', :'p2') ->> 'message',
            'We could not e-mail that code. Please ask for a new one.', 'that page is told it was not e-mailed');
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.3"}', true);
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tok', 'owner@client.test'),
                'Too many codes were e-mailed to this address today', 'forty e-mailed: even a new caller''s first is refused');
SELECT t_eq((builder_bu_confirm_code_request(:'tok', 'site@client.test') ->> 'ok')::boolean, true, 'another address is not');
-- A link: 80 e-mailed in the hour, whoever asked.
RESET ROLE;
DELETE FROM builder_bu_confirm_codes;
INSERT INTO builder_bu_confirm_codes (request_id, email, requested_ip, caller, claimed_at, sent_at)
SELECT id, 'other' || g || '@client.test', '192.0.2.' || g, '192.0.2.' || g, now(), now()
  FROM builder_bu_confirm_requests, generate_series(1, 80) g;
SET LOCAL ROLE anon;
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.9"}', true);
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tok', 'owner@client.test'),
                'Too many codes were asked for on this link', 'eighty on a link in an hour: even a first code is refused');
ROLLBACK;
