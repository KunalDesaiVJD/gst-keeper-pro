-- Another reader cannot lock a To or CC address out (round 3, low defect:
-- anyone holding the link typed wrong codes "as" the owner's address, asked
-- for a new code and typed more, and the owner's right code was then refused
-- for a day; asking codes for the owner's address used up the owner's
-- limits). A code is now typed back with the code_id the asking page got
-- (the digits go to the mailbox, the id stays on that page), so a stranger's
-- wrong tries fall on their own codes; and the limits count per caller (the
-- IP the request came from), with higher caps per address and per link.
-- A code the mailer never claimed says it was not sent (round 3, low).
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'],
              ARRAY['site@client.test', 'accounts@client.test', 'partner@client.test']) ->> 'token' AS tok \gset

-- The owner (198.51.100.7) asks for a code; it reaches the owner's mailbox.
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.7"}', true);
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id' AS owner_id \gset
SELECT t_mailbox(:'owner_id') AS owner_code \gset

-- Someone else holding the link (203.0.113.5), the pc_dos repro: wrong codes
-- as the owner. Without the owner's code_id they reach no code at all.
SELECT set_config('request.headers', '{"cf-connecting-ip": "203.0.113.5"}', true);
SELECT t_eq(builder_bu_confirm_code_verify(:'tok', 'owner@client.test', '000001', gen_random_uuid()) ->> 'message',
            'Please ask for a code first, then type it here.', 'a made-up code id reaches nothing');
SELECT t_eq(builder_bu_confirm_code_verify(:'tok', 'owner@client.test', '000001', NULL) ->> 'message',
            'Please ask for a code first, then type it here.', 'nor does none');
-- They ask codes for the owner's address themselves and type wrong ones,
-- until their own limits stop them.
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id' AS a1 \gset
SELECT t_mailbox(:'a1') IS NOT NULL;
SELECT builder_bu_confirm_code_verify(:'tok', 'owner@client.test', '000001', :'a1') FROM generate_series(1, 5);
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id' AS a2 \gset
SELECT t_mailbox(:'a2') IS NOT NULL;
SELECT builder_bu_confirm_code_verify(:'tok', 'owner@client.test', '000001', :'a2') FROM generate_series(1, 5);
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id' AS a3 \gset
SELECT t_mailbox(:'a3') AS a3_code \gset
SELECT t_eq(builder_bu_confirm_code_verify(:'tok', 'owner@client.test', :'a3_code', :'a3') ->> 'message',
            'Too many wrong codes for this address today. Please try again tomorrow, or write to us at gst@vjdesai.com.',
            'ten wrong tries lock that caller out for the day');
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') IS NOT NULL FROM generate_series(1, 2);
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tok', 'owner@client.test'),
                '5 codes to this address in the last hour', 'and five codes an hour from that caller');
-- The owner's own code still works, and the owner may still ask.
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.7"}', true);
SELECT t_eq((builder_bu_confirm_code_verify(:'tok', 'owner@client.test', :'owner_code', :'owner_id') ->> 'ok')::boolean, true,
            'the owner''s right code is taken');
SELECT t_eq((builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'ok')::boolean, true, 'and the owner can ask for another');
ROLLBACK;

-- The caps behind the per-caller limits.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'],
              ARRAY['site@client.test', 'accounts@client.test', 'partner@client.test', 'fifth@client.test']) ->> 'token' AS tok \gset
-- One caller, twenty codes an hour on a link, whatever the address.
SELECT set_config('request.headers', '{"x-forwarded-for": "203.0.113.5, 10.0.0.1"}', true);
SELECT builder_bu_confirm_code_request(:'tok', a) IS NOT NULL
  FROM unnest(ARRAY['site@client.test', 'accounts@client.test', 'partner@client.test', 'fifth@client.test']) a, generate_series(1, 5);
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tok', 'owner@client.test'),
                'Too many codes were asked for from your connection in the last hour', 'twenty from one caller in an hour: refused');
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.7"}', true);
SELECT t_eq((builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'ok')::boolean, true, 'another caller is not held up');
RESET ROLE;
SELECT t_eq((SELECT count(DISTINCT requested_ip)::int FROM builder_bu_confirm_codes), 2, 'each code keeps its caller');
-- Thirty codes e-mailed a day to one address in all, whoever asked: from a
-- caller's third code of the day on (the first two are never refused by it).
DELETE FROM builder_bu_confirm_codes;
INSERT INTO builder_bu_confirm_codes (request_id, email, requested_ip, created_at, claimed_at, sent_at)
SELECT id, 'owner@client.test', '192.0.2.' || g, now() - interval '3 hours', now() - interval '3 hours', now() - interval '3 hours'
  FROM builder_bu_confirm_requests, generate_series(1, 30) g;
SET LOCAL ROLE anon;
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.8"}', true);
SELECT t_eq((builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'ok')::boolean, true, 'thirty e-mailed: a fresh caller''s first code goes');
SELECT t_eq((builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'ok')::boolean, true, 'and the second');
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tok', 'owner@client.test'),
                'Too many codes were e-mailed to this address today', 'the third is refused: the mailbox is not flooded');
