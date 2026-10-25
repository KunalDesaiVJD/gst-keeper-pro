-- Every AI call is Claude Sonnet at medium effort (the firm's rule, 25 Oct 2026).
--
-- The Edge Functions and the office agent already send only that model and effort
-- (supabase/functions/_shared/aiModel.ts), whatever ai_settings holds; this makes
-- the settings say the same and refuses any other value from now on, so no screen,
-- script or older app version can choose another model or effort.
-- `node scripts/verify-ai-model.mjs` (run by `npm run typecheck`) checks the code.
-- Additive: one row updated, defaults set, CHECK constraints added.

UPDATE public.ai_settings SET
  model = 'claude-sonnet-5-5',
  doc_model = 'claude-sonnet-5-5',
  effort = 'medium',
  doc_effort = 'medium',
  assist_effort = 'medium',
  -- Sonnet's list prices (USD per million tokens) where the Opus ones were left as set.
  price_in_per_mtok  = CASE WHEN price_in_per_mtok = 4 AND price_out_per_mtok = 20 THEN 2 ELSE price_in_per_mtok END,
  price_out_per_mtok = CASE WHEN price_in_per_mtok = 4 AND price_out_per_mtok = 20 THEN 10 ELSE price_out_per_mtok END,
  updated_by_name = 'Sonnet medium rule (20261025190000)',
  updated_at = now();

ALTER TABLE public.ai_settings
  ALTER COLUMN model SET DEFAULT 'claude-sonnet-5-5',
  ALTER COLUMN doc_model SET DEFAULT 'claude-sonnet-5-5',
  ALTER COLUMN effort SET DEFAULT 'medium',
  ALTER COLUMN doc_effort SET DEFAULT 'medium',
  ALTER COLUMN assist_effort SET DEFAULT 'medium',
  ALTER COLUMN price_in_per_mtok SET DEFAULT 2,
  ALTER COLUMN price_out_per_mtok SET DEFAULT 10;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_settings_sonnet_medium_only'
                   AND conrelid = 'public.ai_settings'::regclass) THEN
    ALTER TABLE public.ai_settings ADD CONSTRAINT ai_settings_sonnet_medium_only CHECK (
      model = 'claude-sonnet-5-5' AND doc_model = 'claude-sonnet-5-5'
      AND effort = 'medium' AND doc_effort = 'medium' AND assist_effort = 'medium');
  END IF;
END $$;

COMMENT ON CONSTRAINT ai_settings_sonnet_medium_only ON public.ai_settings IS
  'Every AI call is Claude Sonnet at medium effort (the firm, 25 Oct 2026); supabase/functions/_shared/aiModel.ts. Never widen this.';
