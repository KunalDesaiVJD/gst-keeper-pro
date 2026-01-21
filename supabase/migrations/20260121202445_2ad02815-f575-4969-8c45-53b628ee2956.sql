-- Add GST User ID and Password columns to clients table
ALTER TABLE public.clients 
ADD COLUMN gst_user_id text,
ADD COLUMN gst_password text;