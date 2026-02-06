-- Remove foreign key constraint on twob_versions.updated_by
-- This references auth.users(id) but we use custom auth with profiles UUIDs
ALTER TABLE public.twob_versions DROP CONSTRAINT IF EXISTS twob_versions_updated_by_fkey;