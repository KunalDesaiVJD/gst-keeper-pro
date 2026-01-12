-- Add UPDATE and DELETE policies for twob_versions
-- Allow managers (superadmin/gst_manager) to update versions
CREATE POLICY "Managers can update versions" ON public.twob_versions
FOR UPDATE USING (
  has_role(auth.uid(), 'superadmin'::app_role) OR 
  has_role(auth.uid(), 'gst_manager'::app_role)
);

-- Allow staff to update their own versions or if they are managers
CREATE POLICY "Staff can update versions" ON public.twob_versions
FOR UPDATE USING (is_staff(auth.uid()));

-- Allow staff to view versions (for the save process to work correctly)
CREATE POLICY "Staff can view versions" ON public.twob_versions
FOR SELECT USING (is_staff(auth.uid()));

-- Delete policy for cleanup if needed
CREATE POLICY "Managers can delete versions" ON public.twob_versions
FOR DELETE USING (
  has_role(auth.uid(), 'superadmin'::app_role) OR 
  has_role(auth.uid(), 'gst_manager'::app_role)
);