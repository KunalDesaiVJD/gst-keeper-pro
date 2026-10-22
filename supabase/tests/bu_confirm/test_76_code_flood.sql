-- The code limits stop a mailbox being flooded (20261021160000, finding of
-- 21 Oct 2026, low). They were counted per link: one caller got 10 codes a day
-- to an address on every link, also links with nothing left to answer (50 to
-- the owner from one caller over five links); a caller rotating addresses in
-- one IPv6 /64 was a new caller each time; and the caps over all callers never
-- refused a caller's first 2 codes, so 37 more callers sent 74 more (104 to
-- one address on one link). Every call as the public key; t_mailbox stands in
-- for the Edge Function e-mailing each code.
-- Since the verification of 20261021160000 (low: the per-caller 5 an hour and
-- 10 a day were counted over every link, but a proof holds on one link only,
-- so a reader with six live links was refused the sixth, told to type a code
-- "this page asked for" when it had asked for none): they are per link again,
-- and over every link one caller gets 20 a day to an address, said so.

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

-- (a) One caller, several links To the owner: 5 an hour and 10 a day to the
-- address on each link, the limit naming the e-mail to type; over all links
-- 20 a day, said so.
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
SELECT t_mailbox((builder_bu_confirm_code_request(:'t1', 'owner@client.test') ->> 'code_id')::uuid) IS NOT NULL
  FROM generate_series(1, 4);
RESET ROLE;
UPDATE builder_bu_confirm_codes SET created_at = created_at - interval '5 minutes';
SET LOCAL ROLE anon;
SELECT builder_bu_confirm_code_request(:'t1', 'owner@client.test') AS last1 \gset
SELECT t_mailbox((:'last1'::jsonb ->> 'code_id')::uuid) IS NOT NULL;
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'t1', 'owner@client.test'),
                format('We have sent 5 codes to this address in the last hour for this link. Please type the code from our e-mail marked %s, or ask again in an hour.',
                       :'last1'::jsonb ->> 'ref'),
                'five an hour to the address on a link, naming the last e-mail asked for on it');
SELECT t_eq((builder_bu_confirm_code_request(:'t2', 'owner@client.test') ->> 'ok')::boolean, true, 'another link still takes one');
RESET ROLE;
SELECT pg_temp.an_hour_passes();
SET LOCAL ROLE anon;
SELECT t_mailbox((builder_bu_confirm_code_request(:'t1', 'owner@client.test') ->> 'code_id')::uuid) IS NOT NULL
  FROM generate_series(1, 5);
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'t1', 'owner@client.test'),
                'We have sent 10 codes to this address today for this link.', 'ten a day to the address on a link');
SELECT t_eq((builder_bu_confirm_code_request(:'t3', 'owner@client.test') ->> 'ok')::boolean, true, 'the other links still take codes');
-- Over all links: 20 a day from one caller to one address (t1 10, t2 1, t3 1).
RESET ROLE;
SELECT pg_temp.an_hour_passes();
SET LOCAL ROLE anon;
SELECT t_mailbox((builder_bu_confirm_code_request(:'t2', 'owner@client.test') ->> 'code_id')::uuid) IS NOT NULL
  FROM generate_series(1, 4);
RESET ROLE;
SELECT pg_temp.an_hour_passes();
SET LOCAL ROLE anon;
SELECT t_mailbox((builder_bu_confirm_code_request(:'t3', 'owner@client.test') ->> 'code_id')::uuid) IS NOT NULL
  FROM generate_series(1, 4);
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'t2', 'owner@client.test'),
                'We have sent 20 codes to this address today from your connection, over all our links.',
                'twenty a day to the address over all links, said so');
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'t3', 'owner@client.test'),
                'over all our links', 'on every link');
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.99"}', true);
SELECT t_eq((builder_bu_confirm_code_request(:'t2', 'owner@client.test') ->> 'ok')::boolean, true, 'another caller is not held up');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM builder_bu_confirm_codes WHERE email = 'owner@client.test' AND caller = '203.0.113.7')::int, 20,
            'twenty codes to the owner from that caller');
