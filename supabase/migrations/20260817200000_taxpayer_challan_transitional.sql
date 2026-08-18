-- Schema for 2 schema-only report sources: Taxpayer Information + Download
-- Registration Certificate (one shared per-client profile table — both
-- reports read the same portal "My Profile" data), and Challan Summary. No
-- extension automation in this pass — same reasoning as the Notice/Refund/
-- DRC-03 and Liability/Cash Ledger batches: these are portal pages this
-- codebase has never scraped, with no existing code to mirror.
--
-- (This migration originally also created gst_transitional_credit for a
-- Transitional Credit Claimed report — dropped by product decision, see
-- 20260819000000_drop_transitional_credit.sql.)

CREATE TABLE IF NOT EXISTS public.gst_taxpayer_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  legal_name text,
  trade_name text,
  constitution_of_business text,
  registration_date date,
  jurisdiction_state text,
  jurisdiction_centre text,
  principal_place_address text,
  aadhaar_authentication_status text,
  registration_certificate_url text,     -- storage URL once a PDF pull is wired
  pulled_at timestamptz NOT NULL DEFAULT now(),
  pulled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gst_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  cpin text,
  challan_date date,
  payment_mode text,
  total_amount numeric,
  cgst_amount numeric,
  sgst_amount numeric,
  igst_amount numeric,
  cess_amount numeric,
  status text,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  pulled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gst_challans_client ON public.gst_challans (client_id);

ALTER TABLE public.gst_taxpayer_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gst_challans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gst_taxpayer_profile_all" ON public.gst_taxpayer_profile FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "gst_challans_all" ON public.gst_challans FOR ALL TO public USING (true) WITH CHECK (true);
