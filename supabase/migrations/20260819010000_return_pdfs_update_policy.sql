-- The return-pdfs bucket (20260321093054_e19...) got INSERT/SELECT/DELETE
-- policies but no UPDATE policy. extension/background.js's uploadPdf always
-- sends x-upsert: true, so any re-upload to an already-existing path (a
-- retry on the same GSTR-3B period+ARN, or the DRC-03/registration-
-- certificate PDFs added this session, which re-upload to the same path on
-- every pull by design) hits Storage's UPDATE path with no matching policy
-- and 403s with "new row violates row-level security policy". This was
-- surfaced live on a GSTR-3B return PDF re-push.

CREATE POLICY "Anyone can update return PDFs" ON storage.objects
  FOR UPDATE TO public
  USING (bucket_id = 'return-pdfs')
  WITH CHECK (bucket_id = 'return-pdfs');