SELECT t_eq((SELECT count(*) FROM pg_proc WHERE proname = 'builder_bu_confirm_code_request'
               AND prosrc LIKE '%this page asked for%')::int, 0, 'no limit points at a code "this page asked for"');
ROLLBACK;

-- (a) The repro (p_multilink): staff send six separate requests To the owner
-- (A-101, A-102, A-103, A-106, A-107, A-108; several BU events of a client's
-- projects give the same picture). The owner, on one connection, asks one
-- code on each link and types it: all six are proved.
BEGIN;
\ir fixtures.psql
INSERT INTO builder_units (id, project_id, unit_no, sort_order) VALUES
  ('a1000000-0000-0000-0000-000000000006', 'b1000000-0000-0000-0000-000000000001', 'A-106', 6),
  ('a1000000-0000-0000-0000-000000000007', 'b1000000-0000-0000-0000-000000000001', 'A-107', 7),
  ('a1000000-0000-0000-0000-000000000008', 'b1000000-0000-0000-0000-000000000001', 'A-108', 8);
INSERT INTO builder_bu_event_units (bu_event_id, unit_id, cut_off_date, booked_at_cutoff, agreement_value) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000006', '2026-09-15', true, 4000000),
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000007', '2026-09-15', true, 4000000),
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000008', '2026-09-15', true, 4000000);
SET LOCAL ROLE anon;
CREATE TEMP TABLE toks (n int, tok text);
INSERT INTO toks SELECT n, t_send(ARRAY[u]::uuid[], ARRAY['owner@client.test'], NULL) ->> 'token'
  FROM (VALUES (1, 'a1000000-0000-0000-0000-000000000001'::uuid), (2, 'a1000000-0000-0000-0000-000000000002'),
               (3, 'a1000000-0000-0000-0000-000000000003'), (4, 'a1000000-0000-0000-0000-000000000006'),
               (5, 'a1000000-0000-0000-0000-000000000007'), (6, 'a1000000-0000-0000-0000-000000000008')) v(n, u) ORDER BY n;
UPDATE email_outbox SET status = 'sent', sent_at = now();
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.10"}', true);
CREATE TEMP TABLE got (n int, result text);
DO $$
DECLARE t record; v jsonb; c text;
BEGIN
  FOR t IN SELECT * FROM toks ORDER BY n LOOP
    BEGIN
      v := builder_bu_confirm_code_request(t.tok, 'owner@client.test');
      c := t_mailbox((v ->> 'code_id')::uuid);
      v := builder_bu_confirm_code_verify(t.tok, 'owner@client.test', c, (v ->> 'code_id')::uuid);
      INSERT INTO got VALUES (t.n, CASE WHEN (v ->> 'ok')::boolean THEN 'proved' ELSE v ->> 'message' END);
    EXCEPTION WHEN check_violation THEN
      INSERT INTO got VALUES (t.n, 'REFUSED: ' || SQLERRM);
    END;
  END LOOP;
END $$;
SELECT t_eq((SELECT string_agg(n || ':' || result, ', ' ORDER BY n) FROM got),
            '1:proved, 2:proved, 3:proved, 4:proved, 5:proved, 6:proved', 'six links, one code each: all six proved');
-- And each answers its unit as the owner.
SELECT t_eq((SELECT string_agg(t_states(tok), ',' ORDER BY n) FROM toks),
            'A-101:PENDING,A-102:PENDING,A-103:PENDING,A-106:PENDING,A-107:PENDING,A-108:PENDING', 'nothing answered yet');
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
SELECT t_eq((SELECT count(*) FROM got WHERE refused LIKE 'We have sent 10 codes to this address today for this link.%')::int, 40,
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
