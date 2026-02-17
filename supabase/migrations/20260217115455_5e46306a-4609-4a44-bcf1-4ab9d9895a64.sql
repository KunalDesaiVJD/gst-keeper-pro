-- Update the check constraint on gst_running_updates to include 'RCM Liability'
ALTER TABLE public.gst_running_updates DROP CONSTRAINT IF EXISTS gst_running_updates_update_type_check;
ALTER TABLE public.gst_running_updates ADD CONSTRAINT gst_running_updates_update_type_check 
  CHECK (update_type IN ('Claim ITC', 'Reversal ITC', 'Liability', 'RCM', 'RCM Liability', 'Reclaim', 'Reclaim (Expense out)'));

-- Also update existing 'RCM' values to 'RCM Liability' for consistency
UPDATE public.gst_running_updates SET update_type = 'RCM Liability' WHERE update_type = 'RCM';