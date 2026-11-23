-- GST Assistant (23 Nov 2026): the in-app AI assistant of the GST module.
-- The Edge Function gst-assistant answers on the Claude API (Sonnet 5.5 at
-- medium effort, _shared/aiModel.ts), reads figures, and proposes changes that
-- the user applies on the screen itself, through the screen's own save (so
-- every guard, lock and the change log hold as for a typed change).
--
--   assistant_settings   one row: on / off, and whether it may fill figures.
--                        Open to public like every app table (CLAUDE.md); the
--                        page lets only superadmin / GST Manager change it.
--   assistant_usage      every request's tokens, per user: the record the
--                        firm asked for. Read by the app (open SELECT); written
--                        only by the Edge Function (service role): no insert,
--                        update or delete policy, so the anon key cannot alter
--                        or remove a record.
--   assistant_actions    what the assistant proposed and what the user did
--                        with it (applied, cancelled, failed). Open to public.
--   assistant_knowledge  the firm's docs split by heading and the table
--                        columns, replaced on every push to main by
--                        .github/workflows/assistant-knowledge.yml through
--                        assistant_knowledge_replace. Private: RLS on and no
--                        policies (like portal_sessions); read only by the Edge
--                        Function with the service role.

CREATE TABLE IF NOT EXISTS public.assistant_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  allow_fill boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO public.assistant_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.assistant_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_settings_public ON public.assistant_settings;
CREATE POLICY assistant_settings_public ON public.assistant_settings FOR ALL TO public USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.assistant_usage (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  user_name text,
  user_role text,
  conversation_id uuid,
  route text,
  model text NOT NULL,
  calls integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cache_read_tokens bigint NOT NULL DEFAULT 0,
  cache_write_tokens bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'refused')),
  error text
);
CREATE INDEX IF NOT EXISTS assistant_usage_user_at ON public.assistant_usage (user_id, at DESC);
CREATE INDEX IF NOT EXISTS assistant_usage_at ON public.assistant_usage (at DESC);
ALTER TABLE public.assistant_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_usage_read ON public.assistant_usage;
CREATE POLICY assistant_usage_read ON public.assistant_usage FOR SELECT TO public USING (true);

CREATE TABLE IF NOT EXISTS public.assistant_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  conversation_id uuid,
  route text,
  client_id uuid,
  period text,
  kind text NOT NULL CHECK (kind IN ('navigate', 'guide', 'fill')),
  title text,
  proposal jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'applied', 'saved', 'cancelled', 'failed')),
  result text,
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS assistant_actions_user_at ON public.assistant_actions (user_id, at DESC);
ALTER TABLE public.assistant_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_actions_public ON public.assistant_actions;
CREATE POLICY assistant_actions_public ON public.assistant_actions FOR ALL TO public USING (true) WITH CHECK (true);

-- Tokens per user and month, for Settings → AI Assistant.
CREATE OR REPLACE VIEW public.assistant_usage_monthly AS
SELECT
  to_char(at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS month,
  user_id,
  max(user_name) AS user_name,
  max(user_role) AS user_role,
  count(*)::integer AS requests,
  sum(calls)::integer AS calls,
  sum(input_tokens)::bigint AS input_tokens,
  sum(output_tokens)::bigint AS output_tokens,
  sum(cache_read_tokens)::bigint AS cache_read_tokens,
  sum(cache_write_tokens)::bigint AS cache_write_tokens,
  (sum(input_tokens) + sum(cache_read_tokens) + sum(cache_write_tokens) + sum(output_tokens))::bigint AS total_tokens,
  max(at) AS last_used_at
FROM public.assistant_usage
GROUP BY 1, 2;

CREATE TABLE IF NOT EXISTS public.assistant_knowledge (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  commit_sha text,
  built_at timestamptz,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  docs jsonb NOT NULL DEFAULT '[]'::jsonb,
  tables jsonb NOT NULL DEFAULT '[]'::jsonb
);
ALTER TABLE public.assistant_knowledge ENABLE ROW LEVEL SECURITY;
-- No policies: the anon key reads and writes nothing here.

CREATE OR REPLACE FUNCTION public.assistant_knowledge_replace(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF jsonb_typeof(p -> 'docs') <> 'array' OR jsonb_typeof(p -> 'tables') <> 'array' THEN
    RAISE EXCEPTION 'assistant_knowledge_replace: docs and tables must be arrays';
  END IF;
  INSERT INTO public.assistant_knowledge (id, commit_sha, built_at, loaded_at, docs, tables)
  VALUES (true, p ->> 'commit', nullif(p ->> 'builtAt', '')::timestamptz, now(), p -> 'docs', p -> 'tables')
  ON CONFLICT (id) DO UPDATE SET commit_sha = EXCLUDED.commit_sha, built_at = EXCLUDED.built_at,
    loaded_at = now(), docs = EXCLUDED.docs, tables = EXCLUDED.tables;
  RETURN jsonb_build_object('docs', jsonb_array_length(p -> 'docs'), 'tables', jsonb_array_length(p -> 'tables'));
END;
$$;
REVOKE ALL ON FUNCTION public.assistant_knowledge_replace(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_knowledge_replace(jsonb) TO service_role;

-- What the settings page may show about the knowledge (never its text).
CREATE OR REPLACE FUNCTION public.assistant_knowledge_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT jsonb_build_object('commit', commit_sha, 'built_at', built_at, 'loaded_at', loaded_at,
    'docs', jsonb_array_length(docs), 'tables', jsonb_array_length(tables)) FROM public.assistant_knowledge), '{}'::jsonb);
$$;
GRANT EXECUTE ON FUNCTION public.assistant_knowledge_status() TO anon, authenticated;
