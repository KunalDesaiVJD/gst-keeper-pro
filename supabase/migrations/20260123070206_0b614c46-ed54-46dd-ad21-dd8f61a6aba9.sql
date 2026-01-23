-- Add 'Prepared Pending' and 'Data Received' to filing_status_type enum
ALTER TYPE filing_status_type ADD VALUE IF NOT EXISTS 'Prepared Pending';
ALTER TYPE filing_status_type ADD VALUE IF NOT EXISTS 'Data Received';

-- Create table for suspended reconciliation data
CREATE TABLE IF NOT EXISTS public.suspended_reco (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month TEXT NOT NULL,
  portal_cgst NUMERIC DEFAULT 0,
  portal_sgst NUMERIC DEFAULT 0,
  portal_igst NUMERIC DEFAULT 0,
  updated_by UUID,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(client_id, period_month)
);

-- Enable RLS on suspended_reco
ALTER TABLE public.suspended_reco ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for suspended_reco
CREATE POLICY "Staff can view suspended reco" ON public.suspended_reco FOR SELECT USING (true);
CREATE POLICY "Staff can manage suspended reco" ON public.suspended_reco FOR ALL USING (true) WITH CHECK (true);

-- Create table for GST Running Update Sheet
CREATE TABLE IF NOT EXISTS public.gst_running_updates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  update_effect_month TEXT NOT NULL,
  update_in_return TEXT NOT NULL CHECK (update_in_return IN ('GSTR-1', 'GSTR-3B', 'GSTR-7', 'GSTR-1 & 3B')),
  update_type TEXT NOT NULL CHECK (update_type IN ('Claim ITC', 'Reversal ITC', 'Liability', 'RCM')),
  update_instructions_by TEXT,
  matter_brief TEXT,
  taxable_value NUMERIC DEFAULT 0,
  cgst NUMERIC DEFAULT 0,
  sgst NUMERIC DEFAULT 0,
  igst NUMERIC DEFAULT 0,
  interest NUMERIC DEFAULT 0,
  effect_month TEXT,
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_by UUID
);

-- Enable RLS on gst_running_updates
ALTER TABLE public.gst_running_updates ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for gst_running_updates
CREATE POLICY "Staff can view GST updates" ON public.gst_running_updates FOR SELECT USING (true);
CREATE POLICY "Staff can manage GST updates" ON public.gst_running_updates FOR ALL USING (true) WITH CHECK (true);