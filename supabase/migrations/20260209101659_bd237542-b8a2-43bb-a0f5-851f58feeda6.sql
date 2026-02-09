
-- Create gst_update_versions table for version history
CREATE TABLE public.gst_update_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL,
  version_number INTEGER DEFAULT 1,
  version_data JSONB,
  updated_by UUID,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  is_current BOOLEAN DEFAULT true,
  restored_from_version_id UUID,
  filter_context JSONB,
  action_type TEXT DEFAULT 'SAVE'
);

ALTER TABLE public.gst_update_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can manage GST update versions for development" ON public.gst_update_versions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can view GST update versions for development" ON public.gst_update_versions FOR SELECT USING (true);
