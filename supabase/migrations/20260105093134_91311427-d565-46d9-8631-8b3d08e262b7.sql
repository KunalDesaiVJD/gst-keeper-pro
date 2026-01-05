-- Create a table for granular user permissions
CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  permission_key text NOT NULL,
  granted_by uuid,
  granted_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, permission_key)
);

-- Enable RLS
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for development (matching other tables)
CREATE POLICY "Anyone can view permissions for development"
ON public.user_permissions
FOR SELECT
USING (true);

CREATE POLICY "Anyone can manage permissions for development"
ON public.user_permissions
FOR ALL
USING (true)
WITH CHECK (true);

-- Create trigger for updated_at if needed in future
COMMENT ON TABLE public.user_permissions IS 'Stores granular permissions for employees beyond their base role';