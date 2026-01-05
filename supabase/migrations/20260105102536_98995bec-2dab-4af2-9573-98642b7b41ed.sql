-- Remove the foreign key constraint on user_roles that references auth.users
-- This is needed because we're using mock authentication during development
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;