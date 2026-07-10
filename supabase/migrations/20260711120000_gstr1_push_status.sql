-- Track the last GST-portal (Humonex) push per stored GSTR-1 return.
-- Written by the gst-push edge function; read by the GSTR-01 page to show the
-- team what has already been filed and whether the last attempt succeeded.

ALTER TABLE public.gstr1_data
  ADD COLUMN IF NOT EXISTS last_pushed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_push_status text,      -- 'success' | 'failed'
  ADD COLUMN IF NOT EXISTS last_push_by     uuid,      -- staff user_id that pushed
  ADD COLUMN IF NOT EXISTS last_push_message text;     -- failure reason (null on success)

COMMENT ON COLUMN public.gstr1_data.last_pushed_at IS 'When the return was last pushed to the GST portal via Humonex.';
COMMENT ON COLUMN public.gstr1_data.last_push_status IS 'Outcome of the last push: success or failed.';
COMMENT ON COLUMN public.gstr1_data.last_push_by IS 'Staff user_id who triggered the last push.';
COMMENT ON COLUMN public.gstr1_data.last_push_message IS 'Failure message from the last push (null when successful).';
