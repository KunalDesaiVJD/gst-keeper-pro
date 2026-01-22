-- Create RCM Masters table for expense type definitions
CREATE TABLE public.rcm_masters (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_name TEXT NOT NULL,
  rate TEXT NOT NULL, -- '5%', '18%', '18%/1%/5%' for FSI
  supply_type TEXT NOT NULL DEFAULT 'intrastate', -- 'intrastate' or 'interstate'
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create RCM Data table for actual entries per client/month
CREATE TABLE public.rcm_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  master_id UUID REFERENCES public.rcm_masters(id) ON DELETE SET NULL,
  financial_year TEXT NOT NULL, -- '2024-25', '2025-26'
  month TEXT NOT NULL, -- 'Apr-25', 'May-25', etc.
  particulars TEXT NOT NULL,
  rate TEXT NOT NULL,
  supply_type TEXT NOT NULL DEFAULT 'intrastate',
  taxable_value NUMERIC DEFAULT 0,
  cgst_2_5 NUMERIC DEFAULT 0,
  cgst_9 NUMERIC DEFAULT 0,
  sgst_2_5 NUMERIC DEFAULT 0,
  sgst_9 NUMERIC DEFAULT 0,
  igst_5 NUMERIC DEFAULT 0,
  igst_18 NUMERIC DEFAULT 0,
  is_locked BOOLEAN DEFAULT false,
  updated_by UUID,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.rcm_masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rcm_data ENABLE ROW LEVEL SECURITY;

-- RLS policies for rcm_masters (global, all staff can access)
CREATE POLICY "Staff can view RCM masters"
ON public.rcm_masters FOR SELECT
USING (true);

CREATE POLICY "Staff can manage RCM masters"
ON public.rcm_masters FOR ALL
USING (true)
WITH CHECK (true);

-- RLS policies for rcm_data
CREATE POLICY "Staff can view RCM data"
ON public.rcm_data FOR SELECT
USING (true);

CREATE POLICY "Staff can manage RCM data"
ON public.rcm_data FOR ALL
USING (true)
WITH CHECK (true);

-- Create indexes for better performance
CREATE INDEX idx_rcm_data_client_year ON public.rcm_data(client_id, financial_year);
CREATE INDEX idx_rcm_data_month ON public.rcm_data(month);

-- Insert default RCM masters based on Excel structure
INSERT INTO public.rcm_masters (expense_name, rate, supply_type) VALUES
('Transportation Exps', '5%', 'intrastate'),
('Inward Charges', '5%', 'intrastate'),
('Outward Charges', '5%', 'intrastate'),
('Freight Exps', '5%', 'intrastate'),
('Delivery Exps', '5%', 'intrastate'),
('Security Exps', '18%', 'intrastate'),
('Rent expenses', '18%', 'intrastate'),
('Advocate Fees-LEGAL Exps', '18%', 'intrastate'),
('Royalty Exps', '18%', 'intrastate'),
('Import of Service', '18%', 'interstate'),
('FSI', '18%', 'intrastate'),
('TDR', '18%', 'intrastate');