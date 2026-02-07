-- Add opening balance columns to suspended_reco for the new two-row portal layout
ALTER TABLE public.suspended_reco 
ADD COLUMN IF NOT EXISTS opening_cgst numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS opening_sgst numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS opening_igst numeric DEFAULT 0;
