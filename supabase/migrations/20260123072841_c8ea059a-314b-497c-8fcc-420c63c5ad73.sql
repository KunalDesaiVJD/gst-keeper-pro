-- Add IFF to registration_type enum
ALTER TYPE public.registration_type ADD VALUE IF NOT EXISTS 'IFF';

-- Add new return types for IFF
ALTER TYPE public.return_type ADD VALUE IF NOT EXISTS 'GSTR-1 (IFF)';
ALTER TYPE public.return_type ADD VALUE IF NOT EXISTS 'GSTR-3B (Q)';