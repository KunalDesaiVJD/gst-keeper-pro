-- The Claude model the AI uses, chosen from the app (4 November 2026, Meet:
-- "provide model selection as well", "latest selection as well").
--
-- A GST Manager or the superadmin picks the model under Reply Factory → AI →
-- Claude API key, from the list Anthropic's Models API gives for the key in use
-- (the Edge Function ai-key lists it and checks the choice against it). The
-- choice is kept on the one ai_api_key row; the Edge Functions read it through
-- ai_api_model_read() with the key, and use Sonnet 5.5 when nothing is chosen.
-- The effort stays medium for every call. Choosing a model Anthropic prices
-- differently also sets the prices the daily caps are estimated with
-- (ai_settings.price_in_per_mtok / price_out_per_mtok), Anthropic's list prices
-- per million tokens as published in November 2026; an unlisted model keeps the
-- prices as they are.
--
-- Additive only: new columns, a new log table and new functions. Like the key's
-- own tables, RLS is on with no policies and every function is executable by the
-- service role only. docs/CLAUDE_API_KEY.md.

BEGIN;

ALTER TABLE public.ai_api_key ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE public.ai_api_key ADD COLUMN IF NOT EXISTS model_name text;
ALTER TABLE public.ai_api_key ADD COLUMN IF NOT EXISTS model_set_by_name text;
ALTER TABLE public.ai_api_key ADD COLUMN IF NOT EXISTS model_set_at timestamptz;

CREATE TABLE IF NOT EXISTS public.ai_api_model_log (
  id         bigserial PRIMARY KEY,
  actor_id   uuid,
  actor_name text,
  model      text,
  model_name text,
  at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_api_model_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_api_model_log FROM anon, authenticated;

-- What may be shown about the choice.
CREATE OR REPLACE FUNCTION public.ai_api_model_status(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.ai_api_key;
BEGIN
  PERFORM public.ai_api_key_admin(p_actor_id, NULL, false);
  SELECT * INTO r FROM public.ai_api_key WHERE id = 1;
  RETURN jsonb_build_object(
    'model', r.model,
    'model_name', r.model_name,
    'model_set_by_name', r.model_set_by_name,
    'model_set_at', r.model_set_at);
END;
$$;

-- The choice, already checked by ai-key against Anthropic's live list; null
-- goes back to the default (Sonnet 5.5).
CREATE OR REPLACE FUNCTION public.ai_api_model_set(p_actor_id uuid, p_model text, p_model_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name  text;
  v_model text := nullif(btrim(coalesce(p_model, '')), '');
  v_label text := left(nullif(btrim(coalesce(p_model_name, '')), ''), 80);
  v_in    numeric;
  v_out   numeric;
BEGIN
  v_name := public.ai_api_key_admin(p_actor_id, NULL, false);
  IF v_model IS NOT NULL AND v_model !~ '^claude-[a-z0-9][a-z0-9.-]{2,60}$' THEN
    RAISE EXCEPTION 'That is not a Claude model.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.ai_api_key (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  UPDATE public.ai_api_key
     SET model = v_model, model_name = CASE WHEN v_model IS NULL THEN NULL ELSE v_label END,
         model_set_by_name = v_name, model_set_at = now()
   WHERE id = 1;
  INSERT INTO public.ai_api_model_log (actor_id, actor_name, model, model_name) VALUES (p_actor_id, v_name, v_model, v_label);

  -- Anthropic's list prices (USD per million tokens, input / output).
  SELECT p.i, p.o INTO v_in, v_out FROM (VALUES
    ('claude-haiku-5-5', 0.10, 0.50),
    ('claude-sonnet-5-5', 2, 10),
    ('claude-opus-5-5', 4, 20),
    ('claude-fable-5-1', 10, 50)
  ) AS p(m, i, o) WHERE p.m = coalesce(v_model, 'claude-sonnet-5-5');
  IF v_in IS NOT NULL THEN
    UPDATE public.ai_settings SET price_in_per_mtok = v_in, price_out_per_mtok = v_out, updated_by_name = v_name WHERE id IS NOT NULL;
  END IF;

  RETURN public.ai_api_model_status(p_actor_id);
END;
$$;

-- For the Edge Functions (service role only): the chosen model id, or null.
CREATE OR REPLACE FUNCTION public.ai_api_model_read()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT model FROM public.ai_api_key WHERE id = 1;
$$;

REVOKE EXECUTE ON FUNCTION public.ai_api_model_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_api_model_set(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_api_model_read() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_api_model_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_api_model_set(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_api_model_read() TO service_role;

COMMIT;
