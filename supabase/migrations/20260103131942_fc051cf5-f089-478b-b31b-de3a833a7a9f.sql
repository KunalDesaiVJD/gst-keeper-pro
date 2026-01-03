-- Add development RLS policy for anonymous client insert/update/delete
-- This matches the pattern used for other tables during development

DROP POLICY IF EXISTS "Staff can insert clients" ON public.clients;
DROP POLICY IF EXISTS "Staff can update clients" ON public.clients;
DROP POLICY IF EXISTS "Staff can delete clients" ON public.clients;

-- Create development-friendly policies (to be replaced with proper auth later)
CREATE POLICY "Anyone can insert clients for development"
ON public.clients
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update clients for development"
ON public.clients
FOR UPDATE
USING (true);

CREATE POLICY "Anyone can delete clients for development"
ON public.clients
FOR DELETE
USING (true);