SELECT t_eq((builder_bu_confirm_code_request(:'tok', 'site@client.test') ->> 'ok')::boolean, true, 'another address is not');
-- Codes asked for and never e-mailed do not count.
RESET ROLE;
DELETE FROM builder_bu_confirm_codes;
INSERT INTO builder_bu_confirm_codes (request_id, email, requested_ip, created_at)
SELECT id, 'owner@client.test', '192.0.2.' || g, now() - interval '3 hours' FROM builder_bu_confirm_requests, generate_series(1, 40) g;
SET LOCAL ROLE anon;
SELECT t_eq((SELECT count(*) FROM generate_series(1, 4) WHERE (builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'ok')::boolean)::int,
            4, 'forty never e-mailed: four more from one caller go');
-- Sixty e-mailed an hour on a link in all, the same way.
RESET ROLE;
DELETE FROM builder_bu_confirm_codes;
INSERT INTO builder_bu_confirm_codes (request_id, email, requested_ip, claimed_at, sent_at)
SELECT id, 'other' || g || '@client.test', '192.0.2.' || g, now(), now() FROM builder_bu_confirm_requests, generate_series(1, 60) g;
SET LOCAL ROLE anon;
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.9"}', true);
SELECT t_eq((builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'ok')::boolean, true, 'sixty e-mailed on the link: a first code goes');
SELECT t_eq((builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'ok')::boolean, true, 'and a second');
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tok', 'owner@client.test'),
                'Too many codes were asked for on this link', 'sixty on a link in an hour: the third is refused');
ROLLBACK;

-- A code the mailer never claimed (the Edge Function not deployed, or it
-- failed before minting it): the page is told it was not sent, not to ask first.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'token' AS tok \gset
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id' AS cid \gset
SELECT t_eq(builder_bu_confirm_code_verify(:'tok', 'owner@client.test', '123456', :'cid') ->> 'message',
            'We could not e-mail that code. Please ask for a new one.', 'never claimed: not sent');
-- A code id from another link, or for another address, reaches nothing.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000002']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'token' AS tok2 \gset
SELECT t_eq(builder_bu_confirm_code_verify(:'tok2', 'owner@client.test', '123456', :'cid') ->> 'message',
            'Please ask for a code first, then type it here.', 'another link');
ROLLBACK;

-- Other callers cannot lock a To or CC address out (round 4, low: six callers
-- asking 5 codes each for the owner's address, inside their own limits and
-- never e-mailed, used up the 30 a day over all callers; six more did the
-- same for the CC address and the link's 60 an hour; the owner was then
-- refused their first code for a day, with nothing in their mailbox to say
-- why). As p4_lockout and dos_caps, every call as the public key.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], ARRAY['site@client.test']) ->> 'sent';
-- The token and the To list are readable with the public key.
SELECT token AS tok FROM builder_bu_confirm_requests LIMIT 1 \gset
SELECT set_config('my.tok', :'tok', true);
DO $$
DECLARE i int; j int; t text := current_setting('my.tok');
BEGIN
  FOR i IN 1..6 LOOP
    PERFORM set_config('request.headers', json_build_object('cf-connecting-ip', '203.0.113.' || i)::text, true);
    FOR j IN 1..5 LOOP PERFORM builder_bu_confirm_code_request(t, 'owner@client.test'); END LOOP;
  END LOOP;
  FOR i IN 11..16 LOOP
    PERFORM set_config('request.headers', json_build_object('cf-connecting-ip', '203.0.113.' || i)::text, true);
    FOR j IN 1..5 LOOP PERFORM builder_bu_confirm_code_request(t, 'site@client.test'); END LOOP;
  END LOOP;
END $$;
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.7"}', true);
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id' AS owner_id \gset
SELECT t_eq(:'owner_id' <> '', true, 'the owner, from their own IP, gets their first code');
SELECT t_eq((builder_bu_confirm_code_verify(:'tok', 'owner@client.test', t_mailbox(:'owner_id'), :'owner_id') ->> 'ok')::boolean, true,
            'and proves the address with it');
SELECT set_config('request.headers', '{"cf-connecting-ip": "192.0.2.55"}', true);
SELECT t_eq((builder_bu_confirm_code_request(:'tok', 'site@client.test') ->> 'ok')::boolean, true, 'so does the CC, past sixty asked on the link');
-- Seven more callers, now having the mailer send every code, until thirty
-- and more are e-mailed to the owner in a day. The owner's first two still go.
DO $$
DECLARE i int; j int; t text := current_setting('my.tok');
BEGIN
  FOR i IN 21..27 LOOP
    PERFORM set_config('request.headers', json_build_object('cf-connecting-ip', '203.0.113.' || i)::text, true);
    FOR j IN 1..5 LOOP
      BEGIN
        PERFORM t_mailbox((builder_bu_confirm_code_request(t, 'owner@client.test') ->> 'code_id')::uuid);
      EXCEPTION WHEN check_violation THEN
        NULL;  -- the cap stops them too, from their third code on
      END;
    END LOOP;
  END LOOP;
END $$;
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.77"}', true);
SELECT t_eq((SELECT count(*) FROM generate_series(1, 2) WHERE (builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'ok')::boolean)::int,
            2, 'the owner on another network: two codes');
SELECT t_raises(format('SELECT builder_bu_confirm_code_request(%L, %L)', :'tok', 'owner@client.test'),
                'Too many codes were e-mailed to this address today', 'a third, past thirty e-mailed, is refused');
RESET ROLE;
SELECT t_eq((SELECT count(*) FILTER (WHERE sent_at IS NOT NULL) FROM builder_bu_confirm_codes WHERE email = 'owner@client.test')::int,
            32, 'one by the owner, then the others until the cap: 25, 4 and the last caller''s first 2');
ROLLBACK;
