-- Run as the service role, as the Edge Functions do; then as anon and authenticated.
\set owner '''11111111-1111-1111-1111-111111111111'''
\set manager '''22222222-2222-2222-2222-222222222222'''
\set staff '''33333333-3333-3333-3333-333333333333'''

CREATE FUNCTION pg_temp.raises(sql text, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RAISE EXCEPTION 'expected an error containing "%" from: %', msg, sql;
EXCEPTION WHEN OTHERS THEN
  IF position(msg IN SQLERRM) = 0 THEN RAISE EXCEPTION 'expected "%", got "%" from: %', msg, SQLERRM, sql; END IF;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.raises(text, text) TO PUBLIC;

SET ROLE service_role;
-- Nothing saved yet.
DO $$ BEGIN ASSERT (public.ai_api_key_read() ->> 'key') IS NULL, 'no key at first'; END $$;
DO $$ BEGIN ASSERT (public.ai_api_key_status('11111111-1111-1111-1111-111111111111') ->> 'saved')::boolean = false; END $$;

-- An employee, a wrong password, a malformed key: refused.
SELECT pg_temp.raises(format('SELECT public.ai_api_key_status(%L)', :staff), 'Only a GST Manager or the superadmin');
SELECT pg_temp.raises(format('SELECT public.ai_api_key_set(%L, %L, %L)', :staff, 'staff-pass', 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa1234'), 'Only a GST Manager or the superadmin');
SELECT pg_temp.raises(format('SELECT public.ai_api_key_set(%L, %L, %L)', :owner, 'wrong', 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa1234'), 'Your password is not correct.');
SELECT pg_temp.raises(format('SELECT public.ai_api_key_set(%L, NULL, %L)', :owner, 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa1234'), 'Your password is not correct.');
SELECT pg_temp.raises(format('SELECT public.ai_api_key_set(%L, %L, %L)', :owner, 'owner-pass', 'sk-proj-aaaaaaaaaaaaaaaaaaaaaaaa1234'), 'must start with sk-ant-');

-- Save: the key in Vault, only its mask and who saved it in the table.
DO $$ DECLARE s jsonb; BEGIN
  s := public.ai_api_key_set('11111111-1111-1111-1111-111111111111', 'owner-pass', '  sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa1234 ');
  ASSERT s ->> 'masked' = 'sk-ant-…1234', 'masked ' || s::text;
  ASSERT s ->> 'saved_by_name' = 'Owner' AND s ->> 'saved_at' IS NOT NULL AND (s ->> 'saved')::boolean;
  ASSERT NOT (s::text LIKE '%aaaaaaaa%'), 'the status never carries the key';
  ASSERT public.ai_api_key_read() ->> 'key' = 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa1234';
  ASSERT NOT EXISTS (SELECT 1 FROM public.ai_api_key WHERE row_to_json(ai_api_key)::text LIKE '%aaaaaaaa%'), 'the table holds no key';
END $$;

-- Replace (a GST Manager): the same Vault secret, updated.
DO $$ DECLARE s jsonb; BEGIN
  s := public.ai_api_key_set('22222222-2222-2222-2222-222222222222', 'manager-pass', 'sk-ant-api03-bbbbbbbbbbbbbbbbbbbbbbbbb9z8y');
  ASSERT s ->> 'masked' = 'sk-ant-…9z8y' AND s ->> 'saved_by_name' = 'Manager';
  ASSERT public.ai_api_key_read() ->> 'key' = 'sk-ant-api03-bbbbbbbbbbbbbbbbbbbbbbbbb9z8y';
  ASSERT (SELECT count(*) FROM vault.secrets WHERE name = 'gst_keeper_claude_api_key') = 1;
END $$;

-- Remove: refused without the password; then nothing left in Vault or the table.
SELECT pg_temp.raises(format('SELECT public.ai_api_key_remove(%L, %L)', :owner, 'nope'), 'Your password is not correct.');
DO $$ DECLARE s jsonb; BEGIN
  s := public.ai_api_key_remove('11111111-1111-1111-1111-111111111111', 'owner-pass');
  ASSERT (s ->> 'saved')::boolean = false AND s ->> 'masked' IS NULL;
  ASSERT (public.ai_api_key_read() ->> 'key') IS NULL;
  ASSERT (SELECT secret FROM vault.secrets WHERE name = 'gst_keeper_claude_api_key') = '', 'the Vault copy is blanked';
END $$;

-- Save again after a removal reuses the secret.
DO $$ BEGIN
  PERFORM public.ai_api_key_set('11111111-1111-1111-1111-111111111111', 'owner-pass', 'sk-ant-api03-cccccccccccccccccccccccccc5555');
  ASSERT public.ai_api_key_read() ->> 'key' = 'sk-ant-api03-cccccccccccccccccccccccccc5555';
  PERFORM public.ai_api_key_log_test('11111111-1111-1111-1111-111111111111', 'ok');
  ASSERT (SELECT string_agg(action, ',' ORDER BY id) FROM public.ai_api_key_log) = 'saved,saved,removed,saved,tested';
END $$;
RESET ROLE;

-- The browser's roles: no rows, no calls.
SET ROLE anon;
SELECT pg_temp.raises('SELECT * FROM public.ai_api_key', 'permission denied');
SELECT pg_temp.raises('SELECT * FROM public.ai_api_key_log', 'permission denied');
SELECT pg_temp.raises('SELECT public.ai_api_key_read()', 'permission denied');
SELECT pg_temp.raises(format('SELECT public.ai_api_key_status(%L)', :owner), 'permission denied');
SELECT pg_temp.raises(format('SELECT public.ai_api_key_set(%L, %L, %L)', :owner, 'owner-pass', 'sk-ant-api03-dddddddddddddddddddddddd0000'), 'permission denied');
SELECT pg_temp.raises(format('SELECT public.ai_api_key_remove(%L, %L)', :owner, 'owner-pass'), 'permission denied');
SELECT pg_temp.raises('SELECT public.ai_api_key_admin(NULL, NULL, false)', 'permission denied');
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.raises('SELECT * FROM public.ai_api_key', 'permission denied');
SELECT pg_temp.raises('SELECT public.ai_api_key_read()', 'permission denied');
RESET ROLE;
