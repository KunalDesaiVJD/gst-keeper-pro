-- Fix: Remove self-referential foreign key on twob_versions that blocks deletion
ALTER TABLE public.twob_versions DROP CONSTRAINT IF EXISTS twob_versions_restored_from_version_id_fkey;

-- Create RCM versions table for RCM Summary version history
CREATE TABLE IF NOT EXISTS public.rcm_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL,
  financial_year TEXT NOT NULL,
  version_number INTEGER DEFAULT 1,
  version_data JSONB,
  updated_by UUID,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  is_current BOOLEAN DEFAULT true,
  action_type TEXT DEFAULT 'SAVE',
  restored_from_version_id UUID
);

-- Enable RLS on rcm_versions
ALTER TABLE public.rcm_versions ENABLE ROW LEVEL SECURITY;

-- Create permissive policies for rcm_versions (custom auth)
CREATE POLICY "Anyone can view RCM versions for development" 
ON public.rcm_versions FOR SELECT 
USING (true);

CREATE POLICY "Anyone can manage RCM versions for development" 
ON public.rcm_versions FOR ALL 
USING (true) 
WITH CHECK (true);

-- Create ITC versions table for ITC Summary version history
CREATE TABLE IF NOT EXISTS public.itc_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL,
  period_month TEXT NOT NULL,
  version_number INTEGER DEFAULT 1,
  version_data JSONB,
  updated_by UUID,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  is_current BOOLEAN DEFAULT true,
  action_type TEXT DEFAULT 'SAVE',
  restored_from_version_id UUID
);

-- Enable RLS on itc_versions
ALTER TABLE public.itc_versions ENABLE ROW LEVEL SECURITY;

-- Create permissive policies for itc_versions (custom auth)
CREATE POLICY "Anyone can view ITC versions for development" 
ON public.itc_versions FOR SELECT 
USING (true);

CREATE POLICY "Anyone can manage ITC versions for development" 
ON public.itc_versions FOR ALL 
USING (true) 
WITH CHECK (true);