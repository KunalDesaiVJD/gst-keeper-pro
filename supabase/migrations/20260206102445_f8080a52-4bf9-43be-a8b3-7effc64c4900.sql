-- Fix RLS policies on twob_versions for custom auth
-- Since this app uses custom auth (not Supabase Auth), auth.uid() returns null
-- Update policies to allow staff operations

-- Drop existing policies
DROP POLICY IF EXISTS "Managers can view versions" ON public.twob_versions;
DROP POLICY IF EXISTS "Staff can insert versions" ON public.twob_versions;
DROP POLICY IF EXISTS "Managers can update versions" ON public.twob_versions;
DROP POLICY IF EXISTS "Staff can update versions" ON public.twob_versions;
DROP POLICY IF EXISTS "Staff can view versions" ON public.twob_versions;
DROP POLICY IF EXISTS "Managers can delete versions" ON public.twob_versions;

-- Create development-friendly policies (matching other tables in this app)
CREATE POLICY "Anyone can view versions for development" 
ON public.twob_versions FOR SELECT 
USING (true);

CREATE POLICY "Anyone can manage versions for development" 
ON public.twob_versions FOR ALL 
USING (true) 
WITH CHECK (true);