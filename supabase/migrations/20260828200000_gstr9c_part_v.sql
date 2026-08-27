-- GSTR-9C Part V — "Additional Liability due to non-reconciliation"
-- (verified against GSTR_9C_Offline_Utility.xlsm v2.8, sheet "PT V",
-- 27 Aug 2026). Fixed 19-row grid: 11 rate-slab rows (5% through 40%,
-- 3%/0.25%/0.10%/Others%, e-commerce 9(5)) carry a Value column; the
-- remaining 8 rows (ITC, Interest, Late Fee, Penalty, any other amount
-- paid for supplies not in GSTR-9, erroneous refund, outstanding demands,
-- other) don't. Every row splits "Paid through Cash/ITC" by Central/
-- State/Integrated Tax + Cess. Entirely manual, no formula cells in the
-- real sheet — same shape as Table 9/11's RateWiseRow, reused here.

CREATE TABLE IF NOT EXISTS public.gstr9c_part_v_additional_liability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  row_key text NOT NULL CHECK (row_key IN (
    'A', 'A1', 'B', 'C', 'D', 'D1', 'E', 'F', 'G', 'G1', 'G2',
    'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'
  )),
  taxable_value numeric NOT NULL DEFAULT 0,
  central_tax numeric NOT NULL DEFAULT 0,
  state_tax numeric NOT NULL DEFAULT 0,
  integrated_tax numeric NOT NULL DEFAULT 0,
  cess numeric NOT NULL DEFAULT 0,
  entered_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, row_key)
);

ALTER TABLE public.gstr9c_part_v_additional_liability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gstr9c_part_v_additional_liability_all" ON public.gstr9c_part_v_additional_liability
  FOR ALL TO public USING (true) WITH CHECK (true);

-- GSTR-9C certification block — the verification declaration's signatory
-- and address details (sheet "PT V", below the liability grid). One row
-- per client/year; every field here is mandatory (*) on the real form.

CREATE TABLE IF NOT EXISTS public.gstr9c_certification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  place text,
  signatory_name text,
  membership_no text,
  signature_date date,
  building_no text,
  floor_number text,
  premises_name text,
  road_street text,
  city_town_locality text,
  district text,
  state text,
  pin_code text,
  pan text,
  entered_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year)
);

ALTER TABLE public.gstr9c_certification ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gstr9c_certification_all" ON public.gstr9c_certification
  FOR ALL TO public USING (true) WITH CHECK (true);
