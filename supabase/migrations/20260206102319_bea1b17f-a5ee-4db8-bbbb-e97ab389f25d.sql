-- Drop the incorrect foreign key constraint on updated_by
-- The application uses custom auth, not Supabase Auth, so this FK to auth.users is invalid
ALTER TABLE public.filing_status DROP CONSTRAINT IF EXISTS filing_status_updated_by_fkey;