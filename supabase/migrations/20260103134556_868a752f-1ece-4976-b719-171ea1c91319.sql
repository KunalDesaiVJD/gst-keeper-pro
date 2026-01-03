-- Add unique constraint for filing_status upsert to work
ALTER TABLE public.filing_status 
ADD CONSTRAINT filing_status_unique_client_return_month 
UNIQUE (client_id, return_type, period_month);

-- Add delete policy for profiles for development
CREATE POLICY "Anyone can delete profiles for development"
ON public.profiles
FOR DELETE
USING (true);

-- Add delete policy for user_roles for development
CREATE POLICY "Anyone can delete user_roles for development"
ON public.user_roles
FOR DELETE
USING (true);