-- Add action_type and restored_from_version_id columns to twob_versions table
ALTER TABLE public.twob_versions 
ADD COLUMN IF NOT EXISTS action_type text DEFAULT 'SAVE',
ADD COLUMN IF NOT EXISTS restored_from_version_id uuid REFERENCES public.twob_versions(id);

-- Add comment for documentation
COMMENT ON COLUMN public.twob_versions.action_type IS 'SAVE or RESTORE to track how this version was created';
COMMENT ON COLUMN public.twob_versions.restored_from_version_id IS 'Reference to the version that was restored (only set when action_type is RESTORE)';

-- Create index for faster version lookups
CREATE INDEX IF NOT EXISTS idx_twob_versions_client_period_version 
ON public.twob_versions(client_id, period_month, version_number DESC);