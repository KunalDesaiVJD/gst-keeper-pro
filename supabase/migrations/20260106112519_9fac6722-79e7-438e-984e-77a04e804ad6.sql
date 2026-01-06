-- Drop the existing restrictive policy and create a permissive one
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

-- Create a permissive policy that allows anyone to view profiles
CREATE POLICY "Anyone can view profiles" 
ON public.profiles 
FOR SELECT 
TO public
USING (true);