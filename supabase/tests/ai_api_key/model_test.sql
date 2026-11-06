-- The model choice (20261104120000_ai_api_model.sql): set, shown, read, logged,
-- the prices following a listed model, and closed to anon / authenticated.
\set owner '''11111111-1111-1111-1111-111111111111'''
\set staff '''33333333-3333-3333-3333-333333333333'''

-- A stand-in for the settings row whose prices the choice sets.
CREATE TABLE IF NOT EXISTS public.ai_settings (id smallint PRIMARY KEY DEFAULT 1, price_in_per_mtok numeric, price_out_per_mtok numeric, updated_by_name text);
INSERT INTO public.ai_settings (id, price_in_per_mtok, price_out_per_mtok) VALUES (1, 2, 10) ON CONFLICT DO NOTHING;

CREATE FUNCTION pg_temp.raises2(sql text, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RAISE EXCEPTION 'expected an error containing "%" from: %', msg, sql;
EXCEPTION WHEN OTHERS THEN
  IF position(msg IN SQLERRM) = 0 THEN RAISE EXCEPTION 'expected "%", got "%" from: %', msg, SQLERRM, sql; END IF;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.raises2(text, text) TO PUBLIC;

SET ROLE service_role;
SELECT pg_temp.raises2(format('SELECT public.ai_api_model_set(%L, %L, %L)', :staff, 'claude-opus-5-5', 'Claude Opus 5.5'), 'Only a GST Manager or the superadmin');
SELECT pg_temp.raises2(format('SELECT public.ai_api_model_set(%L, %L, %L)', :owner, 'gpt-5', 'x'), 'That is not a Claude model.');
SELECT pg_temp.raises2(format('SELECT public.ai_api_model_set(%L, %L, %L)', :owner, 'claude-opus; drop', 'x'), 'That is not a Claude model.');

DO $$ DECLARE s jsonb; BEGIN
  s := public.ai_api_model_set('11111111-1111-1111-1111-111111111111', 'claude-opus-5-5', 'Claude Opus 5.5');
  ASSERT s ->> 'model' = 'claude-opus-5-5' AND s ->> 'model_name' = 'Claude Opus 5.5' AND s ->> 'model_set_by_name' = 'Owner', s::text;
  ASSERT public.ai_api_model_read() = 'claude-opus-5-5';
  ASSERT (SELECT price_in_per_mtok = 4 AND price_out_per_mtok = 20 FROM public.ai_settings), 'opus prices';
  -- The key's own status is untouched and still carries no key.
  ASSERT (public.ai_api_key_read() ->> 'key') = 'sk-ant-api03-cccccccccccccccccccccccccc5555';

  -- An unlisted model keeps the prices.
  PERFORM public.ai_api_model_set('11111111-1111-1111-1111-111111111111', 'claude-opus-4-8', 'Claude Opus 4.8');
  ASSERT (SELECT price_in_per_mtok = 4 FROM public.ai_settings), 'unlisted keeps prices';

  PERFORM public.ai_api_model_set('11111111-1111-1111-1111-111111111111', 'claude-haiku-5-5', 'Claude Haiku 5.5');
  ASSERT (SELECT price_in_per_mtok = 0.10 AND price_out_per_mtok = 0.50 FROM public.ai_settings), 'haiku prices';

  -- Back to the default: no model, Sonnet's prices.
  s := public.ai_api_model_set('11111111-1111-1111-1111-111111111111', NULL, NULL);
  ASSERT s ->> 'model' IS NULL AND s ->> 'model_name' IS NULL;
  ASSERT public.ai_api_model_read() IS NULL;
  ASSERT (SELECT price_in_per_mtok = 2 AND price_out_per_mtok = 10 FROM public.ai_settings), 'sonnet prices';
  ASSERT (SELECT count(*) FROM public.ai_api_model_log) = 4;
END $$;
RESET ROLE;

SET ROLE anon;
SELECT pg_temp.raises2('SELECT * FROM public.ai_api_model_log', 'permission denied');
SELECT pg_temp.raises2('SELECT public.ai_api_model_read()', 'permission denied');
SELECT pg_temp.raises2(format('SELECT public.ai_api_model_status(%L)', :owner), 'permission denied');
SELECT pg_temp.raises2(format('SELECT public.ai_api_model_set(%L, %L, NULL)', :owner, 'claude-opus-5-5'), 'permission denied');
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.raises2('SELECT public.ai_api_model_read()', 'permission denied');
SELECT pg_temp.raises2(format('SELECT public.ai_api_model_set(%L, %L, NULL)', :owner, 'claude-opus-5-5'), 'permission denied');
RESET ROLE;
