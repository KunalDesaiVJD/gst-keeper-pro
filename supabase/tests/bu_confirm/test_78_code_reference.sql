-- Another caller's code is not "the latest e-mail" (20261021160000, finding of
-- 21 Oct 2026, low). The owner's page asked for a code; another holder of the
-- link asked one for the same address right after (or a colleague sharing
-- the mailbox did). The owner typed the newest code in the mailbox, the other
-- caller's, because the page said "check the latest e-mail from us": 5 wrong
-- tries ended the owner's own code, and a second round locked the owner out
-- for the day. Now every code has a reference (4 letters from its id) that
-- the e-mail, the page and the messages name, and another e-mail's code is
-- said to be that and not counted. Every call as the public key.

-- The reference: the same 4 letters the Edge Function and the page work out.
BEGIN;
SELECT t_eq(builder_bu_confirm_code_ref('3fa90000-0000-4000-8000-000000000000'), 'DRLK', 'the reference of a known id');
SELECT t_eq(builder_bu_confirm_code_ref('0123abcd-ef01-4000-8000-000000000000'), 'ABCD', 'its digits read as letters');
SELECT t_eq((SELECT bool_and(builder_bu_confirm_code_ref(gen_random_uuid()) ~ '^[A-HJ-NP-R]{4}$') FROM generate_series(1, 200)), true,
            'four letters, never a digit, an I or an O');
SET LOCAL ROLE anon;
SELECT t_raises('SELECT builder_bu_confirm_code_ref(gen_random_uuid())', 'permission denied', 'a helper, closed to the public key');
ROLLBACK;

-- The repro (p_latest), as the public key.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[], ARRAY['owner@client.test'], NULL) ->> 'token' AS tok \gset
-- The owner's page asks for a code: it learns the code's reference.
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.10"}', true);
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') AS r \gset
SELECT :'r'::jsonb ->> 'code_id' AS own, :'r'::jsonb ->> 'ref' AS own_ref \gset
SELECT t_eq(:'own_ref' ~ '^[A-HJ-NP-R]{4}$', true, 'the request returns the code''s reference');
RESET ROLE;
SELECT t_eq(builder_bu_confirm_code_ref(:'own'), :'own_ref', 'the reference of that code''s id');
SET LOCAL ROLE anon;
SELECT t_mailbox(:'own') AS own_code \gset
-- Someone else asks one for the same address right after; it is the newest
-- in the owner's mailbox.
SELECT set_config('request.headers', '{"cf-connecting-ip": "203.0.113.66"}', true);
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id' AS oth \gset
SELECT t_mailbox(:'oth') AS oth_code \gset
-- The owner types the other caller's code, five times.
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.10"}', true);
SELECT t_eq(builder_bu_confirm_code_verify(:'tok', 'owner@client.test', :'oth_code', :'own') ->> 'message',
            format('That is the code from another of our e-mails to this address. Please type the code from the e-mail marked %s.', :'own_ref'),
            'another e-mail''s code is said to be that, and the right e-mail is named');
SELECT builder_bu_confirm_code_verify(:'tok', 'owner@client.test', :'oth_code', :'own') FROM generate_series(1, 4);
RESET ROLE;
SELECT t_eq((SELECT wrong_tries FROM builder_bu_confirm_codes WHERE id = :'own'), 0, 'and is not counted as a wrong try');
SET LOCAL ROLE anon;
SELECT t_eq((builder_bu_confirm_code_verify(:'tok', 'owner@client.test', :'own_code', :'own') ->> 'ok')::boolean, true,
            'the owner''s own code then works');
-- A second round, and a fresh code: never locked out by the other caller.
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id' AS own2 \gset
SELECT t_mailbox(:'own2') AS own2_code \gset
SELECT set_config('request.headers', '{"cf-connecting-ip": "203.0.113.66"}', true);
SELECT t_mailbox((builder_bu_confirm_code_request(:'tok', 'owner@client.test') ->> 'code_id')::uuid) AS oth2_code \gset
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.10"}', true);
SELECT builder_bu_confirm_code_verify(:'tok', 'owner@client.test', :'oth2_code', :'own2') FROM generate_series(1, 5);
SELECT t_eq((builder_bu_confirm_code_verify(:'tok', 'owner@client.test', :'own2_code', :'own2') ->> 'ok')::boolean, true,
            'second round: still the owner''s code works');
-- An earlier code of the owner's own, typed against the newer one: the same.
SELECT builder_bu_confirm_code_request(:'tok', 'owner@client.test') AS r3 \gset
SELECT :'r3'::jsonb ->> 'code_id' AS own3, :'r3'::jsonb ->> 'ref' AS own3_ref \gset
SELECT t_mailbox(:'own3') AS own3_code \gset
SELECT t_eq(builder_bu_confirm_code_verify(:'tok', 'owner@client.test', :'own2_code', :'own3') ->> 'message',
            format('That is the code from another of our e-mails to this address. Please type the code from the e-mail marked %s.', :'own3_ref'),
            'an earlier e-mail''s code: named, not counted');
-- A plain wrong code is counted, and names the e-mail too (not "the latest").
SELECT x AS wrong FROM (VALUES ('000000'), ('111111'), ('222222'), ('333333'), ('444444'), ('555555')) v(x)
 WHERE x NOT IN (:'own_code', :'oth_code', :'own2_code', :'oth2_code', :'own3_code') LIMIT 1 \gset
SELECT t_eq(builder_bu_confirm_code_verify(:'tok', 'owner@client.test', :'wrong', :'own3') ->> 'message',
            format('That code is not right. Please type the code from our e-mail marked %s.', :'own3_ref'),
            'a wrong code points at the e-mail by its reference');
RESET ROLE;
SELECT t_eq((SELECT wrong_tries FROM builder_bu_confirm_codes WHERE id = :'own3'), 1, 'counted');
SELECT t_eq((SELECT count(*) FROM pg_proc WHERE proname LIKE 'builder_bu_confirm_code_%'
               AND prosrc LIKE '%latest e-mail%')::int, 0, 'no message points at "the latest e-mail"');
ROLLBACK;

-- Two people sharing one mailbox (accounts@...), each on their own page,
-- interleaved: each types the code their own page asked for.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[],
              ARRAY['accounts@client.test'], NULL) ->> 'token' AS tok \gset
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.21"}', true);
SELECT builder_bu_confirm_code_request(:'tok', 'accounts@client.test') ->> 'code_id' AS a \gset
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.22"}', true);
SELECT builder_bu_confirm_code_request(:'tok', 'accounts@client.test') ->> 'code_id' AS b \gset
SELECT t_mailbox(:'a') AS a_code \gset
SELECT t_mailbox(:'b') AS b_code \gset
-- Each first types the other's (the newest they saw), then their own.
SELECT t_eq((builder_bu_confirm_code_verify(:'tok', 'accounts@client.test', :'b_code', :'a') ->> 'other_code')::boolean, true, 'A typed B''s code: told so');
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.21"}', true);
SELECT t_eq((builder_bu_confirm_code_verify(:'tok', 'accounts@client.test', :'a_code', :'a') ->> 'ok')::boolean, true, 'A''s own code works');
SELECT set_config('request.headers', '{"cf-connecting-ip": "198.51.100.22"}', true);
SELECT t_eq((builder_bu_confirm_code_verify(:'tok', 'accounts@client.test', :'a_code', :'b') ->> 'other_code')::boolean, true, 'B typed A''s code: told so');
SELECT t_eq((builder_bu_confirm_code_verify(:'tok', 'accounts@client.test', :'b_code', :'b') ->> 'ok')::boolean, true, 'B''s own code works');
ROLLBACK;
