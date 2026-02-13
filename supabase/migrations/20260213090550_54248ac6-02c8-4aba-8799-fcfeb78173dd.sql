
-- Table to store imported GSTR-1 JSON data per client per month
CREATE TABLE public.gstr1_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  period_month text NOT NULL, -- e.g. 'Jan-26'
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  file_name text,
  imported_by uuid,
  imported_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(client_id, period_month)
);

-- Enable RLS
ALTER TABLE public.gstr1_data ENABLE ROW LEVEL SECURITY;

-- Staff can do everything
CREATE POLICY "Staff can manage GSTR1 data"
ON public.gstr1_data
FOR ALL
USING (true)
WITH CHECK (true);

-- Everyone can read (clients will be filtered in app)
CREATE POLICY "Anyone can view GSTR1 data"
ON public.gstr1_data
FOR SELECT
USING (true);
