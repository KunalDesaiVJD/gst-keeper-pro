
-- Drop the restrictive INSERT policy
DROP POLICY IF EXISTS "Authenticated users can upload chat attachments" ON storage.objects;

-- Create permissive INSERT policy matching app's auth pattern
CREATE POLICY "Anyone can upload chat attachments"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'chat-attachments');

-- Allow delete too for cleanup
CREATE POLICY "Anyone can delete chat attachments"
ON storage.objects FOR DELETE
USING (bucket_id = 'chat-attachments');
