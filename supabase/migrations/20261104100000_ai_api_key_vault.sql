-- The Claude API key, saved from the app (4 November 2026, Meet: "replace the
-- Vercel Sandbox AI analysis with direct calls to the Claude API").
--
-- The key itself lives only in Supabase Vault (vault.create_secret /
-- vault.update_secret, encrypted at rest). This migration keeps the secret's id
-- and what may be shown about it: the masked value (sk-ant-…a1b2), who saved it
-- and when. Nothing here is readable by the browser: both tables have RLS on and
-- no policies (like portal_sessions), and every function is executable by the
-- service role only, so only the Edge Functions reach them (ai-key to save,
-- test and remove; notice-ai, notice-appeal-ai and notice-link-ai to read the
-- key). A save or a removal needs a superadmin or a GST Manager, proved by their
-- own password, checked here as well as in the Edge Function.
--
-- The Edge Functions use this key first, then their ANTHROPIC_API_KEY secret.
-- Additive only: two new tables and new functions. docs/CLAUDE_API_KEY.md.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_api_key (
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  vault_secret_id uuid,
  masked          text,
  last4           text,
  saved_by        uuid,
  saved_by_name   text,
  saved_at        timestamptz,
  version         integer NOT NULL DEFAULT 0
);
ALTER TABLE public.ai_api_key ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_api_key FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.ai_api_key_log (
  id         bigserial PRIMARY KEY,
  action     text NOT NULL CHECK (action IN ('saved', 'removed', 'tested')),
  actor_id   uuid,
  actor_name text,
  last4      text,
  outcome    text,
  at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_api_key_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_api_key_log FROM anon, authenticated;

-- The acting person, when they are a superadmin or a GST Manager; with a
-- password given, only when it is theirs. Raises otherwise, naming nothing secret.
CREATE OR REPLACE FUNCTION public.ai_api_key_admin(p_actor_id uuid, p_password text, p_need_password boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_role text;
  v_name text;
  v_hash text;
BEGIN
  SELECT role::text INTO v_role FROM public.user_roles
   WHERE user_id = p_actor_id AND role::text IN ('superadmin', 'gst_manager')
   ORDER BY (role::text = 'superadmin') DESC LIMIT 1;
  IF p_actor_id IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'Only a GST Manager or the superadmin can manage the Claude API key.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT first_name, password INTO v_name, v_hash FROM public.profiles WHERE user_id = p_actor_id LIMIT 1;
  IF p_need_password AND (v_hash IS NULL OR p_password IS NULL OR crypt(p_password, v_hash) <> v_hash) THEN
    RAISE EXCEPTION 'Your password is not correct.' USING ERRCODE = 'invalid_password';
  END IF;
  RETURN coalesce(nullif(v_name, ''), v_role);
END;
$$;

-- What may be shown: never the key.
CREATE OR REPLACE FUNCTION public.ai_api_key_status(p_actor_id uuid)
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
    'saved', r.masked IS NOT NULL,
    'masked', r.masked,
    'saved_by_name', r.saved_by_name,
    'saved_at', r.saved_at,
    'version', coalesce(r.version, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_api_key_set(p_actor_id uuid, p_password text, p_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name   text;
  v_key    text := btrim(coalesce(p_key, ''));
  v_id     uuid;
  v_last4  text;
BEGIN
  v_name := public.ai_api_key_admin(p_actor_id, p_password, true);
  IF v_key !~ '^sk-ant-[A-Za-z0-9_-]{20,}$' OR length(v_key) > 300 THEN
    RAISE EXCEPTION 'That is not a Claude API key: it must start with sk-ant-.' USING ERRCODE = 'check_violation';
  END IF;
  v_last4 := right(v_key, 4);

  INSERT INTO public.ai_api_key (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  SELECT vault_secret_id INTO v_id FROM public.ai_api_key WHERE id = 1 FOR UPDATE;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM vault.secrets WHERE name = 'gst_keeper_claude_api_key';
  END IF;
  IF v_id IS NULL THEN
    v_id := vault.create_secret(v_key, 'gst_keeper_claude_api_key', 'Claude API key saved from GST Keeper (ai_api_key)');
  ELSE
    PERFORM vault.update_secret(v_id, v_key);
  END IF;

  UPDATE public.ai_api_key
     SET vault_secret_id = v_id, masked = 'sk-ant-…' || v_last4, last4 = v_last4,
         saved_by = p_actor_id, saved_by_name = v_name, saved_at = now(), version = version + 1
   WHERE id = 1;
  INSERT INTO public.ai_api_key_log (action, actor_id, actor_name, last4) VALUES ('saved', p_actor_id, v_name, v_last4);
  RETURN public.ai_api_key_status(p_actor_id);
END;
$$;

-- Removing overwrites the Vault secret with nothing, so no copy of the key is left.
CREATE OR REPLACE FUNCTION public.ai_api_key_remove(p_actor_id uuid, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name  text;
  r       public.ai_api_key;
BEGIN
  v_name := public.ai_api_key_admin(p_actor_id, p_password, true);
  SELECT * INTO r FROM public.ai_api_key WHERE id = 1 FOR UPDATE;
  IF r.vault_secret_id IS NOT NULL THEN
    PERFORM vault.update_secret(r.vault_secret_id, '');
  END IF;
  IF r.masked IS NOT NULL THEN
    UPDATE public.ai_api_key
       SET masked = NULL, last4 = NULL, saved_by = NULL, saved_by_name = NULL, saved_at = NULL, version = version + 1
     WHERE id = 1;
    INSERT INTO public.ai_api_key_log (action, actor_id, actor_name, last4) VALUES ('removed', p_actor_id, v_name, r.last4);
  END IF;
  RETURN public.ai_api_key_status(p_actor_id);
END;
$$;

-- The key itself, for the Edge Functions (service role only); null when none is saved.
CREATE OR REPLACE FUNCTION public.ai_api_key_read()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r     public.ai_api_key;
  v_key text;
BEGIN
  SELECT * INTO r FROM public.ai_api_key WHERE id = 1;
  IF r.vault_secret_id IS NULL OR r.masked IS NULL THEN
    RETURN jsonb_build_object('key', NULL, 'version', coalesce(r.version, 0));
  END IF;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE id = r.vault_secret_id;
  RETURN jsonb_build_object('key', nullif(v_key, ''), 'version', r.version);
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_api_key_log_test(p_actor_id uuid, p_outcome text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_name text;
BEGIN
  v_name := public.ai_api_key_admin(p_actor_id, NULL, false);
  INSERT INTO public.ai_api_key_log (action, actor_id, actor_name, last4, outcome)
  VALUES ('tested', p_actor_id, v_name, (SELECT last4 FROM public.ai_api_key WHERE id = 1), left(p_outcome, 200));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ai_api_key_admin(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_api_key_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_api_key_set(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_api_key_remove(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_api_key_read() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_api_key_log_test(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_api_key_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_api_key_set(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_api_key_remove(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_api_key_read() TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_api_key_log_test(uuid, text) TO service_role;

COMMIT;
