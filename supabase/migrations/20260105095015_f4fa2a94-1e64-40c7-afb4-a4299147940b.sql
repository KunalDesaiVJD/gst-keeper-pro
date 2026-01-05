-- Create password reset requests table
CREATE TABLE public.password_reset_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  requested_by_name TEXT NOT NULL,
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by UUID
);

-- Enable RLS
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

-- Development policies
CREATE POLICY "Anyone can view reset requests for development"
ON public.password_reset_requests
FOR SELECT
USING (true);

CREATE POLICY "Anyone can manage reset requests for development"
ON public.password_reset_requests
FOR ALL
USING (true)
WITH CHECK (true);

-- Add password field to profiles for mock auth
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS password TEXT;

-- Add client_user_id to clients for login credential tracking
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS client_user_id TEXT;