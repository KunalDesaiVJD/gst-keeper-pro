-- Add development RLS policy for profiles to allow anonymous inserts
CREATE POLICY "Anyone can insert profiles for development"
ON public.profiles
FOR INSERT
WITH CHECK (true);

-- Add development RLS policy for user_roles to allow anonymous inserts
CREATE POLICY "Anyone can insert user_roles for development"
ON public.user_roles
FOR INSERT
WITH CHECK (true);

-- Add policy for anyone to manage user_roles for development
CREATE POLICY "Anyone can manage user_roles for development"
ON public.user_roles
FOR ALL
USING (true)
WITH CHECK (true);