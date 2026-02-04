-- Add new columns to clients table for builder bifurcation and partial ITC

-- Builder sub-type for Regular registration (Builder or Normal)
ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS regular_sub_type text;

-- ITC type for Builder (NO_ITC, CLAIM_ITC, PARTIAL_ITC)
ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS builder_itc_type text;

-- Commercial and Residential areas for Partial ITC (stored as numeric values)
ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS commercial_area numeric DEFAULT 0;

ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS residential_area numeric DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN public.clients.regular_sub_type IS 'For Regular registration type: Builder or Normal';
COMMENT ON COLUMN public.clients.builder_itc_type IS 'For Builder sub-type: NO_ITC, CLAIM_ITC, or PARTIAL_ITC';
COMMENT ON COLUMN public.clients.commercial_area IS 'Commercial area value for PARTIAL_ITC calculation';
COMMENT ON COLUMN public.clients.residential_area IS 'Residential area value for PARTIAL_ITC calculation';