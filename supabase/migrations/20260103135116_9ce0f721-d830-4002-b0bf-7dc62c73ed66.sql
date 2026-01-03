-- Remove foreign key constraint on profiles.user_id to allow mock users during development
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;