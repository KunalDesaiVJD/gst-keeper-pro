-- Add client_password and is_first_login columns to clients table
ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS client_password text,
ADD COLUMN IF NOT EXISTS is_first_login boolean DEFAULT true;

-- Set default password to GSTIN for existing clients
UPDATE public.clients 
SET client_password = gstin, is_first_login = true 
WHERE client_password IS NULL;

-- Create function to authenticate clients
CREATE OR REPLACE FUNCTION public.authenticate_client(identifier text, pass text)
RETURNS TABLE(
  client_id uuid,
  client_name text,
  client_email text,
  gstin text,
  is_first_login boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS client_id,
    c.name AS client_name,
    COALESCE(c.email, '') AS client_email,
    c.gstin,
    COALESCE(c.is_first_login, true) AS is_first_login
  FROM public.clients c
  WHERE (
    -- Match by GSTIN (case-insensitive)
    upper(c.gstin) = upper(identifier)
    OR
    -- Match by client_user_id (PAN-based, case-insensitive)
    upper(c.client_user_id) = upper(identifier)
  )
  AND c.client_password = pass
  LIMIT 1;
END;
$$;

-- Create function to complete client first login (change password)
CREATE OR REPLACE FUNCTION public.complete_client_first_login(target_client_id uuid, new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.clients
  SET client_password = new_password,
      is_first_login = false,
      updated_at = now()
  WHERE id = target_client_id;
END;
$$;

-- Create function to reset client password (by staff)
CREATE OR REPLACE FUNCTION public.reset_client_password(target_client_id uuid, new_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.clients
  SET client_password = new_password,
      is_first_login = true,
      updated_at = now()
  WHERE id = target_client_id;
  
  RETURN FOUND;
END;
$$;