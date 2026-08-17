-- Schema for the last 3 schema-only report sources: Taxpayer Information +
-- Download Registration Certificate (one shared per-client profile table —
-- both reports read the same portal "My Profile" data), Challan Summary,
-- and Transitional Credit Claimed. No extension automation in this pass —
-- same reasoning as the Notice/Refund/DRC-03 and Liability/Cash Ledger
-- batches: these are portal pages this codebase has never scraped, with no
-- existing code to mirror.
--
-- Transitional Credit specifically carries its own open question (flagged
-- in the roadmap before this table existed): TRAN-1/2 was a one-time 2017
-- transition, and it hasn't been confirmed the portal still exposes this
-- data years later. The table and report exist regardless — if the portal
-- doesn't have this data any more, the report will just stay empty, same
-- honest "no data yet" outcome as every other unpopulated report on this
-- Hub, not a broken build.

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

CREATE TABLE IF NOT EXISTS public.gst_transitional_credit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  form_type text,                        -- 'TRAN-1' | 'TRAN-2'
  arn text,
  filed_date date,
  cgst_credit_claimed numeric,
  sgst_credit_claimed numeric,
  status text,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  pulled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gst_transitional_credit_client ON public.gst_transitional_credit (client_id);

ALTER TABLE public.gst_taxpayer_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gst_challans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gst_transitional_credit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gst_taxpayer_profile_all" ON public.gst_taxpayer_profile FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "gst_challans_all" ON public.gst_challans FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "gst_transitional_credit_all" ON public.gst_transitional_credit FOR ALL TO public USING (true) WITH CHECK (true);
