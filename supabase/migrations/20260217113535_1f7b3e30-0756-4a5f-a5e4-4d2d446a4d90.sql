
-- 1. Add reclaim_subtype column to bills_not_in_2b
ALTER TABLE public.bills_not_in_2b ADD COLUMN IF NOT EXISTS reclaim_subtype TEXT NULL;

-- 2. Add instructions_by_employee_id to gst_running_updates (using profiles table user_id)
ALTER TABLE public.gst_running_updates ADD COLUMN IF NOT EXISTS instructions_by_employee_id UUID NULL;

-- 3. Create gst_update_row_versions table for row-wise versioning
CREATE TABLE IF NOT EXISTS public.gst_update_row_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id UUID NOT NULL,
  changed_by_employee_id UUID NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  group_version_id UUID NULL,
  field_name TEXT NOT NULL,
  old_value JSONB NULL,
  new_value JSONB NULL
);

-- Enable RLS on gst_update_row_versions
ALTER TABLE public.gst_update_row_versions ENABLE ROW LEVEL SECURITY;

-- RLS policies for gst_update_row_versions
CREATE POLICY "Anyone can view row versions" ON public.gst_update_row_versions FOR SELECT USING (true);
CREATE POLICY "Anyone can manage row versions" ON public.gst_update_row_versions FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for gst_update_row_versions
ALTER PUBLICATION supabase_realtime ADD TABLE public.gst_update_row_versions;
