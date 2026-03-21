
-- Add ARN and return_pdf_url columns to filing_status
ALTER TABLE public.filing_status 
  ADD COLUMN IF NOT EXISTS arn text,
  ADD COLUMN IF NOT EXISTS return_pdf_url text;

-- Add unique constraint on ARN (only for non-null values)
ALTER TABLE public.filing_status 
  ADD CONSTRAINT filing_status_arn_unique UNIQUE (arn);

-- Create storage bucket for return PDFs
INSERT INTO storage.buckets (id, name, public) 
VALUES ('return-pdfs', 'return-pdfs', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public access to return-pdfs bucket
CREATE POLICY "Anyone can upload return PDFs" ON storage.objects
  FOR INSERT TO public
  WITH CHECK (bucket_id = 'return-pdfs');

CREATE POLICY "Anyone can view return PDFs" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'return-pdfs');

CREATE POLICY "Anyone can delete return PDFs" ON storage.objects
  FOR DELETE TO public
  USING (bucket_id = 'return-pdfs');
