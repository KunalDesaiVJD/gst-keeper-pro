-- Add ISD to registration_type enum
ALTER TYPE public.registration_type ADD VALUE IF NOT EXISTS 'ISD';

-- Note: GSTR-6 will be moved from Regular to ISD in application code