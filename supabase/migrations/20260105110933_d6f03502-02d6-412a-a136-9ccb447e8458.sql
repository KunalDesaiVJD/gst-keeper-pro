-- Add cancellation_date column to clients table
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS cancellation_date date DEFAULT NULL